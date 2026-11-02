"""hk_core/art: album art scaled to the tile and where it may be fetched from (the core HK Frontend's art.py and
Mantel's media_art.py share, 2026-10-29). Runs here once; HK Frontend's tests/py/test_art.py runs the same code through
its Home Assistant wrapper, and tests/test_media_art.py through Mantel's routes."""
from __future__ import annotations

import io

import pytest
from PIL import Image

from hk_core.art import fetch, resize

MZ = "https://is1-ssl.mzstatic.com/image/thumb/f-ye8/1000x1000bb.jpg"
WHERE = {"is1-ssl.mzstatic.com": "17.253.1.1", "x.test": "93.184.216.34", "192.0.2.53": "192.0.2.53",
         "router.lan": "192.0.2.1", "metadata": "169.254.169.254", "localhost": "127.0.0.1"}


async def resolve(host, port):
    if host not in WHERE:
        raise OSError("no such host")
    return {WHERE[host]}


def img(size=(800, 800), fmt="JPEG", mode="RGB"):
    buf = io.BytesIO()
    Image.new(mode, size, (30, 60, 90) if mode == "RGB" else 0).save(buf, fmt)
    return buf.getvalue()


def test_sizes_snap_up_to_the_next_allowed_one():
    assert resize.snap(0) == 0 and resize.snap(None) == 0 and resize.snap(-5) == 0
    assert resize.snap(120) == 150 and resize.snap(300) == 300 and resize.snap(301) == 600
    assert resize.snap(5000) == 1000 and resize.snap("x") == 300 and resize.snap("250") == 300


def test_a_big_cover_becomes_a_small_jpeg_and_a_small_one_goes_as_it_came():
    body, ctype = resize.render(img((1200, 900)), 300, "image/jpeg")
    assert ctype == "image/jpeg" and Image.open(io.BytesIO(body)).size == (300, 225)
    small = img((100, 100), "PNG")
    assert resize.render(small, 300, "image/png") == (small, "image/png")
    assert resize.render(small, 0, "image/png") == (small, "image/png")             # 0: the original
    out, ctype = resize.render(img((64, 64), "BMP"), 300, "image/bmp")             # not raster: re-encoded, never as it came
    assert ctype == "image/jpeg" and out[:3] == b"\xff\xd8\xff"
    out, ctype = resize.render(img((64, 64), "PNG"), 30, "image/png")
    assert ctype == "image/jpeg" and Image.open(io.BytesIO(out)).size == (30, 30)


def test_what_is_not_a_picture_is_refused():
    for data, ctype in ((b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", "image/svg+xml"),
                        (b"not an image at all", "image/jpeg"), (b"", "image/png")):
        with pytest.raises(resize.Refused):
            resize.render(data, 300, ctype)


def test_a_header_that_declares_too_many_pixels_is_refused_before_it_is_decoded(monkeypatch):
    monkeypatch.setattr(resize, "MAX_PIXELS", 100)
    with pytest.raises(resize.Refused, match="pixels"):
        resize.render(img((20, 20)), 300, "image/jpeg")


def test_the_cache_is_bounded_by_count_and_by_bytes_and_keeps_the_recent():
    c = resize.Cache(cap=3, max_bytes=800)
    for i in range(5):
        c.put(("u", i), (b"x" * 100, "image/jpeg"))
    assert len(c) == 3 and c.get(("u", 0)) is None and c.get(("u", 4)) is not None
    c.get(("u", 2))                                                    # used: it outlives the older
    c.put(("u", 5), (b"x" * 100, "image/jpeg"))
    assert c.get(("u", 2)) is not None and c.get(("u", 3)) is None
    c.put(("big", 0), (b"x" * 101, "image/jpeg"))                      # over an eighth of the whole: not kept
    assert c.get(("big", 0)) is None
    d = resize.Cache(cap=100, max_bytes=300)
    for i in range(6):
        d.put(i, (b"x" * 30, "image/jpeg"))
    assert d.bytes <= 300 and len(d) == 6
    d.put("again", (b"x" * 30, "image/jpeg"))
    d.put("again", (b"y" * 10, "image/jpeg"))
    assert d.bytes == 6 * 30 + 10


def test_the_address_travels_encoded_and_a_bad_encoding_is_nothing():
    assert "://" not in fetch.enc(MZ) and fetch.dec(fetch.enc(MZ)) == MZ
    assert fetch.dec("!!") == "" and fetch.dec(None) == "" and fetch.dec("") == "" and fetch.dec("/w") == ""
    assert fetch.is_remote(MZ) and not fetch.is_remote("/api/x") and not fetch.is_remote("https://x/" + "a" * 3000)


async def test_only_artwork_destinations_are_fetched():
    ok = lambda u: fetch.allowed(u, resolve)
    assert await ok(MZ)
    assert await ok("http://192.0.2.53:8095/imageproxy/8f48?size=512&fmt=jpg"), "MA's imageproxy on the home network"
    assert not await ok("http://router.lan/cgi-bin/reboot"), "the home network outside MA's proxy"
    assert not await ok("http://localhost:8123/api/states")
    assert not await ok("http://metadata/latest/meta-data/imageproxy/x"), "link-local, whatever the path"
    assert not await ok("http://nowhere.invalid/a.jpg") and not await ok("ftp://x.test/a.jpg")
    for path in ("/imageproxy/../x", "/imageproxy/%2e%2e/x", "/imageproxy/%252e%252e/x", "/imageproxy/./x"):
        assert not await ok("http://192.0.2.53:8095" + path), path


class Web:
    def __init__(self, pages):
        self.pages, self.asked = pages, []

    def get(self, url, **kw):
        self.asked.append(url)
        status, ctype, body, headers = self.pages.get(url, (404, "text/plain", b"", {}))

        class Body:
            async def iter_chunked(self, n):
                for i in range(0, len(body), n):
                    yield body[i:i + n]

        class R:
            def __init__(self):
                self.status, self.content, self.headers = status, Body(), {"Content-Type": ctype, **headers}

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False
        return R()


async def run_inline(fn, *args):
    return fn(*args)


async def test_a_fetch_scales_keeps_and_follows_redirects_only_to_artwork_destinations():
    web = Web({MZ: (200, "image/jpeg", img((1000, 1000)), {}),
               "https://x.test/page": (200, "text/html", b"<html>", {}),
               "https://x.test/r1": (302, "text/plain", b"", {"Location": "http://router.lan/admin.jpg"}),
               "https://x.test/r2": (302, "text/plain", b"", {"Location": MZ}),
               "http://router.lan/admin.jpg": (200, "image/jpeg", img(), {})})
    cache = resize.Cache()
    got = await fetch.async_fetch(MZ, 300, cache, web, resolve, run_inline)
    assert got and got[1] == "image/jpeg" and Image.open(io.BytesIO(got[0])).size == (300, 300)
    assert await fetch.async_fetch(MZ, 300, cache, web, resolve, run_inline) == got and web.asked == [MZ]     # from memory
    assert await fetch.async_fetch("https://x.test/page", 300, cache, web, resolve, run_inline) is None       # not an image
    assert await fetch.async_fetch("https://x.test/r1", 300, cache, web, resolve, run_inline) is None
    assert "http://router.lan/admin.jpg" not in web.asked, "never asked the router"
    again = await fetch.async_fetch("https://x.test/r2", 150, cache, web, resolve, run_inline)
    assert again and Image.open(io.BytesIO(again[0])).size == (150, 150)


async def test_a_body_over_the_limit_is_nothing_and_the_whole_body_is_read():
    body = bytes(range(256)) * 400

    class Chunks:
        async def iter_chunked(self, n):
            for i in range(0, len(body), 1378):
                yield body[i:i + 1378]
    assert await fetch.read_limited(Chunks(), 10_000_000) == body
    assert await fetch.read_limited(Chunks(), 50_000) is None



async def test_addresses_that_carry_another_address_are_never_artwork():
    """SRV-10: Python's ``is_global`` calls 64:ff9b::a9fe:a9fe (NAT64's 169.254.169.254) global, and the others
    "not global", which the /imageproxy/ exception for the home network would then take."""
    def at(addr):
        async def resolve_(host, port):
            return {addr}
        return resolve_
    for addr in ("64:ff9b::a9fe:a9fe", "64:ff9b::808:808", "64:ff9b:1::a9fe:a9fe", "::ffff:169.254.169.254",
                 "2002:a9fe:a9fe::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "fec0::1", "::a9fe:a9fe", "0.1.2.3",
                 "fe80::1", "ff02::1"):
        for path in ("/a.jpg", "/imageproxy/8f48"):
            assert not await fetch.allowed("http://x.test" + path, at(addr)), (addr, path)
    # an IPv4 address written as IPv6 is judged as the IPv4 address it is
    assert await fetch.allowed("http://x.test/a.jpg", at("::ffff:93.184.216.34"))
    assert not await fetch.allowed("http://x.test/a.jpg", at("::ffff:10.0.0.1"))
    assert await fetch.allowed("http://x.test/imageproxy/a", at("::ffff:10.0.0.1"))

    async def mixed(host, port):                                         # one bad address among good ones spoils it
        return {"93.184.216.34", "64:ff9b::a9fe:a9fe"}
    assert not await fetch.allowed(MZ, mixed)


async def test_a_fetch_connects_to_the_addresses_it_checked_on_every_hop():
    import contextlib
    pinned = []

    @contextlib.contextmanager
    def pin(host, addrs):
        pinned.append((host, list(addrs), "open"))
        yield
        pinned.append((host, list(addrs), "closed"))
    web = Web({"https://x.test/r2": (302, "text/plain", b"", {"Location": MZ}),
               MZ: (200, "image/jpeg", img((1000, 1000)), {})})
    got = await fetch.async_fetch("https://x.test/r2", 300, resize.Cache(), web, resolve, run_inline, pin)
    assert got
    assert pinned == [("x.test", ["93.184.216.34"], "open"), ("x.test", ["93.184.216.34"], "closed"),
                      ("is1-ssl.mzstatic.com", ["17.253.1.1"], "open"), ("is1-ssl.mzstatic.com", ["17.253.1.1"], "closed")]
