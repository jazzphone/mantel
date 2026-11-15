# Phase 32: Settings as iOS 26 Settings (plan, 2026-11-15)

**Status: a plan, from the Settings audit of 2026-11-15 (https://claude.ai/artifact/6ULjcdb1npoxDHFnVD7yiG). The owner
accepted all four of its decisions the same day: the iOS 26 look with DESIGN.md updated, the new sidebar, one setup
checklist, and every page reworked, Wall Tablets and People & Roles first ("just all over the place with no
consistency").**

- **Line numbers** are left out on purpose. Search for the names.
- The audit's own measurements and pictures stay in that artifact; this page is what is built from them.

## The ask (the owner, 2026-11-15)

> The Settings are supposed to look and feel like Apple's iOS Settings, but lately that is starting not to feel like the
> case, and some settings have gotten a bit crazy in the layout and ordering... and are overwhelming.

The answers to the audit: match iOS 26 and update DESIGN.md; take the proposed sidebar; one setup checklist; rework all
the pages. "I really struggle with the Wall Tablets and Users & Roles settings across the board... its just all over the
place with no consistency."

## What the audit found (the short of it)

- **The sidebar:** 45 rows in 11 groups, grouped by where the code lives (Screens, Pages, All Screens, Library, System,
  Mantel, Advanced). Set Up Mantel twice, Cameras twice, Advanced as a row and a group, three setup pages, three red bells.
- **Ten pages of eight groups or more** (Screensaver, a screen's page, Background, Timeline, Me, Security, Cameras,
  Weather, Alarm, Add a Grant); rows that do nothing until a switch is on are shown anyway; 663 footers, 54 of them
  paragraphs; 121 "Same as All Screens".
- **The look is iOS 17/18:** a blue-filled selected row, 10 px cards, uppercase headers, a large title on every page.
- **Wall Tablets and people:** a wall tablet's settings are on four pages under three headings (All Screens → Wall
  Tablets, its own page with Mantel's six groups added under HK's eight, People's "Wall Tablets Signed In as People",
  Roles & Grants → Rooms). A tablet has three rooms: HK's Room (Sleep Screen's presence), Mantel's device room, and its
  grant rooms (Roles & Grants → Rooms for a Person or Tablet). What a person may do is on Roles & Grants, never on the
  person's own page. Me, a person's page and a tablet's page share no shape.
- Performance was fixed in the audit itself (one redraw per change, the switch slides; d14bb277 on main).

## The look: iOS / iPadOS 26 (the owner's screenshots, 2026-11-15)

Values, all in `hk-settings-kit.js` (the controls) and `hk-settings-css.js` (the shell); DESIGN.md's HK Settings
paragraph and Decisions log record them.

| What | iOS 17/18 (was) | iOS 26 (now) |
|---|---|---|
| a group's card | radius 10 | **radius 26**; a lone row's card the same |
| a row | min 44 px | **min 52 px** (iPadOS 26 measured 51-52 pt); a row with a subtitle grows |
| a group's header | 13 px uppercase | **15 px / 600, as written** (Title Case), the secondary label |
| a footer | 13 px | 13 px, **one or two sentences** |
| the sidebar (iPad) | white cards on the window's gray, separators | **a floating panel** (8 px from the window, radius 26, its own fill); rows straight on it, no cards, no separators |
| the selected sidebar row | solid blue, white text | **a gray pill** (the fill, radius 12) with **blue text**; its icon unchanged |
| the search field | radius 10 | **a capsule** (radius 18) |
| the sidebar's account | a card | a row on the panel, a 44 px round picture |
| a section page | large title + a gray line | **a header card**: the section's 60 px icon (radius 14), its name 22 / 700, one line of what it is |
| a sub-page | large title | **the title in the bar, centered, always shown**; no large title |
| Back | chevron + the page's name | **a 44 px round glass button, chevron only** (the name is its label for VoiceOver) |
| Pin (the preview) | the word | a round glass button with its icon |
| an icon tile | radius 7 | radius 8 (30 px) |

Kept: the switch, the segmented control, Apple's system colors, the iPhone's one column (an iPhone held sideways too), the
iPad's two columns both ways, light and dark. HK Settings still never wears the dashboard's looks.

## The sidebar

| Group | Rows |
|---|---|
| (none) | **the signed-in person** (Me); **Finish Setting Up Mantel** while steps remain, with a count |
| Screens | each screen; Add Screen |
| Look & Feel | Appearance; Background; Menu & Navigation; Side Pane; Now Playing; Screensaver |
| Home | Rooms; Accessories; Pages (one row: the pages listed on its page); Status Chips; Cameras |
| Devices | **Wall Tablets**; Intercom |
| Notifications | On Screens; Pop-ups; System Alerts; Timeline |
| Household | **People**; **Roles & Permissions**; Audit Log |
| Mantel | General; Connections; Backups; Your Files; About |
| Developer | Custom Pages; Custom Chips; YAML & Advanced; Service Accounts; Assistants (MCP) |

- Every name once, every icon once. Overview goes: its words become the iPad's empty page beside the sidebar.
- Old addresses forward (`M.routeForward`, Mantel's `OLD_PAGES`), so every link, search result and tablet keeps working.
- Cameras is one row: the Cameras page's settings and Mantel's direct cameras (a group on it), not two pages of one name.
- A role that sees only some of it (an Adult: Me alone) sees only its rows, as now.

## One setup checklist

**Finish Setting Up Mantel** (iOS's "Finish Setting Up Your iPhone"): the rows of Set Up Mantel, each with its status
from Setup Check (Home Assistant connected, Music Assistant, the font and glyphs, each tablet's kiosk app), a tap opens
the page that does it, and the row leaves the sidebar when nothing is left. Setup Check's and Setup Assistant's
addresses forward to it. Its "Check Again" stays, at the bottom.

## The rules every page follows (the checklist for this phase and after)

1. **A section page opens with its header card**; a sub-page has its title in the bar.
2. **The most-used setting first.** Rare ones behind one **Advanced** row at the bottom; destructive actions (red) alone
   in the last group: Sign Out, Remove, Clear, Reset.
3. **A row that does nothing until a switch above it is on is not shown until it is.** A feature that isn't set up
   shows one row saying so and the way to set it up, nothing else (Intercom, a tab bar no screen uses, Pairing).
4. **One control per row, the iOS way**: a switch; a value and chevron that opens a page of choices with checkmarks; a
   pop-up menu for a short list; a segmented control only for two or three short choices.
5. **A footer is one or two sentences.** What needs more goes to the docs (an "In the Docs" row).
6. **No group of one row with a footer of its own** unless it is the only thing on the page; merge neighbors.
7. **Inherited values show the value**: "Glass" in gray, not "Same as All Screens"; the group's footer says once that
   the screen follows All Screens until changed; a changed row has **Reset to All Screens** on its choice page.
8. **Same thing, same name, same icon, same place** on every page that has it (below, "One shape").
9. **At most about six groups** on a page; past that, sub-pages.
10. American English, Title Case labels, sentence-case footers.

## One shape: people, tablets and the things they share

The owner's struggle is that a person, a wall tablet and a role each draw what they share in a different place and a
different way. From now on each of these is **one component drawn the same everywhere it appears**:

- **Access** ("What They Can Do"): a role's defaults, then the grants that add or take away, then the rooms that "their
  areas" means. Drawn on a person's page, a tablet's page, a role's page and a service account's page; Add a Grant
  opens from it with "Who" already filled. Roles & Permissions keeps the list of roles and every grant in one place.
- **Rooms**: one Room for a tablet. Its page's Room is HK's (Sleep Screen's presence) and Mantel's (its device room and
  its grant rooms) at once; where they differ today the page says so and offers to make them one. A Child's or
  Guest's rooms are on their own page, under Access.
- **Sign-in**: how they sign in, passkeys, two-step, sessions: Me and a person's page draw the same group (a person's
  page read-only where it is theirs to change).
- **Devices**: a person's phones and apps (Me, a person's page) and a tablet's own app the same list rows.

### People (Household → People)

- The list: everyone who signs in, by role, then **Add Person…**. Wall tablets are not people: they are listed on Wall
  Tablets only ("Wall Tablets Signed In as People" moves there, as a fix-it row on the tablets it concerns).
- **A person's page**: header card (picture, name, "Adult · Signs in with Home Assistant"); **Role** (a choice page);
  **Access** (above); **Sign-In** (passkeys, two-step, sessions); **Devices**; **Opens On**; then Merge…, Disable…,
  Remove… at the bottom.
- **Me** is a person's page with your own controls: Sign-In & Security, Notifications (Notifications Here and System
  Alerts in one page), Devices (sessions, Add iPhone, iPad or Mac), Privacy (arrivals, morning summary), Opens On, Sign
  Out alone at the bottom. Eleven groups become six rows and Sign Out.

### Roles & Permissions (Household)

- Roles, each with a one-line summary ("Can control the house, not the alarm"); a role's page is **Access** for that
  role: what it may do by default as rows grouped by area (Lights & Switches, Locks & Garage, Alarm, Cameras, Music,
  Settings), then its grants, then "From Outside the Home".
- Grants: every grant in one list (who · what · when), Add a Grant… The Rooms page goes: its job is on each person's and
  tablet's page.
- Add a Grant keeps its fields, in four groups (Who; What; Allow or Deny; When) with the time rows shown only once a
  schedule is turned on.

### Wall Tablets (Devices)

- **The list**: each tablet with its status in the row (Online · Kitchen · Home screen, or Offline 2 h), Add Tablet…;
  then **All Tablets** (one row: the defaults below), **Mantel for Android** (one row: its updates and its defaults,
  when any tablet runs the app), and **Setup Check** as a status row only while something needs fixing. Reload All and
  Clear Cache & Reload All go to the All Tablets page, Alerts and Scheduled Restart there too.
- **A tablet's page**, the same order for every kiosk app, a group shown only when that tablet has it:
  1. header card: the tablet's icon, its name, "Kitchen · Home screen · Mantel for Android", and its status line
     (online, screen on at 60 %, battery 87 %, charging).
  2. **Screen & Room**: Screen, Room (the one room, above).
  3. **When Nobody's Using It**: Return to Home, Idle Time, Screensaver, Sleep Screen → (the timeline diagram goes to
     Sleep Screen's page, as a footer picture, or goes).
  4. **Display** (the app; Fully Kiosk's brightness where it has one): Brightness, Keep Screen On, Adaptive Brightness,
     Scale, Screen Rotation, What's on the Screen →.
  5. **Access**: Signed In As (its Mantel credential), Role, What It Can Do → (the component above).
  6. **Advanced →** one row: the kiosk app and device, Direct Connection and pairing, AirPlay, Graphics, Developer,
     Copy Settings From…, the start URL.
  7. Reload, Clear Cache & Reload; then, red and alone, Sign Out This Tablet… and Remove Tablet….
- **Add Tablet** and **Make This a Wall Tablet** (enroll) become one flow with the same fields in the same order: Name,
  Screen, Room, Kiosk App (Mantel for Android first), then the sign-in.

## The other pages (rules 1-10 applied)

| Page | What changes |
|---|---|
| Screensaver | Photos (one row: source and album inside); Slideshow; Also Show (today's "Now and Then"); Timing; Photo Layout → (Portrait and Landscape); Night Mode; the empty Screens group goes |
| A screen's page | Preview; Home Page; Pages; Look; **More for This Screen →** (Now Playing, Timer Bar, Pop-ups, Screensaver, Car Browser, Header on Phones); Wall Tablets on it; Copy Settings From…; Remove Screen… (red, last). Inherited values shown as values (rule 7) |
| Background | Background; Live Sky (Animations, then its dependents only while on); Seasonal Decorations → ("11 On"); Pages; Advanced → |
| Menu & Navigation | today's Menu, Pages Screen and the menu's sub-pages: Side Menu, Edge Tab, Tab Bar (its rows only while a screen uses it), Gestures, Header; Rooms in the Menu once |
| Timeline | What's Recorded → ("10 of 12"); Wall Tablets → (what they show, their pictures); Retention; Pictures; Morning Summary →; Clear Timeline… |
| Intercom | the switch and its status; everything else only while it is on and Music Assistant is there |
| Security, Cameras, Weather pages | the same three groups on every page (What's on It, Look, On Screens), one-sentence footers; Cameras' "Related" goes; Security listed in Pages |
| About | one card of label and value rows (version once), Updates, then Secure Connection and Performance in one group |
| Backups, Your Files, Connections → Home Assistant | rules 5 and 6: one card per subject, short footers, Restore marked destructive |
| Four-choice segmented controls | the screen's Menu and Tab Bar Position become choice pages |

## Build order (each step its own commit, checked at the four sizes in both themes)

1. **The look** (the kit, the shell's CSS, the header card, the bar) and DESIGN.md. Every page changes at once; the
   sweep (`settings_sweep.py`) is saved before and compared after only for errors, as every picture differs.
2. **The sidebar and the setup checklist**, with every old address forwarded and search updated.
3. **The shared components**: Access, Rooms, Sign-In, Devices, and the inherited-value rows (rule 7).
4. **People, Me, Roles & Permissions.**
5. **Wall Tablets**: the list, a tablet's page, All Tablets, Add/Enroll.
6. **The other pages** in the table above, a page or two per commit.
7. **A tap on the Kitchen tablet** (Chrome DevTools over adb), before and after, as `Slow-tablets.md` asks.

Steps 4-6 touch separate files once 1-3 are on main, so they may run side by side, each in its own worktree.

## Checking

- `tools/headless/settings_sweep.py` at 1180x820 first (the crawl draws the sidebar only there), then 390x844, 844x390
  and 820x1180, WebKit, light and dark; the audit's full-length capture for the pages a step touches.
- `settings_viewports.py`, `admin_page_check.py` (People, Roles, Me, enroll), the jsc suites (the CSS snapshot follows
  each look change), `tools/ci.py full`.
- Every old address still lands (a test walks `M.routeForward` and `OLD_PAGES`).

## Build log

- **Steps 1-2 (2026-11-15): the look, the sidebar, one checklist.** The kit and the shell's CSS at the iOS 26 values in the
  table above; a section page's header card takes its icon from the sidebar (`sideTile`), a sub-page's title is the
  bar's. The sidebar is one table (`hk-settings-tables.js` SIDE, drawn by `sideGroups`): a host's rows join the group
  they name (Mantel's PAGES), its own groups go where SIDE says `@host`. Overview is the iPad's page beside the list;
  Pages is one row with its list page (`#/page`); Background a section of its own; Pages Screen a row on Menu &
  Navigation; Mantel's direct cameras a group on the Cameras page (`extend('page-cameras')`); Set Up Mantel leads the list
  as "Finish Setting Up Mantel" and carries HK's Setup Check as a row (`checkLines`), which leaves the sidebar where
  the host has a checklist (`owns.setup`). Roles & Grants is Roles & Permissions, Alerts is System Alerts. DESIGN.md
  (hk_house 3b2adefa) records the look.
- **Step 7, measured on the house's own data (2026-11-15).** A wall tablet never opens Settings (the page refuses
  them), so the measure is Settings over the house's own settings and states (`house_twin.py pull`, 326 KB of
  settings, 4,752 states) in Chromium at 4x CPU. Before the audit a tap drew its page three times (Appearance 28+29+26
  ms, Accessories 320+303+308 ms); now once (Appearance 17 ms). Accessories walked every state once per type, about 30
  times a drawing: `accIds` is read once a drawing (`_drawGen`) and the laundry finder once a set of states, 360 ms a
  drawing to about 120. `house_twin.py` reads states past aiohttp's 4 MB and finds the running Mantel by its image.
- **Steps 3-6 (2026-11-15): every page reworked, by four builders side by side** (branches p32-household,
  p32-tablets, p32-hkpages, p32-mantelpages, merged here). Household: the Access component (`web/shim/settings/access.js`)
  on a person's, a role's, a service account's and a wall tablet's page (`#/mantel/devices/access/<id>`); Me in four
  rows, Opens On and Sign Out; People by role; Roles & Permissions with a one-line summary each and every grant once.
  Wall Tablets: a list with each tablet's state, All Tablets and Mantel for Android pages, and one order on every
  tablet's page (Screen & Room, When Nobody's Using It, Display, Access, Advanced, then Reload and the red actions); one
  Room for HK and Mantel. HK's pages: a screen's page with More for This Screen, Screensaver in five groups with Photos
  and Photo Layout pages, Background with Seasonal Decorations as one row, the Tab Bar only while used, four-choice
  controls as choice pages, inherited values shown as values. Mantel's pages: Timeline, Intercom, About, Backups, Your
  Files, Connections and the rest to the same rules. The gallery's Hallway runs Mantel for Android (`ANDROID_HALLWAY`;
  a check of its own Android tablets turns it off), counted as connected through `tablet_app.sessions_of`, never as a
  page in the hub's sessions. `tools/ci.py full` passed (87 run, 12 carried).

