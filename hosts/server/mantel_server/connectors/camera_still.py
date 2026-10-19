"""Camera stills through Mantel (PLAN §4 "proxies, not copies", §5 cameras, §7 doors).

HA puts a pre-signed `entity_picture` on every camera state (``/api/camera_proxy/<entity>?token=…``)
and the token itself in ``access_token``. A page that used those would fetch from HA directly: that
works only on HA's own origin (the Ingress frame), never in Docker/LXC mode, and it skips Mantel's
camera rules. So:

* **States leaving Mantel carry no HA token.** ``shape`` (applied by every ``view.ClientView`` to
  every state it sends) drops ``access_token`` from camera states and replaces ``entity_picture``
  with Mantel's own route, ``<prefix>/api/camera/<entity>/still?v=<version>``. The prefix is the
  page's Ingress prefix (HA App mode) or '' (everywhere else), so the shared frontend uses the
  attribute exactly as it does in HA, byte-identical code. ``v`` is a keyed hash of HA's URL, keyed
  with a per-process random salt: it changes whenever HA rotates the camera's token (so a card that
  remembers a failed URL asks again after a rotation, as it does in HA) and reveals nothing of it.
* **The route** ``GET /api/camera/<entity>/still[?width=&height=]`` (``still``) decides with the
  camera live-view policy (``Authz.may_still``: `view` the camera, and ``camera.live``
  allowed; the door's camera rules, i.e. the tunnel's
  ``tunnel_cameras`` switch, apply as they do to live view), then streams HA's
  ``/api/camera_proxy/<entity>`` with Mantel's own HA credential. The credential never leaves the
  server, is never logged, and the browser never learns HA's address.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import time
from typing import Any, Callable

import aiohttp
from aiohttp import web

log = logging.getLogger("mantel.camera_still")

PATH = "/api/camera/{entity_id}/still"
CAMERA_ID = re.compile(r"^camera\.[a-z0-9_]+$")
SECRET_ATTRS = frozenset({"access_token"})       # HA's camera token, as a state attribute
MAX_SIDE = 3840                                  # width/height a page may ask for (HA scales to cover)
MAX_BYTES = 20 * 1024 * 1024                     # one still, at most (a 4K JPEG is ~2 MB)
TIMEOUT = 15.0
_SALT = secrets.token_bytes(32)                  # per process: versions are opaque and unlinkable


def still_url(entity_id: str, base: str = "", version: str | None = None) -> str:
    url = f"{base}/api/camera/{entity_id}/still"
    return f"{url}?v={version}" if version else url


def version_of(upstream_picture: str) -> str:
    """An opaque tag that changes when HA's picture URL (its token) changes. Not reversible."""
    return hmac.new(_SALT, upstream_picture.encode("utf-8", "surrogateescape"), hashlib.sha256).hexdigest()[:16]


def shape(entity_id: str, state: dict, base: str = "") -> dict:
    """A state as a page may receive it: a camera's HA token removed, its picture moved to Mantel.
    Anything that is not a camera, or a camera with neither attribute, is returned as is."""
    if not isinstance(entity_id, str) or not entity_id.startswith("camera.") or not isinstance(state, dict):
        return state
    attrs = state.get("a") or {}
    if "entity_picture" not in attrs and SECRET_ATTRS.isdisjoint(attrs):
        return state
    out = {k: v for k, v in attrs.items() if k not in SECRET_ATTRS}
    pic = attrs.get("entity_picture")
    if isinstance(pic, str) and pic:
        out["entity_picture"] = still_url(entity_id, base, version_of(pic)) if CAMERA_ID.match(entity_id) else None
    elif "entity_picture" in out:
        out["entity_picture"] = None
    return {**state, "a": out}


def shaper(base: str = "") -> Callable[[str, dict], dict]:
    """``shape`` bound to one page's prefix (one per client socket)."""
    return lambda entity_id, state: shape(entity_id, state, base)


# -- the route ---------------------------------------------------------------------------------------
_refused_at: dict[str, float] = {}
WARN_EVERY = 300.0


def _warn_refused(what: str) -> None:
    """A tile asks every ten seconds: a refusal is logged once per camera and reason every 5 minutes."""
    t = time.monotonic()
    if t - _refused_at.get(what, float("-inf")) >= WARN_EVERY:
        if len(_refused_at) > 256:
            _refused_at.clear()
        _refused_at[what] = t
        log.warning("refused a camera still: %s (repeats are logged every %d s)", what, WARN_EVERY)


def _error(status: int, code: str) -> web.Response:
    return web.json_response({"error": code}, status=status, headers={"Cache-Control": "no-store"})


def _side(value: str | None) -> int | None:
    if value is None:
        return None
    if not value.isdigit() or not 1 <= int(value) <= MAX_SIDE:
        raise ValueError(value)
    return int(value)


async def proxy_image(request: web.Request, url: str, params: dict, token: str, what: str, unavailable: str,
                      not_found: str) -> web.StreamResponse:
    """Stream one image from HA with Mantel's credential (never logged, never sent on). Shared by the
    camera stills here and media artwork (media_art.py). Non-image answers become ``unavailable``."""
    http = request.app.get("http")
    own = http is None
    resp: web.StreamResponse | None = None
    if own:
        http = aiohttp.ClientSession()
    try:
        async with http.get(url, params=params, headers={"Authorization": f"Bearer {token}"},
                            timeout=aiohttp.ClientTimeout(total=TIMEOUT), allow_redirects=False) as r:
            if r.status == 404:
                return _error(404, not_found)
            ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if r.status != 200 or not ctype.startswith("image/"):
                log.info("%s: HA answered %s", what, r.status)
                return _error(502, unavailable)
            length = r.content_length
            if length is not None and length > MAX_BYTES:
                return _error(502, unavailable)
            resp = web.StreamResponse(headers={"Content-Type": ctype, "Cache-Control": "no-store",
                                               "X-Content-Type-Options": "nosniff"})
            if length is not None:
                resp.content_length = length
            await resp.prepare(request)
            sent = 0
            async for chunk in r.content.iter_chunked(64 * 1024):
                sent += len(chunk)
                if sent > MAX_BYTES:
                    break
                await resp.write(chunk)
            await resp.write_eof()
            return resp
    except (aiohttp.ClientError, TimeoutError) as exc:
        log.info("%s: %s", what, type(exc).__name__)
        if resp is not None and resp.prepared:
            return resp                                # cut short mid-image: the <img> errors
        return _error(502, unavailable)
    finally:
        if own:
            await http.close()


def register(app: web.Application, hub: Any, authz: Any, token: Callable[[], str] | str) -> None:
    """``GET /api/camera/<entity>/still``. ``authz.may_still(principal, entity_id)`` decides; ``token``
    (Mantel's HA credential, or a callable returning it) is used for HA's camera_proxy only."""
    get_token = token if callable(token) else (lambda: token)
    app["camera_stills"] = {"served": 0, "refused": 0}

    async def still(request: web.Request) -> web.StreamResponse:
        stats = request.app["camera_stills"]
        entity_id = request.match_info["entity_id"]
        if not CAMERA_ID.match(entity_id):
            return _error(404, "not_a_camera")
        principal = authz.principal(request)
        if authz.may_still(principal, entity_id) is not True:
            stats["refused"] += 1
            _warn_refused(f"{entity_id} ({principal.door})")
            return _error(403, "forbidden")
        if entity_id not in hub.store.states:
            return _error(404, "unknown_camera")
        if set(request.query) - {"width", "height", "v", "_hk"}:
            return _error(400, "bad_query")
        try:
            width, height = _side(request.query.get("width")), _side(request.query.get("height"))
        except ValueError:
            return _error(400, "bad_size")
        params = {}
        if width is not None and height is not None:      # HA ignores one without the other
            params = {"width": str(width), "height": str(height)}
        cfg = request.app["cfg"]
        url = f"{cfg.ha_url.rstrip('/')}/api/camera_proxy/{entity_id}"
        resp = await proxy_image(request, url, params, get_token(), f"camera still for {entity_id}", "camera_unavailable",
                                 not_found="unknown_camera")
        if resp.status == 200:
            stats["served"] += 1
        return resp

    app.router.add_get(PATH, still)
