// settings/devices.js -- Mantel Settings, Devices: wall tablets and the devices signed in as them, enrolling this browser.
import { mantelUrl } from '../base.js';
import { act, ago, api, ask, cache, ERRORS, fmt, hh, K, load, me, redraw, roleLabel, ui } from './core.js';
import { button, choose, clearDraft, draft, failed, field, group, info, nav, pending, result, screenPicker } from './kit.js';
import { haPeopleRead, standIn } from './people.js';

// ============================================================================================ Devices
const devicesRead = () => load('devices', () => api('GET', '/api/devices'));
// HK's wall tablets and HA's areas (GET /api/devices/rooms): a device's room is one of them, never typed. A wall
// tablet device reports its touches and black screen only for the HK tablet in its own room (features.may_speak_for),
// so a room typed as "Livingroom" for HK's living_room cut three tablets off (the house, 2026-10-19).
const roomsRead = () => load('devrooms', () => api('GET', '/api/devices/rooms'));
export const titleCase = (id) => String(id).replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
function roomName(rooms, rid) {
  if (!rid) return '';
  const a = (rooms && rooms.areas || []).find((x) => x.id === rid);
  return a ? a.name : titleCase(rid);
}
const tabletList = (rooms) => Object.entries((rooms && rooms.tablets) || {}).filter(([, t]) => t && t.room)
  .sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
// a wall tablet device in a room no HK tablet has: its touches and black screen reach nothing
const lostTablet = (d, tablets) => !d.revoked && d.role === 'wall_tablet' && Object.keys(tablets || {}).length > 0 && !(d.hk_tablets || []).length;
// THE ROOM PICKER: one of HK's wall tablets (the device takes its room), else Not One of These and one of HA's
// areas. `self` is the device being moved (its own tablet isn't "in use"); onTablet(t) when a tablet is picked.
function roomChoice(form, rooms, self, onTablet, makes = false) {
  const d = draft(form);
  const tablets = tabletList(rooms);
  const rows = tablets.map(([tid, t]) => {
    const others = (t.served_by || []).filter((x) => x.id !== self).map((x) => '“' + x.name + '”');
    return K().check({ label: t.name, sub: [roomName(rooms, t.room), t.screen_title || (t.screen ? titleCase(t.screen.split('-').slice(1).join(' ')) + ' Screen' : null),
                                            others.length ? 'Already ' + others.join(', ') : null].filter(Boolean).join(' · '),
                       value: others.length ? 'In Use' : undefined, on: d.tablet === tid, fk: 'mx:' + form + ':tablet:' + tid,
                       onClick: () => { d.tablet = tid; d.other = false; if (onTablet) onTablet(t); redraw(); } });
  });
  rows.push(K().check({ label: makes ? 'A New Tablet' : 'Not One of These', sub: makes ? 'In a room with no HK wall tablet yet: Mantel adds one' : 'A room with no HK wall tablet', on: !!d.other, fk: 'mx:' + form + ':other',
                        onClick: () => { d.tablet = ''; d.other = true; redraw(); } }));
  const out = [group({ header: 'Which HK Tablet', footer: tablets.length ? 'Its touches and black screen reach Mantel as this HK tablet’s (All Screens, Wall Tablets). “In Use”: an enrolled device is already in its room.'
    : makes ? 'HK has no wall tablets in Mantel’s settings yet: choose A New Tablet and its room.' : 'HK has no wall tablets in Mantel’s settings yet (All Screens, Wall Tablets).' }, rows)];
  if (d.other) {
    const areas = (rooms && rooms.areas) || [];
    if (d.room && !areas.some((a) => a.id === d.room)) d.room = '';
    out.push(group({ footer: !areas.length ? 'Home Assistant has not told Mantel about any areas yet.'
      : makes ? 'Mantel adds an HK wall tablet in this room, named as below, so its idle return, screensaver and black screen work at once. Change them later in All Screens, Wall Tablets.'
      : 'With no HK tablet in its room, its touches and black screen won’t reach Mantel.' },
      areas.length ? [choose(form, 'room', 'Room', [['', 'Choose…']].concat(areas.map((a) => [a.id, a.name])), '')] : []));
  }
  return out;
}
// what the server is asked for: {tablet} or {room}; null when nothing is chosen
function roomBody(form) {
  const d = draft(form);
  if (d.tablet) return { tablet: d.tablet };
  if (d.other && d.room) return { room: d.room };
  return null;
}
// WALL TABLETS, ONE PLACE (All Screens, Wall Tablets): a wall tablet's page is HK's (its screen, room, kiosk app,
// idle and sleep), and Mantel adds what is Mantel's to it (extend 'tablet'): the browser signed in to Mantel as
// that tablet (an enrolled device: its credential, last seen, Sign Out), the Home Assistant user it is if it also
// opens Home Assistant (people_ha.py, the tablet link), and its kiosk app's direct connection. The list of tablets
// gets what belongs to none of them (extend 'tablets'): devices in a room no HK tablet has, and the signed-out ones.
// A device speaks for the HK tablets in its own room (devices.tablets_in: `hk_tablets`).
const tabletRows = (tid) => ((devicesRead() || {}).data || { devices: [] }).devices.filter((d) => !d.revoked && (d.hk_tablets || []).includes(tid));
export function drawTabletMantel(c, ctx) {
  const got = devicesRead();
  if (!got) { pending(c, 'Reading who is signed in as this tablet…'); return; }
  if (got.err) { failed(c, got.err); return; }
  const tid = ctx.tablet, key = 'tablet-mantel:' + tid, owner = me.user.role === 'owner';
  const mine = tabletRows(tid);
  result(c, key);
  const rows = [];
  for (const dv of mine) {
    rows.push(info(mine.length > 1 ? dv.name : 'Signed In to Mantel', ['last seen ' + ago(dv.last_seen), dv.source_ip, 'since ' + fmt(dv.created)].filter(Boolean).join(' · '),
                   mine.length > 1 ? 'Signed In' : dv.name));
  }
  if (!mine.length) {
    rows.push(info('Signed In to Mantel', null, 'Not Yet', 'warn'));
    rows.push(me.door === 'lan' ? nav('Sign In This Browser as ' + (ctx.name || 'This Tablet') + '…', 'devices/enroll/' + encodeURIComponent(tid), { icon: 'mdi:tablet' })
      : info('Sign In This Browser as This Tablet', null, 'Home Network Only'));
  }
  // the Home Assistant user it is, only if it also opens Home Assistant: one per tablet
  const hp = haPeopleRead(), users = (hp && hp.data && hp.data.users) || null;
  const haUsers = !!(mine.length && users && !(hp.data.error && !users.length));
  if (haUsers) {
    for (const dv of mine) {
      const cur = users.find((u) => u.tablet && u.tablet.device_id === dv.id);
      const label = 'Home Assistant User' + (mine.length > 1 ? ' (' + dv.name + ')' : '');
      if (!owner) { rows.push(info(label, null, cur ? cur.name : 'None')); continue; }
      const free = users.filter((u) => u === cur || (!u.admin && !u.tablet && (!u.person || standIn(u))));
      const opts = [['', 'None'], ...free.map((u) => [u.id, u.name + (u !== cur && standIn(u) ? ' (now a Wall Tablet account)' : '')])];
      rows.push(K().select({ label, options: opts, value: cur ? cur.id : '', fk: 'mx:dev-ha:' + dv.id,
        onChange: async (v) => {
          const was = users.find((u) => u.id === v);
          if (was && standIn(was) && !(await ask({ title: 'Make ' + was.name + ' this tablet’s?', message: 'It is linked to the Wall Tablet account “' + (was.person.name || was.name) + '” now. That account is removed; this tablet keeps signing in to Mantel as it does.', ok: 'Make It This Tablet’s' }))) { redraw(); return; }
          act(key, () => api('PUT', '/api/devices/' + encodeURIComponent(dv.id) + '/ha-user', { ha_user: v || null }),
              v ? 'Linked.' : 'It has no Home Assistant user now.', 'hapeople', 'devices', 'users');
        } }));
    }
  }
  // where it opens: its Screen above, unless a device was given its own (kept, so it can be put back)
  const ds = load('dscreens', () => api('GET', '/api/default-screens'));
  if (ds && ds.data) {
    for (const dv of mine.filter((x) => ds.data.devices[x.id])) {
      rows.push(screenPicker(key, 'Opens On' + (mine.length > 1 ? ' (' + dv.name + ')' : ''), 'Instead of its Screen, above', ds.data.devices[dv.id], ds.data.screens, 'Its Screen',
                             (v) => api('PUT', '/api/devices/' + encodeURIComponent(dv.id) + '/default-screen', { screen: v })));
    }
  }
  for (const dv of mine) rows.push(button('Sign Out ' + (mine.length > 1 ? dv.name : 'This Tablet') + '…', async () => {
    if (!(await ask({ title: 'Sign out ' + dv.name + '?', message: 'Mantel refuses it at once. To use it again, sign it in here from the tablet itself.', ok: 'Sign Out', destructive: true }))) return;
    act(key, () => api('DELETE', '/api/devices/' + encodeURIComponent(dv.id)), dv.name + ' is signed out.', 'devices', 'devrooms', 'hapeople');
  }, { destructive: true, fk: 'mx:revoke-device:' + dv.id }));
  c.appendChild(group({ header: 'Mantel', footer: (mine.length ? 'The browser on this tablet keeps its own credential, so nobody signs in at the tablet. '
      : 'Open Mantel Settings on the tablet itself, signed in as an Owner or Admin, and sign it in from this page there. ') +
    (haUsers ? 'Home Assistant User: only if the tablet also opens Home Assistant (Mantel in its sidebar), so Home Assistant’s user is known as this tablet.' +
      (owner ? '' : ' Only an Owner can change it.') : '') }, rows));
}
// the list's own: devices no HK tablet has, and the signed-out ones (Clear List)
export function drawTabletsMantel(c) {
  const got = devicesRead();
  if (!got || got.err) return;
  const all = got.data.devices, tablets = got.data.tablets || {};
  const lost = all.filter((d) => lostTablet(d, tablets));
  const gone = all.filter((d) => d.revoked);
  result(c, 'devices');
  if (lost.length) c.appendChild(group({ header: 'Signed In to Mantel, Not on a Tablet', footer: hh('span', { class: 'mxerr', text: 'In a room no wall tablet above has, so their touches and black screen don’t reach Mantel. Open each to choose its tablet.' }) },
    lost.map((d) => nav(d.name, 'devices/' + encodeURIComponent(d.id), { sub: [d.room ? titleCase(d.room) : 'No room', 'last seen ' + ago(d.last_seen), d.source_ip].filter(Boolean).join(' · '), value: 'Choose Tablet', icon: 'mdi:tablet' }))));
  if (gone.length) c.appendChild(group({ header: 'Signed Out', footer: 'Browsers signed out of Mantel as a tablet. They leave this list after 30 days; the Audit Log keeps them.' },
    gone.map((d) => info(d.name, [d.room ? titleCase(d.room) : null, 'signed out ' + fmt(d.revoked), d.revoked_reason && d.revoked_reason !== 'revoked' ? d.revoked_reason.replace(/_/g, ' ') : null].filter(Boolean).join(' · ')))
      .concat([button('Clear List', () => act('devices', () => api('DELETE', '/api/devices/revoked'), 'Cleared.', 'devices'), { fk: 'mx:devices-clear' })])));
  c.appendChild(group({ footer: me.door === 'lan' ? 'On the tablet itself, signed in as an Owner or Admin: this browser becomes a wall tablet, for one of the tablets above or a new one, and you are signed out here.'
      : 'A browser is signed in as a wall tablet on the home network only.' },
    [me.door === 'lan' ? nav('Sign In This Browser as a Wall Tablet…', 'devices/enroll', { icon: 'mdi:tablet' }) : info('Sign In This Browser as a Wall Tablet', null, 'Home Network Only')]));
}
// #/mantel/devices: its tablets are in All Screens, Wall Tablets now; a device's own page and enrolling stay here
export function pDevices(sub) {
  if (sub[0] === 'enroll') return pEnroll(sub[1] ? ['Wall Tablet', '#/house/tablets/' + encodeURIComponent(sub[1])] : undefined, sub[1]);
  if (sub[0]) return pDevice(sub[0]);
  return { title: 'Wall Tablets', top: true, body(c) {
    if (ui.enrolled) { drawEnrolled(c); return; }
    c.appendChild(group({ footer: 'Each wall tablet is in one place now, with its screen, room and kiosk app: All Screens, Wall Tablets.' },
      [K().nav({ label: 'Wall Tablets', href: '#/house/tablets', icon: 'mdi:tablet', fk: 'mx:to-tablets' })]));
  } };
}
// ONE DEVICE: its HK tablet or room, changed in place (PATCH /api/devices/{id}; it keeps its credential)
function pDevice(id) {
  const known = cache.devices && cache.devices.data && cache.devices.data.devices.find((x) => x.id === id);
  return { title: known ? known.name : 'Wall Tablet', back: ['Wall Tablets', '#/house/tablets'], body(c) {
    const key = 'device:' + id;
    result(c, key);
    const got = devicesRead(), rr = roomsRead();
    if (!got || !rr) { pending(c); return; }
    if (got.err || rr.err) { failed(c, got.err || rr.err); return; }
    const dev = got.data.devices.find((x) => x.id === id && !x.revoked);
    if (!dev) { failed(c, ERRORS.not_found); return; }
    const rooms = rr.data, form = 'move:' + id, d = draft(form);
    if (d.tablet === undefined) {                 // start from where it is
      d.tablet = (dev.hk_tablets || []).find((t) => rooms.tablets[t]) || '';
      d.other = !d.tablet && !!dev.room && rooms.areas.some((a) => a.id === dev.room);
      d.room = d.other ? dev.room : '';
    }
    const lost = lostTablet(dev, got.data.tablets);
    c.appendChild(group({ header: 'Now', footer: lost ? hh('span', { class: 'mxerr', text: (dev.room ? 'No HK wall tablet is in ' + roomName(rooms, dev.room) : 'It has no room') +
        ': its touches and black screen won’t reach Mantel. Choose its HK tablet below.' }) : null },
      [info('Room', null, dev.room ? roomName(rooms, dev.room) : 'None', lost ? 'warn' : ''), info('Role', null, roleLabel(dev.role))]));
    for (const g of roomChoice(form, rooms, dev.id)) c.appendChild(g);
    const body = roomBody(form);
    c.appendChild(group({ footer: 'It keeps its credential: nothing to do at the tablet. Its open screens follow within a minute.' }, [button('Save', async () => {
      const r = await act(key, () => api('PATCH', '/api/devices/' + encodeURIComponent(id), body), 'Saved.', 'devices', 'devrooms');
      if (r) clearDraft(form);
    }, { center: true, disabled: !body, fk: 'mx:move-device:' + id })]));
  } };
}
export function pEnroll(back = ['Wall Tablets', '#/house/tablets'], forTablet = null) {
  return { title: 'Make This a Wall Tablet', back, body(c) {
    result(c, 'enroll');
    if (ui.enrolled) { drawEnrolled(c); return; }
    const rr = roomsRead();
    if (!rr) { pending(c); return; }
    if (rr.err) { failed(c, rr.err); return; }
    const rooms = rr.data, tablets = tabletList(rooms);
    const u = me.user || {}, d = draft('device');
    if (forTablet && d.tablet === undefined && rooms.tablets[forTablet]) {   // from that tablet's own page
      d.tablet = forTablet; d.name = d.auto = rooms.tablets[forTablet].name;
    }
    if (u.role === 'wall_tablet') {               // a Wall Tablet account names its own tablet: start from its name
      const label = u.name || (u.username || '').replace(/^./, (x) => x.toUpperCase());
      if (d.name === undefined && label) d.name = label;     // an account made with no name: its user name (loft → Loft)
      if (d.tablet === undefined && label) {                 // and its HK tablet, by that name or that room
        const rid = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const hit = tablets.find(([, t]) => String(t.name).toLowerCase() === label.toLowerCase()) || tablets.find(([, t]) => t.room === rid);
        d.tablet = hit ? hit[0] : '';
      }
    }
    const nothing = !tablets.length && !(rooms.areas || []).length;
    if (nothing) c.appendChild(group({ header: 'Which HK Tablet', footer: 'Mantel knows no rooms yet: no HK wall tablets in its settings, no Home Assistant areas. Enrol it now, and choose its tablet in All Screens, Wall Tablets once they are here.' }, []));
    else {
      for (const g of roomChoice('device', rooms, null, (t) => {   // the name follows the tablet picked, until it is typed
        if (!d.name || d.name === d.auto) { d.name = t.name; d.auto = t.name; }
      }, ['owner', 'admin'].includes(u.role))) c.appendChild(g);
    }
    c.appendChild(group({ footer: 'The person is signed out of this browser at once, and it keeps its own credential. What it may do is its role’s (Roles & Grants). Only on the home network.' }, [
      field('device', 'name', 'Name', { placeholder: 'Kitchen Tablet', maxlength: 64 }),
      choose('device', 'role', 'Role', me.device_roles.map((r) => [r, roleLabel(r)]), 'wall_tablet')]));
    c.appendChild(group({}, [button('Make This a Wall Tablet', async () => {
      const name = (d.name || '').trim();
      const where = roomBody('device');
      const makes = ['owner', 'admin'].includes(u.role);
      if (!where && !nothing) { ui.flash = { key: 'enroll', text: d.other ? 'Choose its room.' : 'Choose its HK tablet, or ' + (makes ? 'A New Tablet' : 'Not One of These') + ' and its room.', err: true }; redraw(); return; }
      if (!name) { ui.flash = { key: 'enroll', text: 'Give the tablet a name.', err: true }; redraw(); return; }
      if (!(await ask({ title: 'Make this browser a wall tablet?', message: 'You will be signed out here. From now on this browser acts as the tablet “' + name + '”.', ok: 'Make It a Tablet' }))) return;
      // a room with no HK tablet: an Owner or Admin gets that HK tablet made too, so nothing waits on All Screens
      const make = d.other && where && makes ? { new_tablet: true } : {};
      const r = await act('enroll', () => api('POST', '/api/devices/enroll', { name, role: d.role, ...(where || {}), ...make }));
      if (r) { ui.enrolled = r.device; clearDraft('device'); redraw(); }
    }, { center: true, fk: 'mx:enroll-device' })]));
  } };
}
function drawEnrolled(c) {
  const d = ui.enrolled;
  c.appendChild(group({ header: 'This Browser Is Now a Wall Tablet', footer: `“${d.name}”${d.room ? ' in ' + titleCase(d.room) : ''} is enrolled as a ${roleLabel(d.role)}. You have been signed out of this browser.` },
    [K().nav({ label: 'Open the Dashboard', href: mantelUrl('/home'), fk: 'mx:open-home' })]));
}
