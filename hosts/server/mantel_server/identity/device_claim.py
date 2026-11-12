"""Pairing a tablet app by code (docs/phase26/ANDROID-APP.md "Enrolling a tablet without a password on it").

A wall tablet's credential is a cookie in the browser that shows its page (devices.py). A tablet that moves to another
app (Mantel for Android's own WebView) is a new browser, and enrolling it the old way means an Owner signing in on the
tablet. Instead:

* An Owner or Admin makes a **one-time code** for one of HK's wall tablets (or a room):
  ``POST /api/devices/claim-codes`` {tablet | room, name?} -> {code: "ABCD-2345", expires_in}. Eight letters and
  digits from an alphabet with no look-alikes, ten minutes, single use, kept only in memory (a restart only means
  making another). Audited (``device.claim_code``), without the code.
* The tablet opens ``/device/claim`` (the app puts the code in the address's fragment, which never reaches a log) and
  posts it to ``POST /api/devices/claim``: **on the home network only**, five wrong codes a minute from one address and
  it waits. The browser becomes that tablet: ``devices.DeviceManager.enroll`` with the Wall Tablet role and the code's
  room, the ``mantel_device`` cookie set as enrolling sets it. Audited as ``device.enroll`` by the person who made the
  code (``via: claim_code``).
"""
from __future__ import annotations

import html
import logging
import secrets
from dataclasses import dataclass
from typing import Any

from aiohttp import web

from .. import devices as D
from ..storage import audit
from .accounts import AttemptLimiter, limited, read_json
from .guards import guard, open_route
from .guards import ident as guarded
from .sessions import CSRF_COOKIE, Device, client_ip, device_json, door_of, error, ok

log = logging.getLogger("mantel.device_claim")

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"     # no 0/O, 1/I/L
LENGTH = 8
TTL = 600.0
TRIES, TRY_WINDOW = 5, 60.0
CLAIM_PAGE = "/device/claim"
CLAIM_API = "/api/devices/claim"
CODES_API = "/api/devices/claim-codes"
WHY_CLAIM = ("a tablet app pairing with a one-time code an Owner or Admin made: the code is the check (home network "
             "only, rate limited); it enrolls this browser as that tablet and answers no house data")


def normalize(text: Any) -> str | None:
    """What was typed, as the code: case and dashes and spaces don't matter. None when it can't be one."""
    if not isinstance(text, str) or len(text) > 64:
        return None
    t = "".join(ch for ch in text.upper() if ch not in " -")
    return t if len(t) == LENGTH and all(ch in ALPHABET for ch in t) else None


def shown(code: str) -> str:
    return code[:4] + "-" + code[4:]


@dataclass
class Claim:
    expires: float
    name: str
    room: str | None
    tablet: str | None
    maker: Any                       # the person who made it (sessions.User): the enrolment's actor


class ClaimCodes:
    def __init__(self, clock) -> None:
        self.clock = clock
        self._codes: dict[str, Claim] = {}
        self.tries = AttemptLimiter(TRIES, TRY_WINDOW, clock)

    def make(self, name: str, room: str | None, tablet: str | None, maker: Any) -> str:
        now = self.clock()
        self._codes = {k: v for k, v in self._codes.items() if v.expires > now}
        while True:
            code = "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
            if code not in self._codes:
                break
        self._codes[code] = Claim(now + TTL, name, room, tablet, maker)
        return code

    def take(self, text: Any) -> Claim | None:
        code = normalize(text)
        got = self._codes.pop(code, None) if code else None
        if got is None or got.expires <= self.clock():
            return None
        return got


def codes_of(app: web.Application) -> ClaimCodes:
    if "device_claims" not in app:
        app["device_claims"] = ClaimCodes(app["clock"])
    return app["device_claims"]


@guard("manager", audit="device.claim_code", reads="none",
       why="answers the new code and when it runs out, nothing of the house")
async def make_code(request: web.Request) -> web.Response:
    ident = guarded(request)
    body = await read_json(request)
    try:
        room = D.chosen_room(request.app, body, strict=False)
    except D.RoomError as exc:
        return error(400, str(exc), message=D.ROOM_MESSAGES.get(str(exc)))
    if room is None:
        return error(400, "room_required", message="Choose one of HK’s wall tablets or a room.")
    tablet = body.get("tablet") if isinstance(body.get("tablet"), str) else None
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        name = (D.hk_tablets(request.app).get(tablet) or {}).get("name") if tablet else None
        name = name or room.replace("_", " ").title()
    name = str(name).strip()[:64]
    audit.config(request, ident, "device.claim_code", {"tablet": tablet, "room": room, "name": name,
                                                       "expires_in": int(TTL)})
    code = codes_of(request.app).make(name, room, tablet, ident.user)
    return ok({"code": shown(code), "expires_in": int(TTL), "name": name, "url": CLAIM_PAGE}, status=201)


@open_route("one_time_code", why=WHY_CLAIM, reads="none")
async def claim(request: web.Request) -> web.Response:
    if door_of(request) != "lan":
        return error(403, "lan_only", message="A tablet pairs on the home network only.")
    st = codes_of(request.app)
    who = client_ip(request) or "?"
    wait = st.tries.retry_after(who)
    if wait > 0:
        return limited(wait)
    try:
        body = await read_json(request)
    except web.HTTPException:
        body = {}
    got = st.take(body.get("code"))
    if got is None:
        st.tries.fail(who)
        return error(403, "invalid_code", message="That code isn’t right, or it ran out. Make a new one in Mantel Settings.")
    st.tries.reset(who)
    mgr: D.DeviceManager = request.app["devices"]
    device_id = secrets.token_hex(16)
    audit.config(request, got.maker, "device.enroll", {"device": device_id, "name": got.name, "role": "wall_tablet",
                                                       "room": got.room, "tablet": got.tablet, "via": "claim_code"})
    device_id, secret, csrf = mgr.enroll(got.name, "wall_tablet", got.room, getattr(got.maker, "id", None),
                                         client_ip(request), device_id=device_id)
    row = mgr.get(device_id)
    resp = ok({"device": device_json(Device(row["id"], row["name"], row["role"], row["room"]))}, status=201)
    resp.set_cookie(D.DEVICE_COOKIE, secret, **D.device_cookie_opts(request))
    resp.set_cookie(CSRF_COOKIE, csrf, **{**D.device_cookie_opts(request), "httponly": False})
    resp.headers["Cache-Control"] = "no-store"
    log.info("tablet %s paired by code (%s)", device_id, got.room)
    return resp


PAGE_SCRIPT = """
const f = document.querySelector('form'), c = document.querySelector('#code'), p = document.querySelector('#problem');
const h = new URLSearchParams(location.hash.slice(1)).get('code');
if (h) { c.value = h; history.replaceState(null, '', location.pathname); }
f.addEventListener('submit', async (e) => {
  e.preventDefault(); p.textContent = '';
  const r = await fetch('/api/devices/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: c.value }) }).catch(() => null);
  if (r && r.ok) { location.replace('/home'); return; }
  const j = r ? await r.json().catch(() => ({})) : {};
  p.textContent = j.message || 'Mantel didn’t answer. Try again.';
});
if (h) f.requestSubmit();
"""


@open_route("static", why="the page a tablet types its pairing code on: a form, no house data; the code is checked "
                          "by POST /api/devices/claim")
async def claim_page(request: web.Request) -> web.Response:
    nonce = secrets.token_urlsafe(16)
    doc = ("<!doctype html><html lang=en><meta charset=utf-8>"
           "<meta name=viewport content='width=device-width,initial-scale=1'><title>Pair This Tablet</title><style>"
           "body{margin:0;font:18px -apple-system,system-ui,sans-serif;background:#000;color:#fff;text-align:center;"
           "padding:72px 20px}h1{font-size:30px;margin:0 0 8px}p{color:#98989f;margin:6px auto;max-width:460px}"
           "input{font:600 32px ui-monospace,monospace;letter-spacing:4px;text-align:center;text-transform:uppercase;"
           "width:min(320px,90%);padding:14px;margin:28px auto 8px;border-radius:14px;border:0;background:#1c1c1e;"
           "color:#fff;display:block}button{font:600 18px inherit;padding:14px 40px;border:0;border-radius:14px;"
           "background:#0a84ff;color:#fff;margin-top:12px}#problem{color:#ff6961;min-height:1.4em}</style>"
           "<h1>Pair This Tablet</h1><p>Enter the code from Mantel Settings → All Screens → Wall Tablets → the tablet → "
           "Pair a Tablet App.</p><form><input id=code autocomplete=off autocapitalize=characters spellcheck=false "
           "maxlength=9 placeholder=ABCD-2345 aria-label='Pairing code'><p id=problem role=alert></p>"
           "<button type=submit>Pair</button></form>"
           f"<script nonce='{html.escape(nonce)}'>{PAGE_SCRIPT}</script></html>")
    csp = (f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; connect-src 'self'; "
           "form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
    return web.Response(text=doc, content_type="text/html",
                        headers={"Cache-Control": "no-store", "Content-Security-Policy": csp,
                                 "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY"})


def register(app: web.Application) -> None:
    codes_of(app)
    app.router.add_post(CODES_API, make_code)
    app.router.add_get(CLAIM_PAGE, claim_page)
    app.router.add_post(CLAIM_API, claim)
    app.setdefault("public_paths", set()).update({CLAIM_PAGE, CLAIM_API})
