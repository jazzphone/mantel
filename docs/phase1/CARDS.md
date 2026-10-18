# Phase 1, slice 9: the card families read `client`

Slice 9 moves every shared card from Home Assistant's frontend object onto the client.
Lovelace still hands each card that object, but only through one entry. From there the card
sees its client alone. Per the plan review (PLAN.md §0), the work runs in batches by card group,
and each batch is validated and pushed on its own.

## The pattern (pilot batch: tile, row, person, security, stat, control)

Every rule below is shown in the pilot's diff (`git log --grep "slice 9"`).

| Old code | New code | Notes |
|---|---|---|
| `this._hass` in an **HkBase** card | `this.client` | HkBase still keeps Lovelace's entry (`set hass`), and `this.client` is the host adapter's client for the current object (one per object, cached). Truthiness checks keep working (`null` with nothing). In a hot loop, read it once: `var c = this.client`. |
| `var h = this._hass` | `var h = this.client` | The local name doesn't matter, but `h`/`c`/`client` is fine. |
| A card that is **not** an HkBase (extends `HTMLElement`) with its own `set hass(h) {…}` / `get hass()` | Delete both. Define `_onClient(client) {…}` with the old body, reading `client` in place of the argument. Call **`window.hkHostClient.entry(Ctor)`** before `customElements.define`. | The host adapter is loaded at frontend bootstrap, before any card file (`__init__.py`'s `add_extra_js_url` list), so this works in files that can run before hk-base. The entry gives the card `this.client`, keeps the raw object for the `hass` getter (Lovelace and parent cards read it), and tells `hkCards.seen`. `_onClient` can get `null`; return early. |
| A parent setting a child card: `child.hass = this._hass` (hui-card, a nested card, a foreign card) | `window.hkHostClient.bridge(child, this.client)` | The adapter decides what the child gets. In HA, an HA-drawn card needs the frontend's object; an HK child takes it at its entry. |
| HA's state icon: `e.icon.hass = this._hass; e.icon.stateObj = st` | `var cl = this.client; if (cl) cl.bindStateIcon(e.icon, st);` | Mantel's adapter sets only the state. |
| Picker stubs passed to `register(…, function (hass) {…})` / `wireEditor` | `function (client) { … firstOf(client, …) }` | `register`/`wireEditor` now wrap the stub: Lovelace's object is converted to a client first. |
| A `static getStubConfig(hass)` defined on the class (or assigned directly) | `static getStubConfig(input) { var client = window.hkCards.asClient(input), …` | This is Lovelace's own entry, converted at the door. |
| Helper calls that pass the object on: `hkStats.daily(this._hass, …)`, `EP.tile(this._hass, …)`, `hkMusic.player(this._hass)`, `hkCards.tone(this, this._hass)`, `R.climateReading(this._hass, …)` | Pass `this.client` | The client has the same read surface (`states`, `entities`, `devices`, `areas`, `floors`, `services`, `config`, `locale`, `language`, `user`, `themes`, `callWS` reads, `callApi` GET, formatting). Helpers that accept either keep working. Rename a helper's parameter from `hass` to `client` when you touch it. |
| Comments that say "hass" | Say what is meant: "the client", "each state push", "Lovelace's object", "the frontend's object" | Comments count toward the budget, and stale ones mislead. |
| Tests that poke `card._hass = …` or `g._hass.sent` | `card.hass = …` (the entry), `g.hass.sent` (the getter), or a fake `{ client: … }` as `this` | Keep testing the behavior; don't reach into private fields. |

**Not on the client (don't invent them):** `hass.connection` (use `client.subscriptions`, slice 7),
`hass.callService` / write `callWS` (use `client.actions`, slice 6), `hass.panels` / `hass.localize`
/ `hass.connected`, and HA DOM (`hkShell`, slice 8). If a card needs one of these, stop and report
it, or add it to the client contract (`web/client/hk-client.js` `DATA`/`METHODS`, the HA port
`hosts/ha/frontend/hk-ha-client.js`, Mantel's `web/shim/mantel-client.js`) with a test.

**Behavior must not change in the HA build.** Watch for code that depends on the object's
**identity** (a new object means a redraw: `this._hass !== h`, `_hkSig`, `self.hass = self._hass`
re-renders). The client is one per object, so identity checks carry over one for one. A card that
re-feeds itself the raw object (`self.hass = self._hass`) should call `self.redraw()` (HkBase), or
re-run `_onClient(self.client)` (an entry card).

## Batches

Every batch ran in its own worktree, and the orchestrator merged them one at a time. After each
merge it ran the full validation (frontend suites, HA Python, Mantel, browser smoke) and pushed.

| Batch | Files | Before → after | Commit (merge) |
|---|---|---|---|
| Pilot | `hk-tile`, `hk-row`, `hk-person`, `hk-security`, `hk-stat`, `hk-control`, plus hk-base stubs/tone, adapter `entry` | 137 → 44 (hk-base) | `b2f8b4a` |
| hk-base helpers | editor (`ha-form`), nested cards (`hkSetClient`), `neverToggles`, hkMusic; adapters' `from()` returns a client as is | 44 → 14 | `9cb1ede` |
| Energy, calendar | `hk-energy`, `hk-calendar` | 231 → 0 | `b88c6c1` |
| Containers | `hk-chip`, `hk-room`, `hk-home`, `hk-layout` | 147 → 0 | `f0f9495` |
| Shared modules | `hk-sky`, `hk-stats`, `hk-idle`, `hk-menu`, `hk-charts`, `hk-settings` (module), `hk-radar`, `hk-tabbar`, `hk-notify`, `hk-saver*`, `hk-header`, `hk-timers`, `hk-kiosk` | 180 → 5 | `60aba1a` |
| Media family | `hk-media`, `hk-music`, `hk-library`, `hk-popup` | 110 → 0 | `52af8d0` |
| Shell and client contract | `hkShell.sidebarData()`, `keepAwake` checks the host's own flag, `HkBase.adopt()`, `client.connected` | 5 + 2 → 0 | `61c777b`, `1af5808` |
| Weather, cameras, headers, detail | `hk-weather`, `hk-cameras`, `hk-headers`, `hk-detail` | 198 → 2 → 0 | merged before `1af5808` |
| Slice 10 | `hk-strategy` (`docs/phase1/STRATEGY.md`) | 220 → 0 | `2594367` |
| Slice 11 | `panels/hk-settings*` (`docs/phase1/SETTINGS-PANEL.md`) | 152 → 0 | `3416e67` |
| Slice 12 | HkBase onto `hkHostClient.entry`, legacy hub removed, `hkShell.holdWrites` (sky lab), `web/home.js` and Mantel's `mantel-host.js` | 30 → 0 | `afa074c`, `7003913`, `24aff96` |

**Phase 1 total: 1,810 (start of slice 5) → 0.** `legacy-ha-access.json` has been removed.
`tests/test_boundaries.py` now fails on any `hass` or `_hass` in `web/` outside the Mantel adapter
(`web/shim/`); HA's adapter lives in `hosts/ha/frontend/`.

### What the contract gained in slice 9
- `hkHostClient.entry(Ctor)` is Lovelace's entry, provided by each host adapter. It keeps the
  host's object, hands the card `_onClient(client)` and `this.client`, and reports the object to
  `hkCards.seen`. HkBase uses it too.
- `hkHostClient.bridge(child, client)`: a child element gets what goes with a client. An element
  the host draws itself gets the host's object; an HK card turns that back into the client.
- `from(x)` returns `x` unchanged when it is already a client, so a client is never wrapped twice.
- `hkCards.asClient`, `HkBase.adopt(client)` (take a client before setConfig without drawing),
  and `hkSetClient` on nested cards.
- `client.connected`; `hkShell.sidebarData()` (the host's sidebar: user, panels, titles);
  `hkShell.keepAwake` skips the request when the host already keeps the page awake;
  `hkShell.holdWrites` (the sky lab's preview).
- `hkClient.WRITES` gained the 16 settings, tablet, chip and feature-settings writes that slice 11
  found.
- Tests hand a card an object with `hkGive(card, obj)` (`tests/give.js`, loaded by the prelude)
  or through the public `hass` getter, never through a private field.

## Validation (pilot, 2026-10-18)

117 frontend suites green, 665 HA Python passed (1 skipped), 155 Mantel, browser smoke passed.
Tests updated: `test_groupvol` (the entry's getter), `test_actionport` (the control card's
client), `test_wake` (signature with a fake client).

## Validation (after the last merge, 2026-10-18)

119 frontend suites green (2 new: `test_strategyclient`, `test_settingspanel`), 665 HA Python
passed (1 skipped), 164 Mantel tests, browser smoke passed (with the new `settings_panel` line).

## Exact continuation point

Phase 1 is complete. Next: the HACS checkpoint in a scratch HA (roadmap 7c, results in
`docs/phase1/TESTHA.md`); a live install on the house waits for Avery. Then Phase 2 (HK's own
shell), with `hk_core` extraction continuing feature by feature as features move (PLAN.md §0,
plan review).
