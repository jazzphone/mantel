"""In-memory copy of every HA state, kept current from `subscribe_entities` events.

HA's compressed format (see homeassistant/components/websocket_api/commands.py):
  first event      {"a": {entity_id: {"s": state, "a": attrs, "c": ctx, "lc": ts, "lu": ts}}}
  later events     {"a": {added...}, "c": {entity_id: {"+": {...changed}, "-": {"a": [removed attr keys]}}}, "r": [ids]}
`lu` is omitted by HA when it equals `lc`; we always store both.

Entries are replaced, never mutated, so a view can hold a reference to what it last sent.
"""
from __future__ import annotations


def normalize(raw: dict) -> dict:
    """Compressed HA state -> {s, a, lc, lu}. Context is dropped (clients never need it)."""
    lc = raw.get("lc")
    lu = raw.get("lu", lc)
    return {"s": raw.get("s"), "a": dict(raw.get("a") or {}), "lc": lc, "lu": lu}


def patch(old: dict, change: dict) -> dict:
    """Apply an HA {"+": ..., "-": ...} change to a normalized state, returning a new one."""
    new = {"s": old["s"], "a": old["a"], "lc": old["lc"], "lu": old["lu"]}
    plus = change.get("+") or {}
    minus = change.get("-") or {}
    if "s" in plus:
        new["s"] = plus["s"]
    if "a" in plus or "a" in minus:
        attrs = dict(old["a"])
        attrs.update(plus.get("a") or {})
        for key in minus.get("a") or ():
            attrs.pop(key, None)
        new["a"] = attrs
    if "lc" in plus:
        new["lc"] = plus["lc"]
        new["lu"] = plus.get("lu", plus["lc"])  # a state change is also an update
    elif "lu" in plus:
        new["lu"] = plus["lu"]
    return new


class StateStore:
    def __init__(self) -> None:
        self.states: dict[str, dict] = {}
        self.ours: set[str] = set()         # Mantel's own, not Home Assistant's (timers.py): never counted as the house's

    def apply_event(self, event: dict) -> set[str]:
        """Apply one subscribe_entities event; return the entity_ids that changed."""
        touched: set[str] = set()
        for eid, raw in (event.get("a") or {}).items():
            self.states[eid] = normalize(raw)
            touched.add(eid)
        for eid in event.get("r") or ():
            if self.states.pop(eid, None) is not None:
                touched.add(eid)
        for eid, change in (event.get("c") or {}).items():
            old = self.states.get(eid)
            if old is None:
                continue  # diff for an entity we never saw: ignore, never invent state
            self.states[eid] = patch(old, change)
            touched.add(eid)
        return touched

    def replace_all(self, event: dict) -> set[str]:
        """Initial event after (re)connect: replace everything, report every id that differs."""
        gone = set(self.states)
        self.states = {}
        touched = self.apply_event(event)
        return touched | gone
