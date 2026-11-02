# Phase 13: the pieces (spec, 2026-11-02)

The written spec phase 1 builds from (`docs/phase13/SCREENSAVER-UNIFIED.md`, "The pieces"), with the owner's three
follow-ups on the mock-up (decisions 9 to 11 there). Phase 1b's glance pieces follow the same contract.

## The model: layout v2

A layout is `{ v: 2, big, zones, row_at, upright, row_size?, ink?, accents? }`.

- `row_size`: one size for every piece in the row, 60 to 200 (% of usual), stored only when it isn't 100
  (decision 9: "one common size", so circular widgets don't vary).
- `ink`: `auto` | `white` | `black` (decision 10). **One ink for the whole screen**: every piece, card and band on
  it is white or black together. `auto` picks from the background's luminance (photos: the photo showing; fixed
  backgrounds: their known tone), never piece by piece. Stored only when it isn't `auto`.
- `accents`: `true` | `false`, default `true` (decision 10: "a little bit of color"). Each piece's meaningful parts
  (a ring's arc, a glyph, a status dot) take the piece's accent color; off, they are the ink. Stored only when false.

A widget is `{ piece, shape, size?, back?, color?, opts? }`.

- `shape`: `inline` | `circular` | `rectangular` | `card` | `band`.
- `size`: 60 to 200 (decision 11). In the row it is the piece's **own** size, set on purpose ("make this one
  bigger"); without it a row piece takes `row_size`. Elsewhere it is the piece's size. Stored only when it isn't 100
  (corners) or when set (row).
- `back`: `none` | `glass` | `tint`. Glass is a static scrim, never `backdrop-filter`.
- `color`: `auto` (the screen's ink) | `accent` (the house's accent). v1's `white` reads as `auto`.
- `opts`: the piece's own choices, from the catalog (`readings` circular: `{ reading }`).

**Zones** (the shapes they take; room): `line` (inline; 1), `row` (circular, rectangular; 8 units in lines of 4),
`tl`/`tr`/`bl`/`br` (inline, card; 2 each), `bottom` (band; 1). A row piece's units are its shape's (circular 1,
rectangular 2) times its size: a 200% circular takes two units, and the row reflows.

**The read** (`clean()` / `layout()`) takes v1 and v2. v1 ids map to a piece and shape:

| v1 id | piece / shape | opts |
|---|---|---|
| temp | weather / circular | |
| aqi, humidity, inside, sunset | readings / circular | `{reading: aqi \| humidity \| inside \| sunset}` |
| battery, solar | energy / circular | `{reading: battery \| solar}` |
| timer | timers / circular | |
| locks | status / circular | |
| next_event | events / rectangular | |
| next_hours | weather / rectangular | |
| home_status | status / rectangular | |
| energy_today | energy / rectangular | |
| date | date / inline | |
| weather_line | weather / inline | |
| status_line | status / inline | |
| event_line | events / inline | |
| photo_title | title / inline | |
| clock_card | time / card | |
| music_card | music / card | |
| timers_card | timers / card | |
| weather_card | weather / card | |
| status_card | status / card | |
| forecast_band | weather / band | |
| readings | readings / band | |

**The write** (`check()`) takes v1 or v2 and the store keeps v2. Both mirrors (`hk-saverlayout.js`,
`hk_core/settings/saver_layout.py`) hold the catalog (pieces, their shapes, their opts), the zones and the v1 map, kept
equal by the parity test.

## The renderer: `hk-saverwidgets.js`

One file draws every piece in every shape, in `--u` (1% of the screen's shorter side).

```
hkSaverWidgets.create(piece, shape, { u, back, color, h24, weather, opts }) ->
  { el, piece, shape, facts, live, showing, measure(), update(client, now, ctx), setU(u), destroy() }
hkSaverWidgets.PIECES        // piece -> its declaration (below)
hkSaverWidgets.has(piece, shape)
hkSaverWidgets.define(piece, declaration)   // a glance group's file adds its pieces (phase 1b)
hkSaverWidgets.sample(piece, shape, opts)   // an element drawn from the sample, for the editor's library
hkSaverWidgets.CSS
```

`ctx`: `{ title, events, music, face }`. `music` is the screensaver's `musicOf()` reading (or null); `face` is
`{ font }`, the Look's face's CSS font where it has a text form (the time pieces take it).

**Every piece is declared once** (the plan's rule 1), next to its drawing:

```
{ name, group, wave, facts: [...], source: 'hkWxReadings' | ..., when: null | 'while music plays',
  wakes: ['minute' | 'house' | 'second' | 'forecast' | 'calendar' | 'energy'], pick: null | {...}, off: false,
  opts: { key: [choices] }, accent: [light, dark] | function (spec) -> [light, dark],
  shapes: { inline: {read, draw, sample}, circular: {...}, ... } }
```

- `read(X)` -> a JSON-able spec; `draw(spec)` -> markup; `sample` -> a spec for the library.
- `showing`: false while a "shows when..." piece has nothing to show. The screensaver plans without it and reflows
  only when `showing` changes, never on a tick (rule 4). The editor draws its place dotted.
- `live`: true while it wants a call every second (a running timer).

**Ink and accents.** The layer the pieces are in carries `data-ink="white|black"` and `data-acc` (accents on).
`.hksw` draws in `var(--sw-ink)`: `c-auto` takes the layer's ink, `c-accent` the house accent. Parts with meaning
carry class `a` and draw in `--sw-acc` (light ink) or `--sw-acc-d` (black ink) when accents are on, else the ink.
Black ink flips the legibility: a light text shadow, a lighter Glass, a light Tint.

**Units.** circular 13 u square; rectangular 29 x 13 u; inline 3.6 u high; card about 30 u wide, as tall as it
draws; band the zone's width, 10 u (readings) or 15 u (the forecast). Everything scales with `size`.

## The core pieces (phase 1)

| Piece | Facts | Inline | Circular | Rectangular | Card | Band | Accent |
|---|---|---|---|---|---|---|---|
| weather | weather | glyph, "64° Cloudy" | today's range gauge (v1 temp) | now + 2 hours (v1 next_hours) | "64°", glyph, condition, H/L | Today, 6 hours, 4 days | by temperature, glyphs by condition |
| readings | readings | -- | one reading (`opts.reading`: humidity, aqi, inside, sunset, wind) | two readings | -- | sunset, wind, humidity, AQI (v1 readings) | AQI by category; others their own |
| date | date | "Monday, November 2" | -- | -- | -- | -- | -- |
| time | time | the small time (Look's face font) | -- | -- | time over the date | -- | -- |
| status | status | the line (v1 status_line) | locks (v1 locks) | three lines (v1 home_status) | Home: the alarm, then what's open | -- | green secured, amber open, red alarm |
| music | music | note, song · artist | -- | -- | art, song, artist, room | -- | -- (the art) |
| timers | timers | -- | the next to end (v1 timer) | -- | up to three running | -- | orange |
| events | calendar | next event (v1 event_line) | -- | next two (v1 next_event) | -- (wave A) | -- | the calendar's |
| energy | energy | -- | battery or solar (`opts.reading`) | today (v1 energy_today) | -- | -- | battery green, solar yellow |
| title | title | album · year | -- | -- | -- | -- | -- |

Shows when: music while something plays (paused, until the screensaver's music grace ends); timers while one runs.
Every other core piece always shows.

## Claiming (rule 5)

`hkSaverLayout.claims(layout, cfg)` -> `{ fact: 'the Today face' }`. A piece whose facts are all claimed is not drawn,
and the editor says which shows it. Phase 1 claims:

- the Today face: `weather` and `music` (its line under the time);
- the Big element `temp`: `weather` for the inline and circular shapes only (the band and card add more);
- a second copy of the same piece and shape: the first one placed keeps it.

Slides claim through their `shows` (phase 2).

## Spacing and alignment (the owner, 2026-11-02: "Act like an Apple Designer")

"Please have a real close attention to detail here with alignment, spacing, gaps... Things need to line up correctly
and look well placed." Every piece, in every shape, follows these:

- **One spacing scale**, in u: 0.4, 0.8, 1.2, 1.6, 2.4, 3.2. Nothing in between.
- **Cards**: inner padding 2 u (2.4 u with a title), radius 2.2 u, the title, lines and glyphs on one left edge; a title 0.6 u above its
  first line; lines 1.35 line height.
- **Rectangular**: the same left edge and line heights as a card's lines (label, bold line, line under it).
- **Circular**: the figure optically centered (its cap height on the ring's center, not its em box); the sub label at
  the same offset in every circular piece; the ring's stroke 7.5% of its size in every piece.
- **Inline**: a glyph centered on the words' cap height, 0.4 em from them. With a backdrop (a pill) it has breathing
  room (the owner, 2026-11-02, on the mock-up's "Piano Lesson" pill: "needs more spacing / buffer around the text...
  its too close"): 1.2 u above and below the words, 2.4 u at each end (1.8 u on the glyph's side), a fully round end;
  4.8 u tall at 100%.
- **Breathing room everywhere**: no words or glyph closer than 1.6 u to a backdrop's edge, in any shape; a card's
  padding grows to 2.4 u when it has a title.
- **Bands**: columns distributed evenly; figures on one baseline, labels on another.
- **Figures that change** (times, timers, temperatures): `font-variant-numeric: tabular-nums`, so nothing jitters.
- **The plan lines things up by ink**: the time's top with the top corners' first words, the bottom corners' last
  baselines on one line, the row's pieces on one center line with equal gaps (2.6 u), the margin the same on all four
  sides.
- Checked in WebKit at the wall tablet, iPad upright and phone sizes before a phase is done.
