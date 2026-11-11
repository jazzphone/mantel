// settings/roles.js -- Mantel Settings, Roles & Grants: what each role may do, and each person's rooms.
// @ts-check
import { mantelUrl } from '../base.js';
import { act, api, ask, fmt, K, load, me, panel, redraw, roleLabel, ROUTE, ui } from './core.js';
import { button, choose, clearDraft, draft, failed, field, group, info, nav, pending, result, ticks } from './kit.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// ============================================================================================ Roles & grants
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
  const order = me.actions.concat(['*']);
  const what = g.actions.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(', ');
  const on = g.resource_kind === 'all' ? 'everything' : g.resource_kind === 'feature' ? 'the ' + g.resource + ' feature' : g.resource_kind + ' ' + g.resource;
  const dom = g.domains.length ? ' (only ' + g.domains.join(', ') + ')' : '';
  return `${g.effect === 'deny' ? 'Deny' : 'Allow'} ${what} on ${on}${dom}${describeSchedule(g.schedule)}`;
}
const SWITCHES = { tunnel_sensitive: 'Sensitive Actions from Outside', tunnel_cameras: 'Cameras from Outside', tunnel_locations: 'Location History from Outside' };
export function pRoles(sub) {
  const base = '#/' + ROUTE + '/roles';
  if (sub[0] === 'role' && sub[1]) return pRole(sub[1]);
  if (sub[0] === 'add-grant') return pAddGrant();
  if (sub[0] === 'rooms') return pRooms();
  return { title: 'Roles & Grants', top: true, scope: 'What each role may do by default, and the grants that add to or take away from it. Owners always keep every permission.', body(c) {
    result(c, 'roles');
    const rr = load('roles', () => api('GET', '/api/rbac/roles'));
    if (!rr) pending(c); else if (rr.err) failed(c, rr.err);
    else c.appendChild(group({ header: 'Roles' }, Object.values(rr.data.roles).map((r) => nav(roleLabel(r.name), 'roles/role/' + encodeURIComponent(r.name), {
      sub: r.grants.length + ' grant' + (r.grants.length === 1 ? '' : 's') + (r.overridden ? ' · changed' : '') }))));
    const gg = load('grants', () => Promise.all([api('GET', '/api/rbac/grants'), api('GET', '/api/users'), api('GET', '/api/devices')]));
    if (!gg) { pending(c); return; }
    if (gg.err) { failed(c, gg.err); return; }
    const [{ grants }, { users }, { devices }] = gg.data;
    const uname = Object.fromEntries(users.map((u) => [u.id, u.name || u.username || u.id]));
    const dname = Object.fromEntries(devices.map((d) => [d.id, d.name]));
    const who = (g) => [...g.roles.map(roleLabel), ...g.users.map((u) => uname[u] || u), ...g.devices.map((d) => (dname[d] || d) + ' (tablet)')].join(', ');
    c.appendChild(group({ header: 'Grants', footer: grants.length ? null : 'No extra grants. Everyone has just their role’s defaults.' },
      grants.map((g) => info(who(g), describeGrant(g) + (g.note ? ' · ' + g.note : ''), g.effect === 'deny' ? 'Deny' : 'Allow', g.effect === 'deny' ? 'warn' : ''))
        .concat([K().nav({ label: 'Add a Grant…', href: base + '/add-grant', icon: 'mdi:plus', fk: 'mx:add-grant' })])));
    if (grants.length) c.appendChild(group({}, grants.map((g) => button('Remove: ' + describeGrant(g), async () => {
      if (!(await ask({ title: 'Remove this grant?', message: describeGrant(g), ok: 'Remove', destructive: true }))) return;
      act('roles', () => api('DELETE', '/api/rbac/grants/' + g.id), 'Grant removed.', 'grants', 'roles');
    }, { destructive: true, fk: 'mx:remove-grant:' + g.id }))));
    c.appendChild(group({ footer: 'A Child’s or Guest’s rooms, or a wall tablet’s room, are what “their areas” means in a grant.' },
      [K().nav({ label: 'Rooms for a Person or Tablet', href: base + '/rooms', icon: 'mdi:floor-plan', fk: 'mx:rooms' })]));
  } };
}
function pRole(name) {
  return { title: roleLabel(name), back: ['Roles & Grants', '#/' + ROUTE + '/roles'], body(c) {
    const rr = load('roles', () => api('GET', '/api/rbac/roles'));
    if (!rr) { pending(c); return; }
    if (rr.err) { failed(c, rr.err); return; }
    const r = rr.data.roles[name];
    if (!r) { c.appendChild(group({ footer: 'There is no such role.' }, [])); return; }
    c.appendChild(group({ header: 'Its Own Grants', footer: r.overridden ? 'Changed from Mantel’s defaults.' : null },
      r.grants.length ? r.grants.map((g) => info(describeGrant(g))) : [info('No grants of its own')]));
    const sw = Object.entries(SWITCHES).filter(([k]) => k in r);
    if (sw.length) c.appendChild(group({ header: 'From Outside the Home' }, sw.map(([k, label]) => info(label, null, r[k] ? 'Yes' : 'No'))));
  } };
}
function pAddGrant() {
  const back = ['Roles & Grants', '#/' + ROUTE + '/roles'];
  return { title: 'Add a Grant', back, body(c) {
    result(c, 'grant');
    const gg = load('grants', () => Promise.all([api('GET', '/api/rbac/grants'), api('GET', '/api/users'), api('GET', '/api/devices')]));
    if (!gg) { pending(c); return; }
    if (gg.err) { failed(c, gg.err); return; }
    const [, { users }, { devices }] = gg.data;
    const d = draft('grant');
    const targets = { roles: me.roles.map((r) => [r, roleLabel(r)]), users: users.map((u) => [u.id, u.name || u.username || u.id]),
                      devices: devices.filter((x) => !x.revoked).map((x) => [x.id, x.name + (x.room ? ' (' + x.room + ')' : '')]) };
    if (!d.target_kind) d.target_kind = 'roles';
    const list = targets[d.target_kind];
    if (!list.some(([v]) => v === d.target)) d.target = list.length ? list[0][0] : '';
    c.appendChild(group({ header: 'Who' }, [
      choose('grant', 'target_kind', 'Applies To', [['roles', 'A Role'], ['users', 'A Person'], ['devices', 'A Wall Tablet']], 'roles', redraw),
      list.length ? K().select({ label: 'Which', options: list, value: d.target, fk: 'mx:grant:target', onChange: (v) => { d.target = v; } }) : info('Which', null, 'None')]));
    c.appendChild(group({ header: 'Effect' }, [K().seg({ label: 'Effect', options: [['allow', 'Allow'], ['deny', 'Deny']], value: d.effect || 'allow', fk: 'mx:grant:effect',
      onChange: (v) => { d.effect = v; redraw(); } })]));
    c.appendChild(group({ header: 'Actions' }, ticks('grant', 'actions', me.actions.concat(['*']).map((a) => [a, a === '*' ? 'Everything (*)' : a]), ['view'])));
    if (!d.kind) d.kind = 'area';
    const on = [choose('grant', 'kind', 'Kind', me.resource_kinds.map((k) => [k, k]), 'area', redraw)];
    if (d.kind === 'feature') on.push(choose('grant', 'feature', 'Which Feature', me.features.map((f) => [f, f]), 'cameras'));
    else if (d.kind !== 'all') on.push(field('grant', 'resource', 'Which One', { placeholder: 'light.kitchen, kitchen, 1st floor' }));
    on.push(field('grant', 'domains', 'Only These Domains', { placeholder: 'light, switch' }));
    c.appendChild(group({ header: 'On What', footer: 'Domains are optional, separated by commas.' }, on));
    c.appendChild(group({ header: 'When', footer: 'Optional. Times of day are the house’s; the start and end dates are this browser’s clock. The days are the ones the window starts on.' }, [
      field('grant', 'start', 'From', { type: 'time' }), field('grant', 'end', 'Until', { type: 'time' }),
      field('grant', 'not_before', 'Starting', { type: 'datetime-local' }), field('grant', 'not_after', 'Ending', { type: 'datetime-local' })]));
    c.appendChild(group({ header: 'Days' }, ticks('grant', 'days', DAYS.map((x, i) => [String(i), x]), DAYS.map((x, i) => String(i)))));
    c.appendChild(group({}, [field('grant', 'note', 'Note', { maxlength: 200 })]));
    c.appendChild(group({}, [button('Add Grant', async () => {
      const body = { effect: d.effect || 'allow', actions: d.actions.slice(), resource_kind: d.kind,
        resource: d.kind === 'feature' ? d.feature : d.kind === 'all' ? '' : (d.resource || '').trim(),
        domains: (d.domains || '').split(',').map((s) => s.trim()).filter(Boolean),
        [d.target_kind]: d.target ? [d.target] : [], note: (d.note || '').trim() };
      const sched = {};
      if (d.start || d.end) { sched.start = d.start || ''; sched.end = d.end || ''; }
      const days = (d.days || []).map(Number);
      if (days.length && days.length < 7) sched.days = days;
      if (d.not_before) sched.not_before = new Date(d.not_before).getTime() / 1000;
      if (d.not_after) sched.not_after = new Date(d.not_after).getTime() / 1000;
      if (Object.keys(sched).length) body.schedule = sched;
      if (!body.actions.length) { ui.flash = { key: 'grant', text: 'Pick at least one action.', err: true }; redraw(); return; }
      if (await act('grant', () => api('POST', '/api/rbac/grants', body), 'Grant added.', 'grants', 'roles')) {
        clearDraft('grant'); ui.flash = { key: 'roles', text: 'Grant added.' }; panel.go(back[1]);
      }
    }, { center: true, fk: 'mx:save-grant' })]));
  } };
}
function pRooms() {
  return { title: 'Rooms', back: ['Roles & Grants', '#/' + ROUTE + '/roles'], body(c) {
    result(c, 'rooms');
    const base = load('rooms-base', () => Promise.all([api('GET', '/api/users'), api('GET', '/api/devices'),
      fetch(mantelUrl('/api/areas'), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : []))]));
    if (!base) { pending(c); return; }
    if (base.err) { failed(c, base.err); return; }
    const [{ users }, { devices }, areas] = base.data;
    const d = draft('rooms');
    if (!d.kind) d.kind = 'user';
    const list = d.kind === 'user' ? users.map((u) => [u.id, `${u.name || u.username} (${roleLabel(u.role)})`])
      : devices.filter((x) => !x.revoked).map((x) => [x.id, x.name + (x.room ? ' (' + x.room + ')' : '')]);
    if (!list.some(([v]) => v === d.subject)) d.subject = list.length ? list[0][0] : '';
    c.appendChild(group({ header: 'Who' }, [
      choose('rooms', 'kind', 'Kind', [['user', 'A Person'], ['device', 'A Wall Tablet']], 'user', () => { delete d.areas; redraw(); }),
      list.length ? K().select({ label: 'Which', options: list, value: d.subject, fk: 'mx:rooms:subject', onChange: (v) => { d.subject = v; delete d.areas; redraw(); } }) :
        info('Which', null, 'Nobody')]));
    if (!d.subject) return;
    const key = 'scope:' + d.kind + ':' + d.subject;
    const cur = load(key, () => api('GET', `/api/rbac/scopes/${d.kind}/${encodeURIComponent(d.subject)}`));
    if (!cur) { pending(c); return; }
    if (cur.err) { failed(c, cur.err); return; }
    if (!Array.isArray(d.areas)) d.areas = cur.data.areas.slice();
    const known = new Set(areas.map((a) => a.id));
    const options = areas.map((a) => [a.id, a.name]).concat(cur.data.areas.filter((a) => !known.has(a)).map((a) => [a, a]));
    c.appendChild(group({ header: 'Their Rooms', footer: options.length ? null : 'Home Assistant has not told Mantel about any areas yet.' }, ticks('rooms', 'areas', options, d.areas)));
    c.appendChild(group({}, [button('Save Rooms', () => act('rooms', () => api('PUT', `/api/rbac/scopes/${d.kind}/${encodeURIComponent(d.subject)}`, { areas: d.areas.slice() }), 'Rooms saved.', key),
      { center: true, fk: 'mx:save-scopes' })]));
  } };
}
