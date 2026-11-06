"""A GROUP LEFT FROM MUSIC, BORROWED (docs/phase17/INTERCOM-SYNC.md part D; rooms.leftovers, driver.borrow / give_back,
host._borrow), over a full app and the fake Music Assistant of tests/intercom_fakes.py. Nothing is played anywhere.

The rules pinned here: a leader picked alone takes its idle group apart first, checked, plays alone, and gets its members
back in their order; a group that changed since the plan is left alone and its leader gets no call; a member that started
playing meanwhile isn't pulled back; the music players leave the borrowed speakers as they were; "Sent to" counts the rooms
a leader's call reached; the gate lets a closed run put back only its own borrowed speakers.
"""
from __future__ import annotations


import intercom_fakes as IF
import music_fakes as MF
from intercom_fakes import ANNOUNCE, CODY, DEN, JOIN, KITCHEN, PART, chunks, recv_until, send_audio, until
from mantel_server.intercom import driver as D
from test_intercom_sync import grouping

ic = IF.fixture(commands=True)
K, DN, CY = MF.PID[KITCHEN], MF.PID[DEN], MF.PID[CODY]


async def left_grouped(env, members=(DEN,)) -> None:
    """The Kitchen leads ``members``, all idle, as music leaves them."""
    grouping(env, delay=0)
    await env.ma.set(KITCHEN, "idle", group_members=[KITCHEN, *members])
    for m in members:
        env.ma.model[MF.PID[m]]["synced_to"] = K
    assert await until(lambda: DEN in (env.hub.store.states[KITCHEN]["a"].get("group_members") or []))


def steps(env) -> list[tuple[str, str, list[str]]]:
    out = []
    for f in env.ma.frames:
        a = f.get("args") or {}
        if f.get("command") == PART:
            out.append(("part", a["target_player"], a["player_ids_to_remove"]))
        elif f.get("command") == JOIN:
            out.append(("join", a["target_player"], a["child_player_ids"]))
        elif f.get("command") == ANNOUNCE:
            out.append(("say", a["player_id"], []))
    return out


async def send(env, rooms):
    avery = await env.actor("avery", "owner")
    ws = await avery.talk()
    await send_audio(ws, chunks(10))
    await ws.send_json({"type": "send", "rooms": list(rooms)})
    return await recv_until(ws, "sent")


async def test_a_leader_picked_alone_plays_alone_and_gets_its_group_back(ic):
    await left_grouped(ic)
    events = await send(ic, [KITCHEN])
    assert events[0]["rooms"][0]["state"] == "ok"
    assert await until(lambda: len(steps(ic)) == 3), "it goes back just after the page hears it was sent"
    assert steps(ic) == [("part", K, [DN]), ("say", K, []), ("join", K, [DN])]
    assert ic.ma.model[K]["group_members"][:2] == [K, DN]
    assert events[-1]["rooms"] == 1 and events[-1]["failed"] == []
    assert await until(lambda: ic.play_rows()[0]["result"] == "ok")


async def test_the_borrowed_speakers_stay_out_of_the_music_players_until_they_are_back(ic):
    await left_grouped(ic)
    tracker = ic.host.music.announcements
    seen = []
    ic.ma.on_call = lambda args: seen.append(set(tracker.intercom_players()))
    await send(ic, [KITCHEN])
    assert seen and DEN in seen[0]
    assert await until(lambda: tracker.intercom_players() == [], timeout=5)


async def test_a_group_that_changed_since_the_plan_is_left_alone_and_its_leader_gets_no_call(ic, monkeypatch):
    await left_grouped(ic)
    real = D.borrow

    async def it_changed(ma, run, loose):
        ic.ma.model[CY]["synced_to"] = K                      # somebody grouped another speaker in, just now
        ic.ma.model[K]["group_members"] = [K, DN, CY]
        return await real(ma, run, loose)
    monkeypatch.setattr(D, "borrow", it_changed)
    events = await send(ic, [KITCHEN])
    assert [s[0] for s in steps(ic)] == [], "nothing taken apart, nothing said"
    assert events[-1]["rooms"] == 0 and events[-1]["failed"] == ["Kitchen"]


async def test_a_member_that_started_playing_meanwhile_isnt_pulled_back(ic):
    await left_grouped(ic)
    ic.ma.on_call = lambda args: ic.ma.model[DN].update(playback_state="playing")
    await send(ic, [KITCHEN])
    assert await until(lambda: ic.play_rows()[0]["result"] is not None)
    assert [s[0] for s in steps(ic)] == ["part", "say"]


async def test_a_room_inside_it_picked_without_its_leader_borrows_it_and_its_leader_hears_nothing(ic):
    """2026-11-05: the Office's two HomePods, members of a group left from music, played one after the other."""
    await left_grouped(ic, members=(DEN, CODY))
    ic.ma.model[CY]["volume_level"] = 40
    doc = ic.doc()
    doc["rooms"][CODY]["volume"] = 40
    ic.app["settings"].store.write([("house", "intercom", doc)], actor=IF.SettingsActor(label="test"))
    events = await send(ic, [DEN, CODY])
    assert await until(lambda: steps(ic) and steps(ic)[-1][0] == "join" and steps(ic)[-1][1] == K)
    kinds = [s[0] for s in steps(ic)]
    assert kinds[0] == "part" and kinds.count("say") == 1, "one announcement, to a temporary group of the two"
    assert K not in [s[1] for s in steps(ic) if s[0] == "say"], "the leader's room wasn't picked"
    assert steps(ic)[-1] == ("join", K, [DN, CY]) and events[-1]["rooms"] == 2


async def test_sent_to_counts_every_room_a_leaders_call_reached(ic):
    await left_grouped(ic)
    events = await send(ic, [KITCHEN, DEN])                    # the whole group: one call, through its leader
    assert [s[0] for s in steps(ic)] == ["say"] and events[-1]["rooms"] == 2


async def test_other_rooms_picked_borrow_it_so_every_room_plays_in_one_group(ic):
    await left_grouped(ic)
    ic.ma.model[CY]["volume_level"] = 40
    doc = ic.doc()
    doc["rooms"][CODY]["volume"] = 40
    ic.app["settings"].store.write([("house", "intercom", doc)], actor=IF.SettingsActor(label="test"))
    events = await send(ic, [KITCHEN, DEN, CODY])
    assert await until(lambda: steps(ic)[-1][0] == "join" and steps(ic)[-1][1] == K and steps(ic)[-1][2] == [DN])
    kinds = [s[0] for s in steps(ic)]
    assert kinds[0] == "part" and kinds.count("say") == 1 and kinds[-1] == "join"
    assert steps(ic)[-1] == ("join", K, [DN]) and events[-1]["rooms"] == 3


def test_a_closed_run_puts_back_only_its_own_borrowed_speakers():
    run = D.IntercomRun(None, 1, {K}, ["u"], lent={K: [DN]})
    run.close()
    assert run.allow(JOIN, {"target_player": K, "child_player_ids": [DN]})
    assert not run.allow(JOIN, {"target_player": K, "child_player_ids": [DN, CY]}), "no other speaker"
    assert not run.allow(JOIN, {"target_player": DN, "child_player_ids": [K]}), "no other leader"
    assert not run.allow(PART, {"target_player": K, "player_ids_to_remove": [DN]}), "closed: nothing taken apart now"


async def test_a_room_a_group_call_would_not_reach_gets_its_own_call_and_a_note(ic, monkeypatch):
    """The safety net (2026-11-05: 0.1.134's plan had a leader "cover" rooms it no longer led; the audit said ok): just
    before the calls, every room a group is to reach is checked against Music Assistant's list now."""
    from hk_core.intercom import rooms as R
    await left_grouped(ic)
    real = R.decide

    def then_it_parts(*a, **kw):
        plan = real(*a, **kw)
        ic.ma.model[K].update(group_members=[], group_childs=[])     # the group went away since the plan
        ic.ma.model[DN]["synced_to"] = None
        return plan
    monkeypatch.setattr(R, "decide", then_it_parts)
    events = await send(ic, [KITCHEN, DEN])                    # the whole group: one call, through its leader, it thought
    assert sorted(a["player_id"] for a in ic.ma.announcements) == sorted([K, DN])
    assert events[-1]["rooms"] == 2 and events[-1]["failed"] == []
    assert await until(lambda: any(r["action"] == "intercom.failures" for r in ic.audit(kind="ma")))
    (note,) = [r for r in ic.audit(kind="ma") if r["action"] == "intercom.failures"]
    assert f"uncovered:{DEN}" in note["reason"]
