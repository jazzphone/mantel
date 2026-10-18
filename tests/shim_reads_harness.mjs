// Run by tests/test_shim_reads.py with node: Mantel's host adapter (web/shim/mantel-host.js) and hub
// client (web/shim/hub.js), copied as .mjs next to this file, with the browser globals stubbed.
// Prints one JSON object of what was observed.
const sent = [];
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
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

const { Host, calendarPath } = await import('./mantel-host.mjs');
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

// still refused, sending nothing: other REST calls, writes, other webrtc-looking writes
const before = sent.length;
for (const p of [host.hass.callApi('GET', 'history/period/x'), host.hass.callApi('POST', 'calendars/calendar.family?start=a&end=b'),
                 host.hass.callWS({ type: 'hk_frontend/settings/set' })]) {
  try { await p; out.refused.push('NOT REFUSED'); } catch (e) { out.refused.push(e.code); }
}
out.sentAfterRefusals = sent.length - before;
out.calendarPath = [calendarPath('GET', '/api/calendars/calendar.x?start=a&end=b'), calendarPath('GET', 'calendars/calendar.x/../y?a'),
                    calendarPath('GET', 'states'), calendarPath('PUT', 'calendars/calendar.x?start=a')];
out.sent = sent;
console.log(JSON.stringify(out));
process.exit(0);
