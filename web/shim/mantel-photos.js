// mantel-photos.js -- Mantel Settings → Your Files → Photos: the screensavers' own photo library (photos.py,
// docs/phase4/PHOTOS.md), drawn with HK Settings' kit like every Mantel page (iOS Settings, with an iOS
// Photos grid). Owners and Admins: albums, a grid of thumbnails with a preview, select to delete or move,
// uploads (many files, or dropped on the page) with each file's progress; an Owner also sets the limits and
// copies a Home Assistant media folder in. It lives under Your Files (SECTION; the old #/mantel/photos forwards
// there). A screen picks an album on its Screensaver Options page, All Screens on its Screensaver page (extend),
// and either can make a New Album and Add Photos to it right there. Only Mantel loads this file (web/shim).
//
// mantel-settings.js hands each call its toolkit `T` (the kit, the REST helper, the page's cache and
// flash), so this module keeps only the photos' own state: the selection, the uploads, the import's poll.

const ALBUM_ID = /^[0-9a-f]{16}$/;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp';
const PHOTO_NAME = /\.(jpe?g|png|webp|heic|heif)$/i;
const PARALLEL = 3;                        // uploads at once
const CHANGED_KEY = 'mantel-photos-changed';   // mantel-shell.js listens (the storage event): screens and previews
const QUOTAS = [1024, 2048, 4096, 8192, 16384, 32768, 65536];
const FILE_CAPS = [10, 20, 40, 80, 200];

export const STYLE = [
  '.cell.mxalbum{gap:12px}',
  '.mxcover{flex:none;width:44px;height:44px;border-radius:6px;object-fit:cover;background:var(--hk-fill)}',
  '.mxcover.none{display:flex;align-items:center;justify-content:center;color:var(--hk-label3)}',
  '.cell + .cell.mxalbum::before{left:72px}',
  '.mxbar{position:relative;height:6px;border-radius:3px;background:var(--hk-fill);overflow:hidden;flex:1 1 100%}',
  '.mxbar > i{position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--hk-tint);transition:width .2s}',
  '.mxbar.full > i{background:var(--hk-orange)}',
  '.cell.mxuse{flex-wrap:wrap;row-gap:8px;padding-bottom:12px}',
  '.mxdrop{position:relative;border-radius:10px;transition:box-shadow .15s}',
  '.mxdrop.over{box-shadow:0 0 0 3px var(--hk-tint)}',
  '.mxgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:2px;border-radius:10px;overflow:hidden;background:var(--hk-cell)}',
  '@media (max-width:520px){.mxgrid{grid-template-columns:repeat(4,1fr)}}',
  '@media (max-width:380px){.mxgrid{grid-template-columns:repeat(3,1fr)}}',
  '.mxph{position:relative;aspect-ratio:1;padding:0;border:0;margin:0;background:var(--hk-fill);cursor:pointer;overflow:hidden}',
  '.mxph img{display:block;width:100%;height:100%;object-fit:cover}',
  '.mxph .ck{position:absolute;right:6px;bottom:6px;width:22px;height:22px;border-radius:50%;border:1.5px solid #fff;',
  '  background:rgba(0,0,0,.18);box-shadow:0 0 2px rgba(0,0,0,.4);display:none}',
  '.mxgrid.sel .mxph .ck{display:block}',
  '.mxph[aria-pressed="true"] .ck{background:var(--hk-tint)}',
  '.mxph[aria-pressed="true"] .ck::after{content:"";position:absolute;left:7px;top:3px;width:5px;height:10px;border:solid #fff;',
  '  border-width:0 2px 2px 0;transform:rotate(45deg)}',
  '.mxph[aria-pressed="true"] img{opacity:.75}',
  '.mxempty{padding:40px 16px;text-align:center;color:var(--hk-label2);font-size:15px;line-height:20px;background:var(--hk-cell);',
  '  border-radius:10px;border:2px dashed var(--hk-sep)}',
  '.cell.mxup{flex-wrap:wrap;row-gap:6px}',
  '.cell.mxup .lbl small.err{color:var(--hk-red)}',
  '.cell.mxup .mxbar{height:4px}',
  '.mxview{position:fixed;inset:0;z-index:20;background:#000;display:flex;flex-direction:column;color:#fff}',
  '.mxview .top,.mxview .bot{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;font-size:15px}',
  '.mxview .top .t{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}',
  '.mxview .bot{justify-content:space-between;color:rgba(255,255,255,.7);font-size:13px}',
  '.mxview .pic{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}',
  '.mxview .pic img{max-width:100%;max-height:100%;object-fit:contain}',
  '.mxview button{border:0;background:none;color:#fff;font:inherit;font-size:17px;padding:8px 10px;border-radius:8px;cursor:pointer}',
  '.mxview button:focus-visible{outline:2px solid #fff}',
  '.mxview button.red{color:#ff453a}',
  '.mxview .nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:64px;font-size:32px;background:rgba(0,0,0,.25)}',
  '.mxview .nav.prev{left:8px}.mxview .nav.next{right:8px}',
  '.mxview .nav[disabled]{opacity:.25;cursor:default}',
  '.mxdlg .mxin.mxname{letter-spacing:normal;text-align:left}',
].join('\n');

// ---------------------------------------------------------------------------------------- state
let T = null;                 // the toolkit of the call being drawn
let selecting = false;
const selected = new Set();
let selAlbum = null;          // the album the selection belongs to
const uploads = [];           // { key, file, name, size, album, state, pct, msg }
let active = 0;
let upSeq = 0;
let importTimer = null;
let importJob = undefined;    // the import as last read (undefined: not read yet)
let viewer = null;            // the preview: { el, list, i, album }
let dropAlbum = null;         // the album page now drawn (where a dropped file goes)

const K = () => T.K();
const hh = (tag, attrs, kids) => T.hh(tag, attrs, kids);
const thumb = (id) => T.mantelUrl('/api/photos/' + id + '/thumb');
const screenUrl = (id) => T.mantelUrl('/api/photos/' + id + '/screen');
const plural = (n, one, many) => n.toLocaleString() + ' ' + (n === 1 ? one : many || one + 's');
function size(n) {
  const G = 2 ** 30, M = 2 ** 20;           // (not 10 << 30: that overflows to a negative)
  if (n >= G) return (n / G).toFixed(n >= 10 * G ? 0 : 1) + ' GB';
  if (n >= M) return (n / M).toFixed(n >= 100 * M ? 0 : 1) + ' MB';
  return (n ? Math.max(1, Math.round(n / 1024)) : 0) + ' KB';
}
const mb = (m) => (m >= 1024 ? (m / 1024).toLocaleString() + ' GB' : m + ' MB');
// the screens and previews in this browser hear of it (mantel-shell.js); tablets list again on their own
function changed() {
  try { window.localStorage.setItem(CHANGED_KEY, String(Date.now())); } catch (e) { /* private mode */ }
}
function overview() { return T.load('photos', () => T.api('GET', '/api/photos')); }
export const SECTION = 'files/photos';              // under Your Files (mantel-settings.js pFiles)
const home = () => '#/' + T.ROUTE + '/' + SECTION;
const albumPath = (id) => home() + '/' + id;

// A NAME, asked in HK Settings' own alert (the kit's .dlg) with a field
function askName(o) {
  const root = T.panel().shadowRoot;
  return new Promise((resolve) => {
    const input = hh('input', { class: 'mxin mxname', maxlength: 60, autocomplete: 'off', 'aria-label': o.label || 'Name' });
    input.value = o.value || '';
    const cancel = hh('button', { type: 'button', class: 'cx', text: 'Cancel' });
    const ok = hh('button', { type: 'button', class: 'bold', text: o.ok || 'Save' });
    const dlg = hh('div', { class: 'dlg mxdlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title },
      [hh('h2', { text: o.title }), o.message ? hh('p', { text: o.message }) : null, input, hh('div', { class: 'db' }, [cancel, ok])]);
    const bd = hh('div', { class: 'dlgbd' }, dlg);
    const close = (v) => { bd.remove(); resolve(v); };
    cancel.addEventListener('click', () => close(null));
    ok.addEventListener('click', () => close(input.value.trim() || null));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value.trim() || null); });
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } });
    root.appendChild(bd);
    input.focus();
    input.select();
  });
}

// ============================================================================================ the library
export function page(sub, tools) {
  T = tools;
  wireDrop();
  if (ALBUM_ID.test(sub[0] || '')) return albumPage(sub[0]);
  dropAlbum = null;
  return { title: 'Photos', back: ['Your Files', '#/' + T.ROUTE + '/files'],
    scope: 'The screensavers’ own photos. Put them in albums here; each screen shows the album you pick on its Screensaver Options.',
    body(c) {
      T.result(c, 'photos');
      const got = overview();
      if (!got) { T.pending(c); return; }
      if (got.err) { T.failed(c, got.err); return; }
      const d = got.data;
      if (importJob === undefined) importJob = d.importing;
      drawAlbums(c, d);
      drawStorage(c, d);
      drawImport(c, d);
    } };
}

function drawAlbums(c, d) {
  const used = {};
  for (const a of Object.values(d.screens || {})) used[a] = (used[a] || 0) + 1;
  const rows = d.albums.map((a) => {
    const row = K().nav({ label: a.name, href: albumPath(a.id), fk: 'mx:album:' + a.id,
      sub: plural(a.count, 'photo') + (a.count ? ' · ' + size(a.bytes) : '') + (used[a.id] ? ' · on ' + plural(used[a.id], 'screen') : '') });
    row.classList.add('mxalbum', 'hasic');
    row.insertBefore(a.cover ? hh('img', { class: 'mxcover', src: thumb(a.cover), alt: '', loading: 'lazy' })
      : hh('span', { class: 'mxcover none', 'aria-hidden': 'true' }), row.firstChild);
    return row;
  });
  rows.push(T.button('New Album…', newAlbum, { fk: 'mx:photos-new-album' }));
  c.appendChild(T.group({ header: 'Albums', footer: d.albums.length
    ? 'A screen shows an album from its Screensaver Options; All Screens → Screensaver can show one on every screen. Screens without one keep showing the Home Assistant folder.'
    : 'Make an album, then add photos to it.' }, rows));
}

// a new album, named in an alert: the album, or null (cancelled or refused: the page says why)
async function createAlbum(key) {
  const name = await askName({ title: 'New Album', message: 'A name for it, such as Family or Summer 2026.', ok: 'Create' });
  if (!name) return null;
  const r = await T.act(key || 'photos', () => T.api('POST', '/api/photos/albums', { name }), null, 'photos');
  return (r && r.album) || null;
}
async function newAlbum() {
  const album = await createAlbum('photos');
  if (album) T.panel().go(albumPath(album.id));
  return album;
}

function drawStorage(c, d) {
  const quota = d.limits.quota_mb * (1 << 20);
  const pct = quota ? Math.min(100, (d.usage / quota) * 100) : 0;
  const use = hh('div', { class: 'cell mxuse', 'data-fk': 'mx:photos-usage' }, [
    hh('span', { class: 'lbl' }, [hh('span', { class: 't', text: 'Used' }), hh('small', { text: plural(d.photos, 'photo') })]),
    hh('span', { class: 'val', text: size(d.usage) + ' of ' + mb(d.limits.quota_mb) }),
    hh('div', { class: 'mxbar' + (pct >= 90 ? ' full' : ''), role: 'progressbar', 'aria-label': 'Space used',
                'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct) }, hh('i', { style: 'width:' + pct.toFixed(1) + '%' }))]);
  const rows = [use];
  if (d.owner) {
    const opts = (list, cur, say) => (list.includes(cur) ? list : list.concat([cur]).sort((a, b) => a - b)).map((v) => [String(v), say(v)]);
    rows.push(K().select({ label: 'Space for Photos', sub: 'All the photos together, every size Mantel keeps', fk: 'mx:photos-quota',
      options: opts(QUOTAS, d.limits.quota_mb, mb), value: String(d.limits.quota_mb),
      onChange: (v) => T.act('photos', () => T.api('PUT', '/api/photos/limits', { quota_mb: Number(v) }), 'Saved.', 'photos') }));
    rows.push(K().select({ label: 'Largest Photo', sub: 'One file, as it is uploaded', fk: 'mx:photos-filecap',
      options: opts(FILE_CAPS, d.limits.file_mb, mb), value: String(d.limits.file_mb),
      onChange: (v) => T.act('photos', () => T.api('PUT', '/api/photos/limits', { file_mb: Number(v) }), 'Saved.', 'photos') }));
  }
  const b = d.backup || {};
  const where = b.mantel
    ? 'They are in Mantel’s encrypted backups' + (b.nightly ? ' every night' : '') + (b.home_assistant ? ', and in Home Assistant’s backups of the Mantel App' : '') +
      ': ' + size(d.usage) + ' of photos goes into each.'
    : 'Mantel’s own backups are set to leave files out, so the photos are not in them' + (b.home_assistant ? ' (Home Assistant’s backups of the Mantel App still have them)' : '') + '.';
  c.appendChild(T.group({ header: 'Storage', footer: 'Mantel keeps three sizes of every photo: the original, one sized for a screen, and a thumbnail. ' +
    'Location and camera details are removed when a photo is added. ' + where + (d.owner ? '' : ' Only an Owner changes the limits.') }, rows));
}

// IMPORT FROM HOME ASSISTANT (an Owner's): a media folder's photos copied into an album, in the background
function housePhotos() {
  try {
    const look = window.hkSettings && window.hkSettings.get ? window.hkSettings.get('look', null) : null;
    const p = look && look.photos;
    if (typeof p === 'string' && p.startsWith('media-source://media_source/')) return p;
  } catch (e) { /* no settings here */ }
  return 'media-source://media_source/local/photos';
}
function pollImport() {
  if (importTimer) return;
  importTimer = setTimeout(async () => {
    importTimer = null;
    if (!String(location.hash).startsWith(home())) return;     // left the page: stop asking
    try { importJob = (await T.api('GET', '/api/photos/import')).importing; } catch (e) { /* asked again below */ }
    if (importJob && !['listing', 'copying'].includes(importJob.state)) { T.forget('photos'); changed(); }
    T.redraw();
  }, 1500);
}
function jobLine(j) {
  const parts = [plural(j.imported, 'photo') + ' added'];
  if (j.skipped) parts.push(j.skipped.toLocaleString() + ' already there');
  if (j.failed) parts.push(j.failed.toLocaleString() + ' couldn’t be copied');
  return parts.join(' · ');
}
function drawImport(c, d) {
  if (!d.owner) return;
  const j = importJob;
  const running = j && ['listing', 'copying'].includes(j.state);
  if (running) {
    pollImport();
    const pct = j.found ? Math.min(100, (j.done / j.found) * 100) : 0;
    c.appendChild(T.group({ header: 'Import from Home Assistant', footer: 'Copying from ' + j.source + ' into ' + j.album_name +
      '. You can leave this page; it carries on. Nothing in Home Assistant is changed or deleted.' }, [
      hh('div', { class: 'cell mxuse' }, [
        hh('span', { class: 'lbl' }, [hh('span', { class: 't', text: j.state === 'listing' ? 'Looking for photos…' : 'Copying ' + j.done.toLocaleString() + ' of ' + j.found.toLocaleString() }),
          hh('small', { text: j.state === 'listing' ? plural(j.found, 'photo') + ' found so far' : jobLine(j) })]),
        hh('div', { class: 'mxbar', role: 'progressbar', 'aria-label': 'Import progress', 'aria-valuemin': 0, 'aria-valuemax': 100,
                    'aria-valuenow': Math.round(pct) }, hh('i', { style: 'width:' + pct.toFixed(1) + '%' }))]),
      T.button('Stop Import', () => T.act('photos', () => T.api('DELETE', '/api/photos/import'), 'Import stopped.'), { destructive: true, fk: 'mx:photos-import-stop' })]));
    return;
  }
  const dr = T.draft('photosimport');
  if (dr.source === undefined) dr.source = housePhotos();
  if (!dr.album || !d.albums.some((a) => a.id === dr.album)) dr.album = d.albums.length ? d.albums[0].id : '';
  const rows = [T.field('photosimport', 'source', 'Folder', { placeholder: 'media-source://media_source/local/photos', maxlength: 1000 })];
  if (d.albums.length) {
    rows.push(T.choose('photosimport', 'album', 'Into Album', d.albums.map((a) => [a.id, a.name]), dr.album));
    rows.push(T.button('Copy Photos Into Album', () => {
      const body = { source: (dr.source || '').trim(), album: dr.album };
      return T.act('photos', async () => { importJob = (await T.api('POST', '/api/photos/import', body)).importing; }, null);
    }, { center: true, fk: 'mx:photos-import' }));
  }
  let footer = 'Copies the photos in one of Home Assistant’s media folders (and its folders, three deep) into an album. ' +
    'Photos already in the album are skipped, so it can be run again. Nothing in Home Assistant is changed or deleted.';
  if (!d.albums.length) footer = 'Make an album first. ' + footer;
  c.appendChild(T.group({ header: 'Import from Home Assistant', footer }, rows));
  if (j) {
    const head = j.state === 'done' ? 'Last Import' : j.state === 'cancelled' ? 'Last Import (Stopped)' : 'Last Import (Didn’t Finish)';
    const res = [T.info(j.album_name, jobLine(j) + (j.message ? ' · ' + j.message : ''), j.state === 'done' ? 'Done' : j.state === 'cancelled' ? 'Stopped' : 'Failed',
      j.state === 'done' ? '' : 'warn')];
    for (const e of (j.errors || []).slice(0, 8)) res.push(T.info(e.name, e.why));
    if ((j.errors || []).length > 8) res.push(T.info('And ' + plural(j.errors.length - 8, 'more') + ' not shown'));
    c.appendChild(T.group({ header: head, footer: 'From ' + j.source }, res));
  }
}

// ============================================================================================ an album
function albumPage(aid) {
  dropAlbum = aid;
  if (selAlbum !== aid) { selected.clear(); selecting = false; selAlbum = aid; }
  const ov = overview();
  const known = ov && ov.data ? ov.data.albums.find((a) => a.id === aid) : null;
  return { title: known ? known.name : 'Album', back: ['Photos', home()], body(c) {
    T.result(c, 'album');
    const o = overview();
    const got = T.load('album:' + aid, () => T.api('GET', '/api/photos/albums/' + aid + '/photos'));
    if (!o || !got) { T.pending(c); return; }
    if (o.err || got.err) { T.failed(c, o.err || got.err); return; }
    const d = o.data, list = got.data.photos;
    for (const id of [...selected]) if (!list.some((p) => p.id === id)) selected.delete(id);
    drawActions(c, d, aid, list);
    drawUploads(c, aid);
    drawGrid(c, aid, list);
    if (selecting) drawSelection(c, d, aid, list);
  } };
}

function fileInput(aid) {
  const input = hh('input', { type: 'file', multiple: true, accept: ACCEPT, class: 'mxfile', 'aria-label': 'Choose photos', 'data-fk': 'mx:photos-files' });
  input.addEventListener('change', () => { if (input.files.length) addFiles([...input.files], aid); input.value = ''; });
  return input;
}

function drawActions(c, d, aid, list) {
  const album = d.albums.find((a) => a.id === aid) || { name: 'this album', count: list.length };
  const input = fileInput(aid);
  const rows = [T.button('Add Photos…', () => input.click(), { fk: 'mx:photos-add' })];
  if (list.length) rows.push(T.button(selecting ? 'Done Selecting' : 'Select Photos', () => { selecting = !selecting; if (!selecting) selected.clear(); T.redraw(); }, { fk: 'mx:photos-select' }));
  rows.push(T.button('Rename Album…', async () => {
    const name = await askName({ title: 'Rename Album', value: album.name, ok: 'Rename' });
    if (name && name !== album.name) T.act('album', () => T.api('PATCH', '/api/photos/albums/' + aid, { name }), 'Renamed.', 'photos');
  }, { fk: 'mx:photos-rename' }));
  const screens = Object.keys(d.screens || {}).filter((s) => d.screens[s] === aid);
  rows.push(T.button('Delete Album…', async () => {
    const msg = (list.length ? 'Its ' + plural(list.length, 'photo') + ' are deleted from Mantel for good. ' : '') +
      (screens.length ? plural(screens.length, 'screen') + ' showing it go back to the Home Assistant folder. ' : '') +
      'Nothing in Home Assistant is touched.';
    if (!(await T.ask({ title: 'Delete “' + album.name + '”?', message: msg, ok: 'Delete Album', destructive: true }))) return;
    if (await T.act('photos', () => T.api('DELETE', '/api/photos/albums/' + aid), 'Album deleted.', 'photos', 'album:' + aid)) {
      changed();
      T.panel().go(home());
    }
  }, { destructive: true, fk: 'mx:photos-delete-album' }));
  const g = T.group({ footer: 'JPEG, PNG, WebP or HEIC (iPhone photos), up to ' + mb(d.limits.file_mb) + ' each. Choose many at once, or drop them on this page.' }, rows);
  g.appendChild(input);
  c.appendChild(g);
}

function drawGrid(c, aid, list) {
  const zone = hh('section', { class: 'grp mxdrop', 'aria-label': 'Photos' });
  if (!list.length) {
    zone.appendChild(hh('div', { class: 'mxempty', text: 'No photos yet. Drop photos here, or use Add Photos.' }));
  } else {
    const grid = hh('div', { class: 'mxgrid' + (selecting ? ' sel' : ''), role: 'list' });
    list.forEach((p, i) => {
      const b = hh('button', { type: 'button', class: 'mxph', role: 'listitem', 'data-id': p.id, 'data-fk': 'mx:ph:' + p.id,
        'aria-pressed': selecting ? String(selected.has(p.id)) : null,
        'aria-label': (p.name || 'Photo') + ', ' + p.width + ' by ' + p.height }, [
        hh('img', { src: thumb(p.id), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }), hh('span', { class: 'ck', 'aria-hidden': 'true' })]);
      b.addEventListener('click', () => {
        if (!selecting) { openViewer(list, i, aid); return; }
        if (selected.has(p.id)) selected.delete(p.id); else selected.add(p.id);
        b.setAttribute('aria-pressed', String(selected.has(p.id)));
        paintSelection(list.length);
      });
      grid.appendChild(b);
    });
    zone.appendChild(grid);
    zone.appendChild(hh('p', { class: 'gf', text: plural(list.length, 'photo') + '. ' + (selecting ? 'Tap photos to select them.' : 'Tap one to see it larger.') }));
  }
  c.appendChild(zone);
}

// the selection's count and buttons, painted in place as photos are tapped (no redraw of the grid)
function paintSelection(total) {
  const root = T.panel() && T.panel().shadowRoot;
  if (!root) return;
  const n = selected.size;
  const label = root.querySelector('[data-mx-selcount] .t');
  if (label) label.textContent = n ? plural(n, 'Photo') + ' Selected' : 'No Photos Selected';
  const all = root.querySelector('[data-fk="mx:photos-select-all"] .t');
  if (all) all.textContent = n === total ? 'Select None' : 'Select All';
  for (const fk of ['mx:photos-delete', 'mx:photos-move']) {
    const el = root.querySelector('[data-fk="' + fk + '"]');
    if (!el) continue;
    el.disabled = !n;
    if (el.tagName !== 'SELECT') el.setAttribute('aria-disabled', n ? 'false' : 'true');
  }
  const del = root.querySelector('[data-fk="mx:photos-delete"] .t');
  if (del) del.textContent = n ? 'Delete ' + plural(n, 'Photo') + '…' : 'Delete…';
}

function drawSelection(c, d, aid, list) {
  const n = selected.size;
  const count = T.info(n ? plural(n, 'Photo') + ' Selected' : 'No Photos Selected');
  count.setAttribute('data-mx-selcount', '');
  const others = d.albums.filter((a) => a.id !== aid);
  const rows = [count,
    T.button(n === list.length ? 'Select None' : 'Select All', () => {
      if (selected.size === list.length) selected.clear(); else list.forEach((p) => selected.add(p.id));
      T.redraw();
    }, { fk: 'mx:photos-select-all' })];
  if (others.length) {
    rows.push(K().select({ label: 'Move to Album', fk: 'mx:photos-move', disabled: !n, value: '',
      options: [['', 'Choose…']].concat(others.map((a) => [a.id, a.name])),
      onChange: async (v) => {
        if (!v || !selected.size) return;
        const ids = [...selected];
        const to = others.find((a) => a.id === v);
        const r = await T.act('album', () => T.api('POST', '/api/photos/move', { ids, album: v }), null, 'photos', 'album:' + aid, 'album:' + v);
        if (r) {
          T.setFlash('album', plural(r.moved.length, 'photo') + ' moved to ' + to.name + '.' +
            (r.skipped.length ? ' ' + r.skipped.length.toLocaleString() + (r.skipped.length === 1 ? ' was' : ' were') + ' already there, so stayed here.' : ''));
          selected.clear();
          changed();
          T.redraw();
        }
      } }));
  }
  rows.push(T.button(n ? 'Delete ' + plural(n, 'Photo') + '…' : 'Delete…', async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!(await T.ask({ title: 'Delete ' + plural(ids.length, 'photo') + '?', ok: 'Delete', destructive: true,
      message: 'They are removed from Mantel for good, and from every screen showing this album. Nothing in Home Assistant is touched.' }))) return;
    if (await T.act('album', () => T.api('POST', '/api/photos/delete', { ids }), plural(ids.length, 'photo') + ' deleted.', 'photos', 'album:' + aid)) {
      selected.clear();
      changed();
    }
  }, { destructive: true, disabled: !n, fk: 'mx:photos-delete' }));
  c.appendChild(T.group({ header: 'Selection' }, rows));
}

// ---------------------------------------------------------------------------------------- uploading
function addFiles(files, aid) {
  const ov = overview();
  const cap = ov && ov.data ? ov.data.limits.file_mb * (1 << 20) : Infinity;
  for (const f of files) {
    const u = { key: 'u' + ++upSeq, file: f, name: f.name || 'Photo', size: f.size, album: aid, state: 'waiting', pct: 0, msg: '' };
    if (!PHOTO_NAME.test(u.name) && !/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type || '')) {
      u.state = 'error'; u.msg = 'Not a photo Mantel takes (JPEG, PNG, WebP or HEIC).'; u.file = null;
    } else if (f.size > cap) {
      u.state = 'error'; u.msg = 'Bigger than the ' + mb(ov.data.limits.file_mb) + ' limit.'; u.file = null;
    }
    uploads.push(u);
  }
  pump();
  T.redraw();
}

function pump() {
  while (active < PARALLEL) {
    const u = uploads.find((x) => x.state === 'waiting');
    if (!u) break;
    send(u, false);
  }
}

function send(u, retried) {
  active++;
  u.state = 'sending';
  const fd = new FormData();
  fd.append('file', u.file, u.name);
  const x = new XMLHttpRequest();
  x.open('POST', T.mantelUrl('/api/photos/albums/' + u.album + '/upload'));
  x.setRequestHeader('X-CSRF-Token', T.csrfNow());
  x.setRequestHeader('Accept', 'application/json');
  x.upload.onprogress = (e) => { if (e.lengthComputable) { u.pct = e.loaded / e.total; paintUpload(u); } };
  const finish = async (status, body) => {
    active--;
    if (status === 403 && body && body.error === 'csrf' && !retried) {
      try { await T.refreshMe(); } catch (e) { /* the retry says */ }
      u.state = 'waiting';
      send(u, true);
      return;
    }
    if (status === 201) { u.state = 'done'; u.msg = 'Added'; }
    else if (status === 200 && body && body.duplicate) { u.state = 'dup'; u.msg = 'Already in this album'; }
    else { u.state = 'error'; u.msg = (body && body.message) || (status ? 'Mantel answered ' + status + '.' : 'Couldn’t reach Mantel.'); }
    u.pct = 1;
    u.file = null;
    if (u.state === 'done') changed();
    T.forget('album:' + u.album, 'photos');
    pump();
    T.redraw();
  };
  x.onload = () => { let body = null; try { body = JSON.parse(x.responseText); } catch (e) { body = null; } finish(x.status, body); };
  x.onerror = () => finish(0, null);
  x.send(fd);
}

function paintUpload(u) {
  const root = T.panel() && T.panel().shadowRoot;
  const row = root && root.querySelector('[data-up="' + u.key + '"]');
  if (!row) return;
  const bar = row.querySelector('.mxbar > i');
  if (bar) bar.style.width = (u.pct * 100).toFixed(1) + '%';
  const st = row.querySelector('small');
  if (st) st.textContent = statusText(u);
}
function statusText(u) {
  if (u.state === 'waiting') return 'Waiting · ' + size(u.size);
  if (u.state === 'sending') return u.pct < 1 ? 'Uploading ' + Math.round(u.pct * 100) + '% of ' + size(u.size) : 'Making the screen sizes…';
  return u.msg;
}

function drawUploads(c, aid) {
  const mine = uploads.filter((u) => u.album === aid);
  if (!mine.length) return;
  const busy = mine.some((u) => u.state === 'waiting' || u.state === 'sending');
  const rows = mine.map((u) => {
    const err = u.state === 'error';
    const row = hh('div', { class: 'cell mxup', 'data-up': u.key }, [
      hh('span', { class: 'lbl' }, [hh('span', { class: 't', text: u.name }), hh('small', { class: err ? 'err' : null, text: statusText(u) })]),
      u.state === 'done' ? hh('span', { class: 'val', text: '✓' }) : null,
      busy || u.state === 'sending' ? hh('div', { class: 'mxbar' }, hh('i', { style: 'width:' + (u.pct * 100).toFixed(1) + '%' })) : null]);
    if (err) row.setAttribute('role', 'alert');
    return row;
  });
  const n = (s) => mine.filter((u) => u.state === s).length;
  const sum = [n('done') ? n('done') + ' added' : null, n('dup') ? n('dup') + ' already in this album' : null,
               n('error') ? n('error') + ' couldn’t be added' : null].filter(Boolean).join(', ');
  if (!busy) rows.push(T.button('Clear This List', () => { for (let i = uploads.length - 1; i >= 0; i--) if (uploads[i].album === aid) uploads.splice(i, 1); T.redraw(); }, { fk: 'mx:photos-clear-uploads' }));
  c.appendChild(T.group({ header: busy ? 'Uploading ' + plural(mine.length, 'Photo') : 'Uploaded',
    footer: (busy ? 'Keep this page open until they are done. ' : '') + (sum ? sum.charAt(0).toUpperCase() + sum.slice(1) + '.' : '') }, rows));
}

// DROPPED FILES anywhere on an album's page go into that album (the browser never opens them instead)
let dropWired = false;
function wireDrop() {
  if (dropWired || typeof document === 'undefined') return;
  dropWired = true;
  const onAlbum = () => dropAlbum && String(location.hash).startsWith(albumPath(dropAlbum));
  const zone = () => T && T.panel() && T.panel().shadowRoot && T.panel().shadowRoot.querySelector('.mxdrop');
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!onAlbum() || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const z = zone(); if (z) z.classList.add('over');
  });
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget) return;
    const z = zone(); if (z) z.classList.remove('over');
  });
  document.addEventListener('drop', (e) => {
    if (!onAlbum() || !hasFiles(e)) return;
    e.preventDefault();
    const z = zone(); if (z) z.classList.remove('over');
    if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files], dropAlbum);
  });
}

// ---------------------------------------------------------------------------------------- the preview
function openViewer(list, i, aid) {
  closeViewer();
  const root = T.panel().shadowRoot;
  const el = hh('div', { class: 'mxview', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo', tabindex: '-1' });
  viewer = { el, list, i, album: aid, prev: root.activeElement };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    x0 = null;
  });
  root.appendChild(el);
  paintViewer();
  el.focus();
}
function step(by) {
  if (!viewer) return;
  const j = viewer.i + by;
  if (j < 0 || j >= viewer.list.length) return;
  viewer.i = j;
  paintViewer();
}
function closeViewer() {
  if (!viewer) return;
  viewer.el.remove();
  const prev = viewer.prev;
  viewer = null;
  if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* gone */ } }
}
function paintViewer() {
  const v = viewer, p = v.list[v.i];
  const close = hh('button', { type: 'button', text: 'Done', 'data-fk': 'mx:view-done' });
  close.addEventListener('click', closeViewer);
  const del = hh('button', { type: 'button', class: 'red', text: 'Delete', 'data-fk': 'mx:view-delete' });
  del.addEventListener('click', async () => {
    if (!(await T.ask({ title: 'Delete this photo?', ok: 'Delete', destructive: true,
      message: 'It is removed from Mantel for good, and from every screen showing this album.' }))) return;
    if (await T.act('album', () => T.api('POST', '/api/photos/delete', { ids: [p.id] }), 'Photo deleted.', 'photos', 'album:' + v.album)) {
      changed();
      if (!viewer) return;
      v.list = v.list.filter((q) => q.id !== p.id);
      if (!v.list.length) { closeViewer(); return; }
      v.i = Math.min(v.i, v.list.length - 1);
      paintViewer();
    }
  });
  const prev = hh('button', { type: 'button', class: 'nav prev', 'aria-label': 'Previous photo', text: '‹', disabled: v.i === 0 });
  const next = hh('button', { type: 'button', class: 'nav next', 'aria-label': 'Next photo', text: '›', disabled: v.i === v.list.length - 1 });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  v.el.replaceChildren(
    hh('div', { class: 'top' }, [close, hh('span', { class: 't', text: p.name || 'Photo' }), del]),
    hh('div', { class: 'pic' }, [hh('img', { src: screenUrl(p.id), alt: p.name || 'Photo' }), prev, next]),
    hh('div', { class: 'bot' }, [hh('span', { text: (v.i + 1) + ' of ' + v.list.length }),
      hh('span', { text: p.width + ' × ' + p.height + ' · ' + size(p.bytes) + (p.source === 'ha' ? ' · from Home Assistant' : '') })]));
  // the next one is fetched while this one shows
  if (v.i + 1 < v.list.length) { const im = new Image(); im.src = screenUrl(v.list[v.i + 1].id); }
}

// ============================================================================================ on HK's pages
// Your Files' Photos row (mantel-settings.js pFiles): the library, with how much is in it
export function filesRow(tools) {
  T = tools;
  const got = overview();
  const d = got && got.data;
  return T.K().nav({ label: 'Photos', tile: ['mdi:image-multiple', '#ff2d55'],
    value: d ? plural(d.albums.length, 'album') + ' · ' + plural(d.photos, 'photo') : '', href: home(), fk: 'mx:files-photos' });
}

// A screen's Screensaver Options ('saver'): which album it shows. All Screens' Screensaver ('house-saver'):
// an album for every screen, in place of the Home Assistant folder. Either picker ends with New Album…, which
// makes one and picks it; an album picked has Add Photos… right there, its uploads shown below it.
const NEW = 'new';                    // the pickers' New Album… choice (an album id is 16 hex digits)
export function extend(where, c, ctx, tools) {
  T = tools;
  wireDrop();
  if (where !== 'saver' && where !== 'house-saver') return;
  const got = overview();
  if (!got || got.err) return;
  const d = got.data;
  const named = (id) => d.albums.find((a) => a.id === id);
  const key = where === 'saver' ? 'saver:' + ctx.screen : 'house-saver';
  // New Album…: made, then picked (pick); a cancelled name draws the picker back as it was
  const pickNew = async (pick) => {
    const album = await createAlbum(key);
    if (!album) { T.redraw(); return; }
    if (await pick(album.id)) T.setFlash(key, '“' + album.name + '” made and picked. Add photos to it below.');
    T.forget('photos');
    changed();
    T.redraw();
  };
  // Add Photos… for the album picked: the same bulk upload as the album's page, its progress below the picker
  const adder = (aid) => {
    const a = named(aid);
    if (!a) return null;
    const input = fileInput(aid);
    return { input, button: T.button('Add Photos to ' + a.name + '…', () => input.click(), { fk: 'mx:saver-add' }) };
  };
  if (where === 'saver') {
    const cur = (d.screens || {})[ctx.screen] || '';
    const add = adder(cur);
    const pick = (v) => T.act(key, () => T.api('PUT', '/api/photos/screens/' + encodeURIComponent(ctx.screen), { album: v || null }), null, 'photos');
    const opts = [['', 'Screensaver Photos (All Screens)']].concat(d.albums.map((a) => [a.id, a.name + ' · ' + plural(a.count, 'photo')]),
      [[NEW, 'New Album…']]);
    T.result(c, key);
    const g = T.group({ header: 'Photos', footer: (d.albums.length
      ? 'An album from Mantel Photos (Your Files → Photos) for this screen, or the photos All Screens → Screensaver names.'
      : 'Make an album with New Album…, then add photos to it, to show it on this screen.') +
      (named(cur) && !named(cur).count ? ' This album has no photos yet: the screen shows All Screens’ photos until it has some.' : '') }, [
      K().select({ label: 'Show', fk: 'mx:saver-album', options: opts, value: cur,
        onChange: async (v) => {
          if (v === NEW) { pickNew(pick); return; }
          if (await pick(v)) changed();
        } }),
      add && add.button,
      T.nav('Mantel Photos', SECTION, { value: plural(d.photos, 'photo') })].filter(Boolean));
    if (add) g.appendChild(add.input);
    c.appendChild(g);
    if (named(cur)) drawUploads(c, cur);
    return;
  }
  const m = /^mantel-photos:\/\/([0-9a-f]{16})$/.exec(String(ctx.photos || ''));
  const cur = m ? m[1] : '';
  const opts = [['', 'The Home Assistant Folder (Above)']].concat(d.albums.map((a) => [a.id, a.name]));
  if (m && !named(m[1])) opts.push([m[1], 'An Album That Was Deleted']);
  opts.push([NEW, 'New Album…']);
  const add = adder(cur);
  const pickHouse = async (v) => { await ctx.set(v ? 'mantel-photos://' + v : 'media-source://media_source/local/photos'); changed(); return true; };
  T.result(c, key);
  const g = T.group({ footer: 'An album from Mantel Photos (Your Files → Photos) for every screen, in place of a Home Assistant folder. A screen can still pick its own on its Screensaver Options.' }, [
    K().select({ label: 'Mantel Photos Album', fk: 'mx:house-album', options: opts, value: cur,
      onChange: (v) => (v === NEW ? pickNew(pickHouse) : pickHouse(v)) }),
    add && add.button].filter(Boolean));
  if (add) g.appendChild(add.input);
  c.appendChild(g);
  if (named(cur)) drawUploads(c, cur);
}
export function _reset() {
  selecting = false; selected.clear(); selAlbum = null; uploads.length = 0; active = 0; importJob = undefined;
  if (importTimer) clearTimeout(importTimer);
  importTimer = null; viewer = null; dropAlbum = null;
}
export const _state = { selected, uploads, get selecting() { return selecting; } };
