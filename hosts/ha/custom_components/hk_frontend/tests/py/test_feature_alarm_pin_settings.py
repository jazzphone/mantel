"""HK Settings' Alarm PIN page (features/alarm_pin/settings_ws.py): every
alarm that has a PIN, a new PIN typed twice, the arm rule, another alarm,
adding and removing -- checked by the same helpers as the feature's dialogs,
refused by field, never sending a PIN back, and never touching an item or an
entry that is not an Alarm PIN."""
from __future__ import annotations

import json

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.helpers import entity_registry as er

from conftest import add_feature, entry, feature_entries
from test_feature_alarm_pin import ALARM, OTHER, two_alarms


@pytest.fixture
async def alarms(hass):
    return await two_alarms(hass)


class Conn:
    def __init__(self, user):
        self.user, self.sent = user, []

    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "success": True, "result": result})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "success": False, "error": code, "message": message})


def pins(hass):
    return feature_entries(hass, "alarm_pin")


def pin(hass, item_id):
    """One Alarm PIN, by its item's id (None once it is gone)."""
    from custom_components.hk_frontend import features as F
    return F.item(hass, item_id)


def no_flow_open(hass):
    return not hass.config_entries.flow.async_progress() and not hass.config_entries.subentries.async_progress()


async def _admin(hass):
    return Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))


async def _call(hass, conn, handler, **msg):
    handler(hass, conn, {"id": len(conn.sent) + 1, **msg})
    await hass.async_block_till_done(wait_background_tasks=True)
    return conn.sent[-1]


async def _add(hass, conn, alarm, pin="4321", again=None, arm=True):
    from custom_components.hk_frontend.features.alarm_pin.settings_ws import ws_add
    return await _call(hass, conn, ws_add, type="hk_alarm_pin/add", alarm=alarm, pin=pin,
                       pin_again=pin if again is None else again, arm_required=arm)


async def _get(hass, conn):
    from custom_components.hk_frontend.features.alarm_pin.settings_ws import ws_settings_get
    return (await _call(hass, conn, ws_settings_get, type="hk_alarm_pin/settings/get"))["result"]


async def _set(hass, conn, entry_id, changes):
    from custom_components.hk_frontend.features.alarm_pin.settings_ws import ws_settings_set
    return await _call(hass, conn, ws_settings_set, type="hk_alarm_pin/settings/set", entry_id=entry_id,
                       changes=changes)


async def _remove(hass, conn, entry_id):
    from custom_components.hk_frontend.features.alarm_pin.settings_ws import ws_remove
    return await _call(hass, conn, ws_remove, type="hk_alarm_pin/remove", entry_id=entry_id)


async def _works(hass, entity, code):
    """Does `code` arm-then-disarm the PIN panel? (the real panel, real alarm)"""
    try:
        await hass.services.async_call("alarm_control_panel", "alarm_arm_away",
                                       {"entity_id": entity, "code": code}, blocking=True)
        await hass.async_block_till_done()
        await hass.services.async_call("alarm_control_panel", "alarm_disarm",
                                       {"entity_id": entity, "code": code}, blocking=True)
        await hass.async_block_till_done()
        return True
    except Exception:  # noqa: BLE001
        return False


async def test_add_through_the_page_is_the_features_own_add(hass, alarms, frontend):
    conn = await _admin(hass)
    assert (await _get(hass, conn))["configured"] is False
    r = await _add(hass, conn, ALARM, pin="12")
    assert json.loads(r["message"]) == {"pin": "Use at least 4 characters."}
    r = await _add(hass, conn, ALARM, pin="4321", again="4312")
    assert "don’t match" in json.loads(r["message"])["pin_again"]
    assert not pins(hass), "a refusal adds nothing"
    assert no_flow_open(hass), "and leaves no flow open"
    r = await _add(hass, conn, ALARM)
    assert r["success"], r
    p = r["result"]
    a = p["alarms"][0]
    assert a["alarm"] == ALARM and a["pin_set"] and a["arm_required"] and a["panel"].startswith("alarm_control_panel.")
    assert "4321" not in json.dumps(p) and "hash" not in json.dumps(p), "a PIN is never sent back"
    assert {c["entity_id"]: c["entry"] for c in p["choices"]} == {ALARM: a["entry_id"], OTHER: None}, "its own panel is no choice"
    (e,) = pins(hass)
    assert e.entry_id == a["entry_id"] and e.unique_id == "feature:alarm_pin:alarm_control_panel.home_alarm"
    assert a["title"] == "Home Alarm PIN" and a["state"] == "loaded"
    r = await _add(hass, conn, ALARM)
    assert json.loads(r["message"]) == {"alarm": "That alarm already has a PIN."}
    r = await _add(hass, conn, a["panel"])
    assert "own panels" in json.loads(r["message"])["alarm"]
    r = await _add(hass, conn, "alarm_control_panel.nowhere")
    assert json.loads(r["message"]) == {"alarm": "That isn’t an alarm panel in this house."}
    assert no_flow_open(hass)
    assert await _works(hass, a["panel"], "4321")


async def test_add_without_the_house_entry_is_refused(hass, base, alarms):
    """Add feature would add HK Frontend itself: refused, and no flow is left open."""
    conn = await _admin(hass)
    r = await _add(hass, conn, ALARM)
    assert not r["success"] and "HK Frontend" in json.loads(r["message"])["alarm"]
    assert not hass.config_entries.async_entries("hk_frontend")
    assert no_flow_open(hass)


async def test_a_new_pin_typed_twice_and_the_arm_rule(hass, alarms, frontend):
    conn = await _admin(hass)
    a = (await _add(hass, conn, ALARM))["result"]["alarms"][0]
    r = await _set(hass, conn, a["entry_id"], {"pin": "9999"})
    assert "don’t match" in json.loads(r["message"])["pin_again"], "typed once is refused"
    r = await _set(hass, conn, a["entry_id"], {"pin": "99", "pin_again": "99"})
    assert "at least 4" in json.loads(r["message"])["pin"]
    assert await _works(hass, a["panel"], "4321"), "a refusal keeps the old PIN"
    r = await _set(hass, conn, a["entry_id"], {"pin": "9876", "pin_again": "9876"})
    assert r["success"] and "9876" not in json.dumps(r["result"])
    assert await _works(hass, a["panel"], "9876") and not await _works(hass, a["panel"], "4321")
    r = await _set(hass, conn, a["entry_id"], {"arm_required": False})
    assert r["success"] and r["result"]["alarms"][0]["arm_required"] is False
    assert pin(hass, a["entry_id"]).options["arm_required"] is False
    assert await _works(hass, a["panel"], "9876"), "the PIN survives an arm-rule change"
    r = await _set(hass, conn, a["entry_id"], {"arm_required": "yes"})
    assert json.loads(r["message"]) == {"arm_required": "Choose on or off."}
    r = await _set(hass, conn, a["entry_id"], {"code": "1"})
    assert json.loads(r["message"]) == {"code": "That setting doesn’t exist."}


async def test_another_alarm_keeps_the_pin(hass, alarms, frontend):
    conn = await _admin(hass)
    a = (await _add(hass, conn, ALARM))["result"]["alarms"][0]
    r = await _set(hass, conn, a["entry_id"], {"alarm": OTHER})
    assert r["success"], r
    e = pin(hass, a["entry_id"])
    assert e.data == {"kind": "alarm_pin", "alarm": OTHER} and e.title == "garage PIN"
    assert e.unique_id == "feature:alarm_pin:alarm_control_panel.garage"
    assert r["result"]["alarms"][0]["panel"] == a["panel"], "the same panel"
    assert await _works(hass, a["panel"], "4321")
    assert hass.states.get(OTHER).state == "disarmed"
    r = await _set(hass, conn, a["entry_id"], {"alarm": a["panel"]})
    assert "own panels" in json.loads(r["message"])["alarm"]
    b = (await _add(hass, conn, ALARM, pin="1111"))["result"]
    r = await _set(hass, conn, a["entry_id"], {"alarm": ALARM})
    assert json.loads(r["message"]) == {"alarm": "That alarm already has a PIN."}
    assert len(b["alarms"]) == 2


async def test_remove_takes_the_pin_off_that_alarm(hass, alarms, frontend):
    conn = await _admin(hass)
    a = (await _add(hass, conn, ALARM))["result"]["alarms"][0]
    r = await _remove(hass, conn, a["entry_id"])
    assert r["success"] and r["result"]["alarms"] == []
    assert not pins(hass) and a["entry_id"] not in entry(hass).subentries
    assert er.async_get(hass).async_get(a["panel"]) is None, "its panel goes with it"
    r = await _remove(hass, conn, a["entry_id"])
    assert json.loads(r["message"]) == {"entry_id": "That alarm has no PIN anymore."}


async def test_it_never_touches_an_item_or_entry_that_is_not_an_alarm_pin(hass, alarms, frontend):
    """The house's entry, another feature's item, another integration's
    entry: refused as "no PIN", and left as they were."""
    conn = await _admin(hass)
    house = entry(hass)
    await add_feature(hass, "clean_areas", {})
    (clean,) = feature_entries(hass, "clean_areas")
    other = MockConfigEntry(domain="hk_alarm_pin", title="Home Alarm", data={"alarm": ALARM})
    other.add_to_hass(hass)
    for eid in (house.entry_id, clean.entry_id, other.entry_id):
        r = await _set(hass, conn, eid, {"arm_required": False})
        assert json.loads(r["message"]) == {"entry_id": "That alarm has no PIN anymore."}
        r = await _remove(hass, conn, eid)
        assert json.loads(r["message"]) == {"entry_id": "That alarm has no PIN anymore."}
    assert hass.config_entries.async_get_entry(house.entry_id) is not None
    assert hass.config_entries.async_get_entry(other.entry_id) is not None
    assert clean.entry_id in house.subentries and "arm_required" not in clean.options
    assert "arm_required" not in house.options


async def test_only_an_admin(hass, alarms, frontend):
    from custom_components.hk_frontend.features.alarm_pin.settings_ws import ws_settings_get
    from homeassistant.exceptions import Unauthorized
    await hass.auth.async_create_user("Owner")
    with pytest.raises(Unauthorized):
        await _call(hass, Conn(await hass.auth.async_create_user("Kitchen")), ws_settings_get,
                    type="hk_alarm_pin/settings/get")


async def test_the_add_reply_waits_for_the_new_panel(hass, alarms, frontend, monkeypatch):
    """The page shows what the reply says: a PIN whose panel was still
    starting (a slow first import on a real server) came back with no panel
    and `not_loaded`. The reply now waits for the house to follow its items."""
    import asyncio
    from custom_components.hk_frontend import features as F
    from custom_components.hk_frontend.features.alarm_pin.settings_ws import ws_add
    real = F._start

    async def slow(hass_, house, item_id):
        await asyncio.sleep(0.3)
        return await real(hass_, house, item_id)
    monkeypatch.setattr(F, "_start", slow)
    conn = await _admin(hass)
    ws_add(hass, conn, {"id": 1, "type": "hk_alarm_pin/add", "alarm": ALARM,
                        "pin": "4321", "pin_again": "4321", "arm_required": True})
    for _ in range(300):                 # the reply as sent, before anything else settles
        if conn.sent:
            break
        await asyncio.sleep(0.01)
    a = conn.sent[0]["result"]["alarms"][0]
    await hass.async_block_till_done(wait_background_tasks=True)
    assert a["panel"] and a["state"] == "loaded", a
