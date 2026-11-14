"""THE APPLE TV CARD (phase 31, docs/phase31/PLAN.md "How Mantel draws the picture"): a notification as a 16:9 picture.

hk_core.notifications.tv says what the card says (its look, words, glyph and color); this module draws it as SVG,
1920 x 1080, and image_work.render_card turns the SVG into a JPEG in the image worker (resvg). The house's own Apple
assets are used, the ones its tablets draw with, read from Your Files (user_files.py):

    Fonts(hk_dir, cache_dir)    SF Pro: the home's SF-Pro.ttf, else its SF-Pro.woff2 unpacked once into the cache
                                (resvg reads TrueType, not WOFF2); without either, Inter (OFL, cameras/fonts/)
    Glyphs(hk_dir)              SF Symbols: the home's iconset/hk-glyphs.js, read as data (hk_core.your_files); without
                                it, a few glyphs drawn here (GLYPHS) stand in, as Material's do on the screens
    svg(card, fonts, glyphs, snapshot)   the card: Color, Black or Glass, or a camera's snapshot full bleed

Apple's files are never copied anywhere but the cache beside them on the data volume (rule 5), and never leave it.
Type is set for a corner of the TV: the title 168 px of 1080, the caption 62, the line 88; a long title shrinks to
its room (measured with the font itself, fontTools), the words were shortened by words before (tv.py).
"""
from __future__ import annotations

import base64
import logging
import threading
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from hk_core.notifications import tv as TV
from hk_core.your_files import AssetError, check_glyphs

log = logging.getLogger("mantel.tv_card")

W, H = 1920, 1080
INTER = Path(__file__).resolve().parent / "fonts" / "Inter.ttf"
FALLBACK_FAMILY = "Inter"

# the layout (the mockup's, docs/phase31/mockup/tv-alerts.html): the glyph's center, the words' left edge and lines
GX, GY, GLYPH, RING_GLYPH, RING_R, RING_W = 390, 530, 360, 240, 222, 28
X, RIGHT = 700, 110
CAPTION = (384, 62, 600)          # baseline, size, weight
TITLE = (566, 168, 700)
LINE = (694, 88, 500)
TITLE_TRACK = -3


# ----------------------------------------------------------------------------------------------- fonts
class Fonts:
    """The card's typeface: the home's SF Pro, else Inter. ``files`` for resvg, ``family`` for the SVG, ``width`` to
    measure a line. Looked up again when the home's font files change (an upload)."""

    def __init__(self, hk_dir: Path | None, cache_dir: Path | None) -> None:
        self.hk_dir, self.cache_dir = hk_dir, cache_dir
        self._lock = threading.Lock()
        self._key: tuple | None = None
        self.path: Path = INTER
        self.family = FALLBACK_FAMILY
        self.apple = False
        self._font: Any = None
        self._sets: dict[int, Any] = {}

    def _source(self) -> Path | None:
        if self.hk_dir is None:
            return None
        for name in ("SF-Pro.ttf", "SF-Pro.otf", "SF-Pro.woff2"):
            p = self.hk_dir / "fonts" / name
            if p.is_file():
                return p
        return None

    def _truetype(self, src: Path) -> Path:
        if src.suffix != ".woff2":
            return src
        assert self.cache_dir is not None
        out, mark = self.cache_dir / "SF-Pro.ttf", self.cache_dir / "SF-Pro.from"
        st = src.stat()
        made_from = f"{st.st_size}:{st.st_mtime_ns}"          # the upload it was unpacked from: any other is unpacked again
        if not out.is_file() or not mark.is_file() or mark.read_text() != made_from:
            from fontTools.ttLib import TTFont
            self.cache_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            f = TTFont(str(src))
            f.flavor = None
            tmp = out.with_suffix(".tmp")
            f.save(str(tmp))
            tmp.chmod(0o600)
            tmp.replace(out)
            mark.write_text(made_from)
        return out

    def refresh(self) -> None:
        src = self._source()
        try:
            key = (str(src), src.stat().st_mtime_ns) if src is not None else None
        except OSError:                                       # removed as it was looked at: Inter until the next card
            src, key = None, None
        with self._lock:
            if key == self._key and self._font is not None:
                return
            path, apple = INTER, False
            if src is not None and (src.suffix != ".woff2" or self.cache_dir is not None):
                try:
                    path, apple = self._truetype(src), True
                except Exception:  # noqa: BLE001 -- a font that won't unpack: Inter, said once
                    log.exception("tv card: the home's SF Pro could not be read; Inter stands in")
            from fontTools.ttLib import TTFont
            font = TTFont(str(path), lazy=True)
            self.path, self.apple, self._font, self._sets, self._key = path, apple, font, {}, key
            self.family = font["name"].getDebugName(16) or font["name"].getDebugName(1) or FALLBACK_FAMILY

    @property
    def files(self) -> list[str]:
        return [str(self.path)]

    def _glyphs(self, weight: int) -> Any:
        gs = self._sets.get(weight)
        if gs is None:
            axes = {a.axisTag for a in self._font["fvar"].axes} if "fvar" in self._font else set()
            gs = self._font.getGlyphSet(location={"wght": weight} if "wght" in axes else None)
            self._sets[weight] = gs
        return gs

    def width(self, text: str, size: float, weight: int, track: float = 0.0) -> float:
        """How wide `text` sets, in px (no kerning: a little wide, never narrow)."""
        if self._font is None:
            self.refresh()
        with self._lock:
            gs = self._glyphs(weight)
            cmap = self._font.getBestCmap() or {}
            upm = self._font["head"].unitsPerEm
            units = 0.0
            for ch in text:
                name = cmap.get(ord(ch)) or ".notdef"
                units += gs[name].width if name in gs else upm * 0.55
        return units * size / upm + track * max(0, len(text) - 1)


# ----------------------------------------------------------------------------------------------- glyphs
# Stand-ins where a home has no glyph file, on a 24 unit grid (drawn for Mantel): [(path, "f" fill | "s" stroke)]
GLYPHS: dict[str, list[tuple[str, str]]] = {
    "timer": [("M12 13.6m-7.6 0a7.6 7.6 0 1 0 15.2 0a7.6 7.6 0 1 0 -15.2 0", "s"), ("M9.8 2.6h4.4M12 2.6v3.4", "s"),
              ("M12 13.6l3.1-3.1", "s"), ("M18.4 6.2l1.3-1.3", "s")],
    "washer": [("M7 2.6h10a3 3 0 0 1 3 3v12.8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5.6a3 3 0 0 1 3-3z", "s"), ("M4 7.2h16", "s"),
               ("M12 14.4m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0", "s"), ("M9.3 15c.9-.9 1.8.9 2.7 0s1.8.9 2.7 0", "s")],
    "bell": [("M12 2.4c-3.6 0-6 2.8-6 6.3v3.6l-1.8 3.2c-.4.7.1 1.5.9 1.5h13.8c.8 0 1.3-.8.9-1.5L18 12.3V8.7c0-3.5-2.4-6.3-6-6.3z",
              "f"), ("M9.4 18.6a2.6 2.6 0 0 0 5.2 0z", "f")],
    "drop": [("M12 2.6C9 6.8 5.7 10.4 5.7 14.4a6.3 6.3 0 0 0 12.6 0c0-4-3.3-7.6-6.3-11.8z", "f")],
    "garage": [("M3 21V9.6L12 4l9 5.6V21", "s"), ("M6.6 21v-8.2h10.8V21", "s"), ("M6.6 15.6h10.8M6.6 18.3h10.8", "s")],
    "door": [("M6 21V4.2c0-.7.5-1.2 1.2-1.2h9.6c.7 0 1.2.5 1.2 1.2V21", "s"), ("M3.5 21h17", "s"),
             ("M14.6 12.4m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "f")],
    "shield": [("M12 2.6l7.4 2.8v6.2c0 4.6-3.1 8.2-7.4 9.8-4.3-1.6-7.4-5.2-7.4-9.8V5.4z", "f")],
    "person": [("M12 7.6m-3.6 0a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0", "f"),
               ("M4.6 20.4c.6-4 3.5-6.6 7.4-6.6s6.8 2.6 7.4 6.6z", "f")],
}
# which stand-in a glyph name (hk: or mdi:, named after Material's icons) falls back to
_STAND_IN = (("timer", "timer"), ("washing", "washer"), ("laundry", "washer"), ("tumble", "washer"), ("water", "drop"),
             ("leak", "drop"), ("garage", "garage"), ("door", "door"), ("shield", "shield"), ("alarm", "shield"),
             ("smoke", "shield"), ("walk", "person"), ("account", "person"), ("location", "person"))


class Glyphs:
    """The home's SF Symbols (iconset/hk-glyphs.js, read as data), else the stand-ins above."""

    def __init__(self, hk_dir: Path | None) -> None:
        self.hk_dir = hk_dir
        self._key: tuple | None = None
        self.icons: dict[str, str] = {}

    def refresh(self) -> None:
        p = self.hk_dir / "iconset" / "hk-glyphs.js" if self.hk_dir is not None else None
        key = (str(p), p.stat().st_mtime) if p is not None and p.is_file() else None
        if key == self._key:
            return
        self._key, self.icons = key, {}
        if key is None:
            return
        try:
            self.icons = dict(check_glyphs(p.read_bytes())["icons"])
        except (AssetError, OSError) as err:
            log.warning("tv card: the home's glyph file could not be read (%s); stand-ins are drawn", err)

    @property
    def apple(self) -> bool:
        return bool(self.icons)

    def draw(self, name: str, cx: float, cy: float, px: float, color: str) -> str:
        """The glyph centered on (cx, cy), `px` wide, in `color`, as SVG."""
        key = name.split(":", 1)[-1]
        s = px / 24
        head = f'<g transform="translate({cx - px / 2:.1f} {cy - px / 2:.1f}) scale({s:.4f})">'
        d = self.icons.get(key) or (self.icons.get("door-closed-lock") if key == "door-closed" else None)
        if d:
            return f'{head}<path d="{escape(d)}" fill="{color}"/></g>'
        stand = next((g for word, g in _STAND_IN if word in key), "bell")
        parts = [f'<path d="{p}" fill="{color}"/>' if mode == "f" else
                 f'<path d="{p}" fill="none" stroke="{color}" stroke-width="1.75" stroke-linecap="round" '
                 f'stroke-linejoin="round"/>' for p, mode in GLYPHS[stand]]
        return head + "".join(parts) + "</g>"


# ----------------------------------------------------------------------------------------------- the card
def _text(x: float, y: float, size: float, weight: int, fill: str, words: str, family: str, track: float = 0.0,
          opacity: float | None = None) -> str:
    extra = f' letter-spacing="{track:g}"' if track else ""
    extra += f' fill-opacity="{opacity:g}"' if opacity is not None else ""
    return (f'<text x="{x:g}" y="{y:g}" font-family="{escape(family)}" font-size="{size:.1f}" font-weight="{weight}" '
            f'fill="{fill}"{extra}>{escape(TV.clean(words))}</text>')


def _fit(fonts: Fonts, words: str, size: float, weight: int, room: float, track: float = 0.0) -> float:
    w = fonts.width(words, size, weight, track)
    return size if w <= room else max(size * 0.6, size * room / w)


def _wallpaper(color: str) -> str:
    """Glass's background: a dusk wallpaper with the accessory's color in it, blurred (the tablets' glass, at TV size)."""
    return ('<defs><linearGradient id="wp" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#1C2B52"/>'
            '<stop offset=".55" stop-color="#6A3F72"/><stop offset="1" stop-color="#D9845C"/></linearGradient>'
            '<filter id="bl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="70"/></filter>'
            f'</defs><rect width="{W}" height="{H}" fill="url(#wp)"/><g filter="url(#bl)">'
            f'<circle cx="1500" cy="260" r="330" fill="{color}" fill-opacity=".55"/>'
            '<circle cx="380" cy="880" r="420" fill="#3A6FB0" fill-opacity=".6"/>'
            '<circle cx="1080" cy="760" r="300" fill="#B25A8A" fill-opacity=".5"/></g>'
            '<rect x="72" y="72" width="1776" height="936" rx="88" fill="#1C1C20" fill-opacity=".56" '
            'stroke="#FFFFFF" stroke-opacity=".18" stroke-width="3"/>')


def _snapshot(card: dict[str, Any], fonts: Fonts, glyphs: Glyphs, jpeg: bytes) -> str:
    """A camera's notification: its snapshot full bleed, the words on a dark fade at the bottom."""
    data = base64.b64encode(jpeg).decode("ascii")
    fam = fonts.family
    title_size = _fit(fonts, card["title"], 112, 700, W - 320 - RIGHT, -2)
    line = " · ".join(p for p in (card["line"], card["caption"]) if p)
    return (f'<image href="data:image/jpeg;base64,{data}" x="0" y="0" width="{W}" height="{H}" '
            'preserveAspectRatio="xMidYMid slice"/>'
            '<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/>'
            '<stop offset="1" stop-color="#000" stop-opacity=".85"/></linearGradient></defs>'
            f'<rect y="600" width="{W}" height="480" fill="url(#fade)"/>'
            + glyphs.draw(card["glyph"], 190, 912, 150, "#FFFFFF")
            + _text(320, 900, title_size, 700, "#FFFFFF", card["title"], fam, -2)
            + _text(322, 990, _fit(fonts, line, 62, 500, W - 322 - RIGHT), 500, "#FFFFFF", line, fam, opacity=0.78))


def svg(card: dict[str, Any], fonts: Fonts, glyphs: Glyphs, snapshot: bytes | None = None) -> str:
    """The card as SVG (hk_core's ``tv.card`` in): Color, Black, Glass, or the camera's snapshot when it has one."""
    head = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
    if card.get("snapshot") and snapshot:
        return head + _snapshot(card, fonts, glyphs, snapshot) + "</svg>"
    color, look, fam = card["color"], card["look"], fonts.family
    caption_fill, caption_op, line_fill, glyph_fill, track_op = "#EBEBF5", 0.6, color, color, 0.22
    if look == "glass":
        body = _wallpaper(color)
        caption_op = 0.66
    elif look == "black":
        body = f'<rect width="{W}" height="{H}" fill="#000000"/>'
    else:
        # Color: the accessory's own color, darkened until white type reads on it (decision 8), with a soft highlight
        k = TV.darken(color)
        body = ('<defs><linearGradient id="cg" x1="0" y1="0" x2=".55" y2="1">'
                f'<stop offset="0" stop-color="{TV.shade(color, k)}"/>'
                f'<stop offset="1" stop-color="{TV.shade(color, min(0.9, k + 0.4))}"/></linearGradient>'
                '<radialGradient id="hl" cx="300" cy="120" r="1100" gradientUnits="userSpaceOnUse">'
                '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".22"/>'
                '<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient></defs>'
                f'<rect width="{W}" height="{H}" fill="url(#cg)"/><rect width="{W}" height="{H}" fill="url(#hl)"/>')
        caption_fill, caption_op, line_fill, glyph_fill, track_op = "#FFFFFF", 0.8, "#FFFFFF", "#FFFFFF", 0.28
    if card.get("critical") and look != "color":
        caption_fill, caption_op = color, None
    if card.get("kind") == "timer":
        body += (f'<circle cx="{GX}" cy="{GY}" r="{RING_R}" fill="none" stroke="{glyph_fill}" stroke-opacity="{track_op}" '
                 f'stroke-width="{RING_W}"/><circle cx="{GX}" cy="{GY}" r="{RING_R}" fill="none" stroke="{glyph_fill}" '
                 f'stroke-width="{RING_W}"/>' + glyphs.draw(card["glyph"], GX, GY, RING_GLYPH, glyph_fill))
    else:
        body += glyphs.draw(card["glyph"], GX, GY, GLYPH, glyph_fill)
    room = W - X - RIGHT
    y, size, weight = CAPTION
    body += _text(X, y, _fit(fonts, card["caption"], size, weight, room), weight, caption_fill, card["caption"], fam,
                  opacity=caption_op)
    y, size, weight = TITLE
    body += _text(X, y, _fit(fonts, card["title"], size, weight, room, TITLE_TRACK), weight, "#FFFFFF", card["title"],
                  fam, TITLE_TRACK)
    if card.get("line"):
        y, size, weight = LINE
        body += _text(X, y, _fit(fonts, card["line"], size, weight, room), weight, line_fill, card["line"], fam,
                      opacity=0.95 if look == "color" else None)
    return head + body + "</svg>"
