"""ALARM PIN: a PIN in front of an alarm that takes none.

Some alarm integrations arm and disarm for anyone who can call them (their
panel reports `code_format: None`). Add Alarm PIN for such an alarm and it
provides a second alarm panel that mirrors the first -- its state, its
availability, its features -- and arms or disarms it only with the right PIN.
A wrong PIN is REFUSED with Home Assistant's own error, so every keypad (HA's
alarm card, the app, voice, the HK keypad) says so, with no helper entities.

One item per protected alarm ("<alarm> PIN"); its unique id names the alarm.
The PIN is never stored, only a salted hash (pin.py). Point keypads and
dashboards at the PIN panel; automations can keep using the alarm itself.

  * Add feature -> Alarm PIN   the alarm to protect, a PIN (typed twice),
                             whether arming needs it;
  * its gear                 another alarm, a new PIN typed twice (both empty
                             keeps the current one), the arm rule;
  * the settings page        the same, through settings_ws.py.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import SubentryFlowResult
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .. import ALARM_PIN, Feature, item_data, unique_id
from . import checks, settings_ws
from .const import ALREADY, CONF_ALARM, CONF_ARM_REQUIRED
from .pin import hash_pin

PLATFORMS = [Platform.ALARM_CONTROL_PANEL]
RELOAD = True           # a new PIN, the arm rule or another alarm: the panel is rebuilt with it
RENAME = {"data": (CONF_ALARM,)}        # followed through an entity rename (rename.py)


def renamed(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """The item's unique id and title name the alarm, so they move with it."""
    alarm = str(data.get(CONF_ALARM) or "")
    return {"unique_id": unique_id(ALARM_PIN, alarm), "title": checks.item_title(hass, alarm)}


async def async_setup(hass: HomeAssistant) -> None:
    # the HK Settings page (settings_ws.py)
    settings_ws.async_register(hass)


async def async_setup_entry(hass: HomeAssistant, entry: Feature) -> bool:
    return True                        # its panel is its whole runtime


async def async_unload_entry(hass: HomeAssistant, entry: Feature) -> bool:
    return True


async def async_diagnostics(hass: HomeAssistant, entry: Feature) -> dict[str, Any]:
    """The protected alarm and the arm rule -- never the PIN's hash or its salt."""
    from homeassistant.components.diagnostics import async_redact_data
    return {"data": dict(entry.data),
            "options": async_redact_data(dict(entry.options), {"hash", "salt"})}


class AddSteps:
    """Add feature -> Alarm PIN: the alarm to protect, a PIN (typed twice),
    whether arming needs it."""

    async def async_step_alarm_pin(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            alarm = user_input[CONF_ALARM]
            if err := checks.alarm_error(self.hass, alarm):
                errors[CONF_ALARM] = err
            pin = "" if errors else checks.new_pin(user_input, errors, required=True)
            if not errors:
                stored = await self.hass.async_add_executor_job(hash_pin, pin)
                if checks.protected_by(self.hass, alarm) is not None:     # a race: checked above
                    return self.async_abort(reason=ALREADY)
                return self.async_create_entry(
                    title=checks.item_title(self.hass, alarm), unique_id=unique_id(ALARM_PIN, alarm),
                    data=item_data(ALARM_PIN, {CONF_ALARM: alarm}, {
                        CONF_ARM_REQUIRED: bool(user_input.get(CONF_ARM_REQUIRED, True)), **stored}))
        return self.async_show_form(step_id="alarm_pin", errors=errors, data_schema=vol.Schema({
            vol.Required(CONF_ALARM): checks.alarm_picker(self.hass),
            vol.Required("pin"): checks.pin_field(),
            vol.Required("pin_again"): checks.pin_field(),
            vol.Optional(CONF_ARM_REQUIRED, default=True): bool,
        }))


class ReconfigureSteps:
    """Its gear: the alarm it protects, a new PIN (both empty keeps the
    current one) and the arm rule. Options it does not show are kept."""

    async def async_step_alarm_pin_options(self, user_input: dict[str, Any] | None = None
                                           ) -> SubentryFlowResult:
        entry = self._feature
        current = dict(entry.options)
        errors: dict[str, str] = {}
        if user_input is not None:
            alarm = user_input.get(CONF_ALARM) or entry.data[CONF_ALARM]
            if err := checks.alarm_error(self.hass, alarm, entry.entry_id):
                errors[CONF_ALARM] = err
            pin = checks.new_pin(user_input, errors, required=False)
            if not errors:
                options = {**current, CONF_ARM_REQUIRED: bool(user_input.get(CONF_ARM_REQUIRED, True))}
                if pin:
                    options.update(await self.hass.async_add_executor_job(hash_pin, pin))
                if alarm != entry.data[CONF_ALARM]:
                    # The item IS the alarm it protects: its data, unique id
                    # and title follow, in the same write as the options, so
                    # the panel is rebuilt once.
                    return self.async_save_feature(
                        data={**entry.data, CONF_ALARM: alarm}, options=options,
                        unique_id=unique_id(ALARM_PIN, alarm), title=checks.item_title(self.hass, alarm))
                return self.async_save_feature(options=options)
        return self.async_show_form(
            step_id="alarm_pin_options", errors=errors,
            data_schema=self.add_suggested_values_to_schema(vol.Schema({
                vol.Required(CONF_ALARM): checks.alarm_picker(self.hass),
                vol.Optional("pin"): checks.pin_field(),
                vol.Optional("pin_again"): checks.pin_field(),
                vol.Optional(CONF_ARM_REQUIRED, default=True): bool,
            }), {CONF_ALARM: entry.data[CONF_ALARM],
                 CONF_ARM_REQUIRED: current.get(CONF_ARM_REQUIRED, True)}))
