// @ts-check
// hk-people.js -- hk-people-card: the household at a glance (the Home Grid's `people` block, docs/phase11/HOME-GRID.md).
// Moved out of hk-home.js 2026-11-09 (mockup 13: Extra Large in two columns) when that file hit its size limit; the code is
// the same, a card of its own.
(function () {
  'use strict';
  if (window.hkPeople) return;                // double-load guard

  // hk-base.js is a Lovelace resource fetched in PARALLEL with this one: wait for its ready EVENT (never poll, see hk-home.js)
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-people] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  var HkBase = C.HkBase, register = C.register, esc = C.esc;
  window.hkPeople = { version: '1.0.0' };
  // ============================================================ THE PEOPLE
  // hk-people-card: the household at a glance (the Home Grid's `people`
  // block, docs/phase11/HOME-GRID.md; at home anywhere else too) -- each
  // person their picture or initials, ringed green at home, their name and
  // where they are; a tap opens their sheet (hk-person.js). As many as the
  // width holds, in `people:` order, else every person A to Z.
  //
  // AS A BLOCK (2026-10-31, the owner: "S new (faces, away dimmed, a line
  // saying who is where; fill the block); W spread evenly"; the mock-up's
  // Find My People): WHO'S HOME at the top left, then the faces, each in a
  // color of its own. Small: the faces as large as the block holds them,
  // those away dimmed, and one line under them -- "2 home · Robin at Work".
  // Wide: the faces spread evenly across, each with its name and where.
  var PP = { w: 72, gap: 12, av: 48, home: 'rgba(52,199,89,0.85)', g: 8, line: 19, lab: 19 };
  var FACE = ['orange', 'blue', 'purple', 'green', 'pink', 'teal', 'indigo', 'yellow'];
  // (where someone is, in words: Home, Away, or the zone's name)
  function whereOf(s) {
    return s.state === 'home' ? 'Home' : s.state === 'not_home' ? 'Away'
      : /^(unknown|unavailable)$/.test(s.state) ? 'Unknown' : String(s.state).replace(/(^|[\s_])(\w)/g, function (m, a, c) { return (a === '_' ? ' ' : a) + c.toUpperCase(); });
  }
  // THE FACES' GRID on a Small or Large block: the columns and rows that draw them largest in (w x h), each cell a
  // finger's 44 at least with `tx` px of words under its face, the face to `cap`; ties go to the fuller grid, and
  // with `one` (Small) a single row wins while its faces are 40 or more -- no 2 + 1 wrap; where there are words (Large) a grid with faces
  // down to 80 % of the largest wins if it fills the block more, rows weighing most (3 as 2 + 1, not a row in the middle of it), a full last row 1.8 times (4 as 2 x 2, 6 as 3 x 2, not 3 + 1 or 5 +
  // 1). When they cannot all fit,
  // as many as do, the last cell saying how many more. -> {c, f, fit}
  function faceGrid(n, w, h, tx, cap, one) {
    var best = null, all = [];
    for (var c = 1; c <= Math.max(1, n); c++) {
      var r = Math.ceil(n / c), cw = (w - (c - 1) * PP.g) / c, ch = (h - (r - 1) * PP.g) / r - tx, f = Math.min(cw, ch, cap);
      if (cw >= 44 && ch >= 44) all.push({ c: c, f: f, r: r, fit: n, box: c * f * r * (f + tx) * (tx && n > 2 && n % c === 0 ? 1.8 : 1) });
      if (one && c === n && cw >= 44 && ch >= 44 && f >= 40) return { c: c, f: f, fit: n };
    }
    var top = all.reduce(function (m, x) { return Math.max(m, x.f); }, 0);
    all.forEach(function (x) { if (x.f >= top * (tx ? 0.8 : 1) - 0.5 && (!best || x.box * (tx && n > 2 ? x.r : 1) >= best.box * (tx && n > 2 ? best.r : 1))) best = x; });
    if (best) return best;
    // (too many for the block: the most cells of 44 that it holds)
    var mc = Math.max(1, Math.floor((w + PP.g) / (44 + PP.g))), mr = Math.max(1, Math.floor((h + PP.g) / (44 + tx + PP.g)));
    return { c: mc, f: Math.min((w - (mc - 1) * PP.g) / mc, (h - (mr - 1) * PP.g) / mr - tx, cap), fit: mc * mr - 1 };
  }
  // (a grid of faces, its last row centered: the cells span two of twice the columns, the row's first one starts after the rest)
  function lastRow(i, t, c) { var m = t % c || c; return i === t - m && m < c ? 'grid-column:' + (c - m + 1) + '/span 2' : ''; }
  // (Tall's caption: how long they have been there -- the time today, else the weekday)
  function timeOf(s) {
    var t = s.last_changed ? new Date(s.last_changed) : null;
    return !t || isNaN(t.getTime()) ? '' : t.toDateString() === new Date().toDateString() ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) :
      t.toLocaleDateString([], { weekday: 'short' });
  }
  function sinceOf(s) { var x = timeOf(s); return x ? ' · ' + x : ''; }
  function firstOf1(st, id) { return String((st[id].attributes || {}).friendly_name || id).split(/\s+/)[0]; }
  class HkPeopleCard extends HkBase {
    // (a block's tap, hk-base.js openTarget) a person's sheet -- the first at home, else the first -- and from it
    // the others; a face in the block opens its own person
    _tapTarget() {
      var st = (this.client && this.client.states) || {}, ids = Object.keys(st).filter(function (id) { return id.indexOf('person.') === 0; });
      var home = ids.filter(function (id) { return st[id].state === 'home'; })[0] || ids[0];
      return home ? [{ sheet: home }] : [];
    }
    static get CSS() {
      return [
        'hk-plate.pp{display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;height:100%;',
        '  padding:' + C.blockPad(C.CARD.pad) + ';margin:0;' + C.plate('card') + ';overflow:hidden}',
        '.pp .row{display:grid;grid-template-columns:repeat(var(--n,4),minmax(' + PP.w + 'px,1fr));gap:0 ' + PP.gap + 'px;  justify-content:start}',
        '.pr{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;min-height:44px;margin:0;padding:0;',
        '  border:0;background:none;font:inherit;color:' + C.v('ink') + ';cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.pr:active{opacity:.6}',
        '.pr:focus-visible{outline:2px solid ' + C.v('ink-2') + ';outline-offset:4px;border-radius:' + C.R.small + 'px}',
        '.av{width:' + PP.av + 'px;height:' + PP.av + 'px;border-radius:50%;flex:none;overflow:hidden;display:flex;',
        '  align-items:center;justify-content:center;background:' + C.v('key-strong') + ';' + C.typeCss('headline') + ';',
        '  box-shadow:0 0 0 2px ' + C.v('line-strong') + '}',
        '.pr.home .av{box-shadow:0 0 0 2px ' + PP.home + '}',
        '.av img{width:100%;height:100%;object-fit:cover;display:block}',
        '.pr b{' + C.typeCss('body') + ';line-height:19px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.pr span{' + C.typeCss('caption') + ';line-height:16px;color:' + C.v('ink-2') + ';max-width:100%;  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // ---- THE BLOCK: the heading, then the faces in their own colors (no ring)
        ':host([size]) hk-plate.pp{justify-content:flex-start;padding:' + C.blockPad('14px') + '}',
        C.headRowCss('.pp .hd') + '.pp .hd{margin:0}' + C.headCss('.pp .lab'),
        '.pp .face{flex:none;width:var(--f);height:var(--f);border-radius:50%;overflow:hidden;display:grid;place-items:center;',
        '  font-size:calc(var(--f) * 0.38);font-weight:600;line-height:1;color:#fff;background:var(--fc,' + C.v('key-strong') + ')}',
        '.pp .face img{width:100%;height:100%;object-fit:cover;display:block}',
        '.pp .mo{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}',
        '.pp .mo .face{background:' + C.v('key-strong') + ';color:' + C.v('ink') + ';font-size:calc(var(--f) * 0.3)}',
        // (Small: a grid of faces filling what the heading and the line leave, those away dimmed)
        '.pp .fc{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:repeat(var(--c2),minmax(0,1fr));grid-auto-rows:minmax(0,1fr);',
        '  gap:' + PP.g + 'px;align-content:center;margin:' + PP.g + 'px 0}',
        '.pp .fc>*{grid-column:span 2}',
        '.pp .fc .pr,.pp .fc .mo{width:100%;height:100%;min-height:44px;justify-content:center}',
        '.pp .fc .away .face{opacity:.45}.pp .fc:not(.lg) .pr{cursor:inherit;pointer-events:none}',
        '.pp .line{flex:none;font-size:15px;line-height:' + PP.line + 'px;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // (Wide: spread evenly, each with its name and where, in the middle of what the heading leaves)
        '.pp .wide{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:' + PP.gap + 'px;align-content:center;align-items:center}',
        '.pp .wide .pr b,.pp .wide .mo b,.pp .lg .pr b,.pp .lg .mo b{font-size:15px;font-weight:600;line-height:19px;margin-top:2px}',
        '.pp .wide .pr span:not(.face),.pp .lg .pr span:not(.face){font-size:13px;line-height:16px}',
        // TALL AND LARGE (2026-11-07, the review): Tall a list, each person a row -- face 44, first name, where and since -- at a fixed
        // height (52; 56 on a square cell, 2026-11-08) and grouped on the middle of the block, never spread down it; Large the faces as large as the block holds them (to 88), name and where under
        // each
        '.pp .lst{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;justify-content:center;margin-top:' + PP.g + 'px}',
        '.pp .lst .pr{flex:none;height:var(--rh,52px);flex-direction:row;justify-content:flex-start;gap:12px;width:100%;text-align:left}',
        '.pp .lst .tx{display:flex;flex-direction:column;min-width:0}.pp .lst .tx b{' + C.typeCss('headline') + ';text-shadow:' + C.v('glow') + '}',
        '.pp .lst .tx span{' + C.typeCss('caption') + ';color:' + C.v('ink-2') + '}',
        // EXTRA LARGE IN TWO COLUMNS (2026-11-09, mockup 13): Home on the left -- one person large, two side by side, three or four in
        // a 2 x 2 -- Away on the right as 56 px rows (44 face, name over where, since at the right); the gap between is the block's inset
        '.pp .xl{flex:1 1 auto;min-height:0;display:flex;gap:var(--hk-pad-l,18px)}',
        '.pp .xc{display:flex;flex-direction:column;min-width:0;min-height:0}.pp .xh{flex:0 0 220px}.pp .xa{flex:1 1 auto}',
        '.pp .xs{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;',
        '  touch-action:pan-y;scrollbar-width:none}.pp .xs::-webkit-scrollbar{display:none}',
        '.pp .xs.more{-webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 56px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 56px),transparent)}',
        '.pp .xg{margin:auto 0;display:grid;grid-template-columns:repeat(var(--xc),minmax(0,1fr));gap:' + PP.g + 'px;justify-items:center}',
        '.pp .xf{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;min-width:0;min-height:56px;margin:0;padding:0;border:0;background:none;font:inherit;',
        '  color:' + C.v('ink') + ';cursor:pointer;-webkit-tap-highlight-color:transparent}.pp .xf:active,.pp .xw:active{opacity:.6}',
        '.pp .xf .face{margin-bottom:4px}',
        '.pp .xf b{' + C.typeCss('headline') + ';line-height:20px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.pp .xf.x1{gap:10px}.pp .xf.x1 b{font-size:22px;line-height:26px}.pp .xf.x1 .face{margin-bottom:0}',
        '.pp .xf span:not(.face){font-size:13px;line-height:16px;color:' + C.v('ink-2') + ';max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.pp .xf.x1 span:not(.face){font-size:15px;line-height:19px}',
        '.pp .xno{margin:auto 0;text-align:center;display:flex;flex-direction:column;gap:6px;color:' + C.v('ink') + '}',
        '.pp .xno b{' + C.typeCss('headline') + '}.pp .xno span{font-size:13px;line-height:16px;color:' + C.v('ink-2') + '}',
        '.pp .xw{display:flex;align-items:center;gap:12px;width:100%;height:56px;flex:none;margin:0;padding:0;border:0;border-bottom:1px solid rgba(255,255,255,.1);',
        '  background:none;font:inherit;color:' + C.v('ink') + ';text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}.pp .xw:last-child{border-bottom:0}',
        '.pp .xw .tx{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}',
        '.pp .xw .tx b{' + C.typeCss('headline') + ';line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.pp .xw .tx span,.pp .xw .sn{font-size:13px;line-height:16px;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.pp .xw .sn{flex:none;margin-left:auto}',
        // (the map: the person sheet's tiles and darkening, hk-person.js; the faces with a white ring, the house over those home)
        '.pp .xm{position:relative;overflow:hidden;border-radius:' + C.R.inner + 'px;background:#1b1d22;align-self:stretch}',
        '.pp .xt{position:absolute;inset:0;filter:invert(.92) hue-rotate(180deg) saturate(.35) brightness(1.05) contrast(.95)}',
        '.pp .xt img{position:absolute;width:256px;height:256px;max-width:none;pointer-events:none;-webkit-user-select:none;user-select:none}',
        '.pp .xp,.pp .xhm{position:absolute;transform:translate(-50%,-50%);pointer-events:none}',
        '.pp .xp .face{box-shadow:0 0 0 3px #fff,0 4px 12px rgba(0,0,0,.5)}',
        '.pp .xhm{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(28,28,32,.9);box-shadow:0 0 0 2px rgba(255,255,255,.7)}',
        '.pp .xhm hk-icon{width:18px;height:18px;--mdc-icon-size:18px;display:flex;color:#fff}',
        '.pp .xcr{position:absolute;right:8px;bottom:6px;font-size:11px;line-height:14px;color:rgba(255,255,255,.6);pointer-events:none}',
        '.pp .xmap .hd{flex:none}.pp .xmap .hd~.hd{margin-top:' + PP.g + 'px}',
        '.pp .mf{flex:none;margin-top:' + PP.g + 'px;' + C.typeCss('caption') + ';line-height:' + PP.line + 'px;color:' + C.v('ink-2') + '}'
      ].join('');
    }
    getCardSize() { return 2; }
    _ids() {
      var h = this.client, st = (h && h.states) || {}, own = this._config.people;
      if (Array.isArray(own) && own.length) return own.filter(function (id) { return st[id]; });
      var name = function (id) { return String((st[id].attributes || {}).friendly_name || id); };
      return Object.keys(st).filter(function (id) { return id.indexOf('person.') === 0; })
        .sort(function (a, b) { return name(a).localeCompare(name(b)); });
    }
    _sigOf() {
      var h = this.client;
      if (!h) return null;
      var map = !!this._config.map, z = h.states['zone.home'], at = function (a) { return a && isFinite(a.latitude) ? Number(a.latitude).toFixed(4) + ',' + Number(a.longitude).toFixed(4) : ''; };
      return this._ids().map(function (id) { var s = h.states[id]; return id + '=' + s.state + '/' + ((s.attributes || {}).entity_picture || '') + (map ? '@' + at(s.attributes) : ''); }).join(';') +
        (map ? '|' + at(z && z.attributes) : '') +
        '|' + (this._cellSize() || '') + '|' + (this._blockKey || '');
    }
    // ONE PERSON'S FACE on a block, as a button opening their sheet (the
    // caller closes it); on Small (2026-11-08, the controls audit) a plain face, the plate opens the sheet: their picture, else their initials, on their color
    _face(id, i, cls, sty) {
      var esc = C.esc, s = this.client.states[id], a = s.attributes || {}, nm = String(a.friendly_name || id);
      var ini = nm.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
      return (this._cellSize() === 'S' ? '<div class="pr' : '<button data-id="' + esc(id) + '" class="pr') + (cls ? ' ' + cls : '') + '"' + (sty ? ' style="' + sty + '"' : '') + ' aria-label="' +
        esc(nm + ', ' + whereOf(s)) + '">' +
        '<span class="face" style="--fc:' + C.ACCENTS[FACE[i % FACE.length]] + '">' +
        (a.entity_picture ? '<img alt="" data-initials="' + esc(ini) + '" src="' + esc(a.entity_picture) + '">' : esc(ini)) + '</span>';
    }
    // "2 home · Robin at Work": how many are home, and where the one away is
    _line(ids) {
      var st = this.client.states, first = function (id) { return String((st[id].attributes || {}).friendly_name || id).split(/\s+/)[0]; };
      var home = ids.filter(function (id) { return st[id].state === 'home'; }), away = ids.filter(function (id) { return st[id].state !== 'home'; });
      if (!away.length) return home.length === 1 ? first(home[0]) + ' is home' : 'Everyone home';
      if (!home.length && away.length > 1) return 'Nobody home';
      var w = whereOf(st[away[0]]);
      return (home.length ? home.length + ' home · ' : '') +
        (away.length === 1 ? first(away[0]) + (w === 'Away' || w === 'Unknown' ? ' away' : ' at ' + w) : away.length + ' away');
    }
    // EXTRA LARGE (2026-11-09, mockup 13): "Home" on the left, "Away" on the right. Everyone home: the right is "Arrived", latest
    // first. Nobody home: the left says so, and who left last. Each face or row opens that person, as a face does anywhere.
    _xl(ids) {
      var st = this.client.states, esc = C.esc, self = this;
      var home = ids.filter(function (id) { return st[id].state === 'home'; }), away = ids.filter(function (id) { return st[id].state !== 'home'; });
      var at = function (id) { var t = Date.parse(st[id].last_changed); return isNaN(t) ? 0 : t; };
      var hd = function (t) { return '<div class="hd"><b class="lab">' + t + '</b></div>'; };
      var av = function (id, f) {
        var a = st[id].attributes || {}, nm = String(a.friendly_name || id), ini = nm.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
        return '<span class="face" style="--f:' + f + 'px;--fc:' + C.ACCENTS[FACE[ids.indexOf(id) % FACE.length]] + '">' +
          (a.entity_picture ? '<img alt="" data-initials="' + esc(ini) + '" src="' + esc(a.entity_picture) + '">' : esc(ini)) + '</span>';
      };
      var lbl = function (id) { return ' data-id="' + esc(id) + '" aria-label="' + esc(String((st[id].attributes || {}).friendly_name || id) + ', ' + whereOf(st[id])) + '"'; };
      var left;
      if (home.length) {
        var n = home.length, f = n === 1 ? 116 : n === 2 ? 88 : 72;
        left = '<div class="xs"><div class="xg" role="list" style="--xc:' + (n === 1 ? 1 : 2) + '">' + home.map(function (id) {
          var t = timeOf(st[id]);
          return '<button class="xf' + (n === 1 ? ' x1' : '') + '"' + lbl(id) + '>' + av(id, f) + '<b>' + esc(firstOf1(st, id)) + '</b><span>' +
            esc(n === 1 ? (t ? 'Home since ' + t : 'Home') : t ? 'Since ' + t : 'Home') + '</span></button>';
        }).join('') + '</div></div>';
      } else if (away.length) {
        var last = away.slice().sort(function (a, b) { return at(b) - at(a); })[0], tl = timeOf(st[last]);
        left = '<div class="xno"><b>Nobody Home</b><span>' + esc(firstOf1(st, last) + (/\d:\d/.test(tl) ? ' left at ' + tl : tl ? ' left ' + tl : ' is away')) + '</span></div>';
      } else left = '<div class="xno"><span>Nobody added</span></div>';
      var all = !away.length && home.length, rows = (all ? home.slice().sort(function (a, b) { return at(b) - at(a); }) : away);
      var right = '<div class="xs">' + rows.map(function (id) {
        var t = timeOf(st[id]);
        return '<button class="xw"' + lbl(id) + '>' + av(id, 44) + '<span class="tx"><b>' + esc(firstOf1(st, id)) + '</b><span>' + esc(whereOf(st[id])) + '</span></span>' +
          (t ? '<span class="sn">' + (all ? '' : 'Since ') + esc(t) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
      return '<div class="xl"><div class="xc xh">' + hd('Home') + left + '</div><div class="xc xa">' + hd(all ? 'Arrived' : 'Away') + right + '</div></div>';
    }
    // EXTRA LARGE WITH THE MAP (2026-11-09, mockup 13b, the owner: "Would the Who's Home XL card look better with a map on the
    // left side showing the current locations"; Show Map, a block option, off by default -- a wall tablet would otherwise show
    // where everyone is to anyone in the room). The map is the person sheet's (hk-person.js): OpenStreetMap's tiles darkened to
    // the look, no map library. Each person with a location is their face on it, the house is marked and those home sit beside
    // it; the map fits everyone in sight -- the neighborhood when all are home. Everyone is listed on the right: Home, then Away
    // with the place, how far and since when (all home: Arrived, latest first). Someone with no location is in the list only.
    _xlMap(ids, iw, ih) {
      var h = this.client, st = h.states, esc = C.esc;
      var ll = function (a) { return a && isFinite(a.latitude) && isFinite(a.longitude) && (a.latitude || a.longitude) ? [Number(a.latitude), Number(a.longitude)] : null; };
      var zh = st['zone.home'], home = ll(zh && zh.attributes);
      var homeIds = ids.filter(function (id) { return st[id].state === 'home'; }), away = ids.filter(function (id) { return st[id].state !== 'home'; });
      if (!home) { var hp = homeIds.map(function (id) { return ll(st[id].attributes); }).filter(Boolean)[0]; home = hp || null; }
      var pts = away.map(function (id) { return { id: id, p: ll(st[id].attributes) }; }).filter(function (x) { return x.p; });
      // (no house and nobody located: the two columns without the map)
      if (!home && !pts.length) return this._xl(ids);
      var W = Math.round(Math.min(320, iw * 0.55)), H = Math.round(ih), T = 256, PAD = 30;
      var wx = function (p, z) { return (p[1] + 180) / 360 * T * Math.pow(2, z); };
      var wy = function (p, z) { var la = p[0] * Math.PI / 180; return (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * T * Math.pow(2, z); };
      var all = (home ? [home] : []).concat(pts.map(function (x) { return x.p; }));
      // (the closest zoom that holds everyone inside the padding; the neighborhood, 15, when only the house is on it)
      var z = 15;
      for (; z > 3; z--) {
        var xs = all.map(function (p) { return wx(p, z); }), ys = all.map(function (p) { return wy(p, z); });
        if (Math.max.apply(null, xs) - Math.min.apply(null, xs) <= W - 2 * PAD - 20 && Math.max.apply(null, ys) - Math.min.apply(null, ys) <= H - 2 * PAD - 20) break;
      }
      var X = all.map(function (p) { return wx(p, z); }), Y = all.map(function (p) { return wy(p, z); });
      var cx = (Math.max.apply(null, X) + Math.min.apply(null, X)) / 2, cy = (Math.max.apply(null, Y) + Math.min.apply(null, Y)) / 2;
      var ox = cx - W / 2, oy = cy - H / 2, n = Math.pow(2, z), tiles = '';
      for (var tx = Math.floor(ox / T); tx <= Math.floor((ox + W) / T); tx++) for (var ty = Math.floor(oy / T); ty <= Math.floor((oy + H) / T); ty++) {
        if (ty < 0 || ty >= n) continue;
        tiles += '<img alt="" src="https://tile.openstreetmap.org/' + z + '/' + (((tx % n) + n) % n) + '/' + ty + '.png" style="left:' + Math.round(tx * T - ox) + 'px;top:' + Math.round(ty * T - oy) +
          'px">';
      }
      var face = function (id, d) {
        var a = st[id].attributes || {}, nm = String(a.friendly_name || id), ini = nm.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
        return '<span class="face" style="--f:' + d + 'px;--fc:' + C.ACCENTS[FACE[ids.indexOf(id) % FACE.length]] + '">' +
          (a.entity_picture ? '<img alt="" data-initials="' + esc(ini) + '" src="' + esc(a.entity_picture) + '">' : esc(ini)) + '</span>';
      };
      var at = function (p) { return 'left:' + Math.round(wx(p, z) - ox) + 'px;top:' + Math.round(wy(p, z) - oy) + 'px'; };
      // (those home: beside the house, in an arc above it, the house drawn over them)
      var pins = pts.map(function (x) { return '<span class="xp" style="' + at(x.p) + '">' + face(x.id, 40) + '</span>'; }).join('');
      if (home) {
        var hx = wx(home, z) - ox, hy = wy(home, z) - oy, k = homeIds.length;
        pins += homeIds.map(function (id, i) {
          var ang = (k === 1 ? -45 : -150 + 120 * i / (k - 1)) * Math.PI / 180, r = 44;
          return '<span class="xp" style="left:' + Math.round(hx + r * Math.cos(ang)) + 'px;top:' + Math.round(hy + r * Math.sin(ang)) + 'px">' + face(id, 36) + '</span>';
        }).join('') + '<span class="xhm" style="left:' + Math.round(hx) + 'px;top:' + Math.round(hy) + 'px"><hk-icon icon="mdi:home"></hk-icon></span>';
      }
      // (how far from home, in the house's units -- the person sheet's words without "from home")
      var mi = !!(h.config && h.config.unit_system && h.config.unit_system.length === 'mi');
      var far = function (p) {
        if (!home || !p) return '';
        var R = 6371, r = Math.PI / 180, dl = (p[0] - home[0]) * r, dn = (p[1] - home[1]) * r;
        var q = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(home[0] * r) * Math.cos(p[0] * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
        var v = 2 * R * Math.asin(Math.sqrt(q)) * (mi ? 0.621371 : 1);
        return v < 0.1 ? '' : (v < 10 ? Math.round(v * 10) / 10 : Math.round(v)) + (mi ? ' mi' : ' km');
      };
      var lbl = function (id) { return ' data-id="' + esc(id) + '" aria-label="' + esc(String((st[id].attributes || {}).friendly_name || id) + ', ' + whereOf(st[id])) + '"'; };
      var atT = function (id) { var t = Date.parse(st[id].last_changed); return isNaN(t) ? 0 : t; };
      // (the place and how far under the name, the time at the right -- the rows of the two columns without the map)
      var row = function (id, words) {
        var t = timeOf(st[id]);
        return '<button class="xw"' + lbl(id) + '>' + face(id, 44) + '<span class="tx"><b>' + esc(firstOf1(st, id)) + '</b><span>' + esc(words) + '</span></span>' +
          (t ? '<span class="sn">' + esc(t) + '</span>' : '') + '</button>';
      };
      var hd = function (t) { return '<div class="hd"><b class="lab">' + t + '</b></div>'; };
      var homeRows = function (list) { return list.map(function (id) { return row(id, 'Home'); }).join(''); };
      var list = !away.length ? hd('Arrived') + homeRows(homeIds.slice().sort(function (a, b) { return atT(b) - atT(a); }))
        : (homeIds.length ? hd('Home') + homeRows(homeIds) : '') + hd('Away') + away.map(function (id) {
          return row(id, [whereOf(st[id]), far(ll(st[id].attributes))].filter(Boolean).join(' \u00b7 '));
        }).join('');
      return '<div class="xl"><div class="xm" style="flex:0 0 ' + W + 'px"><div class="xt">' + tiles + '</div>' + pins +
        '<span class="xcr">\u00a9 OpenStreetMap</span></div><div class="xc xa"><div class="xs xmap">' + list + '</div></div></div>';
    }
    _render() {
      var h = this.client;
      if (!h) return;
      this._watchBlock();
      var b = this._block(), ids = this._ids(), sz = this._cellSize();
      var esc = C.esc, self = this, html;
      if (sz) {
        // THE BLOCK: its room inside the inset (the cell's --hk-pad-*: 14 on a tile, 18 on a square cell)
        var cs = typeof getComputedStyle === 'function' ? getComputedStyle(/** @type {any} */ (this)) : null;
        var pad = function (k) { var x = cs ? parseFloat(cs.getPropertyValue('--hk-pad-' + k)) : NaN; return x >= 0 ? x : 14; };
        // (before the view has measured: a tile cell's block)
        var iw = b ? b.w - pad('l') - pad('r') : sz === 'W' ? 374 : 168, ih = b ? b.h - pad('t') - pad('b') : 122;
        if (sz === 'XL') {
          html = this._config.map ? this._xlMap(ids, iw, ih) : this._xl(ids);
        } else if (sz === 'S' || sz === 'L') {
          // (Small: the faces, one line under them. Large: the faces as large as fit, each with its name and where under it. Extra Large is two columns, _xl)
          var lg = sz !== 'S', gr = lg ? faceGrid(ids.length, iw, ih - PP.lab - 2 * PP.g, 46, 88) : faceGrid(ids.length, iw, ih - PP.lab - PP.line - 2 * PP.g, 0, 64, true);
          var fit = Math.min(ids.length, gr.fit), cutf = ids.length - fit, tot = fit + (cutf ? 1 : 0);
          html = '<div class="hd"><b class="lab">Who’s Home</b></div><div class="fc' + (lg ? ' lg' : '') + '" role="list" style="--c2:' + gr.c * 2 + ';--f:' + Math.floor(gr.f) + 'px">' +
            ids.slice(0, fit).map(function (id, i) {
              var s = h.states[id], nm = String((s.attributes || {}).friendly_name || id);
              return self._face(id, i, s.state === 'home' ? 'home' : 'away', lastRow(i, tot, gr.c)) +
                (lg ? '<b>' + esc(nm.split(/\s+/)[0]) + '</b><span>' + esc(whereOf(s)) + '</span>' : '') + (lg ? '</button>' : '</div>');
            }).join('') + (cutf ? '<span class="mo" style="' + lastRow(fit, tot, gr.c) + '" aria-label="' + cutf + ' more"><span class="face">+' + cutf + '</span>' + (lg ? '<b>More</b>' : '') +
              '</span>' : '') +
            '</div>' + (lg ? ids.length ? '' : '<div class="line">Nobody added</div>' : '<div class="line">' + esc(ids.length ? this._line(ids) : 'Nobody added') + '</div>');
        } else if (sz === 'T') {
          // (rows of 52, 56 on a square cell, a line for "N more" held back when some are cut)
          var rh = ih >= 340 ? 56 : 52, room = ih - PP.lab - PP.g, rows = Math.max(1, Math.floor(room / rh));
          if (ids.length > rows) rows = Math.max(1, Math.floor((room - PP.line - PP.g) / rh));
          html = '<div class="hd"><b class="lab">Who’s Home</b></div><div class="lst" role="list" style="--f:44px;--rh:' + rh + 'px">' + ids.slice(0, rows).map(function (id, i) {
            var s = h.states[id], nm = String((s.attributes || {}).friendly_name || id);
            return self._face(id, i, s.state === 'home' ? 'home' : '') + '<span class="tx"><b>' + esc(nm.split(/\s+/)[0]) + '</b><span>' + esc(whereOf(s) + sinceOf(s)) + '</span></span></button>';
          }).join('') + '</div>' + (ids.length > rows ? '<div class="mf">' + (ids.length - rows) + ' more</div>' : ids.length ? '' : '<span class="line">Nobody added</span>');
        } else {
          // (as many as the width holds, each at least 72 across; the face as large as the height leaves, to 64)
          var n = Math.max(1, Math.floor((iw + PP.gap) / (PP.w + PP.gap))), cut = ids.length > n ? n - 1 : ids.length;
          var f = Math.max(36, Math.min(64, ih - PP.lab - 19 - 16 - 6 - 2 * PP.g));
          html = '<div class="hd"><b class="lab">Who’s Home</b></div><div class="wide" role="list" style="--n:' + Math.max(1, Math.min(n, ids.length)) + ';--f:' + f + 'px">' +
            ids.slice(0, cut).map(function (id, i) {
              var s = h.states[id], nm = String((s.attributes || {}).friendly_name || id);
              return self._face(id, i, s.state === 'home' ? 'home' : '') + '<b>' + esc(nm.split(/\s+/)[0]) + '</b><span>' + esc(whereOf(s)) + '</span></button>';
            }).join('') + (ids.length > cut ? '<span class="mo" aria-label="' + (ids.length - cut) + ' more"><span class="face">+' + (ids.length - cut) + '</span><b>More</b></span>' : '') +
            (ids.length ? '' : '<span class="line">Nobody added</span>') + '</div>';
        }
        C.morph(this._root, '<hk-plate class="pp" data-hk-role="card">' + html + '</hk-plate>');
      } else {
        var n0 = b ? Math.max(1, Math.floor((b.w - 2 * C.CARD.x + PP.gap) / (PP.w + PP.gap))) : ids.length;
        var cells = ids.slice(0, n0).map(function (id) {
          var s = h.states[id], a = s.attributes || {}, nm = String(a.friendly_name || id);
          var ini = nm.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
          return '<button class="pr' + (s.state === 'home' ? ' home' : '') + '" data-id="' + esc(id) + '" aria-label="' +
            esc(nm + ', ' + whereOf(s)) + '"><span class="av">' + (a.entity_picture ? '<img alt="" data-initials="' + esc(ini) + '" src="' + esc(a.entity_picture) + '">' : esc(ini)) +
            '</span><b>' + esc(nm.split(/\s+/)[0]) + '</b><span>' + esc(whereOf(s)) + '</span></button>';
        });
        C.morph(this._root, '<hk-plate class="pp" data-hk-role="card"><div class="row" role="list" style="--n:' +
          Math.min(n0, Math.max(1, ids.length)) + '">' + cells.join('') + '</div></hk-plate>');
      }
      // (the lists scroll, a soft fade at the foot while more is below, as Now Playing's: .npql)
      this._root.querySelectorAll('.xs').forEach(function (l) {
        var m = function () { l.classList.toggle('more', l.scrollHeight - l.clientHeight - l.scrollTop > 4); };
        l.onscroll = m; m();
      });
      this._root.querySelectorAll('.av img, .face img').forEach(function (img) {
        // once (the browser's own error can follow the hand-made one, on an image no longer in the page)
        img.onerror = function () { img.onerror = null; if (img.parentNode) img.parentNode.textContent = img.getAttribute('data-initials'); };
        if (img.complete && !img.naturalWidth) img.onerror();
      });
      // (a map tile that will not load is left out, not the broken-picture glyph)
      this._root.querySelectorAll('.xt img').forEach(function (img) {
        img.onerror = function () { img.style.visibility = 'hidden'; };
        if (img.complete && !img.naturalWidth) img.onerror();
      });
      if (!this._wired) {
        this._wired = true;
        this._root.addEventListener('click', function (e) {
          var t = e.target.closest && e.target.closest('.pr[data-id], .xf, .xw');
          if (t) window.hkShell.moreInfo(t.getAttribute('data-id'), self);
        });
      }
    }
  }

  register('hk-people-card', HkPeopleCard, 'HK People',
    'The household at a glance: each person, at home or where they are. A tap opens their sheet.',
    C && [{ name: 'people', selector: { entity: { multiple: true, filter: { domain: 'person' } } } }],
    function () { return {}; });
  });
})();
