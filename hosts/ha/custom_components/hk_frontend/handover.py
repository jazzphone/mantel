"""THE BRIDGE HAND-OVER, HK FRONTEND'S SIDE (docs/phase9/MANTEL-LINK.md in the
Mantel repository; decision 29: the two products run together).

While a house moves to Mantel, its entities in Home Assistant are mirrored by
exactly one integration: this one (linked mode) or Mantel Link (domain
`mantel`). Mantel says which, as `owners.bridge`: "hk_frontend" (the default:
everything as before) or "mantel" (an Owner handed the bridge over in Mantel
Settings). Linked mode tells Mantel this release can hand over (the link's
`bridge` feature); without it Mantel refuses the hand-over.

THE BRIDGE AT MANTEL LINK. This integration mirrors none of Mantel's entities
(linked_mode.Linked.mine), so Mantel Link can take their registry entries,
entity ids and history included. `hk_frontend.set_black_screen` still answers
for every wall tablet: Home Assistant's own switches here, Mantel Link's
through `mantel.set_black_screen` (switch.py), so a sleep script never has a
gap. Everything a unit Home Assistant still owns stays exactly as it was.

TAKING ENTITIES BACK (`guarded`). Home Assistant's registry keys an entity by
(domain, integration, unique id). An entity this integration adds whose unique
id Mantel Link holds -- the bridge given back, a tablet moved back to Home
Assistant, Mantel Link removed -- is moved back here first, keeping its entity
id (`async_update_entity_platform`), once Mantel Link has let go of it (it
unloads it when Mantel says). Never added beside it, which would have made a
second entity with `_2` on its id.
"""
from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_platform, entity_registry as er
from homeassistant.helpers.entity import Entity, entity_sources

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

MANTEL_LINK = "mantel"          # Mantel Link's domain
TAKE_TIMEOUT = 120.0            # how long an entity waits for Mantel Link to let go of it
POLL = 0.25


def bridge_away(entry: ConfigEntry | None) -> bool:
    """Linked, and Mantel Link holds the bridge: nothing of Mantel's is mirrored here."""
    from . import linked_mode
    return linked_mode.configured(entry) and linked_mode.owners_of(entry)["bridge"] == "mantel"


@callback
def take_back(hass: HomeAssistant, entity_id: str, entry: ConfigEntry, subentry: str | None = None) -> None:
    """Move one of Mantel Link's registry entries back to this integration:
    the same entity id and unique id (it must not be loaded)."""
    reg = er.async_get(hass)
    ent = reg.async_get(entity_id)
    if ent is None or ent.platform != MANTEL_LINK:
        return
    if subentry is not None and subentry not in entry.subentries:
        subentry = None
    reg.async_update_entity_platform(entity_id, DOMAIN, new_config_entry_id=entry.entry_id,
                                     new_config_subentry_id=subentry)
    _LOGGER.info("hk_frontend: took %s back from Mantel Link (the same entity id and unique id)", entity_id)


def guarded(hass: HomeAssistant, entry: ConfigEntry, add: Callable[..., None]) -> Callable[..., None]:
    """A platform's async_add_entities that first takes back what Mantel Link
    holds (see the module's docstring). Call it in the platform's setup."""
    domain = entity_platform.async_get_current_platform().domain

    @callback
    def add_entities(new_entities: Iterable[Entity], update_before_add: bool = False, **kw: Any) -> None:
        reg = er.async_get(hass)
        ready: list[Entity] = []
        for ent in list(new_entities):
            uid = ent.unique_id
            held = reg.async_get_entity_id(domain, MANTEL_LINK, uid) if uid else None
            if held is None:
                ready.append(ent)
            elif held in entity_sources(hass):
                entry.async_create_background_task(
                    hass, _when_let_go(hass, entry, add, ent, held, update_before_add, kw),
                    f"hk_frontend: take {held} back from Mantel Link")
            else:
                take_back(hass, held, entry, kw.get("config_subentry_id"))
                ready.append(ent)
        if ready:
            add(ready, update_before_add, **kw)
    return add_entities


async def _when_let_go(hass: HomeAssistant, entry: ConfigEntry, add: Callable[..., None], ent: Entity,
                       held: str, update_before_add: bool, kw: dict[str, Any]) -> None:
    """Mantel Link still shows it (it has been told, as this side was): wait
    for it to unload it, then take it back and add it."""
    loop = asyncio.get_running_loop()
    end = loop.time() + TAKE_TIMEOUT
    while held in entity_sources(hass):
        if loop.time() > end or entry.state is not ConfigEntryState.LOADED:
            _LOGGER.warning("hk_frontend: Mantel Link still has %s; it stays Mantel Link's (reload HK Frontend "
                            "once Mantel says the bridge or the tablet is Home Assistant's)", held)
            return
        await asyncio.sleep(POLL)
    take_back(hass, held, entry, kw.get("config_subentry_id"))
    add([ent], update_before_add, **kw)


def describe(entry: ConfigEntry | None) -> str | None:
    """For Configure: who holds the bridge, when it isn't this integration."""
    return ("Mantel Link holds the bridge: it shows Mantel's entities in Home Assistant; HK Frontend keeps only "
            "what Home Assistant still owns") if bridge_away(entry) else None
