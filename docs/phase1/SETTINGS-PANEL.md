# Phase 1, slice 11: the HK Settings panel reads a client and saves through the action port

Completed locally on the slice branch. Production HK has not been edited or deployed.

Follows [`ACTIONS.md`](ACTIONS.md) (which listed the settings saves left for this slice) and
[`CONNECTIONS.md`](CONNECTIONS.md) (which left the panel's raw subscription and upload here).
The HK Settings panel (`web/hk/panels/`) now takes a client at its one entry and never sees
Home Assistant's frontend object again. Every read is on the client. Every save, config flow,
upload and tablet command goes through `client.actions`. The settings feed goes through
`client.subscriptions`.

Raw-host words in the panel files: **152 → 0**.

| File | Before | After |
|---|---|---|
| `web/hk/panels/hk-settings.js` | 137 | 0 |
| `web/hk/panels/hk-settings-features.js` | 8 | 0 |
| `web/hk/panels/hk-settings-model.js` | 7 | 0 |
| `web/hk/panels/hk-settings-kit.js` | 0 | 0 |

(`docs/phase1/legacy-ha-access.json` still lists older ceilings of 192 / 12 / 11. This slice
did not edit that file. The orchestrator lowers or removes those budgets when it merges.)

## The entry

HA's `panel_custom` sets `hass` (plus `narrow`, `route` and `panel`) on the panel element.
That setter is now the host adapter's entry: `window.hkHostClient.entry(HkSettingsPanel)` runs
just before `customElements.define`. The adapter is loaded at frontend bootstrap, before any
panel module.
- The panel's own `set hass` / `get hass` are gone. Its body moved to `_onClient(client)`:
  - the first client starts the page (`boot()`), as the first object did;
  - each client may change light/dark (`client.themes.darkMode`);
  - HA's `ha-menu-button` is handed what it needs through `hkHostClient.bridge`.
- The panel reads `this.client`. The adapter's getter hands the host its own object back.
- HA-drawn elements that need the frontend's object get it through
  `window.hkHostClient.bridge(el, client)`. These are the menu button, the hidden `ha-form`
  that loads the YAML editor, and `ha-yaml-editor`.
- The accessory pane (`hkDetail._.accessoryPane`) is now handed the client. It already
  converted whatever it was given at its own entry.

## What moved

**Reads → the client** (read path):
- states, entities, devices, areas, config and themes, everywhere in the three files;
- `hk_frontend/panel/get`, each feature's `<domain>/settings/get`, `hk_frontend/setup/check`,
  `lovelace/dashboards/list`, `energy/get_prefs` and `hk_music/settings/library`, all on
  `client.callWS`;
- the model's helpers `roomSensors(client, room)` and `radarPlanOf(r, client)`, whose
  parameters were renamed (they read `states`, `entities`, `devices` and `config`, as before).

**Subscription → `client.subscriptions`:**
- `hk_frontend/settings/subscribe` is already on the read allowlist (`hkClient.SUBSCRIPTIONS`).
- A client with no socket subscribes to nothing. Before, the check was "no connection".
- The single-flight guard and the late-arrival unsubscribe work as before.

**Saves → `client.actions`.** In HA, each one is the very message (or path and init) the old
code sent, on the frontend's own object.

| Save | Message / request | Through |
|---|---|---|
| `save()`: every settings change and feature command (`setH`, `setB`, `setT`, `featSet`, `featCall`, `ws`) | `hk_frontend/settings/set`, `board/set`, `tablet/add\|set\|remove`, `chip/save\|remove`, `accessory/into\|order\|page_order\|room_scenes`, `hidden/set\|also`, `config_entries/subentries/delete`; features: `hk_music/*`, `hk_tv/settings/set`, `hk_clean_areas/settings/set`, `hk_alarm_pin/*`, `hk_energy/*`, `hk_notify/*` (incl. `test`, `mute`) | `actions.callWS(msg)` |
| Rename a screen | `lovelace/dashboards/update`, then `hk_frontend/dashboard/titled` | `actions.callWS` |
| Delete a screen | `config_entries/subentries/delete`, (read `lovelace/dashboards/list`), `lovelace/dashboards/delete` | `actions.callWS` |
| Make a screen | `lovelace/dashboards/create`, `lovelace/config/save`, then its item's config flow | `actions.callWS`, `rest()` |
| Config flows (screen item, pop-up add/save, page add/save, the page-start probe) | `POST/DELETE /api/config/config_entries/subentries/flow[/<id>]` | `rest()` → `actions.request` |
| Live Camera dropdown | `input_select/create` | `actions.callWS` |
| Photo upload | `POST /api/image/upload` (multipart) | `actions.request(path, init)` |
| Photo forgotten | `image/delete` | `actions.callWS` |
| Tablet wake/dark | `hk_frontend/tablet/act` | `actions.callWS` |
| Setup Assistant done | `hk_frontend/setup/done` | `actions.callWS` |
| Kiosk buttons, a tablet check's fix, the cleaning dry run | (already on the port since slice 6) | `actions.callService` / `callWS` |

**`rest(method, path, body)`.** Config flows used HA's `callApi('POST'|'DELETE', …)`, and the
client's `callApi` is GET only. The panel now makes these calls through
`actions.request('/api/' + path, init)`, exactly as the frontend's own `callApi` builds them:
- the path under `/api/`;
- a JSON body only when there is one (`{}` counts), sent with
  `Content-Type: application/json;charset=UTF-8`;
- the answer read as JSON when it says so, otherwise as text;
- failures thrown as `{error, status_code, body}`, as `callApi` throws them:
  - an error answer is `Response error: <status>`;
  - a body that won't parse is `Unable to parse JSON response`;
  - a request that never arrived is `Request error`.

A `commands_disabled` refusal is passed on as it is. The HA adapter's `request` is the
frontend's `fetchWithAuth`, which adds the same `hassUrl` that `callApi` adds.

## Behavior preserved

No change in the HA build: the same messages, paths, inits and receivers. Stated differences:
- **The entry tells `hkCards.seen`** each new frontend object while the panel is open and
  `hk-base.js` has been loaded (the panel loads it for an accessory's settings). This is the
  same object `<home-assistant>` holds, and `hkCards.hass()` already prefers that. Nothing on
  the panel listens to the hub.
- **Mantel** (or any client with no action transport): every save is refused at the port
  (`commands_disabled`), nothing is sent, and `save()` shows its usual error state.
- **A client with no socket** opens no settings feed (before, the check was "no connection";
  the outcome is the same).

## Tests

- **New `test_settingspanel.js` (49 assertions):**
  - **The entry.** The page reads the adapter's client, and the host gets its own object back.
    The page boots once, dark follows the client, the menu button is bridged, and the panel
    defines no accessor of its own.
  - **Reads.** They go over the read path, with the same messages and receiver.
  - **The subscription.** It reaches the connection through the port. Its type is on the
    allowlist, and a client with no socket subscribes to nothing.
  - **Every save path in HA.** `setH`, `featCall`, `ws`, rename, delete, create (with its flow)
    and photo forget each send the exact message to the frontend's callWS, on its own object.
  - **`rest()`.** It is pinned against `callApi`'s request shape and its four answer and error
    cases.
  - **The photo upload.** It is `POST /api/image/upload` with the same form.
  - **Mantel.** Nothing reaches the host, and each write is refused once, by kind. Refused
    saves show the error state, a refused flow passes `commands_disabled` on, and a refused
    upload is no photo.
- **`test_settingsroutes.js`:** fixtures show the page a client (`show(pg, frontend)`) in place
  of poking `pg._hass`.
- **`tests/test_boundaries.py`:**
  - `WRITE_EXCEPTIONS` is now empty, so the write lint covers the settings files too.
  - New `test_http_writes_go_through_the_action_port` checks that `web/hk` has no
    `fetchWithAuth` and no non-GET `callApi`.
- **Browser smoke (`tools/headless/client_smoke.py`):** the panel files load in the Mantel
  page with Mantel's client. A settings save, a config flow step and a photo forgotten are
  refused at the port. `Host.refused` gains exactly those three, and 0 frames are sent.

## Validation

| Check | Result |
|---|---|
| HA frontend suites | **118, all green** (117 + `test_settingspanel`) |
| HA Python | 665 passed, 1 skipped |
| Mantel | 156 passed (155 + 1 boundary test) |
| Browser smoke | passed: new `settings_panel` line; 0 external requests, 0 exceptions, 0 blocked writes |

## Left / contract notes

- **Nothing is left in the panel files.** No raw-host words, no `fetchWithAuth`, no write
  `callApi`, no `connection`.
- **`hkClient.WRITES` is missing these dynamic types.** The panel sends them only through
  `client.actions.callWS`, so nothing depends on the list today. Adding them would make the
  read path refuse them too, as it refuses the listed writes:
  - `hk_frontend/settings/set`, `hk_frontend/tablet/add`, `hk_frontend/tablet/set`,
    `hk_frontend/tablet/remove`;
  - `hk_frontend/chip/save`, `hk_frontend/chip/remove`, `hk_frontend/dashboard/titled`,
    `hk_frontend/setup/done`;
  - `hk_frontend/accessory/into`, `hk_frontend/accessory/page_order`,
    `hk_frontend/accessory/room_scenes`;
  - `hk_music/settings/set`, `hk_tv/settings/set`, `hk_clean_areas/settings/set`,
    `hk_energy/settings/set`, `hk_notify/settings/set`.
- **Optional contract tidy-up.** An `actions.callApi(method, path, body)` on the HA adapter
  (`hass.callApi.apply`) would let `rest()` drop its copy of HA's REST answer handling. The
  copy is pinned by `test_settingspanel` until then.
- No subscription type needs adding to the allowlist.

## Exact continuation point

> **Superseded:** Phase 1 is complete. See [CARDS.md](CARDS.md#exact-continuation-point).

This slice is complete on its branch, not merged. Next:
1. The orchestrator merges this slice and lowers the three budgets in `legacy-ha-access.json`
   to 0 (or removes them), then adds the dynamic write types above to `hkClient.WRITES`.
2. The remaining Phase 1 slices: the card-family batches (slice 9), the strategy entry
   (slice 10), and the HA-adapter moves and legacy hub removal (slice 12).
