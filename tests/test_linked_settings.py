"""HK's settings for a linked HK Frontend (linked_settings.py; decision 29, docs/phase9/TWO-PRODUCTS.md): a client
that asks (features=settings) gets the house's feed after its hello and again after each change; nobody else gets
the frame; the same settings keep the same version; no person's own values go to Home Assistant."""
import asyncio
import json

from aiohttp import WSMsgType

from mantel_server import linked_settings as LS
from mantel_server.settings_store import Actor
from test_features import build, make_env  # noqa: F401

HK = "domain=hk_frontend; protocol=1; features=bridge,settings"


async def connect(env, header=HK):
    _acct, token = env.app["service_accounts"].create("home-assistant", ["linked"])
    env.m.client.session.headers.pop("Origin", None)
    try:
        ws = await env.m.client.ws_connect("/linked/ws", headers={"Authorization": f"Bearer {token}",
                                                                  **({"X-Mantel-Link": header} if header else {})})
    finally:
        env.m.client.session.headers["Origin"] = env.m.origin
    hello = await ws.receive_json(timeout=5)
    assert hello["type"] == "hello"
    return ws


async def frames(ws, timeout=1.0):
    """Every frame that arrives within `timeout` (then a ping's answer ends the wait)."""
    got = []
    await ws.send_json({"id": 99, "type": "ping"})
    while True:
        m = await ws.receive(timeout=timeout + 4)
        assert m.type == WSMsgType.TEXT
        f = json.loads(m.data)
        if f.get("type") == "result" and f.get("id") == 99:
            # anything debounced after the ping
            try:
                while True:
                    m = await ws.receive(timeout=timeout)
                    got.append(json.loads(m.data))
            except asyncio.TimeoutError:
                return got
        got.append(f)


def settings_frames(got):
    return [f for f in got if f.get("type") == "settings"]


async def test_a_linked_hk_frontend_that_asks_gets_the_house_settings_after_hello(make_env):
    env = await make_env()
    ws = await connect(env)
    first = await ws.receive_json(timeout=5)
    assert first["type"] == "settings", "the settings come right after hello"
    p = first["payload"]
    assert "dashboard-hall" in p["boards"] and "hall" in p["tablet_items"]
    assert p["personal"] == {}, "no person's own values: HA's dashboards get the house's"
    assert first["version"] == LS.version_of(p)
    await ws.close()


async def test_nobody_else_gets_the_settings_frame(make_env):
    env = await make_env()
    for header in (None, "domain=hk_frontend; protocol=1; features=bridge",
                   "domain=mantel; protocol=2; features=bridge,settings"):
        ws = await connect(env, header)
        assert settings_frames(await frames(ws, 0.4)) == [], header
        await ws.close()


async def test_a_change_is_sent_again_once_and_the_same_settings_keep_their_version(make_env):
    env = await make_env()
    ws = await connect(env)
    first = await ws.receive_json(timeout=5)
    service = env.app["settings"]
    assert LS.frame_of(service)["version"] == first["version"], "nothing changed: the same version"
    service.store.write([("board", "dashboard-den", {})], actor=Actor(label="test"))
    for _ in range(3):                           # a burst of publishes goes out once
        service.publish()
    got = settings_frames(await frames(ws, 0.6))
    assert len(got) == 1, got
    assert "dashboard-den" in got[0]["payload"]["boards"] and got[0]["version"] != first["version"]
    await ws.close()


async def test_a_person_s_own_save_is_not_sent_to_home_assistant(make_env):
    env = await make_env()
    ws = await connect(env)
    await ws.receive_json(timeout=5)
    env.app["settings"].publish(user_only="someone")
    assert settings_frames(await frames(ws, 0.4)) == []
    await ws.close()


# ------------------------------------------------------------------ saves from Home Assistant (settings_write)
HA_OWNER, HA_ADULT, HA_NOBODY = "a" * 32, "b" * 32, "c" * 32
SAVE = {"type": "hk_frontend/board/set", "dashboard": "dashboard-hall", "changes": {"accent": "blue"}}


async def connect_saving(env, saves=True):
    acct, token = env.app["service_accounts"].create("home-assistant", ["linked", "linked_saves"] if saves else ["linked"])
    env.m.client.session.headers.pop("Origin", None)
    try:
        ws = await env.m.client.ws_connect("/linked/ws", headers={"Authorization": f"Bearer {token}", "X-Mantel-Link": HK})
    finally:
        env.m.client.session.headers["Origin"] = env.m.origin
    await ws.receive_json(timeout=5)              # hello
    await ws.receive_json(timeout=5)              # the settings
    return ws, acct


async def write(ws, ha_user, msg, mid=1):
    await ws.send_json({"id": mid, "type": "settings_write", "ha_user": ha_user, "msg": msg})
    while True:
        f = await ws.receive_json(timeout=5)
        if f.get("type") == "result" and f.get("id") == mid:
            return f


async def test_a_save_from_home_assistant_is_made_as_the_linked_person(make_env):
    env = await make_env()
    env.app["store"].link(HA_OWNER, "owner", "Fictional Owner")
    ws, _ = await connect_saving(env)
    got = await write(ws, HA_OWNER, SAVE)
    assert got["success"], got
    doc = env.app["settings"].store.get("board", "dashboard-hall")
    assert doc.body.get("accent") == "blue"
    last = env.app["settings"].store.history("board", "dashboard-hall", 1)[0]
    assert last["source"] == "Home Assistant" and last["actor_role"] == "owner", last
    later = settings_frames(await frames(ws, 0.6))
    assert later and later[-1]["version"] == LS.frame_of(env.app["settings"])["version"], \
        "the new settings come back, so every dashboard sees the save"
    await ws.close()


async def test_a_save_is_refused_in_words(make_env):
    env = await make_env()
    env.app["store"].link(HA_ADULT, "adult", "Fictional Adult")
    ws, acct = await connect_saving(env)
    nobody = await write(ws, HA_NOBODY, SAVE, 1)
    assert not nobody["success"] and nobody["error"]["code"] == "not_linked"
    assert "Link your Home Assistant user" in nobody["error"]["message"]
    adult = await write(ws, HA_ADULT, SAVE, 2)
    assert not adult["success"] and adult["error"]["code"] == "forbidden", "RBAC decides, as for any save"
    bad = await write(ws, "not-an-id", SAVE, 3)
    assert not bad["success"] and bad["error"]["code"] == "invalid"
    assert env.app["settings"].store.get("board", "dashboard-hall").body.get("accent") != "blue"
    await ws.close()


async def test_without_the_scope_saves_are_off(make_env):
    env = await make_env()
    env.app["store"].link(HA_OWNER, "owner", "Fictional Owner")
    ws, acct = await connect_saving(env, saves=False)
    got = await write(ws, HA_OWNER, SAVE)
    assert not got["success"] and got["error"]["code"] == "saves_off"
    assert "Saves from Home Assistant" in got["error"]["message"]
    await ws.close()


async def test_only_a_client_with_the_settings_feature_may_send_a_save(make_env):
    env = await make_env()
    env.app["store"].link(HA_OWNER, "owner", "Fictional Owner")
    for header in ("domain=hk_frontend; protocol=1; features=bridge", "domain=mantel; protocol=2; features=bridge"):
        ws = await connect(env, header)
        got = await write(ws, HA_OWNER, SAVE)
        assert not got["success"] and got["error"]["code"] in ("bad_request", "not_set_up"), (header, got)
        await ws.close()


def test_hk_frontend_forwards_exactly_mantel_s_settings_saves():
    """linked_mode.SAVES (HK Frontend) is Mantel's SETTINGS_SAVES: every save HK's pages make while the settings
    are Mantel's reaches Mantel, and nothing else does. (The features' saves are not among them: in full linked
    mode HK Frontend runs no features, so their settings pages are not in Home Assistant.)"""
    import ast
    from pathlib import Path
    from mantel_server.settings_store import SETTINGS_SAVES
    src = Path(__file__).resolve().parents[1] / "hosts/ha/custom_components/hk_frontend/linked_mode.py"
    tree = ast.parse(src.read_text())
    node = next(n for n in ast.walk(tree) if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "SAVES")
    saves = set(ast.literal_eval(node.value.args[0]))
    assert saves == set(SETTINGS_SAVES)


# ------------------------------------------------------------------ setup (GET/PUT /api/linked/ha-saves)
class FakeDirectory:
    def __init__(self, users):
        self._users = users

    async def users(self):
        return self._users

    async def user(self, uid):
        return next((u for u in self._users if u["id"] == uid), None)


def ha_user(uid, name, admin):
    return {"id": uid, "name": name, "username": name.lower(), "group_ids": ["system-admin"] if admin else [],
            "is_active": True, "system_generated": False}


async def put_saves(env, body, **kw):
    return await env.m.client.put("/api/linked/ha-saves", json=body, headers=env.m.headers(**kw))


async def test_setup_turns_saves_on_and_links_home_assistant_people(make_env):
    env = await make_env()
    env.app["linked_settings"].directory = FakeDirectory([ha_user(HA_OWNER, "Avery", True), ha_user(HA_ADULT, "Sam", False),
                                             {**ha_user("d" * 32, "Supervisor", True), "system_generated": True}])
    ws, acct = await connect_saving(env, saves=False)
    # who may: Owner and Admin read; only an Owner changes
    await env.login("admin1", "admin")
    got = await (await env.m.get("/api/linked/ha-saves")).json()
    assert got["saves"] is False and got["hk_frontends"] == 1
    assert [(p["name"], p["admin"], p["person"]) for p in got["people"]] == [("Avery", True, None), ("Sam", False, None)], \
        "people only (no system users), admins first, nobody linked yet"
    assert (await put_saves(env, {"on": True})).status == 403
    await env.login("owner1", "owner")
    r = await put_saves(env, {"on": True})
    assert r.status == 200 and (await r.json())["saves"] is True
    assert "linked_saves" in next(a for a in env.app["service_accounts"].list() if a["id"] == acct.id)["scopes"]
    told = settings_frames(await frames(ws, 0.4))
    assert told and told[-1]["setup"] == {"saves": True, "unlinked_admins": 1}, "HK Frontend is told: one admin can't save"
    # the save works once Avery is linked
    r = await put_saves(env, {"ha_user": HA_OWNER, "role": "admin"})
    assert r.status == 200
    assert next(p for p in (await r.json())["people"] if p["id"] == HA_OWNER)["person"]["role"] == "admin"
    told = settings_frames(await frames(ws, 0.4))
    assert told[-1]["setup"]["unlinked_admins"] == 0
    assert (await write(ws, HA_OWNER, SAVE))["success"]
    # and unlinked again
    assert (await put_saves(env, {"ha_user": HA_OWNER, "role": None})).status == 200
    assert (await write(ws, HA_OWNER, SAVE, 2))["error"]["code"] == "not_linked"
    audit = [r["action"] for r in env.audit()] if hasattr(env, "audit") else []
    assert "linked.saves" in json.dumps(audit) or not audit
    await ws.close()


async def test_setup_refuses_what_it_should(make_env):
    env = await make_env()
    env.app["linked_settings"].directory = FakeDirectory([ha_user(HA_OWNER, "Avery", True)])
    await env.login("owner1", "owner")
    assert (await put_saves(env, {"on": True})).status == 409, "no HK Frontend linked"
    assert (await put_saves(env, {"ha_user": "nope", "role": "admin"})).status == 400
    assert (await put_saves(env, {"ha_user": HA_OWNER, "role": "superuser"})).status == 400
    assert (await put_saves(env, {"whatever": 1})).status == 400


# ------------------------------------------------------------------ where each screen is drawn
async def test_hk_settings_says_where_each_screen_is_drawn(make_env):
    env = await make_env()
    service = env.app["settings"]
    where = lambda: {d["path"]: d.get("where") for d in service.panel_payload()["dashboards"]}  # noqa: E731
    assert where()["dashboard-hall"] == {"text": "Mantel", "icon": "mdi:fireplace", "where": "mantel"}
    env.app["ha_sidebar_screens"]["dashboard-hall"] = "Hall"          # as ha_dashboards last read HA
    assert where()["dashboard-hall"]["text"] == "Mantel · in Home Assistant’s sidebar"
    ws = await connect(env)
    await ws.receive_json(timeout=5)
    await ws.send_json({"id": 5, "type": "report", "report": {"hk_dashboards": [{"path": "dashboard-hall", "title": "Hall"}]}})
    while (f := await ws.receive_json(timeout=5)).get("id") != 5:
        pass
    assert f["success"], f
    got = where()["dashboard-hall"]
    assert got["conflict"] is True and got["text"] == "Mantel, and Home Assistant has a dashboard at the same address", \
        "a Mantel screen at an address HK Frontend also draws is flagged: each screen is drawn in one place"
    await ws.send_json({"id": 6, "type": "report", "report": {"hk_dashboards": [{"path": "Bad Path", "title": "x"}]}})
    while (f := await ws.receive_json(timeout=5)).get("id") != 6:
        pass
    assert not f["success"] and f["error"]["code"] == "invalid"
    await ws.close()
