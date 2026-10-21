# HK Frontend and Mantel

<!-- RELEASE: the Mantel links below work once jazzphone/mantel is public. -->

HK's screens come in two products. They share their code, so a new page or
feature usually lands in both, and you can run either one or both.

| | **HK Frontend** | **Mantel** (with Mantel Link) |
|---|---|---|
| What it is | HK inside Home Assistant | HK's screens as their own server, beside Home Assistant |
| Where the screens live | Home Assistant's own dashboards | Mantel's pages (and Home Assistant's sidebar, through Mantel Link) |
| Who can use them | Anyone with a Home Assistant account | Mantel's people, with roles, and wall tablets with their own credential; no Home Assistant account needed |
| HK cards on your own Home Assistant dashboards | Yes | No |
| Kiosk, screensaver, Sleep Screen | Inside Home Assistant's page | On Mantel's own page, with nothing of Home Assistant's around it |
| Every command checked and logged | No | Yes ([Commands and Audit](https://github.com/jazzphone/mantel/blob/main/docs/guide/Commands-and-Audit.md)) |
| Remote access without exposing Home Assistant | No | Yes |
| Installed from | HACS | The Mantel App, Docker or the LXC; Mantel Link from HACS |

## Which one?

- **HK Frontend** if you want HK on Home Assistant's dashboards, for people
  who already use Home Assistant, on phones and in the Home Assistant app.
- **Mantel** for wall tablets and households: people who shouldn't need a
  Home Assistant account, roles per room, an audit log, and screens that
  Home Assistant updates can't disturb.
- **Both**, if you want both of those.

## Running both

Install HK Frontend and Mantel Link in Home Assistant and link HK Frontend to
Mantel (HK Frontend's Configure → Linked to Mantel, [HK Settings](HK-Settings.md)). Then, in Mantel Settings →
Connections → [Home Assistant Link](https://github.com/jazzphone/mantel/blob/main/docs/guide/Mantel-Link.md):

- **The Bridge:** one of the two shows Mantel's entities in Home Assistant.
  Mantel Link is recommended. Entity ids and history stay the same whichever
  holds it, so your automations keep working.
- **Who Runs Each Wall Tablet:** each tablet has one engine, Mantel or HK
  Frontend. A tablet on Mantel's screens should be run by Mantel; one showing
  HK Frontend's dashboards, by HK Frontend. Never point a tablet Mantel runs at
  an HK Frontend dashboard: both would try to put its screen to sleep.
- **The House:** Seasonal Decorations, the Alarm PIN keypad and Live TV's
  sensors and channels, run by one of them.

**The settings are separate.** HK Frontend keeps HK's settings in Home
Assistant and Mantel keeps its own. Mantel can import HK Frontend's settings
once, when you start; after that, a change on one side does not reach the
other.

## Moving everything to Mantel

You don't have to, but you can: [Moving from HK Frontend](https://github.com/jazzphone/mantel/blob/main/docs/guide/Moving-from-HK-Frontend.md)
moves one tablet at a time, and HK Frontend can be removed at the end.
