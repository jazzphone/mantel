"""THE HOUSE PORT, HOME ASSISTANT'S SIDE (hk_core/house.py).

Shared feature logic in `hk_core` asks the house through this: HA's state machine, its
entity/device/area registries and its services. Every view is copied out of HA's own object,
so shared code never holds (or changes) an HA object.
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.util import dt as dt_util

from .hk_core.house import Device, Entity, Floor, State


def state_view(st) -> State | None:
    """An HA State as the port's plain view (None stays None)."""
    return State(st.entity_id, st.state, dict(st.attributes), st.last_changed) if st is not None else None


_state = state_view


def _entity(e: er.RegistryEntry | None) -> Entity | None:
    if e is None:
        return None
    return Entity(entity_id=e.entity_id, area_id=e.area_id, device_id=e.device_id,
                  options=e.options or {}, supported_features=e.supported_features,
                  disabled=e.disabled_by is not None, hidden=e.hidden_by is not None,
                  entity_category=str(e.entity_category) if e.entity_category else None,
                  platform=e.platform, device_class=e.device_class,
                  original_device_class=e.original_device_class)


class HaHouse:
    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    def state(self, entity_id: str) -> State | None:
        return _state(self._hass.states.get(entity_id))

    def states(self, domain: str | None = None) -> list[State]:
        return [_state(s) for s in self._hass.states.async_all(domain)]

    def entity(self, entity_id: str) -> Entity | None:
        return _entity(er.async_get(self._hass).async_get(entity_id))

    def entities(self, domain: str | None = None) -> list[Entity]:
        return [_entity(e) for e in er.async_get(self._hass).entities.values()
                if domain is None or e.domain == domain]

    def device(self, device_id: str) -> Device | None:
        d = dr.async_get(self._hass).async_get(device_id)
        return Device(d.id, d.area_id, d.name_by_user or d.name) if d else None

    def device_entities(self, device_id: str) -> list[Entity]:
        reg = er.async_get(self._hass)
        return [_entity(e) for e in er.async_entries_for_device(reg, device_id, include_disabled_entities=True)]

    def area_ids(self) -> set[str]:
        return set(ar.async_get(self._hass).areas)

    def area_name(self, area_id: str) -> str | None:
        a = ar.async_get(self._hass).async_get_area(area_id)
        return a.name if a else None

    def area_floor(self, area_id: str) -> Floor | None:
        a = ar.async_get(self._hass).async_get_area(area_id)
        f = fr.async_get(self._hass).async_get_floor(a.floor_id) if a and a.floor_id else None
        return Floor(f.floor_id, f.name, f.level) if f else None

    def local_time(self, when: datetime | None = None) -> datetime:
        return dt_util.as_local(when or dt_util.utcnow())

    async def call_service(self, domain: str, service: str, data: Mapping[str, Any],
                           *, context: Any = None) -> None:
        await self._hass.services.async_call(domain, service, dict(data), blocking=True, context=context)
