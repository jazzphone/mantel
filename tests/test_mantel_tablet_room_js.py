"""Mantel's host shell answers a Home Grid's `tablet_room` (docs/phase11/HOME-GRID.md, G3): the room of the wall
tablet device showing the page (GET /api/me `room`, handed over by home.js), else the room of the HK tablet the page
is (hk-settings.js tablet()), else none. Run in node with only the globals the two files touch."""
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
eval(fs.readFileSync(process.argv[1] + '/web/client/hk-host-shell.js', 'utf8'));
eval(fs.readFileSync(process.argv[1] + '/web/shim/mantel-shell.js', 'utf8'));
const r = { none: hkShell.tabletRoom(null) };
let tablet = null;
globalThis.hkSettings = { tablet: () => tablet };
tablet = { id: 'den_tablet', room: 'den' };
r.hkTablet = hkShell.tabletRoom(null);
hkMantelShell.setRoom('kitchen');
r.device = hkShell.tabletRoom(null);
hkMantelShell.setRoom('Not An Id');
r.badDevice = hkShell.tabletRoom(null);
tablet = { id: 'x', room: '../den' };
r.badTablet = hkShell.tabletRoom(null);
hkMantelShell.setRoom(null);
tablet = null;
r.cleared = hkShell.tabletRoom(null);
process.stdout.write(JSON.stringify(r));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_tablets_room_is_the_devices_else_the_hk_tablets():
    got = json.loads(subprocess.run(["node", "-e", SCRIPT, str(ROOT)], capture_output=True, text=True,
                                    check=True, timeout=30).stdout)
    assert got == {"none": None, "hkTablet": "den", "device": "kitchen", "badDevice": "den", "badTablet": None,
                   "cleared": None}
