"""Linked mode's per-tablet ownership (linked_mode.py; the cutover's Option A),
against the stand-in Mantel (mantel_fake.py): while the rest of the entry is
Home Assistant's, a tablet Mantel owns has no engine or entity of HA's own,
its entities are Mantel's and its set_black_screen goes there; a tablet HA
owns stays exactly as today and nothing of it is forwarded, even if Mantel
describes it; pop-ups and notify run here and go to Mantel too; Mantel saying
a tablet moved is kept and reloads the entry, and a tablet moved back keeps
its entity id; a restart without Mantel keeps the last ownership."""
from __future__ import annotations

import logging

from homeassistant.helpers import entity_registry as er

from conftest import house_entry
from mantel_fake import BLACK, ENTRY, TOKEN, FakeMantel, until

import pytest

DOMAIN = "hk_frontend"
LINK, OWNERS = "mantel_link", "mantel_owners"
HALL_MANTEL = {"house": "ha", "tablets": ["hall"], "bridge": "hk_frontend"}
ALL_HA = {"house": "ha", "tablets": [], "bridge": "hk_frontend"}
SCREEN = {"subentry_type": "dashboard", "unique_id": "dashboard-hall", "title": "Hall",
          "data": {"screensaver": True}}
TABLET = {"subentry_type": "tablet", "unique_id": "hall", "title": "Hall",
          "data": {"name": "Hall", "screen": "dashboard-hall", "user": "hall", "room": "hall", "uid": "hall"}}
SEASONAL = "switch.hk_frontend_seasonal_decorations"


@pytest.fixture
async def mantel(socket_enabled):
    fake = await FakeMantel().start()
    yield fake
    await fake.close()


def _linked(hass):
    from custom_components.hk_frontend import linked_mode
    return linked_mode.active(hass)


def _mgr(hass):
    from custom_components.hk_frontend import screensaver
    return screensaver.manager(hass)


async def _setup(hass, mantel, owners, *, token=TOKEN):
    data = {LINK: {"url": mantel.url, "token": token}}
    if owners is not None:
        data[OWNERS] = owners
    e = house_entry(SCREEN, TABLET, entry_id=ENTRY, minor_version=16, data=data)
    e.add_to_hass(hass)
    loaded = await hass.config_entries.async_setup(e.entry_id)
    # with nothing kept, Mantel's hello may already have reloaded it (once it was set up)
    assert loaded or owners is None
    await hass.async_block_till_done()
    return e


async def test_a_tablet_mantel_owns_is_mantel_s_and_the_rest_runs_here(hass, base, mantel):
    mantel.owners = HALL_MANTEL
    e = await _setup(hass, mantel, HALL_MANTEL)
    await until(hass, lambda: (s := hass.states.get(BLACK)) is not None and s.state != "unavailable")
    linked = _linked(hass)
    assert linked is not None and not linked.full and linked.tablets == {"hall"}
    # the rest is HA's own, as today: Seasonal decorations, the Sleep Screen manager...
    assert hass.states.get(SEASONAL).state == "on"
    mgr = _mgr(hass)
    assert mgr is not None and "hall" not in mgr.entities and "hall" not in mgr.engines, \
        "no engine or entity of HA's for Mantel's tablet"
    # ...Mantel's live TV and alarm are not (the rest of the entry is HA's)
    assert hass.states.get("alarm_control_panel.house_alarm_pin") is None
    # the hall's black screen is Mantel's: set_black_screen goes there
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": True},
                                   blocking=True)
    assert [m["service"] for m in mantel.calls()] == ["set_black_screen"]
    # a pop-up and a notification: here as always, and to Mantel too (its screens are Mantel's)
    seen = []
    from homeassistant.helpers.dispatcher import async_dispatcher_connect
    from custom_components.hk_frontend.const import SIGNAL_POPUP
    async_dispatcher_connect(hass, SIGNAL_POPUP, seen.append)
    await hass.services.async_call(DOMAIN, "close_popup", {"popup": "alarm"}, blocking=True)
    assert seen and seen[-1]["type"] == "popup_close", "HA's own screens got it"
    assert mantel.calls()[-1]["service"] == "close_popup" and mantel.calls()[-1]["data"] == {"popup": "alarm"}
    got = await hass.services.async_call(DOMAIN, "notify", {"title": "Laundry"}, blocking=True,
                                         return_response=True)
    assert mantel.calls()[-1]["service"] == "notify" and mantel.calls()[-1]["data"]["title"] == "Laundry"
    assert got == {"id": None, "snap": False}
    from custom_components.hk_frontend.diagnostics import async_get_config_entry_diagnostics
    assert (await async_get_config_entry_diagnostics(hass, e))["linked"]["owners"] == HALL_MANTEL
    assert await hass.config_entries.async_unload(e.entry_id)
    assert _linked(hass) is None


async def test_mantel_away_never_stops_ha_s_own_screens(hass, base, mantel, caplog):
    caplog.set_level(logging.WARNING)
    mantel.owners = HALL_MANTEL
    e = await _setup(hass, mantel, HALL_MANTEL)
    await until(hass, lambda: _linked(hass).link.connected)
    _linked(hass).link.backoff = (5.0, 5.0)
    mantel.token = "something else"
    await mantel.drop()
    await until(hass, lambda: not _linked(hass).link.connected)
    await hass.services.async_call(DOMAIN, "close_popup", {"popup": "alarm"}, blocking=True)   # no error
    assert "reached Home Assistant's screens but not Mantel Server's" in caplog.text
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_a_tablet_ha_owns_stays_ha_s_whatever_mantel_describes(hass, base, mantel):
    mantel.owners = ALL_HA                     # and yet its hello lists the hall's entities
    e = await _setup(hass, mantel, ALL_HA)
    await until(hass, lambda: _linked(hass).link.connected)
    assert "hall" in _mgr(hass).entities, "HA's own black screen, in-use, photos and sleep sensors"
    assert hass.states.get(BLACK).state == "off"
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": True},
                                   blocking=True)
    assert hass.states.get(BLACK).state == "on", "HA's own BlackScreen did it"
    await hass.services.async_call(DOMAIN, "close_popup", {"popup": "alarm"}, blocking=True)
    assert mantel.calls() == [], "nothing forwarded while Mantel owns no tablet"
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_mantel_moves_a_tablet_and_back(hass, base, mantel):
    # nothing kept yet: everything HA's until Mantel says
    mantel.owners = HALL_MANTEL
    e = await _setup(hass, mantel, None)
    await until(hass, lambda: e.data.get(OWNERS) == HALL_MANTEL and _linked(hass) is not None
                and _linked(hass).tablets == {"hall"} and _linked(hass).link.connected)
    await until(hass, lambda: (s := hass.states.get(BLACK)) is not None and s.state != "unavailable")
    assert "hall" not in _mgr(hass).entities
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": False},
                                   blocking=True)
    assert mantel.calls()[-1]["service"] == "set_black_screen"
    reg = er.async_get(hass)
    entry_before = reg.async_get(BLACK)
    # an Owner moves it back: Mantel says so first, then withdraws the entities without forgetting them
    mantel.owners = ALL_HA
    await mantel.push({"type": "owners", "owners": ALL_HA})
    for key in ("black_screen", "photo_screensaver", "sleep_screen", "screen_in_use"):
        await mantel.push({"type": "removed", "unique_id": f"{ENTRY}_hall_{key}", "forget": False})
    await until(hass, lambda: e.data.get(OWNERS) == ALL_HA and _linked(hass) is not None
                and not _linked(hass).tablets and _mgr(hass) is not None and "hall" in _mgr(hass).entities)
    ent = reg.async_get(BLACK)
    assert ent is not None and ent.id == entry_before.id, "the same registry entry, so the same entity id"
    n = len(mantel.calls())
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": True},
                                   blocking=True)
    assert len(mantel.calls()) == n and hass.states.get(BLACK).state == "on", "HA's own again"
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_a_restart_without_mantel_keeps_the_last_ownership(hass, base, mantel):
    e = await _setup(hass, mantel, HALL_MANTEL, token="msvc_ffeeddccbbaa9988_" + "Z" * 43)   # refused
    linked = _linked(hass)
    assert linked is not None and not linked.link.connected and linked.tablets == {"hall"}
    assert "hall" not in _mgr(hass).entities and "hall" not in _mgr(hass).engines, \
        "HA's engine stays off for Mantel's tablet while Mantel is away"
    assert hass.states.get(SEASONAL).state == "on"
    assert e.data[OWNERS] == HALL_MANTEL
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_configure_says_who_owns_what(hass, base, mantel):
    mantel.owners = HALL_MANTEL
    e = await _setup(hass, mantel, HALL_MANTEL)
    flows = hass.config_entries.options
    r = await flows.async_init(e.entry_id)
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    assert "hall" in r["description_placeholders"]["state"]
    assert "Home Assistant everything else" in r["description_placeholders"]["state"]
    await flows.async_configure(r["flow_id"], {"enabled": False})
    await hass.async_block_till_done()
    assert LINK not in e.data and OWNERS not in e.data
    await until(hass, lambda: _linked(hass) is None and "hall" in (_mgr(hass).entities if _mgr(hass) else {}))
