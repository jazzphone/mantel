# Mantel for iPhone, iPad and Mac

The native apps of phase 10 (docs/phase10/APPLE-APPS.md). A SwiftUI shell around Mantel's own web pages, with native
code only where the system needs it. The house decides everything; the apps ask.

| Folder | What |
|---|---|
| `MantelKit/` | Swift package shared by every target: the house and its pin, PKCE, the Secure Enclave device key and DPoP proofs, the Keychain, the API client, Bonjour discovery, sealed notifications, the App Group store. `swift test` runs its tests, which use fixtures made by the server's own crypto (`Tests/make_fixtures.py`) |
| `Mantel/` | The iPhone and iPad app: setup (QR, a `mantel://pair` link, Bonjour, a typed address), sign-in in `ASWebAuthenticationSession` on Mantel's own `/login`, Face ID to open, the screens and Settings in a `WKWebView`, favorites, push registration, the music Live Activity |
| `Common/` | `SessionModel`, shared by the iPhone app and the Mac app |
| `Shared/` | App Intents (Siri, Shortcuts, widget and Live Activity buttons) and the Live Activity's attributes and artwork cache, shared by the app and the widget extension |
| `MantelWidgets/` | Favorites and Now Playing widgets, the music Live Activity (Apple Music's layout), Control Center controls |
| `MantelNotificationService/` | Opens the house's sealed notifications and attaches the snapshot |
| `MantelMac/` | The menu bar app: now playing, favorites, Open Mantel |
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
~/.venvs/mantel/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-dev
```

Install the app, then open the pairing link it prints (`/tmp/mantel-app-dev/pair.txt`) in the Simulator:

```bash
xcrun simctl openurl booted "$(cat /tmp/mantel-app-dev/pair.txt)"
```

A sealed test notification, after the app has registered for notifications:

```bash
~/.venvs/mantel/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-dev --push "Front Door|Unlocked by Ann"
```

```bash
xcrun simctl push booted com.jazzphone.mantel.ios /tmp/mantel-app-dev/push.apns
```

`simctl push` never starts a Notification Service Extension, so in the Simulator the app opens the sealed
notification itself when it arrives while the app is open (`AppDelegate.willPresent`). With the app in the
background the Simulator shows Apple's generic "Mantel / New notification": that is the extension's job on a phone.

The Mac app: `xcodebuild -project apple/Mantel.xcodeproj -scheme MantelMac -destination 'platform=macOS' -derivedDataPath /tmp/mantel-dd-mac build`.

## Verified in the Simulator (iOS 27, Xcode 27.1, 2026-10-19)

- Pairing by `mantel://pair` link: the house's pin checked by a signed nonce, the credential bound to the device key,
  the app listed under Me → Mantel App on the house.
- The Home screen and Settings in the web view through `/app/web-session`; a light toggled from the page went
  through the gateway with its audit row and the page redrew.
- APNs registration (the Simulator gives a device token) with the notification key; a sealed push opened by the app
  ("Front Door / Unlocked by Ann", Time Sensitive), with nothing readable in the payload Apple would carry.
- The music Live Activity on the Lock Screen in Apple Music's layout (cover, tint, progress, transport); its pause
  button ran `MusicControlIntent` → `/api/app/command` → the gateway (audit row) and the activity followed.
- The Mac menu bar app builds, launches and quits.

Not exercised: placing the widgets and Control Center controls by hand, Siri phrases, the QR camera (the Simulator
has none: paste the link), Face ID itself (the Simulator without Face ID enrolled skips the lock; never its passcode).

## The developer account (set up 2026-10-19)

Team `TEAMID0000` and the prefix `com.jazzphone.mantel` (Avery's choice) are in `make_project.py`. The APNs key
(Key ID `KEYID00000`, Sandbox & Production) is `~/.config/mantel/secrets/apns_key.p8` with `apns.json` beside it
(both 0600; the house needs its own copy when Mantel sends from there). Avery's iPhone is registered to the team
(2026-10-19: Developer Mode on, paired with this Mac); the first device build registered the App IDs, the App Group and
push. A device build:

```bash
xcodebuild -project apple/Mantel.xcodeproj -scheme Mantel -destination 'generic/platform=iOS' -derivedDataPath /tmp/mantel-dd-device -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
```

### On Avery's iPhone (Debug build)

```bash
~/.venvs/mantel/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-lan --lan
```

prints the test house's home-network address and writes `pair.png` to scan with the iPhone's Camera. A REAL push
through Apple's sandbox, with the team's key (`httpx[http2]` in the venv):

```bash
~/.venvs/mantel/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-lan --send-push "Front Door|Unlocked"
```

Verified 2026-10-19: installed, paired over the home network, registered for notifications, and APNs (sandbox)
accepted a sealed push to the phone.

## What needs the Apple Developer account (M10-6)

- **Real pushes**: the APNs key on the house (`apns_key.p8`, `apns.json`) and `httpx[http2]` in the image; then the
  Notification Service Extension runs for real, and the Live Activity can be updated by push.
- **Sign in with Apple**: the capability, and the server's verification (§3; not built yet).
- **TestFlight** (M10-1): a team, a bundle prefix of Avery's (`PREFIX` in `make_project.py`), distribution signing.
- **The shared Keychain group and App Group on a device**, and on the Mac (signed to run locally for now, with only
  the sandbox and network entitlements).
- **Critical alerts** need Apple's separate entitlement; not used.
