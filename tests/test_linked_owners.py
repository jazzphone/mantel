"""Linked mode's per-tablet ownership (mantel_server/linked_owners.py; CUTOVER.md §1 Option A) and the
rest of linked mode's handlers on Mantel (mantel_server/linked_house.py): every tablet Home
Assistant's by default, an Owner's move (audited first, told to linked HA at once, entities published
or withdrawn in line), the rules, a restart, the forwarding decision both ways, notify, Seasonal
decorations, the Alarm PIN through the gateway (the house Alarm PIN only, decision 25; commands off:
nothing sent), and Live TV's entities. A FICTIONAL house; fakes only."""
import json

import pytest

import gateway_fakes as GF
from mantel_server import linked_owners as LO
from mantel_server.linked_owners import LinkedOwners, OwnershipError
from test_features import ENTRY, TABLET, UID, build, events, linked_ws, make_env, next_event  # noqa: F401

LINKED_ON = {"linked": {"enabled": True, "entry_id": ENTRY}}
TARGET = [{"entity_id": "switch.hall_black_screen", "unique_id": UID["black_screen"]}]
ALARM_ITEM = "01JFICTIONALALARMPINITEM00"
ALARM_PANEL = "alarm_control_panel.house_alarm_pin"
LIVE = "01JFICTIONALLIVETVITEM0000"


async def put(env, unit, owner, **kw):
    return await env.m.client.put("/api/linked/owners", json={"unit": unit, "owner": owner},
                                  headers=env.m.headers(**kw))


async def frames_until(lk, test, limit=20):
    got = []
    for _ in range(limit):
        f = await lk.ws.receive_json(timeout=3)
        got.append(f)
        if test(f):
            return got
    raise AssertionError(got)


# ------------------------------------------------------------------------------- default: HA's
async def test_every_tablet_is_home_assistant_s_until_an_owner_moves_it(make_env):
    env = await make_env(settings={**LINKED_ON, "sleep": {"enabled": True}}, owned=(),
                         tablet={**TABLET, "sleep": {**TABLET["sleep"], "decided_by": "hk"}})
    owners = env.app["linked_owners"]
    assert owners.snapshot() == {"house": "ha", "tablets": [], "bridge": "hk_frontend"} and not owners.owns("hall")
    lk, hello = await linked_ws(env)
    assert hello["owners"] == {"house": "ha", "tablets": [], "bridge": "hk_frontend"}
    assert hello["entities"] == [], "nothing published for a tablet HA owns"
    assert env.host.engines == {}, "and Mantel's Sleep Screen never drives a kiosk HA's engine drives"
    # the forwarding decision on Mantel's side: a tablet HA owns is not Mantel's to answer for
    res, _ = await lk.call(1, type="call_service", service="set_black_screen", data={"black": True}, targets=TARGET)
    assert res["error"]["code"] == "unknown_target"
    from mantel_server.linked import LinkedError
    with pytest.raises(LinkedError) as e:
        env.host.linked_index[UID["black_screen"]] = ("hall", "black_screen")       # even if it were indexed
        await env.host.linked.call_service("set_black_screen", {"black": True}, TARGET, None)
    assert e.value.code == "not_owned"
    assert env.audit() == []
    await lk.ws.close()


# ------------------------------------------------------------------------------- an Owner's move
async def test_an_owner_moves_a_tablet_audited_and_linked_ha_is_told_first(make_env):
    env = await make_env(settings=LINKED_ON, owned=())
    lk, hello = await linked_ws(env)
    assert hello["entities"] == []
    # who may: Owner/Admin read; only an Owner moves
    await env.login("adult1", "adult")
    assert (await env.m.get("/api/linked/owners")).status == 403
    assert (await put(env, "hall", "mantel")).status == 403
    await env.login("admin1", "admin")
    assert (await env.m.get("/api/linked/owners")).status == 200
    assert (await put(env, "hall", "mantel")).status == 403
    await env.login("owner1", "owner")
    assert (await put(env, "hall", "mantel", tunnel=True)).status in (401, 403), "LAN only"
    await env.login("owner1", "owner")              # the tunnel request ended that session
    r = await put(env, "hall", "mantel")
    body = await r.json()
    assert r.status == 200 and body["changed"] is True and body["wire"] == {"house": "ha", "tablets": ["hall"], "bridge": "hk_frontend"}
    assert [t for t in body["tablets"] if t["unit"] == "hall"][0]["owner"] == "mantel"
    # audited: a config row naming the Owner, the unit, from and to
    row = env.audit(kind="config")[-1]
    assert row["action"] == "linked.owner" and row["role"] == "owner" and row["decision"] == "allowed"
    assert json.loads(row["target"]) == {"unit": "hall", "from": "ha", "to": "mantel"}
    # linked HA hears `owners` first, then the tablet's four entities
    got = await frames_until(lk, lambda f: f["type"] == "entity" and f["entity"]["unique_id"] == UID["sleep_screen"])
    assert got[0] == {"type": "owners", "owners": {"house": "ha", "tablets": ["hall"], "bridge": "hk_frontend"}}
    assert {f["entity"]["unique_id"] for f in got if f["type"] == "entity"} == set(UID.values())
    assert all(f["entity"]["tablet"] == "hall" for f in got if f["type"] == "entity")
    # and now Mantel answers for it
    res, before = await lk.call(1, type="call_service", service="set_black_screen", data={"black": True},
                                targets=TARGET)
    assert res["success"] and before[0]["state"] == "on"
    # a second identical move changes nothing and writes nothing
    n = len(env.audit(kind="config"))
    assert (await (await put(env, "hall", "mantel")).json())["changed"] is False
    assert len(env.audit(kind="config")) == n
    # back to HA: told first, the entities withdrawn WITHOUT forgetting (HA keeps its registry entries)
    r = await put(env, "hall", "ha")
    assert r.status == 200
    got = await frames_until(lk, lambda f: f["type"] == "removed" and f["unique_id"] == UID["sleep_screen"])
    assert got[0] == {"type": "owners", "owners": {"house": "ha", "tablets": [], "bridge": "hk_frontend"}}
    assert all(f.get("forget") is False for f in got if f["type"] == "removed")
    res, _ = await lk.call(2, type="call_service", service="set_black_screen", data={"black": False}, targets=TARGET)
    assert res["error"]["code"] == "unknown_target"
    await lk.ws.close()


async def test_the_rules_keep_the_entry_whole(make_env):
    env = await make_env(settings=LINKED_ON, owned=())
    await env.login("owner1", "owner")
    for unit, owner, code in (("house", "mantel", "tablets_first"), ("attic", "mantel", "unknown_tablet"),
                              ("hall", "maybe", "invalid")):
        r = await put(env, unit, owner)
        assert r.status == 400 and (await r.json())["error"]["code"] == code, (unit, owner)
    assert (await put(env, "hall", "mantel")).status == 200
    assert (await put(env, "house", "mantel")).status == 200, "every tablet Mantel's: the rest may follow"
    r = await put(env, "hall", "ha")
    assert r.status == 400 and (await r.json())["error"]["code"] == "house_first"
    owners = env.app["linked_owners"]
    assert owners.house() and owners.owns("hall") and owners.snapshot() == {"house": "mantel", "tablets": ["hall"], "bridge": "hk_frontend"}
    assert [json.loads(r["target"]) for r in env.audit(kind="config")] == [
        {"unit": "hall", "from": "ha", "to": "mantel"}, {"unit": "house", "from": "ha", "to": "mantel"}]


def test_the_store_alone(tmp_path):
    import sqlite3
    conn = sqlite3.connect(tmp_path / "o.db")
    conn.row_factory = sqlite3.Row
    LO.ensure_schema(conn)
    LO.ensure_schema(conn)                       # idempotent
    events_ = []

    class Audit:
        def config_event(self, ev):
            events_.append(ev)
    o = LinkedOwners(conn, lambda: 100.0, lambda: {"loft": "Loft", "hall": "Hall"}, Audit())
    assert o.owner("loft") == "ha" and not o.owns(None) and not o.owns("")
    assert o.set("loft", "mantel", by="u1", role="owner") is True
    assert events_ == [{"timestamp": 100.0, "actor": "u1", "role": "owner", "action": "linked.owner",
                        "detail": {"unit": "loft", "from": "ha", "to": "mantel"}}]
    with pytest.raises(OwnershipError):
        o.set("house", "mantel")
    rep = o.report()
    assert [(t["unit"], t["owner"]) for t in rep["tablets"]] == [("hall", "ha"), ("loft", "mantel")]
    o.remember("x", {"a": 1})
    assert o.remembered("x") == {"a": 1} and o.remembered("y") is None
    conn.close()


# ------------------------------------------------------------------------------- restart
async def test_ownership_survives_a_restart(tmp_path, monkeypatch, make_env):
    env = await make_env(settings=LINKED_ON, owned=())
    await env.login("owner1", "owner")
    assert (await put(env, "hall", "mantel")).status == 200
    # a second server on the same database (as after a restart), nobody moving anything
    from aiohttp.test_utils import TestClient, TestServer
    app2, store2, *_ = await build(tmp_path, monkeypatch, settings=LINKED_ON, owned=())
    async with TestClient(TestServer(app2)) as client:
        assert app2["linked_owners"].owns("hall")
        _acct, token = app2["service_accounts"].create("home-assistant-2", ["linked"])
        ws = await client.ws_connect("/linked/ws", headers={"Authorization": f"Bearer {token}"})
        hello = await ws.receive_json(timeout=5)
        assert hello["owners"] == {"house": "ha", "tablets": ["hall"], "bridge": "hk_frontend"}
        assert {e["unique_id"] for e in hello["entities"]} == set(UID.values())
        await ws.close()
    store2.db.close()


# ------------------------------------------------------------------------------- notify
async def test_notify_reaches_mantel_s_screens_and_wakes_its_engines(make_env):
    env = await make_env(settings={**LINKED_ON, "notifications": {"enabled": True},
                                   "sleep": {"enabled": True}},
                         tablet={**TABLET, "sleep": {**TABLET["sleep"], "decided_by": "shadow"}})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await events(env, ws)
    lk, _ = await linked_ws(env)
    res, _ = await lk.call(1, type="call_service", service="notify",
                           data={"title": "Laundry", "message": "The washer is done.", "wake": True, "important": True,
                                 "dashboards": [], "users": []})
    assert res["success"] and res["result"]["snap"] is False
    ev = await next_event(ws)
    assert ev["type"] == "notification" and ev["title"] == "Laundry" and ev["message"] == "The washer is done."
    assert env.host.engines["hall"].facts_now.get("notice") == "Laundry", "Wakes the Screen"
    assert env.audit() == [], "a banner is Mantel's own: no house command"
    await ws.close()
    await lk.ws.close()


async def test_notify_with_mantel_s_notifications_off_is_not_set_up(make_env):
    env = await make_env(settings=LINKED_ON)
    lk, _ = await linked_ws(env)
    res, _ = await lk.call(1, type="call_service", service="notify", data={"title": "x"})
    assert res["error"]["code"] == "not_set_up"
    await lk.ws.close()


# ------------------------------------------------------------------------------- the rest of the entry
HA_REGISTRY = [
    {"entity_id": "switch.hk_frontend_seasonal_decorations", "platform": "hk_frontend",
     "unique_id": f"{ENTRY}_seasonal_decorations", "config_entry_id": ENTRY},
    {"entity_id": ALARM_PANEL, "platform": "hk_frontend", "unique_id": ALARM_ITEM, "config_entry_id": ENTRY,
     "original_name": None},
    {"entity_id": "sensor.tv_viewers", "platform": "hk_frontend", "unique_id": f"{LIVE}_viewers",
     "config_entry_id": ENTRY, "original_name": "TV viewers"},
    {"entity_id": "sensor.tv_wnbc_now", "platform": "hk_frontend", "unique_id": f"{LIVE}_4.1_now",
     "config_entry_id": ENTRY, "original_name": "TV WNBC now"},
    {"entity_id": "camera.tv_wnbc", "platform": "hk_frontend", "unique_id": f"{LIVE}_4.1_camera",
     "config_entry_id": ENTRY, "original_name": "TV WNBC"},
    {"entity_id": "switch.someone_elses", "platform": "other", "unique_id": "x"},
]


async def house_env(make_env, commands=False):
    env = await make_env(commands=commands, settings=LINKED_ON)
    hub = env.app["hub"]
    from test_features import AREAS, DEVICES, ENTITIES
    hub.registry.load(AREAS, DEVICES, ENTITIES + HA_REGISTRY)
    hub.store.apply_event({"a": {ALARM_PANEL: {"s": "armed_away", "lc": 1.0, "a": {
        "protects": "alarm_control_panel.house", "code_arm_required": True, "code_format": "number"}}}})
    hub.store.apply_event({"c": {"alarm_control_panel.house": {"+": {"s": "armed_away", "lc": 2.0, "a": {
        "supported_features": 3, "changed_by": "Keypad"}}}}})
    await env.login("owner1", "owner")
    assert (await put(env, "house", "mantel")).status == 200
    return env


async def test_the_rest_of_the_entry_is_published_only_while_mantel_owns_it(make_env):
    env = await house_env(make_env)
    reg = env.app["linked"].registry
    seasonal = reg.get(f"{ENTRY}_seasonal_decorations")
    assert (seasonal["entity_id"], seasonal["state"], seasonal["tablet"]) == \
        ("switch.hk_frontend_seasonal_decorations", "on", None)
    alarm = reg.get(ALARM_ITEM)
    assert (alarm["entity_id"], alarm["state"], alarm["available"]) == (ALARM_PANEL, "armed_away", True)
    assert alarm["features"] == {"supported_features": 3, "code_format": "number", "code_arm_required": True}
    assert alarm["attributes"] == {"protects": "alarm_control_panel.house", "changed_by": "Keypad"}
    assert reg.get(f"{LIVE}_viewers")["state"] == 0
    now = reg.get(f"{LIVE}_4.1_now")
    assert (now["entity_id"], now["name"], now["state"]) == ("sensor.tv_wnbc_now", "TV WNBC now", "Live")
    cam = reg.get(f"{LIVE}_4.1_camera")
    assert cam["available"] is False and cam["features"] == {}, "no stream on Mantel yet: never a wrong picture"
    assert reg.get("x") is None, "only hk_frontend's own entities"
    # the protected alarm changes in the house: the panel follows
    env.app["hub"].store.apply_event({"c": {"alarm_control_panel.house": {"+": {"s": "disarmed", "lc": 3.0}}}})
    env.app["hub"].ha.on_change({"alarm_control_panel.house"})
    from test_features import until
    assert await until(lambda: reg.get(ALARM_ITEM)["state"] == "disarmed")
    # what was learned is remembered (a restart while HA mirrors them still knows the protected alarm)
    assert env.app["linked_owners"].remembered("alarm_pin")["protects"] == "alarm_control_panel.house"
    # house back to HA: withdrawn, not forgotten
    assert (await put(env, "house", "ha")).status == 200
    assert reg.get(ALARM_ITEM) is None and reg.get(f"{ENTRY}_seasonal_decorations") is None


async def test_seasonal_decorations_from_ha_is_mantel_s_setting(make_env):
    env = await house_env(make_env)
    lk, _ = await linked_ws(env)
    res, before = await lk.call(1, type="entity_command", unique_id=f"{ENTRY}_seasonal_decorations",
                                command="turn_off", data={})
    assert res["success"] and res["result"] == {"on": False}
    assert any(f["type"] == "state" and f["state"] == "off" for f in before), "the state before the answer"
    st = env.app["settings"].store
    assert st.body("house", "settings")["sky"]["decorations"] is False
    assert st.history("house", "settings")[0]["actor"].startswith("linked:"), "versioned, the Service account as author"
    assert env.audit(kind="service") == [], "HK's own setting, not a house command"
    await lk.ws.close()


HOUSE_CODE, HA_CODE, PROTECTED = "8642", "HA-own-code-5150", "alarm_control_panel.house"


async def _pins(env):
    """People with their own PINs (which are NOT alarm codes since decision 25)."""
    db = env.app["accounts"].db
    for username, role, pin in (("adult1", "adult", "2580"), ("child1", "child", "1397")):
        await env.login(username, role)
        uid = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()["id"]
        await env.app["pins"].set_pin(uid, pin)


async def _house(env):
    """The house Alarm PIN, set by an Owner in Mantel (HK Settings -> Alarm PIN)."""
    await env.app["alarm_pin"].set(ALARM_PANEL, forward_to=PROTECTED, pin=HOUSE_CODE, pin_again=HOUSE_CODE)




async def _disarm(lk, mid, code=None, command="alarm_disarm"):
    res, _ = await lk.call(mid, type="entity_command", unique_id=ALARM_ITEM, command=command,
                           data={"code": code} if code is not None else {})
    return res


async def test_the_alarm_needs_a_code_and_commands_off_send_nothing(make_env):
    env = await house_env(make_env)
    await _pins(env)
    lk, _ = await linked_ws(env)
    # one path: the linked panel got an Alarm PIN row from HA's registry (tablets off, no house code)
    row = env.app["alarm_pin"].entry(ALARM_PANEL)
    assert (row.forward_to, row.tablets, row.house_code, row.arm_required) == (PROTECTED, False, False, True)
    cfg = [r for r in env.audit(kind="config") if r["action"] == "alarm_pin.linked"]
    assert len(cfg) == 1 and json.loads(cfg[0]["target"])["forward_to"] == PROTECTED
    res = await _disarm(lk, 1)
    assert res["error"] == {"code": "code_required", "message": "Enter the alarm code"}
    res = await _disarm(lk, 2, "2580")
    assert res["error"]["code"] == "alarm_pin_not_set", "no house Alarm PIN yet: a person's PIN does not stand in"
    await _house(env)
    res = await _disarm(lk, 3, "0000")
    assert res["error"] == {"code": "invalid_code", "message": "Wrong code"}
    res = await _disarm(lk, 4, "2580")
    assert res["error"]["code"] == "invalid_code", "a person's own PIN is not the alarm's code"
    res = await _disarm(lk, 5, HOUSE_CODE)
    assert res["error"]["code"] == "commands_disabled" and "nothing was sent" in res["error"]["message"], res
    row = env.audit(action="alarm_control_panel.alarm_disarm")[-1]
    assert (row["actor"], row["decision"], row["reason"], row["result"]) == \
        ("mantel:linked", "denied", "commands_disabled", "not_sent"), "audited, nothing sent"
    assert json.loads(row["target"]) == [ALARM_PANEL, PROTECTED]
    assert env.app["commander"] is None
    for secret in ("2580", HOUSE_CODE):
        assert secret not in json.dumps(env.audit()) and secret not in json.dumps(env.app["linked_house"].status())
    await lk.ws.close()


async def test_the_alarm_through_the_gateway_takes_only_the_house_code(make_env):
    env = await house_env(make_env, commands=True)
    await _pins(env)
    lk, _ = await linked_ws(env)
    await _house(env)
    for mid, pin in ((1, "1397"), (2, "2580")):                       # people's own PINs: wrong codes
        res = await _disarm(lk, mid, pin)
        assert res["error"]["code"] == "invalid_code" and env.fake.sent == [], res
    res = await _disarm(lk, 3, HOUSE_CODE)
    assert res["success"] and res["result"]["command"] == "alarm_disarm"
    assert env.fake.sent == ["alarm_control_panel.alarm_disarm"]
    assert env.fake.frames[0]["service_data"] == {"entity_id": PROTECTED}, "the alarm itself; no code"
    row = env.audit(action="alarm_control_panel.alarm_disarm", decision="allowed")[0]
    assert (row["actor"], row["result"], row["step_up"]) == ("mantel:linked", "ok", "alarm_pin")
    await lk.ws.close()


async def test_the_house_code_works_in_linked_mode_as_at_a_tablet(make_env):
    env = await house_env(make_env, commands=True)
    await env.app["alarm_pin"].set(ALARM_PANEL, pin=HOUSE_CODE, pin_again=HOUSE_CODE)
    lk, _ = await linked_ws(env)
    res = await _disarm(lk, 1, HOUSE_CODE)
    assert res["success"], res
    assert env.fake.frames[-1]["service_data"] == {"entity_id": PROTECTED}
    row = env.audit(action="alarm_control_panel.alarm_disarm", decision="allowed")[-1]
    assert (row["actor"], row["step_up"], row["result"]) == ("mantel:linked", "alarm_pin", "ok")
    assert HOUSE_CODE not in json.dumps(env.audit())
    await lk.ws.close()


async def test_the_typed_code_is_never_the_alarm_s_own_code(make_env):
    env = await house_env(make_env, commands=True)
    await _pins(env)
    # the protected alarm asks for a code of its own
    env.app["hub"].store.apply_event({"c": {PROTECTED: {"+": {"s": "armed_away", "lc": 4.0, "a": {
        "supported_features": 3, "code_format": "number"}}}}})
    lk, _ = await linked_ws(env)
    await _house(env)
    res = await _disarm(lk, 1, HOUSE_CODE)
    assert res["error"]["code"] == "alarm_ha_code_missing" and env.fake.sent == [], \
        "no code held by Mantel: refused, the Alarm PIN is NOT passed on"
    await env.app["alarm_pin"].set(ALARM_PANEL, ha_code=HA_CODE)
    res = await _disarm(lk, 2, HOUSE_CODE)
    assert res["success"], res
    assert env.fake.frames[-1]["service_data"] == {"entity_id": PROTECTED, "code": HA_CODE}, \
        "only Mantel's stored code for the alarm, never the typed PIN"
    assert all(HOUSE_CODE not in json.dumps(f) for f in env.fake.frames)
    assert HA_CODE not in json.dumps(env.audit()) and HOUSE_CODE not in json.dumps(env.audit())
    await lk.ws.close()


async def test_wrong_codes_lock_the_linked_keypad(make_env):
    from mantel_server.pins import LOCK_AFTER
    env = await house_env(make_env, commands=True)
    await _pins(env)
    lk, _ = await linked_ws(env)
    await _house(env)
    for n in range(LOCK_AFTER - 1):
        assert (await _disarm(lk, n + 1, "0000"))["error"]["code"] == "invalid_code"
    assert (await _disarm(lk, 98, "0000"))["error"]["code"] == "code_locked", "the 5th wrong one locks"
    res = await _disarm(lk, 99, HOUSE_CODE)
    assert res["error"]["code"] == "code_locked" and "locked" in res["error"]["message"], \
        "locked: even a right PIN is refused"
    assert env.fake.sent == []
    assert env.audit(action="alarm_control_panel.alarm_disarm")[-1]["reason"] == "alarm_code_locked"
    await lk.ws.close()


async def test_mantel_s_alarm_pin_row_decides_which_alarm(make_env):
    env = await house_env(make_env, commands=True)
    await _pins(env)
    other = "alarm_control_panel.garage"
    env.app["hub"].store.apply_event({"a": {other: {"s": "disarmed", "lc": 5.0, "a": {"supported_features": 3}}}})
    await env.app["alarm_pin"].set(ALARM_PANEL, forward_to=other)        # an Owner's setting
    await env.app["linked_house"].refresh()
    reg = env.app["linked"].registry
    assert reg.get(ALARM_ITEM)["attributes"]["protects"] == other and reg.get(ALARM_ITEM)["state"] == "disarmed", \
        "the mirror follows the alarm commands go to"
    lk, _ = await linked_ws(env)
    await env.app["alarm_pin"].set(ALARM_PANEL, pin=HOUSE_CODE, pin_again=HOUSE_CODE)
    assert (await _disarm(lk, 1, HOUSE_CODE, command="alarm_arm_away"))["success"]
    assert env.fake.frames[-1]["service_data"] == {"entity_id": other}
    # a row pointing at the panel itself would loop through HA: refused, nothing sent
    await env.app["alarm_pin"].set(ALARM_PANEL, forward_to=ALARM_PANEL)
    assert (await _disarm(lk, 2, HOUSE_CODE))["error"]["code"] == "not_set_up"
    assert env.fake.sent == ["alarm_control_panel.alarm_arm_away"]
    await lk.ws.close()
