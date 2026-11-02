"""The command gateway (PLAN §4 "Command gateway", §5, §7): the only way anything Mantel's clients
ask for reaches Home Assistant (or Music Assistant) as a change.

Off unless ``cfg.commands_enabled``: an Owner's Allow Control of the House (server_settings.py, a fresh
sign-in and an audit row; ``--commands-enabled`` only seeds the first start), never with the kill switch
(``cfg.read_only``). No client message can turn it on. While off there is no Gateway (``server.apply_commands``
builds or removes it), the command path in ``ha_client`` cannot be constructed, and every command answers
``commands_disabled``.

Client protocol (on the hub socket, /ws):

  <- {"type": "capabilities", "commands": true, "door": "lan"}   (only when on)
  -> {"type": "command", "id": 7, "kind": "service", "domain": "light", "service": "turn_on",
      "target": {"entity_id": "light.kitchen"}, "data": {...}, "return_response": false}
  -> {"type": "command", "id": 8, "kind": "ws", "msg": {"type": "config/entity_registry/update", ...}}
  -> {"type": "command", "id": 9, "kind": "http", "method": "POST", "path": "/api/...", "body": {...}}
  -> {"type": "command", "id": 10, "kind": "ma", "command": "player_queues/play", "args": {...}}
  -> {"type": "command", "id": 11, "kind": "http", "method": "POST",
      "path": "/api/hk_frontend/talk?entity_id=media_player.door_speaker",
      "content_type": "audio/webm", "body_b64": "<the clip>"}     (the ONE binary upload: talk_command)
  -> {"type": "command", "id": 12, "kind": "talk_live", "speaker": "media_player.door_speaker"}
  <- {"type": "command_result", "id": 12, "result": {"ticket": "<one-time>", "expires_in": 10}, "audit_id": 44}
                                          (LIVE TALK: the ticket opens ONE stream on /ws/talk, talk_relay.py;
                                           the row's result is written when the stream ends)
  -> {"type": "command", "id": 13, "kind": "tablet", "tablet": "kitchen", "verb": "reload"}
                                          (A WALL TABLET'S KIOSK APP, directly: tablet_links.py; the verbs are
                                           TABLET_VERBS only, `configure` on `settings`, audit kind 'tablet')
  <- {"type": "command_result", "id": 7, "result": ..., "audit_id": 41}
  <- {"type": "command_result", "id": 7, "error": {"code": "forbidden", "reason": "no_grant"}, "audit_id": 42}

NO STEP-UP (decision 25): no command asks for a person's PIN or a fresh second factor,
on any door. Who may do what is the roles and grants (rbac.py) alone, and every command has its audit
row. The one code is the house Alarm PIN, for the alarm (below). A command that still carries a
``step_up`` field is refused (``invalid_command``, audited) and its content is never forwarded.

The audit can be read by Owners/Admins (GET /api/audit, filtered and paginated) and keeps a
retention window (cfg.audit_retention_days, default 365): Audit.purge is the only path that deletes,
only rows older than the window, and it logs what it deleted (migration 0007).

Each command, in order: resolve the subject from the session (re-read from the database, so a
role change or a revocation counts at once) -> classify it (a service; a WebSocket write from
``hkClient.WRITES``, exported to ``hk_writes.json``; an HTTP write; an MA command) -> ``Policy.decide``
for every target -> the audit row FIRST (``action_audit``, migration 0004; if it
cannot be written the command is refused and nothing is sent) -> forward with a one-shot ticket bound
to that row -> the result back to the client and into the row. A remote (tunnel) unlock or disarm
also notifies the Owners (an HA persistent notification).

THE ALARM KEYPAD (alarm_pin.py; docs/phase3/GATEWAY.md "The alarm"): an ``alarm_control_panel.alarm_*``
command's ``code`` is taken out in ``service_command``, checked by Mantel (``Gateway._alarm``: the house
Alarm PIN, the only PIN Mantel asks for), and never audited, logged or forwarded; the alarm's own HA
code, if its panel asks for one, comes from Mantel's store. EVERY alarm_* command takes that path.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import sqlite3
import time
from dataclasses import dataclass, field, replace
from importlib.resources import files
from typing import Any, Awaitable, Callable, Iterable

from aiohttp import web

from . import alarm_pin, readproxy
from .authz import ENTITY_ID, Authz, Principal
from .guards import guard
from .ha_client import (REGISTRY_KEYS, TALK_ENTITY, TALK_LIVE_TYPE, CommandBlocked, CommandTicket, HaCommandError, HaCommander,
                        HTTP_METHODS, UPLOAD_MAX_BYTES, UPLOAD_METHOD, UPLOAD_MIN_BYTES, UPLOAD_TYPES, _API_PATH,
                        talk_target, upload_type)

log = logging.getLogger("mantel.gateway")

KINDS = ("service", "ws", "http", "ma", "talk_live", "tablet")
KEYS = {
    "service": frozenset({"type", "id", "kind", "domain", "service", "data", "target", "return_response"}),
    "ws": frozenset({"type", "id", "kind", "msg"}),
    "http": frozenset({"type", "id", "kind", "method", "path", "body", "content_type", "body_b64"}),
    "ma": frozenset({"type", "id", "kind", "command", "args"}),
    "talk_live": frozenset({"type", "id", "kind", "speaker"}),
    "tablet": frozenset({"type", "id", "kind", "tablet", "verb"}),
}
# the audit's kind for each client kind (live talk is a Home Assistant WebSocket subscription)
AUDIT_KIND = {"talk_live": "ws"}
TARGET_KEYS = frozenset({"entity_id", "area_id", "device_id", "floor_id", "label_id"})
NON_ENTITY_TARGETS = TARGET_KEYS - {"entity_id"}
_NAME = re.compile(r"^[a-z0-9_]+$")
# Services that act on no entity, decided as a feature; any other entity-less service is
# `configure` on `settings` (Owner/Admin), so an Adult's "control everything" never reaches
# homeassistant.restart, recorder.purge and the like.
FEATURE_SERVICES = {"notify": "notifications", "persistent_notification": "notifications"}
MANTEL_NOTICE = "mantel_"            # the notification ids of Mantel's own notices in HA (mantel_remote_<audit id>)
SCRIPT_MANAGEMENT = frozenset({"turn_on", "turn_off", "toggle", "reload"})
# Remote (tunnel) actions that notify the Owners (PLAN §7: "an Owner notification on every remote
# unlock/disarm"): the sensitive kinds of locks and alarm panels.
NOTIFY_KINDS = frozenset({"lock", "alarm_control_panel"})
# Doors that may be remote: the tunnel, and HA's sidebar through Ingress ('ha', HA App mode), which
# may itself come through HA's own remote access (docs/phase3/HA-APP.md).
REMOTE_DOORS = frozenset({"tunnel", "ha"})


def _not_remote(authz: Any, ident: Any) -> bool:
    """No "remote access" notice for this identity on the 'ha' door: a person on a trusted sidebar
    (authz.ha_trusted), or a wall tablet that is its own HA user with the home rules (authz.ha_tablet)."""
    if authz is None or ident is None:
        return False
    return bool((hasattr(authz, "ha_trusted") and authz.ha_trusted(ident))
                or (hasattr(authz, "ha_tablet") and authz.ha_tablet(ident)))
# The shortest audit retention window the server accepts (migration 0007's trigger refuses to delete
# anything younger, whatever the maintenance path is told).
MIN_RETENTION_DAYS = 30


def load_writes() -> frozenset[str]:
    """hkClient.WRITES, as tools/export_writes.py exported it (tests pin that it matches hk-client.js)."""
    data = json.loads(files("mantel_server").joinpath("hk_writes.json").read_text())
    return frozenset(data["writes"])


# -- classification ------------------------------------------------------------------------------
class Refused(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


@dataclass
class Check:
    """One RBAC question: `action` on an entity, or on a feature."""
    action: str
    entity_id: str | None = None
    feature: str | None = None
    talk: bool = False                      # decided with the talk-back policy (authz.talk_policy)

    @property
    def target(self) -> str:
        return self.entity_id or f"feature:{self.feature}"


@dataclass
class Command:
    kind: str                               # service | ws | http | ma
    action: str                             # light.turn_on | ws type | "POST /api/x" | MA command
    checks: list[Check]
    frame: dict | None = None               # the WebSocket frame for HA (service / ws)
    http: tuple[str, str, Any] | None = None  # (method, path, body)
    ma: tuple[str, dict] | None = None      # (command, args)
    targets: list[str] = field(default_factory=list)
    upload: tuple[str, str, bytes] | None = None  # (path, bare content type, bytes): the talk-back clip only
    live: str | None = None                 # live talk: the speaker a /ws/talk ticket is issued for
    # MUSIC (music.py): one of HK's music actions or writes, {"op", "args", "return_response"}. Run by
    # Mantel's music engine (Music Assistant directly) when it is on; otherwise `frame` goes to HA as before.
    music: dict | None = None
    alarm: tuple[str, str] | None = None    # an alarm keypad command: (service, the panel it names)
    tablet: tuple[str, str] | None = None   # a wall tablet's kiosk app: (HK's tablet id, one of TABLET_VERBS)
    code: str | None = field(default=None, repr=False)  # the keypad's code: checked by Mantel, never sent


def _entity_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [v.strip() for v in value.split(",") if v.strip()]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise Refused("invalid_command", "entity_id must be a string or a list of strings")
    for v in value:
        if v == "all" or not ENTITY_ID.match(v):
            raise Refused("unsupported_target", f"not a single entity: {v!r}")
    return value


# ENTITIES NAMED IN A SERVICE'S DATA, not its target: HA acts on them too, so each is decided as well, as the
# command it amounts to on that entity. (media_player.join's group_members join those speakers; camera.play_stream
# and tts.speak play on their media_player.) A camera named as media to play is watching that camera.
DATA_ENTITY_FIELDS = {"group_members": "media_player.join", "media_player": "media_player.play_media",
                      "media_player_entity_id": "media_player.play_media"}
CAMERA_MEDIA = re.compile(r"^media-source://camera/([a-z0-9_]+\.[a-z0-9_]+)")


def data_checks(data: dict) -> tuple[list[Check], list[str]]:
    """The checks for the entities a service's data names besides entity_id, and those entities."""
    checks: list[Check] = []
    for key, action in DATA_ENTITY_FIELDS.items():
        if key in data:
            for eid in _entity_list(data[key]):
                checks.append(Check(action, eid))
    media = data.get("media_content_id")
    if isinstance(media, str) and media.startswith("media-source://camera/"):
        m = CAMERA_MEDIA.match(media)
        if m is None or not m.group(1).startswith("camera."):
            raise Refused("unsupported_target", "a camera as media names one camera entity")
        checks += [Check("view", m.group(1)), Check("camera.live", m.group(1))]
    elif isinstance(media, str) and media.startswith(readproxy.CAMERA_MEDIA):
        # an NVR's recording (Frigate, UniFi Protect, ...) names no camera entity: the cameras' own live-view right
        checks.append(Check("camera.live", feature="cameras"))
    return checks, list(dict.fromkeys(c.target for c in checks))


def service_command(domain: Any, service: Any, data: Any, target: Any, return_response: Any = False) -> Command:
    if not isinstance(domain, str) or not isinstance(service, str) or not _NAME.match(domain) or not _NAME.match(service):
        raise Refused("invalid_command", "domain and service are plain names")
    data = {} if data is None else data
    target = {} if target is None else target
    if not isinstance(data, dict) or not isinstance(target, dict):
        raise Refused("invalid_command", "data and target are objects")
    if set(target) - TARGET_KEYS:
        raise Refused("invalid_command", f"target carries {sorted(TARGET_KEYS)} only")
    if not isinstance(return_response, bool):
        raise Refused("invalid_command", "return_response is true or false")
    for src in (target, data):
        # fail closed: an area/device/floor/label target would expand inside HA to entities we never checked
        if any(src.get(k) not in (None, [], "") for k in NON_ENTITY_TARGETS):
            raise Refused("unsupported_target", "only entity targets are accepted (area/device/floor/label are not)")
    ids = list(dict.fromkeys(_entity_list(target.get("entity_id")) + _entity_list(data.get("entity_id"))))
    action = f"{domain}.{service}"
    alarm, code = None, None
    if alarm_pin.is_keypad(domain, service):
        # THE ALARM KEYPAD (alarm_pin.py, GATEWAY.md "The alarm"): the code the person typed is taken out
        # HERE, before anything is audited or sent; Mantel checks it and never forwards it.
        if set(data) - {"entity_id", "code"} or set(target) - {"entity_id"}:
            raise Refused("invalid_command", "an alarm command carries entity_id and code only")
        if len(ids) != 1 or not ids[0].startswith(alarm_pin.DOMAIN + "."):
            raise Refused("unsupported_target", "an alarm command names exactly one alarm panel")
        code = data.get("code")
        if code is not None and not isinstance(code, str):
            raise Refused("invalid_command", "the code is text")
        code = code or None
        data = {k: v for k, v in data.items() if k != "code"}
        alarm = (service, ids[0])
    extra, named = data_checks(data)
    if ids:
        checks = [Check(action, eid) for eid in ids]
    elif domain in FEATURE_SERVICES:
        checks = [Check(action, feature=FEATURE_SERVICES[domain])]
        if domain == "persistent_notification" and service != "create" and not (
                isinstance(data.get("notification_id"), str) and not data["notification_id"].startswith(MANTEL_NOTICE)):
            # Mantel's own notices for the Owners (an unlock from away, _notify_owners) are not the actor's to
            # take away: the person who unlocked could dismiss the notice about it. Dismissing one, or every
            # notice at once (dismiss_all), is a settings-level change.
            checks.append(Check("configure", feature="settings"))
    elif domain == "script" and service not in SCRIPT_MANAGEMENT:
        ids = [f"script.{service}"]                       # script.<name>: running that script
        checks = [Check(action, ids[0])]
    else:
        checks = [Check("configure", feature="settings")]
    frame: dict = {"type": "call_service", "domain": domain, "service": service}
    if data:
        frame["service_data"] = data
    if target:
        frame["target"] = target
    if return_response:
        frame["return_response"] = True
    targets = ids or [c.target for c in checks]
    return Command("service", action, checks + extra, frame=frame,
                   targets=targets + [t for t in named if t not in targets], alarm=alarm, code=code)


def ws_rule(kind: str) -> tuple[str, str]:
    """(RBAC action, "entity:<key>" | "feature:<name>") for a WebSocket write from the catalog.

    Explicit for what acts on an entity or a non-settings feature; every other write (HK's settings,
    boards, dashboards, tablets, registries) is `configure` on `settings`, so only Owner/Admin by
    default. P3.5 moves HK's own settings into Mantel; until then they are forwarded to HA's hk_frontend.
    """
    if kind.startswith("calendar/event/"):
        return "control", "entity:entity_id"
    if kind == "config/entity_registry/update":
        return "configure", "entity:entity_id"
    if kind == "frontend/set_user_data":
        return "configure", "feature:profile"
    if kind.endswith("/settings/set"):
        return "configure", "feature:settings"
    if kind.startswith("hk_music/"):
        return "control", "feature:music"
    if kind.startswith("hk_notify/"):
        return "configure", "feature:notifications"
    if kind.startswith("hk_energy/"):
        return "configure", "feature:energy"
    return "configure", "feature:settings"


# DOORBELL TALK-BACK (docs/phase3/GATEWAY.md "Doorbell talk-back"). The one HTTP write that carries
# bytes: the recorded clip HK's doorbell sheet POSTs to hk_frontend's talk view, which has the
# speaker play it (media_player.play_media). Two checks, both must pass:
#   * `media_player.play_media` on the speaker: what HA will do with it (RBAC `control` on that entity);
#   * `camera.talk` on feature `cameras`: talking at the door is part of the doorbell, so it follows
#     the camera rules: sensitive kind `camera`, so wall tablets may (authz.HOUSE_GRANTS); on the tunnel
#     (and the `ha` door under tunnel rules) the role's `tunnel_sensitive` and `tunnel_cameras`
#     switches; a Child or Guest (cameras denied) never. No PIN or step-up on any door (decision 25).
TALK_ACTION = "camera.talk"
_B64 = re.compile(r"^[A-Za-z0-9+/]*={0,2}$")
_B64_MAX = 4 * ((UPLOAD_MAX_BYTES + 2) // 3)


def talk_checks(speaker: str) -> list[Check]:
    """The two talk-back checks (clip and live alike), decided with the talk-back policy, so a wall
    tablet may talk on the doorbell's speaker from HK's pop-up settings (authz.TALK_ROLES)."""
    return [Check("media_player.play_media", speaker, talk=True), Check(TALK_ACTION, feature="cameras", talk=True)]


def talk_live_command(msg: dict) -> Command:
    """LIVE TALK (docs/phase3/GATEWAY.md "Doorbell talk-back"): the same two checks as the clip; what
    is forwarded is a one-time ticket for ONE stream on /ws/talk (talk_relay.py), not a frame."""
    speaker = msg.get("speaker")
    if not isinstance(speaker, str) or not TALK_ENTITY.match(speaker):
        raise Refused("unsupported_target", "live talk is for one media_player entity (the doorbell's speaker)")
    checks = talk_checks(speaker)
    return Command("ws", TALK_LIVE_TYPE, checks, live=speaker, targets=[c.target for c in checks])


def talk_command(method: Any, path: str, msg: dict) -> Command:
    import base64
    speaker = talk_target(path)
    if method != UPLOAD_METHOD or speaker is None:
        raise Refused("unsupported_body", "a binary body goes only to POST /api/hk_frontend/talk?entity_id=media_player.<name>")
    if msg.get("body") is not None:
        raise Refused("invalid_command", "an upload carries body_b64, not body")
    ctype = upload_type(msg.get("content_type"))
    if ctype is None:
        raise Refused("unsupported_body", f"the clip is one of {sorted(UPLOAD_TYPES)}")
    raw = msg.get("body_b64")
    if not isinstance(raw, str) or not _B64.match(raw) or len(raw) % 4:
        raise Refused("unsupported_body", "body_b64 is the clip in base64")
    if len(raw) > _B64_MAX:
        raise Refused("body_too_large", f"the clip is at most {UPLOAD_MAX_BYTES} bytes")
    body = base64.b64decode(raw, validate=True)
    if len(body) > UPLOAD_MAX_BYTES:
        raise Refused("body_too_large", f"the clip is at most {UPLOAD_MAX_BYTES} bytes")
    if len(body) < UPLOAD_MIN_BYTES:
        raise Refused("unsupported_body", "the clip is empty")
    checks = talk_checks(speaker)
    return Command("http", f"{UPLOAD_METHOD} {path.split('?', 1)[0]}", checks, upload=(path, ctype, body),
                   targets=[c.target for c in checks])


# A WALL TABLET'S KIOSK APP, DIRECTLY (docs/phase8/KIOSK.md "Commands"; tablet_links.py): Mantel sends the command
# to the tablet's Kiosk Satellite or Fully itself, with the secret paired on the tablet's page. A closed list of
# verbs, each one HK Settings' own button (Wall Tablets: Reload, Clear Cache & Reload, and All at Once). They are
# HK Settings' actions, so `configure` on `settings` (Owner/Admin by default; a wall tablet never); audit kind
# 'tablet' (migration 0019), target "tablet:<id>".
TABLET_VERBS = ("reload", "clear_cache")
_TABLET_ID = re.compile(r"^[a-z0-9_]{1,64}$")


def tablet_command(msg: dict) -> Command:
    tid, verb = msg.get("tablet"), msg.get("verb")
    if not isinstance(tid, str) or not _TABLET_ID.match(tid):
        raise Refused("invalid_command", "tablet is one of HK's tablet ids")
    if verb not in TABLET_VERBS:
        raise Refused("invalid_command", f"verb is one of {TABLET_VERBS}")
    return Command("tablet", f"tablet.{verb}", [Check("configure", feature="settings")], tablet=(tid, verb),
                   targets=[f"tablet:{tid}"])


def classify(msg: dict, writes: frozenset[str]) -> Command:
    """A client `command` message -> Command, or Refused. Pure: no I/O."""
    kind = msg.get("kind")
    if kind not in KINDS:
        raise Refused("invalid_command", f"kind is one of {KINDS}")
    if set(msg) - KEYS[kind]:
        raise Refused("invalid_command", f"a {kind} command carries {sorted(KEYS[kind])} only")
    if kind == "talk_live":
        return talk_live_command(msg)
    if kind == "tablet":
        return tablet_command(msg)
    from . import music      # HK's music actions and writes (hk_frontend.music_*, hk_music/*): music.py's checks
    if kind == "service":
        got = music.classify_service(msg.get("domain"), msg.get("service"), msg.get("data"), msg.get("target"),
                                     msg.get("return_response", False))
        if got is not None:
            return got
        return service_command(msg.get("domain"), msg.get("service"), msg.get("data"), msg.get("target"),
                               msg.get("return_response", False))
    if kind == "ws":
        inner = msg.get("msg")
        if not isinstance(inner, dict) or not isinstance(inner.get("type"), str):
            raise Refused("invalid_command", "msg is a WebSocket message with a type")
        t = inner["type"]
        if t not in writes:
            raise Refused("not_a_write", f"{t!r} is not a write (hkClient.WRITES); reads go through `read`")
        if t == TALK_LIVE_TYPE:
            raise Refused("unsupported_command", "live talk is the talk_live command and its own socket (/ws/talk)")
        if t == "call_service":
            extra = set(inner) - {"type", "id", "domain", "service", "service_data", "target", "return_response"}
            if extra:
                raise Refused("invalid_command", f"call_service may not carry {sorted(extra)}")
            got = music.classify_service(inner.get("domain"), inner.get("service"), inner.get("service_data"),
                                         inner.get("target"), inner.get("return_response", False))
            if got is not None:
                return got
            return service_command(inner.get("domain"), inner.get("service"), inner.get("service_data"),
                                   inner.get("target"), inner.get("return_response", False))
        if t == "config/entity_registry/update":
            # HK writes two things to an entity's registry entry: its room (area_id) and, with "Also rename in
            # Home Assistant" (2026-10-31), its display name. Nothing else goes through: above all not
            # `new_entity_id` (renaming the id breaks every automation that names it), nor disabled_by, hidden_by,
            # labels or options, which are Home Assistant's own pages to change.
            extra = set(inner) - REGISTRY_KEYS
            if extra:
                raise Refused("invalid_command", f"config/entity_registry/update carries only entity_id, name and "
                                                 f"area_id, not {sorted(extra)}")
            name = inner.get("name")
            if name is not None and (not isinstance(name, str) or len(name) > 255):
                raise Refused("invalid_command", "name is text of at most 255 characters, or null")
        got = music.classify_ws(inner)
        if got is not None:
            return got
        action, on = ws_rule(t)
        what, name = on.split(":", 1)
        if what == "entity":
            eid = inner.get(name)
            if not isinstance(eid, str) or not ENTITY_ID.match(eid):
                raise Refused("invalid_command", f"{t!r} needs a single entity in {name!r}")
            checks = [Check(action, eid)]
        else:
            checks = [Check(action, feature=name)]
        frame = {k: v for k, v in inner.items() if k != "id"}
        return Command("ws", t, checks, frame=frame, targets=[c.target for c in checks])
    if kind == "http":
        method = msg.get("method")
        method = method.upper() if isinstance(method, str) else method
        path, body = msg.get("path"), msg.get("body")
        if method == "GET":
            raise Refused("not_a_write", "GET is a read; use `read_api`")
        if method not in HTTP_METHODS:
            raise Refused("invalid_command", f"method is one of {sorted(HTTP_METHODS)}")
        if not isinstance(path, str) or not _API_PATH.match(path) or ".." in path or "//" in path:
            raise Refused("invalid_command", "path is a plain /api/... path")
        if "body_b64" in msg or "content_type" in msg:
            return talk_command(method, path, msg)
        if path.split("?", 1)[0].startswith("/api/hk_frontend/talk"):
            raise Refused("unsupported_body", "the talk-back clip is audio (body_b64 + content_type)")
        if body is not None and not isinstance(body, (dict, list)):
            raise Refused("unsupported_body", "the body is JSON (an object or a list)")
        seg = path.split("?", 1)[0].split("/")
        if method == "POST" and len(seg) == 5 and seg[2] == "services":
            cmd = service_command(seg[3], seg[4], body if isinstance(body, dict) else {}, None)
            if cmd.alarm is not None:     # its code already taken out; the keypad path is the service command
                raise Refused("unsupported_command", "an alarm is armed or disarmed with a service command")
            checks = cmd.checks
        else:
            checks = [Check("configure", feature="settings")]
        return Command("http", f"{method} {path.split('?', 1)[0]}", checks, http=(method, path, body),
                       targets=[c.target for c in checks])
    # kind == "ma"
    from .connectors.ma import MA_COMMANDS
    command, args = msg.get("command"), msg.get("args") or {}
    if command not in MA_COMMANDS:
        raise Refused("invalid_command", "not a Music Assistant command (connectors/ma.py MA_COMMANDS)")
    if not isinstance(args, dict) or set(args) - MA_COMMANDS[command]:
        raise Refused("invalid_command", f"{command} carries {sorted(MA_COMMANDS[command])} only")
    return Command("ma", command, [Check("control", feature="music")], ma=(command, args), targets=["feature:music"])


# A RAW MUSIC ASSISTANT COMMAND names players by Music Assistant's ids. Each is decided as the media_player entity
# it is in Home Assistant (music.ma_players), as Mantel's music engine decides each room's speaker: the music
# feature alone let a Child drive every speaker. An announcement has Music Assistant fetch any address it is
# given, so it is a settings-level action (Owner, Admin).
MA_PLAYER_ARGS = ("player_id", "queue_id", "target_player", "source_queue_id", "target_queue_id")
MA_PLAYER_LISTS = ("child_player_ids", "player_ids")


def ma_player_checks(cmd: Command, players: dict[str, str]) -> Command:
    """``cmd`` (kind ma) with a check per player it names; ``players`` is {MA player id: media_player entity}."""
    command, args = cmd.ma
    named: list[str] = [args[k] for k in MA_PLAYER_ARGS if k in args]
    for k in MA_PLAYER_LISTS:
        if k in args:
            if not isinstance(args[k], list):
                raise Refused("invalid_command", f"{k} is a list of players")
            named += args[k]
    entities = []
    for pid in named:
        eid = players.get(pid) if isinstance(pid, str) else None
        if eid is None:
            raise Refused("unsupported_target", "not a Music Assistant player of this house's")
        entities.append(eid)
    action = "media_player.turn_off" if command == "players/cmd/power" else "media_player.play_media"
    checks = list(cmd.checks) + [Check(action, eid) for eid in dict.fromkeys(entities)]
    if command == "players/cmd/play_announcement":
        checks.append(Check("configure", feature="settings"))
    return replace(cmd, checks=checks, targets=list(dict.fromkeys(entities)) or cmd.targets)


# -- the audit -----------------------------------------------------------------------------------
class Audit:
    """``action_audit`` (migration 0004): one row per command, written before anything is sent;
    afterwards only its `result` may be written, once. Errors propagate: no row, no command."""

    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self.db = conn
        self.clock = clock
        self.listeners: list[Callable[[dict], None]] = []    # each config row written (the alerts' config.changed)

    def record(self, *, principal: Principal | None, kind: str, action: str | None, targets: Iterable[str],
               decision: str, reason: str, sensitive: str | None = None, step_up: str | None = None,
               step_up_age: float | None = None, result: str | None = None, actor: str | None = None,
               actor_name: str | None = None) -> int:
        ident = principal.identity if principal is not None else None
        u = ident.user if ident is not None else None
        d = ident.device if ident is not None else None
        with self.db:
            cur = self.db.execute(
                "INSERT INTO action_audit (timestamp, actor, actor_name, role, device, device_role, kind, action, target, "
                "decision, reason, sensitive, door, step_up, step_up_age, source_ip, result, result_at, via) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (self.clock(), actor or (u.id if u else None), actor_name or (u.name if u else None),
                 u.role if u else None, d.id if d else None, d.role if d else None, kind,
                 (action or "")[:200] or None, json.dumps(list(targets))[:2000], decision, reason, sensitive,
                 ident.door if ident is not None else None, step_up, step_up_age,
                 principal.source_ip if principal is not None else None,
                 result, self.clock() if result is not None else None,
                 (getattr(ident, "via", None) or None) if ident is not None else None))
        return int(cur.lastrowid)

    def finish(self, audit_id: int, result: str) -> None:
        with self.db:
            self.db.execute("UPDATE action_audit SET result = ?, result_at = ? WHERE id = ? AND result IS NULL",
                            (result[:200], self.clock(), audit_id))

    def config_event(self, event: dict) -> None:
        """rbac_store's audit hook: grant/role/scope changes (before they are applied), and every other
        settings or account change the same way (audit.config: people, roles, passwords, tablets, connections, …).
        ``door``, ``source_ip`` and ``device`` are optional: where the change came from, when the caller
        knows (a door outside the table's CHECK is dropped rather than losing the row)."""
        door = event.get("door")
        with self.db:
            self.db.execute(
                "INSERT INTO action_audit (timestamp, actor, role, device, device_role, kind, action, target, decision, "
                "reason, door, source_ip, via) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (event.get("timestamp") or self.clock(), event.get("actor"), event.get("role"), event.get("device"),
                 event.get("device_role"), "config", str(event.get("action"))[:200],
                 json.dumps(event.get("detail"), default=str)[:2000], "allowed",
                 # why it was allowed: the caller's reason, else the role that may make the change (an Admin's
                 # change was written as "owner" before)
                 event.get("reason") or event.get("role") or "owner",
                 door if door in ("lan", "tunnel", "ha") else None, (event.get("source_ip") or None),
                 (event.get("via") or None)))
        for cb in self.listeners:
            try:
                cb(event)
            except Exception:  # noqa: BLE001 -- the row is written; a listener never undoes it
                log.exception("audit listener failed")

    def rows(self, **where) -> list[dict]:
        sql = "SELECT * FROM action_audit"
        if where:
            sql += " WHERE " + " AND ".join(f"{k} = ?" for k in where)
        return [dict(r) for r in self.db.execute(sql + " ORDER BY id", tuple(where.values()))]

    # -- reading (GET /api/audit) -----------------------------------------------------------------
    def query(self, *, actor: str | None = None, device: str | None = None, decision: str | None = None,
              kind: str | None = None, since: float | None = None, until: float | None = None,
              before: int | None = None, limit: int = 100, via: str | None = None) -> tuple[list[dict], int | None]:
        """Rows newest first, filtered; `before` is the id cursor of the next page (None at the end). ``via``:
        ``mcp`` every assistant's rows, ``-`` none of them, or one assistant's ``mcp:<name>``."""
        where, args = [], []
        if via == "mcp":
            where.append("via LIKE 'mcp%'")
        elif via == "-":
            where.append("via IS NULL")
        elif via is not None:
            where.append("via = ?")
            args.append(via)
        for col, value in (("actor", actor), ("device", device), ("decision", decision), ("kind", kind)):
            if value is not None:
                where.append(f"{col} = ?")
                args.append(value)
        if since is not None:
            where.append("timestamp >= ?")
            args.append(since)
        if until is not None:
            where.append("timestamp < ?")
            args.append(until)
        if before is not None:
            where.append("id < ?")
            args.append(before)
        sql = "SELECT * FROM action_audit" + (" WHERE " + " AND ".join(where) if where else "")
        got = [dict(r) for r in self.db.execute(sql + " ORDER BY id DESC LIMIT ?", (*args, limit + 1))]
        more = len(got) > limit
        got = got[:limit]
        for r in got:
            try:
                r["target"] = json.loads(r["target"]) if r["target"] else []
            except ValueError:
                pass
        return got, (got[-1]["id"] if more and got else None)

    # -- retention (PLAN §7: "append-only with a retention window") ------------------------------------
    PURGE_EVERY = 3600.0

    def purge(self, retention_days: float) -> int:
        """THE maintenance path (migration 0007): delete rows older than the window, in one transaction
        with the permit the DELETE trigger asks for, and log it (audit_maintenance + a 'system' row).
        Rows inside the window can never be deleted (the trigger refuses, and also refuses anything
        younger than 30 days by the database's own clock)."""
        if not isinstance(retention_days, (int, float)) or retention_days < MIN_RETENTION_DAYS:
            raise ValueError(f"the audit retention window is at least {MIN_RETENTION_DAYS} days")
        now = self.clock()
        cutoff = now - float(retention_days) * 86400.0
        with self.db:
            span = self.db.execute("SELECT COUNT(*) AS n, MIN(id) AS first, MAX(id) AS last FROM action_audit "
                                   "WHERE timestamp < ?", (cutoff,)).fetchone()
            if not span["n"]:
                return 0
            self.db.execute("INSERT INTO audit_purge (id, cutoff, started) VALUES (1, ?, ?)", (cutoff, now))
            deleted = self.db.execute("DELETE FROM action_audit WHERE timestamp < ?", (cutoff,)).rowcount
            self.db.execute("DELETE FROM audit_purge WHERE id = 1")
            self.db.execute("INSERT INTO audit_maintenance (timestamp, action, cutoff, retention_days, deleted, "
                            "first_id, last_id) VALUES (?, 'purge', ?, ?, ?, ?, ?)",
                            (now, cutoff, float(retention_days), deleted, span["first"], span["last"]))
            self.db.execute(
                "INSERT INTO action_audit (timestamp, actor, actor_name, kind, action, target, decision, reason, "
                "result, result_at) VALUES (?, 'mantel', 'Mantel Server', 'system', 'audit.purge', ?, 'allowed', ?, 'ok', ?)",
                (now, json.dumps(["feature:audit"]), f"retention:{retention_days:g}d deleted:{deleted} "
                 f"ids:{span['first']}-{span['last']}", now))
        log.info("audit retention: deleted %d rows older than %g days (ids %s-%s)", deleted, retention_days,
                 span["first"], span["last"])
        return deleted

    def maybe_purge(self, retention_days: float) -> int:
        """The policy tick's call: at most once an hour."""
        now = self.clock()
        last = getattr(self, "_last_purge", None)
        if last is not None and now - last < self.PURGE_EVERY:
            return 0
        self._last_purge = now
        return self.purge(retention_days)


# -- the gateway ---------------------------------------------------------------------------------
class Gateway:
    def __init__(self, app, authz: Authz, audit: Audit, commander: HaCommander | None,
                 writes: frozenset[str], clock: Callable[[], float] = time.time) -> None:
        self.app = app
        self.authz = authz
        self.audit = audit
        self.commander = commander
        self.writes = writes
        self.clock = clock
        self._ma_tickets: dict[int, list[tuple[str, str, CommandTicket]]] = {}

    def capabilities(self, principal: Principal | None) -> dict:
        return {"type": "capabilities", "commands": bool(principal is not None and principal.valid),
                "door": principal.identity.door if principal is not None else None}

    # The Music Assistant command gate (connectors.Hooks.ma_gate): an MA command is allowed only
    # with the one-shot ticket this gateway minted for exactly that principal, command and args.
    def allow(self, identity: Any, command: str, args: dict) -> bool:
        from .music import MusicRun
        if isinstance(identity, MusicRun):
            # one music request's steps (music.py): minted in _forward below after RBAC and the audit
            # row, open only while that request runs, for its own commands on the house's speakers only
            return identity.allow(command, args) is True
        queue = self._ma_tickets.get(id(identity)) or []
        key = json.dumps(args, sort_keys=True, default=str)
        for i, (c, a, ticket) in enumerate(queue):
            if c == command and a == key and not ticket.used and ticket.audit_id > 0:
                ticket.used = True
                del queue[i]
                return True
        return False

    async def handle(self, principal: Principal, msg: dict, send: Callable[[dict], Awaitable[None]]) -> None:
        """One `command` message, answered through `send`. Never raises for the client's mistakes."""
        rid = msg.get("id")

        async def reply(body: dict) -> None:
            await send({"id": rid, **body})

        def fail(code: str, message: str = "", audit_id: int | None = None, **extra) -> dict:
            err = {"code": code, **({"message": message} if message else {}), **extra}
            return {"type": "command_result", "error": err, **({"audit_id": audit_id} if audit_id else {})}

        try:
            await self._handle(principal, msg, reply, fail)
        except sqlite3.Error:
            log.exception("audit write failed; command refused, nothing sent")
            await reply(fail("audit_unavailable", "the audit log could not be written; nothing was sent"))

    async def _handle(self, principal: Principal, msg: dict, reply, fail) -> None:
        msg = dict(msg)
        stray = msg.pop("step_up", None) is not None   # no step-up any more (decision 25); never forwarded
        if not self.authz.refresh(principal):
            self.audit.record(principal=principal, kind=_kind(msg), action=None, targets=[], decision="denied",
                              reason="unauthenticated", result="not_sent")
            return await reply(fail("unauthenticated", "the session or device is no longer valid"))
        if principal.identity.read_only:            # a screen preview (mcp/preview.py) never sends a command
            self.audit.record(principal=principal, kind=_kind(msg), action=_action(msg), targets=[],
                              decision="denied", reason="read_only", result="not_sent")
            return await reply(fail("read_only", "a preview changes nothing"))
        try:
            cmd = classify(msg, self.writes)
            if cmd.kind == "ma":
                from .music import ma_players
                cmd = ma_player_checks(cmd, {pid: eid for eid, pid in ma_players(self.app["hub"].registry).items()})
        except Refused as exc:
            aid = self.audit.record(principal=principal, kind=_kind(msg), action=_action(msg), targets=[],
                                    decision="denied", reason=exc.code, result="not_sent")
            return await reply(fail(exc.code, str(exc), aid))
        if stray:
            aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                    decision="denied", reason="invalid_step_up", result="not_sent")
            return await reply(fail("invalid_command", "commands take no step_up (Mantel asks for no PIN)", aid))
        direct = self._direct(cmd)
        if direct is not None:
            return await self._run_direct(principal, direct, reply, fail)
        if cmd.alarm is not None:
            # EVERY alarm keypad command goes through the house Alarm PIN (_alarm), configured or not
            keypad = self.app.get("alarm_pin")
            if keypad is not None:
                return await self._alarm(principal, cmd, keypad, reply, fail)
            # no keypad engine to check a code: refused, and a page's code is never forwarded
            aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                    decision="denied", reason="alarm_pin_unavailable", result="not_sent")
            return await reply(fail("unavailable", "alarm_pin_unavailable", aid))

        subject = principal.subject
        music = self.app.get("music")
        if music is not None and music.active:
            cmd = music.route(cmd)          # a plain media_player call on Music Assistant speakers: to Music Assistant
        engine = self._music_engine(cmd)
        if engine is not None:
            cmd = engine.expand(cmd)        # Stop All: every room
        ctx = self.authz.context()
        decisions = [(c, (self.authz.decide_talk if c.talk else self.authz.decide)(
                          subject, c.action, c.entity_id, feature=c.feature, ctx=ctx)) for c in cmd.checks]
        denied = next(((c, d) for c, d in decisions if not d.allowed), None)
        sensitive = next((d.sensitive for _, d in decisions if d.sensitive), None)
        if denied is not None:
            c, d = denied
            aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                    decision="denied", reason=d.reason, sensitive=sensitive, result="not_sent")
            log.info("denied %s on %s for %s (%s)", cmd.action, c.target, _who(principal), d.reason)
            return await reply(fail("forbidden", f"not allowed: {cmd.action} on {c.target}", aid,
                                    reason=d.reason, target=c.target))

        ident = principal.identity
        unavailable = self._unavailable(cmd)
        if unavailable:
            aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                    decision="denied", reason=unavailable, sensitive=sensitive, result="not_sent")
            return await reply(fail("unavailable", unavailable, aid))
        # THE AUDIT ROW FIRST: if this raises, nothing below runs and nothing is sent.
        aid = self.audit.record(principal=principal, kind=cmd.kind, action=cmd.action, targets=cmd.targets,
                                decision="allowed", reason="granted", sensitive=sensitive)
        try:
            result = await self._forward(principal, cmd, aid)
        except Exception as exc:  # noqa: BLE001 -- HA's error is the client's answer, and the row's result
            code = _error_code(exc)
            self._finish(aid, f"error:{code}")
            log.warning("%s for %s failed: %s", cmd.action, _who(principal), code)
            return await reply(fail(code, str(exc)[:300], aid))
        if cmd.live is None:
            self._finish(aid, "ok")        # live talk: the relay writes the result when the stream ends
        log.info("%s on %s by %s (audit %d)", cmd.action, ",".join(cmd.targets), _who(principal), aid)
        await reply({"type": "command_result", "result": result, "audit_id": aid})
        authz = self.app.get("authz")
        trusted = _not_remote(authz, ident)
        if ident.door in REMOTE_DOORS and sensitive in NOTIFY_KINDS and not trusted:
            await self.notify_owners(principal, cmd, aid)

    def _direct(self, cmd: Command) -> Any:
        """A page's own Clean Areas or automation snooze, run by Mantel's engines (linked_actions.py) as the person
        who asked once Mantel Link holds the bridge; None sends it to Home Assistant's ``hk_frontend`` as before."""
        la = self.app.get("linked_actions")
        return la.direct_of(cmd) if la is not None else None

    async def _run_direct(self, principal: Principal, direct: Any, reply, fail) -> None:
        """The engines make the household calls through THIS gateway as ``principal``: RBAC, the audit row and the
        refusals are each call's own (a vacuum or an automation, as if the person had pressed it). The top-level
        request has no row of its own: a plan only, or the snooze's timer, changes nothing in the house."""
        service, data, want = direct
        try:
            out = await self.app["linked_actions"].run_direct(self, principal, service, data)
        except Exception as exc:  # noqa: BLE001 -- the gateway's answer, or the engine's own words
            got = getattr(exc, "reply", None)
            if got is not None:
                return await reply(dict(got))               # the vacuum's or automation's own refusal, audited
            code, message = getattr(exc, "code", None), getattr(exc, "message", None)
            if code is None:
                log.exception("%s for %s failed", service, _who(principal))
                return await reply(fail("failed", f"hk_frontend.{service} failed; see the log"))
            return await reply(fail({"invalid": "invalid_command", "not_set_up": "unavailable"}.get(code, code),
                                    message or code))
        await reply({"type": "command_result", "result": {"response": out} if want else {}})

    def _music_engine(self, cmd: Command) -> Any:
        """Mantel's music engine when it runs this command (music.py: on once Music Assistant and the
        music settings are in Mantel); None sends a music command to Home Assistant's engine as before."""
        if cmd.music is None:
            return None
        engine = self.app.get("music")
        return engine if engine is not None and engine.active else None

    async def _alarm(self, principal: Principal, cmd: Command, keypad: Any, reply, fail) -> None:
        """THE ALARM KEYPAD (alarm_pin.py; GATEWAY.md "The alarm"). HK's Alarm PIN, decided by Mantel on
        every door: RBAC first (``control.sensitive`` on the keypad panel and the alarm it forwards to
        whenever a code is needed), then the code (already out of the command) must be the house Alarm
        PIN, checked by alarm_pin/pins with its lockout. The audit row is written FIRST, and only then
        does the command go to Home Assistant -- to the alarm itself, with the alarm's own HA code from
        Mantel's store when the panel asks for one. A person's own PIN is not a code here (decision 25)."""
        service, named = cmd.alarm  # type: ignore[misc]
        entry = keypad.entry_for(named)
        code, action, targets = cmd.code, cmd.action, entry.targets()
        needed = entry.needs_code(service, code)
        sensitive = alarm_pin.SENSITIVE if needed else None

        def record(decision: str, reason: str, **kw) -> int:
            return self.audit.record(principal=principal, kind="service", action=action, targets=targets,
                                     decision=decision, reason=reason, sensitive=sensitive, **kw)

        # who may: roles alone, before any code is looked at (a refused role learns nothing of the code)
        subject = principal.subject
        ctx = self.authz.context()
        policy = keypad.keypad_policy(self.authz, subject)
        checks = [Check(action, eid) for eid in targets]
        if needed:
            checks += [Check("control.sensitive", eid) for eid in targets]
        decisions = [(c, policy.decide(subject, c.action, c.entity_id, ctx)) for c in checks]
        denied = next(((c, d) for c, d in decisions if not d.allowed), None)
        if denied is not None:
            c, d = denied
            aid = record("denied", d.reason, result="not_sent")
            log.info("denied %s on %s for %s (%s)", action, c.target, _who(principal), d.reason)
            return await reply(fail("forbidden", f"not allowed: {action} on {c.target}", aid,
                                    reason=d.reason, target=c.target))
        # the code: the house Alarm PIN, the only one
        if needed and code is None:
            aid = record("denied", "alarm_code_required", result="not_sent")
            return await reply(fail("code_required", "Enter the alarm code", aid))
        if needed and not entry.house_code:
            aid = record("denied", "alarm_pin_not_set", result="not_sent")
            return await reply(fail("alarm_pin_not_set", "No Alarm PIN is set for this alarm (an Owner sets it in "
                                    "HK Settings, Alarm PIN); nothing was sent", aid))
        verdict = alarm_pin.Verdict("none")
        if code is not None:
            verdict = await keypad.check(principal, entry, code, self.app.get("pins"))
            if not verdict.ok:
                aid = record("denied", f"alarm_code_{verdict.status}", result="not_sent")
                log.info("alarm keypad %s refused a code from %s (%s)", named, _who(principal), verdict.status)
                if verdict.status == "locked":
                    wait = int(verdict.retry_after) + 1
                    return await reply(fail("code_locked", f"Wrong code too many times; the keypad is locked for "
                                            f"{(wait + 59) // 60} min", aid, retry_after=wait))
                return await reply(fail("invalid_code", "Wrong code", aid))
        # the alarm's OWN code, for a panel that asks for one: Mantel's, never the page's
        attrs = _attrs(self.app, entry.forward_to)
        ha_code = None
        if attrs.get("code_format"):
            ha_code = keypad.ha_code(entry.entity) if entry.configured else None
            if not ha_code:
                aid = record("denied", "alarm_ha_code_missing", result="not_sent")
                return await reply(fail("unavailable", "alarm_ha_code_missing", aid))
        if self.commander is None:
            aid = record("denied", "commands_disabled", result="not_sent")
            return await reply(fail("unavailable", "commands_disabled", aid))
        house = verdict.status == "house"
        # THE AUDIT ROW FIRST: if this raises, nothing below runs and nothing is sent. The row's step_up
        # column says the house Alarm PIN was given (never the PIN itself).
        aid = record("allowed", "granted", step_up="alarm_pin" if house else None, step_up_age=0.0 if house else None)
        data: dict = {"entity_id": entry.forward_to}
        if ha_code:
            data["code"] = ha_code
        frame = {"type": "call_service", "domain": alarm_pin.DOMAIN, "service": service, "service_data": data}
        try:
            result = await self.commander.call(frame, CommandTicket(aid, "ws"))
        except Exception as exc:  # noqa: BLE001 -- HA's error is the client's answer, and the row's result
            code_ = _error_code(exc)
            self._finish(aid, f"error:{code_}")
            log.warning("%s for %s failed: %s", action, _who(principal), code_)
            return await reply(fail(code_, str(exc)[:300], aid))
        self._finish(aid, "ok")
        log.info("%s on %s by %s (audit %d)", action, ",".join(targets), _who(principal), aid)
        await reply({"type": "command_result", "result": result, "audit_id": aid})
        authz = self.app.get("authz")
        trusted = _not_remote(authz, principal.identity)
        if service == alarm_pin.DISARM and principal.identity.door in REMOTE_DOORS and not trusted:
            cmd.targets = targets
            await self.notify_owners(principal, cmd, aid)

    def _unavailable(self, cmd: Command) -> str | None:
        if cmd.tablet is not None:
            links = self.app.get("tablet_links")
            if links is None or links.get(cmd.tablet[0]) is None:
                return "tablet_not_paired"
            return None if self.commander is not None else "commands_disabled"
        if cmd.live is not None and (self.commander is None or self.app.get("talk") is None):
            return "commands_disabled"
        if self._music_engine(cmd) is not None:
            return None
        if cmd.kind == "ma":
            return None if self.app.get("ma") is not None else "music_assistant_off"
        return None if self.commander is not None else "commands_disabled"

    def _finish(self, aid: int, result: str) -> None:
        try:
            self.audit.finish(aid, result)
        except sqlite3.Error:
            log.exception("could not write the result of audit row %d (the command itself ran)", aid)

    async def _forward(self, principal: Principal, cmd: Command, aid: int) -> Any:
        if cmd.tablet is not None:
            from . import tablet_links
            return await tablet_links.send(self.app, *cmd.tablet)
        if cmd.live is not None:
            return self.app["talk"].issue(principal, cmd.live, aid)
        engine = self._music_engine(cmd)
        if engine is not None:
            return await engine.run(principal, cmd.music, aid)
        if cmd.kind in ("service", "ws"):
            res = await self.commander.call(dict(cmd.frame or {}), CommandTicket(aid, "ws"))  # type: ignore[union-attr]
            if cmd.kind == "ws" and (cmd.frame or {}).get("type") in alarm_pin.PAGE_SAVES:
                # HK Settings' Alarm PIN page: what HA accepted is Mantel's keypads' PIN too (alarm_pin.py)
                await alarm_pin.follow_page_save(self.app, cmd.frame or {}, res)
            return res
        if cmd.upload is not None:
            path, ctype, data = cmd.upload
            return await self.commander.upload(path, ctype, data, CommandTicket(aid, "upload"))  # type: ignore[union-attr]
        if cmd.kind == "http":
            method, path, body = cmd.http  # type: ignore[misc]
            return await self.commander.http(method, path, body, CommandTicket(aid, "http"))  # type: ignore[union-attr]
        command, args = cmd.ma  # type: ignore[misc]
        queue = self._ma_tickets.setdefault(id(principal), [])
        queue.append((command, json.dumps(args, sort_keys=True, default=str), CommandTicket(aid, "ma")))
        try:
            return await self.app["ma"].command(principal, command, **args)
        finally:
            if not queue:
                self._ma_tickets.pop(id(principal), None)

    async def notify_owners(self, principal: Principal, cmd: Command, aid: int) -> None:
        """PLAN §7: every remote (tunnel) unlock/disarm notifies the Owners. Through HA's persistent
        notifications when commands are on (audited as the server's own action); logged otherwise."""
        who = _who(principal)
        when = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.clock()))
        door = principal.identity.door if principal is not None else "tunnel"
        how = "through Home Assistant's sidebar" if door == "ha" else "remotely (tunnel door)"
        message = f"{who} used {cmd.action} on {', '.join(cmd.targets)} {how} at {when}."
        if self.commander is None:
            log.warning("OWNER NOTICE (not sent: commands are off): %s", message)
            return
        frame = {"type": "call_service", "domain": "persistent_notification", "service": "create",
                 "service_data": {"title": "Mantel: remote access", "message": message,
                                  "notification_id": f"mantel_remote_{aid}"}}
        try:
            nid = self.audit.record(principal=None, kind="system", action="persistent_notification.create",
                                    targets=["feature:notifications"], decision="allowed",
                                    reason=f"owner_notification:{aid}", actor="mantel", actor_name="Mantel Server")
            await self.commander.call(frame, CommandTicket(nid, "ws"))
            self._finish(nid, "ok")
        except Exception as exc:  # noqa: BLE001 -- the command ran; the notice is best effort, and logged
            log.error("could not notify the Owners of a remote %s (audit %d): %s", cmd.action, aid, exc)


def _kind(msg: dict) -> str:
    k = msg.get("kind")
    return AUDIT_KIND.get(k, k) if k in KINDS else "service"


def _action(msg: dict) -> str | None:
    k = msg.get("kind")
    if k == "service" and isinstance(msg.get("domain"), str) and isinstance(msg.get("service"), str):
        return f"{msg['domain']}.{msg['service']}"[:200]
    if k == "ws" and isinstance(msg.get("msg"), dict):
        t = msg["msg"].get("type")
        return t[:200] if isinstance(t, str) else None
    if k == "http":
        return f"{msg.get('method')} {str(msg.get('path')).split('?', 1)[0]}"[:200]
    if k == "ma" and isinstance(msg.get("command"), str):
        return msg["command"][:200]
    if k == "talk_live":
        return TALK_LIVE_TYPE
    if k == "tablet" and isinstance(msg.get("verb"), str):
        return f"tablet.{msg['verb']}"[:200]
    return None


def _attrs(app: Any, entity_id: str) -> dict:
    """The entity's attributes from the hub's state copy ({} when unknown)."""
    hub = app.get("hub") if hasattr(app, "get") else None
    st = getattr(getattr(hub, "store", None), "states", {}).get(entity_id) if hub is not None else None
    a = st.get("a") if isinstance(st, dict) else None
    return a if isinstance(a, dict) else {}


def _who(principal: Principal) -> str:
    u, d = principal.user, principal.device
    parts = [f"{u.name or u.username or u.id} ({u.role})"] if u else []
    if d:
        parts.append(f"at {d.name}")
    return " ".join(parts) or "someone"


def _error_code(exc: BaseException) -> str:
    if isinstance(exc, HaCommandError):
        return exc.code
    if isinstance(exc, CommandBlocked):
        return "not_allowed"
    if isinstance(exc, (ConnectionError, asyncio.TimeoutError, OSError)):
        return "unavailable"
    name = type(exc).__name__
    if name == "KioskFailed":                       # a wall tablet's kiosk app (tablet_links.send): its own code
        return f"tablet_{exc.code}"                 # type: ignore[attr-defined]
    return "refused" if name == "CommandRefused" else "failed"


# -- the audit read API (PLAN §5: the Owner's "audit log"; Admins too) ----------------------------------
AUDIT_DECISIONS = ("allowed", "denied", "step_up")   # step_up: rows from before decision 25 only
AUDIT_KINDS = ("service", "ws", "http", "ma", "config", "system", "tablet")
AUDIT_PAGE, AUDIT_PAGE_MAX = 100, 500


def _bad(param: str) -> web.Response:
    return web.json_response({"error": "invalid_query", "param": param}, status=400,
                             headers={"Cache-Control": "no-store"})


@guard("signed_in")        # the roles decide (below): at a wall tablet, the tablet's share; a tablet alone, none
async def audit_list(request: web.Request) -> web.Response:
    """``GET /api/audit?actor=&device=&decision=&kind=&since=&until=&before=&limit=``: newest first;
    ``next`` is the ``before`` of the next page. Reading the audit is ``configure`` on feature ``audit``
    (default roles: Owner and Admin; a person at a wall tablet gets the tablet's share: none)."""
    authz: Authz = request.app["authz"]
    p = authz.principal(request)
    if p.user is None or not authz.decide(p.subject, "configure", None, feature="audit").allowed:
        return web.json_response({"error": "forbidden"}, status=403, headers={"Cache-Control": "no-store"})
    q = request.query
    kw: dict[str, Any] = {}
    for name in ("actor", "device"):
        if name in q:
            if not q[name] or len(q[name]) > 64:
                return _bad(name)
            kw[name] = q[name]
    for name, allowed in (("decision", AUDIT_DECISIONS), ("kind", AUDIT_KINDS)):
        if name in q:
            if q[name] not in allowed:
                return _bad(name)
            kw[name] = q[name]
    if "via" in q:                 # mcp: every assistant's rows; -: none of them; mcp:<name>: one assistant's
        if not (q["via"] in ("mcp", "-") or q["via"].startswith("mcp:") and 4 < len(q["via"]) <= 70):
            return _bad("via")
        kw["via"] = q["via"]
    for name in ("since", "until"):
        if name in q:
            try:
                value = float(q[name])
            except ValueError:
                return _bad(name)
            if not math.isfinite(value):
                return _bad(name)
            kw[name] = value
    for name, default in (("before", None), ("limit", AUDIT_PAGE)):
        raw = q.get(name)
        if raw is None:
            if default is not None:
                kw[name] = default
            continue
        try:
            kw[name] = int(raw)
        except ValueError:
            return _bad(name)
    if not 1 <= kw["limit"] <= AUDIT_PAGE_MAX:
        return _bad("limit")
    rows, nxt = request.app["audit"].query(**kw)
    cfg = request.app.get("cfg")
    return web.json_response({"ok": True, "rows": rows, "next": nxt,
                              "retention_days": getattr(cfg, "audit_retention_days", None)},
                             headers={"Cache-Control": "no-store"})


def register_audit(app: web.Application) -> None:
    app.router.add_get("/api/audit", audit_list)
