// Run by tests/test_shim_reads.py with node: Mantel's host adapter (web/shim/mantel-host.js) and hub
// client (web/shim/hub.js), copied as .mjs next to this file, with the browser globals stubbed.
// Prints one JSON object of what was observed.
const sent = [];
globalThis.window = globalThis;
const heard = {};
globalThis.addEventListener = (type, fn) => { heard[type] = fn; };
globalThis.dispatchEvent = () => true;
globalThis.location = { origin: 'http://mantel.test', search: '', protocol: 'http:', host: 'mantel.test' };
globalThis.document = { querySelector: () => null };
globalThis.hkMantelClient = { setCurrent() {} };
globalThis.hkHostClient = globalThis.hkMantelClient;
globalThis.hkOverlays = { toast() {} };
globalThis.queueMicrotask = globalThis.queueMicrotask || ((f) => Promise.resolve().then(f));
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 1; FakeSocket.last = this; setTimeout(() => this.onopen && this.onopen(), 0); }
  send(text) { sent.push(JSON.parse(text)); }
}
globalThis.WebSocket = FakeSocket;

const { Host, calendarPath, historyRequest, artPath, artBucket } = await import('./mantel-host.mjs');
const { Hub } = await import('./hub.mjs');

const hub = new Hub();
await hub.connect();
const ws = FakeSocket.last;
const reply = (m) => ws.onmessage({ data: JSON.stringify(m) });
const host = new Host({ hub, registry: { entities: {}, devices: {}, areas: {}, floors: {} }, fixtures: {}, user: {}, config: {}, themes: {} });
const out = { refused: [], results: {} };

// camera live view: client config and candidate as reads, the offer as a read subscription
const cfg = host.hass.callWS({ type: 'camera/webrtc/get_client_config', entity_id: 'camera.porch' });
reply({ type: 'read_result', id: sent[sent.length - 1].id, result: { configuration: { iceServers: [] } } });
out.results.config = await cfg;
const cand = host.hass.callWS({ type: 'camera/webrtc/candidate', entity_id: 'camera.porch', session_id: 's1', candidate: { candidate: 'c' } });
reply({ type: 'read_result', id: sent[sent.length - 1].id, result: null });
out.results.candidate = await cand;
const events = [];
const sub = host.connection.subscribeMessage((ev) => events.push(ev), { type: 'camera/webrtc/offer', entity_id: 'camera.porch', offer: 'v=0' });
const subId = sent[sent.length - 1].id;
reply({ type: 'read_result', id: subId, result: null });
const unsub = await sub;
reply({ type: 'read_event', id: subId, event: { type: 'session', session_id: 's1' } });
reply({ type: 'read_event', id: subId, event: { type: 'answer', answer: 'v=0 a' } });
out.events = events;
unsub();

// calendars: the one REST read
const cal = host.hass.callApi('GET', 'calendars/calendar.family?start=2026-10-18T00:00:00&end=2026-10-19T00:00:00');
reply({ type: 'read_result', id: sent[sent.length - 1].id, result: [{ summary: 'Fictional event' }] });
out.results.calendar = await cal;

// history: a detail sheet's Hour/Day chart asks HA's REST history; Mantel asks the WebSocket read and
// gives the REST shape back
const start = new Date(Date.UTC(2026, 9, 18, 12)).toISOString();
const hist = host.hass.callApi('GET', 'history/period/' + encodeURIComponent(start) +
  '?filter_entity_id=' + encodeURIComponent('sensor.office_watts') + '&minimal_response&no_attributes');
await Promise.resolve();
out.historySent = sent[sent.length - 1].msg;
reply({ type: 'read_result', id: sent[sent.length - 1].id,
        result: { 'sensor.office_watts': [{ s: '300', lu: 1792360000 }, { s: '350.5', lu: 1792360060, lc: 1792360060 }] } });
out.results.history = await hist;
out.historyParse = [historyRequest('GET', 'history/period/' + encodeURIComponent(start) + '?filter_entity_id=a.b,c.d&end_time=' + encodeURIComponent(start)),
                    historyRequest('GET', 'history/period/not-a-time?filter_entity_id=a.b'),
                    historyRequest('GET', 'history/period/' + encodeURIComponent(start) + '?filter_entity_id=Bad Id'),
                    historyRequest('GET', 'history/period/' + encodeURIComponent(start) + '?filter_entity_id=a.b&other=1'),
                    historyRequest('POST', 'history/period/' + encodeURIComponent(start) + '?filter_entity_id=a.b')];

// now-playing artwork signing: answered on the page with Mantel's own art route and the size bucket (no refusal,
// nothing sent): the server fetches and scales the cover
const sentBeforeArt = sent.length, refusedBeforeArt = host.refused.length;
globalThis.__mantelBase = '/api/hassio_ingress/Fict1onal';
out.results.artSign = await host.hass.callWS({ type: 'hk_frontend/art/sign',
  urls: ['https://example.test/a.jpg?x=é&y=1', 'http://192.0.2.53:8095/imageproxy/ab', '/api/media/x/art', 'file:///etc/passwd', 42], size: 250 });
out.artBuckets = [artBucket(1), artBucket(150), artBucket(151), artBucket(300), artBucket(999), artBucket(5000), artBucket(0), artBucket('x'), artBucket(null)];
out.artBare = artPath('https://example.test/a.jpg', 300);
delete globalThis.__mantelBase;
out.artSent = sent.length - sentBeforeArt;
out.artRefused = host.refused.length - refusedBeforeArt;

// music (interim): the queue is a read; queue_play stays refused below
const q = host.hass.callWS({ type: 'hk_music/queue', entity_id: 'media_player.kitchen', limit: 40 });
reply({ type: 'read_result', id: sent[sent.length - 1].id, result: { ok: true, index: 0, items: [] } });
out.results.queue = await q;

// the screensaver's photo: a read; Mantel's photo route gets the page's prefix, anything else is refused
globalThis.__mantelBase = '/api/hassio_ingress/Fict1onal';
const ph = host.hass.callWS({ type: 'media_source/resolve_media', media_content_id: 'media-source://media_source/local/p/a.jpg' });
reply({ type: 'read_result', id: sent[sent.length - 1].id, result: { url: '/api/photo/' + '0123456789abcdef'.repeat(2), mime_type: 'image/jpeg' } });
out.results.photo = await ph;
const bad = host.hass.callWS({ type: 'media_source/resolve_media', media_content_id: 'media-source://media_source/local/p/b.jpg' });
reply({ type: 'read_result', id: sent[sent.length - 1].id, result: { url: '/media/local/p/b.jpg?authSig=x', mime_type: 'image/jpeg' } });
try { await bad; out.results.photoBad = 'NOT REFUSED'; } catch (e) { out.results.photoBad = e.code; }
globalThis.__mantelBase = '';

// still refused, sending nothing: other REST calls, writes, other webrtc-looking writes
const before = sent.length;
for (const p of [host.hass.callApi('GET', 'history/period/x'), host.hass.callApi('POST', 'calendars/calendar.family?start=a&end=b'),
                 host.hass.callWS({ type: 'hk_frontend/settings/set' }),
                 host.hass.callWS({ type: 'hk_music/queue_play', entity_id: 'media_player.kitchen', item_id: 'x' })]) {
  try { await p; out.refused.push('NOT REFUSED'); } catch (e) { out.refused.push(e.code); }
}
out.sentAfterRefusals = sent.length - before;
out.calendarPath = [calendarPath('GET', '/api/calendars/calendar.x?start=a&end=b'), calendarPath('GET', 'calendars/calendar.x/../y?a'),
                    calendarPath('GET', 'states'), calendarPath('PUT', 'calendars/calendar.x?start=a')];
// self-healing narrowing: a read of an id the (narrowed) states lack is reported once per read, never while
// recording, never for a present id or a non-entity key
const misses = [];
host.onMiss = (id) => misses.push(id);
host.applySnapshot({ 'light.kitchen': { s: 'on', a: {}, lc: 1, lu: 1 } });
const st = host.hass.states;
void st['light.kitchen']; void st['vacuum.downstairs']; void st['toJSON'];
host.recording = true; void st['vacuum.upstairs']; host.recording = false;
host.building = true; void st['vacuum.garage']; host.building = false;     // a whole-house pass: no screen's need
out.misses = misses;

// UPDATES BATCHED PER FRAME (2026-10-29): the hub's diffs wait for the next animation frame and are applied together,
// in order, in one publish; a hidden page (no frames) is served by a timer; a snapshot drops what waits.
{
  const frames = []; let published = 0;
  globalThis.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
  const timers = [];
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  globalThis.setTimeout = (f, ms) => { timers.push({ f, ms, live: true }); return timers.length; };
  globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].live = false; };
  host.listeners = [() => { published++; }];
  const ids = () => host.hass.states['light.kitchen'];
  host.applySnapshot({ 'light.kitchen': { s: 'on', a: { n: 1 }, lc: 1, lu: 1 }, 'sensor.w': { s: '1', a: {}, lc: 1, lu: 1 } });
  const b = { published: published };
  host.applyDiff({ changes: { 'sensor.w': { '+': { s: '2' } } } });
  host.applyDiff({ changes: { 'sensor.w': { '+': { s: '3' } }, 'light.kitchen': { '+': { s: 'off', a: { n: 2 } } } } });
  host.applyDiff({ added: { 'sensor.new': { s: '9', a: {}, lc: 1, lu: 1 } }, removed: ['sensor.gone'], changes: {} });
  b.beforeFrame = { published: published - b.published, w: host.hass.states['sensor.w'].state, frames: frames.length, timers: timers.filter((t) => t.live).length };
  frames.shift()();
  b.afterFrame = { published: published - b.published, w: host.hass.states['sensor.w'].state, light: ids().state, n: ids().attributes.n,
                   added: !!host.hass.states['sensor.new'], timers: timers.filter((t) => t.live).length };
  frames.splice(0).forEach((f) => f());                                  // (a frame that was already asked for, late: nothing)
  b.late = published - b.published;
  // a hidden page: the frame never comes, the timer does
  host.applyDiff({ changes: { 'sensor.w': { '+': { s: '4' } } } });
  const t = timers.filter((x) => x.live);
  b.hidden = { timer: t.length === 1 && t[0].ms, still: host.hass.states['sensor.w'].state };
  t[0].f();
  b.hiddenAfter = host.hass.states['sensor.w'].state;
  frames.splice(0).forEach((f) => f());                                  // the frame, once the page shows again: nothing more
  b.hiddenPublished = published - b.published;
  // a snapshot is newer than any diff waiting: the diff does not undo it
  host.applyDiff({ changes: { 'sensor.w': { '+': { s: 'old' } } } });
  host.applySnapshot({ 'sensor.w': { s: 'fresh', a: {}, lc: 2, lu: 2 } });
  frames.splice(0).forEach((f) => f()); timers.filter((x) => x.live).forEach((x) => x.f());
  b.snapshot = host.hass.states['sensor.w'].state;
  // flushDiffs() applies what waits now
  host.applyDiff({ changes: { 'sensor.w': { '+': { s: 'now' } } } });
  host.flushDiffs();
  b.flushed = host.hass.states['sensor.w'].state;
  // NOT UNDER A FINGER (2026-11-14): while a finger is down or a page swipe moves, what came waits -- looked at again
  // by a timer, never longer than HOLD_MS from the first of it
  {
    const h = {}, live = () => timers.filter((x) => x.live), realNow = Date.now;
    let now = 1000000; Date.now = () => now;
    const pub = () => published - b.published;
    heard.pointerdown();
    const p0 = pub();
    host.applyDiff({ changes: { 'sensor.w': { '+': { s: 'held' } } } });
    frames.splice(0).forEach((f) => f());
    h.down = { published: pub() - p0, w: host.hass.states['sensor.w'].state, timer: live().length === 1 && live()[0].ms };
    now += 80; live()[0].f();                                            // still down: it waits on
    h.still = { published: pub() - p0, timers: live().length };
    heard.pointerup();
    now += 80; live()[0].f();                                            // lifted: applied by the timer's next look
    h.up = { published: pub() - p0, w: host.hass.states['sensor.w'].state, timers: live().length };
    // a page on its way home (hk-pageswipe.js moving()) holds it too...
    globalThis.hkPageSwipe = { moving: () => true };
    const p1 = pub();
    host.applyDiff({ changes: { 'sensor.w': { '+': { s: 'moving' } } } });
    frames.splice(0).forEach((f) => f());
    h.moving = { published: pub() - p1, w: host.hass.states['sensor.w'].state };
    // ...but never past HOLD_MS from the first of what waits
    now += 1300; live()[0].f();
    h.capped = { published: pub() - p1, w: host.hass.states['sensor.w'].state, timers: live().length };
    delete globalThis.hkPageSwipe;
    // a finger whose lift never came stops counting
    heard.pointerdown(); now += 5000;
    const p2 = pub();
    host.applyDiff({ changes: { 'sensor.w': { '+': { s: 'lost' } } } });
    frames.splice(0).forEach((f) => f());
    h.lost = { published: pub() - p2, w: host.hass.states['sensor.w'].state };
    Date.now = realNow;
    b.hold = h;
  }
  host.listeners = null;
  globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; delete globalThis.requestAnimationFrame;
  out.batch = b;
}
// A WALK OF THE WHOLE HOUSE IS NOT KEPT (2026-11-14): more ids than half the house (1,000 at least) read for the first
// time in one go are no screen's need -- not recorded, not seen, and the misses given back (onScan)
{
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const house = {}; for (let i = 0; i < 3000; i++) house['sensor.s' + i] = { s: String(i), a: {}, lc: 1, lu: 1 };
  const w = {}; const warned = []; const realWarn = console.warn; console.warn = (...a) => warned.push(String(a[0]));
  host.applySnapshot(house);
  host.seen.clear(); host.reads.clear();
  let s2 = host.hass.states;
  for (let i = 0; i < 1400; i++) void s2['sensor.s' + i];              // a big page, under half the house: seen
  w.page = host.seen.size;
  await tick();
  for (let i = 0; i < 3000; i++) void s2['sensor.s' + i];              // a walk: what it read first is not kept
  w.walk = host.seen.size; w.warned = warned.length;
  await tick();
  void s2['sensor.s2999'];                                             // ...and a read of one of them afterwards is
  w.after = host.seen.has('sensor.s2999');
  host.recording = true; host.reads.clear();
  for (let i = 0; i < 3000; i++) void s2['sensor.s' + i];              // the same while a pass is recorded
  w.recorded = host.reads.size; host.recording = false;
  await tick();
  // narrowed: the walk's misses are given back
  const few = { 'sensor.s0': house['sensor.s0'] };
  host.applySnapshot(few);
  const asked = [], back = [];
  host.onMiss = (id) => asked.push(id); host.onScan = (ids) => back.push(...ids);
  s2 = host.hass.states;
  void s2['sensor.s5']; void s2['sensor.s6'];
  await tick();
  w.misses = asked.length;
  for (let i = 0; i < 3000; i++) void s2['sensor.s' + i];
  w.walkAsked = asked.length - w.misses; w.walkBack = back.length; w.same = back.every((id) => asked.includes(id));
  await tick();
  host.building = true; for (let i = 0; i < 3000; i++) void s2['sensor.s' + i]; host.building = false;   // (said on purpose: nothing)
  w.unrecorded = asked.length - w.misses - w.walkAsked;
  w.warnedOnce = warned.length;
  console.warn = realWarn; host.onScan = null;
  out.walk = w;
}
// A CARD IS TOLD ONLY WHEN SOMETHING IT READ HAS CHANGED (2026-11-14): the host takes down what a card reads while it
// works (track), numbers every publish, and says whether anything in a card's reads has changed since the snapshot
// it was told with (quiet); what is read outside any card is remembered by when (ambientIds)
{
  const g = {}, realNow = Date.now; let now = realNow() + 100; Date.now = () => now;       // (on from the real clock: the host has used it)
  host.onMiss = null;
  host.applySnapshot({ 'light.a': { s: 'on', a: {}, lc: 1, lu: 1 }, 'sensor.p': { s: '1', a: {}, lc: 1, lu: 1 }, 'sensor.q': { s: '1', a: {}, lc: 1, lu: 1 } });
  const card = new Set(), grid = new Set();
  host.track(grid, () => host.track(card, () => { void host.hass.states['light.a']; void host.hass.states['light.none']; }));
  g.reads = [[...card].sort(), [...grid].sort()];                       // the card's, and the grid's around it
  void host.hass.states['sensor.q'];                                    // read by no card
  const r0 = host.revOf(host.hass);
  g.same = host.quiet(card, r0);
  host.applyDiff({ changes: { 'sensor.p': { '+': { s: '2' } } } }); host.flushDiffs();
  g.other = host.quiet(card, r0);                                       // another's state: nothing to show
  host.applyDiff({ changes: { 'light.a': { '+': { s: 'off' } } } }); host.flushDiffs();
  g.own = host.quiet(card, r0);                                         // its own: told
  const r1 = host.revOf(host.hass);
  g.told = host.quiet(card, r1);
  host.applyDiff({ changes: { 'sensor.p': { '+': { s: '3' } } } }); host.flushDiffs();
  host.applyDiff({ changes: { 'sensor.p': { '+': { s: '4' } } } }); host.flushDiffs();
  g.later = host.quiet(card, r1);                                       // two publishes on, still nothing of its own
  host.recording = true; g.recording = host.quiet(card, r1); host.recording = false;     // a narrowing pass: every card looks
  host.applyDiff({ added: { 'light.none': { s: 'on', a: {}, lc: 1, lu: 1 } }, changes: {} }); host.flushDiffs();
  g.added = host.quiet(card, r1);                                       // a state come: every card looks again
  const r2 = host.revOf(host.hass);
  now += 16000;
  host.applyDiff({ changes: { 'sensor.p': { '+': { s: '5' } } } }); host.flushDiffs();
  g.sweep = host.quiet(card, r2);                                       // fifteen seconds since everyone looked: again
  const r3 = host.revOf(host.hass);
  host.applyRegistry({ entities: {}, devices: {}, areas: {}, floors: {} });
  g.registry = host.quiet(card, r3);                                    // a registry: anything may have changed
  // the same states again (a subscription changed): only what differs
  const r4 = host.revOf(host.hass);
  const again = { 'light.a': { s: 'off', a: {}, lc: 1, lu: 1 }, 'sensor.q': { s: '1', a: {}, lc: 1, lu: 1 },
                  'light.none': { s: 'on', a: {}, lc: 1, lu: 1 }, 'sensor.p': { s: '9', a: {}, lc: 1, lu: 99 } };
  host.applySnapshot(again);
  g.resnap = [host.quiet(card, r4), host.quiet(new Set(['sensor.p']), r4)];
  delete again['sensor.q']; host.applySnapshot(again);
  g.resnapGone = host.quiet(card, host.revOf(host.hass) - 1);           // a state gone with it: every card looks
  // what no card read, and when
  g.ambient = host.ambientIds().includes('sensor.q') && !host.ambientIds().includes('light.a');
  for (let i = 0; i < 25; i++) { now += 61000; host.applyDiff({ changes: { 'sensor.p': { '+': { s: 'x' + i } } } }); host.flushDiffs(); }
  g.ambientGone = !host.ambientIds().includes('sensor.q');              // 25 publishes and 25 minutes on: let go
  Date.now = realNow;
  out.gate = g;
}
out.sent = sent;
console.log(JSON.stringify(out));
process.exit(0);
