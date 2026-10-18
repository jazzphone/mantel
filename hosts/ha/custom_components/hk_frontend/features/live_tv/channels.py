"""Which channels: the tuner's lineup, each one's network from the guide, and
the names a chosen channel gets. Shared by Add feature, Configure and the
HK Settings page (settings_ws.py), so all three name channels alike.
"""
from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import selector

from .coordinator import async_fetch_guide, async_lineup
from .guide import parse_xmltv


async def async_catalogue(hass: HomeAssistant, host: str, guide_url: str | None):
    """(lineup, networks): the tuner's channels and each one's network from
    the guide ({} when there is no guide or it cannot be read)."""
    lineup = await async_lineup(hass, host)
    networks: dict[str, str] = {}
    if guide_url:
        try:
            raw = await async_fetch_guide(hass, guide_url, timeout=15)
            parsed = await hass.async_add_executor_job(parse_xmltv, raw, None, None, 1)
            networks = {n: g["network"] for n, g in parsed.items() if g.get("network")}
        except Exception:  # noqa: BLE001 - labels fall back to station names
            networks = {}
    return lineup, networks


def label(c: dict, networks: dict) -> str:
    net = networks.get(c["number"])
    return f"{c['number']}  {net} ({c['name']})" if net else f"{c['number']}  {c['name']}"


def build_channels(numbers: list[str], lineup: list[dict], networks: dict,
                   keep: list[dict] | None = None) -> list[dict]:
    """[{"number", "name"}] in lineup order. A channel already configured keeps
    its name; a new one is named after its network, else its station, and a
    name used twice gets its number added."""
    kept = {c["number"]: c["name"] for c in (keep or [])}
    by_num = {c["number"]: c for c in lineup}
    out = []
    for c in lineup:
        if c["number"] not in numbers:
            continue
        name = kept.get(c["number"])
        # Still the automatic station name ("WXXX-DT", set before any guide
        # could be read)? Then the network name wins now that one is known.
        # A name somebody chose is never touched.
        if not name or (name == c["name"] and networks.get(c["number"])):
            name = networks.get(c["number"]) or c["name"]
        out.append({"number": c["number"], "name": name})
    for n in numbers:                      # configured but gone from the lineup
        if n not in by_num and n in kept:
            out.append({"number": n, "name": kept[n]})
    names = [c["name"] for c in out]
    for c in out:
        if names.count(c["name"]) > 1:
            c["name"] = f"{c['name']} {c['number']}"
    return out


def channel_selector(lineup, networks):
    return selector.SelectSelector(selector.SelectSelectorConfig(
        options=[selector.SelectOptionDict(value=c["number"], label=label(c, networks))
                 for c in lineup],
        multiple=True, mode=selector.SelectSelectorMode.LIST))


QUALITY_SELECTOR = selector.SelectSelector(selector.SelectSelectorConfig(
    options=[selector.SelectOptionDict(value="720", label="720p (recommended)"),
             selector.SelectOptionDict(value="1080", label="1080p (about 40% more CPU)")],
    mode=selector.SelectSelectorMode.DROPDOWN))
