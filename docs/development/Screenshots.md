# Screenshots

The screenshots in `docs/images/` are generated, not taken by hand. `tools/headless/gallery.py` makes all of them
from an invented house, so no real home, person or picture ever appears in the docs.

## What it does

1. Builds a made-up house in code: floors, rooms, lights, climate, sensors, locks, cameras, a music library and
   people, all with invented names.
2. Starts a **real Mantel Server** in-process on `127.0.0.1`, with a temporary data folder, a stand-in for Home
   Assistant's reads, and HK's own landscape pictures standing in for camera stills. No Home Assistant is involved.
3. Opens each page in an isolated headless Chrome (`tools/headless/cdp.py`), signed in as a fictional Owner where
   the page needs it. The browser may only reach Mantel's own address.
4. Waits for the page to settle, takes a screenshot, and writes it to `docs/images/<name>.webp`.

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

The gallery uses a fixed DevTools port (9381), so don't run it alongside a headless check.

## Add a shot

1. Add an entry to `SHOTS` in `tools/headless/gallery.py`:

   ```python
   "lights-phone": (f"/{SCREEN}/lights", PHONE, True, None),
   ```

   The tuple is: the page's path, the viewport (`DESKTOP`, `TABLET`, `PHONE`, or a `(width, height)` pair),
   whether to sign in, and an optional JavaScript snippet to run before the shot (for example to open a sheet).
   The path must be one of Mantel's own pages: a screen (`/dashboard-home/…`), `/settings…` or `/login`.
2. If the page needs something the invented house doesn't have, add it to `HOUSE` (entity id, room, state and
   attributes); a new room goes in `ROOMS`. Keep every name invented.
3. Make the shot and look at it:

   ```bash
   .venv/bin/python tools/headless/gallery.py --only lights-phone
   ```

4. Commit the new `.webp` with the code change, and reference it from the docs with a relative link.

`tests/test_gallery.py` checks that every shot is one of Mantel's own pages, that the house's entities belong to
its rooms, and that every shot in `SHOTS` has an image in `docs/images/`.

## Fonts

HK is designed around Apple's SF Pro, but SF Pro and SF Symbols are licensed by Apple and **never ship** with
Mantel or appear in the repository ([Rules](Rules.md)). Each home supplies its own copy. So the screenshots use
the browser's fallback font, unless the machine making them has SF Pro installed locally, in which case Chrome
uses it. Expect the type in the published shots to look slightly different from a home that has added its fonts.
