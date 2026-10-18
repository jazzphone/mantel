# Development

How HK Frontend is put together, how to run its tests, and how to add to it.
For using it, start with [Install](Install.md).

## Mantel development source

Development source now lives in Mantel: the existing frontend in `web/hk/`, shared
client/card code in `web/client/` and `web/cards/`, and this HA adapter in
`hosts/ha/custom_components/hk_frontend/`. The running integration is an installed copy.
`tools/build_ha.py` in Mantel composes a new staging directory in the public layout
below; run the suites against that output. It never deploys or publishes. Backend
feature extraction and the remaining frontend migration are incremental.

## Repository layout

```
custom_components/hk_frontend/     the integration HACS installs
├─ __init__.py          serves frontend/ at /hk/, registers the bootstrap modules,
│                       the settings feed and hk_frontend.show_popup; sets up
│                       the one entry, which starts the features
├─ config_flow.py       Add integration, Configure, and the entry's items:
│                       features (Add feature), screens, pop-ups, custom pages,
│                       chips, Music's presets and playlists
├─ settings.py          the dashboard settings: their defaults, checks and feed
├─ settings_api.py      the HK Settings page's writes, checked as Configure checks them
├─ panel.py             the HK Settings page: registration and its read commands
├─ accessories.py       per-accessory settings (name, room, icon, where it shows)
├─ kinds.py             which entities each status chip counts (each type's page in Accessories)
├─ hiding.py            Hidden Accessories: where each accessory is hidden, and Also Count As
├─ files.py             your files folder, served under /hk/ ahead of the bundle
├─ resources.py         adds the card files as Lovelace resources (storage mode)
├─ setup_check.py       Setup Check, and the Repairs issues
├─ themes.py            adds the HK Kiosk themes to the frontend's, and again after a reload
├─ thirdparty.py        whether optional third-party cards, WallPanel or Kiosk Mode are ready (Weather uses native radar)
├─ art.py               album artwork fetched and served by Home Assistant
├─ talk.py, talk_live.py  hold-to-talk on a camera sheet
├─ switch.py, entity.py the Seasonal decorations switch
├─ rename.py            follows entity renames into the settings
├─ diagnostics.py, const.py, manifest.json, services.yaml
├─ alarm_control_panel.py, camera.py, sensor.py
│                       the features' entity platforms (the running features add to them)
├─ features/            the optional features, one package each; __init__.py
│  │                    starts and follows them (Feature, async_sync, async_fold)
│  └─ music/  live_tv/  clean_areas/  alarm_pin/  energy/  notifications/
├─ frontend/            everything reachable over HTTP, at /hk/
│  ├─ cards/            the Lovelace cards, one family per file; hk-strategy.js
│  │                    is the generated dashboard and the room page
│  ├─ modules/          page modules: settings, header, kiosk, sky, idle, screensaver, menu, glass…
│  ├─ panels/           the HK Settings page (hk-settings.js, -model, -kit, -features)
│  ├─ iconset/          hk-icons.js, the hk: iconset loader (the glyphs are the user's)
│  ├─ fonts/            sf-pro.css (the font is the user's)
│  ├─ sky/              the live sky's textures and decoration art
│  ├─ css/              hk-responsive.css
│  └─ pages/            skylab.html (Sky Lab) and skyprobe.html, the sky's tools (Tools.md)
├─ helpers/             quick_timers.yaml, an optional package
├─ theme/               hk_kiosk_theme.yaml (HK Kiosk, HK Kiosk Camera; loaded by themes.py)
├─ translations/        en.json
└─ brand/               the integration's icon
tests/                  run (JavaScript suites) and py/run (Python)
tools/                  sky/, sf_symbols/, font/, gen_theme.py, merge_translations.py, publish/
docs/                   these pages, one file per Wiki page, and _Sidebar.md
```

Only `frontend/` and the user’s files folder are served over HTTP. Everything
else (Python, tests, tools, the theme) is unreachable from a browser by where it
lives, not by a rule.

## How the frontend loads

1. **Bootstrap modules.** `__init__.py` registers these with
   `add_extra_js_url`, so they load before any card renders, in this order:
   `hk-settings.js` (the settings every page reads at first paint),
   `hk-icons.js` (the `hk:` iconset, which must exist before the first icon
   draws), `tesla-viewport.js`, `hk-tap.js`, `hk-header.js`, `hk-loader.js`
   and `cards/hk-strategy.js` (Home Assistant waits only 5 s for a custom
   dashboard strategy, so it is defined before any dashboard asks; it is a
   resource too, and one URL is one module). Changing this list needs a Home
   Assistant restart; editing one of the files does not.
2. **Lovelace resources.** Every file in `frontend/cards/`, plus
   `fonts/sf-pro.css` and `css/hk-responsive.css`. `resources.py` adds the
   missing ones once Home Assistant has started, in storage mode only; it never
   edits or removes an entry. A new card family file is registered at the next
   start. The files load in parallel: `hk-base.js` publishes `window.hkCards`
   and fires `hk-cards-ready`, and every other card file waits for that event
   (never a poll: timers barely run in a hidden tab, which is where a wall
   tablet spends its time).
3. **The loader.** `hk-loader.js` imports the page modules, first
   `hk-kiosk` (Home Assistant Header & Sidebar, so a kiosk screen shows
   them as briefly as possible), then those with nothing to do before first
   paint: `hk-stats`, `hk-charts`, `hk-sky`, `hk-idle`, `hk-skyshot`
   (the picture of the sky Pre-rendered blurs), `hk-glass`, `hk-frosttint`,
   `hk-timers`, `hk-saver` (the photo screensaver), `hk-saver-panel` (the
   Speakers / Volume / Browse panel the screensaver and the Now Playing bar
   share), `hk-campost`, `hk-menu`, `hk-tabbar` and `hk-notify`
   (Notifications’ banners). Adding
   one to its list is live on the next page load. Each module sets its
   `window.hk…` global and fires `hk-module-ready`, which redraws the cards
   waiting for it.

The HK Settings page is a custom panel at `/hk-settings`
(`frontend/panels/hk-settings.js`), registered by `panel.py`.

**`/hk/` is served with `Cache-Control: no-cache`.** Every request revalidates
(an unchanged file costs a 304), so an edited file reaches a screen on its next
load with no version numbers to bump. Home Assistant’s `/local/` caches for 31
days, which is why HK Frontend serves its own files. The user’s files folder
is answered first at the same URLs, so a file can move between it and the
bundle without any page noticing.

**Settings reach the screens live.** `hk-settings.js` subscribes to
`hk_frontend/settings/subscribe` and paints from a cached copy until the
answer arrives. A card or module never names a house’s entity: anything it
needs is a setting (a default in `settings.py`, a field on the HK Settings
page, and the same default in `hk-settings.js`).

In the browser console, `hkReload()` re-imports the loader’s modules without a
page reload (only `hk-stats` and `hk-charts` replace themselves; the rest need
a reload).

## Running the tests

### JavaScript suites

```sh
tests/run            # every suite
tests/run popup      # only the suites whose name contains "popup"
```

They run in JavaScriptCore, which ships with **macOS** (`jsc`, no Node
needed), against the files in `frontend/` with a small DOM stand-in
(`tests/dom.js`). The script works from the repository or from inside the
component. `HK_FILES=/config/hk_local tests/run` also checks a home’s own
glyph file; without it, the suites use `tests/fixtures/`.

`tests/test_editors.js` walks every registered card and holds it to the
picker and editor rules below.

### Python tests

```sh
tests/py/run                 # everything
tests/py/run -k music        # pytest arguments pass through
```

The first run builds a virtual environment at `~/.venvs/hk-ha-test` with
`pytest-homeassistant-custom-component`, so the integration is tested inside
Home Assistant’s own test harness. Each feature has its own
`test_feature_*.py` files.

## Tools

The pages, address flags, console helpers, test runners and scripts — Sky Lab,
the sky probe, `?skylab`, `hkSkyAt()`, the sky-art converters, the glyph and
font builders and `publish.py` — each with what it’s for and how to run it,
are on their own page: [Tools](Tools.md).

## The documentation

`docs/` holds one Markdown file per page of the
[GitHub Wiki](https://github.com/jazzphone/hk-frontend/wiki), named as the
page is (`Live-TV.md` is the page *Live TV*), plus `_Sidebar.md` and
`_Footer.md`. Pages link to each other as files (`[Music](Music.md#actions)`),
so the same links work when browsing `docs/` in the repository.

`publish.py --wiki DIR` turns them into the Wiki: each page loses its first
heading (the Wiki shows the page name), `Page.md` links become `Page`, images
point at `docs/images` on `main`, and links out of `docs/` point at the
repository. The Wiki is scanned for private data like everything else, and
nothing is written if a page fails. It changes on every release, never between
them, so the Wiki always describes the latest release.

## Design values

Every design value lives once, by name, in `hkCards.T` in
`frontend/cards/hk-base.js`: the text and surface colors, the glass and its
shadows, the overlays, the font. The keys are the `--hk-*` names without the
prefix, and the values are the dark ones HK Frontend's own screens use
(`LIGHT` holds a light page's). A card writes one with `v(name)`:

```js
var v = window.hkCards.v;
v('ink-2')   // 'var(--hk-ink-2,rgba(255,255,255,0.68))'
```

so a theme, a look or a light page can replace it, and everywhere else gets
the table's value. A name the table doesn't have throws.

Beside the table, each family has a small named scale on `window.hkCards`:

| Scale | What it holds |
|---|---|
| `SP` | Spacing for page cards and the cards in sheets. |
| `TILE` | The pill: 196 × 70, 10 apart, favorites 76, its padding, circle and lines. `TILE.css` is its width as CSS, which follows `--hk-pill` (170 in the iPad band). |
| `CHIP` | The status chip's height, 43. |
| `CARD` | A page card's padding. |
| `BP` | Breakpoints: screens (phone 640 and up) and card widths for container queries. |
| `EASE`, `DUR` | Four motion curves and six durations. |
| `BLUR` | Three backdrop blurs: light, medium and heavy. |
| `R` | Corners: the plate's 23.5, inner, small, sheets, and `R.capsule(height)`. |
| `OVER` | The three overlay surfaces. |
| `TYPE` | Type roles: size, weight and tracking. |

A plate (its corner, the look's material, edge and shadow) is one call:
`hkCards.plate('tile')`, `'card'` or `'panel'`. A file that builds its CSS
before `hk-base.js` is ready (`hk-row.js`, and modules such as `hk-header.js`,
`hk-notify.js` and `hk-charts.js`) can't read the table: it writes the
literal, and the tests hold it to the table's value.

A new value gets a name in `T` (and in `LIGHT` if a light page should
change it), never a literal in a card. The pill's numbers were measured off
the Home app; they are not for tidying.

**The guards.** Each family has a suite that fails on a value off its
scale. An exception is named in the suite, with why.

| Suite | Holds |
|---|---|
| `test_textscale`, `test_surfaces` | Text to the three inks; every other white to the six surfaces. |
| `test_overlays`, `test_blur`, `test_motion` | Dark washes to `OVER`, blurs to `BLUR`, curves to `EASE`. |
| `test_breakpoints` | Every media or container query width to `BP`. |
| `test_radii`, `test_type` | Corners to `R`, font sizes to `TYPE`. Ratchets: the older values off the scale are recorded by file (`tests/fixtures/radii_allow.json`, `type_allow.json`), and a file may lose one, never gain one. |
| `test_pillgeom`, `test_pillsize` | No pill number outside `TILE` and `--hk-pill`; `hk-responsive.css` and `TILE` agree. |
| `test_csssnapshot` | Every CSS string the cards and modules hand the page, against `tests/fixtures/css_snapshot.json`. |
| `tests/py/test_theme_values.py` | The HK Kiosk theme's glass keys equal `T`. |

For a change you mean, `HK_UPDATE_SNAPSHOT=1 tests/run csssnapshot` rewrites
the snapshot (and `HK_UPDATE_SNAPSHOT=1 tests/run radii` or `type` tightens a
ratchet's list); the fixture's diff is the change to review. After changing
a glass value in `T`, `python3 tools/gen_theme.py` rewrites the theme's
`hk-*` keys from the table, and `python3 tools/gen_theme.py --check` only
compares them. The theme reaches the screens after Home Assistant restarts.

## Adding a card

1. **Pick its family file** in `frontend/cards/`, by what the card looks like
   and measures (a tile, a chip, a layout piece), not by what it does. A new
   family file is fine; it is registered as a resource at the next start.
2. **Extend `HkBase`** (from `window.hkCards`) inside the file’s
   `hk-cards-ready` handler. Gating, the tap rules and actions come with it.
   Implement `_render()`, build the markup once (`this._built`) and update it
   in place after that.
3. **Redraw when the inputs change, and only then.** `_sigOf()` must cover
   every entity `_render()` reads (the default covers `entity`, `entities` and
   `group`). A card that reads no entity returns `'static'`; the default
   `null` means “always render,” on every state change in the house.
4. **Glass.** Write a plate with `hkCards.plate()` and any other glass
   surface with `M.glass` (never a background of your own), and every color
   with `v()` ([Design values](#design-values)). Never put
   `backdrop-filter` on a card: Blur’s Shared Layer and Pre-rendered modes
   are one shared layer (`hk-glass.js`), and a blur per card is what slows a
   tablet down. `glass: false` in a card’s config keeps it out of the shared layer.
5. **Register it**:

   ```js
   C.register('hk-example-card', HkExampleCard, 'HK Example',
     'One plain sentence saying what it is for.',
     [ { name: 'entity', required: true, selector: { entity: {} } },
       C.section('Appearance', [ { name: 'icon', selector: { icon: {} } } ]) ],
     function (hass) { return { entity: C.firstOf(hass, 'light') }; });
   ```

   The arguments are the tag, the class, the card picker’s name (starting
   “HK ”), its description, the editor’s `ha-form` schema, and a starting
   config that names an entity the house has. Labels and help text come from
   `HK_LABELS`, `HK_HELPERS` and `HK_OPTION_LABELS` in `hk-base.js` (or a
   `label` / `helper` on the field); dropdowns use `C.selOptions(...)`, and
   `C.section(title, fields)` groups fields without changing the YAML’s
   shape.
6. **Test it.** `tests/run editors` checks the picker entry, the starting
   config and the editor; add the card’s behavior to a suite
   (`tests/card_harness.js` builds a card against a fake `hass`).

## A feature package

Each optional feature is a package under `features/` with the same shape (the
full contract is the docstring of `features/__init__.py`):

| Part | What it is |
|---|---|
| `PLATFORMS` | The entity platforms it adds to. Every one must be in `features.PLATFORMS`, which the entry forwards; each has a module at the component’s top level (`camera.py`, `sensor.py`…) that hands the platform to the running features. |
| `RELOAD` | `True`: a change to its settings restarts it (its entities are rebuilt, with the same ids). `False`: `async_changed(hass, feature)` is called instead. |
| `ITEM_TYPES` | The entry’s item types it owns (Music: presets and playlists); a change to one calls `async_changed`. |
| `async_setup(hass)` | Called once at start, whether or not the feature is added: registers its actions and websocket commands, so a call made before it is added gets a clear error, and HK Settings can ask what it has. |
| `async_setup_entry`, `async_unload_entry` | Its start and stop. They get a `Feature`: an entry-like view of its item (`entry_id`, `title`, `data`, `options`, `runtime_data`, `async_on_unload`). |
| `AddSteps`, `ReconfigureSteps` | Its steps in the Add feature flow (`config_flow.FeatureFlow`) and in its gear (`<kind>_options`, saved with `async_save_feature`). Every step id starts with the feature’s kind (`alarm_pin_…`). |
| `settings_ws.py` | The commands its HK Settings page reads and saves through (`features.async_update`), checked the same way as its gear. |
| `translations.en.json` | Its strings, as a fragment of `translations/en.json`, under `config_subentries.feature`. |

A feature is an item (subentry) of the one HK Frontend entry, of type
`feature`, holding `{kind, data, options}`. Its id is also what its entities’
unique ids and its device are built from, and its entities belong to that
item. Music, Live TV and Clean Areas allow one per house; Alarm PIN one per
protected alarm.

To add a feature: add its kind to `KINDS` and `TITLES` in
`features/__init__.py`, mix its `AddSteps` and `ReconfigureSteps` into
`FeatureFlow` in `config_flow.py`, add its menu option under
`config_subentries.feature.step.user` in `translations/en.json`, add it to `COMPANIONS` in `setup_check.py` (Setup Check and the
HK Settings Features list read it), and give it a page in
`frontend/panels/hk-settings-features.js`.

**Translations.** Home Assistant reads only `translations/en.json`. After
changing a feature’s `translations.en.json`, run:

```sh
python3 tools/merge_translations.py
```

It deep-merges every feature’s fragment into `translations/en.json` and
reports any key two fragments both set. Strings people read use US spelling
and typographic apostrophes (’); never put a `<` in one.
