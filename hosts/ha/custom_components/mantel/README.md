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

Mantel Link replaces **HK Frontend**. Moving from it keeps every entity id and its history:
[Moving from HK Frontend](docs/Moving-from-HK-Frontend.md).

## Mantel Link and HK Frontend

[HK Frontend](https://github.com/jazzphone/hk-frontend) is HK inside Home Assistant, a product of its own built from
the same code as Mantel. Mantel Link and HK Frontend can be installed together: one of them shows Mantel's entities
(Mantel Settings → Connections → Mantel in Home Assistant → The Bridge), each wall tablet is run by Mantel or by HK
Frontend, and while Mantel runs the house HK Frontend’s dashboards use Mantel’s settings. You don't need HK Frontend to use Mantel, and moving everything to
Mantel is a choice ([Moving from HK Frontend](docs/Moving-from-HK-Frontend.md)).

## Install

1. Mantel itself first: the Mantel App (Home Assistant OS or Supervised), or Mantel in Docker or the LXC.
2. HACS → ⋮ → Custom repositories → this repository, category Integration → download **Mantel Link** → restart
   Home Assistant.
3. Settings → Devices & Services: **Discovered: Mantel** → Add. [Setup](docs/Setup.md) has every way.

Home Assistant 2026.9 or newer.

## Documentation

- [Setup](docs/Setup.md): discovered from the App, discovered on the network, or by hand.
- [Actions](docs/Actions.md): every action, its fields and what it answers.
- [Moving from HK Frontend](docs/Moving-from-HK-Frontend.md): one house, step by step, reversible.
- [How it works](docs/How-It-Works.md): the link, what it mirrors, the hand-over, security.

## Privacy and security

Mantel Link talks only to your Mantel. Its credential is a Mantel Service credential limited to the link; it is never
logged or shown in diagnostics, and an Owner revokes it in Mantel Settings → Service Accounts. Mantel can't make Home
Assistant do anything over the link except send its own notifications to a Companion-app phone. Talk-back plays a
clip only on a speaker Mantel names after its own checks, with your Mantel credential, as any Home Assistant client.

MIT License.
