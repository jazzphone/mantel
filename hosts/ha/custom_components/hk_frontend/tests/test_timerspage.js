// The Timers page on one page: hk-timers-page-card, the `fit` shape of
// hk-timers-card, and the `layout: panel` New Timer.
//
// The creator sits on the right, the House timers' bottom lines up with the
// keypad's, and past six running timers the cards page sideways. The alignment
// itself is measured in a browser (it is layout); what is held here is the
// logic that decides the shape, the calls the page makes, and -- when a home's
// dashboards sit beside the integration -- the page they generate.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/modules/hk-timers.js');

// A querySelector/All over the shim's real children, for simple `.class`,
// `tag` and `.a .b` selectors -- the shim's own returns stubs and [].
function all(root, sel) {
  var parts = sel.trim().split(/\s+/), out = [];
  function match(el, p) {
    if (!el || !el.tagName) return false;
    if (p.charAt(0) === '.') {
      var cls = ' ' + (el.className || '') + ' ';
      return p.slice(1).split('.').every(function (c) { return cls.indexOf(' ' + c + ' ') >= 0; });
    }
    return String(el.tagName).toLowerCase() === p.toLowerCase();
  }
  function walk(el, i) {
    (el.children || []).forEach(function (c) {
      if (match(c, parts[i])) { if (i === parts.length - 1) out.push(c); else walk(c, i + 1); }
      walk(c, i);
    });
  }
  walk(root, 0);
  return out.filter(function (e, k) { return out.indexOf(e) === k; });
}
function real(root) {
  root.querySelector = function (sel) { return all(root, sel)[0] || null; };
  root.querySelectorAll = function (sel) { return all(root, sel); };
  return root;
}

var SLOTS = [];
for (var i = 1; i <= 15; i++) SLOTS.push({ entity: 'timer.t' + i, label: 'T' + i, glyph: 'mdi:timer-outline' });
function timers(n) {
  var rows = {};
  var end = new Date(Date.now() + 600000).toISOString();
  SLOTS.forEach(function (t, k) {
    rows[t.entity] = k < n ? ['active', { duration: '0:10:00', finishes_at: end, remaining: '0:10:00' }]
                           : ['idle', { duration: '0:10:00' }];
  });
  return H.house(rows);
}
function running(n, heading) {
  var card = H.make('hk-timers-card');
  card.setConfig({ fit: true, heading: heading, timers: SLOTS });
  card.hass = timers(n).hass();
  return card;
}

H.run('TIMERS PAGE', [

  function () {
    H.section('the shape for this many running');
    var S = customElements.get('hk-timers-card').shape;
    H.eq('1 or 2: the full card, two across', [S(1).compact, S(2).compact, S(2).cols], [false, false, 2]);
    H.eq('3 or 4: compact, two across', [S(3).compact, S(4).cols], [true, 2]);
    H.eq('5 or 6 (and pages of 6 past that): compact, three across', [S(5).cols, S(6).cols, S(9).cols], [3, 3, 3]);
  },

  function () {
    H.section('hk-timers-card, fit');
    var c2 = running(2, 'Running'), k2 = c2._root.children;
    H.eq('its own heading row first', [k2[0].className, k2[0].children[0].textContent], ['hrow', 'Running']);
    var g2 = k2[1];
    H.eq('two running: one grid, two across, full cards',
         [g2.className, g2.style['--cols'], g2.children.length, g2.children[0].className], ['grid fit', '2', 2, 'tc']);

    var g4 = running(4)._root.children[0];
    H.eq('four: compact cards, two across', [g4.style['--cols'], g4.children.length, g4.children[3].className], ['2', 4, 'tc cp']);
    var g6 = running(6)._root.children[0];
    H.eq('six: compact cards, three across', [g6.style['--cols'], g6.children.length], ['3', 6]);

    var c9 = running(9, 'Running'), k9 = c9._root.children;
    var pw = k9[1], pages = pw.children[0];
    H.eq('nine: pages of six in their own box', [pw.className, pages.className, pages.children.length], ['pw', 'pages', 2]);
    H.eq('...six on the first page, three on the second, all compact',
         [pages.children[0].children.length, pages.children[1].children.length, pages.children[1].children[0].className],
         [6, 3, 'tc cp']);
    var dots = k9[0].children[1];
    H.eq('the dots sit in the heading row, one per page, the first current',
         [dots.className, dots.children.length, dots.children[0].getAttribute('aria-current'), dots.children[1].getAttribute('aria-current')],
         ['dots', 2, 'true', 'false']);
    H.ok('each dot says which page it is', dots.children[1].getAttribute('aria-label') === 'Timers page 2 of 2');
    H.ok('the pages are held by reference (hk-glass puts its layer inside the row)', c9._pageEls.length === 2 && c9._pageEls[0] === pages.children[0]);
    dots.children[1].click();
    H.eq('a dot moves the page and the dot', [c9._page, dots.children[1].getAttribute('aria-current')], [1, 'true']);

    var c13 = running(13); c13._page = 2;
    c13._sig = null; c13._render();
    H.eq('a redraw keeps the page you were on', c13._page, 2);
    c13.hass = timers(4).hass();
    H.eq('...and back to four there are no pages', [c13._page, c13._root.children[0].className], [0, 'grid fit']);

    var c0 = H.make('hk-timers-card');
    c0.setConfig({ fit: true, heading: 'Running', timers: SLOTS, empty_text: 'Nothing is running.' });
    c0.hass = timers(0).hass();
    H.eq('none: the heading and one line of text', [c0._root.children[1].className, c0._root.children[1].textContent], ['empty', 'Nothing is running.']);

    var old = H.make('hk-timers-card');
    old.setConfig({ timers: SLOTS });
    old.hass = timers(4).hass();
    H.eq('without fit the card is what it was (one grid, full cards)', [old._root.children[0].className, old._root.children[0].children[0].className], ['grid', 'tc']);
  },

  function () {
    H.section('hk-timer-new-card, layout: panel');
    var W = customElements.get('hk-timer-new-card').words;
    H.eq('Start says what it starts', [W({ total: 1500, h: 0, m: 25 }), W({ total: 3600, h: 1, m: 0 }), W({ total: 5400, h: 1, m: 30 })],
         ['25 min', '1 hr', '1 hr 30 min']);
    var p = H.make('hk-timer-new-card');
    real(p._root);
    p.setConfig({ layout: 'panel', name_chips: ['Pasta', 'Oven', 'Laundry', 'Tea', 'Kids', 'Break', 'Extra'], tint: 'rgb(1, 2, 3)' });
    var wrap = p._root.children[0], parts = wrap.children.map(function (c) { return c.className; });
    H.eq('one column, no caption: the duration, the keypad, the name, the chips, Start',
         parts, ['ro', 'pad', 'namebox', 'chips', 'start']);
    H.eq('the plate carries the tint for Start', [wrap.className, wrap.style['--hk-timer-tint']], ['wrap panel', 'rgb(1, 2, 3)']);
    H.ok('the status line shares the hint\'s place beside the duration',
         wrap.children[0].children[1].className === 'side' && wrap.children[0].children[1].children[1].className === 'hk-status');
    var pad = wrap.children[1].children;
    H.eq('twelve keys, the last is Delete', [pad.length, pad[9].textContent, pad[11].getAttribute('aria-label')], [12, '00', 'Delete']);
    H.eq('six name chips, never more (three by two)', wrap.children[3].children.length, 6);
    var start = wrap.children[4];
    H.eq('empty: Start is off and the readout asks for a duration',
         [start.getAttribute('aria-disabled'), start.textContent, wrap.children[0].children[1].children[0].textContent],
         ['true', 'Start Timer', 'Type a duration']);
    pad[1].click(); pad[4].click();      // 2, 5
    H.eq('25 typed: "Start 25 min", and when it would end',
         [start.getAttribute('aria-disabled'), start.textContent, /^Ends /.test(wrap.children[0].children[1].children[0].textContent)],
         ['false', 'Start 25 min', true]);
    wrap.children[3].children[3].click();   // Tea
    H.eq('a chip is the name', [p._name, wrap.children[3].children[3].getAttribute('aria-pressed')], ['Tea', 'true']);
    H.attach(p);
    H.ok('on the page, the end time is kept fresh', !!p._endsT);
    H.detach(p);
    H.ok('off it, that interval is given back', !p._endsT);
  },

  function () {
    H.section('hk-timers-page-card');
    var P = customElements.get('hk-timers-page-card');
    H.eq('preset words and durations', [P.label(5), P.label(60), P.label(90), P.hms(5), P.hms(60)],
         ['5 min', '1 hr', '1 hr 30 min', '00:05:00', '01:00:00']);
    var house = H.house({ 'timer.nap_timer': ['idle', {}], 'timer.night_timer': ['active', {}], 'timer.good_morning_timer': ['idle', {}],
                          'script.quick_timer_start': ['off', {}], 'script.quick_timer_create': ['off', {}] });
    var sent = [];
    function answering(resp) {
      var h = house.hass();
      h.callService = function (d, s, data, target, notify, want) {
        sent.push({ call: d + '.' + s, data: data, want: want });
        return Promise.resolve({ response: resp });
      };
      return h;
    }
    var pc = H.make('hk-timers-page-card');
    real(pc._root);
    pc.setConfig({ timers: SLOTS, house: [
      { entity: 'timer.nap_timer', name: 'Nap', icon: 'mdi:bed-clock' },
      { entity: 'timer.night_timer', name: 'Night', icon: 'hk:weather-night' },
      { entity: 'timer.good_morning_timer', name: 'Good Morning', icon: 'hk:weather-sunset-up' }] });
    pc.hass = answering({ started: true, slot: 'timer.quick_1' });
    var pg = pc._root.children[0];
    H.eq('two columns: the timers, then the New Timer panel', [pg.className, pg.children[0].className, pg.children[1].className], ['pg', 'main', 'side']);
    H.eq('left: Quick start, Running, House timers',
         pg.children[0].children.map(function (c) { return c.className; }), ['s-qs', 's-run', 's-house']);
    H.eq('six Quick start keys', all(pc._root, '.qk').map(function (k) { return k.textContent; }),
         ['5 min', '10 min', '15 min', '20 min', '30 min', '1 hr']);
    H.eq('only the IDLE House timers (Night is running: it is a card instead)', [pc._hgrid.children.length, pc._shouse.hidden], [2, false]);

    // NO `house:` IN ITS YAML: the House timers come from the settings
    // (features.house_timers), named and pictured as their accessories are
    var savedHS = window.hkSettings;
    window.hkSettings = { get: function (p, f) {
      if (p === 'features.house_timers') return ['timer.nap_timer', 'timer.night_timer', 'timer.gone'];
      if (p === 'accessories') return { entities: { 'timer.night_timer': { icon: 'hk:weather-night', name: 'Bedtime' } } };
      return f; } };
    var hh = H.house({ 'timer.nap_timer': ['idle', { friendly_name: 'Nap - Timer', icon: 'mdi:bed-clock' }],
                       'timer.night_timer': ['idle', { friendly_name: 'Night -Timer', icon: 'mdi:sleep' }] });
    var auto = H.make('hk-timers-page-card');
    auto.setConfig({ timers: SLOTS });
    auto.hass = hh.hass();
    H.eq('the house\'s timers, less "- Timer", pictured as themselves or their accessory',
         auto._house(), [{ entity: 'timer.nap_timer', name: 'Nap', icon: 'mdi:bed-clock' },
                         { entity: 'timer.night_timer', name: 'Bedtime', icon: 'hk:weather-night' }]);
    var own = H.make('hk-timers-page-card');
    own.setConfig({ timers: SLOTS, house: [] });
    own.hass = hh.hass();
    H.eq('...but a card that lists its own (even none) keeps it', own._house(), []);
    window.hkSettings = savedHS;

    // STACKS BY ITS OWN WIDTH, not the window's: a tablet with the menu
    // docked has an iPad's page and stacks as an iPad does.
    var w = 1220, iw = window.innerWidth;
    pc.getBoundingClientRect = function () { return { width: w, left: 0, top: 0, right: w, bottom: 800, height: 800 }; };
    window.innerWidth = 1280;
    pc._shape();
    H.ok('a wall tablet\'s 1,220 px: side by side', !pc.hasAttribute('data-stack') && !pc._new.hasAttribute('data-wide'));
    w = 932; pc._shape();
    H.ok('the same tablet with the menu docked (932 px): stacked, the New Timer panel wide',
         pc.hasAttribute('data-stack') && pc._new.hasAttribute('data-wide'));
    window.innerWidth = 744; w = 706; pc._shape();
    H.ok('an iPad mini held upright: stacked', pc.hasAttribute('data-stack'));
    window.innerWidth = 1440; w = 352; pc._shape();
    H.ok('a 352 px section on a desk: stacked, the New Timer panel kept narrow',
         pc.hasAttribute('data-stack') && !pc._new.hasAttribute('data-wide'));
    window.innerWidth = 402; w = 386; pc._shape();
    H.ok('a phone keeps its own layout (the 640 px media query), not this one',
         !pc.hasAttribute('data-stack') && !pc._new.hasAttribute('data-wide'));
    w = 0; pc._shape();
    H.ok('not laid out yet (0 wide): left as it was', !pc.hasAttribute('data-stack'));
    window.innerWidth = iw;

    pc._quick(10);
    H.ok('while it is on its way, the keys are off', all(pc._root, '.qk').every(function (k) { return k.getAttribute('aria-disabled') === 'true'; }));
    return H.tick().then(function () {
      H.eq('Quick start asks the allocator, for an answer', [sent[0].call, sent[0].data.duration, sent[0].want],
           ['script.quick_timer_start', '00:10:00', true]);
      H.eq('...and says it started', [pc._hkStatus.kind, pc._hkStatus.text], ['sent', 'Started a 10 min timer.']);
      H.ok('the keys are back', all(pc._root, '.qk').every(function (k) { return k.getAttribute('aria-disabled') === 'false'; }));
      pc.hass = answering({ started: false, reason: 'no_free_slot' });
      pc._quick(5);
      return H.tick().then(function () {
        H.ok('all four busy is a warning that names them, not "started"',
             pc._hkStatus.kind === 'warn' && /four/.test(pc._hkStatus.text), pc._hkStatus);
        house.set('timer.nap_timer', 'active', {});
        house.set('timer.good_morning_timer', 'active', {});
        pc.hass = house.hass();
        H.ok('every House timer running: the section goes', pc._shouse.hidden === true);
        // NO HELPERS: a Quick start key on a dashboard without the
        // quick-timer helpers says so and calls nothing
        var before = sent.length;
        var bare = H.make('hk-timers-page-card');
        real(bare._root);
        bare.setConfig({ timers: SLOTS, house: [], quick_script: 'script.not_installed' });
        bare.hass = answering({ started: true, slot: 'timer.quick_1' });
        bare._quick(10);
        H.ok('no timer helpers: Quick start calls nothing', sent.length === before);
        H.ok('...and names the helpers, not the network', bare._hkStatus.kind === 'failed' &&
             /helpers/.test(bare._hkStatus.text) && !/reach/i.test(bare._hkStatus.text), bare._hkStatus);
      });
    });
  },

  // THE PICKER'S STARTER CONFIG lists the quick-timer slots, as a generated
  // Timers page does -- `timers: []` would never show a running quick timer.
  function () {
    H.section('starter config: the quick-timer slots');
    var stub = customElements.get('hk-timers-page-card').getStubConfig;
    var withSlots = H.house({
      'timer.quick_1': ['idle', {}], 'timer.quick_2': ['active', {}],
      'input_text.quick_timer_1_name': ['Pasta', {}]
    }).hass();
    H.eq('the installed slots, named from their input_text when there is one', stub(withSlots).timers, [
      { entity: 'timer.quick_1', label: 'Quick Timer 1', glyph: 'mdi:timer-outline', label_entity: 'input_text.quick_timer_1_name' },
      { entity: 'timer.quick_2', label: 'Quick Timer 2', glyph: 'mdi:timer-outline' }]);
    H.eq('no helpers: an empty list', stub(H.house({}).hass()).timers, []);
    H.ok('...and never a house: list (it would override House Timers)', !('house' in stub(withSlots)));
  },

  // HK TIMERS' SIZE follows what it shows: the empty line, or its rows.
  function () {
    H.section('hk-timers-card: getCardSize');
    var rows = {}, ids = [1, 2, 3, 4, 5, 6, 7].map(function (i) { return 'timer.t' + i; });
    ids.forEach(function (id) { rows[id] = ['idle', {}]; });
    var house = H.house(rows), card = H.make('hk-timers-card');
    card.setConfig({ timers: ids.map(function (id) { return { entity: id }; }) });
    card.hass = house.hass();
    H.eq('nothing running: one row (the empty line)', card.getCardSize(), 1);
    house.set('timer.t1', 'active');
    card.hass = house.set('timer.t2', 'paused');
    H.eq('two running: one row of cards', card.getCardSize(), 4);
    card.hass = house.set('timer.t4', 'active');
    card.hass = house.set('timer.t5', 'active');
    H.eq('four running: two rows', card.getCardSize(), 8);
    card.setConfig({ fit: true, timers: ids.map(function (id) { return { entity: id }; }) });
    card.hass = house.hass();
    H.eq('fit, four running: its two compact rows', card.getCardSize(), 7);
  }

]);
