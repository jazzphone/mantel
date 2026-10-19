# Phase 10 (plan): Mantel for iPhone, iPad and the Mac

Status: **plan only** (2026-10-19). Nothing here is built. It supersedes PLAN §13's verdicts where they differ
(§13 called Sign in with Apple "not worth it"; Avery now wants it, and the native app is what makes it cheap).

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
  in a per-house, non-persistent `WKWebsiteDataStore`. The page never sees the app's tokens.
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
- Notifications on the Mac too (same relay), optional.
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
