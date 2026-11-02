# Phase 13, phase 5: the editor (spec, 2026-11-02)

What `web/hk/panels/hk-saver-editor.js` becomes, from the plan's "The editor" section and the approved mock-up
(`docs/phase13/mockup/screensaver-unified.html`, published at https://claude.ai/artifact/WGMhLYgvrFpBEYsLB17hEN; the
owner: "Ok this all looks good"). The editor keeps its frame (top bar, left pane, the real screen in the middle, the
inspector on the right), its settings kit (`hkSettingsKit`), its undo, Save, drag and tap-to-place, and the overlay
drawn from the plan the screensaver drew by (`hkSaver.layoutInfo()`).

## Left: Looks, then the pieces

- **Looks** replace Starters. A Look is a background and the time: the background keys, the face, the big element's
  kind, size, position, align and depth. Each is shown as its picture (the existing `saverThumb`).
  - **Tapping a Look changes the Look only.** The layout's zones (the Info), `row_at`, `row_size`, `ink`, `accents`
    and `upright` stay. A piece the new Look has no place for (Month has no row and no line) **waits**: it stays in
    the layout, the screensaver leaves it out (`hkSaverLayout`'s plan already drops what has no room), and the
    editor's Info list marks it "Waits: Month has no row". The toast says what stayed and what waits.
  - **Start Over from This Look**, at the foot of the Look's own page (tapping the selected Look again opens it), is
    the old replace-everything behavior, with an in-page confirmation (no `confirm()`).
  - A Look's own pieces come from its definition in this file (v2 pieces), never from hidden legacy flags.
  - Looks: Photo Frame, Lock Screen, Forecast, Big Weather, Planted (the Planted face on the Landscape), Clock, Glance,
    Month, Day, Nightstand.
- **Pieces**: the library grouped as the glance catalog is (`hkSaverWidgets.PIECES[p].group`: Time and Calendar,
  Weather and Sky, Home, People and Travel, Energy, Media and Photos, Cameras, Any Sensor), with a search field. Each
  piece once (not once per shape), its sample (`hkSaverWidgets.sample`) in its first shape, its shapes as small chips,
  "Shows while..." when it has a `when`, "Off until placed" for `off` pieces, "Pick ..." for wave C. Tap or drag a
  piece, then a green place: it goes in the first of its shapes that place takes.

## Center

- Above the screen: **Wall Tablet / iPad Upright / Phone** (and the phone on its side, 844 x 390), **See a Slide**
  (None, Music, Forecast, Weather, Home Energy: the screensaver shows that slide in the preview, with its slide corner),
  and **Day / Night** (Night Mode in the preview). Both are preview-only, never saved, and reset when the editor opens.
- The overlay: a "shows when..." piece with nothing to show is drawn dotted with its name and when it shows
  (`layoutInfo().emptyAt`); a claimed piece is drawn faded with who shows its fact (`layoutInfo().claims`); a piece
  waiting for a place isn't drawn.

## Right: four sections when nothing is tapped, always in this order

1. **Look**: Background (and its own options: Photos' Darken, Moving Color's pattern and **Motion** (was "Depth"),
   the Wallpaper, Soft Photos), **Big** (Time, Temperature, Date, Month, None), Face (Planted only on the Landscape),
   Color, 24-Hour Time, Size, Position, Align, **Depth** (In Front / Behind: shown only where the background can put
   something in front of the time -- Photos, the Landscape; elsewhere one line says why, no control), Legibility
   (Shadow, Outline: whenever the background is busy -- Photos, Soft Photos, the Landscape, HK Landscapes).
2. **Info**: what is placed, a list (each: its sample, name, shape, place; ↑ to reorder within its place; tap to open
   it); the screen's **Ink** (Auto, White, Black: "one ink for every piece; Auto picks from the background"),
   **Color Accents** (on/off), the row's **Size** (one size for the row, 60-200%) and where the row goes.
3. **Slides**: each slide on or off (the forecast, Music, Weather, Home Energy), **How Often**, **The Forecast:
   Classic / Big** (moved here from Settings), and for each a line "Its corner adds Time, Date and House Status"
   (`hkSaverLayout.cornerFor`) and a **See It** button.
4. **Timing**: one row linking to the Screensaver page's timing (Starts After, Back to Home, Night Mode, This Tablet).

At the foot: one **Reset** row (it replaces Back to Today's Look and Remove the Layout): back to the screen's look
before the editor, with an in-page confirmation.

## A piece's page

- **Shape**: its shapes as tiles, each drawn (`hkSaverWidgets.sample`); changing to a shape its place can't take moves
  it to the nearest place that can, and says so.
- **Size** 60-200% (in the row: **Its Own Size** on/off, off = the row's size), **Backdrop** (None, Glass, Tinted),
  **Color** (Auto, Accent).
- **Its options**: choices as a segmented control or a select; text as a text field; an entity (`entity:...`) as an
  entity picker of those domains with the piece's suggested default named ("Suggested: Washer remaining time",
  `hkSaverWidgets._.picked.suggest` where the piece has one).
- **Show**: Always, or **When...**: an entity (any the screen may read), **is / is not / is above / is below**, a
  value. The page says "Shows when Mailbox is Mail".
- "Shows while music plays" (its `when`), "Off on every screen until placed" (`off`), what it reads (`source`).
- **Where**, the move buttons, and **Remove**.

## No dead rows

Every row declares `applies(state)` and is left out where it does nothing. Depth explains itself where Behind isn't
possible. No row for a choice that has one answer.

## One home per option

- The orphaned Clock Style page (`hk-settings.js`, about line 2097) opens the editor instead.
- `music_first` and `music_slide` are one key (the session migrates it in the models; the editor writes `music_first`).
- `forecast_planted` follows the Planted face (the screensaver does; the editor doesn't offer it separately).
- The forecast's Classic / Big is in Slides.

## Words

- "Depth" only for the time. "Look" only for the Look. "Layout" leaves the visible text: Upright Screens is **Same as
  Sideways / Its Own**.
- HK Frontend never says "Mantel" in visible text. American English.

## The rules

- No `backdrop-filter`; nothing new animates; the editor needn't run on an iPad but must not break there.
- Every change is a draft until Save; Undo takes back one change at a time.
