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
Connections → [Mantel in Home Assistant](https://github.com/jazzphone/mantel/blob/main/docs/guide/Mantel-Link.md):

- **The Bridge:** one of the two shows Mantel's entities in Home Assistant.
  Mantel Link is recommended. Entity ids and history stay the same whichever
  holds it, so your automations keep working.
- **Each wall tablet** (Moving from HK Frontend → Wall Tablets, **Run by
  Mantel**): each tablet has one engine, Mantel or HK Frontend. A tablet on Mantel's screens should be run by Mantel; one showing
  HK Frontend's dashboards, by HK Frontend. Never point a tablet Mantel runs at
  an HK Frontend dashboard: both would try to put its screen to sleep.
- **The House:** Seasonal Decorations, the Alarm PIN keypad and Live TV's
  sensors and channels, run by one of them.

**One copy of the settings while Mantel runs the house.** With The House
run by Mantel, HK's settings are Mantel's: HK Frontend's dashboards in Home
Assistant draw with them (and keep drawing with the last ones while Mantel
restarts), and a change made on those dashboards, such as a favorite or a
calendar's color, is saved in Mantel as the person linked to your Home
Assistant user. An Owner turns that on under Mantel in Home Assistant → HK Frontend →
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

You don't have to, but you can: [Moving from HK Frontend](https://github.com/jazzphone/mantel/blob/main/docs/guide/Moving-from-HK-Frontend.md)
moves one tablet at a time, and HK Frontend can be removed at the end.
