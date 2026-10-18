# HK's feature pages on Mantel: Live TV, Energy, Power and Clean Areas (2026-10-18)

**Found on the house** (Mantel as an HA App, HK drawn through it, next to HA's own HK on `dashboard-kitchen`
at 1366×900): HA's dashboard had `live-tv`, `energy` and `power`; Mantel's did not, and its Vacuums page had no
**Clean Areas** card.

**Cause (checked in the code).** HK's strategy (`web/hk/cards/hk-strategy.js`) draws those only for a feature
that is *added*: `added('live_tv')` for Live TV, `added('energy')` plus the settings feed's `energy` (the Energy
page's plan, with its `power` part) for Energy and Power, and `added('clean_areas')` for the Clean Areas card.
`added` and `energy` are what HA's `hk_frontend/settings/subscribe` adds to the feed
(`hosts/ha/.../__init__.py` `ws_settings_subscribe`). Mantel's feed sent `added: []` and no `energy`, its
panel/get answered `features: {}`, and the one-time import did not bring the feature items over. In HA they
are items (config subentries of type `feature`) of the hk_frontend entry, and their settings are only in
each feature's own `<id>/settings/get` answer, not in panel/get.

## 1. The feature import

`features.import_features(panel, read, current, source)` (`hosts/server/mantel_server/features.py`):

- **Which features HA has added:** panel/get's `features` (`{hk_music: {kind, entries: [{entry_id, title}]}, …}`)
  becomes `ha.added` (HA's kinds, in HA's order) and `ha.items` (HA's item ids and titles).
- **Their settings:** for each of Notifications, Clean Areas, Energy and Live TV that HA has, one read of its
  HK Settings page:
  - `hk_notify/settings/get`: `options` (stay, saver, chime, dnd, wake) and `items`, keeping only the stored
    fields (`id` + `ITEM_FIELDS`)
  - `hk_clean_areas/settings/get`: `chosen_vacuums` and `chosen_areas` become `options.vacuums` and `options.areas`
  - `hk_energy/settings/get`: `options` (the stored `OPTION_KEYS`, none of what HA works out)
  - `hk_tv/settings/get`: `host`, `guide_url`, the channels and their names
- **The pieces it turns on:** `notifications`, `clean_areas` and `energy` come in **enabled**, because Mantel
  runs them. `live_tv` is imported **off**: its screens read HA's channel cameras (below), and HA already reads
  the guide. A feature HA does not have comes in off, and its read isn't sent.
- **Kept, never written:** `linked` and `sleep`.
- **Checked:** the result goes through `check_settings`. Values it can't accept (a non-entity vacuum, a
  malformed channel) are left out rather than failing the import.

Where it runs:

- **The one-time import** (`settings_store.import_settings(..., read_features=…)`, used by the REST, the CLI
  and the Ingress button) writes `house/mantel_features` as version 1 alongside the rest. A feature read that
  fails leaves out only that document and reports `features_error`.
- **On its own, again:** `POST /api/features/import` (Owner; CSRF as every `/api/` POST), or the Ingress
  people page's **"Import HK's features from Home Assistant again"** (Owner; audited `ingress.import_features`).
  It reads panel/get and the feature pages, and writes a new version (`action: import`). **This is how the house,
  whose one-time import ran before this existed, gets its features.**
- **The reads:** they are new `READ_ALLOWED` entries, every one in `SERVER_ONLY_READS`, through
  `ReadProxy.read_server` (which refuses anything else). A page can't send them: `FilteredReads` refuses them
  (pinned). Nothing is written to HA.

## 2. What the screens are told (HA's shapes)

`FeatureHost.client_part(identity)`, added by `SettingsService` to every settings feed:

- **`added`:** in HA's KINDS order. A piece Mantel runs, while it is on, plus `music`, `alarm_pin` and `live_tv`
  while HA has them (their engines still run in HA).
- **`energy`:** the Energy page's plan (`hk_core.energy.plan.build` over MantelHouse), only for a subject with
  `feature:energy`; otherwise `null`, as `mantel/energy/plan` refuses. The plan is worked out:
  - once Mantel is connected to HA
  - on every settings or registry reload
  - every 5 min on the tick (HA says nothing when its Energy settings are saved)
  - whenever `mantel/energy/plan` is read

  A change sends every screen a new feed.
- **Two fixes so the plan is HA's:**
  - It now borrows the house's Status & Chips thermostats, outside temperature and Power Use
    (`energy_house` / `found_thermostats`, a port of HA's `kinds.resolve` for thermostats).
  - HA's `not_found` (no Energy settings ever saved) counts as no settings, as HA's own plan does.

panel/get's `features` is `FeatureHost.panel_features()`: HA's shape (every feature installed, an entry per
added one, HA's item ids where imported, state `loaded`).

## 3. Each page's data

| Page | What it reads | On Mantel |
|---|---|---|
| **Clean Areas** (`hk-area-select-card`) | `hk_clean_areas/subscribe` → `{configured, areas}` | **Answered by Mantel** (`features.ROUTE_RULES`): `hk_core.clean_areas` coverage/offered over MantelHouse with the imported options. An area is offered only through a vacuum the subject may `view`. It's pushed on settings and registry reloads and on any `vacuum.*` change, and only when it changed (HA sends only changes too). It carries no keys. **Starting a clean** is the page's `hk_frontend.clean_areas` service call: a command, so the gateway handles it (refused while commands are off). It is never this read. |
| **Energy** | the feed's `energy`; `energy/get_prefs`, `energy/info` (`feature:energy`, pruned); `recorder/statistics_during_period` (`history`, filtered) | The plan as above; the three reads were already allowed |
| **Power** | the plan's `power` part (from the Energy options' `power`) + live states | Same plan |
| **Live TV** (`hk-tv-guide-card`) | `hk_tv/channels` → `[{number, name, camera, now}]`; the `now` sensors' states; each channel's camera picture and live view; `hk_tv/watching` heartbeat | **Interim read bridge** to HA (`readproxy.RULES`): a channel is kept only if the subject may `view` its `camera.*`, and its `now` `sensor.*` reads null unless viewable. Rebuilt from the four keys. The camera and sensor states already come through the hub. |

### Live TV video

What works, and through which path:

- **The video.** Each channel is an `hk_frontend` camera in HA. Its stream is HA's own transcode (ffmpeg
  MPEG-2/AC-3 to H.264/AAC), relayed to WebRTC by HA's go2rtc. The player is `hk-doorbell-card` with
  `entity: <channel camera>`, so it signals exactly as a camera's live view does: `camera/webrtc/*` through
  Mantel's camera connector, `Authz.may_view` (`camera.live`), and the media goes browser ↔ HA's go2rtc
  directly. This is the interim that works in HA App mode, and no new route is needed.
- **The tile's picture.** It is the camera's `entity_picture`, which Mantel's still route rewrites, so no HA
  token reaches the page.
- **The heartbeat.** `hk_tv/watching` is a write (HA records the viewer in `sensor.tv_viewers`). With commands
  on it goes to the gateway. With them off it is answered in the page (`web/shim/mantel-client.js`) and nothing
  is sent, so a programme doesn't raise a "commands disabled" toast every minute.

What remains (in HA until Live TV's viewers move):

- **The transcode** (`live_tv/stream.py`) and the channel cameras.
- **`sensor.tv_viewers`.** With commands off, a screen watching through Mantel isn't counted, so its tablet's
  HA-side sleep logic doesn't see it.
- **Mantel's own Live TV piece** (lineup + XMLTV guide, `mantel/live_tv/guide`) isn't what the page reads.
  Moving the page to it needs the transcode in Mantel: PLAN §10's ffmpeg/QuickSync path, proven in Proof 4 but
  not built.

## Other gaps

- **HA's own Lovelace energy cards** (`energy-date-selection`, `energy-sources-table`,
  `energy-devices-graph`, `energy-devices-detail-graph`) are drawn only when the Energy options' `detail` is on.
  Mantel's view host doesn't have them.
- **Lovelace's `markdown` card** isn't in the view host either. An Energy page with nothing to show ("Nothing to
  show yet…") draws an empty placeholder instead of that line.
- ~~**HK Settings → Features pages** read each feature's `<id>/settings/get`, which pages can't send on Mantel.~~
  **Fixed (2026-10-18, [MANTEL-FEATURES.md](MANTEL-FEATURES.md) "Phase 4 ports" item 5):** Mantel answers each page
  for Owners/Admins and stores Notifications', Clean Areas', Energy's and Live TV's saves in
  `house/mantel_features`; Music's and Alarm PIN's pages are an interim rebuilt read of HA's, their saves still
  `not_yet`.
- **A change made in HA after the import** doesn't reach Mantel until the import is run again (POST or the
  Ingress button).

## Verified

- **pytest:** `tests/test_feature_parity.py` (28) covers:
  - the import: each piece; not-added features not read; re-import keeps linked/sleep; bad values dropped;
    one-time import with the features and with a failing read
  - server-only reads refused for pages
  - feed `added`/`energy` (Owner versus Guest), panel/get `features`, a new feed when a feature is turned on or
    the plan changes
  - the area picker: answered by Mantel; RBAC-filtered; off; malformed; follows settings and the vacuums; the
    start stays a command
  - every features read route has one rule
  - `hk_tv/channels` filtered, empty for a Guest, extra keys and writes refused
  - refused-read logging once per 5 min
  - `POST /api/features/import`: Owner-only, keeps linked, a new version, no audit or command
  - the plan with HA's `not_found`; the thermostats rules

  Also `tests/test_shim_features.py` (+2, the heartbeat). Allowlist pins updated.
- **Scratch HA** (`tools/e2e/feature_parity_e2e.py`, 12 checks, all passed): Clean Areas, Energy and Notifications were
  added in the scratch HA through its own subentry flow, and a demo vacuum was mapped to the Kitchen. Results:
  - The Owner's `POST /api/features/import` read exactly panel/get and the three feature pages.
  - Mantel's feed `added` equals HA's own feed's.
  - Mantel's Energy plan is identical to HA's.
  - `hk_clean_areas/subscribe` through Mantel equals HA's (`["kitchen"]`); a Guest gets `[]`.
  - `hk_tv/channels` answers as HA does (no tuner there).
  - A page's feature-settings read is refused, and no command connection exists.
- **Scratch HA, HK's page in headless Chrome** (1366×900), with Energy settings saved and the Energy options'
  `power` set in the scratch HA:
  - The strategy generated `vacuums` with the **Clean Areas** card offering Kitchen, plus `energy` (period, hero,
    highlights, where, day and gas cards drawn with data) and `power` (house, status and load cards).
  - The Energy plan is again identical to HA's.
- **Not verified:** Live TV's video (the scratch HA has no HDHomeRun) and anything on the house.
