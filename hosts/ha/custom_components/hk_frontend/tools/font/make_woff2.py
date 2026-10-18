"""Make the SF Pro web font for your HK Frontend files folder.

    pip install fonttools brotli
    python3 make_woff2.py /Library/Fonts/SF-Pro.ttf  /config/<your folder>/fonts/SF-Pro.woff2

SF Pro is Apple's (developer.apple.com/fonts) and is not shipped with the
integration. Its variable SF-Pro.ttf works as-is -- drop it in
<folder>/fonts/ and the stylesheet uses it -- but it is large, and every
screen downloads it once. woff2 is the same font, Brotli-compressed: a
straight conversion, no subsetting, so every glyph and both variation axes
(wght 1-1000, opsz 17-28) survive and the family name stays "SF Pro".

It checks that before writing: a file that is not the VARIABLE SF Pro -- one
of the static SF-Pro-Display-*.otf cuts, say -- would render every weight the
dashboards use as one weight, and the variable SF-Pro-Italic.ttf would slant
every screen.

It runs anywhere Python does (Windows and Linux too): only the input has to
be Apple's SF-Pro.ttf, however you got it (docs/Making-Your-Files.md).
"""
import os
import sys


def main(src: str, dst: str) -> int:
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print("needs fonttools and brotli:  pip install fonttools brotli")
        return 2
    font = TTFont(src)
    family = font["name"].getDebugName(1) or ""
    axes = {a.axisTag: (a.minValue, a.maxValue) for a in font["fvar"].axes} if "fvar" in font else {}
    print(f"{os.path.basename(src)}: family {family!r}, axes {axes or 'none'}")
    if "wght" not in axes:
        print("not the variable SF Pro (no wght axis) -- use SF-Pro.ttf from Apple's download")
        return 1
    # SF-Pro-Italic.ttf is variable too, and its family is "SF Pro" as well:
    # converted, it would pass every check above and slant every screen.
    if ("OS/2" in font and font["OS/2"].fsSelection & 1) or ("post" in font and font["post"].italicAngle):
        print("that is the italic SF Pro -- use SF-Pro.ttf, the upright one")
        return 1
    if family != "SF Pro":
        print(f"warning: family is {family!r}; the stylesheet asks for 'SF Pro' by URL, so it still loads")
    font.flavor = "woff2"
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    font.save(dst)
    print(f"wrote {dst}: {os.path.getsize(src) / 1e6:.1f} MB -> {os.path.getsize(dst) / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1], sys.argv[2]))
