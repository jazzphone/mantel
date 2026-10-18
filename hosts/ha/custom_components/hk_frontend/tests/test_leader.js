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
// As a Play Music page has it: no selector, no options.
var CFG={
  speakers:SP.map(function(s){return {name:s[0],entity:ent(s[1])};}),
  presets:[{name:'Everywhere',entity:'media_player.homepods_2',entities:ALL},
           {name:'Downstairs',entity:'media_player.downstairs_homepods_downstairs',entities:DOWN}],
  playlists:[{name:'Favorites Mix',icon:'hk:music',script:'script.play_playlist',playlist:'favorites_mix'}],
  group_script:'script.group_selected_speakers'};
var calls=[];
function full(st){CFG.speakers.forEach(function(x){st[x.entity]=st[x.entity]||{state:'idle',attributes:{}};});
  CFG.presets.forEach(function(x){st[x.entity]=st[x.entity]||{state:'idle',attributes:{}};});return st;}
function mk(sel){return {states:full({'input_select.media_player_selection':{state:sel,last_updated:'t'}}),
  callService:function(d,s,data){calls.push({svc:d+'.'+s,data:data});}};}
// The room this SCREEN is focused on (hkMusic), which the grid seeds from.
function focus(sel){window.hkMusic._reset();
  var s=CFG.speakers.filter(function(x){return x.name===sel;})[0];
  if(s) window.hkMusic.setFocus(s.entity);}
function card(sel){calls=[];focus(sel||'Kitchen');var c=new C();c.setConfig(CFG);c.hass=mk(sel||'Kitchen');return c;}
function short(e){return e.split('.')[1].replace('_homepod_ma','');}
function leaderAfter(c){
  calls=[];
  c._play(HK_HOUSE.playlists[0]);
  // ONE CALL, the rooms IN TAP ORDER: the integration makes the first the
  // leader of a new group (music.py), so the order sent IS the leader rule.
  var g=calls.filter(function(x){return x.svc==='hk_frontend.music_play';})[0];
  return g ? g.data.rooms.map(short) : ['(nothing sent)'];
}
var pass=0,fail=0;
function ok(n,cond,x){if(cond){pass++;print('  PASS  '+n+(x?'   '+x:''));}else{fail++;print('  FAIL  '+n+'   '+x);}}

print('=== leader = the FIRST ROOM YOU TAPPED, not grid order ===');
var c=card('Kitchen'); c._clear();
c._toggle(ent('loft')); c._toggle(ent('kitchen')); c._toggle(ent('office'));
var L=leaderAfter(c);
ok('tapped Loft, Kitchen, Office', L[0]==='loft', 'order sent: '+L.join(' > '));

var c2=card('Kitchen'); c2._clear();
c2._toggle(ent('office')); c2._toggle(ent('loft')); c2._toggle(ent('kitchen'));
var L2=leaderAfter(c2);
ok('tapped Office, Loft, Kitchen', L2[0]==='office', 'order sent: '+L2.join(' > '));

print('\n=== un-tick then re-tick moves you to the END ===');
var c3=card('Kitchen'); c3._clear();
c3._toggle(ent('loft')); c3._toggle(ent('office'));
c3._toggle(ent('loft'));        // remove
c3._toggle(ent('loft'));        // re-add -> now last
var L3=leaderAfter(c3);
ok('Loft removed+readded -> Office leads', L3[0]==='office', 'order sent: '+L3.join(' > '));

print('\n=== preset then edit: leader is the presets first entity ===');
var c4=card('Kitchen'); c4._preset(CFG.presets[1]);  // Downstairs
c4._toggle(ent('loft'));                              // makes it ad-hoc
var L4=leaderAfter(c4);
ok('Downstairs + Loft', L4[0]==='kitchen', 'order sent: '+L4.join(' > '));

print('\n=== drop the presets first room -> next in preset order leads ===');
var c5=card('Kitchen'); c5._preset(CFG.presets[1]);
c5._toggle(ent('kitchen'));                           // drop the leader
var L5=leaderAfter(c5);
ok('Downstairs minus Kitchen', L5[0]==='living_room', 'order sent: '+L5.join(' > '));

print('\n=== seeded from a live group: group_members order leads ===');
var c6=(function(){focus('Kitchen');var cc=new C();cc.setConfig(CFG);
  var st={'input_select.media_player_selection':{state:'Kitchen',last_updated:'t'}};
  st[ent('kitchen')]={state:'playing',attributes:{group_members:[ent('office'),ent('kitchen'),ent('loft')]}};
  cc.hass={states:full(st),callService:function(d,s,data){calls.push({svc:d+'.'+s,data:data});}};return cc;})();
c6._toggle(ent('extra_room'));
var L6=leaderAfter(c6);
ok('group_members order preserved', L6[0]==='office', 'order sent: '+L6.join(' > '));

print('\n'+(fail?'FAILURES: '+fail:'ALL '+pass+' LEADER TESTS PASS'));
