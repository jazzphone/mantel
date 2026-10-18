"""NOTIFICATIONS: a banner at the top of the screens when something happens at
home, like an iPhone's -- an accessory picked, what it does that sets it off,
and a camera's snapshot taken that moment.

One per house. Its options hold the notifications (`items`, in their order)
and what All Screens do with them: how long a banner stays, the screensaver,
the chime, Do Not Disturb. Its HK Settings page (Features -> Notifications,
settings_ws.py) is where they are made; the screens' own switches are screen
settings (settings.py: notify, notify_saver, notify_dnd).

THE HOUSE WATCHES, NOT THE BROWSERS. The Watcher follows the chosen
accessories; a change that sets one off (rules.fires), at a time it may (Only
When) and not again too soon (Not Again For, kept per notification), is sent
once to every open screen over the pop-ups' channel (SIGNAL_POPUP ->
hk_frontend/events/subscribe -> the page's hk-house-event), with the snapshot
taken first (snaps.py). Each screen then decides for itself whether to show it
(hk-notify.js): Allow Notifications, Do Not Disturb, its screensaver, asleep,
a pop-up showing for the same thing (the doorbell's).

AN AUTOMATION'S OWN (the action hk_frontend.notify, build_action): its title
and message, sent the same way -- the same channel, snapshot and wake, each
screen deciding the same -- to every screen, or only those showing the
dashboards it lists or signed in as the users it lists.

A TAP OPENS ITS SHEET (hk-notify.js, hk-detail.js `note`): the accessory's
own, the notification at its top with the page it lives on and Mute 1 Hour.
A mute (hk_notify/mute, any user -- muting only makes the house quieter) is
kept here, in memory, by `mute` key -- an item's id and the accessory, so a
category mutes one door, not every door -- and the Watcher and the calendars
send nothing for it until it runs out.

WAKES THE SCREEN (an Important one's): every screen the house's Sleep Screen
decides for, and that allows notifications, is woken for a while
(sleep_engine.Engine.notify_wake) -- from its photos or from dark, quiet hours
too -- and the screen shows the banner once it is up.
"""
from __future__ import annotations

import logging
import re
import time
import uuid
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import SubentryFlowResult
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import Event, HomeAssistant, ServiceCall, ServiceResponse, State, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv, device_registry as dr, entity_registry as er
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event

from ...const import DOMAIN, SIGNAL_POPUP
from .. import ALARM_PIN, NOTIFICATIONS, TITLES, Feature, entries, item_data, loaded, unique_id
from ..alarm_pin.const import CONF_ALARM
from . import rules, settings_ws, snaps as S
from .const import (CONF_CHIME, CONF_DND, CONF_ITEMS, CONF_SAVER, CONF_STAY, CONF_WAKE, DATA, DEFAULTS, MESSAGE_MAX,
                    MUTE_S, PAGE_RE, TAPS, TITLE_MAX, WAKE_MAX_S, WAKE_MIN_S)

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list = []
RELOAD = False          # a change re-follows the accessories (async_changed)
RENAME = {"options": (CONF_ITEMS, CONF_DND)}   # each item's entity, camera, a category's left-out ones, DND's While (rename.py)
REGISTRY_S = 2.0


def _data(hass: HomeAssistant) -> dict[str, Any]:
    d = hass.data.setdefault(DATA, {})
    d.setdefault("snaps", S.Snaps())
    d.setdefault("last", {})          # item id -> when it last went off (monotonic)
    d.setdefault("mute", {})          # mute key -> until (epoch seconds)
    return d


def mute_key(item: dict[str, Any], eid: str | None) -> str | None:
    """What Mute 1 Hour mutes: the notification, and for a category (or a
    calendar's events) the accessory that went off -- None for an
    automation's own (no item)."""
    sid = item.get("id")
    return "%s:%s" % (sid, eid or item.get("entity") or "") if sid else None


def mutes(hass: HomeAssistant, now: float | None = None) -> dict[str, float]:
    """The mutes still running (key -> until), the ones run out forgotten."""
    now = time.time() if now is None else now
    m = _data(hass)["mute"]
    for k in [k for k, v in m.items() if v <= now]:
        del m[k]
    return dict(m)


def muted(hass: HomeAssistant, key: str | None, now: float | None = None) -> bool:
    return bool(key) and key in mutes(hass, now)


def set_mute(hass: HomeAssistant, key: str, seconds: int = MUTE_S, now: float | None = None) -> float | None:
    """Mute `key` for `seconds` (0: unmute). Until when, or None."""
    now = time.time() if now is None else now
    m = _data(hass)["mute"]
    if seconds <= 0:
        m.pop(key, None)
        return None
    m[key] = now + seconds
    return m[key]


def options(entry: Feature) -> dict[str, Any]:
    """The feature's options, every key there (DEFAULTS)."""
    o = dict(entry.options)
    return {**DEFAULTS, **{k: v for k, v in o.items() if k in DEFAULTS}, CONF_ITEMS: list(o.get(CONF_ITEMS) or [])}


# ------------------------------------------------------------ an accessory
def _device_name(hass: HomeAssistant, entity_id: str) -> str | None:
    ent = er.async_get(hass).async_get(entity_id)
    if ent is None or not ent.device_id:
        return None
    dev = dr.async_get(hass).async_get(ent.device_id)
    return (dev.name_by_user or dev.name) if dev else None


def name_of(hass: HomeAssistant, entity_id: str) -> str:
    """The accessory's name for a banner: its friendly name -- or, for a
    detection a device names after itself ("Front Door Camera Person
    detected"), the device ("Front Door Camera")."""
    st = hass.states.get(entity_id)
    full = str(st.name if st is not None else entity_id.split(".", 1)[-1].replace("_", " ").title())
    dev = _device_name(hass, entity_id)
    if dev and full.lower().startswith(dev.lower() + " ") and entity_id.split(".")[0] in ("binary_sensor", "event", "camera"):
        return dev
    return full


def camera_for(hass: HomeAssistant, entity_id: str) -> str | None:
    """The camera on the same device (a camera's own detection sensor), the
    best channel first; None when there is none."""
    reg = er.async_get(hass)
    ent = reg.async_get(entity_id)
    if ent is None or not ent.device_id:
        return None
    cams = sorted((e.entity_id for e in er.async_entries_for_device(reg, ent.device_id)
                   if e.domain == "camera" and not e.disabled_by),
                  key=lambda c: (0 if "high" in c else 2 if "low" in c else 1, c))
    return cams[0] if cams else None


# THE CAMERAS CATEGORY: one row per camera device (its channels are one
# camera: the best is its live view), each with the sensor that sets it off
TRIGGER_KINDS = ("person", "doorbell", "motion", "presence", "vehicle", "animal", "package")


def _usable(e: Any) -> bool:
    return not (e.disabled_by or e.hidden_by or e.entity_category or e.platform == DOMAIN)


def camera_list(hass: HomeAssistant) -> list[str]:
    """Every camera, one per device (its best channel), not HK Frontend's own
    (Live TV's channels)."""
    reg = er.async_get(hass)
    best: dict[str, str] = {}
    lone = []
    for e in reg.entities.values():
        if e.domain != "camera" or not _usable(e):
            continue
        if not e.device_id:
            lone.append(e.entity_id)
            continue
        cur = best.get(e.device_id)
        if cur is None or _rank(e.entity_id) < _rank(cur):
            best[e.device_id] = e.entity_id
    return sorted(set(best.values()) | set(lone))


def _rank(cam: str) -> tuple[int, str]:
    return (0 if "high" in cam else 2 if "low" in cam else 1, cam)


def trigger_for(hass: HomeAssistant, camera: str) -> str | None:
    """The sensor a camera's notification goes off on, suggested: its own
    device's person detection, else its doorbell, motion or presence."""
    reg = er.async_get(hass)
    ent = reg.async_get(camera)
    if ent is None or not ent.device_id:
        return None
    found = []
    for e in er.async_entries_for_device(reg, ent.device_id):
        if e.domain not in ("binary_sensor", "event") or not _usable(e):
            continue
        k = _kind(hass, e.entity_id, e)
        if k in TRIGGER_KINDS and k != "package":
            # (a binary sensor before an event: it has an off as well)
            found.append((TRIGGER_KINDS.index(k), e.domain != "binary_sensor", e.entity_id))
    return min(found)[2] if found else None


def camera_pairs(hass: HomeAssistant, item: dict[str, Any]) -> list[dict[str, Any]]:
    """A Cameras category's cameras: each with its trigger and its live view
    (what was chosen, else suggested), and whether it notifies."""
    chosen = {p.get("camera"): p for p in (item.get("pairs") or []) if isinstance(p, dict)}
    ex = set(item.get("exclude") or [])
    out = []
    for cam in camera_list(hass) + [c for c in chosen if c and c not in camera_list(hass)]:
        p = chosen.get(cam, {})
        trig = p.get("trigger") or trigger_for(hass, cam)
        out.append({"camera": cam, "view": p.get("view") or cam, "trigger": trig, "suggested": trigger_for(hass, cam),
                    "on": cam not in ex and bool(trig)})
    return out


def describe(hass: HomeAssistant, entity_id: str) -> dict[str, Any]:
    """What a notification on this accessory is: its kind, choices, name,
    suggested camera."""
    st = hass.states.get(entity_id)
    domain, oid = entity_id.split(".", 1)
    kind = rules.kind_of(domain, st.attributes.get("device_class") if st else None, oid)
    cam = camera_for(hass, entity_id) if domain != "camera" else entity_id
    name = name_of(hass, entity_id)
    when = rules.default_when(kind)
    title, message = rules.words(kind, when, name, (when, {}), fired_on=when)
    icon, tint = rules.look(kind)
    return {"entity": entity_id, "kind": kind, "name": name, "choices": [list(c) for c in rules.choices(kind)],
            "when": when, "camera": cam, "event": domain == "event", "title": title, "message": message,
            "icon": icon, "tint": tint, "important": kind in rules.IMPORTANT,
            "missing": st is None}


def _kind(hass: HomeAssistant, entity_id: str, reg_entry: Any = None) -> str:
    """An accessory's kind, from its state's device class or (before it has
    a state -- Home Assistant starting) its registry entry's."""
    domain, oid = entity_id.split(".", 1)
    st = hass.states.get(entity_id)
    dc = st.attributes.get("device_class") if st is not None else None
    if dc is None and reg_entry is not None:
        dc = reg_entry.device_class or reg_entry.original_device_class
    return rules.kind_of(domain, dc, oid)


def pin_panels(hass: HomeAssistant) -> dict[str, str]:
    """Alarm PIN's panels, each with the alarm it stands in front of."""
    reg = er.async_get(hass)
    out = {}
    for f in entries(hass, ALARM_PIN):
        panel = reg.async_get_entity_id("alarm_control_panel", DOMAIN, f.entry_id)
        alarm = f.data.get(CONF_ALARM)
        if panel and alarm:
            out[panel] = alarm
    return out


def keypad_for(hass: HomeAssistant, eid: str | None) -> str | None:
    """THE SHEET A TAP OPENS for an alarm with an Alarm PIN panel in front of
    it: the panel's, which asks for the PIN -- not the alarm's own, which
    arms and disarms for anyone (2026-10-13: a tap on the Lyric alarm's
    notification opened its plain Arm / Disarm sheet, not the keypad)."""
    if not eid or not eid.startswith("alarm_control_panel."):
        return eid
    for panel, alarm in pin_panels(hass).items():
        if alarm == eid:
            return panel
    return eid


def candidates(hass: HomeAssistant, key: str) -> list[str]:
    """A category's accessories, found: every entity of its kinds that Home
    Assistant shows (not hidden, disabled or a device's diagnostic), not HK
    Frontend's own -- except an Alarm PIN panel, listed BESIDE the alarm it
    protects (2026-10-13, the user's call: both, the panel saying what it is
    -- settings_ws _named). It mirrors that alarm, so with both ticked only
    one is watched (members); a tap on either opens the keypad (keypad_for)."""
    cat = rules.category(key)
    if cat is None:
        return []
    if key == "cameras":
        return camera_list(hass)
    kinds = cat[2]
    reg = er.async_get(hass)
    pins = pin_panels(hass) if "alarm_panel" in kinds else {}
    out = []
    for e in reg.entities.values():
        if e.disabled_by or e.hidden_by or e.entity_category or (e.platform == DOMAIN and e.entity_id not in pins):
            continue
        if _kind(hass, e.entity_id, e) in kinds:
            out.append(e.entity_id)
    known = set(reg.entities)
    for st in hass.states.async_all():         # a YAML entity with no registry entry
        if st.entity_id not in known and _kind(hass, st.entity_id) in kinds:
            out.append(st.entity_id)
    return sorted(set(out))


def members(hass: HomeAssistant, item: dict[str, Any]) -> list[str]:
    """What a notification watches: its accessory, or its category's less
    those left out."""
    if item.get("category") == "cameras":
        return [p["trigger"] for p in camera_pairs(hass, item) if p["on"]]
    if item.get("category"):
        ex = set(item.get("exclude") or [])
        got = [e for e in candidates(hass, item["category"]) if e not in ex]
        # AN ALARM AND ITS PIN PANEL ARE ONE ALARM: both ticked, the alarm is
        # watched and the panel not -- one notification, opening the keypad
        if any(e.startswith("alarm_control_panel.") for e in got):
            pins = pin_panels(hass)
            got = [e for e in got if not (e in pins and pins[e] in got)]
        return got
    return [item["entity"]] if item.get("entity") else []


def about(hass: HomeAssistant, item: dict[str, Any]) -> dict[str, Any]:
    """describe() for a notification: its accessory's, or its category's."""
    key = item.get("category")
    if not key:
        return describe(hass, item["entity"])
    cat = rules.category(key) or ("", key, ("state",), {})
    kind = cat[2][0]
    when = item.get("when") or cat[3].get("when") or rules.default_when(kind)
    _t, message = rules.words(kind, when, "", (when, {}), fired_on=when)
    title = "Each one’s name"
    if kind == "calendar":
        title, message = "The event’s name", "When it is, and where"
    icon, tint = rules.look(kind)
    return {"category": key, "kind": kind, "name": cat[1], "choices": [list(c) for c in rules.choices(kind)],
            "when": cat[3].get("when") or rules.default_when(kind), "camera": None, "event": False,
            "title": title, "message": message, "icon": icon, "tint": tint,
            "important": bool(cat[3].get("important")), "missing": False}


def _only_ok(hass: HomeAssistant, only: str) -> bool:
    if only in ("home", "away"):
        z = hass.states.get("zone.home")
        try:
            n = int(float(z.state)) if z is not None else None
        except ValueError:
            n = None
        if n is None:
            return True               # not known: not held back
        return n > 0 if only == "home" else n == 0
    if only == "night":
        sun = hass.states.get("sun.sun")
        return sun is None or sun.state == "below_horizon"
    return True


def _initials(name: str) -> str:
    parts = [p for p in name.replace("-", " ").split() if p[:1].isalpha()]
    return "".join(p[0] for p in parts[:2]).upper() or "?"


def build(hass: HomeAssistant, opts: dict[str, Any], item: dict[str, Any], new: State | None,
          test: bool = False, eid: str | None = None) -> dict[str, Any]:
    """What goes to the screens (the snapshot's id is added once taken). A
    category's: `eid` is the accessory that went off -- its name, its
    camera unless the category names one."""
    eid = eid or item.get("entity") or (members(hass, item) or [""])[0]
    d = describe(hass, eid)
    kind = d["kind"]
    view = None
    if item.get("category") == "cameras":
        # its own camera's: the snapshot, the live view, the name
        p = next((x for x in camera_pairs(hass, item) if x["trigger"] == eid), None)
        view = p["view"] if p else None
        if view:
            d = {**d, "name": name_of(hass, p["camera"])}
    st = (new.state, dict(new.attributes)) if new is not None else None
    # (a test reads as if it just went off: its Goes Off When, not the state now)
    fired = (item.get("when") or d["when"]) if test or new is None else new.state
    title, message = rules.words(kind, item.get("when") or d["when"], d["name"], st, fired_on=fired)
    icon, tint = rules.look(kind, st)
    icon = str((new.attributes.get("icon") if new is not None else None) or icon) if kind != "people" else icon
    if not str(icon).startswith(("hk:", "mdi:")):
        icon = rules.look(kind, st)[0]
    camera = (view or item.get("camera") or (camera_for(hass, eid) if item.get("category") else None)) \
        if item.get("snap") else None
    if view and not item.get("snap"):
        camera = None
    stay = item.get("stay")
    stay = int(opts[CONF_STAY] if stay is None else stay)
    important = bool(item.get("important"))
    tap = item.get("tap") or "sheet"
    if tap == "camera" and not camera:
        tap = "sheet"                 # Live Camera with no camera: the accessory's sheet
    if tap == "page" and not item.get("page"):
        tap = "sheet"
    return {
        "type": "notification", "id": uuid.uuid4().hex, "item": item.get("id"), "entity": eid, "kind": kind,
        "title": (item.get("title") or "").strip() or title,
        "message": (item.get("message") or "").strip() or message,
        "icon": icon, "tint": tint,
        "picture": (new.attributes.get("entity_picture") if new is not None and kind == "people" else None),
        "initials": _initials(d["name"]) if kind == "people" else None,
        # Wakes the Screen: its own, else All Notifications' (Do Not Disturb
        # still wins for one that isn't Important: wake_screens, each screen)
        "important": important,
        "wake": item.get("wake") if isinstance(item.get("wake"), bool) else bool(opts.get(CONF_WAKE)),
        "stay": stay, "saver": opts[CONF_SAVER], "chime": bool(opts[CONF_CHIME]), "dnd": opts[CONF_DND],
        "pop": item.get("pop") or None, "camera": camera, "snap": None,
        "tap": tap, "page": item.get("page") if tap == "page" else None,
        # ITS SHEET: the accessory's own -- for what a camera sees, the
        # camera's live (its view, else the snapshot's camera)
        "sheet": (view or (camera_for(hass, eid) if kind in rules.CAMERA_KINDS else None)
                  or (camera if kind in rules.CAMERA_KINDS else None) or keypad_for(hass, eid)),
        # Go To on its sheet: None automatic (the screen works it out), "none", or a page
        "go": item.get("go") or None,
        "mute": mute_key(item, eid), "event": None,
        "buttons": rules.buttons(kind, st, camera), "test": test, "ts": time.time(),
        "dashboards": [], "users": [],
    }


# THE ACTION (hk_frontend.notify): an automation's own banner -- its words,
# to all screens or some (dashboards, users), with a snapshot if it names a
# camera. The same payload as an item's, so each screen decides the same way.
ATTR_TITLE, ATTR_MESSAGE, ATTR_IMPORTANT, ATTR_WAKE, ATTR_STAY = "title", "message", "important", "wake", "stay"
ATTR_ICON, ATTR_ENTITY, ATTR_CAMERA, ATTR_TAP, ATTR_PAGE, ATTR_DASHBOARDS, ATTR_USERS = (
    "icon", "entity", "camera", "tap", "page", "dashboards", "users")
SERVICE_NOTIFY = "notify"
STAY_ACTION_MAX = 3600
ICON = re.compile(r"^(hk|mdi):[a-z0-9-]+$")

NOTIFY_SCHEMA = vol.Schema({
    vol.Required(ATTR_TITLE): vol.All(cv.string, vol.Strip, vol.Length(min=1, max=TITLE_MAX)),
    vol.Optional(ATTR_MESSAGE, default=""): vol.All(cv.string, vol.Strip, vol.Length(max=MESSAGE_MAX)),
    vol.Optional(ATTR_IMPORTANT, default=False): cv.boolean,
    vol.Optional(ATTR_WAKE, default=False): cv.boolean,
    # (none: All Screens' Stays On Screen; 0: until dismissed)
    vol.Optional(ATTR_STAY): vol.All(vol.Coerce(int), vol.Range(min=0, max=STAY_ACTION_MAX)),
    vol.Optional(ATTR_ICON): vol.All(cv.string, vol.Match(ICON)),
    vol.Optional(ATTR_ENTITY): cv.entity_id,
    vol.Optional(ATTR_CAMERA): cv.entity_domain("camera"),
    vol.Optional(ATTR_TAP): vol.In(TAPS),
    # tap: page -- a view's path on the screen's own dashboard ("kitchen")
    vol.Optional(ATTR_PAGE): vol.All(cv.string, vol.Strip, vol.Lower, vol.Match(PAGE_RE)),
    vol.Optional(ATTR_DASHBOARDS, default=list): vol.All(cv.ensure_list, [cv.string]),
    vol.Optional(ATTR_USERS, default=list): vol.All(cv.ensure_list, [cv.string]),
})


def build_action(hass: HomeAssistant, opts: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    """What goes to the screens for the action: an item's payload, its words
    the automation's. Wakes the Screen as an item's: Do Not Disturb holds it
    back unless it is Important. An accessory named: its icon, its sheet, its
    buttons. Tap Opens, unless given: the camera, else the accessory's sheet,
    else nothing."""
    eid = data.get(ATTR_ENTITY)
    st = hass.states.get(eid) if eid else None
    s = (st.state, dict(st.attributes)) if st is not None else None
    kind = _kind(hass, eid) if eid else "event"
    icon, tint = rules.look(kind, s)
    camera = data.get(ATTR_CAMERA)
    page = data.get(ATTR_PAGE)
    tap = data.get(ATTR_TAP) or ("page" if page else "camera" if camera else "sheet" if eid else "none")
    if tap == "page" and not page:
        tap = "camera" if camera else "sheet" if eid else "none"
    if tap == "camera" and not camera:
        tap = "sheet" if eid else "none"
    if tap == "sheet" and not eid:
        tap = "none"
    wake = bool(data.get(ATTR_WAKE))
    important = bool(data.get(ATTR_IMPORTANT))
    stay = data.get(ATTR_STAY)
    return {
        "type": "notification", "id": uuid.uuid4().hex, "item": None, "entity": eid, "kind": kind,
        "title": data[ATTR_TITLE], "message": data.get(ATTR_MESSAGE) or "",
        "icon": data.get(ATTR_ICON) or icon, "tint": tint,
        "picture": st.attributes.get("entity_picture") if st is not None and kind == "people" else None,
        "initials": _initials(name_of(hass, eid)) if eid and kind == "people" else None,
        "important": important, "wake": wake,
        "stay": int(opts[CONF_STAY] if stay is None else stay),
        "saver": opts[CONF_SAVER], "chime": bool(opts[CONF_CHIME]), "dnd": opts[CONF_DND],
        "pop": None, "camera": camera, "snap": None, "tap": tap, "sheet": keypad_for(hass, eid),
        # a page named: its Go To too; an automation's own has no Mute
        "page": page if tap == "page" else None, "go": page or None, "mute": None, "event": None,
        "buttons": rules.buttons(kind, s, camera) if eid else rules.buttons("event", None, camera),
        "test": False, "ts": time.time(),
        # (a dashboard as its url path: the screen compares its first segment)
        "dashboards": [p for p in (str(d).strip().strip("/").split("/")[0] for d in data.get(ATTR_DASHBOARDS) or []) if p],
        "users": [str(u).strip() for u in data.get(ATTR_USERS) or [] if str(u).strip()],
    }


def _wake_for(stay: int) -> int:
    return WAKE_MAX_S if stay <= 0 else max(WAKE_MIN_S, min(WAKE_MAX_S, stay))


def dnd_on(hass: HomeAssistant, dnd: dict[str, Any] | None, now: Any = None) -> bool:
    """Do Not Disturb on now (hk-notify.js dndOn, the same rule): in its
    hours when scheduled (they may run past midnight; from == to is all
    day), or while an entity listed is on (a timer while it runs)."""
    if not dnd:
        return False
    from homeassistant.util import dt as dt_util
    if dnd.get("schedule"):
        local = dt_util.as_local(now or dt_util.utcnow())
        n = local.hour * 60 + local.minute
        try:
            a, b = (int(str(x).split(":")[0]) * 60 + int(str(x).split(":")[1]) for x in (dnd.get("from"), dnd.get("to")))
        except (ValueError, IndexError):
            a = b = None
        if a is not None and b is not None and (a == b or (a <= n < b if a < b else (n >= a or n < b))):
            return True
    for eid in dnd.get("while") or []:
        st = hass.states.get(eid)
        if st is not None and st.state in ("on", "active", "home", "open", "playing"):
            return True
    return False


@callback
def wake_screens(hass: HomeAssistant, title: str, seconds: int, important: bool = True,
                 dnd: dict[str, Any] | None = None) -> list[str]:
    """Every screen the Sleep Screen decides for, that allows notifications
    and -- unless it is Important -- isn't in Do Not Disturb (its own, else
    All Screens' `dnd`), woken for `seconds`: up to its screensaver, the
    banner over the photos. The paths woken."""
    from ...screensaver import manager
    mgr = manager(hass)
    if mgr is None:
        return []
    out = []
    for path, eng in list(mgr.engines.items()):
        b = mgr.board(path)
        if b.get("notify", True) is False or not eng.acting:
            continue
        if not important and dnd_on(hass, b.get("notify_dnd") or dnd):
            continue
        eng.notify_wake(title, seconds)
        out.append(path)
    return out


async def async_send(hass: HomeAssistant, entry: Feature, item: dict[str, Any], new: State | None,
                     test: bool = False, eid: str | None = None) -> dict[str, Any]:
    """One notification out: the snapshot taken, sent to the screens, the
    screens woken when it says so. What was sent."""
    return await async_deliver(hass, build(hass, options(entry), item, new, test=test, eid=eid))


async def async_deliver(hass: HomeAssistant, payload: dict[str, Any]) -> dict[str, Any]:
    """A notification built (build, or the action's build_action) sent out
    the one way: the snapshot first, the pop-ups' channel, the screens woken."""
    if payload["camera"]:
        payload["snap"] = await S.async_take(hass, _data(hass)["snaps"], payload["camera"])
    async_dispatcher_send(hass, SIGNAL_POPUP, payload)
    if payload["wake"]:
        wake_screens(hass, payload["title"], _wake_for(payload["stay"]), bool(payload.get("important")), payload.get("dnd"))
    return payload


# CALENDARS: an event coming up. The house asks each chosen calendar every
# minute (calendar.get_events -- Home Assistant's own, every calendar
# integration answers it) for the events starting within the lead time, and
# sends each one once, when "start - lead" has just passed. All-day events
# are left out ("15 minutes before" one would be midnight).
CAL_TICK_S = 60


def _event_time(v: Any) -> Any:
    """A timed event's start or end as a local datetime; None for an all-day
    one (a date) or one that cannot be read."""
    from homeassistant.util import dt as dt_util
    if not isinstance(v, str) or "T" not in v and " " not in v:
        return None
    t = dt_util.parse_datetime(v)
    return dt_util.as_local(t) if t is not None else None


def build_calendar(hass: HomeAssistant, opts: dict[str, Any], item: dict[str, Any], cal: str,
                   event: dict[str, Any], lead: int, test: bool = False) -> dict[str, Any]:
    """An event's notification: the event's name, when it is and where (the
    calendar's typed Title/Message over them)."""
    p = build(hass, opts, item, None, test=test, eid=cal)
    start, end = _event_time(event.get("start")), _event_time(event.get("end"))
    title, message = (rules.calendar_words(str(event.get("summary") or ""), start, end, lead, str(event.get("location") or ""))
                      if start is not None else (str(event.get("summary") or "Event"), ""))
    icon, tint = rules.look("calendar")
    p.update({"kind": "calendar", "icon": icon, "tint": tint, "buttons": [], "camera": p["camera"] if item.get("snap") else None,
              "title": (item.get("title") or "").strip() or title, "message": (item.get("message") or "").strip() or message,
              # THE EVENT, so a tap opens it (HK's event sheet; the screen
              # finds it in the calendar by its start and name)
              "event": {"cal": cal, "summary": str(event.get("summary") or ""), "start": event.get("start"),
                        "end": event.get("end"), "location": str(event.get("location") or ""),
                        "description": str(event.get("description") or ""), "uid": event.get("uid")}})
    if p["tap"] == "camera" and not p["camera"]:
        p["tap"] = "none"
    return p


def build_allday(hass: HomeAssistant, opts: dict[str, Any], item: dict[str, Any], cal: str,
                 event: dict[str, Any], test: bool = False) -> dict[str, Any]:
    """An all-day event's notification, the morning it starts: its name,
    "Today · All Day · the place"."""
    p = build_calendar(hass, opts, item, cal, {**event, "start": None, "end": None}, 0, test=test)
    title, message = rules.allday_words(str(event.get("summary") or ""), str(event.get("location") or ""))
    p.update({"title": (item.get("title") or "").strip() or title,
              "message": (item.get("message") or "").strip() or message})
    p["event"].update({"start": event.get("start"), "end": event.get("end")})
    return p


async def async_events(hass: HomeAssistant, cals: list[str], start: Any, end: Any) -> dict[str, list[dict[str, Any]]]:
    """The calendars' events between `start` and `end` (calendar.get_events);
    a calendar that answers nothing has none."""
    if not cals or not hass.services.has_service("calendar", "get_events"):
        return {}
    try:
        r = await hass.services.async_call("calendar", "get_events", {
            "entity_id": cals, "start_date_time": start.isoformat(), "end_date_time": end.isoformat()},
            blocking=True, return_response=True)
    except Exception as err:  # noqa: BLE001 -- a calendar that can't be read: no notification
        _LOGGER.debug("notifications: calendar events: %s", err)
        return {}
    return {k: list((v or {}).get("events") or []) for k, v in (r or {}).items()}


class CalendarWatch:
    """The calendars' look-ahead: once a minute, the events whose
    "start - lead" fell since the last look -- each sent once."""

    def __init__(self, hass: HomeAssistant, entry: Feature) -> None:
        self.hass, self.entry = hass, entry
        self._unsub: Any = None
        self._last: Any = None
        self._sent: dict[str, float] = {}

    def start(self, on: bool) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        if not on:
            return
        from datetime import timedelta
        from homeassistant.helpers.event import async_track_time_interval
        self._unsub = async_track_time_interval(self.hass, self._tick, timedelta(seconds=CAL_TICK_S))

    def stop(self) -> None:
        self.start(False)

    async def _tick(self, now: Any = None) -> list[dict[str, Any]]:
        """Look: what came due since the last look (the first: the last
        minute). What was sent."""
        from datetime import timedelta
        from homeassistant.util import dt as dt_util
        now = now or dt_util.utcnow()
        last = self._last if self._last is not None else now - timedelta(seconds=CAL_TICK_S)
        self._last = now
        out = []
        for item in options(self.entry)[CONF_ITEMS]:
            if item.get("category") != "calendars":
                continue
            cals = members(self.hass, item)
            try:
                lead = max(0, int(item.get("when") or 15))
            except ValueError:
                lead = 15
            got = await async_events(self.hass, cals, last + timedelta(minutes=lead) - timedelta(seconds=1),
                                     now + timedelta(minutes=lead) + timedelta(seconds=1))
            for cal, events in got.items():
                for ev in events:
                    start = _event_time(ev.get("start"))
                    if start is None:
                        continue                      # all day
                    due = start - timedelta(minutes=lead)
                    if not (last < due <= now):
                        continue
                    key = "%s|%s|%s|%s" % (item.get("id"), cal, ev.get("summary"), ev.get("start"))
                    if key in self._sent:
                        continue
                    self._sent[key] = start.timestamp()
                    if not _only_ok(self.hass, item.get("only") or "always") or muted(self.hass, mute_key(item, cal)):
                        continue
                    p = build_calendar(self.hass, options(self.entry), item, cal, ev, lead)
                    out.append(await async_deliver(self.hass, p))
            # ALL-DAY EVENTS: the morning they start, once the chosen time has
            # just passed -- each of today's
            at = item.get("allday")
            if at in rules.ALLDAY_TIMES:
                local = dt_util.as_local(now)
                hh, mm = (int(x) for x in at.split(":"))
                due = local.replace(hour=hh, minute=mm, second=0, microsecond=0)
                if dt_util.as_local(last) < due <= local:
                    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
                    got = await async_events(self.hass, cals, day, day + timedelta(days=1) - timedelta(seconds=1))
                    for cal, events in got.items():
                        for ev in events:
                            st = ev.get("start")
                            if not isinstance(st, str) or "T" in st or st[:10] != day.date().isoformat():
                                continue                      # timed, or begun on an earlier day
                            key = "%s|%s|%s|%s|day" % (item.get("id"), cal, ev.get("summary"), st)
                            if key in self._sent:
                                continue
                            self._sent[key] = due.timestamp()
                            if not _only_ok(self.hass, item.get("only") or "always") or muted(self.hass, mute_key(item, cal)):
                                continue
                            out.append(await async_deliver(self.hass, build_allday(self.hass, options(self.entry), item, cal, ev)))
        # forget what is long past
        cut = (now - timedelta(days=1)).timestamp()
        self._sent = {k: v for k, v in self._sent.items() if v > cut}
        return out


class Watcher:
    """Follows the chosen accessories; sends a notification when one goes off."""

    def __init__(self, hass: HomeAssistant, entry: Feature) -> None:
        self.hass, self.entry = hass, entry
        self._unsub: Any = None
        self._members: dict[str, set[str]] = {}
        self._listen: list[Any] = []
        # A CATEGORY FOLLOWS THE HOUSE: an accessory added, removed, hidden or
        # renamed is found again (registry changes come in bursts: once after)
        self._later = Debouncer(hass, _LOGGER, cooldown=REGISTRY_S, immediate=False, function=self._refresh)
        self.calendars = CalendarWatch(hass, entry)

    async def _refresh(self) -> None:
        self.start()

    def listen(self) -> None:
        """The registry, and Home Assistant's start (an integration's entities
        may come after this feature): the categories found again."""
        @callback
        def registry(event: Event) -> None:
            if any(i.get("category") for i in options(self.entry)[CONF_ITEMS]):
                self._later.async_schedule_call()
        self._listen.append(self.hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, registry))
        if not self.hass.is_running:
            # A @callback, so it runs in the event loop: a bare lambda is an
            # executor job, and start() would register its trackers from a
            # worker thread. Once it has fired, its remover is spent -- calling
            # it at stop() logs "Unable to remove unknown job listener".
            @callback
            def started(_event: Event) -> None:
                if unsub in self._listen:
                    self._listen.remove(unsub)
                self.start()
            unsub = self.hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, started)
            self._listen.append(unsub)

    def start(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        items = options(self.entry)[CONF_ITEMS]
        # (a calendar is looked at by the clock, not followed by its state)
        self.calendars.start(any(i.get("category") == "calendars" for i in items))
        self._members = {str(i.get("id")): set(members(self.hass, i)) for i in items if i.get("category") != "calendars"}
        ids = sorted(set().union(*self._members.values())) if self._members else []
        if ids:
            self._unsub = async_track_state_change_event(self.hass, ids, self._changed)

    def stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        for u in self._listen:
            u()
        self._listen = []
        self._later.async_cancel()
        self.calendars.stop()

    @callback
    def _changed(self, event: Event) -> None:
        eid = event.data.get("entity_id")
        old: State | None = event.data.get("old_state")
        new: State | None = event.data.get("new_state")
        o = (old.state, dict(old.attributes)) if old is not None else None
        n = (new.state, dict(new.attributes)) if new is not None else None
        last = _data(self.hass)["last"]
        now = time.monotonic()
        for item in options(self.entry)[CONF_ITEMS]:
            if eid not in self._members.get(str(item.get("id")), ()):
                continue
            kind = _kind(self.hass, eid)
            when = item.get("when") or rules.default_when(kind)
            if not rules.fires(kind, when, o, n, event=eid.startswith("event.")):
                continue
            if not _only_ok(self.hass, item.get("only") or "always"):
                continue
            # Mute 1 Hour: that accessory of that notification, quiet
            if muted(self.hass, mute_key(item, eid)):
                continue
            # Not Again For: per accessory (a category's doors each their own)
            key = "%s:%s" % (item.get("id"), eid)
            cool = int(item.get("cooldown") or 0)
            if cool and now - last.get(key, -1e9) < cool:
                continue
            last[key] = now
            self.hass.async_create_task(async_send(self.hass, self.entry, item, new, eid=eid),
                                        "hk_frontend notification")


async def async_setup(hass: HomeAssistant) -> None:
    S.async_register(hass, _data(hass)["snaps"])
    settings_ws.async_register(hass)

    async def notify(call: ServiceCall) -> ServiceResponse:
        entry = running(hass)
        if entry is None:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="notifications_not_set_up")
        sent = await async_deliver(hass, build_action(hass, options(entry), dict(call.data)))
        return {"id": sent["id"], "snap": bool(sent["snap"])}

    hass.services.async_register(DOMAIN, SERVICE_NOTIFY, notify, NOTIFY_SCHEMA,
                                 supports_response=SupportsResponse.OPTIONAL)


# TAP OPENS, ITS MEANING MOVED (2026-10-12). It was what a tap on an opened
# banner's snapshot did; a tap now opens the accessory's sheet with the
# notification on it, and Tap Opens is what the banner itself opens. So a
# notification saved before keeps its sheet: "Nothing" (the picture did
# nothing) and "Live Camera" on an accessory that isn't what a camera sees
# (a garage door with its snapshot) become Its Sheet. Once: TAPS_V marks it.
TAPS_V = "taps_v"


def migrate_taps(opts: dict[str, Any]) -> dict[str, Any] | None:
    """The options with old Tap Opens moved over, or None when there is
    nothing to do. A new Notifications starts marked (AddSteps)."""
    if opts.get(TAPS_V):
        return None
    cams = ("cameras", "packages", "doorbells")
    items = []
    for it in opts.get(CONF_ITEMS) or []:
        it = dict(it)
        if it.get("tap") == "none" or (it.get("tap") == "camera" and it.get("category") not in cams):
            it["tap"] = "sheet"
        items.append(it)
    return {**opts, CONF_ITEMS: items, TAPS_V: 2}


# WAKES THE SCREEN, ITS OWN OR ALL NOTIFICATIONS' (1.7.1). 1.7.0 saved
# `wake: False` on every notification it made, and any stored True or False
# is that notification's own choice -- so none of them followed All
# Notifications' Wakes the Screen. A stored False becomes "Same as All
# Notifications" (the key removed, as a new one has None); a True was chosen
# and stays. Once: WAKE_V marks it.
WAKE_V = "wake_v"


def migrate_wake(opts: dict[str, Any]) -> dict[str, Any] | None:
    """The options with 1.7.0's `wake: False` following All Notifications,
    or None when there is nothing to do. A new Notifications starts marked
    (AddSteps)."""
    if opts.get(WAKE_V):
        return None
    items = []
    for it in opts.get(CONF_ITEMS) or []:
        it = dict(it)
        if it.get("wake") is False:
            it.pop("wake")
        items.append(it)
    return {**opts, CONF_ITEMS: items, WAKE_V: 1}


async def async_setup_entry(hass: HomeAssistant, entry: Feature) -> bool:
    opts = dict(entry.options)
    moved = None
    for migrate in (migrate_taps, migrate_wake):
        done = migrate(opts)
        if done is not None:
            opts = moved = done
    if moved is not None:
        from .. import async_update
        async_update(hass, entry, options=moved)
    w = Watcher(hass, entry)
    entry.runtime_data = w
    w.start()
    w.listen()
    entry.async_on_unload(w.stop)
    return True


async def async_changed(hass: HomeAssistant, entry: Feature) -> None:
    w = entry.runtime_data
    if isinstance(w, Watcher):
        w.start()


async def async_unload_entry(hass: HomeAssistant, entry: Feature) -> bool:
    w = entry.runtime_data
    if isinstance(w, Watcher):
        w.stop()
    return True


def running(hass: HomeAssistant) -> Feature | None:
    return next(iter(loaded(hass, NOTIFICATIONS)), None)


_SCHEMA = vol.Schema({})


class AddSteps:
    """Add feature -> Notifications: nothing to ask. The notifications are
    made on its HK Settings page."""

    async def async_step_notifications(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        if entries(self.hass, NOTIFICATIONS):
            return self.async_abort(reason="already_configured")
        if user_input is not None:
            return self.async_create_entry(
                title=TITLES[NOTIFICATIONS], unique_id=unique_id(NOTIFICATIONS),
                data=item_data(NOTIFICATIONS, options={**DEFAULTS, CONF_ITEMS: [], TAPS_V: 2, WAKE_V: 1}))
        return self.async_show_form(step_id="notifications", data_schema=_SCHEMA,
                                    description_placeholders={"url": "/hk-settings#/features/notify"})


class ReconfigureSteps:
    """Its gear: everything is on its HK Settings page (the form says where)."""

    async def async_step_notifications_options(self, user_input: dict[str, Any] | None = None
                                               ) -> SubentryFlowResult:
        if user_input is not None:
            return self.async_save_feature(options=dict(self._feature.options))
        return self.async_show_form(step_id="notifications_options", data_schema=_SCHEMA,
                                    description_placeholders={"url": "/hk-settings#/features/notify"})
