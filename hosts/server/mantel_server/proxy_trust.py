"""Who may tell Mantel about the browser: the trusted reverse proxy, and nobody else.

Mantel can sit behind Mantel's own Caddy, behind the home's own reverse proxy (Nginx Proxy Manager,
Traefik, ...: "bring your own proxy", docs/phase3/PACKAGING.md), or nothing (loopback). The rules are the
same in every case and are enforced HERE, not left to the proxy's configuration:

* **Forwarding headers** (``X-Forwarded-For`` / ``-Proto`` / ``-Host`` / ``-Port`` / ``-Prefix``,
  ``Forwarded``, ``X-Real-IP``) count only from a ``--trusted-proxy`` peer (or HA's Ingress proxy, whose
  forwarded host and client ingress.py reads). From anyone else they are removed before any handler
  sees them.
* **The door header** ``X-Mantel-Door`` is believed only from a trusted proxy (authz.resolve_door: a
  trusted proxy that sends none means the tunnel: fail closed). From any other non-loopback peer it is
  removed; the request is the tunnel door either way. (A loopback peer keeps it: the loopback prototype
  and the tests say ``tunnel`` to tighten the rules.)
* **Identity headers** (``X-Remote-User-*``, ``X-Ingress-Path``, ``X-Hass-Source``) count only through
  HA's Ingress (ingress.is_ingress). From everyone else, a trusted proxy included, they are removed: the
  home's own proxy must never be able to name a signed-in person.

Removing is done on a clone of the request (aiohttp's headers are immutable); whatever the handler stores
on the clone (queued cookies, the page's prefix, ...) is copied back to the original afterwards, because
aiohttp prepares a returned response with the original request.
"""
from __future__ import annotations

import logging
import time
from ipaddress import ip_address

from aiohttp import web

log = logging.getLogger("mantel.proxy_trust")

FORWARDING = ("X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Host", "X-Forwarded-Port",
              "X-Forwarded-Prefix", "Forwarded", "X-Real-IP")
IDENTITY = ("X-Remote-User-Id", "X-Remote-User-Name", "X-Remote-User-Display-Name", "X-Ingress-Path",
            "X-Hass-Source")
DOOR = "X-Mantel-Door"
WARN_EVERY = 300.0
_warned: dict[tuple[str, str], float] = {}


def _cfg(request: web.Request):
    return request.app.get("cfg")


def listed(request: web.Request) -> bool:
    """The socket peer is one of the configured ``--trusted-proxy`` addresses (exact match). In the HA App
    with direct access (direct.py) only on the direct listener: the Ingress port has no proxy of the home's."""
    cfg = _cfg(request)
    trusted = tuple(getattr(cfg, "trusted_proxies", ()) or ())
    if request.remote is None or request.remote not in trusted:
        return False
    from . import direct
    return not direct.enabled(cfg) or direct.is_direct(request)


def is_trusted(request: web.Request) -> bool:
    """A listed peer (above) whose forwarding and door headers count. On the HA App's direct port behind the
    home's own proxy, also only with this installation's door key: Docker may show every client, HA Core and
    other Apps as one address (172.30.32.1), so the address alone proves nothing there."""
    if not listed(request):
        return False
    from . import direct
    from .identity import door_key
    cfg = _cfg(request)
    if direct.enabled(cfg) and door_key.required(cfg):
        return door_key.status(request) == "ok"
    return True


def _is_loopback(peer: str | None) -> bool:
    try:
        return peer is not None and ip_address(peer).is_loopback
    except ValueError:
        return False


def _first(request: web.Request, name: str) -> str | None:
    values = request.headers.getall(name, [])
    if not values:
        return None
    return values[0].split(",")[0].strip() or None


def forwarded_proto(request: web.Request) -> str | None:
    """'http' / 'https' as the trusted proxy says (None from anyone else, or a value that is neither)."""
    if not is_trusted(request):
        return None
    proto = (_first(request, "X-Forwarded-Proto") or "").lower()
    return proto if proto in ("http", "https") else None


def is_https(request: web.Request) -> bool:
    """Is the browser on https? TLS on Mantel's own socket (the Connect listener), or the trusted
    proxy's X-Forwarded-Proto, or (through HA's Ingress) the scheme HA saw."""
    if request.secure:
        return True
    if forwarded_proto(request) == "https":
        return True
    from . import ingress
    if ingress.is_ingress(request):
        return ingress._https(request)
    return False


def public_host(request: web.Request) -> str:
    """The Host the browser used: the trusted proxy's (or Ingress') X-Forwarded-Host, else Host."""
    from . import ingress
    if is_trusted(request) or ingress.is_ingress(request):
        fwd = _first(request, "X-Forwarded-Host")
        if fwd:
            return fwd
    return request.host or ""


def public_origin(request: web.Request) -> str:
    return f"{'https' if is_https(request) else 'http'}://{public_host(request)}"


def _warn(peer: str, what: str) -> None:
    now = time.monotonic()
    key = (peer, what)
    if now - _warned.get(key, -WARN_EVERY) >= WARN_EVERY:
        if len(_warned) > 512:
            _warned.clear()
        _warned[key] = now
        log.warning("ignored %s from %s (only a trusted proxy may send it)", what, peer)


def to_remove(request: web.Request) -> list[str]:
    """The header names this request must lose before any handler reads it (see the module docstring)."""
    from . import ingress
    h = request.headers
    through_ingress = ingress.is_ingress(request)
    trusted = is_trusted(request)
    drop: list[str] = []
    if not through_ingress:
        ids = [n for n in IDENTITY if n in h]
        if ids:
            drop += ids
            ingress._warn_forged(request)        # "ignored HA identity headers (...) from <peer>", rate-limited
    if not listed(request) and "X-Mantel-Door-Key" in h:
        drop.append("X-Mantel-Door-Key")      # door_key.py: only the trusted proxy may present it
    if not (trusted or through_ingress):
        fwd = [n for n in FORWARDING if n in h]
        drop += fwd
        if DOOR in h and not _is_loopback(request.remote):
            drop.append(DOOR)
            if any(v.strip().lower() == "lan" for v in h.getall(DOOR, [])):
                _warn(request.remote or "?", f"{DOOR}: lan")
    return drop


HIDDEN_BEHIND_PROXY = frozenset({"/healthz"})   # the container's healthcheck asks on loopback, not the outside


@web.middleware
async def middleware(request: web.Request, handler):
    if request.path in HIDDEN_BEHIND_PROXY and is_trusted(request):
        raise web.HTTPNotFound()       # what Mantel's Caddy did (`respond /healthz 404`), behind any proxy
    drop = to_remove(request)
    if not drop:
        return await handler(request)
    gone = {n.lower() for n in drop}
    headers = [(k, v) for k, v in request.headers.items() if k.lower() not in gone]
    # remote/scheme passed on: a clone otherwise re-reads them from the socket, losing any earlier override
    clone = request.clone(headers=headers, remote=request.remote, scheme=request.scheme)
    try:
        return await handler(clone)
    finally:
        for k, v in clone.items():   # queued cookies, the page's prefix, ... (see the module docstring)
            request[k] = v
