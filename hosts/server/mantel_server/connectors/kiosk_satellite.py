"""Kiosk Satellite, through its own remote API (docs/phase8/KIOSK.md, slice 1: pairing and status, NO commands).

Today HK reaches a Kiosk Satellite tablet through Home Assistant's ESPHome entities. The app also serves a remote
API on the tablet itself, ``http://<tablet>:2324`` (on while Remote Administration has a password); Mantel talks to
it directly.

What this relies on (Kiosk Satellite's ``docs/remote-api.md`` and its server, ``app/lib/managers/remote/
remote_manager.dart`` and ``auth.dart``, read 2026-10-19 at app version 2026.10.6):

* ``POST /api/login {"password", "ttl_days"}`` -> 200 ``{"token"}``; a wrong password 401 ``{"error": "invalid
  password"}``; after 5 failures in 5 minutes from one address 429 ``{"error": "too many attempts"}``. A token is
  ``<base64url JSON {"exp": <ms>}>.<HMAC>``, stateless: changing the password does not revoke one. ``ttl_days`` is
  clamped to 3650.
* Everything else under ``/api/`` takes ``Authorization: Bearer <token>``; a token it does not accept is 401
  ``{"error": "unauthorized"}``.
* ``GET /api/info``: getDeviceInfo's fields (``name``, ``model``, ``appVersion``, ``osVersion``, ``ip``,
  ``battery``, ``charging``, ...) plus ``brightness`` (0..1), ``screenOn``, ``screensaverActive`` and ``currentUrl``.
* ``GET /api/commands`` -> ``{"commands": [{"name", "description", "params"}]}``.
* ``GET /api/health``, the one read with no token: hardware facts (``name``, ``model``, ``appVersion``, ``ip``,
  ``screenOn``, ``brightness``, ...), for monitoring.

SAFETY (tests/test_kiosk_satellite.py, against tests/kiosk_satellite_fakes.py):

* **Reads only.** This client can log in and read ``/api/info``, ``/api/commands`` and ``/api/health``; there is no
  method that posts a command, changes a setting or touches files. Commands are slice 2, through the gateway.
* **The password is used once**, for the login, and kept nowhere; the token is only ever used: never in a log
  line, a ``repr``, an exception's text or an exception's chain (none is raised from or chained to aiohttp's).
* **Home network only** (kiosk.clean_address); one call at a time per tablet, each with its own timeout.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import aiohttp

from . import kiosk
from .kiosk import KioskFailed

log = logging.getLogger("mantel.kiosk_satellite")

DEFAULT_PORT = 2324
TIMEOUT = 10.0
TOKEN_DAYS = 3650             # Avery, 2026-10-19: the app's maximum, ten years
TEST_TOKEN_DAYS = 1           # a test before saving makes a token that lapses tomorrow, and drops it
MAX_TOKEN = 4096
WHERE = "Kiosk Satellite: Settings → Device → Remote Administration"
# The commands later slices will send (docs/phase8/KIOSK.md "Commands"): checked at pairing, so an app version
# without one of them is said at once. Nothing here sends them.
WANTED = ("screenOn", "screenOff", "setBrightness", "startScreensaver", "stopScreensaver", "bringToFront",
          "loadUrl", "reload", "restartApp")
# /api/info key -> the name Mantel reports it under (everything else the app says is dropped)
INFO = {"name": "name", "model": "model", "appVersion": "version", "osVersion": "os", "ip": "ip",
        "battery": "battery", "charging": "charging", "screenOn": "screen_on", "screensaverActive": "screensaver",
        "currentUrl": "page"}


def clean_address(raw: object) -> tuple[str, int]:
    return kiosk.clean_address(raw, DEFAULT_PORT, "Kiosk Satellite's Remote Administration")


def clean_password(raw: object) -> str:
    return kiosk.clean_password(raw, WHERE)


def token_expires(token: str) -> float | None:
    """When a token lapses (epoch seconds), read from its own payload; None if it does not say."""
    try:
        payload = token.split(".", 1)[0]
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        exp = data.get("exp") if isinstance(data, dict) else None
        return float(exp) / 1000 if isinstance(exp, (int, float)) and not isinstance(exp, bool) else None
    except (ValueError, UnicodeError):
        return None


def _percent(v: Any) -> int | None:
    """The app's 0..1 brightness as a whole percent."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return max(0, min(100, round(float(v) * 100)))


def trim_info(data: dict) -> dict[str, Any]:
    out = {name: data.get(key) for key, name in INFO.items()}
    out["brightness"] = _percent(data.get("brightness"))
    return out


@dataclass
class _Http:
    """One tablet's address, its calls serialized, every failure a KioskFailed made here (never raised from
    aiohttp's, whose text and chain can carry the request)."""
    http: aiohttp.ClientSession = field(repr=False)
    host: str
    port: int
    timeout: float = TIMEOUT
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    @property
    def address(self) -> str:
        return f"{self.host}:{self.port}"

    async def call(self, method: str, path: str, *, token: str | None = None, body: dict | None = None) -> tuple[int, Any]:
        headers = {"Accept": "application/json"}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        failure: tuple[str, str] | None = None
        status, raw = 0, b""
        async with self._lock:
            try:
                host, port = kiosk.route(self.host, self.port)
                async with asyncio.timeout(self.timeout):
                    async with self.http.request(method, f"http://{host}:{port}{path}", json=body,
                                                 headers=headers, allow_redirects=False) as r:
                        status, raw = r.status, await r.content.read(1 << 20)
            except TimeoutError:
                failure = ("timeout", f"The tablet at {self.address} did not answer within {int(self.timeout)} "
                                      "seconds. Check that it is on and that Mantel's network can reach it.")
            except aiohttp.ClientConnectorError:
                failure = ("unreachable", f"Mantel could not reach a tablet at {self.address}. Check the address, "
                                          "that Kiosk Satellite's Remote Administration is on (it needs a password), "
                                          "and that Mantel's network can reach the tablets' network.")
            except aiohttp.ClientError as exc:
                failure = ("failed", f"The call to the tablet at {self.address} failed ({type(exc).__name__}).")
        del headers
        if failure is not None:
            raise KioskFailed(*failure)
        try:
            data = json.loads(raw) if raw else None
        except (ValueError, UnicodeError):
            data = None
        return status, data

    def not_ks(self) -> KioskFailed:
        return KioskFailed("not_kiosk_satellite", f"Something answered at {self.address}, but it is not Kiosk "
                                                  "Satellite's remote administration. Check the address and port.")


async def login(http: aiohttp.ClientSession, address: object, password: object, ttl_days: int = TOKEN_DAYS,
                timeout: float = TIMEOUT) -> tuple["KioskSatellite", str]:
    """Trade the admin password for a token: (a client holding it, the token). The password is used for this one
    request and is not kept."""
    host, port = clean_address(address)
    pw = clean_password(password)
    h = _Http(http, host, port, timeout)
    status, data = await h.call("POST", "/api/login", body={"password": pw, "ttl_days": int(ttl_days)})
    del pw, password
    if status == 401:
        raise KioskFailed("bad_password", f"The tablet at {h.address} refused that Remote Administration password.")
    if status == 429:
        raise KioskFailed("throttled", f"The tablet at {h.address} has refused too many passwords in the last "
                                       "five minutes. Wait five minutes and try again.")
    token = data.get("token") if isinstance(data, dict) else None
    if status != 200 or not isinstance(token, str) or not token or len(token) > MAX_TOKEN or not token.isascii():
        raise h.not_ks() if status in (200, 404) or not isinstance(data, dict) else \
            KioskFailed("failed", f"The tablet at {h.address} answered HTTP {status}.")
    return KioskSatellite(http, host, port, token, timeout), token


@dataclass
class KioskSatellite:
    """One tablet's Kiosk Satellite, with the token Mantel keeps. ``repr`` never shows the token."""
    http: aiohttp.ClientSession = field(repr=False)
    host: str
    port: int
    token: str = field(repr=False)
    timeout: float = TIMEOUT
    _h: _Http | None = field(default=None, repr=False)

    @classmethod
    def of(cls, http: aiohttp.ClientSession, address: object, token: str, timeout: float = TIMEOUT) -> "KioskSatellite":
        host, port = clean_address(address)
        return cls(http, host, port, token, timeout)

    @property
    def address(self) -> str:
        return f"{self.host}:{self.port}"

    def _http(self) -> _Http:
        if self._h is None:
            self._h = _Http(self.http, self.host, self.port, self.timeout)
        return self._h

    async def _get(self, path: str) -> Any:
        h = self._http()
        status, data = await h.call("GET", path, token=self.token)
        if status == 401:
            raise KioskFailed("token_refused", f"The tablet at {h.address} no longer accepts Mantel's token (it "
                                               "was reset, or the tablet was replaced). Pair it again.")
        if status != 200:
            raise KioskFailed("failed", f"The tablet at {h.address} answered HTTP {status}.")
        if not isinstance(data, dict):
            raise h.not_ks()
        return data

    async def info(self) -> dict[str, Any]:
        """The tablet's state now, the keys Mantel uses only (INFO; brightness as a percent)."""
        data = await self._get("/api/info")
        if "appVersion" not in data and "screenOn" not in data:
            raise self._http().not_ks()
        return trim_info(data)

    async def commands(self) -> set[str]:
        """The names of the commands this app version has (to check WANTED; nothing is sent)."""
        data = await self._get("/api/commands")
        cmds = data.get("commands")
        if not isinstance(cmds, list):
            raise self._http().not_ks()
        return {c["name"] for c in cmds if isinstance(c, dict) and isinstance(c.get("name"), str)}


async def health(http: aiohttp.ClientSession, address: object, timeout: float = TIMEOUT) -> dict[str, Any]:
    """The one read with no token (Setup Check's "reachable"): name, model, version, screen."""
    host, port = clean_address(address)
    h = _Http(http, host, port, timeout)
    status, data = await h.call("GET", "/api/health")
    if status != 200 or not isinstance(data, dict) or "appVersion" not in data:
        raise h.not_ks()
    return {"name": data.get("name"), "model": data.get("model"), "version": data.get("appVersion"),
            "screen_on": data.get("screenOn"), "brightness": _percent(data.get("brightness"))}


async def pair(http: aiohttp.ClientSession, address: object, password: object, ttl_days: int = TOKEN_DAYS,
               timeout: float = TIMEOUT) -> dict[str, Any]:
    """Log in, then read the tablet and its command list with the new token (it works). Returns
    ``{"token", "expires", "info", "missing"}``; ``missing``: the WANTED commands this app version lacks."""
    client, token = await login(http, address, password, ttl_days, timeout)
    info = await client.info()
    have = await client.commands()
    return {"token": token, "expires": token_expires(token), "info": info,
            "missing": [c for c in WANTED if c not in have]}
