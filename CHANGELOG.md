# Changelog

All notable changes to Mantel are listed here. Versions follow [semantic versioning](https://semver.org); the Home Assistant App, the Docker images and the Python package share one version number.

## Unreleased

The first public release of **Mantel**: HK Frontend's screens, inspired by Apple's Home app, served from a server of their own beside Home Assistant. It ships with **Mantel Link** 0.1.8 (Home Assistant's side of Mantel, from HACS) and alongside **HK Frontend** 1.16 (HK inside Home Assistant), built from the same code. The [user guide](docs/guide/Home.md) covers all of it; [HK Frontend and Mantel](docs/guide/HK-Frontend-and-Mantel.md) compares the products.

**Running it**
- **Three ways to run it:** the Home Assistant App (Home Assistant OS or Supervised; in Home Assistant's sidebar, optionally at its own address too), Docker Compose with Caddy or your own reverse proxy, or a Proxmox LXC made by a script. All three run the same server.
- **Set Up Mantel:** a first-run checklist in Mantel Settings, each step worked out from the house (Home Assistant, your home, screens, the household, the Owner's sign-in, the Alarm PIN, moving the house from HK Frontend, house commands), each opening the page that does it.
- **Backups:** inside Home Assistant's backups for the App; nightly encrypted backups, checked before a restore, with Docker and the LXC.
- **Updating** through Home Assistant, `./update.sh` or `mantel-update`.

**People and access**
- **People and roles:** Owner, Admin, Adult, Child and Guest, with grants per room and feature, and Wall Tablet for a tablet.
- **Sign-in:** passkeys, passwords with authenticator codes, or Sign in with Home Assistant; stricter rules from away than at home; a fresh sign-in to confirm it is you before anything sensitive.
- **Commands and the audit log:** commands stay off until the Owner turns on **Allow Control of the House**; each one is checked against the person's and the device's role and written to the audit log before it reaches the house. The alarm asks for its PIN.

**Wall tablets**
- A browser enrolled as a wall tablet keeps its own credential and role, whoever walks up to it. Enrolling into a room with no HK tablet adds that tablet too. Each tablet has one page in Mantel Settings: its screen, kiosk app, When Idle, Sleep Screen, the browser signed in as it, and Reload and Clear Cache from Mantel.
- The screensaver, return to Home and Sleep Screen are HK's, with **Mantel Photos**: albums for the screensaver, with Keep in View cropping around faces found on the server (where, never who).

**Screens**
- HK's pages drawn with HK's own code, without Lovelace: Home, a page per room, Lights, Climate, Security, Cameras, Music, Energy and the **Power** page (the grid, the sun, a house battery and the cars right now), Weather, Live TV and more, over the live sky.
- **Home Grid:** a tablet's Home page laid out in fixed blocks in a desktop editor, with starter layouts, pages, conditional blocks, layout history and copying to another screen. A **Now Playing** block turns over to **Speakers** or **Browse**.
- **Edit mode** (**Edit Page**): arrange a page in place: drag tiles, make them Tall, and reorder the menu, the tab bar and the rooms.
- A phone has its own **Tabs in Bar** (2 to 4).
- **Notifications** on the screens, in the Mantel app, in a browser, or through Home Assistant's Companion app.

**Mantel Settings**
- HK's settings for every screen, with a live preview, plus People, Roles & Grants, wall tablets, Connections (Home Assistant, Music Assistant, HTTPS and your proxy, notifications to the app), General, the Audit Log, Service Accounts and your files, each thing in one place. Settings keep their history.
- **Appearance and Menu, reorganized.** All Screens → Appearance is one page of how screens look: Style, Colors (one **Accent Color** for the menu's highlight and Flat's accent, which were the Highlight Color and Flat's Accent Color), Background (**Sky / Background** moves here from the sidebar) and Tab Bar Look. All Screens → Menu is how people get around: each screen's menu on each device, **Side Menu**, **Edge Tab** and **Tab Bar** each a page of everything about it with the screens that use it, and Rooms in the Menu. Page Header is **Back Button & Title**, beside a screen's other header settings. A screen's Appearance is one row opening the same layout, and its menu follows All Screens one setting at a time (Same as All Screens / Just This Screen, with Reset) instead of all or nothing: on the first start, a screen with its own menu keeps only what differs from All Screens'. Old addresses open the new pages; nothing on any screen changes.
- **Recommendations, not automatic changes.** A screen whose wall tablet draws under 45 frames a second says so on its Appearance and suggests ONE change that should help ("Kitchen Tablet draws 38 frames a second with Blur. Glass looks almost the same and is lighter."), on that screen only, with **Use Flat** beside it. The first suggestion is the style (Blur, Frosted or Tinted to Glass); if the tablet is still under 45 an hour later, the next is the sky's Rain & Snow, then Moving Things in front of the cards, Animations, and a camera playing live. A suggestion waits for the tablet's next measurement, which says what the screen looked like when it was drawn. All Screens → Appearance lists each such screen. While every screen's photos come from a Home Assistant folder, All Screens → Screensaver offers **Import into a New Album** (Owners): the folder copied into Mantel Photos, then shown on every screen once the import is done. Nothing changes until you tap one.

**Home Assistant**
- **Mantel Link:** found by itself (from the App, or on the network with a pairing code); each tablet's black screen, screensaver and Sleep Screen as entities; Mantel's actions, also under their HK Frontend names; Mantel's screens in Home Assistant's sidebar; notifications on Companion-app phones; the doorbell's talk-back.
- **Mantel Connect:** Mantel in Home Assistant's sidebar when it runs in Docker or the LXC.
- **HK Frontend linked to Mantel:** the two run together. Each wall tablet is run by one of them, The House by one of them, and while Mantel runs the house HK Frontend's dashboards use Mantel's settings, saved as the person linked to each Home Assistant user. Moving everything to Mantel is a choice, one step at a time.

**Music, cameras and apps**
- Music Assistant and cameras through Mantel (live view, stills, Live TV from an HDHomeRun), each checked against the person's role.
- **iPhone, iPad and Mac apps** (built from source for now): the screens and Mantel Settings, notifications, a music Live Activity, widgets, Control Center and Siri on iPhone; the menu bar on the Mac.

### Late changes before release

- **Music: stereo pairs and presets read from Music Assistant.** A room whose speaker is a Music Assistant group (two HomePods panned left and right, say) is one room, its two speakers read from Music Assistant even when they are hidden from Home Assistant, and HK Settings says so under Speakers. A preset's rooms now come from its group in Music Assistant, the pair's two speakers counted as the pair, so a pair shows in a playing Everywhere or Upstairs instead of dropping out; a group holding only half a pair is marked **Check**. A pair with other rooms outside a preset is refused with words, before anything is sent: it used to fail to join.
- **Home Grid editor: the other blocks make room.** Drag a block onto others, with the mouse or a finger, and as you go they slide out of its way, as widgets do on an iPad's Home Screen: into the space it left (in the same arrangement), or the nearest free space, moving another block aside only when there is no other way. Let go to keep it, Escape or let go outside the grid to put everything back; one Undo takes back the whole move. Before, a move only went into empty space or swapped with a block of the same size.
- **iPhone Duo: edge to edge, the tab bar in the side strip.** The app's page runs under the Duo's strip of system controls (its camera, the time and Wi-Fi down the right edge) as a native app's does, the sky and the screensaver filling the display, and keeps its content clear of the strip; it was a black band. The tab bar becomes a rail in the strip's empty foot, below the system's items (**Menu → Tab Bar → Use the Side Strip**, on by default), the tabs that don't fit in More. A phone held sideways keeps its page clear of its Dynamic Island the same way, in the app and in a Home Screen web app.
- Home Grid: swipe cards page with a mouse, a wheel or a trackpad; shared blur reaches cards inside swipe blocks; starter layouts stay inside Screen Settings while editing; fixed tall-tile proportions with a per-screen scale; six-by-two room and scene groups; person portraits load through Mantel and fall back to initials; room and scene groups take their own background color, opacity and blur.
- Group controls show in the Lights and accessory lists without double-counting their members.
- Ignore Announcements recognises Home Assistant service calls in Mantel, Music Assistant speakers included.
- Importing HK's settings from a Home Assistant without HK Frontend says there is nothing to import.
- Revoked tablets, Service accounts and Connect pairings leave their lists after 30 days, or at once with Clear List; the Audit Log keeps them. The App no longer leaves a revoked "App discovery" credential behind at every restart, and makes none when Mantel Link was set up by hand.
- The Audit Log's From and To say Any Time, Now or the last hour, day, week or month.
- Doorbell talk is live through Mantel again: the card waits up to 4 s for the doorbell to listen.
- Page health in Mantel's log: each screen's page says how the page before it ended and how big it is each minute.
- With no HK Frontend in Home Assistant, Mantel takes The House by itself.
- **Less to load, kept longer:** a screen loads only the card code its pages use (the rest the first time it is needed); the images ship the web app without comments or indentation (about 45% less JavaScript); and a browser keeps each file of a release instead of asking for it again at every start. The realistic clouds the sky never draws are left out.
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

## 0.1.96 - 2026-10-31

- **Music without Home Assistant:** with Music Assistant connected, the speakers' state, covers, commands, Browse, search and Up Next come from Music Assistant directly, so music keeps working while Home Assistant restarts.
- **Covers and faces that fail:** never the broken-image "?". A cover that can't load shows the music note (never the previous song's art), a person keeps their last good picture, and an unavailable player shows its placeholder.
- **Backgrounds in any colour:** one combined picker holds the Wallpapers (Ribbons, Petals, Shards, Pinwheel) and the six motion themes, with one Color list and Motion under it. The Clock screensaver uses the same picker.
- **Side Pane clock:** Face, Alignment (Left, Center, Right), Text Size, Weight, AM/PM, Flashing Colon, Date and Second Line, on All Screens or per screen.
- **Side Pane Now Playing:** an Album Art Background switch, and When Tapped opens Speakers, Volume, Browse and Queue in place or flips to the controls.
- **Side Pane Camera:** the still loads and refreshes every 10 seconds, with a Name option (hidden by default).
- **Music block:** a Shows option (Recently Played, Presets or One Playlist). **Live TV block:** pick its channel; on bigger sizes the channel's mark and name grow.
- **Small Now Playing's Speakers sheet:** the group's volume above each room's.

## 0.1.95 - 2026-10-31

- **Motion themes:** six new animated Wallpaper backgrounds (Aurora, Beams, Blobs, Dots, Meteors and Waves), each in any colour you pick, with presets; still under Flat or Reduce Motion. The Clock screensaver's Background offers the Wallpapers and motion themes too.
- **Every block does something when tapped:** each Home Grid block opens its sheet or its page, with a When Tapped option.
- **Card picker:** every block is listed (To-do, Energy Rings, On Now and the rest), each size chip previews that size, and a card with no room can be dropped over the blocks it replaces, with Undo.
- **Names you give accessories win everywhere:** Security's Recent Activity, Left On, the Doors and leak lines, On Now and the Side Pane. A new **Also rename in Home Assistant** switch under an accessory's name renames it there too (the name only, never the entity id).
- **Music:** playing a song, album, artist or playlist from Browse replaces the queue, as Apple Music does, and only counts as started once the new music plays.
- **Day screensaver:** the corner clock and weather stay clear of the day and date, leaves fall and bats fly, the corner clock keeps its own minute, and the weather icon takes the face's dark ink.
- **Layout fixes:** banners centre on the whole screen, over a Side Pane's edge too; the header's clock glow and chips' shadows are no longer clipped; sideways rows run under a side rail or the iPhone Duo's strip to the screen's edge; the Pages screen's Rooms folder has a proper top inset and, on a phone, is as wide as it can be with names on two lines; a camera block's name can be shown or hidden.
- **Settings, Advanced:** the font and glyphs are checked in Your Files instead of reported Missing, and Show in Sidebar appears only in Home Assistant.

## 0.1.94 - 2026-10-31

- **Home Grid blocks as widgets:** every block is redrawn after the HomeView widget mock-ups, at each of its sizes: Calendar (Small, Tall, Large, the month at Extra Large) and a new **To-do** block; the Thermostat's Big Number and its modes; Weather (Wide shows the next hours); Now Playing, Recently Played and Live TV; Timers (the ring is the pause, with a red Stop); Who's Home; the Vacuum's big keys and rooms to tick; Doors, Security, Power, Water and Battery; and new **Energy Rings** and **On Now** blocks. Scenes and Accessories gain Height and Color; every control reaches a finger's 44 px.
- **Edit mode on the Home Grid itself:** drag, resize, remove and add blocks right on the dashboard.
- **Centred tiles** draw their glyphs bare and large, as HomeView does; an Accessory block says its chosen Line Under Name.
- **More and Rooms** in the tab bar are app icons in their colours, in a bigger sheet on a tablet.
- **The Side Pane:** Now Playing at Less is a mini player (Speakers and Browse beside its volume) and at More shows the song's progress; Security says only what is open; Who's Home is spread evenly; its Clock is lined up.
- **Screensaver:** Time Behind's weather is back in the top-left corner; Clock's time is bright over a dimmed photo; light faces such as Day use dark ink; the Day art moves gently (still under Flat or Reduce Motion); the Forecast's corners no longer overlap.
- **Settings previews:** the screensaver preview is the screensaver alone at the screen's size, each change shown as it is made, without reloading a dashboard; the Appearance pages preview the look with a few of the screen's cards; All Screens' Appearance and Side Pane pages get previews too.
- **Choices as pictures:** the clock's Background, the Day face's Look, the Forecast's Layout and the sky's Backgrounds are picked from little previews.
- **Fixed:** an accessory's page opened straight from search (a renamed accessory, for one) waited for its data instead of saying it couldn't load; a block pager comes to rest exactly on its page.

## 0.1.93 - 2026-10-30

- **Time Behind, one place for the time:** the time is always upper centre, the same spot and size on every photo; the photo's subject comes over it only where it covers part of the time, otherwise the time is in front. The weather sits under the time, centred, instead of beside it; on a phone it fits the screen, and the photo's title and what's playing no longer overlap.
- **Home Grid blocks, tidied at all five sizes:** every block now has the same inset from its edges (14 px on tiles, 18 on square cells, more in a Square screen's corners), pills inside a block follow its corners, and blocks with fewer things than spaces fill themselves instead of leaving empty rows. Fixed: the Thermostat XL dial running out of its column, the Tall clock's AM/PM cut off, the Scenes block's extra bottom space, the Vacuum L/XL card stuck at the top of its block, Now Playing Tall's corner buttons, and Weather XL's two columns not lining up.
- **The Vacuum block on square cells (HomeView)** reads like the blocks beside it: round controls at the top, the name and "Docked · 92%" at the foot.
- **A button added among accessories** (button or input_button) gets a second line, "Tap", like the accessories beside it.
- **The Side Pane's lists give way:** where the pane is short, the Calendar, To-do, Timers, Climate and Notifications get shorter and scroll inside, down to their heading and one row, before any section shrinks or is left out.
- **The Pages Screen** opens at its size with no animation, so it no longer jumps.
- **Photo Titles and Time Behind only where the photos show:** left on from Photos, they no longer carry over to Clock on soft photos, the Forecast, Glance, Month or Day; on Clock over sharp photos the Screensaver page now offers both toggles.
- **Settings tidied:** All Screens and each screen's page are in one order, with fewer one-row groups; Now Playing Options and the Side Pane's sections have pages of their own; the Screensaver page keeps one layout for every Show; "Same as All Screens" reads the same way everywhere. No setting changes.

## 0.1.92 - 2026-10-30

- **The new screensaver Shows work:** Glance, Month and Day were shown as photos, and Big Weather, Photo Titles, Time Behind and the Day face's look were ignored; they now reach the screensaver.
- **The Side Pane draws the same everywhere:** its dividers no longer come and go, its data (the weather above all) stays instead of disappearing, and it keeps its Width on every page.
- **Section Headings** (Side Pane, On by default): a title over each section except the Clock and the Weather. Each section can sit at the **Top or Bottom**, and has a **When Tapped** (its page, its sheet or nothing); tapping an event, a person, a lock or a thermostat opens its own sheet. Less, More and Full show more at each size, and the pane's player has Speakers and Browse again.
- **The Pages Screen:** no giant clock behind the icons unless you choose **Background Clock**, a lighter blur, icons that come in as Launchpad's, and a Weather icon showing the sky for the weather.
- **Columns use the width:** more columns extend a square grid at the same tile size until the width runs out; the editor says how many fit at full size.
- **Bright Glass On:** Home Only (the default) or Every Page. The album-art pane evens out dark covers, and a Security block keeps its own layout on square cells.
- **Rename a screen** in Settings with the pencil beside its name; its address, and every tablet and link that opens it, stays.

## 0.1.91 - 2026-10-30

- **The Side Pane takes the album art while music plays:** the whole pane becomes the song's blurred cover, edge to edge, with its other sections on it; it fades to the next song's cover, and back to the screen's glass when playback stops. The music section no longer sits in a box of its own. The screensaver's pane does the same.

## 0.1.90 - 2026-10-30

- **Looks:** eight complete setups for a screen (HomeView, Flat, Performance, Holiday Whimsy, Active Weather, Calming Backgrounds, Night & Bedside, Photo Frame), each setting the colours and accent, the background and sky, the tiles, the Side Pane, swiping, the screensaver and a layout for the screen's shape. A screen's **Looks** page lists every change as was → becomes; **Layout + Look** in the Home Grid editor sets the layout too; one Undo puts it all back.
- **Square tiles look like HomeView's by themselves:** Tile Style **Automatic** (the new default) centres the icon above the name on square cells and keeps the Home layout elsewhere. Square grids offer **2 to 6 columns**.
- **Wallpaper Motion:** Off, Slow, Medium or Fast; it stops when hidden, under the black screen and with Reduce Motion.
- **The Side Pane** takes the screen's glass (blurred in Blur and Bright Glass), has no headings (a thin line between sections) and a live preview on its settings page.
- **Bright Glass sheets and pop-ups** are readable over every wallpaper: a deeper tint, the page dimmed behind, room icons in white circles.
- **Fixes:** text in a square screen's corner tiles is no longer cut off; the shared blur behind each tile matches its corners; Big Number marks the setpoint with a dot, with a smaller dash and room for the name; the Side Pane's and its sections' icons show in Mantel.
- **Music: stereo pairs.** A room whose speaker is a Music Assistant group (two HomePods panned left and right) is one room; a preset's rooms are read from its group in Music Assistant, so a pair plays in Everywhere or Upstairs.

## 0.1.89 - 2026-10-30

- **A HomeView-style look, every part of it an option** (a screen looks as it did until you pick something): square cells on any screen and a **Square** (3 × 3) screen type; HomeView-style starters, with **Home with Pane** recommended for a landscape tablet; **Centred** tiles; a **Big Number** thermostat; an **Analog Numbers** clock; a **Cameras** face of up to nine stills; **Bright Glass** and twelve **Wallpapers** of our own that tint the tiles, on every surface but Mantel Settings.
- **Swipe Between Pages:** a sideways swipe goes to the next or the previous page of the tab bar, the highlight following; a Home Grid turns its own views first, and rows that scroll sideways keep their swipe (**Menu → Gestures**).
- **Side Pane:** one per screen, of the sections you pick (Clock, Weather, Calendar, Now Playing, Security, Camera, Timers, Energy, Climate, Who's Home, To-do, Notifications) at four sizes, beside Home, every page or the screensaver, on the left or the right. It takes over the screensaver's pane and Now Playing's side pane, with their settings.
- **The Pages screen:** after Home, an iPad-style home screen of Mantel's pages as large icons (live ones for Calendar and Weather, badges, a Rooms folder), a way around without a tab bar.
- **Nine screensaver faces:** Glance, Month, Day and Big Weather; Photo Titles; **Time Behind** (Mantel Photos cuts out each photo's subject on the server, on import and in the background, and uses only the photos where it works); and the Liquid, Giant Numerals and Scattered Numerals clocks.
- **More When Near:** a sensor that sees the space in front of a tablet ends its screensaver, through the Sleep Screen.
- iPhone Duo: Live TV's caption and ✕ stay clear of the side strip, and the docked Now Playing bar's plate runs under it.

## 0.1.88 - 2026-10-30

- **iPhone Duo, like a native app:** the page runs edge to edge again, under the system strip at the side, and keeps its content clear of it; the tab bar becomes a rail in the strip's empty lower part (Use the Side Strip, under Menu → Tab Bar, turns it off). An iPhone held sideways keeps its content clear of the Dynamic Island.
- **Home Grid editor: the other blocks make room.** Drag a block onto others and they slide into the space it left, or the nearest free spot, as you drag; Undo puts the whole move back.

## 0.1.87 - 2026-10-29

- **Appearance and Menu settings, reorganized** for All Screens and each screen: one Accent Color; Side Menu, Edge Tab and Tab Bar under Navigation, each a page of everything about it; a screen's menu follows All Screens one setting at a time. Old addresses open the new pages, and nothing on any screen changes.
- **Recommendations, never automatic changes:** a screen whose tablet draws under 45 frames a second suggests one lighter setting at a time; a screensaver showing a Home Assistant folder suggests importing it into Mantel Photos.
- **Less to load:** a screen loads only the card code it uses, without comments or indentation, and a browser keeps each file of a release instead of asking again at every start. Through Home Assistant's sidebar too, files go out compressed.
- **Lighter all day:** nothing runs under a tablet's black screen; updates are applied once a frame; old pages are let go; photos, album art and camera stills are sized for the screen, and tablets showing the same camera share one fetch; Reduce Motion stills the sky and the screensaver.
- **The log says once an hour** how long the minute check of who may see what takes, and how large the settings history is.
- The help's screenshots are WebP (79 MB smaller), and the developer-only scenery page is left out of the images.

## 0.1.86 - 2026-10-29

- **Performance shows each screen's startup and device.** About -> Performance lists how much each screen downloaded before its first screen, how many files, the time to first draw, its frame rate (5 seconds, measured while nobody is touching it and the screen is lit) and the device: memory, cores and screen. A tablet's latest summary is kept through a restart.
- **Performance shows Mantel's own work:** how long the once-a-minute check of who may see what takes, and how large the settings history is.
- **Fewer settings frames:** a change to the settings now reaches only the screens whose settings it changes, and the house's device list is serialized once.

## 0.1.85 - 2026-10-28

- **Backups in Mantel Settings.** A Backups page for the Owner: when the last one was made, Back Up Now (on the App only when you ask; nightly with Docker and the LXC), each saved backup to download or delete, Save Keys (both keys as one small file), and Restore -- an upload checked first, then put in place when Mantel restarts, with what was there moved aside, not deleted. A backup from another Mantel restores with that Mantel's keys file.
- **My Sessions, one row per kind of browser.** A browser that signs in again replaces its own session instead of adding one; each row opens to that browser's sessions, and Sign Out Everywhere Else clears the rest at once (the Mantel app stays signed in).
- **A linked HK Frontend's status rows follow What Counts.** Its dashboards in Home Assistant now leave out what each type's What Counts leaves out, as Mantel's own screens do (the pantry door off the Security page).
- **Power page:** a car parked at home and not plugged in is drawn without its cable.
- Ready for the public repositories: logos for both integrations and the App, translations Home Assistant's hassfest accepts, the guide as Mantel's wiki, and one table comparing Mantel, HK Frontend and Mantel Link.

## 0.1.84 - 2026-10-28

- **Speakers and Browse on a Home Grid's Now Playing block.** Either side of play and pause (a Tall block's top corners), each turns the card over: its back grows out of the block into the screensaver's music panel -- Speakers, Volume, Queue and Browse, with what plays at its foot. A tap outside, Escape or its X turns it back; it turns back by itself a moment after a pick starts playing.

## 0.1.83 - 2026-10-27

- **Edit mode on a blurred screen:** the pill you carry takes its blur with it. On an iPad the blur behind a carried pill used to trail it; now the pill blurs what is behind it itself while held, and rejoins the page's shared blur once it has settled.
- **A Home Grid that fits the screen no longer scrolls in Safari on an iPad.** Beside the docked menu, the page was the height of the window with Safari's toolbars hidden, so it scrolled by the toolbars' height.
- **A swipe on the tab bar no longer scrolls the page under it** (Safari then began hiding its own toolbar). Taps are unchanged.

## 0.1.82 - 2026-10-27

- **Tabs in Bar on phones.** A screen's Menu → Phones → Tab Bar (and Mantel Settings → Menu → Phones for the house) now chooses how many pages a phone's tab bar shows besides Home and More: 2, 3 (the default, as before) or 4.
- **All Screens → Appearance Style names the screens that keep their own look.** The line under it says, for example, "Home (Flat) keeps its own look, so this doesn't change it", and each name opens that screen's Appearance.

## 0.1.81 - 2026-10-27

- **Edit mode with Reduce Motion:** each pill's dotted frame now sits evenly around the pill. A room's pill is drawn 8px wider than its own element, so the outline used to cut across its right edge.
- **Turning Flat off reaches the scenes row at once.** On a page with nothing changing, the scenes row's pills kept Flat's dark plates after the screen was switched to another look.

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
