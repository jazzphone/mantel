"""Setting Mantel Link up by hand (config_flow.py) and what it says about
itself: the address and Service credential tested before they are saved, one
entry per Mantel (its instance id), the link announcing itself as Mantel Link
speaking protocol 2, and diagnostics that never show the credential."""
from __future__ import annotations

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType

from conftest import linked
from mantel_fake import INSTANCE, TOKEN, until

DOMAIN = "mantel"


async def _flow(hass, url, token):
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert r["type"] is FlowResultType.FORM and r["step_id"] == "user"
    return await hass.config_entries.flow.async_configure(r["flow_id"], {"url": url, "token": token})


async def test_set_up_by_hand_tested_first_one_entry_per_mantel(hass, mantel):
    r = await _flow(hass, mantel.url, "msvc_wrong")
    assert r["type"] is FlowResultType.FORM and r["errors"] == {"base": "invalid_auth"}
    r = await _flow(hass, mantel.url, TOKEN)
    assert r["type"] is FlowResultType.CREATE_ENTRY and r["title"] == "Mantel"
    assert r["data"] == {"url": mantel.url, "token": TOKEN}
    e = hass.config_entries.async_entries(DOMAIN)[0]
    assert e.unique_id == INSTANCE
    await hass.async_block_till_done()
    await until(hass, lambda: e.runtime_data.connected)
    # the link says who it is: Mantel Link, protocol 2, can take the bridge
    h = mantel.headers[-1]
    assert h["X-Mantel-Link"] == "domain=mantel; protocol=2; features=bridge,live_tv"
    assert h["Authorization"] == f"Bearer {TOKEN}" and "Origin" not in h
    # and tells Mantel this Home Assistant has no HK Frontend
    await until(hass, lambda: [r for r in mantel.reports if "phones" in r])
    assert [r for r in mantel.reports if "phones" in r][-1] == {"hk_frontend": {"installed": False, "loaded": False, "linked": False}, "phones": []}
    # and, on its own, the installed versions (Mantel's update check)
    await until(hass, lambda: [r for r in mantel.reports if "versions" in r])
    got = [r for r in mantel.reports if "versions" in r][-1]["versions"]
    assert set(got) == {"mantel"} and got["mantel"]
    # a second add of the same Mantel is refused (one entry)
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert r["type"] is FlowResultType.ABORT and r["reason"] == "single_instance_allowed"


async def test_the_address_rules(hass, mantel):
    for url, err in (("mantel.example", "url_invalid"), ("https://u:p@mantel.example", "url_invalid"),
                     ("http://192.0.2.10:8099", "url_insecure"), ("http://mantel.example.com", "url_insecure"),
                     ("https://127.0.0.1:1", "cannot_connect")):
        r = await _flow(hass, url, TOKEN)
        assert r["type"] is FlowResultType.FORM and r["errors"] == {"base": err}, url


async def test_an_older_mantel_is_named(hass, mantel):
    mantel.protocol = 1                       # a Mantel that answers only protocol 1
    r = await _flow(hass, mantel.url, TOKEN)
    assert r["errors"] == {"base": "mantel_too_old"}


async def test_reconfigure_keeps_the_saved_credential(hass, mantel):
    e = await linked(hass, mantel)
    r = await e.start_reconfigure_flow(hass)
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {"url": mantel.url + "/"})
    assert r["type"] is FlowResultType.ABORT and r["reason"] == "reconfigure_successful"
    assert e.data["token"] == TOKEN and e.data["url"] == mantel.url + "/"


async def test_diagnostics_never_show_the_credential(hass, mantel):
    from custom_components.mantel.diagnostics import async_get_config_entry_diagnostics
    e = await linked(hass, mantel)
    d = await async_get_config_entry_diagnostics(hass, e)
    assert d["connected"] is True and d["protocol"] == 2 and d["instance"] == INSTANCE
    assert d["state"] == "mirroring" and d["hk_frontend"]["installed"] is False
    assert TOKEN not in repr(d) and TOKEN not in repr(e.runtime_data.link)
