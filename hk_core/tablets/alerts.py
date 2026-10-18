"""THE TABLETS' ALERTS AND THE SCHEDULED RESTART (All Tablets).

Alerts: a tablet offline (its kiosk app not heard from) or not charging for ten minutes, or not
back in front three minutes after its scheduled restart. `Alerts.check` runs once a minute (the
host's timer) and answers what to raise and clear; the host shows them (inside Home Assistant a
persistent notification under `note_id`, and an Important banner on the HK screens).

The scheduled restart: when it runs (`restart_times`) and what it presses on each tablet
(`restart_plan`): Clear Cache on every tablet first, CLEAR_WAIT, then each one's restart. The
host presses the buttons and waits; one tablet's failure never stops the rest.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from ..house import House
from ..notifications.dnd import hhmm
from .kiosk import KS_PACKAGE, parts, state_of

OFFLINE_AFTER = timedelta(minutes=10)
CHARGING_AFTER = timedelta(minutes=10)
BACK_AFTER = timedelta(minutes=3)         # a restart: in front again within this
CLEAR_WAIT = 10                           # s between Clear Cache and Restart


@dataclass(frozen=True)
class Alert:
    """Raise (`up`) or clear one tablet's alert of one kind (offline, charging, restart)."""
    up: bool
    tablet: str
    kind: str
    title: str = ""
    message: str = ""


def note_id(tid: str, kind: str) -> str:
    """The alert's notification id: one per tablet and kind, so it is raised once and cleared."""
    return f"hk_tablet_{tid}_{kind}"


def _when(v: str) -> datetime | None:
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        return None


class Alerts:
    """What is wrong with each tablet, since when, and which alerts are up. `raised` holds
    (tablet, kind); `restarted` the tablets the scheduled restart just restarted, and when."""

    def __init__(self) -> None:
        self.since: dict[tuple[str, str], datetime] = {}      # (tablet, kind) -> first seen wrong
        self.raised: set[tuple[str, str]] = set()
        self.restarted: dict[str, datetime] = {}

    def check(self, house: House, tabs: Mapping[str, Mapping[str, Any]], options: Mapping[str, Any],
              now: datetime) -> list[Alert]:
        """One round: every tablet whose kiosk app the house knows. `options`: All Tablets'
        (alert_offline, alert_charging, alert_restart). Answers the alerts to raise and clear,
        in order; `raised` already says what is up after them."""
        out: list[Alert] = []
        for tid, t in tabs.items():
            p = parts(house, t["app"], t["device"])
            if not p:
                continue
            online = state_of(house, p.get("online"))
            gone = online == "off" or state_of(house, p.get("battery")) in ("unavailable", None)
            seen = state_of(house, p.get("seen"))
            if not gone and seen:
                ts = _when(seen)
                gone = bool(ts and now - ts > OFFLINE_AFTER)
            self._wrong(out, tid, "offline", gone and bool(options.get("alert_offline")), OFFLINE_AFTER, now,
                        f"{t['name']} tablet is offline",
                        "Its kiosk app hasn’t been heard from for 10 minutes. It may be off the Wi-Fi, "
                        "or behind the lock screen after a restart.")
            unplugged = state_of(house, p.get("charging")) == "off"
            self._wrong(out, tid, "charging", unplugged and bool(options.get("alert_charging")), CHARGING_AFTER, now,
                        f"{t['name']} tablet isn’t charging", "Unplugged, or its charger isn’t keeping up.")
            at = self.restarted.get(tid)
            if at and now - at >= BACK_AFTER:
                self.restarted.pop(tid, None)
                front = state_of(house, p.get("app"))
                back = not gone and (t["app"] != "kiosk_satellite" or front in (None, KS_PACKAGE))
                if not back and options.get("alert_restart"):
                    self._raise(out, tid, "restart", f"{t['name']} tablet didn’t come back",
                                "Its scheduled restart was 3 minutes ago and the kiosk app isn’t in front. "
                                "It may be on the lock screen.")
                elif back:
                    self._clear(out, tid, "restart")
        return out

    def _wrong(self, out: list[Alert], tid: str, kind: str, wrong: bool, after: timedelta, now: datetime,
               title: str, message: str) -> None:
        k = (tid, kind)
        if not wrong:
            self.since.pop(k, None)
            self._clear(out, tid, kind)
            return
        first = self.since.setdefault(k, now)
        if now - first >= after and k not in self.raised:
            self._raise(out, tid, kind, title, message)

    def _raise(self, out: list[Alert], tid: str, kind: str, title: str, message: str) -> None:
        self.raised.add((tid, kind))
        out.append(Alert(True, tid, kind, title, message))

    def _clear(self, out: list[Alert], tid: str, kind: str) -> None:
        if (tid, kind) in self.raised:
            self.raised.discard((tid, kind))
            out.append(Alert(False, tid, kind))


def restart_key(options: Mapping[str, Any]) -> str:
    """What the restart's schedule is built from: the same key, the same schedule."""
    return repr((options.get("restart"), options.get("restart_times")))


def restart_times(options: Mapping[str, Any]) -> list[tuple[int, int]]:
    """When the scheduled restart runs: [(hour, minute)], none while it is off."""
    out: list[tuple[int, int]] = []
    if options.get("restart"):
        for v in options.get("restart_times") or []:
            t = hhmm(v)
            if t:
                h, m = (int(x) for x in t.split(":"))
                out.append((h, m))
    return out


def restart_plan(house: House, tabs: Mapping[str, Mapping[str, Any]]) -> list[tuple[str, str | None, str]]:
    """Every tablet whose kiosk app can restart: [(tablet, its Clear Cache button or None, its
    restart button -- the device's, else the app's)]."""
    out: list[tuple[str, str | None, str]] = []
    for tid, t in tabs.items():
        p = parts(house, t["app"], t["device"])
        if p.get("restart_device") or p.get("restart_app"):
            out.append((tid, p.get("clear_cache") or None, p.get("restart_device") or p["restart_app"]))
    return out
