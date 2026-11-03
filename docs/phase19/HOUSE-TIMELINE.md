# Phase 19: the House Timeline (plan, 2026-11-03)

**Status: plan; nothing built. Every decision answered by the owner on 2026-11-03 (all recommendations accepted): ready to build.**

## The ask (the owner, 2026-11-03)

- One place that answers "what happened at the house?": a scrolling, searchable record of what matters, not every
  sensor.
- It covers doors and locks, arrivals and departures, the alarm, the garage, doorbell rings, and what the cameras
  saw (person, vehicle, package, animal) with the picture from that moment. It says who did what and from where:
  "Emma turned off the alarm from the hallway tablet". Backups and Mantel's own alerts are in it too.
- It answers "Did the garage get closed?", "When did the package come?" and "Who unlocked the back door at 2 AM?".
- A **morning digest** ("Overnight: front door locked all night, garage opened 6:12, 2 packages") goes out through
  the phase 14 channels and shows on the tablets.

## The answer, in short

One **timeline** on the server. Mantel already sees every change in the house (the state store), every command and
who sent it (the audit), and every camera event (the Protect connector). Today each of those is thrown away or kept
for its own purpose. The timeline listens to all three, keeps the ones that matter in one small table, and shows
them back through the same roles the rest of Mantel uses.

Most of the parts already exist:

- **Every state change.** `hub.on_change(changed)` in `server.py` is called for each batch of entity ids from
  `subscribe_entities`. `state.py` holds the new states, with `lc` (when the state last changed, from Home
  Assistant's clock). `hk_core/notifications/rules.kind_of` already sorts an entity into a kind (door, lock, garage,
  doorbell, person detection, leak...) from its domain and device class, and `accessories.name_of` names it.
- **Who did what, from where.** `action_audit` rows (`gateway.Audit.record`) hold the person, the tablet, the door
  (LAN, tunnel or Home Assistant's sidebar), the action (`lock.unlock`), the targets and the result. Service data
  (an alarm code) is never stored.
- **Camera events.** `protect_api.EventStream` yields `ProtectEvent`s (ring, motion, person, vehicle, animal,
  package) with a start and an end. `ProtectConnector.on_event` already gets each one. Stills come from
  `ProtectConnector.snapshot` or, for a camera Home Assistant owns, from `notify_snaps.take_from_ha`.
- **Pictures kept on disk.** `notify_snaps.SnapStore` is the pattern: random 32-hex ids, folder 0700, files 0600,
  an expiry, a serve route that decides with `Authz.may_still`, and one answer (404) for unknown, expired and
  refused.
- **Roles.** `rbac.py` and `authz.py`: the person's grants cut by the tablet's, `Gate.visible(entity)`, `decide(...,
  "history", ...)`, `may_still(principal, camera)`. The timeline adds no role table; it asks these.
- **Delivery.** The phase 14 alert center (`alerts/center.py`) already batches, honors each channel's quiet hours,
  retries and logs. The digest is one more message through it. `Pusher.deliver` carries it to the Mantel apps.
- **Housekeeping.** `db.py` migrations (latest is `0032_push_platform`, so this is `0033` unless another lands
  first), `backup.py` (the whole database rides in every backup), `performance.STATS` (About → Performance),
  `mcp/tools/` (assistants), `user_data.py` (a person's own switches), the settings kit (`web/shim/settings/kit.js`).

What's new: the catalog that picks what matters, the table, the writer, the pictures, the filtered API, the Timeline
page, the Home Grid block, the camera sheet's strip, the Settings page, the digest, two MCP tools.

**Where it runs:** the server, in all three installs (HA App, LXC, Docker). In the HA App there is no direct Protect
connection (`cameras_direct` runs on Docker and the LXC only), so camera events come from Home Assistant's own
detection sensors and pictures from `camera_proxy`, which `notify_snaps.take_from_ha` already does. HK Frontend
inside Home Assistant doesn't get the timeline, as with the alerts.

## What it doesn't do

- **Record every sensor.** No temperatures, lights, power, plain motion on a camera that has smart detection, or
  media players. Those are Home Assistant's history. The catalog below is the whole list, and the Owner can add or
  remove single entities.
- **Play back video.** The public Protect API has no clip export (see "Pictures and clips"). Rows carry pictures,
  not video.
- **Count parcels.** "2 packages" is two package events at least 30 minutes apart on a camera. A courier leaving two
  boxes at once is one. The digest says "package deliveries", not "packages".
- **Fill in the past.** It starts empty on the day it's built. Home Assistant's history has no per-person rules and
  isn't in Mantel's read-only allowlist (`ha_client.ALLOWED_TYPES`), so there is no backfill.
- **Tell you the moment it happens.** That is the Notifier's job (doorbell, doors, leaks) and the alert center's
  (Mantel itself). The timeline is the record; the digest is the summary.
- **Show a person's arrivals to anyone they've hidden them from.** See "Who sees what".
- **Publish anything to Home Assistant.** No entities, no Mantel Link change.

## The design

### What matters: the catalog (`hk_core/timeline/classify.py`)

The decisions live in `hk_core` (Rule 2): a pure function takes an entity's domain, device class, object id, registry
entry and area, and answers a **family** and a **kind**, or nothing. It builds on `rules.kind_of`, so a door sensor
is a door the same way it is for notifications. No per-entity setup is needed.

| Family | Comes from | A row says | New house |
|---|---|---|---|
| **Doors** | `binary_sensor` door, garage door, opening | "Back Door opened", "closed" | on |
| **Windows** | `binary_sensor` window | "Loft Window opened" | **off** (a house with 20 window sensors would drown the rest) |
| **Locks** | `lock`; `valve` (the water shutoff) | "Back Door unlocked", "locked", "jammed" | on |
| **Garage** | `cover` garage or gate | "Garage opened", "closed" (the settled states; opening and closing are skipped) | on |
| **Alarm** | `alarm_control_panel` | "Alarm armed away", "disarmed", "triggered" (pending and arming are skipped) | on |
| **Arrivals** | `person` | "Emma arrived home", "left home" (the home zone only) | on |
| **Doorbell** | `event` doorbell, doorbell sensors, Protect `ring` | "Someone rang Front Door" | on |
| **Detections** | detection sensors (`rules.kind_of`: person, vehicle, animal, package) and Protect smart detections | "Person at Driveway", "Package at Front Door" | on |
| **Motion** | motion on a camera that has **no** smart detection (`Camera.motion_only`), in bursts | "Motion at Garden Cam (14 times, 2:10 to 2:40 AM)" | on for those cameras only |
| **Safety** | moisture, smoke, carbon monoxide, gas (`rules.IMPORTANT`) | "Leak at Kitchen Sink", "clear" | on |
| **System** | the alert center (`Center.listeners`) and backups | "Backup finished", "Home Assistant disconnected", "...is back" | on; Owner and Admin only |
| **Refused** | `action_audit` rows with `decision = denied` for locks, the alarm and the garage | "Hallway tablet tried to unlock Back Door; refused" | on; Owner and Admin only |

**Which entities.** An entity is a candidate when it isn't disabled or hidden, has no `entity_category`, and isn't one
of Mantel's own detection entities (`ProtectConnector.local.mine`: the Protect tap speaks for those). Its device
class is the registry's choice over the integration's (`Entity.device_class or original_device_class`), else the
state's `device_class` attribute. The result is `members: dict[entity_id, Member]` (family, kind, label, area, camera),
worked out again on `Hub.on_registry` and when a state arrives for an entity not seen before, the same way
`Notifier.refresh` does it.

**Owner overrides** (`timeline_settings`, key `overrides`): `{entity_id: {record: bool, family?, label?}}` plus a
switch per family. Settings → Timeline lists "Not recorded" candidates (a `binary_sensor` with no class) so a plain
contact sensor can be added by hand.

**Words** are `hk_core/timeline/words.py`, pure: `title(family, kind, label, facts)`. A row keeps the title it was
written with, so renaming a lock later doesn't rewrite history, and a deleted entity's rows still read.

### Storage (migration `0033_timeline.sql`)

```
timeline_events
  id         INTEGER PRIMARY KEY AUTOINCREMENT
  src        TEXT NOT NULL UNIQUE      -- 'ha:<entity>:<lc>' or 'pt:<event id>:<kind>' (INSERT OR IGNORE: a reconnect never doubles a row)
  at         REAL NOT NULL             -- when it happened (HA's lc, or Protect's start), epoch s
  ended      REAL                      -- detections and bursts: when it stopped
  family     TEXT NOT NULL             -- door | window | lock | garage | alarm | arrival | doorbell | detection | motion | safety | system | refused
  kind       TEXT NOT NULL             -- opened | closed | locked | unlocked | armed_away | disarmed | arrived | left | ring | person | vehicle | ...
  level      TEXT NOT NULL DEFAULT 'info'      -- info | warning (jammed, triggered, leak)
  entity     TEXT                      -- the HA entity, or the camera entity for a camera's row
  area       TEXT                      -- area id when written
  title      TEXT NOT NULL             -- "Back Door unlocked", as written
  search     TEXT NOT NULL             -- lowercase words of title, area name and device label; never a person's name
  detail     TEXT NOT NULL DEFAULT '{}'-- small JSON: count, late (caught up after downtime), zone, keypad slot
  person     TEXT                      -- the person (users.id) an arrival row is about
  actor      TEXT                      -- users.id who did it (from the audit), when known
  actor_name TEXT                      -- their name when written; 'A former member' after they are removed
  device     TEXT                      -- the tablet's id when it was done at one
  device_name TEXT
  how        TEXT                      -- tablet | app | home | away | ha_sidebar | assistant | hand_or_automation
  audit_id   INTEGER                   -- the action_audit row, for Owners and Admins
timeline_pics
  id     TEXT PRIMARY KEY              -- 32 hex, random (SNAP_ID's shape)
  event  INTEGER NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE
  camera TEXT NOT NULL                 -- the camera entity (camera.mantel_* for a direct one)
  at     REAL NOT NULL
  size   INTEGER NOT NULL
timeline_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated REAL NOT NULL)   -- as alert_settings
timeline_digests(day TEXT PRIMARY KEY, sent REAL, body TEXT NOT NULL)                 -- the house's day, 'YYYY-MM-DD'
```

Indexes: `(at)`, `(family, at)`, `(entity, at)`, `(person, at) WHERE person IS NOT NULL`, `(actor, at) WHERE actor IS
NOT NULL`. `PRAGMA foreign_keys = ON` is already set in `db.connect`, so deleting an event deletes its picture rows.
Search is `LIKE` over `search`, which is plenty: 30 days is about 20,000 rows. No full-text index.

**Size.** A row is about 300 bytes. A busy house writes 300 to 600 rows a day, so 30 days is about 5 MB and a year is
under 70 MB. Rows are not the budget; pictures are.

**Retention.** Rows: 30 days by default; Settings offers 7, 30, 90 or 365 days. A pruner runs at start and once an
hour (`Timeline.prune`): it lists the pictures of expired events, deletes their files, then deletes the rows. Unlike
`action_audit` there are no append-only triggers: the timeline is a convenience record, not evidence, and the audit
stays the source of truth for who did what.

**Pictures on disk:** `<data_dir>/timeline/<yyyy-mm>/<id>.jpg`, folders 0700, files 0600, written with
`O_EXCL` like `SnapStore.put`. They aren't sealed with `atrest.SecretBox` (the same as photos and notification
snapshots; the data folder is private and backups are encrypted). Details under "Pictures and clips".

### The write path (`hosts/server/mantel_server/timeline/`)

The rule: **nothing on the hub's hot path waits for the disk.**

1. **A tap, not a wrapper.** `Hub.on_change` gets a small `taps: list` that it loops over after the sessions. The
   timeline's tap does `hit = changed & members.keys()`. On a 5,000-entity house with a few hundred catalog members
   that is a set intersection per batch. Only a hit does more work: it compares the new state to the last one
   recorded for that entity (`self.last[entity] = (state, lc)`), ignores attribute-only changes and `unavailable` and
   `unknown`, and builds a `Row`. Each tap is wrapped in `try/except` and logged without names, as the Protect
   connector's hooks are.
2. **A queue, a writer.** Rows go into a bounded `deque` (5,000). One task flushes every 2 seconds or at 50 rows, in
   one transaction (`with db:` and `executemany` with `INSERT OR IGNORE`) on the loop, the same connection every other
   table uses; a 50-row batch in WAL mode is a few milliseconds. The writer measures itself into
   `performance.STATS.timeline(tap_ms, write_ms, queued, dropped)`. A full queue drops the oldest **noise** (motion
   bursts) first, then the oldest row, and counts it. It never blocks the tap.
3. **Rollups, so noise doesn't bury the record.**
   - A detection is one row from its start to its `end`; the later `end` is an `UPDATE` of that row
     (`event_id -> row id` is kept in memory for `ACTIVE_MAX_S`, 120 s, as the connector does).
   - Motion on a motion-only camera is one row per camera per 10 minutes, with a count.
   - A sensor that changes more than 6 times in 5 minutes becomes one "keeps changing (N times)" row until it's quiet
     for 10 minutes (the alert center's flapping rule, applied to rows).
   - Package detections on one camera within 30 minutes are one row.
4. **Catching up after a gap.** The first snapshot after a (re)connect touches every entity (`replace_all`). For each
   member the tap compares Home Assistant's `lc` with the newest row for it (read once at start into `last`). A state
   that changed while Mantel was off is written once, at its real time, with `detail.late = true`, and the page says
   "while Mantel was off". The `src` key makes this idempotent.
5. **Who did it.** `Audit` gets a second listener list, `commands`, called from `Audit.record` for rows with a target
   (today only `config` rows have listeners). The timeline keeps the last 60 seconds of allowed command rows in memory,
   keyed by entity. When a lock, cover or alarm row is written, it claims the newest matching audit row (same entity,
   same family of service, `ok` or not yet finished, within 30 seconds before the change) and copies the person, the
   tablet's name, the door and the audit id. A row with no match says **"by hand or an automation"** (a keypad, a key,
   a schedule). A lock that reports `changed_by` adds it as `detail.keypad`. Mantel's own commands from an MCP assistant
   say "through an assistant for Emma" (`via`).
   - *Best effort, slice 19.8:* the state's context (`c` in the compressed state, dropped by `state.normalize`) may tell
     a person in Home Assistant's app from an automation. That is **unverified** (see "Verification"); until it is
     checked on the scratch Home Assistant, the label stays "by hand or an automation".
6. **Refused commands.** The same listener sees `decision = denied` rows for locks, the alarm and the garage and writes
   a **Refused** row (Owner and Admin only).
7. **System rows.** `Center.listeners` already gets each raise and clear sent; a listener turns those into **System**
   rows ("Home Assistant disconnected", "...is back", "Backup finished"). The same text the alert shows.
8. **Camera events.** `ProtectConnector` gets a `listeners` list called at the top of `on_event`, before the
   `NOTIFY_KINDS` and `picked()` filters that decide notifications, because what's recorded isn't what's notified.
   `ProtectConnector.speaks_for(entity_id)` (new) answers "is a direct source preferred for this camera and is its
   socket up", so the state path **skips Home Assistant's own detection entity of a camera Protect already speaks
   for** and one detection is one row, never two. `takes()` is not reused: it also holds back kinds Notify For
   leaves out, and the record shouldn't depend on notification preferences.

### Pictures and clips (`timeline/pictures.py`)

**Clips: the public API has none.** Mantel talks to Protect's public Integration API (`protect_api.py`, `X-API-KEY`,
`/proxy/protect/integration/v1/...`). Everything it offers that Mantel uses is: cameras, `snapshot` (with
`highQuality`), `rtsps-stream`, `talkback-session`, and the live `subscribe/events` and `subscribe/devices` sockets.
Event history and video export (`get_camera_video`, `get_event_thumbnail`, `get_events_raw` in the `uiprotect`
library) are on the **private** API (`/proxy/protect/api`), which does not accept an API key and needs a user
password. The phase 13 rule is the public API only, with no password stored. So: **snapshots only.** See "Sources"
for the evidence and what's unverified. If Ubiquiti adds export to the public API, a clip is one more picture kind.

**A filmstrip instead.** Instead of one still, a detection gets a short strip:

- A **ring**: one picture at once, a second 4 seconds later (the visitor steps up).
- A **person, vehicle, animal or package**: the first picture 1.5 seconds after the event starts (Protect fires the
  event when the object enters the zone, often before it is well in view), and, if the event is still going, a second
  at +6 seconds. Frames per event is a setting (1 to 3, default 2).
- A **motion** burst, a door, a lock: no picture. (An option for a door or lock with a camera in the same area is a
  later idea, not this phase.)

**Where a picture comes from.** `Pictures.take(camera_entity)` does what `connectors/camera_still.py` does for
`GET /api/camera/<entity>/still`: a direct camera goes to `DirectCameras.still` (Protect's own snapshot through
`ProtectConnector.still_provider`, which is paced by the console's 10-a-second bucket), a Home Assistant camera to
`camera_proxy` with Mantel's own credential (`camera_still.read_image`). The bytes are shrunk to 640 px on the long
side, JPEG quality 70 (about 40 to 60 KB; Protect's own still is about 400 KB) by a new top-level function
`image_work.shrink(data, edge, quality)` next to `make_variant`, run through `imaging.run` so the image worker, not the
loop, does the decode. A camera that gives nothing in time (6 s, `SNAP_TIMEOUT_S`) leaves the row without a picture.
If the notification for the same event already took a snapshot (`SnapStore`), the timeline copies those bytes instead
of asking the camera again.

**Budget.** About 70 detection events a day on a 5-camera house is 7 MB a day, or 210 MB over 30 days. The default
**picture budget is 500 MB** (Settings → Timeline). Past it, the oldest pictures go first and their rows stay ("Picture
not kept"). Pictures stop being taken while the alert center has `disk.low` up. Pictures kept, taken and failed are
counted (as `SnapStore.status` does) and shown under About → Performance.

**Serving.** `GET /api/timeline/pic/{id}` is `notify_snaps.serve` again: 404 for unknown, expired and refused alike;
the camera rule is `Authz.may_still(principal, camera)` plus the row being visible to the person; `Cache-Control:
private, max-age`, `X-Content-Type-Options: nosniff`. No picture ever goes to a channel or the MCP.

### Who sees what

There is no new role table. A person (or a wall tablet) sees a row when the existing engine says so.

1. **The page itself** is a new RBAC *feature*, `timeline`, in `rbac.FEATURE_DOMAINS`. The default roles that already
   grant everything (Owner, Admin, Adult) get it. **Child and Guest do not** (their roles don't grant features they
   don't name), and an Owner can grant it to a Child by hand. The Wall Tablet role gets `view` on `timeline` for the
   limited view below.
2. **Each row** is checked with `policy.decide(subject, "view", entity)` through the viewer's `Gate` (cached per entity
   within one request). A row about a lock is invisible to someone who can't see that lock; a Child's role already
   denies locks, the alarm, the garage and cameras, so even a Child who is granted the page never sees them. A
   camera-derived row (a detection, a ring) needs `Authz.may_still(principal, camera)`, so the tunnel's camera switch
   applies as it does to live view.
3. **Names.** Who did it is shown only when the viewer is a signed-in Owner, Admin or Adult (the viewer has a user and
   `decide(..., "history", entity)` allows). The audit id only to Owners and Admins. A wall tablet alone sees no names:
   "Back Door unlocked 2:04 AM", nothing more.
4. **System and Refused rows** are Owner and Admin only, as the alerts are.
5. **Arrivals and departures** need `view` on the `person` entity (the `locations` feature, which Guests are denied),
   and the privacy switch below.
6. **The wall tablet's limited view.** A Wall Tablet with nobody signed in sees the last 12 hours of Doors, Locks,
   Garage, Alarm, Doorbell and Detections for the kinds the Owner picks (Settings → Timeline → Wall Tablets), **without
   names and without pictures** (a screen anyone in the room can read). A switch turns pictures on per tablet. No
   search, no Arrivals. A person signed in at the tablet sees what the person ∩ the tablet allows, as everywhere.

**Each person can hide their own arrivals and departures.** Me gets **Keep My Arrivals Private** (a `user_data` key,
`timeline_private`, in `user_data.KEYS` and the web list a test pins). When it's on, an arrival or departure of that
person is **not recorded at all** (not recorded, rather than hidden: nothing to leak, nothing for an Owner to
un-hide), the person's past arrival rows are deleted when they turn it on (after asking), and the digest never
mentions them. The person is matched to the `person` entity by the entity's `user_id` attribute and `ha_links`. A
`person` entity that matches no Mantel person is recorded and visible to Owners, Admins and Adults only. **Children
don't get the switch**: the Owner decides, because a child's arrival is the parents' to see. Doors, locks and
detections can't be hidden by a person; they're about the house.

**Forgetting a person.** When a person is removed, their `actor` and `person` columns are cleared, their name in
`actor_name` becomes "A former member", and their arrival rows are deleted.

**Reading is not audited** (like Performance); every change is: `timeline.settings.saved`, `timeline.overrides.saved`,
`timeline.cleared`, `timeline.presence.cleared`, `timeline.digest.test`, written before the change by `audit.config`.

### The API and live feed

Every route has `@guard(...)` (Rule 7); `tests/test_route_guards.py` walks them.

| Route | Guard | What |
|---|---|---|
| `GET /api/timeline` | `signed_in`, `device_ok`; the handler checks the feature | The page. Filters: `family`, `camera`, `area`, `entity`, `q` (words), `since`, `until`, `actor` (only if the viewer may see names), `mine`, `before` (an id), `limit` (50, at most 100). Answers `{events, next_before, limited}`. It reads rows in chunks and filters by the viewer until it has `limit` or has scanned 2,000, then returns a `next_before` to continue. |
| `GET /api/timeline/summary?window=overnight\|today\|24h` | same | Counts and the digest lines for a window, for the block. |
| `GET /api/timeline/pic/{id}` | `signed_in`, `device_ok` | One picture (above). |
| `GET /api/timeline/settings` | `manager` | Families, retention, budget, wall view, digest, overrides, and the "Not recorded" candidates. |
| `PUT /api/timeline/settings`, `PUT /api/timeline/overrides` | `owner`, `fresh="away"`, never a tablet | Audited first. |
| `POST /api/timeline/digest/test` | `owner`, `fresh="away"` | Sends this morning's digest now to the channels that take it. |
| `DELETE /api/timeline?before=` | `owner`, `fresh="always"`, never a tablet | "Clear Timeline" (typed confirmation). Pictures too. |
| `DELETE /api/timeline/mine/presence` | `person` | A person clears their own past arrivals. |

**Live.** A page reads the first screen with `GET /api/timeline`, then subscribes through a hub read route
(`timeline/subscribe`, like `frontend/subscribe_user_data`) registered with `Ctx.keep`, so it's in `app["live"]` with a
`recheck()`: a revoked session or a changed role closes it at once (Architecture, "Long-lived connections"). Each new
row is filtered for that viewer before it's sent. A row's later `end` or pictures arrive as an `update` frame.

### The views

- **The Timeline page** (`web/hk/cards/hk-timeline.js`; reached from the Home menu and a chip). Newest first, grouped by
  day ("Today", "Yesterday", a date) and by hour inside a busy day. Each row: an icon by family, the title, the time,
  the area, "Emma · hallway tablet" when shown, and a thumbnail strip. Tap a row for a sheet with the full pictures
  (swipe between frames), the exact time, the door it was done from, and "Show all for this camera/door". A filter bar
  (Doors, Locks, Garage, Alarm, People, Doorbell, Cameras, System), a search field, a day jump, and "Only mine" for
  what a person did. Touch first: 44 px rows, no hover-only controls (the owner's main device is an iPad on Safari,
  which reports itself as a Mac). It works inside the iPhone, iPad and Mac apps as a Mantel page, with no native work.
  How the page is registered follows the Music page (`feature_pages.py`, `hk-pages-screen.js`); the building session
  reads both first.
- **Home Grid block "Recent"** (`timeline` in `web/hk/cards/hk-grid-catalog.js`, mirrored in
  `hk_core/settings/home_grid.py` CATALOG, with the test that pins them). Sizes Wide, Large and Extra Large. The last
  5 to 12 rows; **Auto** mode shows the morning digest from 5 to 11 AM and the latest rows after. Tap opens the page.
  On a wall tablet it is the limited view.
- **The camera sheet.** Under a camera's live view (`hk-cameras.js`), a "Recent" strip: the last 10 events for that
  camera (`GET /api/timeline?camera=`), each with its pictures. Same rules.
- **The apps.** iPhone, iPad and Mac show the same pages. A push for the digest carries a link to the page.
- **Mantel Settings → Timeline** (`web/shim/settings/timeline.js`, the settings kit, `#/mantel/timeline`,
  `admin_page` section `timeline` for Owners and Admins): what's recorded (a switch per family, the "Not recorded"
  list), Retention, Pictures (budget, frames, usage), Wall Tablets, Morning Summary, **Clear Timeline**. The Owner
  changes; Admins read.
- **Me**: Keep My Arrivals Private (adults), Morning Summary (for the apps), Clear My Arrivals.

### The morning digest (`hk_core/timeline/digest.py`, `timeline/digest.py`)

**Content.** A pure function turns a window's rows and the house's current states into lines. No language model; fixed
templates, tested. For an overnight window (from 9 PM, a setting, to the digest time):

> Overnight at the house (9 PM to 7 AM)
> - Front door and back door locked all night.
> - Garage opened 6:12 AM, closed 6:20 AM.
> - 2 package deliveries at Front Door.
> - 3 people and 1 vehicle at Driveway.
> - Alarm armed 10:02 PM, disarmed 6:30 AM.
> - 1 alert: Kitchen tablet offline 1:10 to 1:25 AM.
> - Right now: all locks locked, garage closed.

"Locked all night" is true only if the lock's state was locked at the window's start, no unlock row is in the window,
and it's locked now. A lock or the garage left open at digest time leads the list in words that say so ("Garage is
still open"). A quiet night is one line ("A quiet night. Everything is locked and closed.").

**Two versions.**

- **The house version** goes to **alert channels** (Discord, Telegram, email...). Those channels are shared and the
  services can read the text, so it holds house facts only: no person's name, no arrivals, no "who", no pictures. It
  uses the phase 14 center: a new alert group **House** and a kind `house.digest` (`once`, Info, off for a new channel)
  in `alerts/catalog.py`, so each channel picks it in Settings → Alerts → Events and honors its own quiet hours (an
  Info message waits until quiet hours end, then goes). One `Center.raise_("house.digest", day, {...})` per day.
- **The personal version** goes to **the Mantel apps** for a person who turned on **Morning Summary** in Me (off by
  default). It is built for that person's view (RBAC-filtered, their own and others' arrivals if they may see them),
  sent through `Pusher.deliver` as an Info push with a link to the page. Sealed end to end like system alerts.

**When.** 7:00 AM house time, a setting; the window start is a setting (default 9 PM). The center's `tz()` and the
house's local time decide. It's sent once a day (`timeline_digests.day`); a restart at 7:05 sends it if it wasn't sent
and 7 AM has passed, but not after noon. **On the tablets**, the block's Auto mode and the page's top card show the
stored digest.

### Performance (a 5,000-entity house)

- **Hot path:** one set intersection per `hub.on_change` batch. Budget: p95 under 0.2 ms per batch with 5,000
  entities, 300 members and 500 changes a second (a synthetic test). Nothing waits for the disk.
- **Writer:** one transaction per 2 seconds or 50 rows; p95 under 15 ms. Queue cap 5,000, drops counted.
- **Reads:** index scans; a page of 50 under 20 ms warm on a 30-day table.
- **Pictures:** off the loop (image worker), paced by the console's bucket, at most 2 in flight; never when
  `disk.low` is up.
- **Measured and shown:** About → Performance gets a `timeline` block (tap p95, write p95, queued, dropped, rows,
  picture MB), from `performance.STATS`, alongside the hub's fan-out. The baseline gets a new table after the first
  run on the house (`docs/development/Performance-baseline.md`: "after the Timeline"), with the decision rule it
  already uses: look again if the tap passes 1 ms or the write passes 50 ms.

### Backup and restore

The tables are in the database, so every backup (`backup.py`, `snapshot_db`) already carries them. A restore brings the
rows back. **Pictures are not in backups by default** (up to 500 MB that is 30 days old and replaceable);
Settings → Backups gets **Include Timeline Pictures**, off, which adds `timeline/` to `create_backup` like `PHOTOS_DIR`.
A restored row whose file is missing shows "Picture not kept". A restore with another at-rest key changes nothing here
(nothing is sealed).

### Privacy in logs

Log lines carry counts, family names, entity ids and durations, never a person's name, a title, a search word, a
picture, a camera's address or a Protect key. A test (`caplog`) runs a full session with fictional names and asserts
none appears in any log record. The write queue's drop warnings say "dropped 12 rows", nothing else. Errors from the
Protect or camera fetch use the `kind` words `protect_api` already has.

### MCP (phase 12)

`mcp/tools/timeline.py`, read scope, run as the caller's own principal so an assistant sees exactly what that person
sees (no names for a wall tablet's principal, no System rows for an Adult):

- `timeline_find`: the page's filters (`family`, `q`, `since`, `until`, `area`, `camera`, `actor`, `limit`,
  `before`). "Who unlocked the back door at 2 AM?" is `family: lock, q: back door, since, until`.
- `timeline_digest`: the digest text for a window, as that person's version.

Never pictures. A change tool is not needed; the settings stay in Mantel Settings.

### HA App, LXC, Docker

| | HA App | LXC | Docker |
|---|---|---|---|
| Camera events | Home Assistant's detection sensors | Protect's events socket (direct), HA's for cameras it alone has | the same as the LXC |
| Pictures | `camera_proxy` through Mantel's HA credential | Protect's snapshot, else `camera_proxy` | the same |
| Where pictures live | `/data/timeline` | `<data_dir>/timeline` | the data volume |
| Digest | channels and apps | channels and apps | channels and apps |

The disk-low alert already watches the data folder. Picture budget is the same 500 MB in all three.

## How it's built (models and effort, the owner, 2026-11-03)

To save on usage:

- **The building session runs Opus 5.5 at Medium effort.** It writes the write path (tap, writer, rollups, catch-up),
  makes the design calls and reviews what agents bring back.
- **Agents run Sonnet 5.5 at High effort** (`model: "sonnet"`, `effort: "high"`): the classifier and wording, the
  Protect tap and pictures, the Timeline page, the block and the camera strip, the Settings page, the digest, the MCP
  tools, the tests, the guide and the screenshots, each with a brief that names its files and what done looks like.
- **Opus 5.5 for an agent only when it really needs it.** One case: the **privacy and RBAC review** after 19.2 and
  again before the push (rows visible only to who may see them, names withheld from wall tablets, hidden arrivals
  never written, pictures behind `may_still`, nothing personal in logs, the 404 that reveals nothing). A mistake there
  is a leak between family members, so the review is worth the extra cost.
- **The session finishes everything without stopping.** Every question for the owner is in "Decisions" below with a
  recommendation. Something unforeseen: take the safest choice consistent with those decisions (the more private, the
  more reversible, the cheaper to undo), write it in a **Build log** at the end of this file with the reason, and
  continue. Stop only for what only the owner can physically do (nothing is planned; the iPad is checked with WebKit).
- **Validate and verify throughout.** Each slice ends with its tests and `tools/ci.py quick`; `tools/ci.py full` runs
  before each push. A review agent reads each slice's diff (a different agent from the one that built it). UI slices
  get WebKit screenshots at three sizes (iPad portrait, iPad landscape or desktop, phone) with touch, because iPad
  Safari is the owner's main device. Nothing is pushed with a private word in it: `tools/check_private.py`. Finished
  work goes to origin/main (fetch and merge first, never force). Releasing to the house waits on decision 20.
- Read `docs/development/Rules.md` and `Architecture.md` first; write each route's guard before its handler.

## Slices

| Slice | What | Size | Needs |
|---|---|---|---|
| 19.0 | The foundation: migration `0033_timeline.sql`, `hk_core/timeline/` (classify, words), the store, `Hub.taps`, the state tap, queue and writer, rollups, catch-up after downtime, retention, `performance.STATS.timeline`; sources: doors, locks, garage, alarm, arrivals (with the privacy key), safety, System (alert center) | L | |
| 19.1 | Camera events and pictures: `ProtectConnector.listeners` and `speaks_for`, the HA detection path, `Pictures.take`, `image_work.shrink`, the filmstrip, budget and pruning, the serve route | M | 19.0, phase 13 |
| 19.2 | The API: `timeline` feature in `rbac.py`, the filtered `GET /api/timeline`, `summary`, `pic`, the live subscription, who-did-it from the audit (`Audit.commands`), Refused rows, guards, audit rows, forgetting a person. **Opus privacy and RBAC review** | M | 19.0, 19.1 |
| 19.3 | The Timeline page: rows, days, filters, search, the detail sheet, the picture strip, empty and error states; WebKit at three sizes | L | 19.2 |
| 19.4 | The Home Grid block "Recent" (catalog, `home_grid.py` mirror, test), the camera sheet's strip, the wall tablet's limited view; `sheet_review.py` | M | 19.3 |
| 19.5 | Mantel Settings → Timeline and Me's switches (Keep My Arrivals Private, Morning Summary, Clear My Arrivals), Clear Timeline, overrides | M | 19.2 |
| 19.6 | The digest: `hk_core/timeline/digest.py`, the **House** alert group and `house.digest`, the apps' personal version, the block's Auto mode, Send Test | M | 19.2, phase 14 |
| 19.7 | MCP tools, backup option, About → Performance block, the guide (`docs/guide/Timeline.md`, a line in `Backups.md` and `Push-Notifications.md`), gallery screenshots | S–M | 19.1–19.6 |
| 19.8 | Best-effort attribution from Home Assistant's context (a person in HA's app vs an automation), only if the scratch HA shows it works | S | 19.2 |
| 19.9 | The 5,000-entity performance run, the second Opus review, `tools/ci.py full --all`, push, and (decision 20) the release | S | all |

**The first release:** 19.0 to 19.7. 19.8 is optional and can follow.

## Tests

- `tests/test_timeline_classify.py` (`hk_core`, plain): every row of the catalog table from domain, class and object
  id; windows off; diagnostic, hidden and disabled entities skipped; Mantel's own detection entities skipped; overrides.
- `tests/test_timeline_store.py`: migration applies on a fresh database and on a copy of the house's schema; `INSERT OR
  IGNORE` on `src`; retention and the pruner delete files before rows; the cascade; the budget removes the oldest
  pictures and keeps rows; search matches `search` only.
- `tests/test_timeline_sources.py`, on a fake clock and fake hub: a lock change becomes a row at `lc`; attribute-only
  changes and `unavailable` don't; rollups (detection end updates its row, motion bursts, flapping, package within 30
  min); catch-up after a gap marks `late` and doesn't repeat; the audit correlation (match within 30 s, none after,
  the wrong entity, a denied row becomes Refused); a Protect event becomes one row, and Home Assistant's own sensor of
  the same camera doesn't double it; replay of `tests/fixtures/protect/events.jsonl`; queue full drops noise first.
- `tests/test_timeline_api.py`, the matrix: Owner, Admin, Adult, Child, Child with the page granted, Guest, a wall
  tablet alone, an Adult at a wall tablet, a tunnel door without camera access. For each: which families, names,
  pictures, System and Refused rows. A hidden person's arrival is never written and their old rows are gone; a
  removed person's rows lose their name; `limited` for a wall tablet; search can't find a name the viewer can't see;
  `actor=` is refused for them; unknown, expired and refused pictures all 404 with the same body; roles, step-up,
  audit-first (503 `audit_unavailable` changes nothing) and CSRF on every write; the live feed closes on revoke.
- `tests/test_timeline_digest.py`: wording for each case (locked all night, unlocked once, garage open now, a quiet
  night, packages, counts), the house version has no name and no arrival, the personal version follows RBAC, once a
  day, the restart rule, quiet hours through the center.
- `tests/test_timeline_perf.py`: 5,000 entities, 300 members, 500 changes a second for 60 s: tap p95 under 0.2 ms, write
  p95 under 15 ms, no growth in queue, hub fan-out unchanged within noise.
- `tests/test_timeline_logs.py`: the `caplog` sweep for names, titles and keys.
- `tests/test_timeline_settings.py` (the page in node), `tests/test_boundaries.py` and `tests/test_route_guards.py`
  (they pick up the new files), the home-grid mirror test, `user_data` key pin, the MCP tools' schema tests, the backup
  and restore test (rows come back, pictures only with the switch).
- Run with `tools/ci.py` (quick while building, full before pushing; worktree headless checks need `PYTHONPATH`).

## Verification

- **The scratch Home Assistant** (`tools/testha/`) with a fake lock, door sensor, garage cover, alarm panel and `person`
  entities flipped by script; the timeline must show each once, in order, at the right time, and a Mantel restart in
  the middle must catch up.
- **A Protect replay** of the recorded events (`tests/fixtures/protect/`) through the connector with a fake
  `snapshot`; one ring is one row with two pictures. The house's console is not used while building.
- **Commands** are off in tests (Rule 3). Who-did-it is checked with the gateway's fake HA connection that sends
  nothing: allowed command, then the state change, then the row.
- **WebKit screenshots** (`tools/headless/gallery.py`, seeded with fictional people, doors and cameras; fixtures use
  invented names only) of the Timeline page, its sheet, the block, the camera strip and Settings → Timeline, at an
  iPad portrait size, an iPad landscape or desktop size, and a phone, with touch emulation. `sheet_review.py` after the
  camera sheet changes. The screenshots are looked at, not only taken.
- **The privacy sweep** (Opus agent): read every query for a missing visibility check; try each role against each
  route; try a hidden person's arrival; try `q` with a name; try a picture id from another camera.
- **The performance run** at 5,000 synthetic entities, with the numbers written to the baseline file.
- **The first real run** (if released): the house's own Mantel after the update, a day of rows, the morning digest
  read against what really happened.

## Definition of done

- Every row of the catalog table records from a real or replayed event, with the right words, and noise is rolled up.
- The six questions in the ask are answered from the page: garage closed, package time, who unlocked at 2 AM, alarm
  by whom and where, the doorbell with a picture, a detection with its filmstrip.
- Roles hold: the matrix test is green, the Opus review has no open finding, nothing in a log names a person.
- Hidden arrivals are never written; removed people are forgotten.
- The digest goes out through a test channel and the apps on a schedule, house version without names.
- The page and block work at the three sizes on WebKit with touch; the camera strip and wall limited view too.
- The hot path is within budget at 5,000 entities, shown in About → Performance, and recorded in the baseline.
- Backup and restore carry the rows; the pictures switch works.
- `tools/ci.py full` passes; pushed to origin/main with no private word; the guide and screenshots exist; the Build log
  is filled in. Released only under decision 20.

## Decisions for the owner

**Decided 2026-11-03:** the owner accepted every recommendation below, the release decision included. The building session takes each recommendation as the answer and does not ask again.

| # | Question | Recommendation |
|---|---|---|
| 1 | Call it **Timeline**: a page, a Home Grid block named **Recent**, and a Settings page beside Alerts? | **Yes** |
| 2 | What's recorded for a new house? | **Doors, Locks, Garage, Alarm, Arrivals, Doorbell, Detections (person, vehicle, animal, package), Safety, System, Refused.** Windows off. Plain motion only on cameras with no smart detection. Any family or entity can be changed in Settings |
| 3 | Retention for rows? | **30 days**, with 7, 30, 90 and 365 as the choices |
| 4 | Pictures: how many, how much disk? | **2 frames per detection (1 to 3), 640 px, a 500 MB budget**, oldest first, rows kept; stopped while `disk.low` is up |
| 5 | Video clips? | **Snapshots only.** The public Protect API has no export, and the private API needs a password Mantel doesn't keep. Add clips if Ubiquiti adds export to the public API |
| 6 | Who may open the Timeline? | **Owner, Admin, Adult.** Not Child or Guest by default (an Owner can grant a Child; they'd still see only what their role lets them view). Each row also needs `view` of its entity, cameras need `may_still` |
| 7 | Who sees names ("Emma, hallway tablet")? | **Signed-in Owner, Admin and Adult.** Never a wall tablet alone; the audit id only for Owner and Admin |
| 8 | Hiding arrivals and departures | **Each adult can switch off recording of their own** (not recorded at all, past rows deleted). **Children don't get the switch**: the Owner decides |
| 9 | The wall tablet's view | **Last 12 hours, doors, locks, garage, alarm, doorbell, detections; no names, no pictures, no search, no arrivals.** Pictures can be turned on per tablet |
| 10 | The digest's time and window | **7:00 AM, covering 9 PM to then**, both settings |
| 11 | What does the digest go to? | **Alert channels get the house version** (no names, no arrivals, no pictures; a new group **House**, off for a new channel). **The Mantel apps get a personal version** only for people who turn on Morning Summary in Me (off by default). The tablets show it in the block until 11 AM |
| 12 | Send the digest on a quiet night? | **Yes**, one line, so silence never means "it broke" |
| 13 | Seal pictures with the at-rest key? | **No.** Same as photos and notification snapshots: private folder (0700/0600), encrypted backups. Sealing would cost decode time and make search and backup harder for no gain against someone who already holds the data folder |
| 14 | Pictures in backups? | **Not by default.** A switch in Backups ("Include Timeline Pictures"), off. Rows are always in the database |
| 15 | Fill in the past from Home Assistant on first start? | **No.** The timeline starts the day it's turned on |
| 16 | Rows for what Mantel missed while it was off | **Yes**, written at their real time and marked "while Mantel was off" |
| 17 | Refused commands (locks, alarm, garage) in the Timeline? | **Yes**, Owner and Admin only |
| 18 | When a person is removed? | **Their rows lose the link and the name ("A former member")** and their arrival rows are deleted |
| 19 | MCP tools (`timeline_find`, `timeline_digest`), read-only, as the caller's own view, never pictures? | **Yes** |
| 20 | **May the building session release to the house when it's done?** | **Yes, only if** `tools/ci.py full --all` passes, the Opus review has no open finding, every commit since the last release has been read, and the house is healthy after `update` (the session checks About, the alert log and one hour of rows, and goes back if not). Otherwise it pushes to main, writes "ready to release" in the Build log, and stops there |
| 21 | Attribution from Home Assistant's context ("a person in HA's app" vs "an automation") | **Try it in 19.8 on the scratch HA.** If it doesn't work, the label stays "by hand or an automation" |

## Sources

- The public Protect Integration API, as Mantel uses it: `hosts/server/mantel_server/protect_api.py` (module notes),
  `docs/phase13/CAMERAS-DIRECT.md`, `tests/fixtures/protect/` (recorded events and headers from the house's console).
- No clip, thumbnail or history endpoint on the public API, and those are private-API calls in the `uiprotect`
  library: <https://uiprotect.readthedocs.io/en/latest/api/> (lists `get_public_api_camera_snapshot`,
  `create_camera_rtsps_streams`, `create_talkback_session_public` as public; `get_camera_video`, `get_event_thumbnail`
  and `get_events_raw` have no public variant).
- Corroborating: a Protect MCP server that says the official API "has no historical query capability at all" and
  "events exist solely as a live WebSocket", and that the private API doesn't take API-key authentication:
  <https://glama.ai/mcp/servers/mgcrea/mcp-unifi-protect>; a second MCP server wrapping the Integration API whose tools
  are snapshots, RTSPS streams and talkback only: <https://glama.ai/mcp/servers/owine/unifi-protect-mcp>.
- Home Assistant's own clip proxy uses the private path and is reported to fail often:
  <https://community.home-assistant.io/t/getting-a-unifi-protect-video-link-in-a-notification/589189>.
- Ubiquiti's own reference pages (<https://developer.ui.com/protect/>) did not render for the research, which is why
  the evidence above is secondary. Phase 13 recorded the same gap.
- In this repository: `state.py`, `server.py` (`Hub.on_change`), `view.py`, `audit.py`, `gateway.Audit`,
  `notify_snaps.py`, `features/notify.py`, `alerts/center.py` and `catalog.py`, `rbac.py`, `authz.py`,
  `hk_core/notifications/rules.py` and `accessories.py`, `connectors/camera_still.py`, `imaging.py`, `image_work.py`,
  `backup.py`, `performance.py`, `user_data.py`, `mcp/tools/alerts.py`, `docs/development/Performance-baseline.md`.

## Build log

(empty until built)
