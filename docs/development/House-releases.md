# House releases

What `tools/release_house.py` put on the house, newest last, with the checks it made. Earlier releases are recorded in the audits' pages.

## Mantel 0.1.77 (2026-10-26)

- Phases 0-2, 4 and 10 of the improvement plan, plus the hk-detail.js split. Release commit `b4af1b0`; staged from `18e30fb` (the release tool's commit fix), build `8e5775c55ad90794`.
- Released by hand through the Home Assistant connection (the admin token for `tools/release_house.py` is not set up yet): store reload, update `local_mantel`.
- Before: `tools/ci.py full` green on `c2a3616` (14 passed; the Caddy image test skipped, Docker not running); the WebKit sheet review passed 272 sheets.
- After: `/api/version` answers the staged build; `/healthz?strict=1` ok, Home Assistant connected; Mantel Link and HK Frontend relinked within a second; no "ERROR" or "Traceback" in the App's log.
- The migration warning (DEP-3) is gone: "0015_person_phones, 0017_app: files differ from what was applied but the schema is identical; checksums refreshed".

## Mantel 0.1.78 (2026-10-26)

- Phases 3, 5, 6, 7, 8, 9 and 11 of the improvement plan. Release commit `158d03b`, build `cfee95ac9c7d6555`, by hand through the Home Assistant connection.
- Before: `tools/ci.py full` green on `0acb3cc`, 15 of 15 with nothing skipped (Docker running: the Caddy image test ran). End to end against the scratch Home Assistant: gateway, linked (41 checks), Mantel Link alone (27), handover (22) and house (45; it paired by protocol v2), and the first-run Home screen in both regions. The image worker was run in the server image under compose's limits (read-only root, 1 GB, 256 pids): 48 MP in 2.5 s, worker peak 570 MB, loop stall 4.3 ms, progressive originals.
- The full run first caught two headless checks that read the stored house settings directly, and a reload race in two checks; both fixed before the release (`98dc563`, `0acb3cc`).
- After: build and strict health match; "house settings normalised to stored differences (version 17)" once at start; Mantel Link and HK Frontend relinked within a second; no "Traceback". The only "error" hits were five `music_assistant.get_queue` warnings at 15:36 under 0.1.77, one per tablet at the same second (Home Assistant's Music Assistant call, not this release).
- All five wall tablets reported within a minute without reloading, and reloaded onto the new pages by themselves about three minutes later.

## HK Frontend 1.12.0 and Mantel Link 0.1.6 (2026-10-26)

- HK Frontend 1.12.0 (two editors, the detail sheets in their own files) built with `tools/build_ha.py`; Mantel Link 0.1.6 (pairing protocol v2) from the repository. Both copied into `custom_components` with `rsync -rt --inplace`, no `--delete`; `diff -rq` showed no difference (HK Frontend's 9 runtime-only files kept).
- Home Assistant restarted; it serves `/hk/sheets/hk-sheet-light.js` and `/mantel_link/mantel-link.js?v=0.1.6`; both relinked to Mantel; no error from either integration in Home Assistant's log.
- HK Frontend 1.12.0 is on jazzphone/hk-frontend's main as `1ddc1ec`, untagged; its Python and JavaScript suites passed in the published layout.

## Mantel 0.1.79 (2026-10-26)

- One fix found while checking 0.1.78 on the house: with Mantel Link set up by its own credential, App discovery stands down before noting the App's hostname, so a second pairing at `http://local-mantel:8099` would have been refused by the v2 address check. Release commit `3362643`.
- Before: `tools/ci.py full` green on `7310f5c` (15 of 15). The new test failed without the fix.
- After: version 0.1.79, strict health ok, both links relinked within a second, no "Traceback" or "ERROR"; the settings normalisation did not run again.

## Mantel 0.1.80 and HK Frontend 1.13.0 (2026-10-26)

- Edit mode (phases A-G and F's fixes): pages arranged in place by Owners and Admins; the side menu, tab bar, More and the Room Order sheet; versions on every layout save; Mantel pages redraw after a settings change.
- Before: `tools/ci.py full` green on `cc0d881` (16 of 16, with the new edit-mode-check); the scratch Home Assistant Edit check passed in Chromium and WebKit.
- Mantel 0.1.80, release commit `1c4ca40`, build `98187c728747f5c7`, updated through the Supervisor: strict health ok, both links relinked at once, five tablets reported within a minute, no "Traceback" or "ERROR".
- HK Frontend 1.13.0, commit `1f5dac0`, built with `tools/build_ha.py`, copied with `rsync -rt --inplace`; `diff -rq` showed no difference (the 9 runtime-only files kept). Home Assistant restarted; it serves the new `/hk/modules/hk-edit.js` and `/mantel_link/mantel-link.js?v=0.1.6`; both integrations relinked at 21:46:09; no error from either.
- Mantel Link unchanged at 0.1.6.
- HK Frontend 1.13.0 is on jazzphone/hk-frontend's main as `af4a875`, untagged.

## Mantel 0.1.81 (2026-10-27)

- Two fixes found on the owner's iPad: Edit mode's Reduce Motion frame now fits each pill (a room's pill is 8px wider than its element), and turning Flat off reaches the scenes row on a quiet page.
- Before: `tools/ci.py full` green on `2130f72` (16 of 16; edit-mode-check gained its `still` section).
- Mantel 0.1.81, release commit `c169c15`, build `c45c8824cd06bf34`: strict health ok, both links relinked at once, five tablets reported within a minute, no "Traceback" or "ERROR".
- HK Frontend stays at 1.13.0 on the house; these two fixes reach it with its next release.

## Mantel 0.1.82 and HK Frontend 1.14.0 (2026-10-27)

- Tabs in Bar on phones (2, 3 or 4 pages besides Home and More), and All Screens → Appearance Style naming the screens that keep their own look. HK Frontend 1.14.0 also brings 0.1.81's two fixes to Home Assistant's dashboards.
- Before: `tools/ci.py full` green on `e9b4e84` (15 passed; the Caddy image test skipped, Docker not running; nothing in it touches the image).
- Mantel 0.1.82, release commit `c8e4e62`, build `f44c8c85c572563a`, updated through the Supervisor: strict health ok, both links relinked at once, five tablets reported within a minute, no "Traceback".
- HK Frontend 1.14.0 built with `tools/build_ha.py`, copied with `rsync -rt --inplace`; `diff -rq` showed no difference (the 5 runtime-only files kept). Home Assistant restarted; it serves the new `/hk/modules/hk-tabbar.js` and `/mantel_link/mantel-link.js?v=0.1.6`; both integrations relinked at 08:35; Mantel's own Home Assistant connection came back at 08:35 after the restart's 502s; no error from either integration.
- Mantel Link unchanged at 0.1.6.
- HK Frontend 1.14.0 is on jazzphone/hk-frontend's main as `3273a81`, untagged.

## Mantel 0.1.83 and HK Frontend 1.14.1 (2026-10-27)

- Three fixes from the owner's iPad: a carried pill in Edit mode keeps its blur on a blurred screen (it blurs behind itself while held, `hkGlass.carry`); a Home Grid beside the docked menu no longer scrolls in Safari (the shell's `min-height` is 100dvh); a swipe on the tab bar no longer scrolls the page under it.
- Before: `tools/ci.py full` green on `8ffe9a4` (15 passed; the Caddy image test skipped, Docker not running), with edit-mode-check's new `frost` section.
- Mantel 0.1.83, release commit `e5b031d`, build `987ebd39f5604181`: strict health ok, both links relinked, all five tablets reloaded onto the new pages and drew their first screen within 3.4 s, no "Traceback".
- HK Frontend 1.14.1 built with `tools/build_ha.py`, copied with `rsync -rt --inplace`; `diff -rq` showed no difference. Home Assistant restarted; it serves the new `hk-glass.js` and `hk-tabbar.js` and `/mantel_link/mantel-link.js?v=0.1.6`; both integrations relinked at 10:25; no error from either.
- Mantel Link unchanged at 0.1.6. HK Frontend 1.14.1 is on jazzphone/hk-frontend's main as `7aa0510`, untagged.

## Mantel 0.1.84 and HK Frontend 1.14.2 (2026-10-28)

- Speakers and Browse on a Home Grid's Now Playing block: each turns the card over into the screensaver's music panel (Speakers, Volume, Queue, Browse), grown over the page.
- Before: `tools/ci.py full` green on `066c9b0` (15 passed, with the new grid_music_turn_check; edit-mode-check skipped, its Playwright not set in the run, and the Caddy image test skipped, Docker not running).
- Mantel 0.1.84, release commit `736cc6d`, build `ff32e61497ff796e`, updated through the Supervisor (its image built in 41 s): strict health ok, both links relinked, all five tablets reloaded onto the new pages and drew their first screen within 6.2 s, no "Traceback".
- HK Frontend 1.14.2 built with `tools/build_ha.py`, copied with `rsync -rt --inplace`; `diff -rq` showed no difference. Home Assistant restarted; it serves the new `hk-media.js` and `/mantel_link/mantel-link.js?v=0.1.6`; both integrations relinked at 17:36:45; Mantel's own Home Assistant connection came back at 17:37:02 after the restart's 502s; no error from either integration.
- Mantel Link unchanged at 0.1.6. HK Frontend 1.14.2 is on jazzphone/hk-frontend's main as `b43c3f0`, untagged.

## Mantel 0.1.85, HK Frontend 1.14.3 and Mantel Link 0.1.7 (2026-10-28)

- Backups in Mantel Settings; My Sessions one row per browser (migration 0025, a re-sign-in replaces its session); a linked HK Frontend's status rows follow What Counts; the Power page's unplugged car; hassfest-clean translations and brand logos for both integrations.
- Before: `tools/ci.py full` green on `5b0e9e6` (17 of 17, the Caddy image test included).
- Mantel 0.1.85, release commit `f705b40`, build `7d41a51b9ae8d122`, updated through the Supervisor: strict health ok, migration 0025 applied, both links relinked, all five tablets reported within a minute, no "ERROR" or "Traceback".
- HK Frontend 1.14.3 and Mantel Link 0.1.7 copied with `rsync -rt --inplace`; `diff -rq` showed no difference for either. Home Assistant restarted; it serves the new `hk-energy.js` and `/mantel_link/mantel-link.js?v=0.1.7`; both integrations relinked at 23:01-23:02; no error from either.
- HK Frontend 1.14.3 on jazzphone/hk-frontend's main as `e300211`, tagged `v1.14.3` with a GitHub release (now Latest, after v1.8.3); its wiki rebuilt (47 pages, `8875128`). GitHub's Validate (HACS, Hassfest) and Tests passed.
- Mantel Link 0.1.7: the first push to jazzphone/mantel-link, `main`, tagged `v0.1.7` with a GitHub release. Its GitHub workflows did not start (Actions billing on a private repository); they run once the repository is public.
- A test pinned Mantel Link's version (`test_frontend.py`); it reads the manifest now, through conftest's `COMPONENT` so it works in the public repository's layout too.

## Mantel 0.1.86: measuring first (2026-10-29)

- Mantel 0.1.86, commit `ae8ae7b`, build `e6ae0f97d8eef139`, by hand through Home Assistant (no admin token yet).
- Strict health ok; Home Assistant connected; Mantel Link and the linked HK Frontend reconnected.
- No "Traceback" or "ERROR" in the App's log; the Kitchen, Loft and Master Bedroom tablets reloaded at once.
- HK Frontend 1.14.3 and Mantel Link 0.1.7 unchanged.

## Mantel 0.1.87, HK Frontend 1.15.0 and Mantel Link 0.1.8 (2026-10-29)

- Mantel 0.1.87, commit `5f77b2e`, build `f49c31cb0b18c0c4`, by hand through Home Assistant; strict health ok; the settings move ran (10 screens' menus now follow All Screens one setting at a time).
- HK Frontend 1.15.0 and Mantel Link 0.1.8 copied with rsync --inplace; diff -rq clean against their builds; Home Assistant restarted; no errors from either; /hk serves the minified code compressed.
- All five tablets reloaded (Reload Page) and drew their first screen in 2.1 to 2.9 s; no ERROR or Traceback in the App's log.
- GitHub: jazzphone/hk-frontend v1.15.0 (Latest) with its Wiki, jazzphone/mantel-link v0.1.8 (Latest); main pushed.
- TestFlight: Mantel Smart Home 0.1.86 (846), then 0.1.87 (860) with the iPad and iPhone Duo work, Can't Reach Mantel and the App Settings shortcut (uploaded from Xcode's Organizer once Xcode's account was signed in again).

## Mantel 0.1.88 and HK Frontend 1.16.0 (2026-10-30)

- Mantel 0.1.88, build `517b511dbfaed031`, by hand through Home Assistant; strict health ok.
- HK Frontend 1.16.0 copied with rsync --inplace, clean against its build; Home Assistant restarted (Mantel's 502 warnings only while it was down); no errors from HK Frontend.
- All five tablets reloaded and drew their first screen in 2.4 to 3.0 s.
- GitHub: jazzphone/hk-frontend v1.16.0 (Latest) with its Wiki; Mantel Link unchanged at 0.1.8.
- TestFlight: Mantel Smart Home 0.1.88 (870), with the iPhone Duo's side strip.

## Mantel 0.1.89 and HK Frontend 1.17.0 (2026-10-30)

- Mantel 0.1.89 on the house (build c897faa6f5f0eb0e, commit a5bdd593): the HomeView-style look; healthz strict ok; all five tablets reloaded cleanly.
- HK Frontend 1.17.0 on the house from the built clone; tagged v1.17.0 and released on jazzphone/hk-frontend with its wiki.
- Mantel Link unchanged (0.1.8).
- TestFlight: Mantel 0.1.89 build 934 uploaded.

## Mantel 0.1.90 and HK Frontend 1.18.0 (2026-10-30)

- Mantel 0.1.90 on the house (build 85fdcdc760de1db8, commit 2bfd2a3c): Looks, the HomeView fixes (13 owner items), stereo pairs; healthz strict ok; all five tablets reloaded cleanly.
- HK Frontend 1.18.0 on the house from the built clone; tagged v1.18.0 and released on jazzphone/hk-frontend with its wiki.
- Mantel Link unchanged (0.1.8).
- TestFlight 0.1.90 (946) not uploaded: Xcode Failed to Use Accounts; needs the owner to sign in again.

## Mantel 0.1.91 and HK Frontend 1.18.1 (2026-10-30)

- Mantel 0.1.91 on the house (build ffe7f7c204be67d5, commit 2030bb38): the Side Pane takes the album art while music plays; healthz strict ok; tablets reloaded.
- HK Frontend 1.18.1 on the house from the built clone; tagged v1.18.1 and released on jazzphone/hk-frontend with its wiki.
- Mantel Link unchanged (0.1.8).

## Mantel 0.1.92 and HK Frontend 1.19.0 (2026-10-30)

- Mantel 0.1.92 on the house (build 2ed5250cf6828f14, commit ae5be214): the screensaver Shows reach the screensaver, the Side Pane and Pages Screen fixes, columns, renaming screens; healthz strict ok; all five tablets reloaded and drew.
- HK Frontend 1.19.0 on the house from the built clone; tagged v1.19.0 and released on jazzphone/hk-frontend with its wiki.
- Mantel Link unchanged (0.1.8).

## Mantel 0.1.93 and HK Frontend 1.20.0 (2026-10-31)

- Mantel App 0.1.93 (build fd4a80f1e5416a3e, commit 2153fcb9): /healthz?strict=1 ok, Home Assistant connected.
- HK Frontend 1.20.0 copied into custom_components (v1.20.0 on GitHub; wiki unchanged); Home Assistant restarted.
- The five kiosks reloaded; each drew its first screen in 1.8-2.8 s.
- Date-dependent tests fixed before publishing (82ae53dd): they failed after midnight.

## Mantel 0.1.94 and HK Frontend 1.21.0 (2026-10-31)

- Mantel App 0.1.94 (build f3db0570185d013f, commit a2fa28dc): /healthz?strict=1 ok, Home Assistant connected.
- HK Frontend 1.21.0 copied into custom_components (v1.21.0 on GitHub; wiki unchanged); Home Assistant restarted.
- The five kiosks reloaded; each drew its first screen in 2.7-3.7 s.
- TestFlight 0.1.94 (1034) not uploaded: Xcode's account needs signing in again (Failed to Use Accounts).
