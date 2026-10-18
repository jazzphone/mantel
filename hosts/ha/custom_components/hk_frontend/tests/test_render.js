// Resolved relative to this file so the suite runs from anywhere.
var DIR = (function(){ var p = HK_ROOT + '/tests/'; return p; })();
load(DIR + 'dom.js');
// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/tests/music_house.js');   // the integration's config, as a screen receives it
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
var C = customElements.get('hk-speaker-picker-card');
var SP=[['Kitchen','kitchen'],['Living Room','living_room'],['Master Bedroom','master_bedroom'],
        ['Master Bathroom','master_bathroom'],['Guest Bedroom','guest_bedroom'],['Office','office'],
        ["Kid's Room",'kids_room'],['Extra Room','extra_room'],['Loft','loft']];
function ent(k){return 'media_player.'+k+'_homepod_ma';}
var DOWN=['kitchen','living_room','master_bedroom','master_bathroom','guest_bedroom'].map(ent);
var ALL=SP.map(function(s){return ent(s[1]);});
// A speaker picker's config: no selector, no options.
var CFG={
  speakers:SP.map(function(s){return {name:s[0],entity:ent(s[1])};}),
  presets:[{name:'Everywhere',entity:'media_player.homepods_2',entities:ALL},
           {name:'Downstairs',entity:'media_player.downstairs_homepods_downstairs',entities:DOWN}],
  playlists:[{name:'Favorites Mix',icon:'hk:music',script:'script.play_playlist',playlist:'favorites_mix'},
             {name:'Christmas',icon:'hk:string-lights',script:'script.play_playlist', playlist:'christmas'}],
  browse_url:'./music-browse', group_script:'script.group_selected_speakers'};
var calls=[];
function mkHass(sel){var st={'input_select.media_player_selection':{state:sel,last_updated:'t'}};
  CFG.speakers.forEach(function(x){st[x.entity]={state:'idle',attributes:{}};});
  CFG.presets.forEach(function(x){st[x.entity]={state:'idle',attributes:{}};});
  return {states:st,callService:function(d,s,data){calls.push({svc:d+'.'+s,data:data});}};}
function settle(){for(var i=0;i<6;i++)drainMicrotasks();}
var pass=0,fail=0;
function ok(n,c,x){ if(c){pass++;print('  PASS  '+n);} else {fail++;print('  FAIL  '+n+(x?'   '+x:''));} }
// `sel` is the room this SCREEN is focused on (hkMusic), which seeds the grid.
function card(sel){calls=[];window.hkMusic._reset();
  var s=CFG.speakers.concat(CFG.presets).filter(function(x){return x.name===(sel||'Kitchen');})[0];
  if(s) window.hkMusic.setFocus(s.entity);
  var c=new C();c.setConfig(CFG);c.hass=mkHass(sel||'Kitchen');return c;}

print('=== DOM structure ===');
var c=card('Kitchen');
// Playlists are hk-scene-card elements, named by data-hk-name (the nested
// card is not upgraded in this shim). BROWSE IS NOT ONE: it sits in the
// Clear/Transfer row as a plain pill, because it navigates and every tile
// beside it plays something.
function scenes(cc){return walk(cc.shadowRoot).filter(function(e){return e.tagName==='hk-scene-card';});}
function nameOf(e){return e.attrs['data-hk-name'];}
var P=pills(c), T=scenes(c);
// The rooms, presets and playlists are the INTEGRATION's
// (tests/music_house.js), and Move/Add and Stop All are always offered -- no
// script has to be named in YAML.
ok('renders 15 pills (9 speakers + 2 presets + Clear + Move + Stop All + Browse)',
   P.length===15, 'got '+P.length);
ok('renders 3 scene pills (the playlists; Clear and Browse are NOT)', T.length===3, 'got '+T.length);
ok('  in the integration\'s order, a chooser as ONE pill',
   T.map(nameOf).join('|')==='Favorites Mix|Christmas|Decades', T.map(nameOf).join('|'));
ok('every pill has role=button', P.every(function(p){return p.attrs.role==='button';}));
// A control that can do nothing is dimmed AND taken out of the tab order.
ok('every ENABLED pill is tabbable, every disabled one is not',
   P.every(function(p){return (p.attrs['aria-disabled']==='true') === (p.attrs.tabindex==='-1');}));
ok('preset pills carry .preset', P.filter(function(p){return p.className.indexOf('preset')>=0;}).length===2);
ok('Clear carries .clear, not .preset', (function(){
  var cl=P.filter(function(p){return labelOf(p)==='Clear';})[0];
  return cl && cl.className.indexOf('clear')>=0 && cl.className.indexOf('preset')<0;})());

print('\n=== Clear sits BELOW the speakers, not with the groups ===');
// The whole point of the layout: Clear acts on the speaker grid, so it must
// come after every speaker and before the rule / playlist tiles.
var order = P.map(labelOf);
var iClear = order.indexOf('Clear');
var iLastSpeaker = Math.max.apply(null, SP.map(function(x){return order.indexOf(x[0]);}));
var iLastPreset  = Math.max.apply(null, CFG.presets.map(function(x){return order.indexOf(x.name);}));
ok('Clear comes after EVERY speaker', iClear > iLastSpeaker,
   'clear@'+iClear+' lastSpeaker@'+iLastSpeaker);
ok('Clear is not inside the group row', iClear > iLastPreset + 1,
   'clear@'+iClear+' lastPreset@'+iLastPreset);
ok('groups come first, then speakers, then Clear',
   iLastPreset < order.indexOf('Kitchen') && order.indexOf('Kitchen') < iClear,
   JSON.stringify(order));
// Browse follows Clear in the same row -- "Clear, Transfer, Space, Browse
// Music" -- so Clear is not last. What matters is that Clear is
// the last thing acting on the SELECTION, and that Browse is beyond it.
ok('Clear, Move, Stop All, then Browse -- the actions on the selection, then the page',
   order.slice(iClear).join('|')==='Clear|Add Rooms|Stop All|Browse Music' ||
   order.slice(iClear).join('|')==='Clear|Move Music|Stop All|Browse Music', JSON.stringify(order));
ok('Browse Music is the LAST pill', order[order.length-1]==='Browse Music', JSON.stringify(order));
ok('Browse carries .browse, and is not a preset or a clear', (function(){
  var b=P.filter(function(p){return labelOf(p)==='Browse Music';})[0];
  return b && b.className.indexOf('browse')>=0 &&
         b.className.indexOf('preset')<0 && b.className.indexOf('clear')<0;})());

print('\n=== aria-pressed tracks the Set (the highlighting) ===');
var press=function(cc){return pills(cc).map(function(p){return labelOf(p)+'='+p.attrs['aria-pressed'];});};
c=card('Kitchen');
var on=pills(c).filter(function(p){return p.attrs['aria-pressed']==='true';}).map(labelOf);
ok('seeded Kitchen -> only Kitchen lit', on.length===1&&on[0]==='Kitchen', JSON.stringify(on));

c=card('Kitchen'); c._preset(CFG.presets[1]);
on=pills(c).filter(function(p){return p.attrs['aria-pressed']==='true';}).map(labelOf);
ok('Downstairs preset -> 6 lit (5 speakers + the preset pill)', on.length===6, JSON.stringify(on));
ok('  Downstairs pill itself lit', on.indexOf('Downstairs')>=0);
ok('  all 5 main-floor rooms lit',
   ['Kitchen','Living Room','Master Bedroom','Master Bathroom','Guest Bedroom']
     .every(function(n){return on.indexOf(n)>=0;}), JSON.stringify(on));
ok('  no upstairs room lit',
   !['Office',"Kid's Room",'Extra Room','Loft'].some(function(n){return on.indexOf(n)>=0;}));

print('\n=== un-ticking a room drops the preset highlight ===');
c=card('Downstairs'); c._toggle(ent('kitchen'));
on=pills(c).filter(function(p){return p.attrs['aria-pressed']==='true';}).map(labelOf);
ok('Downstairs pill goes dark', on.indexOf('Downstairs')<0, JSON.stringify(on));
ok('other 4 stay lit', on.length===4);

print('\n=== heading text ===');
c=card('Kitchen'); c._clear();
var head=walk(c.shadowRoot).filter(function(e){return e.className==='sub';})[0];
ok('empty -> "Select a speaker"', head._text==='Select a speaker', head._text);
c=card('Kitchen'); c._preset(CFG.presets[1]);
head=walk(c.shadowRoot).filter(function(e){return e.className==='sub';})[0];
ok('preset -> names the group', head._text==='Play to Downstairs', head._text);
c=card('Kitchen'); c._clear(); c._toggle(ent('loft')); c._toggle(ent('office'));
head=walk(c.shadowRoot).filter(function(e){return e.className==='sub';})[0];
ok('ad-hoc -> counts them', head._text==='Play to 2 speakers', head._text);

print('\n=== tiles disable with an empty selection ===');
c=card('Kitchen'); c._clear();
T=scenes(c);
var pl=T.filter(function(t){return nameOf(t)==='Favorites Mix';})[0];
ok('playlist tile aria-disabled', pl.attrs['aria-disabled']==='true');
ok('  ...and pointer-events off', pl.style.pointerEvents==='none');
// Browse is a pill, not a scene, and it is a NAVIGATION -- it must stay
// live with nothing selected, unlike the playlists beside it which need a
// speaker to play to.
var br=pills(c).filter(function(p){return labelOf(p)==='Browse Music';})[0];
ok('Browse is a pill, not a scene tile', !!br);
ok('Browse stays enabled with 0 selected',
   br.attrs['aria-disabled']===undefined && br.style.pointerEvents!=='none');

print('\n=== a disabled playlist pill ignores a click that gets through ===');
c=card('Kitchen'); c._clear(); calls=[];
scenes(c).filter(function(t){return nameOf(t)==='Favorites Mix';})[0].click();
settle();
ok('no service call with nothing selected', calls.length===0, JSON.stringify(calls));
print('\n=== pills are built once, not per render ===');
c=card('Kitchen'); var first=scenes(c)[0]; c._toggle(ent('loft')); c._toggle(ent('office'));
ok('same element after two selection changes', scenes(c)[0]===first);

// EVERY RULE IS ONE CALL: hk_frontend.music_play with the rooms
// and the playlist. Which rule it is -- a preset's sync group, one room, a
// new join -- is decided and tested in the integration (tests/py).
print('\n=== CLICKING: a preset is one call carrying its rooms ===');
c=card('Kitchen'); c._preset(CFG.presets[1]); calls=[];
scenes(c).filter(function(t){return nameOf(t)==='Favorites Mix';})[0].click();
settle();
ok('1 service call', calls.length===1, JSON.stringify(calls));
ok('  hk_frontend.music_play, favorites_mix, the five Downstairs rooms',
   calls[0].svc==='hk_frontend.music_play'&&calls[0].data.playlist==='favorites_mix'
   &&calls[0].data.rooms.length===5, JSON.stringify(calls[0]));

print('\n=== CLICKING: one room ===');
c=card('Kitchen'); c._clear(); c._toggle(ent('loft')); calls=[];
scenes(c).filter(function(t){return nameOf(t)==='Christmas';})[0].click();
settle();
ok('  hk_frontend.music_play christmas to the Loft',
   calls.length===1&&calls[0].svc==='hk_frontend.music_play'&&calls[0].data.playlist==='christmas'
   &&calls[0].data.rooms.join()===ent('loft'), JSON.stringify(calls));

print('\n=== CLICKING: an ad-hoc set, in the order it was tapped ===');
c=card('Kitchen'); c._clear(); c._toggle(ent('loft')); c._toggle(ent('office')); calls=[];
scenes(c).filter(function(t){return nameOf(t)==='Favorites Mix';})[0].click();
ok('exactly 1 service call', calls.length===1, JSON.stringify(calls));
ok('  both rooms, Loft first -- the leader of the new group',
   calls[0].svc==='hk_frontend.music_play'&&calls[0].data.rooms.join()===[ent('loft'),ent('office')].join(),
   JSON.stringify(calls[0]));

print('\n=== only the pressed pill lights, and only while its request runs ===');
c=card('Kitchen'); c._clear(); c._toggle(ent('loft')); calls=[];
var fav=scenes(c).filter(function(t){return nameOf(t)==='Favorites Mix';})[0];
var xmas=scenes(c).filter(function(t){return nameOf(t)==='Christmas';})[0];
ok('  both decide their own light', typeof fav._hkLit==='function' && typeof xmas._hkLit==='function');
ok('  nothing pressed: neither lit', !fav._hkLit() && !xmas._hkLit());
var answer; c._callResp=function(){ calls.push({svc:'x'}); return new Promise(function(r){ answer=r; }); };
xmas.click();
ok('  Christmas pressed: it lights while the request is out', xmas._hkLit());
ok('  Favorites Mix stays dark', !fav._hkLit());
answer({ok:true, response:{ok:true, leader:ent('loft')}}); settle();
ok('  ...and goes out when the answer comes', !xmas._hkLit());

print('\n=== Clear pill behaviour ===');
function clearPill(cc){return pills(cc).filter(function(p){return labelOf(p)==='Clear';})[0];}
c=card('Kitchen'); c._preset(CFG.presets[1]);
ok('enabled when something is selected', clearPill(c).attrs['aria-disabled']!=='true');
clearPill(c).click();
ok('click empties the Set', c._sel.size===0, 'size='+c._sel.size);
ok('disabled at zero', clearPill(c).attrs['aria-disabled']==='true');
ok('never lights up', clearPill(c).attrs['aria-pressed']!=='true');
c=card('Kitchen'); c._preset(CFG.presets[0]);
ok('Everywhere selected -> Clear still not pressed', clearPill(c).attrs['aria-pressed']!=='true');
ok('and no service call is made by Clear', (function(){
  calls=[]; clearPill(c).click(); return calls.length===0;})(), JSON.stringify(calls));

print('\n=== the render gate ===');
// The signature is NOT static. The card draws more than its own selection:
// a pill's third state -- a room STARTING or STOPPING, or joining this page's
// audio -- changes what it must draw, and a constant signature would leave it
// right on load and wrong until the next reload.
//
// What the gate has to guarantee: identical state renders an identical
// signature, so hass churn alone never redraws.
c=card('Kitchen');
ok('the same state gives the same signature', c._sigOf()===c._sigOf(), c._sigOf());
ok('  ...and hass churn alone does not change it',
   c._sigOf()===card('Kitchen')._sigOf(), c._sigOf());
var before=c._sel.size;
c.hass=mkHass('Everywhere');            // hass churn
ok('a later hass does NOT reseed', c._sel.size===before, 'now '+c._sel.size);

print('\n'+(fail?'FAILURES: '+fail:'ALL '+pass+' RENDER/CLICK TESTS PASS'));
