# Phase 2, P2.3: HK's own view host

Branch `worktree-agent-ace6676a93f5cccb9` (parallel with P2.2 and P2.4; the orchestrator merges it).
Production HK has not been edited or deployed. Mantel commands stay disabled.

## What it is

`web/hk/shell/hk-view-host.js` is shared, host-neutral code that draws an HK dashboard from the
strategy's output (`hkStrategy.generate`) without Lovelace's page machinery: no `hui-root`,
`hui-view` or `hui-card`, and no host element of any kind. It generalises what Mantel's
`web/home.js` and `web/shim/cards-bridge.js` did for the Home page alone:

- **Views by address.** `/<dashboard>/<view>`, as HA's frontend has it. A view without a `path` is
  addressed by its index, and an unknown view shows the first, as Lovelace does.
- **The view element.** A `custom:` view is made by its tag, after its definition arrives. Any other
  view type (masonry, sections, panel) gets `hk-view-fallback`, which shows the cards in a column
  under a note; a sections view contributes every section's cards. A view whose `setConfig` throws
  also gets the fallback, with the error in its note.
- **Lovelace's order.** `setConfig`, then the client (the host adapter's `bridge`), then `narrow`,
  `index`, and `cards`.
- **The card factory, `createCardElement(config, client)`:**
  - a `custom:` card is made by its tag, then `setConfig`, then the client;
  - a card whose code has not loaded yet is configured and given the newest client once it is
    defined (upgraded in place), as Lovelace's wrapper does;
  - Lovelace's `grid`, `vertical-stack`, `horizontal-stack` and `conditional` are drawn by HK's own
    small containers (`hk-view-grid`, `hk-view-stack`, `hk-view-conditional`). Each takes its input
    at the host adapter's entry and gives its children the client. The conditional understands
    `state`, `numeric_state`, `screen`, `user`, `and`/`or`/`not` and the legacy form;
  - any other Lovelace card type, a card whose config throws, or one with no type gets a labelled
    `hk-card-placeholder`. HA's own element is never used.
- **Following the client.** On each `hk-client-update`, the view host takes `hkHostClient.current()`
  and gives it to the view on screen and every card in it. A view you leave is cached with its
  cards, as `hui-root` caches views, and catches up with the newest client when shown again.
- **Routing.** `hkShell.onNavigate` (HK's own navigation: menu, tab bar, a card's `navigate`) and
  `popstate` (the back button) swap the view inside the same slot. The container stays mounted,
  so the sky, the menu and the tab bar are not remounted. A hash change (a pop-up) is not a page
  change. An address on another dashboard leaves (the `leave` option, by default a page load). The
  newest `show()` wins.
- **The shell.** `shellParts()` answers the host-shell questions it can (`panel`, `viewContainer`,
  `viewSlot`, `view`, `dashboardConfig`, `tags.view`, `tags.viewContainer`). `onView` listeners
  hear about each new view **before** it is attached, so when the view announces `hk-view-ready`
  on attach, `hkShell.view()` already returns it for the tab bar and the sky.
- **Lovelace's card helpers.** On a host without them, `window.loadCardHelpers` is the factory.
  `hk-grid-card`, `hk-frame`, the pop-ups and the detail sheets ask for it.

### API (`window.hkViewHost`)

| Member | Meaning |
|---|---|
| `create(opts)` | a host. `opts.container` (required: the element that holds the view; the sky mounts in it), `slot` (where the view element goes; default the container), `config` (`{views}`), `client`, `base` (`/<dashboard>`; default the address's first segment), `follow` (`false`: the caller calls `setClient`), `willShow(view, first)` (awaited before a view is shown), `leave(path)`, `helpers` (`false`: don't install `loadCardHelpers`) |
| `createCardElement(config, client?)` | the card factory above |
| `holds(condition, client)` | the conditional card's test |
| `define()` | defines the placeholder and the container elements (done by `create`/`createCardElement`) |
| host `.start()` | listen (navigation, back button, client updates), then show the address's view; resolves with its element |
| host `.show(path)` | show a view by path or index; resolves with its element, or `null` if a newer `show()` took over |
| host `.navigate(path)` | `hkShell.navigate(base + '/' + path)` |
| host `.setClient(client, force?)`, `.refresh()` | give the view on screen and its cards a client (`refresh`: the same one again) |
| host `.current()` | `{path, index, view, element, cards}` |
| host `.cached()` | the paths built so far |
| host `.shellParts()`, `.onView(fn)` → off | for the host shell (above); `fn(element, view, config, {first, path})` |
| host `.stop()` | stop listening |

## What `web/home.js` became

A thin bootstrap. It connects the hub, builds the host snapshot and its client, loads HK's
modules and cards, runs the strategy, then:

```js
const viewHost = hkViewHost.create({ container: #view, slot: #app, config: cfg, client: host.client,
                                     base: '/' + seg, willShow: (view, first) => first ? widen() : null });
hkMantelShell.attach(viewHost);    // the shell merges the view host's parts, again on every view
await viewHost.start();
```

It draws **every** page of the dashboard, not only Home. The server serves `home.html` for
`/<dashboard>/<view>`, where the dashboard name contains a hyphen as HA requires, so `/api/…`,
`/hk/…` and `/web/…` never match. `/<x>/home` is still served as before.

Narrowing the hub subscription now works per page. After a page is first drawn, its reads are
recorded and the subscription narrows to everything read on the pages seen so far, so a cached
page stays correct. A page not seen yet widens the subscription back to the whole house before it
is drawn. `?narrow=0` still turns narrowing off.

`web/shim/cards-bridge.js` is gone. Its pieces moved:

- `createCardElement`, the grid stand-in and the conditional stand-in (with `holds`) are now the
  view host's;
- `setCardHost` is now the adapter's `bridge`;
- the `hui-card` stand-in (`mantel-card`) and the `Document.prototype.createElement` patch that
  served it are no longer needed: no code makes `hui-card` without Lovelace (below).

In `mantel-shell.js`, `setPage(view, config)` was replaced by `attach(viewHost)`.
`host.onSnapshot` stays as a hook (`window.__mantelOnSnapshot`) for the smoke and
`tools/headless/home_numbers.py`.

## How containers make children, with and without Lovelace

`hkCards.createCard(config, client)` in `hk-base.js` is the one way a container card makes a child
card. Two contract additions make it work:

- The host shell gained one kind, `card`: the host's own wrapper around a dashboard card. HA's
  shell names it `hui-card`; the contract default and Mantel name none.
- `hkCards.cardWrapper()` returns that name, or `null`.

What `createCard` does:

- **With Lovelace** (`cardWrapper()` names `hui-card`), it makes the wrapper **exactly as the
  containers did**: `createElement('hui-card')`, `hkHostClient.bridge(el, client)`,
  `preview = false`, `config`, `load()`. Lovelace's lazy loading, error card and `ll-rebuild`
  handling are unchanged.
- **Without Lovelace**, it calls `hkViewHost.createCardElement(config, client)`, the same factory
  the view host uses for a view's cards. If there is no view host either (a bare page), an HK card
  is made by its tag (`hkCards.create`), and anything else becomes a short note.

The callers:

- `hk-row.js` `_createCard` and `hk-cameras.js` (the mosaic's live tile and the live card's
  picture) call `hkCards.createCard`. The order of the calls is the same as before.
- `hk-chip.js` (the scenes row) keeps its exact old code path in HA, with the element name taken
  from `cardWrapper()`. Without Lovelace, it builds the card again for each new plan and swaps it
  in, as Lovelace's wrapper rebuilds on a new config.
- `hk-base.js` `place()` asks `hkShell.is(parent, 'card')` instead of comparing the element name
  to `hui-card`. In HA this is the same test.

## Behaviour in the HA build: unchanged, and how that is pinned

- The view host is published (`frontend/shell/hk-view-host.js`) but **not loaded** in HA:
  `__init__.py`'s bootstrap list is unchanged. Lovelace still draws HK dashboards; P2.6 will load
  the view host in a panel. Pinned by `tests/test_ha_build.py::test_view_host_is_published_but_not_loaded_in_ha`.
- Containers in HA still make `hui-card` in the same order. `test_childcard.js` records every
  property set and call on the wrapper and checks the sequence `hass, preview, config, load` for
  `createCard`, for `hk-row`'s `_createCard`, and for the live camera card's picture (same
  `picture-entity` config). Existing suites still pass unchanged: `test_mosaic` ("exactly one
  hui-card child"), `test_striplife`, `test_camera_live`, `test_doorbell`, `test_chipkinds`,
  `test_editor`. They patch `document.createElement('hui-card')`, and that is still what runs.
- The only HA-side change is one new tag in the HA shell, `card: 'hui-card'`, which is read at call
  time. `place()` gives the same answer (`hkShell.is` is a lowercase name compare).
- `tests/test_shell_boundary.py` now also fails if any shared file calls
  `createElement('hui-card')`, or if the view host names any `hui-*`/`ha-*` element.

## Tests

- **New `test_viewhost.js`** (51 assertions, with its own small DOM that runs connected and
  disconnected callbacks). It covers:
  - the factory: a custom card with setConfig before the client; placeholders for unknown types,
    errors and missing types; grid columns, the gap variable and the title; stacks; the
    conditional (hidden, shown and fed, `card-visibility-changed`); every condition kind; a card
    defined late (upgraded, configured, given the newest client);
  - the host: the first view, Lovelace's order, `narrow`/`index`, the shell told before attach,
    `shellParts`;
  - client updates (the view on screen only; a cached view catches up);
  - routing: `hkShell.navigate`, back, a hash, an unknown view, relative and index paths, the
    fallback and sections views, a view that throws, leaving to another dashboard, the newest
    `show` winning, `willShow` awaited, `navigate`, `stop`, the helpers, no `hui-*`/`ha-*`
    element made, a container required.
- **New `test_childcard.js`** (13 assertions): `hkCards.createCard` with Lovelace (pinned above);
  without it (delegates to the view host, no `hui-card`, also through `hk-row`); with neither (an
  HK card by its tag, a note).
- **Mantel tests:**
  - `test_current_assets.py`: every `/<dashboard>/<view>` serves the page, the view host is
    served at `/hk/shell/`, and non-dashboard paths return 404;
  - `test_home_support.py`: the conditional conditions are now read from the view host;
  - `test_shell_boundary.py`: two new pins;
  - `test_ha_build.py`: one new pin.
- **Browser smoke** (`tools/headless/client_smoke.py`), using fictional data, blocked writes and no
  HA connection; a fictional scene was added so the scenes row draws. It checks:
  - the generated dashboard has `home`, `lights`, `playmusic` and `music-browse`;
  - Home is drawn by the view host (`hk-grid-view` in `#app`, `hkShell.view()` is it, the config
    is the view host's);
  - Lovelace's grid is drawn as `hk-view-grid`;
  - the scenes row's child is `hk-view-grid` → `hk-grid-card`, made by `hkCards.createCard`, and
    no `hui-card` exists on the page;
  - every card is drawn or hidden, with 0 placeholders, and fed the client;
  - `hkShell.navigate('/dashboard-proof/lights')` swaps to Lights in the same slot: Home is
    detached and cached, the sky element is the same one, `tags.view` is right, and Lights' cards
    are drawn and follow a state change;
  - `history.back()` returns the cached Home element, caught up with the client;
  - a hash is not a page change;
  - **0 frames sent** while moving between views, and no `[hk-view-host]` console errors;
  - `/dashboard-proof/lights` opened directly is drawn first;
  - with narrowing on, Lights narrows, then Home widens and narrows to both pages' reads (scene and
    light present);
  - 0 browser exceptions and 0 external requests.

## Validation

| Check | Result |
|---|---|
| Frontend suites | **122** suites green (120 + `test_viewhost` + `test_childcard`) |
| HA Python | 665 passed, 1 skipped |
| Mantel tests | **168** passed (164 + 4) |
| Browser smoke | passed, with the new `view_host` line |

## Left for later

- **Not drawn by HK:**
  - the grid card's `square` option (HK's own grids say `square: false`);
  - a view's `badges`;
  - per-card `visibility:`;
  - Lovelace's edit mode and the `lovelace` object on views (nothing in HK's views reads it).
- **Built-in cards inside `hkCards.create`.** `hkCards.create` (nested cards: the media control,
  detail panels) still names `hui-<type>-card` for a built-in type. It is only used with `custom:`
  types today. On a host without Lovelace it should use the view host's factory; this is a small
  follow-up.
- **Camera tile CSS.** `hk-cameras.js` has three CSS rules that name `.live>hui-card` (style rules,
  not lookups); each now has a twin naming `.live>hk-picture-entity` for hosts without Lovelace
  (below). In HA nothing changes: the twins match nothing there.
- **HK's own picture-entity (2026-10-18).** Without Lovelace, HK's camera cards (`hk-camera-live-card`
  on the Cameras page, the camera strip's live tile) got a placeholder for every tile: they make
  Lovelace's `picture-entity` through `hkCards.createCard`. The view host now has `picture-entity`
  as a BUILT_IN, drawn by `hk-picture-entity` (in `hk-view-host.js`, so HA's Lovelace never loads
  it; HK's own HA panel does). It covers what HK's cards use: `entity` / `camera_image`,
  `camera_view` auto (the still from `entity_picture`, refreshed every 10 s while on screen and the
  page visible, two `<img>` swapped hard so a refresh never blinks, `_hk` counter and the tile's
  size at up to 2x in the URL) or live (a muted inline `<video>` in its shadow root, where
  `hk-cameras.js` finds and releases it, fed by WebRTC through the client: `get_client_config`
  and `candidate` as reads, the `offer` as a read subscription, `getCandidatesUpfront` honoured;
  the still stays under the video and keeps refreshing until it has a picture; errors retry 5 s to
  2 min, 6 tries, a refusal never), `aspect_ratio` (HA's forms: `16x9`, `16:9`, `1.78`, `56%`; none:
  the picture's own shape, 16:9 until known), `fit_mode`, `tap_action` (more-info through
  `hkShell.moreInfo`, navigate, none), `show_name` / `show_state` (a one-line footer unless false).
  `theme` is not applied. HA's HLS fallback is not offered: a camera without WebRTC stays on its
  refreshed still. Tests: `tests/test_pictureentity.js`; the offline smoke draws a Cameras page
  (`tools/headless/client_smoke.py`).
- **Leaving the dashboard.** In Mantel, a menu link to another dashboard or an HA page reloads the
  page at that address. Another dashboard draws; an HA page such as `/config` returns 404.
- **Mantel only.** `hkShell.panel().lovelace` is undefined, so `hk-detail`'s "generated here" check
  is false in Mantel, as before this slice.
- **Not edited here, to avoid conflicts with the parallel slices:** `docs/phase2/ROADMAP.md`'s P2.3
  row and `docs/PLAN.md` are left for the orchestrator.

## Exact continuation point

P2.3 is complete on its branch: the view host exists, Mantel draws every page with it, and
containers make children through `hkCards.createCard`. The HA build is unchanged. Next steps:

1. Merge after P2.2/P2.4. If P2.2 changed `hk-row.js`, `hk-chip.js` or `hk-cameras.js`, keep their
   `hkCards.createCard` calls.
2. Re-run the four validations and the smoke.
3. P2.5 (sheets and dialogs) can build on the view host's placeholder and fallback.
4. P2.6: an HA `panel_custom` that loads `hk-host-shell.js`, the adapters, the cards and
   `shell/hk-view-host.js`, and calls `hkViewHost.create({container, config: await
   hkStrategy.generate(...), client})`, with an HA shell implementation whose `tags.card` is null
   inside the panel.
5. Optional follow-up: route `hkCards.create`'s built-in types through the view host's factory.
