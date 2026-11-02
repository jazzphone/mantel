// hk-saverpieces-people.js -- THE SCREENSAVER'S PEOPLE PIECE (2026-11-02, phase 13, phase 1b, wave B:
// docs/phase13/GLANCE-SPEC.md, "People"): who. One group, one file, loaded after hk-saverwidgets.js, which draws it: the piece is
// declared once (the plan's rule 1) with hkSaverWidgets.define() and drawn with the renderer's own classes and helpers (ring,
// inl, lines), so it looks like the core pieces in every backdrop, ink and size. This file keeps no CSS of its own: every
// figure is the renderer's, and the one picture sits inside the ring's box (100 box units = the circle).
//
//   who  (inline, circular, rectangular)
//        reads  person.* -- state `home`, `not_home` or a zone's name, friendly_name, entity_picture (as the side pane's People
//               card reads them, hk-sidepane.js). The server leaves person.* out without the Locations feature (rbac.py), so an
//               absent person is the signal, never "nobody home": no persons, or a state that is unknown or unavailable, is a dash.
//        inline "Everyone's home" / "Emma and Mark home" / "Nobody home" (a name is the first word of friendly_name)
//        circular  ONE person (opts.person, a person entity; none picked is the first person.* alphabetically): their initial,
//               or their picture as a round image, in a ring, and HOME, AWAY or the zone's name (short) on the label baseline
//        rectangular  HOME, who is home on the bold line, who is away (and where, for one in a named zone) under it
//        accent green while the one (or anyone) is home, gray while away.
//
// OFF UNTIL PLACED (SCREENSAVER-UNIFIED.md, decision 7 and rule 6): the declaration says `off: true`; the editor offers it, but
// no starter or default layout carries it.
//
// THE RULES: nothing animates and nothing blurs; one read (the states the screensaver already has), no timer, nothing that wakes
// anything; data that is not there is a dash.
(function () {
  'use strict';
  var W = window.hkSaverWidgets;
  if (!W || !W.define || !W._) return;
  if (window.hkSaverPiecesPeople) return;                       // loaded twice

  var _ = W._, esc = _.esc, cut = _.cut, ring = _.ring, inl = _.inl, lines = _.lines, DASH = _.DASH, ACC = _.ACC;
  var GRAY = ['#aeb4bd', '#6a7079'];                            // away: a quiet gray (light ink, black ink)

  // ------------------------------------------------------------ the people
  var APOS = '’';
  function title(s) { return s.replace(/(^|\s)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  // a person: { id, name (the first word of friendly_name; the id's words else), ini, st: home | away | null (unknown), zone, pic }
  function personOf(id, s) {
    var a = (s && s.attributes) || {}, full = String(a.friendly_name || '').replace(/\s+/g, ' ').trim();
    if (!full) full = title(id.slice(7).replace(/_/g, ' '));
    var name = full.split(' ')[0] || full, raw = s ? String(s.state == null ? '' : s.state) : '';
    var known = raw !== '' && raw !== 'unknown' && raw !== 'unavailable';
    var pic = typeof a.entity_picture === 'string' && /^(\/(?!\/)|https?:\/\/)/.test(a.entity_picture) ? a.entity_picture : '';
    return { id: id, name: name, ini: (name.charAt(0) || '?').toUpperCase(), pic: pic,
             st: !known ? null : raw === 'home' ? 'home' : 'away',
             zone: known && raw !== 'home' && raw !== 'not_home' ? raw.replace(/_/g, ' ') : '' };
  }
  // every person the house has told us of, by name
  function peopleOf(X) {
    var st = X.st || {};
    return Object.keys(st).filter(function (k) { return k.indexOf('person.') === 0; }).map(function (k) { return personOf(k, st[k]); })
      .sort(function (p, q) { return p.name < q.name ? -1 : p.name > q.name ? 1 : p.id < q.id ? -1 : p.id > q.id ? 1 : 0; });
  }
  // "Emma", "Emma and Mark", "Emma, Mark and Jo", "Emma, Mark and 2 more"
  function join(names) {
    var n = names.length;
    if (n <= 1) return names[0] || '';
    if (n === 2) return names[0] + ' and ' + names[1];
    if (n === 3) return names[0] + ', ' + names[1] + ' and ' + names[2];
    return names[0] + ', ' + names[1] + ' and ' + (n - 2) + ' more';
  }
  function names(list) { return list.map(function (p) { return p.name; }); }
  // the house in three lists, and what its state is: home while anyone is, away while all known are, else unknown
  function crowd(X) {
    var all = peopleOf(X), home = all.filter(function (p) { return p.st === 'home'; }), away = all.filter(function (p) { return p.st === 'away'; });
    var unknown = all.length - home.length - away.length;
    return { all: all, home: home, away: away, unknown: unknown, st: home.length ? 'home' : away.length && !unknown ? 'away' : null };
  }

  // ------------------------------------------------------------ the drawing
  var PERSON = '<svg class="a" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="7.8" r="3.7"/><path d="M4.8 20.2c0-4 3.2-6.6 7.2-6.6s7.2 2.6 7.2 6.6z"/></svg>';
  // the circular piece: the ring (full and in the accent while home, its track alone while away), the initial centered by its
  // caps -- or the picture as a round image in the ring's open middle (r 17 over the center line, clear of the label, the initial
  // behind it for a picture that does not load) -- and HOME, AWAY or the zone on the label baseline (72)
  function circle(s) {
    var svg = ring({ frac: s.st === 'home' ? 1 : null, main: s.main, sub: s.sub });
    if (!s.pic) return svg;
    return svg.replace(/<\/svg>$/, '<defs><clipPath id="hkswwho"><circle cx="50" cy="42" r="17"/></clipPath></defs>' +
      '<image href="' + esc(s.pic) + '" x="33" y="25" width="34" height="34" preserveAspectRatio="xMidYMid slice" clip-path="url(#hkswwho)"' +
      (s.st === 'home' ? '' : ' opacity=".55"') + '/></svg>');
  }
  function zoneWord(p) { return p.st === 'home' ? 'HOME' : p.zone ? cut(p.zone.toUpperCase(), 8) : 'AWAY'; }

  W.define('who', {
    name: 'Who' + APOS + 's Home', group: 'People', wave: 'B', facts: ['people'], source: 'person.*', when: null,
    wakes: ['house'], pick: null, off: true, opts: { person: 'entity:person' }, defaults: {},
    accent: function (s) { return s.st === 'home' ? ACC.green : s.st === 'away' ? GRAY : null; },
    shapes: {
      inline: {
        read: function (X) {
          var c = crowd(X), n = c.all.length;
          if (!n) return { text: DASH, st: null };
          if (c.home.length && !c.away.length && !c.unknown) {
            return { text: n === 1 ? c.home[0].name + APOS + 's home' : 'Everyone' + APOS + 's home', st: 'home', gl: 1 };
          }
          if (c.home.length) return { text: join(names(c.home)) + ' home', st: 'home', gl: 1 };
          if (c.unknown) return { text: DASH, st: null };
          return { text: 'Nobody home', st: 'away', gl: 1 };
        },
        draw: function (s) { return inl(s.gl ? PERSON : '', s.text); },
        text: function (s) { return s.text; },
        sample: { text: 'Emma and Mark home', st: 'home', gl: 1 }
      },
      circular: {
        // opts.person (a person.* entity); none picked is the first alphabetically. A person picked who is not in the house's
        // states is missing, not away: a dash
        read: function (X) {
          var all = peopleOf(X), id = X.opts && X.opts.person, p = null, i;
          if (id) { for (i = 0; i < all.length; i++) if (all[i].id === id) p = all[i]; }
          else if (all.length) {
            p = all.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; })[0];
          }
          if (!p) return { main: DASH, sub: 'HOME', st: null, pic: '' };
          if (p.st == null) return { main: p.ini, sub: DASH, st: null, pic: '' };
          return { main: p.ini, sub: zoneWord(p), st: p.st, pic: p.pic };
        },
        draw: circle,
        sample: { main: 'E', sub: 'HOME', st: 'home', pic: '' }
      },
      rectangular: {
        // HOME, who is home (bold), who is away under it
        read: function (X) {
          var c = crowd(X);
          if (!c.all.length) return { l1: 'HOME', l2: DASH, l3: '', st: null };
          var l2 = c.home.length ? join(names(c.home)) : c.unknown ? DASH : 'Nobody', l3;
          if (c.away.length === 1 && c.away[0].zone) l3 = c.away[0].name + ' at ' + title(c.away[0].zone);
          else if (c.away.length) l3 = join(names(c.away)) + ' away';
          else l3 = c.unknown ? '' : 'No one away';
          return { l1: 'HOME', l2: l2, l3: l3, st: c.st };
        },
        draw: function (s) { return lines(s.l1, s.l2, s.l3, !!s.st); },
        sample: { l1: 'HOME', l2: 'Emma and Mark', l3: 'Jo away', st: 'home' }
      }
    }
  });

  window.hkSaverPiecesPeople = true;
})();
