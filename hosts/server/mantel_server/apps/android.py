"""Mantel for Android's updates, served by Mantel (docs/phase26/ANDROID-APP.md "Updates").

A release lives in ``<data_dir>/android/``: the APK and ``latest.json`` ({version_code, version_name, file, size,
sha256}). An enrolled tablet's app asks for the manifest once an hour and fetches the file when it is newer; it checks
the size and the hash, and Android checks the signature. Both answers are for a wall tablet (or a person) on the home
network only, and carry nothing of the house. The app's repository can still copy a release straight in
(``tools/publish_apk.py``), as a developer does.

UPLOADING A RELEASE (the owner, 2026-11-14: "allow a user to download the apk and then push it ... pick one to test
first, and then if that one succeeds, proceed to upgrading the rest ... with information on failure"): an Owner or Admin
uploads the APK from the app's GitHub releases in Mantel Settings (Wall Tablets). Mantel reads it first (apk_check.py)
and refuses another app, an older version, or one signed by another key than the version the tablets have. Then:

1. **Test tablet.** One tablet is offered the new version (its manifest alone names it) and asked to check now; the app
   installs at once. It passes when its app comes back on the new version.
2. **The rest.** The new version becomes every tablet's (``latest.json``) and each connected app tablet is asked to
   check now; one not connected takes it at its next hourly check. A tablet that connects during the rollout is asked.
3. Each tablet's outcome is kept with Android's or the app's reason when it fails, and a tablet that doesn't come back
   on the new version within INSTALL_WAIT has failed. A failed test stops there: no other tablet is offered it.

Stop takes the offer back (``latest.json`` as it was before; a tablet already updated stays updated). The rollout is
``rollout.json`` beside the release, so a restart of Mantel picks it up again.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from pathlib import Path

from aiohttp import web

from ..cameras.image_work import FileError
from ..identity.accounts import read_json
from ..identity.guards import guard
from ..identity.guards import ident as guarded
from ..identity.sessions import error, ok
from ..storage import audit
from ..storage.user_files import read_upload
from . import apk_check
from . import tablet_app as T

log = logging.getLogger("mantel.android")

FOLDER = "android"
MANIFEST = "latest.json"
ROLLOUT = "rollout.json"
FILE_NAME = re.compile(r"[A-Za-z0-9._-]{1,96}\.apk")
WHY = "the tablet app's own update: a manifest and a signed APK, nothing of the house"
DOWNLOAD = "https://github.com/jazzphone/mantel-android/releases"
UPLOAD_MAX = 64 << 20
INSTALL_WAIT = 600.0        # seconds for a tablet to come back on the new version: download, install, restart, page
CHECK_WAIT = 120.0          # for the app's answer to "check now" (it downloads and checks the file first)
FINAL = ("updated", "failed", "offline")
KEYS = ("version_code", "version_name", "file", "size", "sha256")


def folder(app: web.Application) -> Path:
    return Path(app["cfg"].data_dir).expanduser() / FOLDER


def _json(path: Path) -> dict | None:
    try:
        got = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return got if isinstance(got, dict) else None


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1) + "\n")
    os.replace(tmp, path)


def manifest(app: web.Application) -> dict | None:
    """What every tablet is offered: latest.json."""
    got = _json(folder(app) / MANIFEST)
    if got is None or not FILE_NAME.fullmatch(str(got.get("file", ""))):
        return None
    return {k: got.get(k) for k in KEYS}


def rollout(app: web.Application) -> dict:
    return _json(folder(app) / ROLLOUT) or {}


def offered(app: web.Application, device_id: str | None) -> dict | None:
    """The release `device_id` is offered: the new version while it is the test tablet, else every tablet's."""
    r = rollout(app)
    cand = r.get("candidate")
    if cand and r.get("stage") == "testing" and device_id and device_id == r.get("test"):
        return {k: cand.get(k) for k in KEYS}
    return manifest(app)


def _device_of(request: web.Request) -> str | None:
    dev = getattr(guarded(request), "device", None)
    return getattr(dev, "id", None)


@guard("signed_in", device_ok=True, door="lan", reads="none", why=WHY)
async def latest(request: web.Request) -> web.Response:
    got = offered(request.app, _device_of(request))
    if got is None:
        return error(404, "no_release", message="No release of the tablet app is on this Mantel.")
    return web.json_response(got, headers={"Cache-Control": "no-store"})


@guard("signed_in", device_ok=True, door="lan", reads="none", why=WHY, stream="bounded:64 MB (one APK)",
       sample="/apps/android/mantel-0.1.0.apk")
async def apk(request: web.Request) -> web.StreamResponse:
    name = request.match_info["file"]
    got = offered(request.app, _device_of(request))
    if not FILE_NAME.fullmatch(name) or got is None or got["file"] != name:      # only the release the manifest names
        return error(404, "not_found")
    path = folder(request.app) / name
    if not path.is_file() or path.stat().st_size > UPLOAD_MAX:
        return error(404, "not_found")
    return web.FileResponse(path, headers={"Content-Type": "application/vnd.android.package-archive",
                                           "Cache-Control": "no-store"})


# ------------------------------------------------------------------------------- the rollout's decisions (pure)
def _why(message: str) -> str:
    """The app's word for a failed check or install, for a person."""
    m = (message or "").strip()
    known = {"no manifest": "The tablet couldn’t read Mantel’s release.",
             "no file": "The tablet couldn’t download the app from Mantel.",
             "wrong size": "The download arrived incomplete.", "wrong hash": "The download arrived damaged.",
             "bad name": "Mantel’s release names a file the app won’t take.",
             "not set up": "The app isn’t set up with this Mantel.",
             "updates aren’t running": "The app’s updates aren’t running."}
    if m in known:
        return known[m]
    if m.startswith("failed:"):
        m = m[7:].strip()
    return ("Android refused it: " + m) if m.startswith("INSTALL_") else (m or "No reason given.")


def judge(r: dict, device_id: str, status: dict, now: float) -> bool:
    """One tablet's outcome from its app's status: on the new version, or its install failed or waits for a tap.
    True when its entry changed."""
    t = (r.get("tablets") or {}).get(device_id)
    code = (r.get("candidate") or {}).get("version_code")
    if t is None or code is None or t.get("state") in ("updated", "failed"):
        return False
    before = dict(t)
    if isinstance(status.get("version_code"), int) and status["version_code"] >= code:
        t.update(state="updated", message="", at=now)
    elif status.get("install_for") == code and isinstance(status.get("install"), str):
        said = status["install"]
        if said.startswith("failed"):
            t.update(state="failed", message=_why(said[6:].lstrip(": ")), at=now)
        elif said == "waiting" and t.get("state") != "waiting":
            t.update(state="waiting", message="Waiting for someone to allow the update on the tablet’s screen.")
    if status.get("update"):
        t["said"] = str(status["update"])[:200]
    return t != before


def timeouts(r: dict, now: float, wait: float = INSTALL_WAIT) -> bool:
    """A tablet that hasn't come back on the new version within `wait` has failed. True when one did."""
    name = (r.get("candidate") or {}).get("version_name", "")
    changed = False
    for t in (r.get("tablets") or {}).values():
        if t.get("state") in ("sent", "installing", "waiting") and now - t.get("since", now) > wait:
            said = t.get("said", "")
            t.update(state="failed", at=now, message=f"It didn’t come back on {name} within {int(wait // 60)} minutes."
                     + (f" Its last update check said: {_why(said)}" if said and not said.startswith("current") else ""))
            changed = True
    return changed


def entry(name: str, status: dict | None, now: float, state: str = "sent") -> dict:
    return {"name": name, "state": state, "from": (status or {}).get("version"), "since": now, "at": now, "message": ""}


# ------------------------------------------------------------------------------------ the rollout's own steps
def _names(app: web.Application) -> dict[str, str]:
    rows = app["store"].db.execute("SELECT id, name FROM devices WHERE revoked IS NULL").fetchall()
    return {row["id"]: row["name"] for row in rows}


def app_tablets(app: web.Application) -> list[dict]:
    """Every enrolled tablet whose app Mantel has heard since it started: its version and whether it is here now."""
    st = T.apps_of(app)
    names = _names(app)
    now = st.clock()
    out = []
    for did, got in st.status.items():
        if did not in names:
            continue
        s = got["status"]
        out.append({"id": did, "name": names[did], "version": s.get("version"), "version_code": s.get("version_code"),
                    "connected": bool(T.sessions_of(app, did)) and now - got["at"] < T.STALE, "status": s})
    return sorted(out, key=lambda a: a["name"].lower())


def _save(app: web.Application, r: dict) -> None:
    _write(folder(app) / ROLLOUT, r)


async def _check_now(app: web.Application, device_id: str) -> None:
    """Ask the tablet's app to check now (it installs at once what it finds), and note what it answers."""
    answer = await T.ask(app, device_id, "check_update", wait=CHECK_WAIT)
    r = rollout(app)
    t = (r.get("tablets") or {}).get(device_id)
    if t is None or t.get("state") != "sent":
        return
    now = T.apps_of(app).clock()
    said = (answer or {}).get("message", "")
    if answer is None:
        t["message"] = "Asked to update; no answer yet."
    elif not answer.get("ok"):
        t.update(state="failed", message=_why(said), at=now)
    elif said == "ready":
        t.update(state="installing", message="", at=now)
    else:
        judge(r, device_id, answer.get("status") or {}, now)
        if t["state"] == "sent":
            t.update(state="failed", at=now, message="The app didn’t see the new version"
                     + (f" ({said})." if said else "."))
    _save(app, r)
    await advance(app)


def _ask_later(app: web.Application, device_id: str) -> None:
    tasks = app["android_tasks"]                       # (kept, so a task isn't collected while it runs)
    task = asyncio.get_running_loop().create_task(_check_now(app, device_id))
    tasks.add(task)
    task.add_done_callback(tasks.discard)


def _promote(app: web.Application, r: dict, now: float) -> list[str]:
    """The test passed: the new version is every tablet's. Returns the tablets to ask now."""
    cand = r["candidate"]
    r["previous"] = manifest(app)
    _write(folder(app) / MANIFEST, {k: cand[k] for k in KEYS})
    r.update(stage="rolling", promoted=now)
    ask = []
    for a in app_tablets(app):
        if a["id"] in r["tablets"] or (a["version_code"] or 0) >= cand["version_code"]:
            continue
        if a["connected"]:
            r["tablets"][a["id"]] = entry(a["name"], a["status"], now)
            ask.append(a["id"])
        else:
            r["tablets"][a["id"]] = {**entry(a["name"], a["status"], now, "offline"),
                                     "message": "It takes the update within an hour of coming back."}
    log.info("android: %s passed on the test tablet; %d more asked", cand["version_name"], len(ask))
    return ask


def _tidy(app: web.Application, keep: set[str]) -> None:
    for f in folder(app).glob("*.apk"):
        if f.name not in keep:
            try:
                f.unlink()
            except OSError:
                pass


async def advance(app: web.Application) -> dict:
    """The rollout one step on, as its tablets stand: timeouts, the test passed or failed, the rest finished."""
    r = rollout(app)
    stage = r.get("stage")
    if stage not in ("testing", "rolling"):
        return r
    now = T.apps_of(app).clock()
    changed = timeouts(r, now)
    ask: list[str] = []
    if stage == "testing":
        t = r["tablets"].get(r.get("test"), {})
        if t.get("state") == "updated":
            ask, changed = _promote(app, r, now), True
        elif t.get("state") == "failed":
            r.update(stage="failed", finished=now)
            changed = True
            log.info("android: %s failed on the test tablet: %s", r["candidate"]["version_name"], t.get("message"))
    if r.get("stage") == "rolling" and all(t.get("state") in FINAL for t in r["tablets"].values()):
        r.update(stage="done", finished=now)
        _tidy(app, {r["candidate"]["file"]})
        changed = True
    if changed:
        _save(app, r)
    for did in ask:
        _ask_later(app, did)
    return r


def listener(app: web.Application):
    async def heard(device_id: str, status: dict) -> None:
        r = rollout(app)
        if r.get("stage") not in ("testing", "rolling"):
            return
        now = T.apps_of(app).clock()
        changed = judge(r, device_id, status, now)
        code = r["candidate"]["version_code"]
        t = r["tablets"].get(device_id)
        behind = isinstance(status.get("version_code"), int) and status["version_code"] < code
        if r["stage"] == "rolling" and behind and (t is None or t["state"] == "offline"):
            # a tablet that connected during the rollout: asked now
            r["tablets"][device_id] = entry(_names(app).get(device_id, device_id), status, now)
            changed = True
            _save(app, r)
            _ask_later(app, device_id)
        elif changed:
            _save(app, r)
        if changed:
            await advance(app)
    return heard


# ------------------------------------------------------------------------------------------------ the routes
def view(app: web.Application, r: dict) -> dict:
    tablets = [{"id": k, **{x: v.get(x) for x in ("name", "state", "message", "from", "at")}}
               for k, v in (r.get("tablets") or {}).items()]
    return {"served": manifest(app), "candidate": r.get("candidate"), "stage": r.get("stage"), "test": r.get("test"),
            "tablets": sorted(tablets, key=lambda t: (t["id"] != r.get("test"), (t["name"] or "").lower())),
            "apps": [{k: a[k] for k in ("id", "name", "version", "version_code", "connected")} for a in app_tablets(app)],
            "started": r.get("started"), "finished": r.get("finished"), "download": DOWNLOAD,
            "commands_on": T._commands_on(app), "wait_minutes": int(INSTALL_WAIT // 60)}


@guard("manager", door="lan", reads="admin")
async def get_release(request: web.Request) -> web.Response:
    return ok(view(request.app, await advance(request.app)))


def _served_signer(app: web.Application) -> str | None:
    got = manifest(app)
    try:
        return apk_check.signer_of((folder(app) / got["file"]).read_bytes()) if got else None
    except (OSError, ValueError):
        return None


@guard("manager", door="lan", audit="android.upload", reads="admin")
async def upload(request: web.Request) -> web.Response:
    """A new version of the app, uploaded (multipart ``file``): read, checked, and kept as the new version, not yet
    offered to any tablet."""
    app = request.app
    r = rollout(app)
    if r.get("stage") in ("testing", "rolling"):
        return error(409, "rollout_running", message="An update is going out now. Stop it before uploading another.")
    try:
        data, _name, _fields = await read_upload(request, UPLOAD_MAX)
    except FileError as e:
        return error(e.status, e.code, message=str(e))
    try:
        got = await asyncio.to_thread(apk_check.inspect, data)
    except apk_check.ApkError as e:
        return error(400, e.code, message=str(e))
    served = manifest(app)
    signer = await asyncio.to_thread(_served_signer, app)
    if signer and got.signer != signer:
        return error(400, "other_key", message="That app is signed by another key than the version on the tablets, so "
                                               "Android would refuse it. Download it from Mantel for Android’s releases.")
    if served and got.version_code <= (served.get("version_code") or 0):
        return error(400, "not_newer", message=f"That’s version {got.version_name}; the tablets are offered "
                                               f"{served.get('version_name')} already.")
    safe = re.sub(r"[^A-Za-z0-9.-]", "-", got.version_name)[:40]
    name = f"mantel-{safe}-{got.version_code}.apk"
    cand = {"version_code": got.version_code, "version_name": got.version_name, "file": name, "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "signer": got.signer}
    audit.config(request, guarded(request), "android.upload",
                 {"version": got.version_name, "version_code": got.version_code, "size": len(data), "sha256": cand["sha256"]})
    old = (r.get("candidate") or {}).get("file")
    path = folder(app) / name
    await asyncio.to_thread(lambda: (path.parent.mkdir(parents=True, exist_ok=True), path.write_bytes(data)))
    if old and old != name and old != (served or {}).get("file"):
        _tidy(app, {name, (served or {}).get("file", "")})
    now = T.apps_of(app).clock()
    r = {"candidate": cand, "stage": "ready", "uploaded": now}
    _save(app, r)
    log.info("android: %s (%d) uploaded", got.version_name, got.version_code)
    return ok(view(app, r))


@guard("manager", door="lan", audit=("android.rollout.test", "android.rollout.stop", "android.rollout.discard"),
       reads="admin")
async def post_rollout(request: web.Request) -> web.Response:
    """{action: test, device} starts the update on a test tablet (then the rest by themselves); {action: stop} takes the
    offer back; {action: discard} forgets an uploaded version that isn't going out."""
    app = request.app
    body = await read_json(request)
    action = body.get("action")
    r = rollout(app)
    cand = r.get("candidate")
    now = T.apps_of(app).clock()
    if action == "test":
        if not cand:
            return error(409, "no_upload", message="Upload a new version first.")
        if r.get("stage") in ("testing", "rolling"):
            return error(409, "rollout_running", message="This update is going out already.")
        if not T._commands_on(app):
            return error(503, "commands_disabled", message="Commands are off on this Mantel, so no tablet can be asked.")
        did = body.get("device")
        a = next((x for x in app_tablets(app) if x["id"] == did), None) if isinstance(did, str) else None
        if a is None or not a["connected"]:
            return error(409, "not_connected", message="That tablet’s app isn’t connected to Mantel right now.")
        if (a["version_code"] or 0) >= cand["version_code"]:
            return error(409, "has_it", message=f"{a['name']} already runs {a['version']}.")
        audit.config(request, guarded(request), "android.rollout.test",
                     {"version": cand["version_name"], "device": did, "name": a["name"]})
        r = {"candidate": cand, "uploaded": r.get("uploaded"), "stage": "testing", "test": did, "started": now,
             "tablets": {did: entry(a["name"], a["status"], now)}}
        _save(app, r)
        _ask_later(app, did)
        log.info("android: %s on %s first", cand["version_name"], a["name"])
        return ok(view(app, r))
    if action == "stop":
        if r.get("stage") not in ("testing", "rolling"):
            return error(409, "not_running", message="No update is going out.")
        audit.config(request, guarded(request), "android.rollout.stop", {"version": cand["version_name"], "stage": r["stage"]})
        if r["stage"] == "rolling" and r.get("previous"):
            _write(folder(app) / MANIFEST, r["previous"])
        for t in r["tablets"].values():
            if t.get("state") not in FINAL:
                t.update(state="failed", message="Stopped.", at=now)
        r.update(stage="stopped", finished=now)
        _save(app, r)
        return ok(view(app, r))
    if action == "discard":
        if not cand:
            return error(409, "no_upload", message="There’s no uploaded version to discard.")
        if r.get("stage") in ("testing", "rolling"):
            return error(409, "rollout_running", message="Stop the update first.")
        audit.config(request, guarded(request), "android.rollout.discard", {"version": cand["version_name"]})
        served = manifest(app)
        _tidy(app, {(served or {}).get("file", "")})
        try:
            (folder(app) / ROLLOUT).unlink()
        except OSError:
            pass
        return ok(view(app, {}))
    return error(400, "invalid_action", message="test, stop or discard")


def register(app: web.Application) -> None:
    app["android_tasks"] = set()
    app.router.add_get("/apps/android/" + MANIFEST, latest)
    app.router.add_get("/apps/android/{file}", apk)
    app.router.add_get("/api/apps/android", get_release)
    app.router.add_post("/api/apps/android/upload", upload)
    app.router.add_post("/api/apps/android/rollout", post_rollout)
    T.apps_of(app).listeners.append(listener(app))
