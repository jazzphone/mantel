"""THE SNAPSHOTS: a camera's picture taken the moment a notification goes off,
kept SNAP_TTL_S in memory and served to the screens, so every screen shows the
same picture -- the moment, not a frame from whenever the banner opened.

    /api/hk_frontend/notify/snap/<id>     the picture (auth required)
    hk_notify/snap/sign {snaps: [id]}     -> {signed: {id: path}}: paths an
                                             <img> can load (any signed-in user:
                                             a wall tablet's own)

The id is random (unguessable) and the path is signed besides, like the
album art (art.py).
"""
from __future__ import annotations

import logging
import secrets
import time
from datetime import timedelta
from typing import Any

import voluptuous as vol
from aiohttp import web

from homeassistant.components import websocket_api
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback

from ...art import SAFE_HEADERS
from .const import SNAP_MAX, SNAP_TIMEOUT_S, SNAP_TTL_S

_LOGGER = logging.getLogger(__name__)

URL = "/api/hk_frontend/notify/snap/{snap_id}"
ID_LEN = 16


class Snaps:
    """id -> (bytes, content type, expires at)."""

    def __init__(self) -> None:
        self.items: dict[str, tuple[bytes, str, float]] = {}

    def _prune(self, now: float) -> None:
        for k in [k for k, v in self.items.items() if v[2] <= now]:
            del self.items[k]
        while len(self.items) > SNAP_MAX:
            del self.items[min(self.items, key=lambda k: self.items[k][2])]

    def put(self, body: bytes, ctype: str, now: float | None = None) -> str:
        now = time.monotonic() if now is None else now
        sid = secrets.token_hex(ID_LEN // 2)
        self.items[sid] = (body, ctype, now + SNAP_TTL_S)
        self._prune(now)
        return sid

    def get(self, sid: str, now: float | None = None) -> tuple[bytes, str] | None:
        now = time.monotonic() if now is None else now
        got = self.items.get(sid)
        if got is None or got[2] <= now:
            return None
        return got[0], got[1]


async def async_take(hass: HomeAssistant, snaps: Snaps, camera: str) -> str | None:
    """The camera's picture now, kept; its id, or None when the camera gave
    none in time (the notification goes without)."""
    from homeassistant.components.camera import async_get_image
    try:
        img = await async_get_image(hass, camera, timeout=SNAP_TIMEOUT_S)
    except Exception as err:  # noqa: BLE001 -- any camera failure: no picture
        _LOGGER.debug("notification snapshot from %s failed: %s", camera, err)
        return None
    if not img or not img.content:
        return None
    return snaps.put(img.content, img.content_type or "image/jpeg")


def path(sid: str) -> str:
    return URL.replace("{snap_id}", sid)


@callback
def async_register(hass: HomeAssistant, snaps: Snaps) -> None:

    @websocket_api.websocket_command({vol.Required("type"): "hk_notify/snap/sign",
                                      vol.Required("snaps"): vol.All([str], vol.Length(max=SNAP_MAX))})
    @callback
    def ws_sign(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
        from homeassistant.components.http.auth import async_sign_path
        signed = {s: async_sign_path(hass, path(s), timedelta(seconds=SNAP_TTL_S))
                  for s in msg["snaps"] if s in snaps.items}
        connection.send_result(msg["id"], {"signed": signed})

    class SnapView(HomeAssistantView):
        url = URL
        name = "hk_frontend:notify_snap"
        requires_auth = True

        async def get(self, request: web.Request, snap_id: str) -> web.Response:
            got = snaps.get(snap_id)
            if got is None:
                return web.Response(status=404, headers=SAFE_HEADERS)
            return web.Response(body=got[0], content_type=got[1],
                                headers={"Cache-Control": "private, max-age=%d" % SNAP_TTL_S, **SAFE_HEADERS})

    websocket_api.async_register_command(hass, ws_sign)
    if getattr(hass, "http", None) is not None:
        hass.http.register_view(SnapView())
