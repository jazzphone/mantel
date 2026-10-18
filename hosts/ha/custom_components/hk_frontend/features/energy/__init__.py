"""ENERGY: a generated Energy page, built from Home Assistant's own Energy
settings (Settings -> Dashboards -> Energy) -- the whole home's power and
today's cost, a fortnight of daily use for the devices that matter, and a
live tile for every circuit, room, appliance and outlet, in sections.

One per house. Nothing to set up first: a house whose Energy settings list
its devices gets a whole page when the feature is added. Its settings page on
HK Settings (Features -> Energy, settings_ws.py) then sorts the devices into
sections, names them, picks what the readings row and the daily bars show,
and adds what the Energy settings do not list (plan.py for the rules).

A screen shows the page when its Pages list it (the `energy` page kind,
hk-strategy.js energyPage); the "Energy display" screen preset is a screen
that is only that page. The plan goes to every screen in the settings feed
(`energy`, client()), worked out again when the options, Home Assistant's
Energy settings or the registries change.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import SubentryFlowResult
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.dispatcher import async_dispatcher_send

from ...const import SIGNAL_CONFIG
from .. import ENERGY, TITLES, Feature, entries, frontend_entry, item_data, loaded, unique_id
from . import plan, settings_ws
from .const import CONF_FOLLOW, DATA

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list = []
RELOAD = False          # nothing to rebuild: the plan is worked out when asked
RENAME = {"options": ("top", "total")}   # followed through an entity rename (rename.py)

CACHE_S = 30.0          # a plan is reused this long, unless something it reads changed
REGISTRY_S = 2.0        # registry changes come in bursts: the plan is worked out once after them


def _data(hass: HomeAssistant) -> dict[str, Any]:
    return hass.data.setdefault(DATA, {})


def prefs(hass: HomeAssistant) -> dict[str, Any] | None:
    """Home Assistant's Energy settings, as last read (None: none saved, or
    not read yet)."""
    mgr = _data(hass).get("manager")
    return dict(mgr.data) if mgr is not None and mgr.data else None


def house(hass: HomeAssistant) -> dict[str, Any]:
    """What the plan borrows from the house's settings: Status & Chips'
    thermostats, the outside temperature and Power Use."""
    from ... import kinds, settings as S
    found = kinds.current(hass) or {}
    entry = frontend_entry(hass)
    m = S.merged(entry.options if entry else None)
    return {"thermostats": list(found.get("thermostats") or (m.get("features") or {}).get("thermostats") or []),
            "outside": (m.get("weather") or {}).get("outside"), "power": (m.get("features") or {}).get("power")}


def current(hass: HomeAssistant, fresh: bool = False) -> dict[str, Any] | None:
    """The plan, or None when the feature is not added."""
    feats = loaded(hass, ENERGY)
    if not feats:
        return None
    d = _data(hass)
    hit = d.get("plan")
    if hit and not fresh and time.monotonic() - hit[0] < CACHE_S:
        return hit[1]
    opts = dict(feats[0].options)
    ctx = plan.collect(hass, prefs(hass), opts, house(hass))
    out = plan.build(ctx, opts)
    d["plan"] = (time.monotonic(), out, ctx)
    return out


def context(hass: HomeAssistant) -> dict[str, Any] | None:
    """What the last plan was worked out from (plan.collect), or None."""
    hit = _data(hass).get("plan")
    return hit[2] if hit else None


def client(hass: HomeAssistant) -> dict[str, Any] | None:
    """The settings feed's `energy` -- remembered as what the screens were
    last sent, so a registry change can tell whether they need it again."""
    try:
        out = current(hass)
    except Exception:  # noqa: BLE001 -- the rest of the feed still goes out
        _LOGGER.exception("hk_frontend: the Energy page could not be worked out")
        return None
    _data(hass)["sent"] = out
    return out


@callback
def invalidate(hass: HomeAssistant, tell: bool = True) -> None:
    """The plan is worked out again when next asked; tell: the screens are
    sent it now (only where nothing else is about to -- a change to the
    feature's item is sent by the house's update listener)."""
    _data(hass).pop("plan", None)
    if tell:
        async_dispatcher_send(hass, SIGNAL_CONFIG)


async def _ensure_manager(hass: HomeAssistant) -> None:
    """Home Assistant's Energy settings, and a word from it when they are
    saved -- once: its manager has no way to stop listening, so the listener
    stays for the life of Home Assistant and does nothing while the feature
    is not added."""
    d = _data(hass)
    if d.get("manager") is not None:
        return
    try:
        from homeassistant.components.energy.data import async_get_manager
        mgr = await async_get_manager(hass)
    except Exception:  # noqa: BLE001 -- no energy integration: the options alone
        d["manager"] = None
        return
    d["manager"] = mgr

    async def updated() -> None:
        if loaded(hass, ENERGY):
            invalidate(hass)

    mgr.async_listen_updates(updated)


async def async_setup(hass: HomeAssistant) -> None:
    settings_ws.async_register(hass)


async def async_setup_entry(hass: HomeAssistant, entry: Feature) -> bool:
    await _ensure_manager(hass)

    async def rebuild() -> None:
        # worked out again, and sent to the screens only when it changed
        if not loaded(hass, ENERGY):
            return
        d = _data(hass)
        before = d.get("sent")
        if current(hass, fresh=True) != before:
            async_dispatcher_send(hass, SIGNAL_CONFIG)

    later = Debouncer(hass, _LOGGER, cooldown=REGISTRY_S, immediate=False, function=rebuild)

    @callback
    def registry(event: Event) -> None:
        # a rename, a new power sensor, a meter removed: worked out again
        if event.data.get("action") in ("create", "remove", "update"):
            _data(hass).pop("plan", None)
            later.async_schedule_call()

    entry.async_on_unload(hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, registry))
    entry.async_on_unload(later.async_cancel)
    invalidate(hass, tell=False)
    return True


async def async_changed(hass: HomeAssistant, entry: Feature) -> None:
    invalidate(hass, tell=False)


async def async_unload_entry(hass: HomeAssistant, entry: Feature) -> bool:
    _data(hass).pop("plan", None)
    return True


def _schema() -> vol.Schema:
    return vol.Schema({vol.Optional(CONF_FOLLOW, default=True): bool})


class AddSteps:
    """Add feature -> Energy: whether HA's Energy devices are listed by
    themselves. Everything else is on its HK Settings page."""

    async def async_step_energy(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        if entries(self.hass, ENERGY):
            return self.async_abort(reason="already_configured")
        if user_input is not None:
            return self.async_create_entry(
                title=TITLES[ENERGY], unique_id=unique_id(ENERGY),
                data=item_data(ENERGY, options={CONF_FOLLOW: bool(user_input.get(CONF_FOLLOW, True))}))
        return self.async_show_form(step_id="energy", data_schema=_schema())


class ReconfigureSteps:
    """Its gear: the same switch; the sections, names and rows are on its HK
    Settings page (the form says where)."""

    async def async_step_energy_options(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        opts = self._feature.options
        if user_input is not None:
            return self.async_save_feature(options={**opts, CONF_FOLLOW: bool(user_input.get(CONF_FOLLOW, True))})
        return self.async_show_form(
            step_id="energy_options", data_schema=self.add_suggested_values_to_schema(
                _schema(), {CONF_FOLLOW: opts.get(CONF_FOLLOW, True)}),
            description_placeholders={"url": "/hk-settings#/page/energy"})
