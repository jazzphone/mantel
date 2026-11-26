"""MANTEL'S HOMEKIT BRIDGE ENTRIES: the Apple TV camera (phase 31, docs/phase31/PLAN.md "Who serves the camera"), and
the helpers Live TV's TVs' entries share (homekit_tvs.py).

Home Assistant's own HomeKit Bridge serves Mantel's entities to HomeKit. This module makes, keeps and removes those
HomeKit Bridge entries when Mantel says so, and tells Mantel how each stands, so the owner does everything from Mantel's
Settings. ``Kind`` is one kind of entry; HomeKitLink keeps one entry of a kind:

* **"Mantel Alerts"** (``ALERTS``): notifications on the Apple TVs as a camera's alert. Mantel publishes a camera (its
  picture drawn by Mantel, fetched over the link: entity.py's ``LinkedCamera``) and a motion sensor; the camera's
  ``features.homekit`` ``{want, sensor}`` says whether it is wanted. Accessory mode, the camera with the sensor as its
  linked motion sensor, no audio (the entity settings checked by HomeKit's own ``validate_entity_config``). Reported
  as ``report.homekit``.

Live TV's TVs for Apple's Home app are an entry a TV (homekit_tvs.py); 0.1.16-0.1.17's one bridge of switches,
``TV_BRIDGE_NAME``, is removed there once Mantel publishes the TVs.

Each is made through HomeKit's own import flow (named, the next free port), so Home Assistant lists it as set up in
YAML and nobody edits it by hand. **How it stands** (to Mantel): ``none``, ``starting``, ``unpaired`` with the setup
code and URI (Mantel Settings draws its QR code), ``paired``, or ``error``. Read from the entry's HomeKit driver
(``runtime_data.homekit.driver``): Home Assistant's inside, not a public API, so anything missing reads as
``starting`` and Mantel's Settings points at the code in Home Assistant's notifications instead. Told when it changes,
and looked at again every LOOK_S while it is wanted and not yet as wished.

Mantel publishing nothing of a kind leaves its entry alone (a link that is coming back never unpairs a Home); only a
``want`` of false removes it. Nothing else in Home Assistant is touched: no automation, no script, no other HomeKit
entry.
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
TV_BRIDGE_NAME = "Mantel Live TV"
START_PORT = 21128
LOOK_S = 30


def _validate(config: dict[str, Any]) -> dict[str, Any]:
    from homeassistant.components.homekit.util import validate_entity_config
    return validate_entity_config(config)


def _free_port(hass: HomeAssistant) -> int:
    from homeassistant.components.homekit.util import async_find_next_available_port
    return async_find_next_available_port(hass, START_PORT)


def _filter(entities: list[str]) -> dict[str, list[str]]:
    return {"include_domains": [], "include_entities": list(entities), "include_entity_globs": [],
            "exclude_domains": [], "exclude_entities": [], "exclude_entity_globs": []}


def import_data(camera: str, sensor: str, port: int) -> dict[str, Any]:
    """The Apple TV camera's entry, as its YAML import takes it: one camera in accessory mode, its motion sensor linked."""
    return {"name": BRIDGE_NAME, "port": port, "mode": "accessory", "filter": _filter([camera]),
            "entity_config": _validate({camera: {"linked_motion_sensor": sensor, "support_audio": False}})}


def ours(hass: HomeAssistant, name: str = BRIDGE_NAME) -> Any:
    """The HomeKit Bridge entry this module made under ``name``, or None."""
    for e in hass.config_entries.async_entries(HOMEKIT, include_ignore=False):
        if e.source == SOURCE_IMPORT and (e.data or {}).get("name") == name:
            return e
    return None


def status(hass: HomeAssistant, name: str = BRIDGE_NAME) -> dict[str, Any]:
    """How the entry stands, for Mantel (never logged: the setup code pairs a Home)."""
    return entry_status(ours(hass, name))


def entry_status(e: Any) -> dict[str, Any]:
    """How one HomeKit entry stands (None: there is none)."""
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


class Kind:
    """One of Mantel's HomeKit Bridge entries: its name, the report key, and how Mantel's entities say what is wanted.
    ``wish`` answers None (Mantel publishes nothing of it: leave everything), or (want, what to build it from, or None
    while the registry has not caught up)."""

    name = ""
    report = ""
    what = ""

    def concerns(self, d: dict[str, Any]) -> bool:
        raise NotImplementedError

    def wish(self, bridge: Any) -> tuple[bool, Any] | None:
        raise NotImplementedError

    def data(self, got: Any, port: int) -> dict[str, Any]:
        raise NotImplementedError

    def options(self, entry: Any, got: Any) -> dict[str, Any] | None:
        """The entry's options as wished when they differ from its own, else None (as wished: nothing to do)."""
        return None


class _Alerts(Kind):
    name, report, what = BRIDGE_NAME, "homekit", "the Apple TV camera"

    def concerns(self, d: dict[str, Any]) -> bool:
        return d.get("platform") == "camera" and isinstance((d.get("features") or {}).get("homekit"), dict)

    def wish(self, bridge: Any) -> tuple[bool, Any] | None:
        for uid, d in bridge.descs.items():
            if self.concerns(d):
                hk = d["features"]["homekit"]
                reg = er.async_get(bridge.hass)
                cam = reg.async_get_entity_id("camera", DOMAIN, uid)
                sensor = reg.async_get_entity_id("binary_sensor", DOMAIN, hk.get("sensor")) if isinstance(
                    hk.get("sensor"), str) else None
                return bool(hk.get("want")), ((cam, sensor) if cam and sensor else None)
        return None

    def data(self, got: Any, port: int) -> dict[str, Any]:
        return import_data(got[0], got[1], port)


ALERTS = _Alerts()


class HomeKitLink:
    """Keeps one of Mantel's entries as Mantel wants it, and Mantel told how it stands (one per kind, per Mantel Link
    entry)."""

    def __init__(self, bridge: Any, kind: Kind = ALERTS) -> None:
        self.bridge, self.hass, self.kind = bridge, bridge.hass, kind
        self._task: asyncio.Task | None = None
        self._again = False
        self._told: dict[str, Any] | None = None
        self._unsub: Any = None
        self.error: str | None = None
        self._settled = True                     # the entry is as last wished (nothing left to look at again)

    def start(self) -> None:
        self._unsub = async_track_time_interval(self.hass, self._tick, timedelta(seconds=LOOK_S))

    def stop(self) -> None:
        if self._unsub is not None:
            self._unsub()
            self._unsub = None
        if self._task is not None:
            self._task.cancel()

    def wish(self) -> tuple[bool, Any] | None:
        return self.kind.wish(self.bridge)

    def concerns(self, d: dict[str, Any]) -> bool:
        return self.kind.concerns(d)

    @callback
    def changed(self) -> None:
        """Mantel's entities changed (or the link came back): bring the entry in line, then tell Mantel."""
        if self._task is not None and not self._task.done():
            self._again = True
            return
        self._task = self.hass.async_create_task(self._sync(), f"Mantel Link: HomeKit ({self.kind.name})")

    @callback
    def reconnected(self) -> None:
        """The link came back: Mantel is told again, whatever it was told before."""
        self._told = None
        self.changed()

    @callback
    def _tick(self, _now: Any) -> None:
        w = self.wish()
        if w is not None and w[0] and ((self._told or {}).get("state") != "paired" or not self._settled):
            self.changed()

    async def _sync(self) -> None:
        while True:
            self._again = False
            try:
                await self._apply()
            except Exception as err:  # noqa: BLE001 -- told to Mantel, tried again on the next change
                _LOGGER.warning("Mantel Link: the HomeKit entry for %s: %s", self.kind.what, err)
                self.error = str(err)[:200]
            await self._tell()
            if not self._again:
                return

    async def _apply(self) -> None:
        w, entry = self.wish(), ours(self.hass, self.kind.name)
        if w is None:
            self._settled = True
            return                                        # Mantel publishes nothing of it: leave everything
        want, got = w
        if not want:
            if entry is not None:
                _LOGGER.info("Mantel Link: removing %s from HomeKit (Mantel's Remove from HomeKit)", self.kind.what)
                await self.hass.config_entries.async_remove(entry.entry_id)
            self.error, self._settled = None, True
            return
        if got is None:
            self._settled = False
            return                                        # not in the registry yet: the next change or look tries again
        if entry is not None:
            opts = self.kind.options(entry, got)
            if opts is not None:
                _LOGGER.info("Mantel Link: %s in HomeKit changed; reloading %s", self.kind.what, self.kind.name)
                self.hass.config_entries.async_update_entry(entry, options=opts)
                # an imported HomeKit entry doesn't reload on an options change by itself: the bridge keeps its pairing
                await self.hass.config_entries.async_reload(entry.entry_id)
            self.error, self._settled = None, True
            return
        port = _free_port(self.hass)
        _LOGGER.info("Mantel Link: adding %s to HomeKit as %s (port %s)", self.kind.what, self.kind.name, port)
        result = await self.hass.config_entries.flow.async_init(HOMEKIT, context={"source": SOURCE_IMPORT},
                                                                data=self.kind.data(got, port))
        if result.get("type") == "abort":
            raise RuntimeError(f"HomeKit refused the entry ({result.get('reason')})")
        self.error, self._settled = None, True

    async def _tell(self) -> None:
        got = status(self.hass, self.kind.name)
        if self.error and got["state"] in ("none", "starting"):
            got = {"state": "error", "error": self.error}
        if got == {"state": "none"} and self.wish() is None:
            return            # a Mantel that publishes none of this (one from before it) has nothing to hear
        if got == self._told or not self.bridge.link.connected:
            return
        try:
            await self.bridge.link.request("report", {"report": {self.kind.report: got}})
            self._told = got
        except Exception as err:  # noqa: BLE001 -- an older Mantel refuses the key; nothing else depends on it
            _LOGGER.debug("Mantel Link: Mantel did not take the HomeKit report: %s", err)
