""""Test my proxy": an Owner checks the reverse proxy in front of Mantel from a browser behind it.

Self-contained so the admin page's Connections section can link to it or embed it (another slice owns
admin_page.py): ``GET /proxy-check`` (a page), ``/proxy-check/check.js`` (its module, which exports
``runProxyCheck(base)`` for anyone to embed), ``GET /api/admin/proxy-check`` (the report of what this
very request looked like on arrival) and ``GET /api/admin/proxy-check/ws`` (the same report over a
WebSocket, which proves the upgrade passes the proxy). Owner only, either door (the tunnel is worth
testing too). Nothing is changed by any of it.

What is checked (server side, from the request as it arrived; the module adds the browser's view):
https in use; the request came from the configured trusted proxy; the door header (present, which
door, plausible for the client's address, and NOT passed through from the browser: the module sends
a probe value and the proxy must overwrite it); X-Forwarded-For; the Host Mantel was configured for;
then in the browser: HSTS and CSP arrived (once), and the WebSocket upgrade works with the same door.
Every finding comes with a plain-language fix and, for Nginx Proxy Manager, settings to paste.
"""
from __future__ import annotations

import html
import json
from importlib.resources import files
from ipaddress import ip_address
from urllib.parse import urlsplit

from aiohttp import WSMsgType, web

from . import authz as authz_mod
from . import door_key, proxy_trust, sessions
from .accounts import STEP_UP_WINDOW
from .login_page import login_url

PAGE = "/proxy-check"
ASSETS = {"check.js": "text/javascript", "check.css": "text/css"}
API = "/api/admin/proxy-check"
WS = API + "/ws"
PROBE = "mantel-proxy-check-probe"   # the value the browser sends as X-Mantel-Door: must never arrive
BASICS = "/api/proxy-check/basics"
DOOR_KEY = API + "/door-key"           # POST: a new door key (Owner)   # public: this request's own door, for a page that is signed out on it

CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' {ws}; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'self'")


def npm_advanced(upstream: str = "MANTEL_ADDRESS:8765", door: str = "lan", key: str = door_key.PLACEHOLDER) -> str:
    """Nginx Proxy Manager, proxy host -> Advanced -> Custom Nginx Configuration (one `location /`
    replaces NPM's own, so these headers are not lost to nginx's inheritance rule). `key`: this
    installation's door key (door_key.py; the placeholder in the docs and for anyone but an Owner)."""
    return "\n".join([
        "location / {",
        f"    proxy_pass http://{upstream};",
        "    proxy_http_version 1.1;",
        "    proxy_set_header Host $http_host;",
        "    proxy_set_header Upgrade $http_upgrade;",
        "    proxy_set_header Connection $http_connection;",
        "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
        "    proxy_set_header X-Forwarded-Proto $scheme;",
        "    proxy_set_header X-Forwarded-Host $http_host;",
        f"    proxy_set_header X-Mantel-Door {door};",
        f"    proxy_set_header {door_key.HEADER} {key};",
        '    proxy_set_header X-Remote-User-Id "";',
        '    proxy_set_header X-Remote-User-Name "";',
        '    proxy_set_header X-Remote-User-Display-Name "";',
        '    proxy_set_header X-Ingress-Path "";',
        "    proxy_read_timeout 1h;",
        "    proxy_buffering off;",
        "    client_max_body_size 12m;",
        "}",
    ])


def _owner(request: web.Request) -> sessions.Identity:
    ident = sessions.identity(request)
    if ident.user is None or ident.user.role != "owner" or ident.device is not None:
        raise web.HTTPForbidden(text="Owners only")
    return ident


def _private(ip: str | None) -> bool | None:
    try:
        a = ip_address(ip) if ip else None
    except ValueError:
        return None
    if a is None:
        return None
    return not a.is_global          # private, loopback, link-local, documentation ranges: not the internet


def report(request: web.Request) -> dict:
    """What this request looked like when it reached Mantel, and what to do about it."""
    cfg = request.app["cfg"]
    trusted_list = list(getattr(cfg, "trusted_proxies", ()) or ())
    peer = request.remote
    trusted = proxy_trust.is_trusted(request)
    https = proxy_trust.is_https(request)
    door = sessions.door_of(request)
    claims = request.headers.getall(authz_mod.DOOR_HEADER, [])
    via_cf = any(k in request.headers for k in authz_mod.CF_HEADERS)
    client = sessions.client_ip(request)
    xff = request.headers.get("X-Forwarded-For") if trusted else None
    public = urlsplit(getattr(cfg, "public_url", "") or "")
    host = proxy_trust.public_host(request)
    kind = getattr(cfg, "proxy_kind", "") or ""
    peer_loopback = _private(peer) is True and peer is not None and ip_address(peer).is_loopback
    checks: list[dict] = []

    def add(cid: str, ok, title: str, detail: str, fix: str = "", paste: str = "") -> None:
        checks.append({"id": cid, "ok": ok, "title": title, "detail": detail, "fix": fix, "paste": paste})

    need_key = door_key.required(cfg)
    dk = door_key.of(request.app) if need_key else None
    key_value = dk.value() if dk is not None else None
    npm = npm_advanced(key=key_value or door_key.PLACEHOLDER)
    if https:
        add("https", True, "HTTPS is in use", "Your browser reached Mantel over HTTPS.")
    else:
        add("https", False, "Not HTTPS", "Mantel saw this request as plain HTTP. Sign-in cookies, passkeys and "
            "camera talk-back need HTTPS, and the browser will block Music Assistant's frame on some pages.",
            "Nginx Proxy Manager: edit the proxy host, SSL tab: pick or request a certificate and turn on "
            "Force SSL. If your proxy does serve HTTPS, it is not telling Mantel: it must send "
            "X-Forwarded-Proto (NPM does by default) and Mantel must trust it (next check).")
    if peer_loopback and not trusted:
        add("trusted_proxy", None, "No proxy in between", f"This request came from {peer}, on Mantel's own machine.")
    elif trusted:
        add("trusted_proxy", True, "Came through your trusted proxy",
            f"The request came from {peer}, which Mantel trusts (--trusted-proxy / MANTEL_TRUSTED_PROXY).")
    elif not trusted_list:
        add("trusted_proxy", False, "No trusted proxy is configured",
            f"The request came from {peer}. Mantel trusts no proxy, so it treats everyone as the internet "
            "(tunnel door): wall tablets are refused and client addresses are your proxy's.",
            f"Set MANTEL_TRUSTED_PROXY={peer} in packaging/compose/.env (if {peer} is your proxy as Mantel sees "
            "it), then: docker compose up -d")
    else:
        add("trusted_proxy", False, "Did not come through your trusted proxy",
            f"The request came from {peer}, but Mantel trusts {', '.join(trusted_list)}. Either this browser "
            "reached Mantel's port directly (bypassing the proxy), or the proxy's address is not the one "
            "configured.",
            f"If {peer} is your proxy, set MANTEL_TRUSTED_PROXY={peer} in .env and restart Mantel. Otherwise "
            "open Mantel only by its proxy's address (and keep Mantel's port off the internet).")
    probe_passed = any(c.strip() == PROBE for c in claims)
    if probe_passed:
        add("door_overwrite", False, "Your proxy passes the browser's door header through",
            "This browser sent X-Mantel-Door itself and it reached Mantel unchanged. Anyone could then claim "
            "the LAN door (and its wall-tablet rules) from outside.",
            "Make the proxy SET the header (overwrite), never append or pass it: in NPM paste the Advanced "
            "block below; in Traefik use a headers middleware with customRequestHeaders.", npm)
    elif trusted:
        add("door_overwrite", True, "Browser door headers are overwritten",
            "The probe value this page sent as X-Mantel-Door did not reach Mantel.")
    if trusted:
        good = [c.strip().lower() for c in claims if c.strip().lower() in ("lan", "tunnel")]
        if not claims:
            add("door_header", False, "Your proxy does not say which door",
                "Mantel got no X-Mantel-Door from your proxy, so it treats this request as the internet "
                "(tunnel door; fail closed): wall tablets are refused, sessions are short.",
                "NPM: proxy host, Advanced tab, paste the block below (use `tunnel` instead of `lan` on a proxy "
                "host that the internet can reach).", npm)
        elif not good or len(set(good)) > 1 or len(claims) > 1:
            add("door_header", False, "The door header is garbled",
                f"Mantel got X-Mantel-Door {claims!r}; only one value, lan or tunnel, counts.",
                "Set it exactly once (proxy_set_header overwrites; add_header does not).", npm)
        else:
            add("door_header", True, f"Door: {door}", f"Your proxy says this is the {good[0]} door.")
    if trusted and need_key:
        st = door_key.status(request)
        if st == "ok":
            add("door_key", True, "Door key", "Your proxy sends this installation's door key with the door.")
        elif st == "missing":
            add("door_key", False, "Your proxy does not send the door key",
                f"With your own proxy, Mantel believes the door only together with this installation's key "
                f"({door_key.HEADER}); without it every request is the tunnel door.",
                "Add the key line of the block below to the proxy host (NPM: Advanced tab).", npm)
        else:
            add("door_key", False, "Your proxy sends the wrong door key",
                "The key your proxy sends is not this installation's (an old key from before a rotation?).",
                "Paste the block below again (it has the current key).", npm)
    if via_cf:
        add("door_plausible", True if door == "tunnel" else False, "Came through Cloudflare",
            "Cloudflare's headers are present, so Mantel uses the tunnel door's rules whatever else is said.")
    elif door == "lan" and _private(client) is False:
        add("door_plausible", False, "An internet address got the LAN door",
            f"The client address is {client}, which is not a private address, yet the door is lan. If this "
            "proxy host is reachable from the internet, everyone gets the wall tablets' door.",
            "Use X-Mantel-Door tunnel on any proxy host the internet can reach, and lan only on a host that "
            "listens on your LAN alone.", npm_advanced(door="tunnel"))
    elif door == "tunnel" and trusted and claims and _private(client) is True:
        add("door_plausible", None, "A LAN address on the tunnel door",
            f"The client address {client} is private but the proxy says tunnel. Fine if you meant this host "
            "for remote access; for the wall tablets use a proxy host that sends lan.")
    if trusted:
        if xff:
            add("forwarded_for", True, "Client address forwarded", f"Mantel sees the browser as {client}.")
        else:
            add("forwarded_for", False, "No client address",
                "Your proxy sends no X-Forwarded-For, so every request looks like the proxy itself (audit "
                "rows, rate limits).", "NPM sends it by default; in a custom config add "
                "`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`.")
    if public.hostname:
        same = host.split(":")[0].lower() == public.hostname.lower()
        add("host", True if same else None, "Address" if same else "A second address",
            f"You opened Mantel as {host}; its configured address is {public.netloc}."
            + ("" if same else " Sign in with Home Assistant returns to the configured address."))
    return {"checks": checks, "probe": PROBE, "proxy_kind": kind, "door": door, "https": https,
            "peer": peer, "client": client, "trusted": trusted_list,
            "npm_advanced": npm, "npm_advanced_tunnel": npm_advanced(door="tunnel", key=key_value or door_key.PLACEHOLDER),
            "traefik": traefik(key_value or door_key.PLACEHOLDER),
            # Owner only (this whole report is): the key the proxy must send, when it must
            "door_key": {"value": key_value, "since": dk.since(), "header": door_key.HEADER} if dk is not None else None}


def traefik(key: str = door_key.PLACEHOLDER) -> str:
    return TRAEFIK.replace(door_key.PLACEHOLDER, key)


TRAEFIK = """http:
  middlewares:
    mantel-lan:
      headers:
        customRequestHeaders:
          X-Mantel-Door: "lan"
          X-Mantel-Door-Key: "MANTEL_DOOR_KEY"
          X-Remote-User-Id: ""
          X-Remote-User-Name: ""
          X-Remote-User-Display-Name: ""
          X-Ingress-Path: ""
  routers:
    mantel:
      rule: "Host(`mantel.example.com`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [mantel-lan]
      service: mantel
  services:
    mantel:
      loadBalancer:
        servers:
          - url: "http://MANTEL_ADDRESS:8765"
"""


async def basics(request: web.Request) -> web.Response:
    """Public (no sign-in): only what this very request looked like, so a page whose session is not
    good on the door it arrived by (the usual symptom of a proxy that sends no door header) can say
    so. Names no address and no configuration."""
    trusted = proxy_trust.is_trusted(request)
    claims = request.headers.getall(authz_mod.DOOR_HEADER, []) if trusted else []
    return web.json_response({"door": sessions.door_of(request), "https": proxy_trust.is_https(request),
                              "via_trusted_proxy": trusted,
                              "door_header": bool(claims) if trusted else None,
                              # the page sends PROBE as X-Mantel-Door: arriving here, the proxy passes the
                              # browser's own door header through (anyone could claim the LAN door)
                              "probe_passed": any(c.strip() == PROBE for c in claims),
                              "door_key": door_key.status(request) if trusted else None,
                              "npm_advanced": npm_advanced()},
                             headers={"Cache-Control": "no-store"})


async def rotate(request: web.Request) -> web.Response:
    """A new door key (Owner; CSRF by the session middleware; a fresh factor on the tunnel door). The proxy
    must then send the new one: until it does, its requests are the tunnel door."""
    ident = _owner(request)
    if sessions.door_of(request) != "lan" and not ident.fresh_within(STEP_UP_WINDOW, request.app["clock"]()):
        return web.json_response({"error": "step_up_required"}, status=403)
    dk = door_key.of(request.app)
    if dk is None:
        raise web.HTTPNotFound()
    audit = request.app.get("audit")
    if audit is not None:
        try:
            audit.config_event({"actor": ident.user.id, "role": ident.user.role, "action": "door_key.rotated",
                                "detail": {}, "timestamp": request.app["clock"]()})
        except Exception:  # noqa: BLE001 -- nothing changes without its audit row
            return web.json_response({"error": "audit_unavailable"}, status=503)
    dk.rotate()
    return web.json_response({"ok": True, "door_key": {"value": dk.value(), "since": dk.since(),
                                                       "header": door_key.HEADER}},
                             headers={"Cache-Control": "no-store"})


SUMMARY = API + "/summary"           # GET: the Connections page's HTTPS panel (Owner/Admin; never a secret)

MODES = {
    "ha_app": ("Home Assistant App (Ingress)", "Home Assistant terminates HTTPS and signs people in; Mantel sees only Ingress."),
    "caddy": ("Caddy (Mantel's own)", "Mantel's Caddy terminates HTTPS and stamps the door header itself."),
    "own": ("Your own reverse proxy", "Your proxy terminates HTTPS and must send the door header and this installation's door key."),
    "direct": ("No proxy", "Mantel listens on plain HTTP on this machine (Mantel itself does not terminate TLS): "
                           "fine on loopback, not for remote use."),
}


def mode_of(cfg) -> str:
    if getattr(cfg, "ingress_only", False):
        return "ha_app"
    kind = getattr(cfg, "proxy_kind", "") or ""
    if kind in ("caddy", "own"):
        return kind
    return "own" if getattr(cfg, "trusted_proxies", ()) else "direct"


async def summary(request: web.Request) -> web.Response:
    """What the Connections page's HTTPS panel draws: the mode, the trusted proxy settings and whether a door
    key is set (and since when). NEVER the key itself: it is shown only by the Test my proxy report and
    once after a rotation, to an Owner."""
    ident = sessions.identity(request)
    if ident.user is None or ident.device is not None or ident.user.role not in ("owner", "admin"):
        raise web.HTTPForbidden(text="Owners and admins only")
    cfg = request.app.get("cfg")
    mode = mode_of(cfg)
    dk = door_key.of(request.app)
    need = door_key.required(cfg)
    return web.json_response({
        "mode": mode, "mode_label": MODES[mode][0], "mode_detail": MODES[mode][1],
        "proxy_kind": getattr(cfg, "proxy_kind", "") or "",
        "trusted_proxies": list(getattr(cfg, "trusted_proxies", ()) or ()),
        "public_url": getattr(cfg, "public_url", "") or "",
        "https_seen": proxy_trust.is_https(request),
        "door_key": {"required": need, "set": bool(need and dk is not None and dk.value()),
                     "since": dk.since() if need and dk is not None else None, "header": door_key.HEADER},
        "can_rotate": ident.user.role == "owner" and need and dk is not None,
        "test_url": PAGE,
    }, headers={"Cache-Control": "no-store"})


async def api(request: web.Request) -> web.Response:
    _owner(request)
    return web.json_response(report(request), headers={"Cache-Control": "no-store"})


async def ws(request: web.Request) -> web.StreamResponse:
    _owner(request)
    if request.headers.get("Origin") is None:
        raise web.HTTPForbidden(text="Origin required")
    got = report(request)
    sock = web.WebSocketResponse(heartbeat=10)
    await sock.prepare(request)
    await sock.send_str(json.dumps({"type": "report", "door": got["door"], "https": got["https"],
                                    "peer": got["peer"], "trusted": proxy_trust.is_trusted(request)}))
    try:
        msg = await sock.receive(timeout=5)
        if msg.type == WSMsgType.TEXT and msg.data == "ping":
            await sock.send_str(json.dumps({"type": "pong"}))
    except Exception:  # noqa: BLE001 -- a test socket: whatever happens, close it
        pass
    await sock.close()
    return sock


async def page(request: web.Request) -> web.StreamResponse:
    ident = sessions.identity(request)
    if ident.user is None and ident.device is None:
        raise web.HTTPFound(login_url(PAGE))
    _owner(request)
    base = html.escape(request.get("mantel_base", ""))
    host = proxy_trust.public_host(request)
    wss = f"{'wss' if proxy_trust.is_https(request) else 'ws'}://{host}"
    referrer = "<meta name=referrer content=same-origin>" if base else ""    # HA's Referrer-Policy: no-referrer breaks POSTs
    body = ("<!doctype html><html lang=en><head><meta charset=utf-8>"
            "<meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<meta name=mantel-base content='{base}'>{referrer}<title>Test my proxy</title>"
            f"<link rel=stylesheet href='{base}{PAGE}/check.css'></head><body><main>"
            "<h1>Test my proxy</h1><p class=lead>Checks the reverse proxy in front of Mantel, from this browser. "
            "Open it the way the tablets do (your LAN address) and again the way you reach Mantel remotely.</p>"
            "<div id=results aria-live=polite><p>Checking...</p></div>"
            f"<p><a href='{base}/admin'>Back to admin</a></p></main>"
            f"<script type=module src='{base}{PAGE}/check.js'></script></body></html>")
    return web.Response(text=body, content_type="text/html",
                        headers={"Cache-Control": "no-store", "Content-Security-Policy": CSP.format(ws=wss),
                                 "Referrer-Policy": "same-origin"})


async def asset(request: web.Request) -> web.StreamResponse:
    name = request.match_info["name"]
    if name not in ASSETS:
        raise web.HTTPNotFound()
    text = files("mantel_server").joinpath("static/proxy-check/" + name).read_text(encoding="utf-8")
    return web.Response(text=text, content_type=ASSETS[name], headers={"Cache-Control": "no-cache"})


def register(app: web.Application, hub=None) -> None:
    door_key.install(app)
    app.router.add_post(DOOR_KEY, rotate)
    app.setdefault("public_paths", set()).add(BASICS)
    app.router.add_get(BASICS, basics)
    app.router.add_get(PAGE, page)
    app.router.add_get(PAGE + "/{name}", asset)
    app.router.add_get(API, api)
    app.router.add_get(SUMMARY, summary)
    app.router.add_get(WS, ws)
