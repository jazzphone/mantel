// settings/tablet-app.js -- Mantel Settings, a wall tablet running Mantel for Android: its status and its controls, on the
// home network (apps/tablet_app.py; docs/phase26/ANDROID-APP.md "Managing a tablet"). Mantel reaches the app through the
// page the tablet has open, so nothing listens on the tablet and there is no password of its own.
// @ts-check
import { act, api, can, K, load, me } from './core.js';
import { button, draft, field, group, info, result } from './kit.js';

const devicesRead = () => load('devices', () => api('GET', '/api/devices'));
const appRead = (id) => load('tablet-app:' + id, () => api('GET', '/api/devices/' + encodeURIComponent(id) + '/app'));
const pct = (v) => Math.round((v || 0) * 100);
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
          typeof st.battery === 'number' ? 'Battery ' + Math.round(st.battery) + '%' + (st.charging ? ', charging' : '') : null,
          st.ip || null].filter(Boolean).join(' · ');
}

// Returns true when it drew a tablet's app (its Direct Connection, Kiosk Satellite's and Fully's, is then left out)
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
    const send = (command, value, okText) => act(key, async () => {
      const r = await api('POST', '/api/devices/' + encodeURIComponent(dv.id) + '/app', value === undefined ? { command } : { command, value });
      return r;
    }, okText, key);
    const off = !live || !data.commands_on;
    rows.push(K().toggle({ label: 'Screen', on: st.screen !== false, disabled: off, fk: 'mx:app-screen:' + dv.id,
                           onChange: (on) => send('screen', on, on ? 'Screen on.' : 'Screen off.') }));
    rows.push(K().slider({ label: 'Brightness', sk: 'mx:app-bright:' + dv.id, value: pct(st.brightness), min: 1, max: 100, step: 1, unit: '%',
                           onChange: (v) => send('brightness', Math.max(0.01, Math.min(1, v / 100)), null) }));
    rows.push(K().toggle({ label: 'Black Curtain', sub: 'Over the screen until somebody touches it', on: !!st.curtain, disabled: off,
                           fk: 'mx:app-curtain:' + dv.id, onChange: (on) => send('curtain', on, null) }));
    rows.push(K().toggle({ label: 'Kiosk Mode', sub: st.owner ? 'Pinned: nothing else can come to the front' : 'Brings the app back to the front when anything else comes up',
                           on: st.kiosk_mode !== false, disabled: off, fk: 'mx:app-kiosk:' + dv.id, onChange: (on) => send('kiosk_mode', on, null) }));
    rows.push(info('App', [st.owner ? 'Device owner' : st.admin ? 'Device admin' : 'No device role', st.esphome_port ? 'ESPHome port ' + st.esphome_port : null,
                           st.model || null].filter(Boolean).join(' · '), updateSays(st.update)));
    c.appendChild(group({ header, footer: (data.commands_on ? '' : 'House commands are off, so the app’s controls are too. ') +
      'Mantel reaches the app through the page the tablet has open, on the home network only; each change is in the Audit Log.' }, rows));
    result(c, key);
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
