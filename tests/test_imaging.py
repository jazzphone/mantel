"""Image work in its own process (imaging.py, image_work.py; docs/phase4/PHOTOS.md "Where the work runs"): decoding,
re-encoding and face finding run in one spawned worker process, one job at a time, started on first use and stopped
after idle minutes; the server process never loads ONNX Runtime; the JPEG originals are progressive again (the
encode no longer shares the server's GIL); and when no worker can run (a locked-down container) the work falls back
to a thread, said once. Every picture here is GENERATED."""
import asyncio
import io
import json
import logging
import os
import subprocess
import sys
import time
from contextlib import suppress
from pathlib import Path

import pytest
from PIL import Image

import imaging_helpers as helpers
from mantel_server.cameras import faces, image_work, imaging, photos

SERVER = str(Path(photos.__file__).parents[1])


@pytest.fixture(autouse=True)
def fresh_worker():
    imaging.reset()
    yield
    imaging.reset()


def jpeg(size=(640, 480), color=(40, 120, 200)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


def fallbacks(caplog) -> list:
    return [r for r in caplog.records if r.name == "mantel.imaging" and "in a thread from now on" in r.getMessage()]


async def test_image_work_runs_in_a_worker_process_of_its_own():
    got = await imaging.run(helpers.about)
    assert got["pid"] != os.getpid()
    assert imaging.state() == {"mode": "process", "pid": got["pid"]}
    # the worker imports the job's module and the picture code, not the server
    assert not {"aiohttp", "mantel_server.server", "mantel_server.cameras.photos", "mantel_server.storage.user_files"} & set(got["modules"])
    assert (await imaging.run(helpers.about))["pid"] == got["pid"]                # one worker, kept between jobs


def test_the_server_process_never_loads_onnxruntime(tmp_path):
    """An upload's faces and the backfill's look are found in the worker: the server process (here a fresh
    interpreter running the library as the server does) never imports ONNX Runtime, and still learns that faces can
    be found."""
    pytest.importorskip("onnxruntime")
    script = (
        "import asyncio, io, json, sys\n"
        f"sys.path.insert(0, {SERVER!r})\n"
        "from PIL import Image\n"
        "from mantel_server import db as dbm, imaging, photos\n"
        "async def main():\n"
        f"    conn = dbm.connect({str(tmp_path / 'm.db')!r}); dbm.migrate(conn)\n"
        f"    lib = photos.PhotoLibrary({str(tmp_path / 'photos')!r}, conn)\n"
        "    aid = lib.create_album('A')['id']\n"
        "    buf = io.BytesIO(); Image.new('RGB', (300, 200), (90, 120, 30)).save(buf, 'JPEG')\n"
        "    row, _ = await lib.add(aid, buf.getvalue(), 'a.jpg')\n"
        "    why = await imaging.faces_ready()\n"
        "    found = await imaging.look(lib.path(row['id'], 'screen'))\n"
        "    print(json.dumps({'onnx': 'onnxruntime' in sys.modules, 'available': imaging.faces_available(),\n"
        "                      'why': why, 'found': found, 'mode': imaging.state()['mode'],\n"
        "                      'faces_by': conn.execute('SELECT faces_by FROM photos').fetchone()[0]}))\n"
        "asyncio.run(main())\n")
    out = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout.strip().splitlines()[-1])
    assert got == {"onnx": False, "available": True, "why": None, "found": [], "mode": "process",
                   "faces_by": faces.NAME}


async def test_originals_and_screen_copies_are_progressive_again(mantel):
    """MED-1 (audit, second pass) turned the progressive, optimized encode off because it held the server's GIL. The
    encode runs in the worker now, so it is back for Mantel Photos' originals and screen copies and Your Files'
    photos."""
    lib = mantel.app["photos"]
    aid = lib.create_album("Progressive")["id"]
    row, _ = await lib.add(aid, jpeg((1200, 900)), "p.jpg")
    for size in ("original", "screen"):
        with Image.open(lib.path(row["id"], size)) as im:
            assert im.info.get("progressive") == 1, size
    out, kind = await imaging.run(image_work.reencode_photo, jpeg((800, 600)))
    assert kind == "jpeg" and Image.open(io.BytesIO(out)).info.get("progressive") == 1


async def test_your_files_photo_uploads_are_encoded_in_the_worker(mantel):
    await mantel.user("avery", "owner")
    assert (await mantel.sign_in("avery"))[0].status == 200
    from aiohttp import FormData
    fd = FormData()
    fd.add_field("file", jpeg((900, 600)), filename="p.jpg", content_type="image/jpeg")
    r = await mantel.client.post("/api/user-files/photo", data=fd, headers=mantel.headers())
    body = await r.json()
    assert r.status == 201, body
    path = mantel.app["user_files"].photo_path(body["id"])
    with Image.open(path) as im:
        assert im.info.get("progressive") == 1
    assert imaging.state()["pid"] not in (None, os.getpid())


async def test_jobs_run_one_at_a_time_in_the_worker():
    got = await asyncio.gather(*[imaging.run(helpers.hold, 0.1) for _ in range(4)])
    assert len({pid for pid, _, _ in got}) == 1 and got[0][0] != os.getpid()
    spans = sorted((a, b) for _, a, b in got)
    assert all(nxt[0] >= cur[1] for cur, nxt in zip(spans, spans[1:])), spans


async def test_the_face_backfill_takes_its_turn_with_the_uploads(mantel, image_threads, monkeypatch):
    """The backfill's look decoded a screen-sized photo and ran the detector in a thread of its own, beside an
    upload's decode (``_look`` bypassed the image slot). It goes through ``imaging.run`` now, so the two queue."""
    import threading
    lock, now, peak = threading.Lock(), [0], [0]

    def busy():
        with lock:
            now[0] += 1
            peak[0] = max(peak[0], now[0])
        time.sleep(0.03)
        with lock:
            now[0] -= 1

    def slow_process(data):
        busy()
        return photos.Processed(b"o", b"s", b"t", 10, 10, None)

    def slow_look(path):
        busy()
        return []

    class Ready:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            pass

    monkeypatch.setattr(photos, "process", slow_process)
    monkeypatch.setattr(image_work, "look", slow_look)
    monkeypatch.setattr(faces, "available", lambda: True)
    monkeypatch.setattr(faces, "Detector", Ready)
    lib = mantel.app["photos"]
    aid = lib.create_album("Queue")["id"]
    for i in range(4):                                       # unchecked photos for the backfill
        await lib.add(aid, b"old-%d" % i, "old.jpg")
    peak[0] = 0
    backfill = photos.FaceBackfill(mantel.app, start=0, rest=0)
    await asyncio.gather(backfill.run(), *[lib.add(aid, b"new-%d" % i, "new.jpg") for i in range(4)])
    assert backfill.checked >= 4 and peak[0] == 1


async def test_cancelling_an_add_while_the_worker_decodes_leaves_nothing_behind(mantel):
    """A cancelled upload can't stop the worker's decode: the slot stays taken until the worker has finished (so the
    next decode doesn't start beside it), and nothing is written for the cancelled one."""
    from test_photos import noisy_jpeg
    lib = mantel.app["photos"]
    aid = lib.create_album("Cancel")["id"]
    await imaging.run(helpers.about)                         # a worker already running: the decode starts at once
    task = asyncio.get_running_loop().create_task(lib.add(aid, noisy_jpeg(16), "x.jpg"))
    for _ in range(500):
        if imaging.image_slot().locked():
            break
        await asyncio.sleep(0.005)
    await asyncio.sleep(0.05)
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    assert task.cancelled() and imaging.image_slot().locked()          # the worker is still decoding
    await asyncio.wait_for(imaging.image_slot().acquire(), 30)        # ... and the slot is free once it has finished
    imaging.image_slot().release()
    left = [p.name for p in lib.root.rglob("*") if p.is_file()] if lib.root.exists() else []
    assert lib.count() == 0 and left == []


async def test_when_no_worker_can_be_made_the_work_runs_in_a_thread_said_once(mantel, monkeypatch, caplog):
    """A locked-down container may refuse what a process pool needs (``sem_open`` without /dev/shm, no new
    processes). The work then runs in a thread as before (baseline JPEG, MED-1), logged once, never failed."""
    def refused():
        raise PermissionError(13, "sem_open: Permission denied")

    monkeypatch.setattr(imaging, "_new_pool", refused)
    caplog.set_level(logging.WARNING, logger="mantel.imaging")
    a = await imaging.run(helpers.about)
    b = await imaging.run(helpers.about)
    assert a["pid"] == b["pid"] == os.getpid() and imaging.state() == {"mode": "thread", "pid": None}
    lib = mantel.app["photos"]
    row, _ = await lib.add(lib.create_album("Thread")["id"], jpeg((900, 600)), "t.jpg")
    with Image.open(lib.path(row["id"], "original")) as im:
        assert "progressive" not in im.info                              # in the server's own process: baseline
    assert len(fallbacks(caplog)) == 1


async def test_a_worker_that_cannot_start_is_tried_once_more_then_a_thread(monkeypatch, caplog):
    monkeypatch.setattr(imaging, "_initializer", (helpers.crash_unless, (-1,)))   # every worker dies as it starts
    caplog.set_level(logging.WARNING, logger="mantel.imaging")
    got = await imaging.run(helpers.about)
    assert got["pid"] == os.getpid() and imaging.state()["mode"] == "thread"
    assert len(fallbacks(caplog)) == 1


async def test_a_worker_that_dies_fails_its_job_and_the_next_job_gets_a_new_worker(caplog):
    """A worker killed mid-job (out of memory, a decoder crash) fails that job -- it is never run again in the server
    itself, where the same picture could take the server down -- and the next job gets a new worker. After a second
    death the work falls back to a thread, said once."""
    caplog.set_level(logging.WARNING, logger="mantel.imaging")
    first = (await imaging.run(helpers.about))["pid"]
    with pytest.raises(imaging.WorkerLost):
        await imaging.run(helpers.crash_unless, os.getpid())
    second = (await imaging.run(helpers.about))["pid"]
    assert second not in (first, os.getpid())
    with pytest.raises(imaging.WorkerLost):
        await imaging.run(helpers.crash_unless, os.getpid())
    assert (await imaging.run(helpers.about))["pid"] == os.getpid()
    assert imaging.state()["mode"] == "thread" and len(fallbacks(caplog)) == 1


async def test_a_photo_whose_worker_died_is_refused_not_stored(mantel, monkeypatch, tmp_path):
    lib = mantel.app["photos"]
    aid = lib.create_album("Crash")["id"]
    await imaging.run(helpers.about)

    async def dying(fn, *args):
        return await imaging_run(helpers.crash_unless, os.getpid())

    imaging_run = imaging.run
    monkeypatch.setattr(imaging, "run", dying)
    with pytest.raises(photos.PhotoError) as exc:
        await lib.add(aid, jpeg(), "x.jpg")
    assert exc.value.code == "photo_invalid" and lib.count() == 0


async def test_the_worker_stops_when_idle_and_starts_again_when_needed(monkeypatch):
    monkeypatch.setattr(imaging, "IDLE", 0.3)
    pid, _, _ = await imaging.run(helpers.hold, 0.6)          # longer than IDLE: a busy worker is never stopped
    deadline = time.monotonic() + 10
    while imaging.state()["pid"] is not None and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    assert imaging.state() == {"mode": "process", "pid": None}
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        await asyncio.sleep(0.05)
    else:
        pytest.fail(f"the idle worker {pid} is still running")
    again = (await imaging.run(helpers.about))["pid"]
    assert again not in (pid, os.getpid())
