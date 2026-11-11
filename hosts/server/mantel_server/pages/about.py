"""Mantel Settings -> About: which Mantel this is, and what it is talking to (``GET /api/about``).

For any signed-in person (nothing here is a secret, an address, a user or an entity): the product's version
and build, how it is installed and since when it runs, and the versions of what it connects to (Home Assistant,
Music Assistant, the integrations linked in Home Assistant). Read on every request; nothing is stored.

* **The version** comes from ``RELEASE.json`` at the image root, written by ``tools/stage_ha_app.py`` (the App's
  ``version`` from packaging/ha-app/config.yaml, the commit, the build id, when it was staged). In a checkout
  without it, the App's config.yaml says the version and the commit is ``dev``.

SECURE CONNECTION (2026-11-02, docs/phase13/CAMERAS-DIRECT.md "The HTTPS check"): a browser gives the microphone only
to a secure page, so talking at the door needs HTTPS. ``/api/about`` says how browsers reach this Mantel
(``access.mode``, one of ``MODES``) and the public address it was told (``access.public_url``, empty when there is
none; it is the address people already type, not a secret; ``access.at_address``, true when that address is an IP
address, Docker's and the LXC's start before ``mantel-setup`` gives Mantel a name, which Set Up Mantel's "Address and
HTTPS" step (setup_guide.py) explains and the page points to rather than saying again), and each screen works out for itself whether it is a
secure context. ``GET /api/about/secure`` (an Owner or Admin, never a wall tablet's session) adds the wall tablets
whose pages said, in their ``load`` and ``beat`` frames (page_health.py), that they are not: their names and
addresses are for the people who manage the house, so they are not in ``/api/about``.
"""
from __future__ import annotations

import json
import platform
import re
import time
from typing import Any

from aiohttp import web

from . import setup_guide
from ..config import REPO
from ..identity.guards import guard

RELEASE = "RELEASE.json"
PATH = "/api/about"
SECURE_PATH = "/api/about/secure"
# how browsers reach Mantel, for the Secure Connection row: Mantel's own HTTPS (the App's direct access with
# direct_tls "acme"), the home's own proxy in front of it (Caddy in the compose stack, or the App's direct access on
# plain HTTP), Home Assistant's sidebar (Ingress: HA's own scheme and certificate), or plain HTTP
MODES = ("builtin_https", "proxy", "ha_sidebar", "http")
_STARTED = time.time()
_VERSION = re.compile(r'^version:\s*"?([0-9A-Za-z.+-]{1,32})"?\s*$', re.M)


def release() -> dict[str, Any]:
    """{version, commit, build, staged}: the image's own, or the checkout's."""
    from ..health import build_id
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


def access_mode(cfg: Any) -> str:
    """How browsers reach this Mantel (``MODES``), from the same settings ``__main__`` describes them by.

    The HA App's direct access (``direct_port``) is the address a tablet should use, so it names the mode even though
    the sidebar works too; without it the App is only its sidebar. A container is behind a proxy exactly when it was
    given an https public address (parse_args refuses a non-loopback listener without one), else plain HTTP."""
    if getattr(cfg, "direct_port", 0):
        return "builtin_https" if getattr(cfg, "direct_tls", "") == "acme" else "proxy"
    if install_kind(cfg) == "Home Assistant App" or getattr(cfg, "connect", False):
        return "ha_sidebar"
    return "proxy" if str(getattr(cfg, "public_url", "")).startswith("https://") else "http"


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
        "access": {"mode": access_mode(cfg), "public_url": str(getattr(cfg, "public_url", "") or ""),
                   "at_address": install_kind(cfg) == "Container" and setup_guide.address_host(cfg)[1]},
        "docs": "/docs",
    }


def insecure_tablets(app: web.Application, now: float | None = None) -> list[dict[str, Any]]:
    """The enrolled wall tablets whose latest report (page_health.RING, the last 24 hours) says their page is not a
    secure context: ``{name, origin, last_seen}``, by name. A tablet that is revoked or forgotten is left out, and so
    is one that never said (a page from before the report)."""
    from . import page_health
    mgr = app.get("devices")
    out = []
    for r in page_health.RING.secure_reports(now):
        row = mgr.get(r["id"]) if mgr is not None else None
        if row is None or row["revoked"] is not None or r["secure"]:
            continue
        out.append({"name": row["name"], "origin": r["origin"], "last_seen": r["last_seen"]})
    return sorted(out, key=lambda t: t["name"].lower())


@guard("signed_in", reads="none",
       why="the version, uptime and connections of Mantel: no entity, camera, speaker or photo")
async def api_about(request: web.Request) -> web.Response:
    return web.json_response(about(request.app), headers={"Cache-Control": "no-store"})


@guard("manager", reads="admin")
async def api_about_secure(request: web.Request) -> web.Response:
    now = time.time()
    return web.json_response({"now": now, "tablets": insecure_tablets(request.app, now)}, headers={"Cache-Control": "no-store"})


def register(app: web.Application) -> None:
    app.router.add_get(PATH, api_about)
    app.router.add_get(SECURE_PATH, api_about_secure)
