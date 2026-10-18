"""WALL TABLETS (entry 1.14): what HK Frontend knows about each tablet's kiosk
app, beyond the tablet's own settings (settings.tablet) and its entities
(screensaver.py).

    parts()        a kiosk app's entities by role (battery, charging, its
                   buttons ...) -- Kiosk Satellite's and Fully Kiosk's, found
                   on the tablet's device by their endings
    devices()      the kiosk apps' devices in Home Assistant
    suggestions()  a kiosk device no tablet uses, or a browser that said it
                   looks like one (ws tablet/seen) -- "This looks like a wall
                   tablet" on Wall Tablets, until added or dismissed
    checks()       the tablet's kiosk app against what HK needs (the tablet's
                   page, Setup Check)
    Watch          the alerts (offline, not charging, didn't come back after
                   a restart) and the scheduled restart

The rules are shared (hk_core/tablets/) and asked through HaHouse; the names
here stay as thin wrappers. Home Assistant's side is what is left: the
tablets' settings read from the entry, the store of browsers seen, the
minute's timer and the restart's schedule, the button presses, persistent
notifications and the banner.

The page reads states itself; this sends it the entity ids (panel/get).
docs/Wall-Tablets.md.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_change, async_track_time_interval
from homeassistant.util import dt as dt_util

from . import settings as S
from .hk_core.tablets import alerts as A, kiosk as K, setup as SC, suggestions as SG
from .hk_core.tablets.alerts import BACK_AFTER, CHARGING_AFTER, CLEAR_WAIT, OFFLINE_AFTER  # noqa: F401 -- shared
from .hk_core.tablets.kiosk import (  # noqa: F401 -- shared
    BATTERY_CARE, KS_PACKAGE, PARTS, SAVER_TIMEOUT, screen_of_url,
)
from .hk_core.tablets.suggestions import SEEN_KEEP  # noqa: F401 -- shared
from .house import HaHouse

_LOGGER = logging.getLogger(__name__)
DATA = "tablets"                          # hass.data[DOMAIN][DATA]: the Watch


def parts(hass: HomeAssistant, app: str, device_id: str) -> dict[str, str]:
    """{role: entity id} of a tablet's kiosk app (PARTS), on its device."""
    return K.parts(HaHouse(hass), app, device_id)


def devices(hass: HomeAssistant) -> list[dict[str, str]]:
    """The kiosk apps' devices: [{id, name, app}] -- Kiosk Satellite's (its
    foreground app and screensaver switch), Fully Kiosk's (its integration)."""
    return K.devices(HaHouse(hass))


# ------------------------------------------------------------ suggestions
def _seen(hass: HomeAssistant) -> dict[str, dict[str, Any]]:
    from .const import DOMAIN
    return hass.data.setdefault(DOMAIN, {}).setdefault("tablets_seen", {})


@callback
def saw(hass: HomeAssistant, user: str, screen: str, app: str, tablet: str | None) -> None:
    """A browser that looks like a wall tablet (a kiosk app's) and isn't one
    of the tablets, reported by hk-settings.js."""
    rec = SG.seen_record(user, screen, app, tablet, dt_util.utcnow(), S.TABLET_APPS)
    if rec is not None:
        _seen(hass)[rec["key"]] = rec


def suggestions(hass: HomeAssistant, entry: Any) -> list[dict[str, Any]]:
    """What may be a wall tablet that isn't one yet: a kiosk app's device no
    tablet uses, and the browsers seen (saw) whose user and screen no tablet
    has -- less those dismissed."""
    tabs = S.tablets(entry)
    dismissed = set(S.merged(entry.options)["tablets"].get("dismissed") or [])
    screens = {s.unique_id for s in entry.subentries.values() if s.subentry_type == S.SUBENTRY_DASHBOARD}
    return SG.suggestions(HaHouse(hass), tabs, dismissed, screens, _seen(hass), dt_util.utcnow())


# ------------------------------------------------------------ checks
def checks(hass: HomeAssistant, t: dict[str, Any], p: dict[str, str]) -> list[dict[str, Any]]:
    """The tablet's kiosk app against what HK needs, each {key, ok, title,
    detail, fix} -- `fix`: [domain, service, data] that sets it right. The
    same rules as the tablet's page (hk-settings-model.js tabletChecks)."""
    return K.checks(HaHouse(hass), t, p)


def check_lines(hass: HomeAssistant, entry: Any, users: set[str]) -> list[Any]:
    """Setup Check's lines for the tablets (setup_check.Line)."""
    from .setup_check import Line
    return [Line(*line) for line in SC.check_lines(HaHouse(hass), S.tablets(entry), S.boards(entry), users)]


# ------------------------------------------------------------ alerts, restart
class Watch:
    """The alerts (All Tablets: offline, not charging, didn't come back after
    a restart) and the scheduled restart. One per house, rebuilt on a
    settings change (sync). What is wrong and which alerts are up is the
    shared Alerts' (`_since`, `_raised`, `_restarted` are its)."""

    def __init__(self, hass: HomeAssistant, entry: Any) -> None:
        self.hass, self.entry = hass, entry
        self._unsubs: list[CALLBACK_TYPE] = []
        self.alerts = A.Alerts()
        self._key = ""
        self.restarts: list[str] = []                         # the last run's tablets (diagnostics)

    @property
    def _since(self) -> dict[tuple[str, str], datetime]:
        return self.alerts.since

    @property
    def _raised(self) -> set[tuple[str, str]]:
        return self.alerts.raised

    @property
    def _restarted(self) -> dict[str, datetime]:
        return self.alerts.restarted

    @callback
    def sync(self) -> None:
        o = S.merged(self.entry.options)["tablets"]
        key = A.restart_key(o)
        if key == self._key and self._unsubs:
            return
        self.unload()
        self._key = key
        self._unsubs.append(async_track_time_interval(self.hass, self._check, timedelta(seconds=60)))
        for h, m in A.restart_times(o):
            self._unsubs.append(async_track_time_change(self.hass, self._restart_all, hour=h, minute=m, second=0))

    @callback
    def unload(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs = []

    # the scheduled restart
    @callback
    def _restart_all(self, _now: datetime) -> None:
        self.hass.async_create_task(self.restart_all(), "hk_frontend tablets restart")

    async def restart_all(self) -> list[str]:
        """Clear the cache, then restart: every tablet whose kiosk app can."""
        done: list[str] = []
        todo = A.restart_plan(HaHouse(self.hass), S.tablets(self.entry))
        for _tid, clear, _restart in todo:
            if clear:
                await self._press(clear)
        if todo:
            await asyncio.sleep(CLEAR_WAIT)
        for tid, _clear, restart in todo:
            await self._press(restart)
            self._restarted[tid] = dt_util.utcnow()
            done.append(tid)
        self.restarts = done
        return done

    async def _press(self, eid: str) -> None:
        try:
            await self.hass.services.async_call("button", "press", {"entity_id": eid}, blocking=True)
        except Exception:                                  # noqa: BLE001 -- one tablet never stops the rest
            _LOGGER.warning("Wall tablets: pressing %s failed", eid, exc_info=True)

    # the alerts
    @callback
    def _check(self, _now: datetime | None = None) -> None:
        o = S.merged(self.entry.options)["tablets"]
        for a in self.alerts.check(HaHouse(self.hass), S.tablets(self.entry), o, dt_util.utcnow()):
            if a.up:
                self._raise(a.tablet, a.kind, a.title, a.message)
            else:
                self._clear(a.tablet, a.kind)

    def _raise(self, tid: str, kind: str, title: str, message: str) -> None:
        from homeassistant.components import persistent_notification as pn
        pn.async_create(self.hass, message, title, notification_id=A.note_id(tid, kind))
        self.hass.async_create_task(self._banner(title, message), "hk_frontend tablet alert")

    def _clear(self, tid: str, kind: str) -> None:
        from homeassistant.components import persistent_notification as pn
        pn.async_dismiss(self.hass, A.note_id(tid, kind))

    async def _banner(self, title: str, message: str) -> None:
        """The same as an Important banner on the HK screens, when the house
        has Notifications."""
        try:
            from .features import notifications as N
            ent = N.running(self.hass)
            if ent is None:
                return
            await N.async_deliver(self.hass, N.build_action(self.hass, N.options(ent), {
                "title": title, "message": message, "important": True, "icon": "mdi:tablet-dashboard"}))
        except Exception:                                  # noqa: BLE001 -- the HA notification is there
            _LOGGER.debug("Wall tablets: no banner for %s", title, exc_info=True)


def watch(hass: HomeAssistant) -> Watch | None:
    from .const import DOMAIN
    return hass.data.get(DOMAIN, {}).get(DATA)


@callback
def async_setup_watch(hass: HomeAssistant, entry: Any) -> Watch:
    from homeassistant.helpers.dispatcher import async_dispatcher_connect
    from .const import DOMAIN, SIGNAL_CONFIG
    w = Watch(hass, entry)
    hass.data.setdefault(DOMAIN, {})[DATA] = w
    w.sync()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_CONFIG, w.sync))

    @callback
    def _gone() -> None:
        w.unload()
        if hass.data.get(DOMAIN, {}).get(DATA) is w:
            hass.data[DOMAIN].pop(DATA)
    entry.async_on_unload(_gone)
    return w
