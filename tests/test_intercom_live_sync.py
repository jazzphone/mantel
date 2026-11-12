"""LIVE'S ROOMS IN STEP (docs/phase17/INTERCOM-SYNC.md part C; intercom/host.py ``_live_calls``, driver.py ``settle``), over a
full app and the scripted Music Assistant of tests/test_intercom_fallback.py taught to group. Nothing is played anywhere.

The rules pinned here: the rooms live now join first, the leader is called once and every room is watched; the group parts
only when the talk is over; a group that doesn't come together means one live call per room on the same link; a failed
leader sends every room the whole spool, and only the leader's Live health counts it; a member that never plays gets the
Message alone; a stopped talk's speakers go back without holding up the socket, and the next broadcast is decided after
they have; the rooms that hear the Message at the end play in step too.
"""
from __future__ import annotations

import asyncio

import pytest

import intercom_fakes as IF
import music_fakes as MF
from intercom_fakes import ANNOUNCE, CODY, DEN, JOIN, KITCHEN, PART, RATE, chunks, closed, recv_until, send_audio, until
from mantel_server.intercom import driver as D
from mantel_server.intercom.spool import streaming_wav_header
from test_intercom_fallback import (begin, finish, fixture, live_announced, message_announced, message_bodies, of_type,
                                    play_result, whole)

lv = fixture()
K, DN, CY = MF.PID[KITCHEN], MF.PID[DEN], MF.PID[CODY]


def grouping(env) -> None:
    env.ma.groups = True
    speakers = [p for p, v in env.ma.model.items() if v.get("type") == "player"]
    for p in speakers:
        env.ma.model[p]["can_group_with"] = [o for o in speakers if o != p]


def steps(env) -> list[str]:
    want = {JOIN: "join", PART: "part", ANNOUNCE: "say"}
    return [want[f["command"]] for f in env.ma.frames if f.get("command") in want]


def apart(env, *players) -> bool:
    return all(not env.ma.model[p].get("synced_to") and len(env.ma.model[p].get("group_members") or []) <= 1 for p in players)


def leader_of(env) -> str:
    return next(f["args"]["target_player"] for f in env.ma.frames if f.get("command") == JOIN)


@pytest.fixture(autouse=True)
def many_live_rooms(monkeypatch):
    """These are Live's paths for several rooms at once (one plan, its fallbacks, its group). The house's Live goes to one
    room (C.LIVE_ROOMS, 2026-11-11); the code for more stays tested for the day that changes."""
    from hk_core.intercom import config as C
    monkeypatch.setattr(C, "LIVE_ROOMS", 64)


@pytest.fixture
async def avery(lv):
    grouping(lv)
    return await lv.actor("avery", "owner")


async def called(env, n: int = 1) -> None:
    assert await until(lambda: len(env.ma.announcements) >= n)


# ---------------------------------------------------------------------------------------------- it plays as one
async def test_the_rooms_join_the_leader_is_called_once_and_they_part_when_the_talk_is_over(lv, avery):
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN])
    assert started[-1]["live"] == 2
    pcm = await send_audio(ws, chunks(10))
    await called(lv)
    assert steps(lv) == ["join", "say"], "no part while the talker is talking"
    assert await until(lambda: lv.host._playing(KITCHEN) and lv.host._playing(DEN))
    events = await finish(lv, ws)
    assert steps(lv) == ["join", "say", "part"] and apart(lv, K, DN)
    assert live_announced(lv, url) == [leader_of(lv)]
    (fetch,) = lv.ma.fetches
    assert fetch["body"] == streaming_wav_header(RATE) + pcm
    assert of_type(events, "fallback") == [] and events[-1] == {"type": "sent", "rooms": 2, "failed": [], "fallback": []}
    await play_result(lv, "ok")


async def test_every_room_is_left_out_of_the_music_players_until_it_is_over(lv, avery):
    ws, _, _ = await begin(lv, avery, [KITCHEN, DEN])
    tracker = lv.host.music.announcements
    assert set(tracker.intercom_players()) >= {KITCHEN, DEN}
    await send_audio(ws, chunks(4))
    await called(lv)
    await finish(lv, ws)
    assert await until(lambda: tracker.intercom_players() == [], timeout=5)


async def test_a_room_at_another_volume_keeps_its_own_live_call(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN, CODY])     # Cody's Room's volume is the fixture's 70, the others' 40
    await send_audio(ws, chunks(4))
    await called(lv, 2)
    events = await finish(lv, ws)
    assert sorted(live_announced(lv, url)) == sorted([leader_of(lv), CY]) and events[-1]["rooms"] == 3
    assert of_type(events, "fallback") == []


# ------------------------------------------------------------------------------------- a group left from music
def left_grouped(env) -> None:
    """All of it idle, as music leaves it (2026-11-05: the whole house under the Master Bedroom)."""
    env.ma.model[K]["group_members"] = [K, DN]
    env.ma.model[DN]["synced_to"] = K


async def test_an_idle_group_left_from_music_plays_live_through_its_leader_and_stays_grouped(lv, avery):
    left_grouped(lv)
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN])
    assert started[-1]["live"] == 2 and started[-1]["after"] == []
    pcm = await send_audio(ws, chunks(6))
    await called(lv)
    assert await until(lambda: lv.host._playing(KITCHEN) and lv.host._playing(DEN))
    events = await finish(lv, ws)
    assert steps(lv) == ["say"] and live_announced(lv, url) == [K], "no join, no part: it's the house's group"
    assert lv.ma.fetches[0]["body"] == streaming_wav_header(RATE) + pcm
    assert of_type(events, "fallback") == [] and events[-1]["failed"] == []
    assert lv.ma.model[K]["group_members"] == [K, DN] and lv.ma.model[DN]["synced_to"] == K
    await play_result(lv, "ok")


async def test_a_group_that_plays_after_you_finish_isnt_lost_to_the_second_group_check(lv, avery):
    """On the house, 2026-11-05: the check at the end was given only the leader's room, so its members looked like
    outsiders, the room was left out, and Live ended in nothing played."""
    left_grouped(lv)
    doc = lv.doc()
    doc["rooms"][DEN]["live"] = False
    lv.app["settings"].store.write([("house", "intercom", doc)], actor=IF.SettingsActor(label="test"))
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN])
    assert started[-1]["live"] == 0
    pcm = await send_audio(ws, chunks(6))
    events = await finish(lv, ws)
    assert [a["player_id"] for a in message_announced(lv, url)] == [K]
    assert message_bodies(lv, url) == [whole(pcm)] and events[-1]["failed"] == []
    await play_result(lv, "ok")


async def test_a_leader_that_fails_live_gets_the_message_with_its_whole_group(lv, avery):
    left_grouped(lv)
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "noplay"})
    pcm = await send_audio(ws, chunks(6))
    await called(lv)
    await finish(lv, ws)
    assert [a["player_id"] for a in message_announced(lv, url)] == [K]
    assert message_bodies(lv, url) == [whole(pcm)]
    await play_result(lv, "ok:fallback")


# ------------------------------------------------------------------------------------------------- the fallbacks
@pytest.mark.parametrize("script", ["never", "error"])
async def test_a_group_that_is_not_the_plans_means_one_live_call_per_room_on_the_same_link(lv, avery, monkeypatch, script):
    monkeypatch.setattr(D, "GROUP_WAIT", 0.2)
    lv.ma.join_script = script
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN])
    pcm = await send_audio(ws, chunks(6))
    await called(lv, 2)
    assert sorted(live_announced(lv, url)) == sorted([K, DN])
    assert steps(lv)[:2] == ["join", "part"]
    events = await finish(lv, ws)
    assert of_type(events, "fallback") == [] and events[-1]["rooms"] == 2 and message_bodies(lv, url) == []
    assert lv.ma.fetches[0]["body"] == streaming_wav_header(RATE) + pcm


async def test_a_leader_somebody_else_follows_gets_no_call_and_the_group_check_decides_it_at_the_end(lv, avery, monkeypatch):
    monkeypatch.setattr(D, "GROUP_WAIT", 0.1)
    lv.ma.join_script = "extra"                 # a speaker outside the broadcast follows the leader
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN])
    pcm = await send_audio(ws, chunks(6))
    await called(lv)
    leader = leader_of(lv)
    member = DN if leader == K else K
    assert live_announced(lv, url) == [member], "nothing reaches the speaker outside it"
    events = await finish(lv, ws)
    assert leader not in [a["player_id"] for a in lv.ma.announcements], "the group check skips it: it leads someone"
    assert message_bodies(lv, url) == [] and events[-1]["rooms"] == 1 and len(pcm) > 0
    await play_result(lv, "ok:fallback")


async def test_a_leader_that_fails_sends_every_room_the_message_and_counts_only_against_itself(lv, avery):
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "noplay", DEN: "noplay"})
    pcm = await send_audio(ws, chunks(6))
    await called(lv)
    events = await finish(lv, ws)
    (fb,) = of_type(events, "fallback")
    assert sorted(fb["rooms"]) == ["Den", "Kitchen"]
    leader = leader_of(lv)
    assert live_announced(lv, url) == [leader]
    assert steps(lv)[:3] == ["join", "say", "part"], "the group parted before the Message"
    assert [a["player_id"] for a in message_announced(lv, url)] == [leader], "the Message plays in step too"
    assert message_bodies(lv, url) == [whole(pcm)] and apart(lv, K, DN)
    await play_result(lv, "ok:fallback")
    rooms = lv.doc()["rooms"]
    other = KITCHEN if leader != K else DEN
    assert rooms[MF.ENT[leader]]["live_fails"] == 1 and rooms[other]["live_fails"] == 0


async def test_a_member_that_never_plays_gets_the_message_alone(lv, avery):
    lv.ma.silent = {DN}
    real = lv.ma.answer

    async def den_follows(ws, mid, cmd, args):         # whichever the leader, Den is the member here
        if cmd == JOIN and args["target_player"] != K:
            lv.ma.silent = {K}
        await real(ws, mid, cmd, args)
    lv.ma.answer = den_follows
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN])
    pcm = await send_audio(ws, chunks(6))
    await called(lv)
    events = await finish(lv, ws)
    (silent,) = lv.ma.silent
    assert of_type(events, "fallback") == [{"type": "fallback", "rooms": [{K: "Kitchen", DN: "Den"}[silent]]}]
    assert [a["player_id"] for a in message_announced(lv, url)] == [silent]
    assert message_bodies(lv, url) == [whole(pcm)] and live_announced(lv, url) == [leader_of(lv)]
    await play_result(lv, "ok:fallback")


async def test_the_rooms_that_hear_the_message_at_the_end_play_in_step(lv, avery):
    doc = lv.doc()
    doc["rooms"][KITCHEN]["live"] = doc["rooms"][DEN]["live"] = False
    lv.app["settings"].store.write([("house", "intercom", doc)], actor=IF.SettingsActor(label="test"))
    ws, started, url = await begin(lv, avery, [KITCHEN, DEN])
    assert started[-1]["live"] == 0 and sorted(started[-1]["after"]) == ["Den", "Kitchen"]
    pcm = await send_audio(ws, chunks(6))
    events = await finish(lv, ws)
    assert steps(lv) == ["join", "say", "part"] and len(lv.ma.announcements) == 1 and apart(lv, K, DN)
    assert message_bodies(lv, url) == [whole(pcm)] and events[-1]["rooms"] == 2
    await play_result(lv, "ok")


# --------------------------------------------------------------------------------------------- a talk that stops
@pytest.mark.parametrize("how", ["drop", "cancel"])
async def test_a_stopped_talk_goes_back_without_holding_up_the_socket(lv, avery, how):
    lv.ma.part_held = asyncio.Event()
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN])
    await send_audio(ws, chunks(4))
    await called(lv)
    if how == "drop":
        await ws.close()
    else:
        await ws.send_json({"type": "cancel"})
        assert await closed(ws) == 1000
    assert await until(lambda: lv.relay.sessions == set() and lv.relay.floor is None)
    assert await play_result(lv) == ("error:client_gone" if how == "drop" else "error:cancelled")
    assert await until(lambda: "part" in steps(lv)), "a closed run still lets its own group part"
    lv.ma.part_held.set()
    assert await until(lambda: apart(lv, K, DN) and not lv.host._parting, timeout=5)
    assert lv.doc()["rooms"][KITCHEN]["live_fails"] == 0 and lv.doc()["rooms"][DEN]["live_fails"] == 0


async def test_the_pages_own_copy_is_decided_after_the_speakers_are_back(lv, avery):
    lv.ma.part_held = asyncio.Event()
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN])
    await send_audio(ws, chunks(4))
    await called(lv)
    await ws.close()
    assert await until(lambda: lv.relay.floor is None and "part" in steps(lv))
    await lv.ma.quiet_down()
    again = await avery.talk()
    pcm = await send_audio(again, chunks(10))
    await again.send_json({"type": "send", "rooms": [KITCHEN, DEN]})
    await asyncio.sleep(0.2)
    assert len(lv.ma.announcements) == 1 and lv.host._parting, "still waiting for the first group to part"
    lv.ma.part_held.set()
    events = await recv_until(again, "sent", 5)
    assert events[-1]["failed"] == [] and apart(lv, K, DN)
    # every room picked is called or really reached: the Den was let go before the copy was decided, though the house's
    # states still said grouped -- it gets its own call (host._covered, 2026-11-05), never assumed to hear the Kitchen's
    assert sorted(a["player_id"] for a in lv.ma.announcements[1:]) == sorted([K, DN])
    assert message_bodies(lv, url)[-1] == whole(pcm)


async def test_settle_gives_up_on_a_call_that_never_answers_and_still_parts(lv, avery, monkeypatch):
    monkeypatch.setattr(D, "SETTLE_WAIT", 0.05)
    sent = []

    class Ma:
        async def command(self, run, command, timeout=None, **args):
            assert run.allow(command, args)
            sent.append(command)

        async def players(self):
            return [{"player_id": K}, {"player_id": DN}]
    run = D.IntercomRun(None, 1, {K, DN}, ["u"], groups={K: [DN]})
    run.formed.add(K)
    run.close()
    stuck = asyncio.get_running_loop().create_task(asyncio.sleep(30))
    await D.settle(Ma(), run, K, [DN], stuck)
    assert stuck.cancelled() and sent == [PART] and run.formed == set()


def test_a_closed_run_lets_through_only_its_own_groups_part():
    run = D.IntercomRun(None, 1, {K, DN}, ["u"], groups={K: [DN]})
    part = {"target_player": K, "player_ids_to_remove": [DN]}
    join = {"target_player": K, "child_player_ids": [DN]}
    run.formed.add(K)
    run.close()
    assert run.allow(PART, part)
    assert not run.allow(JOIN, join) and not run.allow(ANNOUNCE, {"player_id": K, "url": "u"})
    assert not run.allow(PART, {"target_player": K, "player_ids_to_remove": [CY]}), "no other speaker"
    assert not run.allow(PART, {"target_player": DN, "player_ids_to_remove": [K]}), "no other leader"
    run.formed.clear()
    assert not run.allow(PART, part), "nothing left to part"


async def test_a_group_that_failed_live_stays_out_of_the_music_players_through_its_message(lv, avery):
    """2026-11-05, the owner's photo: Live's group was shown again before its Message, which then skipped it as playing
    (Live's own sound), so the card read "Now Playing" during the message."""
    left_grouped(lv)
    tracker = lv.host.music.announcements
    seen = []
    lv.ma.on_call = lambda args: seen.append(set(tracker.intercom_players()))
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "noplay"})
    await send_audio(ws, chunks(6))
    await called(lv)
    await asyncio.sleep(D.PLAYING_WAIT + 0.3)                # past the watch: it failed live
    await lv.ma.set(KITCHEN, "playing")                      # Live's sound, still going as the talk ends
    await finish(lv, ws)
    assert [a["player_id"] for a in message_announced(lv, url)] == [K]
    assert seen and {KITCHEN, DEN} <= seen[-1]


async def test_the_audit_row_keeps_which_rooms_failed_live_and_why(lv, avery):
    """2026-11-05: why a Live talk was judged failed was only in the log, which starts again at every release."""
    left_grouped(lv)
    ws, _, url = await begin(lv, avery, [KITCHEN, DEN], {KITCHEN: "noplay"})
    await send_audio(ws, chunks(6))
    await called(lv)
    await finish(lv, ws)
    await play_result(lv, "ok:fallback")
    (row,) = lv.play_rows()
    (note,) = [r for r in lv.audit(kind="ma") if r["action"] == "intercom.failures"]
    assert note["reason"].startswith(f"play:{row['id']} ") and f"live_failed:{KITCHEN}=not_playing" in note["reason"], note
    assert note["result"] == "noted" and KITCHEN in note["target"]
