"""Read-only connection to Home Assistant's WebSocket API.

SAFETY: HaClient (the state connection) can only *send* the message types in ALLOWED_TYPES. There is
no way to call a service through it, under any setting. A test (tests/test_ha_client.py) pins that.

P3.3 adds the ONE command path, HaCommander (end of this file): its own connection, which exists
only when the server's operator set ``cfg.commands_enabled`` (config/CLI, never a client). It sends
a frame only with a one-shot CommandTicket bound to the audit row the gateway wrote first.

ALLOWED_TYPES is also what every other Mantel connection on this HA credential checks each frame
against before sending it: connectors/camera.py's signaling connection does, frame by frame.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
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
    "config/floor_registry/list",
    "subscribe_events",  # only for REGISTRY_EVENTS, enforced in check_outgoing
    "ping",
    # P3.4: camera WebRTC *viewing* signaling for HK's camera card (connectors/camera.py). Each may
    # carry exactly the keys in KEYED_TYPES; none of them changes anything in the house.
    "camera/webrtc/get_client_config",
    "camera/webrtc/offer",
    "camera/webrtc/candidate",
    "unsubscribe_events",  # ends a subscription the connection started; carries only `subscription`
})

# The keys (besides id/type) each signaling message may carry. HA's own schemas:
# homeassistant/components/camera/webrtc.py (ws_get_client_config, ws_webrtc_offer, ws_candidate).
SIGNALING_TYPES: dict[str, frozenset[str]] = {
    "camera/webrtc/get_client_config": frozenset({"entity_id"}),
    "camera/webrtc/offer": frozenset({"entity_id", "offer"}),
    "camera/webrtc/candidate": frozenset({"entity_id", "session_id", "candidate"}),
}
KEYED_TYPES: dict[str, frozenset[str]] = {**SIGNALING_TYPES, "unsubscribe_events": frozenset({"subscription"})}

# registry event -> the list call that reloads just that registry
REGISTRY_EVENTS = {
    "area_registry_updated": "config/area_registry/list",
    "device_registry_updated": "config/device_registry/list",
    "entity_registry_updated": "config/entity_registry/list",
    "floor_registry_updated": "config/floor_registry/list",
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
    keys = KEYED_TYPES.get(message["type"])
    if keys is not None:
        extra = set(message) - {"id", "type"} - keys
        if extra:
            raise CommandBlocked(f"{message['type']!r} may not carry {sorted(extra)}")
        if message["type"] in SIGNALING_TYPES and not str(message.get("entity_id", "")).startswith("camera."):
            raise CommandBlocked(f"{message['type']!r} is for camera entities only")


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
                except (CommandBlocked, TokenMissing) as exc:
                    log.error("HA client stopped: %s", exc)
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
                             entities=got.get("entity_registry_updated"), floors=got.get("floor_registry_updated"))
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


# ------------------------------------------------------------------------------ P3.3: the command path
# Everything below is reached only through gateway.py, after RBAC, step-up and the audit row.
CALL_SERVICE_KEYS = frozenset({"domain", "service", "service_data", "target", "return_response"})
HTTP_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_API_PATH = re.compile(r"^/api/[A-Za-z0-9_\-./]+(\?[A-Za-z0-9_\-.=&%:+,]*)?$")


class CommandsDisabled(CommandBlocked):
    """The command path was asked for while cfg.commands_enabled is off."""


class HaCommandError(Exception):
    """Home Assistant answered a command with an error (its code is kept, its text is not logged)."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code


class CommandTicket:
    """Minted by the gateway after the audit row is written; good for exactly one frame of `kind`."""
    __slots__ = ("audit_id", "kind", "used")

    def __init__(self, audit_id: int, kind: str) -> None:
        self.audit_id, self.kind, self.used = audit_id, kind, False


def _spend(ticket: object, kind: str) -> None:
    if not isinstance(ticket, CommandTicket) or ticket.used or ticket.kind != kind:
        raise CommandBlocked("a command needs its own unused ticket (the gateway mints one after the audit row)")
    if not isinstance(ticket.audit_id, int) or isinstance(ticket.audit_id, bool) or ticket.audit_id <= 0:
        raise CommandBlocked("a command ticket must name the audit row written for it")
    ticket.used = True


def check_command(frame: object, ticket: object, writes: frozenset[str]) -> None:
    """A WebSocket command frame: call_service with its own keys, or a write from hkClient.WRITES."""
    kind = frame.get("type") if isinstance(frame, dict) else None
    if kind not in writes:
        raise CommandBlocked(f"refusing to send {kind!r}: not in the write catalog (hkClient.WRITES)")
    if "id" in frame:  # type: ignore[operator]
        raise CommandBlocked("the command connection numbers its own frames")
    if kind == "call_service":
        extra = set(frame) - {"type"} - CALL_SERVICE_KEYS  # type: ignore[arg-type]
        if extra or not isinstance(frame.get("domain"), str) or not isinstance(frame.get("service"), str):  # type: ignore[union-attr]
            raise CommandBlocked("call_service carries domain, service, service_data, target, return_response only")
    _spend(ticket, "ws")


def check_http(method: object, path: object, ticket: object) -> None:
    if method not in HTTP_METHODS:
        raise CommandBlocked(f"HTTP writes are {sorted(HTTP_METHODS)}; got {method!r}")
    if not isinstance(path, str) or not _API_PATH.match(path) or ".." in path or "//" in path:
        raise CommandBlocked("an HTTP write goes to a plain /api/... path on Home Assistant")
    _spend(ticket, "http")


class HaCommander:
    """Mantel's command connection to Home Assistant (PLAN §4 "Command gateway").

    Built only when ``cfg.commands_enabled is True`` (``commander_for``); the constructor refuses
    otherwise. Its own WebSocket (the state connection's allowlist is untouched) and plain REST for
    HTTP writes, with Mantel's HA credential. Every frame passes ``check_command`` / ``check_http``
    and spends a ticket the gateway minted after writing the audit row.
    """

    def __init__(self, cfg, token: str, writes: frozenset[str], timeout: float = 30.0) -> None:
        if getattr(cfg, "commands_enabled", False) is not True:
            raise CommandsDisabled("commands are disabled on this server (commands_enabled is off)")
        self.base_url = cfg.ha_url.rstrip("/")
        self.ws_url = self.base_url.replace("http", "ws", 1) + "/api/websocket"
        self._token = token  # never logged
        self.writes = frozenset(writes)
        self.timeout = timeout
        self.sent: list[str] = []          # what was sent, in order (services / types / "POST /api/..."): tests, stats
        self._http: aiohttp.ClientSession | None = None
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._reader: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._next = 0
        self._pending: dict[int, asyncio.Future] = {}

    def __repr__(self) -> str:  # never the token
        return f"HaCommander({self.base_url!r}, sent={len(self.sent)})"

    async def _connect(self) -> aiohttp.ClientWebSocketResponse:
        async with self._lock:
            if self._ws is not None and not self._ws.closed:
                return self._ws
            self._http = self._http or aiohttp.ClientSession()
            ws = await self._http.ws_connect(self.ws_url, max_msg_size=0, heartbeat=30)
            first = await asyncio.wait_for(ws.receive_json(), self.timeout)
            if first.get("type") != "auth_required":
                await ws.close()
                raise RuntimeError("unexpected greeting from Home Assistant")
            await ws.send_json({"type": "auth", "access_token": self._token})
            if (await asyncio.wait_for(ws.receive_json(), self.timeout)).get("type") != "auth_ok":
                await ws.close()
                raise RuntimeError("Home Assistant rejected the token (auth_invalid)")
            self._ws = ws
            self._reader = asyncio.create_task(self._read(ws))
            return ws

    async def _read(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        try:
            async for m in ws:
                if m.type != aiohttp.WSMsgType.TEXT:
                    break
                data = json.loads(m.data)
                fut = self._pending.pop(data.get("id"), None) if data.get("type") == "result" else None
                if fut is not None and not fut.done():
                    if data.get("success"):
                        fut.set_result(data.get("result"))
                    else:
                        err = data.get("error") or {}
                        fut.set_exception(HaCommandError(str(err.get("code") or "error"), str(err.get("message") or "")))
        finally:
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(ConnectionError("Home Assistant connection closed"))
            self._pending.clear()
            if self._ws is ws:
                self._ws = None

    async def call(self, frame: dict, ticket: CommandTicket) -> object:
        """Send one WebSocket command frame (checked, ticketed) and return HA's result."""
        check_command(frame, ticket, self.writes)
        ws = await self._connect()
        self._next += 1
        mid = self._next
        fut = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        self.sent.append(f"{frame['domain']}.{frame['service']}" if frame["type"] == "call_service" else frame["type"])
        await ws.send_str(json.dumps({"id": mid, **frame}))
        try:
            return await asyncio.wait_for(fut, self.timeout)
        finally:
            self._pending.pop(mid, None)

    async def http(self, method: str, path: str, body: object, ticket: CommandTicket) -> object:
        """One authenticated HTTP write to HA's REST API (checked, ticketed)."""
        check_http(method, path, ticket)
        self._http = self._http or aiohttp.ClientSession()
        self.sent.append(f"{method} {path.split('?', 1)[0]}")
        async with self._http.request(method, self.base_url + path, json=body,
                                      headers={"Authorization": f"Bearer {self._token}"},
                                      timeout=aiohttp.ClientTimeout(total=self.timeout)) as r:
            text = await r.text()
            if r.status >= 400:
                raise HaCommandError(f"http_{r.status}", text[:200])
            try:
                return json.loads(text) if text else None
            except ValueError:
                return text[:2000]

    async def close(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
        if self._ws is not None:
            await self._ws.close()
        if self._http is not None:
            await self._http.close()


def commander_for(cfg, token: str, writes: frozenset[str]) -> HaCommander | None:
    """The command path, or None while commands are disabled (the default)."""
    if getattr(cfg, "commands_enabled", False) is not True:
        return None
    return HaCommander(cfg, token, writes)
