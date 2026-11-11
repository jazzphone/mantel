"""Keep in View (faces.py, photos.py, migration 0024): where a photo's faces are, found on upload and by the
backfill, stored as boxes only; a focus set by hand and put back to automatic; what the screensavers read; who may
change it; the YuNet decoder on synthetic tensors and the vendored model. Every picture here is GENERATED (flat
colours and noise): there is no real face, or real photo, in git."""
import asyncio
import io
import json
import logging
import math
import shutil

import pytest
from aiohttp import FormData
from PIL import Image

from mantel_server.storage import db as dbm
from mantel_server.cameras import faces, photos
from mantel_server.pages import setup_check

ONE = [[0.4, 0.3, 0.2, 0.25, 0.97]]


@pytest.fixture(autouse=True)
def _in_this_process(image_threads):
    """These tests replace faces.Detector and faces.available here: the picture work must run here to see them (the
    worker process is test_imaging.py's)."""


def picture(color=(200, 30, 30), size=(80, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
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
    return dict(mantel.store.db.execute("SELECT faces, faces_at, faces_by, focus_x, focus_y FROM photos WHERE id=?",
                                        (pid,)).fetchone())


def audits(mantel):
    return [(r["action"], json.loads(r["target"])) for r in
            mantel.store.db.execute("SELECT action, target FROM action_audit WHERE kind='config' ORDER BY id")
            if r["action"] == "photos.focus"]


class FakeDetector:
    """faces.Detector's shape: what it was shown, and what it answers."""
    seen: list = []
    answers: list = []
    stop_after: int | None = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def detect(self, img):
        FakeDetector.seen.append(img.getpixel((0, 0)))
        if FakeDetector.stop_after is not None and len(FakeDetector.seen) > FakeDetector.stop_after:
            raise asyncio.CancelledError                    # the server stopping mid-way
        return FakeDetector.answers.pop(0) if FakeDetector.answers else []


@pytest.fixture
def fake_detector(monkeypatch):
    FakeDetector.seen, FakeDetector.answers, FakeDetector.stop_after = [], [], None
    monkeypatch.setattr(faces, "available", lambda: True)
    monkeypatch.setattr(faces, "Detector", FakeDetector)
    return FakeDetector


@pytest.fixture
def no_detector(monkeypatch):
    monkeypatch.setattr(faces, "available", lambda: False)


# -- what is kept -------------------------------------------------------------------------------------------------
def test_small_faces_are_dropped_and_at_most_twelve_kept_largest_first():
    big, small, mid = [0.1, 0.1, 0.2, 0.2, 0.9], [0.8, 0.8, 0.05, 0.05, 0.9], [0.5, 0.5, 0.15, 0.15, 0.8]
    assert faces.keep([small, mid, big]) == [big, mid]                  # 0.0025 < a quarter of 0.04
    many = [[i / 20, 0.1, 0.04 + i / 1000, 0.04, 0.9] for i in range(20)]
    kept = faces.keep(many)
    assert len(kept) == 12 and kept[0] is many[-1]
    assert faces.keep([]) == [] and faces.keep([[0.1, 0.1, 0, 0.1, 0.9]]) == []


# -- the YuNet decoder and NMS on synthetic outputs --------------------------------------------------------------
def _outs(np, hits):
    """YuNet's twelve outputs, all quiet but ``hits``: (stride, row, col, score, (dx, dy, log w, log h))."""
    outs = {}
    for s in faces.STRIDES:
        n = (faces.SIZE // s) ** 2
        outs[f"cls_{s}"] = np.zeros((1, n, 1), np.float32)
        outs[f"obj_{s}"] = np.zeros((1, n, 1), np.float32)
        outs[f"bbox_{s}"] = np.zeros((1, n, 4), np.float32)
        outs[f"kps_{s}"] = np.zeros((1, n, 10), np.float32)
    for s, r, c, score, bb in hits:
        i = r * (faces.SIZE // s) + c
        outs[f"cls_{s}"][0, i, 0] = score
        outs[f"obj_{s}"][0, i, 0] = 1.0
        outs[f"bbox_{s}"][0, i] = bb
    return outs


def test_the_decoder_places_boxes_as_opencv_does_and_nms_drops_duplicates():
    np = pytest.importorskip("numpy")
    hits = [(8, 10, 20, 0.9, (0.5, 0.5, math.log(4), math.log(5))),        # cx (20.5)*8 = 164, w 32, h 40
            (8, 10, 21, 0.81, (0.0, 0.5, math.log(4), math.log(5))),       # the same face again, a little to the right
            (32, 3, 4, 0.64, (0.0, 0.0, math.log(2), math.log(2))),        # another face: cx 128, cy 96, 64 x 64
            (16, 1, 1, 0.25, (0.0, 0.0, 0.0, 0.0))]                        # sqrt(0.25 * 1) = 0.5: under 0.7
    boxes, scores = faces.decode(_outs(np, hits), np)
    assert len(boxes) == 3                                                 # the weak one never decoded
    kept = faces.nms(boxes, scores, np)
    got = [[round(float(v), 3) for v in boxes[i]] + [round(float(scores[i]), 3)] for i in kept]
    assert got == [[148.0, 64.0, 32.0, 40.0, 0.949], [96.0, 64.0, 64.0, 64.0, 0.8]]
    empty_boxes, _ = faces.decode(_outs(np, []), np)
    assert empty_boxes.shape == (0, 4) and faces.nms(empty_boxes, np.zeros((0,)), np) == []


def test_the_vendored_model_is_the_one_expected(tmp_path, monkeypatch):
    assert faces.model_ok()
    bad = tmp_path / "model.onnx"
    bad.write_bytes(faces.MODEL.read_bytes() + b"x")
    assert not faces.model_ok(bad) and not faces.model_ok(tmp_path / "missing.onnx")
    if faces.available():
        with pytest.raises(RuntimeError):
            faces.Detector(bad).__enter__()
        monkeypatch.setattr(faces, "MODEL", bad)
        monkeypatch.setattr(faces.Detector.__init__, "__defaults__", (bad,))
        assert faces.find(Image.new("RGB", (64, 64))) is None              # refused, and said so; never raised


def test_the_model_loads_and_finds_no_face_in_a_blank_picture():
    pytest.importorskip("onnxruntime")
    assert faces.available()
    with faces.Detector() as d:
        assert d.detect(Image.new("RGB", (1200, 800), (128, 128, 128))) == []
        assert d.detect(Image.effect_noise((300, 500), 60).convert("RGB")) == []
    assert faces.find(Image.new("RGB", (10, 10))) == []


# -- on upload ------------------------------------------------------------------------------------------------------
async def test_an_upload_stores_where_its_faces_are(mantel, fake_detector):
    fake_detector.answers = [ONE]
    await sign_in(mantel)
    aid = await album(mantel)
    r, body = await upload(mantel, aid, picture())
    assert r.status == 201
    got = row(mantel, body["photo"]["id"])
    assert json.loads(got["faces"]) == ONE and got["faces_by"] == "yunet-2023mar" and got["faces_at"] == mantel.now[0]
    assert got["focus_x"] is None
    # it was shown the screen-sized copy (the colour of the upload)
    assert len(fake_detector.seen) == 1


async def test_without_a_detector_an_upload_works_and_is_left_for_later(mantel, no_detector):
    await sign_in(mantel)
    aid = await album(mantel)
    r, body = await upload(mantel, aid, picture())
    assert r.status == 201
    assert row(mantel, body["photo"]["id"]) == {"faces": None, "faces_at": None, "faces_by": None,
                                                "focus_x": None, "focus_y": None}


async def test_a_detector_that_fails_never_fails_the_upload(mantel, fake_detector, monkeypatch):
    def boom(self, img):
        raise ValueError("bad tensor")
    monkeypatch.setattr(FakeDetector, "detect", boom)
    await sign_in(mantel)
    aid = await album(mantel)
    r, body = await upload(mantel, aid, picture())
    assert r.status == 201 and row(mantel, body["photo"]["id"])["faces"] is None


# -- the backfill ------------------------------------------------------------------------------------------------------
async def _unchecked(mantel, n, monkeypatch):
    """n photos stored with no detector (newest last), their colours telling them apart."""
    await sign_in(mantel)
    aid = await album(mantel)
    with monkeypatch.context() as m:
        m.setattr(faces, "available", lambda: False)
        ids = []
        for i in range(n):
            mantel.now[0] += 10
            ids.append((await upload(mantel, aid, picture(color=(10 * i, 0, 0))))[1]["photo"]["id"])
    return aid, ids


async def test_the_backfill_checks_old_photos_one_at_a_time_newest_first(mantel, fake_detector, monkeypatch, caplog):
    aid, ids = await _unchecked(mantel, 3, monkeypatch)
    lib = mantel.app["photos"]
    lib.set_faces(ids[0], [[0.1, 0.1, 0.2, 0.2, 0.9]])                   # already checked: left alone
    fake_detector.answers = [ONE, []]
    caplog.set_level(logging.INFO, logger="mantel.photos")
    await photos.FaceBackfill(mantel.app, start=0, rest=0).run()
    reds = [c[0] for c in fake_detector.seen]
    assert len(reds) == 2 and reds[0] > reds[1]                          # newest first
    assert json.loads(row(mantel, ids[2])["faces"]) == ONE and json.loads(row(mantel, ids[1])["faces"]) == []
    assert json.loads(row(mantel, ids[0])["faces"]) == [[0.1, 0.1, 0.2, 0.2, 0.9]]
    assert lib.unchecked() is None
    assert any("checked 2 photos for faces" in r.getMessage() and "(1 with faces)" in r.getMessage()
               for r in caplog.records)


async def test_the_backfill_carries_on_after_a_restart(mantel, fake_detector, monkeypatch):
    aid, ids = await _unchecked(mantel, 3, monkeypatch)
    fake_detector.stop_after = 1
    with pytest.raises(asyncio.CancelledError):
        await photos.FaceBackfill(mantel.app, start=0, rest=0).run()
    assert row(mantel, ids[2])["faces_at"] is not None and row(mantel, ids[1])["faces_at"] is None
    fake_detector.stop_after = None
    fake_detector.seen.clear()
    await photos.FaceBackfill(mantel.app, start=0, rest=0).run()
    assert len(fake_detector.seen) == 2 and mantel.app["photos"].unchecked() is None


async def test_an_unreadable_file_is_marked_and_never_tried_again(mantel, fake_detector, monkeypatch):
    aid, ids = await _unchecked(mantel, 2, monkeypatch)
    lib = mantel.app["photos"]
    lib.path(ids[1], "screen").write_bytes(b"not a picture")
    lib.path(ids[0], "screen").unlink()
    await photos.FaceBackfill(mantel.app, start=0, rest=0).run()
    assert fake_detector.seen == []
    assert row(mantel, ids[0])["faces"] == "[]" and row(mantel, ids[1])["faces"] == "[]"


class BrokenDetector(FakeDetector):
    """The detector's own failure at run time (onnxruntime out of memory, a bad session), on the pictures in ``bad``
    (colour red channel) or on all of them."""
    bad: set | None = None

    def detect(self, img):
        FakeDetector.seen.append(img.getpixel((0, 0)))
        if BrokenDetector.bad is None or img.getpixel((0, 0))[0] in BrokenDetector.bad:
            raise RuntimeError("onnxruntime: out of memory")
        return []


@pytest.fixture
def broken_detector(monkeypatch):
    FakeDetector.seen, FakeDetector.answers, FakeDetector.stop_after = [], [], None
    BrokenDetector.bad = None
    monkeypatch.setattr(faces, "available", lambda: True)
    monkeypatch.setattr(faces, "Detector", BrokenDetector)
    return BrokenDetector


async def test_a_failing_detector_does_not_mark_photos_checked_for_ever(mantel, broken_detector, monkeypatch, caplog):
    """MED-4 (audit, second pass): ``_look`` treated any exception, the detector's own included, as "an unreadable
    file": the photo was stored as checked with no faces and never looked at again, so one systemic failure marked the
    whole library "no faces". Only a file that cannot be opened counts as no faces now; a photo the detector fails on
    stays unchecked, and a few failures in a row stop the run with one line in the log."""
    import logging
    aid, ids = await _unchecked(mantel, 5, monkeypatch)
    caplog.set_level(logging.INFO, logger="mantel.photos")
    await photos.FaceBackfill(mantel.app, start=0, rest=0).run()
    assert [row(mantel, i)["faces_at"] for i in ids] == [None] * 5     # none marked checked
    assert len(FakeDetector.seen) == photos.FaceBackfill.FAILURES_MAX  # and it gave up after a few, not all five
    assert len([r for r in caplog.records if "backfill stops" in r.getMessage()]) == 1
    assert mantel.app["photos"].unchecked() is not None


async def test_a_photo_the_detector_fails_on_is_skipped_this_run_and_tried_again_the_next(mantel, broken_detector,
                                                                                         monkeypatch):
    """MED-4 (audit, second pass): one picture the detector fails on must neither be marked "no faces" nor hold up the
    ones behind it: it stays unchecked, the run goes on to the others, and the next run (a restart) tries it again."""
    aid, ids = await _unchecked(mantel, 4, monkeypatch)
    broken_detector.bad = {20}                                       # ids[2]: colour (20, 0, 0)
    await photos.FaceBackfill(mantel.app, start=0, rest=0).run()
    assert [row(mantel, i)["faces_at"] is not None for i in ids] == [True, True, False, True]
    assert mantel.app["photos"].unchecked() == ids[2]
    broken_detector.bad = set()                                      # the detector is well again
    await photos.FaceBackfill(mantel.app, start=0, rest=0).run()
    assert mantel.app["photos"].unchecked() is None and json.loads(row(mantel, ids[2])["faces"]) == []


async def test_the_backfill_does_nothing_without_a_detector(mantel, no_detector, monkeypatch):
    await _unchecked(mantel, 1, monkeypatch)
    assert photos.FaceBackfill(mantel.app, start=0, rest=0).start() is None


async def test_the_backfill_waits_while_an_import_runs(mantel, fake_detector, monkeypatch):
    aid, ids = await _unchecked(mantel, 1, monkeypatch)

    class Running:
        running = True
    monkeypatch.setattr(photos.Importer, "running", property(lambda self: Running.running))
    bf = photos.FaceBackfill(mantel.app, start=0, rest=0)
    bf.IMPORT_WAIT = 0.01
    task = asyncio.get_running_loop().create_task(bf.run())
    await asyncio.sleep(0.1)
    assert fake_detector.seen == [] and not task.done()
    Running.running = False
    await asyncio.wait_for(task, 2)
    assert len(fake_detector.seen) == 1 and row(mantel, ids[0])["faces_at"] is not None


async def test_the_server_starts_the_backfill_and_stops_it(mantel):
    bf = mantel.app["photos_faces"]
    assert isinstance(bf, photos.FaceBackfill) and bf.start_after == 60
    if faces.available():
        assert bf.task is not None and not bf.task.done()               # cancelled with the app's cleanup


# -- the migration ------------------------------------------------------------------------------------------------------
def test_the_migration_keeps_photos_already_there(tmp_path):
    old = tmp_path / "upto23"
    old.mkdir()
    for m in dbm.discover():
        if m.version <= 23:
            shutil.copy(m.path, old / m.path.name)
    conn = dbm.connect(tmp_path / "m.db")
    dbm.migrate(conn, old)
    with conn:
        conn.execute("INSERT INTO photo_albums (id, name, position, created, updated) VALUES ('a1a1a1a1a1a1a1a1', 'F', 1, 1, 1)")
        conn.execute("INSERT INTO photos (id, album_id, sha256, name, width, height, bytes, created) "
                     "VALUES (?, 'a1a1a1a1a1a1a1a1', 's', 'x.jpg', 10, 10, 5, 1)", ("1" * 32,))
    assert 24 in dbm.migrate(conn)
    got = conn.execute("SELECT name, faces, faces_at, faces_by, focus_x, focus_y FROM photos").fetchone()
    assert tuple(got) == ("x.jpg", None, None, None, None, None)
    plan = " ".join(str(r[3]) for r in conn.execute(
        "EXPLAIN QUERY PLAN SELECT id FROM photos WHERE faces_at IS NULL ORDER BY created DESC LIMIT 1"))
    assert "photos_unchecked" in plan
    conn.close()


# -- what the screensavers and the page read --------------------------------------------------------------------------
async def test_the_screensavers_read_a_focus_only_where_there_is_one(mantel, fake_detector):
    fake_detector.answers = [ONE, [], ONE]
    await sign_in(mantel)
    aid = await album(mantel)
    a = (await upload(mantel, aid, picture(color=(1, 0, 0))))[1]["photo"]["id"]
    b = (await upload(mantel, aid, picture(color=(2, 0, 0))))[1]["photo"]["id"]
    c = (await upload(mantel, aid, picture(color=(3, 0, 0))))[1]["photo"]["id"]
    mantel.app["photos"].set_focus(c, {"x": 0.2, "y": 0.8})
    with mantel.store.db:
        mantel.store.db.execute("UPDATE photos SET faces=NULL, faces_at=NULL WHERE id=?", (b,))
    show = {p["id"]: p for p in (await (await mantel.client.get(f"/api/photos/albums/{aid}/show")).json())["photos"]}
    assert show[a]["faces"] == [[0.4, 0.3, 0.2, 0.25]] and "focus" not in show[a]
    assert set(show[b]) == {"id", "title", "w", "h", "url"}              # as it always was
    assert show[c]["focus"] == [0.2, 0.8] and show[c]["faces"] == [[0.4, 0.3, 0.2, 0.25]]
    listed = {p["id"]: p for p in (await send(mantel, "GET", f"/api/photos/albums/{aid}/photos"))[1]["photos"]}
    assert listed[a]["focus"] == {"x": 0.5, "y": 0.425, "by": "faces"} and listed[a]["faces"] == ONE
    assert listed[b]["focus"] == {"x": None, "y": None, "by": "pending"} and listed[b]["faces"] is None
    assert listed[c]["focus"] == {"x": 0.2, "y": 0.8, "by": "hand"}
    mantel.app["photos"].set_faces(b, [])
    listed = {p["id"]: p for p in (await send(mantel, "GET", f"/api/photos/albums/{aid}/photos"))[1]["photos"]}
    assert listed[b]["focus"]["by"] == "none" and listed[b]["faces"] == []


# -- setting it by hand -------------------------------------------------------------------------------------------------
async def test_an_owner_or_admin_sets_the_focus_by_hand_and_puts_it_back(mantel, fake_detector):
    fake_detector.answers = [ONE]
    await sign_in(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    path = f"/api/photos/{pid}/focus"
    r, body = await send(mantel, "PUT", path, {"x": 0.25, "y": 0.75})
    assert r.status == 200 and body["focus"] == {"x": 0.25, "y": 0.75, "by": "hand"} and body["faces"] == ONE
    assert (row(mantel, pid)["focus_x"], row(mantel, pid)["focus_y"]) == (0.25, 0.75)
    r, body = await send(mantel, "PUT", path, {"auto": True})
    assert r.status == 200 and body["focus"]["by"] == "faces"
    assert row(mantel, pid)["focus_x"] is None and json.loads(row(mantel, pid)["faces"]) == ONE   # the faces stayed
    assert audits(mantel) == [("photos.focus", {"id": pid, "album": aid, "x": 0.25, "y": 0.75}),
                              ("photos.focus", {"id": pid, "album": aid, "auto": True})]
    # an Admin too
    mantel.forget_cookies()
    await sign_in(mantel, "riley", "admin")
    r, _ = await send(mantel, "PUT", path, {"x": 0, "y": 1})
    assert r.status == 200
    # what isn't a point is refused
    for bad in ({"x": 1.5, "y": 0.5}, {"x": -0.1, "y": 0.5}, {"x": True, "y": 0.5}, {"x": "0.5", "y": 0.5},
                {"x": 0.5}, {"x": 0.5, "y": 0.5, "auto": True}, {"auto": False}, {"auto": "yes"}, {}):
        r, body = await send(mantel, "PUT", path, bad)
        assert r.status == 400 and body["error"] == "bad_focus", bad
    r = await mantel.client.put(path, data="1e999", headers=mantel.headers())
    assert r.status == 400
    r, body = await send(mantel, "PUT", f"/api/photos/{'f' * 32}/focus", {"x": 0.5, "y": 0.5})
    assert r.status == 404 and body["error"] == "photo_not_found"
    # CSRF on the change
    r = await mantel.client.put(path, json={"x": 0.5, "y": 0.5}, headers=mantel.headers(csrf=False))
    assert r.status == 403


async def test_an_adult_or_a_wall_tablet_may_not_set_a_focus(mantel, fake_detector):
    await sign_in(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    path = f"/api/photos/{pid}/focus"
    mantel.forget_cookies()
    await sign_in(mantel, "jordan", "adult")
    assert (await send(mantel, "PUT", path, {"x": 0.5, "y": 0.5}))[0].status == 403
    mantel.forget_cookies()
    await sign_in(mantel, "sam", "owner")
    r = await mantel.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    assert (await send(mantel, "PUT", path, {"x": 0.5, "y": 0.5}))[0].status == 403
    assert row(mantel, pid)["focus_x"] is None and audits(mantel) == []


# -- Setup Check ------------------------------------------------------------------------------------------------------------
async def test_setup_check_says_so_only_when_there_are_photos_and_no_detector(mantel, monkeypatch):
    titles = lambda: [ln["title"] for ln in setup_check.lines(mantel.app, 1)]   # noqa: E731
    monkeypatch.setattr(faces, "available", lambda: False)
    assert "Photos" not in titles()                                     # no photos: nothing to say
    await _unchecked(mantel, 1, monkeypatch)
    line = next(ln for ln in setup_check.lines(mantel.app, 1) if ln["title"] == "Photos")
    assert line["ok"] is None and "faces aren’t found" in line["detail"].lower()
    monkeypatch.setattr(faces, "available", lambda: True)
    assert "Photos" not in titles()


def test_stored_faces_tolerates_a_damaged_value():
    assert photos.stored_faces(None) is None
    assert photos.stored_faces("not json") == [] and photos.stored_faces('{"a": 1}') == []
    assert photos.stored_faces('[[0.1, 0.1, 0.2, 0.2, 0.9], "x", [1]]') == [[0.1, 0.1, 0.2, 0.2, 0.9]]


# -- how far the backfill has got (GET /api/photos/faces) ---------------------------------------------------------
async def faces_status(mantel):
    r, body = await send(mantel, "GET", "/api/photos/faces")
    assert r.status == 200, body
    return body["faces"]


async def test_the_backfills_progress_is_counted_from_the_rows_in_each_state(mantel, fake_detector, monkeypatch):
    aid, ids = await _unchecked(mantel, 3, monkeypatch)
    bf = mantel.app["photos_faces"]
    bf.cancel()
    got = await faces_status(mantel)
    assert {k: got[k] for k in ("photos", "checked", "with_faces", "left")} == \
        {"photos": 3, "checked": 0, "with_faces": 0, "left": 3}
    assert got["state"] == "stopped" and got["finished"] is None            # photos left, nothing looking

    blocker = asyncio.Event()
    bf.task = asyncio.get_running_loop().create_task(blocker.wait())        # a run under way
    bf.started = mantel.now[0]
    got = await faces_status(mantel)
    assert got["state"] == "running" and got["started"] == mantel.now[0]

    class Running:
        running = True
    monkeypatch.setattr(photos.Importer, "running", property(lambda self: Running.running))
    assert (await faces_status(mantel))["state"] == "waiting"
    Running.running = False
    blocker.set()
    await bf.task

    mantel.app["photos"].set_faces(ids[2], ONE)                             # counted the same after a restart
    got = await faces_status(mantel)
    assert (got["checked"], got["with_faces"], got["left"]) == (1, 1, 2)

    fake_detector.answers = [[]]
    mantel.now[0] += 100
    bf.start_after, bf.rest = 0, 0
    bf.task = asyncio.get_running_loop().create_task(bf.run())
    await bf.task
    got = await faces_status(mantel)
    assert got["state"] == "done" and (got["photos"], got["checked"], got["with_faces"], got["left"]) == (3, 3, 1, 0)
    assert got["started"] == mantel.now[0] and got["finished"] == mantel.now[0]

    bf.started = bf.finished = None                                         # a restart: done, from the rows
    got = await faces_status(mantel)
    assert got["state"] == "done" and got["started"] is None and got["finished"] == mantel.now[0]

    monkeypatch.setattr(faces, "available", lambda: False)
    assert (await faces_status(mantel))["state"] == "unavailable"


async def test_the_overview_carries_the_backfills_progress(mantel, fake_detector, monkeypatch):
    await _unchecked(mantel, 2, monkeypatch)
    r, body = await send(mantel, "GET", "/api/photos")
    assert r.status == 200 and body["faces"]["photos"] == 2 and body["faces"]["left"] == 2


async def test_an_owner_and_an_admin_see_the_progress_and_an_adult_or_a_wall_tablet_do_not(mantel, fake_detector):
    await sign_in(mantel)
    assert (await faces_status(mantel))["photos"] == 0
    mantel.forget_cookies()
    await sign_in(mantel, "riley", "admin")
    assert (await faces_status(mantel))["state"] in ("done", "unavailable")
    mantel.forget_cookies()
    await sign_in(mantel, "jordan", "adult")
    assert (await send(mantel, "GET", "/api/photos/faces"))[0].status == 403
    mantel.forget_cookies()
    await sign_in(mantel, "sam", "owner")
    r = await mantel.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    assert (await send(mantel, "GET", "/api/photos/faces"))[0].status == 403
    mantel.forget_cookies()
    assert (await mantel.client.get("/api/photos/faces")).status == 401          # nobody signed in
