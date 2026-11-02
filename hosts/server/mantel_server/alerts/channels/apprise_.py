"""Apprise: one URL to anywhere (ntfy, Pushover, Gotify, Slack, Matrix and about a hundred more).

Owner only, under Advanced: an Apprise URL can send to any host, so it isn't held to a short list the way the other
channels are, and a URL usually carries a token. The URLs are the secret (``urls``, one to ten, the first is ``main``
for the page's four-character hint) and are never in a response, an error, a log line or the audit; a bad one is named
by its place in the list ("URL 2"), not shown.

Apprise is a pinned dependency in all three installs (pyproject.toml, requirements.lock, the App's requirements.txt)
but is imported only here, when used, so a Mantel without it still starts and the page grays this channel out
(:func:`available`). Sending runs Apprise's blocking ``notify`` in a thread.
"""
from __future__ import annotations

import asyncio
import logging
import re

from ..center import ChannelError, Message
from . import Invalid, Transport

# Apprise's plugins log their requests' errors at debug, and those carry the service URL with its token in it
logging.getLogger("apprise").setLevel(logging.WARNING)

KIND = "apprise"
NAME = "Apprise"
OWNER_ADVANCED = True
URLS_MAX = 10
URL_MAX = 512
SHAPE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]{0,31}://\S+$")
TYPES = {"critical": "failure", "warning": "warning", "info": "info"}


def available() -> bool:
    try:
        import apprise  # noqa: F401
    except ImportError:
        return False
    return True


def known(url: str) -> bool:
    """Apprise takes this URL as exactly one service (it also splits a string at commas and spaces, so a "URL"
    that turns into two is refused)."""
    import apprise
    one = apprise.Apprise()
    return bool(one.add(url)) and len(one) == 1


def urls_of(v: object) -> list[str]:
    if isinstance(v, str):
        v = v.splitlines()
    return [x.strip() for x in v if isinstance(x, str) and x.strip()] if isinstance(v, list) else []


def clean(config: dict, secret: dict | None, old: dict | None) -> tuple[dict, dict]:
    urls = urls_of((secret or {}).get("urls"))
    if not urls and old:
        urls = urls_of(old.get("urls"))
    if not 1 <= len(urls) <= URLS_MAX:
        raise Invalid("invalid_urls", f"Give 1 to {URLS_MAX} Apprise URLs, one per line (ntfy://..., "
                                      "pover://..., slack://...).")
    for i, url in enumerate(urls, 1):
        if len(url) > URL_MAX or not SHAPE.match(url) or any(ord(c) < 32 for c in url):
            raise Invalid("invalid_url", f"URL {i} isn't an Apprise URL (scheme://..., up to {URL_MAX} characters).")
        if available() and not known(url):
            raise Invalid("invalid_url", f"Apprise doesn't know URL {i}. Check the service's page in Apprise's "
                                         "wiki for how its URL is written.")
    return {}, {"urls": urls, "main": urls[0]}


def notify(urls: list[str], msg: Message) -> bool:
    """Blocking: every URL added to one Apprise, one message to all of them."""
    import apprise
    app = apprise.Apprise()
    for url in urls:
        if not app.add(url):
            return False
    body = "\n\n".join(x for x in (msg.body, msg.link) if x)
    return bool(app.notify(title=msg.subject, body=body, notify_type=TYPES.get(msg.level, "info")))


async def send(transport: Transport, config: dict, secret: dict | None, msg: Message) -> None:
    urls = urls_of((secret or {}).get("urls"))
    if not 1 <= len(urls) <= URLS_MAX:
        raise ChannelError("the saved Apprise URLs are missing; enter them again", permanent=True)
    if not available():
        raise ChannelError("Apprise isn't installed in this Mantel", permanent=True)
    try:
        sent = await asyncio.to_thread(notify, urls, msg)
    except Exception as exc:  # noqa: BLE001 -- never str(exc): a service's error can quote its URL
        raise ChannelError(f"Apprise failed ({type(exc).__name__})") from None
    if not sent:
        raise ChannelError("Apprise couldn't send to one or more of its URLs")
