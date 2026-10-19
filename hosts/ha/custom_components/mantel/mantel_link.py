"""THE LINK TO MANTEL SERVER (linked mode; linked_mode.py is the Home Assistant
side, docs/phase5/LINKED-MODE.md in the Mantel repository the whole story).

ONE FILE, TWO INTEGRATIONS: this same file is HK Frontend's (hk_frontend) and
Mantel Link's (mantel). Each passes its own domain and protocol; Mantel Link
speaks protocol 2 (docs/phase9/MANTEL-LINK.md "Protocol 2") and adds the frame
types it handles. The two copies are kept identical by Mantel Link's tests.

One WebSocket to Mantel Server's linked endpoint (/linked/ws), authenticated by
a Service credential sent as `Authorization: Bearer` on the upgrade (never in
the address), and saying who is calling in `X-Mantel-Link: domain=...;
protocol=...; features=...` (Mantel answers a client that does not say, as
HK Frontend before 9.10 did not, with protocol 1). Over it:

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
import ipaddress
import itertools
import json
import logging
import re
import socket
from collections.abc import Awaitable, Callable
from typing import Any, Protocol
from urllib.parse import urlsplit, urlunsplit

import aiohttp

PROTOCOL = 1              # HK Frontend's; Mantel Link passes 2
PATH = "/linked/ws"
LINK_HEADER = "X-Mantel-Link"
TIMEOUT = 10.0            # a forwarded call's answer
HELLO_TIMEOUT = 10.0      # the first frame after connecting
BACKOFF = (1.0, 30.0)
MAX_MSG = 4 << 20

_LOGGER = logging.getLogger(__name__)
# whose link this is, for the log: "hk_frontend" or "mantel" (the package this
# file sits in), so one file serves both integrations
_WHO = __name__.split(".")[-2] if __name__.count(".") >= 1 else "mantel_link"


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


# ---- plain ws:// is accepted only inside this machine and the Supervisor's
# internal "hassio" Docker network, 172.30.32.0/23, which never leaves the host
# (the one private range the publish scan allows: tools/publish/publish.py)
HASSIO_NET = ipaddress.ip_network("172.30.32.0/23")
# an App's hostname on that network: `local-<slug>` or `<8 hex repo hash>-<slug>`
# (the Supervisor makes it from the slug, underscores becoming hyphens)
_APP_HOST = re.compile(r"^(?:local|[0-9a-f]{8})-[a-z0-9][a-z0-9_-]*$")

Resolver = Callable[[str, int], Awaitable[list[str]]]


def _ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        return None


def internal_ip(addr: str) -> bool:
    """Loopback, or inside 172.30.32.0/23."""
    ip = _ip(addr.split("%", 1)[0])
    if ip is None:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback or (ip.version == 4 and ip in HASSIO_NET)


def app_hostname(host: str) -> bool:
    return bool(_APP_HOST.match(host))


async def system_resolver(host: str, port: int) -> list[str]:
    """Every address the name resolves to (the loop's getaddrinfo: not blocking)."""
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(i[4][0] for i in infos))


async def plain_target(address: str, resolver: Resolver | None = None) -> tuple[str | None, list[str]]:
    """Is a plain ws:// target allowed? (error key or None, the addresses it
    resolved to, all inside the allowed range when the key is None).
    Allowed: loopback (127.0.0.1, ::1, localhost); an IP literal inside
    172.30.32.0/23; an App hostname (shape above) -- and a name only if EVERY
    address it resolves to is loopback or inside 172.30.32.0/23. A name is
    never accepted on its shape alone. Anything else: mantel_url_insecure; an
    allowed-shape name that does not resolve there: mantel_url_not_internal."""
    parts = urlsplit(ws_url(address))
    host = (parts.hostname or "").lower()
    if parts.scheme != "ws":
        return None, []
    port = parts.port or 80
    if _ip(host) is not None:
        return (None, [host]) if internal_ip(host) else ("mantel_url_insecure", [])
    if host != "localhost" and not app_hostname(host):
        return "mantel_url_insecure", []
    try:
        addrs = await (resolver or system_resolver)(host, port)
    except (OSError, UnicodeError):
        return "mantel_url_not_internal", []
    if not addrs or not all(internal_ip(a) for a in addrs):
        return "mantel_url_not_internal", list(addrs)
    return None, list(addrs)


class ProtocolMismatch(LinkError):
    """Mantel answered with another protocol (it is older than this integration)."""

    def __init__(self, message: str) -> None:
        super().__init__(message, "protocol")


class TargetRefused(LinkError):
    """A plain ws:// target that no longer resolves inside the allowed range."""

    def __init__(self, message: str) -> None:
        super().__init__(message, "mantel_url_not_internal")


class MantelLink:
    """The client. `run()` is the reconnect loop (a background task); `request()`
    forwards one call and waits for its answer."""

    def __init__(self, session: aiohttp.ClientSession, url: str, token: str, listener: Listener, *,
                 timeout: float = TIMEOUT, backoff: tuple[float, float] = BACKOFF,
                 hello_timeout: float = HELLO_TIMEOUT, resolver: Resolver | None = None,
                 domain: str = _WHO, protocol: int = PROTOCOL, features: tuple[str, ...] = (),
                 frames: dict[str, Callable[[dict[str, Any]], Any]] | None = None) -> None:
        self._session, self.url, self._token = session, ws_url(url), token
        # who is calling and how it speaks; `frames`: the server frame types
        # beyond protocol 1's this integration handles (each gets the frame)
        self.domain, self.protocol, self.features = domain, int(protocol), tuple(features)
        self.frames = dict(frames or {})
        self.hello: dict[str, Any] = {}       # the last hello, without its entities (instance, ...)
        self._resolver = resolver
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
            except TargetRefused as err:
                self.last_error = err.code
                _LOGGER.warning("%s: not connecting to %s: %s (retrying later)", _WHO, self.url, err.message)
            except ProtocolMismatch as err:
                _LOGGER.warning("%s: %s (at %s; retrying later)", _WHO, err.message, self.url)
            except aiohttp.WSServerHandshakeError as err:
                self.last_error = f"HTTP {err.status}"
                if err.status in (401, 403):
                    _LOGGER.warning("%s: Mantel Server at %s refused the link (HTTP %s): check the "
                                    "Service credential and that Home Assistant reaches it on the LAN door",
                                    _WHO, self.url, err.status)
                else:
                    _LOGGER.warning("%s: Mantel Server at %s answered HTTP %s", _WHO, self.url, err.status)
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError) as err:
                self.last_error = type(err).__name__
                _LOGGER.debug("%s: the link to Mantel Server failed: %r", _WHO, err)
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
        url, headers = self.url, {"Authorization": f"Bearer {self._token}",
                                  LINK_HEADER: f"domain={self.domain}; protocol={self.protocol}"
                                               + (f"; features={','.join(self.features)}" if self.features else "")}
        parts = urlsplit(url)
        if parts.scheme == "ws":
            # plain ws: re-resolve and check right now, then connect to the
            # address that was checked (the original Host header kept), so a
            # name that changes between check and connect cannot redirect it
            bad, addrs = await plain_target(url, self._resolver)
            if bad:
                raise TargetRefused(
                    "a plain ws:// address must be this machine or on Home Assistant's internal App network "
                    "(172.30.32.0/23), and its name no longer resolves there"
                    if bad == "mantel_url_not_internal" else "a plain ws:// address must be internal")
            ip = addrs[0].split("%", 1)[0]
            host = f"[{ip}]" if ":" in ip else ip
            url = urlunsplit(("ws", f"{host}:{parts.port}" if parts.port else host, parts.path, "", ""))
            headers["Host"] = parts.netloc
        try:
            async with self._session.ws_connect(url, headers=headers,
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
        if not isinstance(hello, dict) or hello.get("type") != "hello":
            raise ValueError(f"not a Mantel Server linked endpoint (protocol {self.protocol})")
        if hello.get("protocol") != self.protocol:
            # an older Mantel answers with the newest protocol it has
            self.last_error = f"protocol {hello.get('protocol')}"
            raise ProtocolMismatch(f"Mantel Server speaks protocol {hello.get('protocol')}, this needs "
                                   f"{self.protocol}: update Mantel")
        self.hello = {k: v for k, v in hello.items() if k != "entities"}
        self._ws = ws
        self.connected = True
        self.last_error = None
        _LOGGER.info("%s: linked to Mantel Server at %s", _WHO, self.url)
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
        elif isinstance(t, str) and t in self.frames:
            self._safe(self.frames[t], msg)
        else:
            _LOGGER.debug("%s: ignored a %r frame from Mantel Server", _WHO, t)

    @staticmethod
    def _safe(fn, *args) -> None:
        try:
            fn(*args)
        except Exception:  # noqa: BLE001 -- one bad entity never ends the link
            _LOGGER.exception("%s: a linked entity update failed", _WHO)

    def _drop(self, why: str) -> None:
        was = self.connected
        self.connected = False
        self._ws = None
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(NotConnected(why))
        self._pending.clear()
        if was:
            _LOGGER.warning("%s: %s; reconnecting", _WHO, why)
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


class _Probe:
    """The listener of a one-shot connection (probe): it only waits for hello."""

    def __init__(self) -> None:
        self.ready = asyncio.Event()

    def on_owners(self, owners: dict[str, Any]) -> None:
        pass

    def on_hello(self, entities: list[dict[str, Any]]) -> None:
        pass

    def on_entity(self, entity: dict[str, Any]) -> None:
        pass

    def on_state(self, unique_id: str, state: Any, attributes: dict[str, Any], available: bool) -> None:
        pass

    def on_removed(self, unique_id: str, forget: bool = True) -> None:
        pass

    def on_connected(self, connected: bool) -> None:
        if connected:
            self.ready.set()


async def probe(session: aiohttp.ClientSession, address: str, token: str, *, timeout: float = HELLO_TIMEOUT,
                resolver: Resolver | None = None, **how: Any) -> dict[str, Any]:
    """Connect once, read hello, hang up: hello without its entities (protocol,
    instance, owners, ...). For a setup form's test. LinkError with the code a
    form shows: invalid_auth (Mantel refused the credential), protocol (Mantel
    is older than this), mantel_url_not_internal, cannot_connect."""
    listener = _Probe()
    link = MantelLink(session, address, token, listener, hello_timeout=timeout, resolver=resolver, **how)
    task = asyncio.ensure_future(link._connect_once())
    waiter = asyncio.ensure_future(listener.ready.wait())
    try:
        done, _ = await asyncio.wait({task, waiter}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        if waiter in done:
            return dict(link.hello)
        if task in done:
            task.result()            # raises what went wrong
        raise LinkError("Mantel Server did not answer in time", "cannot_connect")
    except aiohttp.WSServerHandshakeError as err:
        if err.status in (401, 403):
            raise LinkError(f"Mantel Server refused the credential (HTTP {err.status})", "invalid_auth") from None
        raise LinkError(f"Mantel Server answered HTTP {err.status}", "cannot_connect") from None
    except (ProtocolMismatch, TargetRefused):
        raise
    except LinkError:
        raise
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError) as err:
        raise LinkError(f"could not reach Mantel Server ({type(err).__name__})", "cannot_connect") from None
    finally:
        waiter.cancel()
        await link.close()
        if not task.done():
            task.cancel()
        try:
            await task
        except BaseException:  # noqa: BLE001 -- the probe is over either way
            pass
