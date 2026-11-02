# Phase 13, phase 1b: the glance catalog (per-piece specs, 2026-11-02)

The pieces the owner asked for ("almost like an iPhone lock screen"), in three waves, each to the plan's "rules every
piece follows" (`SCREENSAVER-UNIFIED.md`) and the pieces' contract (`PIECES-SPEC.md`, its spacing and alignment
section included). Where each reads its data was surveyed first; every source below is one HK already reads.

## How a group is built

- **One file per group**: `web/hk/modules/hk-saverpieces-<group>.js`, loaded after `hk-saverwidgets.js`. It registers
  its pieces with `hkSaverWidgets.define(piece, declaration)` and uses the renderer's helpers (`hkSaverWidgets._`:
  `ring`, `miniRing`, `bar`, `wxGlyph`, `lines`, `inl`, `accStyle`, `ramp`, `tempAcc`, `tm`, `deg`, `esc`, `cut`, the
  calendar's shared read `cal`, `nextEvents`, `eventWhen`, `sunNext`, `homeWords`, `ACC`...). It draws with the
  renderer's classes, so a piece looks like the core ones: no CSS of its own unless a shape truly needs it, and then
  in `--u` on the spacing scale.
- **Declared in both mirrors** by the session (not the agent): `PIECES` in `hk-saverlayout.js` (with the group file as
  its 5th field, so the screensaver loads only the files its layout uses) and `saver_layout.py`.
- **The rules**: nothing animates; no `backdrop-filter`; one read per source, shared between pieces (module-level
  caches with a TTL, as `CAL` is); a read never wakes a read (0.1.104); `showing` false while a "shows when" piece has
  nothing; absent or unavailable data is not "nothing wrong" (a missing state shows a dash, or the piece hides when it
  is a "shows when" one); the screen's role decides the data (the server filters; a missing state is the signal).
- **Tests**: each group adds its pieces to `tests/test_saverwidgets_pieces.py`'s every-piece-every-shape run (empty
  house, a sample house with the group's entities, every sample), plus one test per piece's reading.

## Options beyond choices

A piece's options are choices (`["a", "b"]`), or:

- `"text"`: words, 1 to 40 characters (Countdown's event to look for);
- `"entity:<domain>,<domain>"`: one entity of those domains (wave C's picked entity).

Both mirrors check them; the editor offers a text field or an entity picker with the suggested default.

## Wave A: data the screensaver already reads

### Time and Calendar (`hk-saverpieces-time.js`)

| Piece | Shapes | Reads | Draws |
|---|---|---|---|
| `countdown` Countdown | inline, circular | the calendars (`hkCalendar.load`), its own shared read over the next 120 days, kept an hour | the next all-day event at least two days away, or the next whose title has `opts.match`: "Beach Trip in 12 days"; circular: the days left, a ring that fills as the day nears (over 30 days), "DAYS" under it |
| `world` World Clock | inline, circular, rectangular | `opts.city`, `opts.city2` (the cities below), the browser's Intl | inline "London 3:57 PM"; circular a small dial with the city's three letters; rectangular two cities, each its time and "Tomorrow"/"Yesterday" when its day differs |
| `events` Next Event (gains Card) | card | the shared calendar read (`cal`) | "Today", then the rest of today's events, up to four, each its time and title; "Nothing else today" when none |

World Clock's cities (IANA): London, Paris, Berlin, Rome, Madrid, Athens, Istanbul, Moscow, Cairo, Johannesburg,
Dubai, Mumbai, Bangkok, Singapore, Hong Kong, Shanghai, Tokyo, Seoul, Sydney, Auckland, Honolulu, Anchorage, Los
Angeles, Denver, Chicago, New York, Toronto, Mexico City, São Paulo, Buenos Aires, Reykjavik. Options: `city` and
`city2`, each the IANA id (`Europe/London`), defaults London and Tokyo.

### Weather and Sky (`hk-saverpieces-weather.js`)

| Piece | Shapes | Reads | Shows | Draws |
|---|---|---|---|---|
| `rain` Rain Soon | inline, circular, rectangular | the hourly forecast (`hkWxForecast`, shared), `precipitation_probability` and the condition | when rain or snow is likely (40%+ or a wet condition) within 12 hours, or falling now | "Rain at 3 PM" / "Rain until 5 PM" / "Snow at 9 PM"; circular the highest chance in the 12 hours, "RAIN"; rectangular a bar per hour for 8 hours, the first and last hours under them |
| `alert` Weather Alert | inline, card | Settings' `weather.alerts` sensor (NWS: `attributes.Alerts[]`, ended ones dropped, as the Weather page does) | while one is active | "Wind Advisory until 6 PM"; card the event, until when, the headline (two lines at most) |
| `uv` UV | circular | `hkSettings.nowRead(states, 'uv')` | always | the index in a 0-11+ gauge, "UV" |
| `wind` Wind and Gusts | circular | `nowRead('wind')`, `nowRead('gust')`, the speed's unit | always | the speed, "G 14" under it, a gauge to 40 mph (60 km/h) |
| `pressure` Pressure | circular | the weather entity's `pressure`, `pressure_unit` | always | the reading in a gauge (28.5-31 inHg, 965-1050 hPa), its unit; an arrow when the hourly forecast's pressure rises or falls |
| `feels` Feels Like | circular | `nowRead('feels_like')` | always | the temperature in a gauge over today's range, "FEELS" |
| `moon` Moon | inline, circular | `hkSettings.moon(states)` (0..1) | always | "Waxing Gibbous"; circular the phase drawn (lit part) and its illumination % |
| `sun` Sun | inline, circular, rectangular | `sun.sun` (`next_rising`, `next_setting`, state) | always | "Sunset 5:12 PM" (the next of the two); circular the day's arc with the sun on it, the next time; rectangular the day's length, sunrise and sunset |

Accents: rain blue; alerts by severity (Extreme red, Severe orange, Moderate yellow, Minor teal); UV by the WHO scale
(green, yellow, orange, red, violet); wind teal; pressure slate blue; feels by temperature (`tempAcc`); moon pale
gold; sun amber.

## Wave B: data HK reads on its other pages

### Home (`hk-saverpieces-home.js`)

| Piece | Shapes | Reads | Shows | Draws |
|---|---|---|---|---|
| `security` Security | inline, circular | `hkHeader.status(states)` (the alarm), else the first `alarm_control_panel` | always | "Armed Away" / "Disarmed" / "Triggered"; circular a shield and the state |
| `doors` Doors and Windows | inline, circular, rectangular | `hkHeader.status`: `openDoors`, `openWindows` | always, or `opts.when: open` only when something is | "2 open" / "All closed"; circular the count; rectangular the first two names |
| `garage` Garage | inline, circular | `hkHeader.status`: `garageOpen` (covers, device class garage) | always, or `opts.when: open` | "Garage open" / "Garage closed"; circular the door drawn open or shut |
| `climate` Climate | inline, circular, rectangular | climate entities (Settings' `features.thermostats`): `current_temperature`, `temperature`, `hvac_action` | always | "Heating to 70°" / "Cooling to 72°" / "Inside 68°"; circular inside ringed to the target; rectangular two zones |
| `lights` Lights On | inline, circular | `kinds.lights` with state `on` (as the chip counts them) | always | "6 lights on" / "All lights off"; circular the count over all |
| `vacuum` Vacuum | inline, circular | `kinds.vacuums` and their device's battery, current room and error sensors | while cleaning, returning or stuck | "Vacuuming the Kitchen" / "Vacuum stuck"; circular its battery |
| `notify` Notifications | inline, circular, rectangular | Mantel's notifications as they arrive (`hk-house-event`, type notification), kept by a small shared store from the moment the screensaver starts | when any arrived since | the latest's title; circular the count; rectangular the latest two |
| `package` Package | inline, circular | the same events, `kind: package` | for four hours after one | "Package at the door"; circular a box |

### People (`hk-saverpieces-people.js`)

| `who` Who's Home | inline, circular, rectangular | `person.*` (the server leaves them out without the locations feature) | always; **off until placed** (decision 7) | "Everyone's home" / "Emma and Mark home"; circular one person (`opts.person`: entity), initial and Home/Away; rectangular who's home and who's away |

### Energy (`hk-saverpieces-energy.js`)

| `grid` Grid | inline, circular | the power plan's `grid`, `grid_export` (`hkSettings.get('energy').power`, `hkChart.power`) | always | "Exporting 2.1 kW" / "Importing 0.8 kW"; circular the kW, IMPORT or EXPORT |
| `ev` EV | inline, circular | the power plan's `cars[]` (level, charging) | always | "Car 80%, charging"; circular the charge |

### Media (`hk-saverpieces-media.js`)

| `upnext` Up Next | inline, rectangular | the screensaver's own Up Next read (`music_assistant.get_queue`, shared with the music slide) | while music plays | "Next: Paper Lanterns"; rectangular UP NEXT, the song, its artist |
| `playin` Playing In | inline | `hkMusic.label(ctx)` | while music plays | "Kitchen + Living Room" |
| `thisday` On This Day | inline | the photo's date (`item.date`: the server gains the day taken, not only the year) | over a photo taken on this day in an earlier year | "3 years ago today" |

### Cameras (`hk-saverpieces-cameras.js`)

| `camera` Camera | rectangular, card | `opts.camera` (a camera entity), its `entity_picture` (`?_hk=<n>&width=480&height=270`, as the side pane's), every 10 s while shown, never while hidden | always; **off until placed** | the still, its name on it |
| `ring` Last Ring | inline, card | the doorbell's events (`hk-house-event`, kind doorbell) and its signed snapshot (`hk_notify/snap/sign`) | for 30 minutes after a ring; **off until placed** | "Doorbell 4:02 PM"; card the snapshot |

## Wave C: one entity picked, with a suggested default

| Piece | Shapes | Picks (default) | Shows | Draws |
|---|---|---|---|---|
| `alarm` Phone Alarm | inline, circular | `sensor.*_next_alarm` (the first) | while one is set within 24 hours | "Alarm 6:30 AM" |
| `trash` Trash Day | inline, circular | a calendar or a date sensor (one named trash, waste, garbage or recycling) | the day before and the day of | "Trash tomorrow" |
| `pollen` Pollen | inline, circular | a pollen sensor (`*pollen*`) | always | "Pollen High" |
| `appliance` Appliances | inline, circular, rectangular | a remaining-time or completion-time sensor (Home Connect, SmartThings) and the operation state | while running, and an hour after done | "Dryer done" / "Washer 24 min left" |
| `leak` Leak and Smoke | inline, card | `kinds.leaks`, `kinds.smoke` (all of them; none picked) | while one is tripped (unknown is not tripped) | "Water at the Laundry" |
| `travel` Travel Time | inline, circular, rectangular | a Waze or Google travel time sensor | always | "Work 24 min" |
| `price` Price | inline | the energy price entity (the plan's) | always | "Peak until 7 PM" / "$0.31/kWh" |
| `sensor` Any Sensor | inline, circular, rectangular | any entity the screen may read; its name, icon and unit; a min and max for the ring | always (and any piece can carry a condition) | inline its name and state; circular its value ringed between min and max; rectangular two |
