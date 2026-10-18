"""Music's request engine (features/music/music.py) against the fake house.

Each rule here is written around how Music Assistant was measured to
behave, plus per-room concurrency, newest-request-wins, and an answer to the
caller.
"""
from __future__ import annotations

import asyncio

from music_sample_house import DOWN, DOWNG, EVERY, EXTRA, K, LOFT, LR, OFF, ROOMS
from music_sample_house import house, music  # noqa: F401 -- the fixtures


def key(music, name):
    return next(p.key for p in music.config.playlists if p.name == name)


# ------------------------------------------------------------------- play
async def test_one_room_plays_directly(music, house):
    res = await music.play([OFF], key(music, "Country"))
    assert res == {"ok": True, "leader": OFF}
    assert house.state(OFF) == "playing"
    ma = house.called("ma_play_media")
    assert len(ma) == 1 and ma[0]["entity_id"] == OFF
    assert ma[0]["enqueue"] == "replace"
    assert "library://playlist/124" in str(ma[0]["media_id"])
    assert not house.called("join") and not house.called("unjoin")


async def test_house_volume_is_set_on_the_rooms(music, house):
    await music.play([OFF, LOFT], key(music, "Country"))
    vol = house.called("volume_set")[0]
    assert sorted(vol["entity_id"]) == sorted([OFF, LOFT])
    assert vol["volume_level"] == 0.35


async def test_a_preset_plays_through_its_sync_group(music, house):
    res = await music.play(list(DOWN), key(music, "Favorites Mix"))
    assert res["ok"] and res["leader"] == DOWNG
    assert house.called("ma_play_media")[0]["entity_id"] == DOWNG
    assert not house.called("join")
    # levelled on the ROOMS -- a sync group scales its members instead
    assert sorted(house.called("volume_set")[0]["entity_id"]) == sorted(DOWN)


async def test_ad_hoc_rooms_are_joined_under_the_first(music, house):
    res = await music.play([LOFT, OFF], key(music, "New Music"))
    assert res == {"ok": True, "leader": LOFT}
    assert house.members(LOFT) == [LOFT, OFF]
    assert house.called("ma_play_media")[0]["entity_id"] == LOFT


async def test_an_existing_group_is_reused_whatever_the_tap_order(music, house):
    house.group(OFF, [LOFT])
    res = await music.play([LOFT, OFF], key(music, "New Music"))
    assert res["leader"] == OFF                    # the group's real leader
    assert not house.called("unjoin") and not house.called("join")


async def test_a_joined_single_room_is_released_first(music, house):
    house.group(K, [LR, OFF])
    house.set(K, "playing"), house.set(LR, "playing"), house.set(OFF, "playing")
    res = await music.play([OFF], key(music, "Country"))
    assert res["ok"] and res["leader"] == OFF
    assert house.called("media_pause"), "a streaming room must be paused to release"
    assert house.members(OFF) == []
    # ...and only it: the group plays on in the rooms not picked
    assert house.members(K) == [K, LR] and house.state(K) == "playing"
    assert all(K not in str(d["entity_id"]) and LR not in str(d["entity_id"]) for d in house.called("media_pause"))


async def test_new_music_on_some_of_a_group_leaves_the_rest_playing(music, house):
    # the user's case: Living Room + Master Bedroom playing; a playlist on
    # Master Bedroom and two quiet rooms -- Living Room must keep its music
    house.group(LR, [K])
    house.set(LR, "playing", media_content_id="q1"), house.set(K, "playing", media_content_id="q1")
    res = await music.play([K, OFF, LOFT], key(music, "Country"))
    assert res["ok"] and res["leader"] == K
    assert house.state(LR) == "playing" and house.members(LR) in ([], [LR])
    assert sorted(house.members(K)) == sorted([K, OFF, LOFT])
    assert not [d for d in house.called("media_pause") if LR in str(d["entity_id"])]


async def test_new_music_on_a_groups_leader_moves_its_music_to_the_rest(music, house):
    # the leader picked: what it plays moves to the room left behind first
    house.group(LR, [K])
    house.set(LR, "playing", media_content_id="q1"), house.set(K, "playing", media_content_id="q1")
    res = await music.play([LR, OFF], key(music, "Country"))
    assert res["ok"] and res["leader"] == LR
    tq = house.called("transfer_queue")
    assert tq and tq[0]["entity_id"] == K and tq[0]["source_player"] == LR
    assert house.state(K) == "playing"
    assert house.hass.states.get(K).attributes.get("media_content_id") == "q1"
    assert sorted(house.members(LR)) == sorted([LR, OFF])


async def test_an_unrelated_group_is_left_alone(music, house):
    house.group(K, [LR])
    house.set(K, "playing"), house.set(LR, "playing")
    await music.play([OFF, LOFT], key(music, "Country"))
    assert house.members(K) == [K, LR]
    assert house.state(K) == "playing"


async def test_a_member_that_will_not_join_is_retried_then_reported(music, house, hass):
    house.stubborn.add(OFF)
    res = await music.play([LOFT, OFF], key(music, "Country"))
    assert res["ok"] is False and "group" in res["message"]
    assert len(house.called("join")) == 2            # one retry
    assert house.members(LOFT) == []                 # broken up, not left wrong
    assert not house.called("ma_play_media")
    from homeassistant.components import persistent_notification as pn
    assert "speaker_group_failed" in pn._async_get_or_create_notifications(hass)


async def test_refusals_answer_instead_of_raising(music, house):
    assert (await music.play([], "x"))["ok"] is False
    assert "no playlist" in (await music.play([OFF], "nope"))["message"].lower()
    assert "twice" in (await music.play([OFF, OFF], key(music, "Country")))["message"]
    assert "knows" in (await music.play(["media_player.tv"], key(music, "Country")))["message"]
    house.set(LOFT, "unavailable")
    res = await music.play([LOFT], key(music, "Country"))
    assert res["ok"] is False and "unavailable" in res["message"]
    assert not house.called("ma_play_media")


async def test_a_playlist_that_never_starts_is_reported(music, house, hass):
    house.dead.add(OFF)
    res = await music.play([OFF], key(music, "Country"))
    assert res["ok"] is False and "did not start" in res["message"]
    from homeassistant.components import persistent_notification as pn
    assert "music_play_failed" in pn._async_get_or_create_notifications(hass)


async def test_success_clears_an_old_failure(music, house, hass):
    from homeassistant.components import persistent_notification as pn
    pn.async_create(hass, "old", "old", "music_play_failed")
    await music.play([OFF], key(music, "Country"))
    assert "music_play_failed" not in pn._async_get_or_create_notifications(hass)


# ------------------------------------------------------------ concurrency
async def test_different_rooms_run_at_the_same_time(music, house):
    """A request for other rooms never waits for the first to finish."""
    house.slow_unjoin = 0.3
    house.group(K, [LR])                           # so the first has work to do
    a = asyncio.create_task(music.play([K], key(music, "Country")))
    await asyncio.sleep(0.05)
    b = asyncio.create_task(music.play([OFF], key(music, "New Music")))
    done_b = await b
    assert done_b["ok"] and not a.done(), "Office did not have to wait for the Kitchen"
    assert (await a)["ok"]


async def test_the_newest_request_for_the_same_rooms_wins(music, house):
    house.slow_unjoin = 0.3
    house.group(K, [LR])
    first = asyncio.create_task(music.play([K], key(music, "Country")))
    await asyncio.sleep(0.05)                      # first holds the Kitchen
    second = asyncio.create_task(music.play([K], key(music, "Christmas")))
    third = asyncio.create_task(music.play([K], key(music, "New Music")))
    r2, r3 = await second, await third
    assert r2.get("superseded") and r2["ok"] is False
    assert r3 == {"ok": True, "leader": K}
    played = [str(c["media_id"]) for c in house.called("ma_play_media")]
    assert "library://playlist/140" in played[-1]  # New Music, the last asked for
    assert not any("136" in p for p in played), "the replaced request never played"
    await first


async def test_overlapping_requests_never_interleave(music, house):
    """Office+Extra is being built when Extra+Loft is asked for. The first
    stands down; the second breaks up what the first left and builds its own
    -- one group at the end, never two half-built ones."""
    house.slow_unjoin = 0.2
    house.group(OFF, [K])
    a = asyncio.create_task(music.play([OFF, EXTRA], key(music, "Country")))
    await asyncio.sleep(0.02)
    b = asyncio.create_task(music.play([EXTRA, LOFT], key(music, "Christmas")))
    ra, rb = await a, await b
    assert ra.get("superseded") and rb == {"ok": True, "leader": EXTRA}
    assert house.members(EXTRA) == [EXTRA, LOFT]
    assert OFF not in house.members(EXTRA)
    assert len(house.called("ma_play_media")) == 1


async def test_a_move_before_the_music_has_started_is_refused(music, house):
    house.slow_unjoin = 0.2
    house.group(OFF, [K])
    a = asyncio.create_task(music.play([OFF], key(music, "Country")))
    await asyncio.sleep(0.02)
    rb = await music.transfer([EXTRA], OFF)
    assert rb["ok"] is False and "not playing" in rb["message"]
    assert (await a)["ok"]


# ------------------------------------------------------------- transfer
async def test_move_carries_the_queue_and_releases_the_old_room(music, house):
    house.set(OFF, "playing", media_content_id="q1")
    res = await music.transfer([LOFT], OFF)
    assert res == {"ok": True, "leader": LOFT}
    tq = house.called("transfer_queue")[0]
    assert tq["entity_id"] == LOFT and tq["source_player"] == OFF
    assert house.state(LOFT) == "playing" and house.state(OFF) == "idle"


async def test_add_joins_without_moving_the_queue(music, house):
    house.set(OFF, "playing", media_content_id="q1")
    res = await music.transfer([OFF, LOFT], OFF)
    assert res == {"ok": True, "leader": OFF}
    assert not house.called("transfer_queue")
    assert house.members(OFF) == [OFF, LOFT]


async def test_add_in_either_tap_order(music, house):
    house.set(OFF, "playing", media_content_id="q1")
    res = await music.transfer([LOFT, OFF], OFF)     # Loft tapped first
    assert res["leader"] == OFF and not house.called("transfer_queue")


async def test_move_to_a_preset_goes_to_the_sync_group(music, house):
    house.set(OFF, "playing", media_content_id="q1")
    res = await music.transfer(list(DOWN), OFF)
    assert res["leader"] == DOWNG
    assert house.called("transfer_queue")[0]["entity_id"] == DOWNG


async def test_transfer_refusals(music, house):
    assert "not playing" in (await music.transfer([LOFT], OFF))["message"]
    house.set(OFF, "playing")
    assert "already" in (await music.transfer([OFF], OFF))["message"]


async def test_the_leader_alone_lets_the_rest_of_its_group_go(music, house):
    # the Music page freeing Master Bedroom for a new pick: Living Room keeps
    # the music, the room it was joined with is let go (and paused)
    house.group(LR, [K])
    house.set(LR, "playing", media_content_id="q1"), house.set(K, "playing")
    res = await music.transfer([LR], LR)
    assert res == {"ok": True, "leader": LR}
    assert house.members(K) in ([], [K])
    assert house.state(LR) == "playing"
    assert house.called("unjoin") and not house.called("transfer_queue")


async def test_a_partial_add_keeps_the_music_and_says_so(music, house, hass):
    house.set(OFF, "playing", media_content_id="q1")
    house.stubborn.add(EXTRA)
    res = await music.transfer([OFF, LOFT, EXTRA], OFF)
    assert res["ok"] is True and "did not join" in res["message"]
    assert house.state(OFF) == "playing"
    from homeassistant.components import persistent_notification as pn
    assert "music_transfer_partial" in pn._async_get_or_create_notifications(hass)


async def test_a_move_whose_queue_never_arrives_is_reported(music, house):
    house.set(OFF, "playing", media_content_id="q1")
    house.hass.services.async_remove("music_assistant", "transfer_queue")

    async def broken(call):
        house.calls.append(("transfer_queue", dict(call.data)))
    house.hass.services.async_register("music_assistant", "transfer_queue", broken)
    res = await music.transfer([LOFT], OFF)
    assert res["ok"] is False and "did not move" in res["message"]
    assert house.state(OFF) == "playing", "nothing else was touched"


# ------------------------------------------------------------------ stop
async def test_stop_everything(music, house):
    house.group(K, [LR])
    house.set(K, "playing"), house.set(LR, "playing"), house.set(DOWNG, "playing")
    res = await music.stop()
    assert res == {"ok": True}
    assert all(house.state(r) == "idle" for r in ROOMS)
    assert house.state(DOWNG) == "idle" and house.members(K) == []


async def test_stop_some_rooms_leaves_the_rest(music, house):
    house.set(K, "playing"), house.set(OFF, "playing")
    await music.stop([OFF])
    assert house.state(OFF) == "idle" and house.state(K) == "playing"
    assert not [d for d in house.called("media_stop") if EVERY in str(d)]


async def test_stop_makes_a_waiting_request_stand_down(music, house):
    house.slow_unjoin = 0.3
    house.group(K, [LR])
    first = asyncio.create_task(music.play([K], key(music, "Country")))
    await asyncio.sleep(0.05)
    waiting = asyncio.create_task(music.play([K], key(music, "Christmas")))
    await asyncio.sleep(0.01)
    await music.stop()
    assert (await waiting).get("superseded")
    await first


# -------------------------------------------------------------- transport
async def test_transport_names_its_player(music, house):
    house.set(OFF, "playing")
    assert (await music.transport(OFF, "play_pause"))["ok"]
    assert house.state(OFF) == "paused"
    assert house.called("media_play_pause")[0]["entity_id"] == OFF


async def test_four_quick_volume_taps_are_four_steps(music, house):
    house.set(OFF, volume_level=0.2)
    await asyncio.gather(*(music.transport(OFF, "volume_up") for _ in range(4)))
    assert house.hass.states.get(OFF).attributes["volume_level"] == 0.4


async def test_volume_is_clamped(music, house):
    house.set(OFF, volume_level=0.98)
    await music.transport(OFF, "volume_up")
    assert house.hass.states.get(OFF).attributes["volume_level"] == 1.0
    house.set(OFF, volume_level=0.02)
    await music.transport(OFF, "volume_down")
    assert house.hass.states.get(OFF).attributes["volume_level"] == 0.0


async def test_transport_refuses_an_unknown_player(music, house):
    assert (await music.transport("media_player.tv", "next"))["ok"] is False


async def test_a_preset_group_is_a_valid_transport_player(music, house):
    assert (await music.transport(DOWNG, "next"))["ok"]


# ------------------------------------------------------------ browse item
async def test_browse_plays_one_item_and_answers(music, house):
    res = await music.play_media(OFF, "library://track/1", "music")
    assert res == {"ok": True, "leader": OFF}
    assert house.called("play_media")[0]["media_content_id"] == "library://track/1"


async def test_browse_refuses_an_unavailable_player(music, house):
    house.set(OFF, "unavailable")
    res = await music.play_media(OFF, "library://track/1", "music")
    assert res["ok"] is False and "unavailable" in res["message"]
    assert not house.called("play_media")


async def test_browse_reports_a_failure(music, house):
    house.dead.add(OFF)
    assert (await music.play_media(OFF, "library://track/1", "music"))["ok"] is False


async def test_a_replaced_request_never_touches_the_house(music, house):
    """It stands down as soon as its turn comes -- not after building a group
    the request that replaced it would then have to take apart."""
    house.slow_unjoin = 0.3
    house.group(K, [LR])
    first = asyncio.create_task(music.play([K], key(music, "Country")))
    await asyncio.sleep(0.05)
    stale = asyncio.create_task(music.play([K, OFF], key(music, "Christmas")))
    newest = asyncio.create_task(music.play([K], key(music, "New Music")))
    assert (await stale).get("superseded")
    assert (await newest)["ok"]
    await first
    assert not house.called("join"), "the replaced request built a group anyway"


async def test_replaying_a_playing_preset_keeps_its_sync_group(music, house):
    """Downstairs playing reports all five rooms grouped; pressing another
    playlist for Downstairs must not pull those rooms out of their own group."""
    for r in DOWN:
        house.set(r, "playing", group_members=list(DOWN))
    house.set(DOWNG, "playing")
    res = await music.play(list(DOWN), key(music, "Christmas"))
    assert res["ok"] and res["leader"] == DOWNG
    assert not house.called("unjoin") and not house.called("media_pause")


async def test_a_playlist_that_left_the_library_is_refused_not_played(music, house, hass):
    """Given a link that is no longer in the library, Music Assistant searches
    for its text and may play anything (a podcast). The engine asks the
    library first."""
    from unittest.mock import patch

    from homeassistant.config_entries import ConfigEntryState
    from pytest_homeassistant_custom_component.common import MockConfigEntry
    fake = MockConfigEntry(domain="music_assistant", entry_id="ma1")
    fake._async_set_state(hass, ConfigEntryState.LOADED, None)
    real = hass.config_entries.async_entries
    with patch.object(hass.config_entries, "async_entries",
                      lambda d=None, **kw: [fake] if d == "music_assistant" else real(d, **kw)):
        res = await music.play([OFF], key(music, "Christmas"))    # 136 and 128: not in the fake library
        assert res["ok"] is False and "no longer in the music library" in res["message"]
        assert not house.called("ma_play_media")
        house.library += [{"name": "Xmas A", "uri": "library://playlist/136"},
                          {"name": "Xmas B", "uri": "library://playlist/128"}]
        assert (await music.play([OFF], key(music, "Christmas")))["ok"]


async def test_the_library_check_never_blocks_music_on_its_own(music, house):
    """No Music Assistant entry to ask (or it errors): play anyway."""
    assert (await music.play([OFF], key(music, "Christmas")))["ok"]


# ------------------------------------------------------- the lock and Stop
async def test_a_preset_waits_the_settle_after_releasing_its_rooms(music, house):
    """The settle after a release: MA reports a released room free before it
    is, and the sync group about to play regroups that very room."""
    music.settle = 0.2
    house.group(K, [OFF])                          # Kitchen, a Downstairs room, is taken
    res = await music.play(list(DOWN), key(music, "Favorites Mix"))
    assert res["ok"] and res["leader"] == DOWNG
    released, played = house.when("unjoin")[-1], house.when("ma_play_media")[0]
    assert played - released >= 0.19, "the sync group played the instant its rooms were freed"


async def test_a_preset_with_nothing_to_release_does_not_wait(music, house):
    music.settle = 5                               # would time the test out if it waited
    res = await asyncio.wait_for(music.play(list(DOWN), key(music, "Favorites Mix")), 2)
    assert res["ok"]


async def test_the_leader_is_read_once_the_rooms_are_free(music, house):
    """A request that waited for its rooms builds on what it finds THEN: here
    someone grouped them under the Loft meanwhile, so the Loft leads and no
    join is sent -- play_media aimed at a group MEMBER would go nowhere."""
    lock = music._locks[LOFT]
    await lock.acquire()
    req = asyncio.create_task(music.play([OFF, LOFT], key(music, "Country")))
    await asyncio.sleep(0.05)
    house.group(LOFT, [OFF])                       # changed while the request waited
    lock.release()
    res = await req
    assert res == {"ok": True, "leader": LOFT}
    assert not house.called("join")
    assert house.called("ma_play_media")[0]["entity_id"] == LOFT


async def test_a_double_tapped_move_moves_once_and_both_answer_ok(music, house):
    house.set(OFF, "playing", media_content_id="library://playlist/124")
    house.slow_transfer = 0.1
    a = asyncio.create_task(music.transfer([LOFT], OFF))
    await asyncio.sleep(0.02)
    b = asyncio.create_task(music.transfer([LOFT], OFF))
    ra, rb = await a, await b
    assert ra == {"ok": True, "leader": LOFT}
    assert rb == {"ok": True, "leader": LOFT}, "the second tap found the move done"
    assert len(house.called("transfer_queue")) == 1


async def test_stop_cancels_a_move_that_is_already_running(music, house):
    """Stop cancels what is running: stamping alone would let a Move inside
    its lock carry on and join rooms after Stop."""
    house.set(OFF, "playing", media_content_id="library://playlist/124")
    house.slow_transfer = 0.5
    move = asyncio.create_task(music.transfer([LOFT, K], OFF))
    await asyncio.sleep(0.05)                      # inside transfer_queue
    assert (await music.stop()) == {"ok": True}
    res = await move
    assert res["superseded"] and res["message"] == "Stopped."
    assert not house.called("join"), "the stopped move went on to join rooms"
    assert all(house.state(r) != "playing" for r in ROOMS)
    assert music._running == {} and music._stopped == set()


async def test_stop_for_one_room_leaves_other_requests_running(music, house):
    house.slow_unjoin = 0.3
    house.group(K, [LR])
    kitchen = asyncio.create_task(music.play([K], key(music, "Country")))
    await asyncio.sleep(0.05)
    await music.stop([OFF])
    assert (await kitchen) == {"ok": True, "leader": K}


async def test_a_shutdown_still_cancels(music, house):
    """Only Stop's own cancellation becomes an answer; Home Assistant
    cancelling a request (shutting down) must still cancel it."""
    import pytest
    house.slow_unjoin = 0.5
    house.group(K, [LR])
    req = asyncio.create_task(music.play([K], key(music, "Country")))
    await asyncio.sleep(0.05)
    req.cancel()
    with pytest.raises(asyncio.CancelledError):
        await req
    assert music._running == {}


async def test_a_preset_checks_every_room_joined(music, house, hass):
    """The settle is a margin; the proof is every member playing once the
    sync group does. A room that did not follow is named, and the rest of
    the music is left alone."""
    house.lagging.add(K)
    res = await music.play(list(DOWN), key(music, "Favorites Mix"))
    assert res["ok"] and res["leader"] == DOWNG
    assert "kitchen" in res["message"] and "did not join" in res["message"]
    assert len(house.called("ma_play_media")) == 1, "the group was not restarted"
    from homeassistant.components import persistent_notification as pn
    note = pn._async_get_or_create_notifications(hass).get("music_preset_failed")
    assert note and "kitchen" in note["message"] and "Downstairs" in note["message"]


async def test_a_preset_whose_rooms_all_play_says_nothing_more(music, house):
    res = await music.play(list(DOWN), key(music, "Favorites Mix"))
    assert res == {"ok": True, "leader": DOWNG}
