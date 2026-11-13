"""HomePod timers and alarms on Mantel (phase 28, docs/phase28/HOMEPOD-TIMERS.md): what the HomePod timer reader reads from
the Home app, mirrored into Home Assistant, and its commands.

The reader (a macOS virtual machine, Settings > Connections > HomePod Timer Reader) serves each HomePod's timers and alarms.
hk_core.timers.homepod has the rules; this module runs them.

* THE POLLER looks at /timers.json and /alarms.json every POLL_EVERY seconds. A reader that says it is broken, or hasn't
  answered for two minutes, is unavailable: the screens say "HomePod timers unavailable", the helpers are left as they are
  (never deleted for a list Mantel can't believe), and after ten minutes an alert goes out (alerts/sources.py).
* EVERY HOMEPOD TIMER IS A HOME ASSISTANT TIMER, as Mantel's own are (features/timers.py): ``timer.hk_homepod_<n>``,
  created when it appears, kept in step with its end and its pause, and canceled or left to finish when it's gone, then
  deleted. Every card, tablet and automation sees an ordinary timer. Mantel keeps the room, the HomePod and the reader's
  row in the `homepod_timers` table, so a restart keeps the same helpers. It NEVER RINGS IN MANTEL: the HomePod rings it.
* COMMANDS on a HomePod timer (pause, resume, cancel) and on an alarm (on, off, delete) come through the gateway, checked
  and audited as every command is, and go to the reader, which presses the sheet's own control; the helper follows on
  the next read, which comes at once.
* THE SCREENS hear it on sensor.running_quick_timers (Timers._publish): each HomePod timer's room and HomePod, the
  reader's state, and the alarms.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

import aiohttp
from aiohttp import web

from hk_core import timers as R
from hk_core.timers import homepod as H

from ..ha.ha_client import CommandTicket, HaCommandError

log = logging.getLogger("mantel.homepod_timers")

ICON = "mdi:timer-outline"
TIMEOUT = 4.0               # seconds for one look at the reader
COMMAND_WAIT = 12.0         # seconds a command may take (the reader does it within about 2)
CREATING_FOR = 30.0         # seconds a helper being made isn't made again while Home Assistant's state catches up
OVER_KEEP = 90.0            # seconds an ended timer's helper is left to finish before it is deleted anyway

Getter = Callable[[str], Awaitable[Any]]
Poster = Callable[[str, dict], Awaitable[Any]]


class HomePodStore:
    COLS = "n, tile, label, room, homepod, ends, left_s, paused, seen, first, total, over"

    def __init__(self, db: Any) -> None:
        self.db = db

    def load(self) -> dict[int, H.Known]:
        rows = self.db.execute(f"SELECT {self.COLS} FROM homepod_timers").fetchall()
        return {r[0]: H.Known(r[0], r[1], r[2], r[3], r[4], r[5], r[6], bool(r[7]), r[8], r[9], r[10], r[11]) for r in rows}

    def save(self, k: H.Known) -> None:
        with self.db:
            self.db.execute(f"INSERT OR REPLACE INTO homepod_timers ({self.COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                            (k.n, k.tile, k.label, k.room, k.homepod, k.ends, k.left, int(k.paused), k.seen, k.first, k.total, k.over))

    def drop(self, n: int) -> None:
        with self.db:
            self.db.execute("DELETE FROM homepod_timers WHERE n = ?", (n,))


class ReaderError(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code, self.message = code, message or code


class HomePodTimers:
    def __init__(self, app: web.Application, hub: Any, clock: Callable[[], float]) -> None:
        self.app, self.hub, self.clock = app, hub, clock
        self.store = HomePodStore(app["store"].db)
        self.known = self.store.load()
        self.alarms: list[H.Alarm] = []
        self.started = clock()
        self.last_ok: float | None = None
        self.broken = False
        self.error: str | None = None
        self.down_since: float | None = None
        self.creating: dict[int, float] = {}
        self.went_off: list[dict[str, Any]] = []         # one-time alarms seen going off (status, the sheet's "Went off")
        self.homes: set[str] = set()                     # every Home app room seen, for Settings' room matching
        self.get: Getter = self._get                     # (tests hand in their own reader)
        self.post: Poster = self._post
        self.task: asyncio.Task | None = None
        self.kick = asyncio.Event()
        self.lock = asyncio.Lock()
        self.published: Any = ("off", (), (), 0, ())        # what the screens were last told: nothing, for a house with no reader
        self.on_alarms: list[Callable[[], None]] = []    # hears a change of the next alarms (the linked house's sensors)
        self._next_digest: Any = None
        self._woken: set[int] = set()
        self._wake_t: Any = None

    # -- the connection ------------------------------------------------------------------------------------------------
    def _current(self) -> Any:
        conns = self.app.get("connections")
        return conns.current("homepod") if conns is not None else None

    @property
    def configured(self) -> bool:
        return self._current() is not None

    def _http(self) -> aiohttp.ClientSession:
        """The server's session, made by one of its own start-up steps: the first look can come before it (a restart
        logged a KeyError every time, 2026-11-13). Until then the look is a quiet miss and the next one, 2 s on, reads."""
        http = self.app.get("http")
        if http is None:
            raise ReaderError("not_ready", "Mantel is still starting")
        return http

    async def _get(self, path: str) -> Any:
        cur = self._current()
        if cur is None:
            raise ReaderError("not_set_up")
        try:
            async with self._http().get(cur.url + path, allow_redirects=False, timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as r:
                if r.status != 200:
                    raise ReaderError("http", f"the reader answered {r.status}")
                return await r.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError) as exc:
            raise ReaderError("unreachable", type(exc).__name__) from None

    async def _post(self, path: str, params: dict) -> Any:
        cur = self._current()
        if cur is None:
            raise ReaderError("not_set_up")
        try:
            async with self._http().post(cur.url + path, params={k: str(v) for k, v in params.items()}, allow_redirects=False,
                                             headers={"Authorization": f"Bearer {cur.token}"},
                                             timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as r:
                body = await r.json(content_type=None)
                if r.status == 401:
                    raise ReaderError("token", "the reader refused Mantel's token")
                if r.status != 200 or not isinstance(body, dict) or not body.get("ok"):
                    raise ReaderError("refused", "the reader refused the command")
                return body
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError) as exc:
            raise ReaderError("unreachable", type(exc).__name__) from None

    # -- state -----------------------------------------------------------------------------------------------------
    def availability(self) -> str:
        if not self.configured:
            return "off"
        return H.availability(self.last_ok, self.broken, self.started, self.clock())

    def alert_due(self) -> bool:
        return self.availability() == "unavailable" and H.alert_due(self.down_since, self.clock())

    def _states(self) -> dict[str, dict]:
        return self.hub.store.states

    def _areas(self) -> dict[str, str]:
        return dict(getattr(getattr(self.hub, "registry", None), "areas", None) or {})

    def _features(self) -> dict[str, Any]:
        timers = self.app.get("timers")
        return timers._features() if timers is not None else {}

    def room_of(self, home_room: str) -> str | None:
        return H.room_for(home_room, self._areas(), self._features().get("homepod_rooms") or {})[0]

    def _commander(self) -> Any:
        gw = self.app.get("gateway")
        return gw.commander if gw is not None else None

    def _ready(self) -> bool:
        ha = getattr(self.hub, "ha", None)
        return ha is None or ha.ready.is_set()

    def _can_mirror(self) -> bool:
        timers = self.app.get("timers")
        return self._commander() is not None and self._ready() and not (timers is not None and timers.no_admin)

    # -- the poller ----------------------------------------------------------------------------------------------------
    async def look(self) -> None:
        """One look at the reader, and everything that follows from it."""
        async with self.lock:
            now = self.clock()
            if not self.configured:
                self.error = None
                for k in self.known.values():
                    if k.over is None:          # the reader was disconnected: its timers' helpers go
                        k.over = "canceled"
                        self.store.save(k)
                self._after(now)
                if not self.known:
                    return
            try:
                tdoc, adoc = await self.get("/timers.json"), await self.get("/alarms.json")
                t, a = H.parse_timers(tdoc, now), H.parse_alarms(adoc)
                if t is None or a is None:
                    raise ReaderError("not_the_reader", "the address answered, but not as the reader does")
            except ReaderError as exc:
                self.error = exc.message
                self._after(now)
                return
            self.error = None
            self.broken = t[0] or a[0]
            if not self.broken:
                self.last_ok = now
                self.homes |= {r.room for r in t[1]} | {x.room for x in a[1]}
                self._follow(t[1], now)
                self._take_alarms(a[1])
            self._after(now)
        await self.mirror()

    def _after(self, now: float) -> None:
        state = self.availability()
        if state in ("ok", "off", "starting"):
            self.down_since = None
        elif self.down_since is None:
            self.down_since = now
        self._push()

    def _follow(self, reads: list[H.Read], now: float) -> None:
        pairs, new, gone = H.match(self.known.values(), reads)
        for k, r in pairs:
            k.take(r)
            self.store.save(k)
        for r in new:
            if sum(1 for k in self.known.values() if k.over is None) >= H.MAX_HELPERS:
                log.warning("homepod timers: more than %d at once; %s on %s is left out", H.MAX_HELPERS, r.label, r.tile)
                continue
            taken = set(self.known) | {n for n in (H.number_of(e) for e in self._states()) if n is not None}
            k = H.Known(H.next_number(taken), r.tile, r.label, first=now, total=int(round(r.left)))
            k.take(r)
            self.known[k.n] = k
            self.store.save(k)
            log.info("homepod timers: %s on %s (%s) is timer.hk_homepod_%d", r.label, r.homepod, r.room, k.n)
        for k in gone:
            k.over = H.how_gone(k, now)
            self.store.save(k)

    def _take_alarms(self, alarms: list[H.Alarm]) -> None:
        try:
            now = self._local(self.clock())
            for a in H.went_off(self.alarms, alarms, now):
                self.went_off = ([{"id": a.id, "label": a.label, "time": a.time, "home_room": a.room, "at": self.clock()}] + self.went_off)[:10]
                log.info("homepod timers: the %s alarm on %s went off", a.time, a.homepod)
        except Exception:  # noqa: BLE001 -- only what it says
            log.debug("homepod timers: went-off check failed", exc_info=True)
        self.alarms = alarms
        digest = self.next_alarms()
        if digest != self._next_digest:
            self._next_digest = digest
            for fn in list(self.on_alarms):
                try:
                    fn()
                except Exception:  # noqa: BLE001 -- the next change tries again
                    log.debug("homepod timers: an alarm listener failed", exc_info=True)

    def _local(self, t: float) -> datetime:
        when = datetime.fromtimestamp(t, tz=timezone.utc)
        features = self.app.get("features")
        try:
            return features.house.local_time(when) if features is not None else when.astimezone()
        except Exception:  # noqa: BLE001 -- the server's own zone
            return when.astimezone()

    # -- Home Assistant's helpers ------------------------------------------------------------------------------------
    async def _call(self, aid: int, frame: dict) -> Any:
        return await self._commander().call(frame, CommandTicket(aid, "ws"))

    async def _service(self, aid: int, eid: str, service: str, data: dict) -> Any:
        return await self._call(aid, {"type": "call_service", "domain": "timer", "service": service,
                                      "service_data": {"entity_id": eid, **data}})

    def _audit(self, action: str, eid: str, reason: str) -> int:
        return self.app["audit"].record(principal=None, kind="system", action=action, targets=[eid], decision="allowed",
                                        reason=reason, actor="mantel", actor_name="Mantel Server")

    async def mirror(self) -> None:
        """Every helper in line with what the reader last said, and any helper nobody follows deleted."""
        if not self._can_mirror():
            return
        states, now = self._states(), self.clock()
        for n, k in sorted(self.known.items()):
            eid, st = k.entity_id, states.get(k.entity_id)
            try:
                if k.over == "ended":
                    if st is None:
                        self._forget(n)
                    elif st.get("s") == "idle" or now > (k.ends or now) + OVER_KEEP:
                        await self._delete(eid, "homepod_timer_ended")
                        self._forget(n)
                    continue
                if k.over == "canceled":
                    if st is not None:
                        aid = self._audit("homepod.cancel", eid, "homepod_timer_canceled")
                        if st.get("s") in ("active", "paused"):
                            await self._service(aid, eid, "cancel", {})
                        await self._call(aid, {"type": "timer/delete", "timer_id": R.object_id(eid)})
                        self.app["audit"].finish(aid, "ok")
                    self._forget(n)
                    continue
                if self.availability() != "ok":
                    continue                       # (a list Mantel can't believe changes nothing)
                if st is None:
                    if now - self.creating.get(n, -1e18) > CREATING_FOR:
                        await self._create(k)
                    continue
                self.creating.pop(n, None)
                do = H.steps(H.helper_now(st), k, now)
                rename = (st.get("a") or {}).get("friendly_name") != k.label
                if do or rename:
                    aid = self._audit("homepod.follow", eid, "homepod_timer")
                    if rename:
                        await self._call(aid, {"type": "timer/update", "timer_id": R.object_id(eid), "name": k.label, "icon": ICON,
                                               "duration": "00:00:00", "restore": True})
                    for service, data in do:
                        await self._service(aid, eid, service, data)
                    self.app["audit"].finish(aid, "ok")
            except HaCommandError as exc:
                self._refused(exc, eid)
            except Exception as exc:  # noqa: BLE001 -- the next look tries again
                log.warning("homepod timers: %s couldn't be kept in step: %s", eid, exc)
        if self.availability() == "ok":
            for eid in [e for e in states if H.is_helper(e)]:
                n = H.number_of(eid)
                if n not in self.known and now - self.creating.get(n, -1e18) > CREATING_FOR:
                    try:
                        await self._delete(eid, "homepod_timer_unfollowed")    # left by a crash, or a row lost to a restore
                    except Exception as exc:  # noqa: BLE001 -- the next look
                        log.warning("homepod timers: couldn't delete %s: %s", eid, exc)
        self._arm_wake()

    def _refused(self, exc: HaCommandError, eid: str) -> None:
        if exc.code == "unauthorized":
            timers = self.app.get("timers")
            if timers is not None:
                timers.no_admin = True
        log.warning("homepod timers: Home Assistant refused a call on %s: %s", eid, exc.code)

    async def _create(self, k: H.Known) -> None:
        eid, now = k.entity_id, self.clock()
        if k.ringing:
            return                        # (first seen ringing, after a restart: nothing left to count)
        self.creating[k.n] = now
        aid = self._audit("homepod.create", eid, "homepod_timer")
        try:
            # (a fixed name first, for the entity id; its real name after: the id doesn't follow a rename)
            await self._call(aid, {"type": "timer/create", "name": f"HK HomePod {k.n}", "icon": ICON, "duration": "00:00:00", "restore": True})
            await self._call(aid, {"type": "timer/update", "timer_id": R.object_id(eid), "name": k.label, "icon": ICON,
                                   "duration": "00:00:00", "restore": True})
            for service, data in H.steps(None, k, now):
                await self._service(aid, eid, service, data)
            self.app["audit"].finish(aid, "ok")
        except Exception as exc:
            self.app["audit"].finish(aid, f"error:{getattr(exc, 'code', type(exc).__name__)}")
            raise

    async def _delete(self, eid: str, reason: str) -> None:
        aid = self._audit("timer/delete", eid, reason)
        await self._call(aid, {"type": "timer/delete", "timer_id": R.object_id(eid)})
        self.app["audit"].finish(aid, "ok")

    def _forget(self, n: int) -> None:
        self.known.pop(n, None)
        self.creating.pop(n, None)
        self._woken.discard(n)
        self.store.drop(n)

    # -- the last minute: the tablet in its room wakes, as for Mantel's own (Wake a Dark Screen) --------------------
    def _arm_wake(self) -> None:
        if self._wake_t is not None:
            self._wake_t.cancel()
            self._wake_t = None
        timers = self.app.get("timers")
        if timers is None or not timers.options().get("timer_wake", True):
            return
        now, soon = self.clock(), None
        for n, k in self.known.items():
            if k.over is not None or k.paused or k.ends is None or n in self._woken:
                continue
            left = k.ends - now
            if left <= R.LAST_MINUTE:
                self._woken.add(n)
                self._wake(k, max(0, int(left)) + 5)
            else:
                soon = left - R.LAST_MINUTE if soon is None else min(soon, left - R.LAST_MINUTE)
        if soon is not None:
            try:
                self._wake_t = asyncio.get_running_loop().call_later(soon + 0.05, self._arm_wake)
            except RuntimeError:
                pass

    def _wake(self, k: H.Known, seconds: int) -> None:
        area = self.room_of(k.room)
        if not area:
            return
        try:
            features = self.app["features"]
            for tid, eng in list(features.engines.items()):
                if (features.tablets.get(tid) or {}).get("room") == area:
                    eng.notify_wake(k.label or "Timer", int(seconds))
        except Exception:  # noqa: BLE001 -- the slide still shows; the screen stays dark
            log.debug("homepod timers: could not wake the tablet for %s", k.entity_id, exc_info=True)

    # -- commands (the gateway's, after its checks and its audit row) ------------------------------------------------
    def following(self, entity_id: str) -> H.Known | None:
        n = H.number_of(entity_id)
        k = self.known.get(n) if n is not None else None
        return k if k is not None and k.over is None else None

    def unavailable(self) -> str | None:
        state = self.availability()
        if state == "off":
            return "homepod_reader_off"
        return None if state == "ok" else "homepod_reader_unavailable"

    async def command(self, ask: dict) -> dict:
        """{"timer": entity, "action"} or {"alarm": id, "action"}, to the reader: {"ok": true, "command": n} once done."""
        if "timer" in ask:
            k = self.following(ask["timer"])
            if k is None or ask.get("action") not in H.TIMER_ACTIONS:
                raise HaCommandError("not_found", "that HomePod timer isn't running now")
            # (by the reader's own id where it gives one: it finds the row as the command runs)
            path, params = "/timer", ({"id": k.rid, "action": ask["action"]} if k.rid else
                                      {"tile": k.tile, "index": k.index, "action": ask["action"], "label": k.label})
        else:
            a = H.find_alarm(self.alarms, ask.get("alarm"))
            if a is None or ask.get("action") not in H.ALARM_ACTIONS:
                raise HaCommandError("not_found", "that alarm isn't on its HomePod now")
            path, params = "/alarm", {"tile": a.tile, "index": a.index, "action": ask["action"], "time": a.time}
        try:
            got = await self.post(path, params)
            cid = got.get("command")
            result = await self._wait(cid)
        except ReaderError as exc:
            raise HaCommandError(f"homepod_{exc.code}", exc.message) from None
        self.kick.set()                    # the helper follows at the next read, which is now
        return {"ok": True, "command": cid, "detail": result.get("detail")}

    async def _wait(self, cid: Any) -> dict:
        end = self.clock() + COMMAND_WAIT
        while True:
            got = await self.get(f"/command?id={int(cid)}")
            state = got.get("state") if isinstance(got, dict) else None
            if state == "done":
                return got
            if state == "failed":
                raise ReaderError("failed", str(got.get("detail") or "the HomePod's sheet didn't do it"))
            if self.clock() > end:
                raise ReaderError("timeout", "the reader didn't finish in time")
            await asyncio.sleep(0.4)

    # -- what the screens and Settings see ---------------------------------------------------------------------------
    def rows_for(self, entity_id: str) -> dict[str, Any] | None:
        k = self.following(entity_id)
        if k is None:
            return None
        area = self.room_of(k.room)
        return {"source": "homepod", "homepod": k.homepod, "home_room": k.room, "room": area,
                "room_name": self._areas().get(area) if area else k.room, "total": k.total, "ringing": k.ringing, "rang_at": k.rang_at,
                "controls": ["stop"] if k.ringing else ["pause", "resume", "cancel"]}

    def ringing(self) -> list[H.Known]:
        """The HomePod timers that went off and are ringing on their HomePod now (never in Mantel: it only says so)."""
        return [k for k in sorted(self.known.values(), key=lambda k: k.n) if k.over is None and k.ringing]

    def decorate(self, attrs: dict[str, Any]) -> None:
        """sensor.running_quick_timers: each HomePod timer's row says whose it is, and `homepod` the reader and the alarms."""
        for r in attrs.get("running") or []:
            got = self.rows_for(r.get("entity_id", ""))
            if got is not None:
                r.update(got)
        homepods = {}
        for k in self.known.values():
            got = self.rows_for(k.entity_id)
            if got is not None:
                homepods[k.entity_id] = got
        # RINGING ON ITS HOMEPOD: Time's Up as Mantel's own timers show it, with no sound from a screen (`tablet` false, no
        # speakers) and Stop going to the HomePod; on the cards too, though its helper has finished
        states = self._states()
        for k in self.ringing():
            got = homepods.get(k.entity_id) or {}
            attrs.setdefault("ringing", []).append({"entity_id": k.entity_id, "name": k.label or "Timer", "until": None, "tablet": False,
                                                    "areas": [got["room"]] if got.get("room") else [], "speakers": [], "tone": None, **got})
            if k.entity_id in states and k.entity_id not in (attrs.get("made") or []):
                attrs.setdefault("made", []).append(k.entity_id)
        state = self.availability()
        areas = self._areas()
        alarms = []
        for a in self.alarms if state == "ok" else []:
            area = self.room_of(a.room)
            alarms.append({**a.public(), "room": area, "room_name": areas.get(area) if area else a.room})
        attrs["homepod"] = {"state": state, "timers": homepods, "alarms": alarms, "went_off": self.went_off[:3],
                            "can_mirror": self._can_mirror(),
                            "rooms": H.room_table(self.homes, areas, self._features().get("homepod_rooms") or {})}

    def _push(self) -> None:
        state = (self.availability(), tuple((k.n, k.label, k.paused, k.over, k.ringing) for k in self.known.values()),
                 tuple((a.id, a.enabled) for a in self.alarms), len(self.went_off), tuple(sorted(self.homes)))
        if state != self.published:
            self.published = state
            self.hub.on_change({R.SENSOR})

    def next_alarms(self) -> list[dict[str, Any]]:
        """Each HomePod's next alarm, for its sensor in Home Assistant (Mantel Link)."""
        if self.availability() != "ok" and not self.alarms:
            return []
        names = {a.tile: (a.homepod, a.room) for a in self.alarms}
        out = []
        for tile, got in sorted(H.next_alarms(self.alarms, self._local(self.clock())).items()):
            homepod, room = names.get(tile, ("HomePod", ""))
            row = {"tile": tile, "homepod": homepod, "home_room": room, "slug": H.slug(f"{room} {homepod}"), "at": None}
            if got is not None:
                a, at = got
                row.update(at=at.isoformat(), label=a.label, time=a.time, repeats=a.repeats)
            out.append(row)
        return out

    def status(self) -> dict[str, Any]:
        """Settings > Timers and Settings > Connections: the reader's state and the room matching."""
        areas = self._areas()
        return {"state": self.availability(), "error": self.error, "broken": self.broken, "last_ok": self.last_ok,
                "down_since": self.down_since, "can_mirror": self._can_mirror(),
                "timers": [{"entity_id": k.entity_id, "label": k.label, "homepod": k.homepod, "home_room": k.room,
                            "paused": k.paused, "over": k.over} for k in sorted(self.known.values(), key=lambda k: k.n)],
                "alarms": len(self.alarms),
                "rooms": H.room_table(self.homes, areas, self._features().get("homepod_rooms") or {}),
                "areas": sorted(({"id": a, "name": n} for a, n in areas.items()), key=lambda x: x["name"])}

    # -- running -----------------------------------------------------------------------------------------------------
    async def run(self) -> None:
        while True:
            try:
                await self.look()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 -- the next look
                log.exception("homepod timers: a look failed")
            self.kick.clear()
            try:
                await asyncio.wait_for(self.kick.wait(), H.POLL_EVERY)
            except asyncio.TimeoutError:
                pass

    async def close(self) -> None:
        if self._wake_t is not None:
            self._wake_t.cancel()
        if self.task is not None:
            self.task.cancel()


def register(app: web.Application, hub: Any) -> HomePodTimers:
    """``app["homepod_timers"]``, polling once the server starts (after ``timers.register``: the sensor is the timers')."""
    host = HomePodTimers(app, hub, lambda: app["clock"]())
    app["homepod_timers"] = host
    conns = app.get("connections")
    if conns is not None:
        async def applied(kind: str, _cur: Any) -> None:
            if kind == "homepod":              # saved or disconnected: look now, and start the count again
                host.last_ok, host.broken, host.started = None, False, host.clock()
                host.kick.set()
        conns.appliers.append(applied)

    async def start(_app: web.Application) -> None:
        host.started = host.clock()
        host.task = asyncio.ensure_future(host.run())

    async def stop(_app: web.Application) -> None:
        await host.close()
    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return host
