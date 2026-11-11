"""THE INTERCOM'S AUDIO SOCKET, ``/ws/intercom`` (docs/phase17/INTERCOM.md "The audio socket"), modeled on
talk_relay.py; the same words where the rule is the same.

1. The page's ``client.actions.intercom(mode, rate)`` sends the gateway an ``intercom`` command. The gateway decides
   it (``control`` on the intercom feature), writes the ``intercom.open`` row FIRST (kind ma), and answers with a
   one-time ticket from ``IntercomRelay.issue``: bound to that connection's session, person and tablet, valid
   TICKET_TTL seconds, spent once.
2. The page's Worker opens ``/ws/intercom`` (same-origin, the session cookie, an Origin header, as /ws and /ws/talk)
   and sends ``{"type": "auth", "access_token": <ticket>}`` first; anything else is ``auth_invalid`` and a close.
3. Binary frames ``[1][s16le mono PCM]`` of at most 100 ms, rate-capped by talk_relay's Bucket; they fill a DRAFT
   spool in memory (never on disk, never logged) up to the mode's limit. Text frames, only: ``cancel`` (drop the
   draft: Cancel and Re-record), ``send`` (a Message: finish the draft and broadcast), ``start``/``end`` (Live).
   Anything else closes the socket (1008).
4. At ``send`` the rooms are decided (hk_core/intercom/rooms.py) with the stored principal re-checked
   (``Authz.refresh``) and each room with ``decide_intercom``; the page hears ``rooms``. Then the house's ONE FLOOR
   (one broadcast at a time: ``busy``), the rate limit, the ``intercom.play`` row (no row, no sound) and the driver.
5. It ends after the broadcast, at the mode's limit, when either side closes, on a revocation, a role change or
   commands turned off (live.py, ``kind="intercom"``, ``needs_commands``), and at the policy tick. A draft with no
   activity for DRAFT_IDLE is dropped; Live with no audio for LIVE_IDLE ends the talk.

Both rows get a result at the end: ``ok``, ``ok:fallback``, ``ok:partial:<n>``, ``ok:discarded`` (a draft never
sent), ``ok:max_length``, ``error:<code>``, ``refused:<why>``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

from aiohttp import WSMsgType, web

from ..identity.authz import Principal
from ..identity.guards import guard
from ..ha.ha_client import talk_frame_max
from ..talk_relay import Bucket, _keys, _name, _who

log = logging.getLogger("mantel.intercom")

PATH = "/ws/intercom"
TICKET_TTL = 10.0
AUTH_TIMEOUT = 10.0
FRAME = 1
MAX_RATE = 48000
MAX_MSG = talk_frame_max(MAX_RATE) + 1
CLOSE_POLICY = 1008
DRAFT_IDLE = 300.0              # a Message draft with no activity is dropped (decision 5)
LIVE_IDLE = 10.0                # Live with no audio ends the talk
BURST_S = 4.0                   # seconds of audio that may arrive at once: the page paces itself, but Wi-Fi can hold a
                                # few seconds back and deliver them together (2026-11-05: 48 frames, about 2 s of a
                                # Message, dropped at talk_relay's 1 s). The cap over time is talk_relay's.
MAX_DRAFTS = 8                  # open drafts in the house (about 25 MB worst case)
RATE_WINDOW = 600.0             # 10 broadcasts per person (or tablet) per 10 minutes
RATE_MAX = 10
MIN_SECONDS = 0.3               # a shorter clip is a slip of the finger: "too_short"
TEXT_TYPES = frozenset({"cancel", "send", "start", "end"})


@dataclass
class Ticket:
    mode: str
    rate: int
    audit_id: int
    who: tuple
    keys: frozenset
    expires: float


@dataclass(eq=False)
class Session:
    ws: web.WebSocketResponse
    principal: Principal
    mode: str
    rate: int
    name: str
    keys: frozenset
    spool: Any = None
    error: str | None = None
    close_code: int = 1000
    dropped: int = 0
    first_drop: float | None = None    # seconds after the socket opened (for the log: a burst, a full spool, Live's start)
    told_full: bool = False
    last_activity: float = field(default_factory=time.monotonic)
    broadcast: Any = None              # the broadcast this session holds the floor for


class IntercomRelay:
    def __init__(self, host: Any, clock: Callable[[], float] = time.time) -> None:
        self.host = host
        self.clock = clock
        self.tickets: dict[str, Ticket] = {}
        self.active: dict[tuple, Session] = {}
        self.sessions: set[Session] = set()
        self.tasks: set[asyncio.Task] = set()
        self.floor: Session | None = None
        self.sent: dict[tuple, deque] = {}
        self.ticket_ttl = TICKET_TTL
        self.draft_idle = DRAFT_IDLE

    @property
    def audit(self) -> Any:
        return self.host.app["audit"]

    @property
    def authz(self) -> Any:
        return self.host.app["authz"]

    # -- tickets (the gateway's side) ---------------------------------------------------------------------
    def issue(self, principal: Principal, mode: str, rate: int, audit_id: int) -> dict:
        """The gateway's answer to an allowed intercom command (its intercom.open row already written)."""
        self.sweep()
        token = secrets.token_urlsafe(32)
        self.tickets[token] = Ticket(mode, rate, audit_id, _who(principal), _keys(principal),
                                     self.clock() + self.ticket_ttl)
        return {"ticket": token, "expires_in": int(self.ticket_ttl), "url": PATH}

    def sweep(self) -> None:
        now = self.clock()
        for token, t in list(self.tickets.items()):
            if t.expires <= now:
                del self.tickets[token]
                self._finish(t.audit_id, "error:ticket_unused")

    def spend(self, token: Any, principal: Principal) -> tuple[Ticket | None, str]:
        t = self.tickets.pop(token, None) if isinstance(token, str) else None
        if t is None:
            return None, "unknown_ticket"
        bad = ("ticket_expired" if t.expires <= self.clock() else
               "ticket_other_identity" if t.who != _who(principal) else None)
        if bad is not None:
            self._finish(t.audit_id, "error:" + bad)
            return None, bad
        return t, "ok"

    def _finish(self, audit_id: int, result: str) -> None:
        try:
            self.audit.finish(audit_id, result)
        except Exception:  # noqa: BLE001 -- the socket itself is over either way
            log.exception("could not write the result of intercom audit row %d", audit_id)

    # -- the policy tick, the floor, shutting down -----------------------------------------------------------
    async def tick(self) -> None:
        self.sweep()
        links = getattr(self.host, "links", None)
        if links is not None:
            links.sweep()                   # an expired link is killed even if nobody asks for it again
        now = time.monotonic()
        for s in list(self.sessions):
            if not self.authz.refresh(s.principal):
                await self._end(s, "error:unauthenticated")
            elif s.broadcast is None and s.spool is not None and now - s.last_activity > self.draft_idle:
                log.info("intercom: a draft idle for %.0f s was dropped", now - s.last_activity)
                await self._end(s, "ok:discarded", code=1000)

    async def _end(self, s: Session, why: str, code: int = CLOSE_POLICY) -> None:
        s.error, s.close_code = why, code
        if s.spool is not None and s.broadcast is None:
            s.spool.drop()
        await s.ws.close(code=code)

    async def close(self, why: str = "error:server_stopping") -> None:
        for token, t in list(self.tickets.items()):
            del self.tickets[token]
            self._finish(t.audit_id, "error:ticket_unused")
        for s in list(self.sessions):
            await self._end(s, why)

    def busy_name(self, s: Session) -> str | None:
        if self.floor is not None and self.floor is not s and self.floor in self.sessions:
            return self.floor.name
        return getattr(self.host, "testing", None)

    def rate_ok(self, s: Session) -> bool:
        now = time.monotonic()
        for k in s.keys:
            q = self.sent.setdefault(k, deque())
            while q and now - q[0] > RATE_WINDOW:
                q.popleft()
            if len(q) >= RATE_MAX:
                return False
        for k in s.keys:
            self.sent[k].append(now)
        return True

    def _drafts(self) -> int:
        return sum(1 for s in self.sessions if s.spool is not None and s.broadcast is None)

    def _register(self, s: Session) -> Any:
        """live.py: ended at once by a revocation, at the tick when its person or tablet may no longer use the
        Intercom, and when house commands are turned off."""
        from .. import live
        registry = live.of(self.host.app)
        if registry is None:
            return None

        async def close(why: str) -> None:
            if why == live.SHUTDOWN:
                await s.ws.close(code=1001, message=b"server shutting down")
                return
            await self._end(s, "refused:commands_disabled" if why == live.COMMANDS_OFF else
                            "error:unauthenticated" if not s.principal.valid else "refused:not_allowed")

        def recheck() -> bool:
            subject, ctx = s.principal.subject, self.authz.context()
            return self.authz.decide(subject, "control", None, feature="intercom", ctx=ctx).allowed
        return registry.add("intercom", s.principal, close, recheck=recheck, needs_commands=True)

    # -- the socket ------------------------------------------------------------------------------------------
    async def serve(self, ws: web.WebSocketResponse, principal: Principal) -> None:
        await ws.send_json({"type": "auth_required"})
        msg = await _text(ws, AUTH_TIMEOUT)
        token = msg.get("access_token") if (isinstance(msg, dict) and msg.get("type") == "auth"
                                            and set(msg) == {"type", "access_token"}) else None
        ticket, why = self.spend(token, principal)
        if ticket is None:
            log.info("intercom socket refused: %s", why)
            await ws.send_json({"type": "auth_invalid", "message": "the Intercom needs a fresh ticket"})
            await ws.close(code=CLOSE_POLICY)
            return
        result, code = "error:not_started", 1000
        try:
            result, code = await self._run(ws, principal, ticket)
        except (ConnectionError, RuntimeError) as exc:
            result = "error:client_gone"
            log.info("intercom: the page's socket went away (%s)", type(exc).__name__)
        finally:
            self._finish(ticket.audit_id, result)
            if not ws.closed:
                await ws.close(code=code)

    async def _run(self, ws: web.WebSocketResponse, principal: Principal, ticket: Ticket) -> tuple[str, int]:
        if not self.authz.refresh(principal):
            await ws.send_json({"type": "error", "code": "unauthenticated"})
            return "refused:unauthenticated", CLOSE_POLICY
        keys = ticket.keys or frozenset({("ticket", id(ticket))})
        if any(k in self.active for k in keys):
            await ws.send_json({"type": "error", "code": "busy_here",
                                "message": "The Intercom is already open for this person or tablet"})
            return "refused:busy", CLOSE_POLICY
        why = self.host.unavailable(principal, ticket.mode, ticket.rate)
        if why:
            await ws.send_json({"type": "error", "code": why})
            return f"refused:{why}", CLOSE_POLICY
        doc = self.host.doc()
        limit = self.host.limit_s(doc, ticket.mode)
        s = Session(ws, principal, ticket.mode, ticket.rate, _name(principal), keys)
        for k in keys:
            self.active[k] = s
        self.sessions.add(s)
        entry = self._register(s)
        ended: str | None = None
        try:
            await ws.send_json({"type": "auth_ok", "mode": ticket.mode, "rate": ticket.rate, "max_s": limit})
            result = ended = await self._pump(s, limit)
            if s.error and result.startswith("ok") and s.error != result:
                result = s.error
            log.info("intercom (%s): %s, %d frames dropped%s", s.mode, result, s.dropped,
                     f" (the first {s.first_drop:.1f} s in)" if s.dropped and s.first_drop is not None else "")
            return result, s.close_code
        finally:
            b = s.broadcast
            if getattr(getattr(b, "run", None), "open", False):
                # the socket ended while Live was on, by a path that didn't end it (a bad frame, the time limit, an
                # error): the live link dies, the run closes and the play row gets its result here
                try:
                    await self.host.live_abort(s, "error:" + (result_code(ended or s.error) or "socket_ended"))
                except Exception:  # noqa: BLE001 -- the socket is over either way
                    log.exception("intercom: the live broadcast could not be ended")
            if self.floor is s:
                self.floor = None
            if s.spool is not None:
                s.spool.drop()
            self.sessions.discard(s)
            if entry is not None:
                entry.forget()
            for k in keys:
                if self.active.get(k) is s:
                    del self.active[k]

    async def _pump(self, s: Session, limit: float) -> str:
        loop = asyncio.get_running_loop()
        bucket = Bucket(s.rate * 2, loop.time())
        bucket.cap = bucket.level = s.rate * 2 * BURST_S
        frame_max = talk_frame_max(s.rate)
        started = loop.time()
        while True:
            live_on = s.mode == "live" and s.broadcast is not None
            wait = LIVE_IDLE if live_on else self.draft_idle if s.mode == "message" else limit + 5
            try:
                m = await s.ws.receive(timeout=wait)
            except asyncio.TimeoutError:
                if live_on:                        # no audio for LIVE_IDLE: the talk is over
                    return await self.host.live_end(s, "idle")
                return "ok:discarded"
            if m.type == WSMsgType.BINARY:
                data = m.data
                n = len(data) - 1
                if n <= 0 or data[0] != FRAME or n % 2 or n > frame_max:
                    s.close_code = CLOSE_POLICY
                    return "refused:bad_frame"
                s.last_activity = time.monotonic()
                if not bucket.take(n, loop.time()):
                    s.dropped += 1
                    s.first_drop = s.first_drop if s.first_drop is not None else loop.time() - started
                    continue
                if s.mode != "message":
                    if s.broadcast is None or s.spool is None:
                        s.dropped += 1             # Live's audio before ``start`` goes nowhere
                        s.first_drop = s.first_drop if s.first_drop is not None else loop.time() - started
                        continue
                    if not s.spool.append(bytes(data[1:])) and s.spool.full:
                        return await self.host.live_end(s, "max_length")
                    continue
                if s.spool is None:
                    if self._drafts() >= MAX_DRAFTS:
                        await s.ws.send_json({"type": "error", "code": "too_many_drafts",
                                              "message": "Too many messages are being recorded; try again"})
                        s.close_code = CLOSE_POLICY
                        return "refused:too_many_drafts"
                    s.spool = self.host.new_spool(s.rate, limit)
                if not s.spool.append(bytes(data[1:])):
                    s.dropped += 1
                    s.first_drop = s.first_drop if s.first_drop is not None else loop.time() - started
                    if s.spool.full and not s.told_full:
                        s.told_full = True
                        await s.ws.send_json({"type": "full"})
            elif m.type == WSMsgType.TEXT:
                try:
                    msg = json.loads(m.data)
                except ValueError:
                    msg = None
                if not isinstance(msg, dict) or msg.get("type") not in TEXT_TYPES:
                    s.close_code = CLOSE_POLICY
                    return "refused:bad_message"
                s.last_activity = time.monotonic()
                kind = msg["type"]
                if kind == "cancel" and set(msg) == {"type"}:
                    if s.mode == "live" and s.broadcast is not None:
                        await self.host.live_abort(s, "error:cancelled")   # the talk stops now; nothing more plays
                        if s.spool is not None:
                            s.spool.drop()
                        return "error:cancelled"
                    if s.spool is not None:
                        s.spool.drop()
                        s.spool = None
                    s.told_full = False
                    await s.ws.send_json({"type": "cancelled"})
                    continue
                if kind == "send" and s.mode == "message" and set(msg) <= {"type", "rooms", "override"}:
                    rooms, override = msg.get("rooms"), msg.get("override", False)
                    if (not isinstance(rooms, list) or not all(isinstance(r, str) for r in rooms)
                            or not isinstance(override, bool) or len(rooms) > self.host.max_picks()):
                        s.close_code = CLOSE_POLICY
                        return "refused:bad_message"
                    if s.spool is None or s.spool.seconds < MIN_SECONDS:
                        await s.ws.send_json({"type": "error", "code": "too_short",
                                              "message": "Nothing was recorded"})
                        continue
                    result = await self.host.send_message(s, rooms, override)
                    if result.startswith("ok") or result.startswith("error"):
                        return result
                    continue                    # refused (busy, no rooms): the draft stays, the page may try again
                if kind in ("start", "end") and s.mode == "live":
                    t0 = loop.time()
                    result = await self.host.live_frame(s, msg)
                    if kind == "start":
                        # the talk went on while the start read Music Assistant: that audio waits in the socket and
                        # comes at once, so the bucket may hold it too (2026-11-05: 49 frames, the first 2 s, dropped)
                        bucket.cap += (loop.time() - t0) * bucket.fill
                        bucket.level = bucket.cap
                    if result is not None:
                        return result
                    continue
                s.close_code = CLOSE_POLICY
                return "refused:bad_message"
            else:
                if s.mode == "live" and s.broadcast is not None:
                    await self.host.live_abort(s)  # the page rescues what it said as a Message on a new socket
                    return "error:client_gone"
                if s.spool is not None and s.broadcast is None:
                    return "ok:discarded"
                return "ok:discarded"
            if loop.time() - started > limit + DRAFT_IDLE + 60:
                return "ok:max_length"


def result_code(error: str | None) -> str | None:
    """``refused:bad_frame`` -> ``bad_frame`` (the code part of a socket's result)."""
    return error.split(":", 1)[-1] if error else None


async def _text(ws: web.WebSocketResponse, timeout: float) -> Any:
    try:
        m = await ws.receive(timeout)
    except asyncio.TimeoutError:
        return None
    if m.type != WSMsgType.TEXT:
        return None
    try:
        return json.loads(m.data)
    except ValueError:
        return None


@guard("signed_in", reads="view", stream="live:intercom")     # any session; each socket needs a gateway ticket, which the roles decide (relay.serve)
async def socket_handler(request: web.Request) -> web.StreamResponse:
    """``GET /ws/intercom``: behind the sign-in (auth.require_session: a session and an Origin header). Refused before
    the upgrade while commands are off or the Intercom is: nothing is opened."""
    host = request.app.get("intercom")
    if host is None or request.app.get("gateway") is None:
        return web.json_response({"error": "commands_disabled",
                                  "message": "Commands are disabled on this server; the Intercom is not offered."},
                                 status=403, headers={"Cache-Control": "no-store"})
    if not host.doc().get("enabled"):
        return web.json_response({"error": "intercom_off", "message": "The Intercom is off."},
                                 status=403, headers={"Cache-Control": "no-store"})
    principal = request.app["authz"].principal(request)
    ws = web.WebSocketResponse(heartbeat=30, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    task = asyncio.create_task(host.relay.serve(ws, principal))
    host.relay.tasks.add(task)
    task.add_done_callback(host.relay.tasks.discard)
    await asyncio.shield(task)
    return ws
