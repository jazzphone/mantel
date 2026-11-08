"""Editor placement in both hosts' shared JS, and the bounded Python starter request."""
import json
import subprocess
from pathlib import Path

import pytest
from hk_core.settings import home_grid as HG

ROOT = Path(__file__).resolve().parents[1]
JSC = Path('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc')


def test_editor_placement(tmp_path):
    if not JSC.exists():
        pytest.skip('JavaScriptCore unavailable')
    script = tmp_path / 'editor.js'
    script.write_text('''var window = globalThis;
var HTMLElement = class {};
var customElements = {define: function () {}};
load(''' + json.dumps(str(ROOT / 'web/hk/cards/hk-grid-catalog.js')) + ''');
load(''' + json.dumps(str(ROOT / 'web/hk/panels/hk-grid-editor.js')) + ''');
var E = hkGridEditor, g = {v:1,cols:6,rows:4,frame:[1280,800],band:true,items:[
{id:'a',card:'room',size:'L',at:[0,0]}, {id:'b',card:'room',size:'L',at:[2,0]},
{id:'c',card:'timers',size:'S',at:[5,3]}]};
function check(c, text) { if (!c) throw new Error(text); }
var original = JSON.stringify(g);
check(E.valid(g), 'valid layout');
var swapped = E.place(g,'a',[2,0]);
check(swapped.items[1].at[0] === 0, 'equal size swap');
check(JSON.stringify(g) === original, 'draft is immutable');
check(!E.place(g,'a',[5,0]), 'past edge');
check(!E.place(g,'a',[-1,0]), 'negative');
check(!E.place(g,'a',[4,2]), 'different size collision');
check(!E.place(g,'c',[0,0]), 'small into large');
check(!E.place(g,'a',[0,0],'XL'), 'resize cannot overlap');
check(E.place(g,'a',[0,2]), 'empty move');
check(!E.place(g,'a',[0.5,2]), 'fractional move');
// a drag makes room (2026-10-30; HK Frontend's test_gridroom.js has the rest): a swap still, and a small tile onto a
// Large block sends it to the nearest free place
var room = E.makeRoom(g,'a',[2,0]);
check(room.items[0].at.join() === '2,0' && room.items[1].at.join() === '0,0', 'making room: equal sizes swap');
room = E.makeRoom(g,'c',[0,0]);
check(room && room.items[2].at.join() === '0,0' && room.items[0].at.join() === '4,0' && E.valid(room), 'making room: the Large block moves aside');
check(JSON.stringify(g) === original, 'making room leaves the draft alone');
check(!E.makeRoom(g,'a',[5,0]), 'making room: past the edge');
check(E.firstSpace(g,'W').join() === '4,0', 'first fit');
check(E.add(g,'scene','W').items[3].at.join() === '4,0', 'catalog placement');
check(!E.add(g,'action','L'), 'card does not support class');
check(!E.add(g,'gone','S'), 'unknown card');
check(E.snap(300,250,{left:100,top:50,width:600,height:400},6,4).join() === '2,2', 'snap scaled frame');
check(!E.valid(Object.assign({},g,{cols:3})), 'shrinking keeps blocks in bounds');
check(!E.valid(Object.assign({},g,{frame:[200,800]})), 'frame bounds');
check(!E.valid(Object.assign({},g,{rows:2.5})), 'whole rows');
var full = Object.assign({},g,{items:[]});
for(var y=0;y<4;y++) for(var x=0;x<6;x++) full.items.push({id:'b'+x+'_'+y,card:'timers',size:'S',at:[x,y]});
check(E.firstSpace(full,'S') === null, 'full grid');
check(!E.add(full,'timers','S'), 'item limit');
print('ALL placement checks PASS');
''')
    run = subprocess.run([str(JSC), str(script)], capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr
    assert 'ALL placement checks PASS' in run.stdout


@pytest.mark.parametrize('concept', HG.STARTERS)
def test_editor_starter_request(concept):
    result = HG.starter_request({'concept': concept, 'scenes': ['scene.dinner'], 'rooms': ['kitchen'],
                                 'cameras': ['camera.door'], 'climate': ['climate.hall'], 'tab_bar': False})
    assert HG.check(result) == result
    assert any(i['card'] == 'everything' for i in result['items'])


@pytest.mark.parametrize('data', [None, {}, {'concept': 'B'}, {'concept': 'A', 'rooms': 'kitchen'},
    {'concept': 'A', 'climate': ['light.lamp']}, {'concept': 'A', 'scenes': ['scene.dinner'] * 513},
    {'concept': 'A', 'tab_bar': 'false'}, {'concept': 'A', 'extra': True},
    {'concept': 'A', 'tablet_room': '../invalid'}])
def test_starter_request_refuses_malformed_input(data):
    with pytest.raises(HG.GridInvalid):
        HG.starter_request(data)
