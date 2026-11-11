"""The screensaver's own photos through Mantel (the camera stills' and media artwork's twin).

HK's screensaver walks a Home Assistant media folder (``media_source/browse_media``, readproxy.py) and then asks
``media_source/resolve_media`` for each photo it shows. HA answers with a signed address on HA's own origin
(``/media/local/<file>?authSig=…``), which a Mantel page cannot load (and should not hold). So Mantel answers that
read itself:

* **The read** ``media_source/resolve_media {media_content_id}``: ``feature:media`` (as the folder walk), only for
  ``media-source://media_source/…`` (HA's media folders; never a camera, never another source). Mantel asks HA
  itself (a server-only read: a page can never get HA's answer), with HA's signature valid for TTL_S, and keeps
  only the photo's path under ``/media/`` with that signature, and its type, which must be an image. The page
  gets ``{url: "/api/photo/<id>", mime_type}``; the id is random (128 bits), kept in memory for TTL_S, at most
  MAX_KEPT (the oldest go first). The page's adapter puts its prefix in front (mantel-host.js), as for
  notification snapshots.
* **The route** ``GET /api/photo/<id>`` streams the photo from HA Core to a signed-in person or wall tablet who
  may use ``feature:media``, decided again. Unknown, expired and refused answer 404 (one answer, nothing to probe).
  **HA's own signature is the authorisation; no credential is sent.** HA serves ``/media/`` from Core itself,
  which in the HA App is not behind the Supervisor's proxy (``http://supervisor/core`` forwards ``/api/`` and the
  WebSocket only, and the App's token is good there alone), so the photo is fetched from Core's own address
  (``ha_oauth_url``, ``http://homeassistant:8123`` in the App; ``ha_url`` everywhere else).
"""
from __future__ import annotations

import logging
import re
import secrets
import time
from collections import OrderedDict
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

from aiohttp import web

from . import Ctx, Forbidden, Route, may_feature, read_routes
from . import camera_still
from ..identity.guards import guard

log = logging.getLogger("mantel.media_photos")

RESOLVE = "media_source/resolve_media"
SOURCE = "media-source://media_source/"
PATH = "/api/photo/{photo_id}"
PHOTO_ID = re.compile(r"^[0-9a-f]{32}$")
TTL_S = 30 * 60
MAX_KEPT = 4000
MAX_ID = 1000
SUPERVISOR_CORE = "http://supervisor/core"
APP_CORE = "http://homeassistant:8123"


def photo_path(photo_id: str) -> str:
    return f"/api/photo/{photo_id}"


def core_url(cfg: Any) -> str:
    """HA Core's own address for ``/media/`` (never the Supervisor's proxy, which does not forward it)."""
    own = (getattr(cfg, "ha_oauth_url", "") or "").rstrip("/")
    if own:
        return own
    ha = (getattr(cfg, "ha_url", "") or "").rstrip("/")
    return APP_CORE if ha == SUPERVISOR_CORE else ha


class Photos:
    """``app["media_photos"]``: the photo ids handed out, each to one signed HA media address."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._kept: OrderedDict[str, tuple[str, float]] = OrderedDict()
        self.stats = {"resolved": 0, "served": 0, "refused": 0}

    def add(self, ha_path: str) -> str:
        pid = secrets.token_hex(16)
        self._kept[pid] = (ha_path, self.clock() + TTL_S)
        while len(self._kept) > MAX_KEPT:
            self._kept.popitem(last=False)
        return pid

    def get(self, pid: str) -> str | None:
        got = self._kept.get(pid)
        if got is None:
            return None
        if got[1] < self.clock():
            self._kept.pop(pid, None)
            return None
        return got[0]


def ha_media_path(url: object) -> str | None:
    """HA's resolved address -> its path under ``/media/`` with HA's signature (``authSig``, nothing else), or
    None for anything else (another host, another path, no signature)."""
    if not isinstance(url, str) or len(url) > 4096:
        return None
    u = urlsplit(url)
    if u.scheme or u.netloc or u.fragment:
        return None
    path = u.path
    if not path.startswith("/media/") or "\\" in path or any(ord(c) < 32 for c in path):
        return None
    if any(seg in ("", ".", "..") for seg in unquote(path).split("/")[1:]):
        return None
    query = parse_qs(u.query, keep_blank_values=True)
    sig = query.get("authSig")
    if set(query) != {"authSig"} or len(sig) != 1 or not re.fullmatch(r"[A-Za-z0-9._-]{1,2048}", sig[0]):
        return None
    return f"{path}?{urlencode({'authSig': sig[0]})}"


def register(app: web.Application, token: Callable[[], str] | str | None = None) -> None:
    """The ``media_source/resolve_media`` read (``app["read_routes"]``) and ``GET /api/photo/<id>``.
    (``token`` is unused: HA's signature authorises the photo; kept so the call reads like its siblings.)"""
    photos = app.get("media_photos") or Photos()
    app["media_photos"] = photos
    from ..readproxy import ReadBlocked

    async def resolve(ctx: Ctx, msg: dict) -> dict:
        if set(msg) - {"type", "id", "media_content_id", "expires"}:
            raise ReadBlocked(f"{RESOLVE} carries media_content_id only")
        cid = msg.get("media_content_id")
        if not isinstance(cid, str) or not cid.startswith(SOURCE) or len(cid) > MAX_ID:
            raise ReadBlocked(f"{RESOLVE}: only Home Assistant's media folders ({SOURCE}…)")
        reads = app.get("filtered_reads")
        if reads is None:
            raise ConnectionError("unavailable")
        if not await may_feature(reads.hooks, ctx.identity, "media"):
            photos.stats["refused"] += 1
            raise Forbidden("may not use media")
        res = await reads._proxy().request({"type": RESOLVE, "media_content_id": cid, "expires": TTL_S},
                                           server_read=True)
        mime = res.get("mime_type") if isinstance(res, dict) else None
        path = ha_media_path(res.get("url") if isinstance(res, dict) else None)
        if not isinstance(mime, str) or not mime.lower().startswith("image/") or path is None:
            raise ReadBlocked(f"{RESOLVE}: not a photo in a media folder")
        photos.stats["resolved"] += 1
        return {"url": photo_path(photos.add(path)), "mime_type": mime}

    # any session; feature:media decides (may_feature)
    @guard("signed_in", reads="feature:media", preview=True,
           stream="bounded:one picture, 20 MB at most (camera_still.MAX_BYTES)")
    async def serve(request: web.Request) -> web.StreamResponse:
        pid = request.match_info["photo_id"]
        nothing = camera_still._error(404, "not_found")
        path = photos.get(pid) if PHOTO_ID.match(pid) else None
        if path is None or set(request.query) - {"v"}:
            return nothing
        authz = request.app.get("authz")
        principal = authz.principal(request) if authz is not None else None
        if principal is None or "feature:media" not in (authz.may_read(principal, "view", ["feature:media"]) or []):
            photos.stats["refused"] += 1
            return nothing
        url = f"{core_url(request.app['cfg'])}{path}"
        resp = await camera_still.proxy_image(request, url, {}, None, "a screensaver photo",
                                              "photo_unavailable", not_found="not_found")
        if resp.status == 200:
            photos.stats["served"] += 1
        return resp

    read_routes(app)[RESOLVE] = Route(request=resolve)
    app.router.add_get(PATH, serve)
