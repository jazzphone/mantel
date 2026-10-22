"""Home Assistant's users, each in one place (people_ha.py; decision 29 "people in one list"): an HA user is linked to
an EXISTING person (not a separate account), an account made for one by role is merged into a person with what it
had, a wall tablet's HA user is set on its device, and the Owner rules hold."""
import json

from mantel_server.settings_store import Actor
from test_features import make_env  # noqa: F401
from test_linked_settings import FakeDirectory, ha_user

AVERY, SAM, KITCHEN = "a" * 32, "b" * 32, "e" * 32


async def setup(env):
    env.app["linked_settings"].directory = FakeDirectory([ha_user(AVERY, "Avery", True), ha_user(SAM, "Sam", False),
                                                          ha_user(KITCHEN, "kitchen", False)])
    await env.login("owner1", "owner")
    db = env.app["store"].db
    return db, db.execute("SELECT id FROM users WHERE username = 'owner1'").fetchone()[0]


async def put(env, path, body):
    r = await env.m.client.put(path, json=body, headers=env.m.headers())
    return r.status, await r.json()


async def test_the_list_and_a_link_to_an_existing_person(make_env):
    env = await make_env()
    db, me = await setup(env)
    got = await (await env.m.get("/api/people/ha")).json()
    assert [u["name"] for u in got["users"]] == ["Avery", "kitchen", "Sam"], "nobody linked yet: admins first"
    assert any(p["id"] == me for p in got["people"])
    st, _ = await put(env, "/api/people/ha", {"ha_user": AVERY, "user_id": me})
    assert st == 200
    row = db.execute("SELECT user_id FROM ha_links WHERE ha_user_id = ?", (AVERY,)).fetchone()
    assert row[0] == me, "linked to the existing person, no new account"
    assert db.execute("SELECT COUNT(*) FROM users WHERE kind = 'ha_linked'").fetchone()[0] == 0
    got = await (await env.m.get("/api/people/ha")).json()
    assert got["users"][0]["person"]["id"] == me
    st, body = await put(env, "/api/people/ha", {"ha_user": SAM, "user_id": me})
    assert st == 409 and body["error"] == "already_linked", "one Home Assistant user per person"


async def test_an_account_made_by_role_is_merged_into_the_person(make_env):
    env = await make_env()
    db, me = await setup(env)
    dup = env.app["store"].link(SAM, "adult", "Sam (HA)")           # as the Ingress People page did
    svc = env.app["settings"]
    with db:
        db.execute("INSERT INTO default_screens (subject, screen, set_by, updated) VALUES (?, 'dashboard-hall', 'x', 0)",
                   (f"u:{dup}",))
        db.execute("INSERT INTO person_phones (user_id, services, send, changed) VALUES (?, '[]', 'all', 0)", (dup,))
        db.execute("INSERT INTO rbac_grants (effect, actions, resource_kind, users, created_at) VALUES "
                   "('allow', '[\"view\"]', 'all', ?, 0)", (json.dumps([dup]),))
    svc.store.write([("user", dup, {"look": {"accent": "pink"}})], actor=Actor(label="t"))
    adult = await env.m.user("sam", "adult")
    sam = adult["id"] if isinstance(adult, dict) else db.execute("SELECT id FROM users WHERE username='sam'").fetchone()[0]
    st, body = await put(env, "/api/people/ha", {"ha_user": SAM, "user_id": sam})
    assert st == 200 and body["merged"]["into"] == sam, body
    assert set(body["merged"]["moved"]) >= {"home_assistant", "default_screen", "phones", "grants", "settings"}
    assert db.execute("SELECT 1 FROM users WHERE id = ?", (dup,)).fetchone() is None, "the extra account is gone"
    assert db.execute("SELECT user_id FROM ha_links WHERE ha_user_id = ?", (SAM,)).fetchone()[0] == sam
    assert db.execute("SELECT screen FROM default_screens WHERE subject = ?", (f"u:{sam}",)).fetchone()[0] == "dashboard-hall"
    assert json.loads(db.execute("SELECT users FROM rbac_grants").fetchone()[0]) == [sam]
    assert svc.store.body("user", sam)["look"]["accent"] == "pink" and svc.store.get("user", dup) is None


async def test_merge_by_hand_and_its_refusals(make_env):
    env = await make_env()
    db, me = await setup(env)
    dup = env.app["store"].link(AVERY, "owner", "Avery (HA)")
    r = await env.m.client.post(f"/api/users/{me}/merge", json={"into": dup}, headers=env.m.headers())
    assert r.status == 409, "only an account made for an HA user is merged"
    r = await env.m.client.post(f"/api/users/{dup}/merge", json={"into": me}, headers=env.m.headers())
    assert r.status == 200 and db.execute("SELECT user_id FROM ha_links WHERE ha_user_id = ?", (AVERY,)).fetchone()[0] == me
    await env.login("admin1", "admin")
    r = await env.m.client.post(f"/api/users/{me}/merge", json={"into": me}, headers=env.m.headers())
    assert r.status == 403, "an Owner merges"


async def test_the_owner_rules(make_env):
    env = await make_env()
    db, me = await setup(env)
    st, _ = await put(env, "/api/people/ha", {"ha_user": AVERY, "user_id": me})
    assert st == 200
    await env.login("admin1", "admin")
    st, body = await put(env, "/api/people/ha", {"ha_user": AVERY, "user_id": None})
    assert st == 403 and body["error"] == "owner_only"
    assert (await put(env, "/api/people/ha", {"ha_user": AVERY}))[0] == 400


async def test_a_wall_tablet_s_home_assistant_user_is_set_on_its_device(make_env):
    env = await make_env()
    db, me = await setup(env)
    dev = (env.app["devices"].enroll("Kitchen tablet", "wall_tablet", None, me)[0],)
    st, body = await put(env, f"/api/devices/{dev[0]}/ha-user", {"ha_user": KITCHEN})
    assert st == 200, body
    assert db.execute("SELECT device_id FROM ha_tablet_links WHERE ha_user_id = ?", (KITCHEN,)).fetchone()[0] == dev[0]
    got = await (await env.m.get("/api/people/ha")).json()
    assert next(u for u in got["users"] if u["id"] == KITCHEN)["tablet"]["device_id"] == dev[0]
    st, _ = await put(env, "/api/people/ha", {"ha_user": KITCHEN, "user_id": me})
    assert st == 409, "a tablet's HA user is changed on Devices"
    st, _ = await put(env, f"/api/devices/{dev[0]}/ha-user", {"ha_user": None})
    assert st == 200 and db.execute("SELECT 1 FROM ha_tablet_links WHERE ha_user_id = ?", (KITCHEN,)).fetchone() is None


async def test_a_home_assistant_user_on_a_wall_tablet_account_moves_to_its_tablet_and_the_account_goes(make_env):
    """Before tablets were enrolled, a tablet's Home Assistant user was linked to a Wall Tablet ACCOUNT (a person):
    made its device's, the account is removed (audited); one linked to anyone else is refused."""
    env = await make_env()
    db, me = await setup(env)
    stand_in = await env.m.user("kitchen", "wall_tablet")
    sid = stand_in["id"] if isinstance(stand_in, dict) else db.execute("SELECT id FROM users WHERE username='kitchen'").fetchone()[0]
    assert (await put(env, "/api/people/ha", {"ha_user": KITCHEN, "user_id": sid}))[0] == 200
    assert (await put(env, "/api/people/ha", {"ha_user": AVERY, "user_id": me}))[0] == 200
    dev = env.app["devices"].enroll("Kitchen", "wall_tablet", None, me)[0]
    st, body = await put(env, f"/api/devices/{dev}/ha-user", {"ha_user": AVERY})
    assert st == 409 and body["error"] == "person", "a person's Home Assistant user is never taken for a tablet"
    st, body = await put(env, f"/api/devices/{dev}/ha-user", {"ha_user": KITCHEN})
    assert st == 200 and body["removed_account"] == "Kitchen", body
    assert db.execute("SELECT device_id FROM ha_tablet_links WHERE ha_user_id = ?", (KITCHEN,)).fetchone()[0] == dev
    assert db.execute("SELECT 1 FROM users WHERE id = ?", (sid,)).fetchone() is None
    assert any(r["action"] == "people.remove_tablet_account" for r in env.audit(kind="config"))
