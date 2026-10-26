// shim/page-health.js -- PAGE HEALTH (page_health.py, 2026-10-22), for the dashboard (home.js) and Mantel Settings.
//
// The wall tablets reload every 15 or 16 minutes, cut off mid-download, as if the page's process died. Mantel is told
// how the page before this one ended (it says goodbye on pagehide; one that never did, died) and, every minute, how
// big the page's JS heap is (Chrome's performance.memory, null elsewhere). Kept in this browser's localStorage only;
// numbers, nothing else.
//
// PERFORMANCE (Mantel Settings -> About -> Performance, performance.py): the same frames also carry how many sockets
// this page has had to open again since it loaded (hub.reconnects) and how many times it read the registry again
// (registryRefreshed(): a counter later phases bump; 0 until then); and, once, the time to first draw (`draw`, sent
// by the page's own `drawn()`): ms from the start of the navigation to the first screen on the glass.
const COUNT = '__mantelRegistryRefreshes';

// the page read the registry again (bump this where it does)
export function registryRefreshed() { window[COUNT] = (window[COUNT] || 0) + 1; }

// page: 'home' (the dashboard) or 'settings'; marks: the dashboard's __mantelMarks. Returns {drawn(), stop()}.
export function pageHealth(hub, page = 'home', marks = null) {
  const KEY = page === 'home' ? 'mantel_page_health' : 'mantel_page_health_' + page;
  const t0 = Date.now();
  const mb = (n) => (typeof n === 'number' ? Math.round(n / 1048576) : null);
  const heap = () => { const m = performance.memory; return m ? { heap: mb(m.usedJSHeapSize), limit: mb(m.jsHeapSizeLimit) } : { heap: null, limit: null }; };
  const up = () => Math.round((Date.now() - t0) / 6000) / 10;
  const counts = () => ({ page, reconnects: hub.reconnects || 0, registry_refreshes: window[COUNT] || 0 });
  const keep = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* no storage */ } };
  let before = null;
  try { before = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { before = null; }
  const prev = !before ? 'none' : before.closed ? 'clean' : 'died';
  hub.tell('page_health', { event: 'load', prev, prev_heap: before && before.heap, prev_up: before && before.up, ...heap(), ...counts() });
  const beat = () => { const h = heap(); keep({ heap: h.heap, up: up(), closed: false }); return h; };
  beat();
  const timer = setInterval(() => { const h = beat(); hub.tell('page_health', { event: 'beat', up: up(), ...h, ...counts() }); }, 60000);
  window.addEventListener('pagehide', () => keep({ ...heap(), up: up(), closed: true }));
  let told = false;
  return {
    // the first screen is drawn: from the navigation's start (the dashboard's marks are ms after its module began)
    drawn() {
      if (told) return;
      told = true;
      const ms = marks && typeof marks.module_start === 'number' && typeof marks.rendered === 'number'
        ? marks.module_start + marks.rendered : performance.now();
      hub.tell('page_health', { event: 'draw', first_draw: Math.round(ms), ...counts() });
    },
    stop() { clearInterval(timer); },
  };
}
