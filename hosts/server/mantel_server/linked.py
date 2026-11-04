"""Phase 5: linked mode, Mantel Server's side (PLAN §6; docs/phase5/LINKED-MODE.md).

Home Assistant's ``hk_frontend`` integration, set to "Linked to Mantel Server", keeps the
``hk_frontend.*`` services and the entities HK publishes in HA, so the house's automations, scripts
and history don't notice the move. It does that over ONE authenticated WebSocket to this endpoint:

* HA forwards the services automations call (``set_black_screen``, ``show_popup``,
  ``close_popup``, ``notify``) and the commands HA users send to the mirrored entities (a switch turned on or
  off, the alarm panel armed or disarmed) here; each is answered by id.
* Mantel pushes the entities it publishes (``LinkedRegistry``): their descriptors (platform,
  unique_id, suggested entity id, name, device) and every state change.

**Direction is one way for commands.** Mantel never asks HA to do anything on this channel: the
server's frame types are pinned (``SERVER_TYPES``: hello, result, entity, state, removed, owners) and
HA's side has no handler that calls a service.

**Per-tablet ownership** (linked_owners.py; CUTOVER.md §1 Option A): ``hello`` carries ``owners``
(``{"house": "ha"|"mantel", "tablets": [ids Mantel owns]}``) and an ``owners`` frame follows every
move. Each tablet entity names its ``tablet``; HA mirrors and forwards only the units Mantel owns and
runs its own engines for the rest. With no ``linked_owners`` in the app everything is HA's.

**Who may connect.** A Service account (``service_accounts.py``) with the ``linked`` scope, as an
``Authorization: Bearer`` header on the upgrade request (never a cookie or a query string). Refused:
the tunnel door (``403 lan_only``, PLAN §7: machine credentials are LAN-only), any request carrying an
``Origin`` header (browsers always send one; HA's client does not, so a page can never ride a
credential here), and unknown, revoked or wrongly scoped credentials (``401``). A credential revoked
while connected closes the socket at the next message or recheck (``RECHECK_S``).

**Where the calls go.** ``hooks.handler`` (the orchestrator wires the real features later: the
Sleep Screen's black screen, the pop-ups' channel to screens, Alarm PIN). The default is
``MemoryHandler``, in memory: it keeps each black screen's meaning with hk_core's ``Black`` (so the
``confirmed`` handshake works end to end), records pop-ups and refuses alarm commands.

Ordering guarantee the handshake relies on: a handler's state pushes are sent BEFORE the call's
result on the same socket, so when HA's service call returns, HA already holds the new state.

Wiring for the orchestrator (``server.py`` is not edited here)::

    service_accounts.register(app, hub)
    linked.register(app, hub, linked.LinkedHooks(handler=<the real features>))
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from dataclasses import dataclass, fields
from typing import Any, Mapping

from aiohttp import WSCloseCode, WSMsgType, web

from .guards import WHY_LINKED, open_route

log = logging.getLogger("mantel.linked")

PROTOCOL = 1                   # what a client that does not say (HK Frontend before 9.10) is answered
PROTOCOLS = (1, 2)             # 2: Mantel Link (docs/phase9/MANTEL-LINK.md "Protocol 2")
DOMAINS = ("hk_frontend", "mantel")   # the HA integration on the other end: HK Frontend or Mantel Link
LINK_HEADER = "X-Mantel-Link"  # "domain=mantel; protocol=2; features=a,b" on the upgrade request
PATH = "/linked/ws"
SCOPE = "linked"
SERVICES = ("set_black_screen", "show_popup", "close_popup", "notify")
# protocol 2 also forwards HK Frontend's other actions, run by Mantel's own engines (linked_actions.py)
SERVICES_2 = SERVICES + ("music_play", "music_transfer", "music_stop", "music_transport", "music_play_media",
                         "clean_areas", "pause_automation", "resume_automation")
PLATFORMS = ("switch", "sensor", "binary_sensor", "camera", "alarm_control_panel")
ALARM_COMMANDS = frozenset({"alarm_disarm", "alarm_arm_home", "alarm_arm_away", "alarm_arm_night",
                            "alarm_arm_vacation", "alarm_arm_custom_bypass", "alarm_trigger"})
COMMANDS: dict[str, frozenset[str]] = {"switch": frozenset({"turn_on", "turn_off", "toggle"}),
                                       "alarm_control_panel": ALARM_COMMANDS}
CLIENT_TYPES = frozenset({"call_service", "entity_command", "ping"})
# protocol 2 adds `report`: what Mantel Link tells about its Home Assistant (is HK Frontend there?)
CLIENT_TYPES_2 = CLIENT_TYPES | {"report", "phone_action"}
# a client that asked for the settings (feature `settings`, HK Frontend) may also send `settings_write`: one save,
# as the person linked to the Home Assistant user who made it (linked_settings.py)
SETTINGS_TYPES = frozenset({"settings_write", "report"})
# ...and one that forwards its dashboards' feature reads (feature `reads`) sends `page` (linked_reads.py)
READS_TYPES = frozenset({"page"})
SERVER_TYPES = frozenset({"hello", "result", "entity", "state", "removed", "owners", "settings", "page_frame"})
# `settings` goes only to a client that asked for it (feature `settings`: HK Frontend, linked_settings.py)
# protocol 2 adds ONE thing Mantel may ask Home Assistant to do: a notification to a Companion-app phone
# (phones.py; Mantel Link calls notify.mobile_app_<phone> and nothing else)
SERVER_TYPES_2 = SERVER_TYPES | {"phone_notify"}
HANDLER_TIMEOUT = 8.0          # under HA's 10 s, so HA's call gets Mantel's own "timeout" first
RECHECK_S = 60.0               # how often an idle socket re-checks that its credential is live
HEARTBEAT_S = 30.0             # pings that find a linked HA gone without a goodbye
MAX_MSG = 1 << 20
LINK_ACCOUNT_KEY = "mantel_link_account"   # linked_house: the Service account Mantel Link last connected with
MAX_TARGETS = 50

_KEYS = {"call_service": {"id", "type", "service", "data", "targets"},
         "entity_command": {"id", "type", "unique_id", "command", "data"},
         "ping": {"id", "type"},
         "report": {"id", "type", "report"},
         "phone_action": {"id", "type", "action", "service"},
         "settings_write": {"id", "type", "ha_user", "msg"},
         "page": {"id", "type", "ha_user", "frame"}}
# a report's parts (protocol 2), each checked by its own key
_REPORT_KEYS = frozenset({"hk_frontend", "phones", "hk_dashboards", "versions"})
_VERSION = re.compile(r"^[0-9][0-9A-Za-z.+-]{0,31}$")
_BOARD = re.compile(r"^[a-z0-9_-]{1,80}$")
_PHONE = re.compile(r"^mobile_app_[a-z0-9_]{1,80}$")
_POPUP_KEYS = frozenset({"popup", "dashboards", "users"})
_BLACK_KEYS = frozenset({"black", "brightness"})
# hk_frontend.notify, as HA's NOTIFY_SCHEMA validated it (features/notifications)
_NOTIFY_KEYS = frozenset({"title", "message", "important", "wake", "stay", "icon", "entity", "camera", "tap",
                          "page", "dashboards", "users"})
_NOTIFY_TAPS = frozenset({"sheet", "camera", "page", "none"})
_ICON = re.compile(r"^(hk|mdi):[a-z0-9-]+$")
_EID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
_PAGE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")         # hk_core.notifications.const.PAGE_RE
NO_OWNERS = {"house": "ha", "tablets": [], "bridge": "hk_frontend"}
BRIDGES = ("hk_frontend", "mantel")     # who mirrors Mantel's entities in HA: HK Frontend or Mantel Link
_SLUG = re.compile(r"^[a-z0-9_]+$")
_KEEP = object()


class LinkedError(Exception):
    """A refusal the HA side shows as the service call's error: ``code`` and a message."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


# -- entities Mantel publishes ------------------------------------------------------------------------
def _json_value(v: Any) -> bool:
    if v is None or isinstance(v, (str, bool, int)):
        return True
    if isinstance(v, float):
        return math.isfinite(v)
    if isinstance(v, (list, tuple)):
        return all(_json_value(x) for x in v)
    if isinstance(v, dict):
        return all(isinstance(k, str) and _json_value(x) for k, x in v.items())
    return False


def _state_ok(state: Any) -> bool:
    return state is None or isinstance(state, (str, bool, int)) or (isinstance(state, float) and math.isfinite(state))


def check_entity(desc: Mapping[str, Any]) -> dict[str, Any]:
    """A linked entity's descriptor, checked and normalised (ValueError otherwise).

    unique_id     the entity's unique id in HA, exactly as hk_frontend made it (it is what keeps the
                  entity id, history and automations: PLAN §6 "change nothing")
    platform      switch | sensor | binary_sensor | camera | alarm_control_panel
    entity_id     the id to suggest the first time HA registers it ("switch.hall_black_screen");
                  HA's registry keeps the existing one for a known unique_id
    name, translation_key, has_entity_name, icon, unit   how HA names and shows it
    device        {identifier, name, manufacturer?, model?}: the HA device it sits on (hk_frontend's
                  identifiers, so the entity stays on its device)
    state, attributes, available    the state
    features      camera {stream_source}; alarm {supported_features, code_format, code_arm_required}
    tablet        the wall tablet it belongs to (its id: the unit of ownership, linked_owners.py), or
                  null for the house's own (Seasonal decorations, Alarm PIN, Live TV)
    """
    if not isinstance(desc, Mapping):
        raise ValueError("an entity is an object")
    uid = desc.get("unique_id")
    if not isinstance(uid, str) or not 0 < len(uid) <= 255:
        raise ValueError("unique_id: a string of 1-255 characters")
    platform = desc.get("platform")
    if platform not in PLATFORMS:
        raise ValueError(f"platform: one of {PLATFORMS}")
    out: dict[str, Any] = {"unique_id": uid, "platform": platform}
    eid = desc.get("entity_id")
    if eid is not None:
        if not isinstance(eid, str) or not eid.startswith(platform + ".") or not _SLUG.match(eid.split(".", 1)[1]):
            raise ValueError(f"entity_id: {platform}.<lowercase_slug>")
    out["entity_id"] = eid
    name = desc.get("name")
    if name is not None and (not isinstance(name, str) or len(name) > 255):
        raise ValueError("name: a string")
    out["name"] = name
    tkey = desc.get("translation_key")
    if tkey is not None and (not isinstance(tkey, str) or not _SLUG.match(tkey)):
        raise ValueError("translation_key: a lowercase slug")
    out["translation_key"] = tkey
    out["has_entity_name"] = bool(desc.get("has_entity_name", True))
    for key in ("icon", "unit"):
        v = desc.get(key)
        if v is not None and (not isinstance(v, str) or len(v) > 64):
            raise ValueError(f"{key}: a short string")
        out[key] = v
    dev = desc.get("device")
    if dev is not None:
        if (not isinstance(dev, Mapping) or not isinstance(dev.get("identifier"), str) or not dev["identifier"]
                or not isinstance(dev.get("name"), str)):
            raise ValueError("device: {identifier, name, manufacturer?, model?}")
        dev = {"identifier": dev["identifier"], "name": dev["name"],
               **{k: str(dev[k]) for k in ("manufacturer", "model") if dev.get(k)}}
    out["device"] = dev
    state = desc.get("state")
    if not _state_ok(state):
        raise ValueError("state: a string, number, boolean or null")
    out["state"] = state
    attrs = desc.get("attributes") or {}
    if not isinstance(attrs, Mapping) or not _json_value(dict(attrs)):
        raise ValueError("attributes: an object of JSON values")
    out["attributes"] = dict(attrs)
    out["available"] = bool(desc.get("available", True))
    feats = desc.get("features") or {}
    if not isinstance(feats, Mapping) or not _json_value(dict(feats)):
        raise ValueError("features: an object of JSON values")
    out["features"] = dict(feats)
    tablet = desc.get("tablet")
    if tablet is not None and (not isinstance(tablet, str) or not 0 < len(tablet) <= 80):
        raise ValueError("tablet: the wall tablet's id (its unit of ownership), or null for the house's")
    out["tablet"] = tablet
    return out


def _copy(d: Any) -> Any:
    return json.loads(json.dumps(d))


def wire_owners(owners: Mapping[str, Any] | None) -> dict[str, Any]:
    """Who owns what, as every linked HA is told: ``house``, ``tablets`` (the ones Mantel owns) and
    ``bridge`` (who mirrors them in HA: ``hk_frontend``, the default, or ``mantel``, Mantel Link).
    HK Frontend before its 9.10 release reads only the first two."""
    owners = owners or {}
    return {"house": "mantel" if owners.get("house") == "mantel" else "ha",
            "tablets": sorted({str(t) for t in owners.get("tablets") or []}),
            "bridge": "mantel" if owners.get("bridge") == "mantel" else "hk_frontend"}


def parse_link_header(value: str | None) -> tuple[str, int, frozenset[str]]:
    """The client's ``X-Mantel-Link`` header: (domain, protocol, features). No header (HK Frontend
    before 9.10): ``hk_frontend``, protocol 1, no features. A protocol above Mantel's own is answered
    with Mantel's newest (the client then says it is too old for it)."""
    domain, protocol, features = "hk_frontend", 1, frozenset()
    for part in (value or "").split(";"):
        key, _, val = part.strip().partition("=")
        key, val = key.strip().lower(), val.strip()
        if key == "domain" and val in DOMAINS:
            domain = val
        elif key == "protocol" and val.isdigit():
            protocol = max(PROTOCOLS[0], min(int(val), PROTOCOLS[-1]))
        elif key == "features":
            features = frozenset(f.strip() for f in val.split(",") if re.fullmatch(r"[a-z0-9_]{1,32}", f.strip()))
    return domain, protocol, features


class LinkedRegistry:
    """The entities Mantel publishes to linked HA instances, and their state. Every change is
    pushed to every connected linked client at once."""

    def __init__(self) -> None:
        self.entities: dict[str, dict[str, Any]] = {}
        self.clients: set["LinkedClient"] = set()
        # who owns which unit (linked_owners.py's wire form), told in hello and in `owners` frames
        self.owners: dict[str, Any] = _copy(NO_OWNERS)

    def get(self, unique_id: str) -> dict[str, Any] | None:
        d = self.entities.get(unique_id)
        return _copy(d) if d is not None else None

    def snapshot(self) -> list[dict[str, Any]]:
        return [_copy(d) for d in self.entities.values()]

    async def publish(self, desc: Mapping[str, Any]) -> dict[str, Any]:
        """Add or replace one entity (its descriptor and state)."""
        d = check_entity(desc)
        self.entities[d["unique_id"]] = d
        await self._push({"type": "entity", "entity": d})
        return _copy(d)

    async def update(self, unique_id: str, *, state: Any = _KEEP, attributes: Mapping[str, Any] | None = None,
                     merge: bool = True, available: bool | None = None) -> dict[str, Any]:
        """Change one entity's state; attributes merge unless ``merge=False``."""
        d = self.entities.get(unique_id)
        if d is None:
            raise LinkedError("unknown_entity", f"no linked entity {unique_id!r}")
        if state is not _KEEP:
            if not _state_ok(state):
                raise ValueError("state: a string, number, boolean or null")
            d["state"] = state
        if attributes is not None:
            if not isinstance(attributes, Mapping) or not _json_value(dict(attributes)):
                raise ValueError("attributes: an object of JSON values")
            d["attributes"] = {**d["attributes"], **attributes} if merge else dict(attributes)
        if available is not None:
            d["available"] = bool(available)
        await self._push({"type": "state", "unique_id": unique_id, "state": d["state"],
                          "attributes": d["attributes"], "available": d["available"]})
        return _copy(d)

    async def remove(self, unique_id: str, *, forget: bool = True) -> bool:
        """Stop publishing one entity. ``forget``: it is gone (a tablet removed), and HA removes it from
        its registry as before; ``forget=False``: only no longer Mantel's (its unit moved back to HA),
        so HA keeps its registry entry (and entity id) for its own entity."""
        if self.entities.pop(unique_id, None) is None:
            return False
        await self._push({"type": "removed", "unique_id": unique_id, **({} if forget else {"forget": False})})
        return True

    async def set_owners(self, owners: Mapping[str, Any]) -> None:
        """Who owns which unit changed: every linked HA is told at once (``owners``), before any
        entity of a moved unit is published or withdrawn."""
        self.owners = wire_owners(owners)
        await self._push({"type": "owners", "owners": _copy(self.owners)})

    def clients_of(self, domain: str) -> list["LinkedClient"]:
        """The connected clients of one integration (``hk_frontend`` or ``mantel``)."""
        return [c for c in self.clients if c.domain == domain and not c.ws.closed]

    async def _push(self, msg: dict[str, Any]) -> None:
        text = json.dumps(msg)
        for client in list(self.clients):
            if not await client.send_text(text):
                self.clients.discard(client)


class LinkedClient:
    """One linked HA instance's socket. Sends are serialised, so a push and a result never interleave."""

    def __init__(self, ws: web.WebSocketResponse, account: Any, peer: str | None, domain: str = "hk_frontend",
                 protocol: int = 1, features: frozenset[str] = frozenset()) -> None:
        self.ws, self.account, self.peer = ws, account, peer
        self.domain, self.protocol, self.features = domain, protocol, frozenset(features)
        self.report: dict[str, Any] = {}       # protocol 2: the last `report` (HK Frontend there or not)
        self.since: float | None = None
        self.lock = asyncio.Lock()

    def describe(self) -> dict[str, Any]:
        """For Mantel Settings: which integration, how it speaks, what it reported (never a credential)."""
        return {"domain": self.domain, "protocol": self.protocol, "features": sorted(self.features),
                "account": getattr(self.account, "name", None), "account_id": getattr(self.account, "id", None),
                "peer": self.peer, "since": self.since,
                "report": _copy(self.report)}

    async def send(self, msg: dict[str, Any]) -> bool:
        return await self.send_text(json.dumps(msg))

    async def send_text(self, text: str) -> bool:
        if self.ws.closed:
            return False
        try:
            async with self.lock:
                await self.ws.send_str(text)
            return True
        except (ConnectionError, RuntimeError):
            return False


@dataclass(frozen=True)
class CallCtx:
    """Who forwarded a call: the Service account and its address (for the handler's audit), and which
    integration (``hk_frontend`` or ``mantel``: the action's name in messages)."""
    account: Any
    peer: str | None
    domain: str = "hk_frontend"
    protocol: int = 1
    features: frozenset = frozenset()

    def more_services(self) -> bool:
        """Protocol 2 (Mantel Link), or a linked HK Frontend whose house is Mantel's that forwards its own
        music, Clean Areas and automation-snooze actions (feature ``actions``; decision 29)."""
        return self.protocol >= 2 or "actions" in self.features


# -- where forwarded calls go ------------------------------------------------------------------------
class MemoryHandler:
    """The in-memory default handler, until the orchestrator wires the real features.

    * ``set_black_screen``: each target's black screen keeps hk_core's ``Black`` (the meaning HA's
      switch had): on/off resets ``confirmed``, ``brightness`` is carried. ``page_says`` is what the
      page's confirm will call (the real wiring routes the tablet's ``screensaver/black`` here).
    * ``show_popup`` / ``close_popup``: recorded in ``popups`` (and passed to ``on_popup`` if set).
    * switch commands set the switch; alarm commands are refused (no PIN engine wired here).
    """

    def __init__(self, registry: LinkedRegistry, on_popup=None) -> None:
        self.registry = registry
        self.on_popup = on_popup
        self.calls: list[dict[str, Any]] = []
        self.popups: list[dict[str, Any]] = []
        self.commands: list[dict[str, Any]] = []
        self._black: dict[str, Any] = {}

    @staticmethod
    def is_black_screen(desc: Mapping[str, Any] | None) -> bool:
        return bool(desc) and desc["platform"] == "switch" and desc.get("translation_key") == "black_screen"

    def _blk(self, uid: str):
        from hk_core.screensaver.black import Black
        if uid not in self._black:
            d = self.registry.get(uid) or {}
            attrs = d.get("attributes") or {}
            b = attrs.get("brightness")
            self._black[uid] = Black(on=d.get("state") == "on",
                                     brightness=int(b) if isinstance(b, (int, float)) and not isinstance(b, bool) else None,
                                     confirmed=bool(attrs.get("confirmed")))
        return self._black[uid]

    async def _write_black(self, uid: str) -> None:
        blk = self._blk(uid)
        d = self.registry.get(uid) or {}
        board = {"black_screen": (d.get("attributes") or {}).get("black_screen", "kiosk")}
        await self.registry.update(uid, state="on" if blk.on else "off", attributes=blk.attributes(board))

    async def call_service(self, service: str, data: dict[str, Any], targets: list[dict[str, str]],
                           ctx: CallCtx) -> dict[str, Any]:
        self.calls.append({"service": service, "data": _copy(data), "targets": _copy(targets)})
        if service == "notify":
            self.popups.append({"service": service, **_copy(data)})
            return {"id": None, "snap": False}
        if service in ("show_popup", "close_popup"):
            self.popups.append({"service": service, **_copy(data)})
            if self.on_popup is not None:
                await _maybe_await(self.on_popup(service, _copy(data)))
            return {"service": service, "popup": data["popup"]}
        # set_black_screen
        out = {}
        for t in targets:
            uid = t["unique_id"]
            if not self.is_black_screen(self.registry.get(uid)):
                raise LinkedError("not_a_black_screen", f"{t['entity_id']} is not a black screen switch")
            blk = self._blk(uid)
            if "brightness" in data:
                blk.brightness = int(data["brightness"])
            if "black" in data:
                blk.set(bool(data["black"]))
            await self._write_black(uid)
            out[t["entity_id"]] = {"on": blk.on}
        return out

    async def entity_command(self, unique_id: str, command: str, data: dict[str, Any], ctx: CallCtx) -> dict[str, Any]:
        self.commands.append({"unique_id": unique_id, "command": command, "data": {k: "***" for k in data}})
        desc = self.registry.get(unique_id)
        if desc["platform"] != "switch":
            raise LinkedError("not_supported", f"{command} is not handled by this Mantel Server yet")
        on = {"turn_on": True, "turn_off": False}.get(command, desc.get("state") != "on")
        if self.is_black_screen(desc):
            self._blk(unique_id).set(on)
            await self._write_black(unique_id)
        else:
            await self.registry.update(unique_id, state="on" if on else "off")
        return {"on": on}

    async def page_says(self, unique_id: str, black: bool) -> bool:
        """The tablet's page: black now (confirms it), or woken by a tap (off). Whether it changed."""
        changed = self._blk(unique_id).page_says(bool(black))
        if changed:
            await self._write_black(unique_id)
        return changed


async def _maybe_await(v: Any) -> Any:
    if asyncio.iscoroutine(v) or isinstance(v, asyncio.Future):
        return await v
    return v


# -- the endpoint -------------------------------------------------------------------------------------
def _check_strs(v: Any, what: str) -> list[str]:
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v) or len(v) > 100:
        raise LinkedError("invalid", f"{what}: a list of strings")
    return v


def _check_notify(data: Mapping[str, Any]) -> None:
    """hk_frontend.notify's data, checked again here (Mantel never relies on HA's validation)."""
    if set(data) - _NOTIFY_KEYS:
        raise LinkedError("invalid", f"unexpected keys {sorted(set(data) - _NOTIFY_KEYS)}")
    title = data.get("title")
    from hk_core.notifications.const import MESSAGE_MAX, TITLE_MAX
    if not isinstance(title, str) or not title.strip() or len(title) > TITLE_MAX:
        raise LinkedError("invalid", f"title: required, at most {TITLE_MAX} characters")
    if "message" in data and (not isinstance(data["message"], str) or len(data["message"]) > MESSAGE_MAX):
        raise LinkedError("invalid", f"message: at most {MESSAGE_MAX} characters")
    for key in ("important", "wake"):
        if key in data and not isinstance(data[key], bool):
            raise LinkedError("invalid", f"{key}: true or false")
    stay = data.get("stay")
    if "stay" in data and (isinstance(stay, bool) or not isinstance(stay, int) or not 0 <= stay <= 3600):
        raise LinkedError("invalid", "stay: 0-3600 seconds")
    if "icon" in data and (not isinstance(data["icon"], str) or not _ICON.match(data["icon"])):
        raise LinkedError("invalid", "icon: mdi:<name> or hk:<name>")
    for key in ("entity", "camera"):
        if key in data and (not isinstance(data[key], str) or not _EID.match(data[key])):
            raise LinkedError("invalid", f"{key}: an entity id")
    if "camera" in data and not data["camera"].startswith("camera."):
        raise LinkedError("invalid", "camera: a camera.* entity")
    if "tap" in data and data["tap"] not in _NOTIFY_TAPS:
        raise LinkedError("invalid", f"tap: one of {sorted(_NOTIFY_TAPS)}")
    if "page" in data and (not isinstance(data["page"], str) or not _PAGE.match(data["page"])):
        raise LinkedError("invalid", "page: a view's path")
    for key in ("dashboards", "users"):
        if key in data:
            _check_strs(data[key], key)


class Linked:
    """What ``register`` installs as ``app["linked"]``: the registry, the handler, the credential check."""

    def __init__(self, registry: LinkedRegistry, handler: Any, accounts: Any, timeout: float = HANDLER_TIMEOUT,
                 recheck: float = RECHECK_S, heartbeat: float | None = HEARTBEAT_S) -> None:
        self.registry, self.handler, self.accounts = registry, handler, accounts
        self.timeout, self.recheck, self.heartbeat = timeout, recheck, heartbeat
        self.instance: str | None = None      # this Mantel's instance id (linked_owners.instance_id)
        # where Mantel's screens are served to browsers (its https address): the only origins Mantel Link's
        # script in HA believes a framed screen's messages from (docs/phase9/MANTEL-LINK.md 9.6)
        self.screen_origins: list[str] = []
        self.listeners: list = []             # fn(client) after a client's report
        self.phone_action = None              # phones.Phones.on_action (protocol 2's phone_action)
        self.on_connect: list = []            # async fn(client) after its hello (linked_settings.py)
        self.settings_write = None            # async fn(client, msg): a `settings_write` (linked_settings.py)
        self.page = None                      # async fn(client, msg): a `page` read (linked_reads.py)
        self.on_disconnect: list = []         # async fn(client) once its socket has closed

    def verify(self, token: str, peer: str | None) -> Any:
        return self.accounts.verify(token, SCOPE, source_ip=peer)

    def take_report(self, client: "LinkedClient", report: Any) -> dict[str, Any]:
        """Protocol 2's ``report``: what Mantel Link says about its Home Assistant. Only known parts,
        each checked; kept on the client (Mantel Settings shows it, the bridge hand-over reads it)."""
        if not isinstance(report, Mapping) or set(report) - _REPORT_KEYS:
            raise LinkedError("invalid", f"report: an object of {sorted(_REPORT_KEYS)}")
        hk = report.get("hk_frontend")
        if hk is not None:
            if not isinstance(hk, Mapping) or set(hk) - {"installed", "loaded", "linked"} or not all(
                    isinstance(v, bool) for v in hk.values()):
                raise LinkedError("invalid", "report.hk_frontend: {installed, loaded, linked} booleans")
            client.report["hk_frontend"] = {k: bool(hk.get(k, False)) for k in ("installed", "loaded", "linked")}
        phones = report.get("phones")
        if phones is not None:
            if (not isinstance(phones, list) or len(phones) > 50 or not all(
                    isinstance(p, Mapping) and set(p) == {"service", "name"} and isinstance(p["service"], str)
                    and _PHONE.match(p["service"]) and isinstance(p["name"], str) and 0 < len(p["name"]) <= 80
                    for p in phones)):
                raise LinkedError("invalid", "report.phones: [{service: mobile_app_..., name}]")
            client.report["phones"] = [{"service": p["service"], "name": p["name"]} for p in phones]
        versions = report.get("versions")
        if versions is not None:
            # the integrations' installed versions (Mantel Link's own, HK Frontend's): the update check compares them
            # with their latest releases (alerts/updates.py). Sent as a report of its own, so an older Mantel that
            # refuses the key loses nothing else
            if (not isinstance(versions, Mapping) or set(versions) - {"mantel", "hk_frontend"} or not all(
                    isinstance(v, str) and _VERSION.match(v) for v in versions.values())):
                raise LinkedError("invalid", "report.versions: {mantel?, hk_frontend?} version strings")
            client.report["versions"] = {k: str(v) for k, v in versions.items()}
        boards = report.get("hk_dashboards")
        if boards is not None:
            # HK Frontend's dashboards in Home Assistant (linked_settings.py: where each screen is drawn)
            if (not isinstance(boards, list) or len(boards) > 200 or not all(
                    isinstance(b, Mapping) and set(b) == {"path", "title"} and isinstance(b["path"], str)
                    and _BOARD.match(b["path"]) and isinstance(b["title"], str) and len(b["title"]) <= 80
                    for b in boards)):
                raise LinkedError("invalid", "report.hk_dashboards: [{path, title}]")
            client.report["hk_dashboards"] = [{"path": b["path"], "title": b["title"]} for b in boards]
        for fn in list(self.listeners):
            try:
                fn(client)
            except Exception:  # noqa: BLE001 -- a listener never breaks the link
                log.exception("linked: a report listener failed")
        return {"ok": True}

    def live(self, account: Any) -> bool:
        check = getattr(self.accounts, "live", None)
        return True if check is None else bool(check(account.id))

    def _targets(self, msg: Mapping[str, Any]) -> list[dict[str, str]]:
        targets = msg.get("targets")
        if targets in (None, []):
            return []
        if not isinstance(targets, list) or len(targets) > MAX_TARGETS:
            raise LinkedError("invalid", "targets: a list")
        out = []
        for t in targets:
            if (not isinstance(t, Mapping) or set(t) != {"entity_id", "unique_id"}
                    or not all(isinstance(t[k], str) for k in t)):
                raise LinkedError("invalid", "each target is {entity_id, unique_id}")
            out.append({"entity_id": t["entity_id"], "unique_id": t["unique_id"]})
        return out

    async def call_service(self, msg: Mapping[str, Any], ctx: CallCtx) -> Any:
        service = msg.get("service")
        more = ctx.more_services() if hasattr(ctx, "more_services") else getattr(ctx, "protocol", 1) >= 2
        if service not in (SERVICES_2 if more else SERVICES):
            raise LinkedError("unknown_service", f"{ctx.domain}.{service} is not forwarded to Mantel Server")
        data = msg.get("data") or {}
        if not isinstance(data, Mapping):
            raise LinkedError("invalid", "data: an object")
        data = dict(data)
        targets = self._targets(msg)
        if service not in SERVICES:
            # music, Clean Areas, automation snooze: checked by linked_actions.py and the command gateway
            if targets:
                raise LinkedError("invalid", f"{service} takes no target")
            if not _json_value(data):
                raise LinkedError("invalid", "data: JSON values")
        elif service == "notify":
            _check_notify(data)
            if targets:
                raise LinkedError("invalid", "notify takes no target")
        elif service in ("show_popup", "close_popup"):
            if set(data) - _POPUP_KEYS:
                raise LinkedError("invalid", f"unexpected keys {sorted(set(data) - _POPUP_KEYS)}")
            if not isinstance(data.get("popup"), str) or not data["popup"].strip():
                raise LinkedError("invalid", "popup: required")
            for key in ("dashboards", "users"):
                if key in data:
                    _check_strs(data[key], key)
            if targets:
                raise LinkedError("invalid", f"{service} takes no target")
        else:
            if set(data) - _BLACK_KEYS:
                raise LinkedError("invalid", f"unexpected keys {sorted(set(data) - _BLACK_KEYS)}")
            if "black" in data and not isinstance(data["black"], bool):
                raise LinkedError("invalid", "black: true or false")
            b = data.get("brightness")
            if "brightness" in data and (isinstance(b, bool) or not isinstance(b, int) or not 0 <= b <= 255):
                raise LinkedError("invalid", "brightness: 0-255")
            if not targets:
                raise LinkedError("invalid", "set_black_screen needs a target")
            for t in targets:
                d = self.registry.entities.get(t["unique_id"])
                if d is None or d["platform"] != "switch":
                    raise LinkedError("unknown_target", f"{t['entity_id']} is not a switch Mantel Server publishes")
        return await asyncio.wait_for(self.handler.call_service(service, data, targets, ctx), self.timeout)

    async def entity_command(self, msg: Mapping[str, Any], ctx: CallCtx) -> Any:
        uid, command = msg.get("unique_id"), msg.get("command")
        d = self.registry.entities.get(uid) if isinstance(uid, str) else None
        if d is None:
            raise LinkedError("unknown_entity", f"no linked entity {uid!r}")
        if command not in COMMANDS.get(d["platform"], ()):
            raise LinkedError("unknown_command", f"{d['platform']} takes no {command!r}")
        data = msg.get("data") or {}
        if not isinstance(data, Mapping) or set(data) - {"code"} or not all(isinstance(v, str) for v in data.values()):
            raise LinkedError("invalid", "data: at most {code}")
        if "code" in data and d["platform"] != "alarm_control_panel":
            raise LinkedError("invalid", "only the alarm panel takes a code")
        return await asyncio.wait_for(self.handler.entity_command(uid, command, dict(data), ctx), self.timeout)


async def _answer(linked: Linked, client: LinkedClient, msg: dict[str, Any]) -> None:
    mid = msg["id"]
    ctx = CallCtx(client.account, client.peer, client.domain, client.protocol, client.features)
    try:
        t = msg["type"]
        if t == "ping":
            result: Any = {"pong": True}
        elif t == "report":
            result = linked.take_report(client, msg.get("report"))
        elif t == "phone_action":
            if linked.phone_action is None:
                raise LinkedError("not_set_up", "Mantel takes no phone actions here")
            result = linked.phone_action(client, {k: msg[k] for k in ("action", "service") if k in msg})
        elif t == "page":
            if linked.page is None:
                raise LinkedError("not_set_up", "Mantel answers no page reads here")
            result = await linked.page(client, msg)
        elif t == "settings_write":
            if linked.settings_write is None:
                raise LinkedError("not_set_up", "Mantel takes no settings saves here")
            result = await asyncio.wait_for(linked.settings_write(client, msg), linked.timeout)
        elif t == "call_service":
            result = await linked.call_service(msg, ctx)
        else:
            result = await linked.entity_command(msg, ctx)
        reply = {"id": mid, "type": "result", "success": True, "result": result if _json_value(result) else None}
    except LinkedError as exc:
        reply = {"id": mid, "type": "result", "success": False, "error": {"code": exc.code, "message": exc.message}}
    except asyncio.TimeoutError:
        reply = {"id": mid, "type": "result", "success": False,
                 "error": {"code": "timeout", "message": f"Mantel Server's handler took over {linked.timeout:g} s"}}
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 -- one bad call never ends the link
        log.exception("linked: %s failed", msg.get("type"))
        reply = {"id": mid, "type": "result", "success": False,
                 "error": {"code": "internal", "message": "Mantel Server could not handle it (see its log)"}}
    await client.send(reply)


def _parse(text: str, protocol: int = 1, features: frozenset[str] = frozenset()) -> tuple[dict[str, Any] | None, str | None]:
    """The message, or why not (a protocol 1 client may not send protocol 2's types; only a client with the
    `settings` feature may send `settings_write`)."""
    try:
        msg = json.loads(text)
    except ValueError:
        return None, "not JSON"
    if not isinstance(msg, dict):
        return None, "not an object"
    mid = msg.get("id")
    if isinstance(mid, bool) or not isinstance(mid, int):
        return None, "id: an integer"
    t = msg.get("type")
    allowed = (CLIENT_TYPES_2 if protocol >= 2 else CLIENT_TYPES) | (SETTINGS_TYPES if "settings" in features else frozenset()) \
        | (READS_TYPES if "reads" in features else frozenset())
    if t not in allowed:
        return msg, f"unknown type {t!r}"
    extra = set(msg) - _KEYS[t]
    if extra:
        return msg, f"unexpected keys {sorted(extra)}"
    return msg, None


# reads="feature:linked": the Service credential's ``linked`` scope (service_accounts.py) stands where a person's feature
# grant would: the entities Mantel publishes into Home Assistant, not a person's view of the house
@open_route("link_credential", why=WHY_LINKED, reads="feature:linked", stream="live:linked")
async def ws_endpoint(request: web.Request) -> web.StreamResponse:
    from .sessions import client_ip, door_of
    linked: Linked = request.app["linked"]
    peer = client_ip(request)
    if request.headers.get("Origin") is not None:
        log.warning("linked: refused a request with an Origin from %s (not for browsers)", peer)
        raise web.HTTPForbidden(text="not for browsers")
    if door_of(request) != "lan":
        log.warning("linked: refused a request on the tunnel door from %s", peer)
        raise web.HTTPForbidden(text="lan_only")
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise web.HTTPUnauthorized(text="a Service credential is required")
    account = linked.verify(token.strip(), peer)
    if account is None:
        log.warning("linked: refused a credential from %s", peer)
        raise web.HTTPUnauthorized(text="credential refused")

    domain, protocol, features = parse_link_header(request.headers.get(LINK_HEADER))
    ws = web.WebSocketResponse(heartbeat=linked.heartbeat, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    client = LinkedClient(ws, account, peer, domain, protocol, features)
    client.since = request.app["clock"]() if "clock" in request.app else None
    registry = linked.registry
    registry.clients.add(client)          # added and snapshotted with no await between: no gap
    owners = request.app.get("linked_owners")
    if owners is not None:
        registry.owners = wire_owners(owners.snapshot())     # the rows, read now: safe across a restart
        if domain == "mantel" and getattr(account, "id", None):
            # which credential Mantel Link uses: the HA App's discovery stands down for one set up by hand
            owners.remember(LINK_ACCOUNT_KEY, {"account": account.id})
    hello = {"type": "hello", "protocol": protocol, "services": list(SERVICES_2 if protocol >= 2 else SERVICES),
             "entities": registry.snapshot(),
             "owners": _copy(registry.owners)}
    if protocol >= 2:
        # Mantel Link: which Mantel this is (its config entry's unique id), never a secret
        hello["instance"] = linked.instance
        hello["screen_origins"] = list(linked.screen_origins)
    log.info("linked: %s (%s) connected from %s as %s, protocol %s", getattr(account, "name", "?"),
             getattr(account, "id", "?"), peer, domain, protocol)
    tasks: set[asyncio.Task] = set()

    async def recheck() -> None:
        while not ws.closed:
            await asyncio.sleep(linked.recheck)
            if not linked.live(account):
                log.warning("linked: credential %s was revoked; closing", getattr(account, "id", "?"))
                await ws.close(code=WSCloseCode.POLICY_VIOLATION, message=b"credential revoked")
                return

    # live.py: a revoked credential (service_accounts.revoke) ends the link at once, and the policy tick looks at it
    # again every minute. The socket's own timer is only for an app without a registry (a bare one in a test).
    from . import live as live_mod
    registry_live = live_mod.of(request.app)
    watcher = asyncio.create_task(recheck()) if registry_live is None else None

    async def close(why: str) -> None:
        if why == live_mod.SHUTDOWN:
            await ws.close(code=WSCloseCode.GOING_AWAY, message=b"server shutdown")
        else:
            log.warning("linked: credential %s was revoked; closing", getattr(account, "id", "?"))
            await ws.close(code=WSCloseCode.POLICY_VIOLATION, message=b"credential revoked")
    entry = registry_live.add(f"linked:{domain}", account, close, recheck=lambda: linked.live(account),
                              keys=[f"service:{getattr(account, 'id', '')}"]) if registry_live is not None else None
    try:
        await client.send(hello)
        for fn in list(linked.on_connect):
            try:
                await _maybe_await(fn(client))
            except Exception:  # noqa: BLE001 -- a hook never ends the link
                log.exception("linked: a connect hook failed")
        async for frame in ws:
            if frame.type != WSMsgType.TEXT:
                continue
            if not linked.live(account):
                await ws.close(code=WSCloseCode.POLICY_VIOLATION, message=b"credential revoked")
                break
            msg, problem = _parse(frame.data, client.protocol, client.features)
            if problem:
                await client.send({"id": msg.get("id") if msg and not isinstance(msg.get("id"), bool) else None,
                                   "type": "result", "success": False,
                                   "error": {"code": "bad_request", "message": problem}})
                continue
            task = asyncio.create_task(_answer(linked, client, msg))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
    finally:
        registry.clients.discard(client)
        if entry is not None:
            entry.forget()
        if watcher is not None:
            watcher.cancel()
        for fn in list(linked.on_disconnect):
            try:
                await _maybe_await(fn(client))
            except Exception:  # noqa: BLE001 -- the socket is gone either way
                log.exception("linked: a disconnect hook failed")
        for task in list(tasks):
            task.cancel()
        log.info("linked: %s disconnected", getattr(account, "id", "?"))
    return ws


# -- registration -------------------------------------------------------------------------------------
@dataclass
class LinkedHooks:
    """What the orchestrator passes. handler: ``call_service(service, data, targets, ctx)`` and
    ``entity_command(unique_id, command, data, ctx)`` (async; raise ``LinkedError`` to refuse).
    accounts: ``verify(token, scope, source_ip=)`` and ``live(id)`` (default: the app's
    ``service_accounts``). registry: share one ``LinkedRegistry`` (default: a new one)."""
    handler: Any = None
    accounts: Any = None
    registry: LinkedRegistry | None = None
    timeout: float = HANDLER_TIMEOUT
    recheck: float = RECHECK_S
    heartbeat: float | None = HEARTBEAT_S

    @classmethod
    def coerce(cls, hooks: Any) -> "LinkedHooks":
        if hooks is None:
            return cls()
        if isinstance(hooks, cls):
            return hooks
        if isinstance(hooks, Mapping):
            names = {f.name for f in fields(cls)}
            return cls(**{k: v for k, v in hooks.items() if k in names})
        # the connectors' shared Hooks (or anything else) carries nothing for linked mode
        return cls(handler=getattr(hooks, "linked_handler", None))


def register(app: web.Application, hub: Any = None, hooks: Any = None) -> Linked:
    """Install ``app["linked"]`` and the endpoint at ``PATH`` (public to the session middleware:
    it authenticates the Service credential itself)."""
    h = LinkedHooks.coerce(hooks)
    registry = h.registry or LinkedRegistry()
    accounts = h.accounts or app.get("service_accounts")
    if accounts is None:
        from .service_accounts import ServiceAccounts
        if "store" not in app:
            raise RuntimeError("linked.register needs hooks.accounts or the app's store")
        accounts = app["service_accounts"] = ServiceAccounts(app["store"].db, lambda: app["clock"]())
    linked = Linked(registry, h.handler or MemoryHandler(registry), accounts, h.timeout, h.recheck, h.heartbeat)
    app["linked"] = linked
    app.setdefault("public_paths", set()).add(PATH)
    app.router.add_get(PATH, ws_endpoint)

    async def close_all(_app: web.Application) -> None:
        for client in list(registry.clients):
            await client.ws.close(code=WSCloseCode.GOING_AWAY, message=b"server shutdown")
        registry.clients.clear()

    app.on_shutdown.append(close_all)
    return linked
