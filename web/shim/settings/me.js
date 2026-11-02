// settings/me.js -- Mantel Settings, Me: sign-in, passkeys, authenticator, PIN, password, notifications, apps, sessions.
import { mantelUrl, base as BASE } from '../base.js';
import {
  act, ago, api, ask, can, ERRORS, fmt, forget, hh, K, load, me, panel, redraw, refreshMe, roleLabel, ROUTE, shortUA,
  shown, ui
} from './core.js';
import {
  button, clearDraft, draft, failed, field, group, houseTitle, info, nav, pending, result, screenPicker,
  secretCell, signOut
} from './kit.js';
import { usersRead } from './people.js';
import { pEnroll } from './devices.js';

// ============================================================================================ Me
export function pMe(sub) {
  const u = me.user;
  if (sub[0] === 'pin') return pMyPin();
  if (sub[0] === 'password' && hasMantelPassword(u)) return pMyPassword();
  if (sub[0] === 'enroll') return pEnroll(['Me', '#/' + ROUTE + '/me']);
  if (sub[0] === 'sessions' && sub[1]) return pSessions(decodeURIComponent(sub[1]));
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
    else drawSessions(c, ss.data.sessions);
    if (u.role === 'wall_tablet') {
      // a Wall Tablet account sees only this page, and may make its own tablet (devices.enroll): the way in for a
      // tablet that cannot use Sign in with Home Assistant (trusted_networks signs it in as itself; 2026-10-19)
      c.appendChild(group({ footer: me.door === 'lan' ? 'On the tablet itself: this browser becomes the wall tablet, and this account is signed out here.'
        : 'Devices can only be enrolled on the home network.' }, [me.door === 'lan' ? nav('Make This Browser a Wall Tablet…', 'me/enroll', { icon: 'mdi:tablet' })
        : info('Make This Browser a Wall Tablet', null, 'Home Network Only')]));
    }
    drawNotifications(c);
    drawSystemAlerts(c);
    drawApps(c);
    drawPasskeys(c);
    drawTotp(c);
    c.appendChild(group({ footer: 'Optional, and not used for now: the only PIN is the house Alarm PIN, for the alarm.' }, [nav('My PIN', 'me/pin')]));
    // through Home Assistant's Ingress Home Assistant holds the sign-in: nothing to sign out of here
    if (!BASE) c.appendChild(group({ footer: 'Ends this browser’s session.' }, [button('Sign Out', signOut, { destructive: true, center: true, fk: 'mx:signout' })]));
  } };
}
// MY SESSIONS (2026-10-28): one row per kind of browser -- "Safari on Mac", on the home network or from outside --
// not one per sign-in, with how many and when one was last used; a row opens its sessions, each with its own Sign
// Out. A browser signing in again now ends its last session (sessions.py browser_of), so the repeats are the ones
// from before that, or other devices of the same kind. Sign Out Everywhere Else ends all but this one.
const sessKey = (s) => shortUA(s.user_agent) + '|' + s.door;
const sessWhere = (s) => (s.door === 'lan' ? 'Home network' : 'Remote');
const HOW = { ha: 'Signed in with Home Assistant', ingress: 'Home Assistant’s sidebar', password: 'Signed in with a password',
              'password+totp': 'Password and authenticator', passkey: 'Signed in with a passkey', bootstrap: 'First sign-in',
              legacy: 'Earlier sign-in', 'app-web': 'The Mantel app', mcp: 'An assistant (Assistants)',
              mcp_preview: 'An assistant’s screen preview' };
const sessHow = (s) => HOW[s.method] || s.method + ' sign-in';
function sessGroups(list) {
  const by = new Map();
  for (const s of list) {
    if (s.current) continue;
    const k = sessKey(s);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(s);
  }
  return [...by.entries()].map(([k, l]) => ({ key: k, list: l.sort((a, b) => b.last_seen - a.last_seen) }))
    .sort((a, b) => b.list[0].last_seen - a.list[0].last_seen);
}
function drawSessions(c, list) {
  const cur = list.find((s) => s.current);
  const rows = [];
  if (cur) rows.push(info(shortUA(cur.user_agent) + ' (This Browser)', `${sessWhere(cur)} · ${sessHow(cur)} · ends ${fmt(cur.expires)}`));
  const groups = sessGroups(list);
  for (const g of groups) {
    const s = g.list[0];
    rows.push(nav(shortUA(s.user_agent), 'me/sessions/' + encodeURIComponent(g.key),
      { sub: `${sessWhere(s)} · last seen ${ago(s.last_seen)}`, value: g.list.length > 1 ? String(g.list.length) : undefined }));
  }
  const others = groups.reduce((n, g) => n + g.list.length, 0);
  c.appendChild(group({ header: 'My Sessions', footer: 'Every browser signed in as you, by kind. A browser that signs in again replaces its last session. The Mantel app is under Mantel App, below.' },
    rows.length ? rows : [info('No active sessions')]));
  if (others) {
    c.appendChild(group({ footer: 'Signs out every other browser (' + others + ' session' + (others > 1 ? 's' : '') + '). This one stays signed in, and so does the Mantel app.' },
      [button('Sign Out Everywhere Else', async () => {
        if (!(await ask({ title: 'Sign out everywhere else?', message: 'Every other browser signed in as you is signed out at once.', ok: 'Sign Out', destructive: true }))) return;
        await act('me', () => api('POST', '/api/sessions/revoke-others'), 'Signed out everywhere else.', 'sessions');
      }, { destructive: true, center: true, fk: 'mx:revoke-others' })]));
  }
}
// one kind of browser's sessions, each with its details and its own Sign Out
function pSessions(key) {
  const ss = load('sessions', () => api('GET', '/api/sessions'));
  const g = ss && ss.data ? sessGroups(ss.data.sessions).find((x) => x.key === key) : null;
  const title = key.split('|')[0];
  return { title, back: ['Me', '#/' + ROUTE + '/me'], scope: g ? sessWhere(g.list[0]) + ' · ' + g.list.length + ' session' + (g.list.length > 1 ? 's' : '') : '',
  body(c) {
    result(c, 'me');
    if (!ss) return pending(c);
    if (ss.err) return failed(c, ss.err);
    if (!g) { c.appendChild(group({}, [info('No sessions left', 'They were signed out.')])); return; }
    for (const s of g.list) {
      c.appendChild(group({}, [info('Last seen ' + ago(s.last_seen), `${sessHow(s)} · ${s.source_ip || 'unknown address'} · since ${fmt(s.created)} · ends ${fmt(s.expires)}`),
        button('Sign Out', async () => {
          if (!(await ask({ title: 'Sign out this session?', message: 'That browser is signed out at once.', ok: 'Sign Out', destructive: true }))) return;
          await act('me', () => api('DELETE', '/api/sessions/' + encodeURIComponent(s.id)), 'Signed out.', 'sessions');
        }, { destructive: true, fk: 'mx:revoke-session:' + s.id })]));
    }
    if (g.list.length > 1) {
      c.appendChild(group({}, [button('Sign Out All ' + g.list.length, async () => {
        if (!(await ask({ title: 'Sign out all ' + g.list.length + '?', message: 'Each of these browsers is signed out at once.', ok: 'Sign Out', destructive: true }))) return;
        let n = 0;
        for (const s of g.list) { try { await api('DELETE', '/api/sessions/' + encodeURIComponent(s.id)); n++; } catch (e) { /* gone already */ } }
        forget('sessions');
        ui.flash = { key: 'me', text: n + ' session' + (n > 1 ? 's' : '') + ' signed out.' };
        location.hash = '#/' + ROUTE + '/me';
      }, { destructive: true, center: true, fk: 'mx:revoke-group' })]));
    }
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
      if (!(await ask({ title: 'Stop notifications there?', message: t.kind === 'apns'
        ? 'That device will no longer get Mantel’s notifications. To have them again, choose Turn On Notifications in its Mantel app.'
        : 'That device will no longer get Mantel’s notifications.', ok: 'Stop', destructive: true }))) return;
      await act('me', () => api('DELETE', '/api/push/targets/' + encodeURIComponent(t.id)), 'Removed.', 'pushtargets', 'pushhere');
    }, { destructive: true, fk: 'mx:push-del:' + t.id }));
  }
  c.appendChild(group({ header: 'Notifications', footer: 'The house’s notifications on your phone or computer, as well as on the screens. Only what you may see.' }, rows));
  if (acts.length) c.appendChild(group({}, acts));
}
// SYSTEM ALERTS (alerts/api.py, docs/phase14/SYSTEM-ALERTS.md): Mantel's own alerts on this person's Mantel apps and
// browsers. Owners and Admins only (the Alerts section); an Owner has it on until it is turned off.
function drawSystemAlerts(c) {
  if (!can('alerts') || !['owner', 'admin'].includes(me.user.role)) return;
  const got = load('myalerts', () => api('GET', '/api/alerts/me'));
  if (!got) { pending(c); return; }
  if (got.err) { failed(c, got.err); return; }
  c.appendChild(group({ header: 'System Alerts', footer: 'Mantel’s own alerts (Home Assistant disconnected, a backup failed, an update) on your Mantel apps and browsers. Where else they go is in Alerts.' }, [
    K().toggle({ label: 'System Alerts', on: got.data.system_alerts, fk: 'mx:system-alerts',
      onChange: (on) => act('me', () => api('PUT', '/api/alerts/me', { system_alerts: on }), on ? 'System alerts turned on.' : 'System alerts turned off.', 'myalerts', 'alerts') }),
    nav('Alerts', 'alerts', { icon: 'mdi:bell-ring' })]));
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
         if (!/^\d{4,8}$/.test(d.pin || '')) { ui.flash = { key: 'pin', text: 'A PIN is 4 to 8 digits.', err: true }; redraw(); return; }
         if (d.pin !== d.again) { ui.flash = { key: 'pin', text: 'The two PINs do not match.', err: true }; redraw(); return; }
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
export const hasMantelPassword = (u) => !!u && u.kind !== 'ha_linked' && !!u.username;
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
      if (bad) { ui.flash = { key: 'password', text: bad, err: true }; redraw(); return; }
      const body = has ? { current: d.current || '', new: d.new } : { new: d.new };
      clearDraft('password');
      if (!(await act('password', () => api('POST', '/api/account/password', body), null, 'sessions'))) return;
      try { await refreshMe(); } catch (e) { /* the page still says it worked */ }
      ui.flash = { key: 'me', text: (has ? 'Password changed.' : 'Password set.') + ' Your other sessions have ended.' };
      panel.go('#/' + ROUTE + '/me');
    }, { center: true, fk: 'mx:change-password' })]));
  } };
}
// SOMEONE ELSE'S PASSWORD (accounts.users_set_password): an Owner or Admin sets a new one (an Admin never an Owner's),
// after a fresh confirmation; every session that person has ends, and the audit log records who did it
export function pPersonPassword(id) {
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
      if (bad) { ui.flash = { key: 'resetpw', text: bad, err: true }; redraw(); return; }
      if (!(await ask({ title: 'Set a new password for ' + (u.name || u.username) + '?', message: 'Their old password stops working and every browser signed in as them is signed out now.',
        ok: 'Set Password', destructive: true }))) return;
      const value = d.new;
      clearDraft('resetpw');
      const r = await act('resetpw', () => api('POST', '/api/users/' + encodeURIComponent(u.id) + '/password', { password: value }), null, 'users');
      if (!r) return;
      ui.flash = { key: 'person', text: 'New password set.' + (r.sessions_ended ? ' ' + r.sessions_ended + ' session' + (r.sessions_ended > 1 ? 's' : '') + ' ended.' : '') };
      panel.go(back[1]);
    }, { center: true, destructive: true, fk: 'mx:reset-password' })]));
  } };
}
