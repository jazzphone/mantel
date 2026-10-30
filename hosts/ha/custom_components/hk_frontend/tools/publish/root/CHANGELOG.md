# Changelog

HK Frontend's releases, newest first. A GitHub release's notes are its section here (`tools/publish/publish.py
--release`). Home Assistant 2026.8 or newer.

## Unreleased

## 1.17.0 - 2026-10-30

- **A HomeView-style look for the Home Grid, every part of it an option** (a screen looks as it did until you pick something): square cells on any screen and a **Square** (3 × 3) screen type; HomeView-style starters, with **Home with Pane** recommended for a landscape tablet; **Centred** tiles; a **Big Number** thermostat; an **Analog Numbers** clock; a **Cameras** face of up to nine stills; **Bright Glass** and twelve **Wallpapers** of our own that tint the tiles, on every surface but HK Settings.
- **Swipe Between Pages.** A sideways swipe on a page goes to the next or the previous one: the page follows your finger, the next comes in beside it over the still sky, and the tab bar's highlight slides along (down a rail too). Through the tab bar's tabs, left to right; a Home Grid turns its views first. The scenes row, a camera strip, sliders and blocks that swipe keep their own swipe, and a swipe from either edge stays the menu's and the browser's. **All Screens → Menu → Gestures** (Automatic: where a tab bar shows; On; Off), and each screen's own under its Menu Settings.
- **Side Pane:** one per screen, of the sections you pick (Clock, Weather, Calendar, Now Playing, Security, Camera, Timers, Energy, Climate, Who's Home, To-do, Notifications) at four sizes, beside Home, every page or the screensaver, on the left or the right. It takes over the screensaver's pane and Now Playing's side pane, with their settings. To-do reads Home Assistant's to-do lists.
- **The Pages screen:** after Home, an iPad-style home screen of the dashboards' pages as large icons (live ones for Calendar and Weather, badges, a Rooms folder), a way around without a tab bar.
- **New screensaver faces:** Glance, Month, Day and Big Weather; Photo Titles; and the Liquid, Giant Numerals and Scattered Numerals clocks. (Time Behind needs Mantel Photos.)
- **More When Near:** a sensor that sees the space in front of a tablet ends its screensaver, through the Sleep Screen.
- On a phone with a side strip (the iPhone Duo), Live TV's caption and ✕ stay clear of it, and the docked Now Playing bar's plate runs under it.

## 1.16.0 - 2026-10-30

- **Home Grid editor: the other blocks make room.** Drag a block onto others, with the mouse or a finger, and as you go they slide out of its way, as widgets do on an iPad's Home Screen: into the space it left (in the same arrangement), or the nearest free space, moving another block aside only when there is no other way. Let go to keep it, Escape or let go outside the grid to put everything back; one Undo takes back the whole move. Before, a move only went into empty space or swapped with a block of the same size.
- **Clear of a phone's side safe area, the tab bar in the iPhone Duo's strip.** On a phone with system controls down one side (the iPhone Duo's strip, in the Home Assistant Companion app) or a phone held sideways (its Dynamic Island at the side), the screens keep their content, the menu, the sheets and the tab bar clear of it while the sky still fills the display. Where the strip has an empty foot, the tab bar becomes a rail there, below the system's items (**Menu → Tab Bar → Use the Side Strip**, on by default); the tabs that don't fit are in More. Nothing changes in a browser on a computer.

## 1.15.0 - 2026-10-29

- **Appearance and Menu, reorganized.** All Screens → Appearance: Style (the screens with their own look named under it), Colors, Background (Sky / Background, no longer its own sidebar entry) and Tab Bar Look (Tab Bar Glass, from Menu). All Screens → Menu: Menu on Each Screen ("Tab Bar · Button"), the Side Menu, Edge Tab and Tab Bar pages (each with everything about it and which screens use it) and Rooms in the Menu.
- **One Accent Color** for the menu's highlight and Flat's accent, which were the Highlight Color and Flat's Accent Color. What you saved stays: a Flat screen's own accent shows as Just This Screen.
- **A screen's menu follows All Screens one setting at a time**, as its Appearance does: each row says Same as All Screens or Just This Screen, with Reset to All Screens. On the first start after updating (entry 1.17), a screen with its own menu keeps only the settings that differ from All Screens'; nothing any screen shows changes.
- **Page Header is Back Button & Title**, in a screen's Header. A screen's menu is set only on its page; its Menu Settings list only the navigation it uses (Side Menu, Edge Tab, Tab Bar).
- A screen's Highlight Color link no longer leads nowhere while its menu follows All Screens. Every moved settings address opens the new page.
- **Recommended for This Device: one change at a time for a slow tablet.** A tablet measures how many frames a second it draws (5 idle seconds, lit, about 20 seconds after loading and then hourly). Opened on a tablet that draws under 45, HK Settings says so under This Device on that screen's page and suggests one change for that screen: Blur, Frosted or Tinted to Glass, then Rain & Snow off, Moving Things behind the cards, Animations off, and a camera's live video off, with **Use Flat** beside most. If it is still slow an hour after you take one, the next appears. Nothing changes until you tap one.
- **Smaller to load:** `/hk` sends the dashboards' code without comments or indentation (`frontend_min/`, about 45% smaller; `frontend/` keeps the readable source). The realistic clouds the sky never draws are left out.
- **Lighter on tablets that run all day:** nothing runs under the kiosk's black screen (the photo slideshow, the constellation clock, the music card's clock); state updates are applied once a frame; pages visited long ago are let go and rebuilt when opened again; Reduce Motion stills the sky and the screensaver's Slow Zoom.
- **Album art and screensaver photos sized for the screen**, and `/hk` files sent compressed (gzip) to a browser that takes it.
- A Cameras page opened directly draws its cards (a card made before its code arrived never got its data).

## 1.14.3 - 2026-10-28

- Hassfest accepts the translations: the addresses in the Linked to Mantel texts are description placeholders.
- The Power page draws a car parked at home, unplugged, without its cable.
- Logos for Home Assistant's own brand folder (`logo.png`, `dark_logo.png` and their `@2x` files).

## 1.14.2 - 2026-10-28

- Home Grid, Now Playing: Speakers and Browse turn the card over.

## 1.14.1 - 2026-10-27

- iPad Safari: a Home Grid beside the docked menu no longer scrolls, and a swipe on the tab bar is not the page's.
- Edit mode on a blurred page: a carried pill takes its frost with it.

## 1.14.0 - 2026-10-27

- Phones: Tabs in Bar. All Screens' Appearance Style names the screens that have their own look.
- Edit mode with Reduce Motion: a frame round what each pill paints. Flat, left on a quiet page, clears the scenes row.

## 1.13.0 - 2026-10-26

- Edit mode: change a screen where you see it. Room pages, Home's room sections, category pages, Favorites, the scenes
  rows, the side menu, the tab bar, More and the Room Order sheet each have their Edit bar.
- All Screens' room order is saved with the house settings' version; the Edit bar sits under a top tab bar.

## 1.12.0 - 2026-10-26

- Two editors don't overwrite each other: a saved board carries the version it was opened at.

## 1.11.0 - 2026-10-26

- Home Grid: a screen type of its own, with blocks that swipe, seven starter layouts, a desktop editor, Night Mode,
  Month View, Big Temperature, Hide Box, Show Boxes and Fill the Screen.
- Tab bar: Labels, Icons and Names or Icons Only; a resting rail gives a Home Grid the whole width.
- Detail sheets fit short screens, in two columns with nothing scrolling.
- Image Look for the Glass looks' Photo and Landscapes.
- The audit's fixes: security, reliability and settings.

## 1.10.7 - 2026-10-22

- Keep in View: the screensavers' shared code keeps faces in view, and Mosaic follows the photos' shapes.

## 1.10.6 - 2026-10-22

- Doorbell talk is live through Mantel again; Fully's reload ends Live TV.
- Mantel Settings: each thing in one place.

## 1.10.5 - 2026-10-21

- Linked to Mantel refuses what isn't a Service credential, and a scope turned off is off.

## 1.10.4 - 2026-10-21

- While Mantel runs the house, HK Frontend's dashboards get their features from Mantel.

## 1.10.3 - 2026-10-21

- While Mantel runs the house, HK Frontend steps aside: its actions go to Mantel and its settings items point to
  Mantel Settings.

## 1.10.2 - 2026-10-21

- Screens are each drawn in one place (Mantel or Home Assistant); Mantel adds, splits and removes them.

## 1.10.1 - 2026-10-21

- Linked HK Frontend uses Mantel's settings: one copy while Mantel runs the house.

## 1.10.0 - 2026-10-21

- HK Frontend and Mantel are two products: HK Frontend stays a Home Assistant integration of its own.
- Screens follow the house's locale, time zone, units and place.
- Live TV keeps its own tablet awake; cameras rest while another window has the focus.
- Climate shows the house's temperature through the day; Energy's Tracking fits two graphs to a line.

## 1.9.0 - 2026-10-19

- Prepared with Mantel Link: HK Frontend's actions, entities and features can be forwarded to, and run by, Mantel.
