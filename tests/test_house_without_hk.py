"""The house without HK Frontend (docs/phase9/MANTEL-LINK.md "Parity"; docs/phase9/NO-HK-FRONTEND.md): Mantel publishes
the Alarm PIN panels of its OWN keypad table (one HK Frontend had keeps its unique id, so its entity id moves with the
registry hand-over; one Mantel made gets its own), a PIN removed in HK Settings stays removed, the page's "paused
until" feed is Mantel's, and nothing moves back to Home Assistant once HK Frontend is gone from it. A FICTIONAL
house; fakes only."""
import types

from mantel_server import linked_actions as LA
from mantel_server.linked_owners import OwnershipError, back_to_ha_check
from test_features import ENTRY, make_env  # noqa: F401 -- the fixture
from test_linked_owners import ALARM_ITEM, ALARM_PANEL, house_env, put

import gateway_fakes as GF

HOUSE_ALARM = "alarm_control_panel.house"


async def test_a_keypad_made_in_mantel_is_published_with_its_own_unique_id(make_env):
    env = await house_env(make_env)
    reg = env.app["linked"].registry
    assert reg.get(ALARM_ITEM)["entity_id"] == ALARM_PANEL, "HK Frontend's panel keeps its unique id"
    pins = env.app["alarm_pin"]
    await pins.set("alarm_control_panel.garage_alarm_pin", forward_to=HOUSE_ALARM, pin="2468", pin_again="2468")
    await env.app["linked_house"].refresh()
    uid = f"{ENTRY}_alarm_pin_garage_alarm_pin"
    got = reg.get(uid)
    assert got is not None and got["entity_id"] == "alarm_control_panel.garage_alarm_pin"
    assert got["attributes"]["protects"] == HOUSE_ALARM and got["platform"] == "alarm_control_panel"
    assert env.app["linked_house"].kinds[uid][0] == "alarm", "its arm/disarm take the one alarm path"
    # a row that is the alarm itself (Mantel guarding it directly) is never a panel of its own
    await pins.set(HOUSE_ALARM, forward_to=HOUSE_ALARM)
    await env.app["linked_house"].refresh()
    assert all(d["entity_id"] != HOUSE_ALARM for d in env.app["linked_house"].descs.values())


async def test_a_pin_removed_in_hk_settings_stays_removed(make_env):
    env = await house_env(make_env)
    reg, house = env.app["linked"].registry, env.app["linked_house"]
    assert env.app["alarm_pin"].entry(ALARM_PANEL) is not None, "made once from HA's registry"
    env.app["alarm_pin"].remove(ALARM_PANEL)
    await house.refresh()
    await house.refresh()
    assert env.app["alarm_pin"].entry(ALARM_PANEL) is None, "not made again from HA's registry"
    assert reg.get(ALARM_ITEM) is None, "and no longer published"


async def test_a_panel_another_integration_has_is_never_published_over(make_env):
    env = await house_env(make_env)
    hub = env.app["hub"]
    hub.registry.entity_entries.append({"entity_id": "alarm_control_panel.someone_elses", "platform": "other",
                                        "unique_id": "zz"})
    await env.app["alarm_pin"].set("alarm_control_panel.someone_elses", forward_to=HOUSE_ALARM)
    await env.app["linked_house"].refresh()
    assert all(d["entity_id"] != "alarm_control_panel.someone_elses"
               for d in env.app["linked_house"].descs.values())


# -- the snooze feed ------------------------------------------------------------------------------------------------
async def test_the_paused_until_feed_is_mantels(make_env):
    env = await make_env()
    la = env.app["linked_actions"]
    la._keep({"automation.porch_lights": "2026-10-21T04:00:00+00:00", "automation.secret": "2026-10-21T04:00:00+00:00"})
    assert env.app["read_routes"][LA.SNOOZE_FEED] is not None
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "read_subscribe", "id": 3, "msg": {"type": LA.SNOOZE_FEED}})
    got = []
    while len(got) < 2:
        m = await GF.recv(ws)
        if m.get("id") == 3:
            got.append(m)
    first = next(m for m in got if m["type"] == "read_event")["event"]
    assert set(first["until"]) <= {"automation.porch_lights", "automation.secret"}
    la._keep({})
    while True:
        m = await GF.recv(ws)
        if m.get("type") == "read_event" and m.get("id") == 3:
            assert m["event"] == {"until": {}}
            break
    await ws.close()


# -- nothing goes back to Home Assistant once HK Frontend is gone ---------------------------------------------------
def _client(domain, report=None):
    return types.SimpleNamespace(domain=domain, protocol=2 if domain == "mantel" else 1, report=report or {},
                                 features=("bridge",))


def test_back_to_ha_only_while_hk_frontend_is_there():
    reg = types.SimpleNamespace(clients=[])
    reg.clients_of = lambda d: [c for c in reg.clients if c.domain == d]
    app = {"linked": types.SimpleNamespace(registry=reg)}
    back_to_ha_check(app)                                                  # nothing linked: nothing known, allowed
    reg.clients = [_client("mantel", {"hk_frontend": {"installed": True, "loaded": True, "linked": True}})]
    back_to_ha_check(app)
    reg.clients = [_client("mantel", {"hk_frontend": {"installed": False, "loaded": False, "linked": False}})]
    try:
        back_to_ha_check(app)
        raise AssertionError("allowed with no HK Frontend")
    except OwnershipError as e:
        assert e.code == "no_hk_frontend"
    reg.clients.append(_client("hk_frontend"))
    back_to_ha_check(app)                                                  # HK Frontend linked again


async def test_the_rest_api_refuses_a_move_back_with_no_hk_frontend(make_env, monkeypatch):
    env = await house_env(make_env)
    reg = env.app["linked"].registry
    gone = [_client("mantel", {"hk_frontend": {"installed": False}})]
    monkeypatch.setattr(reg, "clients_of", lambda d: gone if d == "mantel" else [])
    r = await put(env, "house", "ha")
    assert r.status == 400 and (await r.json())["error"]["code"] == "no_hk_frontend"
    assert env.app["linked_owners"].house()


async def test_what_hk_frontends_panel_protects_is_learned_before_the_house_moves(make_env):
    """HK Frontend shows `protects` only while it runs the panel; once `house` is Mantel's it unloads it. Mantel
    remembers it while Home Assistant still runs the house (read-only), so the keypad row is made right after."""
    from test_features import AREAS, DEVICES, ENTITIES
    from test_linked_owners import HA_REGISTRY, LINKED_ON
    env = await make_env(settings=LINKED_ON)
    hub = env.app["hub"]
    hub.registry.load(AREAS, DEVICES, ENTITIES + HA_REGISTRY)
    hub.store.apply_event({"a": {ALARM_PANEL: {"s": "disarmed", "lc": 1.0, "a": {"protects": HOUSE_ALARM}}}})
    await env.app["linked_house"].refresh()
    assert env.app["linked"].registry.get(ALARM_ITEM) is None, "nothing published while HA runs the house"
    assert env.app["linked_owners"].remembered("keypads")["panels"][ALARM_PANEL]["protects"] == HOUSE_ALARM
    # HK Frontend unloads its panel (the house moves): the attribute is gone
    hub.store.apply_event({"c": {ALARM_PANEL: {"+": {"s": "unavailable", "lc": 2.0, "a": {}}}}})
    hub.store.states[ALARM_PANEL]["a"] = {}
    await env.login("owner1", "owner")
    assert (await put(env, "house", "mantel")).status == 200
    row = env.app["alarm_pin"].entry(ALARM_PANEL)
    assert row is not None and row.forward_to == HOUSE_ALARM
    assert env.app["linked"].registry.get(ALARM_ITEM)["entity_id"] == ALARM_PANEL
