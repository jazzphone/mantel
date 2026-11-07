# Changelog

## 0.1.147

**Added**
- **A Now Playing page.** The screensaver’s interactive music slide is also a full-screen page, with time, date, weather and home status in the corners. Choose Now Playing under Swipe Right on Home to open it with a swipe; beside a Side Pane, Up Next appears beside the cover.
- **House Status, a Home Grid block.** It shows the screen's status chips in HomeView's look: Climate, Timers, Power, Lights, Security and the rest, each with its reading and, at larger sizes, where and what. Each section opens its own page. "+N more" and the Small size open a House Status sheet with all of them, in two columns of panels on a tablet and in rows on a phone. It follows the screen's Status Chips (which chips, their order, Always or When Active) even when the chip row is hidden. Alerts come first, and a sensor that hasn't reported shows no reading rather than zero. Add it from Info in the Home Grid editor.

**Fixed**
- **Long room names on the Intercom sheet end in "…"** instead of being cut off, such as "Primary Suite …". The whole name is still what VoiceOver reads.
- **Home and Pages settle with one tab-bar movement.** A Home-only Side Pane no longer makes a full tab bar widen or rearrange its tabs after a page swipe lands, including when Pages is opened first.
- **Quick tab taps pick up the moving highlight where it is.** Choosing another tab during its animation no longer jumps the highlight toward the previous destination before changing direction, including at the end tabs where the highlight has different margins.
- **The tab highlight follows swipes into More's pages**, and back to the visible tabs.
- **A page swipe no longer stalls as it lands.** The tab bar, the menu, the Side Pane, the Now Playing bar, the Calendar and the sky each reacted to the landing by measuring the page between each other's changes; they now do it once, in the frame. On a slowed (4x) CPU, landing from the Pages screen on Home went from about 220 ms of blocked main thread to 80 ms, and a Bright Glass landing from 120-165 ms to 80-90 ms.
- **Moving between Bright Glass and its Blur (Home Only) no longer redraws every card** on the page and the two pages waiting beside it.
- **The Side Pane and the tab highlight finish a swipe in step with the page**, rather than a frame ahead of it.
- **The Side Pane keeps its blur while it fades** in a swipe between Home and the Pages screen. Faded as a whole, it showed the page behind it sharp through a flat tint (Chromium; the wall tablets).

**Changed**
- **Every music player has the same bare controls.** The screensaver's music slide, the Side Pane's player, the Home Grid's Now Playing blocks, the Now Playing card, the Play Music page and the speaker sheet lose the circles behind their buttons, and the icons are bigger instead. Speakers and Browse sit lighter at the ends of the row, lined up with the progress bar. A button whose panel is open still lights up.
- **The progress bar and the volume sit the same distance from play/pause** in every player. Before, the volume sat closer to it than the progress bar did.
- **Progress and volume bars are white, as on the screensaver,** instead of purple: white on a quiet track over the cover, and the look's own ink on a plain card. The Side Pane's volume now fills up to its level, and the speaker sheet has a small and a large speaker either side of its volume.
- **Up Next beside the cover.** When the screensaver's music slide sits beside a pane, the next songs are listed under the song, as many as fit beside the cover; a tap opens the queue.
