"""A fake Kiosk Satellite remote API for tests/test_kiosk_satellite.py and tests/test_tablet_links.py, answering the
way the app's server does (app/lib/managers/remote/remote_manager.dart and auth.dart, 2026.10.6): ``POST /api/login``
with its per-address throttle (5 failures in 5 minutes), stateless signed tokens carrying their own expiry
(``ttl_days`` clamped to 3650), the bearer check on everything else under /api/, ``/api/info``, ``/api/commands``,
and ``/api/health`` with no token. A command posted to ``/api/commands/<name>`` is answered and RECORDED, so tests
can assert that slice 1 never sends one. Every name, address and password is fictional; no real tablet is contacted."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from aiohttp import web

PASSWORD = "fictional-ks-admin-password"
COMMANDS = ("screenOn", "screenOff", "isScreenOn", "setBrightness", "getBrightness", "startScreensaver",
            "stopScreensaver", "isScreensaverActive", "bringToFront", "loadUrl", "loadDashboard", "loadStartUrl",
            "reload", "restartApp", "rebootDevice", "launchApp", "tts", "showNotification", "getDeviceInfo")


class FakeKioskSatellite:
    def __init__(self, password: str = PASSWORD, name: str = "Kitchen Kiosk (fake)") -> None:
        self.password = password
        self.secret = b"fictional-hmac-secret"
        self.name = name
        self.calls: list[tuple[str, str]] = []        # (method, path) of every request
        self.logins: list[dict] = []                  # {"ok": bool, "ttl_days": ...}: never the password
        self.commands_posted: list[str] = []          # a command Mantel must never send in slice 1
        self.failures: list[float] = []
        self.commands = list(COMMANDS)
        self.health_only = False                      # remote admin off but the port answers something else
        self.state = {"screenOn": True, "brightness": 0.62, "screensaverActive": False,
                      "currentUrl": "http://mantel.fake.test:8100/kitchen-home/home?hk_tablet=kitchen"}

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_post("/api/login", self.login)
        app.router.add_get("/api/health", self.health)
        app.router.add_route("*", "/api/{rest:.*}", self.authed)
        return app

    # tokens as auth.dart makes them: base64url(JSON {"exp": ms}) "." base64url(HMAC-SHA256)
    def issue(self, days: float) -> str:
        payload = base64.urlsafe_b64encode(json.dumps({"exp": int((time.time() + days * 86400) * 1000)}).encode()).decode()
        sig = base64.urlsafe_b64encode(hmac.new(self.secret, payload.encode(), hashlib.sha256).digest()).decode()
        return f"{payload}.{sig}"

    def valid(self, token: str | None) -> bool:
        if not token or token.count(".") != 1:
            return False
        payload, sig = token.split(".")
        want = base64.urlsafe_b64encode(hmac.new(self.secret, payload.encode(), hashlib.sha256).digest()).decode()
        if not hmac.compare_digest(sig, want):
            return False
        exp = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["exp"]
        return time.time() * 1000 < exp

    def rotate_secret(self) -> None:
        """The app's own reset: every token issued so far stops working."""
        self.secret = b"another-fictional-secret"

    async def login(self, request: web.Request) -> web.Response:
        self.calls.append((request.method, request.path))
        now = time.time()
        self.failures = [t for t in self.failures if now - t < 300]
        if len(self.failures) >= 5:
            return web.json_response({"error": "too many attempts"}, status=429)
        body = await request.json()
        days = body.get("ttl_days")
        if isinstance(body.get("password"), str) and body["password"] and body["password"] == self.password:
            self.failures.clear()
            self.logins.append({"ok": True, "ttl_days": days})
            d = 7 if not days or days <= 0 else min(days, 3650)
            return web.json_response({"token": self.issue(d)})
        self.failures.append(now)
        self.logins.append({"ok": False, "ttl_days": days})
        return web.json_response({"error": "invalid password"}, status=401)

    def device(self) -> dict:
        return {"name": self.name, "model": "Fake Tablet 11", "osVersion": "Android 17", "sdkInt": 37,
                "appVersion": "2026.10.6", "ip": "192.0.2.168", "battery": 80, "charging": True}

    async def health(self, request: web.Request) -> web.Response:
        self.calls.append((request.method, request.path))
        if self.health_only:
            return web.Response(text="<html>not the app</html>", content_type="text/html")
        return web.json_response({**self.device(), "brand": "fake", "screenOn": self.state["screenOn"],
                                  "brightness": self.state["brightness"]})

    async def authed(self, request: web.Request) -> web.Response:
        self.calls.append((request.method, request.path))
        auth = request.headers.get("Authorization", "")
        if not self.valid(auth[7:] if auth.startswith("Bearer ") else None):
            return web.json_response({"error": "unauthorized"}, status=401)
        path = request.path
        if request.method == "GET" and path == "/api/info":
            return web.json_response({**self.device(), **self.state, "cameraView": None, "nowPlayingShown": False,
                                      "intercomShown": False})
        if request.method == "GET" and path == "/api/commands":
            return web.json_response({"commands": [{"name": n, "description": "", "params": {}} for n in self.commands]})
        if request.method == "POST" and path.startswith("/api/commands/"):
            self.commands_posted.append(path.rsplit("/", 1)[1])
            return web.json_response({"ok": True})
        return web.json_response({"error": "not found"}, status=404)
