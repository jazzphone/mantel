"""One client's filtered, coalesced view of the state store.

The client picks entity ids and/or areas. We remember exactly what we last sent for each entity
(`sent`) and, when an entity is due, send the diff between that and the current state. That gives
coalescing for free: a burst of changes inside the interval collapses into one diff, and a value
that flips A -> B -> A inside the interval sends nothing at all.

Coalescing is trailing-edge: the first change after a quiet period goes out immediately; changes
that follow wait until `min_interval` has passed since the last send, so the final value always
arrives.
"""
from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field

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


class ClientView:
    def __init__(self, store: StateStore, registry: Registry, coalescing: Coalescing,
                 client_min_interval: float = 0.0) -> None:
        self.store = store
        self.registry = registry
        self.coalescing = coalescing
        self.client_min = max(0.0, client_min_interval)
        self.entity_ids: set[str] = set()
        self.areas: list[str] = []
        self.selected: set[str] = set()
        self.sent: dict[str, dict] = {}
        self.last_sent: dict[str, float] = {}
        self.dirty: set[str] = set()

    # -- selection ---------------------------------------------------------------------------
    def _resolve(self) -> set[str]:
        return set(self.entity_ids) | self.registry.entities_in(self.areas)

    def select(self, entity_ids: list[str], areas: list[str], now: float) -> dict:
        """(Re)subscribe and return the snapshot message body."""
        self.entity_ids = set(entity_ids)
        self.areas = list(areas)
        self.selected = self._resolve()
        self.sent = {}
        self.last_sent = {}
        self.dirty = set()
        entities = {}
        missing = []
        for eid in sorted(self.selected):
            st = self.store.states.get(eid)
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

    # -- changes -----------------------------------------------------------------------------
    def on_change(self, changed: set[str]) -> bool:
        """Note upstream changes; True if any are in this view (so a flush is worth scheduling)."""
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
            cur = self.store.states.get(eid) if eid in self.selected else None
            old = self.sent.get(eid)
            if cur is None and old is None:
                continue
            if cur is None:
                del self.sent[eid]
                self.last_sent.pop(eid, None)
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
