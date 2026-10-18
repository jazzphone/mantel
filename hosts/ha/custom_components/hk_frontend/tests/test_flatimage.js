if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-flat-image.js');
var I = window.hkFlatImage, pass = 0;
function ok(name, cond) { if (!cond) throw new Error('FAIL ' + name); pass++; }
var sky = { flat_image_look: { mode: 'tinted', color: '#123456' }, flat_page_image_looks: { 'room-kitchen': { depth: 70 }, rooms: { fade: 55 } } };
var board = { sky_flat_image_look: { color: 'accent', strength: 90 }, sky_flat_page_image_looks: { rooms: { depth: 20, brightness: 10 } } };
var r = I.resolve(sky, board, ['room-kitchen', 'rooms']);
ok('specific global room beats general screen rooms', r.value.depth === 70 && r.from.depth.scope === 'house-page');
ok('fields inherit independently', r.value.fade === 55 && r.value.brightness === 10 && r.value.color === 'accent' && r.value.strength === 90);
board.sky_flat_page_image_looks['room-kitchen'] = { mode: 'original' };
ok('explicit Original stops inherited tinted mode', I.resolve(sky, board, ['room-kitchen', 'rooms']).value.mode === 'original');
ok('unrelated pages stay independent', I.resolve(sky, board, ['calendar']).value.depth === 40);
ok('old installations keep legacy behavior', I.resolve({}, null, []).value.mode === 'legacy');
var before = JSON.stringify([sky, board]); I.resolve(sky, board, ['room-kitchen']);
ok('resolution never manufactures overrides', before === JSON.stringify([sky, board]));
Object.keys(I.presets).forEach(function (key) {
  var look = Object.assign({}, I.defaults, I.presets[key]);
  ok('preset recognized ' + key, I.preset(look) === key);
  look.depth++; ok('adjusted preset becomes Custom ' + key, I.preset(look) === 'custom');
});
function look(ch) { return Object.assign({}, I.defaults, { mode: 'tinted' }, ch); }
var p = new Uint8ClampedArray([255, 0, 0, 255, 54, 54, 54, 128, 0, 0, 255, 255]);
I.pixels(p, look({ strength: 0 }), '#0080ff');
ok('Strength zero is grayscale, not original color', p[0] === p[1] && p[1] === p[2] && p[8] === p[9] && p[9] === p[10]);
ok('equal gray tones lose original hue', p[0] === p[4]);
ok('alpha preserved', p[7] === 128);
var neutral = I.table(look({ depth: 100 }), '#888888');
ok('neutral tint never gains chroma', neutral.every(function (c) { return c[0] === c[1] && c[1] === c[2]; }));
['#000000', '#ffffff', '#0080ff', '#ffff00', '#ffaaaa', '#00ff00', '#8000ff'].forEach(function (seed) {
  [0, 50, 100].forEach(function (depth) {
    var t = I.table(look({ depth: depth }), seed);
    ok('bounded and monotonic ' + seed + ' depth ' + depth, t.every(function (c, i) {
      return c.every(function (v, j) { return isFinite(v) && v >= 0 && v <= 255 && (!i || v >= t[i - 1][j]); });
    }));
  });
});
var original = I.table(look({ mode: 'original', brightness: 0 }), '#ff0000');
ok('Original at neutral brightness keeps every channel', original.every(function (c, i) { return c[0] === i; }));
var bright = I.table(look({ mode: 'original', brightness: 50 }), '#ff0000');
var dark = I.table(look({ mode: 'original', brightness: -50 }), '#ff0000');
ok('Brightness works in Original and preserves endpoints', bright[128][0] > 128 && dark[128][0] < 128 && bright[0][0] === 0 && dark[255][0] === 255);
ok('chosen color lightness matters', JSON.stringify(I.table(look(), '#000000')) !== JSON.stringify(I.table(look(), '#ffffff')));
var a = look(), b = look({ depth: 100 });
ok('Depth changes palette without editing other values', JSON.stringify(I.table(a, '#0080ff')) !== JSON.stringify(I.table(b, '#0080ff')) && a.strength === b.strength && a.brightness === b.brightness && a.fade === b.fade);
ok('new Fade endpoints are literal and theme aware', I.fade(0, 'light') === 'rgba(238,236,230,0.000)' && I.fade(100, 'dark') === 'rgba(10,11,12,1.000)');
print('ALL ' + pass + ' FLAT IMAGE TESTS PASS');
