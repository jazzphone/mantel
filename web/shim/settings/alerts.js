// settings/alerts.js -- Mantel Settings, Alerts (alerts/api.py; docs/phase14/SYSTEM-ALERTS.md "Mantel Settings → Alerts"):
// where Mantel sends what goes wrong. Channels (Discord, Telegram, Notifiarr, email, Apprise), each with its own events,
// minimum level and quiet hours, Send Test; who gets system alerts in the Mantel apps; the log of what was sent; and,
// under Advanced, the holds, the heartbeat URL and Apprise. Owners and Admins see it; only the Owner changes it.
//
// A channel's secret (a webhook URL, a bot token, an API key, a password, Apprise URLs) is typed here and sent once;
// the server never sends it back, only the last four characters (`hint`). A saved channel's boxes say so, and a box
// left blank keeps what is saved. The routes decide who may do what (a fresh sign-in away from home, which api() asks
// for through Confirm It Is You).
import { act, ago, api, ask, fmt, forget, hh, K, load, redraw, ROUTE, shown, ui } from './core.js';
import { button, choose, clearDraft, draft, failed, field, group, info, nav, pending, result } from './kit.js';

const HOME = '#/' + ROUTE + '/alerts';
const LEVELS = [['info', 'Info'], ['warning', 'Warning'], ['critical', 'Critical']];
const LEVEL = Object.fromEntries(LEVELS);
// each kind's name as a switch says it (the catalog's titles have blanks in them: "{name} tablet is offline")
const KIND_LABEL = {
  'ha.lost': 'Home Assistant Disconnected', 'ma.lost': 'Music Assistant Disconnected', 'protect.lost': 'UniFi Protect Disconnected',
  'protect.cert': 'Protect’s Certificate Changed', 'link.lost': 'Mantel Link Not Answering', 'token.expiring': 'Credential Expiring',
  'backup.ok': 'Backup Finished', 'backup.failed': 'Backup Failed', 'backup.stale': 'No Recent Backup',
  'backup.target': 'Backup Folder Not Usable', 'tablet.offline': 'Tablet Offline', 'tablet.charging': 'Tablet Not Charging',
  'tablet.restart': 'Tablet Didn’t Come Back', 'mantel.started': 'Mantel Started', 'mantel.crashed': 'Mantel Stopped Unexpectedly',
  'disk.low': 'Low Disk Space', 'push.failing': 'App Notifications Failing', 'channel.failing': 'Another Channel Failing',
  'update.mantel': 'Mantel Update', 'update.link': 'Mantel Link Update', 'update.hk_frontend': 'HK Frontend Update',
  'signin.failures': 'Failed Sign-Ins', 'config.changed': 'Setup Changed',
};
const kindLabel = (k) => KIND_LABEL[k.id] || String(k.title).replace(/\{[^}]*\}\s*/g, '').trim() || k.id;
const kindName = (page, kind) => ((page.senders || []).find((s) => s.kind === kind) || {}).name || kind;
const minutes = (s) => (s < 60 ? 'Right Away' : s / 60 === 1 ? '1 Minute' : s / 60 + ' Minutes');

export const readPage = () => load('alerts', () => api('GET', '/api/alerts'));
const put = (id, body) => api('PUT', '/api/alerts/channels/' + encodeURIComponent(id), body);

// a page of this section: its result, then the read (or why there is none), then what the page draws
function withPage(c, key, draw) {
  result(c, key);
  const got = readPage();
  if (!got) { pending(c); return; }
  if (got.err) { failed(c, got.err); return; }
  draw(got.data);
}
const readOnly = (page) => (!page.can_edit ? 'Only an Owner can change alerts.' : page.needs_fresh
  ? 'From outside the home network you will be asked to confirm it is you first.' : null);

// ---------------------------------------------------------------------------------------- a channel's state
// green: it sent and nothing failed since; red: its last try failed, or its secret can't be opened; gray: off, or never sent
function stateOf(ch) {
  if (ch.needs_secret) return 'bad';
  if (!ch.enabled) return 'off';
  if (ch.last_error_at && (!ch.last_ok || ch.last_error_at > ch.last_ok)) return 'bad';
  return ch.last_ok ? 'ok' : 'off';
}
const STATE_WORD = { ok: 'Working', bad: 'Not Working', off: 'Not Used Yet' };
function sayState(ch) {
  if (ch.needs_secret) return 'Enter its secret again: it couldn’t be opened after a restore.';
  if (stateOf(ch) === 'bad') return (ch.last_error || 'The last try failed.') + (ch.last_error_at ? ' (' + ago(ch.last_error_at) + ')' : '');
  const sent = ch.last_ok ? 'Last sent ' + ago(ch.last_ok) : 'Never sent';
  return ch.enabled ? sent : 'Off · ' + sent;
}
function channelRow(page, ch) {
  const st = stateOf(ch);
  const row = nav(ch.name, 'alerts/channel/' + encodeURIComponent(ch.id), { sub: sayState(ch), value: kindName(page, ch.kind) });
  row.classList.add('hasic');
  row.insertBefore(hh('span', { class: 'mxdot ' + st, role: 'img', 'aria-label': st === 'ok' ? 'Working' : st === 'bad' ? 'Not working' : 'Off or never sent' }), row.firstChild);
  return row;
}

// ============================================================================================ Alerts
export function pAlerts(sub) {
  if (sub[0] === 'add') return pNewChannel(sub[1] || '');
  if (sub[0] === 'channel' && sub[1]) return pChannel(decodeURIComponent(sub[1]));
  if (sub[0] === 'apps') return pApps();
  if (sub[0] === 'history') return pHistory();
  if (sub[0] === 'advanced') return pAdvanced();
  return { title: 'Alerts', top: true,
    scope: 'Discord, Telegram, Notifiarr and your mail provider can read an alert’s text. The Mantel apps’ alerts are sealed end to end.',
    body(c) {
      withPage(c, 'alerts', (page) => {
        const list = page.channels;
        const adds = page.senders.some((s) => s.available && !s.advanced);
        c.appendChild(group({ header: 'Channels', footer: list.length ? readOnly(page)
            : 'No channels yet. Add one to hear about Home Assistant disconnecting, a failed backup, an update and more. ' + (readOnly(page) || '') },
          list.map((ch) => channelRow(page, ch)).concat(page.can_edit && adds ? [nav('Add Channel', 'alerts/add', { icon: 'mdi:plus' })] : [])));
        c.appendChild(group({}, [
          nav('Mantel Apps', 'alerts/apps', { icon: 'mdi:cellphone', value: String(page.app.people.length), sub: 'Who gets system alerts on iPhone, iPad, Mac and browsers' }),
          nav('History', 'alerts/history', { icon: 'mdi:history', sub: 'The last 30 days' }),
          nav('Advanced', 'alerts/advanced', { icon: 'mdi:cog', sub: 'Holds, the heartbeat and Apprise' })]));
      });
    } };
}

// ---------------------------------------------------------------------------------------- what each type asks for
const PORTS = { starttls: '587', tls: '465', none: '25' };
const SECURITY = [['starttls', 'STARTTLS (Port 587)'], ['tls', 'TLS (Port 465)'], ['none', 'None']];
const KEEP = ' Leave a box blank to keep what is saved; it is never shown again.';
const sealed = (ch, fallback) => (ch && ch.has_secret && !ch.needs_secret ? (ch.hint ? '…' + ch.hint : 'Saved') : fallback);

// the rows for one type's fields in the draft `form`, and the footer under them; ch is the saved channel (null when new)
function setupRows(form, kind, ch) {
  const d = draft(form), cfg = (ch && ch.config) || {}, keep = ch ? KEEP : '';
  if (kind === 'discord') {
    return { rows: [field(form, 'url', 'Webhook URL', { type: 'password', maxlength: 512, placeholder: sealed(ch, 'https://discord.com/api/webhooks/…') })],
      footer: 'In Discord: the channel’s settings, Integrations, Webhooks, Copy Webhook URL. Anyone with the URL can post to that channel, so Mantel keeps it sealed.' + keep };
  }
  if (kind === 'telegram') {
    if (d.chat_id === undefined) { d.chat_id = cfg.chat_id === undefined ? '' : cfg.chat_id; d.chat_name = cfg.chat_name || ''; }
    const rows = [field(form, 'token', 'Bot Token', { type: 'password', maxlength: 200, placeholder: sealed(ch, '123456:ABC…') }),
      info('Chat', null, d.chat_name || (d.chat_id !== '' ? String(d.chat_id) : 'Not Chosen')),
      button('Find My Chat', () => findChats(form, ch), { fk: 'mx:' + form + ':chats' })];
    drawChats(rows, form);
    return { rows, footer: 'Make a bot with BotFather in Telegram and paste its token. Then open your bot in Telegram, send it /start, and press Find My Chat. For a group, add the bot to the group and send /start there.' + keep };
  }
  if (kind === 'notifiarr') {
    return { rows: [field(form, 'api_key', 'API Key', { type: 'password', maxlength: 200, placeholder: sealed(ch, 'Global API key') }),
      field(form, 'channel', 'Discord Channel ID', { value: cfg.channel === undefined ? '' : String(cfg.channel), inputmode: 'numeric', maxlength: 30, placeholder: '123456789012345678' })],
      footer: 'Use your Notifiarr account’s global API key, not an integration key. The channel ID is the number Discord shows when Developer Mode is on: right-click the channel, Copy Channel ID.' + keep };
  }
  if (kind === 'email') {
    if (d.security === undefined) d.security = cfg.security || 'starttls';
    const rows = [field(form, 'host', 'Server', { value: cfg.host || '', maxlength: 253, inputmode: 'url', placeholder: 'smtp.example.com' }),
      choose(form, 'security', 'Security', SECURITY, d.security, (v) => { if (!d.port || Object.values(PORTS).includes(String(d.port))) d.port = PORTS[v]; redraw(); }),
      field(form, 'port', 'Port', { value: cfg.port === undefined ? PORTS[d.security] : String(cfg.port), inputmode: 'numeric', maxlength: 5 }),
      field(form, 'user', 'User Name', { value: cfg.user || '', maxlength: 254, placeholder: 'you@example.com' }),
      field(form, 'password', 'Password', { type: 'password', maxlength: 1024, placeholder: sealed(ch, 'Required') }),
      field(form, 'from', 'From', { value: cfg.from || '', maxlength: 254, inputmode: 'email', placeholder: 'mantel@example.com' }),
      field(form, 'to', 'To', { value: Array.isArray(cfg.to) ? cfg.to.join(', ') : '', maxlength: 1000, inputmode: 'email', placeholder: 'you@example.com' })];
    return { rows, footer: 'Gmail and iCloud need an app password, not your usual one. Separate several addresses in To with commas. The server’s certificate is checked.' +
      (d.security === 'none' ? ' None sends the password and the alert unprotected: use it only for a mail server on your home network.' : '') + keep };
  }
  if (kind === 'apprise') {
    return { rows: [field(form, 'urls', 'Apprise URLs', { type: 'password', maxlength: 4000, placeholder: sealed(ch, 'ntfy://my-topic') })],
      footer: 'One or more Apprise URLs for ntfy, Pushover, Gotify, Slack, Matrix and about a hundred more, separated by spaces. A URL can send anywhere, which is why this is for Owners only.' + keep };
  }
  return { rows: [], footer: null };
}
// what the boxes say, as the route takes it: a secret left blank is left out, so the saved one is kept
export function setupBody(kind, d) {
  const t = (k) => String(d[k] === undefined || d[k] === null ? '' : d[k]).trim();
  const secret = {};
  let config = {};
  if (kind === 'discord') { if (t('url')) secret.url = t('url'); }
  else if (kind === 'telegram') { config = { chat_id: d.chat_id === undefined ? '' : d.chat_id, chat_name: d.chat_name || '' }; if (t('token')) secret.token = t('token'); }
  else if (kind === 'notifiarr') { config = { channel: t('channel') }; if (t('api_key')) secret.api_key = t('api_key'); }
  else if (kind === 'email') {
    config = { host: t('host'), port: /^\d+$/.test(t('port')) ? Number(t('port')) : t('port'), security: d.security || 'starttls', user: t('user'),
               from: t('from'), to: t('to').split(/[\s,;]+/).filter(Boolean) };
    if (d.password) secret.password = d.password;
  } else if (kind === 'apprise') { const urls = t('urls').split(/\s+/).filter(Boolean); if (urls.length) secret.urls = urls; }
  return Object.keys(secret).length ? { config, secret } : { config };
}

// FIND MY CHAT: the chats the bot sees, to pick one (POST /api/alerts/telegram/chats; nothing is saved)
const CHAT_TYPE = { private: 'Private Chat', group: 'Group', supergroup: 'Group', channel: 'Channel' };
async function findChats(form, ch) {
  const d = draft(form), token = (d.token || '').trim();
  if (!token && !(ch && ch.has_secret && !ch.needs_secret)) { shown['chats:' + form] = { text: 'Paste the bot token first.', err: true }; redraw(); return; }
  shown['chats:' + form] = { text: 'Asking Telegram…' }; redraw();
  try {
    const r = await api('POST', '/api/alerts/telegram/chats', token ? { token } : { channel: ch.id });
    shown['chats:' + form] = r.chats.length ? { chats: r.chats }
      : { text: 'Telegram sees no chats yet. Open your bot in Telegram, send it /start, then press Find My Chat again.', err: true };
  } catch (e) { shown['chats:' + form] = { text: e.message, err: true }; }
  redraw();
}
function drawChats(rows, form) {
  const out = shown['chats:' + form], d = draft(form);
  if (!out) return;
  if (out.text) { rows.push(hh('p', { class: 'mxflash' + (out.err ? ' err' : ''), role: out.err ? 'alert' : 'status', text: out.text })); return; }
  for (const x of out.chats) {
    rows.push(K().check({ label: x.name || String(x.id), sub: CHAT_TYPE[x.type] || x.type, on: String(d.chat_id) === String(x.id), fk: 'mx:' + form + ':chat:' + x.id,
      onClick: () => { d.chat_id = x.id; d.chat_name = x.name || String(x.id); redraw(); } }));
  }
}

// ---------------------------------------------------------------------------------------- Add Channel
function pNewChannel(fixed) {
  const back = fixed ? ['Advanced', HOME + '/advanced'] : ['Alerts', HOME];
  return { title: 'Add Channel', back, body(c) {
    withPage(c, 'alert:new', (page) => {
      if (!page.can_edit) { c.appendChild(group({ footer: 'Only an Owner can add channels.' }, [])); return; }
      const types = page.senders.filter((s) => s.available && (fixed ? s.kind === fixed : !s.advanced));
      if (!types.length) { c.appendChild(group({ footer: 'Mantel can’t send to anything of this kind here.' }, [])); return; }
      const form = 'alert-new', d = draft(form);
      if (!types.some((s) => s.kind === d.kind)) d.kind = types[0].kind;
      const kind = d.kind;
      const rows = types.length > 1 ? [choose(form, 'kind', 'Type', types.map((s) => [s.kind, s.name]), kind, (v) => { clearDraft(form); draft(form).kind = v; redraw(); })] : [];
      rows.push(field(form, 'name', 'Name', { maxlength: 64, placeholder: kindName(page, kind) }));
      c.appendChild(group({ footer: readOnly(page) }, rows));
      const setup = setupRows(form, kind, null);
      c.appendChild(group({ header: 'Setup', footer: setup.footer }, setup.rows));
      c.appendChild(group({ footer: 'The new channel starts with the usual events on and every level. You choose its events next.' }, [
        button('Add Channel', async () => {
          const out = await act('alert:new', () => api('POST', '/api/alerts/channels', { kind, name: (d.name || '').trim(), ...setupBody(kind, d) }), null, 'alerts');
          if (!out || !out.channel) return;
          clearDraft(form); delete shown['chats:' + form];
          ui.flash = { key: 'alert:' + out.channel.id, text: 'Channel added. Press Send Test to try it, then choose its events.' };
          location.hash = HOME + '/channel/' + encodeURIComponent(out.channel.id);
        }, { fk: 'mx:alert-new:save' })]));
    });
  } };
}

// ---------------------------------------------------------------------------------------- one channel
// a plain change (a switch, the level, the name): shown at once, put back if the server refuses it
async function change(ch, patch) {
  const was = {};
  for (const k of Object.keys(patch)) was[k] = ch[k];
  Object.assign(ch, patch);
  const out = await act('alert:' + ch.id, async () => { const r = await put(ch.id, patch); Object.assign(ch, r.channel); return r; });
  if (!out) { Object.assign(ch, was); redraw(); }
}
function pChannel(id) {
  const got = readPage();
  const known = got && got.data && got.data.channels.find((x) => x.id === id);
  return { title: known ? known.name : 'Channel', back: ['Alerts', HOME], body(c) {
    const key = 'alert:' + id;
    withPage(c, key, (page) => {
      const ch = page.channels.find((x) => x.id === id);
      if (!ch) { c.appendChild(group({ footer: 'That channel is no longer here.' }, [])); return; }
      const q = Object.assign({ on: false, from: '22:00', to: '07:00', critical: true }, ch.quiet);
      const st = stateOf(ch);
      c.appendChild(group({}, [info('Status', sayState(ch), STATE_WORD[st], st === 'bad' ? 'warn' : ''), info('Type', null, kindName(page, ch.kind))]));
      if (!page.can_edit) {
        c.appendChild(group({ footer: readOnly(page) }, [info('Minimum Level', null, LEVEL[ch.min_level] || ch.min_level),
          info('Events', null, ch.events.length + ' of ' + page.catalog.length),
          info('Quiet Hours', null, q.on ? q.from + ' to ' + q.to : 'Off')]));
        return;
      }
      c.appendChild(group({ footer: readOnly(page) }, [
        K().text({ label: 'Name', value: ch.name, maxlength: 64, fk: 'mx:alert:name',
          onCommit: (v) => { const name = v.trim(); if (name) change(ch, { name }); else { ui.flash = { key, text: 'Give the channel a name.', err: true }; redraw(); } } }),
        K().toggle({ label: 'Send Alerts', on: ch.enabled, fk: 'mx:alert:enabled', onChange: (on) => change(ch, { enabled: on }) })]));
      // ---- events, by group; the note under each is its level and whether a new channel starts with it
      for (const g of page.groups) {
        const kinds = page.catalog.filter((k) => k.group === g.id);
        if (!kinds.length) continue;
        c.appendChild(group({ header: 'Events: ' + g.name }, kinds.map((k) => K().toggle({ label: kindLabel(k), fk: 'mx:alert-event:' + k.id, on: ch.events.includes(k.id),
          sub: (LEVEL[k.level] || k.level) + ' · ' + (k.default ? 'On' : 'Off') + ' for a new channel',
          onChange: (on) => change(ch, { events: on ? ch.events.concat([k.id]) : ch.events.filter((e) => e !== k.id) }) }))));
      }
      c.appendChild(group({ header: 'Minimum Level', footer: 'Alerts below this level aren’t sent to this channel.' }, [
        K().select({ label: 'Send', options: LEVELS, value: ch.min_level, fk: 'mx:alert:level', onChange: (v) => change(ch, { min_level: v }) })]));
      const time = (name, label) => K().text({ label, type: 'time', value: q[name], maxlength: 5, fk: 'mx:alert:quiet-' + name,
        onCommit: (v) => { if (/^\d{2}:\d{2}$/.test(v)) change(ch, { quiet: { ...q, [name]: v } }); else redraw(); } });
      c.appendChild(group({ header: 'Quiet Hours', footer: 'In the house’s time zone. Info and Warning alerts wait until quiet hours end and arrive together; whatever cleared meanwhile is left out.' +
          (q.on ? ' Critical alerts, such as Home Assistant disconnecting, go through right away when the last switch is on.' : '') },
        [K().toggle({ label: 'Quiet Hours', on: q.on, fk: 'mx:alert:quiet', onChange: (on) => change(ch, { quiet: { ...q, on } }) })]
          .concat(q.on ? [time('from', 'From'), time('to', 'To'),
            K().toggle({ label: 'Critical Alerts Ignore Quiet Hours', on: q.critical, fk: 'mx:alert:quiet-critical', onChange: (on) => change(ch, { quiet: { ...q, critical: on } }) })] : [])));
      // ---- its setup: the fields of its type, the secret blank to keep
      const form = 'alert-' + ch.id;
      const setup = setupRows(form, ch.kind, ch);
      if (ch.needs_secret) setup.rows.unshift(info('Secret', 'It couldn’t be opened after a restore. Enter it again.', 'Needed', 'warn'));
      setup.rows.push(button('Save', async () => {
        const out = await act(key, async () => { const r = await put(ch.id, setupBody(ch.kind, draft(form))); Object.assign(ch, r.channel); return r; }, 'Saved.');
        if (out) { clearDraft(form); delete shown['chats:' + form]; redraw(); }
      }, { fk: 'mx:' + form + ':save' }));
      c.appendChild(group({ header: 'Setup', footer: setup.footer }, setup.rows));
      c.appendChild(group({ footer: 'Sends a real message with the saved settings. If it doesn’t arrive, Mantel shows what the service answered.' }, [
        button('Send Test', () => act(key, async () => {
          try { await api('POST', '/api/alerts/channels/' + encodeURIComponent(ch.id) + '/test', {}); } finally { forget('alerts'); }
        }, 'Test sent. Look for it in ' + kindName(page, ch.kind) + '.'), { fk: 'mx:alert:test' })]));
      c.appendChild(group({ footer: 'Mantel stops sending alerts there and forgets its saved secret. Nothing changes on the service itself.' }, [
        button('Delete Channel…', async () => {
          if (!(await ask({ title: 'Delete ' + ch.name + '?', message: 'Mantel stops sending alerts to this channel and forgets its saved secret.', ok: 'Delete', destructive: true }))) return;
          if (!(await act(key, () => api('DELETE', '/api/alerts/channels/' + encodeURIComponent(ch.id)), null, 'alerts'))) return;
          clearDraft(form);
          ui.flash = { key: 'alerts', text: ch.name + ' deleted.' };
          location.hash = HOME;
        }, { destructive: true, fk: 'mx:alert:delete' })]));
    });
  } };
}

// ---------------------------------------------------------------------------------------- Mantel Apps
function pApps() {
  return { title: 'Mantel Apps', back: ['Alerts', HOME], body(c) {
    withPage(c, 'alerts', (page) => {
      const people = page.app.people, n = page.app.devices;
      c.appendChild(group({ header: 'Who Gets System Alerts', footer: 'Owners and Admins who turn on System Alerts in Me get Mantel’s own alerts on their Mantel apps and browsers. They’re sealed end to end: only the app can read them.' },
        (people.length ? people.map((p) => info(p.name, null, p.role === 'owner' ? 'Owner' : 'Admin')) : [info('Nobody has System Alerts on')])
          .concat([info('Devices', null, String(n))])));
      c.appendChild(group({ footer: 'Each person turns System Alerts on or off for themselves. The Companion app’s alerts go through Home Assistant, so they can’t carry “Home Assistant disconnected”.' },
        [nav('Me', 'me', { icon: 'mdi:account-circle' })]));
    });
  } };
}

// ---------------------------------------------------------------------------------------- History
function pHistory() {
  return { title: 'History', back: ['Alerts', HOME], body(c) {
    withPage(c, 'alerts-log', (page) => {
      const d = draft('alert-history'), grp = d.group || '';
      c.appendChild(group({}, [K().select({ label: 'Show', options: [['', 'All Events']].concat(page.groups.map((g) => [g.id, g.name])), value: grp, fk: 'mx:alert-history:group',
        onChange: (v) => { d.group = v; redraw(); } })]));
      const log = load('alerts-log:' + grp, () => api('GET', '/api/alerts/log' + (grp ? '?group=' + encodeURIComponent(grp) : '')));
      if (!log) { pending(c); return; }
      if (log.err) { failed(c, log.err); return; }
      const names = Object.fromEntries(page.channels.map((ch) => [ch.id, ch.name]).concat([['app', 'Mantel Apps']]));
      const rows = log.data.log.map((x) => {
        const to = x.sent_to.length ? 'Sent to ' + x.sent_to.map((id) => names[id] || 'A deleted channel').join(', ') : 'Not sent';
        return info(x.title, fmt(x.at) + ' · ' + (x.up ? 'Raised' : 'Back') + ' · ' + to, LEVEL[x.level] || x.level, x.up && x.level !== 'info' ? 'warn' : '');
      });
      c.appendChild(group({ footer: 'Newest first, for the last 30 days. “Not sent” means no channel wanted it, it cleared while it was held, or it came during quiet hours.' },
        rows.length ? rows : [info('Nothing yet')]));
    });
  } };
}

// ---------------------------------------------------------------------------------------- Advanced
const HOLDS = [0, 60, 120, 300, 600, 900, 1800, 3600];
const BEATS = [60, 120, 300, 600, 900, 1800, 3600];
function pAdvanced() {
  return { title: 'Advanced', back: ['Alerts', HOME], body(c) {
    withPage(c, 'alerts-advanced', (page) => {
      const can = page.can_edit, now = {};
      for (const [g, v] of Object.entries(page.holds || {})) if (typeof v === 'number') now[g] = v;
      // ---- holds: how long a connection must stay down before anyone is told
      const rows = page.groups.filter((g) => (page.default_holds[g.id] || 0) > 0).map((g) => {
        const cur = typeof now[g.id] === 'number' ? now[g.id] : page.default_holds[g.id];
        if (!can) return info(g.name, null, minutes(cur));
        const opts = HOLDS.concat(HOLDS.includes(cur) ? [] : [cur]).sort((a, b) => a - b).map((s) => [String(s), minutes(s)]);
        return K().select({ label: g.name, sub: 'Usually ' + minutes(page.default_holds[g.id]), options: opts, value: String(cur), fk: 'mx:alert-hold:' + g.id,
          onChange: (v) => act('alerts-advanced', async () => { const r = await api('PUT', '/api/alerts/settings', { holds: { ...now, [g.id]: Number(v) } }); Object.assign(page, r); return r; }) });
      });
      c.appendChild(group({ header: 'Holds', footer: 'How long something must stay wrong before Mantel tells anyone. A blip that clears inside the hold is never sent. ' + (readOnly(page) || '') }, rows));
      drawHeartbeat(c, page);
      drawApprise(c, page);
    });
  } };
}
// THE HEARTBEAT: Mantel calls an address every few minutes, and a service outside the house notices when the calls stop
function drawHeartbeat(c, page) {
  const hb = page.heartbeat;
  if (!hb) return;
  const d = draft('alert-heartbeat'), can = page.can_edit;
  const last = hb.last_at ? (hb.last_ok ? 'Last call ' + ago(hb.last_at) : 'The last call failed: ' + (hb.last_error || 'no answer') + ' (' + ago(hb.last_at) + ')') : 'No call yet';
  const rows = [info('Heartbeat', hb.needs_url ? 'Enter the address again: it couldn’t be opened after a restore.' : hb.on ? 'Every ' + minutes(hb.every).toLowerCase() + '. ' + last : null,
    hb.needs_url ? 'Needed' : hb.on ? 'On' : 'Off', hb.needs_url || (hb.on && !hb.last_ok && hb.last_at) ? 'warn' : '')];
  if (can) {
    if (d.every === undefined) d.every = String(hb.every || 300);
    const opts = BEATS.concat(BEATS.includes(Number(d.every)) ? [] : [Number(d.every)]).sort((a, b) => a - b).map((s) => [String(s), 'Every ' + minutes(s)]);
    rows.push(field('alert-heartbeat', 'url', 'Address', { type: 'password', maxlength: 512, placeholder: hb.on && hb.hint ? '…' + hb.hint : 'https://hc-ping.com/…' }));
    rows.push(choose('alert-heartbeat', 'every', 'Call', opts, d.every));
    rows.push(button(hb.on ? 'Save' : 'Turn On', async () => {
      const url = (d.url || '').trim();
      if (!hb.on && !url) { ui.flash = { key: 'alerts-advanced', text: 'Paste the address first.', err: true }; redraw(); return; }
      const out = await act('alerts-advanced', async () => { const r = await api('PUT', '/api/alerts/settings', { heartbeat: { ...(url ? { url } : {}), every: Number(d.every) } }); Object.assign(page, r); return r; },
        'Heartbeat saved.');
      if (out) { clearDraft('alert-heartbeat'); redraw(); }
    }, { fk: 'mx:alert-heartbeat:save' }));
    if (hb.on || hb.needs_url) rows.push(button('Turn Off', async () => {
      if (!(await ask({ title: 'Turn off the heartbeat?', message: 'Mantel stops calling the address, and forgets it. Nothing will tell you if Mantel itself goes down.', ok: 'Turn Off', destructive: true }))) return;
      const out = await act('alerts-advanced', async () => { const r = await api('PUT', '/api/alerts/settings', { heartbeat: {} }); Object.assign(page, r); return r; }, 'Heartbeat off.');
      if (out) { clearDraft('alert-heartbeat'); redraw(); }
    }, { destructive: true, fk: 'mx:alert-heartbeat:off' }));
  }
  c.appendChild(group({ header: 'Heartbeat', footer: 'Mantel calls this address every few minutes. A service such as healthchecks.io, or an Uptime Kuma push monitor, alerts you when the calls stop: the only way to hear that Mantel itself is down. The address is kept sealed and never shown again.' + (can ? ' Leave it blank to keep the saved one.' : '') }, rows));
}
// APPRISE: only an Owner sets it up, and only where it is installed
function drawApprise(c, page) {
  const s = page.senders.find((x) => x.kind === 'apprise');
  if (!s || !s.available) return;
  const mine = page.channels.filter((ch) => ch.kind === 'apprise');
  c.appendChild(group({ header: 'Apprise', footer: 'One URL, about a hundred services: ntfy, Pushover, Gotify, Slack, Matrix and more. A URL can send anywhere, so only an Owner adds one.' },
    mine.map((ch) => channelRow(page, ch)).concat(page.can_edit ? [nav('Add Apprise Channel', 'alerts/add/apprise', { icon: 'mdi:plus' })] : [])));
}
