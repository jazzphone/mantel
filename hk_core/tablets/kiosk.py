"""A WALL TABLET'S KIOSK APP: its entities by role, found on its device by their endings
(Kiosk Satellite's and Fully Kiosk's), the kiosk apps' devices in the house, the screen a kiosk
shows, and the app's settings checked against what HK needs. Reads the house only."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import urlparse

from ..house import House

# role -> (domain, the entity id's ending), by kiosk app
PARTS: dict[str, dict[str, tuple[str, str]]] = {
    "kiosk_satellite": {
        "battery": ("sensor", "_battery"), "charging": ("binary_sensor", "_charging"),
        "brightness": ("sensor", "_panel_brightness"), "touched": ("sensor", "_last_interaction"),
        "online": ("binary_sensor", "_connectivity"), "seen": ("sensor", "_last_seen"),
        "version": ("sensor", "_app_version"), "model": ("sensor", "_device"), "uptime": ("sensor", "_app_uptime"),
        "page": ("sensor", "_current_page"), "app": ("sensor", "_foreground_app"), "ip": ("sensor", "_ipv4_address"),
        "adaptive": ("switch", "_adaptive_brightness"), "saver_mode": ("select", "_screensaver_mode"),
        "saver_timeout": ("number", "_screensaver_timeout"), "kiosk_mode": ("switch", "_kiosk_mode"),
        "update": ("update", "_update"), "screen": ("light", "_screen"),
        "reload": ("button", "_reload_page"), "clear_cache": ("button", "_clear_cache"),
        "restart_app": ("button", "_restart_app"), "restart_device": ("button", "_restart_device"),
        "front": ("button", "_bring_to_front"),
    },
    # Fully Kiosk Browser (Home Assistant's fully_kiosk integration)
    "fully": {
        "battery": ("sensor", "_battery"), "charging": ("binary_sensor", "_plugged_in"),
        "brightness": ("number", "_screen_brightness"), "page": ("sensor", "_current_page"),
        "app": ("sensor", "_foreground_app"), "kiosk_mode": ("binary_sensor", "_kiosk_mode"),
        "screen": ("switch", "_screen"), "update": ("update", "_update"),
        "reload": ("button", "_load_start_url"), "clear_cache": ("button", "_clear_browser_cache"),
        "restart_app": ("button", "_restart_browser"), "restart_device": ("button", "_reboot_device"),
        "front": ("button", "_bring_to_foreground"),
    },
}
KS_PACKAGE = "me.jxl.kiosk_satellite"     # Kiosk Satellite's app, in front when it is
BATTERY_CARE = 85                         # % while charging: above it, Protect Battery is off
SAVER_TIMEOUT = 86400                     # Kiosk Satellite's own screensaver: a day (HK's runs)


def state_of(house: House, eid: str | None) -> str | None:
    st = house.state(eid) if eid else None
    return st.state if st is not None else None


def number(v: str | None) -> float | None:
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def parts(house: House, app: str, device_id: str) -> dict[str, str]:
    """{role: entity id} of a tablet's kiosk app (PARTS), on its device: of its enabled
    entities, the shortest id with the role's domain and ending."""
    roles = PARTS.get(app)
    ids = [e.entity_id for e in house.device_entities(device_id) if not e.disabled] if device_id else []
    if not roles or not ids:
        return {}
    out: dict[str, str] = {}
    for role, (domain, end) in roles.items():
        hits = [i for i in ids if i.startswith(domain + ".") and i.endswith(end)]
        if hits:
            out[role] = sorted(hits, key=len)[0]
    return out


def devices(house: House) -> list[dict[str, str]]:
    """The kiosk apps' devices: [{id, name, app}] by name -- Kiosk Satellite's (its foreground
    app and screensaver switch), Fully Kiosk's (its integration)."""
    by_dev: dict[str, set[str]] = {}
    fully: set[str] = set()
    for e in house.entities():
        if e.device_id:
            by_dev.setdefault(e.device_id, set()).add(e.entity_id)
            if e.platform == "fully_kiosk":
                fully.add(e.device_id)
    out = []
    for dev_id, ids in by_dev.items():
        app = ("fully" if dev_id in fully else
               "kiosk_satellite" if any(i.endswith("_foreground_app") for i in ids)
               and any(i.endswith("_screensaver_active") for i in ids) else None)
        d = house.device(dev_id) if app else None
        if d:
            out.append({"id": dev_id, "name": d.name or dev_id, "app": app})
    return sorted(out, key=lambda k: k["name"].lower())


def screen_of_url(url: str | None, screens: set[str]) -> str:
    """The screen a kiosk shows, from its current page's address."""
    try:
        seg = urlparse(str(url or "")).path.strip("/").split("/")[0]
    except ValueError:
        return ""
    return seg if seg in screens else ""


def checks(house: House, t: Mapping[str, Any], p: Mapping[str, str]) -> list[dict[str, Any]]:
    """The tablet's kiosk app against what HK needs, each {key, ok, title, detail, fix} --
    `fix`: [domain, service, data] that sets it right ("hk", "kiosk_saver": kiosk_saver_calls).
    The same rules as the tablet's page (hk-settings-model.js tabletChecks)."""
    out: list[dict[str, Any]] = []
    if not p:
        return out
    online = state_of(house, p.get("online"))
    if online == "off" or state_of(house, p.get("battery")) in ("unavailable", None):
        out.append({"key": "online", "ok": False, "title": "Kiosk App Not Heard From",
                    "detail": "It may be off the Wi-Fi, or behind the lock screen after a restart."})
    if p.get("adaptive"):
        on = state_of(house, p["adaptive"]) == "on"
        out.append({"key": "adaptive", "ok": not on, "title": "Adaptive Brightness Off",
                    "detail": "On: Android changes the brightness, and fights Sleep Screen’s." if on
                    else "Sleep Screen sets the brightness.",
                    "fix": ["switch", "turn_off", {"entity_id": p["adaptive"]}]})
    if t["app"] == "kiosk_satellite" and p.get("saver_mode"):
        mode = state_of(house, p["saver_mode"])
        tmo = number(state_of(house, p.get("saver_timeout")))
        ok = mode == "Black" and (tmo is None or tmo >= SAVER_TIMEOUT)
        out.append({"key": "saver", "ok": ok, "title": "Kiosk Screensaver: Black, after 1 day",
                    "detail": "HK’s screensaver and black do the work." if ok
                    else f"It is {mode or 'unknown'}, after {int(tmo or 0)} s: it can come up over HK’s.",
                    "fix": ["hk", "kiosk_saver", {"mode": p["saver_mode"], "timeout": p.get("saver_timeout")}]})
    if p.get("kiosk_mode"):
        on = state_of(house, p["kiosk_mode"]) == "on"
        dom = p["kiosk_mode"].split(".")[0]
        out.append({"key": "kiosk_mode", "ok": on, "title": "Kiosk Mode On",
                    "detail": "Nobody can leave the dashboard by accident." if on
                    else "Off: anybody can leave the dashboard.",
                    "fix": ["switch", "turn_on", {"entity_id": p["kiosk_mode"]}] if dom == "switch" else None})
    if p.get("update"):
        up = state_of(house, p["update"]) == "on"
        out.append({"key": "update", "ok": not up, "title": "App Up to Date",
                    "detail": "An update is waiting." if up else "", "fix": None})
    bat, chg = number(state_of(house, p.get("battery"))), state_of(house, p.get("charging"))
    if bat is not None and chg is not None:
        hot = chg == "on" and bat > BATTERY_CARE
        out.append({"key": "battery", "ok": not hot, "title": "Battery Care",
                    "detail": (f"{int(bat)}% and charging all day. Turn on Protect Battery on the tablet."
                               if hot else f"{int(bat)}% {'while plugged in' if chg == 'on' else 'and not charging'}."),
                    "fix": None})
    return out


def kiosk_saver_calls(p: Mapping[str, str]) -> list[tuple[str, str, dict[str, Any]]]:
    """The calls that set Kiosk Satellite's own screensaver right (the "saver" check's fix):
    Black, after a day, so HK's screensaver and black do the work. [(domain, service, data)],
    in order; none for what the app does not have."""
    out: list[tuple[str, str, dict[str, Any]]] = []
    if p.get("saver_mode"):
        out.append(("select", "select_option", {"entity_id": p["saver_mode"], "option": "Black"}))
    if p.get("saver_timeout"):
        out.append(("number", "set_value", {"entity_id": p["saver_timeout"], "value": SAVER_TIMEOUT}))
    return out
