"""THE INTERCOM'S ROOMS IN STEP (docs/phase17/INTERCOM-SYNC.md part B; intercom/driver.py ``in_step``), over a full app
and the fake Music Assistant of tests/intercom_fakes.py taught to group. Nothing is played anywhere.

The rules pinned here: join, settle, one announcement to the leader, part, in that order; a group that isn't exactly the
plan's is never announced to; every failure before any sound (a join that fails or never settles, somebody else in the
group, a dead leader, a stream that never starts) ends in one call per room on a new link, so nothing is lost; a failure
partway isn't said twice; the speakers go back whatever happens, even cancelled; the gate lets through only the plan's
own groups; the music players leave out every member, and show a room again when it has finished.
"""
from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace as NS

import pytest

import intercom_fakes as IF
import music_fakes as MF
from hk_core.intercom import rooms as R
from intercom_fakes import ANNOUNCE, CODY, DEN, JOIN, KITCHEN, PART, RATE, chunks, recv_until, send_audio, until
from mantel_server.connectors.ma import CommandRefused
from mantel_server.intercom import driver as D
from mantel_server.intercom import host as HOST
from mantel_server.intercom.spool import wav_header

ic = IF.fixture(commands=True)
K, DN, CY = MF.PID[KITCHEN], MF.PID[DEN], MF.PID[CODY]


def grouping(env, *, delay: float = 0.3) -> None:
    """The fake groups as Music Assistant does; every speaker can group with every other."""
    env.ma.groups = True
    env.ma.delay = delay
    speakers = [p for p, v in env.ma.model.items() if v.get("type") == "player"]
    for p in speakers:
        env.ma.model[p]["can_group_with"] = [o for o in speakers if o != p]


def steps(env) -> list[str]:
    """What Mantel told Music Assistant, in order."""
    want = {JOIN: "join", PART: "part", ANNOUNCE: "say"}
    return [want[f["command"]] for f in env.ma.frames if f.get("command") in want]


def said_to(env) -> list[str]:
    return [a["player_id"] for a in env.ma.announcements]


def on_their_own(env, *players) -> bool:
    return all(not env.ma.model[p].get("synced_to") and len(env.ma.model[p].get("group_members") or []) <= 1 for p in players)


async def send(env, rooms):
    avery = await env.actor("avery", "owner")
    ws = await avery.talk()
    pcm = await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": list(rooms)})
    return pcm, await recv_until(ws, "sent")


# ---------------------------------------------------------------------------------------------- it plays as one
async def test_join_settle_one_announcement_to_the_leader_part(ic):
    grouping(ic)
    pcm, events = await send(ic, [KITCHEN, DEN])
    assert steps(ic) == ["join", "say", "part"]
    (args,) = ic.ma.announcements
    join = next(f["args"] for f in ic.ma.frames if f.get("command") == JOIN)
    assert args["player_id"] == join["target_player"] and args["volume_level"] == 40
    assert {join["target_player"], *join["child_player_ids"]} == {K, DN}
    assert on_their_own(ic, K, DN)
    assert events[-1] == {"type": "sent", "rooms": 2, "failed": []}
    (fetch,) = ic.ma.fetches
    assert fetch["body"] == wav_header(RATE, len(pcm)) + pcm
    assert await until(lambda: ic.play_rows()[0]["result"] == "ok")


async def test_every_member_is_left_out_of_the_music_players_and_comes_back(ic, monkeypatch):
    monkeypatch.setattr(HOST, "MARK_GRACE", 0.02)
    grouping(ic)
    tracker = ic.host.music.announcements
    at_join = []
    ic.ma.on_call = lambda args: at_join.append(tracker.intercom_players())
    await send(ic, [KITCHEN, DEN])
    assert at_join and set(at_join[0]) >= {KITCHEN, DEN}
    assert await until(lambda: tracker.intercom_players() == [])


async def test_a_room_at_another_volume_or_playing_music_keeps_its_own_call(ic):
    grouping(ic)
    pcm, events = await send(ic, [KITCHEN, DEN, CODY])     # the Cody's Room's volume is the fixture's 70, the others' 40
    assert sorted(steps(ic))[:1] == ["join"] and said_to(ic).count(CY) == 1
    assert len(said_to(ic)) == 2 and events[-1]["rooms"] == 3
    ic.ma.frames.clear()
    ic.ma.announcements.clear()
    ic.ma.model[K]["playback_state"] = "playing"
    await ic.ma._set(KITCHEN, "playing")
    assert await until(lambda: ic.host._playing(KITCHEN))
    await send(ic, [KITCHEN, DEN])
    assert "join" not in steps(ic) and sorted(said_to(ic)) == sorted([K, DN])


async def test_a_room_holding_paused_music_is_left_alone(ic):
    grouping(ic)
    ic.host.music.resumes._held[DEN] = time.monotonic()
    await send(ic, [KITCHEN, DEN])
    assert "join" not in steps(ic) and sorted(said_to(ic)) == sorted([K, DN])


async def test_one_room_makes_no_group(ic):
    grouping(ic)
    await send(ic, [KITCHEN])
    assert steps(ic) == ["say"]


# ------------------------------------------------------------------------------------------------- the fallback
async def test_a_leader_somebody_else_follows_is_not_called_after_a_group_fails(ic, monkeypatch):
    monkeypatch.setattr(D, "GROUP_WAIT", 0.1)
    grouping(ic, delay=0)
    ic.ma.join_script = "extra"                 # a speaker outside the broadcast follows the leader
    _, events = await send(ic, [KITCHEN, DEN])
    join = next(f["args"] for f in ic.ma.frames if f.get("command") == JOIN)
    assert said_to(ic) == join["child_player_ids"], "nothing reaches the speaker outside it"
    assert events[-1]["rooms"] == 1 and len(events[-1]["failed"]) == 1


@pytest.mark.parametrize("script", ["never", "error"])
async def test_a_group_that_is_not_the_plans_is_never_announced_to(ic, monkeypatch, script):
    monkeypatch.setattr(D, "GROUP_WAIT", 0.2)
    grouping(ic, delay=0)
    ic.ma.join_script = script
    pcm, events = await send(ic, [KITCHEN, DEN])
    assert len(ic.ma.announcements) == 2, "only the per-room calls"
    assert await until(lambda: ic.play_rows()[0]["result"] == "ok")
    assert sorted(said_to(ic)) == sorted([K, DN]) and events[-1]["failed"] == []
    assert steps(ic)[:2] == ["join", "part"]
    assert ic.ma.fetches[-1]["body"] == wav_header(RATE, len(pcm)) + pcm


async def test_a_room_that_started_playing_since_the_plan_makes_no_group(ic, monkeypatch):
    grouping(ic, delay=0)
    real = R.decide

    def then_it_plays(*a, **kw):
        plan = real(*a, **kw)
        ic.ma.model[DN]["playback_state"] = "playing"
        return plan
    monkeypatch.setattr(R, "decide", then_it_plays)
    _, events = await send(ic, [KITCHEN, DEN])
    assert steps(ic) == ["say", "say"], "no join was sent, so no part either"
    assert sorted(said_to(ic)) == sorted([K, DN]) and events[-1]["failed"] == []


async def test_a_dead_leader_falls_back_and_only_the_dead_room_fails(ic):
    grouping(ic, delay=0)
    ic.ma.plays = False

    def leader_dead(args):
        join = next(f["args"] for f in ic.ma.frames if f.get("command") == JOIN)
        ic.ma.fail[join["target_player"]] = "the leader is gone"
    ic.ma.on_call = leader_dead
    _, events = await send(ic, [KITCHEN, DEN])
    join = next(f["args"] for f in ic.ma.frames if f.get("command") == JOIN)
    assert said_to(ic)[0] == join["target_player"] and len(ic.ma.announcements) == 3
    assert steps(ic)[:3] == ["join", "say", "part"]
    assert len(events[-1]["failed"]) == 1 and events[-1]["rooms"] == 1
    assert on_their_own(ic, K, DN)


async def test_a_stream_that_never_starts_falls_back(ic, monkeypatch):
    monkeypatch.setattr(D, "START_WAIT", 0.2)
    monkeypatch.setattr(D, "START_POLL", 0.02)
    grouping(ic, delay=0.6)
    ic.ma.plays = False
    _, events = await send(ic, [KITCHEN, DEN])
    assert steps(ic)[:3] == ["join", "say", "part"] and len(ic.ma.announcements) == 3
    assert events[-1]["failed"] == [] and on_their_own(ic, K, DN)


async def test_a_message_that_stops_partway_is_not_said_twice(ic):
    grouping(ic, delay=0.5)

    def fails_late(args):
        ic.ma.fail[args["player_id"]] = "the stream stopped"
    ic.ma.on_call = fails_late
    _, events = await send(ic, [KITCHEN, DEN])
    assert steps(ic) == ["join", "say", "part"]
    assert sorted(events[-1]["failed"]) == ["Den", "Kitchen"] and on_their_own(ic, K, DN)


async def test_a_group_that_will_not_part_says_so_and_the_message_still_went(ic, monkeypatch, caplog):
    monkeypatch.setattr(D, "GROUP_WAIT", 0.1)
    grouping(ic)
    ic.ma.part_script = "never"
    _, events = await send(ic, [KITCHEN, DEN])
    assert events[-1]["failed"] == []
    assert any("could not be parted" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------------------- the speakers go back
class Client:
    """A Music Assistant that only records, for the driver alone."""

    def __init__(self):
        self.model = {p: dict(MF.ma_player(p, "media_player.x")) for p in ("a", "b")}
        self.sent, self.hang = [], asyncio.Event()

    async def players(self):
        return list(self.model.values())

    async def command(self, run, command, *, timeout=None, **args):
        if not run.allow(command, args):
            raise CommandRefused(command)
        self.sent.append(command)
        if command == JOIN:
            self.model["a"]["group_members"] = ["a", "b"]
            self.model["b"]["synced_to"] = "a"
        elif command == PART:
            self.model["a"]["group_members"] = []
            self.model["b"]["synced_to"] = None
        elif command == ANNOUNCE:
            await self.hang.wait()


async def test_cancelled_while_it_plays_the_speakers_still_go_back():
    ma = Client()
    calls = [R.Call("e.a", "a", 40), R.Call("e.b", "b", 40)]
    pids = {"e.a": "a", "e.b": "b"}
    run = D.IntercomRun(None, 1, {"a", "b"}, ["http://x/s.wav"], groups={"a": ["b"]})
    task = asyncio.create_task(D.in_step(ma, run, R.SyncSet(calls[0], calls[1:]), pids, "http://x/s.wav",
                                         new_url=lambda: "", chime=False, timeout=5, names=str))
    assert await until(lambda: ANNOUNCE in ma.sent)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert ma.sent == [JOIN, ANNOUNCE, PART]
    assert not ma.model["b"]["synced_to"] and not ma.model["a"]["group_members"]


# ----------------------------------------------------------------------------------------------------- the gate
URL = "http://x/s.wav"


def gate():
    return D.IntercomRun(NS(), 1, {"a", "b", "c"}, [URL], groups={"a": ["b"]})


@pytest.mark.parametrize("command,args,want", [
    (JOIN, {"target_player": "a", "child_player_ids": ["b"]}, True),
    (JOIN, {"target_player": "b", "child_player_ids": ["a"]}, False),      # not the plan's leader
    (JOIN, {"target_player": "a", "child_player_ids": ["b", "c"]}, False),  # a room outside the group
    (JOIN, {"target_player": "a", "child_player_ids": []}, False),
    (JOIN, {"target_player": "a", "child_player_ids": "b"}, False),
    (JOIN, {"target_player": "a", "child_player_ids": ["b"], "extra": 1}, False),
    (JOIN, {"target_player": "c", "child_player_ids": ["b"]}, False),
    (PART, {"target_player": "a", "player_ids_to_remove": ["b"]}, True),
    (PART, {"target_player": "a", "player_ids_to_remove": ["c"]}, False),   # not a member of the plan's groups
    (PART, {"target_player": "a", "player_ids_to_remove": ["b", "c"]}, False),
    (PART, {"target_player": "a", "player_ids_to_remove": []}, False),
    (PART, {"target_player": "a", "player_ids_to_remove": "b"}, False),
    (PART, {"target_player": "c", "player_ids_to_remove": ["b"]}, False),   # not the plan's leader
    (PART, {"target_player": "a", "player_ids_to_remove": ["b"], "player_ids_to_add": ["c"]}, False),
    (PART, {"target_player": "a", "player_ids_to_add": ["c"]}, False),
    ("players/cmd/ungroup_many", {"player_ids": ["b"]}, False),
    (ANNOUNCE, {"player_id": "a", "url": URL}, True),
    (ANNOUNCE, {"player_id": "a", "url": "http://elsewhere/"}, False),
    ("players/cmd/power", {"player_id": "a", "powered": False}, False),
    ("players/cmd/volume_set", {"player_id": "a", "volume_level": 10}, False),
    ("players/cmd/ungroup", {"player_id": "b"}, False),
    ("players/cmd/stop", {"player_id": "a"}, False),
])
def test_the_gate_lets_through_only_the_plans_own_steps(command, args, want):
    assert gate().allow(command, args) is want


def test_a_closed_run_or_one_with_no_groups_refuses_grouping():
    run = gate()
    run.close()
    assert not run.allow(JOIN, {"target_player": "a", "child_player_ids": ["b"]})
    assert not run.allow(PART, {"target_player": "a", "player_ids_to_remove": ["b"]})
    bare = D.IntercomRun(NS(), 1, {"a", "b"}, [URL])
    assert not bare.allow(JOIN, {"target_player": "a", "child_player_ids": ["b"]})
    assert not bare.allow(PART, {"target_player": "a", "player_ids_to_remove": ["b"]})


def test_a_raw_set_members_is_checked_for_every_speaker_it_names():
    from mantel_server.gateway import Command, Refused, ma_player_checks
    players = {"a": "media_player.a", "b": "media_player.b"}
    cmd = Command("ma", PART, [], ma=(PART, {"target_player": "a", "player_ids_to_remove": ["b"]}))
    assert {c.target for c in ma_player_checks(cmd, players).checks} == set(players.values())
    with pytest.raises(Refused):
        ma_player_checks(Command("ma", PART, [], ma=(PART, {"target_player": "a", "player_ids_to_remove": ["z"]})), players)
