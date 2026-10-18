"""Pop-ups (settings.py SUBENTRY_POPUP): items on the integration's page, sent
to every screen, and opened by the Show pop-up action."""
from __future__ import annotations

import pytest

from conftest import FakeConnection, entry

DOMAIN = "hk_frontend"


async def _add(hass, name, kind, details, hash_=""):
    e = entry(hass)
    r = await hass.config_entries.subentries.async_init((e.entry_id, "popup"), context={"source": "user"})
    assert r["type"] == "form" and r["step_id"] == "user"
    r = await hass.config_entries.subentries.async_configure(
        r["flow_id"], {"name": name, "kind": kind, **({"hash": hash_} if hash_ else {})})
    if r["type"] != "form" or r["step_id"] != "details":
        return r
    return await hass.config_entries.subentries.async_configure(r["flow_id"], details)


async def test_a_doorbell_pop_up_is_an_item_every_screen_gets(hass, frontend):
    from custom_components.hk_frontend import ws_settings_subscribe
    from custom_components.hk_frontend.settings import as_client
    screen = FakeConnection(None)
    ws_settings_subscribe(hass, screen, {"id": 1})
    assert screen.sent[-1]["event"]["popups"] == []
    r = await _add(hass, "Front Door", "camera", {
        "entity": "camera.front_door_high", "speaker": "media_player.front_door_speaker", "close_after": 90})
    assert r["type"] == "create_entry" and r["unique_id"] == "front-door", "the hash comes from the name"
    await hass.async_block_till_done()
    p = as_client(entry(hass))["popups"][0]
    assert (p["hash"], p["kind"], p["entity"], p["speaker"], p["close_after"], p["dashboards"]) == (
        "front-door", "camera", "camera.front_door_high", "media_player.front_door_speaker", 90, [])
    assert screen.sent[-1]["event"]["popups"][0]["hash"] == "front-door", "screens were told"


async def test_hashes_are_checked(hass, frontend):
    r = await _add(hass, "Alarm", "alarm", {}, hash_="alarm")
    assert r["type"] == "create_entry"
    r = await _add(hass, "Alarm again", "alarm", {}, hash_="alarm")
    assert r["type"] == "form" and r["errors"] == {"hash": "hash_taken"}
    r = await _add(hass, "Bad", "alarm", {}, hash_="no spaces!")
    assert r["errors"] == {"hash": "bad_hash"}
    r = await _add(hass, "#Gate", "accessories", {"entities": ["lock.gate", "cover.gate"]}, hash_="#gate")
    assert r["type"] == "create_entry" and r["unique_id"] == "gate", "a leading # is dropped"


async def test_its_gear_edits_the_details_not_the_kind(hass, frontend):
    from custom_components.hk_frontend.settings import as_client
    await _add(hass, "Front Door", "camera", {"entity": "camera.fd"})
    e = entry(hass)
    sid = next(s.subentry_id for s in e.subentries.values() if s.subentry_type == "popup")
    r = await hass.config_entries.subentries.async_init(
        (e.entry_id, "popup"), context={"source": "reconfigure", "subentry_id": sid})
    assert r["step_id"] == "reconfigure"
    assert "kind" not in {k.schema for k in r["data_schema"].schema}
    r = await hass.config_entries.subentries.async_configure(r["flow_id"], {
        "name": "Doorbell", "entity": "camera.fd", "dashboards": ["dashboard-kitchen"], "close_after": 30})
    assert r["type"] == "abort" and r["reason"] == "reconfigure_successful"
    p = as_client(entry(hass))["popups"][0]
    assert (p["name"], p["hash"], p["dashboards"], p["close_after"]) == (
        "Doorbell", "front-door", ["dashboard-kitchen"], 30), "renamed; the hash stays"


async def test_show_popup_reaches_the_screens(hass, frontend):
    from homeassistant.exceptions import ServiceValidationError
    from custom_components.hk_frontend import ws_events_subscribe
    await _add(hass, "Doorbell", "camera", {"entity": "camera.fd"}, hash_="doorbell")
    screen = FakeConnection(None)
    ws_events_subscribe(hass, screen, {"id": 9})
    await hass.services.async_call(DOMAIN, "show_popup", {"popup": "#doorbell", "dashboards": ["/dashboard-kitchen/"]},
                                   blocking=True)
    await hass.async_block_till_done()
    ev = screen.sent[-1]["event"]
    assert ev == {"type": "popup", "popup": "doorbell", "dashboards": ["dashboard-kitchen"], "users": []}
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "show_popup", {"popup": "nope"}, blocking=True)


async def test_close_popup_reaches_the_screens(hass, frontend):
    # the alarm keypad comes down when the alarm clears: no navigation, so a
    # kiosk that cannot load a URL (Kiosk Satellite) can still be told
    from custom_components.hk_frontend import ws_events_subscribe
    screen = FakeConnection(None)
    ws_events_subscribe(hass, screen, {"id": 9})
    await hass.services.async_call(DOMAIN, "close_popup", {"popup": "#Alarm", "dashboards": ["/dashboard-loft/"]},
                                   blocking=True)
    await hass.async_block_till_done()
    ev = screen.sent[-1]["event"]
    assert ev == {"type": "popup_close", "popup": "alarm", "dashboards": ["dashboard-loft"], "users": []}


async def test_a_popup_for_some_people_reaches_only_their_browsers(hass, frontend):
    from types import SimpleNamespace
    from custom_components.hk_frontend import ws_events_subscribe
    await _add(hass, "Doorbell", "camera", {"entity": "camera.fd"}, hash_="doorbell")
    mine, theirs = FakeConnection(SimpleNamespace(id="u1")), FakeConnection(SimpleNamespace(id="u2"))
    ws_events_subscribe(hass, mine, {"id": 9})
    ws_events_subscribe(hass, theirs, {"id": 9})
    await hass.services.async_call(DOMAIN, "show_popup", {"popup": "#doorbell", "users": ["u1"]}, blocking=True)
    await hass.async_block_till_done()
    assert mine.sent[-1]["event"]["users"] == ["u1"]
    assert not any("event" in m for m in theirs.sent), "another user's socket carried it"
    await hass.services.async_call(DOMAIN, "show_popup", {"popup": "#doorbell"}, blocking=True)
    await hass.async_block_till_done()
    assert theirs.sent[-1]["event"]["popup"] == "doorbell", "one for everyone still reaches everyone"


def test_popup_normaliser():
    from custom_components.hk_frontend.settings import popup, slug
    assert slug("Emma’s Room!") == "emmas-room"
    p = popup({"name": "X", "kind": "alarm", "entity": "camera.not_an_alarm", "close_after": 1}, "x")
    assert p["entity"] == "" and p["close_after"] == 10 and p["kind"] == "alarm"
    assert popup({"kind": "sofa"}, "y")["kind"] == "camera"


CARDS = [{"type": "custom:hk-heading-card", "name": "Garage"}, {"type": "tile", "entity": "cover.garage_door"}]


async def test_a_custom_pop_up_is_the_house_s_own_cards(hass, frontend):
    from custom_components.hk_frontend.settings import as_client
    r = await _add(hass, "Garage", "cards", {"cards": CARDS, "icon": "mdi:garage", "width": "wide"})
    assert r["type"] == "create_entry" and r["unique_id"] == "garage"
    p = as_client(entry(hass))["popups"][0]
    assert (p["kind"], p["cards"], p["icon"], p["width"]) == ("cards", CARDS, "mdi:garage", "wide")
    # one card is a list of one; not a card is refused
    r = await _add(hass, "One", "cards", {"cards": CARDS[1]})
    assert r["type"] == "create_entry"
    assert next(p for p in as_client(entry(hass))["popups"] if p["hash"] == "one")["cards"] == [CARDS[1]]
    r = await _add(hass, "Bad", "cards", {"cards": [{"entity": "no type"}]})
    assert r["type"] == "form" and r["errors"] == {"cards": "popup_cards"}
    # its gear keeps the kind and changes the cards
    e = entry(hass)
    sid = next(s.subentry_id for s in e.subentries.values() if s.subentry_type == "popup" and s.unique_id == "garage")
    r = await hass.config_entries.subentries.async_init(
        (e.entry_id, "popup"), context={"source": "reconfigure", "subentry_id": sid})
    r = await hass.config_entries.subentries.async_configure(r["flow_id"], {
        "name": "Garage", "cards": CARDS[:1], "icon": "mdi:garage", "width": "narrow"})
    assert r["type"] == "abort"
    p = next(p for p in as_client(entry(hass))["popups"] if p["hash"] == "garage")
    assert (p["cards"], p["width"]) == (CARDS[:1], "narrow")


def test_only_a_custom_pop_up_keeps_cards():
    from custom_components.hk_frontend.settings import popup
    assert popup({"kind": "camera", "cards": CARDS}, "x")["cards"] == []
    assert popup({"kind": "cards", "cards": {"cards": CARDS}}, "x")["cards"] == CARDS, "a view's cards"
    assert popup({"kind": "cards", "icon": "not an icon", "width": "huge"}, "x")[
        "icon"] == "" and popup({"kind": "cards", "width": "huge"}, "x")["width"] == "narrow"
