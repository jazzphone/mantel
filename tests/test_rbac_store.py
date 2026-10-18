"""P3.2 storage and Owner-only REST: temp SQLite, a stub identity resolver, no HA."""
from __future__ import annotations

import asyncio
import json
import re
import sqlite3

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from mantel_server import rbac_store
from mantel_server.rbac import Context, Gate, Grant, Schedule
from mantel_server.rbac_store import MIGRATION, RbacStore, ensure_schema, register
from mantel_server.view import ClientView, Coalescing
from rbac_fixtures import NOW, TZ, child, ctx, registry, st, states

KITCHEN_FOR_CODY = {"effect": "allow", "actions": ["view", "control"], "resource_kind": "entity",
                   "resource": "light.kitchen", "users": ["cody"], "note": "kitchen light for Cody"}


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(tmp_path / "rbac.db")
    ensure_schema(c)
    yield c
    c.close()


@pytest.fixture
def store(conn):
    return RbacStore(conn, clock=lambda: NOW)


def test_migration_follows_the_numbered_convention_and_is_idempotent(conn):
    assert re.fullmatch(r"\d{4}_[a-z_]+\.sql", MIGRATION.name) and MIGRATION.name.startswith("0002_")
    ensure_schema(conn)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"rbac_grants", "rbac_role_overrides", "rbac_scopes"} <= tables
    assert "BEGIN" not in MIGRATION.read_text().upper().split("--")[0]   # the runner owns transactions


def test_grants_round_trip_and_remove(store):
    g = Grant(effect="deny", actions="control", resource_kind="domain", resource="media_player", roles={"child"},
              schedule=Schedule(start="21:00", end="06:00"), note="no TV after 9 PM")
    saved = store.add_grant(g, by="olive")
    assert saved.id is not None and saved == Grant.from_dict({**g.to_dict(), "id": saved.id})
    assert store.grants() == [saved]
    assert store.conn.execute("SELECT created_by, created_at FROM rbac_grants").fetchone() == ("olive", NOW)
    assert store.remove_grant(saved.id) and not store.remove_grant(saved.id)
    assert store.grants() == []


def test_a_stored_grant_must_target_someone(store):
    with pytest.raises(ValueError):
        store.add_grant(Grant(effect="allow", actions="view", resource_kind="all"))


def test_policy_reflects_writes(store):
    s = store.subject(user_role="child", user_id="cody")
    assert not store.policy().decide(s, "light.turn_on", "light.kitchen", ctx()).allowed
    g = store.add_grant(Grant.from_dict(KITCHEN_FOR_CODY))
    assert store.policy().decide(s, "light.turn_on", "light.kitchen", ctx()).allowed
    store.remove_grant(g.id)
    assert not store.policy().decide(s, "light.turn_on", "light.kitchen", ctx()).allowed


def test_scopes_feed_subject_areas(store):
    assert store.subject(user_role="child", user_id="cody").user_areas == frozenset()
    store.set_scopes("user", "cody", ["cody_room", "Loft"])
    store.set_scopes("device", "loft_tablet", ["loft"])
    s = store.subject(user_role="child", user_id="cody", device_role="wall_tablet", device_id="loft_tablet")
    assert s.user_areas == {"cody_room", "Loft"} and s.device_areas == {"loft"}
    assert store.policy().decide(s, "light.turn_on", "light.loft", ctx()).allowed
    store.set_scopes("user", "cody", [])
    assert store.scopes("user", "cody") == frozenset()
    with pytest.raises(ValueError):
        store.set_scopes("robot", "x", ["loft"])
    with pytest.raises(ValueError):
        store.set_scopes("user", "cody", "loft")


def test_role_overrides(store):
    store.set_override("guest", {"tunnel_sensitive": True}, by="olive")
    assert store.policy().roles["guest"].tunnel_sensitive
    assert store.policy().roles["guest"].grants                 # switches merge; defaults kept
    store.set_override("child", {"grants": []})
    assert not store.policy().decide(child(), "light.turn_on", "light.cody", ctx()).allowed
    assert store.clear_override("child") and not store.clear_override("child")
    assert store.policy().decide(child(), "light.turn_on", "light.cody", ctx()).allowed
    for bad_role, body in (("owner", {"grants": []}), ("Bad Name", {}), ("child", {"oops": 1}), ("child", [])):
        with pytest.raises(ValueError):
            store.set_override(bad_role, body)


def test_unreadable_rows_never_widen_access(store, conn):
    def raw(effect, actions, users):
        conn.execute("INSERT INTO rbac_grants (effect, actions, resource_kind, resource, users, created_at) "
                     "VALUES (?,?,?,?,?,?)", (effect, actions, "feature", "jacuzzi", users, NOW))
        conn.commit()
    raw("allow", '["view"]', '["cody"]')
    raw("deny", '["fly"]', '["cody"]')
    store.invalidate()
    grants = store.grants()
    assert [(g.effect, g.resource_kind, sorted(g.actions)) for g in grants] == [("deny", "all", ["*"])]
    assert not store.policy().decide(child(), "light.turn_on", "light.cody", ctx()).allowed
    conn.execute("INSERT INTO rbac_role_overrides (role, body, updated_at) VALUES ('adult', '{\"x\": 1}', 0)")
    conn.commit()
    store.invalidate()
    assert store.policy().roles["adult"].grants == ()
    conn.execute("INSERT INTO rbac_role_overrides (role, body, updated_at) VALUES ('owner', '{\"grants\": []}', 0)")
    conn.commit()
    store.invalidate()
    assert store.policy().roles["owner"].grants                # the owner role cannot be overridden


# -- REST ----------------------------------------------------------------------------------------
class FakeSession:
    def __init__(self, view):
        self.view = view
        self.wake = asyncio.Event()


class FakeHub:
    def __init__(self):
        self.sessions = set()


IDENTITIES = {"owner-token": {"user_id": "olive", "role": "owner"},
              "admin-token": {"user_id": "arlo", "role": "admin"},
              "child-token": {"user_id": "cody", "role": "child"}}


def identity(request):
    """Test stub for the orchestrator's resolver (P3.1 sessions in production)."""
    return IDENTITIES.get(request.headers.get("X-Test-Identity", ""))


async def async_identity(request):
    return identity(request)


@pytest.fixture
async def api(conn):
    hub = FakeHub()
    events = []
    flags = {"csrf": True, "audit_fails": False}

    def audit(event):
        if flags["audit_fails"]:
            raise sqlite3.OperationalError("disk full")
        events.append(event)

    app = web.Application()
    store = register(app, hub, identity=async_identity, conn=conn, csrf=lambda r: flags["csrf"], audit=audit)
    store.clock = lambda: NOW
    async with TestClient(TestServer(app)) as client:
        yield client, store, hub, events, flags


def as_(who):
    return {"X-Test-Identity": f"{who}-token"}


async def test_rest_is_owner_only(api):
    client, store, hub, events, flags = api
    for method, path in (("GET", "/api/rbac/grants"), ("POST", "/api/rbac/grants"), ("DELETE", "/api/rbac/grants/1"),
                         ("GET", "/api/rbac/roles"), ("PUT", "/api/rbac/roles/guest"),
                         ("DELETE", "/api/rbac/roles/guest"), ("GET", "/api/rbac/scopes/user/cody"),
                         ("PUT", "/api/rbac/scopes/user/cody")):
        r = await client.request(method, path, json={})
        assert r.status == 401, (method, path)
        for who in ("admin", "child"):
            r = await client.request(method, path, json={}, headers=as_(who))
            assert r.status == 403 and (await r.json())["error"] == "owner_only", (method, path, who)
    assert events == [] and store.grants() == []


async def test_owner_lists_adds_and_removes_grants(api):
    client, store, hub, events, flags = api
    r = await client.post("/api/rbac/grants", json=KITCHEN_FOR_CODY, headers=as_("owner"))
    assert r.status == 201
    g = (await r.json())["grant"]
    assert g["id"] and g["users"] == ["cody"] and g["note"] == "kitchen light for Cody"
    r = await client.get("/api/rbac/grants", headers=as_("owner"))
    assert [x["id"] for x in (await r.json())["grants"]] == [g["id"]]
    assert events[-1]["action"] == "rbac.grant.add" and events[-1]["actor"] == "olive"
    r = await client.delete(f"/api/rbac/grants/{g['id']}", headers=as_("owner"))
    assert r.status == 200 and (await r.json()) == {"removed": g["id"]}
    r = await client.delete(f"/api/rbac/grants/{g['id']}", headers=as_("owner"))
    assert r.status == 404
    r = await client.delete("/api/rbac/grants/abc", headers=as_("owner"))
    assert r.status == 400


@pytest.mark.parametrize("body", [
    {**KITCHEN_FOR_CODY, "users": []},                       # targets nobody
    {**KITCHEN_FOR_CODY, "effect": "maybe"},
    {**KITCHEN_FOR_CODY, "actions": ["fly"]},
    {**KITCHEN_FOR_CODY, "id": 7},
    {**KITCHEN_FOR_CODY, "role": "owner"},                    # unknown key
    {**KITCHEN_FOR_CODY, "schedule": {"start": "21:00"}},
    [KITCHEN_FOR_CODY],
    "allow everything",
])
async def test_bad_grants_are_refused(api, body):
    client, store, hub, events, flags = api
    r = await client.post("/api/rbac/grants", json=body, headers=as_("owner"))
    assert r.status == 400 and store.grants() == [] and events == []


async def test_invalid_json_is_refused(api):
    client, store, *_ = api
    r = await client.post("/api/rbac/grants", data="{nope", headers=as_("owner"))
    assert r.status == 400


async def test_csrf_and_audit_failures_refuse_changes(api):
    client, store, hub, events, flags = api
    flags["csrf"] = False
    r = await client.post("/api/rbac/grants", json=KITCHEN_FOR_CODY, headers=as_("owner"))
    assert r.status == 403 and (await r.json())["error"] == "csrf"
    assert (await client.get("/api/rbac/grants", headers=as_("owner"))).status == 200   # reads need no CSRF
    flags["csrf"] = True
    flags["audit_fails"] = True
    r = await client.post("/api/rbac/grants", json=KITCHEN_FOR_CODY, headers=as_("owner"))
    assert r.status == 503 and store.grants() == []


async def test_roles_and_scopes_routes(api):
    client, store, hub, events, flags = api
    r = await client.get("/api/rbac/roles", headers=as_("owner"))
    roles = (await r.json())["roles"]
    assert set(roles) == {"owner", "admin", "adult", "child", "guest", "wall_tablet", "service"}
    assert roles["wall_tablet"]["sensitive_needs_person"] and not roles["guest"]["overridden"]
    r = await client.put("/api/rbac/roles/guest", json={"tunnel_sensitive": True}, headers=as_("owner"))
    assert r.status == 200 and (await r.json())["role"]["tunnel_sensitive"]
    roles = (await (await client.get("/api/rbac/roles", headers=as_("owner"))).json())["roles"]
    assert roles["guest"]["overridden"] and roles["guest"]["tunnel_sensitive"]
    assert (await client.put("/api/rbac/roles/owner", json={}, headers=as_("owner"))).status == 400
    assert (await client.put("/api/rbac/roles/guest", json={"x": 1}, headers=as_("owner"))).status == 400
    assert (await client.delete("/api/rbac/roles/guest", headers=as_("owner"))).status == 200
    assert (await client.delete("/api/rbac/roles/guest", headers=as_("owner"))).status == 404
    r = await client.put("/api/rbac/scopes/user/cody", json={"areas": ["cody_room", "loft"]}, headers=as_("owner"))
    assert (await r.json()) == {"areas": ["cody_room", "loft"]}
    r = await client.get("/api/rbac/scopes/user/cody", headers=as_("owner"))
    assert (await r.json()) == {"areas": ["cody_room", "loft"]}
    assert (await client.put("/api/rbac/scopes/robot/x", json={"areas": []}, headers=as_("owner"))).status == 400
    assert (await client.put("/api/rbac/scopes/user/x", json={"areas": [1]}, headers=as_("owner"))).status == 400
    assert [e["action"] for e in events] == ["rbac.role.set", "rbac.role.clear", "rbac.scopes.set"]


async def test_a_grant_change_reaches_connected_sessions_at_once(api):
    client, store, hub, events, flags = api
    reg, sts = registry(), states()
    gate = Gate(store.policy, store.subject(user_role="child", user_id="cody"),
                lambda: Context.from_registry(reg, NOW, TZ, sts.states))
    session = FakeSession(ClientView(sts, reg, Coalescing(), gate=gate))
    hub.sessions.add(session)
    snap = session.view.select([], [], 0.0, all_entities=True)
    assert "light.kitchen" not in snap["entities"]
    r = await client.post("/api/rbac/grants", json=KITCHEN_FOR_CODY, headers=as_("owner"))
    assert r.status == 201 and session.wake.is_set()
    msg, _ = session.view.flush(1.0)
    assert msg == {"type": "diff", "added": {"light.kitchen": st("on")}}


def test_register_needs_a_store_or_connection():
    with pytest.raises(ValueError):
        register(web.Application(), FakeHub(), identity=identity)


def test_sync_identity_resolvers_work_too(conn):
    app = web.Application()
    store = register(app, FakeHub(), identity=identity, conn=conn)
    assert app["rbac"] is store and isinstance(store, rbac_store.RbacStore)


def test_a_child_has_the_music_page_and_an_owner_can_take_it_away(store):
    s = store.subject(user_role="child", user_id="cody")
    pol = store.policy()
    assert pol.decide(s, "view", None, ctx(), feature="music").allowed
    assert pol.decide(s, "control", None, ctx(), feature="music").allowed
    # adjustable: an Owner's deny for this one child (or the whole role) wins
    g = store.add_grant(Grant(effect="deny", actions="*", resource_kind="feature", resource="music", users={"cody"},
                              note="no music for now"), by="olive")
    assert not store.policy().decide(s, "view", None, ctx(), feature="music").allowed
    store.remove_grant(g.id)
    assert store.policy().decide(s, "view", None, ctx(), feature="music").allowed
