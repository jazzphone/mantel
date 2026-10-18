from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from aiohttp import web

from .config import Config, parse_args
from .ha_client import TokenMissing, read_token
from .server import build_app
from .store import ROLES, Store

ADMIN_COMMANDS = {"link", "unlink", "links", "session"}


def admin(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="mantel-server")
    p.add_argument("command", choices=sorted(ADMIN_COMMANDS))
    p.add_argument("--ha-user-id")
    p.add_argument("--role", choices=ROLES)
    p.add_argument("--name")
    p.add_argument("--data-dir", default=str(Config.data_dir))
    p.add_argument("--file", help="session: write the cookie value here (mode 0600) for tools/measure.py")
    a = p.parse_args(argv)
    store = Store(Path(a.data_dir) / "mantel.db")
    if a.command == "links":
        for row in store.list_links():
            print(f"{row['ha_user_id']}  {row['role']:<11} {row['name'] or ''}")
        return 0
    if not a.ha_user_id:
        p.error("--ha-user-id is required")
    if a.command == "link":
        if not a.role:
            p.error("--role is required")
        store.link(a.ha_user_id, a.role, a.name)
        print(f"linked HA user {a.ha_user_id} -> {a.role}")
    elif a.command == "unlink":
        print("unlinked" if store.unlink(a.ha_user_id) else "no such link")
    else:  # session
        if not a.file or store.get_link(a.ha_user_id) is None:
            p.error("session needs --file and an already linked --ha-user-id")
        sid = store.create_session(a.ha_user_id, 12 * 3600)
        fd = os.open(a.file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(sid)
        print(f"wrote a 12 h session cookie value to {a.file}")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "connect-proof":
        from .connect_proof import main as connect_main
        return connect_main(argv[1:])
    if argv and argv[0] in ADMIN_COMMANDS:
        return admin(argv)
    cfg = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        token = read_token(cfg.token_file)
    except TokenMissing as exc:
        print(f"mantel-server: {exc}\nCreate a long-lived access token in Home Assistant and save it there (chmod 600).",
              file=sys.stderr)
        return 2
    app = build_app(cfg, token)
    print(f"mantel-server: http://{cfg.host}:{cfg.port}/login  (read-only; commands disabled)")
    web.run_app(app, host=cfg.host, port=cfg.port, print=None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
