"""The House Timeline's pictures (timeline/pictures.py, image_work.shrink): a camera's row gets a short filmstrip
(a ring: two frames; a detection: the first after a moment, the next only while it is still going; 1 to 3 by setting),
nothing is taken while the disk is low, a camera that gives nothing leaves the row without a picture and is counted,
pictures are private files in a private folder, and `shrink` really makes a small JPEG. Fake cameras and a fake
clock; the offsets are made tiny so the tests are fast."""
from __future__ import annotations

import asyncio
import io
import stat
from types import SimpleNamespace

import pytest

from mantel_server.cameras import image_work, imaging
from mantel_server.ha.registry import Registry
from mantel_server.ha.state import StateStore
from mantel_server.storage.store import Store
from mantel_server.timeline import pictures as P
from mantel_server.timeline.core import Timeline
from mantel_server.timeline.pictures import Pictures
from mantel_server.timeline.store import Row

T0 = 1_800_000_000.0
RAW = b"\xff\xd8\xff\xe0fictional-camera-bytes\xff\xd9"
SMALL = b"\xff\xd8\xff\xe0fictional-small-bytes\xff\xd9"


class Cam:
    """A fictional camera: what it gives, how long it takes, and what it was asked."""

    def __init__(self):
        self.asked: list[str] = []
        self.data: bytes | None = RAW
        self.delay = 0.0
        self.fail: Exception | None = None
        self.running = 0
        self.peak = 0
        self.on_first = None

    async def fetch(self, camera):
        self.asked.append(camera)
        self.running += 1
        self.peak = max(self.peak, self.running)
        try:
            if len(self.asked) == 1 and self.on_first is not None:
                self.on_first()
            if self.delay:
                await asyncio.sleep(self.delay)
            if self.fail is not None:
                raise self.fail
            return self.data
        finally:
            self.running -= 1


class Env:
    def __init__(self, tmp_path, monkeypatch):
        self.now = [T0]
        self.store = Store(tmp_path / "m.db")
        self.db = self.store.db
        self.cam = Cam()
        self.shrunk: list[bytes] = []
        self.hub = SimpleNamespace(store=StateStore(), registry=Registry(), taps=[], ha=None)
        self.app: dict = {"cfg": None}
        self.tl = Timeline(self.app, self.hub, self.db, clock=lambda: self.now[0], folder=tmp_path / "timeline")
        self.tl.folder.mkdir(parents=True, exist_ok=True)

        async def shrink(raw):
            self.shrunk.append(raw)
            return SMALL
        self.pics = Pictures(self.app, self.tl, fetch=self.cam.fetch, shrink=shrink)
        self.app["timeline_pictures"] = self.pics
        self.tl.after_write.append(self.pics.after_write)
        self.heard: list[list[dict]] = []
        self.tl.listeners.append(self.heard.append)
        # tiny offsets: the same shape as the real (0, 4, 8) and (1.5, 6, 12) seconds
        monkeypatch.setattr(P, "RING_OFFSETS", (0.0, 0.03, 0.06))
        monkeypatch.setattr(P, "DETECTION_OFFSETS", (0.01, 0.04, 0.08))

    def camera_row(self, src, family="doorbell", kind="ring", camera="camera.front", active=False, **kw):
        self.pics.want(src, camera, family, active=active)
        self.tl.push(Row(src=src, at=T0, family=family, kind=kind, entity=camera, title="Someone rang Front", **kw))
        self.tl.flush()                                   # the write starts the filmstrip (after_write)

    async def done(self):
        if self.pics.tasks:
            await asyncio.gather(*list(self.pics.tasks))

    def pic_rows(self, src=None):
        sql = "SELECT p.* FROM timeline_pics p JOIN timeline_events e ON e.id = p.event"
        args = ()
        if src:
            sql += " WHERE e.src = ?"
            args = (src,)
        return [dict(r) for r in self.db.execute(sql + " ORDER BY p.rowid", args)]


@pytest.fixture
async def env(tmp_path, monkeypatch):
    e = Env(tmp_path, monkeypatch)
    yield e
    await e.pics.stop()
    e.db.close()


def test_the_real_offsets_are_the_plans():
    assert P.RING_OFFSETS == (0.0, 4.0, 8.0) and P.DETECTION_OFFSETS == (1.5, 6.0, 12.0)
    assert P.IN_FLIGHT == 2 and P.EDGE == 640 and P.QUALITY == 70


# -- the filmstrip -----------------------------------------------------------------------------------------------------
async def test_a_ring_gets_two_frames_by_default(env):
    env.camera_row("pt:e1:ring")
    await env.done()
    rows = env.pic_rows("pt:e1:ring")
    assert len(rows) == 2 and {r["camera"] for r in rows} == {"camera.front"} and env.cam.asked == ["camera.front"] * 2
    assert all(r["size"] == len(SMALL) for r in rows) and len({r["id"] for r in rows}) == 2
    assert env.pics.taken == 2 and env.pics.failed == 0 and env.pics.skipped == 0
    assert env.shrunk == [RAW, RAW]                                      # shrunk in the worker, never kept raw
    assert len(env.heard) == 3 and all(r[0]["src"] == "pt:e1:ring" for r in env.heard)   # the row, then each frame


@pytest.mark.parametrize("frames,want", [(1, 1), (2, 2), (3, 3), (9, 2), ("x", 2)])
async def test_the_frames_setting_picks_one_to_three(env, frames, want):
    env.tl.settings.set("pictures", {"budget_mb": 500, "frames": frames})
    env.camera_row("pt:e1:ring")
    await env.done()
    assert len(env.pic_rows()) == want


async def test_a_detection_still_going_gets_its_second_frame(env):
    env.camera_row("pt:e2:person", "detection", "person", "camera.driveway", active=True)
    await env.done()
    assert len(env.pic_rows("pt:e2:person")) == 2


async def test_a_detection_that_has_ended_gets_only_its_first_frame(env):
    def ends():
        with env.db:
            env.db.execute("UPDATE timeline_events SET ended = ? WHERE src = 'pt:e2:person'", (T0 + 2,))
    env.cam.on_first = ends                                              # it ends while the first picture is taken
    env.tl.settings.set("pictures", {"budget_mb": 500, "frames": 3})
    env.camera_row("pt:e2:person", "detection", "person", "camera.driveway", active=True)
    await env.done()
    assert len(env.pic_rows("pt:e2:person")) == 1 and env.cam.asked == ["camera.driveway"]


async def test_a_ring_is_filmed_to_the_end_whatever_its_row_says(env):
    env.cam.on_first = lambda: env.db.execute("UPDATE timeline_events SET ended = 1 WHERE src = 'pt:e3:ring'")
    env.camera_row("pt:e3:ring", active=False)
    await env.done()
    assert len(env.pic_rows()) == 2


async def test_only_a_camera_gets_a_filmstrip(env):
    env.pics.want("ha:lock.back_door:1", "lock.back_door", "lock")           # not a camera
    env.pics.want("ha:x:1", None, "doorbell")                                # nor nothing
    assert env.pics.wanted == {}
    env.tl.push(Row(src="ha:lock.back_door:1", at=T0, family="lock", kind="locked", title="Back Door locked"))
    env.tl.flush()
    await env.done()
    assert env.pic_rows() == [] and env.cam.asked == []
    # a row written without `want` has none either (a motion burst, a door)
    env.tl.push(Row(src="pt:m:motion", at=T0, family="motion", kind="motion", entity="camera.garden", title="Motion"))
    env.tl.flush()
    await env.done()
    assert env.cam.asked == []


async def test_what_was_never_written_is_forgotten(env):
    for i in range(260):
        env.pics.want(f"pt:{i}:ring", "camera.front", "doorbell")
    assert len(env.pics.wanted) <= 210


async def test_a_notification_snapshot_of_the_same_moment_is_copied_for_the_first_frame(env):
    taken_at = T0 - 3
    snaps = SimpleNamespace(clock=lambda: T0, ttl=60.0, read=lambda sid: b"notified-bytes",
                            items={"s1": SimpleNamespace(camera="camera.front", until=taken_at + 60.0),
                                   "s0": SimpleNamespace(camera="camera.other", until=T0 + 60.0)})
    env.app["features"] = SimpleNamespace(snaps=snaps)
    env.camera_row("pt:e1:ring")
    await env.done()
    assert env.shrunk == [b"notified-bytes", RAW] and env.cam.asked == ["camera.front"]      # the camera was asked once
    # an old one (30 s) is another moment; another camera's isn't this one's
    snaps.items["s1"] = SimpleNamespace(camera="camera.front", until=T0 - 30 + 60.0)
    env.cam.asked.clear()
    env.shrunk.clear()
    env.camera_row("pt:e2:ring")
    await env.done()
    assert env.shrunk == [RAW, RAW] and len(env.cam.asked) == 2


# -- nothing taken ------------------------------------------------------------------------------------------------------
async def test_nothing_is_taken_while_the_disk_is_low(env):
    env.app["alerts"] = SimpleNamespace(center=SimpleNamespace(is_up=lambda kind: kind == "disk.low"))
    env.camera_row("pt:e1:ring")
    await env.done()
    assert env.cam.asked == [] and env.pic_rows() == [] and env.pics.skipped == 1 and env.pics.taken == 0
    assert env.db.execute("SELECT COUNT(*) FROM timeline_events").fetchone()[0] == 1       # the row is there
    # the alert clears: pictures again
    env.app["alerts"] = SimpleNamespace(center=SimpleNamespace(is_up=lambda kind: False))
    env.camera_row("pt:e2:ring")
    await env.done()
    assert len(env.pic_rows("pt:e2:ring")) == 2
    # a center that can't answer is no reason to stop taking pictures
    env.app["alerts"] = SimpleNamespace(center=SimpleNamespace(is_up=lambda kind: 1 / 0))
    assert env.pics.disk_low() is False


async def test_a_camera_that_times_out_leaves_the_row_without_a_picture(env, monkeypatch):
    monkeypatch.setattr(P, "SNAP_TIMEOUT_S", 0.02)
    env.cam.delay = 5.0
    env.camera_row("pt:e1:ring")
    await env.done()
    assert env.pic_rows() == [] and env.pics.failed == 2 and env.pics.taken == 0
    assert env.db.execute("SELECT COUNT(*) FROM timeline_events").fetchone()[0] == 1
    assert env.shrunk == []


@pytest.mark.parametrize("what", ["error", "nothing", "too big", "unreadable"])
async def test_a_camera_that_fails_in_any_way_is_counted_and_the_row_stays(env, what):
    if what == "error":
        env.cam.fail = ConnectionError("fictional: 192.0.2.7 refused")
    elif what == "nothing":
        env.cam.data = None
    elif what == "too big":
        env.cam.data = b"x" * (P.MAX_INPUT + 1)
    else:
        async def bad(raw):
            raise ValueError("not a picture")
        env.pics._shrink = bad
    env.camera_row("pt:e1:ring")
    await env.done()
    assert env.pic_rows() == [] and env.pics.failed == 2 and env.pics.taken == 0


async def test_a_failed_first_frame_doesnt_stop_the_next(env):
    calls = []

    async def flaky(camera):
        calls.append(camera)
        return None if len(calls) == 1 else RAW
    env.pics._fetch = flaky
    env.camera_row("pt:e1:ring")
    await env.done()
    assert len(env.pic_rows()) == 1 and env.pics.failed == 1 and env.pics.taken == 1


async def test_at_most_two_pictures_are_in_flight(env):
    env.cam.delay = 0.03
    got = await asyncio.gather(*[env.pics.take("camera.front") for _ in range(6)])
    assert got == [SMALL] * 6 and env.cam.peak == 2


async def test_a_direct_camera_is_asked_through_its_own_source_and_home_assistant_needs_a_credential(env):
    asked = []

    class Direct:
        def serves(self, camera):
            return "protect" if camera.startswith("camera.mantel_") else None

        async def still(self, camera):
            asked.append(camera)
            return b"direct-bytes", "image/jpeg"
    pics = Pictures(env.app, env.tl, shrink=env.pics._shrink)
    env.app["cameras_direct"] = Direct()
    assert await pics.fetch("camera.mantel_front") == b"direct-bytes" and asked == ["camera.mantel_front"]
    # not a direct camera, and no Home Assistant credential: no picture, no error
    env.app["cfg"] = SimpleNamespace(ha_url="http://ha.example:8123")
    env.app["connections"] = SimpleNamespace(ha_token=lambda: None)
    assert await pics.fetch("camera.front") is None and asked == ["camera.mantel_front"]


# -- keeping -----------------------------------------------------------------------------------------------------------
async def test_pictures_are_private_files_in_private_folders(env):
    env.camera_row("pt:e1:ring")
    await env.done()
    rows = env.pic_rows()
    assert rows
    for r in rows:
        path = env.tl.pic_path(r["id"], r["at"])
        assert path.read_bytes() == SMALL and stat.S_IMODE(path.stat().st_mode) == 0o600
        assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700                       # <data>/timeline/<yyyy-mm>
        assert stat.S_IMODE(path.parent.parent.stat().st_mode) == 0o700                # <data>/timeline
        assert path.parent.name == "2027-01" and len(r["id"]) == 32 and path.name == r["id"] + ".jpg"
        assert env.pics.read(r["id"]) == SMALL and env.pics.path_of(r["id"]) == path


async def test_a_frame_is_never_overwritten_and_a_failed_record_leaves_no_file(env, monkeypatch):
    ev = env.tl.rows
    env.tl.push(Row(src="x", at=T0, family="doorbell", kind="ring", title="t", entity="camera.front"))
    env.tl.flush()
    event_id = env.db.execute("SELECT id FROM timeline_events").fetchone()[0]
    monkeypatch.setattr(P.secrets, "token_hex", lambda n: "a" * 32)
    pid = env.pics.store(event_id, "camera.front", b"one")
    with pytest.raises(FileExistsError):                                    # O_EXCL: never over another's file
        env.pics.store(event_id, "camera.front", b"two")
    assert env.pics.read(pid) == b"one"
    # a record that can't be made takes its file with it
    monkeypatch.setattr(P.secrets, "token_hex", lambda n: "b" * 32)
    with pytest.raises(Exception):
        env.pics.store(10**9, "camera.front", b"orphan")                    # no such event: the foreign key says no
    assert not env.tl.pic_path("b" * 32, env.now[0]).exists()
    assert ev is env.tl.rows


def test_read_and_path_refuse_what_is_not_an_id(env):
    for bad in ("", "x", "../etc/passwd", "A" * 32, "a" * 31, "a" * 33, None, 5):
        assert env.pics.path_of(bad) is None and env.pics.read(bad) is None
    assert env.pics.path_of("c" * 32) is None                                # well formed, not kept


async def test_a_deleted_event_takes_its_picture_records_with_it(env):
    env.camera_row("pt:e1:ring")
    await env.done()
    assert len(env.pic_rows()) == 2
    with env.db:
        env.db.execute("DELETE FROM timeline_events")
    assert env.pic_rows() == [] and env.db.execute("SELECT COUNT(*) FROM timeline_pics").fetchone()[0] == 0


async def test_stopping_cancels_a_filmstrip_under_way(env):
    env.cam.delay = 5.0
    env.camera_row("pt:e1:ring")
    await asyncio.sleep(0.01)
    assert env.pics.tasks
    await env.pics.stop()
    assert not [t for t in env.pics.tasks if not t.done()]


# -- shrink ------------------------------------------------------------------------------------------------------------
def test_shrink_makes_a_small_jpeg_from_a_full_size_still():
    from PIL import Image
    img = Image.new("RGB", (1920, 1080))
    px = img.load()
    for x in range(0, 1920, 3):
        for y in range(0, 1080, 3):
            px[x, y] = ((x * 7) % 256, (y * 5) % 256, ((x + y) * 3) % 256)
    big = io.BytesIO()
    img.save(big, "JPEG", quality=92)
    out = image_work.shrink(big.getvalue())
    got = Image.open(io.BytesIO(out))
    assert got.format == "JPEG" and max(got.size) == 640 and got.size == (640, 360)
    assert len(out) < len(big.getvalue()) / 4 and len(out) < 120_000
    # the edge and the quality are the caller's
    assert Image.open(io.BytesIO(image_work.shrink(big.getvalue(), 320, 50))).size == (320, 180)
    assert len(image_work.shrink(big.getvalue(), 640, 30)) < len(out)
    # a picture smaller than the edge is never made larger; a tall one is limited by its height
    small = io.BytesIO()
    Image.new("RGB", (200, 100), "gray").save(small, "JPEG")
    assert Image.open(io.BytesIO(image_work.shrink(small.getvalue()))).size == (200, 100)
    tall = io.BytesIO()
    Image.new("RGB", (900, 1600), "gray").save(tall, "PNG")
    assert Image.open(io.BytesIO(image_work.shrink(tall.getvalue()))).size == (360, 640)
    rgba = io.BytesIO()
    Image.new("RGBA", (800, 800), (10, 20, 30, 40)).save(rgba, "PNG")
    assert Image.open(io.BytesIO(image_work.shrink(rgba.getvalue()))).mode == "RGB"


def test_shrink_refuses_what_is_not_a_picture():
    with pytest.raises(image_work.PhotoError):
        image_work.shrink(b"not a picture at all")
    with pytest.raises(image_work.PhotoError):
        image_work.shrink(b"")


async def test_the_picture_work_runs_in_the_image_worker(env, image_threads):
    from PIL import Image
    raw = io.BytesIO()
    Image.new("RGB", (1920, 1080), (30, 60, 90)).save(raw, "JPEG")
    pics = Pictures(env.app, env.tl)                                         # the real shrink, through imaging.run
    out = await pics.shrink(raw.getvalue())
    assert max(Image.open(io.BytesIO(out)).size) == 640
    with pytest.raises(image_work.PhotoError):
        await pics.shrink(b"junk")
    assert imaging.run is not None
