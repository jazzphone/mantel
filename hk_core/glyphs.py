"""AN ACCESSORY'S GLYPH, as the screens draw it, for what draws it elsewhere (2026-11-24, the owner: "I'd like our glyphs
to come through if possible, regardless of where they are drawn" -- the iPhone's widgets drew Apple's symbols by kind).

The screens' rule is the generated pages' (web/hk/strategy/hk-strategy-house.js tileOf, TILE, lightGlyph, ANY_ICON;
the alarm's shields from hk-grid-security.js ALARM_GLYPHS), in this order:

    1. the house's own choice (Accessories: the accessory's gear, `entities.<id>.icon`; a Material name drawn as the
       house's own glyph of that name)
    2. a glyph of the house's own set given in Home Assistant (the entity registry's icon, `hk:` only)
    3. "Show As" (a switch shown as a light, a fan or an outlet)
    4. what it is: a light by what it is called, a garage door or a blind by its class and state, a lock by its state,
       a speaker by its model, the alarm by its state, ...; else the state's own icon, else the kind's

The result is a name of the house's icon set (`hk:` or `mdi:`): each app draws it with that set (mantel-ios HouseGlyph).
None: nothing to draw but the kind's own (a reading draws what it measures). Pure.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

SHOW_GLYPH = {"light": "hk:lightbulb", "fan": "hk:fan", "switch": "hk:toggle-switch", "outlet": "hk:power-socket-us"}
ANY_ICON = {"scene": "mdi:palette", "script": "mdi:script-text-play", "button": "mdi:gesture-tap-button",
            "input_button": "mdi:gesture-tap-button", "input_boolean": "mdi:toggle-switch", "automation": "mdi:robot",
            "person": "mdi:account"}
ALARM_ON = ("armed_home", "armed_night", "armed_away", "armed_vacation", "armed_custom_bypass", "arming", "pending",
            "triggered")


def light_glyph(name: str | None, group: bool = False) -> str:
    """A light's glyph from what it is called (hk-strategy-house.js lightGlyph): only glyphs the Home app uses for lights."""
    n = (name or "").lower()
    if group:
        return "hk:lightbulb-group"
    for pattern, glyph in ((r"floor lamp", "floor-lamp"), (r"desk lamp", "desk-lamp"), (r"lamp", "lamp"),
                           (r"chandelier", "chandelier"), (r"sconce", "wall-sconce"), (r"strip|led", "led-strip-variant"),
                           (r"string|christmas|tree", "string-lights"), (r"recessed|can light|pot light", "light-recessed"),
                           (r"vanity", "vanity-light"), (r"porch|outdoor|flood|landscape", "outdoor-lamp"),
                           (r"ceiling", "ceiling-light")):
        if re.search(pattern, n):
            return "hk:" + glyph
    return "hk:lightbulb"


def glyph(eid: str, state: str | None, attrs: Mapping[str, Any] | None, name: str | None = None,
          entry: Mapping[str, Any] | None = None, acc: Mapping[str, Any] | None = None,
          model: str | None = None) -> str | None:
    """The glyph the screens draw for `eid` in `state` (see the module's order). `entry`: its entity registry entry;
    `acc`: its Accessories settings (`entities.<id>`); `model`: its device's model."""
    d = eid.split(".", 1)[0]
    a = attrs or {}
    own = str((acc or {}).get("icon") or "")
    if own:
        return "hk:" + own[4:] if own.startswith("mdi:") else own
    reg = str((entry or {}).get("icon") or "")
    if reg.startswith("hk:"):
        return reg
    show = (acc or {}).get("show_as")
    if show in SHOW_GLYPH and d in ("switch", "light", "input_boolean") and not (show == "light" and d == "light"):
        return SHOW_GLYPH[show]
    dc = a.get("device_class")
    if d == "light":
        group = isinstance(a.get("entity_id"), list) or isinstance(a.get("group_entities"), list)
        return light_glyph(name or a.get("friendly_name"), group)
    if d == "switch":
        return "hk:power-socket-us"
    if d == "fan":
        return "hk:fan"
    if d == "cover":
        if dc in ("garage", "gate"):
            return "hk:garage" if state == "closed" else "hk:garage-open"
        return "hk:blinds-horizontal-closed" if state == "closed" else "hk:blinds-horizontal"
    if d == "lock":
        return "hk:lock-open-variant" if state == "unlocked" else "hk:lock"
    if d == "media_player":
        m = (model or "").lower()
        if "apple tv" in m:
            return "hk:apple-tv"
        if dc in ("tv", "receiver"):
            return "hk:television"
        if "homepod mini" in m:
            return "hk:homepod-mini"
        if "homepod" in m:
            return "hk:homepod"
        if "homeview" in m or "homeaccessory" in m:
            return "hk:homeview"
        return "hk:speaker"
    if d in ("climate", "water_heater"):
        return "hk:thermostat"
    if d == "humidifier":
        return "hk:air-humidifier-active" if state == "on" else "hk:air-humidifier"
    if d == "vacuum":
        return "hk:robot-vacuum"
    if d == "valve":
        return "hk:spigot"
    if d == "alarm_control_panel":
        return "hk:alarm-light" if state in ALARM_ON else "hk:alarm-light-off"
    if d == "button" and (entry or {}).get("platform") == "wake_on_lan":
        return "hk:desktop-tower"
    icon = a.get("icon")
    if isinstance(icon, str) and icon:
        return icon
    return ANY_ICON.get(d)
