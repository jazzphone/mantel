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

### 7. A native music player (2–3 sessions, app only: the Mac app's server side and client are reused)

**What:**
- A SwiftUI Now Playing screen in place of the web sheet on the iPhone: the cover over its own blurred copy, the song,
  the progress, previous, play/pause and next, the volume, and Speakers / Up Next / Browse.
- Opened by the page's mini player and the dashboard's playing bar (the bridge intercepts the tap on the `ios`
  host), by the Live Activity, and by the widget.
- Real blur, swipe down to close, haptics, and VoiceOver.
- The iPad keeps the web page's two-column Music page.

**Already built for the Mac app, and on the house since App 0.1.33:**
- **Server (`app_music.py`):** the apps' music over REST, DPoP-bound to the app's credential:
  - `GET /api/app/music`: what plays and where, the speakers, presets and playlists;
  - `POST /api/app/music/command`: transport, transfer, play, play_media and stop through the gateway, with the
    audit row;
  - `POST /api/app/music/volume`;
  - `PUT /api/app/music/focus`;
  - the queue and queue play, the library, and library images.
  Nothing server-side is needed for the iPhone.
- **`MantelKit/Music.swift`:** the models and the client calls, shared by every target already.
- **`MantelMac/MusicModel.swift`:** the player's state, refreshed every 2 s while a player is on screen (15 s
  otherwise), presses drawn at once, held volume while dragging, and an image cache.
- **`MantelMac/PlayerViews.swift` and `MusicPanes.swift`:** the player and its Speakers / Up Next / Browse panes, in
  SwiftUI.

**What the iPhone needs:**
- **Move `MusicModel` to `Common/`:** its 7 AppKit uses are `NSImage` in the image cache. A small `PlatformImage`
  alias (`UIImage` / `NSImage`) makes it shared, and the Mac keeps working unchanged.
- **Move the parts of `PlayerViews` and `MusicPanes` that aren't Mac-specific to `Common/`:** the cover, the
  transport, the volume, and the Speakers / Up Next / Browse lists. Keep the menu bar layout in `MantelMac/`.
- **`Mantel/NowPlayingView.swift`:** the iPhone layout, presented as a full-height sheet with swipe down to close.
  Browse as a pushed list, as in Apple Music.
- **The bridge:** on the `ios` host, a tap on the Music page's mini player or the dashboard's playing bar posts
  `{type: 'player'}` instead of opening the web sheet. These are small guarded hooks in `hk-music.js` and
  `hk-media.js`, the same pattern as items 3–6.
- **The Live Activity's tap** opens the native player (a `mantel://player` link).
- **The Live Activity and widgets** can read the same `MusicModel` while the app is open, so they follow it closely.

**Not needed after all:** the live event feed (`/api/app/events`) in the first version of this plan. The Mac
player's 2-second refresh while it is on screen is enough, and it can be added later if the Live Activity should
follow the house with the app closed.

**Check:**
- The fictional house (`tools/app_dev_server.py`) answers `/api/app/music` from its fictional speaker. It needs
  Mantel's music engine on, as the Mac session's own checks did.
- Simulator: play, pause, skip, volume, speakers and queue each send their command with its audit row, and the
  screen follows.
- The Mac app still builds and its player is unchanged.

## Order

| Slice | Items | Sessions | Ships as |
|---|---|---|---|
| A | 1, 2, 6 | 2 | App build only |
| B | 3, 4, 5 | 3 | App build plus an App update (the shared web hooks) |
| C | 7 | 2–3 | App build plus an App update (the two small player hooks); the server side is already on the house |

In total, about 7–8 sessions. A and C can start at once in separate sessions: A is app-only, and C's web hooks touch
`hk-music.js` and `hk-media.js`, which A does not. B and C both add bridge hooks to the web code, so they go one after
the other, or in separate files with care.

## What needs Avery

- Nothing to start A.
- For B and C, his usual go-ahead to merge and ship an App update (backup first).
- One design check for C: a screenshot of the native player in the Simulator before it replaces the web sheet.
- TestFlight is not needed for any of this: Debug builds on his iPhone, as now.

## Risks

- **Shared HK code (3, 4, 5, 6):** every hook is behind `window.mantelNative`, so the wall tablets and Home Assistant
  are unaffected. The frontend suites and the CSS snapshot hold that.
- **A second music UI to keep in step (7):** the native player reads the same answer through `app_music.py` and
  sends the same commands as the web page, so the house stays the single source.
- **Two players sharing code (7):** the Mac and the iPhone share `MusicModel` and the panes once they move to
  `Common/`. A change for one is checked on both (the Mac build is part of the check).
