// settings/setup.js -- Mantel Settings, Set Up Mantel: the first run's checklist.
// @ts-check
import { mantelUrl } from '../base.js';
import { act, api, C, K, load, me, redraw, refreshMe, ROUTE } from './core.js';
import { button, failed, group, info, pending, result, secretCell } from './kit.js';
import { drawImport } from './connections.js';

// ============================================================================================ Set Up Mantel
// THE FIRST RUN'S CHECKLIST (setup_guide.py): each step as the house has it now, and the page that does it. A step
// is done when the house says so; "Later" (skipped) and "Looks Right" (confirmed) are the only things kept.
const STEP_ICON = { ha: ['mdi:home-assistant', C.blue], home: ['mdi:home', C.orange], screens: ['mdi:monitor-dashboard', C.teal],
                    people: ['mdi:account', C.blue], protect: ['mdi:shield-key', C.indigo], alarm: ['mdi:shield-lock', C.red],
                    tablets: ['mdi:tablet', C.teal], music: ['mdi:music', C.pink], link: ['mdi:link-variant', C.orange],
                    files: ['mdi:folder', C.purple], commands: ['mdi:lightning-bolt', C.green], house: ['mdi:transfer', C.orange],
                    address: ['mdi:lock', C.green] };
const STEP_SAYS = { done: 'Done', todo: 'To Do', skipped: 'Later' };
export const setupOpen = () => !!(me && me.setup && me.setup.open);
const setupRead = () => load('setup', () => api('GET', '/api/setup'));
function stepRow(s) {
  return K().nav({ label: s.title, sub: s.state === 'done' ? null : s.detail, value: STEP_SAYS[s.state], tile: STEP_ICON[s.id],
                   href: '#/' + ROUTE + '/setup/step/' + s.id, fk: 'mx:setup:' + s.id });
}
function setStep(id, state, okText) {
  return act('setup', () => api('PUT', '/api/setup/steps/' + id, { state }), okText, 'setup')
    .then(async (r) => { if (r) { try { await refreshMe(); } catch (e) { /* the page still shows the step */ } redraw(); } return r; });
}
export function pSetup(sub) {
  if (sub[0] === 'screens') return pSetupScreens();
  if (sub[0] === 'step' && sub[1]) return pSetupStep(sub[1]);
  return { title: 'Set Up Mantel', top: true, scope: 'What Mantel needs before the household uses it. Each step opens the page that does it, and is done when the house says so.', body(c) {
    result(c, 'setup');
    const got = setupRead();
    if (!got) { pending(c, 'Looking at the house…'); return; }
    if (got.err) { failed(c, got.err); return; }
    const s = got.data;
    const needed = s.steps.filter((x) => !x.optional), optional = s.steps.filter((x) => x.optional);
    const left = needed.filter((x) => x.state === 'todo').length;
    c.appendChild(group({ header: 'Needed', footer: s.complete ? 'Mantel is set up. The optional steps can be done whenever you like.'
      : left + (left === 1 ? ' step needs' : ' steps need') + ' doing. You can leave the ones marked Later.' }, needed.map(stepRow)));
    c.appendChild(group({ header: 'Optional' }, optional.map(stepRow)));
    if (!s.can_edit) { c.appendChild(group({ footer: 'Only an Owner can mark steps for later.' }, [])); return; }
    c.appendChild(group({ footer: s.dismissed ? 'Mantel Settings opens on its usual page. This list stays here, under Mantel.'
      : 'Close the guide and Mantel Settings opens on its usual page; this list stays here, under Mantel.' }, [
      button(s.dismissed ? 'Open This Guide First Again' : 'Close the Guide', async () => {
        if (await act('setup', () => api('PUT', '/api/setup', { dismissed: !s.dismissed }), s.dismissed ? 'The guide opens first again.' : 'Closed.', 'setup')) {
          try { await refreshMe(); } catch (e) { /* drawn from the cache */ }
          redraw();
        }
      }, { fk: 'mx:setup:dismiss' })]));
  } };
}
function pSetupStep(id) {
  const back = ['Set Up Mantel', '#/' + ROUTE + '/setup'];
  const got = setupRead();
  const s = got && got.data && got.data.steps.find((x) => x.id === id);
  return { title: s ? s.title : 'Step', back, body(c) {
    result(c, 'setup');
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    if (!s) { failed(c, 'That step isn’t part of this Mantel’s setup.'); return; }
    c.appendChild(group({ footer: s.detail }, [info('Status', s.optional ? 'Optional' : null, STEP_SAYS[s.state], s.state === 'todo' ? 'warn' : '')]));
    if (s.how && s.state !== 'done') c.appendChild(group({ header: 'How', footer: s.how_note || 'An Owner turns them on in General (Allow Control of the House), after confirming it is them. The server’s kill switch can keep them off whatever that says.' }, [secretCell(s.how, 'mx-setup-how')]));
    const rows = [];
    if (s.route) rows.push(K().nav({ label: s.state === 'done' ? 'Open' : 'Do It Now', href: s.route, fk: 'mx:setup:go:' + id }));
    const edit = got.data.can_edit;
    if (edit && s.can_confirm && s.state !== 'done') rows.push(button('Looks Right', () => setStep(id, 'confirmed', 'Marked done.'), { fk: 'mx:setup:ok:' + id }));
    if (edit && s.can_confirm && s.state === 'done' && id !== 'screens') rows.push(button('Not Done Yet', () => setStep(id, null, 'Back on the list.'), { fk: 'mx:setup:undo:' + id }));
    if (edit && s.can_skip && s.state === 'todo') rows.push(button('Later', () => setStep(id, 'skipped', 'Left for later.'), { fk: 'mx:setup:skip:' + id }));
    if (edit && s.state === 'skipped') rows.push(button('Put Back on the List', () => setStep(id, null, 'Back on the list.'), { fk: 'mx:setup:unskip:' + id }));
    if (rows.length) c.appendChild(group({}, rows));
  } };
}
// SCREENS: HK Frontend's, imported once, or the generated Home screen, opened and judged
function pSetupScreens() {
  const back = ['Set Up Mantel', '#/' + ROUTE + '/setup'];
  return { title: 'Screens', back, body(c) {
    result(c, 'setup');
    const got = setupRead();
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const s = got.data.steps.find((x) => x.id === 'screens') || {};
    const edit = got.data.can_edit;
    c.appendChild(group({ footer: s.detail }, [info('Status', null, STEP_SAYS[s.state] || '', s.state === 'todo' ? 'warn' : '')]));
    if (s.imported) {
      c.appendChild(group({}, [K().nav({ label: 'Open the Home Screen', href: mantelUrl('/home'), icon: 'mdi:open-in-new', fk: 'mx:setup:home' })]));
      return;
    }
    const rows = [K().nav({ label: 'Open the Home Screen', sub: 'In this browser; come back here afterwards', href: mantelUrl('/home'), icon: 'mdi:open-in-new', fk: 'mx:setup:home' })];
    if (edit && s.state !== 'done') rows.push(button('It Looks Right', () => setStep('screens', 'confirmed', 'Marked done.'), { fk: 'mx:setup:ok:screens' }));
    c.appendChild(group({ header: 'The Generated Home Screen', footer: 'It builds itself from Home Assistant’s areas and devices, and follows them as they change. ' +
      'Rooms with nothing in them stay off it. Name and arrange your areas in Home Assistant, or fine-tune the screen in its own settings under Screens.' }, rows));
    if (s.hk_frontend && ['owner', 'admin'].includes(me.user.role)) drawImport(c, true);
  } };
}
