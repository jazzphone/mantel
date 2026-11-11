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
* WHAT ENDS. ``_follow`` compares each copy with the state. A timer that ended rings; one that ended too long ago (Mantel or
  Home Assistant was down) sends a notification instead. A made timer that is over is deleted; so is one left idle with no row
  (a crash between the steps, or a row lost to a restore).
* THE RING is state of the sensor (``ringing``), so every screen knows with nothing new to subscribe to, and survives a
  restart in the row (``ring_until``). Each screen plays its own sound if the ring is for its room, and shows Time's Up.
  Stop, +1 Min and Restart are script.quick_timer_ring, through the gateway; Stop on any screen ends it on all of them.
* THE SPEAKERS go the Intercom's way (intercom/driver.py announce, its one-time links and stream listener): a short clip, again
  every SPEAK_EVERY seconds while it rings. They don't need the Intercom on, or its rooms: the listener runs while a timer rings.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from aiohttp import web

from hk_core import timers as R
from hk_core.intercom.rooms import Call
from hk_core.notifications import banner as NB

from .ha.ha_client import CommandTicket, HaCommandError
from .intercom import driver as D
from .intercom.spool import Spool

log = logging.getLogger("mantel.timers")

WATCHED = ("timer.", "input_text.quick_timer_", R.SENSOR, "script.quick_timer_")
ICON = "mdi:timer-outline"
SPEAK_EVERY = 20.0      # seconds between a speaker's clips, from the start of one (music dips for each)
SETTINGS_EVERY = 5.0    # seconds between looks at whether the house's settings changed


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
    ring_until: float | None = None                                 # ringing until then
    total: int = 0                                                  # its length in seconds, for Restart (+1 Min doesn't change it)
    missing: float | None = field(default=None, compare=False)      # when it was first not there (not stored)
    woken: bool = field(default=False, compare=False)               # its room's dark tablet was woken for its last minute


class TimerStore:
    def __init__(self, db: Any) -> None:
        self.db = db

    def load(self) -> dict[str, Row]:
        rows = self.db.execute("SELECT entity_id, name, room, rings_in, set_by, created, finishes_at, made, ring_until, total FROM timers").fetchall()
        return {r[0]: Row(r[0], r[1], r[2], r[3], r[4], r[5], r[6], bool(r[7]), r[8], r[9]) for r in rows}

    def save(self, r: Row) -> None:
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO timers (entity_id, name, room, rings_in, set_by, created, finishes_at, made, ring_until, total) "
                            "VALUES (?,?,?,?,?,?,?,?,?,?)", (r.entity_id, r.name, r.room, r.rings_in, r.set_by, r.created, r.finishes_at, int(r.made), r.ring_until, r.total))

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
        self.clips: dict[str, bytes] = {}
        self.turned_on: set[str] = set()     # Which Timers: what authz.py lets a wall tablet see, too
        self.settings_version = -1
        self.looking: asyncio.Task | None = None
        self.lock = asyncio.Lock()
        self.on_end: Callable[[Row, bool], None] = self._log_end   # hears each end: (the row, too late to ring)
        self.ringers: dict[str, asyncio.Task] = {}
        self.spoken: list[dict[str, Any]] = []          # the speakers' last results (status)
        self._wake_t: Any = None

    # -- the house's states ----------------------------------------------------------------------------------------
    def _states(self) -> dict[str, dict]:
        return self.hub.store.states

    def _features(self) -> dict[str, Any]:
        """The house's `features` settings as stored: House Timers, Which Timers and When a Timer Ends. The defaults are ours."""
        try:
            return dict(self.app["settings"].store.body("house", "settings").get("features") or {})
        except Exception:  # noqa: BLE001 -- no settings yet: as they come
            return {}

    def _rules(self) -> tuple[set[str], set[str]]:
        """(ignored, turned on), and every screen told if what is turned on changed: a tablet may see a timer turned on."""
        ignore, include = R.rules(self._features())
        if include != self.turned_on:
            self.turned_on = include
            for session in list(getattr(self.hub, "sessions", ())):
                try:
                    session.view.policy_changed()
                    session.wake.set()
                except Exception:  # noqa: BLE001 -- that one screen catches up at its next look
                    log.debug("timers: a screen wasn't told", exc_info=True)
        return ignore, include

    def _ready(self) -> bool:
        ha = getattr(self.hub, "ha", None)
        return ha is None or ha.ready.is_set()

    def _commander(self) -> Any:
        gw = self.app.get("gateway")
        return gw.commander if gw is not None else None

    def options(self) -> dict[str, Any]:
        """General -> Timers: what happens when a timer ends."""
        out = {"timer_sound": "bell", "timer_ring_for": 60, "timer_tablet": True, "timer_speaker": True, "timer_also": [],
               "timer_phone": "", "timer_volume": 40, "timer_wake": True}
        got = self._features()
        out.update({k: got[k] for k in out if k in got})
        return out

    def _music_rooms(self) -> list[tuple[str, str | None]]:
        """(a music room's entity, its area), for the rooms with speakers."""
        try:
            from hk_core.house import area_of
            m = self.app.get("music")
            if m is None:
                return []
            cfg, house = m.config(), m.house
            return [(r, area_of(house, house.entity(r))) for r in cfg.room_ids]
        except Exception:  # noqa: BLE001 -- no music set up: no speakers
            return []

    def _where(self, row: Row, opts: dict[str, Any], rooms: list[tuple[str, str | None]]) -> dict[str, Any]:
        """Where this timer rings, for the screens: `tablet` (its room's tablet does; `areas` empty: every tablet), `speakers`
        (their names) and the sound."""
        area = R.area_for(row.rings_in, row.room, opts["timer_phone"])
        names = []
        music = self.app.get("music")
        for e in R.speakers_for(area, opts["timer_also"], rooms, bool(opts["timer_speaker"])):
            try:
                names.append(music.config().name_of(e))
            except Exception:  # noqa: BLE001 -- its name, or its id
                names.append(e)
        return {"tablet": bool(opts["timer_tablet"]), "areas": [area] if area else [], "speakers": names, "tone": opts["timer_sound"]}

    def _publish(self, attrs: dict[str, Any], states: dict[str, dict]) -> None:
        """What the screens need to ring and to say where: on the sensor."""
        opts, rooms = self.options(), self._music_rooms()
        ringing = []
        for eid, row in sorted(self.rows.items()):
            if row.ring_until is not None:
                ringing.append({"entity_id": eid, "name": row.name or R.name_of(states, eid), "until": row.ring_until, **self._where(row, opts, rooms)})
        attrs["ringing"] = ringing
        for r in attrs["running"]:
            row = self.rows.get(r["entity_id"])
            if row is not None:
                r.update(self._where(row, opts, rooms))
        names = {}
        try:
            house = self.app["music"].house
            names = {a: house.area_name(a) for _e, a in rooms if a}
        except Exception:  # noqa: BLE001 -- no music set up
            pass
        attrs["rooms"] = sorted(({"id": a, "name": n or a} for a, n in names.items()), key=lambda x: x["name"])

    def settings_look(self) -> None:
        """A settings save, within a few seconds: every screen hears (Which Timers, where it rings), with no timer changing."""
        got = self.app["settings"].store.get("house", "settings")
        version = got.version if got is not None else 0
        if version != self.settings_version:
            self.settings_version = version
            self._push()

    def _push(self) -> None:
        """The ring changed: every screen hears, as a change of the sensor."""
        self.hub.on_change({R.SENSOR})

    def overlay(self, changed: set[str]) -> set[str]:
        """Ahead of the sessions, on every batch: the sensor and the scripts as they should be, and the timers followed."""
        states = self._states()
        # (the sensor is always there, in a house with no timers too: it is how a screen knows sound is possible here)
        if R.SENSOR in states and not any(e.startswith(WATCHED) for e in changed):
            return changed
        ignore, include = self._rules()
        self._follow(ignore, include)
        n, attrs = R.sensor_attributes(states, ignore, include)
        self._publish(attrs, states)
        attrs["plumbing"] = True           # (never offered as an accessory)
        old = states.get(R.SENSOR)
        if old is None or old.get("s") != str(n) or old.get("a") != attrs:
            now = self.clock()
            if old is None:
                self.hub.store.ours.add(R.SENSOR)
            states[R.SENSOR] = {"s": str(n), "a": attrs, "lc": now, "lu": now}
            changed = changed | {R.SENSOR}
        for script, what in (("script.quick_timer_start", "Start a Quick Timer"), ("script.quick_timer_create", "Create a Named Quick Timer"),
                             ("script.quick_timer_ring", "Stop a Ringing Timer")):
            if script not in states:
                now = self.clock()
                self.hub.store.ours.add(script)
                states[script] = {"s": "off", "a": {"friendly_name": what, "icon": ICON, "plumbing": True}, "lc": now, "lu": now}
                changed = changed | {script}
        return changed

    def _follow(self, ignore: set[str], include: set[str]) -> None:
        states, now = self._states(), self.clock()
        for eid, st in list(states.items()):
            if not eid.startswith("timer.") or not R.counts(eid, ignore, include) or eid in self.starting:
                continue
            row, s = self.rows.get(eid), st.get("s")
            if s == "active" or s == "paused":
                end = R.when((st.get("a") or {}).get("finishes_at")) if s == "active" else None
                if row is not None and row.ring_until is not None:       # +1 Min, Restart: counting again
                    self._quiet(eid)
                    row.ring_until = None
                    row.woken = False
                if row is None:
                    row = self.rows[eid] = Row(eid, R.name_of(states, eid), created=now, finishes_at=end, made=R.is_made(eid),
                                               total=R.duration_secs((st.get("a") or {}).get("duration")))
                    self.store.save(row)
                elif row.finishes_at != end:
                    row.finishes_at = end
                    self.store.save(row)
            elif s == "idle" and row is None and R.is_made(eid):
                self._delete(eid)            # a made timer nobody is following: left by a crash between the steps
        for eid, row in list(self.rows.items()):
            if eid in self.starting or eid in self.deleting:
                continue
            if not R.counts(eid, ignore, include):
                self._quiet(eid)
                self._forget(eid)            # put on the House Timers list while it ran
                continue
            if row.ring_until is not None:
                self._ensure_ringer(eid)     # (and after a restart: the row says it was ringing)
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
                self._ended(row, now)
            elif verdict == "stopped":
                self._forget(eid)
                if row.made:
                    self._delete(eid)
        self._arm_wake(ignore, include)

    def _ended(self, row: Row, now: float) -> None:
        late = R.is_late(row.finishes_at or now, now)
        try:
            self.on_end(row, late)
        except Exception:  # noqa: BLE001 -- an end never breaks the states
            log.exception("timers: what follows the end of %s failed", row.entity_id)
        if late:
            self._tell_late(row)
            self._forget(row.entity_id)
            if row.made:
                self._delete(row.entity_id)
            return
        row.ring_until = now + R.ring_secs(self.options()["timer_ring_for"])
        self.store.save(row)
        self._ensure_ringer(row.entity_id)

    def _tell_late(self, row: Row) -> None:
        """Too long ago to ring: a notification says when it ended."""
        try:
            features = self.app["features"]
            n = features.notifier
            when = features.house.local_time(datetime.fromtimestamp(row.finishes_at or self.clock(), tz=timezone.utc)).strftime("%-I:%M %p")
            payload = NB.build_action(features.house, n.opts, {"title": row.name or "Timer", "message": f"Ended at {when}, while Mantel or Home Assistant was restarting."})
            n._out(payload, None, row.entity_id)
        except Exception:  # noqa: BLE001 -- it stays silent, and is logged
            log.warning("timers: could not say that %s ended at %s", row.entity_id, row.finishes_at, exc_info=True)

    # -- the ring ----------------------------------------------------------------------------------------------------
    def _ensure_ringer(self, entity_id: str) -> None:
        task = self.ringers.get(entity_id)
        if task is None or task.done():
            self.ringers[entity_id] = asyncio.ensure_future(self._ring(entity_id))

    def _quiet(self, entity_id: str) -> None:
        task = self.ringers.pop(entity_id, None)
        if task is not None:
            task.cancel()
        if not self.ringers:
            self._listener(False)

    async def _ring(self, entity_id: str) -> None:
        """While it rings: the speakers' clip, again and again, and then it is over."""
        row = self.rows.get(entity_id)
        try:
            self._push()
            self._wake(row, R.ring_secs(self.options()["timer_ring_for"]))
            while row is not None and row.ring_until is not None and self.clock() < row.ring_until:
                started = self.clock()
                try:
                    await self._speak(row)
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001 -- a speaker that fails never stops the tablets' ring
                    log.warning("timers: the speakers did not play for %s", entity_id, exc_info=True)
                wait = max(0.0, min(started + SPEAK_EVERY, row.ring_until) - self.clock())
                await asyncio.sleep(wait)
            self.ringers.pop(entity_id, None)
            if row is not None:
                self._over(row)
        except asyncio.CancelledError:
            raise

    def _over(self, row: Row) -> None:
        self._forget(row.entity_id)
        if not self.ringers:
            self._listener(False)
        if row.made:
            self._delete(row.entity_id)
        self._push()

    def _listener(self, on: bool) -> None:
        """The Intercom's stream listener: on while a timer rings, whether or not the Intercom is on."""
        host = self.app.get("intercom")
        if host is None or host.for_timers == on:
            return
        host.for_timers = on
        self._spawn(host.apply())

    async def _speak(self, row: Row) -> None:
        host = self.app.get("intercom")
        if host is None or host.ma is None:
            return
        opts = self.options()
        area = R.area_for(row.rings_in, row.room, opts["timer_phone"])
        picks = R.speakers_for(area, opts["timer_also"], self._music_rooms(), bool(opts["timer_speaker"]))
        doc = host.doc()
        if not picks or not doc.get("stream_base"):
            if picks:
                log.info("timers: no sound on the speakers: the Intercom's Address for Music Assistant isn't set")
            return
        if host.relay.floor is not None or host.testing:
            return                               # the Intercom has the floor: the next clip plays after it
        self._listener(True)
        await host.apply()
        _house, music, pids = host.setup()
        volume = min(int(opts["timer_volume"]), int(doc.get("max_volume") or 70))
        calls = [Call(p, e, volume) for e in picks for p in music.players_of([e]) if pids.get(p)]
        if not calls:
            return
        pcm = await self._clip(opts["timer_sound"])
        spool = Spool(R.CLIP_RATE, len(pcm) / (2 * R.CLIP_RATE) + 1)
        spool.append(pcm)
        spool.finish()
        audit = self.app["audit"]
        aid = audit.record(principal=None, kind="ma", action="timer.ring", targets=[c.room for c in calls], decision="allowed",
                           reason="timer_ended", actor="mantel", actor_name="Mantel Server")
        limit = len(pcm) / (2 * R.CLIP_RATE) + 5
        token, link = host.links.mint(spool, mode="message", finite=True, limit_s=limit)
        url = f"{doc['stream_base']}/s/{token}.wav"
        run = D.IntercomRun(None, aid, {pids[c.player] for c in calls}, [url])
        result = "error:not_sent"
        try:
            out = D.Outcome(await D.announce(host.ma, run, calls, pids, url, chime=False, timeout=limit + D.CALL_GRACE, names=music.name_of))
            result = D.result_of(out, 0)
            self.spoken = [{"room": r.room, "ok": r.ok, "error": r.error} for r in out.results]
        finally:
            run.close()
            host.links.kill(link)
            audit.finish(aid, result)

    async def _clip(self, tone: str) -> bytes:
        got = self.clips.get(tone)
        if got is None:
            got = self.clips[tone] = await asyncio.get_running_loop().run_in_executor(None, R.clip_pcm, tone)
        return got

    # -- a dark tablet, woken for its room's timer's last minute ----------------------------------------------------
    def _arm_wake(self, ignore: set[str], include: set[str]) -> None:
        if self._wake_t is not None:
            self._wake_t.cancel()
            self._wake_t = None
        now, soon = self.clock(), None
        for row in self.rows.values():
            if row.finishes_at is None or row.woken or row.ring_until is not None or not R.counts(row.entity_id, ignore, include):
                continue
            left = row.finishes_at - now
            if left <= R.LAST_MINUTE:
                row.woken = True
                self._wake(row, max(0, int(left)) + R.ring_secs(self.options()["timer_ring_for"]))
            else:
                soon = left - R.LAST_MINUTE if soon is None else min(soon, left - R.LAST_MINUTE)
        if soon is not None:
            try:
                self._wake_t = asyncio.get_running_loop().call_later(soon + 0.05, lambda: self._arm_wake(*self._rules()))
            except RuntimeError:      # no loop (a test reading the rules)
                pass

    def _wake(self, row: Row | None, seconds: int) -> None:
        """The tablet in the timer's room only: a pasta timer doesn't light up a bedroom."""
        opts = self.options()
        area = R.area_for(row.rings_in, row.room, opts["timer_phone"]) if row is not None else None
        if not area or not opts["timer_wake"]:
            return
        try:
            features = self.app["features"]
            for tid, eng in list(features.engines.items()):
                if (features.tablets.get(tid) or {}).get("room") == area:
                    eng.notify_wake(row.name or "Timer", int(seconds))
        except Exception:  # noqa: BLE001 -- the ring goes on with the screen dark
            log.warning("timers: could not wake the tablet for %s", row.entity_id, exc_info=True)

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
        data = ask.get("data") or {}
        if ask.get("op") == "ring":
            return await self._ring_act(data, aid)
        if commander is None or self.no_admin:
            return None
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
                wanted = data.get("rings_in")
                row = Row(eid, name, room=getattr(device, "room", None) or None, rings_in=wanted if isinstance(wanted, str) and wanted else None,
                          set_by=getattr(device, "id", None) or getattr(user, "id", None), created=self.clock(),
                          finishes_at=self.clock() + secs, made=True, total=secs)
                self.rows[eid] = row
                self.store.save(row)
            finally:
                self.starting.discard(eid)
        return {"started": True, "slot": eid}

    async def _ring_act(self, data: dict, aid: int) -> dict:
        """Stop (one, or with no entity every one ringing), +1 Min or Restart."""
        op, eid = data.get("op"), data.get("entity_id")
        if op not in R.RING_OPS or (eid is not None and not isinstance(eid, str)):
            return {"ok": False, "reason": "unknown"}
        rows = [r for e, r in self.rows.items() if r.ring_until is not None and (eid is None or e == eid)]
        if not rows:
            return {"ok": False, "reason": "not_ringing"}
        commander = self._commander()
        for row in rows:
            if op == "stop":
                self._quiet(row.entity_id)
                self._over(row)
                continue
            secs = R.MORE_SECS if op == "more" else row.total or R.MORE_SECS
            await commander.call({"type": "call_service", "domain": "timer", "service": "start",
                                  "service_data": {"entity_id": row.entity_id, "duration": R.hms(secs)}}, CommandTicket(aid, "ws"))
        return {"ok": True, "timers": [r.entity_id for r in rows]}

    def status(self) -> dict[str, Any]:
        return {"can_make": self._commander() is not None and not self.no_admin, "following": sorted(self.rows),
                "ringing": sorted(self.ringers), "speakers": self.spoken}

    async def close(self) -> None:
        if self._wake_t is not None:
            self._wake_t.cancel()
        for task in list(self.tasks) + list(self.ringers.values()) + ([self.looking] if self.looking else []):
            task.cancel()


def register(app: web.Application, hub: Any) -> Timers:
    """``app["timers"]``, and its overlay ahead of the sessions on every batch of states."""
    host = Timers(app, hub, lambda: app["clock"]())
    app["timers"] = host
    hub.overlays.append(host.overlay)

    async def look() -> None:
        while True:
            await asyncio.sleep(SETTINGS_EVERY)
            try:
                host.settings_look()
            except Exception:  # noqa: BLE001 -- the next look
                log.debug("timers: the settings' look failed", exc_info=True)

    async def start(_app: web.Application) -> None:
        host.looking = asyncio.ensure_future(look())      # (its own: `tasks` are the ones that finish)

    async def stop(_app: web.Application) -> None:
        await host.close()
    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return host
