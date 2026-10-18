"""CLEAN THESE AREAS, inside Home Assistant: the shared logic (hk_core/clean_areas.py) run
against HA's house (house.py's HaHouse).

`hk_frontend.clean_areas` and the settings page call these with HA's object, as before; the
rules themselves -- which robot cleans what, how a plan is carried out -- live in hk_core,
written once for every host (PLAN.md §0, plan review). `plan` stays a name in this module so
the action reads it here (tests replace it to check the calls carry the caller's context).
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from homeassistant.core import Context, HomeAssistant

from ...hk_core import clean_areas as core
from ...house import HaHouse

CLEAN_AREA = core.CLEAN_AREA


def plan(hass: HomeAssistant, areas: list[str], options: Mapping[str, Any] | None) -> dict[str, Any]:
    """Who cleans what, for these areas (hk_core.clean_areas.plan)."""
    return core.plan(HaHouse(hass), areas, options)


def coverage(hass: HomeAssistant, options: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    return core.coverage(HaHouse(hass), options)


def reachable(hass: HomeAssistant, options: Mapping[str, Any] | None) -> list[str]:
    return core.reachable(HaHouse(hass), options)


def offered(hass: HomeAssistant, options: Mapping[str, Any] | None) -> list[str]:
    return core.offered(HaHouse(hass), options)


async def async_clean(hass: HomeAssistant, areas: list[str], options: Mapping[str, Any] | None,
                      dry_run: bool = False, context: Context | None = None) -> dict[str, Any]:
    return await core.async_execute(HaHouse(hass), plan(hass, areas, options), dry_run, context)
