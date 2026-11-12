// mantel-settings.js -- Mantel's own pages in Mantel Settings (HK's settings panel with Mantel's host).
//
// The panel (web/hk/panels/hk-settings.js) asks its host for pages of its own (hkShell.settingsHost(),
// "THE HOST'S SETTINGS" there); this is Mantel's answer: Me, People, Roles & Grants, Audit Log, Connections (Home
// Assistant with Mantel Link, HK Frontend and Mantel Connect; Music Assistant), Cameras (RTSP cameras Mantel plays itself), Intercom (talk to the rooms; docs/phase17/INTERCOM.md), Alerts (where
// Mantel sends what goes wrong), Timeline (what the House Timeline records), Your Files (with Photos,
// mantel-photos.js), Service Accounts and Assistants (MCP), and Mantel's groups on HK's own wall tablet pages; every one drawn with HK Settings' own kit
// (hk-settings-kit.js: iOS Settings, docs/DESIGN.md "HK Settings stays iOS Settings"). Only Mantel loads
// this file; Home Assistant's build never ships web/shim, so none of it exists in HK Frontend inside HA.
//
// It only calls the REST routes /admin used (docs/phase3/ADMIN-PAGE.md); the server decides who may do what.
// Which pages show is GET /api/admin/overview's `sections` (admin_page.sections_for: the same checks as the
// routes behind them). A credential shown once (a service account's, a pairing code) lives only in this
// module until it is dismissed or the page is left; nothing is stored.
//
// This file is the host (the panel's answer: which pages, where, who sees them) and the table that builds each page;
// the pages are one file each in settings/ (core.js: state, api, reads; kit.js: what every page draws with).
// @ts-check
import { mantelUrl, base as BASE } from './base.js';
import * as photos from './mantel-photos.js';
import { api, C, cache, can, drafts, forgetFailed, manages, me, panel, refreshMe, roleLabel, ROUTE, setMe, setPanel, shown, ui }
  from './settings/core.js';
import { ensureStyle, stepUp } from './settings/kit.js';
import { pMe } from './settings/me.js';
import { pPeople } from './settings/people.js';
import { drawTabletMantel, drawTabletsMantel, pDevices } from './settings/devices.js';
import { pRoles } from './settings/roles.js';
import { pFiles, photoTools } from './settings/files.js';
import { pBackups } from './settings/backups.js';
import { pAlerts } from './settings/alerts.js';
import { pTimeline } from './settings/timeline.js';
import { pService } from './settings/service.js';
import { pAssistants } from './settings/assistants.js';
import { pConnect } from './settings/connect.js';
import { pConnections } from './settings/connections.js';
import { pCameras } from './settings/cameras.js';
import { pIntercom } from './settings/intercom.js';
import { drawDirect, pressTablets } from './settings/tablets.js';
import { drawTabletApp } from './settings/tablet-app.js';
import { drawHaDashboard, drawWhere, pAddScreen } from './settings/ha-screens.js';
import { pAudit } from './settings/audit.js';
import { pSetup, setupOpen } from './settings/setup.js';
import { pGeneral } from './settings/general.js';
import { pAbout } from './settings/about.js';
export { api, manages };

// the pages, in the sidebar's order: [section, title, icon, color, place, group header]
const PAGES = [
  ['me', 'Me', 'mdi:account-circle', C.gray, 'top'],
  ['people', 'People', 'mdi:account', C.blue, 'end', 'People & Access'],
  ['roles', 'Roles & Grants', 'mdi:shield-lock', C.indigo, 'end', 'People & Access'],
  ['audit', 'Audit Log', 'mdi:history', C.gray, 'end', 'People & Access'],
  ['general', 'General', 'mdi:cog', C.gray, 'end', 'Mantel'],
  ['connections', 'Connections', 'mdi:lan', C.green, 'end', 'Mantel'],
  ['cameras', 'Cameras', 'mdi:cctv', C.teal, 'end', 'Mantel'],
  ['intercom', 'Intercom', 'mdi:microphone', C.orange, 'end', 'Mantel'],
  ['files', 'Your Files', 'mdi:folder', C.purple, 'end', 'Mantel'],
  ['backups', 'Backups', 'mdi:safe', C.blue, 'end', 'Mantel'],
  ['alerts', 'Alerts', 'mdi:bell-ring', C.red, 'end', 'Mantel'],
  ['timeline', 'Timeline', 'mdi:timeline', C.orange, 'end', 'Mantel'],
  ['setup', 'Set Up Mantel', 'mdi:clipboard-check', C.green, 'end', 'Mantel'],
  ['about', 'About', 'mdi:information-outline', C.gray, 'end', 'Mantel'],
  ['service', 'Service Accounts', 'mdi:key-variant', C.brown, 'end', 'Advanced'],
  ['assistants', 'Assistants (MCP)', 'mdi:robot', C.indigo, 'end', 'Advanced'],
];
// Photos is inside Your Files (#/mantel/files/photos): its old addresses forward there. Devices is each wall tablet's
// own page now (All Screens, Wall Tablets: extend 'tablet' and 'tablets', below); Mantel Connect is in Connections,
// Home Assistant. Their old addresses forward there (OLD_PAGES).
const OLD_PAGES = { devices: 'house/tablets', connect: ROUTE + '/connections/ha/sidebar' };
// The words Mantel puts on HK's own pages where Mantel differs (the panel's host notes)
const NOTES = {
  overview: 'These are HK’s settings, kept by Mantel. Each screen is drawn in one place: by Mantel, or by HK Frontend ' +
    'in Home Assistant (its Where says which), and while Mantel runs the house HK Frontend’s dashboards use these ' +
    'settings too. Anything else that needs Home Assistant to be written (tablets as Home Assistant devices, accessory ' +
    'setup flows) is read-only here; saving one says why it was refused.',
  screen_remove: 'A screen is removed from its Where, below.',
  secure: 'See Settings → About → Secure Connection.',
};

let lastPage = null;
// whether the server has house commands on (the hub's capabilities): set by the page that owns the socket
let commandsOn = () => false;
export function useCommands(fn) { commandsOn = typeof fn === 'function' ? fn : () => false; }
const BUILD = { me: pMe, people: pPeople, devices: pDevices, roles: pRoles, files: pFiles, backups: pBackups, alerts: pAlerts, timeline: pTimeline, service: pService, assistants: pAssistants,
  about: pAbout, general: pGeneral,
                connect: pConnect, connections: pConnections, cameras: pCameras, intercom: pIntercom, audit: pAudit, setup: pSetup };

export const host = {
  title: 'Mantel Settings',
  get house() { return manages(); },
  get screenBase() { return BASE; },
  // a screen's page of only its screensaver (home.js ?hk_preview=saver): the panel's screensaver preview shows that
  saverPage: true,
  get back() { return { label: 'Dashboard', href: mantelUrl('/home') }; },
  notes: NOTES,
  gridHistory(path, panel) { return panel.client.callWS({ type: 'mantel/settings/history', scope: 'board', key: path, bodies: true, limit: 100 }); },
  // each wall tablet's latest frame rate, the screens it shows and the style it was drawn with (performance.py), for
  // the panel's "a lighter look for a slow tablet": only for the people who manage the house (the route's guard)
  tabletHealth() { return manages() ? api('GET', '/api/performance/tablets').then((r) => (r && r.tablets) || []) : Promise.resolve([]); },
  // a screen's pencil (the panel's titleLine): Mantel's own screen renamed, its address kept (screens.py PUT)
  renameScreen(path, title) { return api('PUT', '/api/screens/' + encodeURIComponent(path), { title }); },
  // ALSO RENAME IN HOME ASSISTANT (the accessory page's switch, 2026-10-31): a name written to Home Assistant's
  // registry is a house command, so it is offered only to the people who manage the house, only while the server
  // has house commands on (Allow Control of the House; off, the gateway refuses it) and Mantel can read Home
  // Assistant. The write is the gateway's own command, as the person who asked: checked against their role,
  // audited before it is sent. The client is the page's own, the one it was asked with.
  canRenameInHome(client) {
    return !!(manages() && commandsOn() && client && client.actions && typeof client.actions.callWS === 'function');
  },
  renameInHome(id, name, client) {
    return client.actions.callWS({ type: 'config/entity_registry/update', entity_id: id, name: name });
  },
  // a wall tablet's Home Assistant user is Mantel's (its 'tablet' group), not HK's Tablet User; the font and
  // glyphs are in Your Files (Mantel's data), not HK Frontend's folder; HA's sidebar entry is HK Frontend's
  get owns() { return { tablet_user: true, files: ROUTE + '/files', sidebar: true }; },
  groups() {
    if (!me) return [];
    const out = [];
    const u = me.user;
    out.push({ place: 'top', rows: [{ route: ROUTE + '/me', label: u.name || u.username || 'Me', sub: roleLabel(u.role) + ' · Sign-In, Passkeys, Sessions',
                                      tile: ['mdi:account-circle', C.gray], root: !manages() }] });
    // while setup is open it leads the list too, with how far it has got
    if (setupOpen()) out.push({ place: 'top', rows: [{ route: ROUTE + '/setup', label: 'Set Up Mantel', sub: 'What Mantel still needs',
                                                       tile: ['mdi:clipboard-check', C.green] }] });
    const heads = {};
    for (const [s, title, icon, color, place, header] of PAGES) {
      if (place !== 'end' || !can(s)) continue;
      if (!heads[header]) { heads[header] = { place: 'end', header, rows: [] }; out.push(heads[header]); }
      heads[header].rows.push({ route: ROUTE + '/' + s, label: title, tile: [icon, color] });
    }
    return out;
  },
  page(parts, p) {
    setPanel(p);
    ensureStyle(p && p.shadowRoot);
    if (parts[0] !== ROUTE || !me) return null;
    const s = parts[1] || 'me';
    const at = parts.join('/');
    if (at !== lastPage) { lastPage = at; forgetFailed(); }     // a failed read is asked again on a page opened anew
    if (s === 'add-screen' && manages()) return pAddScreen();
    if (s === 'connect' && can('connect')) return pConnections(['ha', 'sidebar']);
    if (!BUILD[s] || !can(s)) return pMe([]);
    return BUILD[s](parts.slice(2));
  },
  // /admin's addresses (#connections, #people ...) and the page's own first-run choice
  forward(path) {
    if (PAGES.some(([s]) => s === path)) return ROUTE + '/' + path;
    const old = /^(?:mantel\/)?(devices|connect)$/.exec(path);
    if (old) return OLD_PAGES[old[1]];
    // an alert's link to Advanced -> Features (feature.enabled, features/auto.py): HK's own page
    if (/^mantel\/features$/.test(path)) return 'advanced/features';
    // Add Screen is Mantel's own: where the new screen is drawn comes first (screens.py)
    if (path === 'add-screen' && manages()) return ROUTE + '/add-screen';
    // Photos had its own row until it moved into Your Files: #/photos (/admin's) and #/mantel/photos[/<album>]
    const m = /^(?:mantel\/)?photos(\/.*)?$/.exec(path);
    if (m) return ROUTE + '/' + photos.SECTION + (m[1] || '');
    return null;
  },
  first() {
    if (!me) return null;
    if (setupOpen()) return ROUTE + '/setup';
    if (me.ha_set_up === false && can('connections')) return ROUTE + '/connections';
    return manages() ? null : ROUTE + '/me';
  },
  // Mantel's own groups on HK's pages: a wall tablet's Direct Connection, a screen in Home Assistant's sidebar
  // a paired tablet's Reload and Clear Cache (HK Settings' Wall Tablets buttons): through the command gateway
  press(ids, p) {
    if (p) setPanel(p);
    return me ? pressTablets(ids, p) : null;
  },
  // a socket save refused with step_up_required (mantel-client.js): the same Confirm It Is You as the REST pages
  stepUp() {
    return panel && me ? stepUp() : Promise.resolve(false);
  },
  extend(where, c, ctx, p) {
    if (p) { setPanel(p); ensureStyle(p.shadowRoot); }
    if (where === 'tablet' && me && ctx && ctx.tablet) { let app = false; if (can('devices')) { drawTabletMantel(c, ctx); app = drawTabletApp(c, ctx); } if (!app && ctx.app !== 'mantel') drawDirect(c, ctx); }
    if (where === 'tablets' && me && can('devices')) drawTabletsMantel(c);
    if (where === 'screen' && me && ctx && ctx.screen) { drawWhere(c, ctx); if (!ctx.where || ctx.where.where !== 'ha') drawHaDashboard(c, ctx); }
    if ((where === 'saver' || where === 'house-saver') && me && can('photos')) photos.extend(where, c, ctx || {}, photoTools);
  },
  search() {
    if (!me) return [];
    const out = PAGES.filter(([s]) => can(s)).map(([s, title]) => ({ label: title, route: ROUTE + '/' + s, where: 'Mantel', words: s === 'cameras' ?
      'cameras rtsp ip camera add camera frigate motion doorbell'
      : s === 'intercom' ? 'intercom announce announcement broadcast talk speak microphone rooms homepod live message chime music assistant'
      : s === 'alerts' ? 'alerts notifications discord telegram notifiarr email apprise heartbeat system alerts'
      : s === 'timeline' ? 'timeline history recorded doors locks garage alarm arrivals doorbell detections retention pictures morning summary digest clear' : s }));
    if (can('photos')) out.push({ label: 'Photos', route: ROUTE + '/' + photos.SECTION, where: 'Mantel → Your Files', words: 'photos albums upload screensaver pictures' });
    return out;
  },
};

// The page's start: who this is and what they may use (GET /api/admin/overview)
export async function start() {
  await refreshMe();
  return me;
}
export function overview() { return me; }
// tests: the module's state between cases
export function _reset(next) { setMe(next || null); setPanel(null); ui.enrolled = false; ui.flash = null; photos._reset();
  for (const o of [cache, drafts, shown]) for (const k of Object.keys(o)) delete o[k]; }
