# Card Library

HK Frontend’s screens are built from its own Lovelace cards, and every one of
them is yours to use in a dashboard you write yourself. This page lists each
card with what it is for and its main options; the view type and the
strategies are on [Strategies and Grid View](Strategies-and-Grid-View.md), and
complete examples on [Card Examples](Card-Examples.md).

You don’t need any of this for a generated screen: HK Settings builds those
(see [Screens](Screens.md)). Read on if you write dashboards in YAML, or want
an HK card on a dashboard of your own.

## Using the cards

- The card files are added as dashboard resources for you (see
  [Install](Install.md)). There is nothing to install per
  card.
- In the card picker, HK Frontend’s cards are the ones whose names start with
  **HK**. Every card has a visual editor and a starting config drawn from your
  home. Two belong only to the photo screensaver’s `cards:` and are left out of
  the picker: `hk-screensaver-now-card` and `hk-screensaver-status-card`.
- In YAML, a card’s type is `custom:` and its tag, for example
  `type: custom:hk-light-card`.
- In Home Assistant’s **Sections** view each card takes a size of its own:
  tiles half a section (two side by side, filling it); the header, chip and
  scene rows, the Music page, the calendar and the other page-wide cards the
  full width; the rest a full column. Change it in the card’s **Layout** tab,
  as for any card. In a narrow section the wall header stacks (clock, weather,
  then the security line), and New Timer puts its name and Start under the
  keypad.
- On a dashboard of your own with Home Assistant's **light** theme (and no
  live sky behind the cards), they take the Home app's light look: gray glass,
  the theme's own text colors, and a white plate for whatever is on. With the
  dark theme, or the live sky, they look as they do on HK Frontend's screens.
  Sheets and pop-ups stay dark.
- Icons named `hk:…` are drawn from your own glyph file (see
  [Your files](Your-Files.md)). Until it is there, each `hk:` icon is drawn as
  the Material Design icon of the same name, and any `mdi:` icon works too.
- A card with no entity of its own falls back to what HK Settings chose (the
  weather entity, the alarm panel), so one card works on every dashboard.

### Colors

Wherever an option takes a color (`icon_color`, `color`), you can use a name:
`yellow`, `orange`, `blue`, `green`, `red`, `purple`, `pink`, `teal`, `cyan`,
`brown`, `gray`, `mint`, `white` or `black`. These are the Home app’s own
shades. Any CSS color works too, such as `rgba(255, 159, 10, 0.95)`.

### Actions and taps

`tap_action` (and `icon_tap_action` on tiles) take Home Assistant’s usual
actions: `more-info`, `toggle`, `navigate`, `perform-action`, `url` and `none`,
with an optional `confirmation`. Two things differ:

- **No hold.** A long press does what a tap does. There is no `hold_action`.
- **A right-click opens detail.** With a mouse or trackpad, right-clicking a
  tile (or Control-clicking on a Mac) opens its detail sheet, whatever its
  `tap_action`. A tile with no entity keeps the browser’s menu. A finger’s long
  press never does this.
- **Some things never change from one tap.** A `toggle` on a lock, an alarm
  panel, a valve, a thermostat, a water heater, a siren, a vacuum, a camera, or
  a garage door, gate or door (a cover of that device class) opens its detail
  sheet instead, whatever the card says.

A `navigation_path` that starts with `./` is relative to the dashboard it is
on (`./lights`), so one card works on every dashboard. A path that is a hash
(`"#garage"`) opens that pop-up.

Tapping an accessory opens its **detail sheet**, HK Frontend’s own
replacement for Home Assistant’s more-info dialog. Turn them off for every
screen with **HK Settings → Library → Accessories → HK Detail Sheets**, or for one card
with `detail: false`.

---

## Tiles

The pill-shaped accessory tiles. All of them take the shared options below and
add a few of their own.

| Card | What it is |
|---|---|
| `hk-tile-card` | A tile for any entity: icon, name and a status line. A button or input button (a computer’s Wake on LAN, say) lights for a moment when tapped. A generated Wake on LAN tile wakes the computer from its glyph and opens its sheet from its name. |
| `hk-light-card` | A light; the status is its brightness. |
| `hk-fan-card` | A fan; the status is its speed, and the icon spins while it is on (`animation: none` stops it). |
| `hk-cover-card` | A blind, shade or garage door; the status is how far open it is. |
| `hk-media-card` | A TV or speaker; the status is what it plays or its input. `label_mode: source_first` puts the input first. |
| `hk-favorite-card` | A tile with the room’s name above the entity’s, for a favorites row (`room`). |
| `hk-tall-card` | A double-height tile, like the Home app’s locks and garage doors. Give it `view_layout: {grid-row: span 2}` in a grid. |
| `hk-climate-card` | A favorites tile for a thermostat, with the current temperature where the icon goes (`room`). |
| `hk-climate-tall-card` | The double-height version, lit while the system runs. |
| `hk-scene-card` | A scene, script or automation: tap to run it; it shows a ring while it runs. `entity` is optional (a pill that only runs its `tap_action`); `elevated` adds a shadow. |

**Shared tile options**

| Option | What it does |
|---|---|
| `entity` (required) | The entity. |
| `name` | Defaults to the entity’s name. |
| `icon` | An `hk:` or `mdi:` icon. |
| `icon_states` | An icon per state, for example `{"on": hk:lightbulb-on}`. Quote `"on"` and `"off"`: bare, YAML reads them as true and false. |
| `icon_color` | The tile’s color: the icon’s circle while on, the icon itself while off (see [Colors](#colors)). The default follows the domain: yellow for lights, blue for fans and covers, and so on. |
| `icon_size` | A CSS size, for example `30px`. |
| `bare_icon` | While on, draw the icon without the colored circle behind it. `bare_icon_color` colors it. |
| `well_background` | The icon circle’s color, for example `transparent`. |
| `size` | `tall` or `regular`: the tile’s height, over the card’s own (a light as a tall tile, a lock as a pill). A tall tile is two rows high, so give it `view_layout: {grid-row: span 2}` in a grid. |
| `label` | Fixed status text, replacing the automatic one. |
| `detail` | `false`: a tap does what `tap_action` says, never the HK detail sheet. |
| `animation` | On a plain, tall or favorite tile: `spin` makes the glyph spin while on (a fan drawn on a switch). |
| `label_mode` | How the state becomes the status text (below). |
| `group`, `group_lit` | Other entities this tile stands for, and whether it lights with the main entity (`entity`) or with any of them (`any`). |
| `tap_action` | Default: open the detail sheet. |
| `icon_tap_action` | What a tap on the icon does; the rest of the tile uses `tap_action`. The light, fan and cover tiles start with `toggle`. |

**`label_mode`**

| Mode | Status text |
|---|---|
| `on_off` | On when on; Off for anything else. |
| `on_off_sentence` | On or Off, else the state as a sentence. |
| `state` | Open, Closed, Locked, Unlocked and so on, else the state in title case. |
| `sentence` | The state as a sentence (“Heat cool”). |
| `title` | The state in title case (“Heat Cool”). |
| `open_closed` | Open / Closed for a contact sensor. |
| `leak` | Leak Detected / Dry, and No Report for a sensor that has not reported. |
| `alarm` | Home, Away, Night, Vacation, Off, Triggered… |
| `brightness` | A light’s brightness, as a percentage. |
| `position` | A cover’s position: Open, Closed or a percentage. |
| `humidity` | What a humidifier is doing: “Raising to 45%” or “Lowering to 45%.” |
| `vacuum` | Cleaning, Returning, Paused, Ready or Error. |
| `duration` | A timer’s length, for example “10 min.” |
| `group_brightness` | The average brightness of the lit lights in `group`. |
| `group_count` | How many of `group` are on (“3 On”). |
| `setpoint` | A thermostat’s target (“72°”, or “68°–74°”). |
| `setpoint_verb` | The target with what it is doing (“Cool to 72°”). |

For anything else, `label_map` maps states to text, and `label_default` is
the text for any other state (`sentence`, `title` and `spaces` transform the
state instead).

## Status chips and rows

| Card | What it is | Main options |
|---|---|---|
| `hk-chips-card` | The row of status chips under the header. Which chips, their order, and which appear only when there is something to report come from the screen’s settings in HK Settings; the Smoke & CO chip always leads it, in a home with an alarm. | `chips`, `quiet` (the row when the screen’s settings name none), `extra` (your own chips: `[{after: <kind> or start or end, card: …}]`), `lead` (`false`: no menu button at its start), `card_width`, `gap`, `margin` |
| `hk-status-chip-card` | One chip: an icon and two lines of text. | `kind` (below), or your own with `entity`, `name`, `icon`, `label` |
| `hk-scenes-card` | The row of scene pills. Which scenes, and their order, come from the screen’s settings. | `scenes` (when the settings name none; empty: every scene, A to Z), `name` (the heading), `looks` (`{<entity>: {name, icon, icon_color, tap_action}}`), `room: true` (only the listed `scenes`, never the screen’s choice or its page pills) |
| `hk-toggle-card` | A text-only pill that lights when an entity is on, or equals `option`. | `entity` (required), `name`, `option`, `tap_action` |
| `hk-row-card` | A row of any cards that scrolls sideways. | `cards`, `lead` (a card pinned at the start, such as the menu button), `card_width`, `gap`, `phone_card_width`, `phone_gap`, `pad_top` / `pad_bottom` / `pad_left` / `pad_right`, `margin` |

**A chip of a kind.** `kind` is one of `smoke`, `weather_alert`, `security`,
`doors_windows`, `climate`, `lights`, `blinds`, `timers`, `vacuums`,
`speakers`, `water` and `energy`. The chip then counts what that kind’s page under **HK Settings →
Accessories** lists ([What Counts](Status-Chips.md#what-counts)), and fills in its own icon, name and text.
`quiet: true` shows it only while there is something to report.

**A chip of your own.** Point it at one entity, or build its text:

| Option | What it does |
|---|---|
| `entity` / `source` | The entity it reads. `source` can be a list, combined with `reduce: max`, `min`, `sum` or `spread`. |
| `attribute` | Read an attribute instead of the state. |
| `count` | Count entities instead: `{entities: [...], match: "on"}`, or `{music: true, match: playing}` for Music’s rooms. |
| `format`, `zero`, `one`, `decimals`, `scale`, `unit` | How a number reads: `format: "{v} Open"`, `zero: Closed`. |
| `label_map`, `label_case: title`, `fallback` | How a state reads. |
| `label_rules` | A list of rules; the first whose `when` passes gives the label. |
| `parts` | Several readings joined into one line (`join` sets the separator). |
| `icon_states`, `icon_color_states`, `icon_rules`, `icon_color_rules` | The icon and its color by state, or by rule. |
| `quiet`, `active` | With `quiet: true`, the chip shows only while one of the `active` conditions passes (a list of `when`s). |

A `when` compares one value: `state` (one or a list), `state_not`, `above` and
`below` (strict: `above: 0` means one or more), `at_least` and `at_most`
(inclusive), or `any_of` (a list of entities, any one of which is in `state`,
optionally on an `attribute`).

## Headings, readings and rooms

| Card | What it is | Main options |
|---|---|---|
| `hk-heading-card` | A section title. With `area`, it links to that area’s room page when the dashboard has one. | `name` (required), `area`, `navigation_path`, `chevron` (text after the title), `height`, `padding`, `grid_rows`, `energy_section` (the Energy section’s dot and total on the tab), `energy_period` (`now` pins it to Now) |
| `hk-stat-card` | An icon, a caption and a large reading, with no background. | `entity` (required), `name`, `value_mode` (`temperature` — in the sensor’s own unit —, `power`, `runtime`, `cost`, `cost_today`, `flow`), `icon`, `icon_color`, `value` (fixed text), `value_suffix` (instead of the unit), `power`, `price` (an entity: price per kWh) |
| `hk-rank-card` | A tile with a large reading: a value, a percentage, or a device’s power use ranked against others. | `entity` (required), `name`, `mode` (`hero`, `pct`, `rank`, `energy`), `power`, `stat`, `peers`, `energy` (follow the Energy tabs; `now` pins it to Now), `section`, `line_color`, `control` (Switched By: a power button that turns it on, and off after asking), `control_yes` and `control_detail` (that question's button and line; default Turn Off, “Everything on this circuit loses power.”), `backed` (a small green battery before the kWh line: backed up by the house battery), `icon_color_steps`, `label_entity`, `label_suffix`, `label_decimals` |
| `hk-climate-status-card` | Climate summaries across the included areas, with accessory-list sheets on tap. Follows Pages → Climate → Status Row and what each type counts ([What Counts](Status-Chips.md#what-counts)). | `items` (`temperature`, `humidity`, `blinds`, `fans`), `exclude_entities`, `exclude_devices`, `exclude_areas` |
| `hk-page-status-card` | A category page’s status row — Lights, Doors & Windows, Water, Security (or Climate) — with accessory-list sheets on tap. Follows Pages → the page → Status Row and what each type counts ([What Counts](Status-Chips.md#what-counts)). | `page` (required: `lights`, `doors_windows`, `water`, `security`, `climate`), `items`, `exclude_entities`, `exclude_devices`, `exclude_areas` |
| `hk-room-status-card` | A room’s status line: temperature and humidity, then what is on, open or detected, read from its area. | `area` (required; one or a list), `items`, `temperature`, `humidity`, `entities`, `exclude`, `include`, `exclude_entities`, `exclude_devices`, `exclude_areas` |

`icon_color_steps` is a list whose first match wins, for example
`[{above: 60, color: green}, {above: 25, color: yellow}, {color: red}]`.

`items` on the room status card chooses from `temperature`, `humidity`,
`security`, `tvs`, `lights`, `outlets`, `blinds`, `fans`, `windows`, `doors`,
`locks`, `garage`, `valves`, `motion`, `occupancy`, `leaks` and `speakers`, shown
in the order you list them. Empty follows **HK Settings → Rooms → Status
Row**. On the page status card, `items` chooses from what that page can show
([Status rows](Status-Rows.md#a-category-pages-row)).
Temperature and humidity come from the area’s own related sensors
(**Settings → Areas**) unless you name them.

## Controls

| Card | What it is |
|---|---|
| `hk-thermostat-card` | A thermostat dial with the current temperature, target and mode buttons. |
| `hk-slider-card` | A slider for a `number` entity, such as a battery’s charge limit. `layout: tile` makes it as tall as a tall tile (150 px) on the Energy page’s insets, to sit in a row with its cards. |
| `hk-media-control-card` | A media player’s progress bar and volume slider. `parts: [progress]` or `[volume]` draws one; `members_map` tells it a sync group’s speakers so the volume can level them. |
| `hk-control-card` | Picks one of the above from the entity (`control` forces one). Prefer the named cards. |

They share `entity`, `name`, `icon`, `color` (a color name or any CSS color)
and `bare: true` (no glass background, for use inside a card that has one).
`entity_from: {music: true}` follows whichever player the screen’s music is
on, instead of a fixed `entity`.

## Header, clock and weather

| Card | What it is | Main options |
|---|---|---|
| `hk-header-card` | The wall header: clock, date and weather, beside the security summary. Tap the weather for the Weather page, the security summary for the alarm; on a screen with a menu, tap the clock to open the menu. | `weather_path` (default `./weather`), `alarm_path` (default `./alarm`) |
| `hk-clock-card` | The time and date on their own. | `date_format` (`weekday`, `monthday`), `time_size`, `ampm_size`, `date_size`, `color`, `date_color`, `shadow`, `height`, `padding`, `margin`, `gap` |
| `hk-weather-strip-card` | The current temperature and conditions on one line. | `entity`, `main_size`, `detail_size`, `glyph_size`, `color`, `dim_color`, `shadow`, `margin`, `tap_action` |
| `hk-weather-band-card` | Current conditions with an hourly and a daily forecast. | `section` (`hero`, `hourly`, `daily`; omit for the original combined band), `entity` (required), `hours` (12), `days` (8), `place`, `min_hour_col` (40), `min_day_col` (55), `plain` (no plate, white text), `narrow` (stood up, as on a phone), `now_width` (today’s column, 120 to 400 px; 300), `tap_action` |
| `hk-weather-tile-card` | A small tile for the wind, sunrise and sunset, the moon, or the UV index. | `variant` (required: `wind`, `sun`, `moon`, `uv`, `humidity`, `pressure`), `look: page` for the Weather page’s detail style, `caption`, `entity`, `speed`, `gust`, `sun`, `phase`, `uv` |
| `hk-weather-details-card` | The Weather page’s ordered detail tiles, using Forecast & Details settings. | `entity`, `glass` |
| `hk-radar-card` | Native precipitation radar, lazy-loaded only when enabled. | Radar Map settings in HK Settings |
| `hk-alert-card` | Severe-weather alerts from the NWS Alerts integration; shows only while one is active. | `entity` (required), `title`, `source`, `icon` |

The weather cards use the weather entity from **HK Settings → All Screens →
Weather** unless you name one. Columns that do not fit are dropped rather than
squeezed: `min_hour_col` and `min_day_col` are the narrowest they may be, in
pixels. The Weather page’s `section: hourly` instead scrolls its configured hours,
and `section: daily` uses a shared temperature scale and opens days in the weather sheet.

## Calendar

| Card | What it is | Main options |
|---|---|---|
| `hk-calendar-card` | The Calendar page: the month, the week or the day, with events to add, change and delete. | `view` (`month`, `week`, `day`) |
| `hk-calendar-pane-card` | Today’s events and the coming days’, as the screensaver’s calendar pane shows them. | `days` (2; 1 to 7) |

Both show the calendars in **HK Settings → Pages → Calendar**, in their
colors ([Calendar](Calendar.md)).

## Layout

| Card | What it is | Main options |
|---|---|---|
| `hk-grid-card` | A CSS grid of cards. Every page is built from these. | `cards`, `layout` (below) |
| `hk-frame-card` | Any Home Assistant card, on HK Frontend’s glass. | `card` (required), `material` (`glass`, `none`), `margin`, `phone: hide` (leave it out below 640 px) |
| `hk-spacer-card` | Empty space of a set height. | `height` |
| `hk-back-card` | The round back button for a sub-page. | `parents` (`{<page>: <parent page>}` for a page not opened from the dashboard’s first view) |
| `hk-menu-button-card` | The round button that opens the menu. It draws only on a screen with the menu on; put it in a chip row’s `lead`. | `glass` |
| `hk-key-card` | A plain button with an icon or a word. | `name` or `icon`, `variant` (`glass`, `flat`, `filled`), `icon_color`, `fill`, `width`, `tap_action` |
| `hk-info-card` | A large icon with a title and two lines: the house’s climate, its security, or any entity’s state. | `variant` (required: `climate`, `security`, `state`), `name`, `icon`, `entity`, `label`, `icon_states`, `icon_colors`, `temperature`, `downstairs`, `upstairs`, `garage`, `tap_action` |

**`layout`** takes any `grid-*` and `place-*` CSS property, plus `margin`
(default `0px 4px 0px 4px`) and `padding`. Each child can place itself with
its own `view_layout` (`grid-column`, `grid-row`, `grid-area`), and every
child gets a `4px 4px 8px` margin. A grid of tiles uses:

```yaml
layout:
  grid-template-columns: repeat(auto-fill, var(--hk-track, 196px))
  grid-auto-rows: 80px
  grid-auto-flow: dense
  grid-column-gap: 10px
```

That is the Home app’s grid: 196 × 70 tiles, 10 px apart (a row is the tile
and the gap; favorites, three lines and 76 px tall, want `grid-auto-rows: 86px`). Write
the columns exactly like that and the grid follows HK Frontend’s screen
sizes: two columns on a phone, and 170 px pills (`--hk-pill`) from 641 to
1023 px wide (an iPad, or a wall tablet with the menu docked beside the page).
A sideways row of tiles does the same with
`card_width: var(--hk-pill, 196px)` and `gap: 10`. (Earlier versions drew
tiles 192 wide, 12 apart, on 82 px rows; a grid written with those numbers
still works, its tiles a little closer together.)

## Security, vacuums and timers

| Card | What it is | Main options |
|---|---|---|
| `hk-alarm-keypad-card` | A keypad to arm and disarm an alarm panel with a code. The code is checked by the alarm, never on the screen. | `entity` (default: **HK Settings → Pages → Security → Alarm Panel**), `bad_code_entity` (only for a panel that fails silently on a wrong code) |
| `hk-vacuum-card` | A robot vacuum with its status, battery and four commands. | `entity` (required), `name`, `battery`, `room`, `progress`, `error`, `dock_error` |
| `hk-area-select-card` | Pick rooms by floor, then clean just those. | `floors` (empty: the rooms [Clean Areas](Clean-Areas.md) offers, kept up to date), `order`, `start_script` (a script of your own that receives `areas`, instead of Clean Areas) |
| `hk-timers-page-card` | The whole Timers page: quick start, running timers, house timers and the New Timer keypad. | `timers`, `house`, `presets` (up to six, in minutes; default `[5, 10, 15, 20, 30, 60]`), `name_chips`, `quick_script`, `create_script`, `empty_text`, `tint` |
| `hk-timers-card` | Every running timer as its own tile, with a live countdown. | `timers` (`[{entity, label, glyph, label_entity}]`), `empty_text`, `tint` |
| `hk-timer-strip-card` | A compact row of live countdowns for the running quick timers. | `entity` (default `sensor.running_quick_timers`), `scale`, `fixed` (pinned to the bottom, for a screensaver), `plated`, `glass`, `docked` (a slim row in a docked bar: soonest first, a quarter of the width each, swiped one at a time on a phone with dots, a ring of time left) |
| `hk-timer-new-card` | Type a duration, pick a name, start a timer. | `create_script` (default `script.quick_timer_create`), `name_chips` |

The quick-timer cards use the optional timer helpers that come with HK
Frontend (`helpers/quick_timers.yaml`); see
[Your First Screen](Your-First-Screen.md#what-next).

`floors`, when you write it, is a list of `{name, areas: [{id, name}]}`, and
`id` is the Home Assistant **area id**.

## Cameras and Live TV

| Card | What it is | Main options |
|---|---|---|
| `hk-camera-mosaic-card` | The camera strip: one camera live, the others as snapshots, in one scrolling plate. Tap a camera for its sheet. | `cameras` (`[{entity, name, option}]`), `selector` (an `input_select` or `select` whose option picks the live camera; `option` matches a camera to it), `height`, `refresh` (seconds between snapshots, default 10; 0 stops them), `seam`, `radius`, `stills_only` (no live tile: every camera a snapshot, one tall then two stacked, as a room page shows them; a single camera is one 16:9 snapshot), `own_cameras` (this card’s `cameras`, not the screen’s camera list) |
| `hk-camera-live-card` | One camera live, as a tile. On a page of them, each waits its turn: three connect at a time, each opening on the camera’s last picture until its video is on screen (the Cameras page). | `entity` (a camera), `aspect_ratio` (default `16x9`), `fit_mode` (`cover` or `contain`) |
| `hk-doorbell-card` | One camera live **with its sound**. With a speaker, a hold-to-talk button. | `entity` (a camera), `name`, `speaker`, `live` (stream as you speak, for UniFi Protect doorbells; off: a recorded message played when you let go), `sound`, `aspect_ratio` (default `4x3`), `fill`, `tuning` |
| `hk-tv-guide-card` | The [Live TV](Live-TV.md) guide: every channel with what is on, and a tap that plays one full screen. | `title` |

When the screen’s settings in HK Settings choose cameras for its camera strip
(or the live camera), those win over the card’s own list.

Talking needs the page to be on **https**: browsers allow the microphone only
on a secure page.

## Music

These cards need the [Music](Music.md) feature. Without it, each says so (“Add the Music feature to play music here”) instead of showing empty rooms. They follow whichever
room the screen is showing, so they name no speaker themselves.

| Card | What it is | Main options |
|---|---|---|
| `hk-music-card` | The whole Music page: what plays and where (Speakers, Volume, Queue) on the left, Browse beside it; one column on a phone. Generated screens use it for their Music page. | `focus_search` (start in the search box) |
| `hk-now-playing-card` | Artwork, the track and controls for the screen’s music. Added from the card picker it has its progress and volume already. | `meta_card` (the controls under the title, usually an `hk-media-control-card`), `sub_card` (the controls under the title, usually `hk-media-control-card`s), `tall` (one column, for a narrow column or a phone), `hide_idle` (draws nothing while nothing is playing or paused) |
| `hk-speaker-picker-card` | Choose speakers, then tap a playlist. Also Move Music, Stop All and Clear. (The older Play Music page’s card; `hk-music-card` replaces it on generated screens.) | `browse_url` (where its Browse Music pill goes, for example `./music-browse`; without it there is no pill) |
| `hk-library-card` | Browse and search the Music Assistant library, playing to the screen’s room. | `player` (always play here), `fallback_player`, `hide` (categories to leave out), `discover` (the first page’s rows) |
| `hk-screensaver-now-card` | What is playing, for a screensaver’s `cards:` (not in the card picker). | `music: true`, or `players` (in priority order, groups first) |
| `hk-browse-card` | Music Assistant’s own web player, framed in a page. | `port` (default 8095), `path` (default `/#/home`), `host`, `height` |

`hide` and `discover` default to **HK Settings → Pages → Music →
Browse**.

## Energy

| Card | What it is | Main options |
|---|---|---|
| `hk-energy-period-card` | The Energy page’s tabs: Now, Today, This Week, This Month. Every HK energy card on the page follows them. | `opens_on` (`now`, `day`, `week`, `month`) |
| `hk-energy-hero-card` | Now: the whole home’s power, its last three hours and your readings. The other tabs: rings against a usual day, with where the period is heading. | `height`, `climate_path` |
| `hk-energy-highlights-card` | Four sentences on what stood out. | `height` |
| `hk-energy-where-card` | One bar of the house’s energy (power on Now) by section. Tap a section to light it on the page. | `height` |
| `hk-energy-day-card` | The day as a clock, the week as bars, the month as a calendar against a usual day (tap a day for that day’s kWh, cost and devices); wider, the period’s figures and Most Used. | `height` |
| `hk-energy-battery-card` | The house battery: its level now, what it took in and gave back, and the tab’s own bars. | `height` |
| `hk-energy-water-card` | Water or gas against a usual amount, with the tab’s own bars. | `source` (`water`, `gas`), `height` |
| `hk-energy-tracking-card` | The meters and runtimes you follow (the Energy feature’s **Tracking**), a row each: how it compares with its usual, its figure and bars for the tab. | `compact` (Without Bars: each row’s name, figure and comparison only) |
| `hk-power-flow-card` | Right now: from the grid, the house and the battery, as a flow chart with light running along each line while power flows (on the grid, or on the battery). With no battery named, the grid and the house alone. | `grid`, `home`, `charge`, `discharge` (power sensors), `level`, `grid_status`, `title` |
| `hk-power-status-card` | A home battery system in sentences: a grid outage or a fault first, in red, then the sun, what the house runs on, a car charging, the backup time, EPS and Storm Mode. With no battery named, it says nothing of one. | `grid_status`, `problem`, `level`, `backup`, `home`, `charge`, `discharge`, `eps`, `storm`, `solar`, `grid`, `cars`, `chargers` |
| `hk-house-battery-card` | A home battery drawn as a battery: its level, the reserve and limit marked on it, the backup time, its packs and their temperatures, EPS and the charging speed. Light runs through it while it charges or powers the house. | `level` (required), `stored`, `backup`, `reserve`, `limit`, `speed`, `charge`, `discharge`, `eps`, `packs` (`[{name, level, temperature}]`), `title` |
| `hk-segment-card` | A select’s options as HK Frontend’s segmented control (the calendar’s and the Energy tabs’), with a line saying what the chosen one does (an operating mode). On a phone the names wrap rather than cut off. | `entity` (required), `options` (`[{value, name, description}]`; empty: the select’s own) |
| `hk-power-house-card` | The house full width with no card around it: a layered picture where each part shows only when the house has it (panels with solar, the battery with one, the car while one is home), the figures as small floating chips over their part of the house, light running along the real cables (the pole's while buying or selling, the car's while it charges), and the battery's level as a slim bar on the cabinet. The Cars chip has a row for each car. On a phone the chips line up above the house. A house ships with HK Frontend (`frontend/power-house/`); `art` puts your own in its place. | `art` (a folder of your files with `art.json` and its layers; empty: the house that ships), `home`, `grid` (negative is selling), `grid_export`, `grid_status`, `solar`, `level`, `charge`, `discharge`, `reserve`, `cars` (`[{name, level, power, home, plugged, charge, charger}]`; `charger`: what reads that car's charging), `chargers` (the wall chargers' power sensors: live, where a car's own reading lags), `max_height` (default 560) |
| `hk-power-load-card` | The whole house right now: one bar of what the house battery backs up, what it does not and a car charging; the three drawing the most, each marked; how much of the house the battery covers. | `home` (required), `backed_power` (the battery panel's output), `grid_status`, `devices` (`[{name, power, backed}]`), `cars`, `chargers`, `link` |
| `hk-power-sun-card` | Where the sun goes, now and today: to the house, the battery and the grid, in Home Assistant's own order, and how much of today's sun the house used itself. | `solar` (required), `grid`, `grid_export`, `home`, `charge`, `discharge` |
| `hk-usage-card` | Today’s energy use or runtime against the last two weeks, with the Energy page’s bar chart: this week in the tile’s color, last week dimmed, last week’s average dotted. | `stat` (required: a sensor with long-term statistics), `name`, `compare`, `align` (`left`, `center`), `opts` (chart options, for example `{colour: orange}`), `height`, `entity` (opened by a tap; empty: `stat`), `tap_action` |
| `hk-trace-card` | A line graph of a sensor’s last few hours, drawn like the Energy page’s Now tab, with its current value. | `entity` (required), `trace` (`{hours, colour, title}`; the key is spelled `colour`), `margin`, `tap_action` |
| `hk-battery-strip-card` | A home battery’s charge drawn as a small battery, like the House Battery card: the reserve and the charge limit ticked on it, light running through it while the house draws on it. | `entity` (required, percent), `name`, `stored`, `discharge`, `reserve`, `limit`, `margin`, `tap_action` |

The `hk-energy-…` cards read the [Energy](Energy.md) feature and Home
Assistant’s Energy settings, and need no entities of their own; add **HK
Energy Tabs** first and the others follow its tab. The home battery cards
(`hk-power-flow-card`, `hk-power-status-card`, `hk-house-battery-card`,
`hk-segment-card`, and the Power page's `hk-power-house-card`,
`hk-power-load-card` and `hk-power-sun-card`) don’t need the feature: each
reads the entities you give it, so they suit any home battery system, and
reads power in W or kW as the sensor reports it. Only Where the Sun Goes's
**Today** half reads the feature. On all of them, a tap on a figure, a row or
a sentence opens that entity’s sheet.

## Pop-ups

A pop-up is a sheet over the dashboard that opens when the page’s address ends
in its hash (`#garage`), or by itself when its conditions are met. Closing it
takes the hash off the address.

Pop-ups you make in **HK Settings → Library → Pop-ups** work on every screen
with nothing on the page (see [Detail Sheets and Pop-ups](Detail-Sheets-and-Popups.md)).
The cards below are for a pop-up that belongs to one dashboard’s YAML. A card
on the page that claims the same hash as a Library pop-up wins.

| Card | What it is |
|---|---|
| `hk-popup-card` | One pop-up. It takes no space on the page. |
| `hk-popup-group-card` | Several pop-ups in one card, `popups: [...]`, each an `hk-popup-card` config (its `type` can be left out). Handy for one shared file. |

A pop-up belongs to the view it is placed in; on another view its hash opens
nothing.

**`hk-popup-card` options**

| Option | Default | What it does |
|---|---|---|
| `hash` (required) | | The address ending that opens it, for example `"#garage"`. |
| `cards` (required) | | The cards inside, as a list. They are built when it first opens and stop while it is closed (a live camera stops streaming). |
| `detail` | | Instead of `cards`: an entity whose detail sheet the hash opens. |
| `position` | `center` | `bottom` rises from the bottom edge. |
| `modal` | `true` | `false`: the page stays usable around it and is not dimmed. |
| `dock` | `false` | With `position: bottom` and `modal: false`: the screen's bottom edge, full width, beside a docked menu. The page gets room below it so its last row clears it, and a bottom tab bar rides above it. The [Now Playing bar](Music.md#the-now-playing-bar) is docked. |
| `width`, `max_width`, `padding`, `radius` | `900px`, –, `18px`, `42px` | Its size and shape. |
| `background` | `#1c1c1e` | `transparent` shows the cards only. |
| `blur` | | A background blur, for example `40px`. |
| `backdrop` | `0.8` | How dark the page behind it is, 0 to 1. |
| `clip` | `false` | Clip the cards to its corners. |
| `vars` | | CSS variables for the cards inside, for example `{ha-card-background: transparent}`. |
| `auto_close` | | Close after this many milliseconds from the last touch in it, for example `60000`. |
| `close_outside` | `true` | A tap outside closes it. |
| `close_button` | `false` | Show a close button in its corner. |
| `trigger` | | Conditions that open it when they become true (below). |
| `trigger_close` | `false` | Also close it when they become false. |
| `dismissable` | `false` | Closed by hand, it stays closed on that screen until what it shows changes. |
| `dismiss_scope` | | What counts as a change for `dismissable`. |
| `close_action` | | An action run when it closes (not when switching to another pop-up). |

**Conditions** in `trigger` are a list, all of which must hold:

- `condition: state` with `entity`, and `state` (one or a list) or
  `state_not`. `grace: 20` keeps it true for 20 seconds after it stops being.
- `condition: numeric_state` with `entity`, `above` and `below`.
- `condition: and`, `or` or `not`, with `conditions`.

Instead of `entity`, `entity_from: {music: true}` follows the screen’s music.

---
