"""HA App direct access (decision 26; docs/phase3/HA-APP.md "Direct access"): Mantel's own address, besides HA's sidebar.

The HA App is reached through HA's Ingress panel on ``cfg.port`` (8099), where the Supervisor vouches for the
signed-in HA user and everything else is refused (``--ingress-only``). With direct access on, the App also
listens on ``cfg.direct_port`` (8100 inside the container; the host port is whatever the App's Network
section maps it to), so tablets and devices at home can open ``https://<Mantel's name>/<screen>/home``:

* **Never Ingress.** A request that arrived on the direct listener is not an Ingress request, whoever its
  socket peer is (ingress.is_ingress asks ``is_direct`` first): X-Remote-User-* and X-Ingress-Path are
  removed there (proxy_trust) and Mantel's own sign-in applies -- "Sign in with Home Assistant", Mantel's
  password or passkey, enrolled wall-tablet devices -- with the LAN or tunnel rules of the request's door.
* **The Ingress-only gate lets exactly this listener through** (ingress.middleware); the Ingress port keeps
  refusing every other peer, and HA Core's linked-mode exception stays on the Ingress port only.
* **Its own Host names** (``cfg.direct_hosts``: the public URL's host, plus ``--direct-host``): the App
  accepts any Host on the Ingress port (HA's proxy forwards whatever it was given), never on this one.
* **The trusted proxy counts here only.** ``--trusted-proxy`` addresses (the home's own proxy) are believed
  for forwarding and door headers on the direct listener alone (proxy_trust.is_trusted), with the door key.
* **Built-in HTTPS** (``cfg.direct_tls == "acme"``, direct_tls.py): the listener serves TLS itself. No proxy
  stamps a door there, so the socket peer decides: a private (home) address is the LAN door, anything else
  the tunnel door. Never forward this port from the internet: Docker's port mapping can make every client
  look like the HA host's bridge address (a private one), so the internet would get the LAN rules.
"""
from __future__ import annotations

import asyncio
import logging
import signal
from ipaddress import ip_address, ip_network

from aiohttp import web

log = logging.getLogger("mantel.direct")

SHUTDOWN_TIMEOUT = 5        # seconds a stop waits for open sockets (Docker kills an App after about 10)


def enabled(cfg) -> bool:
    return bool(getattr(cfg, "direct_port", 0))


def is_direct(request: web.Request) -> bool:
    """True for a request that arrived on the direct listener (its socket's local port is ``direct_port``)."""
    cfg = request.app.get("cfg")
    port = getattr(cfg, "direct_port", 0)
    if not port:
        return False                       # not the App's direct access: nothing to tell apart
    cached = request.get("direct")
    if cached is not None:
        return cached
    got = False
    if request.transport is not None:
        sock = request.transport.get_extra_info("sockname")
        got = isinstance(sock, tuple) and len(sock) >= 2 and sock[1] == port
    request["direct"] = got
    return got


def host_allowed(cfg, hostname: str) -> bool:
    """server.loopback_only on the direct listener: only Mantel's own names (never the App's '*')."""
    return hostname.lower() in tuple(getattr(cfg, "direct_hosts", ()) or ())


# The home's networks by default (RFC 1918, IPv6 unique-local, the container's own loopback).
DEFAULT_LAN_NETWORKS = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7", "127.0.0.0/8", "::1/128")
# Never the LAN door, whatever lan_networks says: HA's hassio network (other Apps, HA Core, the host's own
# processes, and every client Docker's userland proxy or a hairpin relays, which all arrive as 172.30.32.1)
# and Docker's default bridge. Fail closed: such a peer is the tunnel door.
NEVER_LAN = ("172.30.32.0/23", "fd0c:ac1e:2100::/48", "172.17.0.0/16")


def _networks(values) -> tuple:
    return tuple(ip_network(v, strict=False) for v in values)


_NEVER = _networks(NEVER_LAN)


def in_lan(cfg, address: str | None) -> bool:
    """Is this address one of the home's networks (and none of NEVER_LAN)?"""
    try:
        ip = ip_address(address or "")
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if any(ip in n for n in _NEVER if n.version == ip.version):
        return False
    nets = _networks(getattr(cfg, "lan_networks", ()) or DEFAULT_LAN_NETWORKS)
    return any(ip in n for n in nets if n.version == ip.version)


def never_lan(address: str) -> bool:
    """An address in HA's hassio or Docker's bridge network (a proxy listed there trusts everyone it relays)."""
    try:
        ip = ip_address(address)
    except ValueError:
        return False
    return any(ip in n for n in _NEVER if n.version == ip.version)


def https_door(request: web.Request) -> str:
    """The door of a request on the built-in HTTPS listener: 'lan' from the home's networks, else 'tunnel'."""
    cfg = request.app.get("cfg") if getattr(request, "app", None) is not None else None
    return "lan" if in_lan(cfg, request.remote) else "tunnel"


def certificate_pending(request: web.Request) -> bool:
    """Built-in HTTPS is still on its self-signed placeholder (direct_tls.CertManager.pending)."""
    mgr = request.app.get("direct_tls")
    return mgr is not None and bool(getattr(mgr, "pending", False)) and builtin_https(request)


def pending_response() -> web.Response:
    return web.Response(status=503, content_type="text/html", headers={"Retry-After": "60", "Cache-Control": "no-store"},
                        text="<!doctype html><meta charset='utf-8'><title>Mantel: certificate pending</title>"
                             "<p>Mantel is still getting its HTTPS certificate for this address, so nobody can sign "
                             "in here yet. Try again in a few minutes; until then use Mantel in Home Assistant's "
                             "sidebar. (The App's log says what it is waiting for.)</p>")


def builtin_https(request: web.Request) -> bool:
    cfg = request.app.get("cfg")
    return getattr(cfg, "direct_tls", "") == "acme" and is_direct(request)


async def serve(app: web.Application, cfg, stop: asyncio.Event | None = None) -> None:
    """Run the Ingress listener and the direct one on one application until stopped."""
    runner = web.AppRunner(app, shutdown_timeout=SHUTDOWN_TIMEOUT)
    await runner.setup()
    try:
        await web.TCPSite(runner, cfg.host, cfg.port).start()
        ssl_ctx = None
        if getattr(cfg, "direct_tls", "") == "acme":
            ssl_ctx = app["direct_tls"].ssl_ctx
        await web.TCPSite(runner, cfg.host, cfg.direct_port, ssl_context=ssl_ctx).start()
        log.info("direct access: listening on %s:%s (%s)", cfg.host, cfg.direct_port,
                 "HTTPS, Mantel's own certificate" if ssl_ctx is not None else "plain HTTP for your own proxy")
        stop = stop or asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop.set)
            except NotImplementedError:
                pass
        await stop.wait()
    finally:
        await runner.cleanup()
