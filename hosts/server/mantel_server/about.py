"""Mantel Settings -> About: which Mantel this is, and what it is talking to (``GET /api/about``).

For any signed-in person (nothing here is a secret, an address, a user or an entity): the product's version
and build, how it is installed and since when it runs, and the versions of what it connects to (Home Assistant,
Music Assistant, the integrations linked in Home Assistant). Read on every request; nothing is stored.

* **The version** comes from ``RELEASE.json`` at the image root, written by ``tools/stage_ha_app.py`` (the App's
  ``version`` from packaging/ha-app/config.yaml, the commit, the build id, when it was staged). In a checkout
  without it, the App's config.yaml says the version and the commit is ``dev``.
"""
from __future__ import annotations

import json
import platform
import re
import time
from typing import Any

from aiohttp import web

from .config import REPO

RELEASE = "RELEASE.json"
PATH = "/api/about"
_STARTED = time.time()
_VERSION = re.compile(r'^version:\s*"?([0-9A-Za-z.+-]{1,32})"?\s*$', re.M)


def release() -> dict[str, Any]:
    """{version, commit, build, staged}: the image's own, or the checkout's."""
    from .health import build_id
    try:
        got = json.loads((REPO / RELEASE).read_text())
        if isinstance(got, dict) and isinstance(got.get("version"), str):
            return {"version": got["version"][:32], "commit": str(got.get("commit") or "")[:40] or None,
                    "build": build_id(), "staged": got.get("staged")}
    except (OSError, ValueError):
        pass
    version = None
    try:
        m = _VERSION.search((REPO / "packaging/ha-app/config.yaml").read_text())
        version = m.group(1) if m else None
    except OSError:
        pass
    return {"version": version, "commit": "dev", "build": build_id(), "staged": None}


def install_kind(cfg: Any) -> str:
    """How this Mantel runs: the Home Assistant App, or a container of its own (Docker, the Proxmox LXC)."""
    return "Home Assistant App" if getattr(cfg, "supervisor_url", "") or \
        str(getattr(cfg, "ha_url", "")).startswith("http://supervisor/") else "Container"


def about(app: web.Application, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    hub, cfg = app.get("hub"), app.get("cfg")
    ha = getattr(hub, "ha", None)
    ma = app.get("ma")
    info = getattr(ma, "server_info", None) if ma is not None else None
    linked = app.get("linked")
    clients = []
    for c in sorted(getattr(getattr(linked, "registry", None), "clients", None) or [], key=lambda c: c.domain):
        if getattr(getattr(c, "ws", None), "closed", True):
            continue
        clients.append({"name": "Mantel Link" if c.domain == "mantel" else "HK Frontend" if c.domain == "hk_frontend"
                        else c.domain, "protocol": c.protocol, "since": c.since})
    return {
        "product": "Mantel",
        **release(),
        "install": install_kind(cfg),
        "started": _STARTED, "uptime_s": round(max(0.0, now - _STARTED)),
        "python": platform.python_version(),
        "home_assistant": {"version": getattr(ha, "ha_version", None),
                           "connected": getattr(ha, "connected_since", None) is not None},
        "music_assistant": {"version": info.get("server_version") if isinstance(info, dict) else None,
                            "configured": ma is not None},
        "linked": clients,
        "commands": bool(getattr(cfg, "commands_enabled", False)),
        "docs": "/docs",
    }


async def api_about(request: web.Request) -> web.Response:
    from .sessions import identity
    if identity(request).user is None and identity(request).device is None:
        raise web.HTTPForbidden(text='{"error":"forbidden"}', content_type="application/json")
    return web.json_response(about(request.app), headers={"Cache-Control": "no-store"})


def register(app: web.Application) -> None:
    app.router.add_get(PATH, api_about)
