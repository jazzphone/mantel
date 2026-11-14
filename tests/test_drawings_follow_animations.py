"""The drawings that move -- the Laundry and Vacuum pictures and the Power page's light -- stand still where the screen's
Animations are off (Sky / Background), as the spinning glyphs do (hk-base.js marks a card hk-still). On a slow wall
tablet any motion costs: each frame the Kitchen's tablet draws again is ~85 ms of its processors, so one turning drum
kept 1.7 cores busy (2026-11-14). A card follows its hk-still attribute; a sheet's drawing is drawn still (`still`)."""
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
for (const f of ['web/hk/modules/hk-laundry.js', 'web/hk/modules/hk-vacuum-art.js'])
  eval(fs.readFileSync(process.argv[1] + '/' + f, 'utf8'));
const out = {};
const draw = () => ({ laundry: hkLaundry.art('spinning', 'washer', {}), vacuum: hkVacuumArt.html('cleaning', 'Vacuum') });
out.moving = draw();
window.hkSettings = { skyLook: () => ({ animations: false }) };
out.still = draw();
window.hkSettings = { skyLook: () => { throw new Error('not ready'); } };
out.broken = draw();
out.css = { laundry: hkLaundry.CSS, vacuum: hkVacuumArt.CSS };
process.stdout.write(JSON.stringify(out));
"""


def _root_class(html: str) -> list[str]:
    return re.match(r'<(?:svg|div) class="([^"]*)"', html).group(1).split()


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_laundry_and_vacuum_draw_still_with_animations_off():
    got = json.loads(subprocess.run(["node", "-e", SCRIPT, str(ROOT)], capture_output=True, text=True,
                                    check=True, timeout=30).stdout)
    for k in ("laundry", "vacuum"):
        assert "still" not in _root_class(got["moving"][k]), k
        assert "still" in _root_class(got["still"][k]), k
        assert "still" not in _root_class(got["broken"][k]), f"{k}: settings not ready draws it moving"
    assert ":host([hk-still]) .hkla *{animation:none!important}" in got["css"]["laundry"]
    assert ".hkla.still *{animation:none!important}" in got["css"]["laundry"]
    assert ":host([hk-still]) .hkva *{animation:none!important}" in got["css"]["vacuum"]
    assert ".hkva.still *{animation:none!important}" in got["css"]["vacuum"]


def test_the_power_pages_light_stands_with_animations_off():
    power = (ROOT / "web/hk/energy/hk-energy-power.js").read_text()
    house = (ROOT / "web/hk/energy/hk-energy-house.js").read_text()
    for sel in (".run", ".gw", ".shim", ".hshim"):
        assert f":host([hk-still]) {sel}" in power, sel
    for sel in (".glint", ".lvrun", ".lvtop", ".portdot"):
        assert f":host([hk-still]) {sel}" in house, sel
    assert ":host([hk-still]) .flowdot{display:none}" in house
