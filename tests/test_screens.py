"""Mantel's screens (screens.py; decision 29 "one place per screen"): add one (for Mantel, or for Home Assistant with
HK's generated dashboard made there), say who draws it, split one both drew (Mantel's copy at a new address with
everything that pointed at it; the old address Home Assistant's, redirected), remove one; HK's dashboards in Home
Assistant are changed only when they are HK's generated ones."""
import json

import pytest

from mantel_server.ha import ha_dashboards as HD
from mantel_server.pages import screens as SC
from mantel_server.settings_store import Actor
from test_ha_dashboards import BASE, FakeHa, audits, ha, owner  # noqa: F401


def store(m):
    return m.app["settings"].store


async def call(m, method, path, body=None):
    r = await m.client.request(method, path, json=body if body is not None else {}, headers=m.headers())
    return r.status, await r.json()


def test_an_address_from_a_name():
    assert SC.slug("Home-Mantel") == "home-mantel"
    assert SC.slug("Den") == "screen-den", "Home Assistant wants a hyphen in a dashboard's address"
    assert SC.slug("Master Bedroom!") == "master-bedroom"


async def test_only_owners_and_admins_add_screens(mantel, ha):
    await owner(mantel, "ada", "adult")
    st, _ = await call(mantel, "POST", "/api/screens", {"title": "Den", "where": "mantel"})
    assert st == 403


async def test_a_new_mantel_screen_copied_from_another(mantel, ha):
    await owner(mantel)
    store(mantel).write([("board", "dashboard-loft", {"title": "Loft", "accent": "blue"})], actor=Actor(label="t"))
    st, body = await call(mantel, "POST", "/api/screens", {"title": "Study Desk", "where": "mantel", "from": "dashboard-loft"})
    assert st == 200 and body["key"] == "study-desk"
    b = store(mantel).body("board", "study-desk")
    assert b["accent"] == "blue" and b["title"] == "Study Desk" and b["where"] == "mantel"
    assert not [f for f in ha.frames if f["type"] == "lovelace/dashboards/create"], "nothing made in HA for a Mantel screen"
    assert audits(mantel, "screen.add")[0]["screen"] == "study-desk"
    paths = [d["path"] for d in mantel.app["settings"].dashboards(
        {k: d.body for k, d in store(mantel).docs("board").items()})]
    assert "study-desk" in paths


async def test_a_new_home_assistant_screen_makes_hk_s_dashboard_there(mantel, ha):
    await owner(mantel)
    st, body = await call(mantel, "POST", "/api/screens", {"title": "Tablet Two", "where": "ha"})
    assert st == 200 and body["key"] == "tablet-two"
    made = [f for f in ha.frames if f["type"] == "lovelace/dashboards/create"]
    assert made and made[-1]["url_path"] == "tablet-two"
    assert ha.configs["tablet-two"] == HD.HK_CONFIG, "HK's generated dashboard, nothing else"
    assert store(mantel).body("board", "tablet-two")["where"] == "ha"
    from mantel_server.pages import default_screens
    assert "tablet-two" not in [s["path"] for s in default_screens.screens(mantel.app)], "not a screen Mantel opens"


async def test_a_screen_home_assistant_draws_is_not_served_by_mantel(mantel, ha):
    await owner(mantel)
    await call(mantel, "POST", "/api/screens", {"title": "Car Screen", "where": "ha"})
    r = await mantel.client.get("/car-screen/home", allow_redirects=False)
    assert r.status == 200 and "drawn by HK Frontend in Home Assistant" in await r.text()


async def test_split_moves_what_pointed_at_mantel_s_screen(mantel, ha):
    await owner(mantel)
    s = store(mantel)
    s.write([("board", "dashboard-home", {"accent": "teal", "favorites": ["light.den"]}),
             ("tablet", "den", {"name": "Den", "screen": "dashboard-home"}),
             ("house", "popups", {"items": [{"hash": "door", "name": "Door", "dashboards": ["dashboard-home"]}]}),
             ("house", "accessories", {"entities": {"light.den": {"names": {"dashboard-home": "Lamp"}}}})],
            actor=Actor(label="t"))
    db = mantel.app["store"].db
    with db:
        db.execute("INSERT INTO default_screens (subject, screen, set_by, updated) VALUES ('u:x', 'dashboard-home', 'x', 0)")
    # the screen is framed in HA's sidebar (a Webpage dashboard of ours)
    await call(mantel, "PUT", "/api/admin/screens/dashboard-home/ha-dashboard", {"on": True, "title": "Home"})
    assert ha.ours("dashboard-home")
    st, body = await call(mantel, "POST", "/api/screens/dashboard-home/split", {"title": "Home-Mantel"})
    assert st == 200 and body["key"] == "home-mantel" and body["frames"] == ["mantel-home"]
    assert s.body("board", "home-mantel")["accent"] == "teal" and s.body("board", "home-mantel")["where"] == "mantel"
    assert s.body("board", "dashboard-home")["where"] == "ha" and s.body("board", "dashboard-home")["accent"] == "teal", \
        "Home Assistant's starts as a copy of Mantel's"
    assert s.body("tablet", "den")["screen"] == "home-mantel", "the wall tablets on it are Mantel's"
    assert s.body("house", "popups")["items"][0]["dashboards"] == ["dashboard-home", "home-mantel"]
    assert s.body("house", "accessories")["entities"]["light.den"]["names"]["home-mantel"] == "Lamp"
    assert db.execute("SELECT screen FROM default_screens WHERE subject='u:x'").fetchone()[0] == "home-mantel"
    assert ha.ours("home-mantel") and not ha.ours("dashboard-home"), "the framed dashboard follows Mantel's screen"
    assert next(d for d in ha.dashboards.values() if d["url_path"] == "mantel-home")["title"] == "Home-Mantel"
    r = await mantel.client.get("/dashboard-home/home?x=1", allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == "/home-mantel/home?x=1", "old addresses still open Mantel's"
    assert audits(mantel, "screen.split")[0] == {"screen": "dashboard-home", "to": "home-mantel", "title": "Home-Mantel"}


async def test_where_and_its_refusals(mantel, ha):
    await owner(mantel)
    s = store(mantel)
    s.write([("board", "dashboard-tesla", {}), ("tablet", "loft", {"name": "Loft", "screen": "dashboard-loft"})],
            actor=Actor(label="t"))
    st, _ = await call(mantel, "PUT", "/api/screens/dashboard-tesla", {"where": "ha"})
    assert st == 200 and s.body("board", "dashboard-tesla")["where"] == "ha"
    st, body = await call(mantel, "PUT", "/api/screens/dashboard-loft", {"where": "ha"})
    assert st == 409 and body["error"] == "tablets", "a screen wall tablets open in Mantel stays Mantel's"
    st, _ = await call(mantel, "PUT", "/api/screens/dashboard-tesla", {"title": "Tesla"})
    assert st == 200 and s.body("board", "dashboard-tesla")["title"] == "Tesla"
    assert (await call(mantel, "PUT", "/api/screens/nope", {"where": "ha"}))[0] == 404
    assert (await call(mantel, "PUT", "/api/screens/dashboard-tesla", {"where": "elsewhere"}))[0] == 400


async def test_remove_ha_only_removes_hk_s_generated_dashboard(mantel, ha):
    await owner(mantel)
    ha.dashboards["dashboard_kitchen"] = {"id": "dashboard_kitchen", "url_path": "dashboard-kitchen", "title": "Kitchen",
                                          "mode": "storage"}
    ha.configs["dashboard-kitchen"] = dict(HD.HK_CONFIG)
    ha.dashboards["dashboard_loft"] = {"id": "dashboard_loft", "url_path": "dashboard-loft", "title": "Loft",
                                       "mode": "storage"}
    ha.configs["dashboard-loft"] = {"views": [{"cards": []}]}            # hand-built: never touched
    st, body = await call(mantel, "PUT", "/api/screens/dashboard-kitchen", {"remove_ha": True})
    assert st == 200 and body["removed"] == 1 and "dashboard_kitchen" not in ha.dashboards
    # (a linked HK Frontend's report of its dashboards no longer lists it: tested in test_linked_settings' place tests)
    st, body = await call(mantel, "PUT", "/api/screens/dashboard-loft", {"remove_ha": True})
    assert st == 404 and "dashboard_loft" in ha.dashboards
    assert store(mantel).get("board", "dashboard-kitchen") is not None, "Mantel's screen stays"


async def test_the_read_only_kill_switch_changes_no_dashboard_in_home_assistant(mantel, ha):
    """SRV-12 (third audit pass): with --read-only an Admin could still create and delete Home Assistant dashboards
    through the pinned administrator connection. Rules.md rule 3: with the kill switch the house stays read-only."""
    await owner(mantel)
    await call(mantel, "POST", "/api/screens", {"title": "Tablet Two", "where": "ha"})     # made before the switch
    mantel.app["cfg"].read_only = True
    rows = lambda: len(mantel.app["audit"].rows(kind="config"))        # noqa: E731
    before, sent, dashboards = rows(), len(ha.frames), dict(ha.dashboards)
    # a Webpage dashboard for a screen
    st, body = await call(mantel, "PUT", "/api/admin/screens/dashboard-loft/ha-dashboard", {"on": True})
    assert st == 409 and body["error"] == "read_only"
    # HK's generated dashboard for a new Home Assistant screen: refused, no screen made
    st, body = await call(mantel, "POST", "/api/screens", {"title": "Tablet Three", "where": "ha"})
    assert st == 409 and body["error"] == "read_only" and store(mantel).get("board", "tablet-three") is None
    # ... and removing one
    st, body = await call(mantel, "PUT", "/api/screens/tablet-two", {"remove_ha": True})
    assert st == 409 and body["error"] == "read_only"
    assert ha.dashboards == dashboards and len(ha.frames) == sent and rows() == before, "nothing asked, nothing audited"
    # a screen for Mantel is Mantel's own settings, not Home Assistant's; the page still lists dashboards
    st, body = await call(mantel, "POST", "/api/screens", {"title": "Study Desk"})
    assert st == 200 and store(mantel).get("board", "study-desk") is not None
    assert (await mantel.get("/api/admin/ha-dashboards")).status == 200
    # a split changes Mantel's settings and leaves Home Assistant's frames alone
    await call(mantel, "POST", "/api/screens/study-desk/split", {"title": "Study Two"})
    assert not [f for f in ha.frames[sent:] if f["type"].startswith(("lovelace/dashboards/create", "lovelace/config/save",
                                                                       "lovelace/dashboards/update", "lovelace/dashboards/delete"))]

    # the connection itself: one place a write is sent from
    async def body(sess):
        await sess.call("lovelace/dashboards/create", url_path="mantel-x", title="X", icon="mdi:home",
                        show_in_sidebar=True, require_admin=False)
    with pytest.raises(HD.Refused) as refused:
        await HD._open(mantel.app, BASE, body)
    assert refused.value.state == "read_only" and "mantel-x" not in {d["url_path"] for d in ha.dashboards.values()}


async def test_remove_a_screen(mantel, ha):
    await owner(mantel)
    s = store(mantel)
    s.write([("board", "screen-old", {}), ("tablet", "t1", {"name": "T", "screen": "dashboard-kitchen"})],
            actor=Actor(label="t"))
    assert (await call(mantel, "DELETE", "/api/screens/dashboard-kitchen"))[0] == 409
    st, _ = await call(mantel, "DELETE", "/api/screens/screen-old")
    assert st == 200 and s.get("board", "screen-old") is None


def test_the_connection_may_make_only_hk_s_generated_dashboard():
    sess = type("S", (), {"hk_allowed": {"tablet-two"}, "hk_ours": set(), "ours_paths": set()})()
    HD.check_frame({"id": 1, "type": "lovelace/dashboards/create", "url_path": "tablet-two", "title": "T"}, BASE,
                   set(), set(), sess)
    HD.check_frame({"id": 2, "type": "lovelace/config/save", "url_path": "tablet-two", "config": HD.HK_CONFIG},
                   BASE, set(), {"tablet-two"}, sess)
    for bad in ({"type": "lovelace/config/save", "url_path": "tablet-two", "config": {"views": []}},
                {"type": "lovelace/dashboards/create", "url_path": "dashboard-other", "title": "x"},
                {"type": "lovelace/dashboards/delete", "dashboard_id": "something"}):
        with pytest.raises(HD.Blocked):
            HD.check_frame({"id": 3, **bad}, BASE, set(), {"tablet-two"}, sess)
    assert json.dumps(HD.HK_CONFIG) == '{"strategy": {"type": "custom:hk-dashboard"}}'
