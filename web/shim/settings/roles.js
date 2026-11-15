// settings/roles.js -- Mantel Settings, Roles & Permissions: the roles, a role's page (its Access), every grant, Add a Grant.
// The Access component and the grant's own pages are in access.js; a person's and a tablet's rooms are on their own pages.
// @ts-check
import { act, api, K, me, panel, redraw, roleLabel, ROUTE, ui } from './core.js';
import { button, choose, clearDraft, draft, failed, field, group, info, nav, pending, result, ticks } from './kit.js';
import { drawAccess, grantRow, grantsRead, pGrant, pRoomsIndex, pSubjectRooms, rolesRead, whoOf } from './access.js';
export { drawAccess };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// one line for each starting role: what it is for, said in the person's words
const SUMMARY = {
  owner: 'Everything, always', admin: 'Everything except Owners and credentials', adult: 'Controls the whole house; no settings but their own',
  child: 'Lights, media and climate in their rooms; no cameras, locks or alarm', guest: 'A chosen set of rooms; no cameras or history',
  wall_tablet: 'What its room’s dashboard shows', service: 'A machine credential, with no role of its own' };
const ACTION_LABEL = { view: 'View', control: 'Control', 'control.sensitive': 'Control Sensitive (Locks, Alarm)', history: 'History', configure: 'Change Settings', '*': 'Everything (*)' };
const KIND_LABEL = { all: 'Everything' };
const cap = (x) => KIND_LABEL[x] || x.charAt(0).toUpperCase() + x.slice(1);
const TARGET_KIND = { role: 'roles', user: 'users', device: 'devices' };
export function pRoles(sub) {
  const base = '#/' + ROUTE + '/roles';
  if (sub[0] === 'role' && sub[1] && sub[2] === 'rules') return pRules(decodeURIComponent(sub[1]));
  if (sub[0] === 'role' && sub[1]) return pRole(decodeURIComponent(sub[1]));
  if (sub[0] === 'grant' && sub[1]) return pGrant(decodeURIComponent(sub[1]));
  if (sub[0] === 'add-grant') return pAddGrant(sub[1] && sub[2] ? [sub[1], decodeURIComponent(sub[2])] : null);
  if (sub[0] === 'rooms' && sub[1] && sub[2]) return pSubjectRooms(sub[1], decodeURIComponent(sub[2]));
  if (sub[0] === 'rooms') return pRoomsIndex();
  return { title: 'Roles & Permissions', top: true, scope: 'What each role may do by default, and the grants that add to or take away from it. Owners always keep every permission.', body(c) {
    result(c, 'roles');
    const rr = rolesRead();
    if (!rr) pending(c); else if (rr.err) failed(c, rr.err);
    else c.appendChild(group({ header: 'Roles' }, Object.values(rr.data.roles).filter((r) => r.name !== 'service').map((r) => nav(roleLabel(r.name), 'roles/role/' + encodeURIComponent(r.name), {
      sub: SUMMARY[r.name] || null, value: r.overridden ? 'Changed' : undefined }))));
    const gg = grantsRead();
    if (!gg) { pending(c); return; }
    if (gg.err) { failed(c, gg.err); return; }
    const [{ grants }, { users }, { devices }] = gg.data;
    c.appendChild(group({ header: 'Grants', footer: grants.length ? null : 'No extra grants. Everyone has just their role’s defaults.' },
      grants.map((g) => grantRow(g, whoOf(g, users, devices))).concat([K().nav({ label: 'Add a Grant…', href: base + '/add-grant', icon: 'mdi:plus', fk: 'mx:add-grant' })])));
  } };
}
// a role's page is its Access: what it allows by default, its grants, what it may do from outside the home
function pRole(name) {
  return { title: roleLabel(name), top: true, tile: ['mdi:shield-lock', '#5856d6'], scope: SUMMARY[name] || null, back: ['Roles & Permissions', '#/' + ROUTE + '/roles'], body(c) {
    result(c, 'roles');
    drawAccess(c, { kind: 'role', id: name, role: name });
  } };
}
// every rule a role starts with, in words (Mantel's own, or its changed set)
function pRules(name) {
  return { title: 'Every Rule', back: [roleLabel(name), '#/' + ROUTE + '/roles/role/' + encodeURIComponent(name)], body(c) {
    const rr = rolesRead();
    if (!rr) { pending(c); return; }
    if (rr.err) { failed(c, rr.err); return; }
    const r = rr.data.roles[name];
    if (!r) { c.appendChild(group({ footer: 'There is no such role.' }, [])); return; }
    c.appendChild(group({ footer: r.overridden ? 'Changed from Mantel’s defaults.' : 'Mantel’s own rules for this role. Grants are added to them.' },
      r.grants.length ? r.grants.map((g) => info((g.effect === 'deny' ? 'Deny ' : 'Allow ') + g.actions.join(', ') + ' on ' +
        (g.resource_kind === 'all' ? 'everything' : g.resource === '@subject' ? 'their rooms'
        : g.resource_kind === 'feature' ? 'the ' + g.resource + ' feature' : g.resource_kind + ' ' + g.resource) + (g.domains.length ? ' (only ' + g.domains.join(', ') + ')' : ''), g.note || null))
        : [info('No rules of its own')]));
  } };
}
// ADD A GRANT, in four groups: Who; What; Allow or Deny; When (its rows only once a schedule is on). `preset` is
// [kind, id] from a person's, role's or tablet's Access: Who is filled in already.
function pAddGrant(preset) {
  const back = preset ? (preset[0] === 'user' ? ['Person', '#/' + ROUTE + '/people/' + encodeURIComponent(preset[1])]
    : preset[0] === 'role' ? [roleLabel(preset[1]), '#/' + ROUTE + '/roles/role/' + encodeURIComponent(preset[1])] : ['Wall Tablets', '#/house/tablets'])
    : ['Roles & Permissions', '#/' + ROUTE + '/roles'];
  return { title: 'Add a Grant', back, body(c) {
    result(c, 'grant');
    const gg = grantsRead();
    if (!gg) { pending(c); return; }
    if (gg.err) { failed(c, gg.err); return; }
    const [, { users }, { devices }] = gg.data;
    const d = draft('grant');
    const key = preset ? preset.join(':') : '';
    if (d.preset !== key) { d.preset = key; if (preset) { d.target_kind = TARGET_KIND[preset[0]]; d.target = preset[1]; } }
    const targets = { roles: me.roles.filter((r) => r !== 'service').map((r) => [r, roleLabel(r)]), users: users.map((u) => [u.id, u.name || u.username || u.id]),
                      devices: devices.filter((x) => !x.revoked).map((x) => [x.id, x.name + (x.room ? ' (' + x.room + ')' : '')]) };
    if (!d.target_kind) d.target_kind = 'roles';
    const list = targets[d.target_kind];
    if (!list.some(([v]) => v === d.target)) d.target = list.length ? list[0][0] : '';
    c.appendChild(group({ header: 'Who' }, [
      choose('grant', 'target_kind', 'Applies To', [['roles', 'A Role'], ['users', 'A Person'], ['devices', 'A Wall Tablet']], 'roles', redraw),
      list.length ? K().select({ label: 'Which', options: list, value: d.target, fk: 'mx:grant:target', onChange: (v) => { d.target = v; } }) : info('Which', null, 'None')]));
    if (!d.kind) d.kind = 'area';
    const on = [...ticks('grant', 'actions', me.actions.concat(['*']).map((a) => [a, ACTION_LABEL[a] || a]), ['view']),
      choose('grant', 'kind', 'On What', me.resource_kinds.map((k) => [k, cap(k)]), 'area', redraw)];
    if (d.kind === 'feature') on.push(choose('grant', 'feature', 'Which Feature', me.features.map((f) => [f, cap(f)]), 'cameras'));
    else if (d.kind !== 'all') on.push(field('grant', 'resource', 'Which One', { placeholder: 'light.kitchen, kitchen, 1st floor' }));
    on.push(field('grant', 'domains', 'Only These Domains', { placeholder: 'light, switch' }));
    on.push(field('grant', 'note', 'Note', { maxlength: 200 }));
    c.appendChild(group({ header: 'What', footer: 'Domains are optional, separated by commas.' }, on));
    c.appendChild(group({ header: 'Allow or Deny' }, [K().seg({ label: 'Effect', options: [['allow', 'Allow'], ['deny', 'Deny']], value: d.effect || 'allow', fk: 'mx:grant:effect',
      onChange: (v) => { d.effect = v; redraw(); } })]));
    const when = [K().toggle({ label: 'Only at Certain Times', on: !!d.scheduled, fk: 'mx:grant:scheduled', onChange: (v) => { d.scheduled = v; redraw(); } })];
    if (d.scheduled) {
      when.push(field('grant', 'start', 'From', { type: 'time' }), field('grant', 'end', 'Until', { type: 'time' }),
        field('grant', 'not_before', 'Starting', { type: 'datetime-local' }), field('grant', 'not_after', 'Ending', { type: 'datetime-local' }),
        ...ticks('grant', 'days', DAYS.map((x, i) => [String(i), x]), DAYS.map((x, i) => String(i))));
    }
    c.appendChild(group({ header: 'When', footer: d.scheduled ? 'Times of day are the house’s; the start and end dates are this browser’s clock. The days are the ones the window starts on.' :
      'Without a schedule the grant always applies.' }, when));
    c.appendChild(group({}, [button('Add Grant', async () => {
      const body = { effect: d.effect || 'allow', actions: (d.actions || ['view']).slice(), resource_kind: d.kind,
        resource: d.kind === 'feature' ? d.feature : d.kind === 'all' ? '' : (d.resource || '').trim(),
        domains: (d.domains || '').split(',').map((s) => s.trim()).filter(Boolean),
        [d.target_kind]: d.target ? [d.target] : [], note: (d.note || '').trim() };
      const sched = {};
      if (d.scheduled) {
        if (d.start || d.end) { sched.start = d.start || ''; sched.end = d.end || ''; }
        const days = (d.days || []).map(Number);
        if (days.length && days.length < 7) sched.days = days;
        if (d.not_before) sched.not_before = new Date(d.not_before).getTime() / 1000;
        if (d.not_after) sched.not_after = new Date(d.not_after).getTime() / 1000;
      }
      if (Object.keys(sched).length) body.schedule = sched;
      if (!body.actions.length) { ui.flash = { key: 'grant', text: 'Pick at least one action.', err: true }; redraw(); return; }
      if (await act('grant', () => api('POST', '/api/rbac/grants', body), 'Grant added.', 'grants', 'roles')) {
        clearDraft('grant'); ui.flash = { key: preset ? '*' : 'roles', text: 'Grant added.' }; panel.go(back[1]);
      }
    }, { center: true, fk: 'mx:save-grant' })]));
  } };
}
