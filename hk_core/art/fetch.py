"""WHERE ARTWORK MAY BE FETCHED FROM, and the fetch (moved here from HK Frontend's art.py, 2026-10-29, for Mantel too).

Music Assistant hands out artwork as the ORIGINAL URL -- most of it https://is1-ssl.mzstatic.com/... -- and a wall
tablet kept off the internet cannot fetch those. So the server fetches it (``async_fetch``), scales it (resize.py) and
serves it from the page's own origin.

WHERE IT MAY GO: the artwork Music Assistant names, nothing else. A cover is on the internet (the CDNs) or on Music
Assistant's own image proxy, which is on the home network (http://<host>:8095/imageproxy/<id>). Any signed-in user -- a
wall tablet's own -- can ask, so "fetch any URL" would let one reach the router's or a camera's pages, or the host
itself. So: any address on the internet; on the home network only an /imageproxy/ path; never link-local (cloud
metadata), multicast or unspecified. Checked again at every redirect, which is followed by hand.

The host supplies what differs: ``resolve(host, port)`` (an awaitable giving the addresses a name has) and ``run(fn,
*args)`` (an awaitable running ``resize.render`` off the event loop). No Home Assistant, no aiohttp import: the
``session`` is any object with aiohttp's ``get``.
"""
from __future__ import annotations

import base64
import ipaddress
import logging
from typing import Awaitable, Callable
from urllib.parse import unquote, urljoin, urlsplit

from . import resize

log = logging.getLogger(__name__)

MAX_BYTES = 8_000_000
TIMEOUT_S = 12
MA_PROXY_PATH = "/imageproxy/"
MAX_HOPS = 3

Resolve = Callable[[str, int], Awaitable["set[str]"]]
Run = Callable[..., Awaitable]


async def read_limited(stream, limit: int) -> bytes | None:
    """ALL of a body, or None past `limit` bytes.

    Not `stream.read(limit)`: aiohttp's StreamReader.read(n) returns what has
    ARRIVED, up to n -- the first network chunk -- not the whole body: a
    cover would be served as its first ~1.4 KB, and a hold-to-talk clip
    longer than a chunk cut the same way. hk_core/link/talk.py keeps its own copy: Mantel Link vendors only link/."""
    data = bytearray()
    async for chunk in stream.iter_chunked(65536):
        data += chunk
        if len(data) > limit:
            return None
    return bytes(data)


def is_remote(url) -> bool:
    return isinstance(url, str) and url.lower().startswith(("http://", "https://")) \
        and len(url) < 2048


def dot_segments(path: str) -> bool:
    """A '.' or '..' segment, as typed or percent-encoded: the client normalises it away before fetching, so
    '/imageproxy/../x' would be checked as the proxy's path and fetched as '/x'."""
    for _ in range(3):                       # %252e decodes to %2e decodes to '.'
        path = unquote(path)
    return any(seg in (".", "..") for seg in path.split("/"))


async def allowed(url: str, resolve: Resolve) -> bool:
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname or dot_segments(p.path):
        return False
    try:
        port = p.port or (443 if p.scheme == "https" else 80)
        ips = [ipaddress.ip_address(a.split("%")[0]) for a in await resolve(p.hostname, port)]
    except (OSError, ValueError):
        return False
    if not ips:
        return False
    if all(ip.is_global for ip in ips):
        return True
    if any(ip.is_link_local or ip.is_multicast or ip.is_unspecified for ip in ips):
        return False
    return p.path.startswith(MA_PROXY_PATH)


# THE ADDRESS TRAVELS ENCODED, NOT AS A URL. A reverse proxy in front of Home Assistant (openresty -- Nginx Proxy
# Manager's "block common exploits") answers 403 to a query string holding "http://", and async_sign_path decodes
# whatever quote() did back into exactly that. Through such a proxy every cover would be refused and show the
# placeholder, while a browser on http://<ip>:8123, which bypasses the proxy, is fine. base64url has nothing in it for
# the signer to decode or the proxy to match. `u=` (the plain address) is still read, for a path signed in that older
# form.
def enc(url: str) -> str:
    return base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")


def dec(value) -> str:
    if not isinstance(value, str) or not value:
        return ""
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode()
    except (ValueError, UnicodeDecodeError):
        return ""


async def async_fetch(url: str, size: int, cache: resize.Cache, session, resolve: Resolve, run: Run
                      ) -> tuple[bytes, str] | None:
    """(body, type) to serve, None when there is nothing there (not an image at all, an error, too long). Raises
    resize.Refused -- see resize.render()."""
    key = (url, size)
    hit = cache.get(key)
    if hit:
        return hit
    at, data, ctype = url, None, ""
    try:
        for _hop in range(MAX_HOPS + 1):
            if not await allowed(at, resolve):
                log.debug("art: %s is not artwork's to fetch", at)
                return None
            async with session.get(at, timeout=TIMEOUT_S, allow_redirects=False) as r:
                loc = r.headers.get("Location")
                if r.status in (301, 302, 303, 307, 308) and loc:
                    at = urljoin(at, loc)
                    continue
                ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if r.status != 200 or not ctype.startswith("image/"):
                    log.debug("art: %s answered %s %s", at, r.status, ctype)
                    return None
                data = await read_limited(r.content, MAX_BYTES)
                break
        if data is None:
            return None
    except Exception as err:  # noqa: BLE001 - a missing tile is not an error
        log.debug("art: %s failed: %s", url, err)
        return None
    out = await run(resize.render, data, size, ctype)
    cache.put(key, out)
    return out
