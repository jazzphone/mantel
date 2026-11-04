// settings/ha-screens.js -- Mantel Settings, screens in Home Assistant's sidebar, and where each screen is drawn.
// @ts-check
import { act, api, ask, cache, forget, K, load, me, panel, redraw, shown, ui } from './core.js';
import { button, clearDraft, draft, failed, field, group, info, result } from './kit.js';

// A SCREEN IN HOME ASSISTANT'S SIDEBAR (ha_dashboards.py): a Webpage dashboard showing the screen's own address,
// which HA (and its Companion app) can open on. Mantel makes, changes and removes it in HA; HA is the only record,
// so one renamed or removed there shows so here. Owner and Admin, with direct access and HA connected.
const MANAGER = (role) => role === 'owner' || role === 'admin';
export const HAD = 'ha-dashboards';
let hadAt = 0;                                        // when HA was last read: a page drawn later than 30 s on reads it again
export function loadHad() {
  if (cache[HAD] && !cache[HAD].loading && Date.now() - hadAt > 30000) forget(HAD);
  return load(HAD, () => api('GET', '/api/admin/ha-dashboards').then((r) => { hadAt = Date.now(); return r; }));
}
export const origin = (u) => { try { return new URL(u).origin; } catch (e) { return ''; } };
// the HA page this one is shown in (a Webpage dashboard), else null; Firefox has no ancestorOrigins
export function framedBy() {
  try { const a = location.ancestorOrigins; return a && a.length ? a[a.length - 1] : null; } catch (e) { return null; }
}
// an Owner trusts one Home Assistant address to show Mantel in a frame (frame_origins.py; audited, applied at once)
export function allowFrame(key, addr) {
  return act(key, () => api('POST', '/api/admin/frame-origins', { origin: addr }),
             addr.replace(/^https?:\/\//, '') + ' may now show Mantel. Reload the dashboard in Home Assistant.', HAD, 'proxy');
}
export function drawHaDashboard(c, ctx) {
  if (!me || !MANAGER(me.user.role)) return;
  const key = 'ha-dash:' + ctx.screen;
  const got = loadHad();
  if (!got) return;                                   // drawn when HA has answered
  if (got.err) { failed(c, got.err); return; }
  const d = got.data, header = 'Home Assistant';
  if (d.state === 'direct_access_off' || d.state === 'ha_not_connected') return;
  if (d.state === 'not_ha_admin') { c.appendChild(group({ header, footer: d.message }, [])); return; }
  const mine = d.dashboards.filter((x) => x.screen === ctx.screen), cur = mine[0] || null;
  const scr = (d.screens || []).find((x) => x.path === ctx.screen);
  const put = (body, okText) => act(key, async () => {
    cache[HAD] = { data: await api('PUT', '/api/admin/screens/' + encodeURIComponent(ctx.screen) + '/ha-dashboard', body) };
    hadAt = Date.now();
  }, okText);
  const allowedFrames = (d.frame_ancestors || []).map(origin);
  const top = framedBy(), topBlocked = !!top && !allowedFrames.includes(top);
  const rows = [K().toggle({ label: 'Show in Home Assistant', sub: cur ? 'In its sidebar as ' + cur.title : null, on: !!cur,
    fk: 'mx:had:on', onChange: async (on) => {
      if (on) {
        // shown inside HA at an address that may not frame Mantel yet: an Owner's turning it on trusts that address
        const body = { on: true, title: ctx.title || undefined };
        if (topBlocked && me.user.role === 'owner') body.frame_origin = top;
        act(key, async () => {
          const r = await api('PUT', '/api/admin/screens/' + encodeURIComponent(ctx.screen) + '/ha-dashboard', body);
          cache[HAD] = { data: r }; hadAt = Date.now();
          if (r.frame_approved) ui.flash = { key, text: 'Added to Home Assistant, and ' + r.frame_approved.replace(/^https?:\/\//, '') + ' may now show Mantel.' };
        }, 'Added to Home Assistant.');
        return;
      }
      if (!(await ask({ title: 'Remove ' + cur.title + ' from Home Assistant?', message: 'The dashboard leaves Home Assistant’s sidebar for everyone. Anyone whose Home Assistant opens on it opens on Home Assistant’s default instead.', ok: 'Remove', destructive: true }))) { redraw(); return; }
      put({ on: false }, 'Removed from Home Assistant.');
    } })];
  if (cur) {
    rows.push(K().text({ label: 'Title', value: cur.title, maxlength: 60, fk: 'mx:had:title',
      onCommit: (v) => put({ on: true, title: v.trim() || ctx.title }, 'Saved.') }));
    rows.push(K().text({ label: 'Icon', value: cur.icon, placeholder: 'mdi:fireplace', maxlength: 90, fk: 'mx:had:icon',
      onCommit: (v) => put({ on: true, icon: v.trim() || 'mdi:fireplace' }, 'Saved.') }));
    rows.push(K().select({ label: 'Who Sees It', value: cur.require_admin ? 'admin' : 'all', fk: 'mx:had:who',
      options: [['all', 'Everyone'], ['admin', 'Home Assistant Administrators Only']],
      onChange: (v) => put({ on: true, require_admin: v === 'admin' }, 'Saved.') }));
  }
  if (cur && topBlocked) {
    rows.push(me.user.role === 'owner'
      ? button('Allow ' + top.replace(/^https?:\/\//, '') + ' to Show Mantel', () => allowFrame(key, top), { fk: 'mx:had:allow' })
      : info('Not Allowed Here', 'Home Assistant is open at ' + top.replace(/^https?:\/\//, '') + ', which may not show Mantel yet: an Owner allows it (Connections → HTTPS and Your Proxy).', 'Blank', 'warn'));
  }
  const notes = [];
  if (cur) {
    const at = framedBy() || d.ha_url;
    notes.push('Open it in Home Assistant at ' + (at ? at.replace(/^https?:\/\//, '') : '') + '/' + cur.url_path + '. To have Home Assistant and its ' +
      'Companion app open on it, pick it in Home Assistant under your Profile → Dashboard; each person picks their own.');
    if (!cur.show_in_sidebar) notes.push('It is hidden from the sidebar in Home Assistant (Settings → Dashboards).');
    if (mine.length > 1) notes.push('Home Assistant has ' + mine.length + ' dashboards of this screen; turning it off removes them all.');
    notes.push('Who sees what inside it is still Mantel’s: someone not signed in to Mantel gets Mantel’s sign-in page there.');
  } else {
    notes.push('Adds a Webpage dashboard to Home Assistant’s sidebar showing ' + (scr ? scr.url : 'this screen') +
      ', so Home Assistant and its Companion app can open on this screen.');
  }
  c.appendChild(group({ header, footer: notes.join(' ') }, rows));
  result(c, key);
}

// SCREENS: WHERE EACH IS DRAWN (screens.py; decision 29, one place per screen). Add Screen asks where first; a
// screen's page says where it is drawn and, for a screen both Mantel and Home Assistant have at the same address,
// offers to keep it Mantel's, make it Home Assistant's, or split it in two.
const WHERE_LABEL = { mantel: 'Mantel', ha: 'Home Assistant' };
const screenList = () => ((panel && panel.data && panel.data.dashboards) || []).filter((x) => x.item);
async function afterScreens(to) {
  try { if (panel && panel.reload) await panel.reload(); } catch (e) { /* the feed redraws it anyway */ }
  if (to && panel) panel.go(to); else redraw();
}
export function pAddScreen() {
  return { title: 'Add Screen', back: ['Screens', '#/'], scope: 'A new screen, drawn in one place: by Mantel (its own page, a wall tablet, a browser), or by HK Frontend in Home Assistant (a dashboard in its sidebar, made for you).', body(c) {
    result(c, 'addscreen');
    const d = draft('addscreen');
    if (!d.where) d.where = 'mantel';
    c.appendChild(group({ header: 'Name' }, [field('addscreen', 'title', 'Name', { placeholder: 'Den', maxlength: 60 })]));
    c.appendChild(group({ header: 'Where', footer: d.where === 'ha' ? 'Home Assistant gets a new dashboard in its sidebar that HK Frontend draws with these settings. HK Frontend must be linked, with Mantel running the house.' : 'Mantel serves it at its own address; a wall tablet or a browser opens it.' },
      ['mantel', 'ha'].map((w) => K().check({ label: WHERE_LABEL[w], on: d.where === w, fk: 'mx:addscreen:where:' + w,
                                              onClick: () => { d.where = w; redraw(); } }))));
    const from = screenList();
    c.appendChild(group({ header: 'Start From' }, [K().select({ label: 'Settings', options: [['', 'A New Screen’s'], ...from.map((x) => [x.path, x.title])],
      value: d.from || '', fk: 'mx:addscreen:from', onChange: (v) => { d.from = v || null; } })]));
    c.appendChild(group({}, [button('Add Screen', async () => {
      const title = (d.title || '').trim();
      if (!title) { ui.flash = { key: 'addscreen', text: 'Give the screen a name.', err: true }; redraw(); return; }
      const r = await act('addscreen', () => api('POST', '/api/screens', { title, where: d.where, ...(d.from ? { from: d.from } : {}) }), null);
      if (r && r.key) { clearDraft('addscreen'); ui.flash = { key: '*', text: title + ' added.' }; await afterScreens('#/screens/' + encodeURIComponent(r.key)); }
    }, { center: true, fk: 'mx:addscreen:go' })]));
  } };
}
export function drawWhere(c, ctx) {
  if (!me || !MANAGER(me.user.role)) return;
  const w = ctx.where || { where: 'mantel', text: 'Mantel' }, key = ctx.screen;
  const rows = [info('Where', w.text, WHERE_LABEL[w.where] || 'Mantel')];
  const put = (body, okText) => act('where', () => api('PUT', '/api/screens/' + encodeURIComponent(key), body), okText);
  if (w.conflict) {
    rows.push(button('Keep It Mantel’s, Remove Home Assistant’s…', async () => {
      if (!(await ask({ title: 'Remove Home Assistant’s dashboard?', message: 'HK Frontend’s dashboard at /' + key + ' is removed from Home Assistant. Mantel’s screen and its settings stay as they are.', ok: 'Remove', destructive: true }))) return;
      if (await put({ remove_ha: true }, 'Home Assistant’s dashboard is removed.')) await afterScreens();
    }, { fk: 'mx:where:keep' }));
    rows.push(button('Make It Home Assistant’s…', async () => {
      if (!(await ask({ title: 'Make it Home Assistant’s?', message: 'HK Frontend draws it in Home Assistant with these settings, and Mantel stops serving it.', ok: 'Make It Home Assistant’s' }))) return;
      if (await put({ where: 'ha' }, 'It’s Home Assistant’s now.')) await afterScreens();
    }, { fk: 'mx:where:ha' }));
    rows.push(button('Split It in Two…', () => { shown.split = key; redraw(); }, { fk: 'mx:where:split' }));
  } else if (w.where === 'ha') {
    rows.push(button('Draw It in Mantel Instead…', async () => {
      if (!(await ask({ title: 'Draw it in Mantel?', message: 'Mantel serves it again. Home Assistant’s dashboard at the same address stays until you remove it.', ok: 'Draw in Mantel' }))) return;
      if (await put({ where: 'mantel' }, 'It’s Mantel’s now.')) await afterScreens();
    }, { fk: 'mx:where:mantel' }));
  }
  rows.push(button('Remove Screen…', async () => {
    if (!(await ask({ title: 'Remove ' + (ctx.title || 'this screen') + '?', message: 'It’s removed from Mantel (its history is kept). A screen wall tablets open can’t be removed: move them first.', ok: 'Remove', destructive: true }))) return;
    const r = await act('where', () => api('DELETE', '/api/screens/' + encodeURIComponent(key)), null);
    if (r) { ui.flash = { key: '*', text: (ctx.title || 'The screen') + ' is removed.' }; await afterScreens('#/'); }
  }, { destructive: true, fk: 'mx:where:remove' }));
  c.appendChild(group({ header: 'Where', footer: w.conflict ? 'Mantel and Home Assistant both have a screen at this address, so they share these settings. Each screen should be drawn in one place.' : null }, rows));
  if (shown.split === key) {
    const d = draft('split:' + key);
    c.appendChild(group({ header: 'Split It in Two', footer: 'Mantel’s copy gets the new name and a new address, and keeps the wall tablets, Default Screens and Home Assistant sidebar dashboards that open it. This address becomes Home Assistant’s, starting with the same settings. Old links to Mantel’s still open it.' }, [
      field('split:' + key, 'title', 'Mantel’s New Name', { placeholder: (ctx.title || 'Home') + '-Mantel', maxlength: 60 }),
      button('Split', async () => {
        const title = (d.title || '').trim() || (ctx.title || 'Home') + '-Mantel';
        const r = await act('where', () => api('POST', '/api/screens/' + encodeURIComponent(key) + '/split', { title }), null);
        if (r && r.key) { shown.split = null; clearDraft('split:' + key); ui.flash = { key: '*', text: 'Split: Mantel’s is ' + title + '.' }; await afterScreens('#/screens/' + encodeURIComponent(r.key)); }
      }, { center: true, fk: 'mx:where:split:go' })]));
  }
  result(c, 'where');
}
