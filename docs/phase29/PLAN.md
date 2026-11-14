# Phase 29: The sky drawn by the tablet app (plan, 2026-11-12)

**Status: built (2026-11-13), steps 1-5 on Mantel main and mantel-android main; step 6 measured on the Loft (below): every busy
scene cheaper in the app, every calm one kept by the page at the same cost. **On the house** since 2026-11-13 evening, with
the owner's OK: hotfix 0.1.166-main.536904263, Mantel for Android 0.1.11 (1031) published, Sky Drawn by the App on for
the Loft only.
Every decision answered:** 1, 2 and 4 on 2026-11-12; 3, the glass, on 2026-11-13 (the owner: "we should finish phase 29").
Step 7 (DESIGN.md) waits for the owner to ask.

## Why

A wall tablet's page costs the most while its sky moves. On the Loft (Galaxy Tab A9+, awake, nobody touching, the share
of one core):

| Scene | The page draws the sky | The app, 60 fps | The app, 30 fps |
|---|---|---|---|
| Halloween night (bats, witch, candles, fog) | 1.86 | 1.23 (−34 %) | 1.02 (−45 %) |
| Pouring rain | 1.72 | 1.31 (−24 %) | 1.00 (−42 %) |
| Heavy snow | 1.69 | 1.24 (−27 %) | 0.99 (−41 %) |
| Realistic clouds, slow | 0.86 | 1.1–1.35 (worse) | 1.13 (worse) |
| Nothing moving (the floor) | 0.65–0.80 | | |

**Why the app wins on a busy sky.** Chromium redraws the whole page and composes it again every frame something in the
sky moves, and each glass card blurs the moving sky again. The app draws the sky on a surface of its own under a
see-through page: the page draws nothing while the bats fly, and the app can draw at 30 frames a second.

**Why it loses on a calm one.** Chromium redraws only what changed: slow clouds inching along cost it slivers. The
prototype's player redraws the whole screen whenever anything has moved half a pixel, and 25 slowly drifting clouds
pass that mark almost every frame. Each new cloud also costs a small bake. So a calm sky stays the page's (decision 1).

**Can the page get there alone? Checked 2026-11-13: no.** On the Loft again, page only, the share of one core (two
readings each; under the night curtain made 99.6 % opaque, so the room stayed dark and nothing was culled; the page's
own numbers came out as the day before's):

| Busy sky | The page today | Still glass (no live blur) | Still glass, sky in 30 fps steps | One canvas drawn at 30 fps | The app, 30 fps (11-12) |
|---|---|---|---|---|---|
| Halloween night | 1.94 | 1.81 | 1.72 | | 1.02 |
| Pouring rain | 1.71 | 1.61 | 1.76 | 1.46 | 1.00 |
| Heavy snow | 1.70 | 1.28-1.64 | 1.61 | | 0.99 |

Nothing moving: 0.73-0.88. The still glass saves about a tenth of a core. Stepping every sky animation to a shared 30 fps
grid saves nothing: Chromium still makes 60 frames a second while any animation runs. Hiding the grain and scrim (the
full-screen layers the moving parts force) saves nothing either. The rain drawn into one canvas only 30 times a second, every
other sky animation paused, still cost 1.46 (1.74 at 60): on this tablet any change on screen costs Chromium about 0.7
of a core at 30 fps, against the app's 0.25. So the app's saving is real and the page can't get it; the app is still the way
for the wall tablets. Not checked again: the app's own numbers (it holds the sky while the curtain is up), and the app's
GPU memory (its pictures are 72-99 MB).

## What it is

**hk-sky stays the one sky.** Nothing about any scene is written twice. When the page's host offers it, hk-sky hands a
busy scene over: the moving parts' CSS keyframes and timing (the Web Animations API) and pictures of each part, baked
from the page itself. The app plays those keyframes on its own surface and the page's own sky is clipped away and
paused. A new kind of scene works in the app with no change, as long as it moves by CSS keyframes on transform and
opacity, as every scene does today.

- **In Mantel** (this repository), a hand-over part of hk-sky (`web/hk/sky-parts/`). It does what the prototype's
  injected script does: it finds the moving parts, bakes only what changed (each part's signature), finishes a crossing
  on the page when the app's ends (realistic clouds), and hands the sky back whenever the scene turns calm or the host
  can't play it. It runs only where the host shell offers a player (`hkShell.skyPlayer()`): Mantel's shell answers with
  the tablet app's bridge, and Home Assistant's facade answers none, so HK Frontend never hands anything over.
- **In hk-glass**, a "frost picture" mode: each glass layer wears hk-glass's own blurred picture of the sky (the one
  Pre-rendered glass paints) as a fixed background, because the live blur sees only the see-through page. It replaces the
  prototype's restyling of hk-glass's layers from outside.
- **In the app**, only the bridge and the player: `SkyScene` (Web Animations timing and CSS easing, unit-tested),
  `SkyView` (its own surface and thread), `NativeSky` (the bake, by copying the window as the display shows it, and a
  live cover while it bakes). The injected script goes.

**A busy scene** is one the page redraws every frame anyway: a part that moves faster than about 100 px a second, a
flipbook (`steps()`), or rain or snow falling. Decided at each hand-over from the keyframes themselves, not from a list
of scenes, so a new scene is sorted the same way.

## Decisions for the owner

1. **Which skies the app draws.** **Answered: busy skies first.** The owner asked how hard "every sky" would be to undo:
   a tablet's switch off gives its page its own sky again, a host without the app never hands over, and the code is one
   hk-sky part, one hk-glass mode and the app's player. Calm skies join only once the player redraws only what changed and
   beats the page on the Loft. *Recommended: busy skies only* (bats, birds, flybys, rain, snow, fireflies, the
   witch), with calm skies, clouds and wallpapers left to the page. The alternative, every sky, needs the player to
   redraw only what changed first, and was worse than the page on calm skies as built.
2. **Its frame rate.** **Answered: 30 frames a second.** *Recommended: 30 frames a second.* It halves Android's own work too, and is where most of the
   saving is (about 0.85 of a core on Halloween night against 0.63 at 60). Bats and rain at 30 look like a film's motion
   rather than a game's; worth a look on the Loft before it's decided.
3. **The glass over it.** **Answered 2026-11-13: the still frost picture** (the owner: "we should finish phase 29", after
   the glass check below passed for page changes, swipes, scrolling, edges and sheets). It was the gate for the whole
   phase. The owner's Pre-rendered bugs (2026-11-12):
   transitions from one screen to another; the blur sometimes not looking right; a blurred outline outside the blurred
   element; the blurred area not moving correctly on scroll. "Shared Layer is just way more reliable." A sky the app draws
   leaves Shared Layer nothing to blur (the page is see-through), so the glass over it can only be a still picture. **So
   the first step is a glass check, not the build:** the frost-picture mode alone, side by side with Shared Layer on the
   Loft and the emulator, recorded, on each of those four (screen changes and swipes, scrolling, edges, the picture
   itself). Not as solid as Shared Layer: the phase stops, the app-drawn sky stays a prototype, the tablets keep Shared
   Layer. The owner: still frost is fine, but Pre-rendered glass has a lot of graphical bugs,
   and he is hesitant if that is the outcome. The frost-picture mode shares Pre-rendered's picture (hk-skyshot's painting),
   not its pinned child (the rectangle bug below); the picture's own faults around page changes and swipes would come
   along. Before anything reaches a tablet: the owner's list of Pre-rendered bugs, each an acceptance check against the
   live blur (page changes, swipes, sheets, scrolling). *Recommended: the still frost picture,* as Pre-rendered glass has it: right at every scroll
   position, no blur on any frame, but the clouds and rain don't move behind a tile. The only alternative is a blur
   drawn by the app, which would lag the cards while the page scrolls.
4. **Where it's turned on.** **Answered: per tablet.** *Recommended: per tablet,* Mantel Settings → Wall Tablets → the tablet → Mantel for
   Android → **Sky Drawn by the App** (on, once the Loft has run it a week). With it off, nothing changes.
5. **iOS.** *Recommended: after Android's is on the house.* The same hand-over, with a second player in the iOS app
   (a see-through WKWebView over a layer of its own).

## The build, in steps

0. **The glass check** (decision 3): the frost-picture mode only, against Shared Layer, on the owner's four bugs. The
   phase goes on only if it passes. **First run, 2026-11-12, on the Loft** (Bright Glass, recorded at 20 frames a second:
   Home → Security → scroll → Home, a swipe across and back; the frost picture stood in by wearing Pre-rendered's own
   picture as each layer's fixed background). Swipes, scrolling and edges: the frost picture matched Shared Layer, with
   none of Pre-rendered's hard edge where its pinned picture starts. Screen changes failed: the last page's glass for
   100-150 ms (Pre-rendered's: 100-350 ms on the cards, 0.7 s on the tab bar), a fault of the picture's timing that both
   share. Fixed in hk-glass (a picture worn only while the address, the sky and the picture agree;
   `pre_glass_motion_check` checks every frame) and run again: all three modes the same in every frame, both ways.
   **Sheets, 2026-11-13, on the Loft** (the Lamp's sheet, Weather scrolled down and back, the Home sheet; Shared Layer and
   the frost picture recorded): opening, scrolling and closing the same in both, no stray frost, outline or old picture.
   But a sheet isn't hk-glass: each panel blurs live behind itself (`backdrop-filter: blur(34px)`), so this only shows the
   page's glass around a sheet. Over a sky the app draws, a sheet's live blur would see the see-through page and no sky,
   so step 2 has to cover sheets too. The emulator half is skipped (the Loft is the tablet that runs it first); the frost
   picture was left on the Loft for the owner to look at (until the page reloads).
1. **The hand-over part in hk-sky**, moved over from the prototype, with node and headless tests: the scene it hands
   over for a fixed sky (parts, keyframes, timing), what counts as busy, the signatures (an unchanged part keeps its
   picture), crossings finished on time, the sky handed back when calm, nothing at all in Home Assistant's host.
2. **hk-glass's frost-picture mode**, with a test that its layers wear the picture and no live blur while the sky is
   handed over, and are back to the look's own glass after. **The owner (2026-11-13): no repaint for fast-moving
   things.** The picture leaves out what the app draws (bats, rain, snow, flybys) and is never painted again because
   they moved; it follows what changes (another page, weather, a cover) and the slow drift, as Pre-rendered does. Its
   timing at a page change is Pre-rendered's, fixed the same day (the tab bar's flicker on the Loft: the glass follows
   the sky on screen, not the address). **And through a swipe** (the owner, 2026-11-13: the stand-in's blur "pops in
   and out" on quick swipes): Pre-rendered takes a moving page's picture off and blurs live until it lands, and the
   stand-in rode on that; over a sky the app draws live blur shows nothing, so the frost picture stays on a moving page
   (a fixed background is in line wherever the page is). Sheets too: their panels blur live behind themselves, so
   while the sky is handed over they wear the same picture (or the sky comes back to the page while a sheet is up).
3. **`hkShell.skyPlayer()`** in both shells and `hk-shell.d.ts`; the app's bridge answers it.
4. **The app**: the bridge and the player from the prototype, the injected script gone, the switch read from the
   tablet's settings, 30 frames a second (decision 2).
5. **The setting** (decision 4) in Mantel Settings and `hk_core`, with its tests.
6. **On the Loft**: the five scenes above again, page and app, plus a clear day and a moving wallpaper. Acceptance: on
   every busy scene the app beats the page, and on every calm one the page keeps the sky (no worse than today).
7. **DESIGN.md**, when the owner asks: the glass over a sky the app draws (decision 3), and its frame rate.

## Found on the way

- **Pre-rendered glass draws a frosted rectangle on Android's WebView.** Its picture is a `position: fixed` child of the
  layer, and the WebView doesn't clip a fixed child to its parent's `clip-path`: the whole view's rectangle shows frost,
  not only the cards. Seen on the emulator with the page's own Pre-rendered glass, without the app. A fix of its own,
  whatever is decided here (the frost-picture mode's fixed background doesn't have it). **Fixed 2026-11-13** (the
  owner's ask): Pre-rendered wears its picture as the frost picture does, a fixed background on a child in the layer's
  own box (`hk-glass.js` preImg); out of line is now a transformed ancestor (`lined`), and a swipe's page still has its
  picture moved back. `pre_glass_motion_check`, the page swipes and HK Frontend's glass suites pass; on the emulator's
  WebView a fixed-background child is clipped to the layer's path. On the house in the same hotfix; not yet looked at on
  a tablet in Pre-rendered.
- **Chromium's software drawing can't be trusted for baking.** `WebView.draw` into a bitmap lost canvases, let one part's
  mask spill onto the next, and drew a large photograph at a fifth of its size. The bake copies the window as the
  display shows it (PixelCopy), with a colored mark on each sheet: on the Loft, 6 of 23 copies arrived a frame late.

## Build log (2026-11-13)

**Step 1, the hand-over** (`web/hk/sky-parts/hk-sky-handover.js`, a tenth part of hk-sky, last in its PARTS): the
prototype's injected script, moved over. It starts only where `hkShell.skyPlayer()` answers and this page's wall tablet
(`hkSettings.tablet().app_sky`) says so; nothing else of it runs. New beside the prototype:
- **Busy, from the keyframes** (`busyAnim`): a part faster than 100 px a second at any point of its keyframes, a
  flipbook (`steps()` in a keyframe's easing), or a loop that carries a part down the screen more than across it (rain
  and snow decks, a falling leaf). A calm sky is never baked: read without touching anything (`busyNow`), and one the
  app plays is handed back (`stop`) once it turns calm.
- **A big change hands the sky back at once** (`hk-sky-change` with a new `sig().big`: another page's sky, the weather,
  a season) and hands it over again once it has been quiet: the app's old sky behind a new page, or the old picture on
  the glass, would be wrong meanwhile; the page drawing it for a few seconds is not. hk-sky's signature leaves the
  hand-over's own class out (`SKY_STATES`), or every hand-over read as a change.
- **The glass first**: `play` is sent only once `hkGlass.frost(true)` says the glass wears the picture.
- **The app told the setting** (`switch {on}`), so its surface is under the page from its next start.

**Step 2, the frost picture** (`hk-glass.js` FROST): Pre-rendered's machinery whatever the mode (Blur or Bright Glass,
Shared Layer or Pre-rendered), with these differences: each layer wears the picture on a child in its own box whose
background is fixed to the screen (no fixed child: the WebView's clip-path bug); the layers over the page and the pages
waiting beside it wear it too; every page wears the newest picture, which never comes off at a page change (live blur
shows nothing). **Measured on the way** (Chromium and WebKit, 2026-11-13): a fixed background under a transformed
ancestor is drawn from the element's own corner, not the screen's -- so the plan's "in line wherever the page is" holds
only at rest. Through a swipe the child becomes fixed itself and is moved back as the page moves (`frostAt`, as
Pre-rendered's picture is), and back in place after. **Sheets**: `hk-detail-frame.js` and the timeline's sheet wear
`--hk-frost-url` under their plate through a style query (`@container style(--hk-frost: 1)`), no blur, and open with
their fade alone (the opening transform would put the picture out of line). **The pinned glass** (tab bar, menu, Side
Pane) pins its slice as in a Pre-rendered look (`hkGlass.pictured`, `hk-glass-frost`). Not covered: the float plates
(`--hk-float-backdrop`: Security's header, Energy's and Calendar's floating panels) still blur live, which over the
app's sky shows it unblurred through their plate.

**Step 3**: `hkShell.skyPlayer()` in the contract (`hk-host-shell.js`: none), Home Assistant's shell (explicitly none),
Mantel's (`mantelNative.sky` on Android) and `hk-shell.d.ts` (`HkSkyPlayer`).

**Step 4, the app** (mantel-android main): `sky/SkyScene.kt`, `SkyView.kt` (30 fps by default), `NativeSky.kt` from the
branch; `Bridge.kt` always offers `mantelNative.sky`; the injected script is gone (the branch's `assets/native-sky.js`
never reaches main). The switch is the page's word (`switch`): kept in the app's store, so the surface and the
see-through window are made at the start when it was on, and dropped (window opaque again) when it goes off. Status
`sky`: off, ready or playing (shown in Mantel Settings as "Drawing the sky"). adb `SKY` gives its numbers and fps.

**Step 5, the setting**: `app_sky` on a tablet (hk_core `tablet_rules.py`, `changes.py`), off by default, stored only
when on; `sky_by_app(t)` is the decision (the switch, under Mantel for Android only), and both feeds send the decision
as `tablet_items[...].app_sky`. Mantel Settings → Wall Tablets → the tablet → Mantel for Android → **Sky Drawn by the
App** saves it like the tablet's other settings.

**Checks**: `tests/test_sky_handover.py` (the setting, both feeds, the shells' player, busy against each kind of
motion, nothing without a player); `tools/headless/app_sky_check.py` (`tools/ci.py full`: `app-sky-check`), Chromium at
1280 x 800, 820 x 1180 and 390 x 844 with a stand-in bridge: rain handed over (switch, begin, the sheets, play, shown),
the sky clipped, every layer and the tab bar on the picture with no live blur, a sheet on it, a swipe in line; a clear
day handed back; the setting off; no bridge.

**Step 6, on the Loft** (2026-11-13, evening; the app a release-signed test build of mantel-android main, 1029; the page
the worktree's build served through DevTools). The Loft's screen is now a HomeView (`loft-homeview`: Bright Glass, a
Side Pane), not the plan's `dashboard-loft`; its Home was switched to the Live Sky for the test, on this page only, and
each scene pinned (`hkSky._pin`). Awake, nobody touching, the night curtain at .94 and the backlight at its lowest (the
room dark), 30 fps; the share of one core over 12 s, totaled over the app, its WebView renderers, SurfaceFlinger and the
composer; three readings each way, the mean (range).

| Scene | The page keeps the sky | The tablet's setting on | |
|---|---|---|---|
| Halloween night (spooky, decorations, animations) | 1.55 (1.53-1.56) | 0.81 (0.69-1.01) | handed over: −48 % |
| Pouring rain | 1.46 (1.45-1.48) | 0.80 (0.62-1.07) | handed over: −45 % |
| Heavy snow | 1.45 (1.29-1.54) | 0.96 (0.77-1.15) | handed over: −34 % |
| Realistic clouds, slow | 1.52 (1.52-1.54) | 1.46 (1.32-1.54) | calm: the page keeps it |
| Nothing moving | 0.23 (0.19-0.29) | 0.24 (0.19-0.26) | calm: the page keeps it |
| A clear day | 1.37 (1.30-1.41) | 1.38 (1.27-1.43) | calm: the page keeps it |
| A moving wallpaper (Pinwheel, Fast) | 0.94 (0.89-0.99) | 0.94 (0.87-0.98) | calm: the page keeps it |

Acceptance met: on every busy scene the app beats the page, and on every calm one the page keeps the sky at the same cost.

**Found on the Loft, and built in:**
- **Something else moving on the page undoes the saving.** The Laundry block's washer was spinning (a load in its
  cycle): the page makes every frame anyway, and Android composed the app's sky with a page changing out of step with
  it -- pouring rain 2.08 handed over against 1.67 kept (SurfaceFlinger and the composer 0.86 against 0.43). The page
  now keeps its sky while anything else on it moves (`pageMoves`: a loop or a long animation outside the sky, a video),
  and looks again each minute. The table above was measured with the washer's animation held still by a style, so the
  sky's own share shows; with it spinning, the setting changes nothing.
- **A bake's copy of a window without its surface killed the app** (`PixelCopy` threw, once in a run): the copy is
  guarded now, the hand-over fails, the page keeps its sky and tries again a minute on (seen once after: no crash).
- The prototype's stored 60 fps survived on the Loft: the frame rate has a key of its own now (`sky_fps_cap`, 30).

**On the house (2026-11-13 evening, the owner's OK):** the hotfix, the app's release, Sky Drawn by the App on for the
Loft only. Step 7 (DESIGN.md) when the owner asks.

## All in (2026-11-13, late evening; the owner: "go all in, in that order")

On a tablet with Sky Drawn by the App on, **every sky is the app's** -- busy or calm, moving or still -- so such a
tablet has one mode: one sky, one glass. What led there, measured on the Loft (`loft-homeview`, washer held still,
three 12 s readings, the share of one core):

| Sky | The page draws it | The app draws it |
|---|---|---|
| Realistic clouds | 1.46 (1.33-1.55) | 0.83 (0.71-1.04) |
| A clear day | 1.40 (1.27-1.47) | 0.77 (0.66-0.99) |
| Pouring rain | 1.37 (1.28-1.47) | 0.88 (0.80-1.02) |
| A drawn wallpaper, Pinwheel, Fast | 0.97 (0.93-0.99) | 0.63 (0.46-0.90) |
| The same, Slow | 0.76 (0.75-0.78) | 0.53 (0.33-0.73) |
| Nothing moving | 0.30 (0.18-0.38) | 0.41 (0.19-0.81; 0.24 without its one spike) |

Decision 1's "calm loses" came from the prototype on `dashboard-loft`, where clouds cost the page 0.86: on the Loft's
screen now any motion costs Chromium a whole frame, and a calm sky costs the page as much as a busy one. The player
already skips a frame where nothing moved half a pixel (most of the clouds' frames), so no new drawing was needed; 10 fps
saved nothing over 30.

Built, in the owner's order:
1. **The guard** (`unplayable`): an animation of anything but `transform` and `opacity` (a custom property, `translate`,
   a color, a filter) is one the app's player can't play, and the page keeps that sky (`page keeps`).
2. **One glass** (`frostGlass`): on such a tablet the glass wears the frost picture all the time, whoever draws the sky.
3. **Every moving sky the app can play** goes to it (`movesNow`): the speed threshold is only the status's word now.
4. **Drawn wallpapers**: they move by a number (`--hk-wp`, which the app can't play) on other screens, and by their
   transform on these tablets (`ST.appSky`, `wallMotion`): the same steps, playable.
5. **Still skies** too (`STILL`): the app draws one once and asks for no frames until something changes (`SkyView`),
   and the page doesn't re-read a still sky each minute. Within ~0.1 of the page.

Still the page's: a sky the app can't play (the guard), anything else on the page moving every frame (`pageMoves`), and
every screen without the app or the setting. Fixed on the way: hk-sky writing its class list anew took the hand-over's
clip with it (the page's sky showed and moved under the app's until the next hand-over); the clip is put back at once.

**On the house** (2026-11-13, late evening): hotfix 0.1.166-main.0362c89fe, Mantel for Android 0.1.12 (1033) published and
on the Loft; installed on the Kitchen tablet beside Kiosk Satellite (still in front there until the app is paired: a
person's step), with Sky Drawn by the App set for the Kitchen too (it means nothing until its Kiosk App is the app).


## The Kitchen's tablet, a night of measuring (2026-11-14)

The slowest wall tablet in the house: an Apolosign 15.6" (Rockchip RK3576, Mali-G52, 4 GB, Android 16, WebView 140),
a 1920 x 1080 panel shown at 1280 x 720 CSS px. Measured over adb and DevTools: CPU of the app, its renderer,
SurfaceFlinger and the composer at rest; frames per page swipe from `dumpsys gfxinfo framestats`; long frames (LoAF).

| What | Before | After |
|---|---|---|
| States the page kept (the weather's air-quality look read every sensor) | 4,566 | 315 |
| Updates the page applied in 30 s | 60 | 7 |
| The page at rest, wallpaper moving (Slow), nothing else | 0.93-0.96 cores | 0.78-0.81 (stepped by a timer) |
| A page swipe, HWUI on Vulkan (the tablet's default) | median frame 90 ms, 70 % janky | -- |
| ...on OpenGL (`setprop debug.hwui.renderer skiagl`) | -- | median frame 44 ms, 20 % janky |
| Frames in a swipe, OpenGL, full resolution | 18 a second | -- |
| ...rendered at 1x (`wm size 1280x720`, `wm density 160`) | -- | 24-33 a second |
| The longest landing frames | ~415 ms | ~395 ms |

On the tablet now (not in the repository): OpenGL for HWUI (a system property: **lost at a reboot**), the 1x render
(`wm size` and `wm density`: kept through reboots; undo `wm size reset; wm density reset`), Kiosk Satellite disabled.
Sky Drawn by the App stays off there (single black frames on this GPU).

What still costs it, for later:
- **The landing** of a page swipe is 300-450 ms of the page's own work: its style worked out three times or so (each
  module reads after another has written: the swipe's measure, the Side Pane, the tab bar or the Pages grid, the
  scroll edges), about 60 ms each on this CPU, and a root custom property's change (the page's own looks) makes each a
  whole-document pass (124 ms measured). Fewer passes needs the landing's reads gathered before its writes, across
  modules -- a piece of work of its own.
- **Anything animating every frame** costs the whole screen's composite: the Laundry block's drum and heat waves (SVG,
  the page's own main thread) took the page from 0.84 cores to 2.09 while the dryer ran. Pre-rendered glass took
  about 0.9 cores off the same in one run, not repeated (no live blur under each card); a swipe was no faster.
- **OpenGL through a reboot**: Android keeps `debug.hwui.renderer` only until a restart, and no WebView flag gives
  Vulkan the same speed (WebViewVulkanIntermediateBuffer is a debugging switch). A tablet app can't set it; something
  holding adb (the app's own Wireless Debugging, paired once) could set it again after each boot.
