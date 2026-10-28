<h1 align="center">Mantel Link</h1>

<p align="center">
Home Assistant's side of <b>Mantel</b>: your wall tablets, screens and actions, linked to Home Assistant.<br>
Installed from HACS on every Home Assistant (OS, Supervised, Container, Core).
</p>

<p align="center">
<a href="https://github.com/jazzphone/mantel-link/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/jazzphone/mantel-link?style=flat-square&label=release&color=0a84ff"></a>
<a href="https://hacs.xyz"><img alt="HACS custom repository" src="https://img.shields.io/badge/HACS-custom-41BDF5?style=flat-square"></a>
<img alt="Home Assistant 2026.9 or newer" src="https://img.shields.io/badge/Home%20Assistant-2026.9%2B-18BCF2?style=flat-square">
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/jazzphone/mantel-link?style=flat-square&color=8e8e93"></a>
</p>

**Mantel** draws your home's screens (the wall tablets, the phones, the sidebar) and runs their features: the Sleep
Screen, pop-ups, notifications, music, Clean Areas. It runs as a Home Assistant App, or in Docker or an LXC next to
Home Assistant. **Mantel Link** is everything Home Assistant needs of it, and nothing of its own:

- **The link.** One authenticated connection to Mantel. Found by itself: "Discovered: Mantel".
- **Your tablets as entities.** Each wall tablet's black screen, photo screensaver, screen in use and Sleep Screen,
  plus Seasonal decorations, the Alarm PIN panel and Live TV, under the entity ids they already have.
- **Your actions.** `mantel.set_black_screen`, `show_popup`, `close_popup`, `notify`, the music, Clean Areas and
  automation-snooze actions, and the same actions under their **HK Frontend names** (`hk_frontend.*`), so existing
  automations and scripts keep working.
- **Mantel's screens in Home Assistant's sidebar**, with Home Assistant's header and sidebar hidden as each screen
  says, a way back from Mantel's menu, and your Home Assistant sidebar in the screen's menu and tab bar.
- **Notifications on your phone** through the Home Assistant Companion app, with Dismiss.
- **The doorbell's talk-back** (a hold-to-talk clip on a speaker, live talk to a UniFi Protect doorbell), the
  helper-sensor read Mantel's Energy page needs, the Lights page's "Tonight" list, and **Live TV's transcode**
  (the channel cameras Home Assistant's go2rtc plays, where Mantel runs as the Home Assistant App).

Mantel Link answers HK Frontend's action names too, so a house that moves from **HK Frontend** keeps its automations,
and every entity keeps its id and history: [Moving from HK Frontend](docs/Moving-from-HK-Frontend.md).

## Mantel, HK Frontend and Mantel Link

[HK Frontend](https://github.com/jazzphone/hk-frontend) is HK inside Home Assistant, a product of its own built from
the same code as Mantel. Mantel Link and HK Frontend can be installed together: one of them shows Mantel's entities
(Mantel Settings → Connections → Home Assistant → Moving from HK Frontend → Advanced → The Bridge), each wall tablet
is run by Mantel or by HK Frontend, and while Mantel runs the house HK Frontend’s dashboards use Mantel’s settings.
You don't need HK Frontend to use Mantel, and moving everything to Mantel is a choice
([Moving from HK Frontend](docs/Moving-from-HK-Frontend.md);
[HK Frontend and Mantel](https://github.com/jazzphone/mantel/wiki/HK-Frontend-and-Mantel) in Mantel's guide).

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
| **Backups** | Inside Home Assistant's backups, plus **Back Up Now**, download and restore in Mantel Settings | Mantel's own nightly encrypted backups, with download and restore in Mantel Settings | Inside Home Assistant's backups | Each one's own | Inside Home Assistant's backups |
| **Who runs the house** (Seasonal Decorations, the Alarm PIN keypad, Live TV) | Mantel | Mantel | HK Frontend | Mantel or HK Frontend: **The House**, in Mantel Settings | Holds the house's entities when Mantel runs it |
| **Needs Home Assistant** | Yes: Home Assistant OS or Supervised, 2026.8 or newer | Yes: any Home Assistant 2026.8 or newer it can reach | Yes: 2026.8 or newer | Yes | Yes: any install type, 2026.9 or newer |
| **Installed from** | Home Assistant's App store, with Mantel's repository | Docker Compose, or a script that makes a Proxmox LXC | HACS (custom repository) | HACS, plus Mantel | HACS (custom repository) |

**Why you would use each.** **HK Frontend** is the simplest: install it from HACS and HK's screens appear on Home Assistant's own dashboards, for everyone who already signs in to Home Assistant. **Mantel** is for a household: people who shouldn't need a Home Assistant account, roles per room, wall tablets that sign themselves in, an audit log of every command, and screens that Home Assistant's updates can't disturb. Run it as the **Mantel App** if you have Home Assistant OS, or with **Docker or the LXC** to keep it on a machine of its own. **Mantel Link** goes with Mantel: it is how Home Assistant's automations, entities and Companion-app notifications reach Mantel. And you can **link HK Frontend to Mantel** to keep HK on Home Assistant's dashboards while Mantel runs the tablets and keeps one copy of the settings.

[Mantel](https://github.com/jazzphone/mantel) ([guide](https://github.com/jazzphone/mantel/wiki)) ·
[HK Frontend](https://github.com/jazzphone/hk-frontend) ([guide](https://github.com/jazzphone/hk-frontend/wiki)) ·
[Mantel Link](https://github.com/jazzphone/mantel-link) ·
[Running them together](https://github.com/jazzphone/mantel/wiki/HK-Frontend-and-Mantel)
<!-- /products-table -->

## Install

1. Mantel itself first: the Mantel App (Home Assistant OS or Supervised), or Mantel in Docker or the LXC
   ([Install](https://github.com/jazzphone/mantel/wiki/Install) in Mantel's guide).
2. HACS → ⋮ → Custom repositories → this repository, category Integration → download **Mantel Link** → restart
   Home Assistant.
3. Settings → Devices & Services: **Discovered: Mantel** → Add. [Setup](docs/Setup.md) has every way.

Home Assistant 2026.9 or newer.

## Documentation

- [Setup](docs/Setup.md): discovered from the App, discovered on the network, or by hand.
- [Actions](docs/Actions.md): every action, its fields and what it answers.
- [Moving from HK Frontend](docs/Moving-from-HK-Frontend.md): one house, step by step, reversible.
- [How it works](docs/How-It-Works.md): the link, what it mirrors, the hand-over, security.
- [Mantel's guide](https://github.com/jazzphone/mantel/wiki): installing and running Mantel itself, and
  [Mantel Link](https://github.com/jazzphone/mantel/wiki/Mantel-Link) from Mantel's side.
- [HK Frontend's wiki](https://github.com/jazzphone/hk-frontend/wiki): the screens, which Mantel and HK Frontend share.

## Privacy and security

Mantel Link talks only to your Mantel. Its credential is a Mantel Service credential limited to the link; it is never
logged or shown in diagnostics, and an Owner revokes it in Mantel Settings → Service Accounts. Mantel can't make Home
Assistant do anything over the link except send its own notifications to a Companion-app phone. Talk-back plays a
clip only on a speaker Mantel names after its own checks, with your Mantel credential, as any Home Assistant client.

MIT License.
