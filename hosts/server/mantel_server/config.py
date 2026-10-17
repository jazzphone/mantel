from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path

LOOPBACK = {"127.0.0.1", "::1"}
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
    hk_frontend: Path = REPO / "spikes/hk-snapshot/frontend"   # HK's cards/modules/css (git-ignored snapshot)
    hk_files: Path = REPO / "spikes/hk-snapshot/hk_local"      # "Your files": SF Pro + glyphs (Apple's; never committed)
    fixtures: Path = REPO / "spikes/hk-snapshot/fixtures"      # captured HK feeds (personal data; git-ignored)
    web: Path = REPO / "web"
    data_dir: Path = Path("~/.local/share/mantel")
    session_hours: float = 12.0

    @property
    def client_id(self) -> str:  # Mantel's own URL; HA requires redirect_uri on the same host
        return f"http://{self.host}:{self.port}/"

    @property
    def redirect_uri(self) -> str:
        return f"http://{self.host}:{self.port}/auth/callback"


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
    p.add_argument("--session-hours", type=float, default=Config.session_hours)
    a = p.parse_args(argv)
    overrides = []
    for item in a.override:
        pattern, _, secs = item.rpartition("=")
        if not pattern:
            p.error(f"--override needs GLOB=SECONDS, got {item!r}")
        overrides.append((pattern, float(secs)))
    # The listen address is deliberately not configurable: loopback only in this prototype.
    cfg = Config(ha_url=a.ha_url, token_file=Path(a.token_file), port=a.port,
                  default_interval=a.default_interval, overrides=overrides,
                 data_dir=Path(a.data_dir), session_hours=a.session_hours, default_screen=a.screen)
    assert cfg.host in LOOPBACK, "Mantel listens on loopback only in this prototype"
    return cfg
