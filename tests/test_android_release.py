"""Mantel for Android's updates uploaded in Mantel Settings and rolled out a test tablet first (apps/android.py), and
what Mantel reads from an APK before any tablet sees it (apps/apk_check.py)."""
import asyncio
import io
import struct
import zipfile

import aiohttp

from mantel_server.apps import android as A
from mantel_server.apps import apk_check as K
from mantel_server.identity import device_claim as C

KEY = b"fictional certificate one"
OTHER_KEY = b"fictional certificate two"


# ------------------------------------------------------------------------------------------ an APK, made here
def _pool(strings):
    offs, data = [], b""
    for s in strings:
        offs.append(len(data))
        data += struct.pack("<H", len(s)) + s.encode("utf-16-le") + b"\0\0"
    data += b"\0" * (-len(data) % 4)
    header = 28
    start = header + 4 * len(strings)
    body = b"".join(struct.pack("<I", o) for o in offs) + data
    return struct.pack("<HHIIIIII", 0x0001, header, header + len(body), len(strings), 0, 0, start, 0) + body


def manifest_xml(package, code, name):
    strings = ["versionCode", "versionName", "package", "manifest", "1.0", name, package]
    ids = struct.pack("<II", K.VERSION_CODE_ID, K.VERSION_NAME_ID)
    resmap = struct.pack("<HHI", 0x0180, 8, 8 + len(ids)) + ids
    attrs = [(0, 0xFFFFFFFF, 0x10, code), (1, 5, 0x03, 5), (2, 6, 0x03, 6)]
    body = struct.pack("<IIHHHHHH", 0xFFFFFFFF, 3, 20, 20, len(attrs), 0, 0, 0)
    for n, raw, dtype, value in attrs:
        body += struct.pack("<IIIHBBI", 0xFFFFFFFF, n, raw, 8, 0, dtype, value)
    elem = struct.pack("<HHIII", 0x0102, 16, 16 + len(body), 1, 0xFFFFFFFF) + body
    inner = _pool(strings) + resmap + elem
    return struct.pack("<HHI", 0x0003, 8, 8 + len(inner)) + inner


def _lp(b):
    return struct.pack("<I", len(b)) + b


def make_apk(package=K.PACKAGE, code=1100, name="0.2.0", cert=KEY, signed=True):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("AndroidManifest.xml", manifest_xml(package, code, name))
        z.writestr("classes.dex", b"dex\n" + bytes(range(256)) * 4)
    data = buf.getvalue()
    if not signed:
        return data
    signed_data = _lp(_lp(b"digest")) + _lp(_lp(cert)) + _lp(b"")
    signer = _lp(signed_data) + _lp(b"") + _lp(b"key")
    value = _lp(_lp(signer))
    pairs = struct.pack("<QI", len(value) + 4, K.SIG_V2) + value
    size = len(pairs) + 8 + 16
    block = struct.pack("<Q", size) + pairs + struct.pack("<Q", size) + K.SIG_MAGIC
    eocd = data.rfind(b"PK\x05\x06")
    (cd,) = struct.unpack_from("<I", data, eocd + 16)
    out = data[:cd] + block + data[cd:]
    e = eocd + len(block)
    return out[:e + 16] + struct.pack("<I", cd + len(block)) + out[e + 20:]


def test_an_apk_is_read_for_its_app_version_and_key():
    import hashlib
    got = K.inspect(make_apk(code=1234, name="0.3.1"))
    assert got == K.Apk(K.PACKAGE, 1234, "0.3.1", hashlib.sha256(KEY).hexdigest())
    for data, code in ((b"not a zip", "not_apk"), (make_apk(package="com.example.other"), "wrong_app"),
                       (make_apk(signed=False), "unsigned")):
        try:
            K.inspect(data)
            raise AssertionError("refused")
        except K.ApkError as e:
            assert e.code == code


# ------------------------------------------------------------------------------------- the house, made here
async def tablet(mantel, room, name):
    """A tablet paired by code, its page's socket open (as the tablet). Returns (device id, socket)."""
    mantel.forget_cookies()
    await mantel.sign_in("avery")
    code = (await (await mantel.post(C.CODES_API, {"room": room, "name": name})).json())["code"]
    mantel.forget_cookies()
    did = (await (await mantel.post(C.CLAIM_API, {"code": code}, csrf=False)).json())["device"]["id"]
    return did, await mantel.client.ws_connect("/ws")


async def say(ws, **status):
    await ws.send_json({"type": "tablet_app", "event": "status", "status": status})
    await asyncio.sleep(0.05)


async def house(mantel, served=1000):
    await mantel.user("avery", "owner")
    folder = A.folder(mantel.app)
    folder.mkdir(parents=True, exist_ok=True)
    data = make_apk(code=served, name="0.1.0")
    (folder / "mantel-0.1.0-1000.apk").write_bytes(data)
    A._write(folder / A.MANIFEST, {"version_code": served, "version_name": "0.1.0", "file": "mantel-0.1.0-1000.apk",
                                   "size": len(data), "sha256": "x"})
    kitchen, kws = await tablet(mantel, "kitchen", "Kitchen Kiosk")
    loft, lws = await tablet(mantel, "loft", "Loft Kiosk")
    for ws in (kws, lws):
        await say(ws, version="0.1.0", version_code=served)
    mantel.forget_cookies()
    await mantel.sign_in("avery")
    mantel.app["gateway"] = type("G", (), {"commander": object()})()
    return (kitchen, kws), (loft, lws)


async def upload(mantel, data):
    form = aiohttp.FormData()
    form.add_field("file", data, filename="app-release.apk", content_type="application/vnd.android.package-archive")
    return await mantel.client.post("/api/apps/android/upload", data=form, headers=mantel.headers())


async def answer(ws, says="ready", ok=True):
    """The tablet's page: asked to check now, it answers as the app would."""
    while True:
        m = await asyncio.wait_for(ws.receive_json(), 3)
        if m.get("type") == "tablet_app" and m.get("event") == "command":
            assert m["command"] == "check_update"
            await ws.send_json({"type": "tablet_app", "event": "done", "nonce": m["nonce"], "ok": ok, "message": says,
                                "status": {"version_code": 1000}})
            await asyncio.sleep(0.05)
            return


async def test_a_new_version_goes_to_the_test_tablet_first_then_the_rest(mantel):
    (kitchen, kws), (loft, lws) = await house(mantel)
    r = await upload(mantel, make_apk(code=1100, name="0.2.0"))
    got = await r.json()
    assert r.status == 200 and got["stage"] == "ready" and got["candidate"]["version_name"] == "0.2.0"
    assert {a["name"] for a in got["apps"]} == {"Kitchen Kiosk", "Loft Kiosk"}
    assert A.manifest(mantel.app)["version_code"] == 1000             # nobody is offered it yet

    asking = asyncio.create_task(answer(kws))
    r = await mantel.post("/api/apps/android/rollout", {"action": "test", "device": kitchen})
    assert r.status == 200 and (await r.json())["stage"] == "testing"
    await asking
    await asyncio.sleep(0.05)
    assert A.rollout(mantel.app)["tablets"][kitchen]["state"] == "installing"
    # only the test tablet is offered it
    assert A.offered(mantel.app, kitchen)["version_code"] == 1100 and A.offered(mantel.app, loft)["version_code"] == 1000

    # the kitchen's app comes back on 0.2.0: the rest are asked
    asking = asyncio.create_task(answer(lws))
    await say(kws, version="0.2.0", version_code=1100)
    await asking
    r = A.rollout(mantel.app)
    assert r["stage"] == "rolling" and A.manifest(mantel.app)["version_code"] == 1100
    await say(lws, version="0.2.0", version_code=1100)
    got = await (await mantel.get("/api/apps/android")).json()
    assert got["stage"] == "done" and [t["state"] for t in got["tablets"]] == ["updated", "updated"]
    assert got["tablets"][0]["id"] == kitchen                          # the test tablet first
    assert sorted(p.name for p in A.folder(mantel.app).glob("*.apk")) == ["mantel-0.2.0-1100.apk"]
    actions = [x["action"] for x in mantel.app["audit"].rows(kind="config")]
    assert "android.upload" in actions and "android.rollout.test" in actions
    for ws in (kws, lws):
        await ws.close()


async def test_a_failed_test_stops_there_with_androids_reason(mantel):
    (kitchen, kws), (loft, lws) = await house(mantel)
    await upload(mantel, make_apk(code=1100))
    asking = asyncio.create_task(answer(kws))
    await mantel.post("/api/apps/android/rollout", {"action": "test", "device": kitchen})
    await asking
    await say(kws, version="0.1.0", version_code=1000, install="failed: INSTALL_FAILED_INSUFFICIENT_STORAGE", install_for=1100)
    got = await (await mantel.get("/api/apps/android")).json()
    assert got["stage"] == "failed"
    assert got["tablets"][0]["message"] == "Android refused it: INSTALL_FAILED_INSUFFICIENT_STORAGE"
    assert A.manifest(mantel.app)["version_code"] == 1000 and A.offered(mantel.app, loft)["version_code"] == 1000
    assert loft not in A.rollout(mantel.app)["tablets"]
    for ws in (kws, lws):
        await ws.close()


async def test_a_check_that_fails_and_a_tablet_that_never_comes_back(mantel):
    (kitchen, kws), (loft, lws) = await house(mantel)
    await upload(mantel, make_apk(code=1100))
    asking = asyncio.create_task(answer(kws, says="wrong hash", ok=False))
    await mantel.post("/api/apps/android/rollout", {"action": "test", "device": kitchen})
    await asking
    await asyncio.sleep(0.05)
    got = await (await mantel.get("/api/apps/android")).json()
    assert got["stage"] == "failed" and got["tablets"][0]["message"] == "The download arrived damaged."
    # again, on the other tablet: it says it's installing, then is never heard on the new version
    asking = asyncio.create_task(answer(lws))
    await mantel.post("/api/apps/android/rollout", {"action": "test", "device": loft})
    await asking
    await asyncio.sleep(0.05)
    mantel.now[0] += A.INSTALL_WAIT + 1
    got = await (await mantel.get("/api/apps/android")).json()
    assert got["stage"] == "failed" and got["tablets"][0]["message"].startswith("It didn’t come back on 0.2.0 within 10 minutes")
    for ws in (kws, lws):
        await ws.close()


async def test_stop_takes_the_offer_back(mantel):
    (kitchen, kws), (loft, lws) = await house(mantel)
    await upload(mantel, make_apk(code=1100))
    asking = asyncio.create_task(answer(kws))
    await mantel.post("/api/apps/android/rollout", {"action": "test", "device": kitchen})
    await asking
    asking = asyncio.create_task(answer(lws))
    await say(kws, version="0.2.0", version_code=1100)
    await asking
    assert A.manifest(mantel.app)["version_code"] == 1100
    r = await mantel.post("/api/apps/android/rollout", {"action": "stop"})
    got = await r.json()
    assert r.status == 200 and got["stage"] == "stopped" and A.manifest(mantel.app)["version_code"] == 1000
    assert {t["id"]: t["state"] for t in got["tablets"]} == {kitchen: "updated", loft: "failed"}
    r = await mantel.post("/api/apps/android/rollout", {"action": "discard"})
    assert r.status == 200 and (await r.json())["candidate"] is None
    assert [p.name for p in A.folder(mantel.app).glob("*.apk")] == ["mantel-0.1.0-1000.apk"]
    for ws in (kws, lws):
        await ws.close()


async def test_refusals(mantel):
    (kitchen, kws), (loft, lws) = await house(mantel)
    for data, code in ((make_apk(cert=OTHER_KEY), "other_key"), (make_apk(code=1000), "not_newer"),
                       (b"PK junk", "not_apk"), (make_apk(package="com.example.other"), "wrong_app")):
        r = await upload(mantel, data)
        assert r.status == 400 and (await r.json())["error"] == code, code
    r = await mantel.post("/api/apps/android/rollout", {"action": "test", "device": kitchen})
    assert r.status == 409 and (await r.json())["error"] == "no_upload"
    await upload(mantel, make_apk(code=1100))
    await say(kws, version="0.2.0", version_code=1100)
    r = await mantel.post("/api/apps/android/rollout", {"action": "test", "device": kitchen})
    assert r.status == 409 and (await r.json())["error"] == "has_it"
    await lws.close()
    await asyncio.sleep(0.05)
    r = await mantel.post("/api/apps/android/rollout", {"action": "test", "device": loft})
    assert r.status == 409 and (await r.json())["error"] == "not_connected"
    # only the managers, only at home
    assert (await mantel.get("/api/apps/android", tunnel=True)).status in (401, 403)
    await kws.close()


def test_the_rollouts_decisions():
    r = {"candidate": {"version_code": 1100, "version_name": "0.2.0"},
         "tablets": {"a": A.entry("A", {"version": "0.1.0"}, 0.0)}}
    assert A.judge(r, "a", {"version_code": 1000, "install": "waiting", "install_for": 1100}, 5.0)
    assert r["tablets"]["a"]["state"] == "waiting"
    assert not A.judge(r, "a", {"version_code": 1000, "install": "failed: x", "install_for": 1000}, 6.0)   # another version's
    assert not A.timeouts(r, 100.0) and A.timeouts(r, A.INSTALL_WAIT + 1)
    assert r["tablets"]["a"]["state"] == "failed"
    assert not A.judge(r, "a", {"version_code": 1100}, 700.0)          # settled stays settled
    assert A._why("no file") == "The tablet couldn’t download the app from Mantel."
    assert A._why("failed: boom") == "boom"
