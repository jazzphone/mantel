// settings/general.js -- Mantel Settings, General: Mantel's own settings that were start-up options.
import { act, api, ask, K, load, redraw } from './core.js';
import { button, clearDraft, draft, failed, group, info, pending, result, screenOptions } from './kit.js';

// MANTEL'S OWN SETTINGS THAT WERE START-UP OPTIONS (server_settings.py): the same on the HA App, Docker and LXC.
// Owners and Admins see them; only an Owner changes them (a fresh factor away from home, and always to turn control
// on). Each change is audited and applies at once.
const serverSettings = () => load('server-settings', () => api('GET', '/api/admin/server-settings'));
const putServer = (key, value, okText) => act('server-settings', () => api('PUT', '/api/admin/server-settings', { key, value }),
                                              okText || 'Saved.', 'server-settings', 'about', 'dscreens');
const HOURS = [[1, '1 Hour'], [4, '4 Hours'], [8, '8 Hours'], [12, '12 Hours'], [24, '1 Day'], [72, '3 Days'], [168, '1 Week'],
               [336, '2 Weeks'], [720, '30 Days']];
const hoursLabel = (h) => { const x = HOURS.find(([v]) => v === h); return x ? x[1] : h + ' Hours'; };
export function pGeneral() {
  return { title: 'General', top: true, scope: 'How this Mantel runs the house. These are the same whether Mantel runs as a Home Assistant App, in Docker or on its own; only an Owner changes them, and every change is in the Audit Log.', body(c) {
    result(c, 'server-settings');
    const got = serverSettings();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data, v = (k) => d.settings[k].value, can = d.can_edit;
    const on = d.commands_on;
    c.appendChild(group({ header: 'House Control', footer: d.read_only_forced
      ? 'This Mantel was started read-only (the read_only option, MANTEL_READ_ONLY or --read-only), so nothing is sent to the house whatever is set here.'
      : 'On: signed-in people control the house within their roles, and every command is in the Audit Log; only the alarm asks for a code (the house Alarm PIN). Off: Mantel only shows the house. Turning it on always asks you to confirm it is you.' }, [
      K().toggle({ label: 'Allow Control of the House', on, disabled: !can || d.read_only_forced, fk: 'mx:commands',
        onChange: async (want) => {
          const sure = want
            ? await ask({ title: 'Allow control of the house?', message: 'Signed-in people can then control lights, locks, the alarm and everything else within their roles. Every command is audited.', ok: 'Allow' })
            : await ask({ title: 'Make the house read-only?', message: 'Nothing is sent to the house from Mantel until control is allowed again. Open pages reconnect.', ok: 'Make Read-Only', destructive: true });
          if (!sure) { redraw(); return; }
          putServer('commands_enabled', want, want ? 'Control of the house is allowed now.' : 'The house is read-only now.');
        } })]));
    const shown = d.screens || [];
    c.appendChild(group({ header: 'Screens', footer: 'Where Mantel opens for anyone who hasn’t chosen their own (Me, Opens On) and for wall tablets with none set.' }, [
      K().select({ label: 'House Default Screen', options: screenOptions(shown, 'First Screen'), value: v('default_screen') || '', disabled: !can,
                   fk: 'mx:house-screen', onChange: (x) => putServer('default_screen', x || '') })]));
    const hours = v('session_hours');
    const opts = HOURS.some(([h]) => h === hours) ? HOURS : HOURS.concat([[hours, hoursLabel(hours)]]).sort((a, b) => a[0] - b[0]);
    c.appendChild(group({ header: 'Sign-Ins', footer: 'How long a sign-in from outside the home network lasts before it asks again. New sign-ins get the new length. Home network sign-ins and Home Assistant’s sidebar are not affected.' }, [
      K().select({ label: 'Sign-Ins from Away Last', options: opts.map(([h, t]) => [String(h), t]), value: String(hours), disabled: !can,
                   fk: 'mx:session-hours', onChange: (x) => putServer('session_hours', Number(x)) })]));
    if (!can) c.appendChild(group({ footer: 'Only an Owner can change these.' }, []));
    else if (d.needs_fresh) c.appendChild(group({ footer: 'From outside the home network you will be asked to confirm it is you first.' }, []));
  } };
}
// On Home Assistant's connection page: where "Sign in with Home Assistant" goes, and what coming through Home
// Assistant counts as (its door rules)
const DOOR_RULES = [['trusted', 'Trusted'], ['lan', 'Home Network Rules'], ['tunnel', 'Away Rules']];
const SIGN_IN_FROM = { settings: 'Set here', ha_external: 'Home Assistant’s External URL', ha_internal: 'Home Assistant’s Internal URL' };
export function drawHaAccess(c) {
  const got = serverSettings();
  if (!got || got.err) return;
  const d = got.data, can = d.can_edit, f = draft('signin');
  const set = d.settings.ha_sign_in_url.value || '';
  if (f.url === undefined) f.url = set;
  const inUse = d.sign_in.address;
  const rows = [info('Sign-In Address in Use', inUse ? SIGN_IN_FROM[d.sign_in.from] : 'Set Home Assistant’s URL (Settings → System → Network), or set one here',
                     inUse ? inUse.replace(/^https?:\/\//, '') : 'None', inUse ? '' : 'warn')];
  if (can) {
    rows.push(K().text({ label: 'Sign-In Address', value: f.url, placeholder: d.sign_in.from && d.sign_in.from !== 'settings' ? inUse : 'https://ha.example.com',
                         maxlength: 300, inputmode: 'url', fk: 'mx:signin:url', onCommit: (x) => { f.url = x.trim(); } }));
    rows.push(button('Save', async () => { if (await putServer('ha_sign_in_url', f.url, f.url ? 'Sign-in address saved.' : 'Using Home Assistant’s own address.')) clearDraft('signin'); },
                     { fk: 'mx:signin:save' }));     // always on: the field commits on blur, with no redraw (an unchanged address is a no-op)
  }
  rows.push(K().select({ label: 'Coming Through Home Assistant', options: DOOR_RULES, value: d.settings.ha_door_rules.value, disabled: !can,
                         fk: 'mx:door-rules', onChange: (x) => putServer('ha_door_rules', x) }));
  c.appendChild(group({ header: 'Sign-In and Access', footer: 'Sign in with Home Assistant opens Home Assistant’s sign-in page at the address in use: the one set here, else Home Assistant’s own (Settings → System → Network). Leave it empty to use Home Assistant’s. ' +
    'Coming Through Home Assistant: Trusted means being signed in to Home Assistant is enough (each person’s Mantel role still decides what they may do); Home Network Rules and Away Rules treat Home Assistant’s sidebar like the home network or like a sign-in from away.' }, rows));
}
