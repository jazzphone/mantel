# iPhone, iPad and Mac Apps

Mantel has apps for iPhone, iPad and the Mac. The iPhone and iPad app shows
your screens and Mantel Settings, and adds what only an app can: real
notifications, a music Live Activity on the Lock Screen, widgets, Control
Center controls, Siri, and Face ID. The Mac app lives in the menu bar with your
music and favorites. The apps decide nothing on their own: every button goes
through Mantel, checked against your role and written to the
[Audit Log](Commands-and-Audit.md).

## Getting the apps

<!-- RELEASE: the apps are not on the App Store or TestFlight yet. Replace this section with the App Store / TestFlight links once a build is published. -->

The apps are **not on the App Store or TestFlight yet**. Until they are, you
can [build them yourself](#build-the-apps-yourself) with Xcode.

## What you need

- Mantel at an **`https://` address with a certificate your devices trust**
  ([Install](Install.md)). The apps refuse plain `http://` except for a
  developer's own Mantel on the same computer.
- To pair, a phone on your **home network**.
- For away-from-home use, Mantel's remote address (for example through a
  Cloudflare tunnel). Mantel tells the app both addresses.

## Pair the app with your home

1. On another screen, sign in to Mantel and open **Mantel Settings → Me →
   Mantel App → Add iPhone, iPad or Mac…**. It shows a code to scan, valid once
   for ten minutes. (The button works only on the home network.)
2. Open the app and select **Scan the Code**. You can also paste the
   `mantel://pair` link, pick your Mantel under **On This Network**, or **Type
   Its Address**.
3. The app asks **Is This Your Mantel?** and shows six digits. Check that
   **Mantel Settings → Me → Mantel App** shows the same six digits, then
   select **Yes, Sign In**.
4. Sign in on Mantel's own sign-in page, with any way you normally use:
   passkey, password and authenticator code, or Sign in with Home Assistant.
5. Allow notifications when the app asks, if you want them
   ([Push Notifications](Push-Notifications.md)).

The app now appears under **Mantel Settings → Me → Mantel App**, with its
model, whether it was last at home or away, and when it was last seen.

### How the app stays secure

- **Your home's identity is pinned at pairing.** If either address ever
  answers with a different key, the app stops and says so, rather than asking
  you to trust it.
- **The sign-in is bound to the phone.** The app's credential is tied to a key
  in the phone's Secure Enclave that can't leave it. A copied credential is
  useless without the phone.
- It lasts **30 days**, at home and away. **Mantel Settings → Me → Mantel
  App** shows when it ends.
- No password passes through the app: you sign in on Mantel's own page.
- The screens in the app get an ordinary Mantel session and never see the
  app's credential.

**Sign out** from the app, or from **Mantel Settings → Me → Mantel App → Sign
Out** *name*…. It stops working at once, its widgets too.

## The iPhone and iPad app

- **Your screens and Mantel Settings**, the same pages as on the tablets, with
  native touches: haptics, swipe from the left edge to go back, a status bar
  that matches the page, and no white flash on open.
- **At home and away.** The app has your home's local and remote addresses and
  switches between them as your network changes. Away, Mantel's away rules
  apply (each role's switches for sensitive actions, cameras and locations).
- **Face ID to Open** (optional): the app asks for Face ID before it shows
  anything.
- **The Mantel App menu**: **Mantel App** in the page's own menu opens the
  app's settings: Favorites, Face ID to Open, Turn On Notifications, Clear
  Cache, Sign Out and Forget This Mantel.
- **Now Playing** (iPhone): tapping the mini player opens a native player, with
  Speakers, Up Next and Browse. The iPad keeps the Music page's own player.

### Music on the Lock Screen

While your speaker plays, a **Live Activity** shows on the Lock Screen and in
the Dynamic Island: the cover, the song, progress, play/pause, skip and
volume. It ends when the music stops.

Today the app starts and updates the Live Activity while it runs; it is not
yet updated by push with the app closed. <!-- RELEASE: push-updated Live Activities need the published app's push setup (APPLE-APPS.md slice 10.7 "Left"). -->

### Widgets, Control Center and Siri

| Where | What |
|---|---|
| **Favorites** widget (small, medium, large) | Your favorite accessories, as buttons |
| **Now Playing** widget (small, medium, Lock Screen) | What your speaker plays |
| Control Center: **Mantel Music** | Play/pause your speaker |
| Control Center: **Mantel Accessory** | A favorite, on and off |
| Siri and Shortcuts | "Pause the music in Mantel", "Next song in Mantel", "Turn on *accessory* in Mantel" |

**Favorites** are your own list, chosen in the app (**Mantel App →
Favorites**) or on the Mac. The widgets, Control Center, Siri and the Mac all
use the same list, and show only what your role lets you see.

## The Mac app

A menu bar app, native on macOS:

- **Music**: Now Playing over the cover's colors, the rooms it plays in,
  progress, transport and volume; **Speakers** (presets and rooms, a volume
  each, **Update** and **Stop**), **Up Next**, and **Browse** (your home's
  playlists, then Music Assistant's library). The same player opens wide in a
  window.
- **Favorites** as tiles you can toggle.
- **The play/pause key** can control your speaker. It is off until you try it
  from the menu (**Try It**); if your speaker answers, it stays on.
- The **⋯** menu switches between homes, if you paired more than one.
- **Notifications**, the same ones your iPhone gets: an accessory's, and
  Mantel's own [system alerts](Alerts.md) if you are an Owner or Admin with
  **System Alerts** on in **Mantel Settings → Me**. See
  [Notifications on the Mac](#notifications-on-the-mac).

The Mac app pairs with the same code: open its `mantel://pair` link on the
Mac.

### Notifications on the Mac

<!-- RELEASE: Mac notifications need the team-signed Mac build with push, and the push relay redeployed with APNS_TOPIC_MAC (APPLE-APPS.md "Mac notifications"). Don't publish this section until a Mac has received one. -->

Once you are signed in, the Mac app asks macOS to allow notifications, and
registers with your Mantel the way the iPhone app does. Your Mantel seals each
notification to a key only that Mac holds, so Apple and the push relay see
only that something arrived. A small extension inside the app opens it and
shows the real words. See [Push Notifications](Push-Notifications.md) for how
they travel.

- **System alerts** (Home Assistant disconnected, a backup failed, a new
  version) arrive for Owners and Admins who turn on **System Alerts** in
  **Mantel Settings → Me**. They stack together as **System** in Notification
  Center, apart from the doorbell and leak alerts. Info alerts arrive quietly,
  without a banner. A Critical alert looks like any other on the Mac.
- **Tap a notification** and your browser opens at the right page of Mantel
  Settings (for a system alert, **Alerts**), signed in as you.
- **The ⋯ menu** shows where it stands: **Notifications On**, or **Turn On
  Notifications** if you stopped them (below) or the app could not register. If
  you said no when macOS asked, it reads **Notifications Are Off in System
  Settings…** and takes you to **System Settings → Notifications**.
- **Turn them off** in macOS (**System Settings → Notifications → Mantel**),
  or from Mantel: **Mantel Settings → Me → Notifications → Stop Sending to**
  *your Mac*…. The app stays signed in but doesn't register again by itself;
  choose **Turn On Notifications** in the ⋯ menu to have them back.

**Notifications need the signed build.** macOS lets an app receive them only
if it is signed by an Apple developer team with Push Notifications on the
app's identifier. The Mac app you [build yourself](#build-the-apps-yourself)
is signed that way (`MAC_TEAM_SIGNING` is on in the Mac repository's `make_project.py`).
A Mac build signed only to run locally (`MAC_TEAM_SIGNING = False`) works
without them, and its menu says **Notifications Need the Signed Build**.

**What your Apple Developer account needs** to build it with notifications:

1. In Xcode, **Settings → Apple Accounts**, sign in to your team's account. Put
   your team in `Config/Local.xcconfig`, as below, and build **MantelMac**
   with `-allowProvisioningUpdates` in the Mac app's checkout:

   ```bash
   xcodebuild -project Mantel.xcodeproj -scheme MantelMac -destination 'platform=macOS' -allowProvisioningUpdates build
   ```

   The first build creates two identifiers in your account, `com.jazzphone.mantel.mac`
   (the app, with **Push Notifications**) and `com.jazzphone.mantel.mac.notifications`
   (the extension), and a profile for each. (Under your own Apple account, use your
   own prefix, as above.) The team's wildcard Mac profile can't carry push, so
   Xcode makes explicit ones.
2. A build you hand to other Macs needs a **Developer ID** profile (and the
   app notarized) or a **Mac App Store** profile for the same two identifiers.
   Archive the **MantelMac** scheme in Xcode (**Product → Archive**) and
   **Distribute App**. A build run from Xcode on your own Mac uses Apple's
   sandbox push service; the distributed build uses the production one, and the
   app reads which from its own signature.
3. **The push key is the one your iPhone app uses.** An APNs key belongs to
   your team and works for every identifier in it. What differs is Apple's
   *topic*: it is the receiving app's bundle id, so the Mac app's is
   `com.jazzphone.mantel.mac`, not the iPhone app's `.ios`. Mantel sends the Mac's
   notifications with that topic: through the push relay, or, sending
   directly, with `mac_topic` in `apns.json`. Your
   [own relay](Push-Notifications.md#run-your-own) needs `APNS_TOPIC_MAC`.
4. Allow notifications when the Mac app asks, then check the ⋯ menu says
   **Notifications On**.

## Build the apps yourself

You need a Mac with Xcode and an Apple developer account. The apps have their
own repositories: **mantel-ios** (the iPhone and iPad app, and the code both
apps share) and **mantel-mac** (the menu bar app, which takes mantel-ios as a
submodule at `ios/`). Each one's README has the details. Clone them beside
this repository (as `mantel-ios` and `mantel-mac` next to `mantel`): their
scripts find it there for Mantel's version, the house's icons and the
fictional house below.

1. Put your Apple team id in `Config/Local.xcconfig` in each app's checkout
   (git ignores the file):

   ```
   DEVELOPMENT_TEAM = ABCDE12345
   ```
2. Open `Mantel.xcodeproj` there. The scheme is **Mantel** (iPhone and iPad)
   in mantel-ios and **MantelMac** (the menu bar app) in mantel-mac. Build and
   run on your device. (`python3 make_project.py` writes the project again
   after a change to its targets or settings.)

Under your own Apple account, the app's identifiers must be yours too. The
bundle prefix (`PREFIX` in each `make_project.py`) and the App Group and
Keychain group in each `Config/*.entitlements` name the publisher's prefix;
change them to a prefix your team owns (they are written in those files, not read from a setting).

**Notifications from your own build.** Apple gives each app's developer one
push key, so the publisher's push relay can't deliver to an app you build
under your own account. Run your own relay, or let your Mantel send to Apple
directly with your key. See
[Push Notifications](Push-Notifications.md#run-your-own).

### Try it without a home

`tools/app_dev_server.py` runs a fictional Mantel on your Mac (no Home
Assistant; commands change only fictional states). It prints a pairing link
for the Simulator; `--music` adds a fictional Music Assistant. See the apps'
READMEs.

## Not built yet

- **Sign in with Apple.**
- **Actions on notifications** (for example Mute 1 Hour).
- **Live Activities updated by push** with the app closed.
