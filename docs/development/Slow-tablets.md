# Building for slow tablets

What to know before building a card, a page, an animation, a glass surface or a server overlay, so it is right on the
slowest wall tablet the first time. Everything here was measured on real tablets in November 2026 (an Android wall
tablet with a mid-range chip, and a car's browser); each line names where its record is. [Rule 13](Rules.md) is the
part tests enforce; [Motion](Motion.md) is how things move under a finger; this page is the rest, as a checklist.

The short version: **a slow tablet pays for every frame, every state and every layer.** Draw fewer frames, read fewer
states, keep fewer layers, and never make the page wait.

## Before you build

| You are adding | Read |
|---|---|
| a card or a block | "What a card reads", "Anything that moves", "A card beside the screen" |
| something that animates or loops | "Anything that moves" |
| a surface with glass behind it | "Glass" |
| something that goes with a page (a pane, a bar, a ground) | "Every way to a page" |
| a listener on a swipe, a landing or a resize | "A landing is one layout" |
| a server overlay or a cache over the house's states | "The server's side" |
| a setting that trades looks for speed | "A switch of its own" |

## What a card reads

[Rule 13](Rules.md) in one line: a card reads its states when it is told, and never walks the house.

- **A screen keeps only what its cards read.** One room tile that sorted the whole house made a tablet keep 4,602
  entities and take every update of each; fixed, it keeps 288 (`docs/phase29/PLAN.md`, "the day after"). To check a
  screen: `window.__mantelNarrow` in its page is how many states it keeps.
- **A look across the house that is no screen's need** runs in `hkShell.unrecorded(fn)`; one that needs every state asks
  `hkShell.wholeHouse()` first.
- **Nothing widens the feed and leaves it wide.** A navigation, an idle return or a sheet that asks for more gives it
  back when it is done.
- **A shipped file is asked for under the build's id** (`hkV(url)`), never `no-cache`: a picture asked for again at
  every showing is a network wait on the page.

## Anything that moves

- **A frame costs the same whatever moves.** On the slowest tablet a 20 px dot moved by the compositor cost as much
  processor as a full animation: about 85 ms of CPU for each frame drawn. Moving work to the GPU does not help; only
  fewer frames do. A CSS animation with `steps()` at 30 fps saves nothing either, because the browser makes 60 frames
  while any animation runs. A timer that steps a drawing 4 times a second costs a quarter of one that steps 10.
- **So nothing loops at rest unless it says something.** A spinner, a pulse, a drawing that turns: it runs while the
  thing it shows is happening, and stops when its card is off the screen.
- **Two switches decide whether it may run, and a card obeys both.** *Motion* (Appearance) is the page's own movement:
  `hkSettings.rendering().motion`, and a card's CSS gets it through `hkCards.flatCss` (the `hk-still` attribute holds
  animations, transitions and press scales). *Animations* (Background) is the sky's and a drawing's loop:
  `hkSettings.skyLook().animations`, read as the base card's `stillNow()`. Flat decides neither: `hk-flat` is no blur,
  no filter, no text shadow, and nothing else.
- **A moving layer under full-screen layers makes each of them a layer.** A wallpaper moved by a transform turned the
  grain, the scrim and the page into three full-screen layers (183 MB of tiles against 74), and a car's browser ran out
  of GPU memory and left cards undrawn. Draw the movement into the layer that is already there (a registered custom
  property), not onto a layer of its own.

## Glass

- **A glass surface is `hk-glass`'s**, not a `backdrop-filter` of its own. The shared layer is what Pre-rendered
  replaces with a picture; a blur written by hand stays live on the tablets that chose Pre-rendered because they
  cannot afford it.
- **A transform above a glass layer puts it out of line**, and an out-of-line layer blurs live in Pre-rendered. A Home
  Grid's fit scale did that to every paged block (6 of 7 layers live on a test screen). If a container must be
  transformed at rest, it says so the way the grid does (`__hkFit`) and `hk-glass.js` `lined()` knows it.
  `hkGlass.stats()` in a page says how many layers wear the picture and how many are live.
- **Never `will-change` on a glass layer** (rule 13), and nothing `position: fixed` inside a page.

## A landing is one layout

The hitch people feel in a swipe is the task that ends it, not the drag ([Motion](Motion.md), "One layout a landing").

- **A listener that measures answers once a frame** (`requestAnimationFrame`), and reads before it writes. Four modules
  each reading layout between another's writes made one landing 220 ms of script (at 4x CPU).
- **Nothing is written on the root at a landing.** An attribute, a class or a style on `<html>` or `<body>` restyles
  every element (about 60 ms a pass on the slowest tablet). Write it on the nearest element that needs it, and never
  read the root's computed style for a value someone writes inline there.
- **Blocking touches is not free.** `pointer-events: none` on a page was a layout of its own, `inert` 12 ms;
  `hk-pageswipe.js` `untouched()` says when neither is set.
- **Under a finger nothing is mounted, built or measured** (Motion's rule 1), and the hub's updates are held until the
  finger lifts.

## A card beside the screen

The pages either side of the one shown stay attached, off the stage (`data-hk-offstage`, inert). So "connected" is not
"on the screen". A card with an effect outside itself when it connects (a pop-up, a sound, a timer, a full-screen
layer) listens for the stage (`hk-swipe-left`, `hk-swipe-landed`) or checks `data-hk-offstage`, as `hk-popup.js` does.

## Every way to a page

A page is reached by a swipe, a tab tap, Back, the idle return under the screensaver, and a cross-fade (Motion off, or
Reduce Motion). What goes with a page must be right after each. The Side Pane rode a swipe correctly and was lost on
the other four, and every swipe check passed with the bug in. A check for anything that follows a page has a case for
each way (`tools/headless/side_pane_check.cjs` is the model).

## The server's side

- **Never key a cache or an overlay on how many states there are** (`len(states)`). While Home Assistant starts, that
  number changes with every batch: one overlay's full scan per batch stalled the event loop for minutes, the health
  check failed and every tablet stopped loading. React to a registry load, a settings change, or the ids in the batch.
- **A batch handler reads the batch's ids**, not every state. `tests/test_laundry_done.py` has the guard
  (`test_no_overlay_looks_at_every_state_per_batch_while_home_assistant_starts`).

## A switch of its own

A setting that trades looks for speed is its own switch, not a side effect of a look: Motion is separate from Flat,
and separate from the Background's Animations, by the owner's decision (2026-11-14). The policy is read in one place
(`hkSettings.rendering()`: `flat`, `blur`, `liveSky`, `motion`); a card never works it out from the look's name. Where
two switches touch the same thing, the footer of each names the other.

## Measuring, and what fooled us

- **On the tablet, with real touches, before and after** (rule 13; [Motion](Motion.md), "On a real tablet"). A script's
  `navigate()` hides what a tap shows.
- **Know which page is showing before a tap, and after.** The tab bar moves when a Side Pane is beside it, so the same
  point is a different tab on a different page; a whole comparison was read wrong that way. Read the page from the
  screen first.
- **Keep the screensaver away** while measuring at idle, and at night mind the curtain: an opaque curtain makes the
  browser skip everything under it, so the numbers are of nothing.
- **A landing is measured as script time in its long animation frame**, at 4x CPU, not as frames per second.
- **A screenshot repaints fresh.** Flicker and a wrong picture mid-swipe show only in real frames (a recording, or
  `media_card_check.py --pixels`).
- **An app with no DevTools can still be timed:** Android's pointer bar and `screenrecord`, read frame by frame.
- **One number at the edge is noise.** Three runs each, old against new.

## Where the records are

`docs/phase29/PLAN.md` (the tablet app's sky, the feed, a swipe's layers, the landing's suspects), [Motion](Motion.md)
(swipes, landings, glass under a moving page), [Performance baseline](Performance-baseline.md) (a screen at rest).
