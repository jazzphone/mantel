// settings/access.js -- Mantel Settings, the Access component: what someone or something may do, drawn the same on a
// person's page, a role's page, a wall tablet's page and a service account's page (phase 32, "One shape").
//
//   drawAccess(c, { kind, id, role, name })
//     c     the page's content element (groups are appended to it)
//     kind  'user' | 'device' | 'role' | 'service'
//     id    the person's or tablet's id, the role's name, the service account's id
//     role  the role the person or tablet has ('adult', 'wall_tablet'); a role's page passes its own name
//     name  what to call them in a sentence (optional)
//   The groups, in order: what the role allows by default (rows by area, and every rule behind them); the grants that
//   add to or take away from it, each once (who · what · when), with Add a Grant… opening Who already filled; the
//   rooms "their areas" means (only where a rule uses them); and, for a role, what it may do from outside the home.
//   A wall tablet's page links here with drawAccess(c, { kind: 'device', id: device.id, role: device.role }).
//
// Also here: the grant's own pages (a grant, a subject's rooms) that the groups open, and describeGrant.
// @ts-check
import { mantelUrl } from '../base.js';
import { act, api, ask, fmt, K, load, me, panel, roleLabel, ROUTE } from './core.js';
import { button, failed, group, info, nav, pending, result } from './kit.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const grantsRead = () => load('grants', () => Promise.all([api('GET', '/api/rbac/grants'), api('GET', '/api/users'), api('GET', '/api/devices')]));
export const rolesRead = () => load('roles', () => api('GET', '/api/rbac/roles'));
const areasRead = () => load('areas', () => fetch(mantelUrl('/api/areas'), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : [])));
const scopeKey = (kind, id) => 'scope:' + kind + ':' + id;
const scopeRead = (kind, id) => load(scopeKey(kind, id), () => api('GET', `/api/rbac/scopes/${kind}/${encodeURIComponent(id)}`));
const SUBJECT = '@subject';       // a grant's "this one's own rooms" (rbac.py SUBJECT_AREAS)

// ---------------------------------------------------------------------------------------- words for a grant
export function describeSchedule(s) {
  if (!s) return '';
  const bits = [];
  if (s.start) bits.push(`${s.start} to ${s.end}`);
  if (s.days && s.days.length < 7) bits.push(s.days.map((d) => DAYS[d]).join(', '));
  if (s.not_before) bits.push('from ' + fmt(s.not_before));
  if (s.not_after) bits.push('until ' + fmt(s.not_after));
  return bits.length ? bits.join(' · ') : 'Always';
}
const whenOf = (g) => (g.schedule ? describeSchedule(g.schedule) : 'Always');
export function describeWhat(g) {
  const order = me.actions.concat(['*']);
  const what = g.actions.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(', ');
  const on = g.resource_kind === 'all' ? 'everything' : g.resource === SUBJECT ? 'their rooms'
    : g.resource_kind === 'feature' ? 'the ' + g.resource + ' feature' : g.resource_kind + ' ' + g.resource;
  const dom = g.domains.length ? ' (only ' + g.domains.join(', ') + ')' : '';
  return `${g.effect === 'deny' ? 'Deny' : 'Allow'} ${what} on ${on}${dom}`;
}
export const describeGrant = (g) => describeWhat(g) + (g.schedule ? ' · ' + whenOf(g) : '');
// who a grant is for: its roles, people and tablets, by name
export function whoOf(g, users, devices) {
  const uname = Object.fromEntries((users || []).map((u) => [u.id, u.name || u.username || u.id]));
  const dname = Object.fromEntries((devices || []).map((d) => [d.id, d.name]));
  return [...g.roles.map(roleLabel), ...g.users.map((u) => uname[u] || u), ...g.devices.map((d) => (dname[d] || d) + ' (tablet)')].join(', ');
}
// a grant's row: opens its page (where it is removed). `who` is shown when the list is of everyone's grants.
export function grantRow(g, who) {
  const bits = who ? [describeWhat(g), whenOf(g)] : [whenOf(g)];
  if (g.note) bits.push(g.note);
  return K().nav({ label: who || describeWhat(g), sub: bits.join(' · '), value: g.effect === 'deny' ? 'Deny' : 'Allow',
                   href: '#/' + ROUTE + '/roles/grant/' + g.id, fk: 'mx:grant:' + g.id });
}

// ---------------------------------------------------------------------------------------- what a role allows
// The areas of the house a role's rules answer for: each probes the rules the way the server would (deny wins, a
// grant on rooms counts only in their rooms), so the rows say it in words. Grants on one entity or a floor and
// scheduled ones are not counted here; they are listed as grants.
const FEATURE_DOMAINS = { cameras: ['camera'], music: ['media_player'], garage: [], locations: ['person', 'device_tracker'] };
const AREAS = [
  ['Lights & Switches', [{ a: 'control', d: 'light' }, { a: 'control', d: 'switch' }]],
  ['Locks & Garage', [{ a: 'control.sensitive', d: 'lock' }, { a: 'control.sensitive', f: 'garage' }]],
  ['Alarm', [{ a: 'control.sensitive', d: 'alarm_control_panel' }]],
  ['Cameras', [{ a: 'view', f: 'cameras', d: 'camera' }]],
  ['Music', [{ a: 'control', f: 'music', d: 'media_player' }]],
];
function covers(g, p) {
  if (!(g.actions.includes('*') || g.actions.includes(p.a))) return 0;
  const doms = g.domains || [];
  if (g.resource_kind === 'all') return doms.length && p.d && !doms.includes(p.d) ? 0 : 2;
  if (g.resource_kind === 'domain') return g.resource === p.d ? 2 : 0;
  if (g.resource_kind === 'feature') return g.resource === p.f || (p.d && (FEATURE_DOMAINS[g.resource] || []).includes(p.d)) ? 2 : 0;
  if (g.resource_kind === 'area') return g.resource === SUBJECT && p.d && (!doms.length || doms.includes(p.d)) ? 1 : 0;
  return 0;
}
// 0 no, 1 in their rooms, 2 yes
function probe(grants, p, ignoreDeny) {
  let best = 0;
  for (const g of grants) {
    if (g.schedule) continue;
    const v = covers(g, p);
    if (!v) continue;
    if (g.effect === 'deny') { if (!ignoreDeny) return 0; } else best = Math.max(best, v);
  }
  return best;
}
export function summarize(grants, owner) {
  const rows = AREAS.map(([label, probes]) => {
    const got = probes.map((p) => probe(grants, p, owner));
    const v = got.every((x) => x === 2) ? 2 : got.some((x) => x === 1) && !got.some((x) => x === 0) ? 1 : got.some((x) => x > 0) ? 3 : 0;
    return [label, ['No', 'In Their Rooms', 'Yes', 'Some'][v]];
  });
  const all = probe(grants, { a: 'configure' }, owner) === 2;
  const own = probe(grants, { a: 'configure', f: 'profile' }, owner) === 2;
  rows.push(['Settings', all ? 'Everything' : own ? 'Their Own' : 'No']);
  return rows;
}
const usesRooms = (grants) => grants.some((g) => g.resource === SUBJECT && g.effect === 'allow');
const OUTSIDE = { tunnel_sensitive: 'Sensitive Actions', tunnel_cameras: 'Cameras', tunnel_locations: 'Location History' };

// ---------------------------------------------------------------------------------------- the component
export function drawAccess(c, o) {
  const { kind, id } = o;
  if (kind === 'service') { drawServiceAccess(c, id); return; }
  const rr = rolesRead(), gg = grantsRead();
  if (!rr || !gg) { pending(c); return; }
  if (rr.err) { failed(c, rr.err); return; }
  if (gg.err) { failed(c, gg.err); return; }
  const role = o.role || (kind === 'role' ? id : 'adult');
  const r = rr.data.roles[role];
  if (!r) { c.appendChild(group({ footer: 'There is no such role.' }, [])); return; }
  const [{ grants }] = gg.data;
  const field = { user: 'users', device: 'devices', role: 'roles' }[kind];
  const mine = grants.filter((g) => (field === 'roles' ? g.roles : g[field]).includes(id));
  // the rules that answer for them: their role's, the grants made for their role, and their own
  const roleStored = kind === 'role' ? [] : grants.filter((g) => g.roles.includes(role));
  const rules = r.grants.concat(roleStored, mine);
  const who = o.name || 'They';
  const owner = role === 'owner';
  const label = roleLabel(role);
  const defaults = summarize(rules, owner).map(([area, v]) => info(area, null, v));
  if (kind !== 'role' && usesRooms(rules)) defaults.push(roomsRow(kind, id));
  defaults.push(nav('Every Rule', 'roles/role/' + encodeURIComponent(role) + '/rules', { value: String(r.grants.length) }));
  c.appendChild(group({ header: kind === 'role' ? 'By Default' : 'Access',
    footer: owner ? 'Owners always keep every permission.' : kind === 'role' ? 'Each area as this role’s rules answer it. Grants add to these or take away.'
      : who + ' starts from the ' + label + ' role. Grants add to it or take away.' }, defaults));
  const rows = mine.map((g) => grantRow(g, null));
  rows.push(K().nav({ label: 'Add a Grant…', href: '#/' + ROUTE + '/roles/add-grant/' + kind + '/' + encodeURIComponent(id), icon: 'mdi:plus', fk: 'mx:add-grant' }));
  c.appendChild(group({ header: 'Grants', footer: mine.length ? null : kind === 'role' ? 'No grants for this role. Everyone with it has just its defaults.'
    : 'None. ' + who + ' has just what the role allows.' }, rows));
  if (kind === 'role') {
    const sw = Object.entries(OUTSIDE).filter(([k]) => k in r);
    if (sw.length) c.appendChild(group({ header: 'From Outside the Home', footer: 'What this role may still do from outside the home network.' },
      sw.map(([k, t]) => info(t, null, r[k] ? 'Yes' : 'No'))));
  }
}
// the rooms "their areas" means: one row opening their rooms (the Child's or Guest's, a tablet's)
function roomsRow(kind, id) {
  const cur = scopeRead(kind, id), areas = areasRead();
  let value = '';
  if (cur && areas && !cur.err && !areas.err) {
    const names = Object.fromEntries((areas.data || []).map((a) => [a.id, a.name]));
    const list = cur.data.areas.map((a) => names[a] || a);
    value = list.length > 2 ? list.length + ' Rooms' : list.join(', ') || 'None';
  }
  return nav('Rooms', 'roles/rooms/' + kind + '/' + encodeURIComponent(id), { value: value || undefined });
}
// a service account has no role: the endpoints it may reach are its whole access
function drawServiceAccess(c, id) {
  const got = load('service', () => api('GET', '/api/service-accounts'));
  if (!got) { pending(c); return; }
  if (got.err) { failed(c, got.err); return; }
  const a = got.data.accounts.find((x) => x.id === id);
  if (!a) { c.appendChild(group({ footer: 'That service account no longer exists.' }, [])); return; }
  c.appendChild(group({ header: 'What It May Reach', footer: 'No role and no grants: only these endpoints.' },
    a.scopes.length ? a.scopes.map((s) => info(s, null, 'Yes')) : [info('Nothing', null, 'No')]));
}

// ---------------------------------------------------------------------------------------- the pages it opens
export function pGrant(id) {
  const back = ['Roles & Permissions', '#/' + ROUTE + '/roles'];
  return { title: 'Grant', back, body(c) {
    result(c, 'grant');
    const gg = grantsRead();
    if (!gg) { pending(c); return; }
    if (gg.err) { failed(c, gg.err); return; }
    const [{ grants }, { users }, { devices }] = gg.data;
    const g = grants.find((x) => String(x.id) === String(id));
    if (!g) { c.appendChild(group({ footer: 'That grant no longer exists.' }, [])); return; }
    c.appendChild(group({}, [info('For', null, whoOf(g, users, devices)), info('Effect', null, g.effect === 'deny' ? 'Deny' : 'Allow', g.effect === 'deny' ? 'warn' : ''),
      info('What', null, describeWhat(g).replace(/^(Allow|Deny) /, '')), info('When', null, whenOf(g)), ...(g.note ? [info('Note', null, g.note)] : [])]));
    c.appendChild(group({ footer: 'Removing a grant takes effect at once.' }, [button('Remove This Grant…', async () => {
      if (!(await ask({ title: 'Remove this grant?', message: describeGrant(g), ok: 'Remove', destructive: true }))) return;
      if (await act('grant', () => api('DELETE', '/api/rbac/grants/' + g.id), 'Grant removed.', 'grants', 'roles')) panel.go(back[1]);
    }, { destructive: true, fk: 'mx:remove-grant:' + g.id })]));
  } };
}
// one person's or tablet's rooms, ticked: each tap is saved
export function pSubjectRooms(kind, id) {
  const back = kind === 'user' ? ['Person', '#/' + ROUTE + '/people/' + encodeURIComponent(id)] : ['Wall Tablets', '#/house/tablets'];
  return { title: 'Rooms', back, body(c) {
    result(c, 'rooms');
    const areas = areasRead(), cur = scopeRead(kind, id);
    if (!areas || !cur) { pending(c); return; }
    if (areas.err) { failed(c, areas.err); return; }
    if (cur.err) { failed(c, cur.err); return; }
    const known = new Set((areas.data || []).map((a) => a.id));
    const opts = (areas.data || []).map((a) => [a.id, a.name]).concat(cur.data.areas.filter((a) => !known.has(a)).map((a) => [a, a]));
    const key = scopeKey(kind, id);
    const put = (list) => act('rooms', () => api('PUT', `/api/rbac/scopes/${kind}/${encodeURIComponent(id)}`, { areas: list }), null, key);
    c.appendChild(group({ footer: opts.length ? 'Where a rule says “their rooms”, it means these.' : 'Home Assistant has not told Mantel about any areas yet.' },
      opts.map(([v, t]) => K().check({ label: t, multi: true, on: cur.data.areas.includes(v), fk: 'mx:rooms:' + v,
        onClick: () => put(cur.data.areas.includes(v) ? cur.data.areas.filter((x) => x !== v) : cur.data.areas.concat([v])) }))));
  } };
}
// the old Rooms page: everyone with rooms, each opening their own
export function pRoomsIndex() {
  return { title: 'Rooms', back: ['Roles & Permissions', '#/' + ROUTE + '/roles'], scope: 'A Child’s or Guest’s rooms, or a wall tablet’s, are set on their own page, under Access. They are listed here too.',
  body(c) {
    const gg = grantsRead();
    if (!gg) { pending(c); return; }
    if (gg.err) { failed(c, gg.err); return; }
    const [, { users }, { devices }] = gg.data;
    const rows = users.map((u) => nav(u.name || u.username || u.id, 'roles/rooms/user/' + encodeURIComponent(u.id), { sub: roleLabel(u.role) }))
      .concat(devices.filter((x) => !x.revoked).map((x) => nav(x.name, 'roles/rooms/device/' + encodeURIComponent(x.id), { sub: 'Wall Tablet' + (x.room ? ' · ' + x.room : '') })));
    c.appendChild(group({}, rows.length ? rows : [info('Nobody')]));
  } };
}
