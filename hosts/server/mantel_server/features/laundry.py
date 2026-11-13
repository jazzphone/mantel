"""Laundry: Done, held until someone unloads (phase 22, docs/phase22/LAUNDRY.md; hk_core/laundry.py has the rules).

* WATCHED HERE: ``overlay`` runs ahead of the sessions on every batch of states, as the vacuum's water tank is (vacuum_water.py).
  Each machine -- Accessories -> Laundry's list (settings.features.laundry), else the ones found on the house's devices
  (hk_core.laundry.found, the page's own finding) -- is read to one state; one that was running and now isn't is Done.
* SHARED as Mantel's own ``sensor.laundry_done`` (``hub.store.ours``), its attribute `machines` {machine id: {since, words}}, so
  every screen, the chip, the room's tile and the sheet agree. Nothing is created on the Home Assistant side.
* KEPT in the `laundry_done` table across a restart. A machine that finished while Mantel was down isn't guessed at.
* CLEARED by the Clear key (script.laundry_done_clear {machine}, through the gateway, from any screen: for everyone), by the door
  opening, by the machine running again, or by itself Clear After hours from `since` (features.laundry_clear; 0 is until cleared).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable

from aiohttp import web

from hk_core import laundry as R

log = logging.getLogger("mantel.laundry")

LOOK_EVERY = 5.0        # seconds between looks at the settings and at what has run out its time
LOOK_AGAIN = 60.0       # seconds: at most this often, the whole house again for entities that came or went unlike laundry
ICON = "mdi:washing-machine"


class Store:
    def __init__(self, db: Any) -> None:
        self.db = db

    def load(self) -> dict[str, dict[str, Any]]:
        return {r[0]: {"since": r[1], "words": r[2]} for r in self.db.execute("SELECT machine_id, since, words FROM laundry_done")}

    def save(self, machine: str, since: float, words: str) -> None:
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO laundry_done (machine_id, since, words) VALUES (?,?,?)", (machine, since, words))

    def drop(self, machine: str) -> None:
        with self.db:
            self.db.execute("DELETE FROM laundry_done WHERE machine_id = ?", (machine,))


class LaundryDone:
    def __init__(self, app: web.Application, hub: Any, clock: Callable[[], float]) -> None:
        self.app, self.hub, self.clock = app, hub, clock
        self.store = Store(app["store"].db)
        self.latches = self.store.load()
        self.running: dict[str, bool] = {}          # machine -> it was running at the last look (absent: not looked at yet)
        self.doors: dict[str, bool] = {}            # machine -> its door was open at the last look
        self.saved: list[dict[str, Any]] = []       # the person's list (features.laundry), checked
        self.hours = R.DEFAULT_CLEAR
        self.settings_version = -1
        self.loads: Any = None
        self.machines: list[dict[str, Any]] = []
        self.watched: set[str] = set()              # every entity a machine reads
        self.ids: set[str] = set()                  # the entities there at the last full look, kept as they come and go
        self.keys: set[str] = set()                 # the devices the found machines are on (R.keys_of)
        self.stale = False                          # entities came or went since the last full look, none like laundry
        self.due = False                            # the slow look: the whole house again at the next batch
        self.mapped_at = 0.0
        self.devices: tuple[int, dict[str, Any]] = (-1, {})   # (registry load, device id -> device)
        self.looking: asyncio.Task | None = None

    # -- what the house has ------------------------------------------------------------------------------------------
    def _look_settings(self) -> bool:
        """The saved machines and Clear After; True when they changed."""
        try:
            got = self.app["settings"].store.get("house", "settings")
            version = got.version if got is not None else 0
            if version == self.settings_version:
                return False
            self.settings_version = version
            feats = (dict(got.body).get("features") if got is not None else None) or {}
        except Exception:  # noqa: BLE001 -- no settings yet: as they come
            return False
        try:
            saved = R.machines(feats.get("laundry"))
        except R.Invalid:
            saved = []
        hours = feats.get("laundry_clear", R.DEFAULT_CLEAR)
        hours = hours if isinstance(hours, int) and not isinstance(hours, bool) and hours in R.CLEAR_AFTER else R.DEFAULT_CLEAR
        changed = json.dumps(saved, sort_keys=True) != json.dumps(self.saved, sort_keys=True) or hours != self.hours
        self.saved, self.hours = saved, hours
        return changed

    def _map(self, changed: set[str]) -> bool:
        """The machines again when the registry or the saved list changed, or an entity that may be a machine's came or went;
        True when it looked. Not for every entity that comes: Home Assistant starting adds thousands, a few at a time, and a
        full look (R.found) at each batch held the event loop for minutes (2026-11-13). The rest wait for the slow look."""
        reg, states, ours = self.hub.registry, self.hub.store.states, self.hub.store.ours
        key = (reg.loads, self.settings_version)
        moved = [e for e in changed if (e in states) != (e in self.ids) and e not in ours]
        if self.devices[0] != reg.loads:
            self.devices = (reg.loads, {d.get("id"): d for d in (reg.device_entries or []) if d.get("id")})
        devices = self.devices[1]
        if key == self.loads and not self.due:
            if not moved or self.saved:
                return False
            if not R.may_find(moved, reg.entries, devices, states, self.keys):
                self.ids.update(e for e in moved if e in states)
                self.ids.difference_update(e for e in moved if e not in states)
                self.stale = True
                return False
        self.loads, self.due, self.stale, self.mapped_at, self.ids = key, False, False, self.clock(), set(states)
        if self.saved:
            self.machines = list(self.saved)
        else:
            self.machines = R.found(reg.entries, devices, states)
        self.keys = R.keys_of(self.machines, reg.entries)
        self.watched = {e for m in self.machines for e in (m.get(r) for r in R.ROLES) if e}
        return True

    # -- watching it -------------------------------------------------------------------------------------------------
    def _look(self, m: dict[str, Any], now: float) -> bool:
        """One machine: Done when it was running and isn't; gone when it runs again or its door opens."""
        mid, states = m["id"], self.hub.store.states
        state = R.state_of(m, states)
        runs = R.runs(state)
        before = self.running.get(mid)
        self.running[mid] = runs
        door = R.is_on(states.get(m["door"])) if m.get("door") else False
        opened = door and not self.doors.get(mid, door)
        self.doors[mid] = door
        if mid in self.latches and (runs or opened):
            self.latches.pop(mid)
            self.store.drop(mid)
            log.info("%s: Done cleared (%s)", mid, "running again" if runs else "the door opened")
            return True
        if before is None:
            return False                            # (first look after a start: what was caught stays as it was)
        if R.settled(before, state) and mid not in self.latches:
            self.latches[mid] = {"since": now, "words": "Done"}
            self.store.save(mid, now, "Done")
            log.info("%s: Done (kept until cleared%s)", mid, f" or {self.hours} h" if self.hours else "")
            return True
        return False

    def overlay(self, changed: set[str]) -> set[str]:
        """Ahead of the sessions, on every batch: a finished machine held, the sensor the screens read kept as it should be."""
        states = self.hub.store.states
        try:
            self._look_settings()
        except Exception:  # noqa: BLE001
            log.debug("laundry: the settings' look failed", exc_info=True)
        first = R.SENSOR not in states
        mapped = self._map(changed)
        if not first and not mapped and not (changed & self.watched):
            # (a Clear or an expiry names the sensor itself: published as it is now)
            return self._publish(changed, True) if R.SENSOR in changed else changed
        now, hit = self.clock(), False
        for m in self.machines:
            if first or mapped or any(m.get(r) in changed for r in R.ROLES):
                hit = self._look(m, now) or hit
        return self._publish(changed, hit or first)

    def _publish(self, changed: set[str], dirty: bool) -> set[str]:
        states = self.hub.store.states
        attrs = {"friendly_name": "Laundry done", "icon": ICON, "plumbing": True,
                 "machines": {k: dict(row) for k, row in sorted(self.latches.items())}}
        old = states.get(R.SENSOR)
        if old is not None and not dirty and old.get("a") == attrs:
            return changed
        if old is None:
            self.hub.store.ours.add(R.SENSOR)
        now = self.clock()
        states[R.SENSOR] = {"s": str(len(self.latches)), "a": attrs, "lc": now, "lu": now}
        if "script." + R.CLEAR not in states:
            self.hub.store.ours.add("script." + R.CLEAR)
            states["script." + R.CLEAR] = {"s": "off", "a": {"friendly_name": "Clear the Laundry's Done", "icon": ICON, "plumbing": True},
                                           "lc": now, "lu": now}
            changed = changed | {"script." + R.CLEAR}
        return changed | {R.SENSOR}

    # -- clearing it -------------------------------------------------------------------------------------------------
    def clear(self, machine: Any) -> dict[str, Any]:
        """The Clear key: this machine's Done is gone for every screen."""
        if not isinstance(machine, str) or machine not in self.latches:
            return {"cleared": False, "reason": "not_done"}
        self.latches.pop(machine)
        self.store.drop(machine)
        log.info("%s: Done cleared", machine)
        self.hub.on_change({R.SENSOR})
        return {"cleared": True}

    def expire(self) -> None:
        """A Done Clear After hours old goes by itself."""
        now = self.clock()
        gone = [k for k, row in self.latches.items() if R.expired(row["since"], self.hours, now)]
        for k in gone:
            self.latches.pop(k)
            self.store.drop(k)
            log.info("%s: Done cleared by itself (%d h)", k, self.hours)
        if self.stale and now - self.mapped_at >= LOOK_AGAIN:
            self.due = True
        if gone or self._look_settings() or self.due:
            self.hub.on_change({R.SENSOR})

    def status(self) -> dict[str, Any]:
        return {"clear_after_hours": self.hours, "done": sorted(self.latches), "watching": [m["id"] for m in self.machines]}

    async def close(self) -> None:
        if self.looking is not None:
            self.looking.cancel()


def register(app: web.Application, hub: Any) -> LaundryDone:
    """``app["laundry"]``, and its overlay ahead of the sessions on every batch of states."""
    host = LaundryDone(app, hub, lambda: app["clock"]())
    app["laundry"] = host
    hub.overlays.append(host.overlay)

    async def look() -> None:
        while True:
            await asyncio.sleep(LOOK_EVERY)
            try:
                host.expire()
            except Exception:  # noqa: BLE001 -- the next look
                log.debug("laundry: a look failed", exc_info=True)

    async def start(_app: web.Application) -> None:
        host.looking = asyncio.ensure_future(look())

    async def stop(_app: web.Application) -> None:
        await host.close()
    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return host
