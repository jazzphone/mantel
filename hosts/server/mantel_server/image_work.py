"""THE PICTURE WORK ITSELF: what imaging.py runs in its worker process (docs/phase4/PHOTOS.md, "Where the work runs").

Mantel Photos' ``process`` (three stored sizes and the faces), Your Files' ``reencode_photo`` and the face backfill's
``look``. Each takes plain data (bytes, a path) and gives plain data back (bytes, sizes, face boxes), so it can be
sent to another process; none of them writes a file, a row or an audit line -- the server does that with what comes
back.

This module is imported by a SPAWNED worker, which imports nothing else of Mantel's but ``faces`` and ``cutout``: it
must never import the server (aiohttp, the store, the routes). photos.py and user_files.py import from here.

* **In the worker** (``start_worker``, the pool's initializer): JPEGs are encoded progressive and optimized -- the
  encode holds the GIL, which there is the worker's own (MED-1 turned it off while it was the server's) -- and one
  face detector is kept for the worker's life (ONNX Runtime is imported only there, never in the server). So is the
  cut-out model (cutout.py: Time Behind), when it is installed.
* **In a thread** (imaging.py's fallback when no worker can run): baseline JPEG, as MED-1 left it, so the event loop
  keeps running; a detector (and a cut-out model) per look, dropped after.
"""
from __future__ import annotations

import contextlib
import io
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from . import cutout as cutter
from . import faces as face_finder

log = logging.getLogger("mantel.photos")

IN_WORKER = False           # True in imaging.py's worker process (start_worker)

# Mantel Photos (photos.py)
PIXELS_MAX = 64_000_000     # a decode costs 8-10 bytes a pixel: 64 MP peaks near 0.65 GB (100 MP: 0.9 GB)
ORIGINAL_EDGE = 8192
SCREEN_EDGE = 2560
MID_EDGE = 1280         # the middle size, made on the first ask (photos.py PhotoLibrary.mid_path), not at upload
THUMB_EDGE = 480
# Your Files (user_files.py)
PHOTO_PIXELS_MAX = 60_000_000
PHOTO_EDGE = 3840


class _Refused(Exception):
    """A refused picture. ``code`` is stable (the page words it); ``status`` is the HTTP answer. Picklable, so a
    refusal in the worker arrives in the server as itself."""

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code, self.status = code, status

    def __reduce__(self):
        return type(self), (self.code, str(self), self.status)


class PhotoError(_Refused):
    """Mantel Photos' refusals (photos.PhotoError)."""


class FileError(_Refused):
    """Your Files' refusals (user_files.FileError)."""


def start_worker(level: int = logging.INFO) -> None:
    """The worker process's first step: it is the worker, and it logs as the server does (to the same stderr)."""
    global IN_WORKER
    IN_WORKER = True
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def ready() -> int:
    """A worker that answers: its process id."""
    return os.getpid()


def _jpeg_options() -> dict:
    # progressive=True and optimize=True (libjpeg runs both through one optimal-Huffman pass) hold the GIL for the whole
    # encode: in the server's own process a 48 MP picture froze every other client for ~0.75 s (MED-1), so a thread
    # encodes baseline (~13% larger files). The worker has a GIL of its own.
    return {"progressive": True, "optimize": True} if IN_WORKER else {}


def _trim() -> None:
    """After a picture, give the freed heap back (Linux): glibc keeps the freed buffers of a 48 MP decode (~0.6 GB)
    in the process otherwise, and the worker would hold them until it stops idle -- under a 1 GB container limit."""
    if IN_WORKER and sys.platform.startswith("linux"):
        with contextlib.suppress(Exception):
            import ctypes
            ctypes.CDLL("libc.so.6").malloc_trim(0)


def process(data: bytes) -> Processed:
    """Decode a picture and make its three stored files (see photos.py's docstring). PhotoError otherwise."""
    try:
        return _process(data)
    finally:
        _trim()


def reencode_photo(data: bytes, *, expect: str | None = None) -> tuple[bytes, str]:
    """Your Files' photo: (bytes, "jpeg"|"png"|"webp"), see ``_reencode_photo``. FileError otherwise."""
    try:
        return _reencode_photo(data, expect=expect)
    finally:
        _trim()


# -- faces --------------------------------------------------------------------------------------------------------
_detector = None


def _worker_detector():
    """The worker's one detector, made on first use and kept (RuntimeError when it can't be made)."""
    global _detector
    if _detector is None:
        _detector = face_finder.Detector().__enter__()
    return _detector


def _faces_in(img) -> list | None:
    """An upload's faces (``faces.find``'s answer: None when there's no detector or it failed; never raises)."""
    if not IN_WORKER:
        return face_finder.find(img)
    if not face_finder.available():
        return None
    try:
        return _worker_detector().detect(img)
    except Exception as exc:  # noqa: BLE001 -- detection never fails an upload
        log.warning("couldn't look for faces: %s: %s", type(exc).__name__, exc)
        return None


def detector_ready() -> tuple[bool, str | None]:
    """(faces can be found on this platform, why the detector won't start or None). In the worker the detector is
    made now and kept; in a thread it is made and dropped."""
    if not face_finder.available():
        return False, "the face detector isn't available on this platform"
    try:
        if IN_WORKER:
            _worker_detector()
        else:
            with face_finder.Detector():
                pass
    except Exception as exc:  # noqa: BLE001
        return True, str(exc)
    return True, None


def look(path: str | Path | None) -> list | None:
    """The faces in a stored file (the face backfill): ``[]`` when it can't be opened (there is nothing to find, now or
    later), None when the DETECTOR failed on a picture that opened (that says nothing about the photo: it is looked at
    again)."""
    if path is None:
        return []
    path = Path(path)
    from PIL import Image
    try:
        im = Image.open(path)
        im.load()
    except Exception as exc:  # noqa: BLE001 -- an unreadable file is "no faces", not a retry for ever
        log.warning("couldn't look for faces in %s: %s: %s", path.name, type(exc).__name__, exc)
        return []
    with im:
        try:
            if IN_WORKER:
                return _worker_detector().detect(im)
            with face_finder.Detector() as det:
                return det.detect(im)
        except Exception as exc:  # noqa: BLE001 -- onnxruntime failing at run time: not the photo's fault
            log.warning("the face detector failed on %s: %s: %s", path.name, type(exc).__name__, exc)
            return None


# -- Time Behind: the cut-outs (cutout.py) ------------------------------------------------------------------------
_cutter = None


def _worker_cutter():
    """The worker's one cut-out model, made on first use and kept (RuntimeError when it can't be made)."""
    global _cutter
    if _cutter is None:
        _cutter = cutter.Cutter().__enter__()
    return _cutter


def _cutout_in(img, found: list | None) -> dict | None:
    """An upload's cut-out (cutout.result, after its faces), or None when there's no model or it failed; never
    raises."""
    if not IN_WORKER:
        return cutter.find(img, found)
    if not cutter.available():
        return None
    try:
        return cutter.result(_worker_cutter().mask(img), cutter.numpy(), found)
    except Exception as exc:  # noqa: BLE001 -- a cut-out never fails an upload
        log.warning("couldn't make a cut-out: %s: %s", type(exc).__name__, exc)
        return None


def cutter_ready() -> tuple[bool, str | None]:
    """(cut-outs can be made on this platform, why the model won't start or None). In the worker the model is
    loaded now and kept; in a thread it is loaded and dropped."""
    if not cutter.available():
        return False, cutter.why_not() or "the cut-out model isn't available"
    try:
        if IN_WORKER:
            _worker_cutter()
        else:
            with cutter.Cutter():
                pass
    except Exception as exc:  # noqa: BLE001
        return True, str(exc)
    return True, None


def cut_look(path: str | Path | None, found: list | None = None) -> dict | None:
    """The cut-out of a stored file (the cut-out backfill), its faces as stored: ``{"ok": False, "why":
    "unreadable"}`` when it can't be opened (nothing to cut, now or later), None when the MODEL failed on a picture
    that opened (it is looked at again)."""
    gone = {"ok": False, "why": "unreadable", "cover": None, "conf": None, "overlap": None, "box": None,
            "by": cutter.NAME, "mask": None}
    if path is None:
        return gone
    path = Path(path)
    from PIL import Image
    try:
        im = Image.open(path)
        im.load()
    except Exception as exc:  # noqa: BLE001 -- an unreadable file is "nothing to cut", not a retry for ever
        log.warning("couldn't cut out %s: %s: %s", path.name, type(exc).__name__, exc)
        return gone
    try:
        with im:
            if IN_WORKER:
                return cutter.result(_worker_cutter().mask(im), cutter.numpy(), found)
            with cutter.Cutter() as c:
                return cutter.result(c.mask(im), cutter.numpy(), found)
    except Exception as exc:  # noqa: BLE001 -- onnxruntime failing at run time: not the photo's fault
        log.warning("the cut-out model failed on %s: %s: %s", path.name, type(exc).__name__, exc)
        return None
    finally:
        _trim()


# -- Mantel Photos: the three stored sizes ----------------------------------------------------------------------
@dataclass
class Processed:
    original: bytes
    screen: bytes
    thumb: bytes
    width: int
    height: int
    faces: list | None = None        # None: not looked for (no detector here, or it failed)
    # Time Behind (cutout.result: ok, conf, box, by, and a usable one's mask PNG); None: not made (no model here,
    # or it failed)
    cutout: dict | None = None
    taken: int | None = None         # the year it was taken (its EXIF's, read before the EXIF is dropped)

    @property
    def mask(self) -> bytes | None:
        return (self.cutout or {}).get("mask") or None

    @property
    def size(self) -> int:
        return len(self.original) + len(self.screen) + len(self.thumb) + len(self.mask or b"")


def taken_year(img) -> int | None:
    """The year a picture was taken, from its EXIF (DateTimeOriginal, else DateTime), or None. Only the year is
    kept (Photo Titles: an album's name and the year); everything else in the EXIF is dropped with it."""
    try:
        exif = img.getexif()
        raw = exif.get_ifd(0x8769).get(36867) or exif.get(306)
        year = int(str(raw)[:4])
    except Exception:  # noqa: BLE001 -- no EXIF, or a damaged one: not known
        return None
    return year if 1900 <= year <= 2100 else None


def sniff(data: bytes) -> str | None:
    """"jpeg" | "png" | "webp" | "heic" from the bytes, else None (the name and the browser's word are ignored)."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"):
        return "heic"
    return None


def _process(data: bytes) -> Processed:
    """Decode a picture and make its three stored files (see the module docstring). PhotoError otherwise."""
    kind = sniff(data)
    if kind is None:
        raise PhotoError("photo_invalid", "That isn’t a JPEG, PNG, WebP or HEIC picture.", 415)
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:                                  # pragma: no cover -- Pillow is a dependency
        raise PhotoError("images_unavailable", "This server was built without image support.", 503) from exc
    if kind == "heic":
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError as exc:
            raise PhotoError("heic_unsupported", "This server can’t read HEIC photos. Export the photo as JPEG.",
                             415) from exc
    Image.MAX_IMAGE_PIXELS = None       # Pillow's global bomb check off: each open checks its own cap, just below
    try:
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > PIXELS_MAX:
            raise PhotoError("photo_too_large", "That picture has too many pixels (64 megapixels at most).", 413)
        shown = {"JPEG": "jpeg", "MPO": "jpeg", "PNG": "png", "WEBP": "webp", "HEIF": "heic"}.get(img.format or "")
        if shown != kind:
            raise PhotoError("photo_invalid", "The picture doesn’t match its own format.", 415)
        img.seek(0)
        img.load()
        icc = img.info.get("icc_profile")
        taken = taken_year(img)                                  # the year alone, for Photo Titles
        ImageOps.exif_transpose(img, in_place=True)              # upright, then the EXIF is never written again
        # no copy of what is already the right mode: at tens of megapixels each copy is hundreds of MB
        if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
            rgba = img if img.mode == "RGBA" else img.convert("RGBA")
            flat = Image.new("RGB", rgba.size, (0, 0, 0))        # a screensaver's ground is black
            flat.paste(rgba, mask=rgba)                          # an RGBA mask is its own alpha band
            del rgba
            img = flat
        elif img.mode != "RGB":
            img = img.convert("RGB")
        if icc:
            with contextlib.suppress(Exception):                # best effort: wide gamut (Display P3) -> sRGB
                from PIL import ImageCms
                src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
                img = ImageCms.profileToProfile(img, src, ImageCms.createProfile("sRGB"), outputMode="RGB")
        img.thumbnail((ORIGINAL_EDGE, ORIGINAL_EDGE), Image.LANCZOS)
        width, height = img.size

        def jpeg(im, quality: int) -> bytes:
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=quality, **_jpeg_options())
            return buf.getvalue()

        original = jpeg(img, 90)
        screen = img.copy()
        screen.thumbnail((SCREEN_EDGE, SCREEN_EDGE), Image.LANCZOS)
        screen_bytes = jpeg(screen, 85)
        found = _faces_in(screen)                                 # never raises; None when there's no detector
        cut = _cutout_in(screen, found)                           # ...and after them, Time Behind's cut-out
        thumb = screen.copy()
        thumb.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, "WEBP", quality=78, method=4)
        return Processed(original, screen_bytes, buf.getvalue(), width, height, found, cut, taken)
    except PhotoError:
        raise
    except Image.DecompressionBombError as exc:
        raise PhotoError("photo_too_large", "That picture has too many pixels (64 megapixels at most).", 413) from exc
    except Exception as exc:  # noqa: BLE001 -- any decoder failure is "not a usable picture"
        raise PhotoError("photo_invalid", "That picture couldn’t be read.", 415) from exc


def make_variant(src: str | Path, edge: int = MID_EDGE) -> bytes:
    """A smaller copy of a stored screen-sized photo (JPEG, ``edge`` px on its long side), for the middle size
    (2026-10-29: a wall tablet's screen is 1280 px wide, and showed the 2560 px file, decoded, for every photo).
    The source is the 2560 px file, already upright and sRGB, so this is a resize and nothing else: libjpeg decodes
    it at half size (``draft``) and the copy is made in a few tens of ms. It runs in a THREAD of the server, not in
    the image worker -- a long upload must never keep a tablet waiting for the next photo -- so the JPEG is baseline
    (the GIL; see ``_jpeg_options``). PhotoError when the source can't be read."""
    from PIL import Image
    try:
        with Image.open(src) as im:
            im.draft("RGB", (edge, edge))        # a JPEG decodes at 1/2, 1/4 or 1/8 while that is >= the edge
            im.load()
            img = im.convert("RGB") if im.mode != "RGB" else im
            img.thumbnail((edge, edge), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=85, **_jpeg_options())
            return buf.getvalue()
    except Exception as exc:  # noqa: BLE001 -- an unreadable source is "no copy", and the screen size is served
        raise PhotoError("photo_invalid", "That picture couldn’t be read.", 415) from exc


# -- Your Files: one photo ----------------------------------------------------------------------------------------
def sniff_image(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"):
        return "heic"
    return None


def _reencode_photo(data: bytes, *, expect: str | None = None) -> tuple[bytes, str]:
    """Decode and re-encode an image: (bytes, "jpeg"|"png"|"webp"). Drops all metadata, applies the EXIF
    rotation, shrinks to PHOTO_EDGE, keeps one frame. ``expect`` pins the output format (an import that
    must keep its extension). FileError: photo_invalid, photo_too_large, heic_unsupported, images_unavailable."""
    kind = sniff_image(data)
    if kind is None:
        raise FileError("photo_invalid", "that is not a jpeg, png, webp or heic picture", 415)
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:                                  # pragma: no cover -- Pillow is a dependency
        raise FileError("images_unavailable", "this server was built without image support", 503) from exc
    if kind == "heic":
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError as exc:
            raise FileError("heic_unsupported", "HEIC needs pillow-heif on this server; export the photo as JPEG",
                            415) from exc
    Image.MAX_IMAGE_PIXELS = None       # Pillow's global bomb check off (photos.py does the same): each open checks its cap
    try:
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > PHOTO_PIXELS_MAX:
            raise FileError("photo_too_large", "that picture has too many pixels", 413)
        # MPO: the multi-picture JPEG many phones and cameras write (a JPEG to everything else; photos.py takes it too)
        shown = {"JPEG": "jpeg", "MPO": "jpeg", "PNG": "png", "WEBP": "webp", "HEIF": "heic"}.get(img.format or "")
        if shown != kind:
            raise FileError("photo_invalid", "the picture does not match its own format", 415)
        if shown == "jpeg":
            # only PHOTO_EDGE is kept, so libjpeg may decode at 1/2, 1/4 or 1/8 size while that is still >= the edge
            img.draft("RGB", (PHOTO_EDGE, PHOTO_EDGE))
        img.seek(0)
        img.load()
        icc = img.info.get("icc_profile")
        ImageOps.exif_transpose(img, in_place=True)
        img.thumbnail((PHOTO_EDGE, PHOTO_EDGE))
        out_kind = "jpeg" if kind == "heic" else kind
        if expect is not None and out_kind != expect:
            raise FileError("photo_invalid", f"the picture is {out_kind}, its name says {expect}", 415)
        has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
        if out_kind == "jpeg" or not has_alpha:
            img = img.convert("RGB")
        else:
            img = img.convert("RGBA")
        if icc:
            with contextlib.suppress(Exception):                # best effort: wide-gamut -> sRGB
                from PIL import ImageCms
                src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
                img = ImageCms.profileToProfile(img, src, ImageCms.createProfile("sRGB"), outputMode=img.mode)
        buf = io.BytesIO()
        if out_kind == "jpeg":
            img.save(buf, "JPEG", quality=88, **_jpeg_options())
        elif out_kind == "png":
            img.save(buf, "PNG", optimize=True)
        else:
            img.save(buf, "WEBP", quality=88, method=4)
        return buf.getvalue(), out_kind
    except FileError:
        raise
    except Image.DecompressionBombError as exc:
        raise FileError("photo_too_large", "that picture has too many pixels", 413) from exc
    except Exception as exc:  # noqa: BLE001 -- any decoder failure is "not a usable picture"
        raise FileError("photo_invalid", "that picture could not be read", 415) from exc
