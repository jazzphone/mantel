"""LIVE TV'S TVS IN APPLE'S HOME APP: a HomeKit entry for each (Mantel's cameras/live_tv_buttons.py).

Mantel publishes a TV (a ``media_player``, device class ``tv``, ``features.live_tv_home``) for each paired AirPlay
screen with a Live TV channel checked, and a sensor, "Mantel Live TV", whose ``features.homekit`` ``{bridge:
"live_tv_tv", want, include}`` names the TVs (by unique id) wanted in HomeKit. The Home app shows a TV only as an
accessory of its own, never inside a bridge (Home Assistant warns of one in a bridge), so each TV gets its own HomeKit
entry in accessory mode, "Mantel <TV's name>", made through HomeKit's import flow (named, the next free port), and each
shows its own setup code. An entry is ours when it was imported, is in accessory mode and holds exactly one of Mantel
Link's media players: found by that entity, so renaming a screen keeps its entry and its pairing. A screen whose TV
goes loses its entry; ``want`` false removes them all.

**How each stands** goes to Mantel as ``report.homekit_tvs`` {unique id: {state, code?, uri?, error?}}
(homekit_entry.entry_status), told when it changes and looked at again every LOOK_S while wanted and not yet as wished.

**From the switches** (0.1.16-0.1.17): once Mantel publishes the TVs, the switches' one bridge, "Mantel Live TV"
(homekit_entry.TV_BRIDGE_NAME), is removed, and so are the switches' registry entries Mantel no longer publishes. With a
Mantel from before the TVs, nothing here happens: its switches' bridge is left as it is.

**The Remote** in an iPhone's Control Center: HomeKit sends play/pause to the TV itself (on and off), its volume
buttons to the TV's volume (its speaker's, entity.py), and every other key as ``homekit_tv_remote_key_pressed``: the
arrows are channel up and down here, Back stops the show and Select goes to the TV's home channel (``REMOTE``).

Nothing else in Home Assistant is touched: no automation, no script, no other HomeKit entry.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import SOURCE_IMPORT
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_time_interval

from . import homekit_entry as HE
from .const import DOMAIN
from .homekit_entry import HOMEKIT, LOOK_S, TV_BRIDGE_NAME, _filter, entry_status, ours

_LOGGER = logging.getLogger(__name__)

KIND = "live_tv_tv"                       # the sensor's features.homekit.bridge (hk_core.live_tv_buttons.HOMEKIT_KIND)
REPORT = "homekit_tvs"
OLD_SWITCH = re.compile(r"_live_tv_s[0-9a-f]{12}_\d")     # 0.1.16-0.1.17's switch (and button) unique ids
REMOTE_EVENT = "homekit_tv_remote_key_pressed"
# the Remote's keys (the owner, 2026-11-26): every arrow changes the channel, Back stops the show, Select goes to the
# TV's home channel (its When Turned On channel, or the one watched before: Mantel's home_channel); i does nothing
REMOTE = {"arrow_up": "media_next_track", "arrow_right": "media_next_track", "arrow_down": "media_previous_track",
          "arrow_left": "media_previous_track", "back": "media_stop", "select": "home_channel"}
NAME_MAX = 60


def concerns(d: dict[str, Any]) -> bool:
    """A descriptor that changes what is wished: a TV, or the sensor that carries the wish."""
    feats = d.get("features") or {}
    hk = feats.get("homekit")
    return (d.get("platform") == "media_player" and bool(feats.get("live_tv_home"))) or (
        d.get("platform") == "sensor" and isinstance(hk, dict) and hk.get("bridge") == KIND)


def tv_data(eid: str, name: str, port: int) -> dict[str, Any]:
    """A TV's entry, as its YAML import takes it: that one TV in accessory mode."""
    return {"name": name, "port": port, "mode": "accessory", "filter": _filter([eid]), "entity_config": {}}


def entry_name(hass: HomeAssistant, tv_name: Any) -> str:
    """A free entry name for a TV: "Mantel <its name>", in the letters HomeKit's names take."""
    base = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]+", " ", f"Mantel {tv_name or 'Live TV'}")).strip()[:NAME_MAX]
    taken = {(e.data or {}).get("name") for e in hass.config_entries.async_entries(HOMEKIT, include_ignore=False)}
    got, n = base, 2
    while got in taken:
        got, n = f"{base[:NAME_MAX - 3]} {n}", n + 1
    return got


def _included(e: Any) -> list[str]:
    for where in (e.options or {}, e.data or {}):
        got = (where.get("filter") or {}).get("include_entities")
        if got:
            return list(got)
    return []


def entries(hass: HomeAssistant) -> dict[str, Any]:
    """{TV's entity id: its HomeKit entry} of the entries this module made (module docstring)."""
    reg = er.async_get(hass)
    out = {}
    for e in hass.config_entries.async_entries(HOMEKIT, include_ignore=False):
        mode = (e.options or {}).get("mode") or (e.data or {}).get("mode")
        inc = _included(e)
        if e.source != SOURCE_IMPORT or mode != "accessory" or len(inc) != 1:
            continue
        ent = reg.async_get(inc[0])
        if ent is not None and ent.platform == DOMAIN and ent.domain == "media_player":
            out[inc[0]] = e
    return out


class TvHomeKit:
    """Keeps Live TV's TVs' HomeKit entries as Mantel wants them, and Mantel told how each stands (one per Mantel Link
    entry; the bridge's ``homekit_tv``)."""

    def __init__(self, bridge: Any) -> None:
        self.bridge, self.hass = bridge, bridge.hass
        self._task: asyncio.Task | None = None
        self._again = False
        self._told: dict[str, Any] | None = None
        self._unsubs: list[Any] = []
        self.errors: dict[str, str] = {}
        self._settled = True

    def start(self) -> None:
        self._unsubs = [async_track_time_interval(self.hass, self._tick, timedelta(seconds=LOOK_S)),
                        self.hass.bus.async_listen(REMOTE_EVENT, self._remote)]

    def stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs = []
        if self._task is not None:
            self._task.cancel()

    def concerns(self, d: dict[str, Any]) -> bool:
        return concerns(d)

    def wish(self) -> tuple[bool, dict[str, str | None]] | None:
        """None while Mantel publishes no TVs' sensor (leave everything); else (want, {TV's unique id: its entity id,
        or None while the registry has not caught up})."""
        for d in self.bridge.descs.values():
            hk = (d.get("features") or {}).get("homekit")
            if d.get("platform") == "sensor" and isinstance(hk, dict) and hk.get("bridge") == KIND:
                reg = er.async_get(self.hass)
                uids = [u for u in hk.get("include") or [] if isinstance(u, str)]
                return bool(hk.get("want")), {u: reg.async_get_entity_id("media_player", DOMAIN, u) for u in uids}
        return None

    @callback
    def changed(self) -> None:
        if self._task is not None and not self._task.done():
            self._again = True
            return
        self._task = self.hass.async_create_task(self._sync(), "Mantel Link: HomeKit (Live TV's TVs)")

    @callback
    def reconnected(self) -> None:
        self._told = None
        self.changed()

    @callback
    def _tick(self, _now: Any) -> None:
        w = self.wish()
        if w is not None and w[0] and (not self._settled or any(
                v.get("state") != "paired" for v in (self._told or {}).values()) or not self._told):
            self.changed()

    async def _sync(self) -> None:
        while True:
            self._again = False
            try:
                await self._apply()
            except Exception as err:  # noqa: BLE001 -- told to Mantel, tried again on the next change
                _LOGGER.warning("Mantel Link: Live TV's HomeKit entries: %s", err)
            await self._tell()
            if not self._again:
                return

    async def _apply(self) -> None:
        w = self.wish()
        if w is None:
            self._settled = True
            return                                         # a Mantel from before the TVs: leave everything
        await self._drop_switches()
        want, tvs = w
        have = entries(self.hass)
        wanted = {eid for eid in tvs.values() if eid} if want else set()
        for eid, e in have.items():
            if eid not in wanted:
                _LOGGER.info("Mantel Link: removing %s from HomeKit (%s)", eid,
                             "Mantel's Remove from Home App" if not want else "its screen has no Live TV now")
                await self.hass.config_entries.async_remove(e.entry_id)
        self._settled = not want or all(tvs.values())
        if not want:
            self.errors = {}
            return
        for uid, eid in tvs.items():
            if not eid or eid in have:
                continue
            port = HE._free_port(self.hass)
            name = entry_name(self.hass, (self.bridge.descs.get(uid) or {}).get("name"))
            _LOGGER.info("Mantel Link: adding %s to HomeKit as %s (port %s)", eid, name, port)
            try:
                result = await self.hass.config_entries.flow.async_init(
                    HOMEKIT, context={"source": SOURCE_IMPORT}, data=tv_data(eid, name, port))
                if result.get("type") == "abort":
                    raise RuntimeError(f"HomeKit refused the entry ({result.get('reason')})")
                self.errors.pop(uid, None)
            except Exception as err:  # noqa: BLE001 -- this TV's error, the others go on
                _LOGGER.warning("Mantel Link: the HomeKit entry for %s: %s", eid, err)
                self.errors[uid] = str(err)[:200]

    async def _drop_switches(self) -> None:
        """Mantel publishes the TVs: 0.1.16-0.1.17's switches' bridge and their registry entries go (module docstring)."""
        old = ours(self.hass, TV_BRIDGE_NAME)
        if old is not None and ((old.options or {}).get("mode") or (old.data or {}).get("mode")) == "bridge":
            _LOGGER.info("Mantel Link: Live TV is a TV a screen now; removing the switches' bridge, %s", TV_BRIDGE_NAME)
            await self.hass.config_entries.async_remove(old.entry_id)
        reg = er.async_get(self.hass)
        for ent in er.async_entries_for_config_entry(reg, self.bridge.entry.entry_id):
            if (ent.domain in ("switch", "button") and ent.platform == DOMAIN and OLD_SWITCH.search(ent.unique_id)
                    and ent.unique_id not in self.bridge.descs):
                _LOGGER.info("Mantel Link: %s is part of a Live TV now; the switch goes", ent.entity_id)
                reg.async_remove(ent.entity_id)

    def status(self) -> dict[str, dict[str, Any]]:
        """{TV's unique id: how its entry stands} for each TV Mantel names."""
        w = self.wish()
        if w is None:
            return {}
        want, tvs = w
        have = entries(self.hass)
        out = {}
        for uid, eid in tvs.items():
            got = entry_status(have.get(eid)) if eid else {"state": "none"}
            if want and got["state"] == "none":
                got = {"state": "error", "error": self.errors[uid]} if uid in self.errors else {"state": "starting"}
            out[uid] = got
        return out

    async def _tell(self) -> None:
        got = self.status()
        if not got and self.wish() is None:
            return            # a Mantel that publishes no TVs has nothing to hear
        if got == self._told or not self.bridge.link.connected:
            return
        try:
            await self.bridge.link.request("report", {"report": {REPORT: got}})
            self._told = got
        except Exception as err:  # noqa: BLE001 -- an older Mantel refuses the key; nothing else depends on it
            _LOGGER.debug("Mantel Link: Mantel did not take Live TV's HomeKit report: %s", err)

    @callback
    def _remote(self, event: Event) -> None:
        """A key on the Remote in Control Center for one of these TVs (``REMOTE``)."""
        command = REMOTE.get(event.data.get("key_name"))
        eid = event.data.get("entity_id")
        if command is None:
            return
        ent = next((e for e in self.bridge.entities.values()
                    if getattr(e, "linked_platform", "") == "media_player" and e.entity_id == eid), None)
        if ent is not None:
            self.hass.async_create_task(self._key(ent, command), f"Mantel Link: {eid} {command}")

    async def _key(self, ent: Any, command: str) -> None:
        try:
            await ent._send(command)
        except Exception as err:  # noqa: BLE001 -- a key press has no one to answer
            _LOGGER.warning("Mantel Link: %s on %s: %s", command, ent.entity_id, err)
