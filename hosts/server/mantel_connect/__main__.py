"""Start the Mantel Connect App: ``python -m mantel_connect`` (the App's Dockerfile CMD).

The Supervisor mounts /data root-owned, so the App starts as root only to hand its own data folder to
uid 10001 and then drops root for good, before it serves anything. Settings are the App's options
(/data/options.json, a file); nothing secret is read from the environment, and there is none to read.

Test-only overrides (never set by the Supervisor): MANTEL_CONNECT_OPTIONS, MANTEL_CONNECT_DATA,
MANTEL_CONNECT_INGRESS_PEER (comma list), MANTEL_CONNECT_PORT, MANTEL_CONNECT_LISTEN.
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from aiohttp import web

from .app import SUPERVISOR, build_app, read_options

UID = GID = 10001


def drop_privileges(folder: Path) -> None:
    os.chown(folder, UID, GID)
    for child in folder.iterdir():
        os.chown(child, UID, GID)
    os.setgroups([])
    os.setgid(GID)
    os.setuid(UID)


def main(argv: list[str] | None = None) -> int:
    env = os.environ
    options = read_options(Path(env.get("MANTEL_CONNECT_OPTIONS", "/data/options.json")))
    folder = Path(env.get("MANTEL_CONNECT_DATA", "/data/connect"))
    folder.mkdir(parents=True, exist_ok=True)
    folder.chmod(0o700)
    if os.getuid() == 0:
        drop_privileges(folder)
    level = str(options.get("log_level") or "info").upper()
    logging.basicConfig(level=getattr(logging, level, logging.INFO),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    peers = tuple(p.strip() for p in env.get("MANTEL_CONNECT_INGRESS_PEER", "").split(",") if p.strip()) or (SUPERVISOR,)
    app = build_app(folder, options, peers)
    # Access logs would hold the sensitive Ingress URL: none.
    web.run_app(app, host=env.get("MANTEL_CONNECT_LISTEN", "0.0.0.0"), port=int(env.get("MANTEL_CONNECT_PORT", "8099")),
                access_log=None, print=None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
