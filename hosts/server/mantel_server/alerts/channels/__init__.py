"""The alert channels' senders (docs/phase14/SYSTEM-ALERTS.md "The channels").

Each sender is a module with:

* ``KIND`` and ``NAME``; ``OWNER_ADVANCED`` True for one only the Owner sets up, under Advanced (Apprise);
* ``clean(config, secret, old) -> (config, secret)``: what the page sent, checked at save (and before Send Test). The
  secret's main value is under ``"main"`` (its last four characters are the page's hint). ``old`` is the saved
  secret, so a page that leaves a secret field blank keeps it. Raises :class:`Invalid`;
* ``async send(transport, config, secret, msg)``: one message, raising ``center.ChannelError`` with words for the
  page when it didn't go. The secret is never in those words, a log line or the audit.

A sender reaches the network only through ``transport`` (:func:`http_transport` in the server; a fake in the tests):
``await transport(method, url, headers, body) -> (status, headers, body)``. Every URL a sender posts to is checked
against its own hosts first (``host_ok``), at save and again before each send.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit

from aiohttp import ClientError, ClientTimeout

from ..center import ChannelError

Transport = Callable[[str, str, dict, bytes], Awaitable[tuple[int, dict, bytes]]]
TIMEOUT = 15.0
NAME_MAX = 64
READ_MAX = 1 << 20            # a service's answer read (GitHub's release notes can be long)


class Invalid(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def host_ok(url: Any, hosts: tuple[str, ...], *, subdomains: bool = False) -> bool:
    """``url`` is https on the default port, without credentials in it, to one of ``hosts`` (or, with
    ``subdomains``, a name under one)."""
    if not isinstance(url, str) or len(url) > 2048:
        return False
    try:
        p = urlsplit(url)
        port = p.port
    except ValueError:
        return False
    host = (p.hostname or "").lower()
    if p.scheme != "https" or port not in (None, 443) or p.username or p.password:
        return False
    return host in hosts or (subdomains and any(host.endswith("." + h) for h in hosts))


def text(v: Any, limit: int = 256) -> str:
    return v.strip()[:limit] if isinstance(v, str) else ""


def http_transport(session_of: Callable[[], Any]) -> Transport:
    """The server's transport: the app's aiohttp session, no redirects followed (a redirect could leave the checked
    host), TIMEOUT seconds. A network failure answers status 0."""
    async def transport(method: str, url: str, headers: dict, body: bytes) -> tuple[int, dict, bytes]:
        http = session_of()
        if http is None:
            return 0, {}, b""
        try:
            async with http.request(method, url, data=body if body else None, headers=headers,
                                    allow_redirects=False, timeout=ClientTimeout(total=TIMEOUT)) as resp:
                return resp.status, dict(resp.headers), await resp.content.read(READ_MAX)
        except (ClientError, asyncio.TimeoutError, OSError) as exc:
            raise ChannelError(f"couldn't reach {urlsplit(url).hostname} ({type(exc).__name__})") from None
    return transport


def json_of(body: bytes) -> dict:
    try:
        got = json.loads(body or b"{}")
    except ValueError:
        return {}
    return got if isinstance(got, dict) else {}


def refused(service: str, status: int, why: str = "") -> ChannelError:
    """A service's answer that isn't ok, as the page shows it: "Discord said 401: the webhook was deleted". 429 and
    5xx are worth retrying; the rest are not."""
    if status == 0:
        return ChannelError(f"couldn't reach {service}")
    words = f"{service} said {status}" + (f": {why}" if why else "")
    return ChannelError(words, permanent=status not in (408, 429) and status < 500)


ORDER = ("discord", "telegram", "notifiarr", "email", "apprise_")


def senders() -> dict[str, Any]:
    """The sender modules by kind, in the page's order."""
    import importlib
    out = {}
    for name in ORDER:
        try:
            mod = importlib.import_module(f"{__name__}.{name}")
        except ImportError:
            continue
        out[mod.KIND] = mod
    return out
