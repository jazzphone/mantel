"""The per-install door key for "bring your own reverse proxy".

The trusted proxy's address alone is not enough there: a proxy host set up without Mantel's headers (Nginx
Proxy Manager's defaults) passes a browser's own ``X-Mantel-Door: lan`` through, and Mantel would believe it.
So in that mode (``cfg.proxy_kind == "own"``) the door counts only when the proxy also sends this
installation's secret in ``X-Mantel-Door-Key``; without the right key the door header is ignored and the
request is the tunnel door (fail closed).

* **The key** is 32 random bytes (URL-safe text), made on first use, kept sealed with the at-rest key in
  ``<data_dir>/connections/door_key.connection`` (connections.SealedFiles: 0600, inside every encrypted
  backup). Shown only to an Owner (/proxy-check, the Connections page's HTTPS panel, ``mantel door-key``),
  rotatable there; never logged, never in an audit row. Rotating means pasting the new key into the proxy.
* **Mantel's Caddy and the HA App** need none: Caddy is the only peer on Mantel's backend network and
  stamps the header itself (its trusted-address path stays), and Ingress has its own door.
* ``proxy_trust`` removes the key header from everyone but the trusted proxy, like the door header.
"""
from __future__ import annotations

import hmac
import logging
import secrets
import time
from typing import Any, Callable

log = logging.getLogger("mantel.door_key")

HEADER = "X-Mantel-Door-Key"
KIND = "door_key"
PLACEHOLDER = "MANTEL_DOOR_KEY"


def required(cfg: Any) -> bool:
    """The key is required for the door only with the home's own proxy (MANTEL_PROXY_KIND=own)."""
    return (getattr(cfg, "proxy_kind", "") or "") == "own"


class DoorKey:
    def __init__(self, files: Any, clock: Callable[[], float] = time.time) -> None:
        self.files = files          # connections.SealedFiles (the same sealed folder as the connections)
        self.clock = clock
        self._value: str | None = None
        self._since: float | None = None
        self._seen: int | None = None

    def _mtime(self) -> int | None:
        try:
            return self.files.path(KIND).stat().st_mtime_ns
        except OSError:
            return None

    def _load(self) -> None:
        # read again when the sealed file changed (`mantel door-key --rotate` beside a running server)
        if self._value is not None and self._mtime() == self._seen:
            return
        self._value = None
        try:
            rec = self.files.load(KIND)
        except Exception as exc:  # noqa: BLE001 -- another at-rest key, a damaged file: make a new one
            log.error("door key could not be opened (%s); a new one is made (paste it into your proxy)",
                      type(exc).__name__)
            rec = None
        if rec is None:
            self.rotate()
        else:
            self._value, self._since = rec.token, rec.since
        self._seen = self._mtime()

    def value(self) -> str:
        self._load()
        return self._value or ""

    def since(self) -> float | None:
        self._load()
        return self._since

    def rotate(self) -> str:
        from ..connections import Record
        key = secrets.token_urlsafe(32)
        now = self.clock()
        self.files.save(Record(kind=KIND, url="", token=key, method="generated", since=now))
        self._value, self._since = key, now
        self._seen = self._mtime()
        return key

    def matches(self, given: str | None) -> bool:
        if not given:
            return False
        return hmac.compare_digest(given.strip().encode(), self.value().encode())


def of(app: Any) -> DoorKey | None:
    return app.get("door_key")


def install(app: Any) -> DoorKey | None:
    """app["door_key"], over the Connections' sealed folder (call after connections.register)."""
    conns = app.get("connections")
    if conns is None:
        return None
    key = DoorKey(conns.files, lambda: app["clock"]() if "clock" in app else time.time())
    app["door_key"] = key
    return key


def status(request: Any) -> str:
    """'not_needed' | 'ok' | 'missing' | 'wrong' for this request's key header (from the trusted proxy)."""
    if not required(request.app.get("cfg")):
        return "not_needed"
    values = request.headers.getall(HEADER, [])
    if not values:
        return "missing"
    key = of(request.app)
    return "ok" if key is not None and len(values) == 1 and key.matches(values[0]) else "wrong"


def door_allowed(request: Any) -> bool:
    """authz.resolve_door: may the trusted proxy's `lan` claim count? (Always, unless the key is required.)"""
    return status(request) in ("not_needed", "ok")


def cli(argv: list[str]) -> int:
    """``mantel door-key [--rotate]``: print this installation's door key (for the proxy's configuration)."""
    import argparse
    from pathlib import Path

    from .. import atrest
    from ..config import Config
    from ..connections import SealedFiles
    p = argparse.ArgumentParser(prog="mantel door-key", description="the door key your own reverse proxy sends")
    p.add_argument("--data-dir", default=str(Config.data_dir))
    p.add_argument("--secrets-dir", default=str(Config.secrets_dir))
    p.add_argument("--rotate", action="store_true", help="make a new key (then paste it into your proxy)")
    a = p.parse_args(argv)
    cfg = Config(data_dir=Path(a.data_dir), secrets_dir=Path(a.secrets_dir))
    key = DoorKey(SealedFiles(cfg.connections_dir, atrest.SecretBox(cfg.secrets_dir / atrest.KEY_FILE)))
    value = key.rotate() if a.rotate else key.value()
    print(f"proxy_set_header {HEADER} {value};")
    print("(Nginx Proxy Manager: the Advanced block; Traefik: customRequestHeaders. A running server uses a rotated "
          "key at once.)")
    return 0
