"""Per channel: what is on now (state = title) and next. Plus who is watching."""
from __future__ import annotations

from datetime import timedelta

from homeassistant.components.sensor import SensorEntity
from homeassistant.core import callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import channels_of, entity_ids, slug
from .const import DATA, SIGNAL_VIEWERS
from .guide import now_next


async def async_setup_entry(hass, entry, async_add_entities):
    coord = hass.data[DATA]["coordinator"]
    ents = [NowPlaying(coord, entry, c) for c in channels_of(entry)]
    ents.append(ViewersSensor(entry))
    async_add_entities(ents)


class NowPlaying(CoordinatorEntity, SensorEntity):
    _attr_icon = "mdi:television-classic"

    def __init__(self, coord, entry, channel: dict) -> None:
        super().__init__(coord)
        self._entry = entry
        self._number = channel["number"]
        self._name = channel["name"]
        self._attr_name = f"TV {channel['name']} now"
        self._attr_unique_id = f"{entry.entry_id}_{self._number}_now"
        self.entity_id = f"sensor.tv_{slug(channel['name'])}_now"

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        # Programmes change on the half hour, not when the guide is fetched.
        # A @callback, so it runs on the event loop: a plain lambda here is
        # run in the executor, and async_write_ha_state from a worker thread
        # is what Home Assistant warns about.
        @callback
        def minute(_now):
            self.async_write_ha_state()
        self.async_on_remove(async_track_time_interval(self.hass, minute, timedelta(minutes=1)))

    def _guide(self):
        return (self.coordinator.data or {}).get(self._number) or {}

    @property
    def available(self) -> bool:
        return True                      # a channel with no guide still plays

    @property
    def native_value(self):
        cur, _ = now_next(self._guide().get("programmes", []))
        return (cur["title"][:250] if cur else None) or "Live"

    @property
    def extra_state_attributes(self):
        g = self._guide()
        cur, nxt = now_next(g.get("programmes", []))
        cam = entity_ids(self.hass, self._entry, self._number)["camera"]
        attrs = {"channel": self._number, "network": g.get("network") or self._name,
                 "name": self._name, "logo": g.get("logo"), "camera": cam}
        if cur:
            attrs.update(subtitle=cur["subtitle"], description=cur["description"],
                         start=cur["start"], end=cur["end"], image=cur["image"])
        if nxt:
            attrs.update(next_title=nxt["title"], next_start=nxt["start"], next_image=nxt["image"])
        return attrs


class ViewersSensor(SensorEntity):
    """Screens watching now: state = how many, `users` = their user names --
    what a wall tablet's sleep template can read to stay awake."""

    _attr_name = "TV viewers"
    _attr_icon = "mdi:account-eye"
    _attr_should_poll = False

    def __init__(self, entry) -> None:
        self._attr_unique_id = f"{entry.entry_id}_viewers"
        self.entity_id = "sensor.tv_viewers"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(
            self.hass, SIGNAL_VIEWERS, self.async_write_ha_state))

        @callback
        def prune(_now):
            if self.hass.data[DATA]["viewers"].prune():
                self.async_write_ha_state()
        self.async_on_remove(async_track_time_interval(self.hass, prune, timedelta(seconds=30)))

    @property
    def native_value(self):
        return len(self.hass.data[DATA]["viewers"].snapshot())

    @property
    def extra_state_attributes(self):
        snap = self.hass.data[DATA]["viewers"].snapshot()
        return {"users": [n for n, _ in snap], "channels": sorted({c for _, c in snap})}
