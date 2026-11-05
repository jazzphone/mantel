# Intercom

The Intercom lets you talk into one room, several rooms or the whole house
through the speakers Music Assistant plays on, such as HomePods. It's one-way:
the rooms hear you, but they can't answer, because HomePods give no access to
their microphones.

You can reach it from a wall tablet, from a phone's or iPad's browser, and from
the iPhone and iPad app.

## What you need

- **Mantel Server** with **Allow Control of the House** on (Mantel Settings →
  General). The Intercom makes sound in the house, so it's off whenever
  commands are.
- **Music Assistant** connected in Mantel (Settings → Connections), with the
  music settings in Mantel. The Intercom's rooms are the Music page's rooms.
- The page open by its **https://** address. Browsers only allow the
  microphone on a secure page. On a plain http:// page the sheet says "Needs
  HTTPS".
- The **stream port** open on the network between Mantel and Music Assistant:
  8767 on Docker and the Proxmox LXC, and 8101 in the Home Assistant App. The
  App's port is set in its Network section, like Direct access. See below.

HK Frontend inside Home Assistant doesn't have the Intercom. Its block says
"Intercom needs Mantel".

## Turn it on

Mantel Settings → **Intercom** (Owners and Admins):

1. **Address for Music Assistant.** The address Music Assistant uses to fetch
   what you say from Mantel, such as `http://<this server's address>:8767`.
   Mantel suggests one when you opened Settings by a private address. It has
   to be a private address on your home network, or a `.local`, `.lan` or
   `.home.arpa` name, and never a public one.
2. Press **Check Reach**. Mantel asks Music Assistant to read a short, silent
   link. Nothing plays. The page says "Music Assistant fetched it" or "Music
   Assistant could not reach this address".
3. Switch the **Intercom** on.
4. Turn on the **rooms** that may be spoken to. Every room starts off, so a new
   way to make sound in a bedroom is always your choice. **Enable All** turns
   them all on at once.
5. If you like, press **Send Test** on a room (Owners only). It plays a soft
   chime there.

Each room has its own settings:

| Setting | What it does |
|---|---|
| **On** | Whether the room can be picked at all. |
| **Live** | Off makes the room Message-only. |
| **Volume** | **Automatic** (the Intercom's **Volume** in Settings → Intercom, 40 unless you change it) or a value of its own. It is always capped by the house's **Highest Volume** (70 unless you change it). Each speaker goes back to its own volume when the message ends. |
| **Quiet hours** | The house default (21:00–07:00) or the room's own. A room in its quiet hours is skipped. |
| **Tablets** | Wall tablets that play the Intercom themselves for a room with no speaker. See [Tablets as listeners](#tablets-as-listeners). |

## Talk

Add the **Intercom** block to a page in [Home Grid](Home-Grid.md), or open
`#intercom` on any page. The block opens the sheet.

On a screen's generated Home page there is no block to add. Add it in
**Settings, All Screens, Status Chips** (a chip beside Security, Climate and the
rest, with the first room you last picked under its name, and +N for more), or a
screen's **Scenes** (a pill at the end of the scenes), under **More**. The
button shows only when you may use the Intercom and it is on, and each screen
has its own.

1. **Pick rooms.** Tap floors, presets, **Whole House**, or single rooms, as on
   the Music page's speaker picker. A small mark on each room says what it will
   do:
   - **clock**: it plays after you finish;
   - **moon**: quiet hours, so it's skipped;
   - a second line, **Plays with Office**: the room leads other rooms' music, so it plays only together with them (see below);
   - **person**: you're there, so it's left out in Live.

   Tap a skipped room to see why.
2. **Record.** Tap the microphone, talk (up to 30 seconds), and tap it again.
   The message is sent as soon as you stop. Afterward you can **Play** it back
   or **Send Again**. (With no room picked, it waits for you to pick one and
   press **Send**.)

Every room hears the message at the same moment. Mantel briefly groups the idle
rooms you picked, plays the message once on the group's one clock, and puts every
speaker back on its own. If a group doesn't come together, each room plays the
message on its own, a moment apart, so a message is never lost. Music already
playing in a room is turned down under it and comes back afterward. Rooms playing
music are in step with each other, but can be a moment apart from the idle rooms.
Rooms set to different volumes can't share a group, so give them the same volume
if you want them exactly together. A soft chime plays first; you can turn the
chime off in Settings.

The music players ignore the Intercom. While a message plays, the Music page, the
Side Pane, the player and the screensaver don't show it as music: a room that was
idle stays idle there, and a room playing music keeps its song and cover.

If a room is in its quiet hours, an Owner, Admin or Adult can press **Send
Anyway**. The audit log records it.

### Live

**Live** sends what you say as you speak. Hold the microphone while you talk, and let go when you're done, like a walkie-talkie. Its switch appears on the sheet only
when an Owner allows it in Settings. It plays a few seconds behind you, because
AirPlay buffers and an idle HomePod has to wake up first; the sheet shows the
measured delay. The rooms keep playing for those few seconds after you let go: that's the end
of what you said, not a second message. Idle rooms at the same volume play Live as one group, in step, the way a Message does; rooms at different volumes make separate groups, and if a group doesn't come together, each room plays on its own, a moment apart. Live is live only in rooms that are idle when you start. A room
playing music, or set to Message-only, hears the whole thing as a message when
you finish. If a room drops out of Live partway through, it gets the whole
message when you finish, so nothing you said is lost.

Live leaves out the room you're in, so you don't hear yourself. A phone has no
room, so in Live the sheet reminds you to stay out of earshot of the rooms you
pick.

Away from home, through the tunnel, you can send a Message but not Live.

## Who can use it

| Role | Intercom |
|---|---|
| Owner, Admin, Adult | Yes, to every room that's on |
| Wall tablet | Yes, to every room that's on |
| Child, Guest | No, unless an Owner adds a grant. A grant still covers only the rooms their role allows |

Managing the Intercom in Settings is for Owners and Admins. An explicit deny
on a speaker always wins. See [People and Roles](People-and-Roles.md).

## Rooms that lead other rooms' music

Music Assistant plays an announcement sent to the speaker that **leads** a
group on the **whole group**. If the Kitchen leads the Office's music, a
message to the Kitchen alone would play in the Office too. So the Intercom
skips a room that leads other rooms, unless every room it leads is in the
broadcast. In that case they all hear it once, in step. A room that **follows**
another is fine: Music Assistant announces to it alone.

Mantel checks this against both Home Assistant and Music Assistant. If either
says the room leads, it's skipped. If Music Assistant's list of speakers can't
be read, every room is skipped rather than guessed.

## Tablets as listeners

A wall tablet in a room with no speaker can still be a room. In Settings →
Intercom → the room → **Tablets**, list the tablet. It then plays each message
sent to that room through its own speaker. A kiosk browser plays sound without
a tap only if it allows it (Fully Kiosk: **Autoplay audio**). Otherwise the
tablet shows "Tap to hear announcements" once, and the first tap allows it.

## Privacy

- What you say is held **in memory only** while it's recorded and played. It's
  never written to disk and never logged. It's dropped when the broadcast ends,
  or when you cancel, re-record, close the sheet, or leave a recording unsent
  for 5 minutes.
- The audit log says who spoke, to which rooms, when, and for how long. It
  never records what was said.
- Music Assistant fetches the audio from Mantel's **stream port** by a
  one-time link. The link lasts seconds, works once, and only from a private
  address. The port serves nothing else, and is closed while the Intercom is
  off. See [Security Model](Security-Model.md#the-intercoms-stream-port).

## The stream port

| Install | Port | Notes |
|---|---|---|
| Proxmox LXC, Docker | 8767 | Published by `compose.yaml` (`MANTEL_STREAM_PORT`, `MANTEL_STREAM_BIND`). |
| Home Assistant App | 8101 | Set a host port in the App's **Network** section. |

Never forward this port to the internet or put it behind a tunnel. If your
network has rules between Music Assistant and Mantel, allow Music Assistant's
host to reach it.

## Troubleshooting

| The sheet says | What to do |
|---|---|
| Needs HTTPS | Open the page by its `https://` address. |
| Intercom is off | Turn it on in Settings → Intercom. |
| Nothing to send to: … | Each room's reason follows. Turn the room on, wait for its quiet hours to end, or include the rooms it leads. |
| Kitchen tablet is announcing | One broadcast plays at a time. Try again when it's done. |
| Music Assistant could not reach this address (Check Reach) | Check the address and port, and that Music Assistant's host can reach Mantel's on that port. |
