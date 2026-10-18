"""Two of HK's clock-driven features on Mantel, through MantelHouse and FeatureCaller
(docs/phase4/MANTEL-FEATURES.md "Phase 4 ports").

* ``CalendarLook``: Notifications' Calendars category. Once a minute, ``hk_core.notifications.
  calendars.look_ahead`` asks the chosen calendars for what starts within each notification's lead
  time and sends each event once ("start - lead" just passed; all-day events the morning they start
  when All-Day Events says so). Home Assistant asks ``calendar.get_events``; Mantel reads the same
  events with the read proxy's one REST read (``GET /api/calendars/<calendar>?start&end``, the read
  HK's calendar card makes, with Mantel's own credential: the house's own feature, not a page's read),
  turned into get_events' shape. What is due goes out the one notification way (the snapshot, the
  screens' events feed, Wakes the Screen): the same ``hk_frontend/events/subscribe`` HK reads.
* ``TabletWatch``: All Tablets' alerts and scheduled restart (``hk_core.tablets.alerts``). Once a minute
  the alerts are checked over MantelHouse (offline, not charging, not back after a restart); each one
  raised is an Important banner on the screens (``banner.build_action``, as HA's ``_banner``) and is
  listed in ``GET /api/features/status`` while it is up (Mantel has no persistent notifications). The
  scheduled restart (``restart_times`` in the house's zone) presses Clear Cache on every tablet, waits
  CLEAR_WAIT, then each tablet's restart: every press is a ``button.press`` through
  ``MantelHouse.call_service`` -> FeatureCaller -> the gateway, as the Service actor (its grants are
  exactly the planned buttons, only while the schedule is on) or, for "Restart all now", as the person
  who asked. With house commands off nothing is pressed: each press is audited and listed ``would``.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from datetime import datetime
from typing import TYPE_CHECKING, Any, Mapping

from hk_core.notifications import banner as NB
from hk_core.notifications import calendars as C
from hk_core.settings import model as SM
from hk_core.tablets import alerts as A

from .house import HouseCommandRefused, HouseCommandsDisabled

if TYPE_CHECKING:
    from .features import FeatureHost

log = logging.getLogger("mantel.feature_watch")
KEEP = 50


def iso_of(v: Any) -> str | None:
    """A REST calendar event's start/end ({dateTime} or {date}, or already a string) -> get_events' string."""
    if isinstance(v, str):
        return v
    if isinstance(v, Mapping):
        got = v.get("dateTime") or v.get("date")
        return got if isinstance(got, str) else None
    return None


def as_get_events(ev: Any) -> dict[str, Any] | None:
    """One event of ``GET /api/calendars/<calendar>`` in ``calendar.get_events``' shape (what
    hk_core's calendars read): summary, start, end, location, description, uid."""
    if not isinstance(ev, Mapping):
        return None
    start, end = iso_of(ev.get("start")), iso_of(ev.get("end"))
    if start is None:
        return None
    return {"summary": str(ev.get("summary") or ""), "start": start, "end": end,
            "location": str(ev.get("location") or ""), "description": str(ev.get("description") or ""),
            "uid": ev.get("uid") if isinstance(ev.get("uid"), str) else None}


class CalendarLook:
    """Notifications' calendar look-ahead on Mantel (see the module docstring)."""

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host
        self.last: datetime | None = None
        self.sent: dict[str, float] = {}           # look_ahead's own memory: key -> when it was due
        self.looks = 0
        self.error: str | None = None
        self.delivered: deque = deque(maxlen=KEEP)

    def wanted(self) -> bool:
        return self.host.on("notifications") and any(i.get("category") == "calendars" for i in self.host.notifier.items)

    async def events(self, cals: list[str], start: datetime, end: datetime) -> dict[str, list[dict[str, Any]]]:
        """The calendars' events between two times ({calendar: [event]}); a calendar that can't be read
        has none (HA's async_events: no notification rather than a wrong one)."""
        proxy = getattr(self.host.hub, "readproxy", None)
        read = getattr(proxy, "get_calendar_events", None)
        if read is None or not cals:
            return {}
        out: dict[str, list[dict[str, Any]]] = {}
        for cal in cals:
            if not isinstance(cal, str) or not cal.startswith("calendar."):
                continue
            try:
                got = await read(cal, start.isoformat(), end.isoformat())
            except Exception as exc:  # noqa: BLE001
                self.error = f"{cal}: {type(exc).__name__}"
                log.debug("calendar look-ahead: %s not read (%s)", cal, type(exc).__name__)
                continue
            out[cal] = [e for e in (as_get_events(x) for x in (got if isinstance(got, list) else [])) if e]
        return out

    async def deliver(self, payload: dict[str, Any]) -> dict[str, Any]:
        sent = await self.host.notifier.send(payload, payload.get("item"), payload.get("entity"))
        self.delivered.append({"at": time.time(), "item": payload.get("item"), "calendar": payload.get("entity"),
                               "title": payload.get("title")})
        return sent

    async def look(self, now: datetime | None = None) -> list[dict[str, Any]]:
        """One look: what came due since the last one (the first: the last minute). What was sent."""
        if not self.wanted():
            self.last = None
            return []
        now = now or self.host.now()
        last, self.last = self.last, now
        self.looks += 1
        n = self.host.notifier
        return await C.look_ahead(self.host.house, last, now, self.sent, opts=lambda: n.opts, events=self.events,
                                  deliver=self.deliver, mute=n.mutes)

    async def sample(self, item: dict[str, Any], cals: list[str]) -> dict[str, Any]:
        """A Calendars notification's test (hk_notify/test): the next timed event within a week, else a
        made-up one (hk_core calendars.sample)."""
        n = self.host.notifier
        return await C.sample(self.host.house, item, cals, self.host.now(), opts=lambda: n.opts, events=self.events)

    def status(self) -> dict[str, Any]:
        return {"wanted": self.wanted(), "looks": self.looks, "last": self.last.isoformat() if self.last else None,
                "error": self.error, "delivered": list(self.delivered)}


class TabletWatch:
    """All Tablets' alerts and the scheduled restart on Mantel (see the module docstring)."""

    CLEAR_WAIT = A.CLEAR_WAIT

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host
        self.alerts = A.Alerts()
        self.up: dict[str, dict[str, Any]] = {}          # note id -> the alert raised
        self.log: deque = deque(maxlen=KEEP)
        self.restarts: deque = deque(maxlen=10)
        self._ran: str | None = None                       # "YYYY-MM-DDTHH:MM" of the last scheduled run
        self._task: asyncio.Task | None = None

    def options(self) -> dict[str, Any]:
        return SM.merged(self.host.stored().options)["tablets"]

    def tabs(self) -> dict[str, dict[str, Any]]:
        return self.host.tablets

    def plan(self) -> list[tuple[str, str | None, str]]:
        return A.restart_plan(self.host.house, self.tabs())

    def grants(self) -> set[str]:
        """The buttons the scheduled restart presses (the Service actor's grants): only while the
        tablets piece and the schedule are on."""
        if not self.host.on("tablets") or not A.restart_times(self.options()):
            return set()
        out: set[str] = set()
        for _tid, clear, restart in self.plan():
            out |= {b for b in (clear, restart) if b}
        return out

    # -- the alerts --------------------------------------------------------------------------------
    def check(self, now: datetime | None = None) -> list[A.Alert]:
        if not self.host.on("tablets"):
            return []
        now = now or self.host.now()
        got = self.alerts.check(self.host.house, self.tabs(), self.options(), now)
        for a in got:
            nid = A.note_id(a.tablet, a.kind)
            self.log.append({"at": now.isoformat(), "up": a.up, "tablet": a.tablet, "kind": a.kind, "title": a.title})
            if a.up:
                self.up[nid] = {"tablet": a.tablet, "kind": a.kind, "title": a.title, "message": a.message,
                                "since": now.isoformat()}
                self.host.spawn(self._banner(a.title, a.message))
            else:
                self.up.pop(nid, None)
        return got

    async def _banner(self, title: str, message: str) -> None:
        """An Important banner on the screens (HA's Watch._banner), the notification way."""
        n = self.host.notifier
        payload = NB.build_action(self.host.house, n.opts, {"title": title, "message": message, "important": True,
                                                            "icon": "mdi:tablet-dashboard"})
        await n.send(payload, None, None)

    # -- the scheduled restart -----------------------------------------------------------------------
    def due(self, now: datetime | None = None) -> bool:
        """Start the scheduled restart if one of its times is this minute (once per minute)."""
        if not self.host.on("tablets"):
            return False
        local = self.host.house.local_time(now or self.host.now())
        key = local.strftime("%Y-%m-%dT%H:%M")
        if (local.hour, local.minute) not in A.restart_times(self.options()) or key == self._ran:
            return False
        if self._task is not None and not self._task.done():
            return False
        self._ran = key
        self._task = self.host.spawn(self.restart_all())
        return True

    async def _press(self, eid: str, context: Any, rec: dict[str, Any]) -> None:
        try:
            await self.host.house.call_service("button", "press", {"entity_id": eid}, context=context)
            outcome = "sent"
        except HouseCommandsDisabled:
            outcome = "would"
        except HouseCommandRefused as exc:
            outcome = f"refused:{exc.code}"
        except Exception as exc:  # noqa: BLE001 -- one tablet never stops the rest
            outcome = f"failed:{type(exc).__name__}"
        rec["presses"].append({"button": eid, "outcome": outcome})

    async def restart_all(self, context: Any = None) -> list[str]:
        """Clear the cache, then restart: every tablet whose kiosk app can (``context``: the person who
        asked, else the Service actor). The tablets whose restart was pressed (sent or would)."""
        todo = self.plan()
        rec: dict[str, Any] = {"at": self.host.now().isoformat(), "as": "person" if context is not None else "service",
                               "presses": []}
        self.restarts.append(rec)
        ctx = context if context is not None else "tablets:restart"
        for _tid, clear, _restart in todo:
            if clear:
                await self._press(clear, ctx, rec)
        if todo:
            # the kiosk's cache cleared before its restart (only worth waiting for when one was pressed)
            await asyncio.sleep(self.CLEAR_WAIT if any(p["outcome"] == "sent" for p in rec["presses"]) else 0)
        done = []
        for tid, _clear, restart in todo:
            before = len(rec["presses"])
            await self._press(restart, ctx, rec)
            if rec["presses"][before]["outcome"] == "sent":
                self.alerts.restarted[tid] = self.host.now()     # "didn't come back" is checked from here
            if rec["presses"][before]["outcome"] in ("sent", "would"):
                done.append(tid)
        rec["tablets"] = done
        return done

    def status(self) -> dict[str, Any]:
        o = self.options() if self.host.on("tablets") else {}
        return {"up": list(self.up.values()), "log": list(self.log), "restarts": list(self.restarts),
                "restart_times": ["%02d:%02d" % t for t in A.restart_times(o)] if o else [],
                "grants": sorted(self.grants())}
