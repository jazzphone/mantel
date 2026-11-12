# Mantel for Android

Phase 26, 2026-11-12. A native Android app for the wall tablets, built to replace the third-party kiosk app they run
today (Kiosk Satellite). It keeps HK's web app as the screen. It does not draw the screen natively: that would be a
third copy of every card and sheet, against decision 29.

The owner's goal: "optimization/performance and better usability on the tablets". The app has to cover what the
house uses in its kiosk app today, and appear in Home Assistant the way that app does, through ESPHome.

## What was measured first

The house's five tablets on 2026-11-12, from Mantel's own records (`tablet_health`) and the kiosk app's sensors:

| What | Measured |
|---|---|
| Frames a second at rest | 56.7 to 59.3 on every tablet |
| First draw, the last load each reported | 5.4 to 7.4 s (a cold start after the scheduled app restart) |
| The kiosk app's CPU at idle | 9 to 28 % |
| The kiosk app's camera, RTSP, motion and face detection, intercom | off on every tablet |

Drawing at rest is fine, and the kiosk app's own load is small. The cost that stands out is the first draw. The same
tablet measured 0.85 s against the fictional house over adb on 2026-11-11, so this phase measures where the house's
seconds go (slice 26.6).

## What the app is

A Kotlin app that holds one Android WebView (Chrome-based) on Mantel's `/home`:

- **The screen is HK's web app, unchanged.** The page meets the same `window.kioskSatellite` calls it uses today
  (`setBrightness`, `getBrightness`, and the `kiosksatellite:screen*` and `screensaver*` events), so no web file has to
  change for the app to work. `window.mantelNative` says `platform: 'android'`, and the page's `drawn()` call tells the
  app that the first screen is on the glass, as it does for the iPhone app.
- **A real kiosk.** As the tablet's device owner the app pins itself (lock task mode) and starts on boot, and no other
  app can come to the front. It keeps the screen on and runs full screen with the system bars hidden.
- **The screen itself.** Brightness is the window's own (no system setting is changed). The screen turns off with the
  device owner's `lockNow` and back on with a wake lock. A native black curtain stands in for the kiosk app's Black
  screensaver.
- **It recovers by itself.** A crashed or killed WebView renderer is replaced. A page that hasn't drawn in a minute is
  reloaded. If Mantel can't be reached, the app tries again on a back-off.
- **Development is measurable.** A debug build exposes the page to Chrome's developer tools over adb, which the old
  kiosk app never allowed.

## Home Assistant through ESPHome

The app is an **ESPHome native API device** on port 6053, announced by mDNS (`_esphomelib._tcp`), with Noise
encryption (a key the app makes, shown on its setup page). Home Assistant's own ESPHome integration adds it with no new
integration. It is written from the published protocol (`api.proto` from `aioesphomeapi`, MIT, copied with its
license); none of the old kiosk app's code is used (its license is CC BY-NC-ND).

Its entities keep the old app's entity id endings, so `hk_core/tablets/kiosk.py` `PARTS["kiosk_satellite"]`, the Sleep
engine's `KIOSK_PARTS` and the house's automations find them unchanged:

| Entity | Ending | What it does |
|---|---|---|
| light | `_screen` | screen on/off, brightness 0-255 |
| switch | `_screensaver` | the native black curtain armed |
| switch | `_screensaver_active` | the curtain showing (on/off drives it) |
| select | `_screensaver_mode` | `Black` (the only mode) |
| number | `_screensaver_timeout` | seconds before the curtain comes up by itself (86400 by default: HK's screensaver runs) |
| sensor | `_foreground_app`, `_current_page`, `_ipv4_address`, `_app_version`, `_device` | text |
| sensor | `_last_interaction` (timestamp), `_app_uptime` (timestamp) | the last touch, the app's start |
| sensor | `_battery`, `_panel_brightness` | % and 0-255 |
| binary_sensor | `_charging` | plugged in |
| switch | `_kiosk_mode` | lock task on/off |
| button | `_reload_page`, `_clear_cache`, `_restart_app`, `_restart_device`, `_bring_to_front` | as named |

The old app's Bluetooth proxy, voice assistant, alarms, screensaver slides, screenshots and camera snapshots are left
out (the owner, 2026-11-12: none is used).

## Enrolling a tablet without a password on it

A wall tablet's credential is a cookie in the browser that shows the page. The app's WebView is a new browser, so a
tablet moving to the app is enrolled again. Typing an Owner's password on the tablet is what this avoids:

- **Mantel Settings → All Screens → Wall Tablets → the tablet → Mantel → Pair a Tablet App…** (Owner or Admin) makes a
  one-time code: 8 letters and digits, 10 minutes, single use. It is audited (`device.claim_code`) and kept only in
  memory.
- On the tablet, the app (or any browser) opens `/device/claim` and the code is entered. The page posts it to
  `POST /api/devices/claim`, which is refused off the home network, like enrolling. It enrolls the browser as that
  tablet, with the Wall Tablet role and the code's room, written to the audit as `device.enroll` by the person who
  made the code. Five wrong codes from one address in a minute and it waits a minute.
- The app's setup page takes Mantel's address and the code, and opens the claim page with the code in the URL's
  fragment (never sent to the server's log).

## Updates

Mantel serves the app: `GET /apps/android/latest.json` (version, size, SHA-256) and the APK beside it, from
`<data>/android/`, LAN only. `tools/publish_apk.py` in the app's repository builds, signs and copies a release there. An
enrolled app checks once an hour and installs a newer one by itself as device owner (`PackageInstaller`), at a quiet
moment: the screen off or nobody touching it for 10 minutes.

## Cameras

A doorbell pop-up plays the camera in the page today. A native player (hardware-decoded go2rtc, drawn by Android over
the page) is built **only if measured to matter**: a live camera in the app costing the page more than 15 % of its frames
or the tablet more than 30 % CPU over the page alone. Slice 26.5 measures this and records the result either way.

## iOS

The iPhone app already is this kind of shell. iPadOS gives no screen-off, no running in the background, no Bluetooth
proxy and no self-locking kiosk (that is Guided Access). There is no iPad on a wall, so nothing is built for iPad here.

## The slices

| Slice | What | Proven by |
|---|---|---|
| 26.1 | The app: WebView shell, the `kioskSatellite` and `mantelNative` bridges, setup page, kiosk, boot, watchdog, screen and brightness, the black curtain | JVM unit tests; the emulator; the test tablet over adb (brightness read back, reboot, killed renderer) |
| 26.2 | Mantel Server: claim codes and `/device/claim`, the Settings button, `/apps/android/` | `tests/test_device_claim.py`, `tests/test_android_apps.py`, the route table, a WebKit look at the Settings group |
| 26.3 | ESPHome native API: framing, Noise, the entities, mDNS | JVM unit tests; `aioesphomeapi` from the Mac against the emulator and the tablet; the scratch Home Assistant adds it and the Sleep engine's parts are found |
| 26.4 | Updates: the app's check and install; `tools/publish_apk.py` | install, upgrade and a refused bad hash on the tablet |
| 26.5 | Cameras: measure the page's live camera in the app; the native player only past the bar above | numbers recorded here |
| 26.6 | First draw: where the house's 5-7 s goes, fixed in the page where it is cheap | first draw before and after, on the test tablet in the app |
| 26.7 | The test tablet moves to the app: the old app gives up device owner, the app becomes it, Home Assistant's entities are swapped with the same ids, Sleep Screen runs | the house's Sleep Screen puts it to sleep and wakes it; a week of `tablet_health` |

## Decisions for the owner (answered 2026-11-12)

1. A native renderer? **No**: a native shell around the web app.
2. Bluetooth proxy, voice assistant, alarms, slides, screenshots, snapshots? **None used: left out.**
3. The repository: **`jazzphone/mantel-android`, private like `mantel-ios`.**
4. The signing key: **made outside the repository; the owner keeps a backup.**
5. Adding the tablet to the house's Home Assistant, Mantel Server's changes in a release, moving the test tablet off its
   kiosk app (with Home Assistant's entities renamed to the old ids): **all OK.**
6. Sound tests: **any, except the room the owner works in.**
7. The test tablet: **one of the house's five**, not given the Owner role (devices can't have it: `DEVICE_ROLES`).
   It enrolls with a code the owner makes once (slice 26.2), the one step only the owner can do.

## Build log

- 2026-11-12: plan written; the Mac's Android toolchain installed (Java 21, Android SDK 36 and 37, emulator at 1280 x
  800); the test tablet reached over adb.
- **Device owner needs a factory reset.** The old app is the test tablet's device owner, and its own documentation says
  only a factory reset undoes that. So on that tablet the app runs as an **active device admin** and the **home app**:
  the screen still turns truly off (`lockNow`), but there is no lock task and no Restart Device (the app offers that
  button only as device owner, so HK's scheduled restart presses Restart App instead). A tablet set up fresh can make
  the app its owner (`tools/setup_tablet.py --owner`).
- **Where the first draw goes (26.6).** Each house tablet loads its page about once a day, right after HK's scheduled
  restart, which presses Clear Cache first (`hk_core/tablets/alerts.py restart_plan`). So every first draw the tablets
  report is a cold load: 1.9 MB in 103 files, 5.4-7.4 s. Browsers that keep their cache draw the same house in
  0.7-1.4 s. In the app the last screen's still covers the cold load. Keeping the cache through the daily restart is
  the owner's decision (it changes the house's behavior), recorded as a recommendation, not made here.
- **26.1, proven on the emulator** (Android 16, 1280 x 800) against the fictional house (`tools/fake_house.py`):
  pairing by code, the bridge (`platform: 'android'`, the brightness both ways), the curtain and a tap lifting it, the
  screen truly off and on from Home Assistant's light, a killed renderer replaced, the load retry backing off 2, 4,
  8, 16 s, a reboot back in front and still paired (`tools/tablet_check.py`: 37 checks). Found and fixed: the still
  taken in `onStop` crashed (no surface); a retry that never backed off (an error page "finishes").
- **26.3, Home Assistant adds it.** The ESPHome server passes 38 unit tests and 140 checks with `aioesphomeapi`, plain
  and encrypted; a scratch Home Assistant 2026.9 added the emulator through its own ESPHome flow with the Noise key, and
  its 20 entities came up with the old app's ids (`light.kitchen_kiosk_screen`, `switch.kitchen_kiosk_screensaver_active`,
  ...). Light off and on, brightness, the curtain and the buttons from Home Assistant all reached the tablet, and the
  connection stayed up with the screen off.
- **26.4, updates.** A newer release in Mantel's `android/` folder installed by itself with no tap and the app came back
  to the front; a wrong hash was refused. Silent self-updates need `UPDATE_PACKAGES_WITHOUT_USER_ACTION`, the app as its
  own installer of record (`pm install -i`) and "install unknown apps"; coming back in front after an update needs
  "display over other apps". `tools/setup_tablet.py` does all of it.
