# Changelog

All notable changes to Mantel are listed here. Versions follow [semantic versioning](https://semver.org); the Home Assistant App, the Docker images and the Python package share one version number.

## Unreleased

## 0.1.141 - 2026-11-06

**Changed**
- **A sideways swipe goes on past the tab bar's last tab** to the pages under **More**, in More's order (room pages still have none), and each screen's **Swipe Right on Home** (Settings → the screen → Menu → Gestures) can put one of its pages before Home, such as Music for the player full screen.

## 0.1.140 - 2026-11-05

**Fixed**
- **Siri and Shortcuts' Volume Up and Down set every room of a group.** With music playing on several rooms, they moved only the first speaker. Needs the next TestFlight build.
- **The iPhone and iPad app's Music slider shows a group's volume as its rooms' average,** as the web's sliders do; it showed the first speaker's. Needs the next TestFlight build.
- **Every room an Intercom message is sent to is called or really reached.** Just before sending, Mantel checks with Music Assistant that each group still holds the rooms it is to play in; a room it wouldn't reach gets its own call. (In 0.1.134 a message to nine rooms played in two while the log said it had gone out.)
- **The Intercom keeps why a room didn't play.** Each broadcast with a room that failed Live or the message, or was left out, gets an `intercom.failures` row in the audit log beside its own: the rooms and the reason, never what was said. Mantel's own log starts again at every update.

## 0.1.139 - 2026-11-05

**Fixed**
- **A camera's pop-up lists what the Timeline saw.** Under the picture, **Recent** said "Nothing recorded for this camera yet" for cameras whose people, animals and rings were on the Timeline page. The Home page's tile shows a camera's low-resolution channel, and the Timeline keeps its events under another of the camera's entities, so the two never matched. Recent now lists every event of that camera, and says it has none only when there are none. On a phone, its first event no longer starts under the pop-up's edge.

## 0.1.138 - 2026-11-05

**Fixed**
- **The screensaver's volume works on a group.** With music playing on more than one room, its slider moved only the first speaker and sprang back. It now shows the rooms' average and sets every one, as the Side Pane's does.

## 0.1.137 - 2026-11-05

**Changed**
- **The Intercom has a new look.** A big round talk button, like the Lock's, with the rooms it talks to beside it (under it on a phone): how many are picked, **Clear All**, your groups, then each room with a check. The button turns red while you record, shows the time and fills its ring toward the limit; in Live it turns green. After a message is sent, the button is back at once: "Sent to 2 rooms" with **Play** and **Send Again** stays under it for a few seconds.

**Fixed**
- **The Side Pane's volume works on a group.** With music playing on more than one room (a preset such as Everywhere, or rooms grouped), the slider moved only the room leading the group, then sprang back. It now sets every room, as the player and the music panel do, and shows their average level.
- **The music panel's Browse shows each playlist's cover.** The flipped-over music panel (Speakers, Volume, Queue, Browse) now shows each playlist with its cover, as the Music block does, and a playlist without one gets its glyph on a tile the same size. Names run to two lines instead of being cut off ("Your Essentials", not "Your Essent…").
- **The music panel's background is blurred.** It was the cover shrunk to 32 pixels and stretched, so large shapes and lettering on the cover still showed through. It's now blurred properly, on the screensaver's music pane too. Bright Glass had nothing to do with it.

## 0.1.136 - 2026-11-05

**Fixed**
- **Two speakers of one room played a message one after the other.** The Office's two HomePods, still grouped from music, each got the message in turn, 12 seconds apart. Picking any room in a group left from music now borrows that group, so the room's speakers play together.
- **Rooms borrowed from a group left from music played on their own.** A speaker in a group says it can't group with anything, so the borrowed Kitchen and Guest Bedroom each played alone. Borrowed rooms at the same volume now play as one.
- **Tap to Record missed your first words.** The page started the microphone only when you tapped, and it took about a second to start. Where the browser already allows the microphone, it's now ready as the Intercom opens, so recording starts the moment you tap. Nothing is recorded or sent until you tap, and the microphone turns off when you close the Intercom. On an iPad, its microphone light shows while the Intercom is open.

## 0.1.135 - 2026-11-05

**Fixed**
- **The Intercom reached only two rooms of a group left from music.** In 0.1.134, borrowing a leftover group still counted it as one group, so a message to its rooms played only in its leader's room (and any room outside it), while the sheet said "Sent to 9 rooms" and still showed "Plays with …". Every picked room now gets the message.

## 0.1.134 - 2026-11-05

**Added**
- **Now Playing can have the card background.** A Now Playing block has a new **Background** option: **Blurred Album** (the default, as before) or **Card**, which gives it the same background as every other block in the screen's look, with dark text on a light look.
- **Every card in a block with rules has its settings.** Choose a block that switches cards, such as Music with Now Playing while music plays, and the Home Grid editor opens on the card that's showing. **Settings For** picks which of the block's cards you're setting: its own or any rule's. Each one gets all the Content and Appearance options it has as a block of its own, and the preview shows the card you pick. Each rule also has a button that opens its card's settings (**Edit Now Playing Settings**, say). Before, the editor showed only the block's own card, with a rule's options tucked inside the rule and no Appearance options for it.

**Changed**
- **A group left from music no longer limits the Intercom.** After music stops, its speakers stay grouped. Pick one of those rooms alone and only that room hears the message: Mantel briefly takes the other speakers out of the group and puts them back, in their order, when the message is over. Pick rooms both inside and outside the group, and they all play in step on one clock. This happens only when every speaker in the group is idle; a group that's playing or paused still plays only together.

**Fixed**
- **Now Playing no longer flickers in Safari.** Rectangles of the blurred album behind the player flashed lighter and darker every second as the time and progress bar moved, and when the pointer crossed the controls. The blur now sits on a layer of its own and is drawn once. The docked music bar gets the same fix in Safari only, so a wall tablet's scrolling stays as smooth as it was.
- On Home Grid's Now Playing blocks, the Speakers glyph sat up to 2 px low in its circle (Small, Wide and Tall). It's centered now.
- **"Sent to" counts the rooms that heard it.** A message to nine rooms through a group said "Sent to 2 rooms".
- **The music players showed "Now Playing" during a Live talk's replay.** When Live didn't work in a room, the room reappeared on the music players before its message played.
- **Part of a recording could be dropped** when Wi-Fi delivered a few seconds of audio at once. Mantel now accepts up to 4 seconds arriving together.

## 0.1.133 - 2026-11-05

**Fixed**
- **Live to speakers still grouped from music played nothing.** After music stops, its speakers stay grouped. Live now plays straight away on a group like that when it's idle and every speaker in it is picked. If it has to wait until you finish, the message now plays then; before, the last check dropped it and nothing played.

## 0.1.132 - 2026-11-05

**Changed**
- **Rooms hear Live in step.** Idle rooms at the same volume now play Live as one group on one clock, as a Message does, and starting one adds nothing to Live's delay. The rooms that hear the message when you finish play in step too. If a group doesn't come together, each room plays on its own as before. If its leader fails, every room in the group gets the whole message when you finish, so nothing you said is lost.

**Fixed**
- After a temporary group fails, a speaker still leading another speaker is no longer called on its own, because the message would have reached that other speaker too.

## 0.1.131 - 2026-11-05

**Changed**
- **Rooms hear a Message in step.** Idle rooms used to start a fraction of a second to a second apart, each on its own AirPlay session. Now Mantel groups them for the message, plays it once on the group's one clock, and puts every speaker back. If the group doesn't come together, or its leader doesn't answer, each room plays on its own as before, so a message is never lost. Live still plays per room.

## 0.1.130 - 2026-11-05

**Changed**
- **The music players ignore the Intercom.** While a room plays a message, the Music card, Side Pane, slide-up player, screensaver and iOS app no longer show it as playing "Announcement" or flash the last song. A room playing music keeps its song and cover on screen while the message plays over it. This doesn't depend on **Ignore Announcements**: a message is never music.

## 0.1.129 - 2026-11-05

**Added**
- **Touch and hold empty space to edit a page.** Hold an empty part of a page (between the tiles, or below them) for half a second and it goes into Edit mode, the way the iPhone's Home Screen does. It works wherever **Edit Page** is offered (Owners and Admins, never on a wall tablet). Holding a tile still does what a tap does.
- The **Timeline** page has a background of its own, a copper gradient beside the Timers page's orange, instead of the Live Sky.

**Changed**
- The **Timeline**'s **Day** button opens a little month like the Calendar page's, in place of the browser's own date picker. Days after today can't be picked.
- The iPhone and iPad app keeps Mantel's scripts, styles and fonts on the device between opens, so opening it after iOS has closed it no longer downloads them all again. You still sign in to the page each time the app starts, as before; **Clear Cache**, **Sign Out** and **Forget This Mantel** remove them. Needs the next TestFlight build.

**Fixed**
- The page beside the one you are on no longer shows: on Home with the Side Pane, the Pages screen showed through the pane, and the Calendar could sit over the right side of the Pages screen. Pages waiting beside this one now wait out of sight, and are laid out again when the page's size changes, so the Calendar no longer jumps half a second after it lands.
- Swiping to a page with another look no longer switches looks as it lands: coming from the Pages screen (Bright Glass, Home Only), the Calendar wears its own Blur glass all the way in. Its background fades in with your finger too, rather than only after you let go.

## 0.1.128 - 2026-11-05

**Changed**
- **The Intercom has a volume of its own.** A room on Automatic plays at the Intercom's **Volume** (Settings → Intercom, 40% to start), whatever its speaker was left at; a room can still have its own. Before, Automatic followed the speaker, so a HomePod left at 2% played your message in a whisper after a loud chime. Each speaker goes back to its own volume afterward.
- **A Message sends as soon as you stop recording**: tap, talk, tap. Play and Send Again are there afterward. With no room picked, it waits for you to pick one.
- **Live is push to talk**: hold the microphone while you talk and let go when you're done. A tap too short to say anything says "Hold the button while you talk".

**Fixed**
- Live lost its first two seconds: what you said while Mantel asked Music Assistant about the rooms came in a burst that was dropped.

## 0.1.127 - 2026-11-05

**Fixed**
- **An Intercom message to several rooms played in one room only.** A Music Assistant sync group of the speakers (such as "HomePods") made Mantel think its first speaker led all the others, so the message went to that speaker alone and the sheet said "Plays with … +N" for a room playing nothing. Every room picked now plays it.

## 0.1.126 - 2026-11-04

**Fixed**
- **The Intercom said "Microphone blocked" with the microphone allowed** (Safari on a Mac, the wall tablets, the app). Its audio processor was loaded in a way Mantel's page security refuses; it is now a file Mantel serves.
- **The doorbell's live talk** loads its audio processor the same way, so on Mantel it can talk live again instead of falling back to a recorded clip.
- **The Intercom sheet's room buttons:** a room that leads a playing group says one room and a count ("Plays with Guest Bedroom +4") inside its button, instead of a long list that ran over its neighbors and let the sheet slide sideways on a wall tablet.
- **The iPhone and iPad app** allows the microphone on the house address it opened (from the next TestFlight build).
- Swiping between pages shows the page you are going to, every time: a page not visited yet came in as its title on the sky and every page did on a tablet flagged as slow. The page on either side is made ready at a quiet moment and waits beside this one.
- A new swipe while a page was still settling no longer strands it off screen. It was blank for five seconds with touches ignored, and rapid flicks could leave it there until you changed page. A finger on a moving page now simply catches it.
- Letting go of a page carries on at the speed your finger was going, from where it was, instead of leaping away on one fixed curve; a flick back goes back, however far the page had gone. Home Grid views, blocks that swipe their pages and the side menu let go the same way.
- Reduce Motion: the two pages cross-fade, instead of the old one fading to the sky and the new one fading up after it.
- Swiping is steadier on slower tablets: nothing is put on the page or measured under the finger any more, and a Home Grid's views no longer restyle everything inside them on each move.

## 0.1.125 - 2026-11-04

**Added**
- **The Intercom on the Home page.** Add an **Intercom** chip (it shows the first room you picked, "Living Room +1") in All Screens → **Status Chips**, or an **Intercom** pill in a screen's **Scenes**, each under **More**. A tap opens the Intercom; a page that shows neither loads none of its code.

**Changed**
- **The Intercom's block and sheet, redesigned** to match the other blocks and sheets. Small and Wide look like their neighbors in both the standard and HomeView looks and use their whole space. The sheet groups its targets (Whole House, floors, presets) above the rooms, every button one width, no duplicates (a preset with the same rooms as the whole house or a floor isn't listed twice), and says in words why a room is left out ("Plays with Office", "Quiet hours").
- The Intercom says why it can't record: the microphone is blocked (and where to allow it), there's no microphone, another app is using it, or the browser couldn't start.

**Fixed**
- A screen with Automatic off can add the **Timeline** page to its menu (Pages on This Screen) and as a pill in its Scenes row, under **More**.

## 0.1.124 - 2026-11-04

**Added**
- **The screensaver's Date, your way.** In the screensaver editor, the Date piece takes two lines (the weekday over the date, lined up with its corner, or centered), a short or numbered month, the year or not, a short weekday or none, a light or bold weight, and all capitals. As it comes it reads as before. See [Screensaver](docs/guide/Screensaver.md).

**Fixed**
- After Home Assistant restarted, Mantel could stop answering for minutes (every screen and Mantel Settings frozen) when it reconnected while Home Assistant was still starting: each of the thousands of first states made it work out the notification categories again over every device. It now does that a few times for the whole burst.

## 0.1.123 - 2026-11-04

**Added**
- **The Intercom: talk into rooms.** Speak a message into one room, several or the whole house through the speakers Music Assistant plays on, from the Home Grid block **Intercom** or its sheet, on a wall tablet, a phone's or iPad's browser (over https://) and, from the next TestFlight build, the iPhone and iPad app. It's one-way, a message at a time; Live (talking as you speak) stays off for now. A wall tablet in a room with no speaker can play it itself. Mantel Settings → **Intercom** turns it on (off by default) and each room (every room off until you turn it on); it also needs Allow Control of the House. See [Intercom](docs/guide/Intercom.md).
- The Intercom's stream port, for Music Assistant to fetch the message: 8767 on Docker and the Proxmox LXC (compose.yaml publishes it; the LXC's `update` picks it up, no `.env` change), 8101 in the Home Assistant App (its Network section). The server takes `--stream-port`.
- Proxmox LXC: `update` accepts `MANTEL_UPDATE_REF=<commit or tag>` for one update to that target, without pinning the container to it (`MANTEL_UPDATE_REF=v0.1.121 update`). Without it, `update` follows the newest release (or `mantel.ref`) as before.

**Changed**
- Who may see what, tightened: the server's statistics (`GET /api/stats`) are for Owners and Admins only; a person who doesn't manage the house sees only the areas with something they may view; another person's sessions and apps can't be managed from a wall tablet; an assistant can test an alert channel only from the home network.
- Mantel won't start if one of its routes isn't declared in its route table (a programming error, caught by the tests; you won't see it in a release).
- Docker and the LXC: the arm64 images are built natively on arm64 runners, not under emulation, so a release reaches you sooner. The images are the same; nothing changes for you.

## 0.1.122 - 2026-11-04

**Added**
- **The House Timeline: what happened at the house.** One scrolling, searchable record of doors and locks, arrivals and departures, the alarm, the garage, the doorbell, what the cameras saw (person, vehicle, animal, package, with two pictures from that moment), leaks and smoke, and Mantel's own alerts. It says who did what and from where ("Back Door unlocked · Emma · Hallway tablet"), or "By hand or an automation". Noise is rolled up (a detection is one row, motion one row per 10 minutes, a sensor that keeps changing one row), and what changed while Mantel was off is written at its real time. Open **Timeline** from the Home menu. It starts empty today: there's no fill-in from Home Assistant's history. See [Timeline](docs/guide/Timeline.md).
- **Who sees what** follows the roles you already have: Owners, Admins and Adults open it (an Owner can give it to a Child); each row needs that door, lock, person or camera to be the viewer's; names only for signed-in Owners, Admins and Adults; Mantel's alerts and refused commands for Owners and Admins only. A wall tablet with nobody signed in shows the last 12 hours of doors, locks, the garage, the alarm, the doorbell and detections, with no names, no pictures and no search.
- **Keep My Arrivals Private** in Me: your arrivals and departures aren't recorded at all, and the ones already recorded are deleted (Mantel asks first). Children don't have the switch. A removed person's rows lose their name.
- **The morning summary** at 7:00 (from 9 PM; both settings): the house version to the alert channels that turn on **Morning Summary** in the new **House** group (no names, no arrivals, no pictures; off for a new channel), and a personal version to the Mantel apps for people who turn on **Morning Summary** in Me. A quiet night is one line.
- A Home Grid block, **Recent** (Wide, Large, Extra Large): the last rows, and the night's summary from 5 to 11 AM. A camera's sheet shows its own **Recent** strip under the picture.
- **Mantel Settings → Timeline** (Owners and Admins; the Owner changes it): what's recorded (windows are off for a new house), a sensor added by hand, retention (7, 30, 90 days or a year; 30 by default), the pictures' budget (500 MB) and how many per detection, the wall tablets' view, the summary's time and Send Test, and Clear Timeline.
- **Include Timeline Pictures** in Settings → Backups (off by default; the rows are always in a backup). About → Performance shows the Timeline's numbers. Two assistant tools, `timeline_find` and `timeline_digest`, read it as you, never its pictures.

**Changed**
- A wall tablet's session can no longer manage another person's sessions and apps, and an assistant tests an alert channel from home only.
- `GET /api/areas` lists only the areas with something you may see, and `GET /api/stats` is for Owners and Admins.

**Fixed**
- Screensaver: with the time behind the photo's people, the people stay over the time when the minute changes (they dropped behind it and faded back).

**Note**
- Pictures are snapshots: UniFi Protect's public API has no clip export.

## 0.1.121 - 2026-11-03

**Added**
- **Features turn on by themselves when your house has what they need**, once: Music when Mantel is connected to Music Assistant, Clean Areas when a vacuum has a room map, Energy when Home Assistant's Energy settings have a grid meter or devices, and Live TV when an HDHomeRun on your home network answers and Mantel can play it. Mantel has to see the need on two looks 2 minutes apart, and it never turns on a feature a person turned off, including one turned off before this version (it reads the settings history). It sends nothing to the house. You're told under the feature in Mantel Settings → Advanced → Features ("Turned on by Mantel on Nov 4: …"), by the new Info alert **Mantel Turned On a Feature**, and in the settings history and the Audit Log. **Turn Features On Automatically**, at the top of Advanced → Features, stops it. See [Features](docs/guide/Features.md).
- Advanced → Features says what a feature that's off still needs, for example a tuner Home Assistant knows without an address.

**Changed**
- Live TV's first start with Mantel's own go2rtc and a saved tuner turns it on by the same rule: the tuner has to answer, on two looks.
- Live TV reads a tuner Mantel found itself at the home-network address it checked, and doesn't follow redirects. A tuner address you typed is read as before.

**Note**
- Going back to an earlier version after this one turns every feature off until you update again: the earlier version doesn't know the feature settings' new `auto` part.

## 0.1.120 - 2026-11-03

**Added**
- Screensaver: a piece's words can be aligned (**Align** on its page: Auto, Left, Center, Right). Auto lines them up with the piece's side of the screen, so a card on the right ends every line on the right margin, and Now Playing puts its art at that edge. Home Status' card can leave out its **Title** (HOME).

**Fixed**
- Screensaver: Home Status' card with no backdrop puts its words on the margin, as every other card does (they sat a little inside it).
- Screensaver: with the time behind the photo's people, the people over the time fade with their photo. The outgoing ones stayed solid while the rest of the screen changed, then vanished; the incoming ones popped in at the start.
- Screensaver: a whole portrait photo zoomed in (Portrait Photos → Zoom) stays in the middle of the screen. It grew from its faces, so one with them to a side sat off center; it still zooms toward them where it runs past the screen, never showing its edge.
- Screensaver: the slide corner stays clear of each slide's own words: it drops below Big Weather's top lines, the Weather slide's and Home Energy's.
- Docker and the LXC: **Live TV's sound and picture start in sync.** A channel's sound starts up to a second before its picture, and that head start played late: the sound trailed the picture by about a second at first and caught up over 10 to 15 seconds, still a little behind. Both now start together (the first 1.2 seconds are dropped, adding about 0.05 seconds before the picture shows).

## 0.1.119 - 2026-11-02

**Added**
- Screensaver: **the slides' own settings**, in the editor's Slides section. **The Slide Corner**: its time's size (100 to 250 %) and whether it adds the time, the date, the weather and House Status. **Music Full Screen**: whether it shows the room, the album, the progress, the buttons, the volume and Up Next. A change shows at once on the slide **See It** shows.
- Screensaver: the **Today** face's weather can be turned off (**Weather**, beside **What's Playing**, under Face in the editor). A Weather or Music piece is hidden as "shown by the Today face" only while the face shows it.
- Mantel Settings → Advanced → **Features**: every feature with an on/off switch, what it needs and where its settings are. Each feature's own page keeps its Add and Remove (Music's page has Remove too now).
- Docker and the LXC: **Live TV falls back to the CPU when the GPU can't transcode.** The first channel played after Mantel starts is checked on the GPU (about 3 seconds); if the GPU fails and the CPU plays the channel, Live TV uses the CPU until Mantel restarts, and Live TV's status says why (`gpu_failed`). Before, the player retried forever with no picture.
- Music: **Group Leaders** (Mantel Settings → Pages → Music). When rooms play together, one of them leads and the others play in step with it. Choose the rooms that lead (best first) and the **Announcement Rooms** Home Assistant speaks to. Music Assistant plays an announcement to a group's leader in every room of the group, so an announcement room leads only when no other room picked can.
- Proxmox LXC: the install uses the GPU for Live TV only when it's Intel (QuickSync, the only GPU the image has a driver for); an AMD or NVIDIA GPU leaves Live TV on the CPU, with a note saying so.

**Fixed**
- Screensaver: the time stays where Position and Align put it. Measured once as its face first drew, it could sit off center (and push a top corner's piece to the bottom) once the face showed another song or other figures; it's put back on its place by what it shows at every draw.
- Screensaver editor: nothing on the screen overlaps. A piece another one shows stacks past what is already in its place instead of over it, a band shown by the face draws no second box over the corners, and a dotted place's words stay inside it. A dragged piece lands on the place it covers, not only the one under the pointer.
- Docker and the LXC: **Live TV plays.** A channel broadcast in 5.1 surround (most of them) stopped the transcoder at once, because go2rtc's Opus audio for browsers can't carry 5.1; the player retried every two seconds with no picture. The sound is mixed down to stereo now (`packaging/compose/go2rtc/go2rtc.yaml`).
- Sign in with Home Assistant: when Home Assistant refuses (a user that can only sign in from the local network, or an inactive one), the page says Home Assistant's own reason instead of only that it couldn't confirm who you are.
- Docker and the LXC: Mantel's address (`/`) opens the screens, not the developer's page (`/dev`), which the image no longer carries. The Home Assistant App never had it.
- Music: **a pick of rooms is no longer led by whichever room came first.** The rooms arrive in A to Z or tap order, so on 2026-11-02 all eleven HomePods were led by a bedroom's HomePod, the first A to Z, and the announcements Home Assistant sends that HomePod played in every room. A room already playing keeps leading; otherwise the Group Leaders setting decides. A group an announcement room leads is regrouped under another room at the next play.
- Mantel's screens point to where a feature's settings are: its page under Pages (Live TV, Energy, Music; Vacuums for Clean Areas), not a Features section the settings no longer have.
- **Swipe Between Pages, on the wall tablets:** with music playing, the Now Playing bar coming up on a page (the Calendar, say) no longer stops the swipes: they go on under it, as they do under the tab bar. Before, every swipe after it was refused, and on the Calendar each one turned the month instead.
- A swipe on the Calendar turns the page, not the Calendar's month too (its own month swipe still works where Swipe Between Pages is off).
- The Now Playing bar comes up the same way each time you swipe onto a page that shows it, not only the first time.
- Short, quick flicks turn the page every time: the flick's speed was measured low (the lift counted as a stop, and moves a busy tablet handed over far apart counted as none), so a short flick sometimes sprang back.
- A swipe whose starting point a card draws again mid-swipe (the Calendar, as the Now Playing bar makes room) still turns the page; it was lost, mostly in Safari.
- Smoother swipes between Home and the Pages screen on a screen with the Side Pane: the tab bar's place no longer restyles the whole screen on every frame, and the bar's tabs are measured once a swipe, not each frame.

## 0.1.118 - 2026-11-02

**Fixed**
- Mantel's screens and Mantel Settings no longer send you to "HK Settings": an empty Live TV or Music card, an accessory's sheet, the radar map, the room order in Edit mode, an empty Energy page and a refused alarm command now say **Mantel Settings** (where those pages are, under the same names). The YAML Reference's note about Existing Dashboards, which Mantel's Add Screen doesn't have, is left out.

## 0.1.117 - 2026-11-02

**Added**
- **Mantel Link by Mantel's address**, with no name, DNS or proxy in between: `https://<Mantel's address>:8766`, Mantel Connect's own port, with Mantel's own certificate. Pairing (protocol v3) hands Mantel Link Mantel's certificate authority inside Mantel's proof, and the credential sealed under the pairing code, so a look-alike can neither swap the authority nor read the credential; Mantel Link then trusts that authority alone. Mantel's name with a public certificate works as before. Mantel Settings → Connections → Mantel in Home Assistant shows the address with a pairing code. Needs Mantel Connect's port (`compose.connect.yaml`, the LXC install's question) and Mantel Link 0.1.12; HK Frontend linked to the same address uses Mantel Link's.
- Proxmox LXC: **Home Assistant finds Mantel by itself** (Mantel Link's **Discovered: Mantel**): the install turns the network announcer on (`compose.announce.yaml`), and `update` does once for a container installed before it (`MANTEL_ANNOUNCER=off` in `.env` keeps it off). The announcement carries the link address when Mantel Connect's port is on, and a discovered Mantel is linked there, still confirmed with a pairing code.
- **Features on and off on Mantel itself:** each feature's page in Mantel Settings (Pages → Live TV, Energy or Music; Security for the Alarm PIN; Vacuums for Clean Areas; Notifications) has **Add** (and, once added, **Remove** at the foot of its page), saved in Mantel's own settings. They pointed to Home Assistant's HK Frontend before, so a Mantel on Docker or the LXC couldn't turn on Energy, Clean Areas or Notifications at all. Removing one keeps its settings, for adding it again.

**Changed**
- Restoring a backup shows its progress: the upload's percentage, then **Checking the Backup…**, then what it holds (people, screens, wall tablets, photos, files), before you restore it and once it is restored; on First start too. A backup that never reaches Mantel (a proxy's upload limit) says so and where to raise it.
- Docker and the LXC: Caddy takes a backup of up to 4 GB on the two restore paths (12 MB elsewhere, as before), so a backup with photos restores at `https://<address>`; the guide's Nginx Proxy Manager settings now allow it too (`client_max_body_size 4g`).

**Fixed**
- Docker and the LXC: **Live TV** after moving from the Home Assistant App. The App's backup brought it in off (HK Frontend ran it there) and nothing turned it on, so the page said to add it in Home Assistant. Mantel's first start with its own go2rtc and a tuner now turns it on, once.

## 0.1.116 - 2026-11-02

**Added**
- First start: **Restore From a Backup** on the sign-in page of a new Mantel, beside creating the Owner. The setup code, the backup and (from another Mantel, such as the Home Assistant App) its keys file: Mantel checks the backup, restarts with it, and its people sign in as before. No account to make first, and no script on the host.

**Changed**
- Docker and the LXC: **Restore From Another Mantel** works there now. Their keys are read-only, so it used to refuse and point to `restore.sh`; now it keeps this Mantel's keys and seals the backup's secrets again with them (authenticator apps, alarm codes, alert channels, saved connections).

## 0.1.115 - 2026-11-02

**Fixed**
- Proxmox LXC: Mantel follows a change of the container's address (a new DHCP lease, a static address set after the install). It was published only on the address the install saw, so it stopped (with your own proxy) or answered on the old address. The new address now replaces the old one at each start of the container (`mantel-address.service`), on `update` and on `mantel-setup`. The install log no longer says Mantel isn't running when the Proxmox install starts it.

## 0.1.114 - 2026-11-02

**Changed**
- Screensaver: **one screensaver** (phase 13). The editor's starters are **Looks** (Photo Frame, Lock Screen, Forecast, Big Weather, Planted, Clock, Glance, Month, Day, Nightstand): tapping one changes the background and the time and keeps everything you placed; **Start Over from This Look** replaces it all. The right side is always **Look**, **Info**, **Slides** and **Timing**, with no rows that do nothing. Widgets and cards are **pieces**, one per fact, each in a few shapes (Inline, Circular, Rectangular, Card, Band), drawn the same way with the same Size (60 to 200%), Backdrop and Color. The row has one size. One **Ink** for the whole screen (Auto picks black or white from the background, never some of each) and **Color Accents**. Any piece can **Show When** an entity is, is not, is above or is below a value (the mailbox has mail). A fact is drawn once: a face or a slide that shows it hides the piece, and the editor says so.
- Screensaver: **a slide corner** over every slide, adding only the time (in the Look's face and color), the date, the weather and Home Status the slide lacks; the Weather and Home Energy slides no longer draw their own. Slides work over every background. The music slide on a phone or an upright iPad is laid out as an iPhone's Now Playing.
- Screensaver: **the time behind** the photo's subject works with any face and any face option; behind the Landscape's land too, with the time in front where the land would hide most of it. **Planted** is a face on the Landscape. Darken is the photos'. Night Mode, the Day's Art and Soft Photos work with a laid-out screensaver.
- Screensaver: a screen with no saved layout draws the same way, its corners as pieces (Big Weather and Month keep their own faces). Music Full Screen is one choice in the editor and in Settings. The Clock Style pages open the editor.
- Doorbell: talking is push-to-talk done properly. The doorbell's talk session opens with the sheet, so a press is live at once and the first word isn't lost; the visitor stays heard, lowered, while you talk; the button says Connecting, Talking, who else is talking, Can't Reach the Doorbell or Needs HTTPS (it used to vanish on plain http); and only one person talks at a time, everyone else's button saying who. A UniFi Protect doorbell loses the start of every new audio stream, so a pop-up keeps one going between holds and each hold is heard from its first word (0.42-0.45 s press to sound, measured at the door). Needs Mantel Link 0.1.11 for the session to stay open between holds.

**Added**
- **System alerts** (Mantel Settings → Alerts): Mantel tells you when Home Assistant, Music Assistant, UniFi Protect or Mantel Link stops answering, a backup fails or is overdue, a wall tablet goes dark or stops charging, the disk runs low, or a new release is out. Send them to Discord, Telegram, Notifiarr, email, about a hundred services through Apprise, and the Mantel apps. Each channel picks its events and its own quiet hours; holds, one message per cause, batching and retries keep it from nagging; a heartbeat address lets a service outside the house tell you when Mantel itself is down. See [Alerts](docs/guide/Alerts.md).
- Mantel Settings → About → **Updates**: Mantel checks GitHub for new releases of Mantel, Mantel Link and HK Frontend and says how to update this install (the App, the LXC, Docker). **Check for Updates** turns it off. Mantel Link 0.1.11 or newer tells Mantel its own and HK Frontend's versions.
- Mac app: the house's notifications and system alerts in the Mac menu bar app (the push relay needs its Mac update first).
- Proxmox LXC: the one-command install **always starts Mantel**, at `https://<the container's address>` with Mantel's own certificate ("Try it now"), and ends with the address and the setup code. A name on your network, your own domain's certificate or your own proxy can be chosen at the install or any time later with **`mantel-setup`** in the container, which asks, changes the settings and starts Mantel again; a missing token keeps Mantel where it is and says what's missing. Set Up Mantel gains an **Address and HTTPS** step on Docker and the LXC. `update` adds `mantel-setup` to a container installed before it.
- Docker and the LXC: Mantel's own cameras (UniFi Protect, RTSP) play their **low-quality stream on tiles** (the camera strip, the mosaic, the Cameras page, rooms) and their **high-quality stream in pop-ups** and full screen; a Protect camera's medium stream is used when it lacks one of those. An RTSP camera takes a **Low-Quality Stream** and a **Snapshot Address** beside its high-quality one: the stills come from the snapshot address, else the low-quality stream, else the high-quality one.
- Screensaver: **35 more pieces**, a glance catalog like an iPhone's lock screen: Countdown, World Clock, the rest of today's events, Rain Soon, Weather Alert, UV, Wind and Gusts, Pressure, Feels Like, Moon, Sun, Security, Doors and Windows, Garage, Climate, Lights On, Vacuum, Notifications, Package, Who's Home, Grid, EV, Up Next, Playing In, On This Day, Camera, Last Ring, Phone Alarm, Trash Day, Pollen, Appliances, Leak and Smoke, Travel Time, Price and Any Sensor. Pieces that show people or cameras are off until you place them.
- Photos: the day a photo was taken is kept (for On This Day), read from the picture at upload, or from a camera-style file name for the photos already there.
- Docker and the LXC: **UniFi Protect** under Mantel Settings → Connections. Mantel talks to the console itself with an API key (a local user and password as an Advanced option, used by nothing yet), checks the address, the key and the Protect version on Connect, pins the console's certificate and stops on a changed one until an Owner trusts it. Pick the console's cameras by their stills; a camera Home Assistant has too shows once, as Home Assistant's, with **Video From** Direct or Home Assistant. Each camera's own detections (the ring, person, vehicle, animal, package, or motion) become the same notifications, doorbell pop-up and snapshots as Home Assistant's sensors give, never twice; **Notify For** picks them, and **Turn On in Protect** switches on a detection that is off. Mantel talks to the doorbell's speaker itself. Under the Home Assistant App nothing changes: cameras come from Home Assistant's UniFi Protect integration.
- Mantel Settings → **Cameras** (Docker and the LXC): **Add Camera** plays an RTSP camera without Home Assistant in the middle. Type its name, area, RTSP address (and an optional sub-stream) and its user name and password, press **Test** to see a picture from it (or why not: it can't be reached, the login was refused, the video isn't H.264), then add it. The login is sealed and never shown again; leave a box blank to keep it. **Notify For** links the camera's Motion, Person and Doorbell to any Home Assistant binary sensor or event (Frigate's, say), so a notification on one carries the camera's picture and a Doorbell link shows the doorbell pop-up. Owner or Admin only, with a fresh sign-in away from home. Under the Home Assistant App the page says cameras come from Home Assistant and links to its Generic Camera integration.
- Mantel Settings → About → **Secure Connection**: whether this screen is a secure page (the microphone, and so talking at the door, needs HTTPS), how Mantel is reached (built-in HTTPS, behind your own proxy, Home Assistant's sidebar or plain HTTP), and the address in use against the public one. An Owner or Admin also sees each wall tablet whose page isn't secure, with the fix (open Mantel by its `https://` name in Fully Kiosk's Start URL). Wall tablets' pages now tell Mantel their `isSecureContext` and address with their health reports. The camera pop-ups in HK Settings note that talking at the door needs HTTPS while a screen isn't secure. On Docker and the LXC before Mantel has a name, the page points to `mantel-setup` and Set Up Mantel's Address and HTTPS step instead of explaining it again.

**Fixed**
- Docker and the LXC: `https://<an IP address>` no longer fails the TLS handshake (a browser sends no name to an address; Caddy now falls back to Mantel's own).
- Screensaver: the music slide's buttons (skip, browse, speakers) no longer close the screensaver.

## 0.1.113 - 2026-11-02

**Fixed**
- Screensaver editor: the **+** in each empty place is centered in its circle, and a Temperature widget's figure in its ring.
- Screensaver: the **Today** face's song line is centered under the time, a long title cut short with an ellipsis; **What's Playing** (under the time's **Face**, and under **Clock Style** in Settings) turns that line off.
- Home Grid: a Music block's **Plays On** can be one of your presets (a group); it couldn't be saved since 0.1.111. A refused save names the blocks to check.
- Side Pane: the small speaker sits on the volume slider's line.
- Mantel Link: a revoked credential asks you to re-authenticate in Home Assistant (a pairing code) instead of retrying every 30 seconds for good; HK Frontend raises a Repairs issue. Pairing again revokes the old credential. The App no longer withdraws Home Assistant's credential before its replacement is accepted.
- The weather forecast, notifications and music on the screens resume by themselves after Home Assistant restarts (they stayed frozen until a reload); one failing part of Mantel no longer takes the whole Home Assistant connection down.
- Security: connecting an assistant, making someone an Owner or Admin, adding one, linking a Home Assistant user and enabling a disabled account each need a fresh sign-in, on every page that can do them. A screen preview reaches only what a screen draws from; a Child's screens are no longer told about entities they can't see; muting a notification category needs control of Notifications (a Guest could mute smoke for a day) and is audited.
- Music: Stop right after Pause no longer leaves the room showing paused; playing never takes a room you can't control out of its group; a music change made by an assistant can be undone.
- Music: each playlist shows the cover of its albums or its own picture, on the Music page, the Music block and the playlists sheet.
- iPhone and iPad app: with its notifications on, the house's notifications come as the phone's own only; the screen no longer draws a second banner of its own (on an iPhone Duo it sat under the app's strip).
- Backups: a restore never turns Allow Control of the House on by itself; if the backup had it on, it is off after the restore until an Owner turns it on in General.
- A screen's own camera, scene, favorite and chip lists and custom pages no longer tell a person about accessories they can't see. HK Frontend's artwork fetch, inside Home Assistant, dials only the address it checked.
- Cameras: an open camera stream ends when the person's access does (it kept playing).
- Proxmox LXC: `update` skips a release whose images aren't published yet, puts `.env` back when an update doesn't finish, doesn't go back to an older release, and says so plainly (with the restore line) when going back fails too; `var_mantel_ref=<branch>` works. Mantel Settings → About shows the version on Docker and the LXC.
- Backups: a restore refuses a backup whose sealed values don't open with this Mantel's `at_rest.key` (`wrong_at_rest_key`), instead of leaving every authenticator sign-in failing; `restore.sh` puts the old keys back if it is interrupted.
- Artwork from the internet is fetched only from the address Mantel checked; at most 8 at once.
- Security: `pyasn1` 0.6.5.
- Home Grid: a Room block's glyphs are as large as its tiles allow (they were a fixed small size), and a Wide Room's row is the Home app's pill, never stretched or cut.

## 0.1.112 - 2026-11-01

- **Releases are published:** from this release on, each one also goes out as a GitHub Release, as Docker images on ghcr.io (`mantel-server`, `mantel-transcode`, `mantel-caddy`) and as the Home Assistant App repository (`https://github.com/jazzphone/mantel#ha-apps`); the Proxmox LXC's `update` follows the release tags. 0.1.112 is the first, and carries 0.1.111's changes below (0.1.111 itself was not published).

### What the first public release holds

The first public release of **Mantel**: HK Frontend's screens, inspired by Apple's Home app, served from a server of their own beside Home Assistant. It ships with **Mantel Link** 0.1.9 (Home Assistant's side of Mantel, from HACS) and alongside **HK Frontend** 1.34.0 (HK inside Home Assistant), built from the same code. The [user guide](docs/guide/Home.md) covers all of it; [HK Frontend and Mantel](docs/guide/HK-Frontend-and-Mantel.md) compares the products.

**Running it**
- **Three ways to run it:** the Home Assistant App (Home Assistant OS or Supervised; in Home Assistant's sidebar, optionally at its own address too), Docker Compose with Caddy or your own reverse proxy, or a Proxmox LXC made by a script. All three run the same server.
- **Set Up Mantel:** a first-run checklist in Mantel Settings, each step worked out from the house (Home Assistant, your home, screens, the household, the Owner's sign-in, the Alarm PIN, moving the house from HK Frontend, house commands), each opening the page that does it.
- **Backups:** inside Home Assistant's backups for the App; nightly encrypted backups, checked before a restore, with Docker and the LXC.
- **Updating** through Home Assistant, `./update.sh`, or `update` in the LXC.

**People and access**
- **People and roles:** Owner, Admin, Adult, Child and Guest, with grants per room and feature, and Wall Tablet for a tablet.
- **Sign-in:** passkeys, passwords with authenticator codes, or Sign in with Home Assistant; stricter rules from away than at home; a fresh sign-in to confirm it is you before anything sensitive.
- **Commands and the audit log:** commands stay off until the Owner turns on **Allow Control of the House**; each one is checked against the person's and the device's role and written to the audit log before it reaches the house. The alarm asks for its PIN.
- **Assistants (MCP):** an assistant such as Claude Code or Claude Desktop can read the house, change settings and build screens and Home Grid layouts for one person, with that person's role, every change planned and shown first, audited as theirs through the assistant, and undoable. Off until the Owner turns it on (Mantel Settings → Advanced → Assistants); a personal key or a sign-in, home network by default, never the Alarm PIN. See [Assistants](docs/guide/Assistants.md).

**Wall tablets**
- A browser enrolled as a wall tablet keeps its own credential and role, whoever walks up to it. Enrolling into a room with no HK tablet adds that tablet too. Each tablet has one page in Mantel Settings: its screen, kiosk app, When Idle, Sleep Screen, the browser signed in as it, and Reload and Clear Cache from Mantel.
- The screensaver, return to Home and Sleep Screen are HK's, with **Mantel Photos**: albums for the screensaver, with Keep in View cropping around faces found on the server (where, never who).

**Screens**
- HK's pages drawn with HK's own code, without Lovelace: Home, a page per room, Lights, Climate, Security, Cameras, Music, Energy and the **Power** page (the grid, the sun, a house battery and the cars right now), Weather, Live TV and more, over the live sky.
- **Home Grid:** a tablet's Home page laid out in fixed blocks in a desktop editor, with starter layouts, pages, conditional blocks, layout history and copying to another screen. A **Now Playing** block turns over to **Speakers** or **Browse**.
- **Edit mode** (**Edit Page**): arrange a page in place: drag tiles, make them Tall, and reorder the menu, the tab bar and the rooms.
- **Edit Screensaver:** lay a screen's screensaver out on the screen itself: start from a look (Photo Frame, Lock Screen, Clock and more), pick the background, set the big time's face, size and place, and add widgets by tapping one and then a green place. Whatever the time reaches moves out of its way. See [Screensaver](docs/guide/Screensaver.md).
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
- Ignore Announcements recognizes Home Assistant service calls in Mantel, Music Assistant speakers included.
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

## 0.1.111 - 2026-11-01

- **Appearance, Bright Glass's Dim:** the slider is Strength again, as before 1.33.0 (no brightening past the cap), and Bright Glass gains a Dim (0 to 60 %), like the Side Pane's: a shade over the cards, the chips, the tab bar and the side menu. The Side Pane's Dim is Same as the Glass by default, with its own slider when that's off. The Settings preview follows the sliders as they move.
- **Home Grid, Half Height tiles:** an Accessories or Scenes block's Half rows are the Home app's pill, 70 px tall from the top, as many as the block holds; never stretched, never a row cut through.
- **Screensaver, layouts under a slide:** while the music, the forecast, Weather or Home Energy shows, a saved layout steps aside and the slide has the screensaver's usual corners: the time, the date and the weather at the top left, Home Status at the top right. Under the music the time was gone and the weather ran into Up Next. The layout comes back with the next photo.
- **Music, presets are lists of rooms:** a preset is a name and its rooms, played by grouping them as any choice of rooms is; no Music Assistant sync group plays it, so pause now pauses (a sync group can only stop, which broke it up). New Sync Group and writing Music Assistant's groups from the settings are gone; groups made that way stay in Music Assistant until you remove them there.
- **Music, paused stays paused:** Music Assistant stops a queue that's been paused for 30 seconds. The Music page now keeps the song for up to four hours, and play resumes it where it was instead of starting the first playlist.
- **Proxmox, one command:** `bash -c "$(curl -fsSL https://raw.githubusercontent.com/jazzphone/mantel/main/packaging/proxmox/ct/mantel.sh)"` makes the container with the Proxmox VE community scripts' menus, installs Mantel, starts it and shows its setup code; `update` in the container follows Mantel's releases, with a backup first and the previous version back if the new one isn't healthy.
- **Moving to Docker or the LXC from another Mantel:** `restore.sh` (and `mantel.sh restore` from the Proxmox host) restores another Mantel's backup, such as the Home Assistant App's, with its keys file, so authenticator apps and saved connections keep working. Mantel Settings' Restore From Another Mantel now says so on Docker and the LXC, where it can't change its own keys, instead of restoring without them.

## 0.1.110 - 2026-11-01

- **Appearance, Bright Glass's Brightness:** the slider (Strength until now) goes on brightening past the point where it used to stop over the Wallpapers: above 50 % the glass's sheen, rim and the colors coming through grow brighter, while the glass behind the words holds back so white text stays readable. The Side Pane's glass follows it, its Dim still a shade over it. The Settings preview follows Brightness, Frost, Blur and Darkness as the slider moves.
- **Wall tablets follow their Screen:** change a tablet's Screen in Wall Tablets and its page opens the new screen, without waiting for the kiosk app to go back to its start page.
- **Swiping with a finger off the Pages screen:** a touch swipe now leaves the Pages screen for the next page (on a Pixel Tablet it went nowhere); strips that scroll sideways only when they overflow (a Music shelf, the weather's hours) no longer take the swipe.
- **Music, presets and Music Assistant's groups:** a preset's rooms are read from its group's settings, and before it plays, rooms the group gave up are grouped back (Everywhere could not play while its group held no rooms).
- **Music, presets write Music Assistant's groups:** "New Sync Group" makes one in Music Assistant, and a sync group's rooms changed in the preset form are set there. Off while commands are off; deleting a preset never deletes its group.

## 0.1.109 - 2026-11-01

- **Screensaver, Edit Screensaver, dragging:** drag a widget from the left onto a green place with the mouse, or one on the screen to another place, as in the Home Grid editor. Tap, then a green place, still works on an iPad.
- **Screensaver, the forecast among the photos:** its Layout is back on the Screensaver page (The Forecast: Classic or Big, the Big Number, Planted Numerals, Details on the Forecast), and Big Weather now shows as a slide with a layout too: the layout's big element and widgets step aside while it shows.
- **Screensaver, the Side Pane:** a screen's Screensaver Options show its own Side Pane even while the rest follows All Screens, and All Screens' page names the screens that have one of their own.
- **Swiping between pages:** the background fades to the next page's, and a press under a short page (Live TV, Cameras) swipes it.
- **Music, new speakers while music plays:** the group is updated in place: Downstairs playing and Everywhere picked no longer stops the music.

## 0.1.108 - 2026-11-01

- **Swiping between pages, sliders:** dragging a slider drawn by hand, as the Music page's volume, moves the slider, not the page. A chart scrubbed with a finger and the Weather radar keep their drags too; the Pages screen's Home pill still lets a sideways swipe turn the page.

## 0.1.107 - 2026-11-01

- **Screensaver, the editor's screen:** shows the layout alone: no slides (music full screen, the forecast, Weather, Home Energy) and none of the house's notifications. **Slides & Notifications**, beside the shapes, turns them on for the preview; it is off each time the editor opens and saves nothing. A corner's **+** stands by its stack wherever the stack was moved.
- **Swiping back to Home:** the grid no longer snaps behind the Side Pane, and the Pages screen's blur no longer rides along with the page.

## 0.1.106 - 2026-11-01

- **Screensaver, Edit Screensaver is where it is laid out:** the Screensaver pages keep only what can't be laid out: the photos and how they show, the wallpaper, the slides and how often, Night Mode, the Side Pane and the timing. What shows and how it looks (the background, the time, the widgets, Time Behind, the corners) is set in the editor, starting from how it looks today.
- **Screensaver, adding widgets:** a round **+** follows the row's last widget, and a corner's stack, while there is room; tap it for what fits there.
- **Screensaver, Save and Cancel:** no longer leave Safari on the screensaver preview, full screen.

## 0.1.105 - 2026-11-01

- **Screensaver, Edit Screensaver, lined up:** things line up by their letters, not their boxes: the time's top level with the top corners' words, the bottom corners' last lines on one baseline, and Time Behind's figures on the top margin.
- **Screensaver, the same Look for everything:** every widget and card has a **Size** (60 to 160 %), a **Backdrop** (None, Glass or Tinted) and a **Color**; the cards had none before.
- **Screensaver, the row:** two lines of widgets, **Under the Big Element** or **Along the Bottom** of the screen (clear of the faces in a photo).
- **Screensaver, cards with nothing to show:** Now Playing with no music and Timers with none running are drawn dotted with their names in the editor, where before they were found only by hovering.

## 0.1.104 - 2026-11-01

- **Screensaver, the Battery and Energy Today widgets:** a layout with either no longer freezes the screensaver. A wall tablet's page stopped and was restarted, and Settings' Screensaver page and Edit Screensaver hung once such a layout was saved.

## 0.1.103 - 2026-11-01

- **Screensaver, Edit Screensaver:** lay a screen's screensaver out on the screen itself, in a desktop editor like the Home Grid's (Mantel Settings → Screens → your screen → Screensaver Options → Edit Screensaver, or All Screens → Screensaver). Start from one of today's looks (Photo Frame, Forecast, Big Weather, Lock Screen, Clock, Glance, Month, Day, Nightstand), pick the background, set the big time's face, size, position and depth (In Front, Behind the Subject on photos, Behind the Land or Planted on the Landscape), and add circular, rectangular, inline, card and bottom-band widgets by tapping one and then a green place, with a Glass or Tinted backdrop. Whatever the big time reaches moves out of its way, so a large Time Behind no longer runs into Home Status or the forecast. Undo, Preview, the Wall Tablet, iPad Upright and Phone shapes, and an upright layout of its own. A screen that never saves a layout is drawn as before; **Remove the Layout…** on its Screensaver page goes back.
- **Screensaver, Big Weather with the Clock as the big number:** the time is drawn as solid ivory figures standing in the meadow, their shadows cast by the sky's sun (long in the morning and evening, soft under cloud, none at night), with the season's grass in front of their feet. **Planted Numerals** (Screensaver → Big Number: Clock) turns it off.
- **Time Behind, How Strict:** Strict, Standard or Relaxed (Mantel Photos → Time Behind), applied at once, and Photos says why a photo doesn't qualify (subject too small, too large, edges unclear).
- **Side Pane, Dim:** a slider, the preview dimming as it moves; a screen's own pane is no longer lost on its next change. The pane fades and the tab bar moves with the finger between pages, and slides when a page changes. Now Playing's drawer unfolds from the player.

## 0.1.102 - 2026-11-01

- **Side Pane, Dim:** Off, Low, Medium or High (Side Pane → Look): a shade over the pane's glass and album art, for its words over a light background.
- **Side Pane, the music:** a tap on the song, Speakers or Browse makes the player rise to the top of the pane with Speakers, Volume, Queue and Browse under it. A tap on the cover opens the screensaver's music full screen (the drawer, on a screen with no screensaver). Its play button at Tiny is no longer cut off.
- **Side Pane, never stuck:** the forecast under the time is there without visiting the Weather page first, and uses the forecast sensors in Settings → Weather when chosen. The calendar, to-do lists and camera stills ask again when a read goes unanswered or fails. At Now, the hour strip shows the temperature now.
- **Weather block, Large and Extra Large:** the temperature, the hours and the days fill the block instead of leaving space above and below. The 7-Day Forecast label lines up with the place name.
- **Now Playing block:** no more flickering band behind the controls in Safari.
- **Lock Up and All Lights Off:** a tap with nothing to do says so ("Already All Locked", "Already Off").
- **Home Grid, the top band:** the Clock, the Weather and the Status Chips each on the left, in the center or on the right, in the order you choose (the editor's Header section).
- **Live TV:** Mantel's Live TV settings page no longer offers a link to HK Frontend's integration in Home Assistant.

## 0.1.101 - 2026-11-01

- **Music block:** at Small, the playlist's cover fills the block with play in the middle. Larger sizes hold every playlist and scroll, across at Wide and Extra Large and down at Tall and Large. A playlist with choices, such as Decades, is one tile; a tap opens its choices, and the one picked plays on the block's speaker.
- **Music block, When Tapped:** Choose a Playlist opens a sheet of every playlist's cover, so one tap from the dashboard starts any playlist.
- **Side Pane Clock, Beside the Time:** choose how the weather sits beside the time: Large, Quiet, a Chip, or on the Date Line, at Left, Center or Right and at every pane width. The temperature takes the time's weight, and each weather symbol is centered on the figures.
- **One temperature everywhere:** the Side Pane, the header, the left menu, the screensaver and a thermostat's Outside reading now use the sensors chosen in Settings → Weather (Outside, Feels Like, Humidity, Wind, Gust, UV), as the Weather page and block do, and the weather service's own readings only when none is chosen.

## 0.1.100 - 2026-11-01

- **Assistants (MCP):** an assistant such as Claude Code or Claude Desktop can now help set up the house. It reads your home, changes settings, and builds screens and Home Grid layouts, acting for one person: their role decides what it may do, every change is planned and shown first, the Audit Log shows each one as theirs through the assistant, and each can be undone. Off until the Owner turns it on in Mantel Settings → Advanced → Assistants (MCP); connect with a personal key (home network only) or by signing in from the assistant. It is never given the Alarm PIN, and it controls the house only if the Owner allows it.
- **Audit Log:** a **Through** filter shows only what assistants did, and each row names the assistant.

## 0.1.99 - 2026-10-31

- **Virtual Pairs:** pair two Music Assistant speakers in one room in Mantel Settings (Music's speakers), and Mantel shows them as one speaker everywhere: the Music page, Speakers sheets, the Side Pane, the Music and Now Playing blocks, home rooms and Plays On. Playing joins both at play time, so neither is held in a Music Assistant group and the pair can play with any other room. Volume goes to both. A Music Assistant group of exactly the pair's two speakers is used when the pair plays alone, and presets keep working.
- **Side Pane:** the clock's first digit is no longer cut off at the left. Security at Less fits on one line: the state, with what is open or unlocked at its right.
- **Room pages:** their tall tiles are always the Home app's tall pill. The Centered tile style is the Home Grid's alone.
- **Camera block:** the snapshot's time badge sits evenly in its corner.

## 0.1.98 - 2026-10-31

- **Side Pane Clock, Under the Time:** at More, a strip the clock's width under the time: Next Hours, the Sun (the day's arc from sunrise to sunset with the sun on it), the Moon (tonight's, drawn, and when it is next full or new) or Conditions (sunset, wind, humidity, UV). Sunset beside the date stays the default.
- **Side Pane Clock, weather beside the time:** the time and the temperature share a baseline, and so do the date and the sky. A right-aligned time has the weather at its left. At More the sunset is a line of its own. When Tapped opens the Weather page.
- **Side Pane:** the room under the last section matches the sides.
- **Home Energy over the Forecast:** the whole screen is blurred behind it, the sky as well as the land.
- **Music block:** Plays On lists the house's speakers and speaker groups.

## 0.1.97 - 2026-10-31

- **Glyphs at HomeView's size:** Centered tiles draw their glyphs about 15 % larger, near Apple's (about 30 % of the tile). Square cells are now recognized however small they come out (beside the Side Pane on a 1280 x 800 tablet they had the shorter tile's smaller glyph), which also fixes the calendar, camera, timers and weather blocks there.
- **Side Pane:** the Clock can show the weather beside the time, as the menu's header does (Beside the Time). The calendar lists events under their day (Today, Tomorrow, the weekday) with only the time under each. The space above the time matches the space at the side.
- **Screensaver:** Big Weather's big number can be the temperature or the time (Big Number), and it now stands on the landscape's ground with a soft shadow. Home Energy over the Forecast blurs the landscape behind it. Time Behind has Time Size, Time Height and Darken.
- **Music block:** Presets is now Playlists, and a Plays On option picks the speaker or speaker group a tap plays on.
- **Music First over the Forecast:** the time, the date and the weather show in the corner again while the music covers a Big forecast or its details (they were hidden unless the Forecast's Layout was Classic).
- **Fixes:** the radar's full-screen X is clear of the iPhone Duo's side strip; the Music page no longer says "Could not open that: no client" while it connects; the camera block lands exactly on each camera instead of a few pixels to the right; the Pages screen fades in once laid out instead of jumping; More's Calendar shows its glyph in the list, and its date sits upright and centered in the icon.

## 0.1.96 - 2026-10-31

- **Music without Home Assistant:** with Music Assistant connected, the speakers' state, covers, commands, Browse, search and Up Next come from Music Assistant directly, so music keeps working while Home Assistant restarts.
- **Covers and faces that fail:** never the broken-image "?". A cover that can't load shows the music note (never the previous song's art), a person keeps their last good picture, and an unavailable player shows its placeholder.
- **Backgrounds in any color:** one combined picker holds the Wallpapers (Ribbons, Petals, Shards, Pinwheel) and the six motion themes, with one Color list and Motion under it. The Clock screensaver uses the same picker.
- **Side Pane clock:** Face, Alignment (Left, Center, Right), Text Size, Weight, AM/PM, Flashing Colon, Date and Second Line, on All Screens or per screen.
- **Side Pane Now Playing:** an Album Art Background switch, and When Tapped opens Speakers, Volume, Browse and Queue in place or flips to the controls.
- **Side Pane Camera:** the still loads and refreshes every 10 seconds, with a Name option (hidden by default).
- **Music block:** a Shows option (Recently Played, Presets or One Playlist). **Live TV block:** pick its channel; on bigger sizes the channel's mark and name grow.
- **Small Now Playing's Speakers sheet:** the group's volume above each room's.

## 0.1.95 - 2026-10-31

- **Motion themes:** six new animated Wallpaper backgrounds (Aurora, Beams, Blobs, Dots, Meteors and Waves), each in any color you pick, with presets; still under Flat or Reduce Motion. The Clock screensaver's Background offers the Wallpapers and motion themes too.
- **Every block does something when tapped:** each Home Grid block opens its sheet or its page, with a When Tapped option.
- **Card picker:** every block is listed (To-do, Energy Rings, On Now and the rest), each size chip previews that size, and a card with no room can be dropped over the blocks it replaces, with Undo.
- **Names you give accessories win everywhere:** Security's Recent Activity, Left On, the Doors and leak lines, On Now and the Side Pane. A new **Also rename in Home Assistant** switch under an accessory's name renames it there too (the name only, never the entity id).
- **Music:** playing a song, album, artist or playlist from Browse replaces the queue, as Apple Music does, and only counts as started once the new music plays.
- **Day screensaver:** the corner clock and weather stay clear of the day and date, leaves fall and bats fly, the corner clock keeps its own minute, and the weather icon takes the face's dark ink.
- **Layout fixes:** banners center on the whole screen, over a Side Pane's edge too; the header's clock glow and chips' shadows are no longer clipped; sideways rows run under a side rail or the iPhone Duo's strip to the screen's edge; the Pages screen's Rooms folder has a proper top inset and, on a phone, is as wide as it can be with names on two lines; a camera block's name can be shown or hidden.
- **Settings, Advanced:** the font and glyphs are checked in Your Files instead of reported Missing, and Show in Sidebar appears only in Home Assistant.

## 0.1.94 - 2026-10-31

- **Home Grid blocks as widgets:** every block is redrawn after the HomeView widget mock-ups, at each of its sizes: Calendar (Small, Tall, Large, the month at Extra Large) and a new **To-do** block; the Thermostat's Big Number and its modes; Weather (Wide shows the next hours); Now Playing, Recently Played and Live TV; Timers (the ring is the pause, with a red Stop); Who's Home; the Vacuum's big keys and rooms to tick; Doors, Security, Power, Water and Battery; and new **Energy Rings** and **On Now** blocks. Scenes and Accessories gain Height and Color; every control reaches a finger's 44 px.
- **Edit mode on the Home Grid itself:** drag, resize, remove and add blocks right on the dashboard.
- **Centered tiles** draw their glyphs bare and large, as HomeView does; an Accessory block says its chosen Line Under Name.
- **More and Rooms** in the tab bar are app icons in their colors, in a bigger sheet on a tablet.
- **The Side Pane:** Now Playing at Less is a mini player (Speakers and Browse beside its volume) and at More shows the song's progress; Security says only what is open; Who's Home is spread evenly; its Clock is lined up.
- **Screensaver:** Time Behind's weather is back in the top-left corner; Clock's time is bright over a dimmed photo; light faces such as Day use dark ink; the Day art moves gently (still under Flat or Reduce Motion); the Forecast's corners no longer overlap.
- **Settings previews:** the screensaver preview is the screensaver alone at the screen's size, each change shown as it is made, without reloading a dashboard; the Appearance pages preview the look with a few of the screen's cards; All Screens' Appearance and Side Pane pages get previews too.
- **Choices as pictures:** the clock's Background, the Day face's Look, the Forecast's Layout and the sky's Backgrounds are picked from little previews.
- **Fixed:** an accessory's page opened straight from search (a renamed accessory, for one) waited for its data instead of saying it couldn't load; a block pager comes to rest exactly on its page.

## 0.1.93 - 2026-10-30

- **Time Behind, one place for the time:** the time is always upper center, the same spot and size on every photo; the photo's subject comes over it only where it covers part of the time, otherwise the time is in front. The weather sits under the time, centered, instead of beside it; on a phone it fits the screen, and the photo's title and what's playing no longer overlap.
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

- **Looks:** eight complete setups for a screen (HomeView, Flat, Performance, Holiday Whimsy, Active Weather, Calming Backgrounds, Night & Bedside, Photo Frame), each setting the colors and accent, the background and sky, the tiles, the Side Pane, swiping, the screensaver and a layout for the screen's shape. A screen's **Looks** page lists every change as was → becomes; **Layout + Look** in the Home Grid editor sets the layout too; one Undo puts it all back.
- **Square tiles look like HomeView's by themselves:** Tile Style **Automatic** (the new default) centers the icon above the name on square cells and keeps the Home layout elsewhere. Square grids offer **2 to 6 columns**.
- **Wallpaper Motion:** Off, Slow, Medium or Fast; it stops when hidden, under the black screen and with Reduce Motion.
- **The Side Pane** takes the screen's glass (blurred in Blur and Bright Glass), has no headings (a thin line between sections) and a live preview on its settings page.
- **Bright Glass sheets and pop-ups** are readable over every wallpaper: a deeper tint, the page dimmed behind, room icons in white circles.
- **Fixes:** text in a square screen's corner tiles is no longer cut off; the shared blur behind each tile matches its corners; Big Number marks the setpoint with a dot, with a smaller dash and room for the name; the Side Pane's and its sections' icons show in Mantel.
- **Music: stereo pairs.** A room whose speaker is a Music Assistant group (two HomePods panned left and right) is one room; a preset's rooms are read from its group in Music Assistant, so a pair plays in Everywhere or Upstairs.

## 0.1.89 - 2026-10-30

- **A HomeView-style look, every part of it an option** (a screen looks as it did until you pick something): square cells on any screen and a **Square** (3 × 3) screen type; HomeView-style starters, with **Home with Pane** recommended for a landscape tablet; **Centered** tiles; a **Big Number** thermostat; an **Analog Numbers** clock; a **Cameras** face of up to nine stills; **Bright Glass** and twelve **Wallpapers** of our own that tint the tiles, on every surface but Mantel Settings.
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
- **Smaller files, same behavior.** The detail sheets, Mantel's feature host, the settings store and the Mantel Settings page are each split into smaller files. Nothing you see changes.

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
  - On a phone held sideways, a control and what is beside it sit centered as one group (a shade, an awning, a light's colors, the vacuum), not the control against the left edge; a door's day strip runs to the edge.
  - On a small iPhone (an SE), the media and sensor sheets fit: the sheet takes 20 px above and below, and the cover is a step smaller. A color light's favorites fit across.
  - The camera's X sits as far from the top as from the right, and its volume slider is easier to catch. The event's color dots take a larger tap.
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
- A Home Grid beside a tab bar rail that rests small (Start Small) or hides centers on the whole screen; the rail's room comes back as it opens.
- Detail sheets on a short screen (a phone on its side, the car): each sheet is the screen's height, the control on the left at full height with what it reads and its buttons centered beside it. The thermostat's ring sits beside its modes and fan; media's cover beside the track; a sensor's reading beside its chart; an event beside its day. Nothing scrolls. Tablet and phone sheets are unchanged.

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
