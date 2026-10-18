"""The Lovelace resources the cards need, registered by the integration.

Every card family in frontend/cards/ is a Lovelace resource (type module), and
so are the font's @font-face and the phone breakpoints (type css). Adding each
by hand in Settings -> Dashboards -> Resources would mean remembering another
for every new card family.

So the integration ADDS WHAT IS MISSING, once Home Assistant has started:

  * only in storage mode -- a YAML `resources:` list is the user's to write,
    and there is nothing to add it to;
  * only ADDS. An existing entry is never edited, reordered or removed, so a
    house that already lists every file sees no change at all,
    and a query-string variant (`...hk-tile.js?v=2`) counts as present;
  * the card list is READ FROM THE FOLDER, so a new family file is registered
    on the next start without touching this file.
"""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

FRONTEND = Path(__file__).parent / "frontend"
CSS = ("/hk/fonts/sf-pro.css", "/hk/css/hk-responsive.css")


def wanted() -> list[tuple[str, str]]:
    """(type, url) for every resource the cards need. Blocking (lists a folder)."""
    cards = sorted(p.name for p in (FRONTEND / "cards").glob("*.js"))
    return [("css", url) for url in CSS] + [("module", f"/hk/cards/{n}") for n in cards]


async def async_ensure(hass: HomeAssistant) -> list[str]:
    """Add the missing resources. Returns the URLs added (empty when none were,
    or when resources are not in storage mode)."""
    try:
        from homeassistant.components.lovelace.const import LOVELACE_DATA
        collection = hass.data[LOVELACE_DATA].resources
    except (ImportError, KeyError, AttributeError):
        return []
    if not hasattr(collection, "async_create_item"):
        _LOGGER.debug("Lovelace resources are in YAML mode; not managing them")
        return []
    await collection.async_get_info()               # loads the collection
    have = {str(item.get("url", "")).split("?")[0] for item in collection.async_items()}
    added = []
    for res_type, url in await hass.async_add_executor_job(wanted):
        if url in have:
            continue
        await collection.async_create_item({"res_type": res_type, "url": url})
        added.append(url)
    if added:
        _LOGGER.info("hk_frontend: added Lovelace resources %s", added)
    return added
