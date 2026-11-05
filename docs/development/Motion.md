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
position fixed, a width away, `inert`, `aria-hidden`, and off stage (`data-hk-offstage`): it says nothing as it attaches, so the
sky, the tab bar and the Side Pane don't take it for the page shown. The host feeds what it holds at a quiet moment, at
most every 1.5 s, and never with a finger down. At most two pages more are in the document; they count against nothing
the host already kept. Nothing waits in Edit mode, or where the swipe is off.

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

| What | State | Notes |
|---|---|---|
| Full-page swipe | fixed, verified | everything above |
| Tab bar highlight | fixed, verified | follows by the page's own position; reads its boxes once a swipe; a caught settle takes it back |
| Side Pane with a swipe | inspected | follows with its own short tween; unchanged |
| Page background (sky) in a swipe | fixed | `swipeTo` waits until the settle is under way, so its paint can't hold up the first frame; back again if the finger brings the page back |
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
