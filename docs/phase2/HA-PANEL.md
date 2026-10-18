# Phase 2, P2.6: HK as its own Home Assistant panel (opt-in)

Branch `worktree-agent-a78f51676a22fe29a` (not pushed or merged; the orchestrator merges it).
Production HK has not been edited or deployed. Mantel commands stay disabled.

## What it is

When it is switched on, HK registers a `panel_custom` in Home Assistant at `/hk-panel`. The
sidebar title is "HK". The panel draws one HK screen with HK's own view host
(`web/hk/shell/hk-view-host.js`, P2.3) instead of Lovelace. The page then has no `hui-root`, no
`ha-panel-lovelace`, no Lovelace restyling and no Lovelace-wide state.

The Lovelace dashboards are left exactly as they are. Until Avery switches, the panel is simply
one more page.

## How to switch it on (and off)

The panel is controlled by one setting key in the entry's options, `hk_panel`. It is written by
the admin command `hk_frontend/settings/set`, the same command that writes the HK Settings
page's own `sidebar` switch:

```js
// in the browser console, signed in as an admin
document.querySelector('home-assistant').hass.callWS({ type: 'hk_frontend/settings/set',
  changes: { hk_panel: { screen: 'dashboard-kitchen' } } })
```

| Key | Meaning | Default |
|---|---|---|
| `screen` | The HK dashboard (its url path) whose settings and strategy options the panel draws with. `''` draws HK's defaults. `lovelace` is the Overview. | `''` |
| `admin` | `true`: only admins see the panel. | `false` (everyone, like a dashboard) |
| `sidebar` | `false`: the panel is not in the sidebar. `/hk-panel` still works. | `true` |

To switch it off, set `hk_panel` to `null` (or `false`). Each change takes effect without a
restart: the entry's update pass registers the panel, updates it in place, or removes it.
Values are validated (`hk_panel.check`). A value that is not one of the shapes above is refused
whole with `invalid_format` / `{"hk_panel": "hk_panel"}`, and nothing is stored.

This slice adds **no UI**. HK Settings does not show the setting yet, and Configure is unchanged
(its schema is pinned by `test_configure.py`/`test_panel.py`). See "Not covered yet".

## What it draws

`hosts/ha/frontend/hk-ha-panel.js` (published as `frontend/modules/hk-ha-panel.js`) defines
`<hk-ha-panel>`. HA's `panel_custom` creates this element and sets `hass`, `narrow`, `route` and
`panel` on it.

- **The HA adapter.** The panel's `hass` setter is the only place it names HA's object. It turns
  that object into HK's client at once (`hkHostClient.from`). Everything after that uses the
  client.
- **Card code.** The panel loads the Lovelace resources (`lovelace/resources`, a read, the same
  list Lovelace loads) together with HK's own card files and stylesheets. HK's list comes from
  `resources.wanted()` and is sent in the panel's config, so a house with resources written by
  hand still gets HK's files. Each file is loaded the way HA's resource loader does it: a module
  is `import()`ed (the same URL is the same module, so it runs once), and a stylesheet is linked
  once in `<head>`.
- **The strategy.** The panel reads the chosen screen's own `strategy:` block with
  `lovelace/config` (a read). It then calls `hkStrategy.generate(thatBlock, client)`, exactly as
  Lovelace would for that dashboard. With no screen, or a dashboard that is not generated, the
  block is `{}`.
- **The screen's settings.** HK's frontend identifies a screen by the first segment of its
  address (`boards[seg]`, read in about 26 places: the strategy, menu, sky, kiosk, saver and
  others). The panel's segment is `hk-panel`. So while the panel is on, the settings feed
  (`hk_frontend/settings/subscribe`) also sends the chosen screen's board under `hk-panel`
  (`hk_panel.mirror`). While the panel is off, the feed is unchanged.
- **Drawing.** The panel uses `hkViewHost.create` with the panel's own
  `<hk-view-container id="view"><div id="app">` in its shadow root, `base: '/hk-panel'`,
  `follow: false` and `leave: () => {}`:
  - `follow: false` because the client comes from the `hass` setter;
  - `leave` is empty because HA's own router handles a move to another HA page.
- **Theme.** On each view, the view's `theme` (HK Kiosk) is applied to the container: the
  theme's variables first, with its dark mode's variables on top. This is roughly what HA does
  for a view. Lovelace's full `applyThemesOnElement` is not used.
- **Rebuilds.**
  - A `config-refresh` event on the panel causes a rebuild. `hk-strategy.js`'s `refresh()` fires
    this event after a settings change. In panel mode `hkShell.panel()` is the panel element and
    `hkShell.dashboard()` is null, so the event lands on the panel.
  - When the strategy's `shouldRegenerate` says the registries changed, the panel rebuilds after
    1 s.
  - A rebuild stops the old view host and mounts a new one in the same container, at the same
    address.
- **HK's boot.** A panel opened straight away can arrive before HK's ordered boot (`hk-boot.js`).
  If it does, it waits for `hk-host-shell-ready` / `hk-ha-client-ready` (polling slowly as a
  fallback, for 20 s at most) and then takes the same `hass` again. The ordered boot itself is
  unchanged: `boot.py`'s lists are untouched, and the panel's module is not in them.

## Routing

Views are at `/hk-panel/<view>`. A view without a `path` is addressed by its index, and an
unknown view shows the first, as in HA. The view host's router handles these moves:

- HK's own navigation (`hkShell.navigate`, which is `location-changed` in HA): the menu, the tab
  bar, a card's `navigate`;
- the back button (`popstate`).

Both swap the view in the same slot, so the container, the sky, the menu and the tab bar stay
mounted. An address outside `/hk-panel` is left to HA's router. When HA leaves the panel, it
disconnects the element: the view host stops listening and the shell returns to Lovelace mode.
When the panel is shown again, the same view host starts again at the current address. Nothing
is regenerated.

## The shell's modes (`hosts/ha/frontend/hk-ha-shell.js`)

The HA shell now has two modes:

- **`lovelace`.** This is the default, and the only mode unless the panel is on. All its answers
  are unchanged.
- **`panel`.** `hkHAShell.ownPanel(el, viewHost, url)` installs a variant of the HA shell. The
  view host's `shellParts()` are merged in again on every view, as Mantel's shell does. In this
  mode:

  | Shell part | Answer in panel mode |
  |---|---|
  | `panel()` | the `<hk-ha-panel>` element |
  | `viewContainer()`, `viewSlot()`, `view()`, `dashboardConfig()` | the view host's |
  | `dashboard()`, `dashboardRoot()`, `toolbar()`, `viewBackground()` | `null` |
  | `tags.card` | `null` (no Lovelace card wrapper: `hkCards.createCard` makes children with the view host's factory, P2.3) |
  | `tags.panel` | `hk-ha-panel` |
  | `tags.dashboard` | `null` |
  | `tags.viewContainer` / `tags.view` | the panel's own elements |
  | `onDashboard()` / `isDashboard()` | true on the panel's address; elsewhere, HA's answer |

  Everything else is still HA's: the kind (`ha`), the events, the root, the overlay root (the
  menu, tab bar and sheets mount in `<home-assistant>`'s shadow root, as on a Lovelace
  dashboard), the drawer and sidebar, `holdWrites` and `menuButton`.
- `hkHAShell.lovelace(el)` puts Lovelace's answers back. It does nothing when called for a panel
  that is not the one in charge, or when the shell is already in Lovelace mode.
- `hkHAShell.currentMode()` returns `'lovelace'` or `'panel'`.

## No behaviour change while it is off: how that is pinned

- **Python** (`tests/py/test_hk_panel.py`, 12 tests):
  - `test_off_by_default_nothing_is_registered_and_the_feed_is_unchanged`: after setup there is
    no `hk-panel` in `DATA_PANELS` and no `hk_panel` option, and HK Settings is still registered.
    The settings feed's boards are exactly `as_client`'s, with no `hk-panel`. An update pass
    with the panel still off registers nothing.
  - The other tests cover:
    - the panel when switched on (custom, "HK", `hk-ha-panel`, the module URL, the screen, not
      admin-only, in the sidebar, the feed's mirror);
    - following the setting (admin, sidebar, screen; off with `null` and `false`);
    - six refused shapes, with nothing stored and nothing registered;
    - that only admins can switch it;
    - registration at start when it is on, and removal on unload;
    - the pure helpers.
- **Mantel** (`tests/test_ha_build.py::test_ha_panel_is_published_and_loaded_only_by_its_opt_in_panel`):
  the panel module is published at `frontend/modules/hk-ha-panel.js`. Neither it nor the view
  host is in `boot.py`, `__init__.py` or `resources.py`. Only `hk_panel.py` names its module URL.
- **Frontend:**
  - `test_hostshell.js` (64 assertions, 15 new): the default is Lovelace mode with `card: 'hui-card'`;
    in panel mode the parts are the panel's and `card` is null; `lovelace()` restores every
    Lovelace answer, including the wrapper; a stale view listener changes nothing.
  - All existing suites pass unchanged (`test_childcard`'s Lovelace order `hass, preview,
    config, load`, `test_viewhost`, and others).
- **Unload:** `hk_panel.async_unregister` is called on unload. While the panel is off this does
  nothing (`async_remove_panel(warn_if_unknown=False)` on a missing panel sends no event).

## Tests added

- `tests/test_hapanel.js` (29 assertions, using test_viewhost's small DOM) covers the element:
  - its own container;
  - loading: the view host first, then the resources (Lovelace's plus HK's list, each once) and
    the stylesheets (linked once);
  - the screen's `lovelace/config` read, and the strategy given that block and HK's client
    (never HA's object);
  - the first view drawn in the slot, with the view and cards fed through the adapter;
  - the shell in panel mode with no card wrapper, and the panel's address counted as a
    dashboard;
  - the theme's variables on the container;
  - a new `hass` followed;
  - navigation to Lights in the same slot, with Lovelace's grid drawn by HK;
  - back to the cached Home;
  - an outside address leaving the page alone (no page load);
  - `config-refresh` rebuilding, with the shell following;
  - a registry change rebuilding;
  - leaving the page restores Lovelace mode, and coming back restores panel mode without a
    rebuild;
  - no `hui-*`/`ha-*` element made, and no errors;
  - a panel with no screen gets `{}` and no dashboard read;
  - `applyTheme` clearing its variables.
- `tests/py/test_hk_panel.py` and the hostshell additions, described above.

## Scratch-HA evidence

The scratch Home Assistant (`tools/testha`) ran at 127.0.0.1:8124 with demo devices only. HK
was built from this branch (`testha.py up --fresh`, base `8a9199b` plus this slice's changes).
The check was a throwaway script in the session scratchpad, driving `tools/testha/check.py`'s
browser (127.0.0.1 only), with `screen: hk-scratch`. Result: **14/14**, then `testha.py down`.

| Check | Result |
|---|---|
| Off (the default) | `hk-panel` not among HA's 19 panels |
| `settings/set {hk_panel: {screen: 'hk-scratch'}}` | a custom panel titled "HK", `hk-ha-panel`, `require_admin: false` |
| `/hk-panel` | Home drawn by the view host: `hk-grid-view`, 10 tiles, 8 status chips, the header. The sky and the menu are drawn. One placeholder, `picture-entity` (the camera mosaic's live picture: a built-in card made by `hkCards.createCard` with no wrapper; the mosaic's stills draw). |
| No Lovelace | 0 `hui-root`, 0 `ha-panel-lovelace` on the page, 0 `hui-*` inside the panel |
| Shell | mode `panel`, `panel()` is `hk-ha-panel`, `tags.card` null, view container `hk-view-container` |
| Settings | the feed's `boards['hk-panel']` is present (the mirror) |
| `hkShell.navigate('/hk-panel/lights')` | Lights in the same panel (21 cards), Home detached and cached; the menu highlights Lights |
| `history.back()` | the cached Home element again |
| Tile tap (demo `light.kitchen_lights`) | on → off through the action port (put back after) |
| HA navigation to the Lovelace `/hk-scratch` | Lovelace draws it; the shell is back in `lovelace` mode (`hui-card`, `ha-panel-lovelace`) |
| HA navigation back to `/hk-panel/home` | panel mode again, drawn |
| `/hk-panel/lights` opened directly | that view is drawn first |
| Console | **0 errors** (Apple glyph/font noise filtered, as `check.py` does), **0 failed websocket results**, 0 blocked external requests |
| `hk_panel: null` | the panel is gone |

The screenshots (`p26-01-home.png`, `p26-02-lights.png`, `p26-03-lovelace.png`) are in the
session scratchpad, `testha/shots-p26/`. They are not committed. They show HK's sky, the open
computer menu with HA's own sidebar beside it, the status chips, the cameras and the room tiles.

## Validation

| Check | Result |
|---|---|
| Frontend suites | **124** suites green (123 + `test_hapanel`) |
| HA Python | **678 passed**, 1 skipped (666 + 12) |
| Mantel tests | **188** passed (187 + 1) |
| Browser smoke | passed (unchanged: the panel is HA-only) |

## Not covered yet

- **No UI for the switch.** HK Settings could add a row ("HK panel: screen, admins only, in the
  sidebar") that writes `hk_panel` through the same `settings/set`. `panel/get` does not report
  the setting yet.
- **Screen identity is the address.** The panel is the screen `hk-panel`. The settings feed
  mirrors the chosen screen's board under that name, but other per-screen data still keys on
  the real dashboard's path:
  - per-screen accessory names (`names[screen]`);
  - a wall tablet's `screen`;
  - Show pop-up's `dashboards:` filter;
  - the strategy's per-dashboard energy links;
  - hk-saver's `msg.dashboard`.

  On the panel these follow `hk-panel`. Making the screen key independent of the address (one
  `hkShell.screen()` used in the ~26 places) is the clean follow-up.
- **HA's own cards inside HK cards.** `hk-grid-card`, `hk-frame` and the pop-ups ask
  `window.loadCardHelpers`. In HA that is HA's own helper, so built-in card types (for example
  the energy cards) are HA's own card elements inside an HK card. The page still has no
  Lovelace dashboard machinery (no hui-root, no Lovelace state). Containers made through
  `hkCards.createCard` use the view host's factory instead, which gives a placeholder for a
  built-in type. In the scratch HA this is the camera mosaic's live `picture-entity`.
  Unifying the two (built-in types through HA's helpers inside the view host's factory, when the
  host has them) is a small follow-up.
- **Kiosk and the HA header.** A panel has no HA toolbar, so `hide_header` has nothing to hide.
  `hk-kiosk.js` still hides HA's sidebar through the shell's drawer and sidebar, which are
  unchanged.
- **Theme.** Only the variables are applied, not HA's derived colours. HK's cards read `--hk-*`
  and the font variables, which are covered.
- **Edit mode, badges, per-card `visibility:`, the grid's `square`.** These are as listed in
  VIEW-HOST.md.
- **A live switch** happens only with Avery (ROADMAP).

## Exact continuation point

P2.6 is complete on its branch. HK can draw itself as an HA panel at `/hk-panel` when `hk_panel`
is set. Off is the default and is pinned. The Lovelace dashboards are unchanged. Next steps:

1. Merge, then re-run the five validations (build, frontend suites, HA pytest, Mantel pytest,
   smoke).
2. Add an HK Settings row for `hk_panel`, with `panel/get` reporting it.
3. Separate a screen's identity from its address (`hkShell.screen()`). Then the panel, and later
   any host, can be any screen without the settings-feed mirror.
4. In the view host's factory, use the host's card helpers for built-in types when they exist,
   so HK containers in the panel draw HA's built-in cards instead of placeholders.
5. With Avery: try the panel on one real screen (for example a phone), then decide on the
   switch.
