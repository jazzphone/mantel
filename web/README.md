# Frontend source

- `hk/`: existing HK frontend imported for Phase 1, with fixed per-file budgets for
  remaining raw HA dependencies in `docs/phase1/legacy-ha-access.json`.
- `client/`: shared client interface and card state/update lifecycle; zero raw HA dependencies.
- `cards/hk-metric.js`: the existing metric card extracted to consume that interface.
- `home.html`, `home.js`, `shim/`, `mdi/`: read-only Mantel Home with its own client port.
- `shared-assets.json`: shared modules composed at /hk URLs in HA and Mantel.

The HA build composes this source with `hosts/ha/frontend/hk-ha-client.js`. Fonts and
real Apple glyph data remain user-supplied. The Phase 0 snapshot remains a frozen,
git-ignored reference; it is not the source for new Phase 1 changes.

The base state/update path and settings feed discovery use HKClient, including stable
subscription ports and client update listeners. See `docs/phase1/SUBSCRIPTIONS.md`. Artwork
reconnect handling and the music feeds use the same port (`docs/phase1/MUSIC-ART.md`). Its action and other host-specific handling remain transitional. The remaining
cards/modules migrate incrementally; see `docs/phase1/STATE-CLIENT.md`.
