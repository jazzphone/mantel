// settings/cameras.js -- Mantel Settings, Cameras: the RTSP cameras Mantel plays itself (camera_setup.py; docs/phase13/CAMERAS-DIRECT.md phase 6).
//
// Where Mantel runs its own go2rtc (Docker, the Proxmox LXC) a camera that speaks RTSP is added here, without Home Assistant in
// the middle: Add Camera (a name, an area, the RTSP address, the user name and password, an optional sub-stream), Test (a picture
// from the camera before anything is saved, or what is wrong: it cannot be reached, the login was refused, a codec a browser
// cannot play), and Notify For: the Home Assistant sensors that stand for the camera's Motion, Person and Doorbell, so a
// notification on one carries this camera's picture. Under the Home Assistant App there is no go2rtc, so the page says the cameras
// come from Home Assistant and links to its Generic Camera integration: no Add Camera there.
//
// The user name and password are typed here and sent once; the server never sends them back. A saved camera is shown by its host,
// and its login boxes say Saved: leave one blank to keep it. The routes decide who may do what (Owner or Admin; a fresh sign-in
// away from home, which api() asks for through Confirm It Is You).
import { act, api, ask, cache, forget, hh, K, load, redraw, ROUTE, shown, ui } from './core.js';
import { button, clearDraft, draft, failed, field, group, info, nav, pending, result } from './kit.js';

// every call of this page: the camera routes, `tail` what follows /api/cameras/rtsp
const get = (tail) => api('GET', '/api/cameras/rtsp' + tail);
const post = (tail, body) => api('POST', '/api/cameras/rtsp' + tail, body);
const put = (tail, body) => api('PUT', '/api/cameras/rtsp' + tail, body);
const del = (tail) => api('DELETE', '/api/cameras/rtsp' + tail);
const ROLES = [['motion', 'Motion', 'Anything that moves in front of the camera.'],
               ['person', 'Person', 'A person is seen. This one is the camera’s own notification when it has one.'],
               ['doorbell', 'Doorbell', 'The doorbell is pressed. It shows the doorbell pop-up with this camera’s picture.']];
const STATE_WORDS = { ok: 'On', off: 'Off', conflict: 'Set Aside', unreadable: 'Cannot Open' };
const STATE_NOTE = {
  conflict: 'Home Assistant has an entity with this camera’s id, so Home Assistant’s wins and this camera is set aside. Rename one of them.',
  unreadable: 'Mantel’s saved copy of this camera’s address could not be opened (was the at-rest key changed?). Enter it again.',
};
const NO_HA = 'Without Home Assistant there is no motion source. Set up Home Assistant in Connections, then link its sensors here.';

export const readPage = () => load('cameras', () => get(''));

// the page's words for Test, from the server's answer
export function testSays(r) {
  const bits = [];
  if (r.video) bits.push(r.video + ' video');
  if (r.audio) bits.push(r.audio + ' audio');
  return 'It works: ' + (bits.join(' and ') || 'a picture') + (r.low ? ', and the sub-stream' : '') + '.';
}

export function pCameras(sub) {
  if (sub[0] === 'add') return pCamera(null);
  if (sub[0]) return pCamera(sub[0]);
  return { title: 'Cameras', top: true,
    scope: 'Cameras Mantel plays itself, without Home Assistant in the middle. An RTSP camera is added here, tried before it is saved, and linked to the Home Assistant sensors that tell Mantel when it sees someone.',
    body(c) {
      result(c, 'cameras');
      const got = readPage();
      if (!got) { pending(c); return; }
      if (got.err) { failed(c, got.err); return; }
      const d = got.data;
      if (d.mode === 'ha_app') { drawFromHa(c, d); return; }
      if (d.mode !== 'direct') {
        c.appendChild(group({ footer: 'Mantel was started without its video relay (go2rtc), which direct cameras need. Docker and the Proxmox LXC start it for you; set --go2rtc-url if you run Mantel another way. Cameras still come from Home Assistant.' }, []));
        return;
      }
      const rows = d.cameras.map((x) => {
        const sub = [x.area_name, x.address ? x.address.replace(/^rtsps?:\/\//, '') : (x.source === 'protect' ? 'UniFi Protect' : null),
                     x.state === 'ok' ? null : STATE_NOTE[x.state] ? 'Needs attention' : null].filter(Boolean).join(' · ');
        return x.editable ? nav(x.name, 'cameras/' + encodeURIComponent(x.slug), { icon: 'mdi:cctv', sub, value: STATE_WORDS[x.state] || x.state })
                          : info(x.name, sub, STATE_WORDS[x.state] || x.state, x.state === 'ok' ? '' : 'warn');
      });
      const notes = [];
      if (!d.cameras.length) notes.push('No direct cameras yet.');
      if (!d.ha.set_up) notes.push(NO_HA);
      if (d.needs_fresh) notes.push('From outside the home network you will be asked to confirm it is you first.');
      c.appendChild(group({ header: 'Direct Cameras', footer: notes.join(' ') || null }, rows));
      if (d.can_edit) c.appendChild(group({ footer: 'RTSP cameras on your network. A camera from UniFi Protect is added in Connections, UniFi Protect.' }, [
        nav('Add Camera', 'cameras/add', { icon: 'mdi:plus' })]));
      if (d.error) c.appendChild(group({ footer: 'Mantel’s video relay (go2rtc) last said: ' + d.error }, []));
    } };
}

// UNDER THE HOME ASSISTANT APP: Mantel has no go2rtc, so no Add Camera. The cameras are Home Assistant's.
function drawFromHa(c, d) {
  const link = hh('a', { href: d.ha_docs, target: '_blank', rel: 'noopener', text: 'Generic Camera integration' });
  c.appendChild(group({ header: 'Cameras', footer: hh('span', {}, [
    'Mantel runs as a Home Assistant App here, so its cameras come from Home Assistant. To use an RTSP camera, add it in Home Assistant with its ',
    link, ' (Settings, Devices & Services, Add Integration, Generic Camera); it then appears in Mantel by itself. Mantel plays cameras itself, with Add Camera here, when it runs in Docker or on its own Proxmox LXC.']) }, []));
}

// ONE CAMERA'S PAGE, or Add Camera (slug null): the boxes, Test, Notify For, Save and Delete
function pCamera(slug) {
  const back = ['Cameras', '#/' + ROUTE + '/cameras'];
  const form = 'cam-' + (slug || 'new'), key = 'camera:' + (slug || 'new');
  return { title: slug ? 'Camera' : 'Add Camera', back, body(c) {
    result(c, key);
    const got = readPage();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const page = got.data;
    if (page.mode === 'ha_app') { drawFromHa(c, page); return; }
    if (page.mode !== 'direct') { c.appendChild(group({ footer: 'Mantel was started without its video relay (go2rtc), which direct cameras need.' }, [])); return; }
    const cam = slug ? page.cameras.find((x) => x.slug === slug) : null;
    if (slug && (!cam || !cam.editable)) { c.appendChild(group({ footer: 'That camera is no longer here.' }, [])); return; }
    if (!page.can_edit) { c.appendChild(group({ footer: 'Only an Owner or an Admin can change cameras.' }, [])); return; }
    const d = draft(form);
    if (d.name === undefined) d.name = cam ? cam.name : '';
    if (d.area_id === undefined) d.area_id = cam ? (cam.area_id || '') : '';
    if (!d.sensors) d.sensors = Object.fromEntries(ROLES.map(([r]) => [r, cam && cam.sensors[r] && cam.sensors[r].entity_id ? cam.sensors[r].entity_id : '']));
    const kept = cam && cam.sensors ? cam.sensors : {};

    if (cam) {
      const rows = [info('Status', STATE_NOTE[cam.state] || null, STATE_WORDS[cam.state] || cam.state, cam.state === 'ok' ? '' : 'warn'),
                    info('Address', cam.low_address ? 'And a sub-stream, for the pictures' : null, cam.address ? cam.address.replace(/^rtsps?:\/\//, '') : '—'),
                    info('Sign-In', null, cam.has_login ? 'Saved' : 'None'),
                    info('Id', null, cam.entity_id)];
      if (cam.sessions) rows.push(info('Watching Now', null, String(cam.sessions)));
      c.appendChild(group({}, rows));
    }

    c.appendChild(group({ header: 'Camera' }, [
      field(form, 'name', 'Name', { value: d.name, maxlength: 80, placeholder: 'Driveway' }),
      K().select({ label: 'Area', options: [['', 'None']].concat(page.areas.map((a) => [a.id, a.name])), value: d.area_id, fk: 'mx:' + form + ':area',
                   onChange: (v) => { d.area_id = v; } }),
    ]));
    c.appendChild(group({ header: 'Address', footer: 'The camera’s RTSP address, such as rtsp://192.0.2.50:554/stream1 (its manual gives the path). Type the user name and password in their own boxes, not in the address. The sub-stream is a second, smaller stream some cameras offer: Mantel draws the stills from it. ' +
        (cam ? 'Leave a box blank to keep what is saved; it is never shown again.' : 'They stay sealed in Mantel’s data and are never shown again.') }, [
      field(form, 'address', 'RTSP Address', { type: 'url', maxlength: 2048, inputmode: 'url', placeholder: cam ? 'Saved: ' + (cam.address || '') : 'rtsp://192.0.2.50:554/stream1', autocomplete: 'off' }),
      field(form, 'low_address', 'Sub-Stream (Optional)', { type: 'url', maxlength: 2048, inputmode: 'url', placeholder: cam && cam.low_address ? 'Saved: leave blank to keep' : 'rtsp://192.0.2.50:554/stream2', autocomplete: 'off' }),
      field(form, 'username', 'User Name', { maxlength: 200, placeholder: cam && cam.has_login ? 'Saved' : 'None', autocomplete: 'off' }),
      field(form, 'password', 'Password', { type: 'password', maxlength: 400, placeholder: cam && cam.has_login ? 'Saved' : 'None', autocomplete: 'off' }),
    ].concat(cam && cam.has_login ? [K().check({ label: 'Remove the Saved Sign-In', sub: 'The camera needs no user name or password', on: !!d.clear_login,
                                                 fk: 'mx:' + form + ':clear', onClick: () => { d.clear_login = !d.clear_login; redraw(); } })] : [])
      .concat(cam && cam.low_address ? [K().check({ label: 'Remove the Sub-Stream', on: !!d.drop_low,
                                                    fk: 'mx:' + form + ':droplow', onClick: () => { d.drop_low = !d.drop_low; redraw(); } })] : [])));

    drawTest(c, form, cam, d);
    drawNotifyFor(c, form, cam, d, page, kept);

    const save = async () => {
      const body = bodyOf(d, cam, page.ha.set_up);
      const out = await act(key, async () => {
        const r = await (cam ? put('/' + encodeURIComponent(cam.slug), body) : post('', body));
        return r;
      }, cam ? 'Saved.' : null, 'cameras');
      if (!out) return;
      forgetSensors();
      clearDraft(form); delete shown['test:' + form];
      if (!cam) { forget('cameras'); location.hash = '#/' + ROUTE + '/cameras/' + encodeURIComponent(out.camera.slug); }
      redraw();
    };
    c.appendChild(group({}, [button(cam ? 'Save' : 'Add Camera', save, { fk: 'mx:' + form + ':save' })]));
    if (cam) c.appendChild(group({ footer: 'The camera and its saved address and sign-in are removed from Mantel. Nothing changes on the camera itself.' }, [
      button('Delete Camera…', async () => {
        if (!(await ask({ title: 'Delete ' + cam.name + '?', message: 'Mantel stops playing this camera and forgets its address and sign-in. Notifications that used its picture go back to having none.', ok: 'Delete', destructive: true }))) return;
        if (await act(key, () => del('/' + encodeURIComponent(cam.slug)), null, 'cameras')) {
          forgetSensors();
          ui.flash = { key: 'cameras', text: cam.name + ' deleted.' };
          clearDraft(form);
          location.hash = '#/' + ROUTE + '/cameras';
        }
      }, { destructive: true, fk: 'mx:' + form + ':delete' })]));
  } };
}

// the sensors on offer are read per name typed and per camera, and say which camera has each: any save makes them stale
const forgetSensors = () => { for (const k of Object.keys(cache)) if (k.startsWith('cam-sensors:')) delete cache[k]; };

// what the boxes say, as the route takes it: a blank box on a saved camera is left out, so it keeps what is saved
export function bodyOf(d, cam, withSensors) {
  const body = { name: (d.name || '').trim(), area_id: d.area_id || null };
  for (const k of ['address', 'low_address']) {
    const v = (d[k] || '').trim();
    if (v || !cam) body[k] = v;
    else if (k === 'low_address' && d.drop_low) body[k] = '';
  }
  if (d.username) body.username = d.username;
  if (d.password) body.password = d.password;
  if (d.clear_login) body.clear_login = true;
  if (withSensors || cam) {
    body.sensors = {};
    for (const [r] of ROLES) {
      const v = d.sensors && d.sensors[r];
      if (!v && cam && cam.sensors && cam.sensors[r] && !cam.sensors[r].entity_id) continue;     // one this person cannot see stays as it is
      body.sensors[r] = v || null;
    }
  }
  return body;
}

// TEST: a picture from the camera before anything is saved, or what is wrong
function drawTest(c, form, cam, d) {
  const out = shown['test:' + form];
  const run = async () => {
    shown['test:' + form] = { text: 'Trying the camera…' }; redraw();
    try {
      const r = await post('/test', { ...bodyOf(d, cam, false), ...(cam ? { slug: cam.slug } : {}) });
      shown['test:' + form] = { text: testSays(r.result), still: r.result.still };
    } catch (e) { shown['test:' + form] = { text: e.message, err: true }; }
    redraw();
  };
  c.appendChild(group({ header: 'Test', footer: 'Mantel connects to the camera and shows a picture, or says what it could not do. Nothing is saved.' }, [button('Test', run, { fk: 'mx:' + form + ':test' })]));
  if (!out) return;
  c.appendChild(hh('p', { class: 'mxflash' + (out.err ? ' err' : ''), role: out.err ? 'alert' : 'status', text: out.text }));
  if (out.still) c.appendChild(hh('div', { class: 'cell mxshot' }, [hh('img', { src: out.still, alt: 'A picture from the camera', width: 640 })]));
}

// NOTIFY FOR: the Home Assistant sensors that stand for this camera's Motion, Person and Doorbell
function drawNotifyFor(c, form, cam, d, page, kept) {
  const header = 'Notify For';
  if (!page.ha.set_up) {         // nothing to pick from; what is linked already is shown, as it stands
    c.appendChild(group({ header, footer: NO_HA }, ROLES.filter(([r]) => kept[r]).map(([r, t]) => info(t, null, kept[r].name))));
    return;
  }
  const name = (d.name || '').trim();
  const rk = 'cam-sensors:' + (cam ? cam.slug : 'new') + ':' + name;
  const got = load(rk, () => get('/sensors?name=' + encodeURIComponent(name) + (cam ? '&slug=' + encodeURIComponent(cam.slug) : '')));
  if (!got) { pending(c, 'Reading Home Assistant’s sensors…'); return; }
  if (got.err) { failed(c, got.err); return; }
  const sensors = got.data.sensors, sug = got.data.suggested || {};
  const label = (s) => s.name + (s.area ? ' (' + s.area + ')' : '');
  const options = (role) => {
    const cur = d.sensors[role];
    const list = sensors.filter((s) => !s.linked_to || s.entity_id === cur);
    const known = list.some((s) => s.entity_id === cur);
    return [['', 'None']].concat(list.map((s) => [s.entity_id, label(s)])).concat(cur && !known ? [[cur, (kept[role] && kept[role].name) || cur]] : []);
  };
  const rows = ROLES.map(([role, text]) => (kept[role] && !kept[role].entity_id)
    ? info(text, 'Linked to a sensor you cannot see. It stays as it is.', kept[role].name)
    : K().select({ label: text, options: options(role), value: d.sensors[role] || '', fk: 'mx:' + form + ':sensor:' + role,
                                                        onChange: (v) => { d.sensors[role] = v; } }));
  const any = Object.values(sug).some(Boolean);
  if (any) rows.push(button('Use Suggested Sensors', () => { for (const r of Object.keys(sug)) if (sug[r] && !d.sensors[r] && !(kept[r] && !kept[r].entity_id)) d.sensors[r] = sug[r]; redraw(); }, { fk: 'mx:' + form + ':suggest' }));
  c.appendChild(group({ header, footer: 'Pick any binary sensor or event from Home Assistant, such as Frigate’s. Its events count as this camera’s: a notification on it carries this camera’s picture, and a Doorbell sensor shows the doorbell pop-up. ' +
    (any ? 'Sensors whose names begin with the camera’s are suggested. ' : '') + 'Turn the notifications themselves on in Notifications. A sensor you cannot see is not on the list.' }, rows));
}
