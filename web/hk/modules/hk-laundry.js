// hk-laundry.js -- LAUNDRY, READ AND DRAWN (phase 22, 2026-11-10; docs/phase22/LAUNDRY.md). The owner: "it would be great if we could
// somehow support all of it ... do what you can with entity pickers ... so a user can just pick the necessary entities and decide if they
// have a combo or standalone for washer and dryer ... if you think you can 'auto' configure these things, feel free."
//
// ONE SET OF STATES FOR EVERY BRAND (hk_core/laundry.py has the story and the same table): a washer is a status sensor, maybe a cycle
// step, a finish time or the time left, a progress, a door and a remote-control switch, all on one device -- each integration spells
// them its own way. Every source is reduced to STATES by its raw value, never by its brand; the Home Grid block, the room tile, the
// chip and the sheet read only what look() returns.
//
//   hkLaundry.machines(client)          the house's machines: Accessories -> Laundry's list (settings.features.laundry), else found()
//   hkLaundry.found(client)             machines found on the house's devices: a status sensor that reads like a washer's or a dryer's
//   hkLaundry.look(client, m)           what machine m is doing: { state, title, sub, short, left, ends, pct, steps, kind, door, ... }
//   hkLaundry.controls(client, m)       { pause, resume, stop: [domain, service, data] | null, why } -- what the machine itself offers
//   hkLaundry.ids(client, m)            every entity look() reads, for a card's redraw signature
//   hkLaundry.art(state, kind, o)       the drawing (a front-loader in the house glyphs' style), animated by what it does; .CSS its styles
//   hkLaundry.glyph(kind)               the house glyph for a tile or a chip (hk:washing-machine, hk:tumble-dryer)
//
// THE DRAWING (the mockup the owner approved, docs/phase22/mockup/laundry.html): a front-loader drawn large, its drum turning by what it
// does -- washing rocks, spinning whirls and shakes, drying tumbles under warm lines -- and a badge at its upper right as the vacuum's:
// white for paused and a delayed start, mint for Done, red for a leak or an error. Everything still where motion is off
// (prefers-reduced-motion, Flat's stopped animations). The generated pages' tiles use the glyph, never the drawing ("no animation
// necessary though.. as none of the other animate").
// @ts-check
(function (global) {
  'use strict';
  if (global.hkLaundry) return;

  // THE TABLE (hk_core/laundry.py WORDS and STEPS, the same: tests/test_laundry.py)
  // WORDS-BEGIN
  var TABLE = {"WORDS": {
    "wash": "washing", "washing": "washing", "ai_wash": "washing", "pre_wash": "washing", "prewash": "washing", "main_wash": "washing",
    "cycle_washing": "washing", "cycle_filling": "washing", "cycle_soaking": "washing", "fill": "washing", "soak": "washing",
    "soaking": "washing", "weight_sensing": "washing", "weighting": "washing", "detecting": "washing", "cycle_sensing": "washing",
    "load_size_detection": "washing", "steam": "washing", "steam_softening": "washing", "air_wash": "washing", "running_maincycle": "washing",
    "rinse": "rinsing", "rinsing": "rinsing", "ai_rinse": "rinsing", "cycle_rinsing": "rinsing", "rinse_hold": "rinsing",
    "extra_rinse": "rinsing", "rinses": "rinsing",
    "spin": "spinning", "spinning": "spinning", "ai_spin": "spinning", "cycle_spinning": "spinning", "extra_spin": "spinning",
    "drain": "spinning", "thermo_spin": "spinning",
    "dry": "drying", "drying": "drying", "ai_drying": "drying", "tumble": "drying", "tumbling": "drying", "night_dry": "drying",
    "timed_drying": "drying", "hygiene_drying": "drying", "extra_dry": "drying", "warm_air": "drying", "heat_stroke": "drying",
    "cooling": "cooling", "cool_down": "cooling", "cooling_down": "cooling", "cooldown": "cooling", "comfort_cooling": "cooling",
    "safety_cooling": "cooling",
    "wrinkle_prevent": "wrinkle", "wrinkle_care": "wrinkle", "anti_crease": "wrinkle", "extended_tumble": "wrinkle",
    "running_postcycle": "wrinkle", "air_fluff": "wrinkle",
    "pause": "paused", "paused": "paused", "delay_paused": "paused", "smart_grid_pause": "paused",
    "delayedstart": "delayed", "delayed_start": "delayed", "delay_wash": "delayed", "reserved": "delayed", "reservation": "delayed",
    "waiting_to_start": "delayed", "programmed": "delayed", "smart_delay": "delayed", "delay_countdown": "delayed", "delay_run": "delayed",
    "scheduled": "delayed",
    "run": "running", "running": "running", "in_use": "running", "on": "running", "program_running": "running", "cycle": "running",
    "working": "running", "in_progress": "running",
    "finish": "done", "finished": "done", "end": "done", "complete": "done", "completed": "done", "program_ended": "done",
    "end_of_cycle": "done", "ending": "done", "cycle_complete": "done", "cycle_finished": "done",
    "error": "error", "failure": "error", "actionrequired": "error", "action_required": "error", "exception": "error",
    "hard_stop_or_error": "error", "alarm": "error", "program_interrupted": "error", "power_failure": "error",
    "off": "off", "stop": "off", "stopped": "off", "power_off": "off", "inactive": "off", "standby": "off", "ready": "off",
    "ready_to_start": "off", "none": "off", "idle": "off", "initial": "off", "not_running": "off", "setting": "off", "cancelled": "off",
    "canceled": "off", "aborting": "off"
  },
  "STEPS": {"washer": ["wash", "rinse", "spin"], "dryer": ["dry", "cool"], "combo": ["wash", "rinse", "spin", "dry"]},
  "STEP_OF": {"washing": "wash", "rinsing": "rinse", "spinning": "spin", "drying": "dry", "cooling": "cool"}};
  // WORDS-END
  var WORDS = TABLE.WORDS, STEPS = TABLE.STEPS, STEP_OF = TABLE.STEP_OF;
  var STATES = ['off', 'delayed', 'washing', 'rinsing', 'spinning', 'drying', 'cooling', 'wrinkle', 'paused', 'running', 'done', 'error',
                'offline', 'leak'];
  var RUNNING = ['delayed', 'washing', 'rinsing', 'spinning', 'drying', 'cooling', 'paused', 'running'];
  var ROLES = ['status', 'phase', 'time', 'progress', 'door', 'remote', 'leak', 'power', 'running'];
  var HELD = 'sensor.laundry_done';     // the house server's own: attribute `machines` {machine id: {since, words}} (absent inside HA alone)
  var OFF_WORDS = ['off', 'false', 'closed', 'disabled', '0', 'dry', ''];
  var NAMES = { off: 'Off', delayed: 'Delayed Start', washing: 'Washing', rinsing: 'Rinsing', spinning: 'Spinning', drying: 'Drying',
                cooling: 'Cooling', wrinkle: 'Done', paused: 'Paused', running: 'Running', done: 'Done', error: 'Needs Help',
                offline: 'Unavailable', leak: 'Water Leak' };
  var STEP_NAMES = { wash: 'Wash', rinse: 'Rinse', spin: 'Spin', dry: 'Dry', cool: 'Cool' };
  // A COLOR FOR EACH STEP (the owner, 2026-11-10: "build the color per step"), matched to what the drawing shows: water blue washing, a
  // lighter blue rinsing, purple for the spin, the heat lines' warm for drying, mint cooling. A step done keeps its color
  var STEP_COLORS = { wash: '#0a84ff', rinse: '#64d2ff', spin: '#bf5af2', dry: '#ffb15c', cool: '#63e6e2' };
  var KIND_NAMES = { washer: 'Washer', dryer: 'Dryer', combo: 'Washer & Dryer' };

  function tidy(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function word(v) { return Object.prototype.hasOwnProperty.call(WORDS, tidy(v)) ? WORDS[tidy(v)] : null; }
  function stOf(client, id) { return id && client && client.states ? client.states[id] || null : null; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function isOn(st) { return !!st && OFF_WORDS.concat(['unknown', 'unavailable']).indexOf(tidy(st.state)) < 0; }
  function runs(state) { return RUNNING.indexOf(state) >= 0; }
  function setting(path, fb) { var HS = global.hkSettings; try { return HS ? HS.get(path, fb) : fb; } catch (e) { return fb; } }
  function nameOf(client, id) {
    var st = stOf(client, id), e = client && client.entities && client.entities[id];
    return (e && e.name) || (st && st.attributes && st.attributes.friendly_name) || id;
  }

  // ------------------------------------------------------------ FINDING THEM (no setup: Accessories -> Laundry can change any of it)
  var STATUS_RE = /(machine_state|operation_state|operating_state|current_state|current_status|appliance_?state|mach_?mode|washer_state|dryer_state|laundry_machine_state|(^|_)status$|(^|_)state$)/;
  var PHASE_RE = /(job_state|sub_?cycle|program_phase|cycle_?phase|pr_?phase|_phase$)/;
  var TIME_RE = /(completion_time|finish|end_time|remain|time_?to_?end|time_remaining)/;
  var LAUNDRY_RE = /wash|dryer|laundry|(^|_)dry(_|$)|tumble/, NOT_RE = /dish|vacuum|robot|oven|fridge|freezer|microwave|cooktop/;
  function textOf(client, id) { return tidy(id.split('.')[1] + ' ' + nameOf(client, id)); }
  function optsOf(st) { var o = st && st.attributes && st.attributes.options; return Array.isArray(o) ? o : []; }
  // a status sensor: an enum whose options read like a laundry machine's (two or more of WORDS' running or done words), or a status or
  // state sensor named for a washer or a dryer
  function looksLikeStatus(client, id) {
    if (id.indexOf('sensor.') !== 0) return false;
    var oid = id.split('.')[1];
    if (!STATUS_RE.test(oid) || PHASE_RE.test(oid)) return false;
    var opts = optsOf(stOf(client, id)), hits = opts.filter(function (o) { var w = word(o); return !!w && w !== 'off'; }).length;
    return hits >= 2 || (LAUNDRY_RE.test(textOf(client, id)) && !!word(stOf(client, id) && stOf(client, id).state));
  }
  function kindOf(client, id, dev) {
    var d = dev || {}, t = textOf(client, id) + ' ' + tidy(d.name_by_user || d.name || '') + ' ' + tidy(d.model || '') + ' ' + tidy(d.model_id || '');
    if (/combo|washer_?dryer|wash_?dry|washcombo|(^|[_ ])wd[0-9]/.test(t)) return 'combo';
    if (/dryer|(^|_)dry(_|$)|tumble/.test(t) && !/wash/.test(t)) return 'dryer';
    return 'washer';
  }
  function slug(s) { return tidy(s).slice(0, 24) || 'machine'; }
  // the device an entity is on -- or, with none (an integration set up in YAML, a stand-in registry), its room and the first word
  // of its id ("washer_job_state" -> washer)
  function devKey(e, id) { return e ? e.device_id || (e.area_id ? '~' + e.area_id + ':' + id.split('.')[1].split('_')[0] : '') : ''; }
  function found(client) {
    var ents = (client && client.entities) || {}, devs = (client && client.devices) || {}, states = (client && client.states) || {};
    var byDev = {}, out = [], seen = {};
    Object.keys(states).forEach(function (id) {
      var e = ents[id];
      if (!e || e.hidden || e.disabled_by) return;
      // (no device -- an integration set up in YAML, a stand-in registry: its room and the first word of its id, "washer_job_state")
      var key = devKey(e, id);
      if (key) (byDev[key] = byDev[key] || []).push(id);
    });
    Object.keys(byDev).sort().forEach(function (dev) {
      var mine = byDev[dev].sort(), d0 = devs[dev] || {};
      // A LAUNDRY MACHINE, not anything with a run/pause status: a robot vacuum (Matter's operational state reads the same), a
      // dishwasher, an oven are not -- the device or its entities are named for laundry, or its steps are laundry's own
      var said = tidy([d0.name_by_user, d0.name, d0.model, d0.model_id].join(' ')) + ' ' + mine.map(function (id) { return textOf(client, id); }).join(' ');
      if (mine.some(function (id) { return /^(vacuum|climate|water_heater|lawn_mower|fan|humidifier)\./.test(id); }) || NOT_RE.test(said)) return;
      var steps = mine.some(function (id) {
        return optsOf(stOf(client, id)).some(function (o) { var w = word(o); return w === 'washing' || w === 'rinsing' || w === 'spinning' || w === 'drying' || w === 'wrinkle'; });
      });
      if (!steps && !LAUNDRY_RE.test(said)) return;
      var status = mine.filter(function (id) { return looksLikeStatus(client, id); });
      // (a stacked unit's two machines: each status its own machine; a device with none is not laundry)
      status.forEach(function (sid) {
        var d = devs[dev] || {}, kind = kindOf(client, sid, d), side = /upper|lower|sub_|_sub|top|bottom/.exec(sid);
        var pick = function (re, test) {
          return mine.filter(function (id) { return re.test(id.split('.')[1]) && (!test || test(id)) && (!side || id.indexOf(side[0]) >= 0); })[0] || null;
        };
        var m = {
          id: '', name: '', kind: kind, area: d.area_id || (ents[sid] && ents[sid].area_id) || null, watts: 10,
          status: sid,
          phase: pick(PHASE_RE, function (id) { return id.indexOf('sensor.') === 0; }),
          time: pick(TIME_RE, function (id) {
            var a = (stOf(client, id) || {}).attributes || {};
            return id.indexOf('sensor.') === 0 && (a.device_class === 'timestamp' || a.device_class === 'duration' || /^(min|s|h)$/.test(String(a.unit_of_measurement || '')));
          }),
          progress: pick(/progress/, function (id) { return id.indexOf('sensor.') === 0; }),
          door: pick(/door/, function (id) { return id.indexOf('binary_sensor.') === 0 && !/lock/.test(id); }),
          remote: pick(/remote_(control|start)|remotecontrol|remote$/, function (id) { return /^(binary_sensor|sensor)\./.test(id); }),
          leak: null,
          power: pick(/(^|_)power$/, function (id) { var a = (stOf(client, id) || {}).attributes || {}; return id.indexOf('sensor.') === 0 && a.device_class === 'power'; }),
          running: null
        };
        var base = KIND_NAMES[kind] === 'Washer & Dryer' ? 'Washer' : KIND_NAMES[kind];
        m.name = side ? (/upper|top/.test(side[0]) ? 'Upper ' : 'Lower ') + base : base;
        m.id = slug(sid.split('.')[1].replace(/_(machine_state|operation_state|operating_state|current_state|current_status|state|status)$/, ''));
        while (seen[m.id]) m.id = m.id.slice(0, 22) + '_2';
        seen[m.id] = 1;
        // a leak sensor in the same room, named for the laundry or the machine
        if (m.area) {
          m.leak = Object.keys(states).filter(function (id) {
            var e = ents[id] || {}, a = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
            return id.indexOf('binary_sensor.') === 0 && a === m.area && (states[id].attributes || {}).device_class === 'moisture';
          }).sort()[0] || null;
        }
        out.push(m);
      });
    });
    // A CIRCUIT'S WATTS (2026-11-10, the owner's Laundry Circuit): many machines report no power of their own, or 0 W while they run (a
    // Samsung's) -- an energy monitor's channel named for the laundry is the truer reading: a power sensor named so, or the power sensor
    // a laundry-named energy sensor is summed from (its `source`), never one on a machine; a dryer's named for drying, a washer's for
    // washing, either's for the laundry; the machine's own room first (hk_core/laundry.py circuit, the same)
    var mineDev = {}, circ = [];
    out.forEach(function (m) { var e = ents[m.status]; mineDev[devKey(e, m.status)] = 1; });
    Object.keys(states).sort().forEach(function (id) {
      var a = (states[id] && states[id].attributes) || {}, t = textOf(client, id), e = ents[id];
      if (id.indexOf('sensor.') !== 0 || !/wash|dryer|laundry/.test(t) || NOT_RE.test(t) || (e && mineDev[devKey(e, id)])) return;
      var src = typeof a.source === 'string' ? a.source : '', p = a.device_class === 'power' ? id
        : a.device_class === 'energy' && src.indexOf('sensor.') === 0 && ((states[src] || {}).attributes || {}).device_class === 'power' ? src : null;
      if (p && !circ.some(function (c) { return c.id === p; })) circ.push({ id: p, t: t, area: e ? e.area_id || (devs[e.device_id] || {}).area_id || null : null });
    });
    out.forEach(function (m) {
      var want = m.kind === 'dryer' ? /dry|laundry/ : /wash|laundry/, ok = circ.filter(function (c) { return want.test(c.t); });
      var c = ok.filter(function (x) { return m.area && x.area === m.area; })[0] || ok[0];
      if (c) m.power = c.id;
    });
    // two machines both named Washer: the second says which
    var had = {};
    out.forEach(function (m) { var n = m.name; had[n] = (had[n] || 0) + 1; if (had[n] > 1) m.name = n + ' ' + had[n]; });
    return out;
  }
  // (saved: the settings page passes its own copy; a screen reads the settings feed)
  // (found once per registry: the generated pages ask for every tile, and finding walks every entity)
  var memo = { ents: null, devs: null, n: -1, list: null };
  function machines(client, saved) {
    if (saved === undefined) saved = setting('features.laundry', null);
    if (Array.isArray(saved) && saved.length) return saved.filter(function (m) { return m && m.id; });
    var ents = client && client.entities, devs = client && client.devices, n = client && client.states ? Object.keys(client.states).length : 0;
    if (memo.list && memo.ents === ents && memo.devs === devs && memo.n === n && ents) return memo.list;
    var list = found(client);
    memo = { ents: ents, devs: devs, n: n, list: list };
    return list;
  }
  // A MACHINE'S ROOM: its own (Accessories -> Laundry), else its status sensor's, else its device's
  function areaOf(client, m) {
    if (m.area) return m.area;
    var ents = (client && client.entities) || {}, devs = (client && client.devices) || {};
    var e = ents[m.status] || ents[m.power] || ents[m.running] || {};
    return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || null;
  }
  function byId(client, id) { return machines(client).filter(function (m) { return m.id === id; })[0] || null; }

  // ------------------------------------------------------------ WHAT ONE IS DOING
  function stateOf(client, m) {
    var st = stOf(client, m.status), ph = stOf(client, m.phase);
    if (st) {
      var raw = tidy(st.state);
      if ((raw === 'unavailable' || raw === 'unknown') && !ph) return raw === 'unavailable' ? 'offline' : 'off';
      var said = word(raw);
      if (String(m.status).indexOf('binary_sensor.') === 0) said = isOn(st) ? 'running' : 'off';
      var step = ph ? word(ph.state) : null;
      if (said === 'error' || said === 'paused' || said === 'delayed') return said;
      if (said === 'done' || step === 'done') return (said === null || said === 'done' || said === 'running' || said === 'off' || step === 'done') ? 'done' : said;
      if ((said === 'running' || said === null) && step && ['washing', 'rinsing', 'spinning', 'drying', 'cooling', 'wrinkle', 'paused', 'delayed'].indexOf(step) >= 0) return step;
      if (said === 'off' && step === 'wrinkle') return 'wrinkle';
      return said || step || 'off';
    }
    var run = stOf(client, m.running);
    if (run) return isOn(run) ? 'running' : (tidy(run.state) === 'unavailable' ? 'offline' : 'off');
    var pw = stOf(client, m.power);
    if (pw) {
      var w = num(pw.state);
      if (w === null) return tidy(pw.state) === 'unavailable' ? 'offline' : 'off';
      return w >= (Number(m.watts) || 10) ? 'running' : 'off';
    }
    return 'offline';
  }
  function held(client, m) {
    var st = stOf(client, HELD), t = st && st.attributes && st.attributes.machines, row = t && t[m.id];
    return row && typeof row === 'object' ? { since: Number(row.since) || 0, words: String(row.words || 'Done') } : null;
  }
  function ago(ms, now) {
    var min = Math.max(0, Math.round((now - ms) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    var h = Math.floor(min / 60);
    return h + (h === 1 ? ' hr' : ' hr') + ' ago';
  }
  function clock(ms) {
    var d = new Date(ms), h = d.getHours(), mi = d.getMinutes();
    return ((h % 12) || 12) + ':' + (mi < 10 ? '0' : '') + mi + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function mins(s) { return Math.max(1, Math.round(s / 60)); }
  // HOW LONG, in hours and minutes past the hour (the owner, 2026-11-10): "24 min", "1 hr 24 min", "2 hr"
  function dur(s) { var m = mins(s), h = Math.floor(m / 60); return h ? h + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min'; }
  // THE TIME: a finish time (timestamp) or the time left (a duration in s, min or h); a finish time past is no time
  function timeOf(client, m, now) {
    var st = stOf(client, m.time);
    if (!st) return { left: null, ends: null };
    var a = st.attributes || {}, v = st.state;
    if (a.device_class === 'timestamp' || (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v))) {
      var t = Date.parse(v);
      if (!isFinite(t)) return { left: null, ends: null };
      return t > now ? { left: (t - now) / 1000, ends: t } : { left: null, ends: null };
    }
    var n = num(v);
    if (n === null || n <= 0) return { left: null, ends: null };
    var u = String(a.unit_of_measurement || 'min').toLowerCase(), sec = /^(s|sec|seconds?)$/.test(u) ? n : /^(h|hr|hours?)$/.test(u) ? n * 3600 : n * 60;
    if (/^\d+:\d\d(:\d\d)?$/.test(String(v))) { var p = String(v).split(':').map(Number); sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 3600 + p[1] * 60; }
    return { left: sec, ends: now + sec * 1000 };
  }
  function look(client, m, now) {
    now = now || Date.now();
    var state = stateOf(client, m), kind = m.kind || 'washer';
    // a washer seen drying is a washer-dryer (a Samsung lists drying among every washer's steps; the owner's says it while it dries)
    if (kind === 'washer' && (state === 'drying' || state === 'cooling')) kind = 'combo';
    var lk = stOf(client, m.leak), leak = !!lk && isOn(lk), h = held(client, m), src = m.status ? 'status' : m.running ? 'running' : 'power';
    if (h && !runs(state) && state !== 'error') state = state === 'wrinkle' ? 'wrinkle' : 'done';
    var t = runs(state) && state !== 'delayed' ? timeOf(client, m, now) : { left: null, ends: null };
    var pr = stOf(client, m.progress), pct = pr && runs(state) ? num(pr.state) : null;
    if (pct !== null) pct = Math.max(0, Math.min(100, pct));
    var dr = stOf(client, m.door), rm = stOf(client, m.remote), pw = stOf(client, m.power);
    var o = {
      id: m.id, name: m.name || KIND_NAMES[kind], kind: kind, state: leak ? 'leak' : state, machine: state, src: src,
      left: t.left, ends: t.ends, pct: pct, leak: leak, held: h, runs: runs(state),
      door: dr ? (isOn(dr) || /open/.test(tidy(dr.state)) ? 'Open' : /lock/.test(tidy(dr.state)) ? 'Locked' : 'Closed') : null,
      remote: rm ? isOn(rm) : null, watts: pw ? num(pw.state) : null,
      title: '', sub: '', short: '', steps: null, step: null
    };
    // THE WORDS: the title says what it is doing; the line under it how long, or since when
    var s = o.state, left = o.left != null ? dur(o.left) + ' left' : '';
    o.title = NAMES[s] || 'Off';
    if (s === 'leak') { o.sub = 'Water under the ' + o.name.toLowerCase(); o.short = 'Leak'; }
    else if (s === 'error') { o.sub = 'Check the ' + o.name.toLowerCase(); o.short = 'Needs Help'; }
    else if (s === 'offline') { o.sub = 'Not answering'; o.short = 'Unavailable'; }
    else if (s === 'done') { o.sub = h ? 'Finished ' + ago(h.since * 1000, now) : 'Ready to unload'; o.short = 'Done'; }
    else if (s === 'wrinkle') { o.sub = 'Tumbling now and then'; o.short = 'Done'; }
    else if (s === 'delayed') { o.sub = 'Waiting to start'; o.short = 'Delayed'; }
    else if (s === 'paused') { o.sub = left ? left.replace('left', 'to go') : 'Waiting'; o.short = 'Paused'; }
    else if (s === 'off') { o.sub = ''; o.short = 'Off'; }
    else if (src !== 'status') { o.sub = src === 'power' && o.watts != null ? Math.round(o.watts) + ' W' : 'Running'; o.short = 'Running'; }
    // (past an hour, a short line drops "left")
    else { o.sub = left || (o.pct != null ? Math.round(o.pct) + '% done' : ''); o.short = o.left != null && o.left >= 3570 ? dur(o.left) : left || o.title; }
    o.endsWords = o.ends ? 'Done at ' + clock(o.ends) : '';
    // THE CYCLE'S STEPS (a status that says which): done before, now, after
    if (src === 'status') {
      var list = STEPS[kind] || STEPS.washer, at = STEP_OF[state] || null;
      if (kind !== 'dryer' && state === 'cooling') at = kind === 'combo' ? 'dry' : at;
      var fin = s === 'done' || s === 'wrinkle', i = at ? list.indexOf(at) : -1;
      if (fin || i >= 0) {
        o.step = at;
        o.steps = list.map(function (n, k) { return { key: n, name: STEP_NAMES[n], color: STEP_COLORS[n], done: fin || k < i, now: !fin && k === i }; });
      }
    }
    return o;
  }
  function ids(client, m) {
    var out = ROLES.map(function (r) { return m[r]; }).filter(Boolean);
    if (client && client.states && client.states[HELD]) out.push(HELD);
    return out;
  }

  // ------------------------------------------------------------ WHAT IT TAKES FROM HERE (pause, resume, stop: never a remote start)
  function controls(client, m) {
    var ents = (client && client.entities) || {}, anchor = [m.status, m.phase, m.time].filter(function (id) { return id && ents[id]; })[0];
    var dev = anchor ? devKey(ents[anchor], anchor) : '';
    var out = { pause: null, resume: null, stop: null, why: null };
    if (!dev) return out;
    var mine = Object.keys(ents).filter(function (id) { return ents[id] && devKey(ents[id], id) === dev && stOf(client, id); }).sort();
    mine.forEach(function (id) {
      var dom = id.split('.')[0], oid = id.split('.')[1];
      if (dom === 'select') {
        var opts = optsOf(stOf(client, id)).map(tidy);
        var opt = function (names) { return names.filter(function (n) { return opts.indexOf(n) >= 0; })[0] || null; };
        var p = opt(['pause']), r = opt(['run', 'resume', 'start']), s = opt(['stop', 'cancel']);
        if (p && !out.pause) out.pause = ['select', 'select_option', { entity_id: id, option: optsOf(stOf(client, id))[opts.indexOf(p)] }];
        if (r && !out.resume && p) out.resume = ['select', 'select_option', { entity_id: id, option: optsOf(stOf(client, id))[opts.indexOf(r)] }];
        if (s && !out.stop) out.stop = ['select', 'select_option', { entity_id: id, option: optsOf(stOf(client, id))[opts.indexOf(s)] }];
      } else if (dom === 'button') {
        if (/pause/.test(oid) && !out.pause) out.pause = ['button', 'press', { entity_id: id }];
        else if (/resume/.test(oid) && !out.resume) out.resume = ['button', 'press', { entity_id: id }];
        else if (/(^|_)(stop|cancel|stopreset)(_|$)/.test(oid) && !out.stop) out.stop = ['button', 'press', { entity_id: id }];
      }
    });
    var rm = stOf(client, m.remote);
    if (rm && !isOn(rm) && (out.pause || out.stop)) out.why = 'Turn on Remote Control on the ' + String(m.name || 'machine').toLowerCase() + ' to pause or stop it here.';
    return out;
  }

  // ------------------------------------------------------------ THE DRAWING
  var uid = 0;
  // THE PANEL'S CLOCK, drawn as an appliance's seven segments ("0:24", "End") -- ink of the drawing, not words: the words are
  // the block's own, on the type scale
  var SEGS = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg',
               '9': 'abcdfg', E: 'adefg', n: 'ceg', d: 'bcdeg' };
  function segs(str, cx) {
    var W = 3.8, H = 8, GAP = 1.6, top = 32, mid = top + H / 2, bot = top + H, chars = String(str).split('');
    var width = chars.reduce(function (n, c) { return n + (c === ':' ? 2 : W + GAP); }, 0) - GAP, x = cx - width / 2, d = '', dots = '';
    chars.forEach(function (c) {
      if (c === ':') { dots += '<circle cx="' + (x + 0.2).toFixed(1) + '" cy="' + (mid - 1.6) + '" r="0.75"/><circle cx="' + (x + 0.2).toFixed(1) + '" cy="' + (mid + 1.6) + '" r="0.75"/>'; x += 2;
        return; }
      var s = SEGS[c] || '', L = x, R = x + W, line = function (a, b, e, f) { d += 'M' + a.toFixed(1) + ' ' + b + 'L' + e.toFixed(1) + ' ' + f; };
      if (s.indexOf('a') >= 0) line(L, top, R, top);
      if (s.indexOf('b') >= 0) line(R, top, R, mid);
      if (s.indexOf('c') >= 0) line(R, mid, R, bot);
      if (s.indexOf('d') >= 0) line(L, bot, R, bot);
      if (s.indexOf('e') >= 0) line(L, mid, L, bot);
      if (s.indexOf('f') >= 0) line(L, top, L, mid);
      if (s.indexOf('g') >= 0) line(L, mid, R, mid);
      x += W + GAP;
    });
    return '<g class="dt"><path d="' + d + '"/>' + dots + '</g>';
  }
  function art(state, kind, o) {
    o = o || {};
    var s = STATES.indexOf(state) >= 0 ? state : 'off', dry = kind === 'dryer', id = 'hkla' + (++uid);
    var wet = !dry && /^(washing|rinsing|running|paused|leak)$/.test(s);
    var lvl = s === 'rinsing' ? 84 : 92, lie = /^(off|done|offline|delayed|leak|error)$/.test(s);
    var v = '<svg class="hkla s-' + s + '" viewBox="' + (o.crop ? '23 9 94 132" style="aspect-ratio:94/132' : '0 0 140 150') + '" role="img" aria-label="' +
      String(o.label || NAMES[s] || '').replace(/[&<>"]/g, '') + '">';
    v += '<defs><clipPath id="' + id + '"><circle cx="70" cy="90" r="25.5"/></clipPath></defs>';
    if (s === 'leak') v += '<ellipse class="pud" cx="64" cy="142" rx="58" ry="6.5"/>';
    v += '<ellipse class="sh" cx="70" cy="141" rx="50" ry="4.5"/>';
    if (s === 'drying') v += '<g class="heat"><path d="M52 12c-3 3 3 6 0 9"/><path d="M70 10c-3 3 3 6 0 9"/><path d="M88 12c-3 3 3 6 0 9"/></g>';
    v += '<g class="mach"><rect class="bd" x="24" y="24" width="92" height="114" rx="17"/><rect class="cut" x="24" y="48" width="92" height="3.2"/>';
    if (dry) v += '<rect class="cut" x="34" y="30" width="34" height="12" rx="6"/><circle class="cut" cx="98" cy="36" r="7"/><line class="kn" x1="98" y1="36" x2="98" y2="31.5"/>';
    else v += '<circle class="cut" cx="36" cy="36" r="4.2"/><circle class="cut" cx="48" cy="36" r="4.2"/><rect class="cut" x="72" y="30" width="34" height="12" rx="6"/>';
    if (o.display) v += segs(o.display, dry ? 51 : 89);
    v += '<circle class="cut" cx="70" cy="90" r="32"/><circle class="bd" cx="70" cy="90" r="28.6"/><circle class="gl' + (/^(off|offline)$/.test(s) ? ' dim' : '') + '" cx="70" cy="90" r="25.5"/>';
    v += '<g clip-path="url(#' + id + ')">';
    if (s === 'drying') v += '<circle class="warm" cx="70" cy="90" r="26"/>';
    if (s === 'done' || s === 'wrinkle') v += '<circle class="mintg" cx="70" cy="90" r="26"/>';
    if (wet) v += '<g class="wave"><path class="wt' + (s === 'rinsing' ? ' lt' : '') + '" d="M30 ' + lvl + ' q6 -3.2 12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 V124 H30Z"/></g>';
    if (s === 'spinning') v += '<circle class="wt" cx="70" cy="90" r="25" style="opacity:.18"/>';
    if (lie) v += '<g><ellipse class="c1" cx="61" cy="106" rx="13" ry="6"/><ellipse class="c3" cx="80" cy="108" rx="11" ry="5"/><ellipse class="c2" cx="72" cy="102" rx="9" ry="4.5"/></g>';
    else v +=
      '<g class="drum"><ellipse class="c1" cx="58" cy="102" rx="11" ry="6" transform="rotate(-20 58 102)"/><ellipse class="c2" cx="80" cy="100" rx="9" ry="5" transform="rotate(25 80 ' +
      '100)"/><ellipse class="c3" cx="70" cy="74" rx="8" ry="4.5"/></g>';
    if (s === 'rinsing') v += '<circle class="bub" cx="60" cy="104" r="1.8"/><circle class="bub" cx="74" cy="108" r="1.4"/><circle class="bub" cx="83" cy="102" r="1.6"/>';
    v += '</g><path class="gli" d="M53 78a21 21 0 0 1 11-8.5"/>';
    if (s === 'spinning') v += '<path class="arc" d="M33 74a40 40 0 0 1 9-13"/><path class="arc" d="M107 106a40 40 0 0 1-9 13"/>';
    if (s === 'cooling') v += '<g class="air"><path d="M104 80h10"/><path d="M104 96h8"/></g>';
    v += '</g>';
    var bx = 114, by = 26;
    if (s ===
      'paused') v +=
      '<g class="bdg"><circle class="w" cx="114" cy="26" r="15"/><rect class="k" x="107.5" y="19" width="4.2" height="14" rx="2"/><rect class="k" x="116.3" y="19" width="4.2" height="14" ' +
      'rx="2"/></g>';
    if (s ===
      'delayed') v +=
      '<g class="bdg"><circle class="w" cx="114" cy="26" r="15"/><circle class="ks" cx="114" cy="26" r="8"/><line class="ks" x1="114" y1="26" x2="114" y2="21"/><line class="ks" x1="114" y1="26" ' +
      'x2="117.5" y2="27.5"/></g>';
    if (s === 'done' || s === 'wrinkle') v += '<g class="bdg"><circle class="m" cx="114" cy="26" r="15"/><path class="ks" d="M107.5 26l4.5 4.6 8.5-9.2"/></g>';
    if (s === 'leak') v += '<g class="bdg"><circle class="r" cx="114" cy="26" r="16"/><path class="wk" d="M' + bx + ' ' + (by - 9.5) +
      'C110.2 21.7 106.8 25.8 106.8 29.4a7.2 7.2 0 0 0 14.4 0C121.2 25.8 117.8 21.7 ' + bx + ' ' + (by - 9.5) + 'Z"/></g>';
    if (s ===
      'error') v += '<g class="bdg"><circle class="r" cx="114" cy="26" r="15"/><rect class="wk" x="111.7" y="17" width="4.6" height="12" rx="2.3"/><circle class="wk" cx="114" cy="33" r="2.6"/></g>';
    return v + '</svg>';
  }
  var built = '';
  function css() {
    if (built) return built;
    var C = global.hkCards || {}, A = C.ACCENTS || {};
    var MINT = A.mint || '#63e6e2', RED = A.red || '#ff453a', WATER = '#64d2ff', WARM = '#ffb15c';
    return (built = [
      '.hkla{display:block;width:100%;height:auto;aspect-ratio:140/150;overflow:visible;flex:none}',
      '.hkla .sh{fill:rgba(0,0,0,.28)}.hkla .bd{fill:#f2f2f7}.hkla .cut{fill:#1a1c22}.hkla .gl{fill:#14161c}.hkla .gl.dim{fill:#20232b}',
      '.hkla .kn{stroke:#f2f2f7;stroke-width:2;stroke-linecap:round}',
      '.hkla .dt path{fill:none;stroke:' + MINT + ';stroke-width:1.1;stroke-linecap:round}.hkla .dt circle{fill:' + MINT + '}',
      '.hkla .wt{fill:' + WATER + ';opacity:.55}.hkla .wt.lt{opacity:.38}',
      '.hkla .c1{fill:#9aa3b5}.hkla .c2{fill:#c9cdd6}.hkla .c3{fill:#6c7486}',
      '.hkla .gli{fill:none;stroke:rgba(255,255,255,.22);stroke-width:2.4;stroke-linecap:round}',
      '.hkla .warm{fill:' + WARM + ';opacity:.16}.hkla .mintg{fill:' + MINT + ';opacity:.14}',
      '.hkla .heat path{fill:none;stroke:' + WARM + ';stroke-width:2.6;stroke-linecap:round;opacity:.85}',
      '.hkla .air path{fill:none;stroke:rgba(255,255,255,.55);stroke-width:2.4;stroke-linecap:round}',
      '.hkla .arc{fill:none;stroke:rgba(255,255,255,.6);stroke-width:2.6;stroke-linecap:round}',
      '.hkla .bub{fill:rgba(255,255,255,.75)}.hkla .pud{fill:' + WATER + ';opacity:.5}',
      '.hkla .bdg .w{fill:#fff}.hkla .bdg .k{fill:#1c1c1e}.hkla .bdg .m{fill:' + MINT + '}.hkla .bdg .r{fill:' + RED + '}.hkla .bdg .wk{fill:#fff}',
      '.hkla .bdg .ks{fill:none;stroke:#1c1c1e;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}',
      '.hkla.s-offline{opacity:.42}',
      '.hkla .drum{transform-origin:70px 90px;transform-box:view-box}',
      '@media (prefers-reduced-motion:no-preference){',
      '  .hkla.s-washing .drum{animation:hkla-rock 2.6s ease-in-out infinite alternate}',
      '  .hkla.s-rinsing .drum{animation:hkla-rock 3.2s ease-in-out infinite alternate}',
      '  .hkla.s-running .drum{animation:hkla-rock 2.8s ease-in-out infinite alternate}',
      '  .hkla.s-spinning .drum{animation:hkla-turn .42s linear infinite}',
      '  .hkla.s-drying .drum{animation:hkla-turn 3.4s linear infinite}',
      '  .hkla.s-cooling .drum{animation:hkla-turn 6s linear infinite}',
      '  .hkla.s-wrinkle .drum{animation:hkla-nudge 6s ease-in-out infinite}',
      '  .hkla .wave{animation:hkla-wave 1.8s linear infinite}',
      '  .hkla.s-rinsing .bub{animation:hkla-rise 2.2s ease-in infinite}',
      '  .hkla.s-rinsing .bub:nth-of-type(2){animation-delay:.7s}.hkla.s-rinsing .bub:nth-of-type(3){animation-delay:1.4s}',
      '  .hkla.s-spinning .mach{animation:hkla-shake .14s linear infinite}',
      '  .hkla.s-spinning .arc{animation:hkla-fade .42s linear infinite alternate}',
      '  .hkla .heat path{animation:hkla-heat 2.4s ease-out infinite}',
      '  .hkla .heat path:nth-child(2){animation-delay:.8s}.hkla .heat path:nth-child(3){animation-delay:1.6s}',
      '  .hkla .air path{animation:hkla-air 2.6s ease-in-out infinite}.hkla .air path:nth-child(2){animation-delay:.9s}',
      '  .hkla.s-leak .bdg,.hkla.s-error .bdg{transform-box:fill-box;transform-origin:center;animation:hkla-pulse 1.8s ease-in-out infinite}',
      '  .hkla.s-error .mach{animation:hkla-err 3s ease-in-out infinite}',
      '}',
      '@keyframes hkla-rock{0%{transform:rotate(-70deg)}100%{transform:rotate(110deg)}}',
      '@keyframes hkla-turn{to{transform:rotate(360deg)}}',
      '@keyframes hkla-nudge{0%,78%{transform:rotate(0)}92%,100%{transform:rotate(120deg)}}',
      '@keyframes hkla-wave{to{transform:translateX(-24px)}}',
      '@keyframes hkla-rise{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-22px);opacity:0}}',
      '@keyframes hkla-shake{0%,100%{transform:translate(0,0)}25%{transform:translate(.7px,-.4px)}50%{transform:translate(-.6px,.3px)}75%{transform:translate(.5px,.4px)}}',
      '@keyframes hkla-fade{from{opacity:.15}to{opacity:.8}}',
      '@keyframes hkla-heat{0%{transform:translateY(4px);opacity:0}30%{opacity:.9}100%{transform:translateY(-8px);opacity:0}}',
      '@keyframes hkla-air{0%,100%{transform:translateX(0);opacity:.25}50%{transform:translateX(5px);opacity:.85}}',
      '@keyframes hkla-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}',
      '@keyframes hkla-err{0%,82%,100%{transform:translateX(0)}85%{transform:translateX(-2px)}88%{transform:translateX(2px)}91%{transform:translateX(-1.5px)}94%{transform:translateX(1px)}}'
    ].join(''));
  }
  // the panel's clock: 0:24 while it runs, End when done
  function display(o) {
    if (o.runs && o.left != null) { var mm = mins(o.left), hh = Math.floor(mm / 60); return hh + ':' + ((mm % 60) < 10 ? '0' : '') + (mm % 60); }
    if (o.state === 'done' || o.state === 'wrinkle') return 'End';
    return '';
  }
  function glyph(kind) { return kind === 'dryer' ? 'hk:tumble-dryer' : 'hk:washing-machine'; }
  // the one most worth a look first: a leak or an error, then Done, then running (the soonest done), then the rest
  function rank(o) { return o.state === 'leak' || o.state === 'error' ? 0 : (o.state === 'done' || o.state === 'wrinkle') ? 1 : o.runs ? 2 : 3; }
  function lookAll(client, now) {
    return machines(client).map(function (m) { return look(client, m, now); });
  }
  function first(list) {
    return list.slice().sort(function (a, b) { return rank(a) - rank(b) || (a.left == null ? 1e9 : a.left) - (b.left == null ? 1e9 : b.left); })[0] || null;
  }

  // THE GENERATED PAGES (hk-strategy.js): each machine's own entity -- its status, else its power or running sensor -- stands for
  // it in its room, {by: {entity: machine}, area: {entity: area}}; its tile is a tall tile with the house glyph, still (the owner:
  // "no animation necessary though.. as none of the other animate"), "Drying · 24 min", a tap its laundry sheet
  function placed(client) {
    var out = { by: {}, area: {} };
    if (!client || !client.states) return out;
    try {
      machines(client).forEach(function (m) {
        var id = m.status || m.power || m.running;
        if (id && client.states[id]) { out.by[id] = m; out.area[id] = areaOf(client, m); }
      });
    } catch (e) { /* no machines, no tiles */ }
    return out;
  }
  function tile(m, name) {
    return { type: 'custom:hk-tall-card', name: (m && m.name) || name, machine: m && m.id, icon: glyph(m && m.kind), icon_color: 'blue',
             label_mode: 'laundry', tap_action: { action: 'laundry', machine: m && m.id } };
  }
  // THE SHEET (hk-sheet-laundry.js), from anywhere: the block, a room's tile, the chip
  function open(id, client) {
    var C = global.hkCards, D = global.hkDetail;
    if (!client && C && typeof C.client === 'function') { try { client = C.client(); } catch (e) { client = null; } }
    var list = machines(client || null), m = list.filter(function (x) { return x.id === id; })[0] || list[0];
    if (!D || typeof D.open !== 'function' || !m) return false;
    return !!D.open(null, { name: list.length > 1 ? 'Laundry' : m.name, icon: glyph(m.kind) }, { panel: { tag: 'hk-detail-laundry', config: { machine: m.id } } });
  }
  // THE CYCLE'S SETTINGS (the owner, 2026-11-10, Extra Large's mockup: "Cold · Extra High Spin · Normal Soil"): what the machine's own
  // selects (else sensors) on its device say -- the water's temperature, the spin, the soil, the dryness -- in that order; '' with none
  var SET = [{ re: /water_?temp|wash_?temp|(^|_)temp(erature)?(_|$)/, tail: '' }, { re: /spin/, tail: 'Spin' }, { re: /soil/, tail: 'Soil' },
             { re: /dry_?level|drying_?level|dryness/, tail: 'Dry' }];
  function settingsOf(client, m) {
    var ents = (client && client.entities) || {}, states = (client && client.states) || {}, e = ents[m.status], key = e && devKey(e, m.status);
    if (!key) return '';
    var sibs = Object.keys(states).filter(function (id) { return /^(select|sensor)\./.test(id) && ents[id] && devKey(ents[id], id) === key; }).sort();
    return SET.map(function (r) {
      var id = sibs.filter(function (x) { return r.re.test(x.split('.')[1]) && !/time|remain|progress|energy|power|device_temp/.test(x); })[0];
      var raw = id ? tidy(states[id].state) : '';
      if (!raw || /^(none|unknown|unavailable|off|not_applicable)$/.test(raw)) return '';
      var said = /^\d+$/.test(raw) ? raw + (r.tail === 'Spin' ? ' rpm' : '°')
        : raw.split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
      return r.tail && said.toLowerCase().indexOf(r.tail.toLowerCase()) < 0 && !/rpm$/.test(said) ? said + ' ' + r.tail : said;
    }).filter(Boolean).join(' · ');
  }
  // THIS LOAD'S POWER (the owner, 2026-11-10, the Extra Large and Large mockups): the machine's watts since this load started, each
  // stretch the color of the step it was in, and what the load has used. The start: the last time the machine went from not running to
  // running, read from its status's and step's history (twelve hours, as words, hk-stats.js); then its watts for the hours since.
  // null with nothing to draw (no power sensor, not running); {wait: true} while the history comes
  var HRS = [1, 2, 3, 4, 6, 8, 12];
  function trace(client, m, o, card, now) {
    var S = global.hkStats, pw = stOf(client, m.power), sid = m.status || m.running;
    if (!S || !S.history || !pw || !o || !o.runs || o.machine === 'delayed' || !sid) return null;
    now = now || Date.now();
    var kw = /^kw$/i.test(String((pw.attributes || {}).unit_of_measurement || '')) ? 1000 : 1;
    var sh = S.history(client, sid, 12, card, true), ph = m.phase ? S.history(client, m.phase, 12, card, true) : [];
    if (sh === null || ph === null) return { wait: true };
    var live = (num(pw.state) || 0) * kw;
    if (!sh.length) return { bare: true, watts: live };          // (no history this screen may read: the watts alone)
    // the machine's state at each change of either, oldest first, as stateOf reads it
    var ev = sh.map(function (r) { return { t: +r.t, k: sid, s: r.s }; }).concat(ph.map(function (r) { return { t: +r.t, k: m.phase, s: r.s }; }))
      .sort(function (a, b) { return a.t - b.t; });
    var cur = {}, seq = [];
    ev.forEach(function (x) {
      cur[x.k] = { state: x.s };
      var st = stateOf({ states: cur }, m);
      if (!seq.length || seq[seq.length - 1].st !== st) seq.push({ t: x.t, st: st });
    });
    var going = function (st) { return runs(st) && st !== 'delayed'; }, start = null;
    seq.forEach(function (x, i) { if (going(x.st) && (i === 0 || !going(seq[i - 1].st))) start = x.t; });
    if (start === null) start = now - 3600000;
    start = Math.max(start, now - 12 * 3600000);
    var hrs = HRS.filter(function (h) { return h * 3600000 >= now - start + 600000; })[0] || 12;
    var P = S.history(client, m.power, hrs, card);
    if (P === null) return { wait: true };
    if (!P.length) return { bare: true, watts: live };
    // its watts as held between changes: the one before the start held from it, the live reading at the end
    var pts = [], before = null;
    P.forEach(function (r) { var t = +r.t; if (t <= start) before = r.v * kw; else if (t < now) pts.push({ t: t, v: r.v * kw }); });
    pts.unshift({ t: start, v: before !== null ? before : pts.length ? pts[0].v : live });
    pts.push({ t: now, v: live });
    var kwh = 0, peak = 0;
    for (var i = 0; i + 1 < pts.length; i++) kwh += pts[i].v * (pts[i + 1].t - pts[i].t) / 3.6e9;
    // two-minute stretches (more for a long load, 120 at most), each its time-weighted watts and the step it was in
    var span = Math.max(1, now - start), step = Math.max(120000, span / 120), bins = [], j = 0, kind = o.kind;
    var stepAt = function (t) {
      var st = null; seq.forEach(function (x) { if (x.t <= t) st = x.st; });
      var k = STEP_OF[st] || null; if (st === 'cooling' && kind === 'combo') k = 'dry';
      return k;
    };
    for (var b0 = start, last = null; b0 < now; b0 += step) {
      var b1 = Math.min(now, b0 + step), sum = 0;
      while (j + 1 < pts.length && pts[j + 1].t <= b0) j++;
      for (var q = j; q < pts.length && pts[q].t < b1; q++) {
        var a = Math.max(b0, pts[q].t), z = Math.min(b1, q + 1 < pts.length ? pts[q + 1].t : b1);
        if (z > a) sum += pts[q].v * (z - a);
      }
      var w = sum / Math.max(1, b1 - b0), k = stepAt((b0 + b1) / 2) || last || (STEPS[kind] || STEPS.washer)[0];
      last = k; peak = Math.max(peak, w);
      bins.push({ t0: b0, t1: b1, w: w, k: k });
    }
    return { start: start, end: Math.max(o.ends || now, now), now: now, bins: bins, kwh: kwh, peak: peak, watts: live };
  }
  global.hkLaundry = {
    settingsOf: settingsOf, trace: trace,
    STATES: STATES, RUNNING: RUNNING, ROLES: ROLES, WORDS: WORDS, STEPS: STEPS, STEP_OF: STEP_OF, STEP_COLORS: STEP_COLORS, NAMES: NAMES, KIND_NAMES: KIND_NAMES,
    HELD: HELD, CLEAR: 'laundry_done_clear', tidy: tidy, word: word, found: found, machines: machines, byId: byId, areaOf: areaOf, stateOf: stateOf,
    look: look, lookAll: lookAll, open: open, dur: dur, placed: placed, tile: tile, first: first, rank: rank, ids: ids, controls: controls, art: art, display: display, glyph: glyph,
    get CSS() { return css(); }
  };
})(globalThis);
