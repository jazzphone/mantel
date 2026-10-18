"""Hold-to-talk (talk.py): a clip from a screen, played on a speaker."""
from __future__ import annotations

from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.hk_frontend import talk


def test_clips_expire_and_are_capped():
    now = [0.0]
    clips = talk.Clips(now=lambda: now[0])
    a = clips.add(b"x" * 300, "audio/webm")
    assert clips.get(a) == (b"x" * 300, "audio/webm")
    now[0] = talk.TTL_S + 1
    assert clips.get(a) is None, "a clip is gone once its signature has expired"
    ids = [clips.add(b"y", "audio/webm") for _ in range(talk.KEEP + 3)]
    assert len(clips) == talk.KEEP
    assert clips.get(ids[0]) is None and clips.get(ids[-1]) is not None


def test_ids_are_unguessable():
    clips = talk.Clips()
    ids = {clips.add(b"z", "audio/webm") for _ in range(5)}
    assert len(ids) == 5 and all(len(i) >= 24 for i in ids)


async def test_only_an_existing_media_player_is_a_target(hass):
    assert talk.check_target(hass, None)
    assert talk.check_target(hass, "light.kitchen")
    assert "does not exist" in talk.check_target(hass, "media_player.nope")
    hass.states.async_set("media_player.door", "idle")
    assert talk.check_target(hass, "media_player.door") is None


async def test_the_speaker_is_asked_to_play_the_signed_clip_url(hass):
    calls = async_mock_service(hass, "media_player", "play_media")
    clips = talk.Clips()
    clip_id = await talk.async_play(
        hass, clips, "media_player.door", b"o" * 500, "audio/webm;codecs=opus",
        sign=lambda p: p + "?authSig=SIG", base="http://192.0.2.10:8123")
    assert len(calls) == 1
    data = calls[0].data
    assert data["entity_id"] == "media_player.door"
    assert data["media_content_type"] == "music", "uiprotect plays only music"
    assert data["media_content_id"] == (
        f"http://192.0.2.10:8123{talk.URL}/{clip_id}?authSig=SIG")
    assert clips.get(clip_id)[0] == b"o" * 500


def test_only_an_audio_type_is_a_clip():
    assert talk.clip_type("audio/webm;codecs=opus") == "audio/webm"
    assert talk.clip_type("Audio/Ogg") == "audio/ogg" and talk.clip_type("audio/mp4") == "audio/mp4"
    for bad in ("text/html", "image/svg+xml", "application/octet-stream", "audio/", "", None):
        assert talk.clip_type(bad) is None, bad


async def test_the_views_take_and_give_only_audio(hass, hass_client):
    """Through the real views, authenticated as a screen: an upload that is
    not audio is 415 before anything plays; a clip goes out with the type it
    was checked for, nosniff and a sandboxing CSP."""
    from homeassistant.setup import async_setup_component
    assert await async_setup_component(hass, "http", {})
    calls = async_mock_service(hass, "media_player", "play_media")
    hass.states.async_set("media_player.door", "idle")
    clips = talk.async_register(hass)
    client = await hass_client()
    url = f"{talk.URL}?entity_id=media_player.door"

    r = await client.post(url, data=b"<script>x</script>" * 20, headers={"Content-Type": "text/html"})
    assert r.status == 415 and not calls and len(clips) == 0

    r = await client.post(url, data=b"o" * 500, headers={"Content-Type": "audio/webm;codecs=opus"})
    assert r.status == 200 and len(calls) == 1 and len(clips) == 1
    clip_path = calls[0].data["media_content_id"].split("://", 1)[1].split("/", 1)[1]
    r = await client.get("/" + clip_path)
    assert r.status == 200 and r.content_type == "audio/webm" and await r.read() == b"o" * 500
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Content-Security-Policy"] == "default-src 'none'; sandbox"
