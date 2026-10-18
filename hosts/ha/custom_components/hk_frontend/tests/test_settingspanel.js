// Phase 1 slice 11: THE HK SETTINGS PANEL READS A CLIENT AND SAVES THROUGH
// THE ACTION PORT (panels/hk-settings.js).
//
// Home Assistant's panel_custom hands the panel the frontend's object; the
// host adapter's entry turns it into a client, and the page reads that.
// Every save -- a settings change, a feature's command, a dashboard made,
// renamed or deleted, a config flow, a photo uploaded or forgotten, a
// tablet's command, the Setup Assistant's "done" -- goes through
// `client.actions`. In Home Assistant that is the very call the old code made
// (same message, same receiver; the same request path and init); a host that
// cannot act (Mantel) refuses it and nothing is sent.
//
// Every "host" here is a recorder over fictional entities. Nothing is sent
// anywhere.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run settingspanel');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/panels/hk-settings-features.js');
// the page as it is, with its modules already in hand (it imports them before
// it draws) and a photo taken as it is (shrinking one needs a canvas)
var SRC = read(HK_ROOT + '/frontend/panels/hk-settings.js');
(0, eval)(SRC.replace('  var M = null, K = null, h = null, F = null;',
  '  var M = window.hkSettingsModel, K = window.hkSettingsKit, h = K.h, F = window.hkSettingsFeatures; F.use(K);')
  .replace('var blob = await shrinkPhoto(file, 2560);', 'var blob = file;'));
if (typeof FormData === 'undefined') {
  globalThis.FormData = function () { this.parts = []; };
  FormData.prototype.append = function (k, v, name) { this.parts.push([k, v, name]); };
}

var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
function drain() { for (var i = 0; i < 12; i++) drainMicrotasks(); }
var P = customElements.get('hk-settings-panel').prototype;
var STATES = { 'light.porch': { entity_id: 'light.porch', state: 'off', attributes: { friendly_name: 'Porch' } } };

// A FRONTEND OBJECT THAT RECORDS EVERYTHING: each callWS message, each
// fetchWithAuth path and init, each subscription, and the receiver of each.
function recorder(answers) {
  answers = answers || {};
  var rec = { ws: [], fetched: [], subs: [], receivers: [] };
  rec.hass = {
    states: STATES, entities: {}, devices: {}, areas: { kitchen: { name: 'Kitchen' } }, config: {},
    themes: { darkMode: true }, user: { name: 'Admin', is_admin: true },
    callWS: function (msg) {
      rec.receivers.push(this); rec.ws.push(msg);
      var a = answers[msg.type];
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a === undefined ? { ok: true } : a);
    },
    fetchWithAuth: function (path, init) {
      rec.receivers.push(this); rec.fetched.push([path, init]);
      var a = answers.fetch ? answers.fetch(path, init) : response(200, 'application/json', { ok: true });
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    },
    callService: function () { throw new Error('no service call is expected here'); },
    connection: { subscribeMessage: function (cb, msg) { rec.subs.push(msg); return Promise.resolve(function () {}); } }
  };
  return rec;
}
function response(status, type, body) {
  return { ok: status >= 200 && status < 300, status: status,
           headers: { get: function (k) { return String(k).toLowerCase() === 'content-type' ? type : null; } },
           json: function () { return body instanceof Error ? Promise.reject(body) : Promise.resolve(body); },
           text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); } };
}
// A page with its drawing stubbed out, shown a client the way the entry gives
// one: `client` read off the element.
function page(client) {
  var pg = Object.create(P);
  Object.defineProperty(pg, 'client', { value: client });
  pg.errors = {}; pg.data = { entry_id: 'entry1', dashboards: [], settings: { sky: {} }, boards: {} };
  pg.said = []; pg.statuses = [];
  pg.render = function () {}; pg.soon = function () {};
  pg.status = function (s) { pg.statuses.push(s); };
  pg.announce = function (t) { pg.said.push(t); };
  pg.reload = function () { return Promise.resolve(); };
  // a feature's settings as already read (a save does not read them again)
  pg.feats = {}; pg.feat = function (d) { return pg.feats[d] || (pg.feats[d] = {}); };
  return pg;
}
// THE MANTEL HOST'S CONTRACT: reads, no action transport, a `refused` hook.
function mantel() {
  var m = { refused: [], reached: [] };
  m.client = window.hkClient.create({
    states: STATES, entities: {}, devices: {}, areas: {},
    callWS: function (msg) { m.reached.push(msg); return Promise.resolve({}); },
    refused: function (d) { m.refused.push(d.kind + ' ' + d.what); }
  });
  return m;
}

print('=== the entry: Home Assistant hands the frontend\'s object, the page reads a client ===');
(function () {
  var rec = recorder(), pg = Object.create(P), booted = 0;
  pg.boot = function () { booted++; };
  pg.attrs = {};
  pg.hasAttribute = HTMLElement.prototype.hasAttribute; pg.toggleAttribute = HTMLElement.prototype.toggleAttribute;
  var menu = {};
  pg.hass = rec.hass;
  ok('the page reads the host adapter\'s client for that object', pg.client === window.hkHostClient.from(rec.hass), true);
  ok('...a client, not the object', window.hkClient.is(pg.client), true);
  ok('...and the host gets its object back from the element', pg.hass === rec.hass, true);
  ok('the first one starts the page, once', booted, 1);
  ok('light/dark follows the client\'s themes', pg.hasAttribute('dark'), true);
  pg._menuBtn = menu;
  var next = Object.assign({}, rec.hass, { themes: { darkMode: false } });
  pg.hass = next;
  ok('a new object: a new client, the page not started again', [pg.client === window.hkHostClient.from(next), booted], [true, 1]);
  ok('...dark follows', pg.hasAttribute('dark'), false);
  ok('HA\'s own menu button is handed the frontend\'s object by the adapter', menu.hass === next, true);
  ok('the panel no longer defines its own hass accessor (the adapter\'s entry does)',
     /set hass\(|get hass\(/.test(SRC), false);
})();

print('\n=== reads go over the client\'s read path ===');
(function () {
  var rec = recorder({ 'hk_frontend/panel/get': { entry_id: 'e' } }), pg = page(window.hkHostClient.from(rec.hass));
  pg.reload = P.reload;
  pg.reload(); drain();
  ok('panel/get reaches the frontend\'s callWS, same receiver', [rec.ws[0], rec.receivers[0] === rec.hass], [{ type: 'hk_frontend/panel/get' }, true]);
  ok('...and is the page\'s data', pg.data, { entry_id: 'e' });
  P.featLoad.call(Object.assign(pg, { feats: { hk_music: {} } }), 'hk_music', true); drain();
  ok('a feature\'s settings/get, the same message as before', rec.ws[1], { type: 'hk_music/settings/get', fresh: true });
  ok('a read on Mantel is answered by its host', (function () {
    var m = mantel(), mp = page(m.client); mp.reload = P.reload; mp.reload(); drain(); return m.reached;
  })(), [{ type: 'hk_frontend/panel/get' }]);
})();

print('\n=== the settings feed goes through the client\'s subscription port ===');
(function () {
  var rec = recorder(), pg = page(window.hkHostClient.from(rec.hass));
  Object.defineProperty(pg, 'isConnected', { value: true });
  P.subscribe.call(pg); drain();
  ok('hk_frontend/settings/subscribe reaches the frontend\'s connection', rec.subs, [{ type: 'hk_frontend/settings/subscribe' }]);
  ok('...and its unsubscribe is kept', typeof pg._unsub, 'function');
  ok('the type is on the port\'s read allowlist', window.hkClient.subscribable({ type: 'hk_frontend/settings/subscribe' }), true);
  var bare = page(window.hkClient.create({ states: {} }));
  P.subscribe.call(bare);
  ok('a client with no socket subscribes to nothing', [bare._subbing, bare._unsub], [undefined, undefined]);
})();

print('\n=== every save goes through the action port (Home Assistant: the same call) ===');
(function () {
  var rec = recorder({ 'lovelace/dashboards/list': [{ url_path: 'hk-old', id: 'd9' }] });
  var client = window.hkHostClient.from(rec.hass), pg = page(client);
  var before = rec.ws.length;
  P.setH.call(pg, { 'look.glass': 'clear' }); drain();
  P.featCall.call(pg, 'hk_music', { type: 'hk_music/item/remove', item: 'p1' }, ['item']); drain();
  P.ws.call(pg, { type: 'hk_notify/test', item: 'n1' }); drain();
  P.ws.call(pg, { type: 'hk_frontend/tablet/remove', tablet: 't1' }); drain();
  var sent = rec.ws.slice(before);
  ok('settings/set, a feature\'s command, ws(): each message reaches the frontend\'s callWS', sent.map(function (m) { return m.type; }),
     ['hk_frontend/settings/set', 'hk_music/item/remove', 'hk_notify/test', 'hk_frontend/tablet/remove']);
  ok('...unchanged', sent[1], { type: 'hk_music/item/remove', item: 'p1' });
  ok('...on the frontend\'s own object', rec.receivers.every(function (r) { return r === rec.hass; }), true);
  ok('...and the page says Saved', pg.statuses.filter(function (s) { return s === 'saved'; }).length, 4);
  // a dashboard renamed, then deleted
  rec.ws.length = 0;
  P.renameScreen.call(Object.assign(pg, { _renameBusy: false }), { id: 'd1', path: 'hk-kitchen', title: 'Kitchen' }, 'Galley'); drain();
  ok('a screen renamed: lovelace/dashboards/update, then dashboard/titled', rec.ws,
     [{ type: 'lovelace/dashboards/update', dashboard_id: 'd1', title: 'Galley' }, { type: 'hk_frontend/dashboard/titled', dashboard: 'hk-kitchen' }]);
  rec.ws.length = 0;
  pg.pageEl = { querySelector: function () { return null; } };
  P.deleteScreen.call(pg, { item: 'sub1', path: 'hk-old', title: 'Old' }); drain();
  ok('a screen deleted: its item, the dashboards read, the dashboard', rec.ws,
     [{ type: 'config_entries/subentries/delete', entry_id: 'entry1', subentry_id: 'sub1' }, { type: 'lovelace/dashboards/list' },
      { type: 'lovelace/dashboards/delete', dashboard_id: 'd9' }]);
  // a photo forgotten, a tablet woken, the Setup Assistant done
  rec.ws.length = 0;
  P.photoForget.call(pg, '/api/image/serve/0123456789abcdef0123456789abcdef/original'); drain();
  ok('a photo no longer used leaves the image store: image/delete', rec.ws, [{ type: 'image/delete', image_id: '0123456789abcdef0123456789abcdef' }]);
})();

print('\n=== a write the read path would refuse never goes there ===');
(function () {
  var rec = recorder(), client = window.hkHostClient.from(rec.hass), pg = page(client);
  // every listed write type the panel sends is refused on the read path...
  ['lovelace/dashboards/create', 'lovelace/config/save', 'image/delete', 'config_entries/subentries/delete', 'input_select/create']
    .forEach(function (t) { ok(t + ' is a write (the read path refuses it)', window.hkClient.isWrite({ type: t }), true); });
  // ...and a screen made sends them, through the port
  var flows = [];
  rec.hass.fetchWithAuth = function (path, init) {
    flows.push([path, init.method, init.body ? JSON.parse(init.body) : null]);
    var n = flows.length;
    return Promise.resolve(response(200, 'application/json; charset=utf-8',
      n === 1 ? { flow_id: 'f1', step_id: 'dashboard' } : n === 2 ? { flow_id: 'f1', step_id: 'kind' } : { type: 'create_entry' }));
  };
  pg.data.dashboards = [];
  var made = null, err = null;
  P.createScreen.call(pg, 'Den', 'tablet', false).then(function (p) { made = p; }, function (e) { err = e; }); drain();
  ok('a screen made: the dashboard, its strategy, then its item\'s flow', [made, err], ['hk-den', null]);
  ok('...the dashboard and its strategy over the port', rec.ws.map(function (m) { return m.type; }), ['lovelace/dashboards/create', 'lovelace/config/save']);
  ok('...the flow\'s steps as callApi made them: /api/ and the body', flows, [
    ['/api/config/config_entries/subentries/flow', 'POST', { handler: ['entry1', 'dashboard'] }],
    ['/api/config/config_entries/subentries/flow/f1', 'POST', { dashboard: 'hk-den' }],
    ['/api/config/config_entries/subentries/flow/f1', 'POST', { kind: 'tablet' }]]);
})();

print('\n=== a config flow\'s HTTP write: exactly the frontend\'s callApi, through actions.request ===');
(function () {
  var seen = [];
  var act = { request: function (path, init) { seen.push([path, init]); return Promise.resolve(response(200, 'application/json', { flow_id: 'x' })); } };
  var pg = page({ actions: act });
  var got = null;
  P.rest.call(pg, 'POST', 'config/config_entries/subentries/flow', { handler: ['e', 'popup'] }).then(function (r) { got = r; }); drain();
  ok('the path under /api/', seen[0][0], '/api/config/config_entries/subentries/flow');
  ok('the init: method, JSON type, the body as JSON', seen[0][1],
     { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body: '{"handler":["e","popup"]}' });
  ok('a JSON answer is its body', got, { flow_id: 'x' });
  seen.length = 0;
  P.rest.call(pg, 'DELETE', 'config/config_entries/subentries/flow/x'); drain();
  ok('no body: no type, no body (an abandon)', seen[0][1], { method: 'DELETE', headers: {} });
  ok('{} is a body (a step submitted empty)', (function () { seen.length = 0; P.rest.call(pg, 'POST', 'p', {}); drain(); return seen[0][1].body; })(), '{}');
  // the answers callApi gives
  var thrown = null;
  act.request = function () { return Promise.resolve(response(400, 'application/json', { message: 'Invalid handler' })); };
  P.rest.call(pg, 'POST', 'p', { a: 1 }).catch(function (e) { thrown = e; }); drain();
  ok('an error answer is thrown as callApi throws it', thrown, { error: 'Response error: 400', status_code: 400, body: { message: 'Invalid handler' } });
  act.request = function () { return Promise.resolve(response(200, 'text/plain', 'fine')); };
  got = null; P.rest.call(pg, 'DELETE', 'p').then(function (r) { got = r; }); drain();
  ok('a text answer is its text', got, 'fine');
  act.request = function () { return Promise.resolve(response(200, 'application/json', new Error('bad json'))); };
  thrown = null; P.rest.call(pg, 'POST', 'p', {}).catch(function (e) { thrown = e; }); drain();
  ok('a body that won\'t parse', thrown && [thrown.error, thrown.body], ['Unable to parse JSON response', null]);
  act.request = function () { return Promise.reject(new TypeError('Failed to fetch')); };
  thrown = null; P.rest.call(pg, 'POST', 'p', {}).catch(function (e) { thrown = e; }); drain();
  ok('a request that never arrived', thrown, { error: 'Request error' });
})();

print('\n=== a photo uploaded: the same authenticated POST, through actions.request ===');
(function () {
  var rec = recorder({ fetch: function () { return response(200, 'application/json', { id: '0123456789abcdef0123456789abcdef' }); } });
  var pg = page(window.hkHostClient.from(rec.hass)), url = null;
  P.photoUpload.call(pg, { name: 'p.jpg' }, 'sky').then(function (u) { url = u; }); drain();
  ok('POST /api/image/upload on the frontend\'s fetchWithAuth', [rec.fetched[0][0], rec.fetched[0][1].method], ['/api/image/upload', 'POST']);
  ok('...its form carries the photo as before', rec.fetched[0][1].body.parts[0][0] + ' ' + rec.fetched[0][1].body.parts[0][2], 'file hk-background.jpg');
  ok('...and the page gets its address', url, '/api/image/serve/0123456789abcdef0123456789abcdef/original');
})();

print('\n=== Mantel: every save is refused at the port, nothing sent ===');
(function () {
  var m = mantel(), pg = page(m.client);
  P.setH.call(pg, { 'look.glass': 'clear' }); drain();
  P.featCall.call(pg, 'hk_notify', { type: 'hk_notify/item/remove', item: 'n1' }); drain();
  P.photoForget.call(pg, '/api/image/serve/0123456789abcdef0123456789abcdef/original'); drain();
  var flowErr = null;
  P.rest.call(pg, 'POST', 'config/config_entries/subentries/flow', { handler: ['e', 'page'] }).catch(function (e) { flowErr = e; }); drain();
  var upl = 'pending';
  P.photoUpload.call(pg, { name: 'p.jpg' }, 'sky').then(function (u) { upl = u; }); drain();
  ok('nothing reached the host', m.reached, []);
  ok('each one refused once, by kind', m.refused, ['ws hk_frontend/settings/set', 'ws hk_notify/item/remove', 'ws image/delete',
     'http POST /api/config/config_entries/subentries/flow', 'http POST /api/image/upload']);
  ok('a refused save says it couldn\'t, as an error does', pg.statuses.filter(function (s) { return s === 'error'; }).length, 2);
  ok('a refused flow passes the refusal on as it is', flowErr && flowErr.code, 'commands_disabled');
  ok('a refused upload is no photo', upl, null);
})();

print(fail ? 'FAIL ' + fail + ' SETTINGS PANEL TESTS' : 'ALL ' + pass + ' SETTINGS PANEL TESTS PASS');
