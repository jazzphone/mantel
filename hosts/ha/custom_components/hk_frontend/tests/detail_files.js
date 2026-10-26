// hk-detail.js is the sheet shell plus the files in frontend/sheets/ (the panels, one file per kind of
// device; the shell's SHEETS list names them, in the order they run). The suites were written when it was
// one file, and what each pins is the sheets' code as a whole, so this makes the two names mean that:
//
//   load('.../frontend/cards/hk-detail.js')      loads the sheet files first (each registers a function the
//                                                shell runs as it loads, as a browser's import() would leave it)
//   read/readFile('.../frontend/cards/hk-detail.js')   answers the shell's text followed by every sheet file's
//
// Any other path is untouched. Loaded by tests/run into the prelude, after HK_ROOT. Not a suite.
(function () {
  'use strict';
  var TAIL = '/frontend/cards/hk-detail.js', realLoad = load, realRead = readFile, realReadShort = read;
  function isShell(p) { return typeof p === 'string' && p.length > TAIL.length && p.slice(-TAIL.length) === TAIL; }
  function sheets(p) {
    var root = p.slice(0, p.length - TAIL.length);
    var list = /var SHEETS = \[([^\]]*)\]/.exec(realRead(p));
    if (!list) throw new Error('hk-detail.js has no SHEETS list');
    return (list[1].match(/'[^']+'/g) || []).map(function (q) { return root + '/frontend/sheets/' + q.slice(1, -1); });
  }
  globalThis.load = function (p) {
    if (isShell(p)) sheets(p).forEach(function (f) { realLoad(f); });
    return realLoad.apply(this, arguments);
  };
  function text(reader) {
    return function (p) {
      var shell = reader.apply(this, arguments);
      if (!isShell(p) || typeof shell !== 'string') return shell;
      return shell + '\n' + sheets(p).map(function (f) { return reader(f); }).join('\n');
    };
  }
  globalThis.readFile = text(realRead);
  globalThis.read = text(realReadShort);
})();
