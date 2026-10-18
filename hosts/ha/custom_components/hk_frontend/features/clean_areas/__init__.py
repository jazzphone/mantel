"""CLEAN AREAS: "clean these areas", sent to whichever vacuums can reach them.

One action, `hk_frontend.clean_areas` (areas, dry_run): each vacuum gets the
chosen areas on its own room map in Home Assistant (clean.py). Used by the
vacuum area picker on the dashboards, and just as usable from an automation
or a voice sentence. One per house: its gear picks which vacuums take part
and which areas the picker offers.

The action is registered at start, not when the feature is added, so a call
made while it is not added gets a clear error rather than "unknown action".
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import SubentryFlowResult
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers import selector as sel
from homeassistant.helpers.dispatcher import async_dispatcher_send

from ...const import DOMAIN
from .. import CLEAN_AREAS, TITLES, Feature, entries, item_data, loaded, unique_id
from . import clean, settings_ws
from .const import CONF_AREAS, CONF_VACUUMS, SERVICE_CLEAN, SIGNAL_CHANGED

PLATFORMS: list = []
RELOAD = False          # nothing to rebuild: the options are read on every call
RENAME = {"options": (CONF_VACUUMS,)}   # followed through an entity rename (rename.py)


async def async_setup(hass: HomeAssistant) -> None:
    async def handle(call: ServiceCall) -> ServiceResponse:
        on = loaded(hass, CLEAN_AREAS)
        if not on:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="clean_areas_not_set_up")
        res: dict[str, Any] = await clean.async_clean(
            hass, list(call.data["areas"]), on[0].options, call.data.get("dry_run", False),
            context=call.context)      # the logbook names who sent the vacuums
        # A caller that asked for the answer reads it; one that did not (an
        # automation) would never learn of a refusal, so for it one RAISES.
        if call.return_response or res.get("ok"):
            return res
        raise HomeAssistantError(res.get("message") or "Nothing was sent to the vacuums.")

    hass.services.async_register(DOMAIN, SERVICE_CLEAN, handle, vol.Schema({
        vol.Required("areas"): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("dry_run", default=False): cv.boolean}),
        supports_response=SupportsResponse.OPTIONAL)
    # the HK Settings page and the area picker (settings_ws.py)
    settings_ws.async_register(hass)


async def async_setup_entry(hass: HomeAssistant, entry: Feature) -> bool:
    # the options are read on every call; nothing to hold
    async_dispatcher_send(hass, SIGNAL_CHANGED)
    return True


async def async_changed(hass: HomeAssistant, entry: Feature) -> None:
    """A change made in its gear tells the open pickers, as the settings
    page's own does."""
    async_dispatcher_send(hass, SIGNAL_CHANGED)


async def async_unload_entry(hass: HomeAssistant, entry: Feature) -> bool:
    async_dispatcher_send(hass, SIGNAL_CHANGED)
    return True


def _schema(areas: bool = False) -> vol.Schema:
    fields: dict = {vol.Optional(CONF_VACUUMS): sel.EntitySelector(
        sel.EntitySelectorConfig(filter={"domain": "vacuum"}, multiple=True))}
    if areas:
        fields[vol.Optional(CONF_AREAS)] = sel.AreaSelector(sel.AreaSelectorConfig(multiple=True))
    return vol.Schema(fields)


class AddSteps:
    """Add feature -> Clean Areas: which vacuums take part."""

    async def async_step_clean_areas(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        if entries(self.hass, CLEAN_AREAS):
            return self.async_abort(reason="already_configured")
        if user_input is not None:
            return self.async_create_entry(
                title=TITLES[CLEAN_AREAS], unique_id=unique_id(CLEAN_AREAS),
                data=item_data(CLEAN_AREAS, options={CONF_VACUUMS: list(user_input.get(CONF_VACUUMS) or [])}))
        return self.async_show_form(step_id="clean_areas", data_schema=_schema())


class ReconfigureSteps:
    """Its gear: which vacuums take part, and which areas the picker offers.
    Every option is written back, so saving the vacuums keeps everything
    else."""

    async def async_step_clean_areas_options(self, user_input: dict[str, Any] | None = None
                                             ) -> SubentryFlowResult:
        opts = self._feature.options
        if user_input is not None:
            return self.async_save_feature(options={
                **opts, CONF_VACUUMS: list(user_input.get(CONF_VACUUMS) or []),
                CONF_AREAS: list(user_input.get(CONF_AREAS) or [])})
        return self.async_show_form(
            step_id="clean_areas_options", data_schema=self.add_suggested_values_to_schema(
                _schema(areas=True), {CONF_VACUUMS: list(opts.get(CONF_VACUUMS) or []),
                                      CONF_AREAS: list(opts.get(CONF_AREAS) or [])}))
