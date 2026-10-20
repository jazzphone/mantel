"""Mantel Photos (photos.py): albums, uploads checked by their bytes and re-encoded (orientation applied, location
dropped), three sizes, duplicates, the limits, RBAC, CSRF, the audit, what the screensavers read, the import from a
Home Assistant media folder, and the backup. Every picture here is GENERATED at run time (fictional colours and
noise): no real photo is in git."""
import asyncio
import io
import json
import os
import stat

import pytest
from aiohttp import FormData, web
from aiohttp.test_utils import TestServer
from PIL import Image

from mantel_server import backup, photos


def picture(fmt="JPEG", size=(80, 60), mode="RGB", color=(200, 30, 30), exif=False, noise=False, **kw) -> bytes:
    img = Image.effect_noise(size, 90).convert(mode) if noise else Image.new(mode, size, color)
    buf = io.BytesIO()
    if exif:
        ex = Image.Exif()
        ex[0x0112] = 6                                                   # rotate 90
        ex[0x010F] = "ACME camera"
        ex[0x8825] = {1: "N", 2: (41.0, 52.0, 0.0), 3: "W", 4: (87.0, 38.0, 0.0)}     # GPS
        kw["exif"] = ex
    if fmt == "HEIF":
        import pillow_heif
        pillow_heif.register_heif_opener()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


async def owner(mantel, name="avery", role="owner"):
    await mantel.user(name, role)
    r, _ = await mantel.sign_in(name)
    assert r.status == 200
    return name


async def send(mantel, method, path, body=None, csrf=True):
    r = await mantel.client.request(method, path, json=body, headers=mantel.headers(csrf))
    return r, await r.json()


async def album(mantel, name="Family"):
    r, body = await send(mantel, "POST", "/api/photos/albums", {"name": name})
    assert r.status == 201, body
    return body["album"]["id"]


async def upload(mantel, aid, data, name="photo.jpg", csrf=True):
    fd = FormData()
    fd.add_field("file", data, filename=name, content_type="application/octet-stream")
    r = await mantel.client.post(f"/api/photos/albums/{aid}/upload", data=fd, headers=mantel.headers(csrf))
    return r, await r.json()


def audits(mantel, prefix="photos."):
    return [(r["action"], json.loads(r["target"])) for r in
            mantel.store.db.execute("SELECT action, target FROM action_audit WHERE kind='config' ORDER BY id")
            if r["action"].startswith(prefix)]


# -- albums ----------------------------------------------------------------------------------------------------
async def test_albums_are_made_renamed_and_deleted(mantel):
    await owner(mantel)
    aid = await album(mantel, "  Family   Trip ")
    r, body = await send(mantel, "GET", "/api/photos")
    assert r.status == 200 and [a["name"] for a in body["albums"]] == ["Family Trip"]
    assert body["albums"][0]["count"] == 0 and body["usage"] == 0 and body["limits"] == {"quota_mb": 4096, "file_mb": 40}
    r, body = await send(mantel, "POST", "/api/photos/albums", {"name": "family trip"})
    assert r.status == 409 and body["error"] == "name_taken"
    r, body = await send(mantel, "POST", "/api/photos/albums", {"name": "  "})
    assert r.status == 400 and body["error"] == "name_required"
    r, body = await send(mantel, "POST", "/api/photos/albums", {"name": "x" * 61})
    assert body["error"] == "name_too_long"
    r, body = await send(mantel, "PATCH", f"/api/photos/albums/{aid}", {"name": "Beach"})
    assert r.status == 200 and body["album"]["name"] == "Beach"
    await upload(mantel, aid, picture())
    r, body = await send(mantel, "DELETE", f"/api/photos/albums/{aid}")
    assert r.status == 200 and body["photos"] == 1
    assert (await send(mantel, "GET", "/api/photos"))[1]["albums"] == []
    assert not any((mantel.app["photos"].root / "originals").iterdir())
    assert [a for a, _ in audits(mantel)] == ["photos.album.create", "photos.album.rename", "photos.upload",
                                              "photos.album.delete"]
    r, body = await send(mantel, "PATCH", f"/api/photos/albums/{aid}", {"name": "Gone"})
    assert r.status == 404 and body["error"] == "album_not_found"


# -- uploads -----------------------------------------------------------------------------------------------------
async def test_an_upload_is_re_encoded_upright_without_its_location(mantel):
    await owner(mantel)
    aid = await album(mantel)
    r, body = await upload(mantel, aid, picture(exif=True), name="../../IMG_0001.JPG")
    assert r.status == 201 and body["duplicate"] is False
    p = body["photo"]
    assert (p["width"], p["height"]) == (60, 80)                     # the EXIF rotation applied
    assert p["name"] == "IMG_0001.JPG" and p["source"] == "upload"
    lib = mantel.app["photos"]
    for size, fmt in (("original", "JPEG"), ("screen", "JPEG"), ("thumb", "WEBP")):
        path = lib.path(p["id"], size)
        im = Image.open(path)
        assert im.format == fmt and im.size == (60, 80)
        assert not im.getexif() and b"ACME" not in path.read_bytes() and b"GPS" not in path.read_bytes()
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
        assert stat.S_IMODE(os.stat(path.parent).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(lib.root).st_mode) == 0o700
    assert p["bytes"] == sum(lib.path(p["id"], s).stat().st_size for s in photos.SIZES)


async def test_png_webp_and_heic_are_accepted_and_a_big_one_is_made_smaller(mantel):
    await owner(mantel)
    aid = await album(mantel)
    lib = mantel.app["photos"]
    r, body = await upload(mantel, aid, picture("PNG", mode="RGBA", color=(0, 255, 0, 128)), name="a.png")
    assert r.status == 201 and Image.open(lib.path(body["photo"]["id"], "original")).mode == "RGB"
    r, body = await upload(mantel, aid, picture("WEBP", color=(1, 2, 3)), name="b.webp")
    assert r.status == 201
    r, body = await upload(mantel, aid, picture("HEIF", color=(9, 9, 9)), name="c.heic")
    assert r.status == 201 and Image.open(lib.path(body["photo"]["id"], "original")).format == "JPEG"
    r, body = await upload(mantel, aid, picture(size=(3000, 2000), color=(10, 200, 10)), name="big.jpg")
    pid = body["photo"]["id"]
    assert (body["photo"]["width"], body["photo"]["height"]) == (3000, 2000)
    assert Image.open(lib.path(pid, "screen")).size == (2560, 1707)
    assert max(Image.open(lib.path(pid, "thumb")).size) == 480


async def test_what_is_not_a_picture_is_refused_in_words(mantel):
    await owner(mantel)
    aid = await album(mantel)
    r, body = await upload(mantel, aid, b"<script>alert(1)</script>", name="x.jpg")
    assert r.status == 415 and body["error"] == "photo_invalid" and "JPEG" in body["message"]
    r, body = await upload(mantel, aid, b"\xff\xd8\xff" + b"\x00" * 100, name="broken.jpg")
    assert r.status == 415 and body["error"] == "photo_invalid"
    r, body = await upload(mantel, aid, picture("GIF"), name="anim.gif")
    assert r.status == 415
    assert mantel.app["photos"].count() == 0


async def test_the_same_picture_twice_in_an_album_is_skipped(mantel):
    await owner(mantel)
    aid, other = await album(mantel), await album(mantel, "Other")
    data = picture()
    r1, b1 = await upload(mantel, aid, data)
    r2, b2 = await upload(mantel, aid, data, name="again.jpg")
    assert r1.status == 201 and r2.status == 200 and b2["duplicate"] is True and b2["photo"]["id"] == b1["photo"]["id"]
    r3, _ = await upload(mantel, other, data)                          # another album may have it too
    assert r3.status == 201
    # two at once: still one
    results = await asyncio.gather(*(upload(mantel, aid, picture(color=(5, 5, 5))) for _ in range(3)))
    assert sorted(b["duplicate"] for _, b in results) == [False, True, True]
    assert mantel.app["photos"].count() == 3


async def test_the_limits_hold_and_only_an_owner_changes_them(mantel):
    await owner(mantel)
    aid = await album(mantel)
    r, body = await send(mantel, "PUT", "/api/photos/limits", {"file_mb": 1})
    assert r.status == 200 and body["limits"] == {"quota_mb": 4096, "file_mb": 1}
    r, body = await upload(mantel, aid, picture(size=(1400, 1400), noise=True, quality=100))
    assert r.status == 413 and body["error"] == "too_large" and "1 MB" in body["message"]
    for bad in ({"file_mb": 0}, {"quota_mb": 50}, {"quota_mb": "4096"}, {"other": 1}, {}):
        r, body = await send(mantel, "PUT", "/api/photos/limits", bad)
        assert r.status == 400 and body["error"] == "bad_limits"
    # the total: the library is (nearly) full
    lib = mantel.app["photos"]
    lib.db.execute("INSERT INTO photos (id, album_id, sha256, width, height, bytes, created) VALUES (?,?,?,?,?,?,?)",
                   ("f" * 32, aid, "0" * 64, 1, 1, (4096 << 20) - 10, 0.0))
    lib.db.commit()
    r, body = await upload(mantel, aid, picture())
    assert r.status == 413 and body["error"] == "quota_exceeded"
    assert ("photos.limits", {"before": {"quota_mb": 4096, "file_mb": 40}, "after": {"quota_mb": 4096, "file_mb": 1}}) in audits(mantel)
    # an Admin manages photos but not the limits
    mantel.forget_cookies()
    await owner(mantel, "alex", "admin")
    r, body = await send(mantel, "PUT", "/api/photos/limits", {"file_mb": 10})
    assert r.status == 403


# -- delete, move, screens -------------------------------------------------------------------------------------
async def test_many_are_deleted_and_moved_at_once(mantel):
    await owner(mantel)
    aid, other = await album(mantel), await album(mantel, "Other")
    ids = [(await upload(mantel, aid, picture(color=(i * 50, 0, 0))))[1]["photo"]["id"] for i in range(5)]
    (await upload(mantel, other, picture(color=(0, 0, 0))))                 # the same picture as ids[0]
    r, body = await send(mantel, "POST", "/api/photos/move", {"ids": ids[:3], "album": other})
    assert r.status == 200 and body["moved"] == ids[1:3] and body["skipped"] == [ids[0]]
    r, body = await send(mantel, "GET", f"/api/photos/albums/{other}/photos")
    assert len(body["photos"]) == 3
    r, body = await send(mantel, "POST", "/api/photos/delete", {"ids": ids[3:] + ["0" * 32]})
    assert r.status == 200 and sorted(body["deleted"]) == sorted(ids[3:])
    lib = mantel.app["photos"]
    assert all(lib.path(i, s) is None for i in ids[3:] for s in photos.SIZES)
    for bad in ({"ids": []}, {"ids": ["../etc"]}, {"ids": "x"}):
        r, body = await send(mantel, "POST", "/api/photos/delete", bad)
        assert r.status == 400 and body["error"] == "bad_ids"
    acts = [a for a, _ in audits(mantel)]
    assert "photos.move" in acts and "photos.delete" in acts


async def test_a_screen_shows_an_album_and_the_saver_reads_it(mantel):
    await owner(mantel)
    aid = await album(mantel)
    ids = [(await upload(mantel, aid, picture(color=(0, i * 60, 0))))[1]["photo"]["id"] for i in range(3)]
    r, body = await send(mantel, "PUT", "/api/photos/screens/dashboard-kitchen", {"album": aid})
    assert r.status == 200 and body["album"] == aid
    r, body = await send(mantel, "PUT", "/api/photos/screens/-x", {"album": aid})
    assert r.status == 400 and body["error"] == "bad_screen"
    assert (await send(mantel, "GET", "/api/photos/screens"))[1] == {"screens": {"dashboard-kitchen": aid}}
    r = await mantel.client.get(f"/api/photos/albums/{aid}/show")
    body = await r.json()
    assert r.headers["Cache-Control"] == "no-cache"
    assert sorted(p["id"] for p in body["photos"]) == sorted(ids)
    assert all(p["url"] == f"/api/photos/{p['id']}/screen" and (p["w"], p["h"]) == (80, 60) for p in body["photos"])
    r = await mantel.client.get(body["photos"][0]["url"])
    assert r.status == 200 and r.content_type == "image/jpeg" and "immutable" in r.headers["Cache-Control"]
    assert r.headers.get("ETag")
    r = await mantel.client.get(f"/api/photos/{ids[0]}/thumb")
    assert r.status == 200 and r.content_type == "image/webp"
    # clearing it, and deleting the album, take the screen back to the house's photos
    await send(mantel, "PUT", "/api/photos/screens/dashboard-kitchen", {"album": None})
    assert (await send(mantel, "GET", "/api/photos/screens"))[1] == {"screens": {}}
    await send(mantel, "PUT", "/api/photos/screens/dashboard-kitchen", {"album": aid})
    await send(mantel, "DELETE", f"/api/photos/albums/{aid}")
    assert (await send(mantel, "GET", "/api/photos/screens"))[1] == {"screens": {}}
    assert ("photos.screen", {"screen": "dashboard-kitchen", "album": aid}) in audits(mantel)


# -- who --------------------------------------------------------------------------------------------------------
async def test_who_may_manage_and_who_may_view(mantel):
    await owner(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    # CSRF on every change
    r, body = await send(mantel, "POST", "/api/photos/albums", {"name": "No token"}, csrf=False)
    assert r.status == 403
    r, _ = await upload(mantel, aid, picture(color=(1, 1, 1)), csrf=False)
    assert r.status == 403
    # signed out: nothing
    mantel.forget_cookies()
    for path in ("/api/photos", f"/api/photos/albums/{aid}/show", f"/api/photos/{pid}/screen", "/api/photos/screens"):
        r = await mantel.client.get(path, allow_redirects=False)
        assert r.status in (401, 302, 303), path
    # an Adult views (feature:media) but does not manage, and never gets the original
    await owner(mantel, "jordan", "adult")
    assert (await mantel.client.get("/api/photos")).status == 403
    assert (await send(mantel, "POST", "/api/photos/albums", {"name": "Mine"}))[0].status == 403
    assert (await mantel.client.get(f"/api/photos/albums/{aid}/show")).status == 200
    assert (await mantel.client.get(f"/api/photos/{pid}/screen")).status == 200
    assert (await mantel.client.get(f"/api/photos/{pid}/original")).status == 404
    # a Guest may not use feature:media: one answer for refused and missing
    mantel.forget_cookies()
    await owner(mantel, "gus", "guest")
    assert (await mantel.client.get(f"/api/photos/albums/{aid}/show")).status == 404
    assert (await mantel.client.get(f"/api/photos/{pid}/screen")).status == 404
    assert (await mantel.client.get("/api/photos/screens")).status == 404


async def test_a_wall_tablet_reads_the_album_it_shows(mantel):
    await owner(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    r = await mantel.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    assert (await mantel.client.get(f"/api/photos/albums/{aid}/show")).status == 200
    assert (await mantel.client.get(f"/api/photos/{pid}/screen")).status == 200
    assert (await mantel.client.get(f"/api/photos/{pid}/original")).status == 404
    assert (await mantel.client.get("/api/photos")).status == 403


# -- importing from Home Assistant ------------------------------------------------------------------------------
class FakeHA:
    """Home Assistant's media folder as Mantel sees it: browse and resolve over its own connection (a fake
    ReadProxy), the pictures over HTTP with HA's signature. Records everything asked of it."""

    def __init__(self, files):
        self.files = files                     # path under local/ -> bytes
        self.asked = []
        self.http = []

    async def close(self):
        pass

    async def request(self, msg, *, server_read=False):
        self.asked.append((msg["type"], server_read))
        cid = msg["media_content_id"]
        if msg["type"] == "media_source/browse_media":
            assert cid.startswith("media-source://media_source/local/photos")
            sub = cid[len("media-source://media_source/local/"):]
            kids, dirs = [], set()
            for p in self.files:
                if not p.startswith(sub + "/"):
                    continue
                rest = p[len(sub) + 1:]
                if "/" in rest:
                    dirs.add(rest.split("/")[0])
                else:
                    kind = "image" if rest.endswith((".jpg", ".png")) else "video"
                    kids.append({"media_content_id": f"media-source://media_source/local/{p}", "title": rest,
                                 "can_expand": False, "media_class": kind,
                                 "media_content_type": "image/jpeg" if kind == "image" else "video/mp4"})
            kids += [{"media_content_id": f"media-source://media_source/local/{sub}/{d}", "title": d,
                      "can_expand": True, "media_class": "directory"} for d in sorted(dirs)]
            kids.append({"media_content_id": "media-source://camera/camera.door", "title": "Door",
                         "can_expand": False, "media_class": "image", "media_content_type": "image/jpeg"})
            return {"children": kids}
        if msg["type"] == "media_source/resolve_media":
            assert server_read
            return {"url": "/media/local/" + cid[len("media-source://media_source/local/"):] + "?authSig=fake.sig",
                    "mime_type": "image/jpeg"}
        raise AssertionError(msg)

    def app(self):
        async def media(request):
            self.http.append((request.method, request.path, request.query.get("authSig"),
                              request.headers.get("Authorization")))
            data = self.files.get(request.match_info["path"])
            return web.Response(body=data, content_type="image/jpeg") if data is not None else web.Response(status=404)
        a = web.Application()
        a.router.add_get("/media/local/{path:.+}", media)
        return a


async def wait_import(mantel):
    for _ in range(200):
        body = (await send(mantel, "GET", "/api/photos/import"))[1]["importing"]
        if body and body["state"] in ("done", "failed", "cancelled"):
            return body
        await asyncio.sleep(0.02)
    raise AssertionError("the import did not finish")


async def test_an_owner_imports_a_home_assistant_folder(mantel):
    await owner(mantel)
    aid = await album(mantel, "From HA")
    ha = FakeHA({"photos/a.jpg": picture(color=(1, 0, 0)), "photos/b.jpg": picture(color=(2, 0, 0)),
                 "photos/2024/c.png": picture("PNG", color=(3, 0, 0)), "photos/clip.mp4": b"not a picture",
                 "photos/bad.jpg": b"\xff\xd8\xff not really"})
    server = TestServer(ha.app())
    await server.start_server()
    try:
        mantel.app["hub"].readproxy = ha
        mantel.app["cfg"].ha_url = str(server.make_url("")).rstrip("/")
        r, body = await send(mantel, "POST", "/api/photos/import", {"source": "media-source://camera/camera.door", "album": aid})
        assert r.status == 400 and body["error"] == "bad_source"
        r, body = await send(mantel, "POST", "/api/photos/import",
                             {"source": "media-source://media_source/local/photos", "album": aid})
        assert r.status == 202
        job = await wait_import(mantel)
        assert job["state"] == "done" and job["found"] == 4 and job["imported"] == 3 and job["failed"] == 1
        assert job["errors"][0]["name"] == "bad.jpg"
        names = sorted(p["name"] for p in (await send(mantel, "GET", f"/api/photos/albums/{aid}/photos"))[1]["photos"])
        assert names == ["a.jpg", "b.jpg", "c.png"]
        # again: every picture is already there
        await send(mantel, "POST", "/api/photos/import", {"source": "media-source://media_source/local/photos", "album": aid})
        job = await wait_import(mantel)
        assert job["imported"] == 0 and job["skipped"] == 3
        # only reads, only HA's media folders, HA's signature and never Mantel's token
        assert {t for t, _ in ha.asked} == {"media_source/browse_media", "media_source/resolve_media"}
        assert all(m == "GET" and sig == "fake.sig" and auth is None for m, _, sig, auth in ha.http)
        assert not any("camera" in p for _, p, _, _ in ha.http)
        acts = [a for a, _ in audits(mantel, "photos.import")]
        assert acts == ["photos.import.start", "photos.import.finish"] * 2
    finally:
        await server.close()


async def test_only_an_owner_imports(mantel):
    await owner(mantel, "alex", "admin")
    aid = await album(mantel)
    r, body = await send(mantel, "POST", "/api/photos/import", {"source": "media-source://media_source/local/photos", "album": aid})
    assert r.status == 403


async def test_an_import_says_when_home_assistant_is_not_connected(mantel):
    await owner(mantel)
    aid = await album(mantel)
    r, body = await send(mantel, "POST", "/api/photos/import", {"source": "media-source://media_source/local/photos", "album": aid})
    assert r.status == 503 and body["error"] == "ha_unavailable"


def test_a_resolved_address_must_be_a_media_path():
    assert photos.signed_media_path("/media/local/a%20b.jpg?authSig=x") == "/media/local/a%20b.jpg?authSig=x"
    for bad in ("http://evil/media/local/a.jpg", "//evil/media/a.jpg", "/api/states", "/media/../api/x",
                "/media/local//a.jpg", None, "/media/local/a.jpg#x"):
        assert photos.signed_media_path(bad) is None


def test_album_sources():
    assert photos.album_of("mantel-photos://0123456789abcdef") == "0123456789abcdef"
    assert photos.album_of("mantel-photos://../x") is None and photos.album_of("media-source://x") is None


# -- backup -----------------------------------------------------------------------------------------------------
async def test_the_photos_are_in_mantels_backup_and_come_back(mantel, tmp_path):
    await owner(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    data_dir = mantel.app["cfg"].data_dir
    mantel.store.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    target = tmp_path / "nas"
    target.mkdir()
    key = os.urandom(32)
    path = backup.create_backup(data_dir, target, key, rotate_after=False)
    fresh = tmp_path / "restored"
    rep = backup.restore(path, key, fresh)
    assert (fresh / "photos" / "screen" / f"{pid}.jpg").read_bytes() == (data_dir / "photos" / "screen" / f"{pid}.jpg").read_bytes()
    assert stat.S_IMODE(os.stat(fresh / "photos" / "screen" / f"{pid}.jpg").st_mode) == 0o600
    assert rep.tables["photos"] == 1
    # without "Your files", without the photos
    path2 = backup.create_backup(data_dir, target, key, include_files=False, rotate_after=False,
                                 now=__import__("datetime").datetime(2030, 1, 1, tzinfo=__import__("datetime").timezone.utc))
    fresh2 = tmp_path / "restored2"
    backup.restore(path2, key, fresh2)
    assert not (fresh2 / "photos").exists()
