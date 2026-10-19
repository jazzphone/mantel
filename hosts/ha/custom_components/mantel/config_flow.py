"""Setting Mantel Link up: Mantel's address and a way in.

  * By hand (Settings -> Devices & Services -> Add -> Mantel Link): Mantel's
    address and a Mantel Service credential (scope `linked`, Mantel Settings ->
    Service Accounts). Tested before it is saved: Mantel must answer the link
    with this credential.
  * Reconfigure: a new address or credential (left empty, the saved one stays).

One Mantel is one entry: the entry's unique id is the instance id Mantel says
in its hello (not a secret).
"""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_TOKEN, CONF_URL, DOMAIN, NAME, PROTOCOL
from .mantel_link import LinkError, plain_target, probe, ws_url

_LOGGER = logging.getLogger(__name__)


async def check_url(address: str) -> str | None:
    """An error key for the form, or None. https/wss anywhere; plain http only
    to this machine or Home Assistant's internal App network (the Mantel App),
    checked by what the name resolves to -- else the credential would cross
    the network in clear."""
    try:
        ws_url(address)
    except ValueError:
        return "url_invalid"
    bad, _ = await plain_target(address)
    return {"mantel_url_insecure": "url_insecure", "mantel_url_not_internal": "url_not_internal"}.get(bad or "", bad)


async def try_link(hass, url: str, token: str) -> tuple[dict[str, Any] | None, str | None]:
    """(Mantel's hello, None) or (None, error key)."""
    bad = await check_url(url)
    if bad:
        return None, bad
    try:
        hello = await probe(async_get_clientsession(hass), url, token, domain=DOMAIN, protocol=PROTOCOL)
    except LinkError as err:
        _LOGGER.debug("%s: the test link failed: %s", NAME, err.message)
        return None, {"invalid_auth": "invalid_auth", "protocol": "mantel_too_old",
                      "mantel_url_not_internal": "url_not_internal"}.get(err.code, "cannot_connect")
    return hello, None


class MantelFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url, token = user_input[CONF_URL].strip(), user_input[CONF_TOKEN].strip()
            hello, err = await try_link(self.hass, url, token)
            if err:
                errors["base"] = err
            else:
                return await self._create(url, token, hello)
        return self.async_show_form(step_id="user", data_schema=vol.Schema({
            vol.Required(CONF_URL, default=(user_input or {}).get(CONF_URL, "")): str,
            vol.Required(CONF_TOKEN): str,
        }), errors=errors)

    async def _create(self, url: str, token: str, hello: dict[str, Any] | None) -> ConfigFlowResult:
        instance = (hello or {}).get("instance")
        if isinstance(instance, str) and instance:
            await self.async_set_unique_id(instance)
            self._abort_if_unique_id_configured(updates={CONF_URL: url, CONF_TOKEN: token})
        return self.async_create_entry(title="Mantel", data={CONF_URL: url, CONF_TOKEN: token})

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip()
            token = (user_input.get(CONF_TOKEN) or "").strip() or entry.data[CONF_TOKEN]
            hello, err = await try_link(self.hass, url, token)
            if err:
                errors["base"] = err
            else:
                instance = (hello or {}).get("instance")
                if entry.unique_id and instance and instance != entry.unique_id:
                    errors["base"] = "another_mantel"
                else:
                    return self.async_update_reload_and_abort(entry, data_updates={CONF_URL: url, CONF_TOKEN: token})
        return self.async_show_form(step_id="reconfigure", data_schema=vol.Schema({
            vol.Required(CONF_URL, default=entry.data.get(CONF_URL, "")): str,
            vol.Optional(CONF_TOKEN): str,
        }), errors=errors)
