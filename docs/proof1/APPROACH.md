# Proof 1 (second half): HK's Home page without Lovelace — approach

Written before building, from reading `spikes/hk-snapshot/` (HK at 38d841bf). The "measured" lists at the end are filled in from a recorded run; §Surface is Phase 1's `HKClient` list.

## How HK builds Home today

1. **Bootstrap modules** registered by `__init__.py` (`add_extra_js_url`): `hk-settings.js` (settings, before any card), `hk-icons.js` (the `hk:` iconset), `tesla-viewport.js`, `hk-tap.js`, `hk-header.js`, `hk-loader.js` (loads the order-independent modules: sky, glass, stats, charts, saver, menu, tabbar, notify …), `hk-strategy.js`. Every file in `cards/` plus `css/hk-responsive.css` and `fonts/sf-pro.css` are Lovelace *resources*.
2. **`hk-strategy.js`** is a Lovelace dashboard strategy. `generate(config, hass)` waits for `hkSettings.whenLive`, reads `hass.floors/areas/devices/entities/states` and the screen's *board* from settings (found by the first URL segment), and returns `{views: [...]}`. Each view is `custom:hk-grid-view` with `cards` of `custom:hk-*` types, nested in `custom:hk-grid-card`s. It is also exposed as `window.hkStrategy.generate`.
3. **Lovelace's job** (`hui-root`, `hui-view`, `hui-card`) is only: create each card element, `setConfig(cfg)`, set `hass` on every state change (a new object each time), and hand the built elements to the view as `.cards` (`hk-layout.js`'s `HkGridView` documents that contract: setConfig, then hass, lovelace, narrow, index, cards, badges).
4. **`hk-settings.js`** finds `document.querySelector('home-assistant').hass.connection` and calls `subscribeMessage` for `hk_frontend/settings/subscribe` and `hk_frontend/events/subscribe`; the cards add `hk_frontend/page_headers/subscribe`, `weather/subscribe_forecast`, `persistent_notification/subscribe`, `hk_music/subscribe` and so on.
5. **Icons:** `ha-icon` (HA's) with `mdi:` names (HA serves path chunks at `/static/mdi/`) and `hk:` names through `window.customIconsets.hk` (Apple's glyph data from "Your files").

## What Mantel does instead

| HA piece | Mantel stand-in | Where |
|---|---|---|
| `hass` object | **hass shim**: `states` from the hub's snapshot + diffs, `entities/devices/areas/floors` from the hub's registry mirror, `user` from the Mantel session, `config/themes/locale`; a **new object per update** | `web/hass-shim.js` |
| `hass.connection.subscribeMessage`, `callWS` | Replay of captured HK replies (fixtures) and a **ReadProxy** with an explicit read-only allowlist for live reads (weather forecast, notifications, history …) | `web/hass-shim.js`, `hosts/server/mantel_server/readproxy.py` |
| `hass.callService`, any write | Refuses, shows a "commands disabled" toast; nothing is sent | `web/hass-shim.js` |
| `hui-view` / `hui-card` | A ~60-line view container: run `hkStrategy.generate`, create each card element, `setConfig`, set `hass`, give the view its `.cards` | `web/home.js` |
| `home-assistant`, `hui-root`, `ha-panel-lovelace` lookups (`querySelector`) | A stub object returned by a patched `document.querySelector` for those selectors; **no such element exists in the DOM** | `web/hass-shim.js` |
| `ha-card`, `ha-icon`, `ha-state-icon` (`ha-svg-icon`) | Small custom elements: a plain plate, an SVG icon (reads `mdi:` from a committed subset of `@mdi/js`, `hk:` from Your files) | `web/ha-elements.js` |
| `/hk/…` served by HA | Served by Mantel Server: "Your files" folder first, bundled frontend otherwise (same rule as `backend/files.py`) | `server.py` |

## Rules this proof keeps
- Commands stay refused: the shim's `callService` and `callWS` never send writes; the hub still answers `commands_disabled`.
- The HK snapshot, the Apple font/glyphs and the fixtures never get committed (git-ignored folder; a test fails on any tracked path under `spikes/hk-snapshot/` or named like `SF-Pro*` / `hk-glyphs*`).
- The capture tool and the ReadProxy have separate, explicit allowlists, pinned by tests. `HaClient`'s allowlist is unchanged except where this document says otherwise.

## Out of scope
Live camera video (placeholder), working music controls, the settings panel, screensaver, sleep/wake, tablets. The sky background is nice to have.

## Measured surface: Phase 1's `HKClient` list (recorded run of the Kitchen Home page, `?trace=1`)

Everything the Home page read or called, counted in one cold load plus 8 s. `states` is read by id throughout (213 sites in HK's source); 226 distinct ids are read once the page is drawn.

**`hass` fields read** (reads in brackets): `states` (all of it, by id), `entities` (28,165: the strategy walks it), `devices` (13,916), `areas` (158), `floors` (29), `user` and `user.name` (34, 17), `panels` (114), `connection` (12) with `connection.subscribeMessage` (8) and `connection.addEventListener` (24), `config` and `config.unit_system` (3, 2), `themes` and `themes.themes` (2, 1), `connected` (2).
**Never touched on Home:** `callService`, `callWS`, `callApi`, `localize`, `locale`, `language`, `formatEntityState`, `fetchWithAuth`, `services`, `selectedTheme`.

**WebSocket message types** (through `subscribeMessage`; nothing used `callWS`):

| type | times | Mantel answers with |
|---|---|---|
| `hk_frontend/settings/subscribe` | 1 | captured reply (fixture); live later from Mantel's own settings |
| `hk_music/subscribe` | 2 | captured reply (fixture) |
| `hk_frontend/events/subscribe` | 1 | stood in: no events relayed in this proof |
| `frontend/subscribe_user_data` | 1 | stood in: `{value: null}` |
| `hk_frontend/page_headers/subscribe`, `hk_frontend/snooze/subscribe`, `weather/subscribe_forecast`, `persistent_notification/subscribe`, history | 0 | not asked on Home (page headers and snooze are captured anyway; the ReadProxy allows the HA reads) |

**HA web components:** `ha-card` (202 on the page), `ha-state-icon` (171), `ha-icon`, `ha-svg-icon` (stood in, `web/shim/ha-elements.js`). Created by HK through Lovelace helpers and answered by `web/shim/cards-bridge.js`: `hui-card` (23, created with `document.createElement`; Mantel returns `<mantel-card>`), `loadCardHelpers().createCardElement`, native `grid` (29) and `conditional` card types. Not needed on Home: `ha-form`, `ha-yaml-editor`, `hui-view*`.

**DOM lookups:** `document.querySelector('home-assistant')` 1,092 times (every call is answered by the stub; no other HA selector was asked).

**Globals the page needs from the HA frontend:** `window.loadCardHelpers`, `customIconsets`/`ha-icon` (`_legacy`, `_loadIcon`), `/static/mdi/` chunks, the `hk-cards-ready` event.

**`hui-card` contract HK depends on** (found by the side-by-side): `.hass`, `.config` (a changed config rebuilds the card), `.preview`, `.load()`, collapse when the inner card is `hidden` (event `card-visibility-changed` and the attribute, re-read after every `hass`).

## What I'd change in HK for Phase 1 (found while building)
- `hk-settings.js` and `hk-base.js` find the connection by looking for a `<home-assistant>` element: one injected `HKClient` replaces 1,092 lookups on this page alone.
- `hk-grid-card` / `hk-chip` / `hk-cameras` create `hui-card` and call `loadCardHelpers`: a card factory in HK's own code removes both.
- `hk-strategy.js` builds Home by walking every entity (28k reads of `hass.entities`); fine once, but it is why the first subscription has to be the whole house. A screen that only needs its tiles could be told by the server which ids its view contains.
