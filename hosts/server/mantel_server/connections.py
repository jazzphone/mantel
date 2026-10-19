"""Connections: Home Assistant and Music Assistant set up from the admin page, with no token files to handle.

docs/phase3/ADMIN-PAGE.md "Connections" is the person-facing description; this is the mechanism.

**Where a credential comes from** (``Connections.current``), in this order:

1. ``app``      HA App mode (``cfg.ha_managed_by_app``): Home Assistant is the Supervisor's own App credential.
                Shown as "Provided by Home Assistant (App)" and never edited here. Music Assistant is still
                editable in App mode.
2. ``mantel``   Mantel's own copy, saved on the Connections page: ``<data_dir>/connections/<kind>.connection``
                (folder 0700, file 0600), AES-GCM sealed with the at-rest key (``atrest.SecretBox``, associated
                data ``connection:<kind>``), inside every encrypted backup (backup.py). **It wins** over a file
                from the installation, so "Replace" on an installed connection writes Mantel's copy; "Disconnect"
                deletes Mantel's copy and the installation's file (if any) applies again.
3. ``install``  the installation's file (``--token-file`` with ``--ha-url``; ``--ma-token-file`` with ``--ma-url``),
                shown as "Set by the installation". It is never written or deleted here (in the container
                stacks it is a read-only mount); an empty file counts as absent (the LXC script creates empty
                placeholders).
4. nothing      "Not set up": the server runs anyway and the HA connection waits for a credential.

**Rules for the secret** (each pinned by tests/test_connections.py): a token is accepted from the page once,
tested live, sealed, and from then on is only ever *used*: never in a response, never in a log line, never in
an audit row, never in an exception message. Status says who Mantel is connected as and since when.

**Who.** Owner and Admin may read the status (not at a wall tablet). Only an Owner changes a connection. On
the ``lan`` door that is enough; on the ``tunnel`` door it needs a fresh factor (``step_up_required``, the
page's usual "confirm it is you"); through HA's sidebar (the ``ha`` door) HA's own sign-in counts when the
sidebar is trusted (``ha_door_rules: trusted``), a fresh factor otherwise. Every change is audited before it
applies (kind ``config``, ``connection.<kind>.saved|disconnected``, with the address and who Mantel connects
as, never the token); if the audit cannot be written nothing changes.

**Connect to Home Assistant** (HA's OAuth login, as for "Sign in with Home Assistant"): the Owner asks for
HA's authorize page (``POST /api/connections/ha/oauth/start``), signs in there **as the HA user Mantel should
act as** (a dedicated ``mantel-server`` administrator is recommended), and HA sends the browser back to
``/auth/connection/callback``. Mantel exchanges the code, tests the connection with that user's access token
and keeps the result as a *pending* connection for ten minutes (server memory only), then sends the browser to
``/settings?connection=<id>#/mantel/connections`` (Mantel Settings, Connections). Nothing is saved until the same Owner presses Save: Mantel then creates
a long-lived access token for that HA user (``auth/long_lived_access_token``, named ``Mantel Server (<date>)``),
checks it, seals it, and revokes the short OAuth refresh token. A pending connection that is cancelled or
expires has its refresh token revoked. Pasting a long-lived token instead works everywhere.

**Music Assistant** has its own accounts since 2.7: the Owner may type an MA user name and password once
(``auth/login``, then ``auth/token/create`` for a long-lived token named ``Mantel Server (<date>)``; the
password is used for that one exchange and kept nowhere), or paste a token made in MA's own settings.
MA's long-lived tokens expire a year after they are made; status shows the date.

**Hot apply.** After a save or disconnect the change is applied without a restart: ``Connections.appliers``
(server.py) retarget the existing HA objects in place (``HaClient``, ``ReadProxy``, ``HaCommander``, the HA user
directory, camera signaling, the OAuth client of "Sign in with Home Assistant"; camera stills and artwork
read the credential at each request) and build, retarget or remove the MA client. Each closes its socket and
reconnects at once with the new values; pages connected to Mantel keep their sockets and their last states.

**The test connections** are their own short sockets, separate from the hub's read-only connection and its
allowlist: to HA ``auth``, ``auth/current_user``, ``get_states`` (counted, then dropped) and, only when saving an
OAuth connection, ``auth/long_lived_access_token``; to MA ``auth`` (or ``auth/login`` + ``auth/token/create``).
"""
from __future__ import annotations

import asyncio
import contextlib
import html
import json
import logging
import os
import re
import secrets
import socket
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import urlencode, urlparse

import aiohttp
from aiohttp import web

from . import atrest
from .accounts import MANAGERS, STEP_UP_WINDOW, read_json
from .sessions import Identity, error, identity, ok

log = logging.getLogger("mantel.connections")

KINDS = ("ha", "ma")
LABEL = {"ha": "Home Assistant", "ma": "Music Assistant"}
FILE = "{kind}.connection"
FORMAT = 1
TIMEOUT = 15.0
PENDING_TTL = 600.0
MAX_TOKEN = 4096
MAX_URL = 300
CALLBACK = "/auth/connection/callback"
API = "/api/connections"
TOKEN_NAME = "Mantel Server ({stamp})"
HA_LLAT_DAYS = 3650
MA_TOKEN_DAYS = 365          # MA: long-lived tokens expire a year after they are made
PRINTABLE = re.compile(r"^[\x21-\x7e]+$")


class ConnectionFailed(Exception):
    """A test or exchange failed. ``code`` is stable; ``message`` is for people and never holds a secret."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# -- input checks ----------------------------------------------------------------------------------------
def clean_url(kind: str, raw: object) -> str:
    """An address as typed, checked: http(s) for HA, http(s) or ws(s) for MA; no user info, query or fragment."""
    if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > MAX_URL:
        raise ConnectionFailed("url_invalid", f"Type {LABEL.get(kind, kind)}'s address, for example "
                               + ("http://homeassistant.local:8123" if kind == "ha" else "http://music-assistant.local:8095"))
    url = raw.strip().rstrip("/")
    p = urlparse(url)
    schemes = ("http", "https") if kind == "ha" else ("http", "https", "ws", "wss")
    if p.scheme not in schemes or not p.hostname or p.username or p.password or p.query or p.fragment:
        raise ConnectionFailed("url_invalid", f"That is not an address Mantel can use. It should start with "
                               f"{' or '.join(s + '://' for s in schemes)} and name the host (and port).")
    try:
        p.port
    except ValueError:
        raise ConnectionFailed("url_invalid", "The port in that address is not a number from 1 to 65535.") from None
    return url


def clean_token(raw: object) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise ConnectionFailed("token_missing", "Paste the token.")
    token = raw.strip()
    if len(token) > MAX_TOKEN or not PRINTABLE.match(token):
        raise ConnectionFailed("token_invalid", "That does not look like a token (it has spaces or odd characters). "
                                                "Copy it again and paste it whole.")
    return token


def ha_ws_url(url: str) -> str:
    return url.rstrip("/").replace("http", "ws", 1) + "/api/websocket"


def ma_ws_url(url: str) -> str:
    from .connectors.ma import ws_url_of
    return ws_url_of(url)


def stamp(now: float) -> str:
    return datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _reach_error(kind: str, url: str, exc: BaseException) -> ConnectionFailed:
    """Plain words for a failure to reach the other end (never an exception's text that could echo input)."""
    label = LABEL[kind]
    if isinstance(exc, asyncio.TimeoutError):
        return ConnectionFailed("timeout", f"{label} at {url} did not answer within {int(TIMEOUT)} seconds. "
                                           "Check the address, and that Mantel's network can reach it.")
    if isinstance(exc, aiohttp.ClientConnectorCertificateError) or isinstance(exc, aiohttp.ClientSSLError):
        return ConnectionFailed("tls_failed", f"Mantel reached {url} but could not verify its certificate. "
                                              "Use the address the certificate is for, or http:// on the home network.")
    if isinstance(exc, aiohttp.WSServerHandshakeError):
        return ConnectionFailed("not_" + kind, f"Something answered at {url}, but it is not {label}'s API "
                                               f"(HTTP {exc.status}). Check the address and port.")
    if isinstance(exc, aiohttp.ClientConnectorError):
        return ConnectionFailed("unreachable", f"Mantel could not reach {label} at {url}. Check the address and port, "
                                               f"and that {label} is running.")
    return ConnectionFailed("failed", f"The connection to {label} at {url} failed ({type(exc).__name__}).")


# -- the live tests -------------------------------------------------------------------------------------------
async def _ws_json(ws, timeout: float = TIMEOUT) -> dict:
    msg = await asyncio.wait_for(ws.receive(), timeout)
    if msg.type != aiohttp.WSMsgType.TEXT:
        raise ConnectionError("closed")
    data = json.loads(msg.data)
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return data


async def _ha_result(ws, mid: int) -> dict:
    while True:
        msg = await _ws_json(ws)
        if msg.get("id") == mid and msg.get("type") == "result":
            return msg


async def ha_session(http: aiohttp.ClientSession, url: str, token: str,
                     body: Callable[[Any], Awaitable[dict]]) -> dict:
    """Open HA's WebSocket API with ``token`` and run ``body(ws)``; raise ConnectionFailed in plain words."""
    try:
        async with asyncio.timeout(TIMEOUT * 2), http.ws_connect(ha_ws_url(url), max_msg_size=0) as ws:
            try:
                first = await _ws_json(ws)
            except (ValueError, ConnectionError):
                raise ConnectionFailed("not_ha", f"Something answered at {url}, but it is not Home Assistant.") from None
            if first.get("type") != "auth_required":
                raise ConnectionFailed("not_ha", f"Something answered at {url}, but it is not Home Assistant.")
            await ws.send_json({"type": "auth", "access_token": token})
            reply = await _ws_json(ws)
            if reply.get("type") != "auth_ok":
                raise ConnectionFailed("token_refused", "Home Assistant did not accept the token. It may be mistyped, "
                                       "revoked, or made on a different Home Assistant.")
            out = await body(ws)
            out.setdefault("version", reply.get("ha_version"))
            return out
    except ConnectionFailed:
        raise
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ConnectionError, ValueError) as exc:
        raise _reach_error("ha", url, exc) from None


async def test_ha(http: aiohttp.ClientSession, url: str, token: str) -> dict:
    """{version, entities, user: {id, name, is_admin}}: Home Assistant answered, accepted the token, and said who."""
    async def body(ws) -> dict:
        await ws.send_json({"id": 1, "type": "auth/current_user"})
        me = await _ha_result(ws, 1)
        await ws.send_json({"id": 2, "type": "get_states"})
        states = await _ha_result(ws, 2)
        user = me.get("result") if me.get("success") and isinstance(me.get("result"), dict) else {}
        count = len(states["result"]) if states.get("success") and isinstance(states.get("result"), list) else None
        return {"entities": count, "user": {"id": user.get("id"), "name": user.get("name"),
                                            "is_admin": bool(user.get("is_admin"))}}
    return await ha_session(http, url, token, body)


async def ha_long_lived_token(http: aiohttp.ClientSession, url: str, access_token: str, name: str) -> str:
    """A long-lived access token for the access token's own HA user (HA's profile page does the same)."""
    async def body(ws) -> dict:
        await ws.send_json({"id": 1, "type": "auth/long_lived_access_token", "client_name": name,
                            "lifespan": HA_LLAT_DAYS})
        got = await _ha_result(ws, 1)
        if not got.get("success") or not isinstance(got.get("result"), str):
            raise ConnectionFailed("token_create_failed", "Home Assistant did not create a long-lived token for "
                                   "this user (" + str((got.get("error") or {}).get("code", "error")) + ").")
        return {"token": got["result"]}
    return (await ha_session(http, url, access_token, body))["token"]


async def _ma_open(http: aiohttp.ClientSession, url: str):
    ws = await http.ws_connect(ma_ws_url(url), max_msg_size=0)
    try:
        info = await _ws_json(ws)
    except (ValueError, ConnectionError):
        await ws.close()
        raise ConnectionFailed("not_ma", f"Something answered at {url}, but it is not Music Assistant.") from None
    if "server_version" not in info:
        await ws.close()
        raise ConnectionFailed("not_ma", f"Something answered at {url}, but it is not Music Assistant.")
    return ws, info


async def _ma_call(ws, mid: str, command: str, args: dict) -> dict:
    await ws.send_json({"message_id": mid, "command": command, "args": args})
    while True:
        msg = await _ws_json(ws)
        if msg.get("message_id") == mid and not msg.get("partial"):
            return msg


async def _ma_auth(ws, token: str) -> dict:
    got = await _ma_call(ws, "1", "auth", {"token": token})
    res = got.get("result")
    if not isinstance(res, dict) or res.get("authenticated") is not True:
        raise ConnectionFailed("token_refused", "Music Assistant did not accept the token. It may be mistyped, "
                               "revoked or expired (Music Assistant's tokens last a year).")
    return res.get("user") if isinstance(res.get("user"), dict) else {}


def _ma_user(user: dict) -> dict:
    return {"id": user.get("user_id") or user.get("id"), "name": user.get("display_name") or user.get("username"),
            "is_admin": user.get("role") == "admin" if "role" in user else None}


async def ma_run(http: aiohttp.ClientSession, url: str, body: Callable[[Any, dict], Awaitable[dict]]) -> dict:
    try:
        async with asyncio.timeout(TIMEOUT * 2):
            ws, info = await _ma_open(http, url)
            try:
                out = await body(ws, info)
            finally:
                await ws.close()
        out.setdefault("version", info.get("server_version"))
        out.setdefault("server_id", info.get("server_id"))
        return out
    except ConnectionFailed:
        raise
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ConnectionError, ValueError) as exc:
        raise _reach_error("ma", url, exc) from None


async def test_ma(http: aiohttp.ClientSession, url: str, token: str) -> dict:
    """{version, server_id, user}: Music Assistant answered and accepted the token."""
    async def body(ws, info) -> dict:
        return {"user": _ma_user(await _ma_auth(ws, token))}
    return await ma_run(http, url, body)


async def ma_login_token(http: aiohttp.ClientSession, url: str, username: str, password: str, name: str,
                         create: bool = True) -> dict:
    """MA's own sign-in (2.7+): auth/login, then (``create``) a long-lived token for that user. The password is
    sent once and kept nowhere. Returns {version, server_id, user, token?}."""
    async def body(ws, info) -> dict:
        got = await _ma_call(ws, "0", "auth/login", {"username": username, "password": password,
                                                       "device_name": name})
        res = got.get("result")
        if not isinstance(res, dict) or res.get("success") is not True or not isinstance(res.get("access_token"), str):
            if got.get("error_code") is not None and "auth/login" in str(got.get("details", "")):
                raise ConnectionFailed("login_unsupported", "This Music Assistant has no user sign-in (it is older "
                                       "than 2.7). Paste a token instead.")
            raise ConnectionFailed("login_refused", "Music Assistant did not accept that user name and password.")
        user = await _ma_auth(ws, res["access_token"])
        out: dict = {"user": _ma_user(user or res.get("user") or {})}
        if create:
            made = await _ma_call(ws, "2", "auth/token/create", {"name": name})
            if not isinstance(made.get("result"), str) or not made["result"]:
                raise ConnectionFailed("token_create_failed", "Music Assistant did not create a long-lived token for "
                                       "this user (guest accounts cannot have one).")
            out["token"] = made["result"]
        return out
    return await ma_run(http, url, body)


# -- storage ------------------------------------------------------------------------------------------------
@dataclass
class Record:
    """One saved connection (what a sealed file holds). ``repr`` never shows the token."""
    kind: str
    url: str
    token: str = field(repr=False)
    method: str                        # "token" (pasted) | "oauth" (HA sign-in) | "login" (MA sign-in)
    since: float
    user: dict | None = None           # who Mantel is connected as: {id, name, is_admin}
    by: str | None = None              # the Mantel user who saved it
    by_name: str | None = None
    version: str | None = None
    expires: float | None = None       # MA tokens: a year after they were made

    def public(self) -> dict:
        return {"url": self.url, "method": self.method, "since": self.since, "user": self.user, "by": self.by,
                "by_name": self.by_name, "version": self.version, "expires": self.expires}


class SealedFiles:
    """One sealed file per kind. ``record``: what a file holds (Record here; tablet_links.TabletRecord for a wall
    tablet's direct connection, kind ``tablet-<id>``), a dataclass with ``kind`` and the secret in ``token``."""

    def __init__(self, folder: Path, box: atrest.SecretBox, record: type = Record) -> None:
        self.folder = Path(folder).expanduser()
        self.box = box
        self.record = record

    def path(self, kind: str) -> Path:
        return self.folder / FILE.format(kind=kind)

    def load(self, kind: str) -> Record | None:
        p = self.path(kind)
        if not p.exists():
            return None
        data = json.loads(self.box.open(p.read_bytes(), f"connection:{kind}"))
        if data.get("format") != FORMAT or data.get("kind") != kind:
            raise ValueError("unknown connection file format")
        data.pop("format", None)
        return self.record(**data)

    def save(self, rec: Record) -> None:
        atrest.ensure_dir(self.folder)
        blob = json.dumps({"format": FORMAT, **rec.__dict__}, sort_keys=True).encode()
        sealed = self.box.seal(blob, f"connection:{rec.kind}")
        tmp = self.folder / f".{rec.kind}.{secrets.token_hex(4)}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(sealed)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path(rec.kind))
        finally:
            with contextlib.suppress(FileNotFoundError):
                tmp.unlink()

    def delete(self, kind: str) -> bool:
        try:
            self.path(kind).unlink()
            return True
        except FileNotFoundError:
            return False


def _read_file_token(path: Path | None) -> str:
    """An installation's token file: '' when missing or empty (the LXC script makes empty placeholders)."""
    if path is None:
        return ""
    try:
        return Path(path).expanduser().read_text().strip()
    except (OSError, UnicodeError):
        return ""


@dataclass
class Current:
    kind: str
    source: str                        # "app" | "mantel" | "install"
    url: str
    token: str = field(repr=False)
    record: Record | None = None


@dataclass
class Pending:
    id: str
    kind: str
    url: str
    starter: str
    expires: float
    state: str | None = None
    access: str | None = field(default=None, repr=False)
    refresh: str | None = field(default=None, repr=False)
    result: dict | None = None
    error: dict | None = None


Applier = Callable[[str, "Current | None"], Awaitable[None]]


class Connections:
    """The credentials Mantel uses for HA and MA, where each came from, and the hot apply."""

    def __init__(self, cfg, box: atrest.SecretBox, clock: Callable[[], float] = time.time,
                 install_ha_token: str | None = None) -> None:
        self.cfg = cfg
        self.clock = clock
        self.files = SealedFiles(cfg.connections_dir, box)
        self.app_mode = bool(getattr(cfg, "ha_managed_by_app", False))
        # what the installation provided, remembered before anything is overridden
        self.install_url = {"ha": getattr(cfg, "ha_url", "") or "", "ma": getattr(cfg, "ma_url", "") or ""}
        self.install_file = {"ha": getattr(cfg, "token_file", None), "ma": getattr(cfg, "ma_token_file", None)}
        self._install_ha = install_ha_token if install_ha_token is not None else _read_file_token(self.install_file["ha"])
        self.own: dict[str, Record | None] = {}
        self.unreadable: dict[str, str] = {}
        for kind in KINDS:
            self.own[kind] = None
            if kind == "ha" and self.app_mode:
                continue
            try:
                self.own[kind] = self.files.load(kind)
            except Exception as exc:  # noqa: BLE001 -- a key change or a damaged file: say so, keep running
                self.unreadable[kind] = type(exc).__name__
                log.error("connections: Mantel's saved %s connection could not be opened (%s); is this the same "
                          "at_rest.key it was saved with? Set it up again on the Connections page.",
                          LABEL[kind], type(exc).__name__)
        self.appliers: list[Applier] = []
        self.pending: dict[str, Pending] = {}
        self._lock = asyncio.Lock()

    # -- what is in effect -----------------------------------------------------------------------
    def install_token(self, kind: str) -> str:
        return self._install_ha if kind == "ha" else _read_file_token(self.install_file["ma"])

    def current(self, kind: str) -> Current | None:
        if kind == "ha" and self.app_mode:
            return Current("ha", "app", self.install_url["ha"], self._install_ha)
        rec = self.own.get(kind)
        if rec is not None:
            return Current(kind, "mantel", rec.url, rec.token, rec)
        url, token = self.install_url[kind], self.install_token(kind)
        if url and token:
            return Current(kind, "install", url, token)
        return None

    def ha_token(self) -> str:
        cur = self.current("ha")
        return cur.token if cur is not None else ""

    def ma_token(self) -> str:
        cur = self.current("ma")
        return cur.token if cur is not None else ""

    def effective_url(self, kind: str) -> str:
        cur = self.current(kind)
        return cur.url if cur is not None else ("" if kind == "ma" else self.install_url["ha"])

    # -- changes ---------------------------------------------------------------------------------
    async def _apply(self, kind: str) -> None:
        cur = self.current(kind)
        for fn in list(self.appliers):
            try:
                await fn(kind, cur)
            except Exception:  # noqa: BLE001 -- one consumer failing must not stop the others
                log.exception("connections: applying the new %s connection failed in one part", LABEL[kind])

    async def save(self, rec: Record) -> None:
        async with self._lock:
            self.files.save(rec)
            self.own[rec.kind] = rec
            self.unreadable.pop(rec.kind, None)
            await self._apply(rec.kind)

    async def disconnect(self, kind: str) -> bool:
        async with self._lock:
            had = self.files.delete(kind) or self.own.get(kind) is not None
            self.own[kind] = None
            self.unreadable.pop(kind, None)
            await self._apply(kind)
            return had

    # -- pending OAuth -------------------------------------------------------------------------------
    def prune(self, http: aiohttp.ClientSession | None = None) -> None:
        now = self.clock()
        for pid, p in list(self.pending.items()):
            if p.expires < now:
                self.drop_pending(pid, http)

    def drop_pending(self, pid: str, http: aiohttp.ClientSession | None = None) -> Pending | None:
        p = self.pending.pop(pid, None)
        if p is not None and p.refresh and http is not None:
            asyncio.get_running_loop().create_task(_revoke_quietly(http, p.url, p.refresh))
        return p


async def _revoke_quietly(http: aiohttp.ClientSession, url: str, refresh: str) -> None:
    """Revoke an OAuth refresh token Mantel no longer needs (HA's /auth/token action=revoke)."""
    try:
        async with http.post(f"{url.rstrip('/')}/auth/token", data={"token": refresh, "action": "revoke"},
                             timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as r:
            if r.status != 200:
                log.warning("connections: Home Assistant answered %s when revoking the sign-in token", r.status)
    except Exception as exc:  # noqa: BLE001
        log.warning("connections: could not revoke the Home Assistant sign-in token (%s)", type(exc).__name__)


# -- status --------------------------------------------------------------------------------------------------
def live_ha(app: web.Application) -> dict:
    hub = app.get("hub")
    ha = getattr(hub, "ha", None)
    since = getattr(ha, "connected_since", None)
    return {"connected": since is not None, "connected_since": since, "version": getattr(ha, "ha_version", None),
            "entities": len(hub.store.states) if hub is not None and since is not None else None,
            "error": getattr(ha, "last_error", None)}


def live_ma(app: web.Application) -> dict:
    client = app.get("ma")
    if client is None:
        return {"connected": False, "version": None, "error": None}
    info = client.server_info or {}
    return {"connected": client.connected.is_set(), "version": info.get("server_version"),
            "user": _ma_user(client.user) if isinstance(client.user, dict) else None, "error": None}


def status(app: web.Application, kind: str) -> dict:
    conns: Connections = app["connections"]
    cur = conns.current(kind)
    install_present = bool(conns.install_url[kind] and conns.install_token(kind))
    out = {
        "kind": kind, "label": LABEL[kind],
        "source": cur.source if cur is not None else None,
        "state": "not_set_up" if cur is None else "set",
        "url": cur.url if cur is not None else (conns.install_url[kind] or None),
        "editable": not (kind == "ha" and conns.app_mode),
        "install": {"present": install_present, "file": str(conns.install_file[kind] or "") or None,
                    "url": conns.install_url[kind] or None, "overridden": install_present and cur is not None
                    and cur.source == "mantel"},
        "saved": cur.record.public() if cur is not None and cur.record is not None else None,
        "unreadable": kind in conns.unreadable,
        "live": live_ha(app) if kind == "ha" else live_ma(app),
    }
    return out


# -- REST ----------------------------------------------------------------------------------------------------
def _viewer(request: web.Request) -> Identity:
    ident = identity(request)
    if ident.user is None or ident.device is not None:
        raise web.HTTPForbidden(text='{"error":"forbidden"}', content_type="application/json")
    if ident.user.role not in MANAGERS:
        raise web.HTTPForbidden(text='{"error":"forbidden"}', content_type="application/json")
    return ident


def edit_rule(request: web.Request, ident: Identity) -> str:
    """'ok' | 'fresh' (a fresh factor is needed first) | 'owner_only'."""
    if ident.user is None or ident.device is not None or ident.user.role != "owner":
        return "owner_only"
    if ident.door == "lan":
        return "ok"
    authz = request.app.get("authz")
    if ident.door == "ha" and authz is not None and authz.ha_trusted(ident):
        return "ok"
    return "ok" if ident.fresh_within(STEP_UP_WINDOW, request.app["clock"]()) else "fresh"


def _editor(request: web.Request) -> Identity:
    ident = _viewer(request)
    rule = edit_rule(request, ident)
    if rule == "owner_only":
        raise web.HTTPForbidden(text='{"error":"owner_only"}', content_type="application/json")
    if rule == "fresh":
        raise web.HTTPForbidden(text='{"error":"step_up_required"}', content_type="application/json")
    return ident


def _kind(request: web.Request) -> str:
    kind = request.match_info.get("kind", "")
    if kind not in KINDS:
        raise web.HTTPNotFound(text='{"error":"not_found"}', content_type="application/json")
    return kind


def _not_app(request: web.Request, kind: str) -> None:
    if kind == "ha" and request.app["connections"].app_mode:
        raise web.HTTPConflict(text=json.dumps({"error": "provided_by_app", "message":
                               "Home Assistant is provided by Home Assistant itself (Mantel runs as its App); "
                               "there is nothing to set up here."}), content_type="application/json")


def failed(exc: ConnectionFailed, status_code: int = 422) -> web.Response:
    return error(status_code, exc.code, message=exc.message)


# -- the Music Assistant App suggestion (App mode only) ---------------------------------------------------
# d5369777 is the official Music Assistant App repository's id, the same on every install; Supervisor's DNS
# resolves App hostnames (underscores become hyphens). Names only, never an IP: App addresses can change.
MA_APP_CANDIDATES = ("http://d5369777-music-assistant:8095", "http://d5369777-music-assistant-beta:8095",
                     "http://d5369777-music-assistant-nightly:8095")
MA_PROBE_TIMEOUT = 2.0
MA_SUGGEST_TTL = 300.0


class MaSuggester:
    """Finds Music Assistant's App by its well-known hostnames: resolve the name, then GET MA's unauthenticated
    /info, no credentials, short timeout. The answer (found or not) is cached for a few minutes."""

    def __init__(self, clock: Callable[[], float] = time.time, resolve=None, fetch=None) -> None:
        self.clock = clock
        self._resolve = resolve or self._real_resolve
        self._fetch = fetch or self._real_fetch
        self._cache: tuple[float, str | None] | None = None
        self.probes = 0

    @staticmethod
    async def _real_resolve(host: str) -> bool:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
        return bool(infos)

    @staticmethod
    async def _real_fetch(http: aiohttp.ClientSession, url: str) -> object:
        async with http.get(url + "/info", allow_redirects=False,
                            timeout=aiohttp.ClientTimeout(total=MA_PROBE_TIMEOUT)) as r:
            if r.status != 200:
                return None
            return await r.json(content_type=None)

    async def find(self, http: aiohttp.ClientSession) -> str | None:
        now = self.clock()
        if self._cache is not None and now - self._cache[0] < MA_SUGGEST_TTL:
            return self._cache[1]
        found = None
        for url in MA_APP_CANDIDATES:
            self.probes += 1
            try:
                async with asyncio.timeout(MA_PROBE_TIMEOUT):
                    if not await self._resolve(urlparse(url).hostname):
                        continue
                    info = await self._fetch(http, url)
            except (OSError, asyncio.TimeoutError, aiohttp.ClientError, ValueError):
                continue
            if isinstance(info, dict) and info.get("server_id") and info.get("server_version"):
                found = url
                break
        self._cache = (now, found)
        return found


async def api_status(request: web.Request) -> web.Response:
    ident = _viewer(request)
    rule = edit_rule(request, ident)
    conns: Connections = request.app["connections"]
    out = {k: status(request.app, k) for k in KINDS}
    if conns.app_mode and out["ma"]["state"] == "not_set_up":
        found = await request.app["ma_suggester"].find(request.app["http"])
        if found:
            out["ma"]["suggested_url"] = found
            out["ma"]["suggested_from"] = "music_assistant_app"
    return ok({"connections": out, "can_edit": rule != "owner_only",
               "needs_fresh": rule == "fresh", "door": ident.door})


async def _test(request: web.Request, kind: str, body: dict, create: bool) -> tuple[str, str | None, dict, str]:
    """(url, token-or-None, result, method) from a request body, tested live. ``create``: when signing in to MA,
    make the long-lived token now (a save), not only test the sign-in."""
    http: aiohttp.ClientSession = request.app["http"]
    url = clean_url(kind, body.get("url"))
    if kind == "ma" and (body.get("username") or body.get("password")):
        user, pw = body.get("username"), body.get("password")
        if not isinstance(user, str) or not user.strip() or not isinstance(pw, str) or not pw:
            raise ConnectionFailed("login_missing", "Type Music Assistant's user name and password.")
        name = TOKEN_NAME.format(stamp=stamp(request.app["clock"]()))
        got = await ma_login_token(http, url, user.strip()[:200], pw[:1024], name, create=create)
        token = got.pop("token", None)
        if create:
            got = await test_ma(http, url, token)     # the new token itself works
        return url, token, got, "login"
    token = clean_token(body.get("token"))
    result = await (test_ha(http, url, token) if kind == "ha" else test_ma(http, url, token))
    return url, token, result, "token"


def _warnings(kind: str, result: dict) -> list[str]:
    out = []
    user = result.get("user") or {}
    if kind == "ha" and user and not user.get("is_admin"):
        out.append("This Home Assistant user is not an administrator. Mantel works, but importing HK's settings "
                   "and listing Home Assistant's users need an administrator.")
    if kind == "ha" and result.get("entities") == 0:
        out.append("Home Assistant answered but has no entities.")
    return out


async def api_test(request: web.Request) -> web.Response:
    kind = _kind(request)
    _editor(request)
    _not_app(request, kind)
    body = await read_json(request)
    try:
        _, _, result, method = await _test(request, kind, body, create=False)
    except ConnectionFailed as exc:
        return failed(exc)
    return ok({"result": result, "method": method, "warnings": _warnings(kind, result)})


def _audit(request: web.Request, ident: Identity, action: str, detail: dict) -> web.Response | None:
    audit = request.app.get("audit")
    if audit is None:
        return None
    try:
        audit.config_event({"actor": ident.user.id, "role": ident.user.role, "action": action, "detail": detail,
                            "timestamp": request.app["clock"]()})
    except Exception:  # noqa: BLE001
        log.exception("connections: the audit row could not be written; nothing was changed")
        return error(503, "audit_unavailable")
    return None


def _audit_detail(rec: Record, previous: Current | None) -> dict:
    return {"url": rec.url, "method": rec.method, "as": (rec.user or {}).get("name"),
            "replaces": previous.source if previous is not None else None}


async def _store(request: web.Request, ident: Identity, rec: Record) -> web.Response:
    conns: Connections = request.app["connections"]
    previous = conns.current(rec.kind)
    refused = _audit(request, ident, f"connection.{rec.kind}.saved", _audit_detail(rec, previous))
    if refused is not None:
        return refused
    try:
        await conns.save(rec)
    except (OSError, atrest.SecretKeyError) as exc:
        log.error("connections: could not save the %s connection (%s)", LABEL[rec.kind], type(exc).__name__)
        return error(500, "save_failed", message="Mantel could not write its secret file. Check that the data "
                     "folder is writable and the at-rest key is readable.")
    log.info("connections: %s connection saved by %s (%s, %s)", LABEL[rec.kind], ident.user.name or ident.user.id,
             rec.url, rec.method)
    return ok({"connection": status(request.app, rec.kind)})


async def api_save(request: web.Request) -> web.Response:
    kind = _kind(request)
    ident = _editor(request)
    _not_app(request, kind)
    body = await read_json(request)
    conns: Connections = request.app["connections"]
    now = request.app["clock"]()
    if kind == "ha" and body.get("pending"):
        return await _save_pending(request, ident, str(body["pending"]))
    try:
        url, token, result, method = await _test(request, kind, body, create=True)
    except ConnectionFailed as exc:
        return failed(exc)
    rec = Record(kind=kind, url=url, token=token or "", method=method, since=now, user=result.get("user"),
                 by=ident.user.id, by_name=ident.user.name or ident.user.username,
                 version=result.get("version"), expires=(now + MA_TOKEN_DAYS * 86400) if method == "login" else None)
    del token
    conns.prune(request.app["http"])
    return await _store(request, ident, rec)


async def api_disconnect(request: web.Request) -> web.Response:
    kind = _kind(request)
    ident = _editor(request)
    _not_app(request, kind)
    conns: Connections = request.app["connections"]
    if conns.own.get(kind) is None and kind not in conns.unreadable:
        cur = conns.current(kind)
        if cur is not None and cur.source == "install":
            return error(409, "set_by_installation", message="This connection comes from the installation's "
                         f"secret file ({conns.install_file[kind]}). Replace it here, or remove that file and "
                         "restart Mantel.")
        return error(404, "not_found")
    rec = conns.own.get(kind)
    refused = _audit(request, ident, f"connection.{kind}.disconnected",
                     {"url": rec.url if rec else None, "as": ((rec.user or {}).get("name") if rec else None)})
    if refused is not None:
        return refused
    await conns.disconnect(kind)
    log.info("connections: Mantel's %s connection removed by %s", LABEL[kind], ident.user.name or ident.user.id)
    return ok({"connection": status(request.app, kind)})


# -- Connect to Home Assistant (OAuth) --------------------------------------------------------------------
def redirect_uri(cfg) -> str:
    return cfg.base_url + CALLBACK.lstrip("/")


async def api_oauth_start(request: web.Request) -> web.Response:
    ident = _editor(request)
    _not_app(request, "ha")
    body = await read_json(request)
    conns: Connections = request.app["connections"]
    try:
        url = clean_url("ha", body.get("url"))
    except ConnectionFailed as exc:
        return failed(exc)
    conns.prune(request.app["http"])
    cfg = request.app["cfg"]
    pid, state = secrets.token_urlsafe(18), secrets.token_urlsafe(24)
    conns.pending[pid] = Pending(id=pid, kind="ha", url=url, starter=ident.user.id, state=state,
                                 expires=request.app["clock"]() + PENDING_TTL)
    q = urlencode({"client_id": cfg.client_id, "redirect_uri": redirect_uri(cfg), "state": state})
    return ok({"authorize_url": f"{url}/auth/authorize?{q}", "pending": pid, "expires": conns.pending[pid].expires})


def _page(title: str, body: str, status_code: int = 200) -> web.Response:
    from .auth import page
    return page(title, body, status_code)


async def oauth_callback(request: web.Request) -> web.StreamResponse:
    """HA sends the browser back here (public: SameSite=Strict session cookies are not sent on that hop).
    The state names a pending connection an Owner started; nothing is saved here."""
    app = request.app
    conns: Connections = app["connections"]
    http: aiohttp.ClientSession = app["http"]
    conns.prune(http)
    state = request.query.get("state", "")
    p = next((x for x in conns.pending.values() if x.state and state and secrets.compare_digest(x.state, state)), None)
    if p is None:
        return _page("Connection not started here", "<p>This sign-in did not start on Mantel's Connections page, "
                     "or took longer than ten minutes. <a href='/settings#/mantel/connections'>Start again</a>.</p>", 400)
    p.state = None                                         # single use
    back = f"{app['cfg'].base_url}settings?connection={p.id}#/mantel/connections"
    code = request.query.get("code")
    if request.query.get("error") or not code:
        conns.drop_pending(p.id, http)
        return _page("Sign-in cancelled", f"<p><a href='{html.escape(back, quote=True)}'>Back to Connections</a>.</p>", 400)
    cfg = app["cfg"]
    try:
        try:
            async with http.post(f"{p.url}/auth/token", data={"grant_type": "authorization_code", "code": code,
                                                              "client_id": cfg.client_id},
                                 timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as r:
                tokens = await r.json(content_type=None)
            if r.status != 200 or not isinstance(tokens, dict) or not tokens.get("access_token"):
                raise ConnectionFailed("oauth_failed", "Home Assistant did not complete the sign-in (the code was "
                                                       "refused). Start again.")
        except ConnectionFailed:
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError) as exc:
            raise _reach_error("ha", p.url, exc) from None
        p.access, p.refresh = tokens["access_token"], tokens.get("refresh_token")
        p.result = await test_ha(http, p.url, p.access)
    except ConnectionFailed as exc:
        p.error = {"code": exc.code, "message": exc.message}
        if p.refresh:
            asyncio.get_running_loop().create_task(_revoke_quietly(http, p.url, p.refresh))
        p.access = p.refresh = None
    dest = html.escape(back, quote=True)
    return _page("Back to Mantel", f"<meta http-equiv='refresh' content='0;url={dest}'>"
                 f"<p><a href='{dest}'>Back to Mantel's Connections page</a>.</p>")


def _pending_of(request: web.Request, ident: Identity, pid: str) -> Pending | None:
    conns: Connections = request.app["connections"]
    conns.prune(request.app["http"])
    p = conns.pending.get(pid)
    if p is None or p.starter != ident.user.id:
        return None
    return p


async def api_pending(request: web.Request) -> web.Response:
    ident = _viewer(request)
    p = _pending_of(request, ident, request.match_info["pid"])
    if p is None:
        return error(404, "not_found", message="That sign-in is no longer waiting (ten minutes passed, or it was "
                                                "saved or cancelled). Start again.")
    state = "error" if p.error else "ready" if p.result else "waiting"
    return ok({"pending": {"id": p.id, "kind": p.kind, "url": p.url, "state": state, "result": p.result,
                           "error": p.error, "expires": p.expires,
                           "warnings": _warnings("ha", p.result) if p.result else []}})


async def api_pending_cancel(request: web.Request) -> web.Response:
    ident = _viewer(request)
    p = _pending_of(request, ident, request.match_info["pid"])
    if p is None:
        return error(404, "not_found")
    request.app["connections"].drop_pending(p.id, request.app["http"])
    return ok()


async def _save_pending(request: web.Request, ident: Identity, pid: str) -> web.Response:
    conns: Connections = request.app["connections"]
    http: aiohttp.ClientSession = request.app["http"]
    p = _pending_of(request, ident, pid)
    if p is None or not p.result or not p.access:
        return error(404, "not_found", message="That sign-in is no longer waiting. Start again.")
    now = request.app["clock"]()
    try:
        token = await ha_long_lived_token(http, p.url, p.access, TOKEN_NAME.format(stamp=stamp(now)))
        result = await test_ha(http, p.url, token)
    except ConnectionFailed as exc:
        return failed(exc)
    conns.drop_pending(p.id, http)                       # revokes the short OAuth refresh token
    rec = Record(kind="ha", url=p.url, token=token, method="oauth", since=now, user=result.get("user"),
                 by=ident.user.id, by_name=ident.user.name or ident.user.username, version=result.get("version"))
    del token
    return await _store(request, ident, rec)


def register(app: web.Application, conns: Connections) -> None:
    app["connections"] = conns
    app["ma_suggester"] = MaSuggester(lambda: app["clock"]())
    app.setdefault("public_paths", set()).add(CALLBACK)
    r = app.router
    r.add_get(API, api_status)
    r.add_get(API + "/pending/{pid}", api_pending)
    r.add_delete(API + "/pending/{pid}", api_pending_cancel)
    r.add_post(API + "/ha/oauth/start", api_oauth_start)
    r.add_post(API + "/{kind}/test", api_test)
    r.add_post(API + "/{kind}", api_save)
    r.add_delete(API + "/{kind}", api_disconnect)
    r.add_get(CALLBACK, oauth_callback)

    async def cleanup(app: web.Application) -> None:
        for pid in list(conns.pending):
            conns.drop_pending(pid, None)
    app.on_cleanup.append(cleanup)
