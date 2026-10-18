"""THE PHOTO SCREENSAVER'S ENTITIES (HK Frontend 1.3): for every screen whose
photo screensaver is HK Frontend's own (hk-saver.js), two entities of this
integration, tied to that screen's item:

    switch.<screen>_photo_screensaver    on while the photos show. Two-way:
        the screensaver turns it on when it starts and off when someone taps
        it; turning it on starts the screensaver at once, off closes it (the
        doorbell). Restored across restarts. Nobody creates a helper.
    binary_sensor.<screen>_screen_in_use  on while the screen was touched
        within its window -- Starts After less a minute -- so the photos can
        only come up once the screen has stopped counting as in use. Only a
        person can touch the page: no command to the tablet's browser (a
        brightness write, starting its screensaver) can fake it.

    switch.<screen>_black_screen  (2026-10-09) on while the screen is black:
        HK Frontend's own black over the page and the backlight at its
        lowest, for a screen whose Black Screen is HK Frontend (in place of
        Kiosk Satellite's Black screensaver). Turned on and off by the
        house's sleep and wake (hk_frontend.set_black_screen also carries the
        brightness to come back to); the page confirms it went black
        (`confirmed`), and turns it off itself when a tap wakes it.

Attributes on all: starts_after, in_use_window, last_touch (the screen's
last touch, reported by hk-saver.js at most every 10 s while touched).

A TOUCH ON THE SCREENSAVER'S OWN CONTROLS (2026-10-11) is reported apart
(`saver: true`): the music's buttons, its volume, its Speakers / Volume /
Browse panel, a photo stepped at an edge. Those leave the photos up, so they
are not somebody at the dashboard: Sleep Screen reads them as the screensaver
in use and keeps the photos (sleep_engine.py, saver_use) -- the kiosk's own
last tap would otherwise read as "somebody is at the tablet" and wake the
dashboard out from under the person using them.

THE OLD HELPER, MIRRORED. A house that followed the 1.2 docs has
input_boolean.wallpanel_screensaver_<room> (its Tablet Room) and automations
on it. While that helper exists the switch mirrors it both ways, so nothing
breaks and the house can move to the switch in its own time; once it is
deleted the mirror is simply idle.

The rules are shared (hk_core/screensaver/: the board each tablet reads, the
in-use window, who may speak for a tablet, the black screen's meaning, when a
tablet gets a Sleep Screen engine) and re-exported here under their names;
the entities, devices, registry, websocket commands, timers and the engines
(sleep_engine.py) are Home Assistant's.
"""
from __future__ import annotations

from datetime import datetime, timedelta
import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.util import dt as dt_util

from . import settings as S
from .const import DOMAIN, SIGNAL_CONFIG
from .hk_core.screensaver import rules as R
from .hk_core.screensaver.rules import (  # noqa: F401 -- shared
    BLACK_KEY, INUSE_KEY, MARGIN, MIN_WINDOW, SWITCH_KEY, as_board, window_of,
)

_LOGGER = logging.getLogger(__name__)
DATA = "saver"                 # hass.data[DOMAIN][DATA]: the manager


def wanted(entry: ConfigEntry) -> dict[str, dict[str, Any]]:
    """The tablets, each with what its entities and Sleep Screen read (1.14:
    a tablet's own, no longer a screen's). `{tablet id: {"sub": its item,
    "tablet": tablet(), "board": as_board()}}`."""
    tabs = S.tablets(entry)
    screens = {s.unique_id: s for s in entry.subentries.values()
               if s.subentry_type == S.SUBENTRY_DASHBOARD and s.unique_id}
    items = {sub.unique_id: sub for sub in entry.subentries.values() if sub.subentry_type == S.SUBENTRY_TABLET}

    def screen_board(path: str) -> dict[str, Any]:
        scr = screens.get(path)
        return S.resolved(S.board(scr.data if scr else None), entry.options)
    return R.wanted(items, tabs, screen_board)


class Manager:
    """Adds and removes each tablet's entities as tablets change, and holds
    each tablet's last touch. Everything here is keyed by tablet id (1.14;
    by the screen's path before)."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass, self.entry = hass, entry
        self.adders: dict[str, Any] = {}              # platform -> async_add_entities
        # tablet -> {"switch": photos, "black": black screen, "binary_sensor": in use, "sleep": Sleep Screen}
        self.entities: dict[str, dict[str, Any]] = {}
        self.touch: dict[str, datetime] = {}
        # tablet -> the last touch on the screensaver's own controls (ws_touch
        # saver: true) -- not a touch of the page, never "in use"
        self.saver_touch: dict[str, datetime] = {}
        # Sleep Screen: tablet -> its engine (sleep_engine.py), while it
        # is Decided By HK Frontend or in shadow; and what it was built from
        self.engines: dict[str, Any] = {}
        self._engine_keys: dict[str, str] = {}
        # tablet id -> the base of its entities' unique ids (its device's too)
        self._uids: dict[str, str] = {}

    def attach(self, platform: str, add: Any) -> None:
        self.adders[platform] = add
        self.sync()

    @callback
    def sync(self) -> None:
        """Make the entities match the tablets: a new tablet gets its own, a
        tablet removed loses them."""
        want = wanted(self.entry)
        reg = er.async_get(self.hass)
        devs = dr.async_get(self.hass)
        # LINKED (linked_mode.py): a tablet Mantel Server owns has no engine
        # or entity of HA's own (Mantel's are mirrored); it is still a tablet
        # (removing it is still the only thing that removes its entities)
        mantel = linked_mode_tablets(self.hass, self.entry)
        for tid in [t for t in self.entities if t in mantel and t in want]:
            for ent in self.entities.pop(tid).values():
                if ent.hass is not None:
                    self.hass.async_create_task(ent.async_remove())
        for tid in list(self.entities):
            if tid not in want:
                for ent in self.entities.pop(tid).values():
                    eid = ent.entity_id
                    self.hass.async_create_task(ent.async_remove(force_remove=True))
                    if eid and reg.async_get(eid):
                        reg.async_remove(eid)
                uid = self._uids.pop(tid, None)
                dev = uid and devs.async_get_device_by_identifier((DOMAIN, f"{self.entry.entry_id}_{uid}"),
                                                                  self.entry.entry_id)
                if dev:
                    devs.async_remove_device(dev.id)
        from .binary_sensor import ScreenInUse
        from .sensor import SleepScreenSensor
        from .switch import BlackScreen, PhotoScreensaver
        want = {tid: w for tid, w in want.items() if tid not in mantel}
        for tid, w in want.items():
            have = self.entities.setdefault(tid, {})
            uid, name = w["tablet"]["uid"], w["tablet"]["name"]
            self._uids[tid] = uid
            # a renamed tablet renames its device (unless the house named it)
            dev = devs.async_get_device_by_identifier((DOMAIN, f"{self.entry.entry_id}_{uid}"), self.entry.entry_id)
            if dev and dev.name != name:
                devs.async_update_device(dev.id, name=name)
            # a tablet lifted off its screen (1.14): its device moves to the
            # tablet's item BEFORE its entities are added there
            self._adopt(dev, w["sub"].subentry_id)
            classes = {"switch": PhotoScreensaver, "black": BlackScreen, "binary_sensor": ScreenInUse,
                       "sleep": SleepScreenSensor}
            for kind, platform in R.KINDS:
                if kind in have or platform not in self.adders:
                    continue
                ent = classes[kind](self, tid, name, uid)
                have[kind] = ent
                self.adders[platform]([ent], config_subentry_id=w["sub"].subentry_id)
        self._sync_engines(want)
        for have in self.entities.values():
            for ent in have.values():
                if ent.hass is not None:
                    ent.async_write_ha_state()

    @callback
    def _adopt(self, dev: Any, subentry_id: str) -> None:
        """A tablet lifted off a screen (1.14): its device was the screen's
        item's. A device belongs to one subentry (Home Assistant 2026.10), so
        it is moved to the tablet's item -- before the entities are added
        there, which then move with it. An older Home Assistant, where a
        device may have several: the tablet's added, the screen's dropped."""
        if dev is None:
            return
        devs = dr.async_get(self.hass)
        if hasattr(dev, "config_subentry_id"):
            if dev.config_subentry_id != subentry_id:
                devs.async_update_device(dev.id, new_config_subentry_id=subentry_id)
            return
        have = dev.config_entries_subentries.get(self.entry.entry_id) or set()
        if subentry_id not in have:
            devs.async_update_device(dev.id, add_config_entry_id=self.entry.entry_id, add_config_subentry_id=subentry_id)
        for sid in [s for s in have if s not in (subentry_id, None)]:
            devs.async_update_device(dev.id, remove_config_entry_id=self.entry.entry_id, remove_config_subentry_id=sid)

    @callback
    def _sync_engines(self, want: dict[str, Any]) -> None:
        """An engine for each screen whose Sleep Screen is Decided By HK
        Frontend (or shadow), built again when what it reads changes."""
        from .sleep_engine import Engine
        for path in list(self.engines):
            if not R.deciding((want.get(path) or {}).get("board", {})):
                self.engines.pop(path).unload()
                self._engine_keys.pop(path, None)
        for path, w in want.items():
            b = w["board"]
            if not R.deciding(b):
                continue
            have = self.entities.get(path, {})
            ids = {k: getattr(e, "entity_id", None) for k, e in have.items()}
            key = R.engine_key(b, ids)
            if self._engine_keys.get(path) == key:
                continue
            eng = self.engines.get(path) or Engine(self.hass, self, path)
            self.engines[path] = eng
            self._engine_keys[path] = key
            eng.configure(b)

    @callback
    def unload(self) -> None:
        for eng in self.engines.values():
            eng.unload()
        self.engines.clear()
        self._engine_keys.clear()

    def board(self, tid: str) -> dict[str, Any]:
        """What tablet `tid` reads (as_board), or the defaults."""
        w = wanted(self.entry).get(tid)
        return w["board"] if w else as_board(S.tablet(None, tid), S.resolved(S.board(None), self.entry.options))

    def tablets_on(self, path: str, user: Any = None) -> list[str]:
        """The tablets running screen `path` -- those signed in as `user`
        (a Home Assistant user) first, when given."""
        return R.tablets_on(wanted(self.entry), path,
                            R.ANYONE if user is None else getattr(user, "name", None))

    def _ids(self) -> dict[str, dict[str, str | None]]:
        return {tid: {k: e.entity_id for k, e in have.items()} for tid, have in self.entities.items()}

    def switch_ids(self) -> dict[str, str]:
        """{path: entity id} of each screen's switch, for the settings feed."""
        return R.ids_of(self._ids(), "switch")

    def black_ids(self) -> dict[str, str]:
        """{path: entity id} of each screen's black screen switch."""
        return R.ids_of(self._ids(), "black")

    def entity_ids(self) -> dict[str, dict[str, str | None]]:
        """{path: {"switch": id, "in_use": id}} for the settings page, which
        names them on the screen's Screensaver page."""
        return R.named(self._ids())

    @callback
    def saver_touched(self, path: str) -> None:
        self.saver_touch[path] = dt_util.utcnow()

    def touched(self, path: str) -> None:
        self.touch[path] = dt_util.utcnow()
        for ent in self.entities.get(path, {}).values():
            if ent.hass is not None:
                ent.touched()


class SaverEntity:
    """What the switch and the in-use sensor share. Each screen is a device of
    its own (named like the screen, in the screen's item), so the ids read
    switch.<screen>_photo_screensaver and the house's device stays out of the
    screen's item."""

    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(self, mgr: Manager, tid: str, title: str, key: str, uid: str | None = None) -> None:
        # _path: the tablet's id (the engine and the manager key by it); the
        # unique id and the device go by its uid -- for a tablet lifted off a
        # screen, that screen's path, so nothing in the registry changes
        self._mgr, self._path = mgr, tid
        uid = uid or tid
        self._attr_unique_id = f"{mgr.entry.entry_id}_{uid}_{key}"
        self._attr_translation_key = key          # translations/en.json entity.*
        self._attr_device_info = device_info(mgr.entry, uid, title)

    def _starts_after(self) -> int:
        return R.starts_after(self._mgr.board(self._path))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return R.attributes(self._path, self._mgr.board(self._path), self._mgr.touch.get(self._path))

    def touched(self) -> None:
        self.async_write_ha_state()


def linked_mode_tablets(hass: HomeAssistant, entry: ConfigEntry) -> frozenset[str]:
    from . import linked_mode
    return linked_mode.mantel_tablets(hass, entry)


def device_info(entry: ConfigEntry, uid: str, title: str) -> Any:
    from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
    return DeviceInfo(identifiers={(DOMAIN, f"{entry.entry_id}_{uid}")}, name=title,
                      manufacturer="HK Frontend", model="Wall Tablet", entry_type=DeviceEntryType.SERVICE)


async def async_setup_platform(hass: HomeAssistant, entry: ConfigEntry, platform: str, add: Any) -> None:
    mgr = hass.data.setdefault(DOMAIN, {}).get(DATA)
    if mgr is None or mgr.entry is not entry:
        mgr = Manager(hass, entry)
        hass.data[DOMAIN][DATA] = mgr
        entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_CONFIG, mgr.sync))

        @callback
        def _forget() -> None:
            mgr.unload()
            if hass.data.get(DOMAIN, {}).get(DATA) is mgr:
                hass.data[DOMAIN].pop(DATA)
        entry.async_on_unload(_forget)
    mgr.attach(platform, add)


def manager(hass: HomeAssistant) -> Manager | None:
    return hass.data.get(DOMAIN, {}).get(DATA)


# ------------------------------------------------------------ the page's touches
def _which(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
           ) -> tuple[Manager | None, str | None]:
    """The tablet a page speaks for: `tablet` (1.14, hkSettings.tablet()), or
    -- a page still running the files from before -- the tablet on
    `dashboard` signed in as this user. Only that tablet's own user, an admin,
    or anyone for a tablet with no user (Just a Browser, known by its URL)."""
    mgr = manager(hass)
    if mgr is None:
        return None, None
    user = connection.user
    tid = msg.get("tablet")
    if not tid and msg.get("dashboard"):
        on = mgr.tablets_on(msg["dashboard"], user)
        tid = on[0] if on else None
    if not tid or tid not in mgr.entities:
        return mgr, None
    owner = mgr.board(tid)["tablet_user"]
    if not R.may_speak_for(owner, signed_in=bool(user), admin=bool(user and user.is_admin),
                           name=user.name if user else None):
        return mgr, ""
    return mgr, tid


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/screensaver/touch",
    vol.Optional("tablet"): str,
    vol.Optional("dashboard"): str,
    # a touch on the screensaver's own controls, the photos still up
    vol.Optional("saver", default=False): bool,
})
@callback
def ws_touch(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """hk-saver.js: somebody touched this tablet. Only the tablet itself (its
    user) or an admin may say so -- a desk opening the same screen is not the
    tablet."""
    mgr, tid = _which(hass, connection, msg)
    if tid is None:
        connection.send_error(msg["id"], "not_found", "No such wall tablet")
        return
    if tid == "":
        connection.send_error(msg["id"], "unauthorized", "Only the tablet's own user")
        return
    if msg.get("saver"):
        mgr.saver_touched(tid)
    else:
        mgr.touched(tid)
    connection.send_result(msg["id"], {"window": window_of(mgr.board(tid)["screensaver_options"]["starts_after"])})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/screensaver/black",
    vol.Optional("tablet"): str,
    vol.Optional("dashboard"): str,
    vol.Required("black"): bool,
})
@callback
def ws_black(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """hk-saver.js, Black Screen: HK Frontend -- black: true once the page is
    black (its curtain drawn, the backlight down): the sleep waits for it, and
    falls back to Kiosk Satellite's black without it. black: false when a tap
    woke it on the tablet: the switch follows. The tablet itself (its user) or
    an admin only, as for a touch."""
    mgr, tid = _which(hass, connection, msg)
    blk = mgr.entities.get(tid, {}).get("black") if (mgr and tid) else None
    if tid == "":
        connection.send_error(msg["id"], "unauthorized", "Only the tablet's own user")
        return
    if blk is None:
        connection.send_error(msg["id"], "not_found", "No black screen on that tablet")
        return
    # A TAP WOKE IT: in use first, then not black, in this one callback -- so
    # the want never sees the black gone without the touch (it would read
    # "nobody here" and send the tablet back to sleep)
    if not msg["black"] and blk.is_on:
        mgr.touched(tid)
    blk.page_says(msg["black"])
    connection.send_result(msg["id"], {"on": blk.is_on})


def register_commands(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_touch)
    websocket_api.async_register_command(hass, ws_black)
