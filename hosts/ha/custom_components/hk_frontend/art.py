"""ARTWORK THROUGH HOME ASSISTANT: album art for screens that cannot reach it.

Music Assistant hands out artwork as the ORIGINAL URL -- most of it
https://is1-ssl.mzstatic.com/... -- and a wall tablet kept off the internet
cannot fetch those: a firewall that allows the hosts by name does not help,
because the CDN answers each lookup with different addresses, and a tile
waits out its timeout on a placeholder (a direct load can hang 30 s).
Music Assistant's own /imageproxy/<id> will not help:
the id is sha256(provider_instance + "/" + url), the dashboard never sees the
provider instance, and an id MA has not stored is a 404.

So Home Assistant fetches it -- HA can reach the internet and MA's local
imageproxy both -- scales it to the size the tile draws, keeps it in memory,
and serves it from the page's own origin (https, no mixed content):

    ws  hk_frontend/art/sign  {urls: [...], size: 300}
        -> {signed: {url: "/api/hk_frontend/art?u=...&s=300&authSig=..."}}
    GET /api/hk_frontend/art?u=<url>&s=<px>&authSig=...

THE PATHS ARE SIGNED (async_sign_path, which signs the query too), because
HA is reachable from the internet and an unsigned "fetch any URL" endpoint is
an open proxy. Signing needs an authenticated websocket, so only a signed-in
screen can mint one; SIGN_HOURS bounds how long a painted tile keeps working.
(HA's signing secret is drawn at start-up and never saved, so every path dies
with a restart; hk-base.js forgets them on reconnect.)

ONLY PIXELS GO OUT. Whatever comes back is served from HA's own origin, so
what that origin serves must never be something a browser would RUN: a
response is one of RASTER as it came, or a JPEG this module encoded itself,
always with nosniff and a sandboxing CSP -- anything else is 415.

THE SCALING AND THE RULES FOR WHERE ART MAY COME FROM ARE SHARED (2026-10-29):
they live in hk_core/art (resize.py: sizes, render, the cache; fetch.py: the
allowed destinations, the encoded address, the fetch), which Mantel's own art
route uses too. This module keeps what is Home Assistant's: name lookup through
HA's loop, its executor and web session, the websocket command, the signing
and the view. The names the tests and talk.py use are re-exported here.
"""
from __future__ import annotations

from datetime import timedelta
import logging
import socket

from aiohttp import web
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback

# the shared core: vendored as custom_components.hk_frontend.hk_core by the build (publish.py); Mantel imports the
# monorepo's hk_core
from .hk_core.art import fetch as _fetch
from .hk_core.art.fetch import (  # noqa: F401 -- shared (re-exported: tests and talk.py use these names)
    MA_PROXY_PATH, MAX_BYTES, MAX_HOPS, TIMEOUT_S, dec, enc, is_remote, read_limited)
from .hk_core.art.resize import (  # noqa: F401 -- shared
    CACHE_BYTES, CACHE_ITEMS, MAX_PIXELS, RASTER, SIZES, Cache, Refused, render, snap)

_LOGGER = logging.getLogger(__name__)

URL = "/api/hk_frontend/art"
SIGN_HOURS = 24
MAX_URLS = 200
# On every response: never sniffed into another type, and a document opened
# from here (a path pasted into the address bar) runs nothing.
SAFE_HEADERS = {"X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox"}


async def _addresses(hass: HomeAssistant, host: str, port: int) -> set[str]:
    infos = await hass.loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return {i[4][0] for i in infos}


def _dot_segments(path: str) -> bool:
    return _fetch.dot_segments(path)


async def allowed(hass: HomeAssistant, url: str) -> bool:
    """Whether artwork may be fetched from this address (hk_core/art/fetch.py), by HA's name lookup."""
    return await _fetch.allowed(url, lambda host, port: _addresses(hass, host, port))


def art_path(url: str, size: int) -> str:
    return f"{URL}?e={enc(url)}&s={snap(size)}"


async def async_fetch(hass: HomeAssistant, url: str, size: int, cache: Cache,
                      session=None) -> tuple[bytes, str] | None:
    """(body, type) to serve, None when there is nothing there (not an image
    at all, an error, too long). Raises Refused -- see render()."""
    if session is None:
        from homeassistant.helpers.aiohttp_client import async_get_clientsession
        session = async_get_clientsession(hass)
    return await _fetch.async_fetch(url, size, cache, session, lambda host, port: _addresses(hass, host, port),
                                    hass.async_add_executor_job)


def async_register(hass: HomeAssistant) -> Cache:
    cache = Cache()

    @websocket_api.websocket_command({
        vol.Required("type"): "hk_frontend/art/sign",
        vol.Required("urls"): vol.All([str], vol.Length(max=MAX_URLS)),
        vol.Optional("size", default=300): vol.Coerce(int),
    })
    @callback
    def ws_sign(hass, connection, msg):
        from homeassistant.components.http.auth import async_sign_path
        size = snap(msg["size"])
        signed = {}
        for u in msg["urls"]:
            if is_remote(u):
                signed[u] = async_sign_path(hass, art_path(u, size),
                                            timedelta(hours=SIGN_HOURS))
        connection.send_result(msg["id"], {"signed": signed})

    class ArtView(HomeAssistantView):
        url = URL
        name = "hk_frontend:art"
        requires_auth = True      # the signed path is the credential

        async def get(self, request: web.Request) -> web.Response:
            u = dec(request.query.get("e")) or request.query.get("u", "")
            if not is_remote(u):
                return web.Response(status=400, headers=SAFE_HEADERS)
            try:
                got = await async_fetch(hass, u, snap(request.query.get("s")), cache)
            except Refused as err:
                _LOGGER.debug("art: %s refused: %s", u, err)
                return web.Response(status=415, headers=SAFE_HEADERS)
            if got is None:
                return web.Response(status=404, headers=SAFE_HEADERS)
            return web.Response(body=got[0], content_type=got[1],
                                headers={"Cache-Control": "private, max-age=86400",
                                         **SAFE_HEADERS})

    websocket_api.async_register_command(hass, ws_sign)
    hass.http.register_view(ArtView())
    return cache
