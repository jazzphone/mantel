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

THE RULES ARE SHARED (hk_core/notifications/, PLAN.md §0 plan review): what an
accessory is, what sets a notification off, Only When, Mute 1 Hour, Not Again
For, Do Not Disturb, the payload, the calendars' look-ahead, the migrations and
the settings page's checks are written once there and asked of HA's house
through house.py's HaHouse. What stays here is Home Assistant's side: following
the states and the registry, the calendars' clock and events, the snapshot, the
pop-ups' channel, waking the screens, the stored options, the action and its
schema. The names below are kept (thin wrappers taking `hass`), so callers and
tests are unchanged.
"""
from __future__ import annotations

import logging
import re
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import SubentryFlowResult
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import Event, HomeAssistant, ServiceCall, ServiceResponse, State, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event

from ...const import DOMAIN, SIGNAL_POPUP
from ...hk_core.notifications import accessories as A, banner as B, calendars as C, dnd as D
from ...hk_core.notifications.accessories import TRIGGER_KINDS  # noqa: F401
from ...hk_core.notifications.banner import (  # noqa: F401 -- the action's fields, and names callers import here
    ATTR_CAMERA, ATTR_DASHBOARDS, ATTR_ENTITY, ATTR_ICON, ATTR_IMPORTANT, ATTR_MESSAGE, ATTR_PAGE, ATTR_STAY, ATTR_TAP,
    ATTR_TITLE, ATTR_USERS, ATTR_WAKE, mute_key)
from ...hk_core.notifications.migrate import TAPS_V, WAKE_V, migrate, migrate_taps, migrate_wake  # noqa: F401
from ...house import HaHouse, state_view
from .. import ALARM_PIN, NOTIFICATIONS, TITLES, Feature, entries, item_data, loaded, unique_id
from ..alarm_pin.const import CONF_ALARM
from . import rules, settings_ws, snaps as S  # noqa: F401 -- (rules: the feature's names, kept)
from .const import CAL_TICK_S, CONF_DND, CONF_ITEMS, DATA, DEFAULTS, MESSAGE_MAX, MUTE_S, PAGE_RE, TAPS, TITLE_MAX

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


def _pins(hass: HomeAssistant) -> A.Pins:
    """Alarm PIN's panels, asked only when the shared rules need them."""
    return lambda: pin_panels(hass)


def mutes(hass: HomeAssistant, now: float | None = None) -> dict[str, float]:
    """The mutes still running (key -> until), the ones run out forgotten."""
    return B.mutes(_data(hass)["mute"], now)


def muted(hass: HomeAssistant, key: str | None, now: float | None = None) -> bool:
    return B.muted(_data(hass)["mute"], key, now)


def set_mute(hass: HomeAssistant, key: str, seconds: int = MUTE_S, now: float | None = None) -> float | None:
    """Mute `key` for `seconds` (0: unmute). Until when, or None."""
    return B.set_mute(_data(hass)["mute"], key, seconds, now)


def options(entry: Feature) -> dict[str, Any]:
    """The feature's options, every key there (DEFAULTS)."""
    return B.options(entry.options)


# ------------------------------------------------------------ an accessory
def name_of(hass: HomeAssistant, entity_id: str) -> str:
    return A.name_of(HaHouse(hass), entity_id)


def camera_for(hass: HomeAssistant, entity_id: str) -> str | None:
    return A.camera_for(HaHouse(hass), entity_id)


def camera_list(hass: HomeAssistant) -> list[str]:
    return A.camera_list(HaHouse(hass))


def trigger_for(hass: HomeAssistant, camera: str) -> str | None:
    return A.trigger_for(HaHouse(hass), camera)


def camera_pairs(hass: HomeAssistant, item: dict[str, Any]) -> list[dict[str, Any]]:
    return A.camera_pairs(HaHouse(hass), item)


def describe(hass: HomeAssistant, entity_id: str) -> dict[str, Any]:
    return A.describe(HaHouse(hass), entity_id)


def _kind(hass: HomeAssistant, entity_id: str) -> str:
    return A.kind(HaHouse(hass), entity_id)


def pin_panels(hass: HomeAssistant) -> dict[str, str]:
    """Alarm PIN's panels, each with the alarm it stands in front of (HK's own
    settings: the Alarm PIN features and the panels they made)."""
    reg = er.async_get(hass)
    out = {}
    for f in entries(hass, ALARM_PIN):
        panel = reg.async_get_entity_id("alarm_control_panel", DOMAIN, f.entry_id)
        alarm = f.data.get(CONF_ALARM)
        if panel and alarm:
            out[panel] = alarm
    return out


def keypad_for(hass: HomeAssistant, eid: str | None) -> str | None:
    return A.keypad_for(eid, _pins(hass))


def candidates(hass: HomeAssistant, key: str) -> list[str]:
    return A.candidates(HaHouse(hass), key, _pins(hass))


def members(hass: HomeAssistant, item: dict[str, Any]) -> list[str]:
    return A.members(HaHouse(hass), item, _pins(hass))


def about(hass: HomeAssistant, item: dict[str, Any]) -> dict[str, Any]:
    return A.about(HaHouse(hass), item)


def _only_ok(hass: HomeAssistant, only: str) -> bool:
    return B.only_ok(HaHouse(hass), only)


def build(hass: HomeAssistant, opts: dict[str, Any], item: dict[str, Any], new: State | None,
          test: bool = False, eid: str | None = None) -> dict[str, Any]:
    """What goes to the screens (hk_core banner.build)."""
    return B.build(HaHouse(hass), opts, item, state_view(new), test=test, eid=eid, pins=_pins(hass))


# THE ACTION (hk_frontend.notify): an automation's own banner -- its words,
# to all screens or some (dashboards, users), with a snapshot if it names a
# camera. The same payload as an item's (hk_core banner.build_action); its
# schema is HA's.
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
    """What goes to the screens for the action (hk_core banner.build_action)."""
    return B.build_action(HaHouse(hass), opts, data, pins=_pins(hass))


def _wake_for(stay: int) -> int:
    return B.wake_for(stay)


def _initials(name: str) -> str:
    return B.initials(name)


def dnd_on(hass: HomeAssistant, dnd: dict[str, Any] | None, now: Any = None) -> bool:
    """Do Not Disturb on now (hk_core dnd.dnd_on; hk-notify.js dndOn, the same rule)."""
    return D.dnd_on(HaHouse(hass), dnd, now)


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


# CALENDARS: an event coming up (hk_core calendars.py decides what is due).
# HA's side: the clock, once a minute, and the events -- calendar.get_events,
# Home Assistant's own, which every calendar integration answers.
def build_calendar(hass: HomeAssistant, opts: dict[str, Any], item: dict[str, Any], cal: str,
                   event: dict[str, Any], lead: int, test: bool = False) -> dict[str, Any]:
    return C.build_calendar(HaHouse(hass), opts, item, cal, event, lead, test=test, pins=_pins(hass))


def build_allday(hass: HomeAssistant, opts: dict[str, Any], item: dict[str, Any], cal: str,
                 event: dict[str, Any], test: bool = False) -> dict[str, Any]:
    return C.build_allday(HaHouse(hass), opts, item, cal, event, test=test, pins=_pins(hass))


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
        from homeassistant.util import dt as dt_util
        now = now or dt_util.utcnow()
        last, self._last = self._last, now
        hass = self.hass
        return await C.look_ahead(
            HaHouse(hass), last, now, self._sent, opts=lambda: options(self.entry),
            events=lambda cals, start, end: async_events(hass, cals, start, end),
            deliver=lambda p: async_deliver(hass, p), mute=_data(hass)["mute"], pins=_pins(hass))


class Watcher:
    """Follows the chosen accessories; sends a notification when one goes off
    (hk_core banner.goes_off decides)."""

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
        new: State | None = event.data.get("new_state")
        d = _data(self.hass)
        for item in B.goes_off(HaHouse(self.hass), options(self.entry)[CONF_ITEMS], self._members, eid,
                               state_view(event.data.get("old_state")), state_view(new),
                               last=d["last"], mute=d["mute"]):
            self.hass.async_create_task(async_send(self.hass, self.entry, item, new, eid=eid),
                                        "hk_frontend notification")


async def async_setup(hass: HomeAssistant) -> None:
    S.async_register(hass, _data(hass)["snaps"])
    settings_ws.async_register(hass)

    async def notify(call: ServiceCall) -> ServiceResponse:
        # LINKED TO MANTEL SERVER (linked_mode.py): the whole entry Mantel's,
        # the banner is Mantel's to show; some tablets Mantel's, here as
        # always and there too (its screens are Mantel's)
        from ... import linked_mode
        linked = linked_mode.active(hass)
        entry = running(hass)
        if linked is not None and (linked.full or (entry is None and linked.tablets)):
            got = await linked.forward("notify", dict(call.data))
            got = got if isinstance(got, dict) else {}
            return {"id": got.get("id"), "snap": bool(got.get("snap"))}
        if entry is None:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="notifications_not_set_up")
        sent = await async_deliver(hass, build_action(hass, options(entry), dict(call.data)))
        if linked is not None:
            await linked.also("notify", dict(call.data))
        return {"id": sent["id"], "snap": bool(sent["snap"])}

    hass.services.async_register(DOMAIN, SERVICE_NOTIFY, notify, NOTIFY_SCHEMA,
                                 supports_response=SupportsResponse.OPTIONAL)


async def async_setup_entry(hass: HomeAssistant, entry: Feature) -> bool:
    # stored options moved forward (hk_core migrate.py: Tap Opens, Wakes the Screen)
    moved = migrate(dict(entry.options))
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
