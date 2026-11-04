"""Signing in the iPhone, iPad and Mac apps (docs/phase10/APPLE-APPS.md §2-§4, slice 10.2).

**The app credential.** OAuth 2.0's authorization code with PKCE (RFC 7636), on Mantel's own sign-in page:

1. The app opens ``/app/authorize?client_id=mantel-ios&redirect_uri=mantel://auth&code_challenge=…
   &code_challenge_method=S256&state=…&device_name=…`` in ``ASWebAuthenticationSession``. Signed out, that is
   ``/login`` first (password + TOTP, a passkey through Safari with the house's own domain, Sign in with HA), so
   every factor Mantel has works and no password passes through native code.
2. Signed in, the page asks "Sign in to Mantel for iPhone as <name>?"; Allow (a POST with the session's CSRF
   token) redirects to ``mantel://auth?code=…&state=…``. The code is single use and lives 60 seconds.
3. The app trades it at ``POST /api/app/token`` (``grant_type=authorization_code``, the ``code_verifier``) with a
   **DPoP proof** (RFC 9449): a JWT signed by a P-256 key the app made in the Secure Enclave, carrying that
   key. The credential is bound to it: Mantel keeps only the public key and its thumbprint.
4. Tokens: an access token (15 minutes) and a refresh token rotated on every use, in the same refresh-family
   tables as browsers' sessions (sessions.py: a reused refresh token revokes the family). The family is a
   ``sessions`` row of method ``app`` that lasts **30 days on any door** (decision M10-3; Face ID opens the app).
   Every request (and every refresh) needs a fresh proof from the same key, so a copied token is useless
   without the phone. Browser cookies can never carry an app token (sessions.identity ignores method ``app``).

**Pairing.** Settings → Me → *Add iPhone, iPad or Mac* (``POST /api/app/pairing``) makes a one-time code (ten
minutes, single use) and a ``mantel://pair?…`` link, shown as a QR code: the house's local and remote addresses,
the fingerprint of the house's identity key, and the code. The app trades the code (``grant_type=pairing_code``,
with its DPoP key) for a credential of the person who made it, **on the home network only**.

**The house's identity.** ``<secrets_dir>/app_identity.pem`` (P-256, made on first use). ``GET /api/app/hello
?nonce=…`` answers the house's addresses, its key and a signature over the nonce, so the app can confirm, on each
address and each network change, that it talks to the house it paired with (the pin). It is checked on top of
TLS's own certificate check, not instead of it.

**The web view.** The screens and Settings stay HK's web pages in a ``WKWebView``. ``POST /api/app/web-session``
gives the app a one-time code (60 seconds); the web view opens ``/app/web-session?code=…``, which starts an
ordinary browser session for that person on the door it came by and lands on ``next``. The page never sees
the app's tokens.

**Devices.** ``GET /api/app/devices`` (a person's own; ``?all=1`` everyone's for an Owner or Admin) and
``DELETE /api/app/devices/{id}`` (one's own, or an Owner/Admin's) for Settings → Me → Apps.

Sign in with Apple (link, nonce, verification) is app_apple.py; the REST door and the summary are app_api.py.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

from aiohttp import web

from . import app_crypto, qr
from . import audit
from .accounts import MANAGERS, read_json
from .guards import WHY_APP, guard, open_route
from .guards import ident as guarded
from .login_page import login_url, safe_next
from .sessions import (Identity, door_of, error, ok, set_session_cookies, token_hash, user_from_row)

log = logging.getLogger("mantel.app_auth")

CLIENTS = {"mantel-ios": "Mantel for iPhone and iPad", "mantel-mac": "Mantel for Mac"}
REDIRECT_URI = "mantel://auth"
APP_METHOD = "app"
WEB_METHOD = "app-web"
APP_TTL = 30 * 86400                 # decision M10-3: 30 days, on the tunnel too (device-bound; Face ID in the app)
CODE_TTL = 60.0
PAIRING_TTL = 600.0
WEB_CODE_TTL = 60.0
PROOF_WINDOW = 300.0                 # a DPoP proof's iat may be this far from the server's clock
IDENTITY_FILE = "app_identity.pem"
CHALLENGE = re.compile(r"^[A-Za-z0-9_-]{43}$")
VERIFIER = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")
STATE = re.compile(r"^[A-Za-z0-9._~-]{8,256}$")
NAME_MAX = 64
TOUCH_EVERY = 60.0

AUTHORIZE = "/app/authorize"
WEB_SESSION = "/app/web-session"
TOKEN = "/api/app/token"
HELLO = "/api/app/hello"
PAGE_CSP = ("default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' mantel:; "
            "base-uri 'none'; frame-ancestors 'none'")


# -- one-time codes (memory: a restart only means asking again) -----------------------------------
class Codes:
    def __init__(self, clock) -> None:
        self.clock = clock
        self._codes: dict[str, tuple[float, dict]] = {}

    def make(self, ttl: float, **data: Any) -> str:
        now = self.clock()
        self._codes = {k: v for k, v in self._codes.items() if v[0] > now}
        code = secrets.token_urlsafe(32)
        self._codes[token_hash(code)] = (now + ttl, data)
        return code

    def take(self, code: Any) -> dict | None:
        if not isinstance(code, str) or not code or len(code) > 128:
            return None
        got = self._codes.pop(token_hash(code), None)
        if got is None or got[0] <= self.clock():
            return None
        return got[1]


class Replay:
    """DPoP ``jti``s seen within the proof window: a proof is good once."""

    def __init__(self, clock) -> None:
        self.clock = clock
        self._seen: dict[str, float] = {}

    def fresh(self, jti: str) -> bool:
        now = self.clock()
        if len(self._seen) > 10_000:
            self._seen = {k: t for k, t in self._seen.items() if t > now}
        if jti in self._seen and self._seen[jti] > now:
            return False
        self._seen[jti] = now + 2 * PROOF_WINDOW
        return True


# -- DPoP -----------------------------------------------------------------------------------------
class ProofError(Exception):
    pass


@dataclass(frozen=True)
class Proof:
    jwk: dict
    jkt: str


def check_proof(request: web.Request, *, access: str | None = None, jkt: str | None = None) -> Proof:
    """The request's ``DPoP`` header: a fresh ES256 JWT for this method and path, signed by the key it carries
    (which must be ``jkt`` when given), with ``ath`` the access token's hash when one is presented."""
    st = request.app["app_auth"]
    token = request.headers.get("DPoP")
    if not token:
        raise ProofError("dpop_required")
    try:
        header, claims, signing, sig = app_crypto.split_jwt(token)
        if header.get("typ") != "dpop+jwt" or header.get("alg") != "ES256":
            raise ProofError("dpop_header")
        jwk = header.get("jwk")
        key = app_crypto.key_of_jwk(jwk)
        if not app_crypto.es256_verify(key, signing, sig):
            raise ProofError("dpop_signature")
        thumb = app_crypto.thumbprint(jwk)
    except ProofError:
        raise
    except (ValueError, TypeError, KeyError):
        raise ProofError("dpop_invalid") from None
    if jkt is not None and not hmac.compare_digest(thumb, jkt):
        raise ProofError("dpop_key")
    if claims.get("htm") != request.method:
        raise ProofError("dpop_htm")
    # the path is compared, not the whole URL: a proxy in front may change the scheme or the port Mantel sees
    if urlsplit(str(claims.get("htu") or "")).path != request.path:
        raise ProofError("dpop_htu")
    iat = claims.get("iat")
    if not isinstance(iat, (int, float)) or abs(st.clock() - iat) > PROOF_WINDOW:
        raise ProofError("dpop_stale")
    jti = claims.get("jti")
    if not isinstance(jti, str) or not 8 <= len(jti) <= 128 or not st.replay.fresh(jti):
        raise ProofError("dpop_replay")
    if access is not None:
        want = app_crypto.b64u(hashlib.sha256(access.encode()).digest())
        if not hmac.compare_digest(str(claims.get("ath") or ""), want):
            raise ProofError("dpop_ath")
    return Proof(jwk={k: jwk[k] for k in ("kty", "crv", "x", "y")}, jkt=thumb)


# -- state ----------------------------------------------------------------------------------------
class AppAuth:
    def __init__(self, app: web.Application) -> None:
        self.app = app
        self.clock = lambda: app["clock"]()
        self.codes = Codes(self.clock)
        self.replay = Replay(self.clock)
        self._key = None

    @property
    def db(self):
        return self.app["store"].db

    # the house's identity key (app_crypto.made_key_path)
    def key(self):
        if self._key is None:
            self._key = app_crypto.load_or_create_ec_key(app_crypto.made_key_path(self.app["cfg"], IDENTITY_FILE))
        return self._key

    def fingerprint(self) -> str:
        return app_crypto.fingerprint(self.key().public_key())

    # the house's addresses and name
    def setting(self, key: str) -> str | None:
        row = self.db.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def set_setting(self, key: str, value: str | None) -> None:
        with self.db:
            if value is None:
                self.db.execute("DELETE FROM app_settings WHERE key = ?", (key,))
            else:
                self.db.execute("INSERT INTO app_settings (key, value, updated) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE "
                                "SET value = excluded.value, updated = excluded.updated", (key, value, self.clock()))

    def addresses(self, request: web.Request | None = None) -> dict[str, str | None]:
        cfg = self.app["cfg"]
        remote = self.setting("remote_url") or (cfg.public_url.rstrip("/") if cfg.public_url else None)
        local = self.setting("local_url")
        if local is None and request is not None and door_of(request) == "lan":
            local = origin_of(request)
        return {"local": local, "remote": remote}

    def house_name(self) -> str:
        return self.setting("name") or "Mantel"

    # credentials
    def issue(self, request: web.Request, user_id: str, client_id: str, proof: Proof, device: dict) -> dict:
        mgr = self.app["sessions"]
        name = clean(device.get("name")) or CLIENTS[client_id]
        issued = mgr.create(user_id, "tunnel", APP_METHOD, ttl=APP_TTL, user_agent=name, source_ip=request.remote)
        now = self.clock()
        with self.db:
            self.db.execute("INSERT INTO app_credentials (id, user_id, client_id, name, model, platform, jkt, jwk, created, "
                            "last_seen, last_door) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                            (issued.session_id, user_id, client_id, name, clean(device.get("model")),
                             clean(device.get("platform")), proof.jkt, json.dumps(proof.jwk), now, now, door_of(request)))
        log.info("app credential %s for user %s (%s)", issued.session_id, user_id, client_id)
        return self.token_body(issued, user_id, request)

    def token_body(self, issued, user_id: str, request: web.Request) -> dict:
        row = self.db.execute("SELECT id, username, name, role FROM users WHERE id = ?", (user_id,)).fetchone()
        now = self.clock()
        return {"access_token": issued.access, "token_type": "DPoP", "expires_in": int(issued.access_expires - now),
                "refresh_token": issued.refresh, "refresh_expires_at": issued.expires, "credential_id": issued.session_id,
                "user": {"id": row["id"], "username": row["username"], "name": row["name"], "role": row["role"]},
                "house": self.hello(request)}

    def hello(self, request: web.Request, nonce: str | None = None) -> dict:
        key = self.key()
        fp = self.fingerprint()
        from .apns import push_mode
        out = {"service": "mantel", "name": self.house_name(), "fingerprint": fp,
               "key": app_crypto.b64u(app_crypto.raw_public(key.public_key())), "door": door_of(request),
               "addresses": self.addresses(request), "push": push_mode(self.app)}
        if nonce is not None:
            out["nonce"] = nonce
            out["signature"] = app_crypto.b64u(app_crypto.es256_sign(key, hello_message(nonce, fp)))
        return out

    def revoke(self, cred_id: str, reason: str) -> bool:
        done = self.app["sessions"].revoke(cred_id, reason)
        pusher = self.app.get("pusher")
        if pusher is not None:
            pusher.forget_app(cred_id)
        return done

    def credential(self, cred_id: str):
        return self.db.execute("SELECT * FROM app_credentials WHERE id = ?", (cred_id,)).fetchone()

    # an app's notifications stopped from Mantel Settings (push.delete_target; migration 0020)
    def push_off(self, cred_id: str) -> bool:
        row = self.db.execute("SELECT push_off FROM app_credentials WHERE id = ?", (cred_id,)).fetchone()
        return bool(row and row["push_off"])

    def set_push_off(self, cred_id: str, off: bool) -> None:
        with self.db:
            self.db.execute("UPDATE app_credentials SET push_off = ? WHERE id = ?", (1 if off else 0, cred_id))


def hello_message(nonce: str, fp: str) -> bytes:
    return f"mantel-hello\n{nonce}\n{fp}".encode()


def clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = "".join(c for c in value.strip() if c.isprintable())
    return value[:NAME_MAX] or None


def origin_of(request: web.Request) -> str:
    from . import proxy_trust
    scheme = "https" if proxy_trust.is_https(request) else request.scheme
    return f"{scheme}://{request.host}"


def state_of(request: web.Request) -> AppAuth:
    return request.app["app_auth"]


# -- resolving an app's request -------------------------------------------------------------------
class AppDenied(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def resolve(request: web.Request) -> Identity:
    """The person an app's request is for: ``Authorization: DPoP <access token>`` and a proof by the credential's
    key. Sets ``request["identity"]`` (so RBAC, user data and the gateway see that person on this door)."""
    cached = request.get("app_identity")
    if cached is not None:
        return cached
    st = state_of(request)
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("DPoP "):
        raise AppDenied("app_token_required")
    access = auth[5:].strip()
    now = st.clock()
    row = request.app["sessions"].from_access(access, now)
    if row is None or row["method"] != APP_METHOD:
        raise AppDenied("invalid_token")
    cred = st.credential(row["id"])
    if cred is None:
        raise AppDenied("invalid_token")
    try:
        check_proof(request, access=access, jkt=cred["jkt"])
    except ProofError as exc:
        log.warning("app request refused for credential %s: %s", row["id"], exc)
        raise AppDenied(str(exc)) from None
    door = door_of(request)
    if door == "ha":
        raise AppDenied("not_through_ha")
    ident = Identity(user=user_from_row(row), device=None, door=door, fresh_factor_at=row["fresh_factor_at"],
                     fresh_factor=row["fresh_factor"], session_id=row["id"], csrf=None)
    if cred["last_seen"] is None or now - cred["last_seen"] >= TOUCH_EVERY or cred["last_door"] != door:
        with st.db:
            st.db.execute("UPDATE app_credentials SET last_seen = ?, last_door = ? WHERE id = ?", (now, door, row["id"]))
        request.app["sessions"].touch(row, now, request.remote)
    request["identity"] = ident
    request["app_identity"] = ident
    return ident


def denied(code: str) -> web.Response:
    return web.json_response({"error": code}, status=401, headers={
        "Cache-Control": "no-store", "WWW-Authenticate": f'DPoP error="invalid_token", error_description="{code}"'})


def app_route(handler):
    """A route for apps only: resolved from the DPoP-bound token (never a cookie), refused otherwise."""
    async def wrapped(request: web.Request) -> web.StreamResponse:
        try:
            resolve(request)
        except AppDenied as exc:
            return denied(exc.code)
        return await handler(request)
    wrapped.__name__ = getattr(handler, "__name__", "app_route")
    wrapped.__app_route__ = True          # the route table's structural proof for kind app_dpop (route_table.py R7)
    wrapped.__app_route_handler__ = handler
    return wrapped


# -- /app/authorize -------------------------------------------------------------------------------
def _params(src) -> dict | str:
    p = {k: src.get(k) for k in ("client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state",
                                 "device_name")}
    if p["client_id"] not in CLIENTS:
        return "unknown_client"
    if p["redirect_uri"] != REDIRECT_URI:
        return "bad_redirect_uri"
    if p["code_challenge_method"] != "S256" or not CHALLENGE.match(p["code_challenge"] or ""):
        return "pkce_required"
    if not STATE.match(p["state"] or ""):
        return "bad_state"
    p["device_name"] = clean(p["device_name"])
    return p


def _page(title: str, body: str, status: int = 200) -> web.Response:
    doc = (f"<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
           f"<title>{html.escape(title)}</title><style>"
           "body{margin:0;font:17px -apple-system,system-ui,sans-serif;background:#f2f2f7;color:#000;"
           "padding:max(48px,env(safe-area-inset-top)) 20px 40px;text-align:center}"
           "@media (prefers-color-scheme:dark){body{background:#000;color:#fff}.card{background:#1c1c1e!important}}"
           "h1{font-size:28px;margin:0 0 8px}.card{background:#fff;border-radius:12px;padding:16px;margin:24px auto;max-width:420px}"
           "p{color:#8e8e93;margin:6px 0}button{display:block;width:100%;max-width:420px;margin:12px auto 0;padding:14px;"
           "border:0;border-radius:12px;font:inherit;font-weight:600;background:#007aff;color:#fff}"
           "button.cx{background:none;color:#007aff;font-weight:400}</style>"
           f"<h1>{html.escape(title)}</h1>{body}</html>")
    return web.Response(text=doc, status=status, content_type="text/html",
                        headers={"Cache-Control": "no-store", "Content-Security-Policy": PAGE_CSP,
                                 "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY"})
# same-origin, never no-referrer: under no-referrer a browser sends `Origin: null` with the page's own Allow form, and
# Mantel's Origin check (server.loopback_only) refuses it as "bad Origin" (seen adding a house by hand)


def _back_to_app(state: str | None, **query: str) -> web.StreamResponse:
    raise web.HTTPFound(REDIRECT_URI + "?" + urlencode({**query, **({"state": state} if state else {})}),
                         headers={"Cache-Control": "no-store"})


@open_route("sign_in", why="the app's sign-in page: the person signs in there (app_auth.py)")
async def authorize_page(request: web.Request) -> web.StreamResponse:
    from .sessions import identity
    p = _params(request.query)
    if isinstance(p, str):
        return _page("Can’t Sign In", f"<p>This sign-in link is not valid ({html.escape(p)}).</p>", 400)
    ident = identity(request)
    if ident.device is not None:
        return _page("Can’t Sign In Here", "<p>This browser is a wall tablet. Sign in to the app on your own phone.</p>", 403)
    if ident.user is None:
        raise web.HTTPFound(login_url(request.path_qs), headers={"Cache-Control": "no-store"})
    who = ident.user.name or ident.user.username or "you"
    device = f" on “{html.escape(p['device_name'])}”" if p["device_name"] else ""
    hidden = "".join(f"<input type=hidden name={k} value='{html.escape(v or '', quote=True)}'>" for k, v in p.items())
    body = (f"<div class=card><p>{html.escape(CLIENTS[p['client_id']])}{device} will sign in as</p>"
            f"<h2>{html.escape(who)}</h2><p>It can do what you may do in Mantel, for 30 days, from this device only.</p></div>"
            f"<form method=post action='{AUTHORIZE}'>{hidden}<input type=hidden name=csrf value='{html.escape(ident.csrf or '', quote=True)}'>"
            "<button name=decision value=allow>Allow</button><button class=cx name=decision value=deny>Cancel</button></form>")
    return _page("Sign In to Mantel", body)


@open_route("sign_in", why="the app's sign-in page: the person signs in there (app_auth.py)")
async def authorize_post(request: web.Request) -> web.StreamResponse:
    from .sessions import identity
    form = await request.post()
    p = _params(form)
    if isinstance(p, str):
        return _page("Can’t Sign In", f"<p>This sign-in link is not valid ({html.escape(p)}).</p>", 400)
    ident = identity(request)
    if ident.user is None or ident.device is not None:
        raise web.HTTPFound(login_url(AUTHORIZE + "?" + urlencode({k: v for k, v in p.items() if v})))
    sent = form.get("csrf") or ""
    if not ident.csrf or not hmac.compare_digest(str(sent), ident.csrf):
        return _page("Can’t Sign In", "<p>The page was out of date. Go back to the app and try again.</p>", 403)
    if form.get("decision") != "allow":
        _back_to_app(p["state"], error="access_denied")
    code = state_of(request).codes.make(CODE_TTL, kind="code", user_id=ident.user.id, client_id=p["client_id"],
                                        challenge=p["code_challenge"], name=p["device_name"], by=ident.session_id)
    _back_to_app(p["state"], code=code)


# -- /api/app/token -------------------------------------------------------------------------------
@open_route("sign_in", why="the app's sign-in: a one-time code with its PKCE verifier and a DPoP proof, or a refresh "
                          "token with the device's own key (no session yet)")
async def token(request: web.Request) -> web.Response:
    st = state_of(request)
    try:
        body = await read_json(request)
    except web.HTTPException:
        return error(400, "invalid_request")
    grant = body.get("grant_type")
    if door_of(request) == "ha":
        return error(403, "not_through_ha")
    try:
        if grant == "refresh_token":
            return await _refresh(request, st, body)
        if grant not in ("authorization_code", "pairing_code"):
            return error(400, "unsupported_grant_type")
        proof = check_proof(request)
    except ProofError as exc:
        return error(401, "invalid_dpop_proof", reason=str(exc))
    device = body.get("device") if isinstance(body.get("device"), dict) else {}
    client_id = body.get("client_id")
    if client_id not in CLIENTS:
        return error(400, "unknown_client")
    got = st.codes.take(body.get("code"))
    if grant == "authorization_code":
        if got is None or got.get("kind") != "code" or got["client_id"] != client_id:
            return error(400, "invalid_grant")
        if body.get("redirect_uri") != REDIRECT_URI:
            return error(400, "invalid_grant")
        verifier = body.get("code_verifier")
        if not isinstance(verifier, str) or not VERIFIER.match(verifier):
            return error(400, "invalid_grant")
        expect = app_crypto.b64u(hashlib.sha256(verifier.encode()).digest())
        if not hmac.compare_digest(expect, got["challenge"]):
            return error(400, "invalid_grant")
        device = {**device, "name": device.get("name") or got.get("name")}
    else:
        if got is None or got.get("kind") != "pairing":
            return error(400, "invalid_grant")
        if door_of(request) != "lan":
            return error(403, "lan_only", message="Pairing codes work on the home network only.")
    user = request.app["store"].db.execute("SELECT disabled FROM users WHERE id = ?", (got["user_id"],)).fetchone()
    if user is None or user["disabled"]:
        return error(400, "invalid_grant")
    # a code is only as good as the session that made it: signed out, or ended by a password change or reset
    # (sessions.revoke_user), its codes go with it, as the docs promise for the person's cookies
    if got.get("by") is not None and request.app["sessions"].get(got["by"], st.clock()) is None:
        return error(400, "invalid_grant")
    return web.json_response(st.issue(request, got["user_id"], client_id, proof, device),
                             headers={"Cache-Control": "no-store"})


async def _refresh(request: web.Request, st: AppAuth, body: dict) -> web.Response:
    mgr = request.app["sessions"]
    refresh_token = body.get("refresh_token")
    if not isinstance(refresh_token, str):
        return error(400, "invalid_grant")
    rt = st.db.execute("SELECT session_id FROM refresh_tokens WHERE hash = ?", (token_hash(refresh_token),)).fetchone()
    cred = st.credential(rt["session_id"]) if rt is not None else None
    if cred is None:
        return error(400, "invalid_grant")
    check_proof(request, jkt=cred["jkt"])           # the device's own key, or nothing
    status, value = mgr.rotate(refresh_token, st.clock(), allow_app=True)
    if status == "ok":
        issued, _row = value
        return web.json_response(st.token_body(issued, cred["user_id"], request), headers={"Cache-Control": "no-store"})
    if status == "grace":
        return error(409, "refresh_in_flight", message="Another refresh just happened; use its tokens.")
    if status == "reuse":
        pusher = request.app.get("pusher")
        if pusher is not None:
            pusher.forget_app(cred["id"])
    return error(400, "invalid_grant", reason=status)


# -- the house ------------------------------------------------------------------------------------
@open_route("sign_in", why="the app asks who this house is before it has a credential: the house's name, public key "
                          "and addresses, and a signed nonce (no session yet)")
async def hello(request: web.Request) -> web.Response:
    nonce = request.query.get("nonce")
    if nonce is not None and not re.match(r"^[A-Za-z0-9_-]{16,128}$", nonce):
        return error(400, "bad_nonce")
    return web.json_response(state_of(request).hello(request, nonce), headers={"Cache-Control": "no-store"})


@guard("person", device_ok=True, reads="none",
       why="the house's addresses, name and key fingerprint, for pairing the app: no house state")
async def get_addresses(request: web.Request) -> web.Response:
    st = state_of(request)
    return ok({"addresses": st.addresses(request), "name": st.house_name(), "fingerprint": st.fingerprint(),
               "short_code": app_crypto.short_code(st.fingerprint())})


def _url_or_none(value: Any) -> str | None | bool:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or len(value) > 256:
        return False
    p = urlsplit(value.strip())
    if p.scheme != "https" or not p.hostname or p.path not in ("", "/") or p.query or p.fragment or p.username:
        return False
    return f"https://{p.netloc}"


@guard("manager", device_ok=True, audit="app.addresses")
async def put_addresses(request: web.Request) -> web.Response:
    ident = guarded(request)
    body = await read_json(request)
    st = state_of(request)
    changes: dict[str, Any] = {}
    for key, field in (("local_url", "local"), ("remote_url", "remote")):
        if field in body:
            url = _url_or_none(body[field])
            if url is False:
                return error(400, "invalid", message="An address is https://name[:port], nothing after it.")
            changes[key] = url
    if "name" in body:
        changes["name"] = clean(body["name"])
    if changes:
        audit.config(request, ident, "app.addresses", changes)
    for key, value in changes.items():
        st.set_setting(key, value)
    return ok({"addresses": st.addresses(request), "name": st.house_name()})


# -- pairing --------------------------------------------------------------------------------------
@guard("person", no_audit="a one-time code for the person's own phone: the app it signs in is theirs, listed in "
                         "Me → Mantel App, and revoking it is audited (app.revoke)")
async def pairing(request: web.Request) -> web.Response:
    ident = guarded(request)
    st = state_of(request)
    code = st.codes.make(PAIRING_TTL, kind="pairing", user_id=ident.user.id, by=ident.session_id)
    addr = st.addresses(request)
    fp = st.fingerprint()
    link = "mantel://pair?" + urlencode({"v": "1", **({"l": addr["local"]} if addr["local"] else {}),
                                          **({"r": addr["remote"]} if addr["remote"] else {}),
                                          "fp": fp, "c": code, "n": st.house_name()}, quote_via=quote)
    return ok({"link": link, "qr_svg": qr.svg(link, scale=4), "expires_in": int(PAIRING_TTL),
               "short_code": app_crypto.short_code(fp), "addresses": addr}, status=201)


# -- the web view's session -----------------------------------------------------------------------
@open_route("app_dpop", why=WHY_APP)
@app_route
async def web_session_code(request: web.Request) -> web.Response:
    ident = request["app_identity"]
    try:
        body = await read_json(request)
    except web.HTTPException:
        body = {}
    nxt = safe_next(body.get("next"))
    code = state_of(request).codes.make(WEB_CODE_TTL, kind="web", user_id=ident.user.id, cred=ident.session_id, next=nxt)
    return ok({"url": WEB_SESSION + "?code=" + quote(code), "expires_in": int(WEB_CODE_TTL)})


@open_route("one_time_code", reads="none",
            why="the app's web view: a single-use code from its DPoP-bound /api/app/web-session; it starts a "
                "session and redirects, and answers no house data")
async def web_session(request: web.Request) -> web.StreamResponse:
    st = state_of(request)
    got = st.codes.take(request.query.get("code"))
    if got is None or got.get("kind") != "web":
        return _page("Can’t Open Mantel", "<p>This link has run out. Go back to the app and try again.</p>", 400)
    mgr = request.app["sessions"]
    if mgr.get(got["cred"], st.clock()) is None:      # the app was signed out or revoked in between
        return _page("Can’t Open Mantel", "<p>This app is no longer signed in.</p>", 403)
    door = door_of(request)
    if door not in ("lan", "tunnel"):
        return _page("Can’t Open Mantel", "<p>Not through Home Assistant.</p>", 403)
    # not a sign-in made just now (fresh=False): the app's credential lives 30 days, and its web view must
    # still Confirm It Is You for what asks for that, as any other session does
    # one web session per app: the app keeps the web view's cookies only while it runs, so the one it was handed
    # last time is gone with them (0022_app_web_parent); and it ends when the app is signed out
    for old in mgr.children(got["cred"], WEB_METHOD):
        mgr.revoke(old, "app_web_replaced")
    issued = mgr.create(got["user_id"], door, WEB_METHOD, fresh=False, user_agent=request.headers.get("User-Agent"),
                        source_ip=request.remote, parent=got["cred"])
    resp = web.HTTPFound(got["next"], headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    set_session_cookies(request, resp, issued)
    raise resp


# -- the apps signed in as a person (Me → Apps) -----------------------------------------------------
def _cred_json(row, now: float) -> dict:
    return {"id": row["id"], "user_id": row["user_id"], "client_id": row["client_id"], "name": row["name"],
            "model": row["model"], "platform": row["platform"], "created": row["created"], "last_seen": row["last_seen"],
            "last_door": row["last_door"], "expires": row["expires"]}


@guard("person", device_ok=True, reads="self")
async def list_devices(request: web.Request) -> web.Response:
    ident = guarded(request)
    st = state_of(request)
    everyone = request.query.get("all") == "1"
    # everyone's apps are People's (an Owner's or Admin's), never from a wall tablet, even a manager signed in at one
    # (the route table's review, 2026-11-03: a forgotten sign-in on the kitchen tablet lists the house's phones)
    if everyone and (ident.user.role not in MANAGERS or ident.device is not None):
        return error(403, "forbidden")
    now = st.clock()
    sql = ("SELECT c.*, s.expires, u.name AS user_name FROM app_credentials c JOIN sessions s ON s.id = c.id "
           "JOIN users u ON u.id = c.user_id WHERE s.revoked IS NULL AND s.expires > ?")
    args: list = [now]
    if not everyone:
        sql += " AND c.user_id = ?"
        args.append(ident.user.id)
    rows = st.db.execute(sql + " ORDER BY c.created", args).fetchall()
    return ok({"apps": [{**_cred_json(r, now), "user_name": r["user_name"],
                         "current": r["id"] == ident.session_id} for r in rows]})


@guard("person", device_ok=True, audit="app.revoke")
async def revoke_device(request: web.Request) -> web.Response:
    ident = guarded(request)
    st = state_of(request)
    cred = st.credential(request.match_info["id"])
    if cred is None:
        return error(404, "not_found")
    if cred["user_id"] != ident.user.id:
        if ident.device is not None:            # another person's app: People's, never from a wall tablet
            return error(404, "not_found")
        owner = st.db.execute("SELECT role FROM users WHERE id = ?", (cred["user_id"],)).fetchone()
        role = owner["role"] if owner else None
        if not (ident.user.role == "owner" or (ident.user.role == "admin" and role != "owner")):
            return error(404, "not_found")
    audit.config(request, ident, "app.revoke", {"app": cred["id"], "user": cred["user_id"], "name": cred["name"]})
    st.revoke(cred["id"], "revoked_by_user")
    return ok()


@open_route("app_dpop", why=WHY_APP)
@app_route
async def sign_out(request: web.Request) -> web.Response:
    ident = request["app_identity"]
    state_of(request).revoke(ident.session_id, "app_signed_out")
    return ok()


@open_route("app_dpop", reads="self", why=WHY_APP)    # the caller's own user record and credential
@app_route
async def me(request: web.Request) -> web.Response:
    ident = request["app_identity"]
    st = state_of(request)
    u = ident.user
    gw = request.app.get("gateway")
    return ok({"user": {"id": u.id, "username": u.username, "name": u.name, "role": u.role},
               "door": ident.door, "commands": gw is not None, "house": st.hello(request),
               "credential_id": ident.session_id, "push_off": st.push_off(ident.session_id)})


def register(app: web.Application, hub=None) -> AppAuth:
    st = AppAuth(app)
    app["app_auth"] = st
    app.router.add_get(AUTHORIZE, authorize_page)
    app.router.add_post(AUTHORIZE, authorize_post)
    app.router.add_get(WEB_SESSION, web_session)
    app.router.add_post(TOKEN, token)
    app.router.add_get(HELLO, hello)
    app.router.add_get("/api/app/addresses", get_addresses)
    app.router.add_put("/api/app/addresses", put_addresses)
    app.router.add_post("/api/app/pairing", pairing)
    app.router.add_get("/api/app/devices", list_devices)
    app.router.add_delete("/api/app/devices/{id}", revoke_device)
    app.router.add_post("/api/app/web-session", web_session_code)
    app.router.add_post("/api/app/sign-out", sign_out)
    app.router.add_get("/api/app/me", me)
    # the apps' own routes resolve their DPoP-bound token themselves (app_route); /app/authorize decides for itself
    # (a signed-out browser goes to /login, a wall tablet is refused)
    app.setdefault("public_paths", set()).update({AUTHORIZE, WEB_SESSION, TOKEN, HELLO, "/api/app/web-session",
                                                  "/api/app/sign-out", "/api/app/me"})
    return st
