#!/usr/bin/env python3
"""Container entrypoint: detect where the image runs, then start ``python -m mantel_server`` (PLAN §8).

Stdlib only; it replaces itself with the server (exec), so the server is PID 1's process and gets signals.

Docker / Proxmox LXC (compose)   settings from MANTEL_* environment variables (none of them secret).
                                 Home Assistant and Music Assistant are normally set up after the first
                                 start on the admin page (/admin, Connections; connections.py), which keeps
                                 Mantel's own sealed copy on the data volume. A token FILE from the
                                 installation (default /run/secrets/ha_token) still works and is shown as
                                 "set by the installation"; an empty file counts as none.
    MANTEL_HA_URL          optional   http://homeassistant.local:8123 (with the ha_token file); else the page
    MANTEL_PUBLIC_URL      required   https://mantel.example.com/   (what browsers type; Caddy serves it)
    MANTEL_ALLOW_HOSTS     optional   comma list of further Host names, e.g. the LAN IP
    MANTEL_LISTEN          optional   default 0.0.0.0 (the container interface, behind Caddy only)
    MANTEL_PORT            optional   default 8765
    MANTEL_DATA_DIR        optional   default /data
    MANTEL_HA_TOKEN_FILE   optional   default /run/secrets/ha_token
    MANTEL_TRUSTED_PROXY   compose    Caddy's fixed backend address (172.31.251.2), comma list of IPs:
                                      passed as --trusted-proxy so Caddy's X-Mantel-Door: lan is believed
    MANTEL_DEFAULT_SCREEN, MANTEL_SESSION_HOURS   optional
    MANTEL_CONNECT         optional   1/yes turns on Mantel Connect (packaging/compose/compose.connect.yaml sets
                                      it): a second TLS listener on 8766 for the Connect App in HA's sidebar,
                                      pairing (`mantel connect pair`; /admin -> Connect), and the 'ha' door's rules
                                      (MANTEL_HA_DOOR_RULES, default trusted). MANTEL_CONNECT_ADDRESS is only
                                      what /admin shows the Owner to type into the App. docs/phase3/CONNECT.md.

Home Assistant App (add-on)      recognised by SUPERVISOR_TOKEN in the environment plus /data/options.json.
                                 The built-in App credential is HA's own SUPERVISOR_TOKEN: it is moved into a
                                 0600 file and removed from the environment, so the server and anything it
                                 spawns only ever see a file path, like every other mode. Options come from
                                 options.json (packaging/ha-app/config.yaml): commands_enabled (default
                                 false), log_level, default_screen, ha_door_rules, ma_url and ma_token (Music
                                 Assistant; the token, a masked option, is moved into a 0600 file like the App
                                 credential and only its path is passed; on /admin -> Connections these show
                                 as "set by the installation", and a connection saved there wins over them).
                                 The server is reached only
                                 through Ingress (--ingress --ingress-only: the signed-in HA user is believed
                                 only from the Supervisor's Ingress proxy, 172.30.32.2), and talks to HA Core
                                 through the Supervisor (ws://supervisor/core/websocket). docs/phase3/HA-APP.md.
    Test-only overrides (never set by the Supervisor; for running App mode against a scratch HA):
    MANTEL_APP_OPTIONS, MANTEL_APP_TOKEN_FILE, MANTEL_SUPERVISOR_CORE_URL, MANTEL_SUPERVISOR_WS_URL,
    MANTEL_INGRESS_PEER, MANTEL_LISTEN, MANTEL_PORT, MANTEL_DATA_DIR

Admin commands pass straight through and default to the /data volume (and, for import-settings, backup
and restore, to the container's HA address, token and secrets):
    docker compose exec mantel-server mantel links          (inside the running server: `mantel` is this
    docker compose exec mantel-server mantel bootstrap       entrypoint; `run` would start a second server
    docker compose exec mantel-server mantel import-settings on the same fixed backend address)
    docker compose exec mantel-server mantel service-account create --name linked --scope linked
    docker compose exec mantel-server mantel backup --target /backups
    docker compose exec mantel-server mantel files import-assets /imports/hk   (SF Pro + glyphs; OPERATIONS.md)
    docker compose stop mantel-server && docker compose run --rm --no-deps mantel-server restore <file>

    MANTEL_SECRETS_DIR     compose    /run/secrets (at_rest.key, backup.key)
    MANTEL_MA_URL          optional   Music Assistant's API (token: /run/secrets/ma_token); empty = off
    MANTEL_BACKUP_TARGET   optional   /backups (the host's backup folder, mounted) turns the nightly backup on
"""
from __future__ import annotations

import ipaddress
import json
import os
import sys
from pathlib import Path

ADMIN_COMMANDS = {"link", "unlink", "links", "session", "connect-proof", "connect", "bootstrap", "import-settings",
                  "service-account", "backup", "restore", "import-files", "files"}
# what each admin command takes besides --data-dir, filled from the container's own settings when absent
ADMIN_EXTRAS = {
    "import-settings": lambda env: ["--ha-url", env.get("MANTEL_HA_URL", ""),
                                    "--token-file", env.get("MANTEL_HA_TOKEN_FILE", "/run/secrets/ha_token")],
    "backup": lambda env: ["--secrets-dir", env.get("MANTEL_SECRETS_DIR", "/run/secrets")],
    "restore": lambda env: ["--secrets-dir", env.get("MANTEL_SECRETS_DIR", "/run/secrets")],
}
APP_OPTIONS = Path("/data/options.json")
APP_TOKEN_FILE = Path("/tmp/ha_token")
APP_MA_TOKEN_FILE = Path("/tmp/ma_token")       # the App's Music Assistant token (its masked option), 0600
SUPERVISOR_CORE_URL = "http://supervisor/core"
SUPERVISOR_WS_URL = "ws://supervisor/core/websocket"
APP_PORT = "8099"
LOG_LEVELS = ("debug", "info", "warning", "error")
DOOR_RULES = ("trusted", "lan", "tunnel")


class ConfigError(Exception):
    pass


def detect_mode(env: dict[str, str], options_path: Path = APP_OPTIONS) -> str:
    options_path = Path(env.get("MANTEL_APP_OPTIONS") or options_path)
    return "ha-app" if env.get("SUPERVISOR_TOKEN") and options_path.is_file() else "container"


def trusted_proxy_args(env: dict[str, str]) -> list[str]:
    """``--trusted-proxy`` for each address in MANTEL_TRUSTED_PROXY (compose: Caddy's fixed address on the
    backend network, 172.31.251.2). Mantel compares the socket peer's address exactly, so each entry must
    be an IP address (a service name would never match). Unset: none, and every request is the tunnel
    door (fail closed), which the startup warning below says."""
    out = []
    for raw in filter(None, (a.strip() for a in env.get("MANTEL_TRUSTED_PROXY", "").split(","))):
        try:
            out += ["--trusted-proxy", str(ipaddress.ip_address(raw))]
        except ValueError:
            raise ConfigError(f"MANTEL_TRUSTED_PROXY must list IP addresses (Caddy's backend address), not {raw!r}")
    if not out:
        print("mantel entrypoint: MANTEL_TRUSTED_PROXY is not set: no request is recognised as the LAN door "
              "(wall tablets will be refused)", file=sys.stderr)
    return out


def container_args(env: dict[str, str]) -> list[str]:
    missing = [k for k in ("MANTEL_PUBLIC_URL",) if not env.get(k)]
    if missing:
        raise ConfigError("missing " + ", ".join(missing) + " (set them in packaging/compose/.env)")
    # no MANTEL_HA_URL: Home Assistant is set up on the admin page (Connections); an empty address keeps
    # the server from ever trying a built-in default
    args = ["--ha-url", env.get("MANTEL_HA_URL", "").strip(),
            "--token-file", env.get("MANTEL_HA_TOKEN_FILE", "/run/secrets/ha_token"),
            "--data-dir", env.get("MANTEL_DATA_DIR", "/data"),
            "--port", env.get("MANTEL_PORT", "8765"),
            "--listen", env.get("MANTEL_LISTEN", "0.0.0.0"),
            "--public-url", env["MANTEL_PUBLIC_URL"]]
    for host in filter(None, (h.strip() for h in env.get("MANTEL_ALLOW_HOSTS", "").split(","))):
        args += ["--allow-host", host]
    args += trusted_proxy_args(env)
    # Docker secrets (compose): at_rest.key and backup.key are read from here
    args += ["--secrets-dir", env.get("MANTEL_SECRETS_DIR", "/run/secrets")]
    if env.get("MANTEL_MA_URL"):
        args += ["--ma-url", env["MANTEL_MA_URL"],
                 "--ma-token-file", env.get("MANTEL_MA_TOKEN_FILE", "/run/secrets/ma_token")]
    if env.get("MANTEL_BACKUP_TARGET"):
        args += ["--backup-target", env["MANTEL_BACKUP_TARGET"]]
    if env.get("MANTEL_DEFAULT_SCREEN"):
        args += ["--screen", env["MANTEL_DEFAULT_SCREEN"]]
    if env.get("MANTEL_SESSION_HOURS"):
        args += ["--session-hours", env["MANTEL_SESSION_HOURS"]]
    args += connect_args(env)
    return args


def connect_args(env: dict[str, str]) -> list[str]:
    """Mantel Connect (Mantel outside HA, reached by the Connect App): off unless MANTEL_CONNECT is yes."""
    if env.get("MANTEL_CONNECT", "").strip().lower() not in ("1", "yes", "true", "on"):
        return []
    rules = env.get("MANTEL_HA_DOOR_RULES", "trusted").strip().lower()
    if rules not in DOOR_RULES:
        raise ConfigError(f"MANTEL_HA_DOOR_RULES must be one of {', '.join(DOOR_RULES)}, not {rules!r}")
    args = ["--connect", "--connect-listen", env.get("MANTEL_CONNECT_LISTEN", "0.0.0.0"),
            "--connect-port", env.get("MANTEL_CONNECT_INTERNAL_PORT", "8766"), "--ha-door-rules", rules]
    if env.get("MANTEL_CONNECT_ADDRESS"):
        args += ["--connect-address", env["MANTEL_CONNECT_ADDRESS"]]
    return args


def app_args(options: dict, token_file: Path, env: dict[str, str] | None = None) -> list[str]:
    # HA Ingress is the only way in (no ports are published), so the Host name HA's proxy forwards is not
    # knowable here: '*' is accepted ONLY in this mode. The placeholder public URL is never used for
    # sign-in (Ingress identity replaces "Sign in with Home Assistant"); see docs/phase3/HA-APP.md.
    env = env or {}
    data = env.get("MANTEL_DATA_DIR", "/data")
    listen = env.get("MANTEL_LISTEN", "0.0.0.0")
    args = ["--ha-url", env.get("MANTEL_SUPERVISOR_CORE_URL", SUPERVISOR_CORE_URL),
            "--ha-ws-url", env.get("MANTEL_SUPERVISOR_WS_URL", SUPERVISOR_WS_URL),
            "--token-file", str(token_file), "--data-dir", data, "--secrets-dir", f"{data}/secrets",
            "--port", env.get("MANTEL_PORT", APP_PORT), "--listen", listen]
    if listen not in ("127.0.0.1", "::1"):
        args += ["--public-url", "https://ingress.invalid/", "--allow-host", "*"]
    args += ["--ingress", "--ingress-only", "--ha-managed-by-app"]   # HA is the App's credential (connections.py)
    for peer in filter(None, (p.strip() for p in env.get("MANTEL_INGRESS_PEER", "").split(","))):
        args += ["--ingress-peer", peer]
    # Commands stay OFF unless the App's option says exactly true (PLAN: off by default).
    if options.get("commands_enabled") is True:
        args.append("--commands-enabled")
    level = str(options.get("log_level") or "info").lower()
    args += ["--log-level", level if level in LOG_LEVELS else "info"]
    rules = str(options.get("ha_door_rules") or "trusted").lower()
    if rules not in DOOR_RULES:
        raise ConfigError(f"ha_door_rules must be one of {', '.join(DOOR_RULES)}, not {rules!r}")
    args += ["--ha-door-rules", rules]
    if options.get("default_screen"):
        args += ["--screen", str(options["default_screen"])]
    if options.get("session_hours"):
        args += ["--session-hours", str(options["session_hours"])]
    # Music Assistant (Phase 4, music.py): its address is an option; its token a masked option the caller
    # (plan) has already moved into a private file. Without both, Mantel's music engine stays off.
    ma_url = str(options.get("ma_url") or "").strip()
    ma_file = Path(env.get("MANTEL_APP_MA_TOKEN_FILE") or APP_MA_TOKEN_FILE)
    if ma_url and str(options.get("ma_token") or "").strip():
        args += ["--ma-url", ma_url, "--ma-token-file", str(ma_file)]
    return args


def write_private(path: Path, text: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)


def plan(argv: list[str], env: dict[str, str], options_path: Path = APP_OPTIONS,
         token_file: Path = APP_TOKEN_FILE) -> tuple[list[str], dict[str, str]]:
    """The command line (after ``python -m mantel_server``) and the environment to run it with."""
    env = dict(env)
    if argv and argv[0] in ADMIN_COMMANDS:
        extra = [] if "--data-dir" in argv or argv[0] == "connect-proof" else ["--data-dir", env.get("MANTEL_DATA_DIR", "/data")]
        given = ADMIN_EXTRAS.get(argv[0], lambda e: [])(env)
        for flag, value in zip(given[::2], given[1::2]):
            if flag not in argv and value:
                extra += [flag, value]
        return argv + extra, env
    if detect_mode(env, options_path) == "ha-app":
        options_path = Path(env.get("MANTEL_APP_OPTIONS") or options_path)
        token_file = Path(env.get("MANTEL_APP_TOKEN_FILE") or token_file)
        write_private(token_file, env.pop("SUPERVISOR_TOKEN"))
        options = json.loads(options_path.read_text())
        ma_file = Path(env.get("MANTEL_APP_MA_TOKEN_FILE") or APP_MA_TOKEN_FILE)
        ma_token = str(options.get("ma_token") or "").strip()
        if ma_token and str(options.get("ma_url") or "").strip():
            write_private(ma_file, ma_token)       # out of the options' way: the server only sees a file path
        return app_args(options, token_file, env) + argv, env
    return container_args(env) + argv, env


SERVER_UID = SERVER_GID = 10001


def drop_privileges(chown: list[Path]) -> None:
    """HA App only: it starts as root because Supervisor mounts /data root-owned. Hand /data and the token
    file to the server's user, then give up root for good before the server starts."""
    for path in chown:
        os.chown(path, SERVER_UID, SERVER_GID)
    os.setgroups([])
    os.setgid(SERVER_GID)
    os.setuid(SERVER_UID)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    try:
        args, env = plan(argv, dict(os.environ))
    except ConfigError as exc:
        print(f"mantel entrypoint: {exc}", file=sys.stderr)
        return 2
    if os.getuid() == 0:
        drop_privileges([Path(env.get("MANTEL_DATA_DIR", "/data"))]
                        + [f for f in (APP_TOKEN_FILE, APP_MA_TOKEN_FILE) if f.exists()])
    os.execve(sys.executable, [sys.executable, "-m", "mantel_server", *args], env)
    return 0  # not reached


if __name__ == "__main__":
    sys.exit(main())
