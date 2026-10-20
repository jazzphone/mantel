// Run by tests/test_shim_features.py with node: the REAL shim -- hk-client.js (cjs copy), mantel-client.js
// (cjs copy), mantel-host.js and hub.js (mjs copies) -- next to this file, with only the browser globals
// stubbed. Drives the page side of Mantel's features and prints one JSON object of what was observed.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const sent = [];
const SID = '0123456789abcdef0123456789abcdef';      // a snapshot id (notify_snaps: 32 hex)
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
  res.photoReports = sent.slice(k);
  // ... and with the server refusing it, the page's own switch stays as HK set it
  const k2 = sent.length;
  await a.callService('switch', 'turn_on', { entity_id: screenEntity('hall', 'photos') });
  reply({ type: 'screen_result', id: last().id, error: { code: 'forbidden' } });
  await tick();
  res.photosAfterRefusal = st()[screenEntity('hall', 'photos')].state;
  await a.callService('switch', 'turn_off', { entity_id: screenEntity('hall', 'photos') });
  reply({ type: 'screen_result', id: last().id, result: { changed: true } });
  res.photoReports2 = sent.length - k2;
  // the black switch is the page's too, but its report is screensaver/black's: no photos report
  const k3 = sent.length;
  await a.callService('switch', 'turn_on', { entity_id: screenEntity('hall', 'black') });
  res.blackSwitchFrames = sent.length - k3;
  await a.callService('switch', 'turn_off', { entity_id: screenEntity('hall', 'black') });

  // All Tablets' "Restart all now": Mantel's tablets_restart, answered as HA answers
  p = a.callWS({ type: 'hk_frontend/tablet/act', tablet: '*', act: 'restart_all' });
  res.restartFrame = last(); answer('tablets_restart_result', { restarted: ['hall'], presses: [] }); res.restart = await p;
  // any other tablet act is not Mantel's: the gateway with commands on, refused with them off
  const ta = sent.length;
  try {
    const q = a.callWS({ type: 'hk_frontend/tablet/act', tablet: 'hall', act: 'wake' });
    if (commandsOn) { res.wakeActFrame = last(); answer('command_result', { ok: true }); }
    await q; res.wakeAct = 'ok';
  } catch (e) { res.wakeAct = e.code; }
  res.wakeActSent = sent.length - ta;

  // HK Settings -> Features: Mantel's feature saves go to the store, like HK's own settings saves
  p = a.callWS({ type: 'hk_notify/settings/set', changes: { stay: 60 } });
  res.featureSave = last(); reply({ type: 'settings_result', id: last().id, result: { configured: true } }); res.featureSaved = await p;
  p = a.callWS({ type: 'hk_energy/device/section', key: 'k', section: 's' });
  res.energySave = last(); reply({ type: 'settings_result', id: last().id, error: { code: 'forbidden', message: 'no' } });
  try { await p; res.energyRefused = 'NOT REJECTED'; } catch (e) { res.energyRefused = e.code; }
  // Music's and Alarm PIN's settings are Mantel's too now: settings writes, commands on or off
  p = a.callWS({ type: 'hk_music/settings/set', changes: {} });
  res.musicFrame = last(); reply({ type: 'settings_result', id: last().id, result: { configured: true } }); res.music = await p;
  p = a.callWS({ type: 'hk_alarm_pin/remove', entry_id: 'alarm_control_panel.x' });
  res.alarmFrame = last(); reply({ type: 'settings_result', id: last().id, result: { configured: true } }); res.alarm = await p;

  // notification snapshots: HK's sign read, answered with Mantel's route under the page's prefix
  globalThis.__mantelBase = '/api/hassio_ingress/tok';
  p = client.callWS({ type: 'hk_notify/snap/sign', snaps: [SID] });
  res.signFrame = last();
  reply({ type: 'read_result', id: last().id, result: { signed: { [SID]: '/api/notify/snap/' + SID, evil: 'https://elsewhere/x', odd: '/api/notify/snap/../x' } } });
  res.signed = await p;
  globalThis.__mantelBase = '';

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
  // Hidden Accessories is a settings write now (Mantel's store)
  p = a.callWS({ type: 'hk_frontend/hidden/set', entity_ids: ['light.x'], everywhere: true });
  res.hiddenFrame = last(); reply({ type: 'settings_result', id: last().id, result: { can: {} } }); res.hidden = await p;
  // an unrelated write still goes the way it did
  const w = sent.length;
  try { const q = a.callWS({ type: 'hk_frontend/tablet/add', name: 'x' }); if (commandsOn) { res.otherFrame = last(); answer('command_result', []); } await q; res.other = 'ok'; } catch (e) { res.other = e.code; }
  res.otherSent = sent.length - w;
  // Live TV's viewer heartbeat: always Mantel's `tv_watching` (counted there, never a command). Where Mantel
  // serves Live TV (ha: false) that is all; where HA's Live TV is the interim (ha: true) it ALSO goes to HA
  // through the gateway, only with commands on.
  const tvRefused = events.filter((e) => e === 'hk-command-refused').length;
  const tv0 = sent.length;
  try {
    const q = a.callWS({ type: 'hk_tv/watching', channel: '4.1' });
    res.tvFrame = last(); answer('tv_watching_result', { viewers: ['Kitchen'], ha: false });
    res.tv = await q;
  } catch (e) { res.tv = e.code; }
  res.tvSent = sent.length - tv0;
  const tv1 = sent.length;
  try {
    const q = a.callWS({ type: 'hk_tv/watching', channel: '4.1' });
    res.tvInterimFrame = last(); answer('tv_watching_result', { viewers: ['Kitchen'], ha: true });
    await tick();
    if (commandsOn) { res.tvForward = last(); answer('command_result', { viewers: ['x'] }); }
    res.tvInterim = await q;
  } catch (e) { res.tvInterim = e.code; }
  res.tvInterimSent = sent.length - tv1;
  const tv2 = sent.length;
  let pq = a.callWS({ type: 'hk_tv/watching', channel: null });
  res.tvStopFrame = last(); answer('tv_watching_result', { viewers: [], ha: false }); await pq;
  try { await a.callWS({ type: 'hk_tv/watching', channel: '../x' }); res.tvBad = 'NOT REJECTED'; } catch (e) { res.tvBad = e.code; }
  pq = a.callWS({ type: 'hk_tv/watching', channel: '4.1' });
  answer('tv_watching_result', null, { code: 'forbidden' });
  try { await pq; res.tvForbidden = 'NOT REJECTED'; } catch (e) { res.tvForbidden = e.code; }
  res.tvLaterSent = sent.length - tv2;
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
  // HK's per-person user data (the Music page's speaker): Mantel's `user_data_set`, never a command, commands on or off;
  // any other key is still an ordinary write
  const ud0 = sent.length, udRefused = events.filter((e) => e === 'hk-command-refused').length;
  const udq = a.callWS({ type: 'frontend/set_user_data', key: 'hk_music_focus', value: { key: 'media_player.office', at: 7 } });
  res.userDataFrame = last();
  reply({ type: 'user_data_set_result', id: res.userDataFrame.id, result: null });
  res.userData = await udq;
  res.userDataSent = sent.length - ud0;
  res.userDataRefusedEvents = events.filter((e) => e === 'hk-command-refused').length - udRefused;
  try { const q = a.callWS({ type: 'frontend/set_user_data', key: 'sidebar', value: {} }); if (commandsOn) { res.userDataOtherFrame = last(); answer('command_result', null); } await q; res.userDataOther = 'ok'; } catch (e) { res.userDataOther = e.code; }
  // the subscription is Mantel's read route (value first, then changes); another key stays the stand-in
  const udSeen = [];
  host.connection.subscribeMessage((ev) => udSeen.push(ev), { type: 'frontend/subscribe_user_data', key: 'hk_music_focus' });
  res.userDataSub = last();
  reply({ type: 'read_result', id: res.userDataSub.id, result: null });
  reply({ type: 'read_event', id: res.userDataSub.id, event: { value: null } });
  reply({ type: 'read_event', id: res.userDataSub.id, event: { value: { key: 'media_player.den', at: 9 } } });
  await tick();
  res.userDataSeen = udSeen;
  const otherSeen = [], before = sent.length;
  host.connection.subscribeMessage((ev) => otherSeen.push(ev), { type: 'frontend/subscribe_user_data', key: 'sidebar' });
  await tick();
  res.userDataOtherSeen = otherSeen; res.userDataOtherSent = sent.length - before;
  // Browse's library (music_assistant.get_library with a response): Mantel's read `music_assistant/get_library`, never a
  // command, commands on or off; a picture on the /ma proxy gets the page's prefix; anything else stays a command
  globalThis.__mantelBase = '/ing';
  const lb0 = sent.length, lbRefused = events.filter((e) => e === 'hk-command-refused').length;
  const lq = a.callWS({ type: 'call_service', domain: 'music_assistant', service: 'get_library', return_response: true,
                        service_data: { config_entry_id: 'e1', media_type: 'album', order_by: 'last_played_desc', limit: 12 } });
  res.libFrame = last();
  reply({ type: 'read_result', id: res.libFrame.id, result: { items: [
    { media_type: 'album', uri: 'library://album/1', name: 'A', version: '', image: '/ma/imageproxy?path=a&provider=p&size=256',
      artists: [{ media_type: 'artist', uri: 'library://artist/2', name: 'B', version: '', image: null }] },
    { media_type: 'album', uri: 'library://album/2', name: 'C', version: '', image: 'https://img.example/c.jpg' },
    { media_type: 'album', uri: 'library://album/3', name: 'D', version: '', image: '/ma/imageproxy/' + 'ab'.repeat(32) + '?size=256' }] } });
  res.lib = await lq;
  res.libSent = sent.length - lb0;
  res.libRefusedEvents = events.filter((e) => e === 'hk-command-refused').length - lbRefused;
  // Mantel without Music Assistant: the call goes the old way (the gateway, or refused with commands off)
  const lf0 = sent.length;
  const fq = a.callWS({ type: 'call_service', domain: 'music_assistant', service: 'get_library', return_response: true,
                        service_data: { media_type: 'track' } });
  fq.catch(() => {});
  reply({ type: 'read_result', id: last().id, error: { code: 'ma_not_configured', message: 'no' } });
  await tick();
  if (commandsOn) { res.libFallbackFrame = last(); answer('command_result', { response: { items: [] } }); }
  try { res.libFallback = await fq; } catch (e) { res.libFallback = e.code; }
  res.libFallbackSent = sent.length - lf0;
  // another error is the page's own; another service, or any extra key, is not the read
  const le0 = sent.length;
  const eq = a.callWS({ type: 'call_service', domain: 'music_assistant', service: 'get_library', return_response: true, service_data: {} });
  reply({ type: 'read_result', id: last().id, error: { code: 'forbidden', message: 'no' } });
  try { await eq; res.libError = 'NOT REJECTED'; } catch (e) { res.libError = e.code; }
  res.libErrorSent = sent.length - le0;
  const lo0 = sent.length;
  for (const bad of [{ type: 'call_service', domain: 'music_assistant', service: 'play_media', return_response: true, service_data: {} },
                     { type: 'call_service', domain: 'music_assistant', service: 'get_library', service_data: { media_type: 'album' } },
                     { type: 'call_service', domain: 'music_assistant', service: 'get_library', return_response: true, target: { entity_id: 'x.y' }, service_data: {} }]) {
    try { const q = a.callWS(bad); if (commandsOn) { (res.libOtherFrames = res.libOtherFrames || []).push(last().type); answer('command_result', null); } await q; (res.libOther = res.libOther || []).push('ok'); }
    catch (e) { (res.libOther = res.libOther || []).push(e.code); }
  }
  res.libOtherSent = sent.length - lo0;
  globalThis.__mantelBase = '';
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
