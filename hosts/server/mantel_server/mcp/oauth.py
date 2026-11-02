"""Signing an assistant in: OAuth 2.1 with PKCE, as MCP's authorization spec asks (M12.5).

The client finds its way by itself:

1. ``/mcp`` answers 401 with ``WWW-Authenticate: Bearer resource_metadata=…`` (RFC 9728), which points at
   ``/.well-known/oauth-protected-resource/mcp``: the resource (this Mantel's ``/mcp``) and its authorization
   server (this Mantel), whose metadata is ``/.well-known/oauth-authorization-server`` (RFC 8414).
2. It registers itself (RFC 7591, ``POST /mcp/oauth/register``): a name and its redirect URIs, which must be
   ``https`` or a loopback ``http`` address (an assistant on this computer). Public clients only (PKCE, no secret).
   Ten registrations an hour from one address, at most 200 clients; one nobody signed in with is forgotten after
   30 days. (Client ID Metadata Documents are not offered: fetching a URL a stranger names, from inside a home's
   network, is a door Mantel keeps shut. Clients fall back to registration, as the spec says they do.)
3. The person's browser opens ``/mcp/oauth/authorize`` (signed out: Mantel's sign-in first, with every factor
   Mantel has). The consent page names the assistant and the person, with the scopes as ticks; ``commands`` is
   offered only while the house allows it (``mcp_commands`` and Allow Control of the House), "from away" only while
   ``mcp_away`` is on. Allow is a form POST with the session's CSRF token, audited (``mcp.grant``) before the code.
   It asks what a personal key asks (``POST /api/mcp/keys``): a sign-in within the last five minutes, as adding a
   passkey does (``accounts.require_fresh_to_add_factor``), and for ``commands``, wherever the person is, a fresh
   sign-in whatever vouches for them (as Allow Control of the House does). A stale session is shown a Sign In Again
   button, not the form: a 30-day, refreshable credential is a way in (third audit pass, SRV-1).
4. ``POST /mcp/oauth/token``: the code (single use, 60 seconds, bound to the client, redirect URI, PKCE S256
   challenge and the ticked scopes) for an access token (15 minutes) and a refresh token (rotated on use; a reused
   one ends the family, sessions.rotate). The ``resource`` asked for, when sent (RFC 8707), must be this ``/mcp``:
   the token is good there and nowhere else (a browser cookie, an app's bearer, never).
5. ``POST /mcp/oauth/revoke`` (RFC 7009) ends it, as Revoke in Mantel Settings does.

The authorization response carries ``iss`` (RFC 9207).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import re
import secrets
import time
from collections import deque
from typing import Any
from urllib.parse import urlencode, urlparse

from aiohttp import web

from .. import audit, sessions
from ..accounts import STEP_UP_WINDOW, is_fresh_to_add_factor
from ..login_page import login_url
from .grants import DEFAULT_SCOPES, MANAGERS, SCOPES, GrantError, clean_scopes

log = logging.getLogger("mantel.mcp")

AUTHORIZE, TOKEN, REGISTER, REVOKE = "/mcp/oauth/authorize", "/mcp/oauth/token", "/mcp/oauth/register", "/mcp/oauth/revoke"
PR_META = "/.well-known/oauth-protected-resource"
AS_META = "/.well-known/oauth-authorization-server"
CODE_TTL = 60.0
CLIENTS_MAX = 200
REGISTER_PER_HOUR = 10
CLIENT_IDLE = 30 * 86400
LOOPBACK = ("127.0.0.1", "localhost", "::1", "[::1]")
SCOPE_WORDS = {"read": "Read the house, its settings, screens and Music",
               "settings": "Change settings (the house, screens, tablets, accessories, Music)",
               "screens": "Add, change and remove screens and Home Grid layouts",
               "audit": "Read the audit log and settings history",
               "restore": "Roll a settings document back to an earlier version",
               "commands": "Control the house (lights, media, scenes...), as you may"}


def issuer(request: web.Request) -> str:
    from ..proxy_trust import public_origin
    return public_origin(request)


def _json(body: dict, status: int = 200) -> web.Response:
    return web.json_response(body, status=status, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


def _oauth_error(code: str, text: str, status: int = 400) -> web.Response:
    return _json({"error": code, "error_description": text}, status)


def _page(title: str, body: str, status: int = 200) -> web.Response:
    from ..auth import page
    return page(title, body, status)


def _off(request: web.Request) -> bool:
    return not request.app["mcp_settings"].enabled


# -- metadata -----------------------------------------------------------------------------------------------------
async def protected_resource(request: web.Request) -> web.Response:
    from .protocol import resource_url
    return _json({"resource": resource_url(request), "authorization_servers": [issuer(request)],
                  "scopes_supported": list(SCOPES), "bearer_methods_supported": ["header"],
                  "resource_name": "Mantel"})


async def authorization_server(request: web.Request) -> web.Response:
    base = issuer(request)
    return _json({"issuer": base, "authorization_endpoint": base + AUTHORIZE, "token_endpoint": base + TOKEN,
                  "registration_endpoint": base + REGISTER, "revocation_endpoint": base + REVOKE,
                  "response_types_supported": ["code"], "grant_types_supported": ["authorization_code", "refresh_token"],
                  "code_challenge_methods_supported": ["S256"], "token_endpoint_auth_methods_supported": ["none"],
                  "revocation_endpoint_auth_methods_supported": ["none"], "scopes_supported": list(SCOPES),
                  "authorization_response_iss_parameter_supported": True,
                  "client_id_metadata_document_supported": False})


# -- registration (RFC 7591) --------------------------------------------------------------------------------------
def good_redirect(uri: Any) -> bool:
    if not isinstance(uri, str) or not 8 <= len(uri) <= 500 or any(c in uri for c in " \t\r\n\"'<>\\"):
        return False
    try:
        u = urlparse(uri)
    except ValueError:
        return False
    if u.fragment or u.username or u.password or not u.hostname:
        return False
    if u.scheme == "https":
        return True
    return u.scheme == "http" and u.hostname in LOOPBACK


class Registrations:
    def __init__(self, clock=time.monotonic) -> None:
        self.clock = clock
        self.seen: dict[str, deque] = {}

    def take(self, ip: str) -> bool:
        now = self.clock()
        q = self.seen.setdefault(ip, deque())
        while q and now - q[0] >= 3600:
            q.popleft()
        if len(q) >= REGISTER_PER_HOUR:
            return False
        q.append(now)
        return True


async def register_client(request: web.Request) -> web.Response:
    app = request.app
    if _off(request):
        return _oauth_error("access_denied", "Assistants are off on this Mantel", 403)
    door = sessions.door_of(request)
    if door != "lan" and not app["mcp_settings"].get("mcp_away"):
        return _oauth_error("access_denied", "assistants register on the home network only", 403)
    ip = sessions.client_ip(request) or "?"
    if not app["mcp_registrations"].take(ip):
        return _oauth_error("slow_down", "too many registrations from this address: try again later", 429)
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        body = None
    if not isinstance(body, dict):
        return _oauth_error("invalid_client_metadata", "a JSON object")
    uris = body.get("redirect_uris")
    if not isinstance(uris, list) or not 1 <= len(uris) <= 5 or not all(good_redirect(u) for u in uris):
        return _oauth_error("invalid_redirect_uri", "1-5 redirect URIs, each https, or http on this computer "
                                                    "(127.0.0.1, localhost)")
    for key, allowed in (("grant_types", {"authorization_code", "refresh_token"}), ("response_types", {"code"})):
        got = body.get(key)
        if got is not None and (not isinstance(got, list) or not set(got) <= allowed):
            return _oauth_error("invalid_client_metadata", f"{key}: {sorted(allowed)}")
    if body.get("token_endpoint_auth_method") not in (None, "none"):
        return _oauth_error("invalid_client_metadata", "public clients only: token_endpoint_auth_method none")
    name = re.sub(r"[^\w .:@()'+-]+", " ", str(body.get("client_name") or "")).strip()[:64].strip() or "Assistant"
    db = app["store"].db
    now = app["clock"]()
    with db:
        db.execute("DELETE FROM mcp_clients WHERE COALESCE(last_used, created) < ? AND client_id NOT IN "
                   "(SELECT client_id FROM mcp_grants WHERE client_id IS NOT NULL AND revoked IS NULL)",
                   (now - CLIENT_IDLE,))
        n = db.execute("SELECT COUNT(*) FROM mcp_clients").fetchone()[0]
        if n >= CLIENTS_MAX:
            return _oauth_error("access_denied", "this Mantel has as many assistants registered as it takes", 403)
        cid = "mcpc_" + secrets.token_urlsafe(18)
        db.execute("INSERT INTO mcp_clients (client_id, name, redirect_uris, created, created_ip) VALUES (?,?,?,?,?)",
                   (cid, name, json.dumps(uris), now, ip))
    log.info("assistant client %s (%s) registered from %s", cid, name, ip)
    return _json({"client_id": cid, "client_name": name, "redirect_uris": uris, "client_id_issued_at": int(now),
                  "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
                  "token_endpoint_auth_method": "none"}, 201)


def _client(app, cid: Any):
    if not isinstance(cid, str) or len(cid) > 80:
        return None
    return app["store"].db.execute("SELECT * FROM mcp_clients WHERE client_id = ?", (cid,)).fetchone()


# -- authorize ----------------------------------------------------------------------------------------------------
FIELDS = ("response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope",
          "resource")


def _params(request: web.Request, src) -> tuple[dict | None, web.StreamResponse | None]:
    """The request's parameters, checked; or the answer to give (a page when the client or its redirect is unknown,
    so nothing is ever sent to an address nobody registered; a redirect with the error otherwise)."""
    p = {k: (src.get(k) if isinstance(src.get(k), str) else None) for k in FIELDS}
    client = _client(request.app, p["client_id"])
    if client is None:
        return None, _page("Can’t Connect", "<p>This assistant is not registered with this Mantel. Start again from "
                                           "the assistant.</p>", 400)
    uris = json.loads(client["redirect_uris"])
    if p["redirect_uri"] is None and len(uris) == 1:
        p["redirect_uri"] = uris[0]
    if p["redirect_uri"] not in uris:
        return None, _page("Can’t Connect", "<p>This assistant asked to come back to an address it did not "
                                           "register.</p>", 400)

    def back(err: str, text: str) -> web.StreamResponse:
        return _redirect(request, p["redirect_uri"], p["state"], error=err, error_description=text)
    if p["response_type"] != "code":
        return None, back("unsupported_response_type", "response_type=code")
    ch = p["code_challenge"] or ""
    if p["code_challenge_method"] != "S256" or not 43 <= len(ch) <= 128 or \
            any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~" for c in ch):
        return None, back("invalid_request", "PKCE with S256 is required")
    if p["resource"] is not None:
        from .protocol import resource_url
        if p["resource"].rstrip("/") != resource_url(request):
            return None, back("invalid_target", "this Mantel's resource is " + resource_url(request))
    if p["state"] is not None and len(p["state"]) > 500:
        return None, back("invalid_request", "state is too long")
    p["client_name"] = client["name"]
    return p, None


def _redirect(request: web.Request, uri: str, state: str | None, **query: str) -> web.StreamResponse:
    q = {**query, **({"state": state} if state else {}), "iss": issuer(request)}
    raise web.HTTPFound(uri + ("&" if "?" in uri else "?") + urlencode(q), headers={"Cache-Control": "no-store"})


def offered(request: web.Request) -> list[str]:
    s = request.app["mcp_settings"]
    out = [x for x in SCOPES if x != "commands"]
    if s.get("mcp_commands") and request.app.get("gateway") is not None:
        out.append("commands")
    return out


STALE = ("Connecting an assistant gives it a way in for 30 days, so it needs a sign-in from the last five minutes.")
STALE_COMMANDS = ("Connecting an assistant that may control the house needs a sign-in from the last five minutes.")


def _hidden(p: dict) -> str:
    return "".join(f"<input type=hidden name={k} value='{html.escape(v or '', quote=True)}'>"
                   for k, v in p.items() if k in FIELDS)


def _sign_in_again(ident, p: dict, why: str) -> web.Response:
    """The page a stale session sees instead of the consent form: Sign In Again ends this session and comes back
    to this very request after the sign-in (``authorize_post``, ``decision=signin_again``)."""
    csrf = html.escape(ident.csrf or "", quote=True)
    body = (f"<p>{html.escape(why)}</p><form method=post action='{AUTHORIZE}'>{_hidden(p)}"
            f"<input type=hidden name=csrf value='{csrf}'>"
            "<button name=decision value=signin_again>Sign In Again</button></form>")
    return _page("Sign In Again", body, 403)


async def authorize_page(request: web.Request) -> web.StreamResponse:
    p, answer = _params(request, request.query)
    if answer is not None:
        return answer
    if _off(request):
        return _page("Assistants Are Off", "<p>An Owner turns them on in Mantel Settings → Advanced → Assistants.</p>",
                     403)
    ident = sessions.identity(request)
    if ident.device is not None:
        return _page("Can’t Connect Here", "<p>This browser is a wall tablet. Connect assistants from your own "
                                           "computer.</p>", 403)
    if ident.user is None:
        raise web.HTTPFound(login_url(request.path_qs), headers={"Cache-Control": "no-store"})
    if ident.user.role not in MANAGERS:
        return _page("Can’t Connect", "<p>Only an Owner or an Admin may connect an assistant to Mantel.</p>", 403)
    door = ident.door
    s = request.app["mcp_settings"]
    if door != "lan" and not s.get("mcp_away"):
        return _page("Home Network Only", "<p>Connect assistants on the home network.</p>", 403)
    if not is_fresh_to_add_factor(request, ident):
        return _sign_in_again(ident, p, STALE)
    asked = [x for x in (p["scope"] or "").split() if x in SCOPES] or list(DEFAULT_SCOPES)
    offer = offered(request)
    who = html.escape(ident.user.name or ident.user.username or "you")
    ticks = "".join(
        f"<label class=tick><input type=checkbox name=grant_scope value={x}{' checked' if x in asked else ''}>"
        f" {html.escape(SCOPE_WORDS[x])}</label>" for x in offer)
    away = ("<label class=tick><input type=checkbox name=away value=1> Also from away (outside the home "
            "network)</label>") if s.get("mcp_away") else ""
    hidden = _hidden(p)
    body = (f"<div class=card><p><b>{html.escape(p['client_name'])}</b> asks to connect to Mantel as</p><h2>{who}</h2>"
            f"<p class=small>It returns to <b>{html.escape(urlparse(p['redirect_uri']).netloc)}</b>. Allow it only if "
            "you just started connecting this assistant yourself.</p>"
            "<p>It acts for you: your roles decide what it may do, and the Audit Log shows each change as yours, "
            "through it. It never gets the Alarm PIN. You can end it in Mantel Settings → Advanced → Assistants.</p>"
            f"<form method=post action='{AUTHORIZE}'>{hidden}"
            f"<input type=hidden name=csrf value='{html.escape(ident.csrf or '', quote=True)}'>"
            f"<fieldset>{ticks}{away}</fieldset>"
            "<button name=decision value=allow>Allow</button><button class=cx name=decision value=deny>Cancel</button>"
            "</form></div>")
    resp = _page("Connect an Assistant", body)
    # Allow redirects to the assistant's own address: form-action covers a form's redirects too
    from ..security_headers import page_policy
    u = urlparse(p["redirect_uri"])
    csp = page_policy(request.app.get("cfg")).replace("form-action 'self'", f"form-action 'self' {u.scheme}://{u.netloc}")
    resp.headers["Content-Security-Policy"] = re.sub(r"frame-ancestors [^;]*", "frame-ancestors 'none'", csp)
    resp.headers["X-Frame-Options"] = "DENY"            # nobody frames a consent page (clickjacking)
    return resp


async def authorize_post(request: web.Request) -> web.StreamResponse:
    form = await request.post()
    p, answer = _params(request, form)
    if answer is not None:
        return answer
    if _off(request):
        return _page("Assistants Are Off", "<p>An Owner turns them on in Mantel Settings.</p>", 403)
    ident = sessions.identity(request)
    if ident.user is None or ident.device is not None:
        raise web.HTTPFound(login_url(AUTHORIZE + "?" + urlencode({k: v for k, v in p.items() if v and k in FIELDS})))
    if not ident.csrf or not hmac.compare_digest(str(form.get("csrf") or ""), ident.csrf):
        return _page("Can’t Connect", "<p>The page was out of date. Start again from the assistant.</p>", 403)
    if ident.user.role not in MANAGERS:
        return _page("Can’t Connect", "<p>Only an Owner or an Admin may connect an assistant.</p>", 403)
    if form.get("decision") == "signin_again":
        # the stale session ends and the person signs in, then lands on the consent page again (SRV-1)
        to = login_url(AUTHORIZE + "?" + urlencode({k: v for k, v in p.items() if v and k in FIELDS}))
        resp = web.Response(status=303, headers={"Location": to, "Cache-Control": "no-store"})
        sessions.end_session(request, resp, "consent_sign_in_again")
        return resp
    if form.get("decision") != "allow":
        _redirect(request, p["redirect_uri"], p["state"], error="access_denied", error_description="declined")
    s = request.app["mcp_settings"]
    if ident.door != "lan" and not s.get("mcp_away"):
        return _page("Home Network Only", "<p>Connect assistants on the home network.</p>", 403)
    picked = [x for x in form.getall("grant_scope", []) if isinstance(x, str)]
    offer = set(offered(request))
    try:
        scopes = clean_scopes([x for x in picked if x in offer])
    except GrantError:
        return _page("Nothing Ticked", "<p>Tick at least one thing the assistant may do. Start again from the "
                                       "assistant.</p>", 400)
    # A credential that lasts 30 days and refreshes is a way in as this person: the fresh sign-in a personal key
    # asks (POST /api/mcp/keys). `commands` also asks it wherever the person is, even from Home Assistant's
    # sidebar, as turning on Allow Control of the House does (third audit pass, SRV-1).
    if "commands" in scopes:
        if not ident.fresh_within(STEP_UP_WINDOW, request.app["clock"]()):
            return _sign_in_again(ident, {**p, "scope": " ".join(scopes)}, STALE_COMMANDS)
    elif not is_fresh_to_add_factor(request, ident):
        return _sign_in_again(ident, {**p, "scope": " ".join(scopes)}, STALE)
    away = bool(form.get("away")) and bool(s.get("mcp_away"))
    try:
        audit.config(request, ident, "mcp.grant", {"client": p["client_id"], "name": p["client_name"],
                                                   "scopes": scopes, "away": away})
    except audit.Unavailable:
        return _page("Can’t Connect", "<p>The audit log could not be written, so nothing was allowed.</p>", 503)
    code = secrets.token_urlsafe(32)
    db = request.app["store"].db
    now = request.app["clock"]()
    with db:
        db.execute("DELETE FROM mcp_codes WHERE expires < ?", (now - 600,))
        db.execute("INSERT INTO mcp_codes (code_hash, client_id, user_id, redirect_uri, challenge, scopes, away, door, "
                   "expires) VALUES (?,?,?,?,?,?,?,?,?)",
                   (hashlib.sha256(code.encode()).hexdigest(), p["client_id"], ident.user.id, p["redirect_uri"],
                    p["code_challenge"], json.dumps(scopes), int(away), ident.door, now + CODE_TTL))
    _redirect(request, p["redirect_uri"], p["state"], code=code)


# -- token --------------------------------------------------------------------------------------------------------
def _tokens(issued: sessions.Issued, grant, now: float) -> dict:
    return {"access_token": issued.access, "token_type": "Bearer",
            "expires_in": max(1, int(issued.access_expires - now)), "refresh_token": issued.refresh,
            "scope": " ".join(sorted(grant.scopes, key=SCOPES.index))}


async def token(request: web.Request) -> web.Response:
    app = request.app
    if _off(request):
        return _oauth_error("access_denied", "Assistants are off on this Mantel", 403)
    door = sessions.door_of(request)
    if door == "ha" or door != "lan" and not app["mcp_settings"].get("mcp_away"):
        return _oauth_error("access_denied", "on the home network only", 403)
    if request.content_type != "application/x-www-form-urlencoded":
        return _oauth_error("invalid_request", "application/x-www-form-urlencoded")
    form = await request.post()
    f = {k: form.get(k) if isinstance(form.get(k), str) else None for k in
         ("grant_type", "code", "redirect_uri", "client_id", "code_verifier", "refresh_token", "resource")}
    client = _client(app, f["client_id"])
    if client is None:
        return _oauth_error("invalid_client", "unknown client", 401)
    if f["resource"] is not None:
        from .protocol import resource_url
        if f["resource"].rstrip("/") != resource_url(request):
            return _oauth_error("invalid_target", "this Mantel's resource is " + resource_url(request))
    now = app["clock"]()
    db = app["store"].db
    grants = app["mcp_grants"]
    if f["grant_type"] == "authorization_code":
        if not f["code"] or not f["code_verifier"] or not 43 <= len(f["code_verifier"]) <= 128:
            return _oauth_error("invalid_request", "code and code_verifier")
        h = hashlib.sha256(f["code"].encode()).hexdigest()
        with db:
            row = db.execute("SELECT * FROM mcp_codes WHERE code_hash = ?", (h,)).fetchone()
            if row is None or row["used"] is not None or row["expires"] < now:
                return _oauth_error("invalid_grant", "this code is used, expired or unknown")
            db.execute("UPDATE mcp_codes SET used = ? WHERE code_hash = ?", (now, h))
        want = base64.urlsafe_b64encode(hashlib.sha256(f["code_verifier"].encode()).digest()).rstrip(b"=").decode()
        if row["client_id"] != f["client_id"] or (f["redirect_uri"] or row["redirect_uri"]) != row["redirect_uri"] \
                or not hmac.compare_digest(want, row["challenge"]):
            return _oauth_error("invalid_grant", "the code does not match this client, address or verifier")
        user = db.execute("SELECT id, name, role, kind, disabled FROM users WHERE id = ?", (row["user_id"],)).fetchone()
        if user is None or user["disabled"] or user["role"] not in MANAGERS:
            return _oauth_error("invalid_grant", "this person may not connect an assistant")
        person = sessions.User(id=user["id"], name=user["name"], role=user["role"], kind=user["kind"])
        try:
            grant, issued = grants.create_oauth(person, client["client_id"], client["name"], json.loads(row["scopes"]),
                                                bool(row["away"]), row["door"], source_ip=sessions.client_ip(request))
        except GrantError as exc:
            return _oauth_error("invalid_grant", str(exc))
        with db:
            db.execute("UPDATE mcp_clients SET last_used = ? WHERE client_id = ?", (now, client["client_id"]))
        return _json(_tokens(issued, grant, now))
    if f["grant_type"] == "refresh_token":
        mgr = app["sessions"]
        sid = mgr.by_refresh(f["refresh_token"])
        grant = grants.by_session(sid) if sid else None
        if grant is None or grant.client_id != f["client_id"]:
            return _oauth_error("invalid_grant", "this refresh token is not valid")
        status, value = mgr.rotate(f["refresh_token"], now, allow_mcp=True)
        if status == "reuse":
            grants.revoke(grant.id, "refresh_reuse")
            return _oauth_error("invalid_grant", "this refresh token was used before: the sign-in is ended")
        if status != "ok":
            return _oauth_error("invalid_grant", "this refresh token is not valid" if status == "invalid"
                                else "another refresh just happened: use its tokens")
        issued, _row = value
        return _json(_tokens(issued, grant, now))
    return _oauth_error("unsupported_grant_type", "authorization_code or refresh_token")


async def revoke(request: web.Request) -> web.Response:
    """RFC 7009: always 200, whatever the token was."""
    app = request.app
    form = await request.post() if request.content_type == "application/x-www-form-urlencoded" else {}
    tok = form.get("token") if isinstance(form.get("token"), str) else None
    cid = form.get("client_id") if isinstance(form.get("client_id"), str) else None
    if tok:
        mgr = app["sessions"]
        sid = mgr.by_refresh(tok)
        if sid is None:
            row = mgr.from_access(tok, app["clock"]())
            sid = row["id"] if row is not None and row["method"] == sessions.MCP_METHOD else None
        grant = app["mcp_grants"].by_session(sid) if sid else None
        if grant is not None and grant.kind == "oauth" and grant.client_id == cid:
            app["mcp_grants"].revoke(grant.id, "revoked by the assistant")
    return web.Response(status=200, headers={"Cache-Control": "no-store"})


def register(app: web.Application) -> None:
    app["mcp_registrations"] = Registrations()
    for path in (PR_META, PR_META + "/mcp"):
        app.router.add_get(path, protected_resource)
    app.router.add_get(AS_META, authorization_server)
    app.router.add_post(REGISTER, register_client)
    app.router.add_get(AUTHORIZE, authorize_page)
    app.router.add_post(AUTHORIZE, authorize_post)
    app.router.add_post(TOKEN, token)
    app.router.add_post(REVOKE, revoke)
    # their own checks (a client's registration, a code, a refresh token, the authorize page's own sign-in)
    app.setdefault("public_paths", set()).update({PR_META, PR_META + "/mcp", AS_META, REGISTER, AUTHORIZE, TOKEN, REVOKE})
