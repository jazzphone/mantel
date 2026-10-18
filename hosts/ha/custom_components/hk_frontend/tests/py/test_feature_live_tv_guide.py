"""Live TV's guide, channel naming, viewers and transcode (no Home Assistant
needed)."""
from datetime import datetime, timedelta, timezone

from custom_components.hk_frontend.features.live_tv import Viewers
from custom_components.hk_frontend.features.live_tv.channels import build_channels, label
from custom_components.hk_frontend.features.live_tv.guide import network_of, now_next, parse_xmltv
from custom_components.hk_frontend.features.live_tv.stream import ffmpeg_args

NOW = datetime(2026, 9, 26, 15, 30, tzinfo=timezone.utc)


def t(h, m=0):
    return (NOW.replace(minute=0) + timedelta(hours=h, minutes=m)).strftime("%Y%m%d%H%M%S +0000")


XML = f"""<?xml version="1.0"?><tv>
<channel id="30922"><display-name>WXXXDT</display-name><display-name>NATIONAL BROADCASTING COMPANY</display-name>
<display-name>4.1</display-name><icon src="https://img/nbc.png"/></channel>
<channel id="80599"><display-name>W11XXD</display-name><display-name>NATIONAL BROADCASTING COMPANY</display-name>
<display-name>4.1</display-name></channel>
<channel id="120291"><display-name>WXXXDT3</display-name><display-name>CBS TELEVISION NETWORK</display-name>
<display-name>4.3</display-name></channel>
<channel id="999"><display-name>SOMETHING</display-name><display-name>7.3</display-name></channel>
<programme start="{t(0)}" stop="{t(1)}" channel="30922"><title>News</title><sub-title>Evening</sub-title>
<desc>d</desc><icon src="https://zap2it.tmsimg.com/assets/p1.jpg"/></programme>
<programme start="{t(0)}" stop="{t(1)}" channel="80599"><title>News</title></programme>
<programme start="{t(1)}" stop="{t(2)}" channel="30922"><title>Game</title></programme>
<programme start="{t(-6)}" stop="{t(-5)}" channel="30922"><title>Old</title></programme>
<programme start="{t(0)}" stop="{t(2)}" channel="120291"><title>Show</title></programme>
</tv>""".encode()


def test_networks_are_short_names():
    assert network_of(["WXXXDT", "NATIONAL BROADCASTING COMPANY", "4.1"]) == "NBC"
    assert network_of(["x"]) is None


def test_guide_by_channel_number_with_repeaters_merged():
    g = parse_xmltv(XML, {"4.1", "4.3"}, now=NOW)
    assert set(g) == {"4.1", "4.3"}, "7.3 was not asked for"
    nbc = g["4.1"]
    assert nbc["network"] == "NBC" and nbc["logo"] == "https://img/nbc.png"
    titles = [p["title"] for p in nbc["programmes"]]
    assert titles == ["News", "Game"], "the repeater's copy is dropped, and so is the old show"
    cur, nxt = now_next(nbc["programmes"], NOW)
    assert cur["title"] == "News" and cur["subtitle"] == "Evening" and cur["image"] == "https://zpmc.tmsimg.com/assets/p1.jpg", "the dead art host is rewritten"
    assert nxt["title"] == "Game"


def test_channels_are_named_after_their_network_and_keep_their_names():
    lineup = [{"number": "4.1", "name": "WXXX-DT"}, {"number": "4.3", "name": "WXXXCBS"},
              {"number": "7.1", "name": "WYYY-HD"}, {"number": "13.1", "name": "ABC"}]
    nets = {"4.1": "NBC", "4.3": "CBS"}
    out = build_channels(["13.1", "4.3", "4.1"], lineup, nets)
    assert out == [{"number": "4.1", "name": "NBC"}, {"number": "4.3", "name": "CBS"},
                   {"number": "13.1", "name": "ABC"}], "lineup order, network names"
    kept = build_channels(["4.1", "7.1"], lineup, nets, keep=[{"number": "4.1", "name": "My NBC"}])
    assert kept == [{"number": "4.1", "name": "My NBC"}, {"number": "7.1", "name": "WYYY-HD"}]
    upgraded = build_channels(["4.1"], lineup, nets, keep=[{"number": "4.1", "name": "WXXX-DT"}])
    assert upgraded == [{"number": "4.1", "name": "NBC"}], "set up before the guide: the network name arrives with it"
    twice = build_channels(["4.1", "7.1"], lineup, {"4.1": "NBC", "7.1": "NBC"})
    assert [c["name"] for c in twice] == ["NBC 4.1", "NBC 7.1"]
    assert label(lineup[0], nets) == "4.1  NBC (WXXX-DT)" and label(lineup[2], nets) == "7.1  WYYY-HD"


def test_viewers_expire_without_a_heartbeat():
    v = Viewers()
    assert v.set("u1", "livingroom", "4.1", now=0)
    assert not v.set("u1", "livingroom", "4.1", now=10), "a heartbeat is not a change"
    assert v.snapshot(now=100) == [("livingroom", "4.1")]
    assert v.snapshot(now=200) == [], "no heartbeat for 150 s: not watching"
    assert v.prune(now=200)
    v.set("u2", "kitchen", "4.3", now=0)
    assert v.set("u2", "kitchen", None, now=1) and v.snapshot(now=1) == []


def test_the_transcode_is_720p_h264_aac_and_starts_fast():
    a = " ".join(ffmpeg_args("http://tuner:5004/auto/v4.1", "720"))
    assert "yadif=0:-1:0,scale=-2:720" in a and "-c:v libx264" in a and "-c:a aac" in a
    assert "-probesize 1500000" in a and "-analyzeduration 1000000" in a and "-g 30" in a
    assert "-map 0:v:0 -map 0:a:0" in a and a.endswith("-f mpegts -muxdelay 0 pipe:1")
    assert "scale" not in " ".join(ffmpeg_args("u", "1080"))


def test_sensors_refresh_on_the_event_loop_and_the_map_is_rebuilt():
    import inspect
    from custom_components.hk_frontend.features import live_tv as tv
    from custom_components.hk_frontend.features.live_tv import sensor, stream
    src = inspect.getsource(sensor.NowPlaying.async_added_to_hass)
    assert "@callback" in src and "lambda _now" not in src, "a plain lambda runs in the executor"
    # Entities are found in the registry by unique id -- no in-memory map that
    # a removed entry could leave behind.
    assert "async_get_entity_id" in inspect.getsource(tv.entity_ids)
    assert '"entities"' not in inspect.getsource(tv.async_setup_entry)
    assert "Invalid frame dimensions 0x0" in stream.BENIGN


async def test_a_slow_guide_does_not_hold_up_the_house(hass, base):
    """The first guide is fetched in the background: while a slow one downloads
    (60 s at worst, then a 5 MB parse), the rest of HK Frontend -- the features
    after Live TV, the Seasonal switch -- is already up; the guide lands later."""
    import asyncio
    from unittest.mock import patch
    from homeassistant.helpers import entity_registry as er
    from homeassistant.setup import async_setup_component
    from conftest import DOMAIN, feature_item, house_entry
    reg = er.async_get(hass)
    alarm = reg.async_get_or_create("alarm_control_panel", "lyric", "a1", suggested_object_id="lyric_alarm").entity_id
    hass.states.async_set(alarm, "disarmed", {"supported_features": 3})
    house = house_entry(
        feature_item("live_tv", {"host": "tuner.local", "guide_url": "http://g/x.xml"},
                     {"channels": [{"number": "4.1", "name": "NBC"}], "quality": "720"}),
        feature_item("alarm_pin", {"alarm": alarm},
                     {"arm_required": True, "hash": "00", "salt": "00", "iterations": 1, "numeric": True},
                     title="Lyric Alarm PIN", key=alarm))
    house.add_to_hass(hass)
    gate, called = asyncio.Event(), []

    async def slow(*a, **k):
        called.append(1)
        await gate.wait()
        return b'<?xml version="1.0"?><tv></tv>'

    with patch("custom_components.hk_frontend.features.live_tv.coordinator.async_fetch_guide", side_effect=slow):
        assert await async_setup_component(hass, DOMAIN, {})
        for _ in range(20):
            await asyncio.sleep(0.01)
        pins = [s.entity_id for s in hass.states.async_all("alarm_control_panel") if s.entity_id != alarm]
        assert called, "the guide is being fetched"
        assert pins, "the PIN panel is up while the guide downloads"
        assert hass.states.get("switch.hk_frontend_seasonal_decorations") is not None
        gate.set()
        await hass.async_block_till_done()


class _FakeProc:
    """An ffmpeg as the stream handler sees it."""
    def __init__(self):
        import asyncio
        self.stdout, self.stderr = asyncio.StreamReader(), asyncio.StreamReader()
        self.returncode, self.pid, self.killed = None, 4242, False

    def kill(self):
        self.killed, self.returncode = True, -9
        self.stdout.feed_eof()
        self.stderr.feed_eof()

    async def wait(self):
        return self.returncode


async def _stream_with_failing_prepare(hass, exc):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import MagicMock, patch
    from aiohttp import web
    from custom_components.hk_frontend.features.live_tv.const import DATA
    from custom_components.hk_frontend.features.live_tv.stream import TvStreamView
    hass.data[DATA] = {"entry": SimpleNamespace(options={"channels": [{"number": "4.1", "name": "NBC"}]}),
                       "host": "192.0.2.1", "quality": "720"}
    proc = _FakeProc()

    async def spawn(*a, **k):
        return proc
    req = MagicMock()
    req.remote = "127.0.0.1"
    raised = None
    with patch("asyncio.create_subprocess_exec", spawn), \
            patch.object(web.StreamResponse, "prepare", side_effect=exc):
        try:
            await TvStreamView(hass).get(req, "4.1")
        except BaseException as err:  # noqa: BLE001
            raised = err
    await asyncio.sleep(0)
    return proc, raised


async def test_ffmpeg_is_killed_when_the_viewer_leaves_before_the_first_byte(hass):
    """A client that resets while the response is prepared: ffmpeg is killed
    (it used to run on, holding one of the tuner's two tuners)."""
    proc, _ = await _stream_with_failing_prepare(hass, ConnectionResetError("gone"))
    assert proc.killed


async def test_ffmpeg_is_killed_and_the_cancellation_passes_on(hass):
    import asyncio
    proc, raised = await _stream_with_failing_prepare(hass, asyncio.CancelledError())
    assert proc.killed
    assert isinstance(raised, asyncio.CancelledError), "a cancelled handler stays cancelled"
