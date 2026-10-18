"""The HK Settings page's Live TV page (features/live_tv/settings_ws.py):
the same settings its gear asks for, one change at a time, checked the way
its gear checks them, refused by field and stored where its gear stores
them: the Live TV item of the house's entry (here, a house not set up)."""
import json
from unittest.mock import patch

import pytest

from conftest import DOMAIN, feature_item, house_entry

LINEUP = [{"number": "4.1", "name": "WXXX-DT"}, {"number": "4.3", "name": "WXXXCBS"},
          {"number": "13.1", "name": "ABC"}, {"number": "21.1", "name": "FOX-HD"}]
NETS = {"4.1": "NBC", "4.3": "CBS", "13.1": "ABC", "21.1": "FOX"}
CAT = "custom_components.hk_frontend.features.live_tv.channels.async_catalogue"
DATA = "hk_tv"


class Conn:
    def __init__(self, user):
        self.user, self.sent = user, []

    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "success": True, "result": result})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "success": False, "error": code, "message": message})

    def async_handle_exception(self, msg, err):
        self.sent.append({"id": msg["id"], "success": False, "error": "exception", "message": str(err)})


async def _admin(hass):
    return Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))


def _entry(hass, **opts):
    """The house's entry holding a Live TV item (neither set up); the item,
    as its code sees it."""
    from custom_components.hk_frontend import features as F
    house = house_entry(feature_item("live_tv", {"host": "tuner.local", "guide_url": ""},
                                     {"channels": [{"number": "4.1", "name": "My NBC"}], "quality": "720", **opts}))
    house.add_to_hass(hass)
    (item_id,) = house.subentries
    return F.item(hass, item_id)


async def _call(hass, conn, handler, **msg):
    handler(hass, conn, {"id": len(conn.sent) + 1, **msg})
    await hass.async_block_till_done(wait_background_tasks=True)
    return conn.sent[-1]


async def _get(hass, conn):
    from custom_components.hk_frontend.features.live_tv.settings_ws import ws_settings_get
    return await _call(hass, conn, ws_settings_get, type="hk_tv/settings/get")


async def _set(hass, conn, changes, cat=(LINEUP, NETS), err=None):
    from custom_components.hk_frontend.features.live_tv.settings_ws import ws_settings_set
    hass.data.get(DATA, {}).pop("catalogue", None)
    with patch(CAT, side_effect=err) if err else patch(CAT, return_value=cat):
        return await _call(hass, conn, ws_settings_set, type="hk_tv/settings/set", changes=changes)


async def test_not_set_up_says_so(hass):
    conn = await _admin(hass)
    r = await _get(hass, conn)
    assert r["success"] and r["result"] == {"configured": False}
    r = await _set(hass, conn, {"quality": "1080"})
    assert not r["success"] and r["error"] == "not_set_up" and r["message"] == "Live TV is not added."


async def test_another_features_item_is_not_live_tv(hass):
    house_entry(feature_item("clean_areas", options={"vacuums": []}),
                {"subentry_type": "dashboard", "data": {}, "title": "TV", "unique_id": "dashboard-tv"}
                ).add_to_hass(hass)
    r = await _get(hass, await _admin(hass))
    assert r["result"] == {"configured": False}


async def test_the_page_is_the_tuners_lineup_and_what_is_saved(hass):
    _entry(hass)
    with patch(CAT, return_value=(LINEUP, NETS)):
        r = await _get(hass, await _admin(hass))
    p = r["result"]
    assert p["configured"] and p["quality"] == "720" and p["host"] == "tuner.local"
    assert p["title"] == "Live TV"
    assert p["channels"] == [{"number": "4.1", "name": "My NBC"}]
    assert p["lineup"][0] == {"number": "4.1", "station": "WXXX-DT", "network": "NBC"}
    assert p["lineup_error"] is None


async def test_a_tuner_that_does_not_answer_still_shows_what_is_saved(hass):
    _entry(hass)
    with patch(CAT, side_effect=OSError("no route")):
        r = await _get(hass, await _admin(hass))
    assert r["result"]["lineup"] is None and "didn’t answer" in r["result"]["lineup_error"]
    assert r["result"]["channels"] == [{"number": "4.1", "name": "My NBC"}]


async def test_the_lineup_is_kept_between_visits(hass):
    _entry(hass)
    conn = await _admin(hass)
    with patch(CAT, return_value=(LINEUP, NETS)) as cat:
        await _get(hass, conn)
        await _get(hass, conn)
    assert cat.call_count == 1, "read once, then kept"


async def test_channels_added_and_removed_keep_their_names(hass):
    e, conn = _entry(hass), await _admin(hass)
    r = await _set(hass, conn, {"channels": ["13.1", "4.1"]})
    assert r["success"], r
    assert e.options["channels"] == [{"number": "4.1", "name": "My NBC"}, {"number": "13.1", "name": "ABC"}]
    r = await _set(hass, conn, {"channels": ["13.1"]})
    assert e.options["channels"] == [{"number": "13.1", "name": "ABC"}]
    r = await _set(hass, conn, {"channels": []})
    assert not r["success"] and json.loads(r["message"]) == {"channels": "Choose at least one channel."}
    r = await _set(hass, conn, {"channels": ["99.9"]})
    assert "isn’t a channel" in json.loads(r["message"])["channels"]
    assert e.options["channels"] == [{"number": "13.1", "name": "ABC"}], "a refusal changes nothing"


async def test_a_channel_can_be_renamed(hass):
    e = _entry(hass, channels=[{"number": "4.1", "name": "WXXX-DT"}, {"number": "13.1", "name": "ABC"}])
    conn = await _admin(hass)
    r = await _set(hass, conn, {"names": {"4.1": "  NBC  "}})
    assert r["success"], r
    assert e.options["channels"][0] == {"number": "4.1", "name": "NBC"}
    for bad, why in (({"4.1": ""}, "Give it a name"), ({"4.1": "abc"}, "Another channel"),
                     ({"99.9": "X"}, "isn’t a channel"), ({"4.1": "x" * 41}, "Give it a name")):
        r = await _set(hass, conn, {"names": bad})
        assert not r["success"] and why in json.loads(r["message"])["names"], (bad, r)
    assert e.options["channels"][0]["name"] == "NBC"


async def test_quality_is_one_of_two(hass):
    e, conn = _entry(hass), await _admin(hass)
    assert (await _set(hass, conn, {"quality": "1080"}))["success"]
    assert e.options["quality"] == "1080"
    r = await _set(hass, conn, {"quality": "4k"})
    assert json.loads(r["message"]) == {"quality": "Choose 720p or 1080p."}


async def test_a_new_guide_or_address_is_read_before_it_is_saved(hass):
    e, conn = _entry(hass), await _admin(hass)
    r = await _set(hass, conn, {"guide_url": "ftp://x"})
    assert "http://" in json.loads(r["message"])["guide_url"]
    r = await _set(hass, conn, {"guide_url": "http://g/xmltv.xml"}, cat=(LINEUP, {}))
    assert json.loads(r["message"]) == {"guide_url": "That guide couldn’t be read."}
    assert (await _set(hass, conn, {"guide_url": "http://g/xmltv.xml"}))["success"]
    assert e.data["guide_url"] == "http://g/xmltv.xml"
    assert (await _set(hass, conn, {"guide_url": ""}))["success"] and e.data["guide_url"] == ""
    r = await _set(hass, conn, {"host": "192.0.2.9"}, err=OSError("no route"))
    assert json.loads(r["message"]) == {"host": "The tuner didn’t answer at that address."}
    r = await _set(hass, conn, {"host": "192.0.2.9"}, cat=([], {}))
    assert json.loads(r["message"]) == {"host": "That tuner has no channels."}
    assert e.data["host"] == "tuner.local"
    assert (await _set(hass, conn, {"host": " 192.0.2.9 "}))["success"] and e.data["host"] == "192.0.2.9"
    assert e.data["kind"] == "live_tv", "the item stays a Live TV item"


async def test_unknown_settings_and_non_admins_are_refused(hass):
    _entry(hass)
    r = await _set(hass, await _admin(hass), {"volume": 3})
    assert json.loads(r["message"]) == {"volume": "That setting doesn’t exist."}
    from homeassistant.exceptions import Unauthorized
    user = Conn(await hass.auth.async_create_user("Kitchen"))
    with pytest.raises(Unauthorized):        # the connection answers "unauthorized"
        await _set(hass, user, {"quality": "1080"})


async def test_a_channel_taken_off_the_list_takes_its_entities(hass):
    """Only the item's own: the house's other entities are never touched."""
    from homeassistant.helpers import entity_registry as er
    from custom_components.hk_frontend.features.live_tv import prune_channels
    e = _entry(hass, channels=[{"number": "4.1", "name": "NBC"}])
    reg = er.async_get(hass)
    for uid, dom in ((f"{e.entry_id}_4.1_camera", "camera"), (f"{e.entry_id}_4.1_now", "sensor"),
                     (f"{e.entry_id}_13.1_camera", "camera"), (f"{e.entry_id}_13.1_now", "sensor"),
                     (f"{e.entry_id}_viewers", "sensor")):
        reg.async_get_or_create(dom, DOMAIN, uid, config_entry=e.house, config_subentry_id=e.entry_id)
    switch = reg.async_get_or_create("switch", DOMAIN, f"{e.house.entry_id}_seasonal_decorations",
                                     config_entry=e.house)
    gone = prune_channels(hass, e)
    ours = [x for x in er.async_entries_for_config_entry(reg, e.house.entry_id) if x.config_subentry_id == e.entry_id]
    left = sorted(x.unique_id.split("_", 1)[1] for x in ours)
    assert len(gone) == 2 and left == ["4.1_camera", "4.1_now", "viewers"], (gone, left)
    assert reg.async_get(switch.entity_id) is not None
