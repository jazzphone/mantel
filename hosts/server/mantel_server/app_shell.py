"""Phase 10: Mantel on phones, iPads and Macs (docs/phase10/APPLE-APPS.md). The one place server.py registers it.

Slice 10.0, the web app on the Home Screen:

* ``/manifest.webmanifest``: the web app's name, icons, ``display: standalone`` and its start page; with it (and
  the ``apple-mobile-web-app-*`` tags in home.html and settings.html) "Add to Home Screen" makes an app-like
  Mantel on an iPhone or iPad, full screen with its own icon.
* ``/sw.js``: the service worker, for Web Push only (no fetch handler: requests go to the network as before).
  Served at the root so its scope is the whole site.
* ``/app/art/<name>`` (not ``icons``: the HA Samba add-on refuses a folder by that name, so the App could not be staged) and ``/apple-touch-icon.png``: the icon (tools/make_app_icons.py, original artwork).
* push.py: Web Push (the VAPID key a secret file), the targets' REST, and the Notifier's feed tap.

These few files are open without a session: a browser fetches a manifest and its icons without cookies, and
they hold nothing about the house. Everything under ``/api/`` still needs a person.

Slices 10.2 and 10.3, the apps' server side: app_auth.py (sign-in with PKCE, DPoP-bound credentials, pairing,
the house's identity, the web view's session, Me → Apps) and app_api.py (the REST door to the gateway, the
summary, favorites).
"""
from __future__ import annotations

from aiohttp import web

from . import app_api, app_auth, app_music, push

APP_DIR = "app"                       # under cfg.web
ICONS = ("apple-touch-icon.png", "mantel-192.png", "mantel-512.png", "mantel-maskable-512.png", "badge-96.png")
MANIFEST = "/manifest.webmanifest"
WORKER = "/sw.js"
TOUCH_ICON = "/apple-touch-icon.png"
SHORT_CACHE = {"Cache-Control": "no-cache"}
ICON_CACHE = {"Cache-Control": "public, max-age=86400"}


def _file(request: web.Request, *parts: str):
    return request.app["cfg"].web.joinpath(APP_DIR, *parts)


async def manifest(request: web.Request) -> web.StreamResponse:
    body = _file(request, "manifest.webmanifest").read_bytes()
    return web.Response(body=body, content_type="application/manifest+json", headers=SHORT_CACHE)


async def worker(request: web.Request) -> web.StreamResponse:
    body = _file(request, "sw.js").read_bytes()
    return web.Response(body=body, content_type="text/javascript",
                        headers={**SHORT_CACHE, "Service-Worker-Allowed": "/"})


async def icon(request: web.Request) -> web.StreamResponse:
    name = request.match_info.get("name") or "apple-touch-icon.png"
    if name not in ICONS:
        raise web.HTTPNotFound()
    return web.FileResponse(_file(request, "art", name), headers=ICON_CACHE)


def register(app: web.Application, hub=None) -> None:
    app.router.add_get(MANIFEST, manifest)
    app.router.add_get(WORKER, worker)
    app.router.add_get(TOUCH_ICON, icon)
    app.router.add_get("/app/art/{name}", icon)
    app.setdefault("public_paths", set()).update({MANIFEST, WORKER, TOUCH_ICON, *(f"/app/art/{n}" for n in ICONS)})
    push.register(app, hub)
    app_auth.register(app, hub)     # 10.2: app sign-in (PKCE, device-bound tokens), pairing, the web view's session
    app_api.register(app, hub)      # 10.3: the REST door, the summary, favorites
    app_music.register(app, hub)    # the apps' music: the Mac's native player (state, commands, queue, library)
