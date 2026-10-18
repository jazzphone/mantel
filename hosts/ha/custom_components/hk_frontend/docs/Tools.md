# Tools

Everything HK Frontend has for trying things out, finding out what a screen is
doing, and building its art and its releases: pages to open in a browser,
flags to put on a dashboard’s address, helpers to type into the browser’s
console, the test runners, and the scripts under `tools/`. None of it is
needed to use HK Frontend. For how the code is put together, see
[Development](Development.md).

## Pages in the browser

These are served by HK Frontend under `/hk/pages/`, like the rest of its files.
Like `/local/`, `/hk/` needs no sign-in, so these pages hold no data of yours
and read none: anything that shows your home happens on a dashboard, which
does need one.

### Sky Lab

**`/hk/pages/skylab.html`** — drive the [live sky](Live-Sky.md) by hand and
watch it change.

| Control | What it sets |
|---|---|
| **Show** | **Sky only** (this page) or **Dashboard** (below). |
| **Clouds** | Realistic, Blend (a classic veil under the realistic clouds, to try) or Classic. |
| **Time of day** | The sun’s place through a day: up at 7 AM, highest at 1 PM, down at 7 PM. |
| **Daytime brightness** | 0 to 100% — the [Daytime Sky](Live-Sky.md#choose-its-look) setting as a slider: Deep is 0%, Balanced 50%, Natural 100%. Marked “(dashboards)” at 100%. |
| **Cloud cover**, **Condition** | How cloudy, and the weather. **From cloud cover** picks sunny, partly cloudy or cloudy from the cover. |
| **Rain / snow intensity**, **Wind**, **Moon phase** | The rest of the weather. |
| **Scene** | Plain sky, the New Decorations woodland of each season, or a holiday or occasion. **Decorations** chooses New or Old. |
| **Animations**, **Fog** | As the Sky / Background switches. |
| **Cards** | Sample glass cards over the sky, to judge how readable they are. |

The box at the bottom says what the sky drew: the condition, the clouds it
chose, and its brightness before and after the shade behind the cards.

**Show → Dashboard** opens one of your own dashboards with the same panel over
it — or put **`?skylab`** on any dashboard’s address, for example
`/dashboard-home?skylab`. Its cards, header and tab bar are the real ones,
with your home’s states, signed in as that browser already is. **It is
preview only:** before the page can be
touched, everything it would change in your home is held back — actions,
scripts, events and saved settings — and a note at the bottom says what was
not sent. Taps still open pop-ups and move between pages. The **Dashboard**
menu switches between your dashboards; **Exit** reloads the page without
`?skylab`, which is the only way the preview ends. The panel remembers its
settings in that browser tab, so Sky only and Dashboard show the same sky.

### Sky probe

**`/hk/pages/skyprobe.html`** — what a device can and can’t do for the live
sky, for when a tablet’s sky misbehaves.

- **Device diagnostics** lists what the browser reports: reduced motion,
  whether the page is hidden, pixel ratio, screen size, memory and cores,
  Chrome / WebView and Android versions, whether masks are supported, whether
  an animation actually moves, and whether the reduced-motion guard fires.
- **Animations**, **Weather**, **Decorations** and **Fixed backdrop** turn the
  sky’s layers on and off on this page.
- **Measure all combinations** runs all 16 on/off combinations for 4 seconds
  each and measures the frame rate of each. `?auto` on the address starts it
  when the page opens.
- The results are also written into the page’s address (`?moved=`, `?guard=`,
  `?rm=`… and `?skyresults=` after a measurement), so a kiosk browser that
  reports its current page to Home Assistant reports them too.

## Flags on a dashboard’s address

Add these to a dashboard’s address, after `?` (and `&` between two). They last
as long as the page does; a plain reload without them goes back to normal.

| Flag | What it does | More |
|---|---|---|
| `?skylab` | The Sky Lab panel over this dashboard, preview only. | [Sky Lab](#sky-lab) |
| `?hk_kiosk=on` · `?hk_kiosk=off` | Hides, or shows, Home Assistant’s header and sidebar on this page, whatever the screen’s setting. | [Appearance](Appearance.md) |
| `?hk_saver=off` | No screensaver on this page. `?wp_enabled=false` (WallPanel’s own flag) does the same. | [Screensaver & idle](Screensaver-and-Idle.md) |
| `?hk_saver=force` | Lets the screensaver run on this page even for a user it is turned off for (testing). It does not turn the tablet’s screensaver switch on or off. | |
| `?hkglass=clear` · `frosted` · `tinted` · `blur` · `blur_pre` · `blur_each` | Tries a [glass look](Appearance.md) on this page only; your setting is unchanged. | |
| `?vw=1000` · `?vw=off` · `?vw=test` | On a car’s dashboard: the layout width it pins (remembered in that browser), forgetting it, or a badge showing what the browser measures without changing anything. | [Screens](Screens.md) |
| `?hkprobe=name` | Loads a script of your own into the page: `/hk/pages/dev/name.js`, from your [files folder](Your-Files.md) (`pages/dev/name.js` in it). Letters, digits and dashes only; `?hkprobe=1` loads `hk-probe.js`. For finding a problem that only happens in one browser on one device, where pasting into its console is hard. | |

## Helpers in the browser console

Open the browser’s developer tools on a dashboard (on a computer, or a tablet
connected to one) and type these into its console. They change only that
page, and only until it reloads.

| Helper | What it does |
|---|---|
| `hkSkyAt(elevation, {…})` | Paints the sky with the sun at that elevation in degrees: `hkSkyAt(-3)` is dusk. The second argument sets the rest — `cover` (0–1), `cond` (`'sunny'`, `'rainy'`…), `wind`, `moon`, `cloudStyle`, `brightness` (0–1) and so on. Returns the sky’s brightness before and after the shade behind the cards. The next tick (3 s) paints the real sky again. |
| `hkSky._pin({…})` · `hkSky._pin(null)` | Holds the sky on the scene you give — the same keys as above — across every tick until `null`. Sky Lab uses this. |
| `hkSky.preview(id, 'day')` | Shows a decoration whatever the date, as HK Settings’ preview does: `'halloween'`, `'christmas'`, `'birthday'`…, with `'day'`, `'night'` or `'spooky'`. `hkSky.preview(null)` goes back to today’s sky. |
| `hkReload()` | Loads the page modules again without reloading the page (only some of them replace themselves). |
| `hkSaver.stats()` | Why the screensaver will or won’t start: whether it is allowed, the photos, when it would start. |
| `hkSaver.start()` · `hkSaver.stop()` | Shows the screensaver now, or takes it away, without touching the tablet’s screensaver switch. `next()` and `previous()` change the photo. |
| `hkIdle.now()` | Goes back to the home page now, as the idle return would. `hkIdle.set(0)` turns the idle return off for this page, `hkIdle.set(ms)` sets its time, `hkIdle.set(null)` goes back to the setting. `hkIdle.held()` lists what is keeping the page where it is. |
| `hkKiosk.state()` | Whether Home Assistant’s header and sidebar are hidden here, and why. |
| `hkGlass.stats()` · `hkGlass.refresh()` | The blur glass’s state, and one redraw. |
| `hkRepairIcons()` | Redraws `hk:` icons that came up blank. |
| `teslaViewport(px)` · `teslaViewport(null)` | A car dashboard’s layout width, as `?vw=`. |

## Tests

| Command | What it runs |
|---|---|
| `tests/run` · `tests/run popup` | The JavaScript suites, all or those whose name contains a word, in JavaScriptCore (`jsc`, part of macOS; no Node needed). `HK_FILES=/config/hk_local tests/run` also checks your own glyph file. |
| `tests/py/run` · `tests/py/run -k music` | The Python tests inside Home Assistant’s own test harness; arguments go to pytest. The first run builds a virtual environment at `~/.venvs/hk-ha-test`. |

More in [Development → Running the tests](Development.md#running-the-tests).

## Scripts

Run from the repository (or from inside the component). Each script that
writes files has a `--check` that only reads, comparing what is there with
what it would write, so a test or a release can hold the files to their
sources.

### Sky art

The live sky’s art is made once and shipped as WebP in `frontend/sky/`; the
sources are in `tools/sky/src/`. These turn one into the other. All but
`gen_sky.py` need Pillow and numpy (`pip install pillow numpy`).

| Script | What it does |
|---|---|
| `tools/sky/gen_sky.py` | Generates the classic sky’s noise textures — the three cloud decks, stars, rain, snow and grain — in plain Python, into `frontend/sky/`. Run it after changing a texture’s settings, then `cloud_webp.py`. |
| `tools/sky/cloud_webp.py` | Turns those three cloud decks into the WebP the sky loads, their transparency kept exact. |
| `tools/sky/cloud_art.py` | The realistic clouds: shrinks each photographic cloud to the size it is drawn at, softens its edges, writes the smaller, softer copies the far clouds use, and measures each cloud’s size, base and brightness into `frontend/sky/clouds/manifest.json`, which the sky reads. The 236 MB of source cut-outs are not in the repository. `HK_CLOUD_SRC` and `HK_CLOUD_OUT` move its source and output folders. |
| `tools/sky/near_webp.py` | New Decorations’ woodland: converts each scene, and cuts its lights (lanterns, pumpkins, bulbs) and the birthday’s rock and presents into small patches, with their places in `frontend/sky/near/manifest.json`. Its `--check` also holds `hk-sky.js` to that manifest. `HK_NEAR_SRC` and `HK_NEAR_OUT` move its folders. |
| `tools/sky/land_webp.py` | The forecast screensaver’s 12 season landscapes (4 seasons × day, dusk and night): checks each is the size, shape and file it should be, mends stray holes in its trees, and converts it. `HK_LAND_SRC` and `HK_LAND_OUT`. |
| `tools/sky/holiday_webp.py` | The screensaver’s holiday landscapes, their lights and the birthday balloons, built on the season landscapes above, and `holiday.json` with where each light and balloon sits. `HK_HOLIDAY_SRC` moves its source folder. |

### Apple’s font and glyphs

For making your own copy of Apple’s font and symbols — see
[Making your files](Making-Your-Files.md) for the whole walk-through.

| Script | What it does |
|---|---|
| `tools/sf_symbols/build_glyphs.py` | Builds your `hk-glyphs.js` from the SF Symbols app, on a Mac: `--out FILE` writes it, `--check FILE` compares an existing one, `--cache DIR` builds from SVGs already exported (so it can run on any computer), `--tolerance` sets how close a check must be. Needs `svgpathtools`. |
| `tools/sf_symbols/export_all.sh` | Exports every symbol HK Frontend uses as SVG with the SF Symbols app alone, no Python (about 3 minutes, and it can pick up where it stopped). Then run `build_glyphs.py --cache` anywhere. |
| `tools/sf_symbols/names.py` | Rewrites the list of symbols (`symbols.txt`) and the [Glyph names](Glyph-Names.md) page from `manifest.json`, which maps each `hk:` glyph to its symbol. A test fails when either falls behind. |
| `tools/font/make_woff2.py` | Turns Apple’s `SF-Pro.ttf` into a web font about a third of the size, on any computer. Needs `fonttools` and `brotli`. |

### Building and publishing

| Script | What it does |
|---|---|
| `tools/merge_translations.py` | Merges each feature’s `translations.en.json` into `translations/en.json`, and stops if two disagree. |
| `tools/gen_theme.py` | Writes the HK Kiosk theme’s glass keys (`hk-glass-bg`, its shadows, `hk-well-bg`, `hk-warn`, `hk-fail`…) from the design table, `hkCards.T` in `hk-base.js`, leaving every comment and other key as it is. `--check` only compares (a Python test does the same); `--tokens FILE` writes the table as a design-token JSON. Run it after changing a glass value; the theme reaches the screens after Home Assistant restarts. See [Design values](Development.md#design-values). |
| `tools/publish/publish.py REPO` | Builds the public repository from the component into a clone of it: the component, `tests/`, `tools/` and `docs/`, and `tools/publish/root/` (licence, HACS and GitHub files) at the top. It refuses to write anything if a file holds private data — a home network address, a token or a key, or anything matching `HK_PRIVATE` (a pattern of your own names and hosts) — then runs both test suites in what it built. `--scan` only looks; `--wiki DIR` builds the [wiki](Development.md#the-documentation) from `docs/` into a clone of it; `--commit "message"` commits (the wiki too); `--push` pushes the repository (push the wiki’s clone yourself); `--no-tests` skips the suites. |
