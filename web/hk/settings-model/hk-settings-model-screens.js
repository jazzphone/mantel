// hk-settings-model-screens.js - wall tablets, the Weather page, the side pane and the looks.
//
// PART OF THE SETTINGS MODEL (hk-settings-model.js). Not a card and not run on its own: it registers one
// function, which hk-settings-model.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsModelParts = window.hkSettingsModelParts || {})['hk-settings-model-screens'] = function (K) {
    var choiceLabel = K.choiceLabel, GLASS_STYLES = K.GLASS_STYLES, listText = K.listText, TILE_ICONS = K.TILE_ICONS,
        TILE_STYLES = K.TILE_STYLES, WALLPAPER_MOTION = K.WALLPAPER_MOTION, WALLPAPER_NIGHT = K.WALLPAPER_NIGHT;

    // ------------------------------------------------------------ wall tablets (1.14)
    // A TABLET'S KIOSK APP: [id, name, what HK can do with it]
    var TABLET_APPS = [
      ['kiosk_satellite', 'Kiosk Satellite', 'Status, brightness, wake, sleep, restart.'],
      ['fully', 'Fully Kiosk', 'Status, brightness, reload, restart.'],
      ['wallpanel', 'WallPanel', 'HK’s idle and screensaver in the browser; no status.'],
      ['browser', 'Just a Browser', 'Any browser you say is a tablet: HK’s idle and screensaver.']
    ];
    function tabletApp(id) { return TABLET_APPS.filter(function (a) { return a[0] === id; })[0] || TABLET_APPS[3]; }
    // Idle Time (settings.IDLE_TIMES), seconds; 0 never
    var IDLE_TIMES = [[30, '30 Seconds'], [50, '50 Seconds'], [60, '1 Minute'], [120, '2 Minutes'], [300, '5 Minutes'], [0, 'Never']];
    function idleLabel(sec) {
      var hit = IDLE_TIMES.filter(function (o) { return o[0] === sec; })[0];
      return hit ? hit[1] : sec + ' s';
    }
    function secsLabel(sec) { return sec < 60 ? sec + ' s' : (sec % 60 ? Math.round(sec / 6) / 10 : sec / 60) + ' min'; }
    // WHAT A TABLET IS DOING NOW, from its kiosk app (t.parts, tablets.py) and
    // its own entities (`ids`: the panel's screensavers[tid]): Offline, Dark,
    // Screensaver or Awake, why (Sleep Screen's reason), since when, and its
    // battery
    var TABLET_WORDS = { off: 'Offline', dark: 'Dark', photos: 'Screensaver', awake: 'Awake' };
    function tabletStatus(t, states, ids) {
      var p = (t && t.parts) || {}, s = function (id) { return (id && states && states[id]) || null; };
      ids = ids || {};
      var on = s(p.online), bat = s(p.battery), chg = s(p.charging), scr = s(p.screen);
      var black = s(ids.black), photos = s(ids['switch']), sleep = s(ids.sleep);
      var st = 'awake', since = null;
      if ((on && on.state === 'off') || (p.battery && (!bat || bat.state === 'unavailable'))) {
        st = 'off'; since = (on && on.state === 'off' ? on : bat || {}).last_changed || null;
      } else if (black && black.state === 'on') { st = 'dark'; since = black.last_changed; }
      else if (photos && photos.state === 'on') { st = 'photos'; since = photos.last_changed; }
      else if (scr && scr.state === 'off') { st = 'dark'; since = scr.last_changed; }
      var b = bat ? Number(bat.state) : NaN;
      return { st: st, word: TABLET_WORDS[st], since: since || null,
               why: (st !== 'off' && sleep && sleep.attributes && sleep.attributes.reason) || '',
               batt: isFinite(b) ? Math.round(b) : null, charging: chg ? chg.state === 'on' : null,
               known: !!(p.battery || ids.black || ids['switch']) };
    }
    // THE TABLET'S KIOSK APP AGAINST WHAT HK NEEDS -- the same rules as
    // tablets.py checks() (Setup Check): [{key, ok, title, detail, fix}];
    // fix: [domain, service, data] (or ['hk', 'kiosk_saver'])
    var SAVER_TIMEOUT = 86400, BATTERY_CARE = 85;
    function tabletChecks(t, states) {
      var p = (t && t.parts) || {}, out = [];
      var val = function (id) { var x = id && states && states[id]; return x ? x.state : null; };
      if (!Object.keys(p).length) return out;
      if (val(p.online) === 'off' || (p.battery && (val(p.battery) === null || val(p.battery) === 'unavailable'))) {
        out.push({ key: 'online', ok: false, title: 'Kiosk App Not Heard From',
                   detail: 'It may be off the Wi-Fi, or behind the lock screen after a restart.' });
      }
      if (p.adaptive) {
        var on = val(p.adaptive) === 'on';
        out.push({ key: 'adaptive', ok: !on, title: 'Adaptive Brightness Off',
                   detail: on ? 'On: Android changes the brightness, and fights Sleep Screen’s.' : 'Sleep Screen sets the brightness.',
                   fix: ['switch', 'turn_off', { entity_id: p.adaptive }] });
      }
      if (t.app === 'kiosk_satellite' && p.saver_mode) {
        var mode = val(p.saver_mode), tmo = Number(val(p.saver_timeout));
        var good = mode === 'Black' && (!p.saver_timeout || !isFinite(tmo) || tmo >= SAVER_TIMEOUT);
        out.push({ key: 'saver', ok: good, title: 'Kiosk Screensaver: Black, after 1 day',
                   detail: good ? 'HK’s screensaver and black do the work.'
                     : 'It is ' + (mode || 'unknown') + ', after ' + (isFinite(tmo) ? tmo : 0) + ' s: it can come up over HK’s.',
                   fix: ['hk', 'kiosk_saver'] });
      }
      if (p.kiosk_mode) {
        var km = val(p.kiosk_mode) === 'on';
        out.push({ key: 'kiosk_mode', ok: km, title: 'Kiosk Mode On',
                   detail: km ? 'Nobody can leave the dashboard by accident.' : 'Off: anybody can leave the dashboard.',
                   fix: p.kiosk_mode.indexOf('switch.') === 0 ? ['switch', 'turn_on', { entity_id: p.kiosk_mode }] : null });
      }
      if (p.update) {
        var up = val(p.update) === 'on';
        out.push({ key: 'update', ok: !up, title: 'App Up to Date', detail: up ? 'An update is waiting.' : '', fix: null });
      }
      var bat = Number(val(p.battery)), chg = val(p.charging);
      if (p.battery && p.charging && isFinite(bat) && chg !== null) {
        var hot = chg === 'on' && bat > BATTERY_CARE;
        out.push({ key: 'battery', ok: !hot, title: 'Battery Care', fix: null,
                   detail: hot ? Math.round(bat) + '% and charging all day. Turn on Protect Battery on the tablet.'
                     : Math.round(bat) + '% ' + (chg === 'on' ? 'while plugged in.' : 'and not charging.') });
      }
      return out;
    }
    // WHEN IT'S LEFT ALONE, in order: Home after Idle Time (null: Return to
    // Home is off), the screensaver at its Starts After (null: no
    // screensaver), dark by Sleep Screen. {segs: [{cls, label, flex, at, says}],
    // warn: Home comes only after the screensaver is up}
    function idleTimeline(o) {
      var idle = o.idle, saver = o.saver, segs = [{ cls: 'use', label: 'Touched', flex: 2 }];
      var dark = o.hk ? (o.after ? 'after ' + o.after + ' min of photos' : (o.quiet ? 'nobody here, or quiet hours' : 'once nobody’s here'))
                      : 'an automation decides';
      if (idle && saver && idle > saver) {
        segs.push({ cls: 'saver', label: 'Screensaver', flex: 1.6, at: secsLabel(saver), says: 'screensaver' });
        segs.push({ cls: 'home', label: 'Home, behind it', flex: 1.4, at: secsLabel(idle), says: 'Home' });
      } else {
        if (idle) segs.push({ cls: 'home', label: 'Home', flex: 1.4, at: secsLabel(idle), says: saver === idle ? 'Home + screensaver' : 'Home' });
        if (saver && saver !== idle) segs.push({ cls: 'saver', label: 'Screensaver', flex: 3, at: secsLabel(saver), says: 'screensaver' });
      }
      segs.push({ cls: 'dark', label: 'Dark', flex: 3, at: 'Sleep Screen', says: dark });
      return { segs: segs, warn: !!(idle && saver && idle > saver) };
    }
    // THE TABLET'S START URL: its screen with ?hk_tablet=<id>
    function tabletUrl(origin, screen, id) {
      return String(origin || '').replace(/\/+$/, '') + '/' + (screen || 'lovelace') + '?hk_tablet=' + id;
    }

    // ------------------------------------------------------ the Weather page
    // (2026-10-16, hk_house/docs/PLAN-2026-10-16-weather-page.md): what the
    // page shows (weather.page) and its own radar (weather.radar_native). The
    // defaults are settings.py's WEATHER_PAGE_DEFAULTS / RADAR_DEFAULTS (and
    // hk-settings.js DEFAULTS.weather -- test_settingsmodel holds them equal).
    var WX_DETAILS = [['wind', 'Wind', 'hk:weather-windy'], ['sun', 'Sunrise & Sunset', 'hk:weather-sunset'],
                      ['uv', 'UV Index', 'hk:white-balance-sunny'], ['humidity', 'Humidity', 'hk:water-percent'],
                      ['moon', 'Moon', 'hk:weather-night'], ['pressure', 'Pressure', 'mdi:gauge']];
    var WX_PAGE_DEFAULTS = { show_current: true, show_hourly: true, show_daily: true, show_alerts: true,
                             hours: 12, days: 8, hourly_metric: 'temperature',
                             details: ['wind', 'sun', 'uv', 'humidity', 'moon', 'pressure'], load_animation: true };
    var WX_HOURS = [[6, '6'], [12, '12'], [24, '24']];
    var WX_DAYS = [[5, '5'], [8, '8'], [10, '10']];
    var WX_METRICS = [['temperature', 'Temperature'], ['rain', 'Rain'], ['wind', 'Wind']];
    var RADAR_DEFAULTS = { version: 1, enabled: false, provider: 'auto', basemap: 'osm', center: 'home', zone: null,
                           zoom: 5, marker: true, history_minutes: 60, playback_speed: 'normal', autoplay: true,
                           interactive: true, playback_controls: true, opacity: 75 };
    var RADAR_PROVIDERS = [['auto', 'Automatic'], ['noaa', 'NOAA (US)'], ['rainviewer', 'RainViewer']];
    var RADAR_NAMES = { noaa: 'NOAA', rainviewer: 'RainViewer' };
    var RADAR_BASEMAPS = [['osm', 'OpenStreetMap']];
    var RADAR_CENTERS = [['home', 'Home'], ['zone', 'A Zone']];
    var RADAR_HISTORY = [[30, '30 Minutes'], [60, '1 Hour'], [120, '2 Hours']];
    var RADAR_SPEEDS = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
    // the Weather Radar Card's options the native radar took over (settings.py
    // RADAR_LEGACY_MAPPED); the rest are kept, unused
    var RADAR_LEGACY_MAPPED = ['data_source', 'zoom_level', 'static_map', 'show_playback', 'markers'];
    function wxPage(st) {
      var o = ((st || {}).weather || {}).page;
      var out = JSON.parse(JSON.stringify(WX_PAGE_DEFAULTS));
      if (o && typeof o === 'object') Object.keys(out).forEach(function (k) { if (k in o) out[k] = o[k]; });
      return out;
    }
    function radarOf(st) {
      var o = ((st || {}).weather || {}).radar_native;
      var out = Object.assign({}, RADAR_DEFAULTS);
      if (o && typeof o === 'object') Object.keys(out).forEach(function (k) { if (k in o) out[k] = o[k]; });
      return out;
    }
    // "12 Hours · 8 Days · 6 Details": what is configured, not what the
    // service happens to give
    function forecastSummary(p) {
      var bits = [];
      if (p.show_hourly) bits.push(p.hours + ' Hours');
      if (p.show_daily) bits.push(p.days + ' Days');
      bits.push(p.details.length ? p.details.length + (p.details.length === 1 ? ' Detail' : ' Details') : 'No Details');
      return bits.join(' · ');
    }
    // WHERE AND FROM WHOM (hk-settings.js radarPlan, the same rules): the
    // radar's settings `r` and the house -> { provider, place, lat, lon,
    // country, reason }. Automatic: NOAA for a home Home Assistant places in
    // the US, RainViewer elsewhere; a zone's country is not known (nothing is
    // looked up), so there Automatic asks (reason 'choose').
    function radarPlanOf(r, client) {
      var cfg = (client && client.config) || {}, states = (client && client.states) || {};
      var out = { enabled: !!r.enabled, provider: null, chosen: r.provider, lat: null, lon: null, place: 'Home', country: null, reason: null };
      if (r.center === 'zone') {
        var z = r.zone && states[r.zone], za = (z && z.attributes) || {};
        out.place = za.friendly_name || (r.zone ? r.zone.replace(/^zone\./, '').replace(/_/g, ' ') : 'Zone');
        if (!z || typeof za.latitude !== 'number' || typeof za.longitude !== 'number') out.reason = 'zone';
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
    var RADAR_REASONS = {
      choose: 'Choose a radar provider: Automatic can’t tell which country this place is in.',
      zone: 'The zone chosen for the map isn’t in Home Assistant, or has no location.',
      location: 'Home Assistant has no location for this home (Settings → System → General).'
    };
    // the Radar Map row's value: "Off", "NOAA · Home", or what it needs
    function radarSummary(r, plan) {
      if (!r.enabled) return 'Off';
      if (plan.reason === 'choose') return 'Choose a Provider';
      if (plan.reason === 'zone') return 'Choose a Zone';
      if (plan.reason) return 'Needs a Location';
      return RADAR_NAMES[plan.provider] + ' · ' + plan.place;
    }
    function radarAdvancedSummary(r) {
      return 'Zoom ' + r.zoom + ' · ' + choiceLabel(RADAR_HISTORY, r.history_minutes);
    }

    // ------------------------------------------------------------ the side pane
    // THE SIDE PANE (2026-10-30, settings.py side_pane; hk-sidepane.js draws
    // it): one pane per screen, its groups -- Where (Pane Side, Width), On the
    // Dashboard, In the Screensaver, Doorbell -- All Screens' or a screen's
    // own, each on its own. A screen is handed it as read (side_pane_read,
    // its `own` the groups that are the screen's); All Screens' is the house
    // section side_pane. Sections: {kind, size (absent: More), when (absent:
    // Always), and a kind's own options}, eight at most, one Full.
    var PANE_KINDS = [['clock', 'Clock', 'mdi:clock', '#8e8e93'], ['weather', 'Weather', 'mdi:weather-partly-cloudy', '#32ade6'],
      ['calendar', 'Calendar', 'mdi:calendar', '#ff3b30'], ['now_playing', 'Now Playing', 'mdi:music', '#ff2d55'],
      ['security', 'Security', 'mdi:shield-home', '#30b0c7'], ['camera', 'Camera', 'mdi:cctv', '#636366'],
      ['timers', 'Timers', 'mdi:timer-outline', '#ff9500'], ['energy', 'Energy', 'mdi:lightning-bolt', '#34c759'],
      ['climate', 'Climate', 'mdi:thermostat', '#007aff'], ['people', 'Who’s Home', 'mdi:account', '#5856d6'],
      ['todo', 'To-do', 'mdi:clipboard-check', '#ff9500'], ['notifications', 'Notifications', 'mdi:bell', '#ff3b30'], ['status', 'Status', 'mdi:card-text-outline', '#5ac8fa']];
    var PANE_SIZES = [['tiny', 'Tiny'], ['less', 'Less'], ['more', 'More'], ['full', 'Full']];
    var PANE_WHEN = [['always', 'Always'], ['active', 'When There’s Something']];
    var PANE_SIDES = [['left', 'Left'], ['right', 'Right']];
    var PANE_WIDTHS = [['narrow', 'Narrow'], ['standard', 'Standard'], ['wide', 'Wide']];
    var PANE_SHOWS = [['off', 'Off'], ['home', 'Home Only'], ['all', 'Every Page']];
    var PANE_SAVER_SHOWS = [['off', 'Off'], ['same', 'Same as the Dashboard'], ['own', 'Its Own Sections']];
    // DIM, 0 to PANE_DIM_MAX percent (settings.py; Off / Low / Medium / High for its first hours, read as these)
    // ...or 'glass' (2026-11-01, the default): Same as the Glass, Bright Glass's Dim (BRIGHT_DIM_MAX, look.bright_dim)
    var PANE_DIM_MAX = 60, PANE_DIM_WORDS = { none: 0, low: 16, medium: 30, high: 45 }, PANE_DIM_GLASS = 'glass', BRIGHT_DIM_MAX = 60;
    function paneDim(v) { return typeof v === 'string' ? (PANE_DIM_WORDS[v] || 0) : Math.max(0, Math.min(PANE_DIM_MAX, Math.round(Number(v) || 0))); }
    var PANE_GROUPS = ['side', 'width', 'dashboard', 'saver', 'doorbell', 'headings', 'dim'];
    var PANE_MAX = 8;
    var PANE_DEFAULTS = { side: 'right', width: 'standard',
      dashboard: { show: 'off', sections: [{ kind: 'weather' }, { kind: 'calendar' }, { kind: 'now_playing', when: 'active' }] },
      saver: { show: 'off', sections: [{ kind: 'clock', size: 'tiny' }, { kind: 'calendar' }, { kind: 'now_playing', size: 'less', when: 'active' }] },
      doorbell: true, headings: true, dim: 0 };
    function paneCopy(v) { return JSON.parse(JSON.stringify(v)); }
    function paneKind(k) { return PANE_KINDS.filter(function (x) { return x[0] === k; })[0] || null; }
    // a section as stored: More and Always are what absent means
    function paneSection(s) {
      var out = {};
      Object.keys(s || {}).forEach(function (k) {
        if ((k === 'size' && s[k] === 'more') || (k === 'when' && s[k] === 'always') || (k === 'completed' && !s[k]) ||
            (k === 'place' && s[k] === 'top') || (k === 'tap' && s[k] === 'auto') || (k === 'name' && s[k] === 'hide') ||
            (s.kind === 'clock' && CLOCK_ABSENT[k] !== undefined && s[k] === CLOCK_ABSENT[k]) || (s.kind === 'now_playing' && k === 'art' && s[k] !== false)) return;
        out[k] = s[k];
      });
      return out;
    }
    // THE PANE AS THIS PAGE EDITS IT: a screen's as read, else All Screens'
    // (over the defaults); `own` the screen's own groups (none for All Screens)
    function paneOf(house, b) {
      var r = b && b.side_pane_read;
      if (r) return Object.assign(paneCopy(r), { own: (r.own || []).slice() });
      var h = paneCopy(PANE_DEFAULTS);
      PANE_GROUPS.forEach(function (g) { if (house && house[g] !== undefined && house[g] !== null) h[g] = paneCopy(house[g]); });
      h.own = [];
      // (no pane as read: the screen's own groups as stored, never "none of its own" -- a change built on that saved
      // its one group alone and the rest of the screen's pane was gone, 2026-11-01)
      var own = b && b.side_pane;
      if (own && typeof own === 'object') PANE_GROUPS.forEach(function (g) {
        if (own[g] !== undefined && own[g] !== null) { h[g] = paneCopy(own[g]); h.own.push(g); }
      });
      return h;
    }
    // whose a group is, on a screen ('' for All Screens)
    function paneGroupSays(p, g, screen) { return !screen ? '' : p.own.indexOf(g) >= 0 ? 'Just This Screen' : 'Same as All Screens'; }
    // WHAT A CHANGE SAVES: All Screens' one group (side_pane.<group>), or the
    // screen's own object -- the groups it had, and this one now its own too
    function paneSet(p, g, value, screen) {
      var out = {};
      if (!screen) { out['side_pane.' + g] = value; return out; }
      var own = {};
      p.own.forEach(function (x) { own[x] = paneCopy(p[x]); });
      own[g] = value;
      out.side_pane = own;
      return out;
    }
    // ...and Reset to All Screens: the group no longer the screen's (none
    // left: null, Same as All Screens in everything)
    function paneReset(p, g) {
      var own = {};
      p.own.forEach(function (x) { if (x !== g) own[x] = paneCopy(p[x]); });
      return { side_pane: Object.keys(own).length ? own : null };
    }
    // A GROUP'S SECTIONS, changed: each returns the whole new group
    function secKey(s) { return s.kind + ':' + ((s.kind === 'status' && s.id) || s.entity || ''); }
    function paneGroup(grp, sections) { return { show: grp.show, sections: sections.map(paneSection) }; }
    function secsAdd(grp, kind) {
      if (!paneKind(kind) || grp.sections.length >= PANE_MAX) return paneGroup(grp, grp.sections);
      return paneGroup(grp, grp.sections.concat([kind === 'status' ? { kind: kind, size: 'less', id: Math.random().toString(36).slice(2, 10) || 's1' } : { kind: kind, size: 'less' }]));
    }
    function secsOrder(grp, keys) {
      var by = {};
      grp.sections.forEach(function (s) { by[secKey(s)] = s; });
      return paneGroup(grp, keys.map(function (k) { return by[k]; }).filter(Boolean));
    }
    function secSet(grp, i, k, v) {
      var list = paneCopy(grp.sections);
      if (!list[i]) return paneGroup(grp, list);
      // ONE FULL AT A TIME: another made Full is More again
      if (k === 'size' && v === 'full') list.forEach(function (s, j) { if (j !== i && s.size === 'full') delete s.size; });
      if (v === null || v === undefined || v === '') delete list[i][k]; else list[i][k] = v;
      return paneGroup(grp, list);
    }
    // the kinds not yet in a group (a camera or a list may come twice, by its entity; a Status (its id), any number)
    function secsMore(grp) {
      var have = grp.sections.map(function (s) { return s.kind; });
      return grp.sections.length >= PANE_MAX ? [] : PANE_KINDS.filter(function (k) { return have.indexOf(k[0]) < 0 || k[0] === 'camera' || k[0] === 'todo' || k[0] === 'status'; });
    }
    // A SECTION'S ROW SAYS its size and when: "More", "Tiny · When There's Something"
    function secSays(s) {
      var size = choiceLabel(PANE_SIZES, s.size || 'more');
      return [size, s.kind === 'status' ? (s.show ? 'While Its Rule Holds' : '') : s.when === 'active' ? 'When There’s Something' : '', s.place === 'bottom' ? 'At the Bottom' : ''].filter(
        Boolean).join(' · ');
    }
    // WHERE A SECTION SITS and WHAT A TAP DOES (settings.py PANE_PLACES, PANE_TAPS; 2026-10-30)
    var PANE_PLACES = [['top', 'Top'], ['bottom', 'Bottom']];
    var PANE_TAPS = [['auto', 'Automatic'], ['page', 'Its Page'], ['sheet', 'Its Sheet'], ['none', 'Nothing']];
    // Now Playing's own two (settings.py PANE_TAPS_OWN, item 44), after Its Sheet
    var PANE_TAPS_OWN = { now_playing: [['panel', 'Open the Panel'], ['flip', 'Flip to the Controls']] };
    function paneTaps(kind) { return kind === 'status' ? [PANE_TAPS[0], PANE_TAPS[3]] : PANE_TAPS.slice(0, 3).concat(PANE_TAPS_OWN[kind] || [], PANE_TAPS.slice(3)); }
    // THE CAMERA'S NAME (settings.py PANE_CHOICES; 2026-10-31): Hide is what absent means
    var PANE_CAMERA_NAMES = [['hide', 'Hide'], ['auto', 'Automatic'], ['show', 'Show']];
    // THE CLOCK'S LOOK (settings.py PANE_CHOICES, PANE_FLAGS_ON; 2026-10-31, item 43): each choice's first value is
    // what absent means -- today's clock -- and AM/PM is on, the Flashing Colon off, unless set
    var CLOCK_FACES = [['digital', 'Digital'], ['stacked', 'Stacked'], ['analog', 'Analog']];
    var CLOCK_ALIGNS = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']];
    var CLOCK_SCALES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
    var CLOCK_WEIGHTS = [['light', 'Light'], ['regular', 'Regular'], ['semibold', 'Semibold'], ['bold', 'Bold']];
    var CLOCK_DATES = [['full', 'Full'], ['short', 'Short'], ['off', 'Off']];
    var CLOCK_LINES = [['auto', 'Automatic'], ['none', 'None'], ['sunset', 'Sunset'], ['weather', 'Weather']];
    // the weather beside the time, as the menu's header has it (2026-10-31, the owner)
    // ...in a look of its own (2026-11-01, the owner): Large, Quiet, a Chip, or on the Date Line
    var CLOCK_BESIDE = [['none', 'None'], ['weather', 'Weather, Large'], ['quiet', 'Weather, Quiet'], ['chip', 'Weather Chip'], ['date', 'Weather on the Date Line']];
    // ...and under it at More (2026-10-31, the owner)
    var CLOCK_BELOW = [['auto', 'Sunset'], ['hours', 'Next Hours'], ['sun', 'Sun'], ['moon', 'Moon'], ['conditions', 'Conditions']];
    var CLOCK_ABSENT = { face: 'digital', align: 'left', scale: 'medium', weight: 'semibold', date: 'full', line: 'auto', beside: 'none', below: 'auto', ampm: true, colon: false };
    // THE LINKS that were each pane's own settings: the Dashboard's ("Home
    // Only, Right"), the screensaver's ("Calendar, Now Playing"), and Now
    // Playing's Show As (the bar, or the Side Pane)
    function paneSummary(p) {
      var d = p.dashboard || {};
      return d.show === 'off' || !d.show ? 'Off' : choiceLabel(PANE_SHOWS, d.show) + ', ' + choiceLabel(PANE_SIDES, p.side);
    }
    function paneSaverSummary(p) {
      var g = p.saver || {};
      if (g.show === 'same') return 'Same as the Dashboard';
      if (g.show !== 'own' || !(g.sections || []).length) return 'Off';
      return listText(g.sections.map(function (s) { return (paneKind(s.kind) || [0, s.kind])[1]; }));
    }
    function paneHasMusic(p) {
      var d = p.dashboard || {};
      return d.show !== 'off' && (d.sections || []).some(function (s) { return s.kind === 'now_playing'; });
    }
    function npShowAs(p) { return paneHasMusic(p) ? 'In the Side Pane' : 'Bar'; }

    // ------------------------------------------------------------ LOOKS
    // LOOKS (2026-10-30, hk_core/settings/looks.py -- the one list; this is its
    // copy, compared by tests/test_hk_core_looks.py): whole themed setups a
    // screen takes in one step -- its settings, its screensaver's options (a
    // patch over the screen's) and the layout it starts from.
    var LOOK_KEYS = ["flat", "flat_theme", "glass", "accent", "tab_bar_glass", "tile_style", "sky", "sky_background", "sky_color", "sky_wallpaper", "sky_wallpaper_night", "sky_wallpaper_motion",
      "sky_wallpaper_color", "sky_animations", "sky_weather", "sky_precipitation", "sky_moving", "sky_decorations", "sky_liveliness", "swipe_pages", "side_pane", "screensaver", "screensaver_options",
      "camera_live_video"];
    var LOOK_UNDO_KEYS = ["flat", "flat_theme", "glass", "accent", "tab_bar_glass", "tile_style", "sky", "sky_background", "sky_color", "sky_wallpaper", "sky_wallpaper_night", "sky_wallpaper_motion",
      "sky_wallpaper_color", "sky_animations", "sky_weather", "sky_precipitation", "sky_moving", "sky_decorations", "sky_liveliness", "swipe_pages", "side_pane", "screensaver", "screensaver_options",
      "camera_live_video", "home_style", "home_grid"];
    var LOOKS = [
      {"id": "homeview", "name": "HomeView", "about": "Square tiles, centred, over a slow-moving wallpaper in Bright Glass, with the Side Pane and the Analog Numbers clock.",
        "art": ["#1f4b8d", "#375b91", "#0b285d", "#ff9500"], "layout": {"cell": "square", "starters": ["sq_pane", "sq_6x4", "sq_3x5", "sq_2x4", "sq_homeview"]},
        "settings": {"flat": false, "glass": "bright", "accent": "orange", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "wallpaper", "sky_wallpaper": "ribbons",
        "sky_wallpaper_color": "blue", "sky_wallpaper_night": "auto", "sky_wallpaper_motion": "slow", "swipe_pages": "on",
        "side_pane": {"side": "right", "headings": true, "dashboard": {"show": "home",
        "sections": [{"kind": "weather", "size": "more"}, {"kind": "calendar", "size": "more"}, {"kind": "now_playing", "size": "more", "when": "active"}]}}, "screensaver": true},
        "saver": {"show": "clock", "clock_style": "numbers", "clock_bg": "gradient", "clock_motion": "slow"}},
      {"id": "flat", "name": "Flat", "about": "Clean and solid: no blur, high contrast, the cards on one dark colour.", "art": ["#1c1c1e", "#1c1c1e", "#1c1c1e", "#0a84ff"],
        "layout": {"cell": "tile", "starters": ["A"]}, "settings": {"flat": true, "flat_theme": "dark", "accent": "blue", "tab_bar_glass": "tinted", "tile_style": "home", "swipe_pages": "auto",
        "screensaver": true}, "saver": {"show": "clock", "clock_style": "classic", "clock_bg": "black", "clock_motion": "still"}},
      {"id": "performance", "name": "Performance",
        "about": "The lightest setup for a slow wall tablet: Glass, no rain or snow, nothing moving in front of the cards, no live camera, and a still screensaver.",
        "art": ["#2b3140", "#3a4152", "#202531", "#ff9500"], "layout": {"cell": "tile", "starters": ["Q"]},
        "settings": {"flat": false, "glass": "clear", "accent": "orange", "tab_bar_glass": "tinted", "tile_style": "home", "sky_animations": false, "sky_precipitation": false, "sky_moving": "behind",
        "sky_decorations": false, "sky_wallpaper_motion": "off", "camera_live_video": false, "screensaver": true},
        "saver": {"show": "clock", "clock_style": "classic", "clock_bg": "black", "clock_motion": "still", "zoom": false}},
      {"id": "holiday", "name": "Holiday Whimsy",
        "about": "The live sky with the season's scenery and decorations, a festive bustle, the Day face with its occasion art, Scattered Numerals, and the countdown to the next holiday.",
        "art": ["#2a1450", "#7a3b1c", "#1b0f24", "#ff9f0a"], "layout": {"cell": "tile", "starters": ["F", "A"]},
        "settings": {"flat": false, "glass": "blur", "accent": "orange", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "live", "sky_animations": true,
        "sky_decorations": true, "sky_liveliness": "festive", "sky_moving": "front", "swipe_pages": "auto", "screensaver": true},
        "saver": {"show": "day", "clock_style": "scattered", "day_look": "auto", "holiday_slide": true}},
      {"id": "weather", "name": "Active Weather", "about": "The live sky with its weather moving -- clouds, rain and snow -- the weather large in the Side Pane and Big Weather in the screensaver.",
        "art": ["#3a6ea8", "#7fa6c9", "#2c4a6b", "#32ade6"], "layout": {"cell": "tile", "starters": ["C", "A"]},
        "settings": {"flat": false, "glass": "blur", "accent": "cyan", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "live", "sky_animations": true,
        "sky_weather": true, "sky_precipitation": true, "sky_moving": "behind", "swipe_pages": "auto",
        "side_pane": {"side": "right", "headings": false, "dashboard": {"show": "home", "sections": [{"kind": "weather", "size": "full"}, {"kind": "calendar", "size": "less"}]}}, "screensaver": true},
        "saver": {"show": "forecast", "forecast_layout": "big"}},
      {"id": "calm", "name": "Calming Backgrounds", "about": "Soft violet petals drifting slowly in Bright Glass, muted colours, and the Liquid clock.",
        "art": ["#3c3283", "#524999", "#211a5e", "#5e5ce6"], "layout": {"cell": "square", "starters": ["sq_pane", "sq_6x4", "sq_3x5", "sq_2x4", "sq_homeview"]},
        "settings": {"flat": false, "glass": "bright", "accent": "indigo", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "wallpaper", "sky_wallpaper": "petals",
        "sky_wallpaper_color": "violet", "sky_wallpaper_night": "auto", "sky_wallpaper_motion": "slow", "swipe_pages": "on", "screensaver": true},
        "saver": {"show": "clock", "clock_style": "liquid", "clock_bg": "gradient", "clock_motion": "slow"}},
      {"id": "night", "name": "Night & Bedside", "about": "Dark and quiet for a bedroom: a deep colour, the big clock a swipe from the weather, and a dim red clock at night.",
        "art": ["#0b1026", "#121a3a", "#05070f", "#ff453a"], "layout": {"cell": "tile", "starters": ["n_standby", "n_clock"]},
        "settings": {"flat": false, "glass": "tinted", "accent": "red", "tab_bar_glass": "tinted", "tile_style": "home", "sky": true, "sky_background": "color", "sky_color": "midnight",
        "sky_animations": false, "swipe_pages": "on", "side_pane": {"dashboard": {"show": "off", "sections": []}}, "screensaver": true},
        "saver": {"show": "clock", "clock_style": "classic", "clock_bg": "black", "clock_motion": "still", "clock_night": "night"}},
      {"id": "photos", "name": "Photo Frame", "about": "The landscapes behind the cards, and your photos soon after you stop -- their titles, the time behind their subject where it can be.",
        "art": ["#4a6a3a", "#8aa070", "#2a3a22", "#ff375f"], "layout": {"cell": "tile", "starters": ["Q", "A"]},
        "settings": {"flat": false, "glass": "blur", "accent": "pink", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "landscapes", "swipe_pages": "auto",
        "screensaver": true}, "saver": {"show": "photos", "starts_after": 60, "photo_titles": true, "time_behind": true}}
    ];
    function lookOf(id) { return LOOKS.filter(function (l) { return l.id === id; })[0] || null; }
    // WHAT A LOOK CHANGES on a screen (`b`: its settings as read; `saver`: its
    // screensaver's options now): the changes to send, its Undo (the screen's
    // own values before), and the rows the sheet shows ([label, was, becomes])
    // -- only what differs. `layout`: the Layout + Look's grid, if any.
    var LOOK_LABELS = { flat: 'Flat Colors', flat_theme: 'Flat Theme', glass: 'Style', accent: 'Accent Color', tab_bar_glass: 'Tab Bar Glass',
      tile_style: 'Tile Style', tile_icons: 'Icons', sky: 'Sky', sky_background: 'Background', sky_color: 'Color', sky_wallpaper: 'Wallpaper',
      sky_wallpaper_night: 'Night Version', sky_wallpaper_motion: 'Wallpaper Motion', sky_animations: 'Animations', sky_weather: 'Weather',
      sky_precipitation: 'Rain & Snow', sky_moving: 'Moving Things', sky_decorations: 'Decorations', sky_liveliness: 'Liveliness',
      swipe_pages: 'Swipe Between Pages', side_pane: 'Side Pane', screensaver: 'Screensaver', screensaver_options: 'Screensaver Options',
      camera_live_video: 'Live Camera', home_style: 'Home', home_grid: 'Layout' };
    function lookSays(k, v) {
      if (v === null || v === undefined) return 'Same as All Screens';
      // a screen's glass 'house' is All Screens' (never "House")
      if (k === 'glass' && v === 'house') return 'Same as All Screens';
      if (v === true) return 'On';
      if (v === false) return 'Off';
      var lists = { glass: GLASS_STYLES, tile_style: TILE_STYLES, tile_icons: TILE_ICONS, sky_wallpaper_night: WALLPAPER_NIGHT, sky_wallpaper_motion: WALLPAPER_MOTION };
      var o = lists[k] && lists[k].filter(function (x) { return x[0] === v; })[0];
      if (o) return o[1];
      if (k === 'side_pane') return v.dashboard && v.dashboard.show === 'off' ? 'Off' : 'On, beside Home';
      if (k === 'screensaver_options') return 'The Look’s Options';
      if (k === 'home_grid') return 'The Look’s starter';
      if (typeof v === 'string') return v.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      return 'Set';
    }
    function lookChanges(look, b, saver, layout) {
      b = b || {};
      var ch = JSON.parse(JSON.stringify(look.settings)), was = {}, rows = [];
      ch.screensaver_options = Object.assign({}, saver || {}, look.saver);
      if (layout) { ch.home_style = 'grid'; ch.home_grid = layout; }
      var same = function (a, c) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(c === undefined ? null : c); };
      Object.keys(ch).forEach(function (k) {
        var before = b[k] === undefined ? null : b[k];
        was[k] = before;
        if (k === 'screensaver_options') {
          var now = Object.assign({}, saver || {});
          if (Object.keys(look.saver).some(function (o) { return !same(now[o], look.saver[o]); })) rows.push([LOOK_LABELS[k], 'Your Options', lookSays(k, ch[k])]);
          return;
        }
        if (!same(before, ch[k])) rows.push([LOOK_LABELS[k] || k, k === 'home_grid' && before ? 'Your layout' : lookSays(k, before), lookSays(k, ch[k])]);
      });
      ch.look_undo = { look: look.id, was: was };
      return { changes: ch, rows: rows };
    }
    // ...and its UNDO: the screen's own values back, the Undo spent
    function lookUndo(b) {
      var u = b && b.look_undo;
      if (!u || !u.was) return null;
      var ch = JSON.parse(JSON.stringify(u.was));
      ch.look_undo = null;
      return ch;
    }

    // what the shell and the later parts use of this one
    K.BRIGHT_DIM_MAX = BRIGHT_DIM_MAX; K.CLOCK_ALIGNS = CLOCK_ALIGNS; K.CLOCK_BELOW = CLOCK_BELOW;
    K.CLOCK_BESIDE = CLOCK_BESIDE; K.CLOCK_DATES = CLOCK_DATES; K.CLOCK_FACES = CLOCK_FACES;
    K.CLOCK_LINES = CLOCK_LINES; K.CLOCK_SCALES = CLOCK_SCALES; K.CLOCK_WEIGHTS = CLOCK_WEIGHTS;
    K.forecastSummary = forecastSummary; K.IDLE_TIMES = IDLE_TIMES; K.idleLabel = idleLabel;
    K.idleTimeline = idleTimeline; K.LOOK_KEYS = LOOK_KEYS; K.LOOK_LABELS = LOOK_LABELS;
    K.LOOK_UNDO_KEYS = LOOK_UNDO_KEYS; K.lookChanges = lookChanges; K.lookOf = lookOf; K.LOOKS = LOOKS;
    K.lookSays = lookSays; K.lookUndo = lookUndo; K.npShowAs = npShowAs; K.PANE_CAMERA_NAMES = PANE_CAMERA_NAMES;
    K.PANE_DEFAULTS = PANE_DEFAULTS; K.PANE_DIM_GLASS = PANE_DIM_GLASS; K.PANE_DIM_MAX = PANE_DIM_MAX;
    K.PANE_GROUPS = PANE_GROUPS; K.PANE_KINDS = PANE_KINDS; K.PANE_MAX = PANE_MAX; K.PANE_PLACES = PANE_PLACES;
    K.PANE_SAVER_SHOWS = PANE_SAVER_SHOWS; K.PANE_SHOWS = PANE_SHOWS; K.PANE_SIDES = PANE_SIDES;
    K.PANE_SIZES = PANE_SIZES; K.PANE_TAPS = PANE_TAPS; K.PANE_WHEN = PANE_WHEN; K.PANE_WIDTHS = PANE_WIDTHS;
    K.paneDim = paneDim; K.paneGroupSays = paneGroupSays; K.paneHasMusic = paneHasMusic; K.paneKind = paneKind;
    K.paneOf = paneOf; K.paneReset = paneReset; K.paneSaverSummary = paneSaverSummary; K.paneSection = paneSection;
    K.paneSet = paneSet; K.paneSummary = paneSummary; K.paneTaps = paneTaps; K.RADAR_BASEMAPS = RADAR_BASEMAPS;
    K.RADAR_CENTERS = RADAR_CENTERS; K.RADAR_DEFAULTS = RADAR_DEFAULTS; K.RADAR_HISTORY = RADAR_HISTORY;
    K.RADAR_LEGACY_MAPPED = RADAR_LEGACY_MAPPED; K.RADAR_NAMES = RADAR_NAMES; K.RADAR_PROVIDERS = RADAR_PROVIDERS;
    K.RADAR_REASONS = RADAR_REASONS; K.RADAR_SPEEDS = RADAR_SPEEDS; K.radarAdvancedSummary = radarAdvancedSummary;
    K.radarOf = radarOf; K.radarPlanOf = radarPlanOf; K.radarSummary = radarSummary; K.secKey = secKey;
    K.secsAdd = secsAdd; K.secSays = secSays; K.secSet = secSet; K.secsMore = secsMore; K.secsOrder = secsOrder;
    K.TABLET_APPS = TABLET_APPS; K.tabletApp = tabletApp; K.tabletChecks = tabletChecks;
    K.tabletStatus = tabletStatus; K.tabletUrl = tabletUrl; K.WX_DAYS = WX_DAYS; K.WX_DETAILS = WX_DETAILS;
    K.WX_HOURS = WX_HOURS; K.WX_METRICS = WX_METRICS; K.WX_PAGE_DEFAULTS = WX_PAGE_DEFAULTS; K.wxPage = wxPage;
  };
})();
