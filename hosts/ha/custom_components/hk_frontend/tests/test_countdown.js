// <hk-countdown> -- the element that owns its own repaint.
//
// THE REAL ELEMENT, driven through its real callbacks. modules/hk-timers.js
// keeps remaining() and fmt() private, so the temptation is to copy them into
// the suite and test the copy; that would be a second source of truth.
// Instead the suite constructs the registered class, sets attributes on it
// and reads its textContent back, which is exactly what the card and the
// browser do.
//
// WHAT IS ACTUALLY AT RISK HERE
//  * `hold` must WIN over both other modes. It is the paused case, and the
//    whole point is that the interval must not walk it.
//  * `since` counts UP and is capped at `total`, so a finished track reads its
//    duration instead of running past it while HA catches up.
//  * `since` must NOT publish --hk-left. That variable means "fraction
//    REMAINING" and drives a sibling progress bar; a count-up publishing it
//    would run the bar backwards. (The media player's elapsed time is the
//    only count-up.)
//  * the format must match hk-control.js's clock(), because the elapsed time
//    is drawn by this element and the duration beside it by that function.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-timers.js');

var pass = 0, fail = 0;
function ok(what, got, want) {
  if (String(got) === String(want)) { pass++; return; }
  fail++;
  print('  FAIL ' + what + '\n    got  ' + got + '\n    want ' + want);
}

var Countdown = customElements.get('hk-countdown');
if (!Countdown) throw new Error('hk-countdown never registered');

// Build one the way the browser does: construct, set attributes, connect.
function make(attrs) {
  var el = new Countdown();
  el.parentNode = new El('div');
  for (var k in attrs) el.setAttribute(k, attrs[k]);
  el.isConnected = true;
  el.connectedCallback();
  return el;
}
function text(attrs) { return make(attrs).textContent; }

print('=== hold: the paused case, a fixed number of seconds ===');
ok('paused mid-track',   text({hold: 62,  total: 336}), '1:02');
ok('paused at zero',     text({hold: 0,   total: 336}), '0:00');
ok('paused past an hour',text({hold: 3725,total: 7200}), '1:02:05');

print('\n=== hold WINS over since and deadline ===');
// Pausing re-renders the card with `hold` and no `since`; morph() removes the
// stale attribute. But if a host ever left both on, the paused reading must be
// the one that shows -- never a clock that keeps walking.
ok('hold beats since',
   text({hold: 5, since: Date.now() - 600000, total: 336}), '0:05');
ok('hold beats deadline',
   text({hold: 5, deadline: Date.now() + 600000, total: 336}), '0:05');

print('\n=== since: counts UP from the epoch ms at which the track was 0:00 ===');
ok('90s in',     text({since: Date.now() - 90000,  total: 336}), '1:30');
ok('just started',text({since: Date.now(),         total: 336}), '0:00');
ok('over an hour',text({since: Date.now() - 3725000, total: 7200}), '1:02:05');
// The cap. HA's media_position stops moving between updates but wall-clock
// does not, so without this a track that ended 40s ago reads past its own end.
ok('capped at total', text({since: Date.now() - 400000, total: 336}), '5:36');
ok('uncapped with no total', text({since: Date.now() - 400000}), '6:40');
// A clock that jumped backwards, or a `since` in the future, must read 0:00
// rather than a negative time.
ok('future since clamps to zero', text({since: Date.now() + 5000, total: 336}), '0:00');

print('\n=== deadline: the countdown every timer uses, unchanged ===');
ok('90s left',  text({deadline: Date.now() + 90000, total: 300}), '1:30');
ok('expired',   text({deadline: Date.now() - 90000, total: 300}), '0:00');
ok('no attributes at all', text({}), '0:00');

print('\n=== --hk-left goes on the PARENT, and never for a count-up ===');
var down = make({deadline: Date.now() + 150000, total: 300});
ok('countdown publishes the fraction remaining',
   down.parentNode.style.getPropertyValue('--hk-left'), '0.50');
var up = make({since: Date.now() - 150000, total: 300});
ok('a count-up publishes nothing',
   up.parentNode.style.getPropertyValue('--hk-left'), '');
var held = make({hold: 150, total: 300});
ok('a paused countdown still publishes',
   held.parentNode.style.getPropertyValue('--hk-left'), '0.50');

print('\n=== the format matches hk-control.js clock() ===');
// Same rule, transcribed from cards/hk-control.js. If these two ever drift, a
// long podcast shows "1:02:30" of "75:00" on the same line.
function clock(t) {
  var n = Math.max(0, Math.round(t));
  var h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
  return (h ? h + ':' : '') + (h && m < 10 ? '0' : '') + m + ':' +
         String(sec).padStart(2, '0');
}
[0, 5, 59, 60, 62, 599, 600, 3599, 3600, 3605, 3725, 7199, 7200].forEach(function (n) {
  ok('clock(' + n + ')', text({hold: n}), clock(n));
});

print('\n=== attributeChangedCallback repaints, and only when connected ===');
var live = make({since: Date.now() - 62000, total: 336});
ok('starts at 1:02', live.textContent, '1:02');
live.removeAttribute('since');
live.setAttribute('hold', '5');
live.attributeChangedCallback();
ok('pausing repaints in place', live.textContent, '0:05');
var off = make({hold: 5});
off.isConnected = false;
off.setAttribute('hold', '900');
off.attributeChangedCallback();
ok('a disconnected element does not repaint', off.textContent, '0:05');

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' COUNTDOWN TESTS PASS'));
