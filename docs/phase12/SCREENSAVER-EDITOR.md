# Phase 12: the Screensaver editor (design, 2026-11-01)

**Status: approved by the owner on 2026-11-01 ("Let's do the editor!"); being built.** The mock-up is a private claude.ai
artifact: https://claude.ai/artifact/APFvu28rNZ5LCLe7v6Gi29 (interactive). It is drawn with HK's own landscape and one CC0
photo from `web/hk/landscapes/`.

The ask (the owner, 2026-11-01): a screensaver editor in the Home Grid editor's style, "click placement, style,
size... background", with widgets like the iPhone's lock screen, with or without a backdrop. It must do everything
the Screensaver settings do today, picking the screensaver's type included. It also fixes two problems:

- **The corners collide.** Photos with Time Behind at its largest runs into Home Status and the weather (seen on the
  wall tablet, 2026-11-01). Each Show places the corner cards with its own CSS (about 39 rules over 12 host-attribute
  contexts in `hk-saver.js`), and none of them knows how big the time is.
- **The Shows overlap.** Clock, Photos and Forecast can almost make the same look three ways, with 74 options between
  them.

## The idea

A screensaver becomes **one background, one big element, and widgets in zones**.

- **Background:** Photos, Landscape (the live sky over the season's land), Sky Only, Moving Color (the Clock's
  generated backgrounds), Wallpaper, the Day's Art, Plain (Glance's and Month's calm grounds), or Black.
- **The big element:** the Time (any of the Clock's faces, Big Weather's included), the Temperature, the Date, the
  Month, or None. This is Big Weather's Big Number made general. Its size, position, alignment and depth (In Front,
  Behind the subject or the trees, Planted on the meadow) are the layout's.
- **Zones:**
  - a line above the big element (inline widgets);
  - a row under it, four units wide, as on the iPhone (circular widgets one unit, rectangular two);
  - the four corners (cards, or inline widgets at the top);
  - a band along the bottom (the forecast details, the readings).

  The pane down the side stays the **Side Pane**: it already has its own settings, shared with the dashboard. The
  editor shows it, links to its page, and lays the zones out in the room it leaves.
- **Zones know about each other.** A corner the big element reaches moves to the other end of its side and stacks
  with what is there. It is left out only when even that is in the way, and the editor says so.
- **Today's Shows become starters:** Photo Frame, Forecast, Big Weather, Clock, Photos & Forecast, Lock Screen,
  Glance, Month, Day, Nightstand.

## Decisions (the owner, 2026-11-01)

| # | Question | Answer |
|---|---|---|
| 1 | Build it? | **Yes**: "This will solve the Time Behind overlap issue as well!" |
| 2 | Scope | **Everything the Screensaver settings do today**, the screensaver's type included |
| 3 | Look | The Home Grid editor's: top bar, library left, the screen center, inspector right |
| 4 | Widgets | Lock-screen style, circular, rectangular and inline, each with or without a backdrop |
| 5 | Agents | Sonnet 5.5 at high effort for well-specified jobs, to spare usage |

## How it is stored

**One new option, `layout`, inside the screensaver options** (`hk_core/settings/model.py` SAVER_DEFAULTS), default
`None`. Inside the options it follows All Screens ("Same as All Screens", Reset), Copy Settings, settings history and
Look undo with no new plumbing.

- **`layout: None` draws exactly as today.** Nothing is migrated: a screen changes only when someone saves it in the
  editor. The editor opens on a layout made from the screen's current options (`layoutFrom()`), so it starts from
  what is on the wall.
- **The background stays in today's keys:** `show`, `clock_bg`, the Wallpaper keys, every photo, mosaic and forecast
  key. Their validators, their pages and the renderer's paths all stay. The editor's Background picker writes them:

  | Background | Written as |
  |---|---|
  | Photos | `show: photos` (or `both` with the Forecast slide on) |
  | Landscape | `show: forecast` |
  | Sky Only, Moving Color, Wallpaper, Black | `show: clock` with that `clock_bg` |
  | The Day's Art | `show: day` |
  | Plain | `show: glance` or `month` |

- **The face settings stay in today's keys too:** `clock_style`, `clock_colors`, `clock_24`, `clock_text_shadow`,
  `clock_text_outline`, `forecast_planted`.
- **The layout holds only what has no key today:**

  ```json
  {
    "v": 1,
    "big": { "kind": "time", "size": 24, "pos": "top", "align": "center", "depth": "front" },
    "zones": {
      "line": [{ "id": "date", "back": "none", "color": "auto" }],
      "row": [{ "id": "temp", "back": "none", "color": "auto" }, { "id": "aqi" }],
      "tl": [], "tr": [{ "id": "status_card" }], "bl": [{ "id": "music_card" }], "br": [],
      "bottom": []
    },
    "upright": null
  }
  ```

  - `big.kind`: `time`, `temp`, `date`, `month` or `none`.
  - `big.size`: 12-44, the percentage of the screen's shorter side.
  - `big.pos`: `top`, `upper`, `center`, `lower` or `ground`.
  - `big.align`: `left`, `center` or `right`.
  - `big.depth`: `front`, `behind` or `planted`.
  - Each widget: `{ id, back: none|glass|tint, color: auto|white|accent }` and any options of its own. A zone takes
    only the kinds the catalog allows, up to its capacity.
  - `upright`: `null` (the same layout upright) or `{ big?, zones? }` for its own.
- **One widget catalog in two mirrors:** `web/hk/modules/hk-saverlayout.js` and `hk_core/settings/saver_layout.py`,
  kept equal by a test, as Home Grid's catalog is.
- **Validation:**
  - Python has a strict `check()` for writes, raising `Invalid("saver_layout")`, and a tolerant `layout()` for reads
    that drops what this build doesn't know.
  - A save that doesn't touch `layout` keeps the stored value, as `home_grid` does in `changes.apply_board`.
  - JS mirrors the checks for the editor.

## How it draws

**A layout mode inside `hk-saver.js`, not a second renderer.** The saver's lifecycle stays as it is: wake, the black
screen, the kiosk's own screensaver, slides, photos, Night Mode and touch. With `cfg.layout` set:

- **The background** is today's path for its keys (photos, `hkSky.scene`, the Clock's painters, wallpapers).
- **The big element** goes in a `.lay` layer (z 3):
  - The time is a Clock face mounted into a box (`hkSaverClock.mount`). Its faces are sized in container units, so a
    box is all they need.
  - The temperature, the date and the month are drawn by `hk-saverlayout.js`, after Big Weather, Day and Month.
  - **Planted:** `plant()` (hk-saverfaces.js) with the layout's position and alignment.
  - **Behind on photos:** today's Time Behind cut-out (`photoFaces`), at the layout's size and place. A box too small
    for the subject falls back to the time in front, as today.
  - **Behind on the landscape:** the big element in a slot `hkSky.scene` opens between the sky and the land.
- **Widgets:**
  - New lock-screen widgets come from `hk-saverlayout.js`, fed from what the saver already reads: `hkWxReadings`, the
    daily forecast, `sun.sun`, the AQI sensor, music, timers, Home Status and the energy summary.
  - The existing cards (Now Playing, Timers, Home Status, the forecast band) are reused, placed
    through their own `--hk-ss-*` variables in their zone's box.
  - In layout mode the old per-Show corner rules don't apply.
- **One plan function:** `plan(W, H, layout, sizes)` → every box, the moved and hidden notes. It is pure, testable
  under jsc, and shared by the renderer and the editor's overlay, so what the editor shows is what the tablet draws.
- **The wall tablets' rules stay:**
  - Nothing new animates. Widgets redraw on the minute or on a change of their data.
  - No `backdrop-filter` on the tablets: Glass is a static scrim there, as in the rest of the saver.
  - Opacity-only hiding, held still when dark.

## The editor

`web/hk/panels/hk-saver-editor.js`, a sibling of `hk-grid-editor.js`. It reuses `hkSettingsKit`, `hkSettingsModel`,
`hkDrag` and the panel's `callWS`, and does not copy them.

- **Routes:** `#/screens/<path>/screensaver-editor` for a screen and `#/house/screensaver-editor` for All Screens.
  "Edit Screensaver" opens it from each Screensaver page.
- **Top bar:** Cancel (Discard Changes? when dirty), the title, Undo (⌘Z, 50 steps), Preview / Edit, Save. Save sends
  `hk_frontend/board/set` with `screensaver_options` and `expect_version`. A conflict offers Reload or Save Anyway.
- **Left:** the starters, then the widgets by kind with sample readings. Tap to pick, then tap a green zone. Drag on a
  computer is a later nicety, since touch is the iPad's way.
- **Center:** the real screen in an inert iframe with `hk_preview=saver`, given the draft through
  `hkSaver.preview(on, shape, house, over)`. The overlay of zones comes from the same `plan()`. Wall Tablet, iPad
  Upright and Phone sizes; Day and Night; See a Slide.
- **Right, the inspector:**
  - Nothing selected: Background (with its own options inline: photos, mosaic, weather, pattern, wallpaper),
    Slides, When (Starts After, Back to Home, Night Mode, This Tablet) and Layouts (upright).
  - The big element: kind, face, color, 24-hour, size, position, alignment, depth, legibility.
  - A widget: backdrop, color, and the options it has today (music's place, the forecast's parts).
  - The Side Pane: on or off for the screensaver, with a link to its own page.
- **Every one of today's 74 options has a place** (the mock-up's table). The deep photo options (portrait and
  landscape fill, blur, zoom, focus; mosaic spacing and lines) open today's rows on a sub-page rather than being
  drawn again.

## Phases

| | What | Who |
|---|---|---|
| A | `layout` in the model (Python and JS), the catalog and its mirror, validation, `layoutFrom()`, strategy and `readCfg` pass-through, tests (parity included) | this session |
| B | `plan()`: zones, the row's units, corners that move and stack, upright; jsc tests | this session |
| C1 | The lock-screen widgets' drawing and data (`hk-saverlayout.js`), unit tests | Sonnet 5.5, high effort, from a written spec |
| C2 | Layout mode in `hk-saver.js`: the big element (faces in a box, temperature, date, month, Planted, Behind), the cards placed by zone, the slides | this session |
| C3 | A headless WebKit check: the starters at five sizes, nothing overlapping, the corners moving, day and night | Sonnet 5.5, high effort |
| D | The editor: frame, library, canvas, overlay, inspector, save and undo | this session, with agents for the library and inspector rows |
| E | The Screensaver pages: Edit Screensaver first, today's groups under it until the editor has shipped a release, then trimmed; the guide and its screenshot | this session |

Each phase lands on main on its own, inert until the next uses it. A screen draws as it does today until a layout is
saved, so A through C can ship before the editor without changing anything on the wall.

## Open questions for later

- When the editor has shipped, should the Screensaver pages keep today's per-Show groups (under "More Options"), or
  only When and Edit Screensaver?
- A "Same as Sideways" upright layout first; its own upright layout later (Phase D2)?

## Build log

- 2026-11-01: plan written from three code maps (hk-saver.js, the Home Grid editor, settings storage).
- 2026-11-01, phase A and B (b96e2ac3): the `layout` option, its catalog in two mirrors, `plan()`.
- 2026-11-01, phase C (455e6d14): layout mode in `hk-saver.js`; `hk-saverwidgets.js` (Sonnet 5.5 agent). The first
  WebKit runs found the corner cards measured by a width they were given (Home Status pushed aside for nothing), the
  two sides' cards meeting on an iPad upright (now one stack), and the old corner cards' tablet-sized type on a phone
  (now in the screen's units).
- 2026-11-01, phase D: `hk-saver-editor.js` at `#/screens/<path>/screensaver/editor` and `#/house/screensaver/editor`,
  an "Edit Screensaver" row first on both Screensaver pages; the overlay drawn from the plan the screensaver itself drew
  by (`hkSaver.layoutInfo`). Checked in WebKit: open, a starter, the big element's page, a widget out and another in by
  tapping, the three shapes, Save storing the layout.

  Still to do: Phase E (the Screensaver pages around the editor, the guide and its screenshot); the background
  thumbnails telling Sky Only, Moving Color, Wallpaper and Black apart; Behind the Trees on the landscape; the
  Legibility sliders for a layout's time; an upright layout of its own.
