# House releases

What `tools/release_house.py` put on the house, newest last, with the checks it made. Earlier releases are recorded in the audits' pages.

Every Mantel release here is tagged `vX.Y.Z` on its release commit once the house runs it healthy, by the tool or by hand ([Releasing.md](Releasing.md#house-releases)): the Proxmox LXC's `update` follows the newest tag. Tagged from 0.1.109 on. From 0.1.111 on each is published as well: the release workflow from the tag (the Docker images, the App images, the `ha-apps` branch) and the GitHub Release.

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
- After: build and strict health match; "house settings normalized to stored differences (version 17)" once at start; Mantel Link and HK Frontend relinked within a second; no "Traceback". The only "error" hits were five `music_assistant.get_queue` warnings at 15:36 under 0.1.77, one per tablet at the same second (Home Assistant's Music Assistant call, not this release).
- All five wall tablets reported within a minute without reloading, and reloaded onto the new pages by themselves about three minutes later.

## HK Frontend 1.12.0 and Mantel Link 0.1.6 (2026-10-26)

- HK Frontend 1.12.0 (two editors, the detail sheets in their own files) built with `tools/build_ha.py`; Mantel Link 0.1.6 (pairing protocol v2) from the repository. Both copied into `custom_components` with `rsync -rt --inplace`, no `--delete`; `diff -rq` showed no difference (HK Frontend's 9 runtime-only files kept).
- Home Assistant restarted; it serves `/hk/sheets/hk-sheet-light.js` and `/mantel_link/mantel-link.js?v=0.1.6`; both relinked to Mantel; no error from either integration in Home Assistant's log.
- HK Frontend 1.12.0 is on jazzphone/hk-frontend's main as `1ddc1ec`, untagged; its Python and JavaScript suites passed in the published layout.

## Mantel 0.1.79 (2026-10-26)

- One fix found while checking 0.1.78 on the house: with Mantel Link set up by its own credential, App discovery stands down before noting the App's hostname, so a second pairing at `http://local-mantel:8099` would have been refused by the v2 address check. Release commit `3362643`.
- Before: `tools/ci.py full` green on `7310f5c` (15 of 15). The new test failed without the fix.
- After: version 0.1.79, strict health ok, both links relinked within a second, no "Traceback" or "ERROR"; the settings normalization did not run again.

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

## Mantel 0.1.101 and HK Frontend 1.27.0 (2026-11-01)

- Every commit since 0.1.100 read first; four ship: the Music block's choices as one tile (e2db60dc), its full-cover Small, scrolling playlists and Choose a Playlist (5cba3955), the Side Pane clock's weather weight (cd4477b6), and Beside the Time's four looks with one temperature on every screen (88c1156d). The 0.1.100 TestFlight record doesn't.
- Built, checked and staged from a clean checkout of 36697de4: another session's uncommitted Mantel Link and linked-camera edits in the working folder stayed out.
- Mantel App 0.1.101 (build 260ffd194a79f08a, commit 36697de4): /healthz?strict=1 ok, Home Assistant connected, Music Assistant 2.10.9 authenticated, no "Traceback"; the only warnings are two Music Assistant artwork requests it reset.
- HK Frontend 1.27.0 copied into custom_components (v1.27.0 on GitHub with its release; wiki unchanged); Home Assistant restarted; Mantel Link and HK Frontend relinked.
- Kitchen, Living Room, Master Bedroom and Master Bathroom reloaded and drew their first screen in 1.3-3.3 s. Loft was offline, as at 0.1.99 and 0.1.100.
- ci full on 36697de4: 31 of 31. A first run that day failed because the version files were bumped while it ran.

## Mantel 0.1.102, HK Frontend 1.28.0 and Mantel Link 0.1.9 (2026-11-01)

- Every commit since 0.1.101 read first; all three ship: the Side Pane's hour strip saying the temperature now at Now (d3cc6cac, another session), Live TV's channel cameras picking Home Assistant's live player again after the link returns with Mantel's Live TV page no longer linking to HK Frontend's integration (3d686df3), and the Side Pane's Dim, music drawer and never-stuck reads, the weather blocks filling their space, the Now Playing block's progress, Lock Up's word and the top band's parts left, center or right (82f8d079).
- Mantel App 0.1.102 (build d00c6749bd2b0475, commit 313f75be): /healthz?strict=1 ok, Home Assistant connected, Music Assistant 2.10.9 authenticated, Mantel Link and HK Frontend relinked, no "Traceback".
- HK Frontend 1.28.0 copied into custom_components (diff against the build: only the house's own runtime files); Mantel Link 0.1.9 copied from its published layout (entity.py and the manifest the only differences before; none after); Home Assistant restarted; `/mantel_link/mantel-link.js?v=0.1.9` 200. No errors from either in Home Assistant's log.
- Live TV checked on the house: before, `camera/webrtc/get_client_config` refused every channel ("Camera does not support WebRTC"). After the restart all four channels answered, and again after the Mantel App was restarted to drop the link (the channels unavailable 9:25:01-9:25:10), the case that broke them that morning.
- Kitchen, Living Room, Master Bedroom and Master Bathroom reloaded (Mantel's own Reload after its restart) and drew their first screen in 1.4-3.5 s. Loft was offline, as at 0.1.99-0.1.101.
- HK Frontend v1.28.0 on GitHub with its release, from 1bf80427 (the release commit plus a test-only fix: the Alarm PIN test's random hash had held its PIN, one in about a thousand); Mantel Link v0.1.9 on GitHub with its release (repository still private). Wikis unchanged.
- ci full on 313f75be: 31 of 31, nothing skipped. iOS app not uploaded to TestFlight for this release.

## Mantel 0.1.103 and HK Frontend 1.29.0 (2026-11-01)

- Every commit since 0.1.102 read first; all ship: the Screensaver editor, phases A-E (b96e2ac3, 455e6d14, 23125012, a3bf3ada, 3863d6e4) and Big Weather's planted time (be8b8a7c); from other sessions, Time Behind's How Strict with migration 0029 (78968d65), and the Side Pane's Dim slider, swipe fading and Now Playing drawer (9b8105d4). The rest change only the checks and the release tools (51d1002f, eb4b8608, e9b99bde, d427e65b, b00d3daa, 8485218f, 63289496, 11342fe4, 3d75a937). Mantel Link has no changes and stays 0.1.9.
- Mantel App 0.1.103 (build 2df1b0eba8f9a465, commit 8b0136e6), staged with stage_ha_app.py and updated through the Home Assistant MCP (no admin token for release_house.py yet): migration 0029_photo_cutout_cover applied, /healthz?strict=1 ok, /api/version the staged build, Home Assistant and Music Assistant 2.10.9 authenticated, no "Traceback".
- HK Frontend 1.29.0 built with build_ha.py and copied with rsync --inplace; diff -rq shows no difference beyond the house's own runtime files. Home Assistant restarted and serves `/hk/panels/hk-settings.js` and the new `/hk/panels/hk-saver-editor.js`; `/mantel_link/mantel-link.js?v=0.1.9` 200. No errors from either in Home Assistant's log.
- The five tablets' Reload Page buttons pressed: Kitchen, Living Room, Master Bedroom and Master Bathroom reloaded and drew their first screen in 2.8-3.9 s. Loft is offline, as at 0.1.99-0.1.102.
- ci full on 3863d6e4's tree (run before it was committed, with the same files): 36 of 36, nothing skipped; `ci.py versions` on the release commit: 5 of 5. iOS app not uploaded to TestFlight.
- Published the same day at the owner's word: HK Frontend v1.29.0 on jazzphone/hk-frontend's main as `d264bad` (from 61b06d6f), tagged `v1.29.0` with its GitHub release; its Wiki's Screensaver and Idle page gained Edit Screensaver (`9fb6f7c`). publish.py ran with --no-tests (both suites passed in the full run); GitHub's Tests and Validate (HACS, Hassfest) passed on `d264bad`.

## Mantel 0.1.104 and HK Frontend 1.29.1: a hotfix (2026-11-01)

- What broke: the owner saved an All Screens layout with the Battery widget in the row. The Energy page's summary woke the widget that had just read it, and the widget read it again at once with a new waker each time, forever: Settings' Screensaver page and Edit Screensaver froze (the screensaver preview runs in the page's own thread), and Kitchen's and Living Room's pages died about 22 minutes after 0.1.103's reload. Found in the house's own Settings (the last request before the freeze, then the same layout frozen on the gallery house in WebKit, zone by zone, down to Battery alone). Fixed in e4f446a9 (one waker per widget, its wake a moment later, a read a second at most; a test in test_saverwidgets.js).
- Mantel App 0.1.104 (build a853a6cfa1b326d7, commit 26fb95c3): /healthz?strict=1 ok once Home Assistant was back. HK Frontend 1.29.1 copied with rsync --inplace, no difference from the build; Home Assistant restarted and serves the fixed `hk-saverwidgets.js`; `/mantel_link/mantel-link.js?v=0.1.9` 200. Mantel Link unchanged.
- On the house afterwards: Settings' Screensaver page answers at once (a 100 ms timer 1 ms late) and Edit Screensaver opens with the saved layout, its plan and 9 places drawn. The five tablets' Reload Page buttons pressed; Kitchen, Living Room and Master Bathroom drew their first screen in 1.9-2.1 s. Master Bedroom's page was dropped while its screen was off (14:04-14:09) and drew again when it woke. Loft offline.
- HK Frontend v1.29.1 on jazzphone/hk-frontend's main as `77b211c`, tagged with its GitHub release (v1.29.0 had the same freeze). ci full on e4f446a9: 36 of 36; `ci.py versions` on 26fb95c3: 5 of 5.

## Mantel 0.1.105 and HK Frontend 1.30.0 (2026-11-01)

- What ships: ef282de9, the owner's notes on his first layout: things lined up by their letters (the time's top with the top corners' words, the bottom corners on one baseline, Time Behind's figures on the margin), the same Look (Size, Backdrop, Color) for every widget and card, the row on two lines and along the bottom, a card with nothing to show drawn dotted in the editor, and a browser check that a layout with Battery never holds the page. No other session pushed since 0.1.104.
- Checked in WebKit on the gallery house first: the owner's saved layout with its date's top and the time's top both at 48 px, the weather's and Home Status's last lines both ending at 751 px; the row along the bottom on two lines at a tablet and a phone, the bottom corners clear of it.
- Mantel App 0.1.105 (build 31f0187e8820bd9c, commit 5f545d49): /healthz?strict=1 ok. HK Frontend 1.30.0 copied with rsync --inplace, no difference from the build; Home Assistant restarted and serves it. Mantel Link unchanged.
- On the house: Edit Screensaver for All Screens opens at a desktop's size with the saved layout, the page answering at once; the date and the time on one line, the bottom corners on one baseline, Now Playing and Timers dotted with their names. Kitchen, Living Room, Master Bedroom and Master Bathroom reloaded and stayed up (11 minutes and on). Loft offline.
- ci full on ef282de9: 36 of 36; `ci.py versions` on 5f545d49: 5 of 5. Not yet published to jazzphone/hk-frontend: that waits until the owner has tried it.

## Mantel 0.1.106 and HK Frontend 1.31.0 (2026-11-01)

- What ships: Edit Screensaver as where the screensaver is laid out -- its Screensaver pages keep only the photos and how they show, the wallpaper, the slides and how often, Night Mode, the Side Pane and the timing (cf3686e2, the docs 1b13432b, a check 165a830c); a + after the row's last widget and a corner's stack; Save and Cancel leave in the page's own history entry (Back after the editor's frame had gone loaded its address, the screensaver alone, full screen, in Safari), and the Settings preview frame's new addresses go in its own history.
- Built and staged from a clean worktree of 6ab48841 (another session's uncommitted Side Pane work was in the shared checkout). ci full on 165a830c: 36 of 36. Mantel App 0.1.106 (build e3f98bbd774e98c8): /healthz?strict=1 ok. HK Frontend 1.31.0 copied, no difference from the build; Home Assistant restarted. On the house the All Screens Screensaver page has only those rows, and the editor opens with its +.

## Mantel 0.1.107 and HK Frontend 1.31.1 (2026-11-01)

- What ships: the editor's screen without the slides and the house's notifications, **Slides & Notifications** to see them (the preview's alone, off each time; a preview frame's notifications hushed, hkNotify.hush), and a corner's + by where its stack is (567c4028, e1d26f98) -- music playing in the house had put Music Full Screen over the layout being edited. Also another session's f11d50f7 (read first): swiping back to Home without the grid's snap behind the Side Pane, the Pages screen's blur no longer riding along.
- From the worktree at a478f24d; ci full on 567c4028: 36 of 36; `ci.py versions`: 5 of 5. Mantel App 0.1.107 (build b7565247e8f1708c): /healthz?strict=1 ok. HK Frontend 1.31.1 copied, no difference; Home Assistant restarted. On the house: the editor's frame has Music Full Screen off while the saved option stays on, notifications dropped (drop:hushed), the time drawn. Kitchen, Living Room, Master Bedroom and Master Bathroom reloaded and drew their first screen in 1.8-4.1 s; Loft offline. Published the same day at the owner's word: HK Frontend v1.31.1 on jazzphone/hk-frontend's main as `fbdc7c1` (from 74e03d54; 1.30.0 and 1.31.0 never went out on their own), tagged `v1.31.1` with its GitHub release; its Wiki's Screens and Screensaver and Idle pages pushed (`f6a773f`). publish.py ran with --no-tests (both suites passed in the full run); GitHub's Tests and Validate passed on `fbdc7c1`.

## Mantel 0.1.108 and HK Frontend 1.31.2 (2026-11-01)

- What ships: 8b705ec2, a slider drawn by hand no longer turns the page (the owner: "horizontal sliders like volume, cause the swipe page to trigger"): touch-action none or pan-y is a control's own sideways drag (as the Home Grid's pager read it), not pan-y on a list that scrolls up and down, a pager's parts, or a row that fits (fitPan's pan-y pinch-zoom); the Pages screen's Home pill says pan-x. Swept every page of the gallery's screens: the thermostat dials, every volume, the charts and the album rows keep their drags; chips and status rows that fit stay the page's. Also 927e09cf (a flaky gateway test). Read first: 74e03d54 and 4d41a5e9, records only.
- ci full on 4d41a5e9: 36 of 36; `ci.py versions` on 299f51c5: 5 of 5. Mantel App 0.1.108 (build 2b2e39275d57ea21, commit 299f51c5) through the HA MCP (store reload, update): /healthz?strict=1 ok, again once Home Assistant was back; no "Traceback" or "ERROR" in its log. HK Frontend 1.31.2 copied with rsync --inplace, no difference from the build; Home Assistant restarted and serves the new `hk-drag.js`; `/mantel_link/mantel-link.js?v=0.1.9` 200. Mantel Link unchanged. Not published to jazzphone/hk-frontend.
- The five tablets' Reload Page buttons pressed: Kitchen, Living Room, Master Bedroom, Master Bathroom and Loft each closed the old page normally and drew their first screen in 1.9-3.2 s.

## Mantel 0.1.109 and HK Frontend 1.32.0 (2026-11-01)

- What ships: 03352489 -- the Screensaver editor drags (a widget from the left onto a green place, or one on the screen to another, with a mouse; tap then place still for a finger); the forecast among the photos or in their place has its Layout again on the Screensaver page (The Forecast: Classic or Big, Big Number, Planted Numerals, Details), and with a layout Big Weather draws as the slide, the layout's big element and widgets stepping aside and the cards where Big Weather puts them (layoutCfg had forced Classic, bigWanted refused any layout); a screen's own Side Pane in the screensaver shown on its Screensaver Options, All Screens' naming the screens with their own (the Kitchen's own pane had shown while All Screens' said Off). Also, read first, another session's 43032b5b (swiping fades the background; a press under a short page swipes it) and f1bd75a8 (new speakers join the playing group in place). 0.1.108 / 1.31.2 was that session's.
- From a clean worktree; ci full on 03352489: 36 of 36; `ci.py versions` on 4f7e247c: 5 of 5. Mantel App 0.1.109 (build 3a6d85f214527fcb): /healthz?strict=1 ok. HK Frontend 1.32.0 copied, no difference from the build; Home Assistant restarted and serves the editor's drag. On the house: All Screens' Screensaver page has The Forecast and the Side Pane naming Test (Same as the Dashboard); the Kitchen's own pane, now Off, is not named. The five tablets' Reload Page buttons pressed.
- Published the same day at the owner's word: HK Frontend v1.32.0 on jazzphone/hk-frontend's main as `b248be9` (from 0cce9f9d), tagged `v1.32.0` with its GitHub release; its Wiki pushed (`51845a8`), every image it names served. publish.py ran with --no-tests (both suites passed in the full run); GitHub's Tests and Validate passed on `b248be9`.

## Mantel 0.1.110 and HK Frontend 1.33.0 (2026-11-01)

- What ships: f49b9593, Bright Glass's Brightness (Strength until now): past 50 the sheen, the rim, the glow and saturate() keep growing above the contrast cap while the wash under the words holds at it (over Ribbons in Blue the cap had stopped the slider at 57 %); the Side Pane's Bright Glass follows the same Brightness, its Dim a shade over it; HK Settings' glass sliders show in the preview as they move (hkSettings.previewAmount). Also, read first, other sessions' 80ffb7c2 and 6659aa79 (a preset's rooms read from its Music Assistant group's settings, the rooms it gave up grouped back before it plays), 39b144d2 (a wall tablet follows its Screen), eb432e72 (a finger swipes off the Pages screen) and c658ffd4 (presets write Music Assistant's groups: New Sync Group, a sync group's rooms; Mantel only, behind commands). Another session's uncommitted backup.py was in the shared checkout and does not ship.
- From a clean worktree of 1d41107d: ci full 35 of 36, side-pane-check-1180x820 failing on a WebKit fetch cancelled by the check's own navigation (icons.json "due to access control checks"), then passed alone; `ci.py versions` on 24c529ea: 5 of 5. Mantel App 0.1.110 (build b1bf04171ccf7447) through the HA MCP: /healthz?strict=1 ok, again once Home Assistant was back; no Traceback in its log. HK Frontend 1.33.0 copied with rsync --inplace, no difference from the build; Home Assistant restarted and serves the new hk-settings.js, hk-sidepane.js and hk-idle.js; `/mantel_link/mantel-link.js?v=0.1.9` 200. Mantel Link unchanged.
- The five tablets' Reload Page buttons pressed: Kitchen, Master Bedroom, Master Bathroom and Loft drew their first screen in 2.6-2.8 s; Living Room reloaded onto its screen. Not published to jazzphone/hk-frontend.

## Mantel 0.1.111 and HK Frontend 1.34.0 (2026-11-01)

- What ships: Bright Glass's Dim (3e06d456), Half Height tiles as the Home app's pill (a3731cc2, f5f8ce81), the screensaver's corners under a slide (7cc75f0a), presets as Mantel's own lists of rooms with the revert of c658ffd4 (ac699dc9, d0df133a, 2c083542), paused music staying paused after Music Assistant's 30-second stop (08f8aed7), the one-command Proxmox install (d2a8eb9a) and restore from another Mantel on Docker and the LXC (61eb51a5). The other sessions pushed to main and left the release to this one.
- From a clean worktree of 08f8aed7: ci full 36 of 36; `ci.py versions` on the release commit a716dce1: 5 of 5. Released by hand through the Home Assistant connection: App build 0f1d2fae8d76d54a, /healthz?strict=1 ok, no "Traceback" or "ERROR"; HK Frontend 1.34.0 copied with rsync --inplace, diff -rq clean, Home Assistant restarted, the integration loaded with nothing logged. All five tablets reloaded onto the new pages within two minutes.
- Tagged v0.1.111. HK Frontend published to jazzphone/hk-frontend (31c4194), tagged v1.34.0 with its GitHub Release, the Wiki pushed.
- Not published: the release workflow's first job failed (run 41373681665). build_static.py minifies with esbuild since 2026-10-29 and the runner had none; six packaging tests stopped. Fixed in 21a4dbce; the tag stays where it is, so 0.1.112 carries the fix.
- Music Assistant's sync groups made by 0.1.110's presets stay in Music Assistant; Mantel no longer reads them. Removing them is the owner's call.

## Mantel 0.1.112 (2026-11-01)

- 0.1.111 with the release workflow's esbuild fix and release_house.py's publishing (21a4dbce): the first published release. A build-only run of the fixed workflow from main passed every job first (run 41374347205).
- Release commit 4ee0f927, `ci.py versions` 5 of 5. App build 0f1d2fae8d76d54a (the code is 0.1.111's), /healthz?strict=1 ok, no "Traceback" or "ERROR"; the five tablets kept their pages and reported within a minute.
- Tagged v0.1.112 and published: release workflow run 41376851321 passed (the suite, mantel-server, mantel-transcode, mantel-caddy, the App and Connect App images for amd64 and aarch64, the ha-apps branch at 1e936a5d), then the GitHub Release v0.1.112 with 0.1.111's notes too.
- The seven ghcr.io packages came out public (linked to the public repository), so anonymous pulls work with no one-time step. Still for the owner, once: add `https://github.com/jazzphone/mantel#ha-apps` in a Home Assistant to check it installs.

## Mantel 0.1.113, HK Frontend 1.35.0 and Mantel Link 0.1.10 (2026-11-02)

- What ships: the third audit pass (docs/development/Audit-2026-11-third-pass.md: 4 P1 and 25 P2 fixed), the owner's list of 2026-11-01 (the screensaver editor's + and Temperature, Today's song line and its switch, a preset as Plays On, playlist covers, the Side Pane's volume speaker, a Room block's glyphs and Wide rows), the open items closed on 2026-11-02 and the iPhone app leaving notifications to the phone. Every commit since v0.1.112 is this work's.
- Release commit 3bdd9cd6: `tools/ci.py full` 36 of 36 on it. Released by hand through the Home Assistant connection (no admin token for release_house.py): App build da36d2c6fff8f629, /healthz?strict=1 ok with Home Assistant connected, no "Traceback" or "ERROR". HK Frontend 1.35.0 and Mantel Link 0.1.10 (its publish.py build) copied with rsync --inplace, diff -rq clean; Home Assistant restarted; both linked again within a minute, nothing logged by either.
- Tagged v0.1.113 and published: release workflow run 41428332847 passed every job (the suite, the three Docker images, the App and Connect App images for amd64 and aarch64, the ha-apps branch at 0.1.113), then the GitHub Release v0.1.113. All of them pull anonymously.
- HK Frontend published to jazzphone/hk-frontend, tagged v1.35.0 with its GitHub Release (the Wiki had no changes). Mantel Link published to jazzphone/mantel-link, tagged v0.1.10 with its GitHub Release; the repository was made public at the owner's request (its three commits scanned clean first), with a description and HACS topics, and its Validate workflow (HACS and hassfest) passed: HACS adds it as a custom repository, category Integration.

## Mantel 0.1.114, HK Frontend 1.36.0 and Mantel Link 0.1.11 (2026-11-02)

- What ships: phase 13's one screensaver (all six phases, the owner's OK on the phase 4 before/after), phase 13's cameras (UniFi Protect and RTSP on Docker and the LXC, direct talk with PyAV, low/high streams, the HTTPS check), phase 14's system alerts, update check and Mac notifications (Apprise 2.1.0), and the LXC install that always starts Mantel (`mantel-setup`, Caddy's `default_sni`, Set Up Mantel's Address and HTTPS step). Held until those three sessions finished, at the owner's request. Every commit since v0.1.113 is this work's. Migrations 0030_photo_taken_on, 0031_alerts and 0032_push_platform applied on the house.
- `tools/ci.py full` 37 of 37 on b60a32ec from a clean worktree; release commit 84c2e63d (versions and changelogs only), `ci.py versions` 5 of 5. A build-only run of the release workflow from main (41491147045) passed every job first, since PyAV and Apprise change the images.
- Released by hand through the Home Assistant connection (no admin token for release_house.py): App build e14732d35d314adb, /healthz?strict=1 ok with Home Assistant connected, no "Traceback"; the only "ERROR"-matching lines were Home Assistant's own restart. HK Frontend 1.36.0 and Mantel Link 0.1.11 (its publish.py build) copied with rsync --inplace, diff -rq clean apart from the house-only leftovers; Home Assistant restarted; both linked again within seconds, and all five tablets kept reporting.
- Tagged v0.1.114 and published: release workflow run 41495145438, then the GitHub Release v0.1.114. HK Frontend published to jazzphone/hk-frontend, tagged v1.36.0 with its GitHub Release (the Wiki had no changes). Mantel Link published to jazzphone/mantel-link (7161281), tagged v0.1.11 with its GitHub Release.
- For the owner, only for Mac notifications: on the push relay's D1 database `ALTER TABLE handles ADD COLUMN platform TEXT NOT NULL DEFAULT 'ios';`, then deploy the worker (wrangler.toml has `APNS_TOPIC_MAC`).

## Mantel 0.1.115 (2026-11-02)

- What ships: the Proxmox LXC follows a changed container address (4de92db0): `mantel-setup` on every run, `mantel-address.service` at each boot and `update`; the Proxmox install log no longer says Mantel isn't running. Found on the owner's first 0.1.114 LXC install, whose address changed after the install. The only commit since v0.1.114 besides its release record.
- `tools/ci.py full` 36 of 37 on 4de92db0: the main suite's event-loop timing test (`test_a_large_your_files_photo_upload_does_not_freeze_the_event_loop`) measured 26 ms against 20 ms under the full run's load; it passed three times alone and the main suite passed whole on a rerun. Release commit a5d9e06f, `ci.py versions` 5 of 5. The images didn't change, so no build-only run first.
- Released by hand through the Home Assistant connection: the App's build is 0.1.114's (e14732d35d314adb; the fix is in the LXC scripts). The App had been stopped since 13:09 (from Home Assistant, not by this release), and the update left it stopped; started at 13:40, /healthz?strict=1 ok with Home Assistant connected. No tablet or proxy request reached it after the start; why it was stopped is not yet known (asked the owner).
- Tagged v0.1.115 and published: release workflow run 41502809802, then the GitHub Release v0.1.115.

## Mantel 0.1.116 (2026-11-02)

- What ships: First start's **Restore From a Backup** and another Mantel's backup restored on Docker and the LXC by sealing its secrets again with this Mantel's own key (15ef52b2). Asked for by the owner on the first fresh LXC install. The only change since v0.1.115 besides that release's records.
- `tools/ci.py full` 36 of 37 on 15ef52b2: `side-pane-check-1180x820` failed once on a WebKit page error (`icons.json` "due to access control checks") and passed on its rerun. Release commit 64c81f89, `ci.py versions` 5 of 5. The images didn't change, so no build-only run first.
- The house: the owner stopped the Mantel App on purpose (moving to the LXC). It was updated to 0.1.116 and left stopped, so this release was not run on the house; the checks and the published images stand for it.
- Tagged v0.1.116 and published: release workflow run 41513780587, then the GitHub Release v0.1.116.

## Mantel 0.1.117, HK Frontend 1.37.0 and Mantel Link 0.1.12 (2026-11-02)

- What ships: Mantel Link by Mantel's address with its own certificate pinned (pairing protocol v3, 1f7d3fb5); discovery carrying the link address, and the LXC turning the announcer on (221aa260); features added and removed on Mantel itself (60bdb7fa); Live TV turned on once for Mantel's own go2rtc (a backup from the HA App brought it in off); a restore's progress and contents, and 4 GB for backups through Caddy (ea5a6419); ci.py's faster full runs (the release-speed session's commits); the Side Pane check no longer failing on WebKit's word for a load it cancelled.
- `tools/ci.py full` on 60bdb7fa: 49 of 51 at first. `hk-frontend-py`'s loop-resolution timing test passed on its rerun; `side-pane-check-1180x820` failed twice on WebKit's "icons.json due to access control checks" (a load the page catches, cancelled as the check moved on) and passed once the check ignored that (the commit before the release). Release commit f6c000b6, `ci.py versions` 5 of 5.
- The house: Mantel runs on the Proxmox LXC now (the owner moved it today, the HA App stopped on purpose). The App was updated to 0.1.117 and left stopped. HK Frontend 1.37.0 and Mantel Link 0.1.12 copied with rsync --inplace, diff clean, Home Assistant restarted: Mantel Link loaded with no errors. HK Frontend was still linked to the stopped App (`ws://local-mantel:8099`), from before this release. The LXC itself takes 0.1.117 with `update` in its console.
- Tagged v0.1.117 and published: release workflow run 41541839289, then the GitHub Release v0.1.117. HK Frontend published to jazzphone/hk-frontend, tagged v1.37.0 with its GitHub Release (the Wiki had no changes). Mantel Link published to jazzphone/mantel-link, tagged v0.1.12 with its GitHub Release.

## Mantel 0.1.118 and HK Frontend 1.38.0 (2026-11-02)

- What ships: Mantel's screens and Mantel Settings say Mantel Settings, not HK Settings (the host shell's settingsName()/settingsPlace(), a guard test for hard-coded names; 68021a8d, 2b9cbb7c, a8972698). Home Assistant's texts are unchanged. The only other commit since v0.1.117 is its release record.
- `tools/ci.py full` on 6c4ca54d: 8 passed and 43 unchanged since they passed. Release commit 13116cc0, `ci.py versions` 5 of 5. Images unchanged; no build-only run.
- The house: Mantel runs on the Proxmox LXC; the owner takes 0.1.118 there with `update`. The stopped HA App was updated to 0.1.118 (the first update call dropped its connection and left it on 0.1.117; the second went through). HK Frontend 1.38.0 copied (diff clean), Home Assistant restarted. HK Frontend is still linked to the stopped App until the owner relinks it.
- Tagged v0.1.118 and published: release workflow run 41544690626, then the GitHub Release v0.1.118. HK Frontend published to jazzphone/hk-frontend, tagged v1.38.0 with its GitHub Release (the Wiki had no changes).
