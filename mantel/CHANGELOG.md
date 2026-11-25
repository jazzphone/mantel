# Changelog

## 0.1.170

**Changed**
- **New designs for every Home Grid block**, all drawn from one kit: Home and Room (from Wide up, the top of Apple's Home app, with glass buttons over the picture), People (a cluster of faces), Calendar (the month on Large, the month and the day on Extra Large), On Now, Recent, House Status, Laundry, Doors & Locks, Weather, Clock (Extra Extra Large with the calendar), Thermostat Extra Large, and Battery and Energy Rings. Card Design is no longer a setting.
- **Live TV shows each channel's show** with its art at every size, and the channel's logo as a small mark on the picture.
- **The Pages screen scrolls up and down**, keeps the sky it blurs, and lines widgets up with the icons. **Everything** on a screen with no menu opens the Pages screen.
- **The Music sheet is wider and taller.**
- **The tab bar matches its screen's glass**: on a Clear, Tinted or Frosted screen, a Same as Screen bar wears the same surface as the cards (it was blurred, near-black, or a solid gray). Clear is now a Tab Bar Glass choice of its own, and every glass bar marks the page you're on with a white pill.
- **The regular glass tab bar looks like Bright Glass inside**: a lighter, brighter inside and a solid white highlight on the page you're on, with its own blur and soft edge.
- **A Small, Wide or Tall thermostat in Auto lets you pick Heat or Cool**, as Large does: tap a temperature to pick it (a dot appears under it), and the arrows change only that one. They used to move both together.
- **Every card's text now has the same soft glow behind it**, so words read the same over the sky or a background whatever the card. Before, some cards had it and others didn't. Dark words on a white tile or button never have it, and Flat has none. **Text Glow** (Appearance → Advanced, on by default; a screen can choose its own) turns it off.

**Fixed**
- **Now Playing's Background works again** (Blurred Album or Card).
- **An Apple TV that still says paused behind a TV that is off counts as asleep.**
- **The Side Pane stays with its page through a fast swipe**, and no bare sky flashes between Home and the Pages screen.
- **The Intercom sheet's talk side keeps its place** in every state.
- **Tab Bar Dim's "Dim Same as the Glass" switch stays off when you turn it off**, so its slider appears. It sprang back on.
- **A Bright Glass tab bar on a Clear Glass screen no longer blurs live** when Bars & Side Pane is Pre-rendered: it wears the pre-rendered picture like the rest of the bars, so falling leaves and rain no longer move behind it.
- **The glow behind card text no longer shows a hard-edged band** under names, states and labels. The glow is now tighter, so it fits inside each line of text instead of being cut off at its edge.
- **A pop-up menu in Settings on an iPad closes once you pick.** After a choice that redraws the page (a wall tablet's Renderer, say), the menu used to stay on screen: a pick in it did nothing, and the next tap anywhere only closed it, so a switch tapped then didn't change. An open menu also keeps working while a Wall Tablets page refreshes under it.
- **An Intercom message plays in step in every room, even when rooms have different volumes.** Rooms at different Intercom volumes used to play as separate groups, a few seconds apart. They now play as one group, each at its own volume.
- **An Intercom message over music from Siri, the Music app or a HomeView plays in step.** Each room playing that music used to start the message on its own, seconds apart. Those rooms now join the message's group, like idle rooms. With ma-airplay-groups 0.3.16 or later, the music no longer jumps to the announcement volume before the message.

**Added**
- **Live TV on an Apple HomeView or another AirPlay screen**: pair it under Live TV → AirPlay Screens, then **Play On** in the player sends the channel there. A paused show ends once nobody is watching its stream.
- **Live TV plays in Apple's own player in Safari** (iPhone, iPad, HomeView: full screen, picture in picture); other browsers keep the low-delay player. A channel opens from its address.
- **For the Mantel iPhone app**: its widgets read Mantel (accessories, Energy and Power, Energy Rings, Laundry, Live TV, a reading's graph), and the phone can play as a Music Assistant speaker for CarPlay and a HomeView.
- **Opens On** (Settings → Pages Screen): a screen can open on its Pages screen instead of Home. That page is then the screen's Home: Back, the idle return and every way Home land there.
- **Apple HomeView**: Mantel in a HomeView's Safari is laid out like a large iPhone, kept clear of Safari's buttons, with a Square grid's bottom corners following the display's and the Apps page's icons three across.
- **Sheets side by side on a short screen** (a HomeView, a phone on its side): the main control on the left, everything else beside it, with Now Playing and the speaker picker laid out the same way.
- **Home and Room: a Background option**, Apple's soft wallpapers or None.
- **Camera: Live or Snapshots**, and Cameras as a mosaic.
- **Side Pane Section Headings** for the screensaver's pane, apart from the Dashboard's.
- **Tab Bar Dim** (Appearance → Advanced): Same as the Glass by default, or a slider up to 60 % to darken the tab bar in any style.
