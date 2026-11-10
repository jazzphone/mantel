"""Laundry (phase 22, docs/phase22/LAUNDRY.md): the rules in hk_core/laundry.py and their copy in web/hk/modules/hk-laundry.js.

The two tables are the same; a machine as saved is checked (and refused with a reason); every brand's machine reads to the same
state in Python (Mantel Server's Done watch) and in the page (found machines, look(), controls()); the settings keys save."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from hk_core import laundry as LA
from hk_core.settings import changes as C

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "web/hk/modules/hk-laundry.js"
NODE = shutil.which("node") or "/opt/homebrew/bin/node"
needs_node = pytest.mark.skipif(not Path(NODE).exists(), reason="no node")


def js_table() -> dict:
    text = JS.read_text()
    body = text.split("// WORDS-BEGIN", 1)[1].split("// WORDS-END", 1)[0]
    return json.loads(body.split("=", 1)[1].rsplit(";", 1)[0])


def test_the_page_has_the_same_table():
    t = js_table()
    assert t["WORDS"] == LA.WORDS
    assert t["STEPS"] == LA.STEPS
    assert t["STEP_OF"] == LA.STEP_OF
    assert set(LA.WORDS.values()) <= set(LA.STATES)


def test_every_state_and_role_is_in_the_page():
    text = JS.read_text()
    for s in LA.STATES:
        assert f"'{s}'" in text
    roles = re.search(r"var ROLES = \[([^\]]*)\]", text).group(1)
    assert [r.strip(" '") for r in roles.split(",")] == list(LA.ROLES)


# ------------------------------------------------------------ the saved machines
GOOD = {"id": "washer", "name": "Washer", "kind": "combo", "area": "laundry_room", "status": "sensor.washer_machine_state",
        "phase": "sensor.washer_job_state", "time": "sensor.washer_completion_time", "progress": "sensor.washer_progress"}


def test_a_machine_is_checked_and_filled_in():
    got = LA.machine(GOOD)
    assert got["watts"] == LA.DEFAULT_WATTS and got["door"] is None and got["running"] is None
    assert LA.machine({"id": "dryer", "name": " Dryer ", "kind": "dryer", "power": "sensor.dryer_plug_power", "watts": 40})["name"] == "Dryer"


@pytest.mark.parametrize("bad,code", [
    ({**GOOD, "kind": "dishwasher"}, "choice"),
    ({**GOOD, "id": "Washer One"}, "choice"),
    ({**GOOD, "name": ""}, "text"),
    ({**GOOD, "status": "light.washer"}, "entity"),
    ({**GOOD, "leak": "sensor.leak"}, "entity"),
    ({**GOOD, "watts": 0}, "choice"),
    ({**GOOD, "watts": True}, "choice"),
    ({**GOOD, "colour": "red"}, "choice"),
    ({"id": "dryer", "name": "Dryer", "kind": "dryer"}, "required"),
])
def test_a_machine_is_refused_with_a_reason(bad, code):
    with pytest.raises(LA.Invalid) as e:
        LA.machine(bad)
    assert e.value.code == code


def test_the_list_and_clear_after():
    assert LA.machines(None) == [] and len(LA.machines([GOOD, {**GOOD, "id": "dryer", "kind": "dryer"}])) == 2
    for bad in ([GOOD, GOOD], [GOOD] * 9, "washer"):
        with pytest.raises(LA.Invalid):
            LA.machines(bad)
    assert LA.clear_after(0) == 0 and LA.clear_after(24) == 24
    for bad in (3, "4", True, None):
        with pytest.raises(LA.Invalid):
            LA.clear_after(bad)


def test_the_settings_keys_save_and_refuse():
    house = C.HOUSE
    assert house["features.laundry"]([GOOD])[0]["id"] == "washer"
    assert house["features.laundry_clear"](8) == 8
    with pytest.raises(C.Invalid) as e:
        house["features.laundry"]([{**GOOD, "kind": "dishwasher"}])
    assert e.value.code == "choice"
    with pytest.raises(C.Invalid):
        house["features.laundry_clear"](5)


# ------------------------------------------------------------ every brand, one set of states
def st(s, **a):
    return {"s": s, "a": a}


# (machine, states, expected) -- invented houses, each integration's own spellings (docs/phase22/LAUNDRY.md's table)
SAMSUNG = {"id": "w", "name": "Washer", "kind": "combo", "status": "sensor.w_machine_state", "phase": "sensor.w_job_state",
           "time": "sensor.w_completion_time", "progress": "sensor.w_progress"}
LG = {"id": "lg", "name": "Washer", "kind": "washer", "status": "sensor.lg_current_status", "time": "sensor.lg_remain"}
HC = {"id": "hc", "name": "Dryer", "kind": "dryer", "status": "sensor.hc_operation_state"}
MIELE = {"id": "mi", "name": "Washer", "kind": "washer", "status": "sensor.mi_status", "phase": "sensor.mi_program_phase"}
POWER = {"id": "pw", "name": "Dryer", "kind": "dryer", "power": "sensor.pw_power", "watts": 10}
RUN = {"id": "rn", "name": "Washer", "kind": "washer", "running": "binary_sensor.rn_running"}
CASES = [
    (SAMSUNG, {"sensor.w_machine_state": st("run"), "sensor.w_job_state": st("drying")}, "drying"),
    (SAMSUNG, {"sensor.w_machine_state": st("run"), "sensor.w_job_state": st("ai_wash")}, "washing"),
    (SAMSUNG, {"sensor.w_machine_state": st("pause"), "sensor.w_job_state": st("drying")}, "paused"),
    (SAMSUNG, {"sensor.w_machine_state": st("stop"), "sensor.w_job_state": st("finish")}, "done"),
    (SAMSUNG, {"sensor.w_machine_state": st("stop"), "sensor.w_job_state": st("wrinkle_prevent")}, "wrinkle"),
    (SAMSUNG, {"sensor.w_machine_state": st("stop"), "sensor.w_job_state": st("none")}, "off"),
    (SAMSUNG, {"sensor.w_machine_state": st("unavailable")}, "offline"),
    (LG, {"sensor.lg_current_status": st("spinning")}, "spinning"),
    (LG, {"sensor.lg_current_status": st("end")}, "done"),
    (LG, {"sensor.lg_current_status": st("error")}, "error"),
    (LG, {"sensor.lg_current_status": st("power_off")}, "off"),
    (HC, {"sensor.hc_operation_state": st("run")}, "running"),
    (HC, {"sensor.hc_operation_state": st("delayedstart")}, "delayed"),
    (HC, {"sensor.hc_operation_state": st("actionrequired")}, "error"),
    (MIELE, {"sensor.mi_status": st("in_use"), "sensor.mi_program_phase": st("main_wash")}, "washing"),
    (MIELE, {"sensor.mi_status": st("in_use"), "sensor.mi_program_phase": st("anti_crease")}, "wrinkle"),
    (MIELE, {"sensor.mi_status": st("program_ended"), "sensor.mi_program_phase": st("finished")}, "done"),
    (POWER, {"sensor.pw_power": st("412.5", unit_of_measurement="W")}, "running"),
    (POWER, {"sensor.pw_power": st("2.1")}, "off"),
    (POWER, {"sensor.pw_power": st("unavailable")}, "offline"),
    (RUN, {"binary_sensor.rn_running": st("on")}, "running"),
    (RUN, {"binary_sensor.rn_running": st("off")}, "off"),
]


@pytest.mark.parametrize("m,states,want", CASES, ids=[f"{c[0]['id']}-{i}" for i, c in enumerate(CASES)])
def test_python_reads_every_brand(m, states, want):
    assert LA.state_of(m, states) == want


def test_done_is_running_then_not():
    assert LA.settled(True, "done") and LA.settled(True, "off") and LA.settled(True, "wrinkle")
    assert not LA.settled(False, "done")            # (finished while no one watched: not guessed at)
    assert not LA.settled(True, "drying") and not LA.settled(True, "paused")
    assert not LA.settled(True, "offline") and not LA.settled(True, "error")
    assert LA.expired(0, 4, 4 * 3600) and not LA.expired(0, 4, 4 * 3600 - 1) and not LA.expired(0, 0, 1e9)


PAGE = r"""
const fs = require('fs');
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(process.argv[2], 'utf8'));
const L = globalThis.hkLaundry, A = JSON.parse(process.argv[3]);
const NOW = Date.parse('2026-11-10T18:00:00Z');
const client = (states, extra) => Object.assign({ states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, { state: v.s, attributes: v.a || {} }])), entities: {}, devices: {} }, extra || {});
const out = {};
out.states = A.cases.map(([m, s]) => L.stateOf(client(s), m));
// THE OWNER'S KIND OF HOUSE, invented names: a Samsung combo's sensors on one device, a leak sensor in its room
const ents = {}, states = {};
const put = (id, s, a, dev) => { states[id] = { state: s, attributes: a || {} }; ents[id] = { entity_id: id, device_id: dev, area_id: null }; };
put('select.washer', 'run', { options: ['stop', 'run', 'pause'] }, 'd1');
put('sensor.washer_machine_state', 'run', { device_class: 'enum', options: ['pause', 'run', 'stop'] }, 'd1');
put('sensor.washer_job_state', 'drying', { device_class: 'enum', options: ['air_wash', 'ai_rinse', 'drying', 'finish', 'none', 'rinse', 'spin', 'wash', 'wrinkle_prevent'] }, 'd1');
put('sensor.washer_completion_time', new Date(NOW + 24 * 60000).toISOString(), { device_class: 'timestamp' }, 'd1');
put('sensor.washer_progress', '74', { unit_of_measurement: '%' }, 'd1');
put('binary_sensor.washer_remote_control', 'off', {}, 'd1');
put('sensor.washer_power', '0', { device_class: 'power', unit_of_measurement: 'W' }, 'd1');
put('sensor.washer_energy', '22.2', { device_class: 'energy' }, 'd1');
put('binary_sensor.laundry_leak', 'off', { device_class: 'moisture' }, 'd2');
// AN LG STACK, two status sensors on one device, and a dryer with no integration (a plug)
put('sensor.tower_washer_current_status', 'rinsing', { device_class: 'enum', options: ['power_off', 'running', 'rinsing', 'spinning', 'end', 'error'] }, 'd3');
put('sensor.tower_dryer_current_status', 'drying', { device_class: 'enum', options: ['power_off', 'drying', 'cooling', 'end', 'error'] }, 'd3');
put('sensor.dryer_plug_power', '640', { device_class: 'power' }, 'd4');
const house = { states, entities: ents, devices: { d1: { area_id: 'laundry_room', model: 'WD53DBA900H' }, d2: { area_id: 'laundry_room' }, d3: { area_id: 'utility' }, d4: { area_id: 'utility' } } };
out.found = L.found(house);
const w = out.found[0];
out.look = L.look(house, w, NOW);
out.controls = L.controls(house, w);
house.states['binary_sensor.washer_remote_control'].state = 'on';
out.controlsOn = L.controls(house, w);
// held Done (Mantel Server) and a leak
house.states['sensor.washer_machine_state'].state = 'stop'; house.states['sensor.washer_job_state'].state = 'none';
house.states['sensor.laundry_done'] = { state: '1', attributes: { machines: { [w.id]: { since: (NOW - 12 * 60000) / 1000, words: 'Done' } } } };
out.held = L.look(house, w, NOW);
house.states['binary_sensor.laundry_leak'].state = 'on';
out.leak = L.look(house, w, NOW);
out.art = ['drying', 'done', 'leak', 'nonsense'].map((s) => L.art(s, 'combo', { display: '0:24' }).slice(0, 60));
out.first = L.first([{ state: 'drying', runs: true, left: 600 }, { state: 'done', runs: false }, { state: 'off', runs: false }]).state;
process.stdout.write(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def page(tmp_path_factory):
    if not Path(NODE).exists():
        pytest.skip("no node")
    js = tmp_path_factory.mktemp("laundry") / "run.js"
    js.write_text(PAGE)
    cases = [[m, s] for m, s, _ in CASES]
    got = subprocess.run([NODE, str(js), str(JS), json.dumps({"cases": cases})], capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


@needs_node
def test_the_page_reads_every_brand_as_python_does(page):
    assert page["states"] == [want for _, _, want in CASES]


@needs_node
def test_machines_are_found_on_their_devices(page):
    f = {m["status"]: m for m in page["found"]}
    w = f["sensor.washer_machine_state"]
    assert w["kind"] == "combo" and w["name"] == "Washer" and w["area"] == "laundry_room"
    assert (w["phase"], w["time"], w["progress"], w["remote"], w["power"], w["leak"]) == (
        "sensor.washer_job_state", "sensor.washer_completion_time", "sensor.washer_progress", "binary_sensor.washer_remote_control",
        "sensor.washer_power", "binary_sensor.laundry_leak")
    # (the job state is the step, not a second machine; the energy is no time)
    assert "sensor.washer_job_state" not in f
    lg_w, lg_d = f["sensor.tower_washer_current_status"], f["sensor.tower_dryer_current_status"]
    assert (lg_w["kind"], lg_d["kind"]) == ("washer", "dryer") and lg_w["id"] != lg_d["id"]
    assert "sensor.dryer_plug_power" not in f                       # (a plug is added by hand)
    assert len({m["id"] for m in page["found"]}) == len(page["found"])


@needs_node
def test_what_one_machine_says(page):
    o = page["look"]
    assert (o["state"], o["title"], o["sub"], o["endsWords"], o["pct"]) == ("drying", "Drying", "24 min left", o["endsWords"], 74)
    assert o["endsWords"].startswith("Done at ")
    assert [s["name"] for s in o["steps"]] == ["Wash", "Rinse", "Spin", "Dry"]
    assert [s["now"] for s in o["steps"]] == [False, False, False, True] and [s["done"] for s in o["steps"]] == [True, True, True, False]
    assert o["remote"] is False and o["leak"] is False
    h = page["held"]
    assert (h["state"], h["title"], h["sub"], h["short"]) == ("done", "Done", "Finished 12 min ago", "Done")
    assert all(s["done"] for s in h["steps"])
    assert page["leak"]["state"] == "leak" and page["leak"]["machine"] == "done" and page["leak"]["title"] == "Water Leak"


@needs_node
def test_pause_and_stop_never_a_start(page):
    c = page["controls"]
    assert c["pause"] == ["select", "select_option", {"entity_id": "select.washer", "option": "pause"}]
    assert c["resume"] == ["select", "select_option", {"entity_id": "select.washer", "option": "run"}]
    assert c["stop"] == ["select", "select_option", {"entity_id": "select.washer", "option": "stop"}]
    assert "Remote Control" in c["why"]
    assert page["controlsOn"]["why"] is None


@needs_node
def test_the_drawing_and_the_first_to_look_at(page):
    assert [a.split('class="')[1].split('"')[0] for a in page["art"]] == ["hkla s-drying", "hkla s-done", "hkla s-leak", "hkla s-off"]
    assert page["first"] == "done"
