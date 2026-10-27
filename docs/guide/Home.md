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

Owners and Admins can arrange a room page, or Home’s room sections, in place, away from a wall tablet:

1. Open the menu (or the tab bar’s **More**) and choose **Edit Page**. On a screen with its menu turned off, open any tile’s sheet, tap the gear, and choose **Edit This Page**.
2. The tiles wiggle and stop working as controls. Touch and hold a tile for a moment, then drag it to a new place in its group; a mouse just drags. Moving without the hold scrolls the page, and the page scrolls by itself near the top and bottom edges.
3. Tap a tile’s **Regular | Tall** badge to change its height.
4. Press **Done** to save, or **Cancel** (or Escape) to put everything back.

The order is the room’s own, so a room page and that room’s section on Home share it, on every screen. While you edit, tiles sit in plain reading order; after Done the page packs them as usual, so a Tall tile’s gap may fill. If someone else changes the same page meanwhile, Done says so and offers **Reload** or **Save Anyway**. Leaving the page with unsaved changes asks first. Home Grid screens keep their own [editor](Home-Grid.md).

### The menu, the tab bar and the room order

While a page is in Edit mode, the menu, the tab bar and its **More** sheet can be arranged too. All three show the same lists, so a change in one shows in the others straight away:

- **The menu:** drag a page by its handle (or touch and hold it) within the pages at the top or under **Categories**, or from one to the other. A page's switch takes it out of the menu; it is then listed under **Not in Menu**, where the switch brings it back. Drag a room by its handle to reorder **Rooms**.
- **The tab bar:** drag a tab along the bar (up and down on a side rail). Drop a tab on **More** to move it past the tabs that fit; open **More** and drag a page onto the bar to bring it forward. More's pages and rooms can be dragged too. How many tabs fit is still the screen's tab bar setting.
- **Rooms** in the Edit bar opens **Room Order**: every room on this screen with a handle, **Move Up** and **Move Down** buttons, and **A to Z**. A note says where the order is used: the menu's and the tab bar's rooms, Home's room sections when Home follows the room order, and the room sections on Lights, Climate and Water when they do. Closing the sheet shows the new order at once.

**Done** saves it with the rest of the page: the screen's page order, its top-of-menu pages and Categories, and the room order, with the menu's rooms switched to the room order (it starts from A to Z). A screen whose Rooms are **Same as All Screens** changes All Screens' room order, which every such screen follows.
