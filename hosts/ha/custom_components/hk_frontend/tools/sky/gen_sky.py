"""Generate the hk-sky textures. Pure Python -- no PIL, no numpy, no downloads.

WHY GENERATED AND NOT SOURCED
Apple's own sky is a Metal shader over fBm noise; there is no image to copy,
and a stock sky PHOTOGRAPH would fight the translucent glass plates for
contrast and would not tile or recolor. Noise generated here is tuned to the
sky's own palette, tiles seamlessly, and costs nothing to license.

OUTPUT (all tileable, all written to custom_components/hk_frontend/frontend/sky/)
  clouds-a.png   grey+alpha, low frequency   distant haze layer
  clouds-b.png   grey+alpha, mid frequency   main cloud deck
  clouds-c.png   grey+alpha, high frequency  near detail / parallax
               (then cloud_webp.py re-encodes the three cloud PNGs as lossless
               clouds-{a,b,c}.webp -- alpha bit-identical -- which is what
               hk-sky.js loads; the PNGs stay as the canonical pixels)
  stars.png      RGBA                        night star field
  flakes.png     RGBA                        snow
  rain.png       RGBA                        rain streaks, near and far

The cloud textures carry shape in the ALPHA channel only (luminance is a flat
255). They are used as CSS mask-image over a gradient-filled div, so the SAME
texture recolors itself from white noon cumulus to pink sunset to grey storm
without needing a variant per condition.
"""
import zlib, struct, math, random, os

_UP = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
# the component's own tools/sky, or the repository's tools/sky beside
# custom_components/hk_frontend
_COMPONENT = (os.path.join(_UP, "custom_components", "hk_frontend")
              if os.path.isdir(os.path.join(_UP, "custom_components", "hk_frontend")) else _UP)
OUT = os.path.join(_COMPONENT, "frontend", "sky")


# ---------------------------------------------------------------- PNG writer
def write_png(path, w, h, raw, color_type):
    """raw: list of bytes objects, one per row, WITHOUT filter bytes."""
    bpp = {0: 1, 4: 2, 6: 4}[color_type]

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    # Filter type 0 (None) on every row. The noise is high-entropy so the
    # fancier filters buy almost nothing and cost a lot of Python time.
    body = b"".join(b"\x00" + row for row in raw)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(body, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png), bpp


# ------------------------------------------------------------- value noise
def smooth(t):
    return t * t * (3.0 - 2.0 * t)


def lattice(nx, ny, rnd):
    """nx x ny grid of random values in [0,1). Indexed modulo, so it wraps.

    RECTANGULAR, not square: a square lattice ties the horizontal and vertical
    feature counts together -- so making a tile wider to reduce its on-screen
    repetition would also halve the height of every cloud. See the `xrep` note
    in fbm().
    """
    return [[rnd.random() for _ in range(nx)] for _ in range(ny)]


def octave_rows(w, h, nx, ny, grid):
    """Upsample an nx x ny lattice to w x h with smoothstep interpolation.

    Sampling at x * nx / w makes the result tile at the image edge for any
    count, which is what keeps the CSS background-repeat seam invisible.
    """
    # Precompute the column index pair + weight once; reused for every row.
    cols = []
    for x in range(w):
        fx = x * nx / w
        x0 = int(fx) % nx
        cols.append((x0, (x0 + 1) % nx, smooth(fx - int(fx))))
    out = []
    for y in range(h):
        fy = y * ny / h
        y0 = int(fy) % ny
        y1 = (y0 + 1) % ny
        wy = smooth(fy - int(fy))
        g0, g1 = grid[y0], grid[y1]
        row = []
        ap = row.append
        for x0, x1, wx in cols:
            a = g0[x0] + (g0[x1] - g0[x0]) * wx
            b = g1[x0] + (g1[x1] - g1[x0]) * wx
            ap(a + (b - a) * wy)
        out.append(row)
    return out


def fbm(w, h, octaves, seed, gain=0.5, xrep=1):
    """Sum of value-noise octaves. Returns rows of floats normalised to 0..1.

    `octaves` is a list of lattice counts, and they are the counts for a tile of
    the ORIGINAL 1024 width. `xrep` multiplies only the HORIZONTAL count, so a
    tile generated at `w = 1024 * xrep` holds xrep times as much distinct
    content at exactly the same feature size.

    That distinction is the whole point. Simply widening the tile stretches the
    clouds; widening it AND raising the square lattice count shrinks them
    vertically as well. Only the horizontal count should follow the width.
    """
    rnd = random.Random(seed)
    acc = [[0.0] * w for _ in range(h)]
    amp, total = 1.0, 0.0
    for n in octaves:
        layer = octave_rows(w, h, n * xrep, n, lattice(n * xrep, n, rnd))
        for y in range(h):
            ar, lr = acc[y], layer[y]
            for x in range(w):
                ar[x] += lr[x] * amp
        total += amp
        amp *= gain
    inv = 1.0 / total
    for y in range(h):
        ar = acc[y]
        for x in range(w):
            ar[x] *= inv
    return acc


# --------------------------------------------------------------- clouds
def clouds(name, w, h, octaves, seed, floor, ceil, vfade, xrep=1):
    """floor/ceil remap the noise so gaps of clear sky open up.

    vfade > 0 fades the alpha out at the top and bottom edges, so a layer
    drifting horizontally never shows a hard band where the tile ends.
    """
    f = fbm(w, h, octaves, seed, xrep=xrep)
    span = ceil - floor
    rows = []
    for y in range(h):
        # Vertical envelope: full strength in the middle, tapering to 0 at the
        # top and bottom. Cosine rather than linear so there is no visible
        # crease where the taper starts.
        t = y / (h - 1)
        env = 1.0 if vfade <= 0 else (0.5 - 0.5 * math.cos(2 * math.pi * t)) ** vfade
        fr = f[y]
        row = bytearray()
        for x in range(w):
            v = (fr[x] - floor) / span
            v = 0.0 if v < 0 else (1.0 if v > 1 else v)
            a = int(smooth(v) * env * 255 + 0.5)
            row += b"\xff" + bytes((a,))     # luminance flat, shape in alpha
        rows.append(bytes(row))
    size, _ = write_png(os.path.join(OUT, name), w, h, rows, 4)
    cover = sum(r[i] for r in rows for i in range(1, len(r), 2)) / (w * h * 255)
    print(f"  {name:14s} {w}x{h}  {size/1024:6.0f} KB   mean alpha {cover:.3f}")


# ---------------------------------------------------------------- stars
def stars(name, w, h, seed, count):
    """A star field with a plausible magnitude distribution.

    Real skies are mostly faint stars with a handful of bright ones, so the
    brightness is drawn from a power law rather than uniformly -- a uniform
    draw reads as television static, which is the usual giveaway on a
    procedural star field. Colour varies slightly around white so the bright
    ones pick up a blue or amber cast the way real ones do.
    """
    rnd = random.Random(seed)
    px = [[0, 0, 0, 0] for _ in range(w * h)]
    for _ in range(count):
        cx, cy = rnd.randrange(w), rnd.randrange(h)
        mag = rnd.random() ** 3.2                 # power law: few bright
        peak = 40 + mag * 215
        # Colour temperature: cool blue-white through to warm amber.
        t = rnd.gauss(0.0, 0.45)
        t = max(-1.0, min(1.0, t))
        r = 255 if t >= 0 else int(255 + t * 38)
        b = 255 if t <= 0 else int(255 - t * 46)
        g = int(255 - abs(t) * 14)
        # Radius grows with brightness; the faint majority stay sub-pixel, so
        # they are laid down as a single soft dot rather than a disc.
        rad = 0 if mag < 0.55 else (1 if mag < 0.88 else 2)
        for dy in range(-rad, rad + 1):
            yy = (cy + dy) % h
            for dx in range(-rad, rad + 1):
                d = math.hypot(dx, dy)
                if d > rad + 0.5:
                    continue
                fall = 1.0 if rad == 0 else max(0.0, 1.0 - d / (rad + 0.6)) ** 1.8
                xx = (cx + dx) % w
                p = px[yy * w + xx]
                a = int(peak * fall)
                if a > p[3]:
                    p[0], p[1], p[2], p[3] = r, g, b, a
    rows = []
    for y in range(h):
        row = bytearray()
        base = y * w
        for x in range(w):
            row += bytes(px[base + x])
        rows.append(bytes(row))
    size, _ = write_png(os.path.join(OUT, name), w, h, rows, 6)
    print(f"  {name:14s} {w}x{h}  {size/1024:6.0f} KB   {count} stars")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("clouds:")
    # Three decks at different frequencies. Drifting them at different speeds
    # is what sells depth; a single layer always reads as a moving wallpaper.
    #
    # 2048 WIDE, xrep=2. A 1024 tile drawn at 640/440/280px repeats 2 / 2.9 /
    # 4.6 times across a 1280px screen, and the same cloud shapes are plainly
    # recognizable more than once.
    #
    # The fix is a wider tile with proportionally MORE content, not a
    # stretched one: xrep=2 doubles only the horizontal lattice count, so the
    # clouds keep their size and there is simply twice as much before it
    # repeats. hk-sky.js draws each deck at a --tw of 1280/880/560, which
    # halves the on-screen repetition. Drift speed is unaffected -- it is
    # derived as tw / speed, so doubling tw doubles the duration and the px/s
    # stays put.
    #
    # THE COST, so it is a decision and not a surprise: the files roughly
    # double (~290KB -> ~580KB for the three), and each layer overhangs to the
    # right by exactly --tw, so the composited area grows with it. Both are
    # worth it against visibly repeating wallpaper.
    #
    # No cache bump needed: these are served from /hk/sky/, which hk_frontend
    # sends as no-cache (revalidate every load). Under /local/ a 31-day cache
    # would keep a regenerated texture from ever reaching a tablet.
    clouds("clouds-a.png", 2048, 512, [3, 6, 12],       11, 0.34, 0.78, 1.0, xrep=2)
    clouds("clouds-b.png", 2048, 512, [4, 8, 16, 32],   29, 0.40, 0.80, 0.7, xrep=2)
    clouds("clouds-c.png", 2048, 512, [6, 12, 24, 48],  47, 0.46, 0.84, 0.5, xrep=2)
    print("stars:")
    stars("stars.png", 1024, 1024, 7, 2600)


# --------------------------------------------------------------- snowflakes
def flakes(name, w, h, seed, count):
    """White dots for snow. Same idea as stars but larger and softer.

    Sizes are drawn from a power law again so the field has near flakes and
    far flakes in it -- a single flake size reads as dust, not snow.
    """
    rnd = random.Random(seed)
    px = [[0, 0, 0, 0] for _ in range(w * h)]
    for _ in range(count):
        cx, cy = rnd.randrange(w), rnd.randrange(h)
        big = rnd.random() ** 2.0
        rad = 1 + int(big * 2.4)
        peak = int(120 + big * 135)
        for dy in range(-rad - 1, rad + 2):
            yy = (cy + dy) % h
            for dx in range(-rad - 1, rad + 2):
                d = math.hypot(dx, dy)
                if d > rad + 1:
                    continue
                fall = max(0.0, 1.0 - d / (rad + 1.0)) ** 1.5
                xx = (cx + dx) % w
                p = px[yy * w + xx]
                a = int(peak * fall)
                if a > p[3]:
                    p[0], p[1], p[2], p[3] = 255, 255, 255, a
    rows = []
    for y in range(h):
        row = bytearray()
        base = y * w
        for x in range(w):
            row += bytes(px[base + x])
        rows.append(bytes(row))
    size, _ = write_png(os.path.join(OUT, name), w, h, rows, 6)
    print(f"  {name:14s} {w}x{h}  {size/1024:6.0f} KB   {count} flakes")


# -------------------------------------------------------------------- rain
def streaks(name, w, h, fields):
    """Rain, as a tileable field of short VERTICAL streaks.

    WHY A TEXTURE AND NOT A GRADIENT
    A repeating-linear-gradient is by definition a set of INFINITE parallel
    lines running the full height of the screen at whatever angle the wind
    asks for. On a wall tablet that reads as diagonal hatching, not weather --
    the eye locks onto the continuous line rather than any individual drop.
    Discrete streaks with gaps between them are what makes it read as rain.
    It also lets the layer fall straight down with fallTiled() and loop
    exactly, the same way snow does.

    Streaks are drawn perfectly VERTICAL because the layer falls straight
    down: a drop whose streak does not align with its own motion looks wrong,
    and a baked-in lean cannot track the wind anyway.

    Length is a power law so a single field has near drops and far drops in it,
    which is the same trick stars and flakes use and for the same reason -- one
    uniform size reads as a manufactured pattern.

    FIELDS: (seed, count, lmin, lmax, peak_lo, peak_hi) each, drawn into the
    one tile. The rain is ONE deck (2026-10-10): its far streaks -- short,
    dim, dense -- in the same tile as the near ones, so it costs the tablet's
    GPU one full-screen layer, not two. The depth was always the contrast
    between them, not their speed.
    """
    px = [[0, 0, 0, 0] for _ in range(w * h)]
    count = 0
    for seed, n, lmin, lmax, peak_lo, peak_hi in fields:
        rnd = random.Random(seed)
        count += n
        for _ in range(n):
            cx, cy = rnd.randrange(w), rnd.randrange(h)
            near = rnd.random() ** 1.7          # power law: mostly far drops
            L = int(lmin + near * (lmax - lmin))
            peak = int(peak_lo + near * (peak_hi - peak_lo))
            # Slightly blue-white.
            cr, cg, cb = 206, 226, 248
            for dy in range(L):
                # Taper BOTH ends: a streak with square ends reads as a dash. The
                # head is left a little brighter than the tail, which is what a
                # real motion-blurred drop looks like.
                t = dy / float(L - 1) if L > 1 else 0.0
                env = math.sin(math.pi * t) ** 0.65
                env *= 0.72 + 0.28 * (1.0 - t)
                yy = (cy + dy) % h
                # 1px core with soft shoulders, so the streak is a hairline rather
                # than a bar but still survives downscaling on the tablet.
                for dx, k in ((-1, 0.34), (0, 1.0), (1, 0.34)):
                    xx = (cx + dx) % w
                    a = int(peak * env * k)
                    q = px[yy * w + xx]
                    if a > q[3]:
                        q[0], q[1], q[2], q[3] = cr, cg, cb, a
    rows = []
    total = 0
    for y in range(h):
        row = bytearray()
        base = y * w
        for x in range(w):
            q = px[base + x]
            row += bytes(q)
            total += q[3]
        rows.append(bytes(row))
    size, _ = write_png(os.path.join(OUT, name), w, h, rows, 6)
    mean = total / float(w * h * 255)
    print(f"  {name:14s} {w}x{h}  {size/1024:6.0f} KB   {count} streaks"
          f"   mean alpha {mean:.4f}")


print("snow:")
flakes("flakes.png", 512, 512, 3, 260)

print("rain:")
# Near streaks: longer, brighter, fewer. Far: short, dim, dense -- that
# contrast is what gives the rain depth rather than speed. ONE TILE, ONE DECK
# (2026-10-10): the far ones were a second 384 px deck at 0.55/0.90 of the
# near deck's opacity; here at their old density in a 512 tile (210 at 384^2
# -> 373) and that strength (peaks x 0.61).
streaks("rain.png", 512, 512, [(11, 240, 16, 52, 70, 165), (17, 373, 9, 26, 24, 59)])

def grain(name, w, h, seed, coarse_amp, fine_amp):
    """A tileable luminance GRAIN, for the flat static palettes.

    WHY THIS EXISTS
    The weather sky has clouds, stars and precipitation moving through it, so
    it never reads as a flat fill. The static category palettes are pure
    four-stop gradients, and a large gradient with nothing in it looks like
    what it is -- a CSS gradient. Every real Apple surface of this size has a
    little noise in it, and it is doing a second job besides taste: an 8-bit
    gradient across 1280px steps visibly, and grain dithers those steps away.

    TWO OCTAVES, and they do different jobs. The fine layer is per-pixel
    dither. The coarse layer is a slow undulation, a few hundred pixels across,
    which is what stops the eye reading a uniform sandpaper texture. Fine
    alone looks like sensor noise; coarse alone looks like a stain.

    Output is GREY + ALPHA with a flat mid grey and the noise carried entirely
    in the alpha channel, so it can be laid over any palette with
    `mix-blend-mode: overlay` and lighten or darken symmetrically rather than
    tinting it.
    """
    # fbm takes a LIST OF LATTICE SIZES, not an octave count, and returns rows
    # of floats. 256 on a 512 tile is a 2px feature -- fine enough to read as
    # dither; [3, 6] is the slow undulation.
    fine = fbm(w, h, [128, 256], seed, gain=0.5)
    coarse = fbm(w, h, [3, 6], seed + 977, gain=0.6)
    rows = []
    for y in range(h):
        row = bytearray()
        fr, cr = fine[y], coarse[y]
        for x in range(w):
            v = (fr[x] - 0.5) * fine_amp + (cr[x] - 0.5) * coarse_amp
            # 128 is the neutral for `overlay`: exactly mid grey changes
            # nothing, so a pixel's DISTANCE from 128 is its whole effect.
            lum = 128 + int(round(v * 255))
            # ALPHA IS CONSTANT. Fading alpha with distance from neutral
            # sounds right and is not: it makes the layer's strength depend on
            # two things at once, and the product comes out so small the grain
            # is measurably present and completely invisible.
            # A fully opaque sheet of near-mid grey is the predictable form --
            # exactly 128 is a no-op under `overlay`, so the luminance spread IS
            # the texture and the layer's CSS opacity is the only dial.
            row += bytes((0 if lum < 0 else (255 if lum > 255 else lum), 255))
        rows.append(bytes(row))
    size, _ = write_png(os.path.join(OUT, name), w, h, rows, 4)   # 4 = grey+alpha
    print(f"  {name:14s} {w}x{h}  {size/1024:6.0f} KB")


print("grain:")
# 512 is big enough that the coarse octave has somewhere to undulate and the
# repeat is not findable at arm's length on a 1280px page.
grain("grain.png", 512, 512, 4242, coarse_amp=0.30, fine_amp=0.16)
