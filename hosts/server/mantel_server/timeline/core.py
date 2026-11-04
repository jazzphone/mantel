"""The House Timeline's write path (docs/phase19/HOUSE-TIMELINE.md "The write path").

THE RULE: nothing on the hub's hot path waits for the disk.

* **The tap** (``tap``, in ``Hub.taps``): one set intersection per batch of changed entity ids against the catalog's
  members. Only a member does more: its new state is compared with the one last recorded for it (attribute-only
  changes, ``unavailable`` and ``unknown`` are no rows), ``classify.change`` names the kind, and a ``Row`` goes to the
  queue.
* **The queue and the writer**: a bounded deque (QUEUE_MAX); one task flushes every FLUSH_S or at FLUSH_AT rows, in one
  transaction (``store.Rows.write``: INSERT OR IGNORE on ``src``, so a reconnect never doubles a row). A full queue
  drops the oldest noise (motion bursts) first, then the oldest row, and counts it.
* **Rollups**: a detection is one row from start to end (the end updates it); motion on a motion-only camera is one
  row per camera per MOTION_WINDOW with a count; a sensor that changes more than FLAP_MAX times in FLAP_WINDOW becomes
  one "keeps changing" row until it is quiet for FLAP_QUIET; package detections on one camera within PACKAGE_MERGE are
  one row.
* **Catching up**: what each member last was (its newest row, and the states saved at the last stop and every hour) is
  read at start; a member whose state differs when the first states arrive gets its row at Home Assistant's own
  ``lc``, marked ``late`` when it is older than LATE_S ("while Mantel was off").
* **Who did it**: the audit's ``commands`` listener keeps the last CLAIM_KEEP seconds of commands by entity; a lock,
  garage, alarm or valve row claims the newest that matches (same entity, the same kind of service, CLAIM_BEFORE
  seconds before the change at most). No match: "by hand or an automation". A refused command for one of those is a
  **Refused** row.
* **System rows**: the alert center's listeners (each raise and clear it sends).
* **Pictures and Protect's events** are pictures.py's and protect.py's; they queue rows here.

Logs carry counts, family names and entity ids only: never a title, a person's name or a search word.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable, Iterable

from hk_core.notifications import accessories as NA
from hk_core.timeline import classify as C
from hk_core.timeline import words as W

from .. import performance
from .store import Row, Rows, Settings

log = logging.getLogger("mantel.timeline")

QUEUE_MAX = 5000
FLUSH_S = 2.0
FLUSH_AT = 50
LATE_S = 60.0
MOTION_WINDOW = 600.0
FLAP_WINDOW = 300.0
FLAP_MAX = 6
FLAP_QUIET = 600.0
PACKAGE_MERGE = 1800.0
ACTIVE_MAX_S = 120.0
CLAIM_KEEP = 60.0
CLAIM_BEFORE = 30.0
CLAIM_AFTER = 5.0                 # Home Assistant's clock and Mantel's may differ by a moment
PRUNE_EVERY = 3600.0
GONE = ("unavailable", "unknown", "", None)
DOMAINS = ("binary_sensor", "event", "lock", "valve", "cover", "alarm_control_panel", "person")
PRIVATE_KEY = "timeline_private"           # user_data: Keep My Arrivals Private (Me)
FOLDER = "timeline"

# a service's verb, for the who-did-it match and a Refused row's words
VERBS = {
    "lock.unlock": "unlock", "lock.open": "unlock", "lock.lock": "lock",
    "cover.open_cover": "open", "cover.close_cover": "close", "cover.toggle": "toggle",
    "valve.open_valve": "open", "valve.close_valve": "close", "valve.toggle": "toggle",
    "alarm_control_panel.alarm_disarm": "disarm", "alarm_control_panel.alarm_trigger": "trigger",
}
KIND_VERBS = {"unlocked": ("unlock",), "locked": ("lock",), "opened": ("open", "toggle"),
              "closed": ("close", "toggle"), "disarmed": ("disarm",), "triggered": ("trigger",)}
ATTRIBUTED = ("lock", "garage", "alarm")


def verb_of(action: str | None) -> str | None:
    if not action:
        return None
    if action.startswith("alarm_control_panel.alarm_arm_"):
        return "arm"
    return VERBS.get(action)


def matches(kind: str, verb: str) -> bool:
    if kind.startswith("armed_"):
        return verb == "arm"
    return verb in KIND_VERBS.get(kind, ())


def how_of(row: dict) -> str:
    via = row.get("via") or ""
    if via.startswith("mcp"):
        return "assistant"
    if row.get("device"):
        return "tablet"
    door = row.get("door")
    return {"lan": "home", "tunnel": "away", "ha": "ha_sidebar"}.get(door or "", "home")


class Timeline:
    """``app["timeline"]``: see the module docstring."""

    def __init__(self, app: Any, hub: Any, db, *, clock: Callable[[], float] | None = None,
                 folder: Path | None = None) -> None:
        self.app, self.hub, self.db = app, hub, db
        self.clock = clock or time.time
        self.rows = Rows(db)
        self.settings = Settings(db, self.clock)
        self.folder = folder
        self.members: dict[str, C.Member] = {}
        self.known: set[str] = set()
        self.person_user: dict[str, str] = {}          # person entity -> Mantel users.id
        self.last: dict[str, tuple[str | None, float]] = {}
        self.queue: deque = deque()
        self.dropped = 0
        self.written = 0
        self.wake: asyncio.Event | None = None
        self.listeners: list[Callable[[list[dict]], None]] = []     # rows written or updated (the live feed)
        self.after_write: list[Callable[[list[dict]], None]] = []   # pictures.py: rows that want pictures
        self.speaks_for: Callable[[str], bool] = lambda eid: False  # protect.py: a direct source speaks for it
        self.mine: Callable[[], Iterable[str]] = lambda: ()          # Mantel's own detection entities
        self.house = None
        # rollups
        self.active: dict[str, tuple[str, float]] = {}       # an open detection: entity/event -> (src, opened at)
        self.motion: dict[str, tuple[str, float, int]] = {}   # camera -> (src, burst start, count)
        self.package: dict[str, tuple[str, float, int]] = {}  # camera -> (src, at, count)
        self.flaps: dict[str, deque] = {}
        self.flapping: dict[str, tuple[str, float, int]] = {}  # entity -> (src, last change, count)
        self.commands: dict[str, deque] = {}                  # entity -> recent allowed command rows
        self.tasks: list[asyncio.Task] = []
        self.last_prune = 0.0
        self._loaded = False

    # -- what is recorded ------------------------------------------------------------------------------------------
    def _house(self):
        if self.house is None:
            from ..house import MantelHouse
            direct = self.app.get("cameras_direct") if hasattr(self.app, "get") else None
            links = (lambda: direct.sensor_links()) if direct is not None and hasattr(direct, "sensor_links") else None
            self.house = MantelHouse(self.hub.store, self.hub.registry, links=links)
        return self.house

    def refresh(self) -> None:
        """The catalog's members, worked out again (a registry reload, a state for an entity not seen before, a
        change of the Owner's overrides)."""
        states = self.hub.store.states
        reg = self.hub.registry
        entries = getattr(reg, "entries", {}) or {}
        area_of = getattr(reg, "entity_area", {}) or {}
        house = self._house()
        overrides = self.settings.get("overrides") or {}
        families = self.settings.get("families") or {}
        mine = set(self.mine())
        found: dict[str, tuple] = {}
        smart: set[str] = set()
        motions: list[tuple] = []
        for eid in set(states) | set(entries) | set(overrides):
            domain, _, oid = eid.partition(".")
            if domain not in DOMAINS and eid not in overrides:
                continue
            e = entries.get(eid) or {}
            st = states.get(eid) or {}
            attrs = st.get("a") or {}
            dc = e.get("device_class") or e.get("original_device_class") or attrs.get("device_class")
            fam = C.family_of(domain, oid, dc)
            if fam is not None and fam[0] == "detection":
                cam = NA.camera_for(house, eid)
                if cam:
                    smart.add(cam)
            if fam is None and domain == "binary_sensor" and (dc or "").lower() in ("motion", "moving"):
                motions.append((eid, e, dc))
                continue
            found[eid] = (e, dc)
        members: dict[str, C.Member] = {}

        def add(eid: str, e: dict, dc: Any, motion_only: bool = False) -> None:
            try:
                label = NA.name_of(house, eid)
            except Exception:  # noqa: BLE001
                label = eid
            cam = None
            try:
                cam = NA.camera_for(house, eid) if eid.split(".")[0] in ("binary_sensor", "event") else None
            except Exception:  # noqa: BLE001
                cam = None
            m = C.member(eid, device_class=dc, label=label or eid, area=area_of.get(eid) or e.get("area_id"),
                         camera=cam, disabled=bool(e.get("disabled_by")), hidden=bool(e.get("hidden_by")),
                         entity_category=e.get("entity_category"), mine=eid in mine, motion_only=motion_only,
                         override=overrides.get(eid) if isinstance(overrides.get(eid), dict) else None,
                         families=families if isinstance(families, dict) else None)
            if m is not None:
                members[eid] = m

        for eid, (e, dc) in found.items():
            add(eid, e, dc)
        for eid, e, dc in motions:
            cam = NA.camera_for(house, eid)
            add(eid, e, dc, motion_only=bool(cam) and cam not in smart)
        self.members = members
        self.known = set(states)
        self.person_user = self._people({eid for eid, m in members.items() if m.family == "arrival"})
        log.info("timeline: %d entities recorded (%s)", len(members),
                 ", ".join(f"{f} {n}" for f, n in sorted(_counts(m.family for m in members.values()).items())))

    def _people(self, entities: set[str]) -> dict[str, str]:
        """person entity -> Mantel person, by the entity's ``user_id`` (Home Assistant's user) and ha_links."""
        out: dict[str, str] = {}
        states = self.hub.store.states
        for eid in entities:
            ha_user = ((states.get(eid) or {}).get("a") or {}).get("user_id")
            if not ha_user:
                continue
            r = self.db.execute("SELECT user_id FROM ha_links WHERE ha_user_id = ?", (str(ha_user),)).fetchone()
            if r is not None:
                out[eid] = r[0]
        return out

    def private_people(self) -> set[str]:
        """People who keep their arrivals private (decision 8: an adult's own switch; a child's is the Owner's)."""
        rows = self.db.execute("SELECT u.id FROM user_data d JOIN users u ON d.subject = 'u:' || u.id "
                               "WHERE d.key = ? AND d.value = 'true' AND u.role != 'child'", (PRIVATE_KEY,))
        return {r[0] for r in rows}

    # -- the tap ---------------------------------------------------------------------------------------------------
    def tap(self, changed: set[str]) -> None:
        t0 = time.perf_counter()
        try:
            if not self._loaded:
                self.load()
            fresh = changed - self.known
            if fresh:
                self.known |= fresh
                self.refresh()
            hit = changed & self.members.keys()
            if hit:
                states = self.hub.store.states
                for eid in hit:
                    self._seen(eid, states.get(eid))
        finally:
            performance.STATS.timeline_tap((time.perf_counter() - t0) * 1000)

    def _seen(self, eid: str, st: dict | None) -> None:
        if st is None:
            return
        s, lc = st.get("s"), st.get("lc")
        if s in GONE:
            return
        m = self.members[eid]
        prev = self.last.get(eid)
        lc = float(lc) if isinstance(lc, (int, float)) else self.clock()
        if prev is not None and prev[0] == s:
            return                                   # attributes only, or the same state again
        self.last[eid] = (s, lc)
        if prev is None:
            return                                   # its first state: no history is invented (decision 15)
        if self.speaks_for(eid):
            return                                   # Protect's own event is this camera's row (protect.py)
        domain = eid.split(".", 1)[0]
        kind = C.change(m.family, domain, prev[0], s, detection=m.detection)
        if kind is None:
            return
        if m.family == "arrival":
            # who it is, looked up now (a link made since the last refresh counts: Opus review 4)
            found = self._people({eid})
            if found:
                self.person_user[eid] = found[eid]
            else:
                self.person_user.pop(eid, None)
            if self.person_user.get(eid) in self.private_people():
                return                               # Keep My Arrivals Private: not recorded at all
        late = self.clock() - lc > LATE_S
        self.state_row(eid, m, kind, lc, s, late=late, attrs=st.get("a") or {})

    # -- rows from states ------------------------------------------------------------------------------------------
    def state_row(self, eid: str, m: C.Member, kind: str, at: float, s: str, *, late: bool = False,
                  attrs: dict | None = None) -> None:
        cam = m.camera or eid
        if kind == "end":
            got = self.active.pop(eid, None)
            if got is not None:
                self.update(got[0], {"ended": at})
            if m.family == "motion" and cam in self.motion:
                src, start, n = self.motion[cam]
                self.update(src, {"ended": at})
            return
        if m.family == "motion":
            burst = self.motion.get(cam)
            if burst is not None and at - burst[1] < MOTION_WINDOW:
                src, start, n = burst
                self.motion[cam] = (src, start, n + 1)
                self.update(src, {"ended": at, "detail": {"s": s, "count": n + 1}})
                return
            src = f"ha:{eid}:{at}"
            self.motion[cam] = (src, at, 1)
            self.push(self.row(src, eid, m, kind, at, s, late=late, detail={"count": 1}), noise=True)
            return
        if self._flap(eid, m, at, s):
            return
        if m.family == "detection" and kind == "package":
            got = self.package.get(cam)
            if got is not None and at - got[1] < PACKAGE_MERGE:
                src, first, n = got
                self.package[cam] = (src, at, n + 1)
                self.update(src, {"detail": {"s": s, "count": n + 1, "last": at}})
                return
        detail: dict[str, Any] = {}
        if m.family == "lock" and attrs and attrs.get("changed_by"):
            detail["keypad"] = str(attrs.get("changed_by"))[:40]
        if m.family == "arrival":
            detail["zone"] = s if s not in ("home", "not_home") else None
        row = self.row(f"ha:{eid}:{at}", eid, m, kind, at, s, late=late, detail=detail)
        if m.family == "arrival":
            row.person = self.person_user.get(eid)
        if m.family in ATTRIBUTED:
            self.attribute(row, eid, kind, at)
        if m.family == "detection" and kind == "package":
            self.package[cam] = (row.src, at, 1)
        if m.family == "detection" and eid.split(".")[0] == "binary_sensor":
            self.active[eid] = (row.src, at)
        self.push(row)
        if m.family in ("doorbell", "detection") and m.camera and not late:
            pics = self.app.get("timeline_pictures") if hasattr(self.app, "get") else None
            if pics is not None:
                pics.want(row.src, m.camera, m.family, active=eid in self.active)

    def row(self, src: str, eid: str | None, m: C.Member, kind: str, at: float, s: str | None, *, late: bool = False,
            detail: dict | None = None) -> Row:
        area = m.area
        area_name = self.hub.registry.areas.get(area) if area and hasattr(self.hub.registry, "areas") else None
        facts = dict(detail or {})
        title = W.title(m.family, kind, m.label, facts)
        d = {k: v for k, v in {**facts, "s": s, "late": True if late else None}.items() if v is not None}
        entity = eid
        if m.camera and m.family in C.CAMERA_FAMILIES:
            entity, d["sensor"] = m.camera, eid      # a camera's row is the camera's: its RBAC, its pictures
        return Row(src=src, at=at, family=m.family, kind=kind, level=C.level(m.family, kind), entity=entity, area=area,
                   title=title, search=W.search_words(m.family, kind, m.label, area_name, title), detail=d)

    def _flap(self, eid: str, m: C.Member, at: float, s: str) -> bool:
        """True when this change is rolled into a "keeps changing" row."""
        if m.family in ("arrival", "detection", "doorbell"):
            return False
        fl = self.flapping.get(eid)
        if fl is not None:
            src, last, n = fl
            if at - last < FLAP_QUIET:
                self.flapping[eid] = (src, at, n + 1)
                self.update(src, {"ended": at, "detail": {"s": s, "count": n + 1, "flapping": True}})
                return True
            del self.flapping[eid]
        times = self.flaps.setdefault(eid, deque(maxlen=FLAP_MAX + 1))
        times.append(at)
        while times and at - times[0] > FLAP_WINDOW:
            times.popleft()
        if len(times) > FLAP_MAX:
            n = len(times)
            src = f"fl:{eid}:{at}"
            row = Row(src=src, at=at, family=m.family, kind="flapping", level="info", entity=eid, area=m.area,
                      title=W.title(m.family, "flapping", m.label, {"count": n}),
                      search=W.search_words(m.family, "flapping", m.label, None, m.label),
                      detail={"s": s, "count": n, "flapping": True})
            self.flapping[eid] = (src, at, n)
            times.clear()
            self.push(row)
            return True
        return False

    # -- who did it -----------------------------------------------------------------------------------------------
    def on_command(self, row: dict) -> None:
        """The audit's ``commands`` listener: every command row, as it is written (before it is sent)."""
        action = row.get("action")
        verb = verb_of(action)
        if verb is None:
            return
        targets = [t for t in row.get("targets") or () if isinstance(t, str)]
        if row.get("decision") == "allowed":
            now = self.clock()
            for t in targets:
                q = self.commands.setdefault(t, deque(maxlen=8))
                q.append({**row, "verb": verb, "t": float(row.get("timestamp") or now)})
                while q and now - q[0]["t"] > CLAIM_KEEP:
                    q.popleft()
            return
        if row.get("decision") != "denied" or row.get("reason") in ("unauthenticated", "read_only"):
            return
        if not self._loaded:
            self.load()
        for t in targets:
            m = self.members.get(t)
            if m is None or m.family not in ATTRIBUTED:
                continue
            if not self.on("refused"):
                continue
            dev = self._device_name(row.get("device"))
            title = W.title("refused", verb, m.label, {"device": dev} if dev else {})
            r = Row(src=f"au:{row.get('id')}:{t}", at=float(row.get("timestamp") or self.clock()), family="refused",
                    kind=verb, level="warning", entity=t, area=m.area, title=title,
                    # (the device's name is not searched: it can be a person's, "Emma's iPad": review 13)
                    search=W.search_words("refused", verb, m.label, None, W.title("refused", verb, m.label, {})),
                    detail={"family": m.family, "reason": str(row.get("reason") or "")[:40]},
                    actor=row.get("actor"), actor_name=row.get("actor_name"), device=row.get("device"),
                    device_name=dev, how=how_of(row), audit_id=row.get("id"))
            self.push(r)

    def attribute(self, row: Row, eid: str, kind: str, at: float) -> None:
        q = self.commands.get(eid)
        best = None
        if q:
            for c in reversed(q):
                if at - CLAIM_BEFORE <= c["t"] <= at + CLAIM_AFTER and matches(kind, c["verb"]) \
                        and c.get("result") in (None, "ok"):
                    best = c
                    break
        if best is None:
            row.how = "hand_or_automation"
            return
        q.remove(best)
        row.actor, row.actor_name, row.device = best.get("actor"), best.get("actor_name"), best.get("device")
        row.device_name = self._device_name(best.get("device"))
        row.how = how_of(best)
        row.audit_id = best.get("id")

    def _device_name(self, device_id: str | None) -> str | None:
        if not device_id:
            return None
        r = self.db.execute("SELECT name FROM devices WHERE id = ?", (device_id,)).fetchone()
        return r[0] if r is not None else None

    # -- system rows ----------------------------------------------------------------------------------------------
    def on_alert(self, item: Any) -> None:
        """The alert center's listener: each raise and clear it sends."""
        if not self.on("system") or item.kind == "house.digest":      # (the digest isn't one of its own rows)
            return
        at = float(getattr(item, "at", None) or self.clock())
        lid = getattr(item, "log_id", 0)
        src = f"al:{lid}" if lid else f"al:{item.kind}:{item.key}:{at}"
        title = str(getattr(item, "title", "") or item.kind)[:200]
        lvl = "warning" if getattr(item, "level", "info") in ("warning", "critical") and item.up else "info"
        # searched by the kind's own words, without its facts (a tablet's name can be a person's: review 13)
        try:
            from ..alerts import catalog
            k = catalog.kind(item.kind)
            plain = k.words({}, up=bool(item.up))[0] if k is not None else item.kind.replace(".", " ")
        except Exception:  # noqa: BLE001
            plain = str(item.kind).replace(".", " ")
        self.push(Row(src=src, at=at, family="system", kind=("raised" if item.up else "cleared"), level=lvl,
                      title=title, search=W.search_words("system", "", plain, None, plain),
                      detail={"alert": item.kind, "key": str(getattr(item, "key", "") or ""),
                              "up": bool(item.up)}))

    def on(self, family: str) -> bool:
        fams = self.settings.get("families") or {}
        v = fams.get(family) if isinstance(fams, dict) else None
        return v if isinstance(v, bool) else family in C.DEFAULT_ON

    # -- the queue ------------------------------------------------------------------------------------------------
    def push(self, row: Row, noise: bool = False) -> None:
        row.noise = row.noise or noise
        if len(self.queue) >= QUEUE_MAX:
            self._drop()
        self.queue.append(("row", row))
        if len(self.queue) >= FLUSH_AT and self.wake is not None:
            self.wake.set()

    def update(self, src: str, fields: dict) -> None:
        """A later change of a row (its end, its count): applied to the queued row, else written as an UPDATE."""
        for op in reversed(self.queue):
            if op[0] == "row" and op[1].src == src:
                r = op[1]
                for k, v in fields.items():
                    if k == "detail":
                        r.detail = {**r.detail, **v}
                    else:
                        setattr(r, k, v)
                return
        if "detail" in fields:
            cur = self.db.execute("SELECT detail FROM timeline_events WHERE src = ?", (src,)).fetchone()
            try:
                base = json.loads(cur[0]) if cur is not None else {}
            except ValueError:
                base = {}
            fields = {**fields, "detail": {**base, **fields["detail"]}}
        if len(self.queue) >= QUEUE_MAX:
            self._drop()
        self.queue.append(("upd", src, fields))

    def _drop(self) -> None:
        for i, op in enumerate(self.queue):
            if op[0] == "row" and op[1].noise:
                del self.queue[i]
                break
        else:
            self.queue.popleft()
        self.dropped += 1

    def flush(self) -> list[dict]:
        """Write what is queued, in one transaction. The rows written or updated, as dicts."""
        if not self.queue:
            return []
        ops = list(self.queue)
        self.queue.clear()
        t0 = time.perf_counter()
        try:
            srcs = self.rows.write(ops)
        except Exception:  # noqa: BLE001 -- a failed write loses this batch, never the loop
            log.exception("timeline: writing %d rows failed", len(ops))
            return []
        finally:
            performance.STATS.timeline_write((time.perf_counter() - t0) * 1000)
        self.written += sum(1 for op in ops if op[0] == "row")
        rows = self.rows.by_src(srcs)
        for cb in self.after_write + self.listeners:
            try:
                cb(rows)
            except Exception:  # noqa: BLE001
                log.exception("timeline: a listener failed")
        return rows

    def publish(self, srcs: Iterable[str]) -> None:
        """Rows changed outside a flush (a picture kept): to the live feed."""
        rows = self.rows.by_src(srcs)
        for cb in self.listeners:
            try:
                cb(rows)
            except Exception:  # noqa: BLE001
                log.exception("timeline: a listener failed")

    async def writer(self) -> None:
        self.wake = asyncio.Event()
        while True:
            try:
                await asyncio.wait_for(self.wake.wait(), FLUSH_S)
            except asyncio.TimeoutError:
                pass
            self.wake.clear()
            self.flush()
            self.tick()

    def tick(self) -> None:
        now = self.clock()
        for key in [k for k, (src, at) in self.active.items() if now - at > ACTIVE_MAX_S]:
            self.active.pop(key, None)
        for cam in [c for c, (src, start, n) in self.motion.items() if now - start > MOTION_WINDOW * 2]:
            self.motion.pop(cam, None)
        for cam in [c for c, (src, at, n) in self.package.items() if now - at > PACKAGE_MERGE]:
            self.package.pop(cam, None)
        for eid in [e for e, (src, last, n) in self.flapping.items() if now - last > FLAP_QUIET]:
            self.flapping.pop(eid, None)
        if now - self.last_prune >= PRUNE_EVERY:
            self.prune()

    # -- start, stop, catching up -----------------------------------------------------------------------------------
    def load(self) -> None:
        """What each member last was: its newest row, and the states saved at the last stop."""
        self._loaded = True
        try:
            seen = self.settings.get("seen") or {}
            last = {k: (v[0], float(v[1])) for k, v in seen.items() if isinstance(v, list) and len(v) == 2} \
                if isinstance(seen, dict) else {}
        except (TypeError, ValueError):
            last = {}
        for eid, (s, at) in self.rows.newest_per_entity().items():
            if eid not in last or at >= last[eid][1]:
                last[eid] = (s, at)
        for eid, v in last.items():
            self.last.setdefault(eid, v)

    def save_seen(self) -> None:
        if not self.members or not self._loaded:
            return                                   # nothing seen yet (before Home Assistant's first states)
        keep = {eid: [s, at] for eid, (s, at) in self.last.items() if eid in self.members}
        try:
            self.settings.set("seen", keep)
        except Exception:  # noqa: BLE001
            log.warning("timeline: the members' last states couldn't be saved")

    def prune(self) -> int:
        """Rows past the retention, their pictures' files first; then the picture budget; then any arrival of a
        person who keeps theirs private (belt and braces: those aren't written)."""
        self.last_prune = now = self.clock()
        days = self.settings.get("retention_days")
        days = days if days in (7, 30, 90, 365) else 30
        cutoff = now - days * 86400.0
        gone = 0
        try:
            self.delete_files(self.rows.expired_pics(cutoff))
            gone = self.rows.delete_before(cutoff)
            pics = self.app.get("timeline_pictures") if hasattr(self.app, "get") else None
            if pics is not None:
                pics.budget()
            private = self.private_people()
            if private:
                self.rows.person_arrivals(private)
            self.forget_gone()
            self.save_seen()
        except Exception:  # noqa: BLE001
            log.exception("timeline: pruning failed")
        if gone:
            log.info("timeline: %d rows older than %d days deleted", gone, days)
        return gone

    def forget_gone(self) -> None:
        """Decision 18 for whatever the trigger couldn't reach (a row still queued, a command still remembered, when
        the person was removed): rows of a person who no longer exists lose the name, their arrivals go."""
        with self.db:
            self.db.execute("DELETE FROM timeline_events WHERE family = 'arrival' AND person IS NOT NULL "
                            "AND person NOT IN (SELECT id FROM users)")
            self.db.execute("UPDATE timeline_events SET person = NULL WHERE person IS NOT NULL "
                            "AND person NOT IN (SELECT id FROM users)")
            self.db.execute("UPDATE timeline_events SET actor = NULL, actor_name = 'A former member', device = NULL, "
                            "device_name = NULL WHERE actor IS NOT NULL AND length(actor) = 32 "
                            "AND actor NOT IN (SELECT id FROM users)")

    def pic_path(self, pid: str, at: float) -> Path | None:
        if self.folder is None:
            return None
        return self.folder / time.strftime("%Y-%m", time.gmtime(at)) / f"{pid}.jpg"

    def delete_files(self, pics: Iterable[tuple[str, float]]) -> int:
        n = 0
        for pid, at in pics:
            p = self.pic_path(pid, at)
            if p is None:
                continue
            try:
                p.unlink()
                n += 1
            except FileNotFoundError:
                pass
            except OSError:
                log.warning("timeline: a picture file couldn't be deleted")
        return n

    def clear(self, before: float | None = None) -> int:
        """Clear Timeline: every row (or every row before ``before``) and its pictures."""
        cutoff = before if before is not None else self.clock() + 86400.0
        self.flush()
        self.delete_files(self.rows.all_pics(cutoff))
        n = self.rows.delete_before(cutoff)
        self.active.clear()
        self.motion.clear()
        self.package.clear()
        self.flapping.clear()
        return n

    async def start(self) -> None:
        if self.folder is not None:
            try:
                self.folder.mkdir(parents=True, exist_ok=True)
                os.chmod(self.folder, 0o700)
            except OSError:
                log.warning("timeline: its pictures folder couldn't be made")
        loop = asyncio.get_running_loop()
        if not self._loaded:
            self.load()
        self.prune()
        self.tasks.append(loop.create_task(self.writer()))

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        for t in self.tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self.tasks = []
        self.flush()
        self.save_seen()

    def status(self) -> dict:
        return {"members": len(self.members), "queued": len(self.queue), "dropped": self.dropped,
                "written": self.written, "rows": self.rows.count()}


def _counts(items: Iterable[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for x in items:
        out[x] = out.get(x, 0) + 1
    return out
