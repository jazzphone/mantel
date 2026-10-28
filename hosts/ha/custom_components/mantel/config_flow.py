"""Setting Mantel Link up: Mantel's address and a way in.

  * By hand (Settings -> Devices & Services -> Add -> Mantel Link): Mantel's
    address and a PAIRING CODE (Mantel Settings -> Connections -> Home Assistant
    Link; traded once for a credential, pairing.py), or a Mantel Service
    credential (scope `linked`, Mantel Settings -> Service Accounts). Tested
    before it is saved: Mantel must answer the link with the credential.
  * Discovered from the HA App (`async_step_hassio`): the Supervisor hands over
    the App's address and a `linked` credential the App made; one click. The
    App makes a new one each time it starts and announces again: an entry set
    up from that announcement follows it (the same instance id).
  * Discovered on the network (`async_step_zeroconf`, `_mantel._tcp`): Mantel's
    https address and instance id, NO credential (the announcement is not
    authenticated); confirmed with a pairing code from Mantel Settings.
  * Reconfigure: a new address or credential (left empty, the saved one stays).

ONE MANTEL, ONE ENTRY: the entry's unique id is the instance id Mantel says in
its hello and announcements (not a secret). A second Mantel is refused (not
HA's `single_config_entry`, which would also refuse the App's announcement of
its new credential to the entry it set up).
"""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import voluptuous as vol

from homeassistant.config_entries import SOURCE_HASSIO, ConfigFlow, ConfigFlowResult
from homeassistant.helpers.service_info.hassio import HassioServiceInfo
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_TOKEN, CONF_URL, DOMAIN, NAME, PROTOCOL, URL_PLACEHOLDERS
from .mantel_link import LinkError, plain_target, probe, ws_url
from .pairing import PairingFailed, pair, pair_url

CONF_CODE = "code"

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


async def try_pair(hass, url: str, code: str) -> tuple[str | None, str | None]:
    """(a Service credential, None) or (None, error key): the pairing code traded at Mantel."""
    bad = await check_url(url)
    if bad:
        return None, bad
    how: dict[str, Any] = {}
    parts = urlsplit(pair_url(url))
    if parts.scheme == "http":
        # plain http only inside this machine / the App network, to the address checked (as the link does)
        err, addrs = await plain_target(url)
        if err or not addrs:
            return None, "url_not_internal"
        ip = addrs[0].split("%", 1)[0]
        host = f"[{ip}]" if ":" in ip else ip
        how = {"connect_to": urlunsplit(("http", f"{host}:{parts.port}" if parts.port else host, parts.path, "", "")),
               "host_header": parts.netloc}
    try:
        got = await pair(async_get_clientsession(hass), url, code, **how)
    except PairingFailed as err:
        _LOGGER.debug("%s: pairing failed: %s", NAME, err.message)
        return None, {"invalid_code": "invalid_code", "rate_limited": "rate_limited", "not_mantel": "not_mantel",
                      "wrong_address": "wrong_address", "mantel_too_old": "mantel_too_old"}.get(err.code, "cannot_connect")
    return got["token"], None


class MantelFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._found: dict[str, Any] = {}

    def _one_mantel(self, instance: str | None) -> ConfigFlowResult | None:
        """Another Mantel is linked already: an abort (one Mantel per Home Assistant)."""
        for e in self._async_current_entries(include_ignore=False):
            if not instance or e.unique_id != instance:
                return self.async_abort(reason="another_mantel_linked")
        return None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self._async_current_entries(include_ignore=False):
            return self.async_abort(reason="single_instance_allowed")
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip()
            code = (user_input.get(CONF_CODE) or "").strip()
            token = (user_input.get(CONF_TOKEN) or "").strip()
            err = None
            if code:
                token, err = await try_pair(self.hass, url, code)
            elif not token:
                err = "code_or_token"
            if not err:
                hello, err = await try_link(self.hass, url, token)
            if err:
                errors["base"] = err
            else:
                return await self._create(url, token, hello)
        return self.async_show_form(step_id="user", data_schema=vol.Schema({
            vol.Required(CONF_URL, default=(user_input or {}).get(CONF_URL, "")): str,
            vol.Optional(CONF_CODE): str,
            vol.Optional(CONF_TOKEN): str,
        }), errors=errors, description_placeholders=URL_PLACEHOLDERS)

    async def _create(self, url: str, token: str, hello: dict[str, Any] | None) -> ConfigFlowResult:
        instance = (hello or {}).get("instance")
        if isinstance(instance, str) and instance:
            await self.async_set_unique_id(instance, raise_on_progress=False)
            self._abort_if_unique_id_configured(updates={CONF_URL: url, CONF_TOKEN: token})
        if (other := self._one_mantel(instance)) is not None:
            return other
        return self.async_create_entry(title="Mantel", data={CONF_URL: url, CONF_TOKEN: token})

    # ---- discovered from the HA App (the Supervisor)
    async def async_step_hassio(self, discovery_info: HassioServiceInfo) -> ConfigFlowResult:
        cfg = discovery_info.config or {}
        url, token, instance = cfg.get("url"), cfg.get("token"), cfg.get("instance")
        if not all(isinstance(v, str) and v for v in (url, token, instance)):
            return self.async_abort(reason="invalid_discovery")
        await self.async_set_unique_id(instance)
        known = self.hass.config_entries.async_entry_for_domain_unique_id(DOMAIN, instance)
        if known is not None and known.source == SOURCE_HASSIO:
            # set up from the App's announcement: follow its new credential (and address)
            self._abort_if_unique_id_configured(updates={CONF_URL: url, CONF_TOKEN: token})
        self._abort_if_unique_id_configured()
        if (other := self._one_mantel(instance)) is not None:
            return other
        self._found = {CONF_URL: url, CONF_TOKEN: token, "name": discovery_info.name or "Mantel"}
        self.context["title_placeholders"] = {"name": "Mantel"}
        return await self.async_step_hassio_confirm()

    async def async_step_hassio_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            hello, err = await try_link(self.hass, self._found[CONF_URL], self._found[CONF_TOKEN])
            if err:
                errors["base"] = err
            else:
                return self.async_create_entry(title="Mantel", data={CONF_URL: self._found[CONF_URL],
                                                                     CONF_TOKEN: self._found[CONF_TOKEN]})
        return self.async_show_form(step_id="hassio_confirm", errors=errors,
                                    description_placeholders={"addon": self._found.get("name", "Mantel"), **URL_PLACEHOLDERS})

    # ---- discovered on the network (zeroconf: no credential, a pairing code confirms it)
    async def async_step_zeroconf(self, discovery_info: ZeroconfServiceInfo) -> ConfigFlowResult:
        props = discovery_info.properties or {}
        instance, url = props.get("instance"), props.get("url")
        if not (isinstance(instance, str) and len(instance) == 32 and isinstance(url, str)
                and url.startswith("https://")):
            return self.async_abort(reason="invalid_discovery")
        await self.async_set_unique_id(instance)
        # An announcement is unauthenticated, and the instance id in it is no secret (anyone on the network
        # hears it): an entry never follows an announced address, or a look-alike would be handed the link's
        # credential at the next reload. A Mantel that moved is given its new address with Reconfigure.
        self._abort_if_unique_id_configured()
        if (other := self._one_mantel(instance)) is not None:
            return other
        self._found = {CONF_URL: url}
        self.context["title_placeholders"] = {"name": "Mantel"}
        return await self.async_step_zeroconf_confirm()

    async def async_step_zeroconf_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        url = self._found[CONF_URL]
        if user_input is not None:
            token, err = await try_pair(self.hass, url, (user_input.get(CONF_CODE) or "").strip())
            hello = None
            if not err:
                hello, err = await try_link(self.hass, url, token)
            if not err and (hello or {}).get("instance") != self.unique_id:
                err = "another_mantel"
            if err:
                errors["base"] = err
            else:
                return self.async_create_entry(title="Mantel", data={CONF_URL: url, CONF_TOKEN: token})
        return self.async_show_form(step_id="zeroconf_confirm", errors=errors,
                                    data_schema=vol.Schema({vol.Required(CONF_CODE): str}),
                                    description_placeholders={"url": url, **URL_PLACEHOLDERS})

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
        }), errors=errors, description_placeholders=URL_PLACEHOLDERS)
