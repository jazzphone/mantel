"""connectors/ma.py against a fake Music Assistant: reads, partial results, events, reconnect, and the
gated command path (default: refuse; nothing is sent). Never a real MA."""
import asyncio
import re

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from connector_fakes import MA_TOKEN, FakeMa, wait_for
from mantel_server.config import Config
from mantel_server.connectors import REFUSE_ALL, Ctx, Hooks
from mantel_server.connectors import ma
from mantel_server.connectors.ma import (MA_COMMANDS, MA_READS, CommandRefused, MaBlocked, MaClient, MaTokenMissing,
                                         _Ticket, check_outgoing)

WRITE = re.compile(r"(^|[/_])(cmd|play|play_media|pause|stop|next|previous|seek|shuffle|repeat|transfer|add|remove|"
                   r"update|create|delete|sync|clear|move|mark|refresh|favorites|power|volume|group|ungroup|"
                   r"announcement|set|resume|skip)([/_]|$)")


class Allow:
    def __init__(self, answer=True):
        self.answer, self.asked = answer, []

    async def allow(self, identity, command, args):
        self.asked.append((identity, command, args))
        return self.answer


@pytest.fixture
async def fake_ma():
    fake = FakeMa()
    async with TestServer(fake.app()) as server:
        fake.url = str(server.make_url("")).rstrip("/")
        yield fake


@pytest.fixture
def token_file(tmp_path):
    f = tmp_path / "ma_token"
    f.write_text(MA_TOKEN + "\n")
    return f


@pytest.fixture
async def client(fake_ma, token_file):
    c = MaClient(fake_ma.url, token_file, request_timeout=3, backoff_start=0.05, backoff_max=0.1)
    c.start()
    await asyncio.wait_for(c.connected.wait(), 3)
    yield c
    await c.close()


# ------------------------------------------------------------------------- pins
def test_reads_and_commands_are_disjoint_and_reads_are_reads():
    assert not set(MA_READS) & set(MA_COMMANDS)
    for name, keys in MA_READS.items():
        assert not WRITE.search(name), name
        assert "force_refresh" not in keys
    assert "auth" not in MA_READS and "auth" not in MA_COMMANDS


def test_default_gate_refuses_everything():
    for name in MA_COMMANDS:
        assert REFUSE_ALL.allow("anyone", name, {}) is False


@pytest.mark.parametrize("frame", [
    {"message_id": "1", "command": "player_queues/play_media", "args": {"queue_id": "q", "media": "x"}},
    {"message_id": "1", "command": "players/cmd/volume_set", "args": {"player_id": "p", "volume_level": 5}},
    {"message_id": "1", "command": "music/library/remove_item", "args": {}},
    {"message_id": "1", "command": "music/sync", "args": {}},
    {"message_id": "1", "command": "config/players/save", "args": {}},
    {"message_id": "1", "command": "music/playlists/playlist_tracks", "args": {"item_id": "1", "force_refresh": True}},
    {"message_id": "1", "command": "auth", "args": {"token": "t", "extra": 1}},
    {"message_id": "1", "command": "players/all", "args": {}, "extra": True},
    {"message_id": "1", "command": None},
])
def test_outgoing_refuses_everything_but_auth_and_reads(frame):
    with pytest.raises(MaBlocked):
        check_outgoing(frame)


def test_a_ticket_is_good_for_one_frame_of_its_own_command():
    t = _Ticket("player_queues/pause")
    with pytest.raises(MaBlocked):
        check_outgoing({"message_id": "1", "command": "player_queues/play", "args": {"queue_id": "q"}}, t)
    check_outgoing({"message_id": "1", "command": "player_queues/pause", "args": {"queue_id": "q"}}, t)
    with pytest.raises(MaBlocked):        # used
        check_outgoing({"message_id": "2", "command": "player_queues/pause", "args": {"queue_id": "q"}}, t)


def test_ws_url_is_mas_ws_endpoint():
    assert ma.ws_url_of("http://ma.fake.test:8095") == "ws://ma.fake.test:8095/ws"
    assert ma.ws_url_of("ws://ma.fake.test:8095/ws") == "ws://ma.fake.test:8095/ws"


# ------------------------------------------------------------------------- reads
async def test_connects_authenticates_with_the_file_token_and_reads(client, fake_ma):
    assert fake_ma.frames[0] == {"message_id": fake_ma.frames[0]["message_id"], "command": "auth",
                                 "args": {"token": MA_TOKEN}}
    assert client.server_info["server_version"] == "2.10.6" and client.user == {"username": "mantel-fake"}
    assert await client.players() == [{"player_id": "fake-den", "display_name": "Den", "state": "idle"}]
    assert await client.queues() == [{"queue_id": "fake-den", "items": 0}]
    assert await client.queue_items("fake-den") == [{"queue_item_id": "q1", "name": "Fictional Song"}]
    assert (await client.search("hello"))["tracks"][0]["name"] == "hello"
    assert await client.browse() == [{"path": "library://", "name": "Library"}]
    assert MA_TOKEN not in repr(vars(client))                   # the token is not kept on the client


async def test_partial_results_are_joined(client):
    assert await client.library("tracks", limit=10) == [{"item_id": str(i)} for i in (1, 2, 3, 4)]


async def test_reads_refuse_commands_and_unknown_args(client, fake_ma):
    before = list(fake_ma.frames)
    for bad in (lambda: client.read("player_queues/play_media", queue_id="q", media="x"),
                lambda: client.read("music/playlists/playlist_tracks", item_id="1",
                                    provider_instance_id_or_domain="p", force_refresh=True),
                lambda: client.library("everything")):
        with pytest.raises(MaBlocked):
            await bad()
    assert fake_ma.frames == before


async def test_events_fan_out_filtered_and_stop(client, fake_ma):
    got_all, got_players = [], []
    stop_all = client.subscribe(got_all.append)
    client.subscribe(got_players.append, events=["player_updated"])
    await fake_ma.push({"event": "player_updated", "object_id": "fake-den", "data": {"state": "playing"}})
    await fake_ma.push({"event": "queue_updated", "object_id": "fake-den", "data": {}})
    await wait_for(lambda: len(got_all) == 2)
    assert [e["event"] for e in got_players] == ["player_updated"]
    stop_all()
    await fake_ma.push({"event": "queue_updated", "object_id": "fake-den", "data": {}})
    await wait_for(lambda: len(got_players) == 1)
    await asyncio.sleep(0.05)
    assert len(got_all) == 2


async def test_reconnects_with_backoff_and_tells_listeners(client, fake_ma):
    events = []
    client.subscribe(events.append)
    await fake_ma.drop()
    await wait_for(lambda: client.connects == 2)
    assert fake_ma.connections == 2 and fake_ma.commands().count("auth") == 2
    assert {"event": "mantel_reconnected", "object_id": None, "data": None} in events
    assert await client.players()


async def test_bad_token_never_connects_and_keeps_retrying(fake_ma, tmp_path):
    f = tmp_path / "t"
    f.write_text("wrong-token")
    c = MaClient(fake_ma.url, f, request_timeout=1, backoff_start=0.02, backoff_max=0.05)
    c.start()
    await wait_for(lambda: fake_ma.auth_failures >= 2)
    assert not c.connected.is_set()
    f.write_text(MA_TOKEN)                                   # a fixed secret is picked up at the next connect
    await asyncio.wait_for(c.connected.wait(), 3)
    await c.close()


async def test_missing_token_file_stops_the_connector(fake_ma, tmp_path):
    c = MaClient(fake_ma.url, tmp_path / "nope")
    with pytest.raises(MaTokenMissing):
        await asyncio.wait_for(c.run(), 3)
    assert fake_ma.connections == 0


# ------------------------------------------------------------------------- the gated command path
async def test_command_is_refused_by_default_and_nothing_is_sent(client, fake_ma):
    with pytest.raises(CommandRefused):
        await client.command("fictional-user", "player_queues/pause", queue_id="fake-den")
    assert "player_queues/pause" not in fake_ma.commands()
    assert set(client.sent) <= {"auth"} | set(MA_READS)


async def test_a_refusing_gate_sees_the_request_and_nothing_is_sent(fake_ma, token_file):
    gate = Allow(answer=False)
    c = MaClient(fake_ma.url, token_file, gate=gate, request_timeout=3)
    c.start()
    await asyncio.wait_for(c.connected.wait(), 3)
    with pytest.raises(CommandRefused):
        await c.command("kid", "players/cmd/volume_set", player_id="fake-den", volume_level=90)
    assert gate.asked == [("kid", "players/cmd/volume_set", {"player_id": "fake-den", "volume_level": 90})]
    assert fake_ma.commands() == ["auth"]
    await c.close()


async def test_an_allowing_gate_sends_catalog_commands_only(fake_ma, token_file):
    gate = Allow()
    c = MaClient(fake_ma.url, token_file, gate=gate, request_timeout=3)
    c.start()
    await asyncio.wait_for(c.connected.wait(), 3)
    assert await c.command("owner", "player_queues/pause", queue_id="fake-den") is None
    with pytest.raises(MaBlocked):                           # not in the catalog: the gate is not even asked
        await c.command("owner", "music/library/remove_item", media_type="track", library_item_id=1)
    with pytest.raises(MaBlocked):                           # an argument the catalog does not list
        await c.command("owner", "player_queues/play", queue_id="fake-den", danger=True)
    assert fake_ma.commands() == ["auth", "player_queues/pause"]
    assert [a[1] for a in gate.asked] == ["player_queues/pause", "player_queues/play"]
    await c.close()


# ------------------------------------------------------------------------- register (client messages)
def music_hooks(allowed: bool):
    # the music feature, and the den's speaker (not the kitchen's): ma/read and ma/subscribe answer per player
    return Hooks(may_read=lambda who, kind, ids: [i for i in ids if allowed and i in ("feature:music", "media_player.den")])


def speakers_registry():
    from types import SimpleNamespace
    return SimpleNamespace(registry=SimpleNamespace(entity_entries=[
        {"entity_id": "media_player.den", "platform": "music_assistant", "unique_id": "fake-den"},
        {"entity_id": "media_player.kitchen", "platform": "music_assistant", "unique_id": "fake-kitchen"}]))


async def make_registered(fake_ma, token_file, hooks):
    app = web.Application()
    app["cfg"] = Config(ma_url=fake_ma.url, ma_token_file=token_file)
    app["hub"] = speakers_registry()
    client = ma.register(app, None, hooks)
    client.request_timeout = 3
    client.start()
    await asyncio.wait_for(client.connected.wait(), 3)
    return app, client


async def test_register_offers_reads_and_events_only(fake_ma, token_file):
    app, client = await make_registered(fake_ma, token_file, music_hooks(True))
    assert set(app["ws_handlers"]) == {"ma/read", "ma/subscribe", "ma/unsubscribe"}
    out = []

    async def send(m):
        out.append(m)
    ctx = Ctx(send=send, identity="adult")
    h = app["ws_handlers"]
    await h["ma/read"](ctx, {"id": 1, "command": "players/all"})
    await h["ma/read"](ctx, {"id": 2, "command": "player_queues/play_media", "args": {"queue_id": "q", "media": "x"}})
    await h["ma/subscribe"](ctx, {"id": 3, "events": ["player_updated"]})
    await fake_ma.push({"event": "player_updated", "object_id": "fake-kitchen", "data": {}})   # not theirs
    await fake_ma.push({"event": "player_updated", "object_id": "fake-den", "data": {}})
    await wait_for(lambda: any(m["type"] == "ma_event" for m in out))
    await h["ma/read"](ctx, {"id": 4, "command": "player_queues/items", "args": {"queue_id": "fake-kitchen"}})
    await ctx.close()
    assert out[0] == {"type": "ma_result", "id": 1, "result": [{"player_id": "fake-den", "display_name": "Den",
                                                                "state": "idle"}]}
    assert out[1]["error"]["code"] == "not_allowed"
    assert out[2] == {"type": "ma_result", "id": 3, "result": None}
    assert out[3]["event"]["event"] == "player_updated" and out[3]["event"]["object_id"] == "fake-den"
    assert [m["event"]["object_id"] for m in out if m["type"] == "ma_event"] == ["fake-den"] and ctx.subs == {}
    assert out[-1] == {"type": "ma_result", "id": 4, "error": {"code": "not_found", "message": "no such player"}}
    assert "player_queues/play_media" not in fake_ma.commands()
    await client.close()


async def test_register_needs_the_music_feature(fake_ma, token_file):
    app, client = await make_registered(fake_ma, token_file, music_hooks(False))
    out = []

    async def send(m):
        out.append(m)
    await app["ws_handlers"]["ma/read"](Ctx(send=send, identity="guest"), {"id": 1, "command": "players/all"})
    assert out == [{"type": "ma_result", "id": 1, "error": {"code": "forbidden", "message": "may not use music"}}]
    assert fake_ma.commands() == ["auth"]
    await client.close()


async def test_register_without_an_ma_url_is_off():
    app = web.Application()
    app["cfg"] = Config()
    assert ma.register(app, None, None) is None and app["ma"] is None
    out = []

    async def send(m):
        out.append(m)
    await app["ws_handlers"]["ma/read"](Ctx(send=send), {"id": 9, "command": "players/all"})
    assert out[0]["error"]["code"] == "unavailable"
