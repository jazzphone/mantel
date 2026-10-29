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
  The build is ready and scripted: see "TestFlight" below.
- **The shared Keychain group and App Group on a device.** The Mac app is team-signed; its App Group is the
  team-prefixed one (`<TEAM>.com.jazzphone.mantel`), as the team's wildcard Mac
  profile cannot carry `group.com.jazzphone.mantel` (APPLE-APPS.md §12).
- **Critical alerts** need Apple's separate entitlement; not used.

## TestFlight

`tools/testflight.py` archives the iPhone/iPad app (the `Mantel` scheme: the app, `MantelWidgets` and
`MantelNotificationService`) and exports or uploads it:

```bash
python3 tools/testflight.py --dry-run --team ABCDE12345   # archive + a signed .ipa on disk; nothing leaves the Mac
python3 tools/testflight.py --team ABCDE12345             # the same, then upload to App Store Connect (TestFlight)
```

The team id is `--team`, else `MANTEL_TEAM_ID` / `DEVELOPMENT_TEAM`, else the one your own local project file has; the
committed project has none and never should. The script reads no credentials and prints none: Xcode signs and uploads as the
account signed in at Xcode > Settings > Apple Accounts. That account must be able to create certificates and App IDs (the
team's Account Holder or Admin) for the first run, which registers the App IDs, the App Group, push and the Apple
Distribution certificate through `-allowProvisioningUpdates`.

What it does:

1. **Version and build.** `MARKETING_VERSION` is Mantel's version from `packaging/ha-app/config.yaml` (the generator
   writes it into the project, and the script passes it again, so a version bump needs no regeneration). The build number
   is the commit count (`git rev-list --count HEAD`), which only goes up; `--build N` overrides it. Both go on the
   `xcodebuild` command line, so the app and both extensions carry the same pair. App Store Connect refuses a build number
   it already has for a version.
2. **Archive** (Release, `generic/platform=iOS`, automatic signing, `-allowProvisioningUpdates`).
3. **Export** with a generated `ExportOptions.plist`: method `app-store-connect`, destination `export` for `--dry-run`
   (the signed `.ipa` lands under the output directory) or `upload` otherwise, automatic signing, your team, symbols
   uploaded, and `manageAppVersionAndBuildNumber` off so Xcode keeps the build number above.
4. **Look inside** the `.ipa` and print each bundle's id, version, build, `aps-environment`, App Group and privacy manifest.

Output goes under the system temp directory (`mantel-testflight/<version>-<build>/`, with the `xcodebuild` logs); `--out`
chooses another place (the repository ignores `/build/`). The repository sits on a network share on this Mac, which is why
the default is local.

What the generator (`make_project.py`) and the Config files put in the build for App Store review:

- `ITSAppUsesNonExemptEncryption = NO` in the app's Info.plist. Mantel uses HTTPS (URLSession, WKWebView) and Apple's
  CryptoKit and Security frameworks only (P-256 keys in the Secure Enclave, ECDH + HKDF + AES-GCM for sealed
  notifications, SHA-256); it has no encryption library of its own.
- A `PrivacyInfo.xcprivacy` in the app and in each extension. No tracking. Required-reason API: UserDefaults
  (`CA92.1` for the app's own defaults, `1C8F.1` for the App Group's, which the widgets and the notification service
  read through `SharedStore`); the code uses no file timestamp, boot time, disk space or active keyboard API. The app
  declares one collected type: **Device ID**, for app functionality, not linked to a person, not for tracking. That is the
  push token Mantel registers with the push relay (`packaging/push-relay/`), which stores it. Everything else the app
  sends (the device's name and model, sign-in, the house's data) goes to the person's own Mantel server.
- `aps-environment` is `$(MANTEL_APS_ENVIRONMENT)` in `Config/Mantel.entitlements`: `development` for Debug,
  `production` for Release. A build signed for distribution carries production from the App Store profile either way.
- The AppIcon set has the 1024-pixel marketing icon (`tools/make_app_icons.py` draws it; no alpha channel).

What App Store Connect needs before the first upload (the account holder does these; nothing here can):

- The **Apple Developer Program** membership in good standing, and every agreement accepted (App Store Connect >
  Business, and the developer account's license agreement: an unaccepted one blocks uploads).
- An **app record**: App Store Connect > Apps > + New App, platform iOS, bundle ID `com.jazzphone.mantel.ios` (it is
  listed once the first signed build has registered it, or register it under Certificates, Identifiers & Profiles), a
  name, a language and a SKU. The widgets and notification extensions need no record of their own.
- **TestFlight internal testers**: App Store Connect users of the team (up to 100), added under Users and Access and then
  to the app's TestFlight > Internal Testing group; they install from the TestFlight app once a build has finished
  processing, with no review. External testers need a Beta App Review and the app's test information.
- For external testing or the store: the **App Privacy** answers (the push token above is all Mantel itself receives), a
  privacy policy URL and a support URL. The export-compliance question is answered by the Info.plist key above.
