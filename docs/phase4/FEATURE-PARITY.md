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

`features.import_features(panel, read, current, source)` (`hosts/server/mantel_server/features/`):

- **Which features HA has added:** panel/get's `features` (`{hk_music: {kind, entries: [{entry_id, title}]}, …}`)
  becomes `ha.added` (HA's kinds, in HA's order) and `ha.items` (HA's item ids and titles).
- **Their settings:** for each of Notifications, Clean Areas, Energy and Live TV that HA has, one read of its
  HK Settings page:
  - `hk_notify/settings/get`: `options` (stay, saver, chime, dnd, wake) and `items`, keeping only the stored
    fields (`id` + `ITEM_FIELDS`)
  - `hk_clean_areas/settings/get`: `chosen_vacuums` and `chosen_areas` become `options.vacuums` and `options.areas`
  - `hk_energy/settings/get`: `options` (the stored `OPTION_KEYS`, none of what HA works out)
  - `hk_tv/settings/get`: `host`, `guide_url`, `quality`, the channels and their names
- **The pieces it turns on:** `notifications`, `clean_areas` and `energy` come in **enabled**, because Mantel
  runs them. `live_tv` is imported **off** where Mantel has no go2rtc of its own (the HA App: its screens read
  HA's channel cameras, below, and HA already reads the guide), and **on** by the re-import
  (`POST /api/features/import`) where it has one (Docker/LXC, `--go2rtc-url`; "Live TV served by Mantel"
  below). A feature HA does not have comes in off, and its read isn't sent.
- **Music** (Phase 4, `music.import_doc`; [MANTEL-FEATURES.md](MANTEL-FEATURES.md) "Music"): when HA has Music
  added, one more server-only read, `hk_music/settings/get`, becomes `house/music` (speakers, volume, home rooms
  as `ha:<HA user id>`, presets, playlists, Keep Playlists Ready, Ignore Announcements; HA's user names are not
  kept). A music read that fails leaves the features in; the import can be run again.
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
| **Live TV** (`hk-tv-guide-card`) | `hk_tv/channels` → `[{number, name, camera, now}]`; the `now` sensors' states; each channel's camera picture and live view; `hk_tv/watching` heartbeat | **Docker/LXC (Mantel's own go2rtc): served by Mantel** end to end (`live_tv.py`, below). **HA App: interim read bridge** to HA (`readproxy.RULES`): a channel is kept only if the subject may `view` its `camera.*`, and its `now` `sensor.*` reads null unless viewable. Rebuilt from the four keys. The camera and sensor states already come through the hub. The heartbeat is counted by Mantel in both. |

### Live TV video in HA App mode (the interim, unchanged)

What works, and through which path:

- **The video.** Each channel is an `hk_frontend` camera in HA. Its stream is HA's own transcode (ffmpeg
  MPEG-2/AC-3 to H.264/AAC), relayed to WebRTC by HA's go2rtc. The player is `hk-doorbell-card` with
  `entity: <channel camera>`, so it signals exactly as a camera's live view does: `camera/webrtc/*` through
  Mantel's camera connector, `Authz.may_view` (`camera.live`), and the media goes browser ↔ HA's go2rtc
  directly.
- **The tile's picture.** It is the camera's `entity_picture`, which Mantel's still route rewrites, so no HA
  token reaches the page.
- **The heartbeat** (changed 2026-10-18). `hk_tv/watching` is no longer answered in the page. The shim
  (`web/shim/mantel-client.js`) sends it to Mantel as `tv_watching` on every server, commands on or off. Mantel
  counts it (`live_tv.Viewers`, `GET /api/live_tv/status`) and answers `{viewers, ha: true}`. HA's Live TV still
  keeps `sensor.tv_viewers` here, so the page ALSO sends the original `hk_tv/watching` to HA through the gateway,
  but only when the operator turned commands on (as before). There's never a "commands disabled" toast.

What stays in HA in App mode: the transcode (`live_tv/stream.py`), the channel cameras, the guide's
coordinator and `sensor.tv_viewers`. With commands off, Mantel counts a screen watching through it, but HA's
`sensor.tv_viewers` does not (that would be a write to HA, and commands off sends nothing).

### Decision: HA App mode keeps the HA-transcode interim (2026-10-18)

The App container could run go2rtc itself. It doesn't, on purpose:

- **WebRTC media needs a published port.** In App mode the only way in is Ingress (HTTP). A go2rtc in the App
  would need 8555/tcp+udp opened on the HA host. HA-APP.md's hardening and `package_check` (no host network,
  Ingress only) rule that out. The server image also deliberately carries no ffmpeg or go2rtc (PACKAGING.md
  "Transcode choice": the process holding the HA token has no media toolchain).
- **No CPU gain.** An HA VM usually has no GPU, so a transcode in the App is the same CPU ffmpeg HA already
  runs. QuickSync (Proof 4: 0.14 of a core against 0.84) is only on the LXC.
- **HA already runs it, on the same machine.** HA's Live TV owns the channel cameras, the guide, the "now
  playing" sensors and `sensor.tv_viewers`, which the tablets' sleep templates read. A second transcode would
  use a second of the tuner's two tuners for the same channel, and duplicate those entities.
- **It's what the house runs today**, and it keeps working unchanged.

So in App mode the entrypoint never passes `--go2rtc-url` (pinned by `tests/test_live_tv.py`), `live_tv.py`
stays in its `ha` mode, and the only change is that Mantel now counts the heartbeat.

## Live TV through Mantel Link (the HA App without HK Frontend, 2026-10-20)

The interim above needs HK Frontend: its Live TV owned the channel list (`hk_tv/channels`), the channel cameras, the
guide and the transcode (`live_tv/stream.py`). With HK Frontend removed, the HA App had none of it, and the page said
"Add Live TV". Now, once the house is Mantel's and Mantel Link says it has Live TV's transcode (`live_tv` in its link
features, Mantel Link 0.1.3), `live_tv.py` is in `link` mode:

- **The channel list** is Mantel's, from its own Live TV piece. The piece applies when it is on, or when it was
  imported from HA with a tuner (the import leaves it off, since HA ran it then). Mantel reads the tuner's lineup and
  the guide itself. Each channel keeps the entity ids HA already has (learned by `linked_house.py`); a new channel gets
  HK's ids, under this entry.
- **The cameras** are Mantel Link's, published by `linked_house.py` with `features.tv` = {channel, the tuner's stream
  URL, the quality, the programme's artwork}. Mantel Link's camera streams from its own view
  (`/api/mantel/tv/stream/<n>`, this machine only), which runs HK's ffmpeg command on that tuner URL alone (a plain
  `http://<tuner>[:port]/auto/v<n>`). Home Assistant's go2rtc plays it, as it played HK Frontend's, so the page's
  `camera/webrtc/*` for a channel camera go to the camera connector, unchanged. The still is the programme's
  artwork, never a frame.
- **The heartbeat** is counted by Mantel and published as `sensor.tv_viewers`; the page is told `ha: false` (there is
  no HA Live TV to tell).
- **The Cameras page** leaves Mantel Link's cameras out (platform `mantel`), as it does HK Frontend's.
- A Mantel Link without the transcode keeps the interim (the cameras unavailable, never a wrong picture).

Proved on the scratch HA (`tools/e2e/mantel_link_e2e.py --phase livetv`: a fake tuner sending MPEG-2 and AC-3, HA's
own HLS player in place of go2rtc).

## Live TV served by Mantel (Docker / Proxmox LXC, 2026-10-18)

Where Mantel runs the compose stack, its own go2rtc (the `transcode` image, service `go2rtc` on the backend
network) does Live TV, and Mantel serves the page end to end: `hosts/server/mantel_server/live_tv.py`. It's on
when `--go2rtc-url` is set (compose: `MANTEL_GO2RTC_URL=http://go2rtc:1984`) **and** the Live TV piece is on
with a tuner (`house/mantel_features` `live_tv`: `tuner`, `guide_url`, `channels`, `names`, `quality`).

| What HK's page reads | Answered by |
|---|---|
| `hk_tv/channels` | Mantel: the channels of Mantel's Live TV piece (the tuner's lineup and the XMLTV guide, `features.LiveTv`), in order, named as HA names them (a house name wins; a name used twice gets its number). Only for a subject with **`feature:live_tv`**, a new RBAC feature: Owner, Admin and Adult have it through their `all` grants, wall tablets through a house grant, Child and Guest don't. Each channel is listed only if they may `view` its camera, and its `now` sensor only if viewable. |
| `camera.tv_<name>`, `sensor.tv_<name>_now`, `sensor.tv_viewers` | Mantel's own states with **HA's entity ids** (the same slug). They go into the hub's state store as an overlay that always wins: a linked mirror's copy, or a reconnect's, is put back in the same callback, before any page is sent anything. They also go into the registry with platform `hk_frontend`, so HK's Cameras page leaves them out, as it does HA's. The now sensor carries HA's attributes (title, subtitle, description, start/end, image, next, logo, network). The camera carries no picture and nothing about where it streams from. |
| `camera/webrtc/get_client_config`, `/offer`, `/candidate` on a channel camera | Mantel. The camera connector's routes are wrapped; any other camera still goes to HA. RBAC first: `feature:live_tv` and `camera.live` on the channel's camera. Then the channel is set up in go2rtc **on demand** (`PATCH /api/streams`, in memory only; `PUT` would try to write the read-only go2rtc.yaml). The offer, answer and candidates are relayed over go2rtc's own WebSocket (`/api/ws?src=`), in HA's event shapes (`session`, `answer`, `candidate {candidate, sdpMLineIndex}`, `error`). A candidate only goes into a session of the same connection. ICE: HA's own default STUN servers. |
| `hk_tv/watching` | `tv_watching` (above). Counted per screen (a wall tablet's device) or per person, expiring after 150 s without a heartbeat (as HA's does). Published as `sensor.tv_viewers`: state = how many, plus `users`, `channels`, `screens`. A channel Mantel doesn't serve is `not_found`; a subject who may not watch it is `forbidden`. |

**The stream.** One go2rtc stream per channel being watched, `mantel_tv_<n>`. Each is an ffmpeg source that
names Mantel's templates in `packaging/compose/go2rtc/go2rtc.yaml`:
`ffmpeg:http://<tuner>:5004/auto/v<n>#input=mantel_tv_in#video=mantel_tv_720#audio=opus`.

- `_1080` comes from the quality setting.
- `_vaapi` comes from `--live-tv-hardware vaapi`, which `compose.gpu.yaml` sets. That's Proof 4's pipeline:
  decode, `deinterlace_vaapi`, `scale_vaapi` and `h264_vaapi`, all on the iGPU.
- The CPU templates use HA's own transcode arguments: yadif; 720p at 3 Mb/s or 1080p at 6 Mb/s; a key frame
  every second; fast probing. Audio is Opus, for WebRTC.
- The tuner URL is the lineup's own stream URL when that is a plain `http://<tuner host>[:port]/auto/v<n>` on
  the configured tuner. Otherwise it's HA's `http://<tuner>:5004/auto/v<n>`. Nothing else (no `#`, no other
  host) can reach go2rtc's ffmpeg.
- go2rtc 1.9 refuses `exec:` sources from its API, and its `ffmpeg:` source pushes into go2rtc's own RTSP
  server. So go2rtc.yaml now runs RTSP, on the container's loopback only (`127.0.0.1:8554`).

**Stop when nobody watches.** Viewers of a channel share one go2rtc stream, so one tuner. go2rtc stops ffmpeg,
freeing the tuner, when the last WebRTC consumer leaves. Mantel removes the stream 5 s after its last session
ends (a quick re-tune keeps it), and every 30 s removes any `mantel_tv_*` stream no session uses (after a
restart, for example).

**Linked mode.** `linked_house.py` stays the one publisher of hk_frontend's Live TV entities: it learns their
unique and entity ids from HA's registry, and publishes them while Mantel owns `house`. Where Mantel serves
Live TV, it now takes two things from `live_tv.py`:

- `{item}_viewers` (`sensor.tv_viewers`) carries Mantel's viewer count, so a tablet's sleep template keeps
  working. Otherwise it stays 0.
- `{item}_{n}_camera` is **available** for each channel Mantel serves. Otherwise it's unavailable.

`{item}_{n}_now` comes from Mantel's guide either way. The cameras carry **no stream source**: HA's own
dashboards don't play Mantel's channels (HK's pages do, through Mantel). Turning Live TV off makes the cameras
unavailable again and the viewers 0.

**Nothing reaches the page but the SDP answer.** Never the tuner's address, go2rtc's API address or any
credential (pinned by the tests and both e2e runs). The answer's candidates name go2rtc's published WebRTC port
at `MANTEL_LAN_IP:8555`, as HA's go2rtc's candidates name HA's today. `GET /api/live_tv/status` (Owner/Admin)
shows the mode, channels, viewers, sessions, streams, linked entities and last error, and no addresses either.

**What Avery provides to turn it on** (Docker/LXC only):

- **The tuner's address and the guide URL.** The HDHomeRun was `192.0.2.126` in Proof 4. Both come from
  HA's Live TV settings through the feature import (`POST /api/features/import`, which turns Live TV on where
  Mantel has go2rtc), or set them with `PUT /api/features/settings` `live_tv`.
- **`.env`.** `MANTEL_LAN_IP` (go2rtc's WebRTC candidate). On proxmox1, also
  `COMPOSE_FILE=compose.yaml:compose.gpu.yaml` with `MANTEL_RENDER_GID`.
- **The firewall.** The LXC's egress to the tuner (`:80` for the lineup, `:5004` for streams, from go2rtc and
  Mantel), and the tablets' access to `MANTEL_LAN_IP:8555` tcp+udp (PLAN §7's firewall list).
- **HA's own Live TV.** Turn it off in HA, or link HA (then HA runs none of it). Otherwise HA's transcode and
  Mantel's could each take a tuner for the same channel.

## Other gaps

- ~~**HA's own Lovelace energy cards** and the **`markdown` card**~~ done 2026-10-18: Mantel's view host
  draws `markdown` (the Energy page's "Nothing to show yet..." line) and `energy-date-selection`,
  `-sources-table`, `-devices-graph` and `-devices-detail-graph` (shown when the Energy options' `detail`
  is on) with HK's own elements, from `energy/get_prefs` and `recorder/statistics_during_period`
  (`docs/phase2/VIEW-HOST.md`). No cost columns or period comparison.
- ~~**HK Settings → Features pages** read each feature's `<id>/settings/get`, which pages can't send on Mantel.~~
  **Fixed (2026-10-18, [MANTEL-FEATURES.md](MANTEL-FEATURES.md) "Phase 4 ports" item 5):** Mantel answers each page
  for Owners/Admins and stores Notifications', Clean Areas', Energy's and Live TV's saves in
  `house/mantel_features`; Alarm PIN's page is an interim rebuilt read of HA's (saves `not_yet`). Music's is
  Mantel's own settings once Mantel's music engine is on ([MANTEL-FEATURES.md](MANTEL-FEATURES.md) "Music"; its
  saves then go to `house/music` through the gateway), the interim rebuilt read of HA's until then.
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
- **Live TV served by Mantel** (2026-10-18):
  - `tests/test_live_tv.py` (20 tests): a fake go2rtc that behaves as go2rtc 1.9.9 was seen to, and a fake
    tuner (`tools/e2e/fake_tuner.py`). Covered:
    - HA's slug and entity ids; the stream URL can only name the tuner; the templates exist; viewers expire as
      HA's do
    - config and entrypoint (never in the App); the import turns Live TV on only with go2rtc
    - without go2rtc the interim is unchanged
    - the channels and their entities; RBAC (Guest, Child, the wall-tablet grant)
    - a channel plays through go2rtc and stops when nobody watches; a quick re-tune keeps the stream;
      candidates only go into your own session; other cameras still go to HA; go2rtc down is the page's error
    - the viewers sensor; linked mode's entities (through linked_house.py: the count, available cameras, and back when off); the overlay wins over HA's copy; stale
      streams are reaped; the status route

    Also `tests/test_shim_features.py`: the heartbeat in both modes, commands on and off.
  - `tools/e2e/live_tv_e2e.py` (12/12): Mantel from the checkout, the REAL go2rtc 1.9.9 (`mantel-transcode:local`
    with the packaged go2rtc.yaml, read-only, all capabilities dropped) and a fake tuner sending real
    MPEG-2/AC-3. Checked:
    - go2rtc answers the page's offer, and its ffmpeg pulls the channel with Mantel's templates
    - the transcode makes pictures (a JPEG of the H.264 stream)
    - the heartbeat makes `sensor.tv_viewers`
    - closing the player removes the stream and frees the tuner
    - no frame names go2rtc or the tuner
  - `tools/e2e/compose_e2e.py` (19/19, with the scratch HA): the stack now gets a fake tuner service. Through
    Caddy, the first Owner turns Live TV on, the channel list comes from Mantel, the stack's go2rtc answers the
    offer and runs the transcode from `tuner:5004`, closing the player removes the stream, and the page never
    sees go2rtc's or the tuner's address.
- **Not verified:**
  - a real HDHomeRun
  - a browser actually playing: the e2e offer is a hand-made SDP, which go2rtc answers and starts the
    transcode for, but no media flows
  - the VAAPI templates on QuickSync (no `/dev/dri` here; Proof 4 ran the same ffmpeg filters by hand)
  - anything on the house
