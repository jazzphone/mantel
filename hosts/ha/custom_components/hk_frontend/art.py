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
what that origin serves must never be something a browser would RUN: an
upstream `image/svg+xml` (Pillow cannot read it, so passed through as it
came) opened as a page runs its script with HA's stored sign-in in reach. So a response is one of RASTER as it came, or a
JPEG this module encoded itself, always with nosniff and a sandboxing CSP --
anything else is 415. Re-encoding the rest (rather than refusing all of it)
keeps a BMP or TIFF cover showing, and what reaches the page is then bytes
Pillow wrote, not bytes a stranger chose. See render().
"""
from __future__ import annotations

from collections import OrderedDict
import base64
from datetime import timedelta
import io
import ipaddress
import logging
import socket
from urllib.parse import urljoin, urlsplit

from aiohttp import web
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback

_LOGGER = logging.getLogger(__name__)

URL = "/api/hk_frontend/art"
SIGN_HOURS = 24
MAX_BYTES = 8_000_000
MAX_URLS = 200
# THE CACHE IS BOUNDED BY BYTES, NOT JUST BY COUNT. A scaled tile is 10-60 KB
# at 150-600 px, but a 1000 px one is ~150-250 KB and a cover already under
# its size is kept as it came (a PNG can be megabytes): 400 of those is far
# more than 10 MB. CACHE_BYTES is the real ceiling.
CACHE_ITEMS = 400
CACHE_BYTES = 48_000_000
# Pixels, checked from the HEADER before anything is decoded. An 8 MB PNG can
# declare ~170 megapixels (half a gigabyte to decode, under Pillow's own bomb
# threshold); album art tops out near 3000 x 3000 = 9 MP. Past this, refused.
MAX_PIXELS = 25_000_000
SIZES = (0, 150, 300, 600, 1000)
TIMEOUT_S = 12
RASTER = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})
# On every response: never sniffed into another type, and a document opened
# from here (a path pasted into the address bar) runs nothing.
SAFE_HEADERS = {"X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox"}


class Refused(Exception):
    """Not served: not an image this proxy will pass, or too big to decode."""


def snap(size) -> int:
    """The smallest allowed size >= the one asked for (0 = original)."""
    try:
        size = int(size or 0)
    except (TypeError, ValueError):
        return 300
    if size <= 0:
        return 0
    return next((s for s in SIZES[1:] if s >= size), SIZES[-1])


async def read_limited(stream, limit: int) -> bytes | None:
    """ALL of a body, or None past `limit` bytes.

    Not `stream.read(limit)`: aiohttp's StreamReader.read(n) returns what has
    ARRIVED, up to n -- the first network chunk -- not the whole body: a
    cover would be served as its first ~1.4 KB, and a hold-to-talk clip
    longer than a chunk cut the same way. talk.py uses this too."""
    data = bytearray()
    async for chunk in stream.iter_chunked(65536):
        data += chunk
        if len(data) > limit:
            return None
    return bytes(data)


def is_remote(url) -> bool:
    return isinstance(url, str) and url.lower().startswith(("http://", "https://")) \
        and len(url) < 2048


# WHERE IT MAY GO: the artwork Music Assistant names, nothing else. A cover
# is on the internet (the CDNs) or on Music Assistant's own image proxy, which
# is on the home network (http://<host>:8095/imageproxy/<id>). Any signed-in
# user -- a wall tablet's own -- can ask, so "fetch any URL" would let one
# reach the router's or a camera's pages, or the host itself. So: any address
# on the internet; on the home network only an /imageproxy/ path; never
# link-local (cloud metadata), multicast or unspecified. Checked again at
# every redirect, which is followed by hand.
MA_PROXY_PATH = "/imageproxy/"
MAX_HOPS = 3


async def _addresses(hass: HomeAssistant, host: str, port: int) -> set[str]:
    infos = await hass.loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return {i[4][0] for i in infos}


async def allowed(hass: HomeAssistant, url: str) -> bool:
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        return False
    try:
        port = p.port or (443 if p.scheme == "https" else 80)
        ips = [ipaddress.ip_address(a.split("%")[0]) for a in await _addresses(hass, p.hostname, port)]
    except (OSError, ValueError):
        return False
    if not ips:
        return False
    if all(ip.is_global for ip in ips):
        return True
    if any(ip.is_link_local or ip.is_multicast or ip.is_unspecified for ip in ips):
        return False
    return p.path.startswith(MA_PROXY_PATH)


# THE ADDRESS TRAVELS ENCODED, NOT AS A URL. A reverse proxy in front of
# Home Assistant (openresty -- Nginx Proxy Manager's "block common exploits")
# answers 403 to a query string holding "http://", and async_sign_path
# decodes whatever quote() did back into exactly that. Through such a proxy
# every cover would be refused and show the placeholder, while a browser on
# http://<ip>:8123, which bypasses the proxy, is fine. base64url has nothing
# in it for the signer to decode or the proxy to match. `u=` (the plain
# address) is still read, for a path signed in that older form.
def enc(url: str) -> str:
    return base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")


def dec(value) -> str:
    if not isinstance(value, str) or not value:
        return ""
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode()
    except (ValueError, UnicodeDecodeError):
        return ""


def art_path(url: str, size: int) -> str:
    return f"{URL}?e={enc(url)}&s={snap(size)}"


def render(data: bytes, size: int, ctype: str) -> tuple[bytes, str]:
    """What to serve for these bytes: (body, content type). Runs in the
    executor. Raises Refused.

    * nothing is decoded until the header says it fits MAX_PIXELS;
    * a RASTER image no bigger than `size` (0 = any size) goes as it came;
    * anything else Pillow can read becomes a JPEG at most `size` px on its
      long side -- which is also how a non-RASTER type gets out at all;
    * what Pillow cannot read is refused: it is not a picture."""
    try:
        from PIL import Image
    except ImportError:
        if ctype in RASTER:
            return data, ctype
        raise Refused(f"{ctype} needs Pillow") from None
    try:
        im = Image.open(io.BytesIO(data))     # the header only: nothing decoded yet
        w, h = im.size
    except Exception as err:  # noqa: BLE001 - Pillow's own bomb check lands here too
        raise Refused(f"not an image ({type(err).__name__})") from err
    if w * h > MAX_PIXELS:
        raise Refused(f"{w}x{h} is over {MAX_PIXELS} pixels")
    if ctype in RASTER and (not size or max(w, h) <= size):
        return data, ctype
    target = size or max(w, h)
    try:
        if im.format == "JPEG":
            # Decode at 1/2, 1/4 or 1/8 scale straight out of the DCT, never
            # the full frame -- with the same 2x headroom thumbnail() keeps.
            im.draft("RGB", (target * 2, target * 2))
        im.thumbnail((target, target))
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        out = io.BytesIO()
        im.save(out, "JPEG", quality=85, optimize=True)
    except Exception as err:  # noqa: BLE001 - a truncated or odd file
        raise Refused(f"could not re-encode ({type(err).__name__})") from err
    return out.getvalue(), "image/jpeg"


class Cache:
    """Most recently used, at most `cap` items AND `max_bytes` of bodies."""

    def __init__(self, cap: int = CACHE_ITEMS, max_bytes: int = CACHE_BYTES):
        self._cap = cap
        self._max = max_bytes
        self._bytes = 0
        self._d: OrderedDict[tuple[str, int], tuple[bytes, str]] = OrderedDict()

    def get(self, key):
        v = self._d.get(key)
        if v is not None:
            self._d.move_to_end(key)
        return v

    def put(self, key, value):
        if len(value[0]) > self._max // 8:
            return                        # one body may not crowd out the rest
        old = self._d.pop(key, None)
        if old is not None:
            self._bytes -= len(old[0])
        self._d[key] = value
        self._bytes += len(value[0])
        while len(self._d) > self._cap or self._bytes > self._max:
            _, gone = self._d.popitem(last=False)
            self._bytes -= len(gone[0])

    @property
    def bytes(self) -> int:
        return self._bytes

    def __len__(self):
        return len(self._d)


async def async_fetch(hass: HomeAssistant, url: str, size: int, cache: Cache,
                      session=None) -> tuple[bytes, str] | None:
    """(body, type) to serve, None when there is nothing there (not an image
    at all, an error, too long). Raises Refused -- see render()."""
    key = (url, size)
    hit = cache.get(key)
    if hit:
        return hit
    if session is None:
        from homeassistant.helpers.aiohttp_client import async_get_clientsession
        session = async_get_clientsession(hass)
    at, data, ctype = url, None, ""
    try:
        for _hop in range(MAX_HOPS + 1):
            if not await allowed(hass, at):
                _LOGGER.debug("art: %s is not artwork's to fetch", at)
                return None
            async with session.get(at, timeout=TIMEOUT_S, allow_redirects=False) as r:
                loc = r.headers.get("Location")
                if r.status in (301, 302, 303, 307, 308) and loc:
                    at = urljoin(at, loc)
                    continue
                ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if r.status != 200 or not ctype.startswith("image/"):
                    _LOGGER.debug("art: %s answered %s %s", at, r.status, ctype)
                    return None
                data = await read_limited(r.content, MAX_BYTES)
                break
        if data is None:
            return None
    except Exception as err:  # noqa: BLE001 - a missing tile is not an error
        _LOGGER.debug("art: %s failed: %s", url, err)
        return None
    out = await hass.async_add_executor_job(render, data, size, ctype)
    cache.put(key, out)
    return out


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
