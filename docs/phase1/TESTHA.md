# Phase 1 checkpoint: the HACS build inside a real Home Assistant

Run 2026-10-18 (about 01:30 to 03:00 EDT) against a **scratch** Home Assistant on this Mac with the
`demo` integration's invented devices only. The house's HA and `/Volumes/config` were never touched.
Reusable harness: [`tools/testha/`](../../tools/testha/README.md) (`testha.py up`, `check.py`, `testha.py down`).
Screenshots and `results.json` are in the scratch dir, not committed (paths below).

## Environment

| | |
|---|---|
| Home Assistant | 2026.9.4, frontend 20260826.7 (Python 3.14.7), 115 integrations loaded, none of zeroconf/ssdp/dhcp/bluetooth/homekit/cast/sonos/unifi/music_assistant/go2rtc/met/cloud/mobile_app |
| HK Frontend | built with `tools/build_ha.py`, manifest version 1.8.3 |
| Browser | headless Chrome 155 (isolated profile, DNS limited to 127.0.0.1) |
| Setup | `http` on 127.0.0.1:8124, throwaway owner, `hk_frontend` entry added through the config-flow REST API, 3 generated dashboards (`/hk-scratch` computer, `/hk-wall` wall tablet with screensaver, `/hk-phone`), 4 rooms holding demo lights, media players, covers, climate and a lock |
| Scratch dir | `/private/tmp/claude-501/-Volumes-data-mantel/97f5b33d-8378-4f3a-82f6-9938003f5053/scratchpad/testha/` |

The repo moved while this ran (slices 9 to 12 and Phase 2 landed), so three builds were tested; each
run's commit is in the table. HA-relevant paths (`web/hk`, `web/client`, `hosts/ha`) were clean against
HEAD for every build.

## Result

**Every feature item works in HA, and no client-port regression exists** (no `not_allowed`,
`read_only`, `commands_disabled` or `HKClient`-refusal anywhere; the forecast, cameras, menu badge,
settings panel and screensaver all go through the client's ports and work). But the HA build has
**one serious regression: HK's bootstrap modules race each other**, and on a load that loses the race
the dashboard can stay blank or lose its HA hooks. It is not caused by slices 9 to 12 (it reproduces on the
slice 8b build, `5d456f4`), and it is not caused by the test rig (it reproduces with no request
interception). Details and a verified fix direction below.

| # | Item | A: `5d456f4` natural | B: `4e6e804` natural | C: `9cc9baf`, ordered bootstrap (experiment) |
|---|---|---|---|---|
| 1 | Home renders: header, chips, tiles for the demo devices, 0 uncaught exceptions | PASS | PASS | PASS |
| 2 | Tap a light tile: toggles (real service call into the scratch HA) | PASS | PASS | PASS |
| 2b | Tap the name: detail sheet opens; drag the brightness slider: the light changes | PASS (117 to 41) | PASS (180 to 117) | PASS (181 to 117) |
| 3 | Weather page: hourly strip and 7-day rows from `weather/subscribe_forecast` | PASS, 2 subscriptions, 0 refused | PASS, 2 / 0 | PASS, 2 / 0 |
| 4 | Cameras page: 3 demo camera cards draw; one opens (video); WebRTC signalling | PASS | PASS | PASS |
| 5 | Side menu opens; notification badge follows `persistent_notification.create` (2 to 3 to 2) | PASS | **FAIL** when the load lost the race (no menu badges) | PASS |
| 6 | Tab bar draws and navigates (Lights, Climate, Home) | PASS | **FAIL** (lost the race: no tab bar) | PASS |
| 6b | HK Settings panel opens (Overview, 3 screens, pages list) | PASS | PASS | PASS |
| 7 | Screensaver starts (`?hk_saver=force`) and its weather screen draws | PASS | **FAIL** (lost the race: it did not start) | PASS |
| 8 | Any `not_allowed` / `read_only` / `commands_disabled` / `HKClient` in the console or websocket results | PASS (0) | PASS (0) | PASS (0) |
| 8b | HA's own log: uncaught browser errors it received | PASS (0) | PASS (0) | PASS (0) |
| 9 | 12 reloads: any bootstrap module failing to load | **FAIL** 3/12 (`tesla-viewport.js`) | **FAIL** 4/12 (`hk-ha-shell.js`) | PASS 0/12 |
| 9b | `hk-host-shell.js` held back 2.5 s: dashboard still works | **FAIL**: dashboard never draws | **FAIL**: dashboard never draws | PASS |
| 9c | `hk-client.js` held back 2.5 s: dashboard still works | **FAIL**: dashboard draws, 24 uncaught `HKClient has not loaded`, `hk-saver.js` (screensaver) never loads | **FAIL**: dashboard never draws, 26 uncaught `HKClient has not loaded` | PASS |

Items 5, 6 and 7 in column B failed only on the reloads that lost the race; the same checks pass on
the loads that win it (compare columns A and C). Screenshots: A `results-5d456f4/shots/`,
B `shots-natural/`, C `shots-boot/` (all under the scratch dir). A second full run on `7003913` is in
`results-7003913/` (items 5, 6 and 7 failed the same way; 9 failed 12/12 that time).

### What the checks saw (client ports)

On the working loads the page used, all successfully: `weather/subscribe_forecast` (2 on the
Weather page, 4 with the screensaver's weather screen), `persistent_notification/subscribe`,
`frontend/subscribe_user_data`, `subscribe_events` for `repairs_issue_registry_updated`,
`hk_frontend/settings|events|page_headers/subscribe`, `hk_music/subscribe`, `camera/webrtc/offer` and
`camera/webrtc/get_client_config` (HA itself refused these: the demo cameras are HLS-only, error
`webrtc_offer_failed`; the card logs `[hk-doorbell] could not start` and shows the picture), and
`call_service`. No frame was refused by the client's allowlist. 6 websocket error results in a run,
all those HA WebRTC answers (plus one `config/entity_registry/get` `not_found` in one run, HA's own).

Expected console noise, not regressions: `HK-ICONS: no glyph data` and 404s for
`/hk/iconset/hk-glyphs.js`, `/hk/fonts/SF-Pro.*` (Apple's licensed files never ship), `/favicon.ico`.

## Regression: HA imports HK's bootstrap modules in parallel

**Symptom.** On a share of page loads one or more of these appear in the console, and the page is
partly or wholly broken:

- `Failed to load extra module /hk/modules/hk-ha-shell.js Error: hk-host-shell.js has not loaded`
- `Failed to load extra module /hk/modules/tesla-viewport.js TypeError: Cannot read properties of undefined (reading 'onNavigate')`
- `Error: HKClient has not loaded` (also reported to HA's own log: `[frontend.js.modern...] Uncaught error`)

When `hk-ha-shell.js` loses, `hkShell.kind` stays `'none'`. Then `[hk-loader] could not load` fails for
`hk-sky`, `hk-idle`, `hk-kiosk`, `hk-glass`, `hk-frosttint`, `hk-campost` and `hk-saver`, there are tens
of exceptions (`reading 'panel'`, `'isDashboard'`, `'viewTags'`, `'defined'`), and in the worst case
(9b) the dashboard shows HA's spinner and never draws. When `hk-client.js` loses (9c), the strategy
and settings throw `HKClient has not loaded` and the screensaver module never loads. Measured: 3/12,
4/12, 5/12, and 12/12 reloads on different runs and builds.

**Cause.** Home Assistant's frontend loads every `extra_js_url` with a loop of independent dynamic
imports, which run in whatever order the files arrive:

```
hass_frontend/index.html (20260826.7): import("{{ extra_module }}").catch(function (err) { console.error("Failed to load extra module ...", err); })
```

`hosts/ha/custom_components/hk_frontend/__init__.py:204-247` registers 15 modules one by one and its
comment ("ORDER MATTERS") assumes list order. Phase 1 made later modules depend on earlier ones:

| File:line | Dependency, evaluated when the file loads |
|---|---|
| `hosts/ha/frontend/hk-ha-shell.js:12` | throws if `hk-host-shell.js` has not run; nothing retries, so the HA shell is never installed |
| `web/hk/modules/tesla-viewport.js:187` | `window.hkShell.onNavigate(run)` (slice 8, commit `8a69d2f`, replaced `window.addEventListener("location-changed", run)`); throws, so the file's `popstate` and `resize` listeners and `window.teslaViewport` are never installed |
| `hosts/ha/frontend/hk-ha-client.js:12`, reached from `:92` | `from()` throws `HKClient has not loaded` when `hk-client.js` has not run; the `hk-host-client-ready` event it dispatches calls `web/hk/modules/hk-settings.js:985-990` (`currentClient`, `attach`) in the same breath |
| `web/hk/cards/hk-control.js:1108` and the HK Settings panel (`hk-settings.js?v=...:8811` in the build) | top-level `window.hkHostClient.entry(...)`; same class: needs `hk-ha-client.js` to have run (seen when a rig variant held it back) |
| `web/hk/cards/hk-detail.js:2465` | reads `window.hkShell.events.moreInfo` once at load: loaded before `hk-ha-shell.js` installs, it listens for `hk-more-info` while HA tiles fire `hass-more-info`, so light sheets do not open (seen in a rig variant: item 2b failed) |

**Not new in slices 9 to 12.** The slice 8b build (`5d456f4`, built with `git archive` into the scratch
dir) lost `hk-ha-shell.js` on 12/12 reloads in the same session with no request interception. The
frequency varies with timing; the dependency is built in.

**Not the rig.** The first runs used request interception (`restrict_origin`), which can reorder
parallel loads. From run B on, the browser's DNS is limited instead (no interception) and the race
still reproduces. The delays in 9b/9c only hold one file back.

**Verified fix direction (experiment, scratch copy only).** `testha.py up --ordered-boot` rewrites the
scratch copy's `__init__.py` to register one file, `hk-boot.js`, which holds the dependency-free core
(`hk-client`, `hk-card-state`, `hk-ha-client`, `hk-host-shell`, `hk-ha-shell`, `hk-metric`,
`hk-elements`, `hk-ha-elements`, `tesla-viewport`, `hk-tap`) concatenated in list order and then
`import()`s the rest (`hk-settings`, `hk-icons`, `hk-header`, `hk-loader`, `hk-strategy`). With it:
0/12 failing loads, and 9b/9c pass even with `hk-host-shell.js` or `hk-client.js` held back 2.5 s;
every item passes (column C). Two things that did **not** work, for the record: a naive loop that awaits
all 15 imports one by one (the Weather and Cameras pages drew 0 cards; the strategy came last and HA
waits only 5 s for a strategy), and holding the dependents back in the browser (hold times are guesses).
Alternatives worth weighing: make every dependent wait for `hk-host-shell-ready` / `hk-host-client-ready`
instead of throwing, or compose the core into one file in `tools/publish/publish.py` (it already
composes). This checkpoint changed no HK file.

**Whether it reaches the house is not known.** It depends on the house's HA frontend using the same
parallel loop (this one is 20260826.7) and on the browsers and tablets' load timing. Check the house's
frontend version before the live install; `docs/phase1/` has the install guide.

## Findings that are not regressions

- **HA's `http` trap.** HA 2026.9 migrates a `server_port`/`server_host` YAML block into a "pending"
  trial and **reverts it five minutes later to port 8123 on all interfaces** unless confirmed
  (`http/config/promote`). `testha.py up` confirms it at once; anyone starting a scratch HA by hand
  must confirm the dialog or stop it. (I confirmed it with a few minutes to spare on the first start.)
- **Onboarding adds network integrations.** Its `core_config` step creates Met.no, Google Translate and
  Radio Browser entries. The harness pre-marks every onboarding step but the user's done, so none load.
- `analytics` and `network` load as dependencies of HA's frontend (analytics sends nothing without
  an opt-in; `network` only lists local adapters).
- The Music feature (speaker picker, whose notification subscription is in `hk-media.js:2988`) was not
  added to the scratch HA, so that one `persistent_notification/subscribe` consumer is not exercised
  (the menu's is).
- A crashed run can leave `hk-phone`'s menu on the tab bar; `check.py` now resets it first.
- The working tree was mid-merge (others' uncommitted Mantel-side files, then a conflict in
  `tools/headless/client_smoke.py`) while this ran; none of it is in the HA build.

## Exact continuation point

1. Decide how to make the HA bootstrap order-independent (see above), implement it in
   `hosts/ha/custom_components/hk_frontend/__init__.py` and/or `tools/publish/publish.py`, and rerun
   `tools/testha/run.sh`: items 9, 9b and 9c must pass and so must 5, 6 and 7 on every load.
   This is a Phase 1 blocker for the live HACS install.
2. Add a browser check for the order problem to the Node/Python suites if possible (the Node suites
   load files in list order, which is why they never saw it).
3. Rerun `tools/testha/run.sh` before each release; it takes about 8 minutes.
4. Still untested in a real HA: the Music feature's pages and the doorbell with a real WebRTC camera.

## The fix, verified (2026-10-18, ~03:00–03:20 EDT)

The race is fixed by **the ordered boot** (`hosts/ha/custom_components/hk_frontend/boot.py`, commit
`9e70e87`). HA is given one extra module, `/hk/modules/hk-boot.js`. The `/hk` view answers it with
the dependency-free core joined in order (client, card state, HA adapter, host shell, HA shell,
metric, elements, viewport, tap). Each file goes in its own block and is read per request from the
files `/hk` serves. Then the rest is imported (settings, iconset, header, loader, strategy). The
house's HA 2026.10.2 also imports extra modules in parallel, in no fixed order (seen in its own
page: `hk-icons`, `hk-ha-elements`, `hk-settings` before `hk-client`), so it needed the fix too.

Scratch HA on `9e70e87`, full `check.py`: **every item passes**.
- 9: 0 of 12 loads had a module fail.
- 9b/9c: the dashboard works with `hk-host-shell.js` or `hk-client.js` held back 2.5 s.
- 8/8b: no client-port codes, no frontend errors in HA's log.

**An upgrade with a screen left open** (`tools/testha/restart_check.py`, for the tablets nobody may
reload, e.g. the Master Bedroom's). The scratch HA ran the house's then-live build (`c242360`) with
`/hk-wall` open. HK was swapped for the install candidate (`house-2026-10-18`, `15f81ac`: the build
before P2.4, plus the ordered boot) and HA stopped and started under the page.
- The same page afterwards: 17 of 17 cards still drawn, and a light switched on reached its tile.
- No errors since the swap in the final run.
- A single opaque `EXCEPTION: Object` showed up in two runs. It appears equally with **no** build
  change (old to old), so it is the socket dropping on a restart, not HK.
- `tools/headless/cdp.py` now records a thrown object's fields, so the next one says what it is.
