// settings/service.js -- Mantel Settings, Service Accounts: machine credentials for scripts and other machines.
// @ts-check
import { act, ago, api, ask, fmt, load, me, panel, redraw, ROUTE, shown } from './core.js';
import {
  button, clearDraft, copyButton, draft, failed, field, group, info, nav, pending, result, secretCell, ticks
} from './kit.js';
import { LINK_NAME } from './link.js';

// ============================================================================================ Service accounts
const MADE_BY = { app: 'Made by the Home Assistant App for Mantel Link', pairing: 'Made by a Mantel Link pairing code', owner: null };
const USED_BY = { mantel: 'In use by Mantel Link', hk_frontend: 'In use by HK Frontend' };
export function pService(sub) {
  if (sub[0] === 'add') return pAddService();
  return { title: 'Service Accounts', top: true,
    scope:
    'Machine credentials, for scripts and other machines that reach Mantel. Mantel Link and HK Frontend make or get theirs on Home Assistant’s page (Connections), and they are listed here too. No ' +
    'password, no session and no role: only the endpoints ticked. Managed on the home network only.', body(c) {
    result(c, 'service');
    const t = shown.service;
    if (t) {
      c.appendChild(group({ header: 'Credential for ' + t.account.name, footer: 'This is the only time it is shown. Paste it where it is needed. Mantel keeps only a hash.' },
        [secretCell(t.token, 'service-token'), copyButton(t.token), button('I Have Saved It', () => { delete shown.service; redraw(); }, { fk: 'mx:dismiss-token' })]));
    }
    const got = load('service', () => api('GET', '/api/service-accounts'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const all = got.data.accounts, live = all.filter((a) => !a.revoked), gone = all.filter((a) => a.revoked);
    const row = (a) => info(a.name, [USED_BY[a.used_by] || MADE_BY[a.made_by], a.scopes.join(', '), 'created ' + fmt(a.created),
                                     'last used ' + ago(a.last_used) + (a.last_ip ? ' from ' + a.last_ip : '')].filter(Boolean).join(' · '),
                            a.revoked ? 'Revoked' : undefined, a.revoked ? 'warn' : '');
    c.appendChild(group({ header: 'Service Accounts' }, (live.length ? live.map(row) : [info('No service accounts')])
      .concat([nav('New Service Account…', 'service/add', { icon: 'mdi:plus' })])));
    if (live.length) c.appendChild(group({}, live.map((a) => button('Revoke ' + a.name + '…', async () => {
      const what = a.used_by ? LINK_NAME[a.used_by] + ' is cut off at once. To link it again, use Home Assistant’s page (Connections).' : 'Whatever uses this credential is cut off at once.';
      if (!(await ask({ title: 'Revoke ' + a.name + '?', message: what, ok: 'Revoke', destructive: true }))) return;
      act('service', () => api('DELETE', '/api/service-accounts/' + encodeURIComponent(a.id)), 'Service account revoked.', 'service', 'link');
    }, { destructive: true, fk: 'mx:revoke-service:' + a.id }))));
    if (gone.length) c.appendChild(group({ header: 'Revoked', footer: 'They leave this list after 30 days; the Audit Log keeps them.' }, gone.map(row).concat([
      button('Clear List', () => act('service', () => api('DELETE', '/api/service-accounts/revoked'), 'Cleared.', 'service'), { fk: 'mx:service-clear' })])));
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
