"""WALL TABLETS (entry 1.14): what HK Frontend knows about each tablet's kiosk
app, beyond the tablet's own settings (settings.tablet) and its entities
(screensaver.py).

    parts()        a kiosk app's entities by role (battery, charging, its
                   buttons ...) -- Kiosk Satellite's and Fully Kiosk's, found
                   on the tablet's device by their endings
    devices()      the kiosk apps' devices in Home Assistant
    suggestions()  a kiosk device no tablet uses, or a browser that said it
                   looks like one (ws tablet/seen) -- "This looks like a wall
                   tablet" on Wall Tablets, until added or dismissed
    checks()       the tablet's kiosk app against what HK needs (the tablet's
                   page, Setup Check)
    Watch          the alerts (offline, not charging, didn't come back after
                   a restart) and the scheduled restart

The page reads states itself; this sends it the entity ids (panel/get).
docs/Wall-Tablets.md.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import logging
from typing import Any
from urllib.parse import urlparse

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.event import async_track_time_change, async_track_time_interval
from homeassistant.util import dt as dt_util

from . import settings as S

_LOGGER = logging.getLogger(__name__)

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
OFFLINE_AFTER = timedelta(minutes=10)
CHARGING_AFTER = timedelta(minutes=10)
BACK_AFTER = timedelta(minutes=3)         # a restart: in front again within this
CLEAR_WAIT = 10                           # s between Clear Cache and Restart
SEEN_KEEP = timedelta(days=7)
BATTERY_CARE = 85                         # % while charging: above it, Protect Battery is off
SAVER_TIMEOUT = 86400                     # Kiosk Satellite's own screensaver: a day (HK's runs)
DATA = "tablets"                          # hass.data[DOMAIN][DATA]: the Watch


def _entities_of(hass: HomeAssistant, device_id: str) -> list[str]:
    if not device_id:
        return []
    return [e.entity_id for e in er.async_entries_for_device(er.async_get(hass), device_id)]


def parts(hass: HomeAssistant, app: str, device_id: str) -> dict[str, str]:
    """{role: entity id} of a tablet's kiosk app (PARTS), on its device."""
    roles = PARTS.get(app)
    ids = _entities_of(hass, device_id)
    if not roles or not ids:
        return {}
    out: dict[str, str] = {}
    for role, (domain, end) in roles.items():
        hits = [i for i in ids if i.startswith(domain + ".") and i.endswith(end)]
        if hits:
            out[role] = sorted(hits, key=len)[0]
    return out


def devices(hass: HomeAssistant) -> list[dict[str, str]]:
    """The kiosk apps' devices: [{id, name, app}] -- Kiosk Satellite's (its
    foreground app and screensaver switch), Fully Kiosk's (its integration)."""
    reg, devs = er.async_get(hass), dr.async_get(hass)
    by_dev: dict[str, set[str]] = {}
    fully: set[str] = set()
    for e in reg.entities.values():
        if e.device_id:
            by_dev.setdefault(e.device_id, set()).add(e.entity_id)
            if e.platform == "fully_kiosk":
                fully.add(e.device_id)
    out = []
    for dev_id, ids in by_dev.items():
        app = ("fully" if dev_id in fully else
               "kiosk_satellite" if any(i.endswith("_foreground_app") for i in ids)
               and any(i.endswith("_screensaver_active") for i in ids) else None)
        d = devs.async_get(dev_id) if app else None
        if d:
            out.append({"id": dev_id, "name": d.name_by_user or d.name or dev_id, "app": app})
    return sorted(out, key=lambda k: k["name"].lower())


def screen_of_url(url: str | None, screens: set[str]) -> str:
    """The screen a kiosk shows, from its current page's address."""
    try:
        seg = urlparse(str(url or "")).path.strip("/").split("/")[0]
    except ValueError:
        return ""
    return seg if seg in screens else ""


# ------------------------------------------------------------ suggestions
def _seen(hass: HomeAssistant) -> dict[str, dict[str, Any]]:
    from .const import DOMAIN
    return hass.data.setdefault(DOMAIN, {}).setdefault("tablets_seen", {})


@callback
def saw(hass: HomeAssistant, user: str, screen: str, app: str, tablet: str | None) -> None:
    """A browser that looks like a wall tablet (a kiosk app's) and isn't one
    of the tablets, reported by hk-settings.js."""
    if tablet or app not in S.TABLET_APPS:
        return
    key = f"seen:{user}:{screen}"
    _seen(hass)[key] = {"key": key, "user": user, "screen": screen, "app": app, "at": dt_util.utcnow()}


def suggestions(hass: HomeAssistant, entry: Any) -> list[dict[str, Any]]:
    """What may be a wall tablet that isn't one yet: a kiosk app's device no
    tablet uses, and the browsers seen (saw) whose user and screen no tablet
    has -- less those dismissed."""
    tabs = S.tablets(entry)
    dismissed = set(S.merged(entry.options)["tablets"].get("dismissed") or [])
    used = {t["device"] for t in tabs.values() if t["device"]}
    screens = {s.unique_id for s in entry.subentries.values() if s.subentry_type == S.SUBENTRY_DASHBOARD}
    out: list[dict[str, Any]] = []
    for d in devices(hass):
        key = f"device:{d['id']}"
        if d["id"] in used or key in dismissed:
            continue
        p = parts(hass, d["app"], d["id"])
        st = hass.states.get(p.get("page", ""))
        ip = hass.states.get(p.get("ip", ""))
        out.append({"key": key, "app": d["app"], "device": d["id"], "name": d["name"],
                    "screen": screen_of_url(st.state if st else None, screens),
                    "ip": ip.state if ip is not None and ip.state not in ("unknown", "unavailable") else ""})
    now = dt_util.utcnow()
    seen = _seen(hass)
    for key, s in list(seen.items()):
        if now - s["at"] > SEEN_KEEP:
            seen.pop(key)
            continue
        if key in dismissed or any(t["user"] == s["user"] and t["screen"] == s["screen"] for t in tabs.values()):
            continue
        out.append({"key": key, "app": s["app"], "user": s["user"], "screen": s["screen"],
                    "at": s["at"].isoformat()})
    return out


# ------------------------------------------------------------ checks
def _state(hass: HomeAssistant, eid: str | None) -> str | None:
    st = hass.states.get(eid) if eid else None
    return st.state if st is not None else None


def _num(v: str | None) -> float | None:
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def checks(hass: HomeAssistant, t: dict[str, Any], p: dict[str, str]) -> list[dict[str, Any]]:
    """The tablet's kiosk app against what HK needs, each {key, ok, title,
    detail, fix} -- `fix`: [domain, service, data] that sets it right. The
    same rules as the tablet's page (hk-settings-model.js tabletChecks)."""
    out: list[dict[str, Any]] = []
    if not p:
        return out
    online = _state(hass, p.get("online"))
    if online == "off" or _state(hass, p.get("battery")) in ("unavailable", None):
        out.append({"key": "online", "ok": False, "title": "Kiosk App Not Heard From",
                    "detail": "It may be off the Wi-Fi, or behind the lock screen after a restart."})
    if p.get("adaptive"):
        on = _state(hass, p["adaptive"]) == "on"
        out.append({"key": "adaptive", "ok": not on, "title": "Adaptive Brightness Off",
                    "detail": "On: Android changes the brightness, and fights Sleep Screen’s." if on
                    else "Sleep Screen sets the brightness.",
                    "fix": ["switch", "turn_off", {"entity_id": p["adaptive"]}]})
    if t["app"] == "kiosk_satellite" and p.get("saver_mode"):
        mode = _state(hass, p["saver_mode"])
        tmo = _num(_state(hass, p.get("saver_timeout")))
        ok = mode == "Black" and (tmo is None or tmo >= SAVER_TIMEOUT)
        out.append({"key": "saver", "ok": ok, "title": "Kiosk Screensaver: Black, after 1 day",
                    "detail": "HK’s screensaver and black do the work." if ok
                    else f"It is {mode or 'unknown'}, after {int(tmo or 0)} s: it can come up over HK’s.",
                    "fix": ["hk", "kiosk_saver", {"mode": p["saver_mode"], "timeout": p.get("saver_timeout")}]})
    if p.get("kiosk_mode"):
        on = _state(hass, p["kiosk_mode"]) == "on"
        dom = p["kiosk_mode"].split(".")[0]
        out.append({"key": "kiosk_mode", "ok": on, "title": "Kiosk Mode On",
                    "detail": "Nobody can leave the dashboard by accident." if on
                    else "Off: anybody can leave the dashboard.",
                    "fix": ["switch", "turn_on", {"entity_id": p["kiosk_mode"]}] if dom == "switch" else None})
    if p.get("update"):
        up = _state(hass, p["update"]) == "on"
        out.append({"key": "update", "ok": not up, "title": "App Up to Date",
                    "detail": "An update is waiting." if up else "", "fix": None})
    bat, chg = _num(_state(hass, p.get("battery"))), _state(hass, p.get("charging"))
    if bat is not None and chg is not None:
        hot = chg == "on" and bat > BATTERY_CARE
        out.append({"key": "battery", "ok": not hot, "title": "Battery Care",
                    "detail": (f"{int(bat)}% and charging all day. Turn on Protect Battery on the tablet."
                               if hot else f"{int(bat)}% {'while plugged in' if chg == 'on' else 'and not charging'}."),
                    "fix": None})
    return out


def check_lines(hass: HomeAssistant, entry: Any, users: set[str]) -> list[Any]:
    """Setup Check's lines for the tablets (setup_check.Line)."""
    from .setup_check import Line
    tabs = S.tablets(entry)
    boards = S.boards(entry)
    lines: list[Any] = []
    savers = [p for p, b in boards.items() if b.get("screensaver") and b.get("screensaver_engine") != "wallpanel"]
    if not tabs:
        if savers:
            lines.append(Line(False, "Wall Tablets", "Photo Screensaver is on, but no wall tablet runs "
                              "those screens, so the screensaver never shows. Add the tablet: Wall Tablets → Add Tablet."))
        return lines
    probs: list[str] = []
    for t in tabs.values():
        if t["user"] and t["user"] not in users:
            probs.append(f"{t['name']}: no Home Assistant user “{t['user']}”")
        if not t["screen"] or t["screen"] not in boards:
            probs.append(f"{t['name']}: no screen")
        if t["app"] in PARTS and not t["device"]:
            probs.append(f"{t['name']}: its kiosk app’s device isn’t chosen")
        for c in checks(hass, t, parts(hass, t["app"], t["device"])):
            if not c["ok"]:
                probs.append(f"{t['name']}: {c['title'].lower()} — {c['detail']}")
    n = len(tabs)
    if probs:
        lines.append(Line(False, "Wall Tablets", "; ".join(probs) + ". See each tablet’s page in Wall Tablets."))
    else:
        lines.append(Line(True, "Wall Tablets", f"{n} tablet{'s' if n != 1 else ''}, each set up right."))
    return lines


# ------------------------------------------------------------ alerts, restart
class Watch:
    """The alerts (All Tablets: offline, not charging, didn't come back after
    a restart) and the scheduled restart. One per house, rebuilt on a
    settings change (sync)."""

    def __init__(self, hass: HomeAssistant, entry: Any) -> None:
        self.hass, self.entry = hass, entry
        self._unsubs: list[CALLBACK_TYPE] = []
        self._since: dict[tuple[str, str], datetime] = {}    # (tablet, kind) -> first seen wrong
        self._raised: set[tuple[str, str]] = set()
        self._restarted: dict[str, datetime] = {}
        self._key = ""
        self.restarts: list[str] = []                         # the last run's tablets (diagnostics)

    @callback
    def sync(self) -> None:
        o = S.merged(self.entry.options)["tablets"]
        key = repr((o.get("restart"), o.get("restart_times")))
        if key == self._key and self._unsubs:
            return
        self.unload()
        self._key = key
        self._unsubs.append(async_track_time_interval(self.hass, self._check, timedelta(seconds=60)))
        if o.get("restart"):
            for hhmm in o.get("restart_times") or []:
                t = S.hhmm(hhmm)
                if t:
                    h, m = (int(x) for x in t.split(":"))
                    self._unsubs.append(async_track_time_change(self.hass, self._restart_all, hour=h, minute=m, second=0))

    @callback
    def unload(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs = []

    # the scheduled restart
    @callback
    def _restart_all(self, _now: datetime) -> None:
        self.hass.async_create_task(self.restart_all(), "hk_frontend tablets restart")

    async def restart_all(self) -> list[str]:
        """Clear the cache, then restart: every tablet whose kiosk app can."""
        done: list[str] = []
        todo = []
        for tid, t in S.tablets(self.entry).items():
            p = parts(self.hass, t["app"], t["device"])
            if p.get("restart_device") or p.get("restart_app"):
                todo.append((tid, p))
        for _tid, p in todo:
            if p.get("clear_cache"):
                await self._press(p["clear_cache"])
        if todo:
            await asyncio.sleep(CLEAR_WAIT)
        for tid, p in todo:
            await self._press(p.get("restart_device") or p["restart_app"])
            self._restarted[tid] = dt_util.utcnow()
            done.append(tid)
        self.restarts = done
        return done

    async def _press(self, eid: str) -> None:
        try:
            await self.hass.services.async_call("button", "press", {"entity_id": eid}, blocking=True)
        except Exception:                                  # noqa: BLE001 -- one tablet never stops the rest
            _LOGGER.warning("Wall tablets: pressing %s failed", eid, exc_info=True)

    # the alerts
    @callback
    def _check(self, _now: datetime | None = None) -> None:
        o = S.merged(self.entry.options)["tablets"]
        now = dt_util.utcnow()
        for tid, t in S.tablets(self.entry).items():
            p = parts(self.hass, t["app"], t["device"])
            if not p:
                continue
            online = _state(self.hass, p.get("online"))
            gone = online == "off" or _state(self.hass, p.get("battery")) in ("unavailable", None)
            seen = _state(self.hass, p.get("seen"))
            if not gone and seen:
                ts = dt_util.parse_datetime(seen)
                gone = bool(ts and now - ts > OFFLINE_AFTER)
            self._wrong(tid, t, "offline", gone and bool(o.get("alert_offline")), OFFLINE_AFTER, now,
                        f"{t['name']} tablet is offline",
                        "Its kiosk app hasn’t been heard from for 10 minutes. It may be off the Wi-Fi, "
                        "or behind the lock screen after a restart.")
            unplugged = _state(self.hass, p.get("charging")) == "off"
            self._wrong(tid, t, "charging", unplugged and bool(o.get("alert_charging")), CHARGING_AFTER, now,
                        f"{t['name']} tablet isn’t charging", "Unplugged, or its charger isn’t keeping up.")
            at = self._restarted.get(tid)
            if at and now - at >= BACK_AFTER:
                self._restarted.pop(tid, None)
                front = _state(self.hass, p.get("app"))
                back = not gone and (t["app"] != "kiosk_satellite" or front in (None, KS_PACKAGE))
                if not back and o.get("alert_restart"):
                    self._raise(tid, "restart", f"{t['name']} tablet didn’t come back",
                                "Its scheduled restart was 3 minutes ago and the kiosk app isn’t in front. "
                                "It may be on the lock screen.")
                elif back:
                    self._clear(tid, "restart")

    def _wrong(self, tid: str, t: dict[str, Any], kind: str, wrong: bool, after: timedelta, now: datetime,
               title: str, message: str) -> None:
        k = (tid, kind)
        if not wrong:
            self._since.pop(k, None)
            self._clear(tid, kind)
            return
        first = self._since.setdefault(k, now)
        if now - first >= after and k not in self._raised:
            self._raise(tid, kind, title, message)

    def _raise(self, tid: str, kind: str, title: str, message: str) -> None:
        from homeassistant.components import persistent_notification as pn
        self._raised.add((tid, kind))
        pn.async_create(self.hass, message, title, notification_id=f"hk_tablet_{tid}_{kind}")
        self.hass.async_create_task(self._banner(title, message), "hk_frontend tablet alert")

    def _clear(self, tid: str, kind: str) -> None:
        if (tid, kind) in self._raised:
            from homeassistant.components import persistent_notification as pn
            self._raised.discard((tid, kind))
            pn.async_dismiss(self.hass, f"hk_tablet_{tid}_{kind}")

    async def _banner(self, title: str, message: str) -> None:
        """The same as an Important banner on the HK screens, when the house
        has Notifications."""
        try:
            from .features import notifications as N
            ent = N.running(self.hass)
            if ent is None:
                return
            await N.async_deliver(self.hass, N.build_action(self.hass, N.options(ent), {
                "title": title, "message": message, "important": True, "icon": "mdi:tablet-dashboard"}))
        except Exception:                                  # noqa: BLE001 -- the HA notification is there
            _LOGGER.debug("Wall tablets: no banner for %s", title, exc_info=True)


def watch(hass: HomeAssistant) -> Watch | None:
    from .const import DOMAIN
    return hass.data.get(DOMAIN, {}).get(DATA)


@callback
def async_setup_watch(hass: HomeAssistant, entry: Any) -> Watch:
    from homeassistant.helpers.dispatcher import async_dispatcher_connect
    from .const import DOMAIN, SIGNAL_CONFIG
    w = Watch(hass, entry)
    hass.data.setdefault(DOMAIN, {})[DATA] = w
    w.sync()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_CONFIG, w.sync))

    @callback
    def _gone() -> None:
        w.unload()
        if hass.data.get(DOMAIN, {}).get(DATA) is w:
            hass.data[DOMAIN].pop(DATA)
    entry.async_on_unload(_gone)
    return w
