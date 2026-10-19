"""Draw Mantel's app icon (a mantelpiece with a warm hearth) at every size the web app and the Apple apps use.

Run: ~/.venvs/mantel/bin/python tools/make_app_icons.py
Writes web/app/icons/*.png (the Home Screen web app) and the AppIcon set in apple/ (the iPhone/iPad/Mac apps).
Original artwork drawn here with Pillow: no Apple glyph or font is used, so the files are safe to commit.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web/app/icons"
APPLE = ROOT / "apple/Mantel/Resources/Assets.xcassets/AppIcon.appiconset"
SS = 4  # supersampling


def draw(size: int, *, maskable: bool = False, transparent_corners: bool = False) -> Image.Image:
    n = size * SS
    top, bottom = (16, 22, 44), (40, 30, 58)
    col = Image.new("RGBA", (1, 256))
    for y in range(256):
        t = y / 255
        col.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    img = col.resize((n, n), Image.BILINEAR)
    d = ImageDraw.Draw(img)
    s = n / 1024
    inset = 0.1 if maskable else 0.0      # a maskable icon keeps its art inside the safe circle
    def r(x0, y0, x1, y1):
        k = 1 - 2 * inset
        return [(inset * 1024 + x0 * k) * s, (inset * 1024 + y0 * k) * s, (inset * 1024 + x1 * k) * s, (inset * 1024 + y1 * k) * s]
    # the hearth's glow, blurred, behind everything
    glow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse(r(330, 470, 694, 860), fill=(255, 140, 40, 200))
    glow = glow.filter(ImageFilter.GaussianBlur(70 * s))
    img.alpha_composite(glow)
    cream = (246, 239, 226, 255)
    shade = (214, 204, 188, 255)
    # the shelf
    d.rounded_rectangle(r(170, 300, 854, 362), radius=18 * s, fill=cream)
    d.rounded_rectangle(r(210, 362, 814, 392), radius=8 * s, fill=shade)
    # the two pillars
    d.rounded_rectangle(r(236, 392, 330, 812), radius=10 * s, fill=cream)
    d.rounded_rectangle(r(694, 392, 788, 812), radius=10 * s, fill=cream)
    # the hearth's floor
    d.rounded_rectangle(r(200, 812, 824, 846), radius=10 * s, fill=shade)
    # the flame
    d.ellipse(r(440, 600, 584, 800), fill=(255, 158, 48, 255))
    d.polygon([tuple(r(512, 470, 0, 0)[:2]), tuple(r(442, 690, 0, 0)[:2]), tuple(r(582, 690, 0, 0)[:2])],
              fill=(255, 158, 48, 255))
    d.ellipse(r(476, 680, 548, 790), fill=(255, 214, 120, 255))
    # a clock on the mantel (a mantel is where the clock sits)
    d.ellipse(r(462, 196, 562, 296), fill=cream)
    d.ellipse(r(474, 208, 550, 284), fill=(40, 34, 60, 255))
    d.line(r(512, 246, 512, 222)[:2] + r(512, 222, 0, 0)[:2], fill=cream, width=int(7 * s))
    d.line(r(512, 246, 0, 0)[:2] + r(532, 254, 0, 0)[:2], fill=cream, width=int(7 * s))
    out = img.resize((size, size), Image.LANCZOS)
    if transparent_corners:
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.2237), fill=255)
        out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out


def main() -> None:
    WEB.mkdir(parents=True, exist_ok=True)
    draw(180).convert("RGB").save(WEB / "apple-touch-icon.png", optimize=True)    # iOS masks it itself
    draw(192).save(WEB / "mantel-192.png", optimize=True)
    draw(512).save(WEB / "mantel-512.png", optimize=True)
    draw(512, maskable=True).save(WEB / "mantel-maskable-512.png", optimize=True)
    draw(96).save(WEB / "badge-96.png", optimize=True)
    # the Apple apps' AppIcon: one 1024 for iOS (the system makes the rest), the Mac's sizes with its corners
    APPLE.mkdir(parents=True, exist_ok=True)
    draw(1024).convert("RGB").save(APPLE / "icon-1024.png", optimize=True)
    images = [{"filename": "icon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}]
    for pt in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f"mac-{pt}@{scale}x.png"
            draw(pt * scale, transparent_corners=True).save(APPLE / name, optimize=True)
            images.append({"filename": name, "idiom": "mac", "scale": f"{scale}x", "size": f"{pt}x{pt}"})
    (APPLE / "Contents.json").write_text(json.dumps({"images": images, "info": {"author": "xcode", "version": 1}},
                                                    indent=2) + "\n")


if __name__ == "__main__":
    main()
