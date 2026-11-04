"""THE INTERCOM'S LIVE MODE AND ITS AUTOMATIC FALLBACK (docs/phase17/INTERCOM.md "Automatic fallback (Live to Message)",
"Per-room Live health"; intercom/host.py ``live_frame``, ``_live_calls``, ``live_end``, ``live_abort``, ``_live_health``;
relay.py's Live branches; driver.py; listener.py), over a full app (tests/intercom_fakes.py).

The fake Music Assistant here is the relay test's, taught to misbehave on the LIVE link only (the first announcement
of a room on the live URL follows a script; a Message link is always answered as the real one answers it):

    ok       fetches the stream, the room goes ``playing``, the call answers when the stream ends (the talker is done)
    nofetch  never fetches; answers when the test lets it
    error    answers a Music Assistant error at once                                       (signal 2)
    noplay   fetches, but the room is never ``playing``                                    (signal 3)
    early    fetches, plays, and answers at once, with the talker still going              (signal 5)
    hangup   (all rooms) reads the stream's first bytes and hangs up                       (signal 4)

Nothing is played anywhere: every speaker is a fake and every Music Assistant fetch comes from the real stream
listener, so the bytes a room is told to play are compared with the PCM that was sent.

The rules pinned here: each of the five failure signals produces a Message of the WHOLE spool (byte-equal, a finite WAV)
to the rooms that failed only, and the page hears ``fallback``; rooms that played live hear nothing twice; ``after``
rooms (playing music, Live flag off, demoted) get the Message at the end; ``lag_ms``; ``end``, LIVE_IDLE and the limit
all end the talk; a dropped page socket and a Cancel stop the stream without a fallback from the server; every room
failing; three failures in a row demote a room and a success resets the count; the audit rows' results.
"""
from __future__ import annotations

import asyncio
from typing import Any, Callable

import pytest
from aiohttp.test_utils import TestClient, TestServer

import intercom_fakes as IF
import music_fakes as MF
from conftest import Mantel
from hk_core.music import engine as E
from intercom_fakes import CODY, DEN, KITCHEN, RATE, chunks, closed, recv_until, send_audio, until
from mantel_server.intercom import driver as D
from mantel_server.intercom import relay as RL
from mantel_server.intercom.spool import Spool, streaming_wav_header, wav_header

KITCHEN_ID, DEN_ID, CODY_ID = MF.PID[KITCHEN], MF.PID[DEN], MF.PID[CODY]
NAMES = {KITCHEN: "Kitchen", DEN: "Den", CODY: "Cody's Room"}


# ----------------------------------------------------------------------------------------------- the fake MA
class LiveMa(IF.IntercomMa):
    """IntercomMa that follows a script (module notes) for each room's call on the live link."""

    def __init__(self) -> None:
        super().__init__()
        self.script: dict[str, str] = {}              # Music Assistant player id -> how it treats the LIVE link
        self.hangup = False                           # signal 4: every fetch of the live link is dropped early
        self.release = asyncio.Event()                # lets the calls that wait for "the talker is done" answer
        self.live_url: Callable[[], str | None] = lambda: None
        self.started: dict[str, asyncio.Event] = {}   # live url -> its fetch has begun
        self.finished: dict[str, asyncio.Event] = {}  # live url -> its fetch is over
        self.sounding: set[str] = set()               # rooms this fake set to ``playing`` (quiet_down)
        self.replied: list[str] = []                  # player ids whose live call has been answered
        self._live_fetch: dict[str, asyncio.Task] = {}

    # one fetch of the live link for every room, as Music Assistant makes it
    def live_fetch(self, url: str) -> None:
        if url in self._live_fetch:
            return
        self.started[url], self.finished[url] = asyncio.Event(), asyncio.Event()

        async def run() -> None:
            got: dict[str, Any] = {"url": url, "status": None, "headers": {}, "body": b""}
            try:
                if self._session is None:
                    import aiohttp
                    self._session = aiohttp.ClientSession()
                async with self._session.get(url) as r:
                    got.update(status=r.status, headers=dict(r.headers))
                    self.started[url].set()
                    if self.hangup:
                        got["body"] = await r.content.read(44)       # the header, then it hangs up
                    else:
                        got["body"] = await r.read()
            except Exception as exc:  # noqa: BLE001 -- the fake reports what happened
                got["error"] = type(exc).__name__
                self.started[url].set()
            self.fetches.append(got)
            self.finished[url].set()
        task = asyncio.get_running_loop().create_task(run())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        self._live_fetch[url] = task

    async def answer(self, ws, mid, cmd, args) -> None:
        url = args.get("url")
        if cmd != IF.ANNOUNCE or url is None or url != self.live_url():
            return await super().answer(ws, mid, cmd, args)
        pid = args["player_id"]
        how = "error" if pid in self.fail else self.script.get(pid, "ok")
        self.announcements.append(dict(args))

        async def reply(error: str | None = None) -> None:
            try:
                if error is None:
                    await ws.send_json({"message_id": mid, "result": None, "partial": False})
                else:
                    await ws.send_json({"message_id": mid, "error_code": 99, "details": error})
            except Exception:  # noqa: BLE001 -- Mantel hung up
                pass
            self.replied.append(pid)

        async def work() -> None:
            entity = MF.ENT[pid]
            if how == "error":
                return await reply(self.fail.get(pid, "player unreachable"))
            if how == "nofetch":
                await self.release.wait()
                return await reply()
            self.live_fetch(url)
            await self.started[url].wait()
            if how != "noplay":
                await self.set(entity, "playing")
                self.sounding.add(entity)
            if how == "early":
                return await reply()                                 # the call returns, the talker is still going
            await self.finished[url].wait()
            if self.hangup:
                await self.release.wait()
            await reply()

        task = asyncio.get_running_loop().create_task(work())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def quiet_down(self) -> None:
        """The rooms that played go idle again, as they do once their clip is over (a real player stays ``playing``
        for the length of the clip, which is why this is a step of its own: the driver's watch needs to see it)."""
        for entity in sorted(self.sounding):
            await self.set(entity, "idle")
        self.sounding.clear()


def fixture():
    """IF.fixture's app and Env, with the scripted Music Assistant, Live allowed, and the driver's waits made short."""
    @pytest.fixture
    async def env(tmp_path, monkeypatch):
        monkeypatch.setattr(IF, "IntercomMa", LiveMa)
        monkeypatch.setattr(D, "CLAIM_WAIT", 0.5)
        monkeypatch.setattr(D, "PLAYING_WAIT", 1.0)
        app, store, now, commander, fake, server, port = await IF.build(tmp_path, monkeypatch, commands=True)
        async with TestClient(TestServer(app)) as client:
            origin = str(client.make_url("")).rstrip("/")
            client.session.headers["Origin"] = origin
            e = IF.Env(Mantel(app, client, store, now, origin), commander, fake, port)
            await e.connected()
            await e.configure(live_allowed=True, lag_ms=4000)
            fake.live_url = lambda: next((getattr(s.broadcast, "url", None) for s in e.relay.sessions
                                          if getattr(s.broadcast, "url", None)), None)
            try:
                yield e
            finally:
                await e.close_actors()
        await server.close()
        store.db.close()
    return env


lv = fixture()


# ----------------------------------------------------------------------------------------------- helpers
def session_of(env):
    (s,) = env.relay.sessions
    return s


async def settle(env) -> None:
    """The last talk's rooms finish their clips (go idle) before anything else is set up."""
    gone = set(env.ma.sounding)
    await env.ma.quiet_down()
    house = env.host.music.house
    assert await until(lambda: all(E.state_of(house, e) != "playing" for e in gone))


async def begin(env, who, rooms, script: dict[str, str] | None = None, *, hangup: bool = False):
    """A Live talk started to ``rooms``: (the socket, the events up to ``sending``, the live link's URL). ``script``:
    {room entity: how Music Assistant treats it}."""
    await settle(env)
    env.ma.script = {MF.PID[r]: how for r, how in (script or {}).items()}
    env.ma.hangup = hangup
    ws = await who.talk("live")
    await ws.send_json({"type": "start", "rooms": list(rooms)})
    events = await recv_until(ws, "sending")
    return ws, events, session_of(env).broadcast.url


async def finish(env, ws, timeout: float = 10) -> list[dict]:
    """The talker is done: ``end``, the calls that were waiting for it answer, the events up to ``sent``."""
    await ws.send_json({"type": "end"})
    env.ma.release.set()
    events = await recv_until(ws, "sent", timeout)
    await closed(ws)
    return events


def play_row(env) -> dict:
    (row,) = env.play_rows()
    return row


async def play_result(env, want: str | None = None, timeout: float = 3) -> str:
    await until(lambda: env.play_rows() and env.play_rows()[0]["result"] is not None, timeout)
    got = play_row(env)["result"]
    if want is not None:
        assert got == want
    return got


def live_announced(env, url) -> list[str]:
    return [a["player_id"] for a in env.ma.announcements if a["url"] == url]


def message_announced(env, url) -> list[dict]:
    return [a for a in env.ma.announcements if a["url"] != url]


def message_bodies(env, url) -> list[bytes]:
    return [f["body"] for f in env.ma.fetches if f["url"] != url]


def whole(pcm: bytes) -> bytes:
    """The Message a failed room must be told to play: the WHOLE spool as a finite WAV (real sizes)."""
    return wav_header(RATE, len(pcm)) + pcm


def of_type(events: list[dict], kind: str) -> list[dict]:
    return [e for e in events if e.get("type") == kind]


def types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


async def assert_fell_back(env, ws_events, url, pcm, failed: list[str], live: list[str]) -> None:
    """The fallback's whole shape: the page was told, the Message went to ``failed`` rooms only (one fetch, one clip,
    byte-equal to everything sent), and the rooms that played live were told once."""
    fb = of_type(ws_events, "fallback")
    assert fb == [{"type": "fallback", "rooms": sorted(NAMES[r] for r in failed)}]
    msgs = message_announced(env, url)
    assert sorted(a["player_id"] for a in msgs) == sorted(MF.PID[r] for r in failed)
    assert {a["url"] for a in msgs} == {msgs[0]["url"]} and msgs[0]["url"] != url      # a NEW link
    assert message_bodies(env, url) == [whole(pcm)]
    assert sorted(live_announced(env, url)) == sorted(MF.PID[r] for r in live)        # every live room was called once
    for r in set(live) - set(failed):
        assert [a["player_id"] for a in env.ma.announcements].count(MF.PID[r]) == 1      # nothing twice
    assert types(ws_events).index("fallback") < types(ws_events).index("sent")


@pytest.fixture
async def avery(lv):
    return await lv.actor("avery", "owner")


# ----------------------------------------------------------------------------------------------- the happy path
async def test_a_live_talk_with_every_room_live_needs_no_fallback(lv, avery):
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN])
    assert started[-1] == {"type": "sending", "rooms": 2, "live": 2, "after": [], "lag_ms": 4000}
    pcm = await send_audio(ws, chunks(10))
    assert await until(lambda: len(lv.ma.announcements) == 2)
    assert {a["url"] for a in lv.ma.announcements} == {url} and url.endswith(".wav")
    events = await finish(lv, ws)
    assert of_type(events, "fallback") == [] and events[-1] == {"type": "sent", "rooms": 2, "failed": [],
                                                                "fallback": []}
    (live,) = [f for f in lv.ma.fetches if f["url"] == url]
    assert live["status"] == 200 and live["body"] == streaming_wav_header(RATE) + pcm      # live, byte for byte
    assert "Content-Length" not in live["headers"]
    assert len(lv.ma.announcements) == 2 and message_bodies(lv, url) == []                # nobody heard it twice
    await play_result(lv, "ok")
    assert lv.relay.floor is None and lv.relay.sessions == set()


async def test_lag_ms_is_told_once_the_rooms_are_playing(lv, avery):
    ws, _, _ = await begin(lv, avery, [KITCHEN, DEN])
    await send_audio(ws, chunks(5))
    assert await until(lambda: len(lv.ma.announcements) == 2)
    events = await finish(lv, ws)
    (lag,) = of_type(events, "lag_ms")
    assert isinstance(lag["value"], int) and 0 <= lag["value"] < 5000                    # first byte to playing
    assert types(events)[-2:] == ["lag_ms", "sent"]


# ----------------------------------------------------------------------------------------------- the five signals
async def test_signal_1_the_link_is_never_fetched_so_every_live_room_gets_the_message(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "nofetch", DEN: "nofetch"})
    pcm = await send_audio(ws, chunks(12))
    assert await until(lambda: len(lv.ma.announcements) == 2)
    events = await finish(lv, ws)
    assert [f for f in lv.ma.fetches if f["url"] == url] == []                           # nobody fetched the live link
    await assert_fell_back(lv, events, url, pcm, [KITCHEN, DEN], [KITCHEN, DEN])
    assert events[-1] == {"type": "sent", "rooms": 2, "failed": [], "fallback": ["Den", "Kitchen"]}
    assert of_type(events, "lag_ms") == []                                               # no room ever played live
    await play_result(lv, "ok:fallback")


async def test_signal_2_play_announcement_answers_an_error_so_that_room_alone_gets_the_message(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "error"})
    pcm = await send_audio(ws, chunks(12))
    assert await until(lambda: len(lv.ma.announcements) == 2)
    events = await finish(lv, ws)
    await assert_fell_back(lv, events, url, pcm, [KITCHEN], [KITCHEN, DEN])
    assert events[-1] == {"type": "sent", "rooms": 2, "failed": [], "fallback": ["Kitchen"]}
    assert live_announced(lv, url).count(DEN_ID) == 1 and [a["player_id"] for a in
                                                          message_announced(lv, url)] == [KITCHEN_ID]
    (live,) = [f for f in lv.ma.fetches if f["url"] == url]
    assert live["body"] == streaming_wav_header(RATE) + pcm                              # Den heard it live, whole
    await play_result(lv, "ok:fallback")


async def test_signal_3_the_player_is_not_playing_in_time_so_that_room_alone_gets_the_message(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {DEN: "noplay"})
    pcm = await send_audio(ws, chunks(12))
    assert await until(lambda: len(lv.ma.announcements) == 2)
    events = await finish(lv, ws)
    await assert_fell_back(lv, events, url, pcm, [DEN], [KITCHEN, DEN])
    assert events[-1]["fallback"] == ["Den"] and events[-1]["failed"] == []
    assert len(of_type(events, "lag_ms")) == 1                                           # the Kitchen did play live
    await play_result(lv, "ok:fallback")


async def test_signal_4_the_fetch_ends_before_the_talker_so_the_live_rooms_get_the_message(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], hangup=True)
    await send_audio(ws, chunks(6))
    assert await until(lambda: lv.ma.finished.get(url) is not None and lv.ma.finished[url].is_set())
    assert await until(lambda: any(s.broadcast.link.ended_early for s in lv.relay.sessions))
    pcm = b"".join(chunks(6)) + await send_audio(ws, chunks(6, seed=9))    # the talker goes on, nobody is listening
    events = await finish(lv, ws)
    await assert_fell_back(lv, events, url, pcm, [KITCHEN, DEN], [KITCHEN, DEN])
    await play_result(lv, "ok:fallback")


async def test_signal_5_the_call_returns_while_the_talker_is_still_going(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "early"})
    first = await send_audio(ws, chunks(5))
    assert await until(lambda: KITCHEN_ID in lv.ma.replied)
    await asyncio.sleep(0.2)                                                             # Mantel has seen the answer
    pcm = first + await send_audio(ws, chunks(5, seed=5))
    events = await finish(lv, ws)
    await assert_fell_back(lv, events, url, pcm, [KITCHEN], [KITCHEN, DEN])
    await play_result(lv, "ok:fallback")


async def test_a_signal_never_sends_the_remainder_only(lv, avery):
    """A clip that starts mid-sentence is worse: the Message is the spool from its first byte, however late the
    failure was seen."""
    ws, _, url = await begin(lv, avery, [KITCHEN], {KITCHEN: "early"})
    first = await send_audio(ws, chunks(3))
    assert await until(lambda: KITCHEN_ID in lv.ma.replied)
    await asyncio.sleep(0.2)
    rest = await send_audio(ws, chunks(8, seed=3))
    events = await finish(lv, ws)
    (body,) = message_bodies(lv, url)
    assert body == whole(first + rest) and body[44:44 + len(first)] == first
    assert of_type(events, "fallback") == [{"type": "fallback", "rooms": ["Kitchen"]}]


# ----------------------------------------------------------------------------------------------- the `after` rooms
async def test_a_room_playing_music_gets_the_message_at_the_end_and_the_live_room_hears_nothing_twice(lv, avery):
    await lv.ma.set(DEN, "playing")
    house = lv.host.music.house
    assert await until(lambda: E.state_of(house, DEN) == "playing")
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN])
    assert started[-1]["live"] == 1 and started[-1]["after"] == ["Den"]
    rooms = {r["room"]: r for r in of_type(started, "rooms")[0]["rooms"]}
    assert rooms[DEN]["state"] == "after" and rooms[KITCHEN]["state"] == "ok" and rooms[KITCHEN]["live"]
    pcm = await send_audio(ws, chunks(10))
    assert await until(lambda: len(lv.ma.announcements) == 1)
    assert live_announced(lv, url) == [KITCHEN_ID]                       # only the idle room goes live
    events = await finish(lv, ws)
    assert of_type(events, "fallback") == []                             # `after` is not a failure
    assert [a["player_id"] for a in message_announced(lv, url)] == [DEN_ID]
    assert message_bodies(lv, url) == [whole(pcm)]
    assert [a["player_id"] for a in lv.ma.announcements].count(KITCHEN_ID) == 1
    assert events[-1] == {"type": "sent", "rooms": 2, "failed": [], "fallback": []}
    await play_result(lv, "ok")


async def test_a_room_with_its_live_flag_off_hears_the_message_at_the_end(lv, avery):
    doc = lv.doc()
    doc["rooms"][DEN]["live"] = False
    lv.app["settings"].store.write([("house", "intercom", doc)], actor=IF.SettingsActor(label="test"))
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN])
    assert started[-1]["after"] == ["Den"] and started[-1]["live"] == 1
    pcm = await send_audio(ws, chunks(10))
    events = await finish(lv, ws)
    assert [a["player_id"] for a in message_announced(lv, url)] == [DEN_ID]
    assert message_bodies(lv, url) == [whole(pcm)] and of_type(events, "fallback") == []
    await play_result(lv, "ok")


async def test_a_demoted_room_hears_the_message_at_the_end(lv, avery):
    lv.edit(rooms={**lv.doc()["rooms"], DEN: {**lv.doc()["rooms"][DEN], "live_fails": 3, "demoted": True}})
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN])
    assert started[-1]["after"] == ["Den"]
    pcm = await send_audio(ws, chunks(10))
    events = await finish(lv, ws)
    assert [a["player_id"] for a in message_announced(lv, url)] == [DEN_ID]
    assert message_bodies(lv, url) == [whole(pcm)] and of_type(events, "fallback") == []
    assert lv.doc()["rooms"][DEN]["demoted"] is True                     # it was not a Live result at all
    await play_result(lv, "ok")


async def test_after_rooms_and_failed_rooms_share_one_message_link(lv, avery):
    await lv.ma.set(CODY, "playing")
    assert await until(lambda: E.state_of(lv.host.music.house, CODY) == "playing")
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN, CODY], {KITCHEN: "error"})
    assert started[-1]["after"] == ["Cody's Room"] and started[-1]["live"] == 2
    pcm = await send_audio(ws, chunks(10))
    assert await until(lambda: len(lv.ma.announcements) == 2)
    events = await finish(lv, ws)
    msgs = message_announced(lv, url)
    assert sorted(a["player_id"] for a in msgs) == sorted([KITCHEN_ID, CODY_ID])
    assert len({a["url"] for a in msgs}) == 1 and message_bodies(lv, url) == [whole(pcm)]
    assert of_type(events, "fallback") == [{"type": "fallback", "rooms": ["Kitchen"]}]    # Cody's Room just waited
    assert sorted(live_announced(lv, url)) == sorted([KITCHEN_ID, DEN_ID])             # Cody's Room was not called live
    await play_result(lv, "ok:fallback")


async def test_an_after_room_whose_message_fails_is_a_partial_result(lv, avery):
    await lv.ma.set(DEN, "playing")
    assert await until(lambda: E.state_of(lv.host.music.house, DEN) == "playing")
    lv.ma.fail[DEN_ID] = "player unreachable"
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN])
    await send_audio(ws, chunks(10))
    events = await finish(lv, ws)
    assert events[-1] == {"type": "sent", "rooms": 1, "failed": ["Den"], "fallback": []}
    await play_result(lv, "ok:partial:1")


# ----------------------------------------------------------------------------------------------- how a talk ends
async def test_end_is_the_normal_finish_and_the_stream_ends_with_it(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN])
    pcm = await send_audio(ws, chunks(10))
    assert await until(lambda: lv.ma.started.get(url) is not None and lv.ma.started[url].is_set())
    assert not lv.ma.finished[url].is_set()                              # the stream stays open while he talks
    events = await finish(lv, ws)
    assert lv.ma.finished[url].is_set()
    assert [f for f in lv.ma.fetches if f["url"] == url][0]["body"][44:] == pcm
    assert events[-1]["type"] == "sent" and lv.relay.sessions == set()


async def test_no_audio_for_live_idle_ends_the_talk_and_the_whole_spool_is_the_message(lv, avery, monkeypatch):
    monkeypatch.setattr(RL, "LIVE_IDLE", 0.5)
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "error"})
    pcm = await send_audio(ws, chunks(8))                                # then he says nothing, and sends no `end`
    lv.ma.release.set()
    events = await recv_until(ws, "sent", 10)
    await assert_fell_back(lv, events, url, pcm, [KITCHEN], [KITCHEN, DEN])
    assert await closed(ws) == 1000
    await play_result(lv, "ok:fallback")


async def test_the_limit_ends_the_talk_with_the_full_spool_as_the_message(lv, avery, monkeypatch):
    monkeypatch.setattr(lv.host, "new_spool", lambda rate, limit: Spool(rate, 1.0))     # a 1 s limit, 48000 bytes
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "error"})
    parts = chunks(25)                                                   # exactly the cap; it ends on the last
    pcm = await send_audio(ws, parts)
    assert len(pcm) == 48000
    lv.ma.release.set()
    events = await recv_until(ws, "sent", 10)
    await assert_fell_back(lv, events, url, pcm, [KITCHEN], [KITCHEN, DEN])
    assert message_bodies(lv, url)[0] == whole(b"".join(parts))
    await play_result(lv, "ok:fallback")


async def test_the_limit_with_every_room_live_is_ok_max_length(lv, avery, monkeypatch):
    monkeypatch.setattr(lv.host, "new_spool", lambda rate, limit: Spool(rate, 1.0))
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN])
    pcm = await send_audio(ws, chunks(25))
    events = await recv_until(ws, "sent", 10)
    assert events[-1]["failed"] == [] and of_type(events, "fallback") == []
    (live,) = [f for f in lv.ma.fetches if f["url"] == url]
    assert live["body"][44:] == pcm and len(pcm) == 48000
    await play_result(lv, "ok:max_length")


# ----------------------------------------------------------------------------------------------- the page goes away
async def test_a_dropped_page_socket_stops_the_stream_and_the_server_sends_no_fallback(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "error"})
    await send_audio(ws, chunks(6))
    assert await until(lambda: len(lv.ma.announcements) == 2)
    await ws.close()                                                     # the Wi-Fi blinks; the page has its copy
    assert await until(lambda: lv.relay.sessions == set())
    assert await play_result(lv) == "error:client_gone"
    assert lv.ma.finished[url].is_set()                                  # the stream was cut off
    assert message_announced(lv, url) == [] and message_bodies(lv, url) == []   # the PAGE sends its own copy
    assert lv.relay.floor is None
    (open_row,) = lv.open_rows()
    assert open_row["result"] == "error:client_gone"
    assert len(lv.host.links) == 0                                       # the live link is gone
    # and the stream ended without the server claiming a fallback or a health result
    assert lv.doc()["rooms"][KITCHEN]["live_fails"] == 0


async def test_a_dropped_page_socket_lets_the_next_talk_start(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN])
    await send_audio(ws, chunks(3))
    await ws.close()
    assert await until(lambda: lv.relay.sessions == set() and lv.relay.floor is None)
    lv.ma.release.set()
    ws2, started, url2 = await begin(lv, avery, [KITCHEN])
    assert started[-1]["type"] == "sending" and url2 != url
    await send_audio(ws2, chunks(3))
    await finish(lv, ws2)


async def test_cancel_mid_live_stops_everything_and_nothing_more_plays(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "error"})
    await send_audio(ws, chunks(6))
    assert await until(lambda: len(lv.ma.announcements) == 2)
    await ws.send_json({"type": "cancel"})
    assert await closed(ws) == 1000
    assert await until(lambda: lv.relay.sessions == set())
    assert await play_result(lv) == "error:cancelled"
    assert message_announced(lv, url) == [] and lv.relay.floor is None and len(lv.host.links) == 0
    assert (lv.open_rows()[0]["result"]) == "error:cancelled"
    assert lv.doc()["rooms"][KITCHEN]["live_fails"] == 0


# ----------------------------------------------------------------------------------------------- everything fails
async def test_every_room_failing_is_sent_with_the_failed_list_and_an_error_result(lv, avery):
    lv.ma.fail.update({KITCHEN_ID: "player unreachable", DEN_ID: "player unreachable"})
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "error", DEN: "error"})
    pcm = await send_audio(ws, chunks(8))
    events = await finish(lv, ws)
    assert of_type(events, "fallback") == [{"type": "fallback", "rooms": ["Den", "Kitchen"]}]
    assert events[-1] == {"type": "sent", "rooms": 0, "failed": ["Kitchen", "Den"], "fallback": ["Den", "Kitchen"]}
    assert message_bodies(lv, url) == [whole(pcm)]                       # it did try the whole spool as a Message
    assert of_type(events, "lag_ms") == []
    result = await play_result(lv)
    assert result.startswith("error:") and result != "error:not_sent"
    for room in (KITCHEN, DEN):
        assert lv.doc()["rooms"][room]["live_fails"] == 1


async def test_every_room_failing_live_but_the_message_getting_through_is_ok_fallback(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "error", DEN: "error"})
    pcm = await send_audio(ws, chunks(8))
    events = await finish(lv, ws)
    assert events[-1] == {"type": "sent", "rooms": 2, "failed": [], "fallback": ["Den", "Kitchen"]}
    assert message_bodies(lv, url) == [whole(pcm)]
    await play_result(lv, "ok:fallback")


# ----------------------------------------------------------------------------------------------- Live health
async def talk_once(env, who, script: dict[str, str], rooms=(KITCHEN, DEN)) -> list[dict]:
    env.ma.release = asyncio.Event()
    env.ma.announcements.clear()
    env.ma.fetches.clear()
    ws, _, _ = await begin(env, who, list(rooms), script)
    await send_audio(ws, chunks(5))
    assert await until(lambda: len(env.ma.announcements) == len(rooms))
    events = await finish(env, ws)
    assert await until(lambda: env.relay.sessions == set())
    return events


def fails(env, room) -> tuple[int, bool]:
    r = env.doc()["rooms"][room]
    return r["live_fails"], r["demoted"]


async def test_three_failures_in_a_row_demote_a_room_to_message_only(lv, avery):
    for n in (1, 2, 3):
        events = await talk_once(lv, avery, {KITCHEN: "error"})
        assert of_type(events, "fallback") == [{"type": "fallback", "rooms": ["Kitchen"]}]
        assert fails(lv, KITCHEN) == (n, n == 3)
        assert fails(lv, DEN) == (0, False)                              # the room that played is untouched
    # the fourth talk: the Kitchen is Message-only, it is `after`, and it gets the Message at the end
    lv.ma.release = asyncio.Event()
    lv.ma.announcements.clear()
    lv.ma.fetches.clear()
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN])
    assert started[-1]["after"] == ["Kitchen"] and started[-1]["live"] == 1
    rooms = {r["room"]: r for r in of_type(started, "rooms")[0]["rooms"]}
    assert rooms[KITCHEN]["state"] == "after"
    pcm = await send_audio(ws, chunks(5))
    events = await finish(lv, ws)
    assert [a["player_id"] for a in message_announced(lv, url)] == [KITCHEN_ID]
    assert message_bodies(lv, url) == [whole(pcm)] and of_type(events, "fallback") == []
    assert fails(lv, KITCHEN) == (3, True)                               # not a Live result, so no change
    assert [r["result"] for r in lv.play_rows()][-3:] == ["ok:fallback", "ok:fallback", "ok"]


async def test_the_count_is_stored_in_the_rooms_settings_row_for_the_page(lv, avery):
    await talk_once(lv, avery, {KITCHEN: "error"})
    stored = lv.app["settings"].store.body("house", "intercom")
    assert stored["rooms"][KITCHEN]["live_fails"] == 1 and stored["rooms"][KITCHEN]["demoted"] is False
    assert stored["rooms"][DEN]["live_fails"] == 0


async def test_a_success_resets_the_count(lv, avery):
    await talk_once(lv, avery, {KITCHEN: "error"})
    await talk_once(lv, avery, {KITCHEN: "error"})
    assert fails(lv, KITCHEN) == (2, False)
    await talk_once(lv, avery, {})                                       # Live worked this time
    assert fails(lv, KITCHEN) == (0, False)
    await talk_once(lv, avery, {KITCHEN: "error"})
    await talk_once(lv, avery, {KITCHEN: "error"})
    assert fails(lv, KITCHEN) == (2, False)                              # not "four in all": two in a row


async def test_try_live_again_clears_a_demotion(lv, avery):
    for _ in range(3):
        await talk_once(lv, avery, {KITCHEN: "error"})
    assert fails(lv, KITCHEN) == (3, True)
    from hk_core.intercom import config as C
    lv.host.save(C.merge_room(lv.doc(), KITCHEN, {"reset_live": True}), IF.SettingsActor(label="test"))
    assert fails(lv, KITCHEN) == (0, False)
    events = await talk_once(lv, avery, {})
    assert of_type(events, "fallback") == [] and fails(lv, KITCHEN) == (0, False)


async def test_each_failure_signal_counts_as_a_failure_of_that_room(lv, avery):
    await talk_once(lv, avery, {KITCHEN: "noplay"})
    assert fails(lv, KITCHEN) == (1, False) and fails(lv, DEN) == (0, False)
    await talk_once(lv, avery, {DEN: "error"})
    assert fails(lv, DEN) == (1, False) and fails(lv, KITCHEN) == (0, False)      # Kitchen played: its count cleared


# ----------------------------------------------------------------------------------------------- the audit rows
async def test_the_audit_rows_say_what_happened(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN])
    await send_audio(ws, chunks(6))
    await finish(lv, ws)
    (play,) = lv.play_rows()
    assert play["result"] == "ok" and play["decision"] == "allowed"
    assert "mode:live" in play["reason"] and "rooms:2" in play["reason"]
    assert KITCHEN in play["target"] and DEN in play["target"]
    (opened,) = lv.open_rows()
    assert opened["result"] == "ok"
    for row in lv.audit():                                               # never about content
        assert "pcm" not in str(row).lower() and url not in str(row)


async def test_play_row_results_ok_fallback_and_partial_are_told_apart(lv, avery):
    await talk_once(lv, avery, {})
    await talk_once(lv, avery, {KITCHEN: "error"})
    await settle(lv)
    await lv.ma.set(DEN, "playing")
    assert await until(lambda: E.state_of(lv.host.music.house, DEN) == "playing")
    lv.ma.fail[DEN_ID] = "player unreachable"
    lv.ma.release = asyncio.Event()
    ws, _, _ = await begin(lv, avery, [KITCHEN, DEN])
    await send_audio(ws, chunks(5))
    await finish(lv, ws)
    assert [r["result"] for r in lv.play_rows()] == ["ok", "ok:fallback", "ok:partial:1"]
