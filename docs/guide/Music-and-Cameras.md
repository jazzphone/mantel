# Music and Cameras

Mantel runs HK's Music page itself, talking to Music Assistant directly, and
shows your cameras through its own sign-in and roles. Each person and each
wall tablet hears and sees only what their role allows. This page covers
connecting Music Assistant, which speakers each screen plays on, and what
passes through Mantel when a screen shows a camera.

![The Music page on a phone: Browse, with what is playing in the bar at the foot](../images/music-phone.webp)
*The Music page on a phone.*

## Music

### What you need

- **Music Assistant**, version 2.7 or later for the sign-in below (or any
  version with a long-lived token).
- Home Assistant's **Music Assistant** integration, with its players in Home
  Assistant. Mantel reads the speakers, their rooms and their state from Home
  Assistant, and sends the music commands to Music Assistant itself.
- Each speaker in a Home Assistant **area**, as HK Frontend's
  [Music](https://github.com/jazzphone/hk-frontend/wiki/Music) page needs.

### Connect Music Assistant

Only an Owner can change a connection.

1. Open **Mantel Settings → Connections**.
2. Under **Music Assistant**, enter its address, for example
   `http://192.0.2.20:8095`. If Mantel runs as the Home Assistant App and
   Music Assistant is an App too, the box is filled in for you ("Found Music
   Assistant's App: press Test").
3. Either **Sign In with a Music Assistant User** (a user name and password,
   used once to make a long-lived token and not kept), or paste a long-lived
   token you made in Music Assistant (**Settings → your profile**).
4. Select **Test**, then **Save**.

Nothing restarts. Open screens switch to Mantel's music at once. Music
Assistant's tokens last a year; the page shows when this one ends.

To stop, select **Disconnect**. The Music page goes back to Home Assistant's
music, as before.

> Prefer a file? An installation can also give Mantel Music Assistant's
> address and token (`MANTEL_MA_URL` and the `ma_token` secret in Docker, or
> the App's **Music Assistant address** and **Music Assistant token**
> options). The page shows them as "set by the installation". A connection
> saved on the page wins over them.

### Bring the music settings over

If you used HK Frontend's Music feature, its speakers, house volume, Home
Rooms, presets and playlists come over with the one-time import (see
[Moving from HK Frontend](Moving-from-HK-Frontend.md)). Otherwise, set them up
on **Mantel Settings → Pages → Music**. It is the same page as HK Frontend's
**HK Settings → Pages → Music** and works the same way: see HK Frontend's
[Music](https://github.com/jazzphone/hk-frontend/wiki/Music) for every
setting.

Mantel answers the Music page only when **both** are there: Music Assistant
connected, and the music settings in Mantel. Until then the page keeps
reading Home Assistant's music, if HK Frontend has it.

### Which speakers each screen plays on

| Who | The Music page starts on | May play on |
|---|---|---|
| A person | Their **Home Room**, chosen for them on the Music settings page (for a person linked to Home Assistant, the one HK Frontend had, until you choose one) | The speakers in rooms their role lets them see |
| A wall tablet | The first speaker in the tablet's own room, in the order the speakers were picked | Its room's speakers |

Each speaker is named by its area, so a room's pill says "Kitchen", not the
speaker's model.

By role, with the starting roles (see [People and Roles](People-and-Roles.md)):

| Role | Music page | Speakers |
|---|---|---|
| Owner, Admin, Adult | Yes | Every speaker |
| Child | Yes | Only in the rooms they are given |
| Guest | No | (Guests can still use a speaker in their rooms as an accessory) |
| Wall tablet | Yes, on every tablet | Its own room's |

An Owner can narrow any of these with an ordinary deny grant, for example to
keep a Child off the Music page.

**Presets** (Music Assistant sync groups) are offered when the person may see
the group, or every room in it. Up Next for a speaker you may not see answers
as if it did not exist.

### Playing needs house commands on

With house commands off, the Music page reads everything (what is playing,
the queue, the library) but every button is refused before anything reaches
Music Assistant. With them on, each play, move, stop and volume change is
checked against the rooms it names and written to the
[Audit Log](Commands-and-Audit.md) before it is sent.

### The Music Assistant page

HK's **Browse Music** page shows Music Assistant's own web app. On Mantel it
is served under Mantel's address (`/ma/`), so it works on an `https` page, and
only for people who may control music.

To skip Music Assistant's own sign-in on every screen, give Mantel a token for
an ordinary Music Assistant user:

1. In Music Assistant, **Settings → Users**, add a user (for example
   `mantel-page`) with the **User** role, not Admin.
2. In Mantel, **Mantel Settings → Connections → Music Assistant Page**: sign in
   as that user once, or paste a long-lived token made for it.

An administrator's token is refused. The token stays in Mantel; the page
never sees it. If Music Assistant later refuses it, the page shows Music
Assistant's own sign-in again.

What the signed-in page sends goes to Music Assistant directly, not through
Mantel's checks, so Mantel signs it in only when house commands are on and
for someone who may play, group and set the volume of **every** speaker:
usually Owners, Admins and Adults. Everyone else, a Child kept to their rooms
or a wall tablet, sees Music Assistant's own sign-in on that page, as without a
token. Each signed-in page is written to the Audit Log when it opens.

### What is different from HK Frontend

- **Announcements** are not spotted. During a spoken announcement on a speaker,
  the Music page may briefly show it as what is playing.
- **Failure notices** (a group that would not form, a playlist that did not
  start) are logged by Mantel, not raised as Home Assistant notifications.
- Opening an album's tracks, an artist's albums or a search still reads
  through Home Assistant's Music Assistant integration.

## Cameras

![The Cameras page on a desktop browser](../images/cameras-desktop.webp)
*The Cameras page.*

HK's Cameras page, the camera strip and the doorbell pop-up work on Mantel as
in HK Frontend; see HK Frontend's
[Cameras](https://github.com/jazzphone/hk-frontend/wiki/Cameras). Mantel needs
nothing set up for them: it uses its own Home Assistant connection.

### Who sees which camera

| Role | Cameras |
|---|---|
| Owner, Admin, Adult | Every camera, at home and away |
| Child, Guest | None |
| Wall tablet | Every camera, so the doorbell pop-up shows on every tablet. Tablets work on the home network only. |

Away from home, a role sees cameras only while its **Cameras from Outside**
switch is on (**Mantel Settings → Roles & Grants**). Through Home Assistant's
sidebar the same switch applies when the sidebar is set to Mantel's away
rules. A refused camera stays on its still, or shows nothing, and is not
retried.

### Stills

The pictures on tiles come from Mantel, never from Home Assistant directly:

- A screen asks Mantel for `/api/camera/<camera>/still`.
- Mantel checks that the person or tablet may view that camera live, then
  fetches the picture from Home Assistant with Mantel's own credential and
  passes it on.
- Home Assistant's camera token is removed from every state Mantel sends, so
  no page ever holds one. The same goes for speakers' album art.

### Live view

Live video uses Home Assistant's own WebRTC, as it does inside Home Assistant:

1. The screen sends the WebRTC setup messages to Mantel.
2. Mantel checks each one (may this person view this camera live?) and
   relays it to Home Assistant unchanged. A refused camera gets nothing
   forwarded.
3. **The video itself flows directly between the screen and Home Assistant's
   go2rtc**, never through Mantel. Mantel passes on Home Assistant's own
   connection settings, unchanged, so it works away from home exactly as it
   does in Home Assistant.

One screen can't join another screen's video session, and closing the page
ends its session.

| Passes through Mantel | Never passes through Mantel |
|---|---|
| The setup messages (offer, answer, connection candidates) | The video and audio |
| Stills and album art, fetched by Mantel | Home Assistant's camera tokens |
| | Home Assistant's own address or credential |

### Live TV

In the Home Assistant App, Mantel serves the channels and Mantel Link
transcodes them inside Home Assistant, whose go2rtc plays them (Mantel Link
0.1.3 or later, with the rest of the house moved to Mantel). In Docker or the
Proxmox container, Mantel can serve Live TV through its own go2rtc instead. Its streams are then reachable only through
Mantel (`/go2rtc/`), for people with the Live TV feature who may view that
channel's camera. See HK Frontend's
[Live TV](https://github.com/jazzphone/hk-frontend/wiki/Live-TV) for the page
itself.

## Troubleshooting

**The Music page shows no rooms.** Check **Mantel Settings → Connections**:
Music Assistant connected, and the music settings imported or set up. A person
with no rooms they may see gets an empty page.

**The Browse Music page is blank, or says Music Assistant is on your local
network.** Mantel can't reach Music Assistant's web app, or the person may not
control music. If you run your own proxy, make sure it does not add its own
Content-Security-Policy header. See [Troubleshooting](Troubleshooting.md).

**A camera stays on its still.** The person's role may not view it live, or
they are away and **Cameras from Outside** is off. Mantel's log names a
refused camera (once every five minutes).
