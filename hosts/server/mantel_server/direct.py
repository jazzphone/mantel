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
from ipaddress import ip_address

from aiohttp import web

log = logging.getLogger("mantel.direct")


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


def https_door(request: web.Request) -> str:
    """The door of a request on the built-in HTTPS listener: 'lan' from a private address, else 'tunnel'."""
    try:
        peer = ip_address(request.remote or "")
    except ValueError:
        return "tunnel"
    return "lan" if (peer.is_private or peer.is_loopback) and not peer.is_global else "tunnel"


def builtin_https(request: web.Request) -> bool:
    cfg = request.app.get("cfg")
    return getattr(cfg, "direct_tls", "") == "acme" and is_direct(request)


async def serve(app: web.Application, cfg, stop: asyncio.Event | None = None) -> None:
    """Run the Ingress listener and the direct one on one application until stopped."""
    runner = web.AppRunner(app)
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
