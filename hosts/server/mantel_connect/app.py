"""The Mantel Connect App: HA's sidebar (Ingress) in front of a Mantel Server running elsewhere.

It is a reverse proxy to ONE address, over mutual TLS with the certificate pairing gave it. It decides
nothing about who a person is or what they may do: it passes on what Home Assistant's Supervisor said
(``X-Remote-User-Id`` and friends, ``X-Ingress-Path``, the forwarded address chain) and Mantel's
ingress.py believes those headers only from a paired App, exactly as it does from the Supervisor in the
Mantel App. So the trust rules (linked users only, the 'ha' door, the first-Owner bootstrap) live in one
place, Mantel.

* **Who may talk to the App**: only the Supervisor's Ingress proxy (the socket peer, never a header).
  ``/healthz`` answers anyone with a bare "ok" and nothing else.
* **What it sends on**: freshly built headers from a short allow-list. Never the browser's own
  ``X-Remote-User-*``, ``X-Mantel-*``, ``Authorization`` or hop headers; cookies and the CSRF header go
  through, because they are Mantel's own session for that person.
* **Where it sends it**: the one host and port from its configuration, never one a request names.
* **Secrets**: the key, certificate and CA are files in the App's data folder (mode 0600); nothing secret
  is in the environment, in a log, or on a status page. Access logs are off (they hold the Ingress URL).
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import time
from pathlib import Path

import aiohttp
from aiohttp import web
from multidict import CIMultiDict

from . import pairing, pki, protocol

log = logging.getLogger("mantel.connect.app")

SUPERVISOR = "172.30.32.2"
STATUS = "/__mantel_connect/status"
USER_ID, USER_NAME, USER_DISPLAY = "X-Remote-User-Id", "X-Remote-User-Name", "X-Remote-User-Display-Name"
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
FORWARD = ("Accept", "Accept-Encoding", "Accept-Language", "Cache-Control", "Content-Type", "Cookie", "If-Match",
           "If-Modified-Since", "If-None-Match", "If-Range", "Origin", "Pragma", "Range", "Referer", "User-Agent",
           "Sec-Fetch-Dest", "Sec-Fetch-Mode", "Sec-Fetch-Site", "Sec-Fetch-User", "X-CSRF-Token",
           "X-Requested-With", "X-Ingress-Path", "X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Host")
HOP = frozenset(h.lower() for h in ("Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "TE",
                                    "Trailer", "Transfer-Encoding", "Upgrade", "Server", "Date"))
CHUNK = 65536
PING_EVERY = 60.0
RENEW_CHECK_EVERY = 6 * 3600.0
PAGE_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"}


def read_options(path: Path) -> dict:
    try:
        data = json.loads(Path(path).read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


class Link:
    """The App's state: the pairing on disk, the live mutual-TLS session, and what the last check found."""

    def __init__(self, folder: Path, options: dict, clock=time.time) -> None:
        self.files = pairing.Files(folder)
        self.options = options
        self.clock = clock
        self.host = self.port = None
        self.session: aiohttp.ClientSession | None = None
        self.state = "unpaired"          # unpaired | ok | unreachable | revoked
        self.detail = ""                 # safe to show: never a code, address or certificate
        self.checked: float | None = None
        self.last_state = None

    # -- the pairing -------------------------------------------------------------------------------------
    def address(self) -> tuple[str, int] | None:
        """The option wins (the address may move; certificates do not care), then the paired one."""
        for text in (self.options.get("mantel_address"), (self.files.read_info() or {}).get("address")):
            if text:
                try:
                    return protocol.parse_address(text)
                except ValueError:
                    continue
        return None

    async def start(self) -> None:
        """Pair if the options bring a code we have not already used; then open the session."""
        code = protocol.normalize_code(self.options.get("pairing_code") or "")
        info = self.files.paired()
        if self.options.get("pairing_code") and code is None:
            self.detail = "The pairing code in the App's configuration is not a Mantel pairing code."
        elif code is not None:
            sha = pairing.code_sha(code)
            if (info or {}).get("code_sha") != sha and self.files.tried() != sha:
                await self._pair(code, sha)
                info = self.files.paired()
        if self.options.get("pairing_code") and not self.options.get("mantel_address") and info is None:
            self.detail = self.detail or "Enter Mantel's address together with the code."
        self.open(info)

    async def _pair(self, code: str, sha: str) -> None:
        try:
            host, port = protocol.parse_address(self.options.get("mantel_address"))
        except ValueError as exc:
            self.detail = str(exc)
            return
        self.files.remember_attempt(sha)             # a wrong code is tried once, not on every restart
        try:
            await pairing.pair(host, port, code, self.files)
            self.detail = ""
        except pairing.PairError as exc:
            self.detail = str(exc)
            log.warning("pairing failed: %s", exc)

    def open(self, info: dict | None = None) -> None:
        info = info if info is not None else self.files.paired()
        old, self.session = self.session, None
        if old is not None:
            asyncio.get_running_loop().create_task(old.close())
        addr = self.address() if info is not None else None
        if info is None or addr is None:
            self.state = "unpaired"
            return
        self.host, self.port = addr
        ctx = pki.client_context(self.files.ca.read_text(), self.files.cert, self.files.key)
        self.session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(ssl=ctx, limit=64), cookie_jar=aiohttp.DummyCookieJar(),
            auto_decompress=False, trust_env=False, timeout=aiohttp.ClientTimeout(total=None, sock_connect=10,
                                                                                    sock_read=120))
        if self.state in ("unpaired",):
            self.state = "unreachable"
            self.detail = "Checking the connection to Mantel."

    @property
    def origin(self) -> str:
        return protocol.origin_of(self.host, self.port)

    # -- checks ------------------------------------------------------------------------------------------
    def set_state(self, state: str, detail: str = "") -> None:
        self.state, self.detail, self.checked = state, detail, self.clock()
        if state != self.last_state:                # a log line when it CHANGES, not every minute
            self.last_state = state
            (log.info if state == "ok" else log.warning)("Mantel connection: %s%s", state, f" ({detail})" if detail else "")

    async def check(self) -> None:
        if self.session is None:
            return
        try:
            async with self.session.get(self.origin + protocol.PING_PATH, allow_redirects=False,
                                        timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    self.set_state("ok")
                elif resp.status == 401 and "pairing_revoked" in (await resp.text())[:200]:
                    self.set_state("revoked", "This connection was revoked in Mantel. Pair again with a new code.")
                else:
                    self.set_state("unreachable", f"Mantel answered {resp.status}.")
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as exc:
            self.set_state("unreachable", f"Mantel cannot be reached ({type(exc).__name__}).")

    async def maybe_renew(self) -> None:
        expires = self.files.cert_expires()
        if self.session is None or expires is None or expires - time.time() > pairing.RENEW_BEFORE:
            return
        try:
            if await pairing.renew(self.files, self.host, self.port):
                self.open()
        except Exception as exc:  # noqa: BLE001 -- try again at the next check
            log.warning("certificate renewal failed (%s)", type(exc).__name__)

    async def close(self) -> None:
        if self.session is not None:
            await self.session.close()


# -- pages ------------------------------------------------------------------------------------------------
def _page(title: str, body: str, status: int = 200) -> web.Response:
    text = ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(title)}</title><style>body{{font:17px system-ui,sans-serif;max-width:36em;margin:3em auto;"
            "padding:0 1em;background:#05070e;color:#eee}a{color:#9cf}.note{color:#aaa}code{background:#222;padding:.1em .3em}</style>"
            f"<h1>{html.escape(title)}</h1>{body}</html>")
    return web.Response(text=text, status=status, content_type="text/html", headers=PAGE_HEADERS)


def status_page(link: Link, status: int | None = None) -> web.Response:
    if link.state == "unpaired":
        extra = f"<p class=note>{html.escape(link.detail)}</p>" if link.detail else ""
        return _page("Mantel Connect is not paired", (
            "<p>This App is not connected to a Mantel Server yet.</p><ol>"
            "<li>In Mantel (on its server), start pairing: <b>Admin, Connect, Pair</b>, or run <code>mantel connect pair</code>. "
            "It shows a one-time code that works for ten minutes.</li>"
            "<li>In Home Assistant, open <b>Settings, Apps, Mantel Connect, Configuration</b> (an administrator does this). "
            "Enter Mantel's address and the code, press Save, then <b>Restart</b> the App.</li></ol>" + extra), status or 503)
    if link.state == "revoked":
        return _page("Mantel Connect was disconnected", "<p>Mantel revoked this connection.</p><p>Start a new pairing in Mantel "
                     "and enter the new code in this App's configuration, then restart the App.</p>", status or 503)
    ok = link.state == "ok"
    when = time.strftime("%H:%M:%S", time.localtime(link.checked)) if link.checked else "not yet"
    return _page("Mantel Connect", f"<p>Mantel: <b>{'connected' if ok else 'not reachable'}</b> (checked at {when}).</p>"
                 + (f"<p class=note>{html.escape(link.detail)}</p>" if link.detail and not ok else "")
                 + "<p><a href='./'>Open Mantel</a></p>", status or (200 if ok else 502))


# -- the proxy ----------------------------------------------------------------------------------------------
def wants_page(request: web.Request) -> bool:
    dest = request.headers.get("Sec-Fetch-Dest")
    return dest in ("document", "iframe") if dest is not None else "text/html" in request.headers.get("Accept", "")


def upstream_headers(request: web.Request) -> CIMultiDict | None:
    """Freshly built, from an allow-list; None when Home Assistant named no valid user."""
    ids = request.headers.getall(USER_ID, [])
    if len(ids) != 1 or not _ID.match(ids[0]):
        return None
    out = CIMultiDict()
    for name in FORWARD:
        for value in request.headers.getall(name, []):
            out.add(name, value)
    out[USER_ID] = ids[0]
    for name in (USER_NAME, USER_DISPLAY):
        values = request.headers.getall(name, [])
        if len(values) == 1:
            clean = re.sub(r"[\x00-\x1f\x7f]", "", values[0]).strip()[:120]
            if clean:
                out[name] = clean
    return out


def target_url(link: Link, request: web.Request) -> str:
    raw = request.raw_path
    if not raw.startswith("/"):                      # an absolute-form request target never names another host
        raise web.HTTPBadRequest(text="bad request target")
    return link.origin + raw


def _response_headers(source) -> list[tuple[str, str]]:
    return [(k, v) for k, v in source.items() if k.lower() not in HOP]


async def proxy(request: web.Request) -> web.StreamResponse:
    link: Link = request.app["link"]
    if request.remote not in request.app["peers"]:
        raise web.HTTPForbidden(text="Home Assistant's sidebar only")
    if request.path == STATUS:
        return status_page(link, 200)
    if link.session is None or link.state in ("unpaired", "revoked"):
        return status_page(link) if wants_page(request) else web.Response(status=503, text="Mantel Connect is not paired")
    headers = upstream_headers(request)
    if headers is None:
        raise web.HTTPUnauthorized(text="Home Assistant did not say who you are; reload from the sidebar")
    url = target_url(link, request)
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return await proxy_ws(request, link, url, headers)
    body = None
    if request.can_read_body:
        body = request.content.iter_chunked(CHUNK)
        if request.content_length is not None:
            headers["Content-Length"] = str(request.content_length)
    resp = None
    try:
        async with link.session.request(request.method, url, headers=headers, data=body, allow_redirects=False) as up:
            if up.status == 401 and up.headers.get("Content-Type", "").startswith("application/json") \
                    and (up.content_length or 0) < 512:
                data = await up.read()
                if b"pairing_revoked" in data:
                    link.set_state("revoked", "revoked in Mantel")
                    return status_page(link)
                return web.Response(status=401, body=data, headers=[
                    (k, v) for k, v in _response_headers(up.headers) if k.lower() != "content-length"])
            resp = web.StreamResponse(status=up.status, reason=up.reason)
            for k, v in _response_headers(up.headers):
                if k.lower() == "content-length" and (request.method == "HEAD" or up.status in (204, 304)):
                    continue
                resp.headers.add(k, v)
            await resp.prepare(request)
            if request.method != "HEAD" and up.status not in (204, 304):
                async for chunk in up.content.iter_chunked(CHUNK):
                    await resp.write(chunk)
            await resp.write_eof()
            return resp
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as exc:
        if resp is not None and resp.prepared:
            raise                                    # the page is half sent: the browser sees a dropped connection
        link.set_state("unreachable", f"Mantel cannot be reached ({type(exc).__name__}).")
        return status_page(link, 502) if wants_page(request) else web.Response(status=502, text="Mantel is unavailable")


async def proxy_ws(request: web.Request, link: Link, url: str, headers: CIMultiDict) -> web.StreamResponse:
    try:
        up = await link.session.ws_connect(url, headers=headers, heartbeat=30, max_msg_size=4 << 20, autoclose=False)
    except aiohttp.WSServerHandshakeError as exc:
        return web.Response(status=exc.status if 400 <= exc.status < 600 else 502, text="Mantel refused the WebSocket")
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError):
        return web.Response(status=502, text="Mantel is unavailable")
    ws = web.WebSocketResponse(heartbeat=30, max_msg_size=4 << 20, autoclose=False)
    await ws.prepare(request)

    async def pump(src, dst):
        async for msg in src:
            if msg.type == aiohttp.WSMsgType.TEXT:
                await dst.send_str(msg.data)
            elif msg.type == aiohttp.WSMsgType.BINARY:
                await dst.send_bytes(msg.data)
            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED,
                              aiohttp.WSMsgType.ERROR):
                break

    tasks = [asyncio.create_task(pump(ws, up)), asyncio.create_task(pump(up, ws))]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await up.close()
        await ws.close()
    return ws


async def healthz(request: web.Request) -> web.Response:
    return web.Response(text="ok", headers={"Cache-Control": "no-store"})


def build_app(folder: Path, options: dict, peers=(SUPERVISOR,), clock=time.time) -> web.Application:
    app = web.Application(client_max_size=1024 ** 3)
    app["link"] = link = Link(folder, options, clock)
    app["peers"] = tuple(peers)

    async def lifecycle(app: web.Application):
        await link.start()
        await link.check()
        await link.maybe_renew()

        async def background():
            last_renew = time.monotonic()
            while True:
                await asyncio.sleep(PING_EVERY)
                try:
                    await link.check()
                    if time.monotonic() - last_renew >= RENEW_CHECK_EVERY:
                        last_renew = time.monotonic()
                        await link.maybe_renew()
                except Exception:  # noqa: BLE001 -- the watchdog is /healthz; keep checking
                    log.exception("connection check failed")

        task = asyncio.create_task(background())
        yield
        task.cancel()
        await link.close()

    app.cleanup_ctx.append(lifecycle)
    app.router.add_get("/healthz", healthz)
    app.router.add_route("*", "/{tail:.*}", proxy)
    return app
