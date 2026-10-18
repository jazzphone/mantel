"""LIVE TALK through Mantel (docs/phase3/GATEWAY.md "Doorbell talk-back"): the doorbell sheet's
microphone streamed to the doorbell as you speak, the way HK does it in Home Assistant, with every
step decided and audited by the gateway.

HK's doorbell card streams from a Worker that opens its OWN WebSocket with what
``client.actions.liveSocket(speaker)`` gives it (``{url, token()}``) and speaks HA's protocol on it:

    <- auth_required        -> {type: auth, access_token: <token()>}        <- auth_ok
    -> {id, type: "hk_frontend/talk/live", entity_id: <speaker>, rate}        (one subscription)
    <- result (success)     <- event {handler_id, rate, codec}   | result/event error -> the clip
    -> binary [handler_id][s16le mono PCM], every 40 ms
    -> {id, type: "unsubscribe_events", subscription}                        ("let go")

On Mantel (only while the operator turned commands on):

1. The page's ``liveSocket(speaker)`` sends the gateway a ``talk_live`` command. The gateway decides
   it exactly as the recorded clip (``media_player.play_media`` on the speaker and ``camera.talk`` on
   the cameras feature, the talk-back policy, the camera rules), writes the audit row FIRST, and
   answers with a one-time ticket from ``TalkRelay.issue``: bound to that connection's identity
   (session, user, device), that speaker and that row, valid TICKET_TTL seconds, spent once.
2. The Worker opens ``/ws/talk`` (``wsUrl``, so under HA's Ingress prefix too; same-origin, the
   session cookie, an Origin header, as /ws) and sends the ticket as its access token. Wrong,
   spent, expired or someone else's: ``auth_invalid``, closed.
3. ONE subscription: exactly ``{id, type, entity_id, rate}`` with the ticket's speaker and a rate
   HA's talk_live accepts. One live talk per person and per tablet at a time (``busy``).
4. Mantel opens its own HA socket for it (``HaCommander.talk_link`` -> ``ha_client.HaTalkLink``: the
   credential stays there; the link can send only that subscription, that speaker's binary frames
   and one unsubscribe). HA's answers are relayed with the client's id; HA's handler id is replaced
   by CLIENT_HID, and the client's frames must carry CLIENT_HID.
5. Binary frames: [CLIENT_HID][even-length PCM up to TALK_FRAME_MS at the rate]; anything else closes
   the socket (1008). Rate-capped: at most RATE_SLACK x the declared PCM rate with BURST_S of burst;
   the excess is dropped (HA trims a backlog anyway). The only text frame is the one
   ``unsubscribe_events`` for that subscription; anything else closes the socket.
6. It ends at MAX_SESSION seconds, on unsubscribe, when either side closes, or when the session or
   device is revoked (the policy tick); the relay then lets go on HA's side, closes both, and writes
   the audit row's result (``ok``, ``ok:max_session``, ``error:<HA's code>``, ``refused:<why>``, ...).
   A ticket never used is written ``error:ticket_unused`` (at the next issue or policy tick).

Nothing of the stream is stored or logged (counts and the duration only).
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import aiohttp
from aiohttp import WSMsgType, web

from .authz import Principal
from .ha_client import TALK_LIVE_TYPE, TALK_RATES, CommandBlocked, CommandTicket, HaCommandError, talk_frame_max

log = logging.getLogger("mantel.talk")

PATH = "/ws/talk"
TICKET_TTL = 10.0           # seconds between the gateway's answer and the Worker's auth
MAX_SESSION = 120.0         # talk_live.py's own MAX_SESSION_S: a stuck button never holds the door open
AUTH_TIMEOUT = 10.0         # for the auth frame and the subscription
CLIENT_HID = 1              # the handler id the page is given (HA's own is never shown)
RATE_SLACK = 1.25           # bytes/s allowed over the declared PCM rate
BURST_S = 1.0               # seconds of audio that may arrive at once (Wi-Fi bursts)
MAX_MSG = talk_frame_max(max(TALK_RATES)) + 1      # the largest frame the socket reads
CLOSE_POLICY = 1008


def _who(principal: Principal) -> tuple:
    ident = principal.identity
    return (ident.session_id, ident.user.id if ident.user else None, ident.device.id if ident.device else None)


def _keys(principal: Principal) -> frozenset:
    ident = principal.identity
    keys = set()
    if ident.user is not None:
        keys.add(("user", ident.user.id))
    if ident.device is not None:
        keys.add(("device", ident.device.id))
    return frozenset(keys)


@dataclass
class Ticket:
    speaker: str
    audit_id: int
    who: tuple
    keys: frozenset
    expires: float


class Bucket:
    """A token bucket over PCM bytes: `fill` bytes a second, at most `cap` at once."""

    def __init__(self, bytes_per_s: float, now: float) -> None:
        self.cap = bytes_per_s * BURST_S
        self.fill = bytes_per_s * RATE_SLACK
        self.level = self.cap
        self.t = now

    def take(self, n: int, now: float) -> bool:
        self.level = min(self.cap, self.level + (now - self.t) * self.fill)
        self.t = now
        if n <= self.level:
            self.level -= n
            return True
        return False


@dataclass(eq=False)
class Stream:
    ws: web.WebSocketResponse
    principal: Principal
    speaker: str
    error: str | None = None
    close_code: int = 1000
    dropped: int = 0
    started: float = field(default_factory=time.monotonic)


class TalkRelay:
    def __init__(self, app: web.Application, audit, authz, clock: Callable[[], float] = time.time) -> None:
        self.app = app
        self.audit = audit
        self.authz = authz
        self.clock = clock
        self.tickets: dict[str, Ticket] = {}
        self.active: dict[tuple, Stream] = {}       # ("user", id) / ("device", id) -> its open stream
        self.streams: set[Stream] = set()
        self.tasks: set[asyncio.Task] = set()
        self.ticket_ttl = TICKET_TTL
        self.max_session = MAX_SESSION

    @property
    def commander(self) -> Any:
        gw = self.app.get("gateway")
        return getattr(gw, "commander", None) if gw is not None else None

    # -- tickets (the gateway's side) ---------------------------------------------------------------
    def issue(self, principal: Principal, speaker: str, audit_id: int) -> dict:
        """The gateway's answer to an allowed talk_live command (its audit row already written)."""
        self.sweep()
        token = secrets.token_urlsafe(32)
        self.tickets[token] = Ticket(speaker, audit_id, _who(principal), _keys(principal),
                                     self.clock() + self.ticket_ttl)
        return {"ticket": token, "expires_in": int(self.ticket_ttl)}

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
        if t.expires <= self.clock():
            self._finish(t.audit_id, "error:ticket_expired")
            return None, "ticket_expired"
        if t.who != _who(principal):
            self._finish(t.audit_id, "error:ticket_other_identity")
            return None, "ticket_other_identity"
        return t, "ok"

    def _finish(self, audit_id: int, result: str) -> None:
        try:
            self.audit.finish(audit_id, result)
        except Exception:  # noqa: BLE001 -- the stream itself is over either way
            log.exception("could not write the result of live talk audit row %d", audit_id)

    # -- the policy tick ---------------------------------------------------------------------------
    async def tick(self) -> None:
        """Expired tickets get their result; a stream whose session or device ended is closed."""
        self.sweep()
        for s in list(self.streams):
            if not self.authz.refresh(s.principal):
                s.error = "error:unauthenticated"
                s.close_code = CLOSE_POLICY
                log.info("closing a live talk whose session or device ended")
                await s.ws.close(code=CLOSE_POLICY)

    # -- the socket ----------------------------------------------------------------------------------
    async def serve(self, ws: web.WebSocketResponse, principal: Principal) -> None:
        await ws.send_json({"type": "auth_required", "ha_version": "mantel"})
        msg = await _text(ws, AUTH_TIMEOUT)
        token = msg.get("access_token") if (isinstance(msg, dict) and msg.get("type") == "auth"
                                            and set(msg) == {"type", "access_token"}) else None
        ticket, why = self.spend(token, principal)
        if ticket is None:
            log.info("live talk socket refused: %s", why)
            await ws.send_json({"type": "auth_invalid", "message": "live talk needs a fresh ticket from the gateway"})
            await ws.close(code=CLOSE_POLICY)
            return
        result, code = "error:not_started", 1000
        try:
            result, code = await self._run(ws, principal, ticket)
        except (ConnectionError, RuntimeError) as exc:      # the page's socket went away mid-answer
            result = "error:client_gone"
            log.info("live talk: the page's socket went away (%s)", type(exc).__name__)
        finally:
            self._finish(ticket.audit_id, result)
            if not ws.closed:
                await ws.close(code=code)

    async def _run(self, ws: web.WebSocketResponse, principal: Principal, ticket: Ticket) -> tuple[str, int]:
        await ws.send_json({"type": "auth_ok", "ha_version": "mantel"})
        sub = await _text(ws, AUTH_TIMEOUT)
        sid = sub.get("id") if isinstance(sub, dict) else None
        sid = sid if isinstance(sid, int) and not isinstance(sid, bool) else None

        async def refuse(code: str, message: str, result: str) -> tuple[str, int]:
            await ws.send_json({"id": sid, "type": "result", "success": False,
                                "error": {"code": code, "message": message}})
            return result, CLOSE_POLICY

        if not (isinstance(sub, dict) and set(sub) == {"id", "type", "entity_id", "rate"}
                and sub.get("type") == TALK_LIVE_TYPE and sid is not None):
            return await refuse("not_allowed", "this socket carries one hk_frontend/talk/live subscription",
                                "refused:not_a_subscription")
        if sub["entity_id"] != ticket.speaker:
            return await refuse("not_allowed", "the ticket is for another speaker", "refused:other_speaker")
        rate = sub["rate"]
        if not isinstance(rate, int) or isinstance(rate, bool) or rate not in TALK_RATES:
            return await refuse("invalid_format", f"rate is one of {list(TALK_RATES)}", "refused:rate")
        if not self.authz.refresh(principal):
            return await refuse("unauthorized", "the session or device is no longer valid", "refused:unauthenticated")
        keys = ticket.keys or frozenset({("ticket", id(ticket))})
        if any(k in self.active for k in keys):
            return await refuse("busy", "a live talk is already open for this person or tablet", "refused:busy")
        commander = self.commander
        if commander is None or not hasattr(commander, "talk_link"):
            return await refuse("not_allowed", "commands are disabled", "refused:commands_disabled")
        try:
            link = commander.talk_link(ticket.speaker, rate, CommandTicket(ticket.audit_id, "talk"))
        except CommandBlocked as exc:
            return await refuse("not_allowed", str(exc)[:200], "refused:blocked")
        stream = Stream(ws, principal, ticket.speaker)
        for k in keys:
            self.active[k] = stream
        self.streams.add(stream)
        try:
            try:
                await link.open()
            except HaCommandError as exc:
                return await refuse(exc.code, (exc.message or exc.code)[:200], f"error:{exc.code}")
            except (OSError, asyncio.TimeoutError, aiohttp.ClientError) as exc:
                log.warning("live talk: Home Assistant not reachable (%s)", type(exc).__name__)
                return await refuse("unavailable", "Home Assistant is not reachable", "error:unavailable")
            await ws.send_json({"id": sid, "type": "result", "success": True, "result": None})
            result = await self._pump(ws, link, sid, rate, stream)
            log.info("live talk on %s: %.1f s, %d frames, %d dropped (%s)", ticket.speaker,
                     time.monotonic() - stream.started, link.frames, stream.dropped, result)
            return result, stream.close_code
        finally:
            self.streams.discard(stream)
            for k in keys:
                if self.active.get(k) is stream:
                    del self.active[k]
            await link.close()

    async def _pump(self, ws: web.WebSocketResponse, link, sid: int, rate: int, stream: Stream) -> str:
        loop = asyncio.get_running_loop()
        bucket = Bucket(rate * 2, loop.time())
        frame_max = talk_frame_max(rate)

        async def from_ha() -> str:
            told = False
            while True:
                ev = await link.recv()
                if ev is None:
                    return "error:ha_closed"
                if not told and link.handler_id is not None and "handler_id" in ev:
                    told = True
                    await ws.send_json({"id": sid, "type": "event", "event": {
                        "handler_id": CLIENT_HID, "rate": link.info.get("rate"), "codec": link.info.get("codec")}})
                elif isinstance(ev.get("error"), str):
                    stream.error = stream.error or "error:ha_failed"
                    await ws.send_json({"id": sid, "type": "event", "event": {"error": ev["error"][:200]}})

        async def from_client() -> str:
            async for m in ws:
                if m.type == WSMsgType.BINARY:
                    data = m.data
                    n = len(data) - 1
                    if n <= 0 or data[0] != CLIENT_HID or n % 2 or n > frame_max:
                        stream.close_code = CLOSE_POLICY
                        return "refused:bad_frame"
                    if link.handler_id is None or not bucket.take(n, loop.time()):
                        stream.dropped += 1
                        continue
                    await link.send_audio(bytes(data[1:]))
                elif m.type == WSMsgType.TEXT:
                    try:
                        msg = json.loads(m.data)
                    except ValueError:
                        msg = None
                    if (isinstance(msg, dict) and set(msg) == {"id", "type", "subscription"}
                            and msg.get("type") == "unsubscribe_events" and msg.get("subscription") == sid
                            and isinstance(msg.get("id"), int) and not isinstance(msg.get("id"), bool)):
                        await link.stop()
                        await ws.send_json({"id": msg["id"], "type": "result", "success": True, "result": None})
                        return "ok"
                    stream.close_code = CLOSE_POLICY
                    return "refused:bad_message"
                else:
                    break
            return "ok"                       # the page went away (the sheet closed): let go

        ha_task = asyncio.create_task(from_ha())
        client_task = asyncio.create_task(from_client())
        try:
            done, _ = await asyncio.wait({ha_task, client_task}, timeout=self.max_session,
                                         return_when=asyncio.FIRST_COMPLETED)
            if client_task in done:
                result = client_task.result()
            elif ha_task in done:
                result = ha_task.result()
            else:
                result = "ok:max_session"
                log.info("live talk on %s reached %.0f s; closed", stream.speaker, self.max_session)
        finally:
            for t in (ha_task, client_task):
                t.cancel()
            await asyncio.gather(ha_task, client_task, return_exceptions=True)
            await link.stop()
        if stream.error and result.startswith("ok"):
            return stream.error
        return result


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


async def socket_handler(request: web.Request) -> web.StreamResponse:
    """``GET /ws/talk``: behind the sign-in (auth.require_session: a session and an Origin header,
    whose value server.loopback_only checks, as for /ws). Refused before the upgrade while commands
    are off: nothing is opened."""
    relay: TalkRelay | None = request.app.get("talk")
    if relay is None:
        return web.json_response({"error": "commands_disabled",
                                  "message": "Commands are disabled on this server; live talk is not offered."},
                                 status=403, headers={"Cache-Control": "no-store"})
    principal = request.app["authz"].principal(request)
    ws = web.WebSocketResponse(heartbeat=30, max_msg_size=MAX_MSG)
    await ws.prepare(request)
    # The relay runs on its own task: when the page's connection drops, aiohttp cancels this handler,
    # and the relay must still let go on Home Assistant's side, close its socket and write the row.
    task = asyncio.create_task(relay.serve(ws, principal))
    relay.tasks.add(task)
    task.add_done_callback(relay.tasks.discard)
    await asyncio.shield(task)
    return ws


def register(app: web.Application, audit, authz, clock: Callable[[], float]) -> TalkRelay | None:
    """The route always; the relay only while commands are on (``app["talk"]``)."""
    app.router.add_get(PATH, socket_handler)
    relay = TalkRelay(app, audit, authz, clock) if app.get("gateway") is not None else None
    app["talk"] = relay
    return relay
