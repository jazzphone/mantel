# Mantel for iPhone, iPad and Mac

The native apps of phase 10 (docs/phase10/APPLE-APPS.md). A SwiftUI shell around Mantel's own web pages, with native
code only where the system needs it. The house decides everything; the apps ask.

| Folder | What |
|---|---|
| `MantelKit/` | Swift package shared by every target: the house and its pin, PKCE, the Secure Enclave device key and DPoP proofs, the Keychain, the API client, Bonjour discovery, sealed notifications, the App Group store. `swift test` runs its tests, which use fixtures made by the server's own crypto (`Tests/make_fixtures.py`) |
| `Mantel/` | The iPhone and iPad app: setup (QR, a `mantel://pair` link, Bonjour, a typed address), sign-in in `ASWebAuthenticationSession` on Mantel's own `/login`, Face ID to open, the screens and Settings in a `WKWebView`, favorites, push registration, the music Live Activity |
| `Common/` | `SessionModel` and the favorites editor, shared by the iPhone app and the Mac app |
| `Shared/` | App Intents (Siri, Shortcuts, widget and Live Activity buttons) and the Live Activity's attributes and artwork cache, shared by the app and the widget extension |
| `MantelWidgets/` | Favorites and Now Playing widgets, the music Live Activity (Apple Music's layout), Control Center controls |
| `MantelNotificationService/` | Opens the house's sealed notifications and attaches the snapshot |
| `MantelMac/` | The menu bar app, native SwiftUI: the house's music player (Now Playing over the cover's colors, Speakers, Up Next, Browse) in the menu and wide in a window, the favorites as tiles, favorites as toggles and chosen on the Mac, setup in its own window, the play/pause key (off until tried) |
| `Config/` | Info.plists and entitlements |
| `make_project.py` | Writes `Mantel.xcodeproj` (folders, not files: add a `.swift` file and it is in) |

## Build and run in the Simulator

Build products must be on a local disk (the repo's SMB share cannot hold them):

```bash
xcodebuild -project apple/Mantel.xcodeproj -scheme Mantel -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath /tmp/mantel-dd build
```

A fictional Mantel for the app to talk to, on this Mac only (no Home Assistant; commands go through the real gateway
to a fake connection that only changes fictional states):

```bash
.venv/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-dev
```

Install the app, then open the pairing link it prints (`/tmp/mantel-app-dev/pair.txt`) in the Simulator:

```bash
xcrun simctl openurl booted "$(cat /tmp/mantel-app-dev/pair.txt)"
```

A sealed test notification, after the app has registered for notifications:

```bash
.venv/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-dev --push "Front Door|Unlocked by Ann"
```

```bash
xcrun simctl push booted com.jazzphone.mantel.ios /tmp/mantel-app-dev/push.apns
```

`simctl push` never starts a Notification Service Extension, so in the Simulator the app opens the sealed
notification itself when it arrives while the app is open (`AppDelegate.willPresent`). With the app in the
background the Simulator shows Apple's generic "Mantel / New notification": that is the extension's job on a phone.

### The Mac app

Team-signed (this Mac is registered to the team), so `-allowProvisioningUpdates`:

```bash
xcodebuild -project apple/Mantel.xcodeproj -scheme MantelMac -destination 'platform=macOS' -derivedDataPath /tmp/mantel-dd-mac -allowProvisioningUpdates build
```

A fictional Mantel with music (a fictional Music Assistant from `tests/music_fakes.py` on another loopback
port; the page's commands go through the gateway to it, with audit rows):

```bash
.venv/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-mac-dev --port 8777 --music
```

Pair by opening its link with the app (the app takes `mantel://pair`; the link works once, for an hour):

```bash
open -a /tmp/mantel-dd-mac/Build/Products/Debug/Mantel.app "$(cat /tmp/mantel-mac-dev/pair.txt)"
```

`mantel://music`, `mantel://favorites` and `mantel://setup` open those windows. The player is native SwiftUI on the
apps' music door (`/api/app/music…`, `hosts/server/mantel_server/app_music.py`); a Mantel without it (older, or music
still on Home Assistant's engine) gets the menu's plain now-playing controls. The ⋯ menu switches between paired
houses (each keeps its own credential).

Debug builds take `mantel://debug/render?view=player|speakers|upnext|browse|favorites|window&to=http://127.0.0.1:<port>/`
(the view drawn with the live data by SwiftUI's ImageRenderer, whose AppKit controls come out as yellow placeholders,
plus `state.txt`), `mantel://debug/act?do=transport|volume|rooms|queue|playlist|item|stop&arg=…` (a button's own call)
and `mantel://debug/house?fp=<pin's start>` (switch house). The receiver gets PUTs on loopback: the app's container is
closed to other apps, and screenshots here cannot see the menu bar panel.

## Verified in the Simulator (iOS 27, Xcode 27.1, 2026-10-19)

- Pairing by `mantel://pair` link: the house's pin checked by a signed nonce, the credential bound to the device key,
  the app listed under Me → Mantel App on the house.
- The Home screen and Settings in the web view through `/app/web-session`; a light toggled from the page went
  through the gateway with its audit row and the page redrew.
- APNs registration (the Simulator gives a device token) with the notification key; a sealed push opened by the app
  ("Front Door / Unlocked by Ann", Time Sensitive), with nothing readable in the payload Apple would carry.
- The music Live Activity on the Lock Screen in Apple Music's layout (cover, tint, progress, transport); its pause
  button ran `MusicControlIntent` → `/api/app/command` → the gateway (audit row) and the activity followed.
- The Mac menu bar app (2026-10-20; macOS 27): team-signed and sandboxed, paired by link; the native player against
  the fictional Mantel (`--music`): every view drawn with live data (debug render), and every button's call through the
  gateway with its audit row `ok` -- play/pause and next (`hk_frontend.music_transport`), volume
  (`media_player.volume_set`), Speakers' Update (`hk_frontend.music_transfer`), a house playlist (`music_play`), a
  library item (`music_play_media`), an Up Next song (`hk_music/queue_play`); signed in again after relaunching, no
  Keychain prompt. Not seen or clicked by eye: the menu panel and its buttons, the Favorites and Setup windows. Not tried: the play/pause key (off by
  default, "Try It" in the menu), sign-in through the web sheet and Bonjour on the Mac.

Not exercised: placing the widgets and Control Center controls by hand, Siri phrases, the QR camera (the Simulator
has none: paste the link), Face ID itself (the Simulator without Face ID enrolled skips the lock; never its passcode).

## Your developer account

Your Apple team id comes from `MANTEL_TEAM_ID` when you run `make_project.py`; the bundle prefix `com.jazzphone.mantel`
is `PREFIX` there, and the App Group and Keychain group names in `Config/*.entitlements` follow it, so building under
your own account means changing those to yours. An APNs key for direct sending is `~/.config/mantel/secrets/apns_key.p8`
with `apns.json` beside it (both 0600). Register your iPhone with the team (Developer Mode on, paired with your Mac);
the first device build registers the App IDs, the App Group and push. A device build:

```bash
xcodebuild -project apple/Mantel.xcodeproj -scheme Mantel -destination 'generic/platform=iOS' -derivedDataPath /tmp/mantel-dd-device -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
```

### On your iPhone (Debug build)

```bash
.venv/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-lan --lan
```

prints the test house's home-network address and writes `pair.png` to scan with the iPhone's Camera. A REAL push
through Apple's sandbox, with the team's key (`httpx[http2]` in the venv):

```bash
.venv/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-lan --send-push "Front Door|Unlocked"
```

The app installs, pairs over the home network, registers for notifications, and the Notification Service Extension
opens the push on the phone ("Front Door / Unlocked by Ann").

## What needs the Apple Developer account (M10-6)

- **Real pushes**: the APNs key on the house (`apns_key.p8`, `apns.json`) and `httpx[http2]` in the image; then the
  Notification Service Extension runs for real, and the Live Activity can be updated by push.
- **Sign in with Apple**: the capability, and the server's verification (§3; not built yet).
- **TestFlight** (M10-1): a team, the publisher's bundle prefix (`PREFIX` in `make_project.py`), distribution signing.
- **The shared Keychain group and App Group on a device.** The Mac app is team-signed; its App Group is the
  team-prefixed one (`<TEAM>.com.jazzphone.mantel`), as the team's wildcard Mac
  profile cannot carry `group.com.jazzphone.mantel` (APPLE-APPS.md §12).
- **Critical alerts** need Apple's separate entitlement; not used.
