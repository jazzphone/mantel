# Phase 29: The sky drawn by the tablet app (plan, 2026-11-12)

**Status: plan. Decisions 1, 2 and 4 answered (2026-11-12); 3, the glass, gates the phase (step 0: its first run below).** The prototype is on mantel-android's `native-sky`
branch (`docs/NATIVE-SKY.md` there), installed on the Loft and switched off.

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
3. **The glass over it.** **Open, and the gate for the whole phase.** The owner's Pre-rendered bugs (2026-11-12):
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
   the sky on screen, not the address). Sheets too: their panels blur live behind themselves, so
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
  whatever is decided here (the frost-picture mode's fixed background doesn't have it).
- **Chromium's software drawing can't be trusted for baking.** `WebView.draw` into a bitmap lost canvases, let one part's
  mask spill onto the next, and drew a large photograph at a fifth of its size. The bake copies the window as the
  display shows it (PixelCopy), with a colored mark on each sheet: on the Loft, 6 of 23 copies arrived a frame late.
