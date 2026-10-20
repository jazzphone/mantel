// mantel-settings.js -- Mantel's own pages in Mantel Settings (HK's settings panel with Mantel's host).
//
// The panel (web/hk/panels/hk-settings.js) asks its host for pages of its own (hkShell.settingsHost(),
// "THE HOST'S SETTINGS" there); this is Mantel's answer: Me, People, Devices, Roles & Grants, Service
// Accounts, Audit Log, Connections, Mantel Connect and Your Files (with Photos, mantel-photos.js), every one drawn with HK Settings' own kit
// (hk-settings-kit.js: iOS Settings, docs/DESIGN.md "HK Settings stays iOS Settings"). Only Mantel loads
// this file; Home Assistant's build never ships web/shim, so none of it exists in HK Frontend inside HA.
//
// It only calls the REST routes /admin used (docs/phase3/ADMIN-PAGE.md); the server decides who may do what.
// Which pages show is GET /api/admin/overview's `sections` (admin_page.sections_for: the same checks as the
// routes behind them). A credential shown once (a service account's, a pairing code) lives only in this
// module until it is dismissed or the page is left; nothing is stored.
import { mantelUrl, base as BASE } from './base.js';
import * as photos from './mantel-photos.js';

const ROUTE = 'mantel';
const C = { blue: '#007aff', green: '#34c759', indigo: '#5856d6', orange: '#ff9500', pink: '#ff2d55', purple: '#af52de',
            red: '#ff3b30', teal: '#30b0c7', gray: '#8e8e93', yellow: '#ffcc00', brown: '#a2845e' };
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', adult: 'Adult', child: 'Child', guest: 'Guest', wall_tablet: 'Wall Tablet',
                     service: 'Service' };
const roleLabel = (r) => ROLE_LABEL[r] || r;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// the pages, in the sidebar's order: [section, title, icon, color, place, group header]
const PAGES = [
  ['me', 'Me', 'mdi:account-circle', C.gray, 'top'],
  ['people', 'People', 'mdi:account', C.blue, 'end', 'People & Access'],
  ['devices', 'Devices', 'mdi:tablet', C.teal, 'end', 'People & Access'],
  ['roles', 'Roles & Grants', 'mdi:shield-lock', C.indigo, 'end', 'People & Access'],
  ['service', 'Service Accounts', 'mdi:key-variant', C.brown, 'end', 'People & Access'],
  ['audit', 'Audit Log', 'mdi:history', C.gray, 'end', 'People & Access'],
  ['connections', 'Connections', 'mdi:lan', C.green, 'end', 'Mantel'],
  ['connect', 'Mantel Connect', 'mdi:link-variant', C.orange, 'end', 'Mantel'],
  ['files', 'Your Files', 'mdi:folder', C.purple, 'end', 'Mantel'],
  ['about', 'About', 'mdi:information-outline', C.gray, 'end', 'Mantel'],
];
// Photos is inside Your Files (#/mantel/files/photos): its old addresses forward there
const ERRORS = {
  invalid_credentials: 'That did not match.', invalid_code: 'That code was not accepted.',
  too_many_attempts: 'Too many tries. Wait a little and try again.', username_taken: 'That user name is already taken.',
  username_invalid: 'User names are 1 to 64 letters, digits, dots, dashes or underscores.',
  last_owner: 'There must always be at least one enabled Owner.', forbidden: 'You are not allowed to do that.',
  owner_only: 'Only an Owner can do that.', lan_only: 'This can only be done on the home network.',
  already_a_device: 'This browser is already a wall tablet.', not_found: 'That no longer exists.',
  step_up_required: 'Confirm it is you first.', pin_unavailable: 'That PIN cannot be used. Pick another.',
  origin_not_allowed_for_passkeys: 'Passkeys need the name you use to reach Mantel, not an IP address.',
  csrf: 'The page lost its session token. Reload and try again.',
  audit_unavailable: 'The audit log is unavailable, so nothing was changed.',
  own_password: 'Change your own password in Me, with your current one.',
  no_mantel_password: 'This person signs in with Home Assistant, not a Mantel password.',
};

// The words Mantel puts on HK's own pages where Mantel differs (the panel's host notes)
const NOTES = {
  overview: 'This is Mantel’s copy of HK’s settings, imported from Home Assistant once. Changes here affect Mantel’s ' +
    'screens only, not HK inside Home Assistant. Anything that needs Home Assistant to be written (tablets as Home ' +
    'Assistant devices, dashboards, accessory setup flows) is read-only here; saving one says why it was refused.',
  screen_remove: 'Mantel keeps its own copy of this screen’s settings. Removing a screen needs Home Assistant, so it isn’t offered here.',
  add_screen: 'A new screen is a new dashboard in Home Assistant, which Mantel doesn’t write to. Add it in HK Settings ' +
    'inside Home Assistant; Mantel’s own screens are listed under Screens.',
};

// ---------------------------------------------------------------------------------------- state
let me = null;              // GET /api/admin/overview
let skew = 0;
let panel = null;           // the settings panel drawing us (its render, status, shadowRoot)
let enrolled = false;       // this browser just became a wall tablet: nothing else is shown
const cache = {};           // key -> { data } | { err } | { loading: true }
const drafts = {};          // a form's fields as typed (K.text commits on blur/Return)
const shown = {};           // a credential or code shown once, by page
let flash = null;           // { key, text, err }: the result of the last action, on its page

const K = () => window.hkSettingsKit;
const hh = (tag, attrs, kids) => K().h(tag, attrs, kids);
const nowS = () => Date.now() / 1000 + skew;
const fmt = (t) => (t ? new Date(t * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');
const fmtFull = (t) => (t ? new Date(t * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) : '');
function ago(t) {
  if (!t) return 'never';
  const s = Math.max(0, nowS() - t);
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 129600) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
function shortUA(ua) {
  if (!ua) return 'A Browser';
  const os = /iPhone|iPad|Android|Mac OS X|Windows|Linux/.exec(ua);
  const br = /Edg\/|Firefox\/|Chrome\/|Safari\//.exec(ua);
  const name = br ? { 'Edg/': 'Edge', 'Firefox/': 'Firefox', 'Chrome/': 'Chrome', 'Safari/': 'Safari' }[br[0]] : 'Browser';
  return name + (os ? ' on ' + os[0].replace('Mac OS X', 'Mac') : '');
}
const kb = (n) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// ---------------------------------------------------------------------------------------- the server
class ApiError extends Error {
  constructor(status, data) {
    super(messageOf(status, data));
    this.status = status;
    this.data = data;
    this.code = data && typeof data.error === 'string' ? data.error : (data && data.error && data.error.code) || null;
  }
}
function messageOf(status, data) {
  const code = data && typeof data.error === 'string' ? data.error : (data && data.error && data.error.code) || null;
  if (code && ERRORS[code] && !(data && data.message)) return ERRORS[code];
  if (data && data.message) return data.message;
  if (data && data.error && data.error.message) return data.error.message;
  if (code) return ERRORS[code] || code.replace(/_/g, ' ');
  if (status === 403) return ERRORS.forbidden;
  return status ? 'The server answered ' + status + '.' : 'Could not reach the server.';
}
// the session's CSRF token as it is now (the cookie is renewed with the session), else the overview's copy
function csrfNow() {
  const m = document.cookie.match(/(?:^|;\s*)mantel_csrf=([^;]*)/);
  return (m && decodeURIComponent(m[1])) || (me && me.csrf) || '';
}
function signedOut() {
  if (BASE) flash = { key: '*', text: 'Home Assistant has signed you out. Reload this page, or reopen Mantel from the sidebar.', err: true };
  else location.assign('/login?next=' + encodeURIComponent('/settings' + location.hash));
}
export async function api(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET') init.headers['X-CSRF-Token'] = opts.csrf || csrfNow();
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(mantelUrl(path), init); } catch (e) { throw new ApiError(0, null); }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.status === 401 && data === null) { signedOut(); throw new ApiError(401, null); }
  if (res.status === 403 && data && data.error === 'step_up_required' && opts.retry !== false) {
    if (await stepUp()) return api(method, path, body, { ...opts, retry: false });
  }
  if (res.status === 403 && data && data.error === 'csrf' && method !== 'GET' && !opts.csrfRetried) {
    try { await refreshMe(); } catch (e) { /* the retry reports */ }
    return api(method, path, body, { ...opts, csrfRetried: true, csrf: (me && me.csrf) || undefined });
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
async function refreshMe() {
  me = await api('GET', '/api/admin/overview', undefined, { retry: false });
  skew = me.now - Date.now() / 1000;
  return me;
}

// a read for a page: drawn once it is here, read again after a change (forget)
function load(key, fn) {
  const got = cache[key];
  if (got && !got.loading) return got;
  if (!got) {
    cache[key] = { loading: true };
    Promise.resolve().then(fn).then((data) => { cache[key] = { data }; }, (err) => { cache[key] = { err }; })
      .then(() => { if (panel) panel.render(); });
  }
  return null;
}
function forget(...keys) { for (const k of keys) delete cache[k]; }
const redraw = () => { if (panel) panel.render(); };

// AN ACTION: its result on the page (the bar's Saved, or what went wrong under the page's title)
async function act(key, fn, okText, ...invalidate) {
  flash = null;
  if (panel) panel.status('saving');
  try {
    const out = await fn();
    if (panel) panel.status('saved');
    if (okText) flash = { key, text: okText };
    forget(...invalidate);
    redraw();
    return out === undefined ? true : out;
  } catch (e) {
    if (panel) panel.status('error');
    if (!(e instanceof ApiError && e.status === 401)) flash = { key, text: e instanceof ApiError ? e.message : 'Something went wrong: ' + e.message, err: true };
    redraw();
    return false;
  }
}
const ask = (o) => K().confirm(panel.shadowRoot, o);

// ---------------------------------------------------------------------------------------- the kit, for Mantel
const group = (o, rows) => K().group(o, rows);
const info = (label, sub, value, cls) => K().info({ label, sub: sub || null, value, valueCls: cls });
const button = (label, onClick, o = {}) => K().button({ label, onClick, destructive: !!o.destructive, center: !!o.center,
                                                        disabled: !!o.disabled, fk: o.fk });
const nav = (label, route, o = {}) => K().nav({ label, sub: o.sub || null, value: o.value, href: '#/' + ROUTE + '/' + route,
                                                 icon: o.icon, tile: o.tile, fk: 'mx:' + route });
function field(form, name, label, o = {}) {
  const d = drafts[form] = drafts[form] || {};
  if (d[name] === undefined && o.value !== undefined) d[name] = o.value;
  return K().text({ label, value: d[name] || '', placeholder: o.placeholder, type: o.type, maxlength: o.maxlength,
                    inputmode: o.inputmode, autocomplete: o.autocomplete || 'off', fk: 'mx:' + form + ':' + name,
                    onCommit: (v) => { d[name] = v; } });
}
const draft = (form) => (drafts[form] = drafts[form] || {});
const clearDraft = (form) => { delete drafts[form]; };
function choose(form, name, label, options, value, onChange) {
  const d = draft(form);
  if (d[name] === undefined) d[name] = value;
  return K().select({ label, options, value: d[name], fk: 'mx:' + form + ':' + name,
                      onChange: (v) => { d[name] = v; if (onChange) onChange(v); } });
}
function ticks(form, name, options, chosen) {
  const d = draft(form);
  if (!Array.isArray(d[name])) d[name] = chosen.slice();
  return options.map(([v, t, sub]) => K().check({ label: t, sub: sub || null, multi: true, on: d[name].includes(v), fk: 'mx:' + form + ':' + name + ':' + v,
    onClick: () => { const a = d[name]; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); redraw(); } }));
}
// a value shown once, to copy (a credential, a code): its own cell
function secretCell(text, id) {
  return hh('div', { class: 'cell mxsecret' }, [hh('span', { class: 'url', id, text })]);
}
function copyButton(text, label = 'Copy') {
  return button(label, async () => {
    try { await navigator.clipboard.writeText(text); flash = { key: '*', text: 'Copied.' }; } catch (e) { flash = { key: '*', text: 'Select it and copy it by hand.', err: true }; }
    redraw();
  });
}
const pending = (c, what) => c.appendChild(group({ footer: what || 'Loading…' }, []));
const failed = (c, err) => c.appendChild(group({ footer: hh('span', { class: 'mxerr', text: err instanceof ApiError ? err.message : String(err) }) }, []));
// THE SCREEN ONE OPENS ON (default_screens.py): a picker of Mantel's screens, `none` the label for "not set"
function screenOptions(list, none) {
  return [['', none]].concat((list || []).map((x) => [x.path, x.title]));
}
const houseTitle = (d) => { const x = (d.screens || []).find((s) => s.path === d.house); return x ? x.title : d.house; };
function screenPicker(key, label, sub, value, list, none, put) {
  return K().select({ label, sub, options: screenOptions(list, none), value: value || '', fk: 'mx:screen:' + key,
    onChange: (v) => act(key, () => put(v || null), 'Saved.', 'myscreen', 'dscreens') });
}
// the last action's result, on the page it was done from
function result(c, key) {
  if (!flash || (flash.key !== key && flash.key !== '*')) return;
  c.appendChild(hh('p', { class: 'mxflash' + (flash.err ? ' err' : ''), role: flash.err ? 'alert' : 'status', text: flash.text }));
}
const STYLE = [
  '.mxflash{margin:-8px 0 22px;padding:10px 16px;border-radius:10px;background:var(--hk-cell);font-size:15px;line-height:20px;color:var(--hk-label)}',
  '.mxflash.err{color:var(--hk-red)}',
  '.mxerr{color:var(--hk-red)}',
  '.cell.mxsecret{display:block;padding:12px 16px}',
  '.cell.mxqr{display:flex;justify-content:center;padding:16px}.cell.mxqr img{width:min(280px,70vw);height:auto;border-radius:8px;background:#fff}',
  '.mxfile{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}',
  '.mxdlg .mxin{display:block;box-sizing:border-box;width:calc(100% - 32px);height:36px;margin:0 16px 16px;padding:0 10px;border:0;',
  '  border-radius:8px;background:var(--hk-fill);color:var(--hk-label);font:inherit;font-size:17px;text-align:center;letter-spacing:.2em;outline:none}',
  '.mxdlg .mxin:focus{box-shadow:0 0 0 2px var(--hk-tint)}',
  '.mxdlg .mxe{margin:-6px 16px 12px;padding:0;font-size:13px;color:var(--hk-red);min-height:0}',
].join('\n') + '\n' + photos.STYLE;
function ensureStyle(root) {
  if (!root || root.querySelector('style[data-mx]')) return;
  const s = document.createElement('style');
  s.setAttribute('data-mx', '');
  s.textContent = STYLE;
  root.appendChild(s);
}

// "CONFIRM IT IS YOU": the authenticator code or a passkey, then the refused request once more.
// An alert in HK Settings' own look (the kit's .dlg), with a field for the code.
function stepUp() {
  const u = me && me.user;
  const canTotp = !!(u && u.totp);
  const canPasskey = !!(u && u.passkeys > 0 && window.PublicKeyCredential);
  const root = panel.shadowRoot;
  return new Promise((resolve) => {
    const err = hh('p', { class: 'mxe', role: 'alert' });
    const code = canTotp ? hh('input', { class: 'mxin', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8,
                                         'aria-label': 'Code from your authenticator app' }) : null;
    const buttons = [hh('button', { type: 'button', class: 'cx', text: 'Cancel' })];
    if (canPasskey) buttons.push(hh('button', { type: 'button', text: 'Use Passkey' }));
    if (canTotp) buttons.push(hh('button', { type: 'button', class: 'bold', text: 'Confirm' }));
    const msg = canTotp || canPasskey ? 'This needs a fresh confirmation, within the last five minutes.'
      : 'You have no authenticator app or passkey yet. Sign out and sign in again, then do this within five minutes.';
    const dlg = hh('div', { class: 'dlg mxdlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Confirm It Is You' },
      [hh('h2', { text: 'Confirm It Is You' }), hh('p', { text: msg }), code, err, hh('div', { class: 'db' + (buttons.length > 2 ? ' stack' : '') }, buttons)]);
    const bd = hh('div', { class: 'dlgbd' }, dlg);
    const close = (v) => { bd.remove(); resolve(v); };
    buttons[0].addEventListener('click', () => close(false));
    const totp = async () => {
      try { await api('POST', '/api/auth/totp/step-up', { code: code.value.trim() }, { retry: false }); close(true); } catch (e) { err.textContent = e.message; }
    };
    const passkey = async () => {
      try {
        const w = await import(mantelUrl('/webauthn.js'));
        const opt = await api('POST', '/api/auth/passkey/options', { username: u.username || undefined }, { retry: false });
        const cred = await navigator.credentials.get({ publicKey: w.toRequest(opt.options) });
        await api('POST', '/api/auth/passkey/verify', { challenge_id: opt.challenge_id, credential: w.credentialJSON(cred) }, { retry: false });
        close(true);
      } catch (e) { err.textContent = e.message || 'The passkey was not accepted.'; }
    };
    if (canPasskey) buttons[1].addEventListener('click', passkey);
    if (canTotp) { buttons[buttons.length - 1].addEventListener('click', totp); code.addEventListener('keydown', (e) => { if (e.key === 'Enter') totp(); }); }
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } });
    root.appendChild(bd);
    (code || buttons[buttons.length - 1]).focus();
  });
}

async function signOut() {
  try { await api('POST', '/api/session/logout', {}, { retry: false }); } catch (e) { /* signing out anyway */ }
  if (BASE) location.reload(); else location.assign('/login');
}

// ============================================================================================ Me
function pMe(sub) {
  const u = me.user;
  if (sub[0] === 'pin') return pMyPin();
  if (sub[0] === 'password' && hasMantelPassword(u)) return pMyPassword();
  if (sub[0] === 'enroll') return pEnroll(['Me', '#/' + ROUTE + '/me']);
  return { title: u.name || u.username || 'Me', top: true, scope: roleLabel(u.role) + ' · ' +
    (u.kind === 'ha_linked' ? 'Signed in with Home Assistant' : 'Mantel account') + (u.username ? ' · ' + u.username : ''),
  body(c) {
    result(c, 'me');
    c.appendChild(group({ header: 'Account' }, [info('Name', null, u.name || u.username || u.id), info('Role', null, roleLabel(u.role)),
      info('Signs In With', null, u.kind === 'ha_linked' ? 'Home Assistant' : 'User Name and Password'),
      info('Here From', null, me.door === 'lan' ? 'Home Network' : 'Outside the Home')]));
    // a Mantel account's own password (accounts.change_password); a Home Assistant user's is Home Assistant's
    if (hasMantelPassword(u)) {
      c.appendChild(group({ footer: 'Every other browser signed in as you is signed out when it changes.' },
        [nav(u.has_password ? 'Change Password…' : 'Set a Password…', 'me/password')]));
    }
    const ms = load('myscreen', () => api('GET', '/api/default-screen'));
    if (ms && ms.data) {
      const d = ms.data;
      c.appendChild(group({ header: 'Default Screen', footer: 'Where Mantel opens for you.' + (d.at_tablet ? ' At a wall tablet it opens the tablet’s own screen.' : '') },
        [screenPicker('me', 'Opens On', null, d.screen, d.screens, 'House Default (' + houseTitle(d) + ')',
                      (v) => api('PUT', '/api/default-screen', { screen: v }))]));
    }
    const ss = load('sessions', () => api('GET', '/api/sessions'));
    if (!ss) pending(c); else if (ss.err) failed(c, ss.err);
    else {
      const rows = ss.data.sessions.map((s) => K().info({ label: shortUA(s.user_agent) + (s.current ? ' (This Browser)' : ''),
        sub: `${s.door === 'lan' ? 'Home network' : 'Remote'} · ${s.method} sign-in · ${s.source_ip || 'unknown address'} · last seen ${ago(s.last_seen)} · ends ${fmt(s.expires)}` }));
      const acts = ss.data.sessions.map((s) => button(s.current ? 'Sign Out Here' : 'Revoke ' + shortUA(s.user_agent), async () => {
        if (!(await ask({ title: s.current ? 'Sign out of this browser?' : 'Revoke this session?', message: s.current ? 'You will be signed out here.' : 'That browser will be signed out at once.',
          ok: s.current ? 'Sign Out' : 'Revoke', destructive: true }))) return;
        if (await act('me', () => api('DELETE', '/api/sessions/' + encodeURIComponent(s.id)), 'Session revoked.', 'sessions') && s.current) {
          if (BASE) location.reload(); else location.assign('/login');
        }
      }, { destructive: true, fk: 'mx:revoke-session:' + s.id }));
      c.appendChild(group({ header: 'My Sessions', footer: 'Every browser signed in as you.' }, rows.length ? rows : [info('No active sessions')]));
      if (acts.length) c.appendChild(group({}, acts));
    }
    if (u.role === 'wall_tablet') {
      // a Wall Tablet account sees only this page, and may make its own tablet (devices.enroll): the way in for a
      // tablet that cannot use Sign in with Home Assistant (trusted_networks signs it in as itself; 2026-10-19)
      c.appendChild(group({ footer: me.door === 'lan' ? 'On the tablet itself: this browser becomes the wall tablet, and this account is signed out here.'
        : 'Devices can only be enrolled on the home network.' }, [me.door === 'lan' ? nav('Make This Browser a Wall Tablet…', 'me/enroll', { icon: 'mdi:tablet' })
        : info('Make This Browser a Wall Tablet', null, 'Home Network Only')]));
    }
    drawNotifications(c);
    drawApps(c);
    drawPasskeys(c);
    drawTotp(c);
    c.appendChild(group({ footer: 'Optional, and not used for now: the only PIN is the house Alarm PIN, for the alarm.' }, [nav('My PIN', 'me/pin')]));
    // through Home Assistant's Ingress Home Assistant holds the sign-in: nothing to sign out of here
    if (!BASE) c.appendChild(group({ footer: 'Ends this browser’s session.' }, [button('Sign Out', signOut, { destructive: true, center: true, fk: 'mx:signout' })]));
  } };
}
// NOTIFICATIONS (push.py; docs/phase10/APPLE-APPS.md slice 10.0): this browser's Web Push, and every device that gets
// this person's notifications. On an iPhone or iPad only the web app on the Home Screen can (iOS 16.4+).
function drawNotifications(c) {
  if (BASE) {
    c.appendChild(group({ header: 'Notifications', footer: 'Inside Home Assistant, its Companion app delivers notifications. Open Mantel at its own address to get them from Mantel.' }, []));
    return;
  }
  const here = load('pushhere', async () => {
    const m = await import(mantelUrl('/web/app/push.js'));
    const sub = await m.current();
    return { m, on: !!sub, endpoint: sub ? sub.endpoint : null, supported: m.supported(), homeScreen: m.appleMobile() && !m.standalone() };
  });
  const ts = load('pushtargets', () => api('GET', '/api/push/targets'));
  if (!here || !ts) { pending(c); return; }
  if (ts.err) { failed(c, ts.err); return; }
  const rows = [];
  if (here.err) rows.push(info('This Browser', null, 'Unavailable'));
  else if (!here.data.supported) rows.push(info('This Browser', here.data.homeScreen ? 'Add Mantel to your Home Screen (Share → Add to Home Screen), then open it from there.' : 'This browser cannot receive notifications.', 'Off'));
  else {
    const d = here.data;
    rows.push(K().toggle({ label: 'Notifications Here', on: d.on, fk: 'mx:push-here',
      onChange: (on) => act('me', () => (on ? d.m.enable(api, shortUA(navigator.userAgent)) : d.m.disable(api)),
                            on ? 'Notifications turned on here.' : 'Notifications turned off here.', 'pushhere', 'pushtargets') }));
  }
  const list = ts.data.targets;
  for (const t of list) {
    rows.push(info(t.name || (t.kind === 'apns' ? 'Mantel App' : 'A Browser'), (t.kind === 'apns' ? 'App' : 'Web') + ' · ' + (t.service || '') + ' · last sent ' + ago(t.last_ok)));
  }
  const acts = list.length ? [button('Send a Test Notification', () => act('me', () => api('POST', '/api/push/test', {}), 'Test sent.'), { fk: 'mx:push-test' })] : [];
  for (const t of list) {
    acts.push(button('Stop Sending to ' + (t.name || 'This Device') + '…', async () => {
      if (!(await ask({ title: 'Stop notifications there?', message: 'That device will no longer get Mantel’s notifications.', ok: 'Stop', destructive: true }))) return;
      await act('me', () => api('DELETE', '/api/push/targets/' + encodeURIComponent(t.id)), 'Removed.', 'pushtargets', 'pushhere');
    }, { destructive: true, fk: 'mx:push-del:' + t.id }));
  }
  c.appendChild(group({ header: 'Notifications', footer: 'The house’s notifications on your phone or computer, as well as on the screens. Only what you may see.' }, rows));
  if (acts.length) c.appendChild(group({}, acts));
}
// APPS (app_auth.py; docs/phase10/APPLE-APPS.md §2): Mantel for iPhone, iPad and Mac signed in as this person, and
// the pairing QR code (a one-time code, ten minutes, home network only) that signs a new one in without typing.
function drawApps(c) {
  const ap = load('apps', () => api('GET', '/api/app/devices'));
  if (!ap) { pending(c); return; }
  if (ap.err) { failed(c, ap.err); return; }
  const list = ap.data.apps;
  const rows = list.map((a) => info(a.name || 'Mantel App', [a.model, a.platform].filter(Boolean).join(' · ') +
    (a.last_door ? ' · ' + (a.last_door === 'lan' ? 'home network' : 'away') : '') + ' · last seen ' + ago(a.last_seen) + ' · ends ' + fmt(a.expires)));
  const pair = shown.pairing;
  if (pair) {
    rows.push(hh('div', { class: 'cell mxqr' }, [hh('img', { alt: 'Pairing code for the Mantel app', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pair.qr_svg) })]));
    rows.push(info('Check Code', 'The app shows the same six digits.', pair.short_code));
    rows.push(button('Done', () => { delete shown.pairing; redraw(); }, { fk: 'mx:pair-done' }));
  } else {
    rows.push(button(me.door === 'lan' ? 'Add iPhone, iPad or Mac…' : 'Add iPhone, iPad or Mac (Home Network Only)', () => act('me', async () => {
      shown.pairing = await api('POST', '/api/app/pairing', {});
    }), { fk: 'mx:pair', disabled: me.door !== 'lan' }));
  }
  c.appendChild(group({ header: 'Mantel App', footer: pair ? 'Scan this with the Mantel app (or the Camera) within ten minutes, on the home network. It works once.'
    : 'The app signs in as you, on that device only, for 30 days.' }, rows.length ? rows : [info('No apps signed in')]));
  if (list.length) {
    c.appendChild(group({}, list.map((a) => button('Sign Out ' + (a.name || 'the App') + '…', async () => {
      if (!(await ask({ title: 'Sign out this app?', message: 'It stops working at once, its widgets too.', ok: 'Sign Out', destructive: true }))) return;
      await act('me', () => api('DELETE', '/api/app/devices/' + encodeURIComponent(a.id)), 'Signed out.', 'apps', 'pushtargets');
    }, { destructive: true, fk: 'mx:app-out:' + a.id }))));
  }
}
function drawPasskeys(c) {
  const pk = load('passkeys', () => api('GET', '/api/auth/passkeys'));
  if (!pk) { pending(c); return; }
  if (pk.err) { failed(c, pk.err); return; }
  const list = pk.data.passkeys;
  const rows = list.map((k) => info(k.name || 'Passkey', `Added ${fmt(k.created)} · last used ${ago(k.last_used)}`, k.backed_up ? 'Synced' : undefined));
  const can = !!window.PublicKeyCredential;
  const add = can ? [field('passkey', 'name', 'Name', { placeholder: 'My Phone', maxlength: 64 }),
    button('Add a Passkey…', () => act('me', async () => {
      const w = await import(mantelUrl('/webauthn.js'));
      const opt = await api('POST', '/api/auth/passkey/register/options', {});
      const cred = await navigator.credentials.create({ publicKey: w.toCreation(opt.options) });
      await api('POST', '/api/auth/passkey/register/verify', { challenge_id: opt.challenge_id, credential: w.credentialJSON(cred),
        name: (draft('passkey').name || '').trim() || undefined });
      clearDraft('passkey');
      await refreshMe();
    }, 'Passkey added.', 'passkeys'), { fk: 'mx:add-passkey' })] : [];
  c.appendChild(group({ header: 'Passkeys', footer: can ? 'A passkey signs you in with your fingerprint, face or device PIN.' : 'This browser cannot make passkeys.' },
    (rows.length ? rows : [info('No passkeys yet')]).concat(add)));
  if (list.length) {
    c.appendChild(group({}, list.map((k) => button('Remove ' + (k.name || 'Passkey') + '…', async () => {
      if (!(await ask({ title: 'Remove this passkey?', message: 'It will no longer sign you in or confirm actions.', ok: 'Remove', destructive: true }))) return;
      await act('me', async () => { await api('DELETE', '/api/auth/passkeys/' + encodeURIComponent(k.id)); await refreshMe(); }, 'Passkey removed.', 'passkeys');
    }, { destructive: true, fk: 'mx:remove-passkey:' + k.id }))));
  }
}
function drawTotp(c) {
  const on = me.user.totp;
  const rows = [info('Authenticator App', on ? 'Sign-in asks for a code after your password.' : 'Required for signing in from outside the house.', on ? 'On' : 'Off')];
  const enroll = shown.totp;
  if (enroll) {
    rows.push(secretCell(enroll.secret.replace(/(.{4})/g, '$1 ').trim(), 'totp-secret'));
    rows.push(hh('a', { class: 'cell tintc', href: enroll.uri }, hh('span', { class: 'lbl' }, hh('span', { class: 't', text: 'Open in an Authenticator App' }))));
    rows.push(field('totp', 'code', 'Code', { inputmode: 'numeric', maxlength: 8, autocomplete: 'one-time-code', placeholder: '123456' }));
    rows.push(button('Confirm', () => act('me', async () => {
      await api('POST', '/api/auth/totp/enroll/confirm', { code: (draft('totp').code || '').trim() });
      delete shown.totp; clearDraft('totp');
      await refreshMe();
    }, 'Authenticator app turned on.'), { fk: 'mx:confirm-totp' }));
  } else {
    rows.push(button(on ? 'Replace…' : 'Set Up…', () => act('me', async () => { shown.totp = await api('POST', '/api/auth/totp/enroll', {}); }), { fk: 'mx:enroll-totp' }));
    if (on) rows.push(button('Remove', async () => {
      if (!(await ask({ title: 'Remove the authenticator app?', message: 'Password sign-in will no longer ask for a code.', ok: 'Remove', destructive: true }))) return;
      await act('me', async () => { await api('DELETE', '/api/auth/totp'); await refreshMe(); }, 'Authenticator app removed.');
    }, { destructive: true, fk: 'mx:remove-totp' }));
  }
  c.appendChild(group({ header: 'Two-Step Sign-In', footer: enroll ? 'Add this secret to your authenticator app (or open the link on your phone), then type the 6-digit code it shows.'
    : on ? 'Replacing it turns the old app off until the new code is confirmed.' : null }, rows));
}
function pMyPin() {
  return { title: 'My PIN', back: ['Me', '#/' + ROUTE + '/me'], body(c) {
    result(c, 'pin');
    const got = load('pin', () => api('GET', '/api/account/pin'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const s = got.data;
    c.appendChild(group({ footer: 'Optional, and not used for now: Mantel asks for no personal PIN. The only PIN is the house Alarm PIN (Features, Alarm PIN), for the alarm. A PIN is 4 to 8 digits; nobody else can have the same one.' },
      [info('PIN', s.pin ? `Last changed ${fmt(s.updated || s.created)}` + (s.last_used ? ' · last used ' + ago(s.last_used) : '') : null, s.pin ? 'Set' : 'None'),
       field('pin', 'pin', s.pin ? 'New PIN' : 'PIN', { type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'new-password' }),
       field('pin', 'again', 'Repeat', { type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'new-password' }),
       button(s.pin ? 'Change PIN' : 'Set PIN', () => {
         const d = draft('pin');
         if (!/^\d{4,8}$/.test(d.pin || '')) { flash = { key: 'pin', text: 'A PIN is 4 to 8 digits.', err: true }; redraw(); return; }
         if (d.pin !== d.again) { flash = { key: 'pin', text: 'The two PINs do not match.', err: true }; redraw(); return; }
         const value = d.pin;
         clearDraft('pin');
         act('pin', () => api('PUT', '/api/account/pin', { pin: value }), s.pin ? 'PIN changed.' : 'PIN set.', 'pin');
       }, { fk: 'mx:set-pin' })]));
    if (s.pin) c.appendChild(group({}, [button('Remove My PIN…', async () => {
      if (!(await ask({ title: 'Remove your PIN?', message: 'Nothing in Mantel uses it for now.', ok: 'Remove', destructive: true }))) return;
      act('pin', () => api('DELETE', '/api/account/pin'), 'PIN removed.', 'pin');
    }, { destructive: true, fk: 'mx:remove-pin' })]));
  } };
}

// PASSWORDS: the same rules as a new account's (accounts.check_password_policy); the server checks them all again
// (four different characters, not the user name) and says which one failed. A password typed here lives only in
// this page's draft, cleared as soon as it is sent.
const hasMantelPassword = (u) => !!u && u.kind !== 'ha_linked' && !!u.username;
const PASSWORD_RULES = 'Passwords are 12 characters or more, with at least four different characters, and can’t contain the user name.';
function passwordProblem(d) {
  if ((d.new || '').length < 12) return 'Passwords are 12 characters or more.';
  if (d.new.length > 1024) return 'Passwords are at most 1024 characters.';
  if (d.new !== d.again) return 'The two passwords do not match.';
  return null;
}
const pwField = (form, name, label, auto) => field(form, name, label, { type: 'password', maxlength: 1024, autocomplete: auto });
function pMyPassword() {
  const has = !!me.user.has_password;
  return { title: has ? 'Change Password' : 'Set a Password', back: ['Me', '#/' + ROUTE + '/me'], body(c) {
    result(c, 'password');
    c.appendChild(group({ footer: PASSWORD_RULES + ' Every other browser signed in as you is signed out; this one stays.' },
      [has ? pwField('password', 'current', 'Current Password', 'current-password') : null,
       pwField('password', 'new', 'New Password', 'new-password'), pwField('password', 'again', 'Repeat', 'new-password')].filter(Boolean)));
    c.appendChild(group({}, [button(has ? 'Change Password' : 'Set Password', async () => {
      const d = draft('password');
      const bad = passwordProblem(d);
      if (bad) { flash = { key: 'password', text: bad, err: true }; redraw(); return; }
      const body = has ? { current: d.current || '', new: d.new } : { new: d.new };
      clearDraft('password');
      if (!(await act('password', () => api('POST', '/api/account/password', body), null, 'sessions'))) return;
      try { await refreshMe(); } catch (e) { /* the page still says it worked */ }
      flash = { key: 'me', text: (has ? 'Password changed.' : 'Password set.') + ' Your other sessions have ended.' };
      panel.go('#/' + ROUTE + '/me');
    }, { center: true, fk: 'mx:change-password' })]));
  } };
}
// SOMEONE ELSE'S PASSWORD (accounts.users_set_password): an Owner or Admin sets a new one (an Admin never an Owner's),
// after a fresh confirmation; every session that person has ends, and the audit log records who did it
function pPersonPassword(id) {
  const got = usersRead();
  const u = got && got.data && got.data.users.find((x) => x.id === id);
  const back = [u ? u.name || u.username || 'Person' : 'Person', '#/' + ROUTE + '/people/' + encodeURIComponent(id)];
  return { title: 'Set a New Password', back, body(c) {
    result(c, 'resetpw');
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    if (!u) { c.appendChild(group({ footer: 'That person no longer exists.' }, [])); return; }
    if (me.user.role !== 'owner' && u.role === 'owner') { c.appendChild(group({ footer: 'Only an Owner can change an Owner.' }, [])); return; }
    if (u.id === me.user.id || !hasMantelPassword(u)) {
      c.appendChild(group({ footer: u.id === me.user.id ? ERRORS.own_password : ERRORS.no_mantel_password }, []));
      return;
    }
    c.appendChild(group({ footer: PASSWORD_RULES + ' They are signed out everywhere at once. Give them the new password in person; they can change it in Me.' },
      [info('For', null, (u.name || u.username) + (u.username ? ' (' + u.username + ')' : '')),
       pwField('resetpw', 'new', 'New Password', 'new-password'), pwField('resetpw', 'again', 'Repeat', 'new-password')]));
    c.appendChild(group({}, [button('Set Password', async () => {
      const d = draft('resetpw');
      const bad = passwordProblem(d);
      if (bad) { flash = { key: 'resetpw', text: bad, err: true }; redraw(); return; }
      if (!(await ask({ title: 'Set a new password for ' + (u.name || u.username) + '?', message: 'Their old password stops working and every browser signed in as them is signed out now.',
        ok: 'Set Password', destructive: true }))) return;
      const value = d.new;
      clearDraft('resetpw');
      const r = await act('resetpw', () => api('POST', '/api/users/' + encodeURIComponent(u.id) + '/password', { password: value }), null, 'users');
      if (!r) return;
      flash = { key: 'person', text: 'New password set.' + (r.sessions_ended ? ' ' + r.sessions_ended + ' session' + (r.sessions_ended > 1 ? 's' : '') + ' ended.' : '') };
      panel.go(back[1]);
    }, { center: true, destructive: true, fk: 'mx:reset-password' })]));
  } };
}

// ============================================================================================ People
const usersRead = () => load('users', () => api('GET', '/api/users'));
const assignable = () => me.roles.filter((r) => me.user.role === 'owner' || r !== 'owner');
function pPeople(sub) {
  if (sub[0] === 'add') return pAddPerson();
  if (sub[0] && sub[1] === 'password') return pPersonPassword(sub[0]);
  if (sub[0]) return pPerson(sub[0]);
  return { title: 'People', top: true, scope: 'Everyone who can sign in to Mantel, and their roles.', body(c) {
    result(c, 'people');
    const got = usersRead();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const users = got.data.users;
    c.appendChild(group({ header: 'People' }, users.map((u) => nav(u.name || u.username || u.id, 'people/' + encodeURIComponent(u.id), {
      sub: [roleLabel(u.role), u.kind === 'ha_linked' ? 'Home Assistant' : 'Mantel account', u.disabled ? 'Disabled' : null, u.id === me.user.id ? 'You' : null].filter(Boolean).join(' · '),
      icon: u.kind === 'ha_linked' ? 'mdi:home-assistant' : 'mdi:account' }))));
    c.appendChild(group({ footer: 'For someone who signs in with their own user name and password. They can add an authenticator app and passkeys themselves.' },
      [nav('Add a Mantel Account…', 'people/add', { icon: 'mdi:plus' })]));
    const linked = users.filter((u) => u.ha_user_id);
    c.appendChild(group({ header: 'Home Assistant Users',
      footer: 'A person who signs in with Home Assistant only gets in once they are linked to a role. When they try and are not linked, their sign-in page shows their Home Assistant user id. To link them, run on the Mantel Server: mantel-server link --ha-user-id <id> --role adult --name "Their name". To end a link: mantel-server unlink --ha-user-id <id>.' },
      linked.length ? linked.map((u) => info(u.name || u.id, 'Home Assistant user ' + u.ha_user_id, roleLabel(u.role))) : [info('No Home Assistant users are linked yet')]));
  } };
}
// THEIR PHONES (phones.py; docs/phase9/MANTEL-LINK.md 9.7): Mantel's notifications on the Home Assistant Companion
// app, through Mantel Link: which of the phones Home Assistant has are theirs, and what goes there
const SEND_LABEL = [['important', 'Important Only'], ['all', 'Every Notification'], ['off', 'Nothing']];
function drawPhones(c, u, locked) {
  const got = load('phones', () => api('GET', '/api/phones'));
  if (!got || got.err) return;
  const d = got.data, mine = (d.people || {})[u.id] || { services: [], send: 'important' };
  const known = d.available || [];
  const names = Object.fromEntries(known.map((p) => [p.service, p.name]));
  const footer = !d.linked ? 'Mantel Link in Home Assistant brings Mantel’s notifications to phones with the Home Assistant Companion app. It isn’t linked yet.'
    : !known.length ? 'Home Assistant has no phones with the Companion app yet.'
    : 'Mantel’s notifications on their lock screen, through Home Assistant’s Companion app. Dismiss on the phone takes the banner down on every screen.';
  const put = (services, send) => act('person', () => api('PUT', '/api/users/' + encodeURIComponent(u.id) + '/phones', { services, send }),
                                      'Phones saved.', 'phones');
  const rows = [];
  if (locked) {
    rows.push(info('Phones', null, mine.services.map((s) => names[s] || s).join(', ') || 'None'));
  } else {
    for (const p of known) {
      rows.push(K().toggle({ label: p.name, on: mine.services.includes(p.service), fk: 'mx:phone:' + p.service,
        onChange: (on) => put(on ? mine.services.concat([p.service]) : mine.services.filter((s) => s !== p.service), mine.send) }));
    }
    for (const s of mine.services.filter((x) => !names[x])) rows.push(info(s, 'Home Assistant no longer has this phone', 'Gone', 'warn'));
    if (known.length || mine.services.length) {
      rows.push(K().select({ label: 'Send', options: SEND_LABEL, value: mine.send, fk: 'mx:phone-send',
                              onChange: (send) => put(mine.services, send) }));
    }
  }
  c.appendChild(group({ header: 'Phones', footer }, rows));
}

function pPerson(id) {
  const back = ['People', '#/' + ROUTE + '/people'];
  const got = usersRead();
  const u = got && got.data && got.data.users.find((x) => x.id === id);
  return { title: u ? u.name || u.username || u.id : 'Person', back, body(c) {
    result(c, 'person');
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    if (!u) { c.appendChild(group({ footer: 'That person no longer exists.' }, [])); return; }
    const how = [u.has_password && 'Password', u.totp && 'Authenticator App', u.passkeys && u.passkeys + ' Passkey' + (u.passkeys > 1 ? 's' : ''), u.ha_user_id && 'Home Assistant'].filter(Boolean);
    const locked = me.user.role !== 'owner' && u.role === 'owner';      // an Admin never manages Owners
    const self = u.id === me.user.id;
    const roles = assignable().includes(u.role) ? assignable() : [u.role, ...assignable()];
    c.appendChild(group({ header: 'Account', footer: locked ? 'Only an Owner can change an Owner.' : null }, [
      locked ? info('Role', null, roleLabel(u.role)) : K().select({ label: 'Role', options: roles.map((r) => [r, roleLabel(r)]), value: u.role, fk: 'mx:role',
        onChange: (role) => act('person', () => api('PATCH', '/api/users/' + encodeURIComponent(u.id), { role }), 'Role changed.', 'users') }),
      info('User Name', null, u.username || 'None'),
      info('Signs In With', null, how.length ? how.join(', ') : 'Nothing Yet'),
      ...(u.ha_user_id ? [info('Home Assistant User', null, u.ha_user_id)] : [])]));
    const ds = load('dscreens', () => api('GET', '/api/default-screens'));
    if (ds && ds.data) {
      const d = ds.data, cur = d.users[u.id] || '';
      const none = 'House Default (' + houseTitle(d) + ')';
      c.appendChild(group({ header: 'Default Screen', footer: 'Where Mantel opens for them, except at a wall tablet (the tablet’s own). Which screens they may open, and what they see, is their role’s.' },
        [locked ? info('Opens On', null, cur ? (d.screens.find((x) => x.path === cur) || { title: cur }).title : none)
          : screenPicker('person', 'Opens On', null, cur, d.screens, none,
                         (v) => api('PUT', '/api/users/' + encodeURIComponent(u.id) + '/default-screen', { screen: v }))]));
    }
    drawPhones(c, u, locked);
    if (locked) return;
    const rows = [];
    if (!self) rows.push(button(u.disabled ? 'Enable' : 'Disable…', async () => {
      if (!u.disabled && !(await ask({ title: 'Disable ' + (u.name || u.username) + '?', message: 'Their sessions end now and they cannot sign in.', ok: 'Disable', destructive: true }))) return;
      act('person', () => api('PATCH', '/api/users/' + encodeURIComponent(u.id), { disabled: !u.disabled }), u.disabled ? 'Enabled.' : 'Disabled.', 'users');
    }, { destructive: !u.disabled, fk: 'mx:toggle-user' }));
    if (!self && hasMantelPassword(u)) rows.push(nav('Set a New Password…', 'people/' + encodeURIComponent(u.id) + '/password'));
    rows.push(button('Clear Their PIN…', async () => {
      if (!(await ask({ title: 'Clear their PIN?', message: 'They will have to set a new one.', ok: 'Clear', destructive: true }))) return;
      const r = await act('person', () => api('DELETE', '/api/users/' + encodeURIComponent(u.id) + '/pin'));
      if (r) { flash = { key: 'person', text: r.removed ? 'PIN cleared.' : 'They had no PIN.' }; redraw(); }
    }, { fk: 'mx:clear-pin' }));
    c.appendChild(group({ footer: self ? 'You can’t disable yourself. Change your own password in Me.'
      : 'A disabled person is signed out everywhere and can’t sign in. A new password signs them out everywhere too.' }, rows));
  } };
}
function pAddPerson() {
  return { title: 'Add a Mantel Account', back: ['People', '#/' + ROUTE + '/people'], body(c) {
    result(c, 'adduser');
    c.appendChild(group({ footer: 'Passwords are 12 characters or more.' }, [
      field('user', 'username', 'User Name', { maxlength: 64 }),
      field('user', 'name', 'Name', { maxlength: 64 }),
      choose('user', 'role', 'Role', assignable().filter((r) => r !== 'service').map((r) => [r, roleLabel(r)]), 'adult'),
      field('user', 'password', 'Password', { type: 'password', maxlength: 200, autocomplete: 'new-password' })]));
    c.appendChild(group({}, [button('Create Account', async () => {
      const d = draft('user');
      const body = { username: (d.username || '').trim(), name: (d.name || '').trim() || undefined, role: d.role, password: d.password || '' };
      const ok = await act('adduser', () => api('POST', '/api/users', body), 'Account created.', 'users');
      if (ok) { clearDraft('user'); flash = { key: 'people', text: 'Account created.' }; panel.go('#/' + ROUTE + '/people'); }
    }, { center: true, fk: 'mx:create-user' })]));
  } };
}

// ============================================================================================ Devices
const devicesRead = () => load('devices', () => api('GET', '/api/devices'));
// HK's wall tablets and HA's areas (GET /api/devices/rooms): a device's room is one of them, never typed. A wall
// tablet device reports its touches and black screen only for the HK tablet in its own room (features.may_speak_for),
// so a room typed as "Livingroom" for HK's living_room cut three tablets off (the house, 2026-10-19).
const roomsRead = () => load('devrooms', () => api('GET', '/api/devices/rooms'));
const titleCase = (id) => String(id).replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
function roomName(rooms, rid) {
  if (!rid) return '';
  const a = (rooms && rooms.areas || []).find((x) => x.id === rid);
  return a ? a.name : titleCase(rid);
}
const tabletList = (rooms) => Object.entries((rooms && rooms.tablets) || {}).filter(([, t]) => t && t.room)
  .sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
// a wall tablet device in a room no HK tablet has: its touches and black screen reach nothing
const lostTablet = (d, tablets) => !d.revoked && d.role === 'wall_tablet' && Object.keys(tablets || {}).length > 0 && !(d.hk_tablets || []).length;
// THE ROOM PICKER: one of HK's wall tablets (the device takes its room), else Not One of These and one of HA's
// areas. `self` is the device being moved (its own tablet isn't "in use"); onTablet(t) when a tablet is picked.
function roomChoice(form, rooms, self, onTablet) {
  const d = draft(form);
  const tablets = tabletList(rooms);
  const rows = tablets.map(([tid, t]) => {
    const others = (t.served_by || []).filter((x) => x.id !== self).map((x) => '“' + x.name + '”');
    return K().check({ label: t.name, sub: [roomName(rooms, t.room), t.screen_title || (t.screen ? titleCase(t.screen.split('-').slice(1).join(' ')) + ' Screen' : null),
                                            others.length ? 'Already ' + others.join(', ') : null].filter(Boolean).join(' · '),
                       value: others.length ? 'In Use' : undefined, on: d.tablet === tid, fk: 'mx:' + form + ':tablet:' + tid,
                       onClick: () => { d.tablet = tid; d.other = false; if (onTablet) onTablet(t); redraw(); } });
  });
  rows.push(K().check({ label: 'Not One of These', sub: 'A room with no HK wall tablet', on: !!d.other, fk: 'mx:' + form + ':other',
                        onClick: () => { d.tablet = ''; d.other = true; redraw(); } }));
  const out = [group({ header: 'Which HK Tablet', footer: tablets.length ? 'Its touches and black screen reach Mantel as this HK tablet’s (All Screens, Wall Tablets). “In Use”: an enrolled device is already in its room.'
    : 'HK has no wall tablets in Mantel’s settings yet (All Screens, Wall Tablets).' }, rows)];
  if (d.other) {
    const areas = (rooms && rooms.areas) || [];
    if (d.room && !areas.some((a) => a.id === d.room)) d.room = '';
    out.push(group({ footer: areas.length ? 'With no HK tablet in its room, its touches and black screen won’t reach Mantel.' : 'Home Assistant has not told Mantel about any areas yet.' },
      areas.length ? [choose(form, 'room', 'Room', [['', 'Choose…']].concat(areas.map((a) => [a.id, a.name])), '')] : []));
  }
  return out;
}
// what the server is asked for: {tablet} or {room}; null when nothing is chosen
function roomBody(form) {
  const d = draft(form);
  if (d.tablet) return { tablet: d.tablet };
  if (d.other && d.room) return { room: d.room };
  return null;
}
function pDevices(sub) {
  if (sub[0] === 'enroll') return pEnroll();
  if (sub[0]) return pDevice(sub[0]);
  return { title: 'Devices', top: true, scope: 'Wall tablets enrolled with Mantel: each keeps its own credential, and does what its role allows (Roles & Grants). ' +
    'How each screen behaves is All Screens, Wall Tablets.', body(c) {
    result(c, 'devices');
    if (enrolled) { drawEnrolled(c); return; }
    const got = devicesRead();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const all = got.data.devices, live = all.filter((d) => !d.revoked), gone = all.filter((d) => d.revoked);
    const tablets = got.data.tablets || {};
    const about = (d) => [d.room, roleLabel(d.role), 'last seen ' + ago(d.last_seen), d.source_ip || 'no address yet', 'enrolled ' + fmt(d.created)].filter(Boolean).join(' · ');
    const row = (d) => info(d.name, about(d),
      d.revoked ? 'Revoked' + (d.revoked_reason ? ': ' + d.revoked_reason.replace(/_/g, ' ') : '') : undefined, d.revoked ? 'warn' : '');
    const lost = live.filter((d) => lostTablet(d, tablets));
    const tabletName = (d) => ((d.hk_tablets || []).map((t) => (tablets[t] || {}).name || t)[0]) || (lostTablet(d, tablets) ? 'No HK Tablet' : undefined);
    c.appendChild(group({ header: 'Wall Tablets', footer: lost.length ? hh('span', { class: 'mxerr', text: lost.map((d) => '“' + d.name + '”').join(', ') +
        (lost.length > 1 ? ' are in rooms' : ' is in a room') + ' with no HK wall tablet: ' + (lost.length > 1 ? 'their' : 'its') +
        ' touches and black screen won’t reach Mantel. Open ' + (lost.length > 1 ? 'each' : 'it') + ' to choose its HK tablet.' }) : null },
      live.length ? live.map((d) => nav(d.name, 'devices/' + encodeURIComponent(d.id), { sub: about(d), value: tabletName(d) })) : [info('No wall tablets are enrolled')]));
    const ds = load('dscreens', () => api('GET', '/api/default-screens'));
    if (live.length && ds && ds.data) {
      const d = ds.data;
      c.appendChild(group({ header: 'Default Screens', footer: 'Where each tablet opens, whoever is signed in at it. Not set: its HK tablet’s screen (All Screens, Wall Tablets), else the house default (' + houseTitle(d) + ').' },
        live.map((x) => screenPicker('devices', x.name, x.room || null, d.devices[x.id], d.screens, 'Its HK Tablet’s Screen',
                                     (v) => api('PUT', '/api/devices/' + encodeURIComponent(x.id) + '/default-screen', { screen: v })))));
    }
    if (live.length) c.appendChild(group({}, live.map((d) => button('Revoke ' + d.name + '…', async () => {
      if (!(await ask({ title: 'Revoke ' + d.name + '?', message: 'The tablet is refused at once and has to be enrolled again.', ok: 'Revoke', destructive: true }))) return;
      act('devices', () => api('DELETE', '/api/devices/' + encodeURIComponent(d.id)), 'Device revoked.', 'devices', 'devrooms');
    }, { destructive: true, fk: 'mx:revoke-device:' + d.id }))));
    if (gone.length) c.appendChild(group({ header: 'Revoked' }, gone.map(row)));
    c.appendChild(group({ footer: me.door === 'lan' ? 'Open Mantel Settings on the tablet itself, signed in as an Owner or Admin, and do it there.'
      : 'Devices can only be enrolled on the home network.' }, [me.door === 'lan' ? nav('Make This Browser a Wall Tablet…', 'devices/enroll', { icon: 'mdi:tablet' })
      : info('Make This Browser a Wall Tablet', null, 'Home Network Only')]));
  } };
}
// ONE DEVICE: its HK tablet or room, changed in place (PATCH /api/devices/{id}; it keeps its credential)
function pDevice(id) {
  const known = cache.devices && cache.devices.data && cache.devices.data.devices.find((x) => x.id === id);
  return { title: known ? known.name : 'Wall Tablet', back: ['Devices', '#/' + ROUTE + '/devices'], body(c) {
    const key = 'device:' + id;
    result(c, key);
    const got = devicesRead(), rr = roomsRead();
    if (!got || !rr) { pending(c); return; }
    if (got.err || rr.err) { failed(c, got.err || rr.err); return; }
    const dev = got.data.devices.find((x) => x.id === id && !x.revoked);
    if (!dev) { failed(c, ERRORS.not_found); return; }
    const rooms = rr.data, form = 'move:' + id, d = draft(form);
    if (d.tablet === undefined) {                 // start from where it is
      d.tablet = (dev.hk_tablets || []).find((t) => rooms.tablets[t]) || '';
      d.other = !d.tablet && !!dev.room && rooms.areas.some((a) => a.id === dev.room);
      d.room = d.other ? dev.room : '';
    }
    const lost = lostTablet(dev, got.data.tablets);
    c.appendChild(group({ header: 'Now', footer: lost ? hh('span', { class: 'mxerr', text: (dev.room ? 'No HK wall tablet is in ' + roomName(rooms, dev.room) : 'It has no room') +
        ': its touches and black screen won’t reach Mantel. Choose its HK tablet below.' }) : null },
      [info('Room', null, dev.room ? roomName(rooms, dev.room) : 'None', lost ? 'warn' : ''), info('Role', null, roleLabel(dev.role))]));
    for (const g of roomChoice(form, rooms, dev.id)) c.appendChild(g);
    const body = roomBody(form);
    c.appendChild(group({ footer: 'It keeps its credential: nothing to do at the tablet. Its open screens follow within a minute.' }, [button('Save', async () => {
      const r = await act(key, () => api('PATCH', '/api/devices/' + encodeURIComponent(id), body), 'Saved.', 'devices', 'devrooms');
      if (r) clearDraft(form);
    }, { center: true, disabled: !body, fk: 'mx:move-device:' + id })]));
  } };
}
function pEnroll(back = ['Devices', '#/' + ROUTE + '/devices']) {
  return { title: 'Make This a Wall Tablet', back, body(c) {
    result(c, 'enroll');
    if (enrolled) { drawEnrolled(c); return; }
    const rr = roomsRead();
    if (!rr) { pending(c); return; }
    if (rr.err) { failed(c, rr.err); return; }
    const rooms = rr.data, tablets = tabletList(rooms);
    const u = me.user || {}, d = draft('device');
    if (u.role === 'wall_tablet') {               // a Wall Tablet account names its own tablet: start from its name
      const label = u.name || (u.username || '').replace(/^./, (x) => x.toUpperCase());
      if (d.name === undefined && label) d.name = label;     // an account made with no name: its user name (loft → Loft)
      if (d.tablet === undefined && label) {                 // and its HK tablet, by that name or that room
        const rid = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const hit = tablets.find(([, t]) => String(t.name).toLowerCase() === label.toLowerCase()) || tablets.find(([, t]) => t.room === rid);
        d.tablet = hit ? hit[0] : '';
      }
    }
    const nothing = !tablets.length && !(rooms.areas || []).length;
    if (nothing) c.appendChild(group({ header: 'Which HK Tablet', footer: 'Mantel knows no rooms yet: no HK wall tablets in its settings, no Home Assistant areas. Enrol it now, and choose its room under Devices once they are here.' }, []));
    else {
      for (const g of roomChoice('device', rooms, null, (t) => {   // the name follows the tablet picked, until it is typed
        if (!d.name || d.name === d.auto) { d.name = t.name; d.auto = t.name; }
      })) c.appendChild(g);
    }
    c.appendChild(group({ footer: 'The person is signed out of this browser at once, and it keeps its own credential. What it may do is its role’s (Roles & Grants). Only on the home network.' }, [
      field('device', 'name', 'Name', { placeholder: 'Kitchen Tablet', maxlength: 64 }),
      choose('device', 'role', 'Role', me.device_roles.map((r) => [r, roleLabel(r)]), 'wall_tablet')]));
    c.appendChild(group({}, [button('Make This a Wall Tablet', async () => {
      const name = (d.name || '').trim();
      const where = roomBody('device');
      if (!where && !nothing) { flash = { key: 'enroll', text: d.other ? 'Choose its room.' : 'Choose its HK tablet, or Not One of These and its room.', err: true }; redraw(); return; }
      if (!name) { flash = { key: 'enroll', text: 'Give the tablet a name.', err: true }; redraw(); return; }
      if (!(await ask({ title: 'Make this browser a wall tablet?', message: 'You will be signed out here. From now on this browser acts as the tablet “' + name + '”.', ok: 'Make It a Tablet' }))) return;
      const r = await act('enroll', () => api('POST', '/api/devices/enroll', { name, role: d.role, ...(where || {}) }));
      if (r) { enrolled = r.device; clearDraft('device'); redraw(); }
    }, { center: true, fk: 'mx:enroll-device' })]));
  } };
}
function drawEnrolled(c) {
  const d = enrolled;
  c.appendChild(group({ header: 'This Browser Is Now a Wall Tablet', footer: `“${d.name}”${d.room ? ' in ' + titleCase(d.room) : ''} is enrolled as a ${roleLabel(d.role)}. You have been signed out of this browser.` },
    [K().nav({ label: 'Open the Dashboard', href: mantelUrl('/home'), fk: 'mx:open-home' })]));
}

// ============================================================================================ Roles & grants
function describeSchedule(s) {
  if (!s) return '';
  const bits = [];
  if (s.start) bits.push(`${s.start} to ${s.end}`);
  if (s.days && s.days.length < 7) bits.push(s.days.map((d) => DAYS[d]).join(', '));
  if (s.not_before) bits.push('from ' + fmt(s.not_before));
  if (s.not_after) bits.push('until ' + fmt(s.not_after));
  return bits.length ? ' · ' + bits.join(' · ') : ' · always';
}
function describeGrant(g) {
  const order = me.actions.concat(['*']);
  const what = g.actions.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(', ');
  const on = g.resource_kind === 'all' ? 'everything' : g.resource_kind === 'feature' ? 'the ' + g.resource + ' feature' : g.resource_kind + ' ' + g.resource;
  const dom = g.domains.length ? ' (only ' + g.domains.join(', ') + ')' : '';
  return `${g.effect === 'deny' ? 'Deny' : 'Allow'} ${what} on ${on}${dom}${describeSchedule(g.schedule)}`;
}
const SWITCHES = { tunnel_sensitive: 'Sensitive Actions from Outside', tunnel_cameras: 'Cameras from Outside', tunnel_locations: 'Location History from Outside' };
function pRoles(sub) {
  const base = '#/' + ROUTE + '/roles';
  if (sub[0] === 'role' && sub[1]) return pRole(sub[1]);
  if (sub[0] === 'add-grant') return pAddGrant();
  if (sub[0] === 'rooms') return pRooms();
  return { title: 'Roles & Grants', top: true, scope: 'What each role may do by default, and the grants that add to or take away from it. Owners always keep every permission.', body(c) {
    result(c, 'roles');
    const rr = load('roles', () => api('GET', '/api/rbac/roles'));
    if (!rr) pending(c); else if (rr.err) failed(c, rr.err);
    else c.appendChild(group({ header: 'Roles' }, Object.values(rr.data.roles).map((r) => nav(roleLabel(r.name), 'roles/role/' + encodeURIComponent(r.name), {
      sub: r.grants.length + ' grant' + (r.grants.length === 1 ? '' : 's') + (r.overridden ? ' · changed' : '') }))));
    const gg = load('grants', () => Promise.all([api('GET', '/api/rbac/grants'), api('GET', '/api/users'), api('GET', '/api/devices')]));
    if (!gg) { pending(c); return; }
    if (gg.err) { failed(c, gg.err); return; }
    const [{ grants }, { users }, { devices }] = gg.data;
    const uname = Object.fromEntries(users.map((u) => [u.id, u.name || u.username || u.id]));
    const dname = Object.fromEntries(devices.map((d) => [d.id, d.name]));
    const who = (g) => [...g.roles.map(roleLabel), ...g.users.map((u) => uname[u] || u), ...g.devices.map((d) => (dname[d] || d) + ' (tablet)')].join(', ');
    c.appendChild(group({ header: 'Grants', footer: grants.length ? null : 'No extra grants. Everyone has just their role’s defaults.' },
      grants.map((g) => info(who(g), describeGrant(g) + (g.note ? ' · ' + g.note : ''), g.effect === 'deny' ? 'Deny' : 'Allow', g.effect === 'deny' ? 'warn' : ''))
        .concat([K().nav({ label: 'Add a Grant…', href: base + '/add-grant', icon: 'mdi:plus', fk: 'mx:add-grant' })])));
    if (grants.length) c.appendChild(group({}, grants.map((g) => button('Remove: ' + describeGrant(g), async () => {
      if (!(await ask({ title: 'Remove this grant?', message: describeGrant(g), ok: 'Remove', destructive: true }))) return;
      act('roles', () => api('DELETE', '/api/rbac/grants/' + g.id), 'Grant removed.', 'grants', 'roles');
    }, { destructive: true, fk: 'mx:remove-grant:' + g.id }))));
    c.appendChild(group({ footer: 'A Child’s or Guest’s rooms, or a wall tablet’s room, are what “their areas” means in a grant.' },
      [K().nav({ label: 'Rooms for a Person or Tablet', href: base + '/rooms', icon: 'mdi:floor-plan', fk: 'mx:rooms' })]));
  } };
}
function pRole(name) {
  return { title: roleLabel(name), back: ['Roles & Grants', '#/' + ROUTE + '/roles'], body(c) {
    const rr = load('roles', () => api('GET', '/api/rbac/roles'));
    if (!rr) { pending(c); return; }
    if (rr.err) { failed(c, rr.err); return; }
    const r = rr.data.roles[name];
    if (!r) { c.appendChild(group({ footer: 'There is no such role.' }, [])); return; }
    c.appendChild(group({ header: 'Its Own Grants', footer: r.overridden ? 'Changed from Mantel’s defaults.' : null },
      r.grants.length ? r.grants.map((g) => info(describeGrant(g))) : [info('No grants of its own')]));
    const sw = Object.entries(SWITCHES).filter(([k]) => k in r);
    if (sw.length) c.appendChild(group({ header: 'From Outside the Home' }, sw.map(([k, label]) => info(label, null, r[k] ? 'Yes' : 'No'))));
  } };
}
function pAddGrant() {
  const back = ['Roles & Grants', '#/' + ROUTE + '/roles'];
  return { title: 'Add a Grant', back, body(c) {
    result(c, 'grant');
    const gg = load('grants', () => Promise.all([api('GET', '/api/rbac/grants'), api('GET', '/api/users'), api('GET', '/api/devices')]));
    if (!gg) { pending(c); return; }
    if (gg.err) { failed(c, gg.err); return; }
    const [, { users }, { devices }] = gg.data;
    const d = draft('grant');
    const targets = { roles: me.roles.map((r) => [r, roleLabel(r)]), users: users.map((u) => [u.id, u.name || u.username || u.id]),
                      devices: devices.filter((x) => !x.revoked).map((x) => [x.id, x.name + (x.room ? ' (' + x.room + ')' : '')]) };
    if (!d.target_kind) d.target_kind = 'roles';
    const list = targets[d.target_kind];
    if (!list.some(([v]) => v === d.target)) d.target = list.length ? list[0][0] : '';
    c.appendChild(group({ header: 'Who' }, [
      choose('grant', 'target_kind', 'Applies To', [['roles', 'A Role'], ['users', 'A Person'], ['devices', 'A Wall Tablet']], 'roles', redraw),
      list.length ? K().select({ label: 'Which', options: list, value: d.target, fk: 'mx:grant:target', onChange: (v) => { d.target = v; } }) : info('Which', null, 'None')]));
    c.appendChild(group({ header: 'Effect' }, [K().seg({ label: 'Effect', options: [['allow', 'Allow'], ['deny', 'Deny']], value: d.effect || 'allow', fk: 'mx:grant:effect',
      onChange: (v) => { d.effect = v; redraw(); } })]));
    c.appendChild(group({ header: 'Actions' }, ticks('grant', 'actions', me.actions.concat(['*']).map((a) => [a, a === '*' ? 'Everything (*)' : a]), ['view'])));
    if (!d.kind) d.kind = 'area';
    const on = [choose('grant', 'kind', 'Kind', me.resource_kinds.map((k) => [k, k]), 'area', redraw)];
    if (d.kind === 'feature') on.push(choose('grant', 'feature', 'Which Feature', me.features.map((f) => [f, f]), 'cameras'));
    else if (d.kind !== 'all') on.push(field('grant', 'resource', 'Which One', { placeholder: 'light.kitchen, kitchen, 1st floor' }));
    on.push(field('grant', 'domains', 'Only These Domains', { placeholder: 'light, switch' }));
    c.appendChild(group({ header: 'On What', footer: 'Domains are optional, separated by commas.' }, on));
    c.appendChild(group({ header: 'When', footer: 'Optional. Times of day are the house’s; the start and end dates are this browser’s clock. The days are the ones the window starts on.' }, [
      field('grant', 'start', 'From', { type: 'time' }), field('grant', 'end', 'Until', { type: 'time' }),
      field('grant', 'not_before', 'Starting', { type: 'datetime-local' }), field('grant', 'not_after', 'Ending', { type: 'datetime-local' })]));
    c.appendChild(group({ header: 'Days' }, ticks('grant', 'days', DAYS.map((x, i) => [String(i), x]), DAYS.map((x, i) => String(i)))));
    c.appendChild(group({}, [field('grant', 'note', 'Note', { maxlength: 200 })]));
    c.appendChild(group({}, [button('Add Grant', async () => {
      const body = { effect: d.effect || 'allow', actions: d.actions.slice(), resource_kind: d.kind,
        resource: d.kind === 'feature' ? d.feature : d.kind === 'all' ? '' : (d.resource || '').trim(),
        domains: (d.domains || '').split(',').map((s) => s.trim()).filter(Boolean),
        [d.target_kind]: d.target ? [d.target] : [], note: (d.note || '').trim() };
      const sched = {};
      if (d.start || d.end) { sched.start = d.start || ''; sched.end = d.end || ''; }
      const days = (d.days || []).map(Number);
      if (days.length && days.length < 7) sched.days = days;
      if (d.not_before) sched.not_before = new Date(d.not_before).getTime() / 1000;
      if (d.not_after) sched.not_after = new Date(d.not_after).getTime() / 1000;
      if (Object.keys(sched).length) body.schedule = sched;
      if (!body.actions.length) { flash = { key: 'grant', text: 'Pick at least one action.', err: true }; redraw(); return; }
      if (await act('grant', () => api('POST', '/api/rbac/grants', body), 'Grant added.', 'grants', 'roles')) {
        clearDraft('grant'); flash = { key: 'roles', text: 'Grant added.' }; panel.go(back[1]);
      }
    }, { center: true, fk: 'mx:save-grant' })]));
  } };
}
function pRooms() {
  return { title: 'Rooms', back: ['Roles & Grants', '#/' + ROUTE + '/roles'], body(c) {
    result(c, 'rooms');
    const base = load('rooms-base', () => Promise.all([api('GET', '/api/users'), api('GET', '/api/devices'),
      fetch(mantelUrl('/api/areas'), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : []))]));
    if (!base) { pending(c); return; }
    if (base.err) { failed(c, base.err); return; }
    const [{ users }, { devices }, areas] = base.data;
    const d = draft('rooms');
    if (!d.kind) d.kind = 'user';
    const list = d.kind === 'user' ? users.map((u) => [u.id, `${u.name || u.username} (${roleLabel(u.role)})`])
      : devices.filter((x) => !x.revoked).map((x) => [x.id, x.name + (x.room ? ' (' + x.room + ')' : '')]);
    if (!list.some(([v]) => v === d.subject)) d.subject = list.length ? list[0][0] : '';
    c.appendChild(group({ header: 'Who' }, [
      choose('rooms', 'kind', 'Kind', [['user', 'A Person'], ['device', 'A Wall Tablet']], 'user', () => { delete d.areas; redraw(); }),
      list.length ? K().select({ label: 'Which', options: list, value: d.subject, fk: 'mx:rooms:subject', onChange: (v) => { d.subject = v; delete d.areas; redraw(); } }) : info('Which', null, 'Nobody')]));
    if (!d.subject) return;
    const key = 'scope:' + d.kind + ':' + d.subject;
    const cur = load(key, () => api('GET', `/api/rbac/scopes/${d.kind}/${encodeURIComponent(d.subject)}`));
    if (!cur) { pending(c); return; }
    if (cur.err) { failed(c, cur.err); return; }
    if (!Array.isArray(d.areas)) d.areas = cur.data.areas.slice();
    const known = new Set(areas.map((a) => a.id));
    const options = areas.map((a) => [a.id, a.name]).concat(cur.data.areas.filter((a) => !known.has(a)).map((a) => [a, a]));
    c.appendChild(group({ header: 'Their Rooms', footer: options.length ? null : 'Home Assistant has not told Mantel about any areas yet.' }, ticks('rooms', 'areas', options, d.areas)));
    c.appendChild(group({}, [button('Save Rooms', () => act('rooms', () => api('PUT', `/api/rbac/scopes/${d.kind}/${encodeURIComponent(d.subject)}`, { areas: d.areas.slice() }), 'Rooms saved.', key),
      { center: true, fk: 'mx:save-scopes' })]));
  } };
}

// ============================================================================================ Your files
const ASSET_SLOTS = [
  { id: 'woff2', label: 'SF Pro (woff2)', hint: 'SF-Pro.woff2, the font every screen uses.', accept: '.woff2', kind: 'font', name: 'SF-Pro.woff2' },
  { id: 'ttf', label: 'SF Pro (ttf)', hint: 'SF-Pro.ttf, only needed if you have no woff2.', accept: '.ttf', kind: 'font', name: 'SF-Pro.ttf' },
  { id: 'glyphs', label: 'HK Glyphs', hint: 'hk-glyphs.js, the SF Symbols icon set.', accept: '.js,.json', kind: 'glyphs', name: 'hk-glyphs.js' },
];
function pFiles(sub) {
  if (sub[0] === 'photos' && can('photos')) return photos.page(sub.slice(1), photoTools);
  return { title: 'Your Files', top: true, scope: 'Your home’s own files, kept in Mantel’s data and its encrypted backups: the screensavers’ photos, and Apple’s font and glyphs.', body(c) {
    result(c, 'files');
    if (can('photos')) {
      c.appendChild(group({ header: 'Photos', footer: 'Albums of photos for the screensavers: upload them here, then pick an album on a screen’s Screensaver Options, or for every screen on All Screens → Screensaver.' },
        [photos.filesRow(photoTools)]));
    }
    const got = load('files', () => api('GET', '/api/user-files'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const inf = got.data;
    const have = { woff2: inf.fonts.find((f) => f.name === 'SF-Pro.woff2'), ttf: inf.fonts.find((f) => f.name === 'SF-Pro.ttf'),
                   glyphs: inf.glyphs.present ? { size: inf.glyphs.size } : null };
    ASSET_SLOTS.forEach((slot, i) => {
      const cur = have[slot.id];
      const input = hh('input', { type: 'file', accept: slot.accept, class: 'mxfile', 'aria-label': 'Choose ' + slot.label, 'data-fk': 'mx:file-' + slot.id });
      input.addEventListener('change', () => {
        if (!input.files.length) return;
        const fd = new FormData();
        fd.append('name', slot.name);
        fd.append('file', input.files[0], input.files[0].name);
        act('files', () => api('POST', '/api/user-files/' + slot.kind, fd), slot.label + ' saved.', 'files');
      });
      const rows = [info(slot.label, slot.hint, cur ? 'In Place · ' + kb(cur.size) : 'Missing', cur ? '' : 'warn'),
        button((cur ? 'Replace ' : 'Upload ') + slot.label + '…', () => input.click(), { fk: 'mx:upload-' + slot.id })];
      if (cur) rows.push(button('Remove ' + slot.label + '…', async () => {
        if (!(await ask({ title: 'Remove ' + slot.label + '?', message: 'Screens fall back to the system font or plain icons until you add it again.', ok: 'Remove', destructive: true }))) return;
        act('files', () => api('DELETE', '/api/user-files/' + slot.kind + '/' + slot.name), slot.label + ' removed.', 'files');
      }, { destructive: true, fk: 'mx:remove-' + slot.id }));
      const g = group(i ? {} : { header: 'Font and Glyphs' }, rows);
      g.appendChild(input);
      c.appendChild(g);
    });
    c.appendChild(group({ footer: 'SF Pro and the SF Symbols glyph set are Apple’s, so they can’t ship with Mantel: each home adds its own copy once. ' +
      `Used ${kb(inf.usage)} of ${kb(inf.quota)}. They are kept in Mantel’s data, included in its encrypted backups, and nothing here is ever run as code. ` +
      'On a Home Assistant install they are under /config/www/hk (fonts/ and iconset/). From the command line: mantel files import-assets <folder>.' }, []));
  } };
}

// ============================================================================================ Service accounts
function pService(sub) {
  if (sub[0] === 'add') return pAddService();
  return { title: 'Service Accounts', top: true, scope: 'Machine credentials, like the one HK Frontend in Home Assistant uses to link to Mantel. No password, no session and no role: only the endpoints ticked. Managed on the home network only.', body(c) {
    result(c, 'service');
    const t = shown.service;
    if (t) {
      c.appendChild(group({ header: 'Credential for ' + t.account.name, footer: 'This is the only time it is shown. Paste it where it is needed (Home Assistant: Settings, Devices & Services, HK Frontend, Configure, Linked to Mantel Server). Mantel keeps only a hash.' },
        [secretCell(t.token, 'service-token'), copyButton(t.token), button('I Have Saved It', () => { delete shown.service; redraw(); }, { fk: 'mx:dismiss-token' })]));
    }
    const got = load('service', () => api('GET', '/api/service-accounts'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const all = got.data.accounts, live = all.filter((a) => !a.revoked), gone = all.filter((a) => a.revoked);
    const row = (a) => info(a.name, `${a.scopes.join(', ')} · created ${fmt(a.created)} · last used ${ago(a.last_used)}${a.last_ip ? ' from ' + a.last_ip : ''}`, a.revoked ? 'Revoked' : undefined, a.revoked ? 'warn' : '');
    c.appendChild(group({ header: 'Service Accounts' }, (live.length ? live.map(row) : [info('No service accounts')])
      .concat([nav('New Service Account…', 'service/add', { icon: 'mdi:plus' })])));
    if (live.length) c.appendChild(group({}, live.map((a) => button('Revoke ' + a.name + '…', async () => {
      if (!(await ask({ title: 'Revoke ' + a.name + '?', message: 'Whatever uses this credential is cut off at once.', ok: 'Revoke', destructive: true }))) return;
      act('service', () => api('DELETE', '/api/service-accounts/' + encodeURIComponent(a.id)), 'Service account revoked.', 'service');
    }, { destructive: true, fk: 'mx:revoke-service:' + a.id }))));
    if (gone.length) c.appendChild(group({ header: 'Revoked' }, gone.map(row)));
  } };
}
function pAddService() {
  const back = ['Service Accounts', '#/' + ROUTE + '/service'];
  return { title: 'New Service Account', back, body(c) {
    result(c, 'addservice');
    c.appendChild(group({}, [field('service', 'name', 'Name', { placeholder: 'home-assistant', maxlength: 64 })]));
    c.appendChild(group({ header: 'What It May Reach' }, ticks('service', 'scopes', me.service_scopes.map((s) => [s, s]), me.service_scopes)));
    c.appendChild(group({}, [button('Create Service Account', async () => {
      const d = draft('service');
      const r = await act('addservice', () => api('POST', '/api/service-accounts', { name: (d.name || '').trim(), scopes: d.scopes.slice() }), null, 'service');
      if (r) { shown.service = r; clearDraft('service'); panel.go(back[1]); }
    }, { center: true, fk: 'mx:create-service' })]));
  } };
}

// ============================================================================================ Mantel Connect
let pairTimer = null;
function pConnect() {
  return { title: 'Mantel Connect', top: true, scope: 'Puts Mantel in Home Assistant’s sidebar and the Companion app when Mantel runs outside Home Assistant. Home Assistant signs people in; their Mantel roles still decide what they see. Managed on the home network only.', body(c) {
    result(c, 'connect');
    const code = shown.pair;
    if (code) {
      const left = code.expires - nowS();
      c.appendChild(group({ header: 'Pairing Code', footer: 'Valid once, for ' + (left > 0 ? Math.ceil(left / 60) + ' min' : 'no longer: it expired') +
        '. In Home Assistant open Settings, Apps, Mantel Connect, Configuration. Enter this Mantel address and the code, press Save, then Restart the App.' },
        [secretCell(code.code, 'pairing-code'), secretCell(code.address, 'pairing-address'), copyButton(code.code, 'Copy Code'),
         button('Withdraw This Code', async () => { await act('connect', () => api('DELETE', '/api/connect/pair')); delete shown.pair; redraw(); }, { destructive: true, fk: 'mx:dismiss-code' })]));
    } else {
      c.appendChild(group({ header: 'Pair the Mantel Connect App', footer: 'The address Home Assistant should use to reach Mantel. You get a one-time code that works for ten minutes.' }, [
        field('pair', 'address', 'Address', { value: `${location.hostname}:${me.connect_port}`, maxlength: 100 }),
        button('Start Pairing', async () => {
          const r = await act('connect', () => api('POST', '/api/connect/pair', {}));
          if (!r) return;
          shown.pair = { ...r, address: (draft('pair').address || '').trim() };
          watchPairing(r);
          redraw();
        }, { fk: 'mx:start-pairing' })]));
    }
    const got = load('connect', () => api('GET', '/api/connect'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const live = got.data.pairings.filter((p) => !p.revoked), gone = got.data.pairings.filter((p) => p.revoked);
    const row = (p) => info(p.name, `Paired ${fmt(p.created)} · last seen ${ago(p.last_seen)}${p.last_ip ? ' from ' + p.last_ip : ''} · certificate until ${fmt(p.cert_expires)}`, p.revoked ? 'Revoked' : undefined, p.revoked ? 'warn' : '');
    c.appendChild(group({ header: 'Paired Apps' }, live.length ? live.map(row) : [info('Nothing is paired yet')]));
    if (live.length) c.appendChild(group({}, live.map((p) => button('Revoke ' + p.name + '…', async () => {
      if (!(await ask({ title: 'Revoke ' + p.name + '?', message: 'The Mantel Connect App is cut off at once and its open connections are closed. To use Mantel in Home Assistant again you pair it anew.', ok: 'Revoke', destructive: true }))) return;
      act('connect', () => api('DELETE', '/api/connect/pairings/' + encodeURIComponent(p.id)), 'Connection revoked.', 'connect');
    }, { destructive: true, fk: 'mx:revoke-connect:' + p.id }))));
    if (gone.length) c.appendChild(group({ header: 'Revoked' }, gone.map(row)));
  } };
}
// while a code is shown, notice when it is spent (paired) or has expired
function watchPairing(r) {
  clearInterval(pairTimer);
  pairTimer = setInterval(async () => {
    if (!shown.pair) { clearInterval(pairTimer); return; }
    try {
      const got = await api('GET', '/api/connect');
      if (!got.pending) {
        clearInterval(pairTimer);
        const paired = got.pairings.some((p) => !p.revoked && p.created >= r.expires - got.ttl - 1);
        delete shown.pair;
        flash = { key: 'connect', text: paired ? 'Paired. The code is spent.' : 'The code expired or was withdrawn.', err: !paired };
        forget('connect');
      }
      redraw();
    } catch (e) { /* the next tick tries again */ }
  }, 4000);
}

// ============================================================================================ Connections
const SOURCE_LABEL = { app: 'Provided by Home Assistant (App)', mantel: 'Saved in Mantel', install: 'Set by the Installation' };
const METHOD_LABEL = { oauth: 'Home Assistant sign-in', token: 'pasted token', login: 'Music Assistant sign-in' };
function testedSays(kind, r, warnings) {
  const user = (r && r.user) || {};
  const bits = [];
  if (user.name) bits.push('as ' + user.name + (user.is_admin ? ' (administrator)' : ''));
  if (r && r.version) bits.push((kind === 'ha' ? 'Home Assistant ' : 'Music Assistant ') + r.version);
  if (kind === 'ha' && r && typeof r.entities === 'number') bits.push(r.entities + ' entities');
  return ['It works: connected ' + bits.join(' · ') + '.'].concat(warnings || []).join(' ');
}
function pConnections(sub) {
  if (sub[0] === 'ha' || sub[0] === 'ma') return pConnection(sub[0]);
  if (sub[0] === 'ma-page') return pMaPage();
  if (sub[0] === 'proxy') return pProxy();
  if (sub[0] === 'link') return pLink();
  return { title: 'Connections', top: true, scope: 'How Mantel reaches Home Assistant and Music Assistant. Each connection is tested before it is saved. Tokens are kept sealed in Mantel’s data, never shown again and never leave the server; a change applies at once.', body(c) {
    result(c, 'connections');
    const pid = new URLSearchParams(location.search).get('connection');
    if (pid) drawPending(c, pid);
    const got = load('connections', () => api('GET', '/api/connections'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const can = got.data.can_edit, cs = got.data.connections;
    const row = (kind) => {
      const x = cs[kind], now = x.live || {};
      const value = x.state !== 'set' ? 'Not Set Up' : now.connected ? 'Connected' : 'Not Connected';
      return nav(x.label, 'connections/' + kind, { value, sub: x.url || null, icon: kind === 'ha' ? 'mdi:home-assistant' : 'mdi:music' });
    };
    const rows = [row('ha'), row('ma')];
    if (cs.ma && cs.ma.state === 'set') rows.push(nav('Music Assistant Page', 'connections/ma-page', { icon: 'mdi:music-box-multiple', sub: 'Signs HK’s Browse Music page in to Music Assistant' }));
    c.appendChild(group({ footer: !can ? 'Only an Owner can change connections.' : got.data.needs_fresh ? 'From outside the home network you will be asked to confirm it is you first.' : null }, rows));
    drawWallTablets(c);
    if (['owner', 'admin'].includes(me.user.role)) c.appendChild(group({ footer: 'Mantel Link is Home Assistant’s side of Mantel: Mantel’s wall tablets and actions in Home Assistant.' },
      [nav('Home Assistant Link', 'connections/link', { icon: 'mdi:link-variant' })]));
    if (['owner', 'admin'].includes(me.user.role)) c.appendChild(group({ footer: 'How browsers reach Mantel: Mantel’s Caddy, your own reverse proxy, the Home Assistant App or a Cloudflare tunnel.' },
      [nav('HTTPS and Your Proxy', 'connections/proxy', { icon: 'mdi:lock' })]));
  } };
}
function drawPending(c, pid) {
  const key = 'pending:' + pid;
  const got = load(key, () => api('GET', '/api/connections/pending/' + encodeURIComponent(pid)));
  const clear = () => { history.replaceState(null, '', location.pathname + location.hash); forget(key); };
  if (!got) { pending(c, 'Reading what Home Assistant said…'); return; }
  if (got.err) { failed(c, got.err); return; }
  const p = got.data.pending;
  if (p.state !== 'ready') { c.appendChild(group({ header: 'Connect to Home Assistant', footer: hh('span', { class: 'mxerr', text: p.error ? p.error.message : 'The sign-in did not finish.' }) }, [])); return; }
  const r = p.result;
  c.appendChild(group({ header: 'Connect to Home Assistant', footer: `Home Assistant at ${p.url} says Mantel would act as ${(r.user && r.user.name) || 'that user'}${r.user && r.user.is_admin ? ' (an administrator)' : ''}. ` + testedSays('ha', r, p.warnings) }, [
    button('Save This Connection', async () => {
      if (await act('connections', () => api('POST', '/api/connections/ha', { pending: p.id }), 'Home Assistant connected.', 'connections')) { clear(); afterHa(); }
    }, { fk: 'mx:ha-oauth-save' }),
    button('Cancel', async () => { await act('connections', () => api('DELETE', '/api/connections/pending/' + encodeURIComponent(p.id))); clear(); redraw(); }, { destructive: true, fk: 'mx:ha-oauth-cancel' })]));
}
// Home Assistant connected for the first time: HK's own settings can be read now
function afterHa() { if (me && me.ha_set_up === false) setTimeout(() => location.reload(), 600); }
function pConnection(kind) {
  const back = ['Connections', '#/' + ROUTE + '/connections'];
  const got = load('connections', () => api('GET', '/api/connections'));
  const x = got && got.data && got.data.connections[kind];
  return { title: x ? x.label : 'Connection', back, body(c) {
    result(c, 'conn-' + kind);
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const can = got.data.can_edit, now = x.live || {}, saved = x.saved, set = x.state === 'set';
    const rows = [info('Status', null, set ? (now.connected ? 'Connected' : 'Not Connected') : 'Not Set Up', set && now.connected ? '' : 'warn')];
    if (x.source) rows.push(info('From', null, SOURCE_LABEL[x.source] || x.source));
    if (x.url) rows.push(info('Address', null, x.url));
    if (saved) rows.push(info('Connected As', `Since ${fmt(saved.since)} · ${METHOD_LABEL[saved.method] || saved.method}${saved.by_name ? ' · set by ' + saved.by_name : ''}` +
      (saved.expires ? ' · the token expires ' + fmt(saved.expires) + '; replace it before then' : ''),
      saved.user && saved.user.name ? saved.user.name + (saved.user.is_admin ? ' (Admin)' : '') : '—'));
    if (set && now.connected) {
      if (now.version) rows.push(info('Version', null, now.version));
      if (typeof now.entities === 'number') rows.push(info('Entities', null, String(now.entities)));
    }
    const notes = [];
    if (set && !now.connected && now.error) notes.push('Not connected: ' + now.error);
    if (x.source === 'install') notes.push('This comes from the installation’s secret file' + (x.install.file ? ' (' + x.install.file + ')' : '') + '. Replace saves Mantel’s own copy, which then wins; disconnecting that copy goes back to the file.');
    if (x.install && x.install.overridden) notes.push('The installation also has a file for this; Mantel’s saved copy wins over it.');
    if (x.unreadable) notes.push('Mantel’s saved copy could not be opened (was the at-rest key changed?). Set it up again.');
    if (!x.editable) notes.push('Mantel runs as a Home Assistant App and uses the App’s own access to Home Assistant. Nothing to set up here.');
    c.appendChild(group({ footer: notes.join(' ') || null }, rows));
    if (!x.editable || !can) return;
    const out = shown['test:' + kind];
    const d = draft('conn-' + kind);
    if (set && !d.open) {
      const acts = [button('Replace…', () => { d.open = true; redraw(); }, { fk: 'mx:replace-' + kind })];
      if (x.source === 'mantel' || x.unreadable) acts.push(button('Disconnect…', async () => {
        const back2 = x.install && x.install.present ? ' Mantel goes back to the installation’s file.' : ' Mantel stops using ' + x.label + ' until it is set up again.';
        const revoke = kind === 'ha' ? ' To revoke the token in Home Assistant as well: that user’s profile, Security, Long-lived access tokens.' : '';
        if (!(await ask({ title: 'Disconnect ' + x.label + '?', message: 'Mantel forgets its saved token.' + back2 + revoke, ok: 'Disconnect', destructive: true }))) return;
        act('conn-' + kind, () => api('DELETE', '/api/connections/' + kind), x.label + ' disconnected.', 'connections');
      }, { destructive: true, fk: 'mx:disconnect-' + kind }));
      c.appendChild(group({}, acts));
      return;
    }
    const body = (mode) => {
      const b = { url: (d.url || '').trim() };
      if (mode === 'login') { b.username = (d.username || '').trim(); b.password = d.password || ''; } else b.token = (d.token || '').trim();
      return b;
    };
    const test = (mode) => async () => {
      shown['test:' + kind] = { text: 'Testing…' }; redraw();
      try { const r = await api('POST', '/api/connections/' + kind + '/test', body(mode)); shown['test:' + kind] = { text: testedSays(kind, r.result, r.warnings) }; }
      catch (e) { shown['test:' + kind] = { text: e.message, err: true }; }
      redraw();
    };
    const save = (mode) => async () => {
      shown['test:' + kind] = { text: 'Testing and saving…' }; redraw();
      try {
        const r = await api('POST', '/api/connections/' + kind, body(mode));
        clearDraft('conn-' + kind); delete shown['test:' + kind];
        const as = r.connection && r.connection.saved && r.connection.saved.user && r.connection.saved.user.name;
        flash = { key: 'conn-' + kind, text: x.label + ' connected' + (as ? ' as ' + as : '') + '.' };
        forget('connections');
        if (kind === 'ha') afterHa();
      } catch (e) { shown['test:' + kind] = { text: e.message, err: true }; }
      redraw();
    };
    const suggested = !x.url && x.suggested_url && x.suggested_from === 'music_assistant_app';
    c.appendChild(group({ header: 'Address', footer: suggested ? 'Found Music Assistant’s App: press Test.' : null },
      [field('conn-' + kind, 'url', 'Address', { type: 'url', maxlength: 300, value: x.url || x.suggested_url || '',
        placeholder: kind === 'ha' ? 'http://homeassistant.local:8123' : 'http://music-assistant.local:8095' })]));
    if (kind === 'ha') {
      c.appendChild(group({ header: 'Sign In to Home Assistant', footer: 'Home Assistant opens its sign-in page. Sign in there as the Home Assistant user Mantel should act as: a dedicated administrator (for example one named mantel-server), not your own account. Mantel then makes a long-lived token for that user and keeps it sealed.' },
        [button('Connect to Home Assistant…', async () => {
          try { const r = await api('POST', '/api/connections/ha/oauth/start', { url: (d.url || '').trim() }); location.assign(r.authorize_url); }
          catch (e) { shown['test:ha'] = { text: e.message, err: true }; redraw(); }
        }, { fk: 'mx:ha-oauth' })]));
    } else {
      c.appendChild(group({ header: 'Sign In with a Music Assistant User', footer: 'Music Assistant 2.7 and later. The password is used once to make a long-lived token for that user, and is not kept.' }, [
        field('conn-ma', 'username', 'User Name', { maxlength: 200 }), field('conn-ma', 'password', 'Password', { type: 'password', maxlength: 1024 }),
        button('Test', test('login'), { fk: 'mx:ma-login-test' }), button('Save', save('login'), { fk: 'mx:ma-login-save' })]));
    }
    c.appendChild(group({ header: 'Or Paste a Long-Lived Token', footer: kind === 'ha' ? 'In Home Assistant, signed in as Mantel’s user: your profile, Security, Long-lived access tokens, Create token.'
      : 'In Music Assistant: Settings, your profile, create a long-lived token.' }, [
      field('conn-' + kind, 'token', 'Token', { type: 'password', maxlength: 4096 }),
      button('Test', test('token'), { fk: 'mx:' + kind + '-token-test' }), button('Save', save('token'), { fk: 'mx:' + kind + '-token-save' })]));
    if (out) c.appendChild(hh('p', { class: 'mxflash' + (out.err ? ' err' : ''), role: out.err ? 'alert' : 'status', text: out.text }));
    if (set) c.appendChild(group({}, [button('Cancel', () => { clearDraft('conn-' + kind); delete shown['test:' + kind]; redraw(); }, { fk: 'mx:replace-cancel' })]));
  } };
}
// A WALL TABLET'S DIRECT CONNECTION (tablet_links.py; docs/phase8/KIOSK.md, slice 1): Mantel reading the tablet's
// kiosk app itself. Paired on the tablet's own page (Wall Tablets → the tablet, drawn through the panel's
// extend('tablet', ...)), listed here. Status only: Mantel sends a tablet no commands yet.
const KIOSK_WHERE = { kiosk_satellite: 'Kiosk Satellite: Settings → Device → Remote Administration',
                      fully: 'Fully Kiosk: Settings → Remote Administration (needs Fully PLUS)' };
const tabletHref = (tid) => '#/house/tablets/' + encodeURIComponent(tid);
function liveSays(live) {
  if (!live) return null;
  if (!live.ok) return live.error ? live.error.message : 'It did not answer.';
  const i = live.info || {}, bits = [];
  if (i.screen_on === true) bits.push('Screen on' + (typeof i.brightness === 'number' ? ' at ' + i.brightness + '%' : ''));
  if (i.screen_on === false) bits.push('Screen off');
  if (i.screensaver) bits.push('Screensaver showing');
  if (typeof i.battery === 'number') bits.push('Battery ' + i.battery + '%' + (i.charging ? ', charging' : ''));
  return bits.join(' · ') || 'Connected.';
}
function drawWallTablets(c) {
  const got = load('tablets-live', () => api('GET', '/api/connections/tablets?live=1'));
  if (!got) { pending(c, 'Reading the wall tablets…'); return; }
  if (got.err) { failed(c, got.err); return; }
  const ts = got.data.tablets.filter((t) => t.supported || t.state === 'set');
  if (!ts.length) return;
  c.appendChild(group({ header: 'Wall Tablets', footer: 'Mantel reads each tablet’s kiosk app itself, without Home Assistant. Pair a tablet on its own page. Status only for now: Mantel sends tablets no commands.' },
    ts.map((t) => {
      const live = t.live, value = t.state !== 'set' ? 'Not Set Up' : t.unreadable ? 'Pair Again' : !live ? '' : live.ok ? 'Connected' : 'Not Connected';
      return K().nav({ label: t.name, sub: [t.app_label, t.url ? t.url.replace(/^http:\/\//, '') : null, t.state === 'set' ? liveSays(live) : null].filter(Boolean).join(' · '),
                       value, href: tabletHref(t.id), icon: 'mdi:tablet', fk: 'mx:tablet:' + t.id });
    })));
}
// The group on the tablet's own page
// HK Settings' own data again (panel/get): a tablet paired or disconnected gains or loses its Reload parts
function reloadPanel() {
  const p = panel;
  if (p && typeof p.reload === 'function') Promise.resolve(p.reload()).then(() => p.render()).catch(() => {});
}
// A PAIRED TABLET'S RELOAD AND CLEAR CACHE (host.press): HK Settings' parts "mantel-tablet:<id>:<verb>"
// (tablet_links.panel_parts), each sent through the command gateway (POST .../command: RBAC, the audit row; refused
// with commands off). Every one is sent; a failure says which tablets.
const TABLET_PART = /^mantel-tablet:([a-z0-9_]{1,64}):(reload|clear_cache)$/;
function pressTablets(ids, p) {
  const mine = ids.map((id) => TABLET_PART.exec(String(id))).filter(Boolean);
  if (!mine.length) return null;
  const names = (p && p.tabs && p.tabs()) || {};
  return Promise.all(mine.map(([, tid, verb]) =>
    api('POST', '/api/connections/tablets/' + encodeURIComponent(tid) + '/command', { verb }).then(() => null, (e) => ({ tid, e }))))
    .then((got) => {
      const bad = got.filter(Boolean);
      if (!bad.length) return;
      const say = (b) => ((names[b.tid] && names[b.tid].name) || b.tid);
      const same = bad.every((b) => b.e.message === bad[0].e.message);
      if (mine.length === 1) throw new Error(bad[0].e.message);
      throw new Error(bad.map(say).join(', ') + (bad.length === 1 ? ': ' : ' — ') +
        (same ? bad[0].e.message : bad.map((b) => say(b) + ': ' + b.e.message).join(' ')));
    });
}

function drawDirect(c, ctx) {
  if (!can('connections')) return;
  const tid = ctx.tablet, key = 'tablet:' + tid, form = 'direct-' + tid;
  const got = load('tablets', () => api('GET', '/api/connections/tablets'));
  if (!got) { pending(c, 'Reading its direct connection…'); return; }
  if (got.err) { failed(c, got.err); return; }
  const t = got.data.tablets.find((x) => x.id === tid);
  if (!t) return;
  const header = 'Direct Connection';
  if (!t.supported) {
    c.appendChild(group({ header, footer: 'Mantel can talk to Kiosk Satellite and Fully Kiosk directly. This tablet’s Kiosk App has no direct connection.' }, []));
    return;
  }
  const can2 = got.data.can_edit, set = t.state === 'set', sv = t.saved || {};
  const rows = [];
  if (set) {
    const live = load('tablet-live:' + tid, () => api('GET', '/api/connections/tablets/' + encodeURIComponent(tid) + '/live'));
    const lv = live && live.data && live.data.live;
    rows.push(info('Status', lv ? liveSays(lv) : 'Reading it now…', !lv ? '' : lv.ok ? 'Connected' : 'Not Connected', lv && !lv.ok ? 'warn' : ''));
    rows.push(info('Address', null, t.url.replace(/^http:\/\//, '')));
    const d = sv.device || {};
    rows.push(info('Paired As', [d.model, d.version ? t.app_label + ' ' + d.version : null, 'since ' + fmt(sv.since),
                                 sv.by_name ? 'by ' + sv.by_name : null].filter(Boolean).join(' · '), d.name || '—'));
    if (sv.expires) rows.push(info('Token Expires', null, new Date(sv.expires * 1000).toLocaleDateString([], { dateStyle: 'medium' })));
    if (lv && lv.ok && lv.info && lv.info.page) rows.push(info('Showing', lv.info.page));
  } else {
    rows.push(info('Status', null, t.unreadable ? 'Pair Again' : 'Not Set Up', t.unreadable ? 'warn' : ''));
  }
  const notes = [];
  if (t.unreadable) notes.push('Mantel’s saved copy could not be opened (was the at-rest key changed?). Pair it again.');
  if (sv.missing && sv.missing.length) notes.push('This ' + t.app_label + ' version lacks ' + sv.missing.join(', ') + ', which Mantel needs for its commands. Update the app.');
  notes.push('Mantel reads ' + t.app_label + ' on the tablet itself, without Home Assistant. The only commands it sends are Reload and ' +
             'Clear Cache & Reload (Actions, below, and All at Once on Wall Tablets), while commands are on; each is in the Audit Log.');
  if (!can2) notes.push('Only an Owner can pair a tablet.');
  c.appendChild(group({ header, footer: notes.join(' ') }, rows));
  result(c, key);
  if (!can2) return;
  const d = draft(form);
  if (set && !d.open) {
    c.appendChild(group({}, [
      button('Pair Again…', () => { d.open = true; redraw(); }, { fk: 'mx:direct-replace' }),
      button('Disconnect…', async () => {
        const why = t.app === 'kiosk_satellite' ? ' Kiosk Satellite’s tokens can’t be revoked from Mantel: the token Mantel had keeps working until it expires, unless the tablet’s remote administration is reset.' : '';
        if (!(await ask({ title: 'Disconnect ' + t.name + '?', message: 'Mantel forgets how to reach this tablet directly. Home Assistant’s own connection to it is not affected.' + why, ok: 'Disconnect', destructive: true }))) return;
        if (await act(key, () => api('DELETE', '/api/connections/tablets/' + encodeURIComponent(tid)), t.name + ' disconnected.', 'tablets', 'tablets-live', 'tablet-live:' + tid)) reloadPanel();
      }, { destructive: true, fk: 'mx:direct-disconnect' })]));
    return;
  }
  const body = () => ({ address: (d.address || '').trim(), password: d.password || '' });
  const out = shown['direct:' + tid];
  const run = (save) => async () => {
    shown['direct:' + tid] = { text: save ? 'Pairing…' : 'Testing…' }; redraw();
    try {
      const r = await api('POST', '/api/connections/tablets/' + encodeURIComponent(tid) + (save ? '' : '/test'), body());
      const i = (r.result && r.result.info) || {}, miss = (r.result && r.result.missing) || [];
      const says = 'It works: ' + [i.name, i.model, i.version ? t.app_label + ' ' + i.version : null].filter(Boolean).join(' · ') + '.' +
        (miss.length ? ' This version lacks ' + miss.join(', ') + '.' : '');
      if (save) {
        clearDraft(form); delete shown['direct:' + tid];
        flash = { key, text: t.name + ' paired. ' + says };
        forget('tablets', 'tablets-live', 'tablet-live:' + tid);
        reloadPanel();
      } else shown['direct:' + tid] = { text: says };
    } catch (e) { shown['direct:' + tid] = { text: e.message, err: true }; }
    redraw();
  };
  const addr = t.url || t.suggested_url || '';
  c.appendChild(group({ header: 'Pair ' + t.name, footer: (t.suggested_url && !t.url ? 'The address is the one ' + t.app_label + ' reports to Home Assistant. ' : '') +
    (t.app === 'kiosk_satellite'
      ? 'The password is the tablet’s Remote Administration password (' + KIOSK_WHERE.kiosk_satellite + '). Mantel uses it once, to have the tablet make a token, and does not keep it.'
      : 'The password is Fully’s Remote Admin password (' + KIOSK_WHERE.fully + '). Fully has no tokens, so Mantel keeps it sealed.') +
    ' Nothing is saved until it works.' }, [
    field(form, 'address', 'Address', { value: addr.replace(/^http:\/\//, ''), placeholder: t.app === 'fully' ? 'tablet address, port 2323' : 'tablet address, port 2324', maxlength: 300, inputmode: 'url' }),
    field(form, 'password', 'Password', { type: 'password', maxlength: 256 }),
    button('Test', run(false), { fk: 'mx:direct-test' }), button(set ? 'Pair Again' : 'Pair', run(true), { fk: 'mx:direct-save' })]));
  if (out) c.appendChild(hh('p', { class: 'mxflash' + (out.err ? ' err' : ''), role: out.err ? 'alert' : 'status', text: out.text }));
  if (set) c.appendChild(group({}, [button('Cancel', () => { clearDraft(form); delete shown['direct:' + tid]; redraw(); }, { fk: 'mx:direct-cancel' })]));
}

// THE TOKEN FOR THE MUSIC ASSISTANT PAGE (ma_page.py): an ordinary MA user's, separate from Mantel's own
function pMaPage() {
  return { title: 'Music Assistant Page', back: ['Connections', '#/' + ROUTE + '/connections'], body(c) {
    result(c, 'ma-page');
    const got = load('ma-page', () => api('GET', '/api/connections/ma/page'));
    const conns = load('connections', () => api('GET', '/api/connections'));
    if (!got || !conns) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const page = got.data.page, can = conns.data ? conns.data.can_edit : false;
    c.appendChild(group({ footer: 'HK’s Browse Music page shows Music Assistant’s own web app. With a token here, Mantel signs that page in to Music Assistant as an ordinary MA user (never an administrator), so nobody has to sign in to MA on each screen. The token stays sealed in Mantel; the page never sees it.' },
      [page.set && page.saved ? info('Signs In As', 'Since ' + fmt(page.saved.since) + (page.saved.expires ? '; expires ' + fmt(page.saved.expires) : ''), (page.saved.user && page.saved.user.name) || 'An MA User')
        : info('Signs In As', page.unreadable ? 'The saved token could not be opened (was the at-rest key changed?).' : 'Not set: the page shows Music Assistant’s own sign-in.', 'Nobody')]));
    if (!can) return;
    const d = draft('ma-page');
    const save = (body) => () => act('ma-page', async () => { const r = await api('POST', '/api/connections/ma/page', body()); clearDraft('ma-page'); return r; }, 'Saved.', 'ma-page');
    c.appendChild(group({ header: 'A Long-Lived Token of an Ordinary MA User' }, [field('ma-page', 'token', 'Token', { type: 'password', maxlength: 4096 }),
      button('Save Token', save(() => ({ token: (d.token || '').trim() })), { fk: 'mx:ma-page-save' })]));
    c.appendChild(group({ header: 'Or Sign In Once as That MA User' }, [field('ma-page', 'username', 'User Name', { maxlength: 200 }),
      field('ma-page', 'password', 'Password', { type: 'password', maxlength: 1024 }),
      button('Sign In and Save', save(() => ({ username: (d.username || '').trim(), password: d.password || '' })), { fk: 'mx:ma-page-login' })]));
    if (page.set) c.appendChild(group({}, [button('Remove…', async () => {
      if (!(await ask({ title: 'Remove the page token?', message: 'The Music Assistant page goes back to MA’s own sign-in.', ok: 'Remove', destructive: true }))) return;
      act('ma-page', () => api('DELETE', '/api/connections/ma/page'), 'Removed.', 'ma-page');
    }, { destructive: true, fk: 'mx:ma-page-remove' })]));
  } };
}
// A SCREEN IN HOME ASSISTANT'S SIDEBAR (ha_dashboards.py): a Webpage dashboard showing the screen's own address,
// which HA (and its Companion app) can open on. Mantel makes, changes and removes it in HA; HA is the only record,
// so one renamed or removed there shows so here. Owner and Admin, with direct access and HA connected.
const MANAGER = (role) => role === 'owner' || role === 'admin';
const HAD = 'ha-dashboards';
let hadAt = 0;                                        // when HA was last read: a page drawn later than 30 s on reads it again
function loadHad() {
  if (cache[HAD] && !cache[HAD].loading && Date.now() - hadAt > 30000) forget(HAD);
  return load(HAD, () => api('GET', '/api/admin/ha-dashboards').then((r) => { hadAt = Date.now(); return r; }));
}
const origin = (u) => { try { return new URL(u).origin; } catch (e) { return ''; } };
// the HA page this one is shown in (a Webpage dashboard), else null; Firefox has no ancestorOrigins
function framedBy() {
  try { const a = location.ancestorOrigins; return a && a.length ? a[a.length - 1] : null; } catch (e) { return null; }
}
// an Owner trusts one Home Assistant address to show Mantel in a frame (frame_origins.py; audited, applied at once)
function allowFrame(key, addr) {
  return act(key, () => api('POST', '/api/admin/frame-origins', { origin: addr }),
             addr.replace(/^https?:\/\//, '') + ' may now show Mantel. Reload the dashboard in Home Assistant.', HAD, 'proxy');
}
function drawHaDashboard(c, ctx) {
  if (!me || !MANAGER(me.user.role)) return;
  const key = 'ha-dash:' + ctx.screen;
  const got = loadHad();
  if (!got) return;                                   // drawn when HA has answered
  if (got.err) { failed(c, got.err); return; }
  const d = got.data, header = 'Home Assistant';
  if (d.state === 'direct_access_off' || d.state === 'ha_not_connected') return;
  if (d.state === 'not_ha_admin') { c.appendChild(group({ header, footer: d.message }, [])); return; }
  const mine = d.dashboards.filter((x) => x.screen === ctx.screen), cur = mine[0] || null;
  const scr = (d.screens || []).find((x) => x.path === ctx.screen);
  const put = (body, okText) => act(key, async () => {
    cache[HAD] = { data: await api('PUT', '/api/admin/screens/' + encodeURIComponent(ctx.screen) + '/ha-dashboard', body) };
    hadAt = Date.now();
  }, okText);
  const allowedFrames = (d.frame_ancestors || []).map(origin);
  const top = framedBy(), topBlocked = !!top && !allowedFrames.includes(top);
  const rows = [K().toggle({ label: 'Show in Home Assistant', sub: cur ? 'In its sidebar as ' + cur.title : null, on: !!cur,
    fk: 'mx:had:on', onChange: async (on) => {
      if (on) {
        // shown inside HA at an address that may not frame Mantel yet: an Owner's turning it on trusts that address
        const body = { on: true, title: ctx.title || undefined };
        if (topBlocked && me.user.role === 'owner') body.frame_origin = top;
        act(key, async () => {
          const r = await api('PUT', '/api/admin/screens/' + encodeURIComponent(ctx.screen) + '/ha-dashboard', body);
          cache[HAD] = { data: r }; hadAt = Date.now();
          if (r.frame_approved) flash = { key, text: 'Added to Home Assistant, and ' + r.frame_approved.replace(/^https?:\/\//, '') + ' may now show Mantel.' };
        }, 'Added to Home Assistant.');
        return;
      }
      if (!(await ask({ title: 'Remove ' + cur.title + ' from Home Assistant?', message: 'The dashboard leaves Home Assistant’s sidebar for everyone. Anyone whose Home Assistant opens on it opens on Home Assistant’s default instead.', ok: 'Remove', destructive: true }))) { redraw(); return; }
      put({ on: false }, 'Removed from Home Assistant.');
    } })];
  if (cur) {
    rows.push(K().text({ label: 'Title', value: cur.title, maxlength: 60, fk: 'mx:had:title',
      onCommit: (v) => put({ on: true, title: v.trim() || ctx.title }, 'Saved.') }));
    rows.push(K().text({ label: 'Icon', value: cur.icon, placeholder: 'mdi:fireplace', maxlength: 90, fk: 'mx:had:icon',
      onCommit: (v) => put({ on: true, icon: v.trim() || 'mdi:fireplace' }, 'Saved.') }));
    rows.push(K().select({ label: 'Who Sees It', value: cur.require_admin ? 'admin' : 'all', fk: 'mx:had:who',
      options: [['all', 'Everyone'], ['admin', 'Home Assistant Administrators Only']],
      onChange: (v) => put({ on: true, require_admin: v === 'admin' }, 'Saved.') }));
  }
  if (cur && topBlocked) {
    rows.push(me.user.role === 'owner'
      ? button('Allow ' + top.replace(/^https?:\/\//, '') + ' to Show Mantel', () => allowFrame(key, top), { fk: 'mx:had:allow' })
      : info('Not Allowed Here', 'Home Assistant is open at ' + top.replace(/^https?:\/\//, '') + ', which may not show Mantel yet: an Owner allows it (Connections → HTTPS and Your Proxy).', 'Blank', 'warn'));
  }
  const notes = [];
  if (cur) {
    const at = framedBy() || d.ha_url;
    notes.push('Open it in Home Assistant at ' + (at ? at.replace(/^https?:\/\//, '') : '') + '/' + cur.url_path + '. To have Home Assistant and its ' +
      'Companion app open on it, pick it in Home Assistant under your Profile → Dashboard; each person picks their own.');
    if (!cur.show_in_sidebar) notes.push('It is hidden from the sidebar in Home Assistant (Settings → Dashboards).');
    if (mine.length > 1) notes.push('Home Assistant has ' + mine.length + ' dashboards of this screen; turning it off removes them all.');
    notes.push('Who sees what inside it is still Mantel’s: someone not signed in to Mantel gets Mantel’s sign-in page there.');
  } else {
    notes.push('Adds a Webpage dashboard to Home Assistant’s sidebar showing ' + (scr ? scr.url : 'this screen') +
      ', so Home Assistant and its Companion app can open on this screen.');
  }
  c.appendChild(group({ header, footer: notes.join(' ') }, rows));
  result(c, key);
}

// HTTPS and the reverse proxy (proxy_check.py): Owner and Admin read; Owner runs the test, rotates the key
// HOME ASSISTANT LINK (docs/phase9/MANTEL-LINK.md): which integration in Home Assistant is linked (Mantel Link, or
// HK Frontend while a house moves), who holds the bridge (who shows Mantel's entities in Home Assistant: an
// Owner hands it to Mantel Link, or gives it back, audited), and who owns each wall tablet. GET/PUT
// /api/linked/owners; the server says whether Home Assistant's side can take the bridge, in words.
const LINK_NAME = { mantel: 'Mantel Link', hk_frontend: 'HK Frontend' };
function linkSays(l) {
  const hk = (l.report || {}).hk_frontend;
  const bits = ['Protocol ' + l.protocol, l.since ? 'since ' + fmt(l.since) : null];
  if (l.domain === 'mantel' && hk) bits.push(hk.installed ? 'HK Frontend is also in Home Assistant' + (hk.linked ? ', linked' : ', not linked') : 'No HK Frontend');
  if (l.domain === 'hk_frontend') bits.push((l.features || []).includes('bridge') ? 'can hand over' : 'update it to hand over');
  return bits.filter(Boolean).join(' · ');
}
function pLink() {
  return { title: 'Home Assistant Link', back: ['Connections', '#/' + ROUTE + '/connections'], body(c) {
    result(c, 'link');
    const got = load('link', () => api('GET', '/api/linked/owners'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data, owner = me.user.role === 'owner';
    const links = d.links || [];
    c.appendChild(group({ header: 'Linked Now', footer: links.length ? null : 'Nothing in Home Assistant is linked to Mantel. Add Mantel Link in Home Assistant: Settings, Devices & Services, Add Integration, Mantel Link.' },
      links.map((l) => info(LINK_NAME[l.domain] || l.domain, linkSays(l), 'Connected'))));
    if (owner) drawLinkPairing(c);
    const holder = (d.bridge && d.bridge.holder) || 'hk_frontend', b = d.bridge || {};
    // a Home Assistant without HK Frontend has no one else: Mantel Link shows them whoever holds the bridge
    const ml = links.find((l) => l.domain === 'mantel'), hkThere = ml && ((ml.report || {}).hk_frontend || {}).installed;
    const alone = holder !== 'mantel' && ml && hkThere === false && !links.some((l) => l.domain === 'hk_frontend');
    const rows = [info('Shown By', alone ? 'Home Assistant has no HK Frontend' : b.changed ? 'since ' + fmt(b.changed) : null,
                       alone ? 'Mantel Link' : LINK_NAME[holder])];
    if (owner && holder !== 'mantel') rows.push(button('Hand the Bridge to Mantel Link…', async () => {
      if (!(await ask({ title: 'Hand the bridge to Mantel Link?', message: 'Mantel Link then shows Mantel’s wall tablets and the house in Home Assistant, under the same entity ids, with their history. HK Frontend lets go of them first. You can give it back.', ok: 'Hand Over' }))) return;
      await act('link', () => api('PUT', '/api/linked/owners', { unit: 'bridge', owner: 'mantel' }), 'Mantel Link holds the bridge.', 'link');
      setTimeout(() => { forget('link'); redraw(); }, 4000);   // the links reconnect after their reload
    }, { fk: 'mx:bridge-mantel' }));
    if (owner && holder === 'mantel') rows.push(button('Give the Bridge Back to HK Frontend…', async () => {
      if (!(await ask({ title: 'Give the bridge back to HK Frontend?', message: 'HK Frontend then shows Mantel’s entities in Home Assistant again, under the same entity ids. HK Frontend must be linked to Mantel with its last release.', ok: 'Give Back', destructive: true }))) return;
      await act('link', () => api('PUT', '/api/linked/owners', { unit: 'bridge', owner: 'hk_frontend' }), 'HK Frontend holds the bridge.', 'link');
      setTimeout(() => { forget('link'); redraw(); }, 4000);   // the links reconnect after their reload
    }, { destructive: true, fk: 'mx:bridge-hk' }));
    c.appendChild(group({ header: 'The Bridge', footer: 'One integration in Home Assistant shows Mantel’s entities: HK Frontend while a house moves, then Mantel Link. ' + (owner ? 'Each change is in the Audit Log.' : 'Only an Owner can change it.') }, rows));
    // who runs what: the house's own entities (its own group: not a tablet) and each wall tablet
    const ownerRow = (u, label, sub) => {
      const mine = u.owner === 'mantel';
      if (!owner) return info(label, sub || null, mine ? 'Mantel' : 'Home Assistant');
      return K().toggle({ label, sub: (mine ? 'Mantel' : 'Home Assistant') + (u.changed ? ' · since ' + fmt(u.changed) : ''), on: mine, fk: 'mx:owner:' + u.unit,
        onChange: (on) => act('link', () => api('PUT', '/api/linked/owners', { unit: u.unit, owner: on ? 'mantel' : 'ha' }),
                             label + (on ? ' is Mantel’s.' : ' is Home Assistant’s.'), 'link') });
    };
    if (d.house) c.appendChild(group({ header: 'The House', footer: 'What belongs to the house, not a tablet: Seasonal Decorations, the Alarm PIN keypad and Live TV’s sensors and channels. Run by Mantel, they keep their entity ids and history in Home Assistant. Move the wall tablets first, then the house; then HK Frontend can be removed.' + (owner ? '' : ' Only an Owner can move it.') },
      [ownerRow(d.house, 'Run by Mantel')]));
    const tabs = (d.tablets || []).filter(Boolean);
    if (tabs.length) c.appendChild(group({ header: 'Who Runs Each Wall Tablet', footer: 'A tablet Mantel runs has its Sleep Screen and black screen in Mantel; Home Assistant’s scripts still reach it by the same entity ids.' + (owner ? '' : ' Only an Owner can move them.') },
      tabs.map((u) => ownerRow(u, u.name || u.unit))));
  } };
}

// PAIR MANTEL LINK (linked_pairing.py): a one-time code, ten minutes, typed into Mantel Link's setup in Home
// Assistant (by hand, or after it discovered Mantel); shown once, then only "spent" or "expired"
let linkPairTimer = null;
function drawLinkPairing(c) {
  const code = shown.linkPair;
  if (code) {
    const left = code.expires - nowS();
    c.appendChild(group({ header: 'Pairing Code', footer: 'Valid once, for ' + (left > 0 ? Math.ceil(left / 60) + ' min' : 'no longer: it expired') +
      '. In Home Assistant: Settings, Devices & Services. Open Mantel (Discovered), or Add Integration, Mantel Link with this Mantel’s address, and enter the code.' },
      [secretCell(code.code, 'link-pairing-code'), copyButton(code.code, 'Copy Code'),
       button('Withdraw This Code', async () => { await act('link', () => api('DELETE', '/api/linked/pair')); delete shown.linkPair; redraw(); }, { destructive: true, fk: 'mx:link-withdraw' })]));
    return;
  }
  c.appendChild(group({ header: 'Pair Mantel Link', footer: 'For Mantel Link in a Home Assistant that found Mantel on the network, or one you add by hand. You get a one-time code that works for ten minutes; Home Assistant trades it for its own credential (listed under Service Accounts).' }, [
    button('Make a Pairing Code', async () => {
      const r = await act('link', () => api('POST', '/api/linked/pair', {}));
      if (!r) return;
      shown.linkPair = r;
      watchLinkPairing(r);
      redraw();
    }, { fk: 'mx:link-pair' })]));
}
function watchLinkPairing(r) {
  clearInterval(linkPairTimer);
  linkPairTimer = setInterval(async () => {
    if (!shown.linkPair) { clearInterval(linkPairTimer); return; }
    try {
      const got = await api('GET', '/api/linked/pair');
      if (!got.pending) {
        clearInterval(linkPairTimer);
        const paired = (got.paired || []).some((p) => p.at >= r.expires - got.ttl - 1);
        delete shown.linkPair;
        flash = { key: 'link', text: paired ? 'Mantel Link is paired. The code is spent.' : 'The code expired or was withdrawn.', err: !paired };
        forget('link');
        redraw();
      }
    } catch (e) { /* the next tick tries again */ }
  }, 3000);
}

function pProxy() {
  return { title: 'HTTPS and Your Proxy', back: ['Connections', '#/' + ROUTE + '/connections'], body(c) {
    result(c, 'proxy');
    const got = load('proxy', () => api('GET', '/api/admin/proxy-check/summary'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const s = got.data, owner = me.user.role === 'owner';
    const rows = [info('Mode', s.mode_detail, s.mode_label), info('HTTPS on This Request', s.public_url ? 'Configured address ' + s.public_url : null, s.https_seen ? 'Yes' : 'No'),
      info('Trusted Proxies', null, s.trusted_proxies.length ? s.trusted_proxies.join(', ') : 'None')];
    if (s.door_key.required) rows.push(info('Door Key', s.door_key.header + (s.door_key.since ? ' · since ' + fmt(s.door_key.since) : ''), s.door_key.set ? 'Set' : 'Not Set', s.door_key.set ? '' : 'warn'));
    c.appendChild(group({ footer: s.door_key.required ? 'Your proxy must send this installation’s door key with the door header. The key is shown once after a change, and in Test My Proxy.' : 'No door key is needed in this mode.' }, rows));
    drawFrames(c, s);
    const nk = shown.doorKey;
    if (nk) c.appendChild(group({ header: 'New Door Key', footer: 'Shown once: paste it into your proxy.' }, [secretCell(nk, 'proxy-newkey-value'), copyButton(nk), button('Done', () => { delete shown.doorKey; redraw(); })]));
    const acts = [];
    if (owner) acts.push(button('Test My Proxy', async () => {
      shown.proxy = { running: true }; redraw();
      try { const mod = await import(mantelUrl('/proxy-check/check.js')); shown.proxy = await mod.runProxyCheck(BASE); }
      catch (e) { shown.proxy = { error: e && e.message ? e.message : String(e) }; }
      redraw();
    }, { fk: 'mx:proxy-check' }));
    if (s.door_key.required && s.can_rotate) acts.push(button('Rotate Door Key…', async () => {
      if (!(await ask({ title: 'Rotate the door key?', message: 'Your proxy must then send the new key; until you paste it in, its requests are treated as coming from the internet.', ok: 'Rotate', destructive: true }))) return;
      const r = await act('proxy', () => api('POST', '/api/admin/proxy-check/door-key'), 'Door key rotated.', 'proxy');
      if (r) { shown.doorKey = r.door_key.value; redraw(); }
    }, { destructive: true, fk: 'mx:door-key-rotate' }));
    acts.push(K().nav({ label: 'Open the Full Check', href: mantelUrl('/proxy-check'), fk: 'mx:proxy-page' }));
    c.appendChild(group({ footer: owner ? 'The test checks HTTPS, the trusted proxy, the door header, HSTS, the security policy and WebSockets from this browser, and says what to change.' : 'Only an Owner can run the test.' }, acts));
    const res = shown.proxy;
    if (res && res.running) pending(c, 'Checking…');
    else if (res && res.error) failed(c, 'The check failed: ' + res.error);
    else if (res && res.checks) {
      const bad = res.checks.filter((x) => x.ok === false).length;
      c.appendChild(group({ header: bad ? bad + ' to Fix' : 'Your Proxy Looks Right' }, res.checks.map((x) =>
        info(x.title, [x.detail, x.fix].filter(Boolean).join(' '), x.ok === true ? 'OK' : x.ok === false ? 'Fix' : 'Note', x.ok === false ? 'warn' : ''))));
      const pastes = res.checks.filter((x) => x.paste);
      for (const x of pastes) c.appendChild(group({ header: x.title }, [secretCell(x.paste), copyButton(x.paste)]));
    }
  } };
}

// HOME ASSISTANT'S FRAME (security_headers.py frame-ancestors): a Webpage dashboard shows Mantel only from an HA address
// listed there (ha_sign_in_url's and ha_frame_origins); the browser refuses any other, so each address HA is opened at
// must be listed. HA sends no Referer, so Mantel can't see a refused one: HA's own addresses, this page's frame and
// an address typed here are checked instead.
function drawFrames(c, s) {
  const got = loadHad();
  if (!got || got.err || got.data.state === 'direct_access_off') return;
  const owner = me.user.role === 'owner', key = 'frames';
  const plain = (o) => o.replace(/^https?:\/\//, '');
  const listed = s.frame_origins || (s.frame_ancestors || []).map((o) => ({ origin: o, source: 'option' }));
  const allowed = listed.map((x) => origin(x.origin)).filter(Boolean);
  const okAt = (o) => allowed.includes(o);
  const SOURCE = { option: 'From the App’s options', home_assistant: 'Home Assistant’s own address (Settings → System → Network)', approved: 'Allowed here' };
  const rows = listed.length ? listed.map((x) => info(plain(x.origin), SOURCE[x.source] || x.source, x.source === 'approved' ? 'Allowed' : 'Automatic'))
    : [info('Allowed to Show Mantel', null, 'None', 'warn')];
  const seen = new Set(allowed);
  const offer = (label, o, sub) => {               // an address HA is (or may be) opened at that is not allowed yet
    if (!o || seen.has(o)) return;
    seen.add(o);
    rows.push(owner ? button('Allow ' + plain(o) + (sub ? ' (' + sub + ')' : ''), () => allowFrame(key, o), { fk: 'mx:frames:allow:' + o })
                    : info(label, plain(o) + (sub ? ' · ' + sub : ''), 'Not Allowed', 'warn'));
  };
  for (const a of got.data.ha_addresses || []) offer(a.kind === 'internal' ? 'Home Assistant at Home' : 'Home Assistant Away', origin(a.url), 'its ' + a.kind + ' URL');
  offer('This Page', framedBy(), 'Home Assistant is open here now');
  c.appendChild(group({ header: 'Home Assistant’s Frame', footer: 'A screen in Home Assistant’s sidebar shows only when Home Assistant is opened at one of ' +
    'these addresses; at any other the browser shows a blank page. Home Assistant’s own internal and external URL are allowed by themselves.' +
    (owner ? ' Allow every other address you open Home Assistant at.' : ' An Owner allows others.') }, rows));
  const approved = listed.filter((x) => x.source === 'approved');
  if (owner) {
    const typed = draft('frames').addr || '';
    c.appendChild(group({ footer: 'Like https://homeassistant.example.com or http://homeassistant.local:8123: the address in the browser when Home Assistant is open, without the page after it.' }, [
      K().text({ label: 'Allow an Address', value: typed, placeholder: 'https://homeassistant.example.com', maxlength: 300, inputmode: 'url',
                 fk: 'mx:frames:addr', onCommit: (v) => { draft('frames').addr = v.trim(); redraw(); } }),
      button('Allow', async () => {
        const v = (draft('frames').addr || '').trim();
        if (!v) return;
        if (await allowFrame(key, /^https?:\/\//i.test(v) ? v : 'https://' + v)) { draft('frames').addr = ''; redraw(); }
      }, { fk: 'mx:frames:add' }),
      ...approved.map((x) => button('Remove ' + plain(x.origin) + '…', async () => {
        if (!(await ask({ title: 'Remove ' + plain(x.origin) + '?', message: 'Home Assistant opened at this address shows a blank page instead of Mantel.', ok: 'Remove', destructive: true }))) return;
        act(key, () => api('DELETE', '/api/admin/frame-origins?origin=' + encodeURIComponent(x.origin)), 'Removed.', HAD, 'proxy');
      }, { destructive: true, fk: 'mx:frames:remove:' + x.origin }))]));
  }
  result(c, key);
}

// ============================================================================================ Audit
const auditState = { stack: [null], filters: { limit: '25' } };
// the account and tablet changes (accounts.audit_change, devices; kind `config`), in words: their target is what
// changed (never a password). Anything else keeps its action and targets as they are.
const auditName = (t) => t.name || t.username || String(t.user || t.device || '').slice(0, 6);
const AUDIT_SAYS = {
  'account.add': (t) => 'Added ' + auditName(t) + ' as ' + roleLabel(t.role),
  'account.role': (t) => auditName(t) + ': ' + roleLabel(t.from) + ' → ' + roleLabel(t.to),
  'account.disable': (t) => 'Disabled ' + auditName(t),
  'account.enable': (t) => 'Enabled ' + auditName(t),
  'account.rename': (t) => 'Renamed ' + (t.from || t.username || 'someone') + ' to ' + (t.to || t.username || 'no name'),
  'account.password.change': () => 'Changed their own password',
  'account.password.reset': (t) => 'Set a new password for ' + auditName(t),
  'device.enroll': (t) => 'Enrolled the tablet ' + auditName(t) + (t.room ? ' (' + titleCase(t.room) + ')' : ''),
  'device.revoke': (t) => (t.by_self ? 'The tablet ' + auditName(t) + ' revoked itself' : 'Revoked the tablet ' + auditName(t)),
  'device.room': (t) => 'Moved the tablet ' + auditName(t) + ' to ' + (t.to ? titleCase(t.to) : 'no room'),
};
function auditSays(r) {
  const t = r.target, say = AUDIT_SAYS[r.action];
  if (r.kind !== 'config' || !say || !t || typeof t !== 'object' || Array.isArray(t)) return null;
  try { return say(t); } catch (e) { return null; }
}
function pAudit() {
  return { title: 'Audit Log', top: true, scope: 'Every house command and every refused request, and every change to settings, people and tablets, newest first: who, at which tablet, what, and the result.', body(c) {
    result(c, 'audit');
    const names = load('audit-names', async () => {
      let users = null, devices = null;
      try { users = (await api('GET', '/api/users')).users; } catch (e) { users = null; }
      try { devices = (await api('GET', '/api/devices')).devices; } catch (e) { devices = null; }
      return { users, devices };
    });
    if (!names) { pending(c); return; }
    const { users, devices } = names.data;
    const st = auditState, f = st.filters;
    const set = (k) => (v) => { f[k] = v; st.stack = [null]; forget('audit'); redraw(); };
    const dt = (k, label) => K().text({ label, type: 'datetime-local', value: f[k + '_raw'] || '', fk: 'mx:audit:' + k,
      onCommit: (v) => { f[k + '_raw'] = v; f[k] = v ? String(new Date(v).getTime() / 1000) : ''; st.stack = [null]; forget('audit'); redraw(); } });
    c.appendChild(group({ header: 'Show' }, [
      users ? K().select({ label: 'Who', options: [['', 'Anyone']].concat(users.map((u) => [u.id, `${u.name || u.username} (${roleLabel(u.role)})`])), value: f.actor || '', fk: 'mx:audit:actor', onChange: set('actor') }) : null,
      devices ? K().select({ label: 'Tablet', options: [['', 'Any Tablet']].concat(devices.map((d) => [d.id, d.name + (d.revoked ? ' (revoked)' : '')])), value: f.device || '', fk: 'mx:audit:device', onChange: set('device') }) : null,
      K().select({ label: 'Decision', options: [['', 'Any'], ['allowed', 'Allowed'], ['denied', 'Denied'], ['step_up', 'Needed Confirmation']], value: f.decision || '', fk: 'mx:audit:decision', onChange: set('decision') }),
      K().select({ label: 'Kind', options: [['', 'Any'], ['service', 'Service Calls'], ['ws', 'Home Assistant Writes'], ['http', 'HTTP'], ['ma', 'Music'], ['config', 'Settings and Accounts'], ['tablet', 'Wall Tablets'], ['system', 'System']], value: f.kind || '', fk: 'mx:audit:kind', onChange: set('kind') }),
      dt('since', 'From'), dt('until', 'To'),
      K().select({ label: 'Rows per Page', options: [['25', '25'], ['50', '50'], ['100', '100']], value: f.limit || '25', fk: 'mx:audit:limit', onChange: set('limit') })]));
    const q = new URLSearchParams();
    for (const k of ['actor', 'device', 'decision', 'kind', 'since', 'until', 'limit']) if (f[k]) q.set(k, f[k]);
    const before = st.stack[st.stack.length - 1];
    if (before) q.set('before', before);
    const got = load('audit', () => api('GET', '/api/audit?' + q.toString()));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const data = got.data;
    const uname = {}, dname = {};
    for (const u of users || []) uname[u.id] = u.name || u.username || u.id;
    for (const d of devices || []) dname[d.id] = d.name;
    const who = (r) => { const n = r.actor_name || uname[r.actor] || r.actor || ''; return n + (r.role && n ? ' (' + roleLabel(r.role) + ')' : ''); };
    const target = (t) => (Array.isArray(t) ? t.join(', ') : t && typeof t === 'object' ? JSON.stringify(t) : t || '');
    c.appendChild(group({ header: 'Page ' + st.stack.length, footer: data.retention_days ? `Entries older than ${data.retention_days} days are removed.` : null },
      data.rows.length ? data.rows.map((r) => {
        const says = auditSays(r);
        const cell = info([r.action, says || target(r.target)].filter(Boolean).join(' · '),
          [fmtFull(r.timestamp), who(r), r.device ? 'at ' + (dname[r.device] || r.device_role || String(r.device).slice(0, 6)) : null,
           (r.reason || '').replace(/_/g, ' ') || null, r.step_up ? 'confirmed by ' + r.step_up : null, r.result || null,
           [r.door, r.source_ip].filter(Boolean).join(' ') || null].filter(Boolean).join(' · '),
          r.decision === 'denied' ? 'Denied' : r.decision === 'step_up' ? 'Confirm' : 'Allowed', r.decision === 'denied' ? 'warn' : '');
        cell.setAttribute('data-id', r.id);
        return cell;
      }) : [info('No entries match')]));
    c.appendChild(group({}, [
      button('Newer', () => { st.stack.pop(); forget('audit'); redraw(); }, { disabled: st.stack.length === 1, fk: 'mx:audit-newer' }),
      button('Older', () => { st.stack.push(data.next); forget('audit'); redraw(); }, { disabled: !data.next, fk: 'mx:audit-older' })]));
  } };
}

// ============================================================================================ the host
// Photos (mantel-photos.js) draws with this page's own helpers
const photoTools = {
  K, hh, api, act, load, forget, redraw, ask, group, info, button, nav, result, pending, failed, field, choose, draft,
  mantelUrl, csrfNow, refreshMe, ROUTE, panel: () => panel,
  setFlash: (key, text, err) => { flash = { key, text, err: !!err }; },
};
// ABOUT (about.py): which Mantel this is and what it talks to; for anyone signed in, nothing secret
function pAbout() {
  return { title: 'About', top: true, scope: 'This Mantel, and what it is connected to.', body(c) {
    const got = load('about', () => api('GET', '/api/about'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const a = got.data, ha = a.home_assistant || {}, ma = a.music_assistant || {};
    const ver = a.version ? (a.commit && a.commit !== 'dev' ? a.version + ' (' + a.commit + ')' : a.version) : 'Unknown';
    c.appendChild(group({ header: 'Mantel', footer: 'Build ' + (a.build || 'dev') + (a.staged ? ', staged ' + fmt(a.staged) : '') + '.' }, [
      info('Version', null, ver),
      info('Installed As', null, a.install),
      info('Running Since', null, fmt(a.started)),
      info('House Commands', a.commands ? 'Signed-in people control the house within their roles; every command is in the Audit Log.' : 'Read-only: nothing is sent to the house.', a.commands ? 'On' : 'Off'),
    ]));
    const links = (a.linked || []).map((l) => info(l.name, 'Protocol ' + l.protocol + (l.since ? ' · since ' + fmt(l.since) : ''), 'Linked'));
    c.appendChild(group({ header: 'Connected To' }, [
      info('Home Assistant', null, ha.connected ? (ha.version || 'Connected') : 'Not connected'),
      info('Music Assistant', null, !ma.configured ? 'Not set up' : (ma.version || 'Not connected')),
    ].concat(links.length ? links : [info('In Home Assistant', null, 'Nothing linked')])));
    c.appendChild(group({ header: 'About the Project', footer: 'Mantel serves HK’s home screens from a server of its own beside Home Assistant. Wall tablets, phones and browsers sign in to Mantel, and every change to the house passes its roles and its audit log. Mantel Link is its side inside Home Assistant: the tablets’ and the house’s entities, and the actions automations call. It grew out of HK Frontend, which drew the same screens inside Home Assistant. Apple’s SF Pro and SF Symbols are supplied by each home (Your Files); Mantel ships none.' }, [
      button('Documentation', () => { window.open(mantelUrl(a.docs || '/docs'), '_blank', 'noopener'); }, { fk: 'mx:about-docs' }),
    ]));
  } };
}
const BUILD = { me: pMe, people: pPeople, devices: pDevices, roles: pRoles, files: pFiles, service: pService, about: pAbout,
                connect: pConnect, connections: pConnections, audit: pAudit };
const can = (s) => !!me && me.sections.includes(s);
// the house's own settings: for the people who manage it, from a browser that isn't a tablet, once Mantel
// can read Home Assistant (the first run opens Connections without them)
export const manages = () => !!me && can('people') && me.ha_set_up !== false;

export const host = {
  title: 'Mantel Settings',
  get house() { return manages(); },
  get screenBase() { return BASE; },
  get back() { return { label: 'Dashboard', href: mantelUrl('/home') }; },
  notes: NOTES,
  groups() {
    if (!me) return [];
    const out = [];
    const u = me.user;
    out.push({ place: 'top', rows: [{ route: ROUTE + '/me', label: u.name || u.username || 'Me', sub: roleLabel(u.role) + ' · Sign-In, Passkeys, Sessions',
                                      tile: ['mdi:account-circle', C.gray], root: !manages() }] });
    const heads = {};
    for (const [s, title, icon, color, place, header] of PAGES) {
      if (place !== 'end' || !can(s)) continue;
      if (!heads[header]) { heads[header] = { place: 'end', header, rows: [] }; out.push(heads[header]); }
      heads[header].rows.push({ route: ROUTE + '/' + s, label: title, tile: [icon, color] });
    }
    return out;
  },
  page(parts, p) {
    panel = p;
    ensureStyle(p && p.shadowRoot);
    if (parts[0] !== ROUTE || !me) return null;
    const s = parts[1] || 'me';
    if (!BUILD[s] || !can(s)) return pMe([]);
    return BUILD[s](parts.slice(2));
  },
  // /admin's addresses (#connections, #people ...) and the page's own first-run choice
  forward(path) {
    if (PAGES.some(([s]) => s === path)) return ROUTE + '/' + path;
    // Photos had its own row until it moved into Your Files: #/photos (/admin's) and #/mantel/photos[/<album>]
    const m = /^(?:mantel\/)?photos(\/.*)?$/.exec(path);
    if (m) return ROUTE + '/' + photos.SECTION + (m[1] || '');
    return null;
  },
  first() {
    if (!me) return null;
    if (me.ha_set_up === false && can('connections')) return ROUTE + '/connections';
    return manages() ? null : ROUTE + '/me';
  },
  // Mantel's own groups on HK's pages: a wall tablet's Direct Connection, a screen in Home Assistant's sidebar
  // a paired tablet's Reload and Clear Cache (HK Settings' Wall Tablets buttons): through the command gateway
  press(ids, p) {
    if (p) panel = p;
    return me ? pressTablets(ids, p) : null;
  },
  extend(where, c, ctx, p) {
    if (p) { panel = p; ensureStyle(p.shadowRoot); }
    if (where === 'tablet' && me && ctx && ctx.tablet) drawDirect(c, ctx);
    if (where === 'screen' && me && ctx && ctx.screen) drawHaDashboard(c, ctx);
    if ((where === 'saver' || where === 'house-saver') && me && can('photos')) photos.extend(where, c, ctx || {}, photoTools);
  },
  search() {
    if (!me) return [];
    const out = PAGES.filter(([s]) => can(s)).map(([s, title]) => ({ label: title, route: ROUTE + '/' + s, where: 'Mantel', words: s }));
    if (can('photos')) out.push({ label: 'Photos', route: ROUTE + '/' + photos.SECTION, where: 'Mantel → Your Files', words: 'photos albums upload screensaver pictures' });
    return out;
  },
};

// The page's start: who this is and what they may use (GET /api/admin/overview)
export async function start() {
  await refreshMe();
  return me;
}
export function overview() { return me; }
// tests: the module's state between cases
export function _reset(next) { me = next || null; panel = null; enrolled = false; flash = null; photos._reset(); for (const o of [cache, drafts, shown]) for (const k of Object.keys(o)) delete o[k]; }
