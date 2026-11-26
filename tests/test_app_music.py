"""The apps' music over REST (app_music.py): the Mac's native player asks what the screens' Music page asks, through
the same engine, checks and gateway. A fictional house of Music Assistant players (music_fakes.py) and a fictional
Music Assistant; the app is test_app_auth's FakeApp (a P-256 key, DPoP proofs). Fictional people and entities only."""
from __future__ import annotations

import pytest
from aiohttp.test_utils import TestClient, TestServer

import music_fakes as MF
from conftest import Mantel
from test_app_auth import sign_in_app
from test_music import build

from mantel_server.apps import app_music


@pytest.fixture
async def house(tmp_path, monkeypatch):
    app, store, now, commander, fake, server = await build(tmp_path, monkeypatch, commands=True)
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        m = Mantel(app, client, store, now, origin)
        m.ma, m.commander = fake, commander
        yield m
    await server.close()
    store.db.close()


async def phone_of(m, username="jamie", role="adult"):
    from connector_fakes import wait_for
    await wait_for(lambda: m.app["ma"].connected.is_set())
    await wait_for(lambda: m.app["music"].states.on)
    phone, _ = await sign_in_app(m, username, role)
    m.forget_cookies()
    return phone


async def playing(m, entity, **attrs):
    """A speaker plays in Music Assistant, and Mantel's state for it says so (music_states.py)."""
    from connector_fakes import wait_for
    await m.ma.set(entity, "playing", **attrs)
    await wait_for(lambda: m.app["hub"].store.states[entity]["s"] == "playing")


def play(**over):
    return MF.states(**over)


# ------------------------------------------------------------------------------------------- what plays
def test_contexts_say_where_music_that_isnt_music_assistants_comes_from():
    # 2026-11-26: a HomeView playing its own Music app AirPlays to a HomePod; an iPhone AirPlays to another; Music
    # Assistant plays in a third room. The app's contexts carry `from` / `outside` as the pages' do, the sender first.
    HV, K, D, C = "media_player.living_room", "media_player.kitchen_ma", "media_player.den_ma", "media_player.cody_ma"
    cfg = {"speakers": [{"name": "Kitchen", "entity": K}, {"name": "Living Room", "entity": HV},
                        {"name": "Den", "entity": D}, {"name": "Cody's Room", "entity": C}]}
    def st(s, **a):
        return {"s": s, "a": a, "lc": 5.0}
    states = {HV: st("playing", app_id="com.apple.sonic.music", source="Music", media_title="Song",
                     media_content_id="apple-device://ap01/snHome::STREAM"),
              K: st("playing", app_id="com.apple.tvairplayd", media_title="Song", media_content_id="apple-device://ap02/snHome::STREAM"),
              D: st("playing", app_id="com.apple.tvairplayd", media_title="Other", media_content_id="apple-device://ap03/snPhone::STREAM"),
              C: st("playing", app_id="music_assistant", media_title="Mine", media_content_id="apple_music://track/1")}
    by = {m: c for c in app_music.contexts(cfg, states) for m in c["members"]}
    assert by[K] is by[HV] and by[HV]["key"] == HV and by[HV]["members"] == [HV, K], "the sender leads its session"
    assert by[HV]["from"] == "Music on Living Room" and by[HV]["outside"] is True
    assert by[D]["from"] == "AirPlay" and by[D]["outside"] is True, "an iPhone is no speaker of the house"
    assert by[C]["from"] is None and by[C]["outside"] is False, "Music Assistant's own"


def test_contexts_group_the_house_as_the_screens_do():
    K, D, C = "media_player.kitchen_ma", "media_player.den_ma", "media_player.cody_ma"
    cfg = {"speakers": [{"name": "Downstairs", "entity": "preset:pre1", "members": [K, D]},
                        {"name": "Kitchen", "entity": K}, {"name": "Den", "entity": D},
                        {"name": "Cody's Room", "entity": C}]}
    def st(s, **a):
        return {"s": s, "a": a, "lc": 5.0}
    # a preset's rooms playing joined: one group, keyed by its leader and named by the preset; a room on its own
    states = {K: st("playing", media_title="Song 1", group_members=[K, D]), D: st("playing", group_members=[K, D]),
              C: st("paused", media_title="Song 2")}
    got = app_music.contexts(cfg, states)
    assert [(c["key"], c["kind"], c["members"]) for c in got] == [(K, "group", [K, D]), (C, "room", [C])]
    assert got[0]["preset"] == "Downstairs" and "preset" not in got[1]
    assert got[0]["playing"] and got[0]["title"] == "Song 1" and not got[1]["playing"]
    # a preset's id is no player: it is never a context of its own
    states["preset:pre1"] = st("playing")
    assert [c["key"] for c in app_music.contexts(cfg, states)] == [K, C]
    # a group that is not exactly a preset's rooms is no preset; an ad-hoc join is keyed by its leader
    states = {K: st("playing", group_members=[C, K]), C: st("playing", group_members=[C, K]), D: st("idle")}
    got = app_music.contexts(cfg, states)
    assert [(c["key"], c["kind"]) for c in got] == [(C, "group")] and "preset" not in got[0]
    assert got[0]["members"] == [C, K]
    # music Music Assistant stopped after a pause (hk_core/music/resume.py) reads as paused
    states = {K: st("idle", media_title="Song 3", group_members=[K, D]), D: st("idle", group_members=[K, D])}
    assert app_music.contexts(cfg, states) == []
    cfg["resumable"] = [K, D]
    got = app_music.contexts(cfg, states)
    assert [(c["key"], c["state"], c["playing"], c["members"]) for c in got] == [(K, "paused", False, [K, D])]
    cfg.pop("resumable")
    # an announcement is not music, with Ignore Announcements on
    cfg["ignore_announcements"] = True
    states = {C: st("playing", media_content_id="media-source://tts/x")}
    assert app_music.contexts(cfg, states) == []
    # an Intercom message never is, whatever that setting says (music_announcements.py)
    cfg["ignore_announcements"] = False
    assert [c["key"] for c in app_music.contexts(cfg, {C: st("playing", media_title="Song 3")})] == [C]
    cfg["intercom"] = [C]
    assert app_music.contexts(cfg, {C: st("playing", media_title="Song 3")}) == []


# ------------------------------------------------------------------------------------------- the routes
async def test_the_app_reads_the_music_and_sets_its_speaker(house):
    m = house
    phone = await phone_of(m)
    await playing(m, "media_player.den_ma", media_title="Song 3", media_artist="Band", volume_level=0.4)
    r, got = await phone.call("GET", "/api/app/music")
    assert r.status == 200 and got["configured"] is True, got
    assert [s["entity"] for s in got["speakers"]][:1] == ["preset:pre1"]
    den = [p for p in got["players"] if p["entity"] == "media_player.den_ma"][0]
    assert den["state"] == "playing" and den["attributes"]["media_title"] == "Song 3"
    assert den["attributes"]["volume_level"] == 0.4 and den["name"]
    assert [c["key"] for c in got["contexts"]] == ["media_player.den_ma"]
    assert got["library"] is True and "library_entry" not in got
    assert "media_player.garage_ma" not in [p["entity"] for p in got["players"]]   # MA has it; not the house's
    assert got["commands"] is True and got["focus"] is None
    r, got = await phone.call("PUT", "/api/app/music/focus", {"key": "media_player.den_ma"})
    assert r.status == 200
    r, got = await phone.call("GET", "/api/app/music")
    assert got["focus"] == "media_player.den_ma"
    r, got = await phone.call("PUT", "/api/app/music/focus", {"key": "light.kitchen"})
    assert r.status == 400


async def test_the_music_pages_requests_go_through_the_gateway(house):
    m = house
    phone = await phone_of(m)
    await playing(m, "media_player.kitchen_ma", media_content_id="library://playlist/1", volume_level=0.5)
    r, got = await phone.call("POST", "/api/app/music/command",
                              {"service": "transfer", "data": {"rooms": ["media_player.den_ma"],
                                                               "source": "media_player.kitchen_ma"}})
    assert r.status == 200 and got["response"] == {"ok": True, "leader": "media_player.den_ma"}, got
    assert m.ma.sent()[-1][0] == "player_queues/transfer"
    n = len(m.ma.sent())
    r, got = await phone.call("POST", "/api/app/music/command",
                              {"service": "transport", "data": {"player": "media_player.den_ma", "command": "play_pause"}})
    assert r.status == 200 and got["response"]["ok"] is True and got["audit_id"]
    assert m.ma.sent()[n:] and m.ma.sent()[n][0].startswith("players/cmd/")
    n = len(m.ma.sent())
    r, got = await phone.call("POST", "/api/app/music/queue/play", {"entity_id": "media_player.den_ma", "item_id": "qi-3"})
    assert r.status == 200 and got["response"] == {"ok": True}
    assert m.ma.sent()[n:] == [("player_queues/play_index", {"queue_id": "ma-den", "index": "qi-3"})]
    r, got = await phone.call("POST", "/api/app/music/volume", {"entity_id": ["media_player.den_ma"], "level": 0.3})
    assert r.status == 200, got
    # the engine's own checks: a speaker that is not the house's, a service that is not the Music page's
    r, got = await phone.call("POST", "/api/app/music/command",
                              {"service": "transport", "data": {"player": "media_player.garage_ma", "command": "next"}})
    assert r.status >= 400 or got["response"]["ok"] is False, got        # the engine's answer, as the page gets it
    assert "ma-garage" not in str(m.ma.sent())
    r, got = await phone.call("POST", "/api/app/music/command", {"service": "set_settings", "data": {}})
    assert r.status == 400
    r, got = await phone.call("POST", "/api/app/music/volume", {"entity_id": "light.kitchen", "level": 0.3})
    assert r.status == 400
    # every one audited as this person
    rows = m.app["store"].db.execute("SELECT action, decision FROM action_audit").fetchall()
    assert ("hk_frontend.music_transfer", "allowed") in [tuple(r) for r in rows]


async def test_queue_and_library_are_the_screens_reads(house):
    m = house
    phone = await phone_of(m)
    r, got = await phone.call("GET", "/api/app/music/queue?entity_id=media_player.den_ma&limit=5")
    assert r.status == 200 and got["ok"] is True and [i["id"] for i in got["items"]] == ["qi-3", "qi-4"], got
    r, got = await phone.call("GET", "/api/app/music/queue?entity_id=light.kitchen")
    assert r.status == 400
    r, got = await phone.call("GET", "/api/app/music/library?media_type=playlist&limit=10")
    assert r.status == 200 and [i["name"] for i in got["items"]] == ["Morning Mix", "Evening"], got
    r, got = await phone.call("GET", "/api/app/music/library?media_type=album&search=Album%20B")
    assert [i["name"] for i in got["items"]] == ["Album B"]
    r, got = await phone.call("GET", "/api/app/music/library?media_type=everything")
    assert r.status == 400
    r, got = await phone.call("GET", "/api/app/music/image?id=" + "a" * 64)
    assert r.status == 404                                  # no Music Assistant web address in this house


async def test_a_child_without_rooms_sees_no_speakers_and_cannot_play(house):
    m = house
    kid = await phone_of(m, "cody", "child")
    r, got = await kid.call("GET", "/api/app/music")
    assert r.status == 200
    assert got.get("configured") is False or got["players"] == []
    r, got = await kid.call("POST", "/api/app/music/command",
                            {"service": "transport", "data": {"player": "media_player.den_ma", "command": "next"}})
    assert r.status == 403
    r, got = await kid.call("GET", "/api/app/music/queue?entity_id=media_player.den_ma")
    assert r.status in (403, 404)


async def test_without_a_credential_nothing(house):
    r = await house.client.get("/api/app/music")
    assert r.status == 401


def test_one_airplay_session_is_one_context():
    """A HomeView AirPlaying to several HomePods (hk_core.music.airplay): no group in Music Assistant, one session each."""
    K, D, C = "media_player.kitchen_ma", "media_player.den_ma", "media_player.cody_ma"
    cfg = {"speakers": [{"name": "Kitchen", "entity": K}, {"name": "Den", "entity": D}, {"name": "Cody's Room", "entity": C}]}
    def st(s, sid, **a):
        return {"s": s, "a": dict(a, media_title="Song 1", group_members=[],
                                  media_content_id=f"apple-device://ap-{s}/{sid}::STREAM"), "lc": 5.0}
    states = {K: st("playing", "snA"), D: st("playing", "snA"), C: st("playing", "snB")}
    got = app_music.contexts(cfg, states)
    assert [(c["key"], c["kind"], c["members"], c.get("airplay")) for c in got] == [
        (K, "group", [K, D], True), (C, "room", [C], None)]


def test_a_playlists_cover_is_one_the_app_can_load():
    """The Music widget draws each playlist's cover: Music Assistant's proxy through the app's own door, a web picture as
    it is, anything else dropped -- the pill's and each choice's."""
    from mantel_server.apps.app_music import _app_covers
    pid = "a" * 64
    got = _app_covers({"name": "Decades", "image": f"/ma/imageproxy/{pid}?size=512",
                       "options": [{"name": "2020s", "key": "k", "image": "https://cdn.example/x.jpg"},
                                   {"name": "1990s", "key": "j", "image": "/local/x.png"}, {"name": "1980s", "key": "i"}]})
    assert got["image"] == f"/api/app/music/image?id={pid}"
    assert [o.get("image") for o in got["options"]] == ["https://cdn.example/x.jpg", None, None]
    assert "image" not in _app_covers({"name": "Jazz", "image": "/local/x.png"})
