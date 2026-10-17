# Proof 1, second half: HK's Home page drawn by Mantel (2026-10-17)

**Result: it renders.** `http://127.0.0.1:8765/home` (behind sign-in) redirects to `/dashboard-kitchen/home` and draws the Kitchen tablet's Home page with HK's own, unmodified card code, fed live by the state hub: header, chips, scenes, favorites and a section per room, with SF Pro and the SF Symbols from "Your files". No Lovelace, no HA frontend JS, no `hui-*` / `ha-panel-*` / `home-assistant` element.

Screenshots (headless Chrome, 1280x800 = the Kitchen tablet's CSS size): [kitchen-home-1280x800.png](kitchen-home-1280x800.png), full page [kitchen-home-1280x800-full.png](kitchen-home-1280x800-full.png). The camera mosaic is an empty placeholder, so no camera image is in them. The "commands disabled" toast visible in earlier captures came from the test that proves callService refuses; the committed shots are taken before it.

## Criteria
| criterion | result |
|---|---|
| no `hui-*`, `ha-panel-*`, `home-assistant` element | none in the DOM (2,949 elements walked, shadow roots included). Stand-ins are named `ha-card`, `ha-icon`, `ha-state-icon`, `ha-svg-icon`, `mantel-card`, `mantel-grid-card`, `mantel-conditional-card` |
| no HA frontend JS loaded | every request and every script is from `127.0.0.1:8765` |
| live updates work | the page applied 6 `hass` updates in 20 s from hub diffs; cards re-render on each |
| commands refused | `hass.callService` rejects `commands_disabled` and shows a toast, nothing sent; a raw `call_service` over the hub socket answers `commands_disabled`; HA writes are never sent (ReadProxy and capture tool allowlists pinned by tests) |
| console | no errors or warnings |

## Numbers (Mac, headless Chrome, caches off, 4 cold loads, then 20 s steady)
| | value |
|---|---|
| Page drawn (navigation start to cards attached) | **166 ms** median (runs 163 to 199) |
| Main-thread script time up to that point | 38 ms (task time 140 ms, layout + style 25 ms) |
| Page weight | 9.3 MB, mostly fonts, glyph data and card code, uncached |
| Elements | 2,949 (shadow roots included) |
| Steady, narrowed to the screen's 226 entities | script **0.014 s per 20 s**, 0.3 hub msgs/s, 43 B/s, 6 `hass` updates per 20 s |
| Steady, all 4,495 states streaming (`?narrow=0`) | script **0.10 s per 20 s**, 2.6 hub msgs/s, 1.3 kB/s, 51 `hass` updates per 20 s |
| For comparison, HA's frontend (2026-10-04 profile, a wall tablet) | `core.js` ~1.2 s per 20 s |

Caveats: this is a fast Mac, not a tablet, so compare only against a capture of HA's Kitchen Home page taken on the same machine. The numbers are CDP Performance metrics (`ScriptDuration`, `TaskDuration`), not a full trace. The all-states row includes the shim copying a 4,495-key `states` object per update, which a real HKClient would not do.

How narrowing works: the strategy needs the whole house to decide what to draw, so the page subscribes to everything, draws, then records which states the cards actually read and resubscribes to only those (226). Hub downstream after that is the "one screen's worth" the plan promised.

## What is stubbed or missing
- Live camera video (placeholder), music controls (display only), settings panel, screensaver, sleep/wake, tablets: out of scope.
- **Sky background and tab bar are not drawn.** `hk-sky.js` and `hk-tabbar.js` load but find the Lovelace panel by DOM lookups; the page uses HK's flat dark `#05070e`. Not investigated further.
- The page does not regenerate when settings or registries change (HA's `shouldRegenerate`); it draws once per load.
- HK feeds are replayed from captured fixtures (settings, music, page headers, snooze). `hk_frontend/events/subscribe` and `frontend/subscribe_user_data` are stood in. Settings changes in HA are not reflected until the fixture is captured again.
- A chip row start (about 25 px in from the page edge) may differ from HA; the planning session's side-by-side will tell.
- The ReadProxy forwards live HA reads only for an explicit allowlist (config, themes, forecast, notifications, history, logbook, statistics, energy); it has no per-entity access check yet (RBAC is Phase 3). The Home page needed only `get_config` and `frontend/get_themes`.

## Where things are
`web/home.html`, `web/home.js` (the view container), `web/shim/` (hass shim, hub client, HA element stand-ins, card bridge), `web/mdi/` (653 Material Design Icons from `@mdi/js`, Apache-2.0), `hosts/server/mantel_server/readproxy.py`, `hosts/server/tools/capture_fixtures.py`, `tools/headless/` (CDP driver, `home_probe.py`, `home_numbers.py`). Run: `mantel-server session --ha-user-id ID --file ~/.local/share/mantel/measure.cookie` once, then `python tools/headless/home_numbers.py --shot docs/proof1/kitchen-home-1280x800.png`.
