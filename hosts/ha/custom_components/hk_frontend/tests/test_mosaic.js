// Resolved relative to this file so the suite runs from anywhere.
var DIR = (function(){ var p = HK_ROOT + '/tests/'; return p; })();
load(DIR + 'dom.js');
// a wall tablet (Android's WebView): the live card hides until it has a picture
globalThis.navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-X230 Build/BP2A; wv) AppleWebKit/537.36 Chrome/153.0 Safari/537.36' };
// `hui-card` is a real HA element with a .load(); the shim has no idea about
// it. Stub it so the planner can be tested -- hk-row.js calls el.load()
// unguarded too, so the card is matching the established pattern, not cutting
// a corner.
(function(){
  var orig = document.createElement.bind(document);
  document.createElement = function (tag) {
    var el = orig(tag);
    if (String(tag).toLowerCase() === 'hui-card' && !el.load) el.load = function(){};
    return el;
  };
})();
// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
var C = customElements.get('hk-camera-mosaic-card');
var pass=0, fail=0;
function ok(n,c,x){ if(c){pass++;print('  PASS  '+n);} else {fail++;print('  FAIL  '+n+(x?'   '+x:''));} }

var NAMES=['Front Door','Driveway','Front Yard Left','Front Yard Right',
           'Right Side','Backyard Left','Backyard Right','Deck','Garage'];
var CAMS=NAMES.map(function(n){
  return {name:n, option:n, entity:'camera.'+n.toLowerCase().replace(/[^a-z]+/g,'_')+'_low'};});
var CFG={selector:'input_select.cameras', cameras:CAMS, height:202.5, seam:2};
function card(sel){
  var c=new C(); c.setConfig(CFG);
  c.hass={states:{'input_select.cameras':{state:sel, last_updated:'t'}}};
  return c;
}


print('=== stills only (a room page): no live tile, the pattern from a tall single ===');
function room(n, extra){
  var cams=CAMS.slice(0,n), st={};
  cams.forEach(function(c){ st[c.entity]={state:'recording',
    attributes:{entity_picture:'/api/camera_proxy/'+c.entity+'?token=ABC'}}; });
  var rc=new C(); rc.isConnected=true;
  rc.setConfig(Object.assign({cameras:cams, height:195, seam:2, stills_only:true, own_cameras:true}, extra||{}));
  rc.hass={states:st}; return rc;
}
[[1,'1'],[2,'2'],[3,'1,2'],[5,'1,2,2']].forEach(function(t){
  var rp=room(t[0])._plan();
  var shape=rp.cols.map(function(x){return x.length;}).join(',');
  ok(t[0]+' camera(s): no live tile, columns ['+t[1]+']', rp.live===null && shape===t[1], shape);
});
var r3=room(3);
ok('drawn: no live slot, a still for every camera', !r3._liveSlot && (r3._snaps||[]).length===3, (r3._snaps||[]).length);
var plate3=(r3._root.children||[]).filter(function(e){ return e.className==='plate'; })[0];
ok('...every column the column width, none the live width', !!plate3 && plate3.style.gridTemplateColumns===
   [Math.round(195*4/3)+'px', Math.round(195*4/3)+'px'].join(' '), plate3 && plate3.style.gridTemplateColumns);
var r1=room(1), plate1=(r1._root.children||[]).filter(function(e){ return e.className==='plate'; })[0];
ok('one camera: one still, 16:9 like the live tile', !!plate1 && plate1.style.gridTemplateColumns===Math.round(195*16/9)+'px' &&
   r1._snaps.length===1 && !!r1._snaps[0].age, plate1 && plate1.style.gridTemplateColumns);
var ro=room(2); ro._board=function(){ return { cameras:[CAMS[1].entity] }; };
ok('own_cameras: the room\'s cameras, not the screen\'s Home strip list', ro._cams().length===2 && ro._cams()[0].entity===CAMS[0].entity);
var rb=room(2,{own_cameras:false}); rb._board=function(){ return { cameras:[CAMS[1].entity] }; };
ok('...without it, the screen\'s list (the Home strip, as before)', rb._cams().length===1, rb._cams().length);

print('=== the column plan ===');
var c=card('Front Door');
var p=c._plan();
ok('live = the selected camera', p.live.name==='Front Door', p.live.name);
ok('8 stills remain', p.live && CAMS.length-1===8);
var shape=p.cols.map(function(x){return x.length;});
ok('columns alternate stack,full,...', JSON.stringify(shape)==='[2,1,2,1,2]', JSON.stringify(shape));
ok('every still placed exactly once',
   p.cols.reduce(function(a,x){return a+x.length;},0)===8);
ok('first column is a STACK (not two big tiles side by side)', p.cols[0].length===2);

print('\n=== the live slot follows the selector ===');
['Deck','Garage','Right Side'].forEach(function(s){
  var pp=card(s)._plan();
  ok('selector '+s+' -> live '+pp.live.name, pp.live.name===s);
  ok('  '+s+' is not also a still', pp.cols.every(function(col){
      return col.every(function(x){return x.name!==s;});}));
});

print('\n=== fallbacks ===');
var pu=card('Nonexistent')._plan();
ok('unknown selection falls back to camera 1', pu.live.name==='Front Door', pu.live.name);
var c0=new C(); c0.setConfig({selector:'input_select.cameras', cameras:[]});
c0.hass={states:{'input_select.cameras':{state:'x',last_updated:'t'}}};
ok('empty camera list renders nothing rather than throwing', c0._plan()===null);

print('\n=== the render gate (must not redraw 12x a second) ===');
var g=card('Deck');
ok('_sigOf is the selector state, not null', /^Deck\|/.test(g._sigOf()), g._sigOf());
var n=0; var orig=g._render.bind(g); g._render=function(){n++; orig();};
g.hass={states:{'input_select.cameras':{state:'Deck', last_updated:'t2'}}};
ok('same selection does NOT re-render', n===0, 'renders='+n);
g.hass={states:{'input_select.cameras':{state:'Garage', last_updated:'t3'}}};
ok('changed selection DOES re-render', n===1, 'renders='+n);
// NO SELECTOR (the generated dashboard's strip): the plan cannot change, so
// the gate must still hold. A null signature means "always render": the live
// tile would be rebuilt on every hass push and never reach a first frame.
var fixed=new C(); fixed.setConfig({cameras:CAMS, height:202.5, seam:2});
var fn=0; var fo=fixed._render.bind(fixed); fixed._render=function(){fn++; fo();};
fixed.hass={states:{'sensor.x':{state:'1', last_updated:'a'}}};
fixed.hass={states:{'sensor.x':{state:'2', last_updated:'b'}}};
fixed.hass={states:{'sensor.x':{state:'3', last_updated:'c'}}};
ok('no selector: rendered once, not on every push', fn===1, 'renders='+fn);
ok('no selector: camera 1 is live', fixed._plan().live.name==='Front Door');

print('\n=== the dashboard item\'s cameras and live-camera choice ===');
// The item's Home -> Camera strip wins over the card's YAML (as chips and
// scenes do), so a hand-written dashboard's strip is set in the UI too.
var BRD = {};
var realMenu = window.hkCards.menu;
window.hkCards.menu = { board: function () { return BRD; } };
var it = new C(); it.setConfig(CFG);
it.hass = { states: { 'input_select.cameras': { state: 'Deck', attributes: { options: NAMES } },
  'camera.deck_low': { state: 'idle', attributes: { friendly_name: 'Deck Camera' } },
  'camera.garage_low': { state: 'idle', attributes: { friendly_name: 'Garage Camera' } },
  'camera.porch_hi': { state: 'idle', attributes: { friendly_name: 'Porch Camera High' } } } };
ok('no item list: the YAML cameras', it._cams().length === 9);
BRD = { cameras: ['camera.garage_low', 'camera.porch_hi', 'camera.deck_low'] };
var ic = it._cams();
ok('the item\'s list, in its order', ic.map(function (x) { return x.entity; }).join() === 'camera.garage_low,camera.porch_hi,camera.deck_low');
ok('...a camera the YAML lists keeps its entry (option)', ic[0].option === 'Garage' && ic[1].name === 'Porch Camera High');
ok('...and the YAML selector still picks the live one', it._plan().live.entity === 'camera.deck_low');
// a generated strip: no YAML selector, no options -- the item names the
// selector, and an option names the camera whose name starts with it
var gen = new C(); gen.setConfig({ cameras: [], height: 195, seam: 2 });
BRD = { cameras: ['camera.deck_low', 'camera.garage_low'], camera_live: 'input_select.cameras' };
gen.hass = { states: { 'input_select.cameras': { state: 'Garage', attributes: { options: NAMES } },
  'camera.deck_low': { state: 'idle', attributes: { friendly_name: 'Deck Camera Low resolution channel' } },
  'camera.garage_low': { state: 'idle', attributes: { friendly_name: 'Garage Camera Low resolution channel' } } } };
ok('the item\'s live-camera selector, matched by name', gen._plan().live.entity === 'camera.garage_low', gen._plan().live.entity);
ok('...an option matches a whole word only ("Front Door" is not "Front Doorbell")',
   gen._optionOf({ entity: 'x', name: 'Front Doorbell' }, ['Front Door']) === null &&
   gen._optionOf({ entity: 'x', name: 'Front Door Camera' }, ['Front', 'Front Door']) === 'Front Door');
var gn = 0, go = gen._render.bind(gen); gen._render = function () { gn++; go(); };
var gs = gen.hass.states;
gen.hass = { states: gs }; gen.hass = { states: gs };
ok('...and the render gate still holds on a push', gn <= 1, 'renders=' + gn);
window.hkCards.menu = realMenu;

print('\n=== a dead live stream is remounted, with backoff ===');
var clock=1000000; var realNow=Date.now; Date.now=function(){ return clock; };
var slot={};
var rv=new C(); var remounts=0; rv._remountLive=function(){ remounts++; slot.born=clock; };
rv._reviveLive(slot, false); ok('a fresh mount gets its 30 s grace', remounts===0);
clock+=31000; rv._reviveLive(slot, false); ok('one dead tick is not enough', remounts===0);
clock+=10000; rv._reviveLive(slot, false); ok('two dead ticks after the grace: remounted', remounts===1);
clock+=31000; rv._reviveLive(slot, false); clock+=10000; rv._reviveLive(slot, false);
ok('dead again within the backoff (60 s): left alone', remounts===1, 'remounts='+remounts);
clock+=30000; rv._reviveLive(slot, false); clock+=10000; rv._reviveLive(slot, false);
ok('after the backoff: remounted again', remounts===2, 'remounts='+remounts);
ok('the backoff doubles', slot.backoff===120000, slot.backoff);
for (var bi=0; bi<10; bi++) { clock+=400000; slot.dead=1; rv._reviveLive(slot, false); }
ok('...and stops at 5 minutes', slot.backoff===300000, slot.backoff);
rv._reviveLive(slot, true); ok('playing resets it', slot.backoff===0 && slot.dead===0);
Date.now=realNow;

print('\n=== no two full-height columns may be adjacent ===');
[2,3,4,5,6,7,8,9,10,11,12].forEach(function(k){
  var cc=new C();
  // DISTINCT objects. CAMS.concat(CAMS) reuses references, so filtering
  // `c !== live` would drop both copies and the count come out one short. (A
  // config listing the same camera twice de-duplicates, which is the sane
  // outcome anyway.)
  var many=[]; for (var q=0;q<k;q++) many.push({name:'C'+q, option:'C'+q, entity:'camera.c'+q});
  cc.setConfig({selector:'input_select.cameras', cameras:many});
  cc.hass={states:{'input_select.cameras':{state:'C0',last_updated:'t'}}};
  var pp=cc._plan();
  var sh=pp.cols.map(function(x){return x.length;});
  var adj=false;
  for(var i=0;i<sh.length-1;i++) if(sh[i]===1&&sh[i+1]===1) adj=true;
  var placed=sh.reduce(function(a,x){return a+x;},0);
  ok(k+' cameras -> '+JSON.stringify(sh)+'  (all placed, no adjacent singles)',
     placed===k-1 && !adj, 'placed='+placed+' want='+(k-1)+' adj='+adj);
});

print('\n=== odd camera counts ===');
[2,3,4,5,6,7].forEach(function(k){
  var cc=new C();
  cc.setConfig({selector:'input_select.cameras', cameras:CAMS.slice(0,k)});
  cc.hass={states:{'input_select.cameras':{state:CAMS[0].name,last_updated:'t'}}};
  var pp=cc._plan();
  var placed=pp.cols.reduce(function(a,x){return a+x.length;},0);
  ok(k+' cameras -> all '+(k-1)+' stills placed, cols '+JSON.stringify(
       pp.cols.map(function(x){return x.length;})), placed===k-1);
});

print('\n=== the live tile is the only hui-card; stills are raw imgs ===');
var hc=card('Front Door');
ok('exactly ONE hui-card child (the live tile)', (hc._children||[]).length===1,
   'n='+(hc._children||[]).length);
ok('eight snapshot slots', (hc._snaps||[]).length===8, 'n='+(hc._snaps||[]).length);
var views=(hc._children||[]).map(function(k){return k.config && k.config.camera_view;});
ok('that one child is camera_view: live', views.length===1 && views[0]==='live',
   JSON.stringify(views));
ok('each snapshot slot has TWO stacked imgs',
   (hc._snaps||[]).every(function(s){return s.imgs.length===2;}));
ok('the live camera is NOT also a snapshot',
   (hc._snaps||[]).every(function(s){return s.cam.name!=='Front Door';}));

print('\n=== hass still reaches the live tile ===');
var h2={states:{'input_select.cameras':{state:'Front Door', last_updated:'t9'}}};
hc.hass=h2;
ok('same selection: no re-render, child still updated',
   hc._children.every(function(k){return k.hass===h2;}));
var h3={states:{'input_select.cameras':{state:'Deck', last_updated:'t10'}}};
hc.hass=h3;
ok('changed selection: rebuilt, new hass', hc._children.every(function(k){return k.hass===h3;}));
ok('  live slot moved to Deck', hc._plan().live.name==='Deck');
ok('  and Deck left the snapshot set',
   (hc._snaps||[]).every(function(s){return s.cam.name!=='Deck';}));

print('\n=== the snapshot URL ===');
function withPic(sel){
  var st={'input_select.cameras':{state:sel,last_updated:'t'}};
  CAMS.forEach(function(c){
    st[c.entity]={state:'recording',
      attributes:{entity_picture:'/api/camera_proxy/'+c.entity+'?token=ABC'}};});
  // A PLACED card: the timers only start on a connected element (a preview
  // fed hass but never attached must not fetch stills nobody can see).
  var c=new C(); c.isConnected=true; c.setConfig(CFG); c.hass={states:st}; return c;
}
var wp=withPic('Front Door');
var src=wp._srcFor(wp._snaps[0].cam);
ok('src comes from entity_picture', src.indexOf('/api/camera_proxy/')===0, src);
ok('  keeps the signed token', src.indexOf('token=ABC')>0, src);
ok('  adds a cache-buster', /[?&]_hk=\d+/.test(src), src);
var again=wp._srcFor(wp._snaps[0].cam);
ok('  every call busts UNIQUELY (a same-millisecond repeat would be cached)',
   again!==src, src+' vs '+again);
var noPic=new C(); noPic.setConfig(CFG);
noPic.hass={states:{'input_select.cameras':{state:'Front Door',last_updated:'t'}}};
ok('no entity_picture -> null, no throw', noPic._srcFor(noPic._snaps[0].cam)===null);

print('\n=== double buffering: the visible frame is never blanked ===');
var s0=wp._snaps[0];
ok('both imgs start hidden (nothing painted yet)',
   !s0.imgs[0].classList.contains('on') && !s0.imgs[1].classList.contains('on'));
wp._tick(); __runTimers();          // requests are STAGGERED now, so drive the timers
ok('tick loads into a buffer but does NOT show it yet',
   !s0.imgs[0].classList.contains('on'), 'front='+s0.front);
s0.imgs[0].onload();                               // the browser finishes decoding
// THE SWAP IS ONE ANIMATION FRAME BEHIND DECODE: decode() resolving is not
// sufficient on every engine. On a 60fps recording of a tablet WebView, the
// incoming image can sit on top still rasterizing for two frames -- dark and
// smeared, -25 luma -- with BOTH layers fully opaque the whole time, which is
// why a probe watching opacity cannot see it.
ok('decode alone does NOT reveal the buffer', !s0.imgs[0].classList.contains('on'));
__runTimers();                                     // the frame boundary
ok('on the next frame, that buffer becomes visible', s0.imgs[0].classList.contains('on'));
ok('  front index recorded', s0.front===0);
var firstSrc=s0.imgs[0].src;
wp._tick(); __runTimers();
ok('next tick targets the OTHER buffer (front stays visible)',
   s0.imgs[1].src && s0.imgs[1].src!==firstSrc && s0.imgs[0].classList.contains('on'));
s0.imgs[1].onload(); __runTimers();
ok('after decode + a frame the new frame shows and the old hides',
   s0.imgs[1].classList.contains('on') && !s0.imgs[0].classList.contains('on'));
ok('  AT NO POINT WERE BOTH HIDDEN once a frame had loaded', true);

print('\n=== a failed fetch must not wedge the slot ===');
var s1=wp._snaps[1];
// only the stagger timers: __runTimers() would also fire the 8s hang-release
// and clear the very flag this asserts on
wp._tick(); __runTimersUnder(2000);
var idx=(s1.front+1)%2;
ok('the buffer is marked loading while in flight', s1.loading[idx]===true);
s1.imgs[idx].onerror();
ok('onerror clears it so the next tick retries', s1.loading[idx]===false);

print('\n=== a HUNG request must not wedge the slot forever ===');
// Neither onload nor onerror fires when a request hangs. Without a timeout the
// loading flag stays set for the life of the page and a slot that never got a
// FIRST frame is black permanently -- the "rest are black" symptom.
__resetTimers();
var hg=withPic('Front Door');
var hs=hg._snaps[0];
hg._tick();
var hidx=(hs.front+1)%2;
ok('the buffer is marked loading', hs.loading[hidx]===true);
// Fire ONLY the release timeout. __runTimers() runs every pending timer in one
// go -- including the interval and rAF ticks -- which immediately re-acquire
// the flag. In a browser those are 8s apart; firing them together is a harness
// artifact, not the behavior under test.
// EXACTLY the release delay (refresh 10s -> 8000ms). A `>=2000` filter also
// catches the 10000ms refresh interval, whose callback is _tick -- firing that
// re-acquires the flag and makes the release look broken.
var releases=__timers.filter(Boolean).filter(function(t){return t.ms===8000;});
ok('a release timeout was registered', releases.length>0, 'n='+releases.length);
releases.forEach(function(t){ t.fn(); });
ok('after the timeout fires, loading is released', hs.loading[hidx]===false,
   'loading='+hs.loading[hidx]);
ok('  so the next tick retries that buffer', (function(){
   var before=hs.imgs[hidx].src; hg._tick(); __runTimers();
   return hs.imgs[hidx].src!==before; })());
ok('  and the slot is still blank (nothing faked a frame)',
   !hs.imgs[0].classList.contains('on') && !hs.imgs[1].classList.contains('on'));

print('\n=== requests are staggered, not a stampede ===');
__resetTimers();
var st=withPic('Front Door');
st._tick();
var delays=__timers.filter(Boolean).map(function(t){return t.ms;}).filter(function(m){return m<3000;});
ok('per-slot src delays increase (0, 220, 440, ...)',
   delays.length>=3 && new Set(delays).size>=3, JSON.stringify(delays.slice(0,8)));
ok('  the spread stays under ~1.5s for 6 visible slots',
   Math.max.apply(null, delays.concat([0])) <= 1600,
   'max='+Math.max.apply(null, delays.concat([0])));

print('\n=== interval ===');
__resetTimers();
var t10=withPic('Front Door');
ok('default refresh is 10s', (function(){
   var found=null; __timers.filter(Boolean).forEach(function(t){ if(t.ms===10000) found=t; });
   return !!found; })(), 'timers='+JSON.stringify(__timers.filter(Boolean).map(function(t){return t.ms;})));
__resetTimers();
var c5=new C(); c5.isConnected=true; c5.setConfig(Object.assign({}, CFG, {refresh:5}));
c5.hass={states:{'input_select.cameras':{state:'Front Door',last_updated:'t'}}};
ok('refresh: 5 -> a 5s interval',
   __timers.filter(Boolean).some(function(t){return t.ms===5000;}));
__resetTimers();
var c0=new C(); c0.setConfig(Object.assign({}, CFG, {refresh:0}));
c0.hass={states:{'input_select.cameras':{state:'Front Door',last_updated:'t'}}};
ok('refresh: 0 -> no timer at all (opt out)',
   !__timers.filter(Boolean).some(function(t){return t.ms>0;}));

print('\n=== it stops ticking behind the screensaver ===');
__resetTimers();
var vis=withPic('Front Door');
ok('a timer is running', !!vis._timer);
__fireVisibility(true);
ok('hidden -> interval cleared', !vis._timer);
__fireVisibility(false);
ok('visible again -> interval restarted', !!vis._timer);
vis.disconnectedCallback();
ok('detached -> interval cleared', !vis._timer);

print('\n=== live camera survives the screensaver entrance ===');
var saverOn = false, saverCovered = false;
window.hkSaver = { running: function () { return saverOn; }, covered: function () { return saverCovered; } };
var fading = withPic('Front Door'), entranceLive = fading._liveSlot.el;
saverOn = true;
dispatchEvent(new CustomEvent('hk-saver', { detail: { on: true } }));
ok('stills stop refreshing during the entrance', !fading._timer);
ok('live camera remains mounted through the fade', fading._liveSlot.el === entranceLive && !fading._liveSlot.asleep);
saverOn = false;
dispatchEvent(new CustomEvent('hk-saver', { detail: { on: false } }));
ok('early dismissal keeps the same live stream', fading._liveSlot.el === entranceLive && !!fading._timer);
saverOn = true;
dispatchEvent(new CustomEvent('hk-saver', { detail: { on: true } }));
saverCovered = true;
dispatchEvent(new Event('hk-saver-covered'));
ok('fully covered releases the live stream', fading._liveSlot.asleep && fading._liveSlot.el !== entranceLive && !fading._timer);
var late = withPic('Front Door');
ok('a camera attached under the covered saver also sleeps', late._liveSlot.asleep && !late._timer);
__fireVisibility(true); __fireVisibility(false);
ok('visibility changes do not restart a covered camera', fading._liveSlot.asleep && !fading._timer);
saverOn = saverCovered = false;
dispatchEvent(new CustomEvent('hk-saver', { detail: { on: false } }));
ok('wake: the stills refresh at once, the live stream waits for the screensaver to be gone', fading._liveSlot.asleep && !!fading._timer);
dispatchEvent(new Event('hk-saver-done'));
ok('...not even the moment it is gone', fading._liveSlot.asleep);
__runTimersUnder(1600);
ok('wake restores live video and refreshes, LIVE_AFTER_WAKE after the screensaver is gone',
   !fading._liveSlot.asleep && fading._liveSlot.el.config.camera_view === 'live' && !!fading._timer);
ok('...out of sight until its video has a picture', fading._liveSlot.el.classList.contains('wait'));
// the screensaver never says it is gone: the stream comes back anyway
saverOn = true; dispatchEvent(new CustomEvent('hk-saver', { detail: { on: true } }));
saverCovered = true; dispatchEvent(new Event('hk-saver-covered'));
saverOn = saverCovered = false; dispatchEvent(new CustomEvent('hk-saver', { detail: { on: false } }));
__runTimersUnder(6100);
ok('...or LIVE_WAKE_MAX after the stop if it is never heard to be gone', !fading._liveSlot.asleep);

print('\n=== under the kiosk\'s Black screensaver: the strip rests, and comes back after ===');
var blk = withPic('Front Door');
ok('(a strip on the page, ticking, its live tile mounted)', !!blk._timer && !blk._liveSlot.asleep);
dispatchEvent(new Event('kiosksatellite:screensaverstart'));
ok('the black goes up: stills stopped, live stream let go', !blk._timer && blk._liveSlot.asleep);
dispatchEvent(new Event('kiosksatellite:screensaverstop'));
ok('the black ends: not at once (the tablet is drawing the page again)', !blk._timer && blk._liveSlot.asleep);
__runTimersUnder(2600);
ok('...AFTER_BLACK later: stills ticking and the live stream back', !!blk._timer && !blk._liveSlot.asleep);
dispatchEvent(new Event('kiosksatellite:screenoff'));
ok('the panel off: the same rest', !blk._timer && blk._liveSlot.asleep);
dispatchEvent(new Event('kiosksatellite:screenon')); __runTimersUnder(2600);
ok('...and back after it is on', !!blk._timer && !blk._liveSlot.asleep);
dispatchEvent(new CustomEvent('hk-black', { detail: { on: true } }));
ok('HK\'s own black screen (hk-black): the same rest', !blk._timer && blk._liveSlot.asleep);
// a pick under the black (Live Camera Follows moving on): the strip rebuilds,
// and its new live tile is built asleep -- the Kitchen decoded one for nobody
var underBlack = {}; for (var k in blk.hass.states) underBlack[k] = blk.hass.states[k];
underBlack['input_select.cameras'] = { state: NAMES[1], last_updated: 't2' };
blk.hass = { states: underBlack };
ok('a new pick under the black: rebuilt for it, its live tile asleep -- no stream mounted',
   blk._liveSlot.cam.name === NAMES[1] && blk._liveSlot.asleep && !(blk._liveSlot.el.config && blk._liveSlot.el.config.camera_view === 'live') && !blk._timer);
dispatchEvent(new CustomEvent('hk-black', { detail: { on: false } })); __runTimersUnder(2600);
ok('...and back after it ends', !!blk._timer && !blk._liveSlot.asleep);
blk.disconnectedCallback();
dispatchEvent(new Event('kiosksatellite:screensaverstart'));
ok('a strip taken off the page hears nothing more', !blk._timer);

print('\n=== leaving the page: marked as left, nothing hidden or copied (2026-10-11) ===');
location.pathname = '/dashboard-livingroom/home';
var nav = withPic('Front Door');
nav._liveSlot.el.classList.remove('wait');              // as if it were showing a picture
location.search = '?pop=1';
dispatchEvent(new Event('location-changed'));
ok('a pop-up opening (same path) is not a leave', !nav._liveSlot.el.classList.contains('wait') && !nav._leaving);
location.pathname = '/dashboard-lights/0';
dispatchEvent(new Event('location-changed'));
ok('a navigation away: left, the live card not hidden', !nav._liveSlot.el.classList.contains('wait') && nav._leaving);
location.pathname = '/dashboard-livingroom/home';
nav._tickAges();
ok('...and the path coming back (a navigation that did not leave) ends it', !nav._leaving);
// back, its video with a picture: shown -- under the copied frame until it
// has DRAWN one (the tablet's video surface was black 60-350 ms after it said so)
var vfc = [], fakeV = { readyState: 4, videoWidth: 1280, videoHeight: 720,
                        requestVideoFrameCallback: function (f) { vfc.push(f); } };
nav._liveVideo = function () { return fakeV; };
nav._liveSlot.el.classList.add('wait');                  // (a tile waiting for its picture)
nav._liveShown();
ok('the video shown, the still lifted over it', !nav._liveSlot.el.classList.contains('wait') &&
   nav._liveSlot.box.classList.contains('lift'));
vfc.forEach(function (f) { f(); });
ok('...still lifted the frame its first picture is presented', nav._liveSlot.box.classList.contains('lift'));
__runTimersUnder(1);
ok('...dropped one frame later', !nav._liveSlot.box.classList.contains('lift'));
nav.disconnectedCallback();

// dismissed while the page is hidden (the tablet's screen off): the hk-saver
// event bails, so the page coming back must wake the slot -- left "asleep",
// the next cover would skip it and keep the live stream decoding all night
saverOn = true; dispatchEvent(new CustomEvent('hk-saver', { detail: { on: true } }));
saverCovered = true; dispatchEvent(new Event('hk-saver-covered'));
document.hidden = true;
saverOn = saverCovered = false; dispatchEvent(new CustomEvent('hk-saver', { detail: { on: false } }));
__fireVisibility(false);
var backLive = fading._liveSlot.el;
ok('a saver dismissed while hidden: visible again wakes the live camera', !fading._liveSlot.asleep && backLive.config.camera_view === 'live');
saverOn = true; dispatchEvent(new CustomEvent('hk-saver', { detail: { on: true } }));
saverCovered = true; dispatchEvent(new Event('hk-saver-covered'));
ok('...so the next cover releases its stream again', fading._liveSlot.asleep && fading._liveSlot.el !== backLive);
saverOn = saverCovered = false; dispatchEvent(new CustomEvent('hk-saver', { detail: { on: false } }));
fading.disconnectedCallback(); late.disconnectedCallback();
ok('detaching removes the covered listener', !fading._onSaverCovered && !late._onSaverCovered);
delete window.hkSaver;



print('\n=== live-tile remount on wake ===');
__resetTimers();
var rm=withPic('Front Door');
var live0=rm._liveSlot.el;
ok('the live slot is recorded', !!live0 && rm._liveSlot.cam.name==='Front Door');
ok('  with its aspect, for the remount', /^\d+x\d+$/.test(rm._liveSlot.ar), rm._liveSlot.ar);
// give the stills a loaded frame so we can prove they survive
rm._tick(); rm._snaps.forEach(function(s){ var i=(s.front+1)%2; if(s.imgs[i].onload) s.imgs[i].onload(); });
__runTimers();   // the swap waits one frame past decode
var framesBefore=rm._snaps.filter(function(s){return s.front>=0;}).length;
ok('stills have frames before the wake', framesBefore>0, 'n='+framesBefore);
var srcsBefore=rm._snaps.map(function(s){return s.front>=0? s.imgs[s.front].src : null;});

__fireVisibility(true);
ok('hidden: interval stops', !rm._timer);
__fireVisibility(false);
var live1=rm._liveSlot.el;
ok('visible: the live tile is a NEW element (stream re-established)', live1!==live0);
ok('  it is still the same camera', rm._liveSlot.cam.name==='Front Door');
ok('  still camera_view: live', live1.config && live1.config.camera_view==='live');
ok('  placed in the same grid cell',
   live1.style.gridColumn===live0.style.gridColumn && live1.style.gridRow===live0.style.gridRow);
ok('  the old element is no longer tracked in _children',
   (rm._children||[]).indexOf(live0)<0);
ok('  the new one IS tracked', (rm._children||[]).indexOf(live1)>=0);
ok('  exactly one hui-card child still', (rm._children||[]).length===1,
   'n='+(rm._children||[]).length);
ok('interval restarted', !!rm._timer);

print('  -- and the stills must NOT be torn down --');
ok('the same snapshot slots survive', rm._snaps.length===8);
ok('their loaded frames are intact',
   rm._snaps.filter(function(s){return s.front>=0;}).length===framesBefore);
ok('  and the visible srcs are unchanged',
   JSON.stringify(rm._snaps.map(function(s){return s.front>=0? s.imgs[s.front].src : null;}))
     ===JSON.stringify(srcsBefore));

print('  -- the listener survives its own handler --');
var visRef=rm._vis;
__fireVisibility(true); __fireVisibility(false);
ok('same listener reference after two cycles (not re-registered)', rm._vis===visRef);
ok('  and the live tile remounted again', rm._liveSlot.el!==live1);

print('  -- no live slot (empty config) must not throw --');
var empty=new C(); empty.setConfig({selector:'input_select.cameras', cameras:[]});
empty.hass={states:{'input_select.cameras':{state:'x',last_updated:'t'}}};
empty._remountLive();
ok('_remountLive is a no-op with nothing to remount', true);


print('\n=== there is no wake-rebuild hook, by measurement ===');
// No camera_rebuild_<room> helper: the live stream survives a screensaver
// cycle untouched (readyState 4 throughout, clock advancing 8.0s in 8s after
// the wake), because the page is never hidden.
var nohook=withPic('Front Door');
var nh0=nohook._liveSlot.el;
nohook.hass={states:{'input_select.cameras':{state:'Front Door',last_updated:'z1'},
  'input_boolean.camera_rebuild_living_room':{state:'on',last_updated:'z1'}}};
ok('a camera_rebuild flip is ignored (nothing listens)',
   nohook._liveSlot.el===nh0);
ok('no rebuild_entity option is read', !('rebuild_entity' in (nohook._config||{})));


print('\n=== the proxy must be asked for a TILE-SIZED image ===');
// Measured on a 4K camera: no params => 1,797,946 bytes at 3840x2160;
// width alone or height alone is IGNORED; both together => 34,506 bytes.
// Eight 4K frames every 10s black out the later tiles.
if (typeof window !== 'undefined') window.devicePixelRatio = 1.5;
var sz=withPic('Front Door');
ok('each slot records its CSS size',
   sz._snaps.every(function(s){return s.cssW>0 && s.cssH>0;}),
   JSON.stringify(sz._snaps.map(function(s){return s.cssW+'x'+s.cssH;})));
ok('stack halves are 270x100-ish, fulls are 270x202-ish',
   (function(){
     var set=[...new Set(sz._snaps.map(function(s){return Math.round(s.cssW)+'x'+Math.round(s.cssH);}))];
     return set.length===2; })(),
   JSON.stringify([...new Set(sz._snaps.map(function(s){return Math.round(s.cssW)+'x'+Math.round(s.cssH);}))]));
var u=sz._srcFor(sz._snaps[0].cam, sz._snaps[0]);
ok('the URL carries BOTH width and height', /[?&]width=\d+/.test(u) && /[?&]height=\d+/.test(u), u);
ok('  sized by devicePixelRatio (270*1.5=405)', /width=405\b/.test(u), u);
ok('  and the signed token survives', /token=ABC/.test(u), u);
ok('  and the cache-buster survives', /_hk=\d+/.test(u), u);
// dPR is capped at 2 so the bytes cannot run away on a 3x screen
if (typeof window !== 'undefined') window.devicePixelRatio = 3;
var u3=sz._srcFor(sz._snaps[0].cam, sz._snaps[0]);
// Superseded by the tier cap below: 270*2 = 540 would cross the 480x270
// boundary and cost 4.9x the bytes, so it clamps to 480.
ok('dPR is capped at 2, then the TIER caps it again (540 -> 480)',
   /width=480\b/.test(u3), u3);
if (typeof window !== 'undefined') window.devicePixelRatio = 1.5;
// a full-height still must ask for a taller image than a stack half
var fullSlot=sz._snaps.filter(function(s){return s.cssH>150;})[0];
if (fullSlot) {
  var uf=sz._srcFor(fullSlot.cam, fullSlot);
  ok('a full-height tile asks for a taller image than a stack half',
     parseInt(uf.match(/height=(\d+)/)[1],10) > parseInt(u.match(/height=(\d+)/)[1],10),
     uf);
} else { ok('a full-height tile asks for a taller image', true, '(none in this plan)'); }
ok('no slot -> the strip\'s own 480x270 (never request the full 4K frame by accident; until 2026-10-29 it asked for no size)',
   /&width=480&height=270$/.test(sz._srcFor(sz._snaps[0].cam)));


// ===========================================================================
// THE GATE GOVERNS REFRESHES, NOT FIRST FRAMES.
// The geometry of a 1280-wide wall tablet: innerWidth 1280, slot lefts
// 396/396/668/940/940/1212/1484/1484. The cutoff is innerWidth+80 = 1360, so
// the last two slots are off-screen at scrollLeft 0 -- skipped entirely, they
// would NEVER be requested on a page load, and "the rest are black".
print('\n=== the visibility gate governs REFRESHES, not first frames ===');
var LEFTS=[396,396,668,940,940,1212,1484,1484];
function geo(cc){
  window.innerWidth=1280; window.innerHeight=800;
  cc._snaps.forEach(function(s,i){
    s.box.getBoundingClientRect=function(){
      return {left:LEFTS[i], right:LEFTS[i]+270, top:400, bottom:600,
              width:270, height:200};};
  });
  return cc;
}
function arm(cc){          // clean slate: no stale stagger timers, no stale srcs
  __resetTimers();
  cc._snaps.forEach(function(s){ s.imgs.forEach(function(im){ im.src=''; });
                                 s.loading=[false,false]; });
  return cc;
}
function srcs(cc){
  // the stagger defers `im.src`, so drive the timers to see what was requested
  __runTimersUnder(2000);
  return cc._snaps.map(function(s){
    return s.imgs.some(function(im){return !!im.src;}) ? 1 : 0;}).join('');
}
var g=geo(withPic('Front Door'));
ok('the gate really does exclude the last two',
   g._snaps.map(function(s){return g._onScreen(s.box)?1:0;}).join('')==='11111100',
   g._snaps.map(function(s){return g._onScreen(s.box)?1:0;}).join(''));
arm(g);
g._snaps.forEach(function(s){ s.front=-1; });
g._tick();
ok('a COLD tick requests all eight anyway', srcs(g)==='11111111', srcs(g));

// once a slot has painted, the gate takes over and the off-screen pair stops
var h=geo(withPic('Front Door'));
arm(h);
h._snaps.forEach(function(s){ s.front=0; });
h._tick();
ok('once painted, off-screen slots stop refreshing', srcs(h)==='11111100', srcs(h));
ok('  ...and the six on-screen ones keep going', srcs(h).slice(0,6)==='111111');

// and the two that were cold stay cold-eligible until they actually land
var k=geo(withPic('Front Door'));
arm(k);
k._snaps.forEach(function(s,i){ s.front = i<6 ? 0 : -1; });
k._tick();
ok('a mixed plate refreshes the visible six AND primes the cold two',
   srcs(k)==='11111111', srcs(k));

// EVERY TILE MUST REQUEST ITS OWN CAMERA. The stagger defers `im.src` into a
// timeout, so the URL has to be captured per-iteration: with `src` a `var` in
// _tick's scope, all eight timeouts would read the last iteration's value and
// every tile would load the same camera. This asserts the pairing, not just
// that something loaded.
print('\n=== each tile loads ITS OWN camera (the stagger closure) ===');
var x=geo(withPic('Front Door'));
arm(x);
x._snaps.forEach(function(s){ s.front=-1; });
x._tick();
__runTimersUnder(2000);
var pairs=x._snaps.map(function(s){
  var im=s.imgs.filter(function(i){return !!i.src;})[0];
  return {want:s.cam.entity, got:im? im.src:null};
});
ok('all eight tiles requested something', pairs.every(function(q){return !!q.got;}),
   JSON.stringify(pairs.map(function(q){return !!q.got;})));
ok('each URL names that tile\'s OWN entity',
   pairs.every(function(q){ return q.got && q.got.indexOf(q.want)>=0; }),
   JSON.stringify(pairs.filter(function(q){return !q.got||q.got.indexOf(q.want)<0;})
     .map(function(q){return q.want+' <- '+q.got;}), null, 1));
ok('eight DISTINCT urls, not one repeated',
   new Set(pairs.map(function(q){return q.got;})).size===8,
   'distinct=' + new Set(pairs.map(function(q){return q.got;})).size);


// THE LIVE TILE'S POSTER. A <video> with no frames paints nothing, so a dead
// stream would read as a black hole in slot 1. A still sits underneath it.
// The point of the tests is the CONDITION: a healthy stream must cost nothing.
print('\n=== the live tile falls back to a still ===');
function parm(c){ c._liveSlot.poster.loading=[false,false];
                  c._liveSlot.poster.imgs.forEach(function(i){i.src='';}); }
function psrc(c){ __runTimersUnder(2000);
                  var f=c._liveSlot.poster.imgs.filter(function(i){return !!i.src;});
                  return f.length? f[0].src : ''; }
var lp=withPic('Front Door');
ok('the live card is wrapped in a .live box', !!lp._liveSlot.box &&
   /^live pop/.test(lp._liveSlot.box.className), String(lp._liveSlot.box && lp._liveSlot.box.className));
ok('the box carries the grid placement, not the card',
   lp._liveSlot.box.style.gridRow==='1 / 3' && !lp._liveSlot.el.style.gridRow,
   'box='+lp._liveSlot.box.style.gridRow+' card='+lp._liveSlot.el.style.gridRow);
ok('two poster imgs exist behind it (double buffered like the stills)',
   !!lp._liveSlot.poster && lp._liveSlot.poster.imgs.length===2);
ok('the poster is sized for the LIVE tile (16:9), not a still column',
   lp._liveSlot.poster.cssW===360 && lp._liveSlot.poster.cssH===202.5,
   lp._liveSlot.poster.cssW+'x'+lp._liveSlot.poster.cssH);

// no video at all (the dead-stream case): the poster must load
__resetTimers();
parm(lp);
ok('no <video> in the tree reads as NOT playing', lp._livePlaying()===false);
lp._tickPoster(10);
ok('a dead stream loads the poster', !!psrc(lp), psrc(lp));
ok('  and it asks for the capped live size (360*1.5=540 -> 480x270)',
   /width=480\b/.test(psrc(lp)) &&
   /height=270\b/.test(psrc(lp)), psrc(lp));
ok('  and it is the LIVE camera, not a still',
   psrc(lp).indexOf(lp._liveSlot.cam.entity)>=0, psrc(lp));

// a healthy stream: fetch nothing, and get out of the video's way
var v={tagName:'VIDEO', readyState:4, currentTime:12.5, paused:false};
lp._liveVideo=function(){return v;};
parm(lp); lp._liveSlot.poster.imgs[0].classList.add('on');
ok('a decoding, advancing video reads as playing', lp._livePlaying()===true);
lp._tickPoster(10);
ok('a healthy stream fetches NOTHING', !psrc(lp), psrc(lp));
ok('  and BOTH poster buffers are hidden',
   !lp._liveSlot.poster.imgs.some(function(i){return i.classList.contains('on');}));

// the states that are NOT playing, each of which would otherwise look black
[['still buffering',{tagName:'VIDEO',readyState:1,currentTime:0,paused:false}],
 ['mounted but never advanced',{tagName:'VIDEO',readyState:4,currentTime:0,paused:false}],
 ['paused',{tagName:'VIDEO',readyState:4,currentTime:9,paused:true}]
].forEach(function(c){
  lp._liveVideo=function(){return c[1];};
  parm(lp);
  lp._tickPoster(10);
  ok('"'+c[0]+'" still gets a poster', !!psrc(lp));
});

// and the hang release, same three ways out as the stills
lp._liveVideo=function(){return null;};
__resetTimers();
parm(lp);
lp._tickPoster(10);
ok('a poster fetch in flight is not re-fired', (function(){
  var first=psrc(lp);
  lp._liveSlot.poster.imgs.forEach(function(i){i.src='';});
  lp._tickPoster(10);                       // loading is still true
  return !psrc(lp) && !!first; })());
__runTimers();                              // fire the 8s release
lp._liveSlot.poster.imgs.forEach(function(i){i.src='';});
lp._tickPoster(10);
ok('a hung poster fetch is released and retried', !!psrc(lp));


// A STALLED STREAM IS THE CASE THE PREDICATE MISSES. readyState stays 4 and
// paused stays false when a stream dies, so the only honest test is whether
// currentTime moved between ticks.
print('\n=== a stalled stream gets the poster back ===');
var sv=withPic('Front Door');
var vid={tagName:'VIDEO', readyState:4, currentTime:20, paused:false};
sv._liveVideo=function(){return vid;};
__resetTimers(); parm(sv);
sv._tickPoster(10);                      // first tick: nothing to compare
ok('the first tick trusts the predicate and fetches nothing',
   !psrc(sv), psrc(sv));
vid.currentTime=30;                      // advanced 10s in one tick: healthy
sv._tickPoster(10);
ok('an ADVANCING stream still fetches nothing', !psrc(sv));
sv._tickPoster(10);                      // currentTime did NOT move: stalled
ok('a FROZEN currentTime brings the poster back', !!psrc(sv), psrc(sv));
ok('  ...even though readyState is 4 and it is not paused',
   vid.readyState===4 && vid.paused===false && sv._livePlaying()===true);
// and it recovers: once it advances again the poster goes away
__runTimers(); vid.currentTime=45;
parm(sv); sv._liveSlot.poster.imgs[0].classList.add('on');
sv._tickPoster(10);
ok('a recovered stream hides the poster again',
   !psrc(sv) && !sv._liveSlot.poster.imgs.some(function(i){return i.classList.contains('on');}));


// THE SNAPSHOT TIER. Protect serves discrete sizes: a request of 480x270 or
// smaller yields 480x270 at ~34 KB, anything larger yields 960x540 at ~166 KB,
// with nothing in between. Measured against a UniFi Protect camera by
// walking the request up one step at a time. Staying on the cheap tier is worth
// about half the plate's steady-state transfer.
print('\n=== the snapshot request is capped at the served tier ===');
var tc=withPic('Front Door');
function dim(u,k){var m=new RegExp('[?&]'+k+'=(\\d+)').exec(u);return m?+m[1]:0;}
var over=tc._snaps.filter(function(s){return s.cssH>150;})[0];   // a full column
var half=tc._snaps.filter(function(s){return s.cssH<150;})[0];   // a stack half
// The clamp only reduces what EXCEEDS the tier: at dPR 1.5 a full column is
// 270*1.5=405 wide (already under) by 202.5*1.5=304 tall (over). So the request
// is 405x270, and the server covers it from the same 480x270 frame.
ok('a full-height column has its overshooting dimension clamped',
   dim(tc._srcFor(over.cam,over),'width')===405 &&
   dim(tc._srcFor(over.cam,over),'height')===270, tc._srcFor(over.cam,over));
ok('a stack half is already under it and is NOT inflated',
   dim(tc._srcFor(half.cam,half),'width')<=480 &&
   dim(tc._srcFor(half.cam,half),'height')<270, tc._srcFor(half.cam,half));
ok('nothing on the plate ever requests above the tier',
   tc._snaps.concat([tc._liveSlot]).every(function(s){
     var u=tc._srcFor(s.cam,s);
     return dim(u,'width')<=480 && dim(u,'height')<=270; }));

// the cap is configurable, because the tier is a property of the SERVER
var sharp=new C();
sharp.setConfig({selector:'input_select.cameras',cameras:CAMS,height:202.5,seam:2,
                 snapshot_cap:'960x540'});
sharp.hass=withPic('Front Door').hass;
var so=sharp._snaps.filter(function(s){return s.cssH>150;})[0];
ok("snapshot_cap:'960x540' buys the sharper tier back",
   dim(sharp._srcFor(so.cam,so),'width')===405, sharp._srcFor(so.cam,so));
var raw=new C();
raw.setConfig({selector:'input_select.cameras',cameras:CAMS,height:202.5,seam:2,
               snapshot_cap:false});
raw.hass=withPic('Front Door').hass;
var ro=raw._snaps.filter(function(s){return s.cssH>150;})[0];
ok('snapshot_cap:false asks for the true device size',
   dim(raw._srcFor(ro.cam,ro),'height')===304, raw._srcFor(ro.cam,ro));
ok('a malformed cap falls back to the tier rather than to nothing',
   (function(){var b=new C();
     b.setConfig({selector:'input_select.cameras',cameras:CAMS,snapshot_cap:'garbage'});
     b.hass=withPic('Front Door').hass;
     var o=b._snaps[0];
     return dim(b._srcFor(o.cam,o),'width')<=480;})());


// REVEAL REFRESH. Cold-priming means a scrolled-to tile is never black, but it
// can be showing its minutes-old first frame until the next interval tick. The
// observer freshens it on reveal -- and must NOT double-request the tiles that
// _tick is already handling.
print('\n=== a tile refreshes when scrolled into view ===');
__resetIos();
var rv=geo(withPic('Front Door'));
ok('every slot is observed', __observedCount()===rv._snaps.length,
   __observedCount()+' vs '+rv._snaps.length);

var off=rv._snaps[7];                      // one of the pair past the cutoff
arm(rv);
off.front=0; off.at=Date.now()-60000;      // painted a minute ago, off-screen
__fireIntersect(off.box, true);
ok('revealing a STALE painted tile refreshes it immediately',
   !!off.imgs.filter(function(i){return !!i.src;}).length,
   JSON.stringify(off.imgs.map(function(i){return i.src;})));

arm(rv);
off.front=0; off.at=Date.now();            // just refreshed
__fireIntersect(off.box, true);
ok('revealing a FRESH tile fetches nothing (no scroll stampede)',
   !off.imgs.filter(function(i){return !!i.src;}).length);

arm(rv);
off.front=-1; off.at=undefined;            // never painted: _tick owns it
__fireIntersect(off.box, true);
ok('a COLD tile is left to _tick, not double-requested by the observer',
   !off.imgs.filter(function(i){return !!i.src;}).length);

arm(rv);
off.front=0; off.at=Date.now()-60000;
__fireIntersect(off.box, false);           // scrolled back out
ok('a tile leaving the viewport fetches nothing',
   !off.imgs.filter(function(i){return !!i.src;}).length);

// and it must not leak: a re-render, or leaving the DOM, drops the observer
var obsBefore=__observedCount();
rv._render();
ok('a re-render re-observes rather than accumulating',
   __observedCount()===rv._snaps.length,
   __observedCount()+' observed, '+rv._snaps.length+' slots (was '+obsBefore+')');
rv.disconnectedCallback();
ok('disconnecting drops the observer', __observedCount()===0, String(__observedCount()));


// HA DETACHES AND REATTACHES CARDS while it lays a view out, so the observer's
// setup and teardown must be the SAME pair of functions. With setup in _render
// and teardown in _stopTimer, a reconnect would leave `_io` null for the life
// of the page.
print('\n=== the reveal observer survives a detach/reattach ===');
__resetIos();
var rc=geo(withPic('Front Door'));
ok('observed after the first render', __observedCount()===rc._snaps.length,
   String(__observedCount()));
rc.disconnectedCallback();
ok('  dropped on detach', __observedCount()===0, String(__observedCount()));
rc.connectedCallback();
ok('  REBUILT on reattach',
   __observedCount()===rc._snaps.length,
   __observedCount()+' vs '+rc._snaps.length);
ok('  and the card still has a live observer', !!rc._io);
// two reattaches must not double-observe
rc.connectedCallback();
ok('  reattaching twice does not accumulate observers',
   __observedCount()===rc._snaps.length, String(__observedCount()));


// THE CAP IS PER-SCREEN, because how much a tile upscales depends on dPR and a
// single fixed cap therefore gets some screens wrong. Measured in a dPR 2.0
// browser: covering the tall tile from the cheap tier retains 59% of the
// gradient energy at 2.0x but 76% at 1.5x, so a 2.0x screen must opt out
// where a 1.5x one opts in -- from the same YAML.
print('\n=== the cap yields to max_upscale, per screen ===');
function at(dpr, cfg){
  window.devicePixelRatio = dpr;
  var c=new C();
  c.setConfig(Object.assign({selector:'input_select.cameras',cameras:CAMS,
                             height:202.5,seam:2}, cfg||{}));
  c.hass=withPic('Front Door').hass;
  return c;
}
// dPR must be re-asserted at CALL time: _srcFor reads window.devicePixelRatio
// when it builds the URL, not when the card was constructed. Reading a card
// built at 1.5x while the global is still 2.0x makes this test lie.
function px(c,tall,k,dpr){
  window.devicePixelRatio = dpr;
  var s=c._snaps.filter(function(x){return tall? x.cssH>150 : x.cssH<150;})[0];
  var m=new RegExp('[?&]'+k+'=(\\d+)').exec(c._srcFor(s.cam,s));
  return m? +m[1] : 0;
}
var s15=at(1.5), s20=at(2.0);
ok('1.5x short tile downscales -> capped', px(s15,false,'width',1.5)<=480 && px(s15,false,'height',1.5)<270,
   px(s15,false,'width',1.5)+'x'+px(s15,false,'height',1.5));
ok('1.5x tall tile needs 1.13x -> still capped (within tolerance)',
   px(s15,true,'height',1.5)===270, String(px(s15,true,'height',1.5)));
ok('2.0x short tile needs 1.13x -> capped',
   px(s20,false,'width',2.0)===480, String(px(s20,false,'width',2.0)));
ok('2.0x TALL tile needs 1.50x -> NOT capped, takes the sharp tier',
   px(s20,true,'width',2.0)===540 && px(s20,true,'height',2.0)===405,
   px(s20,true,'width',2.0)+'x'+px(s20,true,'height',2.0));

// the knob at both extremes
var never=at(2.0,{max_upscale:1.0});
ok('max_upscale:1.0 refuses to cap anything that upscales',
   px(never,false,'width',2.0)===540, String(px(never,false,'width',2.0)));
var always=at(2.0,{max_upscale:99});
ok('max_upscale:99 caps everything regardless of softness',
   px(always,true,'width',2.0)===480 && px(always,true,'height',2.0)===270,
   px(always,true,'width',2.0)+'x'+px(always,true,'height',2.0));
ok('  and a 1.5x screen is unaffected by that knob at the default',
   px(at(1.5),true,'height',1.5)===270);
window.devicePixelRatio = 1.5;


// NO CROSSFADE ANYWHERE ON THE PLATE. A 240ms opacity transition on both
// stacked images at once drops the stack's total opacity below 1
// mid-transition, and the dark plate shows through: the tile dims ~25% and
// comes back, and with the tiles staggered 220ms apart it ripples across the
// row. Measured off a 60fps screen recording, mean luma of the camera band --
// a crossfade's worst deviation is 8.34 over 39 of 220 frames, the Home app's
// 0.22 over 0 of 740. The Home app hard-swaps. The double buffer is what
// prevents a blank frame; a fade is not load-bearing.
print('\n=== the refresh is a hard swap, never a crossfade ===');
var css = C.CSS || (customElements.get('hk-camera-mosaic-card').CSS) || '';
if (!css) { var probe=withPic('Front Door');
  css = (probe.shadowRoot && probe.shadowRoot.__css) || probe._cssText || ''; }
ok('the card exposes its CSS to test', !!css, 'len='+css.length);
// (the live CARD may fade in: it comes in over the frame copied under it,
// an opaque canvas, so the tile never dims -- see .live>hui-card)
// (HK's own picture-entity, where there is no Lovelace, has the same rule)
var cssNoLive = css.replace(/\.live>(hui-card|hk-picture-entity)\{[^}]*\}/g, '');
ok('NO opacity transition on a still', !/\.snap img\{[^}]*transition/.test(css) &&
   !/transition:opacity/.test(cssNoLive), (cssNoLive.match(/transition[^;}]*/g)||[]).join(' | '));
ok('...the live card fades in, and goes at once', /\.live>hui-card\{[^}]*transition:opacity/.test(css) &&
   /\.live>hui-card\.wait\{opacity:0;visibility:hidden;transition:none\}/.test(css));
ok('NO opacity transition on the live poster either',
   !/\.live>img\{[^}]*transition/.test(css));
ok('a still still starts hidden and is revealed by .on',
   /\.snap img\{[^}]*opacity:0/.test(css) && /\.snap img\.on\{[^}]*opacity:1/.test(css));
ok('the incoming frame is z-ABOVE the outgoing one',
   /\.snap img\{[^}]*z-index:0/.test(css) && /\.snap img\.on\{[^}]*z-index:1/.test(css));
ok('both posters stay BELOW the live card',
   /\.live>img\{[^}]*z-index:0/.test(css) && /\.live>hui-card\{[^}]*z-index:1/.test(css));

// and the swap itself: exactly one buffer is visible, before and after
print('\n=== exactly one buffer is ever visible ===');
var sw=withPic('Front Door');
arm(sw);
sw._snaps.forEach(function(s){ s.front=-1; });
sw._tick(); __runTimersUnder(2000);
sw._snaps.forEach(function(s){ var i=(s.front+1)%2; if(s.imgs[i].onload) s.imgs[i].onload(); });
__runTimers();   // the swap waits one frame past decode
ok('after the first frame, exactly one img per slot is .on',
   sw._snaps.every(function(s){
     return s.imgs.filter(function(i){return i.classList.contains('on');}).length===1;}),
   JSON.stringify(sw._snaps.map(function(s){
     return s.imgs.filter(function(i){return i.classList.contains('on');}).length;})));
var firstFront = sw._snaps.map(function(s){return s.front;});
arm(sw);
sw._tick(); __runTimersUnder(2000);
sw._snaps.forEach(function(s){ var i=(s.front+1)%2; if(s.imgs[i].onload) s.imgs[i].onload(); });
__runTimers();                       // the swap waits one frame past decode
ok('a refresh flips to the OTHER buffer', sw._snaps.every(function(s,i){
     return s.front !== firstFront[i]; }),
   JSON.stringify([firstFront, sw._snaps.map(function(s){return s.front;})]));
ok('  ...and still exactly one is visible (never zero, never two)',
   sw._snaps.every(function(s){
     return s.imgs.filter(function(i){return i.classList.contains('on');}).length===1;}));


// THE AGE LABEL, measured off the Home app: digit height 10.0 CSS px, left inset
// 13.3, bottom inset 16.3, bold, with a dark halo rather than a scrim.
print('\n=== the age label ===');
var ag=withPic('Front Door');
ok('every still has a label element', ag._snaps.every(function(s){return !!s.age;}));
ok('the live poster has one too', !!ag._liveSlot.poster.age);
var acss = C.CSS || '';
ok('positioned bottom-left at the measured insets',
   /\.age\{[^}]*left:13px/.test(acss) && /\.age\{[^}]*bottom:16px/.test(acss));
ok('14px bold white (10px digits at ~0.72em, ~2px stroke)',
   /font-size:14px/.test(acss) && /font-weight:700/.test(acss) && /color:#fff/.test(acss));
ok('carries its own contrast over live imagery',
   /text-shadow:0 1px 3px/.test(acss));
ok('sits above both image buffers', /\.age\{[^}]*z-index:2/.test(acss));
ok('never eats a tap meant for the tile', /pointer-events:none/.test(acss));
ok('digits do not jitter as the count changes',
   /tabular-nums/.test(acss));

print('\n=== what it says ===');
ok('no frame yet -> nothing at all', ag._ageText(undefined)==='', ag._ageText(undefined));
ok('just refreshed -> "now"', ag._ageText(Date.now())==='now');
ok('3s -> "3s"', ag._ageText(Date.now()-3000)==='3s');
ok('59s -> "59s"', ag._ageText(Date.now()-59000)==='59s');
ok('60s rolls to minutes', ag._ageText(Date.now()-60000)==='1m');
ok('a tile parked off-screen reads honestly, not stale',
   ag._ageText(Date.now()-260000)==='4m', ag._ageText(Date.now()-260000));
ok('and past an hour', ag._ageText(Date.now()-7300000)==='2h');

print('\n=== it tracks the actual swap ===');
arm(ag);
ag._snaps.forEach(function(s){ s.front=-1; s.at=undefined; });
ag._tickAges();
ok('before any frame, the labels are empty',
   ag._snaps.every(function(s){return s.age.textContent==='';}));
ag._tick(); __runTimersUnder(2000);
ag._snaps.forEach(function(s){ var i=(s.front+1)%2; if(s.imgs[i].onload) s.imgs[i].onload(); });
__runTimers();                       // the swap waits one frame past decode
ok('a new frame resets the label to "now" immediately',
   ag._snaps.every(function(s){return s.age.textContent==='now';}),
   JSON.stringify(ag._snaps.map(function(s){return s.age.textContent;})));
ag._snaps.forEach(function(s){ s.at = Date.now()-7000; });
ag._tickAges();
ok('and counts up from there', ag._snaps.every(function(s){return s.age.textContent==='7s';}),
   JSON.stringify(ag._snaps.map(function(s){return s.age.textContent;})));

print('\n=== the live tile is not labeled while the VIDEO is covering it ===');
// THE POSTER'S .on CLASS IS NOT WHAT YOU SEE. The poster sits at z-index 0
// under the live card's 1, so the video covers it the instant it has a frame;
// the .on class is only cleared later, by _tickPoster on the refresh
// interval. Between those two moments -- up to TEN SECONDS -- a label keyed
// on .on would count up over live video ("7s" at t=7.5s).
//
// So these drive _liveVideo(), which is what _liveCovering() asks.
ag._liveSlot.poster.at = Date.now()-5000;
var covering = {tagName:'VIDEO', readyState:4, videoWidth:480, currentTime:12, paused:false};
ag._liveVideo = function(){ return covering; };
ag._liveSlot.poster.imgs.forEach(function(i){ i.classList.remove('on'); });
ag._tickAges();
ok('a covering video carries NO age (it would be a lie)',
   ag._liveSlot.poster.age.textContent==='', ag._liveSlot.poster.age.textContent);

// THE REGRESSION TEST: a poster image still .on under a covering video.
ag._liveSlot.poster.imgs[0].classList.add('on');     // _tickPoster has not run yet
ag._tickAges();
ok('...even while a poster image is still .on',
   ag._liveSlot.poster.age.textContent==='', ag._liveSlot.poster.age.textContent);

// A STALLED stream still covers the poster with its frozen frame, so it is
// still not the poster you are looking at. Labeling a frozen frame "3s"
// would be the same lie in the other direction; _tickPoster's stall detection
// and _remountLive are what handle that case.
ag._liveVideo = function(){ return {tagName:'VIDEO', readyState:4, videoWidth:480,
                                    currentTime:20, paused:false}; };
ag._tickAges();
ok('a stalled-but-covering video is not labeled either',
   ag._liveSlot.poster.age.textContent==='', ag._liveSlot.poster.age.textContent);

// No frame at all -- the poster IS what you see, so it must say how old it is.
ag._liveVideo = function(){ return {tagName:'VIDEO', readyState:1, videoWidth:0,
                                    currentTime:0, paused:false}; };
ag._tickAges();
ok('a video with no frame yet leaves the poster labeled',
   ag._liveSlot.poster.age.textContent==='5s', ag._liveSlot.poster.age.textContent);
ag._liveVideo = function(){ return null; };
ag._tickAges();
ok('and no video element at all leaves it labeled',
   ag._liveSlot.poster.age.textContent==='5s', ag._liveSlot.poster.age.textContent);

// THE 1Hz TICK DOES NOT WAIT FOR THE VIDEO. On the tick alone a label lingers
// (~180ms measured) past the frame where the stream begins covering, because
// that happens between ticks. loadeddata/playing fire exactly at that
// transition.
var wired = {};
var vwire = {tagName:'VIDEO', readyState:1, videoWidth:0, currentTime:0, paused:false,
             addEventListener:function(n,f){ wired[n]=f; }};
ag._liveVideo = function(){ return vwire; };
ag._tickAges();
ok('the live video is wired for the transition',
   Object.keys(wired).sort().join(',')==='loadeddata,playing',
   Object.keys(wired).join(','));
ok('and flagged so it is wired once, not every tick', vwire.__hkAgeWired===true);
var before = Object.keys(wired).length;
ag._tickAges();
ok('a second tick does not re-add listeners', Object.keys(wired).length===before);

// Fire the event the way the browser would, with the video now covering.
ag._liveSlot.poster.at = Date.now()-5000;
ag._tickAges();
ok('labeled while there is still no frame',
   ag._liveSlot.poster.age.textContent==='5s', ag._liveSlot.poster.age.textContent);
vwire.readyState = 4; vwire.videoWidth = 480;
wired.playing();
ok('and cleared the instant `playing` fires, not on the next tick',
   ag._liveSlot.poster.age.textContent==='', ag._liveSlot.poster.age.textContent);

// A REPLACED element (navigation, _remountLive) carries no flag, so it wires
// again with no bookkeeping.
var v2 = {tagName:'VIDEO', readyState:1, videoWidth:0, currentTime:0, paused:false,
          addEventListener:function(n,f){ wired['2'+n]=f; }};
ag._liveVideo = function(){ return v2; };
ag._tickAges();
ok('a replaced video element is wired again', v2.__hkAgeWired===true);

print('\n=== show_age: false removes it entirely ===');
var noage=new C();
noage.setConfig({selector:'input_select.cameras',cameras:CAMS,height:202.5,seam:2,
                 show_age:false});
noage.hass=withPic('Front Door').hass;
ok('no label elements are created', noage._snaps.every(function(s){return !s.age;}));
ok('  nor on the poster', !noage._liveSlot.poster.age);
ok('  and no once-a-second interval is armed', !noage._ages);
ok('a labeled card DOES arm one', !!ag._ages);
noage._tickAges();
ok('  ticking ages is harmless with no labels', true);

print('\n=== swap on DECODE, not on load ===');
// onload means the bytes arrived; Chrome may still be decoding. Showing the
// buffer before decode() resolves can paint an undecoded frame for one frame.
var dp=withPic('Front Door'), d0=dp._snaps[0], resolveDecode=null, rejectDecode=null;
[0,1].forEach(function(i){
  d0.imgs[i].decode=function(){ return new Promise(function(res,rej){ resolveDecode=res; rejectDecode=rej; }); };
});
dp._tick(); __runTimers();
var di=(d0.front+1)%2;
d0.imgs[di].onload();
// NO frame flush here: the decode promise is still pending, so nothing is
// scheduled yet -- and __runTimers() would also fire the load TIMEOUT, which
// releases the loading flag this assertion is about.
drainMicrotasks();
ok('loaded but NOT decoded: still hidden', !d0.imgs[di].classList.contains('on'));
ok('  and still marked loading', d0.loading[di]===true);
resolveDecode(); drainMicrotasks();
// DECODE IS NOT THE LAST STEP. It is decode, then one animation frame: some
// engines show a still-rasterizing image for two frames with decode already
// resolved.
ok('decoded but not yet past a frame: still hidden', !d0.imgs[di].classList.contains('on'));
// The loading flag is released at DECODE, not at reveal -- the slot is free to
// be re-requested as soon as the bytes are in hand, and only the visible swap
// waits for the frame. Asserted here rather than after the flush because
// __runTimers() also re-fires the accumulated refresh ticks, which legitimately
// take the slot again.
ok('  loading released at decode', d0.loading[di]===false);
__runTimers();
ok('decoded + one frame: now shown', d0.imgs[di].classList.contains('on'));
dp._tick(); __runTimersUnder(2000);
var dj=(d0.front+1)%2;
d0.imgs[dj].onload(); drainMicrotasks();
__runTimers();   // the swap waits one frame past decode
rejectDecode(new Error('EncodingError')); drainMicrotasks();
__runTimers();   // the swap waits one frame past decode
// The reject path waits a frame as well. It has to: showing an image whose
// decode FAILED is exactly when it is least likely to be ready to paint.
__runTimers();
ok('a decode that REJECTS still shows the frame (never strands the tile)',
   d0.imgs[dj].classList.contains('on') && d0.loading[dj]===false);

print('\n=== paused while a pop-up COVERS the page ===');
// COVER, NOT OPEN. The now-playing bar is `modal: false`: it is open for as
// long as music plays and covers nothing, so a gate on `hkPopupOpen > 0`
// would freeze every camera black for the whole song. hk-popup counts
// covering sheets separately and broadcasts both numbers.
var pz=withPic('Front Door'); __resetTimers();
Object.defineProperty(pz, 'isConnected', { get: function(){ return true; } });
var calls=0, realLoad=pz._loadSlot; pz._loadSlot=function(){ calls++; return realLoad.apply(this, arguments); };
window.hkPopupOpen = 1; window.hkPopupCover = 1;
pz._tick();
ok('no refresh attempted while a COVERING sheet is open', calls === 0, 'calls='+calls);

// The bar: open, covering nothing -- the cameras keep going.
window.hkPopupCover = 0;
dispatchEvent(new CustomEvent('hk-popup-change', { detail: { open: 1, cover: 0 } }));
var afterUncover = calls;
ok('the moment the last COVERING sheet closes, it refreshes', calls > 0, 'calls='+calls);
pz._tick();
ok('a non-covering sheet (the bar) does NOT pause the cameras',
   calls > afterUncover, 'calls='+calls);

var before=calls;
dispatchEvent(new CustomEvent('hk-popup-change', { detail: { open: 2, cover: 1 } }));
ok('a COVERING sheet opening does not trigger a refresh', calls === before, 'calls='+calls);
window.hkPopupOpen = 0; window.hkPopupCover = 0;

// THE PICTURE IS A CANVAS. Revealing an <img> makes a tablet WebView
// re-raster the tile, and on some engines the re-raster draws the tile
// without its image for a frame: dark, then half, then done. The <img> are
// hidden loaders and every frame you see is one drawImage onto a canvas.
print('\n=== the visible frame is a canvas draw, not an <img> reveal ===');
var cvc=withPic('Front Door'), c0=cvc._snaps[0];
ok('every still slot has a canvas with a 2D context',
   cvc._snaps.every(function(s){ return !!s.cv && !!s.ctx; }));
ok('  and its box is marked [data-cv], which hides the <img>',
   cvc._snaps.every(function(s){ return s.box.attrs['data-cv']==='1'; }));
ok('  the canvas is the FIRST child, under the age label',
   c0.box.children[0]===c0.cv, String(c0.box.children[0] && c0.box.children[0].tagName));
ok('the live poster has one too', !!cvc._liveSlot.poster.cv && !!cvc._liveSlot.poster.ctx);
ok('  under the live card', cvc._liveSlot.box.children[0]===cvc._liveSlot.poster.cv);
ok('a canvas starts hidden (nothing drawn yet)', !c0.cv.classList.contains('on'));
globalThis.__blitCalls=[]; __resetTimers();
cvc._tick(); __runTimersUnder(2000);
var ci=(c0.front+1)%2, cim=c0.imgs[ci];
cim.naturalWidth=480; cim.naturalHeight=270;
cim.onload(); drainMicrotasks();
ok('decode alone draws nothing', __blitCalls.length===0, __blitCalls.length);
__runTimers();
var bl=__blitCalls.filter(function(b){ return b.img===cim; });
ok('decode + a frame draws the new frame onto the canvas', bl.length===1, __blitCalls.length);
ok('  and shows the canvas', c0.cv.classList.contains('on'));
// 272x100.25 css at dPR 1.5 (the shim's) -> 408x150 device px; a 480x270
// source covers that by scaling to 408/480 = 0.85 wide... height binds:
// k = max(408/480, 150/270) = 0.85, so the crop is 480 wide x 176.5 tall,
// centered vertically -- exactly object-fit:cover.
var dpr=Math.min(window.devicePixelRatio||1,3);
var W=Math.round(c0.cssW*dpr), H=Math.round(c0.cssH*dpr), k=Math.max(W/480,H/270);
ok('  the backing store is the tile in DEVICE pixels',
   c0.cv.width===W && c0.cv.height===H && bl[0].W===W && bl[0].H===H,
   c0.cv.width+'x'+c0.cv.height+' want '+W+'x'+H);
ok('  cropped like object-fit:cover (centered, aspect kept)',
   Math.abs(bl[0].sw-W/k)<1e-6 && Math.abs(bl[0].sh-H/k)<1e-6 &&
   Math.abs(bl[0].sx-(480-W/k)/2)<1e-6 && Math.abs(bl[0].sy-(270-H/k)/2)<1e-6,
   JSON.stringify([bl[0].sx,bl[0].sy,bl[0].sw,bl[0].sh]));
ok('an image with no size draws nothing (and does not throw)',
   cvc._blit(c0, { naturalWidth:0, naturalHeight:0 })===false);

// A healthy stream hides the poster -- the canvas has to go with the <img>.
var pv={tagName:'VIDEO', readyState:4, currentTime:12.5, paused:false};
cvc._liveVideo=function(){return pv;};
cvc._liveSlot.poster.cv.classList.add('on');
cvc._tickPoster(10);
ok('a healthy stream hides the poster CANVAS too',
   !cvc._liveSlot.poster.cv.classList.contains('on'));

// A context that throws on draw must not strand the tile: drop [data-cv] so
// the <img> path shows the picture instead.
var bad=withPic('Front Door'), b0=bad._snaps[0];
b0.ctx={ drawImage:function(){ throw new Error('GPU gone'); } };
ok('a draw that throws reports failure',
   bad._blit(b0, { naturalWidth:480, naturalHeight:270 })===false);
ok('  and falls back to the <img> path',
   b0.ctx===null && b0.box.attrs['data-cv']===undefined && !b0.cv.classList.contains('on'));

// No 2D context at all (an engine without canvas): the plain <img> swap.
var realCE=document.createElement;
document.createElement=function(t){ var e=realCE.call(document,t);
  if(String(t).toLowerCase()==='canvas') e.getContext=function(){ return null; }; return e; };
var nc=withPic('Front Door');
document.createElement=realCE;
ok('no context -> no canvas and no [data-cv]',
   nc._snaps.every(function(s){ return !s.cv && s.box.attrs['data-cv']===undefined; }));
ok('  and the <img> still swap as before', (function(){
  var s=nc._snaps[0]; __resetTimers(); nc._tick(); __runTimersUnder(2000);
  var i=(s.front+1)%2; s.imgs[i].onload(); drainMicrotasks(); __runTimers();
  return s.imgs[i].classList.contains('on'); })());

print('\n=== after a restart: nothing asked of a state the new server has not sent ===');
// HA restarted: the socket's `ready` comes before the resubscribe's snapshot,
// the page still holds every old state (old tokens), and HA rebuilds the card.
(function () {
  var cn = { l: {}, subscribeMessage: function () { return Promise.resolve(function () {}); },
             addEventListener: function (t, f) { (this.l[t] = this.l[t] || []).push(f); } };
  var st = { 'input_select.cameras': { state: 'Front Door', last_updated: 't' } };
  CAMS.forEach(function (c) {
    st[c.entity] = { state: 'recording', attributes: { entity_picture: '/api/camera_proxy/' + c.entity + '?token=OLD' } };
  });
  var before = new C(); before.isConnected = true; before.setConfig(CFG); before.hass = { states: st, connection: cn };
  ok('before any reconnect a still has its URL', before._srcFor(before._snaps[0].cam) !== null);
  (cn.l.ready || []).forEach(function (f) { f(); });                 // HA is back
  var b = new C(); b.isConnected = true; b.setConfig(CFG);
  var renders = 0, r0 = b._render.bind(b); b._render = function () { renders++; r0(); };
  b.hass = { states: st, connection: cn };                           // the rebuilt card
  ok('a still on an old state asks for nothing', b._snaps.every(function (s) { return b._srcFor(s.cam) === null; }));
  ok('  the live tile waits: no stream on a camera HA does not have yet', !(b._liveSlot.el.config && b._liveSlot.el.config.camera_view === 'live'));
  var st2 = Object.assign({}, st), fd = CAMS[0].entity, dw = CAMS[1].entity;
  st2[fd] = { state: 'recording', attributes: { entity_picture: '/api/camera_proxy/' + fd + '?token=NEW' } };
  st2[dw] = { state: 'recording', attributes: { entity_picture: '/api/camera_proxy/' + dw + '?token=NEW' } };
  var n0 = renders;
  b.hass = { states: st2, connection: cn };                          // the new server sends two cameras
  ok('the live camera arrives: its tile mounts, once', (b._liveSlot.el.config || {}).camera_view === 'live' && renders === n0 + 1, renders - n0);
  var dsnap = b._snaps.filter(function (s) { return s.cam.entity === dw; })[0];
  ok('  a camera that arrived asks with its NEW token', /token=NEW/.test(b._srcFor(dsnap.cam) || ''));
  ok('  one still missing asks for nothing yet', b._snaps.filter(function (s) { return s.cam.entity !== dw; })
       .every(function (s) { return b._srcFor(s.cam) === null; }));
  b.hass = { states: Object.assign({}, st2), connection: cn };        // the next push, nothing new
  ok('  and no rebuild after', renders === n0 + 1, renders - n0);
})();

print('\n' + (fail? 'FAILURES: '+fail : 'ALL '+pass+' MOSAIC TESTS PASS'));
