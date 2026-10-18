from __future__ import annotations

import argparse
from ipaddress import ip_address
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

LOOPBACK = {"127.0.0.1", "::1"}
LOOPBACK_DEFAULT = "127.0.0.1"
REPO = Path(__file__).resolve().parents[3]


@dataclass
class Config:
    ha_url: str = "http://192.0.2.53:8123"
    token_file: Path = Path("~/.config/mantel/ha_token")
    host: str = "127.0.0.1"
    port: int = 8765
    default_interval: float = 0.0
    overrides: list[tuple[str, float]] = field(default_factory=list)
    default_screen: str = "dashboard-kitchen"           # /home goes to /<this>/home
    hk_frontend: Path = REPO / "web/hk"   # current shared HK source; the proof snapshot is reference-only
    # "Your files" served after the uploaded ones (user_files.py: <data_dir>/user-files, which wins): a dev folder
    # with SF Pro + glyphs (Apple's; never committed). --hk-files points it elsewhere, e.g. a bind-mounted folder.
    hk_files: Path = REPO / "spikes/hk-snapshot/hk_local"
    fixtures: Path = REPO / "spikes/hk-snapshot/fixtures"      # captured HK feeds (personal data; git-ignored)
    web: Path = REPO / "web"
    data_dir: Path = Path("~/.local/share/mantel")
    secrets_dir: Path = Path("~/.config/mantel/secrets")    # at-rest key file (created 0700/0600 on first use)
    session_hours: float = 12.0                              # session lifetime on the tunnel door
    lan_session_days: float = 30.0                           # session lifetime on the LAN door
    access_minutes: float = 15.0                             # access token lifetime (the refresh token rotates)
    device_rotate_hours: float = 24.0                        # wall tablet credential rotation
    webauthn_rp_id: str = "localhost"                        # passkeys: the RP ID (a hostname, never an IP)
    trusted_proxies: tuple[str, ...] = ()                    # peers whose X-Forwarded-For / X-Mantel-Door is believed (P3.6)
    # P3.3: the command gateway. OFF unless the server's operator turns it on here (the CLI flag
    # --commands-enabled or a Config built by code): no client message can change it. While off,
    # ha_client.HaCommander cannot be built and every command answers `commands_disabled`.
    commands_enabled: bool = False
    house_tz: str = "UTC"                                    # fallback when HA's get_config gives no time_zone
    audit_retention_days: float = 365.0                      # action_audit rows older than this are purged (>= 30)
    # P3.4: Music Assistant's own WebSocket API (connectors/ma.py). Empty URL = connector off.
    # The long-lived token is read from this secret file at each connect, never from env or logs.
    ma_url: str = ""
    ma_token_file: Path = Path("/run/secrets/ma_token")
    # Backups (backup.py): off unless a target folder (the NAS mount) is set.
    backup_target: Path | None = None
    backup_key_file: Path | None = None                      # default <secrets_dir>/backup.key (not the at-rest key)
    backup_time: str = "03:15"                               # nightly, in house_tz
    backup_keep_daily: int = 7
    backup_keep_weekly: int = 4
    backup_include_files: bool = True                        # the "Your files" tree goes in the backup too
    # Container mode (packaging/): the server listens on the container's interface behind Caddy.
    # An empty public_url is the loopback prototype. parse_args holds the rules that guard it.
    public_url: str = ""                      # https://mantel.example.com/ : the address browsers use (via Caddy)
    allowed_hosts: tuple[str, ...] = ()       # Host header names accepted besides loopback; "*" = any
    # HA App mode (packaging/ha-app, docs/phase3/HA-APP.md). `ingress`: the signed-in HA user arrives in
    # Ingress's X-Remote-User-* headers, believed ONLY from a socket peer in `ingress_peers` (the
    # Supervisor's Ingress proxy on the hassio network). `ingress_only`: every other peer is refused
    # (health checks excepted). `ha_door_rules`: what RBAC's door rules treat the 'ha' door as.
    ingress: bool = False
    ingress_peers: tuple[str, ...] = ("172.30.32.2",)
    ingress_only: bool = False
    ha_door_rules: str = "tunnel"                          # "tunnel" | "lan" | "trusted" (the HA App's default)
    ha_ws_url: str = ""                                    # explicit HA WebSocket URL (App: ws://supervisor/core/websocket)
    # Mantel Connect (connect_pairing.py): Mantel Server OUTSIDE HA, reached by the Connect App in HA's sidebar
    # over mutual TLS on its own port. Implies ingress mode (identity from the paired App's X-Remote-User-*
    # headers), but trusts no socket peer: `ingress_peers` stays empty unless --ingress is also given.
    connect: bool = False
    connect_port: int = 8766
    connect_listen: str = "0.0.0.0"
    connect_address: str = ""                              # what /admin shows the Owner to type into the App
    log_level: str = "info"
    # Live TV served by Mantel (live_tv.py): its own go2rtc's API (compose: http://go2rtc:1984, the
    # backend network; never given to a page). Empty = Mantel does not run Live TV (the HA App: Home
    # Assistant's own Live TV stays the interim). `live_tv_hardware`: "vaapi" uses the QuickSync templates.
    go2rtc_url: str = ""
    live_tv_hardware: str = ""

    @property
    def ws_url(self) -> str:
        """Home Assistant's WebSocket API: the explicit URL, else derived from ha_url."""
        return self.ha_ws_url or self.ha_url.rstrip("/").replace("http", "ws", 1) + "/api/websocket"

    @property
    def connect_dir(self) -> Path:
        """The Connect certificate authority and listener certificate (private keys, mode 0600)."""
        return Path(self.data_dir).expanduser() / "connect"

    @property
    def user_files_dir(self) -> Path:
        """Where the home's own fonts, glyphs and photos live: outside the web root, on the /data volume."""
        return Path(self.data_dir).expanduser() / "user-files"

    @property
    def base_url(self) -> str:
        return self.public_url.rstrip("/") + "/" if self.public_url else f"http://{self.host}:{self.port}/"

    @property
    def client_id(self) -> str:  # Mantel's own URL; HA requires redirect_uri on the same host
        return self.base_url

    @property
    def redirect_uri(self) -> str:
        return self.base_url + "auth/callback"

    def host_allowed(self, hostname: str) -> bool:
        """Host-header check against DNS rebinding: loopback always, plus the configured names."""
        name = hostname.lower()
        return name in {"127.0.0.1", "localhost", "[::1]"} or "*" in self.allowed_hosts or name in self.allowed_hosts


def parse_args(argv: list[str] | None = None) -> Config:
    p = argparse.ArgumentParser(prog="mantel-server", description="Mantel state hub (read-only prototype)")
    p.add_argument("--ha-url", default=Config.ha_url)
    p.add_argument("--token-file", default=str(Config.token_file))
    p.add_argument("--port", type=int, default=Config.port)
    p.add_argument("--default-interval", type=float, default=0.0,
                   help="minimum seconds between updates of one entity to one client (0 = none)")
    p.add_argument("--override", action="append", default=[], metavar="GLOB=SECONDS",
                   help="per-entity interval, e.g. 'sensor.*_distance=1' (repeatable)")
    p.add_argument("--data-dir", default=str(Config.data_dir), help="where mantel.db lives (outside git)")
    p.add_argument("--screen", default=Config.default_screen, help="dashboard /home opens (HK board key)")
    p.add_argument("--secrets-dir", default=str(Config.secrets_dir), help="folder of secret files (at-rest key)")
    p.add_argument("--session-hours", type=float, default=Config.session_hours, help="tunnel-door session lifetime")
    p.add_argument("--lan-session-days", type=float, default=Config.lan_session_days)
    p.add_argument("--rp-id", default=Config.webauthn_rp_id, help="passkey relying-party id (hostname)")
    p.add_argument("--ma-url", default=Config.ma_url, help="Music Assistant's WebSocket API (ws://ma:8095/ws); empty = off")
    p.add_argument("--ma-token-file", default=str(Config.ma_token_file), help="Music Assistant's long-lived token (a file)")
    p.add_argument("--commands-enabled", action="store_true",
                   help="turn the command gateway on: signed-in users may control the house through Mantel, "
                        "within their roles, with step-up and an audit row for every command. Off by default")
    p.add_argument("--house-tz", default=Config.house_tz,
                   help="house time zone for grant schedules when Home Assistant does not say (IANA name)")
    p.add_argument("--audit-retention-days", type=float, default=Config.audit_retention_days, metavar="DAYS",
                   help="keep audit rows this many days (at least 30); older ones are deleted by the hourly "
                        "maintenance step, which logs what it deleted")
    p.add_argument("--trusted-proxy", action="append", default=[], metavar="ADDRESS",
                   help="a reverse proxy (Caddy) whose X-Mantel-Door / X-Forwarded-For headers are believed (repeatable)")
    p.add_argument("--listen", default=None, metavar="ADDRESS",
                   help="container mode: listen on this address (e.g. 0.0.0.0 inside a container whose only "
                        "published port belongs to Caddy). Needs --public-url. Default: loopback only")
    p.add_argument("--public-url", default="", metavar="URL",
                   help="container mode: the https:// address browsers use; sets HA's OAuth client id and "
                        "the Host name accepted besides loopback")
    p.add_argument("--allow-host", action="append", default=[], metavar="NAME",
                   help="container mode: another Host header name to accept (repeatable). '*' accepts any "
                        "and is only for a server whose sole way in is a trusted proxy (HA Ingress)")
    p.add_argument("--hk-files", default=str(Config.hk_files), metavar="DIR",
                   help="a folder served under /hk/ after the uploaded Your files (dev/bind-mount; "
                        "uploads go to <data-dir>/user-files and win)")
    p.add_argument("--backup-target", default=None, metavar="DIR",
                   help="nightly encrypted backups go here (the NAS mount; must exist). Off when absent")
    p.add_argument("--backup-key-file", default=None, metavar="FILE",
                   help="the backup key (default <secrets-dir>/backup.key; separate from the at-rest key)")
    p.add_argument("--backup-time", default=Config.backup_time, metavar="HH:MM", help="nightly backup time, house time")
    p.add_argument("--backup-keep-daily", type=int, default=Config.backup_keep_daily, metavar="N")
    p.add_argument("--backup-keep-weekly", type=int, default=Config.backup_keep_weekly, metavar="N")
    p.add_argument("--backup-no-files", action="store_true", help="back up the database only, not the Your files tree")
    p.add_argument("--ingress", action="store_true",
                   help="HA App mode: accept the signed-in HA user from Ingress's X-Remote-User-* headers, "
                        "only from an --ingress-peer (the Supervisor's Ingress proxy)")
    p.add_argument("--ingress-peer", action="append", default=[], metavar="ADDRESS",
                   help="the Ingress proxy's socket address (repeatable; default 172.30.32.2)")
    p.add_argument("--ingress-only", action="store_true",
                   help="with --ingress: refuse every request that does not come through Ingress (health excepted)")
    p.add_argument("--ha-door-rules", choices=("tunnel", "lan", "trusted"), default=Config.ha_door_rules,
                   help="RBAC door rules for requests through HA's sidebar (the 'ha' door): tunnel (default) or lan")
    p.add_argument("--ha-ws-url", default="", metavar="URL",
                   help="Home Assistant's WebSocket URL when it is not <ha-url>/api/websocket "
                        "(HA App: ws://supervisor/core/websocket)")
    p.add_argument("--connect", action="store_true",
                   help="Mantel Connect: also listen (TLS, client certificates) for the Connect App in Home Assistant's "
                        "sidebar, and offer pairing (mantel connect pair; /admin). Off by default")
    p.add_argument("--connect-port", type=int, default=Config.connect_port)
    p.add_argument("--connect-listen", default=Config.connect_listen, metavar="ADDRESS")
    p.add_argument("--connect-address", default="", metavar="HOST[:PORT]",
                   help="the address /admin tells the Owner to give the Connect App")
    p.add_argument("--log-level", choices=("debug", "info", "warning", "error"), default=Config.log_level)
    p.add_argument("--go2rtc-url", default="", metavar="URL",
                   help="Live TV served by Mantel: its own go2rtc's API (http://go2rtc:1984 in the compose stack). "
                        "Off when absent (the HA App keeps Home Assistant's Live TV)")
    p.add_argument("--live-tv-hardware", choices=("none", "vaapi"), default="none",
                   help="Live TV's transcode: vaapi = QuickSync (needs /dev/dri in go2rtc: compose.gpu.yaml)")
    a = p.parse_args(argv)
    g2 = urlparse(a.go2rtc_url) if a.go2rtc_url else None
    if g2 is not None and (g2.scheme not in ("http", "https") or not g2.hostname or g2.path not in ("", "/")
                           or g2.query or g2.username or g2.password):
        p.error("--go2rtc-url must be go2rtc's API address, e.g. http://go2rtc:1984")
    if not 1 <= a.connect_port <= 65535:
        p.error("--connect-port must be a TCP port")
    if a.connect and a.ingress_only:
        p.error("--ingress-only refuses every request that does not come through Ingress, so it cannot "
                "be combined with --connect (the Connect listener is the only other way in)")
    if (a.ingress_peer or a.ingress_only) and not a.ingress:
        p.error("--ingress-peer / --ingress-only only apply together with --ingress")
    peers = []
    for raw in a.ingress_peer:
        try:
            peers.append(str(ip_address(raw)))
        except ValueError:
            p.error(f"--ingress-peer must be an IP address, not {raw!r}")
    if a.ha_ws_url and urlparse(a.ha_ws_url).scheme not in ("ws", "wss"):
        p.error("--ha-ws-url must be a ws:// or wss:// URL")
    host, public_url, allowed = LOOPBACK_DEFAULT, "", ()
    if a.listen is not None:
        host = a.listen
        if a.listen not in LOOPBACK:
            parsed = urlparse(a.public_url)
            if parsed.scheme != "https" or not parsed.hostname:
                p.error("--listen on a non-loopback address needs --public-url https://<name>/ "
                        "(Mantel is served over TLS by Caddy; it never listens openly without that)")
            public_url = a.public_url
            names = [parsed.netloc.lower(), parsed.hostname.lower(), *(h.lower() for h in a.allow_host)]
            allowed = tuple(dict.fromkeys(names))
    if (a.public_url or a.allow_host) and a.listen is None:
        p.error("--public-url / --allow-host only apply together with --listen")
    if not (a.audit_retention_days >= 30) or a.audit_retention_days == float("inf"):
        p.error("--audit-retention-days must be at least 30")
    from .backup import parse_time
    try:
        parse_time(a.backup_time)
    except ValueError as exc:
        p.error(str(exc))
    if a.backup_keep_daily < 1 or a.backup_keep_weekly < 0:
        p.error("--backup-keep-daily must be at least 1 and --backup-keep-weekly at least 0")
    overrides = []
    for item in a.override:
        pattern, _, secs = item.rpartition("=")
        if not pattern:
            p.error(f"--override needs GLOB=SECONDS, got {item!r}")
        overrides.append((pattern, float(secs)))
    # Loopback is the default; any other address needs --listen and --public-url (container mode).
    cfg = Config(ha_url=a.ha_url, token_file=Path(a.token_file), host=host, port=a.port,
                 default_interval=a.default_interval, overrides=overrides,
                 data_dir=Path(a.data_dir), session_hours=a.session_hours, default_screen=a.screen,
                 secrets_dir=Path(a.secrets_dir), lan_session_days=a.lan_session_days, webauthn_rp_id=a.rp_id,
                 public_url=public_url, allowed_hosts=allowed, commands_enabled=bool(a.commands_enabled),
                 house_tz=a.house_tz, trusted_proxies=tuple(a.trusted_proxy),
                 audit_retention_days=float(a.audit_retention_days), hk_files=Path(a.hk_files),
                 backup_target=Path(a.backup_target) if a.backup_target else None,
                 backup_key_file=Path(a.backup_key_file) if a.backup_key_file else None,
                 backup_time=a.backup_time, backup_keep_daily=a.backup_keep_daily,
                 backup_keep_weekly=a.backup_keep_weekly, backup_include_files=not a.backup_no_files,
                 ma_url=a.ma_url, ma_token_file=Path(a.ma_token_file),
                 ingress=bool(a.ingress or a.connect),
                 ingress_peers=tuple(peers) or (Config.ingress_peers if a.ingress else ()),
                 connect=bool(a.connect), connect_port=a.connect_port, connect_listen=a.connect_listen,
                 connect_address=a.connect_address,
                 ingress_only=bool(a.ingress_only), ha_door_rules=a.ha_door_rules, ha_ws_url=a.ha_ws_url,
                 log_level=a.log_level, go2rtc_url=a.go2rtc_url.rstrip("/"),
                 live_tv_hardware="" if a.live_tv_hardware == "none" else a.live_tv_hardware)
    assert cfg.host in LOOPBACK or cfg.public_url, "Mantel listens beyond loopback only in container mode"
    return cfg
