// settings/files.js -- Mantel Settings, Your Files: the font and icon set, and Photos (mantel-photos.js) with the toolkit it draws with.
// @ts-check
import { mantelUrl } from '../base.js';
import * as photos from '../mantel-photos.js';
import { act, api, ask, can, csrfNow, forget, hh, K, kb, load, panel, redraw, refreshMe, ROUTE, ui } from './core.js';
import { button, choose, draft, failed, field, group, holdFocus, info, nav, pending, result } from './kit.js';

// ============================================================================================ Your files
const ASSET_SLOTS = [
  { id: 'woff2', label: 'SF Pro (woff2)', hint: 'SF-Pro.woff2, the font every screen uses.', accept: '.woff2', kind: 'font', name: 'SF-Pro.woff2' },
  { id: 'ttf', label: 'SF Pro (ttf)', hint: 'SF-Pro.ttf, only needed if you have no woff2.', accept: '.ttf', kind: 'font', name: 'SF-Pro.ttf' },
  { id: 'glyphs', label: 'HK Glyphs', hint: 'hk-glyphs.js, the SF Symbols icon set.', accept: '.js,.json', kind: 'glyphs', name: 'hk-glyphs.js' },
];
export function pFiles(sub) {
  if (sub[0] === 'photos' && can('photos')) return photos.page(sub.slice(1), photoTools);
  return { title: 'Your Files', top: true, scope: 'Your home’s own files, kept in Mantel’s data and its encrypted backups: the screensavers’ photos, and Apple’s font and glyphs.', body(c) {
    result(c, 'files');
    if (can('photos')) {
      c.appendChild(group({ header: 'Photos', footer: 'Albums of photos for the screensavers: upload them here, then pick an album on a screen’s Screensaver Options, or for every screen on All Screens → Screensaver.' },
        [photos.filesRow(photoTools)]));
    }
    const got = load('files', () => api('GET', '/api/user-files'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const inf = got.data;
    const have = { woff2: inf.fonts.find((f) => f.name === 'SF-Pro.woff2'), ttf: inf.fonts.find((f) => f.name === 'SF-Pro.ttf'),
                   glyphs: inf.glyphs.present ? { size: inf.glyphs.size } : null };
    ASSET_SLOTS.forEach((slot, i) => {
      const cur = have[slot.id];
      const input = hh('input', { type: 'file', accept: slot.accept, class: 'mxfile', 'aria-label': 'Choose ' + slot.label, 'data-fk': 'mx:file-' + slot.id });
      input.addEventListener('change', () => {
        if (!input.files.length) return;
        const fd = new FormData();
        fd.append('name', slot.name);
        fd.append('file', input.files[0], input.files[0].name);
        act('files', () => api('POST', '/api/user-files/' + slot.kind, fd), slot.label + ' saved.', 'files');
      });
      const rows = [info(slot.label, slot.hint, cur ? 'In Place · ' + kb(cur.size) : 'Missing', cur ? '' : 'warn'),
        button((cur ? 'Replace ' : 'Upload ') + slot.label + '…', () => input.click(), { fk: 'mx:upload-' + slot.id })];
      if (cur) rows.push(button('Remove ' + slot.label + '…', async () => {
        if (!(await ask({ title: 'Remove ' + slot.label + '?', message: 'Screens fall back to the system font or plain icons until you add it again.', ok: 'Remove', destructive: true }))) return;
        act('files', () => api('DELETE', '/api/user-files/' + slot.kind + '/' + slot.name), slot.label + ' removed.', 'files');
      }, { destructive: true, fk: 'mx:remove-' + slot.id }));
      const g = group(i ? {} : { header: 'Font and Glyphs' }, rows);
      g.appendChild(input);
      c.appendChild(g);
    });
    c.appendChild(group({ footer: 'SF Pro and the SF Symbols glyph set are Apple’s, so they can’t ship with Mantel: each home adds its own copy once. ' +
      `Used ${kb(inf.usage)} of ${kb(inf.quota)}. They are kept in Mantel’s data, included in its encrypted backups, and nothing here is ever run as code. ` +
      'On a Home Assistant install they are under /config/www/hk (fonts/ and iconset/). From the command line: mantel files import-assets <folder>.' }, []));
  } };
}

// Photos (mantel-photos.js) draws with this page's own helpers
export const photoTools = {
  K, hh, api, act, load, forget, redraw, ask, group, info, button, nav, result, pending, failed, field, choose, draft,
  mantelUrl, csrfNow, refreshMe, ROUTE, panel: () => panel, holdFocus,
  setFlash: (key, text, err) => { ui.flash = { key, text, err: !!err }; },
};
