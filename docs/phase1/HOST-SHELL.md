# Phase 1, slice 8: HA shell hooks behind one host-shell adapter

Completed on branch `phase1-slice8` (built in parallel with slice 5; the planning session
merges it). Production HK has not been edited or deployed.

Follows [`MUSIC-ART.md`](MUSIC-ART.md) in pattern: a shared contract in `web/client`, the HA
implementation in `hosts/ha/frontend`, Mantel's in `web/shim`, and a boundary test with a
budget that may only go down. MUSIC-ART.md's continuation point is not marked superseded here,
because slice 5 continues from it in parallel; the merge should link it to this doc and slice 5's.

## The adapter

- **`web/client/hk-host-shell.js`** defines `window.hkShell`: the contract plus the no-host
  defaults (every element null, HK's own neutral event names `hk-navigate`, `hk-more-info`,
  `hk-toast`). It names no HA element or event (pinned by `tests/test_shell_boundary.py`).
  A host installs itself with `hkShell.use(impl)`; omissions keep the defaults, a throwing
  lookup answers null. Every lookup is made fresh on each call and every global (`window`,
  `document`, `history`, `CustomEvent`) is read at call time.
- **`hosts/ha/frontend/hk-ha-shell.js`** is the HA implementation and the only frontend file
  that names HA's elements and frontend events. It walks the same path the modules walked:
  `<home-assistant>` shadow → `<home-assistant-main>` shadow → `ha-drawer` / `ha-sidebar` /
  `partial-panel-resolver` → `ha-panel-lovelace` shadow → `hui-root` shadow →
  `hui-view-container#view` → `hui-view-background`, `hui-view`. It is bootstrapped from
  `__init__.py` right after the client modules, before `hk-settings.js` and every module that
  uses it (pinned by `test_host_shell_bootstraps_before_every_module_that_uses_it`), composed by
  `publish.py`, and loaded in the JS suites' prelude.
- **`web/shim/mantel-shell.js`** is Mantel's: the overlays mount in `#hk-shell-root`, the view
  container is `<hk-view-container id="view">` around `#app`, the panel is that container,
  `dashboardConfig()` is the strategy's generated config, `isDashboard()` is true.
  `home.js` installs it before any HK module and calls `hkMantelShell.setPage(view, cfg)`
  once the view is built. Its event names stay HA's for now: `hk-detail.js` and `hk-saver*.js`
  (slice 5's files) still fire and hear them directly, so both sides agree in Mantel.

### API (`window.hkShell`)

| Member | Meaning (HA implementation) |
|---|---|
| `kind` | `'ha'`, `'mantel'`, `'page'` (dev pages) or `'none'` |
| `events.navigate` / `navEvent`, `events.moreInfo`, `events.toast` | `location-changed`, `hass-more-info`, `hass-notification` |
| `tags.{root,main,drawer,sidebar,resolver,panel,dashboard,viewContainer,view,viewBackground}` | element names, for selectors written into stylesheets |
| `viewTags`, `foreignTags` | HA's view kinds (glass, frost tint); HA's views/card editor (hk-base `foreign()`) |
| `is(el, kind)` | element is the host's `kind` (by name, either case) |
| `root()`, `overlayRoot()` | `<home-assistant>`; its shadow root (where menu, tab bar, pop-ups, players mount) |
| `main()`, `mainRoot()`, `drawer()`, `sidebar()`, `resolver()` | HA's layout elements |
| `panel()` | the Lovelace panel (direct in main's shadow root, else under the resolver) |
| `dashboard(panel?)`, `dashboardRoot(panel?)` | `hui-root` and its shadow root |
| `viewContainer(panel?)`, `viewSlot(panel?)` | `hui-view-container`, asked for by name or by `#view` |
| `view(container?)`, `viewBackground(container?)`, `toolbar(panel?)` | `hui-view`, `hui-view-background`, `.header` |
| `dashboardConfig(panel?)` | `panel.lovelace.config` |
| `onDashboard()` | by `hass.panels[hass.panelUrl]` (the menu's rule) |
| `isDashboard()` | by the address's first segment; null before `hass.panels` (hk-settings' `lovelacePanel`) |
| `defined()` | `customElements.get('home-assistant')` in the current registry |
| `navigate(path, init?, {replace}?)` | `pushState` (or `replaceState`) + the navigation event with the caller's init |
| `announce(init?, from?)` | the navigation event only (after the caller's own history change), from the window or an element |
| `onNavigate(fn)` → off, `offNavigate(fn)` | listen on the window |
| `moreInfo(entityId, from?)` | `hass-more-info`, bubbling + composed, from the card or `<home-assistant>` |
| `toast(detail, from?)` | `hass-notification`, bubbling + composed |
| `showNotifications()` | `hass-show-notifications` on main |
| `keepAwake(root?)` | `hass-suspend-when-hidden { suspend: false }` on the root |

## What moved

Every HA element lookup and HA frontend event in shared code outside slice 5's files:

- **Modules:** `hk-menu.js` (overlay mount, navigation, HA sidebar parts and its lift rule,
  `onDashboard`, the swipe toast, notifications drawer, docked view), `hk-tabbar.js` (mount,
  navigation, notifications, bar-room rule, view and its aside transform), `hk-sky.js` (view
  container test and lookup, view background, panel/config, `deepFind` names, navigation),
  `hk-kiosk.js` (parts, its three stylesheets' selectors, keep-awake, navigation), `hk-idle.js`
  (navigation home, root reads, the panel walk), `hk-glass.js` (view container, view kinds,
  navigation), `hk-settings.js` (view config, `lovelacePanel` → `isDashboard`, panel, rebuild,
  kiosk re-announce, root reads), `hk-tap.js` (tap-highlight sheet selectors),
  `hk-notify.js`, `hk-skylab.js`, `hk-timers.js`, `hk-frosttint.js`, `hk-campost.js`,
  `tesla-viewport.js`. `hk-header.js` had no shell hooks.
- **Cards:** `hk-base.js` (navigate, flat sync events, `hkCards.hass()` root, more-info,
  `foreign()` names, panel lookup, dashboard config, toolbar height), `hk-popup.js` (sidebar
  width, shown view, view for docking, overlay mount, hash announce, listeners),
  `hk-strategy.js` (refresh, panel, kiosk re-announce, `defined()`), `hk-media.js`,
  `hk-cameras.js`, `hk-calendar.js`, `hk-energy.js`, `hk-room.js`, `hk-headers.js`,
  `hk-home.js`, `hk-security.js`, `hk-layout.js`, `hk-library.js`, `hk-music.js`,
  `hk-weather.js`; panel `panels/hk-settings.js`.
- **Dev pages** (`skylab.html`, `skyprobe.html`, `seasonal-scenery-review.html`) used a fake
  `<hui-view-container>`; they now load `hk-host-shell.js` and install a one-line page shell
  with their own `<hk-view-container>`, so they no longer depend on HA's names.

## Behavior

The HA build is unchanged in behavior: the same elements, the same selector strings in the
generated stylesheets (built from `tags`), the same event names, inits and targets, the same
history calls. Points to know:

- `hk-kiosk.js`, `hk-glass.js`, `hk-base.js`, `hk-strategy.js` and `hk-settings.js` each looked
  for the panel one way (direct in main's shadow root, or only under the resolver). They share
  `panel()` now: direct, then under the resolver. In HA's real DOM both find the same element
  (a shadow-root `querySelector` searches the resolver's children too); only a page where the
  first form failed now also tries the second.
- Lookups that threw on a missing element (inside the callers' own try blocks) now answer null.
- `hk-tabbar.js barRoomCss`: a view whose root node is the document (no shadow root, as in
  Mantel) put its `<style>` on `document` and threw `HierarchyRequestError`; it now goes in
  `<head>`. HA's view is always in a shadow root, so HA takes the old branch.
- **Restart gap:** the two new bootstrap URLs take effect after an HA restart, like every
  bootstrap-list change (`__init__.py` says so). Between a HACS file update and the restart the
  shared modules would load without `hkShell` and fail; HACS already requires a restart after an
  integration update. Nothing was added to paper over it.

## Mantel: the sky and the tab bar now draw

With the shell's view container and overlay root, Mantel's Home draws the live sky behind the
view and mounts the side menu (its edge tab) and, when the screen's Menu is `tabbar`, the tab
bar. Before this slice both looked for Lovelace's panel and drew nothing. The browser smoke
(`tools/headless/client_smoke.py`) now asserts: `hkShell.kind === 'mantel'`, `#hk-sky` inside
`hk-view-container#view`, `#hk-menu` in `#hk-shell-root`, the view and dashboard config known
to the shell, and, after a fictional settings push of `menu: 'tabbar'`, `#hk-tabbar` mounted in
`#hk-shell-root`, all with zero browser exceptions. Screenshots (not committed) showed the sky
gradient and the bar where the main-branch run showed a flat black page. Menu and tab-bar
taps navigate (`pushState` + event) but Mantel's Home has no router yet (Phase 2's shell).

## Boundary test and budgets

- New `tests/test_shell_boundary.py`: scans `web/` outside `web/shim/` with comments removed
  (a small JS tokenizer that keeps strings, templates and regex literals) for HA's element
  names and frontend events (`home-assistant`, `home-assistant-main`, `ha-panel-lovelace`,
  `hui-root`, `hui-view`, `hui-view-container`, `hui-view-background`, `partial-panel-resolver`,
  `ha-drawer`, `ha-sidebar`, `location-changed`, `hass-more-info`, `hass-notification`,
  `hass-toggle-menu`, `hass-show-notifications`, `ll-rebuild`, `hass-suspend-when-hidden`;
  either case, whole names only, so `--ha-sidebar-width` and `home-assistant-js-websocket`
  do not count). Budgets in **`docs/phase1/legacy-ha-shell.json`** may only go down. It also
  pins that the contract names no HA element and that the lint ignores comments.
- Shell references in shared code: **205 → 29**, all in slice 5's files (below).
- `hass` budgets (`legacy-ha-access.json`): **1,810 → 1,788** (−22): hk-base 64→63,
  hk-cameras 74→73, hk-energy 158→156, hk-headers 39→37, hk-home 45→44, hk-library 25→24,
  hk-music 39→38, hk-room 68→65, hk-security 7→6, hk-kiosk 2→1, hk-menu 19→16, hk-notify 5→4,
  hk-settings 18→16, hk-tabbar 7→6, panels/hk-settings 195→194. Most shell hooks never spelled
  `hass`; the remaining `root().hass` reads are legacy host-object reads for slices 9–11.

## Tests

- New `tests/test_hostshell.js` (jsc, 39 assertions): HA's element path (including a panel
  without the resolver), one root lookup per question (hk-strategy's test counts them), tags,
  view kinds, `onDashboard`/`isDashboard`, navigate/announce/replace with the callers' inits,
  listeners on and off, more-info/toast/notifications/keep-awake targets and inits, `defined()`,
  the no-host defaults, a host's omissions and a throwing lookup.
- `test_doorbell.js` and `test_tv.js` read the source with regular expressions; their two
  patterns now match the shell call (`hkShell.moreInfo(cam.entity, this)`,
  `mount = window.hkShell.overlayRoot() || document.body`).
- `tests/test_ha_build.py`: the HA build composes both shell files; the bootstrap order.

## Validation

- Frontend: **115 suites** (114 + `test_hostshell`). All pass except `test_weathersheet`'s
  "a day without hourly coverage" assertion, which is clock-dependent: it fails identically on an
  unmodified `b1b4d9c` build run at the same moment (23:01 EDT) and passed in this branch's
  earlier runs (22:5x EDT). Not caused by this slice.
- HA Python: **665 passed, 1 skipped.**
- Mantel: **151 passed** (147 + 3 shell-boundary + 1 build-order).
- Browser smoke: passed, with the new host-shell assertions; zero blocked writes, external
  requests and browser exceptions; commands `commands_disabled`.

## Exact continuation point (superseded by Slice 8b below)

Slice 8 is complete except for slice 5's files, which were being edited in parallel and were
left alone. When slice 5 has merged, move these to `hkShell` and lower
`docs/phase1/legacy-ha-shell.json` (17 + 11 + 1 = 29 → 0), then switch `mantel-shell.js` to
HK's own event names (or drop its `events` override):

- `web/hk/cards/hk-detail.js`: 851 and 2268 (`<home-assistant>` root reads), 984–986, 1001–1003,
  1474–1476 (panel lookups: `hkShell.panel()`), 2385 (`onNavigate`), 2403 and 6305 (`announce`),
  2453 (window `hass-more-info` listener: `hkShell.events.moreInfo`), 6240 (`navEvent` in a list).
- `web/hk/modules/hk-saver.js`: 395 and 1522 (root), 401–406 (panel), 411–412 (`viewContainer`),
  719 (`navigate`), 4272 (`onNavigate`).
- `web/hk/modules/hk-saver-panel.js`: 762 (`hkShell.events.toast` listener).

Then slice 9 onward: the `root().hass` legacy reads (hk-idle, hk-sky, hk-notify, hk-settings,
hk-timers, hk-skylab, hk-base `hkCards.hass()`) move to the client.

## Slice 8b: the last shell references, HK's own event names, a clock-free fixture

Branch `phase1-slice8b` (parallel with slice 7; the planning session merges it).

### What moved (29 shell references to 0)

- `hk-detail.js`: `haRoot()` is `hkShell.overlayRoot() || document.body`; `hasView`/`viewOf` read
  `hkShell.dashboardConfig().views`; `generatedHere` reads `hkShell.panel().lovelace.rawConfig`; the
  sheet's `moved` listener, the three-event route listener and `navigateFrom` use
  `onNavigate` / `navEvent` / `navigate`; the hash navigation of `asked` uses `announce({detail:{replace:false}})`
  after its own history call; the capture listener hears `hkShell.events.moreInfo`; `fromDashboard`
  asks `hkShell.is(el, 'panel')` instead of the tag name.
- `hk-saver.js`: `panel()` is `hkShell.panel()`; `viewFont` uses `hkShell.viewContainer(panel())`; `go()`
  is `hkShell.navigate`; the page cover uses `hkShell.root()`; the refresh listener is `onNavigate`.
- `hk-saver-panel.js`: the toast listener hears `hkShell.events.toast`.
- `tests/test_shell_boundary.py` has no budget file any more: any HA element or event name in `web/`
  outside `web/shim/` fails it. `docs/phase1/legacy-ha-shell.json` is deleted (29 to 0).
  `test_detail.js`'s source-pattern test follows the listener's new spelling.

Behavior in the HA build is unchanged: same elements, same event names (the HA adapter still maps
`navigate` to `location-changed`, `moreInfo` to `hass-more-info`, `toast` to `hass-notification`),
same history calls. One small difference: `hk-saver.js`'s panel lookup now also tries the form the
other modules used (direct, then under the resolver), as it already did; the dashboard-config and
`viewFont` reads that threw on a missing element now answer null (they sat in try blocks).

### Mantel's event names

`web/shim/mantel-shell.js` no longer overrides `events`: Mantel's shell uses the contract's
defaults `hk-navigate`, `hk-more-info`, `hk-toast`. Nothing in shared code names a host's raw
events, so both sides agree through `hkShell`. The smoke asserts `nav == "hk-navigate"`. The HA host
is untouched.

### The weather-sheet fixture

`test_weathersheet.js` built its hourly fixture from `Date.now() + 1 h / + 2 h`, so between 22:00 and
24:00 those hours were tomorrow's, and "a day without hourly coverage" (tomorrow) found coverage. The
test now pins `Date` to noon of the current date before anything loads. Proof (built tree, a copy of
`tests/run` that loads a fake clock into the prelude): the OLD test fails at a faked 23:30 and passes at
12:00; the NEW test passes at 23:30 and at 12:00.

Found, not fixed (out of scope): `test_calendar` "the next one says how soon" is also clock-dependent
(its event is now + 30 min, which crosses midnight after 23:30). The whole suite at a faked 12:00 is green;
at a faked 23:30 only that assertion fails.

### Validation

Frontend 117 suites green (real clock); HA Python 665 passed, 1 skipped; Mantel 155 passed; browser
smoke green (0 external requests, 0 browser exceptions, commands disabled). `hass` budget unchanged (1,617).

### Exact continuation point

The host-shell work is complete: no shared code names an HA element or event. Remaining Phase 1 work is
the `hass` budget (slices 9 to 11): the `root().hass` legacy reads (hk-idle, hk-sky, hk-notify,
hk-settings, hk-timers, hk-skylab, hk-base `hkCards.hass()`) move to the client. Optionally make
`test_calendar`'s soon-event fixture clock-independent the same way.
