# Phase 2 P2.2: HK's cards draw with HK's own elements (2026-10-18)

Roadmap row P2.2 (`docs/phase2/ROADMAP.md`). P2.1 added `hk-icon`, `hk-plate` and the hosts'
`hk-state-icon`; nothing used them. Now every HK card, module and panel draws with them: shared
code no longer makes or styles Home Assistant's `ha-icon`, `ha-card` or `ha-state-icon`.

## What was converted

Every HK-owned use under `web/hk/` and `web/cards/` (shared code; `web/shim/` is Mantel's
adapter): markup the cards build, `document.createElement`, the settings kit's `h('ha-icon', …)`,
CSS selectors in the cards' own styles, and lookups of the cards' own plates and icons
(`querySelector('ha-card')`, `localName === 'ha-card'` in `hk-tap.js`). The conversion ran on
code only (comments stripped with the same scanner as `tests/test_shell_boundary.py`); comments
were then read and updated by hand where they describe HK's own element.

| Element | Code refs before | Code refs after | Replaced by | Files |
|---|---|---|---|---|
| `ha-icon` | 310 | 1 (listed below) | `hk-icon` (311) | 26 |
| `ha-card` | 257 | 2 (listed below) | `hk-plate` (258) | 17 |
| `ha-state-icon` | 19 | 0 | `hk-state-icon` (19), bound with `client.bindStateIcon` as before | 6 |

(Comments still name HA's elements 15 / 10 / 2 times: HA's own behaviour, e.g. `hk-icons.js`'s
repair of HA's `ha-icon`, `hk-frame` styling a native HA card.) `web/cards/hk-metric.js` (shared,
outside `web/hk`) is included: it made `ha-card` and `ha-state-icon` too.

## Making it look the same: the elements were brought to HA's exact structure

A rename alone would have moved glyphs. HK's CSS was tuned against HA's elements' quirks (the
comments in `hk-base.js` (the well), `hk-tile.js`, `hk-chip.js` and `hk-media.js` (the 5 px vOffset)
are measurements of them), so the elements now reproduce HA's boxes, not just its look:

- **`hk-icon`** (`web/hk/elements/hk-elements.js`) is now HA's two boxes: the host is `ha-icon`'s
  (`:host{fill:currentcolor}`, so INLINE, which is what the cards' `width`/`height`/`display`
  rules were written against) and an inner `.i` with `ha-svg-icon`'s `:host` rules verbatim
  (`display:var(--ha-icon-display,inline-flex)`, `vertical-align:middle`, `--mdc-icon-size`
  square, `--icon-primary-color`, the second path at HA's `.5` opacity, not P2.1's `.4`). Nothing
  is drawn until a name is set, as `ha-icon` renders nothing without one. Read from the served
  frontend 2026.9 (`hass_frontend` in the scratch HA's venv).
- **Late iconsets.** HA's `ha-icon` caches a miss when the `hk:` set is not registered yet (the
  reason for `hk-icons.js`'s repair shim). `hk-icon` keeps the icons it could not resolve because
  their set (or `hkIcons`, the MDI reader) was not registered, and draws them again when
  `hk-icons.js` calls `hkElements.iconsetAdded()` right after registering. In the HA build the
  iconset is imported after the ordered boot's core, so this race is real; no `hk-icon` was blank
  in the scratch HA.
- **HA's `hk-state-icon`** (`hosts/ha/frontend/hk-ha-elements.js`) is now a transparent box: no
  `:host` size, and the `ha-state-icon` inside is `display:contents`, so the cards' CSS that used
  to land on `ha-state-icon` lands on the host exactly as before and HA's `ha-icon` inside lays out
  as it did. (P2.1's version was an inline-flex 24 px box with a 100 % child.)
- **`hk-plate`** was already `ha-card`'s rules (frontend 2026.9); unchanged.

## Deliberately left pointing at Home Assistant's elements

Each is a lookup that must also find HA's own card or icon on an HK page; they are listed, with
their reason, in `HA_ELEMENT_LOOKUPS` in `tests/test_shell_boundary.py`:

| Where | Code | Why |
|---|---|---|
| `web/hk/cards/hk-row.js` `plateOf` | `querySelector('hk-plate, ha-card')` | a row's lead is the first showing plate, which may be HA's card (a chip inside HA's conditional card) |
| `web/hk/cards/hk-layout.js` `plateLike` | `el.localName === 'hk-plate' \|\| el.localName === 'ha-card'` | the page-edge measure walks the plates under a node: HK cards' and native HA cards' |
| `web/hk/iconset/hk-icons.js` repair shim | `el.localName === "ha-icon"` | repairs HA's `ha-icon` after a lost iconset race; other cards on an HK page (HA's tile card with an `hk:` icon) still use it |

Also untouched: `hk-camera-live-card` wraps HA's `hui-picture-entity-card` in HA (its `ha-card` is HA's
and is styled through the `--ha-card-*` variables only; without Lovelace the same config is drawn by
HK's own `hk-picture-entity`, `docs/phase2/VIEW-HOST.md`; the same file's `hk-view-markdown` and four
`hk-energy-*` elements stand in for Lovelace's `markdown` and energy cards), the foreign-card detection in
`hk-base.js` (`place()`/`tone()` use `hkShell.foreignTags`, no element names), `web/hk/css/`
(only comments named `ha-card`), the Lovelace card editors (`ha-form`, HA-only), and Mantel's
stand-ins in `web/shim/ha-elements.js` (the adapter).

## The boundary test

`tests/test_shell_boundary.py`:

- `test_shared_code_makes_no_ha_icon_or_card`: no markup (`<ha-…`), `createElement('ha-…')` or
  `h('ha-…')` of `ha-icon`, `ha-card`, `ha-state-icon` or `ha-svg-icon` anywhere in `web/` outside
  `web/shim/` (JS, HTML, CSS; comments ignored).
- `test_ha_element_names_are_only_the_listed_lookups`: any remaining name must sit on a line
  containing one of the listed lookups, and every listed lookup must still exist (a stale
  allowance cannot let a new use in).
- `test_element_lint_catches_the_names_and_ignores_comments`: the lint itself. Run against the
  base commit, the first test fails at once (`web/cards/hk-metric.js`'s `<ha-card`).

`tools/testha/check.py` clicks the menu button's plate as `hk-plate, ha-card`.

## Tests updated (behaviour kept, names changed)

`test_elements.js` (+10: HA's icon boxes and rules, nothing drawn without a name, a late iconset
drawn by `iconsetAdded()` and then forgotten, HA's transparent `hk-state-icon`), and the suites
that asserted the old names: `test_flatcolors`, `test_headers`, `test_keypad`, `test_keyspacer`,
`test_mediatile`, `test_pillsize`, `test_player2`, `test_settingsforms` (the kit now names no HA
element at all), `test_surfaces`, `test_timerstrip`, `test_weather`, `test_wxcards`, `test_art`,
`test_glass_behaviour` (fake plates are `HK-PLATE`), `test_menutab` (comment). The CSS snapshot
fixture was regenerated; mapping `hk-icon/hk-plate/hk-state-icon` back to the HA names reproduces
the old fixture byte for byte, so the CSS changed in nothing but the tag names.

## Before/after in the scratch HA

`tools/testha/` (127.0.0.1:8124, HA's `demo` devices only). BEFORE: the base commit `8a9199b`
(a `git archive` built through `TESTHA_REPO`); AFTER: this branch. Same config, a headless Chrome
at 1280x900 (menu 820x900, phone 430x932), dark scheme, `prefers-reduced-motion` (a still sky), the
page clock frozen at 2026-10-18 14:30 EDT at each load, and the demo cameras' pictures hidden in
both (they cycle). Screenshots and diff images stay in the session scratch dir
(`p22/shots/`, not committed).

"Differ" is the share of pixels with any channel different; "max" the largest channel difference
(0-255). "Same build" is the BEFORE build against itself across two HA starts: the noise floor.
"Geometry" compares the rectangle of every icon (and its drawn `<svg>`), state icon and plate on the
page, HA's and HK's names folded together.

| Page | Before → after: differ % | max | Same build, two starts: differ % | max | Geometry (icons / state icons / plates) |
|---|---|---|---|---|---|
| `/hk-scratch` home (menu open) | 0.001 | 1 | 0.002 | 1 | 27 / 16 / 25 identical |
| Lights | 0.000 | 0 | 0.138 | 204 | 29 / 5 / 13 identical |
| Weather | 0.001 | 1 | 0.003 | 1 | 49 / 0 / 10 identical |
| Cameras | 0.000 | 0 | 0.000 | 0 | 26 / 0 / 8 identical |
| Detail sheet (Kitchen Lights) | 0.000 | 0 | 0.662 | 2 | 32 / 6 / 13 identical |
| `/hk-wall` | 0.767 | 1 | 3.532 | 3 | 21 / 16 / 25 identical |
| Side menu open (`/hk-phone`, 820 px) | 0.154 | 1 | 0.384 | 1 | 29 / 16 / 26 identical |
| `/hk-phone` tab bar (430 px) | 0.297 | 1 | 1.130 | 2 | 28 / 16 / 25 identical |
| HK Settings | 0.000 | 0 | 0.000 | 0 | 42 / 0 / 0 identical |
| Climate | 0.000 | 0 | 0.104 | 240 | 34 / 3 / 10 identical |
| Security | 0.000 | 0 | 0.000 | 0 | 37 / 5 / 11; one nameless icon is 0x0 in both (HA's draws no svg, HK's a hidden one) |
| Energy, Doors, Timers, Play Music, Browse Music, a room (the demo has none of these: Home) | 0.001 | 1 | 0.003 | 1 | 27 / 16 / 25 identical |

Reading it:

- **No real change.** Every icon, state icon and plate on every page sits at the same rectangle to
  0.01 px, and the drawn glyph boxes too. The before/after differences are at most 1/255 in one
  channel, all inside the frosted (backdrop-filtered) menu, tab bar and the menu panel's 1 px
  edge, which differ more than that between two starts of the SAME build (up to 3/255 over 3.5 %
  of the wall page): the blurred sky under the glass, not the cards.
- **Lights and Climate** in the same-build column: the "Lighting Through the Day" minutes and the
  climate runtime come from HA's history since it started, against the frozen clock, so they read
  differently when HA started at a different minute. The final before/after pair was taken a few
  minutes apart and shows 0. (A first after run, taken later, showed the same 0.1 % there and the
  same ≤3/255 glass noise, nothing else.)
- A same-build pair taken from one HA start is pixel-identical on every page (0.000 %), so the
  capture itself is deterministic.

`check.py` on the AFTER build: all 14 items pass (1, 2, 2b, 3, 4, 5, 6, 6b, 7, 8, 8b, 9 with 0/12
loads failing, 9b, 9c); no console errors, no blocked external requests. A probe of `/hk-scratch`
and its Lights page found 22 and 24 `hk-icon`s, every one drawn, and no `ha-icon`/`ha-card` inside
any HK card's shadow root. `testha.py down` afterwards.

## Behaviour notes

- **card-mod and other user CSS** that targets `ha-card` (or `ha-icon`) inside an HK card no
  longer matches: HK's plates are `hk-plate`. The `--ha-card-*` variables, which is what HK's own
  settings and docs use (`vars` in the Card Library), work as before. This belongs in the release
  notes of the version that ships P2.2.
- `hk-icon` draws a bare name (no `set:`) as `mdi:`; HA's `ha-icon` draws nothing for one. No HK
  card passes a bare name (the geometry is identical).

## Validation

```
build into .vbuild/ha (inside the worktree; the sandbox blocks sh outside it), deleted after
sh .vbuild/ha/tests/run                       -- all suites green -- (123 suites)
.vbuild/ha/tests/py: pytest                    666 passed, 1 skipped
~/.venvs/mantel/bin/python -m pytest -q        190 passed (3 new boundary tests)
tools/headless/client_smoke.py                 exit 0, 0 browser exceptions, 0 external requests
```

## Left

- Mantel's `ha-card`/`ha-icon`/`ha-svg-icon` stand-ins in `web/shim/ha-elements.js` are no longer
  used by HK's cards; they can go once nothing else in Mantel needs them (Mantel's `hk-state-icon`
  still extends the `ha-state-icon` stand-in).
- `hk-icons.js`'s repair shim still walks the page for HA's `ha-icon`; HK no longer needs it, only
  HA's own cards with `hk:` names do.

## Exact continuation point

P2.2 is done on its branch (not merged). Next: merge it; the release notes of the version that
ships it get the card-mod caveat above. Then P2.5 (sheets and dialogs) and P2.6 (HK as an HA
panel) per `ROADMAP.md`.
