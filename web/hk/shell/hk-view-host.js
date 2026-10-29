// HK's view host (Phase 2 P2.3): draws an HK dashboard from the strategy's
// output without Lovelace's page machinery -- no hui-root, hui-view or
// hui-card, and no element of the host's at all.
//
// What Lovelace does for a dashboard is a few steps here:
//   * pick the view by the address (/<dashboard>/<view>, as HA's frontend has
//     it; a view without a `path` is addressed by its index),
//   * make the view element (`custom:` views by their tag) and each card in it
//     (createCardElement: `custom:` cards by their tag; Lovelace's grid, stacks
//     and conditional drawn by HK's own small containers below; the
//     picture-entity HK's camera cards make drawn by HK's hk-picture-entity; `markdown` and the
//     four energy cards of the Energy page's "Home Assistant's Charts" drawn by HK too;
//     any other Lovelace card type a labelled placeholder),
//   * setConfig, then hand the view and every card what goes with the client
//     (the host adapter's bridge, window.hkHostClient.bridge), in Lovelace's
//     order: setConfig, the client, narrow, index, cards,
//   * follow the client: each new client goes to the view shown and its cards
//     (a view left keeps its cards, as hui-root caches views, and catches up
//     when it is shown again),
//   * route: HK's own navigation (hkShell.navigate / onNavigate) and the back
//     button (popstate) swap the view in the same container, so the sky, the
//     menu and the tab bar stay mounted,
//   * tell the host shell where the view is (shellParts / onView), so the sky,
//     menu and tab bar find it through hkShell as they do in HA,
//   * take a new config (reconfigure: the strategy built again after a
//     settings change) and draw the view shown again from it, in place.
//
// The host gives it the dashboard config (the strategy's `generate` output),
// the client, and the element the views go in. Mantel's page is web/home.js;
// P2.6's HA panel will be another. Nothing here names a host's element or
// event (tests/test_shell_boundary.py), nor the host's raw object.
(function (global) {
  'use strict';
  if (global.hkViewHost) return;

  function doc() { return global.document; }
  function win() { return global.window || global; }
  function adapter() { return global.hkHostClient || null; }
  function shell() { return global.hkShell || null; }

  // What goes with `client` to a card or view, through the host adapter. An
  // element whose code has not arrived yet is fed once it is configured.
  function feed(el, client) {
    if (!el || !client) return;
    if (el.__hkWaiting) { el.__hkWaiting.client = client; return; }
    var A = adapter();
    if (A && A.bridge) A.bridge(el, client);
  }

  // ------------------------------------------------------------ the factory
  var defined = false;
  function define() {
    if (defined) return;
    var ce = global.customElements, A = adapter();
    if (!ce || typeof global.HTMLElement !== 'function') return;
    defined = true;
    var classes = makeClasses();
    Object.keys(classes).forEach(function (tag) {
      // Lovelace's entry, through the host adapter: each container takes the
      // host's input and gets _onClient(client)
      if (A && A.entry && classes[tag].prototype._onClient) A.entry(classes[tag]);
      if (!ce.get(tag)) ce.define(tag, classes[tag]);
    });
  }

  function typeOf(cfg) { return String((cfg && cfg.type) || ''); }

  // A Lovelace card type HK does not draw, or a card whose config failed: a
  // labelled box in its place, never the host's own card.
  function placeholder(cfg, why) {
    define();
    var el = doc().createElement('hk-card-placeholder');
    el.setConfig(Object.assign({}, cfg || {}, { __why: why || 'type' }));
    return el;
  }

  function configure(el, cfg) {
    try {
      el.setConfig(cfg);
      return true;
    } catch (e) {
      try { console.error('[hk-view-host] setConfig failed for', typeOf(cfg), e); } catch (x) { /* no console */ }
      return false;
    }
  }

  function swap(oldEl, newEl) {
    var p = oldEl && oldEl.parentNode;
    if (p && p.replaceChild) p.replaceChild(newEl, oldEl);
  }

  // Lovelace's container types that HK's strategy and cards use, drawn by HK, and the one picture
  // card HK's camera cards make (hk-cameras.js: the Cameras page's tiles, the camera strip's live
  // tile), drawn by HK's hk-picture-entity below.
  var BUILT_IN = {
    'grid': 'hk-view-grid',
    'vertical-stack': 'hk-view-stack',
    'horizontal-stack': 'hk-view-stack',
    'conditional': 'hk-view-conditional',
    'picture-entity': 'hk-picture-entity',
    'markdown': 'hk-view-markdown',
    'energy-date-selection': 'hk-energy-date-selection',
    'energy-sources-table': 'hk-energy-sources-table',
    'energy-devices-graph': 'hk-energy-devices-graph',
    'energy-devices-detail-graph': 'hk-energy-devices-detail-graph'
  };

  // ------------------------------------------------------------ picture-entity
  // Lovelace's picture-entity card, as far as HK's cards use it: a camera's picture (`entity`, or
  // `camera_image` for an entity that is not a camera), `camera_view` auto (the still, refreshed)
  // or live (WebRTC), `aspect_ratio`, `fit_mode`, `tap_action` (more-info, navigate, none);
  // `show_name` / `show_state` (a one-line footer unless false); `theme` is not applied.
  var PIC_REFRESH_MS = 10000;                    // HA's camera picture refresh (hui-image)
  var PIC_RETRY_MS = [5000, 15000, 30000, 60000, 120000];
  var PIC_TRIES = 6;                             // WebRTC attempts before the tile stays on its still
  var PIC_REFUSED = /^(forbidden|not_allowed|unauthorized|step_up_required)$/;
  var picBust = 0;

  // HA's aspect ratio forms: "16x9", "16:9", "1.78" (width over 1), "56.25%" (height in % of width).
  function parseRatio(v) {
    if (v == null || v === '') return null;
    var s = String(v).trim();
    function num(x) { var f = parseFloat(x); if (!isFinite(f) || f <= 0) throw new Error('ratio'); return f; }
    try {
      if (/%$/.test(s)) return { w: 100, h: num(s.slice(0, -1)) };
      var a = s.replace(':', 'x').split('x');
      return a.length === 1 ? { w: num(a[0]), h: 1 } : { w: num(a[0]), h: num(a[1]) };
    } catch (e) { return null; }
  }

  // the still's address: the entity's own picture (in Mantel already Mantel's still route, under the
  // page's prefix), a counter so the browser never answers from its cache, and the tile's size
  function stillUrl(pic, w, h) {
    var q = pic + (pic.indexOf('?') < 0 ? '?' : '&') + '_hk=' + (++picBust);
    if (w > 0 && h > 0) q += '&width=' + w + '&height=' + h;
    return q;
  }

  function later(fn, ms) { return (global.setTimeout || setTimeout)(fn, ms); }
  function noop() { /* a late or refused answer */ }

  // ICE gathering finished (a camera that wants every candidate in the offer), or 5 s on.
  function gathered(pc) {
    return new Promise(function (res) {
      if (pc.iceGatheringState === 'complete') { res(); return; }
      var t = later(res, 5000);
      pc.onicegatheringstatechange = function () {
        if (pc.iceGatheringState === 'complete') { pc.onicegatheringstatechange = null; clearTimeout(t); res(); }
      };
    });
  }

  var PIC_CSS = ':host{display:block;position:relative;box-sizing:border-box;height:100%;min-height:75px;overflow:hidden;' +
    'border-radius:var(--ha-card-border-radius,12px);box-shadow:var(--ha-card-box-shadow,none);' +
    'background:var(--ha-card-background,var(--card-background-color,#1c1c1e))}' +
    ':host([data-tap]){cursor:pointer}' +
    '#box{position:relative;width:100%;height:100%}' +
    '#box.ratio{height:0}' +
    // TWO STILLS, swapped hard when the new one has loaded: one <img> given a new src paints
    // nothing until the bytes arrive, a black blink every refresh (hk-cameras.js's strip, the same)
    '#box>img,#box>video{position:absolute;left:0;top:0;width:100%;height:100%;display:block;border:0;' +
    'object-fit:var(--hk-pic-fit,cover)}' +
    '#box>img{opacity:0}' +
    '#box>img.on{opacity:1}' +
    '#box>video{z-index:1;background:transparent}' +
    '.foot{position:absolute;left:0;right:0;bottom:0;z-index:2;display:flex;justify-content:space-between;gap:8px;' +
    'padding:10px 16px;background:rgba(0,0,0,.3);color:#fff;font:500 14px/1.3 -apple-system,system-ui,sans-serif}' +
    '.foot>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';

  // THE CARD FACTORY: a card element from its config, with no Lovelace.
  // `client` (optional): fed after setConfig. The view host makes a view's
  // cards with it, and hkCards.createCard makes a container's children with
  // it when the host has no Lovelace.
  function createCardElement(cfg, client) {
    define();
    var t = typeOf(cfg), el;
    if (BUILT_IN[t]) {
      el = doc().createElement(BUILT_IN[t]);
      if (!configure(el, cfg)) return placeholder(cfg, 'error');
      feed(el, client);
      return el;
    }
    if (t.indexOf('custom:') !== 0) return placeholder(cfg, 'type');
    var tag = t.slice(7);
    el = doc().createElement(tag);
    if (typeof el.setConfig === 'function') {
      if (!configure(el, cfg)) return placeholder(cfg, 'error');
      feed(el, client);
      return el;
    }
    // ITS CODE HAS NOT ARRIVED YET: configured and fed once it is defined, as
    // Lovelace's wrapper does (the element is upgraded in place).
    var ce = global.customElements;
    if (!ce || !ce.whenDefined) return placeholder(cfg, 'missing');
    var wait = el.__hkWaiting = { client: client || null };
    ce.whenDefined(tag).then(function () {
      if (ce.upgrade) { try { ce.upgrade(el); } catch (e) { /* upgraded already */ } }
      delete el.__hkWaiting;
      if (typeof el.setConfig !== 'function' || !configure(el, cfg)) { swap(el, placeholder(cfg, 'error')); return; }
      feed(el, wait.client);
    });
    return el;
  }

  // HA's conditional card's conditions, read off the client: state,
  // numeric_state, screen, user, and / or / not (and the legacy form, an
  // entity with state / state_not and no `condition`).
  function holds(cond, client) {
    if (!cond) return true;
    var states = (client && client.states) || {};
    function list(v) { return Array.isArray(v) ? v : [v]; }
    function st(id) { return states[id]; }
    switch (cond.condition || (cond.entity ? 'state' : '')) {
      case 'state': {
        var s = st(cond.entity), v = s ? s.state : 'unavailable';
        if (cond.state !== undefined && list(cond.state).map(String).indexOf(v) < 0) return false;
        if (cond.state_not !== undefined && list(cond.state_not).map(String).indexOf(v) >= 0) return false;
        return true;
      }
      case 'numeric_state': {
        var ns = st(cond.entity), n = ns ? Number(ns.state) : NaN;
        if (isNaN(n)) return false;
        return (cond.above === undefined || n > Number(cond.above)) &&
               (cond.below === undefined || n < Number(cond.below));
      }
      case 'screen': {
        var mm = win().matchMedia;
        return typeof mm === 'function' ? !!mm.call(win(), cond.media_query || 'all').matches : true;
      }
      case 'user': {
        var u = client && client.user;
        return !!u && list(cond.users || []).indexOf(u.id) >= 0;
      }
      case 'and': return (cond.conditions || []).every(function (c) { return holds(c, client); });
      case 'or': return (cond.conditions || []).some(function (c) { return holds(c, client); });
      case 'not': return !(cond.conditions || []).some(function (c) { return holds(c, client); });
      default: return true;
    }
  }

  function styleEl(css) {
    var st = doc().createElement('style');
    st.textContent = css;
    return st;
  }

  // ------------------------------------------------------------ markdown and the energy cards
  // Two more Lovelace types HK's strategy emits, for a host without Lovelace.
  //
  // `markdown` is the one line an empty Energy page says ("Nothing to show yet...") and the
  // paragraph a room page that failed to build says, and the weather alert sheet's text. Drawn
  // as DOM nodes, never as HTML: paragraphs, # headings, - lists, ---, and in a line **bold**,
  // *italic*, `code` and [text](http/https address). Anything else, templates included ({{ }}),
  // stays as the text it is.
  //
  // The four energy cards HK frames on the Energy page when its "Home Assistant's Charts" option
  // is on (energy-date-selection, -sources-table, -devices-graph, -devices-detail-graph) are
  // drawn from the household's Energy settings (energy/get_prefs) and the recorder's statistics
  // (recorder/statistics_during_period, the 'change' of each meter per hour, day or month). The
  // date selection sets one period the other three follow. Cost columns and HA's compare-to-previous
  // period are not drawn.
  var MD_INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/;

  function textNode(s) {
    var d = doc();
    if (d.createTextNode) return d.createTextNode(s);
    var sp = d.createElement('span');
    sp.textContent = s;
    return sp;
  }

  function mdInline(text, parent) {
    String(text).split(MD_INLINE).forEach(function (part) {
      if (!part) return;
      var el, m;
      if (/^\*\*[^*]+\*\*$/.test(part)) { el = doc().createElement('strong'); el.textContent = part.slice(2, -2); }
      else if (/^\*[^*\s][^*]*\*$/.test(part)) { el = doc().createElement('em'); el.textContent = part.slice(1, -1); }
      else if (/^`[^`]+`$/.test(part)) { el = doc().createElement('code'); el.textContent = part.slice(1, -1); }
      else if ((m = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part))) {
        el = doc().createElement('a');
        el.textContent = m[1];
        el.setAttribute('href', m[2]);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      } else el = textNode(part);
      parent.appendChild(el);
    });
  }

  // the blocks of a markdown text, into `parent`
  function mdBlocks(text, parent) {
    var para = [], list = null;
    function add(tag, txt) {
      var e = doc().createElement(tag);
      mdInline(txt, e);
      parent.appendChild(e);
      return e;
    }
    function flush() {
      if (para.length) add('p', para.join(' '));
      para = []; list = null;
    }
    String(text == null ? '' : text).replace(/\r/g, '').split('\n').forEach(function (raw) {
      var line = raw.replace(/\s+$/, ''), m;
      if (!line.trim()) { flush(); return; }
      if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line))) { flush(); add('h' + m[1].length, m[2]); return; }
      if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); parent.appendChild(doc().createElement('hr')); return; }
      if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        if (para.length) { add('p', para.join(' ')); para = []; }
        if (!list) { list = doc().createElement('ul'); parent.appendChild(list); }
        var li = doc().createElement('li');
        mdInline(m[1], li);
        list.appendChild(li);
        return;
      }
      list = null;
      para.push(line.trim());
    });
    flush();
  }

  var MD_CSS = ':host{display:block;box-sizing:border-box;padding:var(--hk-md-pad,8px 4px);' +
    'color:var(--primary-text-color,rgba(255,255,255,.85));font:400 15px/1.5 -apple-system,system-ui,sans-serif;' +
    'overflow-wrap:anywhere}' +
    'p,ul,h1,h2,h3,h4,h5,h6{margin:0 0 .6em}p:last-child,ul:last-child{margin-bottom:0}' +
    'h1,h2,h3,h4,h5,h6{font-weight:600;line-height:1.25}h1{font-size:1.5em}h2{font-size:1.25em}h3{font-size:1.1em}' +
    'ul{padding-left:1.4em}hr{border:0;border-top:1px solid var(--divider-color,rgba(255,255,255,.18));margin:.8em 0}' +
    'a{color:var(--primary-color,#0a84ff)}code{font-family:ui-monospace,Menlo,monospace;font-size:.92em;' +
    'background:rgba(127,127,127,.2);border-radius:4px;padding:0 .3em}.title{font-weight:600;margin:0 0 .5em}';

  // ------------------------------------------------------------ energy: the period and the reads
  var EN_MODES = ['day', 'week', 'month', 'year'];
  var EN_COLORS = ['#32d74b', '#0a84ff', '#ff9f0a', '#bf5af2', '#ff453a', '#64d2ff', '#ffd60a', '#ff375f'];
  var EN_FRESH_MS = 120000, EN_PREFS_MS = 600000;
  var EN = { mode: 'day', off: 0, subs: [], prefs: null, prefsAt: 0, prefsP: null, stats: {} };

  function stats() { return global.hkStats || null; }
  function dayMs(ms, k) {                            // HA-local midnight k days from ms's
    var S = stats();
    if (S && S.addDays) return S.addDays(ms, k || 0);
    var d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + (k || 0));
    return d.getTime();
  }
  function fieldsOf(ms) {
    var S = stats();
    if (S && S.fields) return S.fields(ms);
    var d = new Date(ms);
    return { weekday: d.getDay(), day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
  }
  function monthsFrom(startMs, n) {                  // the first of the month n months from startMs's (a first)
    var t = startMs, i;
    for (i = 0; i < Math.abs(n); i++) {
      if (n < 0) { var last = dayMs(t, -1); t = dayMs(last, 1 - fieldsOf(last).day); }
      else { var f = fieldsOf(t); t = dayMs(t, new Date(Date.UTC(f.year, f.month, 0)).getUTCDate()); }
    }
    return t;
  }

  // the period shown: start, end (exclusive), the recorder's bucket size and each bucket's start
  function enRange(mode, off, client, now) {
    now = now || Date.now();
    var t0 = dayMs(now, 0), f = fieldsOf(t0), s, e, per, edges = [], i, t;
    if (mode === 'week') {
      var S = stats(), ws = S && S.weekStart ? S.weekStart(client) : 0;
      s = dayMs(t0, -(((f.weekday - ws) % 7 + 7) % 7) + 7 * off);
      e = dayMs(s, 7); per = 'day';
      for (i = 0; i < 7; i++) edges.push(dayMs(s, i));
    } else if (mode === 'month') {
      s = monthsFrom(dayMs(t0, 1 - f.day), off);
      e = monthsFrom(s, 1); per = 'day';
      for (t = s; t < e; t = dayMs(t, 1)) edges.push(t);
    } else if (mode === 'year') {
      s = monthsFrom(dayMs(t0, 1 - f.day), off * 12 - (f.month - 1));
      e = monthsFrom(s, 12); per = 'month';
      for (i = 0; i < 12; i++) edges.push(monthsFrom(s, i));
    } else {
      mode = 'day';
      s = dayMs(t0, off); e = dayMs(s, 1); per = 'hour';
      for (t = s; t < e; t += 36e5) edges.push(t);
    }
    return { mode: mode, start: s, end: e, period: per, edges: edges };
  }

  function enLabel(r) {
    var S = stats(), tz = S && S.tz ? S.tz() : undefined, o = { timeZone: tz };
    function fmt(ms, opts) {
      try { return new Date(ms).toLocaleDateString(undefined, Object.assign({}, o, opts)); }
      catch (e) { return new Date(ms).toLocaleDateString(undefined, opts); }
    }
    if (r.mode === 'day') return fmt(r.start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (r.mode === 'week') return fmt(r.start, { month: 'short', day: 'numeric' }) + ' – ' + fmt(r.end - 1, { month: 'short', day: 'numeric', year: 'numeric' });
    if (r.mode === 'month') return fmt(r.start, { month: 'long', year: 'numeric' });
    return fmt(r.start, { year: 'numeric' });
  }
  function enTick(ms, r) {
    var S = stats(), o = { timeZone: S && S.tz ? S.tz() : undefined };
    try {
      if (r.mode === 'day') return new Date(ms).toLocaleTimeString(undefined, Object.assign({ hour: 'numeric' }, o));
      if (r.mode === 'year') return new Date(ms).toLocaleDateString(undefined, Object.assign({ month: 'short' }, o));
      return new Date(ms).toLocaleDateString(undefined, Object.assign({ month: 'short', day: 'numeric' }, o));
    } catch (e) { return ''; }
  }
  function kwh(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    return (a >= 100 ? Math.round(v) : a >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' kWh';
  }

  function enSet(mode, off) {
    if (EN_MODES.indexOf(mode) < 0) mode = 'day';
    off = Math.min(0, off | 0);
    if (mode === EN.mode && off === EN.off) return;
    EN.mode = mode; EN.off = off;
    EN.subs.slice().forEach(function (fn) { try { fn(); } catch (e) { /* a card gone */ } });
  }

  // HA's Energy settings, once per ten minutes for every card
  function enPrefs(client) {
    var now = Date.now();
    if (EN.prefs && now - EN.prefsAt < EN_PREFS_MS) return Promise.resolve(EN.prefs);
    if (EN.prefsP) return EN.prefsP;
    if (!client || !client.callWS) return Promise.resolve({});
    EN.prefsP = client.callWS({ type: 'energy/get_prefs' }).then(function (p) {
      EN.prefs = p && typeof p === 'object' ? p : {}; EN.prefsAt = Date.now(); EN.prefsP = null; return EN.prefs;
    }, function (err) {
      EN.prefsP = null;
      try { console.warn('[hk-energy-cards] energy/get_prefs failed', err); } catch (e) { /* no console */ }
      return {};
    });
    return EN.prefsP;
  }

  function lst(v) { return Array.isArray(v) ? v : []; }
  // the meters, by what they are: the grid's two directions (the older flow_from / flow_to lists and
  // the newer meters on the source itself), solar, the battery's two, gas, water
  function enSources(pr) {
    var out = [];
    function add(label, id) { if (id && typeof id === 'string') out.push({ label: label, id: id }); }
    lst(pr && pr.energy_sources).forEach(function (s) {
      if (s.type === 'grid') {
        if (lst(s.flow_from).length) s.flow_from.forEach(function (f) { add('Grid consumption', f.stat_energy_from); });
        else add('Grid consumption', s.stat_energy_from);
        if (lst(s.flow_to).length) s.flow_to.forEach(function (f) { add('Returned to grid', f.stat_energy_to); });
        else add('Returned to grid', s.stat_energy_to);
      } else if (s.type === 'solar') add('Solar', s.stat_energy_from);
      else if (s.type === 'battery') { add('Battery discharged', s.stat_energy_from); add('Battery charged', s.stat_energy_to); }
      else if (s.type === 'gas') add('Gas', s.stat_energy_from);
      else if (s.type === 'water') add('Water', s.stat_energy_from);
    });
    return out;
  }
  function enDevices(pr, client) {
    return lst(pr && pr.device_consumption).map(function (d) {
      var id = d && d.stat_consumption, st = id && client && client.states ? client.states[id] : null;
      return id ? { id: id, name: d.name || (st && st.attributes && st.attributes.friendly_name) || id } : null;
    }).filter(Boolean);
  }

  // the 'change' of each meter per bucket of the period: { id: [value|null per edge] }
  function enFetch(client, ids, r) {
    ids = ids.filter(function (x, i) { return ids.indexOf(x) === i; });
    if (!ids.length || !client || !client.callWS) return Promise.resolve({});
    var key = [r.period, r.start, r.end, ids.join(',')].join('|'), hit = EN.stats[key];
    if (hit && (hit.p || Date.now() - hit.at < EN_FRESH_MS)) return hit.p || Promise.resolve(hit.data);
    var p = client.callWS({
      type: 'recorder/statistics_during_period',
      start_time: new Date(r.start).toISOString(), end_time: new Date(r.end).toISOString(),
      period: r.period, statistic_ids: ids, types: ['change'], units: { energy: 'kWh' }
    }).then(function (res) {
      var data = {};
      ids.forEach(function (id) {
        var arr = r.edges.map(function () { return null; });
        lst(res && res[id]).forEach(function (row) {
          var t = +new Date(row.start), v = Number(row.change), k = -1, i;
          if (!isFinite(t) || !isFinite(v)) return;
          for (i = r.edges.length - 1; i >= 0; i--) if (r.edges[i] <= t) { k = i; break; }
          if (k >= 0 && t < r.end) arr[k] = (arr[k] || 0) + v;
        });
        data[id] = arr;
      });
      EN.stats[key] = { at: Date.now(), data: data };
      return data;
    }, function (err) {
      delete EN.stats[key];
      try { console.warn('[hk-energy-cards] statistics failed', err); } catch (e) { /* no console */ }
      return {};
    });
    var keys = Object.keys(EN.stats);
    if (keys.length > 40) delete EN.stats[keys[0]];
    EN.stats[key] = { at: Date.now(), p: p };
    return p;
  }
  function sumOf(arr) {
    var s = null;
    (arr || []).forEach(function (v) { if (v != null) s = (s || 0) + v; });
    return s;
  }

  var EN_CSS = ':host{display:block;box-sizing:border-box;padding:16px;overflow:hidden;' +
    'border-radius:var(--ha-card-border-radius,12px);border:var(--ha-card-border-width,0px) solid var(--ha-card-border-color,transparent);' +
    'box-shadow:var(--ha-card-box-shadow,none);background:var(--ha-card-background,var(--card-background-color,rgba(28,28,30,.6)));' +
    'color:var(--primary-text-color,rgba(255,255,255,.94));font:500 14px/1.35 -apple-system,system-ui,sans-serif}' +
    '.empty{color:var(--secondary-text-color,rgba(255,255,255,.6));padding:4px 0}' +
    '.date{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}' +
    '.date .nav{display:flex;align-items:center;gap:4px}' +
    '.date .lab{min-width:9em;text-align:center;font-weight:600}' +
    '.date button,.seg button{font:inherit;color:inherit;background:rgba(255,255,255,.1);border:0;border-radius:10px;padding:6px 12px;cursor:pointer}' +
    '.date button[disabled]{opacity:.35;cursor:default}' +
    '.seg{display:flex;gap:4px;margin-left:auto}.seg button.on{background:#fff;color:#1c1c1e}' +
    'table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid var(--divider-color,rgba(255,255,255,.12))}' +
    'td+td{text-align:right;font-variant-numeric:tabular-nums}tr:last-child td{border-bottom:0}' +
    '.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}' +
    '.rank{display:grid;grid-template-columns:minmax(0,35%) 1fr auto;align-items:center;gap:8px 10px;padding:4px 0}' +
    '.rank .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.rank .tr{height:10px;border-radius:5px;background:rgba(255,255,255,.1);overflow:hidden}' +
    '.rank .fill{height:100%;border-radius:5px}.rank .vl{font-variant-numeric:tabular-nums;color:var(--secondary-text-color,rgba(255,255,255,.7))}' +
    '.cols{display:flex;align-items:flex-end;gap:2px;height:180px;border-bottom:1px solid var(--divider-color,rgba(255,255,255,.18))}' +
    '.col{flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column-reverse}' +
    '.col>div{width:100%}.ticks{display:flex;justify-content:space-between;color:var(--secondary-text-color,rgba(255,255,255,.6));font-size:12px;padding-top:4px}' +
    '.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:10px;font-size:12px;color:var(--secondary-text-color,rgba(255,255,255,.7))}';

  function mk(tag, cls, text) {
    var e = doc().createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function hues() {
    var P = global.hkCards && global.hkCards.PALETTE && global.hkCards.PALETTE.chart;
    return Array.isArray(P) && P.length ? P : EN_COLORS;
  }

  function makeClasses() {
    var H = global.HTMLElement;

    class HkCardPlaceholder extends H {
      setConfig(cfg) {
        this._config = cfg || {};
        var t = typeOf(cfg) || 'a card with no type', why = this._config.__why;
        this.setAttribute('data-type', t);
        this.style.cssText = 'display:block;box-sizing:border-box;padding:10px 12px;border-radius:12px;' +
          'border:1px dashed rgba(255,255,255,.35);color:rgba(255,255,255,.7);' +
          'font:500 12px/1.35 -apple-system,system-ui,sans-serif';
        this.textContent = why === 'error' ? 'This card could not be drawn: ' + t
          : why === 'missing' ? 'Card code not loaded: ' + t
          : 'Drawn only in Home Assistant: ' + t;
      }
      getCardSize() { return 1; }
    }

    // A container: its children made by the factory, each fed the client.
    class HkViewContainerCard extends H {
      _children() { return this._kids || []; }
      _make(cards) {
        var self = this;
        this._kids = (cards || []).map(function (c) { return createCardElement(c, self.client); });
        return this._kids;
      }
      _onClient(client) {
        this._children().forEach(function (k) { feed(k, client); });
      }
      _box(css) {
        if (!this._sr) this._sr = this.attachShadow({ mode: 'open' });
        while (this._sr.firstChild) this._sr.removeChild(this._sr.firstChild);
        this._sr.appendChild(styleEl(css));
        if (this._config.title) {
          var h = doc().createElement('div');
          h.className = 'title';
          h.textContent = this._config.title;
          this._sr.appendChild(h);
        }
        var box = doc().createElement('div');
        box.id = 'box';
        this._sr.appendChild(box);
        return box;
      }
      getCardSize() { return 1; }
    }

    // Lovelace's grid card: `columns` equal tracks (3 unless set). `square`
    // is not drawn: HK's own grids say square: false.
    class HkViewGrid extends HkViewContainerCard {
      setConfig(cfg) {
        this._config = cfg || {};
        var cols = Math.max(1, Number(this._config.columns) || 3);
        var box = this._box(':host{display:block}.title{font-weight:600;padding:0 4px 8px}' +
          '#box{display:grid;gap:var(--grid-card-gap,8px);grid-template-columns:repeat(' + cols + ',minmax(0,1fr))}');
        this._make(this._config.cards).forEach(function (k) { box.appendChild(k); });
      }
    }

    // Lovelace's vertical and horizontal stacks.
    class HkViewStack extends HkViewContainerCard {
      setConfig(cfg) {
        this._config = cfg || {};
        var row = typeOf(cfg) === 'horizontal-stack';
        var box = this._box(':host{display:block}.title{font-weight:600;padding:0 4px 8px}' +
          (row ? '#box{display:flex;flex-direction:row;gap:var(--horizontal-stack-card-gap,var(--stack-card-gap,8px))}' +
                 '#box>*{flex:1 1 0;min-width:0}'
               : '#box{display:flex;flex-direction:column;gap:var(--vertical-stack-card-gap,var(--stack-card-gap,8px))}'));
        this._make(this._config.cards).forEach(function (k) { box.appendChild(k); });
      }
    }

    // Lovelace's conditional card: its card is on the page, and fed, only
    // while the conditions hold; it says so with `hidden` and
    // card-visibility-changed, as Lovelace's does.
    class HkViewConditional extends HkViewContainerCard {
      setConfig(cfg) {
        this._config = cfg || {};
        this._on = null;
        this._card = this._make([this._config.card])[0];
        this.hidden = true;
        this.style.display = 'none';
      }
      _onClient(client) {
        var on = (this._config.conditions || []).every(function (c) { return holds(c, client); });
        if (on) {
          feed(this._card, client);
          if (this._card.parentNode !== this) this.appendChild(this._card);
        } else if (this._card.parentNode === this) {
          this.removeChild(this._card);
        }
        if (on !== this._on) {
          this._on = on;
          this.hidden = !on;
          this.style.display = on ? '' : 'none';
          try {
            this.dispatchEvent(new global.CustomEvent('card-visibility-changed',
              { detail: { value: on }, bubbles: true, composed: true }));
          } catch (e) { /* no events here */ }
        }
      }
    }

    // A view whose type HK cannot draw (Lovelace's masonry, sections, panel):
    // its cards in one column, under a note.
    class HkViewFallback extends H {
      setConfig(cfg) {
        this._config = cfg || {};
        this.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px';
        var note = doc().createElement('div');
        note.textContent = this._config.__error
          ? 'This page could not be drawn (' + this._config.__error + '); its cards are shown in a column.'
          : 'This page’s layout is drawn only in Home Assistant (' + (typeOf(cfg) || 'masonry') +
            '); its cards are shown in a column.';
        note.style.cssText = 'color:rgba(255,255,255,.6);font:500 12px -apple-system,system-ui,sans-serif';
        this._note = note;
        this.appendChild(note);
      }
      set cards(list) {
        var self = this;
        (this._cards || []).forEach(function (c) { if (c.parentNode === self) self.removeChild(c); });
        this._cards = list || [];
        this._cards.forEach(function (c) { self.appendChild(c); });
      }
      get cards() { return this._cards || []; }
    }

    // LOVELACE'S PICTURE-ENTITY, FOR A HOST WITHOUT LOVELACE (Mantel, HK's own panel). HK's camera
    // cards make one per tile through hkCards.createCard; without this every tile was a placeholder.
    //   auto  the still from the entity's `entity_picture`, refreshed every 10 s while it is on
    //         screen (as HA's hui-image does), double-buffered so a refresh never blinks
    //   live  a muted <video> fed by WebRTC through the client, as HA's camera stream: the client
    //         config and our candidates are reads (client.callWS), the offer a read subscription
    //         (client.subscriptions), the same messages HA's player sends. The still stays under
    //         the video (and keeps refreshing) until the video has a picture, and is all there is
    //         when the camera offers no WebRTC.
    // hk-cameras.js finds the <video> in its shadow root (playingVideo, releaseMedia), as it finds
    // HA's.
    class HkPictureEntity extends H {
      setConfig(cfg) {
        if (!cfg || (!cfg.entity && !cfg.camera_image)) throw new Error('picture-entity: an entity is required');
        var again = !!this._sr && this.isConnected;
        if (again) this._halt();
        this._config = cfg;
        this._ratio = parseRatio(cfg.aspect_ratio);
        this._natural = null;
        this._bad = null;
        this._draw();
        if (again) this._go();
      }
      getCardSize() { return 3; }

      // the camera whose picture is drawn: the entity when it is one, else camera_image (HA's rule)
      _camera() {
        var c = this._config || {};
        return String(c.entity || '').indexOf('camera.') === 0 ? c.entity : (c.camera_image || null);
      }
      _live() { return (this._config && this._config.camera_view) === 'live'; }
      _picture() {
        var cl = this.client, id = this._camera(), st = cl && cl.states && id ? cl.states[id] : null;
        var a = st && st.attributes;
        if (!a || st.state === 'unavailable' || a.restored) return null;
        return typeof a.entity_picture === 'string' && a.entity_picture ? a.entity_picture : null;
      }

      _draw() {
        var sr = this._sr || (this._sr = this.attachShadow({ mode: 'open' }));
        while (sr.firstChild) sr.removeChild(sr.firstChild);
        sr.appendChild(styleEl(PIC_CSS));
        var c = this._config, fit = c.fit_mode === 'contain' || c.fit_mode === 'fill' ? c.fit_mode : 'cover';
        this.style.setProperty('--hk-pic-fit', fit);
        var box = this._box = doc().createElement('div');
        box.id = 'box';
        var a = doc().createElement('img'), b = doc().createElement('img');
        a.alt = ''; b.alt = '';
        a.decoding = 'async'; b.decoding = 'async';
        box.appendChild(a); box.appendChild(b);
        this._imgs = [a, b];
        this._front = -1;
        this._loading = false;
        this._video = null;
        if (this._live()) {
          var v = this._video = doc().createElement('video');
          v.muted = true; v.defaultMuted = true; v.autoplay = true; v.playsInline = true;
          v.setAttribute('muted', ''); v.setAttribute('autoplay', ''); v.setAttribute('playsinline', '');
          box.appendChild(v);
        }
        sr.appendChild(box);
        this._foot = null;
        if (c.show_name !== false || c.show_state !== false) {
          var f = this._foot = doc().createElement('div');
          f.className = 'foot';
          f.appendChild(doc().createElement('span'));
          f.appendChild(doc().createElement('span'));
          sr.appendChild(f);
        }
        this._shape();
        this._footer();
        var t = c.tap_action || { action: 'more-info' };
        if ((t.action || 'more-info') === 'none') this.removeAttribute('data-tap'); else this.setAttribute('data-tap', '');
        if (!this._tapOn) {
          var self = this;
          this._tapOn = function (e) { self._tap(e); };
          this.addEventListener('click', this._tapOn);
        }
      }

      // the card's height: its aspect_ratio, else the picture's own shape (16:9 until one is known)
      _shape() {
        var r = this._ratio || this._natural || { w: 16, h: 9 };
        if (!this._box) return;
        this._box.className = 'ratio';
        this._box.style.paddingBottom = (Math.round(10000 * r.h / r.w) / 100) + '%';
      }

      _footer() {
        var f = this._foot;
        if (!f) return;
        var c = this._config, cl = this.client, st = cl && cl.states ? cl.states[c.entity] : null;
        var name = c.name || (st && st.attributes && st.attributes.friendly_name) || c.entity || '';
        var state = st ? (cl.formatEntityState ? cl.formatEntityState(st) : st.state) : '';
        f.childNodes[0].textContent = c.show_name === false ? '' : name;
        f.childNodes[1].textContent = c.show_state === false ? '' : state;
      }

      _tap() {
        var c = this._config || {}, t = c.tap_action || { action: 'more-info' }, act = t.action || 'more-info', S = shell();
        if (act === 'none' || !S) return;
        if (act === 'more-info' && S.moreInfo) S.moreInfo(t.entity || c.entity || this._camera(), this);
        else if (act === 'navigate' && t.navigation_path && S.navigate) S.navigate(t.navigation_path);
      }

      _onClient() {
        this._footer();
        if (!this.isConnected || !this._sr) return;
        // a picture to show and none yet, or a new address after one that failed (HA rotated the token)
        var pic = this._picture();
        if (pic && (this._front < 0 || (this._bad && this._bad !== pic))) this._load();
        if (this._live() && !this._pc && !this._retryT) this._startLive();
      }

      connectedCallback() {
        if (!this._config) return;
        if (!this._sr) this._draw();
        this._go();
      }
      disconnectedCallback() { this._halt(); }

      _go() {
        var self = this, w = win();
        this._visible = true;
        var IO = global.IntersectionObserver;
        if (typeof IO === 'function' && !this._io) {
          try {
            this._io = new IO(function (entries) {
              var e = entries[entries.length - 1];
              var was = self._visible;
              self._visible = !!(e && e.isIntersecting);
              if (self._visible && !was) self._tick();
            });
            this._io.observe(this);
          } catch (e) { this._io = null; }
        }
        if (!this._onVis && w.document && w.document.addEventListener) {
          this._onVis = function () { if (!doc().hidden) self._tick(); };
          w.document.addEventListener('visibilitychange', this._onVis);
        }
        clearInterval(this._timer);
        this._timer = (global.setInterval || setInterval)(function () { self._tick(); }, PIC_REFRESH_MS);
        this._tries = 0;
        this._gaveUp = false;
        this._load();
        if (this._live()) this._startLive();
      }
      _halt() {
        clearInterval(this._timer); this._timer = null;
        clearTimeout(this._retryT); this._retryT = null;
        if (this._io) { try { this._io.disconnect(); } catch (e) { /* gone */ } this._io = null; }
        if (this._onVis) {
          var d = win().document;
          if (d && d.removeEventListener) d.removeEventListener('visibilitychange', this._onVis);
          this._onVis = null;
        }
        this._teardown();
      }

      // the video has a picture: it covers the still, which then waits
      _playing() {
        var v = this._video;
        return !!(v && v.readyState >= 2 && v.videoWidth > 0);
      }
      _tick() {
        if (!this.isConnected || !this._visible || doc().hidden) return;
        if (this._live() && this._playing()) return;
        this._load();
      }

      _load() {
        if (!this._imgs || this._loading) return;
        var pic = this._picture();
        // a picture that failed is not asked for again until its address changes (as the strip's)
        if (!pic || pic === this._bad) return;
        var i = this._front < 0 ? 0 : (this._front + 1) % 2, im = this._imgs[i], other = this._imgs[1 - i];
        var r = this.getBoundingClientRect ? this.getBoundingClientRect() : null;
        var dpr = Math.min(win().devicePixelRatio || 1, 2);
        // (not measured yet: the strip's 480x270 -- a picture is never asked for at the camera's full frame)
        var w = r && r.width > 0 ? Math.min(1920, Math.round(r.width * dpr)) : 480;
        var h = r && r.height > 0 ? Math.min(1920, Math.round(r.height * dpr)) : 270;
        var self = this, url = stillUrl(pic, w, h);
        this._loading = true;
        im.onload = function () {
          im.onload = im.onerror = null;
          self._loading = false;
          self._bad = null;
          self._front = i;
          if (im.classList) { im.classList.add('on'); other.classList.remove('on'); }
          if (!self._ratio && im.naturalWidth > 0 && im.naturalHeight > 0) {
            self._natural = { w: im.naturalWidth, h: im.naturalHeight };
            self._shape();
          }
        };
        im.onerror = function () {
          im.onload = im.onerror = null;
          self._loading = false;
          self._bad = pic;
        };
        im.src = url;
      }

      // ------------------------------------------------ live: WebRTC through the client
      _startLive() {
        if (this._pc || this._retryT || this._gaveUp || !this.isConnected || !this._video) return;
        var cl = this.client, port = cl && cl.subscriptions, entity = this._camera(), RTC = global.RTCPeerConnection;
        if (!cl || typeof cl.callWS !== 'function' || !port || typeof RTC !== 'function' || !entity) return;   // the still only
        var self = this, gen = this._gen = (this._gen || 0) + 1;
        var alive = function () { return self._gen === gen && self.isConnected; };
        this._pc = 'pending';
        cl.callWS({ type: 'camera/webrtc/get_client_config', entity_id: entity }).then(function (cfg) {
          if (!alive()) return;
          cfg = cfg || {};
          var pc = self._pc = new RTC(cfg.configuration || {});
          if (cfg.dataChannel) { try { pc.createDataChannel(cfg.dataChannel); } catch (e) { /* none */ } }
          pc.addTransceiver('audio', { direction: 'recvonly' });
          pc.addTransceiver('video', { direction: 'recvonly' });
          var stream = typeof global.MediaStream === 'function' ? new global.MediaStream() : null;
          pc.ontrack = function (e) {
            if (!alive()) return;
            var s = stream || (e.streams && e.streams[0]);
            if (stream) stream.addTrack(e.track);
            var v = self._video;
            if (v && s && v.srcObject !== s) v.srcObject = s;
            var p = v && v.play ? v.play() : null;
            if (p && p.catch) p.catch(noop);
          };
          var session = null, pending = [], upfront = !!cfg.getCandidatesUpfront;
          var send = function (cand) {
            var r = cl.callWS({ type: 'camera/webrtc/candidate', entity_id: entity, session_id: session, candidate: cand });
            if (r && r.catch) r.catch(noop);
          };
          pc.onicecandidate = function (e) {
            if (!e.candidate || upfront || !alive()) return;
            var cand = typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate;
            if (session) send(cand); else pending.push(cand);
          };
          pc.onconnectionstatechange = function () {
            if (!alive()) return;
            var s = pc.connectionState;
            if (s === 'connected') self._tries = 0;
            if (s === 'failed' || s === 'closed') self._again();
          };
          return pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer).then(function () { return offer; });
          }).then(function (offer) {
            if (!alive()) return null;
            return (upfront ? gathered(pc) : Promise.resolve()).then(function () {
              if (!alive()) return null;
              var sdp = upfront && pc.localDescription ? pc.localDescription.sdp : offer.sdp;
              return port.subscribeMessage(function (m) {
                if (!alive() || !m) return;
                if (m.type === 'session') {
                  session = m.session_id;
                  pending.splice(0).forEach(send);
                } else if (m.type === 'answer') {
                  pc.setRemoteDescription({ type: 'answer', sdp: m.answer }).catch(function () { if (alive()) self._again(); });
                } else if (m.type === 'candidate') {
                  var ic = typeof m.candidate === 'string' ? { candidate: m.candidate, sdpMLineIndex: 0 } : m.candidate;
                  var r = pc.addIceCandidate(ic);
                  if (r && r.catch) r.catch(noop);
                } else if (m.type === 'error') {
                  try { console.warn('[hk-picture-entity] ' + entity + ': no live view (' + (m.code || '') + ' ' + (m.message || '') + ')'); } catch (e) { /* no console */ }
                  self._again();
                }
              }, { type: 'camera/webrtc/offer', entity_id: entity, offer: sdp });
            }).then(function (unsub) {
              if (typeof unsub !== 'function') return;
              if (alive()) { self._unsub = unsub; return; }
              var r = unsub();
              if (r && r.catch) r.catch(noop);
            });
          });
        }).catch(function (e) {
          if (alive()) self._again(e);
        });
      }
      // an error or a dead connection: the still meanwhile, another try later. REFUSED (the viewer
      // may not watch this camera live here, e.g. Mantel's door rules): the still only, no retry.
      _again(e) {
        this._teardown();
        if (e && PIC_REFUSED.test(String(e.code || ''))) { this._gaveUp = true; return; }
        if (!this.isConnected || this._retryT) return;
        var n = this._tries = (this._tries || 0) + 1;
        if (n >= PIC_TRIES) { this._gaveUp = true; return; }      // left on its still
        var self = this;
        this._retryT = later(function () {
          self._retryT = null;
          if (self.isConnected) self._startLive();
        }, PIC_RETRY_MS[Math.min(n - 1, PIC_RETRY_MS.length - 1)]);
      }
      _teardown() {
        this._gen = (this._gen || 0) + 1;
        if (this._unsub) {
          try { var r = this._unsub(); if (r && r.catch) r.catch(noop); } catch (e) { /* socket gone */ }
        }
        this._unsub = null;
        var pc = this._pc;
        this._pc = null;
        if (pc && pc.close) { try { pc.close(); } catch (e) { /* closed */ } }
        var v = this._video;
        if (v) {
          try { if (v.pause) v.pause(); } catch (e) { /* not playing */ }
          v.srcObject = null;
        }
      }
    }

    // LOVELACE'S MARKDOWN CARD, the subset HK uses (see mdBlocks above). No HTML is ever parsed.
    class HkViewMarkdown extends H {
      setConfig(cfg) {
        if (!cfg || typeof cfg.content !== 'string') throw new Error('markdown: content is required');
        this._config = cfg;
        var sr = this._sr || (this._sr = this.attachShadow({ mode: 'open' }));
        while (sr.firstChild) sr.removeChild(sr.firstChild);
        sr.appendChild(styleEl(MD_CSS));
        if (cfg.title) sr.appendChild(mk('div', 'title', String(cfg.title)));
        var box = mk('div', 'md');
        mdBlocks(cfg.content, box);
        sr.appendChild(box);
      }
      getCardSize() { return 2; }
    }

    // The base of the four energy cards: follows the shared period, asks (once per period, and
    // again when the answer is two minutes old) for the meters its `_ids` names, and `_paint`s.
    class HkEnergyCard extends H {
      setConfig(cfg) {
        this._config = cfg || {};
        this._sig = null;
        var sr = this._sr || (this._sr = this.attachShadow({ mode: 'open' }));
        while (sr.firstChild) sr.removeChild(sr.firstChild);
        sr.appendChild(styleEl(EN_CSS));
        this._body = mk('div', 'body');
        sr.appendChild(this._body);
        this._note('Loading…');
        if (this.isConnected) this._go();
      }
      getCardSize() { return 4; }
      connectedCallback() { if (this._config) this._go(); }
      disconnectedCallback() {
        var i = EN.subs.indexOf(this._sub);
        if (i >= 0) EN.subs.splice(i, 1);
        this._sub = null;
        this._sig = null;
      }
      _go() {
        var self = this;
        if (!this._sub) { this._sub = function () { self._refresh(); }; EN.subs.push(this._sub); }
        this._refresh();
      }
      _onClient() { if (this.isConnected && this._config) this._refresh(); }
      _note(text) {
        while (this._body.firstChild) this._body.removeChild(this._body.firstChild);
        this._body.appendChild(mk('div', 'empty', text));
      }
      _clear() { while (this._body.firstChild) this._body.removeChild(this._body.firstChild); return this._body; }

      _refresh() {
        var cl = this.client, self = this;
        if (!cl || !cl.callWS || !this._config) return;
        var r = enRange(EN.mode, EN.off, cl), sig = r.mode + '|' + r.start;
        if (sig === this._sig && Date.now() - this._at < EN_FRESH_MS) return;
        this._sig = sig; this._at = Date.now();
        var tok = this._tok = (this._tok || 0) + 1;
        enPrefs(cl).then(function (pr) {
          var ids = self._ids(pr, cl);
          return enFetch(cl, ids, r).then(function (data) { return { pr: pr, ids: ids, data: data }; });
        }).then(function (res) {
          if (tok !== self._tok || !self._sub) return;
          self._paint(r, res.pr, res.data, cl, res.ids);
        });
      }
    }

    // energy-date-selection: Day / Week / Month / Year and the arrows, the period the others follow
    class HkEnergyDate extends HkEnergyCard {
      _go() {
        var self = this;
        if (!this._sub) { this._sub = function () { self._refresh(); }; EN.subs.push(this._sub); }
        this._refresh();
      }
      _onClient() { if (this.isConnected && this._config && !this._painted) this._refresh(); }
      _refresh() {
        this._painted = true;
        var r = enRange(EN.mode, EN.off, this.client), body = this._clear(), wrap = mk('div', 'date');
        var nav = mk('div', 'nav'), prev = mk('button', 'prev', '‹'), next = mk('button', 'next', '›');
        prev.setAttribute('aria-label', 'Previous');
        next.setAttribute('aria-label', 'Next');
        prev.addEventListener('click', function () { enSet(EN.mode, EN.off - 1); });
        next.addEventListener('click', function () { enSet(EN.mode, EN.off + 1); });
        if (EN.off >= 0) next.setAttribute('disabled', '');
        nav.appendChild(prev); nav.appendChild(mk('span', 'lab', enLabel(r))); nav.appendChild(next);
        wrap.appendChild(nav);
        var seg = mk('div', 'seg');
        EN_MODES.forEach(function (m) {
          var b = mk('button', m === r.mode ? 'on' : '', m.charAt(0).toUpperCase() + m.slice(1));
          b.setAttribute('data-mode', m);
          b.addEventListener('click', function () { enSet(m, 0); });
          seg.appendChild(b);
        });
        wrap.appendChild(seg);
        body.appendChild(wrap);
      }
      _ids() { return []; }
      _paint() { /* _refresh draws it */ }
    }

    // energy-sources-table: each source's energy over the period
    class HkEnergySources extends HkEnergyCard {
      _ids(pr) { return enSources(pr).map(function (s) { return s.id; }); }
      _paint(r, pr, data) {
        var src = enSources(pr);
        if (!src.length) { this._note('No energy sources are set up yet.'); return; }
        var rows = [], by = {};
        src.forEach(function (s) {
          var row = by[s.label];
          if (!row) { row = by[s.label] = { label: s.label, v: null }; rows.push(row); }
          var v = sumOf(data[s.id]);
          if (v != null) row.v = (row.v || 0) + v;
        });
        var tb = mk('table'), pal = hues();
        rows.forEach(function (row, i) {
          var tr = mk('tr'), c1 = mk('td'), dot = mk('span', 'dot');
          dot.style.background = pal[i % pal.length];
          c1.appendChild(dot); c1.appendChild(textNode(row.label));
          tr.appendChild(c1); tr.appendChild(mk('td', '', kwh(row.v)));
          tb.appendChild(tr);
        });
        this._clear().appendChild(tb);
      }
    }

    // energy-devices-graph: the devices, most energy first
    class HkEnergyDevices extends HkEnergyCard {
      _ids(pr, cl) { return enDevices(pr, cl).map(function (d) { return d.id; }); }
      _paint(r, pr, data, cl) {
        var devs = enDevices(pr, cl).map(function (d) { return { name: d.name, v: sumOf(data[d.id]) }; })
          .filter(function (d) { return d.v != null && d.v > 0; })
          .sort(function (a, b) { return b.v - a.v; }).slice(0, 20);
        if (!devs.length) { this._note(enDevices(pr, cl).length ? 'No device energy for this period.' : 'No individual devices are set up yet.'); return; }
        var body = this._clear(), max = devs[0].v, c = hues()[0];
        devs.forEach(function (d) {
          var row = mk('div', 'rank'), tr = mk('div', 'tr'), fill = mk('div', 'fill');
          fill.style.width = Math.max(1, Math.round(1000 * d.v / max) / 10) + '%';
          fill.style.background = c;
          tr.appendChild(fill);
          row.appendChild(mk('div', 'nm', d.name)); row.appendChild(tr); row.appendChild(mk('div', 'vl', kwh(d.v)));
          body.appendChild(row);
        });
      }
    }

    // energy-devices-detail-graph: the devices stacked, one column per hour / day / month
    class HkEnergyDetail extends HkEnergyCard {
      _ids(pr, cl) { return enDevices(pr, cl).map(function (d) { return d.id; }); }
      _paint(r, pr, data, cl) {
        var devs = enDevices(pr, cl).map(function (d) { return { name: d.name, a: data[d.id] || [], v: sumOf(data[d.id]) }; })
          .filter(function (d) { return d.v != null && d.v > 0; })
          .sort(function (a, b) { return b.v - a.v; });
        if (!devs.length) { this._note(enDevices(pr, cl).length ? 'No device energy for this period.' : 'No individual devices are set up yet.'); return; }
        var pal = hues(), top = devs.slice(0, 8), rest = devs.slice(8);
        var series = top.map(function (d, i) { return { name: d.name, a: d.a, color: pal[i % pal.length] }; });
        if (rest.length) {
          series.push({ name: 'Other', color: 'rgba(255,255,255,.35)', a: r.edges.map(function (_e, i) {
            return rest.reduce(function (s, d) { return s + (d.a[i] || 0); }, 0);
          }) });
        }
        var totals = r.edges.map(function (_e, i) { return series.reduce(function (s, d) { return s + (d.a[i] || 0); }, 0); });
        var max = Math.max.apply(null, totals.concat([0.000001]));
        var body = this._clear(), cols = mk('div', 'cols');
        r.edges.forEach(function (t, i) {
          var col = mk('div', 'col');
          col.setAttribute('title', enTick(t, r) + ': ' + kwh(totals[i]));
          series.forEach(function (s) {
            var v = s.a[i] || 0;
            if (v <= 0) return;
            var seg = mk('div');
            seg.style.height = (Math.round(10000 * v / max) / 100) + '%';
            seg.style.background = s.color;
            col.appendChild(seg);
          });
          cols.appendChild(col);
        });
        body.appendChild(cols);
        var ticks = mk('div', 'ticks'), n = r.edges.length;
        [0, Math.floor((n - 1) / 2), n - 1].forEach(function (i) { ticks.appendChild(mk('span', '', enTick(r.edges[i], r))); });
        body.appendChild(ticks);
        var lg = mk('div', 'legend');
        series.forEach(function (s) {
          var it = mk('span'), dot = mk('span', 'dot');
          dot.style.background = s.color;
          it.appendChild(dot); it.appendChild(textNode(s.name));
          lg.appendChild(it);
        });
        body.appendChild(lg);
      }
    }

    return {
      'hk-picture-entity': HkPictureEntity,
      'hk-view-markdown': HkViewMarkdown,
      'hk-energy-date-selection': HkEnergyDate,
      'hk-energy-sources-table': HkEnergySources,
      'hk-energy-devices-graph': HkEnergyDevices,
      'hk-energy-devices-detail-graph': HkEnergyDetail,
      'hk-card-placeholder': HkCardPlaceholder,
      'hk-view-grid': HkViewGrid,
      'hk-view-stack': HkViewStack,
      'hk-view-conditional': HkViewConditional,
      'hk-view-fallback': HkViewFallback
    };
  }

  // ------------------------------------------------------------ the views
  // A view's address: its path, else its index (HA's rule).
  function pathOf(view, i) { return view && view.path ? String(view.path) : String(i); }

  function cardsOf(view) {
    if (Array.isArray(view.cards)) return view.cards;
    var out = [];
    (view.sections || []).forEach(function (s) { (s && s.cards || []).forEach(function (c) { out.push(c); }); });
    return out;
  }

  function narrow() {
    var w = win().innerWidth;
    return typeof w === 'number' ? w < 870 : false;
  }

  // ------------------------------------------------------------ the host
  // PAGES VISITED LONG AGO ARE LET GO (2026-10-29). A view left is kept, as hui-root keeps its views, so going back
  // is instant and a page catches up with the client it missed -- but every page ever opened stayed in memory for
  // the life of the screen, cards and all: on a wall tablet that is up for weeks, a visitor who tapped through
  // twenty pages left twenty built. Now Home (the first view, the page a screen comes back to) and the last
  // KEEP_RECENT pages shown are kept; the rest are dropped and made again when next shown, from the config, as on a
  // first visit: its cameras start afresh and it opens at the top. `seen` remembers which pages were built once,
  // so the host's "first visit" (Mantel widens its state subscription for a page it has not seen) means the first
  // time ever, not "not cached".
  var KEEP_RECENT = 4;

  // opts:
  //   container  the element that holds the view (the sky mounts in it)
  //   slot       where the view element goes (default: the container)
  //   config     the dashboard config: { views: [...] }
  //   client     the first client (later ones follow hkHostClient.current())
  //   base       the dashboard's address, '/<dashboard>' (default: the
  //              address's first segment)
  //   follow     false: the caller hands each client with setClient()
  //   willShow(view, first)  awaited before a view is shown (Mantel widens its
  //              state subscription for a page it has not seen)
  //   leave(path)  an address outside this dashboard (default: load it)
  function create(opts) {
    opts = opts || {};
    define();
    var container = opts.container || null;
    if (!container) throw new Error('hkViewHost.create: a container is required');
    var slot = opts.slot || container;
    var config = opts.config || { views: [] };
    var base = opts.base || ('/' + (global.location.pathname.split('/')[1] || ''));
    var client = opts.client || null;
    var cache = {};                // view index -> { el, cards, view, index, path, fed }
    var seen = {};                 // view index -> true once built (kept when the page is let go)
    var recent = [];               // the pages shown last (not Home), the newest at the end
    var cur = null;
    var stale = null;              // the view shown before reconfigure(): replaced in place by the next show()
    var turn = 0;                  // the newest show() wins
    var target = -1;               // the view it asked for
    var listeners = [];
    var offs = [];

    function views() { return (config && config.views) || []; }
    function find(path) {
      var vs = views(), p = path == null ? '' : String(path);
      if (!vs.length) return -1;
      if (!p) return 0;
      for (var i = 0; i < vs.length; i++) if (vs[i] && vs[i].path === p) return i;
      if (/^\d+$/.test(p) && Number(p) < vs.length) return Number(p);
      return 0;                    // an unknown view: the first, as HA does
    }

    function feedEntry(entry, c) {
      if (!entry || !c) return;
      entry.fed = c;
      feed(entry.el, c);
      for (var i = 0; i < entry.cards.length; i++) feed(entry.cards[i], c);
    }

    function viewElement(view) {
      var t = typeOf(view), ce = global.customElements;
      if (t.indexOf('custom:') !== 0) {
        var fb = doc().createElement('hk-view-fallback');
        fb.setConfig(view);
        return Promise.resolve(fb);
      }
      var tag = t.slice(7);
      var ready = ce && ce.whenDefined && !ce.get(tag) ? ce.whenDefined(tag) : Promise.resolve();
      return ready.then(function () {
        var el = doc().createElement(tag);
        el.setConfig(view);
        return el;
      }).catch(function (e) {
        // a view whose config throws: its cards in a column, under a note that says so
        try { console.error('[hk-view-host] view setConfig failed for', t, e); } catch (x) { /* no console */ }
        var fb = doc().createElement('hk-view-fallback');
        fb.setConfig(Object.assign({}, view, { __error: String((e && e.message) || e) }));
        return fb;
      });
    }

    function build(i) {
      var view = views()[i];
      return viewElement(view).then(function (el) {
        feed(el, client);
        try { el.narrow = narrow(); el.index = i; } catch (e) { /* a view without them */ }
        var cards = cardsOf(view).map(function (c) { return createCardElement(c, client); });
        el.cards = cards;
        return { el: el, cards: cards, view: view, index: i, path: pathOf(view, i), fed: client };
      });
    }

    function tell(entry, first) {
      listeners.slice().forEach(function (fn) {
        try { fn(entry.el, entry.view, config, { first: first, path: entry.path }); }
        catch (e) { try { console.error('[hk-view-host] view listener threw', e); } catch (x) { /* no console */ } }
      });
    }

    // Show the view at `path` (a path, an index, or '' for the first).
    // Resolves with its element, or null when a newer show() took over.
    function show(path) {
      var my = ++turn, i = find(path);
      target = i;
      if (i < 0) return Promise.resolve(null);
      var first = !seen[i];
      var wait = opts.willShow ? Promise.resolve().then(function () { return opts.willShow(views()[i], first); })
                                     .catch(function (e) { try { console.error('[hk-view-host] willShow', e); } catch (x) { /* */ } })
                               : Promise.resolve();
      return wait.then(function () {
        if (my !== turn) return null;
        return cache[i] ? cache[i] : build(i).then(function (entry) { cache[i] = cache[i] || entry; seen[i] = true; return cache[i]; });
      }).then(function (entry) {
        if (!entry || my !== turn) return null;
        if (entry.fed !== client) feedEntry(entry, client);
        if (cur === entry) return entry.el;
        var old = cur || stale, again = !cur && !!stale;
        stale = null;
        cur = entry;
        // the shell learns the new view BEFORE it is attached: the view says
        // it is up (hk-view-ready) as it attaches, and the tab bar and the sky
        // ask the shell for it then
        tell(entry, first);
        if (old && old.el.parentNode === slot) slot.removeChild(old.el);
        slot.appendChild(entry.el);
        if (old && !again && typeof win().scrollTo === 'function') { try { win().scrollTo(0, 0); } catch (e) { /* */ } }
        letGo(entry.index);
        return entry.el;
      });
    }

    // The page just shown is now the newest; Home and the last KEEP_RECENT stay, the others are dropped. A dropped
    // page was taken out of the document when it was left, so its cards' timers and streams have already stopped
    // (disconnectedCallback); what is done here is to let go of the elements, so nothing holds them.
    function letGo(shown) {
      if (shown !== 0) {
        var at = recent.indexOf(shown);
        if (at >= 0) recent.splice(at, 1);
        recent.push(shown);
        if (recent.length > KEEP_RECENT) recent.splice(0, recent.length - KEEP_RECENT);
      }
      Object.keys(cache).forEach(function (k) {
        var i = Number(k), entry = cache[k];
        if (i === 0 || recent.indexOf(i) >= 0 || entry === cur) return;
        delete cache[k];
        if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);      // (it never is: left views are out)
        entry.cards.length = 0;
        try { entry.el.cards = []; } catch (e) { /* a view without them */ }
        entry.fed = null;
      });
    }

    // A NEW CONFIG (the host built the strategy again: a settings change,
    // hk-strategy.js refresh() -> config-refresh): the view shown is made
    // again from it in place -- the same address, the page left where it was
    // scrolled -- and the views left are made again when next shown.
    function reconfigure(cfg) {
      config = cfg || { views: [] };
      if (cur) stale = cur;
      cur = null;
      cache = {};
      seen = {};
      recent = [];
      target = -1;
      return show(viewPathOf(global.location.pathname).view);
    }

    // Each new client: to the view shown and its cards. `force`: again with
    // the same client (Mantel records which states a page reads that way).
    function setClient(c, force) {
      if (!c || (c === client && !force)) return;
      client = c;
      if (cur) feedEntry(cur, c);
    }
    function refresh() { setClient(client, true); }

    // THE ROUTER: HK's navigation and the back button. A hash change (a
    // pop-up) is not a page change; an address on another dashboard leaves.
    function viewPathOf(pathname) {
      var parts = String(pathname || '').split('/');
      return { dashboard: '/' + (parts[1] || ''), view: parts[2] || '' };
    }
    function route() {
      var at = viewPathOf(global.location.pathname);
      if (at.dashboard !== base) {
        if (opts.leave) opts.leave(global.location.pathname);
        else global.location.assign(global.location.href);
        return null;
      }
      // the view asked for last (shown, or on its way) stays: nothing to do
      if (target === find(at.view) && target >= 0) return Promise.resolve(cur ? cur.el : null);
      return show(at.view);
    }

    function start() {
      var S = shell();
      if (S && S.onNavigate) offs.push(S.onNavigate(route));
      var w = win();
      if (w.addEventListener) {
        w.addEventListener('popstate', route);
        offs.push(function () { w.removeEventListener('popstate', route); });
      }
      if (opts.follow !== false && w.addEventListener) {
        var onUpdate = function () {
          var A = adapter();
          if (A && A.current) setClient(A.current());
        };
        w.addEventListener('hk-client-update', onUpdate);
        offs.push(function () { w.removeEventListener('hk-client-update', onUpdate); });
        onUpdate();                // the host's newest client, if it moved on since create()
      }
      return route();
    }
    function stop() { offs.splice(0).forEach(function (off) { try { off(); } catch (e) { /* */ } }); }

    // Move to a view of this dashboard by its path (HK's own navigation).
    function navigate(path) {
      var S = shell(), to = base + '/' + String(path || '');
      if (S && S.navigate) return S.navigate(to);
      return null;
    }

    // The parts of a host shell this host can answer (hkShell.use merges
    // them over the host's own): the container, the view shown, the config.
    function shellParts() {
      return {
        panel: function () { return container; },
        viewContainer: function () { return container; },
        viewSlot: function () { return container; },
        view: function (c) { return (c === undefined || c === container) && cur ? cur.el : null; },
        dashboardConfig: function () { return config; },
        tags: { viewContainer: container.localName || null, view: cur ? cur.el.localName : null }
      };
    }

    function onView(fn) {
      listeners.push(fn);
      return function () { var k = listeners.indexOf(fn); if (k >= 0) listeners.splice(k, 1); };
    }

    // Lovelace's card helpers, for the cards that ask for them (hk-grid-card,
    // hk-frame, pop-ups, detail sheets), when the host has none: the factory.
    if (opts.helpers !== false && typeof win().loadCardHelpers !== 'function') {
      win().loadCardHelpers = function () {
        return Promise.resolve({ createCardElement: function (cfg) { return createCardElement(cfg); } });
      };
    }

    return {
      config: config,
      base: base,
      container: container,
      slot: slot,
      show: show,
      start: start,
      stop: stop,
      route: route,
      navigate: navigate,
      setClient: setClient,
      refresh: refresh,
      reconfigure: reconfigure,
      client: function () { return client; },
      current: function () {
        return cur ? { path: cur.path, index: cur.index, view: cur.view, element: cur.el, cards: cur.cards.slice() } : null;
      },
      cached: function () { return Object.keys(cache).map(function (k) { return cache[k].path; }); },
      // the pages built at least once since the config was made (cached() are the ones still held)
      seen: function () {
        return Object.keys(seen).map(function (k) { return pathOf(views()[Number(k)], Number(k)); });
      },
      shellParts: shellParts,
      onView: onView
    };
  }

  global.hkViewHost = {
    create: create,
    createCardElement: createCardElement,
    holds: holds,
    define: define,
    pictureRatio: parseRatio,
    BUILT_IN: Object.freeze(Object.assign({}, BUILT_IN))
  };
})(globalThis);
