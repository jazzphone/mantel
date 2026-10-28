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
6. **[Mantel Link](Mantel-Link.md)**: add Mantel's integration to Home Assistant, for your automations and the Companion app.

Using HK Frontend inside Home Assistant? Mantel can run beside it or take over from it: **[HK Frontend and Mantel](HK-Frontend-and-Mantel.md)**.

## People and access

- [People and Roles](People-and-Roles.md): roles, grants, and rooms for a person or a tablet
- [Signing In](Signing-In.md): passwords, passkeys, authenticator codes and Home Assistant sign-in
- [Wall Tablets](Wall-Tablets.md)
- [Commands and Audit](Commands-and-Audit.md)
- [Security Model](Security-Model.md)

## Screens and features

- [Arrange a Page](Arrange-a-Page.md): Edit mode, to move tiles, the menu, the tab bar and the rooms in place
- [Home Grid](Home-Grid.md): a tablet's Home page in fixed blocks, laid out in the desktop editor
- [Music and Cameras](Music-and-Cameras.md)
- [Photos](Photos.md)
- [iPhone, iPad and Mac Apps](iPhone-and-Mac-Apps.md)
- [Push Notifications](Push-Notifications.md)
- The screens themselves are HK Frontend’s: see its [wiki](https://github.com/jazzphone/hk-frontend/wiki) for pages, rooms, the sky, the screensaver, the Energy and Power pages, and HK Settings.

## Home Assistant

- [Mantel Link](Mantel-Link.md): the Home Assistant integration that links Home Assistant to Mantel
- [Mantel Connect](Mantel-Connect.md): Mantel in Home Assistant’s sidebar when it runs elsewhere
- [HK Frontend and Mantel](HK-Frontend-and-Mantel.md): the two products, and running both
- [Moving from HK Frontend](Moving-from-HK-Frontend.md)

## Looking after it

- [Updating](Updating.md)
- [Backups](Backups.md)
- [Troubleshooting](Troubleshooting.md)

## Mantel, HK Frontend and Mantel Link

<!-- products-table: copied from tools/products_table.md in Mantel by tools/products_table.py; edit it there -->
| | **Mantel App** (Home Assistant App) | **Mantel with Docker or the LXC** | **HK Frontend alone** | **HK Frontend linked to Mantel** | **Mantel Link** |
|---|---|---|---|---|---|
| **Use this when** | You run Home Assistant OS and want people, roles and wall tablets with nothing extra to look after | Mantel should run on its own machine, at its own address | You want HK on Home Assistant's own dashboards, for people who already use Home Assistant | You want both, with one copy of the settings | You run Mantel and want its tablets, actions and notifications in Home Assistant |
| **Where the screens are** | **Mantel** in Home Assistant's sidebar and the Companion app; its own address too, if you turn on direct access | Its own `https://` address; in Home Assistant's sidebar with Mantel Connect | Home Assistant's own dashboards | Mantel's pages, and HK Frontend's dashboards in Home Assistant | No screens of its own; puts a Mantel screen in Home Assistant's sidebar as a dashboard |
| **HK's cards on dashboards you build** | No | No | Yes | Yes, HK Frontend's | — |
| **Wall tablets (kiosk)** | Enrolled tablets with their own credential and role, in Fully Kiosk, Kiosk Satellite or any browser | The same | A full-screen look inside Home Assistant's page; tablets sign in as Home Assistant users | Each tablet is run by Mantel or by HK Frontend, never both | Each tablet's black screen, screensaver and Sleep Screen as entities |
| **Screensaver and Sleep Screen** | Yes | Yes | Yes | Yes, from whichever runs the tablet | Their switches, for automations |
| **People, roles, passkeys** | Mantel's roles; Home Assistant signs people in to the sidebar; passkeys and passwords at its own address | Mantel's own sign-in: passkeys, passwords, authenticator codes, or Home Assistant | Home Assistant's users | Mantel's people; a change made on HK Frontend's dashboards is saved as the person linked to your Home Assistant user | — |
| **Every command checked and in the audit log** | Yes | Yes | No | On Mantel's screens, and for saves from Home Assistant | — |
| **Remote access** | Home Assistant's own, for the sidebar; a Cloudflare Tunnel for its own address | A Cloudflare Tunnel or your own reverse proxy, with stricter rules away from home | Home Assistant's own | Each one's own | — |
| **Mantel Photos** (albums for the screensaver) | Yes | Yes | No; the screensaver shows a folder of Home Assistant's media | On Mantel's screens | — |
| **iPhone, iPad and Mac apps** | Yes, at its own `https://` address | Yes | No; Home Assistant's Companion app | Yes, with Mantel | Sends Mantel's notifications to Companion-app phones |
| **Music** | Music Assistant, through Mantel | The same | Music Assistant, as an HK Frontend feature | Mantel's; HK Frontend's music actions are run by Mantel | Music actions for your automations |
| **Settings** | **Mantel Settings**: HK's settings, plus people, tablets, connections and the audit log | The same | **HK Settings** in Home Assistant's sidebar | **Mantel Settings**; HK Settings steps aside while Mantel runs the house | None; set up in **Devices & services** |
| **Backups** | Inside Home Assistant's backups | Mantel's own nightly encrypted backups | Inside Home Assistant's backups | Each one's own | Inside Home Assistant's backups |
| **Who runs the house** (Seasonal Decorations, the Alarm PIN keypad, Live TV) | Mantel | Mantel | HK Frontend | Mantel or HK Frontend: **The House**, in Mantel Settings | Holds the house's entities when Mantel runs it |
| **Needs Home Assistant** | Yes: Home Assistant OS or Supervised, 2026.8 or newer | Yes: any Home Assistant 2026.8 or newer it can reach | Yes: 2026.8 or newer | Yes | Yes: any install type, 2026.9 or newer |
| **Installed from** | Home Assistant's App store, with Mantel's repository | Docker Compose, or a script that makes a Proxmox LXC | HACS (custom repository) | HACS, plus Mantel | HACS (custom repository) |

**Why you would use each.** **HK Frontend** is the simplest: install it from HACS and HK's screens appear on Home Assistant's own dashboards, for everyone who already signs in to Home Assistant. **Mantel** is for a household: people who shouldn't need a Home Assistant account, roles per room, wall tablets that sign themselves in, an audit log of every command, and screens that Home Assistant's updates can't disturb. Run it as the **Mantel App** if you have Home Assistant OS, or with **Docker or the LXC** to keep it on a machine of its own. **Mantel Link** goes with Mantel: it is how Home Assistant's automations, entities and Companion-app notifications reach Mantel. And you can **link HK Frontend to Mantel** to keep HK on Home Assistant's dashboards while Mantel runs the tablets and keeps one copy of the settings.

[Mantel](https://github.com/jazzphone/mantel) ([guide](https://github.com/jazzphone/mantel/wiki)) ·
[HK Frontend](https://github.com/jazzphone/hk-frontend) ([guide](https://github.com/jazzphone/hk-frontend/wiki)) ·
[Mantel Link](https://github.com/jazzphone/mantel-link) ·
[Running them together](https://github.com/jazzphone/mantel/wiki/HK-Frontend-and-Mantel)
<!-- /products-table -->

Something not covered here? [Open an issue](https://github.com/jazzphone/mantel/issues).
