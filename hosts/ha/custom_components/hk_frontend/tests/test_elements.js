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
  // Phase 2 P2.2: the cards' CSS now lands on hk-state-icon where it landed on ha-state-icon, so
  // HA's box must not draw a box of its own: ha-state-icon inside lays out as if it were the host's
  ok('...a transparent box (ha-state-icon inside is display:contents, the host has no size of its own)',
     StateIcon.CSS === 'ha-state-icon{display:contents}', StateIcon.CSS);

  // Phase 2 P2.2: hk-icon is HA's two boxes, ha-icon (inline, fill:currentColor) around
  // ha-svg-icon (inline-flex, --mdc-icon-size), with HA's rules, so the cards' CSS lays out the same
  var css = window.hkElements.ICON_CSS;
  ok('hk-icon: the host is ha-icon\'s (inline, only the fill)', /^:host\{fill:currentcolor\}/.test(css), css.slice(0, 40));
  ok('...the inner box is ha-svg-icon\'s', /\.i\{display:var\(--ha-icon-display,inline-flex\);vertical-align:middle;fill:var\(--icon-primary-color,currentcolor\);width:var\(--mdc-icon-size,24px\);height:var\(--mdc-icon-size,24px\)/.test(css));
  ok('...and its second path HA\'s half opacity', /path\.s\{fill:var\(--icon-secondary-color,currentcolor\);opacity:var\(--icon-secondary-opactity,\.5\)\}/.test(css));
  var e = new Icon(), box = e.shadowRoot.querySelector('.i');
  e.icon = 'mdi:lightbulb';
  ok('...a name shows the inner box', !!box && box.hidden === false);
  e.icon = '';
  ok('...and without one nothing is drawn (ha-icon renders nothing without one)', box.hidden === true);
  // an icon asked for before its set is registered is drawn when it is, not left blank
  var late = new Icon();
  late.icon = 'late:star';
  return settle().then(function () {
    ok('an icon whose set is not registered yet draws nothing', late.drawn === null);
    window.customIconsets.late = function (id) { return { path: 'M9 9 ' + id }; };
    ok('...hkElements.iconsetAdded() draws it again', window.hkElements.iconsetAdded() === 1);
    return settle();
  }).then(function () {
    ok('...with its glyph', late.drawn && late.drawn.path === 'M9 9 star', late.drawn);
    ok('...and forgets it (nothing waits any more)', window.hkElements.iconsetAdded() === 0);
  });
}).then(function () {
  print('');
  if (fail) { print('  FAIL ' + fail + ' ELEMENTS TESTS'); throw new Error('elements tests failed'); }
  print('  ALL ' + pass + ' ELEMENTS TESTS PASS');
});
