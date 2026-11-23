"""The phone as a speaker (app_music_device.py): the app's own Sendspin player reaches Music Assistant through Mantel,
with its credential, and Music Assistant plays on that player only. A fictional Music Assistant (music_fakes.py) and a
fake Sendspin server that keeps what it was sent; fictional people only."""
from __future__ import annotations

import asyncio
import json

from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestServer

from test_app_music import house, phone_of  # noqa: F401 -- the fixture

from mantel_server.apps import app_music_device as D

CID = "A" * 42 + "Q"
INIT = json.dumps({"type": "client/init", "payload": {"client_id": CID, "version": 1, "suite": "25519_ChaChaPoly_SHA256"}})
PATH = "/api/app/music/device/socket"


async def fake_sendspin(m, monkeypatch):
    """Music Assistant's Sendspin server: keeps every frame and answers each with one of its own."""
    got: list = []

    async def ws(request):
        sock = web.WebSocketResponse()
        await sock.prepare(request)
        async for msg in sock:
            got.append(msg.data)
            if msg.type == WSMsgType.TEXT:
                await sock.send_str(json.dumps({"type": "server/init", "payload": {"version": 1}}))
            else:
                await sock.send_bytes(b"\x01" + msg.data)
        return sock
    app = web.Application()
    app.router.add_get("/sendspin", ws)
    server = TestServer(app)
    await server.start_server()
    url = str(server.make_url("/sendspin")).replace("http", "ws", 1)
    monkeypatch.setattr(D, "upstream_url", lambda app: url)
    return server, got


async def connect(m, phone):
    return await m.client.ws_connect(PATH, headers=phone.headers("GET", PATH))


def test_the_first_frame_names_the_player():
    assert D.client_id_of(INIT) == CID
    assert D.client_id_of(json.dumps({"type": "client/hello", "payload": {"client_id": CID}})) is None
    assert D.client_id_of(json.dumps({"type": "client/init", "payload": {"client_id": "short"}})) is None
    assert D.client_id_of("not json") is None


async def test_the_queue_is_the_universal_player_that_wraps_the_phone():
    class Ma:
        def __init__(self, players):
            self.list = players

        async def players(self):
            if isinstance(self.list, Exception):
                raise self.list
            return self.list
    wrapped = [{"player_id": "up1a2b3c4d", "provider": "universal_player",
                "output_protocols": [{"output_protocol_id": CID, "protocol_domain": "sendspin"}]},
               {"player_id": "ma-den", "output_protocols": []}]
    assert await D.queue_of(Ma(wrapped), CID) == "up1a2b3c4d"
    assert await D.queue_of(Ma([{"player_id": CID, "protocol_parent_id": "upfeedbee"}]), CID) == "upfeedbee"
    assert await D.queue_of(Ma([{"player_id": CID}]), CID) == CID
    assert await D.queue_of(Ma(ConnectionError("gone")), CID) == CID


async def test_the_players_socket_passes_its_frames_and_plays_only_on_it(house, monkeypatch):
    m = house
    monkeypatch.setattr(D, "QUEUE_WAITS", 2)          # the fake lists no wrapper: the player's own id, at once
    server, got = await fake_sendspin(m, monkeypatch)
    try:
        phone = await phone_of(m)
        r, body = await phone.call("POST", "/api/app/music/device/play", {"media_content_id": "library://playlist/1"})
        assert r.status == 409 and body["error"] == "no_device_player"          # no socket yet: nothing to play on
        ws = await connect(m, phone)
        await ws.send_str(INIT)
        assert json.loads((await ws.receive(timeout=5)).data)["type"] == "server/init"
        await ws.send_bytes(b"noise")
        assert (await ws.receive(timeout=5)).data == b"\x01noise"
        assert got == [INIT, b"noise"]                                         # as the phone sent them
        # Music Assistant plays on this phone's player, and on no speaker of the house
        n = len(m.ma.sent())
        r, body = await phone.call("POST", "/api/app/music/device/play",
                                   {"media_content_id": "library://playlist/1", "media_content_type": "playlist"})
        assert r.status == 200 and body["response"] == {"ok": True, "leader": CID}, body
        assert m.ma.sent()[n:] == [("player_queues/play_media", {"queue_id": CID, "media": ["library://playlist/1"],
                                                                 "option": "play"})]
        rows = m.app["store"].db.execute("SELECT action, target, result FROM action_audit WHERE action = ?",
                                         ("music.device_play",)).fetchall()
        assert [tuple(x) for x in rows] == [("music.device_play", json.dumps([f"sendspin:{CID}"]), "ok")]
        # one of the house's playlists: its items, shuffled, as the rooms play it; one nobody has: nothing
        n = len(m.ma.sent())
        r, got_pl = await phone.call("GET", "/api/app/music")
        key = got_pl["playlists"][0].get("key") or got_pl["playlists"][0]["options"][0]["key"]
        r, body = await phone.call("POST", "/api/app/music/device/play", {"playlist": key})
        assert r.status == 200, body
        sent = m.ma.sent()[n:]
        assert sent[0] == ("player_queues/shuffle", {"queue_id": CID, "shuffle_enabled": True})
        assert sent[1][0] == "player_queues/play_media" and sent[1][1]["queue_id"] == CID and sent[1][1]["media"]
        r, _ = await phone.call("POST", "/api/app/music/device/play", {"playlist": "nobodys"})
        assert r.status == 404
        for bad in ({"playlist": "x", "media_content_id": "library://x"}, {"media_content_id": "javascript:alert(1)"}, {"media_content_id": "library://x", "queue_id": "q"},
                    {"media_content_id": "library://x", "media_content_type": "camera"}):
            r, _ = await phone.call("POST", "/api/app/music/device/play", bad)
            assert r.status == 400
        await ws.close()
        for _ in range(50):
            if not m.app.get(D.DEVICES):
                break
            await asyncio.sleep(0.02)
        assert not m.app.get(D.DEVICES)                                          # closed: no player to play on
    finally:
        await server.close()


async def test_a_socket_must_start_with_client_init(house, monkeypatch):
    m = house
    server, got = await fake_sendspin(m, monkeypatch)
    try:
        phone = await phone_of(m)
        ws = await connect(m, phone)
        await ws.send_str(json.dumps({"type": "client/hello", "payload": {"client_id": "legacy"}}))
        msg = await ws.receive(timeout=5)
        assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED) and got == []
    finally:
        await server.close()


async def test_without_a_credential_or_a_socket_nothing(house, monkeypatch):
    m = house
    server, got = await fake_sendspin(m, monkeypatch)
    try:
        r = await m.client.get(PATH)
        assert r.status == 401
        r = await m.client.post("/api/app/music/device/play", json={"media_content_id": "library://playlist/1"})
        assert r.status == 401
        phone = await phone_of(m)
        r = await m.client.get(PATH, headers=phone.headers("GET", PATH))      # not a WebSocket
        assert r.status == 400
        assert got == []
    finally:
        await server.close()


async def test_a_revocation_ends_the_players_socket_at_once(house, monkeypatch):
    """The phone signed out from Me → Mantel App (or its person's access gone): its player leaves Music Assistant
    within one turn of the loop, not at the next recheck."""
    m = house
    server, got = await fake_sendspin(m, monkeypatch)
    try:
        phone = await phone_of(m)
        ws = await connect(m, phone)
        await ws.send_str(INIT)
        assert json.loads((await ws.receive(timeout=5)).data)["type"] == "server/init"
        entry = next(e for e in m.app["live"].entries() if e.kind == "music_device")
        m.store.db.execute("DELETE FROM sessions")
        m.store.db.commit()
        assert await m.app["live"].revoke(*entry.subject_keys) >= 1
        msg = await ws.receive(timeout=5)
        assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED)
        for _ in range(50):
            if not m.app[D.DEVICES]:
                break
            await asyncio.sleep(0.02)
        assert not m.app[D.DEVICES]
    finally:
        await server.close()
