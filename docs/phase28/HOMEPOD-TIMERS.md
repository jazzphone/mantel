# Phase 28: HomePod timers in Mantel (plan, 2026-11-12)

**Status: the reader is built and running; Mantel's side (28.2, 28.3) is built and on `main`, not on the house.** The
alarms' list on the Timers page is look A of [mockup/alarms.html](mockup/alarms.html), the Clock app's list (the owner's
pick, 2026-11-13). See "As built" at the end.
The reader runs in a macOS virtual machine on the house's Proxmox host and serves what it reads over HTTP (below). The owner's decisions are recorded at the end
(2026-11-12, revised the same evening: the first version put the reader in Mantel for Mac and said a VM couldn't work).

- **Line numbers** are left out on purpose. Search for the names.

## The ask (the owner, 2026-11-12)

Timers set on the HomePods with Siri ("Hey Siri, set a timer for 10 minutes") should show in Mantel, beside the timers
Mantel sets itself (phase 21), and work like them: the same slide, the same last minute on the tablets, the same
settings, and in Home Assistant too. A Siri phrase that starts a Mantel timer instead was offered and turned down: the
household says "set a timer", and a new phrase wouldn't get used. Later the same day: pause, resume and cancel from
Mantel, and the HomePods' alarms in the Timers sheet.

## What was ruled out, and why

Every direct route is closed by Apple, on purpose:

| Route | What was found |
|---|---|
| AirPlay / MediaRemote (what `cliairplay` and `ugl-server` speak) | No timer messages. A quiet stream to a HomePod while a Siri timer was set carried only keepalives. |
| The HomePod's own sharing | Its software (build 24K122) keeps timers in MobileTimer and shares them through DistributedTimers: CloudKit, HomeKit's private messaging between hubs, and the Companion link (`com.apple.coordination.timers`). Each one checks for a same-account or same-Home Apple device ("Non-home access not allowed"). |
| The Mac's timer services | A program of ours asking DistributedTimers was refused: "Missing entitlement: com.apple.DistributedTimers". MobileTimer's service refused the connection. Apple grants neither entitlement to other developers. |
| Shortcuts | The Clock's actions start, pause, resume, update and cancel one timer. None lists timers ("Shortcuts can't find or output details for running timers"). |
| The Mac's files | The clock service's database (Full Disk Access) holds only the Mac's own timer; nothing on disk changes when a HomePod timer starts. The Home app asks each HomePod live. |

## What works: reading the Home app

macOS's Home app shows each HomePod's timers and alarms in the HomePod's sheet, fetched live from the speaker. The
Accessibility interface (the one VoiceOver uses) can open that sheet, read it, press its controls and close it, with the
Home app in the background. What the Home app (macOS 15 and 27) shows:

- **The tiles** have stable identifiers built from the room and the name: `Kitchen-HomePod-TileCell`,
  `Office-HomePods-TileCell` (a stereo pair is one tile). Tiles never show a countdown. In the Speakers & TVs view every
  speaker and TV is a tile.
- **Opening a sheet:** the tile's custom action **More Controls**. Never `AXPress`: on a speaker it may toggle playback.
- **Timers** sit under the identifier `AccessoryControl.alarmsAndTimers.AlarmsAndTimers`: the heading "Timers", then for
  each timer its label ("Timer", or the name Siri was given), its time left ("14:42", counting down live) and two images
  that take a press: "Pause" (or "Resume" when paused) and "Close" (cancels it). "New Timer" ends the section.
- **Alarms** sit above them, under the same identifier: one group per alarm holding its label ("Alarm"), its time ("9:00
  PM", with a narrow no-break space), a repeat line when it repeats, and a checkbox (value On/Off) that turns it on or
  off. The group has a custom action **Delete**. A ringing alarm shows nothing: a one-time alarm flips to Off the moment
  it fires, with no Snooze or Stop anywhere (tested). So Mantel can say an alarm went off, not stop it.
- **Closing a sheet:** on macOS 15, `AXCancel` on the sheet (the View menu's home item works one time in three); on
  macOS 27, the View menu's home item (`AXCancel` does nothing there). The reader tries both.
- **Only what is on screen** is in the Accessibility tree: the reader makes the window tall enough for every speaker.

## The reader (built, 2026-11-12)

A command-line program (Swift, about 900 lines) in a macOS virtual machine, run as a LaunchAgent in the logged-in
session. It is not part of Mantel for Mac: it needs a Mac that is always on and signed into the household's Apple
account, and the house's Proxmox host is.
Its code, README and the VM script are their own repository, `jazzphone/homepod-timers-reader` (private).

### The virtual machine

Apple's own virtualization (Tart, macOS 27) gets no iCloud: "Device is a virtual machine, not enabling FindMy". A
QEMU/KVM virtual machine on Proxmox with OpenCore does, with three things that each took a dead end to find:

- **Apple's SMC key** in QEMU's `isa-applesmc` device. Without it boot stops at "busy timeout ... AppleACPICPU" (the
  window server can't be decrypted).
- **VMHide** (a Lilu plug-in, with Lilu 1.7 or later). Without it the Apple Account sign-in sees `kern.hv_vmm_present` =
  1, takes the virtual-platform path and fails ("No Anisette for you today", "Verification failed"). Hiding the
  hypervisor from the CPU instead stops the kernel from starting. VMHide is reported broken on macOS 26.5; there a
  kernel patch in OpenCore does the same.
- **A Mac model and serial** the account accepts (the owner's choice).

Also: macOS 15.8 (Sequoia); 4 cores, 8 GB; 1920 x 1440 so every speaker tile fits on screen; TRIM off for its disk (the
iSCSI storage clears it 2 MB at a time); a QEMU guest agent for macOS (`mac-guest-agent`, ISA serial) for clean
shutdowns; its clock set from NTP every 2 minutes through that agent (it drifts about 4 s an hour); Apple's
PerfPowerServices disabled (it held a core). Setup and every step are recorded in the house's own notes, not here.

### What it does

- **Never idles:** reads one HomePod after another, the Normal ones in screen order, and after every few a High one (the
  kitchen by default; any HomePod with a timer running counts as High). A read takes about 1.5 s; a round of nine about
  17 s; the kitchen about every 6 s. Skip leaves a HomePod out.
- **Remembers** which tiles are HomePods (a sheet with a Timers section) and which are TVs, so it opens a TV only once,
  ever.
- **End times** are stamped at the moment the sheet showed the time left.
- **Commands** (pause, resume, cancel a timer; turn an alarm on or off, delete it) jump the queue: done within about 2
  s, through the sheet's own controls, and only if the timer's label or the alarm's time still matches.
- **Heals itself:** restarts the Home app after three failed reads in a row and waits for it to load.

### Its interface (HTTP, port 8787)

| | |
|---|---|
| `GET /timers.json` | the running and paused timers: `label`, `left_s`, `ends_at`, `paused`, `room`, `tile`, `index`, `read_at` |
| `GET /alarms.json` | every alarm, on or off: `label`, `time`, `time_24`, `enabled`, `repeats`, `room`, `tile`, `index` |
| `GET /status.json` | everything, plus each HomePod's last read and the reader's health (`broken`) |
| `POST /timer?tile=&index=&action=pause\|resume\|cancel&label=` | queue a timer command; `GET /command?id=` for its result |
| `POST /alarm?tile=&index=&action=on\|off\|delete&time=` | queue an alarm command |
| `GET /` | a status page: timers, alarms, HomePods, priorities |

Before Mantel uses it: a token for the commands, and an id for each timer and alarm that holds from one read to the
next.

## Mantel's side (to build)

### 1. The server

- **Settings > Connections:** "HomePod timer reader", its address and token.
- **A poller:** `/timers.json` and `/alarms.json` every 2 seconds. A reader that is `broken` or hasn't answered for 2
  minutes is "unavailable", never "no timers".
- **HomePod timers become Home Assistant timers,** the way phase 21's do (Mantel creates a real `timer.*` helper and
  deletes it when the timer ends): created when a HomePod timer appears, kept in step with its end time and pause,
  deleted when it's gone. So every tablet, card and automation sees them like Mantel's own, and Mantel keeps only the
  room, the HomePod and `source: "homepod"`. A HomePod timer never rings in Mantel: the HomePod rings itself.
- **Commands from Mantel** on a HomePod timer go to the reader (pause, resume, cancel), not only to Home Assistant; the
  helper follows on the next read. Guarded and audited like every Mantel command (rule 7, the route table).
- **Alarms** go to clients in the timers feed, and to Home Assistant through Mantel Link (a sensor per HomePod with its
  next alarm, for automations).
- **The decisions** in `hk_core/timers` (rule 2): a Home app room to a Mantel room (the same name, else the owner's
  choice in Settings), staleness, identity from one read to the next, which Home Assistant helper is whose.
- **An alert** when the reader has been unavailable for 10 minutes, cleared when it answers.

### 2. The pages

- **HomePod timers like Mantel's:** the timer slide and the Timers sheet, with the room and a small HomePod glyph; the
  last minute on every tablet, with the same settings as Mantel's timers; pause, resume and cancel.
- **Alarms in the Timers sheet:** their own list under the timers (time, label, room, repeat, an on/off switch, delete
  with a confirmation). How it looks is a design question for DESIGN.md before it's built.
- **"HomePod timers unavailable"** while the reader is down.
- **Settings > Timers:** the reader's state and the room matching.

## What can change, and what happens

| Change | What happens |
|---|---|
| A HomePod renamed or moved | Its tile id changes: the reader finds the new tile and drops the old one after three misses. |
| A room in the Home app that Mantel doesn't have | Shown under the Home app's room; Settings asks which Mantel room it is. |
| The Home app redesigned by a macOS update | Reads fail, the reader reports broken, Mantel shows "unavailable" and alerts. Updates on the VM are off until the reader is checked on the new version. |
| The VM off, or its sign-in lost | "Unavailable" after 2 minutes, then the alert. |
| A language other than English | The labels it reads are English: the VM stays in English. |

## Load

One small request from the Home app to one HomePod per sheet opened, the same as a person opening the sheet: about one
every 1.5 s across the house. The VM: two to four cores busy (the Home app and its software-drawn window).

## Build order

| Step | What | Where | Checked by |
|---|---|---|---|
| 28.0 the reader | Done: reading, priorities, commands, alarms, the status page | the VM | By eye against the Home app; a real kitchen timer paused and resumed, an alarm turned off and on |
| 28.0b the proof | Hours of reads: the Home app still responsive, no leak, timers caught with the right end time | the VM's log | |
| 28.1 the reader for Mantel | A token on commands, stable ids, its source in a repository | the reader | |
| 28.2 the server | Connection, poller, Home Assistant helpers, commands, alarms, `hk_core/timers`, the alert | `mantel` | the main suite: the route table, staleness, identity, room matching, never ringing |
| 28.3 the pages | Slide, Timers sheet with alarms, Settings, "unavailable" | `mantel` (`web/hk`) | the timer harness; the headless checks at the wall tablet's, an iPad's and a phone's sizes, WebKit too |
| 28.4 on the house | A release, with the owner's OK | the house | A Siri timer on a wall tablet within seconds, counting down with the HomePod; paused from a tablet; canceled with Siri, gone within seconds |

## Decisions (the owner, 2026-11-12)

1. **Which Mac:** a macOS virtual machine on the house's Proxmox host (a spare Mac was the first idea; a VM works with
   the steps above).
2. **Where they show:** the timer slide and the Timers sheet, with Mantel's timers, and in Home Assistant too.
3. **They work like Mantel's timers,** the last minute included, with the same settings.
4. **Pause, resume and cancel from Mantel:** yes.
5. **Alarms:** yes, in the Timers sheet; how they look is still to design.
6. **The alarms' look (2026-11-13):** A, the Clock app's list ([mockup/alarms.html](mockup/alarms.html)): one plate, the time
   large and light, the switch, Edit and Delete with a confirmation.

## As built (28.2 and 28.3, 2026-11-12)

- **The rules:** `hk_core/timers/homepod.py` (tests: `tests/test_hk_core_homepod_timers.py`): what the reader says, staleness
  (`availability`: broken, or no good answer for 2 minutes; never "no timers"), identity (`match`: the same HomePod and label
  ending within 5 s, then the same label paired by time left, so a pause or a resume between reads keeps the timer), how a
  timer went (`how_gone`: within 5 s of its end it ended, else it was canceled), the helper's calls (`steps`: `timer.change`
  keeps the helper's length, a restart only beyond it), room matching (`room_for`: the owner's pick, else the same name,
  apostrophes and case aside), alarms (ids that survive a row moving, the next ring, a one-time alarm that went off).
- **The server:** `features/homepod_timers.py` (tests: `tests/test_homepod_timers.py`). Helpers are `timer.hk_homepod_<n>`,
  made as phase 21's are (`timer/create` under a fixed name, then its label) and followed in the `homepod_timers` table
  (migration 0041). Mantel's own timer code skips them: they never ring. Nothing is mirrored with house commands off or
  without an administrator's credential (Settings says so). One audit row per helper change, Mantel's.
- **Commands:** the cards' own `timer.pause`, `timer.start` (no duration: resume) and `timer.cancel` on a HomePod's helper go
  to the reader (`gateway.homepod_of`); a restart, more time or Finish is refused. An alarm's switch and Delete are
  `script.homepod_alarm {alarm, action}`. Both are checked and audited as every command; a reader that is down refuses them
  (`homepod_reader_unavailable`). Every wall tablet may see and control them (`rbac.py`).
- **The connection:** Connections' third kind, `homepod`: the address and the token from the Token card on the reader's page, tested
  (status answers; a wrong token is refused by `POST /check` before it looks) and sealed as the others are.
- **The screens:** sensor.running_quick_timers carries `homepod` (the reader's state, each HomePod timer's room and HomePod,
  the alarms, the Home app rooms); each HomePod timer's `running` row says `source: "homepod"`. hk-timers.js reads it
  (`homepod`, `homepodFeed`, `alarmAct`).
- **Home Assistant:** through Mantel Link, while Mantel owns `house`: `sensor.<room>_<homepod>_next_alarm`, a timestamp
  (`features.device_class`, which Mantel Link and HK Frontend's linked mode now read).
- **Alarms on the Timers page** (`HkTimersCard._alarms`, look A): under Running, one plate, a row per alarm (the time large
  and light, label, HomePod and room, repeat; an off alarm gray) with the iOS switch; Edit puts a red minus on each row,
  and Delete asks first (`hkCards.confirmSheet`). Only while the reader is reading. No Stop: the Home app never shows a
  ringing alarm.
- **Checked:** `tools/headless/homepod_timers_check.py` (the Timers page, its keys reaching a stand-in reader, its sheet,
  the alarms' switch and Delete, "unavailable", Settings) and the HomePod cases of `timer_slide_check.py`, at 1280 x 800, an iPad's and a phone's, both
  engines.
- **Not proven until 28.4:** a real Siri timer through the reader to a tablet; Pause from a tablet on a real HomePod; how often
  the helper needs setting right (`steps`) against the reader's whole-second reads.
