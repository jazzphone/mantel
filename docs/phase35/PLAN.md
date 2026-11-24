# Phase 35: Live TV on an Apple HomeView, sent by Mantel (plan, 2026-11-24)

**Status: steps 1-5 built (2026-11-24): the sender (`cameras/airplay_out/`), paired screens and Settings → Live TV → AirPlay Screens, play/stop (socket and app routes, audited), the widget's Play On (mantel-ios 2a53936) and the player's cast button. Step 6 (a hotfix and the owner's run on a HomeView) waits for the owner's OK.** Checked by hand so far: pair-verify, the remote-control session and its event channel from inside `mantel-server` on the house. The owner, on the Live TV widget on Apple HomeView: "there is no way for me to tap the
widget from the HomeView and have the mantel server feed the homeview the AirPlay stream of the channel?", then "Would be
great if we could work out number 1" (Mantel speaking AirPlay itself, not a helper Mac), then "Write the plan".

- Line numbers are left out on purpose: search for the names.
- The protocol below was worked out on one of the house's HomeViews on 2026-11-24, with the owner watching its screen. The
  experiments' scripts lived in that session's scratchpad; what they proved is written here, so the building session needs
  none of them.
- [Building for slow tablets](../development/Slow-tablets.md) binds the one page change (the Live TV page's Play On); the
  rest is server and iPhone.

## The ask

Tap the Live TV widget on an Apple HomeView and the channel plays **on that HomeView's own screen**, picture and sound, with
no phone in the middle. Today a widget tap can't: HomeView's widgets run on the iPhone, so anything a tap opens (Safari, the
app) opens on the phone (mantel-ios, docs/HomeView-widgets.md).

## What was found (2026-11-24)

1. **AirPlay hands the receiver the stream's address and the receiver fetches it itself, without the sender's cookies.**
   Mantel answered the HomeView "401 sign in" until Live TV's HLS address carried its own key (`/go2rtc/key/<key>/`,
   `cameras/stream_keys.py`, hotfix 0.1.169-main.52b67c4b8). Since then Safari's AirPlay from the Live TV page plays on a
   HomeView. That key is what this phase's sender hands over too.
2. **A HomeView plays for any sender paired with the code on its screen**, not only devices in the Home: a Mac signed out
   of iCloud played after a code, and so did a sender paired from Mantel's side ("Mantel"). Pairing is HomeKit's (HAP:
   SRP pair-setup with the on-screen code, then pair-verify and ChaCha20-Poly1305 on every connection). A HomeView shows
   the code only when the pair-pin-start request names the sender (`X-Apple-Client-Name`), as Music Assistant found for
   audio.
3. **The old AirPlay video request (`POST /play` with `Content-Location`, then `/rate`) is answered 200 and ignored**: the
   HomeView never fetches the address, whatever the format (fMP4 HLS, TS HLS, a plain MP4) or the body.
4. **An iPhone hands video over as a play queue on a remote-control stream.** Captured with pyatv's `atvproxy` posing as
   the HomeView (the iPhone paired with the proxy, the proxy with the HomeView, every request decrypted and passed on) and
   then repeated from Mantel's side until the smallest set that shows the picture was known. On one pair-verified RTSP
   connection to the HomeView's port 7000:

   | Step | Request | Notes |
   |---|---|---|
   | 1 | `SETUP` {`isRemoteControlOnly`: true, `timingProtocol`: None, device id, model, name, `sessionUUID`, ...} | answers `eventPort`: connect the event channel (HAP-encrypted, "Events-Salt") |
   | 2 | `SETUP` the full session {`groupUUID`, `isMultiSelectAirPlay`, `timingProtocol`: PTP, `asyncPTPClockConfig`, `timingPeerInfo`/`List`} | answers `info`; the clock is never asked for (a URL is played by the HomeView's own player) |
   | 3 | `POST /command` `updateMRNowPlayingInfo` {npi-text, replace} | |
   | 4 | `SETUP` {`streams`: [{type 130, controlType 1, clientTypeUUID `A6B27562-B43A-4F2D-B75F-82391E250194`, clientUUID, channelID `<psi>-RCS-<n>`}]} | answers streamID 1 and **no data port**: its commands go as `POST /command` with `X-Apple-StreamID` |
   | 5 | `POST /command` MediaRemote updates: `updateMRPlaybackState` 3, `updateMRSupportedCommands` [], `updateMRNowPlayingClient` (airplayd), `updateMRPlaybackState` 1, `updateMRNowPlayingClient` (WebKit's video process, its app, a display name) | **without these the HomeView plays sound only** (the black picture a Mac's Safari gave). NowPlayingClient is MediaRemote's protobuf |
   | 6 | `POST /command` on stream 1: `insertPlayQueueItem` {item: `Content-Location` = the keyed address, uuid, `mediaType` streaming, `playbackRestrictions` 0, `referenceRestrictions` 3, ...}, `setProperty actionAtItemEnd` 1, `setRate` 1.0 | the HomeView fetches the address and plays |
   | 7 | `POST /feedback` every ~2 s while it plays | as every AirPlay 2 sender |

   Not needed (left out on purpose, each tried): the iPhone's device-info record (`setMRInfo`), caption selection,
   metadata, `SETPEERSX`, `uglServerInfo`, claiming to be an iPhone.

## What the owner gets

1. **Pair a HomeView once.** Mantel Settings, Live TV: **AirPlay Screens**, Add. Mantel lists the AirPlay receivers that
   play video (a HomeView, an Apple TV), the person picks one, the HomeView shows a code, the person types it. Owner and
   Admin only. Remove forgets the key.
2. **The Live TV widget's Play On.** A setting on the widget: one of the paired screens, or This iPhone (today's
   behavior: Safari on the phone). With a screen chosen, a tap runs in place (the HomeView allows that, as the music
   buttons): Mantel plays the channel on that screen. A HomeView's own widget set to that HomeView is the whole
   point.
3. **Stop.** The HomeView's own player stops it (its X, or another AirPlay taking over); Mantel notices and lets the stream
   go. The widget's tap on the channel already playing there stops it.
4. **The Live TV page's Play On** (where there is room): the guide's channel menu gets "Play on <screen>", so a wall
   tablet (Android, no AirPlay of its own) can send a channel to a HomeView too.

## How it is built

### 1. The sender: `hosts/server/mantel_server/cameras/airplay_out/` (new package)

AirPlay's sending side, video only, written for Mantel and kept small: pairing (SRP pair-setup with the code, pair-verify,
the ChaCha20-Poly1305 session), the RTSP connection, the event channel, the steps above, feedback, and the end.

- **Ported, not imported.** pyatv (MIT) proved every piece; its packaged form pulls miniaudio, mediafile, pydantic and
  more into the image for audio Mantel doesn't send. The sender takes only what it needs from pyatv's code (attributed in
  each file's header, MIT notice in `THIRD_PARTY.md` or wherever the build keeps them), on `cryptography`, `protobuf` and
  `zeroconf`, which the image already has. SRP-6a (3072-bit, SHA-512) is a page of code; `srptools` (MIT, pure Python) is
  the fallback if porting it isn't clean. The NowPlayingClient message is three fields: built by hand (protobuf wire
  format) rather than shipping MediaRemote's whole `.proto` set.
- **Files**, each well under the size rule: `hap.py` (pair-setup, pair-verify, the encrypted session), `rtsp.py` (the
  connection, CSeq, plist bodies), `session.py` (steps 1-7 and its life: play, feedback, stop, notice the end),
  `screens.py` (the paired screens: their keys sealed in the store like the other secrets, `SecretBox`), `discovery.py`.
- **Discovery.** `mantel-server` runs on Docker's bridge network, where mDNS doesn't reach; `mantel-announce` runs on the
  host's network and already speaks zeroconf. It lists `_airplay._tcp` receivers whose features say video (bit 0) for
  the Add screen; an address typed by hand is the fallback. The pairing and playing go out from `mantel-server` directly
  (outbound TCP to the screen's port 7000 and its event port works from the bridge; checked on 2026-11-24 from the Mac,
  to be checked from the container in step 1).
- **One show a screen.** Playing on a screen that is already playing replaces it (as AirPlay does). A session ends when the
  screen closes the connection, the event channel says it stopped, `/feedback` fails, or Mantel is told to stop; then the
  stream's hold goes (`live_tv.hold` stops being renewed, its lease runs out).

### 2. The stream's address for a screen with no person

`hk_tv/hls` mints a key for the person whose page asks (`stream_keys.mint(principal, src)`). A play sent from the widget
is the person's too: `POST /api/app/tv/play` is signed in as the phone's person (the app's token), so the key is minted for
that principal and re-checked on every fetch exactly as today (feature `live_tv`, `view` on the channel's camera). Nothing
new in the key's rules; `live_tv` gets a `play_on(ctx, channel, screen)` that sets the stream up as `hls()` does and hands
`session.py` the keyed address. The address is the house's own for that screen: its LAN address when the screen is on the
LAN (a HomeView always is), so the fetch stays in the house.

### 3. Routes, roles, audit

- `POST /api/app/tv/play` {channel, screen} and `POST /api/app/tv/stop` {screen}: the app's API (`apps/app_api.py`), signed
  in, `live_tv` feature and `view` on the channel's camera; declared in the route table (rule 7).
- `GET /api/app/tv` gains `screens`: the paired screens this person may send to (name, id), for the widget's Play On.
- HK Settings' AirPlay Screens: `hk_tv/screens` (list, discover), `hk_tv/screen_pair` (start: the code shows; finish: the
  code), `hk_tv/screen_remove`, Owner/Admin (`settings` scope), each in `ha/socket_reads.py` READS_BY_TYPE.
- **Every play and stop is a command in the audit** (who, which channel, which screen), as every command Mantel runs.
- The page's Play On sends `hk_tv/play_on` over the socket (the same `live_tv.play_on`).

### 4. The iPhone app (mantel-ios)

- `TVChannels` gains `screens`; `MantelClient.tvPlay(channel:screen:)` / `tvStop(screen:)`.
- `LiveTVWidgetIntent` gains `screen` (an AppEntity query over `screens`, plus This iPhone).
- The widget's tap: with a screen, `Button(intent: PlayLiveTVIntent(channel:screen:))` (in place, `TapOnce` as the other
  buttons); with This iPhone, today's `OpenLiveTVIntent` (Safari on the phone).
- The widget shows "Playing on <screen>" while it is (the play answers it; Expected, as the music widget), and a tap
  then stops it.

### 5. HK Settings and the Live TV page (web)

- Live TV's settings page gets **AirPlay Screens** (the list, Add with the discovered screens, the code field, Remove),
  iOS Settings' look (hk-settings-kit).
- The guide's channel menu: "Play on <screen>" for each paired screen, when there are any.

## Checks

- **Main suite** (milliseconds, no network): SRP and pair-verify against pyatv's own published test vectors and a fake
  receiver built on the same code (`tests/airplay_fakes.py`, the receiver's side of HAP); the session's requests in order
  and their bodies (the steps table is the test); a screen that stops (the connection closes) ends the session and lets the
  stream go; the routes' roles (a child may not play, only Owner/Admin pair); the key minted for the widget's person and
  refused once they're signed out; the audit rows.
- **No browser check** is added: the one page change (a menu item, a settings list) rides the existing Live TV and
  Settings checks' pages if they need a case at all.
- **By hand, on the house, with the owner** (a one-off, never a step in `full`): pair a HomeView from Settings,
  play from the widget on the HomeView itself, stop from the HomeView's player, play from a wall tablet's Live TV page,
  and a second channel replacing the first. Sound plays in that room: the owner says when.

## Order of work

1. The sender in the main suite against the fake receiver; then a one-off script run against a HomeView from the
   container (pair with its code, play a keyed address) to prove the port works from Docker's bridge.
2. Screens: pairing, storage, discovery through `mantel-announce`, the Settings page.
3. `play_on` / stop and the routes, the audit.
4. The iPhone widget's Play On and its in-place play/stop; TestFlight.
5. The page's Play On.
6. A house hotfix and the owner's run on a HomeView (step "By hand"), then the release with the rest.

Each of 1-5 is committed on its own and pushed to main; nothing goes to the house without the owner's OK for that build.

## Open questions (decided while building, written back here)

- **Apple TVs.** The same steps should play on an Apple TV (pyatv's experience says yes); its remote-control stream may
  answer a data port. Build for the HomeView, try an Apple TV in step 6, list them only if it plays.
- **How long a show plays.** The key lasts 8 hours (`KEY_TTL`); a session is renewed with a fresh key before then, or ends
  with a note in the log. Decided in step 3.
- **Volume.** The HomeView's own buttons and Siri work while it plays; a volume control in the widget is not in this phase.
- **Pairing lost.** A HomeView reset or "Remove" in its own settings forgets the pairing; Mantel shows the screen as
  needing a new code (pair-verify refused) rather than failing silently.
