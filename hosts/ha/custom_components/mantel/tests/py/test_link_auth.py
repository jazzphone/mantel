"""A credential Mantel refuses (2026-11-01, audit 3, LINK-5): the link logs it once, tells its integration once,
and retries slowly; Mantel Link starts re-authentication (a pairing code, or a new Service credential) instead of
retrying every 30 s forever. And a config-flow probe hangs up without logging a lost link (LINK-7)."""
from __future__ import annotations

import asyncio
import logging

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType

from conftest import linked
from mantel_fake import INSTANCE, TOKEN, until

CODE = "ABCDE-FGHJK-MNPQR-STVWX"
WRONG = "msvc_00112233445566aa_" + "B" * 43


class Quiet:
    def __init__(self) -> None:
        self.connected: list[bool] = []

    def on_owners(self, o): pass
    def on_hello(self, e): pass
    def on_entity(self, e): pass
    def on_state(self, *a): pass
    def on_removed(self, *a): pass
    def on_connected(self, c): self.connected.append(c)


async def _link(mantel, token, **kw):
    import aiohttp
    from custom_components.mantel.mantel_link import MantelLink
    from custom_components.mantel.const import DOMAIN, PROTOCOL
    session = aiohttp.ClientSession()
    return session, MantelLink(session, mantel.url, token, Quiet(), domain=DOMAIN, protocol=PROTOCOL, **kw)


async def test_a_refused_credential_is_told_once_and_retried_slowly(hass, mantel, caplog):
    caplog.set_level(logging.DEBUG)
    told: list[int] = []
    session, link = await _link(mantel, WRONG, backoff=(0.01, 0.02), auth_backoff=(0.15, 0.3),
                                on_auth_failed=told.append)
    task = asyncio.ensure_future(link.run())
    try:
        await asyncio.sleep(0.8)
        assert told == [401], "told once, with the status"
        assert link.auth_failed and link.last_error == "HTTP 401"
        assert 3 <= link.attempts <= 6, f"paced by the auth back-off (0.15 s doubling to 0.3 s), not 0.02 s: {link.attempts}"
        warned = [r for r in caplog.records if r.levelname == "WARNING" and "refused the link" in r.getMessage()]
        assert len(warned) == 1, "one warning for the streak, not one per try"
        # the credential is put right (a new one on Mantel's side): the link comes up, and asks again if refused again
        mantel.token = WRONG
        await until(hass, lambda: link.connected, 5)
        assert not link.auth_failed
        mantel.token = TOKEN
        await mantel.drop()
        await until(hass, lambda: told == [401, 401], 5)
    finally:
        await link.close()
        task.cancel()
        await session.close()


async def test_a_hook_that_raises_does_not_end_the_link(hass, mantel):
    def bad(_status):
        raise RuntimeError("the integration's hook trips")
    session, link = await _link(mantel, WRONG, backoff=(0.01, 0.02), auth_backoff=(0.05, 0.1), on_auth_failed=bad)
    task = asyncio.ensure_future(link.run())
    try:
        await until(hass, lambda: link.attempts >= 3, 5)
        assert not task.done()
    finally:
        await link.close()
        task.cancel()
        await session.close()


async def test_a_probe_hangs_up_without_logging_a_lost_link(hass, mantel, caplog):
    import aiohttp
    from custom_components.mantel.mantel_link import probe
    from custom_components.mantel.const import DOMAIN, PROTOCOL
    caplog.set_level(logging.DEBUG)
    async with aiohttp.ClientSession() as session:
        hello = await probe(session, mantel.url, TOKEN, domain=DOMAIN, protocol=PROTOCOL)
    assert hello["instance"] == INSTANCE
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING], [r.getMessage() for r in caplog.records]


async def test_a_credential_mantel_revokes_starts_re_authentication(hass, mantel):
    from pytest_homeassistant_custom_component.common import MockConfigEntry
    e = MockConfigEntry(domain="mantel", data={"url": mantel.url, "token": WRONG}, title="Mantel", unique_id=INSTANCE)
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    await until(hass, lambda: any(f["context"].get("source") == config_entries.SOURCE_REAUTH
                                  for f in hass.config_entries.flow.async_progress_by_handler("mantel")))
    flows = [f for f in hass.config_entries.flow.async_progress_by_handler("mantel")
             if f["context"].get("source") == config_entries.SOURCE_REAUTH]
    assert len(flows) == 1 and flows[0]["context"]["entry_id"] == e.entry_id
    # a pairing code from Mantel Settings puts it right: the new credential is saved and the entry reloads
    r = await hass.config_entries.flow.async_configure(flows[0]["flow_id"])
    assert r["type"] is FlowResultType.FORM and r["step_id"] == "reauth_confirm"
    r = await hass.config_entries.flow.async_configure(flows[0]["flow_id"], {})
    assert r["errors"] == {"base": "code_or_token"}
    r = await hass.config_entries.flow.async_configure(flows[0]["flow_id"], {"code": "ABCDE-FGHJK-MNPQR-STVWZ"})
    assert r["errors"] == {"base": "invalid_code"}
    mantel.code = CODE
    r = await hass.config_entries.flow.async_configure(flows[0]["flow_id"], {"code": CODE})
    assert r["type"] is FlowResultType.ABORT and r["reason"] == "reauth_successful"
    assert e.data["token"] == TOKEN and e.data["url"] == mantel.url
    await hass.async_block_till_done()
    await until(hass, lambda: e.runtime_data.connected)


async def test_re_authentication_takes_a_pasted_credential_too_and_only_for_the_same_mantel(hass, mantel):
    from pytest_homeassistant_custom_component.common import MockConfigEntry
    e = MockConfigEntry(domain="mantel", data={"url": mantel.url, "token": WRONG}, title="Mantel", unique_id=INSTANCE)
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    r = await e.start_reauth_flow(hass)
    assert r["type"] is FlowResultType.FORM and r["step_id"] == "reauth_confirm"
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {"token": WRONG})
    assert r["errors"] == {"base": "invalid_auth"}
    mantel.token = WRONG                      # (the stand-in's credential is the one pasted)
    other = "f" * 32
    # a credential that belongs to another Mantel is refused
    from unittest.mock import patch
    with patch("custom_components.mantel.config_flow.try_link", return_value=({"instance": other}, None)):
        r = await hass.config_entries.flow.async_configure(r["flow_id"], {"token": WRONG})
    assert r["errors"] == {"base": "another_mantel"}
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {"token": WRONG})
    assert r["type"] is FlowResultType.ABORT and r["reason"] == "reauth_successful"
    assert e.data["token"] == WRONG
