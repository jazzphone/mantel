<h1 align="center">HK Frontend</h1>

<p align="center">
Home Assistant dashboards inspired by Apple’s Home app.<br>
Built from your own rooms and devices, and set up entirely in the UI.
</p>

<p align="center">
<sub>Built and designed using <b>Claude Opus</b> for the code and <b>Codex</b> for the image assets.</sub>
</p>

<p align="center">
<a href="https://github.com/jazzphone/hk-frontend/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/jazzphone/hk-frontend?style=flat-square&label=release&color=0a84ff"></a>
<a href="https://hacs.xyz"><img alt="HACS custom repository" src="https://img.shields.io/badge/HACS-custom-41BDF5?style=flat-square"></a>
<img alt="Home Assistant 2026.8 or newer" src="https://img.shields.io/badge/Home%20Assistant-2026.8%2B-18BCF2?style=flat-square">
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/jazzphone/hk-frontend?style=flat-square&color=8e8e93"></a>
</p>

<p align="center">
<img src="docs/images/hero.webp" width="900" alt="The Home screen on a wall tablet at a fall sunset, leaves falling behind the tiles, and on a phone on a starry fall night">
</p>

<p align="center">
<b><a href="https://github.com/jazzphone/hk-frontend/wiki/Install">Install</a></b> ·
<b><a href="https://github.com/jazzphone/hk-frontend/wiki">Documentation</a></b> ·
<b><a href="https://github.com/jazzphone/hk-frontend/wiki/Gallery">Gallery</a></b> ·
<b><a href="https://github.com/jazzphone/hk-frontend/releases">What’s new</a></b>
</p>

## Screens that build themselves

Add a screen and HK Frontend builds it from your floors, areas and devices: the clock and weather, status chips, cameras, scenes, favorites, a section for every room, a page for each room and each kind of device, and a [calendar](https://github.com/jazzphone/hk-frontend/wiki/Calendar) of the month, week or day. A new light shows up on its own. The same screen works on a wall tablet, a computer, an iPad and a phone.

<p align="center">
<img src="docs/images/tablet-lights.png" width="49%" alt="The Lights page">
<img src="docs/images/tablet-climate.jpg" width="49%" alt="The Climate page">
</p>

## Get around your way

Every screen chooses how you move between its pages and rooms.

- **A menu like the Home app's sidebar**: always open beside the page, behind a button, or pulled out with a swipe from the left edge. ([Menu](https://github.com/jazzphone/hk-frontend/wiki/Menu))
- **A floating tab bar like iOS apps have**, along the bottom or the top, or as a rail down either side of a tablet.
  - It can shrink to a small button or hide as you scroll, and even start small.
  - Small, Medium or Large, and you choose how many pages get a tab.
  - The page moves smoothly clear of it, so nothing important hides underneath.
  - **More** holds the rest: the other pages, every room, and Home Assistant's own Settings, Integrations and Notifications, as icons or as a list. ([Tab Bar](https://github.com/jazzphone/hk-frontend/wiki/Tab-Bar))

<p align="center">
<img src="docs/images/tablet-menu.png" width="49%" alt="A wall tablet with the side menu open: Home, the pages and every room">
<img src="docs/images/tablet-tabbar-rail.png" width="49%" alt="The tab bar as a rail down the right side, More open beside it as a list">
</p>

## Tap for the controls

Tap a light, thermostat, lock, garage door, speaker or vacuum and a sheet opens with the controls it needs. Each room and category page has a [status row](https://github.com/jazzphone/hk-frontend/wiki/Status-Rows) like the Home app's: *Motion · Emma’s Room*, *Valve · Running*. Pop-ups show the doorbell camera or the alarm keypad, and an automation can open one on chosen screens. Tiles have the Home app’s own size and spacing, in Apple’s font wherever it is there. Every accessory can have its own name, icon (any of Apple’s Home glyphs, or Home Assistant’s), tile size and place among its neighbors. Touch a graph for its value, drag a thermostat’s dial and watch it follow your finger.

<p align="center">
<img src="docs/images/sheet-light.png" width="49%" alt="A light’s detail sheet with a brightness slider">
<img src="docs/images/sheet-thermostat.png" width="49%" alt="A thermostat’s detail sheet">
</p>

## A live sky

Behind every page, a sky that follows the weather and the time of day: clear and starry, golden at sunset, gray and flashing in a thunderstorm, with rain or snow when it falls. Choose **[Realistic clouds](https://github.com/jazzphone/hk-frontend/wiki/Live-Sky#choose-its-look)** — photographic clouds picked from the weather and lit by the sun — and **[New Decorations](https://github.com/jazzphone/hk-frontend/wiki/Seasonal-Decorations)**, woodland scenery that comes alive for autumn, Halloween, Christmas, birthdays and the rest of the year. Or set the Background to a still **Color**, a **Photo** of your own, or **[Landscapes](https://github.com/jazzphone/hk-frontend/wiki/Live-Sky#landscapes)** — fifty photos that come with it, a new one each time the screen wakes or on a schedule — softened with its own blur, dim and tint, for every screen, one screen, a page or a room. **Liveliness** sets how much moves in it — the bats, leaves and fireflies, and how often something crosses the moon — for each occasion and each screen, calming down when nobody is around.

<p align="center">
<img src="docs/images/sky-new-halloween.jpg" width="49%" alt="New Decorations: Halloween night, jack-o'-lanterns in the trees under a full moon">
<img src="docs/images/sky-realistic-golden.jpg" width="49%" alt="Realistic clouds lit gold near sunset">
</p>

<p align="center">
<img src="docs/images/tablet-background-photo.png" width="49%" alt="Home on a wall tablet over a photo of an autumn lake">
<img src="docs/images/tablet-background-landscapes.png" width="49%" alt="Home on a wall tablet over one of HK Frontend's Landscapes">
</p>

## Made for the wall

Put a screen on a wall tablet and it looks after itself. It returns to Home when left alone, and fills the screen with no Home Assistant header or sidebar. Each tablet has its own page in HK Settings: whether it is awake, on the screensaver or dark, and why, its battery, what it does when left alone, and its Sleep Screen. ([Wall Tablets](https://github.com/jazzphone/hk-frontend/wiki/Wall-Tablets))

When nobody is using it, it shows your photos (one at a time, or a mosaic of up to five), a full-screen **clock** in fifteen styles over a moving background or fifty landscape photos that come with it (with a dim red Night Mode), or the forecast over a living landscape: the sky, the clouds and the light of the moment. Now and then **Weather** (today at a glance, over the live sky) or **Home Energy** (today's energy, cost and water against a usual day, in the Energy page's rings) comes in. The landscape dresses up for Halloween, Christmas, the Fourth of July and birthdays, like the dashboards. Over the top go the clock, the weather, what's playing, the timers and whether the house is secure, with your coming events beside them if you like. ([Screensaver and idle](https://github.com/jazzphone/hk-frontend/wiki/Screensaver-and-Idle))

**[Sleep Screen](https://github.com/jazzphone/hk-frontend/wiki/Sleep-Screen)** keeps each tablet dark when nobody needs it and awake the moment somebody does. HK Frontend decides from the room’s presence sensors, quiet hours, the doorbell, smoke and away mode, sets the brightness for day and night, and fades in from black without a flicker — or your own automations decide, with one action.

<p align="center">
<img src="docs/images/tablet-forecast-halloween.png" width="49%" alt="The forecast screensaver on Halloween night: lanterns in the trees, jack-o’-lanterns, a big moon">
<img src="docs/images/tablet-forecast-christmas.png" width="49%" alt="The forecast screensaver on Christmas night: lit trees, a snowman and Santa’s sleigh across the moon">
</p>

<p align="center">
<img src="docs/images/saver-clock-faces.png" width="100%" alt="Six of the screensaver's fifteen clock styles">
</p>

<p align="center">
<img src="docs/images/saver-home-energy.png" width="70%" alt="Home Energy on the screensaver: today's energy, cost and water against a usual day">
</p>

<p align="center">
<img src="docs/images/settings-wall-tablets.png" width="49%" alt="All Screens → Wall Tablets in HK Settings: each tablet, awake, on the screensaver or dark">
<img src="docs/images/settings-tablet.png" width="49%" alt="One wall tablet's page: what it is doing now, when it is left alone, its Sleep Screen">
</p>

## Energy at a glance

The **[Energy](https://github.com/jazzphone/hk-frontend/wiki/Energy)** feature builds an Energy page from Home Assistant’s own Energy settings, with four tabs: **Now** (the whole home live, what is drawing the most, the house battery and the cars), and **Today**, **This Week** and **This Month** (rings against a usual day, where the energy went, the month as a calendar, and the meters you track). Every circuit, room, appliance and outlet has a tile, with a power button where there is a switch. Beside it, a **[Power](https://github.com/jazzphone/hk-frontend/wiki/Energy#the-power-page)** page for right now and the controls: the grid, the sun, a house battery with its mode and levels, the cars charging, and every device marked when the battery backs it up. A screen can show only some pages — a wall panel that is just the Energy page, say.

<p align="center">
<img src="docs/images/tablet-energy.png" width="49%" alt="The Energy page on a wall tablet">
<img src="docs/images/tablet-power.png" width="49%" alt="The Power page on a wall tablet: the grid, the house and the battery right now">
</p>

## Set up in the UI

**HK Settings** in the sidebar holds everything, with a live preview of each screen as a phone, an iPad, a wall tablet, a desktop or a car. Choose the glass: see-through, frosted, blurred, or **Tinted**, the Home app’s flat dark plate. A Setup Assistant makes your first screen, and Setup Check says what is missing. There is nothing to add to `configuration.yaml`.

<p align="center">
<img src="docs/images/settings-screen.png" width="100%" alt="A screen’s settings in HK Settings, beside a live preview of it at wall-tablet size">
</p>

## Install

You need **Home Assistant 2026.8** or newer and **[HACS](https://hacs.xyz)**.

1. In **HACS**, open **⋮** → **Custom repositories**, add `https://github.com/jazzphone/hk-frontend` as an **Integration**, then download **HK Frontend**.
2. Restart Home Assistant.
3. In **Settings** → **Devices & services**, select **Add integration** and choose **HK Frontend**.
4. Open **HK Settings** in the sidebar. The Setup Assistant starts on its own.

Step by step, with what you should see: **[Install](https://github.com/jazzphone/hk-frontend/wiki/Install)**. Apple’s font and glyphs are optional and can’t be bundled; **[Your files](https://github.com/jazzphone/hk-frontend/wiki/Your-Files)** shows how to add your own.

## Optional features

Add each from **Settings** → **Devices & services** → **HK Frontend** → **Add feature**.

| | |
|---|---|
| **[Music](https://github.com/jazzphone/hk-frontend/wiki/Music)** | Whole-home music through Music Assistant: one Music page to play and browse, rooms, speaker groups and playlists, a docked Now Playing bar, and the music on the screensaver |
| **[Live TV](https://github.com/jazzphone/hk-frontend/wiki/Live-TV)** | An HDHomeRun tuner’s channels and guide, full screen on any screen |
| **[Clean Areas](https://github.com/jazzphone/hk-frontend/wiki/Clean-Areas)** | Pick rooms and send the vacuums that reach them |
| **[Alarm PIN](https://github.com/jazzphone/hk-frontend/wiki/Alarm-PIN)** | A PIN in front of an alarm panel that takes no code of its own |
| **[Energy](https://github.com/jazzphone/hk-frontend/wiki/Energy)** | An Energy page built from Home Assistant’s Energy settings, with a live tile per circuit and device, and a Power page for right now: the grid, the sun, a house battery and the cars |
| **[Notifications](https://github.com/jazzphone/hk-frontend/wiki/Notifications)** | A banner at the top of the screens when something happens at home, with a camera’s snapshot; whole categories at once — doors, locks, leaks, cameras, vacuums, the alarm — and your calendars’ events before they start. A tap opens the accessory’s sheet with the notification on it. Do Not Disturb, and a wake up to the screensaver |

The **[Weather page](https://github.com/jazzphone/hk-frontend/wiki/Weather)** combines current conditions, hourly Temperature / Rain / Wind tabs, the daily forecast and detail tiles over the live sky. Its built-in radar uses NOAA or RainViewer over OpenStreetMap, with a centered regional view and controls in the expanded map. Choose its sources, forecasts and radar in **HK Settings → Pages → Weather**; no separate HACS radar card is required.

**Built in, nothing to add:** the **[Calendar](https://github.com/jazzphone/hk-frontend/wiki/Calendar)** (month, week or day, and your coming events on the screensaver), **[Weather](https://github.com/jazzphone/hk-frontend/wiki/Weather)**, **[Cameras](https://github.com/jazzphone/hk-frontend/wiki/Cameras)**, **[Pop-ups](https://github.com/jazzphone/hk-frontend/wiki/Detail-Sheets-and-Popups)** an automation opens (the doorbell, the alarm keypad), the **[Screensaver](https://github.com/jazzphone/hk-frontend/wiki/Screensaver-and-Idle)** and the **[Sleep Screen](https://github.com/jazzphone/hk-frontend/wiki/Sleep-Screen)**.

## HK Frontend and Mantel

HK Frontend is HK inside Home Assistant. **Mantel** is its sibling: the same screens, from the same code, served by a
server of its own beside Home Assistant, with people and roles, wall tablets that sign themselves in and an audit log
of every command. Use either, or both together: linked, Mantel's Owner picks who runs each wall tablet, and every
entity keeps its id. Each keeps its own HK settings. [HK Frontend and Mantel](https://github.com/jazzphone/hk-frontend/wiki/HK-Frontend-and-Mantel)
compares them.

## Help

Start with **[Troubleshooting](https://github.com/jazzphone/hk-frontend/wiki/Troubleshooting)**. To report a problem, [open an issue](https://github.com/jazzphone/hk-frontend/issues) and attach the diagnostics (**Settings** → **Devices & services** → **HK Frontend** → **⋮** → **Download diagnostics**).

---

<sub>Screenshots are of one home that has added Apple’s font and glyphs; camera pictures are blurred. HK Frontend is an independent project, not affiliated with or endorsed by Apple Inc. Apple, HomeKit, SF Pro and SF Symbols are trademarks of Apple Inc. The seasonal sky illustrations were generated with OpenAI’s image tools, and the cloud, rain and snow textures by `tools/sky/gen_sky.py`; until you add your own glyphs, icons come from [Material Design Icons](https://pictogrammers.com/library/mdi/) (Apache 2.0). [MIT license](LICENSE).</sub>
