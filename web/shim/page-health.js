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
//
// RECOMMENDATIONS (2026-10-29): the sampling is HK's own (/hk/modules/hk-fps.js, the same rules), so a dashboard runs
// one sampler, not two; its `fps` frame also says the screen and the style it was drawn with (`screen`, `style`) and the
// sky and camera settings on it (`sig`, "blur:a1w1r1f0c1"), which HK Settings' "a lighter look for a slow tablet" -- one
// step at a time -- reads (GET /api/performance/tablets).
//
// SECURE CONTEXT (2026-11-02, docs/phase13/CAMERAS-DIRECT.md "The HTTPS check"): the `load` and `beat` frames also say
// whether this page is a secure context (window.isSecureContext: HTTPS with a certificate the browser trusts, or
// localhost -- the only pages a browser gives the microphone to) and the address it loaded from (location.origin), so
// Mantel Settings -> About -> Secure Connection can name the wall tablets that cannot talk at the door. The beat
// says them again every minute, so a restarted server has them back within one.
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
  // whether the microphone could be had here, and by what address (see SECURE CONTEXT above)
  const where = () => ({ secure: typeof window.isSecureContext === 'boolean' ? window.isSecureContext : null, origin: (typeof location !== 'undefined' && location.origin) || null });
  let before = null;
  try { before = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { before = null; }
  const prev = !before ? 'none' : before.closed ? 'clean' : 'died';
  hub.tell('page_health', { event: 'load', prev, prev_heap: before && before.heap, prev_up: before && before.up, ...heap(), ...counts(), ...device(), ...where() });
  const beat = () => { const h = heap(); keep({ heap: h.heap, up: up(), closed: false }); return h; };
  beat();
  const timer = setInterval(() => { const h = beat(); hub.tell('page_health', { event: 'beat', up: up(), ...h, ...counts(), ...where() }); }, 60000);
  window.addEventListener('pagehide', () => keep({ ...heap(), up: up(), closed: true }));
  // THE FRAME RATE: HK's one sampler (/hk/modules/hk-fps.js: 5 s of requestAnimationFrame, only when the page is idle
  // and lit). The dashboard's is the one hk-loader starts -- each sample is told, with the screen and the style it was
  // drawn with (HK Settings' recommendation reads them); another page (settings) runs one of its own, never dark.
  let fpsWatch = null, stopped = false;
  const tellFps = (s) => {
    if (stopped || !s || typeof s.fps !== 'number') return;
    hub.tell('page_health', { event: 'fps', fps: s.fps, ...(page === 'home' ? { screen: s.screen || null, style: s.style || null, sig: s.sig || null } : {}), ...counts() });
  };
  const onFps = (e) => tellFps(e && e.detail);
  if (page === 'home') window.addEventListener('hk-fps', onFps);
  else {
    const own = (F) => { if (F && F.watch && !stopped) fpsWatch = F.watch({ dark: () => !!window.__hkAsleep, onSample: (fps) => tellFps({ fps }) }); };
    if (window.hkFps) own(window.hkFps);
    else import('/hk/modules/hk-fps.js').then(() => own(window.hkFps)).catch(() => { /* no sampler: no frame rate */ });
  }
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
    stop() { stopped = true; clearInterval(timer); if (fpsWatch) fpsWatch.stop(); if (window.removeEventListener) window.removeEventListener('hk-fps', onFps); },
  };
}
