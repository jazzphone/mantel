"""YOUR FILES on Mantel Server: the home's own fonts, glyphs and photos, uploaded, checked and served.

Some of what HK draws cannot ship with it: SF Pro and the SF Symbols glyphs are Apple's, and Apple's
license makes each home supply its own copies (PLAN §4). In Home Assistant they lived in a folder under
/config (``hk_frontend/files.py``). Here they live on Mantel's ``/data`` volume, in
``<data_dir>/user-files`` -- never inside the web root, never inside an image -- and an Owner or Admin puts
them there with an upload (or, once, with ``mantel-server import-files <folder>``).

Served at the SAME URLs HK's frontend already uses, so no page, stylesheet or saved setting changes::

    /hk/fonts/<name>                 fonts      (SF-Pro.woff2, SF-Pro.ttf, ...)    <data>/user-files/hk/fonts/
    /hk/iconset/hk-glyphs.js         the glyph data                                   <data>/user-files/hk/iconset/
    /hk/<folder>/<name>              imported image overrides (sky/clouds-a.webp)     <data>/user-files/hk/...
    /api/image/serve/<id>/original   uploaded photos (backgrounds, screensaver)       <data>/user-files/photos/
    /local/<path>                    imported www images (settings that say /local/)  <data>/user-files/local/

all behind the same sign-in as the rest of Mantel (a signed-in person or an enrolled tablet), with the right
content type, ``nosniff`` and ``no-cache``. The uploaded copy wins over the bundled file of the same path and
over ``cfg.hk_files`` (the dev folder, ``--hk-files``), which is served after it.

What is accepted -- every upload is *checked by its bytes*, never by its name or the browser's word:

* fonts   woff2 / ttf / otf by magic bytes and a sane table directory; the extension must agree with the
          bytes; 40 MB.
* glyphs  ``hk-glyphs.js`` as ``build_glyphs.py`` writes it, or the same as JSON. The upload is PARSED as
          data (no JavaScript engine, no eval), shape-checked (icon names, SVG path characters) and written
          back out by this module: the file browsers run is *ours*, never the uploaded bytes. 2 MB.
* photos  jpeg / png / webp (and heic if ``pillow-heif`` is installed), decoded and RE-ENCODED (metadata and
          GPS dropped, rotation applied, long edge <= 3840, first frame only), 25 MB and 60 megapixels in.
          The stored id is 32 hex characters, the shape HA's image store used, so settings that point at
          ``/api/image/serve/<id>/original`` keep working after the import.

File names are normalised (no paths, no odd characters, case kept: HK asks for ``SF-Pro.woff2`` exactly).
All files are 0600 in 0700 folders and the folder is capped (1 GiB). Nothing here ever executes an upload.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import re
import secrets
import struct
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Callable
from urllib.parse import unquote

from aiohttp import web

from . import audit, imaging
# a photo's decode and re-encode (image_work.py) runs in imaging.py's worker process; these names stay Your Files'
from .image_work import PHOTO_EDGE, PHOTO_PIXELS_MAX, FileError, reencode_photo, sniff_image  # noqa: F401
from .guards import guard
from .guards import ident as guarded

log = logging.getLogger("mantel.user_files")

FONT_MAX = 40 << 20
GLYPHS_MAX = 2 << 20
PHOTO_MAX = 25 << 20
QUOTA = 1 << 30
NAME_MAX = 80

FONT_TYPES = {"woff2": "font/woff2", "ttf": "font/ttf", "otf": "font/otf"}
IMAGE_TYPES = {"jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
EXT_TYPES = {".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".js": "text/javascript; charset=utf-8",
             ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
IMAGE_EXT = {"jpeg": ".jpg", "png": ".png", "webp": ".webp"}
EXT_FORMAT = {".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp"}
GLYPHS_REL = "iconset/hk-glyphs.js"
# The only Apple-licensed files HK references (web/hk/fonts/sf-pro.css, web/hk/iconset/hk-icons.js). Where an
# Owner's copy may sit inside a folder they point the import at: HA's www/hk, the integration's frontend
# folder, the old hk_local folder, or the files lying directly in it.
LICENSED_ASSETS = {"SF-Pro.woff2": "fonts/SF-Pro.woff2", "SF-Pro.ttf": "fonts/SF-Pro.ttf",
                   "hk-glyphs.js": GLYPHS_REL}
ASSET_PREFIXES = ("", "hk", "www/hk", "frontend", "hk_frontend/frontend", "custom_components/hk_frontend/frontend",
                  "hk_local")
PHOTO_ID = re.compile(r"^[0-9a-f]{32}$")
NOCACHE = {"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}


# -- names ------------------------------------------------------------------------------------------
_BAD = re.compile(r"[^A-Za-z0-9._-]+")


def normalize_name(raw: object, *, exts: set[str] | None = None) -> str:
    """A file name safe to store and to put in a URL: the last path part only, NFKC, ``[A-Za-z0-9._-]``,
    no leading dot, case kept, extension lowercased, at most 80 characters of stem."""
    if not isinstance(raw, str) or not raw.strip():
        raise FileError("bad_name", "the file needs a name")
    name = unicodedata.normalize("NFKC", raw).replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if ch.isprintable())
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    stem = _BAD.sub("-", stem).strip(".-_")[:NAME_MAX]
    ext = _BAD.sub("", ext).lower()[:8]
    if not stem:
        raise FileError("bad_name", "that file name has nothing usable in it")
    full = f"{stem}.{ext}" if ext else stem
    if exts is not None and f".{ext}" not in exts:
        raise FileError("bad_name", f"the file name must end in one of {', '.join(sorted(exts))}")
    return full


_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


def clean_rel(rel: str, *, depth: int = 4) -> str | None:
    """A relative path under a served prefix, or None. Every segment must already be a clean name."""
    parts = PurePosixPath(rel).parts
    if not parts or len(parts) > depth or any(not _SEGMENT.match(p) or p in (".", "..") for p in parts):
        return None
    return "/".join(parts)


# -- fonts ------------------------------------------------------------------------------------------
def sniff_font(data: bytes) -> str:
    """"woff2" | "ttf" | "otf" from the bytes, or FileError(font_invalid)."""
    bad = FileError("font_invalid", "that is not a woff2, ttf or otf font", 415)
    if len(data) < 16:
        raise bad
    tag = data[:4]
    if tag == b"wOF2":
        length, num = struct.unpack(">I", data[8:12])[0], struct.unpack(">H", data[12:14])[0]
        if length != len(data) or not 1 <= num <= 200:
            raise bad
        return "woff2"
    if tag in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
        num = struct.unpack(">H", data[4:6])[0]
        if not 1 <= num <= 100 or 12 + 16 * num > len(data):
            raise bad
        for i in range(num):
            rec = data[12 + 16 * i:28 + 16 * i]
            offset, length = struct.unpack(">II", rec[8:16])
            if offset + length > len(data) or not rec[:4].isascii():
                raise bad
        return "otf" if tag == b"OTTO" else "ttf"
    raise bad


# -- glyphs -----------------------------------------------------------------------------------------
_GLYPH_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_PATH = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9eE\s,.+-]{1,40000}$")
_VIEWBOX = re.compile(r"^-?[0-9.]+(?: -?[0-9.]+){3}$")
_ROLE = re.compile(r"^[a-z]{1,12}$")
_JS_PREFIX = re.compile(r'^\(typeof window !== "undefined" \? window : globalThis\)\.hkGlyphs\s*=\s*'
                        r'|^(?:window|globalThis)\.hkGlyphs\s*=\s*')
_JS_BARE = re.compile(r"\b(icons|twotone|weather|path|secondaryPath)\s*:")
_JS_OUTSIDE = re.compile(r"[^\s{}\[\]:,0-9.+\-eEA-Za-z_]")
GLYPH_ICONS_MAX = 3000


def _glyph_data(text: str) -> object:
    """hk-glyphs.js (or JSON) -> data, parsing only: leading ``//`` comments, the one assignment, and an
    object literal made of JSON strings and the five bare keys build_glyphs.py writes."""
    lines = text.lstrip("﻿").split("\n")
    i = 0
    while i < len(lines) and (not lines[i].strip() or lines[i].lstrip().startswith("//")):
        i += 1
    body = "\n".join(lines[i:]).strip()
    m = _JS_PREFIX.match(body)
    if m:
        body = body[m.end():].rstrip()
        if body.endswith(";"):
            body = body[:-1].rstrip()
    if not body.startswith("{") or not body.endswith("}"):
        raise FileError("glyphs_invalid", "expected hk-glyphs.js as build_glyphs.py writes it, or JSON", 415)
    out = []
    for n, seg in enumerate(re.split(r'("(?:[^"\\\n]|\\.)*")', body)):
        if n % 2:                                              # a string literal: data, kept as is
            out.append(seg)
            continue
        if _JS_OUTSIDE.search(seg):
            raise FileError("glyphs_invalid", "the glyph file contains code, not just data", 415)
        seg = _JS_BARE.sub(r'"\1":', seg)
        out.append(re.sub(r",(\s*[}\]])", r"\1", seg))
    try:
        return json.loads("".join(out))
    except ValueError as exc:
        raise FileError("glyphs_invalid", "the glyph file is not valid glyph data", 415) from exc


def _is_path(v: object) -> bool:
    return isinstance(v, str) and bool(_PATH.match(v))


def check_glyphs(data: bytes) -> dict:
    """Parse and shape-check an uploaded glyph file; returns {"icons","twotone","weather"} or FileError."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise FileError("glyphs_invalid", "the glyph file is not UTF-8 text", 415) from exc
    g = _glyph_data(text)
    bad = lambda why: FileError("glyphs_invalid", f"the glyph file is not the shape HK expects: {why}", 415)  # noqa: E731
    if not isinstance(g, dict) or set(g) - {"icons", "twotone", "weather"}:
        raise bad("top level must be icons, twotone and weather")
    icons, two, wx = g.get("icons"), g.get("twotone", {}), g.get("weather", {})
    if not isinstance(icons, dict) or not icons or len(icons) > GLYPH_ICONS_MAX:
        raise bad("icons must be a non-empty table of glyphs")
    for k, v in icons.items():
        if not _GLYPH_NAME.match(k) or not _is_path(v):
            raise bad(f"icon {k[:40]!r} is not a name with an SVG path")
    if not isinstance(two, dict) or len(two) > GLYPH_ICONS_MAX:
        raise bad("twotone must be a table")
    for k, v in two.items():
        if not _GLYPH_NAME.match(k) or not isinstance(v, dict) or set(v) != {"path", "secondaryPath"} \
                or not _is_path(v["path"]) or not _is_path(v["secondaryPath"]):
            raise bad(f"twotone {k[:40]!r} needs path and secondaryPath")
    if not isinstance(wx, dict) or len(wx) > GLYPH_ICONS_MAX:
        raise bad("weather must be a table")
    for k, v in wx.items():
        ok = (_GLYPH_NAME.match(k) and isinstance(v, list) and len(v) == 2 and isinstance(v[0], str)
              and _VIEWBOX.match(v[0]) and isinstance(v[1], list) and 0 < len(v[1]) <= 32
              and all(isinstance(p, list) and len(p) == 2 and isinstance(p[0], str) and _ROLE.match(p[0])
                      and _is_path(p[1]) for p in v[1]))
        if not ok:
            raise bad(f"weather {k[:40]!r} is not [viewBox, [[role, path], ...]]")
    return {"icons": icons, "twotone": two, "weather": wx}


GLYPHS_HEADER = ("// hk-glyphs.js -- the hk: iconset's glyph data, supplied by this home (Apple's SF Symbols).\n"
                 "// Checked and written by Mantel Server's user_files.py; served at /hk/iconset/hk-glyphs.js.\n")


def render_glyphs(g: dict) -> bytes:
    """The canonical file: same shape build_glyphs.py writes, so HK's loader reads it unchanged."""
    lines = [GLYPHS_HEADER, '(typeof window !== "undefined" ? window : globalThis).hkGlyphs = {', "icons: {"]
    lines += [f"  {json.dumps(k)}: {json.dumps(v)}," for k, v in g["icons"].items()]
    lines += ["},", "twotone: {"]
    for k, v in g["twotone"].items():
        lines += [f"  {json.dumps(k)}: {{", f'    path: {json.dumps(v["path"])},',
                  f'    secondaryPath: {json.dumps(v["secondaryPath"])}', "  },"]
    lines += ["},", "weather: {"]
    lines += [f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}," for k, v in g["weather"].items()]
    lines += ["},", "};", ""]
    return "\n".join(lines).encode("utf-8")


# -- the store --------------------------------------------------------------------------------------
@dataclass
class ImportReport:
    imported: list[str] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    dry_run: bool = False


class UserFiles:
    """``<root>`` = ``<data_dir>/user-files``; subfolders hk/ (served at /hk/), photos/, local/ (at /local/)."""

    def __init__(self, root: Path, *, dry_run: bool = False) -> None:
        self.root = Path(root).expanduser()
        self.hk, self.photos, self.local = self.root / "hk", self.root / "photos", self.root / "local"
        self.dry_run = dry_run

    # -- writing ----------------------------------------------------------------------------------
    def usage(self) -> int:
        total = 0
        for base, _, names in os.walk(self.root):
            for n in names:
                with contextlib.suppress(OSError):
                    total += (Path(base) / n).stat().st_size
        return total

    def _room(self, dest: Path, size: int) -> None:
        """FileError quota_exceeded unless ``size`` bytes at ``dest`` (replacing what is there) fit."""
        try:
            old = dest.stat().st_size if dest.is_file() else 0
        except OSError:
            old = 0
        if self.usage() - old + size > QUOTA:
            raise FileError("quota_exceeded", "the Your files folder is full", 413)

    def _put(self, dest: Path, data: bytes) -> None:
        self._room(dest, len(data))
        if self.dry_run:
            return
        for d in (self.root, dest.parent):
            d.mkdir(parents=True, exist_ok=True)
        for d in {self.root, *[p for p in dest.parents if self.root in p.parents]}:
            with contextlib.suppress(OSError):
                os.chmod(d, 0o700)
        tmp = dest.with_name(f".{dest.name}.{secrets.token_hex(4)}.tmp")
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, dest)
        finally:
            with contextlib.suppress(OSError):
                tmp.unlink()

    # Each upload is checked and made ready first (``prepare_*``: (write, what it is)), then written: the REST writes
    # its audit row between the two, so a refused audit leaves nothing behind (audit.py).
    def prepare_font(self, filename: object, data: bytes) -> tuple[Callable[[], None], dict]:
        if len(data) > FONT_MAX:
            raise FileError("too_large", f"fonts are limited to {FONT_MAX >> 20} MB", 413)
        kind = sniff_font(data)
        name = normalize_name(filename, exts=set(f".{k}" for k in FONT_TYPES))
        if not name.lower().endswith("." + kind):
            raise FileError("font_type_mismatch", f"the file is a {kind} font but its name says otherwise", 415)
        self._room(self.hk / "fonts" / name, len(data))
        return (lambda: self._put(self.hk / "fonts" / name, data),
                {"kind": "font", "name": name, "url": f"/hk/fonts/{name}", "type": FONT_TYPES[kind], "size": len(data)})

    def prepare_glyphs(self, data: bytes) -> tuple[Callable[[], None], dict]:
        if len(data) > GLYPHS_MAX:
            raise FileError("too_large", f"the glyph file is limited to {GLYPHS_MAX >> 20} MB", 413)
        g = check_glyphs(data)
        out = render_glyphs(g)
        self._room(self.hk / GLYPHS_REL, len(out))
        return (lambda: self._put(self.hk / GLYPHS_REL, out),
                {"kind": "glyphs", "name": "hk-glyphs.js", "url": "/hk/" + GLYPHS_REL, "type": EXT_TYPES[".js"],
                 "size": len(out), "icons": len(g["icons"]), "twotone": len(g["twotone"]),
                 "weather": len(g["weather"])})

    def prepare_photo(self, data: bytes, photo_id: str | None = None, *,
                      encoded: tuple[bytes, str] | None = None) -> tuple[Callable[[], None], dict]:
        """``encoded``: ``reencode_photo``'s answer, made already (by the image worker: ``encode_photo``)."""
        if len(data) > PHOTO_MAX:
            raise FileError("too_large", f"photos are limited to {PHOTO_MAX >> 20} MB", 413)
        out, kind = encoded if encoded is not None else reencode_photo(data)
        pid = photo_id or secrets.token_hex(16)
        if not PHOTO_ID.match(pid):
            raise FileError("bad_name", "a photo id is 32 hex characters")
        self._room(self.photos / f"{pid}{IMAGE_EXT[kind]}", len(out))

        def write() -> None:
            for old in self.photos.glob(f"{pid}.*"):
                if not self.dry_run and old.suffix != IMAGE_EXT[kind]:
                    old.unlink(missing_ok=True)
            self._put(self.photos / f"{pid}{IMAGE_EXT[kind]}", out)
        return write, {"kind": "photo", "id": pid, "name": pid, "url": f"/api/image/serve/{pid}/original",
                       "type": IMAGE_TYPES[kind], "size": len(out)}

    def add_font(self, filename: object, data: bytes) -> dict:
        write, got = self.prepare_font(filename, data)
        write()
        return got

    def add_glyphs(self, data: bytes) -> dict:
        write, got = self.prepare_glyphs(data)
        write()
        return got

    def add_photo(self, data: bytes, photo_id: str | None = None) -> dict:
        write, got = self.prepare_photo(data, photo_id)
        write()
        return got

    def add_image_at(self, base: Path, rel: str, data: bytes) -> dict:
        """An image override at a fixed path (import only): re-encoded, and it must stay what its name says."""
        clean = clean_rel(rel)
        fmt = EXT_FORMAT.get(PurePosixPath(rel).suffix.lower()) if clean else None
        if clean is None or fmt is None:
            raise FileError("bad_name", "not a usable image path")
        if len(data) > PHOTO_MAX:
            raise FileError("too_large", f"images are limited to {PHOTO_MAX >> 20} MB", 413)
        out, kind = reencode_photo(data, expect=fmt)
        self._put(base / clean, out)
        return {"kind": "image", "name": clean, "size": len(out)}

    def locate(self, kind: str, name: str) -> Path | None:
        """The stored file ``remove`` would delete, or None."""
        return {"font": lambda: self.resolve(self.hk / "fonts", name),
                "glyphs": lambda: self.resolve(self.hk, GLYPHS_REL),
                "photo": lambda: self.photo_path(name)}[kind]()

    def remove(self, kind: str, name: str) -> bool:
        path = self.locate(kind, name)
        if path is None:
            return False
        path.unlink()
        return True

    # -- reading ----------------------------------------------------------------------------------
    @staticmethod
    def resolve(base: Path, rel: str) -> Path | None:
        """base/rel when it is a regular, non-symlink file of a served type strictly inside base."""
        parts = PurePosixPath(rel).parts
        if not parts or any(p in ("", ".", "..") or p.startswith(".") or "\\" in p or "\x00" in p for p in parts):
            return None
        path = Path(base).joinpath(*parts)
        try:
            if path.is_symlink() or not path.is_file() or path.suffix.lower() not in EXT_TYPES:
                return None
            path.resolve().relative_to(Path(base).resolve())
        except (ValueError, OSError):
            return None
        return path

    def photo_path(self, pid: str) -> Path | None:
        if not PHOTO_ID.match(pid or ""):
            return None
        for ext in IMAGE_EXT.values():
            p = self.photos / f"{pid}{ext}"
            if p.is_file() and not p.is_symlink():
                return p
        return None

    def listing(self) -> dict:
        def files(base: Path):
            if not base.is_dir():
                return []
            return sorted(({"name": p.name, "size": p.stat().st_size} for p in base.iterdir()
                           if p.is_file() and not p.is_symlink() and not p.name.startswith(".")),
                          key=lambda d: d["name"])
        fonts = files(self.hk / "fonts")
        glyphs = self.resolve(self.hk, GLYPHS_REL)
        others = sorted(str(p.relative_to(self.hk)) for p in self.hk.rglob("*")
                        if p.is_file() and not p.is_symlink() and p.parts[len(self.hk.parts)] not in ("fonts",)
                        and str(p.relative_to(self.hk)) != GLYPHS_REL and not p.name.startswith(".")) \
            if self.hk.is_dir() else []
        return {"fonts": fonts,
                "glyphs": {"present": glyphs is not None, "size": glyphs.stat().st_size if glyphs else 0},
                "photos": [{"id": f["name"].split(".")[0], "size": f["size"]} for f in files(self.photos)],
                "overrides": others,
                "local": sorted(str(p.relative_to(self.local)) for p in self.local.rglob("*") if p.is_file()) if self.local.is_dir() else [],
                "status": {"font": any(f["name"] in ("SF-Pro.woff2", "SF-Pro.ttf") for f in fonts),
                           "glyphs": glyphs is not None},
                "usage": self.usage(), "quota": QUOTA}

    # -- the licensed assets ------------------------------------------------------------------------
    def import_assets(self, folder: Path) -> ImportReport:
        """Pick exactly the Apple-licensed files HK asks for out of ``folder`` (a copy of HA's www/hk or
        custom_components/hk_frontend/frontend, or a flat folder holding them) and store them, checked by
        their bytes like an upload. Nothing else in the folder is looked at, read or copied."""
        rep = ImportReport(dry_run=self.dry_run)
        folder = Path(folder)
        for name, rel in LICENSED_ASSETS.items():
            found = None
            for prefix in ASSET_PREFIXES:
                for cand in (folder / prefix / rel, folder / prefix / name):
                    if cand.is_file() and not cand.is_symlink() and not any(
                            q.is_symlink() for q in cand.parents if q == folder or folder in q.parents):
                        found = cand
                        break
                if found:
                    break
            if found is None:
                rep.skipped.append((rel, "not found in that folder"))
                continue
            try:
                if found.stat().st_size > (GLYPHS_MAX if rel == GLYPHS_REL else FONT_MAX):
                    raise FileError("too_large", "that file is larger than Mantel accepts", 413)
                data = found.read_bytes()
                if rel == GLYPHS_REL:
                    self.add_glyphs(data)
                else:
                    self.add_font(name, data)
                rep.imported.append(rel)
            except FileError as exc:
                rep.skipped.append((rel, f"{exc.code}: {exc}"))
            except OSError as exc:
                rep.skipped.append((rel, f"unreadable: {exc}"))
        return rep

    # -- the one-time import ----------------------------------------------------------------------
    def import_folder(self, folder: Path, *, images: Path | None = None, www: Path | None = None) -> ImportReport:
        """Copy today's Your files folder (and optionally HA's image store and www folder) in. Idempotent."""
        rep = ImportReport(dry_run=self.dry_run)

        def one(label: str, fn) -> None:
            try:
                fn()
                rep.imported.append(label)
            except FileError as exc:
                rep.skipped.append((label, f"{exc.code}: {exc}"))
            except OSError as exc:
                rep.skipped.append((label, f"unreadable: {exc}"))

        for base, dirs, names in os.walk(folder, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith(".") and not (Path(base) / d).is_symlink())
            for n in sorted(names):
                p = Path(base) / n
                rel = p.relative_to(folder).as_posix()
                if n.startswith(".") or p.is_symlink() or not p.is_file():
                    rep.skipped.append((rel, "hidden or not a regular file"))
                    continue
                ext = p.suffix.lower()
                if rel.startswith("fonts/") and rel.count("/") == 1 and ext in (".woff2", ".ttf", ".otf"):
                    one(rel, lambda p=p, n=n: self.add_font(n, p.read_bytes()))
                elif rel == GLYPHS_REL:
                    one(rel, lambda p=p: self.add_glyphs(p.read_bytes()))
                elif ext in EXT_FORMAT:
                    one(rel, lambda p=p, rel=rel: self.add_image_at(self.hk, rel, p.read_bytes()))
                else:
                    rep.skipped.append((rel, "not imported: Mantel serves only fonts, the glyph file and images from "
                                             "Your files (no scripts, styles, pages or video)"))
        if images is not None:                                  # HA's image_upload store: <id>/original
            for d in sorted(Path(images).iterdir()) if Path(images).is_dir() else []:
                orig = d / "original"
                if PHOTO_ID.match(d.name) and orig.is_file() and not orig.is_symlink():
                    one(f"image/{d.name}", lambda orig=orig, pid=d.name: self.add_photo(orig.read_bytes(), pid))
        if www is not None:                                     # /config/www images that settings point at as /local/
            for base, dirs, names in os.walk(www, followlinks=False):
                dirs[:] = sorted(d for d in dirs if not d.startswith(".") and not (Path(base) / d).is_symlink())
                for n in sorted(names):
                    p = Path(base) / n
                    if p.suffix.lower() in EXT_FORMAT and not p.is_symlink() and p.is_file():
                        rel = p.relative_to(www).as_posix()
                        one(f"www/{rel}", lambda p=p, rel=rel: self.add_image_at(self.local, rel, p.read_bytes()))
        return rep


# -- REST and serving -------------------------------------------------------------------------------
def _json(_status: int, **body) -> web.Response:
    return web.json_response(body, status=_status, headers={"Cache-Control": "no-store"})


def _fail(exc: FileError) -> web.Response:
    return _json(exc.status, error=exc.code, message=str(exc))


async def read_upload(request: web.Request, cap: int) -> tuple[bytes, str | None, dict]:
    """The multipart ``file`` field (bounded while it streams in), its file name, and the small text fields."""
    if not request.content_type.startswith("multipart/"):
        raise FileError("multipart_required", "send the file as multipart/form-data", 415)
    if request.content_length is not None and request.content_length > cap + (1 << 20):
        raise FileError("too_large", f"that is bigger than the {cap >> 20} MB limit", 413)
    reader = await request.multipart()
    data = filename = None
    fields: dict[str, str] = {}
    while True:
        part = await reader.next()
        if part is None:
            break
        if part.name == "file" and data is None:
            filename, buf = part.filename, bytearray()
            if filename and "%" in filename:                    # clients that percent-encode the name (curl -F does not)
                filename = unquote(filename)
            while True:
                chunk = await part.read_chunk(1 << 16)
                if not chunk:
                    break
                buf += chunk
                if len(buf) > cap:
                    raise FileError("too_large", f"that is bigger than the {cap >> 20} MB limit", 413)
            data = bytes(buf)
        elif part.name in ("name",):
            fields[part.name] = (await part.read(decode=True)).decode("utf-8", "replace")[:200]
    if not data:
        raise FileError("file_required", "no file was sent in the 'file' field")
    return data, filename, fields


def _store(request: web.Request) -> UserFiles:
    return request.app["user_files"]


async def _in_thread(fn, *args, heavy: bool = False):
    """``fn`` in a worker thread. ``heavy`` (decoding a picture) takes its turn in imaging.py's image slot first."""
    if heavy:
        return await imaging.run(fn, *args)
    return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


async def stage_photo(store: UserFiles, data: bytes) -> tuple[Callable[[], None], dict]:
    """An uploaded photo, re-encoded by the image worker (one picture at a time with Mantel Photos'), and its
    write: the server writes it (after the audit row), the worker only turns bytes into bytes."""
    if len(data) > PHOTO_MAX:
        raise FileError("too_large", f"photos are limited to {PHOTO_MAX >> 20} MB", 413)
    try:
        encoded = await imaging.run(reencode_photo, data)
    except imaging.WorkerLost as exc:                   # it died on this one (out of memory, a decoder crash)
        raise FileError("photo_invalid", "that picture could not be read", 415) from exc
    return await _in_thread(lambda: store.prepare_photo(data, None, encoded=encoded))


# Your Files: an Owner or Admin (never at a wall tablet); every change audited before it is written
@guard("manager", reads="admin")
async def api_list(request: web.Request) -> web.Response:
    return _json(200, ok=True, **await _in_thread(_store(request).listing),
                 limits={"font": FONT_MAX, "glyphs": GLYPHS_MAX, "photo": PHOTO_MAX})


@guard("manager", audit=("user_files.upload.font", "user_files.upload.glyphs", "user_files.upload.photo"))
async def api_upload(request: web.Request) -> web.Response:
    ident = guarded(request)
    kind = request.match_info["kind"]
    caps = {"font": FONT_MAX, "glyphs": GLYPHS_MAX, "photo": PHOTO_MAX}
    if kind not in caps:
        return _json(404, error="unknown_kind")
    try:
        data, filename, fields = await read_upload(request, caps[kind])
        store = _store(request)
        if kind == "font":
            write, result = await _in_thread(store.prepare_font, fields.get("name") or filename, data)
        elif kind == "glyphs":
            write, result = await _in_thread(store.prepare_glyphs, data)
        else:
            write, result = await stage_photo(store, data)
    except FileError as exc:
        return _fail(exc)
    audit.config(request, ident, f"user_files.upload.{kind}", {"name": result["name"], "size": result["size"]})
    try:
        await _in_thread(write)
    except FileError as exc:                 # (the folder filled meanwhile)
        return _fail(exc)
    return _json(201, ok=True, **result)


@guard("manager", audit=("user_files.delete.font", "user_files.delete.glyphs", "user_files.delete.photo"))
async def api_delete(request: web.Request) -> web.Response:
    ident = guarded(request)
    kind, name = request.match_info["kind"], request.match_info["name"]
    if kind not in ("font", "glyphs", "photo"):
        return _json(404, error="unknown_kind")
    path = await _in_thread(_store(request).locate, kind, name)
    if path is None:
        return _json(404, error="not_found")
    audit.config(request, ident, f"user_files.delete.{kind}", {"name": name})
    await _in_thread(path.unlink)
    return _json(200, ok=True, removed=True)


@guard("manager", audit="user_files.upload.photo")
async def image_upload(request: web.Request) -> web.Response:
    """HA's ``POST /api/image/upload`` contract (multipart ``file`` -> ``{id}``) so HK Settings' photo upload
    works unchanged; the answer carries the URL HK then stores."""
    ident = guarded(request)
    try:
        data, _, _ = await read_upload(request, PHOTO_MAX)
        write, result = await stage_photo(_store(request), data)
    except FileError as exc:
        return _fail(exc)
    audit.config(request, ident, "user_files.upload.photo", {"id": result["id"], "size": result["size"]})
    try:
        await _in_thread(write)
    except FileError as exc:
        return _fail(exc)
    return _json(200, ok=True, id=result["id"], url=result["url"], content_type=result["type"],
                 filesize=result["size"])


@guard("manager", audit="user_files.delete.photo")
async def image_delete(request: web.Request) -> web.Response:
    ident = guarded(request)
    pid = request.match_info["id"]
    path = await _in_thread(_store(request).locate, "photo", pid)
    if path is None:
        return _json(404, error="not_found")
    audit.config(request, ident, "user_files.delete.photo", {"id": pid})
    await _in_thread(path.unlink)
    return _json(200, ok=True, removed=True)


def _send(path: Path) -> web.FileResponse:
    resp = web.FileResponse(path, headers=NOCACHE)
    resp.content_type = EXT_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return resp


@guard("signed_in", reads="none",
       why="an uploaded picture a screen draws (a background), by an unguessable id: no house state",
       preview=True, stream="bounded:one uploaded picture")   # a screen's background or screensaver photo: any session's page shows it
async def image_serve(request: web.Request) -> web.StreamResponse:
    path = _store(request).photo_path(request.match_info["id"])
    if path is None:
        raise web.HTTPNotFound()
    return _send(path)


@web.middleware
async def serve_user_files(request: web.Request, handler):
    """Answer /hk/<path> and /local/<path> from the uploaded files when they have it; otherwise pass on
    (HK's bundled frontend, ``cfg.hk_files``). Placed after the sign-in middleware, so only signed-in
    requests get here, and independent of the order routes were added in."""
    if request.method in ("GET", "HEAD"):
        path = request.path
        if path.startswith("/hk/"):
            base, rel = request.app["user_files"].hk, path[4:]
        elif path.startswith("/local/"):
            base, rel = request.app["user_files"].local, path[7:]
        else:
            return await handler(request)
        found = UserFiles.resolve(base, rel)
        if found is not None:
            return _send(found)
    return await handler(request)


def register(app: web.Application, hub=None) -> None:
    """Add the store, the upload/list/delete REST, HA's image upload/serve contract and the /hk + /local
    serving. Call it while the app is being built (before it starts)."""
    app["user_files"] = UserFiles(app["cfg"].user_files_dir)
    app.middlewares.append(serve_user_files)
    r = app.router
    r.add_get("/api/user-files", api_list)
    r.add_post("/api/user-files/{kind}", api_upload)
    r.add_delete("/api/user-files/{kind}/{name}", api_delete)
    r.add_post("/api/image/upload", image_upload)
    r.add_get(r"/api/image/serve/{id:[0-9a-f]{32}}/{size:[A-Za-z0-9x]+}", image_serve)
    r.add_delete(r"/api/image/{id:[0-9a-f]{32}}", image_delete)


# -- CLI --------------------------------------------------------------------------------------------
def cli_import(argv: list[str]) -> int:
    """``mantel-server import-files FOLDER``: the one-time move of today's Your files folder."""
    from .config import Config
    p = argparse.ArgumentParser(prog="mantel-server import-files", description=cli_import.__doc__)
    p.add_argument("folder", help="the Your files folder (fonts/, iconset/, other images), e.g. a copy of /config/hk_local")
    p.add_argument("--images", metavar="DIR", help="Home Assistant's image_upload store (/config/image): "
                                                    "background and screensaver photos keep their /api/image/serve/<id> address")
    p.add_argument("--www", metavar="DIR", help="Home Assistant's www folder: its images are served at /local/<path>")
    p.add_argument("--data-dir", default=str(Config.data_dir))
    p.add_argument("--dry-run", action="store_true", help="check everything, write nothing")
    a = p.parse_args(argv)
    for label, d in (("folder", a.folder), ("--images", a.images), ("--www", a.www)):
        if d and not Path(d).expanduser().is_dir():
            print(f"mantel-server: {label}: {d} is not a folder", file=sys.stderr)
            return 2
    store = UserFiles(Path(a.data_dir).expanduser() / "user-files", dry_run=a.dry_run)
    rep = store.import_folder(Path(a.folder).expanduser(), images=Path(a.images).expanduser() if a.images else None,
                              www=Path(a.www).expanduser() if a.www else None)
    for item in rep.imported:
        print(("would import  " if a.dry_run else "imported     ") + item)
    for item, why in rep.skipped:
        print(f"skipped      {item}  ({why})")
    print(f"{len(rep.imported)} {'would be ' if a.dry_run else ''}imported, {len(rep.skipped)} skipped"
          + ("" if a.dry_run else f"; the files are in {store.root}"))
    return 0


def cli_files(argv: list[str]) -> int:
    """``mantel files import-assets FOLDER``: supply SF Pro and HK's glyph set once, from a copy of them."""
    from .config import Config
    p = argparse.ArgumentParser(prog="mantel files", description=cli_files.__doc__)
    sub = p.add_subparsers(dest="action", required=True)
    ia = sub.add_parser("import-assets", help="pick SF-Pro.woff2, SF-Pro.ttf and hk-glyphs.js out of a folder")
    ia.add_argument("folder", help="a copy of Home Assistant's www/hk or custom_components/hk_frontend/frontend "
                                   "folder (fonts/ and iconset/ inside), or any folder holding the files")
    ia.add_argument("--data-dir", default=str(Config.data_dir))
    ia.add_argument("--dry-run", action="store_true", help="check everything, write nothing")
    a = p.parse_args(argv)
    folder = Path(a.folder).expanduser()
    if not folder.is_dir():
        print(f"mantel files: {a.folder} is not a folder", file=sys.stderr)
        return 2
    store = UserFiles(Path(a.data_dir).expanduser() / "user-files", dry_run=a.dry_run)
    rep = store.import_assets(folder)
    for item in rep.imported:
        print(("would import  " if a.dry_run else "imported     ") + item)
    for item, why in rep.skipped:
        print(f"skipped      {item}  ({why})")
    print(f"{len(rep.imported)} {'would be ' if a.dry_run else ''}imported, {len(rep.skipped)} skipped"
          + ("" if a.dry_run else f"; the files are in {store.root}"))
    return 0 if rep.imported else 1
