// EVERY CARD'S PICKER ENTRY AND EDITOR, as a person meets them.
//
// Editors drift the way code does: labels that are the raw config key
// ("min_hour_col"), dropdowns listing internal values ("on_off_sentence"), a
// Status text dropdown with NO options, a vacuum sensor labelled with a
// tile's "Room line", developer notes as picker descriptions, a card that
// exists but is missing from the picker. None of it throws, so nothing else
// catches it. This walks every registered hk-*-card and holds it to the rules.
//
// It cannot render ha-form (jsc has no HA frontend); that an edit actually
// reaches the preview is checked in a browser.
var DIR = HK_ROOT + '/';
load(DIR + 'tests/dom.js');
window.customCards = [];
var defined = {}, od = customElements.define.bind(customElements);
customElements.define = function (n, c) { defined[n] = c; return od(n, c); };
['hk-base', 'hk-tile', 'hk-chip', 'hk-stat', 'hk-control', 'hk-row', 'hk-weather', 'hk-popup',
 'hk-media', 'hk-cameras', 'hk-security', 'hk-home', 'hk-energy', 'hk-layout', 'hk-headers', 'hk-grid-cards'].forEach(function (f) {
  load(DIR + 'frontend/cards/' + f + '.js');
});
var pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; } else { fail++; print('  FAIL  ' + n + (x ? '   ' + x : '')); } }

var hass = { states: {} };
['light.a', 'climate.a', 'sensor.a', 'script.a', 'vacuum.a', 'media_player.a', 'input_select.a',
 'weather.a', 'number.a', 'cover.a', 'fan.a', 'alarm_control_panel.a', 'lock.a', 'switch.a', 'timer.a']
  .forEach(function (id) { hass.states[id] = { entity_id: id, state: 'on', attributes: {} }; });

function flatten(schema, out) {
  (schema || []).forEach(function (s) {
    if (s.type === 'expandable') ok('section has a title', !!s.title, JSON.stringify(s).slice(0, 80));
    if (s.schema) flatten(s.schema, out); else out.push(s);
  });
  return out;
}
var RAW = /_/;                       // a label or option still showing a config key
var JARGON = /`|hk-|button-card|swipe|\bTHE\b|\bpx\b/;

// (hk-pager-card: a Home Grid block's pages, built by the catalog from the block, never by hand)
var NOT_IN_PICKER = { 'hk-screensaver-status-card': 1, 'hk-screensaver-now-card': 1, 'hk-pager-card': 1, 'hk-grid-conditional-card': 1, 'hk-grid-entity-card': 1 };
var cards = Object.keys(defined).filter(function (n) { return /^hk-.*-card$/.test(n); }).sort();
print('=== ' + cards.length + ' cards ===');
cards.forEach(function (tag) {
  var C = defined[tag];
  var entry = window.customCards.filter(function (c) { return c.type === tag; })[0];
  // the screensaver's own cards are defined but NOT offered in "Add card"
  // (pinned to a corner at no height, they float over a dashboard's page)
  if (NOT_IN_PICKER[tag]) { ok(tag + ' is left out of the card picker', !entry); return; }
  ok(tag + ' is in the card picker', !!entry);
  if (!entry) return;
  ok(tag + ' name is "HK …"', /^HK [A-Z]/.test(entry.name), entry.name);
  ok(tag + ' description is a sentence for people', !!entry.description && /\.$/.test(entry.description)
     && !JARGON.test(entry.description), entry.description);
  ok(tag + ' has a starter config', typeof C.getStubConfig === 'function');
  var stub = null;
  try { stub = C.getStubConfig && C.getStubConfig(hass); } catch (e) { stub = 'ERR ' + e; }
  ok(tag + ' starter config builds', stub && typeof stub === 'object', String(stub));
  // The picker lays the stub OVER its own `custom:<tag>`: a `type` in it
  // other than that one replaces it ("Unknown type: hk-row-card").
  ok(tag + ' starter config keeps the picker\'s type', !stub || !stub.type || stub.type === 'custom:' + tag,
     stub && stub.type);
  // SECTIONS: every card says how big it wants to be (hk-base.js GRID)
  var go = C.prototype && typeof C.prototype.getGridOptions === 'function' ? C.prototype.getGridOptions() : null;
  ok(tag + ' gives Sections a size', !!go && (go.columns === 'full' || go.columns > 0) && go.rows === 'auto', JSON.stringify(go));
  ok(tag + ' has an editor', typeof C.getConfigElement === 'function');
  if (typeof C.getConfigElement !== 'function' || tag === 'hk-camera-mosaic-card') return;  // mosaic: test_editor.js

  var probe = C.getConfigElement(), EC = defined[String(probe.tagName || '').toLowerCase()];
  var ed = EC ? new EC() : probe;
  if (!ed.appendChild) ed.appendChild = function () {};
  ed.hass = hass; ed.setConfig({ type: 'custom:' + tag });
  var form = ed._form, fields = flatten(form && form.schema, []);
  ok(tag + ' editor has fields', fields.length > 0);
  var seen = {};
  fields.forEach(function (f) {
    var label = form.computeLabel(f);
    ok(tag + '.' + f.name + ' has a readable label', label && !RAW.test(label), label);
    ok(tag + '.' + f.name + ' appears once', !seen[f.name]); seen[f.name] = true;
    var sel = f.selector && f.selector.select;
    if (sel) {
      ok(tag + '.' + f.name + ' dropdown is not empty', (sel.options || []).length > 0);
      (sel.options || []).forEach(function (o) {
        ok(tag + '.' + f.name + ' option "' + o.value + '" has a readable name',
           o.label && !RAW.test(o.label), o.label);
      });
    }
    if (typeof form.computeHelper === 'function') {
      var h = form.computeHelper(f);
      ok(tag + '.' + f.name + ' help text is not a raw key', !h || !/^[a-z_]+$/.test(h), h);
    }
  });
});

print('\n=== the specific traps ===');
function fieldsOf(tag) {
  var C = defined[tag], p = C.getConfigElement(), EC = defined[String(p.tagName).toLowerCase()];
  var e = new EC(); e.appendChild = function () {}; e.hass = hass; e.setConfig({});
  return { form: e._form, list: flatten(e._form.schema, []) };
}
['hk-light-card', 'hk-fan-card', 'hk-cover-card'].forEach(function (t) {
  ok(t + ' offers no empty Status text dropdown',
     !fieldsOf(t).list.some(function (f) { return f.name === 'label_mode'; }));
});
var vac = fieldsOf('hk-vacuum-card'), room = vac.list.filter(function (f) { return f.name === 'room'; })[0];
ok('vacuum room is labelled as a sensor', /sensor/i.test(vac.form.computeLabel(room)));
ok('vacuum room does not borrow the tile help text', vac.form.computeHelper(room) !== window.hkCards.HELPERS.room);
ok('speaker picker is in the picker', window.customCards.some(function (c) { return c.type === 'hk-speaker-picker-card'; }));

// ON SOMEONE ELSE'S DASHBOARD (hk-base.js place): HA's own view or card
// editor above the card, and no HK grid view between -> data-hk-foreign
print('\n=== where a card is ===');
function at(chain) {          // chain: tags from the card's parent up; '#' = a shadow root
  var card = { attrs: {}, hasAttribute: function (k) { return k in this.attrs; },
               toggleAttribute: function (k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; } };
  var n = card;
  chain.forEach(function (t) {
    var next = t === '#' ? { host: null } : { localName: t };
    if (n.host === null) n.host = next; else n.parentNode = next;
    n = next;
  });
  window.hkCards.place(card);
  return 'data-hk-foreign' in card.attrs;
}
ok('a card in a section of a Sections view: someone else\'s dashboard',
   at(['hui-card', 'div', '#', 'hui-grid-section', '#', 'hui-sections-view', 'hui-view']));
ok('...in a Masonry column', at(['hui-card', 'div', '#', 'hui-masonry-view', 'hui-view']));
ok('...in the card editor\'s preview', at(['hui-card', '#', 'hui-card-preview', 'div']));
ok('on an HK screen (HK\'s grid view): not', !at(['hui-card', 'div', '#', 'hk-grid-view', 'hui-view']));
ok('...nested in an HK card on an HK screen: not', !at(['div', '#', 'hk-row-card', 'hui-card', '#', 'hk-grid-view', 'hui-view']));
ok('an overlay on the page body (screensaver, sheet, pop-up): not', !at(['div', '#', 'div', 'body']));
// a Home Grid screen's Home (hk-home-grid-view: each card in its cell): its own screen, not someone else's
ok('on a Home Grid screen (in its cell): not', !at(['hui-card', 'div', '#', 'hk-home-grid-view', 'hui-view']));
ok('...nested in an HK card on a Home Grid: not', !at(['div', '#', 'hk-row-card', 'hui-card', 'div', '#', 'hk-home-grid-view']));
// THE LIGHT LOOK (hk-base.js tone): someone else's dashboard, HA in light
// mode, no sky -> the tokens on the card; anything else -> none of them
function toned(foreignPage, dark, sky) {
  var props = {};
  var card = { attrs: {}, hasAttribute: function (k) { return k in this.attrs; },
               toggleAttribute: function (k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; },
               style: { setProperty: function (k, v) { props[k] = v; }, removeProperty: function (k) { delete props[k]; } } };
  if (foreignPage) card.attrs['data-hk-foreign'] = '';
  var savedSky = window.hkSky;
  window.hkSky = sky ? { element: function () { return { isConnected: true }; } } : undefined;
  window.hkCards.tone(card, { themes: { darkMode: dark } });
  var out = { props: props, light: 'data-hk-light' in card.attrs, card: card };
  window.hkSky = savedSky;
  return out;
}
var lt = toned(true, false, false);
ok('someone else\'s dashboard, light theme: the light look', lt.light && lt.props['--hk-ink'] === 'var(--primary-text-color, #1c1c1e)' &&
   Object.keys(lt.props).length === Object.keys(window.hkCards.LIGHT).length);
ok('...the dark theme: none of it', !toned(true, true, false).light && !Object.keys(toned(true, true, false).props).length);
ok('...with HK\'s sky behind it: none of it', !toned(true, false, true).light);
ok('an HK screen in a light theme: none of it', !toned(false, false, false).light);
(function () {
  var t = toned(true, false, false), c = t.card;
  delete c.attrs['data-hk-foreign'];
  window.hkCards.tone(c, { themes: { darkMode: false } });
  ok('moved to an HK screen: the light look is taken off again', !('data-hk-light' in c.attrs) && !Object.keys(t.props).length);
})();
var tileGrid = window.hkCards.gridFor('hk-light-card'), hdrGrid = window.hkCards.gridFor('hk-header-card');
ok('a tile asks for half a section', tileGrid.columns === 6 && tileGrid.rows === 'auto', JSON.stringify(tileGrid));
ok('the header the full width', hdrGrid.columns === 'full', JSON.stringify(hdrGrid));
ok('anything else a full column it can be narrowed from', window.hkCards.gridFor('hk-thermostat-card').columns === 12);

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' EDITORS TESTS PASS'));
