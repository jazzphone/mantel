// @ts-check
// hk-timeline.js -- the Timeline page: what happened at the house (docs/phase19/HOUSE-TIMELINE.md, "The views").
//
// hk-timeline-card: the whole page under its title bar. Mantel's own page: the server keeps a small table of what
// mattered (doors, locks, the garage, the alarm, arrivals, the doorbell, what the cameras saw, safety, Mantel's own
// alerts) and the page reads it back through the client, never from a host's object:
//
//   * the rows      client.callApi('GET', 'timeline?...')          newest first, in pages of 50 (`next_before`)
//   * the summary   client.callApi('GET', 'timeline/summary?...')  "Overnight" 5 to 11 AM, else "Today"
//   * the live feed client.subscriptions 'timeline/subscribe'      new rows, and a row's later end, count or pictures
//
// The host adapter (web/shim/mantel-host.js) answers the first two as same-origin reads and puts the page's prefix
// in front of a picture's address; a host with no Timeline (Home Assistant) never lists the page (hkShell.hostPage).
//
// WHAT IT SHOWS. Grouped by day ("Today", "Yesterday", a date) and, inside a day with more than a dozen rows, by
// the hour. A row: an icon by family, the title, the time, the room, who did it ("Emma · Hallway tablet"), a
// strip of the pictures kept, a warning tint, "While Mantel was off", "14 times, 2:10 to 2:40 AM". A tap opens the
// sheet: every picture (swipe between them), the exact time, where and how, and "Show All for <the door>".
// Filters: chips for the kinds, a search field, a day jump, Only Mine. Touch first: 44 px and up, nothing that
// shows on hover only (the owner's main device is an iPad on Safari, which reports itself as a Mac).
//
// THE PURE PART is first and has no DOM (window.hkTimeline.lib): tests/test_timeline_page.py runs it in node.
(function () {
  'use strict';

  // ======================================================================== pure: kinds and chips
  // The chips, in order: [id (the API's group), label, the raw families it holds]
  /** @type {Array<[string, string, string[]]>} */
  var GROUPS = [
    ['doors', 'Doors', ['door', 'window']], ['locks', 'Locks', ['lock']], ['garage', 'Garage', ['garage']],
    ['alarm', 'Alarm', ['alarm']], ['people', 'People', ['arrival']], ['doorbell', 'Doorbell', ['doorbell']],
    ['cameras', 'Cameras', ['detection', 'motion']], ['safety', 'Safety', ['safety']],
    ['system', 'System', ['system', 'refused']]
  ];
  var CAMERA_FAMILIES = { doorbell: 1, detection: 1, motion: 1 };
  var PAGE = 50;

  // the chips a viewer has: a group whose families the viewer could see at all (`families` is the server's
  // answer); never People on a wall tablet's limited view
  function visibleGroups(families, limited) {
    var have = {};
    (families || []).forEach(function (f) { have[f] = true; });
    return GROUPS.filter(function (g) {
      if (limited && g[0] === 'people') return false;
      return g[2].some(function (f) { return have[f]; });
    }).map(function (g) { return { id: g[0], label: g[1] }; });
  }
  function familiesOf(groupIds) {
    var out = {};
    GROUPS.forEach(function (g) { if (groupIds.indexOf(g[0]) >= 0) g[2].forEach(function (f) { out[f] = true; }); });
    return out;
  }

  // ---- the icon and the color of a row: HK's own glyphs (the notification look, hk_core/notifications/rules.py)
  function productName() {
    try { return (window.hkShell && window.hkShell.productName && window.hkShell.productName()) || 'the server'; } catch (e) { return 'the server'; }
  }
  function lookOf(ev) {
    var f = ev.family, k = ev.kind;
    if (k === 'flapping') return { icon: 'hk:alert-circle', color: 'orange' };
    if (f === 'door') return k === 'closed' ? { icon: 'hk:door-closed', color: 'gray' } : { icon: 'hk:door-open', color: 'orange' };
    if (f === 'window') return k === 'closed' ? { icon: 'hk:window-closed-variant', color: 'gray' } : { icon: 'hk:window-open-variant', color: 'orange' };
    if (f === 'lock') {
      if (k === 'jammed') return { icon: 'hk:alert-circle', color: 'red' };
      return k === 'locked' ? { icon: 'hk:lock', color: 'green' } : { icon: 'hk:lock-open-variant', color: 'orange' };
    }
    if (f === 'garage') return k === 'closed' ? { icon: 'hk:garage', color: 'gray' } : { icon: 'hk:garage-open', color: 'orange' };
    if (f === 'alarm') {
      if (k === 'triggered') return { icon: 'hk:shield-alert', color: 'red' };
      return k === 'disarmed' ? { icon: 'hk:shield-off', color: 'gray' } : { icon: 'hk:shield-home', color: 'red' };
    }
    if (f === 'arrival') return k === 'left' ? { icon: 'mdi:export', color: 'teal' } : { icon: 'hk:location-enter', color: 'green' };
    if (f === 'doorbell') return { icon: 'hk:doorbell-video', color: 'orange' };
    if (f === 'detection') {
      return { person: { icon: 'hk:walk', color: 'blue' }, vehicle: { icon: 'hk:car', color: 'blue' },
               animal: { icon: 'hk:paw', color: 'blue' }, package: { icon: 'hk:package-variant', color: 'brown' } }[k] ||
             { icon: 'hk:camera', color: 'blue' };
    }
    if (f === 'motion') return { icon: 'hk:motion-sensor', color: 'blue' };
    if (f === 'safety') {
      if (k === 'clear') return { icon: 'mdi:check-circle', color: 'green' };
      return { leak: { icon: 'hk:water-alert', color: 'red' }, smoke: { icon: 'hk:smoke-detector', color: 'red' },
               co: { icon: 'hk:molecule-co', color: 'red' }, gas: { icon: 'mdi:smoke', color: 'red' } }[k] ||
             { icon: 'hk:alert-circle', color: 'red' };
    }
    if (f === 'refused') return { icon: 'mdi:cancel', color: 'gray' };
    if (f === 'system') return { icon: 'hk:alert-circle', color: ev.level === 'warning' ? 'orange' : 'gray' };
    return { icon: 'hk:bell', color: 'gray' };
  }

  // ======================================================================== pure: words
  // WHO: "Emma · Hallway tablet", "Emma · away", "Through an assistant for Emma", "By hand or an automation";
  // null when the row says nothing about who
  function whoLine(who) {
    if (!who || typeof who !== 'object') return null;
    var name = who.name ? String(who.name) : '', device = who.device ? String(who.device) : '', out = null;
    switch (who.how) {
      case 'tablet': out = [name, device].filter(Boolean).join(' · ') || null; break;
      case 'home': out = name ? name + ' · home' : 'From home'; break;
      case 'away': out = name ? name + ' · away' : 'From away'; break;
      case 'ha_sidebar': out = name ? name + ' · Home Assistant' : 'Through Home Assistant'; break;
      case 'assistant': out = name ? 'Through an assistant for ' + name : 'Through an assistant'; break;
      case 'hand_or_automation': out = 'By hand or an automation'; break;
      default: out = [name, device].filter(Boolean).join(' · ') || null;
    }
    if (who.keypad) out = (out ? out + ' · ' : '') + 'Keypad: ' + String(who.keypad);
    return out;
  }

  // ======================================================================== pure: time
  // {tag, zone?, hour12?}: the house's language and time zone (hkLocale), or explicit ones in a test
  var FMT = {};
  function fmt(ctx, opts) {
    var o = Object.assign({}, opts);
    if (ctx && ctx.zone) o.timeZone = ctx.zone;
    if (ctx && ctx.hour12 !== undefined && o.hour !== undefined) o.hour12 = ctx.hour12;
    var tag = (ctx && ctx.tag) || 'en-US', key = tag + '|' + JSON.stringify(o);
    return FMT[key] || (FMT[key] = new Intl.DateTimeFormat(tag, o));
  }
  // the calendar fields of an instant in the zone
  function parts(ms, ctx) {
    var f = fmt({ tag: 'en-US', zone: ctx && ctx.zone },
                { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
    var o = {};
    f.formatToParts(ms).forEach(function (p) { o[p.type] = parseInt(p.value, 10); });
    return { y: o.year, m: o.month, d: o.day, h: (o.hour || 0) % 24, min: o.minute, s: o.second };
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function dayKey(ms, ctx) { var p = parts(ms, ctx); return keyOf(p.y, p.m, p.d); }
  function shiftKey(key, days) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key), t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
    return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  // WHERE THE NEXT DAY STARTS (epoch seconds), for a day key: the day jump shows everything up to the end of that day
  function dayEnd(key, ctx) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3] + 1, 0, 0, 0), t = guess;
    for (var i = 0; i < 4; i++) {
      var p = parts(t, ctx), off = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - t, want = guess - off;
      if (want === t) break;
      t = want;
    }
    return Math.floor(t / 1000);
  }
  function timeText(ms, ctx) { return fmt(ctx, { hour: 'numeric', minute: '2-digit' }).format(ms); }
  function hourText(ms, ctx) { return fmt(ctx, { hour: 'numeric' }).format(ms); }
  // "2:10 to 2:40 AM": the part of day said once when both ends share it
  function timeRange(a, b, ctx) {
    var f = fmt(ctx, { hour: 'numeric', minute: '2-digit' }), pa = f.formatToParts(a), pb = f.formatToParts(b);
    function period(ps) { var x = ps.filter(function (p) { return p.type === 'dayPeriod'; })[0]; return x ? x.value : ''; }
    var s = f.format(a), e = f.format(b), ra = period(pa), rb = period(pb);
    if (ra && ra === rb) s = pa.filter(function (p) { return p.type !== 'dayPeriod'; }).map(function (p) { return p.value; }).join('').replace(/[\s  ]+$/, '');
    return s + ' to ' + e;
  }
  function dayLabel(ms, nowMs, ctx) {
    var k = dayKey(ms, ctx), today = dayKey(nowMs, ctx);
    if (k === today) return 'Today';
    if (k === shiftKey(today, -1)) return 'Yesterday';
    var same = parts(ms, ctx).y === parts(nowMs, ctx).y;
    return fmt(ctx, same ? { weekday: 'long', month: 'long', day: 'numeric' }
                         : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(ms);
  }
  // a short date for the day jump's button: "Nov 1"
  function shortDay(key, ctx) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return '';
    return fmt({ tag: ctx && ctx.tag, zone: 'UTC' }, { month: 'short', day: 'numeric' }).format(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  }
  // "14 times, 2:10 to 2:40 AM", "2 packages"; null for a row with no count to say. A row that keeps changing says
  // its count in its title already: only when it was.
  function countLine(ev, ctx) {
    var n = typeof ev.count === 'number' ? ev.count : 0, end = ev.ended || ev.last || null;
    var range = end && end > ev.at + 1 ? timeRange(ev.at * 1000, end * 1000, ctx) : null;
    if (ev.kind === 'flapping' || ev.flapping) return range;
    if (n < 2) return null;
    var text = n + ' ' + (ev.kind === 'package' ? 'packages' : 'times');
    return range ? text + ', ' + range : text;
  }
  function exactTime(ms, ctx) {
    return fmt(ctx, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(ms);
  }

  // ======================================================================== pure: the list
  // Rows newest first by the time they happened (a row written late for "while Mantel was off" goes where it belongs)
  function byTime(a, b) { return (b.at - a.at) || (b.id - a.id); }
  function mergeEvents(list, incoming) {
    var at = {}, out = list.slice();
    out.forEach(function (e, i) { at[e.id] = i; });
    (incoming || []).forEach(function (e) {
      if (!e || e.id === undefined) return;
      if (at[e.id] !== undefined) out[at[e.id]] = e;
      else { at[e.id] = out.length; out.push(e); }
    });
    return out.sort(byTime);
  }
  // days, and the hours of a day with more than `busy` rows:
  //   [{key, label, count, items: [{type: 'hour', label} | {type: 'event', ev}]}]
  function groupEvents(events, nowMs, ctx, busy) {
    busy = busy || 12;
    var days = [], by = {};
    events.slice().sort(byTime).forEach(function (ev) {
      var ms = ev.at * 1000, k = dayKey(ms, ctx), d = by[k];
      if (!d) { d = by[k] = { key: k, label: dayLabel(ms, nowMs, ctx), events: [] }; days.push(d); }
      d.events.push(ev);
    });
    return days.map(function (d) {
      var items = [], hour = null, hourly = d.events.length > busy;
      d.events.forEach(function (ev) {
        if (hourly) {
          var h = parts(ev.at * 1000, ctx).h;
          if (h !== hour) { hour = h; items.push({ type: 'hour', label: hourText(ev.at * 1000, ctx) }); }
        }
        items.push({ type: 'event', ev: ev });
      });
      return { key: d.key, label: d.label, count: d.events.length, items: items };
    });
  }

  // ======================================================================== pure: filters and the query
  // f: {groups: [id], q, entity, camera: bool, name, day: 'YYYY-MM-DD', until: epoch s, mine: bool}
  function emptyFilters() { return { groups: [], q: '', entity: '', camera: false, name: '', day: '', until: null, mine: false }; }
  function filtersOn(f) { return !!(f.groups.length || f.q || f.entity || f.day || f.mine); }
  // the path the page reads, from the filters ("Doors" + a search + a day: family=doors&q=back&until=...)
  function queryPath(f, o) {
    o = o || {};
    var q = [];
    function add(k, v) { if (v !== '' && v !== null && v !== undefined) q.push(k + '=' + encodeURIComponent(v)); }
    add('family', f.groups.join(','));
    if (f.entity) add(f.camera ? 'camera' : 'entity', f.entity);
    add('q', String(f.q || '').trim());
    if (f.until) add('until', f.until);
    if (f.mine) add('mine', '1');
    add('before', o.before);
    add('limit', o.limit || PAGE);
    return 'timeline?' + q.join('&');
  }
  // the live feed's message: it filters by kind and by camera only; the rest the page does as rows come
  function subscribeMessage(f) {
    var m = { type: 'timeline/subscribe' };
    if (f.groups.length) m.family = f.groups.join(',');
    if (f.camera && f.entity) m.camera = f.entity;
    return m;
  }
  // does a row belong in what the filters show (for a row that arrives live)
  function matches(ev, f) {
    if (f.groups.length && !familiesOf(f.groups)[ev.family]) return false;
    if (f.entity && ev.entity !== f.entity) return false;
    if (f.mine && !(ev.who && ev.who.mine)) return false;
    var words = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      var hay = (String(ev.title || '') + ' ' + String(ev.area_name || '')).toLowerCase();
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
    }
    return true;
  }
  // the sheet's "Show all for ..." filter for a row: its camera or its door
  function showAllFilter(ev) {
    if (!ev.entity) return null;
    return { entity: ev.entity, camera: !!CAMERA_FAMILIES[ev.family] && String(ev.entity).indexOf('camera.') === 0 };
  }
  function kindWord(ev) {
    return CAMERA_FAMILIES[ev.family] ? 'Camera' : ev.family === 'lock' ? 'Lock' : ev.family === 'garage' ? 'Garage' :
           ev.family === 'alarm' ? 'Alarm' : ev.family === 'arrival' ? 'Person' : ev.family === 'safety' ? 'Sensor' : 'Door';
  }
  // the name of what a row is about, from the words the server wrote its title in (hk_core/timeline/words.py), for a
  // client that holds no state of that entity: "Someone rang Front Door", "Person at Driveway Cam", "Back Door
  // unlocked", "Front Door keeps changing (14 times)", "Mark arrived home"
  var VERBS = '(?:opened|closed|locked|unlocked|is jammed|jammed|keeps changing(?: \\(\\d+ times\\))?|armed [a-z ()]+|disarmed|triggered|arrived home|left home|is clear)';
  var TITLE_AT = /^(?:Person|Vehicle|Animal|Package|Motion|Leak|Smoke|Carbon monoxide|Gas) at (.+)$/;
  var TITLE_RANG = /^Someone rang (.+)$/;
  var TITLE_VERB = new RegExp('^(.+?) ' + VERBS + '$');
  function labelOf(ev) {
    var t = String(ev.title || ''), m;
    if (ev.family === 'system' || ev.family === 'refused') return '';
    if ((m = TITLE_RANG.exec(t)) || (m = TITLE_AT.exec(t)) || (m = TITLE_VERB.exec(t))) return m[1];
    return '';
  }
  function showAllLabel(ev, name) { return 'Show All for ' + (name ? name : 'This ' + kindWord(ev)); }

  // ======================================================================== pure: the summary card
  // Overnight from 5 to 11 AM (the digest's own window), else today so far
  function summaryWindow(nowMs, ctx) { var h = parts(nowMs, ctx).h; return h >= 5 && h < 11 ? 'overnight' : 'today'; }
  // the kinds' counts, by chip: [{label, n}]
  function countChips(counts) {
    counts = counts || {};
    var out = [];
    GROUPS.forEach(function (g) {
      var n = 0;
      g[2].forEach(function (f) { n += typeof counts[f] === 'number' ? counts[f] : 0; });
      if (n > 0) out.push({ label: g[1], n: n });
    });
    return out;
  }
  // {title, lines, chips}: the digest's own title and lines when it sent them; else the counts as chips under the
  // window's name; else one quiet line, so a silent house never reads as a broken page
  function summaryView(sum) {
    sum = sum && typeof sum === 'object' ? sum : {};
    var overnight = sum.window === 'overnight';
    var lines = (Array.isArray(sum.lines) ? sum.lines : []).map(function (l) {
      return typeof l === 'string' ? l : l && (l.text || l.line) ? String(l.text || l.line) : '';
    }).filter(Boolean);
    var chips = countChips(sum.counts), title = String(sum.title || sum.label || (overnight ? 'Overnight' : 'Today'));
    if (lines.length) return { title: title, lines: lines, chips: [] };
    if (sum.quiet || !chips.length) return { title: title, lines: [overnight ? 'A quiet night.' : 'Nothing has happened yet today.'], chips: [] };
    return { title: title, lines: [], chips: chips };
  }

  // ======================================================================== pure: the sheet's rows
  // [[label, value]] of what the sheet says besides its pictures
  function detailRows(ev, ctx, entityName) {
    var rows = [['Time', exactTime(ev.at * 1000, ctx)]], c = countLine(ev, ctx), w = whoLine(ev.who);
    if (ev.area_name) rows.push(['Where', ev.area_name]);
    if (entityName) rows.push([kindWord(ev), entityName]);
    if (ev.zone) rows.push(['Place', ev.zone]);
    if (w) rows.push([ev.who && ev.who.how === 'tablet' ? 'From' : 'How', w]);
    if (c) rows.push(['Happened', c]);
    if (ev.late) rows.push(['Note', 'Recorded when ' + productName() + ' started again: it was off at the time.']);
    if (ev.audit_id !== undefined && ev.audit_id !== null) rows.push(['Audit Log', '#' + ev.audit_id]);
    return rows;
  }

  // ---- the answers for an error
  function errorText(err) {
    var code = err && (err.code || err.error), status = err && err.status;
    if (code === 'forbidden' || status === 403) return { text: 'The Timeline isn’t part of this account. Ask an Owner if you need it.', retry: false };
    return { text: 'Couldn’t load the Timeline. Check the connection and try again.', retry: true };
  }

  var LIB = {
    GROUPS: GROUPS, PAGE: PAGE, visibleGroups: visibleGroups, familiesOf: familiesOf, lookOf: lookOf, whoLine: whoLine,
    parts: parts, dayKey: dayKey, shiftKey: shiftKey, dayEnd: dayEnd, timeText: timeText, hourText: hourText,
    timeRange: timeRange, dayLabel: dayLabel, shortDay: shortDay, countLine: countLine, exactTime: exactTime,
    byTime: byTime, mergeEvents: mergeEvents, groupEvents: groupEvents, emptyFilters: emptyFilters, filtersOn: filtersOn,
    queryPath: queryPath, subscribeMessage: subscribeMessage, matches: matches, showAllFilter: showAllFilter,
    showAllLabel: showAllLabel, labelOf: labelOf, kindWord: kindWord, summaryWindow: summaryWindow, countChips: countChips,
    summaryView: summaryView, detailRows: detailRows, errorText: errorText
  };
  window.hkTimeline = { version: '1.0.0', lib: LIB };

  // ======================================================================== the card
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-timeline] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkTimeline.card) return;                // double-load guard
  var HkBase = C.HkBase, M = C.M, register = C.register, esc = C.esc, v = C.v;

  var DEBOUNCE = 350;                                // a typed search: one read per pause
  var FRESH_MS = 60 * 1000;                          // a page left and come back to after this is read again
  var SUMMARY_MS = 5 * 60 * 1000;
  var NEAR_TOP = 140;                                // scrolled less than this: a new row goes in at once
  var SUM_LINES = 3;                                 // the summary's lines before "Show All"
  var KEEP = 600;                                    // rows held (older ones load again by scrolling)

  function ctxNow() {
    var L = window.hkLocale;
    try { return { tag: L ? L.tag() : 'en-US', zone: L ? L.zone() : undefined, hour12: L ? L.hour12() : undefined }; }
    catch (e) { return { tag: 'en-US' }; }
  }
  function tint(name, a) {
    var rgb = (C.PALETTE && C.PALETTE.chart && C.PALETTE.chart[name]) || (name === 'brown' ? [162, 132, 94] : [142, 142, 147]);
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }
  function inkOf(name) {
    var p = C.PALETTE && C.PALETTE.icon && C.PALETTE.icon[name];
    return p || (name === 'brown' ? 'rgb(162,132,94)' : 'rgba(200,200,200,0.85)');
  }
  function icon(name, size) { return '<hk-icon icon="' + esc(name) + '" style="--mdc-icon-size:' + size + 'px;width:' + size + 'px;height:' + size + 'px"></hk-icon>'; }

  var CSS = [
    ':host{display:block;color:' + v('ink') + '}',
    '[hidden]{display:none!important}',
    '.tl{display:flex;flex-direction:column;gap:18px;padding:4px 0 max(24px,calc(var(--hk-tabbar-h,0px) + 16px))}',
    'button{font:inherit;color:inherit}',

    // ---- the summary card: the digest's words, or what the counts say
    '.sum{border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border + ';box-shadow:var(--hk-look-shadow,' + v('glass-shadow-sm') + ');padding:16px 18px 16px}',
    '.sum .k{font-size:13px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:' + v('ink-2') + ';line-height:16px}',
    '.sum .ln{font-size:17px;font-weight:600;letter-spacing:-.2px;line-height:22px;margin-top:6px}',
    '.sum .ln + .ln{margin-top:2px}',
    '.sum .sm{display:block;height:44px;margin:2px -8px -10px;padding:0 8px;border:0;background:none;color:' + v('ink-2') + ';font-size:15px;font-weight:600;cursor:pointer}',
    '.sum .cn{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
    '.sum .cn span{height:28px;padding:0 12px;border-radius:14px;background:' + v('key') + ';font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;color:' + v('ink') + '}',
    '.sum .cn b{font-weight:700;font-variant-numeric:tabular-nums}',

    // ---- the filter bar
    '.bar{display:flex;flex-direction:column;gap:10px}',
    '.sr{display:flex;gap:10px;align-items:center}',
    '.sf{position:relative;flex:1;min-width:0;height:48px}',
    '.sf hk-icon{position:absolute;left:16px;top:50%;margin-top:-10px;color:' + v('ink-2') + ';pointer-events:none}',
    '.sf input{width:100%;height:48px;box-sizing:border-box;border-radius:24px;padding:0 44px 0 46px;background:var(--hk-field-bg,' + v('key-strong') + ');',
    '  box-shadow:var(--hk-field-shadow,none);border:' + M.border + ';color:' + v('ink') + ';font:inherit;font-size:17px;outline:none;-webkit-appearance:none;appearance:none}',
    '.sf input::placeholder{color:' + v('ink-3') + '}',
    '.sf input::-webkit-search-cancel-button{display:none}',
    '.sf .cl{position:absolute;right:2px;top:2px;width:44px;height:44px;border:0;border-radius:22px;background:none;color:' + v('ink-2') + ';display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer}',
    '.btn{height:48px;box-sizing:border-box;border:' + M.border + ';border-radius:24px;padding:0 18px;background:var(--hk-field-bg,' + v('key-strong') + ');color:' + v('ink') + ';font-size:15px;font-weight:600;',
    '  display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;white-space:nowrap;position:relative;flex:none;-webkit-tap-highlight-color:transparent}',
    '.btn:active{background:' + v('key-strong') + '}',
    '.btn.on{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + '}',
    // the day jump: a real date input laid over the button, so a tap opens the system's own picker (iPad included)
    '.day input{position:absolute;inset:0;width:100%;height:100%;opacity:0;border:0;padding:0;margin:0;font-size:16px;cursor:pointer;-webkit-appearance:none;appearance:none;min-width:0}',
    '.chips{display:flex;flex-wrap:wrap;gap:8px}',
    '.chip{height:44px;box-sizing:border-box;border:0;border-radius:22px;padding:0 18px;background:' + v('key') + ';color:' + v('ink') + ';font-size:15px;font-weight:600;cursor:pointer;',
    '  display:inline-flex;align-items:center;gap:8px;-webkit-tap-highlight-color:transparent;white-space:nowrap}',
    '.chip:active{background:' + v('key-strong') + '}',
    '.chip.on{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + '}',
    '.chip.pin{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + ';padding-right:10px}',
    '.chip.pin hk-icon{opacity:.7}',

    // ---- the list: a day is one plate, hairlines inside
    '.dh{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:6px 6px 8px 6px}',
    '.dh b{font-size:20px;font-weight:700;letter-spacing:-.3px;line-height:24px}',
    '.dh span{font-size:13px;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.day-g{margin-top:0}',
    '.plate{border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border + ';box-shadow:var(--hk-look-shadow,' + v('glass-shadow-sm') + ');overflow:hidden}',
    '.hh{padding:14px 16px 4px 16px;font-size:12px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:' + v('ink-3') + ';line-height:16px}',
    '.hh:first-child{padding-top:12px}',
    '.row{position:relative;display:flex;gap:12px;align-items:flex-start;min-height:60px;box-sizing:border-box;padding:10px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent;outline:none}',
    '.row + .row::before,.hh + .row::before{content:"";position:absolute;top:0;left:68px;right:0;height:1px;background:' + v('line') + '}',
    '.hh + .row::before{display:none}',
    '.row:active{background:' + v('key') + '}',
    '.row:focus-visible{box-shadow:inset 0 0 0 2px rgba(100,181,255,.8)}',
    '.row.warn{background:rgba(255,179,64,.10)}',
    '.row.warn:active{background:rgba(255,179,64,.18)}',
    '.ic{width:40px;height:40px;border-radius:20px;flex:none;display:flex;align-items:center;justify-content:center}',
    '.tx{flex:1;min-width:0;min-height:40px;display:flex;flex-direction:column;justify-content:center}',
    '.t1{display:flex;align-items:baseline;gap:12px}',
    '.ti{flex:1;min-width:0;font-size:16px;font-weight:600;letter-spacing:-.2px;line-height:22px;overflow-wrap:anywhere}',
    '.tm{flex:none;font-size:14px;line-height:22px;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.sb{font-size:13px;line-height:18px;color:' + v('ink-2') + ';margin-top:1px;overflow-wrap:anywhere}',
    '.sb.dim{color:' + v('ink-3') + '}',
    '.sb .w{color:' + v('warn') + '}',
    '.th{display:flex;gap:6px;margin-top:8px}',
    '.th img,.th .ph{width:64px;height:44px;border-radius:8px;object-fit:cover;background:' + v('key') + ';flex:none;display:block}',
    '.th .ph{display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:' + v('ink-2') + '}',

    // ---- the foot: more, and the ways the list can be empty
    '.more{display:flex;justify-content:center;padding:4px 0}',
    '.more .btn{min-width:160px}',
    '.end{text-align:center;font-size:13px;color:' + v('ink-3') + ';padding:8px 0 4px}',
    '.msg{border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border + ';box-shadow:var(--hk-look-shadow,' + v('glass-shadow-sm') + ');padding:28px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px}',
    '.msg .big{font-size:17px;font-weight:600;line-height:22px;max-width:420px}',
    '.msg .small{font-size:14px;line-height:20px;color:' + v('ink-2') + ';max-width:420px}',
    '.fresh{position:sticky;top:12px;z-index:3;align-self:center;height:44px;padding:0 20px;border:0;border-radius:22px;background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + ';font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25)}',

    // ---- loading
    '.sk{display:flex;gap:12px;padding:10px 16px;min-height:60px;box-sizing:border-box}',
    '.sk i{display:block;border-radius:8px;background:' + v('key') + '}',
    '.sk .a{width:40px;height:40px;border-radius:20px;flex:none}',
    '.sk .b{flex:1;display:flex;flex-direction:column;gap:8px;padding-top:3px}',
    '.sk .b i{height:14px}',
    '.sk .b i + i{width:46%;height:12px}',
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}',
    '.sks{animation:pulse 1.4s ease-in-out infinite}',
    '@media (prefers-reduced-motion:reduce){.sks{animation:none}}',

    // ---- a phone: the chips scroll along one line; the picture strip stays under the words
    '@media (max-width:640px){',
    '  .chips{flex-wrap:nowrap;overflow-x:auto;margin:0 -16px;padding:0 16px;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
    '  .chips::-webkit-scrollbar{display:none}',
    '  .chip{flex:none}',
    '  .btn .tx2{display:none}',
    '  .btn{padding:0;width:48px}',
    '  .btn.wide{width:auto;padding:0 16px}',
    '  .btn.wide .tx2{display:inline}',
    '}'
  ].join('');

  class HkTimelineCard extends HkBase {
    static get CSS() { return CSS; }
    getCardSize() { return 12; }

    setConfig(config) {
      // state first: the base draws at once
      this._f = emptyFilters();
      this._events = [];
      this._next = null;
      this._state = 'loading';                         // loading | ready | error
      this._err = null;
      this._meta = { names: false, limited: false, search: true, families: [] };
      this._more = false;                              // reading the next page
      this._pending = [];                              // live rows waiting for a tap while the page is scrolled
      this._summary = null;
      this._loadedAt = 0;
      this._seq = 0;
      this._started = false;
      super.setConfig(config || {});
    }

    // the page draws itself: the states of the house are not its data
    _sigOf() { return 'timeline'; }

    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this._started && Date.now() - this._loadedAt > FRESH_MS) this._reload(true);
      if (this._started) { this._subscribe(); this._loadSummary(); }
      else this._maybeStart();
      this._watchScroll();
    }
    // A PAGE BUILT AHEAD is not a page shown (Swipe Between Pages and the menu build pages before anyone opens them):
    // nothing is read and nothing followed until the page is on the screen. (Reading every generated screen's
    // Timeline at once, on each page load, kept the server and the socket busy: the screensaver checks timed out.)
    _shown() {
      if (!this.isConnected) return false;
      try {
        if (document.hidden) return false;
        // laid out is not enough: a page built ahead sits beside the one shown (Swipe Between Pages)
        var r = this.getBoundingClientRect(), w = window.innerWidth || 0, h = window.innerHeight || 0;
        return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < w && r.top < h;
      } catch (e) { return true; }
    }
    _maybeStart() {
      if (this._started || !this.client || !this._config) return;
      if (this._shown()) {
        this._started = true;
        if (this._seen) { this._seen.disconnect(); this._seen = null; }
        this._reload(false); this._loadSummary(); this._subscribe();
        return;
      }
      if (!this._seen && typeof IntersectionObserver === 'function') {
        var self = this;
        this._seen = new IntersectionObserver(function (es) {
          if (es.some(function (e) { return e.isIntersecting; })) self._maybeStart();
        });
        this._seen.observe(/** @type {Element} */ (/** @type {unknown} */ (this)));
      }
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      if (this._onScroll) { window.removeEventListener('scroll', this._onScroll); this._onScroll = null; }
      this._unsubscribe();
      clearTimeout(this._searchT);
      if (this._io) { this._io.disconnect(); this._io = null; }
      if (this._seen) { this._seen.disconnect(); this._seen = null; }
      this._closeSheet();
    }
    _receiveClient() {
      super._receiveClient();
      this._maybeStart();
    }

    // ------------------------------------------------------------ data
    _read(path) {
      var c = this.client;
      if (!c || typeof c.callApi !== 'function') return Promise.reject(Object.assign(new Error('no client'), { code: 'unavailable' }));
      try { return Promise.resolve(c.callApi('GET', path)); } catch (e) { return Promise.reject(e); }
    }
    _reload(quiet) {
      var seq = ++this._seq, self = this;
      this._pending = [];
      if (!quiet) { this._state = 'loading'; this._err = null; this._paint(); }
      this._read(queryPath(this._f, { limit: PAGE })).then(function (res) {
        if (seq !== self._seq) return;
        self._take(res || {});
        self._events = ((res && res.events) || []).slice().sort(byTime);
        self._next = res && res.next_before ? res.next_before : null;
        self._state = 'ready';
        self._err = null;
        self._loadedAt = Date.now();
        self._paint();
        self._arm();
      }, function (err) {
        if (seq !== self._seq) return;
        if (quiet && self._state === 'ready') return;                 // keep what is shown; the next try will do
        self._state = 'error';
        self._err = err;
        self._paint();
      });
    }
    _take(res) {
      this._meta = { names: !!res.names, limited: !!res.limited, search: res.search !== false, families: Array.isArray(res.families) ? res.families : this._meta.families };
    }
    _loadMore() {
      if (this._more || !this._next || this._state !== 'ready') return;
      var seq = this._seq, self = this;
      this._more = true;
      this._paint();
      this._read(queryPath(this._f, { before: this._next, limit: PAGE })).then(function (res) {
        if (seq !== self._seq) return;
        self._more = false;
        self._events = mergeEvents(self._events, (res && res.events) || []);
        if (self._events.length > KEEP) self._events = self._events.slice(0, KEEP);
        self._next = res && res.next_before ? res.next_before : null;
        self._moreErr = false;
        self._paint();
        self._arm();
      }, function () {
        if (seq !== self._seq) return;
        self._more = false;
        self._moreErr = true;
        self._paint();
      });
    }
    _loadSummary() {
      var self = this, now = Date.now(), win = summaryWindow(now, ctxNow());
      if (this._summaryAt && now - this._summaryAt < SUMMARY_MS && this._summaryWin === win) return;
      this._summaryAt = now;
      this._summaryWin = win;
      this._read('timeline/summary?window=' + win).then(function (res) {
        self._summary = res && typeof res === 'object' ? res : null;
        self._paintSummary();
      }, function () { /* no summary: the card is simply not there */ });
    }

    // ------------------------------------------------------------ the live feed
    _subscribe() {
      this._unsubscribe();
      var c = this.client, conn = c && c.subscriptions, self = this, token = this._subToken = (this._subToken || 0) + 1;
      if (!conn || typeof conn.subscribeMessage !== 'function') return;
      this._readyOnce = false;
      try {
        Promise.resolve(conn.subscribeMessage(function (ev) { if (token === self._subToken) self._live(ev); }, subscribeMessage(this._f)))
          .then(function (u) { if (token !== self._subToken) { try { u(); } catch (e) { /* gone */ } return; } self._unsub = u; },
                function () { /* no live feed here: the page still reads */ });
      } catch (e) { /* the same */ }
    }
    _unsubscribe() {
      this._subToken = (this._subToken || 0) + 1;
      var u = this._unsub;
      this._unsub = null;
      if (typeof u === 'function') { try { var r = u(); if (r && r.catch) r.catch(function () {}); } catch (e) { /* gone */ } }
    }
    _live(ev) {
      if (!ev) return;
      if (ev.ready) {
        // a socket that came back: what happened meanwhile is read again
        if (this._readyOnce && !this._f.until && this._state === 'ready') this._reload(true);
        this._readyOnce = true;
        return;
      }
      if (!Array.isArray(ev.events) || this._state !== 'ready' || this._f.until) return;
      var known = {}, fresh = [], again = [], self = this;
      this._events.forEach(function (e) { known[e.id] = true; });
      ev.events.forEach(function (e) {
        if (!e || e.id === undefined) return;
        if (known[e.id]) again.push(e);                                  // a later end, count or picture
        else if (matches(e, self._f)) fresh.push(e);
      });
      this._pending.forEach(function (p) { fresh.forEach(function (e, i) { if (e.id === p.id) fresh[i] = e; }); });
      if (again.length) this._events = mergeEvents(this._events, again);
      if (fresh.length) {
        var held = {};
        this._pending.forEach(function (p) { held[p.id] = true; });
        fresh.forEach(function (e) { if (!held[e.id]) self._pending.push(e); else self._pending = self._pending.map(function (p) { return p.id === e.id ? e : p; }); });
        if (!this._scrolled()) this._takePending();
      }
      this._paint();
    }
    _takePending() {
      if (!this._pending.length) return;
      this._events = mergeEvents(this._events, this._pending);
      this._pending = [];
    }
    _scrolled() { var s = document.scrollingElement; return !!s && s.scrollTop > NEAR_TOP; }
    // rows that came while the page was scrolled wait behind "N New Events"; back at the top they come in
    _watchScroll() {
      var self = this;
      if (this._onScroll) return;
      this._onScroll = function () { if (self._pending.length && !self._scrolled()) { self._takePending(); self._paint(); } };
      window.addEventListener('scroll', this._onScroll, { passive: true });
    }

    // ------------------------------------------------------------ the filters
    _setFilters(patch, how) {
      Object.assign(this._f, patch);
      this._reload(false);
      if (how !== 'q') this._subscribe();
    }
    _toggleGroup(id) {
      var g = this._f.groups.slice(), i = g.indexOf(id);
      if (i >= 0) g.splice(i, 1); else g.push(id);
      this._setFilters({ groups: g });
    }
    _clearFilters() { this._f = emptyFilters(); this._reload(false); this._subscribe(); }

    // ------------------------------------------------------------ the build
    _render() {
      if (!this._built) {
        this._built = true;
        this._root.innerHTML = '<div class="tl"><div class="sum" hidden></div><div class="bar"></div><div class="fresh-wrap"></div><div class="list"></div><div class="foot"></div></div>';
        this._root.addEventListener('click', this._onClick.bind(this));
        this._root.addEventListener('keydown', this._onKey.bind(this));
        this._root.addEventListener('input', this._onInput.bind(this));
        this._root.addEventListener('change', this._onChange.bind(this));
      }
      this._paint();
    }

    _paint() {
      if (!this._built) return;
      this._paintBar();
      this._paintSummary();
      this._paintList();
    }

    _paintSummary() {
      var el = this._root.querySelector('.sum');
      if (!el) return;
      var s = this._summary;
      if (!s || this._state === 'error' || this._meta.limited) { el.hidden = true; return; }
      var m = summaryView(s), shown = this._sumOpen ? m.lines : m.lines.slice(0, SUM_LINES), html = '<div class="k">' + esc(m.title) + '</div>' +
        shown.map(function (l) { return '<div class="ln">' + esc(l) + '</div>'; }).join('') +
        (m.lines.length > SUM_LINES ? '<button class="sm" data-act="sum" aria-expanded="' + (this._sumOpen ? 'true' : 'false') + '">' + (this._sumOpen ? 'Show Less' : 'Show All ' + m.lines.length) + '</button>' : '') +
        (m.chips.length ? '<div class="cn">' + m.chips.map(function (c) { return '<span>' + esc(c.label) + ' <b>' + c.n + '</b></span>'; }).join('') + '</div>' : '');
      el.hidden = false;
      C.morph(el, html);
    }

    _paintBar() {
      var bar = this._root.querySelector('.bar'), f = this._f, m = this._meta, ctx = ctxNow();
      if (this._state === 'loading' && !m.families.length) {
        // (before the first answer the bar is only the search field: nothing to guess the chips from)
        if (bar.firstChild) return;
      }
      var groups = visibleGroups(m.families, m.limited);
      // (morph keeps the search field's node, so a keyboard stays up while the list changes under it)
      var html = '<div class="sr">' +
        (m.search ? '<div class="sf">' + icon('mdi:magnify', 20) + '<input type="search" enterkeyhint="search" placeholder="Search" aria-label="Search the Timeline" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(f.q) + '">' +
                    '<button class="cl" data-act="clear-q" aria-label="Clear search"' + (f.q ? '' : ' hidden') + '>' + icon('mdi:close', 20) + '</button></div>' : '<div class="sf" style="visibility:hidden"></div>') +
        '<label class="btn day' + (f.day ? ' on wide' : '') + '" aria-label="Jump to a day">' + icon('mdi:calendar-month', 20) + '<span class="tx2">' + (f.day ? esc(shortDay(f.day, ctx)) : 'Day') + '</span>' +
          '<input type="date" data-act="day" value="' + esc(f.day) + '" max="' + esc(dayKey(Date.now(), ctx)) + '"></label>' +
        (f.day ? '<button class="btn wide" data-act="clear-day" aria-label="Show the latest again">' + icon('mdi:close', 18) + '<span class="tx2">Latest</span></button>' : '') +
        (m.names ? '<button class="btn' + (f.mine ? ' on' : '') + ' wide" data-act="mine" aria-pressed="' + (f.mine ? 'true' : 'false') + '">' + icon('mdi:account', 20) + '<span class="tx2">Only Mine</span></button>' : '') +
        '</div>' +
        '<div class="chips" role="group" aria-label="Kinds">' +
          '<button class="chip' + (f.groups.length ? '' : ' on') + '" data-act="all">All</button>' +
          groups.map(function (g) { return '<button class="chip' + (f.groups.indexOf(g.id) >= 0 ? ' on' : '') + '" data-act="group" data-id="' + esc(g.id) + '" aria-pressed="' + (f.groups.indexOf(g.id) >= 0 ? 'true' : 'false') + '">' + esc(g.label) + '</button>'; }).join('') +
          (f.entity ? '<button class="chip pin" data-act="clear-entity" aria-label="Show all again">' + esc(f.name || 'One') + icon('mdi:close', 18) + '</button>' : '') +
        '</div>';
      C.morph(bar, html);
      var inp = bar.querySelector('input[type=search]'), dayIn = bar.querySelector('input[type=date]');
      if (inp && f.q === '' && this.shadowRoot.activeElement !== inp) inp.value = '';
      if (dayIn && dayIn.value !== f.day) dayIn.value = f.day;
      var clr = bar.querySelector('[data-act="clear-q"]');
      if (clr) clr.hidden = !(inp && inp.value);
    }

    _paintList() {
      var list = this._root.querySelector('.list'), foot = this._root.querySelector('.foot'), wrap = this._root.querySelector('.fresh-wrap');
      var ctx = ctxNow(), self = this, f = this._f;
      wrap.innerHTML = this._pending.length && this._state === 'ready'
        ? '<div style="display:flex;justify-content:center"><button class="fresh" data-act="fresh">' + this._pending.length + (this._pending.length === 1 ? ' New Event' : ' New Events') + '</button></div>' : '';
      if (this._state === 'loading') {
        var sk = '';
        for (var i = 0; i < 7; i++) sk += '<div class="sk"><i class="a"></i><div class="b"><i></i><i></i></div></div>';
        // (it pulses only once the page is on the screen and reading: a page built ahead stays still)
        C.morph(list, '<div class="plate' + (this._started ? ' sks' : '') + '" aria-busy="true" aria-label="Loading">' + sk + '</div>');
        C.morph(foot, '');
        return;
      }
      if (this._state === 'error') {
        var e = errorText(this._err);
        C.morph(list, '<div class="msg" role="alert"><div class="big">' + esc(e.text) + '</div>' + (e.retry ? '<button class="btn wide" data-act="retry">Try Again</button>' : '') + '</div>');
        C.morph(foot, '');
        return;
      }
      if (!this._events.length) {
        C.morph(list, filtersOn(f)
          ? '<div class="msg"><div class="big">Nothing matches.</div><div class="small">Try other words, another kind, or another day.</div><button class="btn wide" data-act="reset">Clear Filters</button></div>'
          : '<div class="msg"><div class="big">Nothing yet. The timeline starts recording today.</div><div class="small">Doors, locks, the garage, the alarm, arrivals, the doorbell and what the cameras see will show up here.</div></div>');
        C.morph(foot, '');
        return;
      }
      var now = Date.now(), days = groupEvents(this._events, now, ctx), html = '';
      days.forEach(function (d) {
        html += '<div class="day-g" data-day="' + esc(d.key) + '"><div class="dh"><b>' + esc(d.label) + '</b><span>' + d.count + (d.count === 1 ? ' event' : ' events') + '</span></div><div class="plate">';
        d.items.forEach(function (it) { html += it.type === 'hour' ? '<div class="hh">' + esc(it.label) + '</div>' : self._row(it.ev, ctx); });
        html += '</div></div>';
      });
      C.morph(list, html);
      var tail = '';
      if (this._more) tail = '<div class="end">Loading…</div>';
      else if (this._next) tail = '<div class="more"><button class="btn wide" data-act="more">' + (this._moreErr ? 'Try Again' : 'Show More') + '</button></div>';
      else tail = '<div class="end">That’s all there is.</div>';
      C.morph(foot, tail);
    }

    _row(ev, ctx) {
      var look = lookOf(ev), warn = ev.level === 'warning', ms = ev.at * 1000;
      var who = whoLine(ev.who), cnt = countLine(ev, ctx);
      var meta = [];
      if (ev.area_name) meta.push(esc(ev.area_name));
      if (cnt) meta.push(esc(cnt));
      var html = '<div class="row' + (warn ? ' warn' : '') + '" role="button" tabindex="0" data-act="open" data-id="' + esc(ev.id) + '">' +
        '<div class="ic" style="background:' + tint(warn && look.color === 'gray' ? 'orange' : look.color, 0.22) + ';color:' + inkOf(warn && look.color === 'gray' ? 'orange' : look.color) + '">' + icon(look.icon, 22) + '</div>' +
        '<div class="tx"><div class="t1"><div class="ti">' + esc(ev.title) + '</div><div class="tm">' + esc(timeText(ms, ctx)) + '</div></div>';
      if (meta.length) html += '<div class="sb">' + meta.join(' · ') + '</div>';
      if (who) html += '<div class="sb">' + esc(who) + '</div>';
      if (ev.late) html += '<div class="sb dim"><span class="w">While ' + productName() + ' was off</span></div>';
      var pics = ev.pics || [];
      if (pics.length) {
        html += '<div class="th">' + pics.slice(0, 3).map(function (p) { return '<img src="' + esc(p.url) + '" alt="" loading="lazy" decoding="async" draggable="false">'; }).join('') +
          (pics.length > 3 ? '<div class="ph">+' + (pics.length - 3) + '</div>' : '') + '</div>';
      } else if (ev.pic_missing) {
        html += '<div class="sb dim">Picture not kept</div>';
      }
      return html + '</div></div>';
    }

    // ------------------------------------------------------------ taps
    _evOf(id) {
      for (var i = 0; i < this._events.length; i++) if (String(this._events[i].id) === String(id)) return this._events[i];
      return null;
    }
    _onClick(e) {
      var t = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!t || t.tagName === 'INPUT') return;
      this._act(t.getAttribute('data-act'), t);
    }
    _onKey(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var t = e.target;
      if (!t || t.getAttribute('data-act') !== 'open') return;
      e.preventDefault();
      this._act('open', t);
    }
    _onInput(e) {
      var t = e.target;
      if (!t || t.type !== 'search') return;
      var self = this, val = t.value, clr = this._root.querySelector('[data-act="clear-q"]');
      if (clr) clr.hidden = !val;
      clearTimeout(this._searchT);
      this._searchT = setTimeout(function () { if (self._f.q !== val) self._setFilters({ q: val }, 'q'); }, DEBOUNCE);
    }
    _onChange(e) {
      var t = e.target;
      if (!t || t.getAttribute('data-act') !== 'day') return;
      var key = String(t.value || ''), until = key ? dayEnd(key, ctxNow()) : null;
      this._setFilters({ day: key && until ? key : '', until: key && until ? until : null });
    }
    _act(act, el) {
      var f = this._f;
      if (act === 'open') { var ev = this._evOf(el.getAttribute('data-id')); if (ev) this._openSheet(ev); }
      else if (act === 'group') this._toggleGroup(el.getAttribute('data-id'));
      else if (act === 'all') { if (f.groups.length) this._setFilters({ groups: [] }); }
      else if (act === 'mine') this._setFilters({ mine: !f.mine });
      else if (act === 'clear-q') { var inp = this._root.querySelector('input[type=search]'); if (inp) { inp.value = ''; inp.focus(); } clearTimeout(this._searchT); this._setFilters({ q: '' }, 'q'); }
      else if (act === 'clear-day') this._setFilters({ day: '', until: null });
      else if (act === 'clear-entity') this._setFilters({ entity: '', camera: false, name: '' });
      else if (act === 'more') { this._moreErr = false; this._loadMore(); }
      else if (act === 'retry') this._reload(false);
      else if (act === 'reset') { var q = this._root.querySelector('input[type=search]'); if (q) q.value = ''; this._clearFilters(); }
      else if (act === 'sum') { this._sumOpen = !this._sumOpen; this._paintSummary(); }
      else if (act === 'fresh') { this._takePending(); this._paint(); try { window.scrollTo({ top: 0 }); } catch (e) { /* no scrolling here */ } }
    }
    // more rows as the foot comes into view
    _arm() {
      var foot = this._root.querySelector('.more');
      if (this._io) { this._io.disconnect(); this._io = null; }
      if (!foot || typeof IntersectionObserver === 'undefined') return;
      var self = this;
      this._io = new IntersectionObserver(function (es) {
        if (es.some(function (x) { return x.isIntersecting; }) && !self._moreErr) self._loadMore();
      }, { rootMargin: '600px 0px' });
      this._io.observe(foot);
    }

    // ------------------------------------------------------------ the sheet
    // what the row is about, by name: the house's own (the state, else the registry), else the title's
    _entityName(ev) {
      var c = this.client, st = c && c.states && ev.entity ? c.states[ev.entity] : null, en = c && c.entities && ev.entity ? c.entities[ev.entity] : null;
      if (st && st.attributes && st.attributes.friendly_name) return String(st.attributes.friendly_name);
      if (en && (en.name || en.original_name)) return String(en.name || en.original_name);
      return labelOf(ev);
    }
    // (o.noAll: no "Show All for ...": the camera sheet's strip, hk-timeline-block.js, is already about one camera)
    _openSheet(ev, o) {
      var self = this, ctx = ctxNow(), look = lookOf(ev), name = this._entityName(ev), all = o && o.noAll ? null : showAllFilter(ev);
      this._closeSheet();
      var root = document.createElement('div');
      root.id = 'hk-timeline-sheet';
      var pics = ev.pics || [];
      var rows = detailRows(ev, ctx, name).map(function (r) { return '<div class="r"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('');
      var warn = ev.level === 'warning';
      var col = warn && look.color === 'gray' ? 'orange' : look.color;
      root.innerHTML = '<style>' + SHEET_CSS + '</style><div class="bd" data-close></div>' +
        '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(ev.title) + '" tabindex="-1">' +
        '<div class="hd"><div class="well" style="background:' + tint(col, 0.24) + ';color:' + inkOf(col) + '">' + icon(look.icon, 24) + '</div>' +
        '<div class="tx"><div class="tt">' + esc(ev.title) + '</div><div class="st">' + esc(timeText(ev.at * 1000, ctx)) + (ev.area_name ? ' · ' + esc(ev.area_name) : '') + '</div></div>' +
        '<button class="x" data-close aria-label="Close">' + icon('mdi:close', 20) + '</button></div>' +
        '<div class="body">' +
        (pics.length ? '<div class="pw"><div class="pics">' + pics.map(function (p, i) {
          return '<div class="pic"><img src="' + esc(p.url) + '" alt="' + esc('Picture ' + (i + 1) + ' of ' + pics.length) + '" draggable="false"></div>';
        }).join('') + '</div>' + (pics.length > 1 ? '<button class="nv pv" data-nav="-1" aria-label="Previous picture" hidden>' + icon('mdi:chevron-left', 24) + '</button><button class="nv nx" data-nav="1" aria-label="Next picture">' + icon('mdi:chevron-right', 24) + '</button><div class="dots">' +
          pics.map(function (p, i) { return '<i' + (i ? '' : ' class="on"') + '></i>'; }).join('') + '</div>' : '') +
          '<div class="pt"></div></div>'
          : ev.pic_missing ? '<div class="nopic">' + icon('mdi:eye-off-outline', 22) + '<span>Picture not kept</span></div>' : '') +
        '<div class="rows">' + rows + '</div>' +
        (all ? '<button class="go" data-go>' + esc(showAllLabel(ev, name)) + '</button>' : '') +
        '</div></div>';
      this._sheet = root;
      var sh = window.hkShell, mount = (sh && sh.dialogRoot ? sh.dialogRoot() : null) || document.body;
      mount.appendChild(root);
      var sheet = /** @type {HTMLElement} */ (root.querySelector('.sheet')), strip = /** @type {HTMLElement} */ (root.querySelector('.pics'));
      this._sheetKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); self._closeSheet(); } };
      document.addEventListener('keydown', this._sheetKey, true);
      root.addEventListener('click', function (e) {
        var tg = /** @type {Element} */ (e.target), t = tg && tg.closest ? tg.closest('[data-close],[data-go],[data-nav]') : null;
        if (!t) return;
        if (t.hasAttribute('data-close')) self._closeSheet();
        else if (t.hasAttribute('data-go')) {
          self._closeSheet();
          self._setFilters({ entity: all.entity, camera: all.camera, name: name || ('This ' + kindWord(ev)) });
          try { window.scrollTo({ top: 0 }); } catch (x) { /* no scrolling here */ }
        } else if (strip) {
          var w = strip.clientWidth, i = Math.round(strip.scrollLeft / Math.max(1, w)) + Number(t.getAttribute('data-nav'));
          i = Math.max(0, Math.min(pics.length - 1, i));
          if (strip.scrollTo) strip.scrollTo({ left: i * w, behavior: 'smooth' }); else strip.scrollLeft = i * w;
        }
      });
      if (strip) {
        var stamp = function () {
          var w = Math.max(1, strip.clientWidth), i = Math.max(0, Math.min(pics.length - 1, Math.round(strip.scrollLeft / w)));
          root.querySelectorAll('.dots i').forEach(function (d, k) { d.className = k === i ? 'on' : ''; });
          var pv = /** @type {HTMLElement} */ (root.querySelector('.pv')), nx = /** @type {HTMLElement} */ (root.querySelector('.nx')), pt = root.querySelector('.pt');
          if (pv) pv.hidden = i === 0;
          if (nx) nx.hidden = i === pics.length - 1;
          if (pt) pt.textContent = pics.length > 1 ? timeText(pics[i].at * 1000, ctx) + ' · ' + (i + 1) + ' of ' + pics.length : timeText(pics[i].at * 1000, ctx);
        };
        strip.addEventListener('scroll', stamp, { passive: true });
        stamp();
      }
      requestAnimationFrame(function () { root.classList.add('open'); try { sheet.focus({ preventScroll: true }); } catch (e) { /* no focus */ } });
    }
    _closeSheet() {
      var root = this._sheet;
      if (!root) return;
      this._sheet = null;
      document.removeEventListener('keydown', this._sheetKey, true);
      root.classList.remove('open');
      setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 220);
    }
  }

  // THE SHEET: the detail sheets' material (hk-detail.js SHEET_CSS), made here -- it holds no entity
  var SHEET_CSS = [
    '#hk-timeline-sheet{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;pointer-events:none;color:' + v('ink') + ';',
    '  ' + C.FONT_ROOT + ';box-sizing:border-box;padding-left:max(var(--hk-content-left,0px),var(--hk-safe-left,env(safe-area-inset-left,0px)));padding-right:var(--hk-safe-right,env(safe-area-inset-right,0px));-webkit-tap-highlight-color:transparent}',
    '#hk-timeline-sheet .bd{position:absolute;inset:0;background:rgba(17,17,17,0.34);opacity:0;transition:opacity .3s ease;pointer-events:auto}',
    '#hk-timeline-sheet.open .bd{opacity:1}',
    '#hk-timeline-sheet .sheet{position:relative;box-sizing:border-box;pointer-events:auto;width:min(560px,calc(var(--hk-vw,100vw) - 32px));max-height:calc(var(--hk-vh,100dvh) - 32px);',
    '  display:flex;flex-direction:column;gap:16px;padding:20px;border-radius:30px;outline:none;',
    '  background:var(--hk-sheet-plate,rgba(28,28,32,0.52));-webkit-backdrop-filter:var(--hk-sheet-backdrop,blur(34px) saturate(1.9));backdrop-filter:var(--hk-sheet-backdrop,blur(34px) saturate(1.9));',
    '  border:var(--hk-sheet-edge,1px solid rgba(255,255,255,0.12));box-shadow:var(--hk-sheet-shadow,0 26px 64px rgba(0,0,0,0.55));overflow:hidden;',
    '  opacity:0;transform:translateY(24px) scale(.98);transition:opacity .25s ease,transform .3s cubic-bezier(.32,.72,0,1)}',
    '#hk-timeline-sheet.open .sheet{opacity:1;transform:none}',
    // a backing under the glass, so words behind it never show through where the blur is not drawn
    '#hk-timeline-sheet .sheet{isolation:isolate}',
    '#hk-timeline-sheet .sheet::before{content:"";position:absolute;inset:0;z-index:-1;background:rgba(18,18,22,0.8);pointer-events:none}',
    '#hk-timeline-sheet button{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}',
    '#hk-timeline-sheet .hd{display:flex;align-items:center;gap:14px;flex:none;min-height:44px}',
    '#hk-timeline-sheet .well{width:44px;height:44px;border-radius:22px;flex:none;display:flex;align-items:center;justify-content:center}',
    '#hk-timeline-sheet .tx{flex:1;min-width:0}',
    '#hk-timeline-sheet .tt{font-size:20px;font-weight:700;letter-spacing:-.35px;line-height:24px;overflow-wrap:anywhere}',
    '#hk-timeline-sheet .st{font-size:14px;line-height:18px;color:' + v('ink-2') + ';margin-top:1px}',
    '#hk-timeline-sheet .x{width:44px;height:44px;border-radius:22px;border:0;padding:0;flex:none;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,0.14);color:rgba(255,255,255,0.92)}',
    '#hk-timeline-sheet .x:active{background:rgba(255,255,255,0.26)}',
    '#hk-timeline-sheet .body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;display:flex;flex-direction:column;gap:16px}',
    '#hk-timeline-sheet .body::-webkit-scrollbar{display:none}',
    '#hk-timeline-sheet .pw{position:relative;flex:none}',
    '#hk-timeline-sheet .pics{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;border-radius:20px;background:#0b0d12;overscroll-behavior-x:contain}',
    '#hk-timeline-sheet .pics::-webkit-scrollbar{display:none}',
    '#hk-timeline-sheet .pic{flex:0 0 100%;scroll-snap-align:center;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center}',
    '#hk-timeline-sheet .pic img{width:100%;height:100%;object-fit:contain;display:block;-webkit-user-select:none;user-select:none}',
    '#hk-timeline-sheet .nv{position:absolute;top:calc(50% - 22px - 14px);width:44px;height:44px;border-radius:22px;border:0;padding:0;display:flex;align-items:center;justify-content:center;background:rgba(28,28,30,0.62);color:#fff;cursor:pointer}',
    '#hk-timeline-sheet .nv.pv{left:10px}#hk-timeline-sheet .nv.nx{right:10px}',
    '#hk-timeline-sheet .dots{position:absolute;left:0;right:0;bottom:36px;display:flex;justify-content:center;gap:6px;pointer-events:none}',
    '#hk-timeline-sheet .dots i{width:7px;height:7px;border-radius:4px;background:rgba(255,255,255,0.45)}',
    '#hk-timeline-sheet .dots i.on{background:#fff}',
    '#hk-timeline-sheet .pt{font-size:13px;line-height:18px;color:' + v('ink-2') + ';text-align:center;margin-top:8px;font-variant-numeric:tabular-nums}',
    '#hk-timeline-sheet .nopic{display:flex;align-items:center;gap:10px;justify-content:center;height:56px;border-radius:16px;background:' + v('key') + ';color:' + v('ink-2') + ';font-size:15px;font-weight:600;flex:none}',
    '#hk-timeline-sheet .rows{border-radius:20px;background:' + v('key') + ';flex:none}',
    '#hk-timeline-sheet .r{display:flex;gap:16px;align-items:baseline;justify-content:space-between;padding:12px 16px;min-height:44px;box-sizing:border-box}',
    '#hk-timeline-sheet .r + .r{border-top:1px solid ' + v('line') + '}',
    '#hk-timeline-sheet .r span{font-size:14px;line-height:20px;color:' + v('ink-2') + ';flex:none}',
    '#hk-timeline-sheet .r b{font-size:15px;font-weight:600;line-height:20px;text-align:right;min-width:0;overflow-wrap:anywhere}',
    '#hk-timeline-sheet .go{flex:none;height:52px;border:0;border-radius:26px;padding:0 20px;background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + ';font-size:16px;font-weight:600;cursor:pointer}',
    '#hk-timeline-sheet .go:active{opacity:.8}',
    '@media (max-width:640px){#hk-timeline-sheet .sheet{padding:18px;gap:14px;border-radius:30px}}',
    '@media (prefers-reduced-motion:reduce){#hk-timeline-sheet .bd,#hk-timeline-sheet .sheet{transition:none}}'
  ].join('');

  register('hk-timeline-card', HkTimelineCard, 'HK Timeline', 'What happened at the house: a searchable record of doors, locks, the alarm, arrivals and what the cameras saw.');
  // its own page's, never a card to add by hand
  if (C.unlisted) C.unlisted('hk-timeline-card');
  window.hkTimeline.card = HkTimelineCard;
  // A ROW'S SHEET FROM ELSEWHERE (the camera sheet's Recent strip, hk-timeline-block.js): the page's own sheet, opened by a
  // card that is never put on a page. The sheet belongs to that card; one at a time, as on the page.
  var ghost = null;
  window.hkTimeline.openSheet = function (ev, client, o) {
    if (!ev || typeof ev !== 'object') return false;
    if (!ghost) ghost = document.createElement('hk-timeline-card');
    if (client && typeof ghost.adopt === 'function') ghost.adopt(client);
    ghost._openSheet(ev, o);
    return true;
  };
  });
})();
