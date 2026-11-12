"""Mantel for Android's updates, served by Mantel (docs/phase26/ANDROID-APP.md "Updates").

The app's repository publishes a signed release into ``<data_dir>/android/``: the APK and ``latest.json``
({version_code, version_name, file, size, sha256}). An enrolled tablet's app asks for the manifest once an hour and
fetches the file when it is newer; it checks the size and the hash, and Android checks the signature. Both answers are
for a wall tablet (or a person) on the home network only, and carry nothing of the house.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from aiohttp import web

from ..identity.guards import guard
from ..identity.sessions import error

FOLDER = "android"
MANIFEST = "latest.json"
FILE_NAME = re.compile(r"[A-Za-z0-9._-]{1,96}\.apk")
WHY = "the tablet app's own update: a manifest and a signed APK, nothing of the house"


def folder(app: web.Application) -> Path:
    return Path(app["cfg"].data_dir).expanduser() / FOLDER


def manifest(app: web.Application) -> dict | None:
    try:
        got = json.loads((folder(app) / MANIFEST).read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(got, dict) or not FILE_NAME.fullmatch(str(got.get("file", ""))):
        return None
    return {k: got.get(k) for k in ("version_code", "version_name", "file", "size", "sha256")}


@guard("signed_in", device_ok=True, door="lan", reads="none", why=WHY)
async def latest(request: web.Request) -> web.Response:
    got = manifest(request.app)
    if got is None:
        return error(404, "no_release", message="No release of the tablet app is on this Mantel.")
    return web.json_response(got, headers={"Cache-Control": "no-store"})


@guard("signed_in", device_ok=True, door="lan", reads="none", why=WHY, stream="bounded:64 MB (one APK)",
       sample="/apps/android/mantel-0.1.0.apk")
async def apk(request: web.Request) -> web.StreamResponse:
    name = request.match_info["file"]
    got = manifest(request.app)
    if not FILE_NAME.fullmatch(name) or got is None or got["file"] != name:      # only the release the manifest names
        return error(404, "not_found")
    path = folder(request.app) / name
    if not path.is_file() or path.stat().st_size > 64 * 1024 * 1024:
        return error(404, "not_found")
    return web.FileResponse(path, headers={"Content-Type": "application/vnd.android.package-archive",
                                           "Cache-Control": "no-store"})


def register(app: web.Application) -> None:
    app.router.add_get("/apps/android/" + MANIFEST, latest)
    app.router.add_get("/apps/android/{file}", apk)
