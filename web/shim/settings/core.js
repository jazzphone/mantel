// settings/core.js -- state, the server (api), reads (load) and actions (act) that every page of Mantel Settings shares.
import { mantelUrl, base as BASE } from '../base.js';
import { stepUp } from './kit.js';

export const ROUTE = 'mantel';
export const C = { blue: '#007aff', green: '#34c759', indigo: '#5856d6', orange: '#ff9500', pink: '#ff2d55', purple: '#af52de',
                   red: '#ff3b30', teal: '#30b0c7', gray: '#8e8e93', yellow: '#ffcc00', brown: '#a2845e' };
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', adult: 'Adult', child: 'Child', guest: 'Guest', wall_tablet: 'Wall Tablet',
                     service: 'Service' };
export const roleLabel = (r) => ROLE_LABEL[r] || r;
export const ERRORS = {
  invalid_credentials: 'That did not match.', invalid_code: 'That code was not accepted.',
  too_many_attempts: 'Too many tries. Wait a little and try again.', username_taken: 'That user name is already taken.',
  username_invalid: 'User names are 1 to 64 letters, digits, dots, dashes or underscores.',
  last_owner: 'There must always be at least one enabled Owner.', forbidden: 'You are not allowed to do that.',
  owner_only: 'Only an Owner can do that.', lan_only: 'This can only be done on the home network.',
  home_door_only: 'This can only be done on the home network, or in Home Assistant’s sidebar with the home rules.',
  already_a_device: 'This browser is already a wall tablet.', not_found: 'That no longer exists.',
  step_up_required: 'Confirm it is you first.', pin_unavailable: 'That PIN cannot be used. Pick another.',
  origin_not_allowed_for_passkeys: 'Passkeys need the name you use to reach Mantel, not an IP address.',
  csrf: 'The page lost its session token. Reload and try again.',
  audit_unavailable: 'The audit log is unavailable, so nothing was changed.',
  own_password: 'Change your own password in Me, with your current one.',
  no_mantel_password: 'This person signs in with Home Assistant, not a Mantel password.',
};

// ---------------------------------------------------------------------------------------- state
export let me = null;       // GET /api/admin/overview
let skew = 0;
export let panel = null;    // the settings panel drawing us (its render, status, shadowRoot)
export const cache = {};    // key -> { data } | { err } | { loading: true }
export const drafts = {};   // a form's fields as typed (K.text commits on blur/Return)
export const shown = {};    // a credential or code shown once, by page
// what pages assign (an imported binding can't be assigned)
export const ui = { enrolled: false,    // this browser just became a wall tablet: nothing else is shown
                    flash: null };      // { key, text, err }: the result of the last action, on its page

export const K = () => window.hkSettingsKit;
export const hh = (tag, attrs, kids) => K().h(tag, attrs, kids);
export const nowS = () => Date.now() / 1000 + skew;
export const fmt = (t) => (t ? new Date(t * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');
export const fmtFull = (t) => (t ? new Date(t * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) : '');
export function ago(t) {
  if (!t) return 'never';
  const s = Math.max(0, nowS() - t);
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 129600) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
export function shortUA(ua) {
  if (!ua) return 'A Browser';
  const os = /iPhone|iPad|Android|Mac OS X|Windows|Linux/.exec(ua);
  const br = /Edg\/|Firefox\/|Chrome\/|Safari\//.exec(ua);
  const name = br ? { 'Edg/': 'Edge', 'Firefox/': 'Firefox', 'Chrome/': 'Chrome', 'Safari/': 'Safari' }[br[0]] : 'Browser';
  return name + (os ? ' on ' + os[0].replace('Mac OS X', 'Mac') : '');
}
export const kb = (n) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// ---------------------------------------------------------------------------------------- the server
export class ApiError extends Error {
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
export function csrfNow() {
  const m = document.cookie.match(/(?:^|;\s*)mantel_csrf=([^;]*)/);
  return (m && decodeURIComponent(m[1])) || (me && me.csrf) || '';
}
function signedOut() {
  if (BASE) ui.flash = { key: '*', text: 'Home Assistant has signed you out. Reload this page, or reopen Mantel from the sidebar.', err: true };
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
export async function refreshMe() {
  me = await api('GET', '/api/admin/overview', undefined, { retry: false });
  skew = me.now - Date.now() / 1000;
  return me;
}

// a read for a page: drawn once it is here, read again after a change (forget). Only the read still asked for
// lands: one forgotten while it was on its way (a filter changed) never replaces the newer one. A read that
// failed shows its error on this page, and is asked again when the page is opened again (page() forgets it).
export function load(key, fn) {
  const got = cache[key];
  if (got && !got.loading) return got;
  if (!got) {
    const mine = cache[key] = { loading: true };
    const land = (entry) => { if (cache[key] !== mine) return; cache[key] = entry; if (panel) panel.render(); };
    Promise.resolve().then(fn).then((data) => land({ data }), (err) => land({ err }));
  }
  return null;
}
export const forgetFailed = () => { for (const k of Object.keys(cache)) if (cache[k] && cache[k].err) delete cache[k]; };
export function forget(...keys) { for (const k of keys) delete cache[k]; }
export const redraw = () => { if (panel) panel.render(); };

// AN ACTION: its result on the page (the bar's Saved, or what went wrong under the page's title)
export async function act(key, fn, okText, ...invalidate) {
  ui.flash = null;
  if (panel) panel.status('saving');
  try {
    const out = await fn();
    if (panel) panel.status('saved');
    if (okText) ui.flash = { key, text: okText };
    forget(...invalidate);
    redraw();
    return out === undefined ? true : out;
  } catch (e) {
    if (panel) panel.status('error');
    if (!(e instanceof ApiError && e.status === 401)) ui.flash = { key, text: e instanceof ApiError ? e.message : 'Something went wrong: ' + e.message, err: true };
    redraw();
    return false;
  }
}
export const ask = (o) => K().confirm(panel.shadowRoot, o);

// Set Up Mantel has no section of its own: the overview carries `setup` for the people who manage the house
export const can = (s) => !!me && (s === 'setup' ? !!me.setup : me.sections.includes(s));
// the house's own settings: for the people who manage it, from a browser that isn't a tablet, once Mantel
// can read Home Assistant (the first run opens Connections without them)
export const manages = () => !!me && can('people') && me.ha_set_up !== false;
export const setMe = (m) => { me = m; };
export const setPanel = (p) => { panel = p; };
