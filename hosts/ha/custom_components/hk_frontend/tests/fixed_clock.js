// A FIXED CLOCK for suites whose fixtures sit at "now ± a few hours": pinned to
// noon of today's date, so "3 hours ago" or "in 30 minutes" never crosses
// midnight into another day, whatever the real hour is. Load it FIRST (before
// dom.js), so every Date the suite and the cards make reads this clock.
// new Date() and Date.now() say noon; new Date(anything) is the real Date. A suite
// whose fixtures are of one day sets FIXED_DAY = [year, monthIndex, day] first.
(function () {
  var Real = Date, at = typeof FIXED_DAY !== 'undefined' ? new Real(FIXED_DAY[0], FIXED_DAY[1], FIXED_DAY[2]) : new Real();
  at.setHours(12, 0, 0, 0);
  var NOW = at.getTime();
  var Fixed = function () {
    var a = arguments;
    if (!(this instanceof Fixed)) return new Real(NOW).toString();
    return a.length ? new (Function.prototype.bind.apply(Real, [null].concat([].slice.call(a))))() : new Real(NOW);
  };
  Fixed.prototype = Real.prototype;
  Fixed.now = function () { return NOW; };
  Fixed.UTC = Real.UTC;
  Fixed.parse = Real.parse;
  Date = Fixed;
})();
