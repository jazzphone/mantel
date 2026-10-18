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
from typing import Any, Protocol


@dataclass(frozen=True)
class State:
    entity_id: str
    state: str
    attributes: Mapping[str, Any] = field(default_factory=dict)

    @property
    def domain(self) -> str:
        return self.entity_id.split(".", 1)[0]


@dataclass(frozen=True)
class Entity:
    """An entity registry entry: what the house knows about an entity besides its state."""
    entity_id: str
    area_id: str | None = None
    device_id: str | None = None
    options: Mapping[str, Any] = field(default_factory=dict)
    supported_features: int | None = None
    disabled: bool = False

    @property
    def domain(self) -> str:
        return self.entity_id.split(".", 1)[0]


@dataclass(frozen=True)
class Device:
    id: str
    area_id: str | None = None


class House(Protocol):
    def state(self, entity_id: str) -> State | None:
        """The entity's current state, or None."""

    def states(self, domain: str) -> list[State]:
        """Every current state in a domain."""

    def entity(self, entity_id: str) -> Entity | None:
        """The entity's registry entry, or None."""

    def entities(self, domain: str | None = None) -> list[Entity]:
        """Registry entries, optionally one domain's."""

    def device(self, device_id: str) -> Device | None:
        """A device registry entry, or None."""

    def area_ids(self) -> set[str]:
        """The ids of the house's areas."""

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
