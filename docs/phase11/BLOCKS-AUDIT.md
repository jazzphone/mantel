<!-- The audit as it was written (2026-10-30), before the fixes. What was fixed at once is in HOMEVIEW-LOOK.md, "The
blocks audited at their five sizes": X1 and X2 (one inset, blockPad, with the corner inset), X3 on square cells, X6,
and per block: Thermostat XL, Clock T, Scenes padding and holes, Room XL, Vacuum L/XL, Now Playing T's corner icons
and art corners, Weather XL's tops, Timers on square cells. Open: X4, X5's other bands, X7, the rest of the tables. -->

# Home Grid blocks: a visual audit of every block at S / W / T / L / XL (2026-10-30)

Read-only. Nothing in the repo was changed. I rendered every catalog kind at each size it allows (out of S, W, T, L
and XL), on ordinary 196 × 150 tiles and on square cells, in WebKit at device scale 2, against the fictional gallery
house plus a vacuum, a forecast, a family calendar, timers, a house battery, a water meter and a main valve. Square
cells use the HomeView look's materials (Bright Glass, ribbons_blue, Tile Style Automatic, Big Number thermostat,
Analog Numbers clock). Tiles use Blur.

**Screenshots** were kept outside the repository (`$A` below): the renderer and measurer that made them can be run again from a scratch folder.
- `$A/audit.py` + `$A/audit.cjs`: the renderer and measurer. It writes `$A/shots/a-<kind>-<variant>.png` and `$A/shots/measure.json` (per block: the plate, the content's inset from each plate edge in logical px, every text's size, weight and position).
- `$A/sheets.py` makes `$A/shots/sheets/<kind>-tablet.png` and `-phone.png`, which put all variants side by side, plus `$A/shots/sheets/summary.txt` (one line per block: cell, plate, radius, insets and type).
- `$A/crop.py` makes the close-ups in `$A/zoom/*.png`.
- `$A/shots-sq/a-sqscreen-{a,b}.png`: a Square screen (800 × 800, 3 × 3) with non-tile blocks in the 72 px corners.

Variants: **T6** = 6 × 4 tiles at 1180 × 820 (scale 0.92). **S6** = 6 × 4 square at 1180 × 820 (0.83, cell ≈ 162 px).
**S3 / S3X** = 3 × 3 square with Fill the Screen at 1180 × 820 (1.08, cell ≈ 212 px: the Home with Pane proportion).
**PT** = phone 2 × 5 tiles. **PS / PST** = phone 2 × 4 square (Fill the Screen).
To rerun: `export PLAYWRIGHT_PATH=… NODE=…; ~/.venvs/mantel/bin/python $A/audit.py [--only KIND …] --out DIR`, then `~/.venvs/mantel/bin/python $A/sheets.py DIR`.

Data caveats: with the gallery's data the Power plan shows "Grid None / House Off". Live TV has no channels, so it shows its
empty state. Clean Areas never loads its rooms. Calendar has four events. I've judged layout, not data.

---

## Cross-cutting problems (fix these first; each one clears many rows below)

### X1. There is no shared block inset: I count about nine
Measured content inset from the plate edge, in logical px:

| system | where | inset |
|---|---|---|
| tile (`TILE.pad`) | hk-tile.js:514, KEY_CSS (hk-grid-cards.js:766), vacuum S | 12.8 / 12.8 / 12.8 / 9.8 |
| full / room / panel | FULL_CSS hk-grid-cards.js:888, ROOM_CSS :399, `.part.plated` :1065 | 14 |
| room / accessories **W** | ROOM_CSS hk-grid-cards.js:414 `padding:8px 12px` | **heading 6 px from the top**, 9 at the bottom |
| page card (`CARD.pad`) | battery, weather, calendar, clock, vacuum W/L, Now Playing, scene_suggested | 20–22 / 22–23 |
| timers | hk-home.js:2013 `padding:12px` | 12–13 |
| keypad | security L/XL | 15 |
| power W / L | hk-energy.js status and house | **8–9 from the top** |
| live TV / doors / music | panels | 17–21 / 15 |
| camera age label | hk-cameras | 13 |

Side by side, a tile's name sits at x≈11 while the weather block next to it starts at x=23 and Now Playing at 23. Where
the blocks share a row, their text starts on three different left lines. This is what reads as "not aligned" across the
grid.

**Fix (one rule for most of it):** give the grid a block inset and have every block's outer plate read it.
- hk-base.js:259 add `HOME_GRID.inset = { tile: 14, square: 18 }`. Square: a 34 px corner's circle comes 0.29 × 34 ≈ 10 px in, plus 8 to breathe. Apple's widgets use 16 standard and 11 tight. Leave Home-style accessory tiles on the measured `TILE.pad`, since DESIGN.md Rule 5 makes it load-bearing.
- hk-layout.js:1816–1821 (the `.cell` rules) add `--hk-block-pad:14px` and, for `:host([cell=square]) .cell`, `--hk-block-pad:18px`. Then add `--hk-pad-t:calc(var(--hk-block-pad) + var(--hk-in-t,0px))`, and the same for `-r`, `-b` and `-l`.
- Each block's outer plate then pads with `var(--hk-pad-t) var(--hk-pad-r) var(--hk-pad-b) var(--hk-pad-l)`: FULL_CSS, ROOM_CSS (W included), KEY_CSS, the scenes box (hk-chip.js:1424), timers (hk-home.js:2013), the vacuum grid rule (hk-home.js:126), Now Playing's `--hk-np-pad` (hk-media.js:775), the clock (hk-weather.js:2798), the weather band, the battery and the panels.
- This also does **X2** for free.

### X2. Only hk-tile honours a Square screen's 72 px corner inset
`cellInset` (hk-layout.js:1730) sets `--hk-in-t/-r/-b/-l` on a corner cell, but the only reader is hk-tile.js:514–515.
- On a Square screen, the Security W block's shield well and the Vacuum W block's well are clipped by the 72 px outer corner. Their circles reach about 15 px past the arc. See `$A/shots-sq/a-sqscreen-a.png` (top-left) and `a-sqscreen-b.png` (top-left).
- The Room L block's bottom-left pill pokes past the arc (`a-sqscreen-b.png`, bottom-left).
- Fix: X1 above. At minimum, add `+ var(--hk-in-*)` to KEY_CSS hk-grid-cards.js:766, the vacuum S/W square rule hk-home.js:148, ROOM_CSS :399 and FULL_CSS :888.

### X3. Nested plates aren't concentric
- The room, accessories and scenes groups and the keypad put 23.5 px pills inside a 34 px plate with a 12–14 px inset. A concentric inner radius would be 34 − 14 = 20.
- On tiles it's 23.5 inside 23.5 with a 14 inset, so the gap at the corners visibly swells.
- Fix: hk-layout.js `.cell` gets `--hk-inner-radius: max(8px, calc(var(--hk-block-radius, 23.5px) - var(--hk-block-pad)))`.
- The pills inside a group read it instead of `M.radius`. The rule at hk-tile.js:520 skips `[data-group-fill]`, so add `:host([data-group-fill]) hk-plate.card{border-radius:var(--hk-inner-radius, …)}`. Apply it to the keypad keys too.
- Screenshots: `$A/zoom/scenes-room.png`, `$A/shots/a-accessories-s6.png`.

### X4. On square cells the tiles grow to 21 / 20 px, but every other block stays at 15–17
Centred tiles use `TILE.centred.square` (name 21/600, sub 20/400). The first line of each block on S3:

| block | first line |
|---|---|
| Room / Accessories heading | 19.7/700 |
| Weather place, Now Playing T/W, Vacuum L, Live TV | 17/600 |
| Timers, Battery, Water, Security W, Vacuum on square, Scenes pills | 15/600 (Scenes 15/700) |
| Music | 13.5/600 |
| Calendar, scene_suggested | 13/600 uppercase |
| Doors, Power | 11/600 uppercase |

On a HomeView screen the tiles shout and the rest whisper. See `$A/shots/sheets/small-tablet.png` (S6 row 4) and
`$A/shots/a-small-s6.png`.
- **Fix:** hk-base.js TYPE gets two roles, `'block-title'` (17/600) and `'block-sub'` (15/400). Each takes the square size (21/600, 20/400) under `@container hk-cell (min-height:180px)`, as `centredTile` already does at hk-base.js:379.
- Use them for the block's own name line: timers `.timer-heading>b`, battery `.ttl b`, security W `.name`, vacuum `.label`, weather place, Now Playing `.title` (not L), water and power headings, and the Live TV title.
- Then add the 13 px label role only where a block has a section label.

### X5. Content that doesn't fill a tall block leaves an empty band
Many blocks stack fixed-height content from the top, or centre one small group, so S/T/L/XL leave 30–60 % of the plate
empty. This is the worst on square cells, where rows are 196 tall instead of 150. The cases are timers S/W, battery S/W,
Power W, music L/XL, water L/XL, Live TV, Doors L/XL, vacuum L/XL, room XL, Now Playing T, weather T and weather XL.
- **Rule to adopt:** a block's content either fills the block (a flex column whose middle part takes `flex:1`, with type and visuals that grow with the cell) or is laid out like a centred tile (a visual at 33 %, the words from 57.7 %).
- Per-block fixes are below.

### X6. Container queries in nested parts resolve to the grid cell
A card mounted inside part of a block reads `cqw`/`cqh` against the grid's `.cell` (the whole block), not its own part.
The Thermostat XL dial is sized to the whole 3 × 2 block and spills out of its column (row 1 below).
- **Fix:** hk-grid-cards.js:1054 PANEL_CSS `.part{…;container-type:size}`.
- The vacuum block's top part (hk-grid-cards.js:959, `.top`) and the keypad body need the same.

### X7. Materials differ across the block family
- Now Playing is an opaque near-black slab on the tablet but translucent glass on the phone.
- Power L/XL and Doors draw a picture with no plate.
- The scenes and accessories groups draw a plate inside a plate.

Compare `$A/shots/sheets/now_playing-tablet.png` with `$A/shots/sheets/now_playing-phone.png`. Decide one material per
block type. DESIGN.md excepts the Now Playing plate, but not one that differs by viewport.

---

## Per block, ranked by how bad it looks

### 1. Thermostat (T, L, XL)
| size | issue | where | proposed change |
|---|---|---|---|
| **XL** | **Broken.** The dial column's ring is sized to the whole block (X6): the knobs are 50 px and the ring's ends are cut off by the column's plate at the bottom. Shows on tiles and on square cells. | hk-control.js:364 (`--hk-tstat-ring:min(100cqw - 20px, …)`), mounted by hk-grid-cards.js:1029–1033 into a `.part` that isn't a container (:1054) | `.part{container-type:size}` in PANEL_CSS |
| XL | The block is two plates side by side (dial + readings). The readings plate has a ~180 px empty band between the readings and Mode. | hk-grid-cards.js:1029–1033, `.rd` :1057 | One plate for the block: the dial and readings in one `.rd`-style plate, or let the readings column take `justify-content:flex-start` and put the fan and humidity under Mode |
| T (Big Number) | The picked-target dot nearly touches the digits (about 4 px), and `68-72` runs to within about 18 px of the plate sides. | hk-control.js `.surface.big` :509 onward (`.bn`, dot) | Margin-top on the dot ≥ 0.08 em. Cap the number at `min(44cqh, 40cqw)` in T |
| L / T (dial, tiles) | Fine | | |

Screenshots: `$A/zoom/th1.png`, `$A/zoom/th2.png`, `$A/shots/sheets/thermostat-tablet.png`

### 2. Vacuum (S, W, L, XL; S/W on square cells is in progress elsewhere)
| size | issue | where | proposed change |
|---|---|---|---|
| **L, XL** | **About 60 % of the block is empty, with no plate.** The 150 px vacuum card sits at the top. Clean Areas below draws nothing while its rooms aren't known (`floors` null), so the lower plate is never drawn. | hk-grid-cards.js:955–961 (`.top` :959); hk-home.js:546 `_renderPanel` | Give the Clean Areas part its own plate and a placeholder ("Loading rooms…"), or fall back to the full-height card until floors arrive |
| L, XL (no Clean Areas) | The card shrinks to its content. The `.body` it's mounted into has no height, because FULL_CSS's `.body{flex:1}` needs a flex parent and here it is the shadow root's child. | hk-grid-cards.js:953–954; FULL_CSS :891 | `'<div class="body" style="height:100%">'`, or add `.body{height:100%}` as CLOCK_CSS does (:1175) |
| L, XL | Top card on page-card insets (23) with 12 px chips. Doesn't match the S/W square layout. | hk-home.js:124–137 | Use the X1 inset and the X4 type |
| W (phone) | No clipping seen in this run; the Dock capsule ends 26 px inside the plate at 390 × 844 | | Recheck after the in-progress S/W change |

Screenshots: `$A/shots/sheets/vacuum-tablet.png`, `$A/shots/sheets/vacuum-phone.png`, `$A/shots/a-vacuum-s3x.png`

### 3. Now Playing (W, T, L)
| size | issue | where | proposed change |
|---|---|---|---|
| **T** | The Speakers and Browse icons sit at `top:4px; left/right:4px`, inside the 23.5/34 px corner arc. They crowd the curve on every variant. | hk-media.js:815–816 | `top:var(--hk-pad-t, 14px)`, left/right likewise. Or move both into the transport row as L does |
| T (square) | About 115 px empty band between the artist line and the progress bar | hk-media.js:820 (`--np-art:min(100cqw - 76px, 100cqh - 190px)`) | Let the art grow to `100cqw - 2 × pad` on square cells, or `justify-content:space-between` on the column |
| all (square) | The art backdrop and shade are clipped at 23.5 under a 34 plate: a wrong corner once there is album art | hk-media.js:788 | `border-radius:var(--hk-block-radius, …)` |
| all | Opaque black on the tablet but glass on the phone (X7) | hk-media.js:775 onward, and the phone media rules near :686 | Pick one |
| L (square) | The art and title float about 94 px from the top while the sides are 23 | hk-media.js:828 | Align to the top inset, or centre the whole stack |

Screenshots: `$A/zoom/np.png`, `$A/shots/sheets/now_playing-tablet.png`, `$A/shots/sheets/now_playing-phone.png`, `$A/shots-sq/a-sqscreen-a.png`

### 4. Clock (S, W, T, L, XL)
| size | issue | where | proposed change |
|---|---|---|---|
| **T (Digital, tiles)** | **"PM" is cut off by the plate's right edge.** The time is `min(72px, 48cqh, 26cqw)`, about 51 px, plus a fixed 22 px AM/PM, which overflows 196 − 44. | hk-weather.js:2812 (W and T share the last line) | Give T its own row: `['min(56px, 22cqw)', '14px', caption]`, or put AM/PM under the time on T |
| T (Analog, square) | Face centred, with about 120 px empty above and below | hk-grid-cards.js:1177 onward | Show the date under the face on T, or draw the face at the top and the date and weekday below it |
| others | Good. The analog face fills S/L/XL with an even margin | | |

Screenshots: `$A/zoom/ck.png`, `$A/shots/sheets/clock-tablet.png`

### 5. Room and Accessories (W, L, XL)
| size | issue | where | proposed change |
|---|---|---|---|
| **W** | The heading is 6 px from the plate top (8 px of padding); sides 12, bottom 9. It's the tightest text of any block, and close to the 34 corner. | hk-grid-cards.js:414 | Use the X1 inset. Keep the 22 px heading row |
| **XL** | With three things, the second row is empty: half the block is blank. | hk-grid-cards.js `_plan`, COLS, around :440 | When the count ≤ cols, use one row of tall pills (rows = 1, so each pill spans the height), or flow into 2 × 2 + 1 |
| all (square) | Pills keep the Home layout at 15/600 beside 21 px centred tiles (X4). Pill radius 23.5 inside 34 (X3). | hk-tile.js:520 | Inner radius token. On square cells, give the group's tall pills the centred layout or 17 px type |
| Accessories W | The pills draw the short layout (glyph left, words centred) stretched to about 170 px tall | HkGridAccessoriesCard hk-grid-cards.js:730 | Same as Room W: tall layout, or cap the pill height and centre the row |

Screenshots: `$A/zoom/scenes-room.png`, `$A/shots/sheets/room-tablet.png`, `$A/shots/a-accessories-s6.png`

### 6. Scenes (W, L, XL)
| size | issue | where | proposed change |
|---|---|---|---|
| all | Bottom padding is 20 against 12 on the other sides, even with no pager: `max(12px, calc(var(--hk-pager-safe,0px) + 20px))` | **hk-chip.js:1424** | `padding:12px 12px calc(12px + var(--hk-pager-safe,0px))` (or the X1 inset) |
| all | The pills are the short scene pill (glyph left, name) stretched to tall slots: content floats mid-left in a tall box, type 15/700. A Scene block on its own is 17/700 on tiles and 21/600 on square. | hk-chip.js:1428 (`data-group-fill`); hk-tile.js:516–518 | Give the slots the tall scene layout (glyph top, name foot), or the centred layout on square cells. One scene weight (600) |
| XL | Four scenes in six slots leave two holes | hk-chip.js:1318 | Fit rows to the count, as for Room XL |

Screenshots: `$A/shots/sheets/scenes-tablet.png`, `$A/zoom/scenes-room.png`

### 7. Weather (W, T, L, XL)
| size | issue | where | proposed change |
|---|---|---|---|
| **XL** | The hero column is vertically centred (`justify-content:center`), but the hourly strip sits at the top of the right column: the two tops don't line up (place at y≈170 vs hours at y≈75). The daily list is also centred, leaving about 150 px between hours and days on square cells. | hk-weather.js:1911–1913 | `.wb.XL .top{justify-content:flex-start}`; `.wb.XL .days{align-content:start}`; give the grid `grid-template-rows:auto auto 1fr auto`; padding 14/22 → X1 |
| T | On square cells the place and temperature are centred, with about 130 px empty above and below | hk-weather.js:1564 onward | Add three days (or six hours) under the hero on T |
| L (tiles) | Packed well: the model for the others | | |

Screenshots: `$A/zoom/wx.png`, `$A/zoom/wx2.png`, `$A/shots/sheets/weather-tablet.png`

### 8. Doors (L, XL) and Power (W, L, XL)
| size | issue | where | proposed change |
|---|---|---|---|
| Doors XL | The callouts (Front Door, Garage) overlap the "Recent Activity" row on tiles and on square cells | hk-headers.js:1063 (callouts) and the overview layout from :937 | Reserve the picture's box above the activity row; place the callouts inside it, or hide them when they'd cross |
| Doors L/XL | The plate is about 40 % empty under "Nothing opened…" | hk-headers.js:937 onward | Scale the house picture to the room left, or centre the empty message in the leftover |
| Power W | The first line is 8 px from the plate top; the bottom 50–60 % is empty | hk-energy.js:3052 onward (status), mounted `fit fitw` hk-grid-cards.js:1005–1009 | X1 inset; centre the sentences vertically or grow their type |
| Power L/XL | The house picture has no plate, and its chips ("BATTERY 82 %", "THE HOUSE") sit over the art and over each other (XL) | hk-energy.js:3384 onward; hk-grid-cards.js:1011 | Put it on the block plate (as Doors does), keep the chips in a row along the top, and scale the art into the rest |

Screenshots: `$A/shots/sheets/doors-tablet.png`, `$A/shots/sheets/power-tablet.png`

### 9. Timers (S, W) and Battery (S, W)
| size | issue | where | proposed change |
|---|---|---|---|
| Timers S/W (square) | 15/600 name, 56 px ring and 44 px buttons in a 196 px cell beside 21 px tiles. The content is centred but small, and its left edge (13) is off the tiles' line. | hk-home.js:2012–2016 | On `@container hk-cell (min-height:180px)`: ring 72, name 21/600 (X4), the X1 inset |
| Battery S (square) | Title row at the top, then the figure and bar, then about 78 px empty; "charging" is lowercase where every other state is Title Case | hk-energy.js:3153–3157 (`.gb` centred under the title); the `doing` word in `_renderBlock` | Lay it out like a centred tile: battery glyph or level at 33 %, "Battery" plus "Charging" on the centred text lines. Title-case the state |
| Battery W | About 40 px empty band under the battery body on square cells | hk-energy.js:3159 (`.gb .cell{height:76px}`) | Let the body grow: `height:clamp(76px, 40cqh, 110px)` |

Screenshots: `$A/zoom/small-sq.png`, `$A/shots/sheets/battery-tablet.png`, `$A/shots/sheets/timers-tablet.png`, `$A/shots-sq/a-sqscreen-a.png`

### 10. Music, Water, Live TV (L, XL panels)
| size | issue | where | proposed change |
|---|---|---|---|
| Water L/XL (square) | The water day and supply cards don't stretch to the block: about half of each block is bare wallpaper, with no plate under it | hk-grid-cards.js:1038–1046 parts; `.part > *{height:100%}` :1054; HkWaterDayCard hk-headers.js:1708 ignores `height:'100%'` on square cells | Make the water card's plate `height:100%` under `:host([data-hk-cell])`, or plate the part |
| Music L/XL | Speaker chips and buttons top-aligned; "Play to 1 speaker" floats; the lower ~40 % is empty | `.part.plated` hk-grid-cards.js:1065; HkSpeakerPickerCard hk-media.js:1839 | Put the actions at the foot (`margin-top:auto`) and the X1 inset |
| Live TV (empty) | One line of text at the top-left of a big plate | hk-grid-cards.js:1036 / `.empty` :1067 | Centre empty states in the block (shared rule for every panel's `.empty`) |

Screenshots: `$A/shots/sheets/water-tablet.png`, `$A/shots/sheets/music-tablet.png`, `$A/shots/sheets/live_tv-tablet.png`

### 11. Security (S, W, L, XL)
| size | issue | where | proposed change |
|---|---|---|---|
| W | Two inset systems in one block: the name at 12.8/9.8 (KEY_CSS), the mode column at 14 (`.security-extra{right:14px;top:14px;bottom:14px}`). The summary text floats centred in that column. On a Square screen corner the shield well is clipped (X2). | hk-grid-cards.js:836–837 | Use the X1 inset for both. Right-align the summary to the buttons' right edge |
| L / XL | The keypad fills well. In the right column, "Disarmed" sits at the top and the modes at the foot, with a gap between — acceptable. The keys' radius isn't concentric (X3). | hk-grid-cards.js:937 | Inner-radius token for the keys |
| S | Fine (centred on square, Home on tiles) | | |

Screenshots: `$A/zoom/sec.png`, `$A/shots/sheets/security-phone.png`, `$A/shots-sq/a-sqscreen-a.png`

### 12. Scene, Accessory, Action, Everything (S, W): the tiles
| size | issue | where | proposed change |
|---|---|---|---|
| Scene S/W (tiles) | Name 17/700 on one line at the foot, where accessories use 15/600 on two lines. In a mixed row the names don't share a baseline (scene y=116.7, accessory name y=99.9). | hk-tile.js:518 | Scene name 15/600 on the same line as an accessory's name, with "Scene" (or the room) as the second line, as the centred style already does |
| Accessory W (tiles, Home style) | Glyph top-left, words bottom-left: about 75 % of a 402 × 150 pill is empty (and blinding white when lit) | hk-grid-cards.js:686 (`t.size = W ? 'regular' : 'tall'`) and hk-tile.js grid rules :514–516 | Use the Home app's wide tile: the 42 well at left, centred vertically, with name and state beside it. Check that the regular layout really applies in a 150 tall cell |
| all (square, centred) | Good: the glyph at 33 %, the names on one line. "Workbench Outlet" is 13 px from the sides (inset 10), within the corner. | | |

Screenshots: `$A/shots/sheets/small-tablet.png`, `$A/shots/sheets/small-phone.png`, `$A/zoom/small-sq.png`

### 13. Minor
- **Camera (W, L, XL):** fills well. The "1s" age label is 13 px from the left and bottom, inside the corner arc's zone, and there's no camera name. Inset it to the block pad, and add the name as HomeView does (hk-cameras.js mosaic).
- **Calendar (T, L):** clean and aligned. On square cells, with few events, the lower 40 % is empty; show more days on square (the `days` option's default could follow the cell).
- **scene_suggested (W, L), People (W):** fine. The suggested scene uses page-card insets (20/22) and a 56/64 well, unlike the tiles' 42/64 — acceptable as a feature card.
- **Cameras (XL):** fine (full bleed).

---

## Suggested order for the fix session
1. X6 (one line, fixes the Thermostat XL dial), the Scenes padding bug (hk-chip.js:1424), and Clock T "PM" (hk-weather.js:2812).
2. The Vacuum L/XL body height and the Clean Areas placeholder; Now Playing T corner icons (hk-media.js:815–816) and the art radius (:788).
3. X1 + X2 together (inset tokens on `.cell`, read by every block's plate).
4. X3 (inner radius) and X4 (block-title / block-sub roles on square cells).
5. The X5 band fixes, per block, then the rest of the table.

Checks to extend: `tools/headless/home_grid_audit.py --cell square` already measures clipping; it could also assert
- content inset ≥ the block pad,
- that no block's content leaves more than about 35 % of the plate empty,
- that a part's container is itself (X6).

`$A/audit.cjs`'s MEASURE shows how to get each block's inset from its plate.
