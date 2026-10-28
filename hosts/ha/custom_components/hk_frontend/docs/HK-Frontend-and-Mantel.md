# HK Frontend and Mantel

<!-- RELEASE: the Mantel links below work once jazzphone/mantel is public. -->

HK's screens come in two products. They share their code, so a new page or
feature usually lands in both, and you can run either one or both.

- **HK Frontend** (this wiki) is HK inside Home Assistant: HK's screens on
  Home Assistant's own dashboards.
- **[Mantel](https://github.com/jazzphone/mantel)** serves the same screens
  from a server of its own, as a Home Assistant App, with Docker, or in a
  Proxmox LXC. Its guide is [its wiki](https://github.com/jazzphone/mantel/wiki).
- **[Mantel Link](https://github.com/jazzphone/mantel-link)** is Mantel's
  integration in Home Assistant.

## Which one?

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

## Running both

Install [Mantel](https://github.com/jazzphone/mantel/wiki/Install) and, in Home
Assistant, [Mantel Link](https://github.com/jazzphone/mantel/wiki/Mantel-Link#install).
Link HK Frontend to Mantel (HK Frontend's Configure → Linked to Mantel,
[HK Settings](HK-Settings.md); Mantel Settings → Connections → Home Assistant →
HK Frontend → **Link HK Frontend…** gives you its credential). Then, in Mantel Settings →
Connections → Home Assistant → **Moving from HK Frontend** ([Mantel Link](https://github.com/jazzphone/mantel/wiki/Mantel-Link)):

- **The Bridge** (its **Advanced**): one of the two shows Mantel's entities in Home Assistant.
  Mantel Link is recommended. Entity ids and history stay the same whichever
  holds it, so your automations keep working.
- **Each wall tablet** (Moving from HK Frontend → Wall Tablets, **Run by
  Mantel**): each tablet has one engine, Mantel or HK Frontend. A tablet on Mantel's screens should be run by Mantel; one showing
  HK Frontend's dashboards, by HK Frontend. Never point a tablet Mantel runs at
  an HK Frontend dashboard: both would try to put its screen to sleep.
- **The House** (its **Advanced**): Seasonal Decorations, the Alarm PIN keypad and Live TV's
  sensors and channels, run by one of them.

**One copy of the settings while Mantel runs the house.** With The House
run by Mantel, HK's settings are Mantel's: HK Frontend's dashboards in Home
Assistant draw with them (and keep drawing with the last ones while Mantel
restarts), and a change made on those dashboards, such as a favorite or a
calendar's color, is saved in Mantel as the person linked to your Home
Assistant user. An Owner turns that on under Connections → Home Assistant → HK Frontend →
**Changes from Home Assistant**, and links each Home Assistant user to a
person on **People**. Settings
pages stay in Mantel Settings. Move The House back to Home Assistant, or
unlink, and HK Frontend keeps Mantel's last settings as its own.

While The House is Home Assistant's, each keeps its own: Mantel can import
HK Frontend's settings once, and after that a change on one side does not
reach the other.

While Mantel runs the house, HK Frontend steps aside: its features' actions
(`hk_frontend.music_play`, `clean_areas`, pausing an automation, ...) are run
by Mantel under the same names, and Add feature, Configure and every item on
HK Frontend's page in Home Assistant point to Mantel Settings. The items stay
listed only for the day the house is handed back.

## Each screen, in one place

Every screen is drawn either by Mantel or by HK Frontend in Home Assistant, and
its page in Mantel Settings says which (**Where**). **Add Screen** asks where
first; for Home Assistant, Mantel makes the dashboard there for you. A screen
both have at the same address (an old HK Frontend dashboard Mantel imported)
is marked, and its page offers to keep it Mantel's (and remove Home
Assistant's), make it Home Assistant's, or split it in two.

## Moving everything to Mantel

You don't have to, but you can: [Moving from HK Frontend](https://github.com/jazzphone/mantel/wiki/Moving-from-HK-Frontend)
moves one tablet at a time, and HK Frontend can be removed at the end.
