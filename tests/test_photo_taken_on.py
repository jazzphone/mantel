"""On This Day (image_work.py, photos.py, migration 0030): a photo carries the DAY it was taken, not only the year -- read
from the EXIF on upload before the EXIF is dropped (the date alone, nothing else), listed to the screensavers as
``date`` next to ``year``, and for photos stored before filled in from a camera-style file name (the stored files have
no EXIF) or by sending the photo again. Every picture here is GENERATED at run time: no real photo is in git."""
import io
import shutil

import pytest
from aiohttp import FormData
from PIL import Image

from mantel_server.cameras import cutout, faces, image_work, photos
from mantel_server.storage import db as dbm


@pytest.fixture(autouse=True)
def _quiet(image_threads, monkeypatch):
    """The picture work in this process, and no detector or cut-out model (the faces' and cut-outs' tests are theirs)."""
    monkeypatch.setattr(cutout, "available", lambda: False)
    monkeypatch.setattr(faces, "available", lambda: False)


def exif_of(date="2025:07:12 14:03:22", dt=None, extra=False) -> Image.Exif:
    ex = Image.Exif()
    if date is not None:
        ex.get_ifd(0x8769)[36867] = date                 # DateTimeOriginal
    if dt is not None:
        ex[306] = dt                                      # DateTime
    if extra:
        ex[0x010F] = "ACME camera"
        ex[0x8825] = {1: "N", 2: (41.0, 52.0, 0.0), 3: "W", 4: (87.0, 38.0, 0.0)}      # GPS
    return ex


def picture(date="2025:07:12 14:03:22", dt=None, color=(200, 30, 30), extra=False, exif=True) -> bytes:
    buf = io.BytesIO()
    im = Image.new("RGB", (160, 120), color)
    if exif:
        im.save(buf, "JPEG", exif=exif_of(date, dt, extra).tobytes())
    else:
        im.save(buf, "JPEG")
    return buf.getvalue()


def opened(data: bytes):
    return Image.open(io.BytesIO(data))


# -- the EXIF, read -------------------------------------------------------------------------------------------------
def test_the_day_is_read_from_the_exif():
    img = opened(picture("2025:07:12 14:03:22"))
    assert image_work.taken_date(img) == "2025-07-12" and image_work.taken_year(img) == 2025


def test_the_date_taken_is_preferred_to_the_date_changed():
    img = opened(picture("2021:03:04 10:00:00", dt="2025:07:12 14:03:22"))
    assert image_work.taken_date(img) == "2021-03-04"
    only_changed = opened(picture(None, dt="2022:12:31 23:59:59"))
    assert image_work.taken_date(only_changed) == "2022-12-31" and image_work.taken_year(only_changed) == 2022


@pytest.mark.parametrize("raw", ["0000:00:00 00:00:00", "2023:13:40 10:00:00", "2023:02:30 10:00:00", "garbled", "  ", "20X5:01:01",
                                 "1850:01:01 00:00:00", "2500:01:01 00:00:00", "2023:07"])
def test_a_garbled_or_impossible_date_is_not_a_day(raw):
    assert image_work.taken_date(opened(picture(raw))) is None


def test_a_year_alone_is_still_a_year_but_not_a_day():
    img = opened(picture("2023:00:00 00:00:00"))
    assert image_work.taken_year(img) == 2023 and image_work.taken_date(img) is None


def test_no_exif_is_no_day():
    img = opened(picture(exif=False))
    assert image_work.taken_date(img) is None and image_work.taken_year(img) is None


def test_the_header_alone_gives_a_pictures_year_and_day():
    assert image_work.taken_of(picture("2024:02:29 08:00:00")) == (2024, "2024-02-29")
    assert image_work.taken_of(picture(exif=False)) == (None, None)
    assert image_work.taken_of(b"not a picture at all") == (None, None)
    assert image_work.taken_of(b"\xff\xd8\xff garbage after a jpeg's magic") == (None, None)


def test_the_processed_picture_carries_the_day_and_nothing_else_of_the_exif():
    got = image_work.process(picture("2025:07:12 14:03:22", extra=True))
    assert (got.taken, got.taken_on) == (2025, "2025-07-12")
    for stored in (got.original, got.screen):
        assert not Image.open(io.BytesIO(stored)).getexif(), "the EXIF itself is still dropped"
    assert image_work.process(picture(exif=False)).taken_on is None


# -- the migration --------------------------------------------------------------------------------------------------
def test_the_migration_keeps_photos_already_there_and_adds_the_day(tmp_path):
    old = tmp_path / "upto29"
    old.mkdir()
    for m in dbm.discover():
        if m.version <= 29:
            shutil.copy(m.path, old / m.path.name)
    conn = dbm.connect(tmp_path / "m.db")
    dbm.migrate(conn, old)
    with conn:
        conn.execute("INSERT INTO photo_albums (id, name, position, created, updated) VALUES ('a1a1a1a1a1a1a1a1', 'F', 1, 1, 1)")
        conn.execute("INSERT INTO photos (id, album_id, sha256, name, width, height, bytes, created, taken) "
                     "VALUES (?, 'a1a1a1a1a1a1a1a1', 's', 'x.jpg', 10, 10, 5, 1, 2023)", ("1" * 32,))
    assert 30 in set(dbm.migrate(conn))
    got = conn.execute("SELECT name, taken, taken_on FROM photos").fetchone()
    assert tuple(got) == ("x.jpg", 2023, None), "the photo stays as it was, its day not looked for yet"
    plan = " ".join(str(r[3]) for r in conn.execute(
        "EXPLAIN QUERY PLAN SELECT id FROM photos WHERE taken IS NOT NULL AND taken_on IS NULL ORDER BY created DESC LIMIT 5"))
    assert "photos_unday" in plan
    conn.close()


# -- the library and the list ---------------------------------------------------------------------------------------
async def sign_in(mantel, name="avery", role="owner"):
    await mantel.user(name, role)
    r, _ = await mantel.sign_in(name)
    assert r.status == 200


async def album(mantel, name="Family"):
    r = await mantel.client.request("POST", "/api/photos/albums", json={"name": name}, headers=mantel.headers(True))
    body = await r.json()
    assert r.status == 201, body
    return body["album"]["id"]


async def upload(mantel, aid, data, name="photo.jpg"):
    fd = FormData()
    fd.add_field("file", data, filename=name, content_type="application/octet-stream")
    r = await mantel.client.post(f"/api/photos/albums/{aid}/upload", data=fd, headers=mantel.headers())
    return r, await r.json()


def day_of(mantel, pid):
    return tuple(mantel.store.db.execute("SELECT taken, taken_on FROM photos WHERE id=?", (pid,)).fetchone())


async def shown(mantel, aid):
    r = await mantel.client.get(f"/api/photos/albums/{aid}/show")
    assert r.status == 200
    return {p["id"]: p for p in (await r.json())["photos"]}


async def test_an_upload_keeps_the_day_and_the_list_carries_it_next_to_the_year(mantel):
    await sign_in(mantel)
    aid = await album(mantel)
    a = (await upload(mantel, aid, picture("2025:07:12 14:03:22", extra=True)))[1]["photo"]["id"]
    b = (await upload(mantel, aid, picture(exif=False, color=(1, 2, 3))))[1]["photo"]["id"]
    c = (await upload(mantel, aid, picture("2023:00:00 00:00:00", color=(9, 9, 9))))[1]["photo"]["id"]
    assert day_of(mantel, a) == (2025, "2025-07-12") and day_of(mantel, b) == (None, None) and day_of(mantel, c) == (2023, None)
    items = await shown(mantel, aid)
    assert items[a]["year"] == 2025 and items[a]["date"] == "2025-07-12"
    assert "year" not in items[b] and "date" not in items[b]
    assert items[c]["year"] == 2023 and "date" not in items[c]
    # (the date and nothing more of the EXIF: no time, no camera, no place)
    assert set(items[a]) <= {"id", "title", "w", "h", "url", "year", "date", "focus", "faces", "depth"}
    assert "14:03" not in repr(items[a]) and "ACME" not in repr(items[a])


async def test_a_damaged_stored_day_is_not_listed(mantel):
    await sign_in(mantel)
    aid = await album(mantel)
    pid = (await upload(mantel, aid, picture()))[1]["photo"]["id"]
    for bad in ("", "2025-7-2", "garbage", "2025-07-12T14:03"):
        with mantel.store.db:
            mantel.store.db.execute("UPDATE photos SET taken_on=? WHERE id=?", (bad, pid))
        assert "date" not in (await shown(mantel, aid))[pid], bad


def old_photo(mantel, aid, name, taken, created, taken_on=None, pid=None):
    """A row as it was before migration 0030 (a year, no day), with no files."""
    pid = pid or f"{created:032x}"
    with mantel.store.db:
        mantel.store.db.execute("INSERT INTO photos (id, album_id, sha256, name, width, height, bytes, created, taken, taken_on) "
                                "VALUES (?,?,?,?,10,10,1,?,?,?)", (pid, aid, pid, name, created, taken, taken_on))
    return pid


def test_a_camera_style_name_says_its_day_when_its_year_is_the_exifs():
    day = photos.day_from_name
    assert day("IMG_20230415_123456.jpg", 2023) == "2023-04-15"
    assert day("PXL_20230415_123456789.jpg", 2023) == "2023-04-15"
    assert day("2023-04-15 12.34.56.jpg", 2023) == "2023-04-15"
    assert day("20230415_123456.jpg", 2023) == "2023-04-15"
    assert day("IMG_20230415_123456.jpg", 2021) is None, "a name that disagrees with the EXIF is not trusted"
    assert day("IMG_20230415_123456.jpg", None) is None
    assert day("IMG_20231345_123456.jpg", 2023) is None, "not a real day"
    assert day("IMG_20230230_123456.jpg", 2023) is None
    assert day("Beach 2023-04-15.jpg", 2023) is None, "a bare date is anyone's title, not the camera's stamp"
    assert day("IMG_4521.JPG", 2023) is None
    assert day("12023041512345.jpg", 2023) is None and day(None, 2023) is None


async def test_the_fill_gives_old_photos_a_day_from_their_names_and_looks_at_each_once(mantel):
    await sign_in(mantel)
    aid = await album(mantel)
    a = old_photo(mantel, aid, "IMG_20230415_123456.jpg", 2023, 5)
    b = old_photo(mantel, aid, "IMG_4521.JPG", 2023, 4)
    c = old_photo(mantel, aid, "IMG_20190101_000000.jpg", 2021, 3)           # the name disagrees with the EXIF's year
    d = old_photo(mantel, aid, "PXL_20240229_235959999.jpg", 2024, 2)
    e = old_photo(mantel, aid, "IMG_20230415_123456.jpg", None, 1)           # no year at all: not an On This Day photo
    lib = mantel.app["photos"]
    assert lib.fill_days() == 4
    assert [day_of(mantel, p)[1] for p in (a, b, c, d, e)] == ["2023-04-15", "", "", "2024-02-29", None]
    assert lib.fill_days() == 0, "each photo is looked at once"
    items = await shown(mantel, aid)
    assert items[a]["date"] == "2023-04-15" and items[d]["date"] == "2024-02-29"
    assert "date" not in items[b] and "date" not in items[c] and items[b]["year"] == 2023


async def test_the_fill_is_bounded_and_newest_first(mantel):
    await sign_in(mantel)
    aid = await album(mantel)
    ids = [old_photo(mantel, aid, f"IMG_2023041{i}_123456.jpg", 2023, 10 + i) for i in range(5)]
    lib = mantel.app["photos"]
    assert lib.fill_days(2) == 2
    assert [day_of(mantel, p)[1] for p in ids] == [None, None, None, "2023-04-13", "2023-04-14"]
    assert lib.fill_days(2) == 2 and lib.fill_days(2) == 1 and lib.fill_days(2) == 0
    assert all(day_of(mantel, p)[1] for p in ids)


async def test_the_server_fills_the_days_at_startup(mantel):
    # (the app started with an empty library: the task has run and finished; a new row is picked up by the next start)
    task = mantel.app["photos_days"]
    await task
    assert task.done() and task.exception() is None


async def test_a_photo_sent_again_learns_its_day_and_never_loses_it(mantel):
    await sign_in(mantel)
    aid = await album(mantel)
    data = picture("2022:09:30 08:15:00", color=(5, 5, 5))
    pid = (await upload(mantel, aid, data))[1]["photo"]["id"]
    # as stored before migration 0030: the year, no day (and the name carries none)
    with mantel.store.db:
        mantel.store.db.execute("UPDATE photos SET taken_on=NULL WHERE id=?", (pid,))
    r, body = await upload(mantel, aid, data)
    assert body["photo"]["id"] == pid and day_of(mantel, pid) == (2022, "2022-09-30")
    # a photo the fill marked "not known" learns it too
    with mantel.store.db:
        mantel.store.db.execute("UPDATE photos SET taken_on='' WHERE id=?", (pid,))
    await upload(mantel, aid, data)
    assert day_of(mantel, pid) == (2022, "2022-09-30")
    # once known it isn't changed (a copy with another date is another photo to the library only by its bytes)
    with mantel.store.db:
        mantel.store.db.execute("UPDATE photos SET taken_on='2022-09-29' WHERE id=?", (pid,))
    await upload(mantel, aid, data)
    assert day_of(mantel, pid) == (2022, "2022-09-29")
    # a duplicate with no EXIF at all changes nothing
    plain = picture(exif=False, color=(7, 7, 7))
    p2 = (await upload(mantel, aid, plain))[1]["photo"]["id"]
    await upload(mantel, aid, plain)
    assert day_of(mantel, p2) == (None, None)
