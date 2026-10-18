# Frontend source

- `hk/`: existing HK frontend imported for Phase 1, with fixed per-file budgets for
  remaining raw HA dependencies in `docs/phase1/legacy-ha-access.json`.
- `client/hk-client.js`: the first shared client interface; zero raw HA dependencies.
- `cards/hk-metric.js`: the existing metric card extracted to consume that interface.
- `home.html`, `home.js`, `shim/`, `mdi/`: the Phase 0 read-only Mantel Home proof.

The HA build composes this source with `hosts/ha/frontend/hk-ha-client.js`. Fonts and
real Apple glyph data remain user-supplied. The Phase 0 snapshot remains a frozen,
git-ignored reference; it is not the source for new Phase 1 changes.

The metric's shared base and action handling are still transitional. The remaining
cards/modules migrate incrementally; see `docs/phase1/RESULTS.md`.
