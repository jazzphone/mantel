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
    MANTEL_PUBLIC_URL      required   https://mantel.example.com/   (what browsers type; Caddy serves it);
                                      its host name is also the passkeys' RP ID (--rp-id; not for an IP)
    MANTEL_ALLOW_HOSTS     optional   comma list of further Host names, e.g. the LAN IP
    MANTEL_LISTEN          optional   default 0.0.0.0 (the container interface, behind Caddy only)
    MANTEL_PORT            optional   default 8765
    MANTEL_DATA_DIR        optional   default /data
    MANTEL_HA_TOKEN_FILE   optional   default /run/secrets/ha_token
    MANTEL_TRUSTED_PROXY   compose    Caddy's fixed backend address (172.31.251.2), comma list of IPs:
                                      passed as --trusted-proxy so Caddy's X-Mantel-Door: lan is believed
    MANTEL_DEFAULT_SCREEN, MANTEL_SESSION_HOURS   optional, the first start's values (Mantel Settings, General)
    MANTEL_READ_ONLY       optional   1/yes: the house stays read-only whatever Mantel Settings says (the kill switch)
    MANTEL_CONNECT         optional   1/yes turns on Mantel Connect (packaging/compose/compose.connect.yaml sets
                                      it): a second TLS listener on 8766 for the Connect App in HA's sidebar,
                                      pairing (`mantel connect pair`; /admin -> Connect), and the 'ha' door's rules
                                      (MANTEL_HA_DOOR_RULES, default trusted). MANTEL_CONNECT_ADDRESS is only
                                      what /admin shows the Owner to type into the App. docs/phase3/CONNECT.md.
    MANTEL_ANNOUNCE        optional   default on: write <data>/announce.json (no secret) for compose's `announce`
                                      service, which advertises Mantel by zeroconf (_mantel._tcp) so Home
                                      Assistant's Mantel Link offers "Discovered: Mantel"; 0/no turns it off.
                                      docs/phase9/MANTEL-LINK.md.

Home Assistant App (add-on)      recognised by SUPERVISOR_TOKEN in the environment plus /data/options.json.
                                 The built-in App credential is HA's own SUPERVISOR_TOKEN: it is moved into a
                                 0600 file and removed from the environment, so the server and anything it
                                 spawns only ever see a file path, like every other mode. Options come from
                                 options.json (packaging/ha-app/config.yaml): log_level, read_only (the kill
                                 switch) and direct access below. The older options commands_enabled,
                                 default_screen, session_hours, ha_door_rules, ma_url and ma_token,
                                 ha_sign_in_url and ha_frame_origins are passed as first-start values only:
                                 Mantel copies each once into Mantel Settings, which keeps them from then on
                                 (server_settings.py; the token, a masked option, is moved into a 0600 file
                                 like the App credential and only its path is passed).
                                 The sidebar page is always
                                 Ingress (--ingress --ingress-only: the signed-in HA user is believed only from
                                 the Supervisor's Ingress proxy, 172.30.32.2), and Mantel talks to HA Core
                                 through the Supervisor (ws://supervisor/core/websocket). docs/phase3/HA-APP.md.
                                 Direct access (decision 26), the option `access`:
                                   ingress  (default) nothing else; the App's port 8100 is not listened on
                                   proxy    plain HTTP on 8100 for the home's own proxy: public_url, the
                                            proxy's address(es) in trusted_proxies, and the door key
                                   https    HTTPS on 8100 with Mantel's own Let's Encrypt certificate (DNS-01
                                            through dns_provider: cloudflare, the default, or duckdns):
                                            public_url and cloudflare_token or duckdns_token (masked options;
                                            only the chosen one is moved into a 0600 file like the others);
                                            acme_email, acme_staging optional
                                 "Sign in with Home Assistant" works there; Mantel's own side of it goes to
                                 http://homeassistant:8123, the browser to Mantel Settings' Sign-In Address or
                                 HA's own External URL.
                                 cf_access_team and cf_access_aud: Cloudflare Access in front of a tunnel to
                                 the direct port (Mantel then checks Access's assertion on the tunnel door).
                                 Mantel Link's discovery: the App announces Mantel to the Supervisor
                                 (--supervisor-url http://supervisor; config.yaml discovery + hassio_api).
    Test-only overrides (never set by the Supervisor; for running App mode against a scratch HA):
    MANTEL_APP_OPTIONS, MANTEL_APP_TOKEN_FILE, MANTEL_SUPERVISOR_CORE_URL, MANTEL_SUPERVISOR_WS_URL,
    MANTEL_INGRESS_PEER, MANTEL_HA_CORE_PEER, MANTEL_LISTEN, MANTEL_PORT, MANTEL_DATA_DIR,
    MANTEL_DIRECT_PORT, MANTEL_HA_OAUTH_URL, MANTEL_APP_CF_TOKEN_FILE, MANTEL_SUPERVISOR_URL

Admin commands pass straight through and default to the /data volume (and, for import-settings, backup
and restore, to the container's HA address, token and secrets; import-settings uses the Home Assistant
connection saved on Mantel Settings -> Connections when there is one, as the server does):
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
    MANTEL_GO2RTC_URL      compose    http://go2rtc:1984: Live TV served by Mantel through the stack's own go2rtc
                                      (its viewing paths also served to pages under /go2rtc/)
    MANTEL_LIVE_TV_HARDWARE optional  vaapi (compose.gpu.yaml sets it): the QuickSync transcode templates
    MANTEL_MA_WEB_URL      optional   Music Assistant's web app (default: the host of MANTEL_MA_URL), served under /ma/
    MANTEL_FRAME_ANCESTORS optional   origins (besides Mantel itself) that may frame Mantel's pages
    MANTEL_CONNECT_SRC, MANTEL_FRAME_SRC   optional   extra CSP origins for HK's pages
    MANTEL_PROXY_KIND      compose    caddy | own (bring your own proxy): tunes /proxy-check's advice
    MANTEL_CF_ACCESS_TEAM, MANTEL_CF_ACCESS_AUD   optional   Cloudflare Access in front of the tunnel: the Zero
                                      Trust team name (myteam) and the Access application's AUD tag(s), comma
                                      list. Set both and every tunnel-door request must carry a valid Access
                                      assertion (mantel_server/cf_access.py); the HA App's options
                                      cf_access_team / cf_access_aud do the same there. Neither is a secret.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import sys
from pathlib import Path

ADMIN_COMMANDS = {"link", "unlink", "links", "session", "connect-proof", "connect", "bootstrap", "import-settings",
                  "service-account", "backup", "restore", "import-files", "files", "door-key"}
# what each admin command takes besides --data-dir, filled from the container's own settings when absent
ADMIN_EXTRAS = {
    "import-settings": lambda env: ["--ha-url", env.get("MANTEL_HA_URL", ""),
                                    "--token-file", env.get("MANTEL_HA_TOKEN_FILE", "/run/secrets/ha_token"),
                                    # the at-rest key that opens the connection saved on Mantel Settings -> Connections
                                    "--secrets-dir", env.get("MANTEL_SECRETS_DIR", "/run/secrets")],
    "backup": lambda env: ["--secrets-dir", env.get("MANTEL_SECRETS_DIR", "/run/secrets")],
    "restore": lambda env: ["--secrets-dir", env.get("MANTEL_SECRETS_DIR", "/run/secrets")],
    "door-key": lambda env: ["--secrets-dir", env.get("MANTEL_SECRETS_DIR", "/run/secrets")],
}
APP_OPTIONS = Path("/data/options.json")
APP_TOKEN_FILE = Path("/tmp/ha_token")
APP_MA_TOKEN_FILE = Path("/tmp/ma_token")       # the App's Music Assistant token (its masked option), 0600
APP_CF_TOKEN_FILE = Path("/tmp/cloudflare_token")   # built-in HTTPS: the Cloudflare DNS token (masked), 0600
APP_DUCKDNS_TOKEN_FILE = Path("/tmp/duckdns_token")  # built-in HTTPS through Duck DNS: its token (masked), 0600
SUPERVISOR_CORE_URL = "http://supervisor/core"
SUPERVISOR_WS_URL = "ws://supervisor/core/websocket"
APP_PORT = "8099"
DIRECT_PORT = "8100"                # direct access (config.yaml `ports`: 8100/tcp, mapped to a host port by the Owner)
HA_OAUTH_URL = "http://homeassistant:8123"   # HA Core on the hassio network: "Sign in with HA"'s code exchange
ACCESS_MODES = ("ingress", "proxy", "https")
# HA's hassio network and Docker's default bridge (mantel_server/direct.py NEVER_LAN): relays, not a home's proxy
RELAY_NETWORKS = ("172.30.32.0/23", "fd0c:ac1e:2100::/48", "172.17.0.0/16")
LETSENCRYPT_STAGING = "https://acme-staging-v02.api.letsencrypt.org/directory"
HA_CORE_PEER = "172.30.32.1"        # HA Core on the hassio network (the bridge's gateway; Core runs on the host)
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


def rp_id_args(public_url: str) -> list[str]:
    """``--rp-id`` for passkeys: MANTEL_PUBLIC_URL's host name, the name browsers type. Without it the
    server's default RP ID is "localhost", and every passkey at the real name is refused
    (origin_not_allowed_for_passkeys: accounts.passkey_origin wants the page's host to be the RP ID or a
    name under it). WebAuthn needs nothing else from here: the expected origin is the page's own Origin,
    checked against this RP ID. An IP address can never be an RP ID (browsers refuse it), so then no flag
    and passkeys stay off, as they would anyway at an IP. An --rp-id in the container's own command (the
    old compose.local.yaml workaround) still wins: it comes after these arguments."""
    from urllib.parse import urlsplit
    try:
        host = (urlsplit(public_url.strip()).hostname or "").lower().rstrip(".")
    except ValueError:
        return []           # the server's own --public-url check reports the bad address
    if not host or _is_ip(host):
        return []
    return ["--rp-id", host]


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
    args += rp_id_args(env["MANTEL_PUBLIC_URL"])
    args += trusted_proxy_args(env)
    # Docker secrets (compose): at_rest.key and backup.key are read from here
    args += ["--secrets-dir", env.get("MANTEL_SECRETS_DIR", "/run/secrets")]
    if env.get("MANTEL_MA_URL"):
        args += ["--ma-url", env["MANTEL_MA_URL"],
                 "--ma-token-file", env.get("MANTEL_MA_TOKEN_FILE", "/run/secrets/ma_token")]
    args += media_and_header_args(env)
    if env.get("MANTEL_BACKUP_TARGET"):
        args += ["--backup-target", env["MANTEL_BACKUP_TARGET"]]
    args += live_tv_args(env)
    if env.get("MANTEL_DEFAULT_SCREEN"):                # first-start values: Mantel Settings keeps them
        args += ["--screen", env["MANTEL_DEFAULT_SCREEN"]]
    if env.get("MANTEL_SESSION_HOURS"):
        args += ["--session-hours", env["MANTEL_SESSION_HOURS"]]
    if env.get("MANTEL_READ_ONLY", "").strip().lower() in ("1", "yes", "true", "on"):
        args.append("--read-only")                     # the kill switch
    args += connect_args(env)
    args += cf_access_args(env.get("MANTEL_CF_ACCESS_TEAM", ""), env.get("MANTEL_CF_ACCESS_AUD", ""),
                           "MANTEL_CF_ACCESS_TEAM", "MANTEL_CF_ACCESS_AUD")
    if env.get("MANTEL_ANNOUNCE", "1").strip().lower() not in ("0", "no", "false", "off"):
        args += ["--announce-file", f"{env.get('MANTEL_DATA_DIR', '/data')}/announce.json"]
    return args


def _list(value: str) -> list[str]:
    return [v for v in value.replace(",", " ").split() if v]


def media_and_header_args(env: dict[str, str]) -> list[str]:
    """Music Assistant's web app under Mantel's own /ma/ (media_proxy.py; go2rtc's address comes from
    live_tv_args, the one go2rtc setting), the
    extra CSP sources (security_headers.py; space or comma separated) and which proxy owns TLS."""
    args: list[str] = []
    if env.get("MANTEL_MA_WEB_URL"):
        args += ["--ma-web-url", env["MANTEL_MA_WEB_URL"]]
    for var, flag in (("MANTEL_FRAME_ANCESTORS", "--frame-ancestors"), ("MANTEL_CONNECT_SRC", "--csp-connect-src"),
                      ("MANTEL_FRAME_SRC", "--csp-frame-src")):
        for source in _list(env.get(var, "")):
            args += [flag, source]
    kind = env.get("MANTEL_PROXY_KIND", "").strip().lower()
    if kind:
        if kind not in ("caddy", "own"):
            raise ConfigError(f"MANTEL_PROXY_KIND must be caddy or own, not {kind!r}")
        args += ["--proxy-kind", kind]
    return args


def cf_access_args(team: str, aud: str, team_name: str, aud_name: str) -> list[str]:
    """Cloudflare Access verification (mantel_server/cf_access.py): --cf-access-team and one --cf-access-aud per
    tag, or nothing when both are empty. One without the other is refused here, with the setting's own name (the
    server checks the values themselves)."""
    team, tags = str(team or "").strip(), _list(str(aud or ""))
    if not team and not tags:
        return []
    if not team or not tags:
        raise ConfigError(f"{team_name} and {aud_name} go together: the Zero Trust team name and the Access "
                          "application's AUD tag (Cloudflare Zero Trust -> Access -> Applications -> the app)")
    args = ["--cf-access-team", team]
    for tag in tags:
        args += ["--cf-access-aud", tag]
    return args


def live_tv_args(env: dict[str, str]) -> list[str]:
    """Live TV served by Mantel (compose: its own go2rtc). Never in the HA App (app_args): there Home
    Assistant's own Live TV stays the interim (docs/phase4/FEATURE-PARITY.md)."""
    if not env.get("MANTEL_GO2RTC_URL"):
        return []
    hw = env.get("MANTEL_LIVE_TV_HARDWARE", "").strip().lower() or "none"
    if hw not in ("none", "vaapi"):
        raise ConfigError(f"MANTEL_LIVE_TV_HARDWARE must be vaapi or empty, not {hw!r}")
    return ["--go2rtc-url", env["MANTEL_GO2RTC_URL"], "--live-tv-hardware", hw]


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
    access = str(options.get("access") or "ingress").strip().lower()
    if access not in ACCESS_MODES:
        raise ConfigError(f"access must be one of {', '.join(ACCESS_MODES)}, not {access!r}")
    public = public_url_option(options) if access != "ingress" else ""
    if listen not in ("127.0.0.1", "::1"):
        # '*' is checked on the Ingress port only; the direct port answers only to public_url's name (direct.py)
        args += ["--public-url", public or "https://ingress.invalid/", "--allow-host", "*"]
    args += ["--ingress", "--ingress-only", "--ha-managed-by-app",
             # Mantel Link's "Discovered: Mantel" (supervisor_discovery.py; config.yaml discovery, hassio_api)
             "--supervisor-url", env.get("MANTEL_SUPERVISOR_URL", "http://supervisor")]
    if access != "ingress":
        args += direct_args(access, public, options, env)   # HA is the App's credential (connections.py)
    for peer in filter(None, (p.strip() for p in env.get("MANTEL_INGRESS_PEER", "").split(","))):
        args += ["--ingress-peer", peer]
    # HA Core (host network) as the App sees it: linked mode's client (hk_frontend "Linked to Mantel Server",
    # address http://<the App's hostname>:8099) may reach /linked/ws, with its Service credential
    for peer in filter(None, (p.strip() for p in env.get("MANTEL_HA_CORE_PEER", HA_CORE_PEER).split(","))):
        args += ["--ha-core-peer", peer]
    # Commands stay OFF unless the App's option says exactly true (PLAN: off by default). The moved options below
    # (commands_enabled, default_screen, session_hours, ha_door_rules, Music Assistant's, ha_sign_in_url,
    # ha_frame_origins) are only first-start values now: Mantel Settings keeps them (server_settings.py).
    if options.get("commands_enabled") is True:
        args.append("--commands-enabled")
    if options.get("read_only") is True:              # the kill switch: read-only whatever Mantel Settings says
        args.append("--read-only")
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
    # Cloudflare Access in front of a tunnel to the direct port (a cloudflared App, or your proxy's tunnel):
    # the sidebar (Ingress, the 'ha' door) is never asked for it; with access ingress nothing else reaches Mantel
    args += cf_access_args(options.get("cf_access_team"), options.get("cf_access_aud"), "cf_access_team",
                           "cf_access_aud")
    return args


def public_url_option(options: dict) -> str:
    """The App's public_url: https://<Mantel's own name>[:port]/, what tablets and browsers type."""
    from urllib.parse import urlsplit
    raw = str(options.get("public_url") or "").strip()
    u = urlsplit(raw)
    try:
        u.port
    except ValueError:
        u = urlsplit("")
    if u.scheme != "https" or not u.hostname or u.path not in ("", "/") or u.query or u.fragment or u.username \
            or u.password or _is_ip(u.hostname):
        raise ConfigError("direct access needs public_url: Mantel's own https:// name, for example "
                          "https://mantel.example.com (a name, not an IP address; add :port if it is not 443)")
    return f"https://{u.netloc.lower()}/"


def _is_ip(name: str) -> bool:
    try:
        ipaddress.ip_address(name.strip("[]"))
        return True
    except ValueError:
        return False


def direct_args(access: str, public: str, options: dict, env: dict[str, str]) -> list[str]:
    """Direct access (decision 26; mantel_server/direct.py): the second listener and its rules."""
    from urllib.parse import urlsplit
    args = ["--direct-port", env.get("MANTEL_DIRECT_PORT", DIRECT_PORT), "--rp-id", urlsplit(public).hostname]
    sign_in = str(options.get("ha_sign_in_url") or "").strip().rstrip("/")
    if sign_in:
        u = urlsplit(sign_in)
        if u.scheme not in ("http", "https") or not u.hostname or u.path or u.query or u.username or u.password:
            raise ConfigError("ha_sign_in_url must be Home Assistant's address as browsers know it, for example "
                              "http://homeassistant.local:8123")
        args += ["--ha-browser-url", sign_in]          # its first-start value; Mantel Settings has it then
    # "Sign in with Home Assistant"'s code exchange: HA Core on the App's network. Where the browser goes is Mantel
    # Settings' Sign-In Address, else HA's own External URL (server_settings.sign_in_address)
    args += ["--ha-oauth-url", env.get("MANTEL_HA_OAUTH_URL", HA_OAUTH_URL)]
    for origin in frame_origins("", options):        # copied once into Mantel Settings' approved addresses
        args += ["--ha-frame-origin", origin]
    if access == "proxy":
        proxies = _list(str(options.get("trusted_proxies") or ""))
        if not proxies:
            raise ConfigError("access proxy needs trusted_proxies: your proxy's address as Mantel sees it "
                              "(the Test my proxy page shows it)")
        for raw in proxies:
            try:
                ip = ipaddress.ip_address(raw)
            except ValueError:
                raise ConfigError(f"trusted_proxies must list IP addresses, not {raw!r}") from None
            if any(ip in ipaddress.ip_network(n) for n in RELAY_NETWORKS if ipaddress.ip_network(n).version == ip.version):
                print(f"mantel entrypoint: WARNING trusted_proxies holds {ip}, an address of Home Assistant's internal "
                      "or Docker's bridge network: anything relayed through it (other Apps, HA Core, Docker's port "
                      "mapping) arrives from there. Mantel still wants the door key with every request, but a direct "
                      "address for your proxy is safer (DOCS.md, Direct access)", file=sys.stderr)
            args += ["--trusted-proxy", str(ip)]
        args += ["--proxy-kind", "own"]           # the door counts only with this installation's door key
    else:
        provider = str(options.get("dns_provider") or "cloudflare").strip()
        if provider == "duckdns":
            host = (urlsplit(public).hostname or "").lower()
            if not (host.endswith(".duckdns.org") and host.count(".") >= 2):
                raise ConfigError("dns_provider duckdns needs public_url https://<name>.duckdns.org (your Duck DNS name)")
            if not str(options.get("duckdns_token") or "").strip():
                raise ConfigError("access https through Duck DNS needs duckdns_token: the token on duckdns.org's page")
            token_file = env.get("MANTEL_APP_DUCKDNS_TOKEN_FILE") or str(APP_DUCKDNS_TOKEN_FILE)
        elif provider == "cloudflare":
            if not str(options.get("cloudflare_token") or "").strip():
                raise ConfigError("access https needs cloudflare_token: a Cloudflare API token with Zone / Zone / "
                                  "Read and Zone / DNS / Edit on public_url's zone")
            token_file = env.get("MANTEL_APP_CF_TOKEN_FILE") or str(APP_CF_TOKEN_FILE)
        else:
            raise ConfigError(f"dns_provider must be cloudflare or duckdns, not {provider!r}")
        args += ["--direct-tls", "acme", "--acme-dns-provider", provider, "--acme-dns-token-file", token_file]
        email = str(options.get("acme_email") or "").strip()
        if email:
            # a plain string option (HA's `email?` type refuses the empty default, so the App would not update)
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 254:
                raise ConfigError("acme_email is not an email address (leave it empty for none)")
            args += ["--acme-email", email]
        if options.get("acme_staging") is True:
            args += ["--acme-directory", LETSENCRYPT_STAGING]
        for raw in _list(str(options.get("lan_networks") or "")):
            try:
                args += ["--lan-network", str(ipaddress.ip_network(raw, strict=False))]
            except ValueError:
                raise ConfigError(f"lan_networks must list networks such as 192.0.2.0/24, not {raw!r}") from None
    return args


def frame_origins(sign_in: str, options: dict) -> list[str]:
    """Home Assistant's addresses that may show Mantel's direct address in a frame: a "Webpage" dashboard in HA's
    sidebar (security_headers.py adds them to frame-ancestors). ha_sign_in_url's origin, then ha_frame_origins
    (HA's other addresses, e.g. the one used at home and the one used away). Each one a plain origin."""
    from urllib.parse import urlsplit
    out: list[str] = []
    for raw in ([sign_in] if sign_in else []) + _list(str(options.get("ha_frame_origins") or "")):
        u = urlsplit(raw.rstrip("/"))
        try:
            port = u.port
        except ValueError:
            port, u = None, urlsplit("")
        host = (u.hostname or "").lower()
        if u.scheme not in ("http", "https") or not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)*", host) or u.path \
                or u.query or u.fragment or u.username or u.password:
            raise ConfigError("ha_frame_origins must list Home Assistant's addresses as browsers know them, for "
                              f"example https://ha.example.com or http://homeassistant.local:8123, not {raw!r}")
        origin = f"{u.scheme}://{host}" + (f":{port}" if port else "")
        if origin not in out:
            out.append(origin)
    return out


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
        args = app_args(options, token_file, env)
        if "--direct-tls" in args:      # only the chosen DNS host's token leaves the options (direct_args checked it)
            if args[args.index("--acme-dns-provider") + 1] == "duckdns":
                write_private(Path(env.get("MANTEL_APP_DUCKDNS_TOKEN_FILE") or APP_DUCKDNS_TOKEN_FILE),
                              str(options.get("duckdns_token") or "").strip())
            else:
                write_private(Path(env.get("MANTEL_APP_CF_TOKEN_FILE") or APP_CF_TOKEN_FILE),
                              str(options.get("cloudflare_token") or "").strip())
        return args + argv, env
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
                        + [f for f in (APP_TOKEN_FILE, APP_MA_TOKEN_FILE, APP_CF_TOKEN_FILE, APP_DUCKDNS_TOKEN_FILE) if f.exists()])
    os.execve(sys.executable, [sys.executable, "-m", "mantel_server", *args], env)
    return 0  # not reached


if __name__ == "__main__":
    sys.exit(main())
