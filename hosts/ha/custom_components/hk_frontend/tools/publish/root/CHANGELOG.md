# Changelog

HK Frontend's releases, newest first. A GitHub release's notes are its section here (`tools/publish/publish.py
--release`). Home Assistant 2026.8 or newer.

## Unreleased

## 1.59.3 - 2026-11-11

**Changed**
- **HK's three biggest settings files in parts** (phase 25): the HK Settings module (`window.hkSettings`), the settings page's screen pages and the Music Library card, each shipped with its parts in one file as the others are. Nothing they do changes.

**Fixed**
- **A file in parts is waited for by its folder and name**: two of them share a file name (the HK Settings module and the settings page are both `hk-settings.js`), and a page that imports one waits until its own parts have run, never the other's.

## 1.59.2 - 2026-11-11

**Changed**
- **The screensaver and the detail sheets, untangled** (phase 25): each piece of the screensaver's state has one owner that the rest asks, and its parts call each other through named exports rather than generated bindings; the detail sheets reach the open sheet only through a few named functions. Nothing they do changes.

## 1.59.1 - 2026-11-11

**Fixed**
- **Screens draw as fast as before**: 1.59.0 split HK's big files into parts, each fetched a round trip after its file, which held a tablet's first draw back. Each file now ships with its parts in it, one request.

## 1.59.0 - 2026-11-11

**Added**
- **Swipe, a Home Grid card whose pages are other cards**: each page any card, with all that card's own settings, in the block's size (Small to Extra Large), six at most, swiped between with the page dots every paged block has. Made for Show When too: on a HomeView, "A TV Is On and Music Is Playing in Tablet's Room" shows a Swipe of TV and Now Playing, with the TV alone and the music alone as the next two rules. In the editor: Change Card… → Swipe, then each page's card and settings, Move Up, Remove and Add Page. A viewer who may not see a page's accessory gets that page without it; the assistant can write one (grid_cards).
- **TV, a Home Grid block and a sheet for each room's TV and its Apple TV, as one** (docs/phase23/TV.md): what's on, play and pause, the volume (a slider where the TV takes a level, − and + where it only steps), the TV's inputs, the apps, and a remote with arrow keys that drives whatever is on screen (Apple TV | TV, already set). Any TV or Apple TV tile opens the sheet. The block comes in Small to Extra Large, which puts the arrows on the block; Automatic is the wall tablet's room. Apps are the ones opened most in the house, or your Favorites (Accessories → TVs → TV Apps), with each app's App Store icon looked up once by the house's server (itunes.apple.com and *.mzstatic.com; Look Up App Icons turns it off). Each room's TV pairs with the Apple TV in its room; Accessories → TVs changes the player, the input it's on (learned when the two come on together), where volume goes and the inputs nobody uses. Show When gains **A TV Is On** (a TV, Tablet's Room or any). The assistant can write the block and the condition.
- **Laundry**: washers, dryers and washer-dryers of any brand, set up under HK Settings → Accessories → Laundry. Mantel finds them on their devices (Samsung, LG, Bosch and Siemens, Miele, Whirlpool, GE, Electrolux, Haier and others: a status sensor, its cycle step, its finish time or time left, its progress, door and remote control, and a leak sensor in the same room), or each part can be picked by hand, including a machine with no integration that a power sensor or a running sensor watches. Each machine is a Washer, a Dryer or a Washer & Dryer. **The Laundry block** on a Home Grid (Small, Wide, Tall, Large, Extra Large, on square and tile cells) draws the machine, animated by what it does, with what it is doing, how long, when it's done and the cycle's steps; two machines share the block. **Its sheet** is the Wide sheet on a tablet: the machine and its time on the left, the steps, its readings and Pause, Resume and Stop on the right, dimmed with the reason when the machine won't take them (never a remote start). Each machine is a tall tile with the house glyph in its room on the generated pages, and a **Laundry chip** shows while one runs or waits to be unloaded. **Done is held** until someone presses Clear, the door opens, the machine runs again or Clear After hours pass (2 to 24, or Until Cleared). On Mantel only: with Home Assistant alone, a machine is Done while it says so. docs/phase22/LAUNDRY.md.
- **Alert, a card for Show When**: one thing that needs a look, in a block's own place while its rule holds, with the block's own card back when the rule clears (first match still wins). It has a headline, a line of its own with how long ("Open for 23 min", from when the accessory came into that state), a camera's still (tapping it opens the camera), and one action that does what the accessory's tile does. A garage door or a lock opens its own controls, which ask first. Small, Wide, Tall (stacked), Large (the picture and the action the block's width) and Extra Large, on square and tile cells. A camera that isn't available drops its picture, and the words and the action stay. In the editor (Change Card… → Alert) and the card list's preview, and the assistant can write one (grid_cards gives an example). docs/phase11/ALERT.md has the garage and laundry rules.

**Changed**
- **A TV's apps show their icons before anyone opens them**: Mantel's server looks each app the Apple TV lists up by its name in the App Store (one name every 3 seconds, the closest match only, never one from a category no TV app is in, so Dusk doesn't wear a drinks app's icon), and when the app first opens its real App Store id decides: a guess that named another app is replaced by the right icon. Apple's own apps (Music, Photos, Settings...) show the house's glyphs. Off with Look Up App Icons.
- **Laundry and Vacuum blocks, reworked**: what a machine is doing reads first, upper left, with the drawing beside it and room between them. Each step of the Laundry cycle has its own color (wash blue, rinse light blue, spin purple, dry warm). Extra Large adds the cycle's settings ("Cold · Extra High Spin · Normal Soil"), and Large and Extra Large show **this load's power**: live watts, the kWh the load has used, and a graph of its watts since it started, colored by step. Mantel finds the power on a laundry circuit's energy monitor when the machine reports none of its own (a power sensor named for the laundry, or the one a laundry-named energy sensor is summed from); Accessories → Laundry can pick another. The blocks no longer show Remote Control; the sheet still does. The Vacuum block's rooms are the Vacuum sheet's pills, the list fades where more rooms scroll, the robot is centered in its space, and Tall's keys match the other blocks'
- **One way to pick a speaker in Home Grid**: Now Playing's **Speaker** and Show When's **Music Is Playing** list the house's music rooms and groups (Mantel Settings → Music), as the Music block's Plays On does, never every media player in Home Assistant. Music Is Playing can watch **Tablet's Room**, the room the wall tablet's music calls home (a stereo pair counts either HomePod), so one rule -- Music Is Playing in Tablet's Room → Now Playing, Automatic -- works on every tablet's screen; on a page that is no tablet's it never holds. A Now Playing set to a room or group follows the music playing there, its song, time, volume and buttons all from one player: one set to an Apple TV showed the room's song with the TV's empty time and volume. A saved speaker that is no music speaker reads "(Not a Music Speaker)" in the editor and Now Playing shows the screen's music. The assistant can write both (grid_cards).
- **Show When takes up to ten rules** in a Home Grid block, not four. Each rule still has up to three conditions that must all hold, rules are checked in order with the first that holds winning, and the block shows its own card when none does; layouts saved with four or fewer rules, and older blocks saved with Otherwise Show, work as they did. In the editor each rule's header says where it stands (Rule 3 of 10), **Move Rule Down** sits beside Move Rule Up, past four rules **Preview** is a menu naming each rule's card, and Add Rule says when the block is full.

**Internal**
- Code health: HK's big web files cut into shells and parts (each part fetched with its shell, and waited for before the file is used), the settings' first-paint defaults in a file of their own that loads first (`modules/hk-settings-defaults.js`), the settings model a package, and every long line broken; nothing a person sees changes.

## 1.58.0 - 2026-11-10

**Added**
- **Settings → Accessories → Helpers**: every Home Assistant helper in one place -- toggles, buttons, numbers, lists, counters, dates and times, text and schedules -- shown or not, by kind, with a search. A helper's page turns its tile on, chooses its room (Home Assistant's area, changed there too) and says where the tile will be: in its room on Home, its room's page and Room blocks, or, with no room, only at the end of the automatic Home and on no Home Grid. Helpers no longer sit among Switches & Outlets, and Added Accessories now says plainly where a roomless tile goes.
- **A Solar Window in Home Grid's Show When**: a rule that holds from one point of the day until the next, each a time (the home's time zone) or sunrise or sunset with an offset in minutes -- the outdoor lights' controls from 15 minutes before sunset until 10 PM, or from an hour before sunrise until half an hour after it. Sunrise and sunset are Home Assistant's own (`sun.sun`), the block changes at each edge without a reload, and a window can run past midnight and across a daylight saving change. Without the sun, the rule doesn't hold and the block shows its next rule or its own card.

**Changed**
- **The Suggested Scene block's glyph sits bare in its upper-left corner**, white on the scene's sky, no circle, at every size (Small already did): Wide lays the glyph at the top and the words at the foot, the play key at the lower right. A Material icon that has an Apple twin in the house's glyphs is drawn as Apple's. Running a scene shows a check on the play key for a moment (Small: on its glyph).
- **Flat shows the song's cover, very dim, wherever the other looks blur it**: behind the Now Playing blocks, the Now Playing page and bar, the Side Pane's Now Playing, the screensaver's music and the Speakers / Volume / Queue / Browse panel -- sharp (Flat blurs nothing), on near black under the same wash, where it showed a fixed gradient, a flat color or nothing.
- **A Time of Day rule changes at its edge**, not up to half a minute after it.
- **Every Volume tab has the whole group's slider first** (the music's rooms together, then each room's own) wherever two rooms or more play -- the Music page's Speakers, the screensaver's, the Side Pane's and a Now Playing block's; only a Small Now Playing block had it.
- **The Intercom's rooms are the Music page's speaker rows**: each speaker's well, its name over what is true of it (Plays with Office, Quiet hours, Unavailable, After you finish, You're here), the tick at the end, one to a line (two where there is room) -- the whole name fits, where two narrow columns cut most of them short on a phone.; **its groups** (Whole House, the floors, your presets) **are one row that scrolls sideways**, as the Music page's presets, not rows of their own over the rooms.
- **A screensaver widget opens its page when tapped**: the weather the Weather page, the date the Calendar, music the Music page, a timer the Timers page, and so on; one about a single thing (a sensor, a person, a camera) opens its details. Each widget's When Tapped can say Nothing instead (the Screensaver editor).
- **The screensaver's Music widget says where it plays as the players do** ("Master Bedroom + 10", where it said "EVERYWHERE"), and **goes away once the music stops** (a paused or stopped speaker kept it up).
- **A Small Room block shows its room's own glyph** (Kitchen's fork and knife, the Loft's bookshelf -- the area's icon in Home Assistant) where its room page names none, not always the sofa. Hallway's and Attic's icons are now among the ones Mantel serves.
- **A Large Now Playing block's cover sits as far from the block's top as from its side**, the controls at its foot; a long song title stays on one line and drifts slowly when it does not fit, instead of wrapping and pushing the cover against the top.
- **The speaker line says "Master Bedroom + 10"** when three or more rooms play together (two still read as two names), and is a little bigger on the media blocks, an easier target.

**Fixed**
- **TV app icons arrive whole**: an icon over 16 kB was kept cut off after its first piece, so a large App Store icon could draw broken; every icon kept so far is fetched again.
- **The Calendar's floating bar no longer bounces on a phone**: on a short week, folding made the page end above where it was scrolled for a moment (as the bar was measured, before its spacer), iOS put the scroll back near the top, the bar opened, the scroll carried on and it folded again -- over and over. The page is never shorter now, not even mid-fold (found by running the Mantel app itself on an iPhone Duo Simulator); **the + for a new event is a circle on a phone** (it was New Event's padding round a lone +).
- **On the Flat look a tile's glyph no longer jumps when pressed** (the glyph circle of a centered tile, Room, Lamps and Intercom block, a wide tile's glyph and temperature, the TV Guide's channel icon, a person's map pin, a chart's callout), and **a Reduce Motion screen keeps those glyphs centered**: they were placed by a transform that a press on Flat, and Reduce Motion, took away.
- **The iPhone Duo's front screen keeps its tiles two across**: the status column down its right left about 330 px for the page, under the two tiles a phone's grids need, so every grid below Scenes went one tile to a row across the whole width; a phone's tiles may now be as narrow as 150 px.
- **An iPhone turned upright puts its tab bar back at the bottom**: turned from sideways in the Mantel app, it kept the sideways Side Strip down the right (the clock and battery at its top, the Favorites one to a row beside it) -- a rotation's safe areas come after its resize, and the old ones were kept until the next.
- **A Big Number thermostat's number stays put when tapped** on the Flat look (it dropped half its height while the finger was down, and the arrows' row with it).
- **A volume slider moves only once your finger goes sideways**: scrolling a Volume tab's list, the Music page, a speaker's sheet or the Side Pane no longer catches a slider on the way and changes a speaker's volume (the rule the room controls' sliders already kept).
- **A long room name ends in "…" inside its pill** (the Vacuums page, a vacuum's sheet and every pill grid): it ran out of both ends of the pill, into the next one.
- **The vacuum's sheet uses the Vacuums page's room pills**: the same height, look and centered names (they were taller, darker and their names sat at the left).
- **The Music page's Your Playlists shows on a wall tablet without a reload**: it was drawn last in the page's redraw, so anything that stopped the redraw before it left the section missing; it now draws on its own as the list arrives.

## 1.57.0 - 2026-11-10

**Changed**
- **A vacuum's sheet lists only the rooms that vacuum can clean** (its room map in Home Assistant, through Mantel's Clean Areas), two to a row in the wide sheet.
- **The vacuum's sheet lists its rooms one to a row, scrolling**, sized to the sheet: on a tablet the sheet is wide -- the vacuum, what it is doing and its commands on the left, the rooms down the right with Start Cleaning over them; on a phone Rooms to Clean opens the same list, filling the sheet.
- **The Large Vacuum block draws the vacuum**, as Tall and Extra Large do: the animated drawing, what it is doing and its battery on the left, the rooms a list down the right that scrolls, Clean and Dock under it.
- **The vacuum's sheet draws the animated vacuum** in place of its glyph in a circle, and **offers its rooms again** under Mantel (Rooms to Clean, the Vacuums page's picker): it looked only for Home Assistant's own clean_area.
- **The timer wheels take a finger anywhere in their column**: a swipe that starts on "hr", "min" or "sec", or between two wheels, spins the wheel.
- **The water heater has a Big Number look**: where the Climate page shows its thermostats as Big Number, the water heater is one too -- its setpoint the number, its own modes held under it.
- **A thermostat's Big Number sheet puts the number in a card of its own**, as tall as the controls beside it, the number and arrows no longer hanging below them.
- **The Vacuum card's Clean, Locate and Dock glyphs sit in the middle of their keys** in HK Frontend (they sat low under Home Assistant).
- **The Small Timers block centers "Start a Timer" and its +** when no timer runs (they sat at the left, where a running timer moves out of the + button's way).
- **The screensaver's Forecast no longer shows a black box over its weather** when a Holiday slide is in the show (its styles reached the high and low line), **and the New Year board shows its countdown and words** again (its letters were hidden with the Forecast).
- **Security Extra Large shows the Entries you chose**, in their order (it listed the house's locks instead), and its list's rows no longer draw a frosted band behind them on the Blur look.
- **Security says when every door and window is closed**: the doors-and-windows toast reads "Doors & windows closed" (a tap opens Doors & Windows), and a list row may be 55 px where that lets one more row in.

## 1.56.0 - 2026-11-09

**Changed**
- **A vacuum's water tank that ran dry stays on its card until cleared.** A mop vacuum reports it for under a second and carries on, so no screen could show it; the always-on server now catches it, keeps it across restarts and shares it with every screen. The vacuum is drawn with the red water badge and "Water tank empty", and a Clear key (the Vacuums page's card; a pill on the Extra Large, Tall and Wide blocks) clears it for everyone; it clears itself after 24 hours. Small and Large say it in their line. Vacuums → Water Tank Reminder (on) and Clear After (12, 24, 48 hours, Until Cleared); works with any vacuum that reports it as an operational error sensor or in its attributes.
- **The vacuum, drawn**: Apple's robot vacuum in place of the battery percentage on the Extra Large, Tall and Wide Vacuum blocks and on each vacuum's card on the Vacuums page, animated by what it is doing: on its dock, charging, cleaning (the side brush spins, its path draws itself), returning, paused, the water tank empty, stuck. The battery moves to the line under the state. Wide's keys take more of the width; the Vacuums page's cards have one row of 56 px keys (Clean or Pause, Locate, Dock).
- **Live TV Wide, Tall and Large fill the block**: the channels are a grid of the block's whole room, each picture cropped to its tile, with no bands at the sides or foot.
- **Security, armed**: the keypad's display alone lights white (the keys no longer sit on a white edge); Wide's alarm tile is a cell wide, as Compact's.
- **The Small Timers block's ring is bigger**: it runs from the block's left inset to the + button.

- Doors & Locks: when the rows don't all fit, the list scrolls inside the block instead of ending in "+N more" (every door, window and garage door reachable; rows stay 56 px, open ones first, the headline fixed in the upper left, a soft fade at the foot while more is below).
- **On Now and House Status have real finger targets.** Every kind and section is a 56 px line (44 on a tablet block drawn at 0.8) in one list that touches as a list does, bigger discs, 15 / 600 names. On Now shows the kinds that are on first, its Small block is the count over one big line for its first kind (no 2 x 2 of pictures), and All Off is the standard pill (Wide and Extra Large in the headline's column, Large beside the count, Tall under the lines). House Status's list scrolls inside the block, its headline fixed, a fade at the foot while there is more, instead of "+N more" (owner, 2026-11-09: "really hard to touch ... especially on the small card"; "maybe have a vertical scroll within the card").

## 1.55.0 - 2026-11-09

**Changed**
- **Now Playing's Browse and speaker buttons are the standard pills** (40 px capsules, a 56 px touch), as Up Next's Browse; a short Large block (a tile cell) keeps its playlists under them.
- **Doors & Locks Wide fits two rows** on a tile cell: every row that fits is a door, open ones first, and "+N more" sits under the headline.
- **The Doors & Locks block is one calm list at every size.** The rows are those of On Now and House Status: a glyph in its circle (orange when open), the name, the state at the right, hairlines between, no plate behind a row. The headline is the open kind's glyph over "1 Open" and what is open, or a green check over "All Closed"; Extra Large and Wide put it beside the list, Large and Tall above it, Small shows it alone.
- **The Suggested Scene block shows the scene for now as the hero, with what comes later.** Its own glyph (silverware for dinner, a moon for night, a sun for morning) in a circle, "Up Next · Evening" over the scene's name and when it begins, and a white Run Now key; under it a "Later" list of the next scenes with their times, each a tap that runs it. Extra Large is new: the hero at the left, three later scenes at the right. Large and Tall show two (as many as fit); Wide gains a play key; Small stays as it was.
- **House Status starts at the top at every size.** The headline ("1 Window Open", or "All Good" with its green check) now starts at the block's top inset, top left on Extra Large on the first line's level, and its sentence under it; "+N more" sits at the foot of that column on the last line's level. The lists start at the top too.
- **The Room and Scenes blocks keep Large's tiles at Extra Large and Full Width**: three tiles across at Extra Large and six at Full Width, up to two rows, from the top-left (the Room under its name and status) -- not two columns and not a short row in the middle. A room with more than fit says "+N more" at the heading's right, which opens it; Scenes says "N More" in its last tile as before. The Scenes block has no Time Windows option and no Suggested column.
- **The Large Live TV block fills with channels.** Six channel tiles, two across and three down, in one designed size (16 : 10) that fits the block; fewer channels start top left and keep that size. Tall, Wide, Small and Extra Large are unchanged.
- **The Now Playing block with nothing playing, at Large and Extra Large:** the last thing played with a white Play key, Browse and the speaker as two full buttons (a word and a gray line each), and your playlists. Large lays the playlists in a row of covers; Extra Large puts them on the right as rows that scroll, as Up Next does. Once music plays, the block is the player again.
- **HomeView Security, every size, as mockups 14b and 14d.** The alarm is Apple's siren light (off while disarmed), "Armed" or "Disarmed" and one line that counts what needs a look ("1 unlocked · 1 open"), in the block's upper left; armed, it lights white, and on Wide and Compact it fills its column. Large, Tall, Wide and Compact list the locks and garage doors as one calm list (no tile behind each row); Wide and Compact put the list and the Doors & Windows toast at the right. Security's colors follow DESIGN.md: teal for armed and for what needs a look, no orange, blue or green; the keypad's readout is gray while disarmed. The screensaver draws the siren light too.
- **Security's lock list is one list, not a plate per row** (mockup 4b). Beside the keypad on Extra Large, and on Large, each lock and garage door is a row like On Now's: a glyph in its circle, the name, the state at the right, a hairline between rows. A secured lock's circle is dim with a teal glyph; one that is unlocked or open turns orange, with its state in orange. The open-window strip at the foot stays as it is.
- **Running timers are one piece each.** The Timers block shows each timer's name, its ring with the time left inside it, and Pause (or Resume) and a red Stop right under the ring: three across on Extra Large, two on Large, one on Tall ("+N more" under it), two on Wide with the keys beside each ring, and on Small the ring alone. The ring is no longer the pause key.
- **The Timers block always has a way to add a timer, and the roller on Large.** Every running size has a plain orange + at its top right (a 52 px disc in a 56 px touch target) that opens the New Timer sheet with the wheels; Pause and Stop are 52 px discs with 14 px between them in 56 px targets. Wide shows one timer with its keys and the + (a second timer's keys have no room beside it; "+N more" says so). Large with nothing running has "Start a Timer" in the upper left, four preset rings (5m, 10m, 15m, 30m) and the New Timer card's wheels, a name where the room allows, and Start; Extra Large with one or two running keeps the wheels beside the timers where they fit. Wide with nothing running no longer draws its words over the rings.
- **Running timers are readable from across the room**: each timer's name is 17 px semibold in the first ink, and the time inside the ring is a quarter of the ring in a medium weight. On Wide, Pause and Stop line up with the name's top and the ring's foot.

**Fixed**
- **The Small On Now block says "Off" (and "Idle" for speakers) for a kind with nothing on**, as the Wide block does, instead of "0".
- **The Vacuum block's "All rooms" row is a 56 px touch target** on Tall, as the block's other keys are, instead of 44 px.
- **A Compact Security block can be added again**: in the Home Grid editor, choosing Security at Compact (3 x 1) said it didn't fit and Add did nothing, though a 3 x 1 place was free -- the new block was checked as Compact without Security's HomeView presentation, which only Compact allows, so it was refused. A new Compact Security now starts as HomeView.

## 1.54.1 - 2026-11-09

**Changed**
- **The Vacuum block's ring shows what matters.** While it cleans: the cleaning progress; otherwise the battery, with the state under it. A vacuum that reports neither shows its state in words, never a dash. On Tall, Clean and Dock now fill the width of the "All rooms" row together (Dock stays round, 8 px clear).
- **The On Now block loses its heading at every size.** The count (or "All Off") now starts at the block's top inset, top left on Extra Large, and the lists start there too. **The Small block shows more:** the total, then a 2 x 2 of each kind's circle with its count beside it (lights, speakers, fans, plugs); the circles are pictures, the block's one tap still opens the On Now sheet.

**Fixed**
- **Glyphs sit in the center of their circles** on On Now and House Status: the circle's icon was drawn as a block inside a line box and sat 1 to 3 px low; it is now centered exactly, and the audit checks every circle's glyph to within half a pixel.
- **The card picker's previews match the screen on square cells**: an Accessory Group (and any block that lays out tiles on the cell's inset) drew its tiles one over another in a column in the picker though it laid them side by side on the screen; the preview's cell now has the grid's own insets. The preview's sample accessories are named lights first, never one named only by its device's address.
- **The Wide Now Playing block's album art sits on the block's middle**, not low: the song's column beside it is taller than the art, and the art was centered on that.
- **An empty Small Music block keeps its inset**: "Recently Played" no longer runs past the block's edge before anything has played.
- **A segmented control with many choices splits into two rows** when they don't fit, instead of drawing one choice over the next -- a block's six sizes in the editor on a phone read Small, Wide, Compact over Tall, Large, X-Large. "X-Large" no longer breaks at its hyphen.
- **The Small Timers block with nothing running** says "Start a Timer" over an orange + that opens the New Timer sheet, as the bigger sizes do. The "Start a timer" button no longer runs off the block's edge, and "None running" no longer uses the countdown's light type.

## 1.54.0 - 2026-11-09

**Fixed**
- **The snow past the Holiday slide's window falls**: the screensaver laid the slide out every few seconds, and each time the snow and the other effects started again in new places, so they jumped about instead of falling. They now keep falling, each flake drifting at its own pace.

**Changed**
- **Who's Home can show a map at Extra Large**: turn on Show Map in the block's options and the left side becomes a map of where everyone is -- each person with a location as their picture on it, the house marked, zoomed to fit everyone (the neighborhood when all are home) -- with everyone listed on the right: Home, then Away with the place and how far. It's off by default, since anyone who can see the screen sees where everyone is.
- **Live TV's Extra Large size is two columns**: the channel that is on fills the left -- its picture, its number and name ("4.1 · Channel 4") and the show's name over a dark foot with how far through it is -- and the other channels are rows on the right under a "Channels" heading (number on the picture, the show over its channel, a small progress bar). A tap on the picture plays full screen; a tap on a row tunes it. The list scrolls with a soft fade when there are more channels than fit. The left is the channel the block chooses, else the last one you played from it, else the first.
- **The Music block's Extra Large size in two columns**: the last thing played is large on the left (its cover, name and artist) with a white Play key and a round Browse key at the foot, and the rest of what was played is a scrolling list of 56 px rows on the right under "Also Played"; a tap on a row plays it. The playlists face (Presets) lists its other playlists the same way.
- **Timers set on wheels, and Extra Large makes one**: the New Timer sheet (the Timers page's Create a Timer, and the + on every Timers block) sets the length on three wheels -- hours, minutes and seconds, as the Clock app does -- where the number keypad was. Flick a wheel and it settles on a number, tap a number to jump to it, or use the arrow keys; Start says what it will start ("Start 1 hr 17 min 2 sec") and the end time shows under the wheels. The wheels open on the last timer you started. An Extra Large Timers block with nothing running makes a timer right in the block: the six presets under "Start a Timer" on the left, the wheels, a name and Start on the right. Wide, Tall and Large say "Start a Timer" as one line centered over their preset rings. The + on a Timers block opens the same New Timer sheet as the Timers page.
- **Up Next scrolls in every player that lists it**: the screensaver's music slide and its pane, the Now Playing page, the Side Pane's music card and the Side Pane's Full player list every song in the queue (up to 40), not just the rows that fit. The list scrolls by finger inside the room it had -- the heading stays, the cover and controls don't move -- with a soft fade at the foot while more are below and no scrollbar. On the screensaver a drag scrolls the list instead of tapping a row; a tap still opens the Queue.
- **The Now Playing block's Extra Large size lists Up Next**: Large's player -- the album art with the speaker line and the song beside it, the progress, back / play / next and the volume -- sits on the left, and Up Next fills the right. It scrolls through the songs after this one, and a tap on a song plays it. Browse is a button at the right of the Up Next heading with a full-size touch area, so play / pause stays centered between back and next.
- **The speaker line and the play row's ends**: in every music player the line over the title is the speaker button -- the speaker, where it plays (the rooms grouped with it after "+") and a chevron; a tap opens Speakers. The play row is Browse at its left end, back, play, next, and Up Next at its right (where the queue isn't already listed under it); the small Speakers key is gone and nothing sits under the volume. The Music page's "Playing on ... Change" pill gives way to the same line.
- **The Music page's player joins the shared controls**: the same room around play / pause, play the largest key, the whole volume row a touch area (it was the 30 px track), and the phone's mini player with even margins round its cover.
- **One set of player controls everywhere, with room around Play**: the screensaver's music slide, the Now Playing page, the Side Pane's player and the Now Playing blocks now share one controls strip -- the progress, the keys and the volume -- with clear space above and below the keys and no two touch areas overlapping. A tap just under play / pause no longer turns the volume (the screensaver counted a touch up to 28 px from the volume's line as the volume, ahead of the keys). The Now Playing block's Wide and Tall have their volume back; where the progress and the volume can't both be full size, the volume keeps its slider and the progress is a thin line in its place. The gap beside the album art matches its margin to the edge, and the music slide's margins are even left and right.
- **The last colored capital labels are gone**: Battery's and Energy Rings' figures (Solar, Using, Grid, Full By; Energy, Cost, Solar, Water) and the Thermostat's Heat, Cool, Cool To and Heat To read in Title Case in the gray, a small colored dot where the color means something. **Scenes' last row starts in the left column**, as Rooms' and Groups' do. **Timers** no longer prints "Timers" or "Timer" as a title -- a timer you named shows its name in the gray heading style. **The Calendar's empty day** keeps the weekday and the date at the top-left, as a busy day has them.


## 1.53.0 - 2026-11-08

**Changed**
- **Everything takes another row where one fits** (square cells: Wide two rows, Large and Extra Large four), now that its heading is gone; **a group's last row starts in the left column** (Rooms and Accessory Groups, full tiles and half pills), the group still centered in the block.
- **Block headings match, and the ones that only named the block are gone**: every heading is the Weather page's section title -- the same gray, Title Case, the same size, on the block's top edge -- and a label for one part of a block (Mode, Rooms, This Week, Tomorrow) sits right on the thing it labels. Battery, Water, Doors & Windows, Everything, House Status, Live TV and Now Playing no longer print their own names; Calendar, Music, On Now, Who's Home, Power, Room, Security, Timeline, To-do, Vacuum, Weather, Suggested Scene and the Thermostat keep theirs in the one style.

**Added**
- **Which Timers**: Settings → Timers lists every timer in the house, on or ignored, with a switch. A timer turned on shows on the Timers slide.

**Fixed**
- **Tapping the alarm's state on a HomeView-style Security block opens the alarm**: its keypad, or Home, Away and Off when it takes no code, as Classic's Home, Away and Disarm already did (it opened the Security overview). "+N more" and a group still open the overview, and a block's own custom sheet still wins.

## 1.52.0 - 2026-11-08

**Added**
- **The Timers slide on the screensaver**: while a timer you set is running, a slide with the timer ending first on a big ring and the others as small rings beside it comes every other slide, or as often as the others. A timer's last minute holds it on the screen. House Timers and timers that automations use never show.

**Changed**
- **Security's doors and windows strip is flat again and comes to Wide**: the strip that says what is open is a flat orange line as wide as the rows ("3 open · Office Window, …"), not a button like them; Wide shows "3 open" under the alarm's words, its rows keeping their size.
- **Security, drawn again**: Extra Large keeps the keypad and beside it a LOCKS & DOORS heading, each lock and garage door a row with its name whole and its state at the right, and at the foot, on the arm keys' line, a notice with an orange badge when doors or windows are open. Large (both looks) is the same list under the alarm, with Classic's Home, Away and Disarm on the same edges, and HomeView's Large and Tall end in the same notice. Rows are a finger's 44 px on the tablet's screen; what doesn't fit is "+N more" in the heading, and anything not secured and the garage doors stay in view first. A locked lock's glyph is teal, one not secured is white with its glyph and state in orange. Security no longer has a Height choice.
- **Half pills in a group lose their well on HomeView-style screens**: an Accessory Group's or Room's half-height tiles take Tiny's look -- the glyph bare and sized to the pill, a sensor's reading in its place -- as the screen's Tile Style chooses; Home style keeps the Home app's pill.

**Fixed**
- **Back on a Screensaver settings page no longer opens the screensaver full screen**: beside the preview, the page's Back button could step the preview back instead and show its screensaver in the whole window. It now always goes back a page.

## 1.51.0 - 2026-11-08

**Added**
- **The Holiday slide**: a screensaver slide counting the days to the next holiday. Christmas, Halloween, Thanksgiving and New Year's each have a painted scene (a 90s living room with the count on the TV, a haunted house with it on a tombstone, a dining room with it chalked on a board, a rooftop party with a split-flap board) and live effects. Every other holiday, birthday and date of your own stands outdoors on the sky's landscape. It comes among the photos or over a clock, once a holiday is near. Holiday Options sets which holiday, how many days before, the effects, the holidays it counts, your own dates and the scenes. It is off by default; the Holiday Whimsy Look turns it on.
- **Tiles in a block sit 13 px in with 21 px corners** on HomeView's square cells (groups, Scenes, Security, Live TV), concentric with the block; headings stay put.
- **Tiny**: an Accessory in half a cell, two to a cell -- HomeView's tile at half height, its glyph bare; a sensor's reading ("71°") in a Centered tile's glyph place.
- **A Wide Accessory is a slider** for a light, a fan or a shade (the whole tile, as Control Center's); **an Accessory Group in Small** (two half-height pills); **Music's Extra Large the last played on top**, every playlist five across under it (and the Music block's Playlists lead with the one last played); **Security's HomeView Extra Large keeps its keypad**.

**Changed**
- **Half-height pills fill their block to equal margins**, titles sit on the block's inset, and short wide tiles keep their words clear of the foot.

**Fixed**
- **Pre-rendered glass no longer flickers as a swipe lands** (the last page's blur behind the cards for a few frames), and **the Pages screen lands sharp and at its full size from Home** (its icons could land blurred, then small and to the left for a second).
- **A swipe over a row that scrolls sideways turns the page when the row can't go that way** (Music's rows at their start or end; on an iPad the rows keep every swipe, as before).
- **A swipe over a list that scrolls up and down turns the page** (Security's Recent Activity, Calendar's day list and hours, and the rest take only up-and-down swipes).
- **Accessory Groups no longer redraw in one column on the way back Home** (one updated while another page showed laid itself out for the wrong cell shape).

## 1.50.0 - 2026-11-08

**Added**
- **Security's Height option** on Large and Extra Large: the locks and garage doors as HomeView tiles (Full) or half-height pills (Half, the default beside the keypad, lined up with it).

**Changed**
- **A block shows a title only when you gave it one**; Accessories and Scenes no longer show a generic label, and "N More" is their last tile.
- **The Rooms and More sheet on a tablet spans the window**, with room around it to tap out.
- **A block with nothing to show says its name and where to set it up.**

**Fixed**
- **An Accessory Group that pages shows one row of dots**, its tiles under its title; **half-height pills keep their second row**.
- **Security's locks lay out the same in the editor and on the tablet**, their names whole.
- **Swiping between pages in Pre-rendered glass** no longer flashes the last page's blur, and the glass repaints for less.

**Fixed**
- **No flash of the last page's blur behind the cards after a swipe** in Pre-rendered glass: each page keeps its own picture through the swipe, and the fresh one fades in once it lands.
- **Pre-rendered glass repaints faster on Android tablets**, and waits for a pause in swiping before it does.

## 1.49.0 - 2026-11-08

**Added**
- **A Custom Detail Sheet on any Home Grid block.** Edit a block, then Detail Sheet → When Tapped → Custom Detail Sheet: a title, an icon, a tile style and the accessories you choose, in your order.
- **Security in HomeView's style**, with a new Compact size (3 × 1); its Extra Large leads with the keypad, the locks and garage doors as tiles and the open doors and windows in one line.
- **More sizes for the Home Grid blocks** (Accessory Tall with a level you drag, Room Small and Tall, Thermostat Wide, Calendar and To-do Wide, Timers, Who's Home and more), and **a block answers a tap by where it lands**: On Now's categories open a sheet of those things, or their page (a new option, Categories).
- **The Vacuum block picks rooms:** Wide and Tall have a Rooms key that opens "Rooms to Clean" and name the rooms on the block; Clean cleans them, or the whole house when none are picked.
- **Everything can scroll in its block** or open its page (a new option, More Places).

**Changed**
- **Nothing in a block stretches.** Tiles, rows, keys and pills keep their designed size at each block size; a bigger block shows more of them, centered with equal margins. Room, Accessories and Scenes keep one tile size per block size, with "More" for the rest.
- **On Now and House Status, redesigned together:** a headline ("8 On", "1 Window Open", "All Good") over the categories as lines, each glyph lit in its color.
- **Now Playing follows the screensaver's Music slide**; Timers with none running, Calendar with nothing scheduled, Doors & Windows and Who's Home read as finished blocks in every state; the Thermostat's modes sit behind one Mode key on Wide and Tall; Weather Extra Large spreads its readings; Live TV tiles show what is on behind each channel.
- **The Home Grid editor's previews draw in the screen's Tile Style.**

**Fixed**
- **Swiping between pages is lighter in Pre-rendered glass**, and quick flicks one after another all turn the page.
- **The screensaver's forecast along the bottom shows its hours and days again**, and the Home Grid's clock no longer runs under the weather.

## 1.48.3 - 2026-11-07

**Fixed**
- **Pre-rendered glass shows the new page’s background after a page change.** A repaint asked just as the page changed could draw the last page’s sky onto the new page’s cards and keep it for that page; it now waits until the new page’s sky is up.

## 1.48.2 - 2026-11-07

**Added**
- **SF Pro and the glyph file from Mantel when linked.** A linked HK Frontend whose house is Mantel’s fetches the licensed files it lacks from Mantel, checks them and puts them in Your Files; a copy put there by hand is never replaced, and Setup check says where each came from.
- **Pre-rendered Bright Glass on the tab bar, the docked menu and the Side Pane.** In Pre-rendered mode they now wear the shared picture of the sky, as Blur’s do, instead of blurring live; sheets and menus over the page still blur live.
- **Up Next in the Side Pane’s Full player.** Under its buttons, the queue fills the room the cover leaves, each song with its cover; a tap opens the Queue.
- **Icons for Centered tiles.** Under Appearance, Tile Style has Icons: Automatic (white on Bright Glass, in color otherwise), Color or White, for All Screens or one screen.
- **Big Number thermostats on the Climate page.** The Climate page’s settings have Thermostats → Style: Dial or Big Number, HomeView’s. A thermostat’s sheet follows it, with its modes and fan beside the number. Water heaters keep their dial.

**Fixed**
- **Pre-rendered glass follows a moving wallpaper.** The glass’s picture of the sky now repaints every 2 seconds while a wallpaper’s motion runs, and at once when its Motion changes, instead of keeping its first picture for 30 seconds.
- **The Side Pane player’s Speakers and Browse buttons are no longer cut off.** A pointer over them dims them, as the Full player’s do, instead of drawing a circle past the pane’s edge.
- **Up Next in the Side Pane shows each song’s cover** in place of its number.
- **The Full player’s cover shadow stays inside the pane**, no longer cut off either side of the cover.
- **No blue box on the music panel’s tabs.** Tapping Speakers, Volume, Queue or Browse on an iPad no longer flashes WebKit’s tap highlight.
- **A water heater’s mode names stay whole.** Five modes share the row without breaking “Demand” across two lines.
- **Music slide corners align by their visible edges.** The time, date and weather share one left edge, with or without a Side Pane, including on the Now Playing page.
- **The volume row stays within the progress bar’s edges** on the screensaver slide, music pane and Now Playing page.
- **Selecting HK Landscapes replaces the Photos preview.** The editor keeps a photo while its appearance changes only if it belongs to the selected collection; switching back to Photos replaces the landscape too.

## 1.48.1 - 2026-11-07

**Added**
- **A Now Playing page.** The screensaver’s interactive music slide is also a full-screen page, with time, date, weather and home status in the corners. Choose Now Playing under Swipe Right on Home to open it with a swipe; beside a Side Pane, Up Next appears beside the cover.
- **House Status, a Home Grid block.** It shows the screen's status chips in HomeView's look: Climate, Timers, Power, Lights, Security and the rest, each with its reading and, at larger sizes, where and what. Each section opens its own page. "+N more" and the Small size open a House Status sheet with all of them, in two columns of panels on a tablet and in rows on a phone. It follows the screen's Status Chips (which chips, their order, Always or When Active) even when the chip row is hidden. Alerts come first, and a sensor that hasn't reported shows no reading rather than zero. Add it from Info in the Home Grid editor.

**Fixed**
- **Long room names on the Intercom sheet end in "…"** instead of being cut off, such as "Primary Suite …". The whole name is still what VoiceOver reads.

**Changed**
- **Every music player has the same bare controls.** The screensaver's music slide, the Side Pane's player, the Home Grid's Now Playing blocks, the Now Playing card, the Play Music page and the speaker sheet lose the circles behind their buttons, and the icons are bigger instead. Speakers and Browse sit lighter at the ends of the row, lined up with the progress bar. A button whose panel is open still lights up.
- **The progress bar and the volume sit the same distance from play/pause** in every player. Before, the volume sat closer to it than the progress bar did.
- **Progress and volume bars are white, as on the screensaver,** instead of purple: white on a quiet track over the cover, and the look's own ink on a plain card. The Side Pane's volume now fills up to its level, and the speaker sheet has a small and a large speaker either side of its volume.
- **Up Next beside the cover.** When the screensaver's music slide sits beside a pane, the next songs are listed under the song, as many as fit beside the cover; a tap opens the queue.

## 1.48.0 - 2026-11-07

**Added**
- **Saved screensaver designs.** Browse designs by swiping, keep up to twelve named designs, duplicate or remove one, and customize its face, background, widgets and options. **All Screens** supplies the shared designs and saved default; saving on an individual screen makes an independent copy. Hold a quiet part of a running screensaver to choose a design on that device.
- **Ten new clock faces:** Solar Dial, Prism, World, Hotel, Terminal, Atelier, Meridian, Markets, Daily Brief and Modular.
- **The screensaver editor works on a phone**, with its actual preview above the widget and settings panels.
- **A Status section for the Side Pane.** Like a custom status chip, it shows an entity with your own glyph, color, name and label (for example, Mail: Likely Delivered). It appears only while its Show When rule holds (the entity is, is not, is above or is below a value). Add it under Side Pane → Dashboard Sections or Screensaver Sections. It comes in Tiny, Less and More, and a tap opens the entity's sheet, or does nothing.

**Fixed**
- **Speakers and Browse open again on the screensaver's music slide.** The panel no longer closes the moment it opens: lifting the finger from the button no longer counts as a second tap.
- **Speakers and Browse turn over smoothly.** The Now Playing block, the screensaver and the Side Pane run both halves of the turn on one schedule, and the panel is painted before it moves. The block no longer reappears flat for a moment while the panel turns in.
- **The Side Pane's player panel no longer gets clipped as it opens and closes.** The player and the panel cross-fade, with the song's row riding between the player's cover and the top of the pane.
- **A Home Grid block that swipes moves as a whole block.** Each page keeps its own corners, rim and shadow as it slides, and is cut off only in the gutter beside the block. Before, the block's outline stayed put while its pages slid through it, with the background showing between them, in every look.
- **A stereo pair is one speaker on the generated dashboards.** Two speakers made one room in Music settings show as one tile under the pair's name, on Home, the room's page and a Home Grid room block, and the room's status counts one speaker.
- **Dashboard swipes continue through card updates and inner scrolling areas**, including Calendar, Live TV and Music. The page stays with the finger, and the navigation and Side Pane use its release curve.
- **Screensaver previews hold the selected slide** through settings changes and show an explicit Side Pane control with As Saved, Show and Hide. Music can be previewed with nothing playing, with sample artwork and controls that can't start playback. Design previews in the gallery are centered and fully visible at any size.
- **Changing a clock face's options no longer covers or briefly removes the face**, and the World face uses accurate, bundled coastline geometry.

**Changed**
- **Album-art backgrounds keep their proportions,** and music beside a Side Pane uses the space more evenly: artwork beside a centered block of track details, with progress and controls underneath. The Side Pane's More player has roomier controls and an adaptive Up Next list. Full-screen music controls align with the bottom of the album cover.
- **The Full-size music player spreads its buttons.** Speakers and Browse sit at the ends of the progress bar with the transport between, as on the More player.
- **A sideways swipe goes on past the tab bar's last tab** to the pages under **More**, in More's order (room pages still have none), and each screen's **Swipe Right on Home** (Settings → the screen → Menu → Gestures) can put one of its pages before Home, such as Music for the player full screen.

## 1.47.0 - 2026-11-05

**Added**
- **The Lock and garage sheets move and answer.** As you hold to unlock, the lock's shackle starts to lift with the ring, and it springs open when the hold is done; tapping to lock drops it at once. A garage door rises through **Opening…** and comes down through **Closing…**. A lock now says **Unlocking…** or **Locking…** the moment it's sent, as the garage already did. Every press answers with a small bump, the ring flashes when the door gets there (with a success tap on the iPhone app), and a command that didn't go through shakes and says **Didn't go through. Try again.**
- **The screensaver's Camera can hide or rename its camera.** Its options have **Name: Show / Custom / Hide**; Custom gives it the words you type in **Custom Name** ("Porch", say, rather than the camera's device name), and Hide leaves the picture alone.

**Fixed**
- **No empty band at the top of the screensaver's Side Pane.** Beside the Side Pane's own sections, Home Status stands on the photo, yet the pane still kept room for it above Calendar. The sections now start at the pane's top, as they do beside a Home Grid.
- **The screensaver's volume works on a group.** With music playing on more than one room, its slider moved only the first speaker and sprang back. It now shows the rooms' average and sets every one, as the Side Pane's does.
- Home Assistant 2026.11 no longer warns at every start about a blocking call (`load_verify_locations`) from HK Frontend. Linked to a Mantel paired by its address, HK Frontend now loads Mantel's certificate authority off Home Assistant's event loop, on the link's first connection. It trusts that authority alone, as before.

## 1.46.0 - 2026-11-05

**Added**
- **Now Playing can have the card background.** A Now Playing block has a new **Background** option: **Blurred Album** (the default, as before) or **Card**, which gives it the same background as every other block in the screen's look, with dark text on a light look.
- **Every card in a block with rules has its settings.** Choose a block that switches cards, such as Music with Now Playing while music plays, and the Home Grid editor opens on the card that's showing. **Settings For** picks which of the block's cards you're setting: its own or any rule's. Each one gets all the Content and Appearance options it has as a block of its own, and the preview shows the card you pick. Each rule also has a button that opens its card's settings (**Edit Now Playing Settings**, say). Before, the editor showed only the block's own card, with a rule's options tucked inside the rule and no Appearance options for it.

**Fixed**
- **HK Frontend starts on Home Assistant 2026.11.** 2026.11 moved the theme names HK Frontend uses, so it stopped at setup with "cannot import name 'EVENT_THEMES_UPDATED'" and no page loaded. It now finds them in either place, and still works on 2026.8 to 2026.10.
- **The Side Pane's volume works on a group.** With music playing on more than one room (a preset such as Everywhere, or rooms grouped), the slider moved only the room leading the group, then sprang back. It now sets every room, as the player and the music panel do, and shows their average level.
- **The music panel's Browse shows each playlist's cover.** The flipped-over music panel (Speakers, Volume, Queue, Browse) now shows each playlist with its cover, as the Music block does, and a playlist without one gets its glyph on a tile the same size. Names run to two lines instead of being cut off ("Your Essentials", not "Your Essent…").
- **The music panel's background is blurred.** It was the cover shrunk to 32 pixels and stretched, so large shapes and lettering on the cover still showed through. It's now blurred properly, on the screensaver's music pane too. Bright Glass had nothing to do with it.
- **Now Playing no longer flickers in Safari.** Rectangles of the blurred album behind the player flashed lighter and darker every second as the time and progress bar moved, and when the pointer crossed the controls. The blur now sits on a layer of its own and is drawn once. The docked music bar gets the same fix in Safari only, so a wall tablet's scrolling stays as smooth as it was.
- On Home Grid's Now Playing blocks, the Speakers glyph sat up to 2 px low in its circle (Small, Wide and Tall). It's centered now.

## 1.45.0 - 2026-11-05

**Added**
- **Touch and hold empty space to edit a page.** Hold an empty part of a page (between the tiles, or below them) for half a second and it goes into Edit mode. It works wherever **Edit Page** is offered (admins, never on a wall tablet). Holding a tile still does what a tap does.

**Changed**
- **Swiping between pages, rebuilt.** The page follows your finger, keeps your finger's speed when you let go, and a flick back goes back. A finger on a page still settling catches it. Home Grid views, blocks that swipe their pages and the side menu let go the same way. With Reduce Motion the two pages cross-fade.
- A page's background fades in with your finger as you swipe to it, and a page with another look (Bright Glass on Home only) wears its own all the way in.
- On a host with the Intercom (Mantel): a chip and a Scenes pill for it on the Home page, and its block and sheet redesigned. On a host with the Timeline (Mantel): the page has a gradient of its own, its **Day** button opens a little month, and a screen with its own pages can add it. In Home Assistant nothing changes.

**Fixed**
- A new swipe while a page was still settling no longer strands it off screen, with touches ignored.
- Swiping is steadier on slower tablets: a Home Grid's views no longer restyle everything inside them on each move.

## 1.44.0 - 2026-11-04

**Added**
- **The screensaver's Date, your way:** two lines (the weekday over the date, lined up with its corner, or centered), a short or numbered month, the year, a short weekday or none, a light or bold weight, and all capitals. As it comes it reads as before.

## 1.43.0 - 2026-11-04

- On a host with the Intercom (Mantel): the Home Grid block **Intercom** and its sheet. In Home Assistant the block says "Intercom needs Mantel".

## 1.42.0 - 2026-11-04

- On a host that keeps a House Timeline (Mantel): the Timeline page, the Home Grid block **Recent** and a camera sheet's **Recent** strip. In Home Assistant nothing changes: the page isn't listed, and a layout with a Recent block shows a stand-in.
- Fixed: the timers' sheet could stop drawing (an accessory's own name looked up where it wasn't known).
- **Screensaver, fixed:** the people over the time stay over it when the minute changes.

## 1.41.0 - 2026-11-03

- Advanced → **Features**, on a host whose features are its own (Mantel): **Turn Features On Automatically**, and under a feature the host turned on by itself, when and why ("Turned on by Mantel on Nov 4: …"), or what one that's off still needs. In Home Assistant the page is as it was.

## 1.40.0 - 2026-11-03

- **Screensaver, Align:** a piece's words Auto (by its side: a card on the right ends every line on the right margin), Left, Center or Right; Home Status' card without its Title.
- **Screensaver, fixed:** the people over the time fade with their photo; a zoomed whole portrait stays centered; the slide corner stays clear of each slide's own words.

## 1.39.0 - 2026-11-02

- **Screensaver, the slides' own settings:** the slide corner's time size (100 to 250 %) and what it adds; what Music Full Screen shows (room, album, progress, buttons, volume, Up Next). In the editor's Slides section.
- **Screensaver:** the Today face's **Weather** can be turned off, beside **What's Playing**; a Weather or Music piece is hidden only while the face shows it. The time stays where Position and Align put it, whatever the face shows since it was measured. The editor draws nothing over anything else, and a dragged piece lands on the place it covers.
- Advanced → **Features** lists every feature: on a host whose features are its own, with a switch each; in Home Assistant, with the way to add one.
- Music: **Group Leaders** (HK Settings → Music). Which room leads when rooms play together: the rooms that lead (best first), and the **Announcement Rooms** Home Assistant speaks to, which lead only when no other room can (Music Assistant plays an announcement to a group's leader in every room of the group). A room already playing keeps leading; before, the first room in the list led. A library item on several rooms plays on that room first.
- The screens' hints point to where a feature's settings are: its page under Pages (Live TV, Energy, Music; Vacuums for Clean Areas), not a Features section HK Settings no longer has.
- **Swipe Between Pages:** the docked Now Playing bar no longer stops the swipes (every swipe after it came up was refused, and on the Calendar each turned the month instead); a swipe on the Calendar turns the page, not its month too; the bar comes up the same way each time a swipe lands on a page that shows it; short quick flicks turn the page every time; a swipe whose starting point a card draws again mid-swipe still turns it; and swiping between Home and the Pages screen beside the Side Pane no longer restyles the whole screen each frame.

## 1.38.0 - 2026-11-02

- **Host words:** the shared screens name their settings through the host (`hkShell.settingsName()`, `settingsPlace()`), so Mantel says Mantel Settings where they send someone to them. In Home Assistant every text reads as before: HK Settings.

## 1.37.0 - 2026-11-02

- **HK Settings → Features on Mantel:** Add and Remove each feature there, in Mantel's own settings (in Home Assistant, Add feature stays HK Frontend's).
- **Linked mode by Mantel's address:** linked to the address Mantel Link pinned (Mantel's own link port), HK Frontend uses the same certificate authority Mantel Link pinned, so its link needs no name, DNS or proxy either.

## 1.36.0 - 2026-11-02

- **Screensaver, one screensaver:** the editor's starters are **Looks** that keep what you placed (**Start Over from This Look** replaces it all); the right side is always **Look**, **Info**, **Slides** and **Timing**. Widgets and cards are **pieces** in a few shapes (Inline, Circular, Rectangular, Card, Band), Size 60 to 200%, one size for the row, one **Ink** for the screen (Auto: black or white from the background) and **Color Accents**; any piece can **Show When** an entity is, is not, is above or is below a value. A fact is drawn once.
- **Screensaver, 35 more pieces:** Countdown, World Clock, Rain Soon, Weather Alert, UV, Wind, Pressure, Feels Like, Moon, Sun, Security, Doors and Windows, Garage, Climate, Lights On, Vacuum, Notifications, Package, Who's Home, Grid, EV, Up Next, Playing In, On This Day, Camera, Last Ring, Phone Alarm, Trash Day, Pollen, Appliances, Leak and Smoke, Travel Time, Price and Any Sensor (people and cameras off until placed).
- **Screensaver, slides:** one slide corner adds only the time, date, weather and Home Status a slide lacks; slides over every background; the music slide laid out for a phone and an upright iPad.
- **Screensaver, the time:** behind the photo's subject with any face, behind the land where it leaves the time readable; **Planted** a face; Night Mode, the Day's Art and Soft Photos with a layout; a screen with no saved layout draws through the same path (Big Weather and Month keep their own faces).
- **Screensaver:** the Day face's name sits on its numeral; Glance's weather stands under its clock, on its edge.
- **Doorbell, talking:** the talk session opens with the sheet, so a press is live at once; the visitor stays heard, lowered, while you talk; the button says Connecting, Talking, who else is talking, Can't Reach the Doorbell or Needs HTTPS (on plain http it used to vanish); one person talks at a time, and everyone else's button says who.
- **HK Settings, camera pop-ups:** a note, "Talking at the door needs HTTPS", while this screen (or, in Mantel, any wall tablet) isn't a secure page, since a browser gives the microphone only to one. The host can say where to look (`notes.secure`).

## 1.35.0 - 2026-11-02

- **Screensaver editor:** the **+** in each empty place is centered in its circle, and a Temperature widget's figure in its ring.
- **Screensaver, Today:** the song line under the weather is centered under the time, a long title cut short with an ellipsis; **What's Playing** (under the time's **Face**, and under **Clock Style** in HK Settings) turns it off.
- **Home Grid:** a Music block's **Plays On** can be a preset (it couldn't be saved since 1.34.0); a refused save names the blocks to check. A Room block's glyphs are as large as its tiles allow, and a Wide Room's row is the Home app's pill. Each playlist shows its cover where Mantel provides one.
- **Side Pane:** the small speaker sits on the volume slider's line.
- **Edit mode:** Done after a save that failed part-way no longer says the page changed elsewhere.
- **Detail sheets:** a sheet file that didn't load (a tablet waking before its Wi-Fi) is fetched again, instead of leaving every sheet dead until a reload.
- **Linked to Mantel:** a credential Mantel refuses raises one Repairs issue, instead of a warning every 30 seconds; the link retries less and less often.
- **Artwork:** covers from the internet are fetched only from the address that was checked.

## 1.34.0 - 2026-11-01

- **Appearance, Bright Glass's Dim:** the slider is Strength again, as before 1.33.0 (no brightening past the cap), and Bright Glass gains a Dim (0 to 60 %), like the Side Pane's: a shade over the cards, the chips, the tab bar and the side menu. The Side Pane's Dim is Same as the Glass by default, with its own slider when that's off. The Settings preview follows the sliders as they move.
- **Home Grid, Half Height tiles:** an Accessories or Scenes block's Half rows are the Home app's pill, 70 px tall from the top, as many as the block holds; never stretched, never a row cut through.
- **Screensaver, layouts under a slide:** while the music, the forecast, Weather or Home Energy shows, a saved layout steps aside and the slide has the screensaver's usual corners: the time, the date and the weather at the top left, Home Status at the top right. Under the music the time was gone and the weather ran into Up Next. The layout comes back with the next photo.
- **Music, presets are lists of rooms:** a preset is a name and its rooms, played by grouping them as any choice of rooms is; no Music Assistant sync group plays it, so pause now pauses (a sync group can only stop, which broke it up). New Sync Group and writing Music Assistant's groups from the settings are gone; groups made that way stay in Music Assistant until you remove them there.
- **Music, paused stays paused:** Music Assistant stops a queue that's been paused for 30 seconds. The Music page now keeps the song for up to four hours, and play resumes it where it was instead of starting the first playlist.

## 1.33.0 - 2026-11-01

- **Appearance, Bright Glass's Brightness:** the slider (Strength until now) goes on brightening past the point where it used to stop over the Wallpapers: above 50 % the glass's sheen, rim and the colors coming through grow brighter, while the glass behind the words holds back so white text stays readable. The Side Pane's glass follows it, its Dim still a shade over it. The Settings preview follows Brightness, Frost, Blur and Darkness as the slider moves.
- **Wall tablets follow their Screen:** change a tablet's Screen in Wall Tablets and its page opens the new screen, without waiting for the kiosk app to go back to its start page.
- **Swiping with a finger off the Pages screen:** a touch swipe now leaves the Pages screen for the next page (on a Pixel Tablet it went nowhere); strips that scroll sideways only when they overflow (a Music shelf, the weather's hours) no longer take the swipe.
- **Music, presets and Music Assistant's groups:** a preset's rooms are read from its group's settings, and before it plays, rooms the group gave up are grouped back (Everywhere could not play while its group held no rooms).

## 1.32.0 - 2026-11-01

- **Screensaver, Edit Screensaver, dragging:** drag a widget from the left onto a green place with the mouse, or one on the screen to another place, as in the Home Grid editor. Tap, then a green place, still works on an iPad.
- **Screensaver, the forecast among the photos:** its Layout is back on the Screensaver page (The Forecast: Classic or Big, the Big Number, Planted Numerals, Details on the Forecast), and Big Weather now shows as a slide with a layout too: the layout's big element and widgets step aside while it shows.
- **Screensaver, the Side Pane:** a screen's Screensaver Options show its own Side Pane even while the rest follows All Screens, and All Screens' page names the screens that have one of their own.
- **Swiping between pages:** the background fades to the next page's, and a press under a short page (Live TV, Cameras) swipes it.
- **Music, new speakers while music plays:** the group is updated in place: Downstairs playing and Everywhere picked no longer stops the music.

## 1.31.2 - 2026-11-01

- **Swiping between pages, sliders:** dragging a slider drawn by hand, as the Music page's volume, moves the slider, not the page. A chart scrubbed with a finger and the Weather radar keep their drags too; the Pages screen's Home pill still lets a sideways swipe turn the page.

## 1.31.1 - 2026-11-01

- **Screensaver, the editor's screen:** shows the layout alone: no slides (music full screen, the forecast, Weather, Home Energy) and none of the house's notifications. **Slides & Notifications**, beside the shapes, turns them on for the preview; it is off each time the editor opens and saves nothing. A corner's **+** stands by its stack wherever the stack was moved.
- **Swiping back to Home:** the grid no longer snaps behind the Side Pane, and the Pages screen's blur no longer rides along with the page.

## 1.31.0 - 2026-11-01

- **Screensaver, Edit Screensaver is where it is laid out:** the Screensaver pages keep only what can't be laid out: the photos and how they show, the wallpaper, the slides and how often, Night Mode, the Side Pane and the timing. A round **+** follows the row's last widget and a corner's stack while there is room. Save and Cancel no longer leave the screensaver preview full screen in Safari.

## 1.30.0 - 2026-11-01

- **Screensaver, Edit Screensaver:** every widget and card has the same Look: a **Size** (60 to 160 %), a **Backdrop** (None, Glass or Tinted) and a **Color**. The row holds two lines of widgets and sits **Under the Big Element** or **Along the Bottom**. A card with nothing to show now (no music, no timer) is drawn dotted with its name in the editor, where before it was found only by hovering. Things line up by their letters: the time's top with the top corners' words, the bottom corners on one baseline, and Time Behind's figures on the top margin.

## 1.29.1 - 2026-11-01

- **Screensaver, the Battery and Energy Today widgets:** a layout with either no longer freezes the screensaver. A wall tablet's page stopped and was restarted, and HK Settings' Screensaver page and Edit Screensaver hung once such a layout was saved.

## 1.29.0 - 2026-11-01

- **Screensaver, Edit Screensaver:** lay the screensaver out on the screen itself (HK Settings → your screen → Screensaver Options → Edit Screensaver, or All Screens → Screensaver). Start from a starter (Photo Frame, Forecast, Big Weather, Lock Screen, Clock, Glance, Month, Day, Nightstand), pick the background, set the big element's face, size, position and depth, and add circular, rectangular, inline, card and bottom-band widgets by tapping one and then a green place, with a Glass or Tinted backdrop if you like. Whatever the big element reaches moves out of its way. Undo, Preview, and Wall Tablet, iPad Upright and Phone shapes; a screen that never saves a layout is drawn as before, and Back to Today's Look rebuilds one from its settings.
- **Screensaver, Big Weather with the Clock as the big number:** the time is drawn as solid ivory figures standing in the meadow. Their shadows follow the sun in the sky (long in the morning and evening, short at midday, soft under cloud, none at night), and grass from the season's meadow grows in front of their feet. The feet now stand on the meadow on every screen, upright too. **Planted Numerals** (Screensaver → Big Number: Clock) turns it off for the time as before.
- **Side Pane, Dim:** a slider, the preview dimming as it moves; a screen's own pane is no longer lost on its next change. The pane fades and the tab bar moves with the finger between pages, and slides when a page changes. Now Playing's drawer unfolds from the player.

## 1.28.0 - 2026-11-01

- **Side Pane, Dim:** Off, Low, Medium or High (Side Pane → Look): a shade over the pane's glass and album art, for its words over a light background.
- **Side Pane, the music:** a tap on the song, Speakers or Browse makes the player rise to the top of the pane with Speakers, Volume, Queue and Browse under it. A tap on the cover opens the screensaver's music full screen (the drawer, on a screen with no screensaver). Its play button at Tiny is no longer cut off.
- **Side Pane, never stuck:** the forecast under the time is there without visiting the Weather page first, and uses the forecast sensors in Settings → Weather when chosen. The calendar, to-do lists and camera stills ask again when a read goes unanswered or fails. At Now, the hour strip shows the temperature now.
- **Weather block, Large and Extra Large:** the temperature, the hours and the days fill the block instead of leaving space above and below. The 7-Day Forecast label lines up with the place name.
- **Now Playing block:** no more flickering band behind the controls in Safari.
- **Lock Up and All Lights Off:** a tap with nothing to do says so ("Already All Locked", "Already Off").
- **Home Grid, the top band:** the Clock, the Weather and the Status Chips each on the left, in the center or on the right, in the order you choose (the editor's Header section).
- **Linked to Mantel:** a Live TV channel camera picks Home Assistant's live player again when the link comes back.

## 1.27.0 - 2026-11-01

- **Music block:** at Small, the playlist's cover fills the block with play in the middle. Larger sizes hold every playlist and scroll, across at Wide and Extra Large and down at Tall and Large. A playlist with choices, such as Decades, is one tile; a tap opens its choices, and the one picked plays on the block's speaker.
- **Music block, When Tapped:** Choose a Playlist opens a sheet of every playlist's cover, so one tap from the dashboard starts any playlist.
- **Side Pane Clock, Beside the Time:** choose how the weather sits beside the time: Large, Quiet, a Chip, or on the Date Line, at Left, Center or Right and at every pane width. The temperature takes the time's weight, and each weather symbol is centered on the figures.
- **One temperature everywhere:** the Side Pane, the header, the left menu, the screensaver and a thermostat's Outside reading now use the sensors chosen in Settings → Weather (Outside, Feels Like, Humidity, Wind, Gust, UV), as the Weather page and block do, and the weather service's own readings only when none is chosen.

## 1.26.0 - 2026-10-31

- **Virtual Pairs:** pair two Music Assistant speakers in one room in Mantel Settings (Music's speakers), and Mantel shows them as one speaker everywhere: the Music page, Speakers sheets, the Side Pane, the Music and Now Playing blocks, home rooms and Plays On. Playing joins both at play time, so neither is held in a Music Assistant group and the pair can play with any other room. Volume goes to both. A Music Assistant group of exactly the pair's two speakers is used when the pair plays alone, and presets keep working.
- **Side Pane:** the clock's first digit is no longer cut off at the left. Security at Less fits on one line: the state, with what is open or unlocked at its right.
- **Room pages:** their tall tiles are always the Home app's tall pill. The Centered tile style is the Home Grid's alone.
- **Camera block:** the snapshot's time badge sits evenly in its corner.

## 1.25.0 - 2026-10-31

- **Side Pane Clock, Under the Time:** at More, a strip the clock's width under the time: Next Hours, the Sun (the day's arc from sunrise to sunset with the sun on it), the Moon (tonight's, drawn, and when it is next full or new) or Conditions (sunset, wind, humidity, UV). Sunset beside the date stays the default.
- **Side Pane Clock, weather beside the time:** the time and the temperature share a baseline, and so do the date and the sky. A right-aligned time has the weather at its left. At More the sunset is a line of its own. When Tapped opens the Weather page.
- **Side Pane:** the room under the last section matches the sides.
- **Home Energy over the Forecast:** the whole screen is blurred behind it, the sky as well as the land.
- **Music block:** Plays On lists the house's speakers and speaker groups.

## 1.24.1 - 2026-10-31

- **Music First over the Forecast:** the time, the date and the weather show in the corner again while the music covers a Big forecast or its details (they were hidden unless the Forecast's Layout was Classic).

## 1.24.0 - 2026-10-31

- **Glyphs at HomeView's size:** Centred tiles draw their glyphs about 15 % larger, near Apple's (about 30 % of the tile). Square cells are now recognised however small they come out (beside the Side Pane on a 1280 x 800 tablet they had the shorter tile's smaller glyph), which also fixes the calendar, camera, timers and weather blocks there.
- **Side Pane:** the Clock can show the weather beside the time, as the menu's header does (Beside the Time). The calendar lists events under their day (Today, Tomorrow, the weekday) with only the time under each. The space above the time matches the space at the side.
- **Screensaver:** Big Weather's big number can be the temperature or the time (Big Number), and it now stands on the landscape's ground with a soft shadow. Home Energy over the Forecast blurs the landscape behind it. Time Behind has Time Size, Time Height and Darken.
- **Music block:** Presets is now Playlists, and a Plays On option picks the speaker or speaker group a tap plays on.
- **Fixes:** the radar's full-screen X is clear of the iPhone Duo's side strip; the Music page no longer says "Could not open that: no client" while it connects; the camera block lands exactly on each camera instead of a few pixels to the right; the Pages screen fades in once laid out instead of jumping; More's Calendar shows its glyph in the list, and its date sits upright and centred in the icon.

## 1.23.0 - 2026-10-31

- **Covers and faces that fail:** never the broken-image "?". A cover that can't load shows the music note (never the previous song's art), a person keeps their last good picture, and an unavailable player shows its placeholder.
- **Backgrounds in any colour:** one combined picker holds the Wallpapers (Ribbons, Petals, Shards, Pinwheel) and the six motion themes, with one Color list and Motion under it. The Clock screensaver uses the same picker.
- **Side Pane clock:** Face, Alignment (Left, Center, Right), Text Size, Weight, AM/PM, Flashing Colon, Date and Second Line, on All Screens or per screen.
- **Side Pane Now Playing:** an Album Art Background switch, and When Tapped opens Speakers, Volume, Browse and Queue in place or flips to the controls.
- **Side Pane Camera:** the still loads and refreshes every 10 seconds, with a Name option (hidden by default).
- **Music block:** a Shows option (Recently Played, Presets or One Playlist). **Live TV block:** pick its channel; on bigger sizes the channel's mark and name grow.
- **Small Now Playing's Speakers sheet:** the group's volume above each room's.

## 1.22.0 - 2026-10-31

- **Motion themes:** six new animated Wallpaper backgrounds (Aurora, Beams, Blobs, Dots, Meteors and Waves), each in any colour you pick, with presets; still under Flat or Reduce Motion. The Clock screensaver's Background offers the Wallpapers and motion themes too.
- **Every block does something when tapped:** each Home Grid block opens its sheet or its page, with a When Tapped option.
- **Card picker:** every block is listed (To-do, Energy Rings, On Now and the rest), each size chip previews that size, and a card with no room can be dropped over the blocks it replaces, with Undo.
- **Names you give accessories win everywhere:** Security's Recent Activity, Left On, the Doors and leak lines, On Now and the Side Pane. A new **Also rename in Home Assistant** switch under an accessory's name renames it there too (the name only, never the entity id).
- **Music:** playing a song, album, artist or playlist from Browse replaces the queue, as Apple Music does, and only counts as started once the new music plays.
- **Day screensaver:** the corner clock and weather stay clear of the day and date, leaves fall and bats fly, the corner clock keeps its own minute, and the weather icon takes the face's dark ink.
- **Layout fixes:** banners centre on the whole screen, over a Side Pane's edge too; the header's clock glow and chips' shadows are no longer clipped; sideways rows run under a side rail or the iPhone Duo's strip to the screen's edge; the Pages screen's Rooms folder has a proper top inset and, on a phone, is as wide as it can be with names on two lines; a camera block's name can be shown or hidden.
- **Settings, Advanced:** the font and glyphs are checked in Your Files instead of reported Missing, and Show in Sidebar appears only in Home Assistant.

## 1.21.0 - 2026-10-31

- **Home Grid blocks as widgets:** every block is redrawn after the HomeView widget mock-ups, at each of its sizes: Calendar (Small, Tall, Large, the month at Extra Large) and a new **To-do** block; the Thermostat's Big Number and its modes; Weather (Wide shows the next hours); Now Playing, Recently Played and Live TV; Timers (the ring is the pause, with a red Stop); Who's Home; the Vacuum's big keys and rooms to tick; Doors, Security, Power, Water and Battery; and new **Energy Rings** and **On Now** blocks. Scenes and Accessories gain Height and Color; every control reaches a finger's 44 px.
- **Edit mode on the Home Grid itself:** drag, resize, remove and add blocks right on the dashboard.
- **Centred tiles** draw their glyphs bare and large, as HomeView does; an Accessory block says its chosen Line Under Name.
- **More and Rooms** in the tab bar are app icons in their colours, in a bigger sheet on a tablet.
- **The Side Pane:** Now Playing at Less is a mini player (Speakers and Browse beside its volume) and at More shows the song's progress; Security says only what is open; Who's Home is spread evenly; its Clock is lined up.
- **Screensaver:** Time Behind's weather is back in the top-left corner; Clock's time is bright over a dimmed photo; light faces such as Day use dark ink; the Day art moves gently (still under Flat or Reduce Motion); the Forecast's corners no longer overlap.
- **Settings previews:** the screensaver preview is the screensaver alone at the screen's size, each change shown as it is made, without reloading a dashboard; the Appearance pages preview the look with a few of the screen's cards; All Screens' Appearance and Side Pane pages get previews too.
- **Choices as pictures:** the clock's Background, the Day face's Look, the Forecast's Layout and the sky's Backgrounds are picked from little previews.
- **Fixed:** an accessory's page opened straight from search (a renamed accessory, for one) waited for its data instead of saying it couldn't load; a block pager comes to rest exactly on its page.

## 1.20.0 - 2026-10-30

- **Time Behind, one place for the time:** the time is always upper centre, the same spot and size on every photo; the photo's subject comes over it only where it covers part of the time, otherwise the time is in front. The weather sits under the time, centred, instead of beside it; on a phone it fits the screen, and the photo's title and what's playing no longer overlap.
- **Home Grid blocks, tidied at all five sizes:** every block now has the same inset from its edges (14 px on tiles, 18 on square cells, more in a Square screen's corners), pills inside a block follow its corners, and blocks with fewer things than spaces fill themselves instead of leaving empty rows. Fixed: the Thermostat XL dial running out of its column, the Tall clock's AM/PM cut off, the Scenes block's extra bottom space, the Vacuum L/XL card stuck at the top of its block, Now Playing Tall's corner buttons, and Weather XL's two columns not lining up.
- **The Vacuum block on square cells (HomeView)** reads like the blocks beside it: round controls at the top, the name and "Docked · 92%" at the foot.
- **A button added among accessories** (button or input_button) gets a second line, "Tap", like the accessories beside it.
- **The Side Pane's lists give way:** where the pane is short, the Calendar, To-do, Timers, Climate and Notifications get shorter and scroll inside, down to their heading and one row, before any section shrinks or is left out.
- **The Pages Screen** opens at its size with no animation, so it no longer jumps.
- **Photo Titles and Time Behind only where the photos show:** left on from Photos, they no longer carry over to Clock on soft photos, the Forecast, Glance, Month or Day; on Clock over sharp photos the Screensaver page now offers both toggles.
- **Settings tidied:** All Screens and each screen's page are in one order, with fewer one-row groups; Now Playing Options and the Side Pane's sections have pages of their own; the Screensaver page keeps one layout for every Show; "Same as All Screens" reads the same way everywhere. No setting changes.

## 1.19.0 - 2026-10-30

- **The new screensaver Shows work:** Glance, Month and Day were shown as photos, and Big Weather, Photo Titles, Time Behind and the Day face's look were ignored; they now reach the screensaver.
- **The Side Pane draws the same everywhere:** its dividers no longer come and go, its data (the weather above all) stays instead of disappearing, and it keeps its Width on every page.
- **Section Headings** (Side Pane, On by default): a title over each section except the Clock and the Weather. Each section can sit at the **Top or Bottom**, and has a **When Tapped** (its page, its sheet or nothing); tapping an event, a person, a lock or a thermostat opens its own sheet. Less, More and Full show more at each size, and the pane's player has Speakers and Browse again.
- **The Pages Screen:** no giant clock behind the icons unless you choose **Background Clock**, a lighter blur, icons that come in as Launchpad's, and a Weather icon showing the sky for the weather.
- **Columns use the width:** more columns extend a square grid at the same tile size until the width runs out; the editor says how many fit at full size.
- **Bright Glass On:** Home Only (the default) or Every Page. The album-art pane evens out dark covers, and a Security block keeps its own layout on square cells.


## 1.18.1 - 2026-10-30

- **The Side Pane takes the album art while music plays:** the whole pane becomes the song's blurred cover, edge to edge, with its other sections on it; it fades to the next song's cover, and back to the screen's glass when playback stops. The music section no longer sits in a box of its own. The screensaver's pane does the same.

## 1.18.0 - 2026-10-30

- **Looks:** eight complete setups for a screen (HomeView, Flat, Performance, Holiday Whimsy, Active Weather, Calming Backgrounds, Night & Bedside, Photo Frame), each setting the colours and accent, the background and sky, the tiles, the Side Pane, swiping, the screensaver and a layout for the screen's shape. A screen's **Looks** page in HK Settings lists every change as was → becomes; **Layout + Look** in the Home Grid editor sets the layout too; one Undo puts it all back.
- **Square tiles look like HomeView's by themselves:** Tile Style **Automatic** (the new default) centres the icon above the name on square cells and keeps the Home layout elsewhere. Square grids offer **2 to 6 columns**.
- **Wallpaper Motion:** Off, Slow, Medium or Fast; it stops when hidden, under the black screen and with Reduce Motion.
- **The Side Pane** takes the screen's glass (blurred in Blur and Bright Glass), has no headings (a thin line between sections) and a live preview on its settings page.
- **Bright Glass sheets and pop-ups** are readable over every wallpaper: a deeper tint, the page dimmed behind, room icons in white circles.
- **Fixes:** text in a square screen's corner tiles is no longer cut off; the shared blur behind each tile matches its corners; Big Number marks the setpoint with a dot, with a smaller dash and room for the name.
- **Music: stereo pairs.** A room whose speaker is a Music Assistant group (two HomePods panned left and right) is one room, and HK Settings says so under Speakers. A preset's rooms are read from its group in Music Assistant, so a pair plays in Everywhere or Upstairs; a group holding only half a pair is marked Check.

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
