"""Phase 4 on Mantel (mantel_server/features.py): hk_core's features running in Mantel Server with
Mantel's House, against a full app on a temp database, a FICTIONAL house and fakes only. House
commands are off in every test here except where a FakeCommander stands in for Home Assistant
(it checks frames and tickets as HaCommander does and sends nothing anywhere)."""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

import gateway_fakes as GF
from conftest import Mantel
from mantel_server import features as F
from mantel_server.connectors import Hooks
from mantel_server.house import HouseCommandRefused, HouseCommandsDisabled
from mantel_server.settings_store import Actor

KIOSK = "0123456789abcdef0123456789abcdef"
KP = {"screen": "light.hall_kiosk_screen", "active": "switch.hall_kiosk_screensaver_active",
      "armed": "switch.hall_kiosk_screensaver", "mode": "select.hall_kiosk_screensaver_mode",
      "app": "sensor.hall_kiosk_foreground_app", "touched": "sensor.hall_kiosk_last_interaction",
      "front": "button.hall_kiosk_bring_to_front"}
MOTION, DOOR, VACUUM = "binary_sensor.hall_motion", "binary_sensor.front_door", "vacuum.robot"
AREAS = GF.HOUSE_AREAS + [{"area_id": "hall", "name": "Hall"}]
DEVICES = [{"id": KIOSK, "area_id": "hall", "name": "Hall Kiosk"}]
ENTITIES = GF.HOUSE_ENTITIES + [{"entity_id": e, "device_id": KIOSK, "platform": "kiosk_satellite"} for e in KP.values()] + [
    {"entity_id": MOTION, "area_id": "hall"}, {"entity_id": DOOR, "area_id": "porch"},
    {"entity_id": VACUUM, "area_id": "kitchen", "options": {"vacuum": {"area_mapping": {"kitchen": ["16"]}}}}]
STATES = {
    KP["screen"]: {"s": "on", "a": {"brightness": 174}, "lc": 1.0},
    KP["active"]: {"s": "off", "a": {}, "lc": 1.0}, KP["armed"]: {"s": "off", "a": {}, "lc": 1.0},
    KP["mode"]: {"s": "Black", "a": {}, "lc": 1.0}, KP["app"]: {"s": "me.jxl.kiosk_satellite", "a": {}, "lc": 1.0},
    KP["touched"]: {"s": "2026-01-01T00:00:00+00:00", "a": {}, "lc": 1.0}, KP["front"]: {"s": "unknown", "a": {}, "lc": 1.0},
    MOTION: {"s": "off", "a": {"device_class": "motion", "friendly_name": "Hall Motion"}, "lc": 1.0},
    DOOR: {"s": "off", "a": {"device_class": "door", "friendly_name": "Front Door"}, "lc": 1.0},
    VACUUM: {"s": "docked", "a": {"supported_features": 16384}, "lc": 1.0},
    "zone.home": {"s": "1", "a": {}, "lc": 1.0}, "sun.sun": {"s": "below_horizon", "a": {}, "lc": 1.0},
}
TABLET = {"name": "Hall", "screen": "dashboard-hall", "room": "hall", "user": "", "app": "kiosk_satellite",
          "device": KIOSK, "black_screen": "hk", "uid": "hall",
          "sleep": {"decided_by": "automation", "presence": [MOTION], "linger": 0}}
ENTRY = "e2e0entry0id"
UID = {k: f"{ENTRY}_hall_{k}" for k in ("black_screen", "photo_screensaver", "screen_in_use", "sleep_screen")}
DOOR_ITEM = {"id": "n_door", "entity": DOOR, "when": "on", "title": "", "message": ""}


class FakeProxy:
    def __init__(self, prefs):
        self.prefs, self.asked = prefs, []

    async def request(self, msg, **kw):
        self.asked.append(msg)
        return self.prefs

    async def close(self):
        pass


def own(app, *units):
    """The fixture's starting ownership (linked_owners.py): these units Mantel's. Not a move under test,
    so no audit row (the moves themselves are tested in test_linked_owners.py)."""
    owners = app["linked_owners"]
    audit, owners.audit = owners.audit, None
    try:
        for u in units:
            owners.set(u, "mantel", by="test")
    finally:
        owners.audit = audit


async def build(tmp_path, monkeypatch, *, commands=False, settings=None, tablet=None, hooks=None, popups=(),
                owned=("hall",)):
    app, store, now, fake = await GF.make(tmp_path, monkeypatch, commands=commands)
    hub = app["hub"]
    hub.registry.load(AREAS, DEVICES, ENTITIES)
    hub.store.apply_event({"a": {k: dict(v) for k, v in STATES.items()}})
    st = app["settings"].store
    docs = [("board", "dashboard-hall", {}), ("tablet", "hall", dict(tablet or TABLET)),
            ("house", "popups", {"items": [{"hash": h, "name": h.title()} for h in popups]})]
    if settings is not None:
        docs.append(("house", F.FEATURES_DOC, F.check_settings(settings)))
    st.write(docs, actor=Actor(label="test"))
    own(app, *owned)
    h = {"may_read": app["authz"].may_read, "tick": 3600.0, **(hooks or {})}
    host = F.register(app, hub, h)
    return app, store, now, fake, host


@pytest.fixture
async def make_env(tmp_path, monkeypatch):
    envs = []

    async def make(**kw):
        app, store, now, fake, host = await build(tmp_path, monkeypatch, **kw)
        client = TestClient(TestServer(app))
        await client.start_server()
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        env = GF.Env(Mantel(app, client, store, now, origin), fake)
        env.host = host
        envs.append((client, store))
        return env
    yield make
    for client, store in envs:
        await client.close()
        store.db.close()


async def until(test, timeout=3.0):
    t0 = asyncio.get_running_loop().time()
    while not test():
        if asyncio.get_running_loop().time() - t0 > timeout:
            return False
        await asyncio.sleep(0.02)
    return True


def change(app, eid, state, **attrs):
    hub = app["hub"]
    touched = hub.store.apply_event({"c": {eid: {"+": {"s": state, "lc": 2.0, **({"a": attrs} if attrs else {})}}}})
    hub.ha.on_change(touched)            # what HaClient calls: chained to the features


async def events(env, ws):
    await ws.send_json({"type": "read_subscribe", "id": 7, "msg": {"type": "hk_frontend/events/subscribe"}})
    got = await GF.recv(ws)
    assert got == {"type": "read_result", "id": 7, "result": None}, got


async def next_event(ws, timeout=3):
    while True:
        m = await GF.recv(ws, timeout)
        if m.get("type") == "read_event" and m.get("id") == 7:
            return m["event"]


class Linked:
    def __init__(self, env):
        self.env = env
        _acct, self.token = env.app["service_accounts"].create("home-assistant", ["linked"])

    async def connect(self):
        self.ws = await self.env.m.client.ws_connect("/linked/ws", headers={"Authorization": f"Bearer {self.token}"})
        return await self.ws.receive_json(timeout=5)

    async def call(self, mid, **body):
        await self.ws.send_json({"id": mid, **body})
        frames = []
        while True:
            m = await self.ws.receive(timeout=5)
            assert m.type == WSMsgType.TEXT
            f = json.loads(m.data)
            if f.get("type") == "result" and f.get("id") == mid:
                return f, frames
            frames.append(f)


async def linked_ws(env):
    # linked.py refuses any request with an Origin header: a client session without the browser one
    lk = Linked(env)
    env.m.client.session.headers.pop("Origin", None)
    hello = await lk.connect()
    env.m.client.session.headers["Origin"] = env.m.origin
    return lk, hello


# ----------------------------------------------------------------------------------- off by default
async def test_every_piece_is_off_until_the_settings_turn_it_on(make_env):
    env = await make_env()
    host = env.host
    assert host.status()["pieces"] == {p: False for p in F.PIECES}
    handler = env.app["linked"].handler
    assert type(handler).__name__ == "LinkedHandler" and handler.features is env.host.linked, \
        "linked mode's hook point is wired (notify and the house-level entities wrap FeatureLinked)"
    change(env.app, DOOR, "on")
    assert not host.notifier.sent and not host.engines and host.acting_entities() == set()
    with pytest.raises(Exception) as e:
        await host.linked.call_service("show_popup", {"popup": "x"}, [], None)
    assert getattr(e.value, "code", None) == "not_set_up"
    assert env.audit() == [] and env.fake is None


def test_the_settings_are_checked():
    assert F.check_settings(None) == F.DEFAULTS
    for bad in ({"music": {}}, {"sleep": {"enabled": "yes"}}, {"linked": {"entry_id": "a b"}},
                {"linked": {"backlights": {"hall": "switch.x"}}}, {"live_tv": {"guide_url": "file:///etc/passwd"}},
                {"notifications": {"items": [{"entity": DOOR}]}}, {"energy": {"options": []}}, {"sleep": {"x": 1}}):
        with pytest.raises(ValueError):
            F.check_settings(bad)
    got = F.check_settings({"live_tv": {"enabled": True, "tuner": "192.0.2.5", "channels": ["4.1"]}})
    assert got["live_tv"]["tuner"] == "192.0.2.5" and got["sleep"] == {"enabled": False}


async def test_feature_settings_rest_is_owner_only(make_env):
    env = await make_env()
    await env.login("adult1", "adult")
    r = await env.m.client.put("/api/features/settings", json={"sleep": {"enabled": True}}, headers=env.m.headers())
    assert r.status == 403
    assert (await env.m.get("/api/features/status")).status == 403
    await env.login("owner1", "owner")
    r = await env.m.client.put("/api/features/settings", json={"sleep": {"enabled": "on"}}, headers=env.m.headers())
    assert r.status == 400 and (await r.json())["error"]["code"] == "invalid"
    r = await env.m.client.put("/api/features/settings", json={"notifications": {"enabled": True, "items": [DOOR_ITEM]}},
                               headers=env.m.headers())
    assert r.status == 200 and env.host.on("notifications") and env.host.notifier.cache.keys() == {DOOR}
    hist = env.app["settings"].store.history("house", F.FEATURES_DOC)
    assert hist[0]["actor"] is not None, "the change is versioned with who made it"
    status = await (await env.m.get("/api/features/status")).json()
    assert status["commands_enabled"] is False and status["pieces"]["notifications"] is True


# ------------------------------------------------------------------------------------- notifications
async def test_a_state_change_sets_off_a_notification_on_every_screen(make_env):
    env = await make_env(settings={"notifications": {"enabled": True, "items": [DOOR_ITEM], "options": {"wake": True}},
                                   "sleep": {"enabled": True}},
                         tablet={**TABLET, "sleep": {**TABLET["sleep"], "decided_by": "shadow"}})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await events(env, ws)
    change(env.app, DOOR, "on")
    ev = await next_event(ws)
    assert ev["type"] == "notification" and ev["item"] == "n_door" and ev["entity"] == DOOR
    assert ev["title"] == "Front Door" and ev["kind"] == "door" and ev["snap"] is None
    assert ev["mute"] == f"n_door:{DOOR}"
    sent = env.host.notifier.sent[-1]
    assert sent["screens"] == 1 and sent["woke"] == ["hall"], "Wakes the Screen: the hall's Sleep Screen engine"
    assert env.host.engines["hall"].facts_now.get("notice") == "Front Door"
    change(env.app, DOOR, "off")
    change(env.app, MOTION, "on")                            # not watched: nothing
    with pytest.raises(asyncio.TimeoutError):
        await next_event(ws, timeout=0.3)
    # Mute 1 Hour, kept in the settings store
    await ws.send_json({"type": "notify_mute", "id": 3, "key": f"n_door:{DOOR}"})
    got = await GF.recv(ws)
    assert got["type"] == "notify_mute_result" and got["result"]["until"] > 0
    assert f"n_door:{DOOR}" in env.app["settings"].store.body("house", F.MUTES_DOC)["mutes"]
    change(env.app, DOOR, "on")
    with pytest.raises(asyncio.TimeoutError):
        await next_event(ws, timeout=0.3)
    assert env.audit() == [], "notifications call nothing in the house"
    await ws.close()


async def test_a_frame_for_some_people_reaches_only_them():
    feed = F.Feed()

    class P:
        def __init__(self, uid):
            self.user = type("U", (), {"id": uid, "ha_user_id": "ha-" + uid, "username": uid})()
    got = {"a": [], "b": []}
    feed.subscribe(P("a"), got["a"].append)
    feed.subscribe(P("b"), got["b"].append)
    assert feed.send({"type": "popup", "popup": "x", "users": ["ha-b"]}) == 1
    assert got == {"a": [], "b": [{"type": "popup", "popup": "x", "users": ["ha-b"]}]}
    assert feed.send({"type": "popup", "popup": "y", "users": []}) == 2


# ------------------------------------------------------------------------------------------ linked
async def test_linked_publishes_the_tablets_entities_and_keeps_the_handshake(make_env):
    env = await make_env(settings={"linked": {"enabled": True, "entry_id": ENTRY}}, popups=("doorbell",))
    lk, hello = await linked_ws(env)
    ents = {e["unique_id"]: e for e in hello["entities"]}
    assert set(ents) == set(UID.values())
    black = ents[UID["black_screen"]]
    assert (black["entity_id"], black["platform"], black["translation_key"]) == \
        ("switch.hall_black_screen", "switch", "black_screen")
    assert black["device"] == {"identifier": f"{ENTRY}_hall", "name": "Hall", "manufacturer": "HK Frontend",
                               "model": "Wall Tablet"}
    assert ents[UID["sleep_screen"]]["state"] == "automation"
    assert ents[UID["screen_in_use"]]["platform"] == "binary_sensor"
    target = [{"entity_id": "switch.hall_black_screen", "unique_id": UID["black_screen"]}]
    res, before = await lk.call(1, type="call_service", service="set_black_screen",
                                data={"black": True, "brightness": 174}, targets=target)
    assert res["success"] and res["result"] == {"switch.hall_black_screen": {"on": True}}
    assert [f["type"] for f in before] == ["state"], "the state is pushed BEFORE the result"
    assert before[0]["state"] == "on" and before[0]["attributes"]["confirmed"] is False
    assert before[0]["attributes"]["brightness"] == 174 and before[0]["attributes"]["black_screen"] == "hk"
    # the page reports black (Mantel's screen_report): confirmed
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "screen_report", "id": 2, "tablet": "hall", "black": True})
    assert (await GF.recv(ws))["result"] == {"changed": True}
    f = await lk.ws.receive_json(timeout=3)
    assert f["type"] == "state" and f["unique_id"] == UID["black_screen"] and f["attributes"]["confirmed"] is True
    # a tap: touched (in use), and the black off
    await ws.send_json({"type": "screen_report", "id": 3, "tablet": "hall", "touch": True, "black": False})
    assert (await GF.recv(ws))["result"] == {"changed": True}
    seen = {}
    while len(seen) < 2:
        f = await lk.ws.receive_json(timeout=3)
        seen[f["unique_id"]] = f
    assert seen[UID["screen_in_use"]]["state"] == "on" and seen[UID["black_screen"]]["state"] == "off"
    # pop-ups: to the screens' feed, checked against Mantel's pop-ups
    await events(env, ws)
    res, _ = await lk.call(4, type="call_service", service="show_popup", data={"popup": "#Doorbell"})
    assert res["success"] and res["result"]["screens"] == 1
    assert await next_event(ws) == {"type": "popup", "popup": "doorbell", "dashboards": [], "users": []}
    res, _ = await lk.call(5, type="call_service", service="show_popup", data={"popup": "garage"})
    assert res["error"]["code"] == "unknown_popup"
    res, _ = await lk.call(6, type="call_service", service="close_popup", data={"popup": "doorbell"})
    assert res["success"] and (await next_event(ws))["type"] == "popup_close"
    # a switch command from HA: the photo screensaver
    res, before = await lk.call(7, type="entity_command", unique_id=UID["photo_screensaver"], command="turn_on", data={})
    assert res["result"] == {"on": True} and before[0]["unique_id"] == UID["photo_screensaver"] and before[0]["state"] == "on"
    assert (await next_event(ws)) == {"type": "screen", "tablet": "hall", "photos": True, "dashboards": [], "users": []}
    assert env.audit() == [], "no house command: Mantel's own screens only"
    await ws.close()
    await lk.ws.close()


async def test_a_page_that_opens_under_a_black_screen_is_told_so(make_env):
    env = await make_env(settings={"linked": {"enabled": True, "entry_id": ENTRY}})
    lk, _hello = await linked_ws(env)
    target = [{"entity_id": "switch.hall_black_screen", "unique_id": UID["black_screen"]}]
    res, _ = await lk.call(1, type="call_service", service="set_black_screen",
                           data={"black": True, "brightness": 174}, targets=target)
    assert res["success"]
    res, _ = await lk.call(2, type="entity_command", unique_id=UID["photo_screensaver"], command="turn_on", data={})
    assert res["success"]
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "read_subscribe", "id": 7, "msg": {"type": "hk_frontend/events/subscribe"}})
    frames, answered = [], False
    while not (answered and len(frames) >= 2):         # the frames and the answer, in whichever order
        m = await GF.recv(ws)
        if m.get("type") == "read_result":
            answered = True
        else:
            frames.append(m["event"])
    assert frames ==[{"type": "screen", "tablet": "hall", "black": True, "brightness": 174, "dashboards": [], "users": []},
                      {"type": "screen", "tablet": "hall", "photos": True, "dashboards": [], "users": []}]
    assert env.audit() == []
    await ws.close()
    await lk.ws.close()


async def test_a_page_speaks_only_for_its_own_tablet(make_env):
    env = await make_env(settings={"linked": {"enabled": True, "entry_id": ENTRY}},
                         tablet={**TABLET, "user": "hallpanel"})
    await env.login("adult1", "adult")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "screen_report", "id": 1, "tablet": "hall", "touch": True})
    assert (await GF.recv(ws))["error"]["code"] == "forbidden"
    await ws.send_json({"type": "screen_report", "id": 2, "tablet": "hall", "touch": "yes"})
    assert (await GF.recv(ws))["error"]["code"] == "invalid"
    assert env.host.screens.get("hall") is None or env.host.screens["hall"].touch is None
    await ws.close()


async def test_the_linked_backlight_with_commands_off_is_audited_and_listed_not_sent(make_env):
    env = await make_env(settings={"linked": {"enabled": True, "entry_id": ENTRY, "backlight": True}})
    assert env.host.acting_entities() == {KP["screen"]}, "the Service actor may touch the kiosk's screen only"
    lk, _ = await linked_ws(env)
    target = [{"entity_id": "switch.hall_black_screen", "unique_id": UID["black_screen"]}]
    res, before = await lk.call(1, type="call_service", service="set_black_screen", data={"black": True}, targets=target)
    assert res["success"] and before[0]["state"] == "on"
    assert await until(lambda: env.host.status()["would"])
    would = env.host.status()["would"]
    assert [(w["action"], w["data"], w["as"], w["why"]) for w in would] == \
        [("light.turn_on", {"entity_id": KP["screen"], "brightness": 1}, F.FEATURE_ACTOR, "linked:hall")]
    row = env.audit(id=would[0]["audit_id"])[0]
    assert (row["actor"], row["actor_name"], row["role"], row["decision"], row["reason"], row["result"]) == \
        (F.FEATURE_ACTOR, F.FEATURE_ACTOR_NAME, "service", "denied", "commands_disabled", "not_sent")
    assert env.app["commander"] is None and env.app["gateway"] is None
    await lk.ws.close()


async def test_the_linked_backlight_with_commands_on_goes_through_the_gateway(make_env):
    env = await make_env(commands=True, settings={"linked": {"enabled": True, "entry_id": ENTRY, "backlight": True,
                                                             "backlights": {"hall": "light.kitchen"}}})
    lk, _ = await linked_ws(env)
    target = [{"entity_id": "switch.hall_black_screen", "unique_id": UID["black_screen"]}]
    await lk.call(1, type="call_service", service="set_black_screen", data={"black": True, "brightness": 120}, targets=target)
    assert await until(lambda: env.fake.sent)
    await lk.call(2, type="call_service", service="set_black_screen", data={"black": False}, targets=target)
    assert await until(lambda: len(env.fake.sent) == 2)
    assert [f["service_data"] for f in env.fake.frames] == [{"entity_id": "light.kitchen", "brightness": 1},
                                                            {"entity_id": "light.kitchen", "brightness": 120}]
    rows = env.audit(actor=F.FEATURE_ACTOR)
    assert [(r["action"], r["decision"], r["result"], r["role"]) for r in rows] == \
        [("light.turn_on", "allowed", "ok", "service")] * 2
    # the Service actor's grants are only what the features act on
    with pytest.raises(HouseCommandRefused) as e:
        await env.host.house.call_service("lock", "unlock", {"entity_id": "lock.front_door"}, context="test")
    assert e.value.code == "forbidden" and len(env.fake.sent) == 2
    with pytest.raises(HouseCommandRefused):
        await env.host.house.call_service("homeassistant", "restart", {}, context="test")
    # an Owner's deny grant naming the Service actor wins
    from mantel_server.rbac import Grant
    env.app["authz"].rbac.add_grant(Grant(effect="deny", actions=("*",), resource_kind="all", users={F.FEATURE_ACTOR}))
    with pytest.raises(HouseCommandRefused) as e:
        await env.host.house.call_service("light", "turn_on", {"entity_id": "light.kitchen"}, context="test")
    assert e.value.code == "forbidden" and len(env.fake.sent) == 2
    await lk.ws.close()


# ------------------------------------------------------------------------------------ Sleep Screen
@pytest.fixture
def fast(monkeypatch):
    for k in ("CONFIRM_S", "KIOSK_WAIT_S", "SETTLE_S", "BACKSTOP_S"):
        monkeypatch.setattr(F.MantelSleep, k, 0.05)


SLEEPING = {**TABLET, "sleep": {**TABLET["sleep"], "decided_by": "hk"}}


async def test_the_sleep_screen_with_commands_off_records_what_it_would_do(make_env, fast):
    env = await make_env(settings={"sleep": {"enabled": True}, "linked": {"enabled": True, "entry_id": ENTRY}},
                         tablet=SLEEPING)
    eng = env.host.engines["hall"]
    assert eng.acting and eng.kiosk == KP
    assert await until(lambda: eng.actions and eng.actions[0]["calls"] and eng._task is None)
    act = eng.actions[0]
    assert act["what"] == "sleep" and act["reason"] == "nobody here"
    calls = [(c["call"], c["data"].get("entity_id"), c["outcome"]) for c in act["calls"]]
    assert calls[0] == ("switch.turn_on", "switch.hall_photo_screensaver", "mantel"), "Mantel's own photos"
    assert ("switch.turn_on", KP["armed"], "would") in calls and ("switch.turn_on", KP["active"], "would") in calls
    assert all(o in ("mantel", "would") for *_, o in calls)
    scr = env.host.screens["hall"]
    assert scr.black.on and not scr.black.confirmed, "Mantel's own black: its state, not a house command"
    assert eng.want == "dark" and eng.actual == "dark" and eng.action() is None, "no loop"
    st = env.host.status()
    assert st["sleep"]["hall"]["actions"][0]["calls"] == act["calls"]
    assert {w["action"] for w in st["would"]} == {"switch.turn_on"}
    assert all(r["decision"] == "denied" and r["reason"] == "commands_disabled" and r["actor"] == F.FEATURE_ACTOR
               for r in env.audit())
    # its sensor, published to linked HA
    sensor = env.app["linked"].registry.get(UID["sleep_screen"])
    assert sensor["state"] == "dark" and sensor["attributes"]["reason"] == "nobody here"
    # somebody walks in: awake again (the wake)
    change(env.app, MOTION, "on")
    assert await until(lambda: len(eng.actions) >= 2 and eng._task is None)
    assert eng.actions[-1]["what"] == "wake" and not env.host.screens["hall"].black.on


async def test_the_sleep_screen_with_commands_on_drives_the_kiosk_through_the_gateway(make_env, fast):
    env = await make_env(commands=True, settings={"sleep": {"enabled": True}}, tablet=SLEEPING)
    eng = env.host.engines["hall"]
    assert await until(lambda: eng.actions and eng._task is None and eng.actions[0]["calls"])
    assert "switch.turn_on" in env.fake.sent
    sent_ids = [f["service_data"]["entity_id"] for f in env.fake.frames]
    assert KP["armed"] in sent_ids and KP["active"] in sent_ids
    assert all(r["actor"] == F.FEATURE_ACTOR and r["decision"] == "allowed" for r in env.audit())
    assert env.host.acting_entities() == set(KP.values()) - {KP["app"], KP["touched"]}


# ---------------------------------------------------------------------- clean areas, energy, live TV
async def test_clean_areas_runs_as_the_person_who_asked(make_env):
    env = await make_env(commands=True, settings={"clean_areas": {"enabled": True}})
    await env.login("owner1", "owner")
    ws = await env.socket()
    await ws.send_json({"type": "read", "id": 1, "msg": {"type": "mantel/clean_areas/coverage"}})
    got = await GF.recv(ws)
    assert got["result"]["offered"] == ["kitchen"] and got["result"]["coverage"][0]["how"] == "map"
    await ws.send_json({"type": "clean_areas_run", "id": 2, "areas": ["kitchen"], "dry_run": True})
    got = await GF.recv(ws)
    assert got["result"]["dry_run"] is True and env.fake.sent == []
    await ws.send_json({"type": "clean_areas_run", "id": 3, "areas": ["kitchen"]})
    got = await GF.recv(ws)
    assert got["result"]["ok"] is True and env.fake.sent == ["vacuum.clean_area"]
    row = env.audit(action="vacuum.clean_area")[0]
    assert row["role"] == "owner" and row["actor"] != F.FEATURE_ACTOR, "the person's own rights and name"
    await ws.close()


async def test_clean_areas_with_commands_off_answers_the_plan_and_sends_nothing(make_env):
    env = await make_env(settings={"clean_areas": {"enabled": True}})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "clean_areas_run", "id": 1, "areas": ["kitchen"]})
    got = (await GF.recv(ws))["result"]
    assert got["ok"] is False and got["failed"][0]["vacuum"] == VACUUM
    assert "disabled" in got["failed"][0]["error"]
    assert env.audit()[0]["reason"] == "commands_disabled"
    await ws.close()


PREFS = {"energy_sources": [{"type": "grid", "flow_from": [{"stat_energy_from": "sensor.grid_import"}]}],
         "device_consumption": [{"stat_consumption": "sensor.coffee_energy"}]}


async def test_the_energy_plan_reads_has_energy_prefs_and_mantels_house(make_env):
    env = await make_env(settings={"energy": {"enabled": True}})
    env.app["hub"].readproxy = proxy = FakeProxy(PREFS)
    env.app["hub"].store.apply_event({"a": {
        "sensor.grid_import": {"s": "1200", "a": {"unit_of_measurement": "kWh", "device_class": "energy"}, "lc": 1.0},
        "sensor.coffee_energy": {"s": "3.2", "a": {"unit_of_measurement": "kWh", "friendly_name": "Office Coffee"},
                                 "lc": 1.0}}})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "read", "id": 1, "msg": {"type": "mantel/energy/plan"}})
    got = await GF.recv(ws)
    assert got["result"]["configured"] is True and proxy.asked == [{"type": "energy/get_prefs"}]
    plan = got["result"]["plan"]
    assert any(t.get("key") == "sensor.coffee_energy" for s in plan["sections"] for t in s.get("items", s.get("tiles", [])))
    await ws.close()
    await env.login("guest1", "guest")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "read", "id": 2, "msg": {"type": "mantel/energy/plan"}})
    assert (await GF.recv(ws))["error"]["code"] == "forbidden"
    await ws.close()


XMLTV = b"""<?xml version="1.0"?><tv>
<channel id="c1"><display-name>4.1</display-name><display-name>NATIONAL BROADCASTING COMPANY</display-name></channel>
<programme channel="c1" start="20261018150000 +0000" stop="20261018170000 +0000"><title>The Fictional Hour</title></programme>
<programme channel="c1" start="20261018170000 +0000" stop="20261018180000 +0000"><title>Made-up News</title></programme>
</tv>"""


async def test_the_live_tv_guide_from_the_configured_urls(make_env):
    asked = []

    async def fetch(url):
        asked.append(url)
        if url.endswith("lineup.json"):
            return json.dumps([{"GuideNumber": "4.1", "GuideName": "WNBC", "HD": 1}]).encode()
        return XMLTV
    now = datetime(2026, 10, 18, 16, 0, tzinfo=timezone.utc)
    env = await make_env(settings={"live_tv": {"enabled": True, "tuner": "192.0.2.5",
                                               "guide_url": "http://192.0.2.9/guide.xml"}},
                         hooks={"fetch": fetch, "now": lambda: now})
    await until(lambda: env.host.tv.fetched_at)
    assert asked[:2] == ["http://192.0.2.5/lineup.json", "http://192.0.2.9/guide.xml"]
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "read", "id": 1, "msg": {"type": "mantel/live_tv/guide"}})
    got = (await GF.recv(ws))["result"]
    ch = got["channels"][0]
    assert (ch["number"], ch["name"], ch["network"]) == ("4.1", "WNBC", "NBC")
    assert ch["now"]["title"] == "The Fictional Hour" and ch["next"]["title"] == "Made-up News"
    await ws.close()


async def test_a_feature_call_without_a_gateway_is_refused_clearly():
    caller = F.FeatureCaller({}, lambda: set())
    with pytest.raises(HouseCommandsDisabled):
        await caller("light", "turn_on", {"entity_id": "light.x"}, "test")
    assert caller.log[-1]["outcome"] == "would"


def test_energy_context_reads_the_house_through_the_port():
    from mantel_house_fakes import mantel_house_of
    from hk_core.house import Device, Entity, State

    class Fake:
        _states = {"sensor.car_battery": State("sensor.car_battery", "80", {"device_class": "battery"}),
                   "sensor.car_range": State("sensor.car_range", "200", {"device_class": "distance"})}
        _entities = {"sensor.car_battery": Entity("sensor.car_battery", device_id="car"),
                     "sensor.car_range": Entity("sensor.car_range", device_id="car")}
        _devices = {"car": Device("car", None, "Car")}
        _areas = {"garage": "Garage"}
    ctx = F.energy_context(mantel_house_of(Fake()), {}, {})
    assert ctx["vehicles"] == ["sensor.car_battery"] and ctx["entities"]["sensor.car_battery"]["range"] == "sensor.car_range"
    assert ctx["areas"] == {"garage": {"name": "Garage", "icon": None}}
