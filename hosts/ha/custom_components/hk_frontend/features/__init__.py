"""THE FEATURES: what HK Frontend adds beside the dashboards, each optional,
each an ITEM of the house's entry (a subentry of type "feature"), added with
Settings -> Devices & services -> HK Frontend -> Add feature:

    music        Music: whole-home music through Music Assistant
    live_tv      Live TV: an HDHomeRun tuner's channels, on the screens
    clean_areas  Clean Areas: "clean these rooms" for the house's vacuums
    alarm_pin    Alarm PIN: a PIN in front of an alarm that takes none
                 (one item per alarm)
    energy       Energy: the Energy page, built from Home Assistant's own
                 Energy settings
    notifications  Notifications: a banner on the screens when an accessory
                 does something (a camera's snapshot with it)

WHY ITEMS, NOT ENTRIES. HACS installs one integration per repository, so the
features live in this one. Given more than one entry, Home Assistant's
integration page answers every "Add ..." button with a list of ALL of them to
pick from, whichever one the item belongs to (a dashboard offered to Live
TV). With one entry, every button opens its own form.

An item's data is {kind, data, options}: what a feature's own entry once held
as its data and options. Its code still reads it as an entry: a Feature
(below) is an entry-like view of the item -- entry_id, title, data, options,
runtime_data, async_on_unload -- whose data and options are read from the item
each time. Its entry_id is the item's id, which is also what its entities'
unique ids and its device are built from.

Each feature is a package here with the same shape:

    PLATFORMS                          the entity platforms it adds to
    RELOAD                             a change restarts it (its entities are
                                       rebuilt); otherwise async_changed
    ITEM_TYPES                         the house's item types it owns (Music's
                                       presets and playlists)
    async_setup(hass)                  once, at start: its actions and its
                                       websocket commands (so the settings page
                                       can ask even before it is added)
    async_setup_entry / async_unload_entry (hass, feature)
    async_changed(hass, feature)       a change, when it does not restart
    AddSteps / ReconfigureSteps        its steps in the feature item's flow
                                       (config_flow.FeatureFlow); every step id
                                       starts with the kind ("alarm_pin_...")

The house's entry starts the features when it is set up and follows its items
afterwards (async_sync, from its update listener): an item added starts, one
removed stops (Home Assistant removes its entities and device), one changed
restarts or is told.

(A pre-release of 1.0 made each feature an entry of its own; async_fold turns
such entries into items, once.)
"""
from __future__ import annotations

import asyncio
import importlib
import logging
from collections.abc import Callable, Iterable, Mapping
from types import MappingProxyType, ModuleType
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigEntryState, ConfigSubentry
from homeassistant.const import Platform
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.typing import UNDEFINED, UndefinedType

from ..const import DOMAIN

_LOGGER = logging.getLogger(__name__)

KIND = "kind"
FRONTEND = "frontend"
MUSIC = "music"
LIVE_TV = "live_tv"
CLEAN_AREAS = "clean_areas"
ALARM_PIN = "alarm_pin"
ENERGY = "energy"
NOTIFICATIONS = "notifications"
KINDS = (MUSIC, LIVE_TV, CLEAN_AREAS, ALARM_PIN, ENERGY, NOTIFICATIONS)
# one per house; Alarm PIN has one per protected alarm
SINGLE = (MUSIC, LIVE_TV, CLEAN_AREAS, ENERGY, NOTIFICATIONS)
TITLES = {MUSIC: "Music", LIVE_TV: "Live TV", CLEAN_AREAS: "Clean Areas", ALARM_PIN: "Alarm PIN", ENERGY: "Energy",
          NOTIFICATIONS: "Notifications"}
# every platform a feature adds to: the house's entry forwards them all
PLATFORMS = [Platform.ALARM_CONTROL_PANEL, Platform.CAMERA, Platform.SENSOR]

SUBENTRY_FEATURE = "feature"
_RUNNING = "features"                  # hass.data[DOMAIN]: {item id: Feature}
_ADDERS = "feature_adders"             # hass.data[DOMAIN]: {platform: add_entities}
_SEEN = "features_seen"                # hass.data[DOMAIN]: what async_sync last saw
_LOCK = "features_lock"


def module(kind: str) -> ModuleType:
    """A feature's package."""
    if kind not in KINDS:
        raise KeyError(kind)
    return importlib.import_module(f"{__name__}.{kind}")


def unique_id(kind: str, key: str = "") -> str:
    """A feature item's unique id: its kind, and for Alarm PIN the alarm. It
    shares a namespace with the house's other items (a #music pop-up), hence
    the prefix."""
    return f"feature:{kind}:{key}" if key else f"feature:{kind}"


def item_data(kind: str, data: Mapping[str, Any] | None = None,
              options: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """What a feature item stores."""
    return {KIND: kind, "data": {k: v for k, v in dict(data or {}).items() if k != KIND},
            "options": dict(options or {})}


def kind_of(entry: ConfigEntry) -> str:
    """FRONTEND for the house's entry; a pre-release feature entry says its
    kind (async_fold)."""
    return str(entry.data.get(KIND) or FRONTEND)


def frontend_entry(hass: HomeAssistant) -> ConfigEntry | None:
    """The house's entry (there is only ever one), loaded or not: its options
    are the settings even while it is disabled."""
    return next((e for e in hass.config_entries.async_entries(DOMAIN) if kind_of(e) == FRONTEND), None)


class Feature:
    """One added feature, as its code sees it: an entry-like view of its item.

    Live: title, data, options and the owned items are read from the house's
    entry each time, so a write is seen at once. Once the item is gone, they
    stay as they were last read."""

    domain = DOMAIN

    def __init__(self, hass: HomeAssistant, house: ConfigEntry, item_id: str) -> None:
        self.hass = hass
        self.house = house
        self.entry_id = item_id
        self.runtime_data: Any = None
        self.entities: list[Entity] = []
        self.loaded = False
        self._unload: list[Callable[[], Any]] = []
        self._state: list[CALLBACK_TYPE] = []
        item = self._item
        self._last = (item.title, item.unique_id, dict(item.data)) if item else ("", None, {})

    @property
    def _item(self) -> ConfigSubentry | None:
        return self.house.subentries.get(self.entry_id)

    def _read(self) -> tuple[str, str | None, dict[str, Any]]:
        item = self._item
        if item is not None:
            self._last = (item.title, item.unique_id, dict(item.data))
        return self._last

    @property
    def kind(self) -> str:
        return str(self._read()[2].get(KIND) or "")

    @property
    def title(self) -> str:
        return self._read()[0]

    @property
    def unique_id(self) -> str | None:
        return self._read()[1]

    @property
    def data(self) -> Mapping[str, Any]:
        stored = self._read()[2]
        return MappingProxyType({KIND: stored.get(KIND), **dict(stored.get("data") or {})})

    @property
    def options(self) -> Mapping[str, Any]:
        return MappingProxyType(dict(self._read()[2].get("options") or {}))

    @property
    def config_entry_id(self) -> str:
        """The entry its entities and device belong to: the house's."""
        return self.house.entry_id

    @property
    def subentries(self) -> Mapping[str, ConfigSubentry]:
        """The house's items this feature owns (Music: presets, playlists)."""
        types = getattr(module(self.kind), "ITEM_TYPES", ()) if self.kind in KINDS else ()
        return MappingProxyType({k: s for k, s in self.house.subentries.items() if s.subentry_type in types})

    @property
    def state(self) -> ConfigEntryState:
        return ConfigEntryState.LOADED if self.loaded else ConfigEntryState.NOT_LOADED

    @callback
    def async_on_unload(self, func: Callable[[], Any]) -> None:
        self._unload.append(func)

    @callback
    def async_on_state_change(self, func: CALLBACK_TYPE) -> CALLBACK_TYPE:
        self._state.append(func)
        return lambda: self._state.remove(func) if func in self._state else None

    def _state_changed(self) -> None:
        for func in list(self._state):
            try:
                func()
            except Exception:  # noqa: BLE001 -- one listener does not stop the rest
                _LOGGER.exception("hk_frontend: %s state listener failed", self.kind)

    async def _run_unload(self) -> None:
        while self._unload:
            func = self._unload.pop()
            try:
                res = func()
                if asyncio.iscoroutine(res):
                    await res
            except Exception:  # noqa: BLE001
                _LOGGER.exception("hk_frontend: %s unload callback failed", self.kind)


# ---------------------------------------------------------------- lookups
def _items(house: ConfigEntry | None) -> dict[str, ConfigSubentry]:
    if house is None:
        return {}
    return {k: s for k, s in house.subentries.items()
            if s.subentry_type == SUBENTRY_FEATURE and s.data.get(KIND) in KINDS}


def _running(hass: HomeAssistant) -> dict[str, Feature]:
    return hass.data.setdefault(DOMAIN, {}).setdefault(_RUNNING, {})


def loaded(hass: HomeAssistant, kind: str | None = None) -> list[Feature]:
    """The features that are running (of one kind)."""
    return [f for f in _running(hass).values() if kind is None or f.kind == kind]


def entries(hass: HomeAssistant, kind: str) -> list[Feature]:
    """Every added feature of one kind, running or not."""
    house, run = frontend_entry(hass), _running(hass)
    return [run.get(k) or Feature(hass, house, k) for k, s in _items(house).items() if s.data.get(KIND) == kind]


def item(hass: HomeAssistant, item_id: str) -> Feature | None:
    """An added feature by its id."""
    house = frontend_entry(hass)
    if item_id not in _items(house):
        return None
    return _running(hass).get(item_id) or Feature(hass, house, item_id)


@callback
def async_update(hass: HomeAssistant, feature: Feature, *,
                 data: Mapping[str, Any] | UndefinedType = UNDEFINED,
                 options: Mapping[str, Any] | UndefinedType = UNDEFINED,
                 title: str | UndefinedType = UNDEFINED,
                 unique_id: str | None | UndefinedType = UNDEFINED) -> bool:
    """Write a feature's data and/or options (and its item's title or unique
    id). The house's update listener then restarts it or tells it."""
    item_ = feature._item
    if item_ is None:
        return False
    stored = dict(item_.data)
    if data is not UNDEFINED:
        stored["data"] = {k: v for k, v in dict(data).items() if k != KIND}
    if options is not UNDEFINED:
        stored["options"] = dict(options)
    kw: dict[str, Any] = {"data": stored}
    if title is not UNDEFINED:
        kw["title"] = title
    if unique_id is not UNDEFINED:
        kw["unique_id"] = unique_id
    return hass.config_entries.async_update_subentry(feature.house, item_, **kw)


@callback
def async_remove(hass: HomeAssistant, feature: Feature) -> None:
    """Remove a feature: its item goes, and Home Assistant removes its
    entities and device with it."""
    hass.config_entries.async_remove_subentry(feature.house, feature.entry_id)


# -------------------------------------------------------------- lifecycle
def _seen(house: ConfigEntry) -> dict[str, Any]:
    """What async_sync compares: each feature item, and each owned item."""
    owned: set[str] = set()
    for kind in KINDS:
        owned |= set(getattr(module(kind), "ITEM_TYPES", ()))
    return {k: (s.subentry_type, s.title, s.unique_id, dict(s.data)) for k, s in house.subentries.items()
            if k in _items(house) or s.subentry_type in owned}


async def async_start(hass: HomeAssistant, house: ConfigEntry) -> None:
    """At the house's setup, before its platforms: every added feature."""
    hass.data.setdefault(DOMAIN, {})[_SEEN] = _seen(house)
    for item_id in _items(house):
        await _start(hass, house, item_id)


async def async_stop(hass: HomeAssistant) -> None:
    """At the house's unload, after its platforms (which took the entities)."""
    for feat in list(_running(hass).values()):
        await _stop(hass, feat)
    hass.data.get(DOMAIN, {}).pop(_ADDERS, None)


async def async_sync(hass: HomeAssistant, house: ConfigEntry) -> None:
    """The house's entry changed: follow its feature items."""
    lock = hass.data.setdefault(DOMAIN, {}).setdefault(_LOCK, asyncio.Lock())
    async with lock:
        before = hass.data[DOMAIN].get(_SEEN, {})
        now = _seen(house)
        hass.data[DOMAIN][_SEEN] = now
        if now == before:
            return
        run, want = _running(hass), _items(house)
        touched: set[str] = set()
        for item_id in [k for k in run if k not in want]:
            await _stop(hass, run[item_id], removed=True)
        for item_id in [k for k in want if k not in run]:
            if await _start(hass, house, item_id):
                await _add_entities(hass, run[item_id])
        for item_id, feat in list(run.items()):
            if item_id in want and before.get(item_id) not in (None, now.get(item_id)):
                touched.add(feat.kind)
                if getattr(module(feat.kind), "RELOAD", False):
                    await _stop(hass, feat, entities=True)
                    if await _start(hass, house, item_id):
                        await _add_entities(hass, run[item_id])
                else:
                    await _changed(hass, feat)
        # an owned item (a preset, a playlist) added, changed or removed
        for kind in KINDS:
            types = set(getattr(module(kind), "ITEM_TYPES", ()))
            if not types or kind in touched:
                continue
            if any((before.get(k) or now.get(k))[0] in types
                   for k in set(before) | set(now) if before.get(k) != now.get(k)):
                for feat in loaded(hass, kind):
                    await _changed(hass, feat)
        # No SIGNAL_CONFIG here: the house's update listener -- this function's
        # only caller -- sends the settings to every screen once it returns.
        # Sent here too, every feature change went out twice (85 KB each, to
        # every screen).


async def _start(hass: HomeAssistant, house: ConfigEntry, item_id: str) -> bool:
    feat = Feature(hass, house, item_id)
    try:
        ok = await module(feat.kind).async_setup_entry(hass, feat)
    except Exception:  # noqa: BLE001 -- one feature failing leaves the others and the house
        _LOGGER.exception("hk_frontend: %s could not be started", feat.title or feat.kind)
        await feat._run_unload()
        return False
    if ok is False:
        await feat._run_unload()
        return False
    feat.loaded = True
    _running(hass)[item_id] = feat
    feat._state_changed()
    return True


async def _stop(hass: HomeAssistant, feat: Feature, *, entities: bool = False, removed: bool = False) -> None:
    """Stop a feature. entities: take its entities off too (a restart; the
    registry keeps them, so they come back with the same ids). A removed
    item's entities Home Assistant removes itself."""
    if entities:
        for ent in list(feat.entities):
            try:
                await ent.async_remove()
            except Exception:  # noqa: BLE001 -- already gone
                _LOGGER.debug("hk_frontend: %s already removed", ent.entity_id)
    feat.entities.clear()
    # STOPPED FIRST, then told, then unloaded: its own listeners (Music's
    # state listener tells the screens) are among the unload callbacks, and
    # whatever they send must already find it stopped
    feat.loaded = False
    _running(hass).pop(feat.entry_id, None)
    feat._state_changed()
    try:
        await module(feat.kind).async_unload_entry(hass, feat)
    except Exception:  # noqa: BLE001
        _LOGGER.exception("hk_frontend: %s did not unload cleanly", feat.title or feat.kind)
    await feat._run_unload()
    if removed and (hook := getattr(module(feat.kind), "async_remove_entry", None)) is not None:
        try:
            await hook(hass, feat)
        except Exception:  # noqa: BLE001
            _LOGGER.exception("hk_frontend: %s did not tidy up after itself", feat.title or feat.kind)


async def _changed(hass: HomeAssistant, feat: Feature) -> None:
    hook = getattr(module(feat.kind), "async_changed", None)
    if hook is not None:
        try:
            await hook(hass, feat)
        except Exception:  # noqa: BLE001
            _LOGGER.exception("hk_frontend: %s could not follow a change", feat.title or feat.kind)


# --------------------------------------------------------------- entities
async def async_setup_platform(hass: HomeAssistant, platform: Platform,
                               async_add_entities: Callable[..., None]) -> None:
    """The house's entry set up one of the features' platforms: keep its
    add_entities for features started later, and add the running ones'."""
    hass.data.setdefault(DOMAIN, {}).setdefault(_ADDERS, {})[platform] = async_add_entities
    for feat in loaded(hass):
        if platform in module(feat.kind).PLATFORMS:
            await _add_platform(hass, feat, platform)


async def _add_entities(hass: HomeAssistant, feat: Feature) -> None:
    for platform in module(feat.kind).PLATFORMS:
        if platform in hass.data.get(DOMAIN, {}).get(_ADDERS, {}):
            await _add_platform(hass, feat, platform)


async def _add_platform(hass: HomeAssistant, feat: Feature, platform: Platform) -> None:
    real = hass.data[DOMAIN][_ADDERS][platform]

    @callback
    def add(new_entities: Iterable[Entity], update_before_add: bool = False) -> None:
        new = list(new_entities)
        feat.entities.extend(new)
        real(new, update_before_add, config_subentry_id=feat.entry_id)

    # A feature platform is imported only when that feature is present.  Keep
    # the filesystem import off Home Assistant's event loop; cached imports
    # return cheaply through the same path on later reloads.
    mod = await hass.async_add_import_executor_job(
        importlib.import_module, f"{module(feat.kind).__name__}.{platform.value}")
    try:
        await mod.async_setup_entry(hass, feat, add)
    except Exception:  # noqa: BLE001
        _LOGGER.exception("hk_frontend: %s's %s could not be added", feat.title or feat.kind, platform.value)


# ------------------------------------------------------------ the fold-in
async def async_fold(hass: HomeAssistant) -> None:
    """A pre-release of 1.0 made each feature an entry of its own. Each
    becomes an item of the house's entry with the entry's id as its own, so
    its entities' unique ids and its device's identifier are unchanged; its
    entities and device move to the house's entry (the same entity ids), its
    items (Music's presets and playlists) move with their ids, and the entry
    is removed. Runs at start, before any entry is set up. One that cannot be
    folded is left as it was and says why; it never stops the rest."""
    olds = [e for e in hass.config_entries.async_entries(DOMAIN) if kind_of(e) in KINDS]
    if not olds:
        return
    house = frontend_entry(hass)
    if house is None:
        _LOGGER.warning("hk_frontend: %s from a pre-release, with no HK Frontend entry to fold into. Delete "
                        "it in Settings -> Devices & services, add HK Frontend, then add the feature again",
                        ", ".join(e.title for e in olds))
        return
    for old in olds:
        try:
            await _fold(hass, house, old)
        except Exception:  # noqa: BLE001 -- the house and the other features still start
            _LOGGER.exception("hk_frontend: %s could not be made a feature of the HK Frontend entry", old.title)


async def _fold(hass: HomeAssistant, house: ConfigEntry, old: ConfigEntry) -> None:
    kind = kind_of(old)
    key = str(old.data.get("alarm") or "") if kind == ALARM_PIN else ""
    uid = unique_id(kind, key)
    if old.entry_id not in house.subentries and any(s.unique_id == uid for s in house.subentries.values()):
        _LOGGER.warning("hk_frontend: HK Frontend already has %s, so the older %s entry from a pre-release "
                        "is left as it is; delete it in Settings -> Devices & services", old.title, old.title)
        return
    title = old.title
    if kind == ALARM_PIN and not title.endswith(" PIN"):
        title += " PIN"                    # its item names the PIN, not the alarm
    ereg, dreg = er.async_get(hass), dr.async_get(hass)
    if old.entry_id not in house.subentries:
        hass.config_entries.async_add_subentry(house, ConfigSubentry(
            subentry_id=old.entry_id, subentry_type=SUBENTRY_FEATURE, title=title,
            unique_id=uid, data=MappingProxyType(item_data(kind, old.data, old.options))))
    for sub in old.subentries.values():
        if sub.subentry_id not in house.subentries:
            hass.config_entries.async_add_subentry(house, ConfigSubentry(
                subentry_id=sub.subentry_id, subentry_type=sub.subentry_type, title=sub.title,
                unique_id=sub.unique_id, data=sub.data))
    for ent in er.async_entries_for_config_entry(ereg, old.entry_id):
        ereg.async_update_entity(ent.entity_id, config_entry_id=house.entry_id,
                                 config_subentry_id=old.entry_id)
    for dev in dr.async_entries_for_config_entry(dreg, old.entry_id):
        try:
            dreg.async_update_device(dev.id, new_config_entry_id=house.entry_id,
                                     new_config_subentry_id=old.entry_id)
        except TypeError:          # before new_config_entry_id (2026.9)
            dreg.async_update_device(dev.id, add_config_entry_id=house.entry_id,
                                     add_config_subentry_id=old.entry_id,
                                     remove_config_entry_id=old.entry_id)
    # a folded entry's removal is not a feature's removal: async_remove_entry
    # ignores an entry with a kind
    await hass.config_entries.async_remove(old.entry_id)
    _LOGGER.info("hk_frontend: %s is now a feature of the HK Frontend entry", old.title)
