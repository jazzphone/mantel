# Live TV in Apple's Home app

The owner, 2026-11-25: a native way for someone who never opens Mantel to put a Live TV channel on the Apple HomeView
from Apple's own Home app. "The setup could setup Home Assistant, the Bridge, and the AirPlay Pairing all on the same
screen."

Phase 35 already plays a channel on a paired AirPlay screen ([PLAN.md](PLAN.md): `Sender` in
`cameras/airplay_out/routes.py`). This adds the Home app's way to ask it.

## How a tap reaches the screen

1. **Settings → Live TV → Home App** (an Owner or Admin): a group for each paired screen, a checkmark for each channel.
   Saved as Live TV's settings (`live_tv.buttons` = `[{screen, channel}]`, `live_tv.homekit`), through the page's
   `hk_tv/settings/set` (`pages/feature_pages.py`), versioned and audited as every feature setting. The same page pairs
   a screen (AirPlay Screens' own pairing), says how Home Assistant stands, and adds the HomeKit Bridge and shows its
   code to scan.
2. **Mantel publishes** (`cameras/live_tv_buttons.py`, through `linked_house`): a `button` for each kept button
   ("NBC on Den HomeView"), a Stop for each of those screens ("Stop Live TV on Den HomeView"), and the sensor
   `sensor.mantel_live_tv` ("Mantel Live TV": how many buttons; `features.homekit` carries the bridge's wish and the
   buttons it holds). Unique ids are the screen's id and the channel's number, so a rename keeps an entity and its
   place in the Home app. A `button` goes only to a linked client whose link names `buttons` (Mantel Link from this
   release): an older Mantel Link or HK Frontend never sees one. Published only while the house is Mantel's.
3. **Mantel Link** mirrors them (its `button` platform) and keeps a HomeKit Bridge entry of their own,
   **"Mantel Live TV"** (`homekit_entry.py`, beside phase 31's "Mantel Alerts"): HomeKit's import flow, bridge mode,
   exactly the buttons Mantel names: the channels' buttons, never a Stop (the owner, 2026-11-25: "Having a stop option
   will confuse someone"; the Stops stay in Home Assistant for automations and scripts). A changed list changes the
   entry's filter and reloads it (the pairing stays). Its state goes back to Mantel as `report.homekit_tv`; Settings
   draws the code and its QR. Nothing else in Home Assistant is touched.
4. **A tap in the Home app** presses the button (the Home app shows each as a switch that turns itself off again).
   Mantel Link sends `entity_command press`; Mantel plays the channel on the screen (or stops it) as the linked Service
   actor `mantel:linked`, audited with `via: home_app`. A screen that is slow to start answers `starting` after 6 s
   (Mantel Link waits 8) and plays on.

Scripts can do the same with `mantel.live_tv_play {channel, screen}` and `mantel.live_tv_stop {screen}` (by name or
id/number). Mantel Link's own: not aliased under `hk_frontend.*`, which never had them.

## How a show ends

- **Stop**: the screen's Stop button in Home Assistant (an automation or a script presses it; not in the Home app), or
  `mantel.live_tv_stop`.
- **Paused on the screen**: nothing fetches the stream, Live TV lets it go after its 90 s lease, and the show ends with
  it (phase 35's `stream_dropped`).
- **The safety net**: every AirPlay show (the Home app's, the page's Play On, the iPhone app's) ends 2 hours after it
  started, whatever the screen does (`MAX_SHOW_S`; the owner, 2026-11-25). Pressing the button again starts it again.

## Who may watch

Live TV's gate and the stream's key (asked again on every fetch the screen makes) decide with `Authz.policy_for`, not
the command gateway, so the linked actor's grants in `linked_actions.py` never reached them. `Authz.policy_for` adds,
only while a button is set up, `view` on the `live_tv` feature and on exactly the cameras of the channels a button
plays, for `mantel:linked` alone; live view (`camera.live`) of the same cameras is added only where live view is
decided (`doorbell_policy`). The cache key carries the cameras, which `LiveTvButtons.recompute` works out when the
buttons, the screens or the house change (never inside `policy_for`). A script can play only what a button plays.

## What it needs

- Live TV played by Mantel (its own go2rtc) and an https address a screen can fetch (phase 35's needs).
- Mantel Link with `buttons` connected, the house run by Mantel.
- The HomeKit Bridge added in the Home app once (the code on the page).

## Limits

- Unchecking the last button while the bridge is in the Home app asks whether to remove the bridge too. Kept, it
  stays paired with its old list (its switches don't answer) until a button is added again; an empty bridge is never
  made.
- Not measured on a real HomeView or a real Home app: the suites cover Mantel's side with a fake screen and Mantel
  Link's with HomeKit stood in for.
