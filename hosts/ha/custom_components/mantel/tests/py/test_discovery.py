"""Discovery (slice 9.5): "Discovered: Mantel" from the HA App (the Supervisor hands over the App's address and the
credential it made: one click) and on the network (zeroconf `_mantel._tcp`: no credential, a pairing code confirms
it). One Mantel per Home Assistant: the same Mantel's announcement updates its entry (the App's new credential,
Mantel's new address), never a second entry; another Mantel is refused."""
from __future__ import annotations

import json
import os
from ipaddress import ip_address

from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.service_info.hassio import HassioServiceInfo
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

from conftest import COMPONENT
from custom_components.mantel.const import URL_PLACEHOLDERS
from mantel_fake import INSTANCE, TOKEN, until

OTHER = "f" * 32


def hassio(fake, token=TOKEN, instance=INSTANCE):
    return HassioServiceInfo(config={"url": fake.url, "token": token, "instance": instance}, name="Mantel",
                             slug="local_mantel", uuid="0123")


def zeroconf(url="https://mantel.example.com", instance=INSTANCE):
    return ZeroconfServiceInfo(ip_address=ip_address("192.0.2.20"), ip_addresses=[ip_address("192.0.2.20")],
                               port=443, hostname="mantel.local.", type="_mantel._tcp.local.",
                               name=f"Mantel {instance[:6]}._mantel._tcp.local.",
                               properties={"instance": instance, "url": url, "path": "/linked/ws", "version": ""})


def test_the_manifest_asks_for_mantel_s_announcements():
    m = json.load(open(os.path.join(COMPONENT, "manifest.json")))
    assert m["zeroconf"] == ["_mantel._tcp.local."] and "single_config_entry" not in m


async def test_discovered_from_the_app_one_click(hass, mantel):
    r = await hass.config_entries.flow.async_init("mantel", context={"source": config_entries.SOURCE_HASSIO},
                                                  data=hassio(mantel))
    assert r["type"] is FlowResultType.FORM and r["step_id"] == "hassio_confirm"
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {})
    assert r["type"] is FlowResultType.CREATE_ENTRY and r["data"] == {"url": mantel.url, "token": TOKEN}
    e = hass.config_entries.async_entries("mantel")[0]
    assert e.unique_id == INSTANCE and e.source == config_entries.SOURCE_HASSIO
    await until(hass, lambda: e.runtime_data.connected)


async def test_the_app_s_new_credential_follows_into_its_entry(hass, mantel):
    e = MockConfigEntry(domain="mantel", unique_id=INSTANCE, source=config_entries.SOURCE_HASSIO,
                        data={"url": mantel.url, "token": "msvc_old"})
    e.add_to_hass(hass)
    r = await hass.config_entries.flow.async_init("mantel", context={"source": config_entries.SOURCE_HASSIO},
                                                  data=hassio(mantel))
    assert r["type"] is FlowResultType.ABORT and r["reason"] == "already_configured"
    assert e.data["token"] == TOKEN, "the App's new credential"


async def test_a_link_set_up_by_hand_is_left_alone(hass, mantel):
    e = MockConfigEntry(domain="mantel", unique_id=INSTANCE, source=config_entries.SOURCE_USER,
                        data={"url": "https://mantel.example.com", "token": "msvc_mine"})
    e.add_to_hass(hass)
    for info, source in ((hassio(mantel), config_entries.SOURCE_HASSIO),
                         (zeroconf("https://elsewhere.example.com"), config_entries.SOURCE_ZEROCONF)):
        r = await hass.config_entries.flow.async_init("mantel", context={"source": source}, data=info)
        assert r["type"] is FlowResultType.ABORT and r["reason"] == "already_configured"
    assert e.data == {"url": "https://mantel.example.com", "token": "msvc_mine"}


async def test_another_mantel_is_refused(hass, mantel):
    MockConfigEntry(domain="mantel", unique_id=INSTANCE, data={"url": mantel.url, "token": TOKEN}).add_to_hass(hass)
    for info, source in ((hassio(mantel, instance=OTHER), config_entries.SOURCE_HASSIO),
                         (zeroconf(instance=OTHER), config_entries.SOURCE_ZEROCONF)):
        r = await hass.config_entries.flow.async_init("mantel", context={"source": source}, data=info)
        assert r["type"] is FlowResultType.ABORT and r["reason"] == "another_mantel_linked"


async def test_discovered_on_the_network_confirmed_with_a_code(hass, monkeypatch):
    from custom_components.mantel import config_flow as CF
    seen = {}

    async def fake_pair(hass_, url, code):
        seen["pair"] = (url, code)
        return (TOKEN, None) if code == "ABCDE-FGHJK-MNPQR-STVWX" else (None, "invalid_code")

    async def fake_link(hass_, url, token):
        seen["link"] = (url, token)
        return {"protocol": 2, "instance": INSTANCE}, None
    monkeypatch.setattr(CF, "try_pair", fake_pair)
    monkeypatch.setattr(CF, "try_link", fake_link)
    r = await hass.config_entries.flow.async_init("mantel", context={"source": config_entries.SOURCE_ZEROCONF},
                                                  data=zeroconf())
    assert r["type"] is FlowResultType.FORM and r["step_id"] == "zeroconf_confirm"
    assert r["description_placeholders"] == {"url": "https://mantel.example.com", **URL_PLACEHOLDERS}
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {"code": "WRONG"})
    assert r["errors"] == {"base": "invalid_code"}
    from custom_components.mantel import bridge as B
    monkeypatch.setattr(B.Bridge, "start", lambda self: None)     # no link to the fictional address
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {"code": "ABCDE-FGHJK-MNPQR-STVWX"})
    assert r["type"] is FlowResultType.CREATE_ENTRY
    assert r["data"] == {"url": "https://mantel.example.com", "token": TOKEN}
    assert seen["link"] == ("https://mantel.example.com", TOKEN)
    e = hass.config_entries.async_entries("mantel")[0]
    assert e.unique_id == INSTANCE and e.source == config_entries.SOURCE_ZEROCONF
    # the same instance id announced at another address: anyone can announce it, so the entry keeps the address
    # it was paired with (the credential is never sent to the announcer); no second entry
    r = await hass.config_entries.flow.async_init("mantel", context={"source": config_entries.SOURCE_ZEROCONF},
                                                  data=zeroconf("https://mantel2.example.com"))
    assert r["reason"] == "already_configured" and e.data["url"] == "https://mantel.example.com"
    assert len(hass.config_entries.async_entries("mantel")) == 1


async def test_announcements_that_are_not_mantel_s(hass):
    for info in (zeroconf("http://mantel.example.com"), zeroconf(instance="short")):
        r = await hass.config_entries.flow.async_init("mantel", context={"source": config_entries.SOURCE_ZEROCONF},
                                                      data=info)
        assert r["type"] is FlowResultType.ABORT and r["reason"] == "invalid_discovery"
    bad = HassioServiceInfo(config={"url": "http://local-mantel:8099"}, name="Mantel", slug="local_mantel", uuid="1")
    r = await hass.config_entries.flow.async_init("mantel", context={"source": config_entries.SOURCE_HASSIO}, data=bad)
    assert r["reason"] == "invalid_discovery"
