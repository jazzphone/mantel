"""Notifications to the iPhone, iPad and Mac apps through Apple's push service (docs/phase10/APPLE-APPS.md §5,
slice 10.5; decision M10-2: no relay while the app is TestFlight-only, the house sends to APNs itself).

* **Registration**: the app sends its APNs device token and the public half of a notification key it keeps in
  its Keychain (``POST /api/app/push/register``, app_api.py). The row is a push target of kind ``apns`` bound to
  the app's credential: signing the app out removes it.
* **End-to-end**: the notification's words, the accessory and the snapshot's id are sealed to that key
  (app_crypto.seal_for_device: ECDH + HKDF-SHA256 + AES-256-GCM) under ``"m"``; the visible alert Apple carries
  says only "Mantel" / "New notification". The Notification Service Extension opens ``"m"`` on the phone and shows
  the real words (``mutable-content: 1``), and groups them by the sealed tag (``threadIdentifier``). Apple sees a
  device token and ciphertext.
* **The tag** (the notification's mute key, e.g. which accessory) never leaves sealed: no ``thread-id``, and the
  ``apns-collapse-id`` (a newer notification replaces an older one) is a keyed hash of it (``collapse_id``), keyed by
  a secret only the house has and different for each phone. The relay and Apple see only that two notifications to
  one phone share a tag, not which.
* **Interruption levels**: Important notifications are ``time-sensitive`` (through Focus; no Apple approval needed).
  Critical alerts need Apple's entitlement and are not used.
* **The key** (the app publisher's developer account): ``<secrets_dir>/apns_key.p8`` (the .p8 Apple gives) and
  ``<secrets_dir>/apns.json`` ``{"key_id", "team_id", "topic"}`` (topic: the app's bundle id). Secret files,
  never the database, a log or an env var. Without them nothing is sent (the target stays; ``not_configured``).
* **Transport**: APNs speaks only HTTP/2. aiohttp does not, so sending directly needs ``httpx[http2]``, the optional
  extra ``mantel[apns-direct]`` (not in Mantel's images: direct sending is a developer's setup; the relay needs
  none of it). With the key files present and the extra missing, the server says so at startup (``check_direct``)
  and ``send`` answers ``failed``; the tests use an injected transport.

UNVERIFIED until the Apple Developer account exists (M10-6): the provider token and request shape follow Apple's
documentation; the app's side is tested in the Simulator with ``xcrun simctl push`` (apple/README.md).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import app_crypto, audit
from .guards import guard
from .guards import ident as guarded

log = logging.getLogger("mantel.apns")

KEY_FILE = "apns_key.p8"
CONF_FILE = "apns.json"
HOSTS = {"production": "https://api.push.apple.com", "sandbox": "https://api.sandbox.push.apple.com"}
TOKEN_EVERY = 50 * 60                   # Apple wants a new provider token at most hourly, and no more than every 20 min
GONE_REASONS = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"}

Transport = Callable[[str, dict, bytes], Awaitable[tuple[int, dict]]]   # (url, headers, body) -> (status, json)
EXTRA = "mantel[apns-direct]"


def collapse_secret(identity_key) -> bytes:
    """The key of the collapse ids: derived from the house's identity key (a secret file), so nothing new to keep."""
    raw = identity_key.private_numbers().private_value.to_bytes(32, "big")
    return hmac.new(raw, b"mantel-collapse-v1", hashlib.sha256).digest()


def collapse_id(secret: bytes, device_key: bytes, tag: str) -> str:
    """The tag as the relay and Apple see it (``apns-collapse-id``): the same for the same tag to the same phone, so a
    newer notification still replaces an older one; without the house's secret it says nothing of the tag, and two
    phones get different ids for one tag."""
    mac = hmac.new(secret, device_key + b"\n" + tag.encode(), hashlib.sha256).digest()
    return app_crypto.b64u(mac[:24])           # 32 characters; Apple allows 64


def http2_missing() -> str | None:
    """What direct sending lacks to speak HTTP/2 (``httpx`` and ``h2``), or None."""
    for name in ("httpx", "h2"):
        try:
            __import__(name)
        except ImportError:
            return name
    return None


def build_payload(msg: Any, device_key: bytes) -> dict:
    """The APNs payload for one notification: a generic visible alert, the real one sealed to the phone. The tag is
    sealed too: the extension groups by it (threadIdentifier), so ``aps`` has no ``thread-id``."""
    category = getattr(msg, "category", None)
    inner = {"title": msg.title, "body": msg.body, "entity": msg.entity, "snap": msg.snap, "camera": msg.camera,
             "tag": msg.tag, "url": msg.url, "important": msg.important, "id": msg.id, "category": category,
             "level": getattr(msg, "level", None)}
    sealed = app_crypto.seal_for_device(json.dumps({k: v for k, v in inner.items() if v is not None},
                                                   separators=(",", ":")).encode(), device_key)
    level = "time-sensitive" if msg.important else "active"
    if category in ("system", "timeline"):    # a system alert (or the morning digest): Critical breaks through Focus,
        # Info waits in the summary
        level = {"critical": "time-sensitive", "info": "passive"}.get(getattr(msg, "level", None) or "", "active")
    aps: dict[str, Any] = {"alert": {"title": "Mantel", "body": "New notification"}, "mutable-content": 1,
                           "sound": "default", "interruption-level": level}
    if msg.entity:
        aps["category"] = "MANTEL_ACCESSORY"
    return {"aps": aps, "m": sealed}


class Apns:
    def __init__(self, secrets_dir: Path, clock: Callable[[], float] = time.time, transport: Transport | None = None,
                 secret: Callable[[], bytes] | None = None):
        self.secrets_dir = Path(secrets_dir).expanduser()
        self.clock = clock
        self.transport = transport
        self.secret = secret                   # the collapse ids' key (collapse_secret); without it, none is sent
        self._token: tuple[float, str] | None = None

    def config(self) -> dict | None:
        try:
            conf = json.loads((self.secrets_dir / CONF_FILE).read_text())
            key = (self.secrets_dir / KEY_FILE).read_bytes()
        except (OSError, ValueError):
            return None
        if not all(isinstance(conf.get(k), str) and conf[k] for k in ("key_id", "team_id", "topic")):
            return None
        return {**conf, "key": key}

    def provider_token(self, conf: dict) -> str:
        now = self.clock()
        if self._token is not None and now - self._token[0] < TOKEN_EVERY:
            return self._token[1]
        from cryptography.hazmat.primitives import serialization
        key = serialization.load_pem_private_key(conf["key"], password=None)
        tok = app_crypto.es256_jwt(key, {"iss": conf["team_id"], "iat": int(now)}, {"kid": conf["key_id"], "typ": None})
        self._token = (now, tok)
        return tok

    async def _default_transport(self, url: str, headers: dict, body: bytes) -> tuple[int, dict]:
        missing = http2_missing()
        if missing is not None:
            log.warning("APNs needs HTTP/2: %s is not installed (pip install '%s'); nothing sent", missing, EXTRA)
            return 0, {"reason": "transport_missing"}
        import httpx  # type: ignore[import-not-found]
        async with httpx.AsyncClient(http2=True, timeout=10.0) as client:
            r = await client.post(url, headers=headers, content=body)
            try:
                return r.status_code, r.json() if r.content else {}
            except ValueError:
                return r.status_code, {}

    async def send(self, row: dict, msg: Any) -> str:
        conf = self.config()
        if conf is None:
            log.info("APNs is not configured (no %s / %s); the app's notification was not sent", KEY_FILE, CONF_FILE)
            return "skipped"
        topic = conf["topic"]
        if row.get("platform") == "mac":     # the menu bar app's own bundle id (apns.json "mac_topic")
            topic = conf.get("mac_topic") if isinstance(conf.get("mac_topic"), str) and conf.get("mac_topic") else None
            if topic is None:
                log.info("APNs: no mac_topic in %s; the Mac app's notification was not sent", CONF_FILE)
                return "skipped"
        device_key = app_crypto.unb64u(row["p256dh"])
        payload = build_payload(msg, device_key)
        host = HOSTS["sandbox" if row.get("env") == "sandbox" else "production"]
        headers = {"authorization": "bearer " + self.provider_token(conf), "apns-topic": topic,
                   "apns-push-type": "alert", "apns-priority": "10" if msg.important else "5",
                   "content-type": "application/json"}
        if msg.tag and self.secret is not None:
            headers["apns-collapse-id"] = collapse_id(self.secret(), device_key, msg.tag)
        status, body = await (self.transport or self._default_transport)(
            f"{host}/3/device/{row['endpoint']}", headers, json.dumps(payload, separators=(",", ":")).encode())
        if status == 200:
            return "ok"
        reason = (body or {}).get("reason")
        if status == 410 or reason in GONE_REASONS:
            return "gone"
        log.warning("APNs answered %s (%s)", status, reason)
        from .push import outcome
        return outcome(status)


# -- the push relay (docs/phase10/APPLE-APPS.md §13, decision M10-2 revised) -----------------------
# The relay the app's publisher runs for every Mantel house (packaging/push-relay/): it holds the APNs key, so no house does. A house
# reaches a phone by the opaque handle the phone got from the relay for this house, never by Apple's device token.
# Requests are signed with the house's identity key (app_auth.py), the key the app pinned at pairing.
DEFAULT_RELAY = "https://mantel-push.jazzphone.workers.dev"   # the publisher's relay; per house: app_settings push_relay
RELAY_SETTING = "push_relay"
RELAY_OFF = "off"
URL_MAX = 256
# The house's relay, as an Owner sets it (Mantel Settings → Connections → Notifications to the App, PUT
# /api/app/push-relay): no row (or an empty one) is the default relay, "off" sends through none, an https:// address
# is the Owner's own relay. Any other value sends through none, and says so (mode "invalid").


def clean_relay_url(value: Any) -> str | None:
    """An Owner's own relay: https://name[:port][/path], nothing after it; None if it is not one."""
    from urllib.parse import urlsplit
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > URL_MAX:
        return None
    p = urlsplit(value.strip())
    if p.scheme != "https" or not p.hostname or p.username or p.password or p.query or p.fragment:
        return None
    try:
        p.port
    except ValueError:
        return None
    return f"https://{p.netloc}{p.path}".rstrip("/")


def relay_choice(app) -> dict:
    """{"mode": "default" | "custom" | "off" | "invalid", "url": the address sent to, or None}."""
    st = app.get("app_auth")
    raw = (st.setting(RELAY_SETTING) if st is not None else None) or ""
    if not raw.strip():
        return {"mode": "default", "url": DEFAULT_RELAY}
    if raw == RELAY_OFF:
        return {"mode": "off", "url": None}
    if raw.startswith(("http://127.0.0.1:", "http://localhost:")):   # loopback: the tests and tools/app_dev_server.py
        return {"mode": "custom", "url": raw.rstrip("/")}
    url = clean_relay_url(raw)
    return {"mode": "custom", "url": url} if url else {"mode": "invalid", "url": None}


def relay_url(app) -> str | None:
    return relay_choice(app)["url"]


def push_mode(app) -> dict:
    """How this house sends to the apps, as /api/app/hello tells them: directly with its own APNs key (a developer's
    setup: the key files exist), else through the relay, else not at all."""
    sender = app.get("apns")
    if sender is not None and sender.config() is not None:
        return {"direct": True}
    url = relay_url(app)
    return {"relay": url} if url else {}


def relay_signature(key, method: str, path: str, body: bytes, now: int, nonce: str) -> str:
    import hashlib
    digest = app_crypto.b64u(hashlib.sha256(body).digest())
    msg = f"mantel-relay-v1\n{method}\n{path}\n{now}\n{nonce}\n{digest}".encode()
    return app_crypto.b64u(app_crypto.es256_sign(key, msg))


class Relay:
    """Send through the relay (aiohttp: the relay speaks HTTP/1.1 and 2 alike; only Apple needs HTTP/2)."""

    def __init__(self, app, clock: Callable[[], float] = time.time,
                 transport: Callable[[str, dict, bytes], Awaitable[tuple[int, dict]]] | None = None):
        self.app = app
        self.clock = clock
        self.transport = transport

    async def _post(self, url: str, headers: dict, body: bytes) -> tuple[int, dict]:
        if self.transport is not None:
            return await self.transport(url, headers, body)
        from aiohttp import ClientError, ClientTimeout
        import aiohttp
        http = self.app.get("http")
        own = http is None                       # outside a running server (a tool): a session of its own
        if own:
            http = aiohttp.ClientSession()
        try:
            async with http.post(url, data=body, headers=headers, timeout=ClientTimeout(total=10)) as r:
                try:
                    return r.status, await r.json(content_type=None)
                except ValueError:
                    return r.status, {}
        except (ClientError, OSError, TimeoutError) as exc:
            log.warning("push relay unreachable: %s", type(exc).__name__)
            return 0, {}
        finally:
            if own:
                await http.close()

    async def call(self, path: str, body: dict, url: str | None = None) -> tuple[int, dict]:
        """A signed request to the house's relay (or to ``url``: the one a changed setting left behind)."""
        import secrets as _secrets
        url = url or relay_url(self.app)
        st = self.app.get("app_auth")
        if url is None or st is None:
            return 0, {"error": "no_relay"}
        data = json.dumps(body, separators=(",", ":")).encode()
        now, nonce = int(self.clock()), _secrets.token_urlsafe(18)
        headers = {"Content-Type": "application/json", "X-Mantel-House": st.fingerprint(), "X-Mantel-Time": str(now),
                   "X-Mantel-Nonce": nonce, "X-Mantel-Signature": relay_signature(st.key(), "POST", path, data, now, nonce)}
        return await self._post(url + path, headers, data)

    async def send(self, row: dict, msg: Any) -> str:
        st = self.app.get("app_auth")
        if relay_url(self.app) is None or st is None:
            return "skipped"                   # the relay is off here: the phone stays, nothing is sent
        device_key = app_crypto.unb64u(row["p256dh"])
        body: dict[str, Any] = {"handle": row["endpoint"], "payload": build_payload(msg, device_key)}
        if msg.tag:
            body["collapse_id"] = collapse_id(collapse_secret(st.key()), device_key, msg.tag)
        status, got = await self.call("/v1/send", body)
        if status == 200:
            return "ok"
        if status in (404, 410) or (got or {}).get("gone"):
            return "gone"
        log.warning("push relay answered %s (%s)", status, (got or {}).get("error") or (got or {}).get("reason"))
        from .push import outcome
        return outcome(status)

    async def forget(self, handle: str, url: str | None = None) -> None:
        await self.call("/v1/forget", {"handle": handle}, url)


# -- the setting (Mantel Settings → Connections → Notifications to the App) -------------------------
# GET /api/app/push-relay  (an Owner or Admin)  {mode, url, default, direct, direct_missing, phones, can_edit, needs_fresh}
# PUT /api/app/push-relay  (an Owner; from away, a fresh factor)  {mode: "default" | "custom" | "off", url?}
# Changing the relay drops the phones registered with the old one (each handle forgotten there): each app registers
# again with the new relay when it next starts, or not at all while the relay is off.
def _relay_targets(app) -> list[dict]:
    pusher = app.get("pusher")
    if pusher is None:
        return []
    return [r for r in pusher.targets.everyone() if r["kind"] == "apns" and r.get("env") == "relay"]


def _setting_json(request) -> dict:
    from . import connections as C
    app = request.app
    ident = guarded(request)
    rule = C.edit_rule(request, ident)
    choice = relay_choice(app)
    sender = app.get("apns")
    direct = sender is not None and sender.config() is not None
    stored = app["app_auth"].setting(RELAY_SETTING) if choice["mode"] in ("custom", "invalid") else None
    return {"mode": choice["mode"], "url": stored, "default": DEFAULT_RELAY, "direct": direct,
            "direct_missing": http2_missing() if direct else None, "phones": len(_relay_targets(app)),
            "can_edit": rule != "owner_only", "needs_fresh": rule == "fresh"}


@guard("manager")
async def api_get_relay(request):
    from .sessions import ok
    return ok(_setting_json(request))


@guard("owner", fresh="away", audit="push_relay.set")
async def api_put_relay(request):
    from .accounts import read_json
    from .sessions import error, ok
    ident = guarded(request)
    app = request.app
    body = await read_json(request)
    mode = body.get("mode")
    if mode == "default":
        value = None
    elif mode == "off":
        value = RELAY_OFF
    elif mode == "custom":
        value = clean_relay_url(body.get("url"))
        if value is None:
            return error(400, "invalid", message="A relay's address is https://name[:port][/path], nothing after it.")
    else:
        return error(400, "invalid", message='mode is "default", "custom" or "off".')
    old = relay_url(app)
    audit.config(request, ident, "push_relay.set", {"mode": mode, "url": value if mode == "custom" else None})
    st = app["app_auth"]
    st.set_setting(RELAY_SETTING, value)
    new = relay_url(app)
    if new != old:
        pusher, relay = app.get("pusher"), app.get("push_relay")
        for row in _relay_targets(app):
            pusher.targets.remove(row["id"])
            if old is not None and relay is not None:
                pusher.spawn(relay.forget(row["endpoint"], old))
        log.info("push relay set to %s (%s)", mode, new or "none")
    return ok(_setting_json(request))


def check_direct(app) -> None:
    """At startup: say plainly when the APNs key files are there but direct sending can't speak HTTP/2, and when the
    relay setting is not one Mantel understands."""
    sender = app.get("apns")
    if sender is not None and sender.config() is not None:
        missing = http2_missing()
        if missing is not None:
            log.error("APNs key files are present (%s, %s), so the apps are told to register directly, but %s is not "
                      "installed: nothing will reach the apps. Install '%s', or remove the key files to use the relay.",
                      KEY_FILE, CONF_FILE, missing, EXTRA)
    elif relay_choice(app)["mode"] == "invalid":
        log.warning("the push relay setting is not an https:// address; the apps get no notifications. "
                    "Set it again in Mantel Settings → Connections → Notifications to the App.")
