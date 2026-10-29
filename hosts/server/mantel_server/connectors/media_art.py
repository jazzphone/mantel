"""Media player artwork through Mantel (PLAN §4 "proxies, not copies"; the camera stills' twin).

HA signs a media player's artwork with the player's own token: ``entity_picture`` (and
``entity_picture_local``) read ``/api/media_player_proxy/<entity>?token=…&cache=…``. A page that used
it would hold an HA token and fetch from HA directly, which works only on HA's own origin (the
Ingress frame), never in Docker/LXC mode. So, as for cameras (camera_still.py):

* **States leaving Mantel carry no HA artwork token.** ``shape`` moves every such picture to Mantel's
  own route, ``<prefix>/api/media/<entity>/art?v=<version>``; ``v`` is the same opaque keyed tag as a
  camera's (it changes with HA's ``cache=``/token, so artwork follows the track). Remote pictures (an
  ``http(s)://`` URL HA passes through when the image is remotely accessible) carry no HA token and
  are left alone.
* **The route** ``GET /api/media/<entity>/art`` lets anyone who may ``view`` the player see its
  artwork, and streams HA's ``/api/media_player_proxy/<entity>`` with Mantel's own credential.

**Scaled to the tile** (2026-10-29; the scaling is hk_core/art, shared with HK Frontend's art.py). A page that
asks ``?s=<px>`` gets the picture scaled to the next size bucket (150, 300, 600, 1000) as a JPEG, kept in memory
(48 MB, most recently used) so the next tablet's tile costs nothing, instead of a cover that may be several
megabytes; without ``s`` the picture comes through as it always did. The key of the kept copy is the player's own
artwork address as HA last gave it (never the page's ``v``), so an old ``v`` can't keep an old cover.

**Remote covers** -- Music Assistant names most artwork by its original address (Apple's CDN, MA's own image
proxy): ``GET /api/media/art?e=<base64url address>&s=<px>`` fetches it here (the internet, or on the home
network only Music Assistant's ``/imageproxy/``; every redirect checked again: hk_core/art/fetch.py), scales it
and serves it from the page's own origin -- so a wall tablet with no internet shows the cover, and nothing but
the scaled picture crosses the wire. ``feature:media`` decides, as for the screensaver's photos. The page makes
the address itself (``hk_frontend/art/sign`` is answered in the page, mantel-host.js).
"""
from __future__ import annotations

import asyncio
import logging
import re
import socket
from typing import Any, Awaitable, Callable

import aiohttp
from aiohttp import web
from hk_core.art import fetch as art_fetch
from hk_core.art import resize as art_resize

from . import camera_still, person_picture
from ..guards import guard

log = logging.getLogger("mantel.media_art")

PATH = "/api/media/{entity_id}/art"
PLAYER_ID = re.compile(r"^media_player\.[a-z0-9_]+$")
PICTURE_ATTRS = ("entity_picture", "entity_picture_local")
HA_PROXY = "/api/media_player_proxy/"
REMOTE_PATH = "/api/media/art"
RENDERS = 2                                      # pictures scaled at once (a thread each)
SAFE_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"}
SCALED = {"Cache-Control": "private, max-age=86400", **SAFE_HEADERS}


class _Failed(Exception):
    """HA could not give a player's picture: the answer to send."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status, self.code = status, code


def art_url(entity_id: str, base: str = "", version: str | None = None) -> str:
    url = f"{base}/api/media/{entity_id}/art"
    return f"{url}?v={version}" if version else url


def shape(entity_id: str, state: dict, base: str = "") -> dict:
    """A media player's state with HA's signed artwork URLs moved to Mantel. Anything else as is."""
    if not isinstance(entity_id, str) or not entity_id.startswith("media_player.") or not isinstance(state, dict):
        return state
    attrs = state.get("a") or {}
    hit = [k for k in PICTURE_ATTRS if isinstance(attrs.get(k), str) and attrs[k].startswith(HA_PROXY)]
    if not hit:
        return state
    out = dict(attrs)
    for k in hit:
        out[k] = art_url(entity_id, base, camera_still.version_of(attrs[k])) if PLAYER_ID.match(entity_id) else None
    return {**state, "a": out}


def page_shaper(base: str = "", ha_url: str = "") -> Callable[[str, dict], dict]:
    """Every page state: camera/artwork tokens replaced and HA portraits served on this origin."""
    def shaped(entity_id: str, state: dict) -> dict:
        camera = camera_still.shape(entity_id, state, base)
        artwork = shape(entity_id, camera, base)
        return person_picture.shape(entity_id, artwork, base, ha_url)
    return shaped


def strip_tokens(entity_id: str, row: Any) -> Any:
    """A history row (HA's compressed state: ``a`` = attributes) without any HA token: a camera's
    ``access_token`` and either kind of signed picture removed outright (history never shows them)."""
    if not isinstance(row, dict) or not isinstance(row.get("a"), dict) or not isinstance(entity_id, str):
        return row
    attrs = row["a"]
    drop = set()
    if entity_id.startswith("camera."):
        drop |= {"access_token", "entity_picture"}
    if entity_id.startswith("media_player."):
        drop |= {k for k in PICTURE_ATTRS if isinstance(attrs.get(k), str) and attrs[k].startswith(HA_PROXY)}
    if not drop & set(attrs):
        return row
    return {**row, "a": {k: v for k, v in attrs.items() if k not in drop}}


class Scaled:
    """The scaled covers: hk_core's cache (most recently used, bounded by bytes) and one job per (address, size) at
    a time -- tablets that ask for the same cover while it is fetched wait for that one fetch."""

    def __init__(self) -> None:
        self.resolve: Callable[[str, int], Awaitable[set[str]]] = _resolve      # (the tests give a house's own names)
        self.session: aiohttp.ClientSession | None = None                       # (made on the first remote cover)
        self.cache = art_resize.Cache()
        self._flying: dict[tuple, asyncio.Future] = {}
        self._renders = asyncio.Semaphore(RENDERS)
        self.fetches = 0

    async def run(self, fn: Callable, *args):
        """``fn`` in a thread, a few at a time (hk_core's ``render`` is CPU work: it must not stop the loop)."""
        async with self._renders:
            return await asyncio.to_thread(fn, *args)

    async def once(self, key: tuple, make: Callable[[], Awaitable]):
        hit = self.cache.get(key)
        if hit:
            return hit
        job = self._flying.get(key)
        if job is None:
            async def go():
                try:
                    self.fetches += 1
                    return await make()
                finally:
                    self._flying.pop(key, None)
            job = self._flying[key] = asyncio.ensure_future(go())
            job.add_done_callback(lambda t: t.cancelled() or t.exception())
        return await asyncio.shield(job)


async def _resolve(host: str, port: int) -> set[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return {i[4][0] for i in infos}


def _own_picture(state: dict | None) -> str | None:
    """HA's own artwork address of a player, as HA last gave it (never a page's), or None."""
    attrs = (state or {}).get("a") or {}
    return next((attrs[k] for k in PICTURE_ATTRS if isinstance(attrs.get(k), str) and attrs[k].startswith(HA_PROXY)), None)


def _scaled(body: bytes, ctype: str) -> web.Response:
    return web.Response(body=body, headers={"Content-Type": ctype, **SCALED})


def register(app: web.Application, hub: Any, authz: Any, token: Callable[[], str] | str) -> None:
    """``GET /api/media/<entity>/art``: ``view`` on the player decides; ``token`` is Mantel's HA credential.
    ``GET /api/media/art``: a remote cover, fetched and scaled here (``feature:media``)."""
    get_token = token if callable(token) else (lambda: token)
    app["media_art"] = {"served": 0, "refused": 0, "scaled": 0}
    app["media_art_scaled"] = scaled = Scaled()

    def web_session() -> aiohttp.ClientSession:
        """Our own session for covers on other hosts: no cookies kept, nothing of Mantel's attached."""
        if scaled.session is None:
            scaled.session = aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar())
        return scaled.session

    async def close_session(_app: web.Application) -> None:
        if isinstance(scaled.session, aiohttp.ClientSession):
            await scaled.session.close()

    def size_of(request: web.Request) -> int | None:
        """The size bucket asked for (``s``): None when none is, 0 for the original, else 150..1000."""
        raw = request.query.get("s")
        return None if raw is None else art_resize.snap(raw)

    @guard("signed_in")          # any session; the roles decide each player (authz.may_see)
    async def art(request: web.Request) -> web.StreamResponse:
        stats = request.app["media_art"]
        entity_id = request.match_info["entity_id"]
        if not PLAYER_ID.match(entity_id):
            return camera_still._error(404, "not_a_player")
        principal = authz.principal(request)
        if authz.may_see(principal, entity_id) is not True:
            stats["refused"] += 1
            return camera_still._error(403, "forbidden")
        if entity_id not in hub.store.states:
            return camera_still._error(404, "unknown_player")
        if set(request.query) - {"v", "s", "_hk"}:
            return camera_still._error(400, "bad_query")
        cfg = request.app["cfg"]
        url = f"{cfg.ha_url.rstrip('/')}{HA_PROXY}{entity_id}"
        size = size_of(request)
        own = _own_picture(hub.store.states.get(entity_id))
        if size is None or size == 0 or own is None:        # no size asked for: through, as it always was
            resp = await camera_still.proxy_image(request, url, {}, get_token(), f"artwork for {entity_id}",
                                                  "artwork_unavailable", not_found="no_artwork")
            if resp.status == 200:
                stats["served"] += 1
            return resp
        what = f"artwork for {entity_id}"
        key = (f"{entity_id} {camera_still.version_of(own)}", size)

        async def make():
            try:
                body, ctype = await camera_still.read_image(request.app, url, {}, get_token(), what)
            except camera_still.StillRefused as exc:
                raise _Failed(exc.status, "no_artwork" if exc.status == 404 else "artwork_unavailable") from exc
            out = await scaled.run(art_resize.render, body, size, ctype)
            scaled.cache.put(key, out)
            return out
        try:
            body, ctype = await scaled.once(key, make)
        except _Failed as exc:
            return camera_still._error(exc.status, exc.code)
        except art_resize.Refused as exc:
            log.info("%s: %s", what, exc)
            return camera_still._error(415, "artwork_unsupported")
        stats["served"] += 1
        stats["scaled"] += 1
        return _scaled(body, ctype)

    @guard("signed_in")          # any session; feature:media decides, as for the screensaver's photos
    async def remote(request: web.Request) -> web.StreamResponse:
        stats = request.app["media_art"]
        if set(request.query) - {"e", "s", "v", "_hk"}:
            return camera_still._error(400, "bad_query")
        principal = authz.principal(request)
        if principal is None or "feature:media" not in (authz.may_read(principal, "view", ["feature:media"]) or []):
            stats["refused"] += 1
            return camera_still._error(404, "not_found")
        address = art_fetch.dec(request.query.get("e"))
        if not art_fetch.is_remote(address):
            return camera_still._error(400, "bad_address")
        size = size_of(request)
        size = 300 if size is None else size
        try:
            got = await scaled.once((address, size), lambda: art_fetch.async_fetch(
                address, size, scaled.cache, web_session(), scaled.resolve, scaled.run))
        except art_resize.Refused as exc:
            log.info("remote artwork refused: %s", exc)
            return camera_still._error(415, "artwork_unsupported")
        if got is None:
            return camera_still._error(404, "no_artwork")
        stats["served"] += 1
        stats["scaled"] += 1
        return _scaled(*got)

    app.router.add_get(PATH, art)
    app.router.add_get(REMOTE_PATH, remote)
    app.on_cleanup.append(close_session)
