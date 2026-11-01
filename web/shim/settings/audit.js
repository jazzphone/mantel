// settings/audit.js -- Mantel Settings, Audit Log.
import { api, fmtFull, forget, K, load, nowS, redraw, roleLabel } from './core.js';
import { button, failed, group, info, pending, result } from './kit.js';
import { titleCase } from './devices.js';

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
export function pAudit() {
  return { title: 'Audit Log', top: true, scope: 'Every house command and every refused request, and every change to settings, people and tablets, newest first: who, at which tablet or through which assistant, what, and the result.', body(c) {
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
    // FROM AND TO: a choice that says what it is (Any Time, Now, the last day ...), and a date only when one is
    // asked for. An empty date field showed today's date greyed out in Safari, as if a filter were set.
    const dt = (k, label) => K().text({ label, type: 'datetime-local', value: f[k + '_raw'] || '', fk: 'mx:audit:' + k,
      onCommit: (v) => { f[k + '_raw'] = v; f[k] = v ? String(new Date(v).getTime() / 1000) : ''; st.stack = [null]; forget('audit'); redraw(); } });
    const range = (k, label, options) => {
      const mode = f[k + '_mode'] || '';
      const rows = [K().select({ label, options, value: mode, fk: 'mx:audit:' + k + '-mode', onChange: (v) => {
        f[k + '_mode'] = v;
        if (v !== 'custom') { f[k + '_raw'] = ''; f[k] = ''; }
        st.stack = [null]; forget('audit'); redraw();
      } })];
      if (mode === 'custom') rows.push(dt(k, k === 'since' ? 'Since' : 'Until'));
      return rows;
    };
    if (f.since_mode && f.since_mode !== 'custom') f.since = String(Math.floor(nowS() / 60) * 60 - Number(f.since_mode));
    c.appendChild(group({ header: 'Show' }, [
      users ? K().select({ label: 'Who', options: [['', 'Anyone']].concat(users.map((u) => [u.id, `${u.name || u.username} (${roleLabel(u.role)})`])), value: f.actor || '', fk: 'mx:audit:actor', onChange: set('actor') }) : null,
      devices ? K().select({ label: 'Tablet', options: [['', 'Any Tablet']].concat(devices.map((d) => [d.id, d.name + (d.revoked ? ' (revoked)' : '')])), value: f.device || '', fk: 'mx:audit:device', onChange: set('device') }) : null,
      K().select({ label: 'Decision', options: [['', 'Any'], ['allowed', 'Allowed'], ['denied', 'Denied'], ['step_up', 'Needed Confirmation (Older Entries)']], value: f.decision || '', fk: 'mx:audit:decision', onChange: set('decision') }),
      K().select({ label: 'Through', options: [['', 'Anyone'], ['mcp', 'An Assistant'], ['-', 'No Assistant']], value: f.via || '', fk: 'mx:audit:via', onChange: set('via') }),
      K().select({ label: 'Kind', options: [['', 'Any'], ['service', 'Service Calls'], ['ws', 'Home Assistant Writes'], ['http', 'HTTP'], ['ma', 'Music'], ['config', 'Settings and Accounts'], ['tablet', 'Wall Tablets'], ['system', 'System']], value: f.kind || '', fk: 'mx:audit:kind', onChange: set('kind') }),
      ...range('since', 'From', [['', 'Any Time'], ['3600', 'The Last Hour'], ['86400', 'The Last 24 Hours'], ['604800', 'The Last 7 Days'],
                                 ['2592000', 'The Last 30 Days'], ['custom', 'A Date and Time…']]),
      ...range('until', 'To', [['', 'Now'], ['custom', 'A Date and Time…']]),
      K().select({ label: 'Rows per Page', options: [['25', '25'], ['50', '50'], ['100', '100']], value: f.limit || '25', fk: 'mx:audit:limit', onChange: set('limit') })]));
    const q = new URLSearchParams();
    for (const k of ['actor', 'device', 'decision', 'kind', 'via', 'since', 'until', 'limit']) if (f[k]) q.set(k, f[k]);
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
          [fmtFull(r.timestamp), who(r), r.via ? 'through ' + String(r.via).replace(/^mcp(-preview)?:/, '') : null, r.device ? 'at ' + (dname[r.device] || r.device_role || String(r.device).slice(0, 6)) : null,
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
