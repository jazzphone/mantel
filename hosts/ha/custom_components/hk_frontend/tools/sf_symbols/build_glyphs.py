"""Build hk-glyphs.js -- the hk: iconset's glyph data -- from YOUR SF Symbols.

    pip install svgpathtools            (macOS, with the SF Symbols app installed)
    python3 build_glyphs.py --out /config/<your files folder>/iconset/hk-glyphs.js

The hk: icons are Apple's SF Symbols, which cannot ship with the integration.
This makes your own copy: for every glyph, manifest.json names the SF symbol
it is drawn from (and, for a few, how it is cut or scaled), the SF Symbols
app's own CLI exports it, and sfsvg.py fits it into the set's 24x24 box.

    --check <existing hk-glyphs.js>   compare instead of writing: every glyph's
                                      distance from the existing file (0 = the
                                      same drawing), exit 1 if any differs
    --cache <dir>                     where exports are kept (default ./.sfcache)

manifest.json entries:
    {"symbol": "lightbulb.fill"}                 an SF symbol, all layers
    {"symbol": "...", "scale": 0.868}            ...then scaled about the center
    {"path": "M ..."}                            not Apple artwork (Material
                                                 Design Icons, Apache-2.0): the
                                                 path itself ships here
two-tone ("twotone"):
    {"symbol": "...", "primary": [..], "secondary": [..]}   layer indices
    {"symbol": "hifispeaker.fill", "op": "speaker"}          see speaker()
weather ("weather"): SF symbol names, drawn MULTICOLOR by hk-header.js -- see
    weather() below
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sfsvg  # noqa: E402

# The speaker's drivers: discs at 0.660 of the drawn rings, holes one GAP wider
# cut into the cabinet so the tile shows through between them -- the HomePod
# glyph's measured shell-to-cap gap.
SPEAKER_K, SPEAKER_GAP = 0.660, 1.420


def _scaled(transform, s):
    if not s:
        return transform
    k, dx, dy = transform
    return (k * s, 12 - (12 - dx) * s, 12 - (12 - dy) * s)


def _area(path) -> float:
    pts = [seg.point(t / 20) for seg in path for t in range(20)]
    return sum(pts[i].real * pts[(i + 1) % len(pts)].imag -
               pts[(i + 1) % len(pts)].real * pts[i].imag for i in range(len(pts))) / 2


def icon(entry: dict, cache: str) -> str:
    if "path" in entry:
        return entry["path"]
    ls = sfsvg.layers(sfsvg.export(entry["symbol"], cache) or "")
    if not ls:
        raise SystemExit(f"SF symbol not found: {entry['symbol']} (a newer SF Symbols may rename it)")
    ds = [d for _, d in ls]
    return sfsvg.normalise(ds, _scaled(sfsvg.box_transform(ds), entry.get("scale")))


def twotone(entry: dict, cache: str) -> dict:
    ls = sfsvg.layers(sfsvg.export(entry["symbol"], cache) or "")
    if not ls:
        raise SystemExit(f"SF symbol not found: {entry['symbol']}")
    ds = [d for _, d in ls]
    tf = _scaled(sfsvg.box_transform(ds), entry.get("scale"))
    if entry.get("op") == "speaker":
        return speaker(ds, tf)
    return {"path": sfsvg.normalise([ds[i] for i in entry["primary"]], tf),
            "secondaryPath": sfsvg.normalise([ds[i] for i in entry["secondary"]], tf)}


def speaker(ds: list[str], tf) -> dict:
    """hifispeaker.fill -> bright driver discs over a dim cabinet with holes."""
    from svgpathtools import Path, parse_path
    cab = parse_path(sfsvg.normalise([ds[0]], tf))
    rings = parse_path(sfsvg.normalise([ds[1]], tf)).continuous_subpaths()
    outer = sorted(rings, key=lambda s: -(s.bbox()[1] - s.bbox()[0]))[:2]
    discs, holes = [], []
    for o in outer:
        x0, x1, y0, y1 = o.bbox()
        c, r = complex((x0 + x1) / 2, (y0 + y1) / 2), (x1 - x0) / 2
        discs.append(o.scaled(SPEAKER_K, SPEAKER_K, c))
        f = (r * SPEAKER_K + SPEAKER_GAP) / r
        hole = o.scaled(f, f, c)
        if (_area(hole) > 0) == (_area(cab) > 0):        # a hole winds the other way
            hole = hole.reversed()
        holes.append(hole)
    discs.sort(key=lambda p: -p.bbox()[2])
    return {"path": sfsvg.fmt(Path(*[s for d in discs for s in d])),
            "secondaryPath": sfsvg.fmt(Path(*list(cab) + [s for h in holes for s in h]))}


# THE WEATHER GLYPHS are not 24-box icons: the header, the Weather page and the
# menu draw them as inline SVG in Apple's MULTICOLOR rendering (a yellow sun, a
# white cloud, cyan rain), which an iconset cannot do. Each is kept as the
# export's own Regular-S layers, numbers rounded to 0.1, with its multicolor
# role taken from the layer's class -- `multicolor-0:systemYellowColor` is y,
# systemCyanColor c, anything else (white, tintColor) w -- and a 120-unit
# viewBox centered on the drawing, so every symbol keeps the size SF Symbols
# gives it relative to the others. [viewBox, [[role, d], ...]]
WX_ROLE = {"systemYellowColor": "y", "systemCyanColor": "c"}
_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def _r1(m) -> str:
    v = ("%.1f" % round(float(m.group(0)), 1)).rstrip("0").rstrip(".")
    return "0" if v == "-0" else v


def weather(symbol: str, cache: str) -> list:
    from svgpathtools import parse_path
    ls = sfsvg.layers(sfsvg.export(symbol, cache) or "")
    if not ls:
        raise SystemExit(f"SF symbol not found: {symbol}")
    xs, ys, out = [], [], []
    for cls, d in ls:
        x0, x1, y0, y1 = parse_path(d).bbox()
        xs += [x0, x1]; ys += [y0, y1]
        m = re.search(r"multicolor-\d+:(\w+)", cls)
        out.append([WX_ROLE.get(m.group(1) if m else "", "w"), _NUM.sub(_r1, d)])
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return ["%.1f %.1f 120 120" % (cx - 60, cy - 60), out]


HEADER = """// hk-glyphs.js -- THE GLYPH DATA for the hk: iconset. Apple artwork (SF Symbols),
// built from this Mac's SF Symbols app by
// custom_components/hk_frontend/tools/sf_symbols/build_glyphs.py. Personal use.
// Not part of the integration: it lives in your HK Frontend files folder and is
// served at /hk/iconset/hk-glyphs.js. The loader is iconset/hk-icons.js.
"""


def build(manifest: dict, cache: str) -> dict:
    return {"icons": {k: icon(v, cache) for k, v in manifest["icons"].items()},
            "twotone": {k: twotone(v, cache) for k, v in manifest["twotone"].items()},
            "weather": {k: weather(k, cache) for k in manifest.get("weather", [])}}


def write(g: dict, out: str) -> None:
    lines = [HEADER, '(typeof window !== "undefined" ? window : globalThis).hkGlyphs = {', "icons: {"]
    lines += [f'  {json.dumps(k)}: {json.dumps(v)},' for k, v in g["icons"].items()]
    lines += ["},", "twotone: {"]
    for k, v in g["twotone"].items():
        lines += [f"  {json.dumps(k)}: {{", f'    path: {json.dumps(v["path"])},',
                  f'    secondaryPath: {json.dumps(v["secondaryPath"])}', "  },"]
    lines += ["},", "weather: {"]
    lines += [f"  {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))}," for k, v in g["weather"].items()]
    lines += ["},", "};", ""]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    open(out, "w", encoding="utf-8").write("\n".join(lines))


def read_existing(path: str) -> dict:
    """window.hkGlyphs from an existing hk-glyphs.js, without a JS engine."""
    src = open(path, encoding="utf-8").read()
    icons = dict(re.findall(r'"([a-z0-9-]+)": "(M [^"]+)"', src))
    two = {}
    for name, body in re.findall(r'^\s+"([a-z0-9-]+)": \{(.*?)\n\s+\},', src, re.M | re.S):
        p = re.search(r'path: "([^"]+)"', body)
        s = re.search(r'secondaryPath: "([^"]+)"', body)
        if p and s:
            two[name] = {"path": p.group(1), "secondaryPath": s.group(1)}
    wx = {}
    i = src.find("\nweather: {")
    for name, body in re.findall(r'^\s+"([a-z.]+)": (\[.*\]),$', src[i:] if i >= 0 else "", re.M):
        wx[name] = json.loads(body)
    return {"icons": icons, "twotone": two, "weather": wx}


def check(g: dict, existing: str, tol: float) -> int:
    old = read_existing(existing)
    bad = 0
    for k, v in g["icons"].items():
        o = old["icons"].get(k)
        dist = 1e9 if o is None else (0.0 if o == v else sfsvg.distance(o, v))
        if dist > tol:
            bad += 1
            print(f"  DIFF  {k:32s} {dist:.5f}")
    for k, v in g["twotone"].items():
        o = old["twotone"].get(k)
        for part in ("path", "secondaryPath"):
            dist = 1e9 if o is None else sfsvg.distance(o[part], v[part])
            if dist > tol:
                bad += 1
                print(f"  DIFF  {k}.{part:24s} {dist:.5f}")
    for k, v in g["weather"].items():
        if old["weather"].get(k) != v:
            bad += 1
            print(f"  DIFF  weather {k}" + ("" if k in old["weather"] else " (missing from the file)"))
    missing = set(old["icons"]) - set(g["icons"])
    for k in sorted(missing):
        bad += 1
        print(f"  MISSING from the manifest: {k}")
    same = len(g["icons"]) + 2 * len(g["twotone"]) + len(g["weather"]) - bad
    print(f"{same} glyph paths match {existing} (tolerance {tol}), {bad} differ")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out")
    ap.add_argument("--check")
    ap.add_argument("--cache", default=os.path.join(HERE, ".sfcache"))
    ap.add_argument("--tolerance", type=float, default=0.005)
    a = ap.parse_args()
    if not a.out and not a.check:
        ap.error("give --out or --check")
    manifest = json.load(open(os.path.join(HERE, "manifest.json"), encoding="utf-8"))
    g = build(manifest, a.cache)
    if a.check:
        return check(g, a.check, a.tolerance)
    write(g, a.out)
    print(f"wrote {a.out}: {len(g['icons'])} glyphs, {len(g['twotone'])} two-tone, "
          f"{len(g['weather'])} weather")
    return 0


if __name__ == "__main__":
    sys.exit(main())
