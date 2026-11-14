"""The weather's readings (hkWxReadings.read, hk-weather.js) look for an air-quality sensor over every sensor of the house:
that look is no screen's need (hkShell.unrecorded). Read by a screensaver's Glance, it kept the whole house on a wall
tablet's page -- the Kitchen's, 4,566 states, every power meter's tick a redraw of the page (2026-11-13). Run in node
with a stand-in shell that counts what is read outside unrecorded: the weather entity, the sun and the air-quality
sensor found, never the sensors it passed over."""
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
const src = fs.readFileSync(process.argv[1] + '/web/hk/cards/hk-weather.js', 'utf8');
const from = src.indexOf('// ============================================================ THE READINGS');
const end = src.indexOf('window.hkWxReadings = { read: read, SAYS: SAYS };', from);
eval(src.slice(from, src.indexOf('})();', end) + 5));
const S = (state, attributes) => ({ state, attributes: attributes || {} });
const raw = {
  'weather.home': S('sunny', { temperature: 51, temperature_unit: '°F', humidity: 40, wind_speed: 4 }),
  'sun.sun': S('above_horizon', { next_setting: '2026-11-14T21:40:00Z' }),
  'sensor.power_meter': S('312', { device_class: 'power' }),
  'sensor.outlet': S('4', { device_class: 'power' }),
  'sensor.air': S('17', { device_class: 'aqi' }),
  'light.lamp': S('on'),
};
let quiet = 0;
const outside = new Set();
const states = new Proxy(raw, { get(t, k) { if (typeof k === 'string' && k in t && !quiet) outside.add(k); return t[k]; } });
const out = {};
out.noShell = window.hkWxReadings.read({ states }).aqi;          // no host shell (a test, an old page): it still reads
outside.clear();
window.hkShell = { unrecorded(fn) { quiet++; try { return fn(); } finally { quiet--; } } };
const r = window.hkWxReadings.read({ states, config: { location_name: 'Home' } });
out.read = { entity: r.entity, temp: r.temp, aqi: r.aqi, says: r.says };
out.outside = [...outside].sort();
process.stdout.write(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_the_air_quality_look_is_no_screens_need():
    got = json.loads(subprocess.run(["node", "-e", SCRIPT, str(ROOT)], capture_output=True, text=True,
                                    check=True, timeout=30).stdout)
    assert got["noShell"] == 17
    assert got["read"] == {"entity": "weather.home", "temp": 51, "aqi": 17, "says": "Sunny"}
    assert got["outside"] == ["sensor.air", "sun.sun", "weather.home"], "only what the readings show is kept"
