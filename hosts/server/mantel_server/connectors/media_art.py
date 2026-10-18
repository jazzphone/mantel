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
"""
from __future__ import annotations

import logging
import re
from typing import Any, Callable

from aiohttp import web

from . import camera_still

log = logging.getLogger("mantel.media_art")

PATH = "/api/media/{entity_id}/art"
PLAYER_ID = re.compile(r"^media_player\.[a-z0-9_]+$")
PICTURE_ATTRS = ("entity_picture", "entity_picture_local")
HA_PROXY = "/api/media_player_proxy/"


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


def page_shaper(base: str = "") -> Callable[[str, dict], dict]:
    """Every state a page receives: camera tokens and artwork tokens both replaced (view.ClientView)."""
    return lambda entity_id, state: shape(entity_id, camera_still.shape(entity_id, state, base), base)


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


def register(app: web.Application, hub: Any, authz: Any, token: Callable[[], str] | str) -> None:
    """``GET /api/media/<entity>/art``: ``view`` on the player decides; ``token`` is Mantel's HA credential."""
    get_token = token if callable(token) else (lambda: token)
    app["media_art"] = {"served": 0, "refused": 0}

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
        if set(request.query) - {"v", "_hk"}:
            return camera_still._error(400, "bad_query")
        cfg = request.app["cfg"]
        url = f"{cfg.ha_url.rstrip('/')}{HA_PROXY}{entity_id}"
        resp = await camera_still.proxy_image(request, url, {}, get_token(), f"artwork for {entity_id}",
                                              "artwork_unavailable", not_found="no_artwork")
        if resp.status == 200:
            stats["served"] += 1
        return resp

    app.router.add_get(PATH, art)
