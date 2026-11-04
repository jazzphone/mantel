// A big file that was cut into parts is still ONE source to these suites. Two kinds of shell have a list of their parts:
//
//   hk-detail.js          `var SHEETS = [...]`, the files of frontend/sheets/ (the panels, one per kind of device)
//   the files tools/split_js.py cut up (hk-grid-cards.js, ...)   `var PARTS = [...]`, the files of the folder named by
//                         the loader beside it ('/hk/<folder>/' + file)
//
// The suites were written when each was one file, and what each pins is the code as a whole, so this makes the shell's
// name mean that:
//
//   load('.../frontend/<dir>/<shell>.js')         loads the part files first (each registers a function the shell runs as
//                                                 it loads, as a browser's import() would leave it), then the shell
//   read/readFile('.../frontend/<dir>/<shell>.js')   answers the shell's text followed by every part file's
//
// Any other path is untouched. A shell is found by its text (the list and the loader's address), nothing is named here, so
// a file split later needs no change in this one. Loaded by tests/run into the prelude, after HK_ROOT. Not a suite.
(function () {
  'use strict';
  var realLoad = load, realRead = readFile, realReadShort = read, found = {};
  var LIST = /var (?:PARTS|SHEETS) = \[([^\]]*)\]/, FOLDER = /'\/hk\/([\w-]+)\/' \+ file/;
  // the part files of a shell (their paths), or null when the path is not a shell; kept per path
  function parts(p) {
    if (typeof p !== 'string' || p.slice(-3) !== '.js' || p.lastIndexOf('/frontend/') < 0) return null;
    if (found[p] !== undefined) return found[p];
    var out = null, text;
    try { text = realRead(p); } catch (e) { text = ''; }
    var list = LIST.exec(text), folder = FOLDER.exec(text);
    if (list && folder) {
      var root = p.slice(0, p.lastIndexOf('/frontend/'));
      out = (list[1].match(/'[^']+'/g) || []).map(function (q) { return root + '/frontend/' + folder[1] + '/' + q.slice(1, -1); });
    }
    found[p] = out;
    return out;
  }
  globalThis.load = function (p) {
    var files = parts(p);
    if (files) files.forEach(function (f) { realLoad(f); });
    return realLoad.apply(this, arguments);
  };
  function text(reader) {
    return function (p) {
      var shell = reader.apply(this, arguments), files = parts(p);
      if (!files || typeof shell !== 'string') return shell;
      return shell + '\n' + files.map(function (f) { return reader(f); }).join('\n');
    };
  }
  globalThis.readFile = text(realRead);
  globalThis.read = text(realReadShort);
})();
