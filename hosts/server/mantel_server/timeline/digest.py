"""The morning digest (docs/phase19/HOUSE-TIMELINE.md "The morning digest"). The words are ``hk_core/timeline/digest``;
this decides who sees which rows, builds the lines for each version, and sends them.

* **The house version** goes to the alert channels through the phase 14 center: the kind ``house.digest`` (group
  House, ``once``, Info, off for a new channel), one ``raise_`` a day. The channels are shared and the services can
  read the text, so it is built for ``HouseViewer``, which is nobody: no person, no names, no arrivals, no Refused or
  System rows, no pictures. It sees the doors, locks, garage, alarm, doorbell, detections and safety rows (house facts
  with no one in them) and nothing else. Each channel picks the kind in Settings → Alerts and its own quiet hours apply
  (the center decides that: an Info message waits until they end).
* **The personal version** goes to the Mantel apps for each person whose Me → Morning Summary is on (``user_data``
  ``timeline_summary``, off by default), built for that person's own view (``api.Viewer``: the same rows the Timeline
  shows them, their names and arrivals if their role allows, System rows for an Owner or Admin), sent through
  ``Pusher.deliver`` as an Info push. Phones travel anywhere, so the person's view is judged on the tunnel's rules
  (as ``Pusher.may_see`` does for every notification).
* **When**: a task that wakes every minute. At ``digest.at`` (default 07:00) in the house's time zone, for the
  window from ``digest.from`` (default 21:00) to then, once a day (``timeline_digests.day``, the house's local date).
  A restart after the time sends it if it wasn't sent, but not after noon (``cutoff``). The house version is stored
  whether or not a channel takes it, so the tablets can show it.

Entry points the REST uses: ``summary`` (GET /api/timeline/summary), ``send_test`` (POST /api/timeline/digest/test).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Callable
from zoneinfo import ZoneInfo

from hk_core.timeline import digest as D

from .api import Viewer, find, tl_of, window_of

log = logging.getLogger("mantel.timeline")

KIND = "house.digest"
SUMMARY_KEY = "timeline_summary"            # user_data: Morning Summary (Me), the same key as user_data.TIMELINE_SUMMARY
PAGE_URL = "/home#timeline"                 # where a push opens (the Timeline page's own address is slice 19.3's)
HOUSE_FAMILIES = ("door", "window", "lock", "garage", "alarm", "doorbell", "detection", "safety")
STATE_FAMILIES = ("lock", "garage", "door", "window")
DOMAIN_OF = {"lock": "lock.", "garage": "cover.", "door": "binary_sensor.", "window": "binary_sensor."}
TICK = 60.0
NOON = 12
SCAN_MAX = 20000
PUSH_BODY = 400


class HouseViewer:
    """Nobody: the viewer of the house version. It has no person, no names and no pictures, is not a manager (no System
    or Refused rows) and sees only ``HOUSE_FAMILIES`` rows, which hold house facts. It judges no RBAC rule, because
    nothing here is shown to a person: the text goes to shared channels, where only the house's own facts may go."""
    user = None
    device = None
    role = None
    limited = False
    manager = False
    may_names = False
    pictures = False
    principal = None

    def visible(self, row: dict, now: float | None = None) -> bool:
        return row.get("family") in HOUSE_FAMILIES and bool(row.get("entity"))

    def may_view(self, entity: str) -> bool:
        return True

    @property
    def wall_families(self) -> frozenset:
        return frozenset(HOUSE_FAMILIES)


# -- the house's time --------------------------------------------------------------------------------------------------
def zone_of(app: Any) -> ZoneInfo:
    tz = getattr(app.get("authz"), "tz", None) or "UTC"
    try:
        return ZoneInfo(tz)
    except Exception:  # noqa: BLE001 -- an unknown zone: UTC, as window_of does
        return ZoneInfo("UTC")


def local_time(app: Any) -> Callable[[float], datetime]:
    zone = zone_of(app)
    return lambda t: datetime.fromtimestamp(t, zone)


def day_of(app: Any, end: float) -> str:
    """The house's local date ('YYYY-MM-DD') of the moment a window ends: the digest's day."""
    return local_time(app)(end).strftime("%Y-%m-%d")


# -- building ----------------------------------------------------------------------------------------------------------
def now_states(app: Any, viewer: Any) -> dict[str, tuple]:
    """{entity: (state, label, family)} of the locks, garage doors and doors this viewer may see, as they are now."""
    tl = tl_of(app)
    states = app["hub"].store.states
    out: dict[str, tuple] = {}
    for eid, m in tl.members.items():
        if m.family not in STATE_FAMILIES or not eid.startswith(DOMAIN_OF[m.family]):
            continue
        if viewer.limited and m.family not in viewer.wall_families:
            continue
        if not viewer.may_view(eid):
            continue
        s = (states.get(eid) or {}).get("s")
        out[eid] = (s, m.label, m.family)
    return out


def start_states(app: Any, entities: list[str], start: float) -> dict[str, str | None]:
    """Each lock's state when the window began: what its newest row before it recorded (None: no row, never changed
    since Mantel started recording)."""
    tl = tl_of(app)
    out: dict[str, str | None] = {}
    for eid in entities:
        row = tl.rows.before(eid, start)
        s = (row.get("detail") or {}).get("s") if row else None
        out[eid] = s if isinstance(s, str) else None
    return out


def window_rows(app: Any, viewer: Any, start: float, end: float, now: float) -> list[dict]:
    """The rows of [start, end) this viewer may see, oldest first."""
    tl = tl_of(app)
    rows = [r for r in tl.rows.window(start, end)[:SCAN_MAX] if viewer.visible(r, now)]
    return rows


def build(app: Any, viewer: Any, start: float, end: float, now: float, label: str) -> dict:
    """The digest for one viewer: ``hk_core``'s ``{"title", "lines", "quiet"}`` plus the rows it was made from."""
    tl = tl_of(app)
    tl.flush()                                      # what is queued is in the table
    rows = window_rows(app, viewer, start, end, now)
    states = now_states(app, viewer)
    locks = [e for e, v in states.items() if v[2] == "lock"]
    got = D.lines(rows, start=start, end=end, now_states=states, local_time=local_time(app),
                  names=bool(viewer.may_names), system=bool(viewer.manager),
                  start_states=start_states(app, locks, start), label=label)
    got["rows"] = rows
    return got


def house_version(app: Any, start: float, end: float, now: float, label: str = "Overnight") -> dict:
    got = build(app, HouseViewer(), start, end, now, label)
    got.pop("rows", None)
    return {**got, "since": start, "until": end, "label": label}


def body_of(version: dict) -> str:
    """The text a channel shows under the title."""
    return "\n".join(f"• {line}" for line in version["lines"])


def stored(app: Any, day: str) -> dict | None:
    """The house version stored for a day (the tablets show it), or None."""
    r = tl_of(app).db.execute("SELECT sent, body FROM timeline_digests WHERE day = ?", (day,)).fetchone()
    if r is None:
        return None
    try:
        body = json.loads(r[1])
    except ValueError:
        return None
    return {**body, "day": day, "sent": r[0]} if isinstance(body, dict) else None


# -- the page's summary ------------------------------------------------------------------------------------------------
def summary(app: Any, viewer: Any, window: str, now: float) -> dict:
    """``GET /api/timeline/summary``: counts, the lines and the newest rows of a window, for this viewer's own view."""
    start, end, label = window_of(app, window, now)
    if window == "overnight":                       # the stored day's own window (settings may have changed since)
        kept = stored(app, day_of(app, end))
        if kept is not None and isinstance(kept.get("since"), (int, float)) and isinstance(kept.get("until"),
                                                                                           (int, float)):
            start, end = float(kept["since"]), float(kept["until"])
    got = build(app, viewer, start, end, now, label)
    counts: dict[str, int] = {}
    for r in got.pop("rows"):
        counts[r["family"]] = counts.get(r["family"], 0) + 1
    newest = find(app, viewer, {"since": start, "until": end, "limit": 12}, now)["events"]
    return {"window": window, "label": label, "since": start, "until": end, "title": got["title"],
            "lines": got["lines"], "quiet": got["quiet"], "counts": counts, "events": newest}


# -- sending -----------------------------------------------------------------------------------------------------------
class Digests:
    """``app["timeline_digests"]``: the daily task and the two versions' delivery."""

    def __init__(self, app: Any, tl: Any) -> None:
        self.app, self.tl = app, tl
        self.task: asyncio.Task | None = None
        self.failed: str | None = None              # the day a build failed (not tried again until a restart)

    def clock(self) -> float:
        return float(self.app["clock"]())

    # -- when --------------------------------------------------------------------------------------------------------
    def due(self, now: float) -> tuple[float, float, str] | None:
        """(start, end, day) when a digest is owed at ``now``: the digest time has passed today, it isn't after the
        cutoff (noon, or two hours after a digest time that is later than that), and today's isn't sent yet."""
        from .api import _hhmm
        local = local_time(self.app)(now)
        at = _hhmm((self.tl.settings.get("digest") or {}).get("at"), (7, 0))
        today_at = local.replace(hour=at[0], minute=at[1], second=0, microsecond=0)
        cutoff = max(local.replace(hour=NOON, minute=0, second=0, microsecond=0), today_at + timedelta(hours=2))
        if local < today_at or local >= cutoff:
            return None
        start, end, _ = window_of(self.app, "overnight", now)
        day = day_of(self.app, end)
        if self.tl.db.execute("SELECT 1 FROM timeline_digests WHERE day = ?", (day,)).fetchone() is not None \
                or self.failed == day:
            return None
        return start, end, day

    async def tick(self) -> bool:
        """One look at the clock: send today's digest if it is due. True when it went."""
        now = self.clock()
        due = self.due(now)
        if due is None:
            return False
        start, end, day = due
        try:
            version = house_version(self.app, start, end, now)
        except Exception:  # noqa: BLE001 -- the next start tries again; a bug here never stops the loop
            log.exception("timeline: the morning digest couldn't be built")
            self.failed = day
            return False
        db = self.tl.db
        with db:                                    # claimed first: a crash between never sends twice
            db.execute("INSERT OR IGNORE INTO timeline_digests (day, sent, body) VALUES (?,?,?)",
                       (day, now, json.dumps(version, separators=(",", ":"))))
        self.raise_house(day, version)
        try:
            await self.send_people(start, end, now, day)
        except Exception:  # noqa: BLE001
            log.exception("timeline: the morning digest to the apps failed")
        log.info("timeline: the morning digest for %s sent (%d lines)", day, len(version["lines"]))
        return True

    # -- the house version -------------------------------------------------------------------------------------------
    def center(self) -> Any:
        alerts = self.app.get("alerts")
        return alerts.center if alerts is not None else None

    def raise_house(self, key: str, version: dict) -> int:
        """One raise through the alert center; how many channels take it."""
        center = self.center()
        if center is None:
            return 0
        from ..alerts import catalog
        kind = catalog.kind(KIND)
        takers = [ch for ch in center.channels.all() if center.wants(ch, kind, key)]
        center.raise_(KIND, key, {"title": version["title"], "body": body_of(version)})
        return len(takers)

    async def send_test(self) -> int:
        """Settings → Timeline → Send Test: this morning's house version now, whatever has been sent today. How many
        channels take it."""
        now = self.clock()
        start, end, _ = window_of(self.app, "overnight", now)
        version = house_version(self.app, start, end, now)
        return self.raise_house(f"{day_of(self.app, end)}:test", version)

    # -- the personal version ----------------------------------------------------------------------------------------
    def people(self) -> list[Any]:
        """The people whose Morning Summary is on (not disabled), as ``sessions.User``."""
        from ..sessions import User
        rows = self.tl.db.execute(
            "SELECT u.id, u.username, u.name, u.role, u.kind FROM users u JOIN user_data d ON d.subject = 'u:' || u.id "
            "AND d.key = ? WHERE u.disabled = 0 AND TRIM(d.value) = 'true' ORDER BY u.created, u.id", (SUMMARY_KEY,))
        return [User(id=r["id"], name=r["name"], role=r["role"], kind=r["kind"], username=r["username"])
                for r in rows]

    def viewer_for(self, user: Any) -> Viewer | None:
        from ..sessions import Identity
        authz = self.app.get("authz")
        if authz is None:
            return None
        principal = authz.principal_of(Identity(user=user, device=None, door="tunnel"))
        viewer = Viewer(self.app, principal)
        return viewer if viewer.feature() else None

    async def send_people(self, start: float, end: float, now: float, day: str) -> int:
        """Each person's own version to their Mantel apps; how many targets it reached."""
        pusher = self.app.get("pusher")
        if pusher is None:
            return 0
        from ..push import Message
        reached = 0
        for user in self.people():
            viewer = self.viewer_for(user)
            if viewer is None:
                continue                            # a role without the Timeline gets no summary of it
            got = build(self.app, viewer, start, end, now, "Overnight")
            rows = pusher.recipients({"type": "notification", "users": [user.id]})
            rows = [r for r in rows if r.get("user_id") == user.id]
            if not rows:
                continue
            msg = Message(title=got["title"][:120], body="\n".join(got["lines"])[:PUSH_BODY], tag=f"timeline-{day}",
                          url=PAGE_URL, category="timeline", level="info", id=f"timeline-{day}-{user.id}"[:64])
            counts = await pusher.deliver(rows, msg)
            reached += counts.get("ok", 0)
        return reached

    # -- running -----------------------------------------------------------------------------------------------------
    async def run(self, every: float = TICK) -> None:
        while True:
            try:
                await self.tick()
            except Exception:  # noqa: BLE001 -- the next minute tries again
                log.exception("timeline: the digest's look at the clock failed")
            await asyncio.sleep(every)

    async def start(self) -> None:
        self.task = asyncio.get_running_loop().create_task(self.run())

    async def stop(self) -> None:
        if self.task is not None:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.task
            self.task = None


async def send_test(app: Any) -> int:
    digests = app.get("timeline_digests")
    return await digests.send_test() if digests is not None else 0


def register(app: Any, tl: Any) -> Digests:
    digests = Digests(app, tl)
    app["timeline_digests"] = digests

    async def start(_app: Any) -> None:
        await digests.start()

    async def stop(_app: Any) -> None:
        await digests.stop()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return digests


__all__ = ["Digests", "HouseViewer", "build", "house_version", "register", "send_test", "stored", "summary"]
