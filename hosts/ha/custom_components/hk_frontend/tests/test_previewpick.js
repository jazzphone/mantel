// A CHOICE SHOWN AS PICTURES (panels/hk-settings-kit.js previewPick, 2026-10-31, the owner: the previews "inside a
// drop-down"): the row says the choice with a small picture of it; tapped, it drops down every choice drawn small, the
// one chosen ringed; a tap on another picks it and folds the grid away. The pictures are drawn only when the grid first
// opens. And the page's choices that read better as pictures use it: the clock's Background, the Day face's Look, the
// Forecast's Layout and the sky's Background, for All Screens and for a screen.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
var K = window.hkSettingsKit;
var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
var all = function (n, out) { out = out || []; (n.children || []).forEach(function (k) { out.push(k); all(k, out); }); return out; };
var byCls = function (n, c) { return all(n).filter(function (e) { return (' ' + (e.className || '') + ' ').indexOf(' ' + c + ' ') >= 0; }); };
var text = function (n) { return all(n).concat([n]).map(function (e) { return e.children && e.children.length ? '' : (e.textContent || ''); }).join(''); };

var drawn = [], picked = [];
var OPTS = [['black', 'Black', 'Still'], ['grain', 'Grain Wash', 'Moving'], ['gradient', 'Drifting Gradient', 'Moving'], ['photos', 'Photos', 'From Your Screens']];
function make(value, sk) {
  return K.previewPick({ label: 'Background', sk: sk || 'saver:clock_bg', value: value, options: OPTS,
    picture: function (v, w, h) { drawn.push([v, w, h]); var e = document.createElement('i'); e.className = 'pic-' + v; return e; },
    onChange: function (v) { picked.push(v); } });
}
var p = make('gradient'), row = p.children[0], grid = p.children[1];
ok('a row and its grid, in a cell wrapper (its separators as a row’s)', [p.className, row.tagName.toLowerCase(), row.className, grid.className], ['cellwrap pvpick', 'button', 'cell pvrow', 'pvgrid']);
ok('every part of the row a node (its picture function never taken for a leading picture: lead() reads o.thumb)', all(row).concat(row.children).every(function (e) { return e && typeof e === 'object' && typeof e !== 'function'; }), true);
ok('the row says the choice, with its picture: the one drawn so far', [text(byCls(row, 'pvname')[0]), drawn], ['Drifting Gradient', [['gradient', 44, 30]]]);
ok('...closed: the grid hidden, nothing in it yet', [grid.hidden, row.getAttribute('aria-expanded'), grid.children.length], [true, 'false', 0]);
ok('...named for what it chooses, the grid a radio group under it', [grid.getAttribute('role'), grid.getAttribute('aria-labelledby') === byCls(row, 'lbl')[0].getAttribute('id'), row.getAttribute('aria-controls') === grid.getAttribute('id')], ['radiogroup', true, true]);
row.click();
var radios = grid.children.filter(function (e) { return e.getAttribute('role') === 'radio'; });
ok('tapped: the grid drops down', [grid.hidden, row.getAttribute('aria-expanded')], [false, 'true']);
ok('...every choice drawn small, at a tablet’s shape', drawn.slice(1), [['black', 88, 61], ['grain', 88, 61], ['gradient', 88, 61], ['photos', 88, 61]]);
ok('...each named, the one chosen checked', radios.map(function (b) { return [text(byCls(b, 'pvcap')[0]), b.getAttribute('aria-checked')]; }),
   [['Black', 'false'], ['Grain Wash', 'false'], ['Drifting Gradient', 'true'], ['Photos', 'false']]);
ok('...under their groups’ names, as the system’s menus have them', byCls(grid, 'pvhead').map(text), ['Still', 'Moving', 'From Your Screens']);
row.click(); row.click();
ok('opened again: drawn once only', drawn.length, 5);
radios[2].click();
ok('the one chosen tapped: nothing changes, the grid folds', [picked, grid.hidden], [[], true]);
row.click();
radios[3].click();
ok('another tapped: picked, the grid folds away', [picked, grid.hidden, row.getAttribute('aria-expanded')], [['photos'], true, 'false']);
// OPEN ACROSS A REDRAW: the page draws itself again while the grid is open (a save elsewhere) -- it stays open
var q = make('black', 'sky.background');
q.children[0].click();
var q2 = make('black', 'sky.background');
ok('open across a redraw of the page', q2.children[1].hidden, false);
q2.children[1].children.filter(function (e) { return e.getAttribute('role') === 'radio'; })[1].click();
ok('...and closed once one is picked: closed next time', make('grain', 'sky.background').children[1].hidden, true);
// a picture that can't be drawn: the frame alone, never a broken row
var bad = K.previewPick({ label: 'X', sk: 'x', value: 'a', options: [['a', 'A']], picture: function () { throw new Error('no'); }, onChange: function () {} });
ok('a picture that fails: its frame alone', [byCls(bad, 'pvthumb').length, byCls(bad, 'pvthumb')[0].children.length], [1, 0]);

print('=== where the page uses it ===');
var SRC = read(HK_ROOT + '/frontend/panels/hk-settings.js');
// (2026-11-01: the Screensaver page's pickers -- the clock's Background, the Day face's Look, the Forecast's Layout --
// are Edit Screensaver's, with a picture of each background: the page keeps what can't be laid out)
ok('the Screensaver page picks no look: the editor does', /sk: 'saver:clock_bg'|sk: 'saver:day_look'/.test(SRC), false);
// ...but the forecast where it comes in as a slide (2026-11-01, the owner: "no way of setting Big layout for forecast
// with Photos"): Classic and Big Weather, each pictured
ok('the Forecast slide\'s Layout: Classic and Big Weather', /K\.previewPick\(\{ label: 'Layout', sk: 'saver:forecast_layout'[\s\S]{0,200}v === 'big' \? 'weather' : 'forecast'/.test(SRC), true);
ok('the sky’s Background, for All Screens and for a screen, and Flat’s', [/K\.previewPick\(\{ label: 'Background', sk: 'sky\.background'/.test(SRC), /K\.previewPick\(\{ label: 'Background', sub: ownMode/.test(SRC),
   /K\.previewPick\(\{ label: 'Background', sub: b \? \(own/.test(SRC)], [true, true, true]);
ok('...none of them a segmented control or a pop-up menu any more', /K\.(seg|select)\(\{ label: '(Background|Look|Forecast Layout)', (sk|sub)/.test(SRC), false);

print(fail ? 'FAIL ' + fail + ' PREVIEW PICK TESTS' : 'ALL ' + pass + ' PREVIEW PICK TESTS PASS');
if (fail) throw new Error(fail + ' failed');
