"""THE INTERCOM ON MANTEL (docs/phase17/INTERCOM.md), ``app["intercom"]``: its settings, its stream listener, the
audio socket's relay, and the broadcast itself. The decisions are hk_core.intercom's; this file is the host's steps.

It needs house commands on (it makes sound in the house), Music Assistant configured in Mantel, the music settings in
Mantel's store (its rooms are the music rooms), and the Intercom turned on in Settings -> Intercom with the address
Music Assistant fetches from. The stream listener (listener.py) runs only while all of that holds and
``--stream-port`` is set.
"""
from __future__ import annotations

import asyncio
import dataclasses
import logging
import time
from typing import Any, Callable
from urllib.parse import urlsplit

from hk_core.house import area_of
from hk_core.intercom import config as C, rooms as R

from . import driver as D
from .links import Links
from .listener import StreamListener
from .relay import IntercomRelay
from .spool import Spool

log = logging.getLogger("mantel.intercom")

DOC = "intercom"                    # house/<this>
OVERRIDE_ROLES = frozenset({"owner", "admin", "adult"})       # may press Send Anyway (decision 10)
REMOTE_DOORS = frozenset({"tunnel"})
MA_CACHE = 4.0
GROUP_FAILED = "group_failed"       # a Live room whose temporary group's leader failed: not the room's own failure
MARK_GRACE = 2.0                    # a room that played stays out of the music players this much longer (its last updates)


class IntercomHost:
    def __init__(self, app: Any, hub: Any, clock: Callable[[], float] = time.time) -> None:
        self.app, self.hub = app, hub
        cfg = app.get("cfg")
        self.stream_port = int(getattr(cfg, "stream_port", 0) or 0)
        self.bind = getattr(cfg, "host", "0.0.0.0") or "0.0.0.0"
        self.links = Links(cfg, expected_peer=self.ma_peer)
        self.listener: StreamListener | None = None
        self.relay = IntercomRelay(self, clock)
        self.listeners_feed: Any = None              # routes.py: tells listener tablets (17.4)
        self._apply_lock = asyncio.Lock()
        self.check_lock = asyncio.Lock()             # one Check Reach at a time (routes.api_check)
        self.last_broadcast: dict[str, Any] | None = None
        self.last_test = -1e9
        self.testing: str | None = None          # Send Test holds the floor while its chime plays
        self._ma_cache: tuple[float, Any] | None = None
        self._parting: set[asyncio.Task] = set()     # temporary groups of a stopped Live talk, going back

    # -- settings --------------------------------------------------------------------------------------------
    @property
    def store(self) -> Any:
        return getattr(self.app.get("settings"), "store", None)

    def doc(self) -> dict:
        store = self.store
        if store is None:
            return C.defaults()
        try:
            return C.check(store.body("house", DOC) or None)
        except ValueError:
            log.exception("intercom: house/intercom is not readable; the Intercom stays off")
            return C.defaults()

    def save(self, doc: dict, actor: Any, action: str = "set") -> dict:
        checked = C.check(doc)
        self.store.write([("house", DOC, checked)], actor=actor, action=action)
        return checked

    def limit_s(self, doc: dict, mode: str) -> int:
        return C.limit_s(doc, mode)

    def max_picks(self) -> int:
        return R.MAX_ROOMS

    def new_spool(self, rate: int, limit: float) -> Spool:
        return Spool(rate, limit)

    # -- what it runs on -------------------------------------------------------------------------------------
    @property
    def music(self) -> Any:
        return self.app.get("music")

    @property
    def ma(self) -> Any:
        return self.app.get("ma")

    def ma_peer(self) -> str | None:
        """The address Music Assistant's fetch must come from, when Mantel reaches it by an IP address."""
        client = self.ma
        url = getattr(client, "ws_url", None) if client is not None else None
        if not url:
            return None
        host = urlsplit(url).hostname or ""
        import ipaddress
        try:
            return str(ipaddress.ip_address(host))
        except ValueError:
            return None

    def setup(self) -> tuple[Any, Any, dict[str, str]]:
        """(the house, the music configuration, {media_player entity: Music Assistant id})."""
        from ..music import ma_players
        m = self.music
        return m.house, m.config(), ma_players(self.hub.registry)

    async def ma_raw(self, cached: bool = False) -> Any:
        """Music Assistant's players/all, read now (a read: no gate, no audit); None when it can't be read. A
        broadcast always reads it fresh; the sheet's feed may use one read up to MA_CACHE seconds old."""
        if cached and self._ma_cache is not None and time.monotonic() - self._ma_cache[0] < MA_CACHE:
            return self._ma_cache[1]
        client = self.ma
        if client is None or not client.connected.is_set():
            return None
        try:
            got = await client.players()
        except Exception as err:  # noqa: BLE001 -- unreadable: the group check skips every room
            log.info("intercom: Music Assistant's players could not be read (%s)", type(err).__name__)
            return None
        self._ma_cache = (time.monotonic(), got)
        return got

    def changed(self) -> None:
        if self.listeners_feed is not None:
            self.listeners_feed.changed()

    def unavailable(self, principal: Any, mode: str, rate: int) -> str | None:
        """Why the Intercom can't be opened now (the gateway asks before its row; the relay again)."""
        doc = self.doc()
        if not doc["enabled"]:
            return "intercom_off"
        if mode == "live" and not C.live_offered(doc):
            return "live_off"
        if mode == "live" and principal is not None and principal.identity.door in REMOTE_DOORS:
            return "live_not_away"        # decision 8: away from home, a Message only
        if self.music is None or not self.music.active:
            return "music_assistant_off"
        if not doc["stream_base"]:
            return "intercom_no_address"
        if self.listener is None or not self.listener.running:
            return "intercom_not_listening"
        return None

    # -- the listener ----------------------------------------------------------------------------------------
    async def apply(self) -> None:
        """Start or stop the stream listener to match the settings (on save, at start)."""
        async with self._apply_lock:
            want = bool(self.stream_port) and self.doc()["enabled"] and self.app.get("gateway") is not None
            if want and (self.listener is None or not self.listener.running):
                self.listener = StreamListener(self.links, self.bind, self.stream_port)
                try:
                    await self.listener.start()
                    log.info("intercom: the stream listener is on port %s", self.stream_port)
                except OSError as err:
                    log.error("intercom: could not listen on port %s: %s", self.stream_port, err)
                    self.listener = None
            elif not want and self.listener is not None:
                self.links.kill_all()
                await self.listener.stop()
                self.listener = None
                log.info("intercom: the stream listener is off")

    async def start_listener_for_check(self) -> None:
        """Check Reach before the Intercom is on: the listener for the check's own link only (apply() stops it).
        Never while house commands are off: the port stays closed then, as apply() keeps it."""
        async with self._apply_lock:
            if self.app.get("gateway") is None:
                return
            if self.stream_port and (self.listener is None or not self.listener.running):
                self.listener = StreamListener(self.links, self.bind, self.stream_port)
                try:
                    await self.listener.start()
                except OSError as err:
                    log.error("intercom: could not listen on port %s: %s", self.stream_port, err)
                    self.listener = None

    async def close(self) -> None:
        await self.relay.close()
        await self._parted()
        self.links.kill_all()
        if self.listener is not None:
            await self.listener.stop()
            self.listener = None

    # -- who is asking ---------------------------------------------------------------------------------------
    def here(self, principal: Any, house: Any = None, music: Any = None) -> list[str]:
        """The sender's own rooms: its tablet's enrolled room's speakers, and any room listing the tablet as a
        listener. A phone (no tablet) has none."""
        device = getattr(getattr(principal, "identity", None), "device", None)
        if device is None:
            return []
        doc = self.doc()
        out = list(C.rooms_of_tablet(doc, device.id))
        if device.room and house is not None and music is not None:
            out += [r for r in music.room_ids if area_of(house, house.entity(r)) == device.room]
        return list(dict.fromkeys(out))

    def allowed(self, principal: Any) -> Callable[[str], bool]:
        authz = self.app["authz"]
        subject, ctx = principal.subject, authz.context()
        return lambda r: authz.decide_intercom(subject, "control", r, ctx=ctx).allowed

    def may_override(self, principal: Any) -> bool:
        user = getattr(getattr(principal, "identity", None), "user", None)
        return user is not None and user.role in OVERRIDE_ROLES

    async def _parted(self) -> None:
        """Any stopped talk's speakers are back on their own (the page's own copy, sent the moment its socket drops, is
        decided after this, and plays as a broadcast of its own)."""
        if self._parting:
            await asyncio.wait(set(self._parting), timeout=D.SETTLE_WAIT + 2 * D.GROUP_WAIT + 2)

    def held(self) -> Any:
        """The speakers holding paused music (the music engine's resumes): left alone."""
        resumes = getattr(self.music, "resumes", None)
        return resumes.players(time.monotonic()) if resumes is not None else ()

    async def plan(self, principal: Any, picks: list[str], mode: str, override: bool, borrow: bool = True) -> Any:
        await self._parted()
        house, music, pids = self.setup()
        doc = self.doc()
        rooms = R.expand(music, picks)
        return R.decide(house, music, doc, rooms, mode=mode, here=self.here(principal, house, music),
                        override=override and self.may_override(principal), allowed=self.allowed(principal),
                        ma_raw=await self.ma_raw(), pids=pids, held=self.held(), borrow=borrow), pids, music

    def _later(self, coro: Any) -> asyncio.Task:
        """Speakers going back after a stopped talk: the socket doesn't wait for it, the next broadcast does (_parted)."""
        task = asyncio.get_running_loop().create_task(coro)
        self._parting.add(task)
        task.add_done_callback(self._parting.discard)
        return task

    async def _borrow(self, aid: int, run: Any, plan: Any, pids: dict) -> tuple[Any, list[Any]]:
        """The plan's groups left from music taken apart (rooms.leftovers), the music players leaving their speakers as
        they were. Returns the plan without the calls that can't be made now (a leader whose group didn't come apart
        would play on all of it) and those calls."""
        if not plan.loose:
            return plan, []
        tracker = getattr(self.music, "announcements", None)
        entity = {v: k for k, v in pids.items()}
        if tracker is not None:
            for g in plan.loose:
                tracker.mark(f"intercom:{aid}:lent:{g.leader}", [entity.get(m, m) for m in g.members])
        stuck = await D.borrow(self.ma, run, plan.loose)
        if not stuck:
            return plan, []
        log.info("intercom: %d group(s) left from music didn't come apart; their leaders' rooms are left out", len(stuck))
        out = [c for c in plan.calls if pids.get(c.player) in stuck]
        keep = [c for c in plan.calls if pids.get(c.player) not in stuck]
        sync = [g for g in plan.sync if not any(pids.get(c.player) in stuck for c in g.calls)]
        return R.Plan(rooms=plan.rooms, calls=keep, sync=sync, loose=plan.loose), out

    async def _covered(self, plan: Any, pids: dict, music: Any) -> tuple[Any, str]:
        """EVERY ROOM PICKED IS CALLED OR REALLY REACHED (2026-11-05: 0.1.134's plan had a leader's call "cover" eight rooms it
        had just let go, and called none of them; the audit said ok). Just before the calls, each call that is to play on
        others is checked against Music Assistant's list now: a room it wouldn't reach gets a call of its own. Returns the
        plan and a note for the audit ("uncovered:<rooms>"), empty when nothing was missing."""
        if not any(c.covers for c in plan.calls):
            return plan, ""
        view = R.ma_view(await self.ma_raw())
        if view is None:
            return plan, ""                     # unreadable now: the plan was made from a list read moments ago
        calls, extra, missed = [], [], []
        for c in plan.calls:
            if not c.covers:
                calls.append(c)
                continue
            lead = pids.get(c.player, "")
            reach = set((view.get(lead) or {}).get("members") or ()) | {o for o, w in view.items() if w.get("synced_to") == lead}
            lost = [m for m in c.covers if pids.get(m) not in reach]
            if not lost:
                calls.append(c)
                continue
            calls.append(dataclasses.replace(c, covers=[m for m in c.covers if m not in lost]))
            for m in lost:
                room = next((r["room"] for r in plan.playing if m in music.players_of([r["room"]])), c.room)
                extra.append(R.Call(m, room, c.volume, live=c.live))
                missed.append(room)
        if not extra:
            return plan, ""
        log.warning("intercom: %d room(s) a group was to reach weren't in it; each gets a call of its own", len(extra))
        return (R.Plan(rooms=plan.rooms, calls=calls + extra, sync=plan.sync, loose=plan.loose),
                "uncovered:" + ",".join(dict.fromkeys(missed)))

    async def _give_back(self, aid: int, run: Any, loose: list[Any]) -> None:
        if not loose:
            return
        await D.give_back(self.ma, run, loose)
        tracker = getattr(self.music, "announcements", None)
        if tracker is not None:
            for g in loose:
                tracker.unmark(f"intercom:{aid}:lent:{g.leader}", grace=MARK_GRACE)

    # -- a Message ---------------------------------------------------------------------------------------------
    async def send_message(self, s: Any, picks: list[str], override: bool) -> str:
        """Send's steps: decide, floor, rate, the intercom.play row, the link, the calls. Returns the socket's audit
        result, or ``refused:<why>`` when nothing was sent and the draft stays (the page may try again)."""
        relay = self.relay
        authz = self.app["authz"]
        if not authz.refresh(s.principal):
            await s.ws.send_json({"type": "error", "code": "unauthenticated"})
            return "error:unauthenticated"
        why = self.unavailable(s.principal, "message", s.rate)
        if why:
            await s.ws.send_json({"type": "error", "code": why})
            return f"error:{why}"
        plan, pids, music = await self.plan(s.principal, picks, "message", override)
        await s.ws.send_json({"type": "rooms", "rooms": _public(plan.rooms),
                              "can_override": self.may_override(s.principal)})
        if not plan.calls:
            await s.ws.send_json({"type": "error", "code": "no_rooms", "message": plan.nothing_reason()})
            return "refused:no_rooms"
        busy = relay.busy_name(s)
        if busy:
            await s.ws.send_json({"type": "busy", "name": busy})
            return "refused:busy"
        if not relay.rate_ok(s):
            await s.ws.send_json({"type": "error", "code": "rate",
                                  "message": "That's a lot of announcements; wait a few minutes"})
            return "refused:rate"
        relay.floor = s
        try:
            return await self._broadcast(s, plan, pids, music, override)
        finally:
            if relay.floor is s:
                relay.floor = None

    async def _broadcast(self, s: Any, plan: Any, pids: dict, music: Any, override: bool) -> str:
        doc = self.doc()
        audit = self.app["audit"]
        spool = s.spool
        spool.finish()
        targets = [r["room"] for r in plan.playing]
        try:
            aid = audit.record(principal=s.principal, kind="ma", action="intercom.play", targets=targets,
                               decision="allowed", reason=D.reason_of(plan, override=override and self.may_override(s.principal),
                                                  mode="message"))
        except Exception:  # noqa: BLE001 -- no row, no sound
            log.exception("intercom: the intercom.play row could not be written; nothing played")
            await s.ws.send_json({"type": "error", "code": "audit_unavailable"})
            return "error:audit_unavailable"
        s.broadcast = plan
        token, link = self.links.mint(spool, mode="message", finite=True, limit_s=C.limit_s(doc, "message"))
        url = f"{doc['stream_base']}/s/{token}.wav"
        run = D.IntercomRun(s.principal, aid, _speakers(plan, pids), [url],
                            groups={pids[g.leader.player]: [pids[c.player] for c in g.members] for g in plan.sync},
                            lent={g.leader: g.members for g in plan.loose})
        links = [link]
        loose, every = list(plan.loose), list(plan.calls)

        def new_url() -> str:
            """The fall back's link (a temporary group that didn't start: Music Assistant may have read the first)."""
            again, more = self.links.mint(spool, mode="message", finite=True, limit_s=C.limit_s(doc, "message"))
            links.append(more)
            address = f"{doc['stream_base']}/s/{again}.wav"
            run.add_url(address)
            return address

        outcome = D.Outcome()
        result = "error:not_sent"
        try:
            await self._say(s, {"type": "sending", "rooms": len({c.room for c in plan.calls})})
            self._tell_listeners(doc, plan, spool, s)
            self._hide(aid, plan.calls)
            plan, out = await self._borrow(aid, run, plan, pids)
            plan, uncovered = await self._covered(plan, pids, music)
            outcome.results = await D.broadcast(
                self.ma, run, plan, pids, url, new_url=new_url, chime=doc["chime"]["message"],
                timeout=C.limit_s(doc, "message") + D.CALL_GRACE, names=music.name_of,
                done=lambda call, ok: self._show(aid, call, ok))
            outcome.results += [D.RoomResult(c.room, music.name_of(c.room), c.player, error=D.STILL_GROUPED) for c in out]
            result = D.result_of(outcome, len(plan.skipped))
            await self._say(s, {"type": "sent", "rooms": _reached(every, outcome, music), "failed": outcome.failed})
            return result
        finally:
            if loose:
                await asyncio.shield(self._give_back(aid, run, loose))
            self._show_all(aid, every)
            run.close()
            for one in links:
                self.links.kill(one)
            self._finish(aid, result, [_failures("failed", outcome.results), uncovered], s.principal)
            s.broadcast = None
            self.last_broadcast = None

    # -- the music players leave it out (docs/phase17/INTERCOM-SYNC.md part A) ---------------------------------------
    def _hide(self, aid: int, calls: list[Any], again: bool = False) -> None:
        """Before the first command: the Music card, Side Pane, player, screensaver and iOS app leave these rooms as
        they were. Not a room playing music: Music Assistant mixes the message into it, its song and cover don't change,
        and a marked room would leave Now Playing while its music goes on."""
        tracker = getattr(self.music, "announcements", None)
        if tracker is None:
            return
        for call in calls:
            if again or not self._playing(call.room):
                # (``again``: Live's rooms heard the talk as a Message after; "playing" then is Live's own sound)
                tracker.mark(_mark_key(aid, call), [call.player, *call.covers])

    def _show(self, aid: int, call: Any, ok: bool) -> None:
        tracker = getattr(self.music, "announcements", None)
        if tracker is not None:
            tracker.unmark(_mark_key(aid, call), grace=MARK_GRACE if ok else 0)

    def _show_all(self, aid: int, calls: list[Any]) -> None:
        """Whatever way the broadcast ended (a room's own result has already said so, with its grace)."""
        tracker = getattr(self.music, "announcements", None)
        if tracker is not None:
            for call in calls:
                key = _mark_key(aid, call)
                if not tracker.ending(key):
                    tracker.unmark(key)

    @staticmethod
    async def _say(s: Any, msg: dict) -> None:
        """A word to the page once the sound has been decided: best effort. A page that closed its sheet (its socket
        gone) must not stop what was already sent from playing."""
        try:
            if not s.ws.closed:
                await s.ws.send_json(msg)
        except (ConnectionError, RuntimeError):
            pass

    def _finish(self, aid: int, result: str, notes: Any = (), principal: Any = None) -> None:
        try:
            self.app["audit"].finish(aid, result)
        except Exception:  # noqa: BLE001
            log.exception("could not write the result of intercom audit row %d", aid)
        note = " ".join(n for n in notes if n)
        if not note:
            return
        # WHICH ROOMS DIDN'T PLAY, AND WHY (2026-11-05): a row of its own, as the audit is append-only, pointing at the
        # broadcast's row. Mantel's log starts again at every restart; this is kept. Room ids and signals, never content.
        rooms = sorted({r.split("=", 1)[0] for part in note.split() for r in part.split(":", 1)[-1].split(",") if "=" in r or part.startswith("dropped:")})
        try:
            self.app["audit"].record(principal=principal, kind="ma", action="intercom.failures", targets=rooms,
                                     decision="allowed", reason=f"play:{aid} {note}"[:1000], result="noted")
        except Exception:  # noqa: BLE001
            log.exception("could not write the failures of intercom audit row %d", aid)

    def _tell_listeners(self, doc: dict, plan: Any, spool: Any, s: Any) -> None:
        """17.4: listener tablets of a room in this broadcast play it themselves (routes.py's feed)."""
        feed = self.listeners_feed
        if feed is None:
            return
        rooms = [r["room"] for r in plan.playing]
        tablets = C.listeners_of(doc, rooms)
        me = getattr(getattr(s.principal.identity, "device", None), "id", None)
        tablets.discard(me)                    # echo: a tablet that is speaking is not a listener of its own
        if tablets:
            try:
                feed.play(spool, tablets, rooms, doc)
            except Exception:  # noqa: BLE001 -- the HomePods play either way
                log.exception("intercom: could not tell the listener tablets")

    # -- Live (17.5) -------------------------------------------------------------------------------------------
    async def live_frame(self, s: Any, msg: dict) -> str | None:
        """``start`` (decide, floor, row, the live link, the calls to the rooms that can be live) or ``end`` (the
        talker finished: wait for the live rooms, then the fallback). None keeps the socket going."""
        kind = msg.get("type")
        if kind == "end" and set(msg) == {"type"}:
            if s.broadcast is None:
                s.close_code = 1008
                return "refused:bad_message"
            return await self.live_end(s, "end")
        rooms = msg.get("rooms")
        if (kind != "start" or set(msg) != {"type", "rooms"} or s.broadcast is not None or not isinstance(rooms, list)
                or not all(isinstance(r, str) for r in rooms) or len(rooms) > self.max_picks()):
            s.close_code = 1008
            return "refused:bad_message"
        authz = self.app["authz"]
        if not authz.refresh(s.principal):
            await s.ws.send_json({"type": "error", "code": "unauthenticated"})
            return "error:unauthenticated"
        why = self.unavailable(s.principal, "live", s.rate)
        if why:
            await s.ws.send_json({"type": "error", "code": why})
            return f"refused:{why}"
        plan, pids, music = await self.plan(s.principal, rooms, "live", False)
        await s.ws.send_json({"type": "rooms", "rooms": _public(plan.rooms), "can_override": False})
        if not plan.calls:
            await s.ws.send_json({"type": "error", "code": "no_rooms", "message": plan.nothing_reason()})
            return None
        busy = self.relay.busy_name(s)
        if busy:
            await s.ws.send_json({"type": "busy", "name": busy})
            return None
        if not self.relay.rate_ok(s):
            await s.ws.send_json({"type": "error", "code": "rate",
                                  "message": "That's a lot of announcements; wait a few minutes"})
            return None
        doc = self.doc()
        try:
            aid = self.app["audit"].record(principal=s.principal, kind="ma", action="intercom.play",
                                           targets=[r["room"] for r in plan.playing], decision="allowed",
                                           reason=D.reason_of(plan, override=False, mode="live"))
        except Exception:  # noqa: BLE001 -- no row, no sound
            log.exception("intercom: the intercom.play row could not be written; nothing played")
            await s.ws.send_json({"type": "error", "code": "audit_unavailable"})
            return "error:audit_unavailable"
        self.relay.floor = s
        limit = C.limit_s(doc, "live")
        s.spool = self.new_spool(s.rate, limit)
        token, link = self.links.mint(s.spool, mode="live", finite=False, limit_s=limit)
        url = f"{doc['stream_base']}/s/{token}.wav"
        run = D.IntercomRun(s.principal, aid, _speakers(plan, pids), [url],
                            groups={pids[g.leader.player]: [pids[c.player] for c in g.members] for g in plan.sync},
                            lent={g.leader: g.members for g in plan.loose})
        self._hide(aid, [c for c in plan.calls if c.live])
        plan, out = await self._borrow(aid, run, plan, pids)
        plan, uncovered = await self._covered(plan, pids, music)
        for c in out:                          # its group didn't come apart: the Message at the end decides it again
            c.live = False
            plan.calls.append(c)
        s.broadcast = LiveBroadcast(plan, pids, music, doc, aid, run, link, url, asyncio.get_running_loop().time())
        if uncovered:
            s.broadcast.notes.append(uncovered)
        s.broadcast.task = asyncio.get_running_loop().create_task(self._live_calls(s, s.broadcast))
        after = plan.names("after")
        await self._say(s, {"type": "sending", "rooms": len({c.room for c in plan.calls}),
                              "live": sum(1 for r in plan.rooms if r["live"]), "after": after,
                              "lag_ms": doc.get("lag_ms")})
        return None

    async def _live_calls(self, s: Any, b: "LiveBroadcast") -> None:
        """The live rooms' calls, each watched for the five failure signals (docs/phase17/INTERCOM.md). Rooms that can
        play in step make one temporary group, called through its leader and watched room by room; a group that doesn't
        come together makes one call per room, on the same link (nothing has read it yet)."""
        live_calls = [c for c in b.plan.calls if c.live]
        if not live_calls:
            return
        loop = asyncio.get_running_loop()
        calling: dict[str, asyncio.Task] = {}
        called: dict[str, asyncio.Event] = {c.player: asyncio.Event() for c in live_calls}    # watching starts here

        async def one(call: Any, *, leads: bool = False) -> D.RoomResult:
            res = D.RoomResult(call.room, b.music.name_of(call.room), call.player, live=True)
            args: dict[str, Any] = {"player_id": b.pids[call.player], "url": b.url,
                                    "pre_announce": bool(b.doc["chime"]["live"])}
            if call.volume is not None:
                args["volume_level"] = int(call.volume)
            task = loop.create_task(self.ma.command(b.run, D.ANNOUNCE,
                                                    timeout=C.limit_s(b.doc, "live") + D.CALL_GRACE, **args))
            calling[call.player] = task
            called[call.player].set()
            while True:
                done, _ = await asyncio.wait({task}, timeout=0.5)
                if done:
                    break
                if call.player in b.failed and s.spool is not None and s.spool.finished:
                    # failed live and the talker is done: fall back now, not when Music Assistant gives up
                    if not leads:                     # (a leader's call: settle waits for it, then the group parts)
                        task.cancel()
                        await asyncio.gather(task, return_exceptions=True)
                    res.error = b.why.get(call.player, "failed")
                    return res
            try:
                task.result()
                res.ok = True
                if not s.spool.finished and not s.spool.dropped:
                    res.ok, res.error = False, "returned_early"           # signal 5
            except asyncio.CancelledError:
                res.error = "cancelled"
            except Exception as exc:  # noqa: BLE001
                res.error = D.error_code(exc)                            # signal 2
            return res

        async def together(sync: Any) -> list[D.RoomResult]:
            leader, members = b.pids[sync.leader.player], [b.pids[c.player] for c in sync.members]
            try:
                why = await D._join(self.ma, b.run, leader, members)
                if why is not None:
                    log.info("intercom: a Live group of %d fell back to one call per room (%s)", len(sync.calls), why)
                    await D.settle(self.ma, b.run, leader, members)
                    safe, grouped = await D.on_their_own(self.ma, sync.calls, b.pids)
                    for c in grouped:             # the Message at the end decides them again, group check and all
                        watchers[c.player].cancel()
                    return [*await asyncio.gather(*map(one, safe)),
                            *(D.RoomResult(c.room, b.music.name_of(c.room), c.player, live=True, error=D.STILL_GROUPED)
                              for c in grouped)]
                for c in sync.members:
                    called[c.player].set()
                said = await one(sync.leader, leads=True)
            except BaseException:
                # stopped: the socket's end must not wait for the speakers, but the next broadcast does (_parted)
                self._later(D.settle(self.ma, b.run, leader, members, calling.get(sync.leader.player)))
                raise
            await D.settle(self.ma, b.run, leader, members, calling.get(sync.leader.player))
            return [said, *(D.RoomResult(c.room, b.music.name_of(c.room), c.player, ok=said.ok, live=True,
                                         error=None if said.ok else GROUP_FAILED) for c in sync.members)]

        async def watch(call: Any) -> None:
            await called[call.player].wait()
            t_call = loop.time()
            try:
                await asyncio.wait_for(b.link.fetch_started.wait(), D.CLAIM_WAIT)
            except asyncio.TimeoutError:
                b.failed.add(call.player)                                 # signal 1
                b.why.setdefault(call.player, "not_fetched")
                return
            deadline = t_call + D.PLAYING_WAIT
            while loop.time() < deadline:
                if self._playing(call.player):
                    b.lags.append(loop.time() - b.t0)
                    return
                await asyncio.sleep(0.2)
            b.failed.add(call.player)                                     # signal 3
            b.why.setdefault(call.player, "not_playing")

        watchers = {c.player: loop.create_task(watch(c)) for c in live_calls}
        try:
            grouped = {id(c) for g in b.plan.sync for c in g.calls}
            alone = [one(c) for c in live_calls if id(c) not in grouped]
            results = [r for part in await asyncio.gather(asyncio.gather(*alone), *map(together, b.plan.sync))
                       for r in part]
            await asyncio.gather(*watchers.values(), return_exceptions=True)     # each ends by its own wait (<= 10 s)
        finally:
            for w in watchers.values():                                  # only left running when aborted
                w.cancel()
            await asyncio.gather(*watchers.values(), return_exceptions=True)
        for r in results:
            if b.link.ended_early:
                r.ok, r.error = False, r.error or "fetch_ended_early"    # signal 4
            if r.player in b.failed:
                r.ok, r.error = False, r.error or b.why.get(r.player, "failed")
        by_player = {r.player: r for r in results}
        for g in b.plan.sync:                                            # a leader that failed took its members with it
            if not by_player[g.leader.player].ok and by_player[g.leader.player].error != D.STILL_GROUPED:
                for c in g.members:
                    if by_player[c.player].error != D.STILL_GROUPED:
                        by_player[c.player].ok, by_player[c.player].error = False, GROUP_FAILED
        for r in results:
            if not r.ok:                    # which of the five signals, never what was said
                log.info("intercom: %s didn't play live (%s)", r.name, r.error)
        b.results = list(results)

    def _playing(self, player: str) -> bool:
        m = self.music
        try:
            from hk_core.music import engine as E
            return E.state_of(m.house, player) == "playing"
        except Exception:  # noqa: BLE001
            return False

    async def live_end(self, s: Any, why: str) -> str:
        """The talker finished (``end``, LIVE_IDLE without audio, or the limit): the live rooms play out, then every
        room that failed live and every ``after`` room hears the WHOLE spool as a Message on a new link."""
        b: LiveBroadcast = s.broadcast
        s.spool.finish()
        result = "error:not_sent"
        try:
            if b.task is not None:
                await b.task
            failed = [r for r in b.results if not r.ok]
            retry = [c for c in b.plan.calls if not c.live or any(r.player == c.player for r in failed)]
            if retry:
                # THE GROUP CHECK AGAIN, NOW: the talk may have lasted a minute, and a room grouped meanwhile under a
                # leader (or made to lead) would carry the message further. Only calls a fresh plan still makes go out.
                # (with the rooms a leader's call covers: without them, its own members look like outsiders)
                covered = {p for c in retry for p in c.covers}
                rooms = list(dict.fromkeys([*(c.room for c in retry),
                                            *(r["room"] for r in b.plan.playing
                                              if covered.intersection(b.music.players_of([r["room"]])))]))
                fresh, _pids, _music = await self.plan(s.principal, rooms, "message", False, borrow=False)
                again = {(c.player, tuple(c.covers)) for c in fresh.calls}
                dropped = sorted({c.room for c in retry if (c.player, tuple(c.covers)) not in again})
                wanted = {(c.player, tuple(c.covers)) for c in retry}
                retry = [c for c in fresh.calls if (c.player, tuple(c.covers)) in wanted]
                sets = [g for g in fresh.sync if all((c.player, tuple(c.covers)) in wanted for c in g.calls)]
                b.run.add_groups({b.pids[g.leader.player]: [b.pids[c.player] for c in g.members] for g in sets})
                if dropped:
                    log.info("intercom: %d room(s) changed during the talk and were left out of the message",
                             len(dropped))
                    b.notes.append("dropped:" + ",".join(dropped))
            fallback_names = sorted({r.name for r in failed})
            if fallback_names:
                await self._say(s, {"type": "fallback", "rooms": fallback_names})
            outcome = D.Outcome([r for r in b.results if r.ok])
            again = {c.player for c in retry}
            for call in b.plan.calls:
                for r in b.results:
                    if r.player == call.player and call.player not in again:
                        self._show(b.aid, call, r.ok)       # (a room the Message is for stays out until it has played)
            self._hide(b.aid, retry, again=True)
            if retry:
                links = []

                def new_url() -> str:
                    token, link = self.links.mint(s.spool, mode="message", finite=True,
                                                  limit_s=C.limit_s(b.doc, "live"))
                    links.append(link)
                    address = f"{b.doc['stream_base']}/s/{token}.wav"
                    b.run.add_url(address)
                    return address

                url = new_url()
                try:
                    outcome.results += await D.broadcast(
                        self.ma, b.run, R.Plan(calls=retry, sync=sets), b.pids, url, new_url=new_url,
                        chime=b.doc["chime"]["message"], timeout=C.limit_s(b.doc, "live") + D.CALL_GRACE,
                        names=b.music.name_of, done=lambda call, ok: self._show(b.aid, call, ok))
                finally:
                    for link in links:
                        self.links.kill(link)
            self._tell_listeners(b.doc, b.plan, s.spool, s)      # listener tablets: the whole talk, at its end
            if b.lags:
                lag = int(sorted(b.lags)[len(b.lags) // 2] * 1000)
                await self._say(s, {"type": "lag_ms", "value": lag})
            self._live_health(b)
            b.notes.append(_failures("failed", outcome.results))
            base = D.result_of(outcome, len(b.plan.skipped), fallback=bool(fallback_names))
            result = ("ok:max_length" if why == "max_length" and base == "ok" else base)
            await self._say(s, {"type": "sent", "rooms": _reached(b.plan.calls, outcome, b.music), "failed": outcome.failed,
                                "fallback": fallback_names})
            return result
        finally:
            if b.plan.loose:
                await asyncio.shield(self._give_back(b.aid, b.run, b.plan.loose))
            self._show_all(b.aid, b.plan.calls)
            b.run.close()
            self.links.kill(b.link)
            self._finish(b.aid, result, [_failures("live_failed", b.results), *b.notes], s.principal)
            if self.relay.floor is s:
                self.relay.floor = None

    async def live_abort(self, s: Any, result: str = "error:client_gone") -> None:
        """The page's socket dropped mid-talk (or sent Cancel, or the socket ended any other way while Live was on):
        the live stream stops and its run closes; the page sends its own copy as a Message."""
        b: LiveBroadcast = s.broadcast
        b.link.dead = True
        self.links.kill(b.link)
        if s.spool is not None:                # Cancel has already dropped it
            s.spool.finish()
        if b.task is not None:
            b.task.cancel()
            await asyncio.gather(b.task, return_exceptions=True)
        if b.plan.loose and b.run.open:
            before = set(self._parting)        # its temporary groups go back first (together's settle)

            async def back() -> None:
                if before:
                    await asyncio.wait(before)
                await self._give_back(b.aid, b.run, b.plan.loose)
            self._later(back())
        self._show_all(b.aid, b.plan.calls)
        if not b.run.open:                     # live_end or an earlier abort already wrote the row's result
            return
        b.run.close()
        self._finish(b.aid, result, [_failures("live_failed", b.results), *b.notes], s.principal)
        if self.relay.floor is s:
            self.relay.floor = None

    def _live_health(self, b: "LiveBroadcast") -> None:
        """Each live room's result (never about content); three failures in a row make it Message-only."""
        rooms: dict[str, bool] = {}
        for r in b.results:
            if r.error in ("fetch_ended_early", "cancelled", GROUP_FAILED):
                continue               # the talker's page stalled, the talk was stopped, its group's leader failed
            rooms[r.room] = rooms.get(r.room, True) and r.ok
        if not rooms:
            return
        try:
            doc = self.doc()
            before = {r for r in rooms if C.room(doc, r).get("demoted")}
            for room, ok in rooms.items():
                doc = C.live_result(doc, room, ok)
            demoted = sorted(r for r in rooms if C.room(doc, r).get("demoted") and r not in before)
            if demoted:
                from .. import audit
                audit.config(None, None, "intercom.live.demoted", {"rooms": demoted}, app=self.app,
                             reason="three_live_failures")
            from ..settings_store.docs import Actor
            self.save(doc, Actor(label="intercom"))      # the history's actions are set, restore, import
            self.changed()
        except Exception:  # noqa: BLE001 -- the broadcast is over either way
            log.exception("intercom: Live health could not be saved")


class LiveBroadcast:
    """One Live broadcast's state while it runs."""

    def __init__(self, plan: Any, pids: dict, music: Any, doc: dict, aid: int, run: Any, link: Any, url: str,
                 t0: float) -> None:
        self.plan, self.pids, self.music, self.doc, self.aid = plan, pids, music, doc, aid
        self.run, self.link, self.url, self.t0 = run, link, url, t0
        self.task: asyncio.Task | None = None
        self.results: list[D.RoomResult] = []
        self.failed: set[str] = set()
        self.why: dict[str, str] = {}
        self.lags: list[float] = []
        self.notes: list[str] = []          # for the audit row: rooms dropped, a Message's failures

    # the relay treats ``broadcast`` as the plan (``rooms``, ``calls``) while Message's send is running
    @property
    def rooms(self) -> list:
        return self.plan.rooms


def _reached(calls: list[Any], outcome: Any, music: Any) -> int:
    """The rooms that heard it: each call that played, and the rooms its group played it on (a leader's call covers its
    members' rooms: 2026-11-05, nine rooms heard a message the sheet called "Sent to 2 rooms")."""
    played = {r.player for r in outcome.results if r.ok}
    rooms = {r.room for r in outcome.results if r.ok}
    covered = {p for c in calls if c.player in played for p in c.covers}
    rooms |= {r for r in music.room_ids if covered.intersection(music.players_of([r]))}
    return len(rooms)


def _speakers(plan: Any, pids: dict) -> set:
    """The speakers a broadcast may call: its calls', and those its groups are to reach (_covered may call one alone)."""
    return {pids[p] for c in plan.calls for p in [c.player, *c.covers] if p in pids}


def _failures(tag: str, results: Any) -> str:
    """The audit row's note of the rooms that didn't play and why ("live_failed:media_player.den=not_playing"); empty when
    every room played."""
    bad = [f"{r.room}={r.error or 'failed'}" for r in results if not r.ok]
    return tag + ":" + ",".join(bad) if bad else ""


def _mark_key(aid: int, call: Any) -> str:
    return f"intercom:{aid}:{call.player}"


def _public(rows: list[dict]) -> list[dict]:
    return [{k: r.get(k) for k in ("room", "name", "state", "why", "reason", "live")} for r in rows]
