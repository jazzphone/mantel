"""THE HOUSE PORT: everything shared feature logic may ask of the home it runs in.

A host implements it: inside Home Assistant, `hosts/ha/.../house.py` reads HA's state
machine and registries and calls HA's services; in Mantel Server, the state hub and the
command gateway do (Phase 3). Feature code in `hk_core` takes a `House` and nothing else,
so it never learns which host it is in.

It grows feature by feature (PLAN.md §0, plan review): each method is here because a moved
feature needs it. The views are plain frozen data, copied out of the host's own objects, so
feature code cannot change the house by accident.

`context` on a service call is the host's own "who asked" token, passed through untouched
(HA: a `Context`, so the logbook names the caller; Mantel: the audited actor).
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol


@dataclass(frozen=True)
class State:
    """An entity's state. `last_changed`: when its state (not just its attributes) last
    changed, aware, when the host knows (the Sleep Screen's presence and lights read it); it
    takes no part in comparing two views."""
    entity_id: str
    state: str
    attributes: Mapping[str, Any] = field(default_factory=dict)
    last_changed: datetime | None = field(default=None, compare=False)

    @property
    def domain(self) -> str:
        return self.entity_id.split(".", 1)[0]

    @property
    def name(self) -> str:
        """Its friendly name, else its object id spelled out (as HA names a state)."""
        return self.attributes.get("friendly_name") or self.entity_id.split(".", 1)[-1].replace("_", " ")


@dataclass(frozen=True)
class Entity:
    """An entity registry entry: what the house knows about an entity besides its state.
    `hidden` and `entity_category` (a device's "config" / "diagnostic" entity) are how the house
    keeps an entity out of sight; `platform` is the integration that made it."""
    entity_id: str
    area_id: str | None = None
    device_id: str | None = None
    options: Mapping[str, Any] = field(default_factory=dict)
    supported_features: int | None = None
    disabled: bool = False
    hidden: bool = False
    entity_category: str | None = None
    platform: str | None = None
    device_class: str | None = None             # the user's choice, over...
    original_device_class: str | None = None    # ...the integration's

    @property
    def domain(self) -> str:
        return self.entity_id.split(".", 1)[0]


@dataclass(frozen=True)
class Device:
    id: str
    area_id: str | None = None
    name: str | None = None                     # the user's name for it, else its own


@dataclass(frozen=True)
class Floor:
    """The floor an area is on. `level` orders floors (lower is further down); None when unset."""
    id: str
    name: str
    level: int | None = None


class House(Protocol):
    def state(self, entity_id: str) -> State | None:
        """The entity's current state, or None."""

    def states(self, domain: str | None = None) -> list[State]:
        """Every current state in a domain (none given: every state)."""

    def entity(self, entity_id: str) -> Entity | None:
        """The entity's registry entry, or None."""

    def entities(self, domain: str | None = None) -> list[Entity]:
        """Registry entries, optionally one domain's."""

    def device(self, device_id: str) -> Device | None:
        """A device registry entry, or None."""

    def device_entities(self, device_id: str) -> list[Entity]:
        """A device's registry entries, disabled ones too (`disabled` says)."""

    def area_ids(self) -> set[str]:
        """The ids of the house's areas."""

    def area_name(self, area_id: str) -> str | None:
        """An area's name, or None."""

    def area_floor(self, area_id: str) -> Floor | None:
        """The floor an area is on, or None (no such area, or it has no floor)."""

    def local_time(self, when: datetime | None = None) -> datetime:
        """`when` (an aware datetime; a naive one is taken as the house's), default now, in the
        house's own time zone."""

    async def call_service(self, domain: str, service: str, data: Mapping[str, Any],
                           *, context: Any = None) -> None:
        """Run a service and wait for it (raises on failure)."""


def area_of(house: House, entity: Entity | None) -> str | None:
    """Where an entity is: its own area, else its device's."""
    if entity is None:
        return None
    if entity.area_id:
        return entity.area_id
    if entity.device_id:
        dev = house.device(entity.device_id)
        return dev.area_id if dev else None
    return None
