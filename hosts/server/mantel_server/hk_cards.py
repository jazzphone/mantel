"""GET /api/hk-cards: which of HK's card files a Mantel page loads at the start, and which wait to be used.

ONLY THE CARDS A SCREEN USES (2026-10-29, Phase 5). Every page loaded all 24 files in web/hk/cards (about 3 MB of
JavaScript) before its first card drew, whatever the screen showed. Now:

  * ``core``: loaded at the start, as before (web/shim/early-cards.js preloads them, web/home.js imports them).
    These are the files other code reaches for by their globals or makes elements of without waiting for them:
    the base and the detail sheets, the layout and the Home Grid catalog the strategy reads, the tiles and chips
    almost every page has, the pop-ups, the room status, the row the chips make, the alarm keypad and the
    thermostat the sheets make, the person's sheet. And any file this module does not name (a new one is loaded
    at the start until someone decides otherwise).
  * ``lazy``: {file: [the custom elements it defines]}. None is loaded at the start. web/hk/modules/hk-loader.js
    (``hkNeed``) imports a file the first time one of its elements is asked for: the view host and the nested-card
    helpers wait for a card with ``customElements.whenDefined``, which it watches; a sheet whose panel lives in one
    of these files, the screensaver's energy slide and the menu's weather ask for it by name.

HK Frontend is unchanged: it registers every card file as a Lovelace resource (resources.py), because people use
HK's cards on dashboards of their own, and nothing there arms ``hkNeed``.

The tags are read from the files themselves (the same ``register('hk-...'`` / ``customElements.define('hk-...'``
calls every card file makes), kept per file until it changes, so a card added to a lazy file needs nothing here.
A lazy file in which none is found is loaded at the start instead.
"""
from __future__ import annotations

import re
from pathlib import Path

LAZY = frozenset({
    "hk-calendar.js", "hk-cameras.js", "hk-energy.js", "hk-grid-cards.js", "hk-headers.js", "hk-home.js",
    "hk-library.js", "hk-media.js", "hk-music.js", "hk-stat.js", "hk-timeline-block.js", "hk-timeline.js", "hk-weather.js",
    # the Intercom (Phase 17): its block on a Home Grid page, the sheet `#intercom` opens (hk-loader.js imports the file
    # when that address comes) and a wall tablet that listens (the shim asks). Nothing on any other page.
    "hk-intercom.js",
    # the Pages screen (Phase J): only on its own page, while a screen has it on
    "hk-pages-screen.js",
})
# hk-strategy.js is not a card list entry at all: home.js imports it with the bootstrap modules
NOT_CARDS = frozenset({"hk-strategy.js"})
DEFINES = re.compile(r"""(?:customElements\.define|\bregister|\bwireEditor|\bdef|\bvariant)\(\s*['"](hk-[a-z0-9-]+)['"]""")

_seen: dict[str, tuple[int, int, tuple[str, ...]]] = {}


def tags_of(path: Path) -> tuple[str, ...]:
    """The custom elements a card file defines (kept until the file changes)."""
    st = path.stat()
    hit = _seen.get(str(path))
    if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        return hit[2]
    tags = tuple(sorted(set(DEFINES.findall(path.read_text(encoding="utf-8", errors="replace")))))
    _seen[str(path)] = (st.st_mtime_ns, st.st_size, tags)
    return tags


def card_list(folder: Path, resolve=None) -> dict:
    """{"core": [file, ...], "lazy": {file: [tag, ...]}} for the card files in `folder`. `resolve(rel)` gives the
    file /hk/<rel> is answered with (server.hk_path: a developer's files folder first); the folder's own otherwise."""
    names = sorted(p.name for p in folder.glob("*.js") if p.name not in NOT_CARDS) if folder.is_dir() else []
    core, lazy = [], {}
    for name in names:
        if name in LAZY:
            path = (resolve("cards/" + name) if resolve else None) or folder / name
            tags = tags_of(path)
            if tags:
                lazy[name] = list(tags)
                continue
        core.append(name)
    return {"core": core, "lazy": lazy}
