"""Notifications to the iPhone, iPad and Mac apps through Apple's push service (docs/phase10/APPLE-APPS.md §5,
slice 10.5; decision M10-2: no relay while the app is TestFlight-only, the house sends to APNs itself).

* **Registration**: the app sends its APNs device token and the public half of a notification key it keeps in
  its Keychain (``POST /api/app/push/register``, app_api.py). The row is a push target of kind ``apns`` bound to
  the app's credential: signing the app out removes it.
* **End-to-end**: the notification's words, the accessory and the snapshot's id are sealed to that key
  (app_crypto.seal_for_device: ECDH + HKDF-SHA256 + AES-256-GCM) under ``"m"``; the visible alert Apple carries
  says only "Mantel" / "New notification". The Notification Service Extension opens ``"m"`` on the phone and shows
  the real words (``mutable-content: 1``). Apple sees a device token and ciphertext.
* **Interruption levels**: Important notifications are ``time-sensitive`` (through Focus; no Apple approval needed).
  Critical alerts need Apple's entitlement and are not used.
* **The key** (the app publisher's developer account): ``<secrets_dir>/apns_key.p8`` (the .p8 Apple gives) and
  ``<secrets_dir>/apns.json`` ``{"key_id", "team_id", "topic"}`` (topic: the app's bundle id). Secret files,
  never the database, a log or an env var. Without them nothing is sent (the target stays; ``not_configured``).
* **Transport**: APNs speaks only HTTP/2. aiohttp does not, so sending needs ``httpx[http2]`` (not yet a Mantel
  dependency: add it when the developer account exists). Until then ``send`` answers ``failed`` with a log line
  saying so, and the tests use an injected transport.

UNVERIFIED until the Apple Developer account exists (M10-6): the provider token and request shape follow Apple's
documentation; the app's side is tested in the Simulator with ``xcrun simctl push`` (apple/README.md).
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import app_crypto

log = logging.getLogger("mantel.apns")

KEY_FILE = "apns_key.p8"
CONF_FILE = "apns.json"
HOSTS = {"production": "https://api.push.apple.com", "sandbox": "https://api.sandbox.push.apple.com"}
TOKEN_EVERY = 50 * 60                   # Apple wants a new provider token at most hourly, and no more than every 20 min
GONE_REASONS = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"}

Transport = Callable[[str, dict, bytes], Awaitable[tuple[int, dict]]]   # (url, headers, body) -> (status, json)


def build_payload(msg: Any, device_key: bytes) -> dict:
    """The APNs payload for one notification: a generic visible alert, the real one sealed to the phone."""
    inner = {"title": msg.title, "body": msg.body, "entity": msg.entity, "snap": msg.snap, "camera": msg.camera,
             "tag": msg.tag, "url": msg.url, "important": msg.important, "id": msg.id}
    sealed = app_crypto.seal_for_device(json.dumps({k: v for k, v in inner.items() if v is not None},
                                                   separators=(",", ":")).encode(), device_key)
    aps: dict[str, Any] = {"alert": {"title": "Mantel", "body": "New notification"}, "mutable-content": 1,
                           "sound": "default", "interruption-level": "time-sensitive" if msg.important else "active"}
    if msg.tag:
        aps["thread-id"] = msg.tag
    if msg.entity:
        aps["category"] = "MANTEL_ACCESSORY"
    return {"aps": aps, "m": sealed}


class Apns:
    def __init__(self, secrets_dir: Path, clock: Callable[[], float] = time.time, transport: Transport | None = None):
        self.secrets_dir = Path(secrets_dir).expanduser()
        self.clock = clock
        self.transport = transport
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
        try:
            import httpx  # type: ignore[import-not-found]
        except ImportError:
            log.warning("APNs needs HTTP/2 (httpx[http2]); not installed, nothing sent")
            return 0, {"reason": "transport_missing"}
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
        payload = build_payload(msg, app_crypto.unb64u(row["p256dh"]))
        host = HOSTS["sandbox" if row.get("env") == "sandbox" else "production"]
        headers = {"authorization": "bearer " + self.provider_token(conf), "apns-topic": conf["topic"],
                   "apns-push-type": "alert", "apns-priority": "10" if msg.important else "5",
                   "content-type": "application/json"}
        if msg.tag:
            headers["apns-collapse-id"] = msg.tag[:64]
        status, body = await (self.transport or self._default_transport)(
            f"{host}/3/device/{row['endpoint']}", headers, json.dumps(payload, separators=(",", ":")).encode())
        if status == 200:
            return "ok"
        reason = (body or {}).get("reason")
        if status == 410 or reason in GONE_REASONS:
            return "gone"
        log.warning("APNs answered %s (%s)", status, reason)
        return "failed"


# -- the push relay (docs/phase10/APPLE-APPS.md §13, decision M10-2 revised) -----------------------
# The relay the app's publisher runs for every Mantel house (packaging/push-relay/): it holds the APNs key, so no house does. A house
# reaches a phone by the opaque handle the phone got from the relay for this house, never by Apple's device token.
# Requests are signed with the house's identity key (app_auth.py), the key the app pinned at pairing.
DEFAULT_RELAY = "https://mantel-push.jazzphone.workers.dev"   # the publisher's relay; per house: app_settings push_relay
RELAY_SETTING = "push_relay"


def relay_url(app) -> str | None:
    st = app.get("app_auth")
    url = (st.setting(RELAY_SETTING) if st is not None else None) or DEFAULT_RELAY
    if not url:
        return None
    if url.startswith("https://") or url.startswith(("http://127.0.0.1:", "http://localhost:")):   # loopback: the tests
        return url.rstrip("/")
    return None


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

    async def call(self, path: str, body: dict) -> tuple[int, dict]:
        import secrets as _secrets
        url = relay_url(self.app)
        st = self.app.get("app_auth")
        if url is None or st is None:
            return 0, {"error": "no_relay"}
        data = json.dumps(body, separators=(",", ":")).encode()
        now, nonce = int(self.clock()), _secrets.token_urlsafe(18)
        headers = {"Content-Type": "application/json", "X-Mantel-House": st.fingerprint(), "X-Mantel-Time": str(now),
                   "X-Mantel-Nonce": nonce, "X-Mantel-Signature": relay_signature(st.key(), "POST", path, data, now, nonce)}
        return await self._post(url + path, headers, data)

    async def send(self, row: dict, msg: Any) -> str:
        payload = build_payload(msg, app_crypto.unb64u(row["p256dh"]))
        body: dict[str, Any] = {"handle": row["endpoint"], "payload": payload}
        if msg.tag:
            body["collapse_id"] = msg.tag[:64]
        status, got = await self.call("/v1/send", body)
        if status == 200:
            return "ok"
        if status in (404, 410) or (got or {}).get("gone"):
            return "gone"
        log.warning("push relay answered %s (%s)", status, (got or {}).get("error") or (got or {}).get("reason"))
        return "failed"

    async def forget(self, handle: str) -> None:
        await self.call("/v1/forget", {"handle": handle})
