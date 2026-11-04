"""Telegram: a bot (made with @BotFather) that posts to one chat, a group or a channel.

Setup is the bot's token, then **Find My Chat**: the bot only speaks when spoken to, so the owner sends it ``/start``
(or adds it to a group), Mantel reads ``getUpdates`` and lists the chats it sees (:func:`find_chats`), and the owner
picks one. The message is HTML (``parse_mode: HTML``) with every piece escaped, so a tablet named ``<b>x`` shows as
typed. Only ``api.telegram.org`` is ever called.

The token is in the URL Telegram's API wants (``/bot<token>/sendMessage``), so that URL is never put in an error, a
log line or a return value: the words below are fixed, and the few Telegram sends back are scrubbed of the token.
"""
from __future__ import annotations

import html
import json
import re

from ..center import ChannelError, Message
from . import Invalid, Transport, host_ok, json_of, refused, text

KIND = "telegram"
NAME = "Telegram"
OWNER_ADVANCED = False
HOSTS = ("api.telegram.org",)
TOKEN = re.compile(r"^\d{6,12}:[A-Za-z0-9_-]{30,50}$")
CHANNEL_NAME = re.compile(r"^@[A-Za-z][A-Za-z0-9_]{4,31}$")
LIMIT = 4096                       # Telegram's message length
WHY = {400: "Telegram refused the message", 401: "the bot token is wrong or was revoked",
       403: "the bot was removed from the chat or blocked", 404: "the bot token isn't valid",
       409: "the bot has a webhook set, so Mantel can't read its chats; remove the webhook first",
       429: "too many messages; Mantel waits and tries again"}
NO_CHAT = "that chat wasn't found; send the bot /start again and use Find My Chat"


def token_ok(token: object) -> bool:
    return isinstance(token, str) and TOKEN.match(token) is not None


def chat_of(v: object) -> int | str | None:
    """A chat id: a whole number (negative for a group, -100... for a supergroup or channel) or @channelname."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v if v else None
    if isinstance(v, str):
        v = v.strip()
        if re.fullmatch(r"-?[1-9]\d{0,19}", v):
            return int(v)
        if CHANNEL_NAME.match(v):
            return v
    return None


def clean(config: dict, secret: dict | None, old: dict | None) -> tuple[dict, dict]:
    token = text((secret or {}).get("token"), 128)
    if not token and old and old.get("token"):
        token = old["token"]
    if not token_ok(token):
        raise Invalid("invalid_token", "That isn't a Telegram bot token. Message @BotFather, send /newbot, and paste "
                                       "the token it gives you (digits, a colon, then letters and digits).")
    chat = chat_of((config or {}).get("chat_id"))
    if chat is None:
        raise Invalid("invalid_chat", "Pick a chat with Find My Chat, or give a chat ID (a group's is negative) or a "
                                      "channel's @name.")
    return {"chat_id": chat, "chat_name": text((config or {}).get("chat_name"), 128)}, {"token": token, "main": token}


def url_of(token: str, method: str) -> str | None:
    url = f"https://api.telegram.org/bot{token}/{method}"
    return url if token_ok(token) and host_ok(url, HOSTS) else None


def words(status: int, body: bytes, token: str, fallback: str = "") -> ChannelError:
    """Telegram's answer as plain words for the page: no URL, never the token."""
    reply = json_of(body)
    if status == 429:
        params = reply.get("parameters")
        after = params.get("retry_after") if isinstance(params, dict) else None
        if isinstance(after, (int, float)) and not isinstance(after, bool) and after >= 0:
            return ChannelError("Telegram said 429: " + WHY[429], retry_after=float(after))
    why = WHY.get(status, "")
    desc = str(reply.get("description") or "").replace(token, "")[:120] if token else ""
    if status == 400 and "chat not found" in desc.lower():
        why = NO_CHAT
    elif status == 400 and desc:
        why = f"Telegram refused the message ({desc.removeprefix('Bad Request: ')})"
    return refused("Telegram", status, why or fallback)


def message_text(msg: Message) -> str:
    """A bold title line, the body, then the link, each escaped. A body too long for Telegram is cut as plain text
    first (a cut tag or entity would be refused)."""
    head = f"<b>{html.escape(msg.subject)}</b>"
    tail = html.escape(msg.link) if msg.link else ""
    body = msg.body or ""
    room = LIMIT - len(head) - len(tail) - 4
    while len(html.escape(body)) > room and body:
        body = body[:max(int(len(body) * 0.9) - 1, 0)]
    cut = "…" if body != (msg.body or "") else ""
    return "\n".join(x for x in (head, html.escape(body) + cut if body else "", tail) if x)[:LIMIT]


async def send(transport: Transport, config: dict, secret: dict | None, msg: Message) -> None:
    token = (secret or {}).get("token")
    url = url_of(token, "sendMessage") if isinstance(token, str) else None
    chat = chat_of((config or {}).get("chat_id"))
    if url is None:
        raise ChannelError("the saved bot token isn't a Telegram token; paste it again", permanent=True)
    if chat is None:
        raise ChannelError("the saved chat isn't valid; pick it again with Find My Chat", permanent=True)
    payload = {"chat_id": chat, "text": message_text(msg), "parse_mode": "HTML", "disable_web_page_preview": True}
    status, _headers, body = await transport("POST", url, {"Content-Type": "application/json"},
                                             json.dumps(payload).encode())
    if 200 <= status < 300:
        return
    raise words(status, body, token)


async def find_chats(transport: Transport, token: object) -> list[dict]:
    """Find My Chat: the distinct chats the bot has been spoken to in, newest first ``[{id, name, type}]``. Nothing
    is saved; an empty list means nobody has messaged the bot yet."""
    token = text(token, 128)
    url = url_of(token, "getUpdates") if token else None
    if url is None:
        raise Invalid("invalid_token", "That isn't a Telegram bot token. Message @BotFather, send /newbot, and paste "
                                       "the token it gives you.")
    status, _headers, body = await transport("GET", url + "?limit=100&timeout=0", {}, b"")
    reply = json_of(body)
    if not 200 <= status < 300 or reply.get("ok") is False:
        raise words(status, body, token, "it didn't answer")
    updates = reply.get("result")
    seen: dict[int | str, dict] = {}
    for up in sorted((u for u in updates if isinstance(u, dict)) if isinstance(updates, list) else (),
                     key=lambda u: u.get("update_id") if isinstance(u.get("update_id"), int) else 0, reverse=True):
        for key in ("message", "edited_message", "channel_post", "edited_channel_post", "my_chat_member",
                    "chat_member"):
            chat = (up.get(key) or {}).get("chat") if isinstance(up.get(key), dict) else None
            if isinstance(chat, dict) and isinstance(chat.get("id"), int) and chat["id"] not in seen:
                seen[chat["id"]] = {"id": chat["id"], "name": chat_name(chat), "type": text(chat.get("type"), 32)}
    return list(seen.values())


def chat_name(chat: dict) -> str:
    """A private chat by the person's name (or @username), a group or channel by its title."""
    title = text(chat.get("title"), 128)
    if title:
        return title
    person = " ".join(x for x in (text(chat.get("first_name"), 64), text(chat.get("last_name"), 64)) if x)
    if person:
        return person
    user = text(chat.get("username"), 64)
    return f"@{user}" if user else str(chat.get("id"))
