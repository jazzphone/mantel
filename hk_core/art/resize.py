"""ALBUM ART SCALED TO THE TILE (moved here from HK Frontend's art.py, 2026-10-29, so Mantel scales it too).

ONLY PIXELS GO OUT. Whatever comes back is served from the page's own origin, so what that origin serves must never be
something a browser would RUN: an upstream ``image/svg+xml`` (Pillow cannot read it, so passed through as it came)
opened as a page runs its script with the page's stored sign-in in reach. So a response is one of RASTER as it came,
or a JPEG this module encoded itself -- anything else is refused (``Refused``). Re-encoding the rest (rather than
refusing all of it) keeps a BMP or TIFF cover showing, and what reaches the page is then bytes Pillow wrote, not bytes a
stranger chose. See ``render``.

Plain Python and Pillow (imported when a picture is rendered, so a host without it still passes RASTER art through).
No Home Assistant, no aiohttp.
"""
from __future__ import annotations

import io
from collections import OrderedDict

# THE CACHE IS BOUNDED BY BYTES, NOT JUST BY COUNT. A scaled tile is 10-60 KB at 150-600 px, but a 1000 px one is
# ~150-250 KB and a cover already under its size is kept as it came (a PNG can be megabytes): 400 of those is far more
# than 10 MB. CACHE_BYTES is the real ceiling.
CACHE_ITEMS = 400
CACHE_BYTES = 48_000_000
# Pixels, checked from the HEADER before anything is decoded. An 8 MB PNG can declare ~170 megapixels (half a gigabyte
# to decode, under Pillow's own bomb threshold); album art tops out near 3000 x 3000 = 9 MP. Past this, refused.
MAX_PIXELS = 25_000_000
SIZES = (0, 150, 300, 600, 1000)
RASTER = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})


class Refused(Exception):
    """Not served: not an image this proxy will pass, or too big to decode."""


def snap(size) -> int:
    """The smallest allowed size >= the one asked for (0 = original)."""
    try:
        size = int(size or 0)
    except (TypeError, ValueError):
        return 300
    if size <= 0:
        return 0
    return next((s for s in SIZES[1:] if s >= size), SIZES[-1])


def render(data: bytes, size: int, ctype: str) -> tuple[bytes, str]:
    """What to serve for these bytes: (body, content type). CPU work: a host runs it off its event loop. Raises Refused.

    * nothing is decoded until the header says it fits MAX_PIXELS;
    * a RASTER image no bigger than `size` (0 = any size) goes as it came;
    * anything else Pillow can read becomes a JPEG at most `size` px on its
      long side -- which is also how a non-RASTER type gets out at all;
    * what Pillow cannot read is refused: it is not a picture."""
    try:
        from PIL import Image
    except ImportError:
        if ctype in RASTER:
            return data, ctype
        raise Refused(f"{ctype} needs Pillow") from None
    try:
        im = Image.open(io.BytesIO(data))     # the header only: nothing decoded yet
        w, h = im.size
    except Exception as err:  # noqa: BLE001 - Pillow's own bomb check lands here too
        raise Refused(f"not an image ({type(err).__name__})") from err
    if w * h > MAX_PIXELS:
        raise Refused(f"{w}x{h} is over {MAX_PIXELS} pixels")
    if ctype in RASTER and (not size or max(w, h) <= size):
        return data, ctype
    target = size or max(w, h)
    try:
        if im.format == "JPEG":
            # Decode at 1/2, 1/4 or 1/8 scale straight out of the DCT, never
            # the full frame -- with the same 2x headroom thumbnail() keeps.
            im.draft("RGB", (target * 2, target * 2))
        im.thumbnail((target, target))
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        out = io.BytesIO()
        im.save(out, "JPEG", quality=85, optimize=True)
    except Exception as err:  # noqa: BLE001 - a truncated or odd file
        raise Refused(f"could not re-encode ({type(err).__name__})") from err
    return out.getvalue(), "image/jpeg"


class Cache:
    """Most recently used, at most `cap` items AND `max_bytes` of bodies."""

    def __init__(self, cap: int = CACHE_ITEMS, max_bytes: int = CACHE_BYTES):
        self._cap = cap
        self._max = max_bytes
        self._bytes = 0
        self._d: OrderedDict[tuple[str, int], tuple[bytes, str]] = OrderedDict()

    def get(self, key):
        v = self._d.get(key)
        if v is not None:
            self._d.move_to_end(key)
        return v

    def put(self, key, value):
        if len(value[0]) > self._max // 8:
            return                        # one body may not crowd out the rest
        old = self._d.pop(key, None)
        if old is not None:
            self._bytes -= len(old[0])
        self._d[key] = value
        self._bytes += len(value[0])
        while len(self._d) > self._cap or self._bytes > self._max:
            _, gone = self._d.popitem(last=False)
            self._bytes -= len(gone[0])

    @property
    def bytes(self) -> int:
        return self._bytes

    def __len__(self):
        return len(self._d)
