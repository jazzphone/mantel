# Phase 36: an Apple HomeView's apps

The owner (2026-11-25): "if you were going to redesign our pages (apps) for HomeView ... instead of forcing our existing
pages to fit ... It needs to look and function like it belongs on the homeview, not just thrown together." Only the pages
the HomeView's Apps screen opens (its Launcher): not the rooms, the generated dashboards or the Home Grid ("the HomeView
is already a dashboard"). Two rounds of mockups, then "Lets go ahead and build it all!":
https://claude.ai/artifact/Ngp59QvBqHSoG9krKsJWZR (the "Scrolling pages" version; the first, no-scroll version is in its
history). The owner, on round 1: "i'm ok with the page needs to scroll vertically ... I just want the elements to be
intentional."

## What a HomeView page is

The HomeView's Safari shows a 544 x 440 pt window under its bar; `web/shim/homeview.js` lays the page out 440 px wide
(a pt is 0.81 px). Every page shares one frame:

- **The title upper left**, the page's name and one line that leads with a number ("6 On · 4 rooms"); **one control at
  the right**: the page's one action (All Off) or a switch between real modes (Energy's Now / Today / Week / Month).
- **The first screen is the job** (what's on, the thermostats, the player, the alarm). The page then scrolls on for more
  of the same under plain section headings (Rooms, Scenes, Recent). A switch is only ever a mode, never a way to hide more
  content.
- **One grid**: four across, 120 x 104 pt, 12 apart, 14 from the screen's sides. Small 1 x 1 (a centered tile, HomeView's),
  Wide 2 x 1 (a level dragged across, Control Center's), Tall 1 x 2, half and full-width plates for lists, players and
  charts. Nothing stretches (DESIGN.md "Using the space").
- **Deeper on the same frame**: a room, a camera, a channel opens with a back key before the title, never a sheet over a
  sheet. The Home Pill floats over the page and goes back to Apps.
- **Made for the screen**: the screen's own glass, white means on (a lit level is a white plate with the level a tint of
  the thing's color behind dark words), keys at least 44 pt and 60 for the main one, nothing under 13 pt.

## How it's built

- **The strategy decides what; the HomeView decides how.** `views()` (hk-strategy-views.js) builds every page as it always
  has; on a HomeView's own Safari (`window.hkHomeView`, not the app's car screen) each Apps-page page's cards are handed to
  a HomeView page card as `src` (and a few things the page's cards don't carry, `extra`). The card reads its accessories,
  rooms, order, names, glyphs and colors from `src` (`hkHV.harvest`), so exclusions, Tile Order and accessory settings stay
  the build's. Every other device keeps the pages as they are.
- **The kit**, `web/hk/cards/hk-hv.js` (`window.hkHV`): sizes in the HomeView's pt (`P(n)`), the stylesheet, the pieces
  (`head`, `section`, `tile`, `level`, `row`, `list`, `key`, `cap`, `seg`, `plate`, `glyph`, `svg`), the state words, and
  `HvPage`, the base every page card extends (one click handler with `data-act`, the level's drag, the signature of what
  it read: rule 13).
- **The pages**, each a lazy card file (`mantel_server/hk_cards.py` LAZY, so nothing loads off a HomeView):

  | File | Pages |
  |---|---|
  | `hk-hv-home.js` | Lights, Climate, Doors & Windows, Water |
  | `hk-hv-care.js` | Security, Timers, Vacuums |
  | `hk-hv-media.js` | Music, Cameras, Live TV |
  | `hk-hv-energy.js` | Energy, Power |
  | `hk-hv-info.js` | Weather, Calendar, Timeline |

- The building session ran on Opus 5.5 Medium; the page groups were built by agents on Sonnet 5.5 at High effort, each in
  its own file, from the kit and the Lights page.

## Each page (the mockups' second round)

| Page | First screen | Then |
|---|---|---|
| Lights | All Off; what's on as Wide levels (non-dimmable as lit Small tiles) | Rooms (a tap opens the room's lights), the screen's Scenes |
| Climate | the thermostats, two half-width plates, one big number with ∨ ∧ at its foot | Rooms' readings (humidity, temperature), Fans, Blinds as levels |
| Doors & Windows | what's open, lit, with how long | Doors, Windows (closed), Garage with Open / Close |
| Water | today's use with its hours, the main valve, the first leak sensors | This Week, the rest of the sensors |
| Security | the alarm (Arm Home, Arm Away) beside the locks; a code's keypad as a step deeper | Doors & Windows, Recent |
| Timers | running timers as rings (cancel, pause) | Start a Timer (1, 5, 10 min, Other), Recent to start again |
| Vacuums | the robot (state, battery, water tank) beside its Clean Rooms picker | History, Maintenance |
| Music | Playing / Speakers / Library (modes). Playing: the cover, the transport, rooms and volume | Up Next; Library: playlists, Radio |
| Cameras | the camera with motion first, full width, then the rest two across | (one camera: Talk, light, unlock, today's clips) |
| Live TV | the channels two across, the one playing lit | (a channel: Play Here, Play On, Later Today) |
| Energy | Now / Today / Week / Month (modes). Today: the hours' chart and where it came from | Where It Went, This Week |
| Power | the flow (solar, grid, home, battery) | Battery through the day, Solar Today |
| Weather | now: the temperature, the next hours, the conditions | Next 10 Days, Radar |
| Calendar | Today / Week (modes). Today: the date, then the day's events | the next days |
| Timeline | All / Doors / People / Cameras (filters) | earlier today, by time of day |

## Checking it

- `tools/headless/house_twin.py render apple-homeview --mobile --screen 544x544 --size 544x440 --path <page>` draws a page
  as the house's HomeView shows it (`--size 544x2200` the whole scroll); `--busy` turns things on.
- The kit's pure parts (harvest, the state words) are tested in the main suite (`tests/test_hv_kit.py`).
- No new browser check (the checks' budget): the twin is the by-hand check for a HomeView change.

## Round 2, on the HomeView itself (2026-11-26)

The owner, with photos and videos of the first build on the Kitchen's HomeView:

- **Locked sideways.** "It allows for movement left to right which makes it not really feel locked into place or
  native." No page was wider than the screen; Safari's own sideways rubber band and pinch moved it. `homeview.js` now
  sets `overflow-x: clip`, `overscroll-behavior-x: none` and `touch-action: pan-y` on the root and the body: the page
  scrolls up and down only, and a control that drags sideways keeps its moves.
- **Tabs that float.** "All the pages that have tabs at the top, they should probably float above the content as you
  scroll down ... Be careful on pages that have barely enough content to scroll." A switch in the title row (`H.seg` in
  `H.head`'s right) has a copy in a sticky layer of no height (`.flt`), shown once the title row has gone under the top
  (an IntersectionObserver), on the near-solid overlay; the page is exactly as tall either way, so nothing bounces.
- **Safari's bar.** At rest the page starts under Safari's bar (104 of the screen's 544 pt); scrolled, the bar is a pill
  over the page's top. The floating switch sits clear below it (`--hv-float`: the view's top room plus 34 pt).
- **HomeView Pages on any screen.** "It would be great to have an option to enable these HomeView pages on a
  Dashboard/Screen so that way you can see them on a desktop computer." A screen's option (`homeview_pages`, Settings ->
  the screen -> HomeView); off a HomeView the kit frames a page at the HomeView's own 544 px, centered (`--hvw`).
- **Energy and Power had lost their content.** Rebuilt to carry what the tablet pages carry: the rings, every circuit and
  device as rows (now in watts, or the period's kWh by tab; a tap asks before turning one off; a Backup mark when it is on
  the battery), and Power's two halves, right now and the house battery (EcoFlow): its level, mode, levels and circuits.
- **Padding.** No number or unit is cut by its plate; text stays at least 12 pt from a plate's sides (measured on every
  page with a script over the twin).
