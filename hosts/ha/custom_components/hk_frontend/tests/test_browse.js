// hk-browse-card: the address is derived, and https is told the truth.
//
// A hardcoded address (http://192.0.2.10:8095) works from exactly one
// place. And over an HTTPS origin the browser blocks an HTTP frame with no
// visible error -- an empty rectangle that looks like the whole flow is
// broken. It is not: two origins, two rules. (A dashboard's Browse Music page
// is hk-library-card; this card embeds Music Assistant's own web app.)
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }

load(root + '/tests/dom.js');
['hk-base', 'hk-tile', 'hk-media'].forEach(function (n) {
  load(root + '/frontend/cards/' + n + '.js');
});

function card(cfg) {
  var c = Object.create(customElements.get('hk-browse-card').prototype);
  // setConfig on the real base class reaches for a shadow root this bare
  // object does not have; the defaults are what these tests are about, so
  // apply them the same way setConfig does and leave rendering alone.
  c._config = Object.assign({ port: 8095, path: '/#/home' }, cfg || {});
  return c;
}
var tablet = { protocol: 'http:',  hostname: '192.0.2.10' };
var byName = { protocol: 'http:',  hostname: 'homeassistant.local' };
var remote = { protocol: 'https:', hostname: 'ha.example.com' };

var c = card();
check('the wall tablet gets MA on the same host',
      c._target(tablet) === 'http://192.0.2.10:8095/#/home');
// THE POINT of deriving it: a hardcoded address cannot do this at all.
check('a tablet reaching HA by NAME gets MA by the same name',
      c._target(byName) === 'http://homeassistant.local:8095/#/home');
check('http is never treated as blocked', c._blocked(tablet) === false);
check('http by name is never treated as blocked', c._blocked(byName) === false);
check('https is recognised as blocked', c._blocked(remote) === true);
// The direct link offered to an https visitor must be http -- the frame is
// blocked precisely because MA is not on https.
check('the direct link stays http for an https visitor',
      c._direct(remote) === 'http://ha.example.com:8095/#/home');

var custom = card({ port: 9000, path: '/#/library' });
check('the port is configurable',
      custom._target(tablet) === 'http://192.0.2.10:9000/#/library');
check('the path is configurable',
      custom._target(byName).indexOf('/#/library') !== -1);

// `host` is the escape hatch for MA genuinely living elsewhere; unset, the
// card must never invent one.
var elsewhere = card({ host: 'music.lan' });
check('an explicit host overrides the page host',
      elsewhere._target(tablet) === 'http://music.lan:8095/#/home');
check('no host is invented when none is configured',
      card()._host(byName) === 'homeassistant.local');

check('the card is registered', !!customElements.get('hk-browse-card'));

// Exercise the branch an HTTPS desktop actually renders. The decision helpers
// alone are not enough: `_render()` could call a missing method and every
// assertion above would still pass while HA showed a red error.
var blockedHtml = '', blockedOK = true;
try {
  var blocked = new (customElements.get('hk-browse-card'))();
  Object.defineProperty(blocked._root, 'innerHTML', {
    get: function () { return blockedHtml; },
    set: function (v) { blockedHtml = String(v); }
  });
  globalThis.location = remote;
  blocked.setConfig({});
} catch (e) { blockedOK = false; }
check('the real HTTPS render branch does not throw', blockedOK);
check('HTTPS render explains the blocked frame',
      blockedHtml.indexOf('cannot embed') !== -1);
check('HTTPS render offers the plain HTTP address',
      blockedHtml.indexOf('http://ha.example.com:8095/#/home') !== -1);

// --- filling the page ------------------------------------------------------
// A fixed `height: 78vh` cannot be right on both a kiosk tablet (no HA header
// above it) and a dashboard that has one. So the frame measures: the card's
// own left edge is the gutter the page grid produced, so using it as the
// bottom margin makes all three sides equal.
function fitting(rect, viewportH, marginBottom) {
  var c = Object.create(customElements.get('hk-browse-card').prototype);
  c._config = { port: 8095, path: '/#/home' };
  c._frame = { style: {} };
  c.isConnected = true;
  c.getBoundingClientRect = function () { return rect; };
  globalThis.getComputedStyle = function () {
    return { marginBottom: (marginBottom === undefined ? 0 : marginBottom) + 'px' };
  };
  var realH = globalThis.window.innerHeight;
  globalThis.window.innerHeight = viewportH;
  c._fit();
  globalThis.window.innerHeight = realH;
  return parseInt(c._frame.style.height, 10);
}
// A wall tablet: 1280x800, no HA header, heading row ~110px down, 26px gutter.
check('a kiosk tablet fills to the bottom, gutter-equal',
      fitting({ left: 26, top: 110 }, 800) === 800 - 110 - 26);
// THE REAL PAGE, SETTLED. layout-card's `margin: 4px 4px 8px` on the child is
// NOT subtracted: that margin is part of the gap being left, not space taken
// from the frame. Subtracting it leaves a 42 px gap under a 34 px gutter.
check('the child bottom margin is left alone',
      fitting({ left: 34, top: 92 }, 657, 8) === 657 - 92 - 34);
// The same page on a dashboard that still has HA's 56px header: the frame must
// come out SHORTER by exactly that, which one fixed vh could never do.
check('a header above it shortens the frame by exactly that much',
      fitting({ left: 26, top: 166 }, 800) === 800 - 166 - 26);
// Phone: smaller gutter, taller viewport.
check('a phone keeps the bottom gap equal to its own gutter',
      fitting({ left: 8, top: 96 }, 844) === 844 - 96 - 8);
// Mid-layout or somewhere unexpected, it must not collapse.
check('a card measured mid-layout does not collapse', fitting({ left: 0, top: 9999 }, 800) === 200);
// An explicit height is still honoured -- a full-screen Music Assistant
// panel with no heading sets 100vh.
var explicit = Object.create(customElements.get('hk-browse-card').prototype);
explicit._config = { port: 8095, path: '/#/home', height: '100vh' };
check('an explicit height is still respected', explicit._config.height === '100vh');

// --- re-configuring replaces the build -------------------------------------
// HkBase.setConfig rebuilds on every call (the editor preview re-configures
// the same element per edit). A rebuild must REPLACE the iframe -- a whole
// copy of Music Assistant's web app -- and its window resize listener, never
// add another.
globalThis.location = tablet;
function resizers() { return (__winL.resize || []).length; }
var rc = new (customElements.get('hk-browse-card'))();
var r0 = resizers(), t0 = __timerCount();
rc.setConfig({});
rc.setConfig({});
rc.setConfig({ port: 9000 });
var frames = rc._root.children.filter(function (n) { return n.tagName === 'iframe'; });
check('three setConfigs leave one iframe', frames.length === 1 && rc._root.children.length === 1);
check('...the latest config\'s', frames[0].src === 'http://192.0.2.10:9000/#/home');
check('three setConfigs leave one resize listener', resizers() - r0 === 1);
check('...and one fit ramp pending, not three', __timerCount() - t0 === 5);
rc.setConfig({ height: '100vh' });
check('an explicit height drops the listener', resizers() - r0 === 0);
check('...and the old ramp, which would refit it', __timerCount() - t0 === 0);
check('...and still draws one frame at that height',
      rc._root.children.length === 1 && rc._frame.style.height === '100vh');
rc.setConfig({});
rc.disconnectedCallback();
check('leaving the page drops the listener', resizers() - r0 === 0);
// a cached view coming back attaches the card again WITHOUT building it: the
// listener comes back with it (it followed no resize after a return before)
rc.connectedCallback();
check('coming back (a cached view) puts the listener back', resizers() - r0 === 1);
rc.disconnectedCallback();
check('...and leaving again takes it off', resizers() - r0 === 0);
print(fail ? 'FAIL ' + fail + ' BROWSE TESTS' : 'ALL ' + pass + ' BROWSE TESTS PASS');
