# Handoff: group block spacing and glyphs (2026-11-07)

The owner's three screenshots, all HomeView-style (square-cell) grids on the house (e.g. `kitchen-homeview`, 5 x 4).

## Done (pushed to main, not on the house yet)

1. **Half Accessories / Scenes rows** (`hk-grid-room.js` `.tiles.half`, `hk-chip.js` `_grid`): the fixed 70 px pill rows were
   `align-content:start`, so all spare height sat at the block's foot. Now `center`.
2. **Wide / Extra Large Music covers** (`hk-media-recent.js` `_across`): covers that scroll across were sized by width
   (4.4 across), leaving the spare height under the names. A ResizeObserver now sets `--cv` to the height's cover, the next
   one peeking >= 25 % (else shrunk for a 0.4 peek); the row is centered.
3. **Full Accessories glyphs** (`hk-base.js` `centredTile`): a Large block's tiles are ~179 px square before the zoom, under
   the `min-height:180px` container query, so they took the 150 px Tall pill's 58 px glyph (~75 % size). Near-square cells
   (`max-aspect-ratio: 6/5`) now take the square numbers; a square cell's glyph grows past 196 px, capped at 45cqmin.

`tools/headless/home_grid_visual_check.py --homeview` gained the `hv-sq-pane-half` and `hv-sq-pane-big` screens.

## Open

- `hv-sq-pane-4` at 820x1180 already fails on main without these changes (page scroll 276 px).
- Not checked by the owner on the house: needs a Mantel house release (review all commits since 0.1.149 first).
- Square numbers also bring the 21 px name to those ~179 px tiles; check long names on the house (Kitchen Outlet...).
- Other users of `centredTile` (intercom keys, security keys) take the square numbers if their cells are near square;
  the HomeView check passed for them but have a look.
