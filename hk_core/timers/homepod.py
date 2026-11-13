"""HomePod timers and alarms (phase 28, docs/phase28/HOMEPOD-TIMERS.md), the rules with no host in them.

A reader in a macOS virtual machine drives the Home app and serves what each HomePod's sheet shows: its timers (a label and
the time left, counting down) and its alarms. Nothing it serves has an id: a timer is a row of a tile's sheet (`index`), and
the rows move when one ends. These rules make one timer the same timer from one read to the next, say when the reader can't
be believed, match a Home app room to a Mantel room, and say which calls keep a Home Assistant helper in step with a read.

* A HOMEPOD TIMER NEVER RINGS IN MANTEL: the HomePod rings itself. Its helper (``timer.hk_homepod_<n>``) is a mirror, so every
  screen, card and automation sees it as an ordinary timer; Mantel's own timers (``timer.hk_timer_<n>``) are a separate set.
* "UNAVAILABLE", NEVER "NO TIMERS": a reader that says it is broken, or hasn't answered for STALE_AFTER, is unavailable,
  and an unavailable reader's list is never taken to mean the timers ended.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

HELPER = re.compile(r"^timer\.hk_homepod_(\d+)$")
ALARM_SCRIPT = "homepod_alarm"          # script.homepod_alarm {alarm, action}: an alarm's switch and Delete, through the gateway
TIMER_ACTIONS = ("pause", "resume", "cancel")
ALARM_ACTIONS = ("on", "off", "delete")
POLL_EVERY = 2.0        # seconds between two looks at the reader
STALE_AFTER = 120.0     # seconds with no good answer: unavailable
ALERT_AFTER = 600.0     # seconds unavailable before the alert is sent
MATCH_TOL = 5.0         # seconds: two reads of one timer end this close (the sheet shows whole seconds; a read takes 1.5 s)
SYNC_TOL = 3.0          # seconds: a helper this far from the read is set right
GONE_SLACK = 5.0        # seconds: a timer gone this close to its end ended (the HomePod rang); earlier, it was canceled
MAX_HELPERS = 24
MAX_TEXT = 60


def is_helper(entity_id: str) -> bool:
    return bool(HELPER.match(entity_id or ""))


def helper_of(n: int) -> str:
    return f"timer.hk_homepod_{n}"


def number_of(entity_id: str) -> int | None:
    m = HELPER.match(entity_id or "")
    return int(m.group(1)) if m else None


def _text(value: Any, default: str = "") -> str:
    if not isinstance(value, str):
        return default
    text = "".join(c for c in " ".join(value.split()) if c.isprintable())
    return text[:MAX_TEXT].strip() or default


def _when(value: Any) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


# ---- what the reader says ------------------------------------------------------------------------------------------------
@dataclass
class Read:
    """One timer as the reader served it. ``ends`` is when it ends (running); ``left`` the seconds left at ``at``."""
    tile: str
    index: int
    label: str
    left: float
    paused: bool
    ends: float | None
    room: str
    homepod: str
    at: float

    def left_at(self, t: float) -> float:
        return max(0.0, self.ends - t) if not self.paused and self.ends is not None else self.left


@dataclass
class Alarm:
    tile: str
    index: int
    label: str
    time: str           # as the Home app shows it: "9:00 PM"
    time_24: str        # "21:00"
    enabled: bool
    repeats: str        # the Home app's repeat line, "" for a one-time alarm
    room: str
    homepod: str
    id: str = ""        # stable from read to read while it is unchanged: tile, time and label (alarm_ids)

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label, "time": self.time, "time_24": self.time_24, "enabled": self.enabled,
                "repeats": self.repeats, "home_room": self.room, "homepod": self.homepod, "tile": self.tile}


def parse_timers(doc: Any, now: float) -> tuple[bool, list[Read]] | None:
    """(broken, the timers) from /timers.json, or None when it isn't the reader's answer. ``left_s`` is counted down to the
    reader's own moment (``at``); a running timer's end is ``ends_at``, else ``at`` + ``left_s``."""
    if not isinstance(doc, Mapping) or not isinstance(doc.get("timers"), list):
        return None
    at = _when(doc.get("at")) or now
    out: list[Read] = []
    for t in doc["timers"]:
        if not isinstance(t, Mapping):
            continue
        tile, index, left = t.get("tile"), t.get("index"), _num(t.get("left_s"))
        if not isinstance(tile, str) or not tile or isinstance(index, bool) or not isinstance(index, int) or index < 0 or left is None:
            continue
        paused = t.get("paused") is True
        ends = None if paused else (_when(t.get("ends_at")) or at + left)
        out.append(Read(tile, index, _text(t.get("label"), "Timer"), max(0.0, left), paused, ends,
                        _text(t.get("room")), _text(t.get("homepod"), "HomePod"), at))
    return doc.get("broken") is True, out


def parse_alarms(doc: Any) -> tuple[bool, list[Alarm]] | None:
    if not isinstance(doc, Mapping) or not isinstance(doc.get("alarms"), list):
        return None
    out: list[Alarm] = []
    for a in doc["alarms"]:
        if not isinstance(a, Mapping):
            continue
        tile, index, t24 = a.get("tile"), a.get("index"), a.get("time_24")
        if not isinstance(tile, str) or not tile or isinstance(index, bool) or not isinstance(index, int) or index < 0:
            continue
        if not isinstance(t24, str) or not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", t24):
            continue
        out.append(Alarm(tile, index, _text(a.get("label"), "Alarm"), _text(a.get("time"), t24), t24, a.get("enabled") is True,
                         _text(a.get("repeats")), _text(a.get("room")), _text(a.get("homepod"), "HomePod")))
    return doc.get("broken") is True, alarm_ids(out)


def alarm_ids(alarms: list[Alarm]) -> list[Alarm]:
    """An alarm's id: its HomePod, time and label (and which of the same, in order). Its row's index moves when one above it
    is deleted; this doesn't, so a switch pressed on a screen reaches the alarm it showed, or none."""
    seen: dict[tuple[str, str, str], int] = {}
    for a in alarms:
        key = (a.tile, a.time_24, a.label)
        k = seen.get(key, 0)
        seen[key] = k + 1
        a.id = f"{a.tile}|{a.time_24}|{a.label}|{k}"
    return alarms


def find_alarm(alarms: Iterable[Alarm], alarm_id: Any) -> Alarm | None:
    return next((a for a in alarms if a.id == alarm_id), None) if isinstance(alarm_id, str) else None


# ---- staleness -----------------------------------------------------------------------------------------------------------
def availability(last_ok: float | None, broken: bool, started: float, now: float) -> str:
    """'ok', 'starting' (no answer yet, and not for long) or 'unavailable' (broken, or silent for STALE_AFTER)."""
    if last_ok is None:
        return "starting" if now - started <= STALE_AFTER else "unavailable"
    if broken or now - last_ok > STALE_AFTER:
        return "unavailable"
    return "ok"


def alert_due(down_since: float | None, now: float) -> bool:
    return down_since is not None and now - down_since >= ALERT_AFTER


# ---- identity from one read to the next ----------------------------------------------------------------------------------
@dataclass
class Known:
    """A HomePod timer Mantel follows, and its helper's number."""
    n: int
    tile: str
    label: str
    room: str = ""
    homepod: str = "HomePod"
    ends: float | None = None
    left: float = 0.0
    paused: bool = False
    seen: float = 0.0
    first: float = 0.0
    total: int = 0                   # its length as first seen (the Home app never says how long it was set for)
    over: str | None = None          # 'ended' or 'canceled': gone from the HomePod, its helper still to finish or go
    index: int = field(default=-1, compare=False)

    def left_at(self, t: float) -> float:
        return max(0.0, self.ends - t) if not self.paused and self.ends is not None else self.left

    def take(self, r: Read) -> None:
        self.label, self.room, self.homepod, self.index = r.label, r.room, r.homepod, r.index
        self.paused, self.left, self.seen = r.paused, r.left, r.at
        self.ends = None if r.paused else r.ends

    @property
    def entity_id(self) -> str:
        return helper_of(self.n)


def match(known: Iterable[Known], reads: Iterable[Read]) -> tuple[list[tuple[Known, Read]], list[Read], list[Known]]:
    """(the same timer, read again), (new timers), (timers gone). The same HomePod and label, ending within MATCH_TOL;
    then, for what is left on a HomePod, the same label paired in order of time left (a pause or a resume between two reads
    moves its end by however long it took). Anything else is new."""
    free = [k for k in known if k.over is None]
    rest = sorted(reads, key=lambda r: (r.tile, r.index))
    pairs: list[tuple[Known, Read]] = []
    left_over: list[Read] = []
    for r in rest:
        best, gap = None, MATCH_TOL
        for k in free:
            if k.tile != r.tile or k.label != r.label:
                continue
            d = abs(k.left_at(r.at) - r.left_at(r.at))
            if d <= gap:
                best, gap = k, d
        if best is None:
            left_over.append(r)
        else:
            free.remove(best)
            pairs.append((best, r))
    new: list[Read] = []
    groups: dict[tuple[str, str], list[Read]] = {}
    for r in left_over:
        groups.setdefault((r.tile, r.label), []).append(r)
    for (tile, label), rs in groups.items():
        ks = sorted((k for k in free if k.tile == tile and k.label == label), key=lambda k: k.left_at(rs[0].at))
        rs = sorted(rs, key=lambda r: r.left_at(r.at))
        for k, r in zip(ks, rs):
            free.remove(k)
            pairs.append((k, r))
        new.extend(rs[len(ks):])
    return pairs, new, free


def how_gone(k: Known, now: float) -> str:
    """A timer no longer on its HomePod: 'ended' (at its time: the HomePod rang; its helper finishes by itself, so
    automations hear timer.finished) or 'canceled' (before it: its helper is canceled)."""
    if not k.paused and k.ends is not None and k.ends <= now + GONE_SLACK:
        return "ended"
    return "canceled"


def next_number(taken: Iterable[int]) -> int:
    used, n = set(taken), 1
    while n in used:
        n += 1
    return n


# ---- keeping a helper in step --------------------------------------------------------------------------------------------
def hms(secs: float, signed: bool = False) -> str:
    s = int(round(secs))
    sign = "-" if s < 0 else ""
    s = abs(s)
    return (sign if signed else "") + f"{s // 3600:02d}:{s // 60 % 60:02d}:{s % 60:02d}"


def secs(value: Any) -> float | None:
    """Home Assistant's H:MM:SS (a timer's duration and remaining), as seconds."""
    if not isinstance(value, str) or not re.match(r"^\d+:\d{2}:\d{2}$", value.strip()):
        return None
    h, m, s = (int(p) for p in value.strip().split(":"))
    return float(h * 3600 + m * 60 + s)


def helper_now(state: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """A helper's state as the steps read it: {s, ends, remaining, duration}, or None when it isn't there."""
    if not state:
        return None
    a = state.get("a") or {}
    return {"s": state.get("s"), "ends": _when(a.get("finishes_at")), "remaining": secs(a.get("remaining")),
            "duration": secs(a.get("duration"))}


def _adjust(have: float, want: float, duration: float | None) -> list[tuple[str, dict[str, Any]]]:
    """Move a running helper's end: timer.change, which keeps its length (the bar on every card), when it stays within it;
    else a restart at what is left (Home Assistant refuses a change beyond the length)."""
    delta = round(want - have)
    if duration is not None and want <= duration and delta:
        return [("change", {"duration": hms(delta, signed=True)})]
    return [("start", {"duration": hms(want)})]


def steps(helper: Mapping[str, Any] | None, k: Known, now: float) -> list[tuple[str, dict[str, Any]]]:
    """The timer services that bring a helper in line with the HomePod: [(service, data)], nothing when it already is.
    A timer at its end is left alone: Home Assistant finishes it."""
    want = k.left_at(now)
    if not k.paused and want <= 1:
        return []
    if helper is None or helper.get("s") not in ("active", "paused"):
        out = [("start", {"duration": hms(want)})]
        return out + [("pause", {})] if k.paused else out
    if helper["s"] == "active":
        have = max(0.0, (helper.get("ends") or now) - now)
        out = _adjust(have, want, helper.get("duration")) if abs(have - want) > SYNC_TOL else []
        return out + [("pause", {})] if k.paused else out
    have = helper.get("remaining") or 0.0          # paused
    if k.paused:
        return [("start", {"duration": hms(want)}), ("pause", {})] if abs(have - want) > SYNC_TOL else []
    resume: list[tuple[str, dict[str, Any]]] = [("start", {})]    # resume: it runs from what it had left
    return resume + _adjust(have, want, helper.get("duration")) if abs(have - want) > SYNC_TOL else resume


# ---- rooms ---------------------------------------------------------------------------------------------------------------
def norm(name: Any) -> str:
    text = unicodedata.normalize("NFKC", name if isinstance(name, str) else "")
    text = text.replace("’", "'").replace("‘", "'").replace("ʼ", "'")
    return " ".join(text.casefold().split())


def room_for(home_room: str, areas: Mapping[str, str], chosen: Mapping[str, Any] | None = None) -> tuple[str | None, str]:
    """(the Mantel room, how it was found) for a Home app room: 'chosen' in Settings > Timers, 'name' (the same name, the
    apostrophes and case aside), or 'none' (Settings asks which room it is)."""
    picks = {norm(k): v for k, v in (chosen or {}).items() if isinstance(k, str)}
    pick = picks.get(norm(home_room))
    if isinstance(pick, str) and pick in areas:
        return pick, "chosen"
    want = norm(home_room)
    if not want:
        return None, "none"
    for aid, name in areas.items():
        if norm(name) == want:
            return aid, "name"
    flat = want.replace("'", "")
    for aid, name in areas.items():
        if norm(name).replace("'", "") == flat:
            return aid, "name"
    return None, "none"


def room_table(home_rooms: Iterable[str], areas: Mapping[str, str], chosen: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
    """Settings > Timers' room matching: one row per Home app room the reader has seen."""
    out = []
    for home in sorted({r for r in home_rooms if r}, key=norm):
        area, how = room_for(home, areas, chosen)
        out.append({"home": home, "area": area, "area_name": areas.get(area) if area else None, "how": how})
    return out


def clean_rooms(value: Any, areas: Mapping[str, str]) -> dict[str, str]:
    """Settings' `homepod_rooms` as saved: a Home app room's name -> one of the house's rooms."""
    if not isinstance(value, Mapping):
        return {}
    return {_text(k): v for k, v in value.items() if isinstance(k, str) and _text(k) and isinstance(v, str) and v in areas}


# ---- alarms --------------------------------------------------------------------------------------------------------------
DAYS = {"mon": 0, "monday": 0, "tue": 1, "tues": 1, "tuesday": 1, "wed": 2, "wednesday": 2, "thu": 3, "thur": 3, "thurs": 3,
        "thursday": 3, "fri": 4, "friday": 4, "sat": 5, "saturday": 5, "sun": 6, "sunday": 6}


def repeat_days(text: str) -> frozenset[int] | None:
    """The weekdays (Monday 0) an alarm repeats on, from the Home app's repeat line; None for a one-time alarm. A line it
    can't read counts as every day: the alarm is still shown, and its next time is the soonest it could be."""
    t = norm(text)
    if not t or t in ("never", "once"):
        return None
    if "every day" in t or "daily" in t or "everyday" in t:
        return frozenset(range(7))
    if "weekday" in t:
        return frozenset(range(5))
    if "weekend" in t:
        return frozenset((5, 6))
    days = {DAYS[w] for w in re.split(r"[^a-z]+", t) if w in DAYS}
    return frozenset(days) if days else frozenset(range(7))


def next_ring(a: Alarm, now: datetime) -> datetime | None:
    """When an alarm next goes off, in ``now``'s zone; None when it is off."""
    if not a.enabled:
        return None
    h, m = (int(p) for p in a.time_24.split(":"))
    days = repeat_days(a.repeats)
    for ahead in range(8):
        day = now + timedelta(days=ahead)
        at = day.replace(hour=h, minute=m, second=0, microsecond=0)
        if at <= now or (days is not None and at.weekday() not in days):
            continue
        return at
    return None


def next_alarms(alarms: Iterable[Alarm], now: datetime) -> dict[str, tuple[Alarm, datetime] | None]:
    """Each HomePod's (tile's) next alarm and when, for its sensor in Home Assistant; None for a HomePod with none on."""
    out: dict[str, tuple[Alarm, datetime] | None] = {}
    for a in alarms:
        out.setdefault(a.tile, None)
        at = next_ring(a, now)
        if at is not None and (out[a.tile] is None or at < out[a.tile][1]):  # type: ignore[index]
            out[a.tile] = (a, at)
    return out


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", norm(text).replace("'", "")).strip("_")
    return s or "homepod"


WENT_OFF_WITHIN = 180.0   # seconds after its time: a one-time alarm that turned off then went off


def went_off(before: Iterable[Alarm], after: Iterable[Alarm], now: datetime) -> list[Alarm]:
    """One-time alarms that flipped from on to off at their time: the Home app shows a ringing alarm as nothing, and a
    one-time alarm turns itself off the moment it fires, so this is all Mantel can know (it can say so, not stop it).
    One turned off by hand at another time isn't one."""
    was = {a.id: a for a in before}
    out = []
    for a in after:
        if a.enabled or a.repeats or a.id not in was or not was[a.id].enabled:
            continue
        h, m = (int(p) for p in a.time_24.split(":"))
        at = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if at > now:
            at -= timedelta(days=1)
        if (now - at).total_seconds() <= WENT_OFF_WITHIN:
            out.append(a)
    return out
