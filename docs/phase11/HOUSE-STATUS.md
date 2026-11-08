# House Status

A Home Grid block (`house_status`) and a sheet that show a screen's status chips as part of HomeView's look,
instead of the chip row's pills. Added 2026-11-07. Code: `web/hk/cards/hk-house-status.js` (the block, the sheet's body,
the pure layout) and `web/hk/cards/hk-chip.js` (`hkChip.status`, the status model).

## What it shows

The screen's own **Status Chips**, read through the chip code itself (`rowItems`, the same function the chip row
uses). That means the same chips in the same order, Always or When Active, Smoke & CO leading every screen that has
an alarm, and the screen's entity chips and custom chips. House Status adds no rules of its own:

- The chip row's switch (`chips_row`) belongs to the row. House Status reads the chips with it forced on, so a
  HomeView screen can hide the row and still show House Status.
- A section is shown when its chip would be. A kind the house doesn't have is never shown. A When Active chip shows
  only while it is active.
- **Alerts lead.** Smoke & CO, a weather alert or a leak while active, or the alarm going off, come first in the
  screen's order. Everything else keeps the screen's order and is never re-sorted by changing readings.
- **Unknown is not zero.** A sensor that hasn't reported has no reading ("—"), never 0 kW. A lock that isn't
  reporting is never counted as locked: with no alarm, Security reads "1 Not Reporting" rather than the chip's
  "All Locked".
- **Detail comes from the house**: where (rooms from areas), which (names), and what (Cooling, Paused). A line is
  left out when the house says nothing true, and there are no stand-in strings. Timers count down with
  `<hk-countdown>` (hk-timers.js's one shared interval).
- **Energy reads as Power** (the reading is power now, in kW) and opens the Energy page.

### Custom chips

| Custom chip | House Status |
| --- | --- |
| A status chip (`custom:hk-status-chip-card`) | Read like any chip |
| A `conditional` around a status chip, with `state` / `numeric_state` conditions (and `and` / `or` of them) | Read; the conditions are judged |
| A conditional with any other condition (screen, user, time), or any other card | Not shown in the block. The sheet names it: "Not shown here: …" |
| A status chip whose tap would change the house (`toggle`, `call-service`, `perform-action`) | Shown as a readout with no tap |

## Taps

Each section opens what its chip opens: a kind's page through the screen's own pages (the chip's `kindPage`
fallbacks: Blinds goes to Shades, else Climate; Security to Security, else Alarm), an entity chip's sheet, a link, or
the Intercom. A section with nowhere to go (no such page on this screen) is drawn as a readout, not a button. One tap is
one navigation, and a section's tap never also opens the sheet. From the sheet, a page closes the sheet on the way
(`hkDetail.navigateFrom`). Small, "+N more" and the block's plate (the heading, a gap) open the sheet. Nothing in
House Status sends a command.

## The block

S, W, T, L and XL, on square cells (196 × 196) and tile cells (196 × 150). Since round two (2026-11-08, the owner:
"the layouts don't follow anything else ... It would be great if On Now and Home Status shared a similar look"; and of a
first try in tiles, "we don't necessarily have to use Tiles ... Let's be intentional on layout") House Status and On Now
are composed of the same parts (`window.hkHouseStatus.tiles`: `plan`, `compose`, the CSS; On Now's file asks for this
one), built from the On Now Tall he liked:

- **The headline** answers the glance: the one thing that matters most, in words -- "1 Window Open", "8:38 Left", "Wind
  Advisory" -- and under it its section and how many others need a look ("Doors & Windows · 1 more to check"); when
  nothing needs a look, "All Good" with a green check and "Nothing needs a look".
- **The sections as lines**, not boxes: each a row -- its glyph on a disc (lit in its chip's color while it asks for a
  look or something is on, playing or open; a neutral disc at rest), the name, the reading at the end and a line of
  detail under the name (on a narrow block the reading goes under the name, so a name like "Doors & Windows" is never
  cut). The whole row is the tap; a hairline between rows.
- **Nothing stretches**: a row is 44 px on Wide and Tall, 56 on Large and Extra Large (48 on a tile cell's Large); a
  block shows as many rows as fit, the group centered in what the headline leaves, and the rest are "+N more".

| Size | Composed |
| --- | --- |
| Small | The label, the headline at the foot, its section and how many more to check |
| Wide | The headline in the left third ("+N more" at its foot), three lines beside it (two on a tile cell) |
| Tall | The label ("+N" at its end), the headline, six lines (four on a tile cell) |
| Large | The label, the headline and its sentence, four lines of 56 (three of 48 on a tile cell) |
| Extra Large | A column of its own for the label, the headline and its sentence; six lines of 56 beside it (five on a tile cell) |

"+N more" never loses one: the sheet has them all. Each line says a thing once (a detail that only repeats the reading
is left out). The label's key is a 24 px capsule whose 44 px reach goes up into the inset, never over a line.

The block has no options (`opts: {}` in both catalogs). It shows the screen's Status Chips, and the editor says where
to change them. There is no When Tapped option, because each section opens its own place.

## The sheet

It opens in the shared detail sheet (`hkDetail.open(null, …, {panel: {tag, config}})`: a panel another file
defines, about no one entity), with the shell's header, X, focus trap, Escape, scroll edges and reduced motion. The
width is chosen when it opens (`wantWide`): wide (820) for two or more sections when the window is over 640 wide, at
least 640 tall, and has room for 820 beside a docked menu. Otherwise it is the standard sheet, and phones and short
windows get their own sheets as always. The body then lays out by its own width:

- **panels** (the wide sheet): two across, each with its glyph, name, a hero-sized reading, a line and a second
  line. Six fill the body; more scroll at the same size.
- **rows two across** (a short window's 580-wide sheet)
- **rows** (the standard sheet, phones). A long name or reading takes a second line.

## Checks

- `hosts/ha/custom_components/hk_frontend/tests/test_housestatus.js`: the model (order, When Active, alerts,
  unknown data, timers, custom and entity chips, pages and taps), the layout, the sheet's width and the card's
  listeners.
- `test_blocks_taps.js`: every block's plate tap, House Status included.
- `tests/test_house_status.py`: the layout in node, both catalogs, the saved layout, the lazy file, the editor, the
  assistant's card list.
- `tools/headless/house_status_check.py`: WebKit and Chromium on the fictional house with house commands off and the
  page's sockets watched for command frames. It covers every size on square and tile cells, taps, and the sheet at
  1180×820, 1280×800, 1366×1024, 800×1280, 820×1180, 320×667, 375×667, 390×844, 667×375, 844×390, 640/641×900,
  900×500/501 and 1280×720.

## Not done here

- House Status is not on any screen by default and replaces nothing. Putting it on a live screen (for example in
  On Now's place) is a settings change, made with the screens' tools after a dry run.
- Daily energy and cost are not shown, because the Energy chip's sensor is power now. A day's total would need the
  Energy page's statistics, and that is left for later.
- Headless WebKit draws no backdrop blur in its screenshots, so the glass is judged in Chromium's shots and on a real
  iPad.
