"""Laundry: washers, dryers and washer-dryers, whatever brand, the rules with no host in them (phase 22, 2026-11-10, the owner).

THE ASK: a Laundry card for the Home Grid at every size, a tile and a chip on the generated pages, a detail sheet, and Done that stays
until someone unloads. "The LG and GE also make combo units ... scope is huge for such a small win, so do what you can with entity
pickers ... so a user can just pick the necessary entities and decide if they have a combo or standalone for washer and dryer ... if you
think you can 'auto' configure these things, feel free." Laundry lives under Accessories, not on a settings page of its own.

ONE SET OF STATES FOR EVERY BRAND. A machine is not one Home Assistant entity: a SmartThings washer is a select and a dozen sensors on
one device, LG folds the cycle step into its status, Home Connect has no step at all. Each source is reduced to STATES before anything
is drawn, by its raw value (WORDS), never by its brand. The table was read from Home Assistant's own integrations (smartthings, lg_thinq,
home_connect, miele, whirlpool) and the HACS ones for GE, Electrolux and hOn, 2026-11-10 (docs/phase22/LAUNDRY.md). A machine with no
integration is read from a power sensor (running above `watts`) or a sensor that is on while it runs (a vibration sensor's helper).

THE MACHINES (settings.features.laundry): a list the Accessories page writes, each {id, name, kind, area, and the entities picked}.
Empty, the frontend finds them (web/hk/modules/hk-laundry.js `found`): a device whose status sensor reads like a washer's or a dryer's.

DONE, HELD (Mantel Server, mantel_server/features/laundry.py): most machines say they finished for a moment and then go back to off, and a
power plug never says it at all. The server watches each machine: running, then not, is Done, kept until someone presses Clear, the
door opens, the machine runs again, or Clear After hours pass (features.laundry_clear; 0 is until cleared). Shared as Mantel's own
sensor.laundry_done ({machine: {since, words}}), the way the vacuum's water tank is (vacuum_water.py). HK Frontend inside Home
Assistant has no server: a machine there is Done only while it says so itself.

The frontend keeps a copy of WORDS and STEPS (hk-laundry.js, between its `WORDS-BEGIN` / `WORDS-END` marks);
tests/test_laundry.py holds the two the same.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

SENSOR = "sensor.laundry_done"          # Mantel's own: attribute `machines` is {machine id: {since, words}}, for every screen
CLEAR = "laundry_done_clear"            # script.laundry_done_clear {machine}: the Clear key, through the gateway
KINDS = ("washer", "dryer", "combo")
STATES = ("off", "delayed", "washing", "rinsing", "spinning", "drying", "cooling", "wrinkle", "paused", "running", "done",
          "error", "offline")
RUNNING = ("delayed", "washing", "rinsing", "spinning", "drying", "cooling", "paused", "running")
CLEAR_AFTER = (0, 2, 4, 8, 12, 24)      # hours; 0 is until cleared
DEFAULT_CLEAR = 4
DEFAULT_WATTS = 10
MAX_MACHINES = 8
# the entities a machine may name, and the domains each may be
ROLES: dict[str, tuple[str, ...]] = {
    "status": ("sensor", "select", "binary_sensor"),       # what it is doing: run / pause / finished ...
    "phase": ("sensor",),                                   # the cycle step, where the status doesn't carry it
    "time": ("sensor",),                                    # a finish time (timestamp) or the time left (a duration)
    "progress": ("sensor",),                                # percent through the cycle
    "door": ("binary_sensor", "sensor"),
    "remote": ("binary_sensor", "sensor", "switch"),        # remote control allowed
    "leak": ("binary_sensor",),
    "power": ("sensor",),                                   # watts: running above `watts`
    "running": ("binary_sensor", "input_boolean", "switch"),  # on while it runs (a vibration sensor's helper)
}

# RAW VALUE -> STATE (every integration's spelling, tidied: lower case, words joined by _). The cycle step first; a status second.
# WORDS-BEGIN
WORDS: dict[str, str] = {
    # washing
    "wash": "washing", "washing": "washing", "ai_wash": "washing", "pre_wash": "washing", "prewash": "washing", "main_wash": "washing",
    "cycle_washing": "washing", "cycle_filling": "washing", "cycle_soaking": "washing", "fill": "washing", "soak": "washing",
    "soaking": "washing", "weight_sensing": "washing", "weighting": "washing", "detecting": "washing", "cycle_sensing": "washing",
    "load_size_detection": "washing", "steam": "washing", "steam_softening": "washing", "air_wash": "washing", "running_maincycle": "washing",
    # rinsing
    "rinse": "rinsing", "rinsing": "rinsing", "ai_rinse": "rinsing", "cycle_rinsing": "rinsing", "rinse_hold": "rinsing",
    "extra_rinse": "rinsing", "rinses": "rinsing",
    # spinning
    "spin": "spinning", "spinning": "spinning", "ai_spin": "spinning", "cycle_spinning": "spinning", "extra_spin": "spinning",
    "drain": "spinning", "thermo_spin": "spinning",
    # drying
    "dry": "drying", "drying": "drying", "ai_drying": "drying", "tumble": "drying", "tumbling": "drying", "night_dry": "drying",
    "timed_drying": "drying", "hygiene_drying": "drying", "extra_dry": "drying", "warm_air": "drying", "heat_stroke": "drying",
    # cooling
    "cooling": "cooling", "cool_down": "cooling", "cooling_down": "cooling", "cooldown": "cooling", "comfort_cooling": "cooling",
    "safety_cooling": "cooling",
    # wrinkle care: the cycle is over, the drum still turns now and then
    "wrinkle_prevent": "wrinkle", "wrinkle_care": "wrinkle", "anti_crease": "wrinkle", "extended_tumble": "wrinkle",
    "running_postcycle": "wrinkle", "air_fluff": "wrinkle",
    # paused
    "pause": "paused", "paused": "paused", "delay_paused": "paused", "smart_grid_pause": "paused",
    # a delayed start
    "delayedstart": "delayed", "delayed_start": "delayed", "delay_wash": "delayed", "reserved": "delayed", "reservation": "delayed",
    "waiting_to_start": "delayed", "programmed": "delayed", "smart_delay": "delayed", "delay_countdown": "delayed", "delay_run": "delayed",
    "scheduled": "delayed",
    # running, no step said
    "run": "running", "running": "running", "in_use": "running", "on": "running", "program_running": "running", "cycle": "running",
    "working": "running", "in_progress": "running",
    # done
    "finish": "done", "finished": "done", "end": "done", "complete": "done", "completed": "done", "program_ended": "done",
    "end_of_cycle": "done", "ending": "done", "cycle_complete": "done", "cycle_finished": "done",
    # needs help
    "error": "error", "failure": "error", "actionrequired": "error", "action_required": "error", "exception": "error",
    "hard_stop_or_error": "error", "alarm": "error", "program_interrupted": "error", "power_failure": "error",
    # off, ready, standing by
    "off": "off", "stop": "off", "stopped": "off", "power_off": "off", "inactive": "off", "standby": "off", "ready": "off",
    "ready_to_start": "off", "none": "off", "idle": "off", "initial": "off", "not_running": "off", "setting": "off", "cancelled": "off",
    "canceled": "off", "aborting": "off",
}
# a cycle step, by kind; the state each step stands for
STEPS: dict[str, list[str]] = {"washer": ["wash", "rinse", "spin"], "dryer": ["dry", "cool"], "combo": ["wash", "rinse", "spin", "dry"]}
STEP_OF: dict[str, str] = {"washing": "wash", "rinsing": "rinse", "spinning": "spin", "drying": "dry", "cooling": "cool"}
# WORDS-END

SLUG = re.compile(r"^[a-z0-9_]{1,24}$")
ENTITY = re.compile(r"^([a-z0-9_]+)\.[a-z0-9_]+$")
AREA = re.compile(r"^[a-z0-9_]{1,64}$")
OFF_WORDS = ("off", "false", "closed", "disabled", "0", "dry", "")


class Invalid(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def tidy(value: Any) -> str:
    """'Cycle Washing', cycle_washing and CYCLE-WASHING are the same words."""
    return re.sub(r"[^a-z0-9]+", "_", str(value if value is not None else "").strip().lower()).strip("_")


def word(value: Any) -> str | None:
    """The state a raw value stands for, or None when it says nothing we know."""
    return WORDS.get(tidy(value))


# ------------------------------------------------------------ the saved machines
def machine(v: Any) -> dict[str, Any]:
    """One machine as the Accessories page saves it, checked; Invalid names why not."""
    if not isinstance(v, dict) or set(v) - ({"id", "name", "kind", "area", "watts"} | set(ROLES)):
        raise Invalid("choice")
    mid, name, kind = v.get("id"), v.get("name"), v.get("kind")
    if not isinstance(mid, str) or not SLUG.match(mid):
        raise Invalid("choice")
    if not isinstance(name, str) or not 0 < len(name.strip()) <= 40:
        raise Invalid("text")
    if kind not in KINDS:
        raise Invalid("choice")
    area = v.get("area")
    if area not in (None, "") and not (isinstance(area, str) and AREA.match(area)):
        raise Invalid("choice")
    watts = v.get("watts", DEFAULT_WATTS)
    if not isinstance(watts, int) or isinstance(watts, bool) or not 1 <= watts <= 3000:
        raise Invalid("choice")
    out: dict[str, Any] = {"id": mid, "name": name.strip(), "kind": kind, "area": area or None, "watts": watts}
    for role, domains in ROLES.items():
        e = v.get(role)
        if e in (None, ""):
            out[role] = None
            continue
        m = ENTITY.match(e) if isinstance(e, str) else None
        if not m or m.group(1) not in domains:
            raise Invalid("entity")
        out[role] = e
    if not (out["status"] or out["power"] or out["running"]):
        raise Invalid("required")          # nothing would say whether it runs
    return out


def machines(v: Any) -> list[dict[str, Any]]:
    """settings.features.laundry: up to MAX_MACHINES, each id once."""
    if v in (None, ""):
        return []
    if not isinstance(v, list) or len(v) > MAX_MACHINES:
        raise Invalid("list")
    out = [machine(x) for x in v]
    if len({m["id"] for m in out}) != len(out):
        raise Invalid("choice")
    return out


def clear_after(v: Any) -> int:
    if not isinstance(v, int) or isinstance(v, bool) or v not in CLEAR_AFTER:
        raise Invalid("choice")
    return v


# ------------------------------------------------------------ what a machine is doing
def _s(states: Mapping[str, Any], eid: str | None) -> Mapping[str, Any] | None:
    return states.get(eid) if eid else None


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def is_on(st: Mapping[str, Any] | None) -> bool:
    """A binary-ish reading that says yes: on, open, wet, true, enabled."""
    return st is not None and tidy(st.get("s")) not in OFF_WORDS + ("unknown", "unavailable")


def state_of(m: Mapping[str, Any], states: Mapping[str, Any]) -> str:
    """One of STATES for a saved machine, from the house's states ({entity: {s, a, ...}}, Mantel's store shape).

    The status first (it says paused, error, done, off), then the cycle step for which part of the cycle; a power or running sensor
    where there is no status. Unavailable is offline, never off."""
    st, ph = _s(states, m.get("status")), _s(states, m.get("phase"))
    if st is not None:
        raw = tidy(st.get("s"))
        if raw in ("unavailable", "unknown") and not ph:
            return "offline" if raw == "unavailable" else "off"
        said = WORDS.get(raw)
        if (m.get("status") or "").startswith("binary_sensor."):
            said = "running" if is_on(st) else "off"
        step = WORDS.get(tidy(ph.get("s"))) if ph else None
        if said in ("error", "paused", "delayed"):
            return said
        if said == "done" or step == "done":
            return "done" if said in (None, "done", "running", "off") or step == "done" else said
        if said in ("running", None) and step in ("washing", "rinsing", "spinning", "drying", "cooling", "wrinkle", "paused", "delayed"):
            return step
        if said == "off" and step in ("wrinkle",):
            return "wrinkle"
        if said:
            return said
        if step:
            return step
        return "off"
    run = _s(states, m.get("running"))
    if run is not None:
        return "running" if is_on(run) else ("offline" if tidy(run.get("s")) == "unavailable" else "off")
    pw = _s(states, m.get("power"))
    if pw is not None:
        w = _num(pw.get("s"))
        if w is None:
            return "offline" if tidy(pw.get("s")) == "unavailable" else "off"
        return "running" if w >= float(m.get("watts") or DEFAULT_WATTS) else "off"
    return "offline"


def runs(state: str) -> bool:
    return state in RUNNING


# ------------------------------------------------------------ Done, held
def settled(was_running: bool, state: str) -> bool:
    """Running before and not now: it finished (a machine that stopped while no one watched isn't guessed at)."""
    return was_running and not runs(state) and state not in ("offline", "error")


def expired(since: float, hours: int, now: float) -> bool:
    return hours > 0 and now - since >= hours * 3600.0


# ------------------------------------------------------------ finding them (hk-laundry.js `found`, the same: tests/test_laundry.py)
STATUS_RE = re.compile(r"(machine_state|operation_state|operating_state|current_state|current_status|appliance_?state|mach_?mode|washer_state|"
                       r"dryer_state|laundry_machine_state|(^|_)status$|(^|_)state$)")
PHASE_RE = re.compile(r"(job_state|sub_?cycle|program_phase|cycle_?phase|pr_?phase|_phase$)")
TIME_RE = re.compile(r"(completion_time|finish|end_time|remain|time_?to_?end|time_remaining)")
LAUNDRY_RE = re.compile(r"wash|dryer|laundry|(^|_)dry(_|$)|tumble")
NOT_LAUNDRY = re.compile(r"dish|vacuum|robot|oven|fridge|freezer|microwave|cooktop")
NOT_DOMAINS = ("vacuum.", "climate.", "water_heater.", "lawn_mower.", "fan.", "humidifier.")
STEP_WORDS = ("washing", "rinsing", "spinning", "drying", "wrinkle")


def _name(e: Mapping[str, Any], st: Mapping[str, Any] | None) -> str:
    return str(e.get("name") or ((st or {}).get("a") or {}).get("friendly_name") or "")


def found(entries: Mapping[str, Mapping[str, Any]], devices: Mapping[str, Mapping[str, Any]],
          states: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    """The machines a house has with nothing saved: a device whose status sensor reads like a washer's or a dryer's, and on it
    the step, the time, the progress, the remote control and the power -- the ids the page finds, so Done is held for them."""
    def text(eid: str) -> str:
        return tidy(eid.split(".", 1)[1] + " " + _name(entries.get(eid) or {}, states.get(eid)))

    def opts(eid: str) -> list[Any]:
        o = ((states.get(eid) or {}).get("a") or {}).get("options")
        return o if isinstance(o, list) else []

    by: dict[str, list[str]] = {}
    for eid in states:
        e = entries.get(eid)
        if not e or e.get("hidden") or e.get("hidden_by") or e.get("disabled_by"):
            continue
        key = e.get("device_id") or (f"~{e['area_id']}:{eid.split('.', 1)[1].split('_')[0]}" if e.get("area_id") else "")
        if key:
            by.setdefault(key, []).append(eid)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for dev in sorted(by):
        mine, d = sorted(by[dev]), devices.get(dev) or {}
        said = tidy(" ".join(str(d.get(k) or "") for k in ("name_by_user", "name", "model", "model_id"))) + " " + " ".join(text(x) for x in mine)
        if any(x.startswith(NOT_DOMAINS) for x in mine) or NOT_LAUNDRY.search(said):
            continue
        if not any(WORDS.get(tidy(o)) in STEP_WORDS for x in mine for o in opts(x)) and not LAUNDRY_RE.search(said):
            continue
        for sid in mine:
            oid = sid.split(".", 1)[1]
            if not sid.startswith("sensor.") or not STATUS_RE.search(oid) or PHASE_RE.search(oid):
                continue
            hits = sum(1 for o in opts(sid) if WORDS.get(tidy(o)) not in (None, "off"))
            if not (hits >= 2 or (LAUNDRY_RE.search(text(sid)) and word((states.get(sid) or {}).get("s")))):
                continue
            side = re.search(r"upper|lower|sub_|_sub|top|bottom", sid)

            def pick(rx: re.Pattern[str], ok: Any) -> str | None:
                return next((x for x in mine if rx.search(x.split(".", 1)[1]) and ok(x) and (not side or side.group(0) in x)), None)

            def attrs(x: str) -> Mapping[str, Any]:
                return (states.get(x) or {}).get("a") or {}
            mid = tidy(re.sub(r"_(machine_state|operation_state|operating_state|current_state|current_status|state|status)$", "", oid))[:24] or "machine"
            while mid in seen:
                mid = mid[:22] + "_2"
            seen.add(mid)
            out.append({
                "id": mid, "status": sid,
                "phase": pick(PHASE_RE, lambda x: x.startswith("sensor.")),
                "time": pick(TIME_RE, lambda x: x.startswith("sensor.") and (attrs(x).get("device_class") in ("timestamp", "duration")
                                                                             or str(attrs(x).get("unit_of_measurement") or "") in ("min", "s", "h"))),
                "door": pick(re.compile(r"door"), lambda x: x.startswith("binary_sensor.") and "lock" not in x),
                "power": pick(re.compile(r"(^|_)power$"), lambda x: x.startswith("sensor.") and attrs(x).get("device_class") == "power"),
                "running": None, "watts": DEFAULT_WATTS,
                "_dev": dev, "_area": d.get("area_id") or (entries.get(sid) or {}).get("area_id"),
                "_dryer": _dryer(text(sid) + " " + tidy(" ".join(str(d.get(k) or "") for k in ("name_by_user", "name", "model", "model_id")))),
            })
    _circuits(out, entries, devices, states, text)
    for m in out:
        for k in ("_dev", "_area", "_dryer"):
            m.pop(k)
    return out


def _dryer(t: str) -> bool:
    """hk-laundry.js kindOf: a dryer, not a washer or a washer-dryer."""
    if re.search(r"combo|washer_?dryer|wash_?dry|washcombo|(^|[_ ])wd[0-9]", t):
        return False
    return bool(re.search(r"dryer|(^|_)dry(_|$)|tumble", t)) and "wash" not in t


def _circuits(out: list[dict[str, Any]], entries: Mapping[str, Mapping[str, Any]], devices: Mapping[str, Mapping[str, Any]],
              states: Mapping[str, Mapping[str, Any]], text: Any) -> None:
    """A circuit's watts in place of the machine's own (hk-laundry.js found, the same): a power sensor named for the laundry, or the
    power sensor a laundry-named energy sensor is summed from, never one on a machine; the machine's own room first."""
    mine = {m["_dev"] for m in out}
    circ: list[tuple[str, str, Any]] = []
    for eid in sorted(states):
        e, a, t = entries.get(eid) or {}, (states.get(eid) or {}).get("a") or {}, text(eid)
        key = e.get("device_id") or (f"~{e['area_id']}:{eid.split('.', 1)[1].split('_')[0]}" if e.get("area_id") else "")
        if not eid.startswith("sensor.") or not re.search(r"wash|dryer|laundry", t) or NOT_LAUNDRY.search(t) or (e and key in mine):
            continue
        src = a.get("source")
        src = src if isinstance(src, str) else ""
        p = eid if a.get("device_class") == "power" else (src if a.get("device_class") == "energy" and src.startswith("sensor.")
                                                          and ((states.get(src) or {}).get("a") or {}).get("device_class") == "power" else None)
        if p and all(c[0] != p for c in circ):
            circ.append((p, t, e.get("area_id") or (devices.get(e.get("device_id") or "") or {}).get("area_id")))
    for m in out:
        ok = [c for c in circ if re.search(r"dry|laundry" if m["_dryer"] else r"wash|laundry", c[1])]
        c = next((x for x in ok if m["_area"] and x[2] == m["_area"]), ok[0] if ok else None)
        if c:
            m["power"] = c[0]
