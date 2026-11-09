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

**Timers** (`e947f726`, /private/tmp/mantel-xl-timers: the running half of mockup 5). The owner: "the roller to create a new timer isn't implemented here. I'd like that
to be added to the Large and X-Large card as well." Mockup 14 B:
- **Large, nothing running:** "Start a Timer", four preset rings across, then the New Timer card's block layout (the wheels, a name, Start), as Extra Large's maker
  (hk-home.js `_mountMaker`, `layout: 'block'`).
- **Extra Large running one or two timers:** the timers, and the maker beside them (about 300-340 px). Three or more: the timers take the block; "+" opens the sheet.
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
