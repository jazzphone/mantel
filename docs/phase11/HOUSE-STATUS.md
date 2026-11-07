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

S, W, T, L and XL, on square cells (196 × 196) and tile cells (196 × 150). The layout is worked out from the
block's measure (`layout()`), not fixed per size:

| Size | Sections | Square cells |
| --- | --- | --- |
| Small | One button: the section that matters most (an alert, else one asking for attention, else the first) and the count | |
| Wide | Up to 4, two by two | Name over the reading. On tile cells, one line each with a tighter heading |
| Tall | Up to 4, a column | "+N more" at its foot (no room beside the heading) |
| Large | Up to 6, two by three | With a line of detail |
| Extra Large | Up to 6 three by two, or 8 four by two | Larger readings, two lines of detail |

Fewer sections are laid out for fewer: three on a Large is a column of three, not six slots with three filled. A
section is never under 44 px tall. Rows that would be shorter go to "+N more", and readable text is never shrunk to fit.
"+N more" never loses one: the sheet has them all. Glyphs are bare and in the ink. A section that asks for attention
(an alert, a running timer, a door open, a lock open or not reporting) takes its chip's color.

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
