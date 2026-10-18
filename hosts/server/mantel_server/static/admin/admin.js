// Mantel admin page. One ES module, no framework, no inline script or handler (CSP: script-src 'self').
// It only calls REST routes that already exist (docs/phase3/ADMIN-PAGE.md lists them); the server decides who
// may do what. The page hides a section when /api/admin/overview does not list it, and shows an API's own refusal.
// Nothing sensitive is kept: no storage, and a service credential lives in one DOM node until it is dismissed.

import { credentialJSON, passkeysAvailable, toCreation, toRequest } from '../webauthn.js';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', adult: 'Adult', child: 'Child', guest: 'Guest',
                     wall_tablet: 'Wall tablet', service: 'Service' };
const SECTION_LABEL = { me: 'Me', people: 'People', devices: 'Devices', roles: 'Roles & grants',
                        service: 'Service accounts', audit: 'Audit' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ERRORS = {
  invalid_credentials: 'That did not match.',
  invalid_code: 'That code was not accepted.',
  too_many_attempts: 'Too many tries. Wait a little and try again.',
  username_taken: 'That user name is already taken.',
  username_invalid: 'User names are 1 to 64 letters, digits, dots, dashes or underscores.',
  last_owner: 'There must always be at least one enabled Owner.',
  forbidden: 'You are not allowed to do that.',
  owner_only: 'Only an Owner can do that.',
  lan_only: 'This can only be done on the home network.',
  already_a_device: 'This browser is already a wall tablet.',
  not_found: 'That no longer exists.',
  step_up_required: 'Confirm it is you first.',
  pin_unavailable: 'That PIN cannot be used. Pick another.',
  origin_not_allowed_for_passkeys: 'Passkeys need the name you use to reach Mantel, not an IP address.',
  csrf: 'The page lost its session token. Reload and try again.',
  audit_unavailable: 'The audit log is unavailable, so nothing was changed.',
};

const state = { me: null, csrf: null, skew: 0, section: null, enrolled: false };
const $ = (sel, root = document) => root.querySelector(sel);

// -- tiny DOM helper ------------------------------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids);
  return el;
}
function frag(kids) {
  const f = document.createDocumentFragment();
  add(f, kids);
  return f;
}
function add(el, kids) {
  for (const kid of kids) {
    if (kid === undefined || kid === null || kid === false) continue;
    if (Array.isArray(kid)) add(el, kid);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}
const badge = (text, cls = '') => h('span', { class: 'badge ' + cls }, text);
const note = (text, cls = 'muted') => h('p', { class: cls }, text);

// -- time -----------------------------------------------------------------------------------------
const nowS = () => Date.now() / 1000 + state.skew;
const fmt = (t) => (t ? new Date(t * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
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
  if (!ua) return 'a browser';
  const os = /iPhone|iPad|Android|Mac OS X|Windows|Linux/.exec(ua);
  const br = /Edg\/|Firefox\/|Chrome\/|Safari\//.exec(ua);
  const name = br ? { 'Edg/': 'Edge', 'Firefox/': 'Firefox', 'Chrome/': 'Chrome', 'Safari/': 'Safari' }[br[0]] : 'Browser';
  return name + (os ? ' on ' + os[0].replace('Mac OS X', 'Mac') : '');
}

// -- talking to the server --------------------------------------------------------------------------
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

async function api(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET') init.headers['X-CSRF-Token'] = state.csrf || '';
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError(0, null);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.status === 401 && data === null) {      // the middleware's plain 401: we are signed out
    location.assign('/login?next=' + encodeURIComponent('/admin'));
    throw new ApiError(401, null);
  }
  if (res.status === 403 && data && data.error === 'step_up_required' && opts.retry !== false) {
    if (await stepUp()) return api(method, path, body, { retry: false });
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

const say = (text, kind = 'ok') => {
  const el = $('#status');
  el.textContent = text || '';
  el.className = 'status ' + (text ? kind : '');
};
async function run(fn, okText) {
  say('');
  try {
    const out = await fn();
    if (okText) say(okText, 'ok');
    return out === undefined ? true : out;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return false;
    say(e instanceof ApiError ? e.message : 'Something went wrong: ' + e.message, 'err');
    return false;
  }
}
const errorPanel = (e) => note(e instanceof ApiError ? e.message : String(e), 'status err');

// -- dialogs -----------------------------------------------------------------------------------------
function modal(title, build) {
  const dlg = $('#dlg');
  return new Promise((resolve) => {
    const finish = (value) => { resolve(value); if (dlg.open) dlg.close(); };
    dlg.replaceChildren(h('h2', { id: 'dlg-title' }, title), frag(build(finish)));
    dlg.addEventListener('close', () => resolve(undefined), { once: true });
    dlg.showModal();
  });
}
function confirmDialog(title, text, label = 'Confirm', danger = false) {
  return modal(title, (done) => [
    note(text, ''),
    h('div', { class: 'acts' },
      h('button', { class: 'btn' + (danger ? ' danger' : ' primary'), type: 'button', 'data-act': 'confirm', onclick: () => done(true) }, label),
      h('button', { class: 'btn', type: 'button', 'data-act': 'cancel', onclick: () => done(false) }, 'Cancel')),
  ]).then((v) => v === true);
}

// -- WebAuthn (passkeys): the helpers live in ../webauthn.js (/webauthn.js), shared with /login ----------
async function passkeyStepUp() {
  const opt = await api('POST', '/api/auth/passkey/options', { username: state.me.user.username || undefined }, { retry: false });
  const cred = await navigator.credentials.get({ publicKey: toRequest(opt.options) });
  await api('POST', '/api/auth/passkey/verify', { challenge_id: opt.challenge_id, credential: credentialJSON(cred) }, { retry: false });
}

// "Confirm it is you": TOTP or passkey, then the refused request is sent once more.
async function stepUp() {
  const me = state.me && state.me.user;
  const canTotp = !!(me && me.totp);
  const canPasskey = !!(me && me.passkeys > 0 && passkeysAvailable());
  const result = await modal('Confirm it is you', (done) => {
    const err = h('p', { class: 'status err', role: 'alert' });
    const nodes = [note('This needs a fresh confirmation (within the last five minutes).', '')];
    if (canTotp) {
      const code = h('input', { name: 'totp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, required: true, 'aria-label': 'Authenticator code' });
      nodes.push(h('form', { class: 'stack', onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          await api('POST', '/api/auth/totp/step-up', { code: code.value.trim() }, { retry: false });
          done(true);
        } catch (e) { err.textContent = e.message; }
      } }, h('label', null, 'Code from your authenticator app', code),
        h('button', { class: 'btn primary', type: 'submit', 'data-act': 'stepup-totp' }, 'Confirm')));
    }
    if (canPasskey) {
      nodes.push(h('button', { class: 'btn', type: 'button', 'data-act': 'stepup-passkey', onclick: async () => {
        try { await passkeyStepUp(); done(true); } catch (e) { err.textContent = e.message || 'The passkey was not accepted.'; }
      } }, 'Use a passkey'));
    }
    if (!canTotp && !canPasskey) {
      nodes.push(note('You have no authenticator app or passkey yet. Sign out and sign in again, then do this within five minutes.', ''));
      nodes.push(h('button', { class: 'btn', type: 'button', onclick: signOut }, 'Sign out'));
    }
    nodes.push(err, h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', 'data-act': 'cancel', onclick: () => done(false) }, 'Cancel')));
    return nodes;
  });
  return result === true;
}

async function signOut() {
  try { await api('POST', '/api/session/logout', {}, { retry: false }); } catch (e) { /* signing out anyway */ }
  location.assign('/login');
}

// -- building blocks -----------------------------------------------------------------------------------
// A panel that loads itself and can reload: view(reload) returns the nodes to show.
function live(id, title, view) {
  const box = h('section', { class: 'panel', id });
  const reload = async () => {
    try {
      const kids = await view(reload);
      box.replaceChildren(h('h3', null, title), frag(kids));
    } catch (e) {
      box.replaceChildren(h('h3', null, title), errorPanel(e));
    }
  };
  box.append(h('h3', null, title), note('Loading'));
  box.reload = reload;
  reload();
  return box;
}
function field(label, input) { return h('label', null, label, input); }
function select(name, options, current) {
  return h('select', { name }, options.map((o) => {
    const [value, text] = Array.isArray(o) ? o : [o, o];
    return h('option', { value, selected: value === current }, text);
  }));
}
function checks(name, options, chosen = []) {
  return h('div', { class: 'checks' }, options.map((o) => {
    const [value, text] = Array.isArray(o) ? o : [o, o];
    return h('label', { class: 'inline' }, h('input', { type: 'checkbox', name, value, checked: chosen.includes(value) }), text);
  }));
}
const checked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
const roleLabel = (r) => ROLE_LABEL[r] || r;
const item = (info, acts, cls = '') => h('li', { class: 'item ' + cls }, h('div', { class: 'info' }, info), acts && h('div', { class: 'acts' }, acts));
const head = (...parts) => h('div', { class: 'head' }, parts);
const meta = (text) => h('div', { class: 'meta' }, text);
const btn = (text, onclick, cls = '', act = '') => h('button', { class: 'btn small ' + cls, type: 'button', 'data-act': act || undefined, onclick }, text);

// ============================================================================================================
// Me
// ============================================================================================================
function renderMe(root) {
  const me = state.me.user;
  root.append(
    h('h2', null, 'Me'),
    live('p-account', 'Account', async () => {
      const bits = [roleLabel(me.role), me.kind === 'ha_linked' ? 'signed in with Home Assistant' : 'Mantel account'];
      return [h('p', null, h('b', null, me.name || me.username || me.id), ' ', badge(roleLabel(me.role))),
              meta(bits.join(' · ') + (me.username ? ' · user name ' + me.username : ''))];
    }),
    sessionsPanel(), passkeysPanel(), totpPanel(), pinPanel(),
    h('section', { class: 'panel', id: 'p-signout' }, h('h3', null, 'Sign out'),
      note('Ends this browser\'s session.'),
      h('button', { class: 'btn', type: 'button', 'data-act': 'signout', onclick: signOut }, 'Sign out')),
  );
}

function sessionsPanel() {
  return live('p-sessions', 'My sessions', async (reload) => {
    const { sessions } = await api('GET', '/api/sessions');
    if (!sessions.length) return [note('No active sessions.')];
    return [h('ul', { class: 'list' }, sessions.map((s) => item([
      head(h('b', null, shortUA(s.user_agent)), s.current && badge('this browser', 'cur'), badge(s.door === 'lan' ? 'home network' : 'remote')),
      meta(`${s.method} sign-in · ${s.source_ip || 'unknown address'} · started ${fmt(s.created)} · last seen ${ago(s.last_seen)} · ends ${fmt(s.expires)}`),
    ], btn(s.current ? 'Sign out here' : 'Revoke', async () => {
      const yes = await confirmDialog(s.current ? 'Sign out of this browser?' : 'Revoke this session?',
        s.current ? 'You will be signed out here.' : 'That browser will be signed out at once.', s.current ? 'Sign out' : 'Revoke', true);
      if (!yes) return;
      if (await run(() => api('DELETE', '/api/sessions/' + encodeURIComponent(s.id)), 'Session revoked.')) {
        if (s.current) location.assign('/login'); else reload();
      }
    }, 'danger', 'revoke-session'))))];
  });
}

async function refreshMe() {
  const o = await api('GET', '/api/admin/overview');
  state.me = o;
  state.csrf = o.csrf;
}

function passkeysPanel() {
  return live('p-passkeys', 'Passkeys', async (reload) => {
    const { passkeys } = await api('GET', '/api/auth/passkeys');
    const nameBox = h('input', { name: 'passkey-name', placeholder: 'For example: my phone', maxlength: 64, 'aria-label': 'Passkey name' });
    return [
      passkeys.length ? h('ul', { class: 'list' }, passkeys.map((k) => item([
        head(h('b', null, k.name || 'Passkey'), k.backed_up ? badge('synced') : null),
        meta(`added ${fmt(k.created)} · last used ${ago(k.last_used)}`),
      ], btn('Remove', async () => {
        if (!(await confirmDialog('Remove this passkey?', 'It will no longer sign you in or confirm actions.', 'Remove', true))) return;
        if (await run(() => api('DELETE', '/api/auth/passkeys/' + encodeURIComponent(k.id)), 'Passkey removed.')) { await refreshMe(); reload(); }
      }, 'danger', 'remove-passkey')))) : note('No passkeys yet. A passkey signs you in with your fingerprint, face or device PIN.'),
      passkeysAvailable()
        ? h('form', { class: 'grid', onsubmit: async (ev) => {
          ev.preventDefault();
          const done = await run(async () => {
            const opt = await api('POST', '/api/auth/passkey/register/options', {});
            const cred = await navigator.credentials.create({ publicKey: toCreation(opt.options) });
            await api('POST', '/api/auth/passkey/register/verify',
              { challenge_id: opt.challenge_id, credential: credentialJSON(cred), name: nameBox.value.trim() || undefined });
          }, 'Passkey added.');
          if (done) { await refreshMe(); reload(); }
        } }, field('Name', nameBox), h('button', { class: 'btn primary', type: 'submit', 'data-act': 'add-passkey' }, 'Add a passkey'))
        : note('This browser cannot make passkeys.'),
    ];
  });
}

function groups(secret) { return secret.replace(/(.{4})/g, '$1 ').trim(); }

function totpPanel() {
  return live('p-totp', 'Authenticator app (TOTP)', async (reload) => {
    const on = state.me.user.totp;
    const setup = h('div');
    const begin = async () => {
      const data = await run(() => api('POST', '/api/auth/totp/enroll', {}));
      if (!data) return;
      const code = h('input', { name: 'totp-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, required: true, 'aria-label': 'Code from the app' });
      setup.replaceChildren(
        note('Add this secret to your authenticator app (or open the link on your phone), then type the 6-digit code it shows.', ''),
        h('code', { class: 'secret', id: 'totp-secret' }, groups(data.secret)),
        h('p', null, h('a', { href: data.uri }, 'Open in an authenticator app')),
        h('form', { class: 'grid', onsubmit: async (ev) => {
          ev.preventDefault();
          if (await run(() => api('POST', '/api/auth/totp/enroll/confirm', { code: code.value.trim() }), 'Authenticator app turned on.')) {
            await refreshMe(); reload();
          }
        } }, field('Code', code), h('button', { class: 'btn primary', type: 'submit', 'data-act': 'confirm-totp' }, 'Confirm')));
    };
    return [
      on ? h('p', null, badge('on', 'cur'), ' Sign-in asks for a code after your password.') : note('Off. Turn it on to protect your password sign-in; it is required for sign-in from outside the house.'),
      on ? note('Replacing it turns the old app off until the new code is confirmed.', 'muted small') : null,
      h('div', { class: 'acts' },
        btn(on ? 'Replace' : 'Set up', begin, 'primary', 'enroll-totp'),
        on && btn('Remove', async () => {
          if (!(await confirmDialog('Remove the authenticator app?', 'Password sign-in will no longer ask for a code.', 'Remove', true))) return;
          if (await run(() => api('DELETE', '/api/auth/totp'), 'Authenticator app removed.')) { await refreshMe(); reload(); }
        }, 'danger', 'remove-totp')),
      setup,
    ];
  });
}

function pinPanel() {
  return live('p-pin', 'My PIN', async (reload) => {
    const s = await api('GET', '/api/account/pin');
    const pin = h('input', { name: 'pin', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'new-password', maxlength: 8, required: true, 'aria-label': 'New PIN' });
    const again = h('input', { name: 'pin2', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'new-password', maxlength: 8, required: true, 'aria-label': 'Repeat the PIN' });
    return [
      note('A PIN of 4 to 8 digits confirms sensitive actions (like unlocking a door) at a wall tablet, and works as a quick confirmation here. Nobody else can have the same PIN.', ''),
      s.pin ? h('p', null, badge('set', 'cur'), ` last changed ${fmt(s.updated || s.created)}`, s.last_used ? ` · last used ${ago(s.last_used)}` : '') : note('No PIN yet.'),
      h('form', { class: 'grid', onsubmit: async (ev) => {
        ev.preventDefault();
        if (!/^\d{4,8}$/.test(pin.value)) { say('A PIN is 4 to 8 digits.', 'err'); return; }
        if (pin.value !== again.value) { say('The two PINs do not match.', 'err'); return; }
        const value = pin.value;
        pin.value = again.value = '';
        if (await run(() => api('PUT', '/api/account/pin', { pin: value }), s.pin ? 'PIN changed.' : 'PIN set.')) reload();
      } }, field(s.pin ? 'New PIN' : 'PIN', pin), field('Repeat', again),
      h('button', { class: 'btn primary', type: 'submit', 'data-act': 'set-pin' }, s.pin ? 'Change PIN' : 'Set PIN')),
      s.pin ? btn('Remove my PIN', async () => {
        if (!(await confirmDialog('Remove your PIN?', 'You will not be able to confirm actions at a wall tablet.', 'Remove', true))) return;
        if (await run(() => api('DELETE', '/api/account/pin'), 'PIN removed.')) reload();
      }, 'danger', 'remove-pin') : null,
    ];
  });
}

// ============================================================================================================
// People
// ============================================================================================================
function renderPeople(root) {
  const mine = state.me.user;
  const assignable = state.me.roles.filter((r) => mine.role === 'owner' || r !== 'owner');
  const list = live('p-users', 'People', async (reload) => {
    const { users } = await api('GET', '/api/users');
    const rows = users.map((u) => {
      const locked = mine.role !== 'owner' && u.role === 'owner';      // an Admin never manages Owners
      const self = u.id === mine.id;
      const how = [u.has_password && 'password', u.totp && 'authenticator app', u.passkeys && u.passkeys + ' passkey' + (u.passkeys > 1 ? 's' : ''),
                   u.ha_user_id && 'Home Assistant'].filter(Boolean);
      return item([
        head(h('b', null, u.name || u.username || u.id), badge(roleLabel(u.role)), self && badge('you', 'cur'), u.disabled && badge('disabled', 'bad'),
          u.kind === 'ha_linked' && badge('Home Assistant')),
        meta([u.username ? 'user name ' + u.username : 'no user name', how.length ? 'sign-in: ' + how.join(', ') : 'cannot sign in yet'].join(' · ')),
      ], locked ? null : [
        h('select', { name: 'role', 'aria-label': 'Role of ' + (u.name || u.username), 'data-user': u.id, onchange: async (ev) => {
          const role = ev.target.value;
          if (!(await run(() => api('PATCH', '/api/users/' + encodeURIComponent(u.id), { role }), 'Role changed.'))) ev.target.value = u.role;
          else reload();
        } }, (assignable.includes(u.role) ? assignable : [u.role, ...assignable]).map((r) => h('option', { value: r, selected: r === u.role }, roleLabel(r)))),
        !self && btn(u.disabled ? 'Enable' : 'Disable', async () => {
          if (!u.disabled && !(await confirmDialog('Disable ' + (u.name || u.username) + '?', 'Their sessions end now and they cannot sign in.', 'Disable', true))) return;
          if (await run(() => api('PATCH', '/api/users/' + encodeURIComponent(u.id), { disabled: !u.disabled }), u.disabled ? 'Enabled.' : 'Disabled.')) reload();
        }, u.disabled ? '' : 'danger', 'toggle-user'),
        btn('Clear PIN', async () => {
          if (!(await confirmDialog('Clear their PIN?', 'They will have to set a new one.', 'Clear', true))) return;
          const r = await run(() => api('DELETE', '/api/users/' + encodeURIComponent(u.id) + '/pin'));
          if (r) say(r.removed ? 'PIN cleared.' : 'They had no PIN.', 'ok');
        }, '', 'clear-pin'),
      ], u.disabled ? 'off' : '');
    });
    return [h('ul', { class: 'list' }, rows)];
  });

  const form = h('form', { class: 'grid', id: 'create-user', onsubmit: async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const body = { username: f.username.value.trim(), name: f.fullname.value.trim() || undefined, role: f.role.value, password: f.password.value };
    if (await run(() => api('POST', '/api/users', body), 'Account created.')) {
      f.reset();
      list.reload();
    }
  } },
    field('User name', h('input', { name: 'username', required: true, maxlength: 64, autocomplete: 'off', autocapitalize: 'none' })),
    field('Name', h('input', { name: 'fullname', maxlength: 64, autocomplete: 'off' })),
    field('Role', select('role', assignable.filter((r) => r !== 'service').map((r) => [r, roleLabel(r)]), 'adult')),
    field('Password (12+ characters)', h('input', { name: 'password', type: 'password', required: true, minlength: 12, autocomplete: 'new-password' })),
    h('button', { class: 'btn primary', type: 'submit', 'data-act': 'create-user' }, 'Create account'));

  root.append(
    h('h2', null, 'People'),
    h('section', { class: 'panel', id: 'p-newuser' }, h('h3', null, 'Add a Mantel account'),
      note('For someone who signs in with their own user name and password. They can add a PIN, an authenticator app and passkeys themselves.', 'muted small'), form),
    list,
    live('p-halinks', 'Home Assistant users', async () => {
      const { users } = await api('GET', '/api/users');
      const linked = users.filter((u) => u.ha_user_id);
      return [
        linked.length ? h('ul', { class: 'list' }, linked.map((u) => item([
          head(h('b', null, u.name || u.id), badge(roleLabel(u.role)), u.disabled && badge('disabled', 'bad')),
          meta('Home Assistant user id ' + u.ha_user_id)]))) : note('No Home Assistant users are linked yet.'),
        note('A person who signs in with Home Assistant only gets in once they are linked to a role here. When they try and are not linked, their sign-in page shows their Home Assistant user id. To link them, run this on the Mantel Server (the Docker or LXC shell):', ''),
        h('p', null, h('code', null, 'mantel-server link --ha-user-id <HA user id> --role adult --name "Their name"')),
        note('To end a link: mantel-server unlink --ha-user-id <HA user id>. To list links: mantel-server links. To lock someone out for now, Disable them above.', 'muted small'),
      ];
    }));
}

// ============================================================================================================
// Devices
// ============================================================================================================
function renderDevices(root) {
  const lan = state.me.door === 'lan';
  const list = live('p-devices', 'Wall tablets', async (reload) => {
    const { devices } = await api('GET', '/api/devices');
    const live_ = devices.filter((d) => !d.revoked);
    const gone = devices.filter((d) => d.revoked);
    const row = (d) => item([
      head(h('b', null, d.name), d.room && badge(d.room), badge(roleLabel(d.role)), d.revoked && badge('revoked' + (d.revoked_reason ? ': ' + d.revoked_reason.replace(/_/g, ' ') : ''), 'bad')),
      meta(`last seen ${ago(d.last_seen)} · ${d.source_ip || 'no address yet'} · enrolled ${fmt(d.created)}`),
    ], d.revoked ? null : btn('Revoke', async () => {
      if (!(await confirmDialog('Revoke ' + d.name + '?', 'The tablet is refused at once and has to be enrolled again.', 'Revoke', true))) return;
      if (await run(() => api('DELETE', '/api/devices/' + encodeURIComponent(d.id)), 'Device revoked.')) reload();
    }, 'danger', 'revoke-device'), d.revoked ? 'off' : '');
    return [live_.length ? h('ul', { class: 'list' }, live_.map(row)) : note('No wall tablets are enrolled.'),
            gone.length ? [h('h3', null, 'Revoked'), h('ul', { class: 'list' }, gone.map(row))] : null];
  });
  const name = h('input', { name: 'device-name', required: true, maxlength: 64, placeholder: 'Kitchen tablet', autocomplete: 'off' });
  const room = h('input', { name: 'device-room', maxlength: 64, placeholder: 'Kitchen', autocomplete: 'off' });
  const roles = state.me.device_roles;
  const roleSel = select('device-role', roles.map((r) => [r, roleLabel(r)]), 'wall_tablet');
  const enroll = h('section', { class: 'panel', id: 'p-enroll' }, h('h3', null, 'Make this browser a wall tablet'),
    lan ? [
      note('Open /admin on the tablet, sign in as an Owner or Admin, and do this. The person is signed out of the tablet at once and the tablet keeps its own credential, for this room only. It only works on the home network.', ''),
      h('form', { class: 'grid', onsubmit: async (ev) => {
        ev.preventDefault();
        if (!(await confirmDialog('Make this browser a wall tablet?', 'You will be signed out here. From now on this browser acts as the tablet "' + name.value.trim() + '".', 'Make it a tablet'))) return;
        const r = await run(() => api('POST', '/api/devices/enroll',
          { name: name.value.trim(), room: room.value.trim() || undefined, role: roleSel.value }));
        if (!r) return;
        state.enrolled = true;
        $('#nav').replaceChildren();
        $('#who').textContent = '';
        $('#app').replaceChildren(h('section', { class: 'panel', id: 'p-enrolled' }, h('h2', null, 'This browser is now a wall tablet'),
          h('p', null, `"${r.device.name}"${r.device.room ? ' in ' + r.device.room : ''} is enrolled as a ${roleLabel(r.device.role)}. You have been signed out of this browser.`),
          h('p', null, h('a', { href: '/home' }, 'Open the dashboard'))));
        say('');
      } }, field('Name', name), field('Room', room), field('Role', roleSel),
        h('button', { class: 'btn primary', type: 'submit', 'data-act': 'enroll-device' }, 'Make this a wall tablet'))]
      : note('Devices can only be enrolled on the home network.'));
  root.append(h('h2', null, 'Devices'), list, enroll);
}

// ============================================================================================================
// Roles & grants
// ============================================================================================================
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
  const order = state.me.actions.concat(['*']);
  const what = g.actions.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(', ');
  const on = g.resource_kind === 'all' ? 'everything' : g.resource_kind === 'feature' ? 'the ' + g.resource + ' feature' : g.resource_kind + ' ' + g.resource;
  const dom = g.domains.length ? ' (only ' + g.domains.join(', ') + ')' : '';
  return `${g.effect === 'deny' ? 'Deny' : 'Allow'} ${what} on ${on}${dom}${describeSchedule(g.schedule)}`;
}

function renderRoles(root) {
  root.append(h('h2', null, 'Roles & grants'), rolesPanel(), grantsPanel(), scopesPanel());
}

function rolesPanel() {
  return live('p-roles', 'Roles', async () => {
    const { roles } = await api('GET', '/api/rbac/roles');
    const switches = { tunnel_sensitive: 'Sensitive actions from outside the house', tunnel_cameras: 'Cameras from outside the house',
                       tunnel_locations: 'Location history from outside the house', sensitive_needs_person: 'Sensitive actions need a person\'s PIN' };
    return [note('What each role may do by default. Owners always keep every permission. The grants below add to, or take away from, these.', 'muted small'),
      Object.values(roles).map((r) => h('details', { class: 'item', 'data-role': r.name },
        h('summary', null, h('b', null, roleLabel(r.name)), ' ', r.overridden && badge('changed', 'bad')),
        h('ul', { class: 'list' }, r.grants.length ? r.grants.map((g) => h('li', { class: 'meta' }, describeGrant(g))) : [h('li', { class: 'meta' }, 'No grants of its own.')]),
        h('div', { class: 'meta' }, Object.entries(switches).filter(([k]) => k in r).map(([k, label]) => `${label}: ${r[k] ? 'yes' : 'no'}`).join(' · '))))];
  });
}

function grantsPanel() {
  return live('p-grants', 'Grants', async (reload) => {
    const [{ grants }, { users }, { devices }] = await Promise.all([
      api('GET', '/api/rbac/grants'), api('GET', '/api/users'), api('GET', '/api/devices')]);
    const uname = Object.fromEntries(users.map((u) => [u.id, u.name || u.username || u.id]));
    const dname = Object.fromEntries(devices.map((d) => [d.id, d.name]));
    const who = (g) => [...g.roles.map(roleLabel), ...g.users.map((u) => uname[u] || u), ...g.devices.map((d) => (dname[d] || d) + ' (tablet)')].join(', ');
    return [
      grants.length ? h('ul', { class: 'list' }, grants.map((g) => item([
        head(h('b', null, who(g)), badge(g.effect, g.effect === 'deny' ? 'bad' : '')),
        meta(describeGrant(g) + (g.note ? ' · ' + g.note : '')),
      ], btn('Remove', async () => {
        if (!(await confirmDialog('Remove this grant?', describeGrant(g), 'Remove', true))) return;
        if (await run(() => api('DELETE', '/api/rbac/grants/' + g.id), 'Grant removed.')) reload();
      }, 'danger', 'remove-grant'))) ) : note('No extra grants. Everyone has just their role\'s defaults.'),
      grantForm(users, devices, reload),
    ];
  });
}

function grantForm(users, devices, reload) {
  const kind = select('resource_kind', state.me.resource_kinds, 'area');
  const resource = h('input', { name: 'resource', placeholder: 'light.kitchen, kitchen, 1st floor', autocomplete: 'off', autocapitalize: 'none' });
  const feature = select('feature', state.me.features, 'cameras');
  const resourceLabel = h('label', null, 'Which one', resource);
  const featureLabel = h('label', null, 'Which feature', feature);
  const sync = () => {
    resourceLabel.hidden = ['all', 'feature'].includes(kind.value);
    featureLabel.hidden = kind.value !== 'feature';
  };
  kind.addEventListener('change', sync);
  sync();
  const targetKind = select('target_kind', [['roles', 'A role'], ['users', 'A person'], ['devices', 'A wall tablet']], 'roles');
  const targetValue = select('target_value', []);
  const fillTargets = () => {
    const list = targetKind.value === 'roles' ? state.me.roles.map((r) => [r, roleLabel(r)])
      : targetKind.value === 'users' ? users.map((u) => [u.id, u.name || u.username || u.id])
        : devices.filter((d) => !d.revoked).map((d) => [d.id, d.name + (d.room ? ' (' + d.room + ')' : '')]);
    targetValue.replaceChildren(...list.map(([v, t]) => h('option', { value: v }, t)));
  };
  targetKind.addEventListener('change', fillTargets);
  fillTargets();
  const days = checks('days', DAYS.map((d, i) => [String(i), d]), DAYS.map((d, i) => String(i)));
  const form = h('form', { class: 'stack', id: 'grant-form', onsubmit: async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const body = {
      effect: f.effect.value, actions: checked(f, 'actions'), resource_kind: kind.value,
      resource: kind.value === 'feature' ? feature.value : kind.value === 'all' ? '' : resource.value.trim(),
      domains: f.domains.value.split(',').map((s) => s.trim()).filter(Boolean),
      [targetKind.value]: targetValue.value ? [targetValue.value] : [],
      note: f.note.value.trim(),
    };
    const start = f.start.value, end = f.end.value;
    const chosenDays = checked(f, 'days').map(Number);
    const sched = {};
    if (start || end) { sched.start = start; sched.end = end; }
    if (chosenDays.length && chosenDays.length < 7) sched.days = chosenDays;
    if (f.not_before.value) sched.not_before = new Date(f.not_before.value).getTime() / 1000;
    if (f.not_after.value) sched.not_after = new Date(f.not_after.value).getTime() / 1000;
    if (Object.keys(sched).length) body.schedule = sched;
    if (!body.actions.length) { say('Pick at least one action.', 'err'); return; }
    if (await run(() => api('POST', '/api/rbac/grants', body), 'Grant added.')) reload();
  } },
    h('fieldset', null, h('legend', null, 'Who'), h('div', { class: 'grid' }, field('Applies to', targetKind), field('Which', targetValue))),
    h('div', { class: 'grid' }, field('Effect', select('effect', [['allow', 'Allow'], ['deny', 'Deny']], 'allow'))),
    h('fieldset', null, h('legend', null, 'Actions'), checks('actions', state.me.actions.concat(['*']), ['view'])),
    h('fieldset', null, h('legend', null, 'On what'), h('div', { class: 'grid' }, field('Kind', kind), resourceLabel, featureLabel,
      field('Only these domains (optional, comma separated)', h('input', { name: 'domains', placeholder: 'light, switch', autocomplete: 'off', autocapitalize: 'none' })))),
    h('details', null, h('summary', null, 'When (optional schedule)'),
      h('div', { class: 'grid' }, field('From time of day (house time)', h('input', { name: 'start', type: 'time' })),
        field('Until time of day', h('input', { name: 'end', type: 'time' })),
        field('Starting (this browser\'s clock)', h('input', { name: 'not_before', type: 'datetime-local' })),
        field('Ending (this browser\'s clock)', h('input', { name: 'not_after', type: 'datetime-local' }))),
      h('fieldset', null, h('legend', null, 'Days the window starts on'), days)),
    field('Note (optional)', h('input', { name: 'note', maxlength: 200 })),
    h('button', { class: 'btn primary', type: 'submit', 'data-act': 'add-grant' }, 'Add grant'));
  return h('details', { id: 'add-grant-box' }, h('summary', null, h('b', null, 'Add a grant')), form);
}

function scopesPanel() {
  return live('p-scopes', 'Rooms for a person or tablet', async () => {
    const [{ users }, { devices }, areasRes] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/devices'), fetch('/api/areas', { credentials: 'same-origin' })]);
    const areas = areasRes.ok ? await areasRes.json() : [];
    const kind = select('scope_kind', [['user', 'A person'], ['device', 'A wall tablet']], 'user');
    const subject = select('scope_subject', []);
    const out = h('div', { id: 'scope-areas' });
    const fillSubjects = () => {
      const list = kind.value === 'user' ? users.map((u) => [u.id, `${u.name || u.username} (${roleLabel(u.role)})`])
        : devices.filter((d) => !d.revoked).map((d) => [d.id, d.name + (d.room ? ' (' + d.room + ')' : '')]);
      subject.replaceChildren(...list.map(([v, t]) => h('option', { value: v }, t)));
    };
    let latest = 0;                                  // answers can arrive out of order: only the newest request draws
    const load = async () => {
      const mine = ++latest;
      if (!subject.value) { out.replaceChildren(note('Nobody to pick.')); return; }
      let current;
      try { current = (await api('GET', `/api/rbac/scopes/${kind.value}/${encodeURIComponent(subject.value)}`)).areas; } catch (e) { if (mine === latest) out.replaceChildren(errorPanel(e)); return; }
      if (mine !== latest) return;
      const known = new Set(areas.map((a) => a.id));
      const options = areas.map((a) => [a.id, a.name]).concat(current.filter((a) => !known.has(a)).map((a) => [a, a]));
      const form = h('form', { class: 'stack', 'data-subject': subject.value, onsubmit: async (ev) => {
        ev.preventDefault();
        const r = await run(() => api('PUT', `/api/rbac/scopes/${kind.value}/${encodeURIComponent(subject.value)}`, { areas: checked(form, 'areas') }), 'Rooms saved.');
        if (r) load();
      } }, options.length ? checks('areas', options, current) : note('Home Assistant has not told Mantel about any areas yet.'),
        h('button', { class: 'btn primary', type: 'submit', 'data-act': 'save-scopes' }, 'Save rooms'));
      out.replaceChildren(form);
    };
    kind.addEventListener('change', () => { fillSubjects(); load(); });
    subject.addEventListener('change', load);
    fillSubjects();
    load();
    return [note('A Child\'s or Guest\'s rooms, or a wall tablet\'s room, are what "their areas" means in a grant. Pick who, then tick the rooms.', 'muted small'),
            h('div', { class: 'grid' }, field('Who', kind), field('Which', subject)), out];
  });
}

// ============================================================================================================
// Service accounts
// ============================================================================================================
function renderService(root) {
  const tokenBox = h('div', { id: 'token-slot' });
  const list = live('p-service', 'Service accounts', async (reload) => {
    const { accounts } = await api('GET', '/api/service-accounts');
    const active = accounts.filter((a) => !a.revoked);
    const gone = accounts.filter((a) => a.revoked);
    const row = (a) => item([
      head(h('b', null, a.name), ...a.scopes.map((s) => badge(s)), a.revoked && badge('revoked', 'bad')),
      meta(`created ${fmt(a.created)} · last used ${ago(a.last_used)}${a.last_ip ? ' from ' + a.last_ip : ''}`),
    ], a.revoked ? null : btn('Revoke', async () => {
      if (!(await confirmDialog('Revoke ' + a.name + '?', 'Whatever uses this credential is cut off at once.', 'Revoke', true))) return;
      if (await run(() => api('DELETE', '/api/service-accounts/' + encodeURIComponent(a.id)), 'Service account revoked.')) reload();
    }, 'danger', 'revoke-service'), a.revoked ? 'off' : '');
    return [active.length ? h('ul', { class: 'list' }, active.map(row)) : note('No service accounts.'),
            gone.length ? [h('h3', null, 'Revoked'), h('ul', { class: 'list' }, gone.map(row))] : null];
  });
  const name = h('input', { name: 'service-name', required: true, maxlength: 64, placeholder: 'home-assistant', autocomplete: 'off', autocapitalize: 'none' });
  const form = h('form', { class: 'stack', id: 'create-service', onsubmit: async (ev) => {
    ev.preventDefault();
    const scopes = checked(ev.target, 'scopes');
    const r = await run(() => api('POST', '/api/service-accounts', { name: name.value.trim(), scopes }));
    if (!r) return;
    name.value = '';
    const dismiss = h('button', { class: 'btn primary', type: 'button', 'data-act': 'dismiss-token', onclick: () => tokenBox.replaceChildren() }, 'I have saved it');
    const copy = h('button', { class: 'btn', type: 'button', 'data-act': 'copy-token', onclick: async () => {
      try { await navigator.clipboard.writeText(r.token); say('Copied.', 'ok'); } catch (e) { say('Select the credential and copy it by hand.', 'err'); }
    } }, 'Copy');
    tokenBox.replaceChildren(h('section', { class: 'panel token', id: 'p-token' }, h('h3', null, 'Credential for ' + r.account.name),
      note('This is the only time it is shown. Paste it where it is needed (Home Assistant: Settings, Devices & services, HK Frontend, Configure, Linked to Mantel Server). Mantel keeps only a hash.', ''),
      h('code', { class: 'secret', id: 'service-token' }, r.token), h('div', { class: 'acts' }, copy, dismiss)));
    list.reload();
  } },
    h('div', { class: 'grid' }, field('Name', name)),
    h('fieldset', null, h('legend', null, 'What it may reach'), checks('scopes', state.me.service_scopes, state.me.service_scopes)),
    h('button', { class: 'btn primary', type: 'submit', 'data-act': 'create-service' }, 'Create service account'));
  root.append(h('h2', null, 'Service accounts'),
    note('A service account is a machine credential, like the one the Home Assistant integration uses to link to Mantel. It has no password, no session and no role: only the endpoints ticked here. Managed on the home network only.', 'muted small'),
    tokenBox, list, h('section', { class: 'panel', id: 'p-newservice' }, h('h3', null, 'New service account'), form));
}

// ============================================================================================================
// Audit
// ============================================================================================================
function renderAudit(root) {
  const table = h('div', { id: 'audit-table' });
  const pager = h('div', { class: 'pager', id: 'audit-pager' });
  const stack = [null];             // the `before` cursor of each page shown so far
  let filters = {};
  let retention = null;
  const filterForm = h('form', { class: 'stack', id: 'audit-filters' });

  const query = (before) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v !== '' && v !== undefined && v !== null) q.set(k, v);
    if (before) q.set('before', before);
    return q.toString();
  };
  const userNames = {}, deviceNames = {};         // ids to names, when this identity may read the lists
  const whoOf = (r) => {
    const name = r.actor_name || userNames[r.actor] || r.actor || '';
    return name + (r.role && name ? ' (' + roleLabel(r.role) + ')' : '');
  };
  const targetOf = (t) => (Array.isArray(t) ? t.join(', ') : t && typeof t === 'object' ? JSON.stringify(t) : t);
  const cell = (text, cls) => h('td', { class: cls || '' }, text === null || text === undefined ? '' : text);
  async function load() {
    say('');
    let data;
    try { data = await api('GET', '/api/audit?' + query(stack[stack.length - 1])); } catch (e) { table.replaceChildren(errorPanel(e)); return; }
    retention = data.retention_days;
    const rows = data.rows;
    table.replaceChildren(rows.length ? h('div', { class: 'scroll' }, h('table', null,
      h('thead', null, h('tr', null, ['Time', 'Who', 'At device', 'Action', 'Target', 'Decision', 'Why', 'Confirmed by', 'Result', 'From'].map((c) => h('th', null, c)))),
      h('tbody', null, rows.map((r) => h('tr', { class: r.decision === 'denied' ? 'denied' : r.decision === 'step_up' ? 'step' : '', 'data-id': r.id },
        cell(fmtFull(r.timestamp)), cell(whoOf(r), 'wrap'),
        cell(r.device ? (deviceNames[r.device] || r.device_role || String(r.device).slice(0, 6)) : ''), cell(r.action, 'wrap'),
        cell(targetOf(r.target), 'wrap'), cell(r.decision), cell((r.reason || '').replace(/_/g, ' '), 'wrap'),
        cell(r.step_up || ''), cell(r.result || ''), cell([r.door, r.source_ip].filter(Boolean).join(' ')))))))
      : note('No entries match.'));
    pager.replaceChildren(
      btn('Newer', () => { stack.pop(); load(); }, '', 'audit-newer'),
      h('span', { class: 'muted' }, `Page ${stack.length}`),
      btn('Older', () => { stack.push(data.next); load(); }, '', 'audit-older'),
      retention ? h('span', { class: 'muted small' }, `Entries older than ${retention} days are removed.`) : null);
    pager.firstChild.disabled = stack.length === 1;
    pager.children[2].disabled = !data.next;
  }

  (async () => {
    let users = null, devices = null;
    try { users = (await api('GET', '/api/users')).users; } catch (e) { users = null; }
    try { devices = (await api('GET', '/api/devices')).devices; } catch (e) { devices = null; }
    for (const u of users || []) userNames[u.id] = u.name || u.username || u.id;
    for (const d of devices || []) deviceNames[d.id] = d.name;
    const actor = users ? select('actor', [['', 'Anyone']].concat(users.map((u) => [u.id, `${u.name || u.username} (${roleLabel(u.role)})`])), '')
      : h('input', { name: 'actor', placeholder: 'user id', autocomplete: 'off' });
    const device = devices ? select('device', [['', 'Any tablet']].concat(devices.map((d) => [d.id, d.name + (d.revoked ? ' (revoked)' : '')])), '')
      : h('input', { name: 'device', placeholder: 'device id', autocomplete: 'off' });
    filterForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const stamp = (v) => (v ? String(new Date(v).getTime() / 1000) : '');
      filters = { actor: f.actor.value.trim(), device: f.device.value.trim(), decision: f.decision.value, kind: f.kind.value,
                  since: stamp(f.since.value), until: stamp(f.until.value), limit: f.limit.value };
      stack.length = 1;
      load();
    });
    filterForm.addEventListener('reset', () => setTimeout(() => filterForm.requestSubmit(), 0));
    filterForm.append(
      h('div', { class: 'grid compact' }, field('Who', actor), field('Tablet', device),
        field('Decision', select('decision', [['', 'Any'], ['allowed', 'Allowed'], ['denied', 'Denied'], ['step_up', 'Needed confirmation']], '')),
        field('Kind', select('kind', [['', 'Any'], ['service', 'Service calls'], ['ws', 'Home Assistant writes'], ['http', 'HTTP'], ['ma', 'Music'], ['config', 'Settings and roles'], ['system', 'System']], '')),
        field('From', h('input', { name: 'since', type: 'datetime-local' })), field('To', h('input', { name: 'until', type: 'datetime-local' })),
        field('Rows per page', select('limit', ['25', '50', '100'], '25'))),
      h('div', { class: 'acts' }, h('button', { class: 'btn primary', type: 'submit', 'data-act': 'audit-apply' }, 'Show'),
        h('button', { class: 'btn', type: 'reset', 'data-act': 'audit-clear' }, 'Clear')));
    filters = { limit: '25' };
    load();
  })();

  root.append(h('h2', null, 'Audit'),
    note('Every house command and every refused request, newest first: who, at which tablet, what, and the result.', 'muted small'),
    h('section', { class: 'panel', id: 'p-audit-filters' }, filterForm), table, pager);
}

// ============================================================================================================
// Shell
// ============================================================================================================
const RENDER = { me: renderMe, people: renderPeople, devices: renderDevices, roles: renderRoles, service: renderService, audit: renderAudit };

function renderSection(name) {
  if (state.enrolled) return;
  const sections = state.me.sections;
  if (!sections.includes(name)) name = 'me';
  state.section = name;
  for (const b of document.querySelectorAll('#nav button')) b.setAttribute('aria-current', b.dataset.section === name ? 'page' : 'false');
  const root = h('div', { id: 'section-' + name, 'data-section': name });
  $('#app').replaceChildren(root);
  say('');
  RENDER[name](root);
}

async function start() {
  try {
    await refreshMe();
  } catch (e) {
    $('#loading').replaceWith(errorPanel(e));
    return;
  }
  state.skew = state.me.now - Date.now() / 1000;
  const u = state.me.user;
  $('#who').textContent = `${u.name || u.username} · ${roleLabel(u.role)} · ${state.me.door === 'lan' ? 'home network' : 'remote'}`;
  const nav = $('#nav');
  for (const s of state.me.sections) {
    nav.append(h('button', { type: 'button', 'data-section': s, onclick: () => { location.hash = s; } }, SECTION_LABEL[s]));
  }
  window.addEventListener('hashchange', () => renderSection(location.hash.slice(1)));
  renderSection(location.hash.slice(1));
  window.__adminReady = true;
}
start();
