// settings/backups.js -- Mantel Settings, Backups (backup.py, 2026-10-28): when the last one was made, Back Up Now,
// the backups to download, the two keys as one file, and Restore -- an upload checked first, put in place when
// Mantel starts again. Owners and Admins see it; only the Owner acts.
// @ts-check
import { mantelUrl } from '../base.js';
import { act, api, ApiError, ask, forget, hh, K, kb, load, me, redraw, ROUTE, ui } from './core.js';
import { button, failed, group, info, pending, result } from './kit.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');
const ago = (t) => {
  const d = (Date.now() / 1000 - t) / 86400;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : Math.floor(d) + ' days ago';
};
// what a backup holds, as people count it (backup.py _contents): "8 people · 10 screens · 241 photos · …"
export function holds(ct) {
  if (!ct) return '';
  const n = (v, one, many) => v + ' ' + (v === 1 ? one : many);
  const parts = [n(ct.people || 0, 'person', 'people'), n(ct.screens || 0, 'screen', 'screens'),
                 n(ct.tablets || 0, 'wall tablet', 'wall tablets'), n(ct.photos || 0, 'photo', 'photos')];
  if (ct.files) parts.push(n(ct.files, 'file', 'files') + ' (' + kb(ct.files_size || 0) + ')');
  return parts.join(' · ');
}
// a file the browser saves: a link it follows, or what the page made itself
function save(href, name) {
  const a = hh('a', { href, download: name || '' });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function pBackups() {
  const owner = me.user.role === 'owner';
  return { title: 'Backups', top: true,
    scope: 'An encrypted copy of everything Mantel keeps: people, screens and settings, wall tablets, the audit log, your files and photos, and its saved connections.',
  body(c) {
    result(c, 'backups');
    const got = load('backups', () => api('GET', '/api/backup'));
    if (!got) return pending(c);
    if (got.err) return failed(c, got.err);
    const b = got.data, st = b.status || {};
    if (b.restored) {
      c.appendChild(group({}, [info(b.restored.ok ? 'Restored' : 'The Restore Didn’t Work',
        b.restored.ok ? 'The backup of ' + when(b.restored.created) + ' was put in place when Mantel started' +
          (b.restored.contents ? ': ' + holds(b.restored.contents) : '') + '. What was here before is kept aside in the data folder.'
          : (b.restored.error || 'Mantel started with its data as it was.'), null, b.restored.ok ? '' : 'warn')]));
      if (b.restored.ok && b.restored.control_off) c.appendChild(group({}, [info('Control of the House Is Off',
        'It was on in the backup. Turn it on in General when you are ready: Mantel asks you to sign in again first.', null, 'warn')]));
    }
    // ---- the state
    const last = b.backups[0];
    const rows = [info('Last Backup', st.last_error ? 'The last try failed: ' + st.last_error : null,
      last ? when(last.created) : 'None Yet', st.last_error ? 'warn' : '')];
    rows.push(info('Made', b.nightly ? 'Every night at ' + b.time + ', in the house’s time zone, and with Back Up Now' : 'With Back Up Now',
      null));
    rows.push(info('Kept In', b.local ? 'Mantel’s data folder. Download them to keep a copy off this machine.' : b.target, null));
    if (owner) {
      rows.push(button('Back Up Now', () => act('backups', () => api('POST', '/api/backup/run'), 'Backup made.', 'backups'),
        { fk: 'mx:backup-run' }));
    }
    const keep = 'Mantel keeps the newest backup of each of the last ' + b.keep_daily + ' days and ' + b.keep_weekly + ' weeks.';
    c.appendChild(group({ header: 'Latest', footer: !b.local ? keep : b.ha_app
      ?
        'Home Assistant’s own backups already include Mantel (Settings → System → Backups). These are Mantel’s own copies, to download or to move to another Mantel, and aren’t added to Home ' +
        'Assistant’s backups. ' + keep
      : 'No backup folder is set, so nothing is backed up at night: give Mantel one to back up nightly (see Backups in the guide). ' + keep }, rows));
    // ---- the list
    if (b.backups.length) {
      c.appendChild(group({ header: 'Saved Backups' }, b.backups.map((x) => {
        const cell = info(when(x.created), kb(x.size), null);
        if (!owner) return cell;
        const acts = hh('span', { class: 'mxbk' }, [
          hh('button', { type: 'button', class: 'mxlink', text: 'Download', 'data-fk': 'mx:backup-dl:' + x.name,
                         onclick: () => save(mantelUrl('/api/backup/files/' + encodeURIComponent(x.name)), x.name) }),
          hh('button', { type: 'button', class: 'mxlink red', text: 'Delete', 'data-fk': 'mx:backup-rm:' + x.name,
                         onclick: async () => {
                           if (!(await ask({ title: 'Delete this backup?', message: 'The backup of ' + when(x.created) + ' is deleted from Mantel. A copy you downloaded is not affected.',
                             ok: 'Delete', destructive: true }))) return;
                           act('backups', () => api('DELETE', '/api/backup/files/' + encodeURIComponent(x.name)), 'Backup deleted.', 'backups');
                         } })]);
        cell.appendChild(acts);
        return cell;
      })));
    }
    // ---- the Timeline's pictures (docs/phase19/HOUSE-TIMELINE.md "Backup and restore"): off by default
    if (b.timeline) {
      c.appendChild(group({ footer: 'The Timeline’s rows are always in a backup. Its pictures (up to the budget set in Timeline, 30 days old and replaceable) are added only with this on.' },
        [K().toggle({ label: 'Include Timeline Pictures', on: !!b.timeline_pictures, fk: 'mx:backup-timeline',
          disabled: !owner,
          onChange: (on) => act('backups', () => api('PUT', '/api/timeline/settings', { backup_pictures: on }),
            on ? 'Timeline pictures will be in the next backup.' : 'Timeline pictures are left out of backups.', 'backups') })]));
    }
    if (!owner) {
      c.appendChild(group({ footer: 'Only the Owner makes, downloads and restores backups.' }, []));
      return;
    }
    // ---- the keys
    c.appendChild(
      group(
      { header: 'Keys',
      footer:
      'A backup is locked with Mantel’s backup key, and some values inside it (authenticator codes, saved connections) with its at-rest key. Neither is in the backup. Save both as one small file, ' +
      'and keep it apart from the backups, for example in your password manager: without it a backup can only be restored on this Mantel.' },
      [info('Backup Key', null, b.key_present ? 'Made' : 'Made With the First Backup'),
       button('Save Keys…', async () => {
         const k = await act('backups', () => api('GET', '/api/backup/keys'), null);
         if (!k || typeof k !== 'object') return;
         const blob = new Blob([JSON.stringify(k, null, 2) + '\n'], { type: 'application/json' });
         const url = URL.createObjectURL(blob);
         save(url, 'mantel-keys.json');
         setTimeout(() => URL.revokeObjectURL(url), 5000);
         ui.flash = { key: 'backups', text: 'Keys saved as mantel-keys.json. Keep it somewhere safe.' };
         redraw();
       }, { fk: 'mx:backup-keys' })]));
    // ---- restore
    drawRestore(c, b);
  } };
}

// a backup on its way up, then being checked: the Restore group says how far it is (ui.backupUpload)
function drawUpload(c, up) {
  const pct = up.total ? Math.min(100, Math.floor((up.sent / up.total) * 100)) : 0;
  const rows = up.phase === 'upload'
    ? [info('Uploading ' + up.name, pct + '% · ' + kb(up.sent) + ' of ' + kb(up.total), null),
       hh('div', { class: 'cell mxbar' }, [hh('progress', { max: String(up.total || 1), value: String(up.sent), 'aria-label': 'Upload progress' })])]
    : [info('Checking the Backup…', 'Opening it and checking its database and files against this version of Mantel. A large backup takes a minute or two; nothing changes yet.', null)];
  c.appendChild(group({ header: 'Restore', footer: up.phase === 'upload'
    ? 'Keep this page open until the upload is done. Through your own proxy, a large backup needs its upload limit raised (in Nginx Proxy Manager: client_max_body_size 4g;).'
    : 'Next you see what the backup holds, and restore it or cancel.' }, rows));
}

function drawRestore(c, b) {
  if (ui.backupUpload) return drawUpload(c, ui.backupUpload);
  const p = b.pending;
  if (p) {
    const what = `Made ${when(p.created)} · ${p.contents ? holds(p.contents) : p.tables + ' tables, ' + p.rows + ' rows, ' + p.files + ' files'} · ${kb(p.size)}` +
      (p.migrated && p.migrated.length ? ' · brought up to this version of Mantel' : '') + (p.other_keys ? ' · with another Mantel’s keys' : '');
    // (a restore never turns control of the house on by itself: backup.py _control_off)
    const control = p.control_was_on ? ' Allow Control of the House was on in this backup: it stays off after the restore, until you turn it on in General.' : '';
    c.appendChild(
      group(
      { header: 'Restore',
      footer:
      'Mantel restarts to put it in place; screens and wall tablets reconnect by themselves within a minute. What is here now is moved aside in the data folder, not deleted. You may need to sign ' +
      'in again.' }, [
      info('Checked and Ready', what, null),
      button('Restore and Restart…', async () => {
        if (!(await ask({ title: 'Restore this backup?', message: 'Everything Mantel keeps goes back to how it was on ' + when(p.created) + '. Mantel restarts now.' + control, ok: 'Restore',
          destructive: true }))) return;
        if (await act('backups', () => api('POST', '/api/backup/restore'), 'Restoring. Mantel is restarting…')) waitForRestart();
      }, { destructive: true, fk: 'mx:backup-restore' }),
      button('Cancel', () => act('backups', () => api('DELETE', '/api/backup/restore'), 'Restore canceled.', 'backups'), { fk: 'mx:backup-cancel' })]));
    return;
  }
  const file = hh('input', { type: 'file', accept: '.mbk', class: 'mxfile', 'aria-label': 'Choose a backup', 'data-fk': 'mx:backup-file' });
  const keys = hh('input', { type: 'file', accept: '.json', class: 'mxfile', 'aria-label': 'Choose a keys file', 'data-fk': 'mx:backup-keysfile' });
  const chosen = { keys: null };
  const send = () => {
    if (!file.files.length) return;
    const f = file.files[0];
    const fd = new FormData();
    fd.append('file', f, f.name);
    if (chosen.keys) fd.append('keys', chosen.keys, chosen.keys.name);
    const up = ui.backupUpload = { phase: 'upload', sent: 0, total: f.size, name: f.name };
    let drawn = 0;
    const onProgress = (sent, total) => {
      if (sent === null) up.phase = 'check';
      else { up.sent = sent; up.total = total; }
      const now = Date.now();
      if (sent === null || now - drawn > 250) { drawn = now; redraw(); }
    };
    redraw();
    act('backups', async () => {
      try {
        return await api('POST', '/api/backup/restore/upload', fd, { onProgress });
      } catch (e) {
        // a proxy that refuses a large upload answers 413, or drops it: say where the limit is
        if (e instanceof ApiError && (e.status === 413 || (e.status === 0 && up.phase === 'upload'))) {
          throw new ApiError(e.status, { message: 'The backup didn’t reach Mantel' + (e.status === 413 ? ' (too large for the way in)' : '') +
            '. Through your own proxy, raise its upload limit (in Nginx Proxy Manager, Advanced: client_max_body_size 4g;), or open Mantel by its address on your network and restore there.' });
        }
        throw e;
      }
    }, 'Backup checked. Restore it below, or cancel.', 'backups')
      .finally(() => { ui.backupUpload = null; file.value = ''; redraw(); });
  };
  file.addEventListener('change', send);
  keys.addEventListener('change', () => {
    chosen.keys = keys.files[0] || null;
    if (chosen.keys) { ui.flash = { key: 'backups', text: 'Keys file chosen: now choose the backup.' }; redraw(); file.click(); }
  });
  const g = group({ header: 'Restore', footer: 'Choose a backup (.mbk) to check it first; nothing changes until you restore it. A backup from another Mantel also needs that Mantel’s keys file.' }, [
    button('Restore From a Backup…', () => file.click(), { fk: 'mx:backup-upload' }),
    button('Restore From Another Mantel…', () => keys.click(), { fk: 'mx:backup-upload-other' })]);
  g.appendChild(file);
  g.appendChild(keys);
  c.appendChild(g);
}

// back once Mantel answers again (the App's restart takes a little longer)
function waitForRestart() {
  let tries = 0;
  const poll = async () => {
    tries++;
    try {
      const r = await fetch(mantelUrl('/healthz'), { cache: 'no-store' });
      if (r.ok && tries > 3) { forget('backups'); location.reload(); return; }
    } catch (e) { /* still restarting */ }
    if (tries < 120) setTimeout(poll, 2000);
  };
  setTimeout(poll, 3000);
}
export const backupsRoute = ROUTE + '/backups';
