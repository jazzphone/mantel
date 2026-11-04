"""Wiring the Intercom into Mantel Server (server.wire): the host, its routes and feed, start and stop."""
from __future__ import annotations

from typing import Any

from aiohttp import web

from . import routes
from .host import IntercomHost


def register(app: web.Application, hub: Any, hooks: Any) -> IntercomHost:
    """``app["intercom"]`` always; the stream listener only while commands and the Intercom are on (host.apply)."""
    host = IntercomHost(app, hub, lambda: app["clock"]())
    app["intercom"] = host
    host.listeners_feed = routes.register(app, host, hooks)

    async def start(_app: web.Application) -> None:
        await host.apply()

    async def stop(_app: web.Application) -> None:
        await host.close()
    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return host
