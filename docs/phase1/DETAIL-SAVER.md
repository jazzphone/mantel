# Phase 1, fifth slice: detail sheets and screensaver read through HKClient

Completed locally. Production HK has not been edited or deployed.

Follows [`MUSIC-ART.md`](MUSIC-ART.md). The detail sheets (`hk-detail.js`) and the screensaver
(`hk-saver.js`, `hk-saver-panel.js`, `hk-saver-energy.js`, `hk-saverclock.js`, and the
non-connection reads in `hk-saver-weather.js`) now read the house through
`hkCards.client()`/`onClient`. Their action paths still use the host input, through one
host-adapter bridge, until slice 6 gives the client an action port.

## Read-only client surface (extracted first)

Changes in `web/client/hk-client.js`, `hosts/ha/frontend/hk-ha-client.js` and `web/shim/mantel-client.js`.
All of it is generic, so slice 9 (card families) can reuse it.

- **Registries and the service catalog:** `entities`, `devices`, `areas`, `floors`, `services`.
  These return the host's current maps by identity. Registry-change signatures (for example the
  group sheet's) still work by identity compare.
- **Formatting:** `formatEntityAttributeValue` and `formatEntityAttributeName`, alongside the
  existing `formatEntityState`. Each keeps its host receiver.
- **REST reads:** `callApi(method, path)`. The call shape is the host's, so shared readers
  (`hkStats.history`, the sheet's day timeline) accept either. Only `GET` is forwarded. Any
  other method is rejected with "HKClient.callApi is read-only" before it reaches the host.
- **`hkClient.DATA` / `hkClient.METHODS`:** the published surface, for tests.
- **Compatibility bridge, `hkHostClient.bridge(element, client)`.** Each adapter keeps a private
  client→host map. An element shown an adapter-made client gets *that client's* host input as
  `element.hass`. This is how sheet controls and card families keep working while they still act
  through it. A client the adapter did not make is handed over as `element.client`, read-only.
  Shared code never sees the raw object. The bridge lives in the adapters, which are outside
  the budgeted tree.

Still not on the client: `callService` (slice 6), raw connections (slice 7) and `panels` (an HA
shell concept, slice 8).

## What moved

**`hk-detail.js` (68 → 15):**
- `open()`, the `hass-more-info` handler, pop-ups (`openPopup`, `asked`, `closeAsked`) and
  `restoreGroup` read `C.client()`.
- The open sheet is fed **clients**: `C.onClient(feed)`, plus the existing 250 ms look, which
  now asks `C.client()` (in HA the adapter reads the root element, as the poll did) instead of
  reading `<home-assistant>.hass`.
- The header icon binds through `client.bindStateIcon`.
- Each panel is handed its host input through the bridge. Every panel reads `this.client`:
  `_stateObj`, signatures, favourites, history reads, statistics, room/area lookups, vacuum
  parts/areas/services, the water heater's unit, the camera's stream, the sensor day rows
  (REST GET) and the group list/resolve.
- The thermostat and alarm cards inside sheets get the host input through the bridge.
- `hk-headers.js` timer `hkHead` binds its icon through the client too, because it now receives
  the sheet's client (39 → 38).

**`hk-saver.js` (18 → 7):**
- `hassNow()` is replaced by `clientNow()`, which is `hkCards.client()` or, before hk-base
  loads, `hkHostClient.current()`.
- The switch, house updates, cards, clock, Home Energy, Weather, music, photos (`callWS`), the
  black-screen sync and the forecast sky all read the client. The hub is `onClient`.
- Saver cards (corner cards, calendar pane, weather band) get their host input through the
  bridge on each new client.
- `hostNow()` (`hkCards.hass()`) is kept only for the switch write and the music's
  buttons/volume.

**`hk-saver-panel.js` (17 → 10):**
- Panel options gain `client()`. Rooms, contexts and the queue read/play (`callWS`) use it.
- The library card's host input follows the client through the bridge, once per new client, as
  before.
- `hk-music.js` and `hk-media.js` pass `client: () => self.client` to their panels (no new raw access).

**Smaller files:**
- **`hk-saver-energy.js` (13 → 0)** and **`hk-saverclock.js` (14 → 0)**: they take a client:
  `ready/draw(client)`, `setClient`, and `mount(..., { client })`.
- **`hk-saver-weather.js` (23 → 2)**: all reads use the client. The forecast subscription still
  uses the host connection, found through `hkCards.hass()`. That is the same object the saver
  passed before. Slice 7 moves it to `client.subscriptions`.

## Left in place (owner slice)

| File | Remaining | Why |
|---|---|---|
| `hk-detail.js` (15) | `hass-more-info` listener and its comment; `onDashboard` reads `C.hass().panels` | HA shell hooks, slice 8 |
| | camera sheet's `set/get hass` override and `hkSetHass(this._hass)` on the stream card | card family / camera, slices 7 and 9 |
| | group sheet's pills (`hkSetHass`/`.hass`); custom pop-up's HA core cards | card families, slice 9 (core cards: slice 8) |
| `hk-saver.js` (7) | `hostNow()` and `hass: hostNow` for the switch write, music buttons, volume and the panel's actions | slice 6 |
| | the dashboard music-pane card's `set/get hass` (Lovelace hands it hass) | slice 9 |
| `hk-saver-panel.js` (10) | `o.hass()` in `request`, `volSend`, `playNode`, `playlist` (service calls) | slice 6 |
| | library card creation (`_hass` preset before `setConfig`, then `.hass`) | slice 9 |
| | `hass-notification` listener, comment | slice 8 |
| `hk-saver-weather.js` (2) | `hostConnection()` for `weather/subscribe_forecast` | slice 7 |

Write `callWS` messages in these files go through the client's `callWS`, as slice 4's focus
write does. In HA this is the same call. In Mantel they are refused as `commands_disabled`, as
before. The messages are `hk_notify/mute`, `config/entity_registry/update`, `hk_frontend/hidden/*`,
`hk_energy/device/*`, `hk_frontend/board/favorite`, `hk_music/queue_play`, the saver's touch and
black acknowledgements, and `call_service` searches. Slice 6 should route them through the action
port.

## Behavior

Unchanged in HA:
- One feed per new snapshot.
- The sheet's 250 ms look while open. It still uses no animation-frame loop.
- Signature gating.
- The controls' service calls (same host object, now matched to the client by the adapter).
- The switch echo handling.
- The music and volume actions.
- The forecast subscription with `resubscribe: false`.
- Card feeds once per new client.

Stated changes:
- **Read-only client.** A client with no host input (one an adapter did not make) now opens
  sheets read-only, and the screensaver runs from it without writing the switch. Before this
  slice that configuration could not exist.
- **REST writes through the client are refused.** `callApi` on the client is GET-only. None
  of these consumers sent a non-GET through it.
- **Before hk-base loads,** the saver's reads use the host adapter. Its switch write waits for
  the hub's host input. Before, it read `<home-assistant>.hass` directly. The adapter is
  bootstrapped first, and a switch write needs an idle period, so this is an edge of an edge.
- **Mantel:** an open sheet now follows the Mantel host's current client through the poll. Before,
  it polled a `<home-assistant>` element that does not exist there and depended on the hub alone.

Fixture shapes updated, as in earlier slices:
- `test_saver` fakes `hkCards.client/onClient` over the real HA adapter. `hass()` stays as the
  action input.
- `test_saverclock` mounts with `client`.
- `test_detail_behaviour`'s group case sets the root element to each pushed object, as the
  frontend does. The sheet now follows the adapter's current client, so a push that the root
  does not hold is replaced by the root's.

## Tests

New `tests/test_clientreads.js`, **26 assertions**:
- registries by identity (and a replaced registry)
- the service catalog
- attribute formatters with their receiver
- no `callService`/raw host/connection on the client
- the published surface
- REST GET forwarded with its receiver; POST refused before the host
- no REST on a host without it
- the bridge: host input for adapter clients; foreign clients handed over read-only; null left alone
- `hkSaverClock.mount({client})` and `setClient`
- Home Energy asks its summary of the client itself
- Weather reads the client while its forecasts still go over the host connection, with
  `resubscribe: false`

`test_detail_behaviour`, **13 new assertions**:
- the sheet is fed the client, never the host
- the panel reads that client and holds the matching host input
- the icon is bound through the client
- the 250 ms look and the `onClient` hub both reach an open sheet
- the controls still act
- a read-only client opens a sheet whose panel holds no host input, binds its icon through its own port and sends nothing
- the day timeline is a client GET

`test_saver`, **1 new assertion**: with no host input, the screensaver starts from the client
and writes no switch.

Checked against the previous code: the 9 surface/saver-module assertions, 4 sheet-feed/read-only
assertions and the saver read-only assertion fail there. The bridge-preserved control, icon and
switch assertions pass on both.

Browser smoke (`tools/headless/client_smoke.py`), extended:
- The Mantel client exposes registries and no `callService`.
- The client refuses a REST POST.
- `hkDetail.open('sensor.proof')` is fed `hkCards.client()`, reads 22.8 and follows a real local
  WebSocket update to **23.5**.

## Validation

- **115 frontend JavaScript suites passed** (114 before, plus `test_clientreads`), against a fresh composed HA build.
- **665 HA Python tests passed, 1 skipped** (unchanged).
- **147 Mantel tests passed** (unchanged; 14 existing aiohttp fixture deprecation warnings).
- **Isolated Chrome smoke passed** with fictional data. Its existing checks are unchanged:
  - metric 21.4 → 22.8 °C
  - settings Offline before → after
  - music Offline Office → Offline Den, one subscription
  - focus write refused
  - art unsigned offline
  - `commands_disabled`
  - zero blocked writes, zero external requests, zero browser exceptions

  The new detail-sheet checks above also passed.
- **Raw-host budget total 1,810 → 1,690 (−120):**

  | File | Before | After | Change |
  |---|---|---|---|
  | `hk-detail.js` | 68 | 15 | −53 |
  | `hk-saver.js` | 18 | 7 | −11 |
  | `hk-saver-panel.js` | 17 | 10 | −7 |
  | `hk-saver-weather.js` | 23 | 2 | −21 |
  | `hk-saver-energy.js` | 13 | 0 | −13 (budget removed) |
  | `hk-saverclock.js` | 14 | 0 | −14 (budget removed) |
  | `hk-headers.js` | 39 | 38 | −1 |

  No budget grew.

## Exact continuation point

**Superseded by [`ACTIONS.md`](ACTIONS.md) (slice 6 is done).**

This slice is complete. Next is slice 6: put every `callService` and command behind one client
action port. In HA it makes the real call; in Mantel it returns `commands_disabled`. Start with
`HkBase._call` and the bridge users listed above:
- the detail panels' `_svc`
- the saver's `hostNow()` actions
- `hk-saver-panel.js`'s `o.hass()` actions
- the write `callWS` messages listed above

Once those act through the client, the bridge and `hostNow()` go away, and card feeds can become
`el.client = c`. The legacy hub stays until slices 7–12 are done.
