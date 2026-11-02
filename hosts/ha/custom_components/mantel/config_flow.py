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
  * Reconfigure: a new address or credential (left empty, the saved one stays), or a pairing code.
  * Mantel by its address (2026-11-02): an https address whose certificate isn't a public one (Mantel's own, at
    https://<address>:8766) pairs by protocol v3, and the entry keeps Mantel's CA to pin (CONF_CA).

ONE MANTEL, ONE ENTRY: the entry's unique id is the instance id Mantel says in
its hello and announcements (not a secret). A second Mantel is refused (not
HA's `single_config_entry`, which would also refuse the App's announcement of
its new credential to the entry it set up).
"""
from __future__ import annotations

import logging
from ipaddress import ip_address
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import voluptuous as vol

from homeassistant.config_entries import SOURCE_HASSIO, ConfigFlow, ConfigFlowResult
from homeassistant.helpers.service_info.hassio import HassioServiceInfo
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import CONF_CA, CONF_TOKEN, CONF_URL, DOMAIN, NAME, PROTOCOL, URL_PLACEHOLDERS
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


async def try_link(hass, url: str, token: str, ca: str | None = None) -> tuple[dict[str, Any] | None, str | None]:
    """(Mantel's hello, None) or (None, error key). `ca`: Mantel's CA, pinned."""
    bad = await check_url(url)
    if bad:
        return None, bad
    try:
        hello = await probe(async_get_clientsession(hass), url, token, domain=DOMAIN, protocol=PROTOCOL,
                            **({"ca": ca} if ca else {}))
    except LinkError as err:
        _LOGGER.debug("%s: the test link failed: %s", NAME, err.message)
        return None, {"invalid_auth": "invalid_auth", "protocol": "mantel_too_old",
                      "mantel_url_not_internal": "url_not_internal"}.get(err.code, "cannot_connect")
    return hello, None


LINK_PORT = 8766            # Mantel Connect's listener, where Mantel pins its own certificate (pairing v3)


def pinned_first(url: str) -> bool:
    """An https address that can only be Mantel's own certificate: an IP address (public certificates name names) or
    Mantel's link port. Paired by v3 straight away, with no publicly-checked handshake that is bound to fail first."""
    parts = urlsplit(url.strip())
    if parts.scheme.lower() not in ("https", "wss") or not parts.hostname:
        return False
    try:
        ip_address(parts.hostname)
        return True
    except ValueError:
        return parts.port == LINK_PORT


async def try_pair(hass, url: str, code: str) -> tuple[dict[str, Any] | None, str | None]:
    """({"token", "ca"?}, None) or (None, error key): the pairing code traded at Mantel. An https address whose
    certificate isn't a public one is paired again by v3, which hands over Mantel's CA to pin."""
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
    session = async_get_clientsession(hass)
    try:
        if pinned_first(url):
            got = await pair(session, url, code, pinned=True)
        else:
            try:
                got = await pair(session, url, code, **how)
            except PairingFailed as err:
                if err.code != "certificate":
                    raise
                got = await pair(session, url, code, pinned=True)
    except PairingFailed as err:
        _LOGGER.debug("%s: pairing failed: %s", NAME, err.message)
        return None, {"invalid_code": "invalid_code", "rate_limited": "rate_limited", "not_mantel": "not_mantel",
                      "wrong_address": "wrong_address", "mantel_too_old": "mantel_too_old",
                      "pin_elsewhere": "pin_elsewhere"}.get(err.code, "cannot_connect")
    return {"token": got["token"], **({CONF_CA: got["ca"]} if got.get("ca") else {})}, None


def _without_ca(data: Any) -> dict[str, Any]:
    """The entry's data without its pinned CA (a new pairing or address brings its own, or none)."""
    return {k: v for k, v in dict(data).items() if k != CONF_CA}


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
            err, ca = None, None
            if code:
                got, err = await try_pair(self.hass, url, code)
                token, ca = (got or {}).get("token"), (got or {}).get(CONF_CA)
            elif not token:
                err = "code_or_token"
            if not err:
                hello, err = await try_link(self.hass, url, token, ca)
            if err:
                errors["base"] = err
            else:
                return await self._create(url, token, hello, ca)
        return self.async_show_form(step_id="user", data_schema=vol.Schema({
            vol.Required(CONF_URL, default=(user_input or {}).get(CONF_URL, "")): str,
            vol.Optional(CONF_CODE): str,
            vol.Optional(CONF_TOKEN): str,
        }), errors=errors, description_placeholders=URL_PLACEHOLDERS)

    async def _create(self, url: str, token: str, hello: dict[str, Any] | None, ca: str | None = None) -> ConfigFlowResult:
        instance = (hello or {}).get("instance")
        data = {CONF_URL: url, CONF_TOKEN: token, **({CONF_CA: ca} if ca else {})}
        if isinstance(instance, str) and instance:
            await self.async_set_unique_id(instance, raise_on_progress=False)
            self._abort_if_unique_id_configured(updates=data)
        if (other := self._one_mantel(instance)) is not None:
            return other
        return self.async_create_entry(title="Mantel", data=data)

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
        instance, url, link = props.get("instance"), props.get("url"), props.get("link")
        if not (isinstance(instance, str) and len(instance) == 32 and isinstance(url, str)
                and url.startswith("https://")):
            return self.async_abort(reason="invalid_discovery")
        # Mantel's link address, when it announces one: linked there, Mantel's own certificate is pinned (pairing
        # v3), with no name, DNS or proxy in between. The announcement is no more trusted for it: the pairing code
        # still proves who answers, and Mantel refuses an address that isn't its own
        if isinstance(link, str) and link.startswith("https://") and pinned_first(link):
            url = link
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
            got, err = await try_pair(self.hass, url, (user_input.get(CONF_CODE) or "").strip())
            token, ca = (got or {}).get("token"), (got or {}).get(CONF_CA)
            hello = None
            if not err:
                hello, err = await try_link(self.hass, url, token, ca)
            if not err and (hello or {}).get("instance") != self.unique_id:
                err = "another_mantel"
            if err:
                errors["base"] = err
            else:
                return self.async_create_entry(title="Mantel", data={CONF_URL: url, CONF_TOKEN: token,
                                                                     **({CONF_CA: ca} if ca else {})})
        return self.async_show_form(step_id="zeroconf_confirm", errors=errors,
                                    data_schema=vol.Schema({vol.Required(CONF_CODE): str}),
                                    description_placeholders={"url": url, **URL_PLACEHOLDERS})

    # ---- Mantel refused the saved credential (revoked in Mantel Settings, or never followed an App's new one):
    # Home Assistant asks for a new one, by a pairing code (as at setup) or a pasted Service credential
    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        url = entry.data[CONF_URL]
        if user_input is not None:
            code = (user_input.get(CONF_CODE) or "").strip()
            token = (user_input.get(CONF_TOKEN) or "").strip()
            err, ca = None, entry.data.get(CONF_CA)
            if code:
                got, err = await try_pair(self.hass, url, code)
                token, ca = (got or {}).get("token"), (got or {}).get(CONF_CA)
            elif not token:
                err = "code_or_token"
            hello = None
            if not err:
                hello, err = await try_link(self.hass, url, token, ca)
            if not err:
                instance = (hello or {}).get("instance")
                if entry.unique_id and instance and instance != entry.unique_id:
                    err = "another_mantel"
            if err:
                errors["base"] = err
            else:
                return self.async_update_reload_and_abort(entry, data={**_without_ca(entry.data), CONF_TOKEN: token,
                                                                       **({CONF_CA: ca} if ca else {})})
        return self.async_show_form(step_id="reauth_confirm", data_schema=vol.Schema({
            vol.Optional(CONF_CODE): str,
            vol.Optional(CONF_TOKEN): str,
        }), errors=errors, description_placeholders={"url": url, **URL_PLACEHOLDERS})

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip()
            code = (user_input.get(CONF_CODE) or "").strip()
            token = (user_input.get(CONF_TOKEN) or "").strip() or entry.data[CONF_TOKEN]
            # the pinned CA goes with the address it was paired at; a new address pins again with a pairing code
            ca, err = (entry.data.get(CONF_CA) if url == entry.data.get(CONF_URL) else None), None
            if code:
                got, err = await try_pair(self.hass, url, code)
                token, ca = (got or {}).get("token"), (got or {}).get(CONF_CA)
            hello = None
            if not err:
                hello, err = await try_link(self.hass, url, token, ca)
            if err:
                errors["base"] = err
            else:
                instance = (hello or {}).get("instance")
                if entry.unique_id and instance and instance != entry.unique_id:
                    errors["base"] = "another_mantel"
                else:
                    return self.async_update_reload_and_abort(entry, data={**_without_ca(entry.data), CONF_URL: url,
                                                                           CONF_TOKEN: token, **({CONF_CA: ca} if ca else {})})
        return self.async_show_form(step_id="reconfigure", data_schema=vol.Schema({
            vol.Required(CONF_URL, default=entry.data.get(CONF_URL, "")): str,
            vol.Optional(CONF_CODE): str,
            vol.Optional(CONF_TOKEN): str,
        }), errors=errors, description_placeholders=URL_PLACEHOLDERS)
