// hk-calendar-sheet.js - the add and edit sheet: its CSS, opening and closing, the delete question.
//
// PART OF THE CALENDAR CARDS (hk-calendar.js). Not a card and not run on its own: it registers one
// function, which hk-calendar.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkCalendarParts = window.hkCalendarParts || {})['hk-calendar-sheet'] = function (K) {
    var addDays = K.addDays, C = K.C, calName = K.calName, can = K.can, create = K.create, day0 = K.day0,
        DOW_LONG = K.DOW_LONG, esc = K.esc, evRgb = K.evRgb, hm = K.hm, IC = K.IC, MON = K.MON, MON3 = K.MON3,
        parseYmd = K.parseYmd, remove = K.remove, rgba = K.rgba, rgbOf = K.rgbOf, sameDay = K.sameDay, span = K.span,
        time = K.time, update = K.update, writable = K.writable, ymd = K.ymd;

    // ------------------------------------------------------------ the sheet
    // ONE SHEET, reused, on document.body (no card's overflow can clip it,
    // like hk-base's confirmSheet): an event shown, or the form that adds or
    // changes one. Its own shadow root, so nothing on the page styles it.
    var REPEATS = [['', 'Never'], ['FREQ=DAILY', 'Every Day'], ['FREQ=WEEKLY', 'Every Week'],
                   ['FREQ=MONTHLY', 'Every Month'], ['FREQ=YEARLY', 'Every Year']];
    var SHEET_CSS = [
      ':host{position:fixed;inset:0;z-index:9000;display:none;' + C.FONT_ROOT + ';  -webkit-tap-highlight-color:transparent}',
      ':host([open]){display:block}',
      '*{box-sizing:border-box;font-family:inherit}',
      '.back{position:absolute;inset:0;background:rgba(4,10,24,0.5)}',
      '.box{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 24px));',
      '  max-height:calc(var(--hk-vh,100vh) - 24px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;',
      '  border-radius:28px;border:1px solid rgba(255,255,255,0.14);background:rgba(24,24,28,0.93);color:' + window.hkCards.v('ink') +
        ';  box-shadow:0 30px 80px rgba(0,0,0,0.45);padding:0 20px 22px}',
      '.hd{display:flex;align-items:center;height:64px;position:sticky;top:0;background:linear-gradient(rgba(24,24,28,0.93),rgba(24,24,28,0.93)),rgba(24,24,28,0.93);z-index:1;margin:0 -20px;' +
        'padding:0 20px}',
      // the title riding on the form once it has scrolled (hk-base.js shade)
      C.shadeCss('.hd'),
      '.hd .t{flex:1;text-align:center;font-size:17px;font-weight:700}',
      'button{appearance:none;font:inherit;cursor:pointer;color:' + window.hkCards.v('ink') + '}',
      '.tb{height:40px;padding:0 14px;border:0;border-radius:20px;background:transparent;font-size:17px;font-weight:500;min-width:72px}',
      '.go{background:#fff;color:#1c1c1e;font-weight:700;padding:0 20px}',
      // a text button's words on the form's edge (the pill keeps its own)
      '.hd > .tb:first-child:not(.go){padding-left:0;text-align:left}',
      '.hd > .tb:last-child:not(.go){padding-right:0;text-align:right}',
      '.go[disabled]{opacity:0.4;cursor:default}',
      '.grp{border-radius:14px;background:rgba(255,255,255,0.08);margin-top:14px}',
      '.row{display:flex;align-items:center;min-height:52px;padding:0 16px;gap:10px}',
      '.row + .row{border-top:1px solid rgba(255,255,255,0.1)}',
      '.row .l{font-size:17px;flex:1}',
      'input,textarea,select{font:inherit;color:' + window.hkCards.v('ink') + ';background:transparent;border:0;outline:none}',
      'input::placeholder,textarea::placeholder{color:' + window.hkCards.v('ink-3') + '}',
      '.title{flex:1;font-size:19px;font-weight:600;height:52px}',
      '.loc{flex:1;font-size:17px;height:52px}',
      'textarea{width:100%;font-size:17px;resize:none;padding:14px 16px;min-height:76px;display:block;overflow-wrap:anywhere}',
      '.pick{height:36px;padding:0 10px;border-radius:10px;background:rgba(255,255,255,0.14);font-size:16px;color-scheme:dark}',
      'select.pick{padding:0 8px;max-width:240px}',
      'select option{color:#000}',
      '.sw{width:52px;height:32px;border-radius:16px;border:0;background:rgba(255,255,255,0.22);padding:2px;display:flex;transition:background .2s}',
      '.sw span{width:28px;height:28px;border-radius:14px;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,0.25);transition:transform .2s}',
      '.sw[aria-checked="true"]{background:#30d158}',
      '.sw[aria-checked="true"] span{transform:translateX(20px)}',
      '.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding:12px 16px}',
      '.chip{height:36px;padding:0 12px;border-radius:18px;border:0;background:rgba(255,255,255,0.1);font-size:14px;font-weight:600}',
      '.chip[aria-pressed="true"]{background:#fff;color:#1c1c1e}',
      '.dot{width:10px;height:10px;border-radius:5px;flex:none}',
      '.err{color:#ffb3ae;font-size:14px;font-weight:600;padding:12px 4px 0;display:none}',
      '.err[data-on]{display:block}',
      '.del{width:100%;margin-top:14px;height:48px;border-radius:14px;border:1px solid rgba(255,105,97,0.45);background:rgba(255,69,58,0.16);',
      '  color:#ffb3ae;font-size:17px;font-weight:600}',
      // the event, shown
      '.vw{padding:6px 0 0}',
      '.vw .cal{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:' + window.hkCards.v('ink-2') + '}',
      '.vw h2{margin:8px 0 0;font-size:26px;font-weight:700;letter-spacing:-0.3px;line-height:1.2;overflow-wrap:anywhere}',
      '.vw .ln{display:flex;align-items:flex-start;gap:10px;margin-top:12px;font-size:16px;line-height:1.35}',
      '.vw .ln svg{flex:none;margin-top:2px;opacity:0.85}',
      // A LONG WORD OR LINK (a FaceTime or Zoom link in the notes) breaks
      // where it must, rather than widening the sheet into a sideways scroll
      '.vw .ln span{min-width:0;overflow-wrap:anywhere}',
      '.vw .note{white-space:pre-wrap;color:' + window.hkCards.v('ink-2') + '}',
      '.acts{display:flex;gap:10px;margin-top:20px}',
      '.acts button{flex:1;height:48px;border-radius:24px;font-size:17px;font-weight:600}',
      '.acts .ed{border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.12)}',
      '.acts .rm{border:1px solid rgba(255,105,97,0.45);background:rgba(255,69,58,0.16);color:#ffb3ae}',
      '.ro{margin-top:16px;font-size:14px;color:' + window.hkCards.v('ink-2') + '}',
      '.pk{display:flex;gap:8px;margin-left:auto}',
      // a phone: the label over its date and time
      '@media (max-width:460px){.box{padding:0 14px 18px}.hd{margin:0 -14px;padding:0 14px}.dt{flex-wrap:wrap;padding:10px 16px;gap:8px}',
      '  .dt .l{flex-basis:100%}.dt .pk{margin-left:0;flex:1 1 100%;min-width:0}.dt .pick{flex:1 1 0;min-width:0;width:0}}'
    ].join('\n');

    var sheet = null;
    function sheetEl() {
      if (sheet) return sheet;
      var host = document.createElement('hk-calendar-sheet');
      var root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>' + SHEET_CSS + '</style><div class="back"></div>' +
        '<div class="box" role="dialog" aria-modal="true"></div>';
      document.body.appendChild(host);
      sheet = { host: host, root: root, box: root.querySelector('.box'), onKey: null };
      // (its header is drawn again with each view: found when it is needed)
      C.shade(sheet.box, function () { return sheet.box.querySelector('.hd'); }, { foot: true });
      root.querySelector('.back').addEventListener('click', function () { if (sheet.backdrop) closeSheet(); });
      return sheet;
    }
    function openSheet(label, backdrop) {
      var s = sheetEl();
      s.backdrop = backdrop;
      s.box.setAttribute('aria-label', label);
      s.host.setAttribute('open', '');
      if (!s.onKey) {
        s.onKey = function (e) { if (e.key === 'Escape' && sheet.host.hasAttribute('open')) { e.stopPropagation(); closeSheet(); } };
        document.addEventListener('keydown', s.onKey, true);
      }
      return s;
    }
    function closeSheet() {
      if (!sheet) return;
      sheet.host.removeAttribute('open');
      sheet.box.innerHTML = '';
      if (sheet.onKey) { document.removeEventListener('keydown', sheet.onKey, true); sheet.onKey = null; }
    }

    // AN EVENT, SHOWN: when, where, the notes, and Edit / Delete where the
    // calendar allows them.
    function show(client, ev) {
      // AN HK SHEET, the size of every other (hk-detail.js): this one stays
      // for the editor and for a screen without hk-detail
      if (window.hkDetail && customElements.get('hk-detail-event') && window.hkDetail.open(ev.cal, null, { event: ev })) return;
      var s = openSheet(ev.title, true), rgb = evRgb(ev, client);
      var day = ev.allDay ? '' : (sameDay(ev.start, new Date()) ? 'Today, ' : DOW_LONG[ev.start.getDay()] + ', ' +
                MON3[ev.start.getMonth()] + ' ' + ev.start.getDate() + ', ');
      var allDayWhen = ev.allDay ? DOW_LONG[ev.start.getDay()] + ', ' + MON[ev.start.getMonth()] + ' ' + ev.start.getDate() + ' · ' + span(ev) : '';
      var edit = can(client, ev.cal, 'update') && ev.uid, del = can(client, ev.cal, 'delete') && ev.uid;
      s.box.innerHTML =
        '<div class="hd"><span class="tb" aria-hidden="true"></span><div class="t">Event</div>' +
        '<button class="tb" data-a="close">Done</button></div>' +
        '<div class="vw"><div class="cal"><span class="dot" style="background:' + rgba(rgb, 1) + '"></span>' + esc(calName(client, ev.cal)) + '</div>' +
        '<h2>' + esc(ev.title) + '</h2>' +
        '<div class="ln">' + IC.clock + '<span>' + esc(ev.allDay ? allDayWhen : day + span(ev)) + '</span></div>' +
        (ev.rrule ? '<div class="ln">' + IC.repeat + '<span>' + esc(repeatLabel(ev.rrule)) + '</span></div>' : '') +
        (ev.loc ? '<div class="ln">' + IC.pin + '<span>' + esc(ev.loc) + '</span></div>' : '') +
        (ev.desc ? '<div class="ln">' + IC.notes + '<span class="note">' + esc(ev.desc) + '</span></div>' : '') +
        (edit || del ? '<div class="acts">' + (edit ? '<button class="ed" data-a="edit">Edit</button>' : '') +
                       (del ? '<button class="rm" data-a="del">Delete</button>' : '') + '</div>'
                     : '<div class="ro">Home Assistant can’t edit this calendar, so its events can’t be changed or deleted here.</div>') +
        '</div>';
      s.box.onclick = function (e) {
        var b = e.target.closest && e.target.closest('[data-a]');
        if (!b) return;
        var a = b.getAttribute('data-a');
        if (a === 'close') closeSheet();
        else if (a === 'edit') edit_(client, ev);
        else if (a === 'del') askDelete(client, ev, function () { closeSheet(); });
      };
    }
    function repeatLabel(r) {
      var hit = REPEATS.filter(function (x) { return x[0] && x[0] === r; })[0];
      if (hit) return hit[1];
      var f = /FREQ=([A-Z]+)/.exec(r || '');
      return f ? 'Repeats ' + f[1].toLowerCase() : 'Repeats';
    }
    // DELETE, asked first; an occurrence of a repeating event asks which.
    function askDelete(client, ev, done) {
      var go = function (scope) {
        remove(client, ev, scope).then(done, function (e) {
          C.confirmSheet('Couldn’t delete “' + ev.title + '”', function () {}, { detail: e.message, yes: 'OK', no: 'Close' });
        });
      };
      if (ev.rid) {
        C.chooseSheet('Delete “' + ev.title + '”?', [{ name: 'This Event Only', scope: '' },
          { name: 'This and Future Events', scope: 'THISANDFUTURE' }], function (o) { go(o.scope); });
      } else {
        C.confirmSheet('Delete “' + ev.title + '”?', function () { go(''); }, { yes: 'Delete', detail: span(ev) });
      }
    }

    // THE FORM: a new event (`ev` null; `seed` = {cal, start, end, allDay}) or
    // a change to one.
    function edit_(client, ev, seed) {
      var cals = writable(client);
      if (!ev && !cals.length) return;
      var isNew = !ev;
      var f = ev ? { cal: ev.cal, title: ev.title, loc: ev.loc, desc: ev.desc, allDay: ev.allDay, rrule: ev.rrule || '',
                     start: new Date(ev.start), end: ev.allDay ? addDays(ev.end, -1) : new Date(ev.end) }
                 : { cal: (seed && seed.cal && cals.indexOf(seed.cal) >= 0) ? seed.cal : cals[0], title: '', loc: '', desc: '',
                     allDay: !!(seed && seed.allDay), rrule: '', start: seed.start, end: seed.end };
      var origRule = f.rrule;
      var s = openSheet(isNew ? 'New Event' : 'Edit Event', false);
      var repeatOpts = REPEATS.slice();
      if (f.rrule && !REPEATS.some(function (r) { return r[0] === f.rrule; })) repeatOpts.push([f.rrule, repeatLabel(f.rrule)]);
      s.box.innerHTML =
        '<div class="hd"><button class="tb" data-a="cancel">Cancel</button><div class="t">' + (isNew ? 'New Event' : 'Edit Event') + '</div>' +
        '<button class="tb go" data-a="save">' + (isNew ? 'Add' : 'Save') + '</button></div>' +
        '<div class="grp"><label class="row"><span style="display:none">Title</span>' +
        '<input class="title" data-f="title" placeholder="Title" maxlength="200" aria-label="Title"></label>' +
        '<label class="row">' + IC.pin + '<input class="loc" data-f="loc" placeholder="Location" maxlength="200" aria-label="Location"></label></div>' +
        '<div class="grp"><div class="row"><span class="l" id="adl">All-day</span>' +
        '<button class="sw" role="switch" data-a="allday" aria-labelledby="adl"><span></span></button></div>' +
        '<div class="row dt"><span class="l">Starts</span><span class="pk"><input type="date" class="pick" data-f="sd" aria-label="Start date">' +
        '<input type="time" class="pick" data-f="st" step="300" aria-label="Start time"></span></div>' +
        '<div class="chips" data-f="chips"></div>' +
        '<div class="row dt"><span class="l">Ends</span><span class="pk"><input type="date" class="pick" data-f="ed" aria-label="End date">' +
        '<input type="time" class="pick" data-f="et" step="300" aria-label="End time"></span></div></div>' +
        '<div class="grp"><div class="row">' + IC.repeat + '<span class="l">Repeat</span><select class="pick" data-f="rrule" aria-label="Repeat">' +
        repeatOpts.map(function (r) { return '<option value="' + esc(r[0]) + '">' + esc(r[1]) + '</option>'; }).join('') + '</select></div>' +
        '<div class="row"><span class="dot" data-f="calDot"></span><span class="l">Calendar</span><select class="pick" data-f="cal" aria-label="Calendar"' +
        (isNew ? '' : ' disabled') + '>' + (isNew ? cals : [f.cal]).map(function (id) {
          return '<option value="' + esc(id) + '">' + esc(calName(client, id)) + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="grp"><textarea data-f="desc" rows="3" placeholder="Notes" maxlength="2000" aria-label="Notes"></textarea></div>' +
        '<div class="err" role="alert"></div>' +
        (isNew || !can(client, f.cal, 'delete') || !ev.uid ? '' : '<button class="del" data-a="del">Delete Event</button>');
      var q = function (k) { return s.box.querySelector('[data-f="' + k + '"]'); };
      var save = s.box.querySelector('[data-a="save"]'), err = s.box.querySelector('.err');
      q('title').value = f.title; q('loc').value = f.loc; q('desc').value = f.desc; q('rrule').value = f.rrule || '';
      q('cal').value = f.cal;
      function paintTimes() {
        q('sd').value = ymd(f.start); q('ed').value = ymd(f.end);
        q('st').value = hm(f.start); q('et').value = hm(f.end);
        ['st', 'et'].forEach(function (k) { q(k).style.display = f.allDay ? 'none' : ''; });
        s.box.querySelector('[data-a="allday"]').setAttribute('aria-checked', f.allDay ? 'true' : 'false');
        q('calDot').style.background = rgba(rgbOf(f.cal, client), 1);
        // QUICK TIMES around the start, every half hour
        var box = q('chips');
        box.style.display = f.allDay ? 'none' : '';
        if (!f.allDay) {
          var base = new Date(f.start); base.setMinutes(base.getMinutes() < 30 ? 0 : 30, 0, 0);
          var html = '';
          for (var i = -2; i <= 2; i++) {
            var t = new Date(+base + i * 1800000);
            if (!sameDay(t, f.start)) continue;
            html += '<button class="chip" data-a="quick" data-t="' + hm(t) + '" aria-pressed="' + (hm(t) === hm(f.start)) + '">' + time(t) + '</button>';
          }
          box.innerHTML = html;
        }
        save.disabled = !q('title').value.trim();
      }
      paintTimes();
      var dur = function () { return f.end - f.start; };
      function setStart(d) { var keep = Math.max(f.allDay ? 0 : 900000, dur()); f.start = d; f.end = new Date(+d + keep); paintTimes(); }
      function at(dateStr, timeStr, fallback) {
        var d = parseYmd(dateStr);
        if (!d) return fallback;
        var m = /^(\d{1,2}):(\d{2})/.exec(timeStr || '');
        if (m) d.setHours(+m[1], +m[2], 0, 0); else d.setHours(fallback.getHours(), fallback.getMinutes(), 0, 0);
        return d;
      }
      q('title').addEventListener('input', function () { save.disabled = !q('title').value.trim(); err.removeAttribute('data-on'); });
      q('sd').addEventListener('change', function () { setStart(at(q('sd').value, q('st').value, f.start)); });
      q('st').addEventListener('change', function () { setStart(at(q('sd').value, q('st').value, f.start)); });
      q('ed').addEventListener('change', function () { f.end = at(q('ed').value, q('et').value, f.end); paintTimes(); });
      q('et').addEventListener('change', function () { f.end = at(q('ed').value, q('et').value, f.end); paintTimes(); });
      q('cal').addEventListener('change', function () { f.cal = q('cal').value; paintTimes(); });
      s.box.onclick = function (e) {
        var b = e.target.closest && e.target.closest('[data-a]');
        if (!b) return;
        var a = b.getAttribute('data-a');
        if (a === 'cancel') closeSheet();
        else if (a === 'allday') {
          f.allDay = !f.allDay;
          if (f.allDay) { f.start = day0(f.start); f.end = day0(f.end < f.start ? f.start : f.end); }
          else {
            var s0 = new Date(f.start); s0.setHours(9, 0, 0, 0);
            f.start = s0; f.end = new Date(+s0 + 3600000);
          }
          paintTimes();
        } else if (a === 'quick') {
          var p = b.getAttribute('data-t').split(':'), d = new Date(f.start);
          d.setHours(+p[0], +p[1], 0, 0);
          setStart(d);
        } else if (a === 'del') {
          askDelete(client, ev, function () { closeSheet(); });
        } else if (a === 'save') {
          f.title = q('title').value.trim();
          f.loc = q('loc').value.trim();
          f.desc = q('desc').value.trim();
          f.rrule = q('rrule').value;
          if (!f.title) return;
          if (f.allDay ? day0(f.end) < day0(f.start) : f.end <= f.start) {
            err.textContent = 'It has to end after it starts.';
            err.setAttribute('data-on', '');
            return;
          }
          var finish = function () { closeSheet(); };
          var fail = function (x) { save.disabled = false; err.textContent = 'Couldn’t save: ' + x.message; err.setAttribute('data-on', ''); };
          save.disabled = true;
          if (isNew) { create(client, f.cal, f).then(finish, fail); return; }
          // an occurrence of a repeating event: this one, or this and the
          // ones after it (a change to the repeat itself is always the latter)
          if (ev.rid) {
            if (f.rrule !== origRule) { update(client, ev, f, 'THISANDFUTURE').then(finish, fail); return; }
            C.chooseSheet('Change “' + f.title + '”', [{ name: 'This Event Only', scope: '' },
              { name: 'This and Future Events', scope: 'THISANDFUTURE' }], function (o) {
              if (!o.scope) f.rrule = '';
              update(client, ev, f, o.scope).then(finish, fail);
            });
            save.disabled = false;
            return;
          }
          update(client, ev, f, '').then(finish, fail);
        }
      };
      setTimeout(function () { try { if (isNew) q('title').focus(); } catch (e) { /* ignore */ } }, 60);
    }
    // a new event at `start` (a day: the next hour today, else 9 AM)
    function newAt(client, start, allDay, cal) {
      var s0 = new Date(start);
      if (!allDay && s0.getHours() === 0 && s0.getMinutes() === 0) {
        var now = new Date();
        if (sameDay(s0, now)) { s0 = new Date(now); s0.setHours(now.getHours() + 1, 0, 0, 0); }
        else s0.setHours(9, 0, 0, 0);
      }
      edit_(client, null, { cal: cal, start: s0, end: allDay ? day0(s0) : new Date(+s0 + 3600000), allDay: !!allDay });
    }

    // what the shell and the later parts use of this one
    K.askDelete = askDelete; K.closeSheet = closeSheet; K.edit_ = edit_; K.newAt = newAt; K.repeatLabel = repeatLabel;
    K.show = show;
  };
})();
