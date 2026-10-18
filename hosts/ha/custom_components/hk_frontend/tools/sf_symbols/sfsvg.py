"""SF Symbols export -> the hk: iconset's 24x24 glyph path. The shared core of
build_glyphs.py. Needs macOS with the SF Symbols app, and svgpathtools
(pip install svgpathtools).

THE NORMALIZATION:
  * take the paths inside <g id="Regular-S"> of `sfsymbols export --format svg`;
  * concatenate them (a hierarchical symbol exports one path per layer; the
    set is single-path monochrome unless a glyph is two-tone);
  * scale about the bounding-box center so the LONGEST axis is 21, and move
    that center to (12, 12);
  * NO y-flip: the export's y values are negative (baseline-relative) but the
    winding is already SVG y-down.
"""
from __future__ import annotations

import os
import re
import subprocess

CLI_CANDIDATES = [
    "/Applications/SF Symbols.app/Contents/Executables/sfsymbols",
    "/Applications/SF Symbols Beta.app/Contents/Executables/sfsymbols",
]


def cli() -> str:
    for c in [os.environ.get("SFSYMBOLS_CLI", "")] + CLI_CANDIDATES:
        if c and os.path.exists(c):
            return c
    raise SystemExit("sfsymbols CLI not found: install the SF Symbols app "
                     "(developer.apple.com/sf-symbols) or set SFSYMBOLS_CLI")


def export(symbol: str, cache: str) -> str | None:
    """The symbol's SVG text, exported once into `cache`. None if unknown."""
    os.makedirs(cache, exist_ok=True)
    out = os.path.join(cache, symbol + ".svg")
    if not os.path.exists(out):
        r = subprocess.run([cli(), "export", symbol, "--format", "svg", "--output", out],
                           capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(out):
            return None
    return open(out, encoding="utf-8").read()


def layers(svg: str) -> list[tuple[str, str]]:
    """[(class, d)] for every path in the Regular-S group, in order."""
    i = svg.find('id="Regular-S"')
    if i < 0:
        return []
    j = svg.find("</g>", i)
    return re.findall(r'<path class="([^"]*)" d="([^"]*)"', svg[i:j])


def _num(v: float) -> str:
    return "%.12g" % float(v)             # the set's own precision


def fmt(path) -> str:
    """A svgpathtools Path as the set writes it: absolute M/L/C/Z."""
    from svgpathtools import CubicBezier, Line, QuadraticBezier
    out, pos = [], None
    for seg in path:
        if pos is None or abs(seg.start - pos) > 1e-9:
            if pos is not None:
                out.append("Z")
            out.append(f"M {_num(seg.start.real)},{_num(seg.start.imag)}")
        if isinstance(seg, Line):
            out.append(f"L {_num(seg.end.real)},{_num(seg.end.imag)}")
        elif isinstance(seg, CubicBezier):
            out.append("C " + " ".join(f"{_num(p.real)},{_num(p.imag)}"
                                       for p in (seg.control1, seg.control2, seg.end)))
        elif isinstance(seg, QuadraticBezier):
            c1 = seg.start + 2 / 3 * (seg.control - seg.start)
            c2 = seg.end + 2 / 3 * (seg.control - seg.end)
            out.append("C " + " ".join(f"{_num(p.real)},{_num(p.imag)}" for p in (c1, c2, seg.end)))
        else:                                    # arcs do not occur in SF exports
            out.append(f"L {_num(seg.end.real)},{_num(seg.end.imag)}")
        pos = seg.end
    out.append("Z")
    return " ".join(out)


def box_transform(ds: list[str]):
    """(scale, dx, dy) that fits these paths together into the 24 box."""
    from svgpathtools import parse_path
    xs, ys = [], []
    for d in ds:
        p = parse_path(d)
        x0, x1, y0, y1 = p.bbox()
        xs += [x0, x1]; ys += [y0, y1]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    k = 21.0 / max(w, h)
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    return k, 12 - cx * k, 12 - cy * k


def normalise(ds: list[str], transform=None) -> str:
    """Concatenated paths, fitted into the 24 box (or by a given transform)."""
    from svgpathtools import parse_path
    k, dx, dy = transform or box_transform(ds)
    segs = []
    for d in ds:
        p = parse_path(d).scaled(k).translated(complex(dx, dy))
        segs.extend(p)
    from svgpathtools import Path
    return fmt(Path(*segs))


def glyph(symbol: str, cache: str) -> str | None:
    """One symbol, all layers, normalised. None if the symbol is unknown."""
    svg = export(symbol, cache)
    if not svg:
        return None
    ls = layers(svg)
    return normalise([d for _, d in ls]) if ls else None


def samples(d: str, n: int = 240):
    """Points along a path, evenly by parameter per segment -- for matching."""
    from svgpathtools import parse_path
    p = parse_path(d)
    if not len(p):
        return []
    per = max(2, n // len(p))
    return [seg.point(t / per) for seg in p for t in range(per)]


def distance(a: str, b: str) -> float:
    """Symmetric mean nearest-point distance between two paths, in box units."""
    import numpy as np
    pa, pb = np.array(samples(a)), np.array(samples(b))
    if not len(pa) or not len(pb):
        return 1e9
    dab = np.abs(pa[:, None] - pb[None, :])
    return float((dab.min(axis=1).mean() + dab.min(axis=0).mean()) / 2)
