# Changelog

## 0.1.168

**Fixed**
- **The Side Pane's calendar could stay on "Reading the calendars…"**: a read that got no answer (or failed) was asked again only at the pane's next draw, and a quiet pane is drawn only when something it shows changes. It now asks again by itself after 30 seconds until the events come.
- **In Flat a page swipe didn't fade the background**: each page's own ground (its accent's tint, or a chosen color) was painted for the next page with the colors of the page you were on, so the fade went from one color to the same color and the new one cut in as it landed. The next page's ground now fades in with the finger, as in the other looks.
- **In Flat a swipe to the Pages screen could show a blurred background that popped away as it landed**: the swipe could draw the Pages screen's blur from an answer it got before the screen turned Flat or had drawn. Flat now has no blur there at all -- not in a swipe, not behind the Rooms folder, not behind an open folder.
- **In Flat Light each speaker's glyph sat in a gray square** in the Music page's Speakers panel: Light still painted the well the panel dropped when it went the AirPlay way. The glyphs stand bare now, as in every other look.
- **The screensaver wears no Appearance**: under Flat it put Flat's ground behind everything and changed its own options -- photos weren't drawn (a Flat Light screen showed white words on a light ground), the clock was Classic on black, the forecast had no sky and nothing faded. It is now the same in every look; Motion still decides what moves on it.
