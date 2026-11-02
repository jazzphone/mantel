// settings/connections.js -- Mantel Settings, Connections: Home Assistant, Music Assistant, the push relay, HK's settings import.
import { act, api, ask, can, fmt, forget, hh, K, load, me, redraw, ROUTE, shown, ui } from './core.js';
import { button, clearDraft, draft, failed, field, group, info, nav, pending, result } from './kit.js';
import { pConnect } from './connect.js';
import { reloadPanel } from './tablets.js';
import { linkState, pHkFrontend, pLinkAdvanced, pMantelLink, pMoving } from './link.js';
import { pProxy } from './proxy.js';
import { drawHaAccess } from './general.js';
import { pProtect, protectRow } from './protect.js';

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
export function pConnections(sub) {
  if (sub[0] === 'ha' && sub[1] === 'link') return pMantelLink();
  if (sub[0] === 'ha' && sub[1] === 'hk-frontend') return pHkFrontend();
  if (sub[0] === 'ha' && sub[1] === 'sidebar' && can('connect')) return pConnect();
  if (sub[0] === 'ha' && sub[1] === 'moving') return sub[2] === 'advanced' ? pLinkAdvanced() : pMoving();
  if (sub[0] === 'link') return sub[1] === 'advanced' ? pLinkAdvanced() : pConnection('ha');     // its old address
  if (sub[0] === 'ma-page') return pConnection('ma');                                           // its old address
  if (sub[0] === 'ha' || sub[0] === 'ma') return pConnection(sub[0]);
  if (sub[0] === 'proxy') return pProxy();
  if (sub[0] === 'protect') return pProtect(sub.slice(1));
  if (sub[0] === 'push') return pPushRelay();
  return { title: 'Connections', top: true, scope: 'How Mantel reaches Home Assistant and Music Assistant, and how browsers and the app reach Mantel. Each connection is tested before it is saved. Tokens are kept sealed in Mantel’s data, never shown again and never leave the server; a change applies at once.', body(c) {
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
      return nav(x.label, 'connections/' + kind, { value, sub: kind === 'ha' ? 'Its connection, and Mantel Link and HK Frontend in it' : 'Its connection, and the Browse Music page’s sign-in',
                                                   icon: kind === 'ha' ? 'mdi:home-assistant' : 'mdi:music' });
    };
    c.appendChild(group({ footer: !can ? 'Only an Owner can change connections.' : got.data.needs_fresh ? 'From outside the home network you will be asked to confirm it is you first.' : null }, [row('ha'), row('ma'), protectRow()]));
    if (['owner', 'admin'].includes(me.user.role)) c.appendChild(group({ footer: 'How browsers reach Mantel, and how Mantel’s notifications reach the Mantel app on iPhone and iPad.' }, [
      nav('HTTPS and Your Proxy', 'connections/proxy', { icon: 'mdi:lock', sub: 'Mantel’s Caddy, your own proxy, the Home Assistant App or a Cloudflare tunnel' }),
      nav('Notifications to the App', 'connections/push', { icon: 'mdi:bell', sub: 'The push relay, your own, or none' })]));
  } };
}
// MANTEL IN HOME ASSISTANT, on Home Assistant's page (Owner and Admin): what Home Assistant has of Mantel, each
// with one way in. Mantel Link (Mantel's own integration: a pairing code, or Discovered under the App), HK Frontend
// (HK inside Home Assistant, if it is there: its credential) and Mantel Connect (Mantel in the sidebar when Mantel
// runs outside Home Assistant: a pairing code). What only matters while a house moves from HK Frontend is apart.
function drawInHa(c, x) {
  const got = linkState();
  if (!got) { pending(c, 'Reading what Home Assistant has of Mantel…'); return; }
  if (got.err) { failed(c, got.err); return; }
  const d = got.data, app = x && x.source === 'app';
  const rows = [nav('Mantel Link', 'connections/ha/link', { icon: 'mdi:link-variant', value: d.ml.length ? 'Connected' : 'Not Linked',
                                                             sub: 'Mantel’s own integration: the tablets and the house as entities, actions, notifications' })];
  if (d.hkThere) rows.push(nav('HK Frontend', 'connections/ha/hk-frontend', { icon: 'mdi:view-dashboard', value: d.hk.length ? 'Connected' : 'Not Linked',
                                                                             sub: 'HK’s dashboards inside Home Assistant, drawn with Mantel’s settings' }));
  if (can('connect')) {
    const cp = load('connect', () => api('GET', '/api/connect'));
    const paired = cp && cp.data ? cp.data.pairings.some((p) => !p.revoked) : null;
    rows.push(nav('Sidebar (Mantel Connect)', 'connections/ha/sidebar', { icon: 'mdi:dock-left', value: paired === null ? undefined : paired ? 'Paired' : 'Not Paired',
                                                                         sub: 'Mantel in Home Assistant’s sidebar and the Companion app' }));
  }
  c.appendChild(group({ header: 'Mantel in Home Assistant', footer: (app ? 'Mantel Link needs no code here: Home Assistant offers it under Settings, Devices & Services, Discovered. ' : '') +
      'Each one says what to do in Home Assistant.' }, rows));
  // only while there is something to move: HK Frontend in Home Assistant, or a tablet it still runs. Once every
  // tablet is Mantel's, the house is next, and the row says so (Set Up Mantel too: setup_guide.py "house")
  const tabs = (d.tablets || []).filter(Boolean), houseNext = d.hkThere && d.house && d.house.owner !== 'mantel' && tabs.every((t) => t.owner === 'mantel');
  if (d.hkThere || tabs.some((t) => t.owner !== 'mantel')) c.appendChild(group({ footer: houseNext
      ? 'Every wall tablet is Mantel’s: move the house next (Advanced, The House), so Mantel runs Seasonal Decorations, the Alarm PIN keypad and Live TV too.'
      : 'Who runs each wall tablet and the house, and HK’s settings imported once. Only while a house moves from HK Frontend to Mantel.' },
    [nav('Moving from HK Frontend', houseNext ? 'connections/ha/moving/advanced' : 'connections/ha/moving',
         { icon: 'mdi:transfer', value: houseNext ? 'Move the House' : undefined })]));
}
// NOTIFICATIONS TO THE APP (apns.py, docs/guide/Push-Notifications.md "Use another relay"): which push relay the house
// tells its apps to register with, an Owner's choice: the default relay, the Owner's own (https://), or none.
const RELAY_MODES = [['default', 'Default Relay'], ['custom', 'Your Own Relay'], ['off', 'Off']];
const RELAY_SAYS = { default: 'Default Relay', custom: 'Your Own Relay', off: 'Off', invalid: 'Not Valid' };
function pPushRelay() {
  return { title: 'Notifications to the App', back: ['Connections', '#/' + ROUTE + '/connections'], body(c) {
    result(c, 'pushrelay');
    const got = load('pushrelay', () => api('GET', '/api/app/push-relay'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const s = got.data, d = draft('pushrelay');
    if (d.mode === undefined) d.mode = s.mode === 'invalid' ? 'custom' : s.mode;
    if (d.url === undefined) d.url = s.url || '';
    const where = s.mode === 'default' ? s.default.replace(/^https:\/\//, '') : s.mode === 'custom' ? (s.url || '').replace(/^https?:\/\//, '') : null;
    const rows = [info('Relay', where, RELAY_SAYS[s.mode] || s.mode, s.mode === 'invalid' ? 'warn' : ''),
      info('Phones Registered', null, String(s.phones))];
    if (s.direct) rows.push(info('Sends Directly', s.direct_missing ? 'Needs ' + s.direct_missing + ' (mantel[apns-direct]) to reach Apple' : 'This Mantel has its own APNs key', s.direct_missing ? 'Not Working' : 'On', s.direct_missing ? 'warn' : ''));
    c.appendChild(group({ footer: s.direct ? 'With its own APNs key, Mantel sends to Apple itself and the relay is not used.'
      : 'The relay holds the app publisher’s APNs key and passes on notifications sealed to each phone; it can’t read them.' }, rows));
    if (!s.can_edit) { c.appendChild(group({ footer: 'Only an Owner can change the relay.' }, [])); return; }
    const edit = [K().select({ label: 'Send Through', options: RELAY_MODES, value: d.mode, fk: 'mx:pushrelay:mode', onChange: (v) => { d.mode = v; redraw(); } })];
    if (d.mode === 'custom') edit.push(K().text({ label: 'Address', value: d.url, placeholder: 'https://push.example.com', maxlength: 256, inputmode: 'url',
                                                  fk: 'mx:pushrelay:url', onCommit: (v) => { d.url = v.trim(); } }));
    edit.push(button('Save', async () => {
      const changed = d.mode !== s.mode || (d.mode === 'custom' && d.url !== (s.url || ''));
      if (changed && s.phones && !(await ask({ title: 'Change the relay?', message: 'The phones registered now are dropped, and their relay forgets them. ' +
        (d.mode === 'off' ? 'The apps get no notifications until you turn the relay on again.' : 'Each app registers again with the new relay when it next opens.'), ok: 'Change', destructive: true }))) return;
      const body = d.mode === 'custom' ? { mode: 'custom', url: d.url } : { mode: d.mode };
      if (await act('pushrelay', () => api('PUT', '/api/app/push-relay', body), 'Saved.', 'pushrelay')) clearDraft('pushrelay');
    }, { fk: 'mx:pushrelay:save' }));
    c.appendChild(group({ footer: ['Your own relay is the Worker in packaging/push-relay, deployed with your own APNs key, for an app built under your own Apple account.',
      s.needs_fresh ? 'From outside the home network you will be asked to confirm it is you first.' : null].filter(Boolean).join(' ') }, edit));
  } };
}
// HK'S SETTINGS FROM HOME ASSISTANT (settings_store.import_settings): the one-time import, as the App's People page
// has it. Its record for Owners and Admins (GET /api/settings/import); running it is an Owner's (POST, CSRF).
export function drawImport(c, haSet) {
  const got = load('settings-import', () => api('GET', '/api/settings/import'));
  if (!got) { pending(c, 'Reading whether HK’s settings were imported…'); return; }
  if (got.err) { failed(c, got.err); return; }
  const rec = got.data.import, owner = me.user.role === 'owner';
  const copied = (r) => r.written.length + (r.written.length === 1 ? ' item' : ' items') + ' copied' +
    (r.skipped.length ? ', ' + r.skipped.length + ' already in Mantel kept' : '');
  const rows = [info('HK’s Settings', rec ? 'From ' + rec.source + ' · ' + copied(rec) : null,
                     rec ? 'Imported ' + fmt(rec.created) : 'Not Imported')];
  if (!rec && owner) {
    rows.push(button('Import HK’s Settings from Home Assistant', async () => {
      if (!(await ask({ title: 'Import HK’s settings?', message: 'Mantel copies HK Frontend’s settings from Home Assistant once. ' +
                        'Nothing is written to Home Assistant.', ok: 'Import' }))) return;
      const out = await act('connections', () => api('POST', '/api/settings/import'), null, 'settings-import');
      if (!out || out === true) return;
      ui.flash = { key: 'connections', text: out.imported ? 'Imported HK’s settings: ' + copied(out) + '.'
        : 'Already imported ' + fmt(out.already && out.already.created) + '; nothing changed.' };
      reloadPanel();
      redraw();
    }, { disabled: !haSet, fk: 'mx:settings-import' }));
  }
  const what = 'your looks, rooms, screens, tablets, pop-ups, custom pages, chips and accessories, and the settings of HK’s features';
  const footer = rec
    ? 'Imported once. Running it again changes nothing; a change made in HK Settings inside Home Assistant doesn’t reach Mantel.'
    : 'Copies HK Frontend’s settings from Home Assistant once: ' + what + '. Nothing is written to Home Assistant. ' +
      'Running it again changes nothing, and anything already changed in Mantel is left alone. ' +
      (!owner ? 'Only an Owner can import them. ' : !haSet ? 'Connect Home Assistant first. ' : '') +
      'No HK Frontend in Home Assistant? Nothing to import: Mantel’s generated Home screen builds itself from your rooms and devices.';
  c.appendChild(group({ header: 'Import from HK Frontend', footer }, rows));
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
  const draw = (c) => {
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
        ui.flash = { key: 'conn-' + kind, text: x.label + ' connected' + (as ? ' as ' + as : '') + '.' };
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
  };
  // everything a connection needs is on its page: Home Assistant's has what Home Assistant has of Mantel, Music
  // Assistant's the sign-in of HK's Browse Music page
  return { title: x ? x.label : 'Connection', back, body(c) {
    draw(c);
    if (!got || got.err || !['owner', 'admin'].includes(me.user.role)) return;
    if (kind === 'ha') { drawHaAccess(c); drawInHa(c, x); }
    if (kind === 'ma' && x.state === 'set') drawMaPage(c, got.data.can_edit);
  } };
}
// THE BROWSE MUSIC PAGE'S SIGN-IN (ma_page.py), on Music Assistant's page: an ordinary MA user's token, separate
// from Mantel's own
function drawMaPage(c, can) {
  const got = load('ma-page', () => api('GET', '/api/connections/ma/page'));
  if (!got) { pending(c); return; }
  if (got.err) { failed(c, got.err); return; }
  result(c, 'ma-page');
  const page = got.data.page;
  c.appendChild(group({ header: 'Browse Music Page', footer: 'HK’s Browse Music page shows Music Assistant’s own web app. With a token here, Mantel signs that page in to Music Assistant as an ordinary MA user (never an administrator), so nobody has to sign in to MA on each screen. The token stays sealed in Mantel; the page never sees it.' },
    [page.set && page.saved ? info('Signs In As', 'Since ' + fmt(page.saved.since) + (page.saved.expires ? '; expires ' + fmt(page.saved.expires) : ''), (page.saved.user && page.saved.user.name) || 'An MA User')
      : info('Signs In As', page.unreadable ? 'The saved token could not be opened (was the at-rest key changed?).' : 'Not set: the page shows Music Assistant’s own sign-in.', 'Nobody')]));
  if (!can) return;
  const d = draft('ma-page');
  if (page.set && !d.open) {
    c.appendChild(group({}, [button('Replace…', () => { d.open = true; redraw(); }, { fk: 'mx:ma-page-replace' }),
      button('Remove…', async () => {
        if (!(await ask({ title: 'Remove the page’s sign-in?', message: 'The Browse Music page goes back to MA’s own sign-in.', ok: 'Remove', destructive: true }))) return;
        act('ma-page', () => api('DELETE', '/api/connections/ma/page'), 'Removed.', 'ma-page');
      }, { destructive: true, fk: 'mx:ma-page-remove' })]));
    return;
  }
  const save = (body) => () => act('ma-page', async () => { const r = await api('POST', '/api/connections/ma/page', body()); clearDraft('ma-page'); return r; }, 'Saved.', 'ma-page');
  c.appendChild(group({ header: 'A Long-Lived Token of an Ordinary MA User' }, [field('ma-page', 'token', 'Token', { type: 'password', maxlength: 4096 }),
    button('Save Token', save(() => ({ token: (d.token || '').trim() })), { fk: 'mx:ma-page-save' })]));
  c.appendChild(group({ header: 'Or Sign In Once as That MA User' }, [field('ma-page', 'username', 'User Name', { maxlength: 200 }),
    field('ma-page', 'password', 'Password', { type: 'password', maxlength: 1024 }),
    button('Sign In and Save', save(() => ({ username: (d.username || '').trim(), password: d.password || '' })), { fk: 'mx:ma-page-login' })]));
  if (page.set) c.appendChild(group({}, [button('Cancel', () => { clearDraft('ma-page'); redraw(); }, { fk: 'mx:ma-page-cancel' })]));
}
