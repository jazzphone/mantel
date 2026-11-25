"""What the apps' system surfaces ask the house (docs/phase10/APPLE-APPS.md §1, §6, §7; slice 10.3).

Widgets, Control Center, Siri/Shortcuts, Live Activities and the Mac menu bar cannot keep a WebSocket open, so
they use a small REST door, every route DPoP-bound to the app's credential (app_auth.app_route) and decided by
the server exactly as the screens' socket is:

  GET  /api/app/summary          the person's favorites (state, name, a few attributes) and what plays on the
                                 person's speaker; only what they may ``view`` (RBAC on the door they come by).
                                 Widgets cache it in the App Group for their timelines.
  GET  /api/app/favorites        the person's favorites (user_data ``favorites``: entity ids, in order)
  PUT  /api/app/favorites        {favorites: [entity ids]} (at most FAVORITES_MAX)
  GET  /api/app/entities?q=&domains=a,b  what the person may view, to choose favorites and a widget's accessory from
                                 (name, domain, area): ``domains`` keeps those kinds (and lifts the cap to
                                 ENTITIES_KIND_MAX); never what Home Assistant hides or files as a device's
                                 configuration or diagnostics (a plug's Restart button, its signal strength)
  GET  /api/app/states?ids=a,b   chosen accessories' states (at most STATES_MAX), only those the person may view, in
                                 the order asked: the widgets made for one thing (an accessory, a thermostat, the
                                 house's doors and locks); ``?domain=timer`` instead: every timer the person may view
                                 that counts (active or paused), soonest first
  GET  /api/app/history?id=&hours=  a reading's last hours (1 to HISTORY_HOURS_MAX, 24 unless asked) as at most
                                 HISTORY_POINTS averaged points [epoch seconds, value], for the Sensor widget's
                                 graph; only with ``history`` on it (a Child or a guest may see a reading and not
                                 its past). A reading that is not a number answers no points.
  GET  /api/app/energy          the Power and Energy widgets: the Power page's readings now (the whole house, solar,
                                 the grid, the house battery) and today's energy and cost so far, from the Energy
                                 feature's plan; ``?rings=1`` adds today's Energy Rings (hk_core.energy.rings); ``?devices=1``
                                 what each device uses now, biggest first (the Power page's devices: CarPlay's Using Now);
                                 only with ``view`` on ``feature:energy`` (403 forbidden; 409
                                 energy_off when the feature is off), each reading only if the person may view it
  GET  /api/app/laundry         the Laundry widget: each washer and dryer (Accessories -> Laundry's, else those found) the
                                 person may view by what says it runs: its state (hk_core.laundry STATES), when it
                                 finishes, its progress, and Done held until someone unloads (features/laundry.py)
  GET  /api/app/tv              the Live TV widget: the channels the person may watch (Live TV's own list, its rule:
                                 feature:live_tv, view on each channel's camera), each with its logo and what is on
  GET  /api/app/art?entity=      a player's artwork (media_art.py's rule: view on the player)
  GET  /api/app/snap?id=         a notification's snapshot (notify_snaps.py's rule), for the notification extension
  POST /api/app/push/register    the app's APNs token and notification key (apns.py); refused (409 push_off) once
                                 the person stopped this app in Mantel Settings, until the app asks again
                                 (``resume: true``: the person chose Turn On Notifications in the app)
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
from typing import Any

from aiohttp import web

from hk_core import glyphs as G

from .. import apns
from . import app_crypto
from ..storage import user_data as UD
from .app_auth import app_route
from ..identity.guards import WHY_APP, open_route
from ..identity.sessions import error, ok

ENTITY = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")
SERVICE = re.compile(r"^[a-z_]{1,64}$")
FAVORITES_KEY = UD.FAVORITES
FAVORITES_MAX = UD.FAVORITES_MAX
# the domains a favorite can be: things one switches, opens, plays or reads at a glance
FAVORITE_DOMAINS = frozenset({"light", "switch", "fan", "cover", "lock", "climate", "media_player", "scene", "script",
                              "input_boolean", "button", "input_button", "valve", "vacuum", "alarm_control_panel",
                              "sensor", "binary_sensor", "camera", "humidifier", "water_heater"})
READINGS = frozenset({"sensor", "binary_sensor", "camera"})
ATTRS = ("friendly_name", "unit_of_measurement", "device_class", "brightness", "color_mode", "current_position",
         "temperature", "current_temperature", "hvac_action", "target_temp_high", "target_temp_low", "media_title",
         "media_artist", "media_album_name", "volume_level", "is_volume_muted", "media_duration", "media_position",
         "media_position_updated_at", "supported_features", "percentage", "icon",
         # a timer's countdown and a thermostat's range (the widgets: a timer counts down on its own from finishes_at)
         "finishes_at", "remaining", "duration", "min_temp", "max_temp", "target_temp_step", "hvac_modes")
STATES_MAX = 24
ENTITIES_MAX = 500          # every kind: the things one switches first, the readings after
ENTITIES_KIND_MAX = 2000    # the kinds asked (a widget's Type): a house's 690 switches fit
# what Home Assistant files as a device's own settings or health, never chosen for a widget or a favorite
HIDDEN_CATEGORIES = frozenset({"config", "diagnostic"})
STATE_DOMAINS = frozenset({"timer"})
HISTORY_DOMAINS = frozenset({"sensor", "binary_sensor", "number", "input_number", "counter"})
HISTORY_HOURS_MAX = 168
HISTORY_POINTS = 48
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


_MODELS: dict[str, Any] = {"loads": None, "by": {}}


def _model(reg, device_id) -> str | None:
    """A device's model, from the registry (an index kept per registry load)."""
    if not device_id:
        return None
    if _MODELS["loads"] != getattr(reg, "loads", None):
        _MODELS["by"] = {d.get("id"): d.get("model") for d in (getattr(reg, "device_entries", None) or [])
                         if isinstance(d, dict)}
        _MODELS["loads"] = getattr(reg, "loads", None)
    m = _MODELS["by"].get(device_id)
    return m if isinstance(m, str) else None


def _accessory(app, eid: str) -> dict | None:
    """The house's own settings for an accessory (Accessories: its gear), if any."""
    settings = app.get("settings")
    try:
        body = settings.store.body("house", "accessories") if settings is not None else None
    except Exception:  # noqa: BLE001 -- no settings yet: none chosen
        return None
    acc = ((body or {}).get("entities") or {}).get(eid) if isinstance(body, dict) else None
    return acc if isinstance(acc, dict) else None


def _entity_json(app, eid: str) -> dict | None:
    hub = app.get("hub")
    st = hub.store.states.get(eid) if hub is not None else None
    if st is None:
        return None
    attrs = st.get("a") or {}
    reg = hub.registry
    area = reg.entity_area.get(eid)
    out = {"entity_id": eid, "domain": eid.split(".", 1)[0], "state": st.get("s"),
           "name": attrs.get("friendly_name") or eid, "area": reg.areas.get(area) if area else None,
           "attributes": {k: attrs[k] for k in ATTRS if k in attrs}, "last_changed": st.get("lc")}
    # the glyph the screens draw for it (hk_core.glyphs: the house's own choice, then what it is), so a widget draws
    # the same (2026-11-24, the owner: "I'd like our glyphs to come through ... regardless of where they are drawn")
    entry = (getattr(reg, "entries", None) or {}).get(eid) or {}
    out["glyph"] = G.glyph(eid, st.get("s"), attrs, out["name"], entry, _accessory(app, eid),
                           _model(reg, entry.get("device_id")))
    if out["domain"] == "media_player":
        out["art"] = _art(eid, attrs)
    return out


def _art(eid: str, attrs: dict) -> str | None:
    """Where the app gets a player's artwork: a remote picture as it is (a provider's CDN: no token in it), HA's
    signed one through Mantel (``/api/app/art``, media_art.py's rule), with a version so a new track is new art."""
    from ..connectors import camera_still, media_art
    pic = attrs.get("entity_picture")
    if not isinstance(pic, str) or not pic:
        return None
    if pic.startswith(("https://", "http://")):
        return pic
    if pic.startswith(media_art.HA_PROXY) and media_art.PLAYER_ID.match(eid):
        return f"/api/app/art?entity={eid}&v={camera_still.version_of(pic)}"
    return None


@open_route("app_dpop", reads="view", why=WHY_APP, stream="bounded:one picture, 20 MB at most (camera_still.MAX_BYTES)")
@app_route
async def art(request: web.Request) -> web.StreamResponse:
    """A player's artwork for the Live Activity and widgets: ``view`` on the player decides (media_art.py)."""
    from ..connectors import camera_still, media_art
    eid = request.query.get("entity") or ""
    authz, hub = request.app.get("authz"), request.app["hub"]
    if not media_art.PLAYER_ID.match(eid) or authz is None or authz.may_see(authz.principal(request), eid) is not True:
        return error(404, "not_found")
    if eid not in hub.store.states:
        return error(404, "not_found")
    conns = request.app.get("connections")
    token = conns.ha_token() if conns is not None else ""
    url = f"{request.app['cfg'].ha_url.rstrip('/')}{media_art.HA_PROXY}{eid}"
    return await camera_still.proxy_image(request, url, {}, token, f"artwork for {eid}", "artwork_unavailable",
                                          not_found="no_artwork")


@open_route("app_dpop", reads="view", why=WHY_APP)
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
    if playing is not None:
        # its group's rooms, itself first, the ones this person may see: the app's Volume Up / Down sets every one
        st = request.app["hub"].store.states.get(speaker) or {}
        gm = (st.get("a") or {}).get("group_members")
        if isinstance(gm, list) and len(gm) > 1:
            playing["group"] = _visible(request, [g for g in gm if isinstance(g, str)])
    ident = request["app_identity"]
    return ok({"favorites": shown, "now_playing": playing, "door": ident.door,
               "commands": request.app.get("gateway") is not None, "at": request.app["clock"]()})


@open_route("app_dpop", reads="view", why=WHY_APP)
@app_route
async def states(request: web.Request) -> web.Response:
    ids_q, domain = request.query.get("ids"), request.query.get("domain")
    if (ids_q is None) == (domain is None):
        return error(400, "invalid_query", message="ids or domain")
    if domain is not None:
        if domain not in STATE_DOMAINS:
            return error(400, "invalid_query")
        store = request.app["hub"].store.states
        ids = sorted(e for e, st in store.items() if e.startswith(domain + ".") and st.get("s") in ("active", "paused"))
    else:
        ids = list(dict.fromkeys(i for i in ids_q.split(",") if i))
        if not 0 < len(ids) <= STATES_MAX or not all(ENTITY.match(i) for i in ids):
            return error(400, "invalid_query", message=f"1 to {STATES_MAX} entity ids")
    shown = [e for e in (_entity_json(request.app, eid) for eid in _visible(request, ids)) if e is not None]
    if domain is not None:
        shown = sorted(shown, key=lambda e: str((e.get("attributes") or {}).get("finishes_at") or "~"))[:STATES_MAX]
    return ok({"states": shown, "at": request.app["clock"]()})


def _number(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _when(row: dict) -> float | None:
    """A history row's time: the compressed form's epoch (``lu``/``lc``), else its ISO ``last_changed``."""
    for k in ("lu", "lc"):
        if isinstance(row.get(k), (int, float)):
            return float(row[k])
    from datetime import datetime
    for k in ("last_updated", "last_changed"):
        if isinstance(row.get(k), str):
            try:
                return datetime.fromisoformat(row[k].replace("Z", "+00:00")).timestamp()
            except ValueError:
                pass
    return None


def history_points(rows: list, start: float, end: float, n: int = HISTORY_POINTS) -> list[list[float]]:
    """At most ``n`` points over [start, end]: each the average of the numbers that fell in its slice, at the slice's
    middle; a reading from before the window counts from the start (it held until the next one)."""
    width = (end - start) / n
    sums, counts = [0.0] * n, [0] * n
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        v, t = _number(row.get("s", row.get("state"))), _when(row)
        if v is None or t is None or t > end:
            continue
        i = min(n - 1, max(0, int((t - start) // width)))
        sums[i] += v
        counts[i] += 1
    return [[round(start + (i + 0.5) * width, 1), round(sums[i] / counts[i], 3)] for i in range(n) if counts[i]]


@open_route("app_dpop", reads="view", why=WHY_APP)     # and history on the reading, below
@app_route
async def history(request: web.Request) -> web.Response:
    eid = request.query.get("id") or ""
    try:
        hours = int(request.query.get("hours") or 24)
    except ValueError:
        hours = 0
    if not ENTITY.match(eid) or eid.split(".", 1)[0] not in HISTORY_DOMAINS or not 0 < hours <= HISTORY_HOURS_MAX:
        return error(400, "invalid_query", message=f"id of a reading, hours 1 to {HISTORY_HOURS_MAX}")
    authz = request.app.get("authz")
    if authz is None or eid not in authz.may_read(_principal(request), "history", [eid]):
        return error(403, "forbidden")
    proxy = getattr(request.app["hub"], "readproxy", None)
    if proxy is None:
        return error(503, "unavailable")
    from datetime import datetime, timezone
    end = float(request.app["clock"]())
    start = end - hours * 3600
    def iso(t: float) -> str:
        return datetime.fromtimestamp(t, timezone.utc).isoformat()
    try:
        res = await proxy.request({"type": "history/history_during_period", "start_time": iso(start),
                                   "end_time": iso(end), "entity_ids": [eid], "minimal_response": True,
                                   "no_attributes": True, "significant_changes_only": False})
    except (ConnectionError, asyncio.TimeoutError, OSError):
        return error(503, "unavailable")
    rows = res.get(eid) if isinstance(res, dict) else None
    st = (request.app["hub"].store.states.get(eid) or {}).get("a") or {}
    return ok({"id": eid, "hours": hours, "unit": st.get("unit_of_measurement"),
               "points": history_points(rows or [], start, end), "at": end})


# the Power widget's readings, the Power page's (hk_core.energy.power build): the whole house, the sun, the grid
ENERGY_READINGS = (("home", "Home"), ("solar", "Solar"), ("grid", "Grid"))


def energy_now(plan: dict, states: dict, may: set) -> list[dict]:
    """The Power widget's readings from the Energy feature's plan: [{key, name, entity, value, unit}], only those the
    plan names, the person may view and that read a number (a battery's charge in %)."""
    power = plan.get("power") if isinstance(plan.get("power"), dict) else {}
    named = [(k, n, power.get(k)) for k, n in ENERGY_READINGS]
    named.append(("battery", "Battery", (power.get("battery") or {}).get("level")))
    out, seen = [], set()
    for key, name, eid in named:
        if not isinstance(eid, str) or eid in seen or eid not in may:
            continue
        seen.add(eid)
        st = states.get(eid) or {}
        value = _number(st.get("s"))
        if value is None:
            continue
        out.append({"key": key, "name": name, "entity": eid, "value": value,
                    "unit": (st.get("a") or {}).get("unit_of_measurement")})
    return out


ENERGY_DEVICES_MAX = 30


def energy_devices(plan: dict, states: dict, may: set) -> list[dict]:
    """What each of the Energy feature's devices uses now, biggest first: [{key, name, entity, value, unit, parent}]
    from the plan's devices (each power sensor once), only those the person may view and that read a number above
    zero; at most ENERGY_DEVICES_MAX. ``parent``: the device it is part of (a circuit inside a panel), if any."""
    devices = plan.get("devices") if isinstance(plan.get("devices"), dict) else {}
    out, seen = [], set()
    for rec in devices.values():
        eid = rec.get("power") if isinstance(rec, dict) else None
        if not isinstance(eid, str) or eid in seen or eid not in may:
            continue
        seen.add(eid)
        st = states.get(eid) or {}
        value = _number(st.get("s"))
        if value is None or value <= 0:
            continue
        out.append({"key": rec.get("key"), "name": rec.get("name") or eid, "entity": eid, "value": value,
                    "unit": (st.get("a") or {}).get("unit_of_measurement"), "parent": rec.get("parent")})
    out.sort(key=lambda d: -_watts(d["value"], d["unit"]))
    return out[:ENERGY_DEVICES_MAX]


def _watts(value: float, unit: str | None) -> float:
    return value * 1000 if (unit or "").lower() == "kw" else value


def _start(row: dict) -> float | None:
    """A statistics row's start in epoch seconds (Home Assistant sends milliseconds, older ones an ISO time)."""
    v = row.get("start")
    if isinstance(v, (int, float)):
        return float(v) / 1000.0 if v > 1e11 else float(v)
    if isinstance(v, str):
        from datetime import datetime
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def hours_of(rows) -> list[list[float]]:
    """Today's hours for the Energy widget's bars: [[the hour's start, its energy]], in order."""
    out = [[t, round(float(r["change"]), 3)] for r in rows or [] if isinstance(r, dict)
           and isinstance(r.get("change"), (int, float)) and (t := _start(r)) is not None]
    return sorted(out)


def change_of(rows) -> float | None:
    """A statistic's change summed over its rows (recorder/statistics_during_period, types change); None: no rows."""
    vals = [r.get("change") for r in rows or [] if isinstance(r, dict) and isinstance(r.get("change"), (int, float))]
    return round(sum(vals), 3) if vals else None


@open_route("app_dpop", reads="feature:energy", why=WHY_APP)
@app_route
async def energy(request: web.Request) -> web.Response:
    authz, host = request.app.get("authz"), request.app.get("features")
    principal = _principal(request)
    if authz is None or "feature:energy" not in authz.may_read(principal, "view", ["feature:energy"]):
        return error(403, "forbidden")
    plan = host.energy_cache if host is not None and host.on("energy") else None
    if not isinstance(plan, dict):
        return error(409, "energy_off", message="The Energy feature is off on this Mantel.")
    hub = request.app["hub"]
    total = plan.get("total") if isinstance(plan.get("total"), dict) else {}
    power = plan.get("power") if isinstance(plan.get("power"), dict) else {}
    names = [x for x in (power.get("home"), power.get("solar"), power.get("grid"),
                         (power.get("battery") or {}).get("level")) if isinstance(x, str)]
    readings = energy_now(plan, hub.store.states, set(_visible(request, names)))
    # today so far: the whole home's meter and its cost, from local midnight (the house's time zone)
    today: dict | None = None
    stats = [x for x in (total.get("stat"), total.get("cost")) if isinstance(x, str) and x]
    proxy = getattr(hub, "readproxy", None)
    if stats and proxy is not None:
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo
        try:
            tz = ZoneInfo(getattr(authz, "tz", None) or "UTC")
        except (KeyError, ValueError):
            tz = timezone.utc
        now = datetime.fromtimestamp(float(request.app["clock"]()), tz)
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        try:
            res = await proxy.request({"type": "recorder/statistics_during_period",
                                       "start_time": midnight.astimezone(timezone.utc).isoformat(),
                                       "end_time": now.astimezone(timezone.utc).isoformat(),
                                       "statistic_ids": stats, "period": "hour", "types": ["change"],
                                       "units": {"energy": "kWh"}})
        except (ConnectionError, asyncio.TimeoutError, OSError):
            res = None
        if isinstance(res, dict):
            used = change_of(res.get(total.get("stat")))
            cost = change_of(res.get(total.get("cost"))) if total.get("cost") else None
            if used is not None:
                today = {"energy": used, "unit": "kWh", "cost": None if cost is None else round(cost, 2),
                         "hours": hours_of(res.get(total.get("stat")))}
    out = {"power": readings, "today": today, "at": float(request.app["clock"]())}
    if request.query.get("devices"):
        devs = plan.get("devices") if isinstance(plan.get("devices"), dict) else {}
        ids = sorted({r.get("power") for r in devs.values() if isinstance(r, dict) and isinstance(r.get("power"), str)})
        out["devices"] = energy_devices(plan, hub.store.states, set(_visible(request, ids)))
    if request.query.get("rings") and proxy is not None:
        out["rings"] = await energy_rings(request, plan, proxy)
    return ok(out)


async def energy_rings(request: web.Request, plan: dict, proxy) -> list[dict]:
    """The Energy Rings widget's rings (hk_core.energy.rings): today against a usual day, from the last days' hourly
    statistics -- one read of Home Assistant's Energy settings for the solar, water and gas sources, one of the statistics."""
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    from hk_core.energy import rings as RG
    try:
        prefs = await proxy.request({"type": "energy/get_prefs"})
    except (ConnectionError, asyncio.TimeoutError, OSError, RuntimeError):
        prefs = {}
    stats = RG.stats_of(plan, prefs if isinstance(prefs, dict) else {})
    ids = [sid for v in stats.values() for sid in v]
    if not ids:
        return []
    try:
        tz = ZoneInfo(getattr(request.app.get("authz"), "tz", None) or "UTC")
    except (KeyError, ValueError):
        tz = timezone.utc
    now = datetime.fromtimestamp(float(request.app["clock"]()), tz)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        res = await proxy.request({"type": "recorder/statistics_during_period",
                                   "start_time": datetime.fromtimestamp(midnight.timestamp() - RG.DAYS * 86400,
                                                                        timezone.utc).isoformat(),
                                   "end_time": now.astimezone(timezone.utc).isoformat(), "statistic_ids": ids,
                                   "period": "hour", "types": ["change"], "units": {"energy": "kWh"}})
    except (ConnectionError, asyncio.TimeoutError, OSError):
        return []
    if not isinstance(res, dict):
        return []
    states = request.app["hub"].store.states
    units = {k: ((states.get(v[0]) or {}).get("a") or {}).get("unit_of_measurement") for k, v in stats.items()}
    return RG.rings(stats, res, midnight.timestamp(), now.timestamp(), _start, units)


@open_route("app_dpop", reads="feature:live_tv", why=WHY_APP)
@app_route
async def tv(request: web.Request) -> web.Response:
    host = request.app.get("live_tv")
    if host is None:
        return ok({"configured": False, "channels": []})
    from ..connectors import Ctx

    async def _quiet(_msg: dict) -> None:
        return None
    try:
        got = await host.channel_list(Ctx(send=_quiet, identity=_principal(request)), {"type": "hk_tv/channels"})
    except (ConnectionError, asyncio.TimeoutError, OSError):
        return error(503, "unavailable")
    states = request.app["hub"].store.states
    out = []
    for c in (got or {}).get("channels") or []:
        now = states.get(c.get("now") or "") or {}
        a = now.get("a") or {}
        out.append({"number": c.get("number"), "name": c.get("name"), "logo": a.get("logo"),
                    "title": now.get("s") if c.get("now") else None, "subtitle": a.get("subtitle"),
                    "start": a.get("start"), "end": a.get("end"), "image": a.get("image")})
    sender = request.app.get("airplay_sender")          # phase 35: the screens Play On may send to (app_tv.py)
    return ok({"configured": bool((got or {}).get("configured")), "channels": out,
               "screens": sender.visible() if sender is not None else []})


@open_route("app_dpop", reads="view", why=WHY_APP)
@app_route
async def laundry(request: web.Request) -> web.Response:
    from hk_core import laundry as R
    host, states = request.app.get("laundry"), request.app["hub"].store.states
    now = float(request.app["clock"]())
    machines = list(getattr(host, "machines", None) or [])
    # a machine is the person's to see when they may view what says it runs (its status, else its running or power sensor)
    says = {m["id"]: next((m.get(r) for r in ("status", "running", "power") if m.get(r)), None) for m in machines}
    may = set(_visible(request, [e for e in says.values() if e]))
    latches = getattr(host, "latches", None) or {}
    out = []
    for m in machines:
        if says.get(m["id"]) not in may:
            continue
        state = R.state_of(m, states)
        held = latches.get(m["id"])
        if held and not R.runs(state) and state != "error":
            state = "wrinkle" if state == "wrinkle" else "done"
        running = R.runs(state) and state != "delayed"
        progress = _number((states.get(m.get("progress") or "") or {}).get("s")) if running else None
        out.append({"id": m["id"], "name": m.get("name") or m["id"], "kind": m.get("kind") or "washer", "state": state,
                    "ends": R.ends_at(m, states, now) if running else None,
                    "progress": None if progress is None else max(0.0, min(100.0, progress)),
                    "done_since": held.get("since") if held else None})
    return ok({"machines": out, "at": now})


@open_route("app_dpop", reads="self", why=WHY_APP)
@app_route
async def get_favorites(request: web.Request) -> web.Response:
    return ok({"favorites": request.app["user_data"].get(_subject(request), FAVORITES_KEY) or []})


@open_route("app_dpop", why=WHY_APP)
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


@open_route("app_dpop", reads="view", why=WHY_APP)
@app_route
async def entities(request: web.Request) -> web.Response:
    hub = request.app["hub"]
    q = (request.query.get("q") or "").strip().lower()[:64]
    asked = {d for d in (request.query.get("domains") or "").split(",") if d in FAVORITE_DOMAINS}
    kinds = asked or FAVORITE_DOMAINS
    entries = getattr(hub.registry, "entries", None) or {}

    def offered(eid: str) -> bool:
        if eid.split(".", 1)[0] not in kinds:
            return False
        reg = entries.get(eid) or {}
        return reg.get("entity_category") not in HIDDEN_CATEGORIES and not reg.get("hidden_by")
    ids = [e for e in hub.store.states if offered(e)]
    # the things one switches first, the readings after: a house's hundreds of sensors would fill the 500 otherwise
    ids.sort(key=lambda e: (e.split(".", 1)[0] in READINGS, e))
    cap = ENTITIES_KIND_MAX if asked else ENTITIES_MAX
    out = []
    for eid in _visible(request, ids):
        e = _entity_json(request.app, eid)
        if e is None or (q and q not in e["name"].lower() and q not in eid):
            continue
        out.append({k: e[k] for k in ("entity_id", "domain", "name", "area", "state", "glyph")})
        if len(out) >= cap:
            break
    return ok({"entities": out})


@open_route("app_dpop", why=WHY_APP)
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


@open_route("app_dpop", reads="view", why=WHY_APP)
@app_route
async def snapshot(request: web.Request) -> web.Response:
    """A notification's snapshot for the Notification Service Extension: notify_snaps.py's rule (a camera the
    person may see as a still, on this door), one answer for unknown, run out and refused."""
    from ..cameras import notify_snaps
    nothing = web.json_response({"error": "not_found"}, status=404, headers={"Cache-Control": "no-store"})
    store = getattr(request.app.get("features"), "snaps", None)
    sid = request.query.get("id")
    snap = store.meta(sid) if store is not None else None
    authz = request.app.get("authz")
    if snap is None or authz is None or not notify_snaps._may_still(request.app, authz.principal(request), snap.camera):
        return nothing
    body = store.read(sid)
    if body is None:
        return nothing
    return web.Response(body=body, content_type=snap.ctype, headers={"Cache-Control": "private, no-store",
                                                                      "X-Content-Type-Options": "nosniff"})


APNS_TOKEN = re.compile(r"^[0-9a-f]{64,200}$")
RELAY_HANDLE = re.compile(r"^[A-Za-z0-9_-]{43}$")


@open_route("app_dpop", why=WHY_APP)
@app_route
async def push_register(request: web.Request) -> web.Response:
    """The app's APNs device token and its notification key (x963, base64url): a push target bound to this app's
    credential (push.py; apns.py seals each notification to the key)."""
    try:
        body = await request.json()
    except ValueError:
        return error(400, "invalid_json")
    token, handle, key, env = body.get("token"), body.get("handle"), body.get("key"), body.get("env", "production")
    platform = body.get("platform", "ios")
    if platform not in ("ios", "mac"):
        return error(400, "invalid", message="platform: ios or mac")
    if isinstance(handle, str) and token is None:
        # through the push relay (apns.Relay): the handle the phone got from the relay for this house
        if not RELAY_HANDLE.match(handle):
            return error(400, "invalid")
        token, env = handle, "relay"
    elif not isinstance(token, str) or not APNS_TOKEN.match(token.lower()) or env not in ("sandbox", "production"):
        return error(400, "invalid")
    else:
        token = token.lower()
    try:
        app_crypto.public_from_raw(app_crypto.unb64u(key))
    except (TypeError, ValueError):
        return error(400, "invalid", message="the notification key is a P-256 public key (x963)")
    ident = request["app_identity"]
    st = request.app["app_auth"]
    if body.get("resume") is True:
        st.set_push_off(ident.session_id, False)
    elif st.push_off(ident.session_id):
        # stopped in Mantel Settings (push.delete_target): an app that registers on its own at start is refused, and
        # the handle it just got from the relay is forgotten there
        relay = request.app.get("push_relay")
        if env == "relay" and relay is not None:
            request.app["pusher"].spawn(relay.forget(token))
        return error(409, "push_off", message="Notifications to this app were stopped in Mantel Settings. "
                                              "Turn them on again in the app.")
    cred = st.credential(ident.session_id)
    tid = request.app["pusher"].targets.add(ident.user.id, "apns", token, key, None, name=cred["name"],
                                            app_id=ident.session_id, env=env, platform=platform)
    return ok({"id": tid}, status=201)


def register(app: web.Application, hub=None) -> None:
    pusher = app.get("pusher")
    if pusher is not None:
        sender = apns.Apns(app["cfg"].secrets_dir, lambda: app["clock"](),
                           secret=lambda: apns.collapse_secret(app["app_auth"].key()))
        relay = apns.Relay(app)            # the relay checks real time: never the app's (test) clock
        app["apns"] = sender
        app["push_relay"] = relay

        async def send_apns(row: dict, msg) -> str:
            return await (relay.send if row.get("env") == "relay" else sender.send)(row, msg)
        pusher.senders["apns"] = send_apns

        async def check(_app: web.Application) -> None:
            apns.check_direct(app)
        app.on_startup.append(check)
    app.router.add_post("/api/app/push/register", push_register)
    app.router.add_get("/api/app/push-relay", apns.api_get_relay)       # Mantel Settings (a session, not the app)
    app.router.add_put("/api/app/push-relay", apns.api_put_relay)
    app.router.add_get("/api/app/snap", snapshot)
    app.router.add_get("/api/app/art", art)      # ?id=: the auth middleware's open paths are exact
    app.router.add_get("/api/app/summary", summary)
    app.router.add_get("/api/app/favorites", get_favorites)
    app.router.add_put("/api/app/favorites", put_favorites)
    app.router.add_get("/api/app/entities", entities)
    app.router.add_get("/api/app/states", states)
    app.router.add_get("/api/app/history", history)
    app.router.add_get("/api/app/energy", energy)
    app.router.add_get("/api/app/laundry", laundry)
    app.router.add_get("/api/app/tv", tv)
    app.router.add_post("/api/app/command", command)
    app.setdefault("public_paths", set()).update({"/api/app/summary", "/api/app/favorites", "/api/app/entities",
                                                  "/api/app/states", "/api/app/history", "/api/app/energy", "/api/app/laundry", "/api/app/tv",
                                                  "/api/app/command", "/api/app/push/register", "/api/app/snap",
                                                  "/api/app/art"})
