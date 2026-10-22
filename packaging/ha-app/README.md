# Mantel

**Beautiful home screens for your whole household, served by Home Assistant.**

Mantel gives every wall tablet, phone and browser in your home a polished, touch-first home screen: rooms,
lights, climate, cameras, the doorbell, music, energy and more, laid out for the room it's in. Everyone signs in
as themselves, sees what their role allows, and every change to the house is recorded.

## What you get

- **Home screens for every room.** Wall tablets open straight to their own room's screen, full screen, with a
  screensaver, a clock and photos when nobody is using them.
- **People and roles.** Owner, Admin, Adult, Child and Guest, linked to your Home Assistant accounts. Each role
  decides what someone may see and control, room by room, and you can fine-tune it with grants.
- **Safe by default.** Mantel starts read-only. You choose when people may control the house, and every command
  is written to the Audit Log. The alarm always asks for the house Alarm PIN.
- **The iPhone, iPad and Mac apps**, with notifications, and Home Assistant's own sidebar and Companion app.
- **Mantel Link** (optional): Mantel's integration in Home Assistant, for automations, notifications and the
  tablets as devices.

## Getting started

1. **Start** the App and open **Mantel** in the sidebar.
2. **Become the Owner.** If your Home Assistant account is an administrator, Mantel offers *Make me Mantel's
   Owner*. Press it once.
3. **Open Mantel Settings** and follow **Set Up Mantel**. It walks you through linking
   your household's accounts, your screens and your wall tablets, one step at a time.

Needs Home Assistant **2026.8** or newer (Mantel Link needs **2026.9**).

## Where the settings are

Almost everything is in **Mantel Settings**, not here: who may control the house, the default screen, how
long sign-ins from away last, Home Assistant's sign-in address, Music Assistant, people, roles and screens.
The **Configuration** tab holds only what Mantel needs in order to start: how it is reached (the sidebar only,
your own proxy, or its built-in HTTPS), its own address for that, and a **Read-only** kill switch that stops
Mantel sending anything to the house whatever Mantel Settings says.

## Help

- The **Documentation** tab: options, wall tablets, direct access and security, in detail.
- In Mantel: **Mantel Settings → About → Documentation** has the full guide.
- Backups: Home Assistant's backups include Mantel (its people, settings, photos and keys).
