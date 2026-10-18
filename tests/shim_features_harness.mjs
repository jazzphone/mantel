// Run by tests/test_shim_features.py with node: the REAL shim -- hk-client.js (cjs copy), mantel-client.js
// (cjs copy), mantel-host.js and hub.js (mjs copies) -- next to this file, with only the browser globals
// stubbed. Drives the page side of Mantel's features and prints one JSON object of what was observed.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const sent = [];
const events = [];
globalThis.window = globalThis;
globalThis.addEventListener = (name, fn) => { if (name === 'hk-command-refused') globalThis.__refusedHook = fn; };
globalThis.dispatchEvent = (ev) => { events.push(ev.type); return true; };
globalThis.location = { origin: 'http://mantel.test', search: '', protocol: 'http:', host: 'mantel.test' };
globalThis.document = { querySelector: () => null };
globalThis.hkOverlays = { toast() {} };
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 1; FakeSocket.last = this; setTimeout(() => this.onopen && this.onopen(), 0); }
  send(text) { sent.push(JSON.parse(text)); }
}
globalThis.WebSocket = FakeSocket;

require('./hk-client.cjs');
require('./mantel-client.cjs');
const { Host, screenEntity, SCREEN_SETTLE_MS } = await import('./mantel-host.mjs');
const { Hub } = await import('./hub.mjs');

const hub = new Hub();
await hub.connect();
const ws = FakeSocket.last;
const reply = (m) => ws.onmessage({ data: JSON.stringify(m) });
globalThis.hkMantelClient.useCommands(hub);
const host = new Host({ hub, registry: { entities: {}, devices: {}, areas: {}, floors: {} }, fixtures: {}, user: {}, config: {}, themes: {} });
const out = { stages: {} };
const last = () => sent[sent.length - 1];
const tick = () => new Promise((r) => setTimeout(r, 0));

// -- the events feed: notifications reach the page; `screen` frames never do, they move the switches
const seen = [];
const evSub = host.connection.subscribeMessage((ev) => seen.push(ev), { type: 'hk_frontend/events/subscribe' });
const evFrame = last();
out.eventsSubscribe = evFrame;
// the server's initial frame for a tablet that is already black arrives before the answer
reply({ type: 'read_event', id: evFrame.id, event: { type: 'screen', tablet: 'hall', black: true, brightness: 150, dashboards: [], users: [] } });
reply({ type: 'read_result', id: evFrame.id, result: null });
const unsubEvents = await evSub;
await new Promise((r) => setTimeout(r, SCREEN_SETTLE_MS + 50));      // "off" is believed once the frames had their moment
reply({ type: 'read_event', id: evFrame.id, event: { type: 'notification', title: 'Basement Floor Wet', message: 'Water detected.' } });
reply({ type: 'read_event', id: evFrame.id, event: { type: 'popup', popup: 'doorbell' } });
out.delivered = seen;
const st = () => Object.fromEntries(Object.entries(host.hass.states).filter(([k]) => k.startsWith('switch.mantel_'))
  .map(([k, v]) => [k, { state: v.state, attributes: v.attributes }]));
out.stages.beforeSettings = st();

// -- the settings feed names the two switches (the server names none)
let settings = null;
const setSub = host.connection.subscribeMessage((p) => { settings = p; }, { type: 'hk_frontend/settings/subscribe' });
const setFrame = last();
reply({ type: 'read_result', id: setFrame.id, result: null });
await setSub;
reply({ type: 'read_event', id: setFrame.id, event: { configured: true, tablet_items: {
  hall: { name: 'Hall', user: 'hall', screensaver_switch: null, black_switch: null },
  den: { name: 'Den', user: '', screensaver_switch: 'switch.real_one', black_switch: null },
  'Bad Id': { name: 'x' } }, boards: {} } });
out.settings = settings;
out.stages.afterSettings = st();

// -- screen frames set the switches
reply({ type: 'read_event', id: evFrame.id, event: { type: 'screen', tablet: 'hall', photos: true, dashboards: [], users: [] } });
reply({ type: 'read_event', id: evFrame.id, event: { type: 'screen', tablet: 'hall', black: false, dashboards: [], users: [] } });
out.stages.afterFrames = st();
reply({ type: 'read_event', id: evFrame.id, event: { type: 'screen', tablet: 'nope_x', black: true } });
reply({ type: 'read_event', id: evFrame.id, event: { type: 'screen', tablet: 'Bad Id', black: true } });
out.stages.afterBadFrames = st();

const framesAfter = (n) => sent.slice(n);
async function run(label, commandsOn) {
  const n0 = sent.length;
  const client = host.client;
  const a = client.actions;
  const res = {};
  const answer = (type, result, error) => { const f = last(); reply(Object.assign({ type, id: f.id }, error ? { error } : { result })); };

  let p = a.callWS({ type: 'hk_frontend/screensaver/touch', tablet: 'hall' });
  res.touchFrame = last(); answer('screen_result', { changed: false }); res.touch = await p;
  p = a.callWS({ type: 'hk_frontend/screensaver/touch', tablet: 'hall', saver: true });
  res.saverFrame = last(); answer('screen_result', { changed: false }); await p;
  p = a.callWS({ type: 'hk_frontend/screensaver/black', tablet: 'hall', black: true });
  res.blackFrame = last(); answer('screen_result', { changed: true }); await p;
  res.afterBlackTrue = st()['switch.mantel_hall_black_screen'].state;
  p = a.callWS({ type: 'hk_frontend/screensaver/black', tablet: 'hall', black: false });
  res.wakeFrame = last(); answer('screen_result', { changed: true }); await p;
  res.afterWake = st()['switch.mantel_hall_black_screen'].state;
  // refused by the server: the page's promise rejects with its code, nothing else happens
  p = a.callWS({ type: 'hk_frontend/screensaver/touch', tablet: 'hall' });
  answer('screen_result', null, { code: 'forbidden' });
  try { await p; res.forbidden = 'NOT REJECTED'; } catch (e) { res.forbidden = e.code; }
  // no tablet (the legacy dashboard form) or a malformed one: refused here, nothing sent
  const m = sent.length;
  for (const bad of [{ type: 'hk_frontend/screensaver/touch', dashboard: 'home' }, { type: 'hk_frontend/screensaver/black', tablet: 'hall', black: 'yes' }]) {
    try { await a.callWS(bad); res.badSent = 'NOT REJECTED'; } catch (e) { (res.bad = res.bad || []).push(e.code); }
  }
  res.badFrames = sent.length - m;

  // Mute 1 Hour
  p = a.callWS({ type: 'hk_notify/mute', key: 'item1:binary_sensor.wet', minutes: 60 });
  res.muteFrame = last(); answer('notify_mute_result', { until: 1234 }); res.mute = await p;
  p = a.callWS({ type: 'hk_notify/mute', key: 'item1:binary_sensor.wet', minutes: 0 });
  res.unmuteFrame = last(); answer('notify_mute_result', { until: null }); await p;
  try { await a.callWS({ type: 'hk_notify/mute', key: 'k', minutes: 5000 }); } catch (e) { res.muteBad = e.code; }

  // the photo screensaver's own switch: local only
  const k = sent.length;
  await a.callService('switch', 'turn_on', { entity_id: screenEntity('hall', 'photos') }, undefined, false);
  res.photosOn = st()[screenEntity('hall', 'photos')].state;
  await a.callService('switch', 'turn_off', { entity_id: screenEntity('hall', 'photos') });
  res.photosOff = st()[screenEntity('hall', 'photos')].state;
  res.photoFrames = sent.length - k;

  // anything else: the gateway when commands are on, refused with nothing sent when off
  const refusedBefore = events.filter((e) => e === 'hk-command-refused').length;
  const j = sent.length;
  let svc;
  try {
    const q = a.callService('light', 'turn_on', { entity_id: 'light.x' });
    if (commandsOn) { res.serviceFrame = last(); answer('command_result', []); }
    await q; svc = 'ok';
  } catch (e) { svc = e.code; }
  res.service = svc;
  res.serviceSent = sent.length - j;
  res.refusedEvents = events.filter((e) => e === 'hk-command-refused').length - refusedBefore;
  // a real switch of the house is not Mantel's
  const r = sent.length;
  try { const q = a.callService('switch', 'turn_on', { entity_id: 'switch.real_one' }); if (commandsOn) { res.realFrame = last(); answer('command_result', []); } await q; res.real = 'ok'; } catch (e) { res.real = e.code; }
  res.realSent = sent.length - r;
  // an unrelated write still goes the way it did
  const w = sent.length;
  try { const q = a.callWS({ type: 'hk_frontend/hidden/set' }); if (commandsOn) { res.hiddenFrame = last(); answer('command_result', []); } await q; res.hidden = 'ok'; } catch (e) { res.hidden = e.code; }
  res.hiddenSent = sent.length - w;
  // Live TV's viewer heartbeat: quiet with commands off (nothing sent, nothing said), the gateway's with them on
  const tvRefused = events.filter((e) => e === 'hk-command-refused').length;
  const tv0 = sent.length;
  try {
    const q = a.callWS({ type: 'hk_tv/watching', channel: '4.1' });
    if (commandsOn) { res.tvFrame = last(); answer('command_result', { viewers: ['x'] }); }
    res.tv = await q;
  } catch (e) { res.tv = e.code; }
  res.tvSent = sent.length - tv0;
  res.tvRefusedEvents = events.filter((e) => e === 'hk-command-refused').length - tvRefused;
  // the Music page in use: Mantel's music host's `music_used`, on every server, never a command
  const usedRefused = events.filter((e) => e === 'hk-command-refused').length;
  const u0 = sent.length;
  const uq = a.callWS({ type: 'hk_music/used' });
  res.usedFrame = last();
  reply({ type: 'music_used_result', id: res.usedFrame.id, result: null });
  res.used = await uq;
  res.usedSent = sent.length - u0;
  res.usedRefusedEvents = events.filter((e) => e === 'hk-command-refused').length - usedRefused;
  res.settingsSave = (() => { const q = a.callWS({ type: 'hk_frontend/board/set', board: {} }); const f = last(); reply({ type: 'settings_result', id: f.id, result: { ok: true } }); return f.type; })();
  out[label] = res;
}

await run('off', false);
reply({ type: 'capabilities', commands: true, step_up_window: 300, door: 'lan' });
host.applyDiff({ changes: {} });          // a new snapshot: a new client made with the gateway on
await run('on', true);

unsubEvents();
out.unsubscribed = last();
out.kinds = [...new Set(sent.map((m) => m.type))].sort();
out.sent = sent;
console.log(JSON.stringify(out));
process.exit(0);
