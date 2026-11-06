# Screensaver designs and physical page swipes

Implemented locally November 6, 2026. This document tracks the authorized implementation; it is not a deployment record.

## Scope

- Keep Mantel's existing HomeView and all 44 screensaver widgets, seven placement zones, upright layouts, background choices, slides, photo options, timing and night settings.
- A gallery of saved designs, with a name, duplication, removal, and all settings kept per design. Current screens retain their appearance until edited.
- All Screens owns the shared library. A screen using Same as All Screens inherits that library and its active design; saving locally makes a complete independent copy. The Side Pane remains the screen's independently resolved setting.
- Direct screensaver selection and entry to customization, respecting existing role restrictions.
- Ten additional face families: Solar, Prism, World (globe/horizon/close), Hotel, Terminal, Atelier, Meridian, Markets, Daily Brief and Modular. Existing clock styles and ten Looks remain available. Data faces use configured sensors, with honest empty states.
- A touch-friendly editor with the actual runtime preview, all widget options and conditions, and no narrow-screen lockout.
- Reliable slide selection and explicit Side Pane controls in both preview locations. A preview must neither control the home nor write tablet screensaver switches.
- Main dashboard swipes must follow the finger through Calendar and Live TV updates, continue at release velocity, reverse naturally, permit grabbing a settling page, and leave every page in a usable resting state. Retain vertical scrolling, controls, edge navigation and reduced motion.

## Excluded character clocks

Mickey and Minnie are excluded from this release following visual review. The attempted reference-based artwork did not meet the required quality. No character renderer, settings, artwork-serving changes or supplied images are part of this release. A future attempt needs production-quality layered artwork before implementation.

## Validation and release

The implementation was checked against isolated fictional houses. These are completed checks, not a house deployment record:

- The main quick suite passed earlier in the implementation: 6,406 tests passed, with 14 existing skips. Subsequent fixes were checked with the focused suites below.
- Saved-design schema and compatibility plus the file-size ratchet: 19 tests passed. Sparse saved options retain values derived from legacy settings as well as explicit values.
- HA build, HA Python suite (790 passed), frontend JavaScript suites, Python types and JavaScript types (105 files, zero errors): passed.
- Dashboard swipe destinations: all eight Chromium/WebKit tablet and phone orientations passed.
- Frame-by-frame motion: Chromium 1280×800 and 390×844, WebKit 1180×820 and 390×844 passed, including populated Calendar/Live TV replacement, native touch cancellation, rapid/reversed/interrupted gestures, Home/Pages handoffs, the media bar, navigation and Side Pane motion, reduced motion and gesture cleanup.
- Saved designs: Chromium 1280×800 and WebKit 1180×820 / 390×844 passed. This covers the added face renderers, 44 widgets, rename/duplicate/remove, both save scopes, ordinary settings edits staying in the active snapshot, preview slide/pane control, browser-local selection persistence, Customize and Use Saved Default. Chooser actions fit the phone.
- Existing editor and clock-face checks: passed. Side Pane checks passed at 1180×820, 820×1180 and 390×844.
- Existing saved layouts: all 68 runs passed across sideways/upright tablet and phone sizes (`saver_shows_check.py --only saver-lay-`). The separate settings preview check passed, including updating in the same frame and restoring the dashboard preview.
- Saver split-manifest check and whitespace check: passed.

The final native Chromium Music reproduction had a trusted `pointercancel` immediately after horizontal movement began. Explicit pointer capture alone could not prevent the browser taking the inner scrolling area's gesture. Keeping only a won, single-finger horizontal gesture fixed that reproduction; the vertical-scroll and control regressions also passed.

Browser automation covers Chromium native touch input and WebKit pointer handling; it does not establish real iPad/Safari touch acceptance. The numbered release and installation are recorded separately in [House releases](../development/House-releases.md).

## Implemented behavior

The gallery offers 44 starting points: the 20 existing clock styles, ten existing Looks, ten new face families and four additional World/watch variants. Keep up to 12 named designs, duplicate or remove one, then Save from the gallery or Customize in the existing editor. Each snapshot carries all ordinary saver options, its complete widget layout and its upright variant. Old configurations retain their appearance until edited.

All Screens supplies the library and saved default to screens following it. Saving from an individual screen makes an independent copy of the inherited library; it does not edit All Screens. The screen's Side Pane still resolves separately. The settings row identifies the saved default and how many designs are stored.

Hold a quiet part of a running saver to browse designs. Selection is remembered in that browser for that screen and signed-in user. It does not write house settings. Use Saved Default clears the selection; a change to the screen's saved saver settings also clears it. Owner/Admin sessions outside tablet mode can enter Customize for the selected design through the existing settings page and audited save route. Tablet/viewer selection does not grant editing access.

The editor retains all 44 widgets, their shapes, sizes, options, conditions and placement controls. Narrow windows get a live preview above switchable Pieces & Looks / Settings panels. The gallery and on-screen selector use native scrolling and snapping; programmatic positioning cannot change the active design. Reduced motion remains respected.

Preview Slide is held across option rebuilds. Forecast, Weather, Music and Home Energy can be requested independently of automatic slideshow settings. Missing playback or energy data produces a specific message. Include/Hide Side Pane affects only the preview. Pane width and side follow the screen's actual configuration; ineligible small sizes show an explanation and preserve the space for the face. Preview status keeps updating while it is open.

World uses an orthographic globe with simplified coastlines, a longitude control, direct dragging, arrow keys and a short inertial release. Reduced motion disables the inertial release. Markets reads configured numeric sensors (optional `change_percent` attribute); Daily Brief reads a configured sensor's `entries`, `items` or `news` list. Neither face fetches external feeds or substitutes sample readings when no source is configured.

Dashboard swipes take pointer ownership only after horizontal intent wins, release capture explicitly, and leave controls and vertical scrolling their own gestures. A won horizontal touch also prevents the browser from cancelling it through a card’s inner scrolling area; before axis lock, vertical scrolling and pinch remain native. Incoming page replacement waits until movement finishes. The page, navigation highlight and Side Pane use the same release curve. Pages now receives the docked player when On Every Page is enabled, including the handoff from Home's music pane. A covering sheet continues to own its gestures.

## Acceptance still requiring a physical device

Browser checks use fictional data and isolated local servers. Chromium receives native touch input; WebKit's gesture checks use synthetic pointer input. These do not prove real iPad/Safari touch feel, thermal behavior or long-running tablet memory use. Record physical tablet acceptance following the approved house update. No deployment or version bump is part of this working-tree implementation.
