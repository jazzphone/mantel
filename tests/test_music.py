"""Phase 4: whole-home music on Mantel, talking to Music Assistant directly (mantel_server/music.py).

Against a fake Music Assistant (tests/music_fakes.py) that records every frame and moves the players' states
the way HA's music_assistant integration reports them. Covers: the exact MA messages each request sends,
RBAC (feature music; players the person may view; settings need configure), the per-person and per-device
home room, commands off (refused, nothing reaches MA), the gate (a request's MusicRun), the switch to the
interim bridge, the import, and Keep Playlists Ready's server-only reads. Fictional house; nothing real is
contacted.
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

import gateway_fakes as GF
import music_fakes as MF
from conftest import Mantel
from connector_fakes import MA_TOKEN, wait_for
from mantel_server import music as M
from mantel_server.connectors import REFUSE_ALL
from mantel_server.connectors.ma import (MA_COMMANDS, MA_READS, MA_SERVER_READS, CommandRefused, MaBlocked,
                                         check_outgoing)
from mantel_server.settings_store import Actor


# ------------------------------------------------------------------------------------------- the house
async def build(tmp_path, monkeypatch, *, commands: bool, ma: bool = True, doc: bool = True):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("music tests attempted to reach Home Assistant")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    for name, value in (("START_TIMEOUT", 1.0), ("JOIN_TIMEOUT", 1.0), ("RELEASE_TIMEOUT", 1.0),
                        ("PAUSE_TIMEOUT", 1.0), ("TRANSFER_TIMEOUT", 1.0), ("STOP_TIMEOUT", 1.0)):
        monkeypatch.setattr(M, name, value)
    fake = MF.HouseMa()
    server = TestServer(fake.app())
    await server.start_server()
    token = tmp_path / "secrets" / "ma_token"
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text(MA_TOKEN)
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, commands_enabled=commands,
                 ma_url=str(server.make_url("/ws")) if ma else "", ma_token_file=token)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    hub = app["hub"]
    hub.registry.load(MF.AREAS, [], MF.ENTITIES, MF.FLOORS)
    hub.store.apply_event({"a": MF.states()})
    fake.hub = hub
    app["music"].engine.settle = 0.0
    if doc:
        app["settings"].store.write([("house", M.MUSIC_DOC, json.loads(json.dumps(MF.DOC)))], actor=Actor(label="test"))
    commander = None
    if commands:
        commander = GF.FakeCommander(app["gateway"].writes)
        app["gateway"].commander = commander
    return app, store, now, commander, fake, server


class Env(GF.Env):
    def __init__(self, mantel, commander, fake):
        super().__init__(mantel, commander)
        self.ma = fake

    async def read(self, ws, msg, rid=50):
        await ws.send_json({"type": "read", "id": rid, "msg": msg})
        while True:
            got = await GF.recv(ws)
            if got.get("id") == rid and got.get("type") == "read_result":
                return got

    async def subscribe(self, ws, msg, rid=60):
        await ws.send_json({"type": "read_subscribe", "id": rid, "msg": msg})
        result = event = None
        while result is None or event is None:
            got = await GF.recv(ws)
            if got.get("id") != rid:
                continue
            if got.get("type") == "read_result":
                result = got
                if "error" in got:
                    return got, None
            elif got.get("type") == "read_event":
                event = got["event"]
        return result, event

    async def connected(self):
        await wait_for(lambda: self.app["ma"].connected.is_set())
        await wait_for(lambda: self.app["music"].states.on)

    async def playing(self, entity, s="playing", **attrs):
        """A speaker plays in Music Assistant, and Mantel's state for it says so."""
        await self.ma.set(entity, s, **attrs)
        await wait_for(lambda: self.app["hub"].store.states[entity]["s"] == s)

    def link(self, username: str, ha_user_id: str) -> str:
        db = self.app["accounts"].db
        uid = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]
        with db:
            db.execute("INSERT INTO ha_links (ha_user_id, user_id, created) VALUES (?,?,?)", (ha_user_id, uid, 1.0))
        return uid


def fixture(commands: bool, ma: bool = True, doc: bool = True):
    @pytest.fixture
    async def env(tmp_path, monkeypatch):
        app, store, now, commander, fake, server = await build(tmp_path, monkeypatch, commands=commands, ma=ma, doc=doc)
        async with TestClient(TestServer(app)) as client:
            origin = str(client.make_url("")).rstrip("/")
            client.session.headers["Origin"] = origin
            yield Env(Mantel(app, client, store, now, origin), commander, fake)
        await server.close()
        store.db.close()
    return env


on = fixture(commands=True)
off = fixture(commands=False)
bridge = fixture(commands=True, ma=False)
no_doc = fixture(commands=False, doc=False)


def play(rooms, playlist="pl1", **extra):
    return {"kind": "service", "domain": "hk_frontend", "service": "music_play",
            "data": {"rooms": rooms, "playlist": playlist}, "return_response": True, **extra}


# ------------------------------------------------------------------------------------------- pure pieces
def test_to_ma_is_what_has_music_assistant_integration_sends():
    pid = MF.PID.__getitem__
    k, d = "media_player.kitchen_ma", "media_player.den_ma"
    assert M.to_ma("media_player", "media_pause", {"entity_id": [k, d]}, pid) == [
        ("players/cmd/pause", {"player_id": "ma-kitchen"}), ("players/cmd/pause", {"player_id": "ma-den"})]
    assert M.to_ma("media_player", "unjoin", {"entity_id": [k]}, pid) == [("players/cmd/ungroup", {"player_id": "ma-kitchen"})]
    assert M.to_ma("media_player", "join", {"entity_id": k, "group_members": [d]}, pid) == [
        ("players/cmd/group_many", {"target_player": "ma-kitchen", "child_player_ids": ["ma-den"]})]
    assert M.to_ma("media_player", "volume_set", {"entity_id": k, "volume_level": 0.35}, pid) == [
        ("players/cmd/volume_set", {"player_id": "ma-kitchen", "volume_level": 35})]
    assert M.to_ma("media_player", "shuffle_set", {"entity_id": k, "shuffle": True}, pid) == [
        ("player_queues/shuffle", {"queue_id": "ma-kitchen", "shuffle_enabled": True})]
    assert M.to_ma("music_assistant", "play_media", {"entity_id": k, "media_id": ["library://playlist/1"],
                                                     "enqueue": "replace"}, pid) == [
        ("player_queues/play_media", {"queue_id": "ma-kitchen", "media": ["library://playlist/1"], "option": "replace"})]
    assert M.to_ma("music_assistant", "transfer_queue", {"entity_id": d, "source_player": k, "auto_play": True}, pid) == [
        ("player_queues/transfer", {"source_queue_id": "ma-kitchen", "target_queue_id": "ma-den", "auto_play": True})]
    assert M.to_ma("media_player", "play_media", {"entity_id": k, "media_content_id": "library://track/9",
                                                  "media_content_type": "music"}, pid) == [
        ("player_queues/play_media", {"queue_id": "ma-kitchen", "media": ["library://track/9"], "option": "play"})]
    with pytest.raises(KeyError):
        M.to_ma("media_player", "media_pause", {"entity_id": ["media_player.tv"]}, pid)
    with pytest.raises(KeyError):
        M.to_ma("light", "turn_on", {"entity_id": "light.x"}, pid)
    # every command the engine may send is in the MA catalog, and never a read
    for c in M.RUN_COMMANDS:
        assert c in MA_COMMANDS and c not in MA_READS


def test_a_music_run_allows_its_own_commands_on_the_houses_speakers_only():
    run = M.MusicRun("someone", 7, {"ma-kitchen", "ma-den"})
    assert run.allow("players/cmd/pause", {"player_id": "ma-kitchen"})
    assert run.allow("players/cmd/group_many", {"target_player": "ma-kitchen", "child_player_ids": ["ma-den"]})
    assert not run.allow("players/cmd/group_many", {"target_player": "ma-kitchen", "child_player_ids": ["ma-garage"]})
    assert not run.allow("players/cmd/pause", {"player_id": "ma-garage"})          # not one of the house's speakers
    assert not run.allow("players/cmd/power", {"player_id": "ma-kitchen"})         # not one of the engine's commands
    assert not run.allow("players/cmd/play_announcement", {"player_id": "ma-kitchen", "url": "x"})
    run.open = False
    assert not run.allow("players/cmd/pause", {"player_id": "ma-kitchen"})         # the request is over
    assert not M.MusicRun("someone", 0, {"ma-kitchen"}).allow("players/cmd/pause", {"player_id": "ma-kitchen"})


def test_server_only_reads_are_never_a_pages():
    frame = {"message_id": "1", "command": "music/playlists/playlist_tracks",
             "args": {"item_id": "1", "provider_instance_id_or_domain": "library", "force_refresh": True}}
    with pytest.raises(MaBlocked):
        check_outgoing(frame)                                         # the page path (ma/read): refused
    check_outgoing(frame, server=True)                                # Mantel's own Keep Playlists Ready
    with pytest.raises(MaBlocked):
        check_outgoing({"message_id": "1", "command": "players/cmd/pause", "args": {"player_id": "x"}}, server=True)
    assert not set(MA_SERVER_READS) & set(MA_COMMANDS)


def test_the_doc_is_checked_and_the_import_maps_has_page():
    assert M.check_doc(MF.DOC)["items"][0]["key"] == "pre1"
    for bad in ({"options": {"speakers": ["light.kitchen"]}}, {"options": {"volume": 2}},
                {"items": [{"kind": "preset", "key": "x", "data": {"group": "media_player.a", "members": "no"}}]},
                {"items": [{"kind": "other", "key": "x"}]}):
        with pytest.raises(ValueError):
            M.check_doc(bad)
    page = {"configured": True, "speakers": [{"entity": "media_player.kitchen_ma"}, {"entity": "bad id"}],
            "volume": 0.4, "homes": {"ha-user-1": "media_player.kitchen_ma", "ha-user-2": "media_player.elsewhere"},
            "users": [{"id": "ha-user-1", "name": "Somebody"}], "keep_ready": True, "ignore_announcements": False,
            "presets": [{"id": "01HPRESET", "name": "All", "group": "media_player.all_ma",
                         "members": ["media_player.kitchen_ma"]}, {"id": None, "name": "broken"}],
            "playlists": [{"id": "01HPLAY", "name": "Jazz", "icon": "mdi:saxophone", "items": ["library://playlist/1"],
                           "chooser": "Moods", "order": 10}]}
    doc = M.import_page(page, "ha:entry")
    assert doc["options"] == {"speakers": ["media_player.kitchen_ma"], "volume": 0.4,
                              "homes": {"ha:ha-user-1": "media_player.kitchen_ma"}, "keep_ready": True,
                              "ignore_announcements": False}
    assert [i["key"] for i in doc["items"]] == ["01HPRESET", "01HPLAY"]
    assert doc["items"][1]["title"] == "Moods · Jazz" and doc["items"][1]["data"]["chooser"] == "Moods"
    assert "users" not in json.dumps(doc), "HA's user names are not kept"
    assert M.import_page({"configured": False}) is None


def test_home_room_is_the_persons_then_the_wall_tablets():
    class Host(M.MusicHost):
        def __init__(self):
            from mantel_server.registry import Registry
            from mantel_server.state import StateStore
            st, reg = StateStore(), Registry()
            reg.load(MF.AREAS, [], MF.ENTITIES, MF.FLOORS)
            st.apply_event({"a": MF.states()})
            self.house = M.MantelHouse(st, reg)
            self._doc = M.check_doc({**MF.DOC, "options": {**MF.DOC["options"], "homes": {
                "u-adult": "media_player.kitchen_ma", "ha:ha-owner": "media_player.den_ma",
                "u-stale": "media_player.not_a_speaker"}}})
            self.hub = SimpleNamespace(registry=reg)

        def doc(self):
            return self._doc

    host = Host()
    cfg = host.config()
    user = lambda uid, ha=None: SimpleNamespace(id=uid, ha_user_id=ha)       # noqa: E731
    who = lambda u=None, room=None: SimpleNamespace(user=u, device=SimpleNamespace(room=room) if room else None)  # noqa: E731
    assert host.home_for(who(user("u-adult")), cfg) == "media_player.kitchen_ma"           # chosen in Mantel
    assert host.home_for(who(user("u-owner", "ha-owner")), cfg) == "media_player.den_ma"    # their HA user's
    assert host.home_for(who(user("u-nobody")), cfg) is None
    assert host.home_for(who(None, "cody_room"), cfg) == "media_player.cody_ma"             # the wall tablet's room
    assert host.home_for(who(user("u-nobody"), "kitchen"), cfg) == "media_player.kitchen_ma"
    assert host.home_for(who(user("u-adult"), "cody_room"), cfg) == "media_player.kitchen_ma"   # the person first
    assert host.home_for(who(None, "porch"), cfg) is None                                   # no speaker there
    assert host.home_for(who(user("u-stale")), cfg) is None


# ------------------------------------------------------------------------------------------- the reads
async def test_the_feed_is_per_person_and_answered_by_mantel(off):
    await off.connected()
    await off.m.user("owner1", "owner")
    off.link("owner1", "ha-owner")
    await off.login("owner1", "owner")
    ws = await off.socket(expect_caps=False)
    res, ev = await off.subscribe(ws, {"type": "hk_music/subscribe"})
    assert "error" not in res
    assert ev["configured"] is True and ev["home"] == "media_player.den_ma"
    assert ev["library_entry"] == MF.MA_ENTRY and ev["announcements"] == []
    assert [s["entity"] for s in ev["speakers"]] == ["preset:pre1", "media_player.kitchen_ma",
                                                     "media_player.den_ma", "media_player.cody_ma"]
    assert ev["floors"] == [{"name": "Main Floor", "entities": ["media_player.kitchen_ma", "media_player.den_ma"]},
                            {"name": "Upstairs", "entities": ["media_player.cody_ma"]}]
    assert [p["key"] for p in ev["playlists"]] == ["pl1", "pl_gone"] and ev["volume"] == 0.3
    # a settings save reaches the feed (the owner is chosen a new home room in Mantel)
    uid = off.app["accounts"].db.execute("SELECT id FROM users WHERE username='owner1'").fetchone()["id"]
    doc = json.loads(json.dumps(MF.DOC))
    doc["options"]["homes"][uid] = "media_player.kitchen_ma"
    off.app["settings"].store.write([("house", M.MUSIC_DOC, doc)], actor=Actor(label="test"))
    off.app["music"].changed()
    ev2 = None
    while ev2 is None:
        got = await GF.recv(ws)
        if got.get("type") == "read_event" and got.get("id") == 60:
            ev2 = got["event"]
    assert ev2["home"] == "media_player.kitchen_ma"
    await ws.close()
    assert [c for c in off.ma.commands() if c != "auth"] == [], "the feed reads Mantel's own settings, not MA"


async def test_a_child_sees_only_the_players_in_their_rooms(off):
    await off.m.user("cody", "child")
    uid = off.app["accounts"].db.execute("SELECT id FROM users WHERE username='cody'").fetchone()["id"]
    off.app["rbac"].set_scopes("user", uid, ["cody_room"])
    doc = json.loads(json.dumps(MF.DOC))
    doc["options"]["homes"] = {uid: "media_player.kitchen_ma"}        # a home room they may not see
    off.app["settings"].store.write([("house", M.MUSIC_DOC, doc)], actor=Actor(label="test"))
    await off.login("cody", "child")
    ws = await off.socket(expect_caps=False)
    _res, ev = await off.subscribe(ws, {"type": "hk_music/subscribe"})
    assert [s["entity"] for s in ev["speakers"]] == ["media_player.cody_ma"]
    assert ev["floors"] == [{"name": "Upstairs", "entities": ["media_player.cody_ma"]}]
    assert ev["home"] is None
    got = await off.read(ws, {"type": "hk_music/queue", "entity_id": "media_player.kitchen_ma"})
    assert got["error"]["code"] == "not_found"
    await ws.close()


async def test_a_wall_tablets_feed_has_its_rooms_speaker_as_home(off):
    await off.login("owner1", "owner")
    r = await off.m.post("/api/devices/enroll", {"name": "Cody's tablet", "room": "cody_room"})
    assert r.status == 201
    ws = await off.socket(expect_caps=False)            # the device alone now
    res, ev = await off.subscribe(ws, {"type": "hk_music/subscribe"})
    assert "error" not in res, res
    assert ev["home"] == "media_player.cody_ma"
    assert [s["entity"] for s in ev["speakers"]] == ["media_player.cody_ma"], "its room's speakers (area grants)"
    await ws.close()


async def test_a_guest_may_not_use_music(off):
    await off.login("gwen", "guest")
    ws = await off.socket(expect_caps=False)
    res, _ev = await off.subscribe(ws, {"type": "hk_music/subscribe"})
    assert res["error"]["code"] == "forbidden"
    got = await off.read(ws, {"type": "hk_music/settings/library"})
    assert got["error"]["code"] == "forbidden"
    await ws.close()


async def test_the_queue_and_the_library_come_from_music_assistant(off):
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    got = (await off.read(ws, {"type": "hk_music/queue", "entity_id": "media_player.kitchen_ma", "limit": 5}))["result"]
    assert got == {"ok": True, "queue_id": "ma-kitchen", "index": 2, "items": [
        {"id": "qi-3", "title": "Song Three", "artist": "Band", "duration": 200, "image": "https://img.example/3.jpg"},
        {"id": "qi-4", "title": "Song Four", "artist": "", "duration": 180, "image": None}]}
    lib = (await off.read(ws, {"type": "hk_music/settings/library"}, rid=51))["result"]
    assert lib == {"items": [{"uri": "library://playlist/1", "name": "Morning Mix"},
                             {"uri": "library://playlist/2", "name": "Evening"}]}
    reads = [(f["command"], f["args"]) for f in off.ma.frames if f["command"] not in {"auth", *MF.OVERLAY_READS}]
    assert reads == [("player_queues/get_active_queue", {"player_id": "ma-kitchen"}),
                     ("player_queues/items", {"queue_id": "ma-kitchen", "limit": 5, "offset": 2}),
                     ("music/playlists/library_items", {"limit": 500, "order_by": "name"})]
    bad = await off.read(ws, {"type": "hk_music/queue", "entity_id": "light.kitchen"}, rid=52)
    assert bad["error"]["code"] == "not_allowed"
    bad = await off.read(ws, {"type": "hk_music/queue", "entity_id": "media_player.kitchen_ma", "limit": 500}, rid=53)
    assert bad["error"]["code"] == "not_allowed"
    await ws.close()


async def test_the_settings_page_needs_configure(off):
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    assert (await off.read(ws, {"type": "hk_music/settings/get"}))["error"]["code"] == "forbidden"
    await ws.close()
    await off.m.user("owner1", "owner")
    off.link("owner1", "ha-owner")
    await off.login("owner1", "owner")
    ws = await off.socket(expect_caps=False)
    page = (await off.read(ws, {"type": "hk_music/settings/get"}, rid=51))["result"]
    uid = off.app["accounts"].db.execute("SELECT id FROM users WHERE username='owner1'").fetchone()["id"]
    assert page["configured"] and page["homes"] == {uid: "media_player.den_ma"}      # the linked HA user's home
    assert {"id": uid, "name": "Owner1"} in page["users"]
    assert [p["entity"] for p in page["players"]] == sorted(
        ["media_player.cody_ma", "media_player.den_ma", "media_player.downstairs_ma", "media_player.garage_ma",
         "media_player.kitchen_ma", "media_player.study_left_ma", "media_player.study_pair_ma",
         "media_player.study_right_ma"], key=lambda e: page["players"] and next(
            p["name"] for p in page["players"] if p["entity"] == e).casefold())
    assert "media_player.tv" not in json.dumps(page["players"])                     # not a Music Assistant player
    assert page["library_ready"] is True and page["keep_ready"] is False
    await ws.close()


async def test_without_music_assistant_the_reads_go_to_the_bridge(bridge):
    calls = []

    async def fake_request(identity, msg):
        calls.append(("request", msg["type"]))
        return {"items": []}

    async def fake_subscribe(identity, msg, on_event):
        calls.append(("subscribe", msg["type"]))
        on_event({"configured": False})

        async def unsub():
            pass
        return unsub

    bridge.app["filtered_reads"].request = fake_request
    bridge.app["filtered_reads"].subscribe = fake_subscribe
    assert bridge.app["music"].active is False
    await bridge.login("jamie", "adult")
    ws = await bridge.socket()
    _res, ev = await bridge.subscribe(ws, {"type": "hk_music/subscribe"})
    await bridge.read(ws, {"type": "hk_music/queue", "entity_id": "media_player.kitchen_ma"})
    await bridge.read(ws, {"type": "hk_music/settings/library"}, rid=51)
    got = await bridge.read(ws, {"type": "hk_music/settings/get"}, rid=52)
    assert ev == {"configured": False} and got["error"]["code"] == "forbidden"       # feature_pages: Owner/Admin only
    assert calls == [("subscribe", "hk_music/subscribe"), ("request", "hk_music/queue"),
                     ("request", "hk_music/settings/library")]
    # and the actions go to HA's engine, as before (RBAC now on the rooms, not `configure`)
    reply = await bridge.command(ws, **play(["media_player.kitchen_ma"]))
    assert "result" in reply, reply
    assert bridge.fake.frames[-1] == {"type": "call_service", "domain": "hk_frontend", "service": "music_play",
                                      "service_data": {"rooms": ["media_player.kitchen_ma"], "playlist": "pl1"},
                                      "return_response": True}
    await ws.close()


async def test_without_hk_frontend_in_ha_the_feed_says_not_set_up_once(bridge):
    """A Home Assistant without HK Frontend answers hk_music/subscribe with unknown_command. With Mantel's own engine
    off too, the page gets one "not set up" event and an open subscription, never an error to retry forever."""
    asked = []

    async def unknown(identity, msg, on_event):
        asked.append(msg["type"])
        raise RuntimeError("unknown_command")

    bridge.app["filtered_reads"].subscribe = unknown
    await bridge.login("jamie", "adult")
    ws = await bridge.socket()
    res, ev = await bridge.subscribe(ws, {"type": "hk_music/subscribe"})
    assert "error" not in res and ev == {"configured": False} and asked == ["hk_music/subscribe"]
    await ws.close()


async def test_the_settings_page_is_one_path_mantels_when_on_has_otherwise(on, monkeypatch):
    """HK Settings' Music page is feature_pages.py's route, and always Mantel's own settings (house/music), the
    engine on or off: HA's page is never read once Mantel holds them (HK Frontend can leave HA). Never two handlers."""
    from mantel_server import feature_pages as FP
    from mantel_server.connectors import read_routes
    asked = []

    class Proxy:
        async def read_server(self, msg):
            asked.append(msg["type"])
            return {"configured": True, "state": "loaded", "speakers": [], "presets": [], "playlists": [],
                    "players": [], "users": [], "homes": {}, "volume": 0.1}

        async def close(self):
            pass

    on.app["hub"].readproxy = Proxy()
    route = read_routes(on.app)["hk_music/settings/get"]
    assert route.request.__module__ == FP.__name__
    await on.login("owner1", "owner")
    ws = await on.socket()
    got = (await on.read(ws, {"type": "hk_music/settings/get"}))["result"]
    assert got["volume"] == 0.3 and [p["id"] for p in got["presets"]] == ["pre1"] and asked == []   # Mantel's
    monkeypatch.setattr(type(on.app["music"]), "active", property(lambda self: False))
    got = (await on.read(ws, {"type": "hk_music/settings/get"}, rid=51))["result"]
    assert got["volume"] == 0.3 and asked == []                                       # still Mantel's, never HA's
    await ws.close()


async def test_music_assistant_without_the_settings_is_still_the_bridge(no_doc):
    assert no_doc.app["ma"] is not None and no_doc.app["music"].active is False


# ------------------------------------------------------------------------------------------- commands off
async def test_commands_off_refuse_every_music_action_and_nothing_reaches_music_assistant(off):
    await off.connected()
    await off.login("jamie", "owner")
    ws = await off.socket(expect_caps=False)
    for i, body in enumerate([play(["media_player.kitchen_ma"]),
                              {"kind": "ws", "msg": {"type": "hk_music/queue_play", "entity_id": "media_player.kitchen_ma",
                                                     "item_id": "qi-3"}},
                              {"kind": "ws", "msg": {"type": "hk_music/preset/save", "name": "x", "members": []}}], 1):
        await ws.send_json({"type": "command", "id": i, **body})
        reply = await GF.recv(ws)
        assert reply["code"] == "commands_disabled"
    await ws.close()
    assert off.app["gateway"] is None and off.app["ma"].gate is REFUSE_ALL
    # even a request run directly (no gateway) cannot send: the MA client's gate refuses everything
    run = M.MusicRun("nobody", 1, {"ma-kitchen"})
    with pytest.raises(CommandRefused):
        await off.app["ma"].command(run, "players/cmd/pause", player_id="ma-kitchen")
    token = M.RUN.set(run)
    try:
        assert await off.app["music"].engine._call("media_player", "media_pause",
                                                   {"entity_id": ["media_player.kitchen_ma"]}) is False
    finally:
        M.RUN.reset(token)
    assert M.check_doc(off.app["settings"].store.body("house", M.MUSIC_DOC)) == M.check_doc(MF.DOC)
    assert off.ma.sent() == [] and off.audit(decision="allowed") == []


# ------------------------------------------------------------------------------------------- commands on
async def test_play_a_playlist_on_two_rooms_sends_exactly_these_ma_commands(on):
    await on.connected()
    await on.login("jamie", "adult")
    ws = await on.socket()
    reply = await on.command(ws, **play(["media_player.kitchen_ma", "media_player.cody_ma"]))
    assert reply["result"]["response"] == {"ok": True, "leader": "media_player.kitchen_ma"}, reply
    assert on.ma.sent() == [
        ("players/cmd/group_many", {"target_player": "ma-kitchen", "child_player_ids": ["ma-cody"]}),
        ("players/cmd/volume_set", {"player_id": "ma-kitchen", "volume_level": 30}),
        ("players/cmd/volume_set", {"player_id": "ma-cody", "volume_level": 30}),
        ("player_queues/shuffle", {"queue_id": "ma-kitchen", "shuffle_enabled": True}),
        ("player_queues/play_media", {"queue_id": "ma-kitchen", "media": ["library://playlist/1"], "option": "replace"}),
        ("player_queues/shuffle", {"queue_id": "ma-kitchen", "shuffle_enabled": True})]
    assert ("music/playlists/library_items", {"limit": 1000}) in [(f["command"], f["args"]) for f in on.ma.frames]
    row = on.audit(decision="allowed")[-1]
    assert row["action"] == "hk_frontend.music_play" and json.loads(row["target"]) == [
        "media_player.kitchen_ma", "media_player.cody_ma"] and row["result"] == "ok"
    assert on.fake.sent == [], "nothing went to Home Assistant"
    await ws.close()


async def test_a_preset_plays_as_its_rooms_joined(on):
    """A PRESET IS ITS ROOMS (2026-11-01): Music Assistant's sync groups cannot pause (a pause stopped the music and
    broke the group up), so the Downstairs preset's rooms are joined under the first of them, as any pick is."""
    await on.connected()
    await on.login("jamie", "adult")
    ws = await on.socket()
    reply = await on.command(ws, **play(["media_player.kitchen_ma", "media_player.den_ma"]))
    assert reply["result"]["response"] == {"ok": True, "leader": "media_player.kitchen_ma"}, reply
    assert on.ma.sent() == [
        ("players/cmd/group_many", {"target_player": "ma-kitchen", "child_player_ids": ["ma-den"]}),
        ("players/cmd/volume_set", {"player_id": "ma-kitchen", "volume_level": 30}),
        ("players/cmd/volume_set", {"player_id": "ma-den", "volume_level": 30}),
        ("player_queues/shuffle", {"queue_id": "ma-kitchen", "shuffle_enabled": True}),
        ("player_queues/play_media", {"queue_id": "ma-kitchen", "media": ["library://playlist/1"],
                                      "option": "replace"}),
        ("player_queues/shuffle", {"queue_id": "ma-kitchen", "shuffle_enabled": True})]
    assert "ma-downstairs" not in json.dumps(on.ma.sent()), "the group saved with it is no player of its"
    # paused: the Kitchen leads, so the pause is a HomePod's own, not a sync group's (which stops)
    n = len(on.ma.sent())
    r = await on.command(ws, id=2, **SVC("music_transport", player="media_player.kitchen_ma", command="play_pause"))
    assert r["result"]["response"] == {"ok": True}, r
    assert on.ma.sent()[n:] == [("players/cmd/play_pause", {"player_id": "ma-kitchen"})]
    await ws.close()


async def test_a_playlist_gone_from_the_library_is_refused_not_played(on):
    await on.connected()
    await on.login("jamie", "adult")
    ws = await on.socket()
    reply = await on.command(ws, **play(["media_player.kitchen_ma"], "pl_gone"))
    assert reply["result"]["response"] == {"ok": False, "message": "Gone is no longer in the music library."}
    assert on.ma.sent() == [] and "music_play_failed" in on.app["music"].engine.notes
    # without return_response a failure is an error, as HA's _answer raises
    body = play(["media_player.kitchen_ma"], "pl_gone")
    body.pop("return_response")
    reply = await on.command(ws, id=2, **body)
    assert reply["error"]["code"] == "home_assistant_error"
    await ws.close()


async def test_transfer_stop_transport_browse_and_queue_play(on):
    hub = on.app["hub"]
    await on.connected()
    await on.app["music"].refresh_groups()          # Music Assistant's groups: Stop All stops them
    await on.playing("media_player.kitchen_ma", media_content_id="library://playlist/1", volume_level=0.5)
    await on.login("jamie", "adult")
    ws = await on.socket()
    svc = lambda s, **d: {"kind": "service", "domain": "hk_frontend", "service": s, "data": d,   # noqa: E731
                          "return_response": True}
    r = await on.command(ws, **svc("music_transfer", rooms=["media_player.den_ma"], source="media_player.kitchen_ma"))
    assert r["result"]["response"] == {"ok": True, "leader": "media_player.den_ma"}, r
    assert on.ma.sent()[-1] == ("player_queues/transfer", {"source_queue_id": "ma-kitchen", "target_queue_id": "ma-den",
                                                           "auto_play": True})
    n = len(on.ma.sent())
    r = await on.command(ws, id=2, **svc("music_transport", player="media_player.den_ma", command="volume_up"))
    assert r["result"]["response"] == {"ok": True}
    assert on.ma.sent()[n:] == [("players/cmd/volume_set", {"player_id": "ma-den", "volume_level": 25})]
    n = len(on.ma.sent())
    r = await on.command(ws, id=3, **svc("music_play_media", player="media_player.cody_ma",
                                         media_content_id="library://track/9", media_content_type="music"))
    assert r["result"]["response"] == {"ok": True, "leader": "media_player.cody_ma"}
    assert on.ma.sent()[n:] == [("player_queues/play_media", {"queue_id": "ma-cody", "media": ["library://track/9"],
                                                              "option": "replace"})]
    # Browse over a speaker already playing replaces its queue, and waits for the new music: "playing" alone
    # said nothing new (a Halloween playlist was lost in a shuffled Christmas queue, the owner 2026-10-31)
    n = len(on.ma.sent())
    r = await on.command(ws, id=6, **svc("music_play_media", player="media_player.kitchen_ma",
                                         media_content_id="apple_music://playlist/halloween", media_content_type="playlist"))
    assert r["result"]["response"] == {"ok": True, "leader": "media_player.kitchen_ma"}
    assert on.ma.sent()[n:] == [("player_queues/play_media", {"queue_id": "ma-kitchen",
                                                              "media": ["apple_music://playlist/halloween"],
                                                              "option": "replace"})]
    n = len(on.ma.sent())
    r = await on.command(ws, id=4, kind="ws", msg={"type": "hk_music/queue_play", "entity_id": "media_player.den_ma",
                                                   "item_id": "qi-3"})
    assert r["result"] == {"ok": True}
    assert on.ma.sent()[n:] == [("player_queues/play_index", {"queue_id": "ma-den", "index": "qi-3"})]
    n = len(on.ma.sent())
    r = await on.command(ws, id=5, **svc("music_stop"))
    assert r["result"]["response"] == {"ok": True}
    stops = on.ma.sent()[n:]
    assert ("players/cmd/stop", {"player_id": "ma-downstairs"}) in stops            # Stop All: Music Assistant's groups
    assert {a["player_id"] for c, a in stops if c == "players/cmd/stop"} == {"ma-downstairs", "ma-kitchen", "ma-den",
                                                                              "ma-cody"}
    assert {a["player_id"] for c, a in stops if c == "players/cmd/ungroup"} == {"ma-kitchen", "ma-den", "ma-cody"}
    assert "ma-garage" not in json.dumps(on.ma.sent()), "never a speaker that is not the house's"
    assert on.fake.sent == []
    await ws.close()


DG, UG = "media_player.downstairs_ma", "media_player.study_pair_ma"


def dynamic(pid, entity, members):
    """A Music Assistant sync group with dynamic members, as the house's are: it takes and loses members as it plays."""
    return dict(MF.ma_player(pid, entity), type="group", group_members=list(members),
                supported_features=["volume_set", "volume_mute", "pause", "set_members"])


async def group_playing(env, group, rooms):
    """A sync group plays in `rooms`, which Music Assistant reports grouped."""
    await env.playing(group, media_content_id="library://playlist/1")
    await env.ma.set(group, group_members=rooms)
    for r in rooms:
        await env.playing(r, media_content_id="library://playlist/1", group_members=rooms)
    await wait_for(lambda: env.app["hub"].store.states[group]["a"].get("group_members") == rooms)


async def test_new_speakers_for_music_that_plays_join_it_in_place(on):
    """NEW SPEAKERS FOR MUSIC THAT PLAYS (2026-11-01): the rooms picked join the room playing and the rooms unticked
    leave it, its queue staying put; only a pick without it moves the queue."""
    await on.connected()
    await group_playing(on, K, [K, D])
    await on.login("jamie", "adult")
    ws = await on.socket()
    r = await on.command(ws, **SVC("music_transfer", rooms=[K, D, C], source=K))
    assert r["result"]["response"] == {"ok": True, "leader": K}, r
    sent = on.ma.sent()
    assert sent and all(c == "players/cmd/group_many" and a["target_player"] == "ma-kitchen" for c, a in sent), sent
    assert "ma-cody" in sent[-1][1]["child_player_ids"]
    # the Den unticked: it leaves, and the music plays on in the Kitchen and Cody's Room
    n = len(on.ma.sent())
    r = await on.command(ws, id=2, **SVC("music_transfer", rooms=[K, C], source=K))
    assert r["result"]["response"] == {"ok": True, "leader": K}, r
    sent = on.ma.sent()[n:]
    assert ("players/cmd/ungroup", {"player_id": "ma-den"}) in sent and "player_queues/transfer" not in json.dumps(sent)
    # no room shared: the queue moves, as before
    n = len(on.ma.sent())
    r = await on.command(ws, id=3, **SVC("music_transfer", rooms=[D], source=K))
    assert r["result"]["response"] == {"ok": True, "leader": D}, r
    assert on.ma.sent()[n] == ("player_queues/transfer", {"source_queue_id": "ma-kitchen", "target_queue_id": "ma-den",
                                                          "auto_play": True})
    assert on.fake.sent == []
    await ws.close()


async def test_a_preset_that_shares_rooms_with_the_music_playing_joins_it_in_place(on):
    """Upstairs (the Den and Cody's Room) playing, the Downstairs preset picked: the Kitchen joins the Den, which
    keeps the music, and Cody's Room leaves -- no queue moves."""
    doc = json.loads(json.dumps(MF.DOC))
    doc["items"].append({"kind": "preset", "key": "pre2", "title": "Upstairs", "data": {"name": "Upstairs",
                                                                                        "members": [D, C]}})
    on.app["settings"].store.write([("house", M.MUSIC_DOC, doc)], actor=Actor(label="test"))
    await on.connected()
    await group_playing(on, D, [D, C])
    await on.login("jamie", "adult")
    ws = await on.socket()
    r = await on.command(ws, **SVC("music_transfer", rooms=[K, D], source=D))
    assert r["result"]["response"] == {"ok": True, "leader": D}, r
    sent = on.ma.sent()
    assert sent[0] == ("players/cmd/group_many", {"target_player": "ma-den", "child_player_ids": ["ma-kitchen"]}), sent
    assert ("players/cmd/ungroup", {"player_id": "ma-cody"}) in sent and "player_queues/transfer" not in json.dumps(sent)
    await ws.close()


async def test_a_presets_rooms_are_its_own_and_music_assistants_groups_are_stop_alls(on):
    """A preset's rooms are the ones saved with it, whatever its old group holds; Music Assistant's groups are read
    only for Stop All (one started elsewhere plays in the rooms) and an announcement's rooms."""
    host = on.app["music"]
    on.ma.players = [dynamic("ma-downstairs", DG, [])]
    await on.connected()
    await host.refresh_groups()
    assert host.page()["presets"] == [{"id": "pre1", "name": "Downstairs", "members": [K, D]}]
    assert "config/players/get" not in [f["command"] for f in on.ma.frames]
    assert host.config().ma_groups == [DG]
    await on.login("jamie", "owner")
    ws = await on.socket()
    r = await on.command(ws, **SVC("music_stop"))
    assert r["result"]["response"] == {"ok": True}, r
    assert ("players/cmd/stop", {"player_id": "ma-downstairs"}) in on.ma.sent()
    await ws.close()


async def test_rbac_on_the_rooms_and_nothing_sent_when_refused(on):
    await on.connected()
    await on.m.user("cody", "child")
    uid = on.app["accounts"].db.execute("SELECT id FROM users WHERE username='cody'").fetchone()["id"]
    on.app["rbac"].set_scopes("user", uid, ["cody_room"])
    await on.login("cody", "child")
    ws = await on.socket()
    r = await on.command(ws, **play(["media_player.kitchen_ma"]))
    assert r["error"]["code"] == "forbidden" and r["error"]["target"] == "media_player.kitchen_ma"
    r = await on.command(ws, id=2, kind="service", domain="hk_frontend", service="music_stop", data={},
                         return_response=True)
    assert r["error"]["code"] == "forbidden", "Stop All names every room: not all of them are Cody's"
    r = await on.command(ws, id=3, kind="service", domain="hk_frontend", service="music_transport",
                         data={"player": "media_player.downstairs_ma", "command": "stop"})
    assert r["error"]["code"] == "forbidden", "a Music Assistant group is no room of Cody's"
    r = await on.command(ws, id=4, **play(["media_player.cody_ma"]))
    assert r["result"]["response"]["ok"] is True                                  # their own room
    r = await on.command(ws, id=5, kind="ws", msg={"type": "hk_music/preset/save", "name": "Mine",
                                                   "members": ["media_player.cody_ma"]})
    assert r["error"]["code"] == "forbidden", "the music settings need configure (HA: require_admin)"
    assert {c for c, _a in on.ma.sent()} <= {"players/cmd/volume_set", "player_queues/shuffle", "player_queues/play_media"}
    assert all(a.get("player_id", a.get("queue_id")) == "ma-cody" for _c, a in on.ma.sent())
    denied = on.audit(decision="denied")
    assert {r["action"] for r in denied} == {"hk_frontend.music_play", "hk_frontend.music_stop",
                                             "hk_frontend.music_transport", "hk_music/preset/save"}
    await ws.close()
    await on.login("gwen", "guest")
    ws = await on.socket()
    r = await on.command(ws, **play(["media_player.kitchen_ma"]))
    assert r["error"]["code"] == "forbidden" and r["error"]["target"] == "feature:music"
    await ws.close()


async def test_a_stray_identity_cannot_use_the_gates_music_path(on):
    gw = on.app["gateway"]
    assert gw.allow(M.MusicRun("x", 5, {"ma-kitchen"}), "players/cmd/pause", {"player_id": "ma-kitchen"}) is True
    assert gw.allow(M.MusicRun("x", 5, {"ma-kitchen"}), "players/cmd/power", {"player_id": "ma-kitchen"}) is False
    assert gw.allow("anyone", "players/cmd/pause", {"player_id": "ma-kitchen"}) is False


async def test_settings_saves_go_to_mantels_store_and_the_feed(on):
    await on.connected()
    await on.login("owner1", "owner")
    ws = await on.socket()
    _res, ev = await on.subscribe(ws, {"type": "hk_music/subscribe"})
    assert [p["key"] for p in ev["playlists"]] == ["pl1", "pl_gone"]
    r = await on.command(ws, kind="ws", msg={"type": "hk_music/playlist/save", "name": "Evening", "icon": "mdi:moon",
                                             "items": ["library://playlist/2"]})
    page = r["result"]
    assert [p["name"] for p in page["playlists"]] == ["Morning", "Gone", "Evening"]
    new = next(p["id"] for p in page["playlists"] if p["name"] == "Evening")
    ev2 = None
    while ev2 is None:
        got = await GF.recv(ws)
        if got.get("type") == "read_event" and got.get("id") == 60:
            ev2 = got["event"]
    assert [p["name"] for p in ev2["playlists"]] == ["Morning", "Gone", "Evening"]
    r = await on.command(ws, id=2, kind="ws", msg={"type": "hk_music/playlists/order", "ids": [new, "pl1", "pl_gone"]})
    assert [p["name"] for p in r["result"]["playlists"]] == ["Evening", "Morning", "Gone"]
    r = await on.command(ws, id=3, kind="ws", msg={"type": "hk_music/item/remove", "item": "pl_gone"})
    assert [p["name"] for p in r["result"]["playlists"]] == ["Evening", "Morning"]
    r = await on.command(ws, id=4, kind="ws", msg={"type": "hk_music/settings/set", "changes": {"volume": 0.5,
                                                                                                 "keep_ready": True}})
    assert r["result"]["volume"] == 0.5 and r["result"]["keep_ready"] is True
    r = await on.command(ws, id=5, kind="ws", msg={"type": "hk_music/settings/set", "changes": {"speakers": ["media_player.tv"]}})
    assert r["error"]["code"] == "invalid_format" and json.loads(r["error"]["message"]) == {
        "speakers": "That isn’t a Music Assistant player."}
    r = await on.command(ws, id=6, kind="ws", msg={"type": "hk_music/playlist/save", "name": "Nope",
                                                   "items": ["library://playlist/404"]})
    assert json.loads(r["error"]["message"]) == {"items": "That playlist isn’t in the Music Assistant library."}
    r = await on.command(ws, id=7, kind="ws", msg={"type": "hk_music/preset/save", "item": "pre1", "name": "Main",
                                                   "members": ["media_player.kitchen_ma", "media_player.den_ma"]})
    assert r["result"]["presets"][0] == {"id": "pre1", "name": "Main",
                                         "members": ["media_player.kitchen_ma", "media_player.den_ma"]}
    item = on.app["settings"].store.get("house", M.MUSIC_DOC).body["items"][0]
    assert item["data"] == {"name": "Main", "members": ["media_player.kitchen_ma", "media_player.den_ma"]}, \
        "the group it was saved with before is dropped"
    hist = on.app["settings"].store.history("house", M.MUSIC_DOC)
    assert hist[0]["actor"] is not None and hist[0]["message"] == "hk_music/preset/save"
    assert on.ma.sent() == [] and on.fake.sent == [], "settings are Mantel's: nothing to MA or HA"
    await ws.close()


async def test_used_answers_on_every_server_and_sends_nothing(off):
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    await ws.send_json({"type": "music_used", "id": 9})
    got = await GF.recv(ws)
    assert got == {"type": "music_used_result", "id": 9, "result": None}
    await ws.send_json({"type": "music_used", "id": 10, "extra": 1})
    assert (await GF.recv(ws))["error"]["code"] == "invalid"
    await ws.close()
    assert [c for c in off.ma.commands() if c != "auth"] == []


# ------------------------------------------------------------------------------------------- Keep Playlists Ready
async def test_keep_playlists_ready_uses_server_only_reads(off):
    await off.connected()
    host = off.app["music"]
    w = host.warmer
    w.sleep = lambda s: asyncio.sleep(0)
    assert w.on is False
    delay = await w.round()
    sent = [(f["command"], f["args"]) for f in off.ma.frames if f["command"] not in {"auth", *MF.OVERLAY_READS}]
    assert sent[0][0] == "music/recently_played_items" and "played_after_timestamp" in sent[0][1]
    assert ("music/playlists/library_items", {"limit": 1000}) in sent
    assert ("music/playlists/playlist_tracks", {"item_id": "1", "provider_instance_id_or_domain": "library",
                                                "force_refresh": True}) in sent
    assert all(c != "music/playlists/playlist_tracks" or a["item_id"] != "2" for c, a in sent), "builtin left alone"
    assert w.status()["wanted"] == 1 and delay > 0
    assert off.ma.sent() == [], "reads only, never a player command"


# ------------------------------------------------------------------------------------------- the import
async def test_the_feature_import_brings_musics_settings(no_doc):
    from test_feature_parity import ImportProxy, panel
    page = {"configured": True, "speakers": [{"entity": "media_player.kitchen_ma"}], "volume": 0.25,
            "homes": {"ha-owner": "media_player.kitchen_ma"}, "presets": [],
            "playlists": [{"id": "01HX", "name": "Jazz", "icon": "mdi:sax", "items": ["library://playlist/1"],
                           "order": 10}]}
    no_doc.app["hub"].readproxy = proxy = ImportProxy(panel("music"), {"hk_music/settings/get": page})
    await no_doc.login("owner1", "owner")
    r = await no_doc.m.client.post("/api/features/import", headers=no_doc.m.headers())
    assert r.status == 200
    assert proxy.asked == ["hk_frontend/panel/get", "hk_music/settings/get"]
    doc = no_doc.app["music"].doc()
    assert doc["options"]["speakers"] == ["media_player.kitchen_ma"] and doc["options"]["volume"] == 0.25
    assert doc["options"]["homes"] == {"ha:ha-owner": "media_player.kitchen_ma"}
    assert doc["items"][0]["key"] == "01HX"
    assert no_doc.app["music"].active is True, "Music Assistant is configured here, and now the settings are too"


async def test_status_is_owner_or_admin(off):
    await off.login("jamie", "adult")
    assert (await off.m.get("/api/music/status")).status == 403
    await off.login("owner1", "owner")
    body = await (await off.m.get("/api/music/status")).json()
    assert body["active"] is True and body["music_assistant"] is True and body["settings"] is True


def test_every_music_read_route_has_one_rule():
    assert set(M.ROUTE_RULES) == {"hk_music/subscribe", "hk_music/queue", "hk_music/settings/library",
                                  "music_assistant/get_library", "media_player/browse_media",
                                  "media_player/search_media", "music_assistant/get_queue", "music_assistant/search"}
    from mantel_server import feature_pages as FP
    assert FP.PAGE_READS["hk_music/settings/get"] == "music"        # one path: feature_pages, MusicHost.page when on
    assert M.MUSIC_WS <= set(json.loads(open(
        __import__("pathlib").Path(M.__file__).with_name("hk_writes.json")).read())["writes"])


# ------------------------------------------------------------------------------- Browse's library (get_library)
def lib(**fields):
    return {"type": "music_assistant/get_library", "config_entry_id": MF.MA_ENTRY, **fields}


def lib_reads(env):
    return [(f["command"], f["args"]) for f in env.ma.frames if f["command"].endswith("/library_items")]


async def test_a_discover_row_is_a_read_with_commands_off(off):
    await a_discover_row_is_a_read(off)


async def test_a_discover_row_is_a_read_with_commands_on(on):
    await a_discover_row_is_a_read(on)


async def a_discover_row_is_a_read(env):
    await env.connected()
    await env.login("jamie", "adult")
    ws = await env.socket(expect_caps=False)
    got = await env.read(ws, lib(media_type="album", order_by="last_played_desc", limit=2))
    items = got["result"]["items"]
    # recent first (MA ordered it), HA's item shape: names, uri, version, picture, the artist, no extra keys
    assert [i["name"] for i in items] == ["Album A", "Album B"]
    assert items[1] == {"media_type": "album", "uri": "library://album/2", "name": "Album B", "version": "Deluxe",
                        "image": "/ma/imageproxy?path=%2Fdata%2Fart%2F2.jpg&provider=library&size=256",
                        "artists": [{"media_type": "artist", "uri": "library://artist/8", "name": "Soloist",
                                     "version": "", "image": None}]}
    assert lib_reads(env) == [("music/albums/library_items", {"limit": 2, "order_by": "last_played_desc"})]
    # never a command: nothing audited, nothing sent to Home Assistant, nothing but reads sent to Music Assistant
    assert env.audit() == []
    assert env.ma.sent() == []
    if env.fake is not None:
        assert env.fake.sent == []
    await ws.close()


async def test_favorites_and_category_pages_and_search(off):
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    fav = (await off.read(ws, lib(media_type="track", favorite=True), rid=51))["result"]["items"]
    assert [i["name"] for i in fav] == ["Song 3"]
    assert fav[0]["image"] == "https://img.example/3.jpg"                       # a remote picture as it is
    assert fav[0]["artists"][0]["name"] == "Band" and fav[0]["album"]["name"] == "Album A"
    assert "album" not in fav[0]["album"] and "artists" not in fav[0]["album"]    # nested items are plain
    # a category listing pages by offset and limit, in name order; a short page ends the list
    names = []
    for n, offset in enumerate((0, 3, 6)):
        page = (await off.read(ws, lib(media_type="track", order_by="name", limit=3, offset=offset), rid=60 + n))["result"]["items"]
        names.append([i["name"] for i in page])
    assert names == [["Song 1", "Song 2", "Song 3"], ["Song 4", "Song 5", "Song 6"], ["Song 7"]]
    got = (await off.read(ws, lib(media_type="album", search="album c"), rid=70))["result"]["items"]
    assert [i["name"] for i in got] == ["Album C"]
    # each type reaches its own library command; HA's default limit is 25
    for kind, cmd in (("artist", "artists"), ("radio", "radios"), ("podcast", "podcasts"), ("playlist", "playlists"),
                      ("audiobook", "audiobooks")):
        await off.read(ws, lib(media_type=kind), rid=80)
        assert lib_reads(off)[-1] == (f"music/{cmd}/library_items", {"limit": 25})
    only = (await off.read(ws, lib(media_type="album", album_type=["single", "compilation"]), rid=81))["result"]["items"]
    assert [i["name"] for i in only] == ["Album C", "Album D"]
    assert lib_reads(off)[-1][1]["album_types"] == ["single", "compilation"]
    one = (await off.read(ws, lib(media_type="artist", album_artists_only=True), rid=82))["result"]["items"]
    assert [i["name"] for i in one] == ["Band"] and one[0]["image"].startswith("/ma/imageproxy?")
    pl = (await off.read(ws, lib(media_type="playlist"), rid=83))["result"]["items"]
    assert [i["uri"] for i in pl] == ["library://playlist/1", "library://playlist/2"]
    await ws.close()


async def test_artwork_goes_by_music_assistants_proxy_id(off):
    # Music Assistant 2.10 serves /imageproxy/<proxy_id> only; its old ?path=&provider= form answers 400
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    items = (await off.read(ws, lib(media_type="album", order_by="name")))["result"]["items"]
    assert items[2]["name"] == "Album C" and items[2]["image"] == f"/ma/imageproxy/{MF.PROXY_ID}?size=256"
    assert items[0]["image"].startswith("/ma/imageproxy?path="), "an older Music Assistant (no proxy_id): as before"
    await ws.close()


def test_a_proxy_id_that_is_not_one_is_not_used():
    art = {"path": "/data/x.jpg", "provider": "library"}
    assert M._library_image(dict(art, proxy_id="../../etc")).startswith("/ma/imageproxy?path=")
    assert M._library_image(dict(art, proxy_id="AB" * 32)) == f"/ma/imageproxy/{'ab' * 32}?size=256"


# ------------------------------------------------------------------------- Browse's tree: Music Assistant's, not HA's
def browse(cid, ctype="music", entity="media_player.kitchen_ma"):
    return {"type": "media_player/browse_media", "entity_id": entity, "media_content_id": cid,
            "media_content_type": ctype}


def ha_browse(env, answer):
    """HA's side of media_player/browse_media (readproxy, which these tests never let reach HA)."""
    asked = []

    async def request(identity, msg):
        asked.append(msg)
        if isinstance(answer, BaseException):
            raise answer
        return answer
    env.app["filtered_reads"].request = request
    return asked


def tracks_reads(env):
    return [f["args"] for f in env.ma.frames if f["command"] == "music/playlists/playlist_tracks"]


PROXY_THUMB = f"http://ma.fake.test:8095/imageproxy/{MF.PROXY_ID}?size=256"


async def test_browse_is_answered_from_music_assistant_in_has_shape_and_ha_is_never_asked(off):
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    asked = ha_browse(off, RuntimeError("HA must not be asked"))
    root = (await off.read(ws, {"type": "media_player/browse_media", "entity_id": "media_player.kitchen_ma"}))["result"]
    assert root["title"] == "Music Assistant" and root["can_expand"] and not root["can_play"]
    assert [(c["media_content_id"], c["title"], c["children_media_class"]) for c in root["children"]] == [
        ("artists", "Artists", "artist"), ("albums", "Albums", "album"), ("tracks", "Tracks", "track"),
        ("playlists", "Playlists", "playlist"), ("radio", "Radio stations", "music"), ("podcasts", "Podcasts", "podcast"),
        ("audiobooks", "Audiobooks", "directory")]
    albums = (await off.read(ws, browse("albums", "music_assistant"), rid=51))["result"]
    assert albums["media_content_type"] == "album" and albums["can_search"] is True and len(albums["children"]) == 5
    c = albums["children"][2]
    assert c == {"title": "Band - Album C", "media_class": "album", "media_content_type": "music",
                 "media_content_id": "library://album/3", "children_media_class": None, "can_play": True,
                 "can_expand": True, "can_search": True, "thumbnail": PROXY_THUMB, "not_shown": 0}
    sent = [(f["command"], f["args"]) for f in off.ma.frames if f["command"].startswith("music/")]
    assert sent[-1] == ("music/albums/library_items", {"limit": 500, "order_by": "sort_name"})
    album = (await off.read(ws, browse("library://album/1", "album"), rid=52))["result"]
    assert album["title"] == "Album A" and album["media_class"] == "album" and album["can_play"]
    assert [t["title"] for t in album["children"]] == ["Band - Song 1", "Band - Song 2", "Band - Song 3"], \
        "an unavailable song is left out, as HA does"
    assert album["children"][0]["thumbnail"] == "https://img.example/1.jpg" and not album["children"][0]["can_expand"]
    artist = (await off.read(ws, browse("library://artist/8", "artist"), rid=53))["result"]
    assert artist["search_media_classes"] == ["album", "track"]
    assert [a["media_content_id"] for a in artist["children"]] == ["library://album/2", "library://album/4"]
    # a search result's catalog playlist opens through Music Assistant too
    pl = (await off.read(ws, browse("apple_music://playlist/pl.fictional", "playlist"), rid=54))["result"]
    assert pl["title"] == "Fictional Mix" and pl["children_media_class"] == "track"
    assert tracks_reads(off) == [{"item_id": "pl.fictional", "provider_instance_id_or_domain": "apple_music"}]
    got = await off.read(ws, browse("library://nothing/1"), rid=55)
    assert got["error"]["code"] == "not_found"
    assert asked == [] and off.ma.sent() == [] and off.audit() == []
    await ws.close()


async def test_search_is_answered_from_music_assistant(off):
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    asked = ha_browse(off, RuntimeError("HA must not be asked"))
    got = (await off.read(ws, {"type": "media_player/search_media", "entity_id": "media_player.kitchen_ma",
                               "search_query": "song"}))["result"]
    assert got["version"] == 1
    assert [(r["media_class"], r["title"], r["can_expand"]) for r in got["result"]] == [
        ("artist", "Band", True), ("album", "Band - Album A", True), ("track", "Band - Song 1", False),
        ("track", "Band - Song 2", False), ("music", "Jazz FM", False)]
    search = [f["args"] for f in off.ma.frames if f["command"] == "music/search"]
    assert search == [{"search_query": "song", "limit": 5, "library_only": False,
                       "media_types": ["artist", "album", "track", "playlist", "radio", "audiobook", "podcast"]}]
    within = (await off.read(ws, {"type": "media_player/search_media", "entity_id": "media_player.kitchen_ma",
                                  "search_query": "2", "media_content_id": "library://album/1"}, rid=51))["result"]
    assert [r["title"] for r in within["result"]] == ["Band - Song 2"]
    got = await off.read(ws, {"type": "media_player/search_media", "entity_id": "media_player.kitchen_ma",
                              "search_query": "x", "media_filter_classes": ["episode"]}, rid=52)
    assert got["result"] == {"version": 1, "result": []}
    bad = await off.read(ws, {"type": "media_player/search_media", "entity_id": "media_player.kitchen_ma",
                              "search_query": "x", "limit": 9}, rid=53)
    assert bad["error"]["code"] == "not_allowed"
    assert asked == []
    await ws.close()


async def test_a_saved_playlist_refused_for_sign_in_says_so_not_unknown_error(off):
    # Music Assistant's LoginFailed (Apple Music refuses the account's own playlists when its user token has expired):
    # the page reads what to do, and the songs were read once, never forced
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    off.ma.signed_out.add(("library", "1"))
    asked = ha_browse(off, RuntimeError("unknown_error"))
    got = await off.read(ws, browse("library://playlist/1"))
    assert got["error"] == {"code": "login_failed", "message": M.SIGN_IN_AGAIN}
    assert tracks_reads(off) == [{"item_id": "1", "provider_instance_id_or_domain": "library"}], "a read, never forced"
    assert asked == [] and off.ma.sent() == [] and off.audit() == []
    await ws.close()


async def test_music_assistant_failing_a_browse_is_unavailable(off):
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)

    async def broken(*_a, **_k):
        raise RuntimeError("boom")
    off.app["ma"].library = broken
    got = await off.read(ws, browse("albums", "music_assistant"))
    assert got["error"] == {"code": "unavailable", "message": "Music Assistant could not be read."}
    await ws.close()


async def test_a_browse_on_a_speaker_one_may_not_see_asks_nothing(off):
    await off.m.user("cody", "child")
    uid = off.app["accounts"].db.execute("SELECT id FROM users WHERE username='cody'").fetchone()["id"]
    off.app["rbac"].set_scopes("user", uid, ["cody_room"])
    await off.connected()
    await off.login("cody", "child")
    ws = await off.socket(expect_caps=False)
    n = len(off.ma.frames)
    got = await off.read(ws, browse("library://playlist/1"))
    assert got["error"]["code"] == "not_found" and off.ma.frames[n:] == []
    got = await off.read(ws, {"type": "media_player/search_media", "entity_id": "media_player.kitchen_ma",
                              "search_query": "x"}, rid=51)
    assert got["error"]["code"] == "not_found" and off.ma.frames[n:] == []
    await ws.close()


async def test_ha_still_answers_a_media_source_id_and_a_player_that_is_not_music_assistants(off):
    await off.connected()
    await off.login("owner1", "owner")
    ws = await off.socket(expect_caps=False)
    tree = {"title": "My media", "children": []}
    asked = ha_browse(off, tree)
    got = await off.read(ws, browse("media-source://media_source/local/x", "music"))
    assert got["result"] == tree
    got = await off.read(ws, browse("", "music", entity="media_player.tv"), rid=51)
    assert got["result"] == tree and [a["entity_id"] for a in asked] == ["media_player.kitchen_ma", "media_player.tv"]
    await ws.close()


async def test_without_music_assistant_in_mantel_has_browse_error_stands(bridge):
    await bridge.login("jamie", "adult")
    ws = await bridge.socket()
    ha_browse(bridge, RuntimeError("unknown_error"))
    got = await bridge.read(ws, browse("library://playlist/1"))
    assert got["error"] == {"code": "failed", "message": "unknown_error"} and bridge.fake.frames == []
    await ws.close()


@pytest.mark.parametrize("bad", [
    {"media_type": "show"}, {}, {"media_type": "album", "limit": 0}, {"media_type": "album", "limit": 501},
    {"media_type": "album", "limit": True}, {"media_type": "album", "limit": "5"}, {"media_type": "album", "offset": -1},
    {"media_type": "album", "order_by": "name; drop"}, {"media_type": "album", "favorite": "yes"},
    {"media_type": "album", "search": 5}, {"media_type": "album", "search": "x" * 201},
    {"media_type": "album", "provider": "spotify"}, {"media_type": "album", "return_response": True},
    {"media_type": "track", "album_type": ["album"]}, {"media_type": "album", "album_type": ["live"]},
    {"media_type": "album", "album_type": []}, {"media_type": "album", "album_artists_only": True},
    {"media_type": "album", "config_entry_id": 5}, {"media_type": "album", "entity_id": "media_player.kitchen_ma"},
])
async def test_fields_HA_would_not_take_are_refused_and_nothing_is_asked(off, bad):
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)
    msg = {"type": "music_assistant/get_library", **bad}
    got = await off.read(ws, msg)
    assert got["error"]["code"] == "not_allowed", got
    assert lib_reads(off) == []
    await ws.close()


def test_the_checked_query_is_music_assistants_library_command():
    assert M.check_get_library({"media_type": "radio", "favorite": False, "limit": 500, "offset": 3, "search": "",
                                "order_by": "random"}) == {
        "media_type": "radios", "args": {"favorite": False, "limit": 500, "offset": 3, "order_by": "random"}}
    assert M.check_get_library({"media_type": "album", "album_type": "ep"})["args"]["album_types"] == ["ep"]
    with pytest.raises(ValueError):
        M.check_get_library(["media_type"])


async def test_without_music_view_nothing_is_asked_of_music_assistant(off):
    await off.connected()
    await off.login("gwen", "guest")
    ws = await off.socket(expect_caps=False)
    got = await off.read(ws, lib(media_type="album"))
    assert got["error"]["code"] == "forbidden"
    assert lib_reads(off) == []
    await ws.close()
    await off.login("jamie", "adult")                       # and it is the person's own right, not the server's
    ws = await off.socket(expect_caps=False)
    assert "result" in await off.read(ws, lib(media_type="album"))
    await ws.close()


async def test_music_assistant_failing_is_unavailable_not_a_dropped_request(off):
    await off.connected()
    await off.login("jamie", "adult")
    ws = await off.socket(expect_caps=False)

    async def broken(*_a, **_k):
        raise RuntimeError("boom")
    off.app["ma"].library = broken
    got = await off.read(ws, lib(media_type="album"))
    assert got["error"] == {"code": "unavailable", "message": "Music Assistant could not be read."}
    await ws.close()


async def test_without_music_assistant_in_mantel_the_read_says_so(bridge):
    # the page's shim then sends the call the old way (a gateway command to HA); here, only the read's answer
    await bridge.login("jamie", "adult")
    ws = await bridge.socket()
    got = await bridge.read(ws, lib(media_type="album"))
    assert got["error"]["code"] == "ma_not_configured" and "not connected" in got["error"]["message"]
    assert bridge.fake.frames == []
    await ws.close()


async def test_the_library_needs_music_assistant_not_the_music_settings(no_doc):
    await no_doc.connected()
    await no_doc.login("jamie", "adult")
    ws = await no_doc.socket(expect_caps=False)
    assert no_doc.app["music"].active is False
    got = await no_doc.read(ws, lib(media_type="playlist"))
    assert len(got["result"]["items"]) == 2
    await ws.close()


async def test_keep_playlists_ready_starts_when_music_assistant_is_connected_later(monkeypatch):
    """warmer.follow ran only at start and on a settings save: with Music Assistant added (or re-added) on the
    Connections page later, Keep Playlists Ready showed on and no round ever ran."""
    from types import SimpleNamespace

    from mantel_server import music as M
    from mantel_server.registry import Registry
    from mantel_server.state import StateStore
    app = {}
    host = M.MusicHost(app, SimpleNamespace(store=StateStore(), registry=Registry()), None)
    doc = {"options": {M.CONF_KEEP_READY: True}, "items": []}
    monkeypatch.setattr(host, "doc", lambda: doc)
    await host.start()
    assert host.warmer._task is None
    app["ma"] = SimpleNamespace(connected=asyncio.Event())
    host.connection_changed()
    await asyncio.sleep(0)
    assert host.warmer.on and host.warmer._task is not None
    await host.stop()


async def test_observed_announcements_reach_the_feed_without_sending_audio(off):
    await off.connected()
    await off.login("owner1", "owner")
    ws = await off.socket(expect_caps=False)
    _, ev = await off.subscribe(ws, {"type": "hk_music/subscribe"})
    host, ha = off.app["music"], off.app["hub"].ha
    assert ev["announcements"] == []
    ha._service_sub = 777
    ha.handle({"id": 777, "type": "event", "event": {"data": {
        "domain": "media_player", "service": "play_media", "service_data": {
            "entity_id": "media_player.kitchen_ma", "announce": True, "media_content_id": "private"}}}})
    while True:
        got = await GF.recv(ws)
        if got.get("type") == "read_event":
            assert got["event"]["announcements"] == ["media_player.kitchen_ma"]
            break
    ha.on_disconnect()
    while True:
        got = await GF.recv(ws)
        if got.get("type") == "read_event":
            assert got["event"]["announcements"] == []
            break
    assert [c for c in off.ma.commands() if c != "auth"] == []
    await ws.close()


# ------------------------------------------------------------------------------------------- pairs (groups.py)
CODY_PAIR = [{"player_id": "ma-kitchen", "display_name": "Kitchen", "type": "player", "group_members": []},
             {"player_id": "ma-den", "display_name": "Den", "type": "player", "group_members": []},
             # Cody's Room is a STEREO PAIR: a Music Assistant group of two players the house never sees
             {"player_id": "ma-cody", "display_name": "Cody Pair", "type": "group", "group_members": ["ma-cl", "ma-cr"]},
             {"player_id": "ma-cl", "display_name": "Cody Left", "type": "player", "group_members": []},
             {"player_id": "ma-cr", "display_name": "Cody Right", "type": "player", "group_members": []},
             # the preset's group holds the pair's two players, not its group (a group can't hold a group)
             {"player_id": "ma-downstairs", "display_name": "Downstairs", "type": "group",
              "group_members": ["ma-den", "ma-cl", "ma-kitchen", "ma-cr"]}]


async def test_a_pair_comes_from_music_assistant_to_the_page_the_feed_and_the_engine(on):
    on.ma.players = CODY_PAIR
    await on.connected()
    await on.login("owner1", "owner")
    ws = await on.socket()
    page = (await on.read(ws, {"type": "hk_music/settings/get"}))["result"]
    assert page["ma_groups"] is True
    assert page["pairs"] == {C: {"parts": ["Cody Left", "Cody Right"], "kind": "stereo pair"}}
    # the preset's rooms are the two it was saved with, not its old group's
    assert page["presets"][0] == {"id": "pre1", "name": "Downstairs", "members": [K, D]}
    assert page["groups"]["media_player.downstairs_ma"] == {"rooms": [K, D, C], "problems": []}
    _r, ev = await on.subscribe(ws, {"type": "hk_music/subscribe"})
    by = {s["entity"]: s for s in ev["speakers"]}
    assert by[C]["pair"] == ["Cody Left", "Cody Right"] and by["preset:pre1"]["members"] == [K, D]
    # the pair with another room: refused before anything is sent (a stereo pair plays on its own)
    reply = await on.command(ws, **play([K, C]))
    assert reply["result"]["response"] == {"ok": False, "message":
        "Cody's Room is a stereo pair, so it plays on its own."}, reply
    assert on.ma.sent() == []
    await ws.close()


async def test_music_assistants_groups_are_read_again_and_the_feed_follows(on):
    host = on.app["music"]
    await on.connected()
    assert await host.refresh_groups() is True and host.config().pairs == {}       # the fake's one player
    assert await host.refresh_groups() is False                                    # nothing changed
    on.ma.players = CODY_PAIR
    assert await host.refresh_groups() is True and "media_player.cody_ma" in host.config().pairs
    on.ma.players = "not a list"
    assert await host.refresh_groups() is False and "media_player.cody_ma" in host.config().pairs   # the last stays


# ------------------------------------------------------------------------------- virtual pairs (VIRTUAL-PAIRS.md)
K, D, C = "media_player.kitchen_ma", "media_player.den_ma", "media_player.cody_ma"
SL, SR, SG = "media_player.study_left_ma", "media_player.study_right_ma", "media_player.study_pair_ma"
SVC = lambda s, **d: {"kind": "service", "domain": "hk_frontend", "service": s, "data": d,   # noqa: E731
                      "return_response": True}


async def make_pair(env, name="Reading Nook"):
    """The Owner pairs the Study's two HomePods in Mantel Settings: one speaker, named."""
    await env.m.user("owner1", "owner")
    await env.login("owner1", "owner")
    ws = await env.socket()
    r = await env.command(ws, id=90, kind="ws", msg={"type": "hk_music/settings/set",
                                                     "changes": {"pairs": [{"players": [SL, SR], "name": name}]}})
    assert "error" not in r, r
    await ws.close()
    return r["result"]


async def test_a_virtual_pair_is_made_in_settings_and_is_one_speaker_in_the_feed(on):
    await on.connected()
    await on.app["music"].refresh_groups()          # Music Assistant's groups: never half of a pair
    page = await make_pair(on)
    assert [s["entity"] for s in page["speakers"]] == [K, D, C, SL]
    assert page["speakers"][-1]["name"] == "Reading Nook" and page["pairs_here"] is True
    assert page["virtual_pairs"] == [{"room": SL, "name": "Reading Nook", "shown": "Reading Nook", "ma_group": None,
                                      "players": [{"entity": SL, "name": "Study Left Ma"},
                                                  {"entity": SR, "name": "Study Right Ma"}]}]
    doc = on.app["settings"].store.get("house", M.MUSIC_DOC).body
    assert doc["options"]["pairs"] == [{"players": [SL, SR], "name": "Reading Nook"}]
    ws = await on.socket()
    _r, ev = await on.subscribe(ws, {"type": "hk_music/subscribe"})
    by = {s["entity"]: s for s in ev["speakers"]}
    assert by[SL] == {"name": "Reading Nook", "entity": SL, "parts": [SL, SR]} and SR not in by
    # its second player can't be a speaker of its own while paired; a bad pair is refused by field
    r = await on.command(ws, id=2, kind="ws", msg={"type": "hk_music/settings/set", "changes": {"speakers": [K, SL, SR]}})
    assert json.loads(r["error"]["message"]) == {"speakers": "That speaker is half of a pair. Unpair it first."}
    r = await on.command(ws, id=3, kind="ws", msg={"type": "hk_music/settings/set",
                                                   "changes": {"pairs": [{"players": [SL, "media_player.downstairs_ma"]}]}})
    assert json.loads(r["error"]["message"]) == {"pairs": S_MSG["pair_group"]}
    # taken apart: two speakers again
    r = await on.command(ws, id=4, kind="ws", msg={"type": "hk_music/settings/set", "changes": {"pairs": []}})
    assert [s["entity"] for s in r["result"]["speakers"]] == [K, D, C, SL, SR] and r["result"]["virtual_pairs"] == []
    assert on.ma.sent() == [], "settings are Mantel's: nothing to Music Assistant"
    await ws.close()


from hk_core.music.settings import MSG as S_MSG  # noqa: E402


async def test_play_pause_volume_and_browse_go_to_both_of_a_pairs_players(on):
    await on.connected()
    await make_pair(on)
    await on.login("jamie", "adult")
    ws = await on.socket()
    # Browse on the pair: its second player joined to its first, then the item on the first
    r = await on.command(ws, **SVC("music_play_media", player=SL, media_content_id="library://track/9",
                                   media_content_type="music"))
    assert r["result"]["response"] == {"ok": True, "leader": SL}, r
    assert on.ma.sent() == [
        ("players/cmd/group_many", {"target_player": "ma-study-l", "child_player_ids": ["ma-study-r"]}),
        ("player_queues/play_media", {"queue_id": "ma-study-l", "media": ["library://track/9"], "option": "replace"})]
    # the steps and the slider: both, together; play and pause: the first, which leads the two
    n = len(on.ma.sent())
    r = await on.command(ws, id=2, **SVC("music_transport", player=SL, command="volume_up"))
    assert r["result"]["response"] == {"ok": True}
    r = await on.command(ws, id=3, kind="service", domain="media_player", service="volume_set",
                         data={"entity_id": SL, "volume_level": 0.4})
    assert "error" not in r, r
    r = await on.command(ws, id=4, **SVC("music_transport", player=SL, command="play_pause"))
    assert on.ma.sent()[n:] == [
        ("players/cmd/volume_set", {"player_id": "ma-study-l", "volume_level": 25}),
        ("players/cmd/volume_set", {"player_id": "ma-study-r", "volume_level": 25}),
        ("players/cmd/volume_set", {"player_id": "ma-study-l", "volume_level": 40}),
        ("players/cmd/volume_set", {"player_id": "ma-study-r", "volume_level": 40}),
        ("players/cmd/play_pause", {"player_id": "ma-study-l"})]
    # a playlist on the pair and the Kitchen: both of its players join the Kitchen, the house volume on all three
    n = len(on.ma.sent())
    r = await on.command(ws, id=5, **play([K, SL]))
    assert r["result"]["response"] == {"ok": True, "leader": K}, r
    assert on.ma.sent()[n:] == [
        ("players/cmd/group_many", {"target_player": "ma-kitchen", "child_player_ids": ["ma-study-l", "ma-study-r"]}),
        ("players/cmd/volume_set", {"player_id": "ma-kitchen", "volume_level": 30}),
        ("players/cmd/volume_set", {"player_id": "ma-study-l", "volume_level": 30}),
        ("players/cmd/volume_set", {"player_id": "ma-study-r", "volume_level": 30}),
        ("player_queues/shuffle", {"queue_id": "ma-kitchen", "shuffle_enabled": True}),
        ("player_queues/play_media", {"queue_id": "ma-kitchen", "media": ["library://playlist/1"], "option": "replace"}),
        ("player_queues/shuffle", {"queue_id": "ma-kitchen", "shuffle_enabled": True})]
    # Stop on the pair frees both its players
    n = len(on.ma.sent())
    r = await on.command(ws, id=6, **SVC("music_stop", rooms=[SL]))
    assert {a["player_id"] for c, a in on.ma.sent()[n:] if c == "players/cmd/ungroup"} == {"ma-study-l", "ma-study-r"}
    assert on.fake.sent == []
    await ws.close()


STUDY_GROUP = [dict(MF.ma_player(pid, e), type="group" if e == SG else "player",
                    group_members=["ma-study-l", "ma-study-r"] if e == SG else [])
               for e, pid in MF.PID.items() if e != "media_player.downstairs_ma"] + [
    dict(MF.ma_player("ma-downstairs", "media_player.downstairs_ma"),
         group_members=["ma-kitchen", "ma-den", "ma-study-l", "ma-study-r"])]


async def test_music_assistants_own_group_of_the_pair_plays_it_alone(on):
    host = on.app["music"]
    on.ma.players = STUDY_GROUP
    await on.connected()
    await make_pair(on)
    assert await host.refresh_groups() in (True, False) and host.config().pair_groups == {SL: SG}
    page = host.page()
    assert page["virtual_pairs"][0]["ma_group"] == "Study Pair Ma"
    # Downstairs' old group holds the Study's two players: nothing to its rooms, which are its own
    assert page["presets"][0]["members"] == [K, D]
    await on.login("jamie", "adult")
    ws = await on.socket()
    # the pair alone: through Music Assistant's own group of the two
    r = await on.command(ws, **play([SL]))
    assert r["result"]["response"] == {"ok": True, "leader": SG}, r
    assert on.ma.sent() == [
        ("players/cmd/volume_set", {"player_id": "ma-study-l", "volume_level": 30}),
        ("players/cmd/volume_set", {"player_id": "ma-study-r", "volume_level": 30}),
        ("player_queues/shuffle", {"queue_id": "ma-study-pair", "shuffle_enabled": True}),
        ("player_queues/play_media", {"queue_id": "ma-study-pair", "media": ["library://playlist/1"],
                                      "option": "replace"}),
        ("player_queues/shuffle", {"queue_id": "ma-study-pair", "shuffle_enabled": True})]
    # the Kitchen added: the music moves off the pair's group to the Kitchen, the pair's players join it
    n = len(on.ma.sent())
    r = await on.command(ws, id=2, **SVC("music_transfer", rooms=[SL, K], source=SL))
    assert r["result"]["response"]["ok"] is True and r["result"]["response"]["leader"] == K, r
    assert on.ma.sent()[n:n + 2] == [
        ("player_queues/transfer", {"source_queue_id": "ma-study-pair", "target_queue_id": "ma-kitchen",
                                    "auto_play": True}),
        ("players/cmd/group_many", {"target_player": "ma-kitchen", "child_player_ids": ["ma-study-l", "ma-study-r"]})]
    # the pair, the Kitchen and the Den: joined under the Kitchen, never through Downstairs' old group
    n = len(on.ma.sent())
    r = await on.command(ws, id=3, **play([K, D, SL]))
    assert r["result"]["response"]["leader"] == K, r
    assert "ma-downstairs" not in json.dumps(on.ma.sent()[n:])
    # a playlist on the pair and the Den while the pair's own group plays: that group is stopped first
    await on.playing(SG)
    n = len(on.ma.sent())
    r = await on.command(ws, id=4, **play([D, SL]))
    assert r["result"]["response"] == {"ok": True, "leader": D}, r
    sent = on.ma.sent()[n:]
    join = ("players/cmd/group_many", {"target_player": "ma-den", "child_player_ids": ["ma-study-l", "ma-study-r"]})
    assert join in sent and sent.index(("players/cmd/stop", {"player_id": "ma-study-pair"})) < sent.index(join)
    await ws.close()


async def test_music_stopped_after_a_pause_stays_paused_on_the_screens(on):
    """Music Assistant stops a queue paused for 30 s (keeping its song and where it was); the Music page then showed
    nothing playing, and play started the first playlist (2026-11-01). The feed lists such a room as `resumable`,
    and play is a play_pause on it: Music Assistant resumes its queue."""
    import time
    host = on.app["music"]
    await on.connected()
    await on.playing(K, media_content_id="library://playlist/1")
    await on.ma.set(K, "paused")
    await wait_for(lambda: on.app["hub"].store.states[K]["s"] == "paused")
    await on.ma.set(K, "idle")
    await wait_for(lambda: on.app["hub"].store.states[K]["s"] == "idle")
    assert host.resumes.players(time.monotonic()) == [K]
    await on.login("jamie", "adult")
    ws = await on.socket()
    _r, ev = await on.subscribe(ws, {"type": "hk_music/subscribe"})
    assert ev["resumable"] == [K]
    r = await on.command(ws, id=2, **SVC("music_transport", player=K, command="play_pause"))
    assert r["result"]["response"] == {"ok": True}, r
    assert on.ma.sent() == [("players/cmd/play_pause", {"player_id": "ma-kitchen"})]
    await wait_for(lambda: on.app["hub"].store.states[K]["s"] == "playing")
    assert host.resumes.players(time.monotonic()) == [], "playing again: no longer held"
    # a room stopped long after its pause (or never paused) is not held
    await on.ma.set(D, "idle")
    assert host.resumes.players(time.monotonic()) == []
    await ws.close()


async def test_stop_all_within_a_pause_s_window_leaves_nothing_to_resume(on):
    """Stop All, or any Stop, soon after a pause read as Music Assistant's own stop and left the room shown as
    paused for four hours (MED-11, 2026-11-01): a stop Mantel sends is no one's to resume."""
    import time
    host = on.app["music"]
    await on.connected()
    await on.login("jamie", "adult")
    ws = await on.socket()
    for stop in (SVC("music_stop"), SVC("music_stop", rooms=[K]),
                 SVC("music_transport", player=K, command="stop")):
        await on.playing(K, media_content_id="library://playlist/1")
        await on.ma.set(K, "paused")
        await wait_for(lambda: on.app["hub"].store.states[K]["s"] == "paused")
        r = await on.command(ws, id=2, **stop)
        assert r["result"]["response"]["ok"] is True, r
        await wait_for(lambda: on.app["hub"].store.states[K]["s"] == "idle")
        assert host.resumes.players(time.monotonic()) == [], stop
    await ws.close()
