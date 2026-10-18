"""CALENDARS: an event coming up. The host asks each chosen calendar every
minute (CAL_TICK_S) for the events starting within the lead time, and each one
is sent once, when "start - lead" has just passed. All-day events are left out
of that ("15 minutes before" one would be midnight); a Calendars notification
may send them the morning they start instead (All-Day Events, `allday`).

The host gives what only it can: `events(cals, start, end)`, the calendars'
events between two times ({calendar: [event]}, an event as HA's
calendar.get_events answers: summary, start, end, location, description,
uid; a timed one's start an ISO date-time, an all-day one's a date), and
`deliver(payload)`, which sends one out.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta
from typing import Any

from ..house import House
from . import rules
from .accessories import Pins, members, no_pins
from .banner import build, mute_key, muted, only_ok
from .const import CAL_TICK_S, CONF_ITEMS

Events = Callable[[list[str], datetime, datetime], Awaitable[dict[str, list[dict[str, Any]]]]]
Deliver = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]
Options = Callable[[], Mapping[str, Any]]


def event_time(house: House, v: Any) -> datetime | None:
    """A timed event's start or end as a local datetime; None for an all-day
    one (a date) or one that cannot be read."""
    if not isinstance(v, str) or "T" not in v and " " not in v:
        return None
    try:
        t = datetime.fromisoformat(v)
    except ValueError:
        return None
    return house.local_time(t)


def _lead(item: dict[str, Any]) -> int:
    try:
        return max(0, int(item.get("when") or 15))
    except ValueError:
        return 15


def build_calendar(house: House, opts: dict[str, Any], item: dict[str, Any], cal: str,
                   event: dict[str, Any], lead: int, test: bool = False, pins: Pins = no_pins) -> dict[str, Any]:
    """An event's notification: the event's name, when it is and where (the
    calendar's typed Title/Message over them)."""
    p = build(house, opts, item, None, test=test, eid=cal, pins=pins)
    start, end = event_time(house, event.get("start")), event_time(house, event.get("end"))
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


def build_allday(house: House, opts: dict[str, Any], item: dict[str, Any], cal: str,
                 event: dict[str, Any], test: bool = False, pins: Pins = no_pins) -> dict[str, Any]:
    """An all-day event's notification, the morning it starts: its name,
    "Today · All Day · the place"."""
    p = build_calendar(house, opts, item, cal, {**event, "start": None, "end": None}, 0, test=test, pins=pins)
    title, message = rules.allday_words(str(event.get("summary") or ""), str(event.get("location") or ""))
    p.update({"title": (item.get("title") or "").strip() or title,
              "message": (item.get("message") or "").strip() or message})
    p["event"].update({"start": event.get("start"), "end": event.get("end")})
    return p


async def look_ahead(house: House, last: datetime | None, now: datetime, sent: dict[str, float], *,
                     opts: Options, events: Events, deliver: Deliver, mute: dict[str, float],
                     pins: Pins = no_pins) -> list[dict[str, Any]]:
    """One look: what came due since `last` (None, the first: the last
    minute), each sent once -- `sent` (key -> when it was due, epoch s) is
    kept by the host between looks and updated here. What was sent."""
    last = last if last is not None else now - timedelta(seconds=CAL_TICK_S)
    out = []
    for item in opts()[CONF_ITEMS]:
        if item.get("category") != "calendars":
            continue
        cals = members(house, item, pins)
        lead = _lead(item)
        got = await events(cals, last + timedelta(minutes=lead) - timedelta(seconds=1),
                           now + timedelta(minutes=lead) + timedelta(seconds=1))
        for cal, evs in got.items():
            for ev in evs:
                start = event_time(house, ev.get("start"))
                if start is None:
                    continue                      # all day
                due = start - timedelta(minutes=lead)
                if not (last < due <= now):
                    continue
                key = "%s|%s|%s|%s" % (item.get("id"), cal, ev.get("summary"), ev.get("start"))
                if key in sent:
                    continue
                sent[key] = start.timestamp()
                if not only_ok(house, item.get("only") or "always") or muted(mute, mute_key(item, cal)):
                    continue
                p = build_calendar(house, dict(opts()), item, cal, ev, lead, pins=pins)
                out.append(await deliver(p))
        # ALL-DAY EVENTS: the morning they start, once the chosen time has
        # just passed -- each of today's
        at = item.get("allday")
        if at in rules.ALLDAY_TIMES:
            local = house.local_time(now)
            hh, mm = (int(x) for x in at.split(":"))
            due = local.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if house.local_time(last) < due <= local:
                day = local.replace(hour=0, minute=0, second=0, microsecond=0)
                got = await events(cals, day, day + timedelta(days=1) - timedelta(seconds=1))
                for cal, evs in got.items():
                    for ev in evs:
                        st = ev.get("start")
                        if not isinstance(st, str) or "T" in st or st[:10] != day.date().isoformat():
                            continue                      # timed, or begun on an earlier day
                        key = "%s|%s|%s|%s|day" % (item.get("id"), cal, ev.get("summary"), st)
                        if key in sent:
                            continue
                        sent[key] = due.timestamp()
                        if not only_ok(house, item.get("only") or "always") or muted(mute, mute_key(item, cal)):
                            continue
                        out.append(await deliver(build_allday(house, dict(opts()), item, cal, ev, pins=pins)))
    # forget what is long past
    cut = (now - timedelta(days=1)).timestamp()
    for k in [k for k, v in sent.items() if v <= cut]:
        del sent[k]
    return out


async def sample(house: House, item: dict[str, Any], cals: list[str], now: datetime, *,
                 opts: Options, events: Events, pins: Pins = no_pins) -> dict[str, Any]:
    """A Calendars notification's test: the next timed event of the chosen
    calendars within a week, as it will look -- else a made-up one."""
    lead = _lead(item)
    got = await events(cals, now, now + timedelta(days=7))
    found = sorted(((event_time(house, ev.get("start")), cal, ev) for cal, evs in got.items() for ev in evs
                    if event_time(house, ev.get("start")) is not None), key=lambda x: x[0])
    if found:
        _t, cal, ev = found[0]
    else:
        start = house.local_time(now + timedelta(minutes=lead))
        cal, ev = cals[0], {"summary": "Sample Event", "start": start.isoformat(),
                            "end": (start + timedelta(hours=1)).isoformat()}
    return build_calendar(house, dict(opts()), item, cal, ev, lead, test=True, pins=pins)
