// hk-settings-screen-saver-extras.js - the screensaver's weather, holiday, extras, energy, clock and photos.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-screen-saver-extras'] = function (KIT) {
    var haName = KIT.haName, MIN = KIT.MIN;

    var h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // HOME ENERGY'S ROWS (2026-10-14): its switch, and its options once on
      energyRows(cur, tog, href) {
        var rows = [tog('Home Energy', 'energy_slide', 'Today so far: energy, cost and water against a usual day.')];
        if (cur.energy_slide) rows.push(K.nav({ label: 'Home Energy Options', value: M.energyShown(cur), href: href, sk: 'saver:energy_options' }));
        return rows;
      }

      // WEATHER'S ROWS (2026-10-14): its switch, and its options once on
      weatherRows(cur, tog, href) {
        var rows = [tog('Weather', 'weather_slide', 'Today’s weather at a glance, over the live sky.')];
        if (cur.weather_slide) rows.push(K.nav({ label: 'Weather Options', value: M.weatherShown(cur), href: href, sk: 'saver:weather_options' }));
        return rows;
      }

      // WEATHER'S OPTIONS (2026-10-14; hk-saver-weather.js): the readings, and
      // what is along the bottom. The preview holds the screen.
      saverWeather(c, cur, put) {
        var hide = Array.isArray(cur.weather_hide) ? cur.weather_hide : [];
        var part = function (k, label, sub) {
          return K.toggle({ label: label, sub: sub, on: hide.indexOf(k) < 0, sk: 'saver:weather_hide:' + k,
            onChange: function (on) {
              var next = hide.filter(function (x) { return x !== k; });
              if (!on) next.push(k);
              put('weather_hide', M.WEATHER_PARTS.filter(function (x) { return next.indexOf(x) >= 0; }));
            } });
        };
        c.appendChild(
          K.group(
          { header: 'Readings', footer: 'Temperature always shows: now, with today’s high and low. Each reading has its leader line and a line in words underneath. Rain reads Snow when it snows.' }, [
          part('rain', 'Rain', 'The chance today, and when.'),
          part('wind', 'Wind', 'Its speed, direction and gusts.')]));
        c.appendChild(
          K.group(
          { header: 'Along the Bottom',
          footer: 'From the weather in Weather, as the forecast’s details have them. Behind it all, the live sky as it is outside (Sky Only). A tap on the screen opens the Weather page.' }, [
          part('hours', 'Next Hours'), part('days', 'Coming Days')]));
      }

      // THE HOLIDAY SLIDE'S ROWS (phase 20): its switch, and its options once on
      holidayRows(cur, tog, href) {
        var rows = [tog('Holidays', 'holiday_slide', 'How many days until the next holiday, in its own scene.')];
        if (cur.holiday_slide) rows.push(K.nav({ label: 'Holiday Options', value: this.holidayShown(cur), href: href, sk: 'saver:holiday_options' }));
        return rows;
      }

      // its options as Holiday Options' row says them: "Next Up · 60 Days"
      holidayShown(o) {
        var pick = { turns: 'Take Turns', one: 'One Holiday' }[o && o.holiday_pick] || 'Next Up';
        return pick + ' · ' + (o && (o.holiday_days === 30 || o.holiday_days === 90) ? o.holiday_days : 60) + ' Days';
      }

      // HOLIDAY OPTIONS (phase 20, docs/phase20/HOLIDAY-SLIDE.md; hk-saver-holiday.js): which holiday and when it starts,
      // the effects, the holidays it counts down to (and your own dates), the painted scenes or outdoors, and the row
      // along the bottom. The preview holds the slide.
      saverHoliday(c, cur, put) {
        var self = this, HH = window.hkHolidays, HOLIDAY_PARTS = ['count', 'next'], HOLIDAY_PICKS = [['next', 'Next Up'], ['turns', 'Take Turns'], ['one', 'One Holiday']];
        var HOLIDAY_SCENES = [['christmas', '90s Living Room', 'Christmas'], ['halloween', 'Haunted House', 'Halloween'], ['thanksgiving', 'Dining Room', 'Thanksgiving'],
          ['newyear', 'Rooftop Party', 'New Year’s']];
        if (!HH) {
          var u = '/hk/modules/hk-holidays.js';
          import(window.hkV ? window.hkV(u) : u).then(function () { if (window.hkHolidays) self.render(); }, function () { /* the page without its calendar */ });
          c.appendChild(K.group({}, [K.info({ label: 'Holidays', value: 'Loading…' })]));
          return;
        }
        var bd = self.hs('sky.birthdays'), own = Array.isArray(cur.holiday_own) ? cur.holiday_own : [], off = Array.isArray(cur.holiday_off) ? cur.holiday_off : [];
        var outd = Array.isArray(cur.holiday_outdoors) ? cur.holiday_outdoors : [], hide = Array.isArray(cur.holiday_hide) ? cur.holiday_hide : [];
        var opts = { tz: window.hkStats && window.hkStats.tz ? window.hkStats.tz() : undefined, off: off, own: own, birthdays: Array.isArray(bd) ? bd : [],
                     days: cur.holiday_days || 60, pick: cur.holiday_pick || 'next', one: cur.holiday_one || 'christmas' };
        var today = HH.today(Date.now(), opts.tz), near = HH.inRange(today, opts), all = HH.list(today, Object.assign({}, opts, { off: [] }));
        var fmt = function (p) { return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }); };
        var when = function (n) { return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n + ' days away'; };
        var shows = HH.pick(today, Object.assign({}, opts, { pick: opts.pick === 'turns' ? 'next' : opts.pick }));
        c.appendChild(K.group({ footer: shows ? (opts.pick === 'turns' && near.length > 1 ? 'Each time the slide comes, the next of ' + near.length + ' near holidays.' : near.length > 1 ?
          (near.length - 1) + ' more within ' + opts.days + ' days.' : '')
            : 'With none near, the slide stays away and the others carry on.' },
          [K.info({ label: shows ? 'Today it would show ' + shows.name : 'No holiday within ' + opts.days + ' days', value: shows ? when(shows.days) : '' })]));
        var pickRows = [K.seg({ label: 'Which Holiday', sk: 'saver:holiday_pick', value: opts.pick, options: HOLIDAY_PICKS, onChange: function (v) { put('holiday_pick', v); } })];
        if (opts.pick === 'one') pickRows.push(K.select({ label: 'Holiday', sk: 'saver:holiday_one', value: opts.one,
          options: all.map(function (h) { return [h.id, h.name]; }).concat(all.some(function (h) { return h.id === opts.one; }) ? [] : [[opts.one, 'A Date No Longer Listed']]),
          onChange: function (v) { put('holiday_one', v); } }));
        pickRows.push(K.seg({ label: 'Starts', sk: 'saver:holiday_days', value: opts.days, options: [[30, '30 Days'], [60, '60 Days'], [90, '90 Days']],
          onChange: function (v) { put('holiday_days', Number(v)); } }));
        pickRows.push(K.seg({ label: 'Effects', sk: 'saver:holiday_fx', value: cur.holiday_fx || 'full', options: [['full', 'Full'], ['gentle', 'Gentle'], ['off', 'Off']],
          onChange: function (v) { put('holiday_fx', v); } }));
        c.appendChild(
          K.group(
          { header: 'The Slide', footer: 'Next Up shows the soonest holiday once it is within the days you choose; Take Turns shows each near one in turn; One Holiday shows only the one you pick. ' +
            'Effects run only while the slide is up. Gentle has fewer and slower; Off, Reduce Motion or Flat draw one still picture.' }, pickRows));
        // THE HOLIDAYS it counts down to: each built-in one, the sky's birthdays, your own dates
        var turn = function (id, on) { var next = off.filter(function (x) { return x !== id; }); if (!on) next.push(id);
          put('holiday_off', HH.IDS.concat(['birthdays']).filter(function (x) { return next.indexOf(x) >= 0; })); };
        var rows = HH.IDS.map(function (id) {
          var h = all.filter(function (x) { return x.id === id; })[0];
          return K.toggle({ label: h ? h.name : id, sub: h ? fmt(h.date) : null, on: off.indexOf(id) < 0, sk: 'saver:holiday_off:' + id, onChange: function (on) { turn(id, on); } });
        });
        var nb = Array.isArray(bd) ? bd.length : 0;
        rows.push(K.toggle({ label: 'Birthdays', sub: nb ? 'From the sky’s Birthdays: ' + nb : 'Add them in Seasonal Sky’s Birthdays', on: off.indexOf('birthdays') < 0,
          sk: 'saver:holiday_off:birthdays', onChange: function (on) { turn('birthdays', on); } }));
        c.appendChild(K.group({ header: 'Holidays', footer: 'Hanukkah, Diwali, Lunar New Year and other dates that move each year: add them below, for this year.' }, rows));
        var SC = window.hkHolidays.OWN_SCENES;
        if (own.length) c.appendChild(K.listEditor({ fk: 'holown', reorder: false, shownHeader: 'Your Own Dates', announce: this.announce ? this.announce.bind(this) : null,
          rows: own.map(function (o, i) {
            return { value: String(i), label: o.name, sub: new Date(Date.UTC(o.year || 2024, o.month - 1, o.day)).toLocaleDateString('en-US',
              { month: 'long', day: 'numeric', year: o.year ? 'numeric' : undefined, timeZone: 'UTC' }) +
              (o.year ? '' : ' · Every Year') + ' · ' + ((SC[o.scene] || SC.spring).label) };
          }),
          onChange: function (values) { put('holiday_own', values.map(function (v) { return own[Number(v)]; }).filter(Boolean)); } }));
        // ADD A DATE: a name, its day (every year, or once), and which scene it wears
        var d = this._holDraft = this._holDraft || { name: '', month: today.m, day: today.d, year: '', scene: 'spring' };
        var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        var dmax = new Date(Date.UTC(Number(d.year) || 2024, d.month, 0)).getUTCDate();
        if (d.day > dmax) d.day = dmax;
        var full = own.length >= HH.OWN_MAX;
        c.appendChild(K.group({ header: 'Add a Date', footer: full ? 'Up to ' + HH.OWN_MAX + ' dates of your own. Remove one to add another.' :
          'Dates of your own stand outdoors, in the scene you choose. A date for one year leaves the list once it has passed.' }, [
          K.text({ label: 'Name', sk: 'saver:holiday_new:name', value: d.name, placeholder: 'Beach Trip', maxlength: HH.NAME_MAX, onCommit: function (v) { d.name = v; self.render(); } }),
          K.select({ label: 'Month', sk: 'saver:holiday_new:month', value: String(d.month), options: MONTHS.map(function (m, i) { return [String(i + 1), m]; }),
            onChange: function (v) { d.month = Number(v); self.render(); } }),
          K.select({ label: 'Day', sk: 'saver:holiday_new:day', value: String(d.day), options: Array.apply(null, Array(dmax)).map(function (_, i) { return [String(i + 1), String(i + 1)]; }),
            onChange: function (v) { d.day = Number(v); self.render(); } }),
          K.select({ label: 'Repeats', sk: 'saver:holiday_new:year', value: String(d.year),
            options: [['', 'Every Year'], [String(today.y), 'Only in ' + today.y], [String(today.y + 1), 'Only in ' + (today.y + 1)], [String(today.y + 2), 'Only in ' + (today.y + 2)]],
            onChange: function (v) { d.year = v; self.render(); } }),
          K.select({ label: 'Scene', sk: 'saver:holiday_new:scene', value: d.scene, options: Object.keys(SC).map(function (k) { return [k, SC[k].label]; }), onChange: function (v) { d.scene = v; } }),
          K.button({ label: 'Add the Date', sk: 'saver:holiday_new:add', disabled: full || !d.name.trim(), onClick: function () {
            var item = { name: d.name.trim().slice(0, HH.NAME_MAX), month: d.month, day: d.day, scene: d.scene };
            if (d.year) item.year = Number(d.year);
            self._holDraft = null;
            put('holiday_own', own.concat([item]));
          } })]));
        // THE SCENES: Christmas, Halloween, Thanksgiving and New Year's in their painted rooms, or outdoors
        c.appendChild(K.group({ header: 'Scenes', footer: 'Off, a holiday stands outdoors on the sky’s landscape instead, with its own effects.' },
          HOLIDAY_SCENES.map(function (x) {
            return K.toggle({ label: x[1], sub: x[2], on: outd.indexOf(x[0]) < 0, sk: 'saver:holiday_outdoors:' + x[0], onChange: function (on) {
              var next = outd.filter(function (y) { return y !== x[0]; }); if (!on) next.push(x[0]);
              put('holiday_outdoors', HH.PAINTED.filter(function (y) { return next.indexOf(y) >= 0; }));
            } });
          })));
        var part = function (k, label, sub) {
          return K.toggle({ label: label, sub: sub, on: hide.indexOf(k) < 0, sk: 'saver:holiday_hide:' + k, onChange: function (on) {
            var next = hide.filter(function (x) { return x !== k; }); if (!on) next.push(k);
            put('holiday_hide', HOLIDAY_PARTS.filter(function (x) { return next.indexOf(x) >= 0; }));
          } });
        };
        c.appendChild(
          K.group({ header: 'Along the Bottom', footer: 'The Countdown hides in the last week. The time, the date, the weather and House Status are the slide corner’s, as over every slide.' }, [
          part('count', 'The Countdown', 'Weeks and Weekends Left'), part('next', 'Coming Up', 'The next three after this one')]));
      }

      // ADDITIONAL SCREENS (2026-10-14): over the forecast or the clock, now
      // and then -- the forecast (on Show: Clock), the music and Home Energy,
      // taking turns on one timer. `mf`: Music First, which covers the music
      saverExtras(c, cur, put, tog, base, mf, href) {
        var rows = [], bgSky = cur.clock_bg === 'forecast' || cur.clock_bg === 'skyonly';
        if (base === 'clock' && !bgSky) rows.push(tog('Forecast', 'extra_forecast', 'Today, the next hours and the coming days, over the live sky.'));
        if (!mf) rows.push(tog('Music', 'extra_music', 'What’s playing, full screen. Only while something plays; otherwise it skips its turn.'));
        // (Weather over the clock; over the forecast it is the weather already)
        var wxOn = base === 'clock' && this.saverKnown('weather_slide');
        if (wxOn) rows = rows.concat(this.weatherRows(cur, tog, String(href).replace(/energy$/, 'weather')));
        rows = rows.concat(this.energyRows(cur, tog, href));
        if (this.saverKnown('holiday_slide')) rows = rows.concat(this.holidayRows(cur, tog, String(href).replace(/energy$/, 'holiday')));
        var on = [base === 'clock' && !bgSky && cur.extra_forecast && 'the forecast', !mf && cur.extra_music && 'the music',
                  wxOn && cur.weather_slide && 'the weather', cur.energy_slide && 'Home Energy', cur.holiday_slide && 'the holidays'].filter(Boolean);
        var mins = function (n) { return n === 1 ? '1 Minute' : n + ' Minutes'; };
        var secs = function (n) { return n < 60 ? n + ' Seconds' : n === 60 ? '1 Minute' : (n % 60 ? Math.round(n / 6) / 10 : n / 60) + ' Minutes'; };
        if (on.length) {
          var EV = [1, 2, 5, 10, 15, 30], FOR = [15, 30, 60, 120];
          rows.push(K.select({ label: 'Every', sk: 'saver:extra_every', value: String(cur.extra_every),
            options: EV.concat(EV.indexOf(cur.extra_every) < 0 ? [cur.extra_every] : []).map(function (n) { return [String(n), mins(n)]; }),
            onChange: function (v) { put('extra_every', Number(v)); } }));
          rows.push(K.select({ label: 'Show For', sk: 'saver:extra_for', value: String(cur.extra_for),
            options: FOR.concat(FOR.indexOf(cur.extra_for) < 0 ? [cur.extra_for] : []).map(function (n) { return [String(n), secs(n)]; }),
            onChange: function (v) { put('extra_for', Number(v)); } }));
        }
        c.appendChild(K.group({ header: 'Now and Then', footer: on.length
            ? 'Every ' + mins(cur.extra_every).toLowerCase() + ', ' + (on.length > 1 ? 'one of these' : on[0]) + ' fades in over the ' + base +
              ' for ' + secs(cur.extra_for).toLowerCase() + ', then the ' + base + ' comes back.' +
              (on.length > 1 ? ' ' + M.listText(on).replace(/^t/, 'T') + ' take turns, so each comes around every ' + mins(cur.extra_every * on.length).toLowerCase() + '.' : '') +
              ' They wait while music plays first' + (base === 'clock' ? ' and during Night Mode.' : '.') +
              (mf ? ' Music First covers the music, so it isn’t listed here.' : '')
            : 'Other screens, now and then, over the ' + base + '.' + (mf ? ' Music First covers the music.' : '') }, rows));
      }

      // HOME ENERGY'S OPTIONS (2026-10-14; hk-saver-energy.js): which rings,
      // what is along the bottom, the month. The preview holds the screen.
      saverEnergy(c, cur, put) {
        var self = this, hide = Array.isArray(cur.energy_hide) ? cur.energy_hide : [];
        var src = this.energySources();
        var part = function (k, label, sub) {
          return K.toggle({ label: label, sub: sub, on: hide.indexOf(k) < 0, sk: 'saver:energy_hide:' + k,
            onChange: function (on) {
              var next = hide.filter(function (x) { return x !== k; });
              if (!on) next.push(k);
              put('energy_hide', M.ENERGY_PARTS.filter(function (x) { return next.indexOf(x) >= 0; }));
            } });
        };
        var rings = [part('cost', 'Cost', null), part('water', 'Water', null)];
        if (src && src.solar) rings.push(part('solar', 'Solar', null));
        if (src && src.gas) rings.push(part('gas', 'Gas', null));
        c.appendChild(
          K.group(
          { header: 'Rings',
          footer:
          'Energy always shows. Each ring is today so far against a usual whole day;' +
          ' the white dot is where a usual day is by this time. A ring shows only where Home Assistant’s Energy settings have it.' }, rings));
        c.appendChild(K.group({ header: 'Right Now', footer: 'Along the bottom, left. Each shows only where there is one: House Battery needs a house battery on the Energy page.' }, [
          part('power', 'Power Now', 'What the house draws right now.'),
          part('battery', 'House Battery', 'Its charge.'),
          part('yday', 'Yesterday by Now', 'Yesterday’s use up to this time.')]));
        var mo = hide.indexOf('month') < 0, cost = hide.indexOf('cost') < 0;
        var also = ' The numbers are the Energy page’s Today and This Month, up to the last five minutes. A tap on Home Energy opens the Energy page.';
        c.appendChild(K.group({ header: 'This Month', footer: (!mo ? 'Off: today only.'
            : 'Along the bottom, right: the month since the 1st, for each ring that shows.' + (cost && hide.indexOf('pace') < 0
              ? ' Heading for is the Energy page’s own estimate: what the month has cost so far, plus a usual day for each day left. It firms up as the month goes on.' : '')) + also },
          [part('month', 'Month So Far', 'Energy, cost and water since the 1st.')].concat(mo && cost ?
            [part('pace', 'Where the Cost Is Heading', 'The month’s cost so far, plus a usual day’s for each day left.')] : [])));
      }

      // WHICH SOURCES THE HOUSE HAS (Home Assistant's Energy settings), for
      // Home Energy's rings: asked once, the page drawn again when they land
      energySources() {
        var self = this;
        if (this._enSrc !== undefined) return this._enSrc;
        this._enSrc = null;
        var client = this.client;
        if (client && client.callWS) {
          client.callWS({ type: 'energy/get_prefs' }).then(function (pr) {
            var t = {};
            ((pr && pr.energy_sources) || []).forEach(function (x) { t[x.type] = true; });
            self._enSrc = t;
            self.render();
          }).catch(function () { /* the rings it always has */ });
        }
        return null;
      }

      // THE CLOCK'S COLOR (2026-10-13): the chosen style's own colors; each
      // face keeps its own (clock_colors), so trying another style loses none
      clockColorRow(cur, put) {
        var style = cur.clock_style || 'classic', set = M.CLOCK_COLORS[style] || [];
        if (!set.length || !this.saverKnown('clock_colors')) return null;
        var mine = (cur.clock_colors || {})[style], val = set.some(function (c) { return c[0] === mine; }) ? mine : set[0][0];
        return K.select({ label: 'Color', sub: 'This style’s own colors', sk: 'saver:clock_color', value: val,
          options: set.map(function (c, i) { return [c[0], c[1] + (i ? '' : ' (Default)'), c[1]]; }),
          onChange: function (v) { var o = Object.assign({}, cur.clock_colors || {}); o[style] = v; put('clock_colors', o); } });
      }

      // SHOW: CLOCK's groups (2026-10-13): the clock, what's behind it, and
      // what's over it -- each corner its own switch, so it can be the clock
      // alone
      // NIGHT MODE's rows: Off / At Night / Always, and the night's hours
      clockNightRows(cur, put) {
        if (!this.saverKnown('clock_night')) return [];
        var self = this, mode = cur.clock_night || 'off', rows = [
          K.seg({ label: 'Night Mode', sub: 'A dim red clock on black, as StandBy has it', sk: 'saver:clock_night', value: mode, stack: !this.hasAttribute('wide'),
                  options: [['off', 'Off'], ['night', 'At Night'], ['always', 'Always']], onChange: function (v) { put('clock_night', v); } })];
        if (mode === 'night') {
          var hhmm = function (label, k, dflt) {
            return K.text({ label: label, sk: 'saver:' + k, value: cur[k] || dflt, placeholder: dflt, maxlength: 5, error: self.err('look.saver'),
                            onCommit: function (v) { v = v.trim(); if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) put(k, v); else self.render(); } });
          };
          rows.push(hhmm('From', 'clock_night_from', '22:00'), hhmm('Until', 'clock_night_to', '07:00'));
        }
        return rows;
      }

      // THE PHOTOS' OWN SETTINGS (Layout, the mosaic, Order, Slow Zoom, then
      // Portrait and Landscape): the Photo Screensaver's -- and, the same rows,
      // the clock's when Photos is behind it (2026-10-13, the user: mimic them)
      saverPhotoGroups(c, cur, put, tog, clockMode, afterSrc) {
        var self = this, wideP = this.hasAttribute('wide');
        // THE MOSAIC (2026-10-13): 2-5 photos at once, in a layout picked at
        // random; portraits in the tall cells
        var moKnown = self.saverKnown('photo_layout'), mo = moKnown && cur.photo_layout === 'mosaic';
        var prow = [];
        if (moKnown) prow.push(K.seg({ label: 'Layout', sk: 'saver:photo_layout', value: mo ? 'mosaic' : 'single', stack: !wideP,
          options: [['single', 'One at a Time'], ['mosaic', 'Mosaic']], onChange: function (v) { put('photo_layout', v); } }));
        var upTo = mo && self.saverKnown('mosaic_random') && !!cur.mosaic_random;
        if (mo) {
          prow.push(K.seg({ label: upTo ? 'Up to' : 'Photos per Mosaic', sk: 'saver:mosaic_count', value: String(cur.mosaic_count || 3),
            options: [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']], onChange: function (v) { put('mosaic_count', Number(v)); } }));
          if (self.saverKnown('mosaic_random')) {
            prow.push(K.toggle({ label: 'Up To', sub: 'A different number of photos now and then — from one, full screen, up to this many.',
                                 on: upTo, sk: 'saver:mosaic_random', onChange: function (on) { put('mosaic_random', on); } }));
            if (upTo) {
              var EV = [1, 5, 10, 15, 30, 60], ev = cur.mosaic_every || 10;
              prow.push(K.select({ label: 'A New Number Every', sk: 'saver:mosaic_every', value: String(ev),
                options: EV.concat(EV.indexOf(ev) < 0 ? [ev] : []).map(function (m) { return [String(m), m === 1 ? '1 Minute' : m + ' Minutes']; }),
                onChange: function (v) { put('mosaic_every', Number(v)); } }));
            }
          }
          prow.push(K.seg({ label: 'Spacing', sk: 'saver:mosaic_gap', value: cur.mosaic_gap || 'thin', stack: !wideP,
            options: [['none', 'None'], ['thin', 'Thin'], ['rounded', 'Rounded']], onChange: function (v) { put('mosaic_gap', v); } }));
          if ((cur.mosaic_gap || 'thin') !== 'none' && self.saverKnown('mosaic_line')) {
            var lw = cur.mosaic_line > 0 ? cur.mosaic_line : (cur.mosaic_gap === 'rounded' ? 12 : 3);
            prow.push(K.slider({ label: 'Line Thickness', sk: 'saver:mosaic_line', value: lw, min: 1, max: 24, unit: ' px',
                                 onChange: function (v) { put('mosaic_line', v); } }));
            prow.push(K.select({ label: 'Line Color', sk: 'saver:mosaic_color', value: cur.mosaic_color || 'black',
              options: [['black', 'Black'], ['white', 'White'], ['gray', 'Gray'], ['charcoal', 'Charcoal'], ['cream', 'Cream'], ['navy', 'Navy']],
              onChange: function (v) { put('mosaic_color', v); } }));
          }
          prow.push(K.seg({ label: 'Changes', sk: 'saver:mosaic_change', value: cur.mosaic_change === 'all' ? 'all' : 'one', stack: !wideP,
            options: [['one', 'One Photo at a Time'], ['all', 'All at Once']], onChange: function (v) { put('mosaic_change', v); } }));
        }
        prow.push(K.seg({ label: 'Order', value: cur.order, sk: 'saver:order', options: [['random', 'Random'], ['sorted', 'In Order']],
                          onChange: function (v) { put('order', v); } }));
        if (clockMode) {
          var EP = [10, 20, 30, 60, 120, 300], ep = cur.each_photo;
          prow.push(K.select({ label: 'Each Photo For', sk: 'saver:each_photo', value: String(ep),
            options: EP.concat(EP.indexOf(ep) < 0 ? [ep] : []).map(function (n) { return [String(n), MIN(n)]; }),
            onChange: function (v) { put('each_photo', Number(v)); } }));
        }
        prow.push(tog('Slow Zoom', 'zoom', 'A slow zoom across each photo. The tablet keeps drawing the whole time, so it runs warmer.'));
        // (Titles and Time Behind -- its size, height and darkening -- are the editor's since 2026-11-01: the Photo Title
        // widget, the big time Behind the Subject)
        // (under the photos' source groups -- a folder, a host's album and its
        // import -- this one is how they show: Slideshow, never a second Photos)
        c.appendChild(K.group({ header: afterSrc ? 'Slideshow' : 'Photos', footer: (mo
            ? (upTo ? 'Up To: a new number of photos every ' + (cur.mosaic_every || 10) + ' minutes, one of them full screen now and then. ' : '') +
              'A new layout each time, picked at random — portraits in the tall cells, landscapes in the wide ones. One Photo at a Time changes one cell every ' +
              MIN(cur.each_photo).toLowerCase() + ', and after a while the whole mosaic. '
            : '') + (clockMode ? 'The same settings as the Photos show’s, for the photos behind the clock.'
            : 'Tap the left or right edge of the screensaver for the previous or next ' + (mo ? 'mosaic' : 'photo') + ', or the forecast details for the Weather page; anywhere else closes it.') },
              prow));
        this.saverShape(c, cur, put, 'portrait', mo);
        this.saverShape(c, cur, put, 'landscape', mo);
      }

      // PORTRAIT OR LANDSCAPE PHOTOS (2026-10-13), each their own: Whole (over
      // a blurred copy: its Blur and Dim) or Fill the Screen, a Zoom, and the
      // Focus -- which part stays when it's cropped, or where a whole one sits.
      // A change here turns the preview to a photo of that shape.
      saverShape(c, cur, put, side, mosaic) {
        var self = this, P = side === 'portrait';
        if (!this.saverKnown(side + '_zoom')) return;    // Home Assistant not restarted yet
        var k = function (x) { return side + '_' + x; };
        var fillKey = P ? 'portrait_fill' : 'fill', fill = P ? !!cur.portrait_fill : cur.fill !== false;
        var set = function (key, v) {
          if (self._saverShape !== side) { self._saverShape = side; self.saverPreview(true); }
          put(key, v);
        };
        // (in a mosaic every photo fills its cell: Show As and the copy behind
        // a whole one don't apply -- the Zoom and Focus do, in each cell)
        if (mosaic) fill = true;
        var rows = mosaic ? [] : [K.seg({ label: 'Show As', sk: 'saver:' + fillKey, value: fill ? 'fill' : 'whole', options: [['whole', 'Whole'], ['fill', 'Fill the Screen']],
                            onChange: function (v) { set(fillKey, v === 'fill'); } })];
        if (!fill) {
          rows.push(K.slider({ label: 'Background Blur', sub: 'The blurred copy around it', sk: 'saver:' + k('blur'), value: cur[k('blur')], min: 0, max: 100, step: 5, unit: '%',
                               onChange: function (v) { set(k('blur'), v); } }));
          rows.push(K.slider({ label: 'Background Dim', sk: 'saver:' + k('dim'), value: cur[k('dim')], min: 0, max: 80, step: 5, unit: '%',
                               onChange: function (v) { set(k('dim'), v); } }));
        }
        rows.push(K.slider({ label: 'Zoom', sk: 'saver:' + k('zoom'), value: cur[k('zoom')], min: 100, max: 200, step: 5, unit: '%',
                             onChange: function (v) { set(k('zoom'), v); } }));
        var cropped = fill || cur[k('zoom')] > 100;
        rows.push(K.seg({ label: cropped ? 'Vertical Focus' : 'Vertical Position', sk: 'saver:' + k('y'), value: cur[k('y')] || 'center',
                          options: [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']], onChange: function (v) { set(k('y'), v); } }));
        rows.push(K.seg({ label: cropped ? 'Horizontal Focus' : 'Horizontal Position', sk: 'saver:' + k('x'), value: cur[k('x')] || 'center',
                          options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], onChange: function (v) { set(k('x'), v); } }));
        var def = P ? { portrait_fill: false } : { fill: true };
        def[k('blur')] = 50; def[k('dim')] = 20; def[k('zoom')] = 100; def[k('x')] = 'center'; def[k('y')] = 'center';
        var custom = Object.keys(def).some(function (x) { return cur[x] !== def[x]; });
        if (custom) rows.push(K.button({ label: 'Reset to Default', sk: 'saver:' + side + ':default', onClick: function () { set(def); } }));
        c.appendChild(K.group({ header: P ? 'Portrait Photos' : 'Landscape Photos', footer: mosaic
            ? 'In the mosaic each photo fills its cell; Focus is the part that stays' + (P ? ' — Top keeps faces in most portraits' : '') + ', and Zoom closes in on it.'
            : (fill
            ? 'Fill the Screen crops it to the screen’s shape; Focus is the part that stays' + (P ? ' — Top keeps faces in most portraits.' : '.')
            : 'Whole: all of it, over a blurred copy of itself; Position is where it sits when there’s room around it.') +
          ' Zoom closes in on the ' + (cropped ? 'focus' : 'position') + '. Choose ' + (P ? 'Portrait' : 'Landscape') + ' above the preview to see one.' }, rows));
      }

      // ALL SCREENS' SCREENSAVER (All Screens → Screensaver): every screen whose
      // Same as All Screens is on uses these. The preview shows the first such
      // screen's screensaver.
      h_saver(c) {
        var self = this, cur = M.saverOptions(this.hs('look.saver')), boards = this.data.boards || {};
        var savers = Object.keys(boards).filter(function (p) { return boards[p].screensaver; });
        var follow = savers.filter(function (p) { return M.saverFollows(boards[p]); });
        // THE EDITOR (2026-11-01), for every screen that uses these
        if (savers.length) this.saverEditRow(c, '#/house/screensaver/editor', cur, this.saverPutH(),
          'Saved designs here are shared by screens using Same as All Screens. Each screen keeps its own Side Pane.');
        // THE PHOTOS (2026-10-09: on Wall Tablets before): where they come from,
        // in the Photos group's place (2026-10-30: first on the page before) --
        // drawn on every show, as screens with their own may show photos
        var hx = this.host();
        var photoSrc = function (c2) {
          c2.appendChild(K.group({ header: 'Photos', footer: 'A media folder (media-source://…) of the photos every screen’s screensaver shows.' }, [
            K.text({ label: 'Screensaver Photos', sk: 'look.photos', value: self.hs('look.photos'), placeholder: 'media-source://…', error: self.err('look.photos'),
                     onCommit: function (v) { self.setH({ 'look.photos': v }); } })]));
          // THE HOST'S OWN beside the photos (extend): nothing in Home Assistant
          if (hx && typeof hx.extend === 'function') {
            try { hx.extend('house-saver', c2, { photos: self.hs('look.photos'), set: function (v) { return self.setH({ 'look.photos': v }); } }, self); } catch (e) { /* the host's own group */ }
          }
          return true;
        };
        this.saverGroups(c, cur, function (k, v) {
          var o = M.saverOptions(cur); if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
          return self.setH({ 'look.saver': self.saverOut(o) });
        }, '#/house/screensaver/clock-style', null, photoSrc);
        var name = function (p) { return (self.dash(p) || { title: p }).title; };
        c.appendChild(K.group({ header: 'Screens', footer: savers.length
            ? 'A screen with its own settings keeps them; turn on Same as All Screens on its Screensaver Options to use these.'
            : 'No screen has its Screensaver on yet (on the screen’s page).' },
          savers.map(function (p) {
            var own = follow.indexOf(p) < 0;
            return K.nav({ label: name(p), value: own ? 'Just This Screen' : 'Same as All Screens',
                           href: '#/screens/' + encodeURIComponent(p) + '/screensaver', sk: 'saver:screen:' + p });
          })));
        if (M.saverCustom(cur)) {
          c.appendChild(K.group({}, [K.button({ label: 'Reset to Defaults…', destructive: true, fk: 'saver:house-reset', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Use the default screensaver options?', message: 'The settings for All Screens go back to their defaults.',
                                         ok: 'Use Defaults', destructive: true }).then(function (yes) {
              if (yes) self.setH({ 'look.saver': self.saverOut(M.saverOptions(null)) });
            });
          } })]));
        }
      }

      // FOR AUTOMATIONS: the screen's own switch and in-use sensor, which HK
      // Frontend makes for it (screensaver.py) -- nothing to create by hand
      saverEntities(b, path) {
        var self = this, mine = (b.tablets || []).filter(function (tid) { return self.tabs()[tid]; });
        if (!mine.length) {
          return K.group({ header: 'For Automations', footer: 'Add the wall tablet that shows this screen (Wall Tablets) and ' + haName('HK Frontend') +
            ' adds its screensaver switch and In Use sensor.' }, []);
        }
        var row = function (label, id, sub) {
          if (!id) return K.info({ label: label, sub: sub, value: 'Being added…' });
          var a = K.nav({ label: label, sub: id, href: '#', sk: 'saver:ent:' + id, value: self.stateLabel(id) });
          a.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            window.hkShell.moreInfo(id, self);
          });
          return a;
        };
        var rows = [];
        mine.forEach(function (tid) {
          var e = (self.data.screensavers || {})[tid] || {}, nm = mine.length > 1 ? self.tabs()[tid].name + ': ' : '';
          rows.push(row(nm + 'Photo Screensaver', e['switch'], 'On while the photos show'));
          rows.push(row(nm + 'In Use', e.in_use, 'Touched within its window'));
        });
        var room = b.idle_room, leg = room && this.client && this.client.states['input_boolean.wallpanel_screensaver_' + room];
        return K.group({ header: 'For Automations', footer: 'Each wall tablet’s own. Photo Screensaver is on while the photos show: turn it on to start them now ' +
            '(bedtime, say), off to close them (the doorbell). In Use is on while the tablet was touched within its window.' +
            (leg ? ' The older input_boolean.wallpanel_screensaver_' + room + ' follows it both ways until you delete it.' : '') }, rows);
      }
    };
    KIT.install(Methods);
  };
})();
