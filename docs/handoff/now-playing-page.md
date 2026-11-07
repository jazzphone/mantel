# Handoff: music players and the Now Playing page (2026-11-07)

Written for whoever picks this up next (Codex or another session). The owner's rules: American English; push finished
work to `main` only after `tools/ci.py full` passes (fetch and merge first, never force); **no house release unless the
owner says so**. Run checks from a local-disk worktree (`/private/tmp/...`), with `PYTHONPATH=<worktree>`, `NODE`,
`PLAYWRIGHT_PATH` and `CI_JOBS` set (see `tools/ci.py`).

## Done and on `main` (not released)

- `75b7e34f`: Intercom sheet room names end in "…".
- `14cf2e66`, `6c18a922`, `824dfb38`: the mockup `docs/mockups/now-playing-page.html` and its PNGs. The owner
  approved it: no wells; progress bar and volume equally far from play/pause; the queue (Up Next) only beside the Side
  Pane; the corner (time, date, weather, home status).
- `bd2063d4`, `1baf4623`, merged as `b5264708`: **every music player bare and even**.
  - Players changed:
    - the screensaver slide and pane (`web/hk/saver/hk-saver-css.js`, `hk-saver-music.js`);
    - the Side Pane mini player (`web/hk/modules/hk-sidepane.js`);
    - the Home Grid blocks and card (`web/hk/media/hk-media-now.js`, `web/hk/cards/hk-control.js` `.media-bare`);
    - the Play Music page and its mini bar (`web/hk/cards/hk-music.js`);
    - the speaker sheet (`web/hk/sheets/hk-sheet-media.js`).
  - What changed in them:
    - No wells; bigger glyphs. A button whose panel is open keeps its light.
    - White bars, as on the screensaver (`--hk-media-ink` / `--hk-media-track`). The Side Pane's volume is filled to
      its level.
    - Beside a pane, the slide lists Up Next beside the cover (`drawQueueRows`, `hk_music/queue`).
  - The measure is `tools/headless/player_look.js`. It is held in `music_pane_check`, `side_pane_check`,
    `sheet_review`, `grid_music_turn_check` and `media_card_check`.
  - The CSS snapshot was updated, and the CHANGELOG entries are under Unreleased → Changed.

## In progress: the Now Playing page (branch `now-playing-page`, NOT on main)

The owner asked for this: "swipe right on the main dashboard screen to ... the interactive music slide page for a
full screen music player", following the mockup.

What is written (worktree `/private/tmp/players`, committed on branch `now-playing-page`):

1. `web/hk/saver/hk-saver-music.js`
   - `musicView(kind, look)`: `look === 'slide'` gives a dashboard ('dash') view the slide's markup and class `.mu`.
   - `drawQueueRows` refits a page card (`w.host._fit`) when Up Next arrives.
2. `web/hk/modules/hk-saver.js` `kit()`, on the same lines because of the file-size ratchet: it now hands the parts
   `dashWatch`, `musicAct`, `renderMusic`, `musicTick`, `layoutModules`, `panelDone(v)` and `clock24()`.
3. `web/hk/saver/hk-saver-pane.js`: `PAGE_CSS` and the custom element `hk-now-playing-page-card` (`pageCard()`).
   - One shared view (`pageV`, kind 'dash', look 'slide'); its taps are wired as the Side Pane card's.
   - `_fit()`:
     - sets the height (from the page's top to the tab bar's top) and the `pane` attribute (Side Pane up);
     - calls `K.layoutMusicView` (murow beside a pane, muup upright);
     - sets `.pbox`, where the Speakers/Queue/Browse panel opens, over the cover.
   - `_corner()`: the screensaver's corner widgets (`window.hkSaverWidgets`: time, date, weather, status).
   - The pane-card hover rule became `opacity:.75` (no well).
4. `web/hk/cards/hk-strategy.js`: a view `now-playing` (menu: false, `menu_follows: 'playmusic'`, sky `playmusic`,
   card `custom:hk-now-playing-page-card`), added when Music is set up. The file stays at its 3322-line limit
   (comments were joined).
5. `web/hk/modules/hk-pageswipe.js`
   - `list()`: when Swipe Right on Home names a page out of the menu that is in the config's views, it passes it as
     `extra`.
   - `leftOfHome(items, seg, extra)` puts `extra` before Home.
6. `web/hk/settings/hk-settings-screen.js`: the "Swipe Right on Home" select offers **Now Playing** first when the
   screen has Music (`playmusic`).
7. `tools/headless/now_playing_page_check.py` + `.cjs` (WebKit):
   - checks the page at each size, alone and beside a Side Pane (song under the corner, inside the page, player bare
     and even, Up Next beside the cover);
   - checks Home's swipe order (Now Playing first);
   - then makes a touch swipe.

State of the check at 1180x820 (screenshots looked right):
- **Pass:** the page alone; beside the pane; the swipe order (`hkPageSwipe.order()` begins `/np-full/now-playing`,
  `/np-full/home`).
- **Fail:** the synthetic touch swipe on Home does not move to Now Playing (`why` empty, not blocked).
  - Not yet known whether this is the test's finger or the feature.
  - Next step: compare with `tools/headless/page_swipe_check.cjs` (its `swipe()` and `__ps` helpers, the context's
    `deviceScaleFactor: 2, hasTouch: true`, and which element it starts on).
  - Also confirm whether `hkPageSwipe` stages a neighbor that is not a menu item (`stageFor`, `neighbors`, `isHere`).
  - If the feature is at fault, fix `hk-pageswipe.js` so a neighbor from `extra` stages and lands.

## Still to do (in order)

1. Fix or explain the swipe (above). Then run `now_playing_page_check.py` at every size (no `--size`) and look at the
   shots. Check that the upright (820x1180) and phone (390x844) layouts put the music under the corner and fit.
2. Add `now_playing_page_check` to `tools/ci.py`, next to `music_pane_check`, with the same lane and inputs.
3. Things to check:
   - the page's sky shows the cover (gallery showed a purple gradient: confirm on a real screen);
   - the corner's top margin (`.ptl/.ptr top: var(--g)`);
   - the corner's time uses the screensaver's 24-hour setting (`K.clock24()`); maybe the dashboard's clock setting is
     better.
4. Unit tests:
   - `hosts/ha/custom_components/hk_frontend/tests/test_menu.js` and others may list the strategy's views (a new
     `now-playing` view);
   - run `tools/ci.py full`, update any fixtures on purpose (CSS snapshot: build with `tools/build_ha.py <dir>`, then
     `HK_UPDATE_SNAPSHOT=1 sh <dir>/tests/run csssnapshot`, then copy `tests/fixtures/css_snapshot.json` back to
     `hosts/ha/custom_components/hk_frontend/tests/fixtures/`).
5. Add CHANGELOG.md and the HK Frontend changelog (`hosts/ha/custom_components/hk_frontend/tools/publish/root/CHANGELOG.md`)
   entries under Unreleased → Added: "A Now Playing page: the screensaver's music slide as a page; Swipe Right on Home
   can open it".
6. Run `tools/ci.py full` (all pass), merge `origin/main`, then push to `main`. **Do not release.**
7. Tell the owner, and send screenshots at iPad landscape, iPad beside the Side Pane, upright and phone.

## Not in scope / known

- TestFlight needs the owner signed in to Xcode (Settings → Apple Accounts).
- The owner's Intercom listening tests are still open.
