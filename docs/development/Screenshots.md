# Screenshots

The screenshots in `docs/images/` are generated, not taken by hand. `tools/headless/gallery.py` makes all of them
from an invented house, so no real home, person or picture ever appears in the docs.

## What it does

1. Builds a made-up house in code: floors, rooms, lights, climate, sensors, locks, cameras, a music library, a
   solar-and-battery home with a car, and people (the Owner is Avery Rivera), all with invented names. It has two
   screens: Home, and Wall Display, which uses the Home Grid layout.
2. Starts a **real Mantel Server** in-process on `127.0.0.1`, with a temporary data folder, a stand-in for Home
   Assistant's reads (a day's history, a forecast, the Energy feature's Power page, Home Assistant and Music
   Assistant shown as connected), and HK's own landscape pictures standing in for camera stills. No Home Assistant
   is involved.
3. Opens each page in an isolated headless Chrome (`tools/headless/cdp.py`), signed in as a fictional Owner where
   the page needs it, as a window in front (so cameras play). The browser may only reach Mantel's own address.
4. Waits for the page to settle, runs the shot's script if it has one (opening a sheet, entering Edit mode, turning
   a card over), sets the text in Arial, and takes a screenshot. The test server's address is written as
   `mantel.local:8080`. The shot goes to `docs/images/<name>.webp`.

## Run it

Set up the virtualenv first ([Building and testing](Building-and-Testing.md)). You also need Chrome or Chromium:
`$CHROME` if set, else Google Chrome at its macOS location, else `google-chrome`, `google-chrome-stable`,
`chromium` or `chromium-browser` on `PATH`. As root, Chrome runs with `--no-sandbox`.

```bash
.venv/bin/python tools/headless/gallery.py                 # every shot, into docs/images/
.venv/bin/python tools/headless/gallery.py --list          # list the shot names and exit
.venv/bin/python tools/headless/gallery.py --only home-desktop music-phone
.venv/bin/python tools/headless/gallery.py --out /tmp/shots   # write somewhere else
```

| Option | Meaning |
|---|---|
| `--list` | print every shot's name, one per line, and exit |
| `--only NAME …` | make only these shots |
| `--out DIR` | where to write the `.webp` files (default `docs/images`) |
| `--system-font` | leave the machine's own font instead of Arial (never for the docs: see Fonts) |

The gallery uses a fixed DevTools port (9381), so don't run it alongside a headless check.

## Add a shot

1. Add an entry to `SHOTS` in `tools/headless/gallery.py`:

   ```python
   "lights-phone": (f"/{SCREEN}/lights", PHONE, True, None),
   ```

   The tuple is: the page's path, the viewport (`DESKTOP`, `TABLET`, `PHONE`, `EDITOR`, `GRID_DESKTOP`, or a
   `(width, height)` pair), whether to sign in, and an optional JavaScript snippet to run before the shot (for
   example to open a sheet). The path must be one of Mantel's own pages: a screen (`/dashboard-home/…`, or
   `/dashboard-wall/…`, the Home Grid screen), `/settings…` or `/login`.

   A snippet that has to wait for the page is written with `script(...)`, which gives it `deep()` (finds an
   element inside shadow roots), `until()` (waits for a condition) and `pause()`. The ones already there open Edit
   mode (`EDIT_MODE`), turn a Home Grid Now Playing block over to Speakers or Browse (`TURN_OVER`), and drive the
   Home Grid editor (`GRID_EDITOR` and its steps).
2. If the page needs something the invented house doesn't have, add it to `HOUSE` (entity id, room, state and
   attributes); a new room goes in `ROOMS`. Keep every name invented.
3. Make the shot and look at it:

   ```bash
   .venv/bin/python tools/headless/gallery.py --only lights-phone
   ```

4. Commit the new `.webp` with the code change, and reference it from the docs with a relative link.

`tests/test_gallery.py` checks that every shot is one of Mantel's own pages, that the Home Grid screen's layout is
valid, that the Power page reads only the invented house, that the house's entities belong to its rooms, and that
every shot in `SHOTS` has an image in `docs/images/`.

The other headless checks build on the same house (`gallery.build`). The extras above (history, forecast, the
Energy feature, the connections) are only on for the gallery (`build(..., showcase=True)`), so those checks keep
the plainer house they were written for.

## Fonts

HK is designed around Apple's SF Pro, but SF Pro and SF Symbols are licensed by Apple and **never ship** with
Mantel or appear in the repository ([Rules](Rules.md)). On a Mac, Chrome would draw the page in the system font,
which is SF. So the gallery sets every page in **Arial** (a style added to every shadow root and frame just before
the shot), as the Home Grid screenshots always were. Expect the type in the published shots to look different from
a home that has added its fonts. `--system-font` skips this, for a look at the page as your machine draws it.
