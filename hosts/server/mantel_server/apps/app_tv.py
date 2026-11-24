"""THE LIVE TV WIDGET'S PLAY ON (phase 35, docs/phase35/PLAN.md): the iPhone app asks Mantel to play a channel on a
paired AirPlay screen, or to stop it. The widget's tap runs on the phone and in place (a HomeView allows that), so a
HomeView's own widget plays the channel on its own screen.

  POST /api/app/tv/play   {"channel": "4.1", "screen": "<id>"}  -> {"playing": {channel, name}, "screen"}
  POST /api/app/tv/stop   {"screen": "<id>"}                    -> {"playing": null, "screen"}

The person is the app's (its DPoP-bound token); cameras/airplay_out/routes.Sender asks the Live TV question for
them (feature ``live_tv``, ``view`` on the channel's camera) and audits the play. GET /api/app/tv (app_api.py) lists
the screens beside the channels.
"""
from __future__ import annotations

import re

from aiohttp import web

from ..identity.guards import WHY_APP, open_route
from ..identity.sessions import error, ok
from .app_auth import app_route

CHANNEL = re.compile(r"^\d{1,4}(?:\.\d{1,3})?$")
SCREEN = re.compile(r"^s[0-9a-f]{12}$")
STATUS = {"forbidden": 403, "not_found": 404, "unpaired": 409, "unavailable": 503}


def _principal(request: web.Request):
    authz = request.app.get("authz")
    return authz.principal(request) if authz is not None else None


async def _body(request: web.Request, keys: set[str]) -> dict | None:
    try:
        body = await request.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) and not set(body) - keys else None


def _done(got: dict) -> web.Response:
    if "error" in got:
        return error(STATUS.get(got["error"], 502), got["error"], message=got.get("message") or "")
    return ok(got)


@open_route("app_dpop", reads="feature:live_tv", why=WHY_APP)
@app_route
async def play(request: web.Request) -> web.Response:
    sender = request.app.get("airplay_sender")
    if sender is None:
        return error(503, "unavailable")
    body = await _body(request, {"channel", "screen"})
    if body is None or not CHANNEL.match(str(body.get("channel") or "")) or not SCREEN.match(str(body.get("screen") or "")):
        return error(400, "invalid")
    from ..cameras.airplay_out.routes import _answer
    return _done(await _answer(sender.play(_principal(request), body["channel"], body["screen"])))


@open_route("app_dpop", reads="feature:live_tv", why=WHY_APP)
@app_route
async def stop(request: web.Request) -> web.Response:
    sender = request.app.get("airplay_sender")
    if sender is None:
        return error(503, "unavailable")
    body = await _body(request, {"screen"})
    if body is None or not SCREEN.match(str(body.get("screen") or "")):
        return error(400, "invalid")
    from ..cameras.airplay_out.routes import _answer
    return _done(await _answer(sender.stop(_principal(request), body["screen"])))


PATHS = ("/api/app/tv/play", "/api/app/tv/stop")


def register(app: web.Application, hub=None) -> None:
    app.router.add_post(PATHS[0], play)
    app.router.add_post(PATHS[1], stop)
    app.setdefault("public_paths", set()).update(PATHS)
