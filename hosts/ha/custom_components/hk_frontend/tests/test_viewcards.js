// HK's markdown and energy cards (web/hk/shell/hk-view-host.js): the Lovelace types HK's strategy
// emits that its view host did not draw. `markdown` (the Energy page's "Nothing to show yet" line, a
// failed room page's note, the weather alert sheet): DOM nodes only, never HTML. The four energy
// cards of the Energy page's "Home Assistant's Charts" (energy-date-selection, -sources-table,
// -devices-graph, -devices-detail-graph): drawn from energy/get_prefs and
// recorder/statistics_during_period (the 'change' per hour, day or month), following one shared period.
//
// A small DOM of its own, with connectedCallback / disconnectedCallback as a browser runs them.
if (typeof HK_ROOT === 'undefined') throw new Error('HK_ROOT is not set -- run this through tests/run');

var pass = 0, fail = 0;
function ok(name, c, d) {
  if (c) { pass++; print('  ok   ' + name); }
  else { fail++; print('  FAIL ' + name + (d !== undefined ? '   got ' + (function () { try { return JSON.stringify(d); } catch (e) { return String(d); } })() : '')); }
}
function settle() { var p = Promise.resolve(); for (var i = 0; i < 20; i++) p = p.then(function () {}); return p; }

// ------------------------------------------------------------------ the DOM
var made = [];
var registry = {}, byCtor = new Map();
function Style() {}
Style.prototype.setProperty = function (k, v) { this[k] = v; };
Style.prototype.getPropertyValue = function (k) { return this[k] || ''; };
Style.prototype.removeProperty = function (k) { delete this[k]; };
function ClassList(el) { this.el = el; }
ClassList.prototype.add = function () { var s = this._s(); for (var i = 0; i < arguments.length; i++) if (s.indexOf(arguments[i]) < 0) s.push(arguments[i]); this.el.className = s.join(' '); };
ClassList.prototype.remove = function () { var a = [].slice.call(arguments); this.el.className = this._s().filter(function (x) { return a.indexOf(x) < 0; }).join(' '); };
ClassList.prototype.contains = function (c) { return this._s().indexOf(c) >= 0; };
ClassList.prototype._s = function () { return String(this.el.className || '').split(/\s+/).filter(Boolean); };

class Node {
  constructor(tag) {
    this.localName = tag || byCtor.get(new.target) || 'div';
    this.tagName = this.localName.toUpperCase();
    this.childNodes = []; this.parentNode = null; this.attrs = {}; this.style = new Style();
    this._l = {}; this._text = ''; this.className = ''; this.classList = new ClassList(this);
  }
  get children() { return this.childNodes; }
  get firstChild() { return this.childNodes[0] || null; }
  get isConnected() { var n = this; while (n) { if (n === document.root) return true; n = n.parentNode || n.host || null; } return false; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  appendChild(c) {
    var was = c.isConnected;
    if (c.parentNode) c.parentNode.removeChild(c);
    this.childNodes.push(c); c.parentNode = this;
    if (!was && c.isConnected) connect(c, true);
    return c;
  }
  removeChild(c) {
    var i = this.childNodes.indexOf(c);
    if (i < 0) return c;
    var was = c.isConnected;
    this.childNodes.splice(i, 1); c.parentNode = null;
    if (was) connect(c, false);
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  attachShadow() { this.shadowRoot = new Node('#shadow'); this.shadowRoot.host = this; return this.shadowRoot; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter(function (x) { return x !== f; }); }
  dispatchEvent(e) { e.target = e.target || this; (this._l[e.type] || []).slice().forEach(function (f) { f(e); }); if (e.bubbles && this.parentNode) this.parentNode.dispatchEvent(e); return true; }
  getBoundingClientRect() { return { width: 400, height: 225 }; }
}
function connect(n, on) {
  var cb = on ? 'connectedCallback' : 'disconnectedCallback';
  if (typeof n[cb] === 'function') n[cb]();
  n.childNodes.slice().forEach(function (c) { connect(c, on); });
}
globalThis.HTMLElement = class HTMLElement extends Node {};
globalThis.customElements = {
  define: function (name, Ctor) { registry[name] = Ctor; byCtor.set(Ctor, name); },
  get: function (name) { return registry[name]; },
  whenDefined: function (name) { return Promise.resolve(registry[name]); }
};
var docL = {};
globalThis.document = {
  createTextNode: function (t) { var n = new Node('#text'); n.textContent = t; return n; },
  root: new Node('#document'),
  hidden: false,
  createElement: function (tag) {
    tag = String(tag).toLowerCase();
    made.push(tag);
    var C = registry[tag];
    if (C) return new C();
    var el = new HTMLElement(tag);
    if (tag === 'img') { el.src = ''; el.naturalWidth = 0; el.naturalHeight = 0; imgs.push(el); }
    if (tag === 'video') {
      el.readyState = 0; el.videoWidth = 0; el.paused = true; el.srcObject = null;
      el.play = function () { this.paused = false; plays++; return Promise.resolve(); };
      el.pause = function () { this.paused = true; };
    }
    return el;
  },
  addEventListener: function (t, f) { (docL[t] = docL[t] || []).push(f); },
  removeEventListener: function (t, f) { docL[t] = (docL[t] || []).filter(function (x) { return x !== f; }); }
};
document.body = document.root.appendChild(new Node('body'));
globalThis.CustomEvent = function (type, init) { this.type = type; init = init || {}; this.detail = init.detail; this.bubbles = !!init.bubbles; };
var winL = {};
globalThis.addEventListener = function (t, f) { (winL[t] = winL[t] || []).push(f); };
globalThis.removeEventListener = function (t, f) { winL[t] = (winL[t] || []).filter(function (x) { return x !== f; }); };
globalThis.dispatchEvent = function (e) { (winL[e.type] || []).slice().forEach(function (f) { f(e); }); return true; };
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.devicePixelRatio = 2;
var stack = ['/dashboard-test/cameras'];
globalThis.location = { get pathname() { return stack[stack.length - 1]; }, get href() { return 'http://hk.test' + stack[stack.length - 1]; } };
globalThis.history = { pushState: function (s, t, p) { stack.push(p); }, replaceState: function (s, t, p) { stack[stack.length - 1] = p; } };

// timers on demand
var timers = [], tid = 0;
globalThis.setTimeout = function (fn, ms) { timers.push({ id: ++tid, fn: fn, ms: ms, once: true }); return tid; };
globalThis.setInterval = function (fn, ms) { timers.push({ id: ++tid, fn: fn, ms: ms, once: false }); return tid; };
globalThis.clearTimeout = globalThis.clearInterval = function (id) { timers = timers.filter(function (t) { return t.id !== id; }); };

var imgs = [], plays = 0;
window.hkShell.use({ kind: 'test' });
load(HK_ROOT + '/frontend/shell/hk-view-host.js');
var V = window.hkViewHost;

// every text under a node, and every descendant of a tag
function textOf(n) { return (n.localName === '#text' ? n.textContent : n.textContent || '') + n.childNodes.map(textOf).join(''); }
function all(n, out) { out = out || []; n.childNodes.forEach(function (c) { out.push(c); all(c, out); }); return out; }
function tags(n, t) { return all(n).filter(function (x) { return x.localName === t; }); }
function divs(n, cls) { return tags(n, 'div').filter(function (d) { return d.className === cls; }); }
function body(el) { return el.shadowRoot; }
function click(b) { b.dispatchEvent({ type: 'click' }); }
function modeBtn(el, m) { return tags(body(el), 'button').filter(function (b) { return b.getAttribute('data-mode') === m; })[0]; }

// ------------------------------------------------------------------ the factory knows them
['markdown', 'energy-date-selection', 'energy-sources-table', 'energy-devices-graph', 'energy-devices-detail-graph']
  .forEach(function (t) {
    ok(t + ' is a built-in type, not a placeholder', !!V.BUILT_IN[t] &&
       V.createCardElement(t === 'markdown' ? { type: t, content: 'x' } : { type: t }).localName !== 'hk-card-placeholder');
  });
ok('a type nobody draws is still a placeholder', V.createCardElement({ type: 'gauge' }).localName === 'hk-card-placeholder');

// ------------------------------------------------------------------ markdown
var NOTHING = 'Nothing to show yet: add devices in Home Assistant’s Energy settings, or on HK Settings → Features → Energy.';
var md = V.createCardElement({ type: 'markdown', content: NOTHING });
ok('markdown: the Energy page\'s empty line is drawn', md.localName === 'hk-view-markdown' && textOf(body(md)).indexOf(NOTHING) >= 0, textOf(body(md)));
ok('markdown: one paragraph', tags(body(md), 'p').length === 1);

var rich = V.createCardElement({ type: 'markdown', content:
  '## Heat Advisory\n\n**Until 8 PM** and *later*, `code`.\nSecond line.\n\n- one\n- two\n\n---\n\n[From the NWS](https://alerts.example/x)' });
var rb = body(rich);
ok('markdown: heading, bold, italic, code', tags(rb, 'h2').length === 1 && textOf(tags(rb, 'h2')[0]) === 'Heat Advisory' &&
   tags(rb, 'strong').length === 1 && tags(rb, 'em').length === 1 && tags(rb, 'code').length === 1);
ok('markdown: soft line breaks join into one paragraph', textOf(tags(rb, 'p')[0]).indexOf('. Second line.') >= 0, textOf(tags(rb, 'p')[0]));
ok('markdown: a list and a rule', tags(rb, 'ul').length === 1 && tags(rb, 'li').length === 2 && tags(rb, 'hr').length === 1);
var link = tags(rb, 'a')[0];
ok('markdown: an https link opens apart, noopener', link && link.getAttribute('href') === 'https://alerts.example/x' &&
   link.getAttribute('target') === '_blank' && /noopener/.test(link.getAttribute('rel')));

var bad = V.createCardElement({ type: 'markdown', content:
  '[click](javascript:alert(1)) <img src=x onerror=alert(1)> <script>boom()</script> {{ states("sensor.x") }} [d](data:text/html,hi)' });
var bb = body(bad);
ok('markdown: no link for javascript: or data:, the text stays', tags(bb, 'a').length === 0 && textOf(bb).indexOf('javascript:alert(1)') >= 0);
ok('markdown: HTML and templates stay text, no element made', textOf(bb).indexOf('<img src=x onerror=alert(1)>') >= 0 &&
   textOf(bb).indexOf('{{ states("sensor.x") }}') >= 0 && tags(bb, 'img').length === 0 && tags(bb, 'script').length === 0 &&
   made.indexOf('img') < 0 && made.indexOf('script') < 0);
ok('markdown: a title', textOf(body(V.createCardElement({ type: 'markdown', title: 'Notes', content: 'x' }))).indexOf('Notes') > 0);
ok('markdown: no content is a card that could not be drawn', V.createCardElement({ type: 'markdown' }).localName === 'hk-card-placeholder');

// ------------------------------------------------------------------ the energy cards
var realNow = Date.now, skew = 0;
Date.now = function () { return realNow() + skew; };
function midnight(k) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + (k || 0)); return d.getTime(); }

var ALLOWED = ['type', 'start_time', 'end_time', 'statistic_ids', 'period', 'types', 'units'];
var calls = [];
function house(prefs, rowsFor) {
  return {
    states: { 'sensor.washer_e': { entity_id: 'sensor.washer_e', state: '1', attributes: { friendly_name: 'Washer' } } },
    callWS: function (msg) {
      calls.push(msg);
      if (msg.type === 'energy/get_prefs') return Promise.resolve(prefs);
      if (msg.type === 'recorder/statistics_during_period') {
        var out = {};
        msg.statistic_ids.forEach(function (id) { out[id] = rowsFor(id, msg); });
        return Promise.resolve(out);
      }
      return Promise.resolve(null);
    }
  };
}
function statCalls(from) { return calls.slice(from || 0).filter(function (m) { return m.type === 'recorder/statistics_during_period'; }); }
var PREFS = {
  energy_sources: [
    { type: 'grid', flow_from: [{ stat_energy_from: 'sensor.grid_in' }], flow_to: [{ stat_energy_to: 'sensor.grid_out' }] },
    { type: 'solar', stat_energy_from: 'sensor.solar_e' },
    { type: 'battery', stat_energy_from: 'sensor.bat_out', stat_energy_to: 'sensor.bat_in' }
  ],
  device_consumption: [{ stat_consumption: 'sensor.washer_e' }, { stat_consumption: 'sensor.dryer_e', name: 'Dryer' },
                       { stat_consumption: 'sensor.idle_e', name: 'Idle' }]
};
// today's hours: grid 1 kWh in hours 9 and 10; the dryer 2 then 1; the washer 0.5 at 9; solar 4 at 9
function rows(id, msg) {
  var t9 = midnight(0) + 9 * 36e5, t10 = t9 + 36e5;
  if (msg.period === 'hour') {
    if (id === 'sensor.grid_in') return [{ start: t9, change: 1 }, { start: t10, change: 1 }];
    if (id === 'sensor.dryer_e') return [{ start: t9, change: 2 }, { start: t10, change: 1 }];
    if (id === 'sensor.washer_e') return [{ start: t9, change: 0.5 }];
    if (id === 'sensor.solar_e') return [{ start: t9, change: 4 }];
    return [];
  }
  // days / months: one row at the start of the period
  return id === 'sensor.grid_in' ? [{ start: new Date(msg.start_time).getTime(), change: 7 }] : [];
}
function mount(type, cl) {
  var el = V.createCardElement({ type: type }, cl);
  document.body.appendChild(el);
  return el;
}
function drop(el) { document.body.removeChild(el); }

var dateEl, srcEl, devEl, detEl, cl1 = window.hkHostClient.from(house(PREFS, rows)), n0;
Promise.resolve().then(function () {
  dateEl = mount('energy-date-selection', cl1);
  srcEl = mount('energy-sources-table', cl1);
  devEl = mount('energy-devices-graph', cl1);
  detEl = mount('energy-devices-detail-graph', cl1);
  return settle();
}).then(function () {
  ok('settings read once for all four cards', calls.filter(function (m) { return m.type === 'energy/get_prefs'; }).length === 1);
  ok('only allowed read keys are sent', calls.every(function (m) { return Object.keys(m).every(function (k) { return ALLOWED.indexOf(k) >= 0; }); }),
     calls.map(function (m) { return Object.keys(m); }));
  var s = statCalls().filter(function (m) { return m.statistic_ids.indexOf('sensor.grid_in') >= 0; })[0];
  ok('statistics: today by the hour, "change", in kWh', s && s.period === 'hour' && s.types.length === 1 && s.types[0] === 'change' &&
     s.units.energy === 'kWh' && new Date(s.start_time).getTime() === midnight(0) && new Date(s.end_time).getTime() === midnight(1), s);
  ok('statistics: every source meter in one call', s && ['sensor.grid_in', 'sensor.grid_out', 'sensor.solar_e', 'sensor.bat_out', 'sensor.bat_in']
     .every(function (id) { return s.statistic_ids.indexOf(id) >= 0; }), s && s.statistic_ids);

  // the date selection
  var db = tags(body(dateEl), 'button');
  ok('date selection: the arrows and Day / Week / Month / Year', db.length === 6 && textOf(db[4]) === 'Month' && db[3].getAttribute('data-mode') === 'week', db.map(textOf));
  ok('date selection: Day is on, and "next" is off today', modeBtn(dateEl, 'day').className === 'on' && db[1].hasAttribute('disabled'));

  // the sources table
  var cells = tags(body(srcEl), 'tr').map(function (r) { return r.childNodes.map(textOf); });
  ok('sources table: a row per kind, grid summed over the day', cells.length === 5 && cells[0][0] === 'Grid consumption' && cells[0][1] === '2.00 kWh' &&
     cells[2][0] === 'Solar' && cells[2][1] === '4.00 kWh', cells);
  ok('sources table: a meter with no rows shows a dash', cells[1][1] === '—', cells[1]);

  // the devices graph: ranked, named from the settings or the entity
  var nm = divs(body(devEl), 'nm').map(textOf);
  ok('devices graph: dryer then washer, the idle one left out', nm.join() === 'Dryer,Washer', nm);
  ok('devices graph: totals', divs(body(devEl), 'vl').map(textOf).join() === '3.00 kWh,0.50 kWh');
  var fills = divs(body(devEl), 'fill');
  ok('devices graph: the bar is the share of the largest', fills[0].style.width === '100%' && parseFloat(fills[1].style.width) < 20, fills.map(function (f) { return f.style.width; }));

  // the detail graph: a column per hour, stacked
  var cols = divs(body(detEl), 'col');
  ok('detail graph: a column per hour', cols.length >= 23 && cols.length <= 25, cols.length);
  ok('detail graph: hour 9 stacks the dryer and the washer; hour 10 the dryer alone; hour 3 nothing',
     cols[9].childNodes.length === 2 && cols[10].childNodes.length === 1 && cols[3].childNodes.length === 0);
  ok('detail graph: the tallest column fills the plot', parseFloat(cols[9].childNodes[0].style.height) + parseFloat(cols[9].childNodes[1].style.height) === 100);
  var lg = divs(body(detEl), 'legend')[0];
  ok('detail graph: a legend with the devices', textOf(lg).indexOf('Dryer') >= 0 && textOf(lg).indexOf('Washer') >= 0);

  // Week: every card follows
  n0 = calls.length;
  click(modeBtn(dateEl, 'week'));
  return settle();
}).then(function () {
  var more = statCalls(n0);
  ok('week: asked again by the day, a 7-day window', more.length === 2 && more.every(function (m) { return m.period === 'day'; }) &&
     Math.round((new Date(more[0].end_time) - new Date(more[0].start_time)) / 864e5) === 7, more.map(function (m) { return m.period; }));
  ok('week: no new settings read', calls.slice(n0).filter(function (m) { return m.type === 'energy/get_prefs'; }).length === 0);
  var cells = tags(body(srcEl), 'tr').map(function (r) { return r.childNodes.map(textOf); });
  ok('week: the table follows (7 kWh on the first day)', cells[0][1] === '7.00 kWh', cells);
  ok('week: the detail graph has no devices to stack but says so', textOf(body(detEl)).indexOf('No device energy') >= 0, textOf(body(detEl)));
  ok('week: the label is a range', /–/.test(textOf(tags(body(dateEl), 'span')[0])), textOf(tags(body(dateEl), 'span')[0]));

  // previous
  click(tags(body(dateEl), 'button')[0]);
  return settle();
}).then(function () {
  var s = statCalls(), last = s[s.length - 1], start = new Date(last.start_time).getTime();
  ok('previous: the week before', Math.round((new Date(last.end_time) - start) / 864e5) === 7 && start < midnight(-6), last);
  ok('previous: "next" is on now', !tags(body(dateEl), 'button')[1].hasAttribute('disabled'));
  click(tags(body(dateEl), 'button')[1]);
  click(modeBtn(dateEl, 'year'));
  return settle();
}).then(function () {
  var s = statCalls(), y = s[s.length - 1], a = new Date(y.start_time), days = (new Date(y.end_time) - a) / 864e5;
  ok('year: by the month, a whole year', y.period === 'month' && days >= 364 && days <= 366, y);
  ok('year: starts on the 1st of a month', new Date(y.start_time).getDate() === 1);
  click(modeBtn(dateEl, 'month'));
  return settle();
}).then(function () {
  var s = statCalls(), m = s[s.length - 1], days = (new Date(m.end_time) - new Date(m.start_time)) / 864e5;
  ok('month: by the day, 28 to 31 of them', m.period === 'day' && days >= 27.9 && days <= 31.1, days);
  ok('month: starts on the 1st', new Date(m.start_time).getDate() === 1);

  // gone from the page: the period changing asks for nothing
  var before = calls.length;
  [dateEl, srcEl, devEl, detEl].forEach(drop);
  click(modeBtn(dateEl, 'day'));
  return settle().then(function () {
    ok('cards gone from the page stop following the period', calls.length === before, calls.length - before);
  });
}).then(function () {
  // ---------------------------------------------------------------- nothing set up
  skew += 11 * 60e3;
  var bare = window.hkHostClient.from(house({}, rows));
  var a = mount('energy-sources-table', bare), b = mount('energy-devices-graph', bare), c = mount('energy-devices-detail-graph', bare);
  return settle().then(function () {
    ok('no sources: the table says so', textOf(body(a)).indexOf('No energy sources') >= 0, textOf(body(a)));
    ok('no devices: both graphs say so', textOf(body(b)).indexOf('No individual devices') >= 0 && textOf(body(c)).indexOf('No individual devices') >= 0);
    [a, b, c].forEach(drop);
  });
}).then(function () {
  // ---------------------------------------------------------------- the settings read refused
  skew += 11 * 60e3;
  var refused = { states: {}, callWS: function () { return Promise.reject({ code: 'forbidden' }); } };
  var a = mount('energy-devices-graph', window.hkHostClient.from(refused));
  return settle().then(function () {
    ok('a refused read draws the empty line, not an error', textOf(body(a)).indexOf('No individual devices') >= 0, textOf(body(a)));
    drop(a);
  });
}).then(function () {
  // ---------------------------------------------------------------- statistics failing
  skew += 11 * 60e3;
  var failing = { states: {}, callWS: function (m) {
    return m.type === 'energy/get_prefs' ? Promise.resolve(PREFS) : Promise.reject(new Error('boom'));
  } };
  var a = mount('energy-sources-table', window.hkHostClient.from(failing));
  return settle().then(function () {
    ok('statistics failing: the rows show dashes', tags(body(a), 'tr').length === 5 && textOf(tags(body(a), 'tr')[0]).indexOf('—') >= 0);
    drop(a);
  });
}).then(function () {
  var host = made.filter(function (t) { return /^(hui-|ha-)/.test(t); });
  ok('not one host element made (no hui-*, no ha-*)', host.length === 0, host);
  Date.now = realNow;
  print('');
  if (fail) { print('  FAIL ' + fail + ' VIEW CARD TESTS'); throw new Error('view card tests failed'); }
  print('  ALL ' + pass + ' VIEW CARD TESTS PASS');
}).catch(function (e) {
  print('  FAIL the suite threw: ' + e + '\n' + (e && e.stack));
  throw e;
});
