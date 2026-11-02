# Phase 13: one screensaver (plan, 2026-11-02)

**Status: plan, waiting on the owner's answers to the decisions below.** It follows the Screensaver editor
(`docs/phase12/SCREENSAVER-EDITOR.md`), which is on the house in 0.1.113 / 1.35.0.

## The ask (the owner, 2026-11-02)

- The editor is "extremely clunky".
- Many cards, widgets and info pieces don't account for every screensaver look and option. Unify them so they work
  together.
- Keep the slides the owner likes, and design with them in mind: Weather, the Forecast (Classic and Big), Home
  Energy's rings, and Music. A slide needs only the Time, Date, Weather and House Status, and only where they
  apply: the Weather slide needs no extra weather.
- The editor has to make sense. Every clock styling option works with the time both in front of the photo's subject
  and behind it.
- Keep the starters, but changing the look must not mean starting over.

## What is wrong today (from the code, 2026-11-02)

**One fact, five drawings.**

- The outside temperature is drawn by:
  - the `temp`, `weather_line`, `weather_card` and `next_hours` widgets;
  - the forecast band's Today column;
  - the Temperature big element;
  - the Today, Glance and Big Weather faces;
  - the Weather slide;
  - Home Energy's corner.
- They use three styling systems:
  - `.hksw` with `--u`, for the layout widgets;
  - HK's px cards rescaled to vmin by `cardConf` (`hk-saver.js:1706`);
  - each slide's px × `--z`.
- They read the data two ways: `hkWxReadings`, or the raw weather entity, as the Today face does.
- The date, time, Home Status and music repeat the same pattern.

**The layout sits on the old system instead of replacing it.**

- A screen with no layout draws through roughly 39 per-Show corner rules.
- A screen with a layout still carries the classic clock and weather cards hidden (`ly_spare`, `hk-saver.js:275`)
  and brings them back under a slide (`lyoff`, `layoutSlides()`).
- About seven separate CSS rules hide the same clock and weather cards: `enslide`, `wxslide`, `fcbig`, `band`,
  `ckown`, `ckface=glance/month` and `tb`.
- The Weather and Home Energy slides draw their own time, date and weather besides.

**Depth decides which options work.**

| Option | In Front | Behind the Subject | Behind the Land | Planted |
|---|---|---|---|---|
| Face, Color | yes | ignored (plain digits) | yes | ignored (ivory numerals) |
| Align | yes | ignored | yes | yes |
| Shadow, Outline | over photos only | ignored | ignored | ignored |
| Darken (`tb_dim`) | dead | yes | n/a | n/a |

Behind the Subject also vanishes under a Mosaic and while a forecast slide shows. Planted needs `show: forecast`.

**Dead or broken combinations.**

- Night Mode does nothing for a layout on most backgrounds: `mountClock` returns before `ckCtl` exists
  (`hk-saver.js:3307`).
- The Day's Art draws no art under a layout (`groundOnly`).
- Soft Photos never blurs: no setting writes `clock_photo_soft`.
- The Weather slide is dead on Landscape, Calm Color, Paper and Day. Home Energy is dead on Calm Color, Paper and
  Day (`extrasOf`). The editor offers both anyway.
- The music slide overlaps its corners on a phone. The check skips phones (`saver_shows_check.cjs:233`).
- The Today face's weather and song draw again beside a weather or music card, because `ckown` is never set for a
  layout's time.

**Starters wipe the work.**

- Tapping a starter replaces `layout` wholesale (`hk-saver-editor.js:504-511`). Placed widgets, their sizes and
  backdrops, `row_at`, and the upright layout all go.
- Photo Frame also drops Forecast Between Photos.
- Six starters build their widgets from legacy flags (`clock`, `weather`, `music`, `timers`, `status`,
  `clock_over`, `band`) that no page shows. The same starter can therefore come out differently on two screens.

**Options live in several places.**

| Option | Where it can be changed |
|---|---|
| Face and Color | the editor, and an orphaned Clock Style page (`hk-settings.js:2097`) |
| Slide toggles | the editor, and Settings' "Now and Then" |
| Music full screen | two keys: `music_first` (editor) and `music_slide` (Settings) |
| `forecast_planted` | the editor's depth, and a Settings toggle |
| Forecast Classic or Big | Settings only |

"Depth", "Look" and "Layout" each mean two or three things in the editor.

## The idea

A screensaver is a **Look**, then **Info**, then **Slides**.

- **The Look** is the background and the time: Photos, Landscape, Moving Color and so on, plus the time's face,
  color, size, place, depth and legibility. A starter sets the Look only.
- **Info** is the pieces placed around the time. It keeps its own state, so changing the Look keeps it.
- **Slides** are the screens that come between: the Forecast (Classic or Big), Weather, Home Energy and Music. Each
  slide says what it already shows. The screensaver adds only the Time, Date, Weather and House Status the slide
  lacks, in one shared slide corner.

There is one renderer. Every screen draws through the layout path. A screen with no stored layout gets
`layoutFrom()` at read time, and the per-Show corner rules and the hidden spare cards are deleted.

## The pieces: one catalog of facts, each in a few shapes

The library lists about ten **pieces**, one per fact. Each comes in a few **shapes**, the way an iPhone widget comes
in sizes, instead of 25 ids. Every piece is drawn by one renderer (`hk-saverwidgets.js`, grown), in one unit system
(`--u`, from the screen's shorter side), with the same Size, Backdrop and Color.

| Piece | Inline | Circular | Rectangular | Card | Band |
|---|---|---|---|---|---|
| Weather | 72° Sunny | 72° ring | now plus 2 hours | today, high and low | the forecast |
| Readings (humidity, wind, AQI, sunset, inside) | -- | one reading | two | -- | the row |
| Date | Mon, Nov 2 | -- | -- | -- | -- |
| Time (small, when the big element isn't the time) | 7:42 | -- | -- | the clock card | -- |
| House Status | 2 open, locked | locks ring | three lines | the status card | -- |
| Music | song · artist | -- | -- | Now Playing | -- |
| Timers | -- | the next one | -- | Timers | -- |
| Calendar | next event | -- | next two | -- | -- |
| Energy | -- | battery, solar | today | -- | -- |
| Photo Title | the title | -- | -- | -- | -- |

- **One data source per fact.** Weather pieces, the Temperature big element and every face read `hkWxReadings`.
  The Today face is the one that changes.
- **The classic HK cards leave the screensaver.** Now Playing, Timers, the weather card and the status card become
  the pieces' Card shape, drawn in the pieces' style. The screensaver is passive (a touch wakes it), so the cards'
  controls aren't missed. HK's own cards stay on the dashboard.
- **A face that draws a fact claims it.** The Today face shows weather and the song, Glance shows music, and Big
  Weather shows the readings. The plan then hides a piece showing the same fact and the editor says so ("The Today
  face shows the weather"), instead of drawing it twice.
- **Model v2.** A widget is `{ piece, shape, size?, back?, color?, opts? }`. The tolerant read maps every v1 id to a
  piece and shape (`temp` → Weather/circular, `status_card` → House Status/card...). Saves write v2. The
  Python/JS parity test covers the new catalog.

## Slides: the slide corner

Each slide declares `shows: {time, date, weather, status, music}` next to where it is defined. One function picks
what the shared corner draws:

| Slide | The slide shows | The corner adds |
|---|---|---|
| Music | music | Time and Date top left, Weather inline under them, House Status top right |
| Forecast, Classic | weather (the band) | Time and Date, House Status |
| Forecast, Big | weather, a small time or temperature | Date, House Status |
| Weather | weather, the readings | Time and Date, House Status |
| Home Energy | energy | Time and Date, Weather inline, House Status |

- The corner is drawn by the pieces' renderer. Its time takes the Look's face color and font where the face has a
  text form (decision 4). The Weather and Home Energy slides stop drawing their own corners.
- The seven hide rules, `ly_spare` and the `lyoff` card swap go away.
- Slides are overlays, independent of the background, so every slide works on every background.
- A phone gets its own music slide arrangement (song under the art), and the WebKit check covers phones.

## The time: every option at every depth

**Depth** becomes two choices: **In Front**, or **Behind** what is in the picture. Behind means the subject on
photos, or the land and trees on the Landscape.

- **Behind works with any face.** The order is photo, then face, then the subject's cut-out, for any DOM face and
  for the Temperature, Date and Month too. The 5 to 35% coverage check uses the face's ink box from `inkOf`.
  Behind the Land already works this way. When a photo has no usable cut-out, the time stays in front for that
  photo, as it does today.
- **Planted becomes a face**, offered on the Landscape: the ivory numerals standing in the meadow. A face is
  something you pick, while a depth is where something stands, so the Face list stays honest (decision 1).
- **Every face option applies at both depths:** Face, Color, 24-hour, Size, Position, Align, Shadow and Outline.
  Legibility appears whenever the background is busy (Photos, Landscape, HK Landscapes, Soft Photos), not only over
  photos.
- **Darken moves to the background** as a Photos option that always works.
- **Behind shows on a Mosaic too:** the cut-out uses the tile under the time, or the time goes in front with a note.
  The session decides which after trying it.

Also fixed in this phase:

- Night Mode for every layout, with `ckCtl` made for a layout's time.
- The Day's Art drawn under a layout.
- Soft Photos blurred, using the key it always meant to write.
- The Today face's duplicates, handled by the claiming rule above.

## The editor

- **Looks, not starters.** The left pane's top section is **Looks**: today's starters, each a picture.
  - Tapping one changes the Look only: the background keys, the face and the big element's place. The Info stays.
    Pieces the new Look can't hold move to the nearest zone that takes their shape, and only then drop, with the
    editor saying which.
  - **Start Over from This Look**, at the foot of a Look's own page, is the old replace-everything behavior.
  - A Look's pieces come from its definition, never from hidden legacy flags.
- **Four inspector sections, always in this order, when nothing is tapped:**
  - **Look:** the background and its options, the time.
  - **Info:** what is placed, a list you can reorder.
  - **Slides:** each slide on or off, how often, Forecast Classic or Big, and what its corner shows, with a See It
    button.
  - **Timing:** a link to Starts After, Night Mode and the rest.
- **No dead rows.** Each inspector row declares `applies(state)` and is left out when it does nothing. If Behind
  isn't possible for this background, the depth control says why rather than offering it.
- **See a Slide** and **Day / Night** above the screen, as phase 12 planned. The slide preview draws the real slide
  corner, so the owner can check that the Music slide shows the time and the Weather slide shows no second weather.
- **One home per option.**
  - The orphaned Clock Style page redirects to the editor.
  - `music_first` and `music_slide` become one key, migrated on read.
  - `forecast_planted` follows the Planted face.
  - The forecast's Classic/Big choice moves into the editor's Slides section.
  - Settings keeps only what can't be laid out (decision 3 of phase 12 still holds).
- **Words.** "Depth" is used only for the time, and Moving Color's parallax becomes "Motion". "Look" is used only for
  the Look. "Layout" leaves the visible text: Upright Screens is "Same as Sideways / Its Own", and Back to Today's
  Look and Remove the Layout become one **Reset** row in the editor.

## Phases

| | What | Who |
|---|---|---|
| 0 | A mock-up artifact: the Looks gallery, Look/Info/Slides/Timing, a piece's shapes, the slide corner on all five slides. The owner answers the decisions. | session (Opus) |
| 1 | Pieces: the v2 catalog in both mirrors, the v1 → v2 read, one renderer and unit system, the Card shapes replacing HK cards, one weather source, the claiming rule; unit and parity tests | Sonnet 5.5 high for the renderer, from a written spec; the session for the model |
| 2 | Slides: `shows` declarations, the shared slide corner, the Weather and Energy slides' own corners removed, slides on every background, the phone music slide | session |
| 3 | The time: Behind with any face and with Temperature, Date and Month; Planted as a face; options at every depth; Darken; Night Mode, the Day's Art and Soft Photos under a layout | session (the cut-out ordering is delicate) |
| 4 | One renderer: `layoutFrom()` at read time for screens with no layout; delete the per-Show corner rules, `ly_spare`, `lyoff` and the seven hide rules; before/after WebKit shots of every old Show | session, a Sonnet agent for the shots |
| 5 | The editor: Looks that keep Info, the four sections, `applies()`, See a Slide, Day/Night, one home per option, the words | session, Sonnet agents for the inspector rows |
| 6 | Checks and docs: `saver_shows_check` over every Look × slide × three sizes with phones not skipped, `sheet_review.py` where sheets changed, the guide page and its screenshots, both changelogs | Sonnet 5.5 high |

- Each phase lands on main on its own.
- Phases 1 to 3 change how things draw. Phase 4 is the one that changes screens with no layout: compare its
  before/after shots with the owner before it releases.
- Release through `release_house.py` once the owner says so, after reading every commit since 0.1.113.

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Planted becomes a face on the Landscape instead of a depth? | Yes |
| 2 | Tapping a Look keeps the Info; replacing everything becomes a separate "Start Over from This Look"? | Yes |
| 3 | The classic HK cards (Now Playing, Timers, weather, status) on the screensaver replaced by the pieces' Card shape, without their controls? | Yes |
| 4 | The slide corner's time follows the Look's face color and font, or one fixed corner style? | Follow the Look |
| 5 | Every screen through one renderer, so screens with no saved layout may shift slightly? | Yes, after the phase 4 shots |
| 6 | Big Weather's slide corner: Date and House Status only, since it already shows a time or temperature? | Yes |

## Rules that still hold

- No `backdrop-filter` on the tablets (Glass is a static scrim).
- Nothing new animates. Pieces redraw on the minute or on a change.
- Opacity-only hiding. No loops between pieces: see 0.1.104's Battery/Energy freeze, guarded by
  `saver_shows_check saver-lay-energy`.
- HK Frontend's build never says "Mantel" in visible text (`tests/test_mantel_settings.py`).
- American English. Settings pages stay iOS Settings (the house's DESIGN.md). The editor needn't run on an iPad,
  but it must still not break there.
- Test against the real house too: the gallery has no subject masks.

## Build log

- 2026-11-02: plan written from two code maps (the screensaver's pieces, slides, depths and editor; the last week's
  patches).
