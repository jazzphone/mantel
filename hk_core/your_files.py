"""YOUR FILES' CHECKS, written once: the home's own copies of Apple's SF Pro and the SF Symbols glyph data.

Mantel Server takes them as uploads (hosts/server/mantel_server/storage/user_files.py) and a linked HK Frontend takes
them from Mantel over the link (hk_frontend/files_sync.py). Both check the bytes the same way, here:

* a font by its magic bytes and a sane table directory (``sniff_font``), and its name's extension must agree;
* the glyph file is PARSED as data -- never run -- shape-checked (``check_glyphs``), and written back out by
  ``render_glyphs``: the file a browser runs is the checker's own, never the bytes that arrived.

``LICENSED`` names the only Apple-licensed files HK references (web/hk/fonts/sf-pro.css and
web/hk/iconset/hk-icons.js), by their path under /hk/.

Plain Python, no Home Assistant import (tests/test_boundaries.py).
"""
from __future__ import annotations

import json
import re
import struct

FONT_MAX = 40 << 20
GLYPHS_MAX = 2 << 20
GLYPHS_REL = "iconset/hk-glyphs.js"
FONT_TYPES = {"woff2": "font/woff2", "ttf": "font/ttf", "otf": "font/otf"}
# the files HK asks for at /hk/<path>, Apple's, each home's own copy
LICENSED = ("fonts/SF-Pro.woff2", "fonts/SF-Pro.ttf", GLYPHS_REL)


class AssetError(Exception):
    """A refused file. ``code`` is stable (a page words it); ``status`` is the HTTP answer an upload gets."""

    def __init__(self, code: str, message: str, status: int = 415) -> None:
        super().__init__(message)
        self.code, self.status = code, status


# -- fonts ------------------------------------------------------------------------------------------
def sniff_font(data: bytes) -> str:
    """"woff2" | "ttf" | "otf" from the bytes, or AssetError(font_invalid)."""
    bad = AssetError("font_invalid", "that is not a woff2, ttf or otf font")
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
        raise AssetError("glyphs_invalid", "expected hk-glyphs.js as build_glyphs.py writes it, or JSON")
    out = []
    for n, seg in enumerate(re.split(r'("(?:[^"\\\n]|\\.)*")', body)):
        if n % 2:                                              # a string literal: data, kept as is
            out.append(seg)
            continue
        if _JS_OUTSIDE.search(seg):
            raise AssetError("glyphs_invalid", "the glyph file contains code, not just data")
        seg = _JS_BARE.sub(r'"\1":', seg)
        out.append(re.sub(r",(\s*[}\]])", r"\1", seg))
    try:
        return json.loads("".join(out))
    except ValueError as exc:
        raise AssetError("glyphs_invalid", "the glyph file is not valid glyph data") from exc


def _is_path(v: object) -> bool:
    return isinstance(v, str) and bool(_PATH.match(v))


def check_glyphs(data: bytes) -> dict:
    """Parse and shape-check a glyph file; returns {"icons","twotone","weather"} or AssetError."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AssetError("glyphs_invalid", "the glyph file is not UTF-8 text") from exc
    g = _glyph_data(text)
    bad = lambda why: AssetError("glyphs_invalid", f"the glyph file is not the shape HK expects: {why}")  # noqa: E731
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


MANTEL_WRITER = "Mantel Server's user_files.py"


def glyphs_header(writer: str = MANTEL_WRITER) -> str:
    return ("// hk-glyphs.js -- the hk: iconset's glyph data, supplied by this home (Apple's SF Symbols).\n"
            f"// Checked and written by {writer}; served at /hk/iconset/hk-glyphs.js.\n")


GLYPHS_HEADER = glyphs_header()


def render_glyphs(g: dict, writer: str = MANTEL_WRITER) -> bytes:
    """The canonical file: same shape build_glyphs.py writes, so HK's loader reads it unchanged."""
    lines = [glyphs_header(writer), '(typeof window !== "undefined" ? window : globalThis).hkGlyphs = {', "icons: {"]
    lines += [f"  {json.dumps(k)}: {json.dumps(v)}," for k, v in g["icons"].items()]
    lines += ["},", "twotone: {"]
    for k, v in g["twotone"].items():
        lines += [f"  {json.dumps(k)}: {{", f'    path: {json.dumps(v["path"])},',
                  f'    secondaryPath: {json.dumps(v["secondaryPath"])}', "  },"]
    lines += ["},", "weather: {"]
    lines += [f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}," for k, v in g["weather"].items()]
    lines += ["},", "};", ""]
    return "\n".join(lines).encode("utf-8")


def checked(rel: str, data: bytes, writer: str = MANTEL_WRITER) -> bytes:
    """One of ``LICENSED``, checked by its bytes: the bytes to write (a font as it is; the glyph file as
    ``render_glyphs`` writes it), or AssetError."""
    if rel not in LICENSED:
        raise AssetError("not_licensed", "only SF Pro and the SF Symbols glyph file are taken", 400)
    if rel == GLYPHS_REL:
        if len(data) > GLYPHS_MAX:
            raise AssetError("too_large", f"the glyph file is limited to {GLYPHS_MAX >> 20} MB", 413)
        return render_glyphs(check_glyphs(data), writer)
    if len(data) > FONT_MAX:
        raise AssetError("too_large", f"fonts are limited to {FONT_MAX >> 20} MB", 413)
    kind = sniff_font(data)
    if not rel.lower().endswith("." + kind):
        raise AssetError("font_type_mismatch", f"the file is a {kind} font but its name says otherwise")
    return data
