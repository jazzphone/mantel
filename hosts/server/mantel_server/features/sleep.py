"""The Sleep Screen on Mantel: ``MantelSleep``, one engine per tablet whose Sleep Screen is decided by HK (hk_core's
decisions, Mantel's own black and photos, every house call through ``FeatureCaller``)."""
from __future__ import annotations

import asyncio
from collections import deque
import copy
from datetime import datetime
import logging
import time
from typing import Any, Awaitable, Callable, TYPE_CHECKING

from hk_core.screensaver.black import Black
from hk_core.sleep import engine as SE

from ..house import HouseCommandRefused, HouseCommandsDisabled

if TYPE_CHECKING:
    from .host import FeatureHost

log = logging.getLogger("mantel.features")

# -------------------------------------------------------------------------------- the Sleep Screen
class MantelSleep(SE.Sleep):
    """One tablet's Sleep Screen on Mantel: hk_core's decisions; the sleep and the wake as HA's
    sleep_engine.py runs them, with Mantel's own black and photos, and every house call through
    ``MantelHouse.call_service`` (the gateway). Each action and each call's outcome is kept."""

    CONFIRM_S = 4.0          # the page's answer to HK's black
    CONFIRM_LONG_S = 20.0    # ...more time (reconnecting after a restart), then the backlight at its minimum
    KIOSK_WAIT_S = 2.0       # the kiosk reporting its screensaver up / down
    SETTLE_S = 0.9           # a wake's settle
    BACKSTOP_S = 2.0         # the backlight back up
    POLL_S = 0.05

    def __init__(self, host: "FeatureHost", tid: str) -> None:
        SE.Sleep.__init__(self, host.own_house, tid, host.now)
        self.host, self.tid = host, tid
        self.last_action: tuple[str, str] | None = None
        self.actions: deque = deque(maxlen=20)
        self._current: dict | None = None
        self._task: asyncio.Task | None = None
        self._timer: asyncio.TimerHandle | None = None
        self._side: set[asyncio.Task] = set()
        self._recent: list[float] = []
        self._closed = False

    def configure(self, board: dict[str, Any]) -> None:
        self.options(board)
        self.seed_presence()
        self.evaluate()

    def awake_also(self) -> list[str]:
        """LIVE TV PLAYING ON THIS TABLET keeps it awake (2026-10-21), as a Keep Awake While entity would:
        nobody touches a screen they are watching. Only this tablet: the heartbeat names it (live_tv.py
        Viewers.tablets), so a show in the living room keeps no other tablet up."""
        tv = self.host.app.get("live_tv")
        try:
            return ["Live TV"] if tv is not None and self.tid in tv.viewers.tablets(tv.monotonic()) else []
        except Exception:  # noqa: BLE001 -- the Sleep Screen decides without it
            return []

    def unload(self) -> None:
        self._closed = True
        if self._timer is not None:
            self._timer.cancel()
        if self._task is not None and not self._task.done():
            self._task.cancel()
        for t in list(self._side):
            t.cancel()

    # what Sleep asks of the host
    def _own(self) -> dict[str, str]:
        return self.host.own_ids(self.tid)

    def _page_touch(self) -> datetime | None:
        s = self.host.screens.get(self.tid)
        return s.touch if s else None

    def _saver_touch(self) -> datetime | None:
        s = self.host.screens.get(self.tid)
        return s.saver_touch if s else None

    def notify_wake(self, title: str, seconds: int) -> None:
        SE.Sleep.notify_wake(self, title, seconds)
        self.evaluate()

    # deciding
    def _busy(self) -> bool:
        return bool(self._task and not self._task.done())

    def evaluate(self) -> None:
        if self._closed:
            return
        now = self.clock()
        nxt = self.decide(now)
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if nxt is not None and loop is not None:
            self._timer = loop.call_later(max(0.0, (nxt - now).total_seconds()), self.evaluate)
        self.host.sleep_changed(self.tid)
        if not self.acting or loop is None:
            return
        self._brightness()
        self._quiet_display(now)
        self.reconcile()

    def reconcile(self) -> None:
        if self._closed or self._busy():
            return
        what = self.action()
        if what is None or not self.trusted():
            return
        now = self.host.monotonic()
        ok, self._recent = SE.room_to_act(self._recent, now, SE.ACTIONS_PER_MIN)
        if not ok:
            log.warning("Sleep Screen %s: %d actions in a minute; waiting (want %s, actual %s: %s)",
                        self.tid, len(self._recent), self.want, self.actual, self.reason)
            return
        self._recent.append(now)
        self._task = asyncio.get_running_loop().create_task(self._run(what))

    async def _run(self, what: str) -> None:
        self.last_action = (what, self.clock().isoformat())
        self._current = {"at": self.last_action[1], "what": what, "reason": self.reason, "calls": []}
        self.actions.append(self._current)
        try:
            if what == "sleep":
                await self.sleep(self.power_off_wanted())
            else:
                await self.wake(photos=self.wakes_to_photos())
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("Sleep Screen %s: %s failed", self.tid, what)
        finally:
            self._current = None
            self._task = None
            if not self._closed:
                self.evaluate()

    # acting
    async def _call(self, domain: str, service: str, data: dict[str, Any]) -> None:
        rec = {"call": f"{domain}.{service}", "data": copy.deepcopy(data)}
        own = {v: k for k, v in self._own().items()}
        eid = data.get("entity_id")
        if domain == "switch" and isinstance(eid, str) and own.get(eid) == "photos":
            await self.host.set_photos(self.tid, service == "turn_on")       # Mantel's own photos: no house call
            rec["outcome"] = "mantel"
        else:
            try:
                await asyncio.wait_for(self.house.call_service(domain, service, data, context=f"sleep:{self.tid}"), 10)
                rec["outcome"] = "sent"
            except HouseCommandsDisabled:
                rec["outcome"] = "would"
            except HouseCommandRefused as exc:
                rec["outcome"] = f"refused:{exc.code}"
            except Exception as exc:  # noqa: BLE001 -- continue_on_error, as the house's scripts
                rec["outcome"] = f"failed:{type(exc).__name__}"
        if self._current is not None:
            self._current["calls"].append(rec)
        else:
            self.actions.append({"at": self.clock().isoformat(), "what": "side", "calls": [rec]})

    async def _until(self, test: Callable[[], bool], seconds: float) -> bool:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if test():
                return True
            await asyncio.sleep(self.POLL_S)
        return test()

    def _black_on(self) -> bool:
        s = self.host.screens.get(self.tid)
        return bool(s and s.black.on)

    def _black_confirmed(self) -> bool:
        """The page said it is black: Mantel's own copy (the page reports to Mantel), else Home Assistant's
        mirror of the black switch. Read only from HA's mirror, the confirmation made a round trip through
        Home Assistant, and a slow one (HA finishing its nightly backup, 05:40, 2026-10-21) timed every
        tablet out at once: each fell back to Kiosk Satellite's own screensaver, which another tablet's
        wake then ended -- the Master Bedroom lit at 05:18 and 05:59."""
        s = self.host.screens.get(self.tid)
        return bool(s and s.black.on and s.black.confirmed) or bool(self._attr(self._own().get("black"), "confirmed"))

    async def sleep(self, power_off: bool) -> None:
        """The house's <room>_tablet_sleep (sleep_engine.Engine.sleep), on Mantel."""
        if self.app_front():
            return
        own, k, t = self._own(), self.kiosk, self.target()
        if own.get("photos"):
            await self._call("switch", "turn_on", {"entity_id": own["photos"]})
        confirmed = dimmed = False
        hk_black = self.board.get("black_screen") == "hk"
        if hk_black:
            # HK'S BLACK, NEVER THE KIOSK'S UNDER IT: Kiosk Satellite's own screensaver ends by itself when
            # another tablet sleeps or wakes (measured on the house 2026-10-21: 2.6-2.8 s later, every time),
            # which lit the Master Bedroom at 05:18 and 05:59. A page slow to confirm (reconnecting after a
            # restart, or HA's mirror lagging) gets more time; one that still has not answered gets its
            # backlight at the minimum instead, so the screen is dark either way.
            await self.host.set_black(self.tid, black=True, brightness=t, why="sleep")
            confirmed = await self._until(self._black_confirmed, self.CONFIRM_S)
            if not confirmed:
                confirmed = await self._until(self._black_confirmed, self.CONFIRM_LONG_S)
            if not confirmed:
                scr = self._st(k.get("screen"))
                if scr is not None and scr.state == "on":
                    await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": 1})
                    dimmed = True
                log.warning("Sleep Screen %s: the page has not confirmed HK's black; the backlight is at its "
                            "minimum instead (never the kiosk's screensaver under it)", self.tid)
        kiosk_ok = not hk_black                  # the kiosk's screensaver: a kiosk-black tablet's own black
        if kiosk_ok and not confirmed and k.get("active"):
            if k.get("mode") and getattr(self._st(k["mode"]), "state", None) != "Black":
                await self._call("select", "select_option", {"entity_id": k["mode"], "option": "Black"})
            for part in ("armed", "active"):
                if k.get(part):
                    await self._call("switch", "turn_on", {"entity_id": k[part]})
            scr = self._st(k.get("screen"))
            if t is not None and scr is not None and scr.state == "on" and scr.attributes.get("brightness") != t:
                await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": t})
            up = await self._until(lambda: getattr(self._st(k["active"]), "state", None) == "on", self.KIOSK_WAIT_S)
            if not up and self.want == "dark" and not self.app_front():
                await self._call("switch", "turn_on", {"entity_id": [k[p] for p in ("armed", "active") if k.get(p)]})
        black_up = confirmed or dimmed or getattr(self._st(k.get("active")), "state", None) == "on"
        scr = self._st(k.get("screen"))
        if power_off and black_up and scr is not None and scr.state == "on":
            if own.get("photos"):
                await self._call("switch", "turn_off", {"entity_id": own["photos"]})
            await self._call("light", "turn_off", {"entity_id": k["screen"]})

    async def wake(self, photos: bool = False) -> None:
        """The house's <room>_tablet_wake (sleep_engine.Engine.wake), on Mantel."""
        photo_svc = "turn_on" if photos else "turn_off"
        if self.app_front():
            return
        own, k, t = self._own(), self.kiosk, self.target()
        scr = self._st(k.get("screen"))
        if scr is not None and scr.state == "off":
            data: dict[str, Any] = {"entity_id": k["screen"]}
            if t is not None:
                data["brightness"] = t
            await self._call("light", "turn_on", data)
        if own.get("photos"):
            await self._call("switch", photo_svc, {"entity_id": own["photos"]})
        hk_black = self._black_on() and self.board.get("black_screen") == "hk"
        if self._black_on():
            await self.host.set_black(self.tid, black=False, brightness=t, why="sleep")
        if k.get("active"):
            await self._call("switch", "turn_off", {"entity_id": [k[p] for p in ("active", "armed") if k.get(p)]})
            down = await self._until(lambda: getattr(self._st(k["active"]), "state", None) == "off", self.KIOSK_WAIT_S)
            if not down:
                await self._call("switch", "turn_off", {"entity_id": [k[p] for p in ("active", "armed") if k.get(p)]})
        await asyncio.sleep(self.SETTLE_S)
        if hk_black and k.get("screen") and t is not None and t >= 5:
            lit = await self._until(lambda: (self._attr(k["screen"], "brightness") or 0) >= 5, self.BACKSTOP_S)
            if not lit and getattr(self._st(k["screen"]), "state", None) == "on":
                await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": t})
        t = self.target()
        scr = self._st(k.get("screen"))
        if t is not None and scr is not None and scr.state == "on" and \
                abs((self._attr(k.get("screen"), "brightness") or 0) - t) > 2:
            await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": t})
        if self.app_front():
            return
        if own.get("photos"):
            await self._call("switch", photo_svc, {"entity_id": own["photos"]})
        if k.get("front"):
            await self._call("button", "press", {"entity_id": k["front"]})

    def _spawn(self, coro: Awaitable[Any]) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._side.add(task)
        task.add_done_callback(self._side.discard)

    def _brightness(self) -> None:
        if self._busy():
            return
        s = self.host.screens.get(self.tid)
        own = self._own()
        step = self.brightness_step((own.get("black"), bool(s and s.black.on)) if own.get("black") else None)
        if step is None:
            return
        where, eid, t = step
        if where == "black":
            self._spawn(self.host.set_black(self.tid, brightness=t, why="sleep"))
        else:
            self._spawn(self._call("light", "turn_on", {"entity_id": eid, "brightness": t}))

    def _quiet_display(self, now: datetime) -> None:
        if self._busy():
            return
        eid = self.quiet_display_off(now)
        if eid:
            self._spawn(self._call("light", "turn_off", {"entity_id": eid}))

    def report(self) -> dict[str, Any]:
        return {"want": self.want, "reason": self.reason, "actual": self.actual,
                "decided_by": self.o.get("decided_by"), "acting": self.acting,
                "attributes": self.attributes(self.last_action), "actions": list(self.actions)}
