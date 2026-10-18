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
if (!C) { print('FAIL: card not registered'); quit(1); }

var SP = [['Kitchen','kitchen'],['Living Room','living_room'],['Master Bedroom','master_bedroom'],
          ['Master Bathroom','master_bathroom'],['Guest Bedroom','guest_bedroom'],
          ['Office','office'],["Kid's Room",'kids_room'],['Extra Room','extra_room'],['Loft','loft']];
function ent(k){ return 'media_player.'+k+'_homepod_ma'; }
var DOWN = ['kitchen','living_room','master_bedroom','master_bathroom','guest_bedroom'].map(ent);
var ALL  = SP.map(function(s){return ent(s[1]);});

// No `selector`, no `option:` -- the picker resolves this screen's music
// through hkMusic.
var CFG = {
  speakers: SP.map(function(s){ return {name:s[0], entity:ent(s[1])}; }),
  // A preset's `entity:` is its sync-group player: without it _targets()
  // returns null for every preset. A fixture that cannot reach a branch is a
  // fixture that hides it.
  presets: [ {name:'Everywhere',
              entity:'media_player.homepods_2', entities:ALL},
             {name:'Downstairs',
              entity:'media_player.downstairs_homepods_downstairs',
              entities:DOWN} ],
  playlists: [ {name:'Favorites Mix', icon:'hk:music', script:'script.play_playlist',playlist:'favorites_mix'},
               {name:'Christmas', icon:'hk:string-lights', script:'script.play_playlist', playlist:'christmas'} ],
  browse_url: './music-browse',
  group_script: 'script.group_selected_speakers',
  release_script: 'script.release_and_play',
  stop_script: 'script.stop_all_music',
  // `floors` matters: _render branches on it, so without it every test would
  // take the unlabeled `else` and never execute the floor-label path -- the
  // `placed` bookkeeping, and the fallback that renders a speaker no floor
  // names. A real screen gets its floors from the floor registry.
  transfer_script: 'script.transfer_music',
  floors: [ {name:'Main Floor', entities: DOWN},
            {name:'Upstairs', entities: ['office','kids_room','extra_room','loft'].map(ent)} ]
};

var calls = [];
function fillKnown(states) {
  CFG.speakers.forEach(function (sp) {
    if (!states[sp.entity]) states[sp.entity] = {state:'idle',attributes:{group_members:[]}};
  });
  CFG.presets.forEach(function (p) {
    if (!states[p.entity]) states[p.entity] = {state:'idle',attributes:{group_members:[]}};
  });
  return states;
}
function mkHass(sel, groupedMembers, playing) {
  var states = { 'input_select.media_player_selection': { state: sel, last_updated: 't' } };
  // A live ad-hoc group: every MEMBER reports the whole group in
  // group_members, which is how the card recognizes one.
  (groupedMembers || []).forEach(function (e) {
    states[e] = { state: 'idle', attributes: { group_members: groupedMembers } };
  });
  (playing || []).forEach(function (e) {
    var prev = states[e] || { attributes: {} };
    states[e] = { state: 'playing', attributes: prev.attributes || {} };
  });
  // Several independent groups, each with its own track -- the shape the
  // context row exists for. [{members:[...], title, artist, state}]
  (mkHass.groups || []).forEach(function (g) {
    g.members.forEach(function (e) {
      states[e] = { state: g.state || 'playing',
                    attributes: { group_members: g.members, media_title: g.title,
                                  media_artist: g.artist,
                                  entity_picture: g.pic,
                                  entity_picture_local: g.picLocal } };
    });
  });
  mkHass.groups = null;
  return { states: fillKnown(states),
           callService: function (d, s, data) { calls.push([d+'.'+s, data]); } };
}

var pass = 0, fail = 0;
function settle() { for (var i = 0; i < 6; i++) drainMicrotasks(); }
function ok(name, cond, extra) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (extra ? '   ' + extra : '')); }
}
// `sel` names what this SCREEN is focused on -- a room or a preset, by the
// name its pill uses. It becomes hkMusic's focus before the card first draws,
// exactly as the saved focus would on a real tablet.
function focusFor(name) {
  var s = CFG.speakers.filter(function (x) { return x.name === name; })[0] ||
          CFG.presets.filter(function (x) { return x.name === name; })[0];
  return s ? s.entity : null;
}
// A hass whose selector-shaped fixture state names the focus: the suites
// below name the focus as a selector state, and this turns that into what
// the card reads.
function focusOf(h) {
  var s = h.states['input_select.media_player_selection'];
  window.hkMusic._reset();
  var f = s && focusFor(s.state);
  if (f) window.hkMusic.setFocus(f);
  return h;
}
function card(sel, groupedMembers, playing) {
  calls = [];
  window.hkMusic._reset();
  var f = focusFor(sel || 'Kitchen');
  if (f) window.hkMusic.setFocus(f);
  var c = new C(); c.setConfig(CFG); c.hass = mkHass(sel || 'Kitchen', groupedMembers, playing);
  return c;
}

print('=== seeding from the selector ===');
var c = card('Kitchen');
ok('single option seeds 1 speaker', c._sel.size === 1 && c._sel.has(ent('kitchen')), '['+Array.from(c._sel)+']');
c = card('Downstairs');
ok('preset option seeds 5 speakers', c._sel.size === 5, 'size='+c._sel.size);
ok('  ...and they are the Main Floor 5', DOWN.every(function(e){return c._sel.has(e);}));
c = card('Everywhere');
ok('Everywhere seeds all 9', c._sel.size === 9);

print('\n=== rule 1: selection == preset -> sync group option ===');
c = card('Kitchen'); c._preset(CFG.presets[1]);
ok('Downstairs preset -> its sync group', c._target() === 'media_player.downstairs_homepods_downstairs', 'got '+c._target());
c._preset(CFG.presets[0]);
ok('Everywhere preset -> its sync group', c._target() === 'media_player.homepods_2', 'got '+c._target());

print('\n=== rule 2: exactly one speaker -> that option ===');
c = card('Kitchen'); c._clear(); c._toggle(ent('loft'));
ok('single Loft -> the Loft', c._target() === ent('loft'), 'got '+c._target());

print('\n=== rule 3: ad-hoc subset -> null (join path) ===');
c = card('Kitchen'); c._clear(); c._toggle(ent('loft')); c._toggle(ent('office'));
ok('Loft+Office -> null', c._target() === null, 'got '+c._target());
c._toggle(ent('kitchen'));
ok('Loft+Office+Kitchen -> null', c._target() === null);

print('\n=== the subtle one: preset MINUS one is NOT the preset ===');
c = card('Downstairs'); c._toggle(ent('kitchen'));   // drop one of the 5
ok('Downstairs minus Kitchen -> null (not "Downstairs")', c._target() === null, 'got '+c._target());
ok('  ...and 4 remain selected', c._sel.size === 4);

print('\n=== the other subtle one: preset PLUS one is NOT the preset ===');
c = card('Downstairs'); c._toggle(ent('loft'));
ok('Downstairs plus Loft -> null', c._target() === null, 'got '+c._target());
ok('  ...6 selected', c._sel.size === 6);

print('\n=== all 9 by hand == Everywhere (set equality, not preset memory) ===');
c = card('Kitchen'); c._clear();
ALL.forEach(function(e){ c._toggle(e); });
ok('hand-picking all 9 -> Everywhere', c._target() === 'media_player.homepods_2', 'got '+c._target());

print('\n=== preset toggles off ===');
c = card('Kitchen'); c._preset(CFG.presets[1]);
ok('preset on -> 5', c._sel.size === 5);
c._preset(CFG.presets[1]);
ok('same preset again -> 0 (a way out)', c._sel.size === 0);

print('\n=== preset REPLACES, does not add ===');
c = card('Kitchen'); c._clear(); c._toggle(ent('loft')); c._preset(CFG.presets[1]);
ok('Loft then Downstairs -> exactly the 5', c._sel.size === 5 && !c._sel.has(ent('loft')), 'size='+c._sel.size);

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' LOGIC TESTS PASS'));

print('\n=== group-aware seeding ===');
function cardG(sel, gmOf) {
  var c = new C(); c.setConfig(CFG);
  var states = {'input_select.media_player_selection': {state: sel, last_updated:'t'}};
  Object.keys(gmOf || {}).forEach(function (k) {
    states[k] = {state:'playing', attributes:{group_members: gmOf[k]}};
  });
  c.hass = focusOf({states: fillKnown(states), callService: function(){}});
  return c;
}
var L=ent('loft'), O=ent('office'), K=ent('kitchen'), X=ent('extra_room');
var g = cardG('Loft', {}); g._seeded=false;
var c2 = cardG('Loft', {});
ok('no group -> just the leader', c2._sel.size===1 && c2._sel.has(L), 'size='+c2._sel.size);

var c3 = cardG('Loft', {}); c3 = (function(){
  var cc=new C(); cc.setConfig(CFG);
  var st={'input_select.media_player_selection':{state:'Loft',last_updated:'t'}};
  st[L]={state:'playing',attributes:{group_members:[L,O,X]}};
  cc.hass=focusOf({states:fillKnown(st), callService:function(){}}); return cc;})();
ok('live 3-room group -> all 3 seeded', c3._sel.size===3, 'size='+c3._sel.size);
ok('  contains loft/office/extra', c3._sel.has(L)&&c3._sel.has(O)&&c3._sel.has(X));

var c4=(function(){
  var cc=new C(); cc.setConfig(CFG);
  var st={'input_select.media_player_selection':{state:'Loft',last_updated:'t'}};
  st[L]={state:'playing',attributes:{group_members:[L,'media_player.some_random_thing']}};
  cc.hass=focusOf({states:fillKnown(st), callService:function(){}}); return cc;})();
ok('unknown member filtered -> falls back to leader', c4._sel.size===1 && c4._sel.has(L), 'size='+c4._sel.size);

var c5=(function(){
  var cc=new C(); cc.setConfig(CFG);
  var st={'input_select.media_player_selection':{state:'Downstairs',last_updated:'t'}};
  st['media_player.downstairs_homepods_downstairs']={state:'playing',attributes:{group_members:null}};
  cc.hass=focusOf({states:fillKnown(st), callService:function(){}}); return cc;})();
ok('sync group still seeds the PRESET (5)', c5._sel.size===5, 'size='+c5._sel.size);

var c6=(function(){
  var cc=new C(); cc.setConfig(CFG);
  var st={'input_select.media_player_selection':{state:'Loft',last_updated:'t'}};
  st[L]={state:'playing',attributes:{group_members:[L]}};
  cc.hass=focusOf({states:fillKnown(st), callService:function(){}}); return cc;})();
ok('group of exactly 1 -> leader only', c6._sel.size===1);

var c7=(function(){
  var cc=new C(); cc.setConfig(CFG);
  var st={'input_select.media_player_selection':{state:'Kitchen',last_updated:'t'}};
  st[K]={state:'playing',attributes:{group_members:
    ['media_player.kitchen_homepod_ma','media_player.living_room_homepod_ma',
     'media_player.master_bedroom_homepod_ma','media_player.master_bathroom_homepod_ma',
     'media_player.guest_bedroom_homepod_ma']}};
  cc.hass=focusOf({states:fillKnown(st), callService:function(){}}); return cc;})();
ok('a live group equal to Downstairs -> resolves to the SYNC GROUP',
   c7._target()==='media_player.downstairs_homepods_downstairs', 'got '+c7._target());

print('\n=== every press is ONE call: the rooms, in tap order, and the playlist ===');
// The three rules -- a preset's sync group, one room, a new join -- and
// everything each needs (releasing a group in the way, joining, the house
// volume) are the INTEGRATION's (music.py), tested in
// tests/py/test_engine.py. What this card owns is what it sends, and what the
// screen shows while the answer is coming.
var GROUP = ['kitchen','loft','office','extra_room','master_bedroom',
             'master_bathroom','living_room','guest_bedroom'].map(ent);
var pl = HK_HOUSE.playlists[0];

c = card('Kitchen', GROUP);                  // Office still joined to a group
c._clear();
c._sel.add(ent('office'));
c._play(pl);
ok('a joined single room is one play call, for that room',
   calls.length === 1 && calls[0][0] === 'hk_frontend.music_play' &&
   JSON.stringify(calls[0][1]) === JSON.stringify({ rooms: [ent('office')], playlist: 'favorites_mix' }),
   JSON.stringify(calls));

c = card('Kitchen');
c._clear();
c._sel.add(ent('office'));
c._play(pl);
settle();
ok('a lone room is the same one call', calls.length === 1 && calls[0][0] === 'hk_frontend.music_play',
   JSON.stringify(calls));
ok('  ...and this screen holds its focus on the Office while it loads',
   window.hkMusic.focus() === ent('office') &&
   window.hkMusic.resolve(c.hass).reason === 'pending',
   window.hkMusic.focus() + ' ' + window.hkMusic.resolve(c.hass).reason);

c = card('Kitchen', GROUP);
c._clear();
c._sel.add(ent('office')); c._sel.add(ent('loft'));
c._play(pl);
ok('two rooms: one call, in the order they were tapped',
   calls.length === 1 && calls[0][1].rooms.join() === [ent('office'), ent('loft')].join(),
   JSON.stringify(calls));

c = card('Downstairs', GROUP);
c._play(pl);
ok('a preset: one call carrying its five rooms',
   calls.length === 1 && calls[0][1].rooms.slice().sort().join() === DOWN.slice().sort().join(),
   JSON.stringify(calls));
ok('  ...while the screen holds on the preset\'s SYNC GROUP, which is where it will play',
   window.hkMusic.focus() === 'media_player.downstairs_homepods_downstairs',
   window.hkMusic.focus());

print('\n=== the third pill state: which rooms are actually playing ===');
// A pill says more than SELECTED: a room playing something other than what
// this page shows looks different, or a room left in an old group is
// invisible.
//
// A ROOM SELECTION: `here` is that room plus whatever is joined to it.
c = card('Office', null, [ent('office'), ent('loft')]);
var here = c._hereSet();
ok('the selected room is this page\'s audio',
   c._playFor(ent('office'), here) === 'here', c._playFor(ent('office'), here));
ok('another room playing is elsewhere',
   c._playFor(ent('loft'), here) === 'elsewhere', c._playFor(ent('loft'), here));
ok('a silent room gets nothing',
   c._playFor(ent('kitchen'), here) === '', '[' + c._playFor(ent('kitchen'), here) + ']');
// PLAYING, not merely "has a state". A paused room is not making noise, and a
// play glyph on it would be a lie -- the whole point of the glyph is that it
// is readable without knowing any color convention.
var paused = card('Office', null, [ent('office')]);
paused.hass.states[ent('kitchen')] = { state: 'paused', attributes: {} };
paused.hass.states[ent('loft')] = { state: 'idle', attributes: {} };
var ph = paused._hereSet();
ok('a PAUSED room gets no glyph',
   paused._playFor(ent('kitchen'), ph) === '',
   '[' + paused._playFor(ent('kitchen'), ph) + ']');
ok('an idle room gets no glyph',
   paused._playFor(ent('loft'), ph) === '',
   '[' + paused._playFor(ent('loft'), ph) + ']');

// JOINED rooms are the same audio, even though only the leader is selected.
c = card('Kitchen', [ent('kitchen'), ent('loft')], [ent('kitchen'), ent('loft')]);
here = c._hereSet();
ok('a joined room is here, not elsewhere',
   c._playFor(ent('loft'), here) === 'here', c._playFor(ent('loft'), here));

// A PRESET selection: `here` is the preset's OWN rooms. A Music Assistant sync
// group reports group_members [] on the group entity while its rooms report
// the five of them -- measured with a sync group playing -- so reading the
// group entity would call every room `elsewhere`.
c = card('Downstairs', null, DOWN);
// THE SYNC GROUP ITSELF IS PLAYING, as it is in a real home: hkMusic recognizes
// a preset by the group's own state, not by a room list that happens to match.
c.hass.states['media_player.downstairs_homepods_downstairs'].state = 'playing';
here = c._hereSet();
ok('every Downstairs room is here', DOWN.every(function (e) {
  return c._playFor(e, here) === 'here'; }));
var c2b = card('Downstairs', null, DOWN.concat([ent('office')]));
c2b.hass.states['media_player.downstairs_homepods_downstairs'].state = 'playing';
ok('  ...and a room outside it is not',
   c2b._playFor(ent('office'), c2b._hereSet()) === 'elsewhere',
   c2b._playFor(ent('office'), c2b._hereSet()));

print('\n=== and the glyph reaches the DOM ===');
function pillFor(c, name) {
  var pills = [];
  (function walk(n) {
    (n.children || []).forEach(function (k) {
      if ((k.className || '').split(' ').indexOf('pill') >= 0) pills.push(k);
      walk(k);
    });
  })(c._root);
  return pills.filter(function (p) {
    return p.children[0] && p.children[0].textContent === name; })[0];
}
c = card('Office', null, [ent('office'), ent('loft')]);
c._render();
var po = pillFor(c, 'Office'), plft = pillFor(c, 'Loft'), pk = pillFor(c, 'Kitchen');
ok('the playing room carries the glyph class', po.className.indexOf('here') >= 0, po.className);
ok('  ...and an actual glyph node', po.children.length === 2 &&
   po.children[1].className === 'pi',
   po.children.length + ' children');
ok('the other room is marked elsewhere', plft.className.indexOf('elsewhere') >= 0, plft.className);
ok('a silent room has no glyph at all', pk.children.length === 1, String(pk.children.length));
// A screen reader gets neither color nor glyph.
ok('it is said out loud too',
   po.attrs['aria-label'] === 'Office, playing', po.attrs['aria-label']);
ok('  ...including the exception',
   plft.attrs['aria-label'] === 'Loft, playing something else', plft.attrs['aria-label']);

// A PRESET IS ONLY `elsewhere` WHEN ONE OF ITS OWN ROOMS IS. Office and Extra
// Room playing this page's music must not light EVERYWHERE amber, which would
// say "playing something else" about rooms playing exactly what is on
// screen. Partly-here is not a warning.
// GROUPED as well as playing -- that is what makes Extra Room part of this
// page's audio rather than foreign to it ("PLAYING ON - OFFICE, EXTRA ROOM").
var PAIR = [ent('office'), ent('extra_room')];
c = card('Office', PAIR, PAIR);
c._render();
var pEvery = pillFor(c, 'Everywhere');
ok('a partly-playing preset is not a warning',
   pEvery.className.indexOf('elsewhere') < 0, pEvery.className);
ok('  ...and is not claimed to be playing either',
   pEvery.className.indexOf('here') < 0, pEvery.className);
// One room of it playing something foreign IS the warning.
c = card('Office', null, [ent('office'), ent('kitchen')]);
c._render();
ok('a preset with a foreign room warns',
   pillFor(c, 'Everywhere').className.indexOf('elsewhere') >= 0,
   pillFor(c, 'Everywhere').className);
// All of its rooms on this page's audio is the lit case.
c = card('Downstairs', null, DOWN);
c._render();
ok('every room here lights the preset',
   pillFor(c, 'Downstairs').className.indexOf('here') >= 0,
   pillFor(c, 'Downstairs').className);

print('\n=== a room starting or stopping must repaint the card ===');
// The card draws the speakers' states, so they belong in the signature: an
// input left out is right on load and wrong until the next reload.
var a = card('Office', null, [ent('office')]);
var sigA = a._sigOf();
var b2 = card('Office', null, [ent('office'), ent('loft')]);
ok('a room starting changes the signature', sigA !== b2._sigOf(), sigA);
var g1 = card('Kitchen', null, [ent('kitchen')]);
var g2 = card('Kitchen', [ent('kitchen'), ent('loft')], [ent('kitchen')]);
ok('a room JOINING changes it too', g1._sigOf() !== g2._sigOf(), g1._sigOf());

print('\n=== contexts: every separate thing the house is playing ===');
// A context is not a new concept and is stored nowhere -- it IS a Music
// Assistant group, read back out of group_members. The house can run several
// at once, and the page names each.
function houseOf(groups, sel) {
  mkHass.groups = groups;
  calls = [];
  var c = new C(); c.setConfig(CFG); c.hass = focusOf(mkHass(sel || 'Office'));
  return c;
}
var TWO = [
  { members: [ent('office'), ent('extra_room')], title: 'Cornerman', artist: 'Stephen Wilson Jr.' },
  { members: [ent('kitchen'), ent('living_room')], title: 'Dust Bowl', artist: 'DMB' }
];
c = houseOf(TWO, 'Office');
var cx = c._contexts();
ok('two groups playing -> two contexts', cx.length === 2, 'got ' + cx.length);
ok('  ...each with its own rooms',
   cx[0].members.length === 2 && cx[1].members.length === 2);
// ORDER IS CONFIG ORDER, deliberately: the row must not reshuffle as you
// switch between contexts, so it follows `speakers:` rather than recency.
var titles = cx.map(function (x) { return x.title; }).sort().join('/');
ok('  ...and its own track', titles === 'Cornerman/Dust Bowl', titles);
var byTitle = function (t) {
  return cx.filter(function (x) { return x.title === t; })[0]; };
// group_members[0] is the LEADER and the selector has to point at it.
ok('the leader is the first member', cx[0].leader === cx[0].members[0]);
ok('  ...and the row is in config order, not recency',
   cx[0].title === 'Dust Bowl', cx[0].title);
// Silence is not a context.
c = houseOf(null, 'Office');
ok('a silent house has no contexts', c._contexts().length === 0, String(c._contexts().length));
// And silence that REPORTS ITSELF is still silence: a room with a real state
// of idle must not become a context just because hass knows about it.
var quiet = card('Office');
quiet.hass.states[ent('kitchen')] = { state: 'idle', attributes: {} };
quiet.hass.states[ent('loft')] = { state: 'off', attributes: {} };
ok('an idle room is not a context', quiet._contexts().length === 0,
   String(quiet._contexts().length));
// A PAUSED group still is one -- it is a thing in the house you may want to
// come back to, and the card says "Paused" rather than a track.
mkHass.groups = [{ members: [ent('office'), ent('loft')], state: 'paused',
                   title: 'Held', artist: 'x' }];
var held = new C(); held.setConfig(CFG); held.hass = mkHass('Office');
ok('a paused group is still a context', held._contexts().length === 1,
   String(held._contexts().length));
ok('  ...and is marked not-playing', held._contexts()[0].playing === false,
   String(held._contexts()[0].playing));
// A room playing on its own is a context of one.
c = card('Office', null, [ent('office')]);
ok('one lone room is one context', c._contexts().length === 1);
ok('  ...of itself', c._contexts()[0].members.join() === ent('office'));

print('\n=== naming a context, and which option selects it ===');
c = houseOf(TWO, 'Office');
cx = c._contexts();
var L = function (x) { return c._ctxLabel(x); };
var office = cx.filter(function (x) { return x.title === 'Cornerman'; })[0];
ok('two rooms read as "A + B"', L(office).name.indexOf(' + ') > 0, L(office).name);
ok('  ...and key on the leader', L(office).key === ent('office'), L(office).key);
// A context whose rooms ARE a preset's rooms IS that preset -- pointing the
// selector at a room because it happens to be group_members[0] would downgrade
// a real MA sync group to an ad-hoc join.
c = houseOf([{ members: DOWN, title: 'x', artist: 'y' }], 'Downstairs');
c.hass.states['media_player.downstairs_homepods_downstairs'].state = 'playing';
var dl = c._ctxLabel(c._contexts()[0]);
ok('a playing sync group is named as the preset', dl.name === 'Downstairs', dl.name);
ok('  ...and keys on the SYNC GROUP, not a room',
   dl.key === 'media_player.downstairs_homepods_downstairs', dl.key);
// ...but the same five rooms JOINED AD HOC are not the preset:
// the sync group is idle, and pointing the screen at it would show an idle
// player while five rooms play.
c = houseOf([{ members: DOWN, title: 'x', artist: 'y' }], 'Downstairs');
var adhoc = c._ctxLabel(c._contexts()[0]);
ok('an ad-hoc join of the same rooms keys on its leader',
   adhoc.key === ent('kitchen') && adhoc.name === 'Kitchen +4', adhoc.key + ' ' + adhoc.name);
// Beyond two rooms the name is "A +N" -- a five-room list does not fit.
c = houseOf([{ members: [ent('office'), ent('loft'), ent('extra_room')], title: 't', artist: 'a' }], 'Office');
ok('three rooms read as "A +2"', c._ctxLabel(c._contexts()[0]).name === 'Office +2',
   c._ctxLabel(c._contexts()[0]).name);

print('\n=== the row appears only when there is a choice ===');
function rowOf(c) {
  c._render();
  var found = null;
  (function walk(n) { (n.children || []).forEach(function (k) {
    if (k.className === 'ctx') found = k; walk(k); }); })(c._root);
  return found;
}
c = houseOf(TWO, 'Office');
var row = rowOf(c);
ok('two contexts -> a row', !!row);
ok('  ...with a card each', row && row.children.length === 2, row && row.children.length);
ok('  ...naming both', row.children.map(function (k) {
     return k.attrs['data-hk-name']; }).join('|').indexOf('Kitchen') >= 0,
   row.children.map(function (k) { return k.attrs['data-hk-name']; }).join('|'));
// One context is what the page already shows at half the screen; a card would
// be a second, smaller copy of the same answer.
c = card('Office', null, [ent('office')]);
ok('one context -> no row at all', !rowOf(c));
c = houseOf(null, 'Office');
ok('silence -> no row', !rowOf(c));

print('\n=== which card is lit, and what tapping one does ===');
c = houseOf(TWO, 'Office');
row = rowOf(c);
var lit = row.children.filter(function (k) { return k.attrs['aria-pressed'] === 'true'; });
ok('exactly one card is lit', lit.length === 1, String(lit.length));
ok('  ...the one the page is on', lit[0].attrs['data-hk-name'].indexOf('Office') === 0,
   lit[0].attrs['data-hk-name']);
// Tapping the other one moves THIS SCREEN's focus -- that is what makes the
// now-playing card, the bar and Browse follow -- and writes nothing to the
// house, so no other tablet moves with it.
calls = [];
var other = row.children.filter(function (k) { return k.attrs['aria-pressed'] !== 'true'; })[0];
other.click();
ok('tapping moves this screen\'s focus, with no service call',
   calls.length === 0 && window.hkMusic.focus() === ent('kitchen'),
   JSON.stringify(calls) + ' focus=' + window.hkMusic.focus());
ok('  ...and the pills follow immediately', c._sel.size === 2 && c._sel.has(ent('kitchen')),
   Array.from(c._sel).join());
ok('  ...without touching the house', !calls.some(function (x) {
     return x[0].indexOf('media_player') === 0; }));

print('\n=== a track change has to repaint the row ===');
// The row prints the title, so a group moving to the next track changes what
// this card draws -- with no state change and no group change to notice it by.
var s1 = houseOf(TWO, 'Office')._sigOf();
var s2 = houseOf([TWO[0], { members: [ent('kitchen'), ent('living_room')],
                            title: 'Something Else', artist: 'DMB' }], 'Office')._sigOf();
ok('a new track changes the signature', s1 !== s2);

print('\n=== Stop All ===');
// Nothing stops the rest of the house implicitly, so Stop All does it on
// purpose, next to the transfer button.
function pillNamed(c, label) {
  c._render();
  var found = null;
  (function walk(n) { (n.children || []).forEach(function (k) {
    if ((k.className || '').split(' ').indexOf('pill') >= 0 &&
        k.children[0] && k.children[0].textContent === label) found = k;
    walk(k); }); })(c._root);
  return found;
}
c = houseOf(TWO, 'Office');
var sa = pillNamed(c, 'Stop All');
ok('the pill is there', !!sa);
ok('  ...enabled while something plays', sa && sa.attrs['aria-disabled'] !== 'true',
   sa && sa.attrs['aria-disabled']);
calls = [];
sa.click();
ok('  ...and stops the whole house through the integration',
   calls.length === 1 && calls[0][0] === 'hk_frontend.music_stop' &&
   !(calls[0][1] || {}).rooms, JSON.stringify(calls));
// A button that cannot do anything must not look like it can -- the same rule
// Transfer follows.
c = houseOf(null, 'Office');
sa = pillNamed(c, 'Stop All');
ok('dimmed when the house is silent', sa && sa.attrs['aria-disabled'] === 'true',
   sa && sa.attrs['aria-disabled']);
// And it never lights: it acts, it is not a selection.
ok('  ...and never lights', sa.attrs['aria-pressed'] !== 'true');

print('\n=== "Also stop the other rooms?" ===');
// Starting music in another room can mean "as well" or "instead". The
// selection is the same gesture either way, so it asks, once, at the press.
var asked = null;
var realSheet = window.hkCards.confirmSheet;
window.hkCards.confirmSheet = function (text, onOk, opts) {
  asked = { text: text, onOk: onOk, opts: opts || {} };
};
function press(c) { asked = null; calls = []; c._play(CFG.playlists[0]); }

// Another room is playing and the selection does not cover it -> a question.
c = houseOf(TWO, 'Office');            // office+extra and kitchen+living
c._sel = new Set([ent('loft')]);       // a room in neither context
press(c);
ok('it asks', !!asked, String(asked));
ok('  ...with the confirmation\'s wording', asked && asked.text === 'Also stop the other rooms?',
   asked && asked.text);
ok('  ...naming what would stop', asked.opts.detail.indexOf('Kitchen') >= 0 &&
   asked.opts.detail.indexOf('Office') >= 0, asked.opts.detail);
ok('  ...with two real choices, not Cancel',
   asked.opts.yes === 'Stop Playing' && asked.opts.no === 'Leave Playing',
   asked.opts.yes + '/' + asked.opts.no);
ok('  ...and nothing has happened yet', calls.length === 0, JSON.stringify(calls));

// "Leave playing" -> play, and touch nothing else.
asked.opts.onNo();
settle();
ok('Leave playing starts the music', calls.length > 0);
ok('  ...and stops nothing', !calls.some(function (x) {
   return x[0] === 'hk_frontend.music_stop'; }), JSON.stringify(calls));

// "Stop them" -> stop exactly the other rooms, then play.
press(c);
asked.onOk();
settle();
var stopCall = calls.filter(function (x) {
  return x[0] === 'hk_frontend.music_stop'; })[0];
ok('Stop them stops the others', !!stopCall, JSON.stringify(calls));
// `|| []` deliberately: without it an omitted list throws, and a throw ends
// the suite -- which a "count the FAIL lines" mutation check reads as zero
// failures. The assertion has to survive the mutation to be able to catch it.
var stopped = (stopCall && stopCall[1].rooms) || [];
ok('  ...naming their rooms, not the house', stopped.length === 4,
   JSON.stringify(stopped));
ok('  ...and never the room being played to', stopped.indexOf(ent('loft')) < 0);
ok('  ...then plays', calls.length > 1);

print('\n=== ...and only when it is a real question ===');
// Nothing else playing: no question, just music.
c = card('Office');
press(c);
ok('a silent house is not asked about', !asked, String(asked && asked.text));
ok('  ...it just plays', calls.length > 0);
// The only thing playing IS what you selected -- that is a replacement, not a
// choice, and asking would be asking whether to stop the thing you are
// replacing anyway.
c = houseOf([TWO[0]], 'Office');
c._sel = new Set([ent('office'), ent('extra_room')]);
press(c);
ok('replacing what you selected is not asked about', !asked, String(asked && asked.text));
// HALF A CONTEXT STILL COUNTS: Office+Extra Room playing together, select
// just the Office. A rule that needs `every` room of a context would exclude
// it as "a takeover" and ask nothing -- while the Extra Room carries on
// playing the old thing. The question is not whose context it is, it is
// whether a room will still be playing something you did not ask for.
c = houseOf([TWO[0]], 'Office');         // office + extra_room, together
c._sel = new Set([ent('office')]);
press(c);
ok('half a context still asks', !!asked, String(asked));
asked.onOk();
settle();
var half = calls.filter(function (x) {
  return x[0] === 'hk_frontend.music_stop'; })[0];
var halfRooms = (half && half[1].rooms) || [];
ok('  ...and stops only the room left behind',
   halfRooms.length === 1 && halfRooms[0] === ent('extra_room'),
   JSON.stringify(halfRooms));
ok('  ...never the room being played to', halfRooms.indexOf(ent('office')) < 0);

// Stopping the other rooms is a blocking part of this request. A newer
// selection must supersede the pending callback, and a slow Stop must never
// run after a newly started playlist.
c = houseOf(TWO, 'Office');
c._sel = new Set([ent('loft')]);
var finishStop;
calls = [];
c.hass.callService = function (d, s, data) {
  calls.push([d + '.' + s, data]);
  if (d === 'hk_frontend' && s === 'music_stop')
    return new Promise(function (resolve) { finishStop = resolve; });
};
asked = null;
c._play(CFG.playlists[0]);
asked.onOk();
ok('play waits while Stop is pending', calls.length === 1);
c._clear();
finishStop(); settle();
ok('a changed selection cancels the pending play', calls.length === 1);
window.hkCards.confirmSheet = realSheet;

print('\n=== the context artwork comes from HA, not Music Assistant ===');
// Music Assistant sets entity_picture to an ABSOLUTE url on its own port -- a
// wall tablet may not render it, while a desktop browser that happens to
// reach that host hides the problem.
c = houseOf([{ members: [ent('office')], title: 't', artist: 'a',
               pic: 'http://192.0.2.10:8095/imageproxy/abc',
               picLocal: '/api/media_player_proxy/media_player.office' }], 'Office');
ok('it prefers HA\'s own proxy path',
   c._contexts()[0].image === '/api/media_player_proxy/media_player.office',
   c._contexts()[0].image);
// Falling back matters: a player with no local proxy should still show what
// art it has rather than a placeholder.
c = houseOf([{ members: [ent('office')], title: 't', artist: 'a',
               pic: 'http://192.0.2.10:8095/imageproxy/abc' }], 'Office');
ok('  ...falling back when there is no local one',
   c._contexts()[0].image === 'http://192.0.2.10:8095/imageproxy/abc',
   c._contexts()[0].image);
c = houseOf([{ members: [ent('office')], title: 't', artist: 'a' }], 'Office');
ok('  ...and null when there is none at all',
   c._contexts()[0].image === null, String(c._contexts()[0].image));

print('\n=== a speaker that is not there ===');
// Music Assistant restarting takes every player with it: recorder history
// shows every room and sync group going `unavailable` together -- the
// integration reloading, not a HomePod dropping off.
//
// An unavailable pill must not look and tick like an idle one, because
// pressing a playlist then produces silence: play_media at an unavailable
// entity is ACCEPTED and does nothing. No error, no toast, nothing in the log.
function gone(c, entities) {
  entities.forEach(function (e) {
    c.hass.states[e] = { state: 'unavailable', attributes: {} };
  });
  return c;
}
c = card('Office');
ok('a normal speaker is available', c._available(ent('office')) === true);
gone(c, [ent('office')]);
ok('  ...and an unavailable one is not', c._available(ent('office')) === false);
c.hass.states[ent('office')] = { state: 'unknown', attributes: {} };
ok('`unknown` counts as gone too', c._available(ent('office')) === false);
// A missing entity cannot be a safe playback target. The Home Assistant hass
// snapshot is complete when passed to the card; a typo or removed entity must
// not remain selected and silently send play to nowhere.
delete c.hass.states[ent('office')];
ok('a missing entity is unavailable', c._available(ent('office')) === false);

// The prune clears the whole requested set. A partial set is a new request
// that the user must choose explicitly, especially when a preset loses one
// of its members.
c = card('Office');
c._sel = new Set([ent('office'), ent('loft')]);
gone(c, [ent('loft')]);
ok('two ticked, one goes away', c._pruneGone() === true);
ok('  ...clears the whole request', c._sel.size === 0, 'size ' + c._sel.size);
ok('  ...and has no accidental partial target', c._targets() === null,
   String(c._targets()));
ok('  ...so no rule silently takes over', c._target() === null, String(c._target()));
ok('  ...and a second prune finds nothing', c._pruneGone() === false);

c = card('Kitchen'); c._clear();
gone(c, [ent('kitchen')]);
c._preset(CFG.presets[1]);
ok('an incomplete Downstairs preset is refused', c._sel.size === 0);
c = card('Office'); c._sel = new Set([ent('office')]);
var requestedBefore = [ent('office')];
gone(c, [ent('office')]);
ok('a speaker lost after confirmation invalidates play',
   c._requestValid(requestedBefore) === false);
c = card('Downstairs');
gone(c, ['media_player.downstairs_homepods_downstairs']);
ok('an unavailable preset group invalidates play even when rooms are online',
   c._requestValid(DOWN) === false);

// The whole selection going away must not leave a play target behind.
c = card('Office');
c._sel = new Set([ent('loft')]);
gone(c, [ent('loft')]);
c._pruneGone();
ok('everything gone -> nothing selected', c._sel.size === 0, 'size ' + c._sel.size);
ok('  ...and nothing to play to', c._targets() === null, String(c._targets()));

// _sigOf has to notice, or the pill stays live-looking until the next
// reload.
c = card('Office');
var before = c._sigOf();
gone(c, [ent('loft')]);
ok('an unavailable speaker changes the signature', c._sigOf() !== before);

// Render: the pill is dimmed and cannot be tapped.
c = card('Office');
gone(c, [ent('loft')]);
c._render();
function findPill(c, name) {
  var hit = null;
  (function walk(n) {
    (n.children || []).forEach(function (ch) {
      if (ch._text === name && ch.parentNode) hit = hit || ch.parentNode;
      walk(ch);
    });
  })(c._root);
  return hit;
}
// ...AND THROUGH _render(), not just by calling _pruneGone() by hand. The
// prune living in the right place is the half that can be deleted silently:
// with the call removed from _render every assertion above still passes.
c = card('Office');
c._sel = new Set([ent('office'), ent('loft')]);
gone(c, [ent('loft')]);
c._render();
ok('_render prunes before it draws', c._sel.size === 0, 'size ' + c._sel.size);
function headingOf(c) {
  var found = null;
  (function walk(n) {
    (n.children || []).forEach(function (ch) {
      if (ch.attrs && ch.attrs['class'] === 'sub' && ch._text) found = ch._text;
      if (ch.className === 'sub' && ch._text) found = ch._text;
      walk(ch);
    });
  })(c._root);
  return found;
}
ok('  ...so the heading counts what is really there',
   headingOf(c) === 'Select a speaker', String(headingOf(c)));

var lp = findPill(c, 'Loft');
ok('the unavailable pill is dimmed', !!lp && lp.style.opacity === '0.35',
   lp ? 'opacity ' + lp.style.opacity : 'pill not found');
ok('  ...and takes no taps', !!lp && lp.style.pointerEvents === 'none');
ok('  ...and says so', !!lp && lp.getAttribute('aria-label') === 'Loft, unavailable',
   lp ? String(lp.getAttribute('aria-label')) : '-');
var kp = findPill(c, 'Kitchen');
ok('an available one is untouched', !!kp && !kp.style.opacity,
   kp ? 'opacity ' + kp.style.opacity : 'pill not found');

print('\n=== Add or Move: one predicate, shared with the script ===');
// ONE RULE, NOT TWO COPIES. Music in the Loft, Loft+Office selected:
//
//     tapped Loft first  -> [loft, office]
//     tapped Office first-> [office, loft]
//
// Both must do the same. A transfer that takes speakers[0] as the leader and
// refuses when it equals the source does NOTHING for the first while the pill
// is lit, if the card's own guard only rejects the single-room no-op.
function xfer(sel, playingList, grouped) {
  var c = card(sel, grouped || null, playingList || []);
  c._config = Object.assign({}, CFG, { transfer_script: 'script.transfer_music' });
  return c;
}

// --- _adding() -------------------------------------------------------------
c = xfer('Loft', [ent('loft')]);
c._sel = new Set([ent('loft'), ent('office')]);
ok('selection contains the playing room -> ADD', c._adding() === true);
c._sel = new Set([ent('office')]);
ok('selection without it -> MOVE', c._adding() === false);
// A PRESET resolves to its sync-group player, so _targets and _sel differ on
// purpose. Reading _sel here would say "Add" while the script did a move.
c = xfer('Kitchen', [ent('kitchen')]);
c._sel = new Set(DOWN);                       // Downstairs, which contains the kitchen
ok('a preset is judged on _targets, not _sel', c._adding() === false,
   'targets=' + JSON.stringify(c._targets()));

// --- a lit button must never do nothing ------------------------------------
c = xfer('Loft', [ent('loft')]);
c._sel = new Set([ent('loft'), ent('office')]);       // loft tapped FIRST
ok('loft-first is offered', c._canTransfer() === true);
ok('  ...and labeled Add', c._adding() === true);
c._sel = new Set([ent('office'), ent('loft')]);       // office tapped first
ok('office-first is offered too', c._canTransfer() === true);
ok('  ...same selection, same answer -- tap order is gone',
   c._adding() === true);

// --- the no-ops, which must still be refused -------------------------------
c = xfer('Loft', [ent('loft')]);
c._sel = new Set([ent('loft')]);
ok('just the room it is already in -> no', c._canTransfer() === false);
c = xfer('Loft', []);
c._sel = new Set([ent('office')]);
ok('nothing playing on the source -> no', c._canTransfer() === false);
c = xfer('Loft', [ent('loft')]);
c._sel = new Set();
ok('empty selection -> no', c._canTransfer() === false);
// Already exactly that group: the same short-circuit group_selected_speakers
// calls `already`.
c = xfer('Loft', [ent('loft'), ent('office')], [ent('loft'), ent('office')]);
c._sel = new Set([ent('loft'), ent('office')]);
ok('the group is already exactly that -> no', c._canTransfer() === false);
c._sel = new Set([ent('loft'), ent('office'), ent('extra_room')]);
ok('  ...but adding one more IS work', c._canTransfer() === true);
// Nothing playing where the page is pointed -> nothing to move.
c = card('Loft');
c._sel = new Set([ent('office')]);
ok('nothing playing here -> never offered', c._canTransfer() === false);

// --- the label --------------------------------------------------------------
c = xfer('Loft', [ent('loft')]);
c._sel = new Set([ent('loft'), ent('office')]);
c._render();
ok('the pill reads "Add Rooms"', !!findPill(c, 'Add Rooms'),
   'pill not found');
ok('  ...and not "Move Music"', !findPill(c, 'Move Music'));
c._sel = new Set([ent('office')]);
c._render();
ok('moving it reads "Move Music"', !!findPill(c, 'Move Music'));
ok('  ...and not "Add Rooms"', !findPill(c, 'Add Rooms'));
ok('no "Transfer" label', !findPill(c, 'Transfer'));
// Both strings are short enough never to truncate -- which is why the label
// never names the DESTINATION.
ok('both labels fit the pill', 'Add Rooms'.length <= 19 && 'Move Music'.length <= 19);

// --- what actually gets sent ------------------------------------------------
c = xfer('Loft', [ent('loft')]);
c._sel = new Set([ent('loft'), ent('office')]);
calls = [];
c._transfer();
ok('one call', calls.length === 1, 'got ' + calls.length);
ok('  ...to hk_frontend.music_transfer', calls.length === 1 &&
   calls[0][0] === 'hk_frontend.music_transfer',
   JSON.stringify(calls[0] || null));
ok('  ...carrying the whole selection', calls.length === 1 &&
   calls[0][1].rooms.length === 2);
ok('  ...and the source', calls.length === 1 &&
   calls[0][1].source === ent('loft'));
// A refused transfer must not dispatch at all.
c._sel = new Set([ent('loft')]);
calls = [];
c._transfer();
ok('a refused transfer sends nothing', calls.length === 0);

print('\n=== the floor-label branch ===');
// With `floors` in CFG, _render takes the labeled path: the labels, the
// `placed` bookkeeping, and the fallback that renders a speaker no floor
// names.
function texts(c) {
  var out = [];
  (function walk(n) {
    (n.children || []).forEach(function (ch) {
      if (ch._text) out.push(ch._text);
      walk(ch);
    });
  })(c._root);
  return out;
}
c = card('Office');
c._render();
var t = texts(c);
ok('the floor labels are drawn', t.indexOf('Main Floor') >= 0 && t.indexOf('Upstairs') >= 0,
   JSON.stringify(t.slice(0, 8)));
ok('every speaker still appears exactly once',
   SP.filter(function (x) { return ALL.indexOf(ent(x[1])) >= 0; })
     .every(function (x) {
       return t.filter(function (s2) { return s2 === x[0]; }).length === 1;
     }),
   JSON.stringify(t));

// A SPEAKER NO FLOOR NAMES must still render, in a trailing unlabeled grid --
// otherwise adding one to `speakers:` and forgetting `floors:` makes it vanish
// from the page silently.
// The floors come from the integration (each speaker's area's floor).
window.hkMusic._configure(Object.assign({}, HK_HOUSE, {
  floors: [{ name: 'Main Floor', entities: DOWN }]      // upstairs left out
}));
c = card('Office');
c._render();
t = texts(c);
ok('an unfloored speaker is not dropped', t.indexOf('Loft') >= 0 && t.indexOf('Office') >= 0,
   JSON.stringify(t));
ok('  ...and the one floor given is still labeled', t.indexOf('Main Floor') >= 0);
ok('  ...with no label invented for the rest', t.indexOf('Upstairs') < 0);

// No floors at all: one ungrouped grid.
window.hkMusic._configure(Object.assign({}, HK_HOUSE, { floors: [] }));
c = card('Office');
c._render();
t = texts(c);
ok('no floors -> one plain grid', t.indexOf('Main Floor') < 0 && t.indexOf('Kitchen') >= 0);
window.hkMusic._configure(HK_HOUSE);

print('\n=== a chooser pill asks first, then plays like any other ===');
// A Decades pill, say: six playlists behind one tile. It carries `options`
// and NO `playlist`, so it must play nothing on its own.
var DECADES = [{ name: '2020s', key: 'decade_2020s' },
               { name: '2010s', key: 'decade_2010s' },
               { name: '1970s', key: 'decade_1970s' }];
var sheetCalls = [];
var realChoose = window.hkCards.chooseSheet;
window.hkCards.chooseSheet = function (title, options, onPick) {
  sheetCalls.push({ title: title, options: options, pick: onPick });
};

c = card('Office');
c._sel = new Set([ent('office')]);
var decadePill = { name: 'Decades', icon: 'hk:timer-sand', options: DECADES };
calls = []; sheetCalls = [];
c._play(decadePill);
ok('pressing it opens the chooser', sheetCalls.length === 1, 'got ' + sheetCalls.length);
ok('  ...titled with the pill name', sheetCalls[0] && sheetCalls[0].title === 'Decades');
ok('  ...offering every option', sheetCalls[0] && sheetCalls[0].options.length === 3);
ok('  ...and PLAYS NOTHING yet', calls.length === 0, 'got ' + calls.length);

// picking one goes down the ordinary path
// Rule 2 on a quiet house is ONE call -- the playlist, named target -- but
// asserting on the last keeps this honest if a step is ever added in front of
// it.
sheetCalls[0].pick(DECADES[1]);
settle();
var last = calls[calls.length - 1];
ok('picking one dispatches', calls.length > 0, 'got ' + calls.length);
ok('  ...to hk_frontend.music_play', !!last && last[0] === 'hk_frontend.music_play',
   JSON.stringify(last || null));
ok('  ...carrying the chosen key', !!last &&
   last[1].playlist === 'decade_2010s',
   last ? JSON.stringify(last[1]) : '-');

// an ordinary pill must be untouched by any of this
calls = []; sheetCalls = [];
c._play({ name: 'Country', key: 'country' });
settle();
ok('an ordinary pill does NOT open a chooser', sheetCalls.length === 0);
ok('  ...and plays immediately', calls.length > 0 &&
   calls[calls.length - 1][1].playlist === 'country',
   JSON.stringify(calls[calls.length - 1] || null));

// empty options is not a chooser -- it would be a dead end with no way back
calls = []; sheetCalls = [];
c._play({ name: 'Broken', key: 'x', options: [] });
settle();
ok('an EMPTY options list falls through to playing',
   sheetCalls.length === 0 && calls.length > 0 &&
   calls[calls.length - 1][1].playlist === 'x');

// and with nothing selected it must not even ask
calls = []; sheetCalls = [];
c._sel = new Set();
c._play(decadePill);
ok('no speakers -> no chooser, no call', sheetCalls.length === 0 && calls.length === 0);

// THE PARENT PILL IS THE ONE THAT LIGHTS. _lastPlaylist gates the glow by
// name, and the chosen decade has no tile of its own to light.
c = card('Office');
c._sel = new Set([ent('office')]);
sheetCalls = []; calls = [];
c._play(decadePill);
sheetCalls[0].pick(DECADES[0]);
settle();
ok('_lastPlaylist keeps the PARENT name', c._lastPlaylist && c._lastPlaylist.name === 'Decades',
   c._lastPlaylist ? c._lastPlaylist.name : 'none');
window.hkCards.chooseSheet = realChoose;

// THE HOUSE PLAYLIST VOLUME and the target resolution belong to the
// integration with the rest of the request: the card sends the ROOMS, which is all music.py needs to level every one of them -- including
// a preset's, which a sync group would otherwise scale. Covered by
// tests/py/test_engine.py (test_house_volume_is_set_on_the_rooms,
// test_a_preset_plays_through_its_sync_group).


print('\n=== what the scripts reported is shown on the tablet ===');
// Kiosk mode hides the sidebar, so a persistent notification is invisible on
// a wall tablet. The picker subscribes and prints the music ones.
function findNotes(root) {
  var out = [];
  (function walk(n) { (n.children || []).forEach(function (k) {
    if (k.attrs && k.attrs['data-hk-note']) out.push(k); walk(k); }); })(root);
  return out;
}
var subs = [], unsubbed = 0;
c = card('Kitchen');
c.isConnected = true;
var h2 = mkHass('Kitchen');
h2.connection = { subscribeMessage: function (cb, msg) {
  subs.push({ cb: cb, msg: msg });
  return Promise.resolve(function () { unsubbed++; });
} };
c.hass = h2;
// The same connection also carries hkMusic's saved-focus subscription, so
// only the notification ones are counted here.
function noteSubs() {
  return subs.filter(function (s) { return s.msg.type === 'persistent_notification/subscribe'; });
}
ok('subscribes to persistent notifications', noteSubs().length === 1,
   JSON.stringify(subs.map(function (s) { return s.msg; })));
ok('  ...and hkMusic follows the saved focus on the same connection',
   subs.some(function (s) { return s.msg.type === 'frontend/subscribe_user_data' &&
                                    s.msg.key === 'hk_music_focus'; }));
c.hass = mkHass('Kitchen'); c.hass.connection = h2.connection; c.hass = c.hass;
ok('  ...once, however many hass objects arrive', noteSubs().length === 1, String(noteSubs().length));
noteSubs()[0].cb({ type: 'current', notifications: {
  speaker_group_failed: { notification_id: 'speaker_group_failed', title: 'Speakers did not group',
                          message: 'Loft did not join Office.', created_at: '2026-09-22T10:00:00' },
  some_repair: { notification_id: 'some_repair', title: 'Unrelated', message: 'x' } } });
var notes = findNotes(c._root);
ok('the music notification is drawn', notes.length === 1 &&
   notes[0].attrs['data-hk-note'] === 'speaker_group_failed', String(notes.length));
ok('  ...with its own words', /Loft did not join Office/.test(notes[0] && notes[0].textContent),
   notes[0] && notes[0].textContent);
ok('an unrelated notification is not', !findNotes(c._root).some(function (n) {
   return n.attrs['data-hk-note'] === 'some_repair'; }));
calls = [];
notes[0].click();
settle();
ok('tapping it dismisses it through Home Assistant',
   calls.some(function (x) { return x[0] === 'persistent_notification.dismiss' &&
                             x[1].notification_id === 'speaker_group_failed'; }),
   JSON.stringify(calls));
noteSubs()[0].cb({ type: 'removed', notifications: {
  speaker_group_failed: { notification_id: 'speaker_group_failed' } } });
ok('a removed notification leaves the page', findNotes(c._root).length === 0);
noteSubs()[0].cb({ type: 'added', notifications: {
  music_play_failed: { notification_id: 'music_play_failed', title: 'The playlist did not start',
                       message: 'Country did not start on Loft.' } } });
ok('a new failure appears as it happens', findNotes(c._root).length === 1);
c.isConnected = false;
c.disconnectedCallback();
settle();
ok('disconnecting unsubscribes', unsubbed === 1, String(unsubbed));
c.isConnected = true;
c.connectedCallback();
ok('reconnecting subscribes again', noteSubs().length === 2, String(noteSubs().length));
c = card('Kitchen');
c.hass = mkHass('Kitchen');
ok('no connection on the hass (tests, previews) -> no crash, no subscription',
   !c._noteSub);


print('\n=== a request reports back, and the screen follows the answer ===');
// The script is CALLED and its answer read: {ok, leader} or {ok:false, message}.
function reqCard(answer) {
  var c = card('Kitchen');
  c._callResp = function () { return Promise.resolve(answer); };
  return c;
}
var rc = reqCard({ ok: true, response: { ok: true, leader: ent('office') } });
var op0 = rc._playOp = 7;
rc._request('script.group_selected_speakers', {}, ent('loft'), op0);
ok('the target is held on screen while the request runs',
   window.hkMusic.focus() === ent('loft') && window.hkMusic.resolve(rc.hass).reason === 'pending',
   window.hkMusic.focus());
settle();
ok('the LEADER the script reports wins over the card\'s guess',
   window.hkMusic.focus() === ent('office'), window.hkMusic.focus());
ok('  ...and nothing is reported as wrong', !rc._notice, rc._notice);

rc = reqCard({ ok: true, response: { ok: false, message: 'The speakers did not group' } });
rc._playOp = 3;
rc._request('script.group_selected_speakers', {}, ent('loft'), 3);
settle();
ok('a refusal ANSWER is a failure, in the script\'s own words',
   rc._notice === 'That did not work: The speakers did not group.', rc._notice);
ok('  ...and the silent room is not left holding the screen',
   window.hkMusic.resolve(rc.hass).reason !== 'pending', window.hkMusic.resolve(rc.hass).reason);

rc = reqCard({ ok: false, error: 'Connection lost' });
rc._playOp = 4;
rc._request('script.play_playlist', {}, ent('loft'), 4);
settle();
ok('a rejected call is a failure too', rc._notice === 'That did not work: Connection lost.', rc._notice);

rc = reqCard({ ok: true, response: { ok: false, message: 'x' } });
rc._playOp = 5;
rc._request('script.play_playlist', {}, ent('loft'), 5);
rc._playOp = 6;                    // the person has moved on before it answered
settle();
ok('a late failure for an old press does not overwrite the page', !rc._notice, rc._notice);

rc = reqCard({ ok: true, response: { ok: true, leader: ent('office'), message: 'Kitchen did not join.' } });
rc._playOp = 8;
rc._request('play', {}, ent('office'), 8);
settle();
ok('a success WITH a message (some rooms did not join) is shown to the one who pressed',
   rc._notice === 'Playing, but Kitchen did not join.', rc._notice);

print('\n=== an old failure message does not outlive the next thing ===');
rc = reqCard({ ok: true, response: { ok: false, message: 'The speakers did not group' } });
rc.isConnected = true; rc.connectedCallback();
rc._playOp = 9;
rc._request('script.group_selected_speakers', {}, ent('loft'), 9);
settle();
ok('the failure is shown', /did not group/.test(rc._notice), rc._notice);
window.hkMusic.setFocus(ent('office'));          // the screen moved on
ok('  ...and cleared when the focus moves on', rc._notice === '', rc._notice);
rc.disconnectedCallback();
print('\n' + (fail ? 'FAILURES: '+fail : 'ALL '+pass+' LOGIC TESTS PASS'));
