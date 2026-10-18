"""One client's filtered, coalesced view of the state store.

The client picks entity ids and/or areas. We remember exactly what we last sent for each entity
(`sent`) and, when an entity is due, send the diff between that and the current state. That gives
coalescing for free: a burst of changes inside the interval collapses into one diff, and a value
that flips A -> B -> A inside the interval sends nothing at all.

Coalescing is trailing-edge: the first change after a quiet period goes out immediately; changes
that follow wait until `min_interval` has passed since the last send, so the final value always
arrives.

Read filter (PLAN §5, P3.2): a view may carry a `gate` (an `rbac.Gate`, or anything with
`visible(entity_id) -> bool` and `redact(entity_id, state) -> state`). With one, the view only ever
selects entities the session may `view`, and every state it sends has passed `redact` (people's GPS
removed where locations are denied). An entity asked for by id but not visible is reported
`missing`, exactly like one that does not exist. Without a gate the view behaves as before.

Shaping (gate or not): every state a view sends passes `shape` last, by default
`connectors.media_art.page_shaper`, so no HA token reaches a page: a camera's (`access_token`, the
`?token=` in `entity_picture`) and a media player's signed artwork; the pictures point at Mantel's own
routes instead (connectors/camera_still.py, connectors/media_art.py).
"""
from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from typing import Callable, Protocol

from .connectors import media_art
from .registry import Registry
from .state import StateStore


@dataclass
class Coalescing:
    default: float = 0.0
    overrides: list[tuple[str, float]] = field(default_factory=list)  # (fnmatch pattern, seconds)

    def interval(self, entity_id: str, client_min: float = 0.0) -> float:
        """Longest of: server default, any matching override, what the client asked for."""
        best = max(self.default, client_min)
        for pattern, seconds in self.overrides:
            if fnmatch.fnmatchcase(entity_id, pattern):
                best = max(best, seconds)
        return best


def diff_state(old: dict, new: dict) -> dict | None:
    """HA-style {"+": changed fields, "-": {"a": removed attr keys}} or None if identical."""
    plus: dict = {}
    minus: dict = {}
    if old["s"] != new["s"]:
        plus["s"] = new["s"]
    if old["a"] != new["a"]:
        changed = {k: v for k, v in new["a"].items() if k not in old["a"] or old["a"][k] != v}
        if changed:
            plus["a"] = changed
        removed = [k for k in old["a"] if k not in new["a"]]
        if removed:
            minus["a"] = removed
    if old["lc"] != new["lc"]:
        plus["lc"] = new["lc"]
    if old["lu"] != new["lu"]:
        plus["lu"] = new["lu"]
    if not plus and not minus:
        return None
    out: dict = {}
    if plus:
        out["+"] = plus
    if minus:
        out["-"] = minus
    return out


class ReadGate(Protocol):
    def visible(self, entity_id: str) -> bool: ...
    def redact(self, entity_id: str, state: dict) -> dict: ...


def filter_registry(shapes: dict, gate: ReadGate | None) -> dict:
    """`Registry.frontend_shapes()` cut down to what a gated session may see: only visible entities,
    only devices with a visible entity, only areas/floors those use. No gate: unchanged."""
    if gate is None:
        return shapes
    entities = {eid: e for eid, e in shapes["entities"].items() if gate.visible(eid)}
    device_ids = {e.get("device_id") for e in entities.values()} - {None}
    devices = {did: d for did, d in shapes["devices"].items() if did in device_ids}
    area_ids = {e.get("area_id") for e in entities.values()} | {d.get("area_id") for d in devices.values()}
    areas = {aid: a for aid, a in shapes["areas"].items() if aid in area_ids}
    floor_ids = {a.get("floor_id") for a in areas.values()} - {None}
    floors = {fid: f for fid, f in shapes["floors"].items() if fid in floor_ids}
    return {"entities": entities, "devices": devices, "areas": areas, "floors": floors}


class ClientView:
    def __init__(self, store: StateStore, registry: Registry, coalescing: Coalescing,
                 client_min_interval: float = 0.0, gate: ReadGate | None = None,
                 shape: Callable[[str, dict], dict] | None = None) -> None:
        self.gate = gate
        self.shape = shape or media_art.page_shaper("")
        self.store = store
        self.registry = registry
        self.coalescing = coalescing
        self.client_min = max(0.0, client_min_interval)
        self.all = False
        self.entity_ids: set[str] = set()
        self.areas: list[str] = []
        self.selected: set[str] = set()
        self.sent: dict[str, dict] = {}
        self.last_sent: dict[str, float] = {}
        self.dirty: set[str] = set()

    # -- read filter -------------------------------------------------------------------------
    def _visible(self, eid: str) -> bool:
        return self.gate is None or self.gate.visible(eid)

    def _current(self, eid: str) -> dict | None:
        """The state as this session may see it (None if absent), shaped for a page."""
        st = self.store.states.get(eid)
        if st is None:
            return None
        if self.gate is not None:
            st = self.gate.redact(eid, st)
        return self.shape(eid, st)

    # -- selection ---------------------------------------------------------------------------
    def _resolve(self) -> set[str]:
        if self.all:
            ids = set(self.store.states)
        else:
            ids = set(self.entity_ids) | self.registry.entities_in(self.areas)
        if self.gate is None:
            return ids
        return {e for e in ids if self.gate.visible(e)}

    def select(self, entity_ids: list[str], areas: list[str], now: float, all_entities: bool = False) -> dict:
        """(Re)subscribe and return the snapshot message body."""
        self.all = all_entities
        self.entity_ids = set(entity_ids)
        self.areas = list(areas)
        self.selected = self._resolve()
        self.sent = {}
        self.last_sent = {}
        self.dirty = set()
        entities = {}
        missing = []
        hidden = set() if self.all else self.entity_ids - self.selected  # asked for, not visible
        for eid in sorted(self.selected | hidden):
            st = self._current(eid) if eid in self.selected else None
            if st is None:
                missing.append(eid)
                continue
            self.sent[eid] = st
            self.last_sent[eid] = now
            entities[eid] = st
        return {"type": "snapshot", "entities": entities, "missing": missing}

    def registry_changed(self) -> None:
        """Areas may have gained or lost entities: re-resolve and mark the difference dirty."""
        new = self._resolve()
        self.dirty |= new ^ self.selected
        self.selected = new

    def policy_changed(self) -> None:
        """Grants, schedules or step-up changed: re-resolve, and re-check what was sent (a state may
        now be redacted differently). Call on grant edits and periodically for schedules."""
        new = self._resolve()
        self.dirty |= (new ^ self.selected) | (new & set(self.sent))
        self.selected = new

    # -- changes -----------------------------------------------------------------------------
    def on_change(self, changed: set[str]) -> bool:
        """Note upstream changes; True if any are in this view (so a flush is worth scheduling)."""
        if self.all:  # new entities join; vanished ones leave when their removal is flushed
            self.selected |= {e for e in changed if e in self.store.states and self._visible(e)}
        hit = changed & self.selected
        if hit:
            self.dirty |= hit
        return bool(hit)

    def flush(self, now: float) -> tuple[dict | None, float | None]:
        """Build the next diff message from entities that are due. Returns (message, next_due_time)."""
        changes: dict[str, dict] = {}
        added: dict[str, dict] = {}
        removed: list[str] = []
        next_due: float | None = None
        for eid in list(self.dirty):
            due = self.last_sent.get(eid, float("-inf")) + self.coalescing.interval(eid, self.client_min)
            if due > now:
                next_due = due if next_due is None else min(next_due, due)
                continue
            self.dirty.discard(eid)
            cur = self._current(eid) if eid in self.selected else None
            old = self.sent.get(eid)
            if cur is None and old is None:
                continue
            if cur is None:
                del self.sent[eid]
                self.last_sent.pop(eid, None)
                self.selected.discard(eid) if self.all else None
                removed.append(eid)
            elif old is None:
                self.sent[eid] = cur
                self.last_sent[eid] = now
                added[eid] = cur
            else:
                d = diff_state(old, cur)
                if d is None:
                    continue  # flipped back inside the interval: nothing to say
                self.sent[eid] = cur
                self.last_sent[eid] = now
                changes[eid] = d
        if not (changes or added or removed):
            return None, next_due
        msg: dict = {"type": "diff"}
        if changes:
            msg["changes"] = changes
        if added:
            msg["added"] = added
        if removed:
            msg["removed"] = removed
        return msg, next_due
