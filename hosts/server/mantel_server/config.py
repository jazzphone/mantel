from __future__ import annotations

import argparse
from ipaddress import ip_address
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

LOOPBACK = {"127.0.0.1", "::1"}
LOOPBACK_DEFAULT = "127.0.0.1"
REPO = Path(__file__).resolve().parents[3]


def _docs(shipped: str, source: str) -> Path:
    """Where /docs reads a page set: as an image carries it (help/), else its source in this repository."""
    p = REPO / shipped
    return p if p.exists() else REPO / source


@dataclass
class Config:
    ha_url: str = "http://homeassistant.local:8123"
    token_file: Path = Path("~/.config/mantel/ha_token")
    host: str = "127.0.0.1"
    port: int = 8765
    default_interval: float = 0.0
    overrides: list[tuple[str, float]] = field(default_factory=list)
    default_screen: str = ""           # /home goes to /<this>/home; empty: the first screen (default_screens.house)
    hk_frontend: Path = REPO / "web/hk"   # current shared HK source; the proof snapshot is reference-only
    # "Your files" served after the uploaded ones (user_files.py: <data_dir>/user-files, which wins): a dev folder
    # with SF Pro + glyphs (Apple's; never committed). --hk-files points it elsewhere, e.g. a bind-mounted folder.
    hk_files: Path = REPO / "spikes/hk-snapshot/hk_local"
    fixtures: Path = REPO / "spikes/hk-snapshot/fixtures"      # captured HK feeds (personal data; git-ignored)
    web: Path = REPO / "web"
    # /docs (docs_pages.py): HK's pages (HK Frontend's wiki, its source in this repository) and Mantel's own;
    # the images carry them as help/ (Dockerfile, tools/stage_ha_app.py)
    docs_hk: Path = field(default_factory=lambda: _docs("help/hk", "hosts/ha/custom_components/hk_frontend/docs"))
    docs_mantel: Path = field(default_factory=lambda: _docs("help/Mantel.md", "packaging/ha-app/DOCS.md"))
    data_dir: Path = Path("~/.local/share/mantel")
    secrets_dir: Path = Path("~/.config/mantel/secrets")    # at-rest key file (created 0700/0600 on first use)
    session_hours: float = 12.0                              # session lifetime on the tunnel door
    lan_session_days: float = 30.0                           # session lifetime on the LAN door
    access_minutes: float = 15.0                             # access token lifetime (the refresh token rotates)
    device_rotate_hours: float = 24.0                        # wall tablet credential rotation
    webauthn_rp_id: str = "localhost"                        # passkeys: the RP ID (a hostname, never an IP)
    trusted_proxies: tuple[str, ...] = ()                    # peers whose X-Forwarded-For / X-Mantel-Door is believed (P3.6)
    # P3.3: the command gateway. Off by default. An Owner turns it on in Mantel Settings (General, Allow Control
    # of the House; server_settings.py), which sets this; --commands-enabled is only its first-start value. No
    # page message changes it. While off, ha_client.HaCommander cannot be built and every command answers
    # `commands_disabled`. `read_only` (--read-only, the start-up kill switch) holds it off whatever is stored.
    commands_enabled: bool = False
    read_only: bool = False
    house_tz: str = "UTC"                                    # fallback when HA's get_config gives no time_zone
    audit_retention_days: float = 365.0                      # action_audit rows older than this are purged (>= 30)
    # P3.4: Music Assistant's own WebSocket API (connectors/ma.py). Empty URL = connector off.
    # The long-lived token is read from this secret file at each connect, never from env or logs.
    ma_url: str = ""
    ma_token_file: Path = Path("/run/secrets/ma_token")
    # media_proxy.py: Music Assistant's web app served under Mantel's own address (/ma/) so an https page
    # can frame it (go2rtc's viewing paths likewise under /go2rtc/, from `go2rtc_url` below). Empty = off.
    # Defaults to the host of `ma_url` (ws://ma:8095/ws -> http://ma:8095/). Never sent to a page.
    ma_web_url: str = ""
    # security_headers.py: extra CSP sources (frame-ancestors adds to 'self'; connect-src/frame-src to the
    # page policy). `proxy_kind` says which reverse proxy owns TLS ("caddy" | "own" | ""), for /proxy-check.
    frame_ancestors: tuple[str, ...] = ()
    csp_connect_src: tuple[str, ...] = ()
    csp_frame_src: tuple[str, ...] = ()
    proxy_kind: str = ""
    # Backups (backup.py): off unless a target folder (the NAS mount) is set.
    backup_target: Path | None = None
    backup_key_file: Path | None = None                      # default <secrets_dir>/backup.key (not the at-rest key)
    backup_time: str = "03:15"                               # nightly, in the house's zone (HA's; house_tz until known)
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
    # HA App mode: HA Core's socket address as the App sees it (172.30.32.1). With ingress_only it may reach
    # linked mode's endpoint, and only that (ingress.CORE_PATHS; the endpoint still wants a Service credential)
    ha_core_peers: tuple[str, ...] = ()
    # HA App mode: Home Assistant is reached with the Supervisor's own App credential, so the Connections
    # page shows HA as "Provided by Home Assistant (App)" and never edits it (connections.py)
    ha_managed_by_app: bool = False
    # Mantel Link's discovery (docs/phase9/MANTEL-LINK.md 9.5): the HA App announces Mantel to the Supervisor
    # (supervisor_discovery.py; with the App's Supervisor credential, the token file); Docker/LXC write what the
    # host-network announcer advertises by zeroconf (announce.py)
    supervisor_url: str = ""
    announce_file: Path | None = None
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
    # HA App direct access (decision 26, direct.py; docs/phase3/HA-APP.md "Direct access"): a second listener
    # on `direct_port` (0 = off) for devices at home that go to Mantel's own address instead of HA's sidebar.
    # Requests on it are never Ingress (no X-Remote-User-* is believed there, whoever the peer is), pass the
    # Ingress-only gate, and must name one of `direct_hosts` (the public URL's host, plus --direct-host).
    # `direct_tls` "": plain HTTP for the home's own proxy (trusted_proxies + the door key); "acme": Mantel
    # serves HTTPS there itself with a Let's Encrypt certificate (DNS-01 through Cloudflare or Duck DNS, direct_tls.py).
    direct_port: int = 0
    # The Intercom's stream listener (phase 17, intercom/listener.py): a second plain-HTTP port that serves only one-time
    # links (/s/<token>.wav) to Music Assistant, started only while the Intercom is on in Mantel Settings. 0 = never.
    stream_port: int = 0
    direct_tls: str = ""
    direct_hosts: tuple[str, ...] = ()
    # built-in HTTPS: the home's networks (CIDRs), whose peers get the LAN door there (direct.https_door). Empty:
    # direct.DEFAULT_LAN_NETWORKS. HA's hassio and Docker's bridge networks never count (direct.NEVER_LAN).
    lan_networks: tuple[str, ...] = ()
    acme_directory: str = ""                               # default: Let's Encrypt (direct_tls.LETSENCRYPT)
    acme_email: str = ""
    acme_dns_token_file: Path | None = None                # the DNS host's token (a file, never an argument)
    acme_dns_provider: str = "cloudflare"                  # cloudflare | duckdns (direct_tls.DNS_PROVIDERS)
    # "Sign in with Home Assistant" where ha_url is not an address a browser can use (the App's is
    # http://supervisor/core): the browser goes to `ha_browser_url`; Mantel's own calls go to `ha_oauth_url`
    ha_browser_url: str = ""
    ha_oauth_url: str = ""
    # the old ha_frame_origins option: copied once into Mantel Settings' approved frame origins (server_settings.py)
    ha_frame_origins: tuple[str, ...] = ()
    # Cloudflare Access in front of the tunnel (cf_access.py): with a team (its domain, myteam.cloudflareaccess.com)
    # and the Access application's AUD tag(s), every tunnel-door request must carry a valid Access assertion.
    # Both empty (the default): not checked, as before. Neither is a secret (Cloudflare puts both in every token).
    cf_access_team: str = ""
    cf_access_aud: tuple[str, ...] = ()

    @property
    def tls_dir(self) -> Path:
        """Built-in HTTPS: the ACME account key, the certificate and its key (0700 folder, 0600 files)."""
        return Path(self.data_dir).expanduser() / "tls"

    @property
    def ws_url(self) -> str:
        """Home Assistant's WebSocket API: the explicit URL, else derived from ha_url."""
        return self.ha_ws_url or self.ha_url.rstrip("/").replace("http", "ws", 1) + "/api/websocket"

    @property
    def connect_dir(self) -> Path:
        """The Connect certificate authority and listener certificate (private keys, mode 0600)."""
        return Path(self.data_dir).expanduser() / "connect"

    @property
    def connections_dir(self) -> Path:
        """Mantel's own copies of the HA and MA credentials set on the Connections page (connections.py):
        sealed with the at-rest key, folder 0700, files 0600, on the data volume (in the container stacks
        the install's secrets folder is a read-only mount) and inside every encrypted backup."""
        return Path(self.data_dir).expanduser() / "connections"

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
    p = argparse.ArgumentParser(prog="mantel-server", description="Mantel Server")
    p.add_argument("--ha-url", default=Config.ha_url)
    p.add_argument("--token-file", default=str(Config.token_file))
    p.add_argument("--port", type=int, default=Config.port)
    p.add_argument("--default-interval", type=float, default=0.0,
                   help="minimum seconds between updates of one entity to one client (0 = none)")
    p.add_argument("--override", action="append", default=[], metavar="GLOB=SECONDS",
                   help="per-entity interval, e.g. 'sensor.*_distance=1' (repeatable)")
    p.add_argument("--data-dir", default=str(Config.data_dir), help="where mantel.db lives (outside git)")
    p.add_argument("--screen", default=Config.default_screen, help="dashboard /home opens (HK board key; default: the first screen)")
    p.add_argument("--secrets-dir", default=str(Config.secrets_dir), help="folder of secret files (at-rest key)")
    p.add_argument("--session-hours", type=float, default=Config.session_hours, help="tunnel-door session lifetime")
    p.add_argument("--lan-session-days", type=float, default=Config.lan_session_days)
    p.add_argument("--rp-id", default=Config.webauthn_rp_id, help="passkey relying-party id (hostname)")
    p.add_argument("--ma-url", default=Config.ma_url, help="Music Assistant's WebSocket API (ws://ma:8095/ws); empty = off")
    p.add_argument("--ma-token-file", default=str(Config.ma_token_file), help="Music Assistant's long-lived token (a file)")
    p.add_argument("--ma-web-url", default="", metavar="URL",
                   help="Music Assistant's web app, served to pages under /ma/ (default: the host of --ma-url)")
    p.add_argument("--frame-ancestors", action="append", default=[], metavar="SOURCE",
                   help="CSP frame-ancestors source allowed besides 'self' (repeatable), e.g. https://ha.example.com")
    p.add_argument("--csp-connect-src", action="append", default=[], metavar="SOURCE",
                   help="extra CSP connect-src source for HK's pages (repeatable)")
    p.add_argument("--csp-frame-src", action="append", default=[], metavar="SOURCE",
                   help="extra CSP frame-src source for HK's pages (repeatable)")
    p.add_argument("--proxy-kind", choices=("caddy", "own", ""), default="",
                   help="which reverse proxy owns TLS (Mantel's Caddy, or your own); tunes /proxy-check's advice")
    p.add_argument("--commands-enabled", action="store_true",
                   help="turn the command gateway on: signed-in users may control the house through Mantel, "
                        "within their roles, with an audit row for every command (the Alarm PIN for the alarm). Off by default. "
                        "Only the first start's value: Mantel Settings (General) has it then")
    p.add_argument("--read-only", action="store_true",
                   help="the kill switch: the house stays read-only whatever Mantel Settings says")
    p.add_argument("--ha-frame-origin", action="append", default=[], metavar="ORIGIN",
                   help="a Home Assistant address that may frame Mantel, copied once into Mantel Settings' approved "
                        "addresses (the old ha_frame_origins option; repeatable)")
    p.add_argument("--house-tz", default=Config.house_tz,
                   help="house time zone (grant schedules, the nightly backup) until or unless Home Assistant says (IANA name)")
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
                   help="RBAC door rules for requests through HA's sidebar (the 'ha' door): tunnel (default), lan or "
                        "trusted. Only the first start's value: Mantel Settings (Connections, Home Assistant) has it then")
    p.add_argument("--ha-ws-url", default="", metavar="URL",
                   help="Home Assistant's WebSocket URL when it is not <ha-url>/api/websocket "
                        "(HA App: ws://supervisor/core/websocket)")
    p.add_argument("--ha-core-peer", action="append", default=[], metavar="ADDRESS",
                   help="with --ingress: HA Core's socket address (HA App: 172.30.32.1), allowed to reach linked "
                        "mode's endpoint /linked/ws (with its Service credential) even with --ingress-only")
    p.add_argument("--ha-managed-by-app", action="store_true",
                   help="HA App mode: the Home Assistant credential is the Supervisor's (the Connections page "
                        "shows it as provided by Home Assistant and does not edit it)")
    p.add_argument("--supervisor-url", default="", metavar="URL",
                   help="HA App mode: announce Mantel to Home Assistant through this Supervisor (http://supervisor), "
                        "with a rotated `linked` Service credential (Mantel Link's 'Discovered: Mantel')")
    p.add_argument("--announce-file", default="", metavar="PATH",
                   help="Docker/LXC: write what to announce by zeroconf (_mantel._tcp, no secret) here, for the "
                        "host-network announcer (python -m mantel_server.announce)")
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
                        "Off when absent (the HA App keeps Home Assistant's Live TV). Its viewing paths are also "
                        "served to pages under /go2rtc/ (media_proxy.py)")
    p.add_argument("--live-tv-hardware", choices=("none", "vaapi"), default="none",
                   help="Live TV's transcode: vaapi = QuickSync (needs /dev/dri in go2rtc: compose.gpu.yaml)")
    p.add_argument("--direct-port", type=int, default=0, metavar="PORT",
                   help="HA App mode: also listen on this port for Mantel's own address (direct access; requests "
                        "there are never Ingress and pass --ingress-only). 0 = off")
    p.add_argument("--stream-port", type=int, default=0, metavar="PORT",
                   help="the Intercom's listener for Music Assistant: plain HTTP on this port, serving only one-time "
                        "links to a message's audio, and started only while the Intercom is on in Mantel Settings. "
                        "Keep it on the home network. 0 = off")
    p.add_argument("--direct-tls", choices=("none", "acme"), default="none",
                   help="direct access: none = plain HTTP behind your own proxy; acme = Mantel serves HTTPS itself "
                        "with a Let's Encrypt certificate (DNS-01 through Cloudflare or Duck DNS)")
    p.add_argument("--direct-host", action="append", default=[], metavar="NAME",
                   help="direct access: another Host name accepted there besides --public-url's (repeatable)")
    p.add_argument("--lan-network", action="append", default=[], metavar="CIDR",
                   help="built-in HTTPS: a home network whose addresses get the LAN door (repeatable; default the "
                        "private ranges, never HA's hassio or Docker's bridge network)")
    p.add_argument("--acme-directory", default="", metavar="URL",
                   help="built-in HTTPS: the ACME directory (default Let's Encrypt; its staging one for trials)")
    p.add_argument("--acme-email", default="", metavar="ADDRESS", help="built-in HTTPS: the ACME account's contact")
    p.add_argument("--acme-dns-token-file", default=None, metavar="FILE",
                   help="built-in HTTPS: a file holding the DNS host's token (Cloudflare: an API token, Zone / DNS / "
                        "Edit for one zone; Duck DNS: the account's token)")
    p.add_argument("--acme-dns-provider", choices=("cloudflare", "duckdns"), default="cloudflare",
                   help="built-in HTTPS: the DNS host that proves the name (duckdns: --public-url must be "
                        "<name>.duckdns.org)")
    p.add_argument("--ha-browser-url", default="", metavar="URL",
                   help="'Sign in with Home Assistant': HA's address as browsers know it, when --ha-url is not one "
                        "(HA App: http://supervisor/core)")
    p.add_argument("--ha-oauth-url", default="", metavar="URL",
                   help="'Sign in with Home Assistant': where Mantel itself exchanges the code (HA App: "
                        "http://homeassistant:8123). Default: --ha-url")
    p.add_argument("--cf-access-team", default="", metavar="TEAM",
                   help="Cloudflare Access in front of the tunnel: your Zero Trust team name (myteam, or "
                        "myteam.cloudflareaccess.com). With --cf-access-aud, every tunnel-door request must carry a "
                        "valid Cf-Access-Jwt-Assertion; off when absent")
    p.add_argument("--cf-access-aud", action="append", default=[], metavar="TAG",
                   help="the Access application's AUD tag (repeatable, or a comma list), for --cf-access-team")
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
    if (a.ingress_peer or a.ingress_only or a.ha_core_peer) and not a.ingress:
        p.error("--ingress-peer / --ingress-only / --ha-core-peer only apply together with --ingress")
    if a.stream_port:
        taken = {"--port": a.port, "--direct-port": a.direct_port, "--connect-port": a.connect_port if a.connect else 0}
        if not 1 <= a.stream_port <= 65535:
            p.error("--stream-port must be a TCP port (1-65535), or 0 for off")
        for flag, port in taken.items():
            if port and a.stream_port == port:
                p.error(f"--stream-port must differ from {flag} (both are {port})")
    elif a.stream_port < 0:
        p.error("--stream-port must be a TCP port (1-65535), or 0 for off")
    if a.direct_port:
        if not a.ingress or a.connect:
            p.error("--direct-port is the HA App's direct access: it needs --ingress (and not --connect)")
        if not 1 <= a.direct_port <= 65535 or a.direct_port == a.port:
            p.error("--direct-port must be a TCP port other than --port")
        if urlparse(a.public_url).scheme != "https" or not urlparse(a.public_url).hostname:
            p.error("--direct-port needs --public-url https://<Mantel's own name>/ (what browsers type)")
        if a.direct_tls == "acme" and not a.acme_dns_token_file:
            p.error("--direct-tls acme needs --acme-dns-token-file (the DNS host's token)")
        host = (urlparse(a.public_url).hostname or "").lower()
        if a.acme_dns_provider == "duckdns" and not (host.endswith(".duckdns.org") and host.count(".") >= 2):
            p.error("--acme-dns-provider duckdns needs --public-url https://<name>.duckdns.org/")
    elif a.direct_tls != "none" or a.direct_host or a.lan_network:
        p.error("--direct-tls / --direct-host / --lan-network only apply together with --direct-port")
    from ipaddress import ip_network
    lan_networks = []
    for raw in a.lan_network:
        try:
            lan_networks.append(str(ip_network(raw.strip(), strict=False)))
        except ValueError:
            p.error(f"--lan-network must be a network such as 192.0.2.0/24, not {raw!r}")
    if a.acme_directory and urlparse(a.acme_directory).scheme != "https":
        p.error("--acme-directory must be an https:// address")
    for flag, value in (("--ha-browser-url", a.ha_browser_url), ("--ha-oauth-url", a.ha_oauth_url),
                        ("--acme-directory", a.acme_directory)):
        u = urlparse(value) if value else None
        if u is not None and (u.scheme not in ("http", "https") or not u.hostname or u.query or u.username
                              or u.password or (flag != "--acme-directory" and u.path not in ("", "/"))):
            p.error(f"{flag} must be an http(s):// address" + (" with no path" if flag != "--acme-directory" else ""))
    from . import cf_access
    cf_team, cf_auds = "", ()
    try:
        cf_auds = cf_access.parse_auds(a.cf_access_aud)
        if a.cf_access_team.strip():
            cf_team = cf_access.normalize_team(a.cf_access_team)
    except ValueError as exc:
        p.error(f"--cf-access-team / --cf-access-aud: {exc}")
    if bool(cf_team) != bool(cf_auds):
        p.error("--cf-access-team and --cf-access-aud go together (the team's keys sign, the AUD tag says for which "
                "Access application)")
    peers, core_peers = [], []
    for raw in a.ingress_peer:
        try:
            peers.append(str(ip_address(raw)))
        except ValueError:
            p.error(f"--ingress-peer must be an IP address, not {raw!r}")
    for raw in a.ha_core_peer:
        try:
            core_peers.append(str(ip_address(raw)))
        except ValueError:
            p.error(f"--ha-core-peer must be an IP address, not {raw!r}")
    if a.ha_ws_url and urlparse(a.ha_ws_url).scheme not in ("ws", "wss"):
        p.error("--ha-ws-url must be a ws:// or wss:// URL")
    for flag, value in (("--ma-web-url", a.ma_web_url),):
        if value and (urlparse(value).scheme not in ("http", "https") or not urlparse(value).hostname):
            p.error(f"{flag} must be an http(s):// URL")
    from .security_headers import valid_source
    for flag, values in (("--frame-ancestors", a.frame_ancestors), ("--csp-connect-src", a.csp_connect_src),
                         ("--csp-frame-src", a.csp_frame_src)):
        for v in values:
            if not valid_source(v):
                p.error(f"{flag}: {v!r} is not a CSP source (an origin such as https://ha.example.com, or 'none')")
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
                 read_only=bool(a.read_only), ha_frame_origins=tuple(a.ha_frame_origin),
                 house_tz=a.house_tz, trusted_proxies=tuple(a.trusted_proxy),
                 audit_retention_days=float(a.audit_retention_days), hk_files=Path(a.hk_files),
                 backup_target=Path(a.backup_target) if a.backup_target else None,
                 backup_key_file=Path(a.backup_key_file) if a.backup_key_file else None,
                 backup_time=a.backup_time, backup_keep_daily=a.backup_keep_daily,
                 backup_keep_weekly=a.backup_keep_weekly, backup_include_files=not a.backup_no_files,
                 ma_url=a.ma_url, ma_token_file=Path(a.ma_token_file),
                 ma_web_url=a.ma_web_url, frame_ancestors=tuple(a.frame_ancestors),
                 csp_connect_src=tuple(a.csp_connect_src), csp_frame_src=tuple(a.csp_frame_src),
                 proxy_kind=a.proxy_kind,
                 ingress=bool(a.ingress or a.connect),
                 ingress_peers=tuple(peers) or (Config.ingress_peers if a.ingress else ()),
                 connect=bool(a.connect), connect_port=a.connect_port, connect_listen=a.connect_listen,
                 connect_address=a.connect_address,
                 ingress_only=bool(a.ingress_only), ha_door_rules=a.ha_door_rules, ha_ws_url=a.ha_ws_url,
                 ha_core_peers=tuple(core_peers),
                 ha_managed_by_app=bool(a.ha_managed_by_app),
                 supervisor_url=a.supervisor_url.rstrip("/"),
                 announce_file=Path(a.announce_file) if a.announce_file else None,
                 log_level=a.log_level, go2rtc_url=a.go2rtc_url.rstrip("/"),
                 live_tv_hardware="" if a.live_tv_hardware == "none" else a.live_tv_hardware,
                 direct_port=a.direct_port, stream_port=a.stream_port, direct_tls="" if a.direct_tls == "none" else a.direct_tls,
                 direct_hosts=_direct_hosts(a) if a.direct_port else (), lan_networks=tuple(lan_networks),
                 acme_directory=a.acme_directory, acme_email=a.acme_email.strip(),
                 acme_dns_token_file=Path(a.acme_dns_token_file) if a.acme_dns_token_file else None,
                 acme_dns_provider=a.acme_dns_provider,
                 ha_browser_url=a.ha_browser_url.rstrip("/"), ha_oauth_url=a.ha_oauth_url.rstrip("/"),
                 cf_access_team=cf_team, cf_access_aud=cf_auds)
    assert cfg.host in LOOPBACK or cfg.public_url, "Mantel listens beyond loopback only in container mode"
    return cfg


def _direct_hosts(a) -> tuple[str, ...]:
    """The Host names the direct listener answers: the public URL's (with and without its port), plus extras."""
    u = urlparse(a.public_url)
    names = [u.netloc.lower(), u.hostname.lower(), *(h.strip().lower() for h in a.direct_host if h.strip())]
    return tuple(dict.fromkeys(names))
