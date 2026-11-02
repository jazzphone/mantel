"""A spoken reminder is not a music session; regular AirPlay still is."""
from homeassistant.core import Event
from homeassistant.helpers import entity_registry as er

from music_sample_house import K, OFF, music_entry
from music_sample_house import house, music  # noqa: F401
from test_feature_music_settings_ws import _admin, _call


def speak(tracker, source):
    tracker.service(Event("call_service", {"domain": "tts", "service": "speak",
        "service_data": {"entity_id": "tts.piper", "media_player_entity_id": source}}))


async def test_native_homepod_maps_to_ma_without_name_guessing(hass, music):
    reg = er.async_get(hass)
    src = reg.async_get_or_create("media_player", "apple_tv", "1A:35:C0:D3:C5:0B")
    ma = reg.async_get_or_create("media_player", "music_assistant", "ap1a35c0d3c50b")
    from custom_components.hk_frontend.features.music.announcements import Announcements
    from custom_components.hk_frontend.features.music.music import MusicConfig, Room
    cfg = MusicConfig(rooms=[Room(ma.entity_id, "Different name")])
    tracker = Announcements(hass, lambda: cfg)
    tracker.start()
    try:
        speak(tracker, src.entity_id)
        assert set(tracker.players()) == {src.entity_id, ma.entity_id}
        hass.states.async_set(src.entity_id, "playing", {"media_content_type": "music", "media_duration": 2})
        await hass.async_block_till_done()
        assert tracker.pending[src.entity_id]["started"]
        hass.states.async_set(src.entity_id, "idle")
        await hass.async_block_till_done()
        # End grace is a loop timer; trigger its callback without wall-clock sleep.
        tracker.pending[src.entity_id]["end"]._run()
        assert not tracker.players()
    finally:
        tracker.stop()


async def test_failed_call_repeated_calls_and_unload(hass, music):
    tracker = music_entry(hass).runtime_data.announcements
    speak(tracker, K)
    old = tracker.pending[K]
    speak(tracker, K)
    tracker.no_start(K, old)
    assert K in tracker.players(), "old timeout must not clear a newer reminder"
    tracker.no_start(K, tracker.pending[K])
    assert not tracker.players(), "a failed TTS call cannot hide the speaker forever"
    speak(tracker, OFF)
    tracker.stop()
    assert not tracker.players() and not tracker.unsub


async def test_toggle_validation_and_client_payload(hass, music):
    conn = await _admin(hass)
    assert (await _call(hass, conn, "get"))["result"]["ignore_announcements"] is True
    assert not (await _call(hass, conn, "set", changes={"ignore_announcements": "false"}))["success"]
    assert (await _call(hass, conn, "set", changes={"ignore_announcements": False}))["success"]
    mgr = music_entry(hass).runtime_data
    assert mgr.config.as_client(None)["ignore_announcements"] is False
    speak(mgr.announcements, K)
    assert not mgr.announcements.players()


async def test_real_service_event_is_seen_before_playback(hass, music):
    tracker = music_entry(hass).runtime_data.announcements
    async def tts(call):
        await hass.async_block_till_done()
        assert K in tracker.players()
        hass.states.async_set(K, "playing")
    hass.services.async_register("tts", "speak", tts)
    await hass.services.async_call("tts", "speak", {"media_player_entity_id": K}, blocking=True)
    await hass.async_block_till_done()
    assert tracker.pending[K]["started"]
    assert OFF not in tracker.players()


async def test_maximum_timeout_and_normal_play_release_marker(hass, music):
    tracker = music_entry(hass).runtime_data.announcements
    speak(tracker, K)
    tracker.pending[K]["started"] = True
    tracker.pending[K]["timers"][0]._run()
    assert not tracker.players(), "a missing end event is bounded"
    speak(tracker, K)
    tracker.service(Event("call_service", {"domain": "media_player", "service": "play_media",
        "service_data": {"entity_id": K, "media_content_id": "music://track/1"}}))
    assert not tracker.players(), "deliberately starting music releases suppression"


async def test_a_music_assistant_group_announcement_suppresses_its_rooms(hass, music):
    """Its rooms are the group's in Music Assistant's player list (a preset has no group)."""
    from unittest.mock import patch

    from custom_components.hk_frontend.features.music import music as MM
    from music_sample_house import DOWNG, DOWN
    pids = {r: "ap_" + r.split(".")[1] for r in DOWN}
    pids[DOWNG] = "sg_down"
    mgr = music_entry(hass).runtime_data
    mgr.ma_players = [{"player_id": p, "type": "player"} for r, p in pids.items() if r != DOWNG] + [
        {"player_id": "sg_down", "type": "group", "group_members": [pids[r] for r in DOWN]}]
    tracker = mgr.announcements
    with patch.object(MM, "ma_pids", lambda _hass: pids):
        tracker.service(Event("call_service", {"domain": "music_assistant", "service": "play_announcement",
            "service_data": {"entity_id": DOWNG}}))
    assert set(tracker.players()) == {DOWNG, *DOWN}
    assert OFF not in tracker.players()


async def test_resumed_music_reappears_without_waiting_for_idle(hass, music):
    tracker = music_entry(hass).runtime_data.announcements
    song = {"media_title": "Real song", "media_content_id": "music://1"}
    hass.states.async_set(K, "playing", song)
    await hass.async_block_till_done()
    speak(tracker, K)
    hass.states.async_set(K, "playing", {"media_title": "com.apple.tvairplayd"})
    await hass.async_block_till_done()
    assert K in tracker.players()
    hass.states.async_set(K, "playing", song)
    await hass.async_block_till_done()
    assert not tracker.players()


async def test_music_stopped_after_a_pause_is_listed_for_the_screens(hass, music):
    """Music Assistant stops a queue paused for 30 s; the screens keep it as paused (hk_core/music/resume.py)."""
    import time

    from homeassistant.helpers.dispatcher import async_dispatcher_connect

    from custom_components.hk_frontend.features.music.const import SIGNAL_CONFIG
    told = []
    async_dispatcher_connect(hass, SIGNAL_CONFIG, lambda: told.append(1))
    mgr = music_entry(hass).runtime_data
    hass.states.async_set(K, "playing", {"media_title": "Song"})
    hass.states.async_set(K, "paused", {"media_title": "Song"})
    await hass.async_block_till_done()
    assert mgr.resumes.players(time.monotonic()) == [] and not told
    hass.states.async_set(K, "idle", {"media_title": "Song"})
    await hass.async_block_till_done()
    assert mgr.resumes.players(time.monotonic()) == [K] and told, "listed, and the screens told"
    hass.states.async_set(K, "playing", {"media_title": "Song"})
    await hass.async_block_till_done()
    assert mgr.resumes.players(time.monotonic()) == []


async def test_a_stop_the_engine_sends_is_not_music_assistants_stop_after_a_pause(hass, music):
    """Stop All soon after a pause read as Music Assistant's own stop: the room stayed paused on the screens for four
    hours (MED-11, 2026-11-01). A media_stop the engine sends makes the idle that follows its own."""
    import time

    mgr = music_entry(hass).runtime_data
    hass.states.async_set(K, "playing", {"media_title": "Song"})
    hass.states.async_set(K, "paused", {"media_title": "Song"})
    await hass.async_block_till_done()
    await mgr._call("media_player", "media_stop", {"entity_id": [K]})      # (no player answers here: the mark is made)
    hass.states.async_set(K, "idle", {"media_title": "Song"})
    await hass.async_block_till_done()
    assert mgr.resumes.players(time.monotonic()) == []
