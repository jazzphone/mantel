// Mantel sign-in page (/login). One ES module, no framework, no inline script or handler (CSP: script-src
// 'self'). It drives sign-in APIs that already exist and decide on their own (docs/phase3/LOGIN-PAGE.md):
//   passkey            POST /api/auth/passkey/options {}  ->  navigator.credentials.get  ->  /verify
//   password (+ code)  POST /api/auth/password  ->  ok | {next: 'totp', pending}  ->  /api/auth/totp/verify
//   Home Assistant     a plain link to login/ha (the server's OAuth start), works without JavaScript
// Nothing is stored: the pending token lives in a variable until the code step ends. The pure parts
// (safeNext, messageFor, retryText, baseFrom, signIn) are exported for tests; the DOM part runs only
// in a page.

import { credentialJSON, passkeysAvailable, toRequest } from '../webauthn.js';

export const DEFAULT_NEXT = '/home';
const NEXT_MAX = 1024;
const BASE_RE = /^\/api\/hassio_ingress\/[A-Za-z0-9_-]{1,128}$/;     // web/shim/base.js's rule
const NO_LANDING_EXACT = ['/login', '/logout', '/ws'];
const NO_LANDING_PREFIX = ['/login/', '/logout/', '/auth/', '/api/', '/ws/'];
const URL_CHARS = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?#%]+$/;            // RFC 3986: no space, \, quotes, <>
const DOT_SEGMENT =/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;

// Where to go after signing in: a same-origin relative path, else the default screen. The same rules
// as login_page.safe_next on the server (tests run both on one table).
export function safeNext(value) {
  if (typeof value !== 'string' || !value || value.length > NEXT_MAX) return DEFAULT_NEXT;
  if (!URL_CHARS.test(value) || value.charAt(0) !== '/' || value.charAt(1) === '/') return DEFAULT_NEXT;
  const path = value.split(/[?#]/, 1)[0];
  if (DOT_SEGMENT.test(path)) return DEFAULT_NEXT;
  const low = path.toLowerCase();
  if (NO_LANDING_EXACT.indexOf(low) >= 0 || NO_LANDING_PREFIX.some((p) => low.indexOf(p) === 0)) return DEFAULT_NEXT;
  return value;
}

// The page's address prefix (HA App mode); '' everywhere else.
export const baseFrom = (content) => (typeof content === 'string' && BASE_RE.test(content) ? content : '');

export function retryText(seconds) {
  const s = Math.max(1, Math.ceil(Number(seconds) || 60));
  if (s < 60) return 'Try again in ' + s + (s === 1 ? ' second.' : ' seconds.');
  const m = Math.ceil(s / 60);
  return 'Try again in ' + m + (m === 1 ? ' minute.' : ' minutes.');
}

// What to tell the person. Never which part was wrong (user name or password), and never whether a
// user name exists: the server answers all of those with invalid_credentials.
export function messageFor(status, data, step) {
  const code = data && typeof data.error === 'string' ? data.error : null;
  if (status === 429 || code === 'too_many_attempts') return 'Too many tries. ' + retryText(data && data.retry_after);
  switch (code) {
    case 'invalid_credentials':
      return step === 'totp' ? 'That sign-in can no longer be used. Enter your password again.'
                             : 'That user name and password did not match.';
    case 'username_and_password_required': return 'Enter your user name and password.';
    case 'second_factor_required':
      return (data.methods || []).indexOf('passkey') >= 0
        ? 'Away from home, a password alone is not enough. Sign in with your passkey instead.'
        : 'Away from home, a password alone is not enough, and this account has no passkey or authenticator ' +
          'app yet. Sign in at home (or with Home Assistant) and add one.';
    case 'invalid_code': return 'That code was not accepted. Check your authenticator app and try again.';
    case 'pending_invalid': return 'That took too long. Enter your password again.';
    case 'origin_not_allowed_for_passkeys': return 'Passkeys need the name you use to reach Mantel, not an IP address.';
    case 'ingress_sign_in': return 'Inside Home Assistant, Home Assistant signs you in.';
    case 'bootstrap_token_invalid': return 'That setup code is wrong, used or expired. Make a new one on the server.';
    case 'bootstrap_closed': return 'Mantel already has an Owner. Sign in instead.';
    case 'password_too_short': return 'Passwords need at least 12 characters.';
    case 'password_too_long': return 'That password is too long.';
    case 'password_too_simple': return 'That password repeats too few characters. Pick a longer, varied one.';
    case 'password_contains_name': return 'The password must not contain the user name.';
    case 'username_invalid': return 'User names are 1 to 64 letters, digits, dots, dashes or underscores.';
    case 'json_required': case 'invalid_json': case 'origin_required':
      return 'This browser sent an incomplete request. Reload the page and try again.';
    default: break;
  }
  if (step === 'passkey' && (status === 400 || status === 401)) return 'That passkey was not accepted.';
  if (!status) return 'Could not reach Mantel. Check the connection and try again.';
  return 'Sign-in did not work (the server answered ' + status + '). Try again.';
}

// The sign-in steps, without the DOM. Each resolves to an outcome:
//   { kind: 'done', data } | { kind: 'totp', pending } | { kind: 'restart', message } | { kind: 'error', message, code, methods }
export function signIn({ fetchImpl, base = '', credentials } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  async function post(path, body) {
    let res;
    try {
      res = await doFetch(base + path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body || {}),
      });
    } catch (e) {
      return { status: 0, data: null };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { status: res.status, data };
  }
  const fail = (r, step) => ({ kind: 'error', status: r.status, code: (r.data && r.data.error) || null,
                               methods: (r.data && r.data.methods) || [], message: messageFor(r.status, r.data, step) });

  return {
    // first start (no Owner yet): is the one-time setup open?
    async setupOpen() {
      try {
        const res = await doFetch(base + '/api/bootstrap', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const data = await res.json();
        return res.status === 200 && !!(data && data.open);
      } catch (e) {
        return false;
      }
    },
    async bootstrap(token, username, name, password) {
      if (!token || !username || !password) return fail({ status: 400, data: { error: 'username_and_password_required' } });
      const r = await post('/api/bootstrap', { token, username, name: name || username, password });
      if (r.status === 200 && r.data && r.data.ok) return { kind: 'done', data: r.data };
      return fail(r, 'setup');
    },
    async password(username, password) {
      if (!username || !password) return fail({ status: 400, data: { error: 'username_and_password_required' } });
      const r = await post('/api/auth/password', { username, password });
      if (r.status === 200 && r.data && r.data.next === 'totp' && r.data.pending) return { kind: 'totp', pending: r.data.pending };
      if (r.status === 200 && r.data && r.data.ok) return { kind: 'done', data: r.data };
      return fail(r, 'password');
    },
    async totp(pending, code) {
      const clean = String(code || '').replace(/\s/g, '');
      if (!/^\d{6}$/.test(clean)) return { kind: 'error', code: 'code_format', methods: [], message: 'Enter the 6-digit code.' };
      const r = await post('/api/auth/totp/verify', { pending, code: clean });
      if (r.status === 200 && r.data && r.data.ok) return { kind: 'done', data: r.data };
      const code_ = r.data && r.data.error;
      if (code_ === 'pending_invalid' || code_ === 'invalid_credentials') {
        return { kind: 'restart', code: code_, message: messageFor(r.status, r.data, 'totp') };
      }
      return fail(r, 'totp');
    },
    async passkey() {
      const creds = credentials || (globalThis.navigator && globalThis.navigator.credentials);
      const o = await post('/api/auth/passkey/options', {});       // discoverable: no user name sent
      if (!(o.status === 200 && o.data && o.data.challenge_id)) return fail(o, 'passkey');
      let cred;
      try {
        cred = await creds.get({ publicKey: toRequest(o.data.options) });
      } catch (e) {
        const cancelled = e && (e.name === 'NotAllowedError' || e.name === 'AbortError');
        return { kind: 'error', code: cancelled ? 'cancelled' : 'unavailable', methods: [],
                 message: cancelled ? 'The passkey prompt was closed. Try again when you are ready.'
                                    : 'This device could not use a passkey here.' };
      }
      if (!cred) return { kind: 'error', code: 'cancelled', methods: [], message: 'No passkey was chosen.' };
      const v = await post('/api/auth/passkey/verify', { challenge_id: o.data.challenge_id, credential: credentialJSON(cred) });
      if (v.status === 200 && v.data && v.data.ok) return { kind: 'done', data: v.data };
      return fail(v, 'passkey');
    },
  };
}

// -- the page -----------------------------------------------------------------------------------------
function meta(doc, name) {
  const el = doc.querySelector('meta[name="' + name + '"]');
  return el ? el.getAttribute('content') || '' : '';
}

// In a frame of another site: a Webpage dashboard in Home Assistant's sidebar showing Mantel's own address.
// Mantel's own pages framing Mantel (HK Settings' preview, Ingress) are the same origin and do not count.
export function framedElsewhere(win) {
  try {
    if (win.top === win.self) return false;
    return win.top.location.origin !== win.location.origin;   // a cross-origin top throws: elsewhere
  } catch (e) {
    return true;
  }
}

// HA's sign-in page reads its query from HA's "main window": its own window when the window is named
// 'ha-main-window', else its parent when that one is. In a Webpage dashboard the parent IS HA's main window,
// so the page read the dashboard's address, found no redirect_uri and stopped ("Invalid redirect URI";
// HA frontend 2026.9). Naming this frame so before it goes there makes HA read its own address. The name
// is the frame's only; HA's page is the only reader.
export const HA_MAIN_WINDOW = 'ha-main-window';

// The page framing this one, as an origin (Chrome and Safari list it; Firefox does not: then '').
export function topOrigin(win) {
  const list = win.location && win.location.ancestorOrigins;
  const top = list && list.length ? list[list.length - 1] : '';
  return /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(top) ? top : '';
}

// login/ha?next=... plus that origin: the server uses it only when it is one of Home Assistant's own addresses
// (its frame-ancestors), so HA's sign-in page loads from the address the dashboard is on.
export function withVia(href, origin) {
  return href + (href.indexOf('?') >= 0 ? '&' : '?') + 'via=' + encodeURIComponent(origin);
}

export function start(doc = globalThis.document, win = globalThis.window) {
  const $ = (id) => doc.getElementById(id);
  const base = baseFrom(meta(doc, 'mantel-base'));
  const next = safeNext(meta(doc, 'mantel-next'));
  const flow = signIn({ base });
  const els = {
    status: $('status'), doorNote: $('door-note'), passkeyStep: $('passkey-step'), passkey: $('passkey'),
    orPassword: $('or-password'), orHa: $('or-ha'), pwForm: $('password-form'), user: $('username'),
    pw: $('password'), pwGo: $('password-go'), totpForm: $('totp-form'), code: $('code'),
    totpGo: $('totp-go'), back: $('totp-back'), setupForm: $('setup-form'),
  };
  let pending = null;
  let busy = false;
  const elsewhere = framedElsewhere(win);
  // HA's frame grants no WebAuthn (its iframe allows fullscreen only): a passkey can only fail there
  const hasPasskeys = passkeysAvailable() && !elsewhere;

  function say(text, ok) {
    els.status.textContent = text || '';
    els.status.className = 'status' + (ok ? ' ok' : '');
  }
  function setBusy(on) {
    busy = on;
    for (const b of [els.passkey, els.pwGo, els.totpGo, els.back]) b.disabled = on;
    els.pwForm.setAttribute('aria-busy', on ? 'true' : 'false');
    els.totpForm.setAttribute('aria-busy', on ? 'true' : 'false');
  }
  function invalid(fields, on) {
    for (const f of fields) {
      if (on) f.setAttribute('aria-invalid', 'true'); else f.removeAttribute('aria-invalid');
    }
  }
  function showPasswordStep() {
    pending = null;
    els.totpForm.hidden = true;
    els.code.value = '';
    els.pwForm.hidden = false;
    els.passkeyStep.hidden = !hasPasskeys;
    els.orPassword.hidden = !hasPasskeys;
  }
  function showTotpStep() {
    els.pwForm.hidden = true;
    els.passkeyStep.hidden = true;
    els.orPassword.hidden = true;
    els.totpForm.hidden = false;
    els.code.value = '';
    els.code.focus();
  }
  function done() {
    say('Signed in.', true);
    els.pw.value = '';
    // the page's own fragment, when the address signed out of had one (/settings#/screens/...): the
    // server never sees it, so it rides on this page's address; only a settings route (#/...)
    const frag = typeof win.location.hash === 'string' && /^#\/[\w%./~-]*$/.test(win.location.hash) && next.indexOf('#') < 0 ? win.location.hash : '';
    win.location.replace(base + next + frag);
  }
  async function run(step) {
    if (busy) return;
    setBusy(true);
    say('');
    try {
      return await step();
    } finally {
      setBusy(false);
    }
  }

  if (meta(doc, 'mantel-door') === 'tunnel') els.doorNote.hidden = false;
  showPasswordStep();
  els.orHa.hidden = false;
  const haLink = $('ha');
  if (elsewhere && haLink) {
    const via = topOrigin(win);
    if (via) haLink.setAttribute('href', withVia(haLink.getAttribute('href'), via));
    haLink.addEventListener('click', () => { win.name = HA_MAIN_WINDOW; });
  }

  els.passkey.addEventListener('click', () => run(async () => {
    const r = await flow.passkey();
    if (r.kind === 'done') return done();
    say(r.message);
  }));

  els.pwForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    run(async () => {
      invalid([els.user, els.pw], false);
      const r = await flow.password(els.user.value.trim(), els.pw.value);
      if (r.kind === 'done') return done();
      if (r.kind === 'totp') {
        pending = r.pending;
        els.pw.value = '';
        return showTotpStep();
      }
      say(r.message);
      if (r.code === 'invalid_credentials' || r.code === 'username_and_password_required') {
        invalid([els.user, els.pw], true);
        els.pw.value = '';
        (els.user.value ? els.pw : els.user).focus();
      } else if (r.code === 'second_factor_required') {
        els.pw.value = '';
        if (hasPasskeys && (r.methods || []).indexOf('passkey') >= 0) els.passkey.focus();
      }
    });
  });

  els.totpForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    run(async () => {
      invalid([els.code], false);
      const r = await flow.totp(pending, els.code.value);
      if (r.kind === 'done') return done();
      if (r.kind === 'restart') {
        showPasswordStep();
        say(r.message);
        els.pw.focus();
        return;
      }
      say(r.message);
      invalid([els.code], true);
      els.code.value = '';
      els.code.focus();
    });
  });

  // First start: while no Owner exists, offer the one-time setup; the new Owner then lands on Connections
  if (els.setupForm) {
    flow.setupOpen().then((open) => { if (open) els.setupForm.hidden = false; });
    els.setupForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      run(async () => {
        const f = els.setupForm;
        const pw = $('setup-password');
        const r = await flow.bootstrap($('setup-token').value.trim(), $('setup-username').value.trim(),
                                       $('setup-name').value.trim(), pw.value);
        if (r.kind === 'done') {
          pw.value = '';
          say('Owner created.', true);
          win.location.replace(base + '/settings#/mantel/connections');
          return;
        }
        say(r.message);
        f.setAttribute('aria-invalid', 'true');
      });
    });
  }

  els.back.addEventListener('click', () => {
    showPasswordStep();
    say('');
    els.pw.focus();
  });

  win.__loginReady = true;
}

if (typeof document !== 'undefined' && document.getElementById('password-form')) start();
