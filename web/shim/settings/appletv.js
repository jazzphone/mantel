// @ts-check
// settings/appletv.js -- Notifications on the Apple TVs (docs/phase31/PLAN.md "In Settings"; features/tv_alerts.py).
//
// A notification whose Apple TV switch is on is drawn as a picture by Mantel and shown in the corner of every Apple TV, by a
// HomeKit camera Mantel Link adds to Home Assistant's HomeKit Bridge. This file draws:
//
// * the page, #/mantel/apple-tv: Show on Apple TV, HomeKit (Add to HomeKit, the code to scan, Paired, Remove from HomeKit),
//   the look with a preview, Use Camera Picture, Follows Do Not Disturb, Send Test, and which notifications go;
// * a row on HK's Notifications page leading here (extend 'notify'), and each notification's Apple TV switch and look on its
//   own page (extend 'notify-item').
//
// The options are the notifications feature's own (`tv` in its options, `tv` and `tv_look` on each notification), saved the way
// HK's Notifications page saves them (the panel's featSet / featCall). HomeKit, the preview and Send Test are Mantel's routes
// (/api/tv_alerts), which decide who may use them. Every notification starts off: a doorbell already in HomeKit shows on the
// Apple TV by itself.
import { mantelUrl } from '../base.js';
import { act, api, ask, cache, hh, K, load, panel, redraw, ROUTE } from './core.js';
import { button, failed, group, info, nav, pending, result } from './kit.js';

export const SECTION = 'apple-tv';
const HOME = '#/' + ROUTE + '/' + SECTION;
const NT = 'hk_notify';
const LOOKS = [['color', 'Color', 'The accessory’s own color, white on top'], ['black', 'Black', 'Black, the glyph in its color'],
               ['glass', 'Glass', 'Your background under dark glass']];
const LOOK_WORD = { color: 'Color', black: 'Black', glass: 'Glass' };
const DOORBELL = 'A doorbell already in HomeKit shows on the Apple TV by itself: turn one on here only if it isn’t.';
let previewAt = Date.now();
let lookAgain = 0;

const readStatus = () => load('appletv', () => api('GET', '/api/tv_alerts'));
const notify = () => (panel && panel.feat ? panel.feat(NT) : null) || {};
const tvOf = (o) => Object.assign({ on: false, look: 'color', camera: true, dnd: true }, (o && o.tv) || {});
const setTv = (ch) => (panel ? panel.featSet(NT, { tv: ch }) : Promise.resolve(false));
const saveItem = (id, ch) => (panel ? panel.featCall(NT, { type: 'hk_notify/item/save', item: id, changes: ch }, Object.keys(ch)) : Promise.resolve(false));
const titleOf = (it) => (it.title || '').trim() || it.auto_title || it.name || it.entity || 'Notification';

// ============================================================================================ HK's Notifications page
export function drawNotifyTv(c, ctx) {
  const tv = tvOf({ tv: ctx && ctx.tv });
  c.appendChild(group({ header: 'Apple TV', footer: 'The notifications you choose, as a picture in the corner of every Apple TV.' }, [
    nav('Apple TV', SECTION, { value: tv.on ? 'On' : 'Off', tile: ['mdi:television', '#000000'], fk: 'mx:appletv:row' })]));
}

// ============================================================================================ one notification's page
export function drawItemTv(c, ctx) {
  const it = ctx && ctx.item;
  if (!it) return;
  const tv = tvOf({ tv: ctx.tv });
  const rows = [K().toggle({ label: 'Show on Apple TV', on: !!it.tv, fk: 'mx:appletv:item:' + it.id,
    sub: tv.on ? null : 'Apple TV notifications are off for the house',
    onChange: (on) => ctx.save({ tv: on }) })];
  if (it.tv) {
    rows.push(K().select({ label: 'Look', value: it.tv_look || '', fk: 'mx:appletv:look:' + it.id,
      options: [['', 'Automatic (' + LOOK_WORD[tv.look] + ')']].concat(LOOKS.map((l) => [l[0], l[1]])),
      onChange: (v) => ctx.save({ tv_look: v || null }) }));
  }
  const footer = it.kind === 'doorbell' ? DOORBELL : 'Drawn as a picture in the corner of every Apple TV when it goes off.';
  rows.push(nav('Apple TV Settings', SECTION, { fk: 'mx:appletv:go:' + it.id }));
  c.appendChild(group({ header: 'Apple TV', footer }, rows));
}

// ============================================================================================ the page
export function pAppleTv() {
  return { title: 'Apple TV',
    scope: 'Notifications in the corner of every Apple TV, drawn by Mantel and shown by HomeKit.',
    back: ['Notifications', '#/features/notify'],
    body(c) {
      result(c, 'appletv');
      const got = readStatus();
      const feat = notify();
      if (!got || (!feat.data && feat.loading !== false)) { pending(c); return; }
      if (got.err) { failed(c, got.err); return; }
      const s = got.data, d = feat.data || { options: {}, items: [] };
      const tv = tvOf(d.options);
      drawSwitch(c, s, tv);
      drawHomeKit(c, s);
      drawLook(c, s, tv);
      drawWhen(c, s, tv);
      drawWhich(c, d, tv);
      keepLooking(s);
    } };
}

function drawSwitch(c, s, tv) {
  const rows = [K().toggle({ label: 'Show on Apple TV', on: tv.on, fk: 'mx:appletv:on', onChange: (on) => setTv({ on }) })];
  let footer = 'The notifications chosen below show in the corner of every Apple TV in your home, over whatever is playing. Each Apple TV ' +
    'shows camera alerts unless its own settings turn them off.';
  if (s.renderer) footer = 'Mantel can’t draw the pictures here (' + s.renderer + '). ' + footer;
  c.appendChild(group({ footer }, rows));
}

function drawHomeKit(c, s) {
  const hk = s.homekit || { state: 'none' };
  const rows = [];
  let footer = '';
  if (!s.homekit_wanted) {
    rows.push(button('Add to HomeKit', () => homekit(true), { fk: 'mx:appletv:add' }));
    footer = 'Mantel Link adds a camera named Mantel Alerts to Home Assistant’s HomeKit Bridge, with a motion sensor that Mantel turns ' +
      'on for each notification. Nothing else changes in Home Assistant.';
  } else if (hk.state === 'unpaired') {
    rows.push(hh('div', { class: 'cell mxqr' }, [hh('img', { alt: 'HomeKit setup code for Mantel Alerts',
      src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(hk.qr || '') })]));
    rows.push(info('Setup Code', 'In the Home app: +, Add Accessory, then scan the code or type it', hk.code || ''));
    footer = 'Waiting for the Home app. Once it is added, put Mantel Alerts in a room; Settings says Paired here.';
  } else if (hk.state === 'paired') {
    rows.push(info('Mantel Alerts', 'In HomeKit', 'Paired'));
    footer = 'Phones with this camera’s notifications on in the Home app get the same picture. If you already get Mantel’s own ' +
      'notification, turn this camera’s notifications off there.';
  } else if (hk.state === 'error') {
    rows.push(info('Mantel Alerts', hk.error || 'Home Assistant refused it', 'Not Added', 'warn'));
    footer = 'Mantel Link tries again when anything changes. Home Assistant’s log says more.';
  } else {
    rows.push(info('Mantel Alerts', s.linked ? 'Home Assistant is adding it' : 'Waiting for Mantel Link', 'Adding…'));
    footer = s.linked ? 'If this stays, the code to scan is in Home Assistant’s notifications (HomeKit Pairing).'
      : 'Mantel Link publishes Mantel’s entities in Home Assistant while Mantel runs the house. Connections, Home Assistant, says how it stands.';
  }
  if (s.homekit_wanted) {
    rows.push(button('Remove from HomeKit…', async () => {
      const yes = await ask({ title: 'Remove Mantel Alerts from HomeKit?', ok: 'Remove', destructive: true,
        message: 'The Apple TVs stop showing notifications. Adding it again needs the Home app’s code again.' });
      if (yes) homekit(false);
    }, { destructive: true, fk: 'mx:appletv:remove' }));
  }
  c.appendChild(group({ header: 'HomeKit', footer }, rows));
}

function homekit(want) {
  return act('appletv', () => api('POST', '/api/tv_alerts/homekit', { want }), want ? 'Adding to HomeKit.' : 'Removed from HomeKit.', 'appletv');
}

function drawLook(c, s, tv) {
  const rows = LOOKS.map(([key, label, sub]) => K().check({ label, sub, on: tv.look === key, fk: 'mx:appletv:look:' + key,
    onClick: () => { previewAt = Date.now(); setTv({ look: key }); } }));
  rows.push(hh('div', { class: 'cell mxtvpreview' }, [hh('img', { alt: 'A notification as the Apple TVs show it, in the ' + LOOK_WORD[tv.look] + ' look',
    src: mantelUrl('/api/tv_alerts/preview?look=' + tv.look + '&at=' + previewAt), loading: 'lazy',
    style: 'display:block;width:100%;aspect-ratio:16/9;border-radius:12px;background:#000' })]));
  rows.push(K().toggle({ label: 'Use Camera Picture', sub: 'A doorbell or a camera’s notification shows its snapshot', on: tv.camera,
    fk: 'mx:appletv:camera', onChange: (on) => setTv({ camera: on }) }));
  const type = s.apple_font ? 'SF Pro' : 'Inter (add SF Pro in Your Files for Apple’s own)';
  const glyphs = s.apple_glyphs ? 'your SF Symbols' : 'Mantel’s own glyphs (add hk-glyphs.js in Your Files for SF Symbols)';
  c.appendChild(group({ header: 'Look', footer: 'Each notification can choose its own look on its page. Drawn with ' + type + ' and ' + glyphs + '.' }, rows));
}

function drawWhen(c, s, tv) {
  const last = (s.sent || []).slice(-1)[0];
  const rows = [K().toggle({ label: 'Follows Do Not Disturb', sub: 'Only Important notifications show during Do Not Disturb', on: tv.dnd,
    fk: 'mx:appletv:dnd', onChange: (on) => setTv({ dnd: on }) })];
  rows.push(button('Send Test', () => act('appletv', () => api('POST', '/api/tv_alerts/test', {}), 'Sent to the Apple TVs.', 'appletv'),
    { fk: 'mx:appletv:test' }));
  if (last) rows.push(info('Last Shown', last.title || '', last.ok ? new Date(last.at * 1000).toLocaleTimeString([], { timeStyle: 'short' }) : 'Failed',
    last.ok ? '' : 'warn'));
  const footer = (s.homekit || {}).state === 'paired' ? 'Send Test shows a card on the Apple TVs now.'
    : 'Send Test works once Mantel Alerts is paired in the Home app.';
  c.appendChild(group({ footer }, rows));
}

function drawWhich(c, d, tv) {
  const items = d.items || [];
  const rows = items.map((it) => K().toggle({ label: titleOf(it), sub: it.tv && it.tv_look ? LOOK_WORD[it.tv_look] : null, on: !!it.tv,
    tile: [it.icon || 'hk:bell', it.tint || '#8e8e93'], fk: 'mx:appletv:which:' + it.id,
    onChange: (on) => saveItem(it.id, { tv: on }) }));
  if (!rows.length) rows.push(info('No notifications yet', 'Add them in Notifications', ''));
  c.appendChild(group({ header: 'Notifications on Apple TV', footer: (tv.on ? '' : 'Off for the house: none show until Show on Apple TV is on. ') +
    'All start off. ' + DOORBELL }, rows));
}

// while HomeKit is being added or waits for the Home app, the page looks again every few seconds -- keeping what it shows
// (the code being scanned) until the new answer replaces it
function keepLooking(s) {
  const st = (s.homekit || {}).state;
  if (!s.homekit_wanted || st === 'paired' || st === 'error') return;
  const n = ++lookAgain;
  setTimeout(() => {
    if (n !== lookAgain || !location.hash.startsWith(HOME)) return;
    api('GET', '/api/tv_alerts').then((data) => { cache.appletv = { data }; redraw(); }, () => {});
  }, 5000);
}
