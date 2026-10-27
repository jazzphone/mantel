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
