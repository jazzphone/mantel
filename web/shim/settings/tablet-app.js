// settings/tablet-app.js -- Mantel Settings, a wall tablet running Mantel for Android: its status and its controls, on the
// home network (apps/tablet_app.py; docs/phase26/ANDROID-APP.md "Managing a tablet"). Mantel reaches the app through the
// page the tablet has open, so nothing listens on the tablet and there is no password of its own.
// @ts-check
import { act, api, cache, can, hh, K, load, me, redraw } from './core.js';
import { button, draft, field, group, info, result } from './kit.js';

const devicesRead = () => load('devices', () => api('GET', '/api/devices'));
const appRead = (id) => load('tablet-app:' + id, () => api('GET', '/api/devices/' + encodeURIComponent(id) + '/app'));
const pct = (v) => Math.round((v || 0) * 100);
// A CONTROL STAYS WHERE IT WAS PUT (2026-11-14, the owner: "the Tablet settings may have the same issue"). A command's
// value goes into the page's copy of the app's status before it is sent (the app answers within seconds, and any redraw
// meanwhile -- the tablet's page saving its own option first -- drew the old value back); the app's answer, which
// carries its status, replaces the copy, and a refused or unanswered one reads the status again. The copy is never
// dropped while it is read: the group stays on the page.
// each command whose value the app reports back under the same name
const SHOWN = new Set(['screen', 'brightness', 'curtain', 'kiosk_mode', 'rotation', 'keep_awake', 'keep_screen_on',
                       'adaptive_brightness', 'scale', 'airplay', 'airplay_mirroring', 'airplay_video', 'airplay_audio',
                       'wireless_debugging', 'renderer', 'render_size']);
function hold(id, command, value) {
  const got = cache['tablet-app:' + id];
  if (got && got.data && got.data.status && SHOWN.has(command)) got.data = { ...got.data, status: { ...got.data.status, [command]: value } };
}
function took(id, r) {
  const got = cache['tablet-app:' + id];
  if (got && got.data && r && r.status) got.data = { ...got.data, status: r.status };
}
function readAgain(id) {
  api('GET', '/api/devices/' + encodeURIComponent(id) + '/app')
    .then((data) => { cache['tablet-app:' + id] = { data }; redraw(); }, () => {});
}
// WHAT'S ON THE SCREEN (the owner, 2026-11-12): a picture the app takes when asked, kept by Mantel in memory
const pictures = {};             // device id -> { src, at } or { busy } or { err }
async function takePicture(id) {
  pictures[id] = { ...(pictures[id] || {}), busy: true, err: null }; redraw();
  try {
    const r = await api('POST', '/api/devices/' + encodeURIComponent(id) + '/app', { command: 'screenshot' });
    pictures[id] = r.image ? { src: r.image, at: Date.now() } : { err: 'The tablet took no picture.' };
  } catch (e) { pictures[id] = { ...(pictures[id] || {}), busy: false, err: e.message }; }
  redraw();
}
// the app's last update check (Updater.check), in words
function updateSays(u) {
  if (!u) return '';
  if (/^current/.test(u)) return 'Up to Date';
  if (u === 'ready') return 'Update Ready';
  if (u === 'no manifest') return 'No Release on Mantel';
  return 'Update Check: ' + u.replace(/^failed: /, '');
}

function says(st) {
  if (!st) return 'Not heard from yet.';
  return [st.version ? 'Version ' + st.version : null,
          st.screen === false ? 'Screen off' : st.screen ? 'Screen on at ' + pct(st.brightness) + '%' : null,
          st.curtain ? 'Black curtain up' : null,
          st.sky === 'playing' ? 'Drawing the sky' : null,
          typeof st.battery === 'number' ? 'Battery ' + Math.round(st.battery) + '%' + (st.charging ? ', charging' : '') : null,
          st.ip || null].filter(Boolean).join(' · ');
}

// Returns true when it drew a tablet's app (its Direct Connection, Kiosk Satellite's and Fully's, is then left out)
// AIRPLAY (phase 30, docs/phase30/PLAN.md): the app as an AirPlay receiver under the tablet's own name, off until
// switched on (here or by Home Assistant's switch); what it offers, each a switch, while it's on
const AIRPLAY_OFFERS = [['airplay_mirroring', 'Screen Mirroring', 'Fills the screen over the page until the sender stops'],
                        ['airplay_video', 'Video', 'A video sent with AirPlay plays on the tablet (YouTube; not protected video)'],
                        ['airplay_audio', 'Sound', 'Music and other sound from the tablet’s speaker']];

function drawAirPlay(c, st, send, off, id) {
  const rows = [K().toggle({ label: 'AirPlay', on: !!st.airplay, disabled: off, fk: 'mx:app-airplay:' + id,
                             sub: st.airplay_name ? 'As “' + st.airplay_name + '”' : null,
                             onChange: (on) => send('airplay', on, on ? 'AirPlay on.' : 'AirPlay off.') })];
  if (st.airplay) {
    for (const [cmd, label, sub] of AIRPLAY_OFFERS) {
      rows.push(K().toggle({ label, sub, on: st[cmd] !== false, disabled: off, fk: 'mx:app-' + cmd + ':' + id,
                             onChange: (on) => send(cmd, on, null) }));
    }
    if (st.airplay_state) rows.push(info('Now', null, st.airplay_state));
  }
  c.appendChild(group({ header: 'AirPlay', footer: 'An iPhone, iPad or Mac on the home network can mirror its screen to the '
    + 'tablet, send it a video or play sound to it. A mirror or a video keeps the screen on until it ends. '
    + 'Speakers can’t be grouped with HomePods.' }, rows));
}

// THE TABLET'S OWN OPTIONS (the owner, 2026-11-13: "keep tablet awake and such should be options ... but on by
// default"; adaptive brightness; the tablet's scaling): the app's Options.kt and PageScale.kt, drawn when it says them
const SCALES = [80, 90, 100, 110, 125, 150];
const NEEDS_WRITE = 'On the tablet, allow Mantel to modify system settings (the app opened that screen), then choose again.';
function optionRows(rows, st, send, off, id) {
  if (typeof st.keep_awake !== 'boolean') return;                       // an app from before them
  rows.push(K().toggle({ label: 'Keep Awake', on: st.keep_awake, disabled: off, fk: 'mx:app-awake:' + id,
                         sub: 'Wi-Fi and the processor stay awake while the screen is off, so a wake shows the page at once',
                         onChange: (on) => send('keep_awake', on, null) }));
  rows.push(K().toggle({ label: 'Keep Screen On', on: st.keep_screen_on !== false, disabled: off, fk: 'mx:app-lit:' + id,
                         sub: 'Off, Android’s own screen timeout can turn the screen off',
                         onChange: (on) => send('keep_screen_on', on, null) }));
  if (typeof st.adaptive_brightness === 'boolean') {
    rows.push(K().toggle({ label: 'Adaptive Brightness', on: st.adaptive_brightness, disabled: off, fk: 'mx:app-adaptive:' + id,
                           sub: 'Android’s own: the light sensor sets the screen’s brightness',
                           onChange: (on) => send('adaptive_brightness', on, null) }));
    if (st.adaptive_brightness_allowed === false) rows.push(info('Adaptive Brightness', NEEDS_WRITE, 'Not Allowed', 'warn'));
  }
  const scale = SCALES.includes(st.scale) ? st.scale : 100;
  rows.push(K().select({ label: 'Scale', sub: 'Everything on the screen larger or smaller; the page loads again',
                         options: SCALES.map((v) => [String(v), v + '%' + (v === 100 ? ' (Mantel’s Own)' : ''), v + '%']),
                         value: String(scale), disabled: off, fk: 'mx:app-scale:' + id,
                         onChange: (v) => send('scale', Number(v), 'Scale ' + v + '%.') }));
}

// WIRELESS DEBUGGING (the owner, 2026-11-13): Android's, kept on through restarts while chosen; the app needs a grant
// only adb gives, once (the app's tools/setup_tablet.py does it)
function drawDebugging(c, st, send, off, id) {
  if (typeof st.wireless_debugging !== 'boolean') return;
  const rows = [K().toggle({ label: 'Wireless Debugging', on: st.wireless_debugging, fk: 'mx:app-adb:' + id,
                             disabled: off || (!st.wireless_debugging && st.wireless_debugging_allowed === false),
                             sub: st.wireless_debugging && st.adb_port && st.ip ? 'adb connect ' + st.ip + ':' + st.adb_port : null,
                             onChange: (on) => send('wireless_debugging', on, on ? 'Wireless debugging on.' : 'Wireless debugging off.') })];
  if (st.wireless_debugging_allowed === false) {
    rows.push(info('Needs a Grant', 'Once, over adb: adb shell pm grant com.jazzphone.mantel.android android.permission.WRITE_SECURE_SETTINGS', 'Not Allowed', 'warn'));
  }
  c.appendChild(group({ header: 'Developer', footer: 'Android’s wireless debugging, kept on through restarts while this is on. '
    + 'Its port changes each time it starts. A computer still has to be paired with the tablet once.' }, rows));
}

// HOW THE TABLET DRAWS (the owner, 2026-11-14: "having the app able to turn on OpenGL is worth us implementing ... it
// would also be great if we could change resolution"): the app's Graphics.kt, through its own adb (SelfAdb.kt), paired
// once with the code Android shows under Wireless debugging -> Pair device with pairing code
const RENDER_SIZES = [[100, 'Full (the Panel’s Own)'], [83, '83% (1600 × 900 on a 1080p Panel)'], [67, '67% (1280 × 720 on a 1080p Panel)']];
function drawGraphics(c, st, send, off, id) {
  if (typeof st.renderer !== 'string') return;                          // an app from before it
  const ready = st.adb_paired && st.wireless_debugging_allowed !== false;
  const rows = [K().select({ label: 'Renderer', fk: 'mx:app-renderer:' + id, value: st.renderer, disabled: off || !ready,
                             sub: st.renderer_now && st.renderer_now !== st.renderer ? 'Android has ' + (st.renderer_now === 'opengl' ? 'OpenGL' : 'its default') + ' now' : null,
                             options: [['default', 'Android’s Default'], ['opengl', 'OpenGL']],
                             onChange: (v) => send('renderer', v, v === 'opengl' ? 'OpenGL: the app starts again.' : 'Android’s default: the app starts again.') }),
                K().select({ label: 'Resolution', fk: 'mx:app-render-size:' + id, value: String(st.render_size || 100), disabled: off || !ready,
                             sub: 'Fewer pixels to draw, stretched to the screen: smoother on a slow tablet, softer text up close',
                             options: RENDER_SIZES.map(([v, l]) => [String(v), l]),
                             onChange: (v) => send('render_size', Number(v), 'Resolution ' + v + '%.') })];
  if (st.wireless_debugging_allowed === false) {
    rows.push(info('Needs a Grant', 'Once, over adb: adb shell pm grant com.jazzphone.mantel.android android.permission.WRITE_SECURE_SETTINGS', 'Not Allowed', 'warn'));
  } else if (!st.adb_paired) {
    const form = 'app-pair:' + id;
    rows.push(info('Pair the App', 'On the tablet: Developer options → Wireless debugging → Pair device with pairing code. '
      + 'Enter the code and the port after the colon here while that stays open.', 'Not Paired', 'warn'));
    rows.push(field(form, 'code', 'Pairing Code', { inputmode: 'numeric', maxlength: 6, placeholder: '123456' }));
    rows.push(field(form, 'port', 'Port', { inputmode: 'numeric', maxlength: 5, placeholder: '37000' }));
    rows.push(button('Pair', () => {
      const d = draft(form);
      send('adb_pair', { code: String(d.code || '').replace(/\D/g, ''), port: Number(d.port) }, 'Paired.');
    }, { fk: 'mx:app-pair:' + id, disabled: off }));
  }
  c.appendChild(group({ header: 'Graphics', footer: 'Set by the app through Android’s own debugging, so it stays on while these '
    + 'are chosen. OpenGL draws a page swipe in about half the time on some tablets (one measured: 90 ms a frame to 44); '
    + 'Android forgets it at every restart, and the app sets it again and starts once more.' }, rows));
}

// ALL TABLETS (the owner, 2026-11-14: "Global or 'Fleet' management where tablets have the same settings ... also able
// to adjust the settings independently"): HK's `tablets.app`, what every tablet's app is sent unless the tablet sets its
// own (`app_options`); hk_core tablet_rules.APP_OPTIONS says what each may be
const FOLLOWED = ['kiosk_mode', 'keep_awake', 'keep_screen_on', 'adaptive_brightness', 'scale', 'renderer', 'render_size',
                  'airplay', 'airplay_mirroring', 'airplay_video', 'airplay_audio'];
/** @type {Array<[any, string]>} */
const ON_OFF = [[true, 'On'], [false, 'Off']];
/** @type {Array<[string, string, Array<[any, string]>]>} */
const FLEET = [['kiosk_mode', 'Kiosk Mode', ON_OFF], ['keep_awake', 'Keep Awake', ON_OFF], ['keep_screen_on', 'Keep Screen On', ON_OFF],
               ['adaptive_brightness', 'Adaptive Brightness', ON_OFF],
               ['scale', 'Scale', SCALES.map((v) => /** @type {[any, string]} */ ([v, v + '%']))],
               ['renderer', 'Renderer', /** @type {Array<[any, string]>} */ ([['default', 'Android’s Default'], ['opengl', 'OpenGL']])],
               ['render_size', 'Resolution', RENDER_SIZES.map(([v]) => /** @type {[any, string]} */ ([v, v + '%']))],
               ['airplay', 'AirPlay', ON_OFF], ['airplay_mirroring', 'AirPlay Screen Mirroring', ON_OFF],
               ['airplay_video', 'AirPlay Video', ON_OFF], ['airplay_audio', 'AirPlay Sound', ON_OFF]];
const sayValue = (k, v) => { const f = FLEET.find(([kk]) => kk === k); const o = f && f[2].find(([x]) => x === v); return o ? o[1] : String(v); };
const lastOf = (k) => FLEET.find(([kk]) => kk === k)[1];

// a tablet's own choices over All Tablets', and the way back
function drawOwn(c, ctx, own) {
  const keys = Object.keys(own).filter((k) => FOLLOWED.includes(k));
  const house = ctx.house_app || {};
  if (!keys.length && !Object.keys(house).length) return;
  const rows = keys.map((k) => info(lastOf(k), house[k] !== undefined ? 'All Tablets: ' + sayValue(k, house[k]) : 'Not set for All Tablets',
                                    'Just This Tablet: ' + sayValue(k, own[k])));
  if (keys.length && typeof ctx.set === 'function') {
    rows.push(button('Use All Tablets’ Settings', () => ctx.set({ app_options: {} }), { fk: 'mx:app-own-reset:' + ctx.tablet }));
  } else rows.push(info('Settings', null, 'Same as All Tablets'));
  c.appendChild(group({ header: 'This Tablet’s Own', footer: 'A setting chosen on this page is this tablet’s own; the rest follow '
    + 'All Tablets (Wall Tablets), sent to the app within a minute.' }, rows));
}

// Wall Tablets: All Tablets' app settings, and every app checking for an update at once
export function drawAllTablets(c, ctx, p) {
  const got = devicesRead();
  if (!got || got.err || !got.data) return;
  const apps = got.data.devices.filter((d) => !d.revoked && (d.hk_tablets || []).length)
    .filter((d) => { const a = appRead(d.id); return a && a.data && a.data.status; });
  if (!apps.length) return;
  const house = (ctx && ctx.house && ctx.house.app) || {};
  const setHouse = (k, v) => {
    const next = { ...house };
    if (v === '') delete next[k]; else next[k] = v;
    if (p && typeof p.setH === 'function') p.setH({ 'tablets.app': next });
  };
  const rows = FLEET.map(([k, label, opts]) => K().select({
    label, fk: 'mx:fleet-' + k, value: house[k] === undefined ? '' : String(house[k]),
    options: [['', 'Each Tablet’s Own']].concat(opts.map(([v, l]) => [String(v), l])),
    onChange: (v) => setHouse(k, v === '' ? '' : (opts.find(([x]) => String(x) === v) || [v])[0]) }));
  rows.push(button('Check for Updates on All Tablets', () => act('fleet-update', async () => {
    // (one at a time: each answers within seconds; a tablet whose app isn't connected is passed over)
    for (const d of apps) {
      try { await api('POST', '/api/devices/' + encodeURIComponent(d.id) + '/app', { command: 'check_update' }); } catch (e) { /* not connected */ }
    }
    return {};
  }, 'Each tablet checked; one with a new version installs it now.', 'fleet-update'), { fk: 'mx:fleet-update' }));
  c.appendChild(group({ header: 'Mantel for Android, All Tablets', footer: 'What every tablet running Mantel for Android is set to, '
    + 'sent to each app within a minute. A tablet can still choose its own on its page. Renderer and Resolution reach a tablet '
    + 'once its app is paired (its Graphics). Updates: each app installs a new version at a quiet moment, or at once when checked.' }, rows));
  result(c, 'fleet-update');
}

// COPY SETTINGS FROM ANOTHER TABLET (the owner, 2026-11-13): what another app tablet last said, sent to this one as one
// command. Never the screen, the brightness, the menu PIN or wireless debugging; the rotation only between the same model.
const COPYABLE = ['kiosk_mode', 'keep_awake', 'keep_screen_on', 'adaptive_brightness', 'scale',
                  'airplay', 'airplay_mirroring', 'airplay_video', 'airplay_audio'];
const copyFrom = {};             // device id -> the device id chosen to copy from
function copied(src, st) {
  const out = {};
  for (const k of COPYABLE) if (typeof src[k] === (k === 'scale' ? 'number' : 'boolean')) out[k] = src[k];
  if (src.rotation && src.model && src.model === st.model) out.rotation = src.rotation;
  if (!SCALES.includes(out.scale)) delete out.scale;
  return out;
}
function drawCopy(c, dv, st, all, send, off) {
  if (typeof st.keep_awake !== 'boolean') return;
  const others = all.filter((d) => d.id !== dv.id && !d.revoked && (d.hk_tablets || []).length)
    .map((d) => ({ d, st: ((appRead(d.id) || {}).data || {}).status })).filter((o) => o.st && typeof o.st.keep_awake === 'boolean');
  if (!others.length) return;
  const pick = others.find((o) => o.d.id === copyFrom[dv.id]);
  const rows = [K().select({ label: 'Copy From', fk: 'mx:app-copy-from:' + dv.id, value: pick ? pick.d.id : '',
                             options: [['', 'Choose a Tablet']].concat(others.map((o) => [o.d.id, o.d.name])),
                             onChange: (v) => { copyFrom[dv.id] = v; redraw(); } })];
  if (pick) {
    const got = copied(pick.st, st);
    rows.push(button('Copy ' + pick.d.name + '’s Settings', () => send('settings', got, 'Copied from ' + pick.d.name + '.'),
                     { fk: 'mx:app-copy:' + dv.id, disabled: off }));
  }
  c.appendChild(group({ header: 'Copy Settings', footer: 'Kiosk mode, Keep Awake, Keep Screen On, Adaptive Brightness, '
    + 'Scale and AirPlay as the other tablet has them, and its rotation when it’s the same model. Never the screen, '
    + 'its brightness, the menu PIN or wireless debugging.' }, rows));
}

export function drawTabletApp(c, ctx) {
  if (!can('devices')) return false;
  let drew = false;
  const got = devicesRead();
  if (!got || got.err || !got.data) return false;
  const mine = got.data.devices.filter((d) => !d.revoked && (d.hk_tablets || []).includes(ctx.tablet));
  for (const dv of mine) {
    const a = appRead(dv.id);
    const data = a && a.data;
    if (!data || (!data.status && !data.connected)) continue;          // a browser, not the app: nothing to draw
    drew = true;
    const st = data.status || {}, key = 'tablet-app:' + dv.id, form = 'tablet-app-' + dv.id;
    const header = 'Mantel for Android' + (mine.length > 1 ? ' (' + dv.name + ')' : '');
    const live = data.connected && data.fresh;
    const rows = [info('Status', says(data.status), live ? 'Connected' : 'Not Connected', live ? '' : 'warn')];
    if (me.door !== 'lan') {
      rows.push(info('Its Controls', null, 'Home Network Only'));
      c.appendChild(group({ header, footer: 'The app’s controls are on the home network only.' }, rows));
      continue;
    }
    const send = (command, value, okText) => {
      hold(dv.id, command, value);
      return act(key, async () => {
        const r = await api('POST', '/api/devices/' + encodeURIComponent(dv.id) + '/app', value === undefined ? { command } : { command, value });
        if (r && r.status) took(dv.id, r); else readAgain(dv.id);     // unanswered (a reload, a restart): read it again
        return r;
      }, okText).then((ok) => { if (ok === false) readAgain(dv.id); return ok; });
    };
    const off = !live || !data.commands_on;
    // ALL TABLETS AND EACH ITS OWN: an option chosen here is this tablet's own (HK's app_options) and sent at once;
    // one it doesn't set follows All Tablets' (Mantel sends it within a minute: apps/tablet_app.py follow)
    const own = ctx.app_options || {};
    const sendAs = (command, value, okText) => {
      hold(dv.id, command, value);                                      // before the tablet's page saves and redraws
      if (FOLLOWED.includes(command) && typeof ctx.set === 'function') ctx.set({ app_options: { ...own, [command]: value } });
      return send(command, value, okText);
    };
    rows.push(K().toggle({ label: 'Screen', on: st.screen !== false, disabled: off, fk: 'mx:app-screen:' + dv.id,
                           onChange: (on) => send('screen', on, on ? 'Screen on.' : 'Screen off.') }));
    rows.push(K().slider({ label: 'Brightness', sk: 'mx:app-bright:' + dv.id, value: pct(st.brightness), min: 1, max: 100, step: 1, unit: '%',
                           onChange: (v) => send('brightness', Math.max(0.01, Math.min(1, v / 100)), null) }));
    rows.push(K().toggle({ label: 'Black Curtain', sub: 'Over the screen until somebody touches it', on: !!st.curtain, disabled: off,
                           fk: 'mx:app-curtain:' + dv.id, onChange: (on) => send('curtain', on, null) }));
    rows.push(K().toggle({ label: 'Kiosk Mode', sub: st.owner ? 'Pinned: nothing else can come to the front' : 'Brings the app back to the front when anything else comes up',
                           on: st.kiosk_mode !== false, disabled: off, fk: 'mx:app-kiosk:' + dv.id, onChange: (on) => sendAs('kiosk_mode', on, null) }));
    // SCREEN ROTATION (2026-11-13): Android 16 ignores the app's own landscape on a tablet, so the app sets Android's
    // rotation itself -- with Android's "Modify system settings" for the app, given once at the tablet
    const rot = st.rotation || 'auto';
    rows.push(K().seg({ label: 'Screen Rotation', sk: 'mx:app-rotation:' + dv.id, value: rot,
                        options: [['auto', 'Automatic'], ['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']],
                        onChange: (v) => send('rotation', v, v === 'auto' ? 'Left to the tablet.' : 'Turned to ' + v + '°.') }));
    if (rot !== 'auto' && st.rotation_allowed === false) rows.push(info('Rotation', NEEDS_WRITE, 'Not Allowed', 'warn'));
    optionRows(rows, st, sendAs, off, dv.id);
    // SKY DRAWN BY THE APP (phase 29): this tablet's own setting, HK's (hk_core tablet_rules.py app_sky), saved like
    // the rest of the tablet's page -- not a command to the app, which follows the page (hk-sky-handover.js)
    if (typeof ctx.set === 'function') {
      rows.push(K().toggle({ label: 'Sky Drawn by the App', on: ctx.app_sky === true, fk: 'mx:app-sky:' + dv.id,
                             sub: 'Bats, birds, rain, snow and the other busy skies drawn by the app itself, at 30 frames a second: ' +
                                  'about half the work for the tablet. Calm skies and wallpapers stay the page’s.',
                             onChange: (on) => ctx.set({ app_sky: on }) }));
    }
    rows.push(info('App', [st.owner ? 'Device owner' : st.admin ? 'Device admin' : 'No device role', st.esphome_port ? 'ESPHome port ' + st.esphome_port : null,
                           st.model || null].filter(Boolean).join(' · '), updateSays(st.update)));
    c.appendChild(group({ header, footer: (data.commands_on ? '' : 'House commands are off, so the app’s controls are too. ') +
      'Mantel reaches the app through the page the tablet has open, on the home network only; each change is in the Audit Log.' }, rows));
    result(c, key);
    if (typeof st.airplay === 'boolean') drawAirPlay(c, st, sendAs, off, dv.id);
    drawCopy(c, dv, st, got.data.devices, send, off);
    drawDebugging(c, st, send, off, dv.id);
    drawGraphics(c, st, sendAs, off, dv.id);
    drawOwn(c, ctx, own);
    const pic = pictures[dv.id] || {};
    const shot = pic.src ? hh('img', { src: pic.src, alt: 'What ' + dv.name + ' shows', class: 'mx-tablet-shot' }) : null;
    if (shot) Object.assign(shot.style, { display: 'block', width: '100%', aspectRatio: '16 / 10', objectFit: 'cover',
                                          borderRadius: '10px', background: '#000' });
    c.appendChild(group({ header: 'What’s on the Screen', footer: pic.err ? hh('span', { class: 'mxerr', text: pic.err })
      : pic.src ? 'Taken ' + new Date(pic.at).toLocaleTimeString([], { timeStyle: 'short' }) + '. Only when you ask; each one is in the Audit Log.'
      : 'A picture of the tablet’s screen as it is now, taken when you ask. Each one is in the Audit Log.' },
      [shot ? hh('div', { style: 'padding:12px 16px' }, [shot]) : null,
       button(pic.busy ? 'Taking a Picture…' : shot ? 'Take Another' : 'Show What’s on the Screen',
              () => { if (!pic.busy) takePicture(dv.id); }, { fk: 'mx:app-shot:' + dv.id })].filter(Boolean)));
    const d = draft(form);
    c.appendChild(group({}, [
      button('Reload Page', () => send('reload', undefined, 'Reloading.'), { fk: 'mx:app-reload:' + dv.id }),
      button('Clear Cache & Reload', () => send('clear_cache', undefined, 'Cleared and reloading.'), { fk: 'mx:app-clear:' + dv.id }),
      button('Restart the App', () => send('restart', undefined, 'Restarting.'), { fk: 'mx:app-restart:' + dv.id }),
      button('Check for an Update', () => send('check_update', undefined, 'Checked.'), { fk: 'mx:app-update:' + dv.id })]));
    c.appendChild(group({ footer: 'Seven quick taps in the tablet’s top-left corner open the app’s own menu. ' +
      (st.menu_pin ? 'It asks for this PIN now.' : 'Anyone can open it now: give it a PIN.') + ' Leave it empty for none.' }, [
      field(form, 'pin', 'Menu PIN', { type: 'password', inputmode: 'numeric', maxlength: 12, placeholder: st.menu_pin ? 'Set' : 'None' }),
      button('Save PIN', () => { const v = String(d.pin || '').replace(/\D/g, ''); d.pin = ''; send('menu_pin', v, v ? 'PIN saved.' : 'PIN removed.'); },
             { fk: 'mx:app-pin:' + dv.id })]));
  }
  return drew;
}
