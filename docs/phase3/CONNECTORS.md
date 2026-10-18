# Phase 3 P3.4: connectors (2026-10-18)

Music Assistant over its own WebSocket API, camera WebRTC signaling proxied to Home Assistant, and
the read proxies with RBAC applied. PLAN §3, §4 ("proxies, not copies"), §5, §7 ("Remote cameras:
same as today"), §10 (cameras, music). Everything here is tested against fakes only. No real HA or MA
was contacted, no `~/.config/mantel/*` token was read, and nothing in this slice can send a command.

## Modules

| Module | What it does |
|---|---|
| `mantel_server/connectors/__init__.py` | Shared pieces: `Hooks` (RBAC + MA gate + HA token), `Ctx` (one client connection), `Route`, `Forbidden`, and the two app tables `app["ws_handlers"]` and `app["read_routes"]` |
| `mantel_server/connectors/ma.py` | `MaClient` (connect, token from a secret file, auth, reconnect with backoff, request/response by message id, partial results, event fan-out), the read allowlist `MA_READS`, the command catalog `MA_COMMANDS`, the gated `command()`, and `register` |
| `mantel_server/connectors/camera.py` | `SignalingProxy` (a `ReadProxy` narrowed to camera signaling; every frame passes `ha_client.check_outgoing`), `CameraSignaling` (view hook, session ownership), and `register` |
| `mantel_server/connectors/media_art.py` | Media-player artwork: `shape`/`page_shaper` (no HA artwork token in any state; also strips history answers) and `GET /api/media/<entity>/art` (`Authz.may_see`). Added 2026-10-18 |
| `mantel_server/connectors/camera_still.py` | Camera stills: `shape` (no HA camera token in any state sent to a page; `entity_picture` → Mantel's route) and `GET /api/camera/<entity>/still` (RBAC `Authz.may_still`, streamed from HA's camera_proxy with Mantel's credential). Added 2026-10-18 with the page side |
| `mantel_server/readproxy.py` | Allowlist extended with media browsing, plus the single REST read (calendar events). `FilteredReads` applies RBAC to every read, `RULES` gives one rule per read type, and `register` |
| `mantel_server/ha_client.py` | Allowlist extended, explicitly and with key checks, for the three `camera/webrtc/*` messages and `unsubscribe_events` |
| `mantel_server/config.py` | `ma_url` (empty = connector off) and `ma_token_file` (default `/run/secrets/ma_token`) |

I did not touch `server.py`, `web/`, `hk_core/`, `hosts/ha/`, `store.py` or `auth.py`.

## Hook interfaces (what P3.2 and P3.3 plug in)

```python
Hooks(
    may_read=lambda identity, kind, ids: subset_of_ids,     # kind: "view" | "history"; may be async
    may_view=lambda identity, entity_id: bool,              # camera live view; may be async
    ma_gate=<object with allow(identity, command, args) -> bool>,   # may be async
    ha_token=lambda: "<Mantel's HA token>",                 # for camera's own HA connection
)
```

- **`ids`** can be entity ids, statistic ids, or `feature:<name>` for a whole feature. The features
  used are `music`, `energy`, `notifications`, `media` and `locations`, matching §5's resource list.
- **A hook can't widen a read.** The answer is intersected with what was asked.
- **Deny by default.** A hook that's left out refuses everything. The default `ma_gate` is
  `connectors.REFUSE_ALL`.
- **`may_view` must return exactly `True`.** Anything else counts as a denial.

## Wiring contract for P3.7

Each module exposes `register(app, hub, hooks)`. P3.7 calls them from `build_app` and adds three
things to `ClientSession`:

1. **One `Ctx` per socket:** `Ctx(send=self.send, identity=<user+device>)`, and `await ctx.close()`
   in `run()`'s `finally`. Closing ends every subscription: WebRTC sessions, forecasts, MA events.
2. **Dispatch to the handler table.** In `handle()`, `classify()` runs first and still refuses
   anything command-shaped. Any other type found in `app["ws_handlers"]` goes to
   `handler(ctx, msg)` as a task.
3. **Retire `ClientSession.read()`.** `readproxy.register` installs `read`, `read_subscribe` and
   `read_unsubscribe` with the same frames, so `web/shim/hub.js` is unchanged. It also adds
   `read_api` for calendar events.

Registered client message types (pinned): `read`, `read_subscribe`, `read_unsubscribe`, `read_api`,
`ma/read`, `ma/subscribe`, `ma/unsubscribe`. None is a command type, and no client message can send
an MA or HA command.

### What the page needs (done 2026-10-18; music through an interim bridge)

All of it lives in Mantel's host adapter and server. The shared frontend (`web/hk`, `web/client`,
`web/cards`) is unchanged, so HA's build of it stays byte-identical.

- **Camera live view: done.** `web/shim/mantel-host.js` answers the camera card's `callWS` for
  `camera/webrtc/get_client_config` and `camera/webrtc/candidate` with `hub.read(msg)`, and its
  `subscribeMessage` for `camera/webrtc/offer` with `hub.readSubscribe(msg, cb)`. These are checked
  before the adapter's write-word backstop, which used to refuse `offer` and `candidate`. The messages
  are byte-for-byte what the card sends to HA, and the camera connector decides each one
  (`may_view`).
  - The page side without Lovelace (2026-10-18): the Cameras page's tiles and the camera strip's live
    tile are Lovelace `picture-entity` configs, which HK's view host now draws with its own
    `hk-picture-entity` (`web/hk/shell/hk-view-host.js`; `docs/phase2/VIEW-HOST.md`). Its still is the
    state's `entity_picture` (Mantel's still route) plus `_hk`/`width`/`height`; its live view sends
    these three messages through the client. A refusal (`forbidden`, e.g. the `ha` door without
    `tunnel_cameras`) leaves the tile on its still with no retry.
- **Camera stills: done.** These go through Mantel, never HA's own `camera_proxy`.
  - `connectors/camera_still.py` shapes every state a `view.ClientView` sends, with or without an
    RBAC gate. A camera's `access_token` is dropped. Its `entity_picture` becomes
    `<prefix>/api/camera/<entity>/still?v=<tag>`, where the prefix is the page's Ingress prefix in
    HA App mode and `''` elsewhere. `v` is a salted HMAC of HA's URL: it changes when HA rotates the
    camera token, so the card retries after a failure as it does in HA, and it reveals nothing.
  - `GET /api/camera/<entity>/still[?width&height]` decides with `Authz.may_still`: `view` the camera,
    and `camera.live` either allowed or only waiting for a step-up. That is the live-view policy
    minus step-up, so the tunnel and `ha` doors still need the role's `tunnel_cameras`. If allowed,
    it streams HA's `/api/camera_proxy/<entity>` using Mantel's own HA credential.
  - Responses: 403 when refused (checked before existence), 404 for an unknown entity or one that
    isn't a camera, 400 for a bad size or an unexpected query key, 502 when HA fails. Refusals are
    logged once per camera and door every 5 minutes.
- **Calendars: done.** `callApi('GET', 'calendars/<calendar.x>?start&end')` becomes
  `hub.readApi` → `{type: "read_api", id, method: "GET", path}` (readproxy checks the path strictly
  and decides `view`). Every other `callApi` is still refused, and nothing is sent.
- **Tests:** `tests/test_camera_still.py` (13) and `tests/test_shim_reads.py` (4, runs the adapter
  in node).
- **Scratch HA check (demo devices, 127.0.0.1:8124):**
  - The Owner's snapshot carried no camera token and no `camera_proxy` URL.
  - `GET /api/camera/camera.demo_camera/still?…&width=480&height=270` returned 200 `image/jpg`,
    43,965 bytes, starting `ffd8ff`.
  - A Child got 403.
  - `read_api` on `calendar.calendar_1` returned HA's event.
  - `camera/webrtc/get_client_config` reached HA through `read`. HA's demo camera has no WebRTC,
    so HA's own `webrtc_get_client_config_failed` came back.
- **Media players (done, `connectors/media_art.py`):** HA gives `media_player` states an `entity_picture`
  (and `entity_picture_local`) of `/api/media_player_proxy/<entity>?token=…&cache=…`. Every state sent
  to a page now carries `<prefix>/api/media/<entity>/art?v=<tag>` instead (remote `https://` artwork is
  left as is), and `GET /api/media/<entity>/art` serves it to anyone who may `view` the player
  (`Authz.may_see`), streamed from HA with Mantel's credential (shared `camera_still.proxy_image`).
  History answers (`history/history_during_period`) lose any camera token or signed picture too.
  Tests: `tests/test_media_art.py` (7).
- **Music: Mantel's own engine since Phase 4 (2026-10-18), once Music Assistant is given to Mantel**
  ([../phase4/MANTEL-FEATURES.md](../phase4/MANTEL-FEATURES.md) "Music"): `music.py` answers these reads in
  front of the bridge below when `cfg.ma_url` + its token AND the imported music settings are there (the
  person's own home room, from Music Assistant directly), and the actions run through the gateway to Music
  Assistant. Until then the bridge below answers, as before.
- **Music: the interim read-only bridge (2026-10-18), while Mantel's engine is off.** HA's
  `hk_frontend` integration still runs the music engine, so three of its reads are forwarded, RBAC-
  filtered (rules in the table below): `hk_music/subscribe` (the Music page's configuration feed),
  `hk_music/queue {entity_id, limit?}` (the screensaver panel's Up Next) and
  `hk_music/settings/library` (HK Settings' playlist picker). No other `hk_music/*` type is allowed:
  `queue_play`, `used`, `item/remove`, `playlist/save`, `preset/save`, `settings/set` and
  `playlists/order` are writes or side effects, the gateway's business, and commands stay off.
  - **What the feed keeps:** `configured`, `library_entry` (Music Assistant's config entry id, for
    Browse), `playlists` (names, icons, keys), `volume`, `ignore_announcements`, and the players the
    person may `view`: speakers and presets (a preset whose group player is hidden goes; a visible
    preset loses the hidden members), floors (empty ones go) and `announcements`. Any other key HA
    adds is dropped.
  - **`home` is always null.** HA answers as Mantel's own HA user, so the per-user home room HA works
    out is that user's, not the person's. The page draws without it (no room preselected) until
    Phase 4, when MantelHouse runs the engine and knows the person.
  - **Queue answers** are rebuilt as `{id, title, artist, duration, image}`; an image address that is
    not `http(s)` or carries a token-like query key is dropped. A player the person may not view
    answers `not_found`, exactly as a nonexistent one, and nothing is sent to HA.
  - **Page side:** done: `hk_music/queue` is one of the host adapter's `NAMED_READS`.
  - Phase 4: the feed, the queue and the library are Mantel's engine's (above) when it is on; Browse's library
    reads still go to HA (`ma/read` is ready for them).
  - **Scratch HA check (2026-10-18):** all three went through `ReadProxy` + `FilteredReads` to the
    real `hk_frontend` and came back as HA's "not set up" answers (`{"configured": false}`, `{"items":
    []}`, `{"ok": false, "message": "Music Assistant is not set up."}`): the scratch HA has no Music
    Assistant, so the pruning of a configured feed is checked with fakes only.
- **Entity registry and Hidden Accessories: answered by Mantel (2026-10-18).** HK's pages send two
  more reads HA used to answer. Mantel answers both itself and forwards neither (`readproxy.MANTEL_READS`,
  rules in `readproxy.ROUTE_RULES`, registered in `app["read_routes"]` by `readproxy.register`):
  - `config/entity_registry/get {entity_id}`: HK's one caller (`hk-detail.js` `favourites`, for an
    admin) reads only `options.light.favorite_colors`. Mantel answers from the hub's copy of the entity
    registry (`config/entity_registry/list` carries `options`; checked on the scratch HA) with
    `{entity_id, options: {light: {favorite_colors}}}` and nothing else, each colour checked (one known
    colour key with its numbers). HA's own answer also carries device, area and config entry ids,
    aliases, labels, capabilities and every integration's options, some of which name other entities
    (`switch_as_x`), so none of it is sent. `view` the entity; otherwise, or if it does not exist,
    `not_found` "Entity not found" (the same frame).
  - `hk_frontend/hidden/get {entity_ids?}`: see [SETTINGS.md](SETTINGS.md) "Hidden Accessories".

## Music Assistant: the API messages used

Sources I relied on (read 2026-10-18):

- MA server `music_assistant/controllers/webserver/websocket_client.py`: the server info on
  connect, the `auth` command with `args.token`, the success shape `{"authenticated": true, "user"}`,
  events only after auth, and partial results streamed in chunks of 500.
- `music_assistant_models/api.py`: `CommandMessage {message_id: str, command, args}`,
  `SuccessResultMessage {message_id, result, partial}`,
  `ErrorResultMessage {message_id, error_code, details, …}`, `ServerInfoMessage {server_id,
  server_version, schema_version, …}`, and `EventMessage = MassEvent {event, object_id, data}`.
- `music_assistant_client/players.py`, `player_queues.py` and `music.py`: the command names
  exactly as the official client sends them. HA's `music_assistant` integration calls MA through
  this library (`play_media`, `transfer_queue`, `get_library`, `get_queue`, `play_announcement`).

| Step | Messages |
|---|---|
| Connect | `ws://<ma>:8095/ws`. The server sends its info; I check that `server_version` is present |
| Authenticate | `{"message_id", "command": "auth", "args": {"token"}}` → `result.authenticated == true` |
| Reads (`MA_READS`) | `players/all`, `player_queues/all`, `player_queues/get_active_queue {player_id}`, `player_queues/items {queue_id, limit, offset}`, `music/{artists,albums,tracks,playlists,radios,audiobooks,podcasts}/library_items {favorite, search, limit, offset, order_by, provider (+album_types / album_artists_only)}`, `music/artists/artist_albums`, `music/artists/artist_tracks`, `music/albums/album_tracks`, `music/playlists/playlist_tracks` (never `force_refresh`), `music/podcasts/podcast_episodes`, `music/item`, `music/item_by_uri`, `music/search {search_query, media_types, limit, library_only}`, `music/browse {path}`, `music/recently_played_items {limit, media_types}` |
| Events | Everything MA pushes after auth, fanned out locally and optionally filtered by event type. After a reconnect, listeners get a local `{"event": "mantel_reconnected"}` so they read again |
| Commands (`MA_COMMANDS`, gated) | `player_queues/{play_media, transfer, play, pause, play_pause, stop, next, previous, play_index, seek, shuffle, repeat}`, `players/cmd/{volume_set, volume_mute, power, group_many, ungroup_many, play_announcement}`, and (Phase 4, what HA's integration sends for the media_player services the music engine uses) `players/cmd/{play, pause, play_pause, stop, next, previous, ungroup}`. Each has an explicit argument list |
| Server-only reads (`MA_SERVER_READS`, Phase 4) | `music/playlists/playlist_tracks` with `force_refresh` and `music/recently_played_items` with `played_after_timestamp`: Keep Playlists Ready's refresh, sent only by `MaClient.server_read` / `send_command` (Mantel itself); `check_outgoing` refuses them on the page path (`ma/read`), so `force_refresh` still never comes from a page |

**Command path.** `MaClient.command(identity, command, **args)` works in four steps:

1. Refuse anything not in the catalog.
2. Ask `gate.allow(identity, command, args)`. If the answer isn't exactly `True`, raise
   `CommandRefused` and send nothing.
3. Mint a one-shot `_Ticket` for that command.
4. Send. `check_outgoing` passes a command frame only with its own unused ticket.

`register` adds no client message for commands. P3.3's gateway calls `app["ma"].command(...)` itself,
with its own step-up and audit, and is passed in as `hooks.ma_gate`.

**Token.** `read_secret(cfg.ma_token_file)` runs at every connect, so a rotated secret file is
picked up on the next connect. The value is never stored on the client or logged. A missing or
empty file stops the connector (`MaTokenMissing`). A rejected token keeps retrying with backoff
(1 s doubling to 30 s), because the secret may get fixed.

**Since 2026-10-18 (Connections page, `connections.py`):** `MaClient(..., token_source=callable)` takes the token
from Mantel's own sealed copy (set on `/admin` → Connections) when there is one, else from the installation's file
(called at each connect, never stored on the client); `MaClient.retarget(url, token_source)` closes the socket and
reconnects to a new address/token (listeners get `mantel_reconnected`). `register` looks the client up as
`app["ma"]` at each message (it may be built, retargeted or removed at run time) and leaves `app["ma_gate"]` for
the client built later. That is the whole interface the Connections work needs from this module.

## Camera flow

```
screen ──read {camera/webrtc/get_client_config}──▶ Mantel ──(may_view?)──▶ HA  → ICE config, returned UNCHANGED
screen ──read_subscribe {camera/webrtc/offer}────▶ Mantel ──(may_view?)──▶ HA  → events relayed as they come:
                                                                                 session, answer, candidate…, error
screen ──read {camera/webrtc/candidate}──────────▶ Mantel ──(may_view? + own session?)──▶ HA
screen ◀════════════ video: directly between the screen and HA's go2rtc (STUN only, as today) ════════════▶
socket ends / read_unsubscribe ─▶ unsubscribe_events ─▶ HA ends the WebRTC session
```

- **Denied:** `Forbidden`, which reaches the page as `{"error": {"code": "forbidden"}}`. Nothing is
  forwarded. The signaling connection isn't even opened.
- **Candidates:** forwarded only for a `session_id` that HA opened for the same client connection
  and the same camera. One viewer can't feed candidates into another viewer's session.
- **Message shapes:** must be camera entities and carry exactly HA's keys (`ha_client.SIGNALING_TYPES`).
  The offer must be an SDP string.
- **The connection:** `SignalingProxy` is its own HA connection, opened with `hooks.ha_token()`.
  It can't send anything but the signaling types, plus `auth` and `unsubscribe_events`.

## Read proxies and their filters (`readproxy.RULES`, one per type)

| Read | Rule |
|---|---|
| `get_config` | Open. `latitude`, `longitude`, `elevation` and `radius` only with `feature:locations` |
| `frontend/get_themes` | Open (the theme list) |
| `weather/subscribe_forecast` (subscription) | `view` the weather entity |
| `persistent_notification/subscribe` (subscription) | `feature:notifications` |
| `history/history_during_period` | `entity_ids` required (without them it's the whole house). Filtered to the ids the subject may read the `history` of. Nothing allowed → `{}` with no HA call. The answer is filtered too |
| `logbook/get_events` | Same as history. Entries for other entities are dropped. A `context_entity_id` the subject may not read is stripped |
| `recorder/statistics_during_period` | `statistic_ids` filtered by `history`. The answer is filtered too |
| `energy/get_prefs` | `feature:energy`. Any list entry naming a `stat_*` or `entity_*` the subject may not `view` is pruned |
| `energy/info` | `feature:energy` |
| `media_player/browse_media`, `media_player/search_media` | `view` the media player |
| `media_source/browse_media` | `feature:media`. `media-source://camera…` is refused, and camera children are pruned (cameras go through the camera connector) |
| `GET /api/calendars/<calendar.x>?start&end` (`read_api`, the only REST read) | `view` the calendar. Strict path, entity and ISO-date checks. GET only |
| `hk_music/subscribe` (subscription; interim) | `feature:music`. Every event pruned to the players the subject may `view`; `home` always null; unknown keys dropped |
| `hk_music/queue` (interim) | `view` the `media_player.*` (else `not_found`, nothing sent); `limit` 1..100 (HA's schema). Items rebuilt; token-carrying image addresses dropped |
| `hk_music/settings/library` (interim) | `feature:music`. Items rebuilt as `{uri, name}` |
| `hk_music/settings/get` | Never for a page (`SERVER_ONLY_READS`): the music import's own read. A page's is answered by Mantel's engine (`music.ROUTE_RULES`: `configure` on settings) |

The four `hk_music/*` reads are registered by `music.py` in `app["read_routes"]` (`music.ROUTE_RULES`): with
Mantel's engine on they are answered from Music Assistant and Mantel's settings, never sent to HA; with it off
the routes hand `subscribe`, `queue` and `settings/library` to the rules above (the bridge) and refuse
`settings/get` as before.
| `hk_tv/channels` (interim, [FEATURE-PARITY.md](../phase4/FEATURE-PARITY.md)) | Each channel kept only if the subject may `view` its `camera.*`; its `now` `sensor.*` only if viewable (else null). Rebuilt as `{configured, channels: [{number, name, camera, now}]}`; no other key passes |
| `hk_notify/settings/get`, `hk_clean_areas/settings/get`, `hk_energy/settings/get`, `hk_tv/settings/get` | Never for a page (`SERVER_ONLY_READS`): the feature import's own reads (`ReadProxy.read_server`) |

Answered by Mantel's feature host, never sent to HA (`features.ROUTE_RULES`): `hk_clean_areas/subscribe`
(signed in; areas reached only through a vacuum the subject may `view`), plus the feature host's own
`hk_frontend/events/subscribe`, `mantel/energy/plan`, `mantel/clean_areas/coverage`, `mantel/live_tv/guide`.

Answered by Mantel, never sent to HA (`readproxy.ROUTE_RULES`, not in `READ_ALLOWED`):

| Read | Rule |
|---|---|
| `config/entity_registry/get` | `view` the entity, else `not_found` (as a nonexistent one). From the hub's registry copy: `entity_id` and `options.light.favorite_colors` only |
| `hk_frontend/hidden/get` | `configure` on settings (HA: `require_admin`). Every entity, device and room the subject may not `view` is left out; an asked-about one reads as nonexistent |

`check_read` runs first: an unlisted type or an extra key never reaches HA. A `read` frame that
carries anything besides `type`, `id` and `msg` is refused. This matters because a `cmd` key riding
on a `read` gets past `server.classify()`.

## Invariants (each pinned by a test)

- **Nothing in this slice can send a command.**
  - HA: every allowed type is a read, or viewing signaling with exact keys.
  - MA: only auth and `MA_READS`. A catalog command goes out only through `command()`, only with
    the gate's yes, and only once.
  - Client: command-shaped messages are refused by `classify` before any connector sees them, and
    no registered type is a command type.
- **`ha_client.ALLOWED_TYPES` is pinned to its exact set.** `READ_ALLOWED` is pinned in
  `test_proof1_guards.py`. `MA_READS` and `MA_COMMANDS` don't overlap, and no read name is a
  write word.
- **Every frame the signaling connection sent is on HA's allowlist.**
- **RBAC never widens a read.** No hooks means deny.
- **Video never flows through Mantel.** The ICE config is HA's, unchanged.

## Tests

| File | Covers |
|---|---|
| `tests/connector_fakes.py` | Fake HA (WebSocket: auth, signaling, every read, plus the calendar REST read) and fake MA (server info, auth, results, partials, events, drop/push). Both record every frame |
| `tests/test_connectors_ma.py` (26) | Pins; auth with the file token; reads; partial results joined; event filter and stop; reconnect with backoff; a bad token retried until fixed; a missing token file stops the connector; the command refused by default with nothing sent; a refusing gate; an allowing gate sends catalog commands only; `register` (feature gate, off without a URL) |
| `tests/test_connectors_camera.py` (14) | ICE config unchanged; denied → nothing forwarded; offer relay, candidate, unsubscribe; session ownership; malformed offers; the signaling connection sends only signaling; every frame on HA's allowlist; `register` |
| `tests/test_readproxy_filters.py` (31) | One rule per read; history, logbook and statistics filtered both ways; energy pruning; the location stripped; media browsing; forecast and notification subscriptions; calendar REST and `read_api` parsing (POST, traversal, extra query, bad dates, absolute URLs refused); a hook can't widen; no hooks means deny |
| `tests/test_readproxy_filters.py` (+10, music) | Exactly the three `hk_music/*` reads (every write refused); the feed needs `feature:music` and is pruned in order; the queue needs `view` of the player, hidden and nonexistent alike `not_found` with nothing sent; malformed queue reads refused before HA; the library rebuilt |
| `tests/test_mantel_reads.py` (28) | `config/entity_registry/get` and `hk_frontend/hidden/get`: one rule each and never on the HA allowlist; only the favourite colours (no other entity, id or token); hidden and nonexistent read the same; malformed reads and the writes refused; hidden.py's port against HA's own `test_hiding.py` cases; `configure` needed; per-person pruning of entities, devices and rooms; nothing written |
| `tests/test_ingress.py` (+1) | Both Mantel-answered reads through the HA App's Ingress door, with any HA read failing the test; commands still disabled |
| `tests/test_connectors_wiring.py` (9) | All three registers over a real local WebSocket, dispatched as P3.7 will. Covers: pinned handler set; commands never reach a connector; commands inside or riding on a read; camera over `read`/`read_subscribe`; socket close ends the WebRTC session; filtered reads; MA reads |
| `tests/test_ha_client.py` (+8), `tests/test_proof1_guards.py` | Allowlist pins updated: the exact set, signaling key checks, camera-only |

Validation: `~/.venvs/mantel/bin/python -m pytest -q` → **305 passed** (217 before this slice).
`tools/headless/client_smoke.py` passes when it runs alone. It drives the shared headless Chrome on
:9222, and runs fail when another worktree's smoke uses that browser at the same time ("Inspected
target navigated or closed").

## Known limits

- **A dropped HA connection is silent to WebRTC subscribers.** When the signaling connection
  drops, `ReadProxy` clears its subscriptions without telling them. The camera card recovers
  through its own `connectionState` retry. A later slice could send `{"type": "error", "code":
  "connection_lost"}`.
- **`ma/read` is gated per feature (`feature:music`), not per player.** MA player ids aren't HA
  entity ids. The map now exists (`music.ma_players`: the registry's `music_assistant` entities'
  `unique_id`), and the music engine's own reads filter by entity; `ma/read` could use it too.
- **`ma_url` and `ma_token_file` are config fields only, not CLI arguments.** Packaging (P3.6) and
  the settings import decide how they're set.

## Exact continuation point

1. **P3.7:** wire `readproxy.register`, `camera.register` and `ma.register` in `build_app` with
   `Hooks(may_read=<P3.2 read filter>, may_view=<P3.2 camera view>, ma_gate=<P3.3 gateway>,
   ha_token=lambda: token)`. Add the `Ctx` and handler dispatch to `ClientSession` as described in
   the wiring contract, and delete `ClientSession.read()`. Port `tests/test_connectors_wiring.py`'s
   harness assertions onto the real `ClientSession`.
2. **P3.3:** make the gateway the `ma_gate` (`allow(identity, command, args)` after RBAC, step-up and
   the audit row). Its MA path calls `app["ma"].command(identity, command, **args)`.
3. **`web/` slice:** done for cameras (signaling, stills) and calendars, in the host adapter. What
   remains is moving HK's music reads to `ma/read` (media-player artwork: done).
4. **E2E (P3.7) against the scratch HA:** a camera, a calendar and history reads, filtered by role.
   MA stays fake-only until Avery points `ma_url` at a scratch MA.
