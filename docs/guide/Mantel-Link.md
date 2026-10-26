# Mantel Link

Mantel Link is the Home Assistant integration that connects Home Assistant to
Mantel. It shows your wall tablets and a few house features as Home Assistant
entities, gives your automations Mantel's actions (also under their HK
Frontend names), puts Mantel's screens in Home Assistant's sidebar, and
delivers Mantel's notifications to Companion-app phones. It has no screens of
its own, and works on every Home Assistant install type. It can run beside
[HK Frontend](HK-Frontend-and-Mantel.md), HK inside Home Assistant.

Mantel Link's own documentation has every detail:
[Setup](https://github.com/jazzphone/mantel-link/blob/main/docs/Setup.md),
[Actions](https://github.com/jazzphone/mantel-link/blob/main/docs/Actions.md),
[How it works](https://github.com/jazzphone/mantel-link/blob/main/docs/How-It-Works.md).
<!-- RELEASE: the public repository jazzphone/mantel-link must exist (built by hosts/ha/custom_components/mantel/tools/publish/publish.py; nothing is pushed yet) before these links and the HACS steps below work. -->

## Do you need it?

| You want | Mantel Link |
|---|---|
| Mantel's screens on wall tablets, phones and computers | Not needed |
| Automations that black a tablet's screen, open a pop-up or send a notification | Needed |
| Each tablet's black screen, screensaver and Sleep Screen as entities | Needed |
| Mantel's screens in Home Assistant's sidebar or the Companion app | Needed (and, for Mantel outside Home Assistant, [Mantel Connect](Mantel-Connect.md) for the sidebar page) |
| Mantel's notifications on Companion-app phones | Needed |
| The doorbell's talk-back, the Energy page's helper sensors, the Lights page's "Tonight" list | Needed |

## Install

You need Mantel itself first ([Install](Install.md)) and Home Assistant
2026.9 or newer (Mantel Server and HK Frontend alone need only 2026.8; see [Install](Install.md#before-you-start)).

1. In HACS, **⋮ → Custom repositories**, add
   `https://github.com/jazzphone/mantel-link`, category **Integration**.
2. Download **Mantel Link**, then restart Home Assistant.
3. **Settings → Devices & services.** Under **Discovered**, **Mantel → Add**.

<!-- RELEASE: Mantel Link is not in HACS's default list; step 1 is the custom-repository route until it is. -->

### The three ways to link

| Mantel runs as | How Home Assistant finds it | What you do |
|---|---|---|
| The Home Assistant App | The App tells Home Assistant, with a credential made for Mantel Link | **Discovered: Mantel → Add**, confirm |
| Docker or the Proxmox container | Mantel announces itself on your network (`_mantel._tcp`) with no credential | In Mantel: **Mantel Settings → Connections → Home Assistant → Mantel Link → Make a Pairing Code**. In Home Assistant: **Discovered: Mantel → Add**, and enter the code |
| Anything | By hand | **Add Integration → Mantel Link**: Mantel's `https://` address, and a pairing code or a Service credential |

A pairing code works once, for ten minutes. Both sides prove they know it, so
a look-alike on your network can't hand Home Assistant a credential. Both
proofs also name the address Home Assistant used (Mantel Link 0.1.6 and a
Mantel 0.1.79 or later): Mantel refuses an address that isn't its own, so a
device at another address that passed the exchange on to the real Mantel gets
nothing. Enter Mantel's own address, the one Mantel Settings shows.

- **"Mantel says that isn't its address"**: Home Assistant reached Mantel by a
  name Mantel doesn't know as its own, or something else answered for it.
  Use Mantel's own address. The code isn't spent by this.
- **"Update Mantel first"**: that Mantel is older than Mantel Link 0.1.6 and
  pairs only without the address. Mantel Link doesn't fall back to that;
  update Mantel, then make a new code.

Home Assistant keeps the address it was linked with. If Mantel moves to a new
address, give it the new one with **Settings → Devices & services → Mantel
Link → ⋮ → Reconfigure**: an announcement on the network never changes it,
since anyone can announce Mantel's name.

In Docker, multicast doesn't leave Docker's own networks, so the announcement
needs the `announce` service (`compose.announce.yaml`) or the host's own
avahi. Without either, add Mantel Link by hand. Home Assistant must also trust
Mantel's certificate: a certificate from Caddy's own authority is refused
until you trust it where Home Assistant runs.

Plain `http://` is accepted only for the Mantel App on the same machine (its
address on Home Assistant's internal App network, such as
`http://local-mantel:8099`; Discovered: Mantel fills it in), so the credential
never crosses your network in clear. Home Assistant links to one Mantel.

## What it shows in Home Assistant

Mantel describes each entity and sends its state; Mantel Link shows it. While
the link is down they are unavailable.

**For each wall tablet** (its own device):

| Entity | What it is |
|---|---|
| `switch.<tablet>_black_screen` | The tablet's black screen. Its `confirmed` attribute turns on when the screen has really gone black. Use `mantel.set_black_screen` to set the brightness it comes back to. |
| `switch.<tablet>_photo_screensaver` | The photo screensaver |
| `sensor.<tablet>_sleep_screen` | The Sleep Screen's state |
| `binary_sensor.<tablet>_screen_in_use` | Someone is using the screen |

**For the house** (Seasonal decorations on a device named "Mantel"; each
keypad and Live TV's entities as Mantel describes them):

| Entity | What it is |
|---|---|
| Seasonal decorations (a switch) | HK's [Seasonal Decorations](https://github.com/jazzphone/hk-frontend/wiki/Seasonal-Decorations) on or off |
| An Alarm PIN panel for each keypad | Arms and disarms the alarm it protects, after Mantel checks the house Alarm PIN |
| `sensor.tv_viewers`, a "now on" sensor and a camera per channel | Live TV, when Mantel serves it |

The tablet entities keep the entity ids HK Frontend gave them. On a Home
Assistant that never had HK Frontend, new ones are suggested with `mantel_`.

**Actions.** `mantel.set_black_screen`, `mantel.show_popup`,
`mantel.close_popup`, `mantel.notify`, the music actions, `mantel.clean_areas`,
`mantel.pause_automation` and `mantel.resume_automation`. Each one is checked
by Mantel and answers; a refusal is the action's error, in words. The music,
Clean Areas and automation-snooze actions control the house through Mantel,
so they need house commands on ([Commands and Audit](Commands-and-Audit.md)).

## What Mantel can make Home Assistant do

Almost nothing, by design. Over the link Mantel can only:

- change the entities Mantel Link shows, and
- send one of its notifications to a Companion-app phone that Home Assistant
  already has (`notify.mobile_app_*`).

Talk-back plays a clip only on the speaker Mantel names, after Mantel's own
checks and audit. Mantel Link's credential is a Mantel Service credential
limited to the link; it is never logged or shown in diagnostics, and an Owner
revokes it in **Mantel Settings → Service Accounts** (under Advanced).

## Linked mode and the bridge

While a home moves from HK Frontend, both integrations can be installed.
Exactly one of them shows Mantel's entities at a time; this is **the bridge**.

- **HK Frontend holds it** to begin with. HK Frontend in **linked mode**
  (**Configure → Linked to Mantel**) forwards its actions to Mantel and shows
  the entities Mantel sends. Mantel Link, installed beside it, stays
  **dormant**: linked, its actions work, but it shows nothing.
- **Mantel Link takes it** when an Owner selects **Hand the Bridge to Mantel
  Link** (**Mantel Settings → Connections → Home Assistant → Moving from HK Frontend → Advanced**). HK
  Frontend lets go of each entity, and Mantel Link takes over the same registry
  entry: the same entity id, unique id, history, area and name.
- **Give the Bridge to HK Frontend** reverses it, the same way.

`hk_frontend.set_black_screen` keeps working throughout. Removing Mantel Link
while it holds entities hands them back to HK Frontend first, so no entity id
is lost.

## Per-tablet ownership

During a move, each wall tablet is run by **Home Assistant** (HK Frontend's
own engines, as before) or by **Mantel**, and so is the rest of the house
(Seasonal decorations, the Alarm PIN panel, Live TV).

| | Run by Home Assistant | Run by Mantel |
|---|---|---|
| Its four entities | HK Frontend's own | Mantel's, shown by whoever holds the bridge |
| Its Sleep Screen and black screen | HK Frontend's engine | Mantel's |
| `set_black_screen` on it | Handled in Home Assistant | Sent to Mantel |
| Pop-ups and notifications | Shown on Home Assistant's screens, and sent to Mantel too while Mantel runs any tablet | |

An Owner moves them one at a time under **Mantel Settings → Connections → Home Assistant → Moving from HK Frontend**, group **Wall Tablets**
(each tablet's switch: **Run by Mantel**). The rest of the house moves only
after every tablet, and no tablet moves back while the rest of the house is
Mantel's. Every move is in the [Audit Log](Commands-and-Audit.md). A tablet
moved back gets its Home Assistant entities back under the same entity ids.

The full sequence is in [Moving from HK Frontend](Moving-from-HK-Frontend.md).

## Mantel without HK Frontend

You don't need HK Frontend at all. On a Home Assistant without it:

- Mantel Link shows Mantel's entities straight away (there is no bridge to
  hand over).
- Mantel runs the house by itself: once Mantel Link reports that Home Assistant
  has no HK Frontend, Mantel takes **The House** (Seasonal Decorations, the
  Alarm PIN keypads, Live TV's sensors and channels) and says so in the Audit
  Log. There is nothing to switch on.
- Mantel Link answers the `hk_frontend.*` action names too, so automations and
  scripts written for HK Frontend keep working. When you remove HK Frontend,
  Mantel Link takes those names over as soon as HK Frontend's entry is
  deleted.
- Mantel keeps everything HK Frontend used to keep: every setting, the Alarm
  PIN keypads, accessories, Hidden Accessories, music and Live TV settings.
- Mantel's screens appear in Home Assistant as **Webpage** dashboards: open a
  screen in Mantel Settings and turn on **Show in Home Assistant**. The switch
  is there once Mantel has an address of its own that browsers reach (direct
  access; in the App, **Direct access** set to `proxy` or `https`). With the
  screen's setting, Home Assistant's header and sidebar are hidden around it,
  and the screen's menu offers your Home Assistant sidebar's pages.

What goes away with HK Frontend: its own dashboards inside Home Assistant, the
**HK Settings** panel (it is Mantel Settings now) and its engines in Home
Assistant (Mantel has its own).

Once HK Frontend is removed, Mantel refuses to move a tablet back to Home
Assistant, because nothing in Home Assistant would run it. Reinstall HK
Frontend's last release and link it first.

## Diagnostics

**Mantel Link → ⋮ → Download diagnostics** shows whether it is linked, to which
Mantel, what it shows, and what HK Frontend is doing. It never includes the
credential.

**Mantel Settings → Connections → Home Assistant** shows the same from Mantel's
side: under **Mantel in Home Assistant**, what is linked; under **Moving from HK
Frontend**, who holds the bridge and who runs each tablet.
