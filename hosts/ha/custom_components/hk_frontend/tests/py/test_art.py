"""Artwork through Home Assistant (art.py)."""
from __future__ import annotations

import io

import pytest

from custom_components.hk_frontend import art

MZ = "https://is1-ssl.mzstatic.com/image/thumb/f-ye8/1000x1000bb.jpg"

# where each test host "is" (no DNS in the tests): the CDN and x.test on the
# internet, the others on the home network or worse
WHERE = {"is1-ssl.mzstatic.com": "17.253.1.1", "x.test": "93.184.216.34", "192.0.2.53": "192.0.2.53",
         "router.lan": "192.0.2.1", "metadata": "169.254.169.254", "localhost": "127.0.0.1"}


@pytest.fixture(autouse=True)
def addresses(monkeypatch):
    async def fake(hass, host, port):
        if host not in WHERE:
            raise OSError("no such host")
        return {WHERE[host]}
    monkeypatch.setattr(art, "_addresses", fake)


def test_sizes_snap_up_to_the_next_allowed_one():
    assert art.snap(0) == 0 and art.snap(None) == 0
    assert art.snap(120) == 150 and art.snap(300) == 300 and art.snap(301) == 600
    assert art.snap(5000) == 1000 and art.snap("x") == 300


def test_only_absolute_web_urls_are_proxied():
    assert art.is_remote(MZ) and art.is_remote("http://192.0.2.10:8095/imageproxy/ab")
    assert not art.is_remote("/api/media_player_proxy/x")
    assert not art.is_remote("file:///etc/passwd") and not art.is_remote(None)
    assert not art.is_remote("https://x/" + "a" * 3000)


def test_the_path_carries_the_url_encoded_and_the_size_in_its_query():
    p = art.art_path(MZ, 250)
    assert p.startswith(art.URL + "?e=") and p.endswith("&s=300")
    assert art.dec(p.split("e=")[1].split("&")[0]) == MZ
    # no URL in the query at all: a proxy that blocks common exploits answers
    # 403 to "http://" in a query string, and the signer decodes %3A%2F%2F back
    assert "://" not in p and "%3A" not in p.upper()


async def test_a_path_signed_with_the_url_still_says_nothing_a_proxy_would_block(hass):
    from datetime import timedelta
    from homeassistant.components.http.auth import async_sign_path
    from homeassistant.setup import async_setup_component
    assert await async_setup_component(hass, "http", {})
    signed = async_sign_path(hass, art.art_path("http://192.0.2.10:8095/imageproxy/ab?size=512&fmt=jpg", 600),
                             timedelta(hours=1))
    query = signed.split("?", 1)[1]
    assert "http" not in query.lower().split("authsig=")[0], signed


def test_a_bad_encoding_is_nothing_not_an_error():
    assert art.dec("!!!") == "" and art.dec(None) == "" and art.dec("") == ""
    assert art.dec(art.enc(MZ)) == MZ


def test_the_cache_keeps_the_most_recent():
    c = art.Cache(cap=2)
    c.put(("a", 0), (b"1", "image/jpeg"))
    c.put(("b", 0), (b"2", "image/jpeg"))
    c.get(("a", 0))                       # a is now the newest
    c.put(("c", 0), (b"3", "image/jpeg"))
    assert c.get(("b", 0)) is None and c.get(("a", 0)) and len(c) == 2


def test_the_cache_is_bounded_by_bytes_not_only_by_count():
    c = art.Cache(cap=100, max_bytes=8000)
    for i in range(9):
        c.put((str(i), 0), (b"x" * 900, "image/jpeg"))
    assert c.bytes <= 8000 and len(c) == 8, "the oldest went to keep under the byte budget"
    assert c.get(("0", 0)) is None and c.get(("8", 0))
    c.put(("8", 0), (b"y" * 100, "image/jpeg"))           # a replaced entry is not counted twice
    assert c.bytes == 7 * 900 + 100
    c.put(("big", 0), (b"z" * 1500, "image/jpeg"))        # over an eighth of the budget
    assert c.get(("big", 0)) is None and len(c) == 8, "one body may not crowd out the rest"


def _img(w, h, fmt="JPEG"):
    PIL = pytest.importorskip("PIL.Image")
    buf = io.BytesIO()
    PIL.new("RGB", (w, h), (200, 30, 30)).save(buf, fmt)
    return buf.getvalue()


def _jpeg(w, h):
    return _img(w, h, "JPEG")


def _png_header(w, h):
    """A PNG that only CLAIMS w x h: signature, IHDR, IEND. Enough for the
    header check, and nothing a test would have to allocate."""
    import struct
    import zlib

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(b"")) + chunk(b"IEND", b""))


def test_a_big_image_is_scaled_and_a_small_one_left_alone():
    PIL = pytest.importorskip("PIL.Image")
    out = art.render(_jpeg(1000, 1000), 300, "image/jpeg")
    assert out[1] == "image/jpeg"
    assert PIL.open(io.BytesIO(out[0])).size == (300, 300)
    small = _jpeg(200, 200)
    assert art.render(small, 300, "image/jpeg") == (small, "image/jpeg"), "as it came"
    png = _img(200, 200, "PNG")
    assert art.render(png, 300, "image/png") == (png, "image/png")


def test_only_pixels_go_out():
    """An upstream type outside RASTER is re-encoded as a JPEG (so what the page
    gets is bytes Pillow wrote), and what Pillow cannot read is refused -- an
    SVG passed through would run as a page on HA's own origin."""
    PIL = pytest.importorskip("PIL.Image")
    bmp = _img(120, 80, "BMP")
    out = art.render(bmp, 300, "image/bmp")
    assert out[1] == "image/jpeg" and PIL.open(io.BytesIO(out[0])).size == (120, 80)
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    with pytest.raises(art.Refused):
        art.render(svg, 300, "image/svg+xml")
    with pytest.raises(art.Refused):                  # a raster label on garbage
        art.render(b"not an image", 300, "image/png")
    assert art.RASTER == {"image/jpeg", "image/png", "image/webp", "image/gif"}


def test_the_pixel_budget_is_checked_before_anything_is_decoded(monkeypatch):
    pytest.importorskip("PIL.Image")
    from PIL import ImageFile
    loaded = []
    monkeypatch.setattr(ImageFile.ImageFile, "load",
                        lambda self: loaded.append(self.size) or None)
    with pytest.raises(art.Refused, match="over"):
        art.render(_png_header(6000, 6000), 300, "image/png")   # 36 MP, under Pillow's own limit
    assert loaded == [], "refused from the header alone"


def test_a_jpeg_is_decoded_at_a_fraction_of_its_size(monkeypatch):
    PIL = pytest.importorskip("PIL.Image")
    from PIL import JpegImagePlugin
    asked = []
    real = JpegImagePlugin.JpegImageFile.draft

    def spy(self, mode, size):
        asked.append((mode, size))
        return real(self, mode, size)
    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "draft", spy)
    out = art.render(_jpeg(2400, 2400), 300, "image/jpeg")
    assert asked and asked[0] == ("RGB", (600, 600)), asked
    assert PIL.open(io.BytesIO(out[0])).size == (300, 300)


async def test_fetch_scales_caches_and_refuses_non_images(hass, aioclient_mock):
    from homeassistant.helpers.aiohttp_client import async_get_clientsession
    pytest.importorskip("PIL.Image")
    aioclient_mock.get(MZ, content=_jpeg(1000, 1000), headers={"Content-Type": "image/jpeg"})
    aioclient_mock.get("https://x.test/page", text="<html>", headers={"Content-Type": "text/html"})
    cache = art.Cache()
    s = async_get_clientsession(hass)
    got = await art.async_fetch(hass, MZ, 300, cache, session=s)
    assert got and got[1] == "image/jpeg" and len(got[0]) < 20000
    again = await art.async_fetch(hass, MZ, 300, cache, session=s)
    assert again == got and aioclient_mock.call_count == 1, "second paint is served from memory"
    assert await art.async_fetch(hass, "https://x.test/page", 300, cache, session=s) is None


class _Chunked:
    """A body that arrives in several network chunks, as a real one does."""

    def __init__(self, data, size):
        self._parts = [data[i:i + size] for i in range(0, len(data), size)]

    async def iter_chunked(self, n):
        for p in self._parts:
            yield p


async def test_the_whole_body_is_read_not_just_the_first_chunk():
    body = bytes(range(256)) * 400                    # 102,400 bytes
    assert await art.read_limited(_Chunked(body, 1378), 10_000_000) == body
    assert await art.read_limited(_Chunked(body, 1378), 50_000) is None, "over the limit"


async def test_the_view_serves_only_pixels_and_says_so(hass, hass_client, aioclient_mock):
    """Through the real view, authenticated as a screen: an SVG upstream is
    415, a BMP comes back a JPEG, and every answer carries nosniff and a
    sandboxing CSP (a path opened as a page runs nothing)."""
    from homeassistant.setup import async_setup_component
    pytest.importorskip("PIL.Image")
    assert await async_setup_component(hass, "http", {})
    art.async_register(hass)
    svg_url, bmp_url = "https://x.test/a.svg", "https://x.test/b.bmp"
    aioclient_mock.get(svg_url, text='<svg xmlns="http://www.w3.org/2000/svg"/>',
                       headers={"Content-Type": "image/svg+xml"})
    aioclient_mock.get(bmp_url, content=_img(64, 64, "BMP"), headers={"Content-Type": "image/bmp"})
    client = await hass_client()

    r = await client.get(art.art_path(svg_url, 300))
    assert r.status == 415
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert "sandbox" in r.headers["Content-Security-Policy"]

    r = await client.get(art.art_path(bmp_url, 300))
    assert r.status == 200 and r.content_type == "image/jpeg"

    # a path in the older, plain form (u=<url>) is still served
    from urllib.parse import quote
    r = await client.get(f"{art.URL}?u={quote(bmp_url, safe='')}&s=300")
    assert r.status == 200 and r.content_type == "image/jpeg"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Content-Security-Policy"] == "default-src 'none'; sandbox"


async def test_only_artwork_destinations_are_fetched(hass):
    """Any signed-in user can ask, so the proxy goes only where covers are:
    the internet, or Music Assistant's own image proxy on the home network."""
    ok = lambda u: art.allowed(hass, u)
    assert await ok(MZ)
    assert await ok("http://192.0.2.53:8095/imageproxy/8f48?size=512&fmt=jpg"), "MA's imageproxy"
    assert not await ok("http://router.lan/cgi-bin/reboot"), "the home network outside MA's proxy"
    assert not await ok("http://localhost:8123/api/states")
    assert not await ok("http://metadata/latest/meta-data/imageproxy/x"), "link-local, whatever the path"
    assert not await ok("http://nowhere.invalid/a.jpg"), "a name that does not resolve"
    assert not await ok("ftp://x.test/a.jpg")


async def test_a_redirect_is_checked_like_the_first_address(hass, aioclient_mock):
    from homeassistant.helpers.aiohttp_client import async_get_clientsession
    pytest.importorskip("PIL.Image")
    aioclient_mock.get("https://x.test/r", status=302, headers={"Location": "http://router.lan/admin.png"})
    aioclient_mock.get("http://router.lan/admin.png", content=_jpeg(10, 10), headers={"Content-Type": "image/jpeg"})
    aioclient_mock.get("https://x.test/r2", status=302, headers={"Location": MZ})
    aioclient_mock.get(MZ, content=_jpeg(100, 100), headers={"Content-Type": "image/jpeg"})
    s = async_get_clientsession(hass)
    assert await art.async_fetch(hass, "https://x.test/r", 300, art.Cache(), session=s) is None
    assert not any("router.lan" in str(c[1]) for c in aioclient_mock.mock_calls), "never asked the router"
    got = await art.async_fetch(hass, "https://x.test/r2", 300, art.Cache(), session=s)
    assert got and got[1] == "image/jpeg", "a redirect to the CDN is followed"


async def test_dot_segments_never_leave_the_imageproxy(hass, aioclient_mock):
    """aiohttp normalises `..` before it asks, so `/imageproxy/../x` would
    reach `/x` on the home network: any dot segment, plain or %-encoded, is
    refused before anything is fetched."""
    from homeassistant.helpers.aiohttp_client import async_get_clientsession
    ok = lambda u: art.allowed(hass, u)
    for path in ("/imageproxy/../private/snapshot.png", "/imageproxy/%2e%2e/private/x",
                 "/imageproxy/%2E%2E%2Fprivate", "/imageproxy/%252e%252e/x", "/imageproxy/./x"):
        assert not await ok("http://192.0.2.53:8095" + path), path
    assert await ok("http://192.0.2.53:8095/imageproxy/a..b?size=512"), "dots inside a name are fine"
    aioclient_mock.get("http://192.0.2.53:8095/private/snapshot.png", content=b"x",
                       headers={"Content-Type": "image/png"})
    s = async_get_clientsession(hass)
    assert await art.async_fetch(hass, "http://192.0.2.53:8095/imageproxy/../private/snapshot.png", 0,
                                 art.Cache(), session=s) is None
    assert aioclient_mock.call_count == 0, "never asked"
