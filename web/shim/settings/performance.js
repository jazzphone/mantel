// settings/performance.js -- Mantel Settings, About, Performance (performance.py): how the house's screens are doing, and
// the server's numbers. For Owners and Admins; one row per tablet (and per person's browser), drawn like About.
import { api, forget, load, redraw, ROUTE } from './core.js';
import { button, failed, group, info, pending } from './kit.js';

const secs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms < 10 ? (Math.round(ms * 10) / 10) + ' ms' : Math.round(ms) + ' ms');
// how long before the server's own clock (its answer's `now`), so a tablet's or a browser's clock does not matter
const span = (now, t) => {
  const s = Math.max(0, now - t);
  return s < 90 ? 'under 2 min' : s < 5400 ? Math.round(s / 60) + ' min' : s < 129600 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' days';
};
// "Memory 77 MB · 2 reconnects · Slowest start 2.3 s": only what the page told
export function screenSub(r, now) {
  const bits = [];
  if (r.memory_mb != null) bits.push('Memory ' + r.memory_mb + ' MB');
  if (r.reconnects != null) bits.push(r.reconnects + (r.reconnects === 1 ? ' reconnect' : ' reconnects'));
  if (r.slowest_start_ms != null) bits.push('Slowest start ' + secs(r.slowest_start_ms));
  if (r.registry_refreshes) bits.push(r.registry_refreshes + ' registry refreshes');
  bits.push(r.page === 'settings' ? 'Settings page' : 'Dashboard');
  bits.push('heard ' + span(now, r.last_seen) + ' ago');
  return bits.join(' · ');
}

export function pPerformance() {
  return { title: 'Performance', back: ['About', '#/' + ROUTE + '/about'],
           scope: 'How each screen’s page is doing over the last 24 hours, and how fast Mantel passes the house’s changes on. Numbers only; nothing is stored beyond a day.', body(c) {
    const got = load('performance', () => api('GET', '/api/performance'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data, s = d.server || {}, f = s.fan_out || {};
    c.appendChild(group({ header: 'Mantel', footer: 'Fan-out is the time to build and send one screen’s changes, over the last hour.' }, [
      info('Fan-Out Time', f.samples ? f.samples + ' sends in the last hour' : 'Nothing sent in the last hour', f.samples ? 'p50 ' + secs(f.p50_ms) + ' · p95 ' + secs(f.p95_ms) : '—'),
      info('Home Assistant Events', 'State changes, over the last five minutes', (s.ha_events_per_min == null ? '—' : s.ha_events_per_min + ' a minute')),
      info('Connected Screens', null, String(s.connected_screens == null ? '—' : s.connected_screens)),
    ]));
    const row = (r) => info(r.name, screenSub(r, d.now), r.up_since ? 'Up ' + span(d.now, r.up_since) : '—');
    const tablets = (d.screens || []).filter((r) => r.kind === 'tablet'), people = (d.screens || []).filter((r) => r.kind !== 'tablet');
    c.appendChild(group({ header: 'Wall Tablets', footer: tablets.length ? 'Up is how long the page has been open; a tablet that reloads often shows a short time here.' : 'No wall tablet has reported in the last 24 hours.' }, tablets.map(row)));
    if (people.length) c.appendChild(group({ header: 'Browsers' }, people.map(row)));
    c.appendChild(group({}, [button('Refresh', () => { forget('performance'); redraw(); }, { center: true, fk: 'mx:performance-refresh' })]));
  } };
}
