# Motion

How things move on Mantel's screens, why, and what has been measured. [Performance baseline](Performance-baseline.md) is a
screen at rest; this page is a screen with a finger on it.

## The rules

Things that follow a finger should feel like objects being moved.

1. **Under a finger, nothing is mounted, built or measured.** A move writes transforms. What goes with the page (the tab
   bar's highlight, the Side Pane, a ground's strength) is written once a frame, and reads nothing it can keep from the
   start of the swipe.
2. **It follows from where it began.** A gesture that waited 10 px to know what it was starts there; it doesn't jump by
   those 10 px. From then on the finger and the page differ by that constant and nothing else.
3. **It goes on at the finger's speed.** Let go, the object continues from where it is, at the speed it was going, and
   comes to rest: `hkDrag.spring` (`web/hk/modules/hk-drag.js`), a critically damped third-order spring with no pull at
   the first instant, so there is no kick in the frame after the lift. It doesn't bounce: a flick that would overshoot is
   taken up by a stiffer spring, faster rather than further. A finger going the other way carries it on a little first.
4. **The compositor runs it where it can.** A settle is a CSS transition whose curve is that spring (`linear()`, Safari 17.2
   and Chrome 113; a `cubic-bezier` that leaves at the same speed elsewhere), so a busy main thread doesn't stop it, and
   nothing heavy starts until it is under way. A scroller's `scrollLeft` can't do that: `hkDrag.glide` runs the same spring
   by `requestAnimationFrame`.
5. **One owner at a time.** A page is moved by a finger, a settle, or a build, never two. A settle ends once, by whichever
   of `transitionend` and its timer says so first, and either is ignored once something newer has it. A finger on a
   settling page catches it where it is; well on its way to a page, it has landed there and the finger holds that one.
6. **What comes in is the real thing.** The pages either side of this one are made ready at a quiet moment and wait beside
   it. A stand-in is only for what could not be ready: the first moment after a load, a host with no view host, or flicks
   through pages faster than each can be made (measured in WebKit: 12 of about 220 frames in a run of twelve flicks 170 ms
   apart). A finger on a settle heading to a stand-in, more than half the way, lets it land rather than starting it over.
7. **What it leaves is what it found.** A swipe gives back every style it set, and the page takes the next touch.

Not every animation should be a spring. What doesn't follow a finger keeps its own curve (DESIGN.md's `standard`, `spring`,
`build`, `exit`): sheets opening, the highlight landing on `spring`, a banner arriving, the media sheet's fling out.
Reduce Motion: nothing follows the finger, and two pages cross-fade.

## A full-page swipe

`web/hk/modules/hk-pageswipe.js`, with `hkViewHost.warm` / `hold` (`web/hk/shell/hk-view-host.js`).

**At rest.** A moment after each landing (`plan()`, at an idle callback, one page at a time), the host builds the page on
each side of this one, with its code and its states in as a page shown has (`willShow`, `warmed`). It is put in the slot
position fixed, laid out at the width it will have, `inert`, `aria-hidden`, and off stage (`data-hk-offstage`): it says
nothing as it attaches, so the sky, the tab bar and the Side Pane don't take it for the page shown. At rest it waits past
the window's edge (`park`), not a page's width away: beside a page narrower than the window (the Side Pane next to it)
a width away was on the screen (2026-11-05); a finger's first move brings it to the page's edge. A ResizeObserver on the
page lays it out again when the page's box changes (the Side Pane going as the Pages screen comes up), so it never
waits at a stale width. It wears its own look where the screen's differs by page (`hkSettings.lookAt`: Bright Glass on
Home Only), so it lands looking as it will stay. The host feeds what it holds at a quiet moment, at most every 1.5 s, and
never with a finger down. At most two pages more are in the document; they count against nothing the host already
kept. Nothing waits in Edit mode, or where the swipe is off.

**A finger.** A press reads the page's box and its place in the order. Moving 3 px sideways gives the page and its neighbors a
layer each (at the press itself that held every tap up by 50-90 ms in WebKit). Past 10 px at 1.4 times the vertical, the swipe begins.

**Let go.** It lands past a fifth of the width, or on a flick over 0.5 px/ms that way. A flick back goes back, however far it
had gone. Speed is the last 100 ms of moves since the finger last turned, none if it rested 60 ms before lifting.

**It lands.** The page beside it takes its place in the flow, where it already is on the screen, and the host is told; its
cards aren't moved, so they don't stop and start. The page it left stays in the slot, now the neighbor on the other side.

**A change of window.** A resize, a turn or the back button send a swipe back and end a settle now, as does a hidden
window, which draws nothing.

| What | Where | Value |
|---|---|---|
| Start | `START`, `RATIO` | 10 px, at 1.4 times the vertical |
| Lands | `TURN`, `FLICK`, `FLICK_MIN` | a fifth of the width; 0.5 px/ms past 30 px |
| Past the ends | `GIVE` | a third of the travel |
| The spring | `hk-drag.js` `OMEGA`, `V_MAX` | 0.028 / ms (a page's width within 5 px in about .33 s, and to rest in .45 s); 8 px/ms |
| Caught, already there | `ADVANCE` | more than half the way |
| Reduce Motion | `FADE_MS` | a cross-fade, .2 s |

## What was wrong (measured, 2026-11-04)

On the fictional house, against `origin/main` before the change. Chromium's finger is real touch input through CDP. WebKit's is
synthetic pointer events.

| Reproduced | Cause | Affected |
|---|---|---|
| A new finger during a settle: the page off screen (`left: -1280`), no response to touch, for 5.7 s; at every moment tried (40-330 ms) | The settle's timer and the new gesture both wrote the page and both committed; the second commit navigated to where it already was, the host said nothing, and the landing waited out `LAND_WAIT` with input refused | every swipe begun within .34 s of the last |
| Rapid flicks: every one after the first refused, orphaned stand-ins left in the slot | The same, without end | quick swiping through pages |
| A page never visited, or let go by the cache: a title on the sky, then replaced as it landed | `peek()` only offered what was held | every first swipe to a page, and any page beyond the last four |
| A tablet the slow-tablet ladder had flagged: that title for every page | `slow()` chose the stand-in even with the page held | every swipe on such a tablet |
| The release: a finger at 0.3 px/ms and the page off at 5-8 in the next frames, with a peak of 9-13 | One fixed curve whatever the finger did | every swipe |
| Flicked back from past a fifth: it went on forward, against the finger | Distance was tested before direction | reversals |
| The first move: 28-31 ms of script with 17-19 ms of forced layout at 6x CPU, and a frame gap of up to 45 ms | The neighbor mounted in `pointermove`, saying `hk-view-ready` as it attached, which redrew the tab bar and the sky under the finger | every swipe |
| Reduce Motion: the page faded to the sky, then the next faded up | Two fades in a row | that setting |
| A Home Grid's views: 300 ms of style work over a drag at 4x CPU | `--drag` on the grid restyled everything inside every block | Home Grid views |
| A hand-off from a Home Grid: a jump by the distance it waited | The page swipe began with no offset | Home Grid hand-off |

## What is measured, and how

`tools/headless/swipe_motion_check.py` is the regression check. It watches positions and state, frame by frame, and asserts no
times. It was run against the tree before the change, where it fails on content, release, interruption and rapid flicks:
[Building and testing](Building-and-Testing.md#how-a-swipe-moves-frame-by-frame).

Average FPS says nothing here, and a rest sample less. What to read instead:

| Question | Measure | Tool |
|---|---|---|
| Does it keep with the finger? | Each frame's page x against the finger: its spread | a `requestAnimationFrame` probe reading `getBoundingClientRect` |
| Does the release continue? | Speed over the first frames after the lift, against the finger's | the same |
| Is the main thread free? | Long tasks, long animation frames, `Performance.getMetrics` (layouts, style recalcs) over the gesture, at 4x and 6x CPU | CDP; Chromium only |
| Is the content there? | Elements in sight in the page coming in, and edges in a screenshot of it | the check |
| What did the frames look like? | Screencast frames, frame by frame | diagnostic only: they cost frames, so no number comes from them |

Before and after, each scenario on the same fictional house and the same machine. "Before" is `origin/main` as this change began
(dfb8555a). At 4x CPU the frame gaps are Chromium's throttling, not a tablet's.

| Measure | Chromium 1280 x 800, before | after | WebKit 1180 x 820, before | after |
|---|---|---|---|---|
| Frames with a stand-in, swipe to a page not visited | 103 of 167 | 0 of 169 | 52 of 97 | 0 of 92 |
| ...to a page let go by the cache | 89 of 154 | 0 of 156 | 44 of 89 | 0 of 87 |
| ...on a tablet the ladder flagged | 94 of 154 | 0 of 158 | 45 of 90 | 0 of 89 |
| A new finger during a settle, page blank and touches refused for | 5.7 s, at every moment tried | never | 5.7 s or until the next page | never |
| 12 rapid flicks: pages reached of 7 | 2 | 7 | 4 | 7 |
| A slow release: finger, then next frames, then peak, px/ms | 0.35, 5.4, 9.2 | 0.17, 1.1, 5.7 | 0.30, 5.8, 7.9 | 0.30, 4.0, 5.6 |
| Page against finger, spread over a drag | 0.1 px | 0.1 px | 0.1 px | 0.1 px |
| Flicked back from past a fifth | goes forward | goes back | goes forward | goes back |
| First move at 6x CPU: largest frame gap, long tasks | 38-45 ms, one each way back | 30 ms, none | not measurable | not measurable |

## The animated UI, assessed

### Full Kitchen HomeView navigation (2026-11-07)

A full, large, icons-only bar exposed a second motion after Home → Pages had already landed: the Home-only Side Pane
released its room, `hk-tabbar.js` fitted the tabs again, and the pill widened from 838 to 991 px on the fictional
1280 × 800 Kitchen screen. The selected capsule moved sideways again with that resize. The earlier three-page Kitchen
fixture never filled the available width, so its companion-motion check did not catch this.

The bar now fits against the room a Home-only pane can take on the screen, including when Pages is loaded first.
`hkSidePane.navigationRoom()` uses settings and placement without building or measuring a pane. The row still follows
the finger to the page's new center; the pill retains its size and tabs. A conditional Home-only pane also keeps that
fit while its sections are quiet. Phones and portrait bands reserve no horizontal room. Chromium 1280 × 800 and WebKit
1180 × 820 measured less than 0.01 px of pill-width change in either direction, with the selected capsule staying
landed after the route changed.

Two other selection discontinuities are covered: swipes to pages under More now follow its capsule, and a second tab
tap starts from the capsule's current drawn position. Previously a second tap could jump toward the first tap's
destination before reversing (112 px between samples in the Chromium reproduction). A selection change reads the
moving capsule once; a page swipe retains its own measured box and does no additional per-move reads.

`swipe_motion_check.py --only navigation,moreHighlight,tabTaps` checks these cases in the real browser, alongside the
existing companion, content, cancellation, interruption and rapid-swipe checks. These are geometry and continuity
checks, not proof of frame rate or feel on an actual tablet. The real-device checks below still apply.

### A page swipe's landing (2026-11-07)

Measured with a long-animation-frame probe and a CPU profile, Chromium at 4x CPU on the fictional Kitchen screen
(`ps-kitchen`, and the same with Bright Glass). The settle itself runs on the compositor; the work was in the task that
ends it (`finish` → `arrive`), where every module that heard about the landing measured the page between another's
writes: a layout of the whole document each time.

| Landing | Script in the landing task, before | after |
|---|---|---|
| Pages screen → Home | 218-222 ms (181-187 ms of it forced layout and style) | 73-77 ms |
| Home → Pages screen | 98-135 ms | 78-95 ms |
| Pages screen → Calendar | 73-82 ms | 67-83 ms |
| Pages screen → Calendar, Bright Glass (the look changes) | 122-165 ms | 82-88 ms |

What forced the layouts, and what each does now:

- `hkCards.safeArea()` read a probe's padding, the whole document's style, on every call (the tab bar's fit, the menu,
  every press of a page swipe): about 35 ms of each landing. It is read once for a window (its size, its sheets, the
  stand-in insets on `<html>`).
- The menu and the tab bar synced on every `hk-pane`, which the Side Pane and the Now Playing bar both say as a page
  lands, each reading the panel's box after the other had moved the page. Once a frame now. (The tab bar still syncs at
  once on `hk-view-ready`: deferred, a second tab tap in WebKit sometimes caught the highlight going the old way.)
- The tab bar read `--hk-content-left` through `getComputedStyle(<html>)`; the menu writes it on `<html>`'s own style,
  and it is read there.
- The Calendar measured on every `hk-pane`; the Now Playing bar placed itself on every flag change; each list's scroll
  edges were read as its rows changed. Each is once a frame now, edges read together and then marked.
- The sky asked `getAnimations()` as it painted, and forced a style flush to let a snap go: 15-20 ms each, at the
  start of a swipe toward a page with its own background and again at its landing. It asks after the frame is drawn,
  and lets the snap go two frames later.
- A look that changes only between Bright Glass and its Blur (Bright Glass on Home Only) fired `hk-module-ready`,
  which redraws every card on the page and on the two pages waiting beside it. The glass is all variables; the cards
  are not redrawn for it.

What is left is the one layout of the page that lands, moved from beside the page into its place (60-75 ms at 4x
CPU). Avoiding it would mean the page staying where it waited until a quiet moment.

The next page made ready after a landing (`plan()`, an idle callback) took about 50 ms at 4x CPU, and a finger coming
down 150, 400 or 800 ms after a landing had the page moving under it within 34-50 ms: not a stall here.

**The Side Pane's fade.** In a swipe between Home and the Pages screen the pane fades with the finger. It faded as a
whole (`opacity` on `hk-side-pane`), and an ancestor below full opacity is a backdrop root: in Chromium, the pane's blur
stopped seeing the page behind it, and the Pages screen's icons showed sharp through a flat tint for the whole drag.
The plate inside it (`.pane`, which carries the blur) fades instead. WebKit drew both the same.

**The release, together.** The tab bar's highlight and the Side Pane set off on the settle's curve before the forced
style flush that fixes the page's starting place, so their transitions began a frame ahead of the page's: in WebKit the
pane's fade led the page by 0.04-0.12 of the way through the whole release (the `companions` check's "share release
curve" failed now and then on that). They set off after the flush now, and lead by under 0.005.

| What | State | Notes |
|---|---|---|
| Full-page swipe | fixed, verified | everything above |
| Tab bar highlight | fixed, verified | follows by the page's own position; reads its boxes once a swipe; a caught settle takes it back |
| Side Pane with a swipe | inspected | follows with its own short tween; unchanged |
| Page background (sky) in a swipe | fixed | follows the finger since 2026-11-05 (`skyFade`, painted two frames after the swipe heads for a page, so its paint can't hold up the first frame); the rest of the way on the settle's own curve; back again if the finger brings the page back |
| Home Grid views | fixed, verified | the spring, a view caught mid-slide, `--drag` no longer restyles what is inside the cells (300 to 47-79 ms of style work over a drag at 4x CPU) |
| Home Grid hand-off to pages | fixed, verified | no jump |
| Pager blocks | fixed, verified | one measure a drag; `hkDrag.glide` from the finger's speed; flicked back goes back; a finger stops a glide |
| Side menu's edge swipe | fixed, verified in Chromium | the spring for that one move; WebKit's edge is a mouse in the checks |
| Sideways rows, sliders, the thermostat's ring | inspected | the browser's own pan, or their own control; still exempt (`hkDrag.sideways`) |
| Bar's More, detail sheets, pop-ups | inspected, measured | CSS on `standard`, no gesture; frames unchanged. A 90-120 ms task at 4x CPU when a sheet closes, after it has gone: not addressed |
| Media expansion, Side Pane's panel | inspected | Web Animations on `standard` and `exit`, kept per DESIGN.md |
| Media sheet's swipe to dismiss | inspected | its fling out is DESIGN.md's, kept; not given the spring |
| Notifications' swipe | inspected | not measured |
| Drag and drop (Edit mode, grid editor) | inspected | `hkDrag.press`; no reads per move; its own checks pass |
| Sky and wallpaper animation | inspected | CSS on the compositor; off under Reduce Motion, asleep and hidden. At rest with a page waiting beside Home: 77-91 ms of main thread over 12 s, against 77 (its cards' own timers) |
| `hk-fps.js` | inspected | still samples only at rest, as it should; it no longer decides whether a tablet sees its pages |

### The glass under a moving page (2026-11-08)

The owner, after all of the above: swiping "still feels horrible on the tablets". The checks had passed; 20 of 83 local
runs had failed only on timing noise. They slow the CPU, and a wall tablet's trouble was its GPU, which a slowed CPU never
shows (Chromium's CPU throttling slows the page's main thread, not the compositor or the GPU process).

The house: four of the five wall tablets wear Bright Glass in Pre-rendered mode (the Kitchen Shared Layer), on a Home
Grid at 1280 x 800, device pixel ratio 1.5 to 2, a wallpaper sky. Rebuilt in the lab from the house's own screen settings
(the devices fictional), with Chromium's compositor drawing in software, a stand-in for a weak GPU whose cost is the
pixels it blends and blurs:

| Living Room HomeView, ms to draw a frame | at rest | dragging | settling | the page it landed on |
|---|---|---|---|---|
| Pre-rendered, before | 11 | 25.5 | 33 | 24 (Weather), 19 (Home, swiped back) |
| Pre-rendered, after | 11.8 | 12.2 | 21.7 | 6.4 (Weather), 8.1 (Home) |
| Shared Layer, for comparison | 23.4 | 29.7 | 35 | 23.4 |
| Clear (no blur on the cards) | 13 | 14 | 20.7 | 4.8 |

Two causes, both in `web/hk/modules/hk-glass.js`:

- **A page moved by a swipe went back to live blur.** The picture is fixed to the screen; a transformed page is the box its
  fixed children sit in, so the picture moved with the page, was out of line, and every layer on both pages blurred
  live until the landing: the lightest mode was the heaviest for exactly the moments a finger was on it.
  `hkGlass.along` now hears where each page in the slot is (`hk-pageswipe.js` `glassAlong`, from `setX` and `restore`:
  its x, its box's corner, its transition) and moves each picture back by as much, on the same transition: measured
  frame by frame, the picture is 0 px off the screen's corner in Chromium in every moving frame (one frame 3.6 px in
  WebKit, at a settle's start). A page waiting beside this one wears its own picture (the filter is painted into it:
  Home's Bright Glass, Blur beside it), the one painted when it was last shown; a page never shown yet blurs live until it
  has been. A layer in something scaled inside the page (a pager's track) can't line up, and blurs live as before.
- **A page reached by a swipe blurred live for as long as it was up.** Its layers were made while it waited, fixed to the
  screen by the swipe, and were taken for a sheet's (`overContent`): Weather after a swipe wore a 1253 x 1218 live blur,
  loaded directly its picture. A page of the screen is never "over content" now.

The settle's sky cross-fade adds about 6 ms a frame in the same measure; the Side Pane's and the tab bar's following add
under 1. Not changed.

**The tablets measure their own swipes now.** `hkDrag.motion` counts each swipe's frames (a page, Home Grid's views, a
block's pages) from its start to the frame after it lands, by `requestAnimationFrame`, which runs at the pace the screen
is drawn; a frame over 25 ms after the last missed a refresh. Mantel's page sends what was counted once a minute
(`web/shim/page-health.js`, a `motion` frame) and the log says, per tablet:

    page health: tablet 'Living Room' swiped 3 times (2 page, 1 block): 42.9 frames a second while moving, 33% of frames
    late, 95% within 60 ms, the worst 180 ms; bright_pre on living-room-homeview

Read those, not a check on a Mac, for how a swipe feels on a tablet.

### Quick flicks (2026-11-08)

The owner, after the glass change: "Sometimes pages swipe, sometimes they don't. At times they bounce back and don't
move at all ... especially on fast swipes ... it doesn't feel natural. Fast swipes are common here since a user may fast
swipe to the page they want." Every check so far had been a slow drag. A new bench fires real-touch flicks back to back
on the device's own clock (not awaited, so a busy page gets coalesced moves as a tablet does): 90 ms, 220 px, speeding up
to the lift, 4 forward and 4 back, on the Living Room HomeView rebuilt in the lab.

| Flicks this far apart (lift to next touch), 4x CPU | before: pages reached of 8 | after |
|---|---|---|
| 400 ms | 7, one refused | 8 |
| 250 ms | 6, one refused | 8 |
| 150 ms | 6 (1 of 4 forward at 6x CPU) | 8 (8 at 6x) |
| 120 ms | 2 (home, weather, home) | 8 |
| 500 ms, short flicks of 70-100 px | 3 of 4, one refused | 4 of 4 |

What lost them, each found in the bench's per-flick record (the swipe's own `why`, its state, long animation frames):

- **The page beyond wasn't there.** The page on each side is made at a quiet moment (`plan`), and `makeReady` would not
  put a page in while a finger or a settle was on, so in a run of flicks the next page was always the title stand-in.
  A flick to it landed there (`commit`) and refused every touch while the page was built: "sometimes they don't swipe".
  Now a settle toward a page asks the host for the page after it as soon as the settle is under way (`ahead`, the
  compositor moving the page), a landing asks for the far side's page at once, and a page made while a finger drags
  takes its stand-in's place.
- **A caught settle under half way lost the flick.** A finger on a settle that had not reached half way held the old
  page, and the flick only finished the first one's page: two flicks, one page. A settle on its way to a ready page has
  now landed there when it is caught, however far it had got (`catchIt`, `chain`), and a flick on the way it was going goes
  a page further; every page then moves together (`run`, `pass`), so none passes another. A finger on a settle toward a
  stand-in holds it rather than landing on it and refusing the finger.
- **A catch did its work under the finger.** The tab bar's and the Side Pane's first follow ran inside the press (30-60 ms
  at 4x CPU, with a sky render); they wait for the next frame now, as every other move's do. The landing itself still runs
  in the press (`arrive`: the host told, the Side Pane, a layout; ~40 ms at 4x), so a catch's page moves 60-130 ms after the
  finger at 4-6x CPU, against 20-60 for a fresh flick: what is left to take on.
- **A third of Home refused every swipe.** A swipe that began on the Side Pane was "off the page". It is the page's now
  (its own sideways things keep theirs).

The bench is `.ci/motion-evidence/flick-2026-11-08` (flick.cjs: pages reached, refusals and their `why`, the first move
after each touch, long frames; overlap.cjs: no page passes another, frame by frame).

### The wrong picture at the edges of a swipe (2026-11-08)

After the release the owner saw "pop in from the previous screen's blur behind the cards" (Bright Glass, Pre-rendered).
Probed frame by frame (which picture each page's layers wear; the lab's Living Room HomeView, Bright Pre-rendered,
4x CPU, slow drags and flicks, Chromium and WebKit), two causes:

| When | What it wore | Why | Now |
|---|---|---|---|
| The drag begins | the page being left: the next page's sky (0.2/255 off Weather's, 5 off Home's), remembered as its own | the swipe paints the next page's sky under a still copy (hk-sky.js swipeCover), hk-sky-change said so, and preTick painted it as this page's | preTick waits while `hkSky.swipingTo()` names a page |
| It lands | Weather: Home's picture for 66 ms, then its own | `arrive` puts the page back (along null) before the address and the sky change, so "the page's picture" was still Home's | along(el, null) keeps the picture of the page it was moved as |

After: Home wears its own picture until it is gone, Weather its remembered one until its fresh one fades in. (The lab's
landprobe.cjs is in .ci/motion-evidence/flick-2026-11-08.)

### A Pre-rendered repaint's cost (2026-11-08)

On a page with a live sky (the house's room pages: Weather's realistic clouds) the picture is painted again every
PRE_TRACK (2 s) and fades in over that time: the blur follows the clouds, by design. So a repaint's cost is paid all the
time. Measured in the lab (Living Room HomeView, Weather, 1280x800, CPU 4x; WebKit unthrottled), median of 8:

| Part | Chromium 4x | WebKit |
|---|---|---|
| The sky drawn (collect + paint) | ~27 ms | ~1 ms |
| The look's filter, as a PNG in an SVG decoded back | ~30 ms | ~10 ms |
| The picture's own PNG (toBlob) / its decode | 7.7 / 3.2 ms | 1 / 3 ms |

What changed: a canvas that takes a `filter` (Chrome, the wall tablets) is given the look's filter itself -- no PNG, no
SVG. A whole repaint: Bright 35 -> 26 ms, Blur 53 -> 36 ms. The two routes agree to a mean 0.5/255, at most 2/255
(animations paused, same frame). WebKit has no canvas filter and keeps the SVG. And a cloud-following repaint waits
1.5 s after the last touch (was 0.7 s, a gap between quick flicks).

The picture's format, measured (4x CPU; pixels against the canvas it came from):

| Format | Chromium: KB, encode | Pixels off (mean / max of 255) |
|---|---|---|
| PNG | 30 KB, 10.3 ms | 0 / 0 |
| WebP lossless (quality 1) | 17 KB, 3.3 ms | 0 / 0 |
| WebP 95 / 90 | 2-3 KB, ~3.5 ms | 0.8-1.2 / 5-11 |
| JPEG 98 / 95 | 4-7 KB, ~3 ms | 0.6-0.8 / 4-6 |

So it is lossless WebP: the same picture, less time. WebKit writes no WebP and gives a PNG (its encode holds the main
thread ~0 ms). The lossy ones shift the color: left.

The cards already share their pictures: one per glass layer (a row or grid), its cards cut out of it. Living Room's
Home: 82 cards, 47 shapes, 7 pictures; the other rooms' pages 1-3 pictures, 0.1-0.8 MB in all. One per page would need
the pictures as CSS backgrounds again, whose tiles the browser drops (the flash preImg was made to end).

Looked at and left: the layers drawing from the painted canvas, skipping the picture's decode (~3 ms, mostly off the main
thread, and WebKit draws an undecoded background -- the pinned glass -- as nothing for a frame);
painting a page's picture before its first visit (its sky would have to be drawn where it shows, or in a swipe, where
the paint costs the drag a frame; a page has one once seen, and a tablet keeps the last 12).

### The owner's video: flicker and the Pages screen's jump (2026-11-08)

A 29 s phone video of the Living Room tablet on 0.1.153 (Bright Glass, Pre-rendered), walked frame by frame (60 fps),
and a scan of every frame for a sudden change: the glass flickering as pages land, and the Pages screen from Home blurred
(at landing), then its icons small and to the left, then in their places. Reproduced in the lab with a screencast of
each swipe (every composited frame, 4x CPU), a frame-difference scan after each settle, and the pictures each layer
wears:

| What | Why | Now |
|---|---|---|
| Calendar's cards in Weather's purple for 2 frames, ~250 ms after the swipe settled | the address changes 50-70 ms before the sky (more on a tablet); a layer looked at in between (preCheck) asked for "the picture the sky is at", the page it left | a page landed on keeps its own picture (or blurs live) until the sky reaches it (hk-glass.js landedAt; wearAll and viewShown leave it too) |
| The Pages screen landing blurred, every icon (Pages screen -> Home -> Pages screen) | the swipe's still ground (a blur of the sky, hk-pageswipe.js ground) went in just before the page being left; the Pages screen, kept from before Home was shown, came before Home in the slot, so the blur was over it -- at full strength as it landed | the ground goes in before the first page in the slot |
| The Pages screen's icons drawn 880 px wide for a second | Home's Side Pane room (400 px) left on the view for a frame (hk-menu.js syncs on the next frame); a push in that frame drew the screen in it, and a box that only lived between frames never fires a ResizeObserver | the view's margins written at once on hk-pane (style writes, no read); the screen looks at its size the frame after every draw |

After: a frame-difference scan of each swipe (Pages screen, Weather, Calendar, Cameras, Energy, Power, Security,
Climate, each to the next) shows the settle and nothing after it; Home to the Pages screen drew small in 3 of 6 runs
before, 0 of 6 after. Seen and left: one camera tile black for a moment on Cameras (its stream), a cold page's first
swipe stalling a third of the way while it is built (Pages screen to Weather), and on Power the house picture gone for
~50 ms after landing on the tablet (not reproduced in the lab).

### A row that scrolls sideways, at its end (2026-11-08)

The owner: on the Music page "the discovery section doesn't allow the page switch". Mapped point by point (which part
of the page hkDrag.sideways gives the swipe to): everything right of the player was its rows', which keep every
sideways pan -- the browser took the gesture (pointercancel) even at a row's end, with nothing to scroll. Measured in
Chromium: a touch-action of `pan-y pan-right` set before the finger comes down lets a rightward drag through as
pointer events; set in the pointerdown, too late.

Now a row that scrolls (hkCards.fitPan -> hkDrag.panRow, which Music's rows, a room's, the weather's hours and the speakers' strips
already use) pans only the way it still can at an end -- `pan-right` at its start, `pan-left` at its end, both in
between -- kept as it scrolls; the page swipe takes a row only so marked (hkDrag.sidewaysRow) and only a drag the row
cannot make (rowTakes, at the first move). On the Music page: at a row's start a swipe right goes back a page and left
scrolls the row; at its end left goes on and right scrolls back; in the middle the row scrolls. WebKit has no
pan-left / pan-right (CSS.supports says so: hkDrag.EDGE_PAN): there a row keeps every pan, as before.

## What a browser here cannot say

Headless Chromium and desktop WebKit on a fast Mac approximate a tablet; slowing the CPU approximates it further. None of
them is an iPad.

- **WebKit's first frame.** Desktop WebKit shows a gap of 76-170 ms in its first frame of a swipe, on both sides of this change.
  It isn't script (the moves take under 1 ms) and most of it goes if the neighbors are hidden: it is the neighbor's first paint
  as it comes into view, because a layer off screen has no backing store. Headless WebKit here paints in software, so this is
  an upper bound of unknown size. To keep it from happening at all would take the neighbors on screen and composited all
  the time, at a memory cost the wall tablets don't have.
- **WebKit's touch.** Its finger in these checks is synthetic: no touch-action, no browser pan, no real hit testing or
  coalescing. Chromium's is real. What Safari does with `touch-action: pan-y` at the start of a real swipe is only known on an iPad.
- **Memory.** The tile memory two more pages take in a swipe, and two more in the document at rest, isn't measured here. The
  pages have no layer of their own at rest. With the finger held mid-drag, Chromium at 4x spends 0.8 ms of style and 0.9 ms
  of layerizing a frame, against 0.4 and 0.6 before: the page on each side is drawn and moved, not one. The largest task
  was 8.8 ms, against 15.2.
- **How it feels.** `OMEGA` is a number chosen to match DESIGN.md's .34 s, and to keep a slow release from a kick. Its feel
  is for a person to judge.

### On a real tablet

Each of these, on an iPad in Safari and on the slowest wall tablet:

1. Right after a load, wait three seconds, then drag slowly to a page you haven't visited: the whole page is there as it comes in.
2. Drag slowly and let go past a fifth: it leaves at about your finger's speed, with no kick and no pause at the lift.
3. Flick quickly through every page and back, without waiting: each flick is taken, and it ends on the right page, showing it.
4. Mid-settle, put a finger on the moving page: it stops under your finger and you can drag it on or back.
5. Drag past a fifth, then flick back: it goes back.
6. Drag up and down on a long page: it still scrolls; the scroll is never taken for a swipe.
7. From the left edge in Safari: the browser's back gesture or the side menu, not a page swipe.
8. Swipe a few dozen times in Blur: no blank tiles on what comes in, and no reload from memory pressure.
9. On Home Grid with views, swipe across its views and on past the last; a room block turns its own pages.
10. With Reduce Motion on: nothing moves with the finger, and the two pages cross-fade.
