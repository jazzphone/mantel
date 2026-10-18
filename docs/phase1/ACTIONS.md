# Phase 1, sixth slice: one action port for every service call and write

Completed locally. Production HK has not been edited or deployed.

Follows [`DETAIL-SAVER.md`](DETAIL-SAVER.md). Every service call in the shared frontend, and every
known write message sent over the WebSocket, now goes through one port on the client:
`client.actions`. In the Home Assistant host it is the real call, with exactly the arguments
the old code passed. In the Mantel host it refuses with `commands_disabled` and sends nothing.
Reads stay on the read-only client, which refuses a write message before the host.

## The port

`web/client/hk-client.js`:
- **`client.actions`** is one frozen object per client with two methods:
  - `callService(domain, service, data, target, notifyOnError, returnResponse)`
  - `callWS(msg)`
- A host that can act gives its port `actions`. The call reaches it with the caller's own
  `arguments` (`apply`), so the arity, target, `notifyOnError` and `returnResponse` are
  unchanged. A host that cannot act (Mantel, or a client made from bare data) gets the
  refusal:
  - nothing is sent;
  - the promise rejects with `code: 'commands_disabled'`;
  - the port's optional `refused(detail)` hook is told `{kind, what}`.
- **Reads and writes are told apart at the port.** `hkClient.WRITES` lists every write
  message type the shared frontend sends, plus `call_service` (a service call over the
  WebSocket, even one that only answers, is a command). `client.callWS` is the read path and
  rejects these with `code: 'read_only'` before the host. `hkClient.isWrite(msg)` exposes the
  same test.

Host adapters:
- **HA** (`hosts/ha/frontend/hk-ha-client.js`): `port.actions.callService` is
  `hass.callService.apply(hass, arguments)` and `port.actions.callWS` is `hass.callWS(msg)`.
  Both run on the frontend's own object, which is the same receiver as before.
- **Mantel** (`web/shim/mantel-client.js`): no action transport. `port.refused` dispatches
  `hk-command-refused`, and the shim's `Host` notes it in `refused` and shows the same
  "Commands are disabled" toast as before. The snapshot's own `callService` is never reached.
  It stays as the backstop for card families that still hold the snapshot.

`hkCards.actions(source)` (in `hk-base.js`) returns the action port for a client, or for a card
family's host input through the host adapter. With no source it returns the current client's.

## What moved

**`hk-base.js`:**
- `HkBase._call`, `_callErr` and `_callResp` call `this._actions()`, which is
  `this.client.actions`. They still make the same 3-, 5- and 6-argument calls and keep the
  same never-rejects result shapes. With no client, `_call` resolves as before; with no
  action transport, the refusal lands in `false` / `{ok:false}` and is logged.
- The door-cover guard in `_act` (`neverToggles`) now reads `this.client`. This matters: a card
  shown a client alone could otherwise toggle a garage through the port.
- The music focus write (`frontend/set_user_data`) uses `writer.actions.callWS`.

**`hk-detail.js`:**
- This file's own panels (light, toggle, fan, cover, lock, garage, button, climate, media,
  sensor, state, binary, vacuum, valve, number, select, humidifier, water heater, alarm) are
  fed `panel.client = c`, with no host input. Their `_svc` and `_call` go through the port.
- The camera, group and custom-cards sheets, and panels other files define (automation, timer,
  event, person, weather), still read the host input. They keep the bridge until slices 7
  and 9.
- The accessory pane's saves go through `h.actions.callWS`. The pane converts whatever it is
  handed to a client at its entry, because the settings page still passes its host input.
  The saves are `hidden/also`, `hidden/set`, `accessory/set`, `hk_energy/device/set` and
  `section`, `config/entity_registry/update`, `board/set`, `accessory/order` and
  `board/favorite`.
- The notification banner's `hk_notify/mute` goes through `hkCards.actions`.

**Screensaver:**
- **`hk-saver.js`:** `hostNow()` is gone. `actionsNow()` is the current client's action port. It
  makes the switch write, the music buttons and the volume. `sendWS` sends the touch and black
  acknowledgements and the `call_service` queue/search. The panel is created with
  `client` only.
- **`hk-saver-panel.js`:** `o.hass()` is gone. `request`, `volSend`, `playQueue`
  (`hk_music/queue_play`), `playNode` and `playlist` use `actions()`.
- `hk-media.js` and `hk-music.js` no longer pass `hass:` to the panel.

**Card families.** Only their actions moved; their reads stay for slice 9:
- `hk-control.js`: thermostat and media control `_svc`, through `hkHostClient.from(this._hass).actions`.
- `hk-headers.js`: the lights-tonight off pill.
- `hk-music.js`: volume and up-next `get_queue`.
- `hk-library.js`: `hk_music/used`, and `call_service get_library` inside `_ws`.
- `hk-calendar.js`: event create, update and delete, and `calendar/color`.
- `hk-cameras.js`: `hk_tv/watching` only.

**Modules and settings:**
- `hk-timers.js`: `act()` (finish/start) uses the host's current client (the root element's in HA, as before).
- `modules/hk-settings.js`: `tablet/seen` and the `system_log.write` report.
- The settings panel's `press()` (`button.press`), the tablet check's fix (`tablet/act` or a
  service), and features' `clean_areas` dry run go through `actions()`.

The bridge (`hkHostClient.bridge`) still has callers, all of them card families that read the
host input:
- the thermostat and alarm keypad inside sheets;
- the camera, group and custom-cards sheets, and other files' panels;
- the screensaver's cards;
- the library card's first draw.

Slice 9 removes it. The saver's `hostNow()` is gone.

## Left in place (recorded)

| Where | What | Owner |
|---|---|---|
| `panels/hk-settings.js` `save()`/`ws()`/`featCall()` | every settings save (`this._hass.callWS`), including dynamic `DOMAIN + '/…'` types (`settings/set`, `board/set`, `tablet/add\|set\|remove`, `chip/save\|remove`, `accessory/*`, `hidden/*`, `setup/done`) | slice 11: route `save()` through `this.actions().callWS` and add the dynamic types to `WRITES` |
| `panels/hk-settings.js` direct | `lovelace/dashboards/create\|update\|delete`, `lovelace/config/save`, `config_entries/subentries/delete`, `input_select/create`, `image/delete`, image upload (`fetchWithAuth` POST), config flows (`callApi` POST/DELETE) | slice 11 |
| `panels/hk-settings-features.js` `P.featCall`/`P.ws` | alarm PIN, music presets and playlists, energy, notifications (`hk_notify/test`, `mute`, `item/*`) | slice 11 |
| `hk-cameras.js` | talk-back POST (`fetchWithAuth`), `hk_frontend/talk/live` from its audio worklet, WebRTC offer/candidate signaling | slice 7 |

Static guards (`tests/test_boundaries.py`) hold the line elsewhere:
- **No direct service calls:** no `callService(` in `web/hk` on anything but an action port.
- **No direct write messages:** no `callWS({type: <WRITE>})` on a non-action receiver,
  except in the two settings files above.
- **Mantel stays action-free:** the Mantel adapter defines no action transport.

## Behavior

Unchanged in HA. `test_actionport` pins this: its 13 Home Assistant scenarios record the full
argument list (and receiver) sent for each one, and that section passes unchanged against
`99be555`. To run it against `99be555`, the two control-card lines call the host directly, as
the old code did. The scenarios:
- light toggle (a tile tap);
- cover open (perform-action with a target);
- a door cover's toggle opening its sheet;
- the alarm keypad's code (`…, undefined, false`);
- lock;
- climate setpoint and media volume (control card);
- timer finish and timer start (the strip's pill);
- button press and scene (scene pills);
- music play (`…, undefined, false, true`, with its response);
- a `callWS` write (`hk_music/used`).

Stated changes:
- **Write messages through `client.callWS` are refused** (`read_only`). No shared code sends one
  there any more. The settings panel still uses its host input directly.
- **A client with no action transport** (a host that only reads) now has its actions *refused*
  (`commands_disabled`, logged by HkBase) instead of silently skipped. Nothing is sent either way.
  For example, the saver's switch write with a read-only client now records a pending echo and
  is refused. Before, it returned before writing.
- **The door guard reads the client.** Before, a card shown a client alone could not act at all.
- **Panels this file defines hold no host input** (`panel._hass === null`). They read and act
  through the client.
- **`hk-control` with no host input** now rejects (logged) instead of throwing synchronously.
- **Mantel:** refusals are now made by the client before any host object is touched. The toast
  and `Host.refused` are as before. `call_service` sent to the *read* path now answers
  `read_only` rather than `commands_disabled`.

## Tests

New `tests/test_actionport.js`, **71 assertions**:
- **The port:** frozen, two methods, no `callService` on the read surface. The HA adapter keeps
  arity, message identity and receiver.
- **Reads and writes are told apart:** every `WRITES` type is refused on the read path before
  the host, and `isWrite` agrees. A read still reaches the host.
- **A client with no transport:** `commands_disabled` from both methods, and the `refused` hook
  is told.
- **Home Assistant:** the 13 scenarios above, compared message for message, on the frontend's
  own object.
- **Mantel host contract:** the same scenarios with a Mantel-shaped client and adapter.
  - Nothing reaches the recorder or the snapshot.
  - Each action is refused once (12 actions).
  - The door guard still opens its sheet.
  - Music play's answer is `{ok:false, error:'commands disabled'}`.
  - HkBase logs `commands_disabled`.
- **A read-only card cannot toggle a garage:** the guard reads the client.

Updated fixtures:
- `test_saver`: the hub offers no `hass()`. The read-only case is a client without a transport;
  it starts, sends nothing, and is refused once.
- `test_detail_behaviour`: panels are shown the client alone. Controls act through its port and
  reach the same host.

Python (`tests/test_boundaries.py`, 4 new tests):
- no direct `callService` in `web/hk`;
- no write message sent off the port (settings files excepted);
- the Mantel adapter has no action transport, and the HA adapter does;
- the lint catches a violation.

Browser smoke (`tools/headless/client_smoke.py`), extended. With fictional `light.proof`:
- A tile's `_call` and `_act({action:'toggle'})` return `false`.
- The light sheet, fed the client alone, refuses `_svc('light','turn_on')`.
- A keypad-shaped `_callErr` answers `commands disabled`.
- **0 WebSocket frames** leave the page during these actions.
- `Host.refused` gains exactly `homeassistant.toggle` ×2, `light.turn_on` and
  `alarm_control_panel.alarm_disarm`.
- The read path refuses `call_service` (`read_only`). `actions.callWS` refuses it
  (`commands_disabled`).

The existing write guard, zero blocked writes, zero external requests and zero browser
exceptions are unchanged.

## Validation

- **Frontend JavaScript suites: 116** (115 before, plus `test_actionport`). 115 passed in the
  sequential run.
  - `test_weathersheet`'s "a day without hourly coverage" case fails between 22:00 and 24:00
    local time on `99be555` too. Its fixture's +1 h/+2 h hours cross midnight. The run was at
    23:06.
  - With the clock pinned to noon, it passes (5/5).
- **665 HA Python tests passed, 1 skipped** (unchanged).
- **151 Mantel tests passed** (147 + 4 boundary tests).
- **Isolated Chrome smoke passed** with the additions above.
- **Raw-host budget total 1,690 → 1,639 (−51):**

  | File | Before | After | Change |
  |---|---|---|---|
  | `hk-base.js` | 64 | 53 | −11 |
  | `hk-timers.js` | 14 | 2 | −12 |
  | `hk-music.js` | 39 | 34 | −5 |
  | `hk-saver-panel.js` | 10 | 5 | −5 |
  | `hk-settings.js` (module) | 18 | 14 | −4 |
  | `hk-saver.js` | 7 | 4 | −3 |
  | `hk-library.js` | 25 | 22 | −3 |
  | `hk-media.js` | 51 | 49 | −2 |
  | `hk-settings.js` (panel) | 195 | 193 | −2 |
  | `hk-cameras.js` | 74 | 73 | −1 |
  | `hk-control.js` | 23 | 22 | −1 |
  | `hk-headers.js` | 38 | 37 | −1 |
  | `hk-settings-features.js` | 13 | 12 | −1 |

  No budget grew.

## Exact continuation point

> **Superseded:** slice 7 is done. See [CONNECTIONS.md](CONNECTIONS.md#exact-continuation-point).

This slice is complete. Next is slice 7: move the raw connections (`hk-cameras.js` ready
listener and WebRTC signaling, `hk-weather.js`, `hk-saver-weather.js`'s forecast subscription,
`hk-radar.js`) to the client's subscription port. When that is done, route the camera's
talk-back and `talk/live` writes through `client.actions`.

The settings panel's saves (table above) belong to slice 11. The bridge goes away in slice 9,
once the card families listed above read `client()`. The legacy hub stays until slices 7–12
are done.
