# Grounded clock: plan

**Status: built (2026-11-01).** The owner approved the mockup's look. It is in `hk-saverfaces.js` (`plant()`) behind
Big Weather's **Planted Numerals** option, on by default, with Codex's grass (`web/hk/sky/fg-meadow-<season>.webp`).
Checked by `tests/test_saverfaces.js` and `tools/headless/saver_shows_check.py` (`saver-planted`). It has not been on
a wall tablet yet.

**Scope.** The **Big Weather** layout (Screensaver → Show: Forecast, Layout: Big, the time as its big number:
`forecast_big: clock`). That is the large time at the lower left, standing on the meadow, drawn by
`web/hk/modules/hk-saverfaces.js` (`BUILD.weather`, `.hkf.weather .tp/.tpn`) over the forecast's own sky
(`hk-sky.js` `scene()`, mounted by `hk-saver.js` `bigWeather()`).

## What's there today

- The time is SF Pro Semibold, 40cqmin wide or 30cqmin upright, filled with a white-to-35 % gradient clipped to the
  type. That fill is the translucent look.
- The feet are placed by CSS: `bottom: calc(.32 * max(100cqh, 66.7cqw) - .145em)`. Under them is one skewed radial
  oval (`.tp::before`), the same for every figure and every light.
- The scene: `hk-sky.js` paints the sky from `sun.sun` (elevation, azimuth) and the weather (`cloud_coverage`) and
  lays a land over it (`web/hk/sky/land-<season>-<light>.webp`, 2560 × 1600, cover, center bottom). It places the
  sun's glow by azimuth across the screen: 90° at the left edge, 180° in the middle, 270° at the right.
- **Two small inconsistencies to fix along the way:**
  - The feet formula uses 3:2 (`66.7cqw`), but the land is 16:10. On 16:9 screens the feet sit about 26 px above the
    art's ground line.
  - Upright, the `58cqmin` floor lifts the feet into the tree line (on an iPad held upright they stand about 40 px
    above the meadow's far edge).

  The mockup places the feet on the art's own ground line (68 % of the art's height) on every screen. Upright, the
  feet still clear what's playing by 65 px or more.

## The look (as in the mockup)

1. **Numerals.** Solid warm ivory (`#efe6d6`), 97 % opaque, the same font, size and position as today.
   - **Thickness:** a side face about 2 % of the font size deep, drawn toward the vanishing point. The figures sit
     left of center, so it shows on their right-hand sides.
   - **Shading:**
     - The side face is lit when the sun is on the right (afternoon) and in shade when it's on the left (morning).
     - The front gets a soft top-to-bottom falloff with a hint of the meadow's color bounced near the ground.
     - The front is a touch brighter toward the sun's side, and about 10 % dimmer when the sun is ahead (backlit).
   - No bevels, specular highlights or metal.
   - **Color** follows the light, in the land's own terms. By day it's ivory, warming toward sunset. At dusk it passes
     through the same color transform hk-sky's dusk land uses, held readable. At night it's moonlit gray-ivory.
     Under cloud it's flatter and cooler.
2. **Ground plane.** The scene gets one camera model, fitted to the art:
   - **Horizon** (eye level) at art y 920, above the meadow's far edge (1012), at the hills' feet.
   - **Ground line** (feet) at art y 1088.
   - **Focal length** equal to the art's drawn width.
   - **Vanishing point** at the center of the screen.

   Every number is a fraction of the art, so it holds at any size and crop.
3. **The sun's shadow.** This is a copy of the actual numerals, projected onto that ground plane: never an oval, and
   never a text drop shadow.
   - **Direction.** The scene's sun is a direction around the viewer: φ = azimuth − 180°, the same convention hk-sky
     uses to place the glow, at the sun's real elevation. That direction is laid on the ground and seen through the
     camera. The result is one homography, applied as a CSS `matrix3d` to a copy of the time. It's exact for the
     numerals' plane, and the shadow is attached at every foot by construction.
   - **Length** is cot(elevation) times the height: longer as the sun gets low, eased toward a limit of 2.6 times the
     height near the horizon. It never reaches the camera, and never runs more than about half a screen sideways.
   - **Strength** fades in from 1° below the horizon to 6° above, and falls by up to 90 % under heavy cloud.
   - **Softness.** A crisp copy at the feet cross-fades into a blurred copy that fades out with distance. Cloud
     widens both blurs.
   - **Clipping.** The shadow is clipped to the meadow and never falls on the trees. When it falls toward the viewer,
     the grass in front is dimmed to match.
4. **Sky shadow.** A second, very soft projection from high overhead. It is always faint, stronger under cloud, and
   is the only cast shadow at night.
5. **Contact shadows.** Each figure's own foot, about the bottom 6-30 % of the glyph, is mirrored flat onto the ground
   in three tightening layers. This gives a dark line exactly where a stroke touches the grass: under the stem of a
   `1`, the base of a `2`, the curve of an `8`. They stay at every light, a little stronger under cloud.
6. **Grass in front.** A shallow, irregular strip over the feet with real gaps, restrained so every figure reads.
   The mockup's stand-in cuts the meadow itself into blade shapes, so it matches any season and light for free. The
   Codex artwork replaces it with real blades, seed heads and a few leaves (see below).

**Layer order** (as proposed):

1. Landscape (sky and land, unchanged).
2. Projected shadows: sun and sky, clipped to the meadow.
3. Contact shadows, then the numerals' side face, then their front face.
4. Foreground grass.
5. Big Weather's words and the screensaver's corners, unchanged: condition, readings, what's playing, Home Status.

## What the current approach can and can't do

**Can, with plain DOM and CSS:**

- Exact projected shadows of whatever the time is, in any font, from text: one `matrix3d` per copy.
- Per-glyph contact shadows.
- A believable slab depth.
- Light-matched color.
- Everything dynamic: the time, the sun and the cloud change it live. Nothing is baked into the art.

**Can't, or only approximately:**

- **Bevels and depth.** There's no true 3D bevel or lit top faces (deliberate, and not needed). The side depth is a
  text-shadow stack, so it doesn't taper toward the vanishing point. At 2 % depth that doesn't show.
- **Terrain.** The shadow lies on a flat plane; the painted meadow has gentle undulations it can't follow. With the
  soft far end, this reads fine.
- **The colon.** Its dots float, so the lower dot's shadow is detached. That's physically right for floating dots;
  if it bothers you, the lower dot could rest on the ground.
- **Midday fan-out.** The figures stand left of center, so when the sun is straight ahead their shadows fan out
  toward the lower left. That's true perspective, not a bug.
- **Sun behind the viewer.** When the sun is behind (azimuth below 90° or above 270°, which happens on summer mornings
  and evenings), the shadows fall away into the meadow and get shorter. hk-sky pins the glow to the frame's edge
  then. The shadow still falls away from that side.
- **Southern hemisphere.** hk-sky's 90-270° mapping assumes a north-hemisphere house. Unchanged here.
- **Fonts.** The tablets have no SF Pro and fall back to Roboto, as today. Everything is measured from the font
  actually drawn, so the shadows and grass follow whichever font it is.

## Artwork needed

There is no existing asset to reuse:

- Each `land-*.webp` and each lossless master
  (`/Volumes/config/custom_components/hk_frontend/tools/sky/src/land/*-src.png`) is one flat painting with alpha only
  in the sky.
- `web/hk/sky/near/*` is a different scene (the pages' framing trees).
- The holiday lands reuse their season's meadow pixel for pixel.

**Request:** four transparent strips, `fg-meadow-{fall,winter,spring,summer}.png`, each 3600 × 200 RGBA, drawn at 2×
art density, with the ground line at row 140. See `ARTWORK-REQUEST.md`.

- **No dusk or night variants:** each land's dusk and night meadow is a fixed 3 × 4 color matrix of its day meadow
  (fitted to within 1-3 levels), so the code applies that matrix to the strip as an SVG `feColorMatrix`.
- **Fallback:** the stand-in (the meadow cut into blades) needs no art and could ship first if the artwork is slow.
  It reads as a fringe rather than a lush foreground, and carries no seed heads or leaves.

## Performance on the wall tablets

The tablets are SM-X210 and SM-X230 (4 GB, often ~100 MB free and swapping) and a Pixel Tablet, Android 16 WebView,
1280 × 800 CSS at 1.5×.

- **Nothing animates.** All of it is static between changes. It redraws when the minute turns, and when the sky
  repaints (`forecastTick` re-reads the sun about every 10 minutes, or on a weather change). No `will-change`, no
  `mix-blend-mode`, no `backdrop-filter`.
- **Layers and memory:**
  - Up to four `matrix3d` shadow copies (the sun's near and far, the sky's near and far) become composited layers the
    size of the time's box: about 750 × 320 CSS px, about 2.2 MB each at 1.5×.
  - The blurs are rasterized once per change, not per frame.
  - The foreground strip decodes to about 2.9 MB (3600 × 200); only the current season's is loaded.
  - Total extra memory, by estimate: **about 10-12 MB of GPU and texture memory in the DOM version**, and a few
    milliseconds of raster per minute. Folding the shadows into one canvas (below) brings that to about 4-5 MB.
    Given how little memory is free on these tablets, that's the version to ship if the trace shows any pressure.
- **What to avoid:**
  - Shipping the stand-in grass as the mockup draws it. Its two grass layers are full-screen masked copies of the
    scene, about 9 MB apiece at 1.5×. As a fallback, it would be cut to the time's box first.
  - Making any of it move (swaying grass): that would put the whole stack on every frame.
- **Measure, don't guess.** `tools/headless/` and the house's tablet trace (`hk_house/tools/tablet_trace.py`) would
  confirm it on the SM-X210 before release.
- **Single-canvas version.** If memory is tight, or a WebView ever mishandles `matrix3d` plus blur, the shadows can be
  drawn into one `<canvas>` once a minute instead. The projection is affine per row of the glyph, so it can be drawn
  row by row with `drawImage`, giving one layer the size of the shadow's box.

## Integration (after approval)

1. **`hk-saverfaces.js`, Big Weather.**
   - Replace `.tpn`'s gradient fill and `.tp::before` with the layers above, built from one measured copy of the time.
   - Add `light(s)` to the mounted face. It takes hk-sky's reading (elevation, azimuth, cover, season, light) and
     recomputes the shadows and colors.
   - Recompute on each minute (already the face's tick) and on resize.
   - Behind a setting, say Big Weather's "Planted numerals", default on. The old look stays one switch away.
2. **`hk-saver.js`.** `forecastTick` already gets `s` back from `fscene.update(h)`; hand it to
   `bigCtl.light(s)`. Night Mode (the red wash) keeps working: the face's `.night` class turns everything to its
   white-for-red treatment and drops the cast shadows.
3. **Feet.** Put them on the art's ground line on every screen (the two fixes above). Express the line in the land's
   own frame, `ART_W` and `ART_H` from hk-sky, rather than a 3:2 guess.
4. **The temperature as the big number** (`forecast_big: temp`): the same treatment applies to `64°` for free. Say if
   you want it there too.
5. **Assets.**
   - After `ARTWORK-DONE.json`: verify each file and inspect it, then convert to WebP (lossy with alpha, about 30-60 KB
     each).
   - Add them as `web/hk/sky/fg-meadow-<season>.webp` (plus HK Frontend's copy, through `publish.py`).
   - Pick the strip by hk-sky's own `landSeason()`. Apply the dusk and night matrices fitted from the masters.
6. **Tests.**
   - Unit tests for the geometry: the homography fixes the feet, the length clamp, and no shadow at night.
   - A headless WebKit check in the style of `saver_shows_check.py`: Big Weather at the five sizes. The feet sit on
     the ground line, there's no shadow at night, and nothing overlaps the readings.
   - Run `tools/ci.py full`.

## Decisions (the owner, 2026-11-01)

1. The look: approved as in the mockup.
2. The colon: floating dots, their shadow detached.
3. The temperature as the big number: drawn as before, for now.
4. The grass: Codex's art, which arrived before the stand-in was needed.
5. The setting: **Planted Numerals**, on by default (off: the time as before).
