// hk-settings-screen-sleep.js - a screen's sleep screen and its rooms.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-screen-sleep'] = function (KIT) {
    var docsLink = KIT.docsLink, PN = KIT.PN, SLEEP_LISTS = KIT.SLEEP_LISTS;

    var K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // SLEEP SCREEN (2026-10-09; sleep_rules.py, sleep_engine.py): HOW the
      // tablet goes dark (Drawn By, While Dark), WHO decides when (an
      // automation, or HK Frontend), and -- HK Frontend deciding -- the rules:
      // the kiosk, the photos' time, quiet hours, presence and the lists, and
      // the brightness. Every write sends the whole Sleep Screen (the server
      // keeps no half of it).
      // WHOSE SLEEP SCREEN: a tablet's (1.14: x.tablet), else -- a screen
      // from before -- the screen's
      sleepCtx(x) {
        var self = this;
        if (x.tablet) {
          var tid = x.tablet;
          return { key: tid, base: '#/house/tablets/' + encodeURIComponent(tid) + '/sleep', err: 't:sleep',
                   set: function (ch) { return self.setT(tid, ch); } };
        }
        return { key: x.path, base: '#/screens/' + encodeURIComponent(x.path) + '/sleep', err: 'b:sleep',
                 set: function (ch) { return self.setB(x.path, ch); } };
      }

      s_sleep(c, x, b) {
        var self = this, ctx = this.sleepCtx(x), base = ctx.base, wide = this.hasAttribute('wide');
        var sl = b.sleep || {}, hk = sl.decided_by === 'hk' || sl.decided_by === 'shadow';
        var put = function (ch) { return ctx.set({ sleep: Object.assign({}, sl, ch) }); };
        var ids = (this.data.screensavers || {})[ctx.key] || {};
        var choices = (this.data.choices || {}).sleep || {};
        var mins = function (m) { return m < 60 ? m + ' min' : (m / 60) + (m === 60 ? ' hour' : ' hours'); };
        var secs = function (v) { return v === 0 ? 'None' : v < 60 ? v + ' s' : mins(v / 60); };
        c.appendChild(K.group({ header: 'Going Dark', footer: 'Drawn By: Kiosk Satellite puts its own Black screensaver up; ' + PN() +
          ' draws the black on this page and turns the backlight down itself, then fades back in with it (Kiosk Satellite’s is its fallback). ' +
            'While Dark: a display that is off has no glow at all, but a tap cannot wake it — the power button, the doorbell or somebody walking in can.' }, [
          K.seg({ label: 'Drawn By', sk: 'b:black_screen', stack: !wide, value: b.black_screen || 'kiosk',
                  options: [['kiosk', 'Kiosk Satellite'], ['hk', PN()]], onChange: function (v) { ctx.set({ black_screen: v }); } }),
          K.seg({ label: 'While Dark', sk: 'b:sleep.dark_display', stack: !wide, value: sl.dark_display || 'lowest',
                  options: [['lowest', 'Lowest Backlight'], ['off', 'Display Off'], ['off_quiet', 'Off in Quiet Hours']],
                  onChange: function (v) { put({ dark_display: v }); } })]));
        var sw = b.black_switch || ids.black, sens = ids.sleep;
        c.appendChild(K.group({ header: 'Decided By', footer: sl.decided_by === 'shadow'
            ? 'Trying it out: ' + PN() + ' decides by the rules below but does not act yet' + (sens ? ' — ' + sens + ' shows what it would do, and why.' : '.') + ' Choose ' + PN() + ' to let it.'
            : hk ? PN() + ' sleeps and wakes this tablet itself, by the rules below' + (sens ? ' — ' + sens + ' says what it decides, and why.' : '.')
            : 'An automation of yours decides: it turns ' + (sw || 'the tablet’s black screen switch') +
              ' on to sleep and off to wake — the Set black screen action also takes the brightness to wake to. Nothing here makes the tablet sleep by itself.' }, [
          K.seg({ label: 'Decided By', sk: 'b:sleep.decided_by', stack: !wide, value: hk ? 'hk' : 'automation',
                  options: [['automation', 'An Automation'], ['hk', PN()]], onChange: function (v) { put({ decided_by: v }); } })]));
        if (hk) {
          var ks = (this.data.choices || {}).kiosks || [];
          var kfoot = 'The tablet’s Kiosk Satellite: how ' + PN() +
            ' powers its display, sets its brightness, brings the dashboard back in front, and knows another app is in front (it then leaves the tablet alone).';
          if (x.tablet) {
            // the tablet's own Kiosk App and Device (its page's Setup)
            var kd = ks.filter(function (k) { return k.id === sl.kiosk; })[0];
            c.appendChild(K.group({ header: 'Kiosk', footer: kfoot + (kd ? '' : ' Choose it on the tablet’s page: Kiosk App, Kiosk Satellite, and its Device.') }, [
              K.nav({ label: 'Kiosk Satellite', value: kd ? kd.name : 'None', sk: 't:sleep.kiosk',
                      href: '#/house/tablets/' + encodeURIComponent(x.tablet) })]));
          } else {
            c.appendChild(K.group({ header: 'Kiosk', footer: kfoot }, [
              K.select({ label: 'Kiosk Satellite', sk: 'b:sleep.kiosk', value: sl.kiosk || '',
                         options: [['', 'None']].concat(ks.map(function (k) { return [k.id, k.name]; })),
                         onChange: function (v) { put({ kiosk: v }); } })]));
          }
          var after = (choices.after_saver || [0, 15, 30, 60, 120]).map(function (m) { return [m, m ? 'After ' + mins(m) : 'Never']; });
          var sched = [K.select({ label: 'After the Screensaver', sk: 'b:sleep.after_saver', value: sl.after_saver || 0, options: after,
                                  onChange: function (v) { put({ after_saver: Number(v) }); } }),
                       K.toggle({ label: 'Quiet Hours Schedule', sk: 'b:sleep.schedule', on: !!sl.schedule,
                                  onChange: function (on) { put({ schedule: on }); } })];
          if (sl.schedule) {
            sched.push(K.text({ label: 'From', sk: 'b:sleep.quiet_from', value: sl.quiet_from, placeholder: '22:00', error: this.err(ctx.err),
                                onCommit: function (v) { put({ quiet_from: v.trim() }); } }));
            sched.push(K.text({ label: 'To', sk: 'b:sleep.quiet_to', value: sl.quiet_to, placeholder: '07:00',
                                onCommit: function (v) { put({ quiet_to: v.trim() }); } }));
          }
          sched.push(K.nav({ label: 'Quiet While', href: base + '/quiet', sk: 'b:sleep.quiet_while', value: self.sleepCount(sl.quiet_while) }));
          c.appendChild(
            K.group(
            { header: 'When It Goes Dark',
            footer:
            'After the Screensaver: dark once the photos have shown that long with nobody touching it (with Presence, nobody new coming in). Quiet hours, by the clock and while anything in Quiet ' +
            'While is on: dark even with somebody in the room — a tap still wakes it.' }, sched));
          var linger = (choices.linger || [0, 30, 60, 120, 300]).map(function (v) { return [v, secs(v)]; });
          c.appendChild(
            K.group(
            { header: 'Who Is There',
            footer: 'Somebody in the room: the photos (a dark tablet wakes to the dashboard, and the photos follow on their own); somebody touching it: the dashboard; nobody: dark.' }, [
            K.nav({ label: 'Presence', href: base + '/presence', sk: 'b:sleep.presence', value: (sl.presence || []).length ? self.sleepCount(sl.presence) : 'Always Occupied' }),
            K.select({ label: 'Linger', sk: 'b:sleep.linger', value: sl.linger == null ? 60 : sl.linger, options: linger,
                       onChange: function (v) { put({ linger: Number(v) }); } }),
            K.nav({ label: 'Only While Lit', href: base + '/lit', sk: 'b:sleep.lit', value: self.sleepCount(sl.lit) }),
            K.nav({ label: 'Sleep Until Re-entered', href: base + '/reset', sk: 'b:sleep.reset', value: self.sleepCount(sl.reset) })]));
          this.sleepNear(c, sl, base, put);
          c.appendChild(
            K.group({ header: 'Overrides', footer: 'In this order: Wake For, Hold While, Keep Awake While, Stay Dark While — all before who is in the room. Another app in front is always left alone.'
            }, [
            K.nav({ label: 'Wake For', href: base + '/wake', sk: 'b:sleep.wake_for', value: self.sleepCount(sl.wake_for) }),
            K.nav({ label: 'Hold While', href: base + '/hold', sk: 'b:sleep.hold_while', value: self.sleepCount(sl.hold_while) }),
            K.nav({ label: 'Keep Awake While', href: base + '/awake', sk: 'b:sleep.awake_while', value: self.sleepCount(sl.awake_while) }),
            K.nav({ label: 'Stay Dark While', href: base + '/dark', sk: 'b:sleep.dark_while', value: self.sleepCount(sl.dark_while) })]));
          // BRIGHTNESS: Day and Night, each its level (in %; the display's
          // 0-255 underneath), its start time when by the clock, and its list
          // that forces it -- Day While, then Night While, then the clock
          var bm = sl.brightness || 'leave';
          var bOpts = [['leave', 'Leave It'], ['fixed', 'Day and Night']];
          if (bm === 'sensor') bOpts.push(['sensor', 'From an Entity']);
          var pct = function (v) { return Math.max(1, Math.round((v || 0) / 2.55)); };
          var raw = function (p) { return Math.max(1, Math.min(255, Math.round(p * 2.55))); };
          c.appendChild(K.group({ header: 'Brightness', footer: bm === 'leave'
              ? PN() + ' never changes the screen’s brightness. (The tablet’s own adaptive brightness, if it is on, still does.)'
              : 'The screen’s brightness while awake, and what it wakes to — set on the screen itself, as Fully Kiosk did, and checked again at every sleep and wake. Under ' + PN() +
                '’s black the backlight stays at its lowest until the wake. Turn the tablet’s own adaptive brightness off, or the two will fight.' }, [
            K.seg({ label: 'Brightness', sk: 'b:sleep.brightness', stack: !wide, value: bm, options: bOpts,
                    onChange: function (v) { put({ brightness: v }); } })].concat(bm === 'fixed' ? [
            K.toggle({ label: 'Day and Night by the Clock', sk: 'b:sleep.bright_clock', on: !!sl.bright_clock,
                       onChange: function (on) { put({ bright_clock: on }); } })] : []).concat(bm === 'sensor' ? [
            this.entityRow({ label: 'Entity', sk: 'b:sleep.bright_sensor', value: sl.bright_sensor, title: 'Brightness From',
                             filter: { domains: ['sensor', 'input_number', 'number'] }, onPick: function (id) { put({ bright_sensor: id || '' }); } })] : [])));
          if (bm === 'fixed') {
            var clock = !!sl.bright_clock;
            c.appendChild(K.group({ header: 'Day', footer: (clock ? 'From ' + (sl.day_from || '07:00') + ', and always' : 'Whenever it is not night (below) — and always') +
              ' while anything in Day While is on.' }, [
              K.slider({ label: 'Brightness', sk: 'b:sleep.bright_day', min: 1, max: 100, unit: '%', value: pct(sl.bright_day || 174),
                         onChange: function (v) { put({ bright_day: raw(v) }); } })].concat(clock ? [
              K.text({ label: 'Starts At', sk: 'b:sleep.day_from', value: sl.day_from || '07:00', placeholder: '07:00', error: this.err(ctx.err),
                       onCommit: function (v) { put({ day_from: v.trim() }); } })] : []).concat([
              K.nav({ label: 'Day While', href: base + '/day', sk: 'b:sleep.day_while', value: self.sleepCount(sl.day_while) })])));
            c.appendChild(K.group({ header: 'Night', footer: (clock ? 'From ' + (sl.night_from || '22:00') + ', ' : 'Not by the clock: ') +
              'whenever anything in Night While is on (Day While still wins).' }, [
              K.slider({ label: 'Brightness', sk: 'b:sleep.bright_night', min: 1, max: 100, unit: '%', value: pct(sl.bright_night || 75),
                         onChange: function (v) { put({ bright_night: raw(v) }); } })].concat(clock ? [
              K.text({ label: 'Starts At', sk: 'b:sleep.night_from', value: sl.night_from || '22:00', placeholder: '22:00',
                       onCommit: function (v) { put({ night_from: v.trim() }); } })] : []).concat([
              K.nav({ label: 'Night While', href: base + '/night', sk: 'b:sleep.night_while', value: self.sleepCount(sl.night_while) })])));
          }
        }
        // (Near the Screen is one of the rules: an automation deciding has none of them)
        if (!hk) {
          c.appendChild(K.group({ header: 'Near the Screen', footer: 'The dashboard when somebody comes near the screen, the screensaver again when they go: this needs Decided By ' +
              PN() + '. An automation of yours decides this tablet now.' }, []));
        }
        var wk = docsLink('Sleep-Screen', '', { sub: 'Sleep Screen', sk: 'b:sleep:wiki' });
        if (wk) c.appendChild(K.group({ footer: 'How Sleep Screen works, and ready-made automations for deciding it yourself.' }, [wk]));
      }

      sleepCount(list) { var n = (list || []).length; return n ? n + (n === 1 ? ' Entity' : ' Entities') : 'None'; }

      // MORE WHEN NEAR (sleep_rules.py rule 9a): the sensors that see the space
      // in front of the tablet; Closer Than for a distance sensor's reading (in
      // cm, sleep_rules.NEAR_CM) and Back to the Screensaver (s, NEAR_LINGER)
      sleepNear(c, sl, base, put) {
        var self = this, near = sl.near || [];
        var distance = near.some(function (id) { return id.split('.')[0] === 'sensor'; });
        var cm = function (v) { return v >= 100 ? (v / 100).toFixed(v % 100 ? 1 : 0) + ' m' : v + ' cm'; };
        var CM = [30, 50, 80, 100, 120, 150, 200, 250, 300], BACK = [10, 20, 30, 60, 120, 180, 300];
        var with_ = function (list, v) { return list.indexOf(v) >= 0 ? list : list.concat(v).sort(function (a, b) { return a - b; }); };
        var rows = [K.nav({ label: 'Near the Screen', href: base + '/near', sk: 'b:sleep.near', value: self.sleepCount(near) })];
        if (near.length && distance) {
          rows.push(K.select({ label: 'Closer Than', sk: 'b:sleep.near_cm', value: sl.near_cm || 120,
                               options: with_(CM, sl.near_cm || 120).map(function (v) { return [v, cm(v)]; }),
                               onChange: function (v) { put({ near_cm: Number(v) }); } }));
        }
        if (near.length) {
          rows.push(K.select({ label: 'Back to the Screensaver', sk: 'b:sleep.near_linger', value: sl.near_linger || 30,
                               options: with_(BACK, sl.near_linger || 30).map(function (v) { return [v, v < 60 ? v + ' s' : (v / 60) + ' min']; }),
                               onChange: function (v) { put({ near_linger: Number(v) }); } }));
        }
        c.appendChild(K.group({ header: 'Near the Screen', footer: near.length
            ?
              'Somebody near the screen: the dashboard, before a touch (while lit, never in quiet hours). With nobody near and no touch for Back to the Screensaver, the photos come back — sooner ' +
              'than Starts After.'
            : 'A sensor that sees the space in front of the tablet — an mmWave zone, or a distance sensor — brings the dashboard up as somebody walks up to it. The tablet’s own camera is never used.'
              }, rows));
      }

      // ONE OF SLEEP SCREEN'S LISTS: as many entities as the house has; Hold
      // While and Wake For say which of theirs also work in quiet hours
      s_sleep_list_t(c, x, tid, which) { return this.s_sleepList(c, x, this.tabs()[tid] || {}, which); }

      s_sleepList(c, x, b, which) {
        var self = this, ctx = this.sleepCtx(x), spec = SLEEP_LISTS[which], sl = b.sleep || {};
        var list = (sl[spec.key] || []).slice(), qok = (sl.quiet_ok || []).slice();
        var put = function (ch) { return ctx.set({ sleep: Object.assign({}, sl, ch) }); };
        var setList = function (v) {
          var ch = {}; ch[spec.key] = v;
          if (spec.quiet) ch.quiet_ok = qok.filter(function (id) { return v.indexOf(id) >= 0 || self.sleepElsewhere(sl, spec.key, id); });
          return put(ch);
        };
        c.appendChild(K.listEditor({ fk: 'sleep-' + which, announce: this.announce.bind(this), emptyText: 'None', shownHeader: spec.title, reorder: false,
          rows: list.map(function (id) { return { value: id, label: self.name(id), sub: id }; }),
          onChange: setList,
          addLabel: 'Add…', onAddOther: function () {
            self.go(self.picker('sleep-add-' + which, { title: 'Add to ' + spec.title, value: null, multi: true,
              items: function () {
                return self.entityIds({ domains: spec.domains, shown: true }).filter(function (id) { return list.indexOf(id) < 0; })
                  .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; });
              },
              onPick: function (id) { if (id) setList(list.concat(id)); } }));
          } }));
        if (spec.quiet && list.length) {
          c.appendChild(K.group({ header: 'Also in Quiet Hours', footer: 'Ticked: works in quiet hours too (smoke, the doorbell). The rest wait until quiet hours end.' },
            list.map(function (id) {
              return K.check({ label: self.name(id), multi: true, on: qok.indexOf(id) >= 0, sk: 'b:sleep.quiet_ok:' + id,
                onClick: function (on) { put({ quiet_ok: on ? qok.concat(id) : qok.filter(function (q) { return q !== id; }) }); } });
            })));
        }
        c.appendChild(K.group({ footer: spec.help }, []));
      }

      // an entity also in the other quiet-capable list keeps its tick
      sleepElsewhere(sl, key, id) {
        var other = key === 'hold_while' ? 'wake_for' : 'hold_while';
        return (sl[other] || []).indexOf(id) >= 0;
      }

      // A SCREEN'S ROOMS: Same as All Screens (Rooms, on the sidebar), or this
      // screen's own -- its room order and Home's rooms, the menu's and the
      // pages'. Turning Same off starts from All Screens' as they are.
      s_rooms(c, x, b) {
        var self = this, set = function (ch) { return self.setB(x.path, ch); }, wide = this.hasAttribute('wide');
        var follows = !b.rooms_custom;
        var MENU = [['az', 'A to Z'], ['order', 'Room Order']], PAGES = [['floor', 'By Floor'], ['order', 'Room Order']];
        var label = function (opts, v) { return (opts.filter(function (o) { return o[0] === v; })[0] || [v, v])[1]; };
        c.appendChild(K.group({ footer: follows ? 'This screen’s rooms follow Rooms (All Screens). Turn this off to set them here, for this screen only.'
            : 'This screen sets its own. Turn this on to follow Rooms (All Screens) again.' }, [
          K.toggle({ label: 'Same as All Screens', sk: 'b:rooms_custom', on: follows, onChange: function (on) {
            if (!on) { set({ rooms_custom: true, room_order: (b.room_order || []).slice(), home_rooms: b.home_rooms,
                             menu_rooms: b.menu_rooms, page_rooms: b.page_rooms }); return; }
            self.confirmSwitch({ title: 'Follow All Screens’ Rooms?', message: 'This screen’s own room order and choices will be replaced.', ok: 'Follow All Screens' },
                function () { set({ rooms_custom: false }); });
          } })]));
        if (follows) {
          this.fromAllScreens(c, [
            K.info({ label: 'Room Order', value: M.roomsSummary(b) }),
            K.info({ label: 'Rooms in Menu', value: label(MENU, b.menu_rooms) })].concat(x.generated ? [
            K.info({ label: 'Rooms on Pages', value: label(PAGES, b.page_rooms) })] : []), 'Rooms', '#/house/rooms');
          return;
        }
        var az = this.areasAZ(), areas = this.client.areas || {};
        var mdl = M.roomsModel(b, az);
        c.appendChild(K.listEditor({ fk: 'rooms', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
          autoFooter: 'Automatic: Home shows its rooms as the screen lists them' + (x.generated ? ' (floor by floor, then A to Z).' : '.'),
          shownHeader: 'On Home', moreHeader: 'Not on Home',
          moreFooter: 'A room that isn’t on Home keeps its page and its row in the menu. Tap a room for its own settings, the same on every screen.',
          rows: mdl.rows.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: (areas[r.value] || {}).icon || 'mdi:texture-box', href: self.roomHref(r.value) }; }),
          more: mdl.more.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: (areas[r.value] || {}).icon || 'mdi:texture-box' }; }),
          onAuto: function (on) {
            if (!on) { set({ room_order: az.slice(), home_rooms: 'order' }); return; }
            self.confirmSwitch({ title: 'Use Automatic Rooms?', message: 'This screen’s room order and choices will be replaced.', ok: 'Use Automatic' },
                function () { set(M.roomsAuto()); });
          },
          onChange: function (v) { set(M.roomsSave(v, az)); } }));
        c.appendChild(K.group({ header: 'Menu and Pages', footer: 'Room Order is the order above.' }, [
          K.seg({ label: 'Rooms in Menu', sk: 'b:menu_rooms', value: b.menu_rooms, stack: !wide, options: MENU,
                  onChange: function (v) { set({ menu_rooms: v }); } })].concat(x.generated ? [
          K.seg({ label: 'Rooms on Pages', sub: 'Lights, Climate, Water and the other pages that group by room.', sk: 'b:page_rooms',
                  value: b.page_rooms, stack: !wide, options: PAGES, onChange: function (v) { set({ page_rooms: v }); } })] : [])));
      }
    };
    KIT.install(Methods);
  };
})();
