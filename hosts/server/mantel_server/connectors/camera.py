"""Camera WebRTC signaling, proxied to Home Assistant (PLAN §7 "Remote cameras: same as today", §10).

HK's camera card does WebRTC through HA's `camera/webrtc/*` messages; Mantel relays the same
messages to HA and the same answers back. Video never touches Mantel: it flows between the screen
and HA's go2rtc directly, using the ICE config HA hands out (returned here UNCHANGED, so remote
viewing behaves exactly as it does in HA today: STUN only, no TURN relay).

The three messages (HA's schemas: homeassistant/components/camera/webrtc.py):
  camera/webrtc/get_client_config {entity_id}            -> {"configuration": {"iceServers": …}, …}
  camera/webrtc/offer             {entity_id, offer}     a subscription; events relayed as they come:
                                                           {"type":"session","session_id"}, {"type":"answer","answer"},
                                                           {"type":"candidate","candidate"}, {"type":"error",…}
  camera/webrtc/candidate         {entity_id, session_id, candidate} -> null

RBAC: every message asks `may_view(identity, entity_id)` first (camera live view is view-gated /
`control.sensitive` in §5; P3.2 owns the decision). Denied -> Forbidden, and nothing is forwarded.
A candidate is forwarded only for a WebRTC session HA opened for this same client connection and
camera, so one client can never feed candidates into another's session.

These are reads for HA's purposes (viewing changes nothing in the house). They go out on a
connection of their own (SignalingProxy) whose every frame passes ha_client.check_outgoing, the
"never a command" allowlist, and nothing but the signaling types (plus auth/unsubscribe) can be sent.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

from ..ha_client import SIGNALING_TYPES, CommandBlocked, check_outgoing
from ..readproxy import ReadProxy
from . import Ctx, Forbidden, Hooks, Route, read_routes, resolve

log = logging.getLogger("mantel.camera")

_refused_at: dict[str, float] = {}
REFUSED_WARN_EVERY = 300.0


def _warn_refused(entity_id: str, now: Callable[[], float] | None = None) -> None:
    """A refused live view, logged once per camera every REFUSED_WARN_EVERY seconds: a page whose live
    tiles are refused (the 'ha' door's tunnel rules without a step-up) asks again and again."""
    t = (now or time.monotonic)()
    if t - _refused_at.get(entity_id, float("-inf")) >= REFUSED_WARN_EVERY:
        if len(_refused_at) > 256:
            _refused_at.clear()
        _refused_at[entity_id] = t
        log.warning("refused camera view of %s (repeats are logged every %d s)", entity_id, REFUSED_WARN_EVERY)

CONFIG, OFFER, CANDIDATE = "camera/webrtc/get_client_config", "camera/webrtc/offer", "camera/webrtc/candidate"


def check_signaling(msg: dict) -> None:
    """What SignalingProxy.request/subscribe accept: the signaling types only, HA's allowlist too."""
    if msg.get("type") not in SIGNALING_TYPES:
        raise CommandBlocked(f"{msg.get('type')!r} is not camera signaling")
    check_outgoing(msg)


class SignalingProxy(ReadProxy):
    """A ReadProxy narrowed to camera signaling. Every frame it sends passes HA's allowlist."""
    check = staticmethod(check_signaling)

    async def _send(self, msg: dict) -> int:
        check_outgoing(msg)                       # the unsubscribe_events it sends itself included
        return await super()._send(msg)

    async def get_calendar_events(self, *args, **kwargs):  # not this connection's business
        raise CommandBlocked("the signaling connection reads nothing else")


class CameraSignaling:
    def __init__(self, proxy: Callable[[], SignalingProxy | None], hooks: Hooks | None = None) -> None:
        self._get = proxy
        self.hooks = Hooks.coerce(hooks)
        self.forwarded: list[str] = []            # message types sent upstream (tests, /api/stats later)

    def _proxy(self) -> SignalingProxy:
        p = self._get()
        if p is None:
            raise ConnectionError("unavailable")
        return p

    async def _gate(self, ctx: Ctx, msg: dict) -> str:
        entity_id = msg.get("entity_id")
        if not isinstance(entity_id, str) or not entity_id.startswith("camera."):
            raise CommandBlocked("camera signaling needs a camera entity_id")
        if await resolve(self.hooks.may_view(ctx.identity, entity_id)) is not True:
            _warn_refused(entity_id)
            raise Forbidden(f"may not view {entity_id}")
        return entity_id

    @staticmethod
    def _sessions(ctx: Ctx) -> dict[str, str]:
        return ctx.state.setdefault("camera_sessions", {})   # session_id -> camera, for this connection

    async def client_config(self, ctx: Ctx, msg: dict) -> Any:
        entity_id = await self._gate(ctx, msg)
        out = {"type": CONFIG, "entity_id": entity_id}
        check_signaling({**msg, **out})                       # refuses any extra key the page sent
        self.forwarded.append(CONFIG)
        return await self._proxy().request(out)               # HA's ICE config, unchanged

    async def candidate(self, ctx: Ctx, msg: dict) -> Any:
        entity_id = await self._gate(ctx, msg)
        check_signaling(msg)
        session_id = msg.get("session_id")
        if not isinstance(session_id, str) or self._sessions(ctx).get(session_id) != entity_id:
            raise Forbidden("not a WebRTC session of this connection")
        self.forwarded.append(CANDIDATE)
        return await self._proxy().request({"type": CANDIDATE, "entity_id": entity_id, "session_id": session_id,
                                            "candidate": msg.get("candidate")})

    async def offer(self, ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        entity_id = await self._gate(ctx, msg)
        check_signaling(msg)
        if not isinstance(msg.get("offer"), str):
            raise CommandBlocked("offer must be an SDP string")
        sessions = self._sessions(ctx)
        mine: set[str] = set()

        def relay(ev: dict) -> None:
            if isinstance(ev, dict) and ev.get("type") == "session" and isinstance(ev.get("session_id"), str):
                sessions[ev["session_id"]] = entity_id
                mine.add(ev["session_id"])
            on_event(ev)

        proxy = self._proxy()
        self.forwarded.append(OFFER)
        mid = await proxy.subscribe({"type": OFFER, "entity_id": entity_id, "offer": msg["offer"]}, relay)

        async def unsubscribe() -> None:
            for s in mine:
                sessions.pop(s, None)
            await proxy.unsubscribe(mid)           # HA ends the WebRTC session
        return unsubscribe


def register(app, hub, hooks) -> CameraSignaling:
    """Camera signaling as read routes: the page sends these exactly as it would to HA, inside
    `read` (get_client_config, candidate) and `read_subscribe` (offer); readproxy's handlers route
    them here. Needs hooks.ha_token (Mantel's HA credential) to open the signaling connection."""
    hooks = Hooks.coerce(hooks)
    holder: dict[str, SignalingProxy | None] = {"proxy": None}
    signaling = CameraSignaling(lambda: holder["proxy"], hooks)
    app["camera_signaling"] = signaling
    app["camera_signaling_holder"] = holder         # connections.py retargets the proxy on a new HA credential
    read_routes(app).update({
        CONFIG: Route(request=signaling.client_config),
        CANDIDATE: Route(request=signaling.candidate),
        OFFER: Route(subscribe=signaling.offer),
    })

    async def start(app) -> None:
        if hooks.ha_token is not None:
            cfg = app["cfg"]
            holder["proxy"] = SignalingProxy(cfg.ha_url, hooks.ha_token(), ws_url=getattr(cfg, "ha_ws_url", "") or None)

    async def stop(app) -> None:
        if holder["proxy"] is not None:
            await holder["proxy"].close()
            holder["proxy"] = None

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return signaling
