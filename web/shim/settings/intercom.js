// @ts-check
// settings/intercom.js -- Mantel Settings, Intercom (docs/phase17/INTERCOM.md "Rooms", "The address MA uses"): talk to the rooms of
// the house from a tablet or a phone. This page turns it on, tells Music Assistant (MA) where to fetch the audio from, says which
// rooms may be spoken to, and sets each room's volume, quiet hours, listening tablets and Live.
//
// Owners and Admins see it (the section "intercom"); the routes behind it decide the rest (a fresh sign-in away from home, which
// api() asks for through Confirm It Is You, and an audit row first: if the log is unavailable nothing changes, and the page says so).
//
// The address must be private: http or https on 10/8, 172.16/12, 192.168/16, or a .local, .lan or .home.arpa name. The page warns
// as the address is typed; the server checks it again and refuses a public one. Live is drawn only when the house has measured its
// lag (settings.lag_ms is a number): the proof is what allows Live at all.
//
// Every change is saved at once (a switch, a slider on release, a box on Return), as the other settings pages do; the server answers
// with the whole settings document, which replaces the page's copy. Enable All asks for each room in turn: the settings document
// is written whole, so two at once could overwrite each other.
import { act, api, ask, hh, K, load, redraw, ROUTE, shown } from './core.js';
import { button, draft, failed, group, info, nav, pending, result } from './kit.js';

const HOME = '#/' + ROUTE + '/intercom';
const get = (tail) => api('GET', '/api/intercom' + tail);
const put = (tail, body) => api('PUT', '/api/intercom' + tail, body);
const post = (tail, body) => api('POST', '/api/intercom' + tail, body);
const MODES = [['message', 'Message'], ['live', 'Live']];
const NEW_ROOM = { enabled: false, live: true, volume: null, quiet: null, listeners: [], live_fails: 0, demoted: false };
const CHECK = 'intercom:check';
// the save the last commit of the address started: Check Reach waits for it, because the box commits as it loses focus, a moment before the press lands
let saving = Promise.resolve();

export const readPage = () => load('intercom', () => get('/settings'));

// the server's answer replaces the page's copy of the settings (and nothing else of what was read)
function land(r) {
  const got = readPage();
  if (got && got.data && r && r.settings) got.data.settings = r.settings;
}
// the settings as they stand now: a change that builds on a part of them (a chime switch beside the other, a room's hours) reads them when it is
// made, not when the page was drawn, so two quick taps do not undo each other
const latest = (S) => { const got = readPage(); return (got && got.data && got.data.settings) || S; };
const roomOf = (S, entity) => Object.assign({}, NEW_ROOM, (S.rooms || {})[entity]);
const note = (n) => (n ? hh('p', { class: 'mxflash' + (n.err ? ' err' : ''), role: n.err ? 'alert' : 'status', text: n.text }) : null);
const seconds = (ms) => { const s = Math.round(ms / 100) / 10; return s + (s === 1 ? ' second' : ' seconds'); };

// ---------------------------------------------------------------------------------------- the address
// Why an address would not do, or null. The same rule the server applies (it checks again).
export function addressProblem(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  let u;
  try { u = new URL(t); } catch (e) { return 'That is not an address. Use one like http://<this server’s address>:8767.'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Start the address with http:// or https://.';
  const host = u.hostname.toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  let ok = false;
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    ok = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  } else {
    ok = /\.(local|lan|home\.arpa)$/.test(host);
  }
  return ok ? null : 'This does not look like a private address. Music Assistant must reach Mantel on your home network, not through the internet or a tunnel.';
}

// ============================================================================================ Intercom
export function pIntercom(sub) {
  if (sub[0] === 'room' && sub[1]) return pRoom(decodeURIComponent(sub[1]));
  return { title: 'Intercom', top: true,
    scope: 'Talk to the rooms of the house from a tablet or a phone. Mantel gives Music Assistant a link to your voice, and its speakers play it.',
    body(c) {
      result(c, 'intercom');
      const got = readPage();
      if (!got) { pending(c); return; }
      if (got.err) { failed(c, got.err); return; }
      const page = got.data, S = page.settings;
      drawSwitch(c, page, S);
      drawAddress(c, page, S);
      drawRooms(c, page, S);
      drawTalk(c, S);
      drawSound(c, S);
      drawQuiet(c, S);
    } };
}

// a house setting, saved at once: the server's answer replaces the copy; a refusal says why and the page goes back to what was saved
const saveHouse = (patch, okText) => act('intercom', async () => { const r = await put('/settings', patch); land(r); return r; }, okText);

function drawSwitch(c, page, S) {
  const rows = [K().toggle({ label: 'Intercom', on: !!S.enabled, fk: 'mx:intercom:enabled', onChange: (on) => saveHouse({ enabled: on }) })];
  let footer = 'Off, nobody can announce and Mantel listens for nothing. No room speaks until you turn it on below.';
  if (!page.ma) footer = 'Music Assistant is not connected, so nothing can be played yet. Connect it in Connections. ' + footer;
  c.appendChild(group({ footer }, rows));
}

function drawAddress(c, page, S) {
  const d = draft('intercom');
  const shownValue = d.stream_base !== undefined ? d.stream_base : (S.stream_base || '');
  const warn = addressProblem(shownValue);
  const box = K().text({ label: 'Address for Music Assistant', value: shownValue, type: 'url', maxlength: 300, inputmode: 'url', autocomplete: 'off',
    placeholder: 'http://<this server>:8767', fk: 'mx:intercom:address',
    onCommit: (v) => {
      d.stream_base = v.trim();
      if (d.stream_base === (S.stream_base || '')) { delete d.stream_base; redraw(); return; }
      delete shown[CHECK];
      saving = saveHouse({ stream_base: d.stream_base }).then((ok) => { if (ok) delete d.stream_base; });
    } });
  box.classList.add('mxaddr');
  const rows = [box];
  if (warn) rows.push(note({ text: warn, err: true }));
  const sug = page.suggested_base;
  if (sug && sug !== shownValue) {
    rows.push(button('Use ' + sug, () => {
      d.stream_base = sug; delete shown[CHECK];
      saving = saveHouse({ stream_base: sug }).then((ok) => { if (ok) delete d.stream_base; });
    }, { fk: 'mx:intercom:suggest' }));
  }
  rows.push(button('Check Reach', () => checkReach(S, d), { fk: 'mx:intercom:check' }));
  if (shown[CHECK]) rows.push(note(shown[CHECK]));
  if (!page.stream_port) {
    rows.push(info('Listener', 'Mantel was started without a stream port, so Music Assistant has nowhere to fetch audio from.', 'Not Set Up', 'warn'));
  } else {
    const on = !!page.listening;
    rows.push(info('Listener', 'Port ' + page.stream_port, on ? 'Listening' : S.enabled ? 'Not Listening' : 'Off', S.enabled && !on ? 'warn' : ''));
  }
  c.appendChild(group({ header: 'Music Assistant',
    footer: 'Music Assistant fetches the audio from this address, such as http://<this server’s address>:8767. It must be on your home network. Check Reach has Music Assistant read a silent clip; nothing is played.' }, rows));
}
async function checkReach(S, d) {
  await saving;
  const typed = d.stream_base;
  if (typed !== undefined) { shown[CHECK] = { text: 'That address was not saved. Fix it first.', err: true }; redraw(); return; }
  // the address as it was last saved, not as the page was drawn: the button may have been drawn before the save above landed
  if (!latest(S).stream_base) { shown[CHECK] = { text: 'Enter the address first.', err: true }; redraw(); return; }
  shown[CHECK] = { text: 'Asking Music Assistant…' }; redraw();
  try {
    const r = await post('/check', {});
    shown[CHECK] = { text: r.message || (r.ok ? 'Music Assistant fetched it.' : 'Music Assistant could not reach this address.'), err: !r.ok };
  } catch (e) { shown[CHECK] = { text: e.message, err: true }; }
  redraw();
}

// ---------------------------------------------------------------------------------------- the rooms
function roomSub(r, st) {
  const bits = [r.floor];
  if (!r.ma) bits.push('Not in Music Assistant');
  else if (st.enabled) bits.push(st.demoted ? 'Message only (Live failed)' : st.live ? 'Live and Message' : 'Message only');
  return bits.filter(Boolean).join(' · ') || null;
}
function drawRooms(c, page, S) {
  const rooms = page.rooms || [];
  const off = rooms.filter((r) => !roomOf(S, r.room).enabled);
  const rows = [];
  if (rooms.length) rows.push(button('Enable All', () => enableAll(off), { disabled: !off.length, fk: 'mx:intercom:all' }));
  for (const r of rooms) {
    const st = roomOf(S, r.room);
    rows.push(nav(r.name, 'intercom/room/' + encodeURIComponent(r.room), { sub: roomSub(r, st), value: st.enabled ? 'On' : 'Off' }));
  }
  c.appendChild(group({ header: 'Rooms', footer: rooms.length
    ? 'A room starts off, so a bedroom does not speak by surprise. Turn on the ones that should. Open a room for its volume, quiet hours and tablets.'
    : 'No rooms yet. Rooms are your Music Assistant speakers, set up in Connections.' }, rows));
}
async function enableAll(off) {
  if (!off.length) return;
  const ok = await ask({ title: 'Turn on all rooms?', message: 'Every room can then play announcements, bedrooms too. Quiet hours still apply.', ok: 'Turn On' });
  if (!ok) return;
  await act('intercom', async () => {
    for (const r of off) land(await put('/rooms/' + encodeURIComponent(r.room), { enabled: true }));    // one at a time: the document is written whole
  });
}

// ---------------------------------------------------------------------------------------- talking
function drawTalk(c, S) {
  const proven = typeof S.lag_ms === 'number';        // Live is drawn only once the house has measured its lag
  const rows = [];
  if (proven) {
    rows.push(K().toggle({ label: 'Live Allowed', sub: 'About ' + seconds(S.lag_ms) + ' behind', on: !!S.live_allowed, fk: 'mx:intercom:live-allowed',
      onChange: (on) => saveHouse({ live_allowed: on }) }));
  }
  const modes = MODES.filter(([m]) => m === 'message' || S.live_allowed || S.default_mode === 'live');
  rows.push(K().select({ label: 'Starts As', options: modes, value: S.default_mode, fk: 'mx:intercom:mode',
    onChange: (v) => saveHouse({ default_mode: v }) }));
  rows.push(K().slider({ label: 'Longest Message', min: 10, max: 60, step: 5, unit: ' s', value: S.max_message_s, fk: 'mx:intercom:max-message',
    onChange: (v) => saveHouse({ max_message_s: v }) }));
  rows.push(K().slider({ label: 'Longest Live Talk', min: 15, max: 120, step: 5, unit: ' s', value: S.max_live_s, fk: 'mx:intercom:max-live',
    onChange: (v) => saveHouse({ max_live_s: v }) }));
  c.appendChild(group({ header: 'Talking', footer: 'A Message is recorded, then played. ' + (proven
    ? 'Live plays as you speak, a few seconds behind; a room that is playing music gets the Message when you finish.'
    : 'Live needs a one-time test of how far behind the speakers run, and it has not been done yet.') }, rows));
}
function drawSound(c, S) {
  const chime = Object.assign({ message: true, live: false }, S.chime);
  const chimes = () => Object.assign({ message: true, live: false }, latest(S).chime);
  c.appendChild(group({ header: 'Sound', footer: 'The chime plays before the voice. It is on for Messages and off for Live, where it would only add to the delay.' }, [
    K().toggle({ label: 'Chime Before a Message', on: !!chime.message, fk: 'mx:intercom:chime-message', onChange: (on) => saveHouse({ chime: { ...chimes(), message: on } }) }),
    K().toggle({ label: 'Chime Before Live', on: !!chime.live, fk: 'mx:intercom:chime-live', onChange: (on) => saveHouse({ chime: { ...chimes(), live: on } }) })]));
  c.appendChild(group({ footer: 'Volume is how loud a room on Automatic plays the Intercom, whatever its speaker is set to. No room plays louder than the Highest Volume. A room can have its own, on its page.' }, [
    K().slider({ label: 'Volume', min: 10, max: 100, step: 5, unit: '%', value: S.volume || 40, fk: 'mx:intercom:volume',
      onChange: (v) => saveHouse({ volume: v }) }),
    K().slider({ label: 'Highest Volume', min: 10, max: 100, step: 5, unit: '%', value: S.max_volume, fk: 'mx:intercom:max-volume',
      onChange: (v) => saveHouse({ max_volume: v }) })]));
}
const quietOf = (S) => Object.assign({ schedule: true, from: '21:00', to: '07:00', while: [] }, S.quiet_default);
const timeBox = (label, value, fk, onTime) => K().text({ label, type: 'time', value, maxlength: 5, fk,
  onCommit: (v) => { if (/^\d{2}:\d{2}$/.test(v)) onTime(v); else redraw(); } });
function drawQuiet(c, S) {
  const q = quietOf(S), qNow = () => quietOf(latest(S));
  const rows = [K().toggle({ label: 'Quiet Hours', on: !!q.schedule, fk: 'mx:intercom:quiet', onChange: (on) => saveHouse({ quiet_default: { ...qNow(), schedule: on } }) })];
  if (q.schedule) {
    rows.push(timeBox('From', q.from, 'mx:intercom:quiet-from', (v) => saveHouse({ quiet_default: { ...qNow(), from: v } })));
    rows.push(timeBox('To', q.to, 'mx:intercom:quiet-to', (v) => saveHouse({ quiet_default: { ...qNow(), to: v } })));
  }
  c.appendChild(group({ header: 'Quiet Hours', footer: 'In the house’s time zone. A room in quiet hours is skipped. An Owner, Admin or Adult can send anyway. A room can have hours of its own.' }, rows));
}

// ============================================================================================ one room
const VOLUMES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
function pRoom(entity) {
  const got = readPage();
  const known = got && got.data && got.data.rooms.find((r) => r.room === entity);
  return { title: known ? known.name : 'Room', back: ['Intercom', HOME], body(c) {
    const key = 'intercom:room:' + entity;
    result(c, key);
    const g = readPage();
    if (!g) { pending(c); return; }
    if (g.err) { failed(c, g.err); return; }
    const page = g.data, S = page.settings;
    const r = page.rooms.find((x) => x.room === entity);
    if (!r) { c.appendChild(group({ footer: 'That room is no longer here.' }, [])); return; }
    const st = roomOf(S, entity);
    // a patch, or a function of the room as it stands when the change is made (see latest)
    const change = (patch) => act(key, async () => {
      const body = typeof patch === 'function' ? patch(roomOf(latest(S), entity)) : patch;
      land(await put('/rooms/' + encodeURIComponent(entity), body));
    });
    if (!r.ma) c.appendChild(group({ footer: 'Music Assistant does not list this speaker, so nothing can be played in this room yet.' }, []));
    c.appendChild(group({}, [K().toggle({ label: 'On', on: !!st.enabled, fk: 'mx:intercom-room:on', onChange: (on) => change({ enabled: on }) })]));
    drawLive(c, r, S, st, change);
    drawVolume(c, S, st, change);
    drawRoomQuiet(c, S, st, change);
    drawTablets(c, page, entity, st, change);
    drawTest(c, r, st);
  } };
}
function drawLive(c, r, S, st, change) {
  c.appendChild(group({ footer: st.demoted ? null : S.live_allowed
    ? 'Off, this room only gets Messages. Use that for a speaker where Live misbehaves.'
    : 'Off, this room only gets Messages. Live is also off for the house, on the Intercom page.' }, st.demoted ? [
    info('Live Paused', 'Live didn’t work here three times. Using Message.', 'Message Only', 'warn'),
    button('Try Live Again', () => change({ reset_live: true }), { fk: 'mx:intercom-room:reset-live' })]
    : [K().toggle({ label: 'Live', on: !!st.live, fk: 'mx:intercom-room:live', onChange: (on) => change({ live: on }) })]));
}
function drawVolume(c, S, st, change) {
  const cur = st.volume === null || st.volume === undefined ? '' : String(st.volume);
  const opts = [['', 'Automatic']].concat(VOLUMES.concat(cur && !VOLUMES.includes(Number(cur)) ? [Number(cur)] : []).sort((a, b) => a - b).map((v) => [String(v), v + '%']));
  c.appendChild(group({ footer: 'Automatic uses the Intercom page’s Volume, ' + Math.min(S.volume || 40, S.max_volume) + '%. Never louder than ' + S.max_volume + '%, the highest volume on the Intercom page.' }, [
    K().select({ label: 'Volume', options: opts, value: cur, fk: 'mx:intercom-room:volume', onChange: (v) => change({ volume: v === '' ? null : Number(v) }) })]));
}
// a room's own hours as they stand, else the house's to start from
const hoursOf = (S, st) => { const h = quietOf(latest(S)), q = st.quiet || {}; return { from: q.from || h.from, to: q.to || h.to, while: q.while || [] }; };
function drawRoomQuiet(c, S, st, change) {
  const house = quietOf(S);
  const own = st.quiet ? Object.assign({ schedule: false, from: house.from, to: house.to, while: [] }, st.quiet) : null;
  const mode = !own ? 'house' : own.schedule ? 'own' : 'none';
  const rows = [K().select({ label: 'Quiet Hours', options: [['house', 'Same as the House'], ['own', 'Its Own Hours'], ['none', 'None']], value: mode, fk: 'mx:intercom-room:quiet',
    onChange: (v) => change((now) => ({ quiet: v === 'house' ? null : { schedule: v === 'own', ...hoursOf(S, now) } })) })];
  if (own && own.schedule) {
    rows.push(timeBox('From', own.from, 'mx:intercom-room:quiet-from', (v) => change((now) => ({ quiet: { schedule: true, ...hoursOf(S, now), from: v } }))));
    rows.push(timeBox('To', own.to, 'mx:intercom-room:quiet-to', (v) => change((now) => ({ quiet: { schedule: true, ...hoursOf(S, now), to: v } }))));
  }
  c.appendChild(group({ footer: mode === 'house'
    ? 'Follows the house: ' + (house.schedule ? house.from + ' to ' + house.to : 'no quiet hours') + '.'
    : 'In the house’s time zone. A sender can still choose Send Anyway.' }, rows));
}
function drawTablets(c, page, entity, st, change) {
  const tablets = page.tablets || [];
  const name = (id) => { const x = page.rooms.find((q) => q.room === id); return x ? x.name : id; };
  const rows = tablets.map((t) => K().check({ label: t.name, sub: t.room ? name(t.room) : null, multi: true, on: st.listeners.includes(t.id), fk: 'mx:intercom-room:tablet:' + t.id,
    onClick: () => change((now) => ({ listeners: now.listeners.includes(t.id) ? now.listeners.filter((x) => x !== t.id) : now.listeners.concat([t.id]) })) }));
  c.appendChild(group({ header: 'Tablets', footer: tablets.length
    ? 'A tablet ticked here plays this room’s announcements itself. Use it for a room with no speaker. A tablet that is speaking does not hear itself.'
    : 'No wall tablets are paired. A paired tablet can listen for a room with no speaker.' }, rows));
}
function drawTest(c, r, st) {
  const tk = 'intercom:test:' + r.room;
  const run = async () => {
    if (!(await ask({ title: 'Play a chime in ' + r.name + '?', message: 'A soft chime plays on that speaker now.', ok: 'Play' }))) return;
    shown[tk] = { text: 'Sending…' }; redraw();
    try {
      const out = await post('/test', { room: r.room });
      shown[tk] = { text: out.message || (out.ok ? 'The chime was sent.' : 'The chime could not be sent.'), err: !out.ok };
    } catch (e) { shown[tk] = { text: e.message, err: true }; }
    redraw();
  };
  c.appendChild(group({ footer: 'Plays a soft chime in this room, so you can hear that it works. ' + (st.enabled ? '' : 'Turn the room on first.') },
    [button('Send Test', run, { disabled: !r.ma, fk: 'mx:intercom-room:test' })].concat(shown[tk] ? [note(shown[tk])] : [])));
}
