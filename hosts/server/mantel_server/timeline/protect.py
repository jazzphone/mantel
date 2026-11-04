"""UniFi Protect's events in the House Timeline (docs/phase19/HOUSE-TIMELINE.md "The write path" 8).

The connector calls ``ProtectConnector.listeners`` with every event of a picked camera, before it decides what
notifies (Notify For), because what is recorded isn't what is notified. A ring is one row; a smart detection
(person, vehicle, animal, package) is one row from its start to its end (Protect's ``end`` updates it; one that never
ends lapses after ACTIVE_MAX_S); packages on one camera within PACKAGE_MERGE are one row; motion is recorded only for a
camera with no smart detection (``Camera.motion_only``), one row per MOTION_WINDOW. The row's ``src`` is
``pt:<event id>:<kind>``, so a reconnect that sends an event again never doubles it.

``ProtectConnector.speaks_for`` tells the state path which of Home Assistant's own detection entities these events
stand for, and Mantel's own detection entities (``LocalEntities.mine``) are never members: one detection, one row.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from hk_core.timeline import classify as C
from hk_core.timeline import words as W

from .core import ACTIVE_MAX_S, MOTION_WINDOW, PACKAGE_MERGE, Timeline
from .store import Row

log = logging.getLogger("mantel.timeline")

FAMILY = {"ring": "doorbell", "person": "detection", "vehicle": "detection", "animal": "detection",
          "package": "detection", "motion": "motion"}


class ProtectTap:
    def __init__(self, tl: Timeline, conn: Any) -> None:
        self.tl, self.conn = tl, conn
        self.open: dict[tuple[str, str], tuple[str, float]] = {}      # (event id, kind) -> (src, monotonic start)
        self.events = 0

    def camera_of(self, pid: str) -> tuple[str, str, str | None] | None:
        """(camera entity, label, area) of a picked Protect camera: Home Assistant's entity when matched."""
        src = self.conn.picked().get(pid)
        if src is None:
            return None
        m = self.conn.matches.get(pid) if src.slug in self.conn.cams.matched else None
        camera = m.camera if m is not None else src.entity_id
        label = src.name
        st = self.tl.hub.store.states.get(camera) if m is not None else None
        if st is not None:
            label = (st.get("a") or {}).get("friendly_name") or label
        area = src.area_id
        if m is not None:
            area = (getattr(self.tl.hub.registry, "entity_area", {}) or {}).get(camera) or area
        return camera, str(label), area

    def on_event(self, ev: Any) -> None:
        family = FAMILY.get(ev.kind)
        if family is None or not self.tl.on(family):
            return
        cam = self.conn.cameras.get(ev.camera_id)
        if family == "motion" and (cam is None or not cam.motion_only):
            return                                   # a camera with smart detection: its detections are the record
        where = self.camera_of(ev.camera_id)
        if where is None:
            return
        camera, label, area = where
        self.events += 1
        at = float(ev.start) / 1000.0
        key = (ev.event_id, ev.kind)
        tl = self.tl
        if not ev.active and ev.end is not None:
            got = self.open.pop(key, None)
            if got is not None:
                tl.update(got[0], {"ended": float(ev.end) / 1000.0})
            if family == "motion" and camera in tl.motion:
                tl.update(tl.motion[camera][0], {"ended": float(ev.end) / 1000.0})
            return
        if key in self.open:
            return                                   # the same event again (a later message of one detection)
        detection = ev.kind if family == "detection" else None
        m = C.Member(family=family, label=label, area=area, camera=camera, detection=detection)
        src = f"pt:{ev.event_id}:{ev.kind}"
        if family == "motion":
            burst = tl.motion.get(camera)
            if burst is not None and at - burst[1] < MOTION_WINDOW:
                bsrc, start, n = burst
                tl.motion[camera] = (bsrc, start, n + 1)
                tl.update(bsrc, {"ended": at, "detail": {"count": n + 1}})
                return
            tl.motion[camera] = (src, at, 1)
            tl.push(self._row(src, m, "motion", at, {"count": 1}), noise=True)
            return
        if ev.kind == "package":
            got = tl.package.get(camera)
            if got is not None and at - got[1] < PACKAGE_MERGE:
                psrc, _first, n = got
                tl.package[camera] = (psrc, at, n + 1)
                tl.update(psrc, {"detail": {"count": n + 1, "last": at}})
                return
            tl.package[camera] = (src, at, 1)
        kind = "ring" if family == "doorbell" else ev.kind
        row = self._row(src, m, kind, at, {})
        if family == "detection":
            self.open[key] = (src, time.monotonic())
            self._lapse()
        tl.push(row)
        pics = tl.app.get("timeline_pictures") if hasattr(tl.app, "get") else None
        if pics is not None:
            pics.want(src, camera, family, active=family == "detection")

    def _row(self, src: str, m: C.Member, kind: str, at: float, detail: dict) -> Row:
        area_name = getattr(self.tl.hub.registry, "areas", {}).get(m.area) if m.area else None
        title = W.title(m.family, kind, m.label, detail)
        return Row(src=src, at=at, family=m.family, kind=kind, level=C.level(m.family, kind), entity=m.camera,
                   area=m.area, title=title, search=W.search_words(m.family, kind, m.label, area_name, title),
                   detail={**detail, "source": "protect"})

    def _lapse(self) -> None:
        now = time.monotonic()
        for key in [k for k, (_s, t) in self.open.items() if now - t > ACTIVE_MAX_S]:
            del self.open[key]

    def is_open(self, src: str) -> bool:
        return any(s == src for s, _t in self.open.values())


def register(app: Any, tl: Timeline) -> ProtectTap | None:
    conn = app.get("protect")
    if conn is None or not hasattr(conn, "listeners"):
        return None
    tap = ProtectTap(tl, conn)
    app["timeline_protect"] = tap
    conn.listeners.append(tap.on_event)
    tl.speaks_for = conn.speaks_for
    tl.mine = lambda: list(getattr(conn.local, "mine", {}) or ())
    return tap
