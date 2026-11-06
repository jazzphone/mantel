# House releases

What `tools/release_house.py` put on the house, newest last, with the checks it made. Earlier releases are recorded in the audits' pages.

Every Mantel release here is tagged `vX.Y.Z` on its release commit once the house runs it healthy, by the tool or by hand ([Releasing.md](Releasing.md#house-releases)): the Proxmox LXC's `update` follows the newest tag. Tagged from 0.1.109 on. From 0.1.111 on each is published as well: the release workflow from the tag (the Docker images, the App images, the `ha-apps` branch) and the GitHub Release.

Records of releases made with `release_house.py mantel` (phase 15) are written by the tool, house first: the LXC is updated to the release commit, with the images already pushed, before the tag exists; the tag follows once the house is healthy and the Linux suite passed, and then `latest`, the `ha-apps` branch and the GitHub Release. Each record carries the time of every step.

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

## Mantel 0.1.119 and HK Frontend 1.39.0 (2026-11-02)

- What ships (every commit since v0.1.118 read): Swipe Between Pages on the wall tablets (the docked Now Playing bar no longer refuses swipes, the Calendar's month gives way, the bar the same each landing, flicks measured right; 3aa567a2, 79aaa5bc); music group leaders (28940730, 2d66f7bc); the screensaver's slide settings, the time kept on its Position and Align, and the editor's stacking and drops (680540ea, df86e7c0, ce5a596b, b2f305c5); Live TV's sound mixed to stereo (28ad4341) and its fall back from the GPU to the CPU, with the LXC install using Intel GPUs only (5e94ab6b); Advanced -> Features and Home Assistant's reason for a refused sign-in (14e35c0e); `/` opens the screens, not /dev (5675c547); and check-only commits (the faster saver Shows check, ci.py's growth note, f407215b untracking the tools/node_modules symlink 5e94ab6b had committed).
- `tools/ci.py full` on the release tree (680540ea + the version bump): 51 of 51, nothing skipped (a first run without PLAYWRIGHT_PATH skipped the 34 browser checks; run again with it). Release commit fdce5624, `ci.py versions` 5 of 5.
- Tagged v0.1.119 and published: release workflow run 41570757405, then the GitHub Release v0.1.119.
- The house (the Proxmox LXC): the hand-applied go2rtc.yaml (the stereo fix, now in the release) reverted, then `update` over SSH: 0.1.118 -> 0.1.119, build `1fc59e0e910989d6`; all three services healthy, `/healthz?strict=1` 200, no "Traceback" or "ERROR"; Mantel Link reconnected within seconds; the five wall tablets reporting. The stopped HA App staged to 0.1.119 too.
- HK Frontend 1.39.0 copied (diff clean), Home Assistant restarted; published to jazzphone/hk-frontend, tagged v1.39.0 with its GitHub Release, the Wiki pushed (Music.md). HK Frontend is still linked to the stopped App (`ws://local-mantel:8099`) until the owner relinks it to the LXC.
- Mantel Link unchanged at 0.1.12.

## Mantel 0.1.120 and HK Frontend 1.40.0 (2026-11-03)

- What ships (every commit since v0.1.119 read): Live TV's sound and picture starting together (the first 1.2 s dropped on every video template; measured with a flash-and-beep test broadcast through the house's go2rtc: audio 0.8 to 1 s late at the start before, 0.12 s and within 0.05 s by 9 s after; 5d9427d1); the screensaver's people over the time fading with their photo, a zoomed whole portrait staying centered, the slide corner below each slide's own words (74d89d84); Align (Auto, Left, Center, Right) for a piece's words, Home Status without its Title, a titled card with no backdrop on the margin (9fa14c39); and 0.1.119's release record.
- `tools/ci.py full` on the release tree (9fa14c39 + the version bump): 50 passed, the Caddy image test skipped (Docker not running here; nothing in it touches the image). The first `versions` run failed on a tools/node_modules symlink to the main checkout (its @esbuild unreadable over the share); the release tree got its own `npm ci`. Release commit d81a674d, `ci.py versions` 5 of 5.
- Tagged v0.1.120 and published: release workflow run 41643065587, then the GitHub Release v0.1.120.
- The house (the Proxmox LXC): `update` over SSH, 0.1.119 -> 0.1.120, build `0c27b5713597835c`; all three services healthy, `/healthz?strict=1` 200, no "Traceback" or "ERROR"; Mantel Link reconnected; the five wall tablets reporting; go2rtc.yaml carries the `-ss 1.2` templates. The stopped HA App staged to 0.1.120 too.
- HK Frontend 1.40.0 copied (diff clean), Home Assistant restarted; published to jazzphone/hk-frontend, tagged v1.40.0 with its GitHub Release (the Wiki had no changes). Still linked to the stopped App until the owner relinks it.
- Mantel Link unchanged at 0.1.12.

## Mantel 0.1.121 and HK Frontend 1.41.0 (2026-11-03)

- What ships (every commit since v0.1.120 read: phase 16 and the plans for phases 15 to 19): features turned on by themselves once the house has what they need (Music, Clean Areas, Energy, Live TV; two looks 2 minutes apart, a person's choice final, no command sent; hk_core/needs.py, features/auto.py; e5d1e614, 89d593c7), Advanced -> Features' Turn Features On Automatically and the rows' notes, the `feature.enabled` Info alert (5a48fec8, 6dc64e54), a home-network tuner's lineup read at the address checked with no redirects, and the reviews' fixes (233a4a47); docs/guide/Features.md.
- `tools/ci.py full` on the release tree (d10c2d3a): 51 of 51, nothing skipped (Docker running, the Caddy image test included). Release commit 1a4a4973, `ci.py versions` 5 of 5.
- Tagged v0.1.121 and published: release workflow run 41732488607, then the GitHub Release v0.1.121. Done by hand (Releasing.md): phase 15's new flow waits on main for this record.
- The house (the Proxmox LXC): `update` over SSH, 0.1.120 -> 0.1.121, build `a18d7a553db6323a`; the three services healthy, `/healthz?strict=1` 200, no "Traceback" or "ERROR"; Mantel Link reconnected. Two looks after the start, Mantel turned **Music** on by itself ("Music Assistant is connected."; `auto.decided.music` by `auto`); Clean Areas, Energy and Live TV were already on, and Live TV's `go2rtc_once` stands.
- HK Frontend 1.41.0 copied (diff clean), Home Assistant restarted (no errors; the old link to the stopped App still warns, as before); published to jazzphone/hk-frontend, tagged v1.41.0 with its GitHub Release (the Wiki had no changes).
- Mantel Link unchanged at 0.1.12.

## Mantel 0.1.122 and HK Frontend 1.42.0 (2026-11-04)

- What ships (every commit since v0.1.121 read): phase 19, the House Timeline (the page, the Home Grid block Recent, the camera sheet's strip, Settings → Timeline and Me's switches, the morning digest and the House alert group, two MCP tools, Include Timeline Pictures, migration 0033); phase 18's route table (Mantel refuses to start with an undeclared route; the socket's reads in the table), its review's fixes (`GET /api/stats` managers only, `GET /api/areas` filtered, a wall tablet never manages another person's sessions, an assistant tests an alert channel from home only), the type-checking ratchets and hk-grid-cards.js split into six parts; the screensaver's people staying over the time when the minute changes (127dd39c).
- `tools/ci.py full --all` on 72cba2e4 (the release tree but its version lines): 53 of 53, at `CI_JOBS=4`, from a worktree on this Mac's own disk (the same run from the SMB share timed out browser checks under the other sessions' load; main's tree from local disk passed the same way). Release commit 17e14082, `ci.py versions` 5 of 5.
- Tagged v0.1.122 and published: release workflow run 41814709990 (the `ha-apps` job failed on GitHub's incident that morning and passed when re-run), then the GitHub Release v0.1.122.
- The house (the Proxmox LXC): the first `update` waited for the published images (`.env` pins them) and kept 0.1.121; after the run, `update` over SSH, 0.1.121 -> 0.1.122, build `b71b80d83b2cec26`; the three services healthy, `/healthz?strict=1` 200, no "Traceback" or "ERROR"; migration 0033 applied; the Timeline records 111 entities (alarm 4, arrival 3, detection 58, door 11, doorbell 2, garage 1, lock 9, safety 23); Mantel Link reconnected.
- Found on the house: at the start the digest ran before Home Assistant gave the house's time zone (UTC until then) and stored an empty one for today (to no channel: House is off for every channel, and no person has Morning Summary on). Fixed on main after the release (the digest waits for the house's zone, and for a whole night watched); it ships with the next release.
- HK Frontend 1.42.0 built and copied with rsync --inplace (diff -rq clean), Home Assistant restarted through its MCP (no admin token here) and serves the new files, no new errors (the old link to the stopped App still warns, as before); published to jazzphone/hk-frontend `b091042`, tagged v1.42.0 with its GitHub Release.
- Mantel Link unchanged at 0.1.12.

## Mantel 0.1.123 (2026-11-04)

- Mantel 0.1.123, release commit `6fedd10`, tagged `v0.1.123`; the LXC 0.1.122 -> 0.1.123 (build `cefd0eca4e596530`).
- Images run 41855055196 (stage=images), promote run 41856265200, GitHub Release `v0.1.123`.
- Strict health 200, all services healthy, mantel-server built from `6fedd10`, Home Assistant connected for 62 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 5 s, release commit (retry) 0 s, images run started 4 s, images built and pushed 262 s, the LXC updated and healthy 151 s, Linux suite passed 3 s, tagged 2 s, promoted (latest, ha-apps) 83 s, GitHub Release 1 s; 8.5 minutes in all.
- The bundled release (the owner, 2026-11-04): phase 15 (faster releases: this tool), phase 17 (the Intercom, Message only) and phase 18 (the route table, type checks, three web splits; its B2 waits). Every commit since v0.1.122 read. `tools/ci.py full` on c66425b9, one group at a time (`CI_JOBS=4`): 53 of 53; edit-mode 1280x800 failed three times under the other sessions' load and passed in the final run.
- The first attempt (1f30a958) stopped after the release commit: GitHub answered 404 for the images run a second after the dispatch. Fixed (6fedd104: `run_view` asks again), `ci.py full` again, then `--retry`: the record above. Its 8.5 minutes are the whole release, house first.
- After HK Frontend 1.43.0's Home Assistant restart (below), Mantel reconnected at 15:27:39 UTC and stopped answering a second later at 100 % CPU; `docker compose restart mantel-server` at 15:30:18, healthy since (strict health 200, Home Assistant connected). Cause not found yet (see FASTER-RELEASES.md's Build log); the tool now checks Mantel after a component's restart.

## HK Frontend 1.43.0 (2026-11-04)

- hk-frontend 1.43.0, commit `4487afc`, tagged `hk-frontend/v1.43.0`, copied with rsync --inplace; diff -rq shows no difference.
- Home Assistant restarted and serves `/hk/panels/hk-settings.js` (41 s from the restart).
- Published to jazzphone/hk-frontend main as `2e12009`, tagged `v1.43.0` and released on GitHub.
- The Wiki pushed (publish.py had committed changes to it).

## Mantel 0.1.124 (2026-11-04)

- Mantel 0.1.124, release commit `f82ab39`, tagged `v0.1.124`; the LXC 0.1.123 -> 0.1.124 (build `95229e964d3f213e`).
- Images run 41909970817 (stage=images), promote run 41910956666, GitHub Release `v0.1.124`.
- Strict health 200, all services healthy, mantel-server built from `f82ab39`, Home Assistant connected for 62 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 9 s, release commit on main 315 s, images run started 15 s, images built and pushed 211 s, the LXC updated and healthy 151 s, Linux suite passed 3 s, tagged 2 s, promoted (latest, ha-apps) 75 s, GitHub Release 3 s; 13.0 minutes in all.

- What ships: the fix for 0.1.123's hang after a Home Assistant restart (below), phase 18's B2 (hk-media.js in parts) and the screensaver's Date options. `tools/ci.py full` on 5cd6a283, one group at a time: 53 of 53 (some browser checks failed under the other sessions' load on a first try and passed on the next).
- The hang, found (the owner allowed Home Assistant restarts): with py-spy on the LXC host and a CPU watcher, the second restart reproduced it. Mantel reconnected while Home Assistant had no states yet, and each of the ~4500 first states that followed ran the notifications' `refresh()` over every entity (`Notifier.on_change` -> `accessories.members`). Now at most once every 2 s and once after the burst (f6e3a368, with a test that failed with 4500 reworks). On 0.1.124 two more restarts reconnected with 16 states: about 30 s near 100 % CPU while it caught up, then healthy, strict health 200. Before, it stayed there until restarted (3 and 2 minutes down on 2026-11-04).

## HK Frontend 1.44.0 (2026-11-04)

- hk-frontend 1.44.0, commit `892bfe5`, tagged `hk-frontend/v1.44.0`, copied with rsync --inplace; diff -rq shows no difference.
- Home Assistant restarted and serves `/hk/panels/hk-settings.js` (90 s from the restart).
- Mantel on the LXC reconnected to Home Assistant and was still healthy a minute later (73 s).
- Published to jazzphone/hk-frontend main as `1ae1ccb`, tagged `v1.44.0` and released on GitHub.
- The Wiki had no changes.

## Mantel 0.1.125 (2026-11-04)

- Mantel 0.1.125, release commit `c3adbbd`, tagged `v0.1.125`; the LXC 0.1.124 -> 0.1.125 (build `dd7f134703adfba8`).
- Images run 41932845676 (stage=images), promote run 41933829452, GitHub Release `v0.1.125`.
- Strict health 200, all services healthy, mantel-server built from `c3adbbd`, Home Assistant connected for 62 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 7 s, release commit on main 237 s, images run started 4 s, images built and pushed 291 s, the LXC updated and healthy 149 s, Linux suite passed 2 s, tagged 2 s, promoted (latest, ha-apps) 82 s, GitHub Release 1 s; 12.9 minutes in all.

## Mantel 0.1.126 (2026-11-04)

- Mantel 0.1.126, release commit `6c8e50c`, tagged `v0.1.126`; the LXC 0.1.125 -> 0.1.126 (build `c0a1c298b13c7c7f`).
- Images run 41953205154 (stage=images), promote run 41953965636, GitHub Release `v0.1.126`.
- Strict health 200, all services healthy, mantel-server built from `6c8e50c`, Home Assistant connected for 62 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 7 s, release commit on main 33 s, images run started 4 s, images built and pushed 242 s, the LXC updated and healthy 159 s, Linux suite passed 2 s, tagged 1 s, promoted (latest, ha-apps) 82 s, GitHub Release 1 s; 8.8 minutes in all.

## Mantel 0.1.127 (2026-11-05)

- Mantel 0.1.127, release commit `2df4e9b`, tagged `v0.1.127`; the LXC 0.1.126 -> 0.1.127 (build `c0a1c298b13c7c7f`).
- Images run 42015952546 (stage=images), promote run 42016935573, GitHub Release `v0.1.127`.
- Strict health 200, all services healthy, mantel-server built from `2df4e9b`, Home Assistant connected for 62 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 6 s, release commit on main 36 s, images run started 5 s, images built and pushed 247 s, the LXC updated and healthy 159 s, Linux suite passed 3 s, tagged 2 s, promoted (latest, ha-apps) 84 s, GitHub Release 1 s; 9.1 minutes in all.

## Mantel 0.1.128 (2026-11-05)

- Mantel 0.1.128, release commit `03aeab6`, tagged `v0.1.128`; the LXC 0.1.127 -> 0.1.128 (build `9b39d08a0f6703f5`).
- Images run 42023262197 (stage=images), promote run 42024234917, GitHub Release `v0.1.128`.
- Strict health 200, all services healthy, mantel-server built from `03aeab6`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 6 s, release commit on main 40 s, images run started 5 s, images built and pushed 247 s, the LXC updated and healthy 170 s, Linux suite passed 3 s, tagged 3 s, promoted (latest, ha-apps) 69 s, GitHub Release 1 s; 9.1 minutes in all.

## Mantel 0.1.129 (2026-11-05)

- Mantel 0.1.129, release commit `1f24c52`, tagged `v0.1.129`; the LXC 0.1.128 -> 0.1.129 (build `170eeb722787dda4`).
- Images run 42032205385 (stage=images), promote run 42033220496, GitHub Release `v0.1.129`.
- Strict health 200, all services healthy, mantel-server built from `1f24c52`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 5 s, release commit on main 34 s, images run started 6 s, images built and pushed 232 s, the LXC updated and healthy 171 s, Linux suite passed 3 s, tagged 3 s, promoted (latest, ha-apps) 83 s, GitHub Release 1 s; 9.0 minutes in all.

## HK Frontend 1.45.0 (2026-11-05)

- hk-frontend 1.45.0, commit `e1c8b36`, tagged `hk-frontend/v1.45.0`, copied with rsync --inplace; diff -rq shows no difference.
- Home Assistant restarted and serves `/hk/panels/hk-settings.js` (40 s from the restart).
- Mantel on the LXC reconnected to Home Assistant and was still healthy a minute later (67 s).
- Published to jazzphone/hk-frontend main as `45310fd`, tagged `v1.45.0` and released on GitHub.
- The Wiki had no changes.

## Mantel 0.1.130 (2026-11-05)

- Mantel 0.1.130, release commit `27b7017`, tagged `v0.1.130`; the LXC 0.1.129 -> 0.1.130 (build `ffe17ed02cb2b9e2`).
- Images run 42037135258 (stage=images), promote run 42038173470, GitHub Release `v0.1.130`.
- Strict health 200, all services healthy, mantel-server built from `27b7017`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 29 s, release commit on main 32 s, images run started 4 s, images built and pushed 259 s, the LXC updated and healthy 157 s, Linux suite passed 2 s, tagged 2 s, promoted (latest, ha-apps) 98 s, GitHub Release 1 s; 9.7 minutes in all.

## Mantel 0.1.131 (2026-11-05)

- Mantel 0.1.131, release commit `c6d72c7`, tagged `v0.1.131`; the LXC 0.1.130 -> 0.1.131 (build `ffe17ed02cb2b9e2`).
- Images run 42043405604 (stage=images), promote run 42044589422, GitHub Release `v0.1.131`.
- Strict health 200, all services healthy, mantel-server built from `c6d72c7`, Home Assistant connected for 62 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 6 s, release commit on main 34 s, images run started 5 s, images built and pushed 276 s, the LXC updated and healthy 154 s, Linux suite passed 3 s, tagged 2 s, promoted (latest, ha-apps) 98 s, GitHub Release 1 s; 9.6 minutes in all.

## Mantel 0.1.132 (2026-11-05)

- Mantel 0.1.132, release commit `96154e0`, tagged `v0.1.132`; the LXC 0.1.131 -> 0.1.132 (build `ffe17ed02cb2b9e2`).
- Images run 42079682294 (stage=images), promote run 42080706013, GitHub Release `v0.1.132`.
- Strict health 200, all services healthy, mantel-server built from `96154e0`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 4 s, release commit on main 33 s, images run started 5 s, images built and pushed 227 s, the LXC updated and healthy 154 s, Linux suite passed 3 s, tagged 2 s, promoted (latest, ha-apps) 84 s, GitHub Release 1 s; 8.5 minutes in all.

## Mantel 0.1.133 (2026-11-05)

- Mantel 0.1.133, release commit `a21c6a9`, tagged `v0.1.133`; the LXC 0.1.132 -> 0.1.133 (build `ffe17ed02cb2b9e2`).
- Images run 42085154352 (stage=images), promote run 42086568061, GitHub Release `v0.1.133`.
- Strict health 200, all services healthy, mantel-server built from `a21c6a9`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 4 s, release commit on main 35 s, images run started 15 s, images built and pushed 357 s, the LXC updated and healthy 154 s, Linux suite passed 2 s, tagged 2 s, promoted (latest, ha-apps) 98 s, GitHub Release 1 s; 11.1 minutes in all.

## Mantel 0.1.134 (2026-11-05)

- Mantel 0.1.134, release commit `f1c843f`, tagged `v0.1.134`; the LXC 0.1.133 -> 0.1.134 (build `8a27caa9ac7b7073`).
- Images run 42103130701 (stage=images), promote run 42104225866, GitHub Release `v0.1.134`.
- Strict health 200, all services healthy, mantel-server built from `f1c843f`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 4 s, release commit on main 34 s, images run started 4 s, images built and pushed 259 s, the LXC updated and healthy 155 s, Linux suite passed 2 s, tagged 2 s, promoted (latest, ha-apps) 129 s, GitHub Release 1 s; 9.9 minutes in all.

## Mantel 0.1.135 (2026-11-05)

- Mantel 0.1.135, release commit `913fb28`, tagged `v0.1.135`; the LXC 0.1.134 -> 0.1.135 (build `8a27caa9ac7b7073`).
- Images run 42107998832 (stage=images), promote run 42109092130, GitHub Release `v0.1.135`.
- Strict health 200, all services healthy, mantel-server built from `913fb28`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 4 s, release commit on main 32 s, images run started 4 s, images built and pushed 243 s, the LXC updated and healthy 175 s, Linux suite passed 2 s, tagged 2 s, promoted (latest, ha-apps) 82 s, GitHub Release 1 s; 9.1 minutes in all.

## Mantel 0.1.136 (2026-11-05)

- Mantel 0.1.136, release commit `a865e1a`, tagged `v0.1.136`; the LXC 0.1.135 -> 0.1.136 (build `883a0903781bdc19`).
- Images run 42121005842 (stage=images), promote run 42121941028, GitHub Release `v0.1.136`.
- Strict health 200, all services healthy, mantel-server built from `a865e1a`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 5 s, release commit on main 34 s, images run started 4 s, images built and pushed 242 s, the LXC updated and healthy 154 s, Linux suite passed 3 s, tagged 2 s, promoted (latest, ha-apps) 81 s, GitHub Release 1 s; 8.7 minutes in all.

## Mantel 0.1.137 (2026-11-05)

- Mantel 0.1.137, release commit `df3559c`, tagged `v0.1.137`; the LXC 0.1.136 -> 0.1.137 (build `df2a1eabcd3bd92b`).
- Images run 42127319126 (stage=images), promote run 42128278121, GitHub Release `v0.1.137`.
- Strict health 200, all services healthy, mantel-server built from `df3559c`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 6 s, release commit on main 33 s, images run started 4 s, images built and pushed 270 s, the LXC updated and healthy 152 s, Linux suite passed 3 s, tagged 2 s, promoted (latest, ha-apps) 66 s, GitHub Release 1 s; 8.9 minutes in all.

## HK Frontend 1.46.0 (2026-11-05)

- hk-frontend 1.46.0, commit `b079ca7`, tagged `hk-frontend/v1.46.0`, copied with rsync --inplace; diff -rq shows no difference.
- Home Assistant restarted and serves `/hk/panels/hk-settings.js` (46 s from the restart).
- Mantel on the LXC reconnected to Home Assistant and was still healthy a minute later (69 s).
- Published to jazzphone/hk-frontend main as `10c5a53`, tagged `v1.46.0` and released on GitHub.
- The Wiki pushed (publish.py had committed changes to it).

## Mantel 0.1.138 (2026-11-05)

- Mantel 0.1.138, release commit `875fd10`, tagged `v0.1.138`; the LXC 0.1.137 -> 0.1.138 (build `12de03d2cc91c0f7`).
- Images run 42133898259 (stage=images), promote run 42134774406, GitHub Release `v0.1.138`.
- Strict health 200, all services healthy, mantel-server built from `875fd10`, Home Assistant connected for 63 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 4 s, release commit on main 32 s, images run started 4 s, images built and pushed 258 s, the LXC updated and healthy 158 s, Linux suite passed 2 s, tagged 2 s, promoted (latest, ha-apps) 104 s, GitHub Release 6 s; 9.5 minutes in all.

## Mantel 0.1.139 (2026-11-05)

- Mantel 0.1.139, release commit `2bc1c14`, tagged `v0.1.139`; the LXC 0.1.138 -> 0.1.139 (build `bf004d1d68762c4d`).
- Images run 42157082460 (stage=images), promote run 42157591896, GitHub Release `v0.1.139`.
- Strict health 200, all services healthy, mantel-server built from `2bc1c14`, Home Assistant connected for 62 s; no "Traceback" or "ERROR" in Mantel's log.
- Linux suite passed.
- Times: preflight 4 s, release commit (retry) 0 s, images run started 3 s, images built and pushed 81 s, the LXC updated and healthy 149 s, Linux suite passed 67 s, tagged 2 s, promoted (latest, ha-apps) 65 s, GitHub Release 1 s; 6.2 minutes in all.

## HK Frontend 1.47.0 (2026-11-05)

- hk-frontend 1.47.0, commit `daa1813`, tagged `hk-frontend/v1.47.0`, copied with rsync --inplace; diff -rq shows no difference.
- Home Assistant restarted and serves `/hk/panels/hk-settings.js` (41 s from the restart).
- Mantel on the LXC reconnected to Home Assistant and was still healthy a minute later (68 s).
- Published to jazzphone/hk-frontend main as `bcfb99d`, tagged `v1.47.0` and released on GitHub.
- The Wiki had no changes.
