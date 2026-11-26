// The features' own pages on HK Settings (panels/hk-settings-features.js):
// which show, what each list shows, what search finds. Nothing here may
// depend on one house: every list is built from what the integration answers.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
// (the files cut into parts -- tools/split_js.py -- register their parts on window: as a page has one)
if (typeof window === 'undefined') globalThis.window = globalThis;
load(HK_ROOT + '/frontend/panels/hk-settings-features.js');
var F = (typeof window !== 'undefined' ? window : globalThis).hkSettingsFeatures;

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
var routes = function (xs) { return xs.map(function (x) { return x[0]; }); };

// ------------------------------------------------------------ which show
ok('a house with none of them: Music only (Browse Music is HK Frontend’s own)', eq(routes(F.listed({})), ['music']));
var feats = { hk_tv: { installed: true, entries: [{ entry_id: 'a' }] }, hk_alarm_pin: { installed: false, entries: [] },
              hk_clean_areas: { installed: true, entries: [] }, hk_music: { installed: false, entries: [] } };
ok('installed ones show, added or not; a missing one does not', eq(routes(F.listed(feats)), ['music', 'tv', 'clean']));
ok('states: added / installed but not added / missing',
   F.stateOf(feats, 'hk_tv') === 'added' && F.stateOf(feats, 'hk_clean_areas') === 'not_added' &&
   F.stateOf(feats, 'hk_alarm_pin') === 'missing' && F.stateOf(undefined, 'hk_tv') === 'missing');
ok('Add is HK Frontend’s own Add feature (every feature is one of its entries)',
   F.addHref('hk_tv') === '/config/integrations/integration/hk_frontend' &&
   F.integrationHref('hk_tv') === '/config/integrations/integration/hk_frontend');

// ------------------------------------------------------------ advanced -> features
// (the page lists what the house has: Music always, the others installed;
// "N of M On" counts the added ones)
ok('Advanced -> Features counts the added ones among those it lists',
   eq(F.featuresOn(feats), { on: 1, of: 2 }) && eq(F.featuresOn({}), { on: 0, of: 0 }));
ok('each feature says what it needs and where its settings are',
   F.LIST.every(function (x) { return typeof F.NEEDS[x[1]] === 'string' && /^#\//.test(F.SETTINGS_AT[x[1]]); }));
// features on by default (Mantel's own features, features/auto.py): the row's words, in the host's name
var shellWas = root0().hkShell;
function root0() { return typeof window !== 'undefined' ? window : globalThis; }
root0().hkShell = Object.assign({}, shellWas || {}, { productName: function () { return 'Mantel'; } });
// (noon on Nov 4 where the suite runs: the date is the viewer's own, and 15:00 UTC is already Nov 5 in Tokyo)
var NOV4 = new Date(2026, 10, 4, 12).toISOString();
ok('a feature Mantel turned on says when and why, in place of what it needs',
   F.featureSub({ own: true, auto: { at: NOV4, why: 'Music Assistant is connected.' } }, 'hk_music') ===
   'Turned on by Mantel on Nov 4: Music Assistant is connected.', F.featureSub({ auto: { at: NOV4, why: 'x' } }, 'hk_music'));
ok('...without a readable date, just why',
   F.featureSub({ auto: { at: 'later', why: 'A vacuum has a map of the house’s rooms.' } }, 'hk_clean_areas') ===
   'Turned on by Mantel: A vacuum has a map of the house’s rooms.');
ok('one that is off but near says what is missing',
   F.featureSub({ own: true, note: 'Home Assistant has an HDHomeRun, but Mantel doesn’t know its address: add it on Live TV’s page.' }, 'hk_tv') ===
   'Home Assistant has an HDHomeRun, but Mantel doesn’t know its address: add it on Live TV’s page.');
ok('Home Assistant’s shape (no auto, no note) is as it was: what it needs',
   F.featureSub({ installed: true, entries: [] }, 'hk_energy') === F.NEEDS.hk_energy &&
   F.featureSub({ auto: null, note: null }, 'hk_tv') === F.NEEDS.hk_tv && F.featureSub(undefined, 'hk_notify') === F.NEEDS.hk_notify);
root0().hkShell = shellWas;

// ------------------------------------------------------------ live tv
var tv = { channels: [{ number: '4.1', name: 'NBC' }, { number: '13.1', name: 'ABC' }, { number: '9.9', name: 'Gone' }],
           lineup: [{ number: '4.1', station: 'WXXX-DT', network: 'NBC' }, { number: '4.3', station: 'WXXXCBS', network: 'CBS' },
                    { number: '13.1', station: 'ABC', network: null }, { number: '21.1', station: 'FOX-HD', network: null }] };
var L = F._.tvLists(tv);
ok('Shown: the saved channels in their order, by their own names', eq(L.rows.map(function (r) { return r.label; }), ['NBC', 'ABC', 'Gone']));
ok('...the station under a renamed one, not under one named after it',
   L.rows[0].sub === '4.1 · WXXX-DT' && L.rows[1].sub === '13.1', L.rows);
ok('...a saved channel the tuner no longer has says so', /Not in the lineup/.test(L.rows[2].sub), L.rows[2]);
ok('More: the rest of the lineup, by network when the guide names one',
   eq(L.more.map(function (r) { return [r.value, r.label, r.sub]; }), [['4.3', 'CBS', '4.3 · WXXXCBS'], ['21.1', 'FOX-HD', '21.1']]), L.more);
ok('the count: saved of the lineup', F._.tvCount(tv) === '3 of 4');
ok('...just the saved number when the tuner did not answer', F._.tvCount({ channels: tv.channels, lineup: null }) === '3');
ok('an empty answer is an empty list, not an error', eq(F._.tvLists({}), { rows: [], more: [] }));

// the Home app's TVs (Live TV -> Home App): a channel checked or unchecked on a screen, the list kept in its order
var den = 's0123456789ab', study = 'sba9876543210';
var btns = [{ screen: den, channel: '4.1' }, { screen: study, channel: '4.1' }];
ok('checking a channel adds it to its screen’s TV at the end, once',
   eq(F._.tvButtonsAfter(btns, den, '13.1', true), btns.concat([{ screen: den, channel: '13.1' }])) &&
   eq(F._.tvButtonsAfter(btns, den, '4.1', true), [{ screen: study, channel: '4.1' }, { screen: den, channel: '4.1' }]));
ok('...unchecking takes only that screen’s', eq(F._.tvButtonsAfter(btns, den, '4.1', false), [{ screen: study, channel: '4.1' }]) &&
   eq(F._.tvButtonsAfter(undefined, den, '4.1', false), []));
ok('a TV a screen with a channel', F._.tvCountTvs({ buttons: btns.concat([{ screen: den, channel: '7.1' }]) }) === 2 &&
   F._.tvCountTvs({}) === 0);
var home = { buttons: [{ screen: den, channel: '4.1' }, { screen: study, channel: '4.1' }], homekit_wanted: true };
ok('a screen’s last channel unchecked while the TVs are in the Home app asks first (its TV leaves the Home app)',
   F._.tvLastButton(home, [{ screen: study, channel: '4.1' }], den) &&
   !F._.tvLastButton(home, home.buttons, den) && !F._.tvLastButton(home, [{ screen: study, channel: '4.1' }], study) &&
   !F._.tvLastButton({ buttons: home.buttons }, [], den) && !F._.tvLastButton({ buttons: [], homekit_wanted: true }, [], den));
var chans = [{ number: '4.1', name: 'NBC' }, { number: '7.1', name: 'WFAK-DT' }];
var two = { buttons: [{ screen: den, channel: '7.1' }, { screen: study, channel: '4.1' }, { screen: den, channel: '4.1' }],
            power_on: { s0123456789ab: '4.1', sba9876543210: '7.1' } };
ok('When Turned On: Last Watched, then the screen’s channels in its order',
   eq(F._.tvPowerOptions(two, den, chans), [['last', 'Last Watched'], ['7.1', 'WFAK-DT'], ['4.1', 'NBC']]) &&
   eq(F._.tvPowerOptions({}, den, chans), [['last', 'Last Watched']]));
ok('...the saved one while it is one of the TV’s channels, else Last Watched',
   F._.tvPowerOn(two, den) === '4.1' && F._.tvPowerOn(two, study) === 'last' && F._.tvPowerOn({}, den) === 'last');
var spk = { speakers: [['media_player.den_homeview', 'Den HomeView'], ['media_player.study_homepod', 'Study HomePod']] };
ok('Volume: Automatic names the speaker the screen matched, then every speaker, then None',
   eq(F._.tvVolumeOptions(spk, { speaker_auto: 'media_player.den_homeview' }),
      [['auto', 'Automatic (Den HomeView)'], ['media_player.den_homeview', 'Den HomeView'],
       ['media_player.study_homepod', 'Study HomePod'], ['none', 'None']]) &&
   F._.tvVolumeOptions(spk, {})[0][1] === 'Automatic (None Found)' && eq(F._.tvVolumeOptions({}, {}).length, 2));
var names = { host: 'Hearth', link: 'Hearth Link', ha_page: '#/hearth/ha' };
var link = function (l, n) { return F._.tvHomeLink({ link: l, published: n, names: names }); };
var ready = link({ connected: true, home: true, house: true, linked_on: true }, 3);
ok('ready: Mantel Link connected and making the TVs, the house Mantel’s',
   ready.ready && eq(ready.rows.map(function (r) { return [r.label, r.value]; }),
                     [['Hearth Link', 'Connected'], ['The House', 'Run by Hearth'], ['TVs in Home Assistant', '3']]) &&
   /^Hearth Link makes the TVs/.test(ready.footer));
ok('...each thing missing says what to do, first things first',
   /Add it in Home Assistant/.test(link({}, 0).footer) && !link({}, 0).ready &&
   link({ connected: true }, 4).rows[0].value === 'Needs an Update' && link({}, 4).rows[2].value === 'None' &&
   /update Hearth Link/.test(link({ connected: true, house: true, linked_on: true }, 2).footer) &&
   link({ connected: true, house: true, linked_on: true }, 2).rows[2].value === '2' &&     // what Mantel publishes
   !link({ connected: true, house: true, linked_on: true }, 2).ready &&
   /run by Hearth/.test(link({ connected: true, home: true, house: true }, 0).footer) &&
   link({ connected: true, home: true, house: true }, 0).rows[1].value === 'Run by Home Assistant');
ok('search finds the Home App page', F.search({ hk_tv: { installed: true, entries: [{ entry_id: 'a' }] } })
   .some(function (x) { return x.route === 'features/tv/home' && /homekit/.test(x.words); }));

// ------------------------------------------------------------ clean by area
var nm = function (id) { return { office: 'Office' }[id] || id; };
ok('a vacuum’s line says what a chosen room does with it',
   F._.vacuumSub({ how: 'map', areas: ['a', 'b'] }, nm) === 'Cleans 2 rooms on its map' &&
   F._.vacuumSub({ how: 'map', areas: ['a'] }, nm) === 'Cleans 1 room on its map' &&
   F._.vacuumSub({ how: 'start', areas: ['office'] }, nm) === 'Starts when Office is chosen' &&
   /no room map/.test(F._.vacuumSub({ how: 'no_map', areas: [] }, nm)));
var cd = { vacuums: [{ vacuum: 'vacuum.a' }, { vacuum: 'vacuum.b' }, { vacuum: 'vacuum.c' }], chosen_vacuums: [] };
ok('every vacuum taking part is stored as [] (a new one joins by itself)', eq(F._.vacuumsAfter(cd, 'vacuum.b', true), []));
ok('unticking one of "every vacuum" keeps the others', eq(F._.vacuumsAfter(cd, 'vacuum.b', false), ['vacuum.a', 'vacuum.c']));
cd.chosen_vacuums = ['vacuum.a', 'vacuum.c'];
ok('ticking the missing one back is every vacuum again', eq(F._.vacuumsAfter(cd, 'vacuum.b', true), []));
cd.chosen_vacuums = ['vacuum.a'];
ok('the last one cannot be unticked (none would be every vacuum)', F._.vacuumsAfter(cd, 'vacuum.a', false) === null);
cd.chosen_vacuums = ['vacuum.gone', 'vacuum.a'];
ok('a chosen vacuum the house no longer has is dropped', eq(F._.vacuumsAfter(cd, 'vacuum.b', true), ['vacuum.a', 'vacuum.b']));
var rd = { areas: [{ id: 'kitchen', name: 'Kitchen', floor: 'Main', level: 0, by: ['Down'] }, { id: 'study', name: 'Loft', floor: 'Up', level: 1, by: ['Up', 'Down'] },
                   { id: 'den', name: 'Den', floor: null, by: [] }],
           chosen_areas: [], offered: ['study', 'den', 'kitchen'] };
var RL = F._.roomLists(rd);
ok('Rooms, automatic: every room offered, floor by floor (no floor last), with its floor and who reaches it',
   RL.auto && eq(RL.rows.map(function (r) { return [r.label, r.sub]; }), [['Kitchen', 'Main · Down'], ['Loft', 'Up · Up, Down'], ['Den', null]]) && !RL.more.length, RL);
ok('...counted as Automatic', F._.roomCount(rd) === 'Automatic · 3');
rd.chosen_areas = ['study']; rd.offered = ['study'];
RL = F._.roomLists(rd);
ok('chosen by hand: the chosen ones shown, the rest a vacuum reaches under More',
   !RL.auto && eq(RL.rows.map(function (r) { return r.value; }), ['study']) && eq(RL.more.map(function (r) { return r.value; }), ['kitchen', 'den']));
ok('...counted of the reachable', F._.roomCount(rd) === '1 of 3');

// ------------------------------------------------------------ music
var md = { speakers: [{ entity: 'media_player.k', name: 'Kitchen', floor: 'Main', player: 'Kitchen HomePod' },
                      { entity: 'media_player.o', name: 'Office', floor: null, player: 'Office' }],
           presets: [{ id: 'p1', name: 'Everywhere', members: ['media_player.k', 'media_player.o'] }],
           players: [{ entity: 'media_player.k', name: 'Kitchen HomePod' }, { entity: 'media_player.o', name: 'Office' },
                     { entity: 'media_player.all', name: 'All HomePods' }, { entity: 'media_player.den', name: 'Den HomePod' }] };
var SL = F._.speakerLists(md);
ok('Speakers: in their order, named by area, the player’s own name under it when different',
   eq(SL.rows.map(function (r) { return [r.value, r.label, r.sub]; }),
      [['media_player.k', 'Kitchen', 'Main · Kitchen HomePod'], ['media_player.o', 'Office', null]]), SL.rows);
ok('...More: the other players (a preset has no player of its own)',
   eq(SL.more.map(function (r) { return r.value; }), ['media_player.all', 'media_player.den']), SL.more);
ok('a room is named by its speaker’s area, else the player’s name, else its id',
   F._.speakerName(md, 'media_player.k') === 'Kitchen' && F._.speakerName(md, 'media_player.den') === 'Den HomePod' &&
   F._.speakerName(md, 'media_player.x') === 'media_player.x');
ok('a playlist’s line: its chooser and how many it plays',
   F._.playlistSub({ items: ['a'], chooser: 'Decades' }) === 'In Decades · 1 playlist' && F._.playlistSub({ items: ['a', 'b'] }) === '2 playlists');

// A STEREO PAIR (hk_core/music/groups.py): a Music Assistant group picked as one room's speaker
var pd = Object.assign({}, md, { pairs: { 'media_player.o': { parts: ['Office Left', 'Office Right'], kind: 'stereo pair' } } });
var PL = F._.speakerLists(pd);
ok('a pair says so under its name, with its two speakers',
   PL.rows[1].sub === 'Stereo pair: Office Left + Office Right' && PL.rows[0].sub === 'Main · Kitchen HomePod', PL.rows);
ok('...and once under the list, in words',
   F._.pairNote(pd) === 'Office is a stereo pair in Music Assistant (Office Left + Office Right), so it’s one room here. ' +
   'It plays on its own. To play it with other rooms, pair its two speakers here instead.',
   F._.pairNote(pd));
ok('no pairs, no note', F._.pairNote(md) === '' && F._.pairNote({}) === '');

// A VIRTUAL PAIR (docs/phase4/VIRTUAL-PAIRS.md): two players made one room in Mantel Settings
var vd = Object.assign({}, md, { pairs_here: true,
  players: md.players.concat([{ entity: 'media_player.or', name: 'Office Right' }, { entity: 'media_player.sg', name: 'Study Group' }]),
  groups: { 'media_player.sg': { rooms: [], problems: [] }, 'media_player.all': { rooms: [], problems: [] } },
  virtual_pairs: [{ room: 'media_player.o', name: '', shown: 'Office', ma_group: null,
                    players: [{ entity: 'media_player.o', name: 'Office' }, { entity: 'media_player.or', name: 'Office Right' }]}] });
var VL = F._.speakerLists(vd);
ok('a virtual pair says its two speakers under its name', VL.rows[1].sub === 'Pair: Office + Office Right', VL.rows);
ok('...and its second player is never offered as a speaker of its own',
   eq(VL.more.map(function (r) { return r.value; }), ['media_player.all', 'media_player.den', 'media_player.sg']), VL.more);
var choices = F._.pairChoices(vd, null).map(function (o) { return o[0]; });
ok('a new pair is made of players: never a group, nor another pair’s',
   eq(choices, ['media_player.k', 'media_player.den']), choices);
ok('...an edited pair offers its own two first',
   eq(F._.pairChoices(vd, 'media_player.o').map(function (o) { return o[0]; }).slice(0, 2), ['media_player.o', 'media_player.or']));
ok('saving one pair keeps the others; removing it leaves the rest',
   eq(F._.pairsAfter(vd, 'media_player.o', { players: ['media_player.o', 'media_player.den'], name: 'Office' }),
      [{ players: ['media_player.o', 'media_player.den'], name: 'Office' }]) &&
   eq(F._.pairsAfter(vd, 'media_player.o', null), []) &&
   eq(F._.pairsAfter(vd, null, { players: ['media_player.k', 'media_player.den'], name: '' }),
      [{ players: ['media_player.o', 'media_player.or'], name: '' }, { players: ['media_player.k', 'media_player.den'], name: '' }]));

// ------------------------------------------------------------ search
var s = F.search(feats);
ok('search finds an installed feature’s settings', s.some(function (e) { return e.label === 'Channels' && e.route === 'features/tv/channels' && e.where === 'Live TV'; }));
ok('...and nothing of a missing one', !s.some(function (e) { return e.where === 'Alarm PIN'; }));
var s2 = F.search({ hk_alarm_pin: { installed: true, entries: [{}] }, hk_clean_areas: { installed: true, entries: [] } });
ok('Alarm PIN and Clean by Area are found when installed (added or not)',
   s2.some(function (e) { return e.label === 'Change PIN' && e.route === 'page/security'; }) &&
   s2.some(function (e) { return e.label === 'Rooms' && e.route === 'features/clean/rooms'; }));

// ------------------------------------------------------------ energy
var ed = { sections: [{ id: 'rooms', name: 'Rooms', items: ['a', 'b'], link: { path: './ecoflow', text: 'EcoFlow' } },
                      { id: 'appliances', name: 'Appliances', items: ['c'] }],
           section_kinds: [['hvac', 'Heating & Cooling'], ['rooms', 'Rooms'], ['charging', 'Charging']] };
var moved = F._.sectionsAfter(ed, 'a', 'appliances');
ok('energy: a device moved to another section leaves its old one, links kept',
   JSON.stringify(moved) === JSON.stringify([{ id: 'rooms', name: 'Rooms', items: ['b'], link: { path: './ecoflow', text: 'EcoFlow' } },
                                             { id: 'appliances', name: 'Appliances', items: ['c', 'a'] }]), moved);
var made = F._.sectionsAfter(ed, 'c', 'hvac');
ok('...to a section the page has not got yet: made, with its name', made[2].id === 'hvac' && made[2].name === 'Heating & Cooling' &&
   made[2].items[0] === 'c' && made[1].items.length === 0, made);
ok('...how its power sensor was found, in words', F._.energyFound({ found: 'source' }) === 'Found through its meter’s source' &&
   /today’s kWh/.test(F._.energyFound({ found: '' })));
ok('Energy is listed among the features', F.LIST.some(function (x) { return x[0] === 'energy' && x[1] === 'hk_energy'; }) &&
   F.search({ hk_energy: { installed: true, entries: [] } }).some(function (e) { return e.route === 'features/energy/sections'; }));

// THE BATTERIES AS STORED: only what was set here, never the resolved look
var bd = { options: { batteries: [{ entity: 'sensor.car', name: 'Tesla' }, { entity: 'sensor.pw', label_suffix: ' left' }] } };
var shownBats = [{ key: 'sensor.pw', entity: 'sensor.pw', name: 'Powerwall', icon: 'hk:home-battery-outline', label: 'sensor.pw_stored',
                   label_suffix: ' kWh stored', label_decimals: 1 },
                 { key: 'sensor.car', entity: 'sensor.car', name: 'Tesla', icon: 'hk:battery-high', label: 'sensor.car_range',
                   label_suffix: ' mi range', label_decimals: 0 }];
var stored = F._.batteriesStored(bd, shownBats);
ok('batteries reordered: each keeps exactly its own stored entry (The House Battery off stays off)',
   JSON.stringify(stored) === JSON.stringify([{ entity: 'sensor.pw', label_suffix: ' left' }, { entity: 'sensor.car', name: 'Tesla' }]), stored);
stored = F._.batteriesStored({ options: {} }, shownBats);
ok('...taken from Automatic: the entity and the house battery\'s flag, nothing resolved pinned',
   JSON.stringify(stored) === JSON.stringify([{ entity: 'sensor.pw', house: true }, { entity: 'sensor.car' }]), stored);
stored = F._.batteriesStored({ options: {} }, [{ key: 'sensor.pw', entity: 'sensor.pw', house: false, icon: 'hk:home-battery-outline' }]);
ok('...a plan row that says house: false is believed over its glyph', JSON.stringify(stored) === JSON.stringify([{ entity: 'sensor.pw' }]), stored);

print('\n' + (fail ? 'FAIL ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' FEATURES TESTS PASS'));
if (fail) throw new Error(fail + ' failed');
