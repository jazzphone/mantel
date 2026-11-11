// hk-settings-module-house.js - what the page reads of the house: the weather, the calendar, the moon, the season and the sky window.
//
// PART OF THE HK SETTINGS MODULE (window.hkSettings) (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSettingsModuleParts = window.hkSettingsModuleParts || {})['hk-settings-module-house'] = function (K) {
    var boardHere = K.boardHere, DEFAULTS = K.DEFAULTS, get = K.get, skyLook = K.skyLook;

    // ------------------------------------------------------------ helpers
    function st(states, id) { return (id && states && states[id]) || null; }

    // THE WEATHER PAGE (settings weather.page): what it shows, each key
    // checked against its defaults (a bad one is the default, never a throw)
    var WX_DETAILS = ['wind', 'sun', 'uv', 'humidity', 'moon', 'pressure'];
    function weatherPage() {
      var d = DEFAULTS.weather.page, o = get('weather.page', null) || {}, out = {};
      Object.keys(d).forEach(function (k) {
        var v = o[k], def = d[k];
        if (k === 'details') {
          out[k] = Array.isArray(v) ? v.filter(function (x, i) { return WX_DETAILS.indexOf(x) >= 0 && v.indexOf(x) === i; }) : def.slice();
        } else if (typeof def === 'boolean') out[k] = typeof v === 'boolean' ? v : def;
        else if (k === 'hours') out[k] = [6, 12, 24].indexOf(v) >= 0 ? v : def;
        else if (k === 'days') out[k] = [5, 8, 10].indexOf(v) >= 0 ? v : def;
        else if (k === 'hourly_metric') out[k] = ['temperature', 'rain', 'wind'].indexOf(v) >= 0 ? v : def;
        else out[k] = def;
      });
      return out;
    }
    // THE RADAR (settings weather.radar_native), each key checked likewise
    function radarNative() {
      var d = DEFAULTS.weather.radar_native, o = get('weather.radar_native', null) || {}, out = {};
      var whole = function (v, lo, hi, def) { return typeof v === 'number' && isFinite(v) && Math.round(v) === v && v >= lo && v <= hi ? v : def; };
      var one = function (v, list, def) { return list.indexOf(v) >= 0 ? v : def; };
      Object.keys(d).forEach(function (k) {
        var v = o[k], def = d[k];
        if (typeof def === 'boolean') out[k] = typeof v === 'boolean' ? v : def;
        else if (k === 'provider') out[k] = one(v, ['auto', 'noaa', 'rainviewer'], def);
        else if (k === 'basemap') out[k] = one(v, ['osm'], def);
        else if (k === 'center') out[k] = one(v, ['home', 'zone'], def);
        else if (k === 'zone') out[k] = typeof v === 'string' && /^zone\.[a-z0-9_]+$/.test(v) ? v : null;
        else if (k === 'zoom') out[k] = whole(v, 4, 10, def);
        else if (k === 'opacity') out[k] = whole(v, 20, 100, def);
        else if (k === 'history_minutes') out[k] = one(v, [30, 60, 120], def);
        else if (k === 'playback_speed') out[k] = one(v, ['slow', 'normal', 'fast'], def);
        else out[k] = def;
      });
      return out;
    }
    // THE PAGES SCREEN AS THIS SCREEN SHOWS IT (settings.py
    // pages_screen_resolved): each field the screen's own (its board's
    // pages_screen, only the fields it sets), else All Screens' -- each checked
    // as the server checks it, a bad one the default. `b`: a board (default:
    // this screen's).
    var PS_CHECK = {
      show: function (v) { return v === 'on' || v === 'off' ? v : null; },
      clock: function (v) { return v === 'on' || v === 'off' ? v : null; },
      icons: function (v) {
        if (v === 'menu') return v;
        return Array.isArray(v) && v.every(function (x, i) { return typeof x === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(x) && v.indexOf(x) === i; })
          ? v.slice() : null;
      },
      rooms: function (v) { return ['folder', 'each', 'none'].indexOf(v) >= 0 ? v : null; },
      widgets: function (v) {
        if (!Array.isArray(v)) return null;
        var out = [];
        for (var i = 0; i < v.length; i++) {
          var w = v[i];
          if (!w || typeof w !== 'object' || typeof w.kind !== 'string') return null;
          out.push({ kind: w.kind, size: w.size === 'less' ? 'less' : 'more', place: w.place === 'left' ? 'left' : 'right' });
        }
        return out;
      },
      pill: function (v) { return ['auto', 'on', 'off'].indexOf(v) >= 0 ? v : null; }
    };
    function pagesScreen(b) {
      if (b === undefined) b = boardHere();
      var d = DEFAULTS.pages_screen, house = get('pages_screen', null) || {}, own = (b && b.pages_screen) || {}, out = {};
      Object.keys(d).forEach(function (k) {
        var mine = own[k] !== undefined ? PS_CHECK[k](own[k]) : null, all = house[k] !== undefined ? PS_CHECK[k](house[k]) : null;
        out[k] = mine !== null ? mine : all !== null ? all : (Array.isArray(d[k]) ? d[k].slice() : d[k]);
      });
      return out;
    }
    // WHERE AND FROM WHOM THE RADAR COMES (hk-radar.js, the settings' summary):
    //   { enabled, provider: 'noaa' | 'rainviewer' | null, chosen, lat, lon,
    //     place, country, reason }
    // Automatic is NOAA for a home Home Assistant places in the US, RainViewer
    // for one it places elsewhere. Another zone's country is not known (no
    // lookup is made), so Automatic there asks for a provider (reason
    // 'choose'); so does a home with no country set. A zone that is gone:
    // 'zone'. No location at all: 'location'.
    function radarPlan(client) {
      var r = radarNative(), cfg = (client && client.config) || {}, states = (client && client.states) || {};
      var out = { enabled: r.enabled, provider: null, chosen: r.provider, lat: null, lon: null,
                  place: 'Home', country: null, reason: null, settings: r };
      if (r.center === 'zone') {
        var z = r.zone && states[r.zone], za = (z && z.attributes) || {};
        out.place = za.friendly_name || (r.zone ? r.zone.replace(/^zone\./, '').replace(/_/g, ' ') : 'Zone');
        if (!z || typeof za.latitude !== 'number' || typeof za.longitude !== 'number') { out.reason = 'zone'; }
        else { out.lat = za.latitude; out.lon = za.longitude; }
      } else {
        if (typeof cfg.latitude === 'number' && typeof cfg.longitude === 'number') { out.lat = cfg.latitude; out.lon = cfg.longitude; }
        else out.reason = 'location';
        out.country = cfg.country || null;
      }
      if (r.provider !== 'auto') out.provider = r.provider;
      else if (out.country) out.provider = out.country === 'US' ? 'noaa' : 'rainviewer';
      else if (!out.reason) out.reason = 'choose';
      return out;
    }

    // The weather entity: the chosen one -- even if it is missing, so a broken
    // choice shows as '--' rather than silently reading another -- or, when
    // nothing is chosen, the first weather entity in the house.
    function weatherId(states) {
      var id = get('weather.entity');
      if (id) return id;
      var ids = Object.keys(states || {}).filter(function (k) { return k.indexOf('weather.') === 0; });
      ids.sort();
      return ids[0] || null;
    }

    // THE WEATHER NOW, one number on every screen (2026-11-01, the owner: the Side Pane said 56° beside the
    // Weather block's 65°): the sensor Settings -> Weather names for it, when it reads, as the Weather page reads
    // it -- else the weather entity's own attribute (wid, else weatherId). A number, or null.
    var NOW_ATTR = { outside: 'temperature', feels_like: 'apparent_temperature', humidity: 'humidity', wind: 'wind_speed',
                     gust: 'wind_gust_speed', uv: 'uv_index' };
    function nowRead(states, key, wid) {
      states = states || {};
      var n = function (x) { return x != null && x !== '' && isFinite(Number(x)) ? Number(x) : null; };
      var sid = get('weather.' + key), s = sid && states[sid], v = s ? n(s.state) : null;
      if (v !== null) return v;
      var w = states[wid || weatherId(states)];
      return w && w.attributes ? n(w.attributes[NOW_ATTR[key]]) : null;
    }
    function nowTemp(states, wid) { return nowRead(states, 'outside', wid); }

    // THE CALENDARS: the chosen ones, in their order, that exist -- or, when
    // none is chosen, every calendar in the house, A to Z. And each one's
    // colour: its own, else the next of CAL_COLORS by its place in the list.
    var CAL_COLORS = ['orange', 'green', 'purple', 'blue', 'pink', 'yellow', 'teal', 'red', 'mint', 'white'];
    function calendarIds(states) {
      var mine = get('calendar.entities') || [];
      if (mine.length) return mine.filter(function (id) { return !!st(states, id); });
      return Object.keys(states || {}).filter(function (k) { return k.indexOf('calendar.') === 0; }).sort();
    }
    function calendarColor(id, states) {
      var own = (get('calendar.colors') || {})[id];
      if (own) return own;
      var i = calendarIds(states).indexOf(id);
      return CAL_COLORS[(i < 0 ? 0 : i) % CAL_COLORS.length];
    }

    // AN EVENT'S COLOR (2026-10-16): its own, picked on its sheet (by its
    // series' uid, else its title); else the first keyword in its title
    // (Configure -> Calendars -> Colors by Keyword); else its calendar's
    function eventKey(title, uid) {
      return uid ? 'uid:' + uid : 'title:' + String(title || '').trim().toLowerCase();
    }
    function keywordColor(title) {
      var t = String(title || '').toLowerCase();
      var hit = (get('calendar.keywords') || []).filter(function (k) {
        var w = String(k.word || '').trim().toLowerCase();
        if (!w) return false;
        // a whole word (Doctor, not "doctorate"), any case
        var re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
        return re.test(t);
      })[0];
      return hit ? hit.color : null;
    }
    function eventColor(cal, title, uid, states) {
      var own = (get('calendar.event_colors') || {})[eventKey(title, uid)];
      return own || keywordColor(title) || calendarColor(cal, states);
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    // { time: 'HH:MM', date: 'YYYY-MM-DD' } from the Time & Date sensors when
    // they exist, else from this screen's own clock.
    function clock(states) {
      var t = st(states, get('clock.time')), d = st(states, get('clock.date'));
      var now = new Date();
      return {
        time: t ? t.state : pad(now.getHours()) + ':' + pad(now.getMinutes()),
        date: d ? d.state : now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
      };
    }

    // 0 new, 0.5 full, back to 1. The chosen sensor, else the synodic month
    // counted from a known new moon (6 January 2000, 18:14 UTC) -- continuous, and
    // good to well under a percent.
    function moon(states, when) {
      var s = st(states, get('sky.moon'));
      if (s) {
        var v = Number(s.state);
        return isFinite(v) ? v : 0.5;
      }
      if (get('sky.moon')) return 0.5;       // chosen but missing: full
      var syn = 29.530588853 * 86400000;
      var ref = Date.UTC(2000, 0, 6, 18, 14);
      var f = (((when || new Date()).getTime() - ref) / syn) % 1;
      return f < 0 ? f + 1 : f;
    }

    // The holiday SEASON the sky dresses for: the chosen sensor's state, else
    // the same windows computed from the date -- Halloween Sep 22..Oct 31,
    // Thanksgiving Nov 1..Thanksgiving Day, Christmas the day after..Dec 25.
    function seasonName(states, when) {
      var id = get('sky.holidays');
      if (id) {
        var h = st(states, id);
        return ((h && h.state) || '').trim();
      }
      var d = when || new Date();
      // Christmas is tested before Thanksgiving, so a house that moves
      // Christmas into November wins it.
      var order = ['halloween', 'christmas', 'thanksgiving'];
      for (var i = 0; i < order.length; i++) {
        if (skyWindow(order[i], d).inside) {
          return order[i].charAt(0).toUpperCase() + order[i].slice(1);
        }
      }
      return '';
    }

    // ------------------------------------------------------ the sky calendar
    // WHEN each sky theme may run (Configure -> Seasonal sky -> Season dates /
    // Surprise dates). Every date is MM-DD and empty means built in:
    var BUILT_IN = {
      halloween: ['09-22', '10-31'], thanksgiving: ['11-01', 'thanksgiving'],
      // The garland stays out of early December: the decoration is eligible
      // for the last 18 days, which is what 12-07 is.
      christmas: ['12-07', '12-25'],
      july4: ['06-28', '07-04'], valentines: ['02-08', '02-14'],
      spring: ['03-20', '06-20'], winter: ['12-21', '03-19']
    };
    // The southern hemisphere's spring and winter are six months on.
    var SOUTH = { spring: ['09-22', '12-20'], winter: ['06-21', '09-21'] };

    function usThanksgiving(y) {
      var nov1 = new Date(y, 10, 1);
      return new Date(y, 10, 1 + (4 - nov1.getDay() + 7) % 7 + 21);   // 4th Thursday
    }
    function mmdd(v) {
      var m = /^(\d{1,2})-(\d{1,2})$/.exec(String(v || '').trim());
      return m ? [Number(m[1]), Number(m[2])] : null;
    }
    // The date `v` names, in year y ('thanksgiving' is US Thanksgiving).
    function onYear(v, y) {
      if (v === 'thanksgiving') return usThanksgiving(y);
      var p = mmdd(v);
      return p ? new Date(y, p[0] - 1, p[1]) : null;
    }
    function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function between(a, b) { return Math.round((day0(b) - day0(a)) / 86400000); }

    // skyWindow('halloween', date) -> {inside, daysToEnd, length, from, to}
    //   inside     the date is within the window (a window may wrap the new
    //              year: 12-20 .. 01-05);
    //   daysToEnd  whole days to the window's last day (0 on it);
    //   length     whole days from its first day to its last.
    function skyWindow(theme, when) {
      var d = day0(when || new Date());
      var south = get('sky.hemisphere', 'north') === 'south';
      var dflt = (south && SOUTH[theme]) || BUILT_IN[theme];
      var from = get('sky.' + theme + '_from') || dflt[0];
      var to = get('sky.' + theme + '_to') || dflt[1];
      var y = d.getFullYear();
      // The window that contains d starts this year or last (a wrapping one);
      // its end is the first `to` on or after that start.
      var cands = [y, y - 1];
      for (var i = 0; i < cands.length; i++) {
        var start = onYear(from, cands[i]);
        if (!start) break;
        var end = onYear(to, cands[i]);
        if (!end) break;
        if (end < start) end = onYear(to, cands[i] + 1);
        if (d >= start && d <= end) {
          return { inside: true, daysToEnd: between(d, end), length: between(start, end),
                   from: start, to: end };
        }
      }
      return { inside: false, daysToEnd: -1, length: 0 };
    }

    // How often: a season 'every_day' | 'sometimes' | 'near_end'; spring and
    // winter 'often' | 'sometimes' | 'rarely'; storybook and space night, days
    // a month. Empty is the built-in 'sometimes' / once a month.
    function often(key, dflt) { return get('sky.' + key) || dflt; }

    // Is seasonal decoration allowed? The integration's own switch (Seasonal
    // decorations, stored as sky.decorations) must be on, and so must the
    // optional extra entity when one is chosen -- only an explicit 'off' of
    // that one says no.
    function seasonalOn(states) {
      if (!skyLook().decorations) return false;
      var g = st(states, get('sky.seasonal'));
      return !(g && g.state === 'off');
    }

    // THE UNIT A READING IS IN, for its label -- never assumed (never a fixed
    // "mph" or "°F" whatever the house measures in): a sensor's own
    // unit_of_measurement, else the weather entity's attribute for it
    // (wind_speed_unit, temperature_unit), else `fallback`.
    function unit(stateObj, attr, fallback) {
      var a = (stateObj && stateObj.attributes) || {};
      return a.unit_of_measurement || (attr && a[attr]) || fallback;
    }

    // May this sky theme run? Configure -> Seasonal sky -> Themes.
    function themeOn(id) {
      var t = get('sky.themes');
      return !Array.isArray(t) || t.indexOf(id) !== -1;
    }

    // what the shell and the later parts use of this one
    K.calendarColor = calendarColor; K.calendarIds = calendarIds; K.clock = clock; K.eventColor = eventColor;
    K.eventKey = eventKey; K.keywordColor = keywordColor; K.moon = moon; K.nowRead = nowRead; K.nowTemp = nowTemp;
    K.often = often; K.pagesScreen = pagesScreen; K.radarNative = radarNative; K.radarPlan = radarPlan;
    K.seasonalOn = seasonalOn; K.seasonName = seasonName; K.skyWindow = skyWindow; K.themeOn = themeOn; K.unit = unit;
    K.weatherId = weatherId; K.weatherPage = weatherPage;
  };
})();
