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
    "hk-library.js", "hk-media.js", "hk-music.js", "hk-people.js", "hk-stat.js", "hk-timeline-block.js", "hk-timeline.js", "hk-weather.js",
    # the Intercom (Phase 17): its block on a Home Grid page, the sheet `#intercom` opens (hk-loader.js imports the file
    # when that address comes) and a wall tablet that listens (the shim asks). Nothing on any other page.
    "hk-intercom.js",
    # House Status (docs/phase11/HOUSE-STATUS.md): its block on a Home Grid page and the sheet the block opens
    "hk-house-status.js",
    # Home (docs/phase27/PLAN.md): its block on a Home Grid page and the Home sheet the block opens
    "hk-home-block.js",
    # the Alert (docs/phase11/ALERT.md): a block's Show When card, drawn only while its rule holds
    "hk-alert.js",
    # Laundry (docs/phase22/LAUNDRY.md): its block on a Home Grid page (its sheet is hk-detail's, hk-sheet-laundry.js)
    "hk-laundry-card.js",
    # TV (docs/phase23/TV.md): its block on a Home Grid page (its sheet is hk-detail's, hk-sheet-tv.js)
    "hk-tv-card.js",
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


# A FILE CUT INTO PARTS (tools/split_js.py): its shell lists them (`var PARTS = [...]`) and fetches them from its folder
# ('/hk/<folder>/' + file) a round trip after the shell itself; the parts of the files loaded at the start are preloaded
# with them (web/shim/early-cards.js), so the first draw does not wait for that round trip (phase 24, B8)
PARTS_LIST = re.compile(r"var PARTS = \[([^\]]*)\]")
PARTS_FOLDER = re.compile(r"'/hk/([\w-]+)/' \+ file")


NO_WAIT = "NOTHING WAITS FOR THESE PARTS"       # (the loader's words in the source; minified, they are gone)
WAITED = re.compile(r"__hkSplitReady\s*=\s*window\.__hkSplitReady")     # (build_static.WAITED: the loader's code)
BUNDLED = "/* hk: the parts of this file are in it (tools/build_static.py bundle) */"     # (build_static.BUNDLED)


def parts_of(path: Path) -> list[str]:
    """A shell's parts as paths under /hk/ (`base/hk-base-design.js`), in their order ([] for a file not cut into parts)."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    listed, folder = PARTS_LIST.search(text), PARTS_FOLDER.search(text)
    if not (listed and folder):
        return []
    # (a shell nothing waits for -- its manifest's "wait": false, hk-detail.js -- is not needed for the first draw: its
    # parts are fetched by its own loader, not preloaded at the start beside the ones the draw needs, 2026-11-11. Known
    # by its loader keeping no window.__hkSplitReady: the shipped files are minified, so its comment is gone. And a
    # shell the build shipped with its parts in it (tools/build_static.py BUNDLED) needs none fetched)
    if not WAITED.search(text) or text.startswith(BUNDLED):
        return []
    return [f"{folder.group(1)}/{name}" for name in re.findall(r"'([^']+\.js)'", listed.group(1))]


def card_list(folder: Path, resolve=None) -> dict:
    """{"core": [file, ...], "lazy": {file: [tag, ...]}, "parts": {file: [path under /hk/, ...]}} for the card files in `folder`.
    `parts` names the parts of each core file cut into parts, and of hk-strategy.js (imported at the start too).
    `resolve(rel)` gives the file /hk/<rel> is answered with (server.hk_path: a developer's files folder first); the
    folder's own otherwise."""
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
    parts = {}
    for name in core + sorted(NOT_CARDS):
        got = parts_of((resolve("cards/" + name) if resolve else None) or folder / name)
        if got:
            parts[name] = got
    return {"core": core, "lazy": lazy, "parts": parts}
