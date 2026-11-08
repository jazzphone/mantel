# Phase 10 (plan): Mantel for iPhone, iPad and the Mac

> Since 2026-11-08 the Apple apps' code (`apple/` here) is in its own repositories, without the `apple/` prefix: `jazzphone/mantel-ios` (the iPhone and iPad app, `MantelKit/`, `Common/`, `tools/testflight.py`) and `jazzphone/mantel-mac` (the Mac app; mantel-ios is its `ios/` submodule).

Status (2026-10-19, evening): **slices 10.0-10.5 and 10.7-10.9 built on branch `claude/apple-apps-928197`**, not
merged, nothing installed on the house; the apps run in the iOS 27 Simulator and, as a Debug build on Avery's iPhone
(team `TEAMID0000`, prefix `com.jazzphone.mantel`), against a fictional test Mantel on the Mac. What was
built, what was verified and what is left: §12 below. This plan supersedes PLAN §13's verdicts where they differ (§13
called Sign in with Apple "not worth it"; Avery now wants it, and the native app is what makes it cheap).

Avery's brief: an iOS app for Mantel. Secure sign-in through Mantel, passkeys, Home Assistant and Apple, with
security in mind throughout. Notifications as real iOS notifications. Music as a first-class citizen, with
Lock Screen controls. Home Screen widgets. Settings that work on iPhone and iPad. A simple setup ("just sign in
to Mantel?"), with local and remote access, possibly at different addresses. And a Mac menu bar app for music
and the entities a person picks.

## 1. The shape: a native shell around the Mantel you already have

**Recommendation: a hybrid app.** Native Swift for the parts only an app can do (sign-in, the Keychain, push,
the Lock Screen, widgets, Control Center, Siri). The screens and Mantel Settings stay HK's web pages, drawn in a
`WKWebView`, exactly as on the tablets.

Why not all-native: HK's screens, cards, sheets and Mantel Settings are about 15,000 lines of settings code
alone (hk-settings*.js), plus every card family. Rewriting them in SwiftUI would make a second product to keep
in step forever. The web pages are already iOS-styled (docs/DESIGN.md: "HK Settings stays iOS Settings"), and
in the app they get the real SF Pro for free (`-apple-system` is the system font on iOS and macOS, so the
"Your files" font upload stops mattering there).

Why not a web app alone: iOS gives a web app no Lock Screen music, no widgets, no Control Center, no Siri, no
Live Activities and no Notification Service Extension. Those are most of the brief.

### What is reused and what is new

| Area | Already in Mantel | New for the apps |
|---|---|---|
| Screens, cards, sheets, Settings | All of it (web/, the view host, hk-settings) | An `ios`/`mac` host shell (`hkShell` capabilities: haptics, open a native sheet, share) over a `WKScriptMessageHandler` bridge |
| Sign-in | Passwords (Argon2id), TOTP, passkeys (WebAuthn), Sign in with Home Assistant, rate limits, lockout (accounts.py, auth.py) | An **app sign-in** (OAuth code + PKCE) that reuses the `/login` page as is; Apple ID linking; device-bound tokens |
| Sessions | Rotating refresh tokens with reuse detection, door binding, LAN/tunnel lifetimes (sessions.py) | An **app credential** kind built on the same refresh-family code, plus a proof-of-possession key |
| Roles and commands | RBAC, the command gateway, audit rows, tunnel switches (rbac.py, gateway.py) | A small REST door to the gateway for widgets, Siri and Control Center (they cannot keep a WebSocket open) |
| Notifications | The Notifier, the rules, Do Not Disturb, snapshots (features.py, notify_snaps.py, hk_core) | Push delivery: device registration, end-to-end encryption, a push relay, a Notification Service Extension |
| Music | The whole engine, talking to Music Assistant (music.py, hk_core/music) | Live Activity, Control Center controls, a Now Playing widget, App Intents for play/pause/volume |
| Local vs remote | Doors (lan / tunnel / ha), the public URL, the proxy check | Each house's two addresses in the app, switching on network change, the server's identity pinned |
| Per-person data | user_data.py (allowlisted keys) | A `favorites` key: the entities a person picks, shared by widgets, the Mac menu bar and Siri |

Rough split: **about 75% of what a person sees is reused web UI; most of the new code is native shell, system
extensions and four or five server endpoints.** The server work is small because the hard parts (accounts,
RBAC, the gateway, the music engine, the notification rules) already exist and stay the only place decisions
are made. The apps decide nothing on their own.

## 2. Setup: "just sign in to Mantel", nearly

1. **Find the house.** Three ways, best first:
   - **Scan a code** from Mantel Settings → Me → *Add iPhone or Mac*. The QR holds the local address, the
     remote address, the server's identity (its public-key fingerprint) and a one-time pairing code (ten
     minutes, single use, like Mantel Connect's). Nothing to type, and the server is pinned from the start.
   - **Discovered on Wi-Fi**: Mantel advertises `_mantel._tcp` over Bonjour (Mantel Link already needs
     zeroconf for Docker/LXC, slice 9.x). The app shows "Found: Mantel (The Smith House)". Discovery only
     suggests: the identity is confirmed by the sign-in, or by comparing a short code shown on both sides.
   - **Type an address.** The fallback.
2. **Sign in**, in an `ASWebAuthenticationSession` showing Mantel's own `/login`: password + TOTP, passkey,
   Sign in with Home Assistant. Or Sign in with Apple once it is linked (§3).
3. **The server tells the app its other address.** Mantel already knows its public URL (cfg.public_url and the
   proxy check) and its LAN name, so a person never types two addresses. They can change them later.
4. **Allow notifications**, pick favorites for widgets and the Mac (optional, skippable).

Each signed-in app is a row under Me → Devices (name, model, last seen, door), revocable in one tap, exactly
like wall tablets. An Owner sees everyone's under Accounts.

## 3. Sign-in and security

### App credential

- **OAuth 2.0 authorization code with PKCE** (RFC 7636) on Mantel. `/login` signs the person in as it does
  today, then redirects to the app with a one-time code; the app exchanges it for tokens. No password ever
  passes through native code, and every factor Mantel supports works unchanged.
- **Tokens are bound to a key in the Secure Enclave.** At pairing the app makes a P-256 key that cannot leave
  the device; every refresh (and every REST command) carries a signed proof (DPoP-style, RFC 9449). A copied
  refresh token is useless without the phone. App Attest (DeviceCheck) is an optional extra: it proves the
  request comes from the genuine app build.
- **Same refresh-family rules as today**: rotation on every use, reuse revokes the family, an absolute end.
- **Storage**: Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, shared with the extensions
  through one Keychain access group. Never iCloud-synced, never in UserDefaults or logs.
- **Optional Face ID lock** for the app, and Face ID before an unlock or disarm (local to the phone, on top of
  Mantel's roles; decision 25 still means no PINs except the Alarm PIN).
- **Doors still decide.** On the tunnel door the app gets the tunnel's rules (its switches, shorter lifetime,
  a password alone refused). Open question M10-3 asks whether a device-bound app credential may outlive the
  tunnel's 12 hours.

### Passkeys: through the web sheet, not native APIs

A native app can only use passkeys for domains listed in its Associated Domains entitlement, fixed when the app
is built. Every Mantel house has its own domain, so a published app cannot list them. **The fix: passkeys run
inside `ASWebAuthenticationSession`**, where Safari uses the house's own domain as the relying party, the
same passkey a person already made in Safari, synced by iCloud Keychain. Nothing new on the server.

### Sign in with Apple

- **Native only** (`ASAuthorizationAppleIDProvider`). On the web it would need each house's domain registered
  with Apple, which a self-hosted product cannot do; in the app the token's audience is the app's bundle id,
  the same for every house.
- **Linking, never sign-up.** A signed-in person links their Apple ID under Me (like `ha_links`); Mantel stores
  Apple's stable `sub`. Afterwards Apple signs them in. Apple never creates a Mantel account.
- **Replay-safe**: the app asks the house for a single-use nonce first, and Apple's token carries its hash.
  A token meant for one house cannot be replayed at another, even though the audience is shared.
- Mantel checks Apple's signature against Apple's published keys (cached; Mantel already makes outbound
  HTTPS calls for ACME).

### Talking to the house

- **TLS always**, local too. Built-in HTTPS (direct_tls.py) or the house's proxy already give the LAN a real
  certificate. Plain `http://` is refused except for a loopback developer setup.
- **The server's key is pinned** at pairing; a different key on either address stops the app with a clear
  message rather than a silent trust prompt.
- The web view gets a normal Mantel session, handed over by a one-time code (`POST /api/app/web-session`),
  in a per-house `WKWebsiteDataStore`. The page never sees the app's tokens. Since 2026-11-05 the store is kept on the
  device (`WKWebsiteDataStore(forIdentifier:)`, one per house) for its HTTP cache only: every other kind of website
  data (the session cookie, the page's storage) is wiped as the app starts, before the first page loads, so the
  session still lasts only as long as the app, and a cold open no longer downloads every script, style and font again.
  Clear Cache, Sign Out and Forget wipe all of it.
  The web session names the app credential that asked for it (`sessions.parent_id`, 0022): a new one ends the
  app's previous one (whose cookies went with the app), and revoking the app revokes it.
- **Cloudflare Access** (PLAN §7 calls it mandatory in front of a tunnel): a native app cannot click through
  Access's login page on every request. Options in M10-4.

## 4. Local and remote access

- Each house in the app has a **local address** and a **remote address** (either may be empty).
- `NWPathMonitor` watches the network; on a change the app probes the local address first (short timeout, the
  pinned key), then the remote one. The web view reloads only if the door changes.
- The server already tells the app which door it is on (`capabilities.door`), so the app shows a small
  "Away" mark when it is on the tunnel, and features the tunnel turns off look off, not broken.
- Wall-tablet device credentials stay LAN-only as today; the app is a person's credential, never a tablet's.

## 5. Notifications

Today the Notifier decides and the screens show a banner. On a phone the same decision should become an iOS
notification.

- **Apple's push service needs one key per app**, and it belongs to the app's developer, not to each house.
  So pushes go **house → a small push relay → Apple**, the way HA's Companion app works.
- **End-to-end encrypted**: at registration the phone gives the house a public key; the house encrypts the
  notification (title, text, which accessory, the snapshot's id) for that phone. The relay and Apple see only
  a device token and ciphertext. The **Notification Service Extension** decrypts it on the phone, fetches the
  snapshot from the house with the app's credential (notify_snaps.py's signed-snapshot rule, unchanged) and
  attaches it.
- **Interruption levels**: Important notifications as *time-sensitive* (gets through Focus; no Apple approval
  needed). *Critical alerts* (sound even when muted: water leak, smoke, the alarm) need Apple's entitlement;
  apply for it, never assume it.
- **Actions** on the notification: open the accessory's sheet in the app, Mute 1 Hour (the Notifier's mutes),
  and for the doorbell, open the camera. Unlock from a notification only after Face ID and the usual roles.
- **The relay**: a Cloudflare Worker is enough (stateless, holds the APNs key as a secret, rate-limits per
  house). Who runs it is decision M10-2.
- Phones without the app keep getting notifications through the Companion app (Mantel Link, phase 9).

## 6. Music, first class

iOS shows Lock Screen media controls only for audio *the phone itself* plays. Mantel's music plays on house
speakers through Music Assistant, so the system's Now Playing controls are not the right tool, and faking them
with silent audio gets an app rejected. What fits:

- **A Live Activity "Playing in Kitchen"**: art, title, progress and play/pause/next/volume buttons (App
  Intents, iOS 17+) on the Lock Screen and in the Dynamic Island. The house starts and updates it by push
  (ActivityKit push tokens through the same relay); it ends when the music stops.
- **Control Center controls** (iOS 18): play/pause and volume for the person's speaker.
- **A Now Playing widget** on the Home Screen, interactive.
- **Siri and Shortcuts**: "Play Jazz in the Kitchen", "Pause the music", "Move the music to the Loft", as App
  Intents over the music engine's existing requests (claims, moves, groups: all hk_core's decisions).
- **The full Music page** stays HK's web page in the app.
- **Later, optionally:** the phone as a speaker, if Music Assistant streams to it. Then the real Lock Screen
  controls apply (`MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`).

Every button is a gateway command (RBAC on the rooms, the audit row first), through the REST door in §1.

## 7. Widgets, Control Center, Siri

- **Favorites** are the per-person list (user_data `favorites`), chosen in the app or the Mac app, shared by
  every surface.
- **Widgets** (WidgetKit, interactive since iOS 17): favorite toggles and scenes, Now Playing, a camera still
  (on the refresh budget), the house's weather and energy, the alarm's state (arming from a widget asks Face ID
  in the app).
- **Control Center controls**: favorites as toggles.
- **Siri/Shortcuts**: entities as App Entities, so "Turn off the Loft lights" works and Shortcuts automations
  can use Mantel.
- Widgets read a small **summary endpoint** (`GET /api/app/summary`: the favorites' states, now playing),
  filtered by the person's roles, and cached in the App Group for the timeline.
- Later: Apple Watch (favorites, music, the doorbell), Live Activities for the washer and timers (PLAN §13).

## 8. Does Mantel Settings hold up on iPhone and iPad?

Mostly yes. It has the two layouts iOS Settings has: **one column** below 900 px (the list is its own page,
then the detail; a phone) and **two columns** at 900 px and above (list beside detail; an iPad). Coarse
pointers get 17 px text, hover effects are only for a mouse, and segmented controls fall back to a stack when a
row is too narrow. I have not looked at it on a phone or iPad this session, so the checks below come first:

- **iPad portrait gets the phone layout.** iPads are 744 to 834 px wide upright (13" Pro: 1032), under 900, so
  most iPads show one column where iOS Settings shows two. Lower the breakpoint to about 700 px or decide by
  the container's width.
- **No safe areas.** None of the settings code uses `env(safe-area-inset-*)`. Full screen in an app, a phone
  in landscape puts the notch over the list, and the home indicator sits on the last row. `viewport-fit=cover`
  is already set, so this is padding, not layout.
- **Split View and Stage Manager** change an iPad window's width while the app runs; the page already follows
  `resize` (settings-page.js), so this should just work. Check it.
- **The keyboard** over text fields at the bottom of a page (WKWebView scrolls them into view; check).
- Slice 10.1 adds Playwright checks at 390×844, 844×390, 820×1180 and 1180×820 to the settings tests.

## 9. The Mac menu bar app

- **SwiftUI `MenuBarExtra`**, sharing a Swift package (`MantelKit`: API client, sign-in, Keychain, discovery,
  models) with the iPhone app. Not Mac Catalyst: the menu bar is a Mac-only shape.
- **Music**: the person's speaker, art, play/pause/next, volume, move to another room, groups.
- **Media keys and Control Center**: on macOS an app can be the Now Playing app without playing audio
  (`MPNowPlayingInfoCenter.playbackState` exists on macOS only), so the keyboard's play/pause key could drive
  the house speakers. Verify on the current macOS before promising it.
- **Favorites** as toggles and sliders, the same list as the phone's widgets.
- **Notifications on the Mac too** (same relay, optional; built in phase 14, slice 14.10: see "Mac notifications" under §12). The app registers for them only in the team-signed build, which carries the push entitlement; a Mac signed to run locally cannot, and its menu says so.
- "Open Mantel" opens the full screens in a window (a WKWebView) or in the browser.
- Distribution: notarized with Developer ID (outside the Mac App Store) or the Mac App Store; same developer
  account either way.

## 10. Slices

| Slice | What | Needs |
|---|---|---|
| 10.0 | **Now, no Apple account**: the web app on the Home Screen. A manifest, icons, safe areas, Web Push (iOS 16.4+ supports it for Home Screen web apps; PLAN §7 already planned the VAPID key). Gives iPhone notifications before any native code | Nothing new |
| 10.1 | Settings on iPhone and iPad: breakpoint, safe areas, viewport tests | Nothing new |
| 10.2 | Server: app sign-in (code + PKCE), device-bound credentials, Me → Devices rows, pairing QR, Bonjour, `/api/app/web-session` | — |
| 10.3 | Server: REST door to the gateway, `/api/app/summary`, `favorites` in user_data | — |
| 10.4 | iOS app v1: house setup, sign-in, local/remote switching, the screens and Settings in the web view, the `ios` host shell. TestFlight to the family | Apple Developer account |
| 10.5 | Push: registration, encryption, the relay, the Notification Service Extension, actions | M10-2 |
| 10.6 | Sign in with Apple: nonce, verification, linking under Me | 10.4 |
| 10.7 | Music: Live Activity (push-updated), Control Center, Now Playing widget, music App Intents | 10.5 |
| 10.8 | Widgets, Control Center favorites, Siri/Shortcuts entities | 10.3 |
| 10.9 | Mac menu bar app (MantelKit shared) | 10.2, 10.3 |
| 10.10 | Security review (independent pass over 10.2 to 10.9), App Store or TestFlight-only release | M10-1 |

Slices 10.0 and 10.1 can start any time and help the web app on phones whatever is decided below. 10.2 and
10.3 are ordinary Mantel server work in this repo. The Swift code would live in a new top-level `apple/`
folder (an Xcode project with the app, the widget, notification and intents extensions, and the Mac app).

How long: 10.0–10.3 are a few sessions each, like the slices so far. The native app is the bigger piece (a few
thousand lines of Swift for 10.4–10.9), and most of its time goes to the system surfaces and to testing on
real devices, not to screens.

## 11. Decisions for Avery

**Answered 2026-10-19:**

- **M10-1: TestFlight** for the household for now.
- **M10-2: no relay while the app is TestFlight-only.** Avery's own developer account holds the APNs key, so his
  Mantel sends to Apple directly with it (a secret file, like the HA token). APNs costs nothing, and there is no
  third party or Worker to pay for. A relay is needed only if other houses ever run the app (they must not hold
  that key); a Cloudflare Worker fits then and the free tier (100,000 requests a day) covers a household many
  times over. For comparison, HA's Companion app uses a free relay run by the HA project on Firebase, capped at
  500 pushes per device per day, and its notification contents are not encrypted through Firebase. Optional
  later: Local Push Connectivity (iOS's on-Wi-Fi push without Apple's servers) needs an entitlement Apple must
  grant.
- **M10-2, revised the same evening: a relay for everyone.** Avery wants the app to work for every Mantel house, not
  only his, so the push key moves to a relay he runs (a Cloudflare Worker on a free `workers.dev` address). Design in
  §13. His own house uses the relay too, so no house holds the key. Direct sending (the key on a house) stays only as a
  developer's option.
- **M10-3: 30 days** for a device-bound app credential on the tunnel, with Face ID to open the app.
- **M10-4: Access in front of the tunnel, with the app's API paths bypassing it.** Avery has Cloudflare Access
  and Tunnels; Mantel is not an Access application yet, and the tunnel will reach Mantel through his proxy
  (proxy mode: the door key, Cloudflare's headers make it the tunnel door). The shape when the tunnel is set up:
  - one Access application for the Mantel hostname (the household's identities), so a stranger never reaches
    Mantel at all from the internet;
  - a second, more specific Access application for the path `/api/app/` with a **Bypass** policy: the native
    app's REST calls (widgets, Siri, Control Center, notifications' snapshots), each of which needs the
    device-bound credential, with Cloudflare's WAF and a rate limit on those paths;
  - the app's web view (the screens) goes through Access like a browser: Access's sign-in once, then its cookie.
    Set Access's session to 30 days so it matches M10-3.
  Access's mutual-TLS option would avoid the web view's sign-in but appears to need an Enterprise plan
  (unconfirmed), so it is not part of the plan.
- **M10-5: Sign in with Apple alone is enough on the LAN; away from home it also needs the phone's own
  device-bound key** (Avery, 2026-10-19).
- **M10-6: the account comes later.** Build and test in the Simulator first: everything except real pushes to
  a phone, Sign in with Apple and TestFlight works there (simulated pushes with `simctl push` test the
  notification extension). Buy the account when the app is worth putting on phones.

The original questions:

- **M10-1 Distribution.** TestFlight for the household only (simplest, no public review, 90-day builds), or the
  App Store for anyone who runs Mantel (review, a privacy policy, support, and the relay serving other houses).
  Recommendation: TestFlight first; the design does not change for the App Store later.
- **M10-2 The push relay.** Run by you (a Cloudflare Worker on your account, near-zero cost) or, if Mantel is
  ever public, by whoever publishes the app. Each house could also bring its own Apple key, but only someone
  who builds the app themselves can do that.
- **M10-3 App credential lifetime on the tunnel.** Keep 12 hours (sign in again twice a day away from home), or
  allow longer for a device-bound credential (say 30 days, with Face ID to open the app). Recommendation: 30
  days with the Secure Enclave binding; it is stronger than a cookie.
- **M10-4 Cloudflare Access with a native app.** (a) Access's mutual-TLS rule with a client certificate Mantel
  issues per app, (b) no Access for the API paths and rely on Mantel's own sign-in and Cloudflare's WAF and
  rate limits, or (c) the app keeps Access's cookie from a web sign-in (it expires; the most friction).
  Check what your Cloudflare plan offers before choosing.
- **M10-5 Sign in with Apple's weight.** Allowed as the only factor on the LAN door, and on the tunnel only
  together with the app's device-bound key (recommended), or never alone on the tunnel.
- **M10-6 Apple Developer account** ($99/year). Needed from 10.4 on; 10.0–10.3 do not need it.

## 12. What was built (2026-10-19)

Branch `claude/apple-apps-928197`, one commit per slice, each with the repo's full validation green (JS suites, HA
Python, Mantel pytest, smoke). Server code is in new modules (`app_shell.py` registers them all; server.py gained
two lines); edits to shared files are small and listed in the commits.

| Slice | Built | Verified | Left |
|---|---|---|---|
| 10.0 | Manifest, icons (original art, `tools/make_app_icons.py`), the `apple-mobile-web-app` tags (taken out through Ingress), a push-only service worker (no fetch handler), Web Push (RFC 8291/8292; VAPID key `<secrets>/vapid.pem`), push targets (migration 0016) limited to the known push services, sent only to people who may view the accessory; Settings → Me → Notifications | Encryption round-trips, VAPID header, 404/410 drops a target, recipients by `users` and RBAC (tests) | A real iPhone on the Home Screen receiving one (needs the house over https) |
| 10.1 | Settings two columns from 700 px when ≥ 500 px tall; the panel padded by the safe areas, the list's and page's ends by the home indicator. Shared HK Settings code: HK in HA gets it too | Headless Chrome at 390×844, 844×390, 820×1180, 1180×820 with iPhone insets (`tools/headless/settings_viewports.py`, in the tests) | Split View / Stage Manager and the keyboard on a real iPad |
| 10.2 | App sign-in (code + PKCE on `/login`, consent page with the session's CSRF), DPoP-bound credentials in the refresh-family tables (method `app`, 30 days on any door, never a cookie), pairing code + `mantel://pair` QR (`qr.py`, no new dependency), the house's identity key and signed `/api/app/hello`, `/api/app/web-session`, Me → Mantel App (list, sign out, pair) (migration 0017) | 25 tests: PKCE, proofs (key, method, path, iat, replay, ath), refresh rotation and reuse, pairing LAN-only, web session, revocation; the QR read back by macOS's own reader | Bonjour is Mantel Link's `_mantel._tcp` (phase 9), not duplicated here |
| 10.3 | `/api/app/summary`, `/api/app/favorites` (user_data `favorites`), `/api/app/entities`, `/api/app/command` (one service call through the gateway as that person on that door), `/api/app/art`, `/api/app/snap` | Tests; and in the Simulator, commands from the app's web view and its Live Activity reached the gateway with audit rows | — |
| 10.4 | `apple/`: MantelKit, the iOS app (setup, sign-in, Face ID, web view, local/remote switching), `make_project.py` → `Mantel.xcodeproj` | Paired, signed in, the screens drawn and controlled in the Simulator (apple/README.md) | Sign in through the web sheet with a real passkey; TestFlight (account) |
| 10.5 | APNs without a relay (M10-2): registration with a notification key, sealed payloads (`apns.py`), the Notification Service Extension | **On Avery's iPhone (2026-10-19): a real push through APNs (sandbox) with the team's key, opened by the Notification Service Extension** ("Front Door / Unlocked by Ann"); Apple saw only "Mantel / New notification" and ciphertext | The house's own copy of the key and `httpx[http2]` in the image (an install, with Avery); notification actions (Mute 1 Hour) not wired to the server yet |
| 10.6 | Not built | — | Sign in with Apple (nonce, verification, linking; `apple_links` table exists): needs the account |
| 10.7 | The music Live Activity in Apple Music's layout (cover from the house, tint from the cover, live progress and times, transport, volume −/+), Control Center play/pause, the Now Playing widget, music App Intents | Started from the app, paused from the Lock Screen through the gateway, the activity followed | Push-updated activities (account); the house starting one when music starts |
| 10.8 | Favorites widget (interactive), Control Center favorite toggle, `AccessoryEntity` for Siri/Shortcuts, App Shortcuts phrases | Builds | Not placed and tried by hand in the Simulator |
| 10.9 | The Mac menu bar app on MantelKit, native SwiftUI (2026-10-20, with Avery: "the Swift UI version ... like an Apple designer is making it", after two web versions: the screens' pages, then a web player of its own). The menu: Now Playing over the cover's blurred colors (the cover settles back while paused), a route button naming the rooms, progress, transport, volume, and Speakers (presets as capsules, rooms with checks and a volume each, Update / Stop: hk_frontend.music_transfer), Up Next (Music Assistant's queue; a click plays that song), Browse (the house's playlists, then Music Assistant's library: search, Playlists, Albums, Artists, Songs, Radio); or the favorites as tiles. The window: the player beside Speakers · Up Next · Browse. The house's side is the apps' music door, `app_music.py`: `GET /api/app/music` (music.py's payload, every speaker's state, what plays grouped by hkMusic's `contexts()` rule, ported), `POST …/command` (hk_frontend.music_* through the gateway with its answer), `…/volume`, `PUT …/focus`, `GET …/queue`, `POST …/queue/play`, `GET …/library`, `GET …/image`; nothing decided there. Team signing; setup in its own window; the ⋯ menu switches between paired houses | `tests/test_app_music.py` (6: contexts as the screens group them, reads, every request through the gateway, a Child without rooms refused, no credential refused). Against the fictional Mantel (`app_dev_server.py --music`): every view drawn with live data, every button's call audited `ok` (transport, volume, transfer, play, play_media, queue_play) | The play/pause key (below); the panel not clicked by eye here (nothing could see it); Browse cannot open an album or artist yet (Music Assistant's tree is read through Home Assistant: a click plays it); Avery's house needs this version installed for the player (until then, the plain controls) |
| 10.10 | — | — | The independent security review, then TestFlight |

**The Mac app, 2026-10-19 (evening).** Signing: Avery's Mac Studio is registered to the team (Avery's yes; Xcode
registered it with `-allowProvisioningDeviceRegistration`). Xcode's Mac profile is the team's wildcard one, which cannot
carry a `group.*` App Group, and macOS then asks at every launch whether Mantel may "access data from other apps"; so the
Mac's App Group is the team-prefixed `TEAMID0000.com.jazzphone.mantel` (allowed on macOS without a profile; the Mac's
notification extension shares it, slice 14.10). Its Keychain items are in the data-protection keychain under the shared group
(`kSecUseDataProtectionKeychain`), so rebuilt apps no longer ask for the login keychain. `MAC_TEAM_SIGNING` in
`make_project.py` switches back to local signing. **The play/pause key** (`NowPlayingKeys`: `MPNowPlayingInfoCenter`'s
state and song from the person's speaker, `MPRemoteCommandCenter`'s commands as gateway commands, no audio) is built
but **not seen working**: nothing here could press a media key (no Accessibility for scripts, none in computer use) and
MediaRemote's own answer is closed to other apps since macOS 15.4. It is off by default; the menu's "Play/Pause Key
Controls the House (Try It)" turns it on for Avery to press once: kept if the speaker answers, taken out if not.

**Mac notifications, 2026-11-02 (phase 14, slice 14.10).** The system alerts of phase 14 (`docs/phase14/SYSTEM-ALERTS.md`)
and the accessories' notifications reach the Mac app the way they reach the phone: sealed to a notification key the Mac
keeps, opened by a Notification Service Extension. What is in the repo:

- **Registration** (`MantelMac/PushRegistrar.swift`, replacing the stub). Signed in, the app asks the system for alert,
  sound and badge, calls `NSApplication.registerForRemoteNotifications`, and gives the token and `NotificationKey.publicKey()`
  to `MantelClient.registerPush` (the iPhone's call: through the relay when the house uses one, else directly) at
  `/api/app/push/register`. The sandbox or production service is read from the build's own `com.apple.developer.aps-environment`
  entitlement (`SecTaskCopyValueForEntitlement`), not from `DEBUG`. The menu's ⋯ shows the state: **Notifications On**;
  **Turn On Notifications** (the same `resume: true` as the iPhone's, so it registers again after **Stop Sending to…** in Mantel
  Settings → Me → Notifications; the app never undoes that by itself); **Notifications Are Off in System Settings…** (opens
  System Settings → Notifications); or, with no push entitlement, **Notifications Need the Signed Build**, disabled, and
  nothing is asked or registered. The person can also turn them off in macOS (System Settings → Notifications → Mantel).
- **The extension** (`MantelMacNotificationService/`, bundle id `com.jazzphone.mantel.mac.notifications`, embedded in
  `Mantel.app/Contents/PlugIns`). The iPhone extension's code for the Mac: `SealedNotification.open` with the app's key, then the
  title and body, `threadIdentifier` from `Content.thread` (every system alert in one System thread), `interruptionLevel` from
  `Content.interruption`, `mantel_url` and `mantel_entity` in `userInfo`, and the camera snapshot attached. Copied rather than
  shared: the iPhone extension is a separate target and `MantelKit` is the wrong home for UserNotifications code. If the
  extension never ran (an unsigned or locally signed Mac), `NotificationHandler.willPresent` opens the sealed notification
  in the app, as the iPhone's `AppDelegate` does.
- **A tap** (`NotificationHandler.didReceive`) takes the sealed `url` (`/settings#/mantel/alerts` for a system alert) and opens it
  in the browser through a web session on the house (`SessionModel.webSessionURL(next:)`), as the menu's **Open Mantel in the
  Browser** does. The Mac app has no web view of its own, so there is no "Open Mantel" window to open it in. Anything that is
  not a path on the house opens `/home`.
- **Signing** (`make_project.py`, `MAC_TEAM_SIGNING`):

| | Team-signed (`MAC_TEAM_SIGNING = True`, the default) | Signed to run locally (`False`) |
|---|---|---|
| App entitlements | `Config/MacTeam.entitlements`: sandbox, network client, the team-prefixed App Group, the shared Keychain group, **`com.apple.developer.aps-environment`** = `$(MANTEL_APS_ENVIRONMENT)` (`development` in Debug, `production` in Release) | `Config/Mac.entitlements`: sandbox and network client only |
| Extension entitlements | `Config/MacExtension.entitlements`: sandbox, network client, the same App Group and Keychain group (no push entitlement: extensions don't carry one) | `Config/Mac.entitlements`; no shared group, so the extension finds a different key and leaves the notification as Apple carried it |
| Notifications | registered and opened | none: the menu says it needs the signed build |

  Not added: the Time Sensitive capability (`com.apple.developer.usernotifications.time-sensitive`). The iPhone app has it; it
  has not been checked against a Mac profile. Without it macOS shows a Critical alert as an ordinary one (the sealed level is still
  `timeSensitive`); adding the key to `MacTeam.entitlements` is the whole change once an Apple account shows the capability on
  the Mac App ID.

**What the owner's Apple account must have for the Mac** (nothing here can do these):

1. **An App ID for `com.jazzphone.mantel.mac`** (Certificates, Identifiers & Profiles → Identifiers → macOS) with **Push
   Notifications** on, and one for `com.jazzphone.mantel.mac.notifications` (the extension; no capability of its own). With
   `-allowProvisioningUpdates`, Xcode creates both from the entitlements the first time the team-signed Mac app builds, and adds
   Push Notifications to the first. The team's wildcard Mac profile (which signs the app today) cannot carry the push
   entitlement, so the first build after this slice makes an explicit profile for each.
2. **Distribution profiles with the entitlement**: a Developer ID profile (Developer ID Application certificate; the
   app is notarized, outside the store) or a Mac App Store profile (Mac App Distribution), for both App IDs. A Debug build on the
   Mac registered to the team (it is) uses a development profile and the sandbox push service; the Release/Developer ID/App
   Store build is `production`.
3. **The APNs key is the same.** A token-based APNs key (`.p8`) belongs to the team and is valid for every App ID in it, for the
   sandbox and production services. No new key.
4. **The topic is not the same: each app's is its own bundle id.** The Mac app registers with `platform: "mac"`
   (`MantelClient.registerPush`, in the relay's `/v1/register` body and in `/api/app/push/register`); the house keeps it on
   the target (`push_targets.platform`, migration 0032) and sends a Mac's notifications with `apns.json`'s `mac_topic`
   (none set: the Mac's are kept and not sent, never sent to the iPhone's topic, where Apple would call the token gone);
   the relay keeps it on the handle (`handles.platform`) and sends with `APNS_TOPIC_MAC`
   (`com.jazzphone.mantel.mac` in `wrangler.toml`; unset: 503 `platform_not_configured`). A relay already running needs
   `ALTER TABLE handles ADD COLUMN platform TEXT NOT NULL DEFAULT 'ios';` before the new worker is deployed.

**Built here:** the generated project builds `MantelMac` with the extension embedded, unsigned (`CODE_SIGNING_ALLOWED=NO`), and
in a copy with `MAC_TEAM_SIGNING = False` (ad hoc: the app and the extension are signed, sandboxed, with no push entitlement);
the iPhone `Mantel` scheme and `MantelNotificationService` still build for the Simulator; `swift test` in `MantelKit` passes.
**Not verified:** a team-signed build (no profile with Push Notifications exists yet), a real token, a real push, the extension
running on macOS, the menu items by eye, a tap opening the browser, the Mac's data-protection Keychain group shared by the app and
the extension.

Merging notes: migrations renumbered 0016 (push) and 0017 (app) at the merge, after Mantel Link's 0015; `features.Feed.taps`, `sessions.APP_METHOD`,
`ingress.inject_base`'s Home Screen block and `user_data` `favorites` are the edits to shared files.

## 13. The push relay (decision M10-2 revised, 2026-10-19)

A Cloudflare Worker (`packaging/push-relay/`) holds the APNs key as a Worker secret; houses never do. Free tier:
100,000 requests a day.

- **The phone registers with the relay**, not the house: `POST /v1/register` with its APNs device token, the
  environment (sandbox / production) and the house it is for (the house's identity key and its fingerprint, as pinned
  at pairing). The relay answers an opaque **handle** bound to that one house; the phone gives the house the handle
  (`/api/app/push/register`), never the device token. A house can therefore reach only phones that paired with it, and
  never learns Apple's token.
- **The house sends through the relay**: `POST /v1/send` with the handle and the APNs payload, signed with the house's
  identity key (ES256 over method, path, time, nonce and the body's hash; ±5 minutes; each nonce once). The relay
  checks the signature against the key the handle was registered for, rate-limits per house and per handle, forwards
  to APNs with the team key, and drops a handle Apple says is gone. `POST /v1/forget` (house-signed) ends a handle
  when the app is signed out.
- **End to end as before**: the payload is already sealed to the phone's notification key (§5); the relay and Apple
  see ciphertext. The relay sees which house pushed to which handle, and when.
- **Which way a house sends** is the house's choice, told to the app in `/api/app/hello` (`push`): through the relay
  (the default) or directly with its own key (a developer's setup).
- **Deployed 2026-10-19** at `https://mantel-push.jazzphone.workers.dev` (Avery's Cloudflare account; D1 `mantel-push`;
  the APNs key a Worker secret), every house's default (`apns.DEFAULT_RELAY`). Verified on Avery's iPhone: the app
  registered through the relay (the house got a handle, not the token) and a sealed push went house → relay → Apple
  → phone.
- **Later hardening**: App Attest on `/v1/register` (only the genuine app may register), Live Activity push tokens
  through the same path.
