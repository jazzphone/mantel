"""Linked mode END TO END, in one process: this integration (Home Assistant's
test harness) linked to Mantel Server's REAL linked endpoint
(mantel_server/linked.py, with its in-memory handler and a real Service
account), over a real local socket. One action and one entity, including the
black screen's `confirmed` handshake as the sleep scripts see it.

Needs a Mantel checkout (MANTEL_ROOT): conftest.py collects it only then, and
the Mantel suite runs it (tests/test_linked_e2e.py there)."""
from __future__ import annotations

import os
import sqlite3
import sys
import time
from types import SimpleNamespace

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from homeassistant.exceptions import HomeAssistantError

from conftest import house_entry
from mantel_fake import BLACK, DEVICE, ENTRY, FULL, SLEEP, until

_ROOT = os.environ["MANTEL_ROOT"]
for _p in (os.path.join(_ROOT, "hosts", "server"), _ROOT):
    if _p not in sys.path:
        sys.path.append(_p)

from mantel_server import linked as mantel_linked  # noqa: E402
from mantel_server import service_accounts  # noqa: E402

DOMAIN = "hk_frontend"
BLACK_UID = f"{ENTRY}_hall_black_screen"
SLEEP_UID = f"{ENTRY}_hall_sleep_screen"


@pytest.fixture
async def mantel_server(socket_enabled):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    service_accounts.ensure_schema(conn)
    accounts = service_accounts.ServiceAccounts(conn)
    acct, token = accounts.create("home-assistant", ["linked"])
    app = web.Application()
    app["clock"] = time.time
    linked = mantel_linked.register(app, None, mantel_linked.LinkedHooks(
        accounts=accounts, recheck=0.1, heartbeat=None))   # no server ping timer left behind in the harness)
    await linked.registry.publish({
        "unique_id": BLACK_UID, "platform": "switch", "entity_id": BLACK, "translation_key": "black_screen",
        "icon": "mdi:monitor-off", "device": DEVICE, "state": "off", "tablet": "hall",
        "attributes": {"tablet": "hall", "black_screen": "hk", "brightness": None, "confirmed": False}})
    await linked.registry.publish({
        "unique_id": SLEEP_UID, "platform": "sensor", "entity_id": SLEEP, "translation_key": "sleep_screen",
        "device": DEVICE, "state": "dashboard", "tablet": "hall", "attributes": {"tablet": "hall"}})
    await linked.registry.set_owners(FULL)          # Mantel owns the whole entry (Step 7)
    server = TestServer(app, host="127.0.0.1")
    await server.start_server()
    yield SimpleNamespace(url=f"http://127.0.0.1:{server.port}", token=token, linked=linked, account=acct,
                          accounts=accounts)
    await server.close()
    conn.close()


async def _setup(hass, server):
    # nothing kept from before: the hello's owners say the whole entry is Mantel's, and it reloads so
    # (once set up; async_setup may already see it reloading)
    e = house_entry(entry_id=ENTRY, data={"mantel_link": {"url": server.url, "token": server.token}})
    e.add_to_hass(hass)
    await hass.config_entries.async_setup(e.entry_id)
    await until(hass, lambda: (s := hass.states.get(BLACK)) is not None and s.state != "unavailable")
    assert e.data["mantel_owners"] == FULL
    return e


async def test_set_black_screen_and_the_confirmed_handshake_end_to_end(hass, base, mantel_server):
    e = await _setup(hass, mantel_server)
    handler = mantel_server.linked.handler
    assert hass.states.get(SLEEP).state == "dashboard"
    # the sleep script: black, with the brightness to come back to...
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": True,
                                                                "brightness": 174}, blocking=True)
    assert handler.calls[-1] == {"service": "set_black_screen", "data": {"black": True, "brightness": 174},
                                 "targets": [{"entity_id": BLACK, "unique_id": BLACK_UID}]}
    st = hass.states.get(BLACK)          # ...returns with the switch on, not yet confirmed
    assert st.state == "on" and st.attributes["confirmed"] is False and st.attributes["brightness"] == 174
    assert st.attributes["black_screen"] == "hk"
    # ...and waits for the page: the tablet says it went black
    assert await handler.page_says(BLACK_UID, True)
    await until(hass, lambda: hass.states.get(BLACK).attributes["confirmed"] is True)
    # a tap wakes it: the switch follows, unconfirmed
    assert await handler.page_says(BLACK_UID, False)
    await until(hass, lambda: hass.states.get(BLACK).state == "off")
    assert hass.states.get(BLACK).attributes["confirmed"] is False
    # an entity's state, pushed by Mantel
    await mantel_server.linked.registry.update(SLEEP_UID, state="dark", attributes={"why": "quiet hours"})
    await until(hass, lambda: hass.states.get(SLEEP).state == "dark")
    assert hass.states.get(SLEEP).attributes["why"] == "quiet hours"
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_a_popup_and_mantel_s_own_refusals_end_to_end(hass, base, mantel_server):
    e = await _setup(hass, mantel_server)
    handler = mantel_server.linked.handler
    await hass.services.async_call(DOMAIN, "show_popup", {"popup": "doorbell", "dashboards": ["dashboard-hall"]},
                                   blocking=True)
    assert handler.popups == [{"service": "show_popup", "popup": "doorbell", "dashboards": ["dashboard-hall"]}]
    # the in-memory handler refuses alarm commands; a switch command works
    await hass.services.async_call("switch", "turn_on", {"entity_id": BLACK}, blocking=True)
    assert hass.states.get(BLACK).state == "on"
    # a credential revoked while linked ends the link at once
    mantel_server.accounts.revoke(mantel_server.account.id)
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(DOMAIN, "close_popup", {"popup": "doorbell"}, blocking=True)
    await until(hass, lambda: hass.states.get(BLACK).state == "unavailable")
    assert handler.popups[-1]["service"] == "show_popup", "the revoked link's call never reached the handler"
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_one_tablet_mantel_s_the_rest_home_assistant_s_end_to_end(hass, base, mantel_server):
    """CUTOVER Step 3: the hall tablet is Mantel's, everything else still HA's. The hall's black screen
    is Mantel's and its set_black_screen goes there; Seasonal decorations is HA's own; a pop-up runs
    here and is forwarded too."""
    await mantel_server.linked.registry.set_owners({"house": "ha", "tablets": ["hall"]})
    tablet = {"subentry_type": "tablet", "unique_id": "hall", "title": "Hall",
              "data": {"name": "Hall", "screen": "dashboard-hall", "user": "hall", "room": "hall", "uid": "hall"}}
    screen = {"subentry_type": "dashboard", "unique_id": "dashboard-hall", "title": "Hall",
              "data": {"screensaver": True}}
    e = house_entry(screen, tablet, entry_id=ENTRY, minor_version=16,
                    data={"mantel_link": {"url": mantel_server.url, "token": mantel_server.token},
                          "mantel_owners": {"house": "ha", "tablets": ["hall"]}})
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await until(hass, lambda: (s := hass.states.get(BLACK)) is not None and s.state != "unavailable")
    assert hass.states.get("switch.hk_frontend_seasonal_decorations").state == "on", "HA's own"
    from custom_components.hk_frontend import screensaver
    mgr = screensaver.manager(hass)
    assert "hall" not in mgr.entities and "hall" not in mgr.engines, "no engine of HA's for Mantel's tablet"
    handler = mantel_server.linked.handler
    await hass.services.async_call(DOMAIN, "set_black_screen", {"entity_id": BLACK, "black": True,
                                                                "brightness": 120}, blocking=True)
    assert handler.calls[-1]["targets"] == [{"entity_id": BLACK, "unique_id": BLACK_UID}]
    assert hass.states.get(BLACK).state == "on" and hass.states.get(BLACK).attributes["confirmed"] is False
    assert await hass.config_entries.async_unload(e.entry_id)
