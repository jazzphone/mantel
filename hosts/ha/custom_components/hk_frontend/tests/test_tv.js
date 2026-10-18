// Live TV on the dashboards: hk-tv-guide-card, its full-screen player, the
// camera card's fill/tuning modes and hk-idle holds. WebRTC and real channels
// need a browser and a tuner; this holds the decisions that are easy to undo
// by accident.
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
var src = readFile(HK_ROOT + '/frontend/cards/hk-cameras.js');
var card = src.slice(src.indexOf('class HkTvGuideCard'), src.indexOf('function tvPlayer'));
var player = src.slice(src.indexOf('function tvPlayer'), src.indexOf("register('hk-tv-guide-card'"));
var cam = src.slice(src.indexOf('class HkDoorbellCard'), src.indexOf("register('hk-doorbell-card'"));

print('=== the channels come from the integration ===');
ok('registered and in the picker', !!customElements.get('hk-tv-guide-card') &&
   (window.customCards || []).some(function (c) { return c.type === 'hk-tv-guide-card'; }));
ok('asks hk_tv/channels (the integration), not its own config', /callWS\(\{ type: 'hk_tv\/channels' \}\)/.test(card) && !/_config\.channels/.test(card));
ok('says what to do when Live TV is missing or empty',
   /(Set up|Add) [^'"]*Live TV[^'"]*to show channels/.test(card) && /Add some [^'"]*Live TV/.test(card));
ok('wakes on every now-playing sensor', /c\.now && h\.states\[c\.now\]/.test(card) && /st\.last_updated/.test(card));
ok('artwork and logos go through _artImage (HA fetches them; a tablet may have no internet)',
   /this\._artImage\(a\.image, pic,/.test(card) && /this\._artImage\(a\.logo, lg,/.test(card));
ok('tiles are glass surfaces (M.glass), and every class is tv- (BASE_CSS owns .tile)', /'\.tv-tile\{' \+ M\.glass/.test(card) && !/'\.tile[{ ]/.test(card));
ok('progress moves on a timer without re-rendering', /setInterval\(function \(\) \{ self\._tick\(\); \}, 30000\)/.test(card));
ok('leaving the page closes the player', /disconnectedCallback\(\) \{[\s\S]{0,400}this\._player\.close\(\)/.test(card));

// THE LIST IS ASKED FOR AGAIN WHEN IT CAN BE WRONG. Asked once per card, a
// screen that draws the page while HA is restarting would say Live TV is not
// set up until it is reloaded. Driven through the real card; the tiles are
// stubbed, the list is the point.
print('\n=== the channel list, asked for again (driven) ===');
var G = customElements.get('hk-tv-guide-card');
var NBC = { number: '4.1', name: 'NBC', camera: 'camera.tv_nbc', now: 'sensor.tv_nbc_now' };
var BACKOFF = [5000, 15000, 60000, 300000];
function looks() { return __timers.filter(function (t) { return t && BACKOFF.indexOf(t.ms) >= 0; }); }
function conn() {
  return { l: {}, addEventListener: function (t, f) { (this.l[t] = this.l[t] || []).push(f); },
           removeEventListener: function (t, f) { this.l[t] = (this.l[t] || []).filter(function (x) { return x !== f; }); },
           fire: function (t) { (this.l[t] || []).forEach(function (f) { f(); }); } };
}
function guide(answers, calls, cn, states) {
  var g = new G();
  g._tile = function () { return document.createElement('button'); };
  g.isConnected = true;
  g.setConfig({});
  g.push = function () {
    g.hass = { states: states || {}, connection: cn, callWS: function (m) {
      calls.push(m.type);
      if (m.type !== 'hk_tv/channels') return Promise.resolve({});
      var a = answers.shift();
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    } };
    drainMicrotasks();
  };
  return g;
}
(function () {
  var answers = [], calls = [], cn = conn(), n = function () { return calls.filter(function (t) { return t === 'hk_tv/channels'; }).length; };
  __resetTimers();
  var g = guide(answers, calls, cn);
  answers.push({ configured: false, channels: [] });       // HA restarting: Live TV not set up yet
  g.push();
  ok('the first paint asks once, and shows "not configured"', n() === 1 && g._channels.length === 0 && g._configured === false);
  ok('...and schedules ONE look-again, 5 s out (not a loop)', looks().length === 1 && looks()[0].ms === 5000, looks().map(function (t) { return t.ms; }));
  g.push(); g.push(); g.push();
  ok('hass pushes do not ask again', n() === 1, n());
  answers.push(new Error('unknown command'));
  var t = looks()[0]; __resetTimers(); t.fn(); drainMicrotasks();
  ok('a refused call backs off further (15 s)', n() === 2 && looks().length === 1 && looks()[0].ms === 15000, looks().map(function (x) { return x.ms; }));
  answers.push({ configured: true, channels: [NBC] });
  t = looks()[0]; __resetTimers(); t.fn(); drainMicrotasks();
  ok('the channels arrive: drawn, and no more look-agains', n() === 3 && g._channels.length === 1 && looks().length === 0);
  var built = 0, tile0 = g._tile;
  g._tile = function () { built++; return tile0.apply(this, arguments); };
  g.push(); g.push();
  ok('...and the pushes after the list arrived do not draw it all again', built === 0, built);
  g._tile = tile0;
  answers.push({ configured: false, channels: [] });       // HA restarts again
  cn.fire('ready'); drainMicrotasks();
  ok('the socket coming back (`ready`) asks again', n() === 4, n());
  ok('...and an empty answer then keeps the drawn list, and looks again in 5 s',
     g._channels.length === 1 && looks().length === 1 && looks()[0].ms === 5000);
  g.isConnected = false; g.disconnectedCallback();
  // the card's OWN listener: hk-base.js keeps one per connection for the page's
  // life (the art cache and the stale-state mark), which is not the card's
  ok('leaving the page drops the look-again and the `ready` listener',
     looks().length === 0 && (cn.l.ready || []).indexOf(g._onReady) < 0 && (cn.l.ready || []).length <= 1);
})();
(function () {
  var answers = [], calls = [], seen = [];
  __resetTimers();
  var g = guide(answers, calls, conn());
  for (var i = 0; i < 6; i++) answers.push({ configured: true, channels: [] });
  g.push();
  for (var k = 0; k < 5; k++) {
    var t = looks()[0];
    seen.push(t.ms);
    __resetTimers(); t.fn(); drainMicrotasks();
  }
  ok('an empty list backs off 5 s, 15 s, 1 min, then every 5 min -- bounded', seen.join() === '5000,15000,60000,300000,300000', seen);
  g.isConnected = false; g.disconnectedCallback();
})();

// Every hass push (~10 a second) reached the caption, and an identical
// textContent still replaces the text node -- a relayout over playing video.
print('\n=== the player caption writes only what changed (driven) ===');
(function () {
  var El = document.createElement('div').constructor.prototype;
  var saved = { qs: document.querySelector, body: document.body, ins: El.insertBefore };
  document.querySelector = function () { return null; };
  document.body = document.createElement('body');
  El.insertBefore = El.insertBefore || function (nu, ref) {
    var i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(nu); else this.children.splice(i, 0, nu);
    nu.parentNode = this;
    return nu;
  };
  __resetTimers();
  var answers = [{ configured: true, channels: [NBC] }], calls = [];
  var news = { 'sensor.tv_nbc_now': { state: 'News', last_updated: 't1' } };
  var g = guide(answers, calls, undefined, news);
  g.push();
  g._open(NBC);
  var el = document.body.children[document.body.children.length - 1];
  var cap = el.querySelector('.cap'), writes = 0, text = cap.textContent;
  Object.defineProperty(cap, 'textContent', { get: function () { return text; },
                                               set: function (v) { writes++; text = String(v); } });
  ok('(the caption names the channel and what is on)', text === 'NBC · News', text);
  for (var i = 0; i < 10; i++) g.push();
  ok('ten hass pushes with nothing new write the caption zero times', writes === 0, writes);
  g._player.update({ states: { 'sensor.tv_nbc_now': { state: 'Weather', last_updated: 't2' } } });
  ok('a new programme is written once', writes === 1 && text === 'NBC · Weather', [writes, text]);
  g._player.close();
  document.querySelector = saved.qs;
  document.body = saved.body;
  if (!saved.ins) delete El.insertBefore;
})();

print('\n=== the player ===');
ok('plays the channel camera full screen with a tuning message',
   /type: 'custom:hk-doorbell-card', entity: ch\.camera, fill: true,\s*tuning: ch\.name/.test(player));
ok('mounted in home-assistant\'s shadow root, over everything', /mount = \(ha && ha\.shadowRoot\) \|\| document\.body/.test(player) && /z-index:8/.test(player));
ok('names this screen as a viewer now and every 60 s', /watching\(true\);\n\s*beatT = setInterval\(function \(\) \{ watching\(true\); \}, TV_HEARTBEAT_MS\)/.test(player) && /TV_HEARTBEAT_MS = 60000/.test(src));
ok('holds hk-idle while open and releases it on close',
   /hkIdle\.hold\('hk-tv', true\)/.test(player) && /hkIdle\.hold\('hk-tv', false\)/.test(player));
ok('close: removes the sheet (drops the stream) and says it stopped watching',
   /el\.parentNode\.removeChild\(el\);[^\n]*\n\s*watching\(false\)/.test(player));
ok('X and Escape both close', /\.x'\)\.addEventListener\('click'/.test(player) && /e\.key === 'Escape'/.test(player));
ok('the controls fade and come back on a touch', /quiet/.test(player) && /addEventListener\('pointerdown', wake, true\)/.test(player));
ok('the X never fades (only the caption and the sound controls do)',
   /'\.hktv\.quiet \.cap\{opacity:0\}'/.test(player) && !/quiet \.top/.test(player) && /--hk-db-bar-opacity/.test(player));
ok('a volume slider in the player', /volume: true/.test(player) && /r\.type = 'range'/.test(cam));
ok('in Fully it sets the tablet\'s media volume; elsewhere the video\'s, remembered per screen',
   /fk\.setAudioVolume\(Math\.round\(x \* 100\), FULLY_MUSIC\)/.test(cam) && /localStorage\.setItem\(VOL_KEY/.test(cam));
ok('raising the volume turns the sound on', /x > 0 && !self\._audible\(\)/.test(cam));
ok('a still that fails leaves no broken-image glyph', /img\.classList\.add\('dead'\)/.test(cam));
ok('the still hides once the video moves, and returns on a reconnect',
   /'\.db\.moving>img\{visibility:hidden\}'/.test(cam) && /db\.classList\.add\('moving'\)/.test(cam) &&
   /box\.classList\.remove\('moving'\)/.test(cam));

print('\n=== the camera card, as a TV ===');
ok('fill: letterboxed (contain), not cropped', /'\.db\.fill>img,\.db\.fill>video\{object-fit:contain/.test(cam));
ok('tuning: a message until it plays, and a reason after 25 s',
   /'Tuning ' \+ c\.tuning/.test(cam) && /Every tuner may be in use/.test(cam) && /, 25000\)/.test(cam));

print('\n=== hk-idle holds ===');
var idle = readFile(HK_ROOT + '/frontend/modules/hk-idle.js');
ok('a held tablet is never sent home', /if \(Object\.keys\(holds\)\.length\) return;/.test(idle));
ok('holds are keyed, so one holder cannot release another', /if \(on\) holds\[key\] = true; else delete holds\[key\];/.test(idle));

print('\n=== the Live TV pill ===');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
var Scene = customElements.get('hk-scene-card'), Pill = customElements.get('hk-tile-card');
var sc = new Scene(), threw = null;
try { sc.setConfig({ name: 'Live TV', icon: 'hk:television', tap_action: { action: 'navigate', navigation_path: './live-tv' } }); } catch (e) { threw = e.message; }
ok('a scene pill needs no entity (the Live TV pill only navigates)', !/entity/.test(threw || ''), threw);  // (the shim may fail later, drawing)
var tl = new Pill(), threw2 = null;
try { tl.setConfig({ name: 'x' }); } catch (e) { threw2 = e.message; }
ok('a state tile still requires one', /entity/.test(threw2 || ''), threw2);
// (Which page the Live TV pill opens -- ./live-tv -- is the scene row's page
// pills: test_chipkinds. It used to be read off this house's YAML scenes row,
// retired with the YAML dashboards on 2026-09-28.)

print('\n' + (fail ? 'FAIL ' + fail + ' TV TESTS' : 'ALL ' + pass + ' TV TESTS PASS'));
if (fail) throw new Error('tv tests failed');
