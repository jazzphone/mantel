// THE CALENDAR AND TO-DO BLOCKS AS WIDGETS (2026-10-31, the owner's mock-up "Blocks as widgets"; cards/
// hk-calendar.js): the Calendar block at Small (the weekday, the date, the next event and how many more
// today), Tall and Large (what is next, a later day under its own heading) and Extra Large (the month, a dot
// under each day with events, today ringed and the chosen day filled, its events beside it; a tap chooses a
// day, a second opens it, the arrows turn the month); and the To-do block (custom:hk-todo-card), its items read
// and ticked off through the Side Pane's own reader (hkSidePane.todo), at Small, Tall, Large and Extra Large
// (two lists side by side). A fictional house; the clock pinned to noon.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run blocks_calendar');
load(HK_ROOT + '/tests/fixed_clock.js');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/tests/sample_settings.js');
window.HK_SIDEPANE_NO_WIRE = true;
load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/modules/hk-sidepane.js');
load(HK_ROOT + '/frontend/cards/hk-calendar.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');

var K = window.hkCalendar, U = K._;
var DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function at(d, h, m) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()); }
var NOW = new Date(), TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
function timed(uid, title, s, e) { return { uid: uid, summary: title, start: { dateTime: U.isoLocal(s) }, end: { dateTime: U.isoLocal(e) } }; }
function allDay(uid, title, s, e) { return { uid: uid, summary: title, start: { date: ymd(s) }, end: { date: ymd(e) } }; }
function html(card) { return card._root.__html || ''; }
function calHouse() {
  return H.house({ 'calendar.home': ['off', { friendly_name: 'Home Calendar', supported_features: 7 }] });
}
// a calendar block at a size, its events answered
function calBlock(size, events, cfg) {
  U.store.got = {}; U.store.live = {};          // (the shared store keeps an answer for a minute)
  var hs = calHouse(), card = H.make('hk-calendar-pane-card');
  card.setAttribute('size', size);
  card.setConfig(Object.assign({ type: 'custom:hk-calendar-pane-card' }, cfg || {}));
  card.hass = hs.hass();
  hs.api.forEach(function (r) { r.resolve(events); });
  return H.tick(8).then(function () { return { card: card, hs: hs }; });
}
// a tap on the block: its listener handed the element the tap's closest() finds
function tap(card, attrs) {
  var el = { getAttribute: function (k) { return attrs[k]; }, hasAttribute: function (k) { return attrs[k] !== undefined; } };
  card._root._listeners.click.forEach(function (f) { f({ target: { closest: function () { return el; } } }); });
}
var EVENTS = [allDay('a', 'Recycling Day', TODAY, addDays(TODAY, 1)),
  timed('p', 'Piano Lesson', at(TODAY, 14), at(TODAY, 15)),
  timed('d', 'Dinner with the Parkers', at(TODAY, 18, 30), at(TODAY, 20)),
  timed('x', 'Breakfast', at(TODAY, 8), at(TODAY, 9)),
  timed('t', 'Dentist', at(addDays(TODAY, 1), 9), at(addDays(TODAY, 1), 10))];

H.run('CALENDAR AND TO-DO BLOCKS', [
  function () {
    H.section('the catalog builds them');
    H.eq('calendar: the pane card', window.hkGridCatalog.config({ card: 'calendar', size: 'XL' }).type, 'custom:hk-calendar-pane-card');
    H.eq('todo: the To-do card, its list', window.hkGridCatalog.config({ card: 'todo', size: 'T', opts: { entity: 'todo.groceries' } }),
         { type: 'custom:hk-todo-card', entity: 'todo.groceries' });
    H.ok('...registered with the calendar cards', !!customElements.get('hk-todo-card') && !!customElements.get('hk-calendar-pane-card'));
  },
  function () {
    H.section('Calendar Small: the weekday in red, the date, the next event and how many more today');
    return calBlock('S', EVENTS).then(function (r) {
      var s = html(r.card);
      H.ok('the widget, one tap', /class="blk wg S" role="button" tabindex="0" data-go="1"/.test(s), s.slice(0, 120));
      H.ok('...the weekday and the date', s.indexOf('<div class="wd">' + DOW_LONG[TODAY.getDay()] + '</div><div class="dn">' + TODAY.getDate() + '</div>') >= 0);
      H.ok('...the next: the all-day first, the past (Breakfast) left out', s.indexOf('Recycling Day') > 0 && s.indexOf('All day') > 0 && s.indexOf('Breakfast') < 0);
      H.ok('...and how many more today', s.indexOf('2 more today') > 0);
      return calBlock('S', [EVENTS[4]]);
    }).then(function (r) {
      var s = html(r.card);
      H.ok('nothing left today: tomorrow\'s first, said so', s.indexOf('Dentist') > 0 && s.indexOf('Tomorrow · 9:00 AM') > 0 && s.indexOf('Nothing more today') > 0, s);
      var opened = [];
      window.hkDetail = { open: function (cal, x, o) { opened.push(o.event.title); return true; } };
      customElements.define('hk-detail-event', function () {});
      tap(r.card, { 'data-go': '1' });
      H.eq('...a tap opens the event shown', opened, ['Dentist']);
      return calBlock('S', []);
    }).then(function (r) {
      H.ok('nothing at all: Nothing scheduled, no foot', html(r.card).indexOf('Nothing scheduled') > 0 && html(r.card).indexOf('class="ft"') < 0);
    });
  },
  function () {
    H.section('Calendar Tall and Large: the rows, a later day under its heading');
    return calBlock('T', EVENTS).then(function (r) {
      var s = html(r.card);
      H.eq('Tall: what is still to come, then tomorrow\'s', (s.match(/class="ev2"/g) || []).length, 4);
      H.ok('...under its own heading', s.indexOf('<div class="gh">Tomorrow</div>') > 0);
      H.ok('...each with its color as a bar, its start', /<i class="bar" style="background:rgba\(/.test(s) && s.indexOf('<small>2:00 PM</small>') > 0);
      H.ok('...a foot for "N more", hidden until a row is cut', s.indexOf('<div class="ft" style="display:none"></div>') > 0);
      return calBlock('L', EVENTS);
    }).then(function (r) {
      var s = html(r.card);
      H.ok('Large: the date in a column, the rows beside it', /<div class="c1"><div class="wd">[^<]+<\/div><div class="dn">\d+<\/div><\/div><div class="c2"><div class="ls">/.test(s), s.slice(0, 200));
      H.ok('...from and to', s.indexOf('2:00 – 3:00 PM') > 0 && s.indexOf('6:30 – 8:00 PM') > 0);
      var opened = [];
      window.hkDetail = { open: function (cal, x, o) { opened.push(o.event.title); return true; } };
      tap(r.card, { 'data-ev': '1' });
      H.eq('...a row opens its event', opened, ['Piano Lesson']);
      return calBlock('L', EVENTS, { month: true });
    }).then(function (r) {
      H.ok('Month View keeps Large a month of its own', html(r.card).indexOf('class="blk mo L"') >= 0);
    });
  },
  function () {
    H.section('Calendar Extra Large: the month, the chosen day beside it');
    var first = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), from = U.weekStart(first);
    return calBlock('XL', EVENTS).then(function (r) {
      var s = html(r.card), card = r.card;
      H.ok('it asks for the month\'s weeks', r.hs.api[0].path.indexOf(encodeURIComponent(U.isoLocal(from))) > 0 &&
           r.hs.api[0].path.indexOf(encodeURIComponent(U.isoLocal(addDays(from, 42)))) > 0, r.hs.api[0].path);
      H.ok('the month: every day of it a button, today ringed and chosen', new RegExp('class="md today sel" role="button" tabindex="0" data-day="' + ymd(TODAY) + '"').test(s));
      H.ok('...a dot in an event\'s color under a day with events', /data-day="[^"]+"[^>]*with events"><b>\d+<em><u style="background:rgba\(/.test(s));
      H.ok('...its name and arrows', s.indexOf('data-mon="-1"') > 0 && s.indexOf('data-mon="1"') > 0);
      H.ok('beside it, today\'s events, the past dimmed', s.indexOf('<div class="wd">Today, ') > 0 && /class="ev2 past"[^>]*aria-label="Breakfast/.test(s));
      var other = addDays(TODAY, TODAY.getDate() < 15 ? 1 : -1);
      tap(card, { 'data-day': ymd(other) });
      s = html(card);
      H.ok('a tap chooses a day: filled, its events beside the month', new RegExp('class="md sel" role="button" tabindex="0" data-day="' + ymd(other) + '"').test(s) &&
           s.indexOf('<div class="wd">' + DOW_LONG[other.getDay()] + ', ') > 0, s.slice(s.indexOf('class="c2"'), s.indexOf('class="c2"') + 200));
      var went = [];
      window.hkCards.navigate = function (to) { went.push(to); };
      tap(card, { 'data-day': ymd(other) });
      H.ok('...a second opens it on the Calendar page', went.length === 1 && went[0].indexOf('calendar?day=' + ymd(other)) > 0, went);
      var asked = r.hs.api.length;
      tap(card, { 'data-mon': '1' });
      var next = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 1);
      H.ok('the arrow turns the month: its weeks asked for, its 1st chosen', r.hs.api.length > asked &&
           new RegExp('class="md[^"]* sel" role="button" tabindex="0" data-day="' + ymd(next) + '"').test(html(card)));
    });
  },
  function () {
    H.section('To-do: the Side Pane\'s reader, the Reminders widget');
    var hs = H.house({ 'todo.groceries': ['3', { friendly_name: 'Groceries' }], 'todo.household': ['2', { friendly_name: 'Household' }] });
    var TODO = window.hkSidePane._.TODO;
    var ITEMS = { 'todo.groceries': [{ uid: 'g1', summary: 'Milk', done: false }, { uid: 'g2', summary: 'Eggs', done: false }, { uid: 'g3', summary: 'Coffee beans', done: false }],
                  'todo.household': [{ uid: 'h1', summary: 'Bins out', done: false }, { uid: 'h2', summary: 'Fix the gate', done: false }] };
    var answer = function () { hs.ws.forEach(function (r) { if (!r.done) { r.done = true; r.resolve({ entity_id: r.msg.entity_id, left: ITEMS[r.msg.entity_id].length, items: ITEMS[r.msg.entity_id] }); } }); };
    function block(size, cfg) {
      var card = H.make('hk-todo-card');
      card.setAttribute('size', size);
      card.setConfig(Object.assign({ type: 'custom:hk-todo-card' }, cfg || {}));
      card.hass = hs.hass();
      answer();
      return H.tick(8).then(function () { return card; });
    }
    Object.keys(TODO).forEach(function (k) { delete TODO[k]; });
    var t;
    return block('T', {}).then(function (card) {
      var s = html(card);
      H.eq('none named: the house\'s first list, read as the Side Pane reads it', hs.ws.map(function (r) { return r.msg; }),
           [{ type: 'hk_frontend/todo/items', entity_id: 'todo.groceries', completed: false }]);
      H.ok('...into the Side Pane\'s own cache (one reader)', !!TODO['todo.groceries'] && !!TODO['todo.groceries'].got);
      H.ok('Tall: the name as the one gray heading (no color of its own), the count large', s.indexOf('<div class="ln">Groceries</div><div class="cn">3</div>') > 0 && s.indexOf('--hue:' + window.hkCards.ACCENTS.orange) > 0, s.slice(0, 300));
      H.eq('...the items, each with its circle', (s.match(/class="it" role="button"/g) || []).length, 3);
      H.ok('...the name and count a tap to the whole list', /class="hd" role="button" tabindex="0" data-open="todo.groceries"/.test(s));
      t = card;
      return block('S', { entity: 'todo.household' });
    }).then(function (card) {
      var s = html(card);
      H.ok('Small: its own list, in the next color, the count and what is next', s.indexOf('--hue:' + window.hkCards.ACCENTS.blue) > 0 && s.indexOf('<div class="ln">Household') > 0 &&
           s.indexOf('<div class="cn">2</div>') > 0 && s.indexOf('Next: Bins out') > 0, s);
      H.ok('...the block one tap that opens the list', /class="blk tw S" role="button" tabindex="0" data-open="todo.household"/.test(s));
      return block('XL', { entity: 'todo.groceries' });
    }).then(function (card) {
      var s = html(card);
      H.ok('Extra Large: two lists side by side where the house has two', s.indexOf('class="c3" style="--hue:' + window.hkCards.ACCENTS.blue + '"') > 0 &&
           s.indexOf('Fix the gate') > 0 && s.indexOf('Coffee beans') > 0);
      H.ok('...and Add an Item', /data-add="todo.groceries"[^>]*>Add an Item</.test(s));
      return block('L', { entity: 'todo.groceries' });
    }).then(function (card) {
      H.ok('Large: the name and count in a column, the items beside', /<div class="c1"><div class="hd"[^>]*><div class="ln"[^>]*>Groceries<\/div><div class="cn">3<\/div><\/div><div class="ft"/.test(html(card)));
      // TICKED OFF: the Side Pane's command
      var cls = {}, el = { getAttribute: function (k) { return { 'data-list': 'todo.groceries', 'data-uid': 'g2' }[k]; },
                           hasAttribute: function (k) { return k === 'data-uid'; }, classList: { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; } } };
      t._root._listeners.click[t._root._listeners.click.length - 1]({ target: { closest: function () { return el; } } });
      var call = hs.calls[hs.calls.length - 1] || {};
      H.ok('a tap on an item ticks it off: todo.update_item, completed', call.domain === 'todo' && call.service === 'update_item' &&
           JSON.stringify(call.data).indexOf('"item":"g2"') >= 0 && JSON.stringify(call.data).indexOf('completed') >= 0, call);
      H.ok('...struck through at once, and until the list says so', cls.done === 1 && TODO['todo.groceries'].off.g2 === true);
      t.hass = hs.hass();
      t._hkSig = null; t._render();
      H.ok('...drawn so', /class="it done"[^>]*data-uid="g2"/.test(html(t)));
      // the list's count changes: read again, for every block that asked meanwhile
      hs.ws.length = 0;
      var h2 = hs.set('todo.groceries', '2');
      t.hass = h2;
      H.eq('the count changes: read again', hs.ws.length, 1);
      ITEMS['todo.groceries'] = ITEMS['todo.groceries'].filter(function (it) { return it.uid !== 'g2'; });
      var before = t.__renders;
      answer();
      return H.tick(8).then(function () {
        H.ok('...and drawn again when it lands', t.__renders > before && html(t).indexOf('Eggs') < 0 && html(t).indexOf('<div class="cn">2</div>') > 0);
      });
    }).then(function () {
      var none = H.house({}), card = H.make('hk-todo-card');
      card.setAttribute('size', 'T');
      card.setConfig({ type: 'custom:hk-todo-card' });
      card.hass = none.hass();
      H.ok('no lists: said so', html(card).indexOf('No to-do lists') > 0);
    });
  }
]);
