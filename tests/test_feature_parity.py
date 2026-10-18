"""Feature parity for HK's generated pages on Mantel (docs/phase4/FEATURE-PARITY.md): the feature import
(which HK features HA has added, and the settings of Notifications, Clean Areas, Energy and Live TV), the
settings feed's `added` / `energy` and panel/get's `features` in HA's shapes, Clean Areas' area picker
answered by Mantel, and Live TV's channel list through an RBAC-filtered interim read. Fictional house,
fakes only; house commands stay off throughout."""
import json
import logging

import pytest
from aiohttp.test_utils import TestServer

import gateway_fakes as GF
from connector_fakes import FEATURE_PAGES, HA_TOKEN, TV_CHANNELS, FakeHa
from mantel_server import features as F
from mantel_server import readproxy as rp
from mantel_server import settings_store as S
from mantel_server.connectors import Hooks
from mantel_server.readproxy import READ_ALLOWED, RULES, SERVER_ONLY_READS, FilteredReads, ReadBlocked, ReadProxy
from test_features import (AREAS, DEVICES, ENTITIES, PREFS, VACUUM, FakeProxy, build, make_env,  # noqa: F401
                           until)                                     # (make_env: the fixture, used by name)

ITEM = {"music": "01JMUSIC0000000000000000AA", "live_tv": "01JLIVETV000000000000000AA",
        "clean_areas": "01JCLEAN00000000000000000A", "alarm_pin": "01JALARM00000000000000000A",
        "energy": "01JENERGY0000000000000000A", "notifications": "01JNOTIFY0000000000000000A"}
NAMES = {"hk_music": "music", "hk_alarm_pin": "alarm_pin", "hk_clean_areas": "clean_areas", "hk_tv": "live_tv",
         "hk_energy": "energy", "hk_notify": "notifications"}


def panel(*kinds, entry="01JHOUSEENTRY000000000000A"):
    """HA's hk_frontend/panel/get, trimmed: its settings and its `features` (panel.py _features)."""
    feats = {fid: {"name": k.title(), "kind": k, "installed": True,
                   "entries": [{"entry_id": ITEM[k], "title": k.replace("_", " ").title(), "state": "loaded"}]
                   if k in kinds else []}
             for fid, k in NAMES.items()}
    return {"entry_id": entry, "setup_done": True, "settings": {"look": {"glass": "blur"}}, "features": feats}


class Reads:
    """A fake server-only reader: each feature's settings page, as HA answers it."""

    def __init__(self, pages=None, fail=None):
        self.pages, self.fail, self.asked = pages or FEATURE_PAGES, fail, []

    async def __call__(self, msg):
        self.asked.append(msg["type"])
        if self.fail and msg["type"] == self.fail:
            raise ConnectionError("Home Assistant went away")
        return json.loads(json.dumps(self.pages.get(msg["type"], {"configured": False})))


# ---------------------------------------------------------------------------------- the feature import
async def test_the_feature_import_brings_each_added_feature_over():
    reads = Reads()
    got = await F.import_features(panel(*F.HA_KINDS), reads, source="ha:01JHOUSEENTRY000000000000A")
    assert got["ha"]["added"] == list(F.HA_KINDS)
    assert got["ha"]["items"]["live_tv"] == [{"entry_id": ITEM["live_tv"], "title": "Live Tv"}]
    assert sorted(reads.asked) == sorted(F.FEATURE_READS.values()), "one read per imported feature, nothing else"
    assert got["clean_areas"] == {"enabled": True, "options": {"vacuums": ["vacuum.robot"], "areas": ["kitchen"]}}
    assert got["energy"]["enabled"] is True
    assert got["energy"]["options"] == {"follow": True, "title": "Power & Energy", "power": {"path": "power", "home": "sensor.home_power"},
                                        "sections": [{"id": "rooms", "name": "Rooms", "items": ["sensor.fridge"]}]}
    assert "plan" not in got["energy"]["options"], "what HA works out at run time is not imported"
    n = got["notifications"]
    assert n["enabled"] is True and n["options"]["stay"] == 15
    assert n["items"] == [{"id": "n_door", "entity": "binary_sensor.front_door", "when": "on", "title": ""}], \
        "an item keeps its stored fields only (no page decorations, no id-less item)"
    tv = got["live_tv"]
    assert tv == {"enabled": False, "tuner": "192.0.2.40", "guide_url": "http://192.0.2.41/xmltv.xml",
                  "channels": ["4.1"], "names": {"4.1": "NBC"}}, "Mantel's own guide fetch stays off"
    assert got["linked"] == F.DEFAULTS["linked"] and got["sleep"] == F.DEFAULTS["sleep"]
    assert F.check_settings(got) == got


async def test_a_feature_ha_has_not_added_is_not_read_and_stays_off():
    reads = Reads()
    got = await F.import_features(panel("music", "energy"), reads)
    assert reads.asked == ["hk_energy/settings/get"]
    assert got["ha"]["added"] == ["music", "energy"]
    assert not got["clean_areas"]["enabled"] and not got["notifications"]["enabled"]


async def test_reimport_keeps_linked_and_sleep():
    current = F.check_settings({"linked": {"enabled": True, "entry_id": "abc123"}, "sleep": {"enabled": True},
                                "clean_areas": {"enabled": True, "options": {"areas": ["porch"]}}})
    got = await F.import_features(panel("music"), Reads(), current)
    assert got["linked"]["entry_id"] == "abc123" and got["sleep"]["enabled"] is True
    assert got["clean_areas"] == F.DEFAULTS["clean_areas"], "HA no longer has Clean Areas: off"


def test_ha_items_ignore_what_is_not_an_item():
    p = panel("music")
    p["features"]["hk_music"]["entries"].append({"entry_id": "bad id!", "title": "x"})
    p["features"]["hk_tv"] = {"kind": "music", "entries": [{"entry_id": "01X"}]}          # wrong kind
    assert F.ha_items(p) == {"music": [{"entry_id": ITEM["music"], "title": "Music"}]}
    assert F.ha_items({}) == {} and F.ha_items(None) == {}


def test_the_ha_record_is_checked():
    for bad in ({"ha": {"added": ["sleep"]}}, {"ha": {"items": {"music": [{"entry_id": "a b"}]}}},
                {"ha": {"items": {"music": "x"}}}, {"ha": {"x": 1}}, {"live_tv": {"names": {"4.1": ""}}}):
        with pytest.raises(ValueError):
            F.check_settings(bad)


async def test_the_one_time_import_writes_the_features_too(tmp_path):
    from mantel_server.db import Database
    store = S.SettingsStore(Database(tmp_path / "m.db").conn)

    async def fetch():
        return panel("clean_areas", "music")
    reads = Reads()
    got = await S.import_settings(store, fetch, actor=S.Actor(label="t"), read_features=reads)
    assert got["imported"] and got["features_error"] is None and "house/mantel_features" in got["written"]
    body = store.body("house", F.FEATURES_DOC)
    assert body["ha"]["added"] == ["music", "clean_areas"] and body["clean_areas"]["enabled"] is True
    assert body["ha"]["source"] == "ha:01JHOUSEENTRY000000000000A"
    assert store.history("house", F.FEATURES_DOC)[0]["action"] == "import"


async def test_a_failed_feature_read_still_imports_the_settings(tmp_path):
    from mantel_server.db import Database
    store = S.SettingsStore(Database(tmp_path / "m.db").conn)

    async def fetch():
        return panel("clean_areas")
    got = await S.import_settings(store, fetch, actor=S.Actor(label="t"),
                                  read_features=Reads(fail="hk_clean_areas/settings/get"))
    assert got["imported"] and got["features_error"] == "ConnectionError"
    assert store.get("house", F.FEATURES_DOC) is None and store.get("house", "settings") is not None


def test_the_feature_reads_are_server_only():
    for t in F.FEATURE_READS.values():
        assert t in SERVER_ONLY_READS and READ_ALLOWED[t] == frozenset() and t in RULES
    assert set(RULES) == set(READ_ALLOWED)


async def test_read_server_reads_only_the_server_reads_and_pages_never_do():
    fake = FakeHa()
    async with TestServer(fake.app()) as server:
        proxy = ReadProxy(str(server.make_url("")).rstrip("/"), HA_TOKEN)
        try:
            got = await proxy.read_server({"type": "hk_tv/settings/get"})
            assert got["host"] == "192.0.2.40"
            for bad in ({"type": "hk_tv/channels"}, {"type": "hk_tv/settings/set"}, {"type": "energy/get_prefs"}):
                with pytest.raises(ReadBlocked):
                    await proxy.read_server(bad)
            with pytest.raises(ReadBlocked):
                await proxy.request({"type": "hk_energy/settings/get"})          # a page's path
            reads = FilteredReads(lambda: proxy, Hooks(may_read=lambda who, kind, ids: ids))
            for t in F.FEATURE_READS.values():
                with pytest.raises(ReadBlocked):
                    await reads.request("owner", {"type": t})
            assert fake.sent_types() == ["auth", "hk_tv/settings/get"]
        finally:
            await proxy.close()


# --------------------------------------------------------------------------- what the screens are told
async def feed(ws, rid=5):
    await ws.send_json({"type": "read_subscribe", "id": rid, "msg": {"type": "hk_frontend/settings/subscribe"}})
    while True:
        m = await GF.recv(ws)
        if m.get("type") == "read_event" and m.get("id") == rid:
            return m["event"]


async def next_feed(ws, rid=5):
    while True:
        m = await GF.recv(ws)
        if m.get("type") == "read_event" and m.get("id") == rid:
            return m["event"]


IMPORTED = {"ha": {"added": ["music", "live_tv", "clean_areas", "alarm_pin", "energy", "notifications"],
                   "items": {"live_tv": [{"entry_id": ITEM["live_tv"], "title": "Live TV"}]}, "source": "ha:x"},
            "clean_areas": {"enabled": True}, "energy": {"enabled": True}}


async def test_the_feed_says_which_features_are_added_in_has_order(make_env):
    env = await make_env(settings=IMPORTED)
    env.host.energy_cache = {"sections": [], "power": {"path": "power"}}
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    got = await feed(ws)
    # notifications is off on Mantel; music, the alarm's PIN and Live TV run in HA, which has them added
    assert got["added"] == ["music", "live_tv", "clean_areas", "alarm_pin", "energy"]
    assert got["energy"] == {"sections": [], "power": {"path": "power"}}
    await ws.close()
    await env.login("guest1", "guest")
    ws = await env.socket(expect_caps=False)
    got = await feed(ws)
    assert got["energy"] is None, "the Energy page's plan only with feature:energy"
    assert "energy" in got["added"]
    await ws.close()


async def test_panel_get_lists_the_features_in_has_shape(make_env):
    env = await make_env(settings=IMPORTED)
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "read", "id": 3, "msg": {"type": "hk_frontend/panel/get"}})
    feats = (await GF.recv(ws))["result"]["features"]
    assert list(feats) == ["hk_music", "hk_alarm_pin", "hk_clean_areas", "hk_tv", "hk_energy", "hk_notify"]
    assert feats["hk_tv"] == {"name": "Live TV", "kind": "live_tv", "installed": True,
                              "entries": [{"entry_id": ITEM["live_tv"], "title": "Live TV", "state": "loaded"}]}
    assert feats["hk_clean_areas"]["entries"] == [{"entry_id": "mantel_clean_areas", "title": "Clean Areas",
                                                    "state": "loaded"}]
    assert feats["hk_notify"]["entries"] == []
    await ws.close()


async def test_turning_a_feature_on_sends_every_screen_a_new_feed(make_env):
    env = await make_env()
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert (await feed(ws))["added"] == []
    r = await env.m.client.put("/api/features/settings", json={"clean_areas": {"enabled": True}}, headers=env.m.headers())
    assert r.status == 200
    assert (await next_feed(ws))["added"] == ["clean_areas"]
    await ws.close()


async def test_the_energy_plan_reaches_the_feed_once_connected(make_env):
    env = await make_env(settings={"energy": {"enabled": True}})
    env.app["hub"].readproxy = proxy = FakeProxy(PREFS)
    assert await env.host.refresh_energy() is None and proxy.asked == [], "not connected to HA yet: not asked"
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert (await feed(ws))["energy"] is None
    env.app["hub"].ha.connected.set()
    plan = await env.host.refresh_energy()
    assert proxy.asked == [{"type": "energy/get_prefs"}] and plan is not None
    assert (await next_feed(ws))["energy"] == json.loads(json.dumps(plan))
    r = await env.m.client.put("/api/features/settings", json={"energy": {"enabled": False}}, headers=env.m.headers())
    assert r.status == 200
    assert await until(lambda: env.host.energy_cache is None)
    got = await next_feed(ws)
    assert got["energy"] is None and "energy" not in got["added"]
    await ws.close()


# --------------------------------------------------------------------------- Clean Areas' area picker
async def areas(ws, rid=9):
    await ws.send_json({"type": "read_subscribe", "id": rid, "msg": {"type": "hk_clean_areas/subscribe"}})
    got = {}
    while "event" not in got or "result" not in got:
        m = await GF.recv(ws)
        if m.get("id") != rid:
            continue
        if m["type"] == "read_event":
            got["event"] = m["event"]
        elif m["type"] == "read_result":
            if "error" in m:
                return m
            got["result"] = m
    return got["event"]


async def test_the_area_picker_is_answered_by_mantel(make_env):
    env = await make_env(settings={"clean_areas": {"enabled": True}})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert await areas(ws) == {"configured": True, "areas": ["kitchen"]}
    await ws.close()
    assert env.audit() == [], "a read: nothing audited, nothing sent"


async def test_the_area_picker_offers_only_what_your_vacuums_reach(make_env):
    env = await make_env(settings={"clean_areas": {"enabled": True}})
    await env.login("guest1", "guest")                   # a guest may not view the vacuum
    ws = await env.socket(expect_caps=False)
    assert await areas(ws) == {"configured": True, "areas": []}
    await ws.close()


async def test_the_area_picker_without_clean_areas_and_malformed(make_env):
    env = await make_env()
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert await areas(ws) == {"configured": False, "areas": []}
    await ws.send_json({"type": "read_subscribe", "id": 11, "msg": {"type": "hk_clean_areas/subscribe", "areas": ["x"]}})
    m = await GF.recv(ws)
    assert m["id"] == 11 and m["error"]["code"] == "not_allowed"
    await ws.close()


async def test_the_area_picker_follows_the_settings_and_the_vacuums(make_env):
    env = await make_env(settings={"clean_areas": {"enabled": True}})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert (await areas(ws))["areas"] == ["kitchen"]

    async def next_areas():
        while True:
            m = await GF.recv(ws)
            if m.get("type") == "read_event" and m.get("id") == 9:
                return m["event"]
    r = await env.m.client.put("/api/features/settings", json={"clean_areas": {"enabled": True, "options": {"vacuums": ["vacuum.other"]}}},
                               headers=env.m.headers())
    assert r.status == 200
    assert await next_areas() == {"configured": True, "areas": []}
    r = await env.m.client.put("/api/features/settings", json={"clean_areas": {"enabled": True}}, headers=env.m.headers())
    assert await next_areas() == {"configured": True, "areas": ["kitchen"]}
    hub = env.app["hub"]                                  # the robot goes away
    hub.store.apply_event({"r": [VACUUM]})
    hub.registry.load(AREAS, DEVICES, [e for e in ENTITIES if e["entity_id"] != VACUUM])
    hub.ha.on_registry()
    assert await next_areas() == {"configured": True, "areas": []}
    await ws.close()


async def test_starting_a_clean_stays_a_command(make_env):
    env = await make_env(settings={"clean_areas": {"enabled": True}})
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await ws.send_json({"type": "read", "id": 4, "msg": {"type": "hk_clean_areas/subscribe"}})
    assert (await GF.recv(ws))["error"]["code"] == "not_allowed", "a subscription, never a read that acts"
    for t in ("hk_clean_areas/settings/set", "hk_clean_areas/settings/get"):
        await ws.send_json({"type": "read", "id": 5, "msg": {"type": t}})
        assert (await GF.recv(ws))["error"]["code"] in ("not_allowed", "unavailable")
    await ws.close()
    assert env.audit() == []


async def test_every_feature_read_has_exactly_one_rule(tmp_path, monkeypatch):
    app, store, _now, _fake, _host = await build(tmp_path, monkeypatch)
    try:
        # the routes features.register installs are exactly ROUTE_RULES' (and none is forwarded to HA)
        from_features = {t for t, r in app["read_routes"].items()
                         if any(getattr(f, "__module__", "") == F.__name__ for f in (r.request, r.subscribe) if f)}
        assert from_features == set(F.ROUTE_RULES)
        assert not set(F.ROUTE_RULES) & set(READ_ALLOWED)
    finally:
        store.db.close()


# ------------------------------------------------------------------------- Live TV's channel list (interim)
GRANTS = {"adult": {"camera.live_tv_4_1", "sensor.live_tv_4_1_now", "camera.live_tv_5_1", "camera.live_tv_bad",
                    "light.kitchen"}}


def tv_may_read(identity, kind, ids):
    return set(ids) & GRANTS.get(identity, set()) | {"camera.not_asked_for"}            # tries to widen


@pytest.fixture
async def tv():
    fake = FakeHa()
    async with TestServer(fake.app()) as server:
        proxy = ReadProxy(str(server.make_url("")).rstrip("/"), HA_TOKEN)
        yield type("Tv", (), dict(fake=fake, reads=FilteredReads(lambda: proxy, Hooks(may_read=tv_may_read))))
        await proxy.close()


async def test_the_channel_list_is_cut_to_the_cameras_you_may_view(tv):
    got = await tv.reads.request("adult", {"type": "hk_tv/channels"})
    assert got == {"configured": True, "channels": [
        {"number": "4.1", "name": "NBC", "camera": "camera.live_tv_4_1", "now": "sensor.live_tv_4_1_now"},
        {"number": "5.1", "name": "FOX", "camera": "camera.live_tv_5_1", "now": None}]}
    assert [f for f in tv.fake.frames if f.get("type") == "hk_tv/channels"] == [{"type": "hk_tv/channels", "id": 1}]


async def test_the_channel_list_for_someone_without_cameras_is_empty(tv):
    assert await tv.reads.request("guest", {"type": "hk_tv/channels"}) == {"configured": True, "channels": []}


async def test_the_channel_list_refuses_extra_keys_and_the_writes(tv):
    for bad in ({"type": "hk_tv/channels", "entity_id": "camera.x"}, {"type": "hk_tv/watching", "channel": "4.1"},
                {"type": "hk_tv/settings/set", "changes": {}}):
        with pytest.raises(ReadBlocked):
            await tv.reads.request("adult", bad)
    assert tv.fake.frames == []


def test_tv_channels_handles_nonsense():
    assert rp.tv_channels(None, set()) == {"configured": False, "channels": []}
    assert rp.tv_channels({"configured": True, "channels": "x"}, set()) == {"configured": True, "channels": []}
    assert rp.tv_entities(TV_CHANNELS)[:2] == ["camera.live_tv_4_1", "sensor.live_tv_4_1_now"]


def test_a_refused_read_is_logged_once_per_five_minutes(caplog):
    rp._refused_at.clear()
    clock = [100.0]
    with caplog.at_level(logging.WARNING, logger="mantel.readproxy"):
        for _ in range(3):
            rp._warn_refused("'hk_tv/settings/get' is read by Mantel itself, never for a page", now=lambda: clock[0])
    assert sum("refused a read" in r.getMessage() for r in caplog.records) == 1
    rp._refused_at.clear()


# ------------------------------------------------------------------------------- re-import, on its own
class ImportProxy(FakeProxy):
    def __init__(self, panel_answer, pages=None):
        super().__init__({})
        self.panel, self.pages = panel_answer, pages or FEATURE_PAGES

    async def read_server(self, msg):
        self.asked.append(msg["type"])
        if msg["type"] == "hk_frontend/panel/get":
            return json.loads(json.dumps(self.panel))
        return json.loads(json.dumps(self.pages.get(msg["type"], {"configured": False})))


async def test_the_feature_import_again_is_owner_only_and_keeps_linked(make_env):
    env = await make_env(settings={"linked": {"enabled": False, "entry_id": "abc123"}})
    env.app["hub"].readproxy = proxy = ImportProxy(panel("music", "clean_areas", "live_tv"))
    await env.login("admin1", "admin")
    assert (await env.m.client.post("/api/features/import", headers=env.m.headers())).status == 403
    assert proxy.asked == []
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    assert (await feed(ws))["added"] == []
    r = await env.m.client.post("/api/features/import", headers=env.m.headers())
    body = await r.json()
    assert r.status == 200 and body["added"] == ["music", "live_tv", "clean_areas"]
    assert proxy.asked == ["hk_frontend/panel/get", "hk_clean_areas/settings/get", "hk_tv/settings/get",
                           "hk_music/settings/get"]          # Music: music.py's import (house/music)
    assert env.host.settings["linked"]["entry_id"] == "abc123"
    assert env.host.settings["clean_areas"]["options"]["areas"] == ["kitchen"]
    assert (await next_feed(ws))["added"] == ["music", "live_tv", "clean_areas"]
    hist = env.app["settings"].store.history("house", F.FEATURES_DOC)
    assert hist[0]["action"] == "import" and hist[0]["actor"] is not None
    await ws.close()
    assert env.audit() == [], "reads only: nothing audited, nothing sent"


async def test_the_feature_import_without_ha(make_env):
    env = await make_env()
    env.app["hub"].readproxy = None
    await env.login("owner1", "owner")
    r = await env.m.client.post("/api/features/import", headers=env.m.headers())
    assert r.status == 503


# ------------------------------------------------------------------------ the Energy plan, as HA's
class NotFoundProxy(FakeProxy):
    async def request(self, msg, **kw):
        self.asked.append(msg)
        raise RuntimeError("not_found")          # HA: no Energy settings were ever saved


async def test_no_energy_settings_in_ha_still_gives_a_plan(make_env):
    env = await make_env(settings={"energy": {"enabled": True}})
    env.app["hub"].readproxy = NotFoundProxy(None)
    plan = await env.host.refresh_energy(force=True)
    assert plan is not None and plan["title"] == "Energy" and env.host.energy_error is None


class _St:
    def __init__(self, eid, **attrs):
        self.entity_id, self.attributes, self.state = eid, attrs, "heat"


class _Ent:
    def __init__(self, eid, **kw):
        self.entity_id, self.area_id, self.device_id = eid, kw.get("area_id"), kw.get("device_id")
        self.hidden, self.disabled, self.entity_category = kw.get("hidden", False), False, kw.get("entity_category")


class _House:
    def __init__(self, states, ents):
        self._s, self._e = {s.entity_id: s for s in states}, {e.entity_id: e for e in ents}

    def states(self, domain):
        return [s for s in self._s.values() if s.entity_id.startswith(domain + ".")]

    def entity(self, eid):
        return self._e.get(eid)

    def device(self, _id):
        return None


def test_the_thermostats_are_found_as_has_status_and_chips_finds_them():
    house = _House([_St("climate.hall"), _St("climate.den"), _St("climate.hidden"),
                    _St("climate.group", entity_id=["x"]), _St("climate.attic")],
                   [_Ent("climate.hidden", hidden=True), _Ent("climate.attic", area_id="attic")])
    assert F.found_thermostats(house, {}) == ["climate.attic", "climate.den", "climate.hall"]
    assert F.found_thermostats(house, {"generated": {"exclude_areas": ["attic"]}}) == ["climate.den", "climate.hall"]
    assert F.found_thermostats(house, {"counts": {"thermostats": {"exclude": ["climate.den"],
                                                                  "include": ["climate.group"]}}}) \
        == ["climate.attic", "climate.hall", "climate.group"]
    assert F.found_thermostats(house, {"features": {"thermostats": ["climate.den", "climate.gone"]}}) == ["climate.den"]
    assert F.found_thermostats(house, {"accessories": {"entities": {"climate.hall": {"status": False}}}}) \
        == ["climate.attic", "climate.den"]
    got = F.energy_house(house, {"weather": {"outside": "sensor.out"}, "features": {"power": "sensor.p"}})
    assert got == {"thermostats": ["climate.attic", "climate.den", "climate.hall"], "outside": "sensor.out",
                   "power": "sensor.p"}
