"""THE MORNING DIGEST'S WORDS, without a host (hk_core; tested on its own):

    lines(rows, start=, end=, now_states=, local_time=, ...)   {"title", "lines", "quiet"}

Fixed templates, no language model (docs/phase19/HOUSE-TIMELINE.md "The morning digest"). The host decides WHICH rows
a version may see (the house version for the alert channels sees house facts only; a person's own sees what their
roles allow) and passes only those; this turns them into short lines. A quiet night is one line, so silence never
means "it broke" (decision 12).

``rows`` are the table's rows as dicts (``family``, ``kind``, ``title``, ``entity``, ``at``, ``ended``, ``detail``).
A row's label (the lock's or camera's name) is read from its title, which was written with the label then; for the
doors and locks the house has now, ``now_states`` ({entity: (state, label, family)}) gives the current name and the
state it is in. ``start_states`` ({lock entity: state or None}) is each lock's state when the window began.

Not in the digest, on purpose: motion on a camera with no smart detection (noise), pictures, who did anything, and
(unless ``names``) arrivals; System and Refused rows only when ``system``.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from datetime import datetime

from . import words

MAX_LINES = 8
MAX_EVENTS = 4                      # events of one door, lock or alarm named before "and N more"
_GONE = (None, "", "unavailable", "unknown")
_TOGGLE_FAMILIES = ("garage", "door", "window")
_QUIET_WORD = {"overnight": "night", "today": "day"}
_WHOLE_TIME = {"overnight": "all night", "today": "all day"}


# -- small words -------------------------------------------------------------------------------------------------------
def clock(t: datetime) -> str:
    """6:12 AM (no platform's strftime: ``%-I`` isn't everywhere)."""
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def hour(t: datetime) -> str:
    """9 PM when it's on the hour, else 9:15 PM."""
    return f"{t.hour % 12 or 12} {'AM' if t.hour < 12 else 'PM'}" if t.minute == 0 else clock(t)


def span(a: datetime, b: datetime) -> str:
    """1:10 to 1:25 AM; 11:50 PM to 12:05 AM."""
    ta, tb = clock(a), clock(b)
    if (a.hour < 12) == (b.hour < 12):
        return f"{ta.rsplit(' ', 1)[0]} to {tb}"
    return f"{ta} to {tb}"


def join(items: list[str]) -> str:
    """"A", "A and B", "A, B, and C"."""
    if len(items) <= 1:
        return "".join(items)
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])}, and {items[-1]}"


def plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _strip_end(text: str, tail: str) -> str:
    return text[:-len(tail)] if tail and text.endswith(tail) else text


def _label(row: Mapping, now_states: Mapping) -> str:
    """The name a row speaks of: the house's current name for its entity, else the one its title was written with."""
    entity = row.get("entity")
    got = now_states.get(entity) if entity else None
    if got is not None and got[1]:
        return str(got[1])
    title = str(row.get("title") or "").strip()
    kind = str(row.get("kind") or "")
    family = row.get("family")
    if kind == "flapping":
        return title.split(" keeps changing", 1)[0]
    if family in ("door", "window", "garage", "lock"):
        if title.endswith(" is jammed"):
            return _strip_end(title, " is jammed")
        return _strip_end(title, f" {kind}")
    if family in ("detection", "motion", "safety") and " at " in title:
        return title.split(" at ", 1)[1]
    if family == "doorbell":
        return title.removeprefix("Someone rang ")
    if family == "alarm":
        tail = words._ALARM.get(kind)
        return _strip_end(title, f" {tail}") if tail else title
    if family == "arrival":
        return _strip_end(_strip_end(title, " home"), f" {kind}")
    return title


def bad(family: str, state: str | None) -> str | None:
    """How a lock, a garage door or a door is wrong right now: "open", "unlocked", "jammed"; None when it's as it
    should be, or unknown (unavailable) or on its way (locking, closing)."""
    if state in _GONE:
        return None
    if family == "lock":
        if state in ("locked", "locking"):
            return None
        return "jammed" if state == "jammed" else "unlocked"
    if family == "garage":
        return "open" if state in ("open", "opening") else None
    if family in ("door", "window"):
        return "open" if state == "on" else None
    return None


# -- the lines ---------------------------------------------------------------------------------------------------------
def lines(rows: Iterable[Mapping], *, start: float, end: float, now_states: Mapping[str, tuple],
          local_time: Callable[[float], datetime], names: bool = False, system: bool = False,
          start_states: Mapping[str, str | None] | None = None, label: str = "Overnight") -> dict:
    """The digest for [start, end): ``{"title": "Overnight at the house (9 PM to 7 AM)", "lines": [...],
    "quiet": bool}``. ``names``: arrivals ("Emma arrived home 11:40 PM") are in; ``system``: System and Refused rows
    are in. Both only for a version that may say them."""
    start_states = start_states or {}
    key = label.lower()
    rows = sorted((r for r in rows if start <= float(r.get("at") or 0) < end),
                  key=lambda r: (float(r.get("at") or 0), r.get("id") or 0))
    at = lambda t: clock(local_time(float(t)))                       # noqa: E731
    by_family: dict[str, list[Mapping]] = {}
    for r in rows:
        by_family.setdefault(str(r.get("family")), []).append(r)

    # what is wrong right now leads the list
    open_now: list[str] = []
    unlocked_now: list[str] = []
    jammed_now: list[str] = []
    for entity, (state, name, family) in now_states.items():
        problem = bad(family, state)
        if problem == "open":
            open_now.append(name)
        elif problem == "unlocked":
            unlocked_now.append(name)
        elif problem == "jammed":
            jammed_now.append(name)
    leads = []
    if open_now:
        leads.append(f"{join(open_now)} {'is' if len(open_now) == 1 else 'are'} still open.")
    if unlocked_now:
        leads.append(f"{join(unlocked_now)} {'is' if len(unlocked_now) == 1 else 'are'} unlocked.")
    if jammed_now:
        leads.append(f"{join(jammed_now)} {'is' if len(jammed_now) == 1 else 'are'} jammed.")

    body: list[str] = []

    # locks: locked all night, or what they did
    lock_rows: dict[str, list[Mapping]] = {}
    for r in by_family.get("lock", []):
        if str(r.get("entity") or "").startswith("valve."):
            continue                                                  # a water valve is a toggle (below)
        lock_rows.setdefault(str(r.get("entity")), []).append(r)
    lock_entities = {e: v for e, v in now_states.items() if v[2] == "lock"}
    steady: list[str] = []
    for entity in list(lock_entities) + [e for e in lock_rows if e not in lock_entities]:
        evs = lock_rows.get(entity, [])
        got = lock_entities.get(entity)
        name = got[1] if got else _label(evs[0], now_states)
        before = start_states.get(entity)
        locked_at_start = before == "locked" or (before is None and not evs)
        if got is not None and got[0] == "locked" and locked_at_start and not evs:
            steady.append(name)
        elif evs:
            parts = [str(r.get("kind")) + " " + at(r["at"]) for r in evs]
            body.append(f"{name} {_events(parts)}.")
    steady_line = None
    if steady:
        whole = _WHOLE_TIME.get(key, "the whole time")
        steady_line = (f"All {len(steady)} locks locked {whole}." if len(steady) >= 5
                       else f"{join(steady)} locked {whole}.")

    # garage, doors, windows (and a valve): opened, closed
    toggles: dict[str, list[Mapping]] = {}
    for family in _TOGGLE_FAMILIES:
        for r in by_family.get(family, []):
            toggles.setdefault(str(r.get("entity")), []).append(r)
    for r in by_family.get("lock", []):
        if str(r.get("entity") or "").startswith("valve."):
            toggles.setdefault(str(r.get("entity")), []).append(r)
    for entity, evs in toggles.items():
        parts = []
        for r in evs:
            kind = str(r.get("kind"))
            if kind == "flapping":
                n = (r.get("detail") or {}).get("count")
                parts.append(f"changed {n} times from {at(r['at'])}" if n else f"kept changing from {at(r['at'])}")
            else:
                parts.append(f"{kind} {at(r['at'])}")
        body.append(f"{_label(evs[0], now_states)} {_events(parts)}.")

    # what the cameras saw
    detections = by_family.get("detection", [])
    packages: dict[str, int] = {}
    seen: dict[str, dict[str, int]] = {}
    for r in detections:
        cam = _label(r, now_states) or str(r.get("entity"))
        if r.get("kind") == "package":
            packages[cam] = packages.get(cam, 0) + 1            # one row is one delivery (30-minute rollup)
        elif r.get("kind") in ("person", "vehicle", "animal"):
            kinds = seen.setdefault(cam, {})
            kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    if packages:
        total = sum(packages.values())
        if len(packages) == 1:
            cam = next(iter(packages))
            body.append(f"{plural(total, 'package delivery', 'package deliveries')} at {cam}.")
        else:
            where = join([f"{n} at {cam}" for cam, n in packages.items()])
            body.append(f"{plural(total, 'package delivery', 'package deliveries')}: {where}.")
    rings: dict[str, int] = {}
    for r in by_family.get("doorbell", []):
        cam = _label(r, now_states)
        rings[cam] = rings.get(cam, 0) + 1
    for cam, n in rings.items():
        body.append("Someone rang " + (f"{cam}." if n == 1 else f"{cam} {n} times."))
    for cam, kinds in seen.items():
        parts = [plural(kinds[k], one, many) for k, one, many in
                 (("person", "person", "people"), ("vehicle", "vehicle", "vehicles"),
                  ("animal", "animal", "animals")) if kinds.get(k)]
        body.append(f"{join(parts)} at {cam}.")

    # the alarm
    panels: dict[str, list[str]] = {}
    for r in by_family.get("alarm", []):
        word = "armed" if str(r.get("kind")).startswith("armed") else str(r.get("kind"))
        parts = panels.setdefault(_label(r, now_states) or "Alarm", [])
        if parts and parts[-1].split(" ", 1)[0] == word:
            continue                                                  # armed home, then armed night: one "armed"
        parts.append(f"{word} {at(r['at'])}")
    for name, parts in panels.items():
        body.append(f"{name} {_events(parts)}.")

    # arrivals: only a version that may say who
    if names:
        people: dict[str, list[str]] = {}
        for r in by_family.get("arrival", []):
            if r.get("kind") in ("arrived", "left"):
                people.setdefault(_label(r, now_states), []).append(f"{r['kind']} home {at(r['at'])}")
        for name, parts in people.items():
            body.append(f"{name} {join(parts)}.")

    # a leak, smoke
    alarms = [r for r in by_family.get("safety", []) if r.get("kind") != "clear"]
    for r in alarms[:3]:
        body.append(f"{str(r.get('title') or '').strip()}, {at(r['at'])}.")
    if len(alarms) > 3:
        body.append(f"And {len(alarms) - 3} more safety alerts.")

    # Mantel's own alerts and refused commands: only a version that may see them
    if system:
        cleared = [r for r in by_family.get("system", []) if r.get("kind") == "cleared"]
        shown: list[str] = []
        total = 0
        for r in by_family.get("system", []):
            if r.get("kind") != "raised" or r.get("level") != "warning":
                continue
            total += 1
            d = r.get("detail") or {}
            back = next((c for c in cleared if c["at"] >= r["at"] and (c.get("detail") or {}).get("alert") ==
                         d.get("alert") and (c.get("detail") or {}).get("key") == d.get("key")), None)
            if back is not None:
                cleared.remove(back)
            what = str(r.get("title") or "").replace(" is ", " ", 1)
            when = span(local_time(float(r["at"])), local_time(float(back["at"]))) if back else at(r["at"])
            shown.append(f"{what} {when}")
        if total:
            more = f"; and {total - 2} more" if total > 2 else ""
            body.append(f"{plural(total, 'alert', 'alerts')}: {'; '.join(shown[:2])}{more}.")
        refused = by_family.get("refused", [])
        if len(refused) == 1:
            body.append(f"1 refused command: {str(refused[0].get('title') or '').strip()}, {at(refused[0]['at'])}.")
        elif refused:
            body.append(f"{len(refused)} refused commands, the first at {at(refused[0]['at'])}.")

    # right now: only what is as it should be (what isn't led the list)
    right: list[str] = []
    locks = [v for v in now_states.values() if v[2] == "lock" and v[0] not in _GONE]
    garages = [v for v in now_states.values() if v[2] == "garage" and v[0] not in _GONE]
    doors = [v for v in now_states.values() if v[2] == "door" and v[0] not in _GONE]
    if locks and all(bad("lock", v[0]) is None for v in locks):
        right.append("all locks locked" if len(locks) > 1 else f"{locks[0][1]} locked")
    if garages and all(bad("garage", v[0]) is None for v in garages):
        right.append("garage closed" if len(garages) == 1 else "all garage doors closed")
    if doors and all(bad("door", v[0]) is None for v in doors):
        right.append("all doors closed" if len(doors) > 1 else f"{doors[0][1]} closed")
    tail = [f"Right now: {', '.join(right)}."] if right else []

    quiet = not leads and not body
    if quiet:
        text = f"A quiet {_QUIET_WORD[key]}." if key in _QUIET_WORD else "A quiet stretch."
        if any(v[0] not in _GONE for v in now_states.values()):
            text += " Everything is locked and closed."
        out = [text]
    else:
        out = leads + ([steady_line] if steady_line else []) + body
        room = max(1, MAX_LINES - len(tail))
        if len(out) > room:
            out = out[:room - 1] + [f"Plus {len(out) - (room - 1)} more on the Timeline."]
        out += tail
    return {"title": title(label, local_time(float(start)), local_time(float(end)), end - start), "lines": out,
            "quiet": quiet}


def _events(parts: list[str]) -> str:
    """"opened 6:12 AM, closed 6:20 AM", cut to MAX_EVENTS with "and N more"."""
    if len(parts) > MAX_EVENTS + 1:
        return f"{', '.join(parts[:MAX_EVENTS])}, and {len(parts) - MAX_EVENTS} more"
    return ", ".join(parts)


def title(label: str, a: datetime, b: datetime, seconds: float) -> str:
    """Overnight at the house (9 PM to 7 AM); a window of a day or more has no hours."""
    if seconds >= 20 * 3600:
        return f"{label} at the house"
    return f"{label} at the house ({hour(a)} to {hour(b)})"
