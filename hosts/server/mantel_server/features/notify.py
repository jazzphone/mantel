"""Notifications on Mantel: ``Notifier`` follows the hub's changes, asks ``banner.goes_off`` what each sets off and
sends the payload to the screens' feed (Mute 1 Hour, snapshots, the Wake the Screen call).

DIRECT CAMERA EVENTS (2026-11-02, docs/phase13/CAMERAS-DIRECT.md phase 4, protect_connector.py): ``direct`` is the
UniFi Protect connector where Mantel reaches the console itself. Its events reach this one engine two ways, so the
rules (Goes Off When, the Doorbells pop-up, Not Again For, Mute 1 Hour) are the ones Home Assistant's entities have:

* a camera Home Assistant does not have: Mantel's own detection sensors (``binary_sensor.mantel_<slug>_*``,
  ``event.mantel_<slug>_doorbell``) change in the hub like any entity, and come in through ``on_change``;
* a camera Home Assistant has too: ``inject`` sets off what Home Assistant's own entity of that kind would, keyed to
  HA's entity id, and ``direct.takes(eid)`` holds back HA's own change of it while the direct source is preferred
  (Video From Direct and the events socket up), so one ring is one notification, never two. ``takes`` also holds
  back a kind the camera's Notify For leaves out, whichever source it came from."""
from __future__ import annotations

from collections import deque
import time
from typing import Any, Mapping, TYPE_CHECKING

from hk_core.house import State
from hk_core.notifications import accessories as NA, banner as NB, dnd as ND

from .settings import LOG_KEEP, MUTES_DOC

if TYPE_CHECKING:
    from .host import FeatureHost


# ------------------------------------------------------------------------------- notifications
class Notifier:
    """Notifications on Mantel: the hub's changes -> ``banner.goes_off`` -> the screens' feed."""

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host
        self.opts: dict[str, Any] = NB.options({})
        self.items: list[dict[str, Any]] = []
        self.watched: dict[str, list[str]] = {}
        self.cache: dict[str, State | None] = {}
        self.last: dict[str, float] = {}
        self.mutes: dict[str, float] = {}
        self.sent: deque = deque(maxlen=LOG_KEEP)
        self.known: set[str] = set()
        self.direct: Any = None             # protect_connector.ProtectConnector: takes(eid) -> bool

    def configure(self, cfg: Mapping[str, Any]) -> None:
        self.opts = NB.options({**dict(cfg.get("options") or {}), "items": list(cfg.get("items") or [])})
        self.items = list(self.opts["items"])
        self.mutes = {k: float(v) for k, v in (self.host.doc(MUTES_DOC).get("mutes") or {}).items()
                      if isinstance(v, (int, float))}
        self.refresh()

    def refresh(self) -> None:
        h = self.host.house
        self.watched = {str(it["id"]): list(NA.members(h, it)) for it in self.items if it.get("id")}
        ids = set().union(*self.watched.values()) if self.watched else set()
        self.cache = {eid: h.state(eid) for eid in ids}
        # what the categories were worked out from: a state for anything else (the first states after a start
        # or a reconnect, which come after the registries; a new device) works them out again (on_change)
        self.known = set(self.host.hub.store.states)

    def on_change(self, changed: set[str]) -> None:
        if not self.host.on("notifications"):
            return
        h = self.host.house
        states = self.host.hub.store.states
        if any(eid in states and eid not in self.known for eid in changed):
            # A category's members depend on states (a door sensor is a door by its device_class), and Mantel
            # reads the registries before the first states: worked out then, Doors, Leaks and Smoke stayed
            # empty after every restart. A state just seen is a first state, not a change: nothing fires; one
            # already watched keeps its old state, so its change in the same batch still does.
            before = self.cache
            self.refresh()
            for eid, st in before.items():
                if eid in self.cache:
                    self.cache[eid] = st
        for eid in sorted(changed & set(self.cache)):
            old, new = self.cache.get(eid), h.state(eid)
            self.cache[eid] = new
            if self.direct is not None and self.direct.takes(eid):
                continue                    # the direct source speaks for it (inject), or Notify For leaves it out
            fired = NB.goes_off(h, self.items, self.watched, eid, old, new, last=self.last, mute=self.mutes,
                                now=self.host.monotonic(), epoch=self.host.epoch())
            for item in fired:
                self.deliver(item, new, eid)

    def inject(self, eid: str, old: State | None, new: State | None) -> list[dict[str, Any]]:
        """A direct camera's event as the change of Home Assistant's entity ``eid`` it stands for (the module
        docstring): the same rules decide; the hub's own copy of ``eid`` is not touched."""
        if not self.host.on("notifications") or eid not in self.cache:
            return []
        h = self.host.house
        fired = NB.goes_off(h, self.items, self.watched, eid, old, new, last=self.last, mute=self.mutes,
                            now=self.host.monotonic(), epoch=self.host.epoch())
        return [self.deliver(item, new, eid) for item in fired]

    def deliver(self, item: dict[str, Any], new: State | None, eid: str) -> dict[str, Any]:
        payload = NB.build(self.host.house, self.opts, item, new, eid=eid)
        if payload.get("camera") and self.host.can_snap():
            self.host.spawn(self.send(payload, item.get("id"), eid))     # the snapshot first, as HA's
        else:
            self._out(payload, item.get("id"), eid)
        return payload

    async def send(self, payload: dict[str, Any], item_id: Any, eid: Any) -> dict[str, Any]:
        """One notification out the one way (HA's async_deliver): the camera's snapshot taken first
        (notify_snaps.py; its id is the payload's ``snap``), then the screens' feed, then the wake."""
        if payload.get("camera") and payload.get("snap") is None and self.host.can_snap():
            payload["snap"] = await self.host.take_snapshot(str(payload["camera"]))
        self._out(payload, item_id, eid)
        return payload

    def _out(self, payload: dict[str, Any], item_id: Any, eid: Any) -> None:
        h = self.host.house
        screens = self.host.feed.send(payload)
        woke = []
        if payload["wake"]:
            secs, now = NB.wake_for(int(payload["stay"])), self.host.now()
            for tid, eng in list(self.host.engines.items()):
                board = self.host.boards.get(tid) or {}
                # each screen's own Do Not Disturb, else All Screens' (HA's wake_screens: notify_dnd or dnd)
                if not board.get("notify", True) or (
                        not payload["important"] and ND.dnd_on(h, board.get("notify_dnd") or self.opts.get("dnd"), now)):
                    continue
                eng.notify_wake(payload["title"], secs)
                woke.append(tid)
        self.sent.append({"at": time.time(), "item": item_id, "entity": eid, "title": payload["title"],
                          "message": payload["message"], "screens": screens, "woke": woke,
                          "snap": payload.get("snap")})
        self.host.to_phones(payload)

    def set_mute(self, key: str, seconds: int, actor: Any = None) -> float | None:
        until = NB.set_mute(self.mutes, key, seconds, self.host.epoch())
        NB.mutes(self.mutes, self.host.epoch())
        self.host.write_doc(MUTES_DOC, {"mutes": dict(self.mutes)}, actor, "notify_mute")
        return until
