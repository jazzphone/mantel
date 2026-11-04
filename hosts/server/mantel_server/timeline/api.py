"""The House Timeline's REST and live feed (docs/phase19/HOUSE-TIMELINE.md "Who sees what", "The API and live feed").

There is no role table of its own. A person (or a wall tablet) sees a row when the existing engine says so:

1. the page is the RBAC feature ``timeline`` (Owner, Admin, Adult by default; Child and Guest not; the Wall Tablet
   role ``view``s it for the limited view);
2. each row needs ``view`` of its entity (a lock, a door, the person of an arrival); a camera's row (a detection, a
   ring, motion) needs ``Authz.may_still`` of its camera, so the tunnel's camera switch applies;
3. who did it only for a signed-in Owner, Admin or Adult who may read the entity's ``history``; the audit id only
   for Owners and Admins; a wall tablet alone sees no names;
4. System and Refused rows are Owner and Admin only;
5. an arrival of a person Mantel doesn't know is Owner, Admin and Adult only;
6. a wall tablet with nobody signed in: the last WALL_HOURS of the families the Owner picked, no names, no search,
   no arrivals, pictures only on a tablet the Owner turned them on for.

Reading is not audited; every change is, before it applies (``audit.config``; 503 ``audit_unavailable`` changes
nothing).

  GET    /api/timeline                  ?family=&camera=&area=&entity=&q=&since=&until=&actor=&mine=&before=&limit=
  GET    /api/timeline/summary          ?window=overnight|today|24h
  GET    /api/timeline/pic/{id}
  GET    /api/timeline/settings         (managers) the settings and the "Not recorded" candidates
  PUT    /api/timeline/settings         (Owner, fresh away)
  PUT    /api/timeline/overrides        (Owner, fresh away)
  POST   /api/timeline/digest/test      (Owner, fresh away)
  DELETE /api/timeline                  ?confirm=clear&before=   (Owner, fresh always)
  GET    /api/timeline/me               a person's own switches
  PUT    /api/timeline/me               {private?, summary?}
  DELETE /api/timeline/mine/presence    a person clears their own arrivals
  read   timeline/subscribe             the live feed (the hub socket): rows as they are written, filtered per viewer
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from aiohttp import web

from hk_core.timeline import classify as C

from .. import audit
from ..accounts import read_json
from ..guards import guard
from ..guards import ident as guarded
from ..sessions import error, ok
from .store import BUDGETS_MB, FRAMES, RETENTIONS, WALL_HOURS

log = logging.getLogger("mantel.timeline")

PIC_PATH = "/api/timeline/pic/{pic_id}"
LIMIT = 50
LIMIT_MAX = 100
SCAN_MAX = 2000
CHUNK = 200
NAMES_ROLES = ("owner", "admin", "adult")
MANAGERS = ("owner", "admin")
# the page's filter chips -> families
GROUPS = {"doors": ("door", "window"), "locks": ("lock",), "garage": ("garage",), "alarm": ("alarm",),
          "people": ("arrival",), "doorbell": ("doorbell",), "cameras": ("detection", "motion"),
          "safety": ("safety",), "system": ("system", "refused")}
WINDOWS = ("overnight", "today", "24h")
NOT_FOUND = {"error": "not_found"}


def tl_of(app: Any):
    return app["timeline"]


def pic_url(pid: str) -> str:
    return PIC_PATH.replace("{pic_id}", pid)


class Viewer:
    """One reader's view of the rows (a request's principal, or a live subscription's)."""

    def __init__(self, app: Any, principal: Any) -> None:
        self.app = app
        self.principal = principal
        self.authz = app.get("authz")
        self.ctx = self.authz.context() if self.authz is not None else None
        ident = getattr(principal, "identity", None)
        self.user = getattr(ident, "user", None)
        self.device = getattr(ident, "device", None)
        self.role = getattr(self.user, "role", None)
        # a wall tablet alone, or a Wall Tablet ACCOUNT (an older stand-in, or a Home Assistant user given that
        # role): the limited view (Opus review 5)
        self.limited = (self.user is None and self.device is not None) or self.role == "wall_tablet"
        # System and Refused rows, and audit ids, are the managers' at their own screens only, as the alerts they
        # mirror are (never a tablet's session: Opus review 2)
        self.manager = self.role in MANAGERS and self.device is None
        # a screen preview an assistant opened, or an assistant itself: rows only, never a picture (decision 19)
        self.assistant = bool(getattr(ident, "read_only", False)) or str(getattr(ident, "via", "") or "").startswith("mcp")
        self._view: dict[str, bool] = {}
        self._still: dict[str, bool] = {}
        self._history: dict[str, bool] = {}
        settings = tl_of(app).settings
        wall = settings.get("wall") or {}
        fams = wall.get("families") if isinstance(wall, dict) else None
        self.wall_families = frozenset(f for f in (fams if isinstance(fams, list) else C.WALL_FAMILIES)
                                       if f in C.WALL_FAMILIES)
        pics_on = wall.get("pictures") if isinstance(wall, dict) else None
        # pictures: not to an assistant; at a wall tablet (alone, or someone signed in at it) only where the Owner
        # turned them on for that tablet (person ∩ tablet: the more private reading, Opus review 10)
        tablet_ok = self.device is not None and isinstance(pics_on, list) and self.device.id in pics_on
        self.pictures = not self.assistant and (tablet_ok if (self.device is not None or self.limited) else True)

    @property
    def valid(self) -> bool:
        return self.principal is not None and getattr(self.principal, "valid", True) is not False

    def feature(self) -> bool:
        if self.authz is None or not self.valid:
            return False
        try:
            return self.authz.decide(self.principal.subject, "view", None, feature="timeline",
                                     ctx=self.ctx).allowed is True
        except Exception:  # noqa: BLE001 -- a failing rule refuses
            log.exception("timeline: the feature check failed; refusing")
            return False

    def may_view(self, entity: str) -> bool:
        got = self._view.get(entity)
        if got is None:
            try:
                got = self.authz.decide(self.principal.subject, "view", entity, ctx=self.ctx).allowed is True
            except Exception:  # noqa: BLE001
                got = False
            self._view[entity] = got
        return got

    def may_still(self, camera: str) -> bool:
        got = self._still.get(camera)
        if got is None:
            try:
                got = self.authz.may_still(self.principal, camera) is True
            except Exception:  # noqa: BLE001
                got = False
            self._still[camera] = got
        return got

    def may_history(self, entity: str) -> bool:
        got = self._history.get(entity)
        if got is None:
            try:
                got = self.authz.decide(self.principal.subject, "history", entity, ctx=self.ctx).allowed is True
            except Exception:  # noqa: BLE001
                got = False
            self._history[entity] = got
        return got

    def names_for(self, entity: str | None) -> bool:
        if self.user is None or self.role not in NAMES_ROLES or self.limited:
            return False
        if entity is None:
            return self.manager
        return self.may_history(entity)

    @property
    def may_search(self) -> bool:
        return not self.limited

    @property
    def may_names(self) -> bool:
        return self.user is not None and self.role in NAMES_ROLES and not self.limited

    def families(self) -> tuple[str, ...]:
        """The families this viewer could see at all."""
        fams = [f for f in C.FAMILIES if f not in C.MANAGER_ONLY or self.manager]
        if self.limited:
            fams = [f for f in fams if f in self.wall_families]
        return tuple(fams)

    def visible(self, row: dict, now: float | None = None) -> bool:
        fam = row.get("family")
        if fam not in C.FAMILIES:
            return False
        if fam in C.MANAGER_ONLY:
            entity = row.get("entity")
            return self.manager and (not entity or self.may_view(entity))
        if self.limited:
            if fam not in self.wall_families:
                return False
            if now is not None and row.get("at", 0) < now - WALL_HOURS * 3600:
                return False
        entity = row.get("entity")
        if fam == "arrival":
            if row.get("person") is None and self.role not in NAMES_ROLES:
                return False
            # where someone was is location history: `history` of the person too, so the tunnel's locations switch
            # applies (Opus review 1)
            return bool(entity) and self.may_view(entity) and self.may_history(entity)
        if not entity:
            return False
        if fam in C.CAMERA_FAMILIES and entity.startswith("camera."):
            return self.may_still(entity)
        return self.may_view(entity)

    def shape(self, row: dict, pics: list[dict] | None = None) -> dict:
        d = row.get("detail") or {}
        out: dict[str, Any] = {"id": row["id"], "at": row["at"], "ended": row.get("ended"), "family": row["family"],
                               "kind": row["kind"], "level": row.get("level") or "info", "title": row["title"],
                               "entity": row.get("entity"), "area": row.get("area"),
                               "area_name": self._area_name(row.get("area")), "late": bool(d.get("late")),
                               "count": d.get("count") if isinstance(d.get("count"), int) else None,
                               "last": d.get("last"), "flapping": bool(d.get("flapping")), "pics": [],
                               "pic_missing": False}
        if row["family"] == "arrival" and d.get("zone"):
            out["zone"] = str(d["zone"])[:64]
        if row["family"] == "system":
            out["alert"] = d.get("alert")
        if self.names_for(row.get("entity")) and (row.get("actor") or row.get("device") or row.get("how")):
            out["who"] = {"name": row.get("actor_name"), "device": row.get("device_name"), "how": row.get("how"),
                          "mine": bool(self.user is not None and row.get("actor") == self.user.id)}
            if d.get("keypad"):
                out["who"]["keypad"] = d["keypad"]
        elif row.get("how") == "hand_or_automation" and self.names_for(row.get("entity")):
            out["who"] = {"name": None, "device": None, "how": "hand_or_automation", "mine": False}
        if self.manager and row.get("audit_id") is not None:
            out["audit_id"] = row["audit_id"]
        if self.pictures and pics is not None:
            out["pics"] = [{"id": p["id"], "at": p["at"], "url": pic_url(p["id"])} for p in pics]
            out["pic_missing"] = bool(d.get("pics_gone"))
        return out

    def _area_name(self, area: str | None) -> str | None:
        if not area:
            return None
        hub = self.app.get("hub")
        return getattr(getattr(hub, "registry", None), "areas", {}).get(area) if hub is not None else None


def pics_of(db, ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {}
    for i in range(0, len(ids), 400):
        part = ids[i:i + 400]
        for r in db.execute(f"SELECT id, event, at FROM timeline_pics WHERE event IN ({','.join('?' * len(part))}) "
                            "ORDER BY at, id", part):
            out.setdefault(int(r[1]), []).append({"id": r[0], "at": r[2]})
    return out


class BadQuery(Exception):
    def __init__(self, code: str, status: int = 400) -> None:
        super().__init__(code)
        self.code, self.status = code, status


def _num(v: Any, name: str) -> float | None:
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise BadQuery(f"bad_{name}") from None
    if f != f or f in (float("inf"), float("-inf")):
        raise BadQuery(f"bad_{name}")
    return f


def find(app: Any, viewer: Viewer, q: dict, now: float) -> dict:
    """The page's query (and the MCP's): rows newest first, filtered by the viewer, in chunks."""
    tl = tl_of(app)
    allowed = set(viewer.families())
    fam = q.get("family")
    if fam:
        want: set[str] = set()
        for part in str(fam).split(","):
            part = part.strip()
            if part in GROUPS:
                want |= set(GROUPS[part])
            elif part in C.FAMILIES:
                want.add(part)
            elif part:
                raise BadQuery("bad_family")
        allowed &= want
    actor = q.get("actor")
    if q.get("mine") in ("1", "true", True):
        if viewer.user is None:
            raise BadQuery("sign_in_first", 403)
        actor = viewer.user.id
    elif actor:
        if not viewer.may_names:
            raise BadQuery("forbidden", 403)
        actor = str(actor)[:64]
    by_actor = bool(actor) and q.get("mine") not in ("1", "true", True)
    words = q.get("q")
    if words and not viewer.may_search:
        raise BadQuery("search_unavailable", 403)
    since = _num(q.get("since"), "since")
    until = _num(q.get("until"), "until")
    if viewer.limited:
        since = max(since or 0.0, now - WALL_HOURS * 3600)
    before = q.get("before")
    try:
        before = int(before) if before not in (None, "") else None
    except (TypeError, ValueError):
        raise BadQuery("bad_before") from None
    try:
        limit = int(q.get("limit") or LIMIT)
    except (TypeError, ValueError):
        raise BadQuery("bad_limit") from None
    limit = max(1, min(LIMIT_MAX, limit))
    camera = q.get("camera")
    entity = q.get("entity")
    if camera:
        entity = str(camera)
    area = q.get("area")
    got: list[dict] = []
    scanned = 0
    cursor = before
    more = False
    while len(got) < limit and scanned < SCAN_MAX:
        chunk = tl.rows.chunk(before=cursor, since=since, until=until, families=sorted(allowed),
                              entity=str(entity)[:255] if entity else None, entities=None,
                              area=str(area)[:64] if area else None, q=str(words)[:200] if words else None,
                              actor=actor, size=CHUNK)
        if not chunk:
            more = False
            break
        for r in chunk:
            scanned += 1
            cursor = r["id"]
            # asking by who did it is seeing who did it: only rows whose names this viewer may see (2nd review 1)
            if viewer.visible(r, now) and (not by_actor or viewer.names_for(r.get("entity"))):
                got.append(r)
                if len(got) >= limit:
                    break
        more = len(chunk) == CHUNK or len(got) >= limit
        if len(chunk) < CHUNK and len(got) < limit:
            more = False
            break
    pics = pics_of(tl.db, [r["id"] for r in got]) if viewer.pictures else {}
    events = [viewer.shape(r, pics.get(r["id"], [])) for r in got]
    return {"events": events, "next_before": cursor if more and cursor is not None else None,
            "limited": viewer.limited, "names": viewer.may_names, "search": viewer.may_search,
            "families": list(viewer.families())}


def _viewer(request: web.Request) -> Viewer:
    authz = request.app.get("authz")
    principal = authz.principal(request) if authz is not None else None
    return Viewer(request.app, principal)


@guard("signed_in", device_ok=True, reads="view")   # the feature, then each row by its own rules (Viewer)
async def api_find(request: web.Request) -> web.Response:
    viewer = _viewer(request)
    if not viewer.feature():
        return error(403, "forbidden")
    q = dict(request.query)
    if set(q) - {"family", "camera", "area", "entity", "q", "since", "until", "actor", "mine", "before", "limit"}:
        return error(400, "bad_query")
    try:
        body = find(request.app, viewer, q, request.app["clock"]())
    except BadQuery as exc:
        return error(exc.status, exc.code)
    return web.json_response(body, headers={"Cache-Control": "no-store"})


def window_of(app: Any, window: str, now: float) -> tuple[float, float, str]:
    """[start, end) of a summary window, in the house's time: overnight is the digest's window (21:00 to the digest
    time), today since midnight, 24h the last day."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    tz = getattr(app.get("authz"), "tz", None) or "UTC"
    try:
        zone = ZoneInfo(tz)
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    local = datetime.fromtimestamp(now, zone)
    if window == "24h":
        return now - 86400.0, now, "Last 24 hours"
    if window == "today":
        start = local.replace(hour=0, minute=0, second=0, microsecond=0)
        return start.timestamp(), now, "Today"
    dg = tl_of(app).settings.get("digest") or {}
    frm = _hhmm(dg.get("from"), (21, 0))
    to = _hhmm(dg.get("at"), (7, 0))
    end = local.replace(hour=to[0], minute=to[1], second=0, microsecond=0)
    if end > local:
        end -= timedelta(days=1)
    start = end.replace(hour=frm[0], minute=frm[1])
    if start >= end:
        start -= timedelta(days=1)
    return start.timestamp(), end.timestamp(), "Overnight"


def _hhmm(v: Any, default: tuple[int, int]) -> tuple[int, int]:
    if isinstance(v, str) and len(v) == 5 and v[2] == ":" and v[:2].isdigit() and v[3:].isdigit():
        h, m = int(v[:2]), int(v[3:])
        if 0 <= h < 24 and 0 <= m < 60:
            return h, m
    return default


@guard("signed_in", device_ok=True, reads="view")
async def api_summary(request: web.Request) -> web.Response:
    viewer = _viewer(request)
    if not viewer.feature():
        return error(403, "forbidden")
    window = request.query.get("window") or "overnight"
    if window not in WINDOWS or set(request.query) - {"window"}:
        return error(400, "bad_query")
    from . import digest
    now = request.app["clock"]()
    return web.json_response(digest.summary(request.app, viewer, window, now), headers={"Cache-Control": "no-store"})


@guard("signed_in", device_ok=True, reads="view", sample="/api/timeline/pic/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")   # any session; the row's own rules decide (one 404 for everything)
async def api_pic(request: web.Request) -> web.Response:
    nothing = web.json_response(NOT_FOUND, status=404, headers={"Cache-Control": "no-store"})
    pid = request.match_info["pic_id"]
    pics = request.app.get("timeline_pictures")
    from .pictures import PIC_ID
    if pics is None or not PIC_ID.match(pid) or set(request.query) - {"v"}:
        return nothing
    tl = tl_of(request.app)
    r = tl.db.execute("SELECT p.camera, p.at AS pat, e.* FROM timeline_pics p JOIN timeline_events e "
                      "ON e.id = p.event WHERE p.id = ?", (pid,)).fetchone()
    if r is None:
        return nothing
    viewer = _viewer(request)
    row = dict(r)
    now = request.app["clock"]()
    if not viewer.feature() or not viewer.pictures or not viewer.visible(row, now) \
            or not viewer.may_still(row["camera"]):
        return nothing
    body = pics.read(pid)
    if body is None:
        return nothing
    # a shared screen keeps nothing in its browser's cache (a sign-out or a revoke must take it away: review 11)
    cache = "no-store" if viewer.device is not None else "private, max-age=3600"
    return web.Response(body=body, content_type="image/jpeg",
                        headers={"Cache-Control": cache, "X-Content-Type-Options": "nosniff"})


# -- settings ----------------------------------------------------------------------------------------------------------
def candidates(app: Any) -> list[dict]:
    """The "Not recorded" list: binary sensors with no class, which a person may add by hand (Settings → Timeline)."""
    tl = tl_of(app)
    hub = app["hub"]
    entries = getattr(hub.registry, "entries", {}) or {}
    out = []
    for eid, st in hub.store.states.items():
        if not eid.startswith("binary_sensor.") or eid in tl.members:
            continue
        e = entries.get(eid) or {}
        if e.get("entity_category") or e.get("hidden_by") or e.get("disabled_by"):
            continue
        dc = e.get("device_class") or e.get("original_device_class") or (st.get("a") or {}).get("device_class")
        if dc:
            continue
        out.append({"entity": eid, "name": (st.get("a") or {}).get("friendly_name") or eid,
                    "area": getattr(hub.registry, "entity_area", {}).get(eid)})
        if len(out) >= 300:
            break
    return sorted(out, key=lambda x: str(x["name"]).lower())


def settings_json(app: Any, request: web.Request | None = None) -> dict:
    tl = tl_of(app)
    s = tl.settings.all()
    s.pop("seen", None)
    fams = s.get("families") or {}
    members = [{"entity": eid, "family": m.family, "label": m.label, "area": m.area}
               for eid, m in sorted(tl.members.items(), key=lambda kv: (kv[1].family, kv[1].label.lower()))]
    pics = app.get("timeline_pictures")
    devices = [{"id": r[0], "name": r[1]} for r in app["store"].db.execute(
        "SELECT id, name FROM devices WHERE role = 'wall_tablet' AND revoked IS NULL ORDER BY name")]
    rule = "owner_only"
    if request is not None:
        from ..connections import edit_rule
        rule = edit_rule(request, guarded(request))
    return {"families": {f: (fams.get(f) if isinstance(fams.get(f), bool) else f in C.DEFAULT_ON)
                         for f in C.FAMILIES},
            "overrides": s.get("overrides") or {}, "retention_days": s.get("retention_days"),
            "retentions": list(RETENTIONS), "pictures": s.get("pictures"), "frames": list(FRAMES),
            "budgets_mb": list(BUDGETS_MB), "wall": s.get("wall"), "wall_families": list(C.WALL_FAMILIES),
            "digest": s.get("digest"), "backup_pictures": s.get("backup_pictures") is True, "members": members, "candidates": candidates(app),
            "usage": pics.status() if pics is not None else None, "rows": tl.rows.count(),
            "tablets": devices, "can_edit": rule != "owner_only", "needs_fresh": rule == "fresh"}


@guard("manager", reads="admin")
async def api_settings(request: web.Request) -> web.Response:
    return ok(settings_json(request.app, request))


def clean_settings(body: dict, cur: dict) -> dict:
    out: dict[str, Any] = {}
    if "families" in body:
        f = body["families"]
        if not isinstance(f, dict) or set(f) - set(C.FAMILIES) or not all(isinstance(v, bool) for v in f.values()):
            raise BadQuery("invalid_families")
        out["families"] = {**(cur.get("families") or {}), **f}
    if "retention_days" in body:
        if body["retention_days"] not in RETENTIONS or isinstance(body["retention_days"], bool):
            raise BadQuery("invalid_retention")
        out["retention_days"] = int(body["retention_days"])
    if "pictures" in body:
        p = body["pictures"]
        if not isinstance(p, dict) or set(p) - {"budget_mb", "frames"}:
            raise BadQuery("invalid_pictures")
        merged = {**(cur.get("pictures") or {}), **p}
        if merged.get("budget_mb") not in BUDGETS_MB or merged.get("frames") not in FRAMES \
                or isinstance(merged.get("frames"), bool) or isinstance(merged.get("budget_mb"), bool):
            raise BadQuery("invalid_pictures")
        out["pictures"] = {"budget_mb": int(merged["budget_mb"]), "frames": int(merged["frames"])}
    if "wall" in body:
        w = body["wall"]
        if not isinstance(w, dict) or set(w) - {"families", "pictures"}:
            raise BadQuery("invalid_wall")
        merged = {**(cur.get("wall") or {}), **w}
        fams, pics = merged.get("families"), merged.get("pictures")
        if not isinstance(fams, list) or any(f not in C.WALL_FAMILIES for f in fams) \
                or not isinstance(pics, list) or len(pics) > 100 \
                or not all(isinstance(x, str) and 0 < len(x) <= 64 for x in pics):
            raise BadQuery("invalid_wall")
        out["wall"] = {"families": list(dict.fromkeys(fams)), "pictures": list(dict.fromkeys(pics))}
    if "digest" in body:
        d = body["digest"]
        if not isinstance(d, dict) or set(d) - {"at", "from"}:
            raise BadQuery("invalid_digest")
        merged = {**(cur.get("digest") or {}), **d}
        for k in ("at", "from"):
            if _hhmm(merged.get(k), (-1, -1)) == (-1, -1):
                raise BadQuery("invalid_digest")
        out["digest"] = {"at": merged["at"], "from": merged["from"]}
    if "backup_pictures" in body:
        if not isinstance(body["backup_pictures"], bool):
            raise BadQuery("invalid_backup_pictures")
        out["backup_pictures"] = body["backup_pictures"]
    if not out or set(body) - {"families", "retention_days", "pictures", "wall", "digest", "backup_pictures"}:
        raise BadQuery("invalid")
    return out


@guard("owner", fresh="away", audit="timeline.settings.saved")
async def api_settings_put(request: web.Request) -> web.Response:
    body = await read_json(request)
    tl = tl_of(request.app)
    try:
        got = clean_settings(body, tl.settings.all())
    except BadQuery as exc:
        return error(exc.status, exc.code)
    audit.config(request, guarded(request), "timeline.settings.saved", {"changed": sorted(got)})
    for k, v in got.items():
        tl.settings.set(k, v)
    if "families" in got:
        tl.refresh()
    if "retention_days" in got:
        tl.prune()
    if "pictures" in got and request.app.get("timeline_pictures") is not None:
        request.app["timeline_pictures"].budget()
    return ok(settings_json(request.app, request))


PLAIN_FAMILIES = ("door", "window")        # what an Owner may file a plain sensor under by hand


def natural_family(app: Any, eid: str) -> tuple[str | None, str | None]:
    """The family an entity has by itself (its domain and class), before any override, and its device class."""
    hub = app["hub"]
    e = (getattr(hub.registry, "entries", {}) or {}).get(eid) or {}
    st = hub.store.states.get(eid) or {}
    dc = e.get("device_class") or e.get("original_device_class") or (st.get("a") or {}).get("device_class")
    domain, _, oid = eid.partition(".")
    got = C.family_of(domain, oid, dc, motion_only=True)
    return (got[0] if got else None), (str(dc) if dc else None)


def clean_overrides(body: Any, natural: Callable[[str], tuple[str | None, str | None]]) -> dict:
    """The Owner's overrides. Recording can be switched off for anything; ON only for an entity that has a family
    by itself, or a plain binary sensor (filed as a door or a window). A family can never be changed for an entity
    that has one: a camera's detection re-filed as a door would escape the camera rules, a tracker filed as an
    arrival would escape Keep My Arrivals Private (Opus review 7)."""
    if not isinstance(body, dict) or not isinstance(body.get("overrides"), dict):
        raise BadQuery("invalid_overrides")
    src = body["overrides"]
    if len(src) > 500:
        raise BadQuery("invalid_overrides")
    out: dict[str, dict] = {}
    from ..registry import Registry  # noqa: F401 -- (entity ids only)
    import re
    eid_re = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")
    for eid, v in src.items():
        if not isinstance(eid, str) or not eid_re.match(eid) or len(eid) > 255 or not isinstance(v, dict) \
                or set(v) - {"record", "family", "label"} or not isinstance(v.get("record"), bool):
            raise BadQuery("invalid_overrides")
        o: dict[str, Any] = {"record": v["record"]}
        fam = v.get("family")
        own, dc = natural(eid)
        # ON for an entity with no family of its own: only a binary sensor with NO class (what "Not Recorded" lists);
        # a presence or occupancy sensor filed as a door would get around the locations rule (2nd review 2)
        if v["record"] and own is None and (not eid.startswith("binary_sensor.") or dc):
            raise BadQuery("invalid_overrides")
        if fam is not None:
            if fam not in PLAIN_FAMILIES or not eid.startswith("binary_sensor.") or own not in (None, *PLAIN_FAMILIES) \
                    or (own is None and dc):
                raise BadQuery("invalid_overrides")
            o["family"] = fam
        label = v.get("label")
        if label is not None:
            if not isinstance(label, str) or len(label) > 64:
                raise BadQuery("invalid_overrides")
            if label.strip():
                o["label"] = label.strip()
        out[eid] = o
    return out


@guard("owner", fresh="away", audit="timeline.overrides.saved")
async def api_overrides_put(request: web.Request) -> web.Response:
    body = await read_json(request)
    tl = tl_of(request.app)
    try:
        got = clean_overrides(body, lambda e: natural_family(request.app, e))
    except BadQuery as exc:
        return error(exc.status, exc.code)
    audit.config(request, guarded(request), "timeline.overrides.saved", {"entities": len(got)})
    tl.settings.set("overrides", got)
    tl.refresh()
    return ok(settings_json(request.app, request))


@guard("owner", fresh="away", audit="timeline.digest.test")
async def api_digest_test(request: web.Request) -> web.Response:
    from . import digest
    audit.config(request, guarded(request), "timeline.digest.test", {})
    sent = await digest.send_test(request.app)
    return ok({"sent": sent})


@guard("owner", fresh="always", audit="timeline.cleared")
async def api_clear(request: web.Request) -> web.Response:
    if request.query.get("confirm") != "clear" or set(request.query) - {"confirm", "before"}:
        return error(400, "confirm_required")
    try:
        before = _num(request.query.get("before"), "before")
    except BadQuery as exc:
        return error(exc.status, exc.code)
    audit.config(request, guarded(request), "timeline.cleared", {"before": before})
    n = tl_of(request.app).clear(before)
    log.info("timeline: cleared (%d rows)", n)
    return ok({"deleted": n})


# -- a person's own ----------------------------------------------------------------------------------------------------
def _switch(db, user_id: str, key: str) -> bool:
    r = db.execute("SELECT value FROM user_data WHERE subject = ? AND key = ?", (f"u:{user_id}", key)).fetchone()
    return r is not None and r[0].strip() == "true"


def _matched(app: Any, user_id: str) -> bool:
    """Is one of Home Assistant's people this person (its user is linked to them)? Otherwise their arrivals can't be
    told apart (Me says so)."""
    tl = tl_of(app)
    try:
        people = tl._people({eid for eid, m in tl.members.items() if m.family == "arrival"})
    except Exception:  # noqa: BLE001
        return False
    return user_id in people.values()


def me_json(app: Any, user: Any) -> dict:
    from ..user_data import TIMELINE_PRIVATE, TIMELINE_SUMMARY
    db = app["store"].db
    authz = app.get("authz")
    return {"private": _switch(db, user.id, TIMELINE_PRIVATE), "summary": _switch(db, user.id, TIMELINE_SUMMARY),
            "may_private": user.role != "child", "matched": _matched(app, user.id), "arrivals": int(db.execute(
                "SELECT COUNT(*) FROM timeline_events WHERE family = 'arrival' AND person = ?", (user.id,)).fetchone()[0]),
            "tz": getattr(authz, "tz", None)}


@guard("person", reads="self")
async def api_me(request: web.Request) -> web.Response:
    return ok(me_json(request.app, guarded(request).user))


@guard("person", audit="timeline.me.saved")
async def api_me_put(request: web.Request) -> web.Response:
    from ..user_data import TIMELINE_PRIVATE, TIMELINE_SUMMARY
    body = await read_json(request)
    ident = guarded(request)
    user = ident.user
    if not body or set(body) - {"private", "summary"} or not all(isinstance(v, bool) for v in body.values()):
        return error(400, "invalid")
    if "private" in body and user.role == "child":
        return error(403, "owner_decides")
    audit.config(request, ident, "timeline.me.saved", dict(body))
    db = request.app["store"].db
    with db:
        for key, field in ((TIMELINE_PRIVATE, "private"), (TIMELINE_SUMMARY, "summary")):
            if field in body:
                db.execute("INSERT INTO user_data (subject, key, value, updated) VALUES (?,?,?,?) ON CONFLICT"
                           "(subject, key) DO UPDATE SET value = excluded.value, updated = excluded.updated",
                           (f"u:{user.id}", key, json.dumps(body[field]), request.app["clock"]()))
    if body.get("private") is True:
        tl = tl_of(request.app)
        tl.flush()                                              # an arrival still queued goes too (review 12)
        tl.rows.person_arrivals([user.id])                      # (the page asked first)
    return ok(me_json(request.app, user))


@guard("person", audit="timeline.presence.cleared")
async def api_clear_mine(request: web.Request) -> web.Response:
    ident = guarded(request)
    audit.config(request, ident, "timeline.presence.cleared", {})
    tl = tl_of(request.app)
    tl.flush()
    n = tl.rows.person_arrivals([ident.user.id])
    return ok({"deleted": n})


# -- the live feed -----------------------------------------------------------------------------------------------------
def register_live(app: Any) -> None:
    from ..connectors import Route, read_routes
    from ..readproxy import ReadBlocked

    async def subscribe(ctx: Any, msg: dict, on_event: Callable[[dict], None]):
        if set(msg) - {"type", "id", "family", "camera"}:
            raise ReadBlocked("timeline/subscribe carries family and camera only")
        principal = ctx.identity
        viewer = Viewer(app, principal)
        if not viewer.feature():
            raise ReadBlocked("not allowed: the Timeline")
        fam = msg.get("family")
        want: set[str] | None = None
        if fam:
            want = set()
            for part in str(fam).split(","):
                want |= set(GROUPS.get(part.strip(), (part.strip(),)))
        camera = msg.get("camera") if isinstance(msg.get("camera"), str) else None
        tl = tl_of(app)
        on_event({"ready": True})

        def heard(rows: list[dict]) -> None:
            v = Viewer(app, principal)              # the roles as they are now (a grant changed meanwhile)
            now = app["clock"]()
            out = []
            visible = [r for r in rows if (want is None or r.get("family") in want)
                       and (camera is None or r.get("entity") == camera) and v.visible(r, now)]
            if not visible:
                return
            pics = pics_of(tl.db, [r["id"] for r in visible]) if v.pictures else {}
            out = [v.shape(r, pics.get(r["id"], [])) for r in visible]
            on_event({"events": out})
        tl.listeners.append(heard)

        async def unsubscribe() -> None:
            try:
                tl.listeners.remove(heard)
            except ValueError:
                pass
        unsubscribe.recheck = lambda: Viewer(app, principal).feature()      # type: ignore[attr-defined]
        return unsubscribe

    read_routes(app)["timeline/subscribe"] = Route(subscribe=subscribe)


class QuietAccess(logging.Filter):
    """The web server's access log prints each request's URL. For the Timeline that would be a search word
    (``?q=emma``) or a picture's id, which no log line may carry ("Privacy in logs"): a timeline URL is logged without
    its query string and its picture id."""
    PIC = re.compile(r"(/api/timeline/pic/)[^\s\"?]+")
    QUERY = re.compile(r"(/api/timeline[^\s\"?]*)\?[^\s\"]*")

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            text = record.getMessage()
        except Exception:  # noqa: BLE001
            return True
        if "/api/timeline" in text:
            record.msg, record.args = self.QUERY.sub(r"\1?-", self.PIC.sub(r"\1-", text)), ()
        return True


def quiet_access_log() -> None:
    lg = logging.getLogger("aiohttp.access")
    if not any(isinstance(f, QuietAccess) for f in lg.filters):
        lg.addFilter(QuietAccess())


def register(app: web.Application, tl: Any) -> None:
    quiet_access_log()
    r = app.router
    r.add_get("/api/timeline", api_find)
    r.add_delete("/api/timeline", api_clear)
    r.add_get("/api/timeline/summary", api_summary)
    r.add_get(PIC_PATH, api_pic)
    r.add_get("/api/timeline/settings", api_settings)
    r.add_put("/api/timeline/settings", api_settings_put)
    r.add_put("/api/timeline/overrides", api_overrides_put)
    r.add_post("/api/timeline/digest/test", api_digest_test)
    r.add_get("/api/timeline/me", api_me)
    r.add_put("/api/timeline/me", api_me_put)
    r.add_delete("/api/timeline/mine/presence", api_clear_mine)
    register_live(app)
