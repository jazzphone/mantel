"""Mantel's host shell tells HK where Music Assistant / go2rtc are served on the page's own origin
(web/shim/mantel-shell.js serviceUrl, fed by GET /api/services in home.js). Run in node with only the
globals the two files touch."""
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
const out = {};
for (const base of ['', '/api/hassio_ingress/Fict1onal']) {
  delete globalThis.hkShell; delete globalThis.hkMantelShell;
  globalThis.__mantelBase = base;
  eval(fs.readFileSync(process.argv[1] + '/web/client/hk-host-shell.js', 'utf8'));
  eval(fs.readFileSync(process.argv[1] + '/web/shim/mantel-shell.js', 'utf8'));
  const before = hkShell.serviceUrl('music_assistant');
  hkMantelShell.setServices({ music_assistant: '/ma/', go2rtc: null });
  const r = { before, ma: hkShell.serviceUrl('music_assistant'), g2: hkShell.serviceUrl('go2rtc'),
              other: hkShell.serviceUrl('nope') };
  hkMantelShell.setServices({ music_assistant: 'https://evil.example/ma/', go2rtc: '/go2rtc/../x' });
  r.evil = hkShell.serviceUrl('music_assistant'); r.dots = hkShell.serviceUrl('go2rtc');
  hkMantelShell.setServices({ music_assistant: '/ma/hassio_ingress/mantel/' });
  r.signed = hkShell.serviceUrl('music_assistant');
  hkMantelShell.setServices(null);
  r.cleared = hkShell.serviceUrl('music_assistant');
  out[base || 'root'] = r;
}
process.stdout.write(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_service_urls_are_same_origin_paths_under_the_prefix():
    got = json.loads(subprocess.run(["node", "-e", SCRIPT, str(ROOT)], capture_output=True, text=True,
                                    check=True, timeout=30).stdout)
    assert got["root"] == {"before": None, "ma": "/ma/", "g2": None, "other": None, "evil": None, "dots": None,
                           "signed": "/ma/hassio_ingress/mantel/", "cleared": None}
    ing = got["/api/hassio_ingress/Fict1onal"]
    assert ing["ma"] == "/api/hassio_ingress/Fict1onal/ma/" and ing["evil"] is None and ing["before"] is None
