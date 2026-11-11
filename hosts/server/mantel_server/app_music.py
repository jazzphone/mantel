"""The apps' music, over REST (docs/phase10/APPLE-APPS.md §12: the Mac app's native player).

The screens' Music page talks to the house over its socket (``hk_music/subscribe``, ``hk_music/queue``,
``music_assistant/get_library``, the gateway's ``hk_frontend.music_*`` commands). A native player has no socket, so
this is the same music through the apps' REST door: every route DPoP-bound to the app's credential
(app_auth.app_route), every answer the screens' own, every check the screens' own -- nothing is decided here.

  GET  /api/app/music               the music settings this person may see (music.py MusicHost.payload: speakers,
                                    presets, floors, playlists, home) with what plays now: every room's state and
                                    the house's music grouped as the screens group it (``contexts``, hkMusic's rule
                                    in hk-base.js, ported below), and this person's speaker (``focus``)
  POST /api/app/music/command       {service: transport|transfer|play|play_media|stop, data}: hk_frontend.music_<service>
                                    through the gateway with its answer (``{ok, message, leader, ...}``), exactly the
                                    Music page's request (music.py classify_service: RBAC, the audit row)
  POST /api/app/music/volume        {entity_id: id | [ids], level}: media_player.volume_set through the gateway
  PUT  /api/app/music/focus         {key}: this person's speaker (user_data ``hk_music_focus``, as setFocus writes it)
  GET  /api/app/music/queue?entity_id=&limit=   what plays next (music.py's hk_music/queue: view on the player)
  POST /api/app/music/queue/play    {entity_id, item_id}: play that song (the gateway's hk_music/queue_play)
  GET  /api/app/music/library?media_type=&search=&favorite=&order_by=&limit=&offset=
                                    Music Assistant's library (music.py check_get_library and get_library)
  GET  /api/app/music/image?id=<proxy id>       a library picture through Mantel (Music Assistant's image proxy;
                                    the page's ``/ma/imageproxy/<id>`` needs a browser session)

Only Mantel's own music engine (MusicHost.active: Music Assistant and the music settings in Mantel) is answered
here; a house still on HA's engine answers ``{configured: false}``.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from aiohttp import web

from . import user_data as UD
from .app_auth import app_route
from .connectors import allowed_ids, may_feature
from .identity.guards import WHY_APP, open_route
from .identity.sessions import error, ok

MEDIA_PLAYER = re.compile(r"^media_player\.[a-z0-9_]+$")
PROXY_ID = re.compile(r"^[0-9a-f]{64}$")
SERVICES = ("transport", "transfer", "play", "play_media", "stop")
STATUS = {"forbidden": 403, "commands_disabled": 503, "unavailable": 503, "invalid_command": 400,
          "not_allowed": 400, "audit_unavailable": 503, "not_a_write": 400}
ATTRS = ("media_title", "media_artist", "media_album_name", "media_duration", "media_position",
         "media_position_updated_at", "volume_level", "is_volume_muted", "shuffle", "repeat", "app_id", "source")


def _principal(request: web.Request):
    authz = request.app.get("authz")
    return authz.principal(request) if authz is not None else None


def _hooks(request: web.Request):
    from .connectors import Hooks
    authz = request.app.get("authz")
    return Hooks(may_read=authz.may_read) if authz is not None else Hooks()


def _host(request: web.Request):
    host = request.app.get("music")
    return host if host is not None and host.active else None


def _app_image(img: Any) -> str | None:
    """A picture the app can load: a web address as it is; Music Assistant's proxy through this door."""
    if not isinstance(img, str) or not img:
        return None
    m = re.match(r"^/ma/imageproxy/([0-9a-f]{64})", img)
    if m:
        return f"/api/app/music/image?id={m.group(1)}"
    return img if img.startswith(("https://", "http://")) else None


# ---------------------------------------------------------------------------------------- what plays (hkMusic)
def _ignored(st: dict | None, cfg: dict) -> bool:
    """hkMusic.ignored: an Intercom message always; else only explicit announcement evidence, and only with Ignore
    Announcements on."""
    if not st:
        return False
    if st.get("entity_id") in (cfg.get("intercom") or []):
        return True
    if not cfg.get("ignore_announcements"):
        return False
    a = st.get("a") or {}
    cid = str(a.get("media_content_id") or "")
    return (st.get("entity_id") in (cfg.get("announcements") or []) or a.get("announcement") is True
            or a.get("media_content_type") == "announcement" or cid.startswith("media-source://tts/")
            or re.match(r"^https?://[^/]+/api/tts_proxy/", cid) is not None)


def _held(eid: str, st: dict | None, cfg: dict) -> bool:
    """hkMusic.held: music Music Assistant stopped after a pause (hk_core/music/resume.py) reads as paused."""
    return st is not None and st.get("s") == "idle" and eid in (cfg.get("resumable") or [])


def _active(eid: str, states: dict, cfg: dict) -> bool:
    st = states.get(eid)
    return st is not None and not _ignored(dict(st, entity_id=eid), cfg) and (
        st.get("s") in ("playing", "paused") or _held(eid, st, cfg))


def contexts(cfg: dict, states: dict) -> list[dict[str, Any]]:
    """EVERY SEPARATE THING THE HOUSE IS PLAYING, as hkMusic.contexts (hk-base.js) derives it: a group keyed by its
    leader (group_members[0]), its `preset` the name of the preset whose rooms it is exactly, or one room. A preset is
    its rooms (hk_core/music/config.py): its id is no player."""
    speakers = cfg.get("speakers") or []
    presets = [s for s in speakers if s.get("members")]
    rooms = [s for s in speakers if not s.get("members")]
    known = {s["entity"] for s in rooms}
    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    def ctx(key: str, kind: str, members: list[str], st: dict) -> dict[str, Any]:
        a = st.get("a") or {}
        return {"key": key, "kind": kind, "leader": members[0], "members": members,
                "playing": st.get("s") == "playing", "state": "paused" if _held(key, st, cfg) else st.get("s") or "unknown",
                "title": a.get("media_title") or "", "artist": a.get("media_artist") or "", "since": st.get("lc") or 0}
    part_of = {p: s["entity"] for s in rooms for p in s.get("parts") or [] if p != s["entity"]}
    for r in rooms:
        eid = r["entity"]
        if eid in seen or not _active(eid, states, cfg):
            continue
        st = states[eid]
        # (hkMusic.fold: a virtual pair's second player is its room, once)
        gm = list(dict.fromkeys(part_of.get(e, e) for e in ((st.get("a") or {}).get("group_members") or [])))
        gm = [e for e in gm if e in known and not _ignored(dict(states.get(e) or {}, entity_id=e), cfg)]
        members = gm if len(gm) > 1 else [eid]
        seen.update(members)
        lead = members[0]
        c = ctx(lead, "group" if len(members) > 1 else "room", members, states.get(lead) or st)
        pre = next((p for p in presets if len(members) > 1 and sorted(p["members"]) == sorted(members)), None)
        if pre is not None:
            c["preset"] = pre.get("name")
        out.append(c)
    return out


def _player(request: web.Request, eid: str, name: str) -> dict[str, Any] | None:
    from .app_api import _art
    st = request.app["hub"].store.states.get(eid)
    if st is None:
        return None
    a = st.get("a") or {}
    return {"entity": eid, "name": name, "state": st.get("s") or "unknown",
            "attributes": {k: a[k] for k in ATTRS if k in a}, "group_members": a.get("group_members") or [],
            "art": _art(eid, a)}


# ---------------------------------------------------------------------------------------- the routes
@open_route("app_dpop", reads="view", why=WHY_APP)
@app_route
async def music(request: web.Request) -> web.Response:
    host = _host(request)
    if host is None:
        return ok({"configured": False})
    principal = _principal(request)
    cfg = await host.payload(principal)
    if not cfg.get("configured"):
        return ok({"configured": False})
    states = request.app["hub"].store.states
    players = [p for p in (_player(request, s["entity"], s["name"]) for s in cfg.get("speakers") or []) if p]
    data: UD.UserData = request.app["user_data"]
    focus = data.get(f"u:{principal.user.id}", "hk_music_focus") if principal and principal.user else None
    out = dict(cfg)
    out.update({"players": players, "contexts": contexts(cfg, states),
                "focus": focus.get("key") if isinstance(focus, dict) else None,
                "commands": request.app.get("gateway") is not None, "at": request.app["clock"]()})
    if isinstance(out.get("library_entry"), str):
        out["library"] = True            # Browse can read Music Assistant's library (the entry id stays here)
    out.pop("library_entry", None)
    return ok(out)


async def _gateway(request: web.Request, msg: dict) -> web.Response:
    gw = request.app.get("gateway")
    if gw is None:
        return error(503, "commands_disabled", message="Commands are off on this Mantel.")
    replies: list[dict] = []

    async def send(m: dict) -> None:
        replies.append(m)
    try:
        await asyncio.wait_for(gw.handle(_principal(request), dict(msg, type="command", id=1), send), 60)
    except asyncio.TimeoutError:
        return error(504, "timeout")
    got = replies[-1] if replies else {"error": {"code": "unavailable"}}
    if "error" in got:
        code = got["error"].get("code") or "failed"
        return web.json_response({"error": code, **{k: v for k, v in got["error"].items() if k != "code"},
                                  "audit_id": got.get("audit_id")}, status=STATUS.get(code, 502),
                                 headers={"Cache-Control": "no-store"})
    result = got.get("result")
    # a service's answer is in `response` (return_response); a write's (hk_music/queue_play) is the result itself
    response = result.get("response") if isinstance(result, dict) and "response" in result else result
    return ok({"response": response, "audit_id": got.get("audit_id")})


async def _body(request: web.Request) -> dict | None:
    try:
        body = await request.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


@open_route("app_dpop", why=WHY_APP)
@app_route
async def command(request: web.Request) -> web.Response:
    """The Music page's own requests: hk_frontend.music_<service> with its fields in ``data`` and the answer."""
    body = await _body(request)
    if body is None or set(body) - {"service", "data"} or body.get("service") not in SERVICES \
            or not isinstance(body.get("data", {}), dict):
        return error(400, "invalid_command")
    return await _gateway(request, {"kind": "service", "domain": "hk_frontend", "service": f"music_{body['service']}",
                                    "data": body.get("data") or {}, "return_response": True})


@open_route("app_dpop", why=WHY_APP)
@app_route
async def volume(request: web.Request) -> web.Response:
    body = await _body(request)
    if body is None or set(body) - {"entity_id", "level"}:
        return error(400, "invalid_command")
    ids, level = body.get("entity_id"), body.get("level")
    ids = [ids] if isinstance(ids, str) else ids
    if not (isinstance(ids, list) and 0 < len(ids) <= 20 and all(isinstance(i, str) and MEDIA_PLAYER.match(i) for i in ids)
            and isinstance(level, (int, float)) and not isinstance(level, bool) and 0 <= level <= 1):
        return error(400, "invalid_command")
    return await _gateway(request, {"kind": "service", "domain": "media_player", "service": "volume_set",
                                    "target": {"entity_id": ids if len(ids) > 1 else ids[0]},
                                    "data": {"volume_level": round(float(level), 3)}})


@open_route("app_dpop", why=WHY_APP)
@app_route
async def put_focus(request: web.Request) -> web.Response:
    """This person's speaker, as the Music page's setFocus writes it ({key, at}); views on it decide."""
    body = await _body(request)
    key = body.get("key") if body else None
    if body is None or set(body) - {"key"} or not (key is None or (isinstance(key, str) and MEDIA_PLAYER.match(key))):
        return error(400, "invalid_focus")
    principal = _principal(request)
    if key is not None and key not in await allowed_ids(_hooks(request), principal, "view", [key]):
        return error(404, "not_found")
    data: UD.UserData = request.app["user_data"]
    value = {"key": key, "at": int(time.time() * 1000)} if key else None
    try:
        data.set(f"u:{principal.user.id}", "hk_music_focus", value)
    except ValueError:
        return error(400, "invalid_focus")
    return ok({"focus": key})


@open_route("app_dpop", reads="view", why=WHY_APP)
@app_route
async def queue(request: web.Request) -> web.Response:
    from .music import QUEUE_MAX
    host = _host(request)
    eid = request.query.get("entity_id") or ""
    try:
        limit = int(request.query.get("limit") or 40)
    except ValueError:
        return error(400, "invalid_query")
    if host is None:
        return error(503, "unavailable")
    if not MEDIA_PLAYER.match(eid) or not 1 <= limit <= QUEUE_MAX:
        return error(400, "invalid_query")
    if eid not in await allowed_ids(_hooks(request), _principal(request), "view", [eid]):
        return error(404, "not_found")
    got = await host.queue(eid, limit)
    for item in got.get("items") or []:
        item["image"] = _app_image(item.get("image"))
    return ok(got)


@open_route("app_dpop", why=WHY_APP)
@app_route
async def queue_play(request: web.Request) -> web.Response:
    body = await _body(request)
    if body is None or set(body) - {"entity_id", "item_id"}:
        return error(400, "invalid_command")
    return await _gateway(request, {"kind": "ws", "msg": {"type": "hk_music/queue_play",
                                                           "entity_id": body.get("entity_id"),
                                                           "item_id": body.get("item_id")}})


@open_route("app_dpop", reads="feature:music", why=WHY_APP)
@app_route
async def library(request: web.Request) -> web.Response:
    from .music import check_get_library
    host = _host(request)
    if host is None or host.ma is None:
        return error(503, "unavailable", message="Music Assistant is not connected to Mantel.")
    q: dict[str, Any] = {}
    for k, v in request.query.items():
        if k in ("limit", "offset"):
            try:
                q[k] = int(v)
            except ValueError:
                return error(400, "invalid_query")
        elif k in ("favorite", "album_artists_only"):
            q[k] = v == "true"
        else:
            q[k] = v
    try:
        query = check_get_library(q)
    except ValueError as err:
        return error(400, "invalid_query", message=str(err))
    if not await may_feature(_hooks(request), _principal(request), "music"):
        return error(403, "forbidden")
    try:
        got = await host.get_library(query)
    except ConnectionError as err:
        return error(503, "unavailable", message=str(err))

    def fix(item: dict) -> dict:
        item["image"] = _app_image(item.get("image"))
        for a in item.get("artists") or []:
            a["image"] = _app_image(a.get("image"))
        if isinstance(item.get("album"), dict):
            item["album"]["image"] = _app_image(item["album"].get("image"))
        return item
    return ok({"items": [fix(i) for i in got.get("items") or []]})


@open_route("app_dpop", reads="feature:music", why=WHY_APP,
            stream="bounded:one picture, 20 MB at most (camera_still.MAX_BYTES)")
@app_route
async def image(request: web.Request) -> web.StreamResponse:
    """A library picture: Music Assistant's image proxy, for ``feature:music``."""
    from .connectors import camera_still
    from .media_proxy import ma_web_url
    pid = (request.query.get("id") or "").lower()
    base = ma_web_url(request.app["cfg"], request.app.get("connections"))
    if not PROXY_ID.match(pid) or not base or _host(request) is None:
        return error(404, "not_found")
    if not await may_feature(_hooks(request), _principal(request), "music"):
        return error(404, "not_found")
    return await camera_still.proxy_image(request, f"{base}/imageproxy/{pid}", {"size": "512"}, None,
                                          "a library picture", "image_unavailable", not_found="not_found")


PATHS = ("/api/app/music", "/api/app/music/command", "/api/app/music/volume", "/api/app/music/focus",
         "/api/app/music/queue", "/api/app/music/queue/play", "/api/app/music/library", "/api/app/music/image")


def register(app: web.Application, hub: Any = None) -> None:
    # (open to the browser-session check: app_route checks the app's own credential on every one)
    app.setdefault("public_paths", set()).update(PATHS)
    app.router.add_get("/api/app/music", music)
    app.router.add_post("/api/app/music/command", command)
    app.router.add_post("/api/app/music/volume", volume)
    app.router.add_put("/api/app/music/focus", put_focus)
    app.router.add_get("/api/app/music/queue", queue)
    app.router.add_post("/api/app/music/queue/play", queue_play)
    app.router.add_get("/api/app/music/library", library)
    app.router.add_get("/api/app/music/image", image)
