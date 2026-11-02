"""What the alert center hears about (docs/phase14/SYSTEM-ALERTS.md, the catalog's sources).

Most conditions are looked at every WATCH seconds (``Watch.look``): the connections (Home Assistant, Music
Assistant, Mantel Link, UniFi Protect), the backups (no good one in 48 hours, the folder missing or read-only), the
disk, the connections' credentials. Each is raised while it is wrong and cleared when it is right; the center's holds
decide when that is worth saying. Events are told as they happen: a backup's result (``Backups.listeners``), the
tablets' alerts (``TabletWatch``), Mantel's start and an unexpected stop (``RUNNING``, a marker in the data folder
that a clean stop removes).
"""
from __future__ import annotations

import logging
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("mantel.alerts")

WATCH = 15.0
RUNNING = ".mantel-running"
STALE_AFTER = 48 * 3600.0
DISK_PERCENT = 5.0
DISK_BYTES = 1 << 30
EXPIRING = 14 * 86400.0


def when(ts: float | None) -> str:
    if not ts:
        return "never"
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def size(n: float) -> str:
    for unit in ("bytes", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "bytes" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


# -- start and stop -----------------------------------------------------------------------------------------------
def started(center, data_dir: Path, version: str | None, now: float) -> None:
    """mantel.started, and mantel.crashed when the last run left its marker (it didn't stop cleanly)."""
    marker = Path(data_dir).expanduser() / RUNNING
    try:
        last = float(marker.read_text().strip() or 0) if marker.exists() else None
    except (OSError, ValueError):
        last = 0.0
    if last is not None:
        center.raise_("mantel.crashed", "", {"when": when(last) if last else "earlier", "version": version or "?"})
    center.raise_("mantel.started", "", {"version": version or "?"})
    beat(data_dir, now)


def beat(data_dir: Path, now: float) -> None:
    try:
        (Path(data_dir).expanduser() / RUNNING).write_text(f"{now:.0f}\n")
    except OSError:
        log.debug("alerts: could not write the running marker", exc_info=True)


def stopped(data_dir: Path) -> None:
    try:
        (Path(data_dir).expanduser() / RUNNING).unlink(missing_ok=True)
    except OSError:
        log.debug("alerts: could not remove the running marker", exc_info=True)


# -- events ---------------------------------------------------------------------------------------------------------
def backup_result(center, result: dict, folder: Path | None = None) -> None:
    """Backups.run_once's result: backup.ok, or backup.failed (the error says the folder by name only)."""
    if result.get("ok"):
        name = str(result.get("file") or "")
        try:
            got = size((Path(folder) / name).stat().st_size) if folder and name else "?"
        except OSError:
            got = "?"
        center.raise_("backup.ok", "", {"file": name, "size": got})
        center.clear("backup.failed", "", {"file": name})
        center.clear("backup.stale")
        return
    err = str(result.get("error") or "the backup didn't finish")
    if folder is not None:
        err = err.replace(str(folder), Path(folder).name or "the backup folder")
    center.raise_("backup.failed", "", {"error": err[:300]})


def tablet_alert(center, alert: Any, name: str) -> None:
    """hk_core.tablets.alerts.Alert from TabletWatch.check: already held by the tablets' own watch."""
    kid = f"tablet.{alert.kind}"
    if alert.up:
        center.raise_(kid, alert.tablet, {"name": name})
    else:
        center.clear(kid, alert.tablet)


# -- conditions -----------------------------------------------------------------------------------------------------
def set_to(center, kind: str, key: str, wrong: bool, facts: dict | None = None) -> None:
    if wrong:
        center.raise_(kind, key, facts)
    else:
        center.clear(kind, key, facts)


def disk(path: Path) -> tuple[float, float] | None:
    """(free bytes, free percent) of the disk holding ``path``, or None when it can't be read."""
    try:
        got = shutil.disk_usage(Path(path).expanduser())
    except OSError:
        return None
    return float(got.free), (100.0 * got.free / got.total) if got.total else 100.0


class Watch:
    """The once-every-WATCH look at the conditions. ``app`` is the server's aiohttp app."""

    def __init__(self, app, center, clock=time.time) -> None:
        self.app = app
        self.center = center
        self.clock = clock

    def look(self) -> None:
        for step in (self.home_assistant, self.music_assistant, self.mantel_link, self.protect, self.backups,
                     self.disks, self.credentials):
            try:
                step()
            except Exception:  # noqa: BLE001 -- one source never stops the rest
                log.exception("alerts: %s look failed", step.__name__)
        now = self.clock()
        if now - getattr(self, "beaten", -1e18) >= 300:      # the running marker: every 5 minutes is enough
            self.beaten = now
            beat(self.app["cfg"].data_dir, now)

    def home_assistant(self) -> None:
        hub = self.app.get("hub")
        ha = getattr(hub, "ha", None)
        conns = self.app.get("connections")
        set_up = bool(conns.ha_token()) if conns is not None else bool(getattr(ha, "_token", ""))
        if ha is None or not set_up or self.app.get("ha_task") is None:
            self.center.clear("ha.lost")
            return
        set_to(self.center, "ha.lost", "", not ha.connected.is_set())

    def music_assistant(self) -> None:
        ma = self.app.get("ma")
        set_to(self.center, "ma.lost", "", ma is not None and not ma.connected.is_set())

    def mantel_link(self) -> None:
        """Mantel Link not answering while Home Assistant is connected: only once it has been paired (a Mantel
        Link was seen since this start, or a `linked` credential exists)."""
        hub = self.app.get("hub")
        ha = getattr(hub, "ha", None)
        linked = self.app.get("linked")
        reg = getattr(linked, "registry", None)
        clients = [c for c in (getattr(reg, "clients", None) or []) if getattr(c, "domain", "") == "mantel"]
        live = any(not getattr(getattr(c, "ws", None), "closed", True) for c in clients)
        if live:
            self.seen_link = True
        paired = getattr(self, "seen_link", False) or self._link_paired()
        ha_up = ha is not None and ha.connected.is_set()
        set_to(self.center, "link.lost", "", paired and ha_up and not live)

    def _link_paired(self) -> bool:
        db = getattr(self.app.get("store"), "db", None)
        if db is None:
            return False
        try:
            row = db.execute("SELECT 1 FROM service_accounts WHERE revoked IS NULL AND scopes LIKE '%linked%' "
                             "LIMIT 1").fetchone()
        except Exception:  # noqa: BLE001 -- another schema: say nothing
            return False
        return row is not None

    def protect(self) -> None:
        """UniFi Protect (phase 13's connector, protect_connector.py): its events socket while it is set up, and a
        changed certificate (the connector stops until the Owner trusts the new one)."""
        p = self.app.get("protect")
        if p is None or not callable(getattr(p, "status", None)):
            return
        got = p.status() or {}
        cert = got.get("error_kind") == "certificate_changed"
        on = bool(got.get("runs")) and bool(got.get("set")) and not got.get("unreadable")
        set_to(self.center, "protect.cert", "", on and cert)
        lost = on and not cert and not (got.get("events") or {}).get("connected")
        set_to(self.center, "protect.lost", "", lost)

    def backups(self) -> None:
        b = self.app.get("backups")
        if b is None or not b.enabled:
            for k in ("backup.stale", "backup.target"):
                self.center.clear(k)
            return
        folder = Path(b.folder)
        problem = ""
        if not folder.is_dir():
            problem = f"The folder {folder.name or folder} is missing (is the NAS mounted?)."
        elif not os.access(folder, os.W_OK):
            problem = f"The folder {folder.name or folder} is read-only."
        set_to(self.center, "backup.target", "", bool(problem), {"problem": problem})
        newest = (b.status or {}).get("last_ok")
        if newest is None and not problem:
            try:
                first = next(iter(b.list()), None)
                newest = first.created.timestamp() if first is not None else None
            except Exception:  # noqa: BLE001
                newest = None
        started_at = self.center.started
        stale = (newest is None and self.clock() - started_at > STALE_AFTER) or \
            (newest is not None and self.clock() - newest > STALE_AFTER)
        set_to(self.center, "backup.stale", "", stale, {"when": when(newest)})

    def disks(self) -> None:
        cfg = self.app["cfg"]
        places = {"the data folder": Path(cfg.data_dir)}
        b = self.app.get("backups")
        if b is not None and b.enabled and Path(b.folder).is_dir():
            places["the backup folder"] = Path(b.folder)
        for name, path in places.items():
            got = disk(path)
            if got is None:
                continue
            free, pct = got
            low = pct < DISK_PERCENT or free < DISK_BYTES
            set_to(self.center, "disk.low", name, low, {"name": name, "free": size(free), "percent": f"{pct:.0f}"})

    def credentials(self) -> None:
        """token.expiring: a saved connection's credential that says when it expires (MA's last a year)."""
        conns = self.app.get("connections")
        expiring = getattr(conns, "expiring", None)
        if not callable(expiring):
            return
        now = self.clock()
        for kind, name, at in expiring():
            soon = at is not None and at - now < EXPIRING
            set_to(self.center, "token.expiring", kind, soon, {"name": name, "when": when(at)})


class PushWatch:
    """push.failing: the push relay or APNs refused five in a row (Pusher.deliver's results, all targets)."""

    LIMIT = 5

    def __init__(self, center) -> None:
        self.center = center
        self.row = 0

    def counts(self, counts: dict[str, int]) -> None:
        if counts.get("ok"):
            self.row = 0
            self.center.clear("push.failing")
            return
        self.row += counts.get("failed", 0)
        if self.row >= self.LIMIT:
            self.center.raise_("push.failing", "", {"count": self.row})


class SignInWatch:
    """signin.failures: ten failed sign-ins in ten minutes, said once per ten minutes."""

    LIMIT, WINDOW = 10, 600.0

    def __init__(self, center, clock=time.time) -> None:
        self.center = center
        self.clock = clock
        self.times: list[float] = []
        self.said = -1e18

    def failed(self) -> None:
        now = self.clock()
        self.times = [t for t in self.times if now - t < self.WINDOW] + [now]
        if len(self.times) >= self.LIMIT and now - self.said >= self.WINDOW:
            self.said = now
            self.center.raise_("signin.failures", "", {"count": len(self.times)})


# what config.changed says (the audit's config rows): a connection, a role or the Owner. Words only, never the row's
# detail (which may name an address).
CONFIG_WORDS = (("connection.ha.", "the Home Assistant connection"), ("connection.ma.", "the Music Assistant connection"),
                ("connection.protect.", "the UniFi Protect connection"), ("connection.", "a connection"),
                ("account.role", "a person's role"), ("rbac.", "a role's permissions"),
                ("linked.owner", "who owns a tablet"), ("accounts.owner", "the Owner"))


def config_changed(center, event: dict, name_of=None) -> None:
    action = str(event.get("action") or "")
    what = next((w for prefix, w in CONFIG_WORDS if action.startswith(prefix)), None)
    if what is None:
        return
    who = (name_of(event.get("actor")) if name_of else None) or ("Mantel" if not event.get("actor") else "someone")
    center.raise_("config.changed", action, {"what": what, "who": who})
