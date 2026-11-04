"""THE INTERCOM'S ROUTES AND FEED (docs/phase17/INTERCOM.md "Permissions, audit, API and storage").

REST, every one behind its guard, every change audited before it is made (audit.config: no row, no change):

* ``GET /api/intercom/settings``, ``PUT /api/intercom/settings``, ``PUT /api/intercom/rooms/{entity}`` -- Settings ->
  Intercom (Owner and Admin, never a wall tablet's session; a fresh sign-in away from home);
* ``POST /api/intercom/check`` (Check Reach: Music Assistant reads a 0.2 s silent link; nothing plays) and ``POST
  /api/intercom/test`` (Send Test: a soft chime on one room; the Owner's own button, rate limited);
* ``GET /api/intercom/clip/{id}.wav`` -- a listener tablet fetches the broadcast it was told about (17.4).

And the hub socket's ``intercom/subscribe``: the rooms the subject may reach and how each would play now, cut down by
RBAC (the intercom feature, then each room with decide_intercom), sent again when it changes; a listener tablet also
hears ``play`` there.
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from typing import Any

from aiohttp import web

from hk_core.intercom import config as C, rooms as R

from .. import audit
from ..accounts import read_json
from ..connectors import Ctx, may_feature, ws_handlers
from ..guards import guard
from ..guards import ident as guarded
from ..sessions import error, ok
from ..settings_store.hooks import actor_of
from . import driver as D
from .spool import Spool, tone_wav

log = logging.getLogger("mantel.intercom")

FEED_EVERY = 5.0                    # the feed is looked at again this often while anyone listens
CHECK_WAIT = 6.0                    # Check Reach: how long Music Assistant has to fetch the silent link
TEST_EVERY = 10.0                   # Send Test: at most one this often
TEST_TONE = (24000, 0.6, 660.0, 0.12)   # rate, seconds, Hz, level: a soft short chime
CLIP_TTL = 120.0                    # a listener's clip id lives at most this long


def host_of(request: web.Request) -> Any:
    host = request.app.get("intercom")
    if host is None:
        raise web.HTTPServiceUnavailable(text=json.dumps({"error": "intercom_off"}), content_type="application/json")
    return host


def _suggested_base(request: web.Request, port: int) -> str | None:
    """The address the Owner's browser used, when it is private: the likely address Music Assistant reaches too."""
    if not port:
        return None
    host = (request.host or "").rsplit(":", 1)[0].strip("[]")
    cand = f"http://{host}:{port}"
    return cand if host and C.base_problem(cand) is None else None


def page_json(request: web.Request) -> dict:
    host = host_of(request)
    doc = host.doc()
    rooms, tablets = [], []
    m = host.music
    if m is not None:
        from ..music import ma_players
        cfg, pids = m.config(), ma_players(host.hub.registry)
        for room in cfg.rooms:
            rs = C.room(doc, room.entity)
            rooms.append({"room": room.entity, "name": room.name, "floor": room.floor,
                          "ma": all(p in pids for p in cfg.players_of([room.entity])),
                          "live_fails": rs["live_fails"], "demoted": rs["demoted"]})
    devices = request.app.get("devices")
    try:
        for d in (devices.list() if devices is not None and hasattr(devices, "list") else []):
            # (DeviceManager.list() gives dict rows; a revoked tablet has a revoked timestamp)
            if d.get("role") == "wall_tablet" and d.get("revoked") is None:
                tablets.append({"id": d["id"], "name": d["name"], "room": d.get("room")})
    except Exception:  # noqa: BLE001 -- the page still works without the tablets list
        log.debug("intercom: the tablets could not be listed", exc_info=True)
    port = host.stream_port
    return {"settings": doc, "rooms": rooms, "tablets": tablets, "suggested_base": _suggested_base(request, port),
            "stream_port": port, "listening": bool(host.listener and host.listener.running),
            "ma": bool(m is not None and m.active)}


@guard("manager", reads="admin")
async def api_settings(request: web.Request) -> web.Response:
    return ok(page_json(request))


@guard("manager", fresh="away", audit="intercom.settings.saved")
async def api_save(request: web.Request) -> web.Response:
    ident = guarded(request)
    host = host_of(request)
    body = await read_json(request)
    try:
        doc = C.merge(host.doc(), body if isinstance(body, dict) else {})
    except ValueError as exc:
        return error(400, "invalid", message=str(exc))
    if "lag_ms" in body:
        return error(400, "invalid", message="lag_ms is the proof's measurement, not a setting")
    audit.config(request, ident, "intercom.settings.saved", {k: body[k] for k in body if k != "rooms"})
    host.save(doc, actor_of(ident))
    await host.apply()
    host.changed()
    return ok({"settings": host.doc()})


@guard("manager", fresh="away", audit=("intercom.room.saved", "intercom.live.reset"))
async def api_room(request: web.Request) -> web.Response:
    ident = guarded(request)
    host = host_of(request)
    entity = request.match_info["entity"]
    body = await read_json(request)
    if host.music is None or entity not in host.music.config().room_ids:
        return error(404, "not_found", message="That isn't one of the house's music rooms.")
    try:
        doc = C.merge_room(host.doc(), entity, body if isinstance(body, dict) else {})
    except ValueError as exc:
        return error(400, "invalid", message=str(exc))
    reset = body.get("reset_live") is True
    action = "intercom.live.reset" if reset and len(body) == 1 else "intercom.room.saved"
    audit.config(request, ident, action, {"room": entity, **{k: v for k, v in body.items()}})
    host.save(doc, actor_of(ident))
    host.changed()
    return ok({"settings": host.doc()})


@guard("manager", fresh="away", no_audit="asks Music Assistant to read a silent link; nothing plays, nothing changes")
async def api_check(request: web.Request) -> web.Response:
    host = host_of(request)
    doc = host.doc()
    if not doc["stream_base"]:
        return ok({"ok": False, "message": "Enter the address for Music Assistant first."})
    if host.ma is None:
        return ok({"ok": False, "message": "Music Assistant isn't connected (Settings -> Connections)."})
    if request.app.get("gateway") is None:
        return ok({"ok": False, "message": "Turn on control of the house first (Mantel Settings -> General)."})
    lock = getattr(host, "check_lock", None)
    if lock is not None and lock.locked():
        return ok({"ok": False, "message": "A check is already running; try again in a few seconds."})
    if lock is None:
        return await _check(host, doc)
    async with lock:
        return await _check(host, doc)


async def _check(host: Any, doc: dict) -> web.Response:
    started_here = host.listener is None or not host.listener.running
    if started_here:
        await host.start_listener_for_check()
    if host.listener is None or not host.listener.running:
        return ok({"ok": False, "message": "Mantel isn't listening for Music Assistant: start it with "
                                          "--stream-port (8767; 8101 in the Home Assistant App)."})
    spool = Spool(16000, 1)
    spool.append(tone_wav(16000, 0.2)[44:])
    spool.finish()
    token, link = host.links.mint(spool, mode="check", finite=True, limit_s=5)
    url = f"{doc['stream_base']}/s/{token}.wav"
    try:
        try:
            await host.ma.read("music/item_by_uri", uri=url)
        except Exception as exc:  # noqa: BLE001 -- what matters is whether it fetched
            log.info("intercom: Check Reach: Music Assistant answered %s", type(exc).__name__)
        try:
            await asyncio.wait_for(link.fetch_started.wait(), CHECK_WAIT)
            fetched = True
        except asyncio.TimeoutError:
            fetched = link.gets > 0
    finally:
        host.links.kill(link)
        if started_here:
            await host.apply()
    if fetched:
        return ok({"ok": True, "message": "Music Assistant fetched it."})
    return ok({"ok": False, "message": "Music Assistant could not reach this address."})


@guard("owner", fresh="away", audit="intercom.test")
async def api_test(request: web.Request) -> web.Response:
    ident = guarded(request)
    host = host_of(request)
    body = await read_json(request)
    room = body.get("room") if isinstance(body, dict) else None
    now = time.monotonic()
    if now - host.last_test < TEST_EVERY:
        return error(429, "rate", message="Wait a few seconds between tests.")
    host.last_test = now                     # at once: two presses in flight can't both pass the check above
    principal = request.app["authz"].principal(request)
    why = host.unavailable(principal, "message", 24000)
    if why:
        return error(409, why, message={"intercom_off": "Turn the Intercom on first.",
                                        "intercom_no_address": "Enter the address for Music Assistant first.",
                                        "intercom_not_listening": "Mantel isn't listening for Music Assistant.",
                                        "music_assistant_off": "Music Assistant isn't set up in Mantel."}.get(why, why))
    if not isinstance(room, str):
        return error(400, "invalid", message="Pick a room.")
    if room not in host.music.config().room_ids:            # ONE room: not "all", a floor or a preset (R.expand's words)
        return ok({"ok": False, "message": "Pick one of the Intercom's rooms."})
    plan, pids, music = await host.plan(principal, [room], "message", False)
    if not plan.calls:
        return ok({"ok": False, "message": plan.nothing_reason()})
    busy = host.relay.floor
    if busy is not None or host.testing:
        return ok({"ok": False, "message": f"{busy.name if busy is not None else 'A test'} is announcing."})
    host.testing = "Send Test"               # holds the floor: a broadcast meanwhile is told it's busy
    audit.config(request, ident, "intercom.test", {"room": room})
    rate, secs, freq, level = TEST_TONE
    spool = Spool(rate, secs + 1)
    spool.append(tone_wav(rate, secs, freq, level)[44:])
    spool.finish()
    doc = host.doc()
    aid = request.app["audit"].record(principal=principal, kind="ma", action="intercom.play",
                                      targets=[r["room"] for r in plan.playing], decision="allowed",
                                      reason="send_test " + D.reason_of(plan, override=False, mode="message"))
    token, link = host.links.mint(spool, mode="message", finite=True, limit_s=10)
    url = f"{doc['stream_base']}/s/{token}.wav"
    run = D.IntercomRun(principal, aid, {pids[c.player] for c in plan.calls}, [url])
    result = "error:not_sent"
    try:
        out = D.Outcome(await D.announce(host.ma, run, plan.calls, pids, url, chime=False, timeout=10 + D.CALL_GRACE,
                                         names=music.name_of))
        result = D.result_of(out, len(plan.skipped))
    finally:
        run.close()
        host.links.kill(link)
        host._finish(aid, result)
        host.testing = None
    if result.startswith("ok"):
        return ok({"ok": True, "message": f"Sent a test to {music.name_of(room)}."})
    return ok({"ok": False, "message": f"{music.name_of(room)} didn't play it ({result.split(':', 1)[-1]})."})


@guard("signed_in", device_ok=True, reads="feature:intercom",
       stream="bounded:one broadcast's clip, 60 s of audio at most (about 6 MB)")
async def api_clip(request: web.Request) -> web.StreamResponse:
    """A listener tablet's copy of a broadcast (17.4): only a tablet the broadcast named, only while it lasts."""
    host = host_of(request)
    feed = host.listeners_feed
    ident = guarded(request)
    device = getattr(ident, "device", None)
    got = feed.clip(request.match_info["id"], getattr(device, "id", None)) if feed is not None else None
    if got is None:
        return web.Response(status=404, headers={"Cache-Control": "no-store"})
    return web.Response(body=got, content_type="audio/wav", headers={"Cache-Control": "no-store"})


class Feed:
    """``intercom/subscribe`` on the hub socket, and the listener tablets' plays (17.4)."""

    def __init__(self, host: Any) -> None:
        self.host = host
        self.subs: dict[int, tuple[Ctx, Any, list]] = {}       # id(ctx), rid -> (ctx, rid, [last snapshot])
        self._task: asyncio.Task | None = None
        self.clips: dict[str, tuple[Any, frozenset, float, int | None]] = {}   # id -> (spool, tablets, until, vol)

    async def snapshot(self, identity: Any) -> dict:
        host = self.host
        doc = host.doc()
        out = {"enabled": bool(doc["enabled"]), "live_allowed": C.live_offered(doc),
               "default_mode": doc["default_mode"], "max_live_s": doc["max_live_s"],
               "max_message_s": doc["max_message_s"], "lag_ms": doc["lag_ms"], "can_override": False,
               "away": False, "here": [], "rooms": [], "floors": [], "presets": [], "listener": False, "play": None}
        principal = identity if hasattr(identity, "subject") else None
        if principal is None:
            return out
        device = getattr(principal.identity, "device", None)
        out["listener"] = bool(device is not None and C.rooms_of_tablet(doc, device.id))
        out["can_override"] = host.may_override(principal)
        out["away"] = principal.identity.door in ("tunnel",)
        m = host.music
        if not doc["enabled"] or m is None or not m.active:
            return out
        house, music, pids = host.setup()
        here = host.here(principal, house, music)
        rows = R.feed_rooms(house, music, doc, allowed=host.allowed(principal), here=here,
                            ma_raw=await host.ma_raw(cached=True), pids=pids)
        out["here"] = here
        out["rooms"] = rows
        have = {r["room"] for r in rows}
        floors: dict[str, dict] = {}
        for room in music.rooms:
            if room.entity in have and room.floor:
                fid = R._floor_id(room.floor)
                floors.setdefault(fid, {"id": f"floor:{fid}", "name": room.floor, "rooms": []})["rooms"].append(
                    room.entity)
        out["floors"] = list(floors.values())
        out["presets"] = [{"id": p.id, "name": p.name, "rooms": [r for r in p.members if r in have]}
                          for p in music.presets if any(r in have for r in p.members)]
        return out

    async def subscribe(self, ctx: Ctx, msg: dict) -> None:
        rid = msg.get("id")
        if not isinstance(rid, int) or set(msg) - {"type", "id"}:
            return await ctx.send({"type": "intercom_result", "id": rid, "error": {"code": "invalid"}})
        hooks = self.host.app.get("intercom_hooks")
        if hooks is None or not await may_feature(hooks, ctx.identity, "intercom"):
            return await ctx.send({"type": "intercom_result", "id": rid, "error": {"code": "forbidden"}})
        key = ("intercom", rid)
        if key in ctx.subs:
            return await ctx.send({"type": "intercom_result", "id": rid, "error": {"code": "invalid"}})
        last: list = [None]
        self.subs[id(ctx) * 1000003 + rid] = (ctx, rid, last)
        k = id(ctx) * 1000003 + rid

        async def unsubscribe() -> None:
            self.subs.pop(k, None)

        async def recheck() -> bool:
            return await may_feature(hooks, ctx.identity, "intercom")
        unsubscribe.recheck = recheck                  # type: ignore[attr-defined]
        await ctx.keep(key, unsubscribe, kind="intercom/subscribe")
        await ctx.send({"type": "intercom_result", "id": rid, "result": None})
        await self._push(ctx, rid, last)
        self._ensure()

    async def unsubscribe(self, ctx: Ctx, msg: dict) -> None:
        await ctx.end(("intercom", msg.get("id")))

    async def _push(self, ctx: Ctx, rid: int, last: list, extra: dict | None = None) -> None:
        try:
            snap = await self.snapshot(ctx.identity)
        except Exception:  # noqa: BLE001 -- the next round tries again
            log.exception("intercom: the feed could not be made")
            return
        if extra:
            snap = {**snap, **extra}
        elif snap == last[0]:
            return
        else:
            last[0] = snap
        await ctx._emit({"type": "intercom_event", "id": rid, "event": snap})

    def _ensure(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._loop())

    async def _loop(self) -> None:
        while self.subs:
            await asyncio.sleep(FEED_EVERY)
            self._sweep_clips()
            for ctx, rid, last in list(self.subs.values()):
                if ctx.closed:
                    continue
                await self._push(ctx, rid, last)

    def changed(self) -> None:
        """A settings save: every subscriber hears it now, not at the next round."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        for ctx, rid, last in list(self.subs.values()):
            last[0] = None
            loop.create_task(self._push(ctx, rid, last))

    # -- listener tablets (17.4) --------------------------------------------------------------------------------
    def play(self, spool: Any, tablets: set[str], rooms: list[str], doc: dict) -> None:
        """Tell each listener tablet of the broadcast's rooms to fetch and play it."""
        cid = secrets.token_urlsafe(16)
        vols = [C.volume_of(doc, r) for r in rooms if C.room(doc, r).get("listeners")]
        vol = next((v for v in vols if v is not None), None)
        self.clips[cid] = (spool, frozenset(tablets), time.monotonic() + CLIP_TTL, vol)
        loop = asyncio.get_running_loop()
        for ctx, rid, last in list(self.subs.values()):
            device = getattr(getattr(getattr(ctx.identity, "identity", None), "device", None), "id", None)
            if device in tablets and not ctx.closed:
                loop.create_task(self._push(ctx, rid, last, extra={
                    "play": {"id": cid, "url": f"/api/intercom/clip/{cid}.wav",
                             "volume": None if vol is None else vol / 100.0}}))

    def clip(self, cid: str, device: str | None) -> bytes | None:
        self._sweep_clips()
        got = self.clips.get(cid[:-4] if cid.endswith(".wav") else cid)
        if got is None or device is None or device not in got[1]:
            return None
        spool = got[0]
        if spool.dropped:
            return None
        return spool.to_wav()

    def _sweep_clips(self) -> None:
        now = time.monotonic()
        for cid, v in list(self.clips.items()):
            if v[2] <= now:
                del self.clips[cid]


def register(app: web.Application, host: Any, hooks: Any) -> Feed:
    from .relay import PATH, socket_handler
    app.router.add_get(PATH, socket_handler)
    app.router.add_get("/api/intercom/settings", api_settings)
    app.router.add_put("/api/intercom/settings", api_save)
    app.router.add_put("/api/intercom/rooms/{entity}", api_room)
    app.router.add_post("/api/intercom/check", api_check)
    app.router.add_post("/api/intercom/test", api_test)
    app.router.add_get("/api/intercom/clip/{id}", api_clip)
    feed = Feed(host)
    app["intercom_hooks"] = hooks
    ws_handlers(app).update({"intercom/subscribe": feed.subscribe, "intercom/unsubscribe": feed.unsubscribe})
    return feed
