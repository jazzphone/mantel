// settings/people.js -- Mantel Settings, People: accounts, Home Assistant users, phones, merging, someone's PIN.
// @ts-check
import { act, api, ask, K, load, me, panel, redraw, roleLabel, ROUTE, ui } from './core.js';
import {
  button, choose, clearDraft, draft, failed, field, group, houseTitle, info, nav, pending, result, screenPicker
} from './kit.js';
import { hasMantelPassword, personLine, pPersonPassword, signInFacts } from './me.js';
import { drawAccess } from './access.js';

// ============================================================================================ People
export const usersRead = () => load('users', () => api('GET', '/api/users'));
// HOME ASSISTANT'S USERS, each once (people_ha.py; decision 29): a person (linked to an existing one here), a wall
// tablet (its own page in All Screens, Wall Tablets), or neither (Other Home Assistant Users). GET/PUT /api/people/ha
export const haPeopleRead = () => load('hapeople', () => api('GET', '/api/people/ha'));
// a Home Assistant user linked to a Wall Tablet ACCOUNT, as tablets were before they were enrolled: it belongs to
// its tablet now (people_ha.remove_stand_in)
export const standIn = (u) => !u.tablet && u.person && u.person.role === 'wall_tablet';
const squash = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// the enrolled tablet a stand-in is, by name: its account's, or the Home Assistant user's
function standInTablet(u, devices) {
  const names = [squash(u.person.name), squash(u.name)].filter(Boolean);
  return (devices || []).find((dv) => names.includes(squash(dv.name))) || null;
}
function drawHaUsers(c, others) {
  const got = haPeopleRead();
  if (!got) { if (!others) pending(c); return; }
  if (got.err) { failed(c, got.err); return; }
  const d = got.data, all = d.users || [];
  if (d.error && !all.length) {
    c.appendChild(group({ header: 'Home Assistant Users', footer: d.error + ' Link one with mantel-server link, as the docs say.' },
      [docsRow('People-and-Roles', 'a-home-assistant-user')].filter(Boolean)));
    return;
  }
  const tablets = all.filter(standIn);
  const mine = all.filter((u) => !u.tablet && !standIn(u) && (u.person || u.admin));
  const rest = all.filter((u) => !u.tablet && !u.person && !u.admin);
  const taken = new Set(all.filter((u) => u.person).map((u) => u.person.id));
  // a person is offered once: not one another Home Assistant user already is, never a Wall Tablet account
  const people = (d.people || []).filter((p) => p.kind !== 'ha_linked' && p.role !== 'wall_tablet');
  const pick = (u) => {
    const cur = u.person ? u.person.id : '';
    const opts = [['', 'Not Linked'], ...people.filter((p) => p.id === cur || !taken.has(p.id)).map((p) => [p.id, p.name + ' · ' + roleLabel(p.role)])];
    const own = u.person && u.person.kind === 'ha_linked';
    if (own) opts.push([u.person.id, (u.person.name || u.name) + ' · ' + roleLabel(u.person.role) + ' · Own Account']);
    return K().select({ label: u.name, sub: (u.admin ? 'Home Assistant admin' : 'Home Assistant user') + (own ? ' · own account' : ''),
      options: opts, value: cur, fk: 'mx:ha-user:' + u.id,
      onChange: (v) => act('people', () => api('PUT', '/api/people/ha', { ha_user: u.id, user_id: v || null }),
                           v ? u.name + ' is linked.' : u.name + ' is no longer linked.', 'hapeople', 'users', 'hasaves') });
  };
  if (others) {
    c.appendChild(group({ footer: rest.length ? null : 'There are none.' }, rest.map(pick)));
    return;
  }
  const owns = mine.some((u) => u.person && u.person.kind === 'ha_linked');
  c.appendChild(
    group(
    { header: 'Home Assistant Users',
    footer:
    'Each Home Assistant user who is a person here signs in with Home Assistant and is saved as them. An admin not linked can’t save, and Home Assistant shows a repair until they are.' +
      (owns ? ' “Own Account” was made for that user; choose a person to merge it into them.' : '') },
    (mine.length ? mine.map(pick) : [info('No Home Assistant users are linked yet')]).concat(
      [nav('Other Home Assistant Users', 'people/ha-others', { value: String(rest.length) })])));
  // Wall Tablets Signed In as People: from before tablets were enrolled; one row, its page below (people/stand-ins)
  if (tablets.length) c.appendChild(group({}, [nav('Wall Tablets Signed In as People', 'people/stand-ins', { value: String(tablets.length), icon: 'mdi:tablet' })]));
}
// a link to a page of the guide, where the host has one (the panel's docsLink: In the Docs, opened beside these settings)
function docsRow(page, anchor) {
  const url = window.hkShell && window.hkShell.docsUrl ? window.hkShell.docsUrl(page, anchor) : null;
  if (!url) return null;
  const row = K().nav({ label: 'In the Docs', icon: 'mdi:open-in-new', href: url, fk: 'mx:docs:' + page });
  const a = row && (row.tagName === 'A' ? row : row.querySelector && row.querySelector('a'));
  if (a) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
  return row;
}
// WALL TABLETS SIGNED IN AS PEOPLE: Home Assistant users linked to Wall Tablet accounts, from before tablets were
// enrolled. Each moves to the enrolled tablet of the same name (PUT /api/devices/{id}/ha-user), and its account goes.
export function drawStandIns(c, tablets, devices) {
  const owner = me.user.role === 'owner';
  const plan = tablets.map((u) => ({ u, dv: standInTablet(u, devices) }));
  const ready = plan.filter((x) => x.dv);
  const rows = plan.map(({ u, dv }) => info(u.name, 'Signed in as the Wall Tablet account “' + (u.person.name || u.name) + '”', dv ? '→ ' + dv.name : 'No Tablet Found', dv ? '' : 'warn'));
  if (owner && ready.length) rows.push(button(ready.length === plan.length ? 'Move Them to Their Tablets…' : 'Move the ' + ready.length + ' Found…', async () => {
    if (!(await ask({ title: 'Move them to their tablets?', message: 'Each Home Assistant user becomes its wall tablet’s, and the Wall Tablet accounts “' +
        ready.map((x) => x.u.person.name || x.u.name).join('”, “') + '” are removed. The tablets keep signing in to Mantel as they do now.', ok: 'Move Them' }))) return;
    await act('people', async () => {
      for (const { u, dv } of ready) await api('PUT', '/api/devices/' + encodeURIComponent(dv.id) + '/ha-user', { ha_user: u.id });
    }, 'Moved to their tablets.', 'hapeople', 'users', 'devices');
  }, { fk: 'mx:standins-move' }));
  c.appendChild(
    group(
    { header: 'Wall Tablets Signed In as People',
    footer:
    'These Home Assistant users are wall tablets, linked to Wall Tablet accounts from before the tablets were enrolled with Mantel. Each belongs on its tablet’s own page instead (All Screens, Wall ' +
    'Tablets, the tablet, Home Assistant User).' +
      (plan.length > ready.length ? ' One with no tablet of the same name is chosen on its tablet’s page.' : '') + (owner ? '' : ' Only an Owner can move them.') }, rows));
}
const assignable = () => me.roles.filter((r) => me.user.role === 'owner' || r !== 'owner');
const LISTED = ['owner', 'admin', 'adult', 'child', 'guest'];
const PLURAL = { owner: 'Owners', admin: 'Admins', adult: 'Adults', child: 'Children', guest: 'Guests' };
export function pPeople(sub) {
  const back = ['People', '#/' + ROUTE + '/people'];
  if (sub[0] === 'add') return pAddPerson();
  if (sub[0] === 'stand-ins') return { title: 'Wall Tablets Signed In as People', back, body(c) {
    result(c, 'people');
    const got = haPeopleRead();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const tablets = (got.data.users || []).filter(standIn);
    if (!tablets.length) { c.appendChild(group({ footer: 'None are left. Every wall tablet is on its own page.' }, [])); return; }
    drawStandIns(c, tablets, got.data.devices || []);
  } };
  if (sub[0] === 'ha-others') return { title: 'Other Home Assistant Users', back,
    scope:
    'Home Assistant users that are neither a person here nor a wall tablet: service users (such as an MQTT broker’s), and users made for tablets that now sign in to Mantel themselves. Link one to ' +
    'a person if it is someone’s; a wall tablet’s is set on its own page (All Screens, Wall Tablets).', body(c) { result(c, 'people'); drawHaUsers(c, true); } };
  if (sub[0] && sub[1] === 'password') return pPersonPassword(sub[0]);
  if (sub[0] && sub[1] === 'role') return pPersonRole(sub[0]);
  if (sub[0] && sub[1] === 'merge') return pMerge(sub[0]);
  if (sub[0]) return pPerson(sub[0]);
  return { title: 'People', top: true, scope: 'Everyone who can sign in to Mantel, by role.', body(c) {
    result(c, 'people');
    const got = usersRead();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const users = got.data.users;
    const row = (u) => nav(u.name || u.username || u.id, 'people/' + encodeURIComponent(u.id), {
      sub: [u.kind === 'ha_linked' ? 'Home Assistant' : 'Mantel account', u.disabled ? 'Disabled' : null, u.id === me.user.id ? 'You' : null].filter(Boolean).join(' · '),
      icon: u.kind === 'ha_linked' ? 'mdi:home-assistant' : 'mdi:account' });
    for (const r of LISTED) {
      const list = users.filter((u) => u.role === r);
      if (list.length) c.appendChild(group({ header: PLURAL[r] }, list.map(row)));
    }
    const other = users.filter((u) => !LISTED.includes(u.role));
    if (other.length) c.appendChild(group({ header: 'Other Accounts' }, other.map(row)));
    c.appendChild(group({}, [nav('Add Person…', 'people/add', { icon: 'mdi:plus' })]));
    // (In the Docs once: with Home Assistant's users when they can't be read, else at the end)
    const ha = haPeopleRead();
    const unread = !!(ha && ha.data && ha.data.error && !(ha.data.users || []).length);
    drawHaUsers(c, false);
    const docs = unread ? null : docsRow('People-and-Roles');
    if (docs) c.appendChild(group({}, [docs]));
  } };
}
// THEIR PHONES (phones.py; docs/phase9/MANTEL-LINK.md 9.7): Mantel's notifications on the Home Assistant Companion
// app, through Mantel Link: which of the phones Home Assistant has are theirs, and what goes there
const SEND_LABEL = [['important', 'Important Only'], ['all', 'Every Notification'], ['off', 'Nothing']];
function drawPhones(c, u, locked) {
  const got = load('phones', () => api('GET', '/api/phones'));
  if (!got || got.err) return;
  const d = got.data, mine = (d.people || {})[u.id] || { services: [], send: 'important' };
  const known = d.available || [];
  const names = Object.fromEntries(known.map((p) => [p.service, p.name]));
  const footer = !d.linked ? 'Mantel Link in Home Assistant brings Mantel’s notifications to phones with the Home Assistant Companion app. It isn’t linked yet.'
    : !known.length ? 'Home Assistant has no phones with the Companion app yet.'
    : 'Mantel’s notifications on their lock screen, through Home Assistant’s Companion app. Dismiss on the phone takes the banner down on every screen.';
  const put = (services, send) => act('person', () => api('PUT', '/api/users/' + encodeURIComponent(u.id) + '/phones', { services, send }),
                                      'Phones saved.', 'phones');
  const rows = [];
  if (locked) {
    rows.push(info('Phones', null, mine.services.map((s) => names[s] || s).join(', ') || 'None'));
  } else {
    for (const p of known) {
      rows.push(K().toggle({ label: p.name, on: mine.services.includes(p.service), fk: 'mx:phone:' + p.service,
        onChange: (on) => put(on ? mine.services.concat([p.service]) : mine.services.filter((s) => s !== p.service), mine.send) }));
    }
    for (const s of mine.services.filter((x) => !names[x])) rows.push(info(s, 'Home Assistant no longer has this phone', 'Gone', 'warn'));
    if (known.length || mine.services.length) {
      rows.push(K().select({ label: 'Send', options: SEND_LABEL, value: mine.send, fk: 'mx:phone-send',
                              onChange: (send) => put(mine.services, send) }));
    }
  }
  c.appendChild(group({ header: 'Phones', footer }, rows));
}

// MERGE (people_ha.py): an account made for a Home Assistant user, into the person it is
function pMerge(id) {
  const got = usersRead();
  const u = got && got.data && got.data.users.find((x) => x.id === id);
  return { title: 'Merge', back: [u ? u.name || u.username || 'Person' : 'Person', '#/' + ROUTE + '/people/' + encodeURIComponent(id)], body(c) {
    result(c, 'person');
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    if (!u) { c.appendChild(group({ footer: 'That person no longer exists.' }, [])); return; }
    const into = got.data.users.filter((x) => x.id !== u.id && x.kind !== 'ha_linked' && !x.ha_user_id);
    const d = draft('merge:' + u.id);
    c.appendChild(
      group(
      { footer:
      'This account was made for a Home Assistant user. Merged into a person, their Home Assistant sign-in, Default Screen, own settings, phones and rooms go to that person (where they have none ' +
        'of ' +
      'their own), and this account is removed.' }, [
      K().select({ label: 'Into', options: [['', 'Choose a Person'], ...into.map((x) => [x.id, (x.name || x.username) + ' · ' + roleLabel(x.role)])], value: d.into || '', fk: 'mx:merge:' + u.id,
        onChange: (v) => { d.into = v || null; redraw(); } }),
      button('Merge…', async () => {
        if (!d.into) return;
        const to = into.find((x) => x.id === d.into);
        if (!(await ask({ title: 'Merge into ' + (to.name || to.username) + '?', message: (u.name || 'This account') + ' is removed; its Home Assistant sign-in and what it had go to ' +
          (to.name || to.username) + '.', ok: 'Merge', destructive: true }))) return;
        const r = await act('person', () => api('POST', '/api/users/' + encodeURIComponent(u.id) + '/merge', { into: d.into }), null, 'users', 'hapeople');
        if (r) { ui.flash = { key: 'people', text: 'Merged into ' + (to.name || to.username) + '.' }; panel.go('#/' + ROUTE + '/people/' + encodeURIComponent(d.into)); }
      }, { destructive: true, disabled: !d.into, fk: 'mx:merge:go:' + u.id })]));
  } };
}
// ROLE: a choice page, the role checked
function pPersonRole(id) {
  const got = usersRead();
  const u = got && got.data && got.data.users.find((x) => x.id === id);
  return { title: 'Role', back: [u ? u.name || u.username || 'Person' : 'Person', '#/' + ROUTE + '/people/' + encodeURIComponent(id)], body(c) {
    result(c, 'person');
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    if (!u) { c.appendChild(group({ footer: 'That person no longer exists.' }, [])); return; }
    const locked = me.user.role !== 'owner' && u.role === 'owner';
    const roles = assignable().includes(u.role) ? assignable() : [u.role, ...assignable()];
    c.appendChild(group({ footer: locked ? 'Only an Owner can change an Owner.' : 'What each role may do is on Roles & Permissions. Changing it signs nothing out.' },
      roles.map((r) => K().check({ label: roleLabel(r), on: r === u.role, fk: 'mx:role:' + r, onClick: () => {
        if (locked || r === u.role) return;
        act('person', () => api('PATCH', '/api/users/' + encodeURIComponent(u.id), { role: r }), 'Role changed.', 'users');
      } }))));
  } };
}
// A PERSON'S PAGE: who they are, then the same shape as Me and a wall tablet's page: Role, Access (access.js),
// Sign-In, Devices, Opens On; Merge, Disable and the like last, in red
function pPerson(id) {
  const back = ['People', '#/' + ROUTE + '/people'];
  const got = usersRead();
  const u = got && got.data && got.data.users.find((x) => x.id === id);
  const title = u ? u.name || u.username || u.id : 'Person';
  return { title, top: !!u, tile: ['mdi:account', '#007aff'], scope: u ? personLine(u) + (u.disabled ? ' · Disabled' : '') : null, back, body(c) {
    result(c, 'person');
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    if (!u) { c.appendChild(group({ footer: 'That person no longer exists.' }, [])); return; }
    const locked = me.user.role !== 'owner' && u.role === 'owner';      // an Admin never manages Owners
    const self = u.id === me.user.id;
    c.appendChild(group({ footer: locked ? 'Only an Owner can change an Owner.' : null }, [
      locked ? info('Role', null, roleLabel(u.role)) : nav('Role', 'people/' + encodeURIComponent(u.id) + '/role', { value: roleLabel(u.role) })]));
    if (u.role !== 'service' && me.roles.includes(u.role)) drawAccess(c, { kind: 'user', id: u.id, role: u.role, name: u.name || u.username });
    // Sign-In: what they sign in with; a password is set here, a PIN cleared
    const rows = signInFacts(u);
    if (u.username) rows.push(info('User Name', null, u.username));
    if (u.ha_user_id) rows.push(info('Home Assistant User', null, u.ha_user_id));
    if (!locked) {
      if (!self && hasMantelPassword(u)) rows.push(nav('Set a New Password…', 'people/' + encodeURIComponent(u.id) + '/password'));
      rows.push(button('Clear Their PIN…', async () => {
        if (!(await ask({ title: 'Clear their PIN?', message: 'They will have to set a new one.', ok: 'Clear', destructive: true }))) return;
        const r = await act('person', () => api('DELETE', '/api/users/' + encodeURIComponent(u.id) + '/pin'));
        if (r) { ui.flash = { key: 'person', text: r.removed ? 'PIN cleared.' : 'They had no PIN.' }; redraw(); }
      }, { fk: 'mx:clear-pin' }));
    }
    c.appendChild(group({ header: 'Sign-In', footer: self ? 'Change your own password in Me.' : null }, rows));
    drawPhones(c, u, locked);
    const ds = load('dscreens', () => api('GET', '/api/default-screens'));
    if (ds && ds.data) {
      const d = ds.data, cur = d.users[u.id] || '';
      const none = 'House Default (' + houseTitle(d) + ')';
      c.appendChild(group({},
        [locked ? info('Opens On', null, cur ? (d.screens.find((x) => x.path === cur) || { title: cur }).title : none)
          : screenPicker('person', 'Opens On', 'A wall tablet opens its own.', cur, d.screens, none,
                         (v) => api('PUT', '/api/users/' + encodeURIComponent(u.id) + '/default-screen', { screen: v }))]));
    }
    if (locked) return;
    const bottom = [];
    if (u.kind === 'ha_linked' && me.user.role === 'owner' && got.data.users.some((x) => x.id !== u.id && x.kind !== 'ha_linked' && !x.ha_user_id)) {
      bottom.push(nav('Merge…', 'people/' + encodeURIComponent(u.id) + '/merge', { icon: 'mdi:call-merge' }));
    }
    if (!self) bottom.push(button(u.disabled ? 'Enable' : 'Disable…', async () => {
      if (!u.disabled && !(await ask({ title: 'Disable ' + (u.name || u.username) + '?', message: 'Their sessions end now and they cannot sign in.', ok: 'Disable', destructive: true }))) return;
      act('person', () => api('PATCH', '/api/users/' + encodeURIComponent(u.id), { disabled: !u.disabled }), u.disabled ? 'Enabled.' : 'Disabled.', 'users');
    }, { destructive: !u.disabled, center: true, fk: 'mx:toggle-user' }));
    if (bottom.length) c.appendChild(group({ footer: self ? 'You can’t disable yourself.' : 'A disabled person is signed out everywhere and can’t sign in.' }, bottom));
  } };
}
function pAddPerson() {
  return { title: 'Add Person', back: ['People', '#/' + ROUTE + '/people'], body(c) {
    result(c, 'adduser');
    c.appendChild(group({ footer: 'For someone who signs in with their own user name and password. Passwords are 12 characters or more; they can add an authenticator app and passkeys themselves.' }, [
      field('user', 'username', 'User Name', { maxlength: 64 }),
      field('user', 'name', 'Name', { maxlength: 64 }),
      choose('user', 'role', 'Role', assignable().filter((r) => r !== 'service').map((r) => [r, roleLabel(r)]), 'adult'),
      field('user', 'password', 'Password', { type: 'password', maxlength: 200, autocomplete: 'new-password' })]));
    c.appendChild(group({}, [button('Create Account', async () => {
      const d = draft('user');
      const body = { username: (d.username || '').trim(), name: (d.name || '').trim() || undefined, role: d.role, password: d.password || '' };
      const ok = await act('adduser', () => api('POST', '/api/users', body), 'Account created.', 'users');
      if (ok) { clearDraft('user'); ui.flash = { key: 'people', text: 'Account created.' }; panel.go('#/' + ROUTE + '/people'); }
    }, { center: true, fk: 'mx:create-user' })]));
  } };
}
