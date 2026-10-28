#!/usr/bin/env python3
"""Draw the store logos: the integrations' brand/ logos and the Apps' logo.png (and Mantel Connect's icon).

    python tools/make_brand_logos.py [--font PATH]        # needs Pillow; writes the files listed below
    python tools/make_brand_logos.py --check              # only say whether the files on disk are what this would write

Home Assistant (2026.3 and later) reads a custom integration's own images from its brand/ folder, with the
file names and sizes of the brands repository (home-assistant/brands): icon.png 256x256 and icon@2x.png 512x512
(square), logo.png and logo@2x.png (landscape, the shortest side 128-256 px and 256-512 px; "the maximum allowed
size is preferred"), and dark_ versions for a dark background. A missing logo.png is served as icon.png; a missing
dark_ image as its light one. The icons exist already (the integrations' own); this draws what was missing, a
HORIZONTAL logo: the icon, then the product's name, trimmed to its pixels on a transparent background:

    hosts/ha/custom_components/hk_frontend/brand/{logo,logo@2x,dark_logo,dark_logo@2x}.png     "HK Frontend"
    hosts/ha/custom_components/mantel/brand/{logo,logo@2x,dark_logo,dark_logo@2x}.png          "Mantel Link"
    packaging/ha-app/logo.png          250x100: the Home Assistant App store's size, "Mantel"
    packaging/connect-app/icon.png     the Mantel icon with a link badge: Mantel Connect is a different App
    packaging/connect-app/logo.png     250x100, "Mantel Connect"

The two-tone name (dark on a light page, light on a dark one) is why the integrations have dark_ files; the App
store has one logo.png for both themes, so its name is a mid grey that reads on either.

The name is set in Bitstream Vera Sans Bold, whose licence lets its letter shapes be redistributed; no system font
(Apple's among them) is used. The font file is not in the repository, only the pixels drawn from it. --font names
it; otherwise the copy in an installed reportlab or matplotlib is used.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
HA = ROOT / "hosts/ha/custom_components"
# the brand icons, drawn at 512 and 256
ICON_512 = {"hk_frontend": HA / "hk_frontend/brand/icon@2x.png", "mantel": HA / "mantel/brand/icon@2x.png"}
INK = {"light": (28, 28, 30, 255), "dark": (242, 242, 247, 255), "store": (118, 118, 128, 255)}
H = 512                       # the @2x height; the 1x logo is drawn from it at 256
GAP = 0.15                    # between icon and name, in icon heights
NAME_SIZE = 0.40              # the name's font size, in icon heights
STORE = (250, 100)            # Home Assistant's App store logo


def find_font() -> str:
    names = ("VeraBd.ttf", "DejaVuSans-Bold.ttf")
    roots: list[Path] = []
    for mod in ("reportlab", "matplotlib"):
        try:
            module = __import__(mod)
        except ImportError:
            continue
        base = Path(module.__file__).parent
        roots += [base / "fonts", base / "mpl-data/fonts/ttf"]
    for r in roots:
        for n in names:
            if (r / n).is_file():
                return str(r / n)
    raise SystemExit("no font: pass --font PATH to Bitstream Vera Sans Bold (VeraBd.ttf) or DejaVu Sans Bold")


def logo(icon: Image.Image, name: str, ink: tuple[int, ...], font_path: str) -> Image.Image:
    """The icon at H px high, then the name, centred on the icon's height; as wide as that takes."""
    icon = icon.convert("RGBA")
    icon = icon.crop(icon.getchannel("A").getbbox()).resize((H, H), Image.LANCZOS)     # trimmed: no empty margin
    font = ImageFont.truetype(font_path, round(H * NAME_SIZE))
    left, top, right, bottom = font.getbbox(name)           # the name's ink
    gap = round(H * GAP)
    out = Image.new("RGBA", (H + gap + (right - left) + H // 8, H), (0, 0, 0, 0))   # room: the ink decides the width
    out.alpha_composite(icon, (0, 0))
    ImageDraw.Draw(out).text((H + gap - left, (H - (bottom - top)) // 2 - top), name, font=font, fill=ink)
    x0, y0, x1, y1 = out.getchannel("A").getbbox()           # trimmed to the pixels drawn, an even width
    return out.crop((x0, y0, x1 - (x1 - x0) % 2, y1))


def at_height(img: Image.Image, h: int) -> Image.Image:
    return img.resize((round(img.width * h / img.height), h), Image.LANCZOS)


def in_box(img: Image.Image, box: tuple[int, int]) -> Image.Image:
    """Fitted inside box (as large as fits), centred on a transparent canvas of exactly that size."""
    k = min(box[0] / img.width, box[1] / img.height)
    small = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    out = Image.new("RGBA", box, (0, 0, 0, 0))
    out.alpha_composite(small, ((box[0] - small.width) // 2, (box[1] - small.height) // 2))
    return out


def link_badge(icon: Image.Image) -> Image.Image:
    """Mantel's icon with a link (two rings) in a cream disc at its bottom right: Mantel Connect."""
    s = 4                                                    # supersampling
    n = 512 * s
    base = icon.convert("RGBA").resize((n, n), Image.LANCZOS)
    d = ImageDraw.Draw(base)
    cx, cy, rad = 398 * s, 398 * s, 104 * s
    d.ellipse([cx - rad - 10 * s, cy - rad - 10 * s, cx + rad + 10 * s, cy + rad + 10 * s], fill=(16, 22, 44, 255))
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(246, 239, 226, 255))
    ring = (250, 125, 45, 255)                               # the flame's orange
    w = 17 * s
    for dx in (-27, 27):
        x, y, r = cx + dx * s, cy, 37 * s
        d.ellipse([x - r, y - r, x + r, y + r], outline=ring, width=w)
    return base.resize((512, 512), Image.LANCZOS)


def outputs(font_path: str) -> dict[Path, Image.Image]:
    files: dict[Path, Image.Image] = {}
    for domain, name in (("hk_frontend", "HK Frontend"), ("mantel", "Mantel Link")):
        icon = Image.open(ICON_512[domain])
        for theme, prefix in (("light", ""), ("dark", "dark_")):
            big = logo(icon, name, INK[theme], font_path)
            files[HA / domain / "brand" / f"{prefix}logo@2x.png"] = big
            files[HA / domain / "brand" / f"{prefix}logo.png"] = at_height(big, H // 2)
    mantel_icon = Image.open(ICON_512["mantel"])
    files[ROOT / "packaging/ha-app/logo.png"] = in_box(logo(mantel_icon, "Mantel", INK["store"], font_path), STORE)
    connect_icon = link_badge(mantel_icon)
    files[ROOT / "packaging/connect-app/icon.png"] = connect_icon.resize((128, 128), Image.LANCZOS)
    files[ROOT / "packaging/connect-app/logo.png"] = in_box(logo(connect_icon, "Mantel Connect", INK["store"],
                                                                 font_path), STORE)
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--font")
    ap.add_argument("--check", action="store_true", help="compare pixels with the files on disk, write nothing")
    a = ap.parse_args()
    files = outputs(a.font or find_font())
    stale = []
    for path, img in sorted(files.items()):
        if a.check:
            if not path.is_file() or Image.open(path).convert("RGBA").tobytes() != img.tobytes():
                stale.append(path)
            continue
        img.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {img.width}x{img.height}")
    for path in stale:
        print(f"differs: {path.relative_to(ROOT)}")
    return 1 if stale else 0


if __name__ == "__main__":
    sys.exit(main())
