"""A vacuum's water tank that ran dry, held for the card (2026-11-09, the owner; hk_core/vacuum_water.py has the story).

* CAUGHT HERE: ``overlay`` runs ahead of the sessions on every batch of states, like the timers' (timers.py). A vacuum's own
  state or attributes, or the error sensor on its device, going to a water-tank report latches that vacuum: {since, words}. The
  report lasts under a second, so a screen that is asleep would never see it; this server is always connected.
* SHARED THE WAY THE TIMERS ARE: ``sensor.vacuum_water_tanks`` is Mantel's own state (``hub.store.ours``), its attribute `tanks`
  {vacuum: {since, words}}, so all five kiosks, the phones and the Vacuums page agree with nothing new to subscribe to. Nothing is
  created on the Home Assistant side.
* KEPT in the `vacuum_water` table across a restart. A new report refreshes `since`; one report that stays does not.
* CLEARED by the Clear key (script.vacuum_water_clear {vacuum}, through the gateway, from any screen: it clears for everyone), or
  by itself Clear After hours from `since` (Until Cleared: never). Water Tank Reminder off: nothing is latched, what was is dropped.
  Both are Settings -> Pages -> Vacuums (settings.headers.vacuums.water_tank / water_clear).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from aiohttp import web

from hk_core import vacuum_water as R

log = logging.getLogger("mantel.vacuum_water")

LOOK_EVERY = 5.0        # seconds between looks at the settings and at what has run out its time
ICON = "mdi:water-off"


class Store:
    def __init__(self, db: Any) -> None:
        self.db = db

    def load(self) -> dict[str, dict[str, Any]]:
        return {r[0]: {"since": r[1], "words": r[2]} for r in self.db.execute("SELECT vacuum_id, since, words FROM vacuum_water")}

    def save(self, vacuum: str, since: float, words: str) -> None:
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO vacuum_water (vacuum_id, since, words) VALUES (?,?,?)", (vacuum, since, words))

    def drop(self, vacuum: str) -> None:
        with self.db:
            self.db.execute("DELETE FROM vacuum_water WHERE vacuum_id = ?", (vacuum,))


class VacuumWater:
    def __init__(self, app: web.Application, hub: Any, clock: Callable[[], float]) -> None:
        self.app, self.hub, self.clock = app, hub, clock
        self.store = Store(app["store"].db)
        self.latches = self.store.load()
        self.seen: dict[str, str | None] = {}       # source -> the water words it last said (None: it said something else)
        self.on, self.hours = True, R.DEFAULTS["water_clear"]
        self.settings_version = -1
        self.loads = -1                             # the registry load the maps below were made from
        self.vacuums: dict[str, list[str]] = {}     # vacuum -> the sensors on its device that carry its errors
        self.watched: dict[str, str] = {}           # sensor -> its vacuum
        self.sweep = False                          # the reminder was turned back on: look at every vacuum again
        self.looking: asyncio.Task | None = None

    # -- what the house has ------------------------------------------------------------------------------------------
    def _map(self, changed: set[str]) -> None:
        reg = self.hub.registry
        if reg.loads == self.loads and self.vacuums and all(v in self.vacuums for v in changed if v.startswith("vacuum.")):
            return
        self.loads = reg.loads
        states = self.hub.store.states
        vacs = {k: (reg.entries.get(k) or {}).get("device_id") for k in states if k.startswith("vacuum.")}
        self.vacuums = {v: R.error_sensor_of(v, dev, reg.entries, states) for v, dev in vacs.items()}
        self.watched = {s: v for v, sensors in self.vacuums.items() for s in sensors}

    def _look_settings(self) -> bool:
        """Water Tank Reminder and Clear After as saved; True when they changed."""
        try:
            got = self.app["settings"].store.get("house", "settings")
            version = got.version if got is not None else 0
            if version == self.settings_version:
                return False
            self.settings_version = version
            on, hours = R.settings((dict(got.body).get("headers") if got is not None else None))
        except Exception:  # noqa: BLE001 -- no settings yet: as they come
            return False
        changed = (on, hours) != (self.on, self.hours)
        if on and not self.on:
            self.seen.clear()
            self.sweep = True
        self.on, self.hours = on, hours
        return changed

    # -- catching it -------------------------------------------------------------------------------------------------
    def _said(self, vacuum: str) -> dict[str, str | None]:
        """What each source of this vacuum says now: its own state and attributes, and its error sensors."""
        states = self.hub.store.states
        out: dict[str, str | None] = {vacuum: R.own_words(states.get(vacuum))}
        for s in self.vacuums.get(vacuum, ()):
            st = states.get(s)
            out[s] = R.water_words(st.get("s")) if st else None
        return out

    def _catch(self, vacuum: str, now: float) -> bool:
        states, hit = self.hub.store.states, False
        for source, words in self._said(vacuum).items():
            before = self.seen.get(source, "-")
            self.seen[source] = words
            if not words or before == words:
                continue                              # nothing, or the same report still standing
            if before == "-" and vacuum in self.latches:
                continue                              # (first look after a restart: what was caught stays as it was)
            lc = (states.get(source) or {}).get("lc")
            since = min(now, float(lc)) if before == "-" and isinstance(lc, (int, float)) else now
            self.latches[vacuum] = {"since": since, "words": words}
            self.store.save(vacuum, since, words)
            log.info("%s: %s (kept until cleared%s)", vacuum, words, f" or {self.hours} h" if self.hours else "")
            hit = True
        return hit

    def overlay(self, changed: set[str]) -> set[str]:
        """Ahead of the sessions, on every batch: a water report latched, the sensor the screens read kept as it should be."""
        states = self.hub.store.states
        try:
            self._look_settings()
        except Exception:  # noqa: BLE001
            log.debug("vacuum water: the settings' look failed", exc_info=True)
        if not self.on:
            return self._publish(changed, self._drop_all())
        first = R.SENSOR not in states or self.sweep
        self.sweep = False
        if not first and not any(e.startswith(("vacuum.", "sensor.")) for e in changed):
            return changed
        self._map(changed)
        hit = False
        for v in self.vacuums:
            if first or v in changed or any(s in changed for s in self.vacuums[v]):
                hit = self._catch(v, self.clock()) or hit
        return self._publish(changed, hit or first)

    def _drop_all(self) -> bool:
        gone = bool(self.latches)
        for v in list(self.latches):
            self.store.drop(v)
        self.latches.clear()
        return gone

    def _publish(self, changed: set[str], dirty: bool) -> set[str]:
        states = self.hub.store.states
        attrs = {"friendly_name": "Vacuum water tanks", "icon": ICON, "plumbing": True,
                 "tanks": {v: dict(row) for v, row in sorted(self.latches.items())}}
        old = states.get(R.SENSOR)
        if old is not None and not dirty and old.get("a") == attrs:
            return changed
        if old is None:
            self.hub.store.ours.add(R.SENSOR)
        now = self.clock()
        states[R.SENSOR] = {"s": str(len(self.latches)), "a": attrs, "lc": now, "lu": now}
        if "script." + R.CLEAR not in states:
            self.hub.store.ours.add("script." + R.CLEAR)
            states["script." + R.CLEAR] = {"s": "off", "a": {"friendly_name": "Clear a Vacuum's Water Tank", "icon": ICON, "plumbing": True},
                                           "lc": now, "lu": now}
            changed = changed | {"script." + R.CLEAR}
        return changed | {R.SENSOR}

    # -- clearing it -------------------------------------------------------------------------------------------------
    def clear(self, vacuum: Any) -> dict[str, Any]:
        """The Clear key: this vacuum's latch is gone for every screen."""
        if not isinstance(vacuum, str) or vacuum not in self.latches:
            return {"cleared": False, "reason": "not_latched"}
        self.latches.pop(vacuum)
        self.store.drop(vacuum)
        log.info("%s: water tank cleared", vacuum)
        self.hub.on_change({R.SENSOR})
        return {"cleared": True}

    def expire(self) -> None:
        """A latch Clear After hours old goes by itself."""
        now = self.clock()
        gone = [v for v, row in self.latches.items() if R.expired(row["since"], self.hours, now)]
        for v in gone:
            self.latches.pop(v)
            self.store.drop(v)
            log.info("%s: water tank cleared by itself (%d h)", v, self.hours)
        if gone or self._look_settings():
            self.hub.on_change({R.SENSOR})

    def status(self) -> dict[str, Any]:
        return {"on": self.on, "clear_after_hours": self.hours, "latched": sorted(self.latches), "watching": sorted(self.vacuums)}

    async def close(self) -> None:
        if self.looking is not None:
            self.looking.cancel()


def register(app: web.Application, hub: Any) -> VacuumWater:
    """``app["vacuum_water"]``, and its overlay ahead of the sessions on every batch of states."""
    host = VacuumWater(app, hub, lambda: app["clock"]())
    app["vacuum_water"] = host
    hub.overlays.append(host.overlay)

    async def look() -> None:
        while True:
            await asyncio.sleep(LOOK_EVERY)
            try:
                host.expire()
            except Exception:  # noqa: BLE001 -- the next look
                log.debug("vacuum water: a look failed", exc_info=True)

    async def start(_app: web.Application) -> None:
        host.looking = asyncio.ensure_future(look())

    async def stop(_app: web.Application) -> None:
        await host.close()
    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return host
