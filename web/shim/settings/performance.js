// settings/performance.js -- Mantel Settings, About, Performance (performance.py): how the house's screens are doing, and
// the server's numbers. For Owners and Admins; one row per tablet (and per person's browser), drawn like About.
// @ts-check
import { api, forget, load, redraw, ROUTE } from './core.js';
import { button, failed, group, info, pending } from './kit.js';

const secs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms < 10 ? (Math.round(ms * 10) / 10) + ' ms' : Math.round(ms) + ' ms');
// how long before the server's own clock (its answer's `now`), so a tablet's or a browser's clock does not matter
const span = (now, t) => {
  const s = Math.max(0, now - t);
  return s < 90 ? 'under 2 min' : s < 5400 ? Math.round(s / 60) + ' min' : s < 129600 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' days';
};
const size = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
// "Download 3.4 MB in 62 files · First draw 2.3 s · 58 fps · 4 GB memory · 4 cores · 1180 × 820 @2×": only what the page told
export function startSub(r) {
  const bits = [], d = r.device || {};
  if (r.download_bytes) bits.push('Download ' + size(r.download_bytes) + (r.download_files ? ' in ' + r.download_files + ' files' : ''));
  if (r.first_draw_ms != null) bits.push('First draw ' + secs(r.first_draw_ms));
  if (r.fps != null) bits.push(r.fps + ' fps');
  if (d.memory_gb) bits.push(d.memory_gb + ' GB memory');
  if (d.cores) bits.push(d.cores + ' cores');
  if (d.screen_w && d.screen_h) bits.push(d.screen_w + ' × ' + d.screen_h + (d.dpr ? ' @' + d.dpr + '×' : ''));
  return bits.join(' · ');
}
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

// the House Timeline's numbers (performance.py STATS.timeline: tap and write p95, rows, queued, dropped, pictures)
export function timelineRows(tl) {
  const tap = tl.tap || {}, w = tl.write || {}, p = tl.pictures || {};
  const pair = (x) => (x.samples ? 'p50 ' + secs(x.p50_ms) + ' · p95 ' + secs(x.p95_ms) : '—');
  return [
    info('Tap', tap.samples ? tap.samples.toLocaleString('en-US') + ' batches in the last hour' : 'No changes in the last hour', pair(tap)),
    info('Writing', w.samples ? w.samples.toLocaleString('en-US') + ' saves in the last hour' : 'Nothing written in the last hour', pair(w)),
    info('Rows', (tl.members == null ? null : tl.members + ' entities recorded') , tl.rows == null ? '—' : tl.rows.toLocaleString('en-US')),
    info('Queue', tl.dropped ? tl.dropped + ' dropped since Mantel started' : 'None dropped', String(tl.queued == null ? '—' : tl.queued)),
    info('Pictures', p.kept == null ? null : p.kept.toLocaleString('en-US') + ' kept · ' + (p.failed || 0) + ' failed', p.bytes == null ? '—' : size(p.bytes)),
  ];
}

export function pPerformance() {
  return { title: 'Performance', back: ['About', '#/' + ROUTE + '/about'],
           scope: 'How each screen’s page is doing over the last 24 hours, and how fast Mantel passes the house’s changes on. Numbers only; a screen’s are kept for a day, and each tablet’s latest summary until its next.', body(c) {
    const got = load('performance', () => api('GET', '/api/performance'));
    if (!got) { pending(c); return; }
    if (got.err) { failed(c, got.err); return; }
    const d = got.data, s = d.server || {}, f = s.fan_out || {};
    const t = s.tick || {}, h = s.settings_history || {};
    c.appendChild(group({ header: 'Mantel', footer: 'Fan-out is the time to build and send one screen’s changes, over the last hour. The tick is Mantel’s once-a-minute check of schedules, sessions and devices.' }, [
      info('Fan-Out Time', f.samples ? f.samples + ' sends in the last hour' : 'Nothing sent in the last hour', f.samples ? 'p50 ' + secs(f.p50_ms) + ' · p95 ' + secs(f.p95_ms) : '—'),
      info('Home Assistant Events', 'State changes, over the last five minutes', (s.ha_events_per_min == null ? '—' : s.ha_events_per_min + ' a minute')),
      info('Minute Tick', t.samples ? 'Time taken, over the last 24 hours' : 'Not run yet', t.samples ? 'Last ' + secs(t.last_ms) + ' · Longest ' + secs(t.max_ms) : '—'),
      info('Settings History', h.rows == null ? null : 'Every saved version of the settings', h.rows == null ? '—' : h.rows.toLocaleString('en-US') + (h.rows === 1 ? ' version · ' : ' versions · ') + size(h.bytes)),
      info('Connected Screens', null, String(s.connected_screens == null ? '—' : s.connected_screens)),
    ]));
    const tl = d.timeline || {};
    if (tl.on) c.appendChild(group({ header: 'Timeline', footer: 'The tap is the Timeline’s look at each batch of the house’s changes; writing is one save of what it queued (every 2 seconds). Over the last hour.' }, timelineRows(tl)));
    const row = (r) => info(r.name, screenSub(r, d.now), r.up_since ? 'Up ' + span(d.now, r.up_since) : '—');
    const tablets = (d.screens || []).filter((r) => r.kind === 'tablet'), people = (d.screens || []).filter((r) => r.kind !== 'tablet');
    c.appendChild(group({ header: 'Wall Tablets', footer: tablets.length ? 'Up is how long the page has been open; a tablet that reloads often shows a short time here.' : 'No wall tablet has reported in the last 24 hours.' }, tablets.map(row)));
    if (people.length) c.appendChild(group({ header: 'Browsers' }, people.map(row)));
    // what each screen downloaded to start, how fast it drew and what it runs on (page-health.js, the baseline)
    const start = (d.screens || []).filter((r) => startSub(r));
    if (start.length) c.appendChild(group({ header: 'Startup & Device', footer: 'Download counts the page and every file it fetched by its first screen. The frame rate is taken over 5 quiet seconds, never under the screensaver.' },
      start.map((r) => info(r.name, startSub(r), (r.device && r.device.platform) || '—'))));
    c.appendChild(group({}, [button('Refresh', () => { forget('performance'); redraw(); }, { center: true, fk: 'mx:performance-refresh' })]));
  } };
}
