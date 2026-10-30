// NO PILL NUMBER OUTSIDE THE TABLE (plan 2026-10-13, the HomeKit match,
// step 1.4). Every pill dimension is read from hk-base.js's TILE / CHIP (JS)
// or --hk-pill / --hk-gap (css/hk-responsive.css), so a change of the pill's
// size is a change in one place. This holds the old literals out of the
// code: a 192px, 152px or 82px written anywhere else (comments aside) is a
// pill number that will not follow the table. Exceptions are listed by file
// with the reason; anything else that matches fails.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond, info) { print((cond ? 'PASS ' : 'FAIL ') + name + (cond || !info ? '' : '  -- ' + info)); cond ? pass++ : fail++; }

var FILES = ['cards/hk-base', 'cards/hk-tile', 'cards/hk-chip', 'cards/hk-stat', 'cards/hk-row', 'cards/hk-layout',
  'cards/hk-strategy', 'cards/hk-detail', 'cards/hk-home', 'cards/hk-media', 'cards/hk-library', 'cards/hk-energy',
  'cards/hk-control', 'cards/hk-cameras', 'cards/hk-weather', 'cards/hk-room', 'cards/hk-security', 'cards/hk-popup',
  'cards/hk-music', 'cards/hk-calendar', 'cards/hk-person',
  'modules/hk-menu', 'modules/hk-tabbar', 'modules/hk-notify', 'modules/hk-header', 'modules/hk-timers'];
var PATTERNS = [/\b192px\b/, /\b152px\b/, /\b82px\b/, /repeat\(2,\s*192px\)/, /\b204 \* /];
// file -> [substring of the offending line, why it stays]
var ALLOWED = {
  'cards/hk-detail': [['.lk .core{width:192px;height:192px', 'the lock sheet\'s 192 px circle: not a pill']],
  'cards/hk-calendar': [['.tm{width:82px;', 'the day list\'s time column: not a pill row']]
};

// comments out: block comments, and whole-line // comments (a CSS comment
// inside a JS string is a comment too)
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, ' '); })
            .split('\n').map(function (l) { return /^\s*\/\//.test(l) ? '' : l; });
}
FILES.forEach(function (f) {
  var lines;
  try { lines = code(readFile(root + '/frontend/' + f + '.js')); }
  catch (e) { check(f + ' readable', false, String(e)); return; }
  var bad = [];
  lines.forEach(function (l, i) {
    if (!PATTERNS.some(function (p) { return p.test(l); })) return;
    var ok = (ALLOWED[f] || []).some(function (a) { return l.indexOf(a[0]) >= 0; });
    if (!ok) bad.push((i + 1) + ': ' + l.trim().slice(0, 110));
  });
  check(f + '.js has no pill literal outside the table', !bad.length, bad.join(' | '));
});
// ...and the CSS file: its pill and gap are variables (comments aside)
var css = code(readFile(root + '/frontend/css/hk-responsive.css')).join('\n');
check('hk-responsive.css: no 192 / 82 literal', !/\b192px\b|\b82px\b/.test(css));
check('hk-responsive.css: the rails read --hk-gap',
      (css.match(/var\(--hk-gap\)/g) || []).length >= 2);

// the table itself
var base = readFile(root + '/frontend/cards/hk-base.js');
check('hk-base.js exports the table', base.indexOf('window.hkCards.TILE = TILE;') >= 0 &&
      base.indexOf('window.hkCards.CHIP = CHIP;') >= 0);

// CENTRED TILES (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase B): their
// numbers are in the table too, measured off HomeView -- and Home's are as
// they were (the Home app's, 2026-10-13)
load(root + '/tests/dom.js');
load(root + '/frontend/cards/hk-base.js');
var TL = window.hkCards.TILE, CT = TL.centred;
check('Home\'s tile is unchanged: 196 x 70, the tall 150, a 42 px well, a 23 px glyph, 15 px text',
      TL.w === 196 && TL.h === 70 && TL.tall === 150 && TL.glyph === 23 && TL.tallText === 15 && TL.gridGap === 10 && TL.padL === 9.8,
      JSON.stringify([TL.w, TL.h, TL.tall, TL.glyph, TL.tallText]));
check('Centred in a square cell: the glyph in a 66 px box (72 drawn round it) at 33 %; lit 40 in a 64 well',
      CT.square.glyph === 66 && CT.square.box === 72 && CT.square.at === 33 && CT.square.lit === 40 && CT.square.well === 64, JSON.stringify(CT.square));
check('...the name 21 and the room 20 on 27 px lines, from 57.7 %', CT.square.name === 21 && CT.square.sub === 20 && CT.square.line === 27 && CT.square.text === 57.7);
check('Centred in a 196 x 150 cell: a 50 px glyph at 31 %, 17 / 16 on 22 px from 55 %',
      CT.tall.glyph === 50 && CT.tall.at === 31 && CT.tall.name === 17 && CT.tall.sub === 16 && CT.tall.line === 22 && CT.tall.text === 55 && CT.tall.lit === 30, JSON.stringify(CT.tall));
check('...tracked -0.3, 10 px in from the sides', CT.track === -0.3 && CT.inset === 10);
var cc = window.hkCards.centredTile({ host: ':host([tile=centred])', plate: 'hk-plate.card', lit: 'hk-plate.card[data-on="1"]', well: '.well', icon: '.icon', name: '.name', sub: ['.label'] });
check('the CSS is the table\'s: the name 600 at 21 px in a square cell, the room 400, centred', /@container hk-cell \(min-height:180px\)\{[^@]*\.name\{top:57\.7% !important;font-size:21px !important;line-height:27px !important\}/.test(cc) &&
      /\.label\{position:absolute[^}]*text-align:center[^}]*font-weight:400/.test(cc) && /\.name\{position:absolute[^}]*font-weight:600/.test(cc));
check('...and only under the variant: every rule begins with its :host', cc.split('}').filter(function (r) { return r.trim() && r.indexOf('{') >= 0; })
      .every(function (r) { return /^(@container hk-cell \(min-height:180px\)\{)?:host\(\[tile=centred\]\)/.test(r.trim()); }));

print(fail ? 'FAIL ' + fail + ' PILL GEOMETRY TESTS' : 'ALL ' + pass + ' PILL GEOMETRY TESTS PASS');
