"""The Companion app's phones, for Mantel's notifications (docs/phase9/MANTEL-LINK.md 9.7).

Mantel Link tells Mantel which phones this Home Assistant can notify -- the Companion app's own
`notify.mobile_app_<phone>` services, with each phone's name -- and, when Mantel sends a notification for one of
them (`phone_notify`), calls that service with Mantel's title, message and a few known fields, and nothing else.
A tap on the notification's Dismiss (the Companion app's `mobile_app_notification_action`, an action named
`MANTEL_...`) goes back to Mantel, which takes the banner down on its screens.
"""
from __future__ import annotations

import re
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util import slugify

SERVICE = re.compile(r"^mobile_app_[a-z0-9_]{1,80}$")
ACTION = re.compile(r"^MANTEL_[A-Z]{1,16}_[A-Za-z0-9_-]{1,64}$")
TITLE_MAX, MESSAGE_MAX = 100, 500
EVENT = "mobile_app_notification_action"
LEVELS = ("passive", "active", "time-sensitive")


def phones(hass: HomeAssistant) -> list[dict[str, str]]:
    """The Companion app's phones here: [{service, name}] (the phone's name from its mobile_app entry)."""
    names = {}
    for e in hass.config_entries.async_entries("mobile_app"):
        dev = str(e.data.get("device_name") or e.title or "").strip()
        if dev:
            names[f"mobile_app_{slugify(dev)}"] = dev[:80]
    out = []
    for svc in sorted(hass.services.async_services_for_domain("notify")):
        if SERVICE.match(svc):
            out.append({"service": svc, "name": names.get(svc) or svc[len("mobile_app_"):].replace("_", " ").title()})
    return out[:50]


def phone_call(hass: HomeAssistant, msg: Any) -> tuple[str, dict[str, Any]] | None:
    """(service, data) for notify.<service>, from Mantel's `phone_notify` frame, or None if it isn't one Mantel
    Link carries out: a Companion-app phone this Home Assistant has, a title, a message, these fields only."""
    if not isinstance(msg, dict):
        return None
    service, title, message, extra = msg.get("service"), msg.get("title"), msg.get("message", ""), msg.get("data") or {}
    if (not isinstance(service, str) or not SERVICE.match(service)
            or not hass.services.has_service("notify", service)
            or not isinstance(title, str) or not title.strip() or len(title) > TITLE_MAX
            or not isinstance(message, str) or len(message) > MESSAGE_MAX or not isinstance(extra, dict)):
        return None
    data: dict[str, Any] = {}
    for key in ("tag", "group"):
        v = extra.get(key)
        if isinstance(v, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", v):
            data[key] = v
    for key in ("url", "clickAction"):
        v = extra.get(key)
        if isinstance(v, str) and v.startswith(("https://", "/")) and len(v) <= 300:
            data[key] = v
    acts = extra.get("actions")
    if isinstance(acts, list):
        ok = [{"action": a["action"], "title": a["title"]} for a in acts[:3]
              if isinstance(a, dict) and isinstance(a.get("action"), str) and ACTION.match(a["action"])
              and isinstance(a.get("title"), str) and 0 < len(a["title"]) <= 40]
        if ok:
            data["actions"] = ok
    push = extra.get("push")
    if isinstance(push, dict) and push.get("interruption-level") in LEVELS:
        data["push"] = {"interruption-level": push["interruption-level"]}
    if extra.get("priority") in ("high", "normal"):
        data["priority"] = extra["priority"]
    if extra.get("ttl") == 0:
        data["ttl"] = 0
    return service, {"title": title, "message": message, **({"data": data} if data else {})}
