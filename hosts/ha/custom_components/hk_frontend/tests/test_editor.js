// Resolved relative to this file so the suite runs from anywhere.
var DIR = (function(){ var p = HK_ROOT + '/tests/'; return p; })();
load(DIR + 'dom.js');
(function(){ var o=document.createElement.bind(document);
  document.createElement=function(t){var e=o(t);
    if(String(t).toLowerCase()==='hui-card'&&!e.load)e.load=function(){};
    if(String(t).toLowerCase()==='ha-form'){e.computeLabel=null;}
    return e;};})();
// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
// The shim's createElement returns a generic node; a real browser UPGRADES a
// registered custom element synchronously. Emulate that, or the editor's
// `this._form.setConfig(...)` has nothing to call. Harness gap, not a card bug.
(function(){
  var prev=document.createElement.bind(document);
  document.createElement=function(tag){
    var Ctor = customElements.get(String(tag).toLowerCase());
    if (Ctor) { try { return new Ctor(); } catch(e) {} }
    return prev(tag);
  };
})();
var E=customElements.get('hk-camera-mosaic-editor');
var pass=0,fail=0;
function ok(n,c,x){if(c){pass++;print('  PASS  '+n);}else{fail++;print('  FAIL  '+n+(x?'   '+x:''));}}

// LOGIC ONLY. setConfig() calls _build(), which assembles ha-form and a row of
// controls -- the jsc shim has no real custom-element upgrade or event target,
// and patching it far enough to run _build() would be testing the shim rather
// than the editor. _build() is verified in the browser instead; everything
// below is the part worth asserting: what the dropdowns offer, what reorder
// does, and what actually gets emitted.
function ed(cams){
  var e=Object.create(E.prototype);
  e._build=function(){};                 // DOM assembly is a browser concern
  // through Lovelace's entry: the editor reads the client made from it
  e.hass={states:{
    'input_select.cameras':{state:'Front Door',
      attributes:{options:['Front Door','Driveway','Deck']}},
    'camera.a_low':{state:'idle'},'camera.b_low':{state:'idle'},'camera.c_low':{state:'idle'},
    'light.x':{state:'on'}}};
  e._config={selector:'input_select.cameras', cameras:cams||[]};
  e._events=[];
  e.dispatchEvent=function(ev){ e._events.push(ev); if(e._onCfg) e._onCfg(ev); return true; };
  e.addEventListener=function(n,fn){ if(n==='config-changed') e._onCfg=fn; };
  return e;
}

print('=== it only offers cameras and the selector\'s own options ===');
var e=ed();
ok('camera dropdown lists only camera.* entities',
   JSON.stringify(e._cameraEntities())==='["camera.a_low","camera.b_low","camera.c_low"]',
   JSON.stringify(e._cameraEntities()));
ok('option dropdown comes from the selector entity',
   JSON.stringify(e._selectorOptions())==='["Front Door","Driveway","Deck"]',
   JSON.stringify(e._selectorOptions()));
var e2=ed([]); e2.hass={states:{}}; e2._config={cameras:[]};
ok('no selector configured -> empty options, no throw',
   JSON.stringify(e2._selectorOptions())==='[]');

print('\n=== reorder ===');
var cams=[{name:'A',option:'Front Door',entity:'camera.a_low'},
          {name:'B',option:'Driveway',entity:'camera.b_low'},
          {name:'C',option:'Deck',entity:'camera.c_low'}];
var e3=ed(cams.map(function(c){return Object.assign({},c);}));
var emitted=null;
e3.addEventListener('config-changed',function(ev){emitted=ev.detail.config;});
e3._move(0,1);
ok('move down swaps 0 and 1',
   e3._config.cameras.map(function(c){return c.name;}).join('')==='BAC',
   e3._config.cameras.map(function(c){return c.name;}).join(''));
ok('  and it emitted config-changed', emitted && emitted.cameras.length===3);
// the order is BAC now; an out-of-range move must LEAVE IT THERE, not undo
e3._move(0,-1);
ok('move up past the start is a no-op',
   e3._config.cameras.map(function(c){return c.name;}).join('')==='BAC',
   e3._config.cameras.map(function(c){return c.name;}).join(''));
e3._move(2,1);
ok('move down past the end is a no-op',
   e3._config.cameras.map(function(c){return c.name;}).join('')==='BAC',
   e3._config.cameras.map(function(c){return c.name;}).join(''));
e3._move(1,-1);
ok('move up from the middle restores ABC',
   e3._config.cameras.map(function(c){return c.name;}).join('')==='ABC',
   e3._config.cameras.map(function(c){return c.name;}).join(''));

print('\n=== emit hygiene ===');
var e4=ed([{name:'A',option:'Front Door',entity:'camera.a_low'},
           {name:'',option:'',entity:''}]);
var got=null; e4.addEventListener('config-changed',function(ev){got=ev.detail.config;});
e4._emit();
ok('a half-filled row is NOT written to the config',
   got.cameras.length===1 && got.cameras[0].entity==='camera.a_low',
   JSON.stringify(got.cameras));
ok('the selector survives the emit', got.selector==='input_select.cameras');

print('\n=== the card accepts what the editor emits ===');
var C=customElements.get('hk-camera-mosaic-card');
var c=new C(); c.setConfig(got);
c.hass={states:{'input_select.cameras':{state:'Front Door',last_updated:'t'}}};
ok('round-trip: card plans from the editor output', c._plan().live.name==='A');
ok('stub config is valid for the card', (function(){
   var s=C.getStubConfig(); var cc=new C(); cc.setConfig(s);
   cc.hass={states:{}}; return cc._plan()===null; })());


print('\n=== from the card picker, on a dashboard of your own ===');
var st=C.getStubConfig({states:{'camera.a':{},'light.x':{},'camera.b':{},'camera.c':{},'camera.d':{}}});
ok('the stub lists the house\'s first three cameras (an empty list draws nothing)',
   JSON.stringify(st)==='{"cameras":[{"entity":"camera.a"},{"entity":"camera.b"},{"entity":"camera.c"}]}', JSON.stringify(st));
ok('...and the card plans from it: the first live, no selector needed', (function(){
   var cc=new C(); cc.setConfig(st); cc.hass={states:{'camera.a':{},'camera.b':{},'camera.c':{}}};
   var p=cc._plan(); return p && p.live.entity==='camera.a'; })());
// the scalar form's schema (hkEditor holds it under the card's own editor tag)
var form=null;
(function(){
  var me=Object.create(E.prototype); me._config={cameras:[]};
  me.textContent=''; me.appendChild=function(){};
  me.hass={states:{}};
  me._build();
  form=me._form;
})();
var F={};
(function walk(s){(s||[]).forEach(function(f){ if(f.schema) walk(f.schema); else F[f.name]=f; });})(form && form._form ? form._form.schema : []);
ok('Live Camera Follows is not required (none: the first camera is live)', F.selector && !F.selector.required, JSON.stringify(F.selector));
ok('...an input_select or a select', F.selector && JSON.stringify(F.selector.selector.entity.filter.domain)==='["input_select","select"]');
ok('Use These Cameras', F.own_cameras && F.own_cameras.label==='Use These Cameras' && !!F.own_cameras.selector.boolean);
ok('Snapshots Only', F.stills_only && F.stills_only.label==='Snapshots Only' && !!F.stills_only.selector.boolean);

print('\n' + (fail? 'FAILURES: '+fail : 'ALL '+pass+' EDITOR TESTS PASS'));
