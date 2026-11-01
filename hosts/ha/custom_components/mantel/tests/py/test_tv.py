"""Live TV's transcode (tv.py) and the channel cameras that stream from it:
a channel Mantel names in `features.tv` streams through this Home Assistant's
own view; the view answers only this machine, only for a channel camera
Mantel Link mirrors now, and points ffmpeg only at a plain tuner stream URL."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from homeassistant.components.camera import CameraEntityFeature
from homeassistant.helpers import entity_registry as er

from conftest import linked
from mantel_fake import CAMERA, UIDS, until

from custom_components.mantel import tv

SOURCE = "http://192.0.2.40:5004/auto/v9.1"


def _camera(**tv_feat):
    return {"unique_id": UIDS[CAMERA], "platform": "camera", "entity_id": CAMERA, "has_entity_name": False,
            "name": "TV Channel Nine", "state": "idle", "attributes": {"channel": "9.1"},
            "features": {"tv": {"channel": "9.1", "source": SOURCE, "quality": "1080", **tv_feat}}}


class FakeProc:
    def __init__(self, chunks: list[bytes]) -> None:
        self.pid, self.returncode, self.killed = 4242, None, False
        self.stdout, self.stderr = asyncio.StreamReader(), asyncio.StreamReader()
        for c in chunks:
            self.stdout.feed_data(c)
        self.stdout.feed_eof()
        self.stderr.feed_data(b"Invalid frame dimensions 0x0\n")
        self.stderr.feed_eof()

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode


def test_only_a_plain_tuner_stream_is_a_channel():
    ok = tv.channel_of({"tv": {"channel": "9.1", "source": SOURCE, "quality": "1080", "image": "https://example.com/a.jpg"}})
    assert ok == {"channel": "9.1", "source": SOURCE, "quality": "1080", "image": "https://example.com/a.jpg"}
    assert tv.channel_of({"tv": {"channel": "9.1", "source": SOURCE, "quality": "4k"}})["quality"] == "720"
    for bad in ({"channel": "9.1", "source": "http://192.0.2.40:5004/auto/v9.2"},          # another channel
                {"channel": "9.1", "source": "file:///etc/passwd"},
                {"channel": "9.1", "source": SOURCE + "#raw"},
                {"channel": "9.1", "source": "http://192.0.2.40/auto/v9.1?x=1"},
                {"channel": "9.1", "source": "http://user@192.0.2.40/auto/v9.1"},
                {"channel": "../9", "source": SOURCE},
                {"channel": "9.1"}):
        assert tv.channel_of({"tv": bad}) is None, bad
    assert tv.channel_of({"stream_source": SOURCE}) is None
    assert tv.channel_of({"tv": {"channel": "9.1", "source": SOURCE, "image": "javascript:x"}})["image"] is None


def test_ffmpeg_reads_the_tuner_and_writes_mpegts():
    args = tv.ffmpeg_args(SOURCE, "1080")
    assert args[0] == "ffmpeg" and args[args.index("-i") + 1] == SOURCE and args[-1] == "pipe:1"
    assert "yadif=0:-1:0" in args and "6000k" in args
    assert "scale=-2:720" in " ".join(tv.ffmpeg_args(SOURCE, "720"))


async def test_a_channel_camera_streams_through_the_view(hass, mantel):
    mantel.entities = [e for e in mantel.entities if e["unique_id"] != UIDS[CAMERA]] + [_camera()]
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get(CAMERA) is not None)
    st = hass.states.get(CAMERA)
    assert st.attributes["supported_features"] & CameraEntityFeature.STREAM
    ent = hass.data["camera"].get_entity(CAMERA)
    src = await ent.stream_source()
    assert src.startswith("http://127.0.0.1:") and src.endswith("/api/mantel/tv/stream/9.1")
    # a plain camera Mantel names a stream for keeps working
    await mantel.push({"type": "entity", "entity": {**_camera(), "features": {"stream_source": "rtsp://192.0.2.9/x"}}})
    await until(hass, lambda: ent._features.get("stream_source") is not None)
    assert await ent.stream_source() == "rtsp://192.0.2.9/x"
    assert er.async_get(hass).async_get(CAMERA).platform == "mantel"


async def test_the_view_answers_only_this_machine_and_only_a_mirrored_channel(hass, mantel, hass_client, monkeypatch):
    from homeassistant.setup import async_setup_component
    assert await async_setup_component(hass, "http", {})
    mantel.entities = [e for e in mantel.entities if e["unique_id"] != UIDS[CAMERA]] + [_camera()]
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get(CAMERA) is not None)
    started: list[tuple] = []
    procs: list[FakeProc] = []

    async def spawn(*args, **kw):
        started.append(args)
        procs.append(FakeProc([b"G" * 188, b"G" * 188]))
        return procs[-1]
    monkeypatch.setattr(tv, "create_subprocess_exec", spawn)
    client = await hass_client()

    r = await client.get(f"{tv.URL}/9.1")
    assert r.status == 200 and r.headers["Content-Type"] == "video/mp2t" and await r.read() == b"G" * 376
    assert started[0][started[0].index("-i") + 1] == SOURCE and "6000k" in started[0]

    for path in ("4.1", "9.1.1", "..%2F9"):
        r = await client.get(f"{tv.URL}/{path}")
        assert r.status in (400, 404), path        # HA's own middleware turns a traversal away first
    assert len(started) == 1

    # unavailable (Mantel stopped serving it): nothing to stream
    await mantel.push({"type": "entity", "entity": {**_camera(), "available": False}})
    await until(hass, lambda: hass.states.get(CAMERA).state == "unavailable")
    assert (await client.get(f"{tv.URL}/9.1")).status == 404
    assert len(started) == 1

    # from anywhere but this machine: refused before anything else
    view = tv.TvStreamView(hass)
    req = MagicMock(remote="192.0.2.77")
    assert (await view.get(req, "9.1")).status == 403


async def test_a_channel_that_lost_its_webrtc_player_gets_it_back_when_the_link_returns(hass, mantel):
    """Home Assistant picks a camera's player in tasks that can race; the house's channels were left with
    none (camera/webrtc refused: "Camera does not support WebRTC") after the link to Mantel came back.
    Mantel Link picks again, once things settle, whenever the camera comes back or its stream changes."""
    from datetime import timedelta
    from homeassistant.components.camera.webrtc import CameraWebRTCProvider, async_register_webrtc_provider
    from homeassistant.util import dt as dt_util
    from pytest_homeassistant_custom_component.common import async_fire_time_changed

    class Relay(CameraWebRTCProvider):
        domain = "relay"

        def async_is_supported(self, stream_source):
            return stream_source.startswith("http://")

        async def async_handle_async_webrtc_offer(self, camera, offer_sdp, session_id, send_message):
            pass

        async def async_on_webrtc_candidate(self, session_id, candidate):
            pass

    from homeassistant.setup import async_setup_component
    assert await async_setup_component(hass, "camera", {})
    async_register_webrtc_provider(hass, Relay())
    mantel.entities = [e for e in mantel.entities if e["unique_id"] != UIDS[CAMERA]] + [_camera()]
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get(CAMERA) is not None)
    ent = hass.data["camera"].get_entity(CAMERA)
    await until(hass, lambda: ent._webrtc_provider is not None)

    ent._webrtc_provider = None                    # what the race left on the house
    await mantel.drop()
    await until(hass, lambda: hass.states.get(CAMERA).state == "unavailable")
    await until(hass, lambda: hass.states.get(CAMERA).state == "idle")
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=3))
    await hass.async_block_till_done()
    assert ent._webrtc_provider is not None
