# Phase 1, slice 10: the dashboard strategy reads a client from its entry

`web/hk/cards/hk-strategy.js` builds HK's generated dashboards (the `custom:hk-dashboard`
dashboard strategy and the `custom:hk-room` view strategy). Lovelace still calls its static hooks
with the frontend's object. Each hook now converts that object to a client as it comes in, and
everything inside reads only the client.

Raw-host words in the file (`grep -cwE "_?hass" web/hk/cards/hk-strategy.js`): **220 → 0**,
comments included. Nothing was left unconverted. The budget in
`docs/phase1/legacy-ha-access.json` was not touched in this slice (another agent owns that file).
It can drop from 220 to 0 when this merges.

## The entry points

| Lovelace calls | Now |
|---|---|
| `HkDashboardStrategy.generate(config, input)` | `var client = clientOf(input)` first, before any await; every helper gets `client` |
| `HkRoomViewStrategy.generate(config, input)` | the same |
| `shouldRegenerate(config, oldInput, newInput)` (both classes) | `regChanged(config, clientOf(oldInput), clientOf(newInput))`, which compares `client.entities/devices/areas/floors` |

`clientOf(input)` is a small local helper. It returns a client unchanged (`hkClient.is`), passes
anything else through `window.hkHostClient.from`, and returns `null` when it gets nothing. It
does not use `hkCards.asClient` because hk-strategy.js is a bootstrap module
(`__init__.py`'s `add_extra_js_url` list, after `hk-client.js` and `hk-ha-client.js`), and
`shouldRegenerate` is synchronous. It can run before hk-base.js, a Lovelace resource, has loaded.
`generate` already waits for hk-base (`cardsReady`), but it converts its input before that wait.

**The exported helpers** (`window.hkStrategy`) are called by other cards (hk-room: `pageMembers`,
`climateMembers`, `batteryOf`; hk-detail: `rooms`, `pageMembers`; hk-saver: `saverBlock`), by
Mantel's `web/home.js` (`generate`) and by tests. They now go through
`viaClient(fn)`, which converts the first argument the same way. So `tileFor`, `roomCards`,
`climateMembers`, `pageMembers`, `batteryOf`, `groupOf`, `rooms` and `saverBlock` accept either a
client or a host object, and inside they only ever see a client.

## What changed inside

- Every internal helper's parameter was renamed from `hass` to `client`: `areaOf`, `hidden`,
  `tileFor`/`tileOf`, `nameOf`, `byArea`, `rooms`, `roomSection`, `roomCards`, `roomCameras`,
  `houseCameras`, `inventory`, `climateMembers`/`climateFound`, `pageMembers`, `categoryPages`,
  `cameraStrip`, `favTile`, `favorites`, `views`, `onlyPages`, `energyView`, `powerView`,
  `screensaverOf`, `saverBlock` and the rest. What they read is all on the client surface:
  `states`, `entities`, `devices`, `areas`, `floors`, `themes`, `config`, plus `user` (through
  `hkSettings.tablet(client)`, which reads `client.user.name`) and `subscriptions`.
- **`musicConfigured(client)`** now reads `client.subscriptions` directly. Slice 7's
  `hkHostClient.from(hass)` step inside it is gone, because the entry already did that.
- **The per-build caches** (`opts.__build.byArea` keyed on `memo.client`, `opts.__build.domains`
  keyed on `build.client`) are keyed on the client. There is one client per frontend object, so
  identity behaves exactly as it did with the object. `regView`'s WeakMap is keyed on the registry
  maps themselves, and the client hands back the same maps.
- **No writes.** The strategy sends no WebSocket write, service call or REST call (no `callWS`,
  `callApi`, `callService`, `lovelace/*` or `input_select/create`). Its only round trip is the
  `hk_music/subscribe` read, which is on the subscription allowlist. Its HA DOM access was already
  behind `hkShell` (slice 8).
- Comments were reworded to say "the client" or "the frontend's object". The file header now
  explains the entry rule.

## Behavior preserved, and how it is pinned

- **The existing suites pass unchanged:** `test_strategy` (269), `test_strategy_rebuild` (27),
  `test_strategyguard` (15). They still hand the strategy plain host objects, which the entry
  converts.
- **Old and new output are byte-identical.** As a one-off check (not committed), both suites
  were run against the pre-slice file and the new file, with every `hkStrategy`
  generate/room/rooms/roomCards/pageMembers/tileFor/saverBlock/shouldRegenerate result recorded.
  `test_strategy` gave 112 results (70 dashboards, with many settings, boards and options) and
  `test_strategy_rebuild` gave 3. Old and new matched exactly.
- **New suite `tests/test_strategyclient.js` (25 assertions)** pins the entry:
  - the frontend's object, the adapter's client made from it, and a client built from bare data
    by `hkClient.create` (no host adapter, no frontend object) all build the same dashboard,
    including the music pages. The music question goes once through each client's own
    subscription port and is then closed;
  - an adapter's client is used as it is, never wrapped a second time. Four of these assertions
    fail on the pre-slice file: its `musicConfigured` re-wrapped a client, so that client lost its
    subscription port and the build had no music pages;
  - a build never touches the frontend object's write paths (`callService`, `callWS`, `callApi`,
    `fetchWithAuth` are trapped);
  - the room view strategy gives the same page from all three;
  - `shouldRegenerate` gives the same answers from objects, from clients, or from one of each,
    and `true` when there is nothing to compare;
  - the exported helpers give the same answers from the object and from its client.
- **Mantel:** the offline browser smoke builds its page through `hkStrategy.generate({}, host.hass)`.
  Mantel's `hkHostClient.from` converts the snapshot, and the page comes up (`home_ready: true`, 0
  browser exceptions).

## Validation (2026-10-18)

118 frontend suites green (117 + `test_strategyclient`), 665 HA Python passed (1 skipped), 155
Mantel, browser smoke passed.

## Left / contract notes

- Nothing in hk-strategy.js was left unconverted, and the strategy needed nothing the client
  lacks. No contract change is needed.
- `web/home.js` still passes `host.hass` to `generate`. That is slice 12's file, and the entry
  converts it.

## Exact continuation point

> **Superseded:** Phase 1 is complete. See [CARDS.md](CARDS.md#exact-continuation-point).

hk-strategy.js is at 0. Next: lower its budget in `legacy-ha-access.json` (220 → 0) and record the
slice in PLAN.md's roadmap row 10 when this merges. Slice 11 (HK Settings panel) can follow the
same pattern: convert at the panel's entry with a local `clientOf`, rename parameters, and add an
object/client/bare-client equivalence suite.
