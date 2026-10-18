// HK's own elements (Phase 2, P2.1): hk-icon draws `hk:` glyphs from HK's iconset and `mdi:`
// names from the host's icon database; hk-plate is HA's ha-card box under HK's name; HA's
// hk-state-icon is a box around ha-state-icon that hands it HA's object and the state.
if (typeof HK_ROOT === 'undefined') throw new Error('HK_ROOT is not set -- run this through tests/run');
load(HK_ROOT + '/tests/dom.js');
var pass = 0, fail = 0;
function ok(name, c, d) { if (c) { pass++; print('  ok   ' + name); } else { fail++; print('  FAIL ' + name + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function settle() { var p = Promise.resolve(); for (var i = 0; i < 8; i++) p = p.then(function () {}); return p; }

var asked = [];
window.customIconsets = { hk: function (id) { asked.push('hk:' + id); return id === 'lamp' ? { path: 'M1 1', secondaryPath: 'M2 2', viewBox: '0 0 24 24' } : undefined; } };
window.hkIcons = { mdiPath: function (id) { asked.push('mdi:' + id); return Promise.resolve(id === 'lightbulb' ? 'M3 3' : undefined); } };
load(HK_ROOT + '/frontend/elements/hk-elements.js');
load(HK_ROOT + '/frontend/modules/hk-ha-elements.js');

var Icon = customElements.get('hk-icon'), Plate = customElements.get('hk-plate'), StateIcon = customElements.get('hk-state-icon');
ok('hk-icon, hk-plate and the host\'s hk-state-icon are defined', !!Icon && !!Plate && !!StateIcon);

var a = new Icon(), b = new Icon(), c = new Icon(), d = new Icon();
a.icon = 'hk:lamp'; b.icon = 'mdi:lightbulb'; c.setAttribute && c.attributeChangedCallback('icon', null, 'lightbulb'); d.icon = 'hk:nothing';
settle().then(function () {
  ok('an hk: glyph from HK\'s iconset, both paths', a.drawn && a.drawn.path === 'M1 1' && a.drawn.secondaryPath === 'M2 2', a.drawn);
  ok('an mdi: name from the host\'s icon database', b.drawn && b.drawn.path === 'M3 3', b.drawn);
  ok('a bare name is mdi, set through the attribute', c.drawn && c.drawn.path === 'M3 3' && c.icon === 'lightbulb');
  ok('a missing glyph draws nothing', d.drawn === null);
  ok('each name asked once', asked.join() === 'hk:lamp,mdi:lightbulb,mdi:lightbulb,hk:nothing', asked);
  a.icon = 'hk:lamp';
  return settle();
}).then(function () {
  ok('the same name again asks nothing', asked.length === 4);
  var p = new Plate();
  var css = p.markup();
  ok('hk-plate: HA\'s ha-card box and variables', /--ha-card-background,var\(--card-background-color,white\)/.test(css) &&
     /border-radius:var\(--ha-card-border-radius,var\(--ha-border-radius-lg,12px\)\)/.test(css) && /:host\(\[raised\]\)/.test(css));
  ok('...no header until one is given', css.indexOf('card-header">') < 0);
  p.header = 'Rooms <&>';
  ok('...a header, escaped', p.markup().indexOf('<h1 class="card-header">Rooms &lt;&amp;&gt;</h1>') >= 0);
  p.raised = true;
  ok('...raised as an attribute', p.hasAttribute('raised') && p.raised === true);
  var si = new StateIcon(), host = { states: {} }, st = { entity_id: 'light.a', state: 'on', attributes: {} };
  window.hkHostClient.from(host).bindStateIcon(si, st);
  var inner = si.inner;
  ok('HA\'s hk-state-icon: ha-state-icon inside, given HA\'s object and the state', !!inner && String(inner.localName || inner.tagName).toLowerCase() === 'ha-state-icon' && inner.hass === host && inner.stateObj === st, inner && inner.tagName);
  si.icon = 'mdi:lamp';
  ok('...and an icon of its own', inner.icon === 'mdi:lamp' && si.icon === 'mdi:lamp');
  print('');
  if (fail) { print('  FAIL ' + fail + ' ELEMENTS TESTS'); throw new Error('elements tests failed'); }
  print('  ALL ' + pass + ' ELEMENTS TESTS PASS');
});
