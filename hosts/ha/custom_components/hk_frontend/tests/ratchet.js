// A RATCHET for a design family whose old values are too many to rename at
// once (font sizes, corners): today's values off the scale are recorded, by
// file, in a fixture; a test fails when a file gains one (a new drift), and
// says so when one goes (tighten the fixture with HK_UPDATE_SNAPSHOT=1).
// Not a suite (tests/run only runs test_*.js).
function hkRatchet(label, fixture, found, okFn) {
  var path = HK_ROOT + '/tests/fixtures/' + fixture, keys = Object.keys(found).sort(), snap = {};
  keys.forEach(function (k) { snap[k] = found[k]; });
  if (typeof HK_UPDATE_SNAPSHOT !== 'undefined' && HK_UPDATE_SNAPSHOT) {
    writeFile(path, JSON.stringify(snap, null, 1) + '\n');
    print('wrote ' + path + ': ' + keys.length + ' off-scale values');
    return;
  }
  var want = JSON.parse(read(path)), gone = [];
  keys.forEach(function (k) {
    okFn(label + ' ' + k + ' is on the scale or already recorded (' + (want[k] || 0) + ' allowed)', found[k] <= (want[k] || 0), found[k]);
  });
  Object.keys(want).forEach(function (k) { if (!found[k]) gone.push(k); });
  if (gone.length) print('  (' + gone.length + ' recorded ' + label + ' values are gone: tighten with HK_UPDATE_SNAPSHOT=1)');
}
