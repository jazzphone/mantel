"""The screen a person or a wall tablet opens on (default_screens.py, migration 0014): landing only.

/ and /home: at an enrolled tablet (a person signed in there too) the tablet's own screen, else its HK tablet's;
anywhere else the person's own; then the house's default_screen. A screen that no longer exists is passed over.
Who may set what: anyone their own; Owner/Admin a person's or a tablet's, an Admin never an Owner's. Only
Mantel's screens. Which screens anyone may open stays with roles (nothing here refuses a screen).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from conftest import Mantel  # noqa: F401  (the fixture's type)
from mantel_server import settings_store

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "hosts/server/mantel_server/migrations"


def boards(m, *paths):
    svc = m.app["settings"]
    svc.store.write([("board", p, {"title": p.split("-", 1)[1].title()}) for p in paths],
                    actor=settings_store.Actor(label="test"))


async def put(m, path, screen):
    return await m.client.put(path, json={"screen": screen}, headers=m.headers())


async def home(m):
    r = await m.client.get("/home", allow_redirects=False)
    assert r.status == 302
    return r.headers["Location"]


def test_migration_0014_makes_the_table():
    sql = (MIGRATIONS / "0014_default_screens.sql").read_text()
    assert "CREATE TABLE default_screens" in sql and "subject TEXT PRIMARY KEY" in sql


async def test_a_person_lands_on_their_own_screen_else_the_houses(mantel):
    m = mantel
    boards(m, "dashboard-kitchen", "dashboard-loft")
    await m.user("kid", "child")
    await m.sign_in("kid")
    assert await home(m) == "/dashboard-kitchen/home"           # the house's (Config.default_screen)
    got = await (await m.get("/api/default-screen")).json()
    assert got["screen"] is None and got["house"] == "dashboard-kitchen"
    assert [s["path"] for s in got["screens"]] == ["dashboard-kitchen", "dashboard-loft"]
    assert (await put(m, "/api/default-screen", "dashboard-loft")).status == 200
    assert await home(m) == "/dashboard-loft/home"
    assert (await put(m, "/api/default-screen", None)).status == 200
    assert await home(m) == "/dashboard-kitchen/home"


async def test_only_mantels_screens_and_a_gone_one_is_passed_over(mantel):
    m = mantel
    boards(m, "dashboard-kitchen", "dashboard-loft")
    await m.user("ann", "adult")
    await m.sign_in("ann")
    for bad in ("dashboard-nope", "../admin", "x", 5):
        assert (await put(m, "/api/default-screen", bad)).status == 400, bad
    assert (await put(m, "/api/default-screen", "dashboard-loft")).status == 200
    with m.app["settings"].store.conn as conn:
        conn.execute("DELETE FROM settings_docs WHERE scope = 'board' AND key = 'dashboard-loft'")
    assert await home(m) == "/dashboard-kitchen/home"


async def test_owners_and_admins_set_others_an_admin_never_an_owners(mantel):
    m = mantel
    boards(m, "dashboard-kitchen", "dashboard-loft")
    owner = await m.user("jo", "owner")
    kid = await m.user("kid", "child")
    await m.user("al", "admin")
    await m.sign_in("al")
    kid_id, owner_id = kid, owner
    assert (await put(m, f"/api/users/{kid_id}/default-screen", "dashboard-loft")).status == 200
    assert (await put(m, f"/api/users/{owner_id}/default-screen", "dashboard-loft")).status == 403
    assert (await put(m, "/api/users/nobody/default-screen", "dashboard-loft")).status == 404
    got = await (await m.get("/api/default-screens")).json()
    assert got["users"] == {kid_id: "dashboard-loft"} and got["devices"] == {}
    m.forget_cookies()
    await m.sign_in("kid")
    assert await home(m) == "/dashboard-loft/home"              # what the Admin chose
    assert (await m.get("/api/default-screens")).status == 403    # a Child reads only their own
    assert (await put(m, f"/api/users/{kid_id}/default-screen", "dashboard-kitchen")).status == 403


async def test_a_tablet_opens_its_own_screen_whoever_is_signed_in(mantel):
    m = mantel
    boards(m, "dashboard-kitchen", "dashboard-loft", "dashboard-hall")
    await m.user("jo", "owner")
    await m.user("ann", "adult")
    await m.sign_in("ann")
    assert (await put(m, "/api/default-screen", "dashboard-hall")).status == 200
    m.forget_cookies()
    await m.sign_in("jo")
    r = await m.post("/api/devices/enroll", {"name": "Loft tablet", "room": "loft"})
    assert r.status == 201
    device_id = (await r.json())["device"]["id"]
    tablet = m.client.session.cookie_jar.filter_cookies(m.client.make_url("/"))
    assert await home(m) == "/dashboard-kitchen/home"           # no HK tablet, nothing chosen: the house's
    # the Owner, on another browser, chooses the tablet's screen
    m.forget_cookies()
    await m.sign_in("jo")
    assert (await put(m, f"/api/devices/{device_id}/default-screen", "dashboard-loft")).status == 200
    assert (await put(m, "/api/devices/nope/default-screen", "dashboard-loft")).status == 404
    m.forget_cookies()
    m.client.session.cookie_jar.update_cookies({k: v.value for k, v in tablet.items()}, response_url=m.client.make_url("/"))
    assert await home(m) == "/dashboard-loft/home"
    # a person signed in at the tablet still gets the tablet's, not their own (dashboard-hall)
    from mantel_server import default_screens
    from mantel_server.sessions import Device, Identity, User
    ann = m.app["accounts"].db.execute("SELECT id FROM users WHERE username = 'ann'").fetchone()[0]
    person = User(ann, "Ann", "adult", "mantel")
    at_tablet = Identity(person, Device(device_id, "Loft tablet", "wall_tablet", "loft"), "lan")
    assert default_screens.start_for(m.app, at_tablet) == "/dashboard-loft/home"
    assert default_screens.start_for(m.app, Identity(person, None, "lan")) == "/dashboard-hall/home"


async def test_a_wall_tablet_account_lands_on_enrolling_until_it_is_a_tablet(mantel):
    """A Wall Tablet account exists only to make its tablet, and its dashboard shows no Mantel Settings: on the home
    network /home takes it to Me → Make This Browser a Wall Tablet; once enrolled, the tablet's screen (2026-10-19)."""
    m = mantel
    boards(m, "dashboard-kitchen", "dashboard-loft")
    await m.user("loft", "wall_tablet", name="Loft")
    await m.sign_in("loft")
    assert await home(m) == "/settings#/mantel/me/enroll"
    r = await m.post("/api/devices/enroll", {"name": "Loft", "room": "Loft"})
    assert r.status == 201
    assert await home(m) != "/settings#/mantel/me/enroll"
