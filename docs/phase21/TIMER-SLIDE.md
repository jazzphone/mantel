# Phase 21: the Timer slide and timers that ring (plan, 2026-11-08)

**Status: step 1 (the silent slide) built; steps 2 to 5 not started.** The owner approved the design on 2026-11-08. Nothing here has run on the house or on a wall tablet.

- **Mock-up:** [mockup/timer-slide.html](mockup/timer-slide.html). It stands alone: open the file, or view the published copy. Its timers really count, with made-up names, and it touches nothing in the house.
- **Line numbers** are left out on purpose, because `main` moves. Search for the names.

## The ask (the owner, 2026-11-08)

- A screensaver slide for timers, shown only while one runs, in the mix with the others and a little more often.
- It must be on the screen for a timer's last minute.
- It looks like the Weather and Energy rings, with a ring timer.
- It makes a noise at the end, from the tablet, the HomePods or both, ideally the tablet and the HomePod in that room. Settings choose this.
- Several timers at once: the one ending first is larger, the others are sub timers, and the last-minute rule follows whichever ends next.
- Should Mantel have its own timer logic? Could Mantel pass a timer to Home Assistant, creating the entity and removing it as needed?

## Decision: who owns a timer

**Decided (the owner, 2026-11-08): timers are created dynamically from Mantel into Home Assistant.** Mantel creates a real `timer.*` helper when Start is pressed and deletes it when the timer is stopped or canceled. From then on, HA has an ordinary timer and runs its countdown. Mantel keeps only what HA has no place for: the room and where it rings.

**The route is HA's API, over Mantel's own connection, not Mantel Link:**

- Mantel already holds an HA connection, and the docs recommend a dedicated administrator user for it. `timer/create` needs that.
- HA keeps the timer collection private to `timer/__init__.py` (a local variable in `async_setup`, not in `hass.data`). So code inside HA, such as Mantel Link, has no cleaner way to create a helper than the API has.
- `timer` isn't an entity platform that an integration can add to. Mantel Link's platforms (`switch`, `sensor`, `binary_sensor`, `camera`, `alarm_control_panel`) couldn't make a true `timer.*` entity.
- Mantel Link stays useful for a later `mantel.start_timer` action, so an automation can start a timer that rings in a room (see "Later").

| Option | Gets | Costs |
|---|---|---|
| **Mantel creates real HA timers** (chosen) | No limit of four. A real name. The room stored at the start. Automations and every card see an ordinary timer. No clock of our own. | Needs an admin HA credential. Each create and delete writes HA's storage. Leftovers need a sweep. |
| Keep `timer.quick_1..4` | Least work. | Four at most. Names stay in `input_text` helpers. The room has to be inferred from who called a script. |
| Mantel runs its own clock | Works while HA is down. | 18 web files read HA's timers (`finishes_at`, `timer.quick_`). HA can't see these timers. Mantel must persist and resume them itself. |

What was checked in Home Assistant's source (the version in `~/.venvs/hk-ha-test`):

- `homeassistant/components/timer` registers `timer/create`, `timer/update` and `timer/delete` through `DictStorageCollectionWebsocket`. They are admin-only (`helpers/collection.py`).
- A helper's entity id comes from its name at creation (`_get_suggested_id`). An update can't change the item's id (`async_update_item`), so a rename should leave the entity id alone.
- `timer.change` exists, so **+1 Min is a real service**. The comment in `hk-home.js` that says no service adds time is out of date.
- `timer.finished` and `timer.cancelled` are separate events.

What Mantel needs in order to use them:

- `timer/create`, `timer/update` and `timer/delete` aren't in `hk_writes.json` or `hkClient.WRITES`, so they need adding. `input_select/create` is the precedent.
- These are for the server's own use. A page asks Mantel to start a timer and never creates the helper itself.

### The flow

1. **Start** (the New Timer sheet, a preset): a new gateway command, `kind: "timer"`, carries the duration, name and optional Rings In.
2. Mantel calls `timer/create` with a fixed name such as `HK Timer 7`, so the entity id is always `timer.hk_timer_7`. It then sets the real name with `timer/update`, and starts it with `timer.start`. `restore: true`, so it survives a restart of HA.
3. Mantel stores `{entity, name, room, rings_in, set_by, created}` in its own database.
4. **End:** Mantel rings if the deadline really passed (below), then waits for Stop or Rings For to run out.
5. **Stop or Cancel:** `timer/delete`, and the row goes.
6. **Mantel starts up:** any `timer.hk_timer_*` that is idle with no row, or left over from a finished ring, is deleted. A running one with a row carries on.

### What stays as it is

- **House Timers** (`features.house_timers`: Night, Nap and the rest) stay HA's and are **always ignored**: they never show and never ring, even if started from the Timers page. The owner adds to that list when one needs ignoring. There's no per-timer switch.
- **Automation timers:** the house has 41 `timer.*` entities, most of them plumbing such as `*_no_motion` and `fan_manual_*`. Only timers someone set count, so these never show or ring.
- **`timer.quick_1..4`** still count if something starts them (a script, or HK Frontend). No migration is needed.
- **HK Frontend inside HA** keeps quick timers. It gets the slide and says "Sound needs Mantel", as its Intercom block does. Decision 29 keeps it a product of its own.

### If there's no admin credential

Mantel falls back to the quick slots, and `setup_check.py` says why. Whether the credential Mantel holds is admin on every install is unverified, including the App's Supervisor credential. Check this house's on the first run: a token file being recorded as admin doesn't prove which connection Mantel is using.

## The slide

A new `web/hk/modules/hk-saver-timers.js`, built like `hk-saver-energy.js`: one layer for good, loaded only when a screen uses it, `create/ready/draw/arrived/layout/leave`.

- **Corner:** `SLIDES.timer = { name: 'Timers', shows: ['timer'] }` in `hk-saverlayout.js`, so the slide corner adds the time, date, weather and Home Status with no new corner code.
- **Layout:** Home Energy's. The ring is 380 px at 1280 x 800 and the readings 560 px, gap 64, scaled by Energy's `Z`. Above and below each other on narrow, tall and upright screens.
- **The big ring:** the timer ending first, drawn like `ringSvg`. A timer keeps its color when it moves up.
- **Sub timers:** up to three small rings, soonest first, then `+N`. Paused timers go last, are gray, and never cause a turn or a hold. Two on a phone. Nested rings were tried in the mock-up and rejected by the owner as too busy.
- **What moves:** only the digits and the arcs. A shared 1 Hz update writes the changed text and dash, and `hk-countdown` already reads from the deadline. Energy holds still on purpose, so this is new for a slide and gets measured on a wall tablet.

### Taking turns

- `hk-saver-helpers.js`: `timers` goes in `SLIDE_ORDER` and `EXTRA_ORDER`. With More Often on, `turnOf` gives it every other turn. Phase 20's holiday slide edits the same lists, so whichever lands second merges.
- **A catch:** `exArm` stops when `extrasOf` is empty, so a screen with no slides on would never show Timers. Running timers must count in `extrasOf`, and a timer starting must call `exArm`.

### The last minute

- Each tablet arms one timeout for `soonest deadline - 60 s`, re-armed on any timer state change. Nothing ticks when no timer is close.
- At that moment the slide shows and holds **on every tablet**, whatever else is up. It overrides `exKind`, the photos' `schedule`, Night Mode (`cknight`, dimmed) and a music takeover. Those return afterward.
- It doesn't go over a camera or doorbell pop-up, a dashboard someone is using, or the editor's preview.
- A dark screen wakes only on the tablet in the timer's room, and only with Wake a Dark Screen on, through the existing Wakes the Screen path.
- The ring grows to 470 px and restarts as a 60-second sweep, so a long timer still has a readable ring. Red for the last 10 seconds.

### Time's Up

- The ring closes and pulses. **Stop**, **+1 Min** (`timer.change`) and **Restart**. Two together read "Pasta and Oven" with **Stop All**.
- A tap stops the sound first and doesn't leave the screensaver.
- After Stop, the next timer moves up if it's within a minute. Otherwise the slide leaves.
- **While someone is using the tablet:** no takeover in the last minute, because the existing timer row keeps counting. At 0:00 a pop-up rings over the page. New, in `hk-timers.js` or beside it.

## The end, on the server

Pure rules in a new `hk_core/timers/` (tested alone), run by `hosts/server/mantel_server/timers/` on `MantelHouse`.

- **A real end:** active to idle, and the old `finishes_at` is at or before now, within a small margin. A cancel, and a press of Finish, stay silent. The existing `hk_core/notifications/rules.py` "finished" rule fires on any active to idle, so it also fires on a cancel. That's a separate small bug, not fixed here.
- **Once only:** keyed on `(entity, finishes_at)`, stored, so several tablets and a restart can't ring twice.
- **Its own copy of each deadline:** Mantel stores `(entity, finishes_at)` for every timer that counts, including quick timers. Across a restart it may never see the active-to-idle change, so on every reconnect it compares its stored deadlines with HA's states.

### Restarts

HA's code (`Timer.async_added_to_hass`) restores a timer only with `restore: true`, which isn't the default, so every timer Mantel creates sets it. Not yet tested on a running house.

| What happens | Result |
|---|---|
| Mantel restarts, the timer has time left | HA keeps counting. Mantel reads it back and rings on time. |
| Mantel is down when a timer ends | Back within 10 minutes: it rings then, late. Longer: no sound, and a notification says when it ended. |
| HA restarts, the timer has time left | HA restarts it with the same end time. |
| HA is down when a timer ends | HA finishes it on return, and Mantel rings then, under the same 10-minute rule. |
| A paused timer, through either restart | It stays paused with the same time left. |
| A timer is ringing when Mantel restarts | The stored ring carries on until Stop or Rings For runs out, and never starts over as a second ring. |
| A tablet reloads | It reads the timers again, and the last minute and any ring come back. |
| Start is pressed while HA is down | It's refused with a message. Mantel never pretends a timer started. |
- **Everyone stops together:** a ring is a server state in a feed, like the Intercom's. Stop from any screen ends it on all of them.

## Where the sound goes

1. **The room:** the timer's Rings In. Otherwise the tablet's room at creation (`device.room`, as `IntercomHost.here` finds it). Otherwise, from a phone, Set From a Phone.
2. **Tablet:** the Intercom's listener (`hkIntercom.listen`, `Feed.play`, `api_clip`), which already handles a kiosk's autoplay and its one "Tap to hear" pill. It needs to run for tablets that aren't Intercom listeners.
3. **Speaker:** the Intercom's path: a `Spool` of a tone, a one-time link, `driver.announce` / `in_step`, and `music_assistant` playing it as an announcement so music dips and returns. It needs the stream listener set up, but not the Intercom's own switch or rooms, which stay off by default.
4. **If a speaker fails,** the tablet still rings, and the failure is logged and audited. If the Intercom is talking, the ring waits for it to finish.
5. **Volume:** its own setting, capped by the house's Highest Volume. Each speaker goes back to its level afterward, as the Intercom does.
6. **No quiet hours.** The owner's call: a timer was set on purpose, so it rings whatever the time.

The sound is a real recorded or designed clip, not `tone_wav`'s plain sine. The mock-up's tones are placeholders for choosing a character.

## Settings

Everything is iOS Settings style through `hk-settings-kit`.

| Where | Setting | Default |
|---|---|---|
| Screensaver editor, Slides | **Timers** (`timer_slide`), with See It | On |
| | **Comes Up** (`timer_often`): As Often as the Others, More Often | More Often |
| Timers, When a Timer Ends | **Sound**, with a Hear It on the tablet | Soft Bell |
| | **Rings For**: 30 Seconds, 1 Minute, Until Stopped | 1 Minute |
| | **Wake a Dark Screen** | On |
| Timers, Where It Plays | **The Tablet in Its Room** | On |
| | **The Speaker in Its Room** | On |
| | **Also Play In**: rooms, Whole House | None |
| | **Set From a Phone**: Every Tablet or a room | Asked at setup |
| | **Speaker Volume** | 40 |
| New Timer sheet | **Rings In** for this one timer | Its room |

`settings.py` keys and the `hk-settings-model.js` defaults go in together, as `energy_slide` and `weather_slide` did.

## Build order

One session per step, in this order. The building session is Opus 5.5 Medium, and any agents are Sonnet 5.5 high effort.

1. **The slide.** Rings, sub timers, turns, the last-minute hold, five sizes. Silent. Reads timers from one shared list helper, so later steps change one place. Testable with quick timers alone.
2. **Timers on the server.** Prove the rename and delete on `tools/testha` first. Then the `kind: "timer"` command, the store, the sweep, real-end detection, and pointing the cards' New Timer and presets at it. Run `tools/route_table.py --write` for new routes.
3. **Tablet sound and Time's Up.** The clip, Stop, +1 Min, Restart, the pop-up over a page.
4. **HomePods.** Room lookup, dipping music, failure fallback.
5. **Settings and docs.** The editor row, the Timers page section, Rings In, `docs/guide`, `CHANGELOG.md`.

### How each step is checked

- `tools/ci.py` as usual. New: rules tests in `tests/` for real ends, once-only, the room choice and House Timers being ignored.
- A layout check like `check_mockup.cjs` at 1280 x 800, 880 x 800, 820 x 1180, 390 x 844 and 844 x 390, both engines, and `tools/headless/house_twin.py` for the real layouts.
- **Speakers:** tell the owner before any sound, and keep off the speakers the owner has ruled out. Test quietly through Music Assistant's log.

## Not proven until it runs

- Creating, renaming and deleting a timer on a running HA. HA's code says the entity id stays the same; step 2 proves it first on the scratch HA. If not, entity ids come from the name, and Mantel recognizes its timers by its own table.
- How late a HomePod starts after 0:00. The tablet will be first, and a gap of a few seconds is expected. If it's bad, Mantel starts the speaker early by the measured amount.
- Whether each tablet's kiosk plays sound without a tap.
- Whether a ring moving at 1 Hz stays smooth on the wall tablets.
- How a tablet's clock drift affects the last-minute moment. The sound is unaffected, because the server decides that.

## The owner's answers (2026-11-08)

1. **Sub timer look:** Small Rings. Nested is too busy.
2. **Last minute:** every tablet shows it. Only the timer's room rings.
3. **Quiet hours:** none. House Timers such as Night and Nap are ignored, and the list can grow.
4. **How long it rings:** 1 minute by default, then it stops by itself.
5. **Who owns a timer:** Mantel creates it dynamically in HA, through the API or Mantel Link if necessary. The API is the route (see the decision above).

## Later

- A `mantel.start_timer` action through Mantel Link, so an automation can start a named timer that rings in a room.
- Phone push when a timer ends, and a Live Activity in the iPhone app.
- Voice: "set a pasta timer" through Home Assistant Assist.
- Starting a speaker early, if the HomePod's delay matters.
