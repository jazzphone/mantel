"""HK Settings -> Features on Mantel (mantel_server/pages/feature_pages.py): each feature's settings page read
from Mantel's own feature settings and House (Music and Alarm PIN: an interim, rebuilt read of HA's page),
and its saves checked by the shared checks and stored in Mantel's settings store (audited), never sent to
Home Assistant. Owners/Admins only. A FICTIONAL house and fakes only; house commands stay off."""
import json

import pytest

import gateway_fakes as GF
from mantel_server.pages import feature_pages as FP
from mantel_server import features as F
from mantel_server.ha.readproxy import SERVER_ONLY_READS
from test_features import (DOOR, MOTION, PREFS, VACUUM, FakeProxy, events, make_env,  # noqa: F401
                           next_event)

DOOR_ITEM = {"id": "n_door", "entity": DOOR, "when": "on", "title": "", "message": ""}


async def read(ws, rid, msg):
    await ws.send_json({"type": "read", "id": rid, "msg": msg})
    return await GF.recv(ws)


async def save(ws, rid, msg):
    await ws.send_json({"type": "settings_write", "id": rid, "msg": msg})
    while True:
        got = await GF.recv(ws)
        if got.get("type") == "settings_result" and got.get("id") == rid:
            return got


async def owner_socket(env, who=("owner1", "owner")):
    await env.login(*who)
    return await env.socket(expect_caps=False)


def test_every_page_read_has_exactly_one_rule_and_every_save_a_piece():
    assert set(FP.PAGE_RULES) == set(FP.PAGE_READS)
    from mantel_server.settings_store import FEATURE_SAVES
    assert set(FP.SAVES) == set(FEATURE_SAVES)
    # HA's own Music and Alarm PIN pages: read by Mantel only (the one-time music import; the Alarm PIN page
    # only while HK Frontend still runs the keypads)
    assert {"hk_music/settings/get", "hk_alarm_pin/settings/get"} <= SERVER_ONLY_READS


async def test_the_pages_are_answered_by_mantel_and_never_forwarded(make_env):
    env = await make_env(settings={"notifications": {"enabled": True, "items": [DOOR_ITEM]}})
    routes = env.app["read_routes"]
    assert all(routes[t].request.__module__ == FP.__name__ for t in FP.PAGE_READS)
    ws = await owner_socket(env)
    got = (await read(ws, 1, {"type": "hk_notify/settings/get"}))["result"]
    assert got["configured"] is True and got["state"] == "loaded"
    assert [i["id"] for i in got["items"]] == ["n_door"] and got["items"][0]["name"] == "Front Door"
    assert got["options"]["stay"] == 30 and got["limits"]["items"] > 0
    assert (await read(ws, 2, {"type": "hk_notify/settings/get", "fresh": True}))["result"]["configured"] is True
    assert (await read(ws, 3, {"type": "hk_notify/settings/get", "entry_id": "x"}))["error"]["code"] == "not_allowed"
    # a piece that is off reads as HA's "not added"
    assert (await read(ws, 4, {"type": "hk_clean_areas/settings/get"}))["result"] == {"configured": False}
    assert (await read(ws, 5, {"type": "hk_energy/settings/get"}))["result"] == {"configured": False}
    assert (await read(ws, 6, {"type": "hk_tv/settings/get"}))["result"] == {"configured": False}
    await ws.close()
    # an Adult may not configure the features (HA: admin only)
    ws = await owner_socket(env, ("adult1", "adult"))
    assert (await read(ws, 7, {"type": "hk_notify/settings/get"}))["error"]["code"] == "forbidden"
    got = await save(ws, 8, {"type": "hk_notify/settings/set", "changes": {"stay": 60}})
    assert got["error"]["code"] == "forbidden"
    await ws.close()
    assert env.audit() == []


async def test_notifications_saves_are_checked_and_stored_in_mantel(make_env):
    env = await make_env(settings={"notifications": {"enabled": True, "items": [DOOR_ITEM]}})
    ws = await owner_socket(env)
    got = await save(ws, 1, {"type": "hk_notify/settings/set", "changes": {"stay": 60}})
    assert got["result"]["options"]["stay"] == 60 and env.host.notifier.opts["stay"] == 60
    got = await save(ws, 2, {"type": "hk_notify/settings/set", "changes": {"stay": 7, "nope": 1}})
    assert got["error"]["code"] == "invalid_format"
    assert json.loads(got["error"]["message"]) == {"stay": "choice", "nope": "unknown"}
    # a new notification on an accessory, changed, then removed
    got = await save(ws, 3, {"type": "hk_notify/item/save", "changes": {"entity": MOTION}})
    new = got["result"]["saved"]
    assert new in [i["id"] for i in got["result"]["items"]]
    assert MOTION in env.host.notifier.cache, "the running notifications follow the save"
    got = await save(ws, 4, {"type": "hk_notify/item/save", "item": new, "changes": {"title": "Somebody's here"}})
    assert next(i for i in got["result"]["items"] if i["id"] == new)["title"] == "Somebody's here"
    assert (await save(ws, 5, {"type": "hk_notify/item/save", "item": "nope", "changes": {}}))["error"]["code"] == "not_found"
    got = await save(ws, 6, {"type": "hk_notify/item/save", "changes": {"category": "calendars"}})
    assert any(i.get("category") == "calendars" for i in env.host.settings["notifications"]["items"])
    got = await save(ws, 7, {"type": "hk_notify/item/remove", "item": new})
    assert new not in [i["id"] for i in got["result"]["items"]]
    assert (await save(ws, 8, {"type": "hk_notify/item/save"}))["error"]["code"] == "invalid_format"
    # versioned, with who made each change, in house/mantel_features -- never sent to HA
    hist = env.app["settings"].store.history("house", F.FEATURES_DOC)
    assert [h["message"] for h in hist[:5]] == ["hk_notify/item/remove", "hk_notify/item/save", "hk_notify/item/save",
                                                "hk_notify/item/save", "hk_notify/settings/set"]
    assert all(h["actor"] for h in hist[:5])
    assert env.audit() == [] and env.app["commander"] is None
    await ws.close()


async def test_notifications_test_is_mantels_own_delivery(make_env):
    env = await make_env(settings={"notifications": {"enabled": True, "items": [DOOR_ITEM]}})
    ws = await owner_socket(env)
    await events(env, ws)
    got = await save(ws, 1, {"type": "hk_notify/test", "item": "n_door"})
    ev = await next_event(ws)
    assert ev["type"] == "notification" and ev["test"] is True and got["result"]["sent"] == ev["id"]
    assert (await save(ws, 2, {"type": "hk_notify/test", "item": "nope"}))["error"]["code"] == "not_found"
    assert env.audit() == []
    await ws.close()


async def test_a_feature_that_is_off_refuses_its_saves(make_env):
    env = await make_env()
    ws = await owner_socket(env)
    assert (await save(ws, 1, {"type": "hk_notify/settings/set", "changes": {"stay": 60}}))["error"]["code"] == "not_set_up"
    # Music with no settings in Mantel yet: nothing to change (Music Assistant isn't in Mantel here)
    assert (await save(ws, 2, {"type": "hk_music/preset/save", "name": "x",
                               "members": []}))["error"]["code"] == "not_set_up"
    await ws.close()


async def test_clean_areas_page_and_save(make_env):
    env = await make_env(settings={"clean_areas": {"enabled": True}})
    ws = await owner_socket(env)
    got = (await read(ws, 1, {"type": "hk_clean_areas/settings/get"}))["result"]
    assert got["configured"] is True and [v["vacuum"] for v in got["vacuums"]] == [VACUUM]
    assert got["offered"] == ["kitchen"] and got["areas"][0]["id"] == "kitchen" and got["areas"][0]["by"]
    got = await save(ws, 2, {"type": "hk_clean_areas/settings/set", "changes": {"vacuums": [VACUUM], "areas": ["kitchen"]}})
    assert got["result"]["chosen_vacuums"] == [VACUUM] and env.host.settings["clean_areas"]["options"]["areas"] == ["kitchen"]
    got = await save(ws, 3, {"type": "hk_clean_areas/settings/set", "changes": {"vacuums": ["vacuum.nope"]}})
    assert json.loads(got["error"]["message"]) == {"vacuums": FP.CA_MSG["vacuums"]}
    await ws.close()


async def test_energy_page_and_saves(make_env):
    env = await make_env(settings={"energy": {"enabled": True}})
    env.app["hub"].readproxy = FakeProxy(PREFS)
    env.app["hub"].store.apply_event({"a": {
        "sensor.grid_import": {"s": "1200", "a": {"unit_of_measurement": "kWh", "device_class": "energy"}, "lc": 1.0},
        "sensor.coffee_energy": {"s": "3.2", "a": {"unit_of_measurement": "kWh", "friendly_name": "Office Coffee"},
                                 "lc": 1.0}}})
    ws = await owner_socket(env)
    got = (await read(ws, 1, {"type": "hk_energy/settings/get"}))["result"]
    assert got["configured"] is True and got["plan"] and "sensor.coffee_energy" in [d["key"] for d in got["devices"]]
    assert got["energy"]["devices"] == 1 and got["colors"]
    got = await save(ws, 2, {"type": "hk_energy/settings/set", "changes": {"title": "Power"}})
    assert got["result"]["options"]["title"] == "Power"
    got = await save(ws, 3, {"type": "hk_energy/device/set", "key": "sensor.coffee_energy", "changes": {"name": "Coffee"}})
    assert env.host.settings["energy"]["options"]["devices"]["sensor.coffee_energy"] == {"name": "Coffee"}
    sec = got["result"]["sections"][0]["id"]
    got = await save(ws, 4, {"type": "hk_energy/device/section", "key": "sensor.coffee_energy", "section": sec})
    assert "error" not in got
    got = await save(ws, 5, {"type": "hk_energy/settings/set", "changes": {"follow": "yes"}})
    assert got["error"]["code"] == "invalid_format" and "follow" in json.loads(got["error"]["message"])
    got = await save(ws, 6, {"type": "hk_energy/device/section", "key": "nope", "section": sec})
    assert json.loads(got["error"]["message"]) == {"key": "That device couldn’t be read."}
    await ws.close()


async def test_live_tv_page_and_save(make_env):
    env = await make_env(settings={"ha": {"added": ["live_tv"]},
                                   "live_tv": {"tuner": "192.0.2.40", "channels": ["4.1", "5.1"], "names": {"4.1": "NBC"}}})
    ws = await owner_socket(env)
    got = (await read(ws, 1, {"type": "hk_tv/settings/get"}))["result"]
    assert got["configured"] is True and got["host"] == "192.0.2.40" and got["lineup"] is None
    assert got["channels"] == [{"number": "4.1", "name": "NBC"}, {"number": "5.1", "name": "5.1"}]
    assert got["lineup_error"] == FP.TV_MSG["no_lineup"], "no tuner is read for the page"
    assert got["ha_link"] is False, "the page leaves out HK Frontend's integration"
    got = await save(ws, 2, {"type": "hk_tv/settings/set", "changes": {"names": {"5.1": "CBS"}}})
    assert got["result"]["channels"][1] == {"number": "5.1", "name": "CBS"}
    got = await save(ws, 3, {"type": "hk_tv/settings/set", "changes": {"channels": ["4.1"]}})
    assert env.host.settings["live_tv"]["channels"] == ["4.1"] and "5.1" not in env.host.settings["live_tv"]["names"]
    got = await save(ws, 4, {"type": "hk_tv/settings/set", "changes": {"channels": ["9.1"]}})
    assert json.loads(got["error"]["message"]) == {"channels": FP.TV_MSG["no_lineup"]}
    got = await save(ws, 5, {"type": "hk_tv/settings/set", "changes": {"quality": "1080"}})
    assert got["result"]["quality"] == "1080" and env.host.settings["live_tv"]["quality"] == "1080", \
        "Mantel's transcode's picture: kept in Mantel (live_tv.py reads it)"
    got = await save(ws, 7, {"type": "hk_tv/settings/set", "changes": {"quality": "4k"}})
    assert json.loads(got["error"]["message"]) == {"quality": FP.TV_MSG["quality"]}
    got = await save(ws, 6, {"type": "hk_tv/settings/set", "changes": {"guide_url": "file:///etc/passwd"}})
    assert json.loads(got["error"]["message"]) == {"guide_url": FP.TV_MSG["guide_url"]}
    await ws.close()


class HaPages:
    def __init__(self):
        self.asked = []

    async def read_server(self, msg):
        self.asked.append(msg["type"])
        if msg["type"] == "hk_music/settings/get":
            return {"configured": True, "state": "loaded", "volume": 0.4, "users": [{"id": "u1", "name": "Jamie", "pw": "x"}],
                    "speakers": [{"entity": "media_player.kitchen", "name": "Kitchen", "floor": "Main", "player": "K",
                                  "token": "secret"}], "homes": {"u1": "media_player.kitchen", "u2": "javascript:x"},
                    "presets": [], "playlists": [], "players": [], "library_ready": True, "keep_ready": False,
                    "ma_token": "should never pass"}
        return {"configured": True, "min_length": 4, "hash": "never",
                "alarms": [{"entry_id": "01JALARM", "title": "House", "alarm": "alarm_control_panel.house",
                            "pin_set": True, "hash": "$argon2$never", "pin": "1234"}], "choices": []}

    async def close(self):
        pass


async def test_music_page_is_mantels_and_imports_hks_once(make_env):
    """With no house/music yet and HK Frontend's Music in HA: imported ONCE (a server-only read), then answered
    from Mantel's own document, never HA's again; its saves are Mantel's, versioned."""
    env = await make_env()
    env.app["hub"].readproxy = proxy = HaPages()
    ws = await owner_socket(env)
    music = (await read(ws, 1, {"type": "hk_music/settings/get"}))["result"]
    assert music["configured"] is True and music["volume"] == 0.4 and "ma_token" not in json.dumps(music)
    assert [s["entity"] for s in music["speakers"]] == ["media_player.kitchen"]
    assert proxy.asked == ["hk_music/settings/get"]
    doc = env.app["settings"].store.get("house", "music")
    assert doc is not None and doc.version == 1
    again = (await read(ws, 2, {"type": "hk_music/settings/get"}))["result"]
    assert again["volume"] == 0.4 and proxy.asked == ["hk_music/settings/get"], "imported once, then Mantel's"
    got = await save(ws, 3, {"type": "hk_music/settings/set", "changes": {"volume": 0.25}})
    assert got["result"]["volume"] == 0.25
    assert env.app["settings"].store.get("house", "music").version == 2
    got = await save(ws, 4, {"type": "hk_music/settings/set", "changes": {"volume": 7}})
    assert "volume" in json.loads(got["error"]["message"]), "refused by field, as HA's page was"
    # a playlist: without Music Assistant in Mantel its songs aren't checked against the library (HA's form, too)
    got = await save(ws, 5, {"type": "hk_music/playlist/save", "name": "Dinner", "items": ["library://playlist/7"]})
    assert "result" in got, got
    assert [p["name"] for p in got["result"]["playlists"]] == ["Dinner"]
    pid = got["result"]["playlists"][0]["id"]
    got = await save(ws, 6, {"type": "hk_music/item/remove", "item": pid})
    assert got["result"]["playlists"] == []
    assert set(json.loads((await save(ws, 9, {"type": "hk_music/item/remove", "item": pid}))["error"]["message"])) \
        == {"item"}, "a gone item is refused by field"
    assert proxy.asked == ["hk_music/settings/get"], "no save went to Home Assistant"
    await ws.close()
    ws = await owner_socket(env, ("adult1", "adult"))
    assert (await read(ws, 7, {"type": "hk_music/settings/get"}))["error"]["code"] == "forbidden"
    assert (await save(ws, 8, {"type": "hk_music/settings/set", "changes": {"volume": 0.1}}))["error"]["code"] == "forbidden"
    await ws.close()


async def test_music_page_without_hk_or_music_assistant_is_not_added(make_env):
    env = await make_env()
    env.app["hub"].readproxy = None
    ws = await owner_socket(env)
    assert (await read(ws, 1, {"type": "hk_music/settings/get"}))["result"] == {"configured": False}
    await ws.close()


def test_has_pages_are_rebuilt_from_their_known_keys_only():
    assert FP.music_page({"configured": False, "users": [1]}) == {"configured": False}
    assert FP.alarm_pin_page("nonsense") == {"configured": False, "alarms": [], "choices": []}


# -- Add and Remove on Mantel itself (2026-11-02) ---------------------------------------------------------------------
async def test_an_owner_adds_and_removes_a_feature_on_mantel_itself(make_env):
    """The owner: "I would hate for a user to set up Mantel and not have access to enable the features it has!" Each
    feature's page on Mantel adds and removes it there (`<id>/feature/set`), saved in Mantel's feature settings and
    audited; removing a feature Home Assistant had added takes it off Mantel's screens too."""
    env = await make_env(settings={"ha": {"added": ["alarm_pin"], "items": {}, "source": None}})
    host = env.app["features"]
    assert "clean_areas" not in host.client_added() and "alarm_pin" in host.client_added()
    ws = await owner_socket(env)
    got = (await save(ws, 1, {"type": "hk_clean_areas/feature/set", "enabled": True}))["result"]
    assert got == {"feature": "clean_areas", "added": True} and "clean_areas" in host.client_added()
    feats = host.panel_features()
    assert feats["hk_clean_areas"]["entries"] and feats["hk_clean_areas"]["own"] is True
    assert (await save(ws, 2, {"type": "hk_music/feature/set", "enabled": True}))["result"]["added"] is True
    got = (await save(ws, 3, {"type": "hk_alarm_pin/feature/set", "enabled": False}))["result"]
    assert got == {"feature": "alarm_pin", "added": False} and "alarm_pin" not in host.settings["ha"]["added"]
    assert (await save(ws, 4, {"type": "hk_tv/feature/set", "enabled": "yes"}))["error"]["code"] == "invalid_format"
    await ws.close()
    # an Adult may not
    ws = await owner_socket(env, ("adult1", "adult"))
    assert (await save(ws, 5, {"type": "hk_energy/feature/set", "enabled": True}))["error"]["code"] == "forbidden"
    await ws.close()
    assert "energy" not in host.client_added()


async def test_a_persons_add_or_remove_is_final_for_mantels_own_turn_on(make_env):
    """Features on by default (features/auto.py): Add or Remove writes the `owner` marker in the same version, so
    Mantel never turns that feature on by itself afterwards; the Alarm PIN and Notifications never get one."""
    env = await make_env()
    host, st = env.app["features"], env.app["settings"].store
    ws = await owner_socket(env)
    await save(ws, 1, {"type": "hk_energy/feature/set", "enabled": True})
    top = st.history("house", F.FEATURES_DOC, bodies=True)[0]
    assert top["body"]["energy"]["enabled"] is True
    assert top["body"]["auto"]["decided"]["energy"]["by"] == "owner", "in the same version as the choice"
    await save(ws, 2, {"type": "hk_energy/feature/set", "enabled": False})
    assert host.settings["auto"]["decided"]["energy"]["why"] == "Removed by a person"
    await save(ws, 3, {"type": "hk_music/feature/set", "enabled": False})       # off already: still a choice
    assert host.settings["auto"]["decided"]["music"]["by"] == "owner"
    await save(ws, 4, {"type": "hk_notify/feature/set", "enabled": True})
    assert set(host.settings["auto"]["decided"]) == {"energy", "music"}
    await ws.close()


async def test_turn_features_on_automatically_is_a_save_of_its_own(make_env):
    """Advanced -> Features' switch (`mantel/features/auto/set`): Owner and Admin (configure on settings), saved in
    the settings history, shown in panel/get only where Mantel holds the features; it changes no marker."""
    env = await make_env()
    host, st = env.app["features"], env.app["settings"].store
    ws = await owner_socket(env)
    got = await read(ws, 1, {"type": "hk_frontend/panel/get"})
    assert got["result"]["features_auto"] == {"enabled": True, "save": "mantel/features/auto/set"}
    got = await save(ws, 2, {"type": "mantel/features/auto/set", "enabled": False})
    assert got["result"] == {"enabled": False} and host.settings["auto"]["enabled"] is False
    assert host.settings["auto"]["decided"] == {}
    assert st.history("house", F.FEATURES_DOC)[0]["message"] == "mantel/features/auto/set"
    assert (await save(ws, 3, {"type": "mantel/features/auto/set", "enabled": "no"}))["error"]["code"] == "invalid_format"
    assert (await save(ws, 4, {"type": "mantel/features/auto/set"}))["error"]["code"] == "invalid_format"
    await ws.close()
    ws = await owner_socket(env, ("adult1", "adult"))
    assert (await save(ws, 5, {"type": "mantel/features/auto/set", "enabled": True}))["error"]["code"] == "forbidden"
    await ws.close()
    assert host.settings["auto"]["enabled"] is False
