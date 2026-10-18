"""Follow an entity rename through HK Frontend's own settings.

WHY. Settings name entities by id -- an accessory's name and icon, a
dashboard's favorites, the weather sensors, a pop-up's camera -- and a rename
in Home Assistant would leave every one of them pointing at an id that no
longer exists. The accessory settings would simply be lost.

WHAT IT MAY TOUCH, AND NOTHING ELSE (following a rename must never cause a
problem of its own):

  * Only a RENAME: an entity-registry `update` that carries old_entity_id, in
    the same domain. A removal, a new entity, a device change: nothing.
  * Only an EXACT value: a stored string equal to the old id, or a list
    element equal to it. Never a substring, never a pattern.
  * Only HK Frontend's own STRUCTURED settings, field by field:
      options   dashboard.<section>.<key> values and lists (counts.<kind>
                .include/.exclude one level down); weather.radar is skipped
      dashboard items   favorites, cameras, scenes, chips, chips_extra, camera_live
      pop-up items      entity, speaker, stream, entities
      feature items     the fields each feature names in its RENAME (Music's
                        speakers and homes, Clean Areas' vacuums, the alarm an
                        Alarm PIN protects -- whose unique id and title move
                        with it), and the items it owns (RENAME_ITEMS: a Music
                        preset's group and rooms)
      accessories store the entity's own settings (its key), fav_with, room
                        tile orders, page orders
  * NEVER the free-form card configurations -- a custom page's view (Energy,
    EcoFlow), a custom chip's card, a pop-up's own cards, a dashboard's
    wallpanel/kiosk options, the radar options -- where
    `select.select_option` (an action) looks exactly like an entity id. The old
    id found there is REPORTED, for a person to fix.
  * NEVER outside HK Frontend: YAML dashboards, automations, other
    integrations are Home Assistant's and yours.
  * NEVER over something: the new id already having accessory settings of its
    own is a conflict -- both are left as they are, and it is reported.

Everything changed and everything found but not changed goes in one persistent
notification, so a rename's effect can be seen and undone.
"""
from __future__ import annotations

import copy
import logging
from collections.abc import Mapping
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

_LOGGER = logging.getLogger(__name__)

# option subtrees that are free-form third-party card options
OPTION_SKIP = {("weather", "radar")}
BOARD_KEYS = ("favorites", "cameras", "scenes", "chips", "chips_extra", "camera_live", "notify_dnd")
POPUP_KEYS = ("entity", "speaker", "stream", "entities")
FREE_BOARD_KEYS = ("wallpanel_options", "kiosk_options")
NOTIFY_ID = "hk_frontend_rename"


def _swap(value: Any, old: str, new: str) -> tuple[Any, bool]:
    """`value` with `old` replaced by `new`: a string equal to it, or list
    elements equal to it (the list keeps one `new`, in the old one's place).
    Anything else is returned untouched."""
    if isinstance(value, str):
        return (new, True) if value == old else (value, False)
    if isinstance(value, list) and old in value:
        out: list[Any] = []
        for v in value:
            if v == old:
                v = new
            if v == new and new in out:
                continue                      # already listed: no duplicate
            out.append(v)
        return out, True
    return value, False


def _swap_values(value: Any, old: str, new: str) -> tuple[Any, bool]:
    """_swap, and for a mapping its values (Music's homes: user -> room player),
    and for a list of mappings each one's (Notifications' items: entity,
    camera) -- a list of mappings in one of those as well, at any depth (the
    Cameras category's pairs: camera, trigger, view). A mapping inside a
    mapping is left alone, as before."""
    if _mappings(value):
        outs, hit = [], False
        for v in value:
            o, h = _swap_values(v, old, new)
            outs.append(o)
            hit = hit or h
        return (outs, True) if hit else (value, False)
    if isinstance(value, dict):
        out, hit = {}, False
        for k, v in value.items():
            out[k], h = _swap_values(v, old, new) if _mappings(v) else _swap(v, old, new)
            hit = hit or h
        return (out, True) if hit else (value, False)
    return _swap(value, old, new)


def _mappings(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(isinstance(v, dict) for v in value)


def rewrite_feature(stored: Any, spec: dict[str, tuple[str, ...]], old: str,
                    new: str) -> tuple[Any, list[str]]:
    """A feature item ({kind, data, options}): only the fields its RENAME names,
    in data and options."""
    if not isinstance(stored, Mapping):
        return stored, []
    out = copy.deepcopy({k: dict(v) if isinstance(v, Mapping) else v for k, v in stored.items()})
    paths: list[str] = []
    for part, keys in spec.items():
        block = out.get(part)
        if not isinstance(block, dict):
            continue
        for k in keys:
            if k in block:
                nv, hit = _swap_values(block[k], old, new)
                if hit:
                    block[k] = nv
                    paths.append(k)
    return out, paths


def rewrite_options(dashboard: Any, old: str, new: str) -> tuple[Any, list[str]]:
    """options['dashboard']: `section -> key -> value`, one level deeper for a
    mapping (counts.<kind>.include). Returns (new dict, changed paths)."""
    if not isinstance(dashboard, dict):
        return dashboard, []
    out = copy.deepcopy(dashboard)
    paths: list[str] = []
    for section, block in out.items():
        if not isinstance(block, dict):
            continue
        for key, value in block.items():
            if (section, key) in OPTION_SKIP:
                continue
            if isinstance(value, dict):
                for sub, inner in value.items():
                    nv, hit = _swap(inner, old, new)
                    if hit:
                        value[sub] = nv
                        paths.append(f"{section}.{key}.{sub}")
                continue
            nv, hit = _swap(value, old, new)
            if hit:
                block[key] = nv
                paths.append(f"{section}.{key}")
    return out, paths


def rewrite_fields(data: Any, keys: tuple[str, ...], old: str, new: str) -> tuple[Any, list[str]]:
    """A dashboard or pop-up item: only the named keys. An item's data is a
    read-only mapping (MappingProxyType) as Home Assistant stores it -- not a
    dict, which is why this took only dicts and followed nothing live."""
    if not isinstance(data, Mapping):
        return data, []
    out = dict(data)
    paths = []
    for k in keys:
        if k in out:
            # (_swap_values: a screen's notify_dnd is a mapping -- its While list)
            nv, hit = _swap_values(out[k], old, new)
            if hit:
                out[k] = copy.deepcopy(nv) if isinstance(nv, (list, dict)) else nv
                paths.append(k)
    return out, paths


def rewrite_accessories(data: Any, old: str, new: str) -> tuple[Any, list[str], list[str]]:
    """The accessories store. Returns (new data, changed, conflicts)."""
    if not isinstance(data, dict):
        return data, [], []
    out = copy.deepcopy(data)
    changed: list[str] = []
    conflicts: list[str] = []
    ents = out.get("entities")
    if isinstance(ents, dict):
        if old in ents:
            if new in ents:
                conflicts.append(f"{new} already has accessory settings: {old}'s were left under the old id")
            else:
                ents[new] = ents.pop(old)
                changed.append("accessory settings")
        for eid, conf in ents.items():
            if isinstance(conf, dict) and "fav_with" in conf:
                nv, hit = _swap(conf["fav_with"], old, new)
                if hit:
                    conf["fav_with"] = [x for x in nv if x != eid]     # never with itself
                    changed.append(f"favorite-with list of {eid}")
    for bucket, label in (("rooms", "tile order of room"), ("pages", "order of page"), ("scenes", "scenes of room")):
        group = out.get(bucket)
        if isinstance(group, dict):
            for name, ids in group.items():
                nv, hit = _swap(ids, old, new)
                if hit:
                    group[name] = nv
                    changed.append(f"{label} {name}")
    return out, changed, conflicts


def contains(obj: Any, needle: str, _depth: int = 0) -> bool:
    """Does `needle` appear as a whole string anywhere in `obj`? (Reporting
    only -- nothing found here is ever rewritten.)"""
    if _depth > 40:
        return False
    if isinstance(obj, str):
        return obj == needle
    if isinstance(obj, dict):
        return any(contains(v, needle, _depth + 1) for v in obj.values())
    if isinstance(obj, list):
        return any(contains(v, needle, _depth + 1) for v in obj)
    return False


@callback
def async_apply(hass: HomeAssistant, entry: ConfigEntry, old: str, new: str) -> dict[str, list[str]]:
    """Rewrite `old` -> `new` everywhere allowed; report the rest. Returns
    {"changed": [...], "manual": [...], "conflicts": [...]} (for the tests)."""
    from . import accessories, features as F
    from .settings import SUBENTRY_CHIP, SUBENTRY_DASHBOARD, SUBENTRY_PAGE, SUBENTRY_POPUP

    mods = {k: F.module(k) for k in F.KINDS}
    owned = {t: keys for m in mods.values() for t, keys in getattr(m, "RENAME_ITEMS", {}).items()}

    changed: list[str] = []
    manual: list[str] = []
    conflicts: list[str] = []

    dash = entry.options.get("dashboard")
    new_dash, paths = rewrite_options(dash, old, new)
    if paths:
        hass.config_entries.async_update_entry(entry, options={**entry.options, "dashboard": new_dash})
        changed += [f"setting {p}" for p in paths]
    for section, key in OPTION_SKIP:
        if isinstance(dash, dict) and contains((dash.get(section) or {}).get(key), old):
            manual.append(f"the {section} {key} options")

    for sub in list(entry.subentries.values()):
        kind, name = sub.subentry_type, sub.title or sub.unique_id or ""
        if kind == SUBENTRY_DASHBOARD:
            data, paths = rewrite_fields(sub.data, BOARD_KEYS, old, new)
            if paths:
                hass.config_entries.async_update_subentry(entry, sub, data=data)
                changed += [f"screen {name}: {p}" for p in paths]
            for k in FREE_BOARD_KEYS:
                if contains(sub.data.get(k), old):
                    manual.append(f"screen {name}: {k}")
        elif kind == SUBENTRY_POPUP:
            data, paths = rewrite_fields(sub.data, POPUP_KEYS, old, new)
            if paths:
                hass.config_entries.async_update_subentry(entry, sub, data=data)
                changed += [f"pop-up {name}: {p}" for p in paths]
            if contains(sub.data.get("cards"), old):
                manual.append(f"pop-up {name}: its cards")
        elif kind == SUBENTRY_CHIP:
            if contains(sub.data.get("card"), old):
                manual.append(f"custom chip {name}")
        elif kind == SUBENTRY_PAGE:
            if contains(sub.data.get("view"), old):
                manual.append(f"custom page {name}")
        elif kind == F.SUBENTRY_FEATURE and (mod := mods.get(str(sub.data.get(F.KIND) or ""))):
            data, paths = rewrite_feature(sub.data, getattr(mod, "RENAME", {}), old, new)
            if paths:
                kw: dict[str, Any] = {"data": data}
                if (hook := getattr(mod, "renamed", None)) is not None:
                    kw.update(hook(hass, dict(data.get("data") or {})))
                try:
                    hass.config_entries.async_update_subentry(entry, sub, **kw)
                except Exception as err:  # noqa: BLE001 -- e.g. the new id has an item of its own
                    conflicts.append(f"{name}: not followed ({err})")
                else:
                    changed += [f"{name}: {p}" for p in paths]
        elif kind in owned:
            data, paths = rewrite_fields(sub.data, owned[kind], old, new)
            if paths:
                hass.config_entries.async_update_subentry(entry, sub, data=data)
                changed += [f"{kind} {name}: {p}" for p in paths]

    acc = accessories.get(hass)
    if acc is not None:
        new_data, hits, clash = rewrite_accessories(acc.data, old, new)
        conflicts += clash
        if hits:
            acc.data = new_data
            acc._changed()                     # saves, re-resolves, nudges screens
            changed += [f"accessories: {h}" for h in hits]
    return {"changed": changed, "manual": manual, "conflicts": conflicts}


def _notify(hass: HomeAssistant, old: str, new: str, result: dict[str, list[str]]) -> None:
    if not any(result.values()):
        return
    lines = [f"**{old}** was renamed to **{new}**."]
    if result["changed"]:
        lines.append("HK Frontend followed it in:\n" + "\n".join(f"- {c}" for c in result["changed"]))
    if result["manual"]:
        lines.append("Still naming the old id -- edit these by hand (card configurations are never "
                     "rewritten):\n" + "\n".join(f"- {m}" for m in result["manual"]))
    if result["conflicts"]:
        lines.append("Left alone:\n" + "\n".join(f"- {c}" for c in result["conflicts"]))
    from homeassistant.components import persistent_notification
    persistent_notification.async_create(hass, "\n\n".join(lines), title="HK Frontend: an entity was renamed",
                                         notification_id=f"{NOTIFY_ID}_{new}")


@callback
def async_setup(hass: HomeAssistant, entry: ConfigEntry):
    """Listen for renames while the entry is loaded; returns the unsubscribe."""

    @callback
    def renamed(data) -> bool:
        return data.get("action") == "update" and bool(data.get("old_entity_id"))

    @callback
    def on_update(event: Event) -> None:
        old, new = event.data.get("old_entity_id"), event.data.get("entity_id")
        if not (isinstance(old, str) and isinstance(new, str)) or old == new:
            return
        if old.split(".", 1)[0] != new.split(".", 1)[0]:
            return                               # never across domains
        try:
            result = async_apply(hass, entry, old, new)
        except Exception:  # noqa: BLE001 -- a rename must never break on our account
            _LOGGER.exception("hk_frontend: following the rename %s -> %s failed; nothing further was changed", old, new)
            return
        if result["changed"]:
            _LOGGER.info("hk_frontend: %s -> %s followed in %s", old, new, "; ".join(result["changed"]))
        if result["manual"] or result["conflicts"]:
            _LOGGER.warning("hk_frontend: %s -> %s not followed in %s", old, new,
                            "; ".join(result["manual"] + result["conflicts"]))
        _notify(hass, old, new, result)

    return hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, on_update, event_filter=renamed)
