// settings/tablets.js -- Mantel Settings, a wall tablet's Direct Connection, and its Reload and Clear Cache.
import { act, api, ask, can, fmt, forget, hh, K, load, panel, redraw, shown, ui } from './core.js';
import { button, clearDraft, draft, failed, field, group, info, pending, result } from './kit.js';

// A WALL TABLET'S DIRECT CONNECTION (tablet_links.py; docs/phase8/KIOSK.md, slice 1): Mantel reading the tablet's
// kiosk app itself. Paired on the tablet's own page (Wall Tablets → the tablet, drawn through the panel's
// extend('tablet', ...)), listed here. Status only: Mantel sends a tablet no commands yet.
const KIOSK_WHERE = { kiosk_satellite: 'Kiosk Satellite: Settings → Device → Remote Administration',
                      fully: 'Fully Kiosk: Settings → Remote Administration (needs Fully PLUS)' };
const tabletHref = (tid) => '#/house/tablets/' + encodeURIComponent(tid);
function liveSays(live) {
  if (!live) return null;
  if (!live.ok) return live.error ? live.error.message : 'It did not answer.';
  const i = live.info || {}, bits = [];
  if (i.screen_on === true) bits.push('Screen on' + (typeof i.brightness === 'number' ? ' at ' + i.brightness + '%' : ''));
  if (i.screen_on === false) bits.push('Screen off');
  if (i.screensaver) bits.push('Screensaver showing');
  if (typeof i.battery === 'number') bits.push('Battery ' + i.battery + '%' + (i.charging ? ', charging' : ''));
  return bits.join(' · ') || 'Connected.';
}
function drawWallTablets(c) {
  const got = load('tablets-live', () => api('GET', '/api/connections/tablets?live=1'));
  if (!got) { pending(c, 'Reading the wall tablets…'); return; }
  if (got.err) { failed(c, got.err); return; }
  const ts = got.data.tablets.filter((t) => t.supported || t.state === 'set');
  if (!ts.length) return;
  c.appendChild(group({ header: 'Wall Tablets', footer: 'Mantel reads each tablet’s kiosk app itself, without Home Assistant. Pair a tablet on its own page. Reload and Clear Cache are house commands: they need house commands on, and each is in the Audit Log.' },
    ts.map((t) => {
      const live = t.live, value = t.state !== 'set' ? 'Not Set Up' : t.unreadable ? 'Pair Again' : !live ? '' : live.ok ? 'Connected' : 'Not Connected';
      return K().nav({ label: t.name, sub: [t.app_label, t.url ? t.url.replace(/^http:\/\//, '') : null, t.state === 'set' ? liveSays(live) : null].filter(Boolean).join(' · '),
                       value, href: tabletHref(t.id), icon: 'mdi:tablet', fk: 'mx:tablet:' + t.id });
    })));
}
// The group on the tablet's own page
// HK Settings' own data again (panel/get): a tablet paired or disconnected gains or loses its Reload parts
export function reloadPanel() {
  const p = panel;
  if (p && typeof p.reload === 'function') Promise.resolve(p.reload()).then(() => p.render()).catch(() => {});
}
// A PAIRED TABLET'S RELOAD AND CLEAR CACHE (host.press): HK Settings' parts "mantel-tablet:<id>:<verb>"
// (tablet_links.panel_parts), each sent through the command gateway (POST .../command: RBAC, the audit row; refused
// with commands off). Every one is sent; a failure says which tablets.
const TABLET_PART = /^mantel-tablet:([a-z0-9_]{1,64}):(reload|clear_cache)$/;
export function pressTablets(ids, p) {
  const mine = ids.map((id) => TABLET_PART.exec(String(id))).filter(Boolean);
  if (!mine.length) return null;
  const names = (p && p.tabs && p.tabs()) || {};
  return Promise.all(mine.map(([, tid, verb]) =>
    api('POST', '/api/connections/tablets/' + encodeURIComponent(tid) + '/command', { verb }).then(() => null, (e) => ({ tid, e }))))
    .then((got) => {
      const bad = got.filter(Boolean);
      if (!bad.length) return;
      const say = (b) => ((names[b.tid] && names[b.tid].name) || b.tid);
      const same = bad.every((b) => b.e.message === bad[0].e.message);
      if (mine.length === 1) throw new Error(bad[0].e.message);
      throw new Error(bad.map(say).join(', ') + (bad.length === 1 ? ': ' : ' — ') +
        (same ? bad[0].e.message : bad.map((b) => say(b) + ': ' + b.e.message).join(' ')));
    });
}

export function drawDirect(c, ctx) {
  if (!can('connections')) return;
  const tid = ctx.tablet, key = 'tablet:' + tid, form = 'direct-' + tid;
  const got = load('tablets', () => api('GET', '/api/connections/tablets'));
  if (!got) { pending(c, 'Reading its direct connection…'); return; }
  if (got.err) { failed(c, got.err); return; }
  const t = got.data.tablets.find((x) => x.id === tid);
  if (!t) return;
  const header = 'Direct Connection';
  if (!t.supported) {
    c.appendChild(group({ header, footer: 'Mantel can talk to Kiosk Satellite and Fully Kiosk directly. This tablet’s Kiosk App has no direct connection.' }, []));
    return;
  }
  const can2 = got.data.can_edit, set = t.state === 'set', sv = t.saved || {};
  const rows = [];
  if (set) {
    const live = load('tablet-live:' + tid, () => api('GET', '/api/connections/tablets/' + encodeURIComponent(tid) + '/live'));
    const lv = live && live.data && live.data.live;
    rows.push(info('Status', lv ? liveSays(lv) : 'Reading it now…', !lv ? '' : lv.ok ? 'Connected' : 'Not Connected', lv && !lv.ok ? 'warn' : ''));
    rows.push(info('Address', null, t.url.replace(/^http:\/\//, '')));
    const d = sv.device || {};
    rows.push(info('Paired As', [d.model, d.version ? t.app_label + ' ' + d.version : null, 'since ' + fmt(sv.since),
                                 sv.by_name ? 'by ' + sv.by_name : null].filter(Boolean).join(' · '), d.name || '—'));
    if (sv.expires) rows.push(info('Token Expires', null, new Date(sv.expires * 1000).toLocaleDateString([], { dateStyle: 'medium' })));
    if (lv && lv.ok && lv.info && lv.info.page) rows.push(info('Showing', lv.info.page));
  } else {
    rows.push(info('Status', null, t.unreadable ? 'Pair Again' : 'Not Set Up', t.unreadable ? 'warn' : ''));
  }
  const notes = [];
  if (t.unreadable) notes.push('Mantel’s saved copy could not be opened (was the at-rest key changed?). Pair it again.');
  if (sv.missing && sv.missing.length) notes.push('This ' + t.app_label + ' version lacks ' + sv.missing.join(', ') + ', which Mantel needs for its commands. Update the app.');
  notes.push('Mantel reads ' + t.app_label + ' on the tablet itself, without Home Assistant. The only commands it sends are Reload and ' +
             'Clear Cache & Reload (Actions, below, and All at Once on Wall Tablets), while commands are on; each is in the Audit Log.');
  if (!can2) notes.push('Only an Owner can pair a tablet.');
  c.appendChild(group({ header, footer: notes.join(' ') }, rows));
  result(c, key);
  if (!can2) return;
  const d = draft(form);
  if (set && !d.open) {
    c.appendChild(group({}, [
      button('Pair Again…', () => { d.open = true; redraw(); }, { fk: 'mx:direct-replace' }),
      button('Disconnect…', async () => {
        const why = t.app === 'kiosk_satellite' ? ' Kiosk Satellite’s tokens can’t be revoked from Mantel: the token Mantel had keeps working until it expires, unless the tablet’s remote administration is reset.' : '';
        if (!(await ask({ title: 'Disconnect ' + t.name + '?', message: 'Mantel forgets how to reach this tablet directly. Home Assistant’s own connection to it is not affected.' + why, ok: 'Disconnect', destructive: true }))) return;
        if (await act(key, () => api('DELETE', '/api/connections/tablets/' + encodeURIComponent(tid)), t.name + ' disconnected.', 'tablets', 'tablets-live', 'tablet-live:' + tid)) reloadPanel();
      }, { destructive: true, fk: 'mx:direct-disconnect' })]));
    return;
  }
  const body = () => ({ address: (d.address || '').trim(), password: d.password || '' });
  const out = shown['direct:' + tid];
  const run = (save) => async () => {
    shown['direct:' + tid] = { text: save ? 'Pairing…' : 'Testing…' }; redraw();
    try {
      const r = await api('POST', '/api/connections/tablets/' + encodeURIComponent(tid) + (save ? '' : '/test'), body());
      const i = (r.result && r.result.info) || {}, miss = (r.result && r.result.missing) || [];
      const says = 'It works: ' + [i.name, i.model, i.version ? t.app_label + ' ' + i.version : null].filter(Boolean).join(' · ') + '.' +
        (miss.length ? ' This version lacks ' + miss.join(', ') + '.' : '');
      if (save) {
        clearDraft(form); delete shown['direct:' + tid];
        ui.flash = { key, text: t.name + ' paired. ' + says };
        forget('tablets', 'tablets-live', 'tablet-live:' + tid);
        reloadPanel();
      } else shown['direct:' + tid] = { text: says };
    } catch (e) { shown['direct:' + tid] = { text: e.message, err: true }; }
    redraw();
  };
  const addr = t.url || t.suggested_url || '';
  c.appendChild(group({ header: 'Pair ' + t.name, footer: (t.suggested_url && !t.url ? 'The address is the one ' + t.app_label + ' reports to Home Assistant. ' : '') +
    (t.app === 'kiosk_satellite'
      ? 'The password is the tablet’s Remote Administration password (' + KIOSK_WHERE.kiosk_satellite + '). Mantel uses it once, to have the tablet make a token, and does not keep it.'
      : 'The password is Fully’s Remote Admin password (' + KIOSK_WHERE.fully + '). Fully has no tokens, so Mantel keeps it sealed.') +
    ' Nothing is saved until it works.' }, [
    field(form, 'address', 'Address', { value: addr.replace(/^http:\/\//, ''), placeholder: t.app === 'fully' ? 'tablet address, port 2323' : 'tablet address, port 2324', maxlength: 300, inputmode: 'url' }),
    field(form, 'password', 'Password', { type: 'password', maxlength: 256 }),
    button('Test', run(false), { fk: 'mx:direct-test' }), button(set ? 'Pair Again' : 'Pair', run(true), { fk: 'mx:direct-save' })]));
  if (out) c.appendChild(hh('p', { class: 'mxflash' + (out.err ? ' err' : ''), role: out.err ? 'alert' : 'status', text: out.text }));
  if (set) c.appendChild(group({}, [button('Cancel', () => { clearDraft(form); delete shown['direct:' + tid]; redraw(); }, { fk: 'mx:direct-cancel' })]));
}
