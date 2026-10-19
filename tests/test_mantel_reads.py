"""The two reads HK's pages send to HA that Mantel answers itself (readproxy.MANTEL_READS):
`config/entity_registry/get` (from the hub's registry copy) and `hk_frontend/hidden/get` (hidden.py over
Mantel's settings store and the hub's states/registries). RBAC on both; an entity the person may not view
reads exactly as one that does not exist; nothing reaches Home Assistant. Fictional data only."""
from __future__ import annotations

import json

import pytest
from aiohttp import web

from mantel_server import readproxy, settings_store as S
from mantel_server.connectors import Ctx, Hooks
from mantel_server.db import Database
from mantel_server.hidden import Hiding
from mantel_server.readproxy import MANTEL_READS, READ_ALLOWED, ROUTE_RULES, SERVER_ONLY_READS
from mantel_server.registry import Registry
from mantel_server.sessions import Identity, User
from mantel_server.state import StateStore


def ident(role):
    return Identity(User(f"{role}-id", role.title(), role, "hk"), None, "lan")


OWNER, ADMIN, ADULT, CHILD = (ident(r) for r in ("owner", "admin", "adult", "child"))

# --- a fictional house: a water heater (a climate entity, its area through its device) beside a real
# thermostat in the Den, a lamp and an outlet in the Den, a light in the Primary Bedroom, a group helper
AREAS = [{"area_id": "crawl", "name": "Crawl Space"}, {"area_id": "den", "name": "Den"},
         {"area_id": "primary", "name": "Primary Bedroom"}]
DEVICES = [{"id": "dev-heater", "area_id": "crawl"}, {"id": "dev-primary", "area_id": "primary"}]
ENTITIES = [
    {"entity_id": "climate.water_heater", "device_id": "dev-heater", "area_id": None},
    {"entity_id": "climate.downstairs", "device_id": None, "area_id": "den"},
    {"entity_id": "light.lamp", "device_id": None, "area_id": "den", "platform": "hue",
     "config_entry_id": "f1ct10nal", "id": "reg-1", "unique_id": "lamp-uid", "labels": ["evening"],
     "aliases": ["the lamp"], "capabilities": {"supported_color_modes": ["hs"]},
     "options": {"light": {"favorite_colors": [{"hs_color": [30, 80]}, {"color_temp_kelvin": 2700},
                                               {"rgb_color": [1, 2]},                       # wrong length: dropped
                                               {"hs_color": [1, 2], "access_token": "x"},   # extra key: dropped
                                               {"token": "abc"}, "nonsense"],
                           "access_token": "fictional-secret"},
                 "switch_as_x": {"entity_id": "light.secret_wrapper"},
                 "conversation": {"should_expose": True}}},
    {"entity_id": "switch.coffee", "device_id": None, "area_id": "den"},
    {"entity_id": "light.primary", "device_id": "dev-primary", "area_id": None,
     "options": {"light": {"favorite_colors": [{"hs_color": [200, 50]}]}}},
    {"entity_id": "binary_sensor.motion_kitchen", "platform": "group"},
]
STATES = {
    "climate.water_heater": {"s": "heat", "a": {"current_temperature": 120, "temperature": 120}},
    "climate.downstairs": {"s": "cool", "a": {"current_temperature": 72, "temperature": 70}},
    "light.lamp": {"s": "on", "a": {}},
    "switch.coffee": {"s": "off", "a": {}},
    "light.primary": {"s": "off", "a": {}},
    "binary_sensor.motion_kitchen": {"s": "off", "a": {"device_class": "motion",
                                                       "entity_id": ["binary_sensor.a", "binary_sensor.b"]}},
}
SETTINGS = {"generated": {"exclude_entities": ["light.primary"], "exclude_devices": ["dev-primary"],
                          "exclude_areas": ["crawl"]},
            "counts": {"thermostats": {"exclude": ["climate.water_heater"], "include": []}}}
ACCESSORIES = {"entities": {"light.lamp": {"status": False}, "light.primary": {"home": False}}, "rooms": {}}

# who may view what (RBAC's `view`): the adult and the admin are not given the Primary Bedroom
EVERYTHING = {e["entity_id"] for e in ENTITIES} | {"light.nonexistent"}
VIEW = {"owner": EVERYTHING, "admin": EVERYTHING - {"light.primary"},
        "adult": EVERYTHING - {"light.primary"}, "child": {"light.lamp"}}
ASKED: list = []


def may_read(identity, kind, ids):
    ASKED.append((identity.user.role, kind, tuple(ids)))
    return [i for i in ids if kind == "view" and i in VIEW.get(identity.user.role, set())] + ["light.widened"]


class FakeHub:
    def __init__(self):
        self.store, self.registry = StateStore(), Registry()
        self.registry.load(AREAS, DEVICES, ENTITIES)
        self.store.states.update({k: {**v, "lc": 1.0, "lu": 1.0} for k, v in STATES.items()})
        self.readproxy = None          # no Home Assistant: a read that tried to reach it would fail "unavailable"


@pytest.fixture
def env(tmp_path):
    db = Database(tmp_path / "mantel.db")
    with db.conn:
        for role in ("owner", "admin", "adult", "child"):
            db.conn.execute("INSERT INTO users (id, name, role, kind, created, updated) VALUES (?,?,?,?,1,1)",
                            (f"{role}-id", role.title(), role, "hk"))
    app, hub = web.Application(), FakeHub()
    readproxy.register(app, hub, Hooks(may_read=may_read))
    service = S.register(app, hub, S.SettingsHooks(may_configure=S.rbac_may_configure(clock=lambda: 1_000_000.0)),
                         conn=db.conn)
    service.store.write([("house", "settings", SETTINGS), ("house", "accessories", ACCESSORIES)],
                        actor=S.Actor(label="test"))
    ASKED.clear()
    yield type("Env", (), dict(app=app, hub=hub, service=service))
    db.close()


async def read(env, who, msg, rid=1):
    """One page `read` frame through readproxy's handler, as the page's socket sends it."""
    got = []

    async def send(m):
        got.append(m)
    await env.app["ws_handlers"]["read"](Ctx(send=send, identity=who), {"type": "read", "id": rid, "msg": msg})
    assert len(got) == 1
    return got[0]


# ------------------------------------------------------------------------------------------- rules
def test_every_mantel_read_has_exactly_one_rule_and_is_never_sent_to_ha(env):
    assert MANTEL_READS == set(ROUTE_RULES) == {"config/entity_registry/get", "hk_frontend/hidden/get"}
    assert not MANTEL_READS & set(READ_ALLOWED)          # never forwarded: not on the HA read allowlist
    assert not MANTEL_READS & SERVER_ONLY_READS
    assert MANTEL_READS <= set(env.app["read_routes"])
    for t in MANTEL_READS:
        with pytest.raises(readproxy.ReadBlocked):
            readproxy.check_read({"type": t})


# --------------------------------------------------------------------------- config/entity_registry/get
async def test_registry_get_gives_a_viewer_only_the_light_favourites(env):
    r = await read(env, ADULT, {"type": "config/entity_registry/get", "entity_id": "light.lamp"})
    assert r == {"type": "read_result", "id": 1, "result": {
        "entity_id": "light.lamp",
        "options": {"light": {"favorite_colors": [{"hs_color": [30, 80]}, {"color_temp_kelvin": 2700}]}}}}
    text = json.dumps(r)
    for leak in ("secret_wrapper", "fictional-secret", "token", "f1ct10nal", "lamp-uid", "evening", "den",
                 "hue", "should_expose", "capabilities"):
        assert leak not in text
    # a child who may view the lamp gets the same; an entity with no favourites answers its id alone
    assert (await read(env, CHILD, {"type": "config/entity_registry/get", "entity_id": "light.lamp"}))["result"] \
        == r["result"]
    assert (await read(env, ADULT, {"type": "config/entity_registry/get", "entity_id": "switch.coffee"}))["result"] \
        == {"entity_id": "switch.coffee"}


async def test_registry_get_hidden_and_nonexistent_read_the_same(env):
    hidden = await read(env, ADULT, {"type": "config/entity_registry/get", "entity_id": "light.primary"})
    missing = await read(env, ADULT, {"type": "config/entity_registry/get", "entity_id": "light.nonexistent"})
    never = await read(env, ADULT, {"type": "config/entity_registry/get", "entity_id": "light.no_such_thing"})
    assert hidden == missing == never == {"type": "read_result", "id": 1,
                                          "error": {"code": "not_found", "message": "Entity not found"}}
    # RBAC is asked about each, existing or not (no shortcut that would time differently)
    assert [a[2] for a in ASKED] == [("light.primary",), ("light.nonexistent",), ("light.no_such_thing",)]
    # the owner, who may view it, gets it
    owner = await read(env, OWNER, {"type": "config/entity_registry/get", "entity_id": "light.primary"})
    assert owner["result"] == {"entity_id": "light.primary",
                               "options": {"light": {"favorite_colors": [{"hs_color": [200, 50]}]}}}


@pytest.mark.parametrize("msg", [
    {"type": "config/entity_registry/get"},
    {"type": "config/entity_registry/get", "entity_id": ["light.lamp"]},
    {"type": "config/entity_registry/get", "entity_id": "Light.Lamp"},
    {"type": "config/entity_registry/get", "entity_id": "light.lamp", "name": "x"},
    {"type": "config/entity_registry/list"},
    {"type": "config/entity_registry/update", "entity_id": "light.lamp", "name": "x"},
])
async def test_registry_reads_other_than_one_get_are_refused(env, msg):
    r = await read(env, OWNER, msg)
    assert r["error"]["code"] == "not_allowed"


async def test_registry_get_never_needs_home_assistant(env):
    assert env.hub.readproxy is None
    r = await read(env, OWNER, {"type": "config/entity_registry/get", "entity_id": "light.lamp"})
    assert "result" in r


# ----------------------------------------------------------------------- hk_frontend/hidden/get: the port
def test_snapshot_matches_has_hiding_for_the_water_heater_case():
    """hosts/ha .../tests/py/test_hiding.py's house, through Mantel's copies."""
    hub = FakeHub()
    snap = Hiding(hub.store, hub.registry).snapshot(
        {"counts": {"thermostats": {"exclude": ["climate.water_heater"], "include": []}}})
    assert snap["can"]["climate.water_heater"][:2] == ["home", "room"]      # its room through its DEVICE's area
    assert "thermostats" in snap["can"]["climate.water_heater"]
    assert snap["off"]["climate.water_heater"] == ["thermostats"]
    assert snap["places"]["thermostats"][0] == "Climate"
    assert "climate.downstairs" not in snap["off"]
    assert snap["also"] == {}                                                 # only for the ones asked about


def test_snapshot_include_in_status_off_and_also_counted():
    hub = FakeHub()
    h = Hiding(hub.store, hub.registry)
    snap = h.snapshot({"accessories": {"entities": {"light.lamp": {"status": False}}}},
                      ["light.lamp", "switch.coffee"])
    assert snap["off"] == {"light.lamp": ["lights"]}
    assert set(snap["can"]) == {"light.lamp", "switch.coffee"}
    assert snap["also"]["switch.coffee"] == ["lights", "fans", "valves"]
    assert "lights" not in snap["also"].get("light.lamp", [])
    added = h.snapshot({"counts": {"lights": {"exclude": [], "include": ["switch.coffee"]}}}, ["switch.coffee"])
    assert added["added"] == {"switch.coffee": ["lights"]} and "lights" not in added["can"]["switch.coffee"]


def test_snapshot_group_helper_is_offered_never_found_and_readings_only_to_reporters():
    hub = FakeHub()
    hub.store.states["sensor.cpu_t"] = {"s": "40", "a": {"device_class": "temperature"}, "lc": 1, "lu": 1}
    hub.store.states["sensor.grid_w"] = {"s": "40", "a": {"device_class": "power"}, "lc": 1, "lu": 1}
    snap = Hiding(hub.store, hub.registry).snapshot({}, ["binary_sensor.motion_kitchen", "sensor.cpu_t", "sensor.grid_w"])
    assert "motion" in snap["also"]["binary_sensor.motion_kitchen"]
    assert "motion" not in snap["can"]["binary_sensor.motion_kitchen"]
    assert snap["also"].get("sensor.cpu_t") == ["temperature"] and "sensor.grid_w" not in snap["also"]


def test_snapshot_keeps_a_thermostats_readings_while_it_is_unavailable():
    hub = FakeHub()
    h = Hiding(hub.store, hub.registry)
    assert "temperature" in h.snapshot({}, ["climate.downstairs"])["can"]["climate.downstairs"]
    hub.store.states["climate.downstairs"] = {"s": "unavailable", "a": {}, "lc": 2, "lu": 2}
    assert "temperature" in h.snapshot({}, ["climate.downstairs"])["can"]["climate.downstairs"]


# ------------------------------------------------------------------- hk_frontend/hidden/get: the read
async def test_hidden_get_whole_house_for_the_owner(env):
    r = await read(env, OWNER, {"type": "hk_frontend/hidden/get"})
    snap = r["result"]
    assert snap["everywhere"] == ["light.primary"]
    assert snap["off"]["climate.water_heater"] == ["thermostats"]
    assert snap["off"]["light.lamp"] == ["lights"]                       # Include in Status off (accessories)
    assert snap["off"]["light.primary"] == ["home"]
    assert snap["devices"] == ["dev-primary"] and snap["areas"] == ["crawl"]
    assert "light.widened" not in json.dumps(snap)                      # a hook can never widen it


async def test_hidden_get_leaves_out_what_an_admin_may_not_view(env):
    snap = (await read(env, ADMIN, {"type": "hk_frontend/hidden/get"}))["result"]
    text = json.dumps(snap)
    assert "light.primary" not in text
    assert snap["everywhere"] == []
    assert snap["devices"] == []                       # its only entity is one the admin may not view
    assert snap["areas"] == ["crawl"]                  # the water heater, which the admin may view, is there
    assert snap["off"]["climate.water_heater"] == ["thermostats"]


async def test_hidden_get_hidden_and_nonexistent_read_the_same(env):
    def asked(eid):
        return {"type": "hk_frontend/hidden/get", "entity_ids": [eid]}
    hidden = (await read(env, ADMIN, asked("light.primary")))["result"]
    missing = (await read(env, ADMIN, asked("light.nonexistent")))["result"]
    never = (await read(env, ADMIN, asked("light.no_such_thing")))["result"]

    def without(snap, eid):
        return json.loads(json.dumps(snap).replace(eid, "X"))
    assert without(hidden, "light.primary") == without(missing, "light.nonexistent") \
        == without(never, "light.no_such_thing")
    assert hidden["can"] == {"light.primary": []} and hidden["off"] == {} and hidden["everywhere"] == []
    # the owner sees what hides it
    own = (await read(env, OWNER, asked("light.primary")))["result"]
    assert own["everywhere"] == ["light.primary"] and own["off"] == {"light.primary": ["home"]}


async def test_hidden_get_one_accessory_as_where_it_shows_asks(env):
    snap = (await read(env, ADMIN, {"type": "hk_frontend/hidden/get", "entity_ids": ["switch.coffee"]}))["result"]
    assert set(snap["can"]) == {"switch.coffee"} and snap["can"]["switch.coffee"] == ["home", "room"]
    assert snap["also"] == {"switch.coffee": ["lights", "fans", "valves"]}
    assert snap["order"][0] == "home" and set(snap["places"]) == set(snap["order"])


@pytest.mark.parametrize("who", [ADULT, CHILD])
async def test_hidden_get_needs_configure_on_settings(env, who):
    r = await read(env, who, {"type": "hk_frontend/hidden/get", "entity_ids": ["light.lamp"]})
    assert r["error"]["code"] == "forbidden"


async def test_hidden_get_without_a_person_is_refused(env):
    assert (await read(env, None, {"type": "hk_frontend/hidden/get"}))["error"]["code"] == "forbidden"


@pytest.mark.parametrize("msg", [
    {"type": "hk_frontend/hidden/get", "entity_ids": "light.lamp"},
    {"type": "hk_frontend/hidden/get", "entity_ids": ["not an id"]},
    {"type": "hk_frontend/hidden/get", "entity_ids": ["light.x"] * 501},
    {"type": "hk_frontend/hidden/get", "everywhere": True},
    {"type": "hk_frontend/hidden/set", "entity_ids": ["light.lamp"], "everywhere": True},
    {"type": "hk_frontend/hidden/also", "entity_ids": ["light.lamp"], "kinds": {"lights": True}},
])
async def test_hidden_get_malformed_and_the_writes_are_refused(env, msg):
    assert (await read(env, OWNER, msg))["error"]["code"] == "not_allowed"


async def test_hidden_get_changes_nothing(env):
    before = {k: d.version for k, d in env.service.store.docs("house").items()}
    await read(env, OWNER, {"type": "hk_frontend/hidden/get"})
    assert {k: d.version for k, d in env.service.store.docs("house").items()} == before


# ------------------------------------------------- hk_frontend/panel/get: HK Settings' Hidden Accessories
async def test_panel_get_carries_the_same_hidden_answer_cut_per_person(env):
    owner = (await read(env, OWNER, {"type": "hk_frontend/panel/get"}))["result"]["hidden"]
    assert owner == (await read(env, OWNER, {"type": "hk_frontend/hidden/get"}))["result"]
    assert owner["everywhere"] == ["light.primary"]
    admin = (await read(env, ADMIN, {"type": "hk_frontend/panel/get"}))["result"]["hidden"]
    assert "light.primary" not in json.dumps(admin) and admin["devices"] == []


# ------------------------------------------------- hk_frontend/setup/check: Mantel's own Setup Check
async def test_setup_check_is_answered_by_mantel_with_its_own_needs(env):
    """HK Settings' Setup Check on Mantel said "'hk_frontend/setup/check' is not an allowed read" (the house,
    2026-10-18). Mantel answers it itself, in the page's shape: HA and Music Assistant connections, Apple's font
    and glyphs, house commands, screens. Nothing is asked of Home Assistant."""
    env.service.store.write([("board", "dashboard-kitchen", {"menu": "auto"})], actor=S.Actor(label="test"))
    r = await read(env, OWNER, {"type": "hk_frontend/setup/check"})
    lines = r["result"]["lines"]
    assert all(set(ln) == {"ok", "title", "detail"} and ln["ok"] in (True, False, None) for ln in lines)
    titles = [ln["title"] for ln in lines]
    assert titles[0].startswith("Home Assistant") and titles[1].startswith("Music Assistant")
    assert "House Commands" in titles and lines[-1] == {"ok": True, "title": "Screens", "detail": "1 in Mantel."}
    assert not ASKED                                     # never forwarded to HA


@pytest.mark.parametrize("who", [ADULT, CHILD, None])
async def test_setup_check_needs_configure_on_settings(env, who):
    assert (await read(env, who, {"type": "hk_frontend/setup/check"}))["error"]["code"] == "forbidden"
