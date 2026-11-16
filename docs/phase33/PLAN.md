# Phase 33: Look, Background and Screensaver for a new person (plan, 2026-11-16)

**Status: a plan. The owner accepted all twelve decisions of the proposal page
(https://claude.ai/artifact/UQvvQ27e93YutdDC4L1ZUB) on 2026-11-16, two of them changed (7 and 8, below).**

- Line numbers are left out on purpose: search for the names.
- Phase 32's "rules every page follows" (docs/phase32/PLAN.md, 1-10) still bind every page touched here.

## The ask (the owner, 2026-11-16)

> I'd really like to take a closer look/deep dive in how the Per Screen settings, appearance / background, and
> screensaver options are laid out. We obviously can mimic where necessary for the global settings. But right now... I
> still feel like it is pretty confusing... information around colors highlight vs accent.. etc... For a new user, this
> would continue to be overwhelming.

The answer to the proposal: "I like all of your recommendations, but for 7 - likes keep all background styles available
for all modes, including flat. Let the user decide here.. and for the Start with Look - You can have Flat - Performance,
which choses a color for example. 8. I agree on this, but it seems like we may lose functionality here? So please be
cautious, to make sure that - especially for the image/photo presets, it is retained."

## What was found (the short of it)

- "Accent Color" names three settings (Appearance's, a page's, Flat Colors' per page, with a palette of its own);
  "Highlight" survives in footers, a value ("Match Highlight"), search and DESIGN.md.
- The Accent Color changes nothing on Home in Glass; a newcomer can't see what it did.
- "Tint" means seven things; a photo can wear three treatments (Glass's photo Look, Image Look, Flat's older Fade/Tint).
- Background has a different shape in Flat (about 26 rows, 14 pages) and Glass (4 rows for a color, 2 pages).
- Turning a screen's screensaver on is 5-8 pages deep; its page is nearly empty while it follows All Screens, and
  "Same as All Screens" off copies everything.
- Three waiting times with unrelated names (Idle Time, Starts After, After the Screensaver).
- A screen's page and All Screens' pages are the same settings in different shapes; "More for This Screen" is a drawer.
- 19 phrasings of "Same as All Screens".

## The decisions (as accepted)

| # | Decision | Kind |
|---|---|---|
| 1 | **A screen's page mirrors the sidebar's Look & Feel group** (Appearance, Background, Menu & Navigation, Side Pane, Now Playing, Screensaver: same names, icons, order), each row saying Same as All Screens or Just This Screen. **More for This Screen goes away**: Now Playing and the Timer Bar → Now Playing; the screensaver switch → Screensaver; Header on Phones, Back Button & Title and Pages Screen → Menu & Navigation; Pop-ups and Notifications → Advanced → Alerts on This Screen; the Home Assistant Header & Sidebar and Car Browser → Advanced. | words |
| 2 | **One color name per thing**: Accent Color (the menu, the tab bar, the page you're on), Page Color (a page's own), Tiles When Off (Flat's off tiles). "Highlight" removed everywhere, DESIGN.md too. | words |
| 3 | **Flat's per-page Accent Color folds into Page Color**, one palette everywhere: the 11 colors, then Flat's 8 as "Soft Colors", then Your Own Color. A page already given a Flat color keeps it. | model |
| 4 | **Choosing an Accent Color no longer quietly changes the off-tile color** (reverses the 2026-10-17 "links the tint" rule). | words |
| 5 | **Four styles** (Glass, Frosted, Tinted, Flat); Glass is Clear, Blurred or Bright; Blur's drawing mode moves to Appearance → Advanced. Same stored values. | words |
| 6 | **Looks first on Appearance, at All Screens too.** A Look sets everything it stands for, its background included: Flat or Performance chooses a Color, say (the owner). | model (small) |
| 7 | **Background has one shape in every style, and every background is offered in every style, Flat included** (the owner: "keep all background styles available for all modes, including flat. Let the user decide"). Live Sky and Wallpaper behind Flat are new: the dashboard draws them. Every page and room listed at both levels. Reverses DESIGN.md's 2026-10-16 "never the Live Sky" for Flat. | model + dashboard |
| 8 | **One Adjust Photo page** for a photo or landscape, **keeping every control and every preset** (the owner: "be cautious... especially for the image/photo presets, it is retained"): Image Look's starting points (Original, Soft, Balanced, Rich, Washed, Custom) and their sliders, Glass's photo Blur, Dim, Saturation and Color Tint, Flat's older Fade and Tint. A photo looks exactly as it did; nothing stored is dropped or converted lossily. | words (stored values kept) |
| 9 | **A screen's screensaver follows All Screens row by row**: changing Starts After on one screen changes only that. Screens with their own set today keep it. | model |
| 10 | **The screensaver's switch is at the top of its own page**; the tablet's Screensaver row opens it. | words |
| 11 | **The waiting times renamed and lined up** on a tablet's page: Back to Home After (Never = off), Screensaver (After N), Dark After (Sleep Screen's After the Screensaver). | words |
| 12 | **Slides**: one How Often (minutes) and one Show For (seconds), whatever the screensaver shows; "every 5 photos" carried over as the minutes it took. | model |

## Renames

| Now | Becomes |
|---|---|
| Highlight Color, Match Highlight | Accent Color, Match Accent |
| a page's Accent Color; Flat Colors → page → Accent Color | Page Color (one) |
| Page Color (Glass's background mode for a page) | Its Own Sky (still shown as Automatic when left alone) |
| Off Pill Tint | Tiles When Off: Their Own Colors / The Accent Color / One Color |
| Tint from Background (Frosted) | Color from Background |
| Appearance Style | Style |
| Blur Mode | Blur Drawing (Advanced) |
| Image Look, Look (photo), Starting Points, Fade, Tint | Adjust Photo (one page, every control kept) |
| Sky Colors, Background → Color | Colors (one picker, opened from both) |
| Screensaver Options | Screensaver |
| Also Show | Slides |
| Idle Time + Return to Home When Idle | Back to Home After (Never = off) |
| After the Screensaver | Dark After |
| More for This Screen | (gone) |
| 19 inheritance phrasings | a row's sub says Same as All Screens or Just This Screen; its choice page starts with "Same as All Screens (Glass)" |

## Builders (each in its own worktree, one branch each)

| Builder | Decisions | Mainly |
|---|---|---|
| **Screen page** | 1 | `hk-settings-screen.js` (`s_main`, `s_more`), a screen's Menu & Navigation and Now Playing pages, Advanced |
| **Appearance & Colors** | 2, 3, 4, 5, 6 | `hk-settings-house-looks.js` (`h_appearance`, `s_appearance`), `hk-settings-screen-glass.js`, the accent and page color pages, Flat Colors (dissolved), `hk_core/settings/looks.py`, the model's words and search |
| **Background** | 7, 8 | `h_sky`, `s_sky`, `flatSky`, the page backgrounds, the photo treatments, the dashboard's Flat background (`hk-sky-mount.js`, `hk-base-builders.js`) |
| **Screensaver** | 9, 10, 11, 12 | `hk-settings-screen-saver*.js`, `hk_core/screensaver`, the dashboard's saver, the tablet's page (`hk-settings-rooms.js`), Sleep Screen, the editor's Timing |

## Checking

- `tools/ci.py quick` on each branch; `tools/ci.py full` on the merge, from a local-disk worktree.
- HK Frontend's jsc suites (`tools/build_ha.py`, `tests/run`), the CSS snapshot when CSS changes.
- Every changed page drawn at 390x844, 844x390, 820x1180 and 1180x820, light and dark, in WebKit; the house's own
  settings through the house copy (`tools/headless/house_twin.py`) before the hotfix.
- Carried-over settings: each model change has a unit test that an old setting reads the same after it.

## Build log

**2026-11-16, built** in four worktrees at once, merged in `p33`:

- **Screen page** (decision 1, d6034266): a screen's page is Home Page, Look & Feel (the sidebar's six rows, read from its
  SIDE table, each Same as All Screens or Just This Screen), Pages, Wall Tablets, Advanced, Where. More for This Screen
  is gone (`/more` forwards to Advanced): Now Playing (its switch, Timer Bar, On Every Page) its own page, Header on
  Phones and Back Button & Title on Menu & Navigation, Pop-ups and Notifications under Advanced → Alerts on This Screen.
- **Appearance & Colors** (2-6, a864d17e): Appearance is Look, Style (four; Glass Clear/Blurred/Bright, then the style's
  own amounts), Color (Accent Color, Pages Keep Their Own Colors, Page Colors, Tiles When Off), Tiles, Motion, Advanced
  (Tab Bar Glass, Blur Drawing), Reset Appearance…. Looks at All Screens too (`look.look_undo`); the Flat Look sets Flat
  Color Stone, Performance a Graphite color. Flat Colors taken apart, every old address forwarded. Page Color: a page's
  Flat accent folds into `look.page_accents` on read (`fold_page_colors`); a screen's own page color reuses its
  `flat_page_colors[page].accent`. The accent no longer writes Tiles When Off. `look_carry.json` holds the house's 30
  screen-and-page colors from before; the new code gives the same.
- **Background** (7, 8, e8c9f9a2 + c7a2a1d1): one page shape in every style; Flat takes Live Sky and Wallpaper in its own
  store (`FLAT_BACKGROUNDS`), drawn by the glass looks' sky behind Flat's cards; Its Own Sky; one Colors picker; every
  page and Rooms at both levels; Adjust Photo keeps every starting point and slider (Image Look, the glass photo Look,
  Flat's older Fade/Tint) on the same keys, nothing converted.
- **Screensaver** (9-12, 22fa4800): the switch on top of the Screensaver page, the same page at both levels (What It
  Shows, When, Photos → How Photos Show, Side Pane, Advanced); a screen's own options are the keys it set
  (`hk_core/settings/saver_layers.py`, `M.saverLayers`), a whole set from before stays all-own; Slides in minutes
  (`extra_every`/`extra_for`; counted photos carried as the minutes they took: the house's 3 × 20 s → every minute for
  20 s); a tablet's When Nobody's Using It: the timeline, Back to Home After (Never = off), Screensaver, Dark After.
- **Merging** (the lead): Flat page backgrounds link to Page Color; a screen's Appearance rows follow the one idiom (no
  Reset row under each; All Screens' value again follows); swatch tiles a hairline edge (the house's white Tiles When
  Off); the old Flat address for a page's accent clears its Page Color too; the screensaver's defaults agree with Slides
  in minutes (every 2 minutes, `forecast_every` 4); the timeline one bar, square where its parts meet (the owner).
- **Checked**: quick; full (98 of 99: `app-sky-check` failed once under load and passes alone, as in phase 32;
  `now-playing-page-check-webkit`'s 1366x1024 corner-ink case fails the same way on main run directly -- 23/21/22 px
  both -- so it isn't this phase's); HK Frontend's jsc and Python suites; the house's own settings through the house
  twin (Kitchen HomeView unchanged: Flat, green, white off tiles, landscapes).
- DESIGN.md (hk_house 52b46df7): Accent Color, Page Color and Tiles When Off; every background in Flat; one shape at
  every level; the 2026-11-16 decision.
