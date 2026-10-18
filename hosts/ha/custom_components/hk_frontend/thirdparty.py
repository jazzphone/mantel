"""THE THIRD-PARTY CARDS a generated dashboard uses, and whether
each is ready: installed from HACS and, where the card needs it, loaded as a
dashboard resource. Setup check lists them; the pages where each is set up
(Configure -> Weather, a dashboard's gear -> Screen) say when one is not
ready, so an options field is never a silent no-op.

    ready       installed, and loaded where it must be
    not_loaded  installed, but not a dashboard resource (WallPanel and Kiosk
                Mode only run as resources; the radar card is imported by the
                Weather page itself, so it never needs to be one)
    missing     not installed
"""
from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

from . import settings as S


async def async_status(hass: HomeAssistant) -> dict[str, str]:
    files = await hass.async_add_executor_job(S.find_extras, hass.config.config_dir)
    loaded: set[str] | None = None
    try:
        from homeassistant.components.lovelace.const import LOVELACE_DATA
        collection = hass.data[LOVELACE_DATA].resources
        if hasattr(collection, "async_get_info"):
            await collection.async_get_info()
        loaded = {str(i.get("url", "")).split("?")[0] for i in collection.async_items()}
    except (ImportError, KeyError, AttributeError):
        loaded = None                  # Lovelace not started: do not cry wolf
    out: dict[str, str] = {}
    for key, card in S.THIRD_PARTY.items():
        if not files.get(key):
            out[key] = "missing"
        elif card["resource"] and loaded is not None and \
                f"/hacsfiles/{card['folder']}/{card['file']}" not in loaded:
            out[key] = "not_loaded"
        else:
            out[key] = "ready"
    return out


def note(key: str, state: str) -> str:
    """One sentence for a form's description or Setup check."""
    card = S.THIRD_PARTY[key]
    name, what = card["name"], card["what"]
    if state == "ready":
        return f"{name} is installed: the {what}."
    if state == "not_loaded":
        return (f"{name} is installed but not loaded: add `/hacsfiles/{card['folder']}/{card['file']}` "
                f"(JavaScript module) under Settings → Dashboards → Resources. Until then there is no {what}.")
    return (f"{name} is not installed. It is optional, from HACS (Frontend): without it there is no {what}, "
            f"and its options below do nothing.")
