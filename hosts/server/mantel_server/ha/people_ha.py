"""Home Assistant's users, each in one place (decision 29, docs/phase9/TWO-PRODUCTS.md "people in one list").

An HA user is a person (linked to an EXISTING Mantel person: ``ha_links``), a wall tablet (linked to an enrolled
device: ``ha_tablet_links``), or neither. People shows the first; each wall tablet's own page the second; the rest are "Other Home
Assistant users". Linking an HA user with only a role (the Ingress People page, ``store.link``) makes a separate
``ha_linked`` account; such an account can be merged into an existing person here.

REST (Mantel Settings; Owner and Admin read; changing an Owner's link, a merge and a tablet link are Owner's; each
audited first):

* ``GET /api/people/ha``: ``{users: [{id, name, admin, person, tablet}], people, devices, error}``. Home Assistant's
  users are read by Mantel's own connection (``ingress.HaDirectory``, under the App or Mantel Connect).
* ``PUT /api/people/ha`` ``{ha_user, user_id | null}``: link an HA user to a person, or unlink it. An HA user linked
  to an ``ha_linked`` account and given a person is merged into that person (below).
* ``POST /api/users/{id}/merge`` ``{into}``: an ``ha_linked`` account into a person: its Home Assistant link, Default
  Screen, own settings, saved data, phones and room scopes go to the person (unless the person has their own), its
  grants name the person, and the account is removed (its sessions end).
* ``PUT /api/devices/{id}/ha-user`` ``{ha_user | null}``: the HA user a wall tablet is (ingress.link_tablet). An HA
  user linked to a Wall Tablet *account* (a stand-in from before tablets were devices) moves to the tablet, and the
  account is removed (``remove_stand_in``); one linked to any other person is refused: unlink them on People first.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from aiohttp import web

from .. import audit, live
from ..identity.accounts import read_json, require_fresh_to_grant
from ..identity.guards import guard
from ..identity.guards import ident as guarded
from ..identity.sessions import error, ok

log = logging.getLogger("mantel.people_ha")

_HA_USER = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def _directory(app: web.Application) -> Any:
    """Home Assistant's users (ingress.HaDirectory, made under the App or Mantel Connect)."""
    got = app.get("ha_directory")
    if got is None and app.get("linked_settings") is not None:
        got = app["linked_settings"]._directory()
    return got


def _owners_left(db, without: str) -> int:
    return db.execute("SELECT COUNT(*) FROM users WHERE role = 'owner' AND disabled = 0 AND id != ?",
                      (without,)).fetchone()[0]


def merge(app: web.Application, src: str, into: str) -> dict:
    """``src`` (an ha_linked account) into ``into`` (a person). Raises ValueError with words to refuse."""
    db = app["store"].db
    a = db.execute("SELECT id, kind, role, name FROM users WHERE id = ?", (src,)).fetchone()
    b = db.execute("SELECT id, kind, role, name FROM users WHERE id = ?", (into,)).fetchone()
    if a is None or b is None or src == into:
        raise ValueError("Choose two different people.")
    if a["kind"] != "ha_linked":
        raise ValueError("Only an account made for a Home Assistant user is merged into a person.")
    if a["role"] == "owner" and b["role"] != "owner" and not _owners_left(db, src):
        raise ValueError("Mantel always keeps at least one Owner.")
    if db.execute("SELECT 1 FROM ha_links WHERE user_id = ?", (into,)).fetchone():
        raise ValueError(f"{b['name'] or 'That person'} is already linked to a Home Assistant user.")
    moved: list[str] = []
    svc = app.get("settings")
    with db:
        if db.execute("UPDATE ha_links SET user_id = ? WHERE user_id = ?", (into, src)).rowcount:
            moved.append("home_assistant")
        for table, col in (("default_screens", "subject"), ("user_data", "subject")):
            have = {r[0] for r in db.execute(f"SELECT {'screen' if table == 'default_screens' else 'key'} FROM {table} "
                                             f"WHERE {col} = ?", (f"u:{into}",))}
            if table == "default_screens":
                if not have and db.execute("UPDATE default_screens SET subject = ? WHERE subject = ?",
                                           (f"u:{into}", f"u:{src}")).rowcount:
                    moved.append("default_screen")
                db.execute("DELETE FROM default_screens WHERE subject = ?", (f"u:{src}",))
            else:
                # Keep My Arrivals Private stays on when either of the two had it on (the House Timeline)
                db.execute("UPDATE user_data SET value = 'true' WHERE subject = ? AND key = 'timeline_private' AND "
                           "EXISTS (SELECT 1 FROM user_data WHERE subject = ? AND key = 'timeline_private' AND "
                           "value = 'true')", (f"u:{into}", f"u:{src}"))
                n = db.execute("UPDATE OR IGNORE user_data SET subject = ? WHERE subject = ?",
                               (f"u:{into}", f"u:{src}")).rowcount
                db.execute("DELETE FROM user_data WHERE subject = ?", (f"u:{src}",))
                if n:
                    moved.append("saved_data")
        if not db.execute("SELECT 1 FROM person_phones WHERE user_id = ?", (into,)).fetchone():
            if db.execute("UPDATE person_phones SET user_id = ? WHERE user_id = ?", (into, src)).rowcount:
                moved.append("phones")
        db.execute("DELETE FROM person_phones WHERE user_id = ?", (src,))
        if not db.execute("SELECT 1 FROM rbac_scopes WHERE subject_kind = 'user' AND subject_id = ?", (into,)).fetchone():
            if db.execute("UPDATE rbac_scopes SET subject_id = ? WHERE subject_kind = 'user' AND subject_id = ?",
                          (into, src)).rowcount:
                moved.append("rooms")
        db.execute("DELETE FROM rbac_scopes WHERE subject_kind = 'user' AND subject_id = ?", (src,))
        for gid, users in db.execute("SELECT id, users FROM rbac_grants").fetchall():
            try:
                ids = json.loads(users or "[]")
            except ValueError:
                continue
            if src in ids:
                ids = list(dict.fromkeys(into if u == src else u for u in ids))
                db.execute("UPDATE rbac_grants SET users = ? WHERE id = ?", (json.dumps(ids), gid))
                moved.append("grants")
        db.execute("DELETE FROM users WHERE id = ?", (src,))     # sessions, PINs and the rest go with it
    if svc is not None and svc.store.get("user", src) is not None:
        from ..settings_store import Actor
        if svc.store.get("user", into) is None:
            svc.store.write([("user", into, svc.store.body("user", src))], actor=Actor(label="merge"))
            moved.append("settings")
        svc.store.remove("user", src, actor=Actor(label="merge"))
    rb = app.get("rbac")
    if rb is not None and hasattr(rb, "invalidate"):
        rb.invalidate()
    return {"into": into, "moved": sorted(set(moved))}


@guard("manager", reads="admin")
async def api_get(request: web.Request) -> web.Response:
    app = request.app
    from ..network.ingress import household, is_ha_admin, linked_user, tablet_link
    db = app["store"].db
    directory = _directory(app)
    users, err = [], None
    if directory is None:
        err = "Home Assistant’s users are read inside Home Assistant (the Mantel App, or Mantel Connect)."
    else:
        try:
            for u in household(await directory.users()):
                row, tab = linked_user(db, u["id"]), tablet_link(db, u["id"])
                users.append({"id": u["id"], "name": u.get("name") or u.get("username") or "?", "admin": is_ha_admin(u),
                              "person": None if row is None else {"id": row["id"], "name": row["name"], "role": row["role"],
                                                                  "kind": row["kind"], "disabled": bool(row["disabled"])},
                              "tablet": None if tab is None else {"device_id": tab["id"], "name": tab["name"]}})
        except Exception as exc:  # noqa: BLE001 -- the page says so
            err = f"Home Assistant’s users could not be read ({type(exc).__name__})."
    people = [{"id": r["id"], "name": r["name"] or r["username"], "role": r["role"], "kind": r["kind"]}
              for r in db.execute("SELECT id, name, username, role, kind FROM users WHERE disabled = 0 ORDER BY name")]
    devices = [{"id": r["id"], "name": r["name"]} for r in db.execute(
        "SELECT id, name FROM devices WHERE revoked IS NULL AND role = 'wall_tablet' ORDER BY name")]
    users.sort(key=lambda u: (u["person"] is None and u["tablet"] is None, not u["admin"], str(u["name"]).lower()))
    return ok({"users": users, "people": people, "devices": devices, "error": err})


@guard("manager", audit="people.ha_user")       # (a link, not an unlink, also needs a fresh factor: below)
async def api_put(request: web.Request) -> web.Response:
    ident = guarded(request)
    app = request.app
    db, store = app["store"].db, app["store"]
    body = await read_json(request)
    target, uid = body.get("ha_user"), body.get("user_id")
    if set(body) != {"ha_user", "user_id"} or not isinstance(target, str) or not _HA_USER.match(target) or (
            uid is not None and not isinstance(uid, str)):
        return error(400, "invalid", message="{ha_user, user_id: a person or null}")
    from ..network.ingress import linked_user, tablet_link
    if tablet_link(db, target) is not None:
        return error(409, "tablet", message="That Home Assistant user is a wall tablet: change it on its "
                                                       "tablet's page (All Screens, Wall Tablets).")
    cur = linked_user(db, target)
    person = db.execute("SELECT id, role, kind, name FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
    if uid and person is None:
        return error(404, "not_found")
    if uid is not None:
        # a link is a new way to sign in as the person ("Sign in with Home Assistant", HA's sidebar), so it asks
        # what adding a passkey or an authenticator asks: a fresh sign-in, unless HA's own sidebar vouches
        require_fresh_to_grant(request, ident, person["role"], new_way_in=True)
    if ident.user.role != "owner" and "owner" in ((cur["role"] if cur else None), (person["role"] if person else None)):
        return error(403, "owner_only", message="Only an Owner links or unlinks an Owner.")
    if cur is not None and cur["role"] == "owner" and (uid is None or person["role"] != "owner") and not _owners_left(db, cur["id"]):
        return error(409, "last_owner", message="Mantel always keeps at least one Owner.")
    audit.config(request, ident, "people.ha_user", {"ha_user_id": target, "user_id": uid})
    if cur is not None and uid is not None and cur["id"] == uid:
        return ok({"changed": False})
    if cur is not None and uid is not None and cur["kind"] == "ha_linked":
        try:
            got = merge(app, cur["id"], uid)            # the account made for this HA user becomes the person
        except ValueError as exc:
            return error(409, "refused", message=str(exc))
        live.notify(app, f"ha:{target}", f"user:{cur['id']}")
        return ok({"changed": True, "merged": got})
    if uid is not None and db.execute("SELECT 1 FROM ha_links WHERE user_id = ?", (uid,)).fetchone():
        return error(409, "already_linked", message=f"{person['name'] or 'That person'} is already linked to "
                                                    "another Home Assistant user. Unlink that one first.")
    if cur is not None:
        if cur["kind"] == "ha_linked" and uid is None:
            store.unlink(target)                        # its own account goes too (as the Ingress page does)
        else:
            with db:
                db.execute("DELETE FROM ha_links WHERE ha_user_id = ?", (target,))
                db.execute("DELETE FROM sessions WHERE user_id = ? AND method = 'ingress'", (cur["id"],))
            mgr = app.get("sessions")
            if mgr is not None:     # and what "Sign in with Home Assistant" made through the link (with its children)
                for r in db.execute("SELECT id FROM sessions WHERE user_id = ? AND method = 'ha' AND revoked IS NULL",
                                    (cur["id"],)).fetchall():
                    mgr.revoke(r["id"], "ha_unlinked")
    if uid is not None:
        store.link_user(target, uid)
    # live.py: what is open as that HA user (its sidebar, its dashboards' relayed reads) is checked now
    live.notify(app, f"ha:{target}", *([f"user:{cur['id']}"] if cur is not None else []))
    ls = app.get("linked_settings")
    if ls is not None:
        await ls.resend()
    return ok({"changed": True})


# the Home Assistant link moves to `into`: what api_put's link asks
@guard("owner", fresh="add_factor", audit="people.merge")
async def api_merge(request: web.Request) -> web.Response:
    ident = guarded(request)
    src = request.match_info["id"]
    body = await read_json(request)
    into = body.get("into")
    if set(body) != {"into"} or not isinstance(into, str):
        return error(400, "invalid", message="{into: a person}")
    audit.config(request, ident, "people.merge", {"user_id": src, "into": into})
    try:
        got = merge(request.app, src, into)
    except ValueError as exc:
        return error(409, "refused", message=str(exc))
    log.info("people: %s merged %s into %s", ident.user.name or ident.user.id, src, into)
    return ok(got)


# an Owner, on the home network (or a home-rules sidebar) only, as every other way of making an HA user a tablet:
# that user then has the home door's tablet rules
@guard("owner", door="home", audit=("ingress.link_tablet", "ingress.unlink_tablet", "people.remove_tablet_account"))
async def api_device_ha_user(request: web.Request) -> web.Response:
    ident = guarded(request)
    app, dev = request.app, request.match_info["id"]
    body = await read_json(request)
    target = body.get("ha_user")
    if set(body) != {"ha_user"} or (target is not None and (not isinstance(target, str) or not _HA_USER.match(target))):
        return error(400, "invalid", message="{ha_user: an HA user id or null}")
    from ..network.ingress import TabletLinkError, link_tablet, linked_user, unlink_tablet
    db = app["store"].db
    now = db.execute("SELECT ha_user_id FROM ha_tablet_links WHERE device_id = ?", (dev,)).fetchone()
    stand_in = linked_user(db, target) if target is not None else None
    if stand_in is not None and stand_in["role"] != "wall_tablet":
        return error(409, "person", message=f"That Home Assistant user is {stand_in['name'] or 'a person'}: "
                                            "unlink them on People first.")
    if now is not None and target is None:
        unlink_tablet(app, now[0], ident.user, request=request, ident=ident)
    removed = None
    if target is not None and (now is None or now[0] != target):
        name = None
        directory = _directory(app)
        if directory is not None:
            try:
                name = ((await directory.user(target)) or {}).get("name")
            except Exception:  # noqa: BLE001 -- the name is a convenience
                pass
        try:
            # moved from another HA user in one step: unlinking that one first revoked a device made for it
            link_tablet(app, target, ident.user, device_id=dev, ha_name=name,
                        moving_from=now[0] if now is not None else None, request=request, ident=ident)
        except TabletLinkError as exc:
            return error(exc.status, exc.code, message=exc.message)
        if stand_in is not None and stand_in["kind"] != "ha_linked":
            removed = remove_stand_in(app, stand_in["id"], ident.user)
    return ok({"device_id": dev, "ha_user": target, "removed_account": removed})


def remove_stand_in(app: web.Application, uid: str, actor) -> str | None:
    """A Wall Tablet ACCOUNT a Home Assistant user was linked to as a person, from before tablets were enrolled as
    devices: once that HA user is its tablet's (``api_device_ha_user``) the account stands in for nothing, so it
    goes, with what was its alone. Only a wall_tablet account no Home Assistant user is linked to any more; a device
    it enrolled keeps its own credential (``enrolled_by`` is cleared). Audited. Returns its name, or None if kept."""
    db = app["store"].db
    row = db.execute("SELECT id, name, username, role FROM users WHERE id = ?", (uid,)).fetchone()
    if row is None or row["role"] != "wall_tablet":
        return None
    if db.execute("SELECT 1 FROM ha_links WHERE user_id = ?", (uid,)).fetchone():
        return None
    name = row["name"] or row["username"] or uid
    audit.config(None, actor, "people.remove_tablet_account", {"user_id": uid, "name": name}, app=app)
    with db:
        db.execute("DELETE FROM default_screens WHERE subject = ?", (f"u:{uid}",))
        db.execute("DELETE FROM user_data WHERE subject = ?", (f"u:{uid}",))
        db.execute("DELETE FROM person_phones WHERE user_id = ?", (uid,))
        db.execute("DELETE FROM rbac_scopes WHERE subject_kind = 'user' AND subject_id = ?", (uid,))
        db.execute("DELETE FROM users WHERE id = ?", (uid,))     # sessions, PINs and the rest go with it
    svc = app.get("settings")
    if svc is not None and svc.store.get("user", uid) is not None:
        from ..settings_store import Actor
        svc.store.remove("user", uid, actor=Actor(label="tablet account"))
    rb = app.get("rbac")
    if rb is not None and hasattr(rb, "invalidate"):
        rb.invalidate()
    log.info("people: removed the Wall Tablet account %s (%s); its Home Assistant user is its tablet's now", name, uid)
    return name


def register(app: web.Application) -> None:
    app.router.add_get("/api/people/ha", api_get)
    app.router.add_put("/api/people/ha", api_put)
    app.router.add_post("/api/users/{id}/merge", api_merge)
    app.router.add_put("/api/devices/{id}/ha-user", api_device_ha_user)
