# Phase 28: HomePod timers in Mantel (plan, 2026-11-12)

**Status: a plan, nothing built.** The reading was proven by hand on the owner's Mac on 2026-11-12 (below). Four
decisions for the owner are at the end. The Mantel side waits until the restructuring of phase 25 has settled; the Mac
side can start before.

- **Line numbers** are left out on purpose. Search for the names.

## The ask (the owner, 2026-11-12)

Timers set on the HomePods with Siri ("Hey Siri, set a timer for 10 minutes") should show in Mantel, beside the timers
Mantel sets itself (phase 21). A Siri phrase that starts a Mantel timer instead was offered and turned down: the household
says "set a timer", and a new phrase wouldn't get used.

## What was ruled out, and why

Every direct route is closed by Apple, on purpose:

| Route | What was found |
|---|---|
| AirPlay / MediaRemote (what `cliairplay` and `ugl-server` speak) | No timer messages. A quiet stream to a HomePod while a Siri timer was set carried only keepalives. |
| The HomePod's own sharing | Its software (build 24K122) keeps timers in MobileTimer and shares them through DistributedTimers: CloudKit, HomeKit's private messaging between hubs, and the Companion link (`com.apple.coordination.timers`). Each one checks for a same-account or same-Home Apple device ("Non-home access not allowed"). |
| The Mac's timer services | A program of ours asking DistributedTimers was refused: "Missing entitlement: com.apple.DistributedTimers". MobileTimer's service refused the connection. Apple grants neither entitlement to other developers. |
| Shortcuts | The Clock's actions start, pause, resume, update and cancel one timer. None lists timers ("Shortcuts can't find or output details for running timers"). |
| The Mac's files | The clock service's database (Full Disk Access) holds only the Mac's own timer; nothing on disk changes when a HomePod timer starts. The Home app asks each HomePod live. |

## What works: reading the Home app on a Mac

The Mac's Home app shows each HomePod's timers in the HomePod's sheet, fetched live from the speaker. macOS's
Accessibility interface (the one VoiceOver uses) can read that sheet and open it, with the Home app in the background.
Proven by hand on 2026-11-12, with the Home app behind other windows and never brought to the front:

- **The tiles** have stable identifiers built from the room and the name: `Kitchen-HomePod-TileCell`,
  `Office-HomePods-TileCell` (a stereo pair is one tile). The description is the name and state: "HomePod, Not Playing".
  Tiles never show a countdown.
- **Opening a sheet:** the tile's custom action **More Controls** (`AXUIElementPerformAction` with its full action name).
  Never `AXPress`: on a speaker it may toggle playback.
- **The sheet's timers** are static texts under the identifier `AccessoryControl.alarmsAndTimers.AlarmsAndTimers`: the
  section heading "Timers", then for each timer its label ("Timer", or the name Siri was given), its time left ("14:42",
  counting down live in the background) and two images, "Pause" and "Close". The button "New Timer" ends the section.
  Alarms are listed above it, only while the Mac is on the HomePods' network.
- **Within a second:** a running timer was in the sheet one second after it opened.
- **Closing the sheet:** the menu item **View > (the home's name)**. `AXCancel` on the sheet, an Escape key and a click sent
  to the Home app's process all did nothing while it was in the background.
- **What Accessibility sees:** only the tiles on screen. The Speakers & TVs view should hold every speaker.

## The design

```
Home app (Mac, in the background)
   │  Accessibility: open each HomePod's sheet, read its timers, close it
Mantel for Mac (the menu bar app, MantelKit's session)
   │  POST the list of HomePod timers (HTTPS, the app's device key)
Mantel Server  ── store: who, where, label, ends at, state, last seen
   │  the timers feed
Wall tablets, phones: the timer slide and the Timers sheet, marked as a HomePod's
```

### 1. The reader, in Mantel for Mac (`jazzphone/mantel-mac`)

The menu bar app already holds the house's session, its device key and the API client (MantelKit), and it runs outside
the sandbox, which Accessibility needs. So the reader is a feature of that app, off until the owner turns it on, not a
helper of its own.

- **Turning it on:** a switch in the app's settings, "Read HomePod Timers from the Home App". It asks for the
  Accessibility permission (`AXIsProcessTrustedWithOptions`) and says why. It opens the Home app if it isn't running,
  and turns off App Nap for itself.
- **Finding the HomePods** (on first run, every hour, and when a known tile is gone): from the Speakers & TVs view, open
  each speaker's sheet once and keep those with a Timers section: HomePods and stereo pairs, whatever they're named. Other
  speakers and TVs have none. Fallbacks when Speakers & TVs isn't there: each room's view from the sidebar, then the Home
  view scrolled, then the list it already has.
- **A pass** (about every 20 s): for each HomePod, More Controls, wait for the Timers section (up to 3 s), read each timer
  (label, time left, paused or not: a paused timer shows Resume where a running one shows Pause, to be confirmed), then
  View > the home. About 1 to 2 s per HomePod.
- **Each timer becomes** `{speaker tile id, room, speaker name, label, ends_at = now + time left, paused, left_s}`. A
  timer's identity is the speaker and the label plus its end time within a few seconds, since the sheet gives no id.
- **Sending:** after each pass, the whole list for every HomePod, so the server can drop what's gone. Nothing is sent when
  nothing changed, apart from a heartbeat every minute.
- **The self-check:** each pass checks that every sheet opened, that each had a Timers section and that it closed. Two
  failed passes in a row send `reader: broken` with the step that failed, instead of a list. A pass with no running timer
  is a list with nothing in it, never silence.
- **Never:** a press on a tile, a typed key, a change to any accessory. Only More Controls, reading, and View > home.

### 2. The server (`hosts/server/mantel_server/features/timers.py` and its neighbors)

HomePod timers are **read-only copies**, not timers Mantel owns: the HomePod runs and rings them.

- **A route** for the Mac app: `POST /api/timers/homepod` with the full list, or `{reader: "broken", step}`. Guarded as a
  device of the house with the timers feature (rule 7: the guard first, `tools/route_table.py --write`); audited as a
  read-only import or with a reason for writing none.
- **A store** beside phase 21's `timers` table (a migration): one row per HomePod timer seen, with the time it was last
  seen. A whole list replaces the speaker's rows. A list older than 2 minutes counts as unknown, not as "no timers".
- **The decisions** go in `hk_core/timers` (rule 2): matching the Home app's room name to a Mantel room (the same name,
  else an owner's choice in Settings, else shown under the Home app's name), when a copy is stale, and that a HomePod timer
  never rings in Mantel.
- **The feed:** the timers clients already get, each HomePod timer marked `source: "homepod"` with its speaker.

### 3. The pages (`web/hk`)

- **The timer slide and the Timers sheet** show HomePod timers with Mantel's own: the label, the room, a small HomePod
  glyph, the countdown run locally from `ends_at`. Paused shows paused.
- **The last minute:** like phase 21's timers, every tablet shows it. A HomePod timer never rings on a tablet or a room
  speaker; the HomePod rings itself.
- **"HomePod timers unavailable"** in the Timers sheet while the reader reports broken or stale, so an empty list never
  hides a broken reader.
- **Settings → Timers:** the reader's state (last pass, HomePods found), and the room matching for a HomePod whose room
  has no Mantel twin.

### 4. Alerts

The server raises one alert (the house's alert channel) when the reader has been broken or silent for 10 minutes, and
clears it when a pass comes in: "HomePod timers stopped updating: the Mac reading them is off, or a macOS update changed
the Home app."

## What can change, and what happens

| Change | What happens |
|---|---|
| A HomePod renamed or moved to another room | Its tile id changes; the next discovery finds a new HomePod and drops the old one. The timer shows under the new name and room. |
| A room in the Home app that Mantel doesn't have | The timer shows under the Home app's room; Settings asks once which Mantel room it belongs to. |
| A non-HomePod speaker or an Apple TV | No Timers section in its sheet, so it's never read. |
| Speakers & TVs removed in an update | Discovery falls back to rooms, then the scrolled Home view, then the known list. |
| The Home app redesigned | The self-check fails; Mantel shows "HomePod timers unavailable" and alerts. The reader needs an update; Mantel's side doesn't change. Holding back major macOS updates on that Mac until the reader is checked avoids the surprise. |
| The Mac asleep, off or signed out | Stale after 2 minutes: "unavailable", then the alert. |
| A language other than English on that Mac | The labels it reads are English: the Mac stays in English (checked at start). |

## Load

- **The network:** one small request from the Home app to one HomePod per sheet opened, the same as a person opening the
  sheet. Eleven HomePods every 20 s is far under 1 KB/s.
- **The HomePods:** nothing they would notice.
- **The Mac:** the Home app and the reader, a few percent of one core in bursts (the prototype: the Home app at 214 MB,
  no measurable CPU).

## Build order

| Step | What | Where | Checked by |
|---|---|---|---|
| 28.0 the proof | A command-line reader: discovery and passes, printing what it reads; run it for 8 hours with the Home app in the background, with several timers, a named one ("set a pasta timer"), two on one HomePod, a paused one | the Mac, a scratch folder | Its log against the Home app by eye at the start and end; the Home app still responsive after 8 hours; no HomePod affected |
| 28.1 the reader | The feature in Mantel for Mac: switch, permission, discovery, passes, self-check, sending | `mantel-mac` | `xcodebuild`; a fake Home app tree for discovery and the self-check (MantelKit tests) |
| 28.2 the server | Route, store, migration, the `hk_core/timers` decisions, the feed, the alert | `mantel` | the main suite: the route table, the store, staleness, room matching, never ringing |
| 28.3 the pages | Slide, Timers sheet, Settings, "unavailable" | `mantel` (`web/hk`) | the timer harness; the headless checks at the wall tablet's, an iPad's and a phone's sizes, WebKit too |
| 28.4 on the house | A release, with the owner's OK; the Mac app updated on the chosen Mac | the house | A Siri timer seen on a wall tablet within 30 s, counting down with the HomePod; canceled with Siri, gone within 30 s |
| Later | Cancel and pause from a tablet (the reader presses the sheet's own Close or Pause); alarms (the sheet lists them too) | both | |

## Not proven until it runs

- Hours of passes: whether the Home app slows down, leaks or stops fetching while in the background.
- A named timer's label, two timers on one HomePod, how a paused timer shows.
- **A macOS virtual machine can't do it (tested 2026-11-12):** a macOS 27.2 virtual machine (Tart, bridged onto the
  HomePods' VLAN) signed into the household's Apple account got no iCloud services ("Device is a virtual machine, not
  enabling FindMy"; the device identity service: "VM support disabled"): its iCloud settings were locked and its Home
  app stayed empty. It needs a real Mac.
- **The prototype (2026-11-12, on the owner's Mac):** discovery from the sidebar's Speakers & TVs found all nine HomePod
  tiles (two stereo pairs among them) and skipped every TV and Apple TV; a pass over the nine took about 25 s. Two things
  learned: after switching views, Accessibility lists the old view's tiles for about half a second (wait until the list
  changes, then until it settles), and an Apple TV's More Controls opens another kind of sheet (close it with View >
  the home and treat the speaker as no HomePod).

## Decisions for the owner

1. **Which Mac reads them:** a spare Mac (the owner's choice, 2026-11-12), or an always-on Mac you use (the Home app is
   busy there: its sheets open and close every 20 s). Not a virtual machine: Apple gives it no iCloud.
2. **Where they show:** the timer slide and the Timers sheet, with Mantel's timers (proposed), or the Timers sheet only.
3. **The last minute on every tablet,** as for Mantel's timers (proposed), or only in the HomePod's room.
4. **Cancel from a tablet** later (the reader presses the Home app's own Close), or read-only for good.
