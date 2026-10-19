"""What the apps' system surfaces ask the house (docs/phase10/APPLE-APPS.md §1, §6, §7; slice 10.3).

Widgets, Control Center, Siri/Shortcuts, Live Activities and the Mac menu bar cannot keep a WebSocket open, so
they use a small REST door, every route DPoP-bound to the app's credential (app_auth.app_route) and decided by
the server exactly as the screens' socket is:

  GET  /api/app/summary          the person's favorites (state, name, a few attributes) and what plays on the
                                 person's speaker; only what they may ``view`` (RBAC on the door they come by).
                                 Widgets cache it in the App Group for their timelines.
  GET  /api/app/favorites        the person's favorites (user_data ``favorites``: entity ids, in order)
  PUT  /api/app/favorites        {favorites: [entity ids]} (at most FAVORITES_MAX)
  GET  /api/app/entities?q=      what the person may view, to choose favorites from (name, domain, area)
  POST /api/app/command          {domain, service, entity_id, data?}: ONE service call through the command
                                 gateway (gateway.py): RBAC on the target, the audit row first, the music engine for
                                 media players, the tunnel's switches. Off (503 commands_disabled) unless the server's
                                 operator turned commands on. The alarm keeps the house Alarm PIN (``data.code``).

The favorites live in user_data (``favorites``), the same list for the phone's widgets, Control Center, Siri and
the Mac. The apps decide nothing: a refused command is the gateway's answer, audited like any other.
"""
from __future__ import annotations

import asyncio
import re
from aiohttp import web

from . import user_data as UD
from .app_auth import app_route
from .sessions import error, ok

ENTITY = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")
SERVICE = re.compile(r"^[a-z_]{1,64}$")
FAVORITES_KEY = UD.FAVORITES
FAVORITES_MAX = UD.FAVORITES_MAX
# the domains a favorite can be: things one switches, opens, plays or reads at a glance
FAVORITE_DOMAINS = frozenset({"light", "switch", "fan", "cover", "lock", "climate", "media_player", "scene", "script",
                              "input_boolean", "button", "input_button", "valve", "vacuum", "alarm_control_panel",
                              "sensor", "binary_sensor", "camera", "humidifier", "water_heater"})
ATTRS = ("friendly_name", "unit_of_measurement", "device_class", "brightness", "color_mode", "current_position",
         "temperature", "current_temperature", "hvac_action", "target_temp_high", "target_temp_low", "media_title",
         "media_artist", "media_album_name", "volume_level", "is_volume_muted", "media_duration", "media_position",
         "media_position_updated_at", "supported_features", "percentage", "icon")
STATUS = {"forbidden": 403, "commands_disabled": 503, "unavailable": 503, "unauthenticated": 401,
          "invalid_command": 400, "not_allowed": 400, "audit_unavailable": 503}


_favorites_shape = UD._favorites


def _subject(request: web.Request) -> str:
    return f"u:{request['app_identity'].user.id}"


def _principal(request: web.Request):
    authz = request.app.get("authz")
    return authz.principal(request) if authz is not None else None


def _visible(request: web.Request, ids: list[str]) -> list[str]:
    authz = request.app.get("authz")
    if authz is None:
        return []
    allowed = set(authz.may_read(_principal(request), "view", ids))
    return [i for i in ids if i in allowed]


def _entity_json(app, eid: str) -> dict | None:
    hub = app.get("hub")
    st = hub.store.states.get(eid) if hub is not None else None
    if st is None:
        return None
    attrs = st.get("a") or {}
    reg = hub.registry
    area = reg.entity_area.get(eid)
    return {"entity_id": eid, "domain": eid.split(".", 1)[0], "state": st.get("s"),
            "name": attrs.get("friendly_name") or eid, "area": reg.areas.get(area) if area else None,
            "attributes": {k: attrs[k] for k in ATTRS if k in attrs}, "last_changed": st.get("lc")}


@app_route
async def summary(request: web.Request) -> web.Response:
    data: UD.UserData = request.app["user_data"]
    subject = _subject(request)
    favorites = data.get(subject, FAVORITES_KEY) or []
    shown = [e for e in (_entity_json(request.app, eid) for eid in _visible(request, favorites)) if e is not None]
    focus = data.get(subject, "hk_music_focus") or {}
    speaker = focus.get("key") if isinstance(focus, dict) else None
    playing = None
    if isinstance(speaker, str) and _visible(request, [speaker]):
        playing = _entity_json(request.app, speaker)
    ident = request["app_identity"]
    return ok({"favorites": shown, "now_playing": playing, "door": ident.door,
               "commands": request.app.get("gateway") is not None, "at": request.app["clock"]()})


@app_route
async def get_favorites(request: web.Request) -> web.Response:
    return ok({"favorites": request.app["user_data"].get(_subject(request), FAVORITES_KEY) or []})


@app_route
async def put_favorites(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except ValueError:
        return error(400, "invalid_json")
    favs = body.get("favorites") if isinstance(body, dict) else None
    if not _favorites_shape(favs) or any(f.split(".", 1)[0] not in FAVORITE_DOMAINS for f in favs):
        return error(400, "invalid", message=f"favorites are up to {FAVORITES_MAX} entity ids of the kinds a favorite can be")
    try:
        request.app["user_data"].set(_subject(request), FAVORITES_KEY, favs or None)
    except UD.Refused as exc:
        return error(400, exc.code, message=str(exc))
    return ok({"favorites": favs})


@app_route
async def entities(request: web.Request) -> web.Response:
    hub = request.app["hub"]
    q = (request.query.get("q") or "").strip().lower()[:64]
    ids = [e for e in hub.store.states if e.split(".", 1)[0] in FAVORITE_DOMAINS]
    out = []
    for eid in _visible(request, sorted(ids)):
        e = _entity_json(request.app, eid)
        if e is None or (q and q not in e["name"].lower() and q not in eid):
            continue
        out.append({k: e[k] for k in ("entity_id", "domain", "name", "area", "state")})
        if len(out) >= 500:
            break
    return ok({"entities": out})


@app_route
async def command(request: web.Request) -> web.Response:
    gw = request.app.get("gateway")
    if gw is None:
        return error(503, "commands_disabled", message="Commands are off on this Mantel.")
    try:
        body = await request.json()
    except ValueError:
        return error(400, "invalid_json")
    if not isinstance(body, dict) or set(body) - {"domain", "service", "entity_id", "data"}:
        return error(400, "invalid_command")
    domain, service, eid, data = body.get("domain"), body.get("service"), body.get("entity_id"), body.get("data") or {}
    if not (isinstance(domain, str) and SERVICE.match(domain) and isinstance(service, str) and SERVICE.match(service)
            and isinstance(eid, str) and ENTITY.match(eid) and isinstance(data, dict)):
        return error(400, "invalid_command")
    principal = _principal(request)
    replies: list[dict] = []

    async def send(msg: dict) -> None:
        replies.append(msg)
    msg = {"type": "command", "id": 1, "kind": "service", "domain": domain, "service": service,
           "target": {"entity_id": eid}, "data": data}
    try:
        await asyncio.wait_for(gw.handle(principal, msg, send), 30)
    except asyncio.TimeoutError:
        return error(504, "timeout")
    got = replies[-1] if replies else {"error": {"code": "unavailable"}}
    if "error" in got:
        code = got["error"].get("code") or "failed"
        return web.json_response({"error": code, **{k: v for k, v in got["error"].items() if k != "code"},
                                  "audit_id": got.get("audit_id")}, status=STATUS.get(code, 502),
                                 headers={"Cache-Control": "no-store"})
    return ok({"result": got.get("result"), "audit_id": got.get("audit_id")})


def register(app: web.Application, hub=None) -> None:
    app.router.add_get("/api/app/summary", summary)
    app.router.add_get("/api/app/favorites", get_favorites)
    app.router.add_put("/api/app/favorites", put_favorites)
    app.router.add_get("/api/app/entities", entities)
    app.router.add_post("/api/app/command", command)
    app.setdefault("public_paths", set()).update({"/api/app/summary", "/api/app/favorites", "/api/app/entities",
                                                  "/api/app/command"})
