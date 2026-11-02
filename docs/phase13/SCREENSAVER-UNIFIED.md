# Phase 13: one screensaver (plan, 2026-11-02)

**Status: the mock-up approved by the owner on 2026-11-02 ("Ok this all looks good"), with decisions 9 to 11; being
built.** The
mock-up is a private claude.ai artifact: https://claude.ai/artifact/WGMhLYgvrFpBEYsLB17hEN (interactive). It follows the Screensaver editor
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

## More pieces: a lock screen for the house

The owner, the same day: "if there are more Cards/Widgets... that we could implement, we should... Think of what
you would potentially want to see at a quick glance for a Screensaver Dashboard. It's almost like an iPhone lock
screen!"

Today's ten pieces become a starting point. The catalog below adds about thirty more, each something worth a glance
from across the room. Every one is drawn from data HK already reads somewhere, or from one entity the owner picks.

### Glance catalog

**Time and Calendar**

| Piece | Inline | Circular | Rectangular | Card | Shows | Wave |
|---|---|---|---|---|---|---|
| Next Event | next event | -- | next two | the rest of today | always | A |
| Countdown | Beach trip in 12 days | days left | -- | -- | always | A |
| World Clock | London 12:42 | a small dial | two cities | -- | always | A |
| Phone Alarm | Alarm 6:30 | the alarm time | -- | -- | while an alarm is set | C |
| To-Do | 3 to do | count | the top three | the list | when the list has items | B |
| Trash Day | Trash tomorrow | the bin | -- | -- | the day before and the day of | C |

**Weather and Sky**

| Piece | Inline | Circular | Rectangular | Card | Shows | Wave |
|---|---|---|---|---|---|---|
| Rain Soon | Rain at 3 PM | the chance | a bar per hour | -- | when rain is coming | A |
| Weather Alert | Wind Advisory until 6 | -- | -- | the alert | while one is active | A |
| UV, Wind and Gusts, Pressure, Feels Like | -- | one each | -- | -- | always | A |
| Moon | Waxing Gibbous | the phase | -- | -- | always | A |
| Sun | Sunset 5:12 | an arc (sunset today) | day length | -- | always | A |
| Pollen | Pollen High | the level | -- | -- | always, once a sensor is picked | C |

**Home**

| Piece | Inline | Circular | Rectangular | Card | Shows | Wave |
|---|---|---|---|---|---|---|
| Security | Armed Away | the alarm's state | -- | -- | always | B |
| Doors and Windows | 2 open | count | names | -- | always, or when something is open | B |
| Garage | Garage open | the door | -- | -- | always, or when open | B |
| Climate | Heating to 70° | inside, ringed to the target | two zones | -- | always | B |
| Lights On | 6 lights on | count | -- | -- | always | B |
| Vacuum | Vacuuming the Kitchen | battery | -- | -- | while running or stuck | B |
| Appliances (washer, dryer, dishwasher) | Dryer done | time left | two | -- | while running, and for an hour after done | C |
| Leak and Smoke | Water at the Laundry | -- | -- | the alert | while one is tripped | C |
| Notifications | the latest | count | the latest two | -- | when there are unread | B |
| Package | Package at the door | the box | -- | -- | after a doorbell's package detection | B |

**People and Travel**

| Piece | Inline | Circular | Rectangular | Card | Shows | Wave |
|---|---|---|---|---|---|---|
| Who's Home | Everyone's home | one person | everyone | -- | always (decision 7) | B |
| Travel Time | Work 24 min | minutes | two places | -- | always, once a sensor is picked | C |

**Energy**

| Piece | Inline | Circular | Rectangular | Card | Shows | Wave |
|---|---|---|---|---|---|---|
| Grid | Exporting 2.1 kW | import or export | -- | -- | always | B |
| EV | Car 80% | charge | -- | -- | always | B |
| Price | Peak until 7 PM | -- | -- | -- | always, once a sensor is picked | C |

**Media and Photos**

| Piece | Inline | Circular | Rectangular | Card | Shows | Wave |
|---|---|---|---|---|---|---|
| Up Next | next song | -- | the next two | -- | while music plays | B |
| Playing In | Kitchen, Living Room | -- | -- | -- | while music plays | B |
| On This Day | 3 years ago today | -- | -- | -- | over a photo from this day | B |

**Cameras** (decision 7)

| Piece | Inline | Circular | Rectangular | Card | Shows | Wave |
|---|---|---|---|---|---|---|
| Camera | -- | -- | its still | its still, larger | always | B |
| Last Ring | Doorbell 4:02 PM | -- | -- | the ring's snapshot | for 30 minutes after a ring | B |

**Any Sensor.** The owner picks any entity the screen may read, with its name, icon and unit.

| Shape | What it draws |
|---|---|
| Inline | its name and state |
| Circular | its value ringed between a min and a max |
| Rectangular | two sensors |

This is the escape hatch for everything else (wave C).

**The waves:**

- **A** uses data the screensaver already reads, such as `hkWxReadings`, the forecast, alerts, `sun.sun` and the
  calendars.
- **B** uses data HK reads on its other pages, such as the alarm, covers, locks, climate, lights, vacuums, to-dos,
  people, Mantel's notifications, energy, Music Assistant and cameras.
- **C** needs one entity picked, with a suggested default the way `accessories.py` suggests a camera's trigger.

### The rules every piece follows

A piece is added only if it meets all of these, so the catalog can keep growing without the editor getting clunky
again:

1. **Declared once, in both mirrors**, with these fields:
   - its shapes;
   - its one data source;
   - the facts it shows (for claiming);
   - when it shows;
   - what wakes a redraw;
   - what it needs picked;
   - its sample reading for the library.
2. **Drawn by the one renderer**, in `--u`, with the same Size, Backdrop and Color. Nothing a piece draws animates,
   and nothing uses `backdrop-filter`.
3. **One read per source, shared.** Two pieces on the same entity read it once. A piece never wakes another (the
   0.1.104 freeze).
4. **"Shows when..." pieces keep their place in the editor**, drawn dotted with when they show, as Now Playing is
   today. On the tablet they collapse. The plan reflows only when one comes or goes, never on a tick.
5. **Facts are claimed.** A face, a slide or another piece that already shows a fact hides the duplicate, and the
   editor says which one shows it.
6. **The screen's role decides the data.** A piece reads only what the wall tablet's role may read. Pieces that
   show people or cameras are off until the owner places them (decision 7).
7. **Every piece appears in `saver_shows_check`** at least once, at the three sizes.

The library groups the pieces as above, with a search field. Each piece shows its shapes, and its sample reading
comes from the house where it can.

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
- **The land's coverage too** (found on a phone on its side, 844 x 390, 2026-11-02): Behind the Land on a short, wide
  screen hid nearly all of the time under the trees. The same 5 to 35% rule decides it: past it, the time stands in
  front.
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
| 0 | A mock-up artifact: the Looks gallery, Look/Info/Slides/Timing, a piece's shapes, the grouped library with the glance catalog, the slide corner on all five slides. The owner answers the decisions. | session (Opus) |
| 1 | Pieces: the v2 catalog in both mirrors, the v1 → v2 read, one renderer and unit system, the Card shapes replacing HK cards, one weather source, the claiming rule; unit and parity tests | Sonnet 5.5 high for the renderer, from a written spec; the session for the model |
| 1b | The glance catalog, wave by wave (A, then B, then C), each piece to the rules above; Any Sensor's picker | Sonnet 5.5 high agents in parallel, one per group, from written per-piece specs; the session reviews each against the rules |
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

| # | Question | Answer (the owner, 2026-11-02) |
|---|---|---|
| 1 | Planted becomes a face on the Landscape instead of a depth? | **Yes** |
| 2 | Tapping a Look keeps the Info; replacing everything becomes a separate "Start Over from This Look"? | **Yes** |
| 3 | The classic HK cards (Now Playing, Timers, weather, status) on the screensaver replaced by the pieces' Card shape, without their controls? | **Yes** |
| 4 | The slide corner's time follows the Look's face color and font, or one fixed corner style? | **Follow the Look** (Flip and Analog, which have no text form, use Classic's) |
| 5 | Every screen through one renderer, so screens with no saved layout may shift slightly? | **Yes, after the phase 4 shots** |
| 6 | Big Weather's slide corner: Date and House Status only, since it already shows a time or temperature? | **Yes** |
| 7 | Pieces that show people (Who's Home) or cameras (Camera, Last Ring) stay off until placed, since anyone walking by sees a screensaver? | **Yes** |
| 8 | Any pieces to add to or drop from the glance catalog before building? | **Build it as listed** (all three waves) |
| 9 | (the owner, on the mock-up) Circular widgets in sync? | **One size for the row**, every piece in it the same; one piece made bigger only on purpose (its own Size) |
| 10 | (the owner) Color, and black or white? | **Accents** (a little meaningful color: rings, glyphs, dots), on by default; **Ink**: Auto, White or Black for the whole screen. Auto picks black or white from the background's luminance, once for every piece, card and band on the screen, never some white and some black |
| 11 | (the owner) Up to 200%? | **Yes**: a piece's Size is 60 to 200%; a bigger one takes more of the row, which reflows |

One detail the mock-up settled: a placed piece a new Look has no place for (the Month has no row) **waits in Info**,
listed as waiting, and comes back with a Look that has the place, instead of being dropped. A piece whose zone can't
take its new shape still moves to the nearest zone that can.

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
- 2026-11-02: the glance catalog (about thirty more pieces in three waves) and the rules every piece follows, from
  the owner's "almost like an iPhone lock screen".
- 2026-11-02, phase 0: the mock-up (Looks that keep the Info, Look/Info/Slides/Timing, a piece in each shape, the
  grouped library with the glance catalog, the slide corner on all five slides at three sizes); the owner answered the
  eight decisions with the recommendations.
- 2026-11-02: the owner approved the mock-up, adding decisions 9 to 11 (one row size, accents and one ink for the
  screen, sizes to 200%). The pieces' contract: `docs/phase13/PIECES-SPEC.md`.
- 2026-11-02, phase 1: the pieces. Layout v2 in both mirrors (a piece in a shape; the row's one size; the screen's one
  ink, Auto from the background's luminance; the accents; sizes to 200%; **Show When...**, a condition on one entity,
  on any piece, the owner's "Mail Box... only shows when the Mail Has Arrived"); v1 read and written as v2; one
  renderer for every shape, the Card shapes replacing HK's corner cards (Sonnet 5.5 agent, from `PIECES-SPEC.md`);
  claiming; "shows when" pieces collapse on the tablet. WebKit found: the forecast's own band drawn over a layout (now
  off with a layout), cards a fixed 30 u wide (now as wide as their words, 24 to 44 u), Home Status's alarm twice, the
  lock's circle without its ring, a card's art hanging under the margin (pictures taller than its words now count for
  its foot). The layout checks now run a phone on its side too (844 x 390, the owner: "What about landscape phone").
  Also fixed: Mantel's server took a touch on the music slide's buttons for the screen in use, which took the
  screensaver down (the owner: "it kills the screensaver and goes back to the dashboard").
