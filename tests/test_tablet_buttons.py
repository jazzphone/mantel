"""HK Settings -> Wall Tablets on Mantel without HK Frontend (docs/phase9/NO-HK-FRONTEND.md): Add Tablet and Remove
are Mantel's settings saves (a document, versioned, its history kept on removal); Wake Now, Sleep Now and the kiosk
screensaver's Fix are Mantel's own ``tablet_act`` (its Sleep Screen engine; the kiosk app's settings through the
gateway as the person who pressed it); a screen's title is Mantel's. A FICTIONAL house; fakes only."""
import gateway_fakes as GF
from mantel_server import settings_store as S
from test_feature_ports import kiosk_extras
from test_features import KIOSK, TABLET, make_env  # noqa: F401 -- the fixture

SLEEP_ON = {"sleep": {"enabled": True}, "linked": {"enabled": False}}


async def save(ws, rid, msg):
    await ws.send_json({"type": "settings_write", "id": rid, "msg": msg})
    while True:
        got = await GF.recv(ws)
        if got.get("type") == "settings_result" and got.get("id") == rid:
            return got


async def act(ws, rid, **kw):
    await ws.send_json({"type": "tablet_act", "id": rid, **kw})
    while True:
        got = await GF.recv(ws)
        if got.get("type") == "tablet_act_result" and got.get("id") == rid:
            return got


def test_the_tablet_saves_are_mantels():
    for t in ("hk_frontend/tablet/add", "hk_frontend/tablet/remove", "hk_frontend/dashboard/titled"):
        assert S.SAVE_KINDS[t] == "settings"


async def test_add_and_remove_a_tablet(make_env):
    env = await make_env()
    store = env.app["settings"].store
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    got = await save(ws, 1, {"type": "hk_frontend/tablet/add", "tablet": {"name": "Living Room", "room": "hall"}})
    assert got["result"]["id"] == "living_room" and got["result"]["tablet"]["name"] == "Living Room"
    assert store.body("tablet", "living_room")["uid"] == "tablet_living_room"
    got = await save(ws, 2, {"type": "hk_frontend/tablet/add", "tablet": {"name": "Living Room"}})
    assert got["result"]["id"] == "living_room_2", "a taken id gets _2, as HK Frontend's"
    got = await save(ws, 3, {"type": "hk_frontend/tablet/add", "tablet": "nope"})
    assert got["error"]["code"] == "invalid_format"
    got = await save(ws, 4, {"type": "hk_frontend/tablet/remove", "tablet": "living_room_2"})
    assert got["result"] == {"removed": "living_room_2"} and store.get("tablet", "living_room_2") is None
    hist = store.history("tablet", "living_room_2", 10, False)
    assert [(h["action"], h["message"]) for h in hist] == [("set", "hk_frontend/tablet/remove"),
                                                           ("set", "hk_frontend/tablet/add")], \
        "its history stays, the removal the last version"
    restored = store.restore("tablet", "living_room_2", 1, actor=S.Actor(label="t"))
    assert restored is not None and restored.version == 3 and store.body("tablet", "living_room_2")["name"] == "Living Room"
    assert (await save(ws, 5, {"type": "hk_frontend/tablet/remove", "tablet": "nowhere"}))["error"]["code"] == "no_tablet"
    await ws.close()
    await env.login("adult1", "adult")
    ws = await env.socket(expect_caps=False)
    got = await save(ws, 6, {"type": "hk_frontend/tablet/add", "tablet": {"name": "Den"}})
    assert got["error"]["code"] == "forbidden" and store.get("tablet", "den") is None
    await ws.close()


async def test_a_screens_title_is_its_boards(make_env):
    env = await make_env()
    env.app["settings"].store.write([("board", "dashboard-kitchen", {"title": "Kitchen Wall"})], actor=S.Actor(label="t"))
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    got = await save(ws, 1, {"type": "hk_frontend/dashboard/titled", "dashboard": "dashboard-kitchen"})
    assert got["result"] == {"title": "Kitchen Wall"}
    got = await save(ws, 2, {"type": "hk_frontend/dashboard/titled", "dashboard": "dashboard-none"})
    assert got["error"]["code"] == "no_dashboard"
    await ws.close()


async def test_wake_and_sleep_now_are_mantels_sleep_screen(make_env):
    env = await make_env(settings=SLEEP_ON, tablet={**TABLET, "sleep": {**TABLET["sleep"], "decided_by": "hk"}})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    eng = env.host.engines.get("hall")
    assert eng is not None and eng.acting
    slept = []

    async def sleep(power_off):
        slept.append(power_off)
    eng.sleep = sleep
    got = await act(ws, 1, tablet="hall", act="sleep")
    assert got["result"] == {"ok": True} and slept == [eng.power_off_wanted()]
    before = env.host.screen("hall").touch
    got = await act(ws, 2, tablet="hall", act="wake")
    assert got["result"] == {"ok": True} and env.host.screen("hall").touch != before, "as a touch"
    assert (await act(ws, 3, tablet="nowhere", act="wake"))["error"]["code"] == "no_tablet"
    assert (await act(ws, 4, tablet="hall", act="explode"))["error"]["code"] == "invalid"
    await ws.close()
    await env.login("adult1", "adult")
    ws = await env.socket(expect_caps=False)
    assert (await act(ws, 5, tablet="hall", act="wake"))["error"]["code"] == "forbidden"
    await ws.close()


async def test_wake_needs_mantels_engine_for_the_tablet(make_env):
    env = await make_env()
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert (await act(ws, 1, tablet="hall", act="wake"))["error"]["code"] == "not_deciding"
    await ws.close()


def kiosk_saver_parts(app):
    hub = app["hub"]
    extra = [{"entity_id": e, "device_id": KIOSK, "platform": "kiosk_satellite"}
             for e in ("select.hall_kiosk_screensaver_mode", "number.hall_kiosk_screensaver_timeout")]
    hub.registry.load(*[getattr(hub.registry, k) for k in ("area_entries", "device_entries")],
                      list(hub.registry.entity_entries) + extra)
    hub.store.apply_event({"a": {"select.hall_kiosk_screensaver_mode": {"s": "Clock", "a": {}, "lc": 1.0},
                                 "number.hall_kiosk_screensaver_timeout": {"s": "60", "a": {}, "lc": 1.0}}})


async def test_the_kiosk_screensavers_fix_runs_as_the_person(make_env):
    env = await make_env(commands=True)
    kiosk_extras(env.app)
    kiosk_saver_parts(env.app)
    await env.login("owner1", "owner")
    ws = await env.socket()
    got = await act(ws, 1, tablet="hall", act="kiosk_saver")
    assert got["result"] == {"ok": True}, got
    assert env.fake.sent == ["select.select_option", "number.set_value"]
    rows = env.audit(action="select.select_option")
    assert rows and rows[0]["role"] == "owner" and rows[0]["decision"] == "allowed"
    await ws.close()


async def test_the_kiosk_screensavers_fix_with_commands_off_sends_nothing(make_env):
    env = await make_env()
    kiosk_extras(env.app)
    kiosk_saver_parts(env.app)
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    got = await act(ws, 1, tablet="hall", act="kiosk_saver")
    assert got["error"]["code"] == "commands_disabled"
    await ws.close()
