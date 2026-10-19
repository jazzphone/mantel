"""Linked to Mantel Server (linked_mode.py, mantel_link.py), against a stand-in
Mantel endpoint (mantel_fake.py): off by default and nothing changes without
it; linked, the same actions are forwarded with exactly the data they were
called with, Mantel's entities appear with the same unique ids and entity ids
and follow its pushes, the black screen's `confirmed` handshake holds, the
link reconnects, and a call fails clearly when Mantel is away or slow."""
from __future__ import annotations

import asyncio
import logging

import pytest

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er

from conftest import entry, house_entry
from mantel_fake import (
    ALARM, ALARM_ITEM, BLACK, CAMERA, ENTRY, FULL, INUSE, PHOTOS, SLEEP, TOKEN, VIEWERS, FakeMantel, until,
)

DOMAIN = "hk_frontend"
LINK = "mantel_link"
OWNERS = "mantel_owners"


@pytest.fixture
async def mantel(socket_enabled):
    fake = await FakeMantel().start()
    yield fake
    await fake.close()


async def _linked(hass, mantel, *items, token=TOKEN, wait=True, owners=FULL):
    """The house's entry, linked to the stand-in, set up (by default wholly
    Mantel's, as Mantel last said: test_linked_owners.py has the rest)."""
    data = {LINK: {"url": mantel.url, "token": token}}
    if owners is not None:
        data[OWNERS] = owners
    e = house_entry(*items, entry_id=ENTRY, data=data)
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    if wait:
        await until(hass, lambda: hass.states.get(BLACK) is not None and hass.states.get(BLACK).state != "unavailable")
    return e


async def _unload(hass, e):
    assert await hass.config_entries.async_unload(e.entry_id)
    await hass.async_block_till_done()


def _linked_now(hass):
    from custom_components.hk_frontend import linked_mode
    return linked_mode.active(hass)


# ------------------------------------------------------------ off by default
async def test_not_linked_is_the_default_and_nothing_changes(hass, frontend, monkeypatch):
    from custom_components.hk_frontend import linked_mode
    from custom_components.hk_frontend.mantel_link import MantelLink

    async def never(self):
        pytest.fail("a link was started without being asked for")
    monkeypatch.setattr(MantelLink, "run", never)
    e = entry(hass)
    assert LINK not in e.data and not linked_mode.configured(e) and linked_mode.active(hass) is None
    # today's own entity is there, today's way
    assert hass.states.get("switch.hk_frontend_seasonal_decorations").state == "on"
    # the actions are today's: show_popup still checks the pop-ups locally
    with pytest.raises(ServiceValidationError, match="No pop-up #doorbell"):
        await hass.services.async_call(DOMAIN, "show_popup", {"popup": "doorbell"}, blocking=True)
    assert hass.services.has_service(DOMAIN, "set_black_screen")
    from custom_components.hk_frontend.diagnostics import async_get_config_entry_diagnostics
    assert (await async_get_config_entry_diagnostics(hass, e))["linked"] == {
        "linked": False, "url": None, "connected": False, "entities": 0, "last_error": None,
        "owners": {"house": "ha", "tablets": [], "bridge": "hk_frontend"}}


def test_a_half_filled_link_is_not_a_link():
    from types import SimpleNamespace

    from custom_components.hk_frontend import linked_mode
    for data in ({}, {LINK: None}, {LINK: {"url": "https://m.example"}}, {LINK: {"token": "t"}},
                 {LINK: {"url": " ", "token": "t"}}, {LINK: "https://m.example"}):
        assert not linked_mode.configured(SimpleNamespace(data=data)), data
    assert linked_mode.link_of(SimpleNamespace(data={LINK: {"url": " https://m.example ", "token": " t "}})) == \
        {"url": "https://m.example", "token": "t"}


def test_the_address_becomes_the_link_s_url():
    from custom_components.hk_frontend.mantel_link import ws_url
    assert ws_url("https://mantel.example.lan") == "wss://mantel.example.lan/linked/ws"
    assert ws_url("http://127.0.0.1:8080/") == "ws://127.0.0.1:8080/linked/ws"
    assert ws_url("wss://m.example/custom/ws") == "wss://m.example/custom/ws"
    for bad in ("", "mantel.example", "ftp://m.example", "https://user:pw@m.example", "https://m.example/?t=1",
                "https://m.example/#x"):
        with pytest.raises(ValueError):
            ws_url(bad)


# ------------------------------------------------------------ linked: entities
async def test_mantel_s_entities_appear_with_the_same_ids(hass, base, mantel):
    e = await _linked(hass, mantel)
    reg = er.async_get(hass)
    for eid, uid in ((BLACK, f"{ENTRY}_hall_black_screen"), (PHOTOS, f"{ENTRY}_hall_photo_screensaver"),
                     (SLEEP, f"{ENTRY}_hall_sleep_screen"), (INUSE, f"{ENTRY}_hall_screen_in_use"),
                     (VIEWERS, "01JLINKEDLIVETVITEM0000000_viewers"),
                     (CAMERA, "01JLINKEDLIVETVITEM0000000_9.1_camera"), (ALARM, ALARM_ITEM)):
        ent = reg.async_get(eid)
        assert ent is not None and ent.unique_id == uid and ent.platform == DOMAIN, eid
        assert ent.config_entry_id == e.entry_id
    assert hass.states.get(BLACK).attributes["black_screen"] == "hk"
    assert hass.states.get(SLEEP).state == "dashboard" and hass.states.get(SLEEP).attributes["why"] == "someone home"
    assert hass.states.get(INUSE).state == "off" and hass.states.get(VIEWERS).state == "0"
    assert hass.states.get(ALARM).state == "disarmed"
    assert hass.states.get(ALARM).attributes["code_format"] == "number"
    assert hass.states.get(CAMERA) is not None
    # each sits on its device, as before
    dev = dr.async_get(hass).async_get(reg.async_get(BLACK).device_id)
    assert (DOMAIN, f"{ENTRY}_hall") in dev.identifiers and dev.name == "Hall" and dev.model == "Wall Tablet"
    # nothing local: no Seasonal decorations of HA's own, no Sleep Screen engine
    assert hass.states.get("switch.hk_frontend_seasonal_decorations") is None
    from custom_components.hk_frontend import screensaver
    assert screensaver.manager(hass) is None
    # the credential went in the header, and only there
    h = mantel.headers[-1]
    assert h["Authorization"] == f"Bearer {TOKEN}" and "Origin" not in h
    await _unload(hass, e)


async def test_an_entity_the_house_has_keeps_its_entity_id(hass, base, mantel):
    """The registry keys by unique id: a renamed entity keeps its name after the move."""
    pre = house_entry(entry_id=ENTRY)
    pre.add_to_hass(hass)
    er.async_get(hass).async_get_or_create("switch", DOMAIN, f"{ENTRY}_hall_black_screen", config_entry=pre,
                                           suggested_object_id="hall_tablet_darkness")
    hass.config_entries.async_update_entry(pre, data={LINK: {"url": mantel.url, "token": TOKEN}, OWNERS: FULL})
    assert await hass.config_entries.async_setup(pre.entry_id)
    await until(hass, lambda: (s := hass.states.get("switch.hall_tablet_darkness")) is not None
                and s.state != "unavailable")
    assert hass.states.get(BLACK) is None
    await _unload(hass, pre)


async def test_a_pushed_state_is_applied(hass, base, mantel):
    e = await _linked(hass, mantel)
    await mantel.push({"type": "state", "unique_id": f"{ENTRY}_hall_sleep_screen", "state": "dark",
                       "attributes": {"tablet": "hall", "why": "quiet hours"}, "available": True})
    await until(hass, lambda: hass.states.get(SLEEP).state == "dark")
    assert hass.states.get(SLEEP).attributes["why"] == "quiet hours"
    await mantel.push({"type": "state", "unique_id": f"{ENTRY}_hall_screen_in_use", "state": "on",
                       "attributes": {}, "available": True})
    await until(hass, lambda: hass.states.get(INUSE).state == "on")
    # Mantel says one is unavailable
    await mantel.push({"type": "state", "unique_id": ALARM_ITEM, "state": "armed_away", "attributes": {},
                       "available": False})
    await until(hass, lambda: hass.states.get(ALARM).state == "unavailable")
    # a new entity, and one removed (a tablet removed in Mantel: as before, from the registry too)
    await mantel.push({"type": "entity", "entity": {
        "unique_id": f"{ENTRY}_loft_black_screen", "platform": "switch", "entity_id": "switch.loft_black_screen",
        "translation_key": "black_screen", "state": "on", "attributes": {"confirmed": True}}})
    await until(hass, lambda: hass.states.get("switch.loft_black_screen") is not None)
    await mantel.push({"type": "removed", "unique_id": f"{ENTRY}_loft_black_screen"})
    await until(hass, lambda: hass.states.get("switch.loft_black_screen") is None)
    assert er.async_get(hass).async_get("switch.loft_black_screen") is None
    await _unload(hass, e)


async def test_mantel_cannot_make_home_assistant_call_anything(hass, base, mantel):
    """Only the mirrored entities change: a frame of any other kind does nothing."""
    calls = []
    hass.services.async_register("light", "turn_on", lambda call: calls.append(call))
    e = await _linked(hass, mantel)
    for frame in ({"type": "call_service", "domain": "light", "service": "turn_on", "service_data": {}},
                  {"type": "execute_script", "sequence": [{"service": "light.turn_on"}]},
                  {"type": "fire_event", "event_type": "x"}, {"type": "result", "id": 999, "success": True},
                  {"type": "state", "unique_id": "not-one-of-ours", "state": "on"},
                  {"type": "entity", "entity": {"unique_id": "x", "platform": "light"}}):
        await mantel.push(frame)
    await mantel.push({"type": "state", "unique_id": f"{ENTRY}_hall_sleep_screen", "state": "photos",
                       "attributes": {}, "available": True})
    await until(hass, lambda: hass.states.get(SLEEP).state == "photos")
    assert calls == [] and hass.states.get("light.x") is None
    await _unload(hass, e)


# ------------------------------------------------------------ linked: the actions
async def test_the_actions_are_forwarded_with_their_data(hass, base, mantel):
    e = await _linked(hass, mantel)
    await hass.services.async_call(DOMAIN, "show_popup", {"popup": "doorbell", "dashboards": "dashboard-hall",
                                                          "users": ["kitchen"]}, blocking=True)
    await hass.services.async_call(DOMAIN, "close_popup", {"popup": "alarm"}, blocking=True)
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": True,
                                                                "brightness": 174}, blocking=True)
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "brightness": "40"},
                                   blocking=True)
    got = [{k: v for k, v in m.items() if k != "id"} for m in mantel.calls()]
    target = [{"entity_id": BLACK, "unique_id": f"{ENTRY}_hall_black_screen"}]
    assert got == [
        {"type": "call_service", "service": "show_popup",
         "data": {"popup": "doorbell", "dashboards": ["dashboard-hall"], "users": ["kitchen"]}},
        {"type": "call_service", "service": "close_popup", "data": {"popup": "alarm"}},
        {"type": "call_service", "service": "set_black_screen", "data": {"black": True, "brightness": 174},
         "targets": target},
        {"type": "call_service", "service": "set_black_screen", "data": {"brightness": 40}, "targets": target},
    ]
    assert len({m["id"] for m in mantel.calls()}) == 4, "each its own id"
    await _unload(hass, e)


async def test_commands_to_the_entities_are_forwarded(hass, base, mantel):
    e = await _linked(hass, mantel)
    await hass.services.async_call("switch", "turn_on", {"entity_id": PHOTOS}, blocking=True)
    await hass.services.async_call("alarm_control_panel", "alarm_disarm", {"entity_id": ALARM, "code": "4321"},
                                   blocking=True)
    got = [{k: v for k, v in m.items() if k != "id"} for m in mantel.calls("entity_command")]
    assert got == [
        {"type": "entity_command", "unique_id": f"{ENTRY}_hall_photo_screensaver", "command": "turn_on", "data": {}},
        {"type": "entity_command", "unique_id": ALARM_ITEM, "command": "alarm_disarm", "data": {"code": "4321"}},
    ]
    await _unload(hass, e)


async def test_the_confirmed_handshake(hass, base, mantel):
    """What the sleep scripts wait on: set_black_screen returns with the switch
    already on and not confirmed (Mantel sends a call's state before its answer);
    `confirmed` turns true when the page says it went black."""
    uid = f"{ENTRY}_hall_black_screen"

    async def black(ws, msg):
        if msg.get("service") == "set_black_screen":
            await ws.send_json({"type": "state", "unique_id": uid, "state": "on", "available": True,
                                "attributes": {"tablet": "hall", "black_screen": "hk", "brightness": 174,
                                               "confirmed": False}})
        return {"id": msg["id"], "type": "result", "success": True, "result": {BLACK: {"on": True}}}
    mantel.answer = black
    e = await _linked(hass, mantel)
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": True,
                                                                "brightness": 174}, blocking=True)
    st = hass.states.get(BLACK)          # no waiting: it is already here
    assert st.state == "on" and st.attributes["confirmed"] is False and st.attributes["brightness"] == 174
    await mantel.push({"type": "state", "unique_id": uid, "state": "on", "available": True,
                       "attributes": {"tablet": "hall", "black_screen": "hk", "brightness": 174, "confirmed": True}})
    await until(hass, lambda: hass.states.get(BLACK).attributes["confirmed"] is True)
    await _unload(hass, e)


async def test_a_refusal_says_why(hass, base, mantel):
    async def refuse(ws, msg):
        return {"id": msg["id"], "type": "result", "success": False,
                "error": {"code": "unknown_popup", "message": "No pop-up #nope on Mantel Server"}}
    mantel.answer = refuse
    e = await _linked(hass, mantel)
    with pytest.raises(ServiceValidationError, match="Mantel Server refused hk_frontend.show_popup: No pop-up #nope"):
        await hass.services.async_call(DOMAIN, "show_popup", {"popup": "nope"}, blocking=True)

    async def broken(ws, msg):
        return {"id": msg["id"], "type": "result", "success": False,
                "error": {"code": "internal", "message": "see its log"}}
    mantel.answer = broken
    with pytest.raises(HomeAssistantError, match="refused") as err:
        await hass.services.async_call(DOMAIN, "close_popup", {"popup": "x"}, blocking=True)
    assert not isinstance(err.value, ServiceValidationError)

    # the alarm: Mantel's code refusals are the caller's to fix, and say "code" (HK's keypad: "Wrong code")
    for code, message in (("invalid_code", "Wrong code"), ("code_required", "Enter the alarm code"),
                          ("code_locked", "Wrong code too many times; the keypad is locked for 15 min")):
        async def alarm(ws, msg, code=code, message=message):
            return {"id": msg["id"], "type": "result", "success": False, "error": {"code": code, "message": message}}
        mantel.answer = alarm
        with pytest.raises(ServiceValidationError, match=f"refused alarm_disarm on {ALARM}: {message}"):
            await hass.services.async_call("alarm_control_panel", "alarm_disarm", {"entity_id": ALARM, "code": "1"},
                                           blocking=True)

    async def off(ws, msg):
        return {"id": msg["id"], "type": "result", "success": False, "error": {
            "code": "commands_disabled", "message": "house commands are disabled on this Mantel Server; nothing was sent"}}
    mantel.answer = off
    with pytest.raises(HomeAssistantError, match="nothing was sent") as err:
        await hass.services.async_call("alarm_control_panel", "alarm_disarm", {"entity_id": ALARM, "code": "1"},
                                       blocking=True)
    assert not isinstance(err.value, ServiceValidationError)
    await _unload(hass, e)


async def test_a_slow_mantel_fails_the_call_in_time(hass, base, mantel):
    async def silent(ws, msg):
        return None
    mantel.answer = silent
    e = await _linked(hass, mantel)
    _linked_now(hass).link.timeout = 0.2
    with pytest.raises(HomeAssistantError, match="did not answer within 0.2 s"):
        await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": False},
                                       blocking=True)
    assert _linked_now(hass).link._pending == {}, "nothing left waiting"
    await _unload(hass, e)


# ------------------------------------------------------------ linked: the connection
async def test_it_reconnects_and_a_call_while_away_fails_clearly(hass, base, mantel):
    e = await _linked(hass, mantel)
    linked = _linked_now(hass)
    linked.link.backoff = (0.05, 0.1)

    async def hold(ws, msg):
        return None                      # a call in flight when the socket drops
    mantel.answer = hold
    # not a tracked task: async_block_till_done (in until) would wait for it
    pending = asyncio.get_running_loop().create_task(hass.services.async_call(
        DOMAIN, "show_popup", {"popup": "doorbell"}, blocking=True))
    await until(hass, lambda: mantel.calls())
    real_token, mantel.token = mantel.token, "something else"     # keep it away for a moment
    await mantel.drop()
    with pytest.raises(HomeAssistantError, match="dropped"):
        await pending
    await until(hass, lambda: hass.states.get(BLACK).state == "unavailable")
    assert all(hass.states.get(x).state == "unavailable" for x in (SLEEP, INUSE, ALARM))
    with pytest.raises(HomeAssistantError, match="not connected"):
        await hass.services.async_call(DOMAIN, "close_popup", {"popup": "alarm"}, blocking=True)
    # it keeps trying (refused meanwhile), and is back the moment it can be
    await until(hass, lambda: linked.link.attempts >= 3 and linked.link.last_error == "HTTP 401")
    connects = mantel.connects
    mantel.token = real_token
    mantel.answer = mantel.ok
    await until(hass, lambda: hass.states.get(BLACK).state == "off")
    assert mantel.connects == connects + 1 and linked.link.connected
    await hass.services.async_call(DOMAIN, "close_popup", {"popup": "alarm"}, blocking=True)
    assert mantel.calls()[-1]["data"] == {"popup": "alarm"}
    await _unload(hass, e)


async def test_a_refused_credential_is_retried_and_never_logged(hass, base, mantel, caplog):
    caplog.set_level(logging.DEBUG)
    bad = "msvc_ffeeddccbbaa9988_" + "Z" * 43
    e = await _linked(hass, mantel, token=bad, wait=False)
    linked = _linked_now(hass)
    linked.link.backoff = (0.02, 0.05)
    await until(hass, lambda: linked.link.attempts >= 2)
    assert linked.link.last_error == "HTTP 401" and not linked.link.connected
    assert hass.states.get(BLACK) is None
    assert "refused the link (HTTP 401)" in caplog.text
    assert bad not in caplog.text and bad not in repr(linked.link)
    from custom_components.hk_frontend.diagnostics import async_get_config_entry_diagnostics
    diag = await async_get_config_entry_diagnostics(hass, e)
    assert bad not in str(diag) and diag["linked"]["url"] == mantel.url and diag["linked"]["linked"] is True
    await _unload(hass, e)


async def test_unloading_stops_the_link(hass, base, mantel):
    e = await _linked(hass, mantel)
    linked = _linked_now(hass)
    await _unload(hass, e)
    assert _linked_now(hass) is None and not linked.link.connected
    await until(hass, lambda: not mantel.sockets)
    assert hass.states.get(BLACK).state == "unavailable"


# ------------------------------------------------------------ Configure
async def test_configure_links_and_unlinks(hass, frontend, mantel):
    e = entry(hass)
    flows = hass.config_entries.options
    r = await flows.async_init(e.entry_id)
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    assert r["type"] == "form" and r["step_id"] == "linked"
    assert r["description_placeholders"]["state"] == "not linked"
    r = await flows.async_configure(r["flow_id"], {"enabled": True, "url": "not an address", "token": ""})
    assert r["errors"] == {"url": "mantel_url_invalid", "token": "mantel_token_required"}
    r = await flows.async_configure(r["flow_id"], {"enabled": True, "url": "http://mantel.example.lan",
                                                   "token": TOKEN})
    assert r["errors"] == {"url": "mantel_url_insecure"}, "a credential never crosses the network in clear"
    assert LINK not in e.data
    r = await flows.async_configure(r["flow_id"], {"enabled": True, "url": mantel.url, "token": TOKEN})
    assert r["type"] == "menu" and r["description_placeholders"]["saved"] == "Saved: Linked to Mantel."
    await hass.async_block_till_done()
    assert e.data[LINK] == {"url": mantel.url, "token": TOKEN}
    assert e.options.get(LINK) is None, "never in the options (the dashboard settings)"
    # linked: everything HA's until Mantel's hello says the whole entry is Mantel's; then it reloads
    await until(hass, lambda: _linked_now(hass) is not None and _linked_now(hass).full
                and _linked_now(hass).link.connected)
    assert e.data[OWNERS] == FULL, "what Mantel said is kept (a restart without Mantel keeps it)"
    assert hass.states.get("switch.hk_frontend_seasonal_decorations").state == "unavailable", "Mantel's now"
    # the credential is never shown again; left empty, the saved one is kept
    r = await flows.async_init(e.entry_id)
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    schema = {str(k): k for k in r["data_schema"].schema}
    assert schema["token"].default() == "" and schema["url"].default() == mantel.url
    r = await flows.async_configure(r["flow_id"], {"enabled": True, "url": mantel.url, "token": ""})
    assert e.data[LINK]["token"] == TOKEN
    # off: back to today's integration
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    r = await flows.async_configure(r["flow_id"], {"enabled": False})
    await hass.async_block_till_done()
    assert LINK not in e.data and OWNERS not in e.data
    await until(hass, lambda: _linked_now(hass) is None
                and hass.states.get("switch.hk_frontend_seasonal_decorations").state == "on")
