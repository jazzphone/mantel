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

ADMIN_COMMANDS = {"link", "unlink", "links", "session", "bootstrap"}


def bootstrap(store: Store, port: int) -> int:
    """Print a one-time setup code for the first Owner (only while no Owner exists). It replaces the one the
    server logged at start; the server logs no other until this one expires."""
    import time

    from .accounts import BOOTSTRAP_TTL, Accounts, PolicyError
    from .atrest import SecretBox
    try:
        token = Accounts(store.db, SecretBox(), time.time).issue_bootstrap_token()
    except PolicyError as exc:
        print(f"mantel-server: {exc}", file=sys.stderr)
        return 1
    base = f"http://127.0.0.1:{port}"
    print(f"One-time setup code (valid {BOOTSTRAP_TTL // 60} minutes; replaces any earlier one, the logged one too):"
          f"\n\n    {token}\n")
    print("Enter it on the sign-in page's \"First start\" (/login), or create the first Owner with POST /api/bootstrap:\n"
          f"  curl -X POST {base}/api/bootstrap -H 'Origin: {base}' -H 'Content-Type: application/json' \\\n"
          """       -d '{"token": "<token>", "username": "<name>", "name": "<display name>", "password": "<12+ chars>"}'""")
    return 0


def admin(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="mantel-server")
    p.add_argument("command", choices=sorted(ADMIN_COMMANDS))
    p.add_argument("--ha-user-id")
    p.add_argument("--role", choices=ROLES)
    p.add_argument("--name")
    p.add_argument("--data-dir", default=str(Config.data_dir))
    p.add_argument("--file", help="session: write the cookie value here (mode 0600) for tools/measure.py")
    p.add_argument("--port", type=int, default=Config.port, help="bootstrap: the port shown in the example")
    a = p.parse_args(argv)
    store = Store(Path(a.data_dir) / "mantel.db")
    if a.command == "bootstrap":
        return bootstrap(store, a.port)
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


def import_settings(argv: list[str]) -> int:
    """`mantel-server import-settings`: the one-time import of HK's settings from Home Assistant (P3.5).
    Reads `hk_frontend/panel/get` once over the read path; writes nothing to Home Assistant. It reaches HA
    as the server does (connections.ha_in_effect): the connection saved on Mantel Settings -> Connections,
    else --ha-url and the token in --token-file."""
    import asyncio

    from .connections import ConnectionFailed, ha_in_effect
    from .settings_store import import_cli
    p = argparse.ArgumentParser(prog="mantel-server import-settings")
    p.add_argument("--data-dir", default=str(Config.data_dir))
    p.add_argument("--ha-url", default=Config.ha_url)
    p.add_argument("--ha-ws-url", default="", help="Home Assistant's WebSocket API, when not derived from --ha-url")
    p.add_argument("--token-file", default=str(Config.token_file),
                   help="Mantel's HA token (an HA admin user's: HK Settings' read needs admin)")
    p.add_argument("--secrets-dir", default=str(Config.secrets_dir),
                   help="the server's secrets folder: its at_rest.key opens the connection saved on Connections")
    a = p.parse_args(argv)
    cfg = Config(ha_url=a.ha_url, ha_ws_url=a.ha_ws_url, token_file=Path(a.token_file), data_dir=Path(a.data_dir),
                 secrets_dir=Path(a.secrets_dir))
    try:
        cur = ha_in_effect(cfg)
    except ConnectionFailed as exc:
        print(f"mantel-server: {exc.message}", file=sys.stderr)
        return 2
    if cur is None or not cur.token:
        print(f"mantel-server: Home Assistant is not connected: connect it on Mantel Settings -> Connections, "
              f"or put Mantel's Home Assistant token in {a.token_file}", file=sys.stderr)
        return 2
    return asyncio.run(import_cli(a.data_dir, cur.url, cur.token, ws_url=cfg.ha_ws_url or None))


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "import-settings":
        return import_settings(argv[1:])
    if argv and argv[0] == "backup":
        from .backup import cli_backup
        return cli_backup(argv[1:])
    if argv and argv[0] == "restore":
        from .backup import cli_restore
        return cli_restore(argv[1:])
    if argv and argv[0] == "import-files":
        from .user_files import cli_import
        return cli_import(argv[1:])
    if argv and argv[0] == "files":
        from .user_files import cli_files
        return cli_files(argv[1:])
    if argv and argv[0] == "service-account":
        from .service_accounts import cli as service_cli
        return service_cli(argv[1:])
    if argv and argv[0] == "connect":
        from .connect_pairing import cli as connect_cli
        return connect_cli(argv[1:])
    if argv and argv[0] == "door-key":
        from .door_key import cli as door_key_cli
        return door_key_cli(argv[1:])
    if argv and argv[0] == "connect-proof":
        from .connect_proof import main as connect_main
        return connect_main(argv[1:])
    if argv and argv[0] in ADMIN_COMMANDS:
        return admin(argv)
    cfg = parse_args(argv)
    logging.basicConfig(level=getattr(logging, cfg.log_level.upper(), logging.INFO),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        token = read_token(cfg.token_file)
    except TokenMissing:
        if cfg.ha_managed_by_app:          # the App's credential is written by the entrypoint: it must be there
            print(f"mantel-server: the Home Assistant App credential file {cfg.token_file} is missing", file=sys.stderr)
            return 2
        token = ""                         # the Connections page (or a saved copy of Mantel's own) supplies it
    app = build_app(cfg, token)
    if not app["connections"].ha_token():
        print(f"mantel-server: Home Assistant is not connected yet. Sign in as the Owner and open "
              f"{cfg.base_url}settings#/mantel/connections to connect it.", flush=True)
    mode = ("COMMANDS ENABLED (roles and an audit row for every command; the Alarm PIN for the alarm)" if cfg.commands_enabled
            else "read-only; commands disabled")
    print(f"mantel-server: {cfg.base_url}login  (listening on {cfg.host}:{cfg.port}; {mode})", flush=True)
    if cfg.connect:
        import asyncio

        from .connect_pairing import serve
        print(f"mantel-server: Mantel Connect listens on {cfg.connect_listen}:{cfg.connect_port} (TLS, client certificates)",
              flush=True)
        asyncio.run(serve(app, cfg))
    elif cfg.direct_port:
        import asyncio

        from .direct import serve as serve_direct
        how = "HTTPS with Mantel's own certificate" if cfg.direct_tls else "plain HTTP behind your own proxy"
        print(f"mantel-server: direct access on {cfg.host}:{cfg.direct_port} for {cfg.public_url} ({how})", flush=True)
        asyncio.run(serve_direct(app, cfg))
    else:
        web.run_app(app, host=cfg.host, port=cfg.port, print=None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
