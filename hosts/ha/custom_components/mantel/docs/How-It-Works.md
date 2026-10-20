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
can't hand Home Assistant a credential.
