// shim/page-health.js -- PAGE HEALTH (page_health.py, 2026-10-22), for the dashboard (home.js) and Mantel Settings.
//
// The wall tablets reload every 15 or 16 minutes, cut off mid-download, as if the page's process died. Mantel is told
// how the page before this one ended (it says goodbye on pagehide; one that never did, died) and, every minute, how
// big the page's JS heap is (Chrome's performance.memory, null elsewhere). Kept in this browser's localStorage only;
// numbers, nothing else.
//
// PERFORMANCE (Mantel Settings -> About -> Performance, performance.py): the same frames also carry how many sockets
// this page has had to open again since it loaded (hub.reconnects) and how many times it read the registry again
// (registryRefreshed(): bumped by registry-sync.js each time the house's registries change under an open page); and, once, the time to first draw (`draw`, sent
// by the page's own `drawn()`): ms from the start of the navigation to the first screen on the glass.
//
// BASELINE (2026-10-29, docs/development/Performance-baseline.md): three more things, all cheap and all told once or
// rarely. The `load` frame says what device this is (platform, memory, cores, screen). The `draw` frame says how much
// the page had downloaded by its first screen (bytes and files, the document included; a file out of the cache has
// no transferSize, so its encoded size stands for it). And an `fps` frame, ~20 s after load and hourly, says how
// many frames a second the page drew over 5 seconds -- taken only while the page is visible, nobody has touched it
// for 5 seconds and the screensaver / black screen is not up (a dark page draws nothing worth measuring).
const COUNT = '__mantelRegistryRefreshes';

// the page read the registry again (bump this where it does)
export function registryRefreshed() { window[COUNT] = (window[COUNT] || 0) + 1; }

// page: 'home' (the dashboard) or 'settings'; marks: the dashboard's __mantelMarks. Returns {drawn(), stop()}.
// what this device is, in a word: iPad Safari says "Macintosh", so a Mac with a touch screen is an iPad (push.js asks the same)
export function platformOf(ua = '', touch = 0) {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux|X11|CrOS/.test(ua)) return 'Linux';
  return 'Other';
}

export function pageHealth(hub, page = 'home', marks = null) {
  const KEY = page === 'home' ? 'mantel_page_health' : 'mantel_page_health_' + page;
  const t0 = Date.now();
  const mb = (n) => (typeof n === 'number' ? Math.round(n / 1048576) : null);
  const heap = () => { const m = performance.memory; return m ? { heap: mb(m.usedJSHeapSize), limit: mb(m.jsHeapSizeLimit) } : { heap: null, limit: null }; };
  const up = () => Math.round((Date.now() - t0) / 6000) / 10;
  const counts = () => ({ page, reconnects: hub.reconnects || 0, registry_refreshes: window[COUNT] || 0 });
  const keep = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* no storage */ } };
  const nav = typeof navigator === 'undefined' ? {} : navigator, scr = typeof screen === 'undefined' ? {} : screen;
  const device = () => ({ platform: platformOf(nav.userAgent || '', nav.maxTouchPoints || 0), memory_gb: nav.deviceMemory == null ? null : nav.deviceMemory,
                          cores: nav.hardwareConcurrency || null, sw: scr.width || null, sh: scr.height || null, dpr: window.devicePixelRatio || null });
  // everything fetched so far: the document and each file (a cached one has no transferSize; its encoded size is what it weighs)
  const download = () => {
    let bytes = 0, files = 0;
    try {
      for (const e of [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')]) { files++; bytes += e.transferSize || e.encodedBodySize || 0; }
    } catch (e) { /* no resource timing */ }
    return { dl_bytes: bytes, dl_files: files };
  };
  let before = null;
  try { before = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { before = null; }
  const prev = !before ? 'none' : before.closed ? 'clean' : 'died';
  hub.tell('page_health', { event: 'load', prev, prev_heap: before && before.heap, prev_up: before && before.up, ...heap(), ...counts(), ...device() });
  const beat = () => { const h = heap(); keep({ heap: h.heap, up: up(), closed: false }); return h; };
  beat();
  const timer = setInterval(() => { const h = beat(); hub.tell('page_health', { event: 'beat', up: up(), ...h, ...counts() }); }, 60000);
  window.addEventListener('pagehide', () => keep({ ...heap(), up: up(), closed: true }));
  // THE FRAME RATE: 5 s of requestAnimationFrame, only when the page is idle and lit
  const SAMPLE = 5000, IDLE = 5000, RETRY = 30000, HOUR = 3600000;
  let lastInput = performance.now(), fpsTimer = null;
  const touched = () => { lastInput = performance.now(); };
  for (const t of ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'wheel']) window.addEventListener(t, touched, { passive: true, capture: true });
  // is the screen dark? true / false; null when this page cannot tell (the dashboard loads the saver a moment after the page)
  const dark = () => {
    if (window.__hkAsleep) return true;
    const s = window.hkSaver;
    if (s && typeof s.black === 'function') return !!s.black();
    return page === 'home' ? null : false;
  };
  const calm = () => (typeof document === 'undefined' || document.visibilityState === 'visible') && performance.now() - lastInput >= IDLE && dark() === false;
  const later = (ms, tries) => { fpsTimer = setTimeout(() => attempt(tries), ms); };
  const attempt = (tries) => {
    if (!calm()) { later(tries < 20 ? RETRY : HOUR, tries + 1); return; }      // ten minutes of trying, then the next hour
    let first = null, last = null, frames = 0;
    const frame = (t) => {
      if (!calm() || (last !== null && t - last > 1500)) { later(RETRY, tries + 1); return; }     // somebody came, it went dark, or the page was paused
      if (first === null) first = t;
      last = t;
      if (frames++ && t - first >= SAMPLE) {
        hub.tell('page_health', { event: 'fps', fps: Math.round((frames - 1) / ((t - first) / 1000) * 10) / 10, ...counts() });
        later(HOUR, 0);
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  if (typeof requestAnimationFrame === 'function') later(20000, 0);
  let told = false;
  return {
    // the first screen is drawn: from the navigation's start (the dashboard's marks are ms after its module began)
    drawn() {
      if (told) return;
      told = true;
      const ms = marks && typeof marks.module_start === 'number' && typeof marks.rendered === 'number'
        ? marks.module_start + marks.rendered : performance.now();
      hub.tell('page_health', { event: 'draw', first_draw: Math.round(ms), ...download(), ...counts() });
    },
    stop() { clearInterval(timer); clearTimeout(fpsTimer); },
  };
}
