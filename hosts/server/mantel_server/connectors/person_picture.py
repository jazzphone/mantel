"""Home Assistant person portraits on Mantel's origin, behind the person's view grant.

Only the portrait path stored on that person is fetched. Browser requests cannot
supply upstream URLs, and HA credentials never reach the page or another host.
"""
from __future__ import annotations

import re
from typing import Any, Callable
from urllib.parse import urlsplit

from aiohttp import web

from . import camera_still
from ..guards import guard

PERSON_ID = re.compile(r"^person\.[a-z0-9_]+$")
IMAGE = re.compile(r"^/api/image/serve/[a-zA-Z0-9_-]+/[0-9]+x[0-9]+$")
LOCAL = re.compile(r"^/local/[a-zA-Z0-9_./ -]+$")


def portrait_path(value: Any, ha_url: str = "") -> str | None:
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    if parsed.netloc and (not ha_url or (parsed.scheme, parsed.netloc) != (urlsplit(ha_url).scheme, urlsplit(ha_url).netloc)):
        return None
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        return None
    path = parsed.path
    if any(part in (".", "..", "") for part in path.split("/")[1:]):
        return None
    return path if IMAGE.fullmatch(path) or LOCAL.fullmatch(path) else None


def shape(entity_id: str, state: dict, base: str = "", ha_url: str = "") -> dict:
    if not PERSON_ID.fullmatch(entity_id):
        return state
    attrs = state.get("a") or {}
    pic = attrs.get("entity_picture")
    if portrait_path(pic, ha_url) is None:
        return state
    url = f"{base}/api/person/{entity_id}/picture?v={camera_still.version_of(pic)}"
    return {**state, "a": {**attrs, "entity_picture": url}}


def register(app: web.Application, hub: Any, authz: Any, token: Callable[[], str] | str) -> None:
    get_token = token if callable(token) else lambda: token

    @guard("signed_in")          # any session; the roles decide each person (authz.may_see)
    async def picture(request: web.Request) -> web.StreamResponse:
        entity_id = request.match_info["entity_id"]
        if not PERSON_ID.fullmatch(entity_id):
            return camera_still._error(404, "not_a_person")
        if authz.may_see(authz.principal(request), entity_id) is not True:
            return camera_still._error(403, "forbidden")
        if set(request.query) - {"v", "_hk"}:
            return camera_still._error(400, "bad_query")
        state = hub.store.states.get(entity_id) or {}
        cfg = request.app["cfg"]
        path = portrait_path((state.get("a") or {}).get("entity_picture"), cfg.ha_url)
        if path is None:
            return camera_still._error(404, "no_portrait")
        return await camera_still.proxy_image(request, cfg.ha_url.rstrip("/") + path, {}, get_token(),
                                              "person portrait", "portrait_unavailable", "no_portrait")

    app.router.add_get("/api/person/{entity_id}/picture", picture)
