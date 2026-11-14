"""A page keeps a layer of its own at rest on the wall tablets (hk-pageswipe.js `layer`, 2026-11-14): a swipe then draws
nothing again. A layer makes the page the box that anything `position: fixed` inside it is placed in, and the page it
is stacked in -- so a card that puts something fixed INSIDE itself (not on the document's body) must say so, and its
page keeps no layer (`FIXED_INSIDE`, or `hkFixedInside` on the card): the Music page's panels, the Pages screen's ground.

Every file with a fixed rule is named here with where what it fixes lives. A new one fails this test until it is: put
on the body (nothing to do but name it), or declared in hk-pageswipe.js FIXED_INSIDE."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
FIXED = re.compile(r"position:\s*fixed")

BODY = "on the document's body (or the host's root), outside every page"
SHELL = "the page's own shell, outside the pages: the sky, the bars, the Side Pane, the menu, the screensaver"
SAVER = "drawn in the screensaver, never in a page"
EDIT = "Edit mode and the editors: the page swipe retires its stage there, and a page keeps no layer"
TOOL = "a page of its own (Settings, a lab), not a screen's page"
SWIPE = "the page swipe's and the glass's own: placed for a moving page on purpose"
WORDS = "only in a comment, or a string that is no rule of a card's"
INSIDE = "fixed inside its card: declared in hk-pageswipe.js FIXED_INSIDE, its page keeps no layer at rest"

WHERE = {
    "hk/base/hk-base-card-core.js": BODY, "hk/base/hk-base-sheets.js": BODY, "hk/cards/hk-base.js": BODY,
    "hk/calendar/hk-calendar-sheet.js": BODY, "hk/calendar/hk-calendar-todo.js": BODY, "hk/cameras/hk-cameras-tv.js": BODY,
    "hk/cards/hk-intercom.js": BODY, "hk/cards/hk-popup.js": BODY, "hk/cards/hk-timeline.js": BODY,
    "hk/layout/hk-layout-grid.js": BODY, "hk/media/hk-media-now.js": BODY, "hk/modules/hk-notify.js": BODY,
    "hk/modules/hk-radar.js": BODY, "hk/modules/hk-timer-ring.js": BODY, "hk/sheets/hk-detail-frame.js": BODY,
    "hk/shell/hk-overlays.js": BODY, "shim/mantel-host.js": BODY, "shim/mantel-photos.js": BODY,
    "hk/menu/hk-menu-css.js": SHELL, "hk/modules/hk-sidepane.js": SHELL, "hk/modules/hk-sky.js": SHELL,
    "hk/modules/hk-tabbar.js": SHELL, "hk/sidepane/hk-sidepane-css.js": SHELL, "hk/sidepane/hk-sidepane-music.js": SHELL,
    "hk/sky-parts/hk-sky-handover.js": SHELL, "hk/sky-parts/hk-sky-mount.js": SHELL, "hk/modules/tesla-viewport.js": SHELL,
    "hk/media/hk-media-saver.js": SAVER, "hk/modules/hk-timers.js": SAVER, "hk/saver/hk-saver-css.js": SAVER,
    "hk/saver/hk-saver-pane.js": SAVER, "hk/weather/hk-weather-status.js": SAVER, "hk/modules/hk-saver-chooser.js": SAVER,
    "hk/modules/hk-edit-grid.js": EDIT, "hk/modules/hk-edit-menu.js": EDIT, "hk/modules/hk-edit.js": EDIT,
    "hk/panels/hk-grid-editor.js": EDIT, "hk/panels/hk-saver-editor.js": EDIT,
    "hk/modules/hk-settings.js": TOOL, "hk/modules/hk-skylab.js": TOOL, "hk/panels/hk-settings-kit.js": TOOL,
    "hk/pages/seasonal-scenery-review.html": TOOL, "hk/pages/skylab.html": TOOL, "hk/pages/skyprobe.html": TOOL,
    "settings.html": TOOL,
    "hk/modules/hk-glass.js": SWIPE, "hk/modules/hk-pageswipe.js": SWIPE,
    "hk/home-cards/hk-home-timer-page.js": WORDS,
    "hk/cards/hk-music.js": INSIDE, "hk/cards/hk-pages-screen.js": INSIDE,
}
# the card each INSIDE file defines, as hk-pageswipe.js names it
TAGS = {"hk/cards/hk-music.js": "hk-music-card", "hk/cards/hk-pages-screen.js": "hk-pages-screen-card"}


def _fixed_files() -> set[str]:
    out = set()
    for p in WEB.rglob("*"):
        if p.suffix in (".js", ".mjs", ".css", ".html") and p.is_file() and FIXED.search(p.read_text(errors="ignore")):
            out.add(p.relative_to(WEB).as_posix())
    return out


def test_every_fixed_rule_is_placed():
    found = _fixed_files()
    new = sorted(found - set(WHERE))
    assert not new, ("position: fixed in a file this test doesn't know: say where what it fixes lives (WHERE) -- on the body, "
                     "or inside its card and then in hk-pageswipe.js FIXED_INSIDE: " + ", ".join(new))
    gone = sorted(set(WHERE) - found)
    assert not gone, "no fixed rule left in: " + ", ".join(gone)


def test_a_card_fixed_inside_itself_keeps_its_page_out_of_a_layer():
    swipe = (WEB / "hk/modules/hk-pageswipe.js").read_text()
    table = re.search(r"var FIXED_INSIDE = \{([^}]*)\}", swipe)
    assert table, "hk-pageswipe.js FIXED_INSIDE"
    named = set(re.findall(r"'([a-z0-9-]+)'\s*:", table.group(1)))
    for rel, where in WHERE.items():
        if where is INSIDE:
            assert TAGS[rel] in named, (rel, TAGS[rel])
            assert f"'{TAGS[rel]}'" in (WEB / rel).read_text() or TAGS[rel] in (WEB / rel).read_text(), rel
    # a view of cards that aren't ours: nothing is known of what they fix
    assert "hk-view-fallback" in named
    # ...and only where it may: an Android wall tablet, never a car's browser, never a page with something fixed in it
    assert "function restOk(el) { return android() && keeps() && !fixedIn(el); }" in swipe
