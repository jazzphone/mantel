# Phase 3 P3.5: HK settings in Mantel (2026-10-18)

PLAN §2 ("Settings live in a config entry … no history, no per-user scope"), §4 ("HK's own data in
SQLite: … settings (today's options + subentries, now versioned, with history)"), §5 (Owner/Admin
settings rights; an Adult has "no settings beyond their own") and §10 ("HK Settings: HK's own database
and endpoints, with history and per-user settings. One-time import.").

**Built and tested offline.** HK's settings now have a home in Mantel's SQLite database: versioned
documents, an append-only history, restore, checks on every write, the client API with the message
types and shapes the frontend already sends to HA, RBAC on every save, and the one-time import from
HA's config entry over the read path. The browser smoke now runs the real store with fictional
settings instead of standing in for `hk_frontend/panel/get`. No real Home Assistant was contacted, no
`~/.config/mantel/*` token was read, and house commands stay disabled.

| File | What |
|---|---|
| `hosts/server/mantel_server/settings_store.py` | `SettingsStore`, `ThinModel` / `HkCoreModel` / `load_model`, `SettingsService`, `rbac_may_configure`, `import_settings`, `register`, `import_cli` |
| `hosts/server/mantel_server/migrations/0003_settings.sql` | `settings_docs`, `settings_history` (append-only), `settings_import` |
| `hosts/server/mantel_server/readproxy.py` | `hk_frontend/panel/get` added to `READ_ALLOWED` as a **server-only** read (`SERVER_ONLY_READS`, `ReadProxy.read_hk_settings`) |
| `hosts/server/mantel_server/__main__.py` | `mantel-server import-settings` |
| `tests/test_settings_store.py` | 73 tests (below) |
| `tests/test_proof1_guards.py` | the pinned read allowlist gains `hk_frontend/panel/get` |
| `tools/headless/client_smoke.py` | the settings reads and saves go through the real store |

Not touched: `server.py`, `docs/PLAN.md`, `hosts/ha/`, `hk_core/`, `web/`.

## Schema (`0003_settings.sql`)

A settings **document** is one JSON object addressed by `(scope, key)`:

| Scope | Keys | Holds (from HA's `hk_frontend/panel/get`) |
|---|---|---|
| `house` | `settings` | the house-wide settings, section by section (`S.merged(entry.options)`: `look`, `sky`, `weather`, `menu`, `rooms`, `counts`, …) |
| `house` | `setup` | `{"setup_done": bool}` |
| `house` | `popups`, `custom_pages`, `custom_chips` | `{"items": [...]}` (the subentries of those types; `used_on` is worked out on read) |
| `house` | `accessories` | each accessory's settings and the rooms' tile order (`.storage/hk_frontend.accessories` in HA) |
| `house` | `catalog` | the model's choice lists HK Settings lays its controls out with (`choices`, `presets`, `chip_kinds`, `page_kinds`, `scene_pages`, `shelves`). Read-only; replaced by hk_core's constants when its model lands |
| `board` | dashboard url path | one screen's settings (a `dashboard` subentry, resolved) |
| `tablet` | tablet id | one wall tablet's settings (a `tablet` subentry; HA's run-time `parts` dropped) |
| `user` | `users.id` | one person's own values (PLAN §5 "their own"): sections `look` and `sky` for now, lying over the house's in that person's feed |

Tables:

* `settings_docs (scope, key, version, body, updated, updated_by)`: the current version. `scope` is
  CHECKed; `version` starts at 1 and goes up by one per change that changes something (an identical
  body makes no version; key order is kept, a reorder alone is no change).
* `settings_history (scope, key, version, body, diff, action, message, actor, actor_role, device,
  source, created)`, `UNIQUE (scope, key, version)`. Every version with **who** (user id, or
  `device:<id>`, or a label such as `cli`), their role, the enrolled device, **when**, the client
  **message** type that made it, the **diff** (`{"added": {path: new}, "removed": {path: old},
  "changed": {path: [old, new]}}`, dotted paths, lists compared whole) and the whole body. `action` is
  `set`, `restore` or `import`. Triggers refuse every UPDATE and DELETE (append-only).
* `settings_import (id = 1, source, read, checksum, written, skipped, actor, created)`: the one-time
  import, at most one row ever.

`SettingsStore.write([...])` writes several documents in one transaction (all or nothing; a chip
removed also leaves every screen that listed it, in the same transaction), with an optional
`expect={(scope, key): version}` check (`conflict`). Limits: 2 MB per document, 200 kB per changed
value, depth 16, 200 changes per call.

## Client API

Same message types and shapes the frontend already uses with HA. They reach Mantel two ways, both
installed by `settings_store.register(app, hub, hooks)` (P3.4's pattern):

### Reads: `app["read_routes"]` (the page's `read` / `read_subscribe` frames, via `readproxy.register`)

| Message (inside `read`/`read_subscribe`) | Answer | Who |
|---|---|---|
| `{"type": "hk_frontend/settings/subscribe"}` | result `null`, then an event with the whole payload now and after every change, as HA's feed (`settings.as_client`): `configured`, every house section except `counts`, `boards`, `tablet_items`, `accessories`, `extras`, `popups`, `custom_pages`, `custom_chips`, `kinds`, `added` (which HK features are added, in HA's order) and `energy` (the Energy page's plan, `null` without `feature:energy`), both from the feature host ([FEATURE-PARITY.md](../phase4/FEATURE-PARITY.md)), plus `personal` (the person's own values, already laid over the sections) | any signed-in subject (as in HA: a wall tablet reads it) |
| `{"type": "hk_frontend/panel/get"}` | panel.py's shape: `entry_id` (`"mantel"`), `settings`, `boards`, `tablets`, `popups`, `custom_pages` (with `used_on`), `custom_chips`, `accessories`, `setup_done`, the catalog's lists, plus `versions` (`"scope/key": version`) and `features` (HA's shape: every feature installed, an entry for each one added; from the feature host). HA's other run-time parts (`dashboards`, `kiosk_devices`, `tablet_suggest`, `screensavers`, `counts`, `users`, `thirdparty`, `integration`, `kinds`, `suggest`) are empty until Mantel has them | `configure` on `settings` (HA: `require_admin`) |
| `{"type": "mantel/settings/get", "scope", "key"}` | `{scope, key, version, body}` | `configure` on that scope |
| `{"type": "mantel/settings/history", "scope", "key", "limit"?, "bodies"?}` | `{scope, key, version, history: [{version, action, message, actor, actor_role, device, source, created, diff, body?}]}` newest first, at most 200 | `configure` on that scope |

A refused read answers `{"type": "read_result", "id", "error": {"code": "forbidden"}}`.

### Saves: `app["ws_handlers"]["settings_write"]`

```
-> {"type": "settings_write", "id": 7, "msg": {"type": "hk_frontend/settings/set", "changes": {"look.glass": "clear"}}}
<- {"type": "settings_result", "id": 7, "result": {"settings": {...}}}
<- {"type": "settings_result", "id": 7, "error": {"code": "invalid_format", "message": "{\"look.glass\": \"text\"}"}}
```

`msg` is the save exactly as the page sends it to HA today (`client.actions.callWS(msg)`), with the
keys HA's schema allows and nothing else. Results and refusals are HA's:

| Save | Result | Scope (RBAC) |
|---|---|---|
| `hk_frontend/settings/set {changes}` | `{"settings": <house sections>}` | `house/settings` |
| `hk_frontend/calendar/color {key, color?}` | `{"event_colors": {...}}` | `house/settings` (HA lets any user; Mantel asks `settings`: see below) |
| `hk_frontend/board/set {dashboard, changes}` | `{"board": {...}}`; `no_item` if the screen has no document | `board/<path>` |
| `hk_frontend/tablet/set {tablet, changes}` | `{"tablet": {...}}`; `no_tablet` | `tablet/<id>` |
| `hk_frontend/setup/done {done}` | `{"setup_done": bool}` | `house/setup` |
| `hk_frontend/chip/save {name, card, key?, after?}` | `{"key", "custom_chips"}` (key from the name, unique; `chip_gone` for an unknown key) | `house/custom_chips` |
| `hk_frontend/chip/remove {key}` | `{"custom_chips"}`; also removed from every screen's `chips` / `chips_custom` | `house/custom_chips` (+ each board) |
| `mantel/settings/user/set {changes, user_id?}` | `{"user_id", "settings"}`; `null` takes a value away; `no_user` | `user/<id>` (own: `profile`) |
| `mantel/settings/restore {scope, key, version}` | `{scope, key, version, restored_from, changed}`; `no_version` | that scope |

Field refusals are `invalid_format` with the `{path: reason}` map as the message, as HA sends them,
so the page places them on its fields. Nothing is written unless every change in the call is good.

**Settings saves are HK's own data, not house commands.** They are allowed while house commands are
disabled (`commands.enabled = false`): `settings_write` is not a command type (`server.classify`
answers `unknown` for it, pinned by a test), and nothing a settings save does reaches Home Assistant
or a device. Saves that would change Home Assistant are refused, whatever the role:

* `ha_write`: `call_service`, calendar event CRUD, `config/entity_registry/update`,
  `config_entries/subentries/delete`, `frontend/set_user_data`, `image/delete`, `input_select/create`
  (an HA helper), `lovelace/*` (HA dashboards), `hk_frontend/tablet/add` / `remove` (an HA item and
  device), `tablet/act`, `screensaver/black` / `touch`, `talk/live`, `dashboard/titled`,
  `tablet/seen`, `hk_alarm_pin/add` / `remove`, `hk_music/queue_play`, `hk_music/used`,
  `hk_notify/test`, `hk_tv/watching`.
* `not_yet`: HK data Mantel does not hold yet: accessories and hidden accessories
  (`hk_frontend/accessory/*`, `hidden/*`, `board/favorite`), and every feature's settings
  (`hk_music/*`, `hk_notify/*`, `hk_energy/*`, `hk_tv/settings/set`, `hk_clean_areas/settings/set`,
  `hk_alarm_pin/settings/set`): those features still run inside Home Assistant.

`SAVE_KINDS` classifies every type in `hkClient.WRITES` (a test reads `web/client/hk-client.js`).

### Hidden Accessories: `hk_frontend/hidden/get` (2026-10-18)

The accessory sheet's Where It Shows (`hk-detail.js` `wherePane`) asks `hk_frontend/hidden/get
{entity_ids: [id]}`; HK Settings' Hidden Accessories page reads the same snapshot. In HA it is
`hiding.snapshot` (`require_admin`). **It is not a setting of its own and needs no import change:**
every stored part already came over in the one-time import, where it always lived:

| Place | Stored in (Mantel document) |
|---|---|
| everywhere (and whole devices, whole rooms) | `house/settings` `generated.exclude_entities` (`exclude_devices`, `exclude_areas`) |
| home, room | `house/accessories` `entities.<id>.home` / `.room` = `false` |
| a kind (Climate, Lights, ...) | `house/settings` `counts.<kind>.exclude` (Also count: `.include`) |
| the old Include in Status off | `house/accessories` `entities.<id>.status` = `false` |

The rest (what each kind finds by itself, what a room shows) is worked out from the house.
`hosts/server/mantel_server/hidden.py` ports HA's `kinds.candidates` / `automatic` / `suggest` and
`hiding.snapshot` line for line over the hub's StateStore and Registry, with hk_core's `KINDS`.
`readproxy.register` answers the read from it (`app["read_routes"]`), never from HA:

* **RBAC:** `configure` on `house/settings` (the same as `hk_frontend/panel/get`; Owner and Admin with
  the default roles), else `forbidden`. Then every entity the subject may not `view` is taken out of
  `can`, `off`, `added`, `also` and `everywhere`, and a hidden device or room is named only when it
  holds an entity the subject may view. An asked-about entity the subject may not view gets
  `can: []` and nothing else, which is exactly what a nonexistent one gets.
* **Checked on the scratch HA (2026-10-18):** against HA's own `hk_frontend/hidden/get` over the same
  states, registries and settings, the whole-house answer and an answer for 60 asked-about entities
  (plus a nonexistent one) were identical.
* **Not here:** `hk_frontend/panel/get`'s own `hidden` (and `kinds`) are still empty; HK Settings'
  Hidden Accessories page reads them from there. Filling them from `hidden.py` (filtered per person
  the same way) is a small follow-up. The saves (`hidden/set`, `hidden/also`) stay `not_yet`.

## History and restore

Every version is a history row with the whole body, so any version can be read back
(`mantel/settings/history` with `bodies: true`) or restored: `mantel/settings/restore` writes a **new**
version whose body is the old one's (`action = 'restore'`, `source = 'v<N>'`). Restoring to what the
document already is makes no version. The import's documents are version 1 (`action = 'import'`,
`source = 'ha:<entry id>'`, `message = 'hk_frontend/panel/get'`). The catalog is never restored or
written by a client.

## RBAC

Every save and every read but the feed asks the hook `may_configure(identity, Scope(kind, key))`
(sync or async; only exactly `True` allows; deny by default; a hook that raises refuses).
`rbac_may_configure(policy=None, *, rbac_store=None, clock)` is the hook over P3.2's engine: action
`configure`, feature `profile` for a person's **own** `user/<their id>` scope and `settings` for
everything else. With the default roles:

| Subject | House, screens, tablets, catalog | Own user scope | Someone else's |
|---|---|---|---|
| Owner, Admin | yes | yes | yes |
| Adult, Child | no | yes | no |
| Guest, Service | no | no | no |
| Wall tablet alone | no | n/a | no |
| Adult at a wall tablet | no | no (person ∩ tablet: the tablet has no `profile`) | no |

The identity is P3.1's `Identity` (or a `{"user_id", "role", "device_id", "device_role", "door"}`
dict). Each history row records the user, their role and the device.

## Import from HA

`import_settings(store, fetch, *, actor)`:

1. If `settings_import` has its row, return `{"imported": false, "already": <that row>}` without
   reading HA (idempotent; two imports at once write once: the second hits the single-row key).
2. `fetch()` reads HA **once**: `ReadProxy.read_hk_settings()` sends `hk_frontend/panel/get`, the one
   read HK Settings itself makes (HA requires an admin token for it). Nothing is ever sent to HA
   that changes anything.
3. The answer becomes documents (`docs_from_panel`); anything not HK settings (`not_hk_settings`)
   writes nothing.
4. Each document that does not exist yet is written as version 1; one that exists (an edit made in
   Mantel first) is left alone and listed in `skipped`. The import row records the source
   (`ha:<entry id>`), the read, a SHA-256 of HA's answer, what was written and skipped, who, when.
5. **The feature items too** (2026-10-18, `read_features`; [FEATURE-PARITY.md](../phase4/FEATURE-PARITY.md)):
   which HK features HA has added (panel/get's `features`) and, for each of Notifications, Clean Areas,
   Energy and Live TV that HA has, its settings (one server-only `<id>/settings/get` read each) become
   `house/mantel_features` (version 1, like the rest). A feature read that fails leaves that one
   document out (`features_error` in the answer) and `POST /api/features/import` reads them again on
   their own, which is also how a house imported before this existed gets its features.

Ways to run it:

* CLI: `mantel-server import-settings [--data-dir …] [--ha-url …] [--token-file …]` (prints what it
  wrote; a second run says when the first one ran and changes nothing).
* REST: `POST /api/settings/import` (Owner only; CSRF as every state-changing `/api/` call); `GET
  /api/settings/import` (Owner/Admin) returns `{"import": <row or null>, "empty": bool}`. After an
  import every connected feed gets the new payload.

**The read-proxy allowlist.** `hk_frontend/panel/get` is in `READ_ALLOWED` (no extra keys) with a
rule in `RULES`, but it is in `SERVER_ONLY_READS`: `ReadProxy.request` refuses it unless Mantel
itself asks (`server_read=True`, only `read_hk_settings` does), and `FilteredReads` refuses it for any
page. So neither the RBAC-filtered path nor server.py's Phase 0 read path can carry a page's
`panel/get` to HA; the page's `panel/get` is answered by the store's route. Tested against a fake HA:
no frame (not even a connection) for a page's attempt; exactly `auth` + `hk_frontend/panel/get` for
the import.

## How it plugs into hk_core's settings model

`hk_core/settings/` did not exist when this slice started (another agent is moving `settings.py` /
`settings_api.py` there), so writes go through `ThinModel`, a deliberately thin and strict stand-in:

* house changes are `section.key` paths in a known section (`HOUSE_SECTIONS`, settings.py's
  `DEFAULTS`); a key must be one the stored section already has (after the import that is every
  default key); the value keeps the stored value's kind (bool, number, text, list, object; null
  clears), and an entity id stays an entity id;
* screen and tablet changes are flat keys the document already has; a tablet's name is 1 to 40
  characters; `uid` is never changed;
* the paths that need the real model's merge rules (`sky.reset`, the flat-colour and image-look
  patches) are refused as `needs_model` rather than stored wrongly; the HA integration's own options
  (`sidebar`, `hk_panel`, `files_folder`) as `ha_only`.

`load_model()` switches to `HkCoreModel` as soon as `hk_core.settings` is importable **and** has
`apply_house`, `apply_board`, `apply_tablet` and `merged` (an incomplete module keeps the thin model,
logged). `HkCoreModel` calls them as settings_api.py has them today: the stored house document is the
merged settings, so it is passed as `{"dashboard": doc}` and merged back; board and tablet documents
are passed as the subentry data. Its domain checks (choices, entity domains, dates, the patches,
`S.board()` / `S.tablet()` normalisation) then apply unchanged, with the field codes the page already
words. `check_document` (import and restore) stays size/shape only. If hk_core's API differs, only
`HkCoreModel` changes.

## Smoke

`tools/headless/client_smoke.py` no longer answers `hk_frontend/panel/get` or the settings feed
itself. It registers the settings store on the app, imports a fictional HA answer
(`FICTIONAL_HA_SETTINGS`: one custom page, one screen, `weather.place = "Offline before"`), and its
`OfflineReads` forwards the two settings reads to `app["read_routes"]` as the signed-in fictional
Owner (what P3.7's read dispatch will do). The two feed updates it checks are now **real saves**
through the store (`hk_frontend/settings/set` `weather.place`, `hk_frontend/board/set` `menu:
tabbar`), and HK Settings' YAML page re-read after Save is answered by the store. Music and the other
reads stay fictional in `OfflineReads`. ~~The page's own saves are still refused at the client's action
port: the frontend does not send `settings_write` yet.~~ Since the page-saves follow-up (below), HK
Settings' save in the Mantel page lands in the store.

## Update: saves from the page (follow-up, 2026-10-18)

The frontend now sends HK's settings saves to the store:

* `web/shim/hub.js` `write(msg)` sends `{type: "settings_write", id, msg}` and resolves on
  `settings_result` (rejects with its `{code, message}`; a lost socket rejects waiting saves with
  `unavailable`, none is re-sent).
* `web/shim/mantel-client.js` routes exactly `SETTINGS_SAVES` (`hk_frontend/settings/set`, `board/set`,
  `tablet/set`, `setup/done`, `calendar/color`, `chip/save`, `chip/remove`, the same list as
  `settings_store.SETTINGS_SAVES`, pinned by `tests/test_gateway_catalog.py`) through `hub.write`:
  * **commands off** (the default): the port's only action is that save (`savesOn`); every other
    write and every service call is refused at the port, sending nothing, exactly as before;
  * **commands on**: `actions.callWS` sends a settings save to the store and every other write to the
    gateway (a settings save never becomes a house command, so it never reaches HA's hk_frontend).
* A refused save comes back as the store's error (`invalid_format` with the field map, `forbidden`,
  `no_item`, …) on the promise, which HK Settings already words; `forbidden` also raises the denied
  toast.
* `tests/test_boundaries.py` now pins that the commands-off port has a save and nothing else (no
  `callService` / `request` / `liveSocket`, no `hub.command`).
* `tools/headless/client_smoke.py`: HK Settings' `actions().callWS({type: "hk_frontend/settings/set",
  changes: {"look.glass": "clear"}})` in the Mantel page returns the store's result, the feed shows it,
  the store's document and history (`message`, `actor_role: owner`) have it; a bad value comes back
  `invalid_format`; a config flow step, a photo forgotten and two house commands (`call_service`,
  `light.turn_on`) are still refused at the port; HA's state connection sent 0 frames and there is no
  command connection (commands off). The page's socket guard now allows `settings_write` (but never one
  wrapping `call_service`).
* `tools/headless/gateway_page_check.py` (commands on): the same save goes to the store, not to the
  fake command connection.
* `tools/e2e/gateway_e2e.py`: an Owner's save through the socket persists (read back with
  `mantel/settings/get`), nothing is sent to HA; a Child's house save is `forbidden` and changes nothing.

Still open from the list below: the config-flow saves (custom pages, pop-ups, new screens) need
Mantel endpoints of their own; `calendar/color` for non-admins; accessories and feature settings.

## Tests

`~/.venvs/mantel/bin/python -m pytest -q`: **1265 passed** (1192 before this slice; 73 new, plus the
pinned-allowlist change). `tests/test_settings_store.py`:

* migration and append-only history (UPDATE/DELETE refused; scope CHECK);
* versions, no version for an unchanged body, diff, actor/role/device/time/message; key order kept;
  restore as a new version (and none when already that body; `no_version`); multi-document
  all-or-nothing, `conflict`, `too_big`;
* the thin model: 18 house cases (kinds, entity ids, unknown sections/keys, `ha_only`, `needs_model`,
  all-or-nothing, size, NaN), screens, tablets, personal values, chips; the hk_core plug (complete
  module used, incomplete module refused);
* RBAC: 16 subject × scope cases over P3.2's engine; Owner/Admin house-wide, Adult only their own,
  Guest and a lone tablet nothing, a person at a tablet the intersection; saves refused with
  `forbidden` and nothing written;
* saves: HA-shaped results and `invalid_format` field maps, `no_item`, `no_tablet`, setup, calendar
  colours, chips saved and removed from every screen, history/get/restore through the API;
* every `hkClient.WRITES` type classified; `ha_write` / `not_yet` / `unknown_type` refusals;
* the feed: the payload's shape, an event to every subscriber after a save, a personal save only to
  that person, no event for an unchanged save, none after unsubscribing; `panel/get`'s shape and
  rights;
* the read proxy: `panel/get` on the allowlist as server-only; a page's attempt sends nothing to the
  fake HA by either path; `read_hk_settings` sends exactly that read;
* the import from a fake HA: version 1 with source and message, one read and nothing written to HA,
  run-time parts not kept; idempotent (HA not asked again; later edits kept); existing documents
  skipped; non-settings answers refused; two at once write once; the CLI against a fake HA on a
  thread (imported, then "already imported", missing token file → 2);
* wired as P3.7 will wire it (`readproxy.register` + `settings_store.register` on one app): the
  page's `panel/get`, feed, history read and `settings_write` saves go to the store and never to HA;
  the feed follows a save; refusals come back as `settings_result` errors; closing the socket ends
  the feed; `settings_write` is not a command;
* REST import: Owner only (Admin 403, Adult 403 on status), CSRF required, idempotent (HA read once).

`tools/headless/client_smoke.py` passes (0 external requests, 0 browser exceptions,
`commands_disabled`). Its Chrome uses the fixed port 9337, so run it alone (a run that overlapped
another worktree's smoke failed with "Home did not load" before reaching any settings code).

## Not done here (decisions for Avery)

* **`hk_frontend/calendar/color`** is open to every user in HA (it changes only
  `calendar.event_colors`). Mantel asks `configure` on `settings`, so an Adult's colour change is
  refused. Either give Adults a feature grant or route it to a per-user scope.
* **What "their own" settings are.** `USER_SECTIONS = ("look", "sky")` (appearance). Which other
  settings a person may set for themselves is a product choice.
* **Accessories, hidden accessories and feature settings** stay HA's (`not_yet`) until their engines
  move; the store already holds the imported accessories document, so serving them is a small step.

## Exact continuation point

1. **P3.7 wiring** (`server.py`, not edited here): after `readproxy.register(app, hub, hooks)`, call
   `settings_store.register(app, hub, settings_store.SettingsHooks(may_configure=
   settings_store.rbac_may_configure(rbac_store=app["rbac"]), fetch_ha_settings=None))`. The default
   import fetch uses `hub.readproxy.read_hk_settings()`. `ClientSession` dispatches `settings_write`
   to `app["ws_handlers"]` like the other handlers (classify already lets it through) with
   `Ctx(identity=<P3.1 Identity>)`, and the page's `read`/`read_subscribe` go through
   `readproxy.register`'s handlers so `app["read_routes"]` answers the settings reads. Retiring
   `ClientSession.read` also retires the last path that knew nothing of the store.
2. ~~**Frontend**: `hub.js` `write(msg)` and the client port's settings saves~~ done (see "Update:
   saves from the page" above; the list is pinned against `SETTINGS_SAVES` by a test rather than
   exported as JSON). Still open: the panel's config-flow saves (custom pages, pop-ups, new screens)
   need Mantel endpoints of their own (PLAN §3: "rewritten as plain Mantel Server endpoints").
3. **hk_core's model**: when `hk_core/settings/` lands with `apply_house` / `apply_board` /
   `apply_tablet` / `merged`, `load_model()` picks it up; check `HkCoreModel` against its real
   signatures and swap the catalog document for its constants.
4. **First run on the real house** (Avery, at cutover): `mantel-server import-settings` with Mantel's
   HA token (an admin user's), then compare HK Settings in Mantel with HA's.
