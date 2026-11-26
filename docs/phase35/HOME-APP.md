# Live TV in Apple's Home app

The owner, 2026-11-25: a native way for someone who never opens Mantel to put a Live TV channel on the Apple HomeView
from Apple's own Home app. "The setup could setup Home Assistant, the Bridge, and the AirPlay Pairing all on the same
screen."

Phase 35 already plays a channel on a paired AirPlay screen ([PLAN.md](PLAN.md): `Sender` in
`cameras/airplay_out/routes.py`). This adds the Home app's way to ask it.

**Switches, not buttons** (the owner, the same day). The first build had a button per channel and a Stop per screen;
the owner: "Having a stop option will confuse someone", then "If the Switch is on, its playing, when you turn it off,
it stops". So each channel on a screen is one switch, on exactly while that channel plays there.

## How a tap reaches the screen

1. **Settings → Live TV → Home App** (an Owner or Admin): a group for each paired screen, a checkmark for each channel.
   Saved as Live TV's settings (`live_tv.buttons` = `[{screen, channel}]`, `live_tv.homekit`), through the page's
   `hk_tv/settings/set` (`pages/feature_pages.py`), versioned and audited as every feature setting. The same page pairs
   a screen (AirPlay Screens' own pairing), says how Home Assistant stands, and adds the HomeKit Bridge and shows its
   code to scan.
2. **Mantel publishes** (`cameras/live_tv_buttons.py`, through `linked_house`): a `switch` for each kept one ("NBC on
   Den HomeView", `features.live_tv_home`), and the sensor `sensor.mantel_live_tv` ("Mantel Live TV": how many;
   `features.homekit` carries the bridge's wish and the switches it holds). Unique ids are the screen's id and the
   channel's number, so a rename keeps an entity and its place in the Home app. No device: Home Assistant 2026.9 puts a
   device's name before each entity's, which the Home app would show. Published only while the house is Mantel's; any
   Mantel Link mirrors them (every one has switches).
3. **Mantel Link** with `live_tv_home` (this release) keeps a HomeKit Bridge entry of their own, **"Mantel Live TV"**
   (`homekit_entry.py`, beside phase 31's "Mantel Alerts"): HomeKit's import flow, bridge mode, exactly the switches
   Mantel names. A changed list changes the entry's filter and reloads it (the pairing stays). Its state goes back to
   Mantel as `report.homekit_tv`; Settings draws the code and its QR. Nothing else in Home Assistant is touched.
4. **A tap in the Home app** turns the switch on or off. Mantel Link sends `entity_command turn_on` / `turn_off`;
   on plays the channel on the screen as the linked Service actor `mantel:linked`, audited with `via: home_app`. Off
   stops the screen's show only while it is that switch's channel. A screen that is slow to start answers `starting`
   after 6 s (Mantel Link waits 8) and plays on.
5. **The switch shows what plays.** The sender tells `on_change` each time a screen's show starts or ends, whatever
   ended it, and `linked_house.refresh` sends the switches' states: on is "this channel plays on this screen"
   (`hk_core.live_tv_buttons.is_on`). One show a screen, so turning on another channel turns the first one's switch
   off. Mantel Link shows on only once Mantel says so, never on the tap alone.

Scripts can do the same with `mantel.live_tv_play {channel, screen}` and `mantel.live_tv_stop {screen}` (by name or
id/number). Mantel Link's own: not aliased under `hk_frontend.*`, which never had them.

## How a show ends

Each turns its switch off.

- **Off**: the switch, in the Home app or Home Assistant, or `mantel.live_tv_stop`.
- **Paused on the screen's remote**: the screen says so on its event channel at once (`sendMediaRemoteCommand`
  `paus`, or `plps`; the codes from the airplay-cli notes), and the show ends `PAUSE_END_S` (5 s) later unless it is
  played again (the owner: "Should we kill after 5 seconds for example. Worst case, someone just has to restart
  right?"). On the house, 2026-11-25: the remote's press reached Mantel the second it was made, but the player went on
  fetching the stream for two minutes more, so the fetches alone ended that show three and a half minutes later.
- **The screen leaves the stream** (another app, its own close): nothing fetches it, and Live TV lets it go
  `SCREEN_HOLD_S` (30 s) after the last fetch (`live_tv.hold`; a page's own 90 s hold is never cut short by it), and
  the show ends with it (phase 35's `stream_dropped`).
- **The safety net**: every AirPlay show (the Home app's, the page's Play On, the iPhone app's) ends 2 hours after it
  started, whatever the screen does (`MAX_SHOW_S`; the owner, 2026-11-25). Turning it on again starts it again.

## Who may watch

Live TV's gate and the stream's key (asked again on every fetch the screen makes) decide with `Authz.policy_for`, not
the command gateway, so the linked actor's grants in `linked_actions.py` never reached them. `Authz.policy_for` adds,
only while a switch is set up, `view` on the `live_tv` feature and on exactly the cameras of the channels a switch
plays, for `mantel:linked` alone; live view (`camera.live`) of the same cameras is added only where live view is
decided (`doorbell_policy`). The cache key carries the cameras, which `LiveTvButtons.recompute` works out when the
switches, the screens or the house change (never inside `policy_for`). A script can play only what a switch plays.

## What it needs

- Live TV played by Mantel (its own go2rtc) and an https address a screen can fetch (phase 35's needs).
- Mantel Link connected, the house run by Mantel (the switches); Mantel Link with `live_tv_home` for the bridge.
- The HomeKit Bridge added in the Home app once (the code on the page).

## From the buttons (Mantel 0.1.170, Mantel Link 0.1.16)

The buttons shipped on 2026-11-25. The switches keep their unique ids (the screen's id and the channel's number), so:

- **Mantel first, Mantel Link 0.1.16 still on**: 0.1.16 mirrors switches already; a unique id whose platform changed
  is dropped from its registry and added again as a switch (its bridge.py ``_upsert``), so the switches work in Home
  Assistant at once (new entity ids, `switch.*`). Its HomeKit Bridge looks for `button.*` entities and finds none, so
  it waits, untouched: the Home app's tiles stop answering until Mantel Link 0.1.17. The Stops are left behind as
  unavailable buttons.
- **Mantel Link 0.1.17**: removes every button it had from the registry at setup (it has no button platform now),
  and its bridge takes the switches: the same entry, its filter changed and reloaded, the pairing kept. The Home app
  shows them as new accessories, to be put in their rooms again.
- **Mantel Link 0.1.17 with Mantel 0.1.170**: that Mantel sends buttons only to a link that says `buttons`, which
  0.1.17 doesn't: nothing is mirrored and the bridge waits until Mantel's hotfix.

So the two go out together, Mantel's hotfix first; neither alone breaks anything but the Home app's tiles meanwhile.

## Limits

- Unchecking the last switch while the bridge is in the Home app asks whether to remove the bridge too. Kept, it
  stays paired with its old list (its switches don't answer) until one is added again; an empty bridge is never made.
- The pause codes are the airplay-cli work's, from a HomeView's remote; the house's one show so far sent one
  `sendMediaRemoteCommand` 24 s in, then went on fetching for two minutes, its value not logged then (each press is
  now). Not measured on a real Home app: the suites cover Mantel's side with a fake screen and Mantel Link's with
  HomeKit stood in for.
