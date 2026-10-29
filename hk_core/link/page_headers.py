"""PAGE HEADERS, the part both integrations share: Tonight's lighting schedule,
worked out from the house's automations.

The Lights & Outlets page's header has a Tonight list -- what the house's
lighting automations will do next ("6:40 PM  Front Yard lights on · sunset").
Working it out needs each automation's own configuration, which only an admin
may read over the websocket (automation/config), so it is worked out here,
inside Home Assistant, where the configurations are at hand.

ONE FILE, TWO INTEGRATIONS: this is hk_core's (hk_core/link/), vendored into HK
Frontend and Mantel Link. Each one's page_headers.py keeps what is its own --
how the schedule is delivered, and when it is worked out again -- and hands
`plan` the automations to read (so the tests can stand in for them):

  * HK Frontend sends it to its screens on their own subscription
    (hk_frontend/page_headers/subscribe, open to every user -- a wall tablet
    signs in as an ordinary user) and keeps it up to date;
  * Mantel Link answers Mantel's `mantel/page_headers/get` (admin only);
    Mantel sends it to its screens, each person seeing only the lights they
    may view.

WHAT IS SENT is the triggers, not the times: each entry says "sunset, 15
minutes before" or "at 22:00", and every screen works the next time out from
sun.sun and its own clock. So the list stays right all day and is sent again
only when it changes -- an automation edited or reloaded, the registries, or
a condition flipping.

PER TRIGGER: a sun trigger (event + offset) or a time trigger (a fixed `at`,
or an input_datetime that has a time). What it does is the branch it runs --
a `choose` whose condition is `trigger` with this trigger's id -- or, with no
such branch, the whole action list. That branch is walked (parallel,
sequence, if/then/else, repeat, choose's options and default) for
light/switch/homeassistant turn_on and turn_off, and their targets resolved
to entities (area_id, device_id and label_id through the registries; a
templated target is skipped). The screen keeps only the entities its page
shows as lights, so this stays generic.

CONDITIONS (the user's call, 2026-10-15: a row whose condition fails right
now is dimmed): the automation's own conditions plus the branch's, less its
`trigger` condition, are built with Home Assistant's own condition helpers and
checked here (`checker`). `ready` is True / False, or None when they cannot
be judged without the trigger (a template reading `trigger.*`, an error) -- a
screen shows None like True. HK Frontend checks them again when an entity they
read changes (debounced), so a row brightens when someone gets home.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import condition as cond
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

_LOGGER = logging.getLogger(__name__)

SERVICE_RE = re.compile(r"^(light|switch|homeassistant)\.turn_(on|off)$")
HHMM_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")


# ------------------------------------------------------------ pure pieces
def offset_s(raw: Any) -> int:
    """A sun trigger's offset in seconds: "-00:15:00", "+1:00", 900, or a
    {hours, minutes, seconds} mapping. Anything else is no offset."""
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        return 0
    if isinstance(raw, (int, float)):
        return int(raw)
    if isinstance(raw, dict):
        try:
            return int((float(raw.get("hours", 0)) * 60 + float(raw.get("minutes", 0))) * 60 + float(raw.get("seconds", 0)))
        except (TypeError, ValueError):
            return 0
    m = re.match(r"^\s*([+-])?(\d+):(\d+)(?::(\d+))?\s*$", str(raw))
    if not m:
        return 0
    s = (int(m.group(2)) * 60 + int(m.group(3))) * 60 + int(m.group(4) or 0)
    return -s if m.group(1) == "-" else s


def _as_list(v: Any) -> list[Any]:
    if v is None:
        return []
    return list(v) if isinstance(v, (list, tuple)) else [v]


def branch_for(actions: Any, trigger_id: str | None) -> tuple[list[Any] | None, list[Any]]:
    """The sequence a `choose` runs for this trigger id, and the conditions of
    that option other than the trigger condition. (None, []) when no option
    names the id."""
    if not trigger_id:
        return None, []
    found: list[Any] = []

    def names(c: Any) -> bool:
        if isinstance(c, dict):
            if c.get("condition") == "trigger" and trigger_id in [str(x) for x in _as_list(c.get("id"))]:
                return True
            if c.get("condition") == "or":
                return any(names(x) for x in _as_list(c.get("conditions")))
        return False

    def walk(x: Any) -> None:
        if found or x is None:
            return
        if isinstance(x, list):
            for y in x:
                walk(y)
            return
        if not isinstance(x, dict):
            return
        for opt in _as_list(x.get("choose")):
            if found or not isinstance(opt, dict):
                continue
            conds = _as_list(opt.get("conditions"))
            if any(names(c) for c in conds):
                rest = [c for c in conds if not names(c)]
                found.append((_as_list(opt.get("sequence")), rest))
                return
        for k, y in x.items():
            if k not in ("conditions", "condition"):
                walk(y)

    walk(actions)
    return found[0] if found else (None, [])


def effects(node: Any) -> dict[str, set[str]]:
    """What a sequence does to lights: {"on": {targets}, "off": {targets}},
    each target an entity id or ("area"|"device"|"label", id)."""
    out: dict[str, set[Any]] = {"on": set(), "off": set()}

    def walk(x: Any) -> None:
        if isinstance(x, list):
            for y in x:
                walk(y)
            return
        if not isinstance(x, dict):
            return
        svc = x.get("action") or x.get("service")
        if isinstance(svc, str):
            m = SERVICE_RE.match(svc)
            if m:
                tgt = dict(x.get("target") or {})
                data = x.get("data") if isinstance(x.get("data"), dict) else {}
                for key in ("entity_id", "area_id", "device_id", "label_id"):
                    vals = _as_list(tgt.get(key)) + _as_list(x.get(key)) + _as_list(data.get(key))
                    for val in vals:
                        if not isinstance(val, str) or "{{" in val or "{%" in val:
                            continue
                        out[m.group(2)].add(val if key == "entity_id" else (key[:-3], val))
        for k, y in x.items():
            if k in ("conditions", "condition"):
                continue
            walk(y)

    walk(node)
    return out


def trigger_times(t: dict[str, Any]) -> list[dict[str, Any]]:
    """A trigger as the screens read it: [{kind: "sun", event, offset_s}] or
    [{kind: "time", at: "HH:MM"}] (one per fixed time), or []."""
    if not isinstance(t, dict) or t.get("enabled") is False:
        return []
    kind = t.get("trigger") or t.get("platform")
    if kind == "sun" and t.get("event") in ("sunset", "sunrise"):
        return [{"kind": "sun", "event": t["event"], "offset_s": offset_s(t.get("offset"))}]
    if kind == "time":
        out = []
        for at in _as_list(t.get("at")):
            m = HHMM_RE.match(str(at).strip()) if isinstance(at, str) else None
            if m:
                out.append({"kind": "time", "at": f"{int(m.group(1)):02d}:{m.group(2)}"})
            elif isinstance(at, str) and at.startswith("input_datetime."):
                out.append({"kind": "time", "entity": at})
        return out
    return []


def label_of(alias: str) -> str:
    """The area in the house's naming convention ("Lighting - Front Yard -
    Scheduled Exterior Lights" -> "Front Yard"); "" when it does not follow it."""
    parts = [p.strip() for p in (alias or "").split(" - ")]
    return parts[1] if len(parts) >= 3 and parts[1] else ""


# --------------------------------------------------------------- the house
class Resolver:
    """Targets to entity ids, through the registries (one read per pass)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.ent = er.async_get(hass)
        self.dev = dr.async_get(hass)
        self._by_area: dict[str, set[str]] = {}
        self._by_device: dict[str, set[str]] = {}
        self._by_label: dict[str, set[str]] = {}
        for e in self.ent.entities.values():
            self._by_device.setdefault(e.device_id or "", set()).add(e.entity_id)
            area = e.area_id or (self.dev.async_get(e.device_id).area_id if e.device_id and self.dev.async_get(e.device_id) else None)
            if area:
                self._by_area.setdefault(area, set()).add(e.entity_id)
            for lab in e.labels or ():
                self._by_label.setdefault(lab, set()).add(e.entity_id)

    def entities(self, targets: set[Any]) -> list[str]:
        out: set[str] = set()
        for t in targets:
            if isinstance(t, str):
                out.add(t)
                continue
            kind, val = t
            src = {"area": self._by_area, "device": self._by_device, "label": self._by_label}.get(kind, {})
            out |= src.get(val, set())
        return sorted(x for x in out if x.split(".", 1)[0] in ("light", "switch"))


def automations_on(hass: HomeAssistant) -> list[tuple[str, dict[str, Any]]]:
    """(entity id, raw configuration) of every automation that is on."""
    try:
        from homeassistant.components.automation import DATA_COMPONENT
    except ImportError:  # pragma: no cover -- an older Home Assistant
        return []
    comp = hass.data.get(DATA_COMPONENT)
    if comp is None:
        return []
    out = []
    for ent in comp.entities:
        raw = getattr(ent, "raw_config", None)
        st = hass.states.get(ent.entity_id)
        if isinstance(raw, dict) and st is not None and st.state == "on":
            out.append((ent.entity_id, raw))
    return out


def plan(hass: HomeAssistant, automations: list[tuple[str, dict[str, Any]]], skipped: str) -> list[dict[str, Any]]:
    """The schedule's entries for these automations (`automations_on`'s kind),
    conditions not yet checked: each with its automation, trigger id, when
    (sun / time), what it does (on / off and the entities) and the raw
    conditions that gate it. `skipped` is the debug line (one %s: the
    automation) for one that could not be read."""
    res = Resolver(hass)
    out: list[dict[str, Any]] = []
    for eid, raw in automations:
        try:
            acts = raw.get("actions", raw.get("action"))
            top = _as_list(raw.get("conditions", raw.get("condition")))
            alias = str(raw.get("alias") or "")
            for t in _as_list(raw.get("triggers", raw.get("trigger"))):
                whens = trigger_times(t)
                if not whens:
                    continue
                tid = str(t.get("id")) if isinstance(t, dict) and t.get("id") is not None else None
                seq, extra = branch_for(acts, tid)
                fx = effects(seq if seq is not None else acts)
                on, off = res.entities(fx["on"]), res.entities(fx["off"])
                if not on and not off:
                    continue
                what = "on" if len(on) >= len(off) else "off"
                for w in whens:
                    out.append({"automation": eid, "trigger_id": tid, **w, "effect": what,
                                "entities": on if what == "on" else off, "area": label_of(alias),
                                "name": alias, "_conditions": top + list(extra)})
        except Exception:  # noqa: BLE001 -- one odd automation never stops the rest
            _LOGGER.debug(skipped, eid, exc_info=True)
    out.sort(key=lambda e: (e["automation"], str(e.get("trigger_id")), e.get("at") or e.get("event") or ""))
    return out


async def checker(hass: HomeAssistant, conds: list[Any]) -> tuple[Callable[[], bool | None] | None, set[str]]:
    """A no-argument check of the conditions (None when there are none) and
    the entities they read. A condition that cannot be judged without its
    trigger makes the whole check answer None."""
    if not conds:
        return None, set()
    checks = []
    reads: set[str] = set()
    for c in conds:
        try:
            if isinstance(c, dict) and c.get("enabled") is False:
                continue
            blob = str(c)
            if "trigger." in blob or "trigger[" in blob:
                return (lambda: None), reads
            v = await cond.async_validate_condition_config(hass, cv.CONDITION_SCHEMA(c))
            reads |= cond.async_extract_entities(v)
            checks.append(await cond.async_from_config(hass, v))
        except Exception:  # noqa: BLE001 -- unjudgeable, not false
            return (lambda: None), reads

    def run() -> bool | None:
        try:
            for ck in checks:
                if not ck(hass, {}):
                    return False
            return True
        except Exception:  # noqa: BLE001
            return None

    return run, reads
