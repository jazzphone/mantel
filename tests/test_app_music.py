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

from mantel_server import app_music


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
    phone, _ = await sign_in_app(m, username, role)
    m.forget_cookies()
    return phone


def play(**over):
    return MF.states(**over)


# ------------------------------------------------------------------------------------------- what plays
def test_contexts_group_the_house_as_the_screens_do():
    cfg = {"speakers": [{"name": "Downstairs", "entity": "media_player.downstairs_ma",
                         "members": ["media_player.kitchen_ma", "media_player.den_ma"]},
                        {"name": "Kitchen", "entity": "media_player.kitchen_ma"}, {"name": "Den", "entity": "media_player.den_ma"},
                        {"name": "Cody's Room", "entity": "media_player.cody_ma"}]}
    def st(s, **a):
        return {"s": s, "a": a, "lc": 5.0}
    # a preset playing with all its rooms: one context; a room on its own: another
    states = {"media_player.downstairs_ma": st("playing", media_title="Song 1"), "media_player.kitchen_ma": st("playing"),
              "media_player.den_ma": st("playing"), "media_player.cody_ma": st("paused", media_title="Song 2")}
    got = app_music.contexts(cfg, states)
    assert [(c["key"], c["kind"], c["members"]) for c in got] == [
        ("media_player.downstairs_ma", "preset", ["media_player.kitchen_ma", "media_player.den_ma"]),
        ("media_player.cody_ma", "room", ["media_player.cody_ma"])]
    assert got[0]["playing"] and got[0]["title"] == "Song 1" and not got[1]["playing"]
    # a stale group whose room went quiet claims nothing; an ad-hoc join is keyed by its leader
    states["media_player.den_ma"] = st("idle")
    states["media_player.kitchen_ma"] = st("playing", group_members=["media_player.cody_ma", "media_player.kitchen_ma"])
    got = app_music.contexts(cfg, states)
    assert [(c["key"], c["kind"]) for c in got] == [("media_player.cody_ma", "group")]
    assert got[0]["members"] == ["media_player.cody_ma", "media_player.kitchen_ma"]
    # an announcement is not music, with Ignore Announcements on
    cfg["ignore_announcements"] = True
    states = {"media_player.cody_ma": st("playing", media_content_id="media-source://tts/x")}
    assert app_music.contexts(cfg, states) == []


# ------------------------------------------------------------------------------------------- the routes
async def test_the_app_reads_the_music_and_sets_its_speaker(house):
    m = house
    m.app["hub"].store.apply_event({"c": {"media_player.den_ma": {"+": {"s": "playing", "a": {
        "media_title": "Song 3", "media_artist": "Band", "volume_level": 0.4}}}}})
    phone = await phone_of(m)
    r, got = await phone.call("GET", "/api/app/music")
    assert r.status == 200 and got["configured"] is True, got
    assert [s["entity"] for s in got["speakers"]][:1] == ["media_player.downstairs_ma"]
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
    m.app["hub"].store.apply_event({"c": {"media_player.kitchen_ma": {"+": {"s": "playing", "a": {
        "media_content_id": "library://playlist/1", "volume_level": 0.5}}}}})
    phone = await phone_of(m)
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
