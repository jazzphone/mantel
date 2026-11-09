# Cards round, 2026-11-09: the approved mockups still to land

The owner reviewed side-by-side comparisons (today's house, 0.1.158, beside each proposed build) and said: "I like them all", with two changes:
Security and Timers (below). Each build is committed in its own local-disk worktree, **not pushed**. Nothing here is on main or the house.

## 1. Approved as built: push these

| Mockup | Block | Commit | Worktree | Notes |
|---|---|---|---|---|
| 4b | Doors & Locks (`doors`, hk-grid-panel.js) | `6c619437` | /private/tmp/mantel-xl-doors | one calm list; headline "1 Open" / "All Closed"; audit counts a `role=list` of rows as one control |
| 6 | Suggested Scene (`scene_suggested`) | `f4185c1d` | /private/tmp/mantel-xl-sugg | Run Now, a "Later" list; adds an XL size (catalog + home_grid.py); `laterScenes` in hk-grid-math.js |
| 7b | House Status (hk-house-status.js) | `2954a0ac` | /private/tmp/mantel-xl-hs | headline top-left, "All Good"; L too |
| 8b | Room + Scenes (hk-grid-room.js, hk-chip.js) | `86ab267e` | /private/tmp/mantel-xl-8b | reverts today's two-column XL (4b20f762, c12d31b7); XL three across, Full Width six, top-left; the Scenes `windows` option removed |
| 9 | Live TV Large (hk-media-tv.js) | `14a15afc` | /private/tmp/mantel-xl-tvl | 2 x 3 at Large; grid_panels_check expects 5 -> updated |
| 12b | Now Playing, nothing playing (hk-media-now.js, hk-media-recent.js) | `6f955cc3` | /private/tmp/mantel-xl-npidle | L and XL idle; XL playlists on the right (the owner's choice); gallery.py sends playlists |

## 2. Approved with changes: finish, then push

**Security** (`d08e36de`, /private/tmp/mantel-xl-sec). The owner: "we made some changes to the security cards in previous sessions that I would like to keep... like the
alarm showing when armed and using the apple icon. Also needs to open the keypad if the alarm supports it when hitting armed, or the detail sheet for it to be set...
I'd like a combination of both." Mockup 14 A (scratchpad mock2/m14.py, m14.png):
- The **HomeView** presentation (`hk-plate.hv`, the house's) keeps the alarm as it is (Apple's shield, Light Up When Armed: the alarm alone lit, a tap on it the
  keypad when the alarm has a code, else its sheet) and takes 4b's rows for the locks: no plate per row, the disc, the state at the right (Wide: under the name),
  the unlocked one orange. d08e36de changed only the standard presentation's rows: keep those, add the HomeView ones.
- Check commits 74ef14cb, a9c98047, 1d5f8289, 9bd8a35f, fa8ee1bf (other sessions) are all still in effect after the change.

**Mockup 14b supersedes 14** (scratchpad mock2/m15.py, m15.png; the owner asked to see it before the build): Security at every size (XL keypad + rows +
toast; L and T alarm, rows, toast at the foot; Wide and Compact the toast under the alarm, the owner's ask; Small the shield and "1 unlocked · 1 open"), disarmed and
armed (the alarm alone lit). Timers below follow 14b too.

**Mockup 14d** (scratchpad mock2/m16.py, m16.png) sets Security's Wide and Compact: the owner, "I only want Locks and Garages... I still want the toast for windows
and doors but maybe it just belongs under the Locks and Garage Doors on the right side". So: the alarm alone on the left, centered (its line "1 unlocked · 1 open");
on the right the locks and the garage doors only, as 4b rows (the state under the name; Compact two columns), and under them the flat Doors & Windows toast. Nothing
open: no toast. (The toast under the alarm, 14b, "looks really awkward"; the open window as a row, 14c, was not what he wanted.) Large, Tall and Extra Large keep
the toast at the foot.

**The alarm's words and glyphs** (the owner: "I also don't know why Home and the Tap text is there... is the mock up just using that icon and not apples?... the
glyph and wells, do they follow HomeViews styling?"): the alarm reads "Armed" or "Disarmed" (no mode, no "Tap for the keypad"), its one line under it
("1 unlocked · 1 open"); the tap still opens the keypad or the sheet. Its glyph is the real one, `C.alarmGlyph` (hk:shield-off disarmed, shield-home armed home,
shield-lock away -- Apple's SF Symbols from the house's hk-glyphs.js; the mockups now draw them too, scratchpad mock2/sfkit.py). The rows' glyphs are the house's
hk: icons; their circles are the list discs On Now and House Status use (`.dk`), colored as HomeView colors a lock: teal locked, orange when it needs a look.

**The alarm glyph is the siren light, not a shield** (the owner: "That is not the Alarm glyph for Apple... Apple uses like an Alarm Bell style Glyph", then chose
"The siren light"). Change `ALARM_GLYPHS` in web/hk/grid-cards/hk-grid-security.js (it feeds `C.alarmGlyph`: the Security blocks, the Side Pane, the generated alarm
tile): disarmed and disarming `hk:alarm-light-off`; every armed state and arming `hk:alarm-light`; pending and triggered `hk:alarm-light` in red. Both glyphs are
already in the house's hk-glyphs.js (Apple's SF Symbols); check the Material fallback names exist too for a house without the glyph file. The screensaver's own
shield (hk-saverpieces-home.js SHIELD) should follow. Mockup 14d (m16.py) draws it.

**Compact won't add** (the owner's screenshot, Kitchen HomeView, a 5 x 4 square grid with four free cells in its top row): choosing Compact (3 x 1) in the card picker
says "A Compact Security doesn't fit there. Drop it nearer the middle, or pick a smaller size." and Add does nothing, though a 3 x 1 place is free. Find why
(hk-grid-editor.js: the picker's `firstSpace` / the drop's placement for size `C`, and Compact being HomeView Security's alone), fix it, and add a check.

**Timers** (`e947f726`, /private/tmp/mantel-xl-timers: the running half of mockup 5). The owner: "the roller to create a new timer isn't implemented here. I'd like that
to be added to the Large and X-Large card as well." Mockup 14 B:
- **Large, nothing running:** "Start a Timer", four preset rings across, then the New Timer card's block layout (the wheels, a name, Start), as Extra Large's maker
  (hk-home.js `_mountMaker`, `layout: 'block'`).
- **Extra Large running one or two timers:** the timers, and the maker beside them (about 300-340 px). Three or more: the timers take the block.
- **Always a way to make another** (the owner: "Your 3 or more timer XL card has no way of creating another timer...there should always be a way right?... a simple plus
  button to create a new timer when it is full"): any running block with no spare place for "Start another" (Extra Large with three, Large with two, Tall, Wide with two)
  shows a plain orange "+" (a 56 px target) at the top right, on the heading row beside "+N more", that opens the New Timer sheet (`_newGridTimer`, the wheels).
  14b puts the + on EVERY running size, Small included (its one key): the owner, "There needs to be a way to add a timer at all times with these cards."
- **Keys a finger can hit** (the owner: "should the touch services for the timers be easier for a finger to hit? The same small and close together"): Pause and
  Stop 52 px with 14 px between, in 56 px targets; the + 52 px. e947f726 has 48 px discs in 56 px targets with 8 px clear: raise them.
- **Large running:** its two timers (as e947f726).
- Decisions already made: Wide shows two running timers with their keys (`CONTROLS_RULES_OF["timers"] = {"W": 4}`); Extra Large shows up to three, "+N more".

## 3. Landing it

1. In /private/tmp/mantel-cards (detached at origin/main), cherry-pick or rebase each commit in turn. Expected conflicts: both CHANGELOGs (keep both sides),
   hosts/ha/custom_components/hk_frontend/tests/fixtures/css_snapshot.json (take either, then rebuild and re-record: `tools/build_ha.py DIR`,
   `HK_UPDATE_SNAPSHOT=1 sh DIR/tests/run csssnapshot`, copy the fixture back), tools/headless/home_grid_audit.py (states from several builds: keep all),
   tests/fixtures/file_sizes.json (`python tests/test_file_sizes.py --update` if a file shrank).
2. All JS tests, `tools/typecheck/check.py`, then `tools/ci.py full` (PLAYWRIGHT_PATH and NODE as in the brief: scratchpad xl-brief.md).
3. Look at every changed block again with `tools/headless/home_grid_audit.py --only <key> --looks blur_night --homeview --hits --controls`.
4. Push to main; release as Mantel 0.1.159 + HK Frontend 1.55.0 (`tools/release_house.py mantel 0.1.159 --from-origin`, then
   `tools/release_house.py hk-frontend 1.55.0 --from-origin --github-release`), then press the five `button.*_kiosk_reload_page` buttons.
5. Remove the worktrees once their commits are on main.

## 4. Smaller things noticed, not yet asked for

- The Vacuum block's "All rooms" row is 44 px (the block rule is 56).
- Small On Now shows "0" for a kind with nothing on, Wide "Off".
- Doors & Locks Wide on a tile cell fits one row plus "2 more"; Now Playing Large idle on a tile cell leaves out the playlists row.
