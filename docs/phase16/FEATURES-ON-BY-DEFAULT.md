# Phase 16: features on by default (plan, 2026-11-03)

**Status: built and released 2026-11-03: Mantel 0.1.121 with HK Frontend 1.41.0, on the house (Music turned on by itself there). Every decision answered by the owner on 2026-11-03 (all recommendations accepted).**

## The ask (the owner, earlier; approved, not built)

> "Features on by default: turn a feature on automatically when the house has what it needs (a tuner, a vacuum with
> room maps, Energy, Music Assistant)."

Behind it is what the owner said on 2026-11-02 when Mantel's features got their own switch: "I would hate for a user
to set up Mantel and not have access to enable the features it has." A switch is the floor. The next step is that a
house with a tuner doesn't need to know Live TV exists before it shows up.

## The answer, in short

One small **needs check** in `hk_core` says, from plain facts about the house, whether a feature has what it needs.
A **runner** in the feature host gathers those facts (when Mantel starts, when Home Assistant's registries load or
change, when a connection is made, and every 5 minutes), and when a need has held for two minutes it turns the feature
on **once**, the way a person would: through the feature settings, checked, written to the settings history and the
audit log, and told to the Owner.

- **Four features may turn on by themselves:** Music (Music Assistant connected), Clean Areas (a vacuum with a room
  map), Energy (Home Assistant's Energy settings have a grid meter or devices) and Live TV (a tuner that answers, and a
  way to serve it).
- **Once means once.** A feature a person turned off, or that Mantel already turned on, is never turned on again. A
  stored "decided" marker says so, and the settings history backs it up.
- **It sends no command.** Turning a feature on changes Mantel's own settings, nothing in the house. Rule 3 is
  untouched.
- **The Owner is told** three ways: a note on the feature's row (Advanced → Features), the audit and settings history,
  and an Info alert `feature.enabled` through phase 14's alert center.
- **One switch** ("Turn Features On Automatically", Advanced → Features, on) stops all of it.

## What it doesn't do

- **Turn a feature off.** A need that goes away (Music Assistant removed, the vacuum gone) changes nothing. Off is a
  person's choice.
- **Turn on a feature that acts on the house or guards it:** Alarm PIN (a PIN is the Owner's to choose), Notifications
  (they are choices, not a need), the Sleep Screen, Wall Tablets' alerts and restarts, the linked backlight, and Allow
  Control of the House. Setup Assistant already walks the Owner to the Alarm PIN when the house has an alarm.
- **Change a screen.** Stored screens (imported, edited or made in Edit mode) and Home Assistant dashboards are never
  touched. The generated pages follow the features on their own (see "Screens and dashboards").
- **Search the network.** No broadcast, no scan. Mantel runs in a container in all three installs, where a broadcast
  doesn't leave the container (`packaging/compose/compose.yaml` has no host networking). It uses only what Home
  Assistant already told it, or what the Owner typed.
- **Reach HK Frontend inside Home Assistant.** See decision 14.

## What exists today (read for this plan)

Every feature is a **piece** of one settings document, `house/mantel_features`
(`hosts/server/mantel_server/features/settings.py`: `PIECES`, `DEFAULTS`, `check_settings`). All are off by default.
`FeatureHost.on(piece)` reads `enabled` (`features/host.py`). A person turns one on through `<id>/feature/set`
(`feature_pages.FeaturePages.feature_set`, Add and Remove on the feature's page, and the switch in Advanced → Features,
`web/hk/panels/hk-settings-features.js` `featureList`), or the Owner's `PUT /api/features/settings`. Each write is a new
version in the settings store with the actor, the message and the diff (`FeatureHost.write_doc`).

| Piece | What turning it on does | What it needs | Today |
|---|---|---|---|
| `music` | Music is "added": its page and cards show; Mantel's engine runs once `house/music` exists (`music.MusicHost.active`) | Mantel's own Music Assistant connection (`connections.live_ma`) | Owner adds it |
| `clean_areas` | The area picker and `clean_areas_run` (a person's request; commands off sends nothing) | A vacuum with a room map (`hk_core.clean_areas.coverage`, `how == "map"`) | Owner adds it |
| `energy` | The Energy page; the plan is worked out from Home Assistant's Energy settings, read-only, at most every 5 minutes (`refresh_energy`) | Energy settings with a grid meter or devices (`energy/get_prefs`) | Owner adds it |
| `live_tv` | The tuner's lineup and the guide are read every 30 minutes; the page and channel cameras show (`live_tv.py`) | A tuner address, and a way to serve it: Mantel's own go2rtc (`cfg.go2rtc_url`), or Mantel Link with `live_tv` once Mantel runs the house | Owner adds it, **except** `FeatureHost._live_tv_once`: the first start with go2rtc and a tuner address turns it on once (`go2rtc_once`) |
| `alarm_pin` | The Alarm PIN page | An `alarm_control_panel`, and a PIN the Owner sets | Owner adds it |
| `notifications` | Banners for the items the Owner chooses | Nothing; items are choices | Owner adds it |
| `sleep`, `tablets`, `linked` | Engines that act on tablets (every action a gateway command, refused and audited as `would` with commands off) | Tablets moved to Mantel | Owner, per tablet |

`_live_tv_once` is the model: a once-only turn-on with a stored marker. This phase makes it general and moves it into
the same runner.

What the screens do with it: the settings feed's `added` list (`FeatureHost.client_added`, `_sync_client`) reaches every
page, and `window.hkCards.added(kind)` gates the generated pages (`web/hk/cards/hk-strategy.js`: `added('energy')`,
`added('live_tv')`, `added('clean_areas')`). So a piece turned on shows up on the next feed, with no reload of the app.

## The design

### The needs check (`hk_core/needs.py`, pure)

Rule 2: a feature's decision lives in `hk_core`. The module takes plain data and returns words, so it is tested once
(`tests/test_hk_core_needs.py`) and imports only itself (`tests/test_boundaries.py`). It touches neither the house port
nor the network.

```python
@dataclass(frozen=True)
class Facts:
    ready: bool                    # Home Assistant's states and registries are loaded; False: nothing below means "absent"
    ma_connected: bool | None      # Mantel's own Music Assistant connection is live (None: not set up)
    vacuums: list[dict] | None     # hk_core.clean_areas.coverage(house, {}) rows
    energy_prefs: Mapping | None   # HA's energy/get_prefs answer; {} when none saved; None when it couldn't be read
    tuner: str                     # the address to try: the saved one, else the one found in the registry
    tuner_seen: bool               # the registry has an HDHomeRun at all (platform or integration "hdhomerun")
    tuner_answers: bool | None     # lineup.json answered with channels (None: not asked)
    tv_serves: str                 # "mantel" | "link" | "ha" | "none": `MantelLiveTv.mode()` as if the piece were on; passed in

@dataclass(frozen=True)
class Need:
    piece: str
    met: bool | None               # None: can't tell yet (never "not met")
    why: str                       # short words for the Owner: "Music Assistant is connected."
    write: Mapping                 # extra stored values the turn-on sets (Live TV: {"tuner": host})
    note: str                      # when not met but near: "Home Assistant has a tuner; Mantel needs its address."

def look(facts: Facts) -> dict[str, Need]
```

| Piece | Met when | Written with `enabled: true` |
|---|---|---|
| `music` | `ma_connected is True` | nothing else (the page makes `house/music` on its first save, or imports HK Frontend's once, as it does now) |
| `clean_areas` | some row has `how == "map"` and at least one known area | nothing (`options` stay `{}`: every vacuum, every reachable area) |
| `energy` | `EP.grid_of(prefs)` is not empty, or `device_consumption` has an entry | nothing |
| `live_tv` | `tuner` is a LAN address, `tuner_answers is True`, and `tv_serves` is `mantel` or `link` | `tuner` when the saved one is empty. `channels` stays `[]`, which means the tuner's whole lineup, as `_live_tv_once` does today |

`met is None` whenever `ready` is false or a read failed. Only a clear "no" counts as "no". That keeps a half-loaded
registry or a Home Assistant restart from looking like a house without a vacuum.

Live TV's address is checked here too (`lan_host`): a host name or private-range IP, `.local` allowed; loopback,
link-local and anything public refused. The address comes from outside (a registry row), so it is a host check before
it is a request.

### The runner (`hosts/server/mantel_server/features/auto.py`)

`AutoFeatures(host)`, made by `FeatureHost`, owns the facts, the schedule, the markers and the write.

**Gathering the facts** (reads only, all already allowed):

- `ready`: the hub's HA connection is up and the registry has loaded (`FeatureHost._ha_ready`, `Registry`).
- `ma_connected`: `connections.live_ma(app)["connected"]`.
- `vacuums`: `hk_core.clean_areas.coverage(host.house, {})` over `MantelHouse`.
- `energy_prefs`: `readproxy.request({"type": "energy/get_prefs"})`, the read `energy_inputs` makes; `not_found` is `{}`.
- Tuner: the saved `live_tv.tuner` (the import brings HK Frontend's), else a device in `Registry.device_entries` whose
  `identifiers` name `hdhomerun` or whose manufacturer is SiliconDust, with an address from its `configuration_url`;
  `tuner_seen` also looks for entities with `platform == "hdhomerun"` and `get_config`'s `components`
  (`setup_guide.house_config`). With an address, one `GET http://<host>/lineup.json` through `host.fetch` (the fetch Live
  TV uses; tests hook it), 8 seconds, only for a LAN address, at most once every 10 minutes per address.
- `tv_serves`: `live_tv.MantelLiveTv.mode()` as it would be with the piece on (own go2rtc is `mantel`; `link` needs
  `links()`'s conditions: Mantel runs the house, `linked_house.wanted()`, a Mantel Link with `live_tv`; HK Frontend's
  Live TV still running it is `ha`).

**When it looks:**

| Trigger | Where it hooks in |
|---|---|
| Mantel starts | `FeatureHost.start()`, after `reload()` (replaces `_live_tv_once`) |
| Registries load or change | `FeatureHost.on_registry()`, which `register` already chains to HA's `on_registries_loaded`; coalesced for 30 s |
| A connection is made or changed | the end of `server.apply_connection`, beside `music_host.connection_changed()`; waits up to 30 s for Music Assistant to say it's connected |
| Every 5 minutes | `FeatureHost._ticker`, beside the Energy refresh (Home Assistant says nothing when Energy settings are saved) |
| The switch turns on | the settings feed's change, which already calls `reload()` |

**Two looks.** A need seen for the first time is remembered in memory, and a one-shot timer looks again after 2
minutes. It acts only if the need still holds. One partial load or a flicker never turns anything on.

**Single flight.** One lock; a look that finds one running does nothing.

**Eligible** (`eligible(piece)`), all of: the switch is on; the piece is off; `auto.decided` has no entry for it; the
history shows no person turned it off (below); for Live TV, `go2rtc_once` is not set (it is the old marker, honored); the
install isn't read-only for Live TV's `link` mode (decision 10).

### Once only: the marker

The feature settings get one new key, `auto`, in `DEFAULTS` (and `check_settings`, which already rejects unknown keys):

```python
"auto": {"enabled": True,                      # Turn Features On Automatically
         "decided": {}}                         # piece -> {"by": "auto" | "owner", "at": ISO time, "why": words}
```

It is not a piece (like `ha`), so `PIECES`, `acting_entities` and the screens' `added` list don't see it. An older
document has no `auto`: it reads as the defaults. It rides in every backup and the settings history.

- **`by: "auto"`** is written in the same version that turns the feature on.
- **`by: "owner"`** is written by a person's choice, in the same write as the choice: `FeaturePages.feature_set` (Add or
  Remove, either way) and `api_settings_put` (any piece whose `enabled` changed). Neither an import nor a restore writes
  one: they replace whole documents, and an import resets pieces Home Assistant doesn't have to off.
- **The history backstop.** `AutoFeatures.person_turned_off(piece)` reads `settings_history` for `house/mantel_features`
  and finds a row with `action == "set"`, an actor other than `mantel-auto`, and a diff `changed["<piece>.enabled"] ==
  [true, false]`. That catches a house upgraded from before the marker, and a settings restore that dropped it. When it
  finds one it writes the `owner` marker, so the scan runs once per piece.
- A feature turned on by a person never gets a marker until they turn it off. A feature that's already on is skipped
  as "not off".

### What turning a feature on writes

1. Re-read `house/mantel_features` and check `eligible` again (a person may have changed it a moment ago).
2. `audit.config(None, None, "features.auto_on", {"piece", "why", "version"}, app=app)`. This is **before** the write.
   `audit.Unavailable` means nothing changes (the same rule as every change, rule 7).
3. Build the new body: `piece.enabled = true`, the `write` values, `auto.decided[piece]`. Run it through
   `check_settings`, the check a person's save gets.
4. `store.write([("house", "mantel_features", body)], actor=Actor(label="mantel-auto"), message="Music on: Music
   Assistant is connected", expect={("house", "mantel_features"): version})`. If a person's save won the race, the write
   is refused with `conflict` and the next look decides again.
5. `host.reload()`, which sends the screens their new `added` list. For Live TV, also `host.tv.refresh()`.
6. `alerts.center.raise_("feature.enabled", piece, {"name", "why"})`.

`_live_tv_once` goes away: its first-start rule is the Live TV row above with the saved tuner address, and
`go2rtc_once` stays in the document so older backups still read as decided.

**It sends no command.** Every step above writes Mantel's own store or reads. The runner never calls
`MantelHouse.call_service`, `host.caller` or the gateway. What the features then do on their own: Clean Areas, Music
and the Live TV page act only on a person's request; Energy only reads; Live TV reads the tuner's lineup and the guide
(HTTP GETs on the LAN). Live TV in `link` mode makes Mantel Link publish the channels' entities in Home Assistant, which
is Mantel's own entities, not a service call, but it is visible there, so it is the one case decision 10 gates. The
tests assert zero gateway calls and zero `would` audit rows for every case.

**Who it acts as.** Not a person and not the Service actor `mantel:features`: a settings-history label,
`mantel-auto`, with no grants (so nothing it does can be a house command), and an audit row with no actor.

### Where it runs

| | HA App | LXC | Docker |
|---|---|---|---|
| Music | After the Owner connects Music Assistant in Connections. The page already suggests the Music Assistant App by name (`MaSuggester`) but Mantel has no credential, so nothing connects by itself | Same, or the install's token file at start | Same |
| Clean Areas, Energy | From Home Assistant's registries and Energy settings, the same | Same | Same |
| Live TV | Mantel has no go2rtc of its own. `tv_serves` is `link` only with Mantel Link's `live_tv` and Mantel running the house. HK Frontend still running it (`ha`): left alone | Own go2rtc: `mantel`. The old once rule is the same code path | Same as the LXC |
| The kill switch | `read_only` holds house commands off and builds no gateway; features still turn on (they are settings) | n/a | n/a |

### Telling the owner

- **The row.** Advanced → Features (`featureList`) shows, under a feature Mantel turned on, "Turned on by Mantel on Nov 4:
  Music Assistant is connected." in place of its "Needs" line, from `features[d].auto` in `panel/get`
  (`FeatureHost.panel_features` adds `auto: {at, why}` or `null`). A feature that's off but near gets its `note`
  ("Home Assistant has an HDHomeRun, but Mantel doesn't know its address: add it on Live TV's page.").
- **The switch.** A group at the top of Advanced → Features, "Turn Features On Automatically", with a footer that says
  what it does and that a feature you turn off stays off. It saves through a new save type,
  `mantel/features/auto/set` (`{enabled}`), in the same tables as the `<id>/feature/set` saves (`web/client/hk-client.js`
  `WRITES`, `settings_store/hooks.py` `FEATURE_SAVES`, `mantel-client.js`, `feature_pages.SAVES`), Owner and Admin with
  `configure` on `settings`, recorded in the settings history. It is shown only where `features[d].own` is (Mantel's
  host); Home Assistant's HK Settings never sees it.
- **The alert.** A new kind in `alerts/catalog.py`:

  ```python
  Kind("feature.enabled", "mantel", "info", "Mantel turned on {name}",
       "{why} Turn it off in Mantel Settings → Advanced → Features.", page="features", once=True)
  ```

  On for a new channel (it happens at most four times in a house's life, and it changes what the screens show). The
  link is `/settings#/mantel/features`: building adds that route to `mantel-settings.js` (it opens the Features page)
  and checks `Alerts.link`.
- **The audit and history.** `features.auto_on` in the audit log; the settings history shows the version, the diff and
  "Mantel (mantel-auto)".
- **Not** a pop-up or a banner on the screens.

### Screens and dashboards

Nothing stored is edited. A generated page follows the feature (`added('energy')`, `added('live_tv')`,
`added('clean_areas')` in `hk-strategy.js`), so the Home screen Mantel built from the house gains its Energy page, Live
TV tile and vacuum picker on the next feed. A screen the Owner edited, imported or made in Edit mode, and every Home
Assistant dashboard, stays as it is; the Owner adds the card when they want it. `default_screens.py` (where a person or
tablet lands) is not involved.

### HK Frontend inside Home Assistant

No (decision 14). Its features are items in Home Assistant's own config entry, each with a form (`features/__init__.py`,
`FeatureFlow`), and adding one from a background task is a Home Assistant change we'd own. Where Mantel runs the house,
HK Frontend's features are Mantel's already (`MantelRunsIt`). What does ship in HK Frontend is the page code, because
`web/` is shared; it shows the new note and switch only when a feature says `own`, so in Home Assistant it looks as it
does today. `hk_core/needs.py` is vendored with the rest of `hk_core` and unused there.

### Storage and API

- **No migration.** The `auto` key is inside `house/mantel_features`. `GET /api/features/settings` returns it,
  `PUT /api/features/settings` (Owner) can write it, and `check_settings` validates it: `enabled` a bool; `decided`
  keys only the four pieces; `by` one of `auto`, `owner`; `at` and `why` short strings.
- **No new route.** The switch is a save type, the status is in `GET /api/features/status` (`host.status()` gets an
  `auto` block: the switch, the markers, each need's last answer and why it hasn't acted), so `tests/test_route_guards.py`
  has nothing new to list.
- **Not in the MCP** (phase 12). It adds nothing an assistant needs to read or change.

## How it's built (models and effort, the owner, 2026-11-03)

- **The building session runs Opus 5.5 at Medium effort.** It writes the runner and its once-only rules, makes the
  design calls, and reviews what agents bring back.
- **Agents run Sonnet 5.5 at High effort** (`model: "sonnet"`, `effort: "high"`): `hk_core/needs.py` and its tests, the
  Live TV facts, the Features page change, the guide, the screenshots, and the review agent that reads each slice's
  diff. Each brief names its files and what done looks like.
- **Opus 5.5 for an agent only when it really needs it.** One likely case: the review of 16.2, because Mantel makes an
  HTTP request to an address that came from Home Assistant's registry. Say why in a line when choosing it.
- **Worktree agents branch from `origin`.** Push `main` before launching them; clean up only your own worktrees.

### The rules for the session (the owner's)

- **Finish everything without stopping.** Every question is in "Decisions for the owner" with a recommendation. If
  something unforeseen turns up, the session picks the safest choice consistent with those decisions, records it in a
  Build log (at the end of this file), and continues. It stops only for what only the owner can physically do, listed
  under "Waiting on the owner".
- **Validate and verify throughout.** Each slice ends with its tests and `tools/ci.py quick`. `tools/ci.py full` runs
  before each push (`docs/development/Building-and-Testing.md`). UI changes get WebKit screenshots at three sizes. A
  review agent reads each slice's diff before it is pushed.
- **Push finished work to origin/main:** `fetch`, merge (on the SMB checkout `git merge --no-autostash -s ort`), the
  private-words check (`tools/check_private.py`), never force. **Releasing to the house** needs the owner's OK (decision
  16).
- American English in the UI, comments, docs and commits; the diff is grepped before committing.

## Slices

| Slice | What | Size | Needs |
|---|---|---|---|
| 16.0 | `hk_core/needs.py` (`Facts`, `Need`, `look`, `lan_host`) and `tests/test_hk_core_needs.py`; boundary test | S | |
| 16.1 | The runner: `features/auto.py`, the `auto` key in `settings.py`, the markers (`feature_set`, `api_settings_put`, the history backstop), triggers (start, registry, connection, tick), the write with audit first, `feature.enabled` in the catalog; Music, Clean Areas, Energy | M | 16.0 |
| 16.2 | Live TV: the tuner facts (registry, `lineup.json` probe, LAN check), `tv_serves`, the Link and read-only rules; fold `_live_tv_once` in; Opus review | M | 16.1 |
| 16.3 | Telling the owner: `panel_features` `auto`, the notes and the switch on Advanced → Features, the `mantel/features/auto/set` save, `#/mantel/features` for the alert link, `host.status()`; WebKit screenshots at three sizes | M | 16.1 |
| 16.4 | The guide (`docs/guide`: a section on Features, a line in `Alerts.md`'s table), the changelog, the gallery shots (`tools/headless/gallery.py`, fictional house) | S | 16.2, 16.3 |
| 16.5 | **Release** (only with decision 16): Mantel with HK Frontend (the shared page code), tag, release | S | 16.4; the owner's OK |

The first push can be 16.0 and 16.1 (three features); 16.2 adds Live TV without changing what 16.1 does.

### Tests

- `tests/test_hk_core_needs.py`: every row of the needs table; `met is None` for an unready house, an unread Energy
  answer and an unknown tuner; `lan_host` (private, `.local`, loopback, link-local, public, a URL, a host with a
  path).
- `tests/test_features_auto.py` (a fake clock, `FeatureHooks.now`, a fake fetch and a fake Energy read):
  - not before two looks 2 minutes apart; a need that goes away between them does nothing;
  - on once; a second look writes nothing; a restart (new `AutoFeatures`) writes nothing;
  - a person's Add then Remove: no auto-on after; a person's Remove before the feature ever met its need: no auto-on
    when it later does;
  - the history backstop: a document with no `auto` key whose history has a person's off-switch;
  - an import and a restore set no marker;
  - the switch off does nothing and sets no marker;
  - **no command**: the gateway fake records zero calls, and the audit has no `would` rows, for every piece;
  - audit first: an `Unavailable` audit writes nothing; a `conflict` from a person's save writes nothing and the next
    look decides again;
  - the settings written pass `check_settings` and change only `enabled`, `auto` and Live TV's `tuner`;
  - the alert is raised once per piece;
  - Live TV: no go2rtc and no Link: not met; Link without `owners.house()`: not met; HK Frontend running it: left
    alone; a tuner that doesn't answer: not met with the note; an address from the registry, from the import and from
    the saved setting; the old `go2rtc_once` is honored; read-only with `link`: not met;
  - each trigger (start, registry, connection, tick) schedules a look, coalesced.
- `tests/test_feature_pages.py`, `tests/test_feature_parity.py`: `feature_set` writes the `owner` marker in the same
  version; `panel/get`'s `features[d].auto`; the new save type's tables.
- `tests/test_alerts_center.py` (and wherever the catalog's kinds are pinned): `feature.enabled`.
- `tests/test_shim_features.py` / `hosts/ha/custom_components/hk_frontend/tests/test_features.js`: the notes and the
  switch show for `own`, and not in Home Assistant's shape.
- Run with `tools/ci.py`: `quick` after each slice, `full` before each push.

## Verification

- **A fresh Mantel on the scratch Home Assistant** (`tools/testha/`, fictional house): connect Home Assistant, seed a
  vacuum with a room map and Energy settings, connect a fake Music Assistant, point a fake tuner at the lineup; watch
  each feature turn on after about 2 minutes, the screens' `added` list change, the Info alert go to a test channel and
  the history and audit rows appear. Turn one off; restart Mantel; it stays off.
- **An upgrade:** a database from the last release with Energy removed by a person (the history has the off-switch) and
  Clean Areas never touched: after the upgrade only Clean Areas turns on.
- **A house with nothing:** no feature turns on, nothing is written, no marker is set.
- **Screens:** the Home screen generated before and after, with the Energy page and the vacuum picker appearing;
  the Features page in WebKit at an iPhone, an iPad and a desktop size, with and without a note; Home Assistant's HK
  Settings (the shared page) unchanged.
- `tools/e2e/gateway_e2e.py` is not needed: nothing here sends to Home Assistant.

## Definition of done

- Music, Clean Areas, Energy and Live TV turn on by themselves in a house that has what they need, once, with the
  Owner told; nothing else does.
- A feature a person turned off, or Mantel already turned on, is never turned on again, including after an upgrade, a
  restart and a restore.
- No gateway call, no `would` row and no audit row of a command comes from the runner.
- The switch, the notes and the alert work; Home Assistant's HK Settings looks as it did.
- `tools/ci.py full` passes; every slice's diff was read by a review agent; the work is on origin/main; the guide and
  changelog are written; the Build log is filled in.
- The release is done only if decision 16 is yes; otherwise it's the first item under "Waiting on the owner".

## Decisions for the owner

**Decided 2026-11-03:** the owner accepted every recommendation below, the release decision included. The building session takes each recommendation as the answer and does not ask again.

| # | Question | Recommendation |
|---|---|---|
| 1 | Which features may turn on by themselves? | **Music, Clean Areas, Energy, Live TV**, the four you named. Never Alarm PIN, Notifications, the Sleep Screen, Wall Tablets' alerts, the linked backlight or Allow Control of the House: they guard or act on the house, or they are choices, not needs |
| 2 | A switch to stop it all? | **Yes:** Turn Features On Automatically in Advanced → Features, on by default, saved in the feature settings and the settings history |
| 3 | Houses that already run Mantel: on the first run after the upgrade, may it turn on a feature that's off, whose need is met, and that no person ever turned off? | **Yes,** by the same rules, after the two-look wait. A feature a person turned off (the history shows it) stays off |
| 4 | Once only, and never off by itself? | **Yes.** A stored marker, plus the history backstop. A need that goes away changes nothing |
| 5 | How long must a need hold? | **Two looks 2 minutes apart,** not one, so a half-loaded registry or a restart never turns anything on |
| 6 | Energy: what counts as "has Energy"? | **Home Assistant's Energy settings** with a grid meter or devices. Not a house that only has power sensors: a smart plug is not an Energy page |
| 7 | Clean Areas: what counts? | **A vacuum with a room map** (`how == "map"`). A robot that only starts in its own room doesn't turn it on |
| 8 | Live TV: how does Mantel find the tuner? | **Only what Home Assistant already knows** (a device in its registry), the import from HK Frontend, or what the Owner typed. No broadcast or scan (containers can't, and the owner didn't ask). It checks with one `lineup.json` read, the read Live TV makes anyway, on a LAN address only |
| 9 | Live TV's channels after it turns on itself | **The tuner's whole lineup,** as `_live_tv_once` does today; the Owner prunes on Live TV's page |
| 10 | Live TV through Mantel Link (the HA App), or with `--read-only` | **Turn it on only when Mantel runs the house and isn't read-only,** since Mantel Link then shows the channels in Home Assistant. Otherwise just the note on the row |
| 11 | How is the Owner told? | **The row's note, the history and audit, and an Info alert `feature.enabled`.** No pop-up on the screens |
| 12 | Is the alert on for a new alert channel? | **Yes:** it happens at most four times in a house's life and changes what the screens show |
| 13 | Do stored screens or Home Assistant dashboards get the new cards? | **No.** Generated pages follow the feature; a stored screen or an HA dashboard is never edited on its own |
| 14 | Does HK Frontend inside Home Assistant get this? | **No.** Its features are Home Assistant config items with forms; where Mantel runs the house they're Mantel's already. The page code ships in it but shows nothing there |
| 15 | Ask Mantel Link for the tuner's address (a new read, a new Mantel Link release)? | **No, not now.** The registry, the import or the Owner give it; revisit if the building finds the registry row has no address |
| 16 | May the session release to the house when it's done? | **Yes,** once `tools/ci.py full` is green and every commit since the last release has been read (`docs/development/House-releases.md`): Mantel with HK Frontend (the shared page code), tagged `vX.Y.Z`. Your answer here is the OK. Unanswered counts as no, and the release is the first item waiting on you |

## Sources

All of it is in this repository (read for this plan):

- `hosts/server/mantel_server/features/settings.py` (`PIECES`, `DEFAULTS`, `check_settings`), `features/host.py`
  (`on`, `reload`, `write_doc`, `_live_tv_once`, `_ticker`, `energy_inputs`, `client_added`, `panel_features`,
  `status`), `feature_pages.py` (`feature_set`, `SAVES`), `settings_store/hooks.py` (`FEATURE_SAVES`),
  `settings_store/store.py` (`write`, `expect`), `settings_store/docs.py` (`Actor`, `diff`)
- `hk_core/clean_areas.py` (`coverage`), `hk_core/energy/plan.py` (`grid_of`), `hk_core/house.py` (`Entity.platform`)
- `live_tv.py` (`runs`, `piece_on`, `links`, `mode`), `features/tv_fetch.py` (`LiveTv.refresh`), `connections.py`
  (`live_ma`, `MaSuggester`), `server.py` (`apply_connection`), `setup_guide.py` (`house_config`), `registry.py`
  (`device_entries`, `entity_entries`), `readproxy.py` (`READ_ALLOWED`)
- `alerts/catalog.py`, `alerts/__init__.py` (`link`, `register`), `audit.py` (`config`)
- `web/hk/panels/hk-settings-features.js` (`LIST`, `NEEDS`, `featureList`), `web/hk/cards/hk-strategy.js`,
  `hosts/ha/custom_components/hk_frontend/features/__init__.py`
- `docs/development/Rules.md` (rules 1, 2, 3, 7), `docs/development/Architecture.md`, `docs/phase14/SYSTEM-ALERTS.md`
- History: 60bdb7fa "Features on and off on Mantel itself", 14e35c0e "Advanced -> Features" (0.1.119)

## Build log

**Built (2026-11-03, one session):**
- **16.0** `hk_core/needs.py` (`Facts`, `Need`, `look`, `lan_host`, `home_ip`, `lineup_url`) and
  `tests/test_hk_core_needs.py` (the boundary check is in the test: the module imports only itself and the standard
  library). Commit e5d1e614.
- **16.1-16.2** `features/auto.py` (`AutoFeatures`), the `auto` key in `settings.py` (`AUTO_PIECES`), the markers
  (`FeatureHost.owner_decided` from `feature_set` and `api_settings_put`; the history backstop), the triggers (start,
  registry loads coalesced 30 s, `server.apply_connection`, the 5-minute tick), audit first (`features.auto_on`,
  `features.auto_decided`), `feature.enabled` in the catalog; Live TV's facts, `tv_serves`, the Link and read-only
  rules, `_live_tv_once` folded in. `tests/test_features_auto.py`. Commit 89d593c7.
- **16.3** Advanced → Features: the switch (`mantel/features/auto/set`, `FeaturePages.auto_set`), the row's words
  (`featureSub`: `features[d].auto` / `note`), panel/get's `features_auto`; `#/mantel/features` forwards to
  `advanced/features`; `host.status()["auto"]`. Commit 5a48fec8.
- **16.4** `docs/guide/Features.md` (new, linked from Home and the sidebar), a row in `Alerts.md`, the changelog.

**Choices made while building (the unforeseen rule):**
- **16.1 and 16.2 are one commit.** The runner's Live TV facts were the same code as its other facts; 16.2's own
  work (the Opus review of the request, below) came after.
- **Facts gained `tuner_from` and `read_only`,** so `look` itself decides whether to write the tuner and the
  read-only `link` rule (decision 10) stays a pure decision.
- **Music doesn't wait for Home Assistant** (`ready`): it needs only Mantel's own Music Assistant connection.
- **Reads only for what may still turn on.** A piece that's on or decided costs no Energy read and no tuner probe.
- **The backstop's find is written** as the `owner` marker, with its own audit row (`features.auto_decided`), since it
  is a settings change too.
- **`feature_set` marks the piece either way,** even when `enabled` doesn't change (Remove on a piece only Home
  Assistant had added is still a person's choice).
- **The review of 16.0-16.1 (Sonnet)** found: an unreadable history marked every piece as turned off by a person (now
  it decides nothing); a page's save made from a copy Mantel's turn-on overtook could undo it (the feature settings'
  saves now carry `settings_version` and are refused with `conflict`); a REST save with no `auto` reset the markers
  (now kept); a cached "yes" from the tuner served both looks (a "yes" now lasts a minute, a "no" ten); a failing look
  retried every second (it now starts the two minutes over); a look asked for during one was dropped (now one more
  look after it). Not changed: a saved tuner with a public-looking name (`tuner.example.net`) no longer turns Live TV
  on at the first start, as `_live_tv_once` did; the row's note says why and the Owner turns it on.
- **The review of 16.2 (Opus,** because Mantel makes an HTTP request to an address from Home Assistant's registry)
  found: `0x7f000001` and other numeric forms the resolver reads as IPv4 passed `lan_host` (now refused); the saved
  tuner was later read with redirects followed and a 60 MB cap (a home-network tuner's lineup now goes through
  `tv_fetch.lan_get`: the name resolved, every address checked with `home_ip`, the request to that address, no
  redirects, 2 MB); IPv6 zones (refused) and `[IPv6]` tuners (now pass `check_settings`); a short first read of the
  lineup (now read to the end under the cap).
- **The review of 16.3-16.4 (Sonnet)** found: `lan_get` refused a name that also resolved to a link-local or
  public address, and Live TV's refresh used it for a tuner a person typed (it now connects to the first home address
  the name has, and the refresh uses it only for a tuner Mantel saved itself); two saves in quick succession could
  refuse each other (the feature settings' saves and Mantel's turn-on now take one lock, `features_lock`, and a
  conflict says to try again); `PUT /api/features/settings` now carries its version (409 `conflict`); the alert's
  name in the guide.
- **`hk-client.js` WRITES is unchanged:** the `<id>/feature/set` saves aren't in it either (they leave as settings
  saves through `mantel-client.js`), so the new save sits with them.
- **The private-data scan** of the HA build refuses dotted private addresses in shipped code, so `needs.py` writes
  RFC 1918's ranges as numbers.
- **Going back to an earlier version** turns every feature off (its `check_settings` refuses the `auto` key); said in
  the changelog.

**Verified:** the main suite, HK Frontend's JS suite (`test_features.js`), `tools/ci.py quick` after each slice. The
scratch Home Assistant run in "Verification" wasn't done: it is HK Frontend's (the `demo` integration, no vacuum
room map, no Energy settings, no tuner), and Docker was off. The full-app tests in `tests/test_features_auto.py` stand
for it (a real Mantel app, a fake clock, fake Energy reads and tuner, the commander fake recording zero calls).

- **16.5, the release** (decision 16): every commit since v0.1.120 read; `tools/ci.py full` 51 of 51 on d10c2d3a; release
  commit 1a4a4973 (`versions` 5 of 5); tagged v0.1.121, workflow run 41732488607, the GitHub Release; `update` on the
  LXC (healthy, strict health 200); HK Frontend 1.41.0 copied, Home Assistant restarted, published and tagged v1.41.0.
  By hand: phase 15's flow wasn't on main (it waits for this record). On the house Mantel turned **Music** on by itself
  two looks after the start; the other three were on already.

**Expected to stay unverified until the owner's house:**
- The exact fields Home Assistant's HDHomeRun integration puts in its device registry row (`configuration_url`,
  `identifiers`, `manufacturer`); the scratch Home Assistant has no tuner. The tests use a fixture shaped like Home
  Assistant's device registry list; if the real row has no address, the Live TV row shows its note and the Owner types
  the address once.
- A real Music Assistant connect, a real vacuum with a room map and a real Energy dashboard, only against fakes.
- ~~Whether adding Live TV at run time needs `FeatureHost._tv_loop` started~~: checked. Nothing started it, so the
  guide wasn't kept fresh after an Add at run time; `reload()` now starts it whenever Live TV is on and it isn't
  running (`test_turning_live_tv_on_at_run_time_starts_its_guide`).

**Waiting on the owner:**
1. A look at the house: Music turned on by itself (Advanced -> Features says when and why, and the alert went to the
   channels that take it). Clean Areas, Energy and Live TV were already on, so whether the HDHomeRun's registry row
   carries an address stays unseen until a house without a saved tuner.
