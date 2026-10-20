"""Pairing by code (pairing.py; slice 9.4): Mantel Link's setup takes Mantel's address and the one-time code an
Owner made in Mantel Settings, trades it for a credential and checks Mantel's proof before believing it; a wrong
or spent code, a look-alike Mantel, and a form with neither code nor credential are each refused in words."""
from __future__ import annotations

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType

from mantel_fake import INSTANCE, TOKEN, until

CODE = "ABCDE-FGHJK-MNPQR-STVWX"


async def _flow(hass, **data):
    r = await hass.config_entries.flow.async_init("mantel", context={"source": config_entries.SOURCE_USER})
    return await hass.config_entries.flow.async_configure(r["flow_id"], data)


async def test_a_pairing_code_sets_mantel_link_up(hass, mantel):
    mantel.code = CODE
    r = await _flow(hass, url=mantel.url, code=" abcde fghjk-mnpqr-stvwx ")
    assert r["type"] is FlowResultType.CREATE_ENTRY and r["data"] == {"url": mantel.url, "token": TOKEN}
    assert hass.config_entries.async_entries("mantel")[0].unique_id == INSTANCE
    assert mantel.code is None, "spent"
    sent = [m for m in mantel.received if m["type"] == "pair"]
    assert sent == [{"type": "pair", "code_id": "ABCDE", "name": "Home Assistant - Mantel Link"}]
    e = hass.config_entries.async_entries("mantel")[0]
    await until(hass, lambda: e.runtime_data.connected)


async def test_refusals(hass, mantel):
    mantel.code = CODE
    r = await _flow(hass, url=mantel.url)
    assert r["errors"] == {"base": "code_or_token"}
    r = await _flow(hass, url=mantel.url, code="ABCDE-FGHJK-MNPQR-STVWZ")
    assert r["errors"] == {"base": "invalid_code"}
    r = await _flow(hass, url=mantel.url, code="not a code")
    assert r["errors"] == {"base": "invalid_code"}
    mantel.lie = True
    r = await _flow(hass, url=mantel.url, code=CODE)
    assert r["errors"] == {"base": "not_mantel"}, "a look-alike can't hand over a credential"
    assert not hass.config_entries.async_entries("mantel")
    r = await _flow(hass, url="http://192.0.2.10:8099", code=CODE)
    assert r["errors"] == {"base": "url_insecure"}
