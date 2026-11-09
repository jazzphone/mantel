"""Timers on Mantel (phase 21, docs/phase21/TIMER-SLIDE.md): Mantel makes each timer someone sets as a real Home Assistant
timer helper, which runs its countdown, and deletes it once it is over.

Mantel keeps what Home Assistant has no place for (the room, who set it) and its own copy of each timer's end time, in the
`timers` table, so an end is noticed across a restart of either (hk_core.timers.judge).

* THE BUTTONS DON'T CHANGE. The cards call script.quick_timer_start and script.quick_timer_create, as they do under HK
  Frontend; the gateway hands those two to ``Timers.start``. With no admin credential on Home Assistant (timer/create is
  admin only) ``start`` answers None and the gateway sends the call on to the helpers' own script, as before.
* THE CARDS DON'T CHANGE EITHER. ``Timers.overlay`` runs ahead of the sessions on every batch of states and keeps
  sensor.running_quick_timers true of every timer that counts (the helpers' own sensor knows only the four slots), and the
  two scripts' states present, so a house without the helpers' package has the whole Timers page.
* WHAT ENDS. ``_follow`` compares each copy with the state. A made timer that is over is deleted; so is one left idle with
  no row (a crash between the steps, or a row lost to a restore). ``on_end`` is where the ring goes (the plan's step 3).
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from aiohttp import web

from hk_core import timers as R

from .ha_client import CommandTicket, HaCommandError

log = logging.getLogger("mantel.timers")

WATCHED = ("timer.", "input_text.quick_timer_", R.SENSOR, "script.quick_timer_")
ICON = "mdi:timer-outline"


@dataclass
class Row:
    entity_id: str
    name: str = ""
    room: str | None = None
    rings_in: str | None = None
    set_by: str | None = None
    created: float = 0.0
    finishes_at: float | None = None
    made: bool = False
    missing: float | None = field(default=None, compare=False)      # when it was first not there (not stored)


class TimerStore:
    def __init__(self, db: Any) -> None:
        self.db = db

    def load(self) -> dict[str, Row]:
        rows = self.db.execute("SELECT entity_id, name, room, rings_in, set_by, created, finishes_at, made FROM timers").fetchall()
        return {r[0]: Row(r[0], r[1], r[2], r[3], r[4], r[5], r[6], bool(r[7])) for r in rows}

    def save(self, r: Row) -> None:
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO timers (entity_id, name, room, rings_in, set_by, created, finishes_at, made) "
                            "VALUES (?,?,?,?,?,?,?,?)", (r.entity_id, r.name, r.room, r.rings_in, r.set_by, r.created, r.finishes_at, int(r.made)))

    def drop(self, entity_id: str) -> None:
        with self.db:
            self.db.execute("DELETE FROM timers WHERE entity_id = ?", (entity_id,))


class Timers:
    def __init__(self, app: web.Application, hub: Any, clock: Callable[[], float]) -> None:
        self.app = app
        self.hub = hub
        self.clock = clock
        self.store = TimerStore(app["store"].db)
        self.rows = self.store.load()
        self.no_admin = False                # timer/create was refused: Home Assistant's credential isn't an admin's
        self.starting: set[str] = set()      # made, not yet running: its idle state isn't an end
        self.deleting: set[str] = set()
        self.tasks: set[asyncio.Task] = set()
        self.lock = asyncio.Lock()
        self.on_end: Callable[[Row, bool], None] = self._log_end   # (the row, too late to ring): step 3 rings here

    # -- the house's states ----------------------------------------------------------------------------------------
    def _states(self) -> dict[str, dict]:
        return self.hub.store.states

    def _ignore(self) -> set[str]:
        """General -> House Timers: Night, Nap and the rest never count."""
        try:
            from hk_core.settings import model as SM
            return set(SM.merged(self.app["features"].stored().options)["features"]["house_timers"])
        except Exception:  # noqa: BLE001 -- no settings yet: nothing is on the list
            return set()

    def _ready(self) -> bool:
        ha = getattr(self.hub, "ha", None)
        return ha is None or ha.ready.is_set()

    def _commander(self) -> Any:
        gw = self.app.get("gateway")
        return gw.commander if gw is not None else None

    def overlay(self, changed: set[str]) -> set[str]:
        """Ahead of the sessions, on every batch: the sensor and the scripts as they should be, and the timers followed."""
        if not any(e.startswith(WATCHED) for e in changed):
            return changed
        states = self._states()
        ignore = self._ignore()
        n, attrs = R.sensor_attributes(states, ignore)
        old = states.get(R.SENSOR)
        if old is None or old.get("s") != str(n) or old.get("a") != attrs:
            now = self.clock()
            states[R.SENSOR] = {"s": str(n), "a": attrs, "lc": now, "lu": now}
            changed = changed | {R.SENSOR}
        for script, what in (("script.quick_timer_start", "Start a Quick Timer"), ("script.quick_timer_create", "Create a Named Quick Timer")):
            if script not in states:
                now = self.clock()
                states[script] = {"s": "off", "a": {"friendly_name": what, "icon": ICON}, "lc": now, "lu": now}
                changed = changed | {script}
        self._follow(ignore)
        return changed

    def _follow(self, ignore: set[str]) -> None:
        states, now = self._states(), self.clock()
        for eid, st in list(states.items()):
            if not eid.startswith("timer.") or not R.counts(eid, ignore) or eid in self.starting:
                continue
            row, s = self.rows.get(eid), st.get("s")
            if s == "active" or s == "paused":
                end = R.when((st.get("a") or {}).get("finishes_at")) if s == "active" else None
                if row is None:
                    row = self.rows[eid] = Row(eid, R.name_of(states, eid), created=now, finishes_at=end, made=R.is_made(eid))
                    self.store.save(row)
                elif row.finishes_at != end:
                    row.finishes_at = end
                    self.store.save(row)
            elif s == "idle" and row is None and R.is_made(eid):
                self._delete(eid)            # a made timer nobody is following: left by a crash between the steps
        for eid, row in list(self.rows.items()):
            if eid in self.starting or eid in self.deleting:
                continue
            if not R.counts(eid, ignore):
                self._forget(eid)            # put on the House Timers list while it ran
                continue
            st = states.get(eid)
            if st is None:
                if row.missing is None:
                    row.missing = now
                elif self._ready() and now - row.missing > R.GONE_AFTER:
                    self._forget(eid)        # someone deleted it in Home Assistant
                continue
            row.missing = None
            verdict = R.judge(row.finishes_at, st.get("s"), now)
            if verdict == "ended":
                self._forget(eid)
                self._ended(row, now)
            elif verdict == "stopped":
                self._forget(eid)
            else:
                continue
            if row.made:
                self._delete(eid)

    def _ended(self, row: Row, now: float) -> None:
        try:
            self.on_end(row, R.is_late(row.finishes_at or now, now))
        except Exception:  # noqa: BLE001 -- an end never breaks the states
            log.exception("timers: what follows the end of %s failed", row.entity_id)

    @staticmethod
    def _log_end(row: Row, late: bool) -> None:
        log.info("timers: %s ended%s", row.entity_id, " while Mantel or Home Assistant was down" if late else "")

    def _forget(self, entity_id: str) -> None:
        self.rows.pop(entity_id, None)
        self.store.drop(entity_id)

    # -- talking to Home Assistant ---------------------------------------------------------------------------------
    def _spawn(self, coro: Any) -> None:
        task = asyncio.ensure_future(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    def _delete(self, entity_id: str) -> None:
        if entity_id in self.deleting or self._commander() is None or self.no_admin or not self._ready():
            return
        self.deleting.add(entity_id)
        self._spawn(self._delete_now(entity_id))

    async def _delete_now(self, entity_id: str) -> None:
        audit = self.app["audit"]
        try:
            aid = audit.record(principal=None, kind="system", action="timer/delete", targets=[entity_id], decision="allowed",
                               reason="timer_over", actor="mantel", actor_name="Mantel Server")
            await self._commander().call({"type": "timer/delete", "timer_id": R.object_id(entity_id)}, CommandTicket(aid, "ws"))
            audit.finish(aid, "ok")
        except HaCommandError as exc:
            if exc.code == "unauthorized":
                self.no_admin = True
            log.warning("timers: could not delete %s: %s", entity_id, exc)
        except Exception as exc:  # noqa: BLE001 -- it stays idle, and is deleted at the next look
            log.warning("timers: could not delete %s: %s", entity_id, exc)
        finally:
            self.deleting.discard(entity_id)

    async def start(self, principal: Any, ask: dict, aid: int) -> dict | None:
        """One of the Start buttons: {"started": true, "slot": ...} or {"started": false, "reason": ...}, as the helpers'
        scripts answer. None: Mantel can't make timers here, so the call goes on to the helpers' own script."""
        commander = self._commander()
        if commander is None or self.no_admin:
            return None
        data = ask.get("data") or {}
        secs = R.digits_secs(data.get("digits")) if ask.get("op") == "create" else R.duration_secs(data.get("duration"))
        if secs <= 0:
            return {"started": False, "reason": "zero_duration"}
        name = R.clean_name(data.get("name"))
        async with self.lock:
            states = self._states()
            running = [e for e, st in states.items() if R.is_made(e) and st.get("s") in ("active", "paused")]
            if len(running) + len(self.starting) >= R.MAX_MADE:
                return {"started": False, "reason": "no_free_slot"}
            n = R.next_number(list(states) + list(self.rows) + list(self.starting) + list(self.deleting))
            eid = f"timer.hk_timer_{n}"
            self.starting.add(eid)
            try:
                try:
                    # (a fixed name first, for the entity id; its real name after. The id doesn't follow a rename.)
                    await commander.call({"type": "timer/create", "name": f"HK Timer {n}", "icon": ICON, "duration": "00:00:00", "restore": True},
                                         CommandTicket(aid, "ws"))
                except HaCommandError as exc:
                    if exc.code != "unauthorized":
                        raise
                    self.no_admin = True
                    log.warning("timers: Home Assistant's credential can't make helpers; using the quick timers' own scripts")
                    return None
                try:
                    await commander.call({"type": "timer/update", "timer_id": R.object_id(eid), "name": name, "icon": ICON, "duration": "00:00:00", "restore": True},
                                         CommandTicket(aid, "ws"))
                    await commander.call({"type": "call_service", "domain": "timer", "service": "start",
                                          "service_data": {"entity_id": eid, "duration": R.hms(secs)}}, CommandTicket(aid, "ws"))
                except Exception:
                    self.starting.discard(eid)
                    self._delete(eid)
                    raise
                identity = getattr(principal, "identity", None)
                device, user = getattr(identity, "device", None), getattr(identity, "user", None)
                row = Row(eid, name, room=getattr(device, "room", None) or None, rings_in=None,
                          set_by=getattr(device, "id", None) or getattr(user, "id", None), created=self.clock(),
                          finishes_at=self.clock() + secs, made=True)
                self.rows[eid] = row
                self.store.save(row)
            finally:
                self.starting.discard(eid)
        return {"started": True, "slot": eid}

    def status(self) -> dict[str, Any]:
        return {"can_make": self._commander() is not None and not self.no_admin, "following": sorted(self.rows)}

    async def close(self) -> None:
        for task in list(self.tasks):
            task.cancel()


def register(app: web.Application, hub: Any) -> Timers:
    """``app["timers"]``, and its overlay ahead of the sessions on every batch of states."""
    host = Timers(app, hub, lambda: app["clock"]())
    app["timers"] = host
    hub.overlays.append(host.overlay)

    async def stop(_app: web.Application) -> None:
        await host.close()
    app.on_cleanup.append(stop)
    return host
