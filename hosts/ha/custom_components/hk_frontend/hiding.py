"""HIDDEN ACCESSORIES: everything that keeps an accessory off the screens, read
and changed in one place (HK Settings -> Accessories -> Hidden Accessories,
and Where It Shows on the accessory's own settings).

Before 2026-10-12 four separate settings each kept an accessory off a page,
and none said so where it was missing: Hidden from Screens, a kind's Left
Out list under Status & Chips (which decides the Climate, Security, Water...
pages as well as the chips), the accessory's Include in Status, and its Show
on Home. A water heater was off the Climate page with nothing on that page,
or on the accessory, saying why.

Each is now a PLACE an accessory can be hidden from, stored where it always
was -- nothing moves, so nothing is migrated:

    everywhere   generated.exclude_entities (and a whole device:
                 exclude_devices; a whole room: exclude_areas)
    home         the accessory's `home: False` (accessories.py)
    room         the accessory's `room: False` -- its tile left off its own
                 room's page (new)
    <kind>       counts.<kind>.exclude, Status & Chips' Left Out: that kind's
                 page and chip ("Climate": the thermostats)

The accessory's old Include in Status (`status: False`, out of every kind)
reads here as every kind it belongs to hidden, and is turned into those
places the first time the accessory is saved here.

`snapshot` says, for every accessory that can be hidden from anything, which
places it can be hidden from (`can`) and which it is (`off`); `plan` sets
one or several accessories to Everywhere, or to exactly the places chosen.

ALSO COUNTED (Status & Chips' Also count, counts.<kind>.include) is the other
direction, and on the accessory too (2026-10-12): a kind it isn't found in by
itself but could be counted in -- an outlet as a light, a camera that hears
the smoke alarm as Smoke & CO. `added` says which it is counted in that way;
`also` (for the accessories asked about) which it could be.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er

from . import accessories, kinds, settings_api
from . import settings as S

# What a room's section and page draw a tile for (hk-strategy.js TILE; a
# button only when it is a Wake on LAN one, so not offered here).
ROOM_DOMAINS = ("light", "switch", "fan", "cover", "lock", "media_player", "climate", "water_heater",
                "humidifier", "vacuum", "valve", "alarm_control_panel")

# Each place: what it is called, and what it covers. The kinds' are the
# pages and chips that read that kind (hk-strategy.js, hk-chip.js).
PLACES: dict[str, tuple[str, str]] = {
    "home": ("Home", "The Home screen’s room sections"),
    "room": ("Room Page", "Its tile on its room’s own page"),
    "smoke": ("Smoke & CO", "The Smoke & CO chip"),
    "temperature": ("Temperature", "The Climate page’s temperature ranges"),
    "humidity": ("Humidity", "The Climate page’s humidity ranges"),
    "lights": ("Lights", "The Lights page and chip"),
    "fans": ("Fans", "The Climate page and chip"),
    "doors": ("Doors", "The Doors & Windows page and chip"),
    "windows": ("Windows", "The Doors & Windows page and chip"),
    "garage": ("Garage", "The Security page and the Doors & Windows chip"),
    "locks": ("Security", "Locks on the Security page and chip"),
    "blinds": ("Blinds", "The Blinds chip and the Climate page"),
    "leaks": ("Water", "Leak sensors on the Water page and chip"),
    "motion": ("Motion", "Rooms with motion, on status rows"),
    "occupancy": ("Occupancy", "Rooms with someone in them, on status rows"),
    "valves": ("Valves", "The Water page"),
    "thermostats": ("Climate", "Thermostats on the Climate page and chip"),
    "timers": ("Timers", "The Timers page and chip"),
    "vacuums": ("Vacuums", "The Vacuums page and chip"),
    "speakers": ("Speakers", "The Speakers chip"),
}
assert set(PLACES) == {"home", "room", *kinds.KINDS}, "a kind with no place"
ORDER = list(PLACES)
MAX_IDS = 500


def settings_of(hass: HomeAssistant, entry) -> dict[str, Any]:
    """The house's settings as Status & Chips reads them (with the accessories)."""
    return {**S.merged(entry.options if entry else None), "accessories": accessories.current(hass)}


def _room_entities(hass: HomeAssistant) -> set[str]:
    """Accessories a room shows: a tile domain, in an area (its own or its
    device's), not hidden or a config/diagnostic entity in Home Assistant."""
    ents, devs = er.async_get(hass), dr.async_get(hass)
    out = set()
    for e in ents.entities.values():
        if e.domain not in ROOM_DOMAINS or e.hidden_by or e.disabled_by or e.entity_category:
            continue
        if hass.states.get(e.entity_id) is None:
            continue
        area = e.area_id
        if area is None and e.device_id:
            dev = devs.async_get(e.device_id)
            area = dev.area_id if dev else None
        if area:
            out.add(e.entity_id)
    return out


def snapshot(hass: HomeAssistant, settings: Mapping[str, Any],
             only: Iterable[str] | None = None) -> dict[str, Any]:
    """What can hide what, and what is hidden. `only`: just these accessories
    (each given an answer, hideable or not)."""
    cands = kinds.candidates(hass)
    # what each kind would find WITHOUT Hidden from Screens: an accessory
    # hidden everywhere still belongs to its kinds when it is shown again
    auto = kinds.automatic(cands, None)
    offer = kinds.suggest(cands, settings)
    acc = (settings.get("accessories") or {}).get("entities") or {}
    gen = settings.get("generated") or {}
    rooms = _room_entities(hass)
    can: dict[str, list[str]] = {}
    for eid in rooms:
        can[eid] = ["home", "room"]
    added: dict[str, list[str]] = {}
    for k in kinds.KINDS:
        # found there by itself (or left out of it): a place it can be hidden from
        for eid in {*auto[k], *offer[k]["exclude"]}:
            can.setdefault(eid, []).append(k)
        # counted there only because it was added: Also Counted
        for eid in offer[k]["include"]:
            if eid not in auto[k]:
                added.setdefault(eid, []).append(k)
    off: dict[str, list[str]] = {}
    for eid, keys in can.items():
        a = acc.get(eid) or {}
        hid = [k for k in keys if
               (k == "home" and a.get("home") is False) or (k == "room" and a.get("room") is False)
               or (k in kinds.KINDS and (eid in offer[k]["exclude"] or a.get("status") is False))]
        if hid:
            off[eid] = hid
    for eid in can:
        can[eid].sort(key=ORDER.index)
    everywhere = [e for e in gen.get("exclude_entities") or [] if isinstance(e, str)]
    also: dict[str, list[str]] = {}
    if only is not None:
        want = set(only)
        can = {e: v for e, v in can.items() if e in want}
        off = {e: v for e, v in off.items() if e in want}
        added = {e: v for e, v in added.items() if e in want}
        for e in want:
            can.setdefault(e, [])
        everywhere = [e for e in everywhere if e in want]
        also = _also(cands, auto, want)
    return {
        "places": {k: list(v) for k, v in PLACES.items()},
        "order": ORDER,
        "can": can,
        "off": off,
        "everywhere": everywhere,
        "added": added,
        "also": also,
        "devices": list(gen.get("exclude_devices") or []),
        "areas": list(gen.get("exclude_areas") or []),
    }


def _also(cands: list[kinds.Candidate], auto: Mapping[str, list[str]], want: set[str]) -> dict[str, list[str]]:
    """The kinds each of `want` could ALSO be counted in: its domain is one
    the kind's Also count offers, it isn't found there by itself -- and for
    a reading (temperature, humidity), it reports that reading. Hidden or
    disabled in Home Assistant are offered nothing; a group is offered what
    its domain could be (never found by itself, so only ever added by hand)."""
    out: dict[str, list[str]] = {}
    for c in cands:
        if c.entity_id not in want or not (c.shown or (c.group and c.listed)):
            continue
        domain = c.entity_id.split(".", 1)[0]
        ks = [k for k, kind in kinds.KINDS.items()
              if domain in kind.also and c.entity_id not in auto[k]
              and (not kind.reading or kind.reading in c.readings)]
        if ks:
            out[c.entity_id] = sorted(ks, key=ORDER.index)
    return out


def also_plan(hass: HomeAssistant, settings: Mapping[str, Any], ids: list[str],
              wanted: Mapping[str, bool]) -> dict[str, Any]:
    """The settings changes that count `ids` in (True) or no longer in (False)
    each kind named, as Also count does -- only where it could be (`_also`),
    or is already added. Counted in again, it is no longer left out there."""
    cands = kinds.candidates(hass)
    auto = kinds.automatic(cands, None)
    offer = kinds.suggest(cands, settings)
    possible = _also(cands, auto, set(ids))
    changes: dict[str, Any] = {}
    for k, on in wanted.items():
        inc, ex = list(offer[k]["include"]), list(offer[k]["exclude"])
        for eid in ids:
            if on and k in possible.get(eid, []):
                if eid not in inc:
                    inc.append(eid)
                if eid in ex:
                    ex.remove(eid)
            elif not on and eid in inc:
                inc.remove(eid)
        if inc != offer[k]["include"] or ex != offer[k]["exclude"]:
            changes[f"counts.{k}"] = {"exclude": ex, "include": inc}
    return changes


def plan(hass: HomeAssistant, settings: Mapping[str, Any], ids: list[str], everywhere: bool,
         places: Mapping[str, bool]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """The settings changes (settings/set paths) and accessory changes that
    set `ids` to Everywhere, or to exactly the `places` that are True (each
    only where it can be: a place an accessory has nothing to do with is left
    alone). Everywhere clears the places, so showing it again shows it in
    every one."""
    snap = snapshot(hass, settings)
    can = snap["can"]
    gen = settings.get("generated") or {}
    changes: dict[str, Any] = {}
    old_ex = [e for e in gen.get("exclude_entities") or [] if isinstance(e, str)]
    ex = [e for e in old_ex if everywhere or e not in ids] + [e for e in ids if everywhere and e not in old_ex]
    if ex != old_ex:
        changes["generated.exclude_entities"] = ex
    offer = kinds.suggest(kinds.candidates(hass), settings)
    for k in kinds.KINDS:
        cur = list(offer[k]["exclude"])
        new = list(cur)
        for eid in ids:
            if k not in can.get(eid, []):
                continue
            want = not everywhere and bool(places.get(k))
            if want and eid not in new:
                new.append(eid)
            elif not want and eid in new:
                new.remove(eid)
        if new != cur:
            changes[f"counts.{k}"] = {"exclude": new, "include": list(offer[k]["include"])}
    acc = (settings.get("accessories") or {}).get("entities") or {}
    acc_changes: dict[str, dict[str, Any]] = {}
    for eid in ids:
        a = acc.get(eid) or {}
        mine = can.get(eid, [])
        want = {"home": False if not everywhere and "home" in mine and places.get("home") else None,
                "room": False if not everywhere and "room" in mine and places.get("room") else None,
                # Include in Status off is now its kinds' places, as just chosen
                "status": None}
        have = {k: (False if a.get(k) is False else None) for k in want}
        if want != have:
            acc_changes[eid] = want
    return changes, acc_changes


# ------------------------------------------------------------ websocket
def _entry(hass: HomeAssistant):
    from . import features as F
    return F.frontend_entry(hass)


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/hidden/get",
    vol.Optional("entity_ids"): vol.All([vol.All(str, vol.Match(accessories.ENTITY))], vol.Length(max=MAX_IDS)),
})
@websocket_api.require_admin
@callback
def ws_hidden_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                  msg: dict[str, Any]) -> None:
    """What hides what: the whole house, or just these accessories."""
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    connection.send_result(msg["id"], snapshot(hass, settings_of(hass, entry), msg.get("entity_ids")))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/hidden/set",
    vol.Required("entity_ids"): vol.All([vol.All(str, vol.Match(accessories.ENTITY))], vol.Length(min=1, max=MAX_IDS)),
    vol.Required("everywhere"): bool,
    vol.Optional("places", default={}): {vol.In(ORDER): bool},
})
@websocket_api.require_admin
@callback
def ws_hidden_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                  msg: dict[str, Any]) -> None:
    """Hide these accessories everywhere, or from exactly the places given --
    one write to the settings, one to the accessories. Answers what hides
    them now."""
    entry = _entry(hass)
    acc = accessories.get(hass)
    if entry is None or acc is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    ids = list(dict.fromkeys(msg["entity_ids"]))
    changes, acc_changes = plan(hass, settings_of(hass, entry), ids, msg["everywhere"], msg["places"])
    if changes:
        options, errors = settings_api.apply_house(entry.options, changes)
        if errors:
            connection.send_error(msg["id"], "invalid", ", ".join(f"{k}: {v}" for k, v in errors.items()))
            return
        hass.config_entries.async_update_entry(entry, options=options)
    if acc_changes:
        acc.set_many(acc_changes)
    connection.send_result(msg["id"], snapshot(hass, settings_of(hass, entry), ids))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/hidden/also",
    vol.Required("entity_ids"): vol.All([vol.All(str, vol.Match(accessories.ENTITY))], vol.Length(min=1, max=MAX_IDS)),
    vol.Required("kinds"): {vol.In(list(kinds.KINDS)): bool},
})
@websocket_api.require_admin
@callback
def ws_hidden_also(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                   msg: dict[str, Any]) -> None:
    """Also count these accessories in (or no longer in) the kinds given --
    Status & Chips' Also count, from the accessory. Answers what hides them
    and what they are counted in now."""
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    ids = list(dict.fromkeys(msg["entity_ids"]))
    changes = also_plan(hass, settings_of(hass, entry), ids, msg["kinds"])
    if changes:
        options, errors = settings_api.apply_house(entry.options, changes)
        if errors:
            connection.send_error(msg["id"], "invalid", ", ".join(f"{k}: {v}" for k, v in errors.items()))
            return
        hass.config_entries.async_update_entry(entry, options=options)
    connection.send_result(msg["id"], snapshot(hass, settings_of(hass, entry), ids))


def register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_hidden_get)
    websocket_api.async_register_command(hass, ws_hidden_set)
    websocket_api.async_register_command(hass, ws_hidden_also)
