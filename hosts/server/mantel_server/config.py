from __future__ import annotations

import argparse
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
    hk_files: Path = REPO / "spikes/hk-snapshot/hk_local"      # "Your files": SF Pro + glyphs (Apple's; never committed)
    fixtures: Path = REPO / "spikes/hk-snapshot/fixtures"      # captured HK feeds (personal data; git-ignored)
    web: Path = REPO / "web"
    data_dir: Path = Path("~/.local/share/mantel")
    secrets_dir: Path = Path("~/.config/mantel/secrets")    # at-rest key file (created 0700/0600 on first use)
    session_hours: float = 12.0                              # session lifetime on the tunnel door
    lan_session_days: float = 30.0                           # session lifetime on the LAN door
    access_minutes: float = 15.0                             # access token lifetime (the refresh token rotates)
    device_rotate_hours: float = 24.0                        # wall tablet credential rotation
    webauthn_rp_id: str = "localhost"                        # passkeys: the RP ID (a hostname, never an IP)
    trusted_proxies: tuple[str, ...] = ()                    # peers whose X-Forwarded-For is believed (P3.6)
    # P3.4: Music Assistant's own WebSocket API (connectors/ma.py). Empty URL = connector off.
    # The long-lived token is read from this secret file at each connect, never from env or logs.
    ma_url: str = ""
    ma_token_file: Path = Path("/run/secrets/ma_token")
    # Container mode (packaging/): the server listens on the container's interface behind Caddy.
    # An empty public_url is the loopback prototype. parse_args holds the rules that guard it.
    public_url: str = ""                      # https://mantel.example.com/ : the address browsers use (via Caddy)
    allowed_hosts: tuple[str, ...] = ()       # Host header names accepted besides loopback; "*" = any

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
    p.add_argument("--listen", default=None, metavar="ADDRESS",
                   help="container mode: listen on this address (e.g. 0.0.0.0 inside a container whose only "
                        "published port belongs to Caddy). Needs --public-url. Default: loopback only")
    p.add_argument("--public-url", default="", metavar="URL",
                   help="container mode: the https:// address browsers use; sets HA's OAuth client id and "
                        "the Host name accepted besides loopback")
    p.add_argument("--allow-host", action="append", default=[], metavar="NAME",
                   help="container mode: another Host header name to accept (repeatable). '*' accepts any "
                        "and is only for a server whose sole way in is a trusted proxy (HA Ingress)")
    a = p.parse_args(argv)
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
                 public_url=public_url, allowed_hosts=allowed)
    assert cfg.host in LOOPBACK or cfg.public_url, "Mantel listens beyond loopback only in container mode"
    return cfg
