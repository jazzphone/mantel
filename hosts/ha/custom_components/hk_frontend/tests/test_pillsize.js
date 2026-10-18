// THE iPAD PILL: one width, --hk-pill, read by everything that sizes a pill
// or its track. The css defines it (170) only in the band between a phone and
// a wall tablet; everywhere else each reader falls back to 196, the Home
// app's pill. The failure this guards -- pills and the scenes row sized by
// different numbers, so they stop lining up -- happens the moment one reader
// goes back to a literal 192px.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }

var css = readFile(root + '/frontend/css/hk-responsive.css');
var band = css.slice(css.indexOf('@media (min-width: 640.02px) and (max-width: 1023.98px)'));
check('the band exists', band.length > 0 && band !== css);
check('the band defines the pill', /--hk-pill:\s*\d+px;/.test(band));
check('...and the grid tracks read it', /--hk-track:\s*var\(--hk-pill\);/.test(band));
var phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  :root'), css.indexOf('BETWEEN A PHONE'));
check('a phone does not get it (its tracks fill instead)', phone.length > 0 && !/--hk-pill:/.test(phone));
check('nothing outside the two band blocks defines it', css.split('--hk-pill:').length === 3);

// THE BAND TWICE: by the window (the media query) and by the page
// ([data-hk-band], set by hk-menu.js when a docked menu narrows the page).
// A media query cannot be OR'd with an attribute, so the declarations are
// repeated -- and must stay identical.
function decls(block) {
  return block.replace(/\/\*[\s\S]*?\*\//g, '').split(';').map(function (d) {
    return d.replace(/\s+/g, ' ').trim();
  }).filter(function (d) { return /^--/.test(d); });
}
function blockAfter(src, head) {
  var i = src.indexOf(head); if (i < 0) return '';
  var j = src.indexOf('{', i + head.length - 1) + 1, depth = 1, k = j;
  while (depth && k < src.length) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
  return src.slice(j, k - 1);
}
var byWindow = decls(blockAfter(band, ':root:not([data-hk-zoomed]) {'));
var byPage = decls(blockAfter(css, ':root[data-hk-band]:not([data-hk-zoomed]) {'));
check('the page-width band exists', byPage.length >= 8);
check('...and says exactly what the window band says', JSON.stringify(byPage) === JSON.stringify(byWindow));

// the rule says width, min-width and max-width by one name for the pill's CSS
// width (hk-base.js PILL_W / TILE.css: var(--hk-pill, TILE.w px))
var P = /width:'\+(PILL_W|TILE\.css|window\.hkCards\.TILE\.css)\+';min-width:'\+\1\+';max-width:'\+\1/;
[['hk-base.js', '.tile{'], ['hk-tile.js', 'hk-plate.card{'], ['hk-stat.js', 'hk-plate.rank{']].forEach(function (f) {
  var src = readFile(root + '/frontend/cards/' + f[0]).replace(/',\s*\n\s*'/g, '');
  var at = src.indexOf(f[1]);
  var rule = at < 0 ? '' : src.slice(at, src.indexOf('}', at));
  check(f[0] + ' ' + f[1] + ' is sized by --hk-pill', P.test(rule.replace(/\s/g, '')));
  check(f[0] + ' ' + f[1] + ' has no literal 192px width', !/(^|[;{\s])(min-|max-)?width:\s*192px/.test(rule));
});

// A detail sheet is the same 460 px on an iPad, so its pill pair keeps 192.
var det = readFile(root + '/frontend/cards/hk-detail.js');
var base = readFile(root + '/frontend/cards/hk-base.js');
check('the pill\'s CSS width is --hk-pill over the table\'s', /var PILL_W = 'var\(--hk-pill,' \+ TILE\.w \+ 'px\)';/.test(base));
check('the sheet\'s two-column group pins the full pill', /':host\{display:block;--hk-pill:' \+ T\.w \+ 'px;/.test(det));
// ...and has no layout-card cell to bleed over: a phone pill is its cell
// plus --hk-cell-bleed, which would run the right column past the sheet's edge.
check('...with no cell bleed (a phone pill fills its column, no more)', /--hk-pill:' \+ T\.w \+ 'px;--hk-cell-bleed:0px\}'/.test(det));

// THE ONE SOURCE (plan 2026-10-13, the HomeKit match): the pill's numbers
// are hk-base.js's TILE; the CSS file, which can't read JS, carries the gap
// as --hk-gap and the iPad pill as --hk-pill. They must agree, and the
// documented math must still hold.
var tsrc = /var TILE = \{([^}]*)\}/.exec(base);
var TILE = {};
(tsrc ? tsrc[1] : '').split(',').forEach(function (kv) {
  var m = /(\w+):\s*([\d.]+)/.exec(kv); if (m) TILE[m[1]] = +m[2];
});
check('the table has the pill\'s width and gap', TILE.w > 0 && TILE.gridGap > 0);
var gapCss = /:root \{ --hk-gap: ([\d.]+)px; \}/.exec(css);
check('--hk-gap is the table\'s gridGap', !!gapCss && +gapCss[1] === TILE.gridGap);
var bandPill = +(/--hk-pill:\s*([\d.]+)px;/.exec(band) || [0, 0])[1];
// an iPad mini held upright (744 px): the narrowest pill grid any page gives
// it, measured with hk_house/tools/headless/pill_geometry.py (2026-10-13):
// every page -- Home, a room, Lights, Doors, Water, Energy, and the EcoFlow
// custom page since its layout follows the generated pages' -- 713.7
var IPAD_MINI_GRID = 713.7;
check('four iPad pills and three gaps fit an iPad mini upright, with 2 px to spare (' +
      (4 * bandPill + 3 * TILE.gridGap) + ' of ' + IPAD_MINI_GRID + ')',
      4 * bandPill + 3 * TILE.gridGap <= IPAD_MINI_GRID - 2);
check('...and the iPad pill is no wider than the pill', bandPill > 0 && bandPill <= TILE.w);
// the rows are derived, not second numbers
var bsrc = base.replace(/\s+/g, ' ');
check('a row is the pill and the gap', bsrc.indexOf('TILE.row = TILE.h + TILE.gridGap;') >= 0);
check('a tall tile is two rows less a gap', bsrc.indexOf('TILE.tall = 2 * TILE.h + TILE.gridGap;') >= 0);

print(fail ? 'FAIL ' + fail + ' PILL SIZE TESTS' : 'ALL ' + pass + ' PILL SIZE TESTS PASS');
