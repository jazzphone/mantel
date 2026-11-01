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

## Mantel 0.1.94 (1034) on TestFlight (2026-10-31)

- The iOS app 0.1.94, build 1034, uploaded to App Store Connect after Xcode's account was signed in again.

## Mantel 0.1.95 and HK Frontend 1.22.0 (2026-10-31)

- Mantel App 0.1.95 (build 38b5124bae8cd4c6, commit c321872f): /healthz?strict=1 ok, Home Assistant connected.
- HK Frontend 1.22.0 copied into custom_components (v1.22.0 on GitHub; wiki unchanged); Home Assistant restarted.
- The five kiosks reloaded; each drew its first screen in 2.2-3.2 s.
- iOS app 0.1.95 (1064) uploaded to TestFlight. Mantel Link unchanged at 0.1.8.
- ci full: 30 of 31 together; client_smoke failed once while running in parallel and passed alone.

## Mantel 0.1.96 and HK Frontend 1.23.0 (2026-10-31)

- Mantel App 0.1.96 (build 7127fddf95777e8d, commit b7589ecd): /healthz?strict=1 ok, Home Assistant connected.
- HK Frontend 1.23.0 copied into custom_components (v1.23.0 on GitHub; wiki unchanged); Home Assistant restarted.
- The five kiosks reloaded; each drew its first screen in 1.9-3.6 s.
- iOS app 0.1.96 (1089) uploaded to TestFlight. Mantel Link unchanged at 0.1.8.
- ci full: 30 of 31 together; tests/test_mantel_link.py failed once under load, passed 3 of 3 alone and in the pre-push main suite.

## Mantel 0.1.97 and HK Frontend 1.24.1 (2026-10-31)

- Mantel App 0.1.97 (build 315721f0d57d0a39, commit 3754dcc5): /healthz?strict=1 ok, Home Assistant connected.
- HK Frontend 1.24.1 copied into custom_components (v1.24.0 and v1.24.1 on GitHub; wiki unchanged); Home Assistant restarted. 1.24.1 adds the Music First fix found after 1.24.0 was published.
- The five kiosks reloaded; each drew its first screen in 2.5-5.3 s (just after Home Assistant's restart).
- iOS app 0.1.97 (1097) uploaded to TestFlight. Mantel Link unchanged at 0.1.8.
- ci full on 3754dcc5: 30 of 31 together; the main suite failed twice under load (test_mantel_link's handover, a photo upload's 20 ms event-loop limit at 23 ms), then passed alone and as its own step.

## Mantel 0.1.98 and HK Frontend 1.25.0 (2026-10-31)

- Every commit since 0.1.97 read first: two that ship (the Side Pane Clock's Under the Time strip and the weather beside the time, Home Energy's whole-screen blur, the Music block's speakers) and another session's three that don't (two steadier checks, build-tools' install, the Phase 12 plan).
- Mantel App 0.1.98 (build 53ad7a5ec265d144, commit 6bab0256): /healthz?strict=1 ok, Home Assistant connected.
- HK Frontend 1.25.0 copied into custom_components (v1.25.0 on GitHub; wiki unchanged); Home Assistant restarted.
- The five kiosks reloaded; each drew its first screen in 2.2-3.1 s.
- iOS app 0.1.98 (1107) uploaded to TestFlight. Mantel Link unchanged at 0.1.8.
- ci full on 6bab0256: 31 of 31.

## Mantel 0.1.99 and HK Frontend 1.26.0 (2026-10-31)

- Every commit since 0.1.98 read first; all ship: Virtual Pairs (5cb4f4cb, another session), the Side Pane's clock unclipped and Security at Less on one line, the room pages' Home pills, the camera badge's inset, and its CSS snapshot.
- Mantel App 0.1.99 (build ed61f2463c1c288c, commit 3de9d36f): /healthz?strict=1 ok, Home Assistant connected, Music Assistant 2.10.9 authenticated, no errors in its log.
- HK Frontend 1.26.0 copied into custom_components (v1.26.0 on GitHub; wiki unchanged); Home Assistant restarted.
- Kitchen, Living Room and Master Bathroom reloaded and drew their first screen in 1.5-2.8 s. Loft and Master Bedroom were offline (their kiosks unavailable in Home Assistant since 17:39, after drawing 0.1.98); they take 0.1.99 when they're back.
- iOS app 0.1.99 (1113) uploaded to TestFlight. Mantel Link unchanged at 0.1.8.
- ci full on 3de9d36f: 31 of 31.

## Mantel 0.1.100 (2026-11-01)

- Every commit since 0.1.99 read first: one ships (the Phase 12 MCP server, f8e2ee96: Assistants (MCP) in Mantel Settings → Advanced, the Audit Log's Through filter); the 0.1.99 record and two date-dependent checks fixed for the release (fc294204) don't. Nothing touches hk_core, web/hk or hosts/ha's component: HK Frontend stays 1.26.0, Mantel Link 0.1.8, no Home Assistant restart.
- Mantel App 0.1.100 (build c09b72c24144de87, commit fc294204): migration 0028_mcp applied; /healthz?strict=1 ok, Home Assistant connected; Mantel Link and HK Frontend relinked within a second; no "Traceback". The only "ERROR" hits are Music Assistant's `ClientConnectorError` warnings (its own machine refusing the connection), repeating since before the update.
- `/mcp` on the house through the proxy: the protected-resource metadata names `https://…/mcp`, no credential is 401 with `resource_metadata`, an unknown key is refused. Assistants stay off until the Owner turns them on.
- Kitchen, Living Room, Master Bedroom and Master Bathroom reloaded (Reload Page) onto the new pages; Kitchen drew its first screen in 3.4 s. Loft was offline, as at 0.1.99.
- ci full on fc294204: 31 of 31, nothing skipped (the browser checks with Playwright 1.62.1 and its Chromium and WebKit; the Caddy image with Docker). The first full run that day failed three checks that assumed a 24-hour day and Halloween's bats; fixed in fc294204 (a calendar day back; bats only on an occasion that has them).
- iOS app 0.1.100 (1118) uploaded to TestFlight (commit 4c86e0d7; the only local change, the project's development team, signs it).
