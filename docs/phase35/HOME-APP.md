# Live TV in Apple's Home app

The owner, 2026-11-25: a native way for someone who never opens Mantel to put a Live TV channel on the Apple HomeView
from Apple's own Home app. "The setup could setup Home Assistant, the Bridge, and the AirPlay Pairing all on the same
screen."

Phase 35 already plays a channel on a paired AirPlay screen ([PLAN.md](PLAN.md): `Sender` in
`cameras/airplay_out/routes.py`). This adds the Home app's way to ask it.

**A TV a screen** (the owner, 2026-11-26). The first build had a button per channel and a Stop per screen ("Having a
stop option will confuse someone"), the second a switch per channel ("If the Switch is on, its playing, when you turn
it off, it stops"). Then: "TV would look better though from a UI perspective than a bunch of switches.. Last Channel
Watched or Default Channel selection would solve the time cost as well...it would also have the TV glyph in HomeKit".
So each paired screen with a channel checked is one TV in the Home app, its inputs those channels, on exactly while
Live TV plays there.

## How a tap reaches the screen

1. **Settings → Live TV → Home App** (an Owner or Admin): a group for each paired screen, a checkmark for each channel
   (its TV's inputs, in the order checked), and When Turned On (Last Watched, or one of its channels). Saved as Live
   TV's settings (`live_tv.buttons` = `[{screen, channel}]`, the first build's name; `live_tv.power_on` = `{screen:
   "last" | channel}`; `live_tv.homekit`), through the page's `hk_tv/settings/set` (`pages/feature_pages.py`), versioned
   and audited as every feature setting. The same page pairs a screen (AirPlay Screens' own pairing), says how Home
   Assistant stands, adds the TVs to HomeKit and shows each one's code to scan.
2. **Mantel publishes** (`cameras/live_tv_buttons.py`, through `linked_house`): a `media_player` for each screen with
   a channel ("Den HomeView Live TV", device class `tv`, `features.sources` its inputs, `features.live_tv_home`), and
   the sensor `sensor.mantel_live_tv` ("Mantel Live TV": how many; `features.homekit` `{bridge: "live_tv_tv", want,
   include}` names the TVs wanted in HomeKit). A TV's unique id is the screen's id, so a rename keeps the entity and
   its place in the Home app. No device: Home Assistant 2026.9 puts a device's name before each entity's, which the
   Home app would show. Published only while the house is Mantel's.
3. **Mantel Link** with `live_tv_tv` (0.1.18) mirrors each TV (its `media_player` platform) and gives it a HomeKit
   entry of its own (`homekit_tvs.py`): HomeKit's import flow, accessory mode, "Mantel <TV's name>". The Home app
   shows a TV only as an accessory of its own; Home Assistant warns of one in a bridge. An entry is found again by the
   TV's entity in it, never by its name. A screen whose TV goes loses its entry. Each entry's state goes back to
   Mantel as `report.homekit_tvs`; Settings draws each code and its QR.
4. **A tap in the Home app** turns the TV on or off or picks an input; the Remote in Control Center sends play/pause
   (on or off) and its arrows (up and down: Mantel Link's `homekit_tv_remote_key_pressed` listener, as next and
   previous channel). Mantel Link sends `entity_command` (`select_source` with `{source}`). Mantel plays or stops the
   screen's show as the linked Service actor `mantel:linked`, audited with `via: home_app`:
   - **on** (or play): what When Turned On says (`hk_core.live_tv_buttons.turn_on_channel`): its channel, or the
     channel last watched on that screen (kept across restarts in `linked_owners`' store, from every show however it
     started), else the TV's first; nothing new while the screen already plays.
   - **an input**: that channel. **Next / previous**: the TV's next or previous channel, round the end.
   - **off** (pause, stop): the screen's show ends.
   A screen that is slow to start answers `starting` after 6 s (Mantel Link waits 8) and plays on.
5. **The TV shows what plays.** The sender tells `on_change` each time a screen's show starts or ends, whatever ended
   it, and `linked_house.refresh` sends the TV's state (`playing` or `off`) and input (`LB.tv_state`). Live TV started
   from Mantel's own page shows the TV on, with its input only when it is one of the TV's channels. Mantel Link shows
   on only once Mantel says so, never on the tap alone.

Scripts can do the same with `mantel.live_tv_play {channel, screen}` and `mantel.live_tv_stop {screen}` (by name or
id/number). Mantel Link's own: not aliased under `hk_frontend.*`, which never had them.

## How a show ends

Each turns the screen's TV off.

- **Off**: the TV, in the Home app, its Remote (play/pause) or Home Assistant, or `mantel.live_tv_stop`.
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
only while a TV is set up, `view` on the `live_tv` feature and on exactly the cameras of the channels a TV
plays, for `mantel:linked` alone; live view (`camera.live`) of the same cameras is added only where live view is
decided (`doorbell_policy`). The cache key carries the cameras, which `LiveTvButtons.recompute` works out when the
TVs, the screens or the house change (never inside `policy_for`). A script can play only a channel a TV has.

## What it needs

- Live TV played by Mantel (its own go2rtc) and an https address a screen can fetch (phase 35's needs).
- Mantel Link 0.1.18 or newer connected, the house run by Mantel.
- Each TV added in the Home app once (its code on the page).

## From the switches (Mantel 0.1.170-main.6ce2359fe, Mantel Link 0.1.17)

The switches were on the house from 2026-11-25. Either can go first; each piece changes over only once both are new:

- **Mantel first, Mantel Link 0.1.17 still on**: Mantel publishes TVs and no switches. 0.1.17 has no `media_player`
  platform, so it ignores the TVs (a warning a TV), drops the switches from its state machine, and its sensor's
  `homekit.bridge` is no longer `live_tv`, so its bridge waits, untouched: the Home app's switches stop answering
  until Mantel Link 0.1.18.
- **Mantel Link 0.1.18 first, Mantel still on the switches**: it mirrors the switches as before and their bridge keeps
  serving them (the Home app keeps working); it makes no TV entries while Mantel's sensor says `live_tv`.
- **Both new**: Mantel Link removes the switches' bridge, "Mantel Live TV", and the switches' registry entries Mantel no
  longer sends, and makes an entry for each TV. The Home app shows the TVs as new accessories, each added with its own
  code and put in its room; the old switch tiles leave with their bridge.

So Mantel Link 0.1.18 can go first and nothing stops working until the Mantel hotfix.

## Limits

- One HomeKit pairing a screen: a house with three screens scans three codes.
- No volume: the HomeView's own volume is its own (Control Center's Remote shows no volume for these TVs).
- Siri turns a TV on and off; picking an input by voice is HomeKit's to allow, not checked on a real Home app yet.
- Unchecking a screen's last channel while the TVs are in the Home app asks first: its TV leaves the Home app, and adding
  a channel again needs a new code.
- The pause codes are the airplay-cli work's, from a HomeView's remote; the house's one show so far sent one
  `sendMediaRemoteCommand` 24 s in, then went on fetching for two minutes. Not measured on a real Home app: the suites
  cover Mantel's side with a fake screen and Mantel Link's with HomeKit stood in for.
