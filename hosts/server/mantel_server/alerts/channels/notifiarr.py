"""Notifiarr: a message into a Discord channel through Notifiarr's passthrough.

Setup is the account's **global** API key and the numeric Discord channel ID the message goes to (Discord → User
Settings → Advanced → Developer Mode, then right-click the channel → Copy Channel ID). Only ``notifiarr.com`` is called.

What was confirmed, 2026-11-02, and against what:

* The payload (``notification``, ``discord.color``, ``discord.ping``, ``discord.text.title|content|description|
  footer``, ``discord.ids.channel``) is Notifiarr's own Passthrough API reference,
  <https://notifiarr.wiki/pages/integrations/passthrough/>: ``color`` a 6-digit hex string, ``ids.channel`` an
  integer, ``notification.name`` required, ``text.description`` up to the embed's limit.
* That page posts to ``/api/v1/notification/passthrough/<integration key>``, with a Passthrough *integration* key in
  the URL. Mantel doesn't use it: the plan wants the global key (one key to paste, not a key inside a URL that a log
  could hold). The endpoint that takes the global key in an ``X-api-Key`` header, with this same payload plus
  ``source`` and ``type``, is the one Apprise's Notifiarr sender uses,
  <https://github.com/caronc/apprise/blob/master/apprise/plugins/notifiarr.py> (read the same day), and Apprise's
  wiki says integration keys don't work there: <https://github.com/caronc/apprise/wiki/Notify_notifiarr>.
  So this posts to ``https://notifiarr.com/api/v1/notification/apprise``.
* Not confirmed: no account key was at hand, so no live call was made. The first Send Test on a real account is the
  proof; a 401 or 403 says to use the global key.

The key travels only in the header, never in a URL, an error or a log line. ``ping`` is zero (nobody is pinged) and
``content`` stays empty: the alert is the embed.
"""
from __future__ import annotations

import json
import re

from ..center import ChannelError, Message
from . import Invalid, Transport, host_ok, json_of, refused, text

KIND = "notifiarr"
NAME = "Notifiarr"
OWNER_ADVANCED = False
HOSTS = ("notifiarr.com",)
URL = "https://notifiarr.com/api/v1/notification/apprise"
KEY = re.compile(r"^[A-Za-z0-9._-]{8,128}$")
CHANNEL = re.compile(r"^[1-9]\d{14,19}$")           # a Discord snowflake
COLORS = {"critical": "E5484D", "warning": "F5A524", "info": "3E8ED0"}
TYPES = {"critical": "failure", "warning": "warning", "info": "info"}
WHY = {400: "Notifiarr refused the message; check the channel ID", 401: "use the global API key, not an integration key",
       403: "use the global API key, not an integration key; and the key's account must have the Discord server",
       404: "Notifiarr didn't find that; check the channel ID", 429: "too many messages; Mantel waits and tries again"}


def channel_of(v: object) -> int | None:
    if isinstance(v, bool):
        return None
    v = str(v).strip() if isinstance(v, (int, str)) else ""
    return int(v) if CHANNEL.match(v) else None


def clean(config: dict, secret: dict | None, old: dict | None) -> tuple[dict, dict]:
    key = text((secret or {}).get("api_key"), 160)
    if not key and old and old.get("api_key"):
        key = old["api_key"]
    if not KEY.match(key):
        raise Invalid("invalid_key", "That isn't a Notifiarr API key. Use the global API key from your Notifiarr "
                                     "account's profile, not an integration's key.")
    channel = channel_of((config or {}).get("channel"))
    if channel is None:
        raise Invalid("invalid_channel", "Give the Discord channel's numeric ID (Developer Mode on, then right-click "
                                         "the channel and Copy Channel ID).")
    return {"channel": channel}, {"api_key": key, "main": key}


def payload(msg: Message, channel: int) -> dict:
    body = "\n".join(x for x in (msg.body, msg.link) if x)
    return {"source": "Mantel", "type": TYPES.get(msg.level, "info"),
            "notification": {"update": False, "name": "Mantel", "event": msg.tag},
            "discord": {"color": COLORS.get(msg.level, COLORS["info"]),
                        "ping": {"pingUser": 0, "pingRole": 0},
                        "text": {"title": msg.subject[:256], "content": "", "description": body[:4000],
                                 "footer": "Mantel"},
                        "ids": {"channel": channel}}}


async def send(transport: Transport, config: dict, secret: dict | None, msg: Message) -> None:
    key = (secret or {}).get("api_key")
    channel = channel_of((config or {}).get("channel"))
    if not isinstance(key, str) or not KEY.match(key) or not host_ok(URL, HOSTS):
        raise ChannelError("the saved API key isn't a Notifiarr key; paste it again", permanent=True)
    if channel is None:
        raise ChannelError("the saved Discord channel ID isn't valid; enter it again", permanent=True)
    status, headers, body = await transport(
        "POST", URL, {"Content-Type": "application/json", "Accept": "text/plain", "X-api-Key": key},
        json.dumps(payload(msg, channel)).encode())
    if 200 <= status < 300:
        reply = json_of(body)
        if reply.get("result") == "error":            # the passthrough's own answer: {"result": "error", "reason"}
            reason = str(reply.get("reason") or "")[:120].replace(key, "")
            raise ChannelError("Notifiarr refused it" + (f": {reason}" if reason else ""), permanent=True)
        return
    if status == 429:
        try:
            wait = float(headers.get("Retry-After", 30))
        except (TypeError, ValueError):
            wait = 30.0
        raise ChannelError("Notifiarr said 429: " + WHY[429], retry_after=wait)
    raise refused("Notifiarr", status, WHY.get(status, ""))
