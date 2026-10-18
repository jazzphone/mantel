// ONE SEGMENTED CONTROL (hk-base.js segCss): the calendar's Day / Week /
// Month, the Energy tabs, a select's segments, the control cards' choices,
// the detail sheets' choices -- and the Play Music tabs, which write the same
// sizes out because their module can load before the cards. This suite holds
// every copy to segCss's geometry and spring, so none can drift again.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
var C = window.hkCards;
var css = C.segCss('.seg');
// (padded 3 inside a 1 px edge; Flat: no edge, padded 4 -- --hk-seg-bw)
ok('the capsule: 44 px, padded 3, round', /\.seg\{[^}]*height:44px;padding:calc\(4px - var\(--hk-seg-bw, 1px\)\);border-radius:calc\(44px \/ 2\)/.test(css), css.slice(0, 200));
ok('its choices: 36 px, 15 px, 600', /height:calc\(44px - 8px\)/.test(css) && /font-size:15px;font-weight:600/.test(css));
ok('the chosen one: white, dark text, sliding on a spring', /\{color:#1c1c1e/.test(css) && css.indexOf('transition:transform .42s cubic-bezier(.34,1.24,.42,1)') > 0);
ok('Reduce Motion: no slide', css.indexOf('prefers-reduced-motion:reduce') > 0);
var cards = C.segCss('.option-row', { on: '.active', fill: true, font: '13px' });
ok('marked another way (.active), sharing the width', cards.indexOf('.option-row button.active::before') > 0 && /flex:1 1 0/.test(cards));
// the Play Music tabs' own copy, held to the same numbers
var src = read(HK_ROOT + '/frontend/modules/hk-saver-panel.js');
var tabs = (src.match(/'\.mptabs\{[^']*'/) || [''])[0], item = (src.match(/'\.mptabs div\{[^']*'/) || [''])[0];
ok('Play Music: the capsule 44 px, padded 3, radius 22', /height:44px;padding:3px;border-radius:22px/.test(tabs), tabs);
ok('Play Music: its choices 36 px, 15 px, 600, radius 18', /height:36px/.test(item) && /border-radius:18px/.test(item) && /font-size:15px;font-weight:600/.test(item), item);
ok('Play Music: the same spring', src.indexOf('transition:transform .42s cubic-bezier(.34,1.24,.42,1)') > 0);
ok('Play Music: the shared slide once the cards are in', src.indexOf('window.hkCards.slideSeg(now, from)') > 0);
// every other user of a segmented control asks segCss for it
['cards/hk-calendar.js', 'cards/hk-energy.js', 'cards/hk-control.js', 'cards/hk-detail.js', 'cards/hk-weather.js'].forEach(function (f) {
  var s = read(HK_ROOT + '/frontend/' + f);
  ok(f + ' draws its segmented controls with segCss', /segCss\(/.test(s));
});
// ONE HEIGHT: nobody asks segCss for another (the user: they differed)
['cards/hk-calendar.js', 'cards/hk-energy.js', 'cards/hk-control.js', 'cards/hk-detail.js', 'cards/hk-weather.js'].forEach(function (f) {
  var s2 = read(HK_ROOT + '/frontend/' + f);
  ok(f + ': every segmented control 44 px (no h of its own)', !/segCss\([^)]*\bh\s*:/.test(s2));
});
print(fail ? 'FAIL ' + fail + ' SEGMENTS TESTS' : 'ALL ' + pass + ' SEGMENTS TESTS PASS');
