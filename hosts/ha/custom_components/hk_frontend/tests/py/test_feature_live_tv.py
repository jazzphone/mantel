"""Live TV, a feature of HK Frontend: added from Add feature (the tuner, then
its channels) as an item of the house's entry, its gear, the entities and the
guide card's commands, and a Live TV entry of a pre-release of 1.0 folded
into the house's entry with its entity ids."""
from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

import pytest

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
import homeassistant.util.dt as dt_util

from conftest import (DOMAIN, entry, feature_entries, feature_gear, feature_item, house_entry,
                      pre_release_entry, put_feature, update_feature)

LINEUP = [{"number": "4.1", "name": "WXXX-DT", "hd": True}, {"number": "4.3", "name": "WXXXCBS", "hd": True},
          {"number": "13.1", "name": "ABC", "hd": True}, {"number": "21.1", "name": "FOX-HD", "hd": True}]
NETS = {"4.1": "NBC", "4.3": "CBS", "13.1": "ABC", "21.1": "FOX"}
PKG = "custom_components.hk_frontend.features.live_tv"
# the tuner and the guide, as the flows and the settings page read them
CAT = f"{PKG}.channels.async_catalogue"
# the guide, as the running feature reads it (never fetched here)
GUIDE = f"{PKG}.coordinator.async_fetch_guide"
EMPTY_GUIDE = b'<?xml version="1.0"?><tv></tv>'
SETUP = f"{PKG}.async_setup_entry"


class Conn:
    def __init__(self, user):
        self.user, self.sent, self.subscriptions = user, [], {}

    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "success": True, "result": result})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "success": False, "error": code, "message": message})


async def _add(hass, **opts):
    """A Live TV item written into the house's entry (and so started), as
    Add feature makes it."""
    return await put_feature(hass, "live_tv", {"host": "tuner.local", "guide_url": ""},
                             {"channels": [{"number": "4.1", "name": "NBC"}], "quality": "720", **opts})


async def _start(hass):
    """Add feature -> Live TV: its first form."""
    flows = hass.config_entries.subentries
    r = await flows.async_init((entry(hass).entry_id, "feature"), context={"source": config_entries.SOURCE_USER})
    assert r["type"] == "menu" and "live_tv" in r["menu_options"], r
    return await flows.async_configure(r["flow_id"], {"next_step_id": "live_tv"})


async def test_setup_picks_channels_from_the_tuner(hass, frontend):
    flows = hass.config_entries.subentries
    with patch(CAT, return_value=(LINEUP, NETS)):
        r = await _start(hass)
        assert r["step_id"] == "live_tv"
        r = await flows.async_configure(r["flow_id"], {"host": " 192.0.2.50 ", "guide_url": "http://g/xmltv.xml"})
        assert r["step_id"] == "live_tv_channels"
        assert r["data_schema"].schema
        r2 = await flows.async_configure(r["flow_id"], {"channels": [], "quality": "720"})
        assert r2["errors"] == {"base": "live_tv_pick_one"}
        with patch(GUIDE, return_value=EMPTY_GUIDE):
            r = await flows.async_configure(r["flow_id"], {"channels": ["21.1", "4.1"], "quality": "720"})
            await hass.async_block_till_done()
    assert r["type"] is FlowResultType.CREATE_ENTRY and r["title"] == "Live TV"
    assert r["data"] == {"kind": "live_tv", "data": {"host": "192.0.2.50", "guide_url": "http://g/xmltv.xml"},
                         "options": {"channels": [{"number": "4.1", "name": "NBC"}, {"number": "21.1", "name": "FOX"}],
                                     "quality": "720"}}
    (e,) = feature_entries(hass, "live_tv")
    assert e.unique_id == "feature:live_tv" and e.state is config_entries.ConfigEntryState.LOADED
    assert e.data == {"kind": "live_tv", "host": "192.0.2.50", "guide_url": "http://g/xmltv.xml"}
    assert e.options["channels"] == [{"number": "4.1", "name": "NBC"}, {"number": "21.1", "name": "FOX"}]
    assert e.options["quality"] == "720"
    # one per house: the menu no longer offers it
    r = await flows.async_init((frontend.entry_id, "feature"), context={"source": config_entries.SOURCE_USER})
    assert "live_tv" not in r["menu_options"] and "alarm_pin" in r["menu_options"]
    flows.async_abort(r["flow_id"])


async def test_an_unreachable_tuner_says_so(hass, frontend):
    flows = hass.config_entries.subentries
    r = await _start(hass)
    with patch(CAT, side_effect=OSError("no route")):
        r = await flows.async_configure(r["flow_id"], {"host": "192.0.2.9", "guide_url": ""})
    assert r["step_id"] == "live_tv" and r["errors"] == {"host": "live_tv_cannot_connect"}
    with patch(CAT, return_value=([], {})):
        r = await flows.async_configure(r["flow_id"], {"host": "192.0.2.9", "guide_url": ""})
    assert r["errors"] == {"host": "live_tv_no_channels"}
    with patch(CAT, return_value=(LINEUP, {})):
        r = await flows.async_configure(r["flow_id"], {"host": "192.0.2.9", "guide_url": "http://g"})
    assert r["errors"] == {"guide_url": "live_tv_guide_failed"}
    flows.async_abort(r["flow_id"])
    assert not feature_entries(hass, "live_tv")


async def test_its_gear_adds_and_removes_channels(hass, frontend):
    """The channels, the quality and the guide, saved in ONE write: the
    feature restarts once, with all of them."""
    from custom_components.hk_frontend.features import live_tv
    e = await _add(hass, channels=[{"number": "4.1", "name": "My NBC"}])
    flows = hass.config_entries.subentries
    with patch(CAT, return_value=(LINEUP, NETS)), patch(GUIDE, return_value=EMPTY_GUIDE), \
            patch(SETUP, side_effect=live_tv.async_setup_entry) as setup:
        r = await feature_gear(hass, e)
        assert r["type"] == "form" and r["step_id"] == "live_tv_options"
        r2 = await flows.async_configure(r["flow_id"], {"channels": [], "quality": "720", "guide_url": ""})
        assert r2["errors"] == {"base": "live_tv_pick_one"}
        r = await flows.async_configure(
            r["flow_id"], {"channels": ["4.1", "13.1"], "quality": "1080", "guide_url": " http://g/x.xml "})
        await hass.async_block_till_done()
    assert r["type"] is FlowResultType.ABORT and r["reason"] == "reconfigure_successful"
    assert e.options["channels"] == [{"number": "4.1", "name": "My NBC"},
                                     {"number": "13.1", "name": "ABC"}], "kept name, new channel added"
    assert e.options["quality"] == "1080"
    assert e.data["guide_url"] == "http://g/x.xml" and e.data["kind"] == "live_tv", "the guide is the item's data"
    assert setup.call_count == 1, "one restart"
    assert hass.states.get("camera.tv_abc") is not None, "the new channel's camera"


async def test_its_gear_says_when_the_tuner_does_not_answer(hass, frontend):
    e = await _add(hass)
    with patch(CAT, side_effect=OSError("no route")):
        r = await feature_gear(hass, e)
    assert r["type"] is FlowResultType.ABORT and r["reason"] == "live_tv_cannot_connect"


async def test_the_channels_are_entities_the_guide_card_finds(hass, frontend):
    from custom_components.hk_frontend.features.live_tv import ws_channels
    conn = Conn(await hass.auth.async_create_user("Kitchen"))
    ws_channels(hass, conn, {"id": 1, "type": "hk_tv/channels"})
    assert conn.sent[-1]["result"] == {"configured": False, "channels": []}, "not added yet"

    e = await _add(hass, channels=[{"number": "4.1", "name": "NBC"}, {"number": "13.1", "name": "ABC"}])
    assert e.state is config_entries.ConfigEntryState.LOADED
    reg = er.async_get(hass)
    for eid, uid in (("camera.tv_nbc", f"{e.entry_id}_4.1_camera"), ("sensor.tv_nbc_now", f"{e.entry_id}_4.1_now"),
                     ("camera.tv_abc", f"{e.entry_id}_13.1_camera"), ("sensor.tv_viewers", f"{e.entry_id}_viewers")):
        ent = reg.async_get(eid)
        assert ent and ent.platform == DOMAIN and ent.unique_id == uid, eid
        assert ent.config_entry_id == frontend.entry_id and ent.config_subentry_id == e.entry_id, eid
        assert hass.states.get(eid) is not None, eid
    assert hass.states.get("sensor.tv_nbc_now").state == "Live", "no guide: the channel still plays"
    # the two platforms load side by side, so a first "now" state may be
    # written before its camera is registered; the minute's refresh has it
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=61))
    await hass.async_block_till_done()
    now = hass.states.get("sensor.tv_nbc_now")
    assert now.attributes["camera"] == "camera.tv_nbc" and now.attributes["network"] == "NBC"
    assert hass.states.get("camera.tv_nbc").attributes["channel"] == "4.1"

    ws_channels(hass, conn, {"id": 2, "type": "hk_tv/channels"})
    assert conn.sent[-1]["result"] == {"configured": True, "channels": [
        {"number": "4.1", "name": "NBC", "camera": "camera.tv_nbc", "now": "sensor.tv_nbc_now"},
        {"number": "13.1", "name": "ABC", "camera": "camera.tv_abc", "now": "sensor.tv_abc_now"}]}

    # the stream the cameras name, and the view that serves it
    cam = hass.data["camera"].get_entity("camera.tv_nbc")
    assert await cam.stream_source() == "http://127.0.0.1:8123/api/hk_tv/stream/4.1"
    views = [c.args[0] for c in hass.http.register_view.call_args_list]
    tv = next(v for v in views if v.url == "/api/hk_tv/stream/{channel}")
    assert tv.name == "hk_frontend:live_tv_stream" and not tv.requires_auth
    assert [v.name for v in views].count(tv.name) == 1, "its own name"

    # a channel taken off the list goes, with its "now" sensor, on the restart
    update_feature(hass, e, options={**e.options, "channels": [{"number": "4.1", "name": "NBC"}]})
    await hass.async_block_till_done()
    (e,) = feature_entries(hass, "live_tv")                       # restarted: the running one
    assert e.state is config_entries.ConfigEntryState.LOADED
    assert reg.async_get("camera.tv_abc") is None and reg.async_get("sensor.tv_abc_now") is None
    assert reg.async_get("camera.tv_nbc") and reg.async_get("sensor.tv_viewers")
    assert hass.states.get("camera.tv_nbc") is not None, "the channel it kept is back"

    assert await hass.config_entries.async_unload(frontend.entry_id)
    ws_channels(hass, conn, {"id": 3, "type": "hk_tv/channels"})
    assert conn.sent[-1]["result"]["configured"] is False


async def test_a_screen_watching_counts_as_a_viewer(hass, frontend):
    from custom_components.hk_frontend.features.live_tv import ws_watching
    await _add(hass)
    assert hass.states.get("sensor.tv_viewers").state == "0"
    conn = Conn(await hass.auth.async_create_user("Kitchen"))
    ws_watching(hass, conn, {"id": 1, "type": "hk_tv/watching", "channel": "4.1"})
    await hass.async_block_till_done()
    assert conn.sent[-1]["result"] == {"viewers": ["Kitchen"]}
    st = hass.states.get("sensor.tv_viewers")
    assert st.state == "1" and st.attributes["users"] == ["Kitchen"] and st.attributes["channels"] == ["4.1"]
    ws_watching(hass, conn, {"id": 2, "type": "hk_tv/watching", "channel": None})
    await hass.async_block_till_done()
    assert hass.states.get("sensor.tv_viewers").state == "0"


async def test_the_screens_commands_keep_their_names(hass, frontend):
    from homeassistant.components.websocket_api.const import DOMAIN as WS
    handlers = hass.data[WS]
    for cmd in ("hk_tv/channels", "hk_tv/watching", "hk_tv/settings/get", "hk_tv/settings/set"):
        assert cmd in handlers, cmd


async def test_a_pre_release_live_tv_entry_is_folded_with_its_entity_ids(hass, base):
    """A Live TV of a pre-release of 1.0 (an entry of its own) becomes an
    item of the house's entry at start, with the entry's id: its channels'
    entities move to the house's entry with the same entity ids and unique
    ids, and are live."""
    from custom_components.hk_frontend import features as F
    from custom_components.hk_frontend.features.live_tv import ws_channels
    house = house_entry()
    house.add_to_hass(hass)
    old = pre_release_entry("live_tv", {"host": "tuner.local", "guide_url": ""},
                            {"channels": [{"number": "4.1", "name": "NBC"}], "quality": "1080"}, unique_id="live_tv")
    old.add_to_hass(hass)
    reg = er.async_get(hass)
    made = {
        "camera": reg.async_get_or_create("camera", DOMAIN, f"{old.entry_id}_4.1_camera", config_entry=old,
                                          suggested_object_id="tv_nbc"),
        "now": reg.async_get_or_create("sensor", DOMAIN, f"{old.entry_id}_4.1_now", config_entry=old,
                                       suggested_object_id="tv_nbc_now"),
        "viewers": reg.async_get_or_create("sensor", DOMAIN, f"{old.entry_id}_viewers", config_entry=old,
                                           suggested_object_id="tv_viewers"),
    }
    assert made["viewers"].entity_id == "sensor.tv_viewers"
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()

    (e,) = feature_entries(hass, "live_tv")
    assert e.entry_id == old.entry_id and e.title == "Live TV" and e.unique_id == F.unique_id("live_tv")
    assert e.state is config_entries.ConfigEntryState.LOADED
    assert dict(house.subentries[e.entry_id].data) == F.item_data("live_tv", old.data, old.options)
    assert e.options == {"channels": [{"number": "4.1", "name": "NBC"}], "quality": "1080"}
    assert e.data == {"kind": "live_tv", "host": "tuner.local", "guide_url": ""}
    assert hass.config_entries.async_get_entry(old.entry_id) is None, "the old entry is gone"
    for key, uid in (("camera", f"{e.entry_id}_4.1_camera"), ("now", f"{e.entry_id}_4.1_now"),
                     ("viewers", f"{e.entry_id}_viewers")):
        ent = reg.async_get(made[key].entity_id)
        assert ent is not None, f"{made[key].entity_id} survived"
        assert ent.platform == DOMAIN and ent.unique_id == uid, ent
        assert ent.config_entry_id == house.entry_id and ent.config_subentry_id == e.entry_id, ent
    # the same entity ids, live on the house's entry -- no "_2" twins
    assert hass.states.get("sensor.tv_viewers").state == "0"
    assert hass.states.get("camera.tv_nbc") is not None
    assert not [x for x in hass.states.async_entity_ids() if x.endswith("_2")]
    conn = Conn(await hass.auth.async_create_user("Kitchen"))
    ws_channels(hass, conn, {"id": 1, "type": "hk_tv/channels"})
    assert conn.sent[-1]["result"]["channels"] == [
        {"number": "4.1", "name": "NBC", "camera": "camera.tv_nbc", "now": "sensor.tv_nbc_now"}]
    # and only once
    assert await hass.config_entries.async_reload(house.entry_id)
    await hass.async_block_till_done()
    assert len(feature_entries(hass, "live_tv")) == 1
    assert not [x for x in hass.states.async_entity_ids() if x.endswith("_2")]


async def test_a_pre_release_entry_is_not_folded_over_a_live_tv_already_added(hass, base):
    """One per house: the house's own Live TV stays, and HK Frontend still
    starts."""
    house = house_entry(feature_item("live_tv", {"host": "tuner.local", "guide_url": ""},
                                     {"channels": [{"number": "4.1", "name": "NBC"}], "quality": "720"}))
    house.add_to_hass(hass)
    pre_release_entry("live_tv", {"host": "old.local", "guide_url": ""}, {"channels": [], "quality": "720"},
                      unique_id="live_tv").add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    assert house.state is config_entries.ConfigEntryState.LOADED
    (e,) = feature_entries(hass, "live_tv")
    assert e.data["host"] == "tuner.local"
