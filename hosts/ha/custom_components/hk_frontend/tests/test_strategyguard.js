// The strategy guard (modules/hk-settings.js): a generated screen stuck on
// Home Assistant's "Timeout waiting for strategy element" page mends itself
// -- rebuilt when the strategy came late, loaded again when it never came,
// and reloaded as the last resort, at most once in two minutes.
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-settings.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
var G = window.hkStrategyGuard, S = G._;
var EL = 'll-strategy-dashboard-hk-dashboard';
var ERR = { views: [{ title: 'Error', cards: [{ type: 'markdown', content:
  'Error loading the dashboard strategy:\n> Error: Timeout waiting for strategy element ' + EL + ' to be registered' }] }] };
var HK = { strategy: { type: 'custom:hk-dashboard' } };
function page(config, raw) {
  var p = { lovelace: { rawConfig: raw || HK, config: config }, shadowRoot: null, events: [] };
  p.dispatchEvent = function (e) { p.events.push(e.type); return true; };
  return p;
}
var loads = [], reloads = 0, P;
S.panel = function () { return P; };
S.reload = function () { reloads++; };
// the tab's session storage, which the reload cap lives in
var SS = {};
var sessionStorage = { getItem: function (k) { return k in SS ? SS[k] : null; },
                       setItem: function (k, v) { SS[k] = String(v); }, removeItem: function (k) { delete SS[k]; } };

print('=== what counts as stuck ===');
ok('Home Assistant\'s timeout page on a generated screen', G.stuck(page(ERR).lovelace) === true);
ok('...not a built screen', G.stuck(page({ views: [{ title: 'Home', path: 'home' }, { title: 'Weather' }] }).lovelace) === false);
ok('...not another strategy\'s screen, nor a hand-written one',
   G.stuck(page(ERR, { strategy: { type: 'original-states' } }).lovelace) === false && G.stuck(page(ERR, { views: [] }).lovelace) === false);
ok('...and nothing at all is not stuck', G.stuck(null) === false && G.stuck({}) === false);
P = page({ views: [{ title: 'Home' }] });
ok('a healthy page: nothing done', G.check(1000) === 'ok' && !P.events.length);

print('\n=== the strategy never loads ===');
P = page(ERR);
S.load = function (u) { loads.push(u); return Promise.reject(new Error('Failed to fetch dynamically imported module')); };
ok('first look: it asks the first address again (for its error), then loads a new one',
   G.check(10000) === 'retrying' && loads.length === 2 && loads[0] === '/hk/cards/hk-strategy.js' &&
   /\/hk\/cards\/hk-strategy\.js\?retry=10000$/.test(loads[1]), loads);
drainMicrotasks();
ok('...and not again every 3 s', G.check(13000) === 'waiting' && loads.length === 2);
ok('still stuck 20 s on: the page is reloaded', G.check(30500) === 'reloaded' && reloads === 1);
ok('...but not again within two minutes', G.check(60000) === 'held' && reloads === 1);

print('\n=== no storage: never a reload loop ===');
var keepSS = sessionStorage;
sessionStorage = { getItem: function () { throw new Error('SecurityError'); }, setItem: function () { throw new Error('SecurityError'); } };
S.since = 0; S.tries = 1; reloads = 0;
P = page(ERR);
ok('with nowhere to remember a reload, it does not reload', G.check(500000) !== 'reloaded' && G.check(530000) === 'no storage' && reloads === 0);
sessionStorage = keepSS;

print('\n=== it loads on the second try ===');
S.since = 0; S.tries = 0; loads = [];
var reloadsBefore = reloads;
P = page(ERR);
S.load = function (u) { loads.push(u); customElements.define(EL, class extends HTMLElement {}); return Promise.resolve(); };
ok('the file loads again', G.check(200000) === 'retrying' && loads.length === 2);
drainMicrotasks();
ok('...and the page is rebuilt, not reloaded', P.events.indexOf('config-refresh') !== -1 && reloads === reloadsBefore, P.events);

print('\n=== it came late ===');
S.since = 0; S.tries = 0; S.rebuiltAt = 0; loads = [];
P = page(ERR);
ok('the strategy is here: rebuilt at once, nothing loaded', G.check(300000) === 'rebuilt' && P.events.length === 1 && !loads.length);
ok('...once, not every 3 s while the rebuild runs', G.check(303000) === 'rebuilding' && P.events.length === 1);
P.lovelace.config = { views: [{ title: 'Home' }, { title: 'Weather' }] };
ok('built: the guard lets go', G.check(306000) === 'ok');


print(fail ? 'FAIL ' + fail + ' STRATEGY GUARD TESTS' : 'ALL ' + pass + ' STRATEGY GUARD TESTS PASS');
