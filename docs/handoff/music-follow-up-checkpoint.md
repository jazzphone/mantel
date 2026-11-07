# Music follow-up checkpoint — November 7, 2026

The owner requested an immediate commit/checkpoint before usage ran out. The original Now Playing handoff is finished and released. These follow-up fixes are committed but **not released yet**. Release authorization from the original request remains; finish verification first.

## Published and installed

- Mantel 0.1.147, release commit `9f077be0`, tag `v0.1.147`; house strict health and Linux tests passed. Release record is in House-releases.md.
- HK Frontend 1.48.1, Mantel commit `d0babf6d`, public commit `db94126`, released and installed; Home Assistant restarted and Mantel reconnected healthy.
- Mantel Link 0.1.13, Mantel commit `1944961c`, public commit `d7e55f3`, released and installed; restart and health verification passed.
- The original page, bare music controls, House Status, and navigation changes are all on origin/main. The last complete green gate before that release had 77 checks, none skipped.

## Follow-up work

Worktree: `/private/tmp/mantel-corner-fix`, branch `codex/music-corner-alignment`.

The owner reported three issues while the release was finishing:

1. Screensaver Music corner: time and weather ink inset from the date, both with and without a Side Pane.
2. The volume row extends beyond the progress bar on the right.
3. Selecting HK Landscapes in the editor retains a personal Photos image.

Implemented:

- `hk-saverwidgets.js` exports `alignLeft`, called by the screensaver slide corner and the Now Playing page. It measures glyph ink, snaps to a shared pixel edge, and accounts for SVG padding. The time's leading digit keeps its original tabular cell width while its glyph uses proportional figures, avoiding browser-specific tabular insets. Glyph pixel measurements are cached (48 entries), cleared after fonts load. Existing margins are adjusted only when necessary.
- `hk-saver-css.js`: volume flex basis subtracts the side margins; the pane no longer overrides this with 100%.
- `hk-saver.js`: a held preview photo is reused only if its item remains in the selected collection. Switching Photos → HK Landscapes → Photos now replaces it; appearance adjustments keep it.
- Changelog entries added to Mantel and HK Frontend.
- `corner_look.cjs`: compares screenshots with/without the corner using Pillow, including antialiased pixels. Python input is newline-delimited, with a 15-second timeout (the EOF-reading version hung on larger images; fixed). Tablet/desktop tolerance is one pixel. Below 14 px, two pixels allow text and SVG to round opposite edges; this was the last sideways-phone failure, and this checkpoint updates that tolerance.
- Music pane, Now Playing, and saver-shows checks measure painted edges instead of the old padded text boxes. Shared player measurement checks volume row bounds.
- Saver editor check seeds a fictional personal album and verifies switching sources both directions, plus holding a landscape while changing its appearance.

Commits preceding this checkpoint: `f4ab2dac`, `ec45736c`, `8b95f8a7`.

## Verification and remaining work

Focused WebKit checks passed for Now Playing at 1180×820, 1280×800 and 1366×1024, alone and beside the pane, including panels and swipes. Chromium previously passed tablet/portrait/phone music checks. The new editor source-switch regression passed. Screenshots were inspected.

A full run on `8b95f8a7` was in flight when the owner requested this checkpoint. Its main suite and all four swipe-motion checks had passed. Music pane Chromium passed every size except the tiny 844×390 corner, where painted edges were 22/23/24 pixels; the small-font tolerance above addresses that. **Run the complete gate again on the checkpoint HEAD**; do not count an in-flight run whose HEAD or working copy changed as the release gate.

An earlier full run also had an unrelated existing HK Frontend Python calendar-notification deduplication test failure (`test_feature_notifications.py::test_a_calendar_event_coming_up`, second `_tick` returned an event). No Python production notification code changed. Recheck it; do not skip it. Lower concurrency helped timing-sensitive checks in the initial task.

Commands, from this local-disk worktree:

```sh
PYTHONPATH=/private/tmp/mantel-corner-fix NODE=/opt/homebrew/bin/node PLAYWRIGHT_PATH=~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core CI_JOBS=14 ~/.venvs/mantel/bin/python tools/ci.py full
```

After the full gate passes: fetch/merge origin/main, push to main (never force), then use a clean detached worktree at origin/main with `tools/release_house.py all --from-origin` (same environment). The release plan currently proposes Mantel 0.1.148 and HK Frontend 1.48.2; Mantel Link is unchanged. The release tool handles versions, image builds, house update, checks, tags, public releases and records. No additional owner approval is needed for these authorized releases.

Screenshots: `~/.codex/visualizations/2026/11/07/01a1b680-cd6c-7701-b20f-8de0fee9c632/now-playing/`, including `follow-up/`. These are fictional-house browser checks. A live read-only preview verified the new page's idle layout under 0.1.147; real tablet touch feel is not tested.

The primary checkout `/Volumes/data/mantel` still has its local Xcode signing change, intentionally excluded. It also had an untracked original `docs/handoff/now-playing-page.md` identical to the already committed original handoff; preserve it before a fast-forward if it blocks the update. Do not commit the signing setting or discard unrelated edits.
