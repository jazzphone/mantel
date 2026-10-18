"""What the Add form, its gear and the settings page check alike: which
alarms may be protected, an alarm's name, and a new PIN typed twice."""
from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import selector as sel

from ...const import DOMAIN
from .. import ALARM_PIN, entries
from .const import CONF_ALARM
from .pin import MIN_LENGTH

# the form errors (translations: error.<code>); the settings page words them itself
OWN_PANEL = "alarm_pin_own_panel"
TAKEN = "alarm_pin_taken"
TOO_SHORT = "alarm_pin_too_short"
MISMATCH = "alarm_pin_mismatch"


def ours(hass: HomeAssistant) -> list[str]:
    """The PIN panels this feature made -- never something to protect. Each
    Alarm PIN's panel is known by its id (alarm_control_panel.py)."""
    reg = er.async_get(hass)
    found = (reg.async_get_entity_id("alarm_control_panel", DOMAIN, e.entry_id)
             for e in entries(hass, ALARM_PIN))
    return [eid for eid in found if eid]


def protected_by(hass: HomeAssistant, alarm: Any) -> str | None:
    """The Alarm PIN that protects `alarm`, if one does."""
    return next((e.entry_id for e in entries(hass, ALARM_PIN) if e.data.get(CONF_ALARM) == alarm), None)


def alarm_error(hass: HomeAssistant, alarm: Any, entry_id: str | None = None) -> str | None:
    """Why the entry `entry_id` (None: a new one) cannot protect `alarm`:
    it is one of our own panels, or another entry already protects it."""
    if alarm in ours(hass):
        return OWN_PANEL
    other = protected_by(hass, alarm)
    return TAKEN if other is not None and other != entry_id else None


def alarm_picker(hass: HomeAssistant) -> sel.EntitySelector:
    cfg: dict[str, Any] = {"filter": {"domain": "alarm_control_panel"}}
    if own := ours(hass):
        cfg["exclude_entities"] = own
    return sel.EntitySelector(sel.EntitySelectorConfig(**cfg))


def title(hass: HomeAssistant, alarm: str) -> str:
    """The alarm's name: from its state, else from the entity registry -- the
    alarm's own integration may not have loaded yet, and then it has no state."""
    st = hass.states.get(alarm)
    if st and st.attributes.get("friendly_name"):
        return str(st.attributes["friendly_name"])
    ent = er.async_get(hass).async_get(alarm)
    return (ent.name or ent.original_name) if ent and (ent.name or ent.original_name) else alarm


def item_title(hass: HomeAssistant, alarm: str) -> str:
    """An Alarm PIN's title -- its item's, and its panel's device's: "<alarm> PIN"."""
    return f"{title(hass, alarm)} PIN"


def pin_field() -> sel.TextSelector:
    return sel.TextSelector(sel.TextSelectorConfig(type=sel.TextSelectorType.PASSWORD))


def new_pin(user_input: dict[str, Any], errors: dict[str, str], required: bool) -> str:
    """The PIN from a form that asks for it TWICE, or "" with `errors` filled.

    Typed once, a slip of a finger is saved silently: the PIN is hidden as it
    is typed and only a hash is kept, so nothing can show what was saved, and
    the first sign is "Wrong code" at the keypad. The second entry is what
    catches it. Not required and both empty: keep the current PIN."""
    pin = (user_input.get("pin") or "").strip()
    again = (user_input.get("pin_again") or "").strip()
    if not pin and not again and not required:
        return ""
    if len(pin) < MIN_LENGTH:
        errors["pin"] = TOO_SHORT
    elif pin != again:
        errors["pin_again"] = MISMATCH
    return "" if errors else pin
