// settings/tablet-release.js -- Mantel Settings, Wall Tablets: a new version of Mantel for Android uploaded here and
// sent to the tablets, one test tablet first (apps/android.py). The owner, 2026-11-14: "allow a user to download the apk
// and then push it ... pick one to test first, and then if that one succeeds, proceed to upgrading the rest ... with
// information on failure".
// @ts-check
import { act, api, ask, forget, hh, K, load, redraw } from './core.js';
import { button, group, info, result } from './kit.js';

const KEY = 'android-release';
const read = () => load(KEY, () => api('GET', '/api/apps/android'));
const chosen = { test: '' };     // the test tablet picked, until it starts
let polling = 0;                 // a timer while an update is going out: the page reads it again every few seconds

const STATE = { sent: 'Asked', installing: 'Installing', waiting: 'Waiting for a Tap', updated: 'Updated',
                failed: 'Failed', offline: 'Not Connected' };

function stageSays(r) {
  const test = (r.tablets || []).find((t) => t.id === r.test);
  const failed = (r.tablets || []).filter((t) => t.state === 'failed').length;
  switch (r.stage) {
    case 'ready': return 'Ready to Test';
    case 'testing': return 'Testing on ' + (test ? test.name : 'the Test Tablet');
    case 'rolling': return 'Updating the Other Tablets';
    case 'done': return failed ? 'Done, ' + failed + ' Failed' : 'Done';
    case 'failed': return 'Failed on ' + (test ? test.name : 'the Test Tablet');
    case 'stopped': return 'Stopped';
    default: return '';
  }
}

function send(body, okText) {
  return act(KEY, () => api('POST', '/api/apps/android/rollout', body), okText, KEY);
}

function uploadRow(c) {
  const input = hh('input', { type: 'file', accept: '.apk,application/vnd.android.package-archive', class: 'mxfile',
                              'aria-label': 'Choose the app’s APK', 'data-fk': 'mx:android-apk' });
  input.addEventListener('change', () => {
    if (!input.files || !input.files.length) return;
    const fd = new FormData();
    fd.append('file', input.files[0], input.files[0].name);
    act(KEY, () => api('POST', '/api/apps/android/upload', fd), 'Uploaded. Choose a tablet to test it on.', KEY);
  });
  c.appendChild(input);
  return button('Upload a New Version…', () => input.click(), { fk: 'mx:android-upload' });
}

export function drawAppRelease(c) {
  const got = read();
  if (!got || got.err || !got.data) return;
  const r = got.data;
  if (!r.served && !r.candidate && !(r.apps || []).length) return;
  const going = r.stage === 'testing' || r.stage === 'rolling';
  clearTimeout(polling);
  if (going) polling = setTimeout(() => { forget(KEY); redraw(); }, 4000);
  const cand = r.candidate;
  const newer = cand && (!r.served || cand.version_code > r.served.version_code || r.stage === 'rolling');
  const rows = [info('On the Tablets', null, r.served ? r.served.version_name : 'None Yet')];
  if (cand && r.stage !== 'done' && (newer || going)) rows.push(info('New Version', null, cand.version_name));
  if (r.stage && r.stage !== 'done' && cand) rows.push(info('Update', null, stageSays(r), r.stage === 'failed' ? 'mxerr' : ''));
  else if (r.stage === 'done') rows.push(info('Update', 'to ' + cand.version_name, stageSays(r)));
  for (const t of r.tablets || []) {
    const sub = [t.id === r.test ? 'Test tablet' : null, t.from ? 'was ' + t.from : null, t.message || null].filter(Boolean).join(' · ');
    rows.push(info(t.name, sub || null, STATE[t.state] || t.state, t.state === 'failed' ? 'mxerr' : ''));
  }
  const g = group({ header: 'Mantel for Android Updates' }, rows);
  c.appendChild(g);

  const acts = [];
  if (going) {
    acts.push(button('Stop the Update', async () => {
      if (!(await ask({ title: 'Stop the update?', message: 'Tablets not updated yet stay on ' + (r.served ? r.served.version_name : 'their version')
        + '. One already updated keeps the new version.', ok: 'Stop', destructive: true }))) return;
      send({ action: 'stop' }, 'Stopped.');
    }, { destructive: true, fk: 'mx:android-stop' }));
  } else {
    const can = newer && r.stage !== 'done';
    if (can) {
      const apps = (r.apps || []).filter((a) => a.connected && (a.version_code || 0) < cand.version_code);
      if (!apps.some((a) => a.id === chosen.test)) chosen.test = apps.length ? apps[0].id : '';
      if (apps.length) {
        acts.push(K().select({ label: 'Test Tablet', fk: 'mx:android-test', value: chosen.test,
                               options: apps.map((a) => [a.id, a.name + (a.version ? ' (' + a.version + ')' : '')]),
                               onChange: (v) => { chosen.test = v; redraw(); } }));
        const pick = apps.find((a) => a.id === chosen.test);
        acts.push(button((r.stage === 'failed' || r.stage === 'stopped' ? 'Try Again on ' : 'Update ') + pick.name + ' First',
                         () => send({ action: 'test', device: pick.id }, 'Sent to ' + pick.name + '.'),
                         { fk: 'mx:android-start', disabled: !r.commands_on }));
      } else acts.push(info('Test Tablet', 'A tablet’s app must be connected to Mantel', 'None Connected'));
      acts.push(button('Discard ' + cand.version_name + '…', async () => {
        if (!(await ask({ title: 'Discard ' + cand.version_name + '?', message: 'No tablet is offered it. You can upload it again.',
          ok: 'Discard', destructive: true }))) return;
        send({ action: 'discard' }, 'Discarded.');
      }, { destructive: true, fk: 'mx:android-discard' }));
    }
    acts.push(uploadRow(c));
    acts.push(button('Download from GitHub', () => window.open(r.download, '_blank', 'noopener'), { fk: 'mx:android-download' }));
  }
  const wait = r.wait_minutes || 10;
  c.appendChild(group({ footer: 'Download the newest Mantel for Android (the APK) from its releases on GitHub and upload it '
    + 'here. Mantel checks it’s the same app, newer than the tablets’ and signed by the same key. It installs on the test '
    + 'tablet first; once that tablet is back on the new version, every other tablet updates. A tablet that’s off takes it '
    + 'within an hour of coming back. A tablet not back on the new version within ' + wait + ' minutes has failed, and '
    + 'the reason is shown.' + (r.commands_on ? '' : ' Commands are off on this Mantel, so no tablet can be asked now.') }, acts));
  result(c, KEY);
}
