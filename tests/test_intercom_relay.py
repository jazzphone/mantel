"""THE INTERCOM'S AUDIO SOCKET AND BROADCAST (docs/phase17/INTERCOM.md "The audio socket", "Concurrency"; intercom/relay.py,
host.py, driver.py), over a full app (tests/intercom_fakes.py): the gateway's ``intercom`` command issues a one-time
ticket, the page's socket spends it, the draft fills a spool in memory, and ``send`` makes ONE link on the real stream
listener and tells a fake Music Assistant to announce it -- which fetches it from that listener, so the bytes it receives
are checked against the PCM that was sent. No sound is made anywhere; every speaker is a fake.

The rules pinned here: the ticket (10 s, once, one identity); the first frame; the frames and the only text frames; the
two audit rows in order (the open row before the ticket, the play row before Music Assistant hears anything: NO ROW,
NO SOUND); one broadcast at a time; the limits and the idle draft; revocation, a role change and commands turned off
ending the socket; Cancel, Re-record and a dropped socket dropping the draft; IntercomRun's gate; the per-call
timeout; too_short; the rate limit; the rooms event and why nothing was left; the group trap (on the fake only).
"""
from __future__ import annotations

import asyncio
import sqlite3

import aiohttp
import pytest

import intercom_fakes as IF
from intercom_fakes import (ANNOUNCE, CODY, DEN, KITCHEN, RATE, chunks, closed, frame_bytes, recv, recv_until,
                            send_audio, until)
from mantel_server.connectors.ma import CommandRefused
from mantel_server.intercom import driver as D
from mantel_server.intercom import relay as RL
from mantel_server.intercom.spool import wav_header
from mantel_server.server import apply_commands, tick_once

ic = IF.fixture(commands=True)
ic_off = IF.fixture(commands=False)

SEND = {"type": "send", "rooms": [KITCHEN]}


def row_result(env, aid):
    return env.audit(id=aid)[0]["result"]


async def result_is(env, aid, want, timeout=3):
    assert await until(lambda: env.audit(id=aid)[0]["result"] == want, timeout), env.audit(id=aid)[0]["result"]


def session_of(env):
    (s,) = env.relay.sessions
    return s


async def sent_clip(env, ws, rooms=(KITCHEN,), parts=None):
    """Record a clip and send it; the events up to ``sent``."""
    parts = parts or chunks(10)
    pcm = await send_audio(ws, parts)
    await ws.send_json({"type": "send", "rooms": list(rooms)})
    return pcm, await recv_until(ws, "sent")


# ----------------------------------------------------------------------------------------------- the ticket
async def test_the_open_row_is_written_before_the_ticket_is_issued(ic, monkeypatch):
    avery = await ic.actor("avery", "owner")
    seen = []
    real = ic.relay.issue

    def issue(principal, mode, rate, aid):
        (row,) = ic.audit()                                  # THE ROW FIRST: written, no result, no ticket yet
        seen.append((row["id"], row["kind"], row["action"], row["decision"], row["result"], len(ic.relay.tickets)))
        return real(principal, mode, rate, aid)

    monkeypatch.setattr(ic.relay, "issue", issue)
    hub = await avery.hub()
    reply = await avery.ticket(hub)
    assert reply["type"] == "command_result" and reply["result"]["expires_in"] == 10
    assert reply["result"]["url"] == "/ws/intercom" and len(reply["result"]["ticket"]) >= 43
    assert seen == [(reply["audit_id"], "ma", "intercom.open", "allowed", None, 0)]
    (row,) = ic.audit()
    assert row["target"] == '["feature:intercom"]' and row["role"] == "owner" and row["result"] is None


async def test_the_ticket_is_single_use_and_the_page_can_go_on(ic):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    token = (await avery.ticket(hub))["result"]["ticket"]
    ws = await avery.audio(token)
    ok = await recv(ws)
    assert ok == {"type": "auth_ok", "mode": "message", "rate": RATE, "max_s": 30}
    await ws.close()
    again = await avery.audio(token)
    assert (await recv(again))["type"] == "auth_invalid"
    assert await closed(again) == 1008


async def test_the_ticket_lasts_ten_seconds_and_an_unused_one_gets_its_result(ic):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    first = await avery.ticket(hub)
    unused = await avery.ticket(hub, id=2)
    ic.now[0] += 11
    ws = await avery.audio(first["result"]["ticket"])
    assert (await recv(ws))["type"] == "auth_invalid" and await closed(ws) == 1008
    ic.relay.sweep()                                          # the policy tick does this every minute
    assert row_result(ic, first["audit_id"]) == "error:ticket_expired"
    assert row_result(ic, unused["audit_id"]) == "error:ticket_unused"
    assert ic.relay.tickets == {}


async def test_a_ticket_is_bound_to_who_asked(ic):
    avery = await ic.actor("avery", "owner")
    jordan = await ic.actor("jordan", "adult")
    reply = await avery.ticket(await avery.hub())
    ws = await jordan.audio(reply["result"]["ticket"])        # another person's cookies, avery's ticket
    assert (await recv(ws))["type"] == "auth_invalid" and await closed(ws) == 1008
    assert row_result(ic, reply["audit_id"]) == "error:ticket_other_identity"
    assert ic.relay.sessions == set()


async def test_the_same_person_in_another_session_cannot_use_it_either(ic):
    avery = await ic.actor("avery", "owner")
    reply = await avery.ticket(await avery.hub())
    again = await ic.actor("avery", "owner")                  # the same person, a different session
    ws = await again.audio(reply["result"]["ticket"])
    assert (await recv(ws))["type"] == "auth_invalid"
    assert row_result(ic, reply["audit_id"]) == "error:ticket_other_identity"


@pytest.mark.parametrize("first", [
    {"type": "auth", "access_token": ""}, {"type": "auth", "access_token": "x" * 43},
    {"type": "auth", "access_token": None}, {"type": "auth", "access_token": 7},
    {"type": "auth", "access_token": "x", "extra": 1}, {"type": "cancel"}, {"type": "send", "rooms": [KITCHEN]},
    {"access_token": "x"}, [], "auth"])
async def test_the_first_frame_must_be_auth_with_a_ticket(ic, first):
    avery = await ic.actor("avery", "owner")
    ws = await avery.audio(None, auth=False)
    await ws.send_json(first)
    assert (await recv(ws))["type"] == "auth_invalid"
    assert await closed(ws) == 1008
    assert ic.relay.sessions == set() and ic.ma.announced() == []


async def test_a_binary_or_broken_first_frame_is_refused(ic):
    avery = await ic.actor("avery", "owner")
    for send in (lambda ws: ws.send_bytes(b"\x01" + bytes(100)), lambda ws: ws.send_str("{not json")):
        ws = await avery.audio(None, auth=False)
        await send(ws)
        assert (await recv(ws))["type"] == "auth_invalid"
        assert await closed(ws) == 1008


async def test_a_person_has_one_open_socket_at_a_time(ic):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    ws = await avery.talk(hub=hub)
    second = await avery.ticket(hub, id=2)
    ws2 = await avery.audio(second["result"]["ticket"])
    msg = await recv(ws2)
    assert msg["type"] == "error" and msg["code"] == "busy_here"
    assert await closed(ws2) == 1008
    assert row_result(ic, second["audit_id"]) == "refused:busy"
    await ws.close()
    assert await until(lambda: ic.relay.sessions == set())
    third = await avery.ticket(hub, id=3)                     # the first one went: the next is let in
    ws3 = await avery.audio(third["result"]["ticket"])
    assert (await recv(ws3))["type"] == "auth_ok"


async def test_the_upgrade_is_refused_while_the_intercom_is_off(ic):
    avery = await ic.actor("avery", "owner")
    ic.edit(enabled=False)
    with pytest.raises(aiohttp.WSServerHandshakeError) as exc:
        await avery.http.ws_connect("/ws/intercom", headers=avery.headers(False))
    assert exc.value.status == 403


async def test_with_commands_off_there_is_no_intercom_socket_command_or_listener(ic_off):
    avery = await ic_off.actor("avery", "owner")
    with pytest.raises(aiohttp.WSServerHandshakeError) as exc:
        await avery.http.ws_connect("/ws/intercom", headers=avery.headers(False))
    assert exc.value.status == 403
    ws = await avery.hub(caps=False)
    await ws.send_json({"type": "command", "id": 5, "kind": "intercom", "mode": "message", "rate": RATE})
    from mantel_server.server import COMMANDS_DISABLED
    assert await recv(ws) == {**COMMANDS_DISABLED, "id": 5}
    assert ic_off.host.listener is None and ic_off.audit() == [] and ic_off.relay.tickets == {}


# --------------------------------------------------------------------------------------------------- frames
@pytest.mark.parametrize("name,frame", [
    ("empty", b""), ("only the marker", b"\x01"), ("wrong marker", b"\x02" + bytes(960)),
    ("marker zero", b"\x00" + bytes(960)), ("odd length", b"\x01" + bytes(961)),
    ("longer than 100 ms", b"\x01" + bytes(frame_bytes(RATE, 100) + 2))])
async def test_a_bad_binary_frame_closes_the_socket(ic, name, frame):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await ws.send_bytes(frame)
    assert await closed(ws) == 1008, name
    await result_is(ic, ws.audit_id, "refused:bad_frame")
    assert ic.ma.announced() == [] and ic.relay.sessions == set()


async def test_a_huge_frame_is_refused_by_the_socket_itself(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await ws.send_bytes(b"\x01" + bytes(RL.MAX_MSG + 10))
    assert await closed(ws) in (1008, 1009)
    assert await until(lambda: ic.relay.sessions == set())


async def test_audio_is_rate_capped_and_never_closes_the_socket(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk(rate=16000)
    frame = b"\x01" + bytes(frame_bytes(16000, 100))          # 100 ms each, a full frame
    for _ in range(30):                                        # 3 s of audio at once
        await ws.send_bytes(frame)
    await asyncio.sleep(0.3)
    s = session_of(ic)
    assert 32000 <= s.spool.nbytes <= 32000 + 10 * 3200, s.spool.nbytes   # ~1 s burst plus a sliver of refill
    assert s.dropped >= 15 and not ws.closed
    await ws.close()


@pytest.mark.parametrize("frame", [
    {"type": "nope"}, {"type": "auth", "access_token": "x"}, {"type": "call_service", "domain": "lock"},
    {"type": "cancel", "x": 1}, {"type": "start", "rooms": [KITCHEN]}, {"type": "end"},
    {"type": "send", "rooms": KITCHEN}, {"type": "send", "rooms": [1]}, {"type": "send", "rooms": [], "override": "yes"},
    {"type": "send", "rooms": [], "extra": 1}, {"type": "send", "rooms": ["media_player.x"] * 65}, [], "text", 7,
    {}])
async def test_only_cancel_send_start_and_end_text_frames_are_taken(ic, frame):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await ws.send_json(frame)
    assert await closed(ws) == 1008
    await result_is(ic, ws.audit_id, "refused:bad_message")
    assert ic.ma.announced() == []


async def test_text_that_is_not_json_closes_the_socket(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await ws.send_str("{broken")
    assert await closed(ws) == 1008
    await result_is(ic, ws.audit_id, "refused:bad_message")


async def test_live_is_not_offered_until_an_owner_allows_it(ic):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    reply = await avery.ticket(hub, "live")                    # live_allowed is false (the proof has not passed)
    assert reply["error"]["code"] == "unavailable" and reply["error"]["message"] == "live_off"
    assert ic.relay.tickets == {} and ic.audit(id=reply["audit_id"])[0]["decision"] == "denied"
    away = await ic.actor("sam", "owner", tunnel=True)         # and never away from home, even when it is allowed
    ic.edit(live_allowed=True)
    reply = await away.ticket(await away.hub(), "live")
    assert reply["error"]["code"] == "unavailable" and reply["error"]["message"] == "live_not_away"


# ------------------------------------------------------------------- a Message, from the page to the speakers
async def test_a_message_reaches_the_fake_music_assistant_exactly_and_is_audited_in_order(ic):
    avery = await ic.actor("avery", "owner")
    at_call = []
    ic.ma.on_call = lambda args: at_call.append(
        ([(r["action"], r["result"], r["target"]) for r in ic.audit()], len(ic.host.links), dict(args)))
    ws = await avery.talk()
    assert ic.open_rows()[0]["result"] is None
    pcm, events = await sent_clip(ic, ws, rooms=[KITCHEN, DEN])
    assert [e["type"] for e in events] == ["rooms", "sending", "sent"]
    assert [(r["room"], r["name"], r["state"]) for r in events[0]["rooms"]] == [
        (KITCHEN, "Kitchen", "ok"), (DEN, "Den", "ok")]
    assert events[0]["can_override"] is True
    assert events[1] == {"type": "sending", "rooms": 2} and events[2] == {"type": "sent", "rooms": 2, "failed": []}
    assert await closed(ws) == 1000

    # THE PLAY ROW BEFORE MUSIC ASSISTANT IS TOLD ANYTHING: when each announcement arrived, the row was there, with no
    # result yet, and the link had been made (and Music Assistant had not yet fetched it)
    assert len(at_call) == 2
    for rows, links, args in at_call:
        assert ("intercom.play", None, '["media_player.kitchen_ma", "media_player.den_ma"]') in rows
        assert ("intercom.open", None, '["feature:intercom"]') in rows
        assert links == 1
    # one call per room's player, all with the same one-time link, each with its own volume
    calls = {a["player_id"]: a for a in ic.ma.announcements}
    assert set(calls) == {"ma-kitchen", "ma-den"}
    assert calls["ma-kitchen"]["url"] == calls["ma-den"]["url"]
    assert calls["ma-kitchen"] == {"player_id": "ma-kitchen", "url": calls["ma-kitchen"]["url"], "pre_announce": True,
                                   "volume_level": 40}
    assert calls["ma-den"] == {"player_id": "ma-den", "url": calls["ma-den"]["url"], "pre_announce": True,
                               "volume_level": 40}, "Automatic: the house's Volume, never Music Assistant's own"
    url = calls["ma-den"]["url"]
    assert url.startswith(ic.base + "/s/") and url.endswith(".wav") and "?" not in url
    assert len(url) == len(ic.base) + len("/s/") + 43 + len(".wav")

    # ONE fetch for every room, a whole WAV with its real length, and the bytes are exactly the PCM that was sent
    (fetch,) = ic.ma.fetches
    assert fetch["status"] == 200 and fetch["url"] == url
    assert fetch["headers"]["Content-Type"] == "audio/wav" and fetch["headers"]["Accept-Ranges"] == "none"
    assert fetch["headers"]["Cache-Control"] == "no-store"
    assert fetch["headers"]["Content-Length"] == str(44 + len(pcm)) == str(len(fetch["body"]))
    assert fetch["body"] == wav_header(RATE, len(pcm)) + pcm

    # both rows got their result; the link died with the broadcast; nothing of the audio is left
    assert await until(lambda: ic.open_rows()[0]["result"] == "ok" and ic.play_rows()[0]["result"] == "ok")
    (play,) = ic.play_rows()
    assert play["reason"] == "mode:message rooms:2" and play["decision"] == "allowed" and play["role"] == "owner"
    assert len(ic.host.links) == 0
    async with aiohttp.ClientSession() as s:
        async with s.get(url) as r:
            assert r.status == 404 and await r.read() == b""
    assert await until(lambda: ic.relay.sessions == set() and ic.relay.floor is None)


async def test_the_rooms_volume_is_the_rooms_own_capped_by_the_house(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await sent_clip(ic, ws, rooms=[CODY])
    (call,) = ic.ma.announced()
    assert call["args"]["player_id"] == "ma-cody" and call["args"]["volume_level"] == 70   # 90, capped at 70


async def test_a_preset_and_a_floor_expand_to_their_rooms(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    _, events = await sent_clip(ic, ws, rooms=["preset:pre1"])
    assert [r["room"] for r in events[0]["rooms"]] == [KITCHEN, DEN]
    assert {c["args"]["player_id"] for c in ic.ma.announced()} == {"ma-kitchen", "ma-den"}


async def test_the_chime_follows_the_messages_switch(ic):
    ic.edit(chime={"message": False, "live": False})
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await sent_clip(ic, ws)
    assert ic.ma.announced()[0]["args"]["pre_announce"] is False


async def test_a_room_that_failed_is_named_and_the_row_says_partial(ic):
    ic.ma.fail["ma-den"] = "Player is not available"
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    _, events = await sent_clip(ic, ws, rooms=[KITCHEN, DEN])
    assert events[-1] == {"type": "sent", "rooms": 1, "failed": ["Den"]}
    assert await closed(ws) == 1000
    assert await until(lambda: ic.play_rows()[0]["result"] == "ok:partial:1")
    assert ic.open_rows()[0]["result"] == "ok:partial:1"


async def test_every_room_failing_is_an_error_row(ic):
    ic.ma.fail.update({"ma-kitchen": "down", "ma-den": "down"})
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    _, events = await sent_clip(ic, ws, rooms=[KITCHEN, DEN])
    assert events[-1] == {"type": "sent", "rooms": 0, "failed": ["Kitchen", "Den"]}
    assert await until(lambda: (ic.play_rows()[0]["result"] or "").startswith("error:"))
    assert ic.play_rows()[0]["result"] == "error:ma_99"


# ------------------------------------------------------------------------------- NO ROW, NO SOUND
async def test_no_row_no_sound(ic, monkeypatch):
    real = ic.app["audit"].record

    def record(*args, **kw):
        if kw.get("action") == "intercom.play":
            raise sqlite3.OperationalError("database or disk is full")
        return real(*args, **kw)

    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()                                    # (the open row is written: only the play row fails)
    monkeypatch.setattr(ic.app["audit"], "record", record)
    await send_audio(ws, chunks(10))
    await ws.send_json(SEND)
    events = await recv_until(ws, "error")
    assert events[-1]["code"] == "audit_unavailable"
    assert await closed(ws) == 1000
    assert ic.ma.announced() == [], "Music Assistant was told nothing"
    assert ic.ma.fetches == [] and len(ic.host.links) == 0, "no link was made"
    assert ic.play_rows() == []
    await result_is(ic, ws.audit_id, "error:audit_unavailable")


async def test_an_intercom_command_is_refused_when_the_open_row_cannot_be_written(ic, monkeypatch):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()

    def record(*args, **kw):
        raise sqlite3.OperationalError("database or disk is full")
    monkeypatch.setattr(ic.app["audit"], "record", record)
    reply = await avery.ticket(hub)
    assert reply["error"]["code"] == "audit_unavailable" and "result" not in reply
    assert ic.relay.tickets == {}


# --------------------------------------------------------------------------- one broadcast at a time
async def test_a_second_sender_is_told_who_is_announcing_and_may_try_again(ic):
    ic.ma.delay = 0.6                                          # the first clip is still "playing"
    avery = await ic.actor("avery", "owner")
    jordan = await ic.actor("jordan", "adult")
    a, b = await avery.talk(), await jordan.talk()
    await send_audio(a, chunks(10))
    await a.send_json(SEND)
    assert (await recv_until(a, "sending"))[-1]["rooms"] == 1
    await send_audio(b, chunks(10, seed=9))
    await b.send_json({"type": "send", "rooms": [DEN]})
    got = await recv_until(b, "busy")
    assert got[-1] == {"type": "busy", "name": "Avery"}        # nothing was sent for them
    assert [c["args"]["player_id"] for c in ic.ma.announced()] == ["ma-kitchen"]
    assert ic.play_rows()[0]["actor"] == avery.uid and len(ic.play_rows()) == 1
    assert (await recv_until(a, "sent"))[-1]["rooms"] == 1
    assert await closed(a) == 1000
    assert await until(lambda: ic.relay.floor is None)
    await b.send_json({"type": "send", "rooms": [DEN]})        # the draft stayed: the floor is free now
    assert (await recv_until(b, "sent"))[-1]["rooms"] == 1
    assert [c["args"]["player_id"] for c in ic.ma.announced()] == ["ma-kitchen", "ma-den"]
    await result_is(ic, b.audit_id, "ok")


async def test_the_floor_is_held_until_the_clip_has_played_even_if_the_page_leaves(ic):
    ic.ma.delay = 0.8                                          # the clip is still "playing" in the rooms
    avery = await ic.actor("avery", "owner")
    a = await avery.talk()
    await send_audio(a, chunks(10))
    await a.send_json(SEND)
    await recv_until(a, "sending")
    held = session_of(ic)
    assert ic.relay.floor is held
    closing = asyncio.ensure_future(a.close())                 # the page goes away mid-broadcast (its close waits for
    await asyncio.sleep(0.2)                                   # the server to read it, which is after the clip)
    assert ic.relay.floor is held, "the speakers are still playing: nobody else may start"
    assert await until(lambda: ic.relay.floor is None and ic.relay.sessions == set())
    await closing
    assert len(ic.host.links) == 0 and ic.play_rows()[0]["result"] == "ok"


# ---------------------------------------------------------------------------------------------- limits
async def test_the_draft_is_capped_at_the_modes_limit(ic):
    ic.edit(max_message_s=12)
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    assert ws.ok["max_s"] == 12
    await send_audio(ws, chunks(1))
    assert await until(lambda: session_of(ic).spool is not None)
    assert session_of(ic).spool.cap == RATE * 2 * 12            # the limit is the spool's byte cap


async def test_the_draft_stops_at_its_cap_the_page_hears_full_once_and_the_rest_is_dropped(ic, monkeypatch):
    from mantel_server.intercom.spool import Spool
    monkeypatch.setattr(ic.host, "new_spool", lambda rate, limit: Spool(rate, 0.5))   # 0.5 s stands in for the limit
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    parts = chunks(22)                                          # 0.88 s: more than the cap, less than one burst
    await send_audio(ws, parts)
    assert (await recv(ws)) == {"type": "full"}
    await ws.send_bytes(b"\x01" + parts[0])                     # more after full: dropped, not told again
    await ws.send_json({"type": "send", "rooms": [KITCHEN]})
    events = await recv_until(ws, "sent")
    assert "full" not in [e["type"] for e in events]            # (the one `full` was read above)
    (fetch,) = ic.ma.fetches
    kept = b"".join(parts)[:RATE]                               # 0.5 s of 16-bit mono
    assert fetch["body"] == wav_header(RATE, len(kept)) + kept


async def test_a_draft_idle_too_long_is_dropped_at_the_tick(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    assert await until(lambda: session_of(ic).spool is not None and session_of(ic).spool.nbytes > 0)
    s = session_of(ic)
    spool = s.spool
    ic.relay.draft_idle = 0.1                                   # the socket is already waiting its five minutes
    await asyncio.sleep(0.25)
    await tick_once(ic.app, ic.hub)
    assert await closed(ws) == 1000
    assert spool.dropped and spool.nbytes == 0
    await result_is(ic, ws.audit_id, "ok:discarded")
    assert ic.ma.announced() == []


async def test_a_socket_with_nothing_recorded_is_let_go_after_the_idle_wait(ic):
    avery = await ic.actor("avery", "owner")
    ic.relay.draft_idle = 0.2
    ws = await avery.talk()
    assert await closed(ws) == 1000
    await result_is(ic, ws.audit_id, "ok:discarded")


async def test_a_short_clip_is_too_short_and_the_draft_stays(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await ws.send_json(SEND)                                    # nothing recorded at all
    assert await recv(ws) == {"type": "error", "code": "too_short", "message": "Nothing was recorded"}
    await send_audio(ws, chunks(2))                             # 80 ms: a slip of the finger
    await ws.send_json(SEND)
    assert (await recv(ws))["code"] == "too_short"
    assert ic.ma.announced() == [] and ic.play_rows() == [] and not ws.closed
    await send_audio(ws, chunks(8))                             # now 400 ms
    await ws.send_json(SEND)
    assert (await recv_until(ws, "sent"))[-1]["rooms"] == 1


async def test_the_eleventh_broadcast_in_ten_minutes_is_refused(ic):
    avery = await ic.actor("avery", "owner")
    hub = await avery.hub()
    for i in range(RL.RATE_MAX):
        ws = await avery.talk(hub=hub)
        _, events = await sent_clip(ic, ws, parts=chunks(8, seed=i))
        assert events[-1]["type"] == "sent"
        assert await closed(ws) == 1000
    assert len(ic.ma.announced()) == 10
    ws = await avery.talk(hub=hub)
    await send_audio(ws, chunks(8))
    await ws.send_json(SEND)
    msg = (await recv_until(ws, "error"))[-1]
    assert msg["code"] == "rate" and not ws.closed             # the draft stays; nothing was sent
    assert len(ic.ma.announced()) == 10 and len(ic.play_rows()) == 10
    jordan = await ic.actor("jordan", "adult")                  # another person is not held back
    other = await jordan.talk()
    _, events = await sent_clip(ic, other)
    assert events[-1]["type"] == "sent"
    q = ic.relay.sent[("user", avery.uid)]
    for _ in range(len(q)):                                     # ten minutes later the window has moved on
        q.append(q.popleft() - RL.RATE_WINDOW - 1)
    await ws.send_json(SEND)
    assert (await recv_until(ws, "sent"))[-1]["rooms"] == 1


# ------------------------------------------------------------------ rooms, quiet hours, why nothing was left
async def test_when_every_room_is_skipped_the_page_hears_why_and_nothing_is_sent(ic):
    ic.edit(quiet_default={"schedule": True, "from": "00:00", "to": "00:00", "while": []})   # from == to: all day
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": [KITCHEN, DEN]})
    rooms = await recv(ws)
    assert [(r["room"], r["state"], r["why"]) for r in rooms["rooms"]] == [(KITCHEN, "skipped", "quiet"),
                                                                           (DEN, "skipped", "quiet")]
    err = await recv(ws)
    assert err == {"type": "error", "code": "no_rooms",
                   "message": "Nothing to send to: Kitchen: quiet hours; Den: quiet hours"}
    assert ic.ma.announced() == [] and ic.play_rows() == [] and not ws.closed
    # Send Anyway (an Owner, Admin or Adult): the same pick plays, and the row says it was overridden
    await ws.send_json({"type": "send", "rooms": [KITCHEN, DEN], "override": True})
    events = await recv_until(ws, "sent")
    assert events[-1]["rooms"] == 2
    assert await until(lambda: ic.play_rows()[0]["result"] == "ok")
    assert ic.play_rows()[0]["reason"] == "mode:message rooms:2 send_anyway"


async def test_a_wall_tablet_may_not_press_send_anyway(ic):
    ic.edit(quiet_default={"schedule": True, "from": "00:00", "to": "00:00", "while": []})
    tablet = await ic.tablet()
    ws = await tablet.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": [KITCHEN], "override": True})
    rooms = await recv(ws)
    assert rooms["can_override"] is False and rooms["rooms"][0]["why"] == "quiet"
    assert (await recv(ws))["code"] == "no_rooms" and ic.ma.announced() == []


async def test_a_room_left_out_of_the_settings_is_never_reached(ic):
    ic.edit(rooms={**ic.doc()["rooms"], DEN: {**ic.doc()["rooms"][DEN], "enabled": False}})
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    _, events = await sent_clip(ic, ws, rooms=[KITCHEN, DEN, "media_player.garage_ma", "light.kitchen"])
    assert [r["room"] for r in events[0]["rooms"]] == [KITCHEN]
    assert [c["args"]["player_id"] for c in ic.ma.announced()] == ["ma-kitchen"]


async def test_nothing_picked_is_no_rooms(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": []})
    assert (await recv(ws)) == {"type": "rooms", "rooms": [], "can_override": True}
    assert (await recv(ws)) == {"type": "error", "code": "no_rooms", "message": "Nothing to send to: pick a room."}


async def test_the_group_trap_a_leader_is_skipped_unless_its_whole_group_is_in(ic):
    """2026-11-02: a bedtime message to a sync group's leader played in every room. On the FAKE Music Assistant only:
    the Kitchen leads the Den; announcing to the Kitchen alone would play in the Den too, so it is skipped and Music
    Assistant is told nothing; with both picked there is ONE call, to the leader, and the Den gets none of its own."""
    await ic.ma.set(KITCHEN, group_members=[KITCHEN, DEN])
    await IF.wait_for(lambda: DEN in (ic.hub.store.states[KITCHEN]["a"].get("group_members") or []))
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": [KITCHEN]})
    rooms = await recv(ws)
    assert rooms["rooms"][0]["state"] == "skipped" and rooms["rooms"][0]["why"] == "leads"
    err = await recv(ws)
    assert err["code"] == "no_rooms" and err["message"] == "Nothing to send to: Kitchen leads Den; skipped"
    assert ic.ma.announced() == [] and ic.play_rows() == []
    await ws.send_json({"type": "send", "rooms": [KITCHEN, DEN]})        # the whole group: it is one call
    events = await recv_until(ws, "sent")
    assert [r["state"] for r in events[0]["rooms"]] == ["ok", "ok"]
    assert [c["args"]["player_id"] for c in ic.ma.announced()] == ["ma-kitchen"]
    assert ic.play_rows()[0]["target"] == f'["{KITCHEN}", "{DEN}"]'


async def test_a_member_of_a_group_is_announced_to_alone(ic):
    await ic.ma.set(KITCHEN, group_members=[KITCHEN, DEN])
    await IF.wait_for(lambda: DEN in (ic.hub.store.states[KITCHEN]["a"].get("group_members") or []))
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    _, events = await sent_clip(ic, ws, rooms=[DEN])
    assert events[0]["rooms"][0]["state"] == "ok"
    assert [c["args"]["player_id"] for c in ic.ma.announced()] == ["ma-den"]


# ---------------------------------------------------------------- Cancel, Re-record and a dropped socket
async def test_cancel_and_re_record_drop_the_draft(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    first = await send_audio(ws, chunks(10, seed=3))
    assert await until(lambda: session_of(ic).spool is not None and session_of(ic).spool.nbytes == len(first))
    spool = session_of(ic).spool
    await ws.send_json({"type": "cancel"})                      # Re-record: the old audio is gone
    assert await recv(ws) == {"type": "cancelled"}
    assert spool.dropped and spool.nbytes == 0 and session_of(ic).spool is None
    await ws.send_json({"type": "cancel"})                      # a second Cancel is harmless
    assert await recv(ws) == {"type": "cancelled"}
    second = await send_audio(ws, chunks(10, seed=5))
    await ws.send_json(SEND)
    await recv_until(ws, "sent")
    (fetch,) = ic.ma.fetches
    assert fetch["body"][44:] == second and first not in fetch["body"]
    # Cancel after the draft is full resets "full" too
    ws2 = await avery.talk()
    await ws2.send_json({"type": "send", "rooms": [KITCHEN]})   # nothing recorded after a cancel: too_short
    assert (await recv(ws2))["code"] == "too_short"


async def test_cancel_with_nothing_recorded_and_a_cancelled_draft_cannot_be_sent(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "cancel"})
    assert (await recv(ws))["type"] == "cancelled"
    await ws.send_json(SEND)
    assert (await recv(ws))["code"] == "too_short"
    assert ic.ma.announced() == [] and ic.play_rows() == []


async def test_a_dropped_socket_drops_the_draft_and_the_row_says_discarded(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    assert await until(lambda: session_of(ic).spool is not None and session_of(ic).spool.nbytes > 0)
    spool = session_of(ic).spool
    await ws.close()                                             # the page goes away without sending
    assert await until(lambda: ic.relay.sessions == set())
    assert spool.dropped and spool.nbytes == 0
    await result_is(ic, ws.audit_id, "ok:discarded")
    assert ic.ma.announced() == [] and ic.play_rows() == [] and len(ic.host.links) == 0


# ----------------------------------------------------------- revocation, a role change, commands off
def session_id(env, uid):
    return env.app["store"].db.execute("SELECT id FROM sessions WHERE user_id = ? ORDER BY created DESC",
                                       (uid,)).fetchone()[0]


async def test_a_revoked_session_ends_the_socket_at_once_and_drops_the_draft(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    assert await until(lambda: session_of(ic).spool is not None and session_of(ic).spool.nbytes > 0)
    spool = session_of(ic).spool
    ic.app["sessions"].revoke(session_id(ic, avery.uid), "test", ic.now[0])      # live.py's revoke: no tick needed
    assert await closed(ws) == 1008
    assert spool.dropped
    await result_is(ic, ws.audit_id, "error:unauthenticated")
    assert ic.ma.announced() == []


async def test_a_revoked_tablet_ends_the_socket(ic):
    tablet = await ic.tablet()
    ws = await tablet.talk()
    ic.app["devices"].revoke(tablet.device_id, "test")
    assert await closed(ws) == 1008
    await result_is(ic, ws.audit_id, "error:unauthenticated")


async def test_turning_house_commands_off_ends_the_socket_and_closes_the_listener(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    assert ic.host.listener is not None and ic.host.listener.running
    await apply_commands(ic.app, ic.hub, False)
    assert await closed(ws) == 1008
    await result_is(ic, ws.audit_id, "refused:commands_disabled")
    assert ic.host.listener is None and ic.ma.announced() == []
    with pytest.raises(aiohttp.WSServerHandshakeError) as exc:       # and the socket is not offered while they are off
        await avery.http.ws_connect("/ws/intercom")
    assert exc.value.status == 403


async def test_a_role_change_ends_the_socket(ic):
    avery = await ic.actor("avery", "owner")
    jordan = await ic.actor("jordan", "adult")
    ws = await jordan.talk()
    await send_audio(ws, chunks(10))
    status, body = await avery.call("PATCH", f"/api/users/{jordan.uid}", {"role": "child"})
    assert status == 200, body
    assert await closed(ws) == 1008                              # a Child has no Intercom
    await result_is(ic, ws.audit_id, "refused:not_allowed")
    assert ic.ma.announced() == []


async def test_a_deny_grant_ends_the_socket_at_the_policy_tick(ic):
    from mantel_server.rbac import Grant
    jordan = await ic.actor("jordan", "adult")
    ws = await jordan.talk()
    ic.app["rbac"].add_grant(Grant(effect="deny", actions=("control",), resource_kind="feature", resource="intercom",
                                   users={jordan.uid}))
    await tick_once(ic.app, ic.hub)
    assert await closed(ws) == 1008
    await result_is(ic, ws.audit_id, "refused:not_allowed")


async def test_the_intercom_turned_off_while_a_draft_is_open_is_said_at_send(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    ic.edit(enabled=False)
    await ws.send_json(SEND)
    assert (await recv(ws)) == {"type": "error", "code": "intercom_off"}
    assert await closed(ws) == 1000
    await result_is(ic, ws.audit_id, "error:intercom_off")
    assert ic.ma.announced() == []


async def test_a_stopped_listener_is_said_at_send_and_nothing_is_announced(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    await ic.host.listener.stop()
    await ws.send_json(SEND)
    assert (await recv(ws))["code"] == "intercom_not_listening"
    assert ic.ma.announced() == []


async def test_a_server_that_is_stopping_ends_every_socket(ic):
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    await ic.relay.close()
    assert await closed(ws) == 1008
    await result_is(ic, ws.audit_id, "error:server_stopping")


# --------------------------------------------------------------------------- IntercomRun, the gate
URL = "http://127.0.0.1:1/s/abc.wav"


def run_of(open_=True, **kw):
    r = D.IntercomRun(kw.get("principal", object()), 7 if open_ else 0, kw.get("players", {"ma-kitchen", "ma-den"}),
                      kw.get("urls", [URL]))
    return r


GOOD = {"player_id": "ma-kitchen", "url": URL, "pre_announce": True, "volume_level": 40}


def test_intercom_run_allows_only_play_announcement_on_its_players_with_its_url():
    run = run_of()
    assert run.allow(ANNOUNCE, GOOD) is True and run.allow(ANNOUNCE, {k: v for k, v in GOOD.items()
                                                                       if k != "volume_level"}) is True
    assert run.allow(ANNOUNCE, {"player_id": "ma-den", "url": URL}) is True
    assert run.sent == ["ma-kitchen", "ma-kitchen", "ma-den"]
    refused = [
        ("players/cmd/play_media", GOOD), ("players/cmd/volume_set", {"player_id": "ma-kitchen", "volume_level": 5}),
        ("player_queues/play_media", GOOD), ("players/cmd/power", {"player_id": "ma-kitchen", "powered": False}),
        (ANNOUNCE, {**GOOD, "player_id": "ma-cody"}),                    # a player not in this broadcast
        (ANNOUNCE, {**GOOD, "player_id": None}), (ANNOUNCE, {k: v for k, v in GOOD.items() if k != "player_id"}),
        (ANNOUNCE, {**GOOD, "url": "http://127.0.0.1:1/s/other.wav"}),   # another link
        (ANNOUNCE, {**GOOD, "url": "https://evil.example/a.wav"}), (ANNOUNCE, {k: v for k, v in GOOD.items() if k != "url"}),
        (ANNOUNCE, {**GOOD, "extra": 1}), (ANNOUNCE, {**GOOD, "announce_volume": 5}),
        (ANNOUNCE, {**GOOD, "pre_announce": "yes"}), (ANNOUNCE, {**GOOD, "pre_announce": 1}),
        (ANNOUNCE, {**GOOD, "volume_level": 101}), (ANNOUNCE, {**GOOD, "volume_level": -1}),
        (ANNOUNCE, {**GOOD, "volume_level": 40.5}), (ANNOUNCE, {**GOOD, "volume_level": True}),
        (ANNOUNCE, {**GOOD, "volume_level": "40"}), ("", GOOD), (None, GOOD)]
    sent_before = list(run.sent)
    for command, args in refused:
        assert run.allow(command, args) is False, (command, args)
    assert run.sent == sent_before, "a refused call leaves no trace"


def test_intercom_run_is_closed_before_its_row_and_after_the_broadcast():
    assert run_of(open_=False).allow(ANNOUNCE, GOOD) is False        # no audit row (id 0): nothing is allowed
    run = run_of()
    run.close()
    assert run.allow(ANNOUNCE, GOOD) is False


def test_intercom_run_takes_a_second_link_for_the_fallback_only_when_added():
    run = run_of()
    second = "http://127.0.0.1:1/s/second.wav"
    assert run.allow(ANNOUNCE, {**GOOD, "url": second}) is False
    run.add_url(second)
    assert run.allow(ANNOUNCE, {**GOOD, "url": second}) is True and run.allow(ANNOUNCE, GOOD) is True


async def test_the_gateway_admits_an_intercom_run_and_nothing_else_by_the_same_name(ic):
    gate = ic.app["gateway"]
    run = run_of()
    assert gate.allow(run, ANNOUNCE, dict(GOOD)) is True
    assert gate.allow(run, "players/cmd/play_media", dict(GOOD)) is False
    assert gate.allow(run, ANNOUNCE, {**GOOD, "player_id": "ma-cody"}) is False
    run.close()
    assert gate.allow(run, ANNOUNCE, dict(GOOD)) is False
    assert gate.allow(object(), ANNOUNCE, dict(GOOD)) is False       # a person, a page, anyone else: no ticket, no


async def test_music_assistant_is_never_told_what_the_gate_refuses(ic):
    ma = ic.app["ma"]
    before = len(ic.ma.frames)
    run = run_of(urls=[f"{ic.base}/s/x.wav"], players={"ma-den"})
    for args in ({"player_id": "ma-den", "url": "https://evil.example/a.wav", "pre_announce": True},     # another URL
                 {"player_id": "ma-kitchen", "url": f"{ic.base}/s/x.wav", "pre_announce": True},          # another player
                 {"player_id": "ma-den", "url": f"{ic.base}/s/x.wav", "pre_announce": True, "x": 1}):      # another arg
        with pytest.raises(CommandRefused):
            await ma.command(run, ANNOUNCE, **args)
    with pytest.raises(CommandRefused):
        await ma.command(object(), ANNOUNCE, player_id="ma-den", url=f"{ic.base}/s/x.wav")
    assert len(ic.ma.frames) == before and ic.ma.announced() == []


# ----------------------------------------------------------------------- the per-call timeout
async def test_the_per_call_timeout_reaches_the_music_assistant_client(ic):
    ma = ic.app["ma"]
    ma.request_timeout = 0.3                                    # every ordinary call waits this long for its answer
    ic.ma.fetch = False
    ic.ma.delay = 0.8                                           # an announcement answers when the clip has played
    run = run_of(urls=[URL], players={"ma-den"})
    args = {"player_id": "ma-den", "url": URL, "pre_announce": False}
    with pytest.raises(asyncio.TimeoutError):
        await ma.command(run, ANNOUNCE, **args)                  # no timeout of its own: the default 0.3 s
    assert await ma.command(run, ANNOUNCE, timeout=5, **args) is None   # its own wait is longer than the default
    with pytest.raises(asyncio.TimeoutError):
        await ma.command(run, ANNOUNCE, timeout=0.2, **args)     # and a shorter one is honored too


async def test_a_broadcast_waits_for_the_clip_to_play_for_the_modes_limit_plus_ninety_seconds(ic, monkeypatch):
    ma = ic.app["ma"]
    ma.request_timeout = 0.3
    ic.ma.delay = 0.8                                           # longer than the ordinary wait, as a real clip is
    asked = []
    real = ma.command

    async def spy(identity, command, **kw):
        asked.append(kw.get("timeout"))
        return await real(identity, command, **kw)
    monkeypatch.setattr(ma, "command", spy)
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk()
    _, events = await sent_clip(ic, ws)
    assert events[-1] == {"type": "sent", "rooms": 1, "failed": []}      # not timed out at 0.3 s
    assert asked == [30 + D.CALL_GRACE] and D.CALL_GRACE == 90
    await result_is(ic, ws.audit_id, "ok")
