# Changelog

All notable changes to Mantel are listed here. Versions follow [semantic versioning](https://semver.org); the Home Assistant App, the Docker images and the Python package share one version number.

## Unreleased

The first public release.

- Standalone Home Grid accessories and scenes use the room-page tile builders for saved glyphs, colors and state-specific appearance, while preserving grid sizes and caption choices.

- Home Grid swipe cards support mouse dragging and horizontal wheel/trackpad paging without returning to the opening page on state updates. Header chips align to the right and remain scrollable on overflow.
- Group controls appear in Lights and accessory type lists independently of status counts, so groups remain available without automatically double-counting their members.
- Ignore Announcements recognizes HA service calls in Mantel, including native/MA speaker counterparts, with bounded display-only markers and disconnect cleanup.

- Home Grid shared blur reaches cards inside swipe blocks, including thermostats. Page-control pills size to the page count and keep all dots inside narrow cards.

- Home Grid keeps starter layouts inside Screen Settings while editing cards. Room controls distinguish one room from swiping between rooms, with a starting-room choice that matches the preview and idle return.

- Home Grid keeps fixed tall-tile proportions with uniform fit and a per-screen scale control. Room and scene groups support six columns by two rows; sparse room groups retain empty rows. Home Assistant person portraits load through Mantel and fall back to initials.

- **Home Grid follow-up:** camera selections stay on one camera; screen settings collapse, with independent header clock/weather switches. Room groups use taller filling tiles, thermostats share the card plate, and centred page dots have a pill. Picker icons and illustrative data are complete. Larger weather cards show more readings and forecast detail, with an optional Sky weather background.

- **Home Grid editor (in development)**: desktop draft editing with drag and snap, equal-size swaps, keyboard moves, card options, pages, starter layouts and Save/Cancel. Mantel adds layout history and copying to another screen. The compact header, clock and thermostat layouts are refined, and swipe-page cards align with their neighbors. Review refinements add a searchable gallery with live previews, framed room and scene groups, a forecast widget, single-camera selection, security and timer controls, conditional blocks with fixed-size fallbacks, and consistent glass plates. Room and scene groups support individual background color, opacity and blur; scene pills fill their framed rows and music artwork aligns with track information.

- **Mantel Server**: serves HK Frontend's screens without Lovelace, from your Home Assistant's rooms and devices.
- **People and roles**: Mantel accounts with passwords, passkeys and authenticator codes, or sign-in with Home Assistant; Owner, Admin, Adult, Child and Guest roles, with grants per room and feature.
- **Wall tablets**: a browser enrolled as a tablet keeps its own credential and role, whoever is signed in.
- **Commands and audit**: commands are off until the operator turns them on; each one is checked against the person's and the device's role and written to the audit log before it is sent.
- **Music Assistant and cameras** through Mantel, **Mantel Photos** for the screensaver, and **backups**.
- **Mantel Link**: the Home Assistant integration that links Home Assistant to Mantel.
- **Three ways to run it**: the Home Assistant App, Docker Compose, or a Proxmox LXC.
- **Set Up Mantel**: a first-run checklist in Mantel Settings, each step worked out from the house (Home Assistant, screens, the household, the Owner's sign-in, the Alarm PIN, house commands) and opening the page that does it.
- **One step for a new wall tablet**: enrolling into a room with no HK tablet adds that HK tablet too.
- Importing HK's settings from a Home Assistant without HK Frontend says there is nothing to import; Setup Check says how house commands are turned on where Mantel runs.
- **Mantel Settings, each thing in one place**:
  - A wall tablet is one page (All Screens, Wall Tablets): its screen and kiosk app, and now the browser signed in to Mantel as it, its Home Assistant user and Sign Out. The separate Devices page is gone, and so is HK's Tablet User there.
  - Connections → Home Assistant has what Home Assistant has of Mantel: Mantel Link (a pairing code), HK Frontend (its credential, made right there) and the sidebar (Mantel Connect). Who runs each tablet and the bridge are under Moving from HK Frontend. Connections → Music Assistant has the Browse Music page's sign-in.
  - Service Accounts is under Advanced, and says which credentials Mantel made and what uses them.
  - Revoked tablets, Service accounts and Connect pairings leave their lists after 30 days, or at once with Clear List; the Audit Log keeps them. The Home Assistant App no longer leaves a revoked "App discovery" credential behind at every restart, and makes none when Mantel Link was set up by hand.
  - People: the Home Assistant user picker offers each person once and never a Wall Tablet account. Home Assistant users linked to Wall Tablet accounts (from before tablets were enrolled) move to their tablets in one step, and the accounts go.
  - Audit Log: From and To say Any Time, Now or the last hour, day, week or month, with a date only when you choose one.

- **Doorbell talk is live through Mantel again**: Mantel connects to Home Assistant for the doorbell while the tablet opens its own connection, and the card waits up to 4 s for the doorbell to listen (1.5 s was too short for Mantel's extra steps, so every press fell back to a recorded message). How long each press waited is in Mantel's log.

- **Keep in View for Mantel Photos**: Mantel finds where the faces are in each photo (only where, never who; on the server, nothing leaves the house), and the Photo and Mosaic screensavers crop and zoom around them. Photos already in Mantel are checked in the background. An Owner or Admin can set what stays in view by hand from a photo's preview (Keep in View), or put it back to Automatic. The Mosaic also picks layouts that fit the photos' shapes. Adds onnxruntime and numpy (about 140 MB installed).

- **Page health in Mantel's log**: each screen's page says how the page before it ended and how big it is each minute, to find why wall tablets reload every 15 minutes.

- **The House, when it matters**: with no HK Frontend in Home Assistant, Mantel takes the house by itself (Live TV through Mantel Link needed it switched on). While HK Frontend is still there, Set Up Mantel lists Move the House to Mantel, and Connections → Home Assistant says when it's time.

- **My Sessions, one row per browser**: every launch of the Mantel app left a 30-day "Browser on iPhone" session behind. The app's pages now keep one session, listed with the app under Mantel App, and signing the app out ends it.

### Fixed before release (engineering audit, October 2026)

Security:
- Changing the Alarm PIN from HK Settings needs a recent sign-in, as its other routes did.
- Room changes in Home Assistant, and rooms given to a person, apply at once to what each person and tablet may see and do.
- A Home Assistant sidebar connection is checked again like any session: a disabled or demoted person loses it.
- The Music Assistant page is signed in only for someone who may play every speaker, with house commands on.
- Mantel Link never sends its credential to an address a network announcement names.
- Live camera and Live TV streams end when the right to watch them ends; a camera hidden from someone can't be watched by its id.
- Entities named inside a command's data (joined speakers, a camera cast to a TV) are checked like its target; a wall tablet may watch cameras and talk at the door, not turn cameras off or record them.
- Sign-in: a right password no longer resets the count of wrong authenticator codes; adding an authenticator or passkey needs a recent sign-in; replacing an authenticator keeps the old one working until the new one is confirmed; Confirm It Is You accepts only your own passkey.
- Visitors through the Cloudflare tunnel are each their own address (one person's wrong passwords no longer slow everyone's sign-in from away).
- HK Frontend: the artwork proxy fetches only Music Assistant's image proxy on the home network, whatever `..` a link carries; five wrong PINs lock an Alarm PIN panel for 15 minutes.

Reliability:
- Screens follow the house again after the connection to Mantel drops.
- Screens and tablets follow All Screens' and All Tablets' settings (menu, tab bar, screensaver, Return to Home When Idle).
- Category notifications (doors, leaks, smoke) work right after Mantel starts.
- Docker and LXC: browser notifications and pairing the iPhone, iPad and Mac apps work (their keys live in the data folder, and in backups).
- Backups: a backup made by hand deletes no older ones; a database-only restore keeps your photos; leftovers of an interrupted backup are cleaned up.
- Push notifications survive an internet outage, and stop at an app that was signed out.

## 0.1.80 - 2026-10-26

- **Edit pages in place.** Owners and Admins can arrange a page from the page itself. Edit mode is not offered at a wall tablet.
  - **Opening it:** **Edit Page** in the side menu or the tab bar's More, or **Edit This Page** in a detail sheet's gear.
  - **In Edit mode:** pills wiggle (or get an outline with Reduce Motion on). Hold a pill briefly to pick it up and drag it within its group; a plain swipe still scrolls. Tap a pill's size badge to make it **Tall** or **Regular**.
  - **Where it works:** room pages, Home's room sections, Favorites and scenes row, a room's scenes row, and the Lights, Climate, Water, Security and Vacuums pages. Lights, Climate and Water follow each room's order, so the bar says when a move there reorders the room too.
  - **The menus:** the side menu, the tab bar and its More sheet can be reordered as well: drag a page between Top and Categories, hide one, or drop a tab on More.
  - **Room Order sheet:** the **Rooms** button in the Edit bar opens a list of the screen's rooms to drag, with Move Up / Move Down and an A to Z reset.
  - **Saving:** nothing is saved until **Done**, and **Cancel** puts everything back. If someone else changed the same layout meanwhile, Done says so and offers Reload or Save Anyway.
- **Pages redraw after a settings change.** A Mantel page used to show a save only after a reload. Now it redraws at once for your own save, and for another device's once nobody has touched the page for 30 seconds.
- **Versions for every layout save.** The accessory saves (`accessory/order`, `page_order`, `room_scenes`, `set`) and `settings/set` take an optional `expect_version`. An older version is refused as `conflict` and nothing is written. `panel/get` returns `versions["accessories"]` and `versions["house"]`. A linked HK Frontend now receives Mantel's version numbers in each settings frame, so its saves are checked against Mantel's.
- `/api/me` reports `at_tablet`.

## 0.1.79 - 2026-10-26

- **Mantel Link can pair again by a code inside Home Assistant.** On a Mantel run as a Home Assistant App whose Mantel Link brought its own credential, a second pairing at the App's own address (`http://<App>:8099`) would have been refused by 0.1.78's address check. The App's address now always counts as Mantel's own.

## 0.1.78 - 2026-10-26

- **Taking access away takes effect at once.** These end their open connections immediately instead of up to a minute later:
  - signing someone out, disabling them, or lowering their role;
  - revoking a wall tablet or a Home Assistant link;
  - unlinking a Home Assistant user.
  The connections that close are screens, talk-back, the Music Assistant page and Home Assistant dashboard feeds. Turning off Allow Control of the House also closes a Music Assistant page Mantel had signed in.
- **Renames reach open pages.** An area, device or entity renamed in Home Assistant shows on open dashboards and in Mantel Settings without a reload. Each page hears only of changes it may see, and the registry is served from a cache, so the Home Grid editor's previews no longer re-read about 2 MB each.
- **Two editors no longer overwrite each other.** If someone else saved a screen's Home Grid while you were editing it, Save (and Copy Layout To…) says "This screen changed since you opened it" and offers Reload or Save Anyway.
- **House settings follow your place.** Mantel now stores only the house settings you changed, as HK Frontend does, so the sky's hemisphere and the US-only themes come from Home Assistant's location even after a save. Settings saved by an older Mantel are converted once at start-up, as a version in the settings history. Seasonal decorations switched from Home Assistant no longer leave the sky half-set.
- **Pictures are processed in their own worker process,** one at a time. Photo and file processing (decoding, re-encoding, finding faces) no longer runs in the server process. The server no longer loads ONNX Runtime, originals are progressive JPEG again without slowing other screens, and a picture that crashes the worker is refused.
- **Mantel Link pairing protocol v2.** The pairing proofs name the address Home Assistant used, and Mantel refuses an address that isn't its own, so a look-alike relaying the exchange can't learn the credential. Older Mantel Link still pairs.
- **About → Performance** (Owners and Admins) shows each wall tablet's time up, memory, reconnects and slowest start over the last 24 hours, with Mantel's update fan-out time, Home Assistant's event rate and the connected screens. The figures are kept in memory only: none older than a day, and none survive a restart.

## 0.1.77 - 2026-10-26

- **Wall tablets recover after sleep.** A tablet that wakes, or comes back on the network, checks its connection to Mantel and reconnects within seconds if it went quiet. It also checks every 45 seconds while on screen, so it no longer shows stale states until someone reloads it. Mantel Settings now retries its own start, as the dashboard does.
- **Every route declares who may use it.** Each of Mantel Server's routes now says who may call it, from which door, and what it records, and a test keeps it that way. These now appear in the Audit Log:
  - adding or removing an authenticator app, a passkey or a keypad PIN;
  - revoking a session, an app or a Service credential;
  - push sign-ups, default screens and the setup guide.
  Every change's row is written before the change, so nothing changes without one.
- **Tighter wall-tablet access.** An Owner or Admin signed in at a wall tablet can no longer reach the roles, feature, settings-import or status pages. Mantel Connect can be managed from a trusted Home Assistant sidebar, as Service credentials can.
- **No more false migration warning.** The migration check compares the database's actual structure instead of file checksums, so the house no longer logs "migration changed after it was applied" on every start. A real schema difference still warns and names the table or index.
- **Smaller files, same behaviour.** The detail sheets, Mantel's feature host, the settings store and the Mantel Settings page are each split into smaller files. Nothing you see changes.

## 0.1.76 - 2026-10-26

Local Home Assistant App update for the house: the engineering audit's second pass.

- **Security (the engineering audit's second pass, [register](docs/development/Audit-2026-10-second-pass.md)):**
  - A linked HK Frontend can read, as the person linked to a Home Assistant user, only the feature reads its dashboards forward: no longer a person's saved data, settings history, Mantel Photos or camera streams. Those relayed reads end, or follow a new role, as soon as the person is disabled, demoted or linked to someone else.
  - Linking a Home Assistant user to a person (or merging one into a person) asks the Owner or Admin to confirm it is them when away from home, as adding a passkey does; making a Home Assistant user a wall tablet is done on the home network only; unlinking ends that user's "Sign in with Home Assistant" sessions too.
  - Adding an address that may show Mantel in a frame asks for a fresh sign-in away from home, as the Sign-In Address does. The app's web view signs out when its app's credential runs out.
  - Turning Allow Control of the House off ends a doorbell talk already in progress. Turning on Changes from Home Assistant is written to the Audit Log before it takes effect.
- **Reliability:** stopping Mantel closes its open screens at once instead of waiting until Docker or Home Assistant kills it, and closes the database. `update.sh` and the LXC's update make a backup before they start new images, and stop if it fails; a fresh LXC install backs up every night; each backup is read back once written. The "migration 0015/0017 changed" warning at every start is gone.
- **Photos:** a large photo upload no longer pauses every screen (up to 0.75 s for a 48 MP picture); uploads are decoded one at a time; pictures above 64 megapixels are refused (100 before); a face-detector failure no longer marks photos "no faces" for good. Camera live views are capped per screen (16) and in all (64).
- **Mantel Settings:** a page that failed to load tries again when you open it again; the pairing code's page no longer redraws every 4 seconds; the Home Grid ignores, rather than breaks on, a malformed stored block.
- **Screens:** the timer strip's Restart, +1 min and Finish work in Mantel (they did nothing there); turning control of the house off takes the controls away on open pages; a page that could not start (Mantel restarting) tries again instead of staying blank; the Home Grid clock comes back after you leave the page and return; thermostat and alarm sheets no longer leave listeners behind.

## 0.1.75 - 2026-10-25

Local Home Assistant App update for the house.

- A tab bar rail on a phone held sideways hugs its tabs, as on an iPad: it was drawn at a phone's thickness but sized for a tablet's, which left about 40 px of empty rail above the first tab and below More.

## 0.1.74 - 2026-10-25

Local Home Assistant App update for the house.

- Home Grid: a view out of sight is no longer drawn while it rests. On an iPad, a camera or a room's pages from one view could show through at the edge of the next.
- Home Grid editor: the icon at the top of the Screen and block settings sits in the middle of its square.
- Detail sheets, reviewed at every size (two phones upright and on their side, iPad upright and on its side, the large iPad, the car) in Safari's engine, every kind of sheet:
  - On a phone held sideways, nothing scrolls any more: the alarm's keypad sits beside its code field and arm buttons; the timer's ring beside its buttons and week; an automation's controls beside its week; the water heater's ring beside its modes and readings, as the thermostat's; a person's day beside the map. The humidifier's slider, which had gone missing there, is back.
  - On a phone held sideways, a control and what is beside it sit centred as one group (a shade, an awning, a light's colours, the vacuum), not the control against the left edge; a door's day strip runs to the edge.
  - On a small iPhone (an SE), the media and sensor sheets fit: the sheet takes 20 px above and below, and the cover is a step smaller. A colour light's favourites fit across.
  - The camera's X sits as far from the top as from the right, and its volume slider is easier to catch. The event's colour dots take a larger tap.
  - The water heater's mode names no longer break mid-word.
- `tools/headless/sheet_review.py`: every kind of detail sheet at eight screen sizes in WebKit, measured for fit, scrolling, balance, the X and tap sizes, with contact sheets to look over.

## 0.1.73 - 2026-10-24

Local Home Assistant App update for the house.

- Home Grid editor on a touch screen: swiping up or down scrolls the card list instead of picking a card up. Drag a card sideways towards the grid, or press and hold it, to carry it; a tap still opens its preview.
- Home Grid: **Hide Box** on any block, **Show Boxes** for the whole screen, and **Fill the Screen** to let a grid grow past its own size (on for phones). The nightstand starters draw without boxes.
- Home Grid: the Calendar block's **Month View** (today circled, a dot on busy days; a tap opens that day on the Calendar page) and the Weather block's **Big Temperature**, with a new Tall size, as StandBy draws them. The nightstand starters use both.
- Home Grid: clock faces follow the screensaver's 24-Hour Clock (they showed 24-hour time), and a face too large for a Tall block is scaled to fit.
- Home Grid: **Views** (Screen → Views): up to four whole layouts on one screen, a swipe apart, with dots to tap; a swipe on a block that swipes its own pages stays the block's. Phone, Landscape gets a StandBy starter of two views.
- A phone held sideways has the side rail its screen asks for (Tab Bar Position Left or Right); only a narrow window keeps the bar along the bottom.
- Home Grid: **Night Mode** (Screen → Night): the screen one dim red on black, at night between two times or always, as StandBy has it. Home only.
- A Home Grid beside a tab bar rail that rests small (Start Small) or hides centres on the whole screen; the rail's room comes back as it opens.
- Detail sheets on a short screen (a phone on its side, the car): each sheet is the screen's height, the control on the left at full height with what it reads and its buttons centred beside it. The thermostat's ring sits beside its modes and fan; media's cover beside the track; a sensor's reading beside its chart; an event beside its day. Nothing scrolls. Tablet and phone sheets are unchanged.

## 0.1.72 - 2026-10-24

Local Home Assistant App update for the house.

- Home Grid: six more blocks from the pages: Power, Music (choose speakers, then a playlist), Doors & Locks, Live TV, Water, and an Extra Large Thermostat with its readings, modes and fan beside the dial. Each reads what that page is set up with and updates live.
- Home Grid: **Screen Type** in the editor sets the grid for a phone (portrait or landscape), a tablet (portrait or landscape), a large tablet or a car, re-packing the blocks and asking before any are dropped. Phones start without the top band. A phone on its side gets nightstand starters.
- Home Grid: the Clock block comes in every size, as HK's digital clock or one of nine screensaver faces (Analog, Flip, Neon and more), with or without its box; a face fills its block.
- A Home Grid beside a tab bar on the left or right uses the screen's full height (the bar no longer shrinks the whole grid).
- The tab bar has **Labels**: Icons and Names, or Icons Only for a slimmer bar or rail.

## 0.1.71 - 2026-10-24

Local Home Assistant App update for the house.

- Home Grid: a Large or Extra Large Security block is the alarm keypad, and a Large or Extra Large Vacuum block is the vacuum's controls with Clean Areas below them.
- Home Grid: **Show When** takes rules. A block shows its own card by default and switches to another while a rule's conditions hold (up to four rules of up to three conditions each). New conditions: a time-of-day window and the alarm disarmed. Blocks saved with Otherwise Show keep working.
- Home Grid: a camera block can follow motion in its cameras' rooms, or an input select, as the camera strip does.
- Home Grid: the Calendar block has **Days** (1 to 7), scrolls its events inside the block, and opens an event's details on a tap.
- Home Grid: a room block leaves out the house's Hidden Accessories, as the room's page does.
- An iPad in Safari no longer scrolls a Home Grid that fits the window, with the tab bar above or below.

## 0.1.70 - 2026-10-24

Local Home Assistant App update for the house.

- The Home Grid editor opens on an iPad and other touch screens (it showed only "Arrange Home Grid on a desktop"). A window narrower than 900 pixels says so and offers Open Anyway.
- Mantel Settings follows the device's light or dark appearance again, and switches when the device does.

## 0.1.69 - 2026-10-24

Local Home Assistant App update for the house.

- The Home Grid editor says what its live preview is waiting for, or the problem it hit, and after about 30 seconds lets you arrange blocks without the preview.

## 0.1.68 - 2026-10-24

Local Home Assistant App update for the house.

- The Home Grid editor waits for its preview on a slow connection instead of giving up after 20 seconds, and says it is loading; a card's preview is no longer rebuilt after every change.
- Pages load lighter: the registry is compressed and answered "not changed" when the browser already has it, and the web app's JavaScript and other text files are served compressed.

## 0.1.67 - 2026-10-24

Local Home Assistant App update for the house.

- A Home Grid block that swipes keeps its pages inside its own rounded edge while they move, so nothing slides over the blocks beside it, and its shadow stays steady.
- Seven starter layouts (Tap Weight; Glance Up, Touch Down; Room Focus; Music & Scenes; Security & Cameras; Family Hub; Essentials) plus Start Empty, each shown with a map of the blocks it would put on your screen.
- The Glass looks' Photo and Landscapes backgrounds gain Flat's Image Look: Original, or tinted Soft, Balanced, Rich or Washed with your accent or your own color, and Strength, Depth, Brightness and Fade. Off by default.

## 0.1.66 - 2026-10-24

Local Home Assistant App update for the house.

- Swiping a Home Grid block in the Blur look keeps the frosted background lined up with its cards (0.1.65 let it slide out of line in Safari).
- New room blocks, from the editor or a starter layout, scroll through all their accessories (Accessories → Scroll All). Rooms already saved keep their setting.

## 0.1.65 - 2026-10-23

Local Home Assistant App update for the house.

- Home Grid blocks that swipe (rooms, cameras, thermostats, scenes, accessory groups) follow the finger themselves instead of the browser's scroll-snap. A fifth of the way across, or a flick, turns the page, and a swipe that starts on the page dots works too. Up-and-down scrolling, taps and press-and-hold dimming inside a block still work.
- The Home Grid editor has its cards on the left: drag one onto the grid, where its outline shows where it lands, or click it for a live preview and Add. A block's settings are reorganized into Size, Content (one Show choice, then only the options that apply), Appearance and Show When. Undo, Delete and Start Empty are new, and block labels no longer cover the cards' own titles.
- Fixes from the Home Grid audit: a conditional block picks up changed options, an Accessory Group fallback can be saved at Wide, and Security doesn't mention entries in a house without door or window sensors.

## 0.1.64 - 2026-10-23

Local Home Assistant App update for the house.

- Standalone Home Grid accessories and scenes reuse the room-page tile builders for saved glyphs, colors and state-specific appearance. Grid sizes and caption choices stay in place.

## 0.1.63 - 2026-10-23

Local Home Assistant App update for the house.

- Room blocks offer Summary or Scroll All Accessories. The scrolling option includes the room's supported controls while preserving tile sizes and horizontal room paging.
- Coffee Maker icons resolve to the bundled coffee-maker glyph. Button helpers such as Good Morning have a default icon, and unavailable entity icons fall back to their domain icon.

## 0.1.62 - 2026-10-23

Local Home Assistant App update for the house.

- Accessory Groups combine selected accessories into fixed-size tiles and automatic or individually arranged swipe pages, with clearer page controls in the editor.
- Accessory captions can show state, brightness, a selected attribute with an optional unit, or be hidden.
- Person detail sheets fit their contents and scroll on short screens.
- Desktop card paging supports mouse dragging and trackpad/wheel input without resetting on state updates. Header chips align right and scroll when needed.
- Group controls appear in accessory lists and Lights without automatically counting their members twice. Ignore Announcements recognizes HA service events and speaker counterparts.
- Thermostats and other paged cards use shared-layer blur correctly. Page-control pills grow to enclose their dots.

## 0.1.61 - 2026-10-23

Local Home Assistant App update for the house.

- Home Grid placement guides, selection outlines and drag outlines match the cards’ corner radius at every preview scale.
- Starter layouts live inside collapsed Screen Settings while editing a layout.
- Room controls distinguish One Room from Swipe Between Rooms. Starting Room now controls the opening page and idle return, including explicit room choices on a desktop.

## 0.1.60 - 2026-10-23

Local Home Assistant App update for the house.

- Home Grid keeps fixed tall-tile proportions, scales uniformly to fit other displays, and adds a Grid Scale control.
- Room and scene groups support six columns by two rows. Sparse room groups keep empty rows, and accessory circles retain their standard size.
- Home Assistant person portraits load through Mantel, with initials when an image fails.
- Camera blocks keep one selected camera. Screen settings collapse and header clock/weather can be hidden independently.
- Thermostats share the card appearance; page dots are centered; picker icons and sample readings are complete.
- Larger weather cards show additional readings and forecasts, with an optional Sky background.

## 0.1.59 - 2026-10-23

Local Home Assistant App update for the house.

- Home Grid's searchable card picker shows live previews and available sizes, with options and conditional fallback previews.
- Room and scene groups have surrounding tiles, fuller scene rows and clearer page dots. Each group supports background color, opacity and blur.
- Music artwork and track information align, with more space around the progress bar. Weather, camera, security and timer cards have updated layouts and controls.
- The picker and settings scroll independently while the dashboard preview and editor toolbar stay visible, including on shorter screens.
