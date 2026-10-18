"""/healthz and /api/version: liveness for the container healthcheck, and the build id open screens poll.

register(app, hub) adds both routes. Neither returns a secret, a user, an entity or an address: only
whether the process is alive, whether the upstream Home Assistant link is up, and which build this is.

* ``/healthz`` answers 200 whenever the event loop is serving. A lost HA link is reported in the body
  (``status: degraded``) but does not fail the probe: restarting the container cannot repair Home
  Assistant, and a restart loop would hide the real problem. ``?strict=1`` answers 503 when degraded,
  for an external monitor.
* ``/api/version`` is the build id (``BUILD_ID`` at the repo/image root, written by
  ``tools/build_static.py``) so an open screen can notice a new build and reload at a quiet moment.

Both are exempt from sign-in (the probe has no session). Caddy does not forward ``/healthz`` from outside
(packaging/compose/Caddyfile); only the in-container probe, ``python -m mantel_server.health``, uses it.

    python -m mantel_server.health [--port 8765] [--timeout 3]   # exit 0 healthy, 1 not
"""
from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request

from aiohttp import web

from .config import REPO

PUBLIC_PATHS = ("/healthz", "/api/version")
_STARTED = time.monotonic()


def build_id() -> str:
    """The build id baked into the image, or 'dev' when running from a checkout."""
    try:
        text = (REPO / "BUILD_ID").read_text().strip()
    except OSError:
        return "dev"
    return text if text and len(text) <= 64 and text.isascii() and text.replace("-", "").replace("_", "").isalnum() else "dev"


def status(hub, now: float | None = None) -> dict:
    ha = getattr(hub, "ha", None)
    since = getattr(ha, "connected_since", None)
    connected = since is not None
    now = time.time() if now is None else now
    return {
        "status": "ok" if connected else "degraded",
        "uptime_s": round(time.monotonic() - _STARTED, 1),
        "build": build_id(),
        "upstream": {"home_assistant": {"connected": connected,
                                        "connected_for_s": round(max(0.0, now - since), 1) if connected else None}},
    }


def register(app: web.Application, hub) -> None:
    async def healthz(request: web.Request) -> web.Response:
        body = status(hub)
        code = 503 if request.query.get("strict") == "1" and body["status"] != "ok" else 200
        return web.json_response(body, status=code, headers={"Cache-Control": "no-store"})

    async def version(request: web.Request) -> web.Response:
        return web.json_response({"build": build_id()}, headers={"Cache-Control": "no-store"})

    app.router.add_get("/healthz", healthz)
    app.router.add_get("/api/version", version)
    # The sign-in middleware (auth.require_session) lets these through; if the accounts slice moves
    # that list, it must keep PUBLIC_PATHS above exempt.
    from . import auth
    exempt = getattr(auth, "PUBLIC_PATHS", None)
    if isinstance(exempt, set):
        exempt.update(PUBLIC_PATHS)


def probe(port: int, timeout: float = 3.0) -> int:
    """HEALTHCHECK entry: GET http://127.0.0.1:<port>/healthz; 0 if it answers 200, else 1."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=timeout) as r:  # noqa: S310 (fixed loopback URL)
            return 0 if r.status == 200 else 1
    except (urllib.error.URLError, OSError, ValueError):
        return 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m mantel_server.health")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--timeout", type=float, default=3.0)
    a = p.parse_args(argv)
    return probe(a.port, a.timeout)


if __name__ == "__main__":
    sys.exit(main())
