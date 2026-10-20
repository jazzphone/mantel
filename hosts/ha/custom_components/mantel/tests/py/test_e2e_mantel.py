"""Mantel Link END TO END, in one process: this integration (Home Assistant's
test harness) linked to Mantel's REAL linked endpoint (mantel_server/linked.py,
its in-memory handler, a real Service account), over a real local socket, with
protocol 2: the hello names the Mantel, the report reaches Mantel, entities
mirror with HK Frontend's unique ids, and set_black_screen's `confirmed`
handshake holds under both names.

Needs a Mantel checkout (MANTEL_ROOT): conftest.py collects it only then; the
Mantel suite runs it (tests/test_mantel_link.py there)."""
from __future__ import annotations

import os
import sqlite3
import sys
import time
from types import SimpleNamespace

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from homeassistant.helpers import entity_registry as er

from conftest import linked
from mantel_fake import BLACK, BLACK_UID, DEVICE, SLEEP, until

_ROOT = os.environ["MANTEL_ROOT"]
for _p in (os.path.join(_ROOT, "hosts", "server"), _ROOT):
    if _p not in sys.path:
        sys.path.append(_p)

from mantel_server import linked as mantel_linked  # noqa: E402
from mantel_server import service_accounts  # noqa: E402

SLEEP_UID = BLACK_UID.replace("black_screen", "sleep_screen")
INSTANCE = "fedcba9876543210fedcba9876543210"


@pytest.fixture
async def mantel_server(socket_enabled):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    service_accounts.ensure_schema(conn)
    accounts = service_accounts.ServiceAccounts(conn)
    acct, token = accounts.create("home-assistant", ["linked"])
    app = web.Application()
    app["clock"] = time.time
    lk = mantel_linked.register(app, None, mantel_linked.LinkedHooks(accounts=accounts, recheck=0.1, heartbeat=None))
    lk.instance = INSTANCE
    await lk.registry.publish({
        "unique_id": BLACK_UID, "platform": "switch", "entity_id": BLACK, "translation_key": "black_screen",
        "icon": "mdi:monitor-off", "device": DEVICE, "state": "off", "tablet": "hall",
        "attributes": {"tablet": "hall", "black_screen": "hk", "brightness": None, "confirmed": False}})
    await lk.registry.publish({
        "unique_id": SLEEP_UID, "platform": "sensor", "entity_id": SLEEP, "translation_key": "sleep_screen",
        "device": DEVICE, "state": "dashboard", "tablet": "hall", "attributes": {"tablet": "hall"}})
    await lk.registry.set_owners({"house": "mantel", "tablets": ["hall"], "bridge": "mantel"})
    server = TestServer(app, host="127.0.0.1")
    await server.start_server()
    yield SimpleNamespace(url=f"http://127.0.0.1:{server.port}", token=token, linked=lk, account=acct,
                          accounts=accounts)
    await server.close()


async def test_mantel_link_against_the_real_endpoint(hass, mantel_server):
    from pytest_homeassistant_custom_component.common import MockConfigEntry
    m = mantel_server
    e = MockConfigEntry(domain="mantel", unique_id=INSTANCE, data={
        "url": m.url, "token": m.token, "owners": {"house": "mantel", "tablets": ["hall"], "bridge": "mantel"}})
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await until(hass, lambda: hass.states.get(BLACK) is not None and hass.states.get(BLACK).state == "off")
    bridge = e.runtime_data
    assert bridge.link.hello["protocol"] == 2 and bridge.link.hello["instance"] == INSTANCE
    # Mantel sees Mantel Link, protocol 2, and its report
    clients = m.linked.registry.clients_of("mantel")
    assert len(clients) == 1 and clients[0].protocol == 2 and "bridge" in clients[0].features
    await until(hass, lambda: clients[0].report.get("hk_frontend") is not None)
    assert clients[0].report["hk_frontend"] == {"installed": False, "loaded": False, "linked": False}
    # the same unique id, a Mantel Link entity now
    ent = er.async_get(hass).async_get(BLACK)
    assert ent.unique_id == BLACK_UID and ent.platform == "mantel"
    # set_black_screen and the confirmed handshake, as mantel.* and as the alias hk_frontend.*
    for domain in ("mantel", "hk_frontend"):
        await hass.services.async_call(domain, "set_black_screen", {"entity_id": BLACK, "black": True,
                                                                   "brightness": 174}, blocking=True)
        st = hass.states.get(BLACK)
        assert st.state == "on" and st.attributes["confirmed"] is False and st.attributes["brightness"] == 174
        await m.linked.handler.page_says(BLACK_UID, True)
        await until(hass, lambda: hass.states.get(BLACK).attributes["confirmed"] is True)
        await hass.services.async_call(domain, "set_black_screen", {"entity_id": BLACK, "black": False},
                                       blocking=True)
        assert hass.states.get(BLACK).state == "off"
    # a pop-up is forwarded and recorded by Mantel's handler
    await hass.services.async_call("mantel", "show_popup", {"popup": "doorbell"}, blocking=True)
    assert m.linked.handler.popups[-1]["service"] == "show_popup"
    assert await hass.config_entries.async_unload(e.entry_id)


async def test_paired_by_code_against_the_real_mantel(hass, socket_enabled):
    """An Owner's code from Mantel's real linked_pairing.py, typed into Mantel Link's form: traded once, Mantel's
    proof checked, the credential opens the link."""
    from homeassistant import config_entries
    from mantel_server import linked_pairing
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    service_accounts.ensure_schema(conn)
    accounts = service_accounts.ServiceAccounts(conn)
    app = web.Application()
    app["clock"] = time.time
    app["service_accounts"] = accounts
    lk = mantel_linked.register(app, None, mantel_linked.LinkedHooks(accounts=accounts, recheck=0.1, heartbeat=None))
    lk.instance = INSTANCE
    pairing = linked_pairing.register(app)
    server = TestServer(app, host="127.0.0.1")
    await server.start_server()
    try:
        url = f"http://127.0.0.1:{server.port}"
        code = pairing.start("owner-1")["code"]
        r = await hass.config_entries.flow.async_init("mantel", context={"source": config_entries.SOURCE_USER})
        r = await hass.config_entries.flow.async_configure(r["flow_id"], {"url": url, "code": code.lower()})
        assert r["type"] == "create_entry", r
        e = hass.config_entries.async_entries("mantel")[0]
        assert e.unique_id == INSTANCE and e.data["token"].startswith("msvc_")
        assert accounts.verify(e.data["token"], "linked").name == "Home Assistant - Mantel Link"
        await until(hass, lambda: e.runtime_data.connected)
        assert pairing.pending() is None, "spent"
        assert await hass.config_entries.async_unload(e.entry_id)
    finally:
        await server.close()
