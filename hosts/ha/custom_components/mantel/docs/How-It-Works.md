# How it works

## The link

One WebSocket from Mantel Link to Mantel (`/linked/ws`), authenticated with a Mantel Service credential sent as a
header on the upgrade, never in the address. `https`/`wss` everywhere; plain `http` only to the Mantel App on Home
Assistant's own App network, and only to an address that resolves there. It reconnects by itself (1 s, doubling to
30 s). Mantel Link says who it is (`X-Mantel-Link: domain=mantel; protocol=2`); Mantel answers with what it shows and
who owns which tablet.

## What Mantel Link shows

Mantel describes each entity (its platform, unique id, suggested entity id, name, device) and pushes its state.
Home Assistant keys an entity by its unique id, so an entity your house already has keeps its entity id. While the
link is down they are unavailable. Each tablet is its own device; the house's are on a "Mantel" device.

## The bridge

While a house moves from HK Frontend, exactly one of the two shows Mantel's entities: HK Frontend (the default) or
Mantel Link, as an Owner decides in Mantel Settings. The one taking an entity over moves its registry entry (the same
entry, entity id and history) once the other has let go of it; nothing is ever added twice. A Home Assistant without
HK Frontend has no one else, so Mantel Link shows them.

## What Mantel can make Home Assistant do

Nothing, except one thing: send one of its notifications to a Home Assistant Companion-app phone (`notify.mobile_app_*`
that Home Assistant has; a title, a message, Mantel's Dismiss and a few display fields, nothing else). Everything else
on the link only changes the entities Mantel Link shows.

## What only Home Assistant can do for Mantel

A few things need code inside Home Assistant, which HK Frontend used to have; Mantel Link has them now:

- **The doorbell's talk-back.** A hold-to-talk clip from a screen is played on the speaker you chose
  (`POST /api/mantel/talk`, kept in memory for two minutes, fetched by the speaker from a signed address), and on a
  UniFi Protect doorbell the voice is streamed live as it is spoken (`mantel/talk/live`). Mantel sends both only
  after its own checks and audit, with its house commands on.
- **Energy's helper sensors.** A Utility Meter or Integral sensor keeps the sensor it counts out of its state, so
  `mantel/energy/sources` (administrators only, read only) tells Mantel's Energy page the chain.
- **Live TV's transcode.** Where Mantel has no go2rtc of its own (the Mantel App), each channel camera Mantel
  describes streams from `GET /api/mantel/tv/stream/<channel>`, which answers only this machine (Home Assistant's
  go2rtc) and runs ffmpeg on the tuner's own stream for that channel (an HDHomeRun's MPEG-2 to H.264 and AAC), only
  for a channel Mantel named and only while someone watches. The camera's picture is the programme's artwork.
- **The Lights page's "Tonight" list.** What your lighting automations will do next is worked out from their own
  configurations and conditions (`mantel/page_headers/get`, administrators only, read only); Mantel shows each person
  only the lights they may see. It never sends an automation's configuration.

## Mantel's screens in the sidebar

A small script on Home Assistant's pages listens to a Mantel screen shown in a Webpage dashboard. It believes a message
only from Mantel's own address and only from a frame on the page shown, and it can only hide Home Assistant's header
and sidebar around that frame, go to Home Assistant's start page or to one of its own pages that you have, open its
notifications, or open its sidebar over the screen. It never runs a command.

So that the screen's menu (with the screen's **Home Assistant Section** on) offers your Home Assistant sidebar, the
script tells that frame, at Mantel's address only, your sidebar's pages: their names, icons and your order and hidden
pages. Choosing one opens it in Home Assistant, as the menu did when the screen ran inside Home Assistant itself.

## Discovery

The Mantel App announces Mantel to the Supervisor with a credential it makes for Mantel Link (rotated at every start;
Home Assistant's discovery is for administrators). On the network, Mantel's `_mantel._tcp` announcement carries no
credential: a pairing code from Mantel Settings proves it, and Mantel proves it knows the code too, so a look-alike
can't hand Home Assistant a credential. Both proofs name the address Mantel Link used (pairing protocol v2): Mantel
refuses an address that isn't its own, so a look-alike at another address passing the exchange on gets nothing, and
Mantel Link checks that Mantel's proof names the same address. Mantel Link never falls back to the older protocol: an
older Mantel says "Update Mantel first".
