"""THE LINK TO MANTEL SERVER (linked mode; linked_mode.py is the Home Assistant
side, docs/phase5/LINKED-MODE.md in the Mantel repository the whole story).

One WebSocket to Mantel Server's linked endpoint (/linked/ws), authenticated by
a Service credential sent as `Authorization: Bearer` on the upgrade (never in
the address). Over it:

    Mantel -> here   hello {protocol, entities, owners}   every entity, on connect
                     entity {entity}               one added or replaced
                     state {unique_id, state, attributes, available}
                     removed {unique_id, forget?}  forget: false = only no
                                                   longer Mantel's (kept in
                                                   the registry)
                     owners {owners}               who owns which tablet
                                                   (linked_mode.py)
                     result {id, success, result | error {code, message}}
    here -> Mantel   call_service {id, service, data, targets}
                     entity_command {id, unique_id, command, data}
                     ping {id}

Anything else Mantel sends is ignored: nothing it says can make this side call
a Home Assistant service (the listener only changes the mirrored entities).

Requests are answered by id; one not answered in `timeout` seconds fails with
LinkTimeout, and every request in flight fails with NotConnected the moment the
socket drops, so a service call never hangs. The link reconnects by itself:
1 s, doubling to 30 s between tries, back to 1 s after a connection that got as
far as hello. A refused credential (401/403) keeps retrying at that pace too --
the fix is in Configure, which reloads the entry anyway. The credential is never
logged.

No Home Assistant import here (aiohttp only), so it is tested on its own.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
from typing import Any, Protocol
from urllib.parse import urlsplit, urlunsplit

import aiohttp

PROTOCOL = 1
PATH = "/linked/ws"
TIMEOUT = 10.0            # a forwarded call's answer
HELLO_TIMEOUT = 10.0      # the first frame after connecting
BACKOFF = (1.0, 30.0)
MAX_MSG = 4 << 20

_LOGGER = logging.getLogger(__name__)


class LinkError(Exception):
    """A forwarded request did not get an answer it can use."""

    def __init__(self, message: str, code: str = "link_error") -> None:
        super().__init__(message)
        self.message, self.code = message, code


class NotConnected(LinkError):
    def __init__(self, message: str = "Mantel Server is not connected") -> None:
        super().__init__(message, "not_connected")


class LinkTimeout(LinkError):
    def __init__(self, message: str) -> None:
        super().__init__(message, "timeout")


class Refused(LinkError):
    """Mantel Server answered with an error (its code and message)."""


class Listener(Protocol):
    def on_owners(self, owners: dict[str, Any]) -> None: ...
    def on_hello(self, entities: list[dict[str, Any]]) -> None: ...
    def on_entity(self, entity: dict[str, Any]) -> None: ...
    def on_state(self, unique_id: str, state: Any, attributes: dict[str, Any], available: bool) -> None: ...
    def on_removed(self, unique_id: str, forget: bool = True) -> None: ...
    def on_connected(self, connected: bool) -> None: ...


def ws_url(address: str) -> str:
    """Mantel Server's address as the link's WebSocket URL. http(s)://host[:port]
    or ws(s)://host[:port], with no path meaning /linked/ws. No user, query or
    fragment (the credential goes in a header, never in the address)."""
    parts = urlsplit(str(address or "").strip())
    scheme = {"http": "ws", "https": "wss", "ws": "ws", "wss": "wss"}.get(parts.scheme.lower())
    if not scheme or not parts.hostname:
        raise ValueError("an http(s):// or ws(s):// address with a host")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("no user, query or fragment in the address")
    return urlunsplit((scheme, parts.netloc, parts.path.rstrip("/") or PATH, "", ""))


class MantelLink:
    """The client. `run()` is the reconnect loop (a background task); `request()`
    forwards one call and waits for its answer."""

    def __init__(self, session: aiohttp.ClientSession, url: str, token: str, listener: Listener, *,
                 timeout: float = TIMEOUT, backoff: tuple[float, float] = BACKOFF,
                 hello_timeout: float = HELLO_TIMEOUT) -> None:
        self._session, self.url, self._token = session, ws_url(url), token
        self.listener = listener
        self.timeout, self.backoff, self.hello_timeout = timeout, backoff, hello_timeout
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._pending: dict[int, asyncio.Future] = {}
        self._ids = itertools.count(1)
        self._closing = False
        self.connected = False
        self.attempts = 0             # connection attempts so far (the tests read it)
        self.last_error: str | None = None

    def __repr__(self) -> str:        # never the token
        return f"MantelLink({self.url!r}, connected={self.connected})"

    # ---- the loop
    async def run(self) -> None:
        delay = self.backoff[0]
        while not self._closing:
            reached = False
            try:
                reached = await self._connect_once()
            except asyncio.CancelledError:
                self._drop("the link was stopped")
                raise
            except aiohttp.WSServerHandshakeError as err:
                self.last_error = f"HTTP {err.status}"
                if err.status in (401, 403):
                    _LOGGER.warning("hk_frontend: Mantel Server at %s refused the link (HTTP %s): check the "
                                    "Service credential and that Home Assistant reaches it on the LAN door",
                                    self.url, err.status)
                else:
                    _LOGGER.warning("hk_frontend: Mantel Server at %s answered HTTP %s", self.url, err.status)
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError) as err:
                self.last_error = type(err).__name__
                _LOGGER.debug("hk_frontend: the link to Mantel Server failed: %r", err)
            finally:
                if not self._closing:
                    self._drop("the link to Mantel Server dropped")
            if self._closing:
                break
            if reached:
                delay = self.backoff[0]
            await asyncio.sleep(delay)
            delay = min(delay * 2, self.backoff[1])

    async def _connect_once(self) -> bool:
        """One connection, until it ends. True if it got as far as hello."""
        self.attempts += 1
        opened: list[aiohttp.ClientWebSocketResponse] = []
        try:
            async with self._session.ws_connect(self.url, headers={"Authorization": f"Bearer {self._token}"},
                                                heartbeat=30, max_msg_size=MAX_MSG) as ws:
                opened.append(ws)
                return await self._serve(ws)
        finally:
            # aiohttp re-arms a socket's heartbeat timer when a frame (the
            # server's own close) arrives while it is closing, leaving a 30 s
            # timer behind a closed link: switch its heartbeat off for good
            for ws in opened:
                if hasattr(ws, "_heartbeat"):
                    ws._heartbeat = None
                cancel = getattr(ws, "_cancel_heartbeat", None)
                if callable(cancel):
                    cancel()

    async def _serve(self, ws: aiohttp.ClientWebSocketResponse) -> bool:
        """One connection's life: hello, then every frame until it ends."""
        first = await ws.receive(timeout=self.hello_timeout)
        hello = json.loads(first.data) if first.type == aiohttp.WSMsgType.TEXT else None
        if not isinstance(hello, dict) or hello.get("type") != "hello" or hello.get("protocol") != PROTOCOL:
            raise ValueError("not a Mantel Server linked endpoint (protocol 1)")
        self._ws = ws
        self.connected = True
        self.last_error = None
        _LOGGER.info("hk_frontend: linked to Mantel Server at %s", self.url)
        # who owns which tablet first: the entities are taken by it
        if isinstance(hello.get("owners"), dict):
            self._safe(self.listener.on_owners, hello["owners"])
        self._safe(self.listener.on_hello, list(hello.get("entities") or []))
        self._safe(self.listener.on_connected, True)
        async for frame in ws:
            if frame.type == aiohttp.WSMsgType.TEXT:
                try:
                    msg = json.loads(frame.data)
                except ValueError:
                    continue
                if isinstance(msg, dict):
                    self._dispatch(msg)
            elif frame.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSE):
                break
        return True

    def _dispatch(self, msg: dict[str, Any]) -> None:
        t = msg.get("type")
        if t == "result":
            fut = self._pending.pop(msg.get("id"), None) if isinstance(msg.get("id"), int) else None
            if fut is not None and not fut.done():
                fut.set_result(msg)
        elif t == "entity" and isinstance(msg.get("entity"), dict):
            self._safe(self.listener.on_entity, msg["entity"])
        elif t == "state" and isinstance(msg.get("unique_id"), str):
            attrs = msg.get("attributes")
            self._safe(self.listener.on_state, msg["unique_id"], msg.get("state"),
                       attrs if isinstance(attrs, dict) else {}, bool(msg.get("available", True)))
        elif t == "removed" and isinstance(msg.get("unique_id"), str):
            self._safe(self.listener.on_removed, msg["unique_id"], msg.get("forget") is not False)
        elif t == "owners" and isinstance(msg.get("owners"), dict):
            self._safe(self.listener.on_owners, msg["owners"])
        else:
            _LOGGER.debug("hk_frontend: ignored a %r frame from Mantel Server", t)

    @staticmethod
    def _safe(fn, *args) -> None:
        try:
            fn(*args)
        except Exception:  # noqa: BLE001 -- one bad entity never ends the link
            _LOGGER.exception("hk_frontend: a linked entity update failed")

    def _drop(self, why: str) -> None:
        was = self.connected
        self.connected = False
        self._ws = None
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(NotConnected(why))
        self._pending.clear()
        if was:
            _LOGGER.warning("hk_frontend: %s; reconnecting", why)
            self._safe(self.listener.on_connected, False)

    # ---- requests
    async def request(self, type_: str, payload: dict[str, Any], timeout: float | None = None) -> Any:
        ws = self._ws
        if not self.connected or ws is None:
            raise NotConnected()
        timeout = self.timeout if timeout is None else timeout
        mid = next(self._ids)
        fut = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        try:
            await ws.send_str(json.dumps({"id": mid, "type": type_, **payload}))
            msg = await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise LinkTimeout(f"Mantel Server did not answer within {timeout:g} s") from None
        except (ConnectionError, RuntimeError, aiohttp.ClientError) as err:
            raise NotConnected(f"the link to Mantel Server dropped ({type(err).__name__})") from None
        finally:
            self._pending.pop(mid, None)
        if msg.get("success"):
            return msg.get("result")
        err = msg.get("error") if isinstance(msg.get("error"), dict) else {}
        raise Refused(str(err.get("message") or "refused"), str(err.get("code") or "refused"))

    async def close(self) -> None:
        self._closing = True
        ws = self._ws
        self._drop("the link was stopped")
        if ws is not None and not ws.closed:
            await ws.close()
