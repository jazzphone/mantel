"""Fully Kiosk Browser, through its own REST API (docs/phase8/KIOSK.md; PROTOTYPE, not wired into server.py).

Today HK reaches a Fully tablet through HA's ``fully_kiosk`` integration (its ``switch.*_screen``,
``number.*_screen_brightness``, ``switch.*_screensaver``, ``fully_kiosk.load_url``). Fully's Remote Admin
answers on the tablet itself, ``http://<tablet>:2323/``; Mantel talks to it directly.

What this relies on (Fully's REST documentation, https://www.fully-kiosk.com/en/#rest, as the client library
HA's integration uses, ``python-fullykiosk``, sends it):

* Every call is ``GET /?cmd=<command>&password=<Remote Admin password>&type=json[&<param>=<value>...]``.
* ``cmd=deviceInfo`` answers the tablet's state as one JSON object (``deviceID``, ``deviceName``,
  ``appVersionName``, ``screenOn``, ``screenBrightness``, ``isInScreensaver``, ``currentPage``,
  ``batteryLevel``, ``plugged``, ...).
* A command answers ``{"status": "OK", "statustext": ...}``; a refusal (a wrong password among them)
  ``{"status": "Error", "statustext": ...}``.
* Brightness is a setting: ``cmd=setStringSetting&key=screenBrightness&value=<0..255>``.

SAFETY, each pinned by tests/test_fully.py against a fake Fully (tests/fully_fakes.py):

* **A closed list of commands** (COMMANDS): the screen, its brightness, the screensaver, loading a page,
  coming to the front. Nothing else can be sent: no ``injectJavascript``, no ``setStringSetting`` with
  another key, no ``startApplication``, no camera or screenshot, no reboot. An unknown verb or a bad value
  is refused before anything leaves Mantel.
* **The password is only ever used.** Fully takes it in the query string (plain HTTP on the home network,
  exactly as HA's integration sends it today); it is never in a log line, a ``repr``, an exception's text or
  an exception's chain (aiohttp's errors carry the request URL, so none is ever raised from or chained to
  one). HA's library logs it at debug level; this does not.
* **Home network only.** The address is a host and port, no path, query or user info; an IP address must be
  private (RFC 1918, or IPv6 unique-local), so a typo cannot send the password to the internet.
* **Pages from Mantel only.** ``load_url`` takes an http(s) address whose origin is one of ``allowed_origins``
  (Mantel's own addresses, given by the caller); with none given it refuses every page.
* One call at a time per tablet (a lock), each with its own timeout.

This module decides nothing and checks no roles: the caller (the command gateway, docs/phase8/KIOSK.md
"Commands") has already decided the command may be sent and written its audit row.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Iterable
from urllib.parse import urlparse

import aiohttp

from . import kiosk
from .kiosk import KioskFailed

log = logging.getLogger("mantel.fully")

DEFAULT_PORT = 2323
TIMEOUT = 10.0
MAX_URL = 2000
MAX_BODY = 1 << 20              # a reply larger than this is refused

# Mantel's verb -> (Fully's cmd, the fixed parameters it adds). The only commands that can be sent.
COMMANDS: dict[str, tuple[str, dict[str, str]]] = {
    "screen_on": ("screenOn", {}),
    "screen_off": ("screenOff", {}),
    "brightness": ("setStringSetting", {"key": "screenBrightness"}),     # + value 0..255
    "screensaver_on": ("startScreensaver", {}),
    "screensaver_off": ("stopScreensaver", {}),
    "load_url": ("loadUrl", {}),                                           # + url, Mantel's own
    "load_start_url": ("loadStartUrl", {}),
    "to_front": ("toForeground", {}),
}
# deviceInfo key -> the name Mantel reports it under (everything else Fully says is dropped)
INFO = {"deviceID": "id", "deviceName": "name", "deviceModel": "model", "appVersionName": "version",
        "screenOn": "screen_on", "screenBrightness": "brightness", "isInScreensaver": "screensaver",
        "currentPage": "page", "foreground": "foreground", "batteryLevel": "battery", "plugged": "plugged",
        "kioskMode": "kiosk_mode", "ip4": "ip"}


def clean_address(raw: object) -> tuple[str, int]:
    """The tablet's address as typed (its IP address, ``<ip>:2323``, ``kitchen-tablet.local``), checked:
    (host, port). Home network only (kiosk.clean_address)."""
    return kiosk.clean_address(raw, DEFAULT_PORT, "Fully's Remote Admin")


def clean_password(raw: object) -> str:
    return kiosk.clean_password(raw, "Fully: Settings → Remote Administration")


def _origin(url: str) -> str | None:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        return None
    try:
        port = p.port
    except ValueError:
        return None
    default = 443 if p.scheme == "https" else 80
    return f"{p.scheme}://{p.hostname.lower()}:{port or default}"


def _value(verb: str, args: dict[str, Any], allowed_origins: frozenset[str]) -> dict[str, str]:
    """The extra parameters one verb carries, checked. Raises ValueError (nothing was sent)."""
    if verb == "brightness":
        if set(args) != {"level"}:
            raise ValueError("brightness takes level only")
        level = args["level"]
        if isinstance(level, bool) or not isinstance(level, int) or not 0 <= level <= 255:
            raise ValueError("brightness level is a whole number from 0 to 255")
        return {"value": str(level)}
    if verb == "load_url":
        if set(args) != {"url"}:
            raise ValueError("load_url takes url only")
        url = args["url"]
        if not isinstance(url, str) or len(url) > MAX_URL or any(ord(c) < 0x21 for c in url):
            raise ValueError("load_url's url is an address without spaces")
        origin = _origin(url)
        if origin is None or origin not in allowed_origins:
            raise ValueError("load_url opens Mantel's own pages only")
        return {"url": url}
    if args:
        raise ValueError(f"{verb} takes nothing")
    return {}


@dataclass
class FullyClient:
    """One tablet's Fully Kiosk Browser. ``repr`` never shows the password."""
    http: aiohttp.ClientSession = field(repr=False)
    host: str
    port: int
    password: str = field(repr=False)
    allowed_origins: frozenset[str] = frozenset()
    timeout: float = TIMEOUT
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    @classmethod
    def of(cls, http: aiohttp.ClientSession, address: object, password: object,
           allowed_origins: Iterable[str] = (), timeout: float = TIMEOUT) -> "FullyClient":
        host, port = clean_address(address)
        origins = frozenset(o for o in (_origin(u) for u in allowed_origins) if o)
        return cls(http, host, port, clean_password(password), origins, timeout)

    @property
    def address(self) -> str:
        return f"{self.host}:{self.port}"

    async def _get(self, cmd: str, extra: dict[str, str]) -> Any:
        """One call. Every failure is a KioskFailed made here, never raised from aiohttp's (its text and chain
        carry the URL, and so the password)."""
        params = {"cmd": cmd, **extra, "password": self.password, "type": "json"}
        failure: tuple[str, str] | None = None
        status, body = 0, b""
        async with self._lock:
            try:
                host, port = kiosk.route(self.host, self.port)
                async with asyncio.timeout(self.timeout):
                    async with self.http.get(f"http://{host}:{port}/", params=params,
                                             headers={"Accept": "application/json"}, allow_redirects=False) as r:
                        status, body = r.status, await kiosk.read_body(r.content, MAX_BODY)
            except TimeoutError:
                failure = ("timeout", f"The tablet at {self.address} did not answer within {int(self.timeout)} "
                                      "seconds. Check that it is on and that Mantel's network can reach it.")
            except aiohttp.ClientConnectorError:
                failure = ("unreachable", f"Mantel could not reach a tablet at {self.address}. Check the address, "
                                          "that Fully's Remote Administration is on, and that Mantel's network "
                                          "can reach the tablets' network.")
            except aiohttp.ClientError as exc:
                failure = ("failed", f"The call to the tablet at {self.address} failed ({type(exc).__name__}).")
        del params
        if failure is not None:
            raise KioskFailed(*failure)
        if len(body) > MAX_BODY:
            raise KioskFailed("too_large", f"The tablet at {self.address} answered with more than "
                                           f"{MAX_BODY >> 20} MB, which Fully never does.")
        if status != 200:
            raise KioskFailed("failed", f"The tablet at {self.address} answered HTTP {status}.")
        try:
            data = json.loads(body)
        except (ValueError, UnicodeError):
            data = None
        if not isinstance(data, dict):
            raise KioskFailed("not_fully", f"Something answered at {self.address}, but it is not Fully Kiosk "
                                           "Browser's Remote Admin. Check the address and port.")
        if data.get("status") == "Error":
            text = _plain(str(data.get("statustext") or ""), self.password)
            if re.search(r"password|login|log in|unauthori", text, re.I):
                raise KioskFailed("bad_password", f"The tablet at {self.address} refused the Remote Admin password.")
            raise KioskFailed("refused", f"The tablet at {self.address} refused the command"
                                         + (f": {text}" if text else "."))
        return data

    async def info(self) -> dict[str, Any]:
        """The tablet's state, the keys Mantel uses only (INFO; brightness as a percent)."""
        data = await self._get("deviceInfo", {})
        if "deviceID" not in data:
            raise KioskFailed("not_fully", f"Something answered at {self.address}, but it is not Fully Kiosk "
                                           "Browser's Remote Admin. Check the address and port.")
        out = {name: data.get(key) for key, name in INFO.items()}
        b = out.get("brightness")             # Fully's 0..255, as a whole percent (Kiosk Satellite's are too)
        out["brightness"] = None if isinstance(b, bool) or not isinstance(b, (int, float)) else \
            max(0, min(100, round(float(b) / 2.55)))
        return out

    async def send(self, verb: str, **args: Any) -> None:
        """One of COMMANDS. ValueError (nothing sent) for an unknown verb or a bad value; KioskFailed when the
        tablet could not be reached or refused it."""
        if verb not in COMMANDS:
            raise ValueError(f"not a tablet command: {verb!r}")
        cmd, fixed = COMMANDS[verb]
        await self._get(cmd, {**fixed, **_value(verb, args, self.allowed_origins)})


def _plain(text: str, secret: str) -> str:
    """Fully's own words, short, one line, and never the password (if Fully ever echoed it)."""
    text = " ".join(text.split())[:160]
    return text.replace(secret, "•••") if secret else text


async def test(http: aiohttp.ClientSession, address: object, password: object) -> dict[str, Any]:
    """The Connections page's test before saving: the address and password reach a Fully that answers
    ``deviceInfo``. Returns what to show (the tablet's name, model, version, screen); raises KioskFailed."""
    return await FullyClient.of(http, address, password).info()
