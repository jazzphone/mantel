import json
import shutil
import subprocess
from pathlib import Path

import pytest

from mantel_server.registry import Registry
from mantel_server.state import StateStore
from mantel_server.view import ClientView, Coalescing

ROOT = Path(__file__).resolve().parent.parent


def test_all_mode_follows_the_whole_house():
    store, reg = StateStore(), Registry()
    store.apply_event({"a": {"light.a": {"s": "on", "a": {}, "lc": 1.0}}})
    view = ClientView(store, reg, Coalescing())
    snap = view.select([], [], 0.0, all_entities=True)
    assert set(snap["entities"]) == {"light.a"}
    store.apply_event({"a": {"light.new": {"s": "on", "a": {}, "lc": 2.0}}})
    assert view.on_change({"light.new"})
    msg, _ = view.flush(1.0)
    assert set(msg["added"]) == {"light.new"}
    del store.states["light.a"]
    view.on_change({"light.a"})
    msg, _ = view.flush(2.0)
    assert msg["removed"] == ["light.a"] and "light.a" not in view.selected


def test_frontend_shapes_match_what_hass_holds():
    r = Registry()
    r.load([{"area_id": "k", "name": "Kitchen", "floor_id": "main"}],
           [{"id": "d1", "area_id": "k", "name": "Lamp"}, {"id": "d2", "disabled_by": "user"}],
           [{"entity_id": "light.a", "device_id": "d1", "platform": "hue", "hidden_by": None},
            {"entity_id": "light.hid", "hidden_by": "user", "platform": "hue"},
            {"entity_id": "light.off", "disabled_by": "user"}],
           [{"floor_id": "main", "name": "Main Floor", "level": 1}])
    s = r.frontend_shapes()
    assert set(s["entities"]) == {"light.a", "light.hid"}          # disabled entities are not in hass.entities
    assert s["entities"]["light.hid"]["hidden"] is True and s["entities"]["light.a"]["hidden"] is False
    assert set(s["devices"]) == {"d1"} and s["areas"]["k"]["floor_id"] == "main" and s["floors"]["main"]["level"] == 1


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_conditional_conditions():
    js = f"""globalThis.HTMLElement = class {{}};
    const {{ holds }} = await import('{ROOT}/web/shim/cards-bridge.js');
    const hass = {{ states: {{ 'a.x': {{ state: 'idle' }}, 'a.n': {{ state: '3' }} }} }};
    globalThis.window = {{ matchMedia: () => ({{ matches: true }}) }};
    console.log(JSON.stringify([
      holds({{ condition: 'state', entity: 'a.x', state: 'idle' }}, hass),
      holds({{ condition: 'state', entity: 'a.x', state: 'busy' }}, hass),
      holds({{ condition: 'state', entity: 'a.x', state_not: 'idle' }}, hass),
      holds({{ condition: 'numeric_state', entity: 'a.n', above: 2 }}, hass),
      holds({{ condition: 'numeric_state', entity: 'a.n', above: 3 }}, hass),
      holds({{ condition: 'or', conditions: [{{ condition: 'state', entity: 'a.x', state: 'no' }}, {{ condition: 'state', entity: 'a.x', state: 'idle' }}] }}, hass),
      holds({{ condition: 'state', entity: 'a.missing', state: 'idle' }}, hass),
      holds({{ condition: 'screen', media_query: '(min-width: 640px)' }}, hass),
    ]));"""
    out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == [True, False, False, True, False, True, False, True]
