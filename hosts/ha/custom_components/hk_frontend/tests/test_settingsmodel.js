// The HK Settings page's decisions (panels/hk-settings-model.js): what each
// list shows and what a change to it SAVES, how a screen value says it
// follows All Screens, the menu's three modes, the sky's dates, search. The
// page draws; this is what it draws from.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
var M = (typeof window !== 'undefined' ? window : globalThis).hkSettingsModel;

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
var KINDS = ['weather_alert', 'security', 'doors_windows', 'climate', 'lights', 'blinds', 'timers', 'vacuums',
             'speakers', 'water', 'energy'];

// ------------------------------------------------------------ chips
var m = M.chipsModel({ chips: [], chips_extra: ['sensor.mail'], chips_quiet: ['water'] }, KINDS);
ok('chips: nothing saved is automatic -- every kind, own chips after', m.auto && eq(m.rows.map(function (r) { return r.value; }), KINDS.concat('sensor.mail')));
ok('...quiet is per chip, own chips are never quiet', m.rows[9].quiet === true && m.rows[11].own && !m.rows[11].quiet);
ok('...nothing to add while automatic', m.more.length === 0);
m = M.chipsModel({ chips: ['lights', 'sensor.mail', 'security'], chips_extra: ['sensor.mail', 'sensor.battery'] }, KINDS);
ok('chips: a set list is its order, then own chips not placed yet', !m.auto &&
   eq(m.rows.map(function (r) { return r.value; }), ['lights', 'sensor.mail', 'security', 'sensor.battery']));
ok('...More is the kinds not shown', m.more.length === 9 && m.more[0].value === 'weather_alert');
m = M.chipsModel({ chips: ['lights', 'sensor.gone'], chips_extra: [] }, KINDS);
ok('chips: an entity in the order that is no longer an own chip is dropped', eq(m.rows.map(function (r) { return r.value; }), ['lights']));
ok('chips: the Shown list saves as the order, own chips as chips_extra',
   eq(M.chipsSave(['security', 'sensor.mail', 'lights'], KINDS), { chips_extra: ['sensor.mail'], chips_custom: [], chips: ['security', 'sensor.mail', 'lights'] }));
// CUSTOM CHIPS
var LIB = [{ key: 'mail', name: 'Mail', after: 'weather_alert' }, { key: 'battery', name: 'House Battery', after: 'end' }];
m = M.chipsModel({ chips: [], chips_extra: [], chips_custom: ['mail', 'battery'] }, KINDS, LIB);
ok('custom chips: listed where they sit, automatic still', m.auto &&
   eq(m.rows.map(function (r) { return r.value; }), [KINDS[0], 'chip:mail'].concat(KINDS.slice(1), ['chip:battery'])) &&
   m.rows[1].custom && m.rows[1].name === 'Mail', m.rows.map(function (r) { return r.value; }));
ok('...the automatic order saved is automatic still (and says which)',
   eq(M.chipsSave(m.rows.map(function (r) { return r.value; }), KINDS, LIB), { chips_extra: [], chips_custom: ['mail', 'battery'], chips: [] }));
var moved = m.rows.map(function (r) { return r.value; }).filter(function (v) { return v !== 'chip:battery'; });
moved.splice(3, 0, 'chip:battery');
ok('...moved: saved as an order that places it', M.chipsSave(moved, KINDS, LIB).chips[3] === 'chip:battery');
m = M.chipsModel({ chips: [], chips_extra: [], chips_custom: ['mail'] }, KINDS, LIB);
ok('...one not shown is offered under More, even while automatic', m.more.length === 1 && m.more[0].value === 'chip:battery');
ok('...added: only which changes', eq(M.chipsAddCustom({ chips_custom: ['mail'] }, 'battery'), { chips_custom: ['mail', 'battery'] }));
ok('...removed: from which, and from the order', eq(M.chipsRemoveCustom({ chips_custom: ['mail', 'battery'], chips: ['lights', 'chip:battery'] }, 'battery'),
   { chips_custom: ['mail'], chips: ['lights'] }));
m = M.chipsModel({ chips: ['lights', 'chip:gone'], chips_extra: [], chips_custom: ['gone'] }, KINDS, LIB);
ok('...one the library no longer has is not listed', m.rows.every(function (r) { return r.value !== 'chip:gone'; }));
ok('chips: an own chip added while automatic stays automatic',
   eq(M.chipsAddOwn({ chips: [], chips_extra: [] }, 'sensor.mail'), { chips_extra: ['sensor.mail'], chips: [] }));
ok('...and while set joins the end of the order',
   eq(M.chipsAddOwn({ chips: ['lights'], chips_extra: [] }, 'sensor.mail'), { chips_extra: ['sensor.mail'], chips: ['lights', 'sensor.mail'] }));
ok('...and several at once (a picker\'s Select), each once',
   eq(M.chipsAddOwn({ chips: ['lights'], chips_extra: [] }, ['sensor.a', 'sensor.b', 'sensor.a']),
      { chips_extra: ['sensor.a', 'sensor.b'], chips: ['lights', 'sensor.a', 'sensor.b'] }));
ok('chips: an own chip removed leaves both lists',
   eq(M.chipsRemoveOwn({ chips: ['lights', 'sensor.mail'], chips_extra: ['sensor.mail'] }, 'sensor.mail'), { chips_extra: [], chips: ['lights'] }));
ok('chips: quiet on and off', eq(M.chipQuiet({ chips_quiet: ['water'] }, 'lights', true), { chips_quiet: ['water', 'lights'] }) &&
   eq(M.chipQuiet({ chips_quiet: ['water', 'lights'] }, 'water', false), { chips_quiet: ['lights'] }));

// ------------------------------------------------------------ scenes
var SP = ['weather', 'cameras', 'live_tv', 'music'];
m = M.scenesModel({ scenes: [], scenes_pages: ['live_tv'] }, ['scene.a', 'scene.b'], SP);
ok('scenes: automatic is every scene, then the page pills', m.auto && eq(m.rows.map(function (r) { return r.value; }), ['scene.a', 'scene.b', 'page:live_tv']));
ok('...More offers the other pages as pills', eq(m.more.map(function (r) { return r.page; }), ['weather', 'cameras', 'music']));
m = M.scenesModel({ scenes: ['page:music', 'scene.b', 'page:weather'], scenes_pages: ['music', 'live_tv'] }, [], SP);
ok('scenes: a placed pill whose page is not a pill any more is dropped; an unplaced pill joins the end',
   eq(m.rows.map(function (r) { return r.value; }), ['page:music', 'scene.b', 'page:live_tv']));
ok('scenes: saving says which pages are pills',
   eq(M.scenesSave(['scene.b', 'page:cameras']), { scenes: ['scene.b', 'page:cameras'], scenes_pages: ['cameras'] }));
ok('scenes: a pill while automatic changes only scenes_pages',
   eq(M.scenesPagePill({ scenes: [], scenes_pages: [] }, 'music', true), { scenes_pages: ['music'] }));
ok('...and while set is placed at the end / taken out',
   eq(M.scenesPagePill({ scenes: ['scene.a'], scenes_pages: [] }, 'music', true), { scenes_pages: ['music'], scenes: ['scene.a', 'page:music'] }) &&
   eq(M.scenesPagePill({ scenes: ['page:music', 'scene.a'], scenes_pages: ['music'] }, 'music', false), { scenes_pages: [], scenes: ['scene.a'] }));

// ------------------------------------------------------------ pages
var PO = ['weather', 'cameras', 'music', 'browse', 'lights', 'rooms'];
var CUSTOM = { energy: 'Energy', ecoflow: 'EcoFlow' };
m = M.pagesModel({ pages: [], custom_pages: ['energy'] }, PO, CUSTOM);
ok('pages: automatic is every kind with this screen’s custom pages before the rooms',
   m.auto && eq(m.rows.map(function (r) { return r.value; }), ['weather', 'cameras', 'music', 'lights', 'energy', 'rooms']));
ok('...Browse Music is no page of its own (part of Music), a custom page is marked', m.rows.every(function (r) { return r.value !== 'browse' && !r.fixed; }) && m.rows[4].custom);
ok('...More is the custom pages not shown', eq(m.more.map(function (r) { return r.value; }), ['ecoflow']));
m = M.pagesModel({ pages: ['lights', 'music', 'browse', 'weather'], custom_pages: ['ecoflow'] }, PO, CUSTOM);
ok('pages: a set order (an older saved Browse dropped); a shown custom page goes before the rooms (or last)',
   eq(m.rows.map(function (r) { return r.value; }), ['lights', 'music', 'weather', 'ecoflow']));
ok('pages: saving never keeps Browse, and says which custom pages',
   eq(M.pagesSave(['browse', 'lights', 'energy'], CUSTOM), { pages: ['lights', 'energy'], custom_pages: ['energy'] }) &&
   eq(M.pagesSave(['music', 'lights'], CUSTOM), { pages: ['music', 'lights'], custom_pages: [] }));
ok('pages: a custom page while automatic changes only custom_pages',
   eq(M.pagesCustom({ pages: [], custom_pages: [] }, 'energy', true), { custom_pages: ['energy'] }));
ok('...and while set is placed before the rooms',
   eq(M.pagesCustom({ pages: ['lights', 'rooms'], custom_pages: [] }, 'energy', true), { custom_pages: ['energy'], pages: ['lights', 'energy', 'rooms'] }));

// ------------------------------------------------------------ where in the menu
var KEYS = ['weather', 'security', 'lights', 'music', 'browse', 'water', 'energy', 'rooms'];
var CUS = { energy: 'Energy' };
var IT = M.menuItems(KEYS, CUS);
var byPath = function (p) { return IT.filter(function (x) { return x.path === p; })[0]; };
ok('menu items: the pages a generated screen places (not Browse Music, not rooms), by view path',
   IT.map(function (x) { return x.path; }).join() === 'weather,security,lights,playmusic,water,energy');
ok('automatic: Weather at the top, every other page under Categories',
   M.placeOf({}, byPath('weather'), IT) === 'top' && M.placeOf({}, byPath('water'), IT) === 'list' &&
   M.placeOf({}, byPath('energy'), IT) === 'list');
ok('a set list: by view path (Play Music is playmusic)',
   M.placeOf({ categories: ['playmusic'] }, byPath('playmusic'), IT) === 'list' &&
   M.placeOf({ categories: ['playmusic'] }, byPath('lights'), IT) === 'off');
ok('Not in Menu from automatic: the others listed, in page order',
   eq(M.placeSet({}, IT, 'water', 'off'), { menu_top: [], categories: ['security', 'lights', 'playmusic', 'energy'] }));
ok('...and back: automatic again (follows new pages)',
   eq(M.placeSet({ categories: ['security', 'lights', 'playmusic', 'energy'] }, IT, 'water', 'list'), { menu_top: [], categories: [] }));
ok('EcoFlow-style: a custom page to the top; the rest stay automatic',
   eq(M.placeSet({}, IT, 'energy', 'top'), { menu_top: ['weather', 'energy'], categories: [] }));
var wDown = M.placeSet({}, IT, 'weather', 'list');
ok('Weather down among the categories: nothing at the top ("-", not empty -- empty is the defaults)',
   eq(wDown, { menu_top: ['-'], categories: [] }), wDown);
ok('...and it reads back that way', M.placeOf(wDown, byPath('weather'), IT) === 'list');
ok('...back up: the defaults again', eq(M.placeSet(wDown, IT, 'weather', 'top'), { menu_top: [], categories: [] }));
ok('a stale path (Browse Music, a page no longer here) is dropped',
   eq(M.placeSet({ categories: ['security', 'music-browse', 'vacuums'] }, IT, 'lights', 'list'), { menu_top: [], categories: ['security', 'lights'] }));
ok('the last page cannot leave Categories (empty means every page)',
   M.placeSet({ categories: ['security'] }, IT, 'security', 'off') === null);
var PW = M.menuItems(['security', 'energy', 'power', 'rooms'], {});
ok('the Power page can be placed like the others (its row had no pop-up)',
   PW.map(function (x) { return x.path; }).join() === 'security,energy,power' &&
   M.placeOf({}, PW[2], PW) === 'list' &&
   eq(M.placeSet({}, PW, 'power', 'off'), { menu_top: [], categories: ['security', 'energy'] }) &&
   eq(M.placeSet({}, PW, 'power', 'top'), { menu_top: ['power'], categories: [] }));
ok('Phones\' button style labels', M.phoneStyleLabel('chip_scroll') === 'Chip, Then Tab' && M.phoneStyleLabel(undefined) === 'Chip');

// ------------------------------------------------------------ rooms
var AZ = ['attic', 'garage', 'kitchen'];
m = M.roomsModel({ room_order: [], home_rooms: 'as_is' }, AZ);
ok('rooms: automatic is every room, A to Z', m.auto && m.rows.length === 3 && !m.more.length);
m = M.roomsModel({ room_order: ['kitchen', 'attic'], home_rooms: 'only' }, AZ);
ok('rooms: "only" shows the listed rooms on Home, the rest under Not on Home',
   eq(m.rows.map(function (r) { return r.value; }), ['kitchen', 'attic']) && eq(m.more.map(function (r) { return r.value; }), ['garage']));
m = M.roomsModel({ room_order: ['kitchen'], home_rooms: 'order' }, AZ);
ok('rooms: "order" shows every room, the listed ones first', eq(m.rows.map(function (r) { return r.value; }), ['kitchen', 'attic', 'garage']));
ok('rooms: saving all is "order", fewer is "only"',
   eq(M.roomsSave(['garage', 'attic', 'kitchen'], AZ), { room_order: ['garage', 'attic', 'kitchen'], home_rooms: 'order' }) &&
   eq(M.roomsSave(['garage'], AZ), { room_order: ['garage'], home_rooms: 'only' }));
ok('rooms: back to automatic', eq(M.roomsAuto(), { room_order: [], home_rooms: 'as_is' }));

// ------------------------------------------------------------ cameras
var cams = M.autoCameras(['camera.door_high', 'camera.door_low', 'camera.yard'], function (id) { return /door/.test(id) ? 'd1' : 'd2'; });
ok('cameras: automatic is one per device, its low channel', eq(cams, ['camera.door_low', 'camera.yard']));
m = M.camerasModel({ cameras: ['camera.yard', 'camera.gone'] }, ['camera.door_low', 'camera.yard'], cams);
ok('cameras: a set list drops cameras that are gone; More is the rest', !m.auto && m.rows.length === 1 && m.more[0].value === 'camera.door_low');

// ------------------------------------------------------------ menu
ok('menu: three modes', M.menuMode({ menu: 'off' }) === 'off' && M.menuMode({ menu: 'open' }) === 'open' && M.menuMode({ menu: 'chip_home' }) === 'button');
ok('menu: Button keeps its style; from off/open it starts Automatic (or the last one)',
   M.menuFor('button', { menu: 'tab' }) === 'tab' && M.menuFor('button', { menu: 'off' }) === 'auto' && M.menuFor('button', { menu: 'open' }, 'chip') === 'chip');
ok('menu: Tab Position only for styles that can show the tab',
   M.showsTab({ menu: 'chip_scroll' }) && M.showsTab({ menu: 'auto' }) && !M.showsTab({ menu: 'chip' }) && !M.showsTab({ menu: 'open' }));

// ------------------------------------------------------------ glass
var g = M.glassOf({ glass: 'house' }, { glass: 'blur' });
ok('glass: "house" follows All Screens and says what that is', !g.own && g.effective === 'blur' && g.house === 'blur');
g = M.glassOf({ glass: 'frosted' }, { glass: 'blur' });
ok('glass: its own', g.own && g.effective === 'frosted');
var a = M.amountOf({ frost: null }, { frost: 30 }, 'frost');
ok('amounts: null follows All Screens’', !a.own && a.value === 30);
a = M.amountOf({ blur: 0 }, { blur: 50 }, 'blur');
ok('amounts: 0 is a value of its own, not "follow"', a.own && a.value === 0);
ok('amounts: only the one the glass uses is shown', eq(M.amountsFor('frosted'), { frost: true, blur: false, tint: false }) &&
   eq(M.amountsFor('blur_each'), { frost: false, blur: true, tint: false }) && eq(M.amountsFor('clear'), { frost: false, blur: false, tint: false }) &&
   eq(M.amountsFor('tinted'), { frost: false, blur: false, tint: true }));

// ------------------------------------------------------------ sky
var BI = { halloween: { north: ['09-22', '10-31'], south: ['09-22', '10-31'] }, spring: { north: ['03-20', '06-20'], south: ['09-22', '12-20'] } };
var d = M.skyDate({ halloween_from: null, hemisphere: 'north' }, BI, 'halloween', 'from');
ok('sky: an unsaved date is the built-in one', !d.own && d.value === '09-22');
d = M.skyDate({ spring_to: null, hemisphere: 'south' }, BI, 'spring', 'to');
ok('sky: the southern hemisphere’s built-in date', d.value === '12-20');
ok('sky: dates read as words', M.dateLabel('10-31') === 'Oct 31' && M.dateLabel('thanksgiving') === 'Thanksgiving Day');

// ------------------------------------------------------------ search, errors
var r = M.search('glass', [{ path: 'dashboard-kitchen', title: 'Kitchen' }]);
ok('search: a screen setting is found once per screen, a house one once',
   r.some(function (x) { return x.route === 'screens/dashboard-kitchen/glass' && x.where === 'Kitchen'; }) &&
   r.some(function (x) { return x.route === 'house/appearance/glass'; }));
var hp = M.search('home page', [{ path: 'energy-tablet', title: 'Energy' }]).filter(function (x) { return x.label === 'Home Page' || /home_page|Home Page/.test(JSON.stringify(x)); });
ok('search: Home Page opens the screen\'s own Pages page (not the house\'s Custom Pages)',
   hp.length > 0 && hp.every(function (x) { return x.route === 'screens/energy-tablet/pages'; }), hp);
// THE TAB BAR IS A MENU, NEVER A BUTTON STYLE: All Screens' server refuses
// it as a style (settings.py MENU_STYLES), and a screen's would have turned
// its whole menu into the bar (2026-10-09 audit B1)
ok('no Tab Bar among the button styles', !M.MENU_STYLES.some(function (n) { return n[0] === 'tabbar'; }) &&
   !M.BUTTON_PHONE.some(function (n) { return n[0] === 'tabbar'; }));
ok('search: every word must match', M.search('wall photos', []).length === 1 && M.search('zzz', []).length === 0);
// THE ROW TO LIGHT UP: a screen's rows are b:<key> on the screen's page and on
// the pages under it -- Menu Settings and Hide Header lit nothing before
var keyOf = function (q, label) {
  var x = M.search(q, [{ path: 'dashboard-kitchen', title: 'Kitchen' }]).filter(function (y) { return y.label === label; })[0];
  return x && x.key;
};
ok('search: a screen page\'s row is lit by its b: label', keyOf('menu', 'Menu') === 'b:menu');
ok('...and so is one on a page under the screen (Menu Settings, Hide Header)',
   keyOf('menu settings', 'Menu Settings') === 'b:menu_custom' && keyOf('hide header', 'Hide Header') === 'b:kiosk_header');
ok('...while a key with its own prefix stays as it is',
   keyOf('forecast no photos', 'Forecast When There Are No Photos') === 'saver:fallback');
ok('...and a house setting keeps its own key', M.search('backdrop', []).filter(function (y) { return y.route === 'house/sky/backdrop'; })
   .every(function (y) { return !/^b:/.test(y.key); }));
ok('errors: a refusal map is read from the message', eq(M.refusals({ message: '{"look.glass":"choice"}' }), { 'look.glass': 'choice' }) &&
   M.refusals({ message: 'Unknown command' }) === null && /isn’t one of/.test(M.errorText('choice')));
ok('reorder', eq(M.move(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']) && eq(M.move(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']));

// LIVE CAMERA FOLLOWS: the option each camera needs, the sensor it follows,
// and the automation written for them
var CAMS = [
  { entity: 'camera.front_door_low', name: 'Front Door Low resolution channel', device: 'd1', deviceName: 'Front Door' },
  { entity: 'camera.deck_low', name: 'Deck Low resolution channel', device: 'd2', deviceName: 'Deck' },
  { entity: 'camera.porch', name: 'Porch Cam', device: 'd3', deviceName: 'Doorbell 2' },
  { entity: 'camera.garage', name: 'Garage', device: null, deviceName: null }];
var SENS = [{ entity: 'binary_sensor.front_door_motion', device: 'd1', kind: 'motion' },
            { entity: 'binary_sensor.front_door_person_detected', device: 'd1', kind: 'person' },
            { entity: 'binary_sensor.deck_motion', device: 'd2', kind: 'motion' }];
var plan = M.livePlan(CAMS, SENS);
ok('live: the option is the device name when the camera’s name starts with it',
   eq(plan.map(function (p) { return p.option; }), ['Front Door', 'Deck', 'Porch Cam', 'Garage']));
ok('...every option names its own camera the way the strip matches it',
   plan.every(function (p, i) { return M.liveNames(p.option, [CAMS[i].name]); }) && !M.liveNames('Fro', ['Front Door Low']) && M.liveNames('Front', ['Front Door Low']));
ok('...a person sensor before a motion one; none without a device',
   plan[0].sensor === 'binary_sensor.front_door_person_detected' && plan[1].sensor === 'binary_sensor.deck_motion' &&
   plan[2].sensor === null && plan[3].sensor === null);
ok('...two cameras on one device get distinct options',
   eq(M.livePlan([CAMS[0], { entity: 'camera.front_door_high', name: 'Front Door High resolution channel', device: 'd1',
                             deviceName: 'Front Door' }], []).map(function (p) { return p.option; }),
      ['Front Door', 'Front Door High resolution channel']));
var y = M.liveYaml(plan, 'input_select.live_camera');
ok('live: the automation triggers on each sensor with the camera’s option as its id',
   /entity_id: binary_sensor\.front_door_person_detected\n    to: "on"\n    id: "Front Door"/.test(y) &&
   /entity_id: binary_sensor\.deck_motion\n    to: "on"\n    id: "Deck"/.test(y) && !/porch|garage/i.test(y.split('actions:')[0].replace(/description.*\n/, '')));
ok('...five quiet minutes on every sensor go back to the first camera',
   /for:\n      minutes: 5\n    id: all quiet/.test(y) && /state: "off"\n      - action: input_select\.select_option[\s\S]*option: "Front Door"/.test(y));
ok('...otherwise it picks the camera that triggered', /else:\n      - action: input_select\.select_option[\s\S]*option: "\{\{ trigger\.id \}\}"/.test(y));
ok('...a select entity is set with select.select_option', /action: select\.select_option/.test(M.liveYaml(plan, 'select.cams')));
ok('...no sensors at all: nothing to write', M.liveYaml(M.livePlan([CAMS[3]], SENS), 'input_select.x') === null);
var kept = M.livePlan(CAMS, SENS, ['Front', 'Front Door', 'Garage', 'Kitchen']);
ok('live: a chosen dropdown keeps its own options, the longest that names each camera',
   kept[0].option === 'Front Door' && !kept[0].missing && kept[3].option === 'Garage' && kept[1].missing && kept[1].option === 'Deck');
var ky = M.liveYaml(kept, 'input_select.cameras');
ok('...and a camera it has no option for is left out of the automation',
   /id: "Front Door"/.test(ky) && !/Deck/.test(ky) && /option: "Front Door"\n    else/.test(ky));

// THE PREVIEW'S SIZE (a screen's page): the frame IS the device's size -- the
// dashboard lays itself out by its own window -- drawn scaled to the column.
var PS = M.previewSizes;
var keys = function (xs) { return xs.map(function (z) { return z.key; }).join(','); };
ok('four sizes for a screen: Phone, Tablet Portrait, Tablet Landscape, Desktop',
   keys(PS({})) === 'phone,portrait,landscape,desktop' &&
   PS({}).map(function (z) { return z.label; }).join('|') === 'Phone|Tablet Portrait|Tablet Landscape|Desktop');
ok('...and Car only where Car Browser is on', keys(PS({ car: true })) === 'phone,portrait,landscape,desktop,car');
var dim = function (k) { var z = PS({ car: true }).filter(function (x) { return x.key === k; })[0]; return z.w + 'x' + z.h; };
ok('the sizes: an iPhone, an iPad upright, the wall tablets, a desk, the car',
   dim('phone') === '390x844' && dim('portrait') === '820x1180' && dim('landscape') === '1280x800' &&
   dim('desktop') === '1440x900' && dim('car') === '804x638');
ok('Tablet Portrait is the tablet glyph turned upright, Landscape the same glyph as drawn',
   PS({})[1].icon === PS({})[2].icon && PS({})[1].rotate === true && !PS({})[2].rotate);
ok('it opens on the size the screen is used at: a car\'s browser -> Car',
   M.previewDefault({ car: true }) === 'car');
ok('...a wall tablet (its own user, WallPanel, back to Home when idle) -> Tablet Landscape',
   M.previewDefault({ tablet_user: 'u' }) === 'landscape' && M.previewDefault({ screensaver: true }) === 'landscape' &&
   M.previewDefault({ idle_return: true }) === 'landscape');
ok('...anything else -> Desktop', M.previewDefault({ menu: 'open' }) === 'desktop' && M.previewDefault(null) === 'desktop');
var f = M.previewFit(410, 560, { w: 1280, h: 800 });
ok('landscape: as wide as the column, height to match',
   Math.round(f.width) === 410 && Math.round(f.height) === 256 && Math.abs(f.scale - 410 / 1280) < 1e-9, JSON.stringify(f));
f = M.previewFit(410, 560, { w: 390, h: 844 });
ok('a phone: no taller than the cap, so a narrow screen in the middle',
   Math.round(f.height) === 560 && Math.round(f.width) === 259 && f.width < 410, JSON.stringify(f));
f = M.previewFit(410, 560, { w: 820, h: 1180 });
ok('an iPad upright: the cap decides too', Math.round(f.height) === 560 && Math.round(f.width) === 389, JSON.stringify(f));
f = M.previewFit(0, 560, { w: 1280, h: 800 });
ok('a column not laid out yet: a sane size, not zero', f.width > 0 && f.height > 0, JSON.stringify(f));

// THE SKY'S PREVIEW: which screen shows it, and in which moments
var DASH = [
  { path: 'ecoflow-panel', title: 'EcoFlow Panel', item: true, generated: true },
  { path: 'dashboard-kitchen', title: 'Kitchen', item: true, generated: true },
  { path: 'dashboard-home', title: 'Home', item: true, generated: true },
  { path: 'map', title: 'Map', item: false, generated: false }];
var BOARDS = { 'ecoflow-panel': { home_page: false }, 'dashboard-kitchen': { tablet_user: 'u' }, 'dashboard-home': {} };
ok('the sky previews on the house\'s Home', M.skyPreviewScreen(DASH, BOARDS) === 'dashboard-home');
ok('...else a wall tablet\'s screen', M.skyPreviewScreen(DASH.filter(function (d) { return d.title !== 'Home'; }), BOARDS) === 'dashboard-kitchen');
ok('...never one with its sky off, or with no Home page (an Energy panel)',
   M.skyPreviewScreen(DASH, { 'ecoflow-panel': { home_page: false }, 'dashboard-kitchen': { sky: false }, 'dashboard-home': { sky: false } }) === null);
ok('...and none at all: none', M.skyPreviewScreen([], {}) === null);
var mo = function (id) { var m = M.skyMoments(id); return m.options.map(function (o) { return o[0]; }).join('/') + '>' + m.value; };
ok('Halloween: day, night and its spooky night -- opening on the spooky one', mo('halloween') === 'day/night/spooky>spooky' &&
   M.skyMoments('halloween').options[2][1] === 'Spooky Night');
ok('Christmas and the Fourth open at night (lights, fireworks)', mo('christmas') === 'day/night>night' && mo('fourth-of-july') === 'day/night>night');
ok('Space Night only at night, Spring Garden only by day -- one moment, no choice', mo('space-night') === 'night>night' && mo('spring-garden') === 'day>day');
ok('the rest by day, with the night a tap away', mo('thanksgiving') === 'day/night>day' && mo('birthday') === 'day/night>day');

// YOUR OWN DASHBOARDS: HK Settings' YAML Reference and the wiki page say the
// same thing -- every snippet, as the wiki shows it, is in the page, under a
// heading whose anchor the settings page links to.
var DOC = read(HK_ROOT + '/docs/Your-Own-Dashboard.md');
var slug = function (t) { return t.trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-'); };
var anchors = {};
DOC.split('\n').forEach(function (l) { var m = /^#{1,6} (.+)$/.exec(l); if (m) anchors[slug(m[1])] = 1; });
var items = [].concat.apply([], M.YAML_REF.map(function (g) { return g.items; }));
var missing = items.filter(function (it) { return DOC.indexOf('\n' + M.yamlRefText(it) + '\n```') < 0; }).map(function (it) { return it.id; });
ok('every YAML Reference snippet is on the wiki page, word for word', items.length >= 15 && missing.length === 0, missing);
var noAnchor = items.filter(function (it) { return !anchors[it.anchor]; }).map(function (it) { return it.anchor; });
ok('...under the heading the settings page links to', noAnchor.length === 0, noAnchor);
ok('ids are unique, and each snippet is found by its id', items.every(function (it) { return M.yamlRefItem(it.id) === it; }) &&
   Object.keys(items.reduce(function (o, it) { o[it.id] = 1; return o; }, {})).length === items.length);
ok('filled in from the house: the weather, the tablet user, the photos folder',
   M.yamlRefText(M.yamlRefItem('weather'), { weather: 'weather.forecast_home' }).indexOf('entity: weather.forecast_home') > 0 &&
   M.yamlRefText(M.yamlRefItem('screensaver'), { user: 'Den Tablet', photos: null }).indexOf('user: Den Tablet ') > 0 &&
   M.yamlRefText(M.yamlRefItem('screensaver'), {}).indexOf('photos: media-source://media_source/local/photos') > 0);
ok('Music offers the whole Music page first, with a now-playing example',
   /^- type: custom:hk-music-card/.test(M.yamlRefItem('music').yaml) && M.yamlRefItem('music').key === 'hk-music-card' &&
   M.yamlRefItem('music').yaml.indexOf('hk-now-playing-card') > 0 && M.yamlRefItem('music').yaml.indexOf('hk-speaker-picker-card') < 0);
var barRef = M.yamlRefItem('media_bar');
ok('The Now Playing Bar: the docked #media pop-up generated screens use, opened by the music, holding the bar',
   !!barRef && barRef.title === 'The Now Playing Bar' && /views it is placed in/.test(barRef.sub) &&
   ['type: custom:hk-popup-card', "hash: '#media'", 'position: bottom', 'modal: false', 'dock: true',
    'condition: state', 'state: playing', '- type: custom:hk-now-playing-card', 'bar: true']
     .every(function (l) { return barRef.yaml.indexOf(l) >= 0; }) &&
   M.YAML_REF.filter(function (g) { return g.items.indexOf(barRef) >= 0; })[0].header === 'Cards');
ok('the kiosk summary on a screen\'s Header & Sidebar row',
   M.kioskSummary({ kiosk: true }, true) === 'Both Hidden' && M.kioskSummary({ kiosk: true, kiosk_sidebar: false }, false) === 'Header Hidden' &&
   M.kioskSummary({ kiosk: true, kiosk_engine: 'kiosk_mode' }, true) === 'Kiosk Mode Plugin' &&
   M.kioskSummary({ kiosk: true, kiosk_engine: 'kiosk_mode', kiosk_header: false }, false) === 'Sidebar Hidden' && M.kioskSummary({}, true) === 'Off');

// ALL SCREENS' ROOMS: the same model as a screen's, and a room's own Show on Home
var AZ = ['den', 'kitchen', 'office'];
var hb = M.houseRoomsAsBoard({ order: ['kitchen', 'den'], home: 'only', menu: 'order', pages: 'floor' });
ok('rooms: All Screens\' as a screen\'s keys', eq(hb, { room_order: ['kitchen', 'den'], home_rooms: 'only', menu_rooms: 'order', page_rooms: 'floor' }));
ok('...and an empty one is automatic', eq(M.houseRoomsAsBoard(null), { room_order: [], home_rooms: 'as_is', menu_rooms: 'az', page_rooms: 'floor' }));
ok('...saved back under rooms.*', eq(M.houseRoomsSave({ room_order: ['den'], home_rooms: 'only', menu_rooms: 'az' }),
   { 'rooms.order': ['den'], 'rooms.home': 'only', 'rooms.menu': 'az' }));
ok('a room\'s Show on Home on: added at the end', eq(M.roomOnHome(hb, AZ, 'office', true), { room_order: ['kitchen', 'den', 'office'], home_rooms: 'order' }));
ok('...off: taken out, the rest only', eq(M.roomOnHome(hb, AZ, 'den', false), { room_order: ['kitchen'], home_rooms: 'only' }));
ok('...from automatic: every room in its order, less that one',
   eq(M.roomOnHome(M.houseRoomsAsBoard({}), AZ, 'kitchen', false), { room_order: ['den', 'office'], home_rooms: 'only' }));
ok('...already so: nothing to save', M.roomOnHome(hb, AZ, 'kitchen', true) === null);
ok('rooms summary', M.roomsSummary(hb) === '2 on Home' && M.roomsSummary({ room_order: [] }) === 'Automatic' &&
   M.roomsSummary({ room_order: ['a'], home_rooms: 'order' }) === 'Custom Order');

// ---- the menu, All Screens' (2026-10-02)
(function () {
  var tp = M.tabPosParts;
  ok('tab position: empty is Level with Date', tp('').mode === 'date' && tp(null).mode === 'date');
  ok('tab position: 140px, 140 and 20% are custom', tp('140px').n === '140' && tp('140').unit === 'px' && tp('20%').unit === '%');
  ok('tab position: joined back', M.tabPosJoin('140', 'px') === '140px' && M.tabPosJoin(' 18 ', '%') === '18%' && M.tabPosJoin('', 'px') === '');
  ok('tab position: as a row says it', M.tabPosLabel('') === 'Level with Date' && M.tabPosLabel('20%') === '20 % from Top');
  ok('highlight: a name, your own, and anything else as orange',
     M.accentOf('blue').hex === '#0a84ff' && M.accentOf('#123abc').custom && M.accentOf('#123abc').name === 'Custom' &&
     M.accentOf('nope').name === 'Orange' && M.accentOf(null).hex === '#ff9f0a');
  ok('highlight: Apple\'s eleven', M.ACCENTS.length === 11);
  var hb = M.houseMenuAsBoard({ style: 'tab', tab_at: '20%', open_min: 1200, time_weather_at: 'menu', accent: 'teal', clock: false });
  ok('All Screens\' menu as a screen\'s keys', hb.menu === 'tab' && hb.tab_position === '20%' && hb.dock_min === 1200 &&
     hb.time_weather === 'menu' && hb.accent === 'teal' && hb.clock === false && hb.glyph === 'sidebar' && hb.tab_size === 'large');
  var sv = M.houseMenuSave({ menu: 'chip', tab_position: '', accent: 'red', glyph: 'lines' });
  ok('...and back', sv['menu.style'] === 'chip' && sv['menu.tab_at'] === '' && sv['menu.accent'] === 'red' && sv['menu.glyph'] === 'lines' &&
     Object.keys(sv).length === 4, sv);
  var own = M.menuOwnChanges({ menu: 'chip_scroll', accent: 'teal', tab_size: 'xl', button_phone: 'tab', dock_min: 1000 });
  ok('taking its own: what it shows now, the button\'s style too', own.menu_custom === true && own.menu === 'chip_scroll' &&
     own.accent === 'teal' && own.tab_size === 'xl', own);
  ok('...but never off or always open', !('menu' in M.menuOwnChanges({ menu: 'open' })));
  ok('a screen\'s row says whose they are', M.menuSummary({ menu_custom: true }) === 'Just This Screen' &&
     M.menuSummary({}) === 'Same as All Screens');
  ok('search finds the highlight on All Screens\' Menu', M.search('highlight color', []).some(function (r) { return r.route === 'house/menu/accent'; }));
})();


ok('sky summary includes an independent decoration style', M.skySummary({ sky_decoration_style: 'new' }) === 'New Decorations' && M.skySummary({ sky_decoration_style: 'old' }) === 'Old Decorations');
ok('...and where its moving things are', M.skySummary({ sky_moving: 'front' }) === 'Moving Things in Front' && M.skySummary({ sky_moving: 'behind' }) === 'Moving Things Behind' &&
   M.skySummary({ sky_moving: null }) === 'Same as All Screens');
ok('sky summary: absent and null settings follow All Screens', M.skySummary({}) === 'Same as All Screens' && M.skySummary({ sky_gradient: null }) === 'Same as All Screens');
ok('sky summary: all off and an own backdrop', M.skySummary({ sky_animations: false, sky_weather: false, sky_decorations: false, sky_gradient: 'live' }) === 'No Animation, No Weather, No Decorations, Own Backdrop');
ok('sky summary: true is an own setting too', M.skySummary({ sky_animations: true }) === 'Own Settings');
ok('sky summary: stored own colors count', M.skySummary({ sky_custom: {} }) === 'Own Settings');
ok('search includes the backdrop picker (Sky Colors, 2026-10-13)', M.search('backdrop', [{path:'dashboard-test',title:'Test'}]).some(function(r) { return r.label === 'Sky Colors' && r.route === 'house/sky/backdrop'; }));
ok('search finds the Background\u2019s photo', M.search('photo', [{path:'dashboard-test',title:'Test'}]).some(function(r) { return r.route === 'house/sky'; }));

// No Button: offered only with the swipe on (or when it is the choice), and
// turning the swipe off takes it back to the default
var ids = function (l) { return l.map(function (x) { return x[0]; }).join(','); };
ok('No Button hidden without the swipe', ids(M.stylesFor(M.MENU_STYLES, false, 'auto')).indexOf('none') < 0);
ok('...offered with it', ids(M.stylesFor(M.MENU_STYLES, true, 'auto')).indexOf('none') >= 0 &&
   ids(M.stylesFor(M.BUTTON_PHONE, true, 'chip')).indexOf('none') >= 0);
ok('...and shown while it is the choice', ids(M.stylesFor(M.BUTTON_PHONE, false, 'none')).indexOf('none') >= 0);
ok('swipe off puts No Button back', JSON.stringify(M.swipeChanges(false, { menu: 'none', button_phone: 'none' })) ===
   JSON.stringify({ swipe: false, menu: 'auto', button_phone: 'chip' }));
ok('...and leaves any other style alone', JSON.stringify(M.swipeChanges(false, { menu: 'tab', button_phone: 'chip_scroll' })) ===
   JSON.stringify({ swipe: false }) && JSON.stringify(M.swipeChanges(true, { menu: 'tab' })) === JSON.stringify({ swipe: true }));
ok('All Screens\' swipe maps onto a screen', M.houseMenuAsBoard({ swipe: true }).swipe === true &&
   M.houseMenuAsBoard({}).swipe === false && M.houseMenuSave({ swipe: true })['menu.swipe'] === true);
ok('search finds the swipe', M.search('swipe', []).some(function (r) { return r.label === 'Swipe from Left Edge'; }));

// A SCREEN WITH NO HOME: any page, in its order
(function () {
  var M2 = (typeof window !== 'undefined' ? window : globalThis).hkSettingsModel;
  var kinds = ['weather', 'cameras', 'security', 'climate', 'music', 'browse', 'water', 'energy', 'rooms'];
  var m = M2.onlyModel({ only_pages: ['security', 'ecoflow', 'nope'], pages: ['weather'] }, kinds, { ecoflow: 'EcoFlow' }, true);
  ok('no Home: its pages, kinds and custom alike; one that is gone left out',
     JSON.stringify(m.rows.map(function (r) { return r.value; })) === '["security","ecoflow"]' && m.rows[1].custom === true, m.rows);
  ok('...the rest to add, Browse Music never on its own', m.more.map(function (r) { return r.value; }).indexOf('browse') < 0 &&
     m.more.some(function (r) { return r.value === 'energy'; }));
  var legacy = M2.onlyModel({ custom_pages: ['energy', 'ecoflow'] }, kinds, { ecoflow: 'EcoFlow' }, true);
  ok('a screen from before: its custom pages, `energy` the Energy page', JSON.stringify(legacy.rows.map(function (r) { return r.value; })) === '["energy","ecoflow"]' &&
     legacy.rows[0].custom === false, legacy.rows);
  var mus = M2.onlyModel({ only_pages: ['music'] }, kinds, {}, true);
  ok('...Music alone (Browse is part of it)', JSON.stringify(mus.rows.map(function (r) { return r.value; })) === '["music"]');
  ok('...a whole screen\'s own page order is not this list', M2.onlyModel({ pages: ['weather'], custom_pages: [] }, kinds, {}, true).rows.length === 0);
})();
// EACH PAGE'S BACKGROUND
(function () {
  var M3 = (typeof window !== 'undefined' ? window : globalThis).hkSettingsModel;
  var rows = M3.skyPageRows(['energy', 'weather', 'music', 'browse', 'rooms', 'ecoflow'], { ecoflow: 'EcoFlow' });
  ok('page backgrounds: each page once, Browse part of Music', rows.map(function (r) { return r.key; }).join(',') === 'energy,weather,music,rooms,ecoflow');
  ok('...a page left alone says Automatic (2026-10-17)',
     M3.skyAutoLabel(rows[0]) === 'Automatic' && M3.skyAutoLabel(rows[1]) === 'Automatic' && M3.skyAutoLabel(rows[4]) === 'Automatic');
  var bds = [{ id: 'live', label: 'Live Sky' }, { id: 'dusk', label: 'Dusk' }];
  var ops = M3.skyModeOptions(rows[0], bds, 'Automatic').map(function (o) { return o[0]; }).join(',');
  ok('...the choices: Automatic, Page Color where it has one, then every backdrop (Live Sky first)', ops === ',own,live,dusk', ops);
  ok('...Page Color offered only where there is one', M3.skyModeOptions(rows[1], bds, 'A').map(function (o) { return o[0]; }).indexOf('own') < 0);
  ok('...a mode in words', M3.skyModeLabel('dusk', bds) === 'Dusk' && M3.skyModeLabel('live', bds) === 'Live Sky');
})();
(function () {
  var MM = M;
  ok('the Energy page pill has its own look, as the other page pills', JSON.stringify(MM.PAGE_PILL_DEFAULTS.energy) ===
     JSON.stringify(['Energy', 'mdi:lightning-bolt', 'white']));
  ok('Backdrop back to All Screens: the screen\'s own stops go with it',
     JSON.stringify(MM.backdropFollow({ sky_gradient: 'custom', sky_custom: { day: [], night: [] }, sky_pages: { energy: 'dusk' } })) ===
     JSON.stringify({ sky_gradient: null, sky_custom: null }));
  ok('...but stay while a page\'s background is Custom (they are its colors)',
     JSON.stringify(MM.backdropFollow({ sky_gradient: 'custom', sky_custom: { day: [], night: [] }, sky_pages: { energy: 'custom' } })) ===
     JSON.stringify({ sky_gradient: null }));
})();
// SHRINKS TO is named by the bar's direction
var fb = M.foldOptions('bottom'), fr = M.foldOptions('right');
ok('Shrinks To: a bar\'s left or right, a rail\'s top or bottom',
      fb[0][1] === 'Left' && fb[1][1] === 'Right' && fr[0][1] === 'Top' && fr[1][1] === 'Bottom' && M.foldOptions('top')[1][1] === 'Right');
// PHONES' OWN MENU (2026-10-08): the same answers as hk-base.js and settings.py phone_menu
var pm = M.phoneMenu;
ok('Phones\' menu: its own, else the tablets\' when off or the bar, else a button',
   pm({ menu: 'tabbar' }) === 'tabbar' && pm({ menu: 'off' }) === 'off' &&
   pm({ menu: 'open' }) === 'button' && pm({ menu: 'auto' }) === 'button' &&
   pm({ menu: 'off', menu_phone: 'tabbar' }) === 'tabbar' && pm({ menu: 'tabbar', menu_phone: 'button' }) === 'button');
ok('...its button: its own, else the chip',
   M.phoneButton({}) === 'chip' && M.phoneButton({ button_phone: 'tab' }) === 'tab' && M.phoneButton({ button_phone: 'tabbar' }) === 'chip');
ok('...no tab bar among a phone\'s button styles', M.BUTTON_PHONE.every(function (n) { return n[0] !== 'tabbar'; }) &&
   M.BUTTON_PHONE.length === 4);
ok('each device\'s line: a screen\'s says its menu, All Screens\' its style',
   M.tabletSummary({ menu: 'open' }) === 'Always Open' && M.tabletSummary({ menu: 'tab' }) === 'Edge Tab' &&
   M.phoneSummary({ menu: 'open', menu_phone: 'tabbar' }) === 'Tab Bar' && M.phoneSummary({ menu: 'auto', button_phone: 'chip_scroll' }) === 'Chip, Then Tab' &&
   M.tabletSummary({ menu: 'chip' }, true) === 'Chip' && M.phoneSummary({ button_phone: null }, true) === 'Chip');
ok('the edge tab per device: a tablet\'s tab bar menu has none, a phone\'s button may',
   !M.tabletTab({ menu: 'tabbar' }) && !M.tabletTab({ menu: 'open' }) && M.tabletTab({ menu: 'chip_scroll' }) && M.phoneTab({ menu: 'tabbar', menu_phone: 'button', button_phone: 'tab' }) &&
   M.showsTab({ menu: 'tabbar', menu_phone: 'button', button_phone: 'tab' }) && !M.showsTab({ menu: 'tabbar' }));
ok('the tab bar anywhere: on tablets, or on phones alone', M.hasTabBar({ menu: 'auto', menu_phone: 'tabbar' }) &&
   !M.tabletTabBar({ menu: 'auto', menu_phone: 'tabbar' }) && !M.hasTabBar({ menu: 'auto', menu_phone: 'button' }));
ok('swipe off: a phone\'s No Button goes back to the chip', M.swipeChanges(false, { button_phone: 'none' }).button_phone === 'chip');
var hb = M.houseMenuAsBoard({ button_phone: 'tab', bar_rooms_phone: 'button' });
ok('All Screens\' phone keys read as a screen\'s, and save back', hb.button_phone === 'tab' && hb.tab_bar_rooms_phone === 'button' &&
   M.houseMenuAsBoard({}).button_phone === 'chip' && M.houseMenuAsBoard({}).tab_bar_rooms_phone === 'more' &&
   M.houseMenuAsBoard({ bar_glass: 'clear' }).tab_bar_glass === 'tinted' && !('narrow' in M.houseMenuAsBoard({})) &&
   eq(M.houseMenuSave({ button_phone: 'chip', tab_bar_rooms_phone: null }), { 'menu.button_phone': 'chip', 'menu.bar_rooms_phone': null }));
// THE GLASS (2026-10-10): Glass, Frosted, Tinted (2026-10-12), Blur -- and Blur's three modes
ok('glass: five styles, Blur\'s three modes, one stored value each',
   eq(M.GLASS_STYLES.map(function (g) { return g[0]; }), ['flat', 'clear', 'frosted', 'tinted', 'blur']) &&
   eq(M.BLUR_MODES.map(function (g) { return g[0]; }), ['blur', 'blur_pre', 'blur_each']) &&
   eq(M.GLASS.map(function (g) { return g[0]; }), ['flat', 'clear', 'frosted', 'tinted', 'blur', 'blur_pre', 'blur_each']));
ok('...Tinted is a style of its own, named, with its Darkness and Icon Circles',
   M.glassStyle('tinted') === 'tinted' && M.glassLabel('tinted') === 'Tinted' && !M.isBlur('tinted') &&
   /Darkness/.test(M.glassFooter('tinted')) && /Icon Circles/.test(M.glassFooter('tinted')) &&
   eq(M.TINT_WELLS.map(function (w) { return w[0]; }), ['dark', 'light']));
ok('...a screen copies its darkness and circles with its glass',
   M.COPY_GROUPS.filter(function (g) { return g[0] === 'look'; })[0][2].indexOf('tint') >= 0 &&
   M.COPY_GROUPS.filter(function (g) { return g[0] === 'look'; })[0][2].indexOf('well') >= 0);
ok('...named as you would say them', M.glassLabel('clear') === 'Glass' && M.glassLabel('frosted') === 'Frosted' &&
   M.glassLabel('blur') === 'Blur · Shared Layer' && M.glassLabel('blur_pre') === 'Blur · Pre-rendered (Experimental)' && M.glassLabel('blur_each') === 'Blur · Each Card');
ok('...each value\'s style', M.glassStyle('blur_pre') === 'blur' && M.glassStyle('blur_each') === 'blur' && M.glassStyle('blur') === 'blur' &&
   M.glassStyle('frosted') === 'frosted' && M.glassStyle('clear') === 'clear' && M.glassStyle(undefined) === 'clear' &&
   M.isBlur('blur_pre') && !M.isBlur('frosted'));
ok('...Pre-rendered has the Blur amount, and says so', eq(M.amountsFor('blur_pre'), { frost: false, blur: true, tint: false }) && /Blur: how strong/.test(M.glassFooter('blur_pre')));
ok('...every mode says what it costs', M.BLUR_MODES.every(function (m) { return m[2].length > 60; }) &&
   /lightest/i.test(M.BLUR_MODES[1][2]) && /heaviest/i.test(M.BLUR_MODES[2][2]) &&
   /every frame/.test(M.BLUR_MODES[0][2]) && M.glassLabel('blur_pre') === 'Blur · Pre-rendered (Experimental)' && M.isBlur('blur_pre') && !M.isBlur('blur_baked'));
// WALL TABLETS (1.14): what a tablet is doing, its checks, its idle timeline
(function () {
  var KS = { battery: 'sensor.l_battery', charging: 'binary_sensor.l_charging', online: 'binary_sensor.l_conn',
             adaptive: 'switch.l_adaptive', saver_mode: 'select.l_mode', saver_timeout: 'number.l_timeout',
             kiosk_mode: 'switch.l_kiosk', update: 'update.l_update' };
  var t = { app: 'kiosk_satellite', parts: KS };
  var S = function (v, at) { return { state: v, attributes: {}, last_changed: at || '2026-10-13T20:16:00Z' }; };
  var st = { 'sensor.l_battery': S('92'), 'binary_sensor.l_charging': S('on'), 'binary_sensor.l_conn': S('on'),
             'switch.l_adaptive': S('off'), 'select.l_mode': S('Black'), 'number.l_timeout': S('86400'),
             'switch.l_kiosk': S('on'), 'update.l_update': S('off'), 'switch.l_black': S('on'),
             'switch.l_photos': S('off'), 'sensor.l_sleep': { state: 'dark', attributes: { reason: 'nobody here' } } };
  var ids = { black: 'switch.l_black', 'switch': 'switch.l_photos', sleep: 'sensor.l_sleep' };
  var s = M.tabletStatus(t, st, ids);
  ok('a tablet under its black is Dark, with why and since', s.st === 'dark' && s.word === 'Dark' && s.why === 'nobody here' &&
     s.since === '2026-10-13T20:16:00Z' && s.batt === 92 && s.charging === true);
  st['switch.l_black'] = S('off'); st['switch.l_photos'] = S('on');
  ok('...its photos up: Screensaver', M.tabletStatus(t, st, ids).st === 'photos');
  st['binary_sensor.l_conn'] = S('off');
  ok('...its kiosk not heard from: Offline, whatever else', M.tabletStatus(t, st, ids).st === 'off' && M.tabletStatus(t, st, ids).why === '');
  st['binary_sensor.l_conn'] = S('on');
  var c = {}; M.tabletChecks(t, st).forEach(function (x) { c[x.key] = x; });
  ok('the checks: all right but the battery at 92% while charging', c.adaptive.ok && c.saver.ok && c.kiosk_mode.ok && c.update.ok &&
     !c.battery.ok && /Protect Battery/.test(c.battery.detail) && !c.online);
  st['switch.l_adaptive'] = S('on'); st['select.l_mode'] = S('Clock');
  c = {}; M.tabletChecks(t, st).forEach(function (x) { c[x.key] = x; });
  ok('...adaptive brightness on: Fix turns it off', !c.adaptive.ok && c.adaptive.fix[0] === 'switch' && c.adaptive.fix[1] === 'turn_off');
  ok('...the kiosk\'s own screensaver not Black: Fix sets it', !c.saver.ok && c.saver.fix[1] === 'kiosk_saver');
  ok('Just a Browser has nothing to check', M.tabletChecks({ app: 'browser', parts: {} }, st).length === 0);
  var tl = M.idleTimeline({ idle: 50, saver: 60, hk: true, after: 0 });
  ok('the timeline: Touched, Home at 50 s, the screensaver at 1 min, dark', tl.segs.map(function (x) { return x.cls; }).join() === 'use,home,saver,dark' &&
     tl.segs[1].at === '50 s' && tl.segs[2].at === '1 min' && !tl.warn);
  tl = M.idleTimeline({ idle: 120, saver: 60, hk: false });
  ok('...Home after the screensaver: Home behind it, and a warning', tl.segs.map(function (x) { return x.cls; }).join() === 'use,saver,home,dark' &&
     tl.warn && tl.segs[3].says === 'an automation decides');
  ok('...no Return to Home, no screensaver: dark alone', M.idleTimeline({ idle: null, saver: null, hk: true, after: 5 }).segs.length === 2 &&
     M.idleTimeline({ idle: null, saver: null, hk: true, after: 5 }).segs[1].says === 'after 5 min of photos');
  ok('the start URL names the tablet', M.tabletUrl('http://ha:8123/', 'dashboard-loft', 'loft') === 'http://ha:8123/dashboard-loft?hk_tablet=loft');
  ok('Idle Time labels', M.idleLabel(50) === '50 Seconds' && M.idleLabel(0) === 'Never' && M.idleLabel(120) === '2 Minutes');
  // (1.8.0) Show: Clock says Clock, not Photos
  ok('the screensaver summary on Show: Clock', /^Music, Then Clock · /.test(M.saverSummary({ show: 'clock', music_first: true })) &&
     /^Clock · /.test(M.saverSummary({ show: 'clock' })), M.saverSummary({ show: 'clock' }));
})();
print(fail ? '  ' + fail + ' SETTINGS MODEL TESTS FAILED' : '  ALL ' + pass + ' SETTINGS MODEL TESTS PASS');
if (fail) throw new Error(fail + ' failed');
