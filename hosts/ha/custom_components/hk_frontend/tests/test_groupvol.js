// The volume slider over an AD-HOC group.
//
// WHY THIS EXISTS. Music Assistant gives its own SYNC groups (Everywhere,
// Downstairs) a real group volume: setting the group entity scales every
// member and keeps their balance. Measured, a sync group set 0.40 -> 0.12:
//
//     kitchen 0.40 -> 0.12   living/m.bed/m.bath 0.35 -> 0.10
//     guest   0.01 -> 0.01   (floored)
//
// An AD-HOC group -- media_player.join, which is what Transfer to 2+ rooms
// builds -- gets NONE of that. Office 0.20 and Kitchen 0.40 joined, leader set
// to 0.10: office moves, KITCHEN STAYS AT 0.40. The slider would control one
// room out of two and say nothing.
//
// So the card sets the members itself, and EVERY ONE TAKES THE LEVEL ASKED
// FOR: set 20 after a transfer and every speaker in it goes to 20.
// Proportional scaling is wrong here: after a transfer the rooms are wherever
// they each happened to be, and the slider is how you make them agree.
//
// These pin that, and the three shapes of group_members -- None (a sync group,
// which MA handles and the card must NOT touch), [] (a lone speaker), and a
// real list (the only case that levels).
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond, got) {
  print((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '   got=' + JSON.stringify(got)));
  cond ? pass++ : fail++;
}

load(root + '/tests/dom.js');
['hk-base', 'hk-tile', 'hk-control'].forEach(function (n) {
  load(root + '/frontend/cards/' + n + '.js');
});

var OFFICE = 'media_player.office_homepod_ma';
var KITCHEN = 'media_player.kitchen_homepod_ma';
var LOFT = 'media_player.loft_homepod_ma';

// A hass whose callService records what was sent, entity list and all.
function hassWith(states) {
  var sent = [];
  return { sent: sent, states: states,
           callService: function (d, s, data) { sent.push({ svc: d + '.' + s, data: data });
                                                return Promise.resolve({}); } };
}
function player(vol, members) {
  var a = { volume_level: vol, supported_features: 8320575 };
  if (members !== undefined) a.group_members = members;
  return { state: 'playing', attributes: a };
}

// Build the card far enough to have its bind handlers. The slider commit is a
// closure inside _bind(), so it is driven the way a finger drives it: through
// the input element's `change`.
function slider(states, entity) {
  var C = customElements.get('hk-media-control-card');
  var c = new C();
  c.setConfig({ type: 'custom:hk-media-control-card', entity: entity, bare: true });
  var h = hassWith(states);
  c.hass = h;
  var el = c.shadowRoot.querySelector('[data-vol]');
  return { card: c, hass: h, el: el };
}

print('=== an ad-hoc group: every member takes the level asked for ===');
var s = slider({}, OFFICE);
s.hass.states[OFFICE] = player(0.20, [OFFICE, KITCHEN]);
s.hass.states[KITCHEN] = player(0.40, []);
s.card.hass = s.hass;
var el = s.card.shadowRoot.querySelector('[data-vol]');
check('the slider exists', !!el);
el.value = '10'; el.onchange();                       // both -> 0.10
var sent = s.hass.sent.filter(function (x) { return x.svc === 'media_player.volume_set'; });
var levels = {};
sent.forEach(function (x) { [].concat(x.data.entity_id).forEach(function (e) {
  levels[e] = x.data.volume_level; }); });
check('the leader takes the level asked for', levels[OFFICE] === 0.1, levels);
check('the member takes the SAME level, not its own', levels[KITCHEN] === 0.1, levels);
check('  (before the fix it stayed at 0.40)', levels[KITCHEN] !== 0.4, levels);
check('  one call, naming both rooms', sent.length === 1
      && sent[0].data.entity_id.length === 2, sent);

print('=== rooms that disagreed end up agreeing ===');
var q = slider({}, OFFICE);
q.hass.states[OFFICE] = player(0.40, [OFFICE, KITCHEN, LOFT]);
q.hass.states[KITCHEN] = player(0.20, []);
q.hass.states[LOFT] = player(0.04, []);
q.card.hass = q.hass;
q.card.shadowRoot.querySelector('[data-vol]').value = '80';
q.card.shadowRoot.querySelector('[data-vol]').onchange();   // everyone -> 0.80
var L = {};
q.hass.sent.filter(function (x) { return x.svc === 'media_player.volume_set'; })
  .forEach(function (x) { [].concat(x.data.entity_id).forEach(function (e) {
    L[e] = x.data.volume_level; }); });
check('leader takes it', L[OFFICE] === 0.8, L);
check('the middle room takes it too', L[KITCHEN] === 0.8, L);
check('and so does the room that was much quieter', L[LOFT] === 0.8, L);
check('  three rooms, all on the same number', L[OFFICE] === L[KITCHEN] && L[KITCHEN] === L[LOFT], L);

// A SYNC group reports group_members as None -- its membership is not
// readable from HA at all -- so the members come from the Music feature's
// presets or the card's `members_map`. Without them a sync group would behave
// differently: an ad-hoc set levelled and a preset scaled proportionally, from
// the same slider, on selections that look identical in the picker.
print('=== a SYNC group levels too, from members_map ===');
var DG = 'media_player.downstairs_homepods_downstairs';
function syncSlider() {
  var C = customElements.get('hk-media-control-card');
  var c = new C();
  c.setConfig({ type: 'custom:hk-media-control-card', entity: DG, bare: true,
                members_map: { 'media_player.downstairs_homepods_downstairs': [KITCHEN, LOFT] } });
  var h = hassWith({});
  h.states[DG] = player(0.40);              // no group_members attribute at all
  h.states[KITCHEN] = player(0.40, []);
  h.states[LOFT] = player(0.04, []);
  c.hass = h;
  return c;
}
var g = syncSlider();
g.shadowRoot.querySelector('[data-vol]').value = '12';
g.shadowRoot.querySelector('[data-vol]').onchange();
// The card sends the group FIRST and the members after, so the promise has to
// settle before the second call is visible.
drainMicrotasks();
var gs = g._hass.sent.filter(function (x) { return x.svc === 'media_player.volume_set'; });
check('two calls: the group, then its members', gs.length === 2, gs);
check('  the group entity first -- setting it LAST would re-scale the members',
      gs[0].data.entity_id === DG, gs[0].data);
check('  then every member, at the level asked for',
      JSON.stringify(gs[1].data.entity_id) === JSON.stringify([KITCHEN, LOFT])
      && gs[1].data.volume_level === 0.12, gs[1].data);
check('  the quiet room is LEVELLED, not left proportionally quiet',
      gs[1].data.volume_level === 0.12, gs[1].data);

print('=== a sync group with no members_map falls back to the group entity ===');
var nm = slider({}, DG);
nm.hass.states[DG] = player(0.40);
nm.card.hass = nm.hass;
nm.card.shadowRoot.querySelector('[data-vol]').value = '12';
nm.card.shadowRoot.querySelector('[data-vol]').onchange();
var ns = nm.hass.sent.filter(function (x) { return x.svc === 'media_player.volume_set'; });
check('one call, the group only', ns.length === 1 && ns[0].data.volume_level === 0.12, ns);

print('=== a lone speaker is unchanged ===');
var o = slider({}, OFFICE);
o.hass.states[OFFICE] = player(0.30, []);
o.card.hass = o.hass;
o.card.shadowRoot.querySelector('[data-vol]').value = '15';
o.card.shadowRoot.querySelector('[data-vol]').onchange();
var os = o.hass.sent.filter(function (x) { return x.svc === 'media_player.volume_set'; });
check('one call, one speaker', os.length === 1 && os[0].data.volume_level === 0.15, os);

print('=== a leader at zero is no special case ===');
var z = slider({}, OFFICE);
z.hass.states[OFFICE] = player(0, [OFFICE, KITCHEN]);
z.hass.states[KITCHEN] = player(0.40, []);
z.card.hass = z.hass;
z.card.shadowRoot.querySelector('[data-vol]').value = '25';
z.card.shadowRoot.querySelector('[data-vol]').onchange();
var zs = z.hass.sent.filter(function (x) { return x.svc === 'media_player.volume_set'; });
var zl = {};
zs.forEach(function (x) { [].concat(x.data.entity_id).forEach(function (e) {
  zl[e] = x.data.volume_level; }); });
check('both rooms get 0.25, same as any other level',
      zl[OFFICE] === 0.25 && zl[KITCHEN] === 0.25, zl);

print(fail ? '\n' + fail + ' FAILED' : '\nALL ' + pass + ' GROUP VOLUME TESTS PASS');
