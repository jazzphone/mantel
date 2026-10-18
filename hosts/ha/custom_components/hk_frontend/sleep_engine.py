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
"""
from __future__ import annotations

import asyncio
import logging
import time as _time
from datetime import datetime, timedelta
from typing import Any, Callable

from homeassistant.core import Context, Event, HomeAssistant, State, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.event import async_track_point_in_utc_time, async_track_state_change_event, async_track_time_interval
from homeassistant.util import dt as dt_util

from . import sleep_rules as R

_LOG = logging.getLogger(__name__)

# the kiosk's apps that are not "another app": Kiosk Satellite itself, and
# the home screens it replaces on a wake (the house's KIOSK list)
KIOSK_APPS = ("me.jxl.kiosk_satellite", "com.sec.android.app.launcher", "com.google.android.apps.nexuslauncher",
              "none", "", "unknown", "unavailable")
# a Kiosk Satellite device's entities, by the end of their ids
KIOSK_PARTS = {"screen": ("light", "_screen"), "active": ("switch", "_screensaver_active"),
               "armed": ("switch", "_screensaver"), "mode": ("select", "_screensaver_mode"),
               "app": ("sensor", "_foreground_app"), "touched": ("sensor", "_last_interaction"),
               "front": ("button", "_bring_to_front")}
CONFIRM_S = 4.0          # the page's answer to HK's black
KIOSK_WAIT_S = 2.0       # the kiosk reporting its screensaver up / down
SETTLE_S = 0.9           # a wake's settle (the house's wake script)
BACKSTOP_S = 2.0         # the backlight back up, or written here
HAND_LIT_S = 30          # a display lit by hand, before quiet hours turn it off again
HAND_WAKE_S = 60         # ...and lit by the power button: in use this long (the house's hand-wake minute)
# s: the kiosk's last tap, by the tablet's clock, still the screensaver's own
# control touch reported this long before it (clock drift, the report's trip)
SAVER_SLOP = 10
# s: a new tap with the photos up waits this long for the screensaver's own
# report of it -- Kiosk Satellite's can arrive first (measured: the same
# second), and read alone it is somebody at the tablet
SAVER_WAIT = 3
ACTIONS_PER_MIN = 6       # more and it waits: a loop, never a run of real changes


def kiosks(hass: HomeAssistant) -> list[dict[str, str]]:
    """The Kiosk Satellite devices: [{id, name}] (their foreground app and
    screensaver switch say what they are)."""
    reg, devs = er.async_get(hass), dr.async_get(hass)
    by_dev: dict[str, set[str]] = {}
    for e in reg.entities.values():
        if e.device_id:
            by_dev.setdefault(e.device_id, set()).add(e.entity_id)
    out = []
    for dev_id, ids in by_dev.items():
        if any(i.endswith("_foreground_app") for i in ids) and any(i.endswith("_screensaver_active") for i in ids):
            d = devs.async_get(dev_id)
            if d:
                out.append({"id": dev_id, "name": d.name_by_user or d.name or dev_id})
    return sorted(out, key=lambda k: k["name"].lower())


def kiosk_parts(hass: HomeAssistant, device_id: str) -> dict[str, str]:
    """{part: entity id} of a Kiosk Satellite device (KIOSK_PARTS)."""
    if not device_id:
        return {}
    ids = [e.entity_id for e in er.async_entries_for_device(er.async_get(hass), device_id)]
    out: dict[str, str] = {}
    for part, (domain, end) in KIOSK_PARTS.items():
        hits = [i for i in ids if i.startswith(domain + ".") and i.endswith(end)]
        if part == "armed":       # _screensaver, not _screensaver_active / _brightness
            hits = [i for i in hits if i.endswith("_screensaver")]
        if hits:
            out[part] = sorted(hits, key=len)[0]
    return out


class Engine:
    """One screen's Sleep Screen."""

    def __init__(self, hass: HomeAssistant, mgr: Any, path: str) -> None:
        self.hass, self.mgr, self.path = hass, mgr, path
        self.o: dict[str, Any] = {}
        self.board: dict[str, Any] = {}
        self.kiosk: dict[str, str] = {}
        self.want, self.reason, self.actual = "hold", "starting", "dashboard"
        self.facts_now: dict[str, Any] = {}
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
        # presence memory: raw (any sensor on), when it last cleared, when
        # the room last became occupied
        self._raw = False
        self._off_at: datetime | None = None
        self._rose_at: datetime | None = None
        self._present: bool | None = None
        self._started = dt_util.utcnow()
        self._target: int | None = None
        self._display_on_at: datetime | None = None
        self._hand_at: datetime | None = None
        # a notification set to Wake the Screen (features/notifications): the
        # dashboard until then, whatever else holds -- quiet hours too
        self._notice: tuple[str, datetime] | None = None
        # the last touch seen, and when it was first seen (SAVER_WAIT)
        self._touch_val: datetime | None = None
        self._touch_seen: datetime | None = None

    # ------------------------------------------------------------ lifecycle
    def configure(self, board: dict[str, Any]) -> None:
        self.board = board
        self.o = R.sleep_options(board.get("sleep")) or R.sleep_options(None)
        self.kiosk = kiosk_parts(self.hass, self.o.get("kiosk") or "")
        self.stop()
        ids = set(R.inputs(self.o)) | set(self.kiosk.values()) | set(self._own().values())
        ids.discard("")
        if ids:
            self._unsubs.append(async_track_state_change_event(self.hass, sorted(ids), self._changed))
        self._unsubs.append(async_track_time_interval(self.hass, self._tick, timedelta(seconds=60)))
        self._seed_presence()
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

    @property
    def acting(self) -> bool:
        return self.o.get("decided_by") == "hk"

    def _own(self) -> dict[str, str]:
        have = self.mgr.entities.get(self.path, {})
        out = {}
        for k, key in (("switch", "photos"), ("black", "black"), ("binary_sensor", "in_use")):
            ent = have.get(k)
            if ent is not None and ent.entity_id:
                out[key] = ent.entity_id
        return out

    # --------------------------------------------------------------- events
    @callback
    def _changed(self, event: Event) -> None:
        eid = event.data.get("entity_id")
        new: State | None = event.data.get("new_state")
        old: State | None = event.data.get("old_state")
        # THE POWER BUTTON IN QUIET HOURS: the display lit by the tablet
        # itself (no Home Assistant context) is a touch -- it lights onto the
        # black, which looks off, and the house wakes it to the dashboard
        if (eid and eid == self.kiosk.get("screen") and new is not None and old is not None
                and old.state == "off" and new.state == "on"):
            ctx = new.context
            if ctx is not None and ctx.parent_id is None and ctx.user_id is None and self.facts_now.get("quiet"):
                self._hand_at = dt_util.utcnow()
        if eid and eid == self.kiosk.get("screen") and new is not None:
            if new.state == "on" and (old is None or old.state != "on"):
                self._display_on_at = dt_util.utcnow()
        self.evaluate()

    @callback
    def notify_wake(self, title: str, seconds: int) -> None:
        """A notification wakes this screen: up to its photos for `seconds`
        (then the rules again; somebody using it keeps it, as ever)."""
        self._notice = (str(title or "a notification"), dt_util.utcnow() + timedelta(seconds=max(1, int(seconds))))
        self.evaluate()

    @callback
    def _tick(self, _now: datetime) -> None:
        self.evaluate()

    @callback
    def _timed(self, _now: datetime) -> None:
        self._timer = None
        self.evaluate()

    # ---------------------------------------------------------------- facts
    def _st(self, eid: str | None) -> State | None:
        return self.hass.states.get(eid) if eid else None

    def _name(self, eid: str) -> str:
        st = self._st(eid)
        return (st.attributes.get("friendly_name") if st else None) or eid

    def _on(self, ids: list[str]) -> list[str]:
        return [i for i in ids if R.is_on(getattr(self._st(i), "state", None))]

    def _seed_presence(self) -> None:
        ids = self.o.get("presence") or []
        on = [self._st(i) for i in self._on(ids)]
        self._raw = bool(on)
        if on:
            self._rose_at = min(s.last_changed for s in on)
            self._present = True
        elif ids:
            self._present = False

    def _presence(self, now: datetime) -> bool | None:
        ids = self.o.get("presence") or []
        if not ids:
            if self._rose_at is None:
                self._rose_at = self._started
            return True
        states = [getattr(self._st(i), "state", None) for i in ids]
        raw_on = any(R.is_on(s) for s in states)
        if not raw_on and all(R.missing(s) for s in states):
            return None
        linger = timedelta(seconds=int(self.o.get("linger") or 0))
        if raw_on:
            if not self._present:
                self._rose_at = now
            self._raw, self._off_at, self._present = True, None, True
            return True
        if self._raw:                      # just cleared
            self._raw, self._off_at = False, now
        lingering = self._off_at is not None and now - self._off_at < linger
        self._present = bool(lingering)
        return self._present

    def _last_touch(self) -> datetime | None:
        ts = [self.mgr.touch.get(self.path)]
        li = self._st(self.kiosk.get("touched"))
        if li is not None and not R.missing(li.state):
            ts.append(dt_util.parse_datetime(li.state))
        ts = [t for t in ts if t is not None]
        return max(ts) if ts else None

    def _window(self) -> int:
        from .screensaver import window_of
        return window_of(int(self.board.get("screensaver_options", {}).get("starts_after", 180)))

    def _actual(self) -> str:
        own = self._own()
        blk, act = self._st(own.get("black")), self._st(self.kiosk.get("active"))
        if (blk is not None and blk.state == "on" and blk.attributes.get("black_screen") == "hk") or \
                (act is not None and act.state == "on"):
            return "dark"
        ph = self._st(own.get("photos"))
        return "photos" if ph is not None and ph.state == "on" else "dashboard"

    def facts(self, now: datetime | None = None) -> dict[str, Any]:
        now = now or dt_util.utcnow()
        o, f = self.o, {}
        actual = self._actual()
        f["actual"] = actual
        qok = set(o.get("quiet_ok") or [])
        wake, hold = self._on(o.get("wake_for") or []), self._on(o.get("hold_while") or [])
        f["wake_q"] = [self._name(i) for i in wake if i in qok]
        f["wake"] = [self._name(i) for i in wake if i not in qok]
        f["hold_q"] = [self._name(i) for i in hold if i in qok]
        f["hold"] = [self._name(i) for i in hold if i not in qok]
        local = dt_util.as_local(now)
        f["quiet"] = bool((o.get("schedule") and R.in_window(local.time(), o["quiet_from"], o["quiet_to"]))
                          or self._on(o.get("quiet_while") or []))
        app = self._st(self.kiosk.get("app"))
        f["app_name"] = app.state if app is not None else ""
        f["app_front"] = app is not None and app.state not in KIOSK_APPS
        f["awake"] = [self._name(i) for i in self._on(o.get("awake_while") or [])]
        f["dark"] = [self._name(i) for i in self._on(o.get("dark_while") or [])]
        present = self._presence(now)
        f["present"] = present
        touch = self._last_touch()
        f["last_touch"] = touch.isoformat() if touch else None
        window = self._window()
        # IN USE: touched within the window (the page's touches, the kiosk's
        # last tap) and not dark -- a tap ends the black first, then counts;
        # or lit by the power button in quiet hours, for its minute
        use = self._st(self._own().get("in_use"))
        recent = touch is not None and (now - touch).total_seconds() < window
        hand = self._hand_at is not None and (now - self._hand_at).total_seconds() < HAND_WAKE_S
        # THE SCREENSAVER IN USE: the photos up, and the last touch one the
        # screensaver itself reported as on its own controls (the music, its
        # panel, a photo stepped). The kiosk's last tap is that same tap, a
        # moment later and by the tablet's clock (SAVER_SLOP). Somebody using
        # the photos keeps them, as somebody at the dashboard keeps it -- it
        # is not a wake (the screensaver takes itself away on any other tap).
        st = self.mgr.saver_touch.get(self.path)
        on_saver = actual == "photos" and touch is not None and st is not None \
            and touch <= st + timedelta(seconds=SAVER_SLOP)
        f["saver_use"] = bool(on_saver and recent)
        if on_saver:
            recent = False
        # ...AND ITS REPORT MAY STILL BE ON ITS WAY: a tap first seen with the
        # photos up is not yet a wake. The screensaver closes itself on any
        # tap that is not its own (its switch off: then it is the dashboard,
        # and the tap counts at once); one on its controls is answered within
        # SAVER_WAIT. (Kiosk's report of the tap came in the same second as
        # the screensaver's on the Master Bedroom, 2026-10-11, and won.)
        if touch is not None and touch != self._touch_val:
            self._touch_val, self._touch_seen = touch, now
        f["saver_wait"] = False
        if actual == "photos" and recent and self._touch_seen is not None \
                and (now - self._touch_seen).total_seconds() < SAVER_WAIT:
            f["saver_wait"] = True
            recent = False
        f["in_use"] = bool(((use is not None and use.state == "on") or recent) and actual != "dark") or hand
        lit_ids = o.get("lit") or []
        f["lit"] = (not lit_ids) or bool(self._on(lit_ids))
        if lit_ids:
            changed = [s.last_changed for s in (self._st(i) for i in lit_ids) if s is not None]
            f["touched_since_dark"] = bool(touch and changed and touch > max(changed))
        # Sleep until re-entered, and After the Screensaver
        slept, why = False, ""
        rose = self._rose_at or self._started
        for i in self._on(o.get("reset") or []):
            st = self._st(i)
            if st is not None and st.last_changed > rose:
                slept, why = True, "dark until the room is re-entered (%s)" % self._name(i)
        mins = int(o.get("after_saver") or 0)
        if mins and not slept:
            from_ = max([t for t in (touch, rose) if t is not None])
            sa = int(self.board.get("screensaver_options", {}).get("starts_after", 180))
            fire = from_ + timedelta(seconds=sa + mins * 60)
            f["after_saver_at"] = fire.isoformat()
            if now >= fire:
                slept, why = True, "the photos have run %d min untouched" % mins
        f["slept"], f["slept_why"] = slept, why
        f["notice"] = self._notice[0] if self._notice is not None and now < self._notice[1] else ""
        f["prev"] = self.want
        return f

    def _next_change(self, now: datetime) -> datetime | None:
        """The next moment the facts change by the clock alone."""
        o, cands = self.o, []
        if self._off_at is not None:
            cands.append(self._off_at + timedelta(seconds=int(o.get("linger") or 0)))
        touch = self._last_touch()
        if touch is not None:
            cands.append(touch + timedelta(seconds=self._window()))
        if self.facts_now.get("after_saver_at"):
            cands.append(dt_util.parse_datetime(self.facts_now["after_saver_at"]))
        if o.get("schedule"):
            b = R.next_boundary(dt_util.as_local(now), o["quiet_from"], o["quiet_to"])
            if b is not None:
                cands.append(dt_util.as_utc(b))
        if o.get("brightness") == "fixed" and o.get("bright_clock"):
            b = R.next_boundary(dt_util.as_local(now), o["day_from"], o["night_from"])
            if b is not None:
                cands.append(dt_util.as_utc(b))
        if self._display_on_at is not None:
            cands.append(self._display_on_at + timedelta(seconds=HAND_LIT_S))
        if self._hand_at is not None:
            cands.append(self._hand_at + timedelta(seconds=HAND_WAKE_S))
        if self._notice is not None:
            cands.append(self._notice[1])
        if self.facts_now.get("saver_wait") and self._touch_seen is not None:
            cands.append(self._touch_seen + timedelta(seconds=SAVER_WAIT))
        cands = [c + timedelta(milliseconds=200) for c in cands if c is not None and c > now]
        return min(cands) if cands else None

    # -------------------------------------------------------------- decide
    @callback
    def evaluate(self) -> None:
        if self._closed:
            return
        now = dt_util.utcnow()
        f = self.facts(now)
        self.facts_now = f
        self.actual = f["actual"]
        self.want, self.reason = R.decide(f)
        if self._timer:
            self._timer()
            self._timer = None
        nxt = self._next_change(now)
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

    def power_off_wanted(self) -> bool:
        d = self.o.get("dark_display")
        return d == "off" or (d == "off_quiet" and bool(self.facts_now.get("quiet")))

    def target(self) -> int | None:
        o = self.o
        if o.get("brightness") == "fixed":
            ids = list(o.get("day_while") or []) + list(o.get("night_while") or [])
            return R.brightness_now(o, self._on(ids), dt_util.as_local(dt_util.utcnow()).time())[0]
        if o.get("brightness") == "sensor":
            st = self._st(o.get("bright_sensor"))
            try:
                v = int(float(st.state)) if st is not None else -1
            except (TypeError, ValueError):
                v = -1
            return v if 0 <= v <= 255 else None
        return None

    # ---------------------------------------------------------------- act
    @callback
    def reconcile(self) -> None:
        if self._closed:
            return
        if self._task and not self._task.done():
            return                     # read again when it ends (_run)
        what = R.action(self.want, self.actual)
        if what is None or not self._trusted():
            return
        now = _time.monotonic()
        self._recent = [t for t in self._recent if now - t < 60]
        if len(self._recent) >= ACTIONS_PER_MIN:
            _LOG.warning("Sleep Screen %s: %d actions in a minute; waiting (want %s, actual %s: %s)",
                         self.path, len(self._recent), self.want, self.actual, self.reason)
            return
        self._recent.append(now)
        self._task = self.hass.async_create_task(self._run(what), "hk_frontend sleep %s" % self.path)

    def _trusted(self) -> bool:
        """A kiosk that is not answering is not acted on (the house's
        "the kiosk is reporting a state we can trust")."""
        if not self.kiosk:
            return True
        act, li = self._st(self.kiosk.get("active")), self._st(self.kiosk.get("touched"))
        if act is None or R.missing(act.state):
            return False
        return not (li is not None and li.state == "unavailable")

    async def _run(self, what: str) -> None:
        self.last_action = (what, dt_util.utcnow().isoformat())
        try:
            if what == "sleep":
                await self.sleep(self.power_off_wanted())
            else:
                # a notification's wake comes up to the photos, the banner over
                # them; any other, to the dashboard as ever
                await self.wake(photos=self.want == "photos" and bool(self.facts_now.get("notice")))
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
        app = self._st(self.kiosk.get("app"))
        return app is not None and app.state not in KIOSK_APPS

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

    def _attr(self, eid: str | None, key: str) -> Any:
        st = self._st(eid)
        return st.attributes.get(key) if st is not None else None

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
        """Brightness Follows Target: awake, the display; under HK's black,
        what it wakes to (never the display -- it would light behind the
        black)."""
        t = self.target()
        if t is None or (self._task and not self._task.done()):
            return
        changed, self._target = t != self._target, t
        blk = self._black()
        if blk is not None and blk.is_on and self.board.get("black_screen") == "hk":
            if changed or self._attr(blk.entity_id, "brightness") != t:
                self._spawn(blk.async_set_black_screen(brightness=t))
            return
        # only when the TARGET changes (a person may set it by hand meanwhile)
        scr = self._st(self.kiosk.get("screen"))
        if changed and self.actual != "dark" and scr is not None and scr.state == "on" and scr.attributes.get("brightness") != t:
            self._spawn(self._call("light", "turn_on", {"entity_id": scr.entity_id, "brightness": t}))

    @callback
    def _quiet_display(self, now: datetime) -> None:
        """Display Off: a dark screen whose display somebody lit and left
        (the power button, nobody following up with a tap) goes off again
        after HAND_LIT_S; and quiet hours starting while it is already dark
        turn it off (the house's Screen Off In Quiet Hours)."""
        if self.want != "dark" or self.actual != "dark" or not self.power_off_wanted():
            return
        if self._task and not self._task.done():
            return
        scr = self._st(self.kiosk.get("screen"))
        if scr is None or scr.state != "on":
            return
        lit = self._display_on_at
        if lit is not None and (now - lit).total_seconds() < HAND_LIT_S:
            return
        self._spawn(self._call("light", "turn_off", {"entity_id": scr.entity_id}))

    # --------------------------------------------------------------- report
    def attributes(self) -> dict[str, Any]:
        f = self.facts_now
        return {"decided_by": self.o.get("decided_by"), "reason": self.reason, "actual": self.actual,
                "present": f.get("present"), "in_use": f.get("in_use"), "saver_use": f.get("saver_use"), "quiet": f.get("quiet"),
                "last_saver_touch": (lambda st: st.isoformat() if st else None)(self.mgr.saver_touch.get(self.path)),
                "last_touch": f.get("last_touch"), "after_saver_at": f.get("after_saver_at"),
                "kiosk": self.kiosk.get("screen"), "target_brightness": self.target(),
                "last_action": "%s at %s" % self.last_action if self.last_action else None}
