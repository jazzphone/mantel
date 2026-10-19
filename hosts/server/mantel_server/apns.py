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
* **The key** (Avery's developer account): ``<secrets_dir>/apns_key.p8`` (the .p8 Apple gives) and
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
