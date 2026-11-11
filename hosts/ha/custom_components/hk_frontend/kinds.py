"""STATUS & CHIPS: the house's smoke and CO alarms, temperature and humidity
readings, lights, fans, doors, windows, garage doors, locks, blinds, leak
sensors, motion and occupancy sensors, valves, thermostats, timers, vacuums and
speakers -- FOUND, not listed.

A chip that must be told what to count -- a template sensor walking a list
of entities, or an entity list typed into its YAML -- counts nothing on a new
install. So nothing is listed by hand:

EACH KIND IS AUTOMATIC: every entity of that kind the house has, by domain and
device class, less anything hidden, disabled, a config or diagnostic entity,
a group of other entities (a light group would count its members twice), or
left out of HK everywhere (HK Settings -> Accessories -> Hidden from Screens).
HK Settings -> Status & Chips then adjusts each kind with two pickers -- Leave
out and Also count -- and an untouched kind stays automatic, so a new light is
counted the day it is added.

THE READINGS (temperature, humidity) feed the Climate page, not a chip, and
are found by room rather than by class -- a CPU's temperature is no room's: an
area's Related sensor (Home Assistant's area settings), else the area's
thermostat (its current_temperature / current_humidity). Other sensors of the
class come in only through Also count.

Resolved HERE, once, and handed to every screen as `kinds` (settings.as_client):
the chips, the header's security line and the generated pages all read the same
lists, so a chip can never say "3 On" while its page shows four.

AN ENTRY FROM AN OLDER VERSION may hold lists chosen before Status & Chips
(security's locks, doors, windows and garage; features' thermostats -- LEGACY).
It keeps exactly those until Status & Chips is saved: a kind with nothing saved
and an old list uses the old list as it is. The page offers that list as Leave
out / Also count against what it finds now, so saving it changes nothing that
is counted -- see suggest().
"""
from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

from homeassistant.const import (
    EVENT_HOMEASSISTANT_STOP, EVENT_STATE_CHANGED, STATE_UNAVAILABLE, STATE_UNKNOWN)
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import DOMAIN, SIGNAL_CONFIG
# The kinds themselves, LEGACY and a saved kind's shape are shared (hk_core/settings/kinds.py).
from .hk_core.settings.kinds import KINDS, LEGACY, Kind, blank, clean  # noqa: F401 -- shared
# The finding itself is shared with Mantel Server (hk_core/settings/kind_match.py).
from .hk_core.settings.kind_match import (  # noqa: F401 -- shared
    SHOW_AS_KIND, Candidate, accessories_over, automatic, legacy, matches, resolve)
# What a kind shows on Status & Chips: hk_core's, shared with Mantel Server (hk_core/settings/hiding.py).
from .hk_core.settings.hiding import suggest  # noqa: F401 -- shared

_LOGGER = logging.getLogger(__name__)


def candidates(hass: HomeAssistant) -> list[Candidate]:
    ents = er.async_get(hass)
    devs = dr.async_get(hass)
    areas = ar.async_get(hass).areas
    nominated = {k: {getattr(a, k + "_entity_id", None) for a in areas.values()}
                 for k in ("temperature", "humidity")}
    # The domains Also count may name too: an included switch must be present.
    wanted = {d for k in KINDS.values() for d in k.domains + k.also}
    # A THERMOSTAT'S READINGS ARE ATTRIBUTES, and Home Assistant drops them
    # while it is unavailable (current_humidity, too, while it is None): a
    # cloud thermostat off its Wi-Fi for a minute would leave the Climate
    # summaries and rebuild every screen twice. So what it has been seen to
    # report is kept until the next start.
    seen: dict[str, frozenset[str]] = hass.data.setdefault(DOMAIN, {}).setdefault(SEEN, {})
    out = []
    for st in hass.states.async_all():
        domain = st.entity_id.split(".", 1)[0]
        if domain not in wanted:
            continue
        entry = ents.async_get(st.entity_id)
        # a group of other entities counts its members twice: a helper's
        # (entity_id) or, since Home Assistant 2026, any integration's -- a
        # Hue room, a Zigbee group (group_entities)
        # (a scene lists the entities it sets in entity_id: it is no group)
        group = domain != "scene" and any(isinstance(st.attributes.get(k), list) for k in ("entity_id", "group_entities"))
        listed = True
        device_id = area_id = None
        if entry is not None:
            listed = not (entry.hidden_by or entry.disabled_by or entry.entity_category)
            device_id = entry.device_id
            area_id = entry.area_id
            if area_id is None and device_id:
                dev = devs.async_get(device_id)
                area_id = dev.area_id if dev else None
        if domain == "climate":
            had = seen.get(st.entity_id, frozenset())
            seen[st.entity_id] = had | {k for k in nominated if "current_" + k in st.attributes}
        readings = tuple(k for k in nominated if
                         (domain == "sensor" and st.attributes.get("device_class") == k)
                         or (domain == "climate" and k in seen[st.entity_id]))
        area = areas.get(area_id)
        # Room-related sensors are deliberate ambient readings. Other matching
        # sensors are offered by Also count, never guessed from their names.
        auto = tuple(k for k in readings if st.entity_id in nominated[k]
                     or (domain == "climate" and area is not None
                         and not getattr(area, k + "_entity_id", None)))
        out.append(Candidate(st.entity_id, st.attributes.get("device_class"), listed and not group,
                             device_id, area_id, readings, auto, group, listed))
    return out


# ------------------------------------------------------------ kept current
DATA = "kinds"
SEEN = "kinds_climate_readings"   # candidates(): each thermostat's readings


class Tracker:
    """The resolved kinds, kept current: recomputed (at most once a second)
    when an entity appears or goes or its device class changes, when a
    thermostat gains or loses a reading, when the entity, device or area
    registry changes (an area's Related sensors), and when the settings do. Tells the screens only when a list
    actually changed."""

    def __init__(self, hass: HomeAssistant, settings_of) -> None:
        self.hass = hass
        self._settings_of = settings_of
        self.kinds: dict[str, list[str]] = {k: [] for k in KINDS}
        self._debounce = Debouncer(hass, _LOGGER, cooldown=1.0, immediate=False,
                                   function=self._refresh)
        self._unsub: list = []

    @callback
    def start(self) -> None:
        self.kinds = resolve(candidates(self.hass), self._settings_of())

        @callback
        def added_or_gone(data: Mapping[str, Any]) -> bool:
            old, new = data.get("old_state"), data.get("new_state")
            if old is None or new is None:
                return True
            # Reclassify when capabilities change, not when a reading moves --
            # nor when a thermostat's readings vanish with its going
            # unavailable (candidates() keeps them). Coming back still counts:
            # one that started unavailable is first seen then.
            # entity_id / group_entities: whether it is a group (candidates())
            keys = ("device_class", "entity_id", "group_entities")
            if any(old.attributes.get(k) != new.attributes.get(k) for k in keys):
                return True
            return new.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN) and any(
                (k in old.attributes) != (k in new.attributes)
                for k in ("current_temperature", "current_humidity"))

        @callback
        def poke(_event: Event | None = None) -> None:
            self._debounce.async_schedule_call()

        bus = self.hass.bus
        self._unsub = [
            bus.async_listen(EVENT_STATE_CHANGED, poke, event_filter=added_or_gone),
            bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, poke),
            bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, poke),
            bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, poke),
        ]
        # callback(): a bare lambda is an executor job, and stop() removes bus
        # listeners and cancels the debouncer, which belong on the event loop
        bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, callback(lambda _e: self.stop()))

    @callback
    def settings_changed(self) -> None:
        """Called before the screens are nudged, so they are sent the new lists."""
        self.kinds = resolve(candidates(self.hass), self._settings_of())

    async def _refresh(self) -> None:
        new = resolve(candidates(self.hass), self._settings_of())
        if new != self.kinds:
            self.kinds = new
            async_dispatcher_send(self.hass, SIGNAL_CONFIG)

    @callback
    def stop(self) -> None:
        for u in self._unsub:
            u()
        self._unsub = []
        self._debounce.async_shutdown()


def current(hass: HomeAssistant) -> dict[str, list[str]] | None:
    t = hass.data.get(DOMAIN, {}).get(DATA)
    return t.kinds if t else None
