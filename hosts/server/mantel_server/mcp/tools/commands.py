"""House commands (opt-in: the ``commands`` scope, given only on a signed-in consent while the house allows it).

``house_command`` is a page's ``command`` frame through the gateway (dispatch.command): the person's RBAC on every
entity named, the audit row written before anything is sent, the kill switch and Allow Control of the House
honoured, refused exactly as a page's would be. One call, one command: no batches. The alarm is never reachable:
its commands need the house Alarm PIN, and an assistant is never given it."""
from __future__ import annotations

import re

from ..dispatch import ToolError, command
from . import Tool

DOMAIN = re.compile(r"^[a-z0-9_]{1,64}\Z")
NEVER = frozenset({"alarm_control_panel", "homeassistant", "hassio", "recorder", "system_log", "logger",
                   "persistent_notification", "shell_command", "python_script", "pyscript", "rest_command"})


async def house_command(caller, args: dict) -> dict:
    domain, service = args["domain"], args["service"]
    if not DOMAIN.match(domain) or not DOMAIN.match(service):
        raise ToolError("invalid_arguments", "domain and service: lowercase letters, digits and _")
    if domain in NEVER:
        raise ToolError("forbidden", f"{domain} is not an assistant's to call", {"domain": "refused"})
    data = dict(args.get("data") or {})
    if "entity_id" in data:
        raise ToolError("invalid_arguments", "name the entities in `entity_ids`, not in data", {"data": "entity_id"})
    ids = list(dict.fromkeys(args["entity_ids"]))
    if not ids:
        raise ToolError("invalid_arguments", "entity_ids: at least one", {"entity_ids": "required"})
    data["entity_id"] = ids if len(ids) > 1 else ids[0]
    return await command(caller, {"kind": "service", "domain": domain, "service": service, "data": data})


TOOLS = [
    Tool("house_command", "Control the house",
         "Call one Home Assistant service on named entities (light.turn_on, media_player.media_pause, scene.turn_on, "
         "cover.open_cover...), as the person you act for: their roles decide, the audit log records it first, and "
         "it is refused exactly as a page's button would be. Never the alarm. Off unless the Owner allowed it.",
         {"domain": {"type": "string", "maxLength": 64}, "service": {"type": "string", "maxLength": 64},
          "entity_ids": {"type": "array", "items": {"type": "string", "maxLength": 255}, "maxItems": 20},
          "data": {"type": "object"}},
         house_command, needs="commands", required=("domain", "service", "entity_ids"), write=True,
         planned=False, destructive=True),
]
