"""Time Behind (cutout.py, photos.py, image_work.py, migration 0027): each photo's subject cut out on upload and by the
backfill, marked usable only where it works, stored as a mask and a place for the time; what the screensavers read;
an album's Only Photos That Qualify; the quota, the backup, Setup Check. The model itself (u2netp.onnx) is not in
git until the owner fetches it, so every test here runs a FAKE model on GENERATED pictures and masks (flat colours
and shapes): there is no real photo, or real model, in git."""
import asyncio
import io
import json
import logging
import shutil

import pytest
from aiohttp import FormData
from PIL import Image, ImageDraw

from mantel_server.cameras import cutout, faces, image_work, imaging, photos
from mantel_server.storage import db as dbm
from mantel_server.pages import setup_check

np = pytest.importorskip("numpy")


@pytest.fixture(autouse=True)
def _in_this_process(image_threads):
    """These tests replace cutout.Cutter and cutout.available here: the picture work must run here to see them."""


# -- generated masks --------------------------------------------------------------------------------------------------
def portrait(w, h, head=(0.5, 0.42, 0.11), body=(0.31, 0.58, 0.69)):
    """A head-and-shoulders subject as a mask the size of a picture: a disc and a block below it (fractions)."""
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    cx, cy, r = head[0] * w, head[1] * h, head[2] * min(w, h) * 1.4
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    d.rectangle([body[0] * w, body[1] * h, body[2] * w, h], fill=255)
    return im


def grid(mask_img):
    return cutout.grid_of(mask_img, np)


def test_a_clear_subject_is_usable_wherever_it_sits_and_no_place_is_chosen_here():
    # (2026-10-30) the time is always upper centre; each screen decides behind or in front (hk-saver.js)
    for head, body in (((0.5, 0.42, 0.11), (0.31, 0.58, 0.69)), ((0.22, 0.45, 0.1), (0.05, 0.6, 0.4)), ((0.8, 0.5, 0.1), (0.62, 0.65, 0.98))):
        got = cutout.judge(grid(portrait(960, 720, head=head, body=body)), np)
        assert got["ok"] and got["why"] is None and got["box"] is None and got["overlap"] is None, got
        assert cutout.COVER[0] <= got["cover"] <= cutout.COVER[1]


def test_too_small_or_too_large_a_subject_is_not_used():
    tiny = Image.new("L", (960, 720), 0)
    ImageDraw.Draw(tiny).ellipse([460, 340, 500, 380], fill=255)          # a speck
    assert cutout.judge(grid(tiny), np)["why"] == "small"
    big = Image.new("L", (960, 720), 255)
    ImageDraw.Draw(big).rectangle([0, 0, 960, 60], fill=0)               # a subject filling nearly all the frame
    assert cutout.judge(grid(big), np)["why"] == "large"
    assert cutout.judge(grid(Image.new("L", (960, 720), 0)), np)["why"] == "small", "a landscape with no subject"


def test_an_unsure_mask_is_not_used():
    m = portrait(960, 720)
    soft = Image.eval(m, lambda v: 128 if v else 90)                     # half-sure everywhere it says anything
    got = cutout.judge(grid(soft), np)
    assert got["why"] in ("unsure", "small", "large") and not got["ok"]
    fuzzy = Image.blend(m, Image.new("L", m.size, 128), 0.6)              # the subject, but mostly half-sure
    got = cutout.judge(grid(fuzzy), np)
    assert not got["ok"] and got["conf"] < cutout.LOOSEST["sure"]


def test_a_subject_along_the_top_is_still_a_clear_subject_the_screen_decides():
    m = Image.new("L", (960, 720), 0)
    ImageDraw.Draw(m).rectangle([0, 0, 960, 260], fill=255)              # a band along the top
    got = cutout.judge(grid(m), np)
    assert got["ok"] and got["why"] is None, "no longer 'place': the screen finds it covers too much of the time"


def test_judged_by_these_rules():
    assert cutout.BY == "u2netp/3" and cutout.result(portrait(96, 72), np)["by"] == cutout.BY


# -- the presets (2026-11-01, the owner: "a threshold adjustment...or maybe a few presets") ----------------------------
def test_the_presets_go_from_strict_to_relaxed_and_standard_is_the_plans():
    assert list(cutout.PRESETS) == ["strict", "standard", "relaxed"] and cutout.PRESET == "standard"
    assert cutout.PRESETS["standard"] == {"cover": (0.08, 0.60), "sure": 0.75}
    s, m, r = (cutout.PRESETS[k] for k in cutout.PRESETS)
    assert s["cover"][0] > m["cover"][0] > r["cover"][0] and s["cover"][1] < m["cover"][1] < r["cover"][1]
    assert s["sure"] > m["sure"] > r["sure"]
    assert cutout.LOOSEST == r, "a mask is kept for whatever Relaxed takes"


def test_a_verdict_says_why_a_photo_does_not_qualify():
    std = cutout.PRESETS["standard"]
    assert cutout.verdict(0.3, 0.9, std) is None
    assert cutout.verdict(0.05, 0.9, std) == "small" and cutout.verdict(0.05, 0.9, cutout.PRESETS["relaxed"]) is None
    assert cutout.verdict(0.7, 0.9, std) == "large"
    assert cutout.verdict(0.3, 0.7, std) == "unsure" and cutout.verdict(0.3, 0.7, cutout.PRESETS["relaxed"]) is None
    assert cutout.verdict(0.02, 0.5, std) == "small", "the size first, as before"
    assert cutout.verdict(None, None, std) == "unreadable"
    assert cutout.verdict(0.3, 0.9, std, kept=False) == "full", "it would, but Mantel Photos had no room for its mask"
    # judged before the share of the frame was kept: by the confidence; one with no mask is checked again
    assert cutout.verdict(None, 0.9, std, kept=True) is None
    assert cutout.verdict(None, 0.9, std, kept=False) == "again"
    assert cutout.verdict(None, 0.5, std, kept=False) == "unsure"


def test_a_mask_is_kept_for_whatever_the_loosest_preset_takes():
    small = Image.new("L", (960, 720), 0)
    ImageDraw.Draw(small).rectangle([400, 300, 560, 520], fill=255)       # about 5 % of the frame
    got = cutout.judge(grid(small), np)
    assert got["ok"] and cutout.LOOSEST["cover"][0] <= got["cover"] < cutout.COVER[0], got
    assert cutout.verdict(got["cover"], got["conf"], cutout.PRESETS["standard"]) == "small"
    assert cutout.result(small, np)["mask"], "kept, so Relaxed applies at once"


def test_the_stored_mask_is_white_with_the_mask_in_its_alpha():
    m = portrait(64, 48)
    png = cutout.mask_png(m)
    back = Image.open(io.BytesIO(png))
    assert back.mode == "LA" and back.size == (64, 48)
    lum, alpha = back.split()
    assert lum.getextrema() == (255, 255) and alpha.tobytes() == m.tobytes()


def test_without_the_model_nothing_is_trusted(tmp_path, monkeypatch):
    assert cutout.MODEL.name == "u2netp.onnx" and "rembg" in cutout.MODEL_URL and cutout.NAME == "u2netp"
    fake = tmp_path / "u2netp.onnx"
    monkeypatch.setattr(cutout, "MODEL", fake)
    assert not cutout.model_ok(fake) and "isn’t installed" in cutout.why_not()
    fake.write_bytes(b"a stand-in, not a model")
    monkeypatch.setattr(cutout, "MODEL_SHA256", "")
    assert not cutout.model_ok(fake) and "checksum isn’t set" in cutout.why_not(), "no checksum: never loaded"
    import hashlib
    monkeypatch.setattr(cutout, "MODEL_SHA256", hashlib.sha256(b"something else").hexdigest())
    assert not cutout.model_ok(fake) and "isn’t the expected file" in cutout.why_not()
    monkeypatch.setattr(cutout, "MODEL_SHA256", hashlib.sha256(fake.read_bytes()).hexdigest())
    assert cutout.model_ok(fake)
    assert (cutout.Path(str(cutout.files("mantel_server").joinpath("models", "u2netp_LICENSE")))).read_text().count("Apache License") >= 1


def test_the_vendored_model_when_there_is_one_is_the_expected_file():
    real = cutout.MODEL
    if not real.exists():
        assert not cutout.available(), "no model file: cut-outs are unavailable"
        pytest.skip("u2netp.onnx isn't vendored yet (the owner fetches it)")
    assert cutout.MODEL_SHA256, "a vendored model needs its SHA-256 in cutout.MODEL_SHA256"
    assert cutout.model_ok(real)


class FakeSession:
    """onnxruntime.InferenceSession's shape: one input, one output of (1, 1, 320, 320)."""
    shown = []

    def __init__(self, *a, **kw):
        pass

    def get_inputs(self):
        return [type("I", (), {"name": "input.1"})()]

    def run(self, outs, feeds):
        x = feeds["input.1"]
        FakeSession.shown.append(x.shape)
        pred = np.full((1, 1, cutout.SIZE, cutout.SIZE), -3.0, np.float32)
        pred[0, 0, 100:320, 110:210] = 5.0                              # a subject, centred, from a third down
        return [pred, pred * 0]


def test_the_model_is_read_as_rembg_reads_it(monkeypatch, tmp_path):
    class Ort:
        InferenceSession = FakeSession

        class SessionOptions:
            pass

        class ExecutionMode:
            ORT_SEQUENTIAL = 0
    monkeypatch.setattr(faces, "_runtime", (Ort, np))
    monkeypatch.setattr(cutout, "model_ok", lambda path=None: True)
    FakeSession.shown = []
    with cutout.Cutter(tmp_path / "u2netp.onnx") as c:
        m = c.mask(Image.new("RGB", (640, 480), (90, 120, 30)))
    assert FakeSession.shown == [(1, 3, cutout.SIZE, cutout.SIZE)], "one 320 x 320 RGB picture, channels first"
    assert m.mode == "L" and m.size == (640, 480), "stretched back to the picture's own size"
    assert m.getpixel((320, 400)) == 255 and m.getpixel((20, 20)) == 0, "stretched to 0..255"


# -- the library: on upload -------------------------------------------------------------------------------------------
def picture(color=(200, 30, 30), size=(160, 120), year=None) -> bytes:
    buf = io.BytesIO()
    im = Image.new("RGB", size, color)
    if year is None:
        im.save(buf, "JPEG")
    else:
        ex = Image.Exif()
        ex.get_ifd(0x8769)[36867] = f"{year}:07:12 14:03:22"
        im.save(buf, "JPEG", exif=ex.tobytes())
    return buf.getvalue()


async def sign_in(mantel, name="avery", role="owner"):
    await mantel.user(name, role)
    r, _ = await mantel.sign_in(name)
    assert r.status == 200


async def send(mantel, method, path, body=None, csrf=True):
    r = await mantel.client.request(method, path, json=body, headers=mantel.headers(csrf))
    return r, await r.json()


async def album(mantel, name="Family"):
    r, body = await send(mantel, "POST", "/api/photos/albums", {"name": name})
    assert r.status == 201, body
    return body["album"]["id"]


async def upload(mantel, aid, data, name="photo.jpg"):
    fd = FormData()
    fd.add_field("file", data, filename=name, content_type="application/octet-stream")
    r = await mantel.client.post(f"/api/photos/albums/{aid}/upload", data=fd, headers=mantel.headers())
    return r, await r.json()


def row(mantel, pid):
    return dict(mantel.store.db.execute("SELECT cutout_at, cutout_by, cutout_ok, cutout_conf, cutout_cover, depth_box, "
                                        "bytes, taken FROM photos WHERE id=?", (pid,)).fetchone())


class FakeCutter:
    """cutout.Cutter's shape: what it was shown, and the mask it answers (``shape``: a picture size -> 'L' mask)."""
    seen: list = []
    shape = staticmethod(lambda size: portrait(*size))
    stop_after: int | None = None
    broken: bool = False

    def __init__(self, *a):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def mask(self, img):
        FakeCutter.seen.append(img.getpixel((0, 0)))
        if FakeCutter.stop_after is not None and len(FakeCutter.seen) > FakeCutter.stop_after:
            raise asyncio.CancelledError                    # the server stopping mid-way
        if FakeCutter.broken:
            raise RuntimeError("onnxruntime: out of memory")
        return FakeCutter.shape(img.size)


@pytest.fixture
def fake_cutter(monkeypatch):
    FakeCutter.seen, FakeCutter.stop_after, FakeCutter.broken = [], None, False
    FakeCutter.shape = staticmethod(lambda size: portrait(*size))
    monkeypatch.setattr(cutout, "available", lambda: True)
    monkeypatch.setattr(cutout, "Cutter", FakeCutter)
    monkeypatch.setattr(cutout, "numpy", lambda: np)
    monkeypatch.setattr(faces, "available", lambda: False)             # (the faces are test_photo_faces.py's)
    return FakeCutter


@pytest.fixture
def no_cutter(monkeypatch):
    monkeypatch.setattr(cutout, "available", lambda: False)
    monkeypatch.setattr(faces, "available", lambda: False)


async def test_an_upload_is_cut_out_after_its_faces_and_a_usable_one_keeps_its_mask(mantel, fake_cutter):
    await sign_in(mantel)
    aid = await album(mantel)
    r, body = await upload(mantel, aid, picture())
    assert r.status == 201, body
    pid = body["photo"]["id"]
    got = row(mantel, pid)
    assert got["cutout_ok"] == 1 and got["cutout_by"] == "u2netp/3" and got["cutout_at"] is not None
    assert cutout.COVER[0] <= got["cutout_cover"] <= cutout.COVER[1]
    assert got["cutout_conf"] > cutout.SURE and got["depth_box"] is None, "no place is chosen here: each screen decides"
    lib = mantel.app["photos"]
    mask = lib.path(pid, "mask")
    assert mask is not None and mask.stat().st_mode & 0o777 == 0o600
    assert Image.open(mask).size == Image.open(lib.path(pid, "screen")).size, "the size of the screen copy"
    sizes = sum(lib.path(pid, s).stat().st_size for s in ("original", "screen", "thumb", "mask"))
    assert got["bytes"] == sizes and lib.usage() == sizes, "the mask counts against the quota"
    # the manager's list carries it (the page's Time Behind badge)
    r, body = await send(mantel, "GET", f"/api/photos/albums/{aid}/photos")
    assert body["photos"][0]["cutout"] == {"ok": True, "why": None, "conf": got["cutout_conf"],
                                           "cover": got["cutout_cover"], "by": "u2netp/3"}


async def test_an_unusable_cut_out_is_marked_checked_and_keeps_no_mask(mantel, fake_cutter):
    fake_cutter.shape = staticmethod(lambda size: Image.new("L", size, 0))     # no subject at all
    await sign_in(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    got = row(mantel, pid)
    assert got["cutout_ok"] == 0 and got["cutout_at"] is not None and got["depth_box"] is None
    assert mantel.app["photos"].path(pid, "mask") is None
    r, body = await send(mantel, "GET", f"/api/photos/albums/{aid}/photos")
    assert body["photos"][0]["cutout"]["ok"] is False and body["photos"][0]["cutout"]["why"] == "small"


def _small(size):
    """A subject about 5 % of the frame: Relaxed takes it, Standard and Strict don't."""
    im = Image.new("L", size, 0)
    w, h = size
    ImageDraw.Draw(im).rectangle([w * 0.42, h * 0.42, w * 0.58, h * 0.72], fill=255)
    return im


async def test_the_preset_applies_at_once_to_the_list_the_counts_and_the_screens(mantel, fake_cutter):
    await sign_in(mantel)
    aid = await album(mantel)
    good = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    fake_cutter.shape = staticmethod(_small)
    small = (await upload(mantel, aid, picture(color=(9, 9, 9))))[1]["photo"]["id"]
    lib = mantel.app["photos"]
    assert lib.path(small, "mask") is not None, "kept for Relaxed"
    r, body = await send(mantel, "PUT", f"/api/photos/albums/{aid}/options", {"depth_only": True})

    async def state():
        _, ov = await send(mantel, "GET", "/api/photos")
        _, lst = await send(mantel, "GET", f"/api/photos/albums/{aid}/photos")
        r = await mantel.client.get(f"/api/photos/albums/{aid}/show")
        shown = (await r.json())["photos"]
        return (ov["cutouts"], {p["id"]: p["cutout"]["ok"] for p in lst["photos"]},
                [p["id"] for p in shown if "depth" in p], [a["depth"] for a in ov["albums"] if a["id"] == aid][0])

    cut, ok, shown, depth = await state()
    assert cut["preset"] == "standard" and cut["usable"] == 1 and cut["presets"] == {"strict": 1, "standard": 1, "relaxed": 2}
    assert cut["reasons"] == {"small": 1} and ok == {good: True, small: False} and shown == [good] and depth == 1

    r, body = await send(mantel, "PUT", "/api/photos/cutouts", {"preset": "relaxed"})
    assert r.status == 200 and body["cutouts"]["preset"] == "relaxed" and body["cutouts"]["usable"] == 2
    cut, ok, shown, depth = await state()
    assert cut["reasons"] == {} and ok == {good: True, small: True} and sorted(shown) == sorted([good, small]) and depth == 2

    audits = [json.loads(x["target"]) for x in mantel.store.db.execute(
        "SELECT action, target FROM action_audit WHERE kind='config' ORDER BY id") if x["action"] == "photos.cutouts.preset"]
    assert audits and audits[-1]["before"] == "standard" and audits[-1]["after"] == "relaxed"
    for bad in ({"preset": "loose"}, {}, {"preset": "relaxed", "x": 1}, {"preset": 1}):
        r, body = await send(mantel, "PUT", "/api/photos/cutouts", bad)
        assert r.status == 400 and body["error"] == "bad_preset", bad
    r, _ = await send(mantel, "PUT", "/api/photos/cutouts", {"preset": "strict"}, csrf=False)
    assert r.status in (401, 403)
    await mantel.user("sam", "adult")
    await mantel.sign_in("sam")
    r, _ = await send(mantel, "PUT", "/api/photos/cutouts", {"preset": "strict"})
    assert r.status in (403, 404)
    assert lib.cutout_preset() == "relaxed"


async def test_photos_judged_by_older_rules_are_checked_again_and_count_meanwhile(mantel, fake_cutter, monkeypatch):
    aid, ids = await _uncut(mantel, 3, monkeypatch)
    lib = mantel.app["photos"]
    await photos.CutoutBackfill(mantel.app, start=0, rest=0).run()
    # as u2netp/2 left them: no share of the frame; a usable one with its mask, a too-small one with none
    with mantel.store.db:
        mantel.store.db.execute("UPDATE photos SET cutout_by='u2netp/2', cutout_cover=NULL")
        mantel.store.db.execute("UPDATE photos SET cutout_ok=0 WHERE id=?", (ids[0],))
        mantel.store.db.execute("UPDATE photos SET cutout_ok=0, cutout_conf=NULL WHERE id=?", (ids[1],))
    st = lib.cutout_counts()
    assert st["left"] == 3 and st["checked"] == 0 and st["usable"] == 1, "the one with its mask still qualifies"
    assert st["reasons"] == {"again": 1, "unreadable": 1}
    fake_cutter.seen.clear()
    await photos.CutoutBackfill(mantel.app, start=0, rest=0).run()
    assert len(fake_cutter.seen) == 3 and lib.uncut(faces_known=False) is None
    assert all(row(mantel, p)["cutout_by"] == "u2netp/3" and row(mantel, p)["cutout_cover"] for p in ids)
    st = lib.cutout_counts()
    assert st["left"] == 0 and st["checked"] == 3 and st["usable"] == 3


async def test_without_the_model_an_upload_works_and_is_left_for_later(mantel, no_cutter):
    await sign_in(mantel)
    aid = await album(mantel)
    r, body = await upload(mantel, aid, picture())
    assert r.status == 201
    got = row(mantel, body["photo"]["id"])
    assert got["cutout_at"] is None and got["cutout_ok"] is None
    r, body = await send(mantel, "GET", f"/api/photos/albums/{aid}/photos")
    assert body["photos"][0]["cutout"] is None


async def test_a_model_that_fails_never_fails_the_upload(mantel, fake_cutter):
    fake_cutter.broken = True
    await sign_in(mantel)
    aid = await album(mantel)
    r, body = await upload(mantel, aid, picture())
    assert r.status == 201, body
    assert row(mantel, body["photo"]["id"])["cutout_at"] is None, "left for the backfill"


async def test_the_year_a_photo_was_taken_is_kept_and_nothing_else_of_its_exif(mantel, no_cutter):
    await sign_in(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture(year=2025)))[1]["photo"]["id"]
    assert row(mantel, pid)["taken"] == 2025
    stored = Image.open(mantel.app["photos"].path(pid, "original"))
    assert not stored.getexif(), "the EXIF itself is still dropped"
    pid2 = (await upload(mantel, aid, picture(color=(1, 2, 3))))[1]["photo"]["id"]
    assert row(mantel, pid2)["taken"] is None
    r = await mantel.client.get(f"/api/photos/albums/{aid}/show")
    shown = {p["id"]: p for p in (await r.json())["photos"]}
    assert shown[pid]["year"] == 2025 and "year" not in shown[pid2]


# -- what the screensavers read ---------------------------------------------------------------------------------------
async def test_the_screensavers_read_the_mask_and_the_place_only_for_a_usable_photo(mantel, fake_cutter):
    await sign_in(mantel)
    aid = await album(mantel)
    good = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    fake_cutter.shape = staticmethod(lambda size: Image.new("L", size, 0))
    bad = (await upload(mantel, aid, picture(color=(9, 9, 9))))[1]["photo"]["id"]
    r = await mantel.client.get(f"/api/photos/albums/{aid}/show")
    shown = {p["id"]: p for p in (await r.json())["photos"]}
    assert "depth" not in shown[bad]
    d = shown[good]["depth"]
    assert "box" not in d, "the mask alone: the screen decides where the time goes"
    assert d["mask"].startswith(f"/api/photos/{good}/mask?v=")
    r = await mantel.client.get(d["mask"])
    assert r.status == 200 and r.content_type == "image/png" and "immutable" in r.headers["Cache-Control"]
    assert (await mantel.client.get(f"/api/photos/{bad}/mask")).status == 404


async def test_only_photos_that_qualify(mantel, fake_cutter):
    await sign_in(mantel)
    aid = await album(mantel)
    good = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    fake_cutter.shape = staticmethod(lambda size: Image.new("L", size, 0))
    await upload(mantel, aid, picture(color=(9, 9, 9)))
    r, body = await send(mantel, "PUT", f"/api/photos/albums/{aid}/options", {"depth_only": True})
    assert r.status == 200 and body["album"] == {"id": aid, "depth_only": True}
    r = await mantel.client.get(f"/api/photos/albums/{aid}/show")
    assert [p["id"] for p in (await r.json())["photos"]] == [good]
    r, body = await send(mantel, "GET", "/api/photos")
    a = [x for x in body["albums"] if x["id"] == aid][0]
    assert a["depth_only"] is True and a["depth"] == 1 and a["count"] == 2
    audits = [(x["action"], json.loads(x["target"])) for x in mantel.store.db.execute(
        "SELECT action, target FROM action_audit WHERE kind='config' ORDER BY id") if x["action"] == "photos.album.options"]
    assert audits and audits[-1][1]["depth_only"] is True
    for bad in ({"depth_only": "yes"}, {}, {"depth_only": True, "x": 1}):
        r, body = await send(mantel, "PUT", f"/api/photos/albums/{aid}/options", bad)
        assert r.status == 400 and body["error"] == "bad_options", bad
    r, body = await send(mantel, "PUT", f"/api/photos/albums/{aid}/options", {"depth_only": True}, csrf=False)
    assert r.status in (401, 403)


async def test_an_adult_may_not_change_an_albums_options(mantel, no_cutter):
    await sign_in(mantel)
    aid = await album(mantel)
    await mantel.user("sam", "adult")
    await mantel.sign_in("sam")
    r, _ = await send(mantel, "PUT", f"/api/photos/albums/{aid}/options", {"depth_only": True})
    assert r.status in (403, 404)


async def test_deleting_a_photo_takes_its_mask_with_it(mantel, fake_cutter):
    await sign_in(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    lib = mantel.app["photos"]
    mask = lib.path(pid, "mask")
    assert mask is not None
    r, _ = await send(mantel, "POST", "/api/photos/delete", {"ids": [pid]})
    assert r.status == 200 and not mask.exists() and lib.usage() == 0


# -- the backfill -----------------------------------------------------------------------------------------------------
async def _uncut(mantel, n, monkeypatch):
    """n photos stored with no model (newest last), their colours telling them apart; their faces looked for."""
    await sign_in(mantel)
    aid = await album(mantel)
    ids = []
    with monkeypatch.context() as m:
        m.setattr(cutout, "available", lambda: False)
        for i in range(n):
            mantel.now[0] += 10
            ids.append((await upload(mantel, aid, picture(color=(10 * i, 0, 0))))[1]["photo"]["id"])
    for pid in ids:
        mantel.app["photos"].set_faces(pid, [])
    return aid, ids


async def test_the_backfill_cuts_out_old_photos_one_at_a_time_newest_first(mantel, fake_cutter, monkeypatch, caplog):
    aid, ids = await _uncut(mantel, 3, monkeypatch)
    caplog.set_level(logging.INFO, logger="mantel.photos")
    await photos.CutoutBackfill(mantel.app, start=0, rest=0).run()
    reds = [c[0] for c in fake_cutter.seen]
    assert len(reds) == 3 and reds == sorted(reds, reverse=True), "newest first"
    lib = mantel.app["photos"]
    assert all(row(mantel, p)["cutout_ok"] == 1 and lib.path(p, "mask") is not None for p in ids)
    assert lib.uncut(faces_known=False) is None
    assert sum(r["bytes"] for r in mantel.store.db.execute("SELECT bytes FROM photos")) == lib.usage()
    assert all(r["bytes"] == sum(lib.path(r["id"], s).stat().st_size for s in ("original", "screen", "thumb", "mask"))
               for r in mantel.store.db.execute("SELECT id, bytes FROM photos")), "each mask counted once"
    assert any("cut out 3 photos" in r.getMessage() and "(3 usable for Time Behind)" in r.getMessage()
               for r in caplog.records)
    st = photos.CutoutBackfill(mantel.app).status()
    assert st["checked"] == 3 and st["usable"] == 3 and st["left"] == 0 and st["state"] == "done"


async def test_the_backfill_hands_the_model_the_faces_found(mantel, fake_cutter, monkeypatch):
    aid, ids = await _uncut(mantel, 1, monkeypatch)
    mantel.app["photos"].set_faces(ids[0], [[0.4, 0.3, 0.2, 0.25, 0.97]])
    seen = []
    real = cutout.result

    def spy(img, np_, faces_=None):
        seen.append(faces_)
        return real(img, np_, faces_)
    monkeypatch.setattr(cutout, "result", spy)
    await photos.CutoutBackfill(mantel.app, start=0, rest=0).run()
    assert seen == [[[0.4, 0.3, 0.2, 0.25, 0.97]]]


async def test_the_backfill_carries_on_after_a_restart(mantel, fake_cutter, monkeypatch):
    aid, ids = await _uncut(mantel, 3, monkeypatch)
    fake_cutter.stop_after = 1
    with pytest.raises(asyncio.CancelledError):
        await photos.CutoutBackfill(mantel.app, start=0, rest=0).run()
    assert row(mantel, ids[2])["cutout_at"] is not None and row(mantel, ids[1])["cutout_at"] is None
    fake_cutter.stop_after = None
    fake_cutter.seen.clear()
    await photos.CutoutBackfill(mantel.app, start=0, rest=0).run()
    assert len(fake_cutter.seen) == 2 and mantel.app["photos"].uncut(faces_known=False) is None


async def test_an_unreadable_file_is_marked_and_never_tried_again(mantel, fake_cutter, monkeypatch):
    aid, ids = await _uncut(mantel, 2, monkeypatch)
    lib = mantel.app["photos"]
    lib.path(ids[1], "screen").write_bytes(b"not a picture")
    lib.path(ids[0], "screen").unlink()
    await photos.CutoutBackfill(mantel.app, start=0, rest=0).run()
    assert fake_cutter.seen == []
    assert all(row(mantel, p)["cutout_ok"] == 0 and row(mantel, p)["cutout_at"] is not None for p in ids)


async def test_a_failing_model_leaves_photos_for_another_run_and_stops(mantel, fake_cutter, monkeypatch, caplog):
    aid, ids = await _uncut(mantel, 5, monkeypatch)
    fake_cutter.broken = True
    caplog.set_level(logging.WARNING, logger="mantel.photos")
    await photos.CutoutBackfill(mantel.app, start=0, rest=0).run()
    assert len(fake_cutter.seen) == photos.CutoutBackfill.FAILURES_MAX
    assert all(row(mantel, p)["cutout_at"] is None for p in ids)
    assert any("cut-out backfill stops" in r.getMessage() for r in caplog.records)


async def test_the_backfill_waits_for_a_photos_faces(mantel, fake_cutter, monkeypatch):
    aid, ids = await _uncut(mantel, 2, monkeypatch)
    lib = mantel.app["photos"]
    with mantel.store.db:
        mantel.store.db.execute("UPDATE photos SET faces=NULL, faces_at=NULL WHERE id=?", (ids[1],))
    monkeypatch.setattr(faces, "available", lambda: True)

    # the face backfill still looking
    monkeypatch.setattr(photos.FaceBackfill, "running", property(lambda self: not isinstance(self, photos.CutoutBackfill)))
    bf = photos.CutoutBackfill(mantel.app, start=0, rest=0)
    bf.IMPORT_WAIT = 0.01
    task = asyncio.ensure_future(bf.run())
    for _ in range(50):
        await asyncio.sleep(0.01)
        if row(mantel, ids[0])["cutout_at"] is not None:
            break
    assert row(mantel, ids[0])["cutout_at"] is not None and row(mantel, ids[1])["cutout_at"] is None, \
        "the photo with its faces known first; the other waits"
    lib.set_faces(ids[1], [])
    await asyncio.wait_for(task, 2)
    assert row(mantel, ids[1])["cutout_at"] is not None


async def test_the_backfill_waits_while_an_import_runs(mantel, fake_cutter, monkeypatch):
    aid, ids = await _uncut(mantel, 1, monkeypatch)

    class Running:
        running = True
    monkeypatch.setattr(photos.Importer, "running", property(lambda self: Running.running))
    bf = photos.CutoutBackfill(mantel.app, start=0, rest=0)
    bf.IMPORT_WAIT = 0.01
    task = bf.start()
    await asyncio.sleep(0.05)
    assert fake_cutter.seen == [] and bf.status()["state"] == "waiting"
    Running.running = False
    await asyncio.wait_for(task, 2)
    assert len(fake_cutter.seen) == 1


async def test_a_mask_that_does_not_fit_the_quota_is_not_kept(mantel, fake_cutter, monkeypatch):
    aid, ids = await _uncut(mantel, 1, monkeypatch)
    lib = mantel.app["photos"]
    monkeypatch.setattr(lib, "limits", lambda: {"quota_mb": 0, "file_mb": 40})
    await photos.CutoutBackfill(mantel.app, start=0, rest=0).run()
    got = row(mantel, ids[0])
    assert got["cutout_at"] is not None and got["cutout_ok"] == 0 and lib.path(ids[0], "mask") is None


async def test_nothing_runs_without_the_model(mantel, no_cutter, monkeypatch, tmp_path):
    monkeypatch.setattr(cutout, "MODEL", tmp_path / "u2netp.onnx")       # (the model is vendored: as a server without it)
    await _uncut(mantel, 1, monkeypatch)
    bf = photos.CutoutBackfill(mantel.app, start=0, rest=0)
    assert bf.start() is None and bf.status()["state"] == "unavailable"
    r, body = await send(mantel, "GET", "/api/photos/cutouts")
    assert r.status == 200 and body["cutouts"]["state"] == "unavailable" and body["cutouts"]["why"]


async def test_the_server_starts_the_backfill_and_stops_it(mantel):
    bf = mantel.app["photos_cutouts"]
    assert isinstance(bf, photos.CutoutBackfill) and bf.start_after == 60
    if not imaging.cutouts_available():
        assert bf.task is None, "no model: nothing started"


async def test_the_overview_and_the_progress_are_a_managers(mantel, fake_cutter, monkeypatch):
    await _uncut(mantel, 2, monkeypatch)
    r, body = await send(mantel, "GET", "/api/photos")
    assert body["cutouts"]["photos"] == 2 and body["cutouts"]["left"] == 2
    await mantel.user("sam", "adult")
    await mantel.sign_in("sam")
    r = await mantel.client.get("/api/photos/cutouts")
    assert r.status in (403, 404)


# -- setup check, backups, the migration ------------------------------------------------------------------------------
async def test_setup_check_says_when_the_model_cannot_run(mantel, monkeypatch, tmp_path):
    monkeypatch.setattr(cutout, "MODEL", tmp_path / "u2netp.onnx")       # (the model is vendored: as a server without it)
    monkeypatch.setattr(imaging, "cutouts_available", lambda: False)     # (and the worker not having said otherwise)
    lines = lambda: [x for x in setup_check.lines(mantel.app, 1) if x["title"] == "Time Behind"]   # noqa: E731
    assert lines() == [], "no photos: nothing to say"
    await _uncut(mantel, 1, monkeypatch)
    got = lines()
    assert len(got) == 1 and got[0]["ok"] is None and "u2netp.onnx" in got[0]["detail"] and "in front" in got[0]["detail"]
    monkeypatch.setattr(imaging, "cutouts_available", lambda: True)
    assert lines() == []


async def test_the_masks_are_in_mantels_backup(mantel, fake_cutter, tmp_path):
    import os
    from mantel_server.storage import backup
    await sign_in(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    data_dir = mantel.app["cfg"].data_dir
    mantel.store.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    target = tmp_path / "nas"
    target.mkdir()
    key = os.urandom(32)
    path = backup.create_backup(data_dir, target, key, rotate_after=False)
    fresh = tmp_path / "restored"
    backup.restore(path, key, fresh)
    assert (fresh / "photos" / "masks" / f"{pid}.png").read_bytes() == mantel.app["photos"].path(pid, "mask").read_bytes()


def test_the_migration_keeps_photos_already_there(tmp_path):
    old = tmp_path / "upto26"
    old.mkdir()
    for m in dbm.discover():
        if m.version <= 26:
            shutil.copy(m.path, old / m.path.name)
    conn = dbm.connect(tmp_path / "m.db")
    dbm.migrate(conn, old)
    with conn:
        conn.execute("INSERT INTO photo_albums (id, name, position, created, updated) VALUES ('a1a1a1a1a1a1a1a1', 'F', 1, 1, 1)")
        conn.execute("INSERT INTO photos (id, album_id, sha256, name, width, height, bytes, created) "
                     "VALUES (?, 'a1a1a1a1a1a1a1a1', 's', 'x.jpg', 10, 10, 5, 1)", ("1" * 32,))
    assert {27, 29} <= set(dbm.migrate(conn))
    got = conn.execute("SELECT name, bytes, cutout_at, cutout_by, cutout_ok, cutout_conf, cutout_cover, depth_box, taken "
                       "FROM photos").fetchone()
    assert tuple(got) == ("x.jpg", 5, None, None, None, None, None, None, None)
    assert conn.execute("SELECT depth_only FROM photo_albums").fetchone()[0] == 0
    plan = " ".join(str(r[3]) for r in conn.execute(
        "EXPLAIN QUERY PLAN SELECT id FROM photos WHERE cutout_at IS NULL ORDER BY created DESC LIMIT 1"))
    assert "photos_uncut" in plan
    conn.close()


def test_a_damaged_box_reads_as_none():
    assert photos.stored_box("[0.1, 0.2, 0.5, 0.3]") == [0.1, 0.2, 0.5, 0.3]
    for bad in (None, "", "x", "[1, 2]", "[0.8, 0.1, 0.5, 0.3]", "[0, 0, 0, 0.2]", '["a", 0, 0.1, 0.1]', "[true, 0, 0.1, 0.1]"):
        assert photos.stored_box(bad) is None, bad


def test_the_worker_side_says_why_it_cannot_cut(monkeypatch):
    monkeypatch.setattr(cutout, "available", lambda: False)
    ok, why = image_work.cutter_ready()
    assert ok is False and why
    assert image_work.cut_look(None)["why"] == "unreadable"
