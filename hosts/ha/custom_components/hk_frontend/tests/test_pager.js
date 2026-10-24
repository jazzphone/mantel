// HOME GRID, slice G4 (docs/phase11/HOME-GRID.md, "Blocks that swipe"): a
// block's pages from each source (hk-grid-catalog.js pages()), the pager's
// start page, the doorbell's jump, the return on idle, and which touches the
// pager claims (hk-layout.js hk-pager-card). The swipe itself, in a real
// browser, is checked against Mantel.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run pager');
load(HK_ROOT + '/tests/dom.js');
(function () {                           // the view's reconcile needs these (as test_homegrid.js)
  var E = Object.getPrototypeOf(document.createElement('div'));
  if (!E.insertBefore) {
    E.insertBefore = function (c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      var i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      c.parentNode = this; return c;
    };
    Object.defineProperty(E, 'childNodes', { get: function () { return this.children; } });
    Object.defineProperty(E, 'lastChild', { get: function () { return this.children[this.children.length - 1] || null; } });
  }
  if (!('firstChild' in E)) Object.defineProperty(E, 'firstChild', { get: function () { return this.children[0] || null; } });
})();
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
var G = window.hkGridCatalog, P = window.hkLayout.pager;
function ids(pages, k) { return pages.map(function (p) { return p[k || 'entity'] || null; }); }

// ---- the six sources
var ctx = {
  rooms: ['kitchen', 'den', 'porch'],
  cameras: ['camera.driveway', 'camera.front_doorbell', 'camera.yard'],
  climate: ['climate.attic', 'climate.den', 'climate.kitchen'],
  areas: { 'climate.attic': null, 'climate.den': 'den', 'climate.kitchen': 'kitchen', 'camera.yard': 'porch' },
  scenes: ['scene.a', 'scene.b', 'scene.c', 'scene.d', 'scene.e', 'scene.f', 'scene.g'],
  speakers: [{ entity: 'media_player.kitchen', area: 'kitchen' }, { entity: 'media_player.den', area: 'den' },
             { entity: 'media_player.downstairs' }]
};
print('=== sources ===');
var list = G.pages({ card: 'scenes', size: 'W', pages: { source: 'list', list: [
  { opts: { scenes: ['scene.a', 'scene.b'] } }, { opts: { scenes: ['scene.c'] } }] } }, ctx);
ok('list: a page per page set up, each the block\'s card with its own options',
   list.length === 2 && list[0].card.type === 'custom:hk-scenes-card' && list[1].card.scenes.join() === 'scene.c');
ok('...a scenes page shows just its scenes, never the screen\'s Scenes choice', list[0].card.room === true);
var rooms = G.pages({ card: 'room', size: 'L', pages: { source: 'rooms' } }, ctx);
ok('rooms: one room card per room, in the screen\'s order', ids(rooms, 'area').join() === 'kitchen,den,porch' &&
   rooms[1].card.area === 'den', ids(rooms, 'area'));
var cams = G.pages({ card: 'camera', size: 'L', pages: { source: 'cameras' } }, ctx);
ok('cameras: one per camera, in Cameras\' order', ids(cams).join() === 'camera.driveway,camera.front_doorbell,camera.yard' &&
   cams[2].card.cameras.length === 1 && cams[2].card.cameras[0].entity === 'camera.yard' && cams[2].area === 'porch');
var th = G.pages({ card: 'thermostat', size: 'T', pages: { source: 'thermostats' } }, ctx);
ok('thermostats: one per climate entity, in room order (no room last)',
   ids(th).join() === 'climate.kitchen,climate.den,climate.attic' && th[0].card.type === 'custom:hk-control-card' &&
   th[0].card.entity === 'climate.kitchen' && th[0].area === 'kitchen', ids(th));
var sp = G.pages({ card: 'now_playing', size: 'L', opts: { speaker: 'tablet_room' }, pages: { source: 'speakers' } }, ctx);
ok('speakers: one per speaker or group', ids(sp).join() === 'media_player.kitchen,media_player.den,media_player.downstairs' &&
   sp[1].card.entity === 'media_player.den', ids(sp));
ok('...the page\'s option over the block\'s own (tablet_room here)', sp[0].card.entity === 'media_player.kitchen');
['W', 'L', 'XL'].forEach(function (size) {
  var per = { W: 2, L: 4, XL: 6 }[size], sc = G.pages({ card: 'scenes', size: size, pages: { source: 'scenes' } }, ctx);
  ok('scenes at ' + size + ': ' + per + ' to a page, as many pages as that takes',
     sc.length === Math.ceil(7 / per) && sc[0].card.scenes.length === per && sc[sc.length - 1].card.scenes.slice(-1)[0] === 'scene.g' &&
     sc[0].card.room === true, sc.map(function (p) { return p.card.scenes.length; }));
});
var many = { rooms: [] };
for (var r = 0; r < 20; r++) many.rooms.push('room_' + r);
ok('at most 12 pages, as hk_core checks a list', G.pages({ card: 'room', size: 'L', pages: { source: 'rooms' } }, many).length === G.PAGES_MAX &&
   G.PAGES_MAX === 12);
var none = G.pages({ card: 'thermostat', size: 'T', pages: { source: 'thermostats' } }, {});
ok('nothing in the house to show: one page, the block\'s card as it is', none.length === 1 && none[0].card.type === 'custom:hk-key-card');
ok('a source the card can\'t page is no pager', G.config({ card: 'room', size: 'L', pages: { source: 'cameras' } }, ctx).type !== 'custom:hk-pager-card');

// ---- the tablet's room
print('\n=== the tablet\'s room ===');
ok('no tablet: no room', G.tabletRoom() === null);
window.hkSettings = { tablet: function () { return { id: 'kitchen_tablet', room: 'den' }; }, get: function (k, f) { return f; } };
ok('a tablet\'s room, from hkSettings.tablet()', G.tabletRoom() === 'den');

// ---- the start page
print('\n=== the start page ===');
function item(src, start) { return { card: 'x', pages: start ? { source: src, start: start } : { source: src } }; }
ok('rooms with start: tablet_room open on the tablet\'s room', P.start(rooms, item('rooms', 'tablet_room'), { room: 'den' }) === 1);
ok('...the first page without start', P.start(rooms, item('rooms'), { room: 'den' }) === 0);
ok('...and the first when the tablet\'s room has no page', P.start(rooms, item('rooms', 'tablet_room'), { room: 'garage' }) === 0);
ok('thermostats with start: tablet_room open on its room', P.start(th, item('thermostats', 'tablet_room'), { room: 'den' }) === 1);
ok('an explicit room starts there even with a legacy tablet-room flag', P.start(rooms, {card:'room', opts:{area:'den'}, pages:{source:'rooms',start:'tablet_room'}}, {room:'kitchen'}) === 1);
ok('a chosen room works on an unassigned desktop', P.start(rooms, {card:'room', opts:{area:'den'}, pages:{source:'rooms'}}, {}) === 1);
ok('the tablet-room option resolves dynamically', P.start(rooms, {card:'room', opts:{area:'tablet_room'}, pages:{source:'rooms'}}, {room:'den'}) === 1);
ok('a missing starting room falls back to the first available page', P.start(rooms, {card:'room', opts:{area:'garage'}, pages:{source:'rooms'}}, {room:'den'}) === 0);
var playing = { 'media_player.den': { state: 'playing' }, 'media_player.kitchen': { state: 'paused' } };
ok('speakers start on the one playing', P.start(sp, item('speakers'), { room: 'kitchen', states: playing }) === 1);
ok('...else this user\'s own speaker', P.start(sp, item('speakers'), { room: 'kitchen', home: 'media_player.downstairs', states: {} }) === 2);
ok('...else the tablet\'s room', P.start(sp, item('speakers'), { room: 'den', states: {} }) === 1);
ok('cameras and lists start on the first', P.start(cams, item('cameras'), { room: 'porch' }) === 0);
ok('the doorbell\'s page: the camera the ring names', P.doorbell(cams, 'camera.yard') === 2);
ok('...else one called doorbell', P.doorbell(cams, null) === 1 && P.doorbell(cams, 'camera.gone') === 1);
ok('...else none', P.doorbell(rooms, 'camera.yard') === -1);

// ---- gestures
print('\n=== gestures ===');
function node(attrs, style, tag) {
  var e = document.createElement(tag || 'div');
  e.nodeType = 1; e.localName = tag || 'div';
  Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
  Object.keys(style || {}).forEach(function (k) { e.style[k] = style[k]; });
  return e;
}
var track = node(), page = node(), tile = node(), label = node();
var range = node({ type: 'range' }, null, 'input'); range.type = 'range';
var dial = node(null, { touchAction: 'pan-y' }), slider = node({ role: 'slider' }), own = node({ 'data-hk-control': '' });
var outer = node(null, { touchAction: 'pan-y' });
ok('a drag that starts on a tile is the pager\'s', P.claims([label, tile, page, track, outer], 300, track));
ok('...not one on a slider (a range)', !P.claims([range, page, track], 300, track));
ok('...not one on the thermostat\'s dial (touch-action pan-y)', !P.claims([label, dial, page, track], 300, track));
ok('...not one on a role=slider or data-hk-control', !P.claims([slider, track], 300, track) && !P.claims([own, track], 300, track));
ok('...nor one in the left 20 px: the menu\'s edge swipe', !P.claims([tile, track], 19, track) && P.claims([tile, track], 20, track) && P.EDGE === 20);
ok('only what is inside the track counts', P.claims([tile, track, outer], 300, track));
var part = node({ 'data-pager-part': '' }, { touchAction: 'pan-y' });
ok('the pager\'s own pan-y parts (a page, the dots) are no control', P.claims([label, tile, part, track], 300, track) &&
   !P.claims([label, dial, part, track], 300, track));

// ---- the element
print('\n=== a cameras block that follows ===');
var camPages = [{ entity: 'camera.front_door', area: 'porch' }, { entity: 'camera.yard', area: 'backyard' }, { entity: 'camera.garage', area: 'garage' }];
var ago = function (min) { return new Date(Date.now() - min * 60000).toISOString(); };
var motionItem = { pages: { source: 'cameras' }, opts: { follow: 'motion' } };
var ents = { 'binary_sensor.yard_motion': { area_id: 'backyard' }, 'binary_sensor.porch_motion': { area_id: 'porch' },
             'binary_sensor.garage_door': { area_id: 'garage' }, 'binary_sensor.hidden_motion': { area_id: 'garage', hidden: true } };
var mst = { 'binary_sensor.yard_motion': { state: 'off', last_changed: ago(2), attributes: { device_class: 'motion' } },
            'binary_sensor.porch_motion': { state: 'on', last_changed: ago(5), attributes: { device_class: 'occupancy' } },
            'binary_sensor.garage_door': { state: 'on', last_changed: ago(0), attributes: { device_class: 'door' } },
            'binary_sensor.hidden_motion': { state: 'on', last_changed: ago(0), attributes: { device_class: 'motion' } } };
ok('motion: the room where a sensor is on now wins over a later one that went off', P.follow(camPages, motionItem, { states: mst, entities: ents }) === 0);
mst['binary_sensor.porch_motion'].state = 'off';
ok('...with none on, the latest to change', P.follow(camPages, motionItem, { states: mst, entities: ents }) === 1);
mst['binary_sensor.yard_motion'].last_changed = ago(30); mst['binary_sensor.porch_motion'].last_changed = ago(40);
ok('...nothing in the last 15 minutes, and a door or a hidden sensor never counts: nothing to follow',
   P.follow(camPages, motionItem, { states: mst, entities: ents }) === -1);
var selItem = { pages: { source: 'cameras' }, opts: { follow: 'selector' } };
var sst = { 'input_select.live': { state: 'Yard' }, 'camera.yard': { attributes: { friendly_name: 'Yard Camera Low resolution' } },
            'camera.front_door': { attributes: { friendly_name: 'Front Door' } } };
ok('selector: the screen\'s Live Camera Follows, an option naming a camera by its first words',
   P.follow(camPages, selItem, { states: sst, board: { camera_live: 'input_select.live' } }) === 1);
sst['input_select.mine'] = { state: 'Front Door' };
ok('...the block\'s own selector first', P.follow(camPages, { pages: { source: 'cameras' }, opts: { follow: 'selector', follow_select: 'input_select.mine' } },
   { states: sst, board: { camera_live: 'input_select.live' } }) === 0);
ok('...not following, or not swiping all cameras: nothing', P.follow(camPages, { pages: { source: 'cameras' }, opts: {} }, { states: sst }) === -1 &&
   P.follow(camPages, { opts: { follow: 'motion' } }, { states: mst, entities: ents }) === -1);

print('\n=== hk-pager-card ===');
var made = [];
window.hkCards.createCard = function (cfg, client) { var e = document.createElement('card'); e.cfg = cfg; made.push(cfg); return e; };
var away = [];
window.hkIdle = { away: function (k, on) { away.push([k, on]); } };
var Pager = customElements.get('hk-pager-card');
ok('hk-pager-card is defined', !!Pager);
function walk(el, out) { out = out || []; (el.children || []).forEach(function (c) { out.push(c); walk(c, out); }); return out; }
function byClass(el, c) { return walk(el).filter(function (x) { return (' ' + x.className + ' ').indexOf(' ' + c + ' ') >= 0; }); }

var block = { id: 'a5', card: 'thermostat', size: 'T', pages: { source: 'thermostats', start: 'tablet_room' } };
var pg = new Pager();
pg.setConfig(G.config(block, ctx));
var slots = byClass(pg._root, 'page'), dots = byClass(pg._root, 'dot');
ok('a page and a dot per thermostat', slots.length === 3 && dots.length === 3);
ok('VoiceOver hears "2 of 3"', slots[1].attrs['aria-label'] === '2 of 3' && dots[1].attrs['aria-label'] === '2 of 3');
ok('it opens on the tablet\'s room (den, page 2)', pg._index === 1 && dots[1].attrs['aria-current'] === 'true' &&
   dots[0].attrs['aria-current'] === 'false', pg._index);
ok('only that page and its neighbours are made', made.length === 3 && slots[0].children.length === 1);
ok('each page\'s card has the block\'s size', slots[1].children[0].attrs.size === 'T' && slots[1].attrs.size === 'T');

// connected, and a width: the track scrolls
var scrolled = [];
pg.isConnected = true;
pg._track.clientWidth = 196;
pg._track.scrollTo = function (o) { scrolled.push(o); this.scrollLeft = o.left; };
pg.connectedCallback();
ok('connected, it turns to its page at once', scrolled.length && scrolled[scrolled.length - 1].left === 196 &&
   scrolled[scrolled.length - 1].behavior === 'auto', scrolled);
dots[2].click();
ok('a dot turns to its page, smoothly', pg._index === 2 && scrolled[scrolled.length - 1].left === 392 &&
   scrolled[scrolled.length - 1].behavior === 'smooth');
ok('...and says where it is', byClass(pg._root, 'say')[0].textContent === '3 of 3');
ok('off its start page it tells hk-idle (the timer arms on Home)', away.length && away[away.length - 1][1] === true, away);
// a swipe: the track came to rest on page 1
pg._track.scrollLeft = 0; pg._settle();
ok('a swipe that comes to rest is the page it rests on', pg._index === 0);

print('\n=== the return, the doorbell ===');
window.dispatchEvent(new CustomEvent('hk-idle-return'));
ok('the idle return goes back to the start page, at once', pg._index === 1 && scrolled[scrolled.length - 1].left === 196 &&
   scrolled[scrolled.length - 1].behavior === 'auto');
ok('...and lets hk-idle go', away[away.length - 1][1] === false, away);
var cp = new Pager();
cp.setConfig(G.config({ id: 'a6', card: 'camera', size: 'L', pages: { source: 'cameras' } }, ctx));
cp.isConnected = true; cp._track.clientWidth = 402; cp._track.scrollTo = function (o) { this.scrollLeft = o.left; };
cp.connectedCallback();
ok('a cameras block starts on the first camera', cp._index === 0);
window.dispatchEvent(new CustomEvent('hk-house-event', { detail: { type: 'notification', kind: 'person', camera: 'camera.yard' } }));
ok('a notification that is no ring moves nothing', cp._index === 0);
window.dispatchEvent(new CustomEvent('hk-house-event', { detail: { type: 'notification', kind: 'doorbell', camera: 'camera.front_doorbell' } }));
ok('a doorbell ring jumps to the doorbell\'s page', cp._index === 1 && cp._track.scrollLeft === 402);
ok('...a thermostats block doesn\'t move for it', pg._index === 1);
window.dispatchEvent(new CustomEvent('hk-idle-return'));
ok('...and the idle return takes it back', cp._index === 0);
cp.disconnectedCallback();
window.dispatchEvent(new CustomEvent('hk-house-event', { detail: { type: 'notification', kind: 'doorbell', camera: 'camera.yard' } }));
ok('taken off the page, it stops listening', cp._index === 0);

pg.goTo(2, false);
pg.setAttribute('size', 'L');
if (pg.attributeChangedCallback) pg.attributeChangedCallback('size', 'T', 'L');
ok('a new size rebuilds it on the page it was on', pg._index === 2 && byClass(pg._root, 'page').length === 3, pg._index);

print('\n=== the tab bar, and DESIGN.md ===');
var View = customElements.get('hk-home-grid-view'), gv = new View();
gv.setConfig({ grid: { cols: 6, rows: 4 }, cards: [] });
var css = gv._sr.children[0].textContent;
ok('the grid is the window less the tab bar\'s room (--hk-bar-room, else --hk-tabbar-h)',
   css.indexOf('--g-room:var(--hk-bar-room,var(--hk-tabbar-h,0px))') >= 0 && css.indexOf('height:calc(100dvh - var(--g-room))') >= 0 &&
   css.indexOf('height:100dvh') < 0);
ok('cells keep shadows and shared backdrop access without a clip-path root', /\.cell\{[^}]*overflow:visible/.test(css) &&
   !/\.cell\{[^}]*clip-path/.test(css));
var pcss = Pager.CSS;
ok('the dots: mark, the page it is on in ink, written with v()', pcss.indexOf('background:' + window.hkCards.v('mark')) >= 0 &&
   pcss.indexOf('[aria-current=true] i{background:' + window.hkCards.v('ink')) >= 0 && pcss.indexOf('opacity:.35') < 0);
ok('...a fade (DUR.fade), none under Reduce Motion', pcss.indexOf('background-color ' + window.hkCards.DUR.fade) >= 0 &&
   pcss.indexOf('prefers-reduced-motion:reduce') >= 0);
ok('...iOS\'s page control: a dot every 16 px, 44 px tall, in one centred group that is the target',
   /\.dot\{[^}]*flex:0 1 16px[^}]*height:44px/.test(pcss) && /\.pc\{[^}]*height:44px[^}]*pointer-events:auto/.test(pcss) &&
   /\.dots\{[^}]*pointer-events:none/.test(pcss));
ok('the track leaves the plates\' shadows their reach (28 px), and takes no touches of its own',
   pcss.indexOf('margin:-28px -28px -28px') >= 0 && pcss.indexOf('gap:56px') >= 0 &&
   pcss.indexOf('.track{pointer-events:none}.page{pointer-events:auto}') >= 0);
ok('the swipe is the pager\'s own (no scroll-snap); a page leaves up-and-down pans to the browser',
   pcss.indexOf('scroll-snap') < 0 && /\.page\{[^}]*touch-action:pan-y/.test(pcss));
ok('...and the track is still a sideways scroller, so the shared blur\'s layer rides inside it',
   /\.track\{[^}]*overflow-x:auto;overflow-y:hidden/.test(pcss));
ok('the dots overlay the foot: pages keep the full block height', pcss.indexOf('.dots{position:absolute;bottom:0;left:0;right:0') >= 0);
var calm = [];
window.matchMedia = function (q) { return { matches: /reduce/.test(q) }; };
var cv = new Pager();
cv.setConfig(G.config({ id: 'a7', card: 'room', size: 'L', pages: { source: 'rooms' } }, ctx));
cv._track.clientWidth = 422; cv._track.scrollTo = function (o) { calm.push(o.behavior); };
byClass(cv._root, 'dot')[2].click();
ok('Reduce Motion: a dot\'s tap turns the page without a slide', calm[calm.length - 1] === 'auto', calm);
window.matchMedia = function () { return { matches: false }; };
window.hkSettings.rendering = function () { return { flat: true, motion: false }; };
byClass(cv._root, 'dot')[0].click();
ok('...nor in Flat, its motion off', calm[calm.length - 1] === 'auto', calm);
delete window.hkSettings.rendering;
byClass(cv._root, 'dot')[1].click();
ok('...otherwise it slides', calm[calm.length - 1] === 'smooth', calm);

print('\n=== speakers ===');
var MUSIC = [{ entity: 'media_player.group_all', name: 'Everywhere', members: ['media_player.den'] },
             { entity: 'media_player.kitchen', name: 'Kitchen' }, { entity: 'media_player.den', name: 'Den' }];
var musicFns = [];
window.hkMusic = { speakers: function () { return MUSIC.slice(); }, home: function () { return null; },
                   onChange: function (fn) { musicFns.push(fn); return function () {}; } };
var spk = new Pager();
spk.client = { states: { 'media_player.den': { state: 'playing' } }, entities: { 'media_player.kitchen': { area_id: 'kitchen' } } };
spk.setConfig(G.config({ id: 'a3', card: 'now_playing', size: 'L', pages: { source: 'speakers' } }, ctx));
ok('a speakers block: the Music feature\'s speakers, each room\'s first, then the groups',
   ids(spk._pages).join() === 'media_player.kitchen,media_player.den,media_player.group_all', ids(spk._pages));
ok('...starting on the one playing', spk._index === 1);
ok('...a speaker\'s room from its entity', spk._pages[0].area === 'kitchen');

print(fail ? 'FAIL ' + fail + ' PAGER TESTS' : 'ALL ' + pass + ' PAGER TESTS PASS');
