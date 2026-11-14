"""MANTEL'S APPLE TV CAMERA IN HOMEKIT (phase 31, docs/phase31/PLAN.md "Who serves the camera").

Mantel shows notifications on the Apple TVs as a HomeKit camera's alert: it publishes a camera (its picture drawn by
Mantel, fetched over the link: entity.py's ``LinkedCamera``) and a motion sensor it turns on for each notification.
Home Assistant's own HomeKit Bridge serves them to HomeKit. This module makes and removes that HomeKit Bridge entry
when Mantel says so, and tells Mantel how it stands, so the owner does everything from Mantel's Settings:

* **Want** (the camera's ``features.homekit``: ``{want, sensor}``): Add to HomeKit in Mantel makes the entry through
  HomeKit's own import flow -- accessory mode, named "Mantel Alerts", the next free port, the camera with the sensor
  as its linked motion sensor, no audio (the entity settings checked by HomeKit's own ``validate_entity_config``).
  Home Assistant lists it as set up in YAML, so nobody edits it by hand. Remove from HomeKit removes it.
* **How it stands** (``report.homekit`` to Mantel): ``none``, ``starting``, ``unpaired`` with the setup code and URI
  (Mantel Settings draws its QR code), ``paired``, or ``error``. Read from the entry's HomeKit driver
  (``runtime_data.homekit.driver``): Home Assistant's inside, not a public API, so anything missing reads as
  ``starting`` and Mantel's Settings points at the code in Home Assistant's notifications instead. Told when it
  changes, and looked at again every LOOK_S while it is wanted and not yet paired.

Nothing else in Home Assistant is touched: no automation, no script, no other HomeKit entry.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import SOURCE_IMPORT
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_time_interval

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

HOMEKIT = "homekit"
BRIDGE_NAME = "Mantel Alerts"
START_PORT = 21128
LOOK_S = 30


def _validate(config: dict[str, Any]) -> dict[str, Any]:
    from homeassistant.components.homekit.util import validate_entity_config
    return validate_entity_config(config)


def _free_port(hass: HomeAssistant) -> int:
    from homeassistant.components.homekit.util import async_find_next_available_port
    return async_find_next_available_port(hass, START_PORT)


def import_data(camera: str, sensor: str, port: int) -> dict[str, Any]:
    """The HomeKit Bridge entry, as its YAML import takes it: one camera in accessory mode, its motion sensor linked."""
    return {"name": BRIDGE_NAME, "port": port, "mode": "accessory",
            "filter": {"include_domains": [], "include_entities": [camera], "include_entity_globs": [],
                       "exclude_domains": [], "exclude_entities": [], "exclude_entity_globs": []},
            "entity_config": _validate({camera: {"linked_motion_sensor": sensor, "support_audio": False}})}


def ours(hass: HomeAssistant) -> Any:
    """The HomeKit Bridge entry this module made, or None."""
    for e in hass.config_entries.async_entries(HOMEKIT, include_ignore=False):
        if e.source == SOURCE_IMPORT and (e.data or {}).get("name") == BRIDGE_NAME:
            return e
    return None


def status(hass: HomeAssistant) -> dict[str, Any]:
    """How the entry stands, for Mantel (never logged: the setup code pairs a Home)."""
    e = ours(hass)
    if e is None:
        return {"state": "none"}
    hk = getattr(getattr(e, "runtime_data", None), "homekit", None)
    driver = getattr(hk, "driver", None)
    state = getattr(driver, "state", None)
    if state is None:
        return {"state": "starting"}
    try:
        if state.paired:
            return {"state": "paired"}
        pin = state.pincode.decode() if isinstance(state.pincode, bytes) else str(state.pincode)
        return {"state": "unpaired", "code": pin, "uri": driver.accessory.xhm_uri()}
    except Exception:  # noqa: BLE001 -- HomeKit's inside moved: Mantel says to read HA's notification
        return {"state": "starting"}


class HomeKitLink:
    """Keeps the entry as Mantel wants it, and Mantel told how it stands (one per Mantel Link entry)."""

    def __init__(self, bridge: Any) -> None:
        self.bridge, self.hass = bridge, bridge.hass
        self._task: asyncio.Task | None = None
        self._again = False
        self._told: dict[str, Any] | None = None
        self._unsub: Any = None
        self.error: str | None = None

    def start(self) -> None:
        self._unsub = async_track_time_interval(self.hass, self._tick, timedelta(seconds=LOOK_S))

    def stop(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None
        if self._task is not None:
            self._task.cancel()

    def wish(self) -> tuple[bool, str | None, str | None] | None:
        """(want, camera's entity id, sensor's entity id) from Mantel's camera, or None when Mantel publishes none."""
        for uid, d in self.bridge.descs.items():
            hk = (d.get("features") or {}).get("homekit") if d.get("platform") == "camera" else None
            if isinstance(hk, dict):
                reg = er.async_get(self.hass)
                cam = reg.async_get_entity_id("camera", DOMAIN, uid)
                sensor = reg.async_get_entity_id("binary_sensor", DOMAIN, hk.get("sensor")) if isinstance(
                    hk.get("sensor"), str) else None
                return bool(hk.get("want")), cam, sensor
        return None

    @callback
    def changed(self) -> None:
        """Mantel's entities changed (or the link came back): bring the entry in line, then tell Mantel."""
        if self._task is not None and not self._task.done():
            self._again = True
            return
        self._task = self.hass.async_create_task(self._sync(), "Mantel Link: HomeKit")

    @callback
    def reconnected(self) -> None:
        """The link came back: Mantel is told again, whatever it was told before."""
        self._told = None
        self.changed()

    @callback
    def _tick(self, _now: Any) -> None:
        w = self.wish()
        if w is not None and w[0] and (self._told or {}).get("state") != "paired":
            self.changed()

    async def _sync(self) -> None:
        while True:
            self._again = False
            try:
                await self._apply()
            except Exception as err:  # noqa: BLE001 -- told to Mantel, tried again on the next change
                _LOGGER.warning("Mantel Link: the Apple TV camera's HomeKit entry: %s", err)
                self.error = str(err)[:200]
            await self._tell()
            if not self._again:
                return

    async def _apply(self) -> None:
        w, entry = self.wish(), ours(self.hass)
        if w is None:
            return                                        # Mantel publishes no Apple TV camera: leave everything
        want, cam, sensor = w
        if not want:
            if entry is not None:
                _LOGGER.info("Mantel Link: removing the Apple TV camera from HomeKit (Mantel's Remove from HomeKit)")
                await self.hass.config_entries.async_remove(entry.entry_id)
            self.error = None
            return
        if entry is not None:
            self.error = None
            return
        if not cam or not sensor:
            return                                        # not in the registry yet: the next change tries again
        port = _free_port(self.hass)
        _LOGGER.info("Mantel Link: adding %s to HomeKit (port %s, motion sensor %s)", cam, port, sensor)
        result = await self.hass.config_entries.flow.async_init(HOMEKIT, context={"source": SOURCE_IMPORT},
                                                                data=import_data(cam, sensor, port))
        if result.get("type") == "abort":
            raise RuntimeError(f"HomeKit refused the entry ({result.get('reason')})")
        self.error = None

    async def _tell(self) -> None:
        got = status(self.hass)
        if self.error and got["state"] in ("none", "starting"):
            got = {"state": "error", "error": self.error}
        if got == {"state": "none"} and self.wish() is None:
            return            # a Mantel with no Apple TV camera (one from before phase 31) has nothing to hear
        if got == self._told or not self.bridge.link.connected:
            return
        try:
            await self.bridge.link.request("report", {"report": {"homekit": got}})
            self._told = got
        except Exception as err:  # noqa: BLE001 -- an older Mantel refuses the key; nothing else depends on it
            _LOGGER.debug("Mantel Link: Mantel did not take the HomeKit report: %s", err)
