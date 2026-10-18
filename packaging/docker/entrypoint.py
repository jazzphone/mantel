#!/usr/bin/env python3
"""Container entrypoint: detect where the image runs, then start ``python -m mantel_server`` (PLAN §8).

Stdlib only; it replaces itself with the server (exec), so the server is PID 1's process and gets signals.

Docker / Proxmox LXC (compose)   settings from MANTEL_* environment variables (none of them secret),
                                 the Home Assistant token from a FILE (default /run/secrets/ha_token).
    MANTEL_HA_URL          required   http://homeassistant.local:8123
    MANTEL_PUBLIC_URL      required   https://mantel.example.com/   (what browsers type; Caddy serves it)
    MANTEL_ALLOW_HOSTS     optional   comma list of further Host names, e.g. the LAN IP
    MANTEL_LISTEN          optional   default 0.0.0.0 (the container interface, behind Caddy only)
    MANTEL_PORT            optional   default 8765
    MANTEL_DATA_DIR        optional   default /data
    MANTEL_HA_TOKEN_FILE   optional   default /run/secrets/ha_token
    MANTEL_TRUSTED_PROXY   compose    Caddy's fixed backend address (172.31.251.2), comma list of IPs:
                                      passed as --trusted-proxy so Caddy's X-Mantel-Door: lan is believed
    MANTEL_DEFAULT_SCREEN, MANTEL_SESSION_HOURS   optional

Home Assistant App (add-on)      recognised by SUPERVISOR_TOKEN in the environment plus /data/options.json.
                                 The built-in App credential is HA's own SUPERVISOR_TOKEN: it is moved into a
                                 0600 file and removed from the environment, so the server and anything it
                                 spawns only ever see a file path, like every other mode. Options come from
                                 options.json. The server is reached only through Ingress.

Admin commands pass straight through and default to the /data volume:
    docker compose run --rm mantel-server links
"""
from __future__ import annotations

import ipaddress
import json
import os
import sys
from pathlib import Path

ADMIN_COMMANDS = {"link", "unlink", "links", "session", "connect-proof"}
APP_OPTIONS = Path("/data/options.json")
APP_TOKEN_FILE = Path("/tmp/ha_token")
SUPERVISOR_CORE_URL = "http://supervisor/core"


class ConfigError(Exception):
    pass


def detect_mode(env: dict[str, str], options_path: Path = APP_OPTIONS) -> str:
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
    missing = [k for k in ("MANTEL_HA_URL", "MANTEL_PUBLIC_URL") if not env.get(k)]
    if missing:
        raise ConfigError("missing " + ", ".join(missing) + " (set them in packaging/compose/.env)")
    args = ["--ha-url", env["MANTEL_HA_URL"],
            "--token-file", env.get("MANTEL_HA_TOKEN_FILE", "/run/secrets/ha_token"),
            "--data-dir", env.get("MANTEL_DATA_DIR", "/data"),
            "--port", env.get("MANTEL_PORT", "8765"),
            "--listen", env.get("MANTEL_LISTEN", "0.0.0.0"),
            "--public-url", env["MANTEL_PUBLIC_URL"]]
    for host in filter(None, (h.strip() for h in env.get("MANTEL_ALLOW_HOSTS", "").split(","))):
        args += ["--allow-host", host]
    args += trusted_proxy_args(env)
    if env.get("MANTEL_DEFAULT_SCREEN"):
        args += ["--screen", env["MANTEL_DEFAULT_SCREEN"]]
    if env.get("MANTEL_SESSION_HOURS"):
        args += ["--session-hours", env["MANTEL_SESSION_HOURS"]]
    return args


def app_args(options: dict, token_file: Path) -> list[str]:
    # HA Ingress is the only way in (no ports are published), so the Host name HA's proxy forwards is not
    # knowable here: '*' is accepted ONLY in this mode. The placeholder public URL is never used for
    # sign-in (Ingress identity replaces "Sign in with Home Assistant"); see docs/phase3/PACKAGING.md.
    args = ["--ha-url", SUPERVISOR_CORE_URL, "--token-file", str(token_file), "--data-dir", "/data",
            "--port", "8099", "--listen", "0.0.0.0",
            "--public-url", "https://ingress.invalid/", "--allow-host", "*"]
    if options.get("default_screen"):
        args += ["--screen", str(options["default_screen"])]
    if options.get("session_hours"):
        args += ["--session-hours", str(options["session_hours"])]
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
        return argv + extra, env
    if detect_mode(env, options_path) == "ha-app":
        write_private(token_file, env.pop("SUPERVISOR_TOKEN"))
        return app_args(json.loads(options_path.read_text()), token_file) + argv, env
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
        drop_privileges([Path(env.get("MANTEL_DATA_DIR", "/data"))] + ([APP_TOKEN_FILE] if APP_TOKEN_FILE.exists() else []))
    os.execve(sys.executable, [sys.executable, "-m", "mantel_server", *args], env)
    return 0  # not reached


if __name__ == "__main__":
    sys.exit(main())
