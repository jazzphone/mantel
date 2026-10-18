// hk-skyshot.js: the sky as a picture, drawn again from what the browser
// says about each piece. These are its pure parts -- CSS layout of a
// background, gradient geometry and stops, colors, filters as SVG
// primitives, a 3D plane's mapping. The drawing itself needs a browser:
// hk_house/tools/headless/glass_fidelity.py measures it against the browser's own blur.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function near(a, b, e) { return Math.abs(a - b) <= (e === undefined ? 1e-6 : e); }
globalThis.window = globalThis;
load(HK_ROOT + '/frontend/modules/hk-skyshot.js');
var _ = window.hkSkyShot._, VP = { W: 1200, H: 800 };

print('\n=== values ===');
ok('top-level commas only', JSON.stringify(_.splitTop('url(a,b), linear-gradient(red, blue), x')) === '["url(a,b)","linear-gradient(red, blue)","x"]');
ok('lengths: px, %, vw/vh/vmin/vmax', _.len('10px', 0, VP) === 10 && _.len('50%', 300, VP) === 150 && _.len('10vw', 0, VP) === 120 &&
   _.len('46vmax', 0, VP) === 552 && _.len('10vmin', 0, VP) === 80);
ok('a position: percentages place the image\'s own point, px from the corner, keywords',
   JSON.stringify(_.place('50% 100%', 200, 100, 50, 20, VP)) === '[75,80]' && JSON.stringify(_.place('10px 5px', 200, 100, 50, 20, VP)) === '[10,5]' &&
   JSON.stringify(_.place('right bottom', 200, 100, 50, 20, VP)) === '[150,80]');
ok('background-size: cover, contain, explicit, auto keeping the ratio, a gradient fills the box',
   JSON.stringify(_.tileSize('cover', 200, 100, [100, 100], VP)) === '[200,200]' && JSON.stringify(_.tileSize('contain', 200, 100, [100, 100], VP)) === '[100,100]' &&
   JSON.stringify(_.tileSize('50% auto', 200, 100, [100, 50], VP)) === '[100,50]' && JSON.stringify(_.tileSize('auto', 200, 100, null, VP)) === '[200,100]');
ok('colors read: rgb, rgba, transparent', JSON.stringify(_.rgbaOf('rgb(1, 2, 3)')) === '[1,2,3,1]' && JSON.stringify(_.rgbaOf('rgba(255, 231, 186, 0.3)')) === '[255,231,186,0.3]' &&
   JSON.stringify(_.rgbaOf('transparent')) === '[0,0,0,0]' && _.rgbaOf('color(srgb 1 0 0)') === null);

print('\n=== gradients ===');
var L = _.lineOf(null, 100, 50);
ok('no direction: top to bottom, the box\'s height long', near(L.x0, 50) && near(L.y0, 0) && near(L.x1, 50) && near(L.y1, 50) && near(L.L, 50), L);
L = _.lineOf('to right', 100, 50);
ok('to right: across, its width long', near(L.x0, 0) && near(L.x1, 100) && near(L.y0, 25) && near(L.L, 100), L);
L = _.lineOf('135deg', 100, 100);
ok('an angle: through the center, as long as the box seen along it (135deg on a square: its diagonal)', near(L.L, 100 * Math.SQRT2, 1e-9) && near((L.x0 + L.x1) / 2, 50) && L.x1 > L.x0 && L.y1 > L.y0, L);
L = _.lineOf('to top right', 200, 100);
// perpendicular to the diagonal from top-left to bottom-right (200, 100): along (100, -200)
ok('a corner: perpendicular to the other diagonal, pointing into the corner', L.x1 > L.x0 && L.y1 < L.y0 && near((L.x1 - L.x0) / (L.y1 - L.y0), -0.5, 1e-9), L);
var st = _.resolveStops([_.stopOf('red'), _.stopOf('blue 40%'), _.stopOf('green'), _.stopOf('black 20%')], 100, VP);
// red (first: 0), blue 40%, green (a gap), black 20% (before blue: raised to 40) -> green between 40 and 40
ok('stops fixed up as CSS does: the first at 0, one before the one before it raised to it, a gap spread between',
   st.map(function (x) { return x.p; }).join(',') === '0,40,40,40', st.map(function (x) { return x.p; }));
var st3 = _.resolveStops([_.stopOf('red'), _.stopOf('blue'), _.stopOf('green'), _.stopOf('black')], 90, VP);
ok('...and with none placed, spread evenly end to end', st3.map(function (x) { return x.p; }).join(',') === '0,30,60,90', st3.map(function (x) { return x.p; }));
var st2 = _.resolveStops([_.stopOf('red 10%'), _.stopOf('blue 5%')], 100, VP);
ok('...a stop before the one before it is raised to it', st2[1].p === 10, st2);
var dbl = _.resolveStops([_.stopOf('rgba(0, 0, 0, 0) 0px 6%'), _.stopOf('red 10%')], 100, VP);
ok('...a double position is two stops', dbl.length === 3 && dbl[0].p === 0 && dbl[1].p === 6, dbl);
var R = _.radialOf('46vmax at 79.3% 36%', 1200, 800, VP);
ok('radial: one length is a circle of it, at its position', near(R.rx, 552) && near(R.ry, 552) && near(R.cx, 951.6) && near(R.cy, 288), R);
R = _.radialOf('closest-side', 200, 100, VP);
ok('radial: an ellipse to the closest sides', near(R.rx, 100) && near(R.ry, 50), R);
R = _.radialOf('circle at 0% 0%', 30, 40, VP);
ok('radial: a circle to the farthest corner', near(R.rx, 50) && near(R.ry, 50), R);
var cs = _.colorStops([{ p: 0, color: 'rgba(255, 231, 186, 0.3)' }, { p: 100, color: 'rgba(0, 0, 0, 0)' }], 100, false);
var mid = cs.filter(function (x) { return near(x.t, 0.5); })[0];
ok('to transparent, the colors between are blended as CSS does (premultiplied): the glow stays its color as it fades',
   mid && /^rgba\(255,231,186,0\.15/.test(mid.color), cs.map(function (x) { return x.t.toFixed(3) + ' ' + x.color; }));
var rep = _.colorStops([{ p: 0, color: 'red' }, { p: 10, color: 'blue' }], 30, true);
ok('a repeating gradient: its stops laid end to end across the line', rep.filter(function (x) { return x.color === 'red'; }).length >= 3, rep.length);

print('\n=== filters, by the browser ===');
var fl = _.filtersOf('brightness(0.46) saturate(0.7) drop-shadow(rgb(255, 190, 92) 0px 0px 3px)');
ok('a computed filter list read, a shadow\'s color with its parentheses', fl.length === 3 && fl[2].f === 'drop-shadow' && /^rgb\(255, 190, 92\) 0px 0px 3px$/.test(fl[2].v), fl);
var prims = _.svgPrims(fl, 0.5);
ok('as SVG primitives: each color filter its CSS matrix, a drop-shadow a feDropShadow at the canvas scale, its blur radius halved to a deviation',
   (prims.match(/<feColorMatrix type="matrix"/g) || []).length === 2 && /<feDropShadow dx="0" dy="0" stdDeviation="0.75" flood-color="rgb\(255,190,92\)" flood-opacity="1"\/>/.test(prims), prims);
ok('a blur: its radius is the deviation, at the scale', /<feGaussianBlur stdDeviation="3.3333"\/>/.test(_.svgPrims(_.filtersOf('blur(20px)'), 1 / 6)));
var bm = _.matrixOf('brightness', '0.82');
ok('brightness and saturate as CSS defines them', bm[0] === 0.82 && bm[6] === 0.82 && bm[12] === 0.82 && bm[18] === 1 &&
   near(_.matrixOf('saturate', '1.4')[0], 0.213 + 0.787 * 1.4), bm);
var hs = _.shadowOf('rgba(196, 210, 238, 0.6) 0px 0px 1.5px');
ok('a shadow read whichever comes first', hs.color === 'rgba(196, 210, 238, 0.6)' && hs.blur === 1.5 && _.shadowOf('0px 0px 8px 3px #edb25d66').spread === 3, hs);
var check = { unsupported: {} };
_.svgPrims(_.filtersOf('url(#x) blur(2px)'), 1, check);
ok('a filter it cannot draw is counted, not dropped quietly', check.unsupported['filter:url'] === 1, check.unsupported);

print('\n=== a 3D plane ===');
// the overcast ceiling's own matrix (perspective(1040px) rotateX(-62deg) about its bottom middle)
var M = { m11: 1, m12: 0, m14: 0, m21: 0, m22: 0.469472, m24: 0.000849, m41: 0, m42: 0, m44: 1 };
var h = _.homography(M), hi = _.inv3(h), p = _.project(M, 100, 200), back = _.unproject(hi, p[0], p[1]);
ok('a point projected and brought back is the same point', near(back[0], 100, 1e-6) && near(back[1], 200, 1e-6), back);
ok('a point behind the eye is no point', _.project({ m11: 1, m12: 0, m14: 0, m21: 0, m22: 1, m24: -1, m41: 0, m42: 0, m44: 0.5 }, 0, 10) === null);
var src = new Uint8ClampedArray(4 * 4 * 4).fill(255), dst = new Uint8ClampedArray(2 * 2 * 4);
_.layPlane(src, 4, 4, [0, 0, 4, 4], 1, _.inv3([1, 0, 0, 0, 1, 0, 0, 0, 1]), [1, 0, 0, 0, 1, 0, 0, 0, 1], dst, 2, 2, 0, 0);
ok('a flat plane laid by the inverse: the texture, as it is', dst[3] === 255 && dst[15] === 255, Array.from(dst));

print('\n=== the sky as it will be: a short fade read at its end ===');
globalThis.CSSTransition = function () {};
function fade(target, left, from, to, pseudo) {
  var an = Object.create(CSSTransition.prototype);
  an.playState = 'running'; an.currentTime = 1000;
  an.effect = { target: target, pseudoElement: pseudo || null, getComputedTiming: function () { return { endTime: 1000 + left }; },
                getKeyframes: function () { return [Object.assign({ offset: 0, computedOffset: 0, easing: 'linear', composite: 'auto' }, from),
                                                    Object.assign({ offset: 1, computedOffset: 1, easing: 'linear', composite: 'auto' }, to)]; } };
  return an;
}
var wash = { id: 'wash' }, stars = { id: 'stars' }, glow = { id: 'glow' };
var skyEl = { getAnimations: function (o) { return o && o.subtree ? [fade(wash, 900, { opacity: '0.1' }, { opacity: '0.72' }),
                                                                   fade(stars, 5600, { opacity: '0' }, { opacity: '1' }),
                                                                   fade(glow, 300, { opacity: '0' }, { opacity: '1' }, '::before')] : []; } };
var chk = { unsettled: 0, ahead: 0 }, ends = _.settling(skyEl, 5000, chk);
ok('a fade ending within the look-ahead is read at its end (the wash at its 0.72)', ends.get(wash) && ends.get(wash).opacity === '0.72', ends.get(wash));
ok('...the keyframe\'s own fields are not styles', ends.get(wash) && !('offset' in ends.get(wash)) && !('easing' in ends.get(wash)));
ok('...and how long it still runs is kept (the glass fades with it)', chk.ahead === 900, chk);
ok('a slower one is left as it is now, and counted (painted again once it ends)', !ends.has(stars) && chk.unsettled === 1, chk);
ok('a pseudo-element\'s fade is not an element\'s', !ends.has(glow));
var cs = { opacity: '0.1', filter: 'none', getPropertyValue: function (k) { return k === 'opacity' ? this.opacity : ''; } };
var se = _.asSettled(cs, ends.get(wash));
ok('a style at its end: the value faded to, the others as they are, methods still work',
   se.opacity === '0.72' && se.filter === 'none' && se.getPropertyValue('opacity') === '0.1');
ok('no getAnimations (an older browser): nothing read ahead', _.settling({}, 5000, { unsettled: 0, ahead: 0 }).size === 0);
delete globalThis.CSSTransition;

// UNDER A CAR DASHBOARD'S ZOOM (2026-10-13): the tree starts at the page's
// zoom, what is read off getBoundingClientRect is taken back into the page's
// units, the paint starts from the zoomed screen, and what is sized in CSS
// pixels (the look's blur) is drawn at k * Z -- or the picture was 1/Z too big
(function () {
  var g = readFile(HK_ROOT + '/frontend/modules/hk-skyshot.js');
  ok('zoom: the tree at Z, rect reads / Z, the paint from screen x Z, blur at k x Z',
     /var tree = node\(sky, null, new DOMMatrix\(\)\.scale\(Z, Z\)\)/.test(g) && /var Z = sky\.currentCSSZoom \|\| 1, kz = k \* Z;/.test(g) &&
     /\(a\.left - b\.left\) \/ Z/.test(g) && /\.scale\(c\.width \/ VP\.W, c\.height \/ VP\.H\)\.scale\(Z, Z\)/.test(g) && /svgPrims\(fl, kz, check\)/.test(g));
  var h = readFile(HK_ROOT + '/frontend/modules/hk-glass.js');
  ok('...and the glass: the picture as wide as the window in the page\'s units, pinned slices / zoom',
     /width:var\(--hk-vw,100vw\);height:var\(--hk-vh,100vh\)/.test(h) && /function sliceOf\(url, x, y, W, H, z\)/.test(h));
})();

print(fail ? '  ' + fail + ' SKYSHOT TESTS FAILED' : '  ALL ' + pass + ' SKYSHOT TESTS PASS');
if (fail) throw new Error(fail + ' failed');
