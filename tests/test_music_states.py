"""Music without Home Assistant (music_states.py, music_browse.py, 2026-10-31): with Music Assistant connected to Mantel,
the speakers' states, their covers and the pages' own media_player commands are Music Assistant's -- HA restarting or
gone changes nothing about music. Against the fictional house and fake Music Assistant of music_fakes.py; Home
Assistant is never contacted (test_music.build makes reaching it a failure). Fictional names, ids and tokens only."""
from __future__ import annotations

import asyncio
import io
import json

import pytest
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

import music_fakes as MF
from conftest import Mantel
from connector_fakes import wait_for
from test_music import Env, build

from mantel_server import music_states as S
from mantel_server.connectors import media_art

K, D, C, G = "media_player.kitchen_ma", "media_player.den_ma", "media_player.cody_ma", "media_player.downstairs_ma"
COVER = "http://ma.fake.test:8095/imageproxy/0f0f?size=512&fmt=jpg"


# ------------------------------------------------------------------------------------------- HA's shape, from MA's
# A Music Assistant 2.10 player and its group as players/all gives them (the house's shape, fictional ids)
LEADER = {"player_id": "ap-guest", "display_name": "Guest HomePod", "type": "player", "available": True, "enabled": True,
          "powered": True, "playback_state": "playing", "volume_level": 18, "volume_muted": None,
          "group_members": ["ap-guest", "ap-kitchen", "ap-hidden"], "synced_to": None, "active_source": "sg-all",
          "supported_features": ["volume_set", "volume_mute", "pause", "set_members"], "volume_control": "native",
          "mute_control": "native", "power_control": "none", "icon": "mdi-speaker",
          "source_list": [{"id": "sg-all", "name": "Music Assistant Queue", "passive": False}],
          "current_media": {"uri": "apple_music://track/1", "title": "Snow", "artist": "A Singer", "album": "Winter",
                            "album_artist": None, "image_url": COVER, "duration": 197, "elapsed_time": 12.7,
                            "elapsed_time_last_updated": 1793465798.5}}
MEMBER = dict(LEADER, player_id="ap-kitchen", display_name="Kitchen HomePod", group_members=[], synced_to="ap-guest")
GROUP = dict(LEADER, player_id="sg-all", display_name="HomePods", type="group", group_volume=18, volume_level=None,
             supported_features=["volume_set", "volume_mute", "multi_device_dsp"], icon="mdi-speaker-multiple",
             group_members=["ap-guest", "ap-kitchen", "ap-hidden"])
QUEUE = {"queue_id": "sg-all", "shuffle_enabled": True, "repeat_mode": "off"}
PLAYERS = {p["player_id"]: p for p in (LEADER, MEMBER, GROUP)}
ENTITY_OF = {"ap-guest": "media_player.guest_homepod", "ap-kitchen": "media_player.kitchen_homepod",
             "sg-all": "media_player.homepods"}


def test_a_speakers_state_is_what_has_music_assistant_integration_shows():
    state, a = S.ha_state("media_player.kitchen_homepod", MEMBER, PLAYERS, {"sg-all": QUEUE}, ENTITY_OF, "Kitchen")
    assert state == "playing"
    # the bits HA's integration gives a grouping speaker with native volume and mute (the house's 8320575)
    assert a["supported_features"] == 8320575
    # a speaker synced to a leader lists the leader's group, as entity ids (the hidden one has none: left out)
    assert a["group_members"] == ["media_player.guest_homepod", "media_player.kitchen_homepod"]
    assert a["volume_level"] == 0.18 and "is_volume_muted" not in a
    assert (a["media_title"], a["media_artist"], a["media_album_name"], a["media_duration"]) == ("Snow", "A Singer",
                                                                                                 "Winter", 197)
    assert a["media_content_id"] == "apple_music://track/1" and a["media_content_type"] == "music"
    assert a["media_position"] == 12 and a["media_position_updated_at"].startswith("2026-10-31T")
    assert a["shuffle"] is True and a["repeat"] == "off" and a["app_id"] == "music_assistant"
    assert a["source"] == "Music Assistant Queue" and a["active_queue"] == "sg-all" and a["mass_player_type"] == "player"
    assert a["friendly_name"] == "Kitchen" and a["icon"] == "mdi:speaker" and a["device_class"] == "speaker"
    # the cover: Music Assistant's address, and Mantel's own route as the one a page draws
    assert a["entity_picture"] == COVER
    assert a["entity_picture_local"].startswith("/api/media/media_player.kitchen_homepod/art?v=")
    state, g = S.ha_state("media_player.homepods", GROUP, PLAYERS, {"sg-all": QUEUE}, ENTITY_OF, None)
    assert g["supported_features"] == 7796287 and "group_members" not in g      # a sync group cannot group (HA's)
    assert g["volume_level"] == 0.18 and g["friendly_name"] == "HomePods" and g["mass_player_type"] == "group"
    # Music Assistant's icon names as HA's integration maps them; no source list where none can be picked
    _s, hp = S.ha_state("media_player.x", dict(LEADER, icon="homepod-mini"), PLAYERS, {}, ENTITY_OF, "X")
    assert hp["icon"] == "mdi:speaker" and "source_list" not in a
    assert S.ha_state("media_player.x", dict(GROUP, icon="speakers"), PLAYERS, {}, ENTITY_OF, "X")[1]["icon"] == \
        "mdi:speaker-multiple"
    # off, unavailable
    state, off = S.ha_state("media_player.x", dict(LEADER, powered=False), PLAYERS, {}, ENTITY_OF, "X")
    assert state == "off" and "media_title" not in off and "entity_picture" not in off and "group_members" in off
    state, gone = S.ha_state("media_player.x", dict(LEADER, available=False), PLAYERS, {}, ENTITY_OF, "X")
    assert state == "unavailable" and set(gone) == {"friendly_name", "icon", "device_class", "supported_features"}


# ------------------------------------------------------------------------------------------- the house, HA gone
@pytest.fixture
async def on(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "CHECK_EVERY", 0.05)
    app, store, now, commander, fake, server = await build(tmp_path, monkeypatch, commands=True)
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        env = Env(Mantel(app, client, store, now, origin), commander, fake)
        await env.connected()
        yield env
    await server.close()
    store.db.close()


def st(env, eid):
    return env.app["hub"].store.states[eid]


def ha_restarts(env):
    """What Mantel's HA client does while HA restarts: HA's music_assistant entities go unavailable as it stops,
    then a reconnect's first event replaces every state (the speakers still unavailable while HA's integration
    loads) -- each through the hub's change chain, as HaClient.handle does."""
    hub = env.app["hub"]
    gone = {e: {"+": {"s": "unavailable", "a": {"friendly_name": "x", "restored": True}, "lc": 2.0}} for e in MF.PLAYERS}
    hub.ha.on_change(hub.store.apply_event({"c": gone}))
    fresh = {e: {"s": "unavailable", "a": {"restored": True}, "lc": 3.0} for e in MF.PLAYERS}
    fresh["media_player.tv"] = {"s": "off", "a": {"friendly_name": "TV"}, "lc": 3.0}
    hub.ha.on_change(hub.store.replace_all({"a": fresh}))


async def test_the_speakers_states_are_music_assistants_and_survive_has_restart(on):
    await on.playing(K, media_title="Song 3", media_artist="Band", volume_level=0.4, image=COVER)
    s = st(on, K)
    assert s["s"] == "playing" and s["a"]["media_title"] == "Song 3" and s["a"]["volume_level"] == 0.4
    assert s["a"]["friendly_name"] == "Kitchen Ma", "HA's own name for the speaker, kept"
    await on.login("jamie", "adult")
    ws = await on.m.client.ws_connect("/ws")
    await ws.send_json({"type": "subscribe", "all": True})
    snap = json.loads(await asyncio.wait_for(ws.receive_str(), 3))
    while snap.get("type") != "snapshot":
        snap = json.loads(await asyncio.wait_for(ws.receive_str(), 3))
    assert snap["entities"][K]["s"] == "playing"
    assert snap["entities"][K]["a"]["entity_picture_local"].startswith(f"/api/media/{K}/art?v=")
    ha_restarts(on)
    # nothing HA said reaches a page or the engine: every speaker is still Music Assistant's
    for e in MF.PLAYERS:
        assert st(on, e)["s"] != "unavailable", e
    assert st(on, K)["a"]["media_title"] == "Song 3" and "restored" not in st(on, K)["a"]
    assert st(on, "media_player.tv")["a"] == {"friendly_name": "TV"}, "a player that is not Music Assistant's is HA's"
    assert on.app["music"].house.state(K).state == "playing"            # what the engine's waits read
    # and the page heard only Music Assistant's changes
    await on.ma.set(K, "paused")
    while True:
        frame = json.loads(await asyncio.wait_for(ws.receive_str(), 3))
        if frame.get("type") == "diff" and K in (frame.get("changes") or {}):
            assert frame["changes"][K]["+"]["s"] == "paused"
            break
        assert "unavailable" not in json.dumps(frame.get("changes") or {}), frame
    await ws.close()


async def test_commands_go_to_music_assistant_with_ha_gone(on):
    ha_restarts(on)
    await on.login("jamie", "adult")
    ws = await on.socket()
    svc = lambda s, n=1, **d: {"id": n, "kind": "service", "domain": "media_player", "service": s, "data": d}  # noqa: E731
    r = await on.command(ws, **svc("volume_set", entity_id=K, volume_level=0.35))
    assert "error" not in r, r
    assert on.ma.sent()[-1] == ("players/cmd/volume_set", {"player_id": "ma-kitchen", "volume_level": 35})
    await wait_for(lambda: st(on, K)["a"]["volume_level"] == 0.35)
    r = await on.command(ws, **svc("media_play_pause", 2, entity_id=[K, D]))
    assert on.ma.sent()[-2:] == [("players/cmd/play_pause", {"player_id": "ma-kitchen"}),
                                 ("players/cmd/play_pause", {"player_id": "ma-den"})]
    await on.command(ws, **svc("volume_mute", 3, entity_id=K, is_volume_muted=True))
    await on.command(ws, **svc("media_seek", 4, entity_id=K, seek_position=61.9))
    await on.command(ws, **svc("repeat_set", 5, entity_id=K, repeat="all"))
    await on.command(ws, **svc("volume_up", 6, entity_id=G))
    assert on.ma.sent()[-4:] == [("players/cmd/volume_mute", {"player_id": "ma-kitchen", "muted": True}),
                                 ("players/cmd/seek", {"player_id": "ma-kitchen", "position": 61}),
                                 ("player_queues/repeat", {"queue_id": "ma-kitchen", "repeat_mode": "all"}),
                                 ("players/cmd/volume_up", {"player_id": "ma-downstairs"})]
    # target form, as the media sheet sends it
    r = await on.command(ws, id=7, kind="ws", msg={
        "type": "call_service", "domain": "media_player", "service": "media_next_track", "target": {"entity_id": D}})
    assert "error" not in r, r
    assert on.ma.sent()[-1] == ("players/cmd/next", {"player_id": "ma-den"})
    # every one audited, and none of it went to Home Assistant
    assert on.fake.sent == []
    assert {r["action"] for r in on.audit()} >= {"media_player.volume_set", "media_player.media_play_pause",
                                                  "media_player.media_seek", "media_player.media_next_track"}
    # a player that is not Music Assistant's, or a service it has no command for, is still HA's
    await on.command(ws, **svc("volume_set", 8, entity_id="media_player.tv", volume_level=0.1))
    await on.command(ws, **svc("select_source", 9, entity_id=K, source="TV"))
    assert on.fake.sent == ["media_player.volume_set", "media_player.select_source"]
    await ws.close()


async def test_shuffle_acts_on_the_speakers_active_queue_as_has_does(on):
    await on.login("jamie", "adult")
    ws = await on.socket()
    p = dict(on.ma.model["ma-kitchen"], active_source="ma-downstairs")
    on.ma.model["ma-kitchen"] = p
    await on.ma.push({"event": "player_updated", "object_id": "ma-kitchen", "data": p})
    await wait_for(lambda: st(on, K)["a"].get("active_queue") == "ma-downstairs")
    await on.command(ws, kind="service", domain="media_player", service="shuffle_set",
                     data={"entity_id": K, "shuffle": False})
    assert on.ma.sent()[-1] == ("player_queues/shuffle", {"queue_id": "ma-downstairs", "shuffle_enabled": False})
    await ws.close()


async def test_rbac_decides_a_plain_media_player_call_and_nothing_is_sent_when_refused(on):
    await on.m.user("cody", "child")
    uid = on.app["accounts"].db.execute("SELECT id FROM users WHERE username='cody'").fetchone()["id"]
    on.app["rbac"].set_scopes("user", uid, ["cody_room"])
    await on.login("cody", "child")
    ws = await on.socket()
    n = len(on.ma.sent())
    r = await on.command(ws, kind="service", domain="media_player", service="volume_set",
                         data={"entity_id": K, "volume_level": 1.0})
    assert r["error"]["code"] == "forbidden" and on.ma.sent()[n:] == [] and on.fake.sent == []
    # a join naming a speaker one may not control is refused whole
    r = await on.command(ws, id=2, kind="service", domain="media_player", service="join",
                         data={"entity_id": C, "group_members": [K]})
    assert r["error"]["code"] == "forbidden" and on.ma.sent()[n:] == []
    r = await on.command(ws, id=3, kind="service", domain="media_player", service="volume_set",
                         data={"entity_id": C, "volume_level": 0.5})
    assert on.ma.sent()[n:] == [("players/cmd/volume_set", {"player_id": "ma-cody", "volume_level": 50})], r
    await ws.close()


async def test_the_cover_comes_from_music_assistant_with_ha_gone(on, monkeypatch):
    class Web:
        asked: list = []

        def get(self, url, **kw):
            Web.asked.append(url)
            buf = io.BytesIO()
            Image.new("RGB", (800, 800), (10, 20, 30)).save(buf, "JPEG")
            body = buf.getvalue()

            class R:
                status, headers = 200, {"Content-Type": "image/jpeg"}

                class content:
                    @staticmethod
                    async def iter_chunked(n):
                        yield body

                async def __aenter__(self):
                    return self

                async def __aexit__(self, *a):
                    return False
            return R()

    async def resolve(host, port):
        return {"192.0.2.53"}
    scaled = on.app["media_art_scaled"]
    scaled.session, scaled.resolve = Web(), resolve
    await on.playing(K, image=COVER)
    ha_restarts(on)
    await on.login("jamie", "adult")
    path = st(on, K)["a"]["entity_picture_local"]
    r = await on.m.get(path + "&s=150")
    assert r.status == 200 and Image.open(io.BytesIO(await r.read())).size == (150, 150)
    assert Web.asked == [COVER], "Music Assistant's own picture, never HA's media proxy"
    r = await on.m.get(path)                    # no size: the largest bucket, still from Music Assistant
    assert r.status == 200 and Web.asked[-1] == COVER
    # a page under a prefix gets the route under it
    shaped = media_art.shape(K, st(on, K), "/prefix")
    assert shaped["a"]["entity_picture_local"] == "/prefix" + path and shaped["a"]["entity_picture"] == COVER
    # nothing playing: no picture
    await on.ma.set(K, "idle")
    p = dict(on.ma.model["ma-kitchen"], current_media=None)
    on.ma.model["ma-kitchen"] = p
    await on.ma.push({"event": "player_updated", "object_id": "ma-kitchen", "data": p})
    await wait_for(lambda: "entity_picture_local" not in st(on, K)["a"])
    assert (await on.m.get(path)).status == 404
    # one who may not see the speaker gets nothing
    await on.m.user("cody", "child")
    uid = on.app["accounts"].db.execute("SELECT id FROM users WHERE username='cody'").fetchone()["id"]
    on.app["rbac"].set_scopes("user", uid, ["cody_room"])
    await on.login("cody", "child")
    assert (await on.m.get(path)).status == 403


async def test_music_assistant_away_reads_unavailable_after_the_grace_and_comes_back(on, monkeypatch):
    monkeypatch.setattr(S, "GRACE", 0.2)
    await on.playing(K, media_title="Song 3")
    stop = on.app["ma"]
    stop.backoff_start = 0.6                    # keep it away a moment: the grace is shorter
    await on.ma.drop()
    await asyncio.sleep(0.1)
    assert st(on, K)["s"] == "playing", "kept through a short absence (Music Assistant restarting)"
    await wait_for(lambda: st(on, K)["s"] == "unavailable", timeout=3)
    assert st(on, K)["a"]["friendly_name"] == "Kitchen Ma"
    await wait_for(lambda: st(on, K)["s"] == "playing", timeout=5)     # reconnected: read again
    assert st(on, K)["a"]["media_title"] == "Song 3"


async def test_without_music_assistant_the_states_are_has_again(on):
    await on.playing(K, media_title="Song 3")
    ha = dict(on.app["music"].states.ha_seen[D])
    client = on.app["ma"]
    on.app["ma"] = None                     # as connections.py removes it (the Connections page)
    await client.close()
    on.app["music"].connection_changed()
    assert on.app["music"].states.on is False
    assert st(on, D) == ha and st(on, K)["s"] == "idle", "HA's own states, as it last gave them"
    assert "entity_picture_local" not in st(on, K)["a"]


async def test_status_says_where_the_states_come_from(on):
    await on.login("owner1", "owner")
    body = await (await on.m.get("/api/music/status")).json()
    assert body["states"]["on"] is True and body["states"]["speakers"] == len(MF.PLAYERS)


async def test_up_next_and_the_cover_search_come_from_music_assistant(on):
    await on.login("jamie", "adult")
    ws = await on.socket()
    got = (await on.read(ws, {"type": "music_assistant/get_queue", "entity_id": K}))["result"]
    q = got[K]
    assert (q["queue_id"], q["name"], q["current_index"], q["shuffle_enabled"]) == ("ma-kitchen", "Fictional", 2, True)
    assert q["current_item"]["queue_item_id"] == "qi-3" and q["current_item"]["media_item"]["name"] == "Song 3"
    nxt = q["next_item"]["media_item"]
    assert nxt["name"] == "Song 4" and nxt["artists"][0]["name"] == "Band"
    assert nxt["album"]["image"] == f"/ma/imageproxy/{MF.PROXY_ID}?size=256"
    got = (await on.read(ws, {"type": "music_assistant/search", "config_entry_id": MF.MA_ENTRY, "name": "Song",
                              "artist": "Band", "media_type": ["track"], "limit": 5}, rid=51))["result"]
    assert [t["name"] for t in got["tracks"]] == ["Song 1", "Song 2"] and set(got) == {
        "artists", "albums", "tracks", "playlists", "radio", "audiobooks", "podcasts"}
    asked = [f["args"] for f in on.ma.frames if f["command"] == "music/search"]
    assert asked[-1] == {"search_query": "Band - Song", "media_types": ["track"], "limit": 5, "library_only": False}
    # a player that is not Music Assistant's: the old way (the shim asks HA); bad fields: refused, nothing asked
    got = await on.read(ws, {"type": "music_assistant/get_queue", "entity_id": "media_player.tv"}, rid=52)
    assert got["error"]["code"] == "ma_not_configured"
    n = len(on.ma.frames)
    got = await on.read(ws, {"type": "music_assistant/search", "name": "x", "media_type": ["show"]}, rid=53)
    assert got["error"]["code"] == "not_allowed" and on.ma.frames[n:] == []
    assert on.fake.sent == []
    await ws.close()
    # one who may not see the speaker: as if it did not exist
    await on.m.user("cody", "child")
    uid = on.app["accounts"].db.execute("SELECT id FROM users WHERE username='cody'").fetchone()["id"]
    on.app["rbac"].set_scopes("user", uid, ["cody_room"])
    await on.login("cody", "child")
    ws = await on.socket()
    got = await on.read(ws, {"type": "music_assistant/get_queue", "entity_id": K})
    assert got["error"]["code"] == "not_found" and on.ma.frames[n:] == []
    await ws.close()
