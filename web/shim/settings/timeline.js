// settings/timeline.js -- Mantel Settings, Timeline (timeline/api.py; docs/phase19/HOUSE-TIMELINE.md "Mantel Settings → Timeline"):
// what the House Timeline records (a switch per family, and one by one: the entities it records, the ones it
// doesn't), how long rows are kept, the pictures (budget, frames, what is used), what a wall tablet shows, the Morning
// Summary, and Clear Timeline. Owners and Admins see it; only the Owner changes it.
//
// Every change is one request, and the answer is the page again, so a switch shows what the server holds. From away
// the routes ask for a fresh sign-in (api() asks for it through Confirm It Is You); Clear Timeline always does, and
// first asks for the word CLEAR to be typed. Me's switches (Keep My Arrivals Private, Morning Summary, Clear My
// Arrivals) live in me.js and use the helpers at the top of this file.
import { act, api, hh, K, load, panel, redraw, ROUTE, ui } from './core.js';
import { button, failed, group, holdFocus, info, nav, pending, result } from './kit.js';

const HOME = '#/' + ROUTE + '/timeline';

// ---------------------------------------------------------------------------------------- the words (pure)
// a family's name as a switch says it; what is under it says what it covers
export const FAMILIES = [
  ['door', 'Doors', 'Doors and gates opening and closing'],
  ['window', 'Windows', 'Off for a new house'],
  ['lock', 'Locks', 'Locked, unlocked, jammed'],
  ['garage', 'Garage', 'Opened and closed'],
  ['alarm', 'Alarm', 'Armed, disarmed, triggered'],
  ['arrival', 'Arrivals & Departures', 'People coming and going; each person can hide their own in Me'],
  ['doorbell', 'Doorbell', 'Rings'],
  ['detection', 'Camera Detections', 'Person, vehicle, animal, package'],
  ['motion', 'Motion', 'Cameras without smart detection'],
  ['safety', 'Safety', 'Leaks, smoke, carbon monoxide'],
  ['system', 'System', 'Owners & Admins'],
  ['refused', 'Refused Commands', 'Owners & Admins'],
];
const NAME = Object.fromEntries(FAMILIES.map(([id, name]) => [id, name]));
export const familyName = (id) => NAME[id] || String(id).replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

// an entity Mantel doesn't recognize can be recorded as one of these
// (the server files a plain sensor as a door or a window only: a doorbell, motion or safety filed by hand would escape
// the camera rules or the alarms' own sensors -- timeline/api.py clean_overrides)
export const RECORD_AS = [['door', 'Door'], ['window', 'Window']];

export const retentionLabel = (days) => (days === 365 ? '1 Year' : days + ' Days');
export const budgetLabel = (mb) => (mb >= 1000 && mb % 1000 === 0 ? mb / 1000 + ' GB' : mb + ' MB');
export const framesLabel = (n) => (n === 1 ? '1 Picture' : n + ' Pictures');
const count = (n) => Number(n || 0).toLocaleString('en-US');
// "312 MB of 500 MB" and, beside it, "4,210 pictures"
export function usageText(usage, budgetMb) {
  if (!usage) return null;
  const mb = Math.round((usage.bytes || 0) / 1048576);
  const cap = usage.budget_bytes ? Math.round(usage.budget_bytes / 1048576) : budgetMb;
  return { value: mb + ' MB of ' + budgetLabel(cap), sub: count(usage.kept) + (usage.kept === 1 ? ' picture' : ' pictures') };
}
// "07:00" -> "7:00 AM"
export function clockText(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}
export const clockValid = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));
// a list with `id` in it (on) or out of it (off), the rest as it was
export const toggled = (list, id, on) => { const rest = (list || []).filter((x) => x !== id); return on ? rest.concat([id]) : rest; };

// the Owner's per-entity map ({entity: {record, family?, label?}}), changed one entity at a time: a new map, never the old one
export function withOverride(overrides, entity, entry) {
  const out = { ...(overrides || {}) };
  if (entry) out[entity] = entry; else delete out[entity];
  return out;
}
export function stopRecording(overrides, entity) {
  const was = (overrides || {})[entity] || {};
  return withOverride(overrides, entity, { record: false, ...(was.label ? { label: was.label } : {}) });
}
export const recordAs = (overrides, entity, family) => withOverride(overrides, entity, { record: true, family });
export const recordAgain = (overrides, entity) => withOverride(overrides, entity, null);
// a row of the Not Recorded page chose a family ('' is "not recorded")
export const choose = (overrides, entity, family) => (family ? recordAs(overrides, entity, family) : recordAgain(overrides, entity));

// the recorded entities, by family, in the order the switches have
export function byFamily(members) {
  const order = FAMILIES.map(([id]) => id);
  const groups = new Map();
  for (const m of members || []) {
    if (!groups.has(m.family)) groups.set(m.family, []);
    groups.get(m.family).push(m);
  }
  return [...groups.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
}
const prettyId = (eid) => String(eid).split('.').slice(1).join(' ').replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
// entities that were turned off by hand and that the candidates list wouldn't show (a door sensor, a lock)
export function turnedOff(page) {
  const cands = new Set((page.candidates || []).map((x) => x.entity));
  return Object.entries(page.overrides || {}).filter(([e, o]) => o && o.record === false && !cands.has(e))
    .map(([entity, o]) => ({ entity, name: o.label || prettyId(entity) }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
export const candidateValue = (page, entity) => {
  const o = (page.overrides || {})[entity];
  return o && o.record === true && o.family ? o.family : '';
};

// CLEAR TIMELINE asks for the word, exactly (a trailing space from a keyboard doesn't count against it)
export const CLEAR_WORD = 'CLEAR';
export const typedIs = (typed, word) => String(typed || '').trim() === word;
export const clearConfirmed = (typed) => typedIs(typed, CLEAR_WORD);

// Me: what turning Keep My Arrivals Private on, or Clear My Arrivals, will delete, said as the person would
export const arrivalsWord = (n) => (n === 1 ? '1 recorded arrival or departure' : count(n) + ' recorded arrivals and departures');

// ---------------------------------------------------------------------------------------- the read
export const readPage = () => load('timeline', () => api('GET', '/api/timeline/settings'));
function withPage(c, key, draw) {
  result(c, key);
  const got = readPage();
  if (!got) { pending(c); return; }
  if (got.err) { failed(c, got.err); return; }
  draw(got.data);
}
const readOnly = (page) => (!page.can_edit ? 'Only an Owner can change the Timeline.' : page.needs_fresh
  ? 'From outside the home network you will be asked to confirm it is you first.' : null);

// one change: the request, then the page as the server now holds it
const save = (page, path, body, key = 'timeline') => act(key, async () => { const r = await api('PUT', path, body); Object.assign(page, r); return r; });
const putSettings = (page, body) => save(page, '/api/timeline/settings', body);
const putOverrides = (page, map) => save(page, '/api/timeline/overrides', { overrides: map });

// ============================================================================================ Timeline
export function pTimeline(sub = []) {
  if (sub[0] === 'recorded') return pRecorded();
  if (sub[0] === 'not-recorded') return pNotRecorded();
  return { title: 'Timeline', top: true,
    scope: 'What Mantel keeps about the house: doors, locks, the garage, the alarm, arrivals and what the cameras saw.',
    body(c) {
      withPage(c, 'timeline', (page) => {
        const can = page.can_edit;
        c.appendChild(group({ header: 'What’s Recorded',
          footer: [readOnly(page), 'Windows are off for a new house. System and Refused Commands are shown to Owners and Admins only. Turning one off stops new rows; the rows already kept stay until they age out.']
            .filter(Boolean).join(' ') },
        FAMILIES.map(([id, name, sub2]) => K().toggle({ label: name, sub: sub2, on: !!page.families[id], disabled: !can, fk: 'mx:timeline-family:' + id,
          onChange: (on) => putSettings(page, { families: { [id]: on } }) }))));
        drawEntities(c, page);
        drawRetention(c, page);
        drawPictures(c, page);
        drawWall(c, page);
        drawDigest(c, page);
        if (can) drawClear(c, page);
      });
    } };
}

// what is recorded one by one: the two pages under "Entities"
function drawEntities(c, page) {
  const off = turnedOff(page);
  c.appendChild(group({ header: 'Entities', footer: 'Stop recording one door or camera, or add a sensor Mantel doesn’t recognize as a door, a window or motion.' }, [
    nav('Recorded Entities', 'timeline/recorded', { icon: 'mdi:eye', value: count(page.members.length) }),
    nav('Not Recorded', 'timeline/not-recorded', { icon: 'mdi:eye-off', value: count(page.candidates.length + off.length) })]));
}
function drawRetention(c, page) {
  const can = page.can_edit;
  const opts = page.retentions.map((d) => [String(d), retentionLabel(d)]);
  c.appendChild(group({ header: 'Retention', footer: 'Rows older than this are deleted. Pictures follow their own budget, below.' }, [
    K().select({ label: 'Keep Rows For', options: opts, value: String(page.retention_days), disabled: !can, fk: 'mx:timeline-retention',
      onChange: (v) => putSettings(page, { retention_days: Number(v) }) }),
    info('Rows Kept', null, count(page.rows))]));
}
function drawPictures(c, page) {
  const can = page.can_edit, p = page.pictures || {};
  const use = usageText(page.usage, p.budget_mb);
  const rows = [
    K().select({ label: 'Picture Budget', options: page.budgets_mb.map((m) => [String(m), budgetLabel(m)]), value: String(p.budget_mb), disabled: !can, fk: 'mx:timeline-budget',
      onChange: (v) => putSettings(page, { pictures: { budget_mb: Number(v) } }) }),
    K().select({ label: 'Pictures per Detection', options: page.frames.map((n) => [String(n), framesLabel(n)]), value: String(p.frames), disabled: !can, fk: 'mx:timeline-frames',
      onChange: (v) => putSettings(page, { pictures: { frames: Number(v) } }) })];
  if (use) rows.push(info('Used', use.sub, use.value));
  c.appendChild(group({ header: 'Pictures', footer: 'Snapshots from the cameras, kept with the row they belong to. Past the budget the oldest pictures go first and their rows stay. They are never sent anywhere.' }, rows));
}
function drawWall(c, page) {
  const can = page.can_edit, wall = page.wall || { families: [], pictures: [] };
  c.appendChild(group({ header: 'Wall Tablets: What They Show', footer: 'A wall tablet with nobody signed in shows the last 12 hours of these, without names, and nothing else.' },
    page.wall_families.map((f) => K().toggle({ label: familyName(f), on: wall.families.includes(f), disabled: !can, fk: 'mx:timeline-wall:' + f,
      onChange: (on) => putSettings(page, { wall: { families: toggled(wall.families, f, on) } }) }))));
  const tablets = page.tablets || [];
  c.appendChild(group({ header: 'Wall Tablets: Pictures', footer: tablets.length ? 'Pictures are off for a wall tablet unless you turn them on here, because anyone in the room can read the screen.'
    : 'No wall tablets yet. Add one in Devices, and it shows up here.' },
  tablets.length ? tablets.map((t) => K().toggle({ label: t.name || 'Wall Tablet', sub: 'Show Pictures', on: wall.pictures.includes(t.id), disabled: !can, fk: 'mx:timeline-wall-pics:' + t.id,
    onChange: (on) => putSettings(page, { wall: { pictures: toggled(wall.pictures, t.id, on) } }) })) : [info('No wall tablets')]));
}
function drawDigest(c, page) {
  const can = page.can_edit, d = page.digest || { at: '07:00', from: '21:00' };
  const time = (name, label) => (can ? K().text({ label, type: 'time', value: d[name], maxlength: 5, fk: 'mx:timeline-digest-' + name,
    onCommit: (v) => { if (clockValid(v)) putSettings(page, { digest: { [name]: v } }); else redraw(); } })
    : info(label, null, clockText(d[name])));
  const rows = [time('at', 'Sent At'), time('from', 'Covers From')];
  if (can) rows.push(button('Send Test', () => act('timeline', async () => {
    const r = await api('POST', '/api/timeline/digest/test', {});
    ui.flash = { key: 'timeline', text: r && r.sent ? 'Test sent.' : 'Nothing was sent: no alert channel has House turned on, and nobody has Morning Summary on.', err: !(r && r.sent) };
  }), { fk: 'mx:timeline-digest-test' }));
  c.appendChild(group({ header: 'Morning Summary',
    footer: 'The night in a few lines, from the time under Covers From to the time it is sent. Alert channels with House turned on get the house version, without names or arrivals; Mantel apps get a personal one for each person who turns on Morning Summary in Me.' }, rows));
}
function drawClear(c, page) {
  c.appendChild(group({ footer: 'Deletes every row and every picture, for good. Mantel asks you to confirm it is you, then to type CLEAR.' }, [
    button('Clear Timeline…', async () => {
      if (!(await typedConfirm({ title: 'Clear the Timeline?', message: 'Type CLEAR to delete every row and picture.', word: CLEAR_WORD, ok: 'Clear Timeline' }))) return;
      const out = await act('timeline', () => api('DELETE', '/api/timeline?confirm=clear'), null, 'timeline');
      if (out) { ui.flash = { key: 'timeline', text: out.deleted ? 'Cleared ' + count(out.deleted) + (out.deleted === 1 ? ' row.' : ' rows.') : 'Nothing was there to clear.' }; redraw(); }
    }, { destructive: true, center: true, fk: 'mx:timeline-clear' })]));
}

// ---------------------------------------------------------------------------------------- Recorded Entities
function pRecorded() {
  return { title: 'Recorded Entities', back: ['Timeline', HOME], body(c) {
    withPage(c, 'timeline', (page) => {
      const can = page.can_edit;
      const groups = byFamily(page.members);
      if (!groups.length) { c.appendChild(group({ footer: 'Nothing is being recorded yet. Turn a family on in What’s Recorded.' }, [])); return; }
      groups.forEach(([family, list], i) => {
        c.appendChild(group({ header: familyName(family),
          footer: i === groups.length - 1 ? [readOnly(page), 'A switch that is on is recorded. Turn it off to stop recording that one; it moves to Not Recorded.'].filter(Boolean).join(' ') : null },
        list.map((m) => K().toggle({ label: m.label, on: true, disabled: !can, fk: 'mx:timeline-entity:' + m.entity,
          onChange: (on) => { if (!on) putOverrides(page, stopRecording(page.overrides, m.entity)); } }))));
      });
    });
  } };
}

// ---------------------------------------------------------------------------------------- Not Recorded
function pNotRecorded() {
  return { title: 'Not Recorded', back: ['Timeline', HOME], body(c) {
    withPage(c, 'timeline', (page) => {
      const can = page.can_edit, off = turnedOff(page);
      const options = [['', 'Not Recorded']].concat(RECORD_AS.map(([f, name]) => [f, 'Record as ' + name]));
      const cands = page.candidates.map((x) => K().select({ label: x.name, options, value: candidateValue(page, x.entity), disabled: !can, fk: 'mx:timeline-candidate:' + x.entity,
        onChange: (v) => putOverrides(page, choose(page.overrides, x.entity, v)) }));
      c.appendChild(group({ header: 'Sensors Mantel Doesn’t Recognize',
        footer: [readOnly(page), 'These are sensors with no type in Home Assistant. Choose what one is, and Mantel records it from then on.'].filter(Boolean).join(' ') },
      cands.length ? cands : [info('Nothing to add')]));
      if (off.length) {
        c.appendChild(group({ header: 'Turned Off', footer: 'Recorded again when you turn one on.' },
          off.map((x) => K().toggle({ label: x.name, sub: x.entity, on: false, disabled: !can, fk: 'mx:timeline-again:' + x.entity,
            onChange: (on) => { if (on) putOverrides(page, recordAgain(page.overrides, x.entity)); } }))));
      }
    });
  } };
}

// ---------------------------------------------------------------------------------------- a typed confirmation
// An alert in HK Settings' own look (the kit's .dlg) with a box for the word. Resolves true only when the word is
// typed exactly; Cancel, Escape or a tap outside is false.
function typedConfirm(o) {
  const root = panel.shadowRoot;
  return new Promise((resolve) => {
    const box = hh('input', { class: 'mxin', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', maxlength: 16,
                              'aria-label': 'Type ' + o.word + ' to confirm' });
    const err = hh('p', { class: 'mxe', role: 'alert' });
    const cancel = hh('button', { type: 'button', class: 'cx bold', text: 'Cancel' });
    const ok = hh('button', { type: 'button', class: 'red', text: o.ok });
    const dlg = hh('div', { class: 'dlg mxdlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title },
      [hh('h2', { text: o.title }), hh('p', { text: o.message }), box, err, hh('div', { class: 'db' }, [cancel, ok])]);
    const bd = hh('div', { class: 'dlgbd' }, dlg);
    const giveBack = holdFocus(root, bd, dlg);
    const close = (v) => { bd.remove(); giveBack(); resolve(v); };
    const go = () => { if (typedIs(box.value, o.word)) close(true); else err.textContent = 'Type ' + o.word + ' in capital letters.'; };
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', go);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } });
    bd.addEventListener('click', (e) => { if (e.target === bd) close(false); });
    root.appendChild(bd);
    box.focus();
  });
}
