// hk-charts bars(): the Y-gutter marks must never print over each other.
//
// Comparing ANCHOR LINES is not enough: the floor mark hangs from its bottom
// edge while the others hang from their top -- so a floor at y=38 and an
// average at y=24 are "14px apart" and print through each other (on a 38px
// temperature plot, "76.2" through "71°F"). This test renders real data
// through bars() and checks the placed label BOXES, which is what a reader
// sees.
var DIR = HK_ROOT + '/tests/';
load(DIR + 'dom.js');
load(HK_ROOT + '/frontend/modules/hk-charts.js');

var pass = 0, fail = 0;
function ok(n, got, want) {
  if (got === want) { pass++; print('  PASS  ' + n + '   ' + JSON.stringify(got)); }
  else { fail++; print('  FAIL  ' + n + '\n          got  ' + JSON.stringify(got) +
                       '\n          want ' + JSON.stringify(want)); }
}
var LH = 10.5;
// Pull every gutter mark back out of the markup as [top, text].
// Either anchor is read, so this measures the boxes whatever edge the chart
// chose to position them by -- which is what lets it catch an anchor-line
// comparison too.
function marks(html, plotH) {
  var out = [], re = /(top|bottom):(-?[\d.]+)px;">([^<]*)<\/div>/g, m;
  while ((m = re.exec(html))) {
    var v = Number(m[2]);
    out.push({ top: m[1] === 'top' ? v : plotH - v - LH, text: m[3] });
  }
  return out.filter(function (x) { return /\d/.test(x.text); });
}
function overlaps(ms) {
  var bad = [];
  for (var i = 0; i < ms.length; i++) for (var j = i + 1; j < ms.length; j++) {
    if (Math.abs(ms[i].top - ms[j].top) < LH) bad.push(ms[i].text + ' / ' + ms[j].text);
  }
  return bad;
}
function days(vs) {
  var t0 = new Date(2026, 8, 7);
  return vs.map(function (v, i) { return { t: new Date(t0.getTime() + i * 864e5), v: v }; });
}
var fmt = function (v) { return Math.round(v) + '°F'; };
var mean = function (v) { return v.toFixed(1); };

print('=== the overprint case: 7 days, 38px plot, baseline min ===');
// A real week: prior avg 76.2 sits just above the floor, current 80.2 near the top.
var d = days([74, 72, 75, 77, 82, 79, 82]);
var html = hkChart.bars(d, { split: 4, height: 38, baseline: 'min', fmtValue: fmt,
                             meanValues: [76.2, 80.2], fmtMean: mean });
var ms = marks(html, 38);
ok('no two labels overlap', overlaps(ms).join(', '), '');
ok('axis top is present', ms.some(function (m) { return m.text === '82°F'; }), true);
ok('axis floor is present', ms.some(function (m) { return /°F$/.test(m.text) && m.text !== '82°F'; }), true);
ok('floor sits flush with the plot bottom', ms.filter(function (m) { return m.text !== '82°F' && /°F$/.test(m.text); })[0].top, 38 + 1 - LH);

print('=== sweep: every average position in a short plot ===');
// Walk the prior average from the floor to the top; whatever gets kept or
// dropped, nothing kept may overprint.
var worst = '';
for (var pv = 71; pv <= 82; pv += 0.25) {
  for (var cv = 71; cv <= 82; cv += 0.5) {
    var h = hkChart.bars(d, { split: 4, height: 38, baseline: 'min', fmtValue: fmt,
                              meanValues: [pv, cv], fmtMean: mean });
    var o = overlaps(marks(h, 38));
    if (o.length && !worst) worst = pv + '/' + cv + ': ' + o.join(', ');
  }
}
ok('no overlap at any prior/current pair (38px)', worst, '');

print('=== sweep: the energy tiles\' 78px plot, zero baseline ===');
worst = '';
var e = days([110, 120, 130, 118, 125, 140, 90, 150, 100, 119, 121, 117, 130, 60]);
for (var a = 0; a <= 150; a += 1) {
  var h2 = hkChart.bars(e, { height: 78, fmtValue: function (v) { return Math.round(v) + ' kWh'; },
                             meanValues: [a, 150 - a], fmtMean: mean });
  var o2 = overlaps(marks(h2, 78));
  if (o2.length && !worst) worst = a + ': ' + o2.join(', ');
}
ok('no overlap at any average (78px)', worst, '');

print(fail ? ('  ' + fail + ' FAILED') : ('  ALL ' + pass + ' CHART MARK TESTS PASS'));
