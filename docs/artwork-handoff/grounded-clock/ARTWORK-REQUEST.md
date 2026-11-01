# Artwork request: foreground meadow for the grounded clock

**For:** Codex. **From:** Claude, for the owner (Mantel / HK Frontend). **Date:** 2026-11-01.
**This file:** `/Volumes/data/mantel/docs/artwork-handoff/grounded-clock/ARTWORK-REQUEST.md`

Everything you need is in this folder. You should not need any other conversation.

## 1. What this is for

Mantel's wall-tablet screensaver has a layout called **Big Weather**. It draws a live sky over a painted landscape: a
golden autumn meadow, a tree line, hills. A large clock time (for example `12:48`) stands at the lower left with its
feet on the meadow. Today the time looks like a translucent sticker. It is being redrawn as **solid ivory numerals
planted in the meadow**, with real shadows that follow the scene's sun.

What sells "planted" is a little **grass in front of the numerals' feet**, overlapping their bottom edge. The
landscape is one flat painting, with no separate foreground layer, so that grass has to be new artwork. **That
grass strip is what this request asks for.** The numerals, shadows, sky and lighting are all drawn live in code.
Paint **none** of them.

Look at these before you start (all in `references/`):

| File | What it shows |
|---|---|
| `clean/land-fall-day-2560x1600.png` | The landscape master (lossless), the frame every coordinate here refers to. |
| `clean/meadow-strip-<season>-day-2560x280.png` | The meadow band where the numerals stand, art y 960-1240, for each season. Match these. |
| `clean/digits-1248-art-2560x1600.png` | The new ivory numerals alone (transparent), in place at the reference size. Use it for composites. |
| `clean/current-bigweather-midday-1280x800.png` | The screensaver as it looks today. |
| `clean/current-scene-midday-1280x800.png` | The same scene with nothing on it. |
| `mockup/mock-*-1280x800.png` | Claude's mockup of the new look, with a **stand-in** grass made by cutting the meadow into blade shapes. It shows placement and restraint. It is not the quality bar: yours replaces it. |
| `placement/placement-annotated-2560x1600.png` and `placement-annotated-ground-zoom.png` | **Annotated** placement: the ground line, the strip's box and its bands. Do not trace the annotations. |
| `placement/output-template-3600x200-GUIDE-ONLY.png` | Your output frame with its bands marked. A guide only: none of it goes in the art. |

The live mockup is `mockup/index.html` (open it in a browser; it needs its `img/` folder).

## 2. The files

Write these four files to `/Volumes/data/mantel/docs/artwork-handoff/grounded-clock/output/`:

| File | Season | Required |
|---|---|---|
| `fg-meadow-fall.png` | fall (do this one first) | yes |
| `fg-meadow-winter.png` | winter | yes |
| `fg-meadow-spring.png` | spring | yes |
| `fg-meadow-summer.png` | summer | yes |

All four must be:

- **PNG, RGBA, 8 bits per channel, exactly 3600 × 200 px**, with a genuinely transparent background (alpha 0 wherever
  there is no plant). No flattened or matte background, no checkerboard, no border.
- **One strip px = half an art px.** The strip covers 1800 × 100 px of the 2560 × 1600 landscape. It is drawn at
  2× density so it stays sharp on big screens.
- Straight (unpremultiplied) alpha. In every pixel with alpha below 255, the RGB values must be the plant's own color
  bled outward, not black or white. Otherwise scaling makes dark or light halos.

### Why seasons, and why only these four

The landscape changes with the month: fall, winter (snow), spring and summer meadows. Each holiday landscape reuses
its season's meadow pixel for pixel (Halloween is fall, Christmas is winter, July 4 is summer), so **four strips cover
every landscape**.

**Do not make dusk or night versions.** The landscape's dusk and night meadows are each a fixed color transform of the
day meadow (measured: a 3 × 4 color matrix fits them to within 1-3 levels out of 255). The code applies that same
transform to your strip. So paint **day light only**.

## 3. Where it goes

Coordinates are in the landscape's own frame, 2560 × 1600 "art px". The landscape always covers the screen from the
bottom center, so a point in the art keeps its place on every screen shape.

- **Row 140 of the strip is the ground line**: the numerals' baseline, art **y = 1088**. Everything above row 140
  stands in front of the numerals' feet. Everything below is ground in front of them.
- At the reference screen (16:10, the 1280 × 800 wall tablet), the strip's **left edge is at art x = 46**, which is
  60 art px left of where the time's ink begins (art x 106). The strip moves with the clock, not with the art. The
  meadow is even along its width, so the strip only has to match it, not line up with any feature in it.
- **Cropping.** The code shows the strip from its left edge to 60 art px past the time's last figure, then fades it
  out over its last 60 px. So anywhere from about the first 1000 strip px to all 3600 may show, depending on the time
  (`1:11` is narrow, `12:48` or `20:08` is wide). The strip must look natural cut off at **any** x past 1000. Spread
  the interest along its whole length: no single hero clump, and nothing that only works in the middle.
- **Scale.** On the 16:10 reference, the numerals' cap height is about 454 art px (908 strip px). On upright screens
  and phones the numerals are smaller relative to the land, and the code then shrinks the strip uniformly (down to
  0.55×). Make sure it still reads at half size.

### The bands: what may overlap the numerals

The strip's rows, top to bottom (see `placement/output-template-3600x200-GUIDE-ONLY.png`):

| Rows | Art y | What may be there |
|---|---|---|
| 0-29 | 1018-1032 | **Nothing.** Alpha 0. |
| 30-69 | 1033-1052 | Only **rare** thin stems and seed heads: 6-12 across the whole strip, each at most about 10 px wide, under 3 % coverage. |
| 70-109 | 1053-1072 | **Tufts**, sparse and clumped: under 20 % coverage. |
| 110-139 | 1073-1087 | The **low fringe** of blade tips: under 60 % coverage, with gaps. |
| 140 | 1088 | **The ground line.** Something should be here along most of the strip: at least 35 % coverage in rows 136-145. |
| 141-184 | 1089-1110 | Blade bases, a few fallen leaves lying flat, a soft darkening of grass roots. May be dense, but its lower edge must be **irregular** and fade out. It never ends in a straight line. |
| 185-199 | 1111-1118 | **Nothing.** Alpha 0. |

**Readability matters more than lushness.** The bottom stroke of a `2`, the foot of a `1`, `4` or `7`, and the
bottom curves of `0`, `3`, `5`, `6`, `8` and `9` must all stay recognizable. Above the ground line keep it low and
broken: tips and tufts, never a hedge. Across the strip leave **at least 8 open gaps 40 px or wider**, where nothing
rises above the lowest fringe. No open gap may be wider than 600 px, so it never reads as a strip with a hole in it.

## 4. What it should look like

**Match the meadow in the references.** It is a painterly, near-photographic autumn meadow seen from about standing
eye height. Your strip is the same meadow, a little nearer to the viewer than the numerals' feet.

- **Perspective.** The viewer's eye is slightly above the grass (the camera horizon is at art y ≈ 920, about 170 art
  px above the ground line). Blades are seen side-on and slightly from above. Anything lying on the ground (leaves)
  is strongly foreshortened, about 1:3 to 1:4. There is no visible flat ground plane, only the base of the blades.
- **Scale.** Match the meadow's own grass just in front of the numerals' feet (in `meadow-strip-fall-day`, around art y
  1080-1120). There, blades are about 3-5 art px wide at the base and 15-25 art px tall. In strip px, that is 6-10
  wide tapering to 1-2 px tips, 30-50 tall for typical blades and 60-110 for the rare tallest stems.
- **Texture and edges.** Thin, tapering, slightly curved blades leaning in varied directions, crossing each other,
  with fine anti-aliased tips and no outlines. Vary the heights, the lean and the spacing, and build it up in
  overlapping layers so it has depth. Its sharpness should match the meadow art, neither crisper nor softer.
- **Light.** The same soft daylight as the day landscapes: warm, diffuse, from above and a little toward the viewer.
  Shade the blades gently darker toward their roots. **No cast shadows** onto the transparent area, no rim light, no
  glow, no strong single-direction sunlight. The code adds the scene's real shadows and dims the strip when a shadow
  falls on it.
- **Never:** a straight or even strip; a clump repeated (no copy-paste, no tiling, no rhythm you can spot); uniform
  height; flowers or plants that don't appear in that season's meadow; anything cartoonish or vector-flat; text,
  signatures, watermarks, frames; a ground color band under the grass.

### Per season

The palettes below are measured from each season's day meadow (art y 1040-1240): dark / mid / light.

- **Fall (first):** dry golden grass, dark (130, 74, 24), mid (185, 119, 51), light (236, 169, 92). Add a few slim
  seed heads (foxtail, little bluestem), 2-3 small past-bloom goldenrod or aster sprigs (faded, not bright), and 8-14
  fallen maple or oak leaves in the meadow's reds and oranges, lying in rows 135-175. All of this is sparse.
- **Winter:** a meadow under snow, dark (180, 186, 202), mid (215, 218, 229), light (235, 238, 246), shadows faintly
  blue. Make a soft, uneven snow lip along the ground line (rows 125-175), with dry tan and gray stalks and a few dark
  seed heads poking through it. Nothing green, no leaves.
- **Spring:** fresh green grass, dark (95, 104, 34), mid (145, 152, 64), light (193, 192, 114), with a few small white
  and pale pink flowers like the ones in `meadow-strip-spring-day`. Keep them tiny and sparse.
- **Summer:** full green grass, dark (70, 84, 21), mid (117, 130, 50), light (166, 174, 92), a little taller and
  fuller than spring but within the same bands, with very few tiny flowers (as in `meadow-strip-summer-day`).

All four should share one construction (a similar layout of clumps and gaps), so the clock doesn't jump when the
season turns. The individual blades don't need to be identical.

### How to make it

Generate it, paint it, or assemble it from generated elements, whichever gives the best result. If your image
generator can't output real transparency, generate on a flat chroma color that appears nowhere in the plants. Cut it
out carefully (fine blade tips included), then remove the color spill from the edges and bleed the RGB into the
transparent pixels. Use no stock photos or third-party images. Keep any working files in
`output/work/`.

## 5. Leave these alone

Do not modify, move, re-encode or delete anything outside `/Volumes/data/mantel/docs/artwork-handoff/grounded-clock/output/`.
In particular:

- `references/`, `mockup/`, `ARTWORK-REQUEST.md`, `check_assets.py` (read them, don't edit them)
- `/Volumes/data/mantel/web/` (all of it: the landscapes `web/hk/sky/land-*.webp`, `web/hk/sky/near/`,
  `web/hk/landscapes/`, and every `.js` and `.css` file)
- `/Volumes/data/mantel/hk_core/`, `/Volumes/data/mantel/hosts/`, `/Volumes/data/mantel/tools/`
- `/Volumes/config/custom_components/hk_frontend/tools/sky/src/` (the landscape masters, which you may read)
- anything in git: don't commit, branch or push.

## 6. Checks before you call it done

1. Run the checker from this folder. It verifies the size, mode, transparent bands, coverage, gaps, irregular edge,
   halos and texture, and writes `output/preview-<season>.png` and `output/preview-<season>-zoom.png` (the strip on its
   meadow in front of the numerals):

   ```bash
   /Volumes/data/mantel/.venv/bin/python /Volumes/data/mantel/docs/artwork-handoff/grounded-clock/check_assets.py
   ```

   Every line must say PASS for all four seasons.
2. **Look** at each preview and zoom yourself:
   - Do the numerals look planted? Is every figure still readable at its foot?
   - Does the grass belong to the meadow behind it in color, sharpness, scale and light?
   - Are there no visible repeats and no straight edges?
3. Look at each strip at **50 %** size over its meadow: it must still read as grass, not noise.
4. Look at each strip on **flat black** and on **flat white** at 200 % for halos or fringes around the blades.
5. Darken a copy of the fall preview to night (about 12 % brightness, slightly blue) and check that no light fringe
   appears.
6. Make one **placement composite**, `output/composite-placement.png` (2560 × 1600). It is `land-fall-day` plus
   `references/clean/digits-1248-art-2560x1600.png` plus `fg-meadow-fall.png`, drawn at half size with its row 140 at
   art y 1088 and its left edge at art x 46. (`preview-fall.png` is the same picture at 1280 × 800, so you may scale
   from it.)

## 7. When you're finished: the completion marker

Only after all four strips are made, pass every check, and you have **looked** at them, create:

`/Volumes/data/mantel/docs/artwork-handoff/grounded-clock/ARTWORK-DONE.json`

```json
{
  "status": "complete",
  "request": "/Volumes/data/mantel/docs/artwork-handoff/grounded-clock/ARTWORK-REQUEST.md",
  "assets": [
    {
      "season": "fall",
      "path": "/Volumes/data/mantel/docs/artwork-handoff/grounded-clock/output/fg-meadow-fall.png",
      "width": 3600, "height": 200, "mode": "RGBA",
      "transparency": {"transparent_fraction": 0.0, "rows_0_29_max_alpha": 0, "rows_185_199_max_alpha": 0,
                       "coverage_rows_70_109": 0.0, "coverage_rows_110_139": 0.0},
      "sha256": "..."
    }
  ],
  "composite": "/Volumes/data/mantel/docs/artwork-handoff/grounded-clock/output/composite-placement.png",
  "previews": ["/Volumes/data/mantel/docs/artwork-handoff/grounded-clock/output/preview-fall.png"],
  "checks": ["check_assets.py: all PASS for fall, winter, spring, summer", "..."],
  "notes": "Anything Claude should know when integrating: limitations, choices made, known weak spots."
}
```

Put one entry in `assets` per season (all four), with real measured numbers, and list every preview. `transparent_fraction`
is the share of pixels with alpha 0. `checks` should briefly list what you ran and what you looked at.

**If anything is unfinished, do not create `ARTWORK-DONE.json`.** Write
`output/PROGRESS.md` instead, saying what is done, what remains and why. Claude treats only the marker as completion,
and never the presence of files in `output/`.
