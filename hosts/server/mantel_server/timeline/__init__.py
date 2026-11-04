"""The House Timeline (docs/phase19/HOUSE-TIMELINE.md): what happened at the house.

* ``core.py``: the state tap, the queue and its writer, the rollups, catching up, who did it, System and Refused rows;
* ``store.py``: the tables (migration 0033);
* ``protect.py``: UniFi Protect's events, and which of Home Assistant's detection entities they speak for;
* ``pictures.py``: the filmstrip, kept on disk, its budget, the serve route;
* ``api.py``: the REST and the live feed, filtered by the viewer's roles;
* ``digest.py``: the morning digest (the house version to the alert channels, the personal one to the apps).

What to record is ``hk_core/timeline`` (classify, words, digest): the host only follows, stores and serves.
"""
from __future__ import annotations

import logging
from typing import Any

from aiohttp import web

from .core import Timeline

log = logging.getLogger("mantel.timeline")


def register(app: web.Application, hub: Any) -> Timeline:
    cfg = app["cfg"]
    folder = getattr(cfg, "data_dir", None)
    tl = Timeline(app, hub, app["store"].db, clock=lambda: app["clock"](),
                  folder=(folder / "timeline") if folder is not None else None)
    app["timeline"] = tl
    hub.taps.append(tl.tap)
    # the registries reloaded: the catalog's members again (after the hub's own on_registry, through HaClient's)
    ha = getattr(hub, "ha", None)
    if ha is not None:
        first = ha.on_registry

        def on_registry() -> None:
            if first is not None:
                first()
            try:
                tl.refresh()
            except Exception:  # noqa: BLE001
                log.exception("timeline: working out what to record failed")
        ha.on_registry = on_registry
    audit_log = app.get("audit")
    if audit_log is not None and hasattr(audit_log, "commands"):
        audit_log.commands.append(tl.on_command)
    backups = app.get("backups")
    if backups is not None and hasattr(backups, "timeline_pictures"):
        backups.timeline_pictures = lambda: tl.settings.get("backup_pictures") is True
    alerts = app.get("alerts")
    if alerts is not None:
        alerts.center.listeners.append(tl.on_alert)
    try:
        from . import protect
        protect.register(app, tl)
    except ImportError:
        pass
    try:
        from . import pictures
        pictures.register(app, tl)
    except ImportError:
        pass
    try:
        from . import api
        api.register(app, tl)
    except ImportError:
        pass
    try:
        from . import digest
        digest.register(app, tl)
    except ImportError:
        pass

    async def start(_app: web.Application) -> None:
        await tl.start()

    async def stop(_app: web.Application) -> None:
        await tl.stop()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return tl


__all__ = ["Timeline", "register"]
