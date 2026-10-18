"""Sleep Screen's engine: one per screen whose Sleep Screen is Decided By HK
Frontend (or in shadow). It gathers the moment's facts from Home Assistant,
asks sleep_rules.decide() what the screen should show, publishes that on
sensor.<screen>_sleep_screen, and -- unless in shadow -- puts the screen
there: the sleep and the wake the house's generated scripts ran
(hk_house/generator/tablet_script_template.yaml), now here, one screen at a
time.

HOW IT KEEPS UP. Every entity the rules read is listened to; the moments a
fact changes by the clock alone (a presence linger running out, the in-use
window closing, After the Screensaver, the schedule) are timed exactly; and a
minute's tick repairs anything missed. The rules are self-consistent at any
moment -- a missed event costs a late answer, never a wrong one.

ONE ACTION AT A TIME, PER SCREEN. A sleep or a wake changes the very
entities the facts come from, so the facts are read again when it ends and
the next action (if any) follows; a change during an action never starts a
second one beside it (TABLET-INVARIANTS section 3: the reconcile that killed
its own wake). Three actions in a minute and it waits a minute: never a loop.

OURS, NOT A PERSON'S. Every call carries a context of its own with a
parent, so nothing reads the engine's writes as somebody's hand (the
power-button wake below; the house's Woken By Hand automation).

The DECISIONS are shared (hk_core/sleep/engine.py: the facts, the presence
memory, the next moment to look again, what to show, the brightness, the loop
guard; hk_core/sleep/rules.py: decide()): Engine is a Sleep that reads the
house through HaHouse. What stays here is Home Assistant's: following the
entities and the clock, the screen's own entities and touches, the sensor's
state, and the sleep and the wake themselves -- the service calls, the waits
between them, and their contexts.
"""
from __future__ import annotations

import asyncio
import logging
import time as _time
from datetime import datetime, timedelta
from typing import Any, Callable

from homeassistant.core import Context, Event, HomeAssistant, State, callback
from homeassistant.helpers.event import async_track_point_in_utc_time, async_track_state_change_event, async_track_time_interval
from homeassistant.util import dt as dt_util

from . import sleep_rules as R  # noqa: F401 -- the rules, by their old name here
from .hk_core.sleep import engine as C
from .hk_core.sleep.engine import (  # noqa: F401 -- shared
    ACTIONS_PER_MIN, HAND_LIT_S, HAND_WAKE_S, KIOSK_APPS, KIOSK_PARTS, SAVER_SLOP, SAVER_WAIT, Sleep, by_hand,
    room_to_act,
)
from .house import HaHouse

_LOG = logging.getLogger(__name__)

# the sleep's and the wake's waits (the tests shorten them, SAVER_WAIT too)
CONFIRM_S = 4.0          # the page's answer to HK's black
KIOSK_WAIT_S = 2.0       # the kiosk reporting its screensaver up / down
SETTLE_S = 0.9           # a wake's settle (the house's wake script)
BACKSTOP_S = 2.0         # the backlight back up, or written here


def kiosks(hass: HomeAssistant) -> list[dict[str, str]]:
    """The Kiosk Satellite devices: [{id, name}] (their foreground app and
    screensaver switch say what they are)."""
    return C.kiosks(HaHouse(hass))


def kiosk_parts(hass: HomeAssistant, device_id: str) -> dict[str, str]:
    """{part: entity id} of a Kiosk Satellite device (KIOSK_PARTS)."""
    return C.kiosk_parts(HaHouse(hass), device_id)


class Engine(Sleep):
    """One screen's Sleep Screen: the shared decisions (Sleep), acted on here."""

    def __init__(self, hass: HomeAssistant, mgr: Any, path: str) -> None:
        self.hass, self.mgr = hass, mgr
        Sleep.__init__(self, HaHouse(hass), path, lambda: dt_util.utcnow(), dt_util.parse_datetime)
        self.last_action: tuple[str, str] | None = None
        self._unsubs: list[Callable[[], None]] = []
        self._timer: Callable[[], None] | None = None
        self._task: asyncio.Task | None = None
        # the small calls made beside an action (brightness, the display off):
        # kept so an unload can cancel them too
        self._side: set[asyncio.Task] = set()
        # UNLOADED IS FINAL: an engine handed back (Sleep Screen to the house's
        # automation, the entry reloaded, the tablet removed) never acts again,
        # whatever is still on its way (a cancelled action's finally, a timer)
        self._closed = False
        self._recent: list[float] = []
        self._root = Context()

    # ------------------------------------------------------------ lifecycle
    def configure(self, board: dict[str, Any]) -> None:
        self.options(board)
        self.stop()
        ids = self.listens()
        if ids:
            self._unsubs.append(async_track_state_change_event(self.hass, ids, self._changed))
        self._unsubs.append(async_track_time_interval(self.hass, self._tick, timedelta(seconds=60)))
        self.seed_presence()
        self.evaluate()

    def stop(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs = []
        if self._timer:
            self._timer()
            self._timer = None

    def unload(self) -> None:
        self._closed = True
        self.stop()
        if self._task and not self._task.done():
            self._task.cancel()
        for t in list(self._side):
            t.cancel()
        self._side.clear()

    def _spawn(self, coro: Any) -> None:
        task = self.hass.async_create_task(coro, "hk_frontend sleep %s" % self.path)
        self._side.add(task)
        task.add_done_callback(self._side.discard)

    def _busy(self) -> bool:
        return bool(self._task and not self._task.done())

    # ------------------------------------------------- what Sleep asks of us
    def _own(self) -> dict[str, str]:
        have = self.mgr.entities.get(self.path, {})
        out = {}
        for k, key in (("switch", "photos"), ("black", "black"), ("binary_sensor", "in_use")):
            ent = have.get(k)
            if ent is not None and ent.entity_id:
                out[key] = ent.entity_id
        return out

    def _page_touch(self) -> datetime | None:
        return self.mgr.touch.get(self.path)

    def _saver_touch(self) -> datetime | None:
        return self.mgr.saver_touch.get(self.path)

    def _saver_wait(self) -> float:
        return SAVER_WAIT

    # --------------------------------------------------------------- events
    @callback
    def _changed(self, event: Event) -> None:
        new: State | None = event.data.get("new_state")
        old: State | None = event.data.get("old_state")
        # (the power button: the display lit with no Home Assistant context -- by_hand)
        ctx = new.context if new is not None else None
        self.display_changed(event.data.get("entity_id"), old.state if old is not None else None,
                             new.state if new is not None else None,
                             ctx is not None and by_hand(ctx.parent_id, ctx.user_id))
        self.evaluate()

    @callback
    def notify_wake(self, title: str, seconds: int) -> None:
        """A notification wakes this screen: up to its photos for `seconds`
        (then the rules again; somebody using it keeps it, as ever)."""
        Sleep.notify_wake(self, title, seconds)
        self.evaluate()

    @callback
    def _tick(self, _now: datetime) -> None:
        self.evaluate()

    @callback
    def _timed(self, _now: datetime) -> None:
        self._timer = None
        self.evaluate()

    # -------------------------------------------------------------- decide
    @callback
    def evaluate(self) -> None:
        if self._closed:
            return
        now = dt_util.utcnow()
        nxt = self.decide(now)
        if self._timer:
            self._timer()
            self._timer = None
        if nxt is not None:
            self._timer = async_track_point_in_utc_time(self.hass, self._timed, nxt)
        sensor = self.mgr.entities.get(self.path, {}).get("sleep")
        if sensor is not None and sensor.hass is not None:
            sensor.async_write_ha_state()
        # (and not before the screen's own entities are there -- the first
        # build, before Home Assistant has named them)
        if not self.acting or not self._own().get("black"):
            return
        self._brightness()
        self._quiet_display(now)
        self.reconcile()

    # ---------------------------------------------------------------- act
    @callback
    def reconcile(self) -> None:
        if self._closed:
            return
        if self._busy():
            return                     # read again when it ends (_run)
        what = self.action()
        if what is None or not self._trusted():
            return
        now = _time.monotonic()
        ok, self._recent = room_to_act(self._recent, now, ACTIONS_PER_MIN)
        if not ok:
            _LOG.warning("Sleep Screen %s: %d actions in a minute; waiting (want %s, actual %s: %s)",
                         self.path, len(self._recent), self.want, self.actual, self.reason)
            return
        self._recent.append(now)
        self._task = self.hass.async_create_task(self._run(what), "hk_frontend sleep %s" % self.path)

    def _trusted(self) -> bool:
        return self.trusted()

    async def _run(self, what: str) -> None:
        self.last_action = (what, dt_util.utcnow().isoformat())
        try:
            if what == "sleep":
                await self.sleep(self.power_off_wanted())
            else:
                await self.wake(photos=self.wakes_to_photos())
        except asyncio.CancelledError:
            raise
        except Exception:                                   # noqa: BLE001
            _LOG.exception("Sleep Screen %s: %s failed", self.path, what)
        finally:
            self._task = None
            if not self._closed:
                self.evaluate()

    def _ctx(self) -> Context:
        return Context(parent_id=self._root.id)

    async def _call(self, domain: str, service: str, data: dict[str, Any]) -> None:
        try:
            await asyncio.wait_for(self.hass.services.async_call(domain, service, data, blocking=True,
                                                                 context=self._ctx()), 10)
        except Exception as e:                              # noqa: BLE001 -- continue_on_error, as the scripts
            _LOG.debug("Sleep Screen %s: %s.%s %s: %s", self.path, domain, service, data, e)

    async def _until(self, test: Callable[[], bool], seconds: float) -> bool:
        end = _time.monotonic() + seconds
        while _time.monotonic() < end:
            if test():
                return True
            await asyncio.sleep(0.05)
        return test()

    def _app_front(self) -> bool:
        return self.app_front()

    def _black(self) -> Any:
        return self.mgr.entities.get(self.path, {}).get("black")

    async def sleep(self, power_off: bool) -> None:
        """The house's <room>_tablet_sleep."""
        if self._app_front():
            return
        own, k, t = self._own(), self.kiosk, self.target()
        if own.get("photos"):
            await self._call("switch", "turn_on", {"entity_id": own["photos"]})
        blk = self._black()
        confirmed = False
        if blk is not None and self.board.get("black_screen") == "hk":
            await blk.async_set_black_screen(black=True, brightness=t)
            confirmed = await self._until(lambda: bool(self._attr(own.get("black"), "confirmed")), CONFIRM_S)
        if not confirmed and k.get("active"):
            if k.get("mode") and getattr(self._st(k["mode"]), "state", None) != "Black":
                await self._call("select", "select_option", {"entity_id": k["mode"], "option": "Black"})
            for part in ("armed", "active"):
                if k.get(part):
                    await self._call("switch", "turn_on", {"entity_id": k[part]})
            scr = self._st(k.get("screen"))
            if t is not None and scr is not None and scr.state == "on" and scr.attributes.get("brightness") != t:
                await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": t})
            up = await self._until(lambda: getattr(self._st(k["active"]), "state", None) == "on", KIOSK_WAIT_S)
            if not up and self.want == "dark" and not self._app_front():
                await self._call("switch", "turn_on", {"entity_id": [k[p] for p in ("armed", "active") if k.get(p)]})
                await asyncio.sleep(1)
        black_up = confirmed or getattr(self._st(k.get("active")), "state", None) == "on"
        scr = self._st(k.get("screen"))
        if power_off and black_up and scr is not None and scr.state == "on":
            if own.get("photos"):
                await self._call("switch", "turn_off", {"entity_id": own["photos"]})
            await self._call("light", "turn_off", {"entity_id": k["screen"]})

    async def wake(self, photos: bool = False) -> None:
        """The house's <room>_tablet_wake. `photos`: up to the photo
        screensaver instead of the dashboard (a notification's)."""
        photo_svc = "turn_on" if photos else "turn_off"
        if self._app_front():
            return
        own, k, t = self._own(), self.kiosk, self.target()
        scr = self._st(k.get("screen"))
        if scr is not None and scr.state == "off":
            data = {"entity_id": k["screen"]}
            if t is not None:
                data["brightness"] = t
            await self._call("light", "turn_on", data)
        if own.get("photos"):
            await self._call("switch", photo_svc, {"entity_id": own["photos"]})
        blk = self._black()
        hk_black = bool(blk is not None and blk.is_on and self.board.get("black_screen") == "hk")
        if blk is not None and blk.is_on:
            await blk.async_set_black_screen(black=False, brightness=t)
        if k.get("active"):
            await self._call("switch", "turn_off", {"entity_id": [k[p] for p in ("active", "armed") if k.get(p)]})
            down = await self._until(lambda: getattr(self._st(k["active"]), "state", None) == "off", KIOSK_WAIT_S)
            if not down:
                await self._call("switch", "turn_off", {"entity_id": [k[p] for p in ("active", "armed") if k.get(p)]})
        await asyncio.sleep(SETTLE_S)
        # the backlight never left at its lowest (TABLET-INVARIANTS 16p)
        if hk_black and k.get("screen") and t is not None and t >= 5:
            lit = await self._until(lambda: (self._attr(k["screen"], "brightness") or 0) >= 5, BACKSTOP_S)
            if not lit and getattr(self._st(k["screen"]), "state", None) == "on":
                await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": t})
        # AND ON EVERY WAKE, the target if the display is not at it (a change
        # it missed while offline, a wake through Kiosk Satellite's black,
        # which comes back at its own last level) -- the house's sleep script
        # repaired it the same way
        t = self.target()
        near = lambda: abs((self._attr(k.get("screen"), "brightness") or 0) - t) <= 2  # noqa: E731
        if t is not None and hk_black and k.get("screen"):
            await self._until(near, 1.5)          # the page's ramp, still coming up
        scr = self._st(k.get("screen"))
        if t is not None and scr is not None and scr.state == "on" and not near():
            await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": t})
        if self._app_front():
            return
        if own.get("photos"):
            await self._call("switch", photo_svc, {"entity_id": own["photos"]})
        if k.get("front"):
            await self._call("button", "press", {"entity_id": k["front"]})


    # ------------------------------------------------------ the brightness
    @callback
    def _brightness(self) -> None:
        """Brightness Follows Target (Sleep.brightness_step): the black's
        level, or the display's."""
        if self._busy():
            return
        blk = self._black()
        step = self.brightness_step((blk.entity_id, bool(blk.is_on)) if blk is not None else None)
        if step is None:
            return
        where, eid, t = step
        if where == "black":
            self._spawn(blk.async_set_black_screen(brightness=t))
        else:
            self._spawn(self._call("light", "turn_on", {"entity_id": eid, "brightness": t}))

    @callback
    def _quiet_display(self, now: datetime) -> None:
        """Display Off (Sleep.quiet_display_off)."""
        if self._busy():
            return
        eid = self.quiet_display_off(now)
        if eid:
            self._spawn(self._call("light", "turn_off", {"entity_id": eid}))

    # --------------------------------------------------------------- report
    def attributes(self) -> dict[str, Any]:
        return Sleep.attributes(self, self.last_action)
