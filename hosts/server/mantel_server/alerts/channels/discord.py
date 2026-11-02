"""Discord: a channel's webhook (Server Settings → Integrations → Webhooks → Copy Webhook URL).

The URL is the secret (``https://discord.com/api/webhooks/<id>/<token>``; ``discordapp.com`` and the ``ptb.`` and
``canary.`` names too), checked at save and before each send. The message is an embed colored by level, and
``allowed_mentions: {parse: []}``, so a tablet named ``@everyone`` pings nobody. A 429 says how long to wait
(``retry_after``, 30 a minute per webhook); the center waits that long before its retry.
"""
from __future__ import annotations

import json
import re

from ..center import Message
from . import Invalid, Transport, host_ok, json_of, refused, text

KIND = "discord"
NAME = "Discord"
OWNER_ADVANCED = False
HOSTS = ("discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com", "ptb.discordapp.com",
         "canary.discordapp.com")
PATH = re.compile(r"^/api(/v\d+)?/webhooks/\d{5,30}/[A-Za-z0-9_-]{20,200}$")
COLORS = {"critical": 0xE5484D, "warning": 0xF5A524, "info": 0x3E8ED0}
WHY = {401: "the webhook was deleted", 403: "the webhook isn't allowed to post", 404: "the webhook was deleted",
       429: "too many messages; Mantel waits and tries again"}


def url_ok(url: object) -> bool:
    from urllib.parse import urlsplit
    if not host_ok(url, HOSTS):
        return False
    p = urlsplit(str(url))
    return not p.query and not p.fragment and PATH.match(p.path) is not None


def clean(config: dict, secret: dict | None, old: dict | None) -> tuple[dict, dict]:
    url = text((secret or {}).get("url"), 512)
    if not url and old and old.get("url"):
        url = old["url"]
    if not url_ok(url):
        raise Invalid("invalid_webhook", "That isn't a Discord webhook URL. In Discord: the channel's settings → "
                                         "Integrations → Webhooks → Copy Webhook URL.")
    return {}, {"url": url, "main": url}


def payload(msg: Message) -> dict:
    embed = {"title": msg.subject[:256], "description": msg.body[:4000], "color": COLORS.get(msg.level, COLORS["info"])}
    if msg.link:
        embed["url"] = msg.link
    return {"username": "Mantel", "embeds": [embed], "allowed_mentions": {"parse": []}}


async def send(transport: Transport, config: dict, secret: dict | None, msg: Message) -> None:
    from ..center import ChannelError
    url = (secret or {}).get("url")
    if not url_ok(url):
        raise ChannelError("the saved webhook isn't a Discord webhook; paste it again", permanent=True)
    status, headers, body = await transport("POST", url + "?wait=true", {"Content-Type": "application/json"},
                                            json.dumps(payload(msg)).encode())
    if 200 <= status < 300:
        return
    if status == 429:
        after = json_of(body).get("retry_after")
        try:
            wait = float(after if after is not None else headers.get("Retry-After", 5))
        except (TypeError, ValueError):
            wait = 5.0
        raise ChannelError("Discord said 429: " + WHY[429], retry_after=wait)
    raise refused("Discord", status, WHY.get(status, ""))
