// settings/people.js -- Mantel Settings, People: accounts, Home Assistant users, phones, merging, someone's PIN.
// @ts-check
import { act, api, ask, K, load, me, panel, redraw, roleLabel, ROUTE, ui } from './core.js';
import {
  button, choose, clearDraft, draft, failed, field, group, houseTitle, info, nav, pending, result, screenPicker
} from './kit.js';
import { hasMantelPassword, pPersonPassword } from './me.js';

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
    c.appendChild(group({ header: 'Home Assistant Users', footer: d.error + ' Elsewhere, link one on the Mantel Server: mantel-server link --ha-user-id <id> --role adult --name "Their name".' }, []));
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
    'Each Home Assistant user who is a person here, linked to their Mantel account: they sign in with Home Assistant, and a change they make on HK Frontend’s dashboards is saved as them. A Home ' +
    'Assistant admin not linked can’t save, and Home Assistant shows a repair until they are.' +
      (owns ? ' “Own account”: one Mantel made for that Home Assistant user. Choose a person here to merge it into them.' : '') },
    (mine.length ? mine.map(pick) : [info('No Home Assistant users are linked yet')]).concat(
      [nav('Other Home Assistant Users', 'people/ha-others', { value: String(rest.length) })])));
  if (tablets.length) drawStandIns(c, tablets, d.devices || []);
}
// WALL TABLETS SIGNED IN AS PEOPLE: Home Assistant users linked to Wall Tablet accounts, from before tablets were
// enrolled. Each moves to the enrolled tablet of the same name (PUT /api/devices/{id}/ha-user), and its account goes.
function drawStandIns(c, tablets, devices) {
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
export function pPeople(sub) {
  if (sub[0] === 'add') return pAddPerson();
  if (sub[0] === 'ha-others') return { title: 'Other Home Assistant Users', back: ['People', '#/' + ROUTE + '/people'],
    scope:
    'Home Assistant users that are neither a person here nor a wall tablet: service users (such as an MQTT broker’s), and users made for tablets that now sign in to Mantel themselves. Link one to ' +
    'a person if it is someone’s; a wall tablet’s is set on its own page (All Screens, Wall Tablets).', body(c) { result(c, 'people'); drawHaUsers(c, true); } };
  if (sub[0] && sub[1] === 'password') return pPersonPassword(sub[0]);
  if (sub[0]) return pPerson(sub[0]);
  return { title: 'People', top: true, scope: 'Everyone who can sign in to Mantel, and their roles.', body(c) {
    result(c, 'people');
    const got = usersRead();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const users = got.data.users;
    c.appendChild(group({ header: 'People' }, users.map((u) => nav(u.name || u.username || u.id, 'people/' + encodeURIComponent(u.id), {
      sub: [roleLabel(u.role), u.kind === 'ha_linked' ? 'Home Assistant' : 'Mantel account', u.disabled ? 'Disabled' : null, u.id === me.user.id ? 'You' : null].filter(Boolean).join(' · '),
      icon: u.kind === 'ha_linked' ? 'mdi:home-assistant' : 'mdi:account' }))));
    c.appendChild(group({ footer: 'For someone who signs in with their own user name and password. They can add an authenticator app and passkeys themselves.' },
      [nav('Add a Mantel Account…', 'people/add', { icon: 'mdi:plus' })]));
    drawHaUsers(c, false);
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
function drawMerge(c, u, users) {
  const into = users.filter((x) => x.id !== u.id && x.kind !== 'ha_linked' && !x.ha_user_id);
  if (!into.length) return;
  const d = draft('merge:' + u.id);
  c.appendChild(
    group(
    { header: 'Merge',
    footer:
    'This account was made for a Home Assistant user. Merged into a person, their Home Assistant sign-in, Default Screen, own settings, phones and rooms go to that person (where they have none of ' +
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
}
function pPerson(id) {
  const back = ['People', '#/' + ROUTE + '/people'];
  const got = usersRead();
  const u = got && got.data && got.data.users.find((x) => x.id === id);
  return { title: u ? u.name || u.username || u.id : 'Person', back, body(c) {
    result(c, 'person');
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    if (!u) { c.appendChild(group({ footer: 'That person no longer exists.' }, [])); return; }
    const how = [u.has_password && 'Password', u.totp && 'Authenticator App', u.passkeys && u.passkeys + ' Passkey' + (u.passkeys > 1 ? 's' : ''), u.ha_user_id && 'Home Assistant'].filter(Boolean);
    if (u.kind === 'ha_linked' && me.user.role === 'owner') drawMerge(c, u, got.data.users);
    const locked = me.user.role !== 'owner' && u.role === 'owner';      // an Admin never manages Owners
    const self = u.id === me.user.id;
    const roles = assignable().includes(u.role) ? assignable() : [u.role, ...assignable()];
    c.appendChild(group({ header: 'Account', footer: locked ? 'Only an Owner can change an Owner.' : null }, [
      locked ? info('Role', null, roleLabel(u.role)) : K().select({ label: 'Role', options: roles.map((r) => [r, roleLabel(r)]), value: u.role, fk: 'mx:role',
        onChange: (role) => act('person', () => api('PATCH', '/api/users/' + encodeURIComponent(u.id), { role }), 'Role changed.', 'users') }),
      info('User Name', null, u.username || 'None'),
      info('Signs In With', null, how.length ? how.join(', ') : 'Nothing Yet'),
      ...(u.ha_user_id ? [info('Home Assistant User', null, u.ha_user_id)] : [])]));
    const ds = load('dscreens', () => api('GET', '/api/default-screens'));
    if (ds && ds.data) {
      const d = ds.data, cur = d.users[u.id] || '';
      const none = 'House Default (' + houseTitle(d) + ')';
      c.appendChild(
        group({ header: 'Default Screen', footer: 'Where Mantel opens for them, except at a wall tablet (the tablet’s own). Which screens they may open, and what they see, is their role’s.' },
        [locked ? info('Opens On', null, cur ? (d.screens.find((x) => x.path === cur) || { title: cur }).title : none)
          : screenPicker('person', 'Opens On', null, cur, d.screens, none,
                         (v) => api('PUT', '/api/users/' + encodeURIComponent(u.id) + '/default-screen', { screen: v }))]));
    }
    drawPhones(c, u, locked);
    if (locked) return;
    const rows = [];
    if (!self) rows.push(button(u.disabled ? 'Enable' : 'Disable…', async () => {
      if (!u.disabled && !(await ask({ title: 'Disable ' + (u.name || u.username) + '?', message: 'Their sessions end now and they cannot sign in.', ok: 'Disable', destructive: true }))) return;
      act('person', () => api('PATCH', '/api/users/' + encodeURIComponent(u.id), { disabled: !u.disabled }), u.disabled ? 'Enabled.' : 'Disabled.', 'users');
    }, { destructive: !u.disabled, fk: 'mx:toggle-user' }));
    if (!self && hasMantelPassword(u)) rows.push(nav('Set a New Password…', 'people/' + encodeURIComponent(u.id) + '/password'));
    rows.push(button('Clear Their PIN…', async () => {
      if (!(await ask({ title: 'Clear their PIN?', message: 'They will have to set a new one.', ok: 'Clear', destructive: true }))) return;
      const r = await act('person', () => api('DELETE', '/api/users/' + encodeURIComponent(u.id) + '/pin'));
      if (r) { ui.flash = { key: 'person', text: r.removed ? 'PIN cleared.' : 'They had no PIN.' }; redraw(); }
    }, { fk: 'mx:clear-pin' }));
    c.appendChild(group({ footer: self ? 'You can’t disable yourself. Change your own password in Me.'
      : 'A disabled person is signed out everywhere and can’t sign in. A new password signs them out everywhere too.' }, rows));
  } };
}
function pAddPerson() {
  return { title: 'Add a Mantel Account', back: ['People', '#/' + ROUTE + '/people'], body(c) {
    result(c, 'adduser');
    c.appendChild(group({ footer: 'Passwords are 12 characters or more.' }, [
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
