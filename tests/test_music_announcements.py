"""Announcement lifecycle on a fictional house; never plays any audio."""
from types import SimpleNamespace as NS
import asyncio
import pytest
from mantel_server.music_announcements import Announcements
from mantel_server import music_announcements as M
from mantel_server.ha.registry import Registry
from mantel_server.ha.readproxy import music_config


def fixture(monkeypatch):
    monkeypatch.setattr(M, 'START_TIMEOUT', .04)
    monkeypatch.setattr(M, 'MAX_SECONDS', .15)
    monkeypatch.setattr(M, 'END_GRACE', .02)
    states = {'media_player.native': NS(state='playing', attributes={'media_title': 'Music'})}
    reg = Registry()
    reg.load([], [{'id': 'native', 'connections': [['mac', '11:22:33:44:55:66']]}], [
        {'entity_id': 'media_player.native', 'device_id': 'native', 'platform': 'apple_tv', 'unique_id': '11:22:33:44:55:66'},
        {'entity_id': 'media_player.ma', 'platform': 'music_assistant', 'unique_id': 'ap112233445566'},
        {'entity_id': 'media_player.other', 'platform': 'music_assistant', 'unique_id': 'apffffffffffff'}])
    cfg = NS(ignore_announcements=True, players=lambda: ['media_player.ma', 'media_player.other'], groups=None, room_ids=[])
    changes = []
    tracker = Announcements(NS(state=states.get), reg, lambda: cfg, lambda: changes.append(tracker.players()))
    return tracker, states, cfg, changes


def speak(t):
    t.service({'domain': 'tts', 'service': 'speak', 'service_data': {'media_player_entity_id': 'media_player.native'}})


async def test_physical_twin_hidden_before_state_and_released_after_completion(monkeypatch):
    t, states, cfg, changes = fixture(monkeypatch)
    speak(t)
    assert t.players() == ['media_player.ma', 'media_player.native']
    assert 'media_player.other' not in t.players()
    states['media_player.native'] = NS(state='playing', attributes={})  # unlabelled HomePod TTS
    t.state({'media_player.native'})
    states['media_player.native'] = NS(state='idle', attributes={})
    t.state({'media_player.native'})
    assert t.players()
    await asyncio.sleep(.03)
    assert t.players() == [] and changes[-1] == []


async def test_ordinary_music_resume_and_explicit_play_clear_markers(monkeypatch):
    t, states, cfg, changes = fixture(monkeypatch)
    speak(t)
    states['media_player.native'] = NS(state='playing', attributes={'media_title': 'Announcement'})
    t.state({'media_player.native'})
    states['media_player.native'] = NS(state='playing', attributes={'media_title': 'Music'})
    t.state({'media_player.native'})
    assert not t.players()
    speak(t)
    t.service({'domain': 'media_player', 'service': 'media_play', 'service_data': {'entity_id': 'media_player.ma'}})
    assert not t.players()


async def test_failed_start_timeout_maximum_toggle_and_disconnect(monkeypatch):
    t, states, cfg, changes = fixture(monkeypatch)
    cfg.ignore_announcements = False
    speak(t)
    assert not t.players()
    cfg.ignore_announcements = True
    speak(t)
    await asyncio.sleep(.06)
    assert not t.players()
    speak(t)
    t.state({'media_player.native'})
    await asyncio.sleep(.17)
    assert not t.players()
    speak(t)
    t.reset()
    assert not t.players() and changes[-1] == []


@pytest.mark.parametrize('domain,service,args', [
    ('tts', 'cloud_say', {'entity_id': 'media_player.native'}),
    ('media_player', 'play_media', {'entity_id': 'media_player.ma', 'announce': True}),
    ('music_assistant', 'play_announcement', {'entity_id': 'media_player.ma'}),
])
async def test_all_supported_announcement_calls_and_rbac(monkeypatch, domain, service, args):
    t, states, cfg, changes = fixture(monkeypatch)
    t.service({'domain': domain, 'service': service, 'service_data': args})
    assert 'media_player.ma' in t.players()
    out = music_config({'configured': True, 'speakers': [], 'announcements': t.players()}, {'media_player.ma'})
    assert out['announcements'] == ['media_player.ma']
    t.reset()


# -- the Intercom's markers (docs/phase17/INTERCOM-SYNC.md part A) --------------------------------------------------
async def test_intercom_marks_a_room_and_its_twin_whatever_the_setting(monkeypatch):
    t, states, cfg, changes = fixture(monkeypatch)
    cfg.ignore_announcements = False
    t.mark('m1', ['media_player.native'])
    assert t.intercom_players() == ['media_player.ma', 'media_player.native']
    assert t.players() == []                         # kept apart from Home Assistant's
    assert 'media_player.other' not in t.intercom_players()
    t.unmark('m1')
    assert t.intercom_players() == [] and changes


async def test_intercom_marks_outlive_home_assistant_and_end_by_their_own_clock(monkeypatch):
    t, states, cfg, changes = fixture(monkeypatch)
    monkeypatch.setattr(M, 'INTERCOM_MAX_SECONDS', .05)
    t.mark('m1', ['media_player.ma'])
    t.reset()                                         # HA going away says nothing about Music Assistant's message
    t.state({'media_player.ma'})
    assert t.intercom_players() == ['media_player.ma']
    await asyncio.sleep(.08)
    assert t.intercom_players() == []                 # the backstop


async def test_a_room_that_played_stays_hidden_for_its_grace(monkeypatch):
    t, states, cfg, changes = fixture(monkeypatch)
    t.mark('m1', ['media_player.ma'])
    t.unmark('m1', grace=.03)
    assert t.ending('m1') and t.intercom_players() == ['media_player.ma']
    await asyncio.sleep(.05)
    assert not t.ending('m1') and t.intercom_players() == []
