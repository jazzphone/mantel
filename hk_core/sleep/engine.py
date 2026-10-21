"""Sleep Screen's engine, its DECISIONS: one screen's memory and what it makes of the moment.

`Sleep` gathers the moment's facts through the House (rules.decide()'s `f`), remembers what
only time can tell (presence lingering after the room clears, the power button's minute, a
notification's while, a tap the screensaver may still claim), says when the facts next change
by the clock alone, what the screen shows now, the brightness it should have, and when a
loop must wait. The clock is the host's (`clock`: an aware datetime, now), so a host's frozen
test clock rules here too.

What it does NOT do is the host's: following the entities (`listens()` says which), the
timers (`decide()` returns the next moment), the screen's own entities and their touches
(`_own`, `_page_touch`, `_saver_touch`: a host overrides them), and the sleep and the wake
themselves -- service calls with waits between them, in the host's own vocabulary (inside
Home Assistant, sleep_engine.py's Engine, which is a Sleep).
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import Any

from ..house import House, State
from ..screensaver.rules import window_of
from . import rules as R

# the kiosk's apps that are not "another app": Kiosk Satellite itself, and
# the home screens it replaces on a wake (the house's KIOSK list)
KIOSK_APPS = ("me.jxl.kiosk_satellite", "com.sec.android.app.launcher", "com.google.android.apps.nexuslauncher",
              "none", "", "unknown", "unavailable")
# a Kiosk Satellite device's entities, by the end of their ids
KIOSK_PARTS = {"screen": ("light", "_screen"), "active": ("switch", "_screensaver_active"),
               "armed": ("switch", "_screensaver"), "mode": ("select", "_screensaver_mode"),
               "app": ("sensor", "_foreground_app"), "touched": ("sensor", "_last_interaction"),
               "front": ("button", "_bring_to_front")}
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
STARTS_AFTER = 180        # s: Starts After when the board does not say


def kiosks(house: House) -> list[dict[str, str]]:
    """The Kiosk Satellite devices: [{id, name}] (their foreground app and
    screensaver switch say what they are)."""
    by_dev: dict[str, set[str]] = {}
    for e in house.entities():
        if e.device_id:
            by_dev.setdefault(e.device_id, set()).add(e.entity_id)
    out = []
    for dev_id, ids in by_dev.items():
        if any(i.endswith("_foreground_app") for i in ids) and any(i.endswith("_screensaver_active") for i in ids):
            d = house.device(dev_id)
            if d:
                out.append({"id": dev_id, "name": d.name or dev_id})
    return sorted(out, key=lambda k: k["name"].lower())


def kiosk_parts(house: House, device_id: str) -> dict[str, str]:
    """{part: entity id} of a Kiosk Satellite device (KIOSK_PARTS), its enabled entities."""
    if not device_id:
        return {}
    ids = [e.entity_id for e in house.device_entities(device_id) if not e.disabled]
    out: dict[str, str] = {}
    for part, (domain, end) in KIOSK_PARTS.items():
        hits = [i for i in ids if i.startswith(domain + ".") and i.endswith(end)]
        if part == "armed":       # _screensaver, not _screensaver_active / _brightness
            hits = [i for i in hits if i.endswith("_screensaver")]
        if hits:
            out[part] = sorted(hits, key=len)[0]
    return out


def room_to_act(recent: list[float], now: float, per_min: int = ACTIONS_PER_MIN) -> tuple[bool, list[float]]:
    """ONE LOOP GUARD: `recent`, the moments (s, any steady clock) of the actions so far, kept
    to the last minute; True while fewer than `per_min` -- more and the engine waits."""
    recent = [t for t in recent if now - t < 60]
    return len(recent) < per_min, recent


def parse_time(text: str | None) -> datetime | None:
    """An ISO 8601 moment, or None (a host may hand in its own, more forgiving parser)."""
    with suppress(TypeError, ValueError):
        return datetime.fromisoformat(text)
    return None


def by_hand(parent_id: Any, user_id: Any) -> bool:
    """A change nobody asked for through the house (no parent, no user): the tablet's own --
    the power button."""
    return parent_id is None and user_id is None


class Sleep:
    """One screen's Sleep Screen: its memory and its decisions."""

    def __init__(self, house: House, path: str, clock: Callable[[], datetime],
                 parse: Callable[[str], datetime | None] | None = None) -> None:
        self.house, self.path, self.clock = house, path, clock
        self.parse = parse or parse_time
        self.o: dict[str, Any] = {}
        self.board: dict[str, Any] = {}
        self.kiosk: dict[str, str] = {}
        self.want, self.reason, self.actual = "hold", "starting", "dashboard"
        self.facts_now: dict[str, Any] = {}
        # presence memory: raw (any sensor on), when it last cleared, when
        # the room last became occupied
        self._raw = False
        self._off_at: datetime | None = None
        self._rose_at: datetime | None = None
        self._present: bool | None = None
        self._started = clock()
        self._target: int | None = None
        self._display_on_at: datetime | None = None
        self._hand_at: datetime | None = None
        # a notification set to Wake the Screen (features/notifications): the
        # dashboard until then, whatever else holds -- quiet hours too
        self._notice: tuple[str, datetime] | None = None
        # the last touch seen, and when it was first seen (SAVER_WAIT)
        self._touch_val: datetime | None = None
        self._touch_seen: datetime | None = None

    # ---------------------------------------------------- the host's part
    def _own(self) -> dict[str, str]:
        """The screen's own entities by role ("photos", "black", "in_use"): the host's."""
        return {}

    def _page_touch(self) -> datetime | None:
        """The page's last touch (the host hears it)."""
        return None

    def _saver_touch(self) -> datetime | None:
        """The screensaver's last touch on its own controls (the host hears it)."""
        return None

    def _saver_wait(self) -> float:
        return SAVER_WAIT

    # ------------------------------------------------------------ settings
    def options(self, board: dict[str, Any]) -> None:
        """What the screen's board says: its Sleep Screen over the defaults, and its kiosk's parts."""
        self.board = board
        self.o = R.sleep_options(board.get("sleep")) or R.sleep_options(None)
        self.kiosk = kiosk_parts(self.house, self.o.get("kiosk") or "")

    @property
    def acting(self) -> bool:
        return self.o.get("decided_by") == "hk"

    def listens(self) -> list[str]:
        """Every entity the facts are read from: the host follows each."""
        ids = set(R.inputs(self.o)) | set(self.kiosk.values()) | set(self._own().values())
        ids.discard("")
        return sorted(ids)

    # -------------------------------------------------------------- events
    def display_changed(self, eid: str | None, old: str | None, new: str | None, hand: bool) -> None:
        """An entity followed changed (`old`/`new`: its states, None when it has none; `hand`:
        no person or automation asked for it -- by_hand()). THE POWER BUTTON IN QUIET HOURS: the
        display lit by the tablet itself is a touch -- it lights onto the black, which looks
        off, and the house wakes it to the dashboard."""
        screen = self.kiosk.get("screen")
        if eid and eid == screen and new is not None and old is not None and old == "off" and new == "on":
            if hand and self.facts_now.get("quiet"):
                self._hand_at = self.clock()
        if eid and eid == screen and new is not None:
            if new == "on" and (old is None or old != "on"):
                self._display_on_at = self.clock()

    def notify_wake(self, title: str, seconds: int) -> None:
        """A notification wakes this screen: up to its photos for `seconds`
        (then the rules again; somebody using it keeps it, as ever)."""
        self._notice = (str(title or "a notification"), self.clock() + timedelta(seconds=max(1, int(seconds))))

    # --------------------------------------------------------------- facts
    def _st(self, eid: str | None) -> State | None:
        return self.house.state(eid) if eid else None

    def _name(self, eid: str) -> str:
        st = self._st(eid)
        return (st.attributes.get("friendly_name") if st else None) or eid

    def _on(self, ids: list[str]) -> list[str]:
        return [i for i in ids if R.is_on(getattr(self._st(i), "state", None))]

    def _attr(self, eid: str | None, key: str) -> Any:
        st = self._st(eid)
        return st.attributes.get(key) if st is not None else None

    def seed_presence(self) -> None:
        """Presence as the house has it now (a sensor on since when)."""
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
        ts = [self._page_touch()]
        li = self._st(self.kiosk.get("touched"))
        if li is not None and not R.missing(li.state):
            ts.append(self.parse(li.state))
        ts = [t for t in ts if t is not None]
        return max(ts) if ts else None

    def _starts_after(self) -> int:
        return int(self.board.get("screensaver_options", {}).get("starts_after", STARTS_AFTER))

    def _window(self) -> int:
        return window_of(self._starts_after())

    def _actual(self) -> str:
        own = self._own()
        blk, act = self._st(own.get("black")), self._st(self.kiosk.get("active"))
        if (blk is not None and blk.state == "on" and blk.attributes.get("black_screen") == "hk") or \
                (act is not None and act.state == "on"):
            return "dark"
        ph = self._st(own.get("photos"))
        return "photos" if ph is not None and ph.state == "on" else "dashboard"

    def awake_also(self) -> list[str]:
        """Keep Awake While's reasons the host knows itself, beside the screen's own entities: names, as the
        decision says them (Mantel: "Live TV" while this tablet plays it -- features.MantelSleep)."""
        return []

    def facts(self, now: datetime | None = None) -> dict[str, Any]:
        """The moment's facts (rules.decide()'s `f`)."""
        now = now or self.clock()
        o, f = self.o, {}
        actual = self._actual()
        f["actual"] = actual
        qok = set(o.get("quiet_ok") or [])
        wake, hold = self._on(o.get("wake_for") or []), self._on(o.get("hold_while") or [])
        f["wake_q"] = [self._name(i) for i in wake if i in qok]
        f["wake"] = [self._name(i) for i in wake if i not in qok]
        f["hold_q"] = [self._name(i) for i in hold if i in qok]
        f["hold"] = [self._name(i) for i in hold if i not in qok]
        local = self.house.local_time(now)
        f["quiet"] = bool((o.get("schedule") and R.in_window(local.time(), o["quiet_from"], o["quiet_to"]))
                          or self._on(o.get("quiet_while") or []))
        app = self._st(self.kiosk.get("app"))
        f["app_name"] = app.state if app is not None else ""
        f["app_front"] = app is not None and app.state not in KIOSK_APPS
        f["awake"] = [self._name(i) for i in self._on(o.get("awake_while") or [])] + list(self.awake_also())
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
        st = self._saver_touch()
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
                and (now - self._touch_seen).total_seconds() < self._saver_wait():
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
            fire = from_ + timedelta(seconds=self._starts_after() + mins * 60)
            f["after_saver_at"] = fire.isoformat()
            if now >= fire:
                slept, why = True, "the photos have run %d min untouched" % mins
        f["slept"], f["slept_why"] = slept, why
        f["notice"] = self._notice[0] if self._notice is not None and now < self._notice[1] else ""
        f["prev"] = self.want
        return f

    def _utc(self, local: datetime) -> datetime:
        return local.astimezone(timezone.utc)

    def _next_change(self, now: datetime) -> datetime | None:
        """The next moment the facts change by the clock alone."""
        o, cands = self.o, []
        if self._off_at is not None:
            cands.append(self._off_at + timedelta(seconds=int(o.get("linger") or 0)))
        touch = self._last_touch()
        if touch is not None:
            cands.append(touch + timedelta(seconds=self._window()))
        if self.facts_now.get("after_saver_at"):
            cands.append(self.parse(self.facts_now["after_saver_at"]))
        if o.get("schedule"):
            b = R.next_boundary(self.house.local_time(now), o["quiet_from"], o["quiet_to"])
            if b is not None:
                cands.append(self._utc(b))
        if o.get("brightness") == "fixed" and o.get("bright_clock"):
            b = R.next_boundary(self.house.local_time(now), o["day_from"], o["night_from"])
            if b is not None:
                cands.append(self._utc(b))
        if self._display_on_at is not None:
            cands.append(self._display_on_at + timedelta(seconds=HAND_LIT_S))
        if self._hand_at is not None:
            cands.append(self._hand_at + timedelta(seconds=HAND_WAKE_S))
        if self._notice is not None:
            cands.append(self._notice[1])
        if self.facts_now.get("saver_wait") and self._touch_seen is not None:
            cands.append(self._touch_seen + timedelta(seconds=self._saver_wait()))
        cands = [c + timedelta(milliseconds=200) for c in cands if c is not None and c > now]
        return min(cands) if cands else None

    # -------------------------------------------------------------- decide
    def decide(self, now: datetime) -> datetime | None:
        """What the screen should show now (`want`, `reason`; `actual`, `facts_now`), and the
        next moment to ask again (None: only when something followed changes)."""
        f = self.facts(now)
        self.facts_now = f
        self.actual = f["actual"]
        self.want, self.reason = R.decide(f)
        return self._next_change(now)

    def action(self) -> str | None:
        """What to do about it: "sleep", "wake" or None (rules.action())."""
        return R.action(self.want, self.actual)

    def wakes_to_photos(self) -> bool:
        """A notification's wake comes up to the photos, the banner over them; any other, to
        the dashboard as ever."""
        return self.want == "photos" and bool(self.facts_now.get("notice"))

    def power_off_wanted(self) -> bool:
        d = self.o.get("dark_display")
        return d == "off" or (d == "off_quiet" and bool(self.facts_now.get("quiet")))

    def target(self) -> int | None:
        """The brightness the display should have now (0-255), or None (left alone)."""
        o = self.o
        if o.get("brightness") == "fixed":
            ids = list(o.get("day_while") or []) + list(o.get("night_while") or [])
            return R.brightness_now(o, self._on(ids), self.house.local_time(self.clock()).time())[0]
        if o.get("brightness") == "sensor":
            st = self._st(o.get("bright_sensor"))
            try:
                v = int(float(st.state)) if st is not None else -1
            except (TypeError, ValueError):
                v = -1
            return v if 0 <= v <= 255 else None
        return None

    def trusted(self) -> bool:
        """A kiosk that is not answering is not acted on (the house's
        "the kiosk is reporting a state we can trust")."""
        if not self.kiosk:
            return True
        act, li = self._st(self.kiosk.get("active")), self._st(self.kiosk.get("touched"))
        if act is None or R.missing(act.state):
            return False
        return not (li is not None and li.state == "unavailable")

    def app_front(self) -> bool:
        """Another app is in front of the kiosk: neither a sleep nor a wake touches it."""
        app = self._st(self.kiosk.get("app"))
        return app is not None and app.state not in KIOSK_APPS

    # ------------------------------------------------------ the brightness
    def brightness_step(self, black: tuple[str | None, bool] | None) -> tuple[str, str | None, int] | None:
        """Brightness Follows Target: awake, the display; under HK's black,
        what it wakes to (never the display -- it would light behind the
        black). `black`: the screen's black switch (its entity id, whether it is on), None
        without one. ("black", its id, level): set the black's brightness; ("display", the
        kiosk's screen, level): light the display at that level; None: nothing. Call it only
        while no sleep or wake is running."""
        t = self.target()
        if t is None:
            return None
        changed, self._target = t != self._target, t
        if black is not None and black[1] and self.board.get("black_screen") == "hk":
            if changed or self._attr(black[0], "brightness") != t:
                return "black", black[0], t
            return None
        # only when the TARGET changes (a person may set it by hand meanwhile)
        scr = self._st(self.kiosk.get("screen"))
        if changed and self.actual != "dark" and scr is not None and scr.state == "on" \
                and scr.attributes.get("brightness") != t:
            return "display", scr.entity_id, t
        return None

    def quiet_display_off(self, now: datetime) -> str | None:
        """Display Off: a dark screen whose display somebody lit and left
        (the power button, nobody following up with a tap) goes off again
        after HAND_LIT_S; and quiet hours starting while it is already dark
        turn it off (the house's Screen Off In Quiet Hours). The display to turn off, or
        None. Call it only while no sleep or wake is running."""
        if self.want != "dark" or self.actual != "dark" or not self.power_off_wanted():
            return None
        scr = self._st(self.kiosk.get("screen"))
        if scr is None or scr.state != "on":
            return None
        lit = self._display_on_at
        if lit is not None and (now - lit).total_seconds() < HAND_LIT_S:
            return None
        return scr.entity_id

    # --------------------------------------------------------------- report
    def attributes(self, last_action: tuple[str, str] | None = None) -> dict[str, Any]:
        f = self.facts_now
        st = self._saver_touch()
        return {"decided_by": self.o.get("decided_by"), "reason": self.reason, "actual": self.actual,
                "present": f.get("present"), "in_use": f.get("in_use"), "saver_use": f.get("saver_use"), "quiet": f.get("quiet"),
                "last_saver_touch": st.isoformat() if st else None,
                "last_touch": f.get("last_touch"), "after_saver_at": f.get("after_saver_at"),
                "kiosk": self.kiosk.get("screen"), "target_brightness": self.target(),
                "last_action": "%s at %s" % last_action if last_action else None}
