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
    "subscribe_events",  # only for REGISTRY_EVENTS, enforced in check_outgoing
    "ping",
})

# registry event -> the list call that reloads just that registry
REGISTRY_EVENTS = {
    "area_registry_updated": "config/area_registry/list",
    "device_registry_updated": "config/device_registry/list",
    "entity_registry_updated": "config/entity_registry/list",
}


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
    if message["type"] == "subscribe_events" and message.get("event_type") not in REGISTRY_EVENTS:
        raise CommandBlocked(f"subscribe_events is limited to {sorted(REGISTRY_EVENTS)}; got {message.get('event_type')!r}")


class HaClient:
    def __init__(self, url: str, token: str, store: StateStore, registry: Registry,
                 on_change: Callable[[set[str]], None],
                 on_registry: Callable[[], None] | None = None,
                 registry_debounce: float = 2.0) -> None:
        self.ws_url = url.rstrip("/").replace("http", "ws", 1) + "/api/websocket"
        self._token = token  # never logged
        self.store = store
        self.registry = registry
        self.on_change = on_change
        self.on_registry = on_registry
        self.registry_debounce = registry_debounce
        self._reg_subs: dict[int, str] = {}  # subscription id -> registry event type
        self._reg_dirty: set[str] = set()
        self._reg_wake = asyncio.Event()
        self.registry_reloads: dict[str, int] = {}
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
            watcher = None
            try:
                await self._load_registries()
                for event_type in REGISTRY_EVENTS:
                    self._next_id += 1
                    self._reg_subs[self._next_id] = event_type
                    await self._send({"id": self._next_id, "type": "subscribe_events", "event_type": event_type})
                self._next_id += 1
                self._sub_id = self._next_id
                await self._send({"id": self._sub_id, "type": "subscribe_entities"})
                watcher = asyncio.create_task(self._watch_registries())
                await reader
            finally:
                reader.cancel()
                if watcher:
                    watcher.cancel()
                self._reg_subs.clear()
                self._ws = None

    async def _load_registries(self, only: set[str] | None = None) -> None:
        """Load the registries named by event type in `only` (all when None)."""
        kinds = [k for k in REGISTRY_EVENTS if only is None or k in only]
        results = await asyncio.gather(*(self._request(REGISTRY_EVENTS[k]) for k in kinds))
        got = dict(zip(kinds, results))
        self.registry.update(areas=got.get("area_registry_updated"), devices=got.get("device_registry_updated"),
                             entities=got.get("entity_registry_updated"))
        for k in kinds:
            self.registry_reloads[k] = self.registry_reloads.get(k, 0) + 1
        log.info("registries loaded: %s", ", ".join(f"{k.split('_')[0]}={len(v)}" for k, v in got.items()))  # type: ignore[arg-type]

    async def _watch_registries(self) -> None:
        """Turn a burst of registry events into one reload of just the registries that changed."""
        while True:
            await self._reg_wake.wait()
            await asyncio.sleep(self.registry_debounce)
            self._reg_wake.clear()
            changed, self._reg_dirty = self._reg_dirty, set()
            if not changed:
                continue
            try:
                await self._load_registries(changed)
                if self.on_registry:
                    self.on_registry()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("registry reload failed: %s", exc)
                self._reg_dirty |= changed
                self._reg_wake.set()

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
        elif kind == "event" and mid in self._reg_subs:
            self._reg_dirty.add(self._reg_subs[mid])
            self._reg_wake.set()
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
