"""readproxy.FilteredReads against a fake HA: every read has an RBAC rule; ids the subject may not
view/history are taken out of the request before HA and out of the answer after."""
import pytest
from aiohttp.test_utils import TestServer

from connector_fakes import HA_TOKEN, FakeHa, wait_for
from mantel_server.connectors import Forbidden, Hooks
from mantel_server.readproxy import (READ_ALLOWED, REST_READS, RULES, SUBSCRIBE_TYPES, FilteredReads, ReadBlocked,
                                     ReadProxy, parse_api_path)

# a fictional grant table: (identity, kind) -> the ids it may see
GRANTS = {
    ("adult", "history"): {"light.kitchen", "sensor.temp", "sensor.energy"},
    ("adult", "view"): {"light.kitchen", "weather.home", "media_player.den", "calendar.family", "feature:energy",
                        "feature:notifications", "feature:media", "feature:music", "sensor.grid_in", "sensor.grid_out",
                        "sensor.solar", "sensor.fridge"},
    ("owner", "view"): {"feature:locations"},
}
ASKED = []


def may_read(identity, kind, ids):
    ASKED.append((identity, kind, tuple(ids)))
    return set(ids) & GRANTS.get((identity, kind), set()) | {"sensor.not_asked_for"}   # tries to widen


@pytest.fixture
async def env():
    fake = FakeHa()
    async with TestServer(fake.app()) as server:
        proxy = ReadProxy(str(server.make_url("")).rstrip("/"), HA_TOKEN)
        reads = FilteredReads(lambda: proxy, Hooks(may_read=may_read))
        yield type("Env", (), dict(fake=fake, proxy=proxy, reads=reads))
        await proxy.close()


def sent(fake, t):
    return [f for f in fake.frames if f.get("type") == t]


def test_every_read_has_exactly_one_rule():
    assert set(RULES) == set(READ_ALLOWED)
    assert SUBSCRIBE_TYPES <= set(READ_ALLOWED)
    assert set(REST_READS) == {"calendars"}


async def test_history_request_and_answer_are_filtered(env):
    got = await env.reads.request("adult", {"type": "history/history_during_period", "start_time": "2026-10-18T00:00:00Z",
                                            "entity_ids": ["light.kitchen", "lock.front", "sensor.temp"]})
    assert set(got) == {"light.kitchen", "sensor.temp"}               # HA's extra "sensor.leaked" dropped too
    assert sent(env.fake, "history/history_during_period")[0]["entity_ids"] == ["light.kitchen", "sensor.temp"]
    assert ("adult", "history", ("light.kitchen", "lock.front", "sensor.temp")) in ASKED


async def test_history_with_nothing_allowed_never_reaches_ha(env):
    assert await env.reads.request("guest", {"type": "history/history_during_period", "entity_ids": ["light.kitchen"]}) == {}
    assert env.fake.frames == []


@pytest.mark.parametrize("msg", [
    {"type": "history/history_during_period", "start_time": "x"},           # no entity_ids = the whole house
    {"type": "history/history_during_period", "entity_ids": []},
    {"type": "logbook/get_events", "start_time": "x"},
    {"type": "recorder/statistics_during_period", "statistic_ids": [1]},
    {"type": "history/history_during_period", "entity_ids": ["light.kitchen"], "service": "x"},
    {"type": "call_service", "domain": "lock", "service": "unlock"},
    {"type": "camera/webrtc/offer", "entity_id": "camera.porch", "offer": "v=0"},
    {"type": "weather/subscribe_forecast", "entity_id": "weather.home", "forecast_type": "daily"},  # a subscription
])
async def test_malformed_or_unlisted_reads_are_refused_before_ha(env, msg):
    with pytest.raises(ReadBlocked):
        await env.reads.request("adult", msg)
    assert env.fake.frames == []


async def test_logbook_entries_are_filtered(env):
    got = await env.reads.request("adult", {"type": "logbook/get_events", "start_time": "2026-10-18T00:00:00Z",
                                            "entity_ids": ["light.kitchen", "lock.front"]})
    assert got == [{"when": 1.0, "entity_id": "light.kitchen", "state": "on"}]   # lock row and its context gone
    assert sent(env.fake, "logbook/get_events")[0]["entity_ids"] == ["light.kitchen"]


async def test_statistics_are_filtered(env):
    got = await env.reads.request("adult", {"type": "recorder/statistics_during_period", "start_time": "x",
                                            "statistic_ids": ["sensor.energy", "sensor.secret_lab"], "period": "hour"})
    assert set(got) == {"sensor.energy"}
    assert sent(env.fake, "recorder/statistics_during_period")[0]["statistic_ids"] == ["sensor.energy"]


async def test_energy_needs_the_feature_and_prefs_are_pruned(env):
    with pytest.raises(Forbidden):
        await env.reads.request("guest", {"type": "energy/get_prefs"})
    with pytest.raises(Forbidden):
        await env.reads.request("guest", {"type": "energy/info"})
    assert env.fake.frames == []
    prefs = await env.reads.request("adult", {"type": "energy/get_prefs"})
    assert prefs["device_consumption"] == [{"stat_consumption": "sensor.fridge"}]      # secret_lab pruned
    assert prefs["energy_sources"][0]["flow_from"] == [{"stat_energy_from": "sensor.grid_in", "stat_cost": None}]
    assert await env.reads.request("adult", {"type": "energy/info"}) == {"cost_sensors": {}, "solar_forecast_domains": []}


async def test_get_config_hides_the_homes_location_without_the_feature(env):
    adult = await env.reads.request("adult", {"type": "get_config"})
    assert "latitude" not in adult and "longitude" not in adult and adult["time_zone"] == "UTC"
    owner = await env.reads.request("owner", {"type": "get_config"})
    assert owner["latitude"] == 10.5


async def test_media_browsing_needs_view_and_never_shows_cameras(env):
    with pytest.raises(Forbidden):
        await env.reads.request("adult", {"type": "media_player/browse_media", "entity_id": "media_player.bedroom"})
    got = await env.reads.request("adult", {"type": "media_player/search_media", "entity_id": "media_player.den",
                                            "search_query": "x"})
    assert got["children"][0]["title"] == "Album"
    with pytest.raises(Forbidden):
        await env.reads.request("adult", {"type": "media_source/browse_media",
                                          "media_content_id": "media-source://camera/camera.porch"})
    src = await env.reads.request("adult", {"type": "media_source/browse_media", "media_content_id": "media-source://"})
    assert [c["title"] for c in src["children"]] == ["Photos"]
    with pytest.raises(Forbidden):
        await env.reads.request("guest", {"type": "media_source/browse_media", "media_content_id": "media-source://"})


async def test_weather_forecast_subscription_needs_view(env):
    events = []
    msg = {"type": "weather/subscribe_forecast", "entity_id": "weather.home", "forecast_type": "hourly"}
    with pytest.raises(Forbidden):
        await env.reads.subscribe("guest", msg, events.append)
    assert env.fake.frames == []
    unsub = await env.reads.subscribe("adult", msg, events.append)
    await wait_for(lambda: events)
    assert events[0]["type"] == "hourly"
    await unsub()
    await wait_for(lambda: env.fake.sent_types()[-1] == "unsubscribe_events")


async def test_notifications_need_the_feature(env):
    with pytest.raises(Forbidden):
        await env.reads.subscribe("guest", {"type": "persistent_notification/subscribe"}, lambda e: None)
    unsub = await env.reads.subscribe("adult", {"type": "persistent_notification/subscribe"}, lambda e: None)
    await unsub()


async def test_calendar_events_need_view_and_use_the_one_rest_read(env):
    with pytest.raises(Forbidden):
        await env.reads.calendar_events("guest", "calendar.family", "2026-10-18T00:00:00", "2026-10-25T00:00:00")
    got = await env.reads.calendar_events("adult", "calendar.family", "2026-10-18T00:00:00", "2026-10-25T00:00:00")
    assert got[0]["summary"] == "Fictional event on calendar.family"
    assert env.fake.rest == [("GET", "/api/calendars/calendar.family",
                              {"start": "2026-10-18T00:00:00", "end": "2026-10-25T00:00:00"})]


@pytest.mark.parametrize("method,path", [
    ("POST", "calendars/calendar.family?start=2026-10-18&end=2026-10-19"),
    ("GET", "states/lock.front"),
    ("GET", "calendars/lock.front?start=2026-10-18&end=2026-10-19"),
    ("GET", "calendars/calendar.family/../../services/lock/unlock?start=2026-10-18&end=2026-10-19"),
    ("GET", "calendars/calendar.family?start=2026-10-18&end=2026-10-19&x=1"),
    ("GET", "calendars/calendar.family?start=2026-10-18&end=2026-10-19&end=2026-10-20"),
    ("GET", "calendars/calendar.family?start=tomorrow&end=2026-10-19"),
    ("GET", "http://evil.test/api/calendars/calendar.family?start=2026-10-18&end=2026-10-19"),
    ("GET", "calendars/calendar.family"),
])
def test_read_api_offers_only_get_calendars(method, path):
    with pytest.raises(ReadBlocked):
        parse_api_path(method, path)


def test_read_api_parses_hks_calendar_path():
    assert parse_api_path("GET", "calendars/calendar.family?start=2026-10-18T00%3A00%3A00&end=2026-10-25T00%3A00%3A00") \
        == ("calendar.family", "2026-10-18T00:00:00", "2026-10-25T00:00:00")


async def test_a_hook_cannot_widen_a_read(env):
    got = await env.reads.request("adult", {"type": "history/history_during_period", "entity_ids": ["light.kitchen"]})
    assert set(got) == {"light.kitchen"}                  # "sensor.not_asked_for" from the hook is ignored


async def test_no_hooks_means_deny():
    reads = FilteredReads(lambda: None, None)
    assert await reads.request("owner", {"type": "history/history_during_period", "entity_ids": ["light.a"]}) == {}
    with pytest.raises(Forbidden):
        await reads.request("owner", {"type": "energy/info"})
