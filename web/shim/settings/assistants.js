// settings/assistants.js -- Mantel Settings, Advanced → Assistants (MCP): an assistant (Claude Code, Claude Desktop, any MCP
// client) that reads the house and changes settings and screens for a person (mcp/, docs/phase12/MCP-SERVER.md).
// The house's switches (an Owner's), how to connect, personal keys (shown once), and every assistant with its Revoke.
// @ts-check
import { act, ago, api, ask, fmt, K, load, me, panel, redraw, ROUTE, shown } from './core.js';
import { button, clearDraft, copyButton, draft, failed, field, group, info, nav, pending, result, secretCell, ticks } from './kit.js';

const SCOPE_WORDS = {
  read: ['Read', 'The house, its settings, screens and Music'],
  settings: ['Change Settings', 'The house’s, screens’, tablets’, accessories’ and Music’s'],
  screens: ['Screens and Home Grid', 'Add, change and remove screens and their layouts'],
  audit: ['Audit Log', 'Read the audit log and settings history'],
  restore: ['Restore', 'Roll a settings document back to an earlier version'],
  commands: ['Control the House', 'Lights, media, scenes… as you may (signed-in assistants only)'],
};
const RATES = [[10, '10'], [30, '30'], [60, '60'], [120, '120'], [300, '300']];
const DAYS = [[7, '1 Week'], [30, '30 Days'], [90, '90 Days'], [180, '180 Days'], [365, '1 Year']];
const withValue = (list, v, label) => (list.some(([x]) => x === v) ? list : list.concat([[v, label(v)]]).sort((a, b) => a[0] - b[0]));
const state = () => load('assistants', () => api('GET', '/api/mcp'));
const putSetting = (key, value, okText) => act('assistants', () => api('PUT', '/api/mcp/settings', { [key]: value }), okText || 'Saved.', 'assistants');
const scopeText = (list) => list.map((s) => (SCOPE_WORDS[s] || [s])[0]).join(', ');

export function pAssistants(sub) {
  if (sub[0] === 'add') return pAddKey();
  return { title: 'Assistants (MCP)', top: true,
    scope:
    'An assistant (Claude Code, Claude Desktop or another MCP client) can read the house, change settings and build screens and Home Grid layouts for you. It acts as you: your role decides what it ' +
    'may do, every change is planned and shown first, and the Audit Log shows each one as yours, through the assistant. It is never given the Alarm PIN.', body(c) {
    result(c, 'assistants');
    const got = state();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data, s = d.settings, can = d.may_configure;
    const t = shown.assistant;
    if (t) {
      const cmd = 'claude mcp add --transport http mantel ' + t.endpoint + ' --header "Authorization: Bearer ' + t.token + '"';
      c.appendChild(
        group(
        { header: 'Key for ' + t.assistant.name,
        footer: 'This is the only time it is shown. Mantel keeps only a hash. In Claude Code, run the command below; for another client, give it the address and the key as a Bearer token.' },
        [secretCell(t.token, 'mcp-token'), copyButton(t.token, 'Copy Key'), secretCell(cmd, 'mcp-command'), copyButton(cmd, 'Copy Claude Code Command'),
         button('I Have Saved It', () => { delete shown.assistant; redraw(); }, { fk: 'mx:mcp-dismiss' })]));
    }
    // the house's switches
    const rows = [K().toggle({ label: 'Allow Assistants', on: s.mcp_enabled, disabled: !can, fk: 'mx:mcp-on', onChange: async (want) => {
      const sure = want ?
        await ask(
        { title: 'Allow assistants?',
        message: 'Owners and Admins can then connect an assistant, with a key made here or by signing in from the assistant. Each acts as its person and is in the Audit Log.', ok: 'Allow' })
        : await ask({ title: 'Turn assistants off?', message: 'Every assistant is refused at once. Their keys and sign-ins are kept, and work again when you turn this back on.', ok: 'Turn Off',
          destructive: true });
      if (!sure) { redraw(); return; }
      putSetting('mcp_enabled', want, want ? 'Assistants are allowed now.' : 'Assistants are off now.');
    } })];
    rows.push(K().toggle({ label: 'Signed-In Assistants from Away', sub: 'Personal keys always work on the home network only', on: s.mcp_away, disabled: !can, fk: 'mx:mcp-away',
      onChange: (want) => putSetting('mcp_away', want) }));
    rows.push(K().toggle({ label: 'Assistants May Control the House', sub: d.commands_on ? 'Only signed-in assistants you allowed it, never with a key' : 'Needs Allow Control of the House (General)',
      on: s.mcp_commands, disabled: !can, fk: 'mx:mcp-commands',
      onChange: async (want) => {
        if (want && !(await ask({ title: 'Let assistants control the house?', message:
          'An assistant you sign in can then be allowed to turn things on and off as you may. Every command is checked against your role and is in the Audit Log. The alarm is never reachable.',
          ok: 'Allow' }))) { redraw(); return; }
        putSetting('mcp_commands', want);
      } }));
    rows.push(K().select({ label: 'Changes per Minute', options: withValue(RATES, s.mcp_write_rate, String).map(([v, l]) => [String(v), l]), value: String(s.mcp_write_rate), disabled: !can,
                           fk: 'mx:mcp-rate', onChange: (v) => putSetting('mcp_write_rate', Number(v)) }));
    rows.push(K().select({ label: 'New Keys Last', options: withValue(DAYS, s.mcp_key_days, (x) => x + ' Days').map(([v, l]) => [String(v), l]), value: String(s.mcp_key_days), disabled: !can,
                           fk: 'mx:mcp-days', onChange: (v) => putSetting('mcp_key_days', Number(v)) }));
    c.appendChild(group({ header: 'Assistants', footer: can ? 'Off: /mcp refuses everyone. Changes per minute keeps a looping assistant from flooding the settings history; plans don’t count.' :
      'Only an Owner can change these.' }, rows));
    // how to connect
    c.appendChild(
      group(
      { header: 'Connect',
      footer:
      'Claude Code: add the address with the key below, or add just the address and sign in from Claude Code (/mcp) when it asks. Claude Desktop: add it to claude_desktop_config.json through ' +
      'mcp-remote with the key. Connect on the home network.' },
      [info('Address', null, d.endpoint), copyButton(d.endpoint, 'Copy Address'),
       s.mcp_enabled && me.door === 'lan' ? nav('New Personal Key…', 'assistants/add', { icon: 'mdi:plus' }) :
         info('New Personal Key', s.mcp_enabled ? 'On the home network only' : 'Allow assistants first')]));
    // the assistants
    const all = d.assistants || [];
    const live = all.filter((a) => a.state === 'live'), gone = all.filter((a) => a.state !== 'live');
    const row = (a) => info(a.name, [a.kind === 'key' ? 'Personal key' : 'Signed in', d.me !== a.user_id ? 'for ' + a.person : null, scopeText(a.scopes),
                                     a.away ? 'from away too' : null, 'last used ' + ago(a.last_used) + (a.last_ip ? ' from ' + a.last_ip : ''),
                                     a.state === 'live' ? 'until ' + fmt(a.expires) : null].filter(Boolean).join(' · '),
                            a.state === 'live' ? undefined : a.state === 'revoked' ? 'Revoked' : 'Ended', a.state === 'live' ? '' : 'warn');
    c.appendChild(group({ header: can ? 'Everyone’s Assistants' : 'Your Assistants' }, live.length ? live.map(row) : [info('No assistants connected')]));
    if (live.length) c.appendChild(group({}, live.map((a) => button('Revoke ' + a.name + '…', async () => {
      if (!(await ask({ title: 'Revoke ' + a.name + '?', message: 'It is cut off at once. To connect it again, make a new key or sign in from the assistant again.', ok: 'Revoke',
        destructive: true }))) return;
      act('assistants', () => api('DELETE', '/api/mcp/grants/' + encodeURIComponent(a.id)), 'Revoked.', 'assistants');
    }, { destructive: true, fk: 'mx:mcp-revoke:' + a.id }))));
    if (gone.length) c.appendChild(group({ header: 'Ended or Revoked', footer: 'They leave this list after 30 days; the Audit Log keeps them.' }, gone.map(row)));
  } };
}

function pAddKey() {
  const back = ['Assistants (MCP)', '#/' + ROUTE + '/assistants'];
  return { title: 'New Personal Key', back, body(c) {
    result(c, 'addkey');
    const got = state();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data;
    c.appendChild(group({ footer: 'The assistant’s name, as the Audit Log will show it: “Claude Code on the office Mac”.' },
      [field('mcpkey', 'name', 'Name', { placeholder: 'Claude Code', maxlength: 64 })]));
    c.appendChild(group({ header: 'What It May Do', footer: 'At most what your own role allows. A key never controls the house: sign in from the assistant for that.' },
      ticks('mcpkey', 'scopes', d.key_scopes.map((s) => [s, (SCOPE_WORDS[s] || [s])[0], (SCOPE_WORDS[s] || [])[1]]), d.default_scopes)));
    c.appendChild(group({ footer: 'It lasts ' + d.settings.mcp_key_days + ' days and works on the home network only. Making one asks you to confirm it is you.' }, [button('Make Key', async () => {
      const f = draft('mcpkey');
      const r = await act('addkey', () => api('POST', '/api/mcp/keys', { name: (f.name || '').trim(), scopes: f.scopes.slice() }), null, 'assistants');
      if (r) { shown.assistant = r; clearDraft('mcpkey'); panel.go(back[1]); }
    }, { center: true, fk: 'mx:mcp-make' })]));
  } };
}
