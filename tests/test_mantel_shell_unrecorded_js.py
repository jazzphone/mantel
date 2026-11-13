"""A whole-house discovery scan is no screen's need (hkShell.unrecorded). The page keeps only the states its surfaces
read (home.js narrowing, mantel-host.js `seen` / `reads`); Laundry's discovery scan read every state, and the Loft's
screen then took every update of the house's 4,518 entities, about 5 a second (2026-11-12). Run in node with the two
shells: Home Assistant's facade just runs the function; Mantel's runs it with the host's recording off, and puts back
what it found -- also when the function throws."""
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
globalThis.document = { body: {}, getElementById: () => null };
eval(fs.readFileSync(process.argv[1] + '/web/client/hk-host-shell.js', 'utf8'));
const out = {};
out.ha = hkShell.unrecorded(() => 'ran');                     // Home Assistant's: the function, as it is
eval(fs.readFileSync(process.argv[1] + '/web/shim/mantel-shell.js', 'utf8'));
out.noHost = hkShell.unrecorded(() => 'ran');                 // Mantel's before the host is up: as it is
const seen = new Set(), reads = new Set();
const host = { building: false, recording: true };
const states = new Proxy({ 'sensor.a': 1, 'sensor.b': 2 }, { get(t, k) {
  if (host.recording) reads.add(k);
  if (!host.building) seen.add(k);
  return t[k];
} });
globalThis.__mantel = host;
out.result = hkShell.unrecorded(() => Object.keys(states).map((k) => states[k]).length);
out.during = { seen: [...seen], reads: [...reads] };
out.after = { building: host.building, recording: host.recording };
void states['sensor.a'];                                     // a surface's own read, after: recorded
out.surface = { seen: [...seen], reads: [...reads] };
try { hkShell.unrecorded(() => { throw new Error('x'); }); } catch (e) { /* the shell's wrapper may swallow it */ }
out.afterThrow = { building: host.building, recording: host.recording };
process.stdout.write(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_a_discovery_scan_is_no_screens_need():
    got = json.loads(subprocess.run(["node", "-e", SCRIPT, str(ROOT)], capture_output=True, text=True,
                                    check=True, timeout=30).stdout)
    assert got["ha"] == "ran" and got["noHost"] == "ran"
    assert got["result"] == 2
    assert got["during"] == {"seen": [], "reads": []}, "the scan's reads are not kept"
    assert got["after"] == {"building": False, "recording": True}, "the host's flags as they were"
    assert got["surface"] == {"seen": ["sensor.a"], "reads": ["sensor.a"]}, "what a surface reads after is kept"
    assert got["afterThrow"] == {"building": False, "recording": True}
