"""Mantel's host shell names the view kinds HK's view host puts in its container (viewTags), as Home Assistant's
shell names hui-view and its kinds. hk-glass.js anchors the shared blur's page layer to the view element it finds
by them; with none named, the layer went into the container before the sky and was painted under it: Shared Layer
and Pre-rendered left every pill clear on Mantel (2026-10-20). The blur itself on that page is checked by the jsc
suite test_glass_hostview.js, which declares the same list (MANTEL_VIEW_TAGS) -- pinned here. Run in node with
only the globals the two files touch."""
from __future__ import annotations

import json
import re
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
globalThis.document = { body: {}, getElementById: () => null };
eval(fs.readFileSync(process.argv[1] + '/web/client/hk-host-shell.js', 'utf8'));
const before = hkShell.viewTags;
eval(fs.readFileSync(process.argv[1] + '/web/shim/mantel-shell.js', 'utf8'));
const view = { localName: 'hk-grid-view' };
hkMantelShell.attach({
  onView: () => {},
  shellParts: () => ({ viewContainer: () => null, view: () => view, tags: { view: 'hk-grid-view' } }),
});
process.stdout.write(JSON.stringify({ before, tags: hkShell.viewTags }));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_shell_names_the_views_the_view_host_makes():
    got = json.loads(subprocess.run(["node", "-e", SCRIPT, str(ROOT)], capture_output=True, text=True,
                                    check=True, timeout=30).stdout)
    assert got["before"] == []
    tags = got["tags"]
    # the strategies' view (every generated page) and the view host's own fallback for any other view type
    host = (ROOT / "web/hk/shell/hk-view-host.js").read_text()
    fallback = set(re.findall(r"createElement\('(hk-view-fallback)'\)", host))
    strategies = "".join(p.read_text() for p in (ROOT / "web/hk/cards").glob("*.js"))
    views = set(re.findall(r"type: 'custom:(hk-[a-z-]*-view)'", strategies))
    assert fallback == {"hk-view-fallback"} and "hk-grid-view" in views
    assert set(tags) >= fallback | views, tags
    # ...and the jsc suite that checks the blur on such a page tests this very list
    suite = (ROOT / "hosts/ha/custom_components/hk_frontend/tests/test_glass_hostview.js").read_text()
    declared = re.search(r"^var MANTEL_VIEW_TAGS = (\[[^\]]*\]);$", suite, re.M)
    assert declared and json.loads(declared.group(1).replace("'", '"')) == tags
