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
    assert sent == [{"type": "pair", "v": 2, "code_id": "ABCDE", "name": "Home Assistant - Mantel Link",
                     "address": mantel.url}], "protocol v2, with the address it used"
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


def test_addresses_are_normalised_as_mantel_does():
    from custom_components.mantel.pairing import normalize_address as n
    assert n("https://Mantel.Example.com") == "https://mantel.example.com:443"
    assert n("https://mantel.example.com/") == "https://mantel.example.com:443"
    assert n("https://mantel.example.com:443/x?y=1") == "https://mantel.example.com:443"
    assert n("HTTP://local-mantel") == "http://local-mantel:80"
    assert n("http://local-mantel:8099/") == "http://local-mantel:8099"
    assert n("wss://mantel.example.com:8443/linked/ws") == "https://mantel.example.com:8443"
    assert n("http://[FD00::1]:8099") == "http://[fd00::1]:8099"
    assert n("https://[::1]/") == "https://[::1]:443"
    assert n("https://mantel.example.com.") == "https://mantel.example.com:443"
    for bad in ("", "mantel.example.com", "ftp://x", "https://", "https://m:99999", None):
        assert n(bad) is None, bad


async def test_the_address_is_sent_normalised_and_bound(hass, mantel):
    mantel.code = CODE
    r = await _flow(hass, url=mantel.url + "/", code=CODE)
    assert r["type"] is FlowResultType.CREATE_ENTRY, r
    assert [m["address"] for m in mantel.received if m["type"] == "pair"] == [mantel.url]


async def test_a_relaying_look_alike_at_another_address_cannot_pair(hass, mantel):
    """Home Assistant reached something at an address Mantel doesn't call its own (a look-alike passing the exchange
    on): Mantel refuses, and Mantel Link says so."""
    mantel.code = CODE
    mantel.own_address = "https://mantel.example.com:443"
    r = await _flow(hass, url=mantel.url, code=CODE)
    assert r["errors"] == {"base": "wrong_address"}
    assert not hass.config_entries.async_entries("mantel") and mantel.code == CODE, "not spent"


async def test_mantel_s_proof_must_name_the_address_mantel_link_used(hass, mantel):
    mantel.code = CODE
    mantel.signs_address = "https://mantel-lookalike.lan:443"
    r = await _flow(hass, url=mantel.url, code=CODE)
    assert r["errors"] == {"base": "not_mantel"}
    assert not hass.config_entries.async_entries("mantel")


async def test_an_older_mantel_says_update_mantel_first_and_there_is_no_downgrade(hass, mantel):
    mantel.code = CODE
    mantel.pair_version = 1
    r = await _flow(hass, url=mantel.url, code=CODE)
    assert r["errors"] == {"base": "mantel_too_old"}
    sent = [m for m in mantel.received if m["type"] == "pair"]
    assert [m["v"] for m in sent] == [2], "never retried as v1"
    assert mantel.code == CODE and not hass.config_entries.async_entries("mantel")
