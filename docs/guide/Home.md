# Mantel

Mantel serves [HK Frontend](https://github.com/jazzphone/hk-frontend)’s screens from a server of its own, beside Home Assistant, and adds people and roles, wall tablets that sign themselves in, and an audit log of every command. This guide covers installing it, setting it up and living with it.

<p align="center">
<img src="../images/home-tablet.webp" width="80%" alt="Mantel's Home screen on an iPad-sized screen">
</p>

## Get started

1. **[Install](Install.md)** Mantel: as a Home Assistant App, [with Docker](Install-Docker.md), or [on Proxmox](Install-Proxmox-LXC.md).
2. **[First Run](First-Run.md)**: create the Owner account, connect Home Assistant, and open your first screen.
3. **[People and Roles](People-and-Roles.md)**: add the rest of the household.
4. **[Wall Tablets](Wall-Tablets.md)**: enroll the tablets on your walls.
5. **[Commands and Audit](Commands-and-Audit.md)**: turn commands on when you’re ready.

Using HK Frontend inside Home Assistant? Mantel can run beside it or take over from it: **[HK Frontend and Mantel](HK-Frontend-and-Mantel.md)**.

## People and access

- [People and Roles](People-and-Roles.md): roles, grants, and rooms for a person or a tablet
- [Signing In](Signing-In.md): passwords, passkeys, authenticator codes and Home Assistant sign-in
- [Wall Tablets](Wall-Tablets.md)
- [Commands and Audit](Commands-and-Audit.md)
- [Security Model](Security-Model.md)

## Features

- [Music and Cameras](Music-and-Cameras.md)
- [Photos](Photos.md)
- [iPhone and Mac Apps](iPhone-and-Mac-Apps.md)
- [Push Notifications](Push-Notifications.md)
- The screens themselves are HK Frontend’s: see its [wiki](https://github.com/jazzphone/hk-frontend/wiki) for pages, rooms, the sky, the screensaver and HK Settings.

## Home Assistant

- [Mantel Link](Mantel-Link.md): the Home Assistant integration that links Home Assistant to Mantel
- [Mantel Connect](Mantel-Connect.md): Mantel in Home Assistant’s sidebar when it runs elsewhere
- [HK Frontend and Mantel](HK-Frontend-and-Mantel.md): the two products, and running both
- [Moving from HK Frontend](Moving-from-HK-Frontend.md)

## Looking after it

- [Updating](Updating.md)
- [Backups](Backups.md)
- [Troubleshooting](Troubleshooting.md)

Something not covered here? [Open an issue](https://github.com/jazzphone/mantel/issues).

## Home Grid

Arrange a tablet’s Home page in fixed blocks with the desktop [Home Grid editor](Home-Grid.md).

## Arrange a page

Owners and Admins can arrange a room page, Home (its room sections, Favorites and scenes row), or the Lights, Climate, Water, Security and Vacuums pages, in place, away from a wall tablet:

1. Open the menu (or the tab bar’s **More**) and choose **Edit Page**. On a screen with its menu turned off, open any tile’s sheet, tap the gear, and choose **Edit This Page**.
2. The tiles wiggle and stop working as controls. Touch and hold a tile for a moment, then drag it to a new place in its group; a mouse just drags. Moving without the hold scrolls the page, and the page scrolls by itself near the top and bottom edges.
3. Tap a tile’s **Regular | Tall** badge to change its height.
4. Press **Done** to save, or **Cancel** (or Escape) to put everything back.

The order is the room’s own, so a room page and that room’s section on Home share it, on every screen. While you edit, tiles sit in plain reading order; after Done the page packs them as usual, so a Tall tile’s gap may fill. If someone else changes the same page meanwhile, Done says so and offers **Reload** or **Save Anyway**. Leaving the page with unsaved changes asks first. Home Grid screens keep their own [editor](Home-Grid.md).

What each page saves:

- **Lights, Climate and Water** list their tiles room by room, and each room’s section follows that room’s order. Reordering lights on the Lights page reorders them on that room’s page and on Home too; the bar says so.
- **Security and Vacuums** keep an order of their own (the same one as their Tile Order in HK Settings). Security’s tiles have no size badge, since that page ignores size; on Vacuums, whole vacuum cards move.
- **Doors & Windows** has no Edit Page: its order comes from Status & Chips.
- **Favorites** on Home are this screen’s own and always one height, so they have no size badge. A favorite whose accessory is gone keeps its place.
- **The scenes row** on Home drags sideways, including its pills that open a page; it is this screen’s Scenes list, the same one HK Settings shows. A room page’s scenes row is that room’s own Scenes list. While editing, a mouse no longer scrolls the row by dragging; carry a scene near either end and the row scrolls by itself. A finger that moves first still scrolls it.
