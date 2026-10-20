# Phase 10: making the iPhone app feel native (plan, 2026-10-20)

Avery's question after using the app on his iPhone: what would make it feel like a native app and not a fancy website?
He chose all seven items below. This is the plan: what each is, how it is built, what it touches, how it is checked,
and the order. Nothing here changes what the house decides: the app still asks, the gateway still decides, and every
command still leaves an audit row.

## Where the app is today

- `apple/Mantel/` is a SwiftUI shell around Mantel's own pages in a `WKWebView` (`HouseWebView.swift`), entered
  through a one-time web session (`/app/web-session`).
- A bridge exists (`window.mantelNative`: `platform`, `haptic`, `share`), but no page uses it yet.
- The app has its own ⋯ menu (`MainView.swift` `AppMenu`): Mantel Settings, Favorites, Face ID, notifications,
  Clear Cache, Sign Out.
- Native already: pairing, sign-in, Face ID, sealed notifications, the music Live Activity, widgets, Control Center
  controls and Siri.
- The app reads the house through `/api/app/*`: summary, favorites, entities, command, snapshot, art. It has no live
  feed: the summary is fetched on open, on resume and after a command.

## The seven items

Effort is in working sessions, where one session is roughly half a day.

### 1. Stop the web gestures (½ session, app only)

**What:** no long-press callout or text selection on tiles, no link previews, no double-tap or pinch zoom, and no
rubber-band bounce at the page's top. Scrolling inside lists keeps its bounce.

**How:**
- `HouseWebView`: `allowsLinkPreview = false`, and `scrollView.bounces` off at the top only (a scroll-view delegate
  clamps the top overscroll).
- A user script injected only on the `ios` host sets `-webkit-touch-callout: none` and `user-select: none`, except on
  inputs and text areas, plus `touch-action: manipulation`.
- The viewport already says `user-scalable=no`; the script also sets `maximum-scale=1` (WebKit ignores
  `user-scalable` for accessibility unless both are set).

**Touches:** the app only. HK's shared code is unchanged.

**Check:** in the Simulator, long-pressing a tile, a name or a link shows nothing, and a double tap does not zoom.
Search fields and settings fields still select and paste.

### 2. No white flash on open (1 session, app only)

**What:**
- Opening shows Mantel's dark launch screen, then the last page you had, at once.
- The live page fades in over it when it is ready.
- "Connecting to Mantel…" is never a white screen.

**How:**
- A launch screen in the house's dark (`#05070e`) with the hearth mark (`Config/Mantel-Info.plist`
  `UILaunchScreen`).
- `MainView` keeps the web view hidden (`opacity 0`) until its first `didFinish` plus a frame, and shows a still of the
  last page underneath until then.
- The still is taken with `WKWebView.takeSnapshot` on going to the background. It is kept in the app's own caches and
  cleared by Clear Cache and Sign Out. It never goes in the App Group, since it can show the house.
- The web view stays alive across background and foreground; it is rebuilt only when the door changes, as today.

**Check:** a cold open and a resume in the Simulator with a screen recording: no white frame.

### 3. Haptics everywhere (1 session, shared web code, small)

**What:** a light tap on toggles, scenes, sliders (at each step and at the ends), the music buttons, the tab bar, and
a pop-up opening; a success or warning tap on locks and the alarm.

**How:**
- One helper in `hk-base.js` (`hkCards.haptic(kind)`) calls `window.mantelNative.haptic` when it exists and does
  nothing anywhere else. That keeps the wall tablets, Home Assistant and desktop browsers unchanged.
- The cards call it where they already react to a tap: `hk-tap.js`'s tapped state, the slider drag, `hk-music.js`
  `_transport`, `hk-tabbar.js` on a tab change, `hk-popup.js` on open.
- The bridge already maps `light`, `heavy`, `success` and `warning`. `selection` is added for slider steps.

**Touches:** HK's shared cards, one line each plus the helper. Keep it to calls, not behaviour, so the HA build is
byte-for-byte unchanged in what it does.

**Check:** a JS test that the helper is a no-op without the bridge and calls it with it, and a light toggle on the
iPhone.

### 4. One menu button (1 session, app plus a small page hook)

**What:** the app's own ⋯ button goes. Its items (Favorites, Face ID, Notifications, Clear Cache, Sign Out) appear in
the page's own menu as a "Mantel App" group, only inside the app. Mantel Settings is already in the page's menu.

**How:**
- The `ios` host tells the page what native items it has (`mantelNative.menu` = a short list of ids and titles).
- `hk-menu.js` and `hk-tabbar.js`'s More sheet add those rows when the list is there.
- A tap posts `{type: 'menu', id}` and the app opens the matching native sheet (`AppMenu`, `FavoritesEditor`).
- The Away badge moves into the same group as a row ("Connected: Away").

**Touches:** HK's menu module, guarded the same way as the haptics.

**Check:** in the Simulator, with a tab bar and with the side menu, the group is there in the app and absent in a
desktop browser (headless smoke).

### 5. Swipe from the left edge to go back (1 session, app plus a small page hook)

**What:** the iOS edge swipe goes back a page, with the page sliding as in any iOS app. On Home it does nothing.

**How:**
- WebKit's own back-and-forward swipe is wrong here, because HK's pages are one document with pushState
  navigation.
- Use WebKit's own gesture (`allowsBackForwardNavigationGestures = true`) only if it cooperates with pushState. It
  does for same-document history in recent WebKit, so this is tried first.
- If it doesn't, a `UIScreenEdgePanGestureRecognizer` on the left edge calls `history.back()` through the bridge. The
  page already handles `popstate` (`hk-view-host.js` route), and a snapshot of the current page slides away under the
  finger.
- The page tells the app whether there is anywhere to go back to (`mantelNative.canGoBack`), so the gesture is off on
  Home.

**Check:** in the Simulator, Home → Living Room → a detail sheet, then swipe back twice.

### 6. A status bar that matches the page (½ session)

**What:** dark status-bar text on light pages (light Flat, light themes), light text on dark ones, following the
page as it changes.

**How:**
- The page already knows its tone (`hk-base.js` `tone()`, `data-hk-light`).
- On the `ios` host it posts `{type: 'tone', light}` whenever that changes.
- `MainView` sets `.preferredColorScheme` for the status bar through a `UIHostingController` subclass that
  overrides `preferredStatusBarStyle`.

**Check:** light Flat and a dark page in the Simulator.

### 7. A native music player (4–6 sessions: server, then app)

**What:**
- A SwiftUI Now Playing screen in place of the web sheet on the iPhone, in the layout of the Live Activity and the
  Mac player: the cover over its own blurred copy, the song, the progress, previous, play/pause and next, the volume,
  and Speakers / Queue / Browse.
- Opened by the page's mini player and the dashboard's playing bar (the bridge intercepts the tap on the `ios`
  host), by the Live Activity, and by the widget.
- Real blur, swipe down to close, haptics, and VoiceOver.
- The iPad keeps the web page's two-column Music page.

**Needs on the server (new module, no shared-file edits beyond registration):**
- `GET /api/app/music`: the person's music context as the Music page reads it (`hkMusic`'s answer: what plays and
  where, position, volume, the speakers and presets, Up Next).
- `GET /api/app/events`: a live feed for the app, as Server-Sent Events with the same DPoP proofs as every app call.
  It carries summary and music changes for this person only, filtered by RBAC like every read.
  - It also lets the widgets and the Live Activity stop polling. Today the Live Activity updates only when the app
    is open, or by push.
- Commands go through the existing `/api/app/command`:
  - `hk_frontend.music_transport` for previous, play/pause and next;
  - `media_player.volume_set` for the volume, the group's members together, as `mantel-player.js` does;
  - `music_play` and `music_transfer` for Speakers.

**App:**
- `MantelKit`: the music model and the SSE client (reconnects, and backs off when the server is gone).
- `Mantel/NowPlayingView.swift`.
- Speakers and Queue as native sheets.
- Browse stays the web page's Browse, opened behind the player: the library, search and playlists are large, and
  they already work.

**Check:**
- Server tests for both endpoints (RBAC, audit rows for every command, the feed ending on sign-out).
- The fictional house in `tools/app_dev_server.py` gets a fictional music context and queue.
- Simulator: play, pause, skip, volume and speakers each send a command with its audit row, and the screen follows.

## Order

| Slice | Items | Sessions | Ships as |
|---|---|---|---|
| A | 1, 2, 6 | 2 | App build only |
| B | 3, 4, 5 | 3 | App build plus an App update (the shared web hooks) |
| C | 7 (server) | 2 | App update (new endpoints; older apps ignore them) |
| D | 7 (app) | 2–4 | App build |

In total, about 9–11 sessions. Slices A and B can run at the same time in separate sessions (A is app-only; B
touches the web code). C must land on the house before D can be tried on the phone.

## What needs Avery

- Nothing to start A.
- For B and C, his usual go-ahead to merge and ship an App update (backup first).
- One design check for D: a screenshot of the native player in the Simulator before it replaces the web sheet.
- TestFlight is not needed for any of this: Debug builds on his iPhone, as now.

## Risks

- **Shared HK code (3, 4, 5, 6):** every hook is behind `window.mantelNative`, so the wall tablets and Home Assistant
  are unaffected. The frontend suites and the CSS snapshot hold that.
- **A second music UI to keep in step (7):** the native player reads the same `hkMusic` answer and sends the same
  commands as the web page, so the house stays the single source. Browse stays web on purpose.
- **SSE through the tunnel (7):** Cloudflare passes Server-Sent Events, but idle streams are cut at about 100 s. The
  feed sends a comment every 30 s, and the client reconnects with its last event id.
