"""Mirroring and the actions (slice 9.2): Mantel's entities appear in Home
Assistant under HK Frontend's unique ids and entity ids, on Mantel's devices,
and follow Mantel's pushes; mantel.* and (with no HK Frontend running) the
hk_frontend.* aliases reach Mantel with exactly the data they were called with;
Mantel Link stays dormant while HK Frontend holds the bridge; nothing Mantel
sends can make Home Assistant call anything."""
from __future__ import annotations

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er

from conftest import linked
from mantel_fake import (
    ALARM, ALARM_ITEM, BLACK, CAMERA, ENTRY, FULL, INUSE, PHOTOS, SEASONAL, SLEEP, UIDS, VIEWERS, until,
)

ALL = (BLACK, PHOTOS, SLEEP, INUSE, VIEWERS, CAMERA, ALARM)


def _hk_entry(hass, linked_to=None):
    """HK Frontend's house entry as Home Assistant keeps it (HK Frontend's code
    itself is not needed for these tests: test_handover_hk.py runs the real one)."""
    data = {"mantel_link": {"url": linked_to, "token": "x"}} if linked_to else {}
    e = MockConfigEntry(domain="hk_frontend", entry_id=ENTRY, data=data, title="HK Frontend")
    e.add_to_hass(hass)
    return e


async def test_mantel_s_entities_with_hk_frontend_s_ids_on_mantel_s_devices(hass, mantel):
    e = await linked(hass, mantel)
    await until(hass, lambda: all(hass.states.get(x) for x in ALL))
    reg = er.async_get(hass)
    for eid in ALL:
        ent = reg.async_get(eid)
        assert ent.unique_id == UIDS[eid] and ent.platform == "mantel" and ent.config_entry_id == e.entry_id, eid
    assert hass.states.get(BLACK).attributes["black_screen"] == "hk"
    assert hass.states.get(SLEEP).attributes["why"] == "someone home"
    assert hass.states.get(ALARM).attributes["code_format"] == "number"
    dev = dr.async_get(hass).async_get(reg.async_get(BLACK).device_id)
    assert ("mantel", f"{ENTRY}_hall") in dev.identifiers and dev.name == "Hall"
    assert dev.manufacturer == "Mantel" and dev.model == "Wall Tablet"
    # an entity HK Frontend never had gets Mantel Link's prefix, not HK Frontend's
    assert hass.states.get(SEASONAL) is None
    assert reg.async_get_entity_id("switch", "mantel", UIDS[SEASONAL]) == "switch.mantel_seasonal_decorations"


async def test_an_entity_the_house_has_keeps_its_entity_id(hass, mantel):
    pre = MockConfigEntry(domain="mantel", unique_id="pre")
    pre.add_to_hass(hass)
    er.async_get(hass).async_get_or_create("switch", "mantel", UIDS[BLACK], suggested_object_id="hall_darkness")
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get("switch.hall_darkness") is not None)
    assert hass.states.get(BLACK) is None


async def test_pushes_follow_and_removal(hass, mantel):
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get(BLACK) is not None)
    await mantel.push({"type": "state", "unique_id": UIDS[BLACK], "state": "on",
                       "attributes": {"confirmed": True, "brightness": 12}, "available": True})
    await until(hass, lambda: hass.states.get(BLACK).state == "on")
    assert hass.states.get(BLACK).attributes["brightness"] == 12
    await mantel.push({"type": "state", "unique_id": UIDS[SLEEP], "state": "black", "attributes": {},
                       "available": False})
    await until(hass, lambda: hass.states.get(SLEEP).state == "unavailable")
    # reserved attributes are Home Assistant's own
    await mantel.push({"type": "state", "unique_id": UIDS[INUSE], "state": "on",
                       "attributes": {"friendly_name": "nope", "x": 1}, "available": True})
    await until(hass, lambda: hass.states.get(INUSE).state == "on")
    assert hass.states.get(INUSE).attributes.get("x") == 1 and hass.states.get(INUSE).name != "nope"
    reg = er.async_get(hass)
    # no longer Mantel's (moved back): unavailable, registry entry kept
    await mantel.push({"type": "removed", "unique_id": UIDS[PHOTOS], "forget": False})
    await until(hass, lambda: hass.states.get(PHOTOS) is None or hass.states.get(PHOTOS).state == "unavailable")
    assert reg.async_get(PHOTOS) is not None
    # removed in Mantel (a tablet removed): gone from the registry too
    await mantel.push({"type": "removed", "unique_id": UIDS[INUSE]})
    await until(hass, lambda: reg.async_get(INUSE) is None)


async def test_the_actions_under_both_names_with_exactly_their_data(hass, mantel):
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get(BLACK) is not None)
    for domain in ("mantel", "hk_frontend"):
        mantel.received.clear()
        await hass.services.async_call(domain, "show_popup", {"popup": "doorbell", "dashboards": "dashboard-hall"},
                                       blocking=True)
        await hass.services.async_call(domain, "close_popup", {"popup": "doorbell", "users": ["u1"]}, blocking=True)
        await hass.services.async_call(domain, "set_black_screen", {"entity_id": BLACK, "black": True,
                                                                   "brightness": 174}, blocking=True)
        got = mantel.calls()
        assert [c["service"] for c in got] == ["show_popup", "close_popup", "set_black_screen"], domain
        assert got[0]["data"] == {"popup": "doorbell", "dashboards": ["dashboard-hall"]}
        assert got[1]["data"] == {"popup": "doorbell", "users": ["u1"]}
        assert got[2]["data"] == {"black": True, "brightness": 174}
        assert got[2]["targets"] == [{"entity_id": BLACK, "unique_id": UIDS[BLACK]}]
    # notify answers
    async def answer(ws, msg):
        return {"id": msg["id"], "type": "result", "success": True, "result": {"id": "n1", "snap": False}}
    mantel.answer = answer
    for domain in ("mantel", "hk_frontend"):
        r = await hass.services.async_call(domain, "notify", {"title": "Laundry", "message": "Done"},
                                           blocking=True, return_response=True)
        assert r == {"id": "n1", "snap": False}
        assert mantel.calls()[-1]["data"] == {"title": "Laundry", "message": "Done", "important": False,
                                              "wake": False, "dashboards": [], "users": []}
    # a target that isn't Mantel's is skipped by the alias, as HA skips unknown targets
    mantel.received.clear()
    await hass.services.async_call("hk_frontend", "set_black_screen", {"entity_id": "switch.nope", "black": True},
                                   blocking=True)
    assert mantel.calls() == []


async def test_refusals_say_whose_and_why(hass, mantel):
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get(BLACK) is not None)

    async def refuse(ws, msg):
        code = "unknown_popup" if msg["data"].get("popup") == "nope" else "internal"
        return {"id": msg["id"], "type": "result", "success": False, "error": {"code": code, "message": "no"}}
    mantel.answer = refuse
    with pytest.raises(ServiceValidationError, match="Mantel refused hk_frontend.show_popup: no"):
        await hass.services.async_call("hk_frontend", "show_popup", {"popup": "nope"}, blocking=True)
    with pytest.raises(HomeAssistantError, match="Mantel refused mantel.show_popup"):
        await hass.services.async_call("mantel", "show_popup", {"popup": "x"}, blocking=True)
    await mantel.drop()
    await until(hass, lambda: hass.states.get(BLACK).state == "unavailable")
    with pytest.raises(HomeAssistantError, match="not connected"):
        await hass.services.async_call("mantel", "show_popup", {"popup": "x"}, blocking=True)


async def test_frames_that_could_act_on_home_assistant_do_nothing(hass, mantel):
    calls = []
    hass.services.async_register("light", "turn_on", lambda c: calls.append(c))
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get(BLACK) is not None)
    for msg in ({"type": "call_service", "domain": "light", "service": "turn_on"},
                {"type": "fire_event", "event_type": "x"}, {"type": "execute_script", "sequence": []}):
        await mantel.push(msg)
    await hass.async_block_till_done()
    assert calls == []


async def test_dormant_while_hk_frontend_holds_the_bridge(hass, mantel):
    _hk_entry(hass, linked_to="https://mantel.example")
    mantel.owners = {"house": "mantel", "tablets": ["hall"], "bridge": "hk_frontend"}
    e = await linked(hass, mantel)
    bridge = e.runtime_data
    assert bridge.state == "dormant"
    await until(hass, lambda: mantel.reports)
    assert mantel.reports[-1] == {"hk_frontend": {"installed": True, "loaded": False, "linked": True}, "phones": []}
    await hass.async_block_till_done()
    assert all(hass.states.get(x) is None for x in ALL)
    assert all(er.async_get(hass).async_get(x) is None for x in ALL)
    # its actions still reach Mantel
    await hass.services.async_call("mantel", "show_popup", {"popup": "doorbell"}, blocking=True)
    assert mantel.calls()[-1]["service"] == "show_popup"


async def test_hk_frontend_removed_mantel_link_mirrors(hass, mantel):
    hk = _hk_entry(hass)
    mantel.owners = {"house": "mantel", "tablets": ["hall"], "bridge": "hk_frontend"}
    e = await linked(hass, mantel)
    assert e.runtime_data.state == "dormant"
    await hass.config_entries.async_remove(hk.entry_id)
    await until(hass, lambda: hass.states.get(BLACK) is not None and hass.states.get(BLACK).state == "off")
    assert e.runtime_data.state == "mirroring"


async def test_hk_frontends_leftover_actions_are_taken_over_when_it_is_removed(hass, mantel):
    """HK Frontend registers show_popup and friends once, when Home Assistant loads it, and they stay until a
    restart. Removing its entry leaves them with nothing behind them, so Mantel Link takes the names at once;
    while an entry is still there (merely not loaded) they stay HK Frontend's."""
    hk = _hk_entry(hass)
    stale = []

    async def leftover(call):
        stale.append(call.service)
        raise HomeAssistantError("No pop-up #doorbell (HK Frontend has no entry)")
    for service in ("show_popup", "close_popup"):
        hass.services.async_register("hk_frontend", service, leftover)
    mantel.owners = FULL
    await linked(hass, mantel)
    await hass.async_block_till_done()
    with pytest.raises(HomeAssistantError, match="HK Frontend has no entry"):
        await hass.services.async_call("hk_frontend", "show_popup", {"popup": "doorbell"}, blocking=True)
    await hass.config_entries.async_remove(hk.entry_id)
    await hass.async_block_till_done()
    await hass.services.async_call("hk_frontend", "show_popup", {"popup": "doorbell"}, blocking=True)
    assert mantel.calls()[-1]["service"] == "show_popup" and stale == ["show_popup"]


async def test_only_the_units_mantel_owns(hass, mantel):
    mantel.owners = {"house": "ha", "tablets": ["hall"], "bridge": "mantel"}
    await linked(hass, mantel)
    await until(hass, lambda: hass.states.get(BLACK) is not None)
    await hass.async_block_till_done()
    assert hass.states.get(SLEEP) is not None and hass.states.get(VIEWERS) is None and hass.states.get(ALARM) is None
    # Mantel moves the tablet back: told first, then the entities go (kept in the registry)
    mantel.owners = {"house": "ha", "tablets": [], "bridge": "mantel"}
    await mantel.push({"type": "owners", "owners": mantel.owners})
    await until(hass, lambda: hass.states.get(BLACK) is None or hass.states.get(BLACK).state == "unavailable")
    assert er.async_get(hass).async_get(BLACK) is not None
    e = hass.config_entries.async_entries("mantel")[0]
    await until(hass, lambda: e.data["owners"] == {"house": "ha", "tablets": [], "bridge": "mantel"})


async def test_a_restart_without_mantel_keeps_the_last_word(hass, mantel):
    e = await linked(hass, mantel, owners=FULL)
    await until(hass, lambda: hass.states.get(BLACK) is not None)
    await mantel.close()
    assert await hass.config_entries.async_reload(e.entry_id)
    await hass.async_block_till_done()
    assert e.data["owners"] == FULL and e.runtime_data.state == "mirroring"
