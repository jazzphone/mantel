/* Sky Lab: drive the sky by hand -- every weather, time of day, brightness and
 * scene -- to see what it does. Two places, one panel:
 *
 *   /hk/pages/skylab.html          the sky alone, in a view container of its
 *                                  own, with mock cards. A static page under
 *                                  /hk/, so PUBLIC (see EXPOSURE in
 *                                  __init__.py): it holds no data, reads no
 *                                  state and frames nothing.
 *   /<dashboard>?skylab            a REAL dashboard, signed in as itself (the
 *                                  Companion app, a kiosk, a browser alike),
 *                                  its own sky pinned through hkSky._pin.
 *                                  hk-loader.js imports this module only when
 *                                  the URL says ?skylab, and only the flag's
 *                                  presence is read -- never its value.
 *
 * PREVIEW ONLY, ON A DASHBOARD. Before the panel shows -- and with the page
 * under a cover until then -- this window's Home Assistant connection is
 * locked down: only messages known to READ go out (READS below -- states,
 * registries, subscriptions, history, camera streams); every other message --
 * a service call, a script, an event, any write, anything not recognised -- is
 * answered as if it had worked and never sent; so is every fetch that is not a
 * GET. A toast says what was held back. Taps still open pop-ups and pages.
 * Exit reloads the page without ?skylab, which is the only way the lockdown
 * ends.
 *
 * Nothing is saved but the panel's own settings, in this tab's sessionStorage,
 * so Sky only and Dashboard keep the same sky between them.
 */
(function () {
  'use strict';
  if (window.hkSkyLab) return;
  window.hkSkyLab = true;

  var STANDALONE = !!document.getElementById('skyframe');
  var KEY = 'hkSkyLab2', DASH_KEY = 'hkSkyLabDash';
  var HOLIDAY_SEASON = { halloween: 1, thanksgiving: 1, christmas: 1 };

  function store(k, v) {
    try { if (v === undefined) return JSON.parse(sessionStorage.getItem(k) || 'null'); sessionStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { return null; }
  }

  // ------------------------------------------------------------- lockdown
  // READS, NOT WRITES: what may go out is listed, and anything else is held.
  // A list of write verbs (2026-10-07 audit) let through what it had not
  // thought of -- hk_frontend/talk/live, which streams the tablet's
  // microphone to the doorbell speaker, backup/generate, conversation/process.
  // A read missing here only shows as a "was not sent" toast, the safe way
  // round for a preview.
  var READS = { ping: 1, get_states: 1, get_config: 1, get_services: 1, get_panels: 1,
    subscribe_events: 1, unsubscribe_events: 1, subscribe_entities: 1, render_template: 1,
    supported_features: 1, 'auth/current_user': 1, 'auth/sign_path': 1,
    'lovelace/config': 1, 'lovelace/resources': 1, 'lovelace/info': 1,
    'manifest/list': 1, 'manifest/get': 1, 'entity/source': 1, 'search/related': 1, 'extract_from_target': 1,
    'camera/stream': 1, 'camera/capabilities': 1, 'camera/webrtc/offer': 1, 'camera/webrtc/candidate': 1,
    'media_player/browse_media': 1, 'media_player/search_media': 1,
    'media_source/browse_media': 1, 'media_source/resolve_media': 1,
    'history/history_during_period': 1, 'history/stream': 1, 'logbook/event_stream': 1,
    'recorder/statistics_during_period': 1, 'recorder/get_statistics_metadata': 1,
    'weather/subscribe_forecast': 1, 'todo/item/subscribe': 1, 'energy/info': 1,
    'energy/fossil_energy_consumption': 1, 'repairs/list_issues': 1,
    'sensor/numeric_device_classes': 1, 'hk_frontend/art/sign': 1, 'hk_tv/channels': 1 };
  // ...and any `<domain>/.../<verb>` whose last word only reads
  // (frontend/get_themes, config/area_registry/list, hk_music/subscribe)
  var READ_VERB = /^(get|list|subscribe|check|info|get_[a-z_]+|list_[a-z_]+|subscribe_[a-z_]+)$/;
  function isRead(type) {
    type = String(type || '');
    if (READS[type]) return true;
    return type.indexOf('/') > 0 && READ_VERB.test(type.split('/').pop());
  }
  function isWrite(type) { return !isRead(type); }
  window.hkSkyLab = { _: { isRead: isRead } };   // for tests/test_skylab.js
  var locked = false;
  function lockDown() {
    if (locked) return true;
    var ha = document.querySelector('home-assistant');
    var conn = ha && ha.hass && ha.hass.connection;
    if (!conn) return false;
    var send = conn.sendMessage.bind(conn), sendP = conn.sendMessagePromise.bind(conn);
    conn.sendMessage = function (msg, id) {
      if (msg && isWrite(msg.type)) { heldBack(msg); return; }
      return send(msg, id);
    };
    conn.sendMessagePromise = function (msg) {
      if (msg && isWrite(msg.type)) { heldBack(msg); return Promise.resolve(null); }
      return sendP(msg);
    };
    var fetch0 = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        var url = String((input && input.url) || input);
        var m = /\/api\/services\/([^/]+)\/([^/?]+)/.exec(url);
        heldBack(m ? { domain: m[1], service: m[2] } : { type: method + ' ' + url.replace(location.origin, '') });
        return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return fetch0(input, init);
    };
    locked = true;
    return true;
  }
  function heldBack(msg) {
    toast('Preview only: ' + (msg.domain ? msg.domain + '.' + msg.service : msg.type) + ' was not sent');
  }

  // ---------------------------------------------------------------- panel
  var CSS = [
    ':host{all:initial;--panel:#0d1420e6;--line:#26324a;--text:#eaf0ff;--dim:#8fa4c8;--accent:#5ab0ff;font:15px/1.4 -apple-system,system-ui,sans-serif;color:var(--text)}',
    '#panel{position:fixed;z-index:2147483001;top:12px;right:12px;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;',
    '  background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;box-sizing:border-box;',
    '  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}',
    '#panel.min{width:auto}#panel.min .body{display:none}',
    'h1{font-size:16px;margin:0;display:flex;align-items:center;justify-content:space-between;gap:10px}',
    'h1 span{display:flex;gap:6px}',
    'h1 button{font:inherit;font-size:13px;background:#ffffff1a;color:var(--text);border:0;border-radius:8px;padding:6px 10px;cursor:pointer}',
    '.row{margin-top:12px}.row>label{display:flex;justify-content:space-between;color:var(--dim);font-size:13px;margin-bottom:4px}',
    '.row label b{color:var(--text);font-weight:600}',
    'input[type=range]{width:100%;accent-color:var(--accent)}',
    'select{width:100%;font:inherit;padding:7px 8px;border-radius:8px;background:#0b111c;color:var(--text);border:1px solid var(--line)}',
    '.seg{display:flex;gap:4px;flex-wrap:wrap}.seg button{flex:1;font:inherit;font-size:13px;padding:7px 6px;border-radius:8px;border:1px solid var(--line);',
    '  background:#0b111c;color:var(--dim);cursor:pointer;white-space:nowrap}.seg button.on{background:var(--accent);color:#04121f;border-color:var(--accent);font-weight:600}',
    '.check{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:14px}.check label{display:flex;align-items:center;gap:6px}',
    'small{display:block;color:var(--dim);font-size:12px;margin-top:5px}',
    '#info{margin-top:12px;font:12px/1.45 ui-monospace,monospace;color:var(--dim);white-space:pre-wrap;border-top:1px solid var(--line);padding-top:10px}',
    '#toast{position:fixed;z-index:2147483002;left:50%;bottom:20px;transform:translateX(-50%);background:#0d1420f0;border:1px solid var(--line);',
    '  border-radius:12px;padding:9px 14px;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;max-width:calc(100vw - 32px)}',
    '#toast.on{opacity:1}',
    '.wide{width:100%;font:inherit;font-size:14px;font-weight:600;padding:8px;border-radius:8px;border:1px solid var(--accent);',
    '  background:#0b111c;color:var(--accent);cursor:pointer}',
    '#cards{position:fixed;z-index:1;left:24px;bottom:24px;display:none;gap:12px;flex-wrap:wrap;max-width:calc(100vw - 400px)}',
    '#cards.on{display:flex}#cards div{width:170px;height:62px;border-radius:16px;background:#ffffff26;border:1px solid #ffffff2e;',
    '  -webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);padding:10px 14px;box-sizing:border-box;font-weight:600}',
    '#cards div small{margin:0;color:#ffffffb0;font-size:15px;font-weight:400}'
  ].join('\n');

  var HTML =
    '<div id=panel>' +
    ' <h1>Sky Lab <span>' + (STANDALONE ? '<button id=cardsBtn>Cards</button>' : '<button id=exitBtn>Exit</button>') +
    '  <button id=minBtn>Hide</button></span></h1>' +
    ' <div class=body>' +
    '  <div class=row><label>Show</label><div class=seg data-k=show><button data-v=sky>Sky only</button><button data-v=dash>Dashboard</button></div>' +
    (STANDALONE ? '' : '<small>Your real dashboard, preview only: taps open things, but nothing in the house switches. Exit to use it again.</small>') + '</div>' +
    (STANDALONE ? '' : '  <div class=row><label>Dashboard</label><select id=dashSel></select></div>') +
    '  <div class=row><label>Clouds</label><div class=seg data-k=style><button data-v=realistic>Realistic</button><button data-v=blend>Blend</button><button data-v=classic>Classic</button></div></div>' +
    '  <div class=row><label>Time of day <b id=timeV></b></label><input type=range id=time min=0 max=24 step=0.25 value=14></div>' +
    '  <div class=row><label>Daytime brightness <b id=briV></b></label><input type=range id=bri min=0 max=100 step=5 value=100></div>' +
    '  <div class=row><label>Cloud cover <b id=coverV></b></label><input type=range id=cover min=0 max=100 step=1 value=40></div>' +
    '  <div class=row><label>Condition</label><select id=cond>' +
    '    <option value=auto>From cloud cover</option><option value=sunny>Sunny / clear</option><option value=partlycloudy>Partly cloudy</option>' +
    '    <option value=cloudy>Cloudy</option><option value=rainy>Rain</option><option value=pouring>Pouring</option><option value=snowy>Snow</option>' +
    '    <option value=lightning-rainy>Thunderstorm</option><option value=fog>Fog</option></select></div>' +
    '  <div class=row><label>Rain / snow intensity <b id=rateV></b></label><input type=range id=rate min=0 max=100 step=1 value=40></div>' +
    '  <div class=row><label>Wind <b id=windV></b></label><input type=range id=wind min=0 max=30 step=1 value=6></div>' +
    '  <div class=row><label>Moon phase <b id=moonV></b></label><input type=range id=moon min=0 max=1 step=0.01 value=0.5></div>' +
    '  <div class=row><label>Scene</label><select id=scene>' +
    '    <option value="">Plain sky (no decorations)</option>' +
    '    <optgroup label="Woodland between occasions"><option value=land:spring>Spring</option><option value=land:summer>Summer</option>' +
    '      <option value=land:fall>Autumn</option><option value=land:winter>Winter</option></optgroup>' +
    '    <optgroup label="Holidays and occasions"><option value=halloween>Halloween</option><option value=thanksgiving>Thanksgiving</option>' +
    '      <option value=christmas>Christmas</option><option value=winter-wonderland>Winter Wonderland</option><option value=spring-garden>Spring Garden</option>' +
    '      <option value=fourth-of-july>Fourth of July</option><option value=birthday>Birthday</option></optgroup></select></div>' +
    '  <div class=row><label>Decorations</label><div class=seg data-k=deco><button data-v=new>New</button><button data-v=old>Old</button></div></div>' +
    // LIVELINESS (hk-sky.js lvOf): one preset on every occasion at once, as
    // a screen's Liveliness is -- the sky pinned, nothing saved
    '  <div class=row><label>Liveliness</label><div class=seg data-k=lively><button data-v=subtle>Subtle</button>' +
    '    <button data-v=classic>Classic</button><button data-v=festive>Festive</button><button data-v=party>Party</button></div></div>' +
    '  <div class=row><button id=nowBtn class=wide>Show Me Now</button>' +
    '    <small>The next bat, goose, witch, sleigh, flyby, shooting star or firework, across now.</small></div>' +
    '  <div class=check><label><input type=checkbox id=anim checked> Animations</label><label><input type=checkbox id=fog> Fog</label></div>' +
    '  <div id=info>Loading the sky…</div>' +
    ' </div>' +
    '</div><div id=toast></div>' +
    (STANDALONE ? '<div id=cards><div>Living Room<small>3 Lights On</small></div><div>Climate<small>72° · Cooling</small></div>' +
                  '<div>Front Door<small>Locked</small></div><div>Kitchen<small>Off</small></div></div>' : '');

  var root, $, seg = { show: STANDALONE ? 'sky' : 'dash', style: 'realistic', deco: 'new', lively: 'classic' };
  var SLIDERS = ['time', 'bri', 'cover', 'rate', 'wind', 'moon'], PICKS = ['cond', 'scene'], CHECKS = ['anim', 'fog'];

  var toastT = 0;
  function toast(msg) {
    if (!$) return;
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  function build() {
    var host = document.createElement('hk-skylab');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style>' + HTML;
    $ = function (id) { return root.getElementById(id); };
    restore();
    root.querySelectorAll('.seg').forEach(function (g) {
      g.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', seg[g.dataset.k] === b.dataset.v); });
      g.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (g.dataset.k === 'show') return go(b.dataset.v);
        g.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        seg[g.dataset.k] = b.dataset.v; changed();
      });
    });
    SLIDERS.forEach(function (id) { $(id).addEventListener('input', changed); });
    PICKS.concat(CHECKS).forEach(function (id) { $(id).addEventListener('change', changed); });
    $('minBtn').onclick = function () {
      var p = $('panel'); p.classList.toggle('min'); $('minBtn').textContent = p.classList.contains('min') ? 'Show' : 'Hide';
    };
    $('nowBtn').onclick = function () {
      var n = window.hkSky && window.hkSky.showNow ? window.hkSky.showNow() : 0;
      toast(n ? 'Across now: ' + n + (n === 1 ? ' crossing' : ' crossings') : 'Nothing crosses in this scene right now');
    };
    if (STANDALONE) $('cardsBtn').onclick = function () { $('cards').classList.toggle('on'); };
    else {
      // leaving: the page again without ?skylab -- a full load, so the
      // lockdown and the pinned sky go with it
      $('exitBtn').onclick = function () { location.replace(location.pathname); };
      fillDashboards();
      $('dashSel').addEventListener('change', function () {
        var path = $('dashSel').value;
        store(DASH_KEY, path);
        history.pushState(null, '', '/' + path);
        window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
      });
    }
  }

  // Sky only <-> Dashboard: a page each, the panel's settings carried over
  function go(where) {
    if (where === seg.show) return;
    save();
    if (where === 'sky') location.href = '/hk/pages/skylab.html';
    else location.href = '/' + (store(DASH_KEY) || 'dashboard-livingroom') + '?skylab';
  }
  function save() {
    var v = { style: seg.style, deco: seg.deco, lively: seg.lively };
    SLIDERS.concat(PICKS).forEach(function (id) { v[id] = $(id).value; });
    CHECKS.forEach(function (id) { v[id] = $(id).checked; });
    store(KEY, v);
  }
  function restore() {
    var v = store(KEY); if (!v) return;
    if (v.style) seg.style = v.style;
    if (v.deco) seg.deco = v.deco;
    if (v.lively) seg.lively = v.lively;
    SLIDERS.concat(PICKS).forEach(function (id) { if (v[id] !== undefined) $(id).value = v[id]; });
    CHECKS.forEach(function (id) { if (v[id] !== undefined) $(id).checked = v[id]; });
  }
  function fillDashboards() {
    var ha = document.querySelector('home-assistant'), panels = (ha && ha.hass && ha.hass.panels) || {};
    var list = Object.keys(panels).map(function (k) { return panels[k]; })
      .filter(function (p) { return p.component_name === 'lovelace' && p.url_path !== 'lovelace'; })
      .sort(function (a, b) { return String(a.title || a.url_path).localeCompare(String(b.title || b.url_path)); });
    var sel = $('dashSel');
    list.forEach(function (p) {
      var o = document.createElement('option'); o.value = p.url_path; o.textContent = p.title || p.url_path; sel.appendChild(o);
    });
    sel.value = location.pathname.split('/')[1];
  }

  // --------------------------------------------------------------- the sky
  // the sun, by the hour: up at 7, down at 19, 55° at noon; deep night after
  function sunAt(h) {
    var day = (h - 7) / 12;
    if (day >= 0 && day <= 1) return { elev: 55 * Math.sin(Math.PI * day), azim: 90 + 180 * day };
    var t = h < 7 ? (7 - h) / 7 : (h - 19) / 5;
    return { elev: -Math.min(40, 40 * Math.sin(Math.PI / 2 * Math.min(1, t)) + 0.5), azim: h < 7 ? 80 : 280 };
  }
  function clock(h) {
    var hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
    return (hh % 12 || 12) + ':' + (mm < 10 ? '0' : '') + mm + (hh < 12 ? ' AM' : ' PM');
  }
  function state() {
    var h = +$('time').value, sun = sunAt(h), cover = +$('cover').value / 100, cond = $('cond').value;
    if (cond === 'auto') cond = cover < 0.1 ? (sun.elev > 0 ? 'sunny' : 'clear-night') : cover < 0.7 ? 'partlycloudy' : 'cloudy';
    var rate = +$('rate').value / 100;
    var wet = /rain|pouring|lightning/.test(cond) ? { kind: 'rain', rate: cond === 'pouring' ? Math.max(rate, 0.8) : rate, bolt: /lightning/.test(cond) }
            : cond === 'snowy' ? { kind: 'snow', rate: rate } : { kind: 'none', rate: 0 };
    var scene = $('scene').value, land = scene.indexOf('land:') === 0 ? scene.slice(5) : '';
    var holiday = scene && !land ? scene : '', m = +$('moon').value;
    $('timeV').textContent = clock(h) + ' · sun ' + sun.elev.toFixed(0) + '°';
    $('coverV').textContent = Math.round(cover * 100) + '%';
    $('rateV').textContent = wet.kind === 'none' ? '—' : Math.round(wet.rate * 100) + '%';
    $('briV').textContent = $('bri').value + '%' + (+$('bri').value === 100 ? ' (dashboards)' : +$('bri').value ? '' : ' (the old deep sky)');
    $('windV').textContent = $('wind').value + ' mph';
    $('moonV').textContent = m < 0.03 || m > 0.97 ? 'new' : Math.abs(m - 0.5) < 0.03 ? 'full'
      : m < 0.5 ? 'waxing ' + Math.round(m * 200) + '%' : 'waning ' + Math.round((1 - m) * 200) + '%';
    return {
      scene: scene, holiday: holiday, when: sun.elev > -4 ? 'day' : 'night',
      sky: {
        elev: sun.elev, azim: sun.azim, cover: cover, wind: +$('wind').value, cond: cond,
        fog: $('fog').checked || cond === 'fog', wet: wet, moon: m, animations: $('anim').checked,
        weather: true, decorations: !!scene, seasonalOn: !!scene, decorationStyle: seg.deco,
        season: HOLIDAY_SEASON[holiday] ? holiday : '', land: land || undefined,
        cloudStyle: seg.style, backdrop: null, brightness: +$('bri').value / 100,
        lively: { all: seg.lively }
      }
    };
  }

  var themeKey = null;
  function changed() { save(); apply(); }
  function apply() {
    var hs = window.hkSky; if (!$ || !hs) return;
    var st = state();
    // the theme (a holiday's FORCE, a surprise's) only when it changes:
    // preview() paints a clear sky of its own on the way
    var key = st.holiday + '|' + st.when;
    if (key !== themeKey) { themeKey = key; try { hs.preview(st.holiday || null, st.when); } catch (e) { /* older module */ } }
    if (STANDALONE) window.hkSkyAt(st.sky.elev, st.sky);
    else hs._pin(st.sky);
    var sky = hs._mounted && hs._mounted(), rc = sky && sky.querySelector('.rcl'), r = rc && rc._rc;
    var sets = r && r.plan ? r.plan.sets.reduce(function (a, x) { a[x] = (a[x] || 0) + 1; return a; }, {}) : null;
    $('info').textContent = (STANDALONE ? '' : 'dashboard  ' + location.pathname + ' (preview only)\n') +
      'condition  ' + st.sky.cond + (st.sky.wet.kind !== 'none' ? ' (' + st.sky.wet.kind + ')' : '') +
      '\nclouds     ' + (seg.style === 'classic' ? 'classic decks' : (seg.style === 'blend' ? 'classic veil + ' : '') +
        (r ? (r.deck ? 'overcast deck + ' : '') + r.clouds.length + ' clouds, ' + r.light + ' light' : 'loading…')) +
      (sets ? '\n           ' + Object.keys(sets).map(function (k) { return sets[k] + ' ' + k; }).join(', ') : '') +
      '\nluminance  ' + (sky ? sky._hkRaw + ' → ' + sky._hkL + (sky._hkRaw > sky._hkL ? ' (dimmed for the cards)' : '') : '—') +
      '\nscene      ' + (sky && sky._hkNearTheme ? 'woodland: ' + sky._hkNearTheme : st.scene ? st.scene + ' (' + seg.deco + ')' : 'plain sky');
  }

  // ----------------------------------------------------------------- start
  function startStandalone() {
    build();
    window.hkSky.render({ states: {} }, document.getElementById('card'));
    apply();
    // the sky's own tick has no Home Assistant here; hold the chosen weather
    // (the realistic clouds' manifest arrives after the first paint, too)
    setInterval(apply, 3000);
    setTimeout(apply, 700);
  }
  function startDashboard() {
    // the page is covered -- nothing on it can be tapped -- until this
    // window's connection is locked down
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#0d1420;color:#8fa4c8;' +
      'display:flex;align-items:center;justify-content:center;font:15px -apple-system,system-ui,sans-serif';
    host.textContent = 'Sky Lab: starting the preview…';
    (document.body || document.documentElement).appendChild(host);
    var tries = 0;
    var t = setInterval(function () {
      if (!document.body || !lockDown()) {
        if (++tries >= 300) {
          clearInterval(t);
          host.textContent = 'Sky Lab could not start: Home Assistant did not connect. Reload to try again.';
        }
        return;
      }
      clearInterval(t);
      host.remove();
      build();
      // the sky mounts with the view; pin it as soon as it is there, and the
      // pin holds it across the 3 s tick and every page change after
      var n = 0, w = setInterval(function () {
        if (window.hkSky && window.hkSky._mounted && window.hkSky._mounted()) { clearInterval(w); apply(); }
        else if (++n > 150) { clearInterval(w); $('info').textContent = 'This dashboard has no live sky.'; }
      }, 100);
      setTimeout(apply, 1500);
    }, 50);
  }

  if (STANDALONE) {
    // skylab.html loads hk-sky.js first
    if (window.hkSky) startStandalone();
    else document.body.textContent = 'The sky did not load.';
  } else {
    startDashboard();
  }
})();
