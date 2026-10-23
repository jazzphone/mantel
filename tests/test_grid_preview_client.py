"""An isolated gallery client reaches non-HkBase cards in either host without a command port."""
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which('node') is None, reason='Node is unavailable')
@pytest.mark.parametrize('adapter', ['web/shim/mantel-client.js', 'hosts/ha/frontend/hk-ha-client.js'])
def test_isolated_preview_client_can_feed_controls(adapter):
    script = r"""
const fs = require('fs'), vm = require('vm'), assert = require('assert');
globalThis.window = globalThis;
globalThis.dispatchEvent = () => {};
globalThis.CustomEvent = class {};
const load = name => vm.runInThisContext(fs.readFileSync(process.argv[1]+'/'+name, 'utf8'));
load('web/client/hk-client.js'); load(process.argv[2]);
const sample = hkClient.create({states:{'climate.sample':{state:'heat',attributes:{current_temperature:71}}}});
class Control { _onClient(client) { this.reading = client.states['climate.sample']; } }
hkHostClient.entry(Control);
const control = new Control(); hkHostClient.bridge(control, sample);
assert.strictEqual(control.client, sample);
assert.strictEqual(control.reading.attributes.current_temperature, 71);
assert.strictEqual(control.hass, undefined);
sample.actions.callService('climate','set_temperature').then(
  () => { throw new Error('Preview permitted a command'); },
  error => assert.strictEqual(error.code, 'commands_disabled')
).catch(error => { console.error(error); process.exitCode = 1; });
"""
    run = subprocess.run(['node', '-e', script, str(ROOT), adapter], capture_output=True, text=True, timeout=30)
    assert run.returncode == 0, run.stdout + run.stderr
