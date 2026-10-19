"""Mantel's host shell keeps its own panel (the page's body) when HK's view host is attached: the view
host offers its container as the panel, but that container is also the view slot a docked menu pushes
right (hk-menu.js room), and the menu draws itself at the panel's left. With the two the same element the
menu moved along with the page (2026-10-19). Run in node with only the globals the two files touch."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(n, i) { this.type = n; this.detail = i && i.detail; } };
globalThis.dispatchEvent = () => true;
const view = { id: 'view', localName: 'hk-view-container' }, body = { localName: 'body' };
globalThis.document = { body, getElementById: (id) => (id === 'view' ? view : null) };
eval(fs.readFileSync(process.argv[1] + '/web/client/hk-host-shell.js', 'utf8'));
eval(fs.readFileSync(process.argv[1] + '/web/shim/mantel-shell.js', 'utf8'));
const name = (el) => (el === body ? 'body' : el === view ? 'view' : String(el));
const out = { before: { panel: name(hkShell.panel()), slot: name(hkShell.viewSlot(hkShell.panel())) } };
let changed = null;
const shown = { localName: 'hk-view' };
hkMantelShell.attach({
  onView: (fn) => { changed = fn; },
  shellParts: () => ({ panel: () => view, viewContainer: () => view, viewSlot: () => view,
                       view: () => shown, dashboardConfig: () => ({ views: [] }), tags: { view: 'hk-view' } }),
});
const read = () => ({ panel: name(hkShell.panel()), slot: name(hkShell.viewSlot(hkShell.panel())),
                      container: name(hkShell.viewContainer(hkShell.panel())), view: hkShell.view() === shown });
out.attached = read();
changed();
out.changed = read();
process.stdout.write(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_panel_is_the_page_not_the_view_slot_the_menu_pushes():
    got = json.loads(subprocess.run(["node", "-e", SCRIPT, str(ROOT)], capture_output=True, text=True,
                                    check=True, timeout=30).stdout)
    assert got["before"] == {"panel": "body", "slot": "view"}
    want = {"panel": "body", "slot": "view", "container": "view", "view": True}
    assert got["attached"] == want and got["changed"] == want


def test_the_screen_page_says_no_pinch_zoom_as_has_does():
    """Kiosk Satellite's "pinch to zoom off" leaves the page's own viewport tag alone at 1x and relies on it saying
    user-scalable=no, as HA's pages do; Mantel's screens did not, so the Loft could be pinched (2026-10-19)."""
    from pathlib import Path
    html = (Path(__file__).resolve().parents[1] / "web/home.html").read_text()
    assert 'content="width=device-width, user-scalable=no, viewport-fit=cover, initial-scale=1"' in html
