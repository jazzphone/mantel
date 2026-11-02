// settings/protect.js -- Mantel Settings, Connections, UniFi Protect: the console's address and API key, its pinned
// certificate, its cameras (picked, matched with Home Assistant's, Video From), each camera's Notify For and Turn On in
// Protect (docs/phase13/CAMERAS-DIRECT.md phase 4; protect_connector.py). Docker and the LXC only: under the Home
// Assistant App the page says cameras come from Home Assistant's UniFi Protect integration.
import { mantelUrl } from '../base.js';
import { act, ago, api, ask, fmt, forget, hh, K, load, redraw, ROUTE, shown, ui } from './core.js';
import { button, clearDraft, draft, failed, field, group, info, nav, pending, result } from './kit.js';

const BACK = ['Connections', '#/' + ROUTE + '/connections'];
const HOME = ['UniFi Protect', '#/' + ROUTE + '/connections/protect'];
const CAMS = ['Cameras', '#/' + ROUTE + '/connections/protect/cameras'];
const HA_DOCS = 'https://www.home-assistant.io/integrations/unifiprotect/';
const KIND_LABEL = { ring: 'Doorbell Rings', person: 'Person', vehicle: 'Vehicle', animal: 'Animal', package: 'Package', motion: 'Motion' };
const SIGNIN = { api_key: 'API Key', api_key_and_local_user: 'API Key and a Local User' };

// a fingerprint as people compare it: pairs of hex digits, in groups
export const pretty = (fp) => ((fp || '').toUpperCase().match(/.{1,2}/g) || []).join(':');
const link = (href, text) => hh('a', { href, target: '_blank', rel: 'noopener', text });

// THE ROW ON CONNECTIONS: its state in one word, as Home Assistant's and Music Assistant's rows have
export function protectRow() {
  const got = load('protect', () => api('GET', '/api/protect'));
  const p = got && got.data && got.data.protect;
  const value = !p ? undefined : !p.runs ? (got.data.app_mode ? 'From Home Assistant' : 'Not Available')
    : !p.set ? 'Not Set Up' : p.connected && p.events.connected ? 'Connected' : 'Not Connected';
  return nav('UniFi Protect', 'connections/protect', { value, icon: 'mdi:cctv',
    sub: p && !p.runs ? 'Cameras come from Home Assistant’s UniFi Protect integration' : 'Cameras, the doorbell and its detections, straight from the console' });
}

export function pProtect(sub) {
  if (sub[0] === 'cameras') return sub[1] ? pCamera(sub[1]) : pCameras();
  return { title: 'UniFi Protect', back: BACK, scope: 'Mantel talks to your UniFi Protect console itself: its cameras, their stills, the doorbell, its speaker and what each camera detects. The API key is kept sealed in Mantel’s data, never shown again and never leaves the server.', body(c) {
    result(c, 'protect');
    const got = load('protect', () => api('GET', '/api/protect'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const p = got.data.protect, can = got.data.can_edit;
    if (!p.runs) {
      c.appendChild(group({ footer: hh('span', {}, [got.data.app_mode
        ? 'Mantel runs as a Home Assistant App, so cameras come from Home Assistant’s '
        : 'This Mantel has no go2rtc of its own, so cameras come from Home Assistant’s ',
        link(HA_DOCS, 'UniFi Protect integration'), '. Nothing to set up here.']) },
        [info('UniFi Protect', null, got.data.app_mode ? 'From Home Assistant' : 'Not Available')]));
      return;
    }
    drawStatus(c, p);
    if (p.set) c.appendChild(group({ footer: 'Pick the cameras Mantel uses. A camera Home Assistant has too shows once, as Home Assistant’s.' },
      [nav('Cameras', 'connections/protect/cameras', { icon: 'mdi:cctv', value: p.picked + ' of ' + p.cameras })]));
    if (!can) { c.appendChild(group({ footer: 'Only an Owner can change this connection.' }, [])); return; }
    drawTrust(c, p);
    drawEdit(c, p, got.data.needs_fresh);
  } };
}

// HEALTH, as the other connections' pages: the status line, then what is known of the console
function drawStatus(c, p) {
  const s = p.saved, ev = p.events || {};
  const live = p.connected && ev.connected;
  const rows = [info('Status', null, !p.set ? 'Not Set Up' : live ? 'Connected' : 'Not Connected', live ? '' : 'warn')];
  if (s) {
    if (s.console_name) rows.push(info('Console', null, s.console_name));
    rows.push(info('Address', null, s.host));
    if (s.version) rows.push(info('UniFi Protect', null, s.version));
    rows.push(info('Signed In With', s.local_user ? 'Local user ' + s.local_user + ' (kept, used by nothing yet)' : null, SIGNIN[s.signin] || s.signin));
    rows.push(info('Events', ev.connected ? (ev.last_message_at ? 'Last spoke ' + ago(ev.last_message_at) : 'Nothing yet') : ev.last_error || null,
                   ev.connected ? 'Connected' : 'Not Connected', ev.connected ? '' : 'warn'));
    rows.push(info('Certificate', pretty(s.fingerprint), 'Trusted'));
    rows.push(info('Connected', 'Since ' + fmt(s.since) + (s.by_name ? ' · set by ' + s.by_name : ''), ''));
  }
  const notes = [];
  if (p.set && p.error) notes.push('Not connected: ' + p.error);
  if (p.unreadable) notes.push('Mantel’s saved connection could not be opened (was the at-rest key changed?). Connect it again.');
  if (p.set) notes.push('The console allows ten requests a second; Mantel paces itself under that and shares stills between screens.');
  c.appendChild(group({ footer: notes.join(' ') || null }, rows));
}

// A CHANGED CERTIFICATE: the connection stops until an Owner trusts the new one, by its fingerprint
function drawTrust(c, p) {
  const seen = shown['protect:changed'];
  const fp = (seen && seen.fingerprint) || p.seen_fingerprint;
  if (!fp || !p.set) return;
  const rows = [info('New Certificate', pretty(fp), 'Not Trusted', 'warn')];
  rows.push(button('Trust This Certificate…', async () => {
    if (!(await ask({ title: 'Trust the new certificate?', message: 'Only if you replaced or reset the console. Otherwise something else may be answering at ' + p.saved.host + '. Its fingerprint is ' + pretty(fp) + '.', ok: 'Trust', destructive: true }))) return;
    if (await act('protect', () => api('POST', '/api/protect/trust', { fingerprint: fp }), 'The new certificate is trusted.', 'protect', 'protect-cams')) delete shown['protect:changed'];
  }, { destructive: true, fk: 'mx:protect-trust' }));
  c.appendChild(group({ header: 'The Console’s Certificate Changed', footer: 'Mantel stopped talking to the console: its certificate is not the one Mantel trusted. If you replaced or reset the console, compare the fingerprint with the one UniFi OS shows and trust it. If you did not, do not.' }, rows));
}

function drawEdit(c, p, needsFresh) {
  const d = draft('protect');
  const out = shown['test:protect'];
  if (p.set && !d.open) {
    c.appendChild(group({}, [button('Replace…', () => { d.open = true; d.host = d.host || p.saved.host; redraw(); }, { fk: 'mx:protect-replace' }),
      button('Disconnect…', async () => {
        if (!(await ask({ title: 'Disconnect UniFi Protect?', message: 'Mantel forgets the API key and stops using the console. The cameras picked here are removed from Mantel. To revoke the key in UniFi OS as well: Settings, Control Plane, Integrations, delete it.', ok: 'Disconnect', destructive: true }))) return;
        act('protect', () => api('DELETE', '/api/protect'), 'UniFi Protect disconnected.', 'protect', 'protect-cams', 'connections');
      }, { destructive: true, fk: 'mx:protect-disconnect' })]));
    return;
  }
  const body = () => {
    const b = { host: (d.host || '').trim(), api_key: (d.key || '').trim() };
    if (d.advanced && ((d.user || '').trim() || d.password)) { b.username = (d.user || '').trim(); b.password = d.password || ''; }
    return b;
  };
  const said = (e) => {
    if (e && e.code === 'certificate_changed' && e.data && e.data.fingerprint) shown['protect:changed'] = { fingerprint: e.data.fingerprint };
    shown['test:protect'] = { text: e.message, err: true };
  };
  const test = async () => {
    shown['test:protect'] = { text: 'Testing…' }; redraw();
    try {
      const r = (await api('POST', '/api/protect/test', body())).result;
      shown['test:protect'] = { text: 'It works: ' + [r.console_name, 'UniFi Protect ' + r.version, r.cameras + ' cameras'].filter(Boolean).join(' · ') +
        '. ' + (r.first ? 'Its certificate, ' + pretty(r.fingerprint) + ', is trusted when you connect.' : 'Its certificate is the one trusted.') };
    } catch (e) { said(e); }
    redraw();
  };
  const save = async () => {
    shown['test:protect'] = { text: 'Checking and connecting…' }; redraw();
    try {
      await api('POST', '/api/protect', body());
      clearDraft('protect'); delete shown['test:protect']; delete shown['protect:changed'];
      ui.flash = { key: 'protect', text: 'UniFi Protect connected.' };
      forget('protect', 'protect-cams');
    } catch (e) { said(e); }
    redraw();
  };
  c.appendChild(group({ header: 'Console', footer: 'Recommended: in UniFi OS, make a local user named Mantel (Admins & Users), sign in to UniFi OS as that user, and make the key there: Settings, Control Plane, Integrations, Create API Key. Your own account then never signs in for Mantel. Whether a key stops working when its user is removed is not confirmed yet, so to cut Mantel off, delete the key.' }, [
    field('protect', 'host', 'Address', { maxlength: 255, inputmode: 'url', value: (p.saved && p.saved.host) || '', placeholder: 'unifi.local' }),
    field('protect', 'key', 'API Key', { type: 'password', maxlength: 4096 })]));
  const adv = [K().toggle({ label: 'Advanced: a Local User', sub: 'Off unless a feature needs it; nothing does today', on: !!d.advanced, fk: 'mx:protect-adv',
    onChange: (v) => { d.advanced = v; redraw(); } })];
  if (d.advanced) adv.push(field('protect', 'user', 'User Name', { maxlength: 128 }), field('protect', 'password', 'Password', { type: 'password', maxlength: 1024 }));
  c.appendChild(group({ footer: 'A local UniFi OS user only: UI.com cloud accounts and accounts with MFA can’t be used. It is kept sealed beside the key and used by nothing yet; the API key is all Mantel needs.' }, adv));
  c.appendChild(group({ footer: 'Connect checks, in order: the address answers as a UniFi OS console, its certificate (trusted the first time, then held to), the key, and UniFi Protect 7.2.105 or later.' +
    (needsFresh ? ' From outside the home network you will be asked to confirm it is you first.' : '') },
    [button('Test', test, { fk: 'mx:protect-test' }), button('Connect', save, { fk: 'mx:protect-save' })]));
  if (out) c.appendChild(hh('p', { class: 'mxflash' + (out.err ? ' err' : ''), role: out.err ? 'alert' : 'status', text: out.text }));
  if (p.set) c.appendChild(group({}, [button('Cancel', () => { clearDraft('protect'); delete shown['test:protect']; redraw(); }, { fk: 'mx:protect-cancel' })]));
}

// ---------------------------------------------------------------------------------------- the cameras
const STYLE = '.mxcam{display:flex;align-items:center;gap:12px}.mxcam img{width:96px;height:54px;object-fit:cover;border-radius:6px;background:var(--hk-fill);flex:none}' +
  '.mxcam .t{flex:1;min-width:0}.mxcam .n{font-size:17px;color:var(--hk-label)}.mxcam .s{font-size:13px;color:var(--hk-label2)}.mxcam .v{color:var(--hk-label2)}' +
  '.cell.mxbig{display:block;padding:0}.cell.mxbig img{display:block;width:100%;height:auto;border-radius:10px;background:var(--hk-fill)}';
// (a still the console could not give leaves an empty frame, not a broken picture)
const still = (id, cls) => hh('img', { class: cls, alt: '', loading: 'lazy', src: mantelUrl('/api/protect/cameras/' + encodeURIComponent(id) + '/still'),
                                       onerror: (e) => { e.target.style.visibility = 'hidden'; } });

function camSays(x) {
  return [x.model, x.online ? null : 'Offline', x.matched ? 'Also in Home Assistant' : null].filter(Boolean).join(' · ');
}

function pCameras() {
  return { title: 'Cameras', back: HOME, scope: 'The console’s cameras. Pick the ones Mantel uses: each then plays from Mantel’s own go2rtc, its still comes from the console, and its detections become Mantel’s notifications.', body(c) {
    result(c, 'protect-cams');
    const got = load('protect-cams', () => api('GET', '/api/protect/cameras'));
    if (!got) { pending(c, 'Asking the console for its cameras…'); return; }
    if (got.err) { failed(c, got.err); return; }
    c.appendChild(hh('style', { text: STYLE }));
    const list = got.data.cameras;
    if (!list.length) { c.appendChild(group({ footer: got.data.error || 'The console lists no cameras.' }, [])); return; }
    const row = (x) => hh('a', { class: 'cell mxcam', href: '#/' + ROUTE + '/connections/protect/cameras/' + encodeURIComponent(x.id), 'data-fk': 'mx:protect-cam:' + x.id }, [
      still(x.id), hh('span', { class: 't' }, [hh('div', { class: 'n', text: x.name }), hh('div', { class: 's', text: camSays(x) })]),
      hh('span', { class: 'v', text: x.picked ? 'In Use' : '' })]);
    const used = list.filter((x) => x.picked), rest = list.filter((x) => !x.picked);
    if (used.length) c.appendChild(group({ header: 'In Use' }, used.map(row)));
    if (rest.length) c.appendChild(group({ header: used.length ? 'Not in Use' : 'On the Console' }, rest.map(row)));
  } };
}

function pCamera(id) {
  const got = load('protect-cams', () => api('GET', '/api/protect/cameras'));
  const x = got && got.data && got.data.cameras.find((y) => y.id === id);
  const set = (body, okText) => act('protect-cam', () => api('PUT', '/api/protect/cameras/' + encodeURIComponent(id), body), okText, 'protect-cams', 'protect');
  return { title: x ? x.name : 'Camera', back: CAMS, body(c) {
    result(c, 'protect-cam');
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    if (!x) { c.appendChild(group({ footer: 'The console no longer lists this camera.' }, [])); return; }
    c.appendChild(hh('style', { text: STYLE }));
    c.appendChild(group({ footer: camSays(x) || null }, [hh('div', { class: 'cell mxbig' }, [still(x.id)])]));
    const use = [K().toggle({ label: 'Use in Mantel', on: x.picked, fk: 'mx:protect-use', onChange: (v) => set({ use: v }, v ? 'In use.' : 'No longer used.') })];
    if (x.picked && !x.matched) {
      use.push(K().select({ label: 'Room', options: [['', 'None']].concat(got.data.areas), value: x.area_id || '', fk: 'mx:protect-area',
        onChange: (v) => set({ area_id: v || null }, 'Saved.') }));
      use.push(info('Entity', null, x.entity_id));
    }
    c.appendChild(group({ footer: x.picked && x.matched ? null : x.picked ? 'A camera of Mantel’s own: name it in UniFi Protect, pick its room here.' : 'Not used: Mantel asks the console for its streams when you turn it on.' }, use));
    if (!x.picked) return;
    if (x.matched) {
      c.appendChild(group({ header: 'Also in Home Assistant', footer: 'Shown once, as Home Assistant’s camera, with its name and room, and the same people may see it. Direct plays it and draws its stills from the console through Mantel; Home Assistant plays it through Home Assistant as before.' }, [
        info('Home Assistant’s Camera', null, x.matched),
        K().select({ label: 'Video From', options: [['direct', 'Direct'], ['ha', 'Home Assistant']], value: x.video_from, fk: 'mx:protect-video',
          onChange: (v) => set({ video_from: v }, 'Saved.') })]));
    }
    const notify = x.kinds.map((k) => {
      const off = x.off_in_protect.includes(k);
      return K().toggle({ label: KIND_LABEL[k] || k, sub: off ? 'Off in UniFi Protect' : null, on: x.notify.includes(k) && !off, disabled: off, fk: 'mx:protect-notify:' + k,
        onChange: (v) => set({ notify: v ? x.notify.concat([k]) : x.notify.filter((y) => y !== k) }, 'Saved.') });
    });
    for (const k of x.off_in_protect) notify.push(button('Turn On ' + (KIND_LABEL[k] || k) + ' in Protect…', async () => {
      if (!(await ask({ title: 'Turn on ' + (KIND_LABEL[k] || k).toLowerCase() + ' detection?', message: 'Only this camera’s own setting in UniFi Protect changes; nothing else is switched off.', ok: 'Turn On' }))) return;
      act('protect-cam', () => api('POST', '/api/protect/cameras/' + encodeURIComponent(id) + '/turn-on', { types: [k] }), 'Turned on in UniFi Protect.', 'protect-cams');
    }, { fk: 'mx:protect-turn-on:' + k }));
    c.appendChild(group({ header: 'Notify For', footer: (x.motion_only ? 'This camera has no smart detection: its own motion detection is what it reports. ' : 'The camera’s own detection, nothing of Mantel’s. ') +
      'Which of these become notifications and doorbell pop-ups follows Notifications (Doorbells, Packages, Cameras). Zones, sensitivity and privacy masks are set in UniFi Protect’s app.' }, notify));
    if (x.talk_speaker) c.appendChild(group({ header: 'Talking at the Door', footer: 'Mantel talks to the doorbell itself. Name this speaker in the doorbell pop-up’s settings to talk from the doorbell sheet. Talking needs HTTPS: see About, Secure Connection.' },
      [info('Speaker', null, x.talk_speaker)]));
  } };
}
