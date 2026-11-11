"""Mantel Settings → Alerts' REST (docs/phase14/SYSTEM-ALERTS.md "The API, roles and audit").

An Owner or Admin reads; only the Owner changes a channel, as with Connections (from away from home, with a fresh
factor: ``step_up_required``); never from a wall tablet; CSRF as every ``/api/`` write. Every change is audited
before it applies (``alerts.channel.saved|deleted|tested``, ``alerts.settings.saved``) with the channel's type and
name, never its secret; when the audit can't be written nothing changes (audit.Unavailable, 503).

  GET    /api/alerts                        the page: channels, the catalog, what is up, the apps' recipients
  GET    /api/alerts/channels               the channels (no secrets: ``hint``, the last four characters)
  POST   /api/alerts/channels               {kind, name, enabled?, events?, min_level?, quiet?, config, secret}
  PUT    /api/alerts/channels/{id}          the same fields; a secret left out (or blank) is kept
  DELETE /api/alerts/channels/{id}
  POST   /api/alerts/channels/{id}/test     a real message now; the service's answer when it fails
  POST   /api/alerts/telegram/chats         {token} -> the chats the bot sees (Find My Chat); nothing saved
  GET    /api/alerts/log                    ?group=&limit=   the last 30 days, newest first
  PUT    /api/alerts/settings               {holds?, heartbeat?}   Advanced (the Owner)
  GET    /api/alerts/me                     {system_alerts, eligible}   the Me switch (an Owner or Admin)
  PUT    /api/alerts/me                     {system_alerts}
"""
from __future__ import annotations

import logging
from typing import Any

from aiohttp import web

from ..storage import audit
from ..identity.accounts import read_json
from ..identity.guards import guard
from ..identity.guards import ident as guarded
from ..identity.sessions import error, ok
from . import catalog
from .center import ChannelError, Message
from .channels import NAME_MAX, Invalid, senders, text

log = logging.getLogger("mantel.alerts")

CHANNELS_MAX = 20
HOLD_MAX = 3600


def alerts_of(request: web.Request):
    return request.app["alerts"]


def _rule(request: web.Request) -> str:
    from ..connections import edit_rule
    return edit_rule(request, guarded(request))


def clean_events(v: Any) -> list[str]:
    if not isinstance(v, list):
        return catalog.defaults()
    return [e for e in dict.fromkeys(v) if isinstance(e, str) and e in catalog.KINDS]


def clean_quiet(v: Any) -> dict:
    from hk_core.notifications.dnd import hhmm
    v = v if isinstance(v, dict) else {}
    return {"on": v.get("on") is True, "from": hhmm(v.get("from")) or "22:00", "to": hhmm(v.get("to")) or "07:00",
            "critical": v.get("critical") is not False}


def clean_level(v: Any) -> str:
    return v if v in catalog.LEVELS else "info"


def _fields(body: dict, current: dict | None) -> dict:
    """The plain fields of a save, each checked; one left out keeps the current value."""
    cur = current or {}
    name = text(body.get("name"), NAME_MAX) if "name" in body else cur.get("name", "")
    return {"name": name,
            "enabled": body["enabled"] is True if "enabled" in body else cur.get("enabled", True),
            "events": clean_events(body["events"]) if "events" in body else cur.get("events", catalog.defaults()),
            "min_level": clean_level(body["min_level"]) if "min_level" in body else cur.get("min_level", "info"),
            "quiet": clean_quiet(body["quiet"]) if "quiet" in body else cur.get("quiet", clean_quiet({}))}


def _detail(kind: str, name: str, **more: Any) -> dict:
    return {"type": kind, "name": name, **more}


def page_json(request: web.Request) -> dict:
    a = alerts_of(request)
    rule = _rule(request)
    mods = senders()
    return {"channels": [a.channels.public(c) for c in a.channels.all()],
            "catalog": catalog.as_json(), "groups": [{"id": g, "name": catalog.GROUP_NAMES[g]} for g in catalog.GROUPS],
            "levels": list(catalog.LEVELS),
            "senders": [{"kind": m.KIND, "name": m.NAME, "advanced": bool(getattr(m, "OWNER_ADVANCED", False)),
                         "available": bool(getattr(m, "available", lambda: True)())} for m in mods.values()],
            "active": a.center.active(),
            "holds": {g: a.settings.get("holds", {}).get(g) for g in catalog.GROUPS}
            if isinstance(a.settings.get("holds", {}), dict) else {},
            "default_holds": {g: max((k.hold for k in catalog.KINDS.values() if k.group == g), default=0)
                              for g in catalog.GROUPS},
            "heartbeat": a.heartbeat_public() if hasattr(a, "heartbeat_public") else None,
            "app": a.app_recipients_public(),
            "can_edit": rule != "owner_only", "needs_fresh": rule == "fresh"}


@guard("manager", reads="admin")
async def api_page(request: web.Request) -> web.Response:
    return ok(page_json(request))


@guard("manager", reads="admin")
async def api_channels(request: web.Request) -> web.Response:
    a = alerts_of(request)
    return ok({"channels": [a.channels.public(c) for c in a.channels.all()]})


def _clean_channel(kind: str, body: dict, old_secret: dict | None, old_config: dict | None) -> tuple[dict, dict]:
    mod = senders().get(kind)
    if mod is None:
        raise Invalid("invalid_kind", "That isn't a kind of channel Mantel sends to.")
    if not getattr(mod, "available", lambda: True)():
        raise Invalid("not_installed", f"{mod.NAME} isn't installed in this Mantel.")
    config = body.get("config") if isinstance(body.get("config"), dict) else (old_config or {})
    secret = body.get("secret") if isinstance(body.get("secret"), dict) else {}
    return mod.clean(config, secret, old_secret)


@guard("owner", fresh="away", audit="alerts.channel.saved")
async def api_add(request: web.Request) -> web.Response:
    ident = guarded(request)
    a = alerts_of(request)
    body = await read_json(request)
    kind = body.get("kind")
    if len(a.channels.all()) >= CHANNELS_MAX:
        return error(409, "too_many", message=f"Mantel keeps at most {CHANNELS_MAX} alert channels.")
    fields = _fields(body, None)
    try:
        config, secret = _clean_channel(kind if isinstance(kind, str) else "", body, None, None)
    except Invalid as exc:
        return error(400, exc.code, message=exc.message)
    if not fields["name"]:
        fields["name"] = senders()[kind].NAME
    audit.config(request, ident, "alerts.channel.saved", _detail(kind, fields["name"], new=True))
    cid = a.channels.add(kind, fields["name"], events=fields["events"], min_level=fields["min_level"],
                         quiet=fields["quiet"], config=config, secret=secret, enabled=fields["enabled"])
    return ok({"channel": a.channels.public(a.channels.get(cid))}, status=201)


@guard("owner", fresh="away", audit="alerts.channel.saved")
async def api_update(request: web.Request) -> web.Response:
    ident = guarded(request)
    a = alerts_of(request)
    ch = a.channels.get(request.match_info["id"])
    if ch is None:
        return error(404, "not_found")
    body = await read_json(request)
    fields = _fields(body, ch)
    if not fields["name"]:
        return error(400, "invalid_name", message="Give the channel a name.")
    secret = config = None
    if "config" in body or "secret" in body:
        try:
            config, secret = _clean_channel(ch["kind"], body, a.channels.secret(ch["id"]), ch["config"])
        except Invalid as exc:
            return error(400, exc.code, message=exc.message)
    audit.config(request, ident, "alerts.channel.saved",
                 _detail(ch["kind"], fields["name"], channel=ch["id"], secret_changed=bool(
                     isinstance(body.get("secret"), dict) and any(v for v in body["secret"].values()))))
    if config is not None:
        fields["config"] = config
    a.channels.update(ch["id"], secret=secret, **fields)
    return ok({"channel": a.channels.public(a.channels.get(ch["id"]))})


@guard("owner", fresh="away", audit="alerts.channel.deleted")
async def api_delete(request: web.Request) -> web.Response:
    ident = guarded(request)
    a = alerts_of(request)
    ch = a.channels.get(request.match_info["id"])
    if ch is None:
        return error(404, "not_found")
    audit.config(request, ident, "alerts.channel.deleted", _detail(ch["kind"], ch["name"], channel=ch["id"]))
    a.channels.delete(ch["id"])
    a.center.clear("channel.failing", ch["id"])
    return ok()


@guard("owner", fresh="away", audit="alerts.channel.tested")
async def api_test(request: web.Request) -> web.Response:
    ident = guarded(request)
    a = alerts_of(request)
    ch = a.channels.get(request.match_info["id"])
    if ch is None:
        return error(404, "not_found")
    audit.config(request, ident, "alerts.channel.tested", _detail(ch["kind"], ch["name"], channel=ch["id"]))
    result = await a.test(ch)
    if result is not None:
        return error(502, "send_failed", message=result)
    return ok({"sent": True})


@guard("owner", fresh="away", no_audit="asks Telegram which chats a bot sees; saves nothing")
async def api_telegram_chats(request: web.Request) -> web.Response:
    from .channels import telegram
    body = await read_json(request)
    token = body.get("token")
    cid = body.get("channel")
    a = alerts_of(request)
    if (not isinstance(token, str) or not token.strip()) and isinstance(cid, str):
        ch = a.channels.get(cid)                     # an existing channel's saved token: Find My Chat again
        token = (a.channels.secret(cid) or {}).get("token") if ch is not None and ch["kind"] == "telegram" else None
    try:
        chats = await telegram.find_chats(a.transport, token)
    except Invalid as exc:
        return error(400, exc.code, message=exc.message)
    except ChannelError as exc:
        return error(502, "telegram_failed", message=exc.message)
    return ok({"chats": chats})


@guard("manager", reads="admin")
async def api_log(request: web.Request) -> web.Response:
    a = alerts_of(request)
    group = request.query.get("group")
    try:
        limit = int(request.query.get("limit", "200"))
    except ValueError:
        limit = 200
    return ok({"log": a.log.recent(limit, group if group in catalog.GROUPS else None)})


@guard("owner", fresh="away", audit="alerts.settings.saved")
async def api_settings(request: web.Request) -> web.Response:
    ident = guarded(request)
    a = alerts_of(request)
    body = await read_json(request)
    changes: dict[str, Any] = {}
    if "holds" in body:
        holds = body["holds"] if isinstance(body["holds"], dict) else {}
        clean = {}
        for g, v in holds.items():
            if g in catalog.GROUPS and isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= HOLD_MAX:
                clean[g] = int(v)
        changes["holds"] = clean
    if "heartbeat" in body:
        try:
            changes["heartbeat"] = a.clean_heartbeat(body["heartbeat"])
        except Invalid as exc:
            return error(400, exc.code, message=exc.message)
    if not changes:
        return error(400, "nothing_to_change")
    audit.config(request, ident, "alerts.settings.saved",
                 {"holds": changes.get("holds"), "heartbeat": "set" if (changes.get("heartbeat") or {}).get("url")
                  else ("off" if "heartbeat" in changes else None)})
    for k, v in changes.items():
        if k == "heartbeat":
            a.save_heartbeat(v)
        else:
            a.settings.set(k, v)
    return ok(page_json(request))


@guard("manager", reads="admin")
async def api_me(request: web.Request) -> web.Response:
    ident = guarded(request)
    a = alerts_of(request)
    return ok({"system_alerts": a.wants_system(ident.user), "eligible": True})


@guard("manager", audit="alerts.me.saved")
async def api_me_put(request: web.Request) -> web.Response:
    ident = guarded(request)
    a = alerts_of(request)
    body = await read_json(request)
    on = body.get("system_alerts")
    if not isinstance(on, bool):
        return error(400, "invalid")
    audit.config(request, ident, "alerts.me.saved", {"system_alerts": on})
    a.set_wants_system(ident.user, on)
    return ok({"system_alerts": on})


def add_routes(app: web.Application) -> None:
    r = app.router
    r.add_get("/api/alerts", api_page)
    r.add_get("/api/alerts/channels", api_channels)
    r.add_post("/api/alerts/channels", api_add)
    r.add_put("/api/alerts/channels/{id}", api_update)
    r.add_delete("/api/alerts/channels/{id}", api_delete)
    r.add_post("/api/alerts/channels/{id}/test", api_test)
    r.add_post("/api/alerts/telegram/chats", api_telegram_chats)
    r.add_get("/api/alerts/log", api_log)
    r.add_put("/api/alerts/settings", api_settings)
    r.add_get("/api/alerts/me", api_me)
    r.add_put("/api/alerts/me", api_me_put)


def test_message(house: str, link: str | None) -> Message:
    k = catalog.TEST
    return Message(f"Mantel · {k.title}", "\n".join(x for x in (k.body, house) if x), "info", link, "system:test")
