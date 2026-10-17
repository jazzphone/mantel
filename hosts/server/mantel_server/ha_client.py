"""Read-only connection to Home Assistant's WebSocket API.

SAFETY: this module can only *send* the message types in ALLOWED_TYPES. There is no way to call a
service through it, under any setting. A test (tests/test_ha_client.py) pins that.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import Counter as TallyCounter
from pathlib import Path
from typing import Awaitable, Callable

import aiohttp

from .registry import Registry
from .state import StateStore
from .stats import Counter

log = logging.getLogger("mantel.ha")

ALLOWED_TYPES = frozenset({
    "auth",
    "subscribe_entities",
    "config/area_registry/list",
    "config/device_registry/list",
    "config/entity_registry/list",
    "ping",
})


class CommandBlocked(Exception):
    """Raised when something tries to send a non-read message to HA."""


class TokenMissing(Exception):
    pass


def read_token(path: Path) -> str:
    try:
        token = path.expanduser().read_text().strip()
    except FileNotFoundError as exc:
        raise TokenMissing(f"Home Assistant token file not found: {path}") from exc
    if not token:
        raise TokenMissing(f"Home Assistant token file is empty: {path}")
    return token


def check_outgoing(message: dict) -> None:
    if message.get("type") not in ALLOWED_TYPES:
        raise CommandBlocked(f"refusing to send {message.get('type')!r} to Home Assistant (read-only)")


class HaClient:
    def __init__(self, url: str, token: str, store: StateStore, registry: Registry,
                 on_change: Callable[[set[str]], None],
                 on_registry: Callable[[], None] | None = None,
                 registry_refresh: float = 300.0) -> None:
        self.ws_url = url.rstrip("/").replace("http", "ws", 1) + "/api/websocket"
        self._token = token  # never logged
        self.store = store
        self.registry = registry
        self.on_change = on_change
        self.on_registry = on_registry
        self.registry_refresh = registry_refresh
        self.rx = Counter()  # everything HA sends us
        self.tx = Counter()  # everything we send HA
        self.rx_types: dict[str, Counter] = {}
        self.connected = asyncio.Event()
        self.ready = asyncio.Event()  # first full state received
        self.initial_bytes = 0
        self.entity_updates = 0
        self.biggest: list[tuple[int, list[str]]] = []  # largest event frames: (bytes, first entity ids)
        self.updates_by_entity: TallyCounter[str] = TallyCounter()  # after the initial snapshot
        self.connected_since: float | None = None
        self._next_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._sub_id: int | None = None
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._first_event = True

    async def _send(self, message: dict) -> None:
        check_outgoing(message)
        assert self._ws is not None
        data = json.dumps(message)
        self.tx.add(len(data))
        await self._ws.send_str(data)

    async def _request(self, type_: str) -> object:
        self._next_id += 1
        mid = self._next_id
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        await self._send({"id": mid, "type": type_})
        return await asyncio.wait_for(fut, 60)

    async def run(self) -> None:
        backoff = 1.0
        async with aiohttp.ClientSession() as session:
            while True:
                try:
                    await self._session(session)
                    backoff = 1.0
                except asyncio.CancelledError:
                    raise
                except (CommandBlocked, TokenMissing):
                    raise
                except Exception as exc:  # reconnect on anything else
                    log.warning("HA connection lost (%s: %s); retrying in %.0fs", type(exc).__name__, exc, backoff)
                self.connected.clear()
                self.connected_since = None
                for fut in self._pending.values():
                    if not fut.done():
                        fut.cancel()
                self._pending.clear()
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    async def _session(self, session: aiohttp.ClientSession) -> None:
        async with session.ws_connect(self.ws_url, max_msg_size=0, heartbeat=30) as ws:
            self._ws = ws
            first = await ws.receive_json()
            if first.get("type") != "auth_required":
                raise RuntimeError("unexpected greeting from Home Assistant")
            await self._send({"type": "auth", "access_token": self._token})
            reply = await ws.receive_json()
            if reply.get("type") != "auth_ok":
                raise RuntimeError("Home Assistant rejected the token (auth_invalid)")
            log.info("authenticated to Home Assistant %s", reply.get("ha_version", "?"))
            self.connected.set()
            self.connected_since = time.time()
            self._first_event = True
            reader = asyncio.create_task(self._read(ws))
            try:
                await self._load_registries()
                self._next_id += 1
                self._sub_id = self._next_id
                await self._send({"id": self._sub_id, "type": "subscribe_entities"})
                refresher = asyncio.create_task(self._refresh_registries())
                try:
                    await reader
                finally:
                    refresher.cancel()
            finally:
                reader.cancel()
                self._ws = None

    async def _load_registries(self) -> None:
        areas, devices, entities = await asyncio.gather(
            self._request("config/area_registry/list"),
            self._request("config/device_registry/list"),
            self._request("config/entity_registry/list"),
        )
        self.registry.load(areas, devices, entities)  # type: ignore[arg-type]
        log.info("registries: %d areas, %d devices, %d entities", len(areas), len(devices), len(entities))  # type: ignore[arg-type]

    async def _refresh_registries(self) -> None:
        while True:
            await asyncio.sleep(self.registry_refresh)
            try:
                await self._load_registries()
                if self.on_registry:
                    self.on_registry()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("registry refresh failed: %s", exc)

    async def _read(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                size = len(msg.data)
                self.rx.add(size)
                self.handle(json.loads(msg.data), size)
            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                break

    def handle(self, data: dict, size: int = 0) -> None:
        kind = data.get("type", "?")
        self.rx_types.setdefault(kind, Counter()).add(size)
        mid = data.get("id")
        if kind == "result":
            fut = self._pending.pop(mid, None)
            if fut and not fut.done():
                if data.get("success"):
                    fut.set_result(data.get("result"))
                else:
                    fut.set_exception(RuntimeError(f"HA error: {(data.get('error') or {}).get('code')}"))
        elif kind == "event" and mid == self._sub_id:
            event = data["event"]
            first_event = self._first_event
            if first_event:
                self._first_event = False
                self.initial_bytes = size
                touched = self.store.replace_all(event)
                self.ready.set()
                log.info("initial state: %d entities", len(self.store.states))
            else:
                touched = self.store.apply_event(event)
            if touched:
                if size > 20000 and not first_event:
                    self.biggest = sorted(self.biggest + [(size, sorted(touched)[:5])], reverse=True)[:5]
                if self.ready.is_set() and not first_event:
                    self.entity_updates += len(touched)
                    self.updates_by_entity.update(touched)
                self.on_change(touched)
