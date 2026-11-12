// side_pane_check.cjs: the browser side of side_pane_check.py (Playwright, the gallery's fictional house)
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const KINDS = ['clock', 'weather', 'calendar', 'now_playing', 'security', 'camera', 'timers', 'energy', 'climate', 'people', 'todo', 'notifications'];
const SIZES = ['tiny', 'less', 'more', 'full'];
(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const browser = await pw[input.engine].launch({ headless: true, timeout: 20000 });
  const fails = [], notes = [];
  const shot = async (page, name) => { if (input.shots) await page.screenshot({ path: input.shots + '/' + name + '.png' }); };
  // the pane's state, from the page: where it is, whether it scrolls, the page's margins
  const look = (page) => page.evaluate(() => {
    const p = document.querySelector('hk-side-pane[mode="dash"]');
    const de = document.documentElement, st = de.style;
    const out = { on: !!(p && p.hasAttribute('on')), side: p && p.getAttribute('side'), attr: de.getAttribute('hk-pane'),
                  l: st.getPropertyValue('--hk-pane-l'), r: st.getPropertyValue('--hk-pane-r'), b: st.getPropertyValue('--hk-pane-b') };
    if (out.on) {
      const r = p.getBoundingClientRect(), secs = p.shadowRoot.querySelector('.secs');
      out.rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      out.scrolls = secs.scrollHeight > secs.clientHeight + 1;
      out.kinds = [...secs.children].map((k) => (k.dataset.k || k.className) + (k.dataset.size ? ':' + k.dataset.size : ''));
    }
    return out;
  });
  // A STATE CHANGE IN THE HOUSE: the server makes it and pushes it, as Home Assistant's would be (side_pane_check.py
  // states_from); done when the file is gone
  const setState = async (entity, state) => {
    fs.writeFileSync(input.stateFile + '.tmp', JSON.stringify({ entity, state }));
    fs.renameSync(input.stateFile + '.tmp', input.stateFile);
    for (let i = 0; i < 100 && fs.existsSync(input.stateFile); i++) await new Promise((r) => setTimeout(r, 50));
    if (fs.existsSync(input.stateFile)) throw new Error('the server never took the state change');
  };
  for (const [W, H] of input.sizes) {
    const context = await browser.newContext({ viewport: { width: W, height: H } });
    await context.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
    await context.route('**/*', (route) => new URL(route.request().url()).origin === input.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    let cur = '';
    // (the browser's benign "ResizeObserver loop" note is no error, as the other checks have it; nor is WebKit's
    // word for one of this page's own loads it cancelled when the check moved on, "<same-origin URL> due to access
    // control checks": the page catches that fetch (ha-elements.js), and it failed this check about every other run)
    const cancelled = (m) => /due to access control checks\.?$/.test(m) && m.indexOf(new URL(input.origin).host + '/') >= 0;
    page.on('pageerror', (e) => {
      if (!/ResizeObserver loop/.test(e.message) && !cancelled(e.message)) errors.push(cur + ': ' + e.message);
    });
    page.setDefaultTimeout(20000);
    const open = async (scr, view) => {
      cur = scr + '/' + (view || 'home');
      await page.goto(input.origin + '/' + scr + '/' + (view || 'home'));
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForTimeout(2500);
    };
    const tag = W + 'x' + H, phone = W < 640, upright = H > W;
    const want = (name, l, ok) => { if (!ok) fails.push(tag + ' ' + name + ': ' + JSON.stringify(l)); else notes.push(tag + ' ' + name + ' ok'); };
    for (const side of ['right', 'left']) {
      await open('pane-home-' + side);
      const l = await look(page);
      if (phone) want('home ' + side + ': never on a phone', l, !l.on && !l.attr);
      else if (upright) want('home ' + side + ': a band under the page', l, l.on && l.side === 'band' && l.b && !l.scrolls);
      else want('home ' + side + ': down its side at its Width (Standard, 400), the grid beside it', l, l.on && l.side === side && l[side[0]] && !l.scrolls &&
                l.rect[2] === 400 && (side === 'right' ? l.rect[0] + l.rect[2] === W : l.rect[0] === 0));
      await shot(page, tag + '-home-' + side);
    }
    // THE PANE'S MATERIAL IS THE SCREEN'S LOOK (the owner, 2026-10-30: "the side pane isn't blurred anymore?"):
    // see-through over a live blur in Blur and Bright Glass, near-solid with none in Frosted and Tinted; no
    // title over any section
    if (!phone && !upright) {
      for (const [g, blurs] of [['blur', true], ['bright', true], ['frosted', false], ['tinted', false]]) {
        cur = 'pane-home-right?hkglass=' + g;
        await page.goto(input.origin + '/pane-home-right/home?hkglass=' + g);
        await page.waitForFunction(() => window.__mantelReady === true);
        await require('./grid_ready.cjs')(page);
        await page.waitForTimeout(2000);
        const m = await page.evaluate(() => {
          const p = document.querySelector('hk-side-pane[mode="dash"]'), pane = p && p.shadowRoot.querySelector('.pane');
          if (!pane) return null;
          const cs = getComputedStyle(pane), bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
          const a = /rgba?\([^)]*,\s*([\d.]+)\)/.exec(cs.backgroundColor);
          return { look: p.getAttribute('look'), blur: bf, alpha: a ? +a[1] : (cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? 0 : 1),
                   // SECTION HEADINGS (on by default): over each section but the Clock and the Weather
                   titles: [...p.shadowRoot.querySelectorAll('.secs>[data-k]')].every((x) => (x.dataset.k === 'clock' || x.dataset.k === 'weather') === !x.querySelector(':scope>.h2')) };
        });
        want('the pane in ' + g, m, m && m.look === g && (blurs ? /blur/.test(m.blur) && m.alpha < 0.6 : !/blur/.test(m.blur) && m.alpha > 0.9) && m.titles);
        await shot(page, tag + '-look-' + g);
      }
      // SLIDING OUT AND IN (2026-11-01, the owner: "animate/slide out of the way when I swipe between pages"): Home to
      // another page, the pane slides off past its edge (drawn while it goes) and the tab bar glides to its new middle;
      // back Home, the pane slides in
      cur = 'pane-home-right slide';
      await page.goto(input.origin + '/pane-home-right/home');
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForTimeout(2500);
      const midway = await page.evaluate(async () => {
        const p = document.querySelector('hk-side-pane[mode="dash"]');
        const deep = (r, sel) => { const x = r.querySelector(sel); if (x) return x;
          for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) { const y = deep(e.shadowRoot, sel); if (y) return y; } } return null; };
        const tb = deep(document, '#hk-tabbar'), row = tb && tb.shadowRoot && tb.shadowRoot.querySelector('.row');
        const rx0 = row ? row.getBoundingClientRect().right : null;
        const to = ((window.hkCards.menu.config().views || []).map((v) => v.path).filter((v) => v && v !== 'home' && v !== 'weather'))[0];
        window.hkCards.navigate('./' + to, document.body);
        await new Promise((r) => setTimeout(r, 140));
        const t = getComputedStyle(p).transform, rx1 = row ? row.getBoundingClientRect().right : null;
        await new Promise((r) => setTimeout(r, 600));
        return { to, leaving: t, gone: !p.hasAttribute('on') && !p.hasAttribute('leaving') && getComputedStyle(p).display === 'none',
                 rx0, rx1, rx2: row ? row.getBoundingClientRect().right : null };
      });
      want('leaving Home: the pane slides off (a transform midway), then is gone', midway,
           midway.to && /matrix/.test(midway.leaving) && midway.leaving !== 'none' && midway.gone);
      want('...and the tab bar glides to its new middle (between where it was and where it ends)', midway,
           midway.rx0 !== null && midway.rx1 > midway.rx0 && midway.rx1 < midway.rx2);
      const back = await page.evaluate(async () => {
        const p = document.querySelector('hk-side-pane[mode="dash"]');
        window.hkCards.navigate('./home', document.body);
        await new Promise((r) => setTimeout(r, 140));
        const t = getComputedStyle(p).transform;
        await new Promise((r) => setTimeout(r, 600));
        return { coming: t, on: p.hasAttribute('on'), rest: getComputedStyle(p).transform };
      });
      want('...back Home: it slides in, and rests in place', back, back.on && /matrix/.test(back.coming) && back.rest === 'none');
      // ...AND WITH THE FINGER (2026-11-01, the owner: "if I swipe half way ... the side pane and navbar should also
      // move in motion with the page"): halfway, the pane half faded and the bar part way to its new middle; let go,
      // both finish, and the bar takes its new edges where it already is (no jump)
      cur = 'pane-swipe';
      await page.goto(input.origin + '/pane-swipe/home');
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForTimeout(2500);
      const sw = () => page.evaluate(() => {
        const deep = (r, sel) => { const x = r.querySelector(sel); if (x) return x;
          for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) { const y = deep(e.shadowRoot, sel); if (y) return y; } } return null; };
        const p = document.querySelector('hk-side-pane[mode="dash"]'), tb = deep(document, '#hk-tabbar'), row = tb && tb.shadowRoot.querySelector('.row'), rr = row && row.getBoundingClientRect();
        const plate = p && p.shadowRoot && p.shadowRoot.querySelector('.pane');
        return { path: location.pathname, op: plate ? +getComputedStyle(plate).opacity : null, hostOp: p ? +getComputedStyle(p).opacity : null, shown: p ? getComputedStyle(p).display !== 'none' :
          false, mid: rr ? Math.round(rr.left + rr.width / 2) : null,
                 rootShift: document.documentElement.style.getPropertyValue('--hk-pane-shift'), barShift: tb ? tb.style.getPropertyValue('--hk-pane-shift') : '' };
      });
      const s0 = await sw(), sy = 300;
      await page.mouse.move(700, sy); await page.mouse.down();
      for (let k = 1; k <= 10; k++) { await page.mouse.move(700 - 36 * k, sy); await page.waitForTimeout(16); }
      const s1 = await sw();
      await page.mouse.up();
      const mids = [];
      for (let k = 0; k < 14; k++) { await page.waitForTimeout(50); mids.push((await sw()).mid); }
      await page.waitForTimeout(600);
      const s2 = await sw();
      want('swiping off Home, halfway: the pane fading with the finger, the bar part way to its new middle', [s0, s1],
           s1.shown && s1.op > 0.2 && s1.op < 0.9 && s1.mid > s0.mid);
      // (the bar's offset on the bar, never on <html>: there every frame of a swipe restyled the whole document --
      // 2026-11-02, the owner's Kitchen tablet, "stutter" swiping between Home and the Pages screen)
      want('...the bar\'s offset set on the bar alone, not on <html>', s1, !s1.rootShift && !!s1.barShift);
      // (the plate fades, not the pane around it: below full opacity the pane would cut its own blur off from the page
      // behind it, a flat tint from the first frame of the swipe -- 2026-11-07)
      want('...the pane\'s plate fades, the pane itself stays opaque (its blur still sees the page)', s1, s1.hostOp === 1);
      want('...let go: the pane gone, the bar at its new middle without a step back (always forward)', [s2, mids],
           s2.path !== s0.path && !s2.shown && s2.mid > s1.mid && mids.every((m, j) => j === 0 || m >= mids[j - 1] - 1));
      // BACK FROM THE PAGES SCREEN (2026-11-01, the owner: "the HomeView Grid kind of snaps into place behind the side
      // pane ... the blur going from the Apps Page back to the HomeView seems to follow"): halfway, Home comes in at the
      // width it lands at, and the Pages screen's blur is a still layer as strong as the page is on; landed, the grid
      // is where it was all along (no frame elsewhere) and the layer is gone
      const gridAt = () => page.evaluate(() => {
        const deep = (r, sel) => { const x = r.querySelector(sel); if (x) return x;
          for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) { const y = deep(e.shadowRoot, sel); if (y) return y; } } return null; };
        const g = deep(document, 'hk-home-grid-view'), root = g && g.shadowRoot.querySelector('#root'), b = root && root.getBoundingClientRect();
        const ps = deep(document, 'hk-pages-screen-card'), bg = ps && ps.shadowRoot.querySelector('.bg');
        return { path: location.pathname, w: b ? Math.round(b.width) : null, bg: bg ? +getComputedStyle(bg).opacity : null,
                 layers: [...document.querySelectorAll('.hk-swipe-ground')].map((d) => +d.style.opacity) };
      });
      await page.mouse.move(300, sy); await page.mouse.down();
      for (let k = 1; k <= 10; k++) { await page.mouse.move(300 + 0.045 * W * k, sy); await page.waitForTimeout(16); }
      const h1 = await gridAt();
      await page.evaluate(() => {
        const deep = (r, sel) => { const x = r.querySelector(sel); if (x) return x;
          for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) { const y = deep(e.shadowRoot, sel); if (y) return y; } } return null; };
        window.__landing = []; const t0 = performance.now();
        const tick = () => {
          const g = deep(document, 'hk-home-grid-view'), root = g && g.shadowRoot.querySelector('#root'), b = root && root.getBoundingClientRect();
          if (/\/home$/.test(location.pathname) && b) window.__landing.push([Math.round(b.left), Math.round(b.width)]);
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.mouse.up();
      await page.waitForTimeout(1200);
      const h2 = await gridAt(), landed = await page.evaluate(() => window.__landing);
      want('swiping back from the Pages screen, halfway: Home at its own width, the blur a still layer, the page\'s own hidden', [s2.path, h1],
           /\/pages$/.test(s2.path) && h1.w && h1.bg === 0 && h1.layers.length === 1 && h1.layers[0] > 0.3 && h1.layers[0] < 0.8);
      want('...landed: the grid as wide as it came in, never a frame elsewhere, the layer gone', [h1.w, h2, landed.slice(0, 4)],
           /\/home$/.test(h2.path) && h2.w === h1.w && !h2.layers.length && landed.length > 5 &&
           landed.every((x) => x[0] === landed[landed.length - 1][0] && x[1] === h1.w));
      // A SLIDER IS ITS OWN (2026-11-01, the owner: "horizontal sliders like volume, cause the swipe page to trigger"):
      // the Music page's volume, drawn by hand and touch-action none, moves; the page stays
      await page.goto(input.origin + '/pane-swipe/playmusic');
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForTimeout(2000);
      const volAt = () => page.evaluate(() => {
        const deep = (r, sel) => { const x = r.querySelector(sel); if (x) return x;
          for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) { const y = deep(e.shadowRoot, sel); if (y) return y; } } return null; };
        // (the controls strip's volume track since 2026-11-09, hk-np-strip.js -- the Music page's own, not the Side Pane's)
        const m = deep(document, 'hk-music-card'), t = m && m.shadowRoot && m.shadowRoot.querySelector('.hks .mvt'), b = t && t.getBoundingClientRect();
        return b && { x: b.left, y: b.top + b.height / 2, w: b.width, v: +getComputedStyle(t).getPropertyValue('--v'), path: location.pathname };
      });
      const v0 = await volAt();
      if (v0) {
        await page.mouse.move(v0.x + v0.w * 0.2, v0.y); await page.mouse.down();
        for (let k = 1; k <= 10; k++) { await page.mouse.move(v0.x + v0.w * (0.2 + 0.06 * k), v0.y + 2); await page.waitForTimeout(16); }
        const moving = await page.evaluate(() => window.hkPageSwipe._.state().why);
        await page.mouse.up();
        await page.waitForTimeout(600);
        const v1 = await volAt();
        want('dragging the Music page\'s volume: the volume moves, the page does not', [v0, moving, v1],
             moving === 'its own' && v1 && v1.path === v0.path && v1.v > v0.v + 0.3);
      } else want('the Music page draws its volume', v0, false);
      // ...and the thermostat's dial on Home (the owner: "Thermostats may need to be looked at too?")
      await page.goto(input.origin + '/pane-swipe/home');
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForTimeout(2000);
      const dial = await page.evaluate(() => {
        const deep = (r, sel) => { const x = r.querySelector(sel); if (x) return x;
          for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) { const y = deep(e.shadowRoot, sel); if (y) return y; } } return null; };
        const t = deep(document, 'svg.ring'), b = t && t.getBoundingClientRect();
        return b && { x: b.left + b.width * 0.15, y: b.top + b.height * 0.55, w: b.width };
      });
      if (dial) {
        await page.mouse.move(dial.x, dial.y); await page.mouse.down();
        for (let k = 1; k <= 10; k++) { await page.mouse.move(dial.x + dial.w * 0.05 * k, dial.y - 3 * k); await page.waitForTimeout(16); }
        const owner = await page.evaluate(() => window.hkPageSwipe._.state().why);
        await page.mouse.up();
        await page.waitForTimeout(600);
        const here = await page.evaluate(() => location.pathname);
        want('turning the thermostat\'s dial sideways: the dial\'s, the page stays', [owner, here], owner === 'its own' && /\/home$/.test(here));
      } else want('Home draws the thermostat\'s dial', dial, false);
      // A SHORT PAGE'S EMPTY SCREEN, AND THE BACKGROUND FADING (2026-11-01, the owner: "I get stuck on the Live TV
      // page"; "make the backgrounds fade between page swipes but ONLY for swipes"): a press under a page shorter than
      // the screen swipes; let go, the page's background is the next one's under a copy that fades; a tap cuts
      await page.goto(input.origin + '/pane-swipe/security');
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForTimeout(2000);
      await page.evaluate(() => { const v = window.hkShell.view(window.hkShell.viewSlot(null));
        ['height', 'min-height', 'max-height'].forEach((k) => v.style.setProperty(k, '300px', 'important')); });
      await page.waitForTimeout(300);
      const skies = () => page.evaluate(() => { window.__skies = []; const t0 = performance.now(); const tick = () => {
        const all = document.querySelectorAll('#hk-sky'); window.__skies.push([all.length, all[1] ? +getComputedStyle(all[1]).opacity : null]);
        if (performance.now() - t0 < 1200) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      const below = await page.evaluate(() => (document.elementFromPoint(600, 690) || {}).localName);
      await page.mouse.move(300, 690); await page.mouse.down();
      for (let k = 1; k <= 12; k++) { await page.mouse.move(300 + 40 * k, 692); await page.waitForTimeout(16); }
      const went = await page.evaluate(() => !!(window.hkPageSwipe._.state().G || {}).live);
      await skies();
      await page.mouse.up();
      await page.waitForTimeout(1400);
      const swiped = await page.evaluate(() => ({ path: location.pathname, s: window.__skies }));
      const covers = swiped.s.filter((x) => x[0] === 2).map((x) => x[1]);
      want('a press under a short page swipes it', [below, went], went);
      want('...let go: the background fades (a copy over it, fading out, then gone)', [swiped.path, covers.slice(0, 3), swiped.s.slice(-1)],
           /\/pages$/.test(swiped.path) && covers.length > 2 && covers[0] > covers[covers.length - 1] && swiped.s[swiped.s.length - 1][0] === 1);
      await skies();
      await page.evaluate(() => window.hkCards.navigate('./security', document.body));
      await page.waitForTimeout(1400);
      const tapped = await page.evaluate(() => ({ path: location.pathname, most: Math.max(...window.__skies.map((x) => x[0])) }));
      want('...a tap on a page cuts: no fade', tapped, /\/security$/.test(tapped.path) && tapped.most === 1);
      // A WALL TABLET FOLLOWS ITS SCREEN (2026-11-01, the owner: "trying to change the Kitchen Tablet to
      // Kitchen-HomeView ... doesn't seem to work"): the gallery's Kitchen tablet on its screen; its Screen changed in
      // the settings, the page opens the new one (hk-idle.js followScreen)
      await page.goto(input.origin + '/dashboard-home/home?hk_tablet=kitchen');
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForTimeout(2000);
      const tabletSet = (screen) => page.evaluate(async (sc) => {
        const c = window.hkHostClient.current(), a = (c && c.actions) || c;
        try { await a.callWS({ type: 'hk_frontend/tablet/set', tablet: 'kitchen', changes: { screen: sc } }); return true; } catch (e) { return String(e); }
      }, screen);
      const before = await page.evaluate(() => ({ t: (window.hkSettings.tablet() || {}).screen, seen: localStorage.getItem('hk-tablet-screen') }));
      const setOk = await tabletSet('pane-home-right');
      let moved = '';
      try { await page.waitForURL(/\/pane-home-right/, { timeout: 8000 }); moved = await page.evaluate(() => location.pathname + location.search); } catch (e) { moved = 'stayed'; }
      want('the Kitchen tablet\'s Screen changed: its page opens the new screen, still the Kitchen tablet', [before, setOk, moved],
           before.t === 'dashboard-home' && setOk === true && moved === '/pane-home-right/0?hk_tablet=kitchen');
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await tabletSet('dashboard-home');
      // (the page follows its tablet back too, when the change reaches it: once there, so that follow can't land in the
      // middle of the next page.goto -- 2026-11-02, 22 steps at once: "interrupted by another navigation")
      await page.waitForURL(/\/dashboard-home/, { timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      // A FINGER, NOT A MOUSE (2026-11-01, the owner's Pixel Tablet: "I can sort of swipe to the Apps page, but I cant
      // go anywhere else"): a touch swipe off the Pages screen lands on the next page -- its one screen of icons said
      // nothing about the sideways pan, so the browser took it for the strip and cancelled the swipe. Chromium only
      // (a Pixel's web view; touch through the DevTools protocol)
      if (input.engine === 'chromium') {
        const tctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });
        await tctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
        await tctx.route('**/*', (route) => new URL(route.request().url()).origin === input.origin ? route.continue() : route.abort());
        const tp = await tctx.newPage(), cdp = await tctx.newCDPSession(tp);
        await tp.goto(input.origin + '/pane-swipe/pages');
        await tp.waitForFunction(() => window.__mantelReady === true);
        await require('./grid_ready.cjs')(tp);
        await tp.waitForTimeout(2000);
        const at = (x) => [{ x, y: Math.round(H * 0.5), id: 1, radiusX: 4, radiusY: 4, force: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(Math.round(W * 0.75)) });
        for (let k = 1; k <= 14; k++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(Math.round(W * (0.75 - 0.035 * k))) });
          await tp.waitForTimeout(16);
        }
        const tlive = await tp.evaluate(() => !!(window.hkPageSwipe._.state().G || {}).live);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await tp.waitForTimeout(1500);
        const tpath = await tp.evaluate(() => location.pathname);
        want('a finger swipes off the Pages screen to the next page', [tlive, tpath], tlive && /\/security$/.test(tpath));
        await tctx.close();
      }
      // DIM (2026-11-01, the owner: "a bit too light to see the text"): a shade over the glass, none unless set
      const shade = (pane) => page.evaluate(() => {
        const p = document.querySelector('hk-side-pane[mode="dash"]'), pane = p && p.shadowRoot.querySelector('.pane');
        return pane ? getComputedStyle(pane, '::before').backgroundColor : null;
      });
      want('no shade unless Dim is set', await shade(), (await shade()) === null || !/0\.45/.test(await shade()));
      cur = 'pane-home-dim?hkglass=bright';
      await page.goto(input.origin + '/pane-home-dim/home?hkglass=bright');
      await page.waitForFunction(() => window.__mantelReady === true);
      await require('./grid_ready.cjs')(page);
      await page.waitForTimeout(2000);
      const dimmed = await shade();
      want('Dim High shades the pane', dimmed, /rgba\(0, 0, 0, 0\.45\)/.test(String(dimmed)));
      // (a slider since that afternoon: the Settings page's preview follows it as it moves, before it is saved)
      await page.evaluate(() => window.hkSidePane.dim(20));
      await page.waitForTimeout(300);
      const held = await shade();
      want('...the slider moving: the pane follows it at once', held, /rgba\(0, 0, 0, 0\.2\)/.test(String(held)));
      await shot(page, tag + '-dim-high');
    }
    // WHILE A SONG PLAYS THE WHOLE PANE IS ITS ART (2026-10-30): the pane's own ground the art blurred, the music card
    // with no backdrop or box of its own, white words over its lightest part at 4.5:1; a flat tint where the look has
    // no blur; stopped, the screen's glass again
    if (!phone && !upright) {
      for (const [g, tinted, side] of [['blur', false, 'right'], ['tinted', true, 'right'], ['blur', false, 'left']]) {
        cur = 'pane-home-' + side + '?hkglass=' + g;
        await page.goto(input.origin + '/pane-home-' + side + '/home?hkglass=' + g);
        await page.waitForFunction(() => window.__mantelReady === true);
        await require('./grid_ready.cjs')(page);
        await page.waitForTimeout(3500);
        const a = await page.evaluate(async () => {
          const p = document.querySelector('hk-side-pane[mode="dash"]'), sr = p && p.shadowRoot;
          if (!sr) return null;
          const card = sr.querySelector('hk-music-pane-card'), on = sr.querySelector('.artbg b.on');
          const own = card && card.shadowRoot ? [...card.shadowRoot.querySelectorAll('.mbgf,.mshade')].filter((e) => getComputedStyle(e).display !== 'none').length : -1;
          let worst = null;
          // the drawn art's lightest pixel (a small PNG), under the shade's lighter top (.24)
          const url = on && /url\("(data:[^"]+)"\)/.exec(on.style.backgroundImage);
          if (url) {
            const im = new Image(); im.src = url[1];
            await im.decode().catch(() => {});
            const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
            const x = cv.getContext('2d'); x.drawImage(im, 0, 0);
            const d = x.getImageData(0, 0, cv.width, cv.height).data; let hi = 0;
            for (let i = 0; i < d.length; i += 4) hi = Math.max(hi, 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
            const v = (hi * 0.76 + 8 * 0.24) / 255, lum = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            worst = +((1.05) / (lum + 0.05)).toFixed(2);
          }
          return { arted: p.hasAttribute('arted'), tint: p.hasAttribute('arttint'), tintColor: p.style.getPropertyValue('--art-tint'), nobg: !!(card && card.hasAttribute('nobg')), own, worst };
        });
        // (the mini player at More, 2026-10-31, has no backdrop of its own; Full's music pane drops its own: nobg)
        want('playing in ' + g + ' on the ' + side + ': the whole pane takes the album art', a, a && a.arted && (a.own === -1 || (a.nobg && a.own === 0)) &&
             (tinted ? a.tint && /^rgb\(/.test(a.tintColor) : !a.tint && a.worst >= 4.5));
        await shot(page, tag + '-playing-' + g + '-' + side);
        // EVERY PLAYER'S LOOK (player_look.js): the music pane at Full -- no wells, the pause glyph's ink halfway
        // between the progress bar and the volume's track
        await page.evaluate(fs.readFileSync(__dirname + '/player_look.js', 'utf8'));
        const look = await page.evaluate(() => {
          const card = document.querySelector('hk-side-pane[mode="dash"]').shadowRoot.querySelector('hk-music-pane-card');
          return card && card.shadowRoot ? playerLook(card.shadowRoot, { bar: '.mbar', pp: '.mpp svg', vol: '.mvt', buttons: '.mctl .mbtn' }) : null;
        });
        want('...its player bare, the pause halfway between the bars', look, !look || (!look.wells.length && (look.above === undefined || Math.abs(look.above - look.below) <= 3)));
        // STOPPED: paused through the house, past Hide After a Pause (made 0 here), Now Playing steps aside -- and
        // with it the art, back to the screen's glass
        await page.evaluate(() => {
          window.hkCards.menu.npGrace = () => 0;
          return window.hkCards.client().actions.callService('media_player', 'media_play_pause', {}, { entity_id: 'media_player.living_room' });
        });
        await page.waitForTimeout(3500);
        const stopped = await page.evaluate(() => document.querySelector('hk-side-pane[mode="dash"]').hasAttribute('arted'));
        want('...stopped, the screen\'s glass again', stopped, stopped === false);
        // (and playing again, for the next screen's)
        await page.evaluate(() => window.hkCards.client().actions.callService('media_player', 'media_play_pause', {}, { entity_id: 'media_player.living_room' }));
        await page.waitForTimeout(500);
        if (g === 'blur') await shot(page, tag + '-stopped-' + side);
      }
    }
    // THE SAME EVERYWHERE (2026-10-30): its hairlines and its second ink resolved (the sheet once built before
    // hkCards came had neither), and the weather still there on a page Mantel has narrowed to what it reads
    const drawn = (sel) => page.evaluate((sel) => {
      const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
      const p = deep(document, sel)[0], sr = p && p.shadowRoot;
      if (!sr || !p.hasAttribute('on')) return null;
      const lines = [...sr.querySelectorAll('.secs>.sec+.sec')].map((x) => getComputedStyle(x)), sub = sr.querySelector('.sub2,.ev .et i');
      const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const p2 = m ? m[1].split(',').map(Number) : []; return p2.length > 3 ? p2[3] : 1; };
      const wx = sr.querySelector('[data-k="weather"]');
      return { lines: lines.length, ruled: lines.every((cs) => cs.borderTopStyle === 'solid' && alpha(cs.borderTopColor) > 0),
               sub: sub ? getComputedStyle(sub).color : null, weather: wx ? wx.textContent.trim().slice(0, 40) : null };
    }, sel);
    if (!phone) {
      const views0 = await page.evaluate(() => (window.hkCards.menu.config().views || []).map((v) => v.path).filter(Boolean));
      // (a page with no weather of its own: Lights, else the first that isn't Home or Weather)
      const away = views0.indexOf('lights') >= 0 ? 'lights' : views0.filter((v) => v !== 'home' && v !== 'weather')[0];
      await open('pane-every-page', away);
      await page.waitForTimeout(4500);            // the page narrows (web/home.js), then the pane draws again
      const d = await drawn('hk-side-pane[mode="dash"]');
      want('every page: its dividers drawn and its second ink grey', d, d && (upright || (d.lines > 0 && d.ruled)) && d.sub && d.sub !== 'rgb(255, 255, 255)');
      want('...the weather still there on a narrowed page (' + away + ')', d, d && d.weather && /\d°/.test(d.weather) && d.weather.indexOf('No weather') < 0);
      await shot(page, tag + '-narrowed-' + away);
    }
    // AT THE TOP AND AT THE FOOT, AND A TAP ON EACH (2026-10-30)
    if (!phone && !upright) {
      await open('pane-placed');
      await page.waitForTimeout(1500);
      const pl = await page.evaluate(() => {
        const p = document.querySelector('hk-side-pane[mode="dash"]'), sr = p.shadowRoot, pr = p.getBoundingClientRect();
        const mp = sr.querySelector('[data-k="now_playing"]'), card = sr.querySelector('hk-music-pane-card');
        const view = card && card.shadowRoot && card.shadowRoot.querySelector('[nomx]');
        const ev = sr.querySelector('.evs.scroll');
        return { order: [...sr.querySelectorAll('.secs>[data-k]')].map((x) => x.dataset.k), gap: !!sr.querySelector('.secs>.gap'),
                 foot: mp ? Math.round(pr.bottom - mp.getBoundingClientRect().bottom) : null,
                 // (Speakers and Browse: the mini player's own, Less and More, 2026-10-31; Full's, the music pane's)
                 mx: !!(mp && mp.querySelector('[data-act="spk"]') && mp.querySelector('[data-act="brw"]')) || (!!card && !view),
                 scroll: ev ? getComputedStyle(ev).overflowY : null, evs: sr.querySelectorAll('[data-ev]').length, people: sr.querySelectorAll('[data-ent^="person."]').length };
      });
      want('placed: the music at the foot, under a space, with its Speakers and Browse', pl,
           pl.order[pl.order.length - 1] === 'now_playing' && pl.gap && pl.foot !== null && pl.foot < 60 && pl.mx);
      // (the gallery's calendars may hold nothing coming up: then only the people; test_sidepane.js has the events)
      want('...the calendar\'s events scrolling inside it, each a target; the people each a target', pl, (pl.evs === 0 || pl.scroll === 'auto') && pl.people > 0);
      await shot(page, tag + '-placed');
      // a tap on a person: their sheet
      const sheet = await page.evaluate(async () => {
        const sr = document.querySelector('hk-side-pane[mode="dash"]').shadowRoot, who = sr.querySelector('[data-ent^="person."]');
        let got = null; const D = window.hkDetail, was = D.open; D.open = (id) => { got = id; };
        who.click(); D.open = was; return got;
      });
      want('...a tap on a person opens their sheet', sheet, /^person\./.test(sheet || ''));
      // a tap on the weather: its page -- and the pane the same width there as beside Home's grid (it once took what
      // the grid left on Home and its Width elsewhere, so going to a page re-laid Home out first: the owner's
      // "resize on first load", 2026-10-30)
      const paneR = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--hk-pane-r'));
      const homeR = await paneR();
      const went = await page.evaluate(async () => {
        const sr = document.querySelector('hk-side-pane[mode="dash"]').shadowRoot;
        sr.querySelector('[data-k="weather"]').click();
        await new Promise((r) => setTimeout(r, 900));
        return location.pathname;
      });
      want('...a tap on the weather goes to its page', went, /\/weather$/.test(went));
      const awayR = await paneR();
      want('...the pane as wide there as beside Home\'s grid (no page laid out again on the way)', [homeR, awayR], homeR && homeR === awayR);
    }
    // THE ALBUM ART BACKGROUND IS A SWITCH (2026-10-31, item 41): on by default (the art blurred behind the pane while a
    // song plays); a Now Playing section that sets it off leaves the pane its ordinary ground
    if (!phone && !upright) {
      const art = {};
      for (const k of ['on', 'off']) {
        await open('pane-art-' + k);
        await page.waitForTimeout(2500);
        art[k] = await page.evaluate(() => { const p = document.querySelector('hk-side-pane[mode="dash"]');
          return { arted: p.hasAttribute('arted'), layers: p.shadowRoot.querySelectorAll('.artbg b').length }; });
        await shot(page, tag + '-art-' + k);
      }
      want('Album Art Background: on, the pane takes the art; off (the section\'s switch), its ordinary ground', art, art.on.arted && art.on.layers > 0 && !art.off.arted && art.off.layers === 0);
    }
    // NOW PLAYING'S WHEN TAPPED (2026-10-31, item 44): a tap on the song's own words (no button) opens the Speakers /
    // Volume / Queue / Browse panel over the pane, in place -- or, set to Flip, turns the section over to it (the
    // section hidden once it has turned); Escape closes it and the section is back
    if (!phone && !upright) {
      const panelState = () => page.evaluate(() => {
        const host = [...document.body.children].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.mpanel'));
        const pane = document.querySelector('hk-side-pane[mode="dash"]'), pr = pane.getBoundingClientRect();
        const np = pane.shadowRoot.querySelector('[data-k="now_playing"]');
        if (!host) return { open: false, shown: np ? getComputedStyle(np).visibility : null };
        const mp = host.shadowRoot.querySelector('.mpanel'), r = mp.getBoundingClientRect();
        const mini = host.shadowRoot.querySelector('.mpmini'), hd = host.shadowRoot.querySelector('.mphd');
        return { open: true, inPane: r.left >= pr.left - 1 && r.right <= pr.right + 1 && r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1,
                 drawer: mp.classList.contains('dr'), playerFirst: !!(mini && hd && mini.getBoundingClientRect().bottom <= hd.getBoundingClientRect().top + 1),
                 tabs: [...host.shadowRoot.querySelectorAll('.mptabs div')].map((x) => x.textContent.trim()).join('|'), shown: np ? np.style.visibility : null };
      });
      // (Automatic, When Tapped unset: the drawer too -- 2026-11-01, the owner: a tap on the song opened the detail
      // sheet; the player rises to the pane's top, the tabs under it)
      for (const how of ['panel', 'flip', 'auto']) {
        await open(how === 'auto' ? 'pane-art-on' : 'pane-tap-' + how);
        await page.waitForTimeout(2000);
        await page.evaluate(() => document.querySelector('hk-side-pane[mode="dash"]').shadowRoot.querySelector('[data-k="now_playing"] .np .tx b').click());
        if (how !== 'panel') { await page.waitForTimeout(140); await shot(page, tag + '-tap-' + how + '-moving'); }
        await page.waitForTimeout(900);
        const st = await panelState();
        want('Now Playing tapped (' + how + '): the panel open inside the pane, its three tabs (no Volume since 2026-11-12)' + (how === 'flip' ? ', the section turned away' : ''), st,
             st.open && st.inPane && /Speakers.*Queue.*Browse/i.test(st.tabs) && !/Volume/.test(st.tabs) && (how !== 'flip' || st.shown === 'hidden') &&
             (how === 'flip' || (st.drawer && st.playerFirst)));
        await shot(page, tag + '-tap-' + how);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1200);
        const back = await panelState();
        want('...Escape closes it' + (how === 'flip' ? ', the section turned back' : ''), back, !back.open && back.shown !== 'hidden');
      }
      // THE COVER: the screensaver's music, full screen (2026-11-01); a screen with none, the drawer (above)
      await open('pane-cover');
      await page.waitForTimeout(2000);
      await page.evaluate(() => document.querySelector('hk-side-pane[mode="dash"]').shadowRoot.querySelector('[data-k="now_playing"] .art').click());
      await page.waitForTimeout(1500);
      const full = await page.evaluate(() => ({ on: window.hkSaver.running(), music: window.hkSaver.stats().musicSlide }));
      want('...its cover: the music full screen', full, full.on && full.music);
      await shot(page, tag + '-tap-cover');
      await page.evaluate(() => window.hkSaver.stop());
    }
    // THE CLOCK'S SIX LOOKS, A TO F (2026-10-31, item 43; the "Side Pane clock styles" board): each a screen whose Side Pane
    // clock sets its choices, drawn at the screen's own pane. A is today's clock; B right with no AM/PM; C centered,
    // large, light, the colon flashing (where animations are on), the short date; D right, large, bold, the sunset
    // line; E stacked; F the small analog face. Upright (a band under the page): one of them is drawn.
    if (!phone) {
      const readClock = () => page.evaluate(() => {
        const p = document.querySelector('hk-side-pane[mode="dash"]'), sr = p && p.shadowRoot, ck = sr && sr.querySelector('[data-k="clock"]');
        if (!ck) return null;
        const big = ck.querySelector('.big2'), tm = ck.querySelector('.tm'), cs = big ? getComputedStyle(big) : null;
        const S = window.hkSettings, anim = !(S && S.skyLook && S.skyLook().animations === false);
        return { cls: ck.className, ampm: !!ck.querySelector('.tm small'), colon: !!ck.querySelector('.ckc'), anim, sun: !!ck.querySelector('.sun'), ds: !!ck.querySelector('.ds'),
                 line2: (ck.querySelector('.ck2') || {}).textContent || '', stk: !!ck.querySelector('.stk'), analog: !!ck.querySelector('.ckan svg.face'),
                 weight: cs ? +cs.fontWeight : 0, size: cs ? parseFloat(cs.fontSize) : 0, align: getComputedStyle(ck).textAlign,
                 h: Math.round(ck.getBoundingClientRect().height), scrolls: p.shadowRoot.querySelector('.secs').scrollHeight > p.shadowRoot.querySelector('.secs').clientHeight + 1 };
      });
      const looks = {};
      for (const k of upright ? ['D'] : input.looks) {
        await open('pane-clock-' + k.toLowerCase());
        await page.waitForTimeout(1500);
        looks[k] = await readClock();
        await shot(page, tag + '-clock-' + k);
      }
      if (!upright) {
        const L = looks;
        want('clock A: today\'s -- digits with AM/PM, the date and the sunset, no extra classes', L.A, L.A && /^sec\b/.test(L.A.cls) && !/ck[asw]-/.test(L.A.cls) && L.A.ampm && L.A.sun &&
          !L.A.colon && !L.A.line2 && L.A.weight === 600);
        want('clock B: right, no AM/PM', L.B, L.B && /cka-right/.test(L.B.cls) && !L.B.ampm && L.B.align === 'right');
        want('clock C: centered, large, light, the colon flashing (where animations are on), the short date, and larger than A', [L.C, L.A],
             L.C && /cka-center/.test(L.C.cls) && L.C.weight === 300 && L.C.size > L.A.size * 1.2 && L.C.colon === L.C.anim && !L.C.ampm && L.C.align === 'center');
        want('clock D: right, large, bold, with the sunset on a line of its own', L.D, L.D && /cka-right/.test(L.D.cls) && L.D.weight === 700 && /^Sunset /.test(L.D.line2) && !L.D.sun);
        want('clock E: stacked', L.E, L.E && L.E.stk && !L.E.ampm);
        want('clock F: the small analog face with the time and date beside it', L.F, L.F && L.F.analog);
        want('...none of them makes the pane scroll', looks, Object.values(looks).every((x) => x && !x.scrolls));
      } else {
        want('clock D in a band under the page', looks.D, looks.D && looks.D.line2.indexOf('Sunset') === 0);
      }
    }
    // THE CAMERA'S STILL LOADS (2026-10-31, the owner's item 42: a "?" over "Driveway Camera ..." forever -- the address
    // carried a query Mantel's still route refuses): each camera section's picture decoded (naturalWidth > 0) over
    // its glyph, no request for a still refused, and its name hidden unless the section says Show
    if (!phone && !upright) {
      const bad = [];
      const onRes = (r) => { if (/\/api\/camera\/.+\/still/.test(r.url()) && r.status() >= 400) bad.push(r.status() + ' ' + r.url()); };
      page.on('response', onRes);
      await open('pane-camera');
      await page.waitForTimeout(2500);
      const cam = await page.evaluate(() => {
        const sr = document.querySelector('hk-side-pane[mode="dash"]').shadowRoot;
        return [...sr.querySelectorAll('.cam2[data-k="camera"]')].map((n) => {
          const im = n.querySelector('img'), cn = n.querySelector('.cn'), g = n.querySelector('.cg');
          return { cam: n.dataset.cam, name: n.dataset.name, loaded: !!(im && im.complete && im.naturalWidth > 0), src: im ? im.getAttribute('src') : null,
                   glyph: !!g, nameShown: !!cn && getComputedStyle(cn).display !== 'none' };
        });
      });
      page.off('response', onRes);
      want('camera: two sections, each still loaded (naturalWidth > 0) over its glyph, none refused', [cam, bad],
           cam.length === 2 && cam.every((c) => c.loaded && c.glyph && /_hk=\d+/.test(c.src) && c.src.indexOf('hk_n') < 0) && !bad.length);
      want('...the name hidden by default, shown when the section says Show', cam, cam[0].name === 'hide' && !cam[0].nameShown && cam[1].name === 'show' && cam[1].nameShown);
      // ...and refreshed in place: a later still (a new counter) replaces the first without a redraw
      await page.waitForTimeout(10500);
      const again = await page.evaluate(() => {
        const im = document.querySelector('hk-side-pane[mode="dash"]').shadowRoot.querySelector('.cam2 img');
        return im ? { src: im.getAttribute('src'), ok: im.complete && im.naturalWidth > 0 } : null;
      });
      want('...refreshed in place: a newer still, loaded', [cam[0].src, again], again && again.ok && again.src !== cam[0].src);
      await shot(page, tag + '-camera');
    }
    await open('pane-every-page');
    let l = await look(page);
    want('every page: Home', l, phone ? !l.on : l.on && !l.scrolls);
    await shot(page, tag + '-every-page-home');
    const views = await page.evaluate(() => (window.hkCards.menu.config().views || []).map((v) => v.path).filter(Boolean));
    const other = views.filter((v) => v !== 'home')[0];
    if (other) {
      await open('pane-every-page', other);
      l = await look(page);
      const margin = await page.evaluate(() => { const v = window.hkShell.viewSlot(window.hkCards.menu.panel()); return v ? v.style.marginRight : ''; });
      want('every page: ' + other + ', narrowed by the pane', [l, margin], phone ? !l.on : upright ? l.on && l.side === 'band' : l.on && margin === l.r);
      await shot(page, tag + '-every-page-' + other);
    }
    await open('pane-eight');
    l = await look(page);
    want('eight sections together: fitted, never scrolling', l, phone ? !l.on : l.on && !l.scrolls);
    if (l.on) notes.push(tag + ' eight drawn as ' + l.kinds.join(', '));
    await shot(page, tag + '-eight');
    for (const side of ['right', 'left']) {
      await open('pane-saver-' + side);
      await require('./grid_ready.cjs').saver(page);
      await page.evaluate(() => window.hkSaver.preview(true));
      await page.waitForTimeout(3500);
      const s = await page.evaluate(() => {
        const host = document.querySelector('hk-screensaver') || [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.pane hk-side-pane'));
        const sp = host && host.shadowRoot && host.shadowRoot.querySelector('.pane hk-side-pane');
        const pane = host && host.shadowRoot && host.shadowRoot.querySelector('.pane');
        const r = pane && pane.getBoundingClientRect();
        return { saver: !!host, side: host && host.getAttribute('pside'), on: !!(sp && sp.hasAttribute('on')),
                 rect: r ? [Math.round(r.left), Math.round(r.width)] : null,
                 kinds: sp ? [...sp.shadowRoot.querySelectorAll('.secs > *')].map((k) => (k.dataset.k || '') + ':' + (k.dataset.size || '')) : [] };
      });
      want('screensaver ' + side + ': its own sections on its side', s, phone ? !s.on : s.on &&
        (side === 'left' ? s.side !== null && s.rect[0] === 0 : s.side === null && s.rect[0] + s.rect[1] === W));
      const sd = await drawn('hk-side-pane[mode="saver"]');
      want('screensaver ' + side + ': its dividers and second ink as the Dashboard\'s, its weather there', sd,
           phone ? sd === null : sd && sd.lines > 0 && sd.ruled && sd.sub !== 'rgb(255, 255, 255)' && (!sd.weather || (/\d°/.test(sd.weather) && sd.weather.indexOf('No weather') < 0)));
      await shot(page, tag + '-saver-' + side);
      await page.evaluate(() => window.hkSaver.preview(false));
    }
    // A STATUS (2026-11-06, the owner's Mail chip as a section): hidden while the mailbox says No Mail -- beside the
    // weather, and alone, where the whole pane steps aside -- shown as soon as the house says Mail Likely Delivered (its
    // glyph in the chip's blue, its name and label), and gone again when the mail is taken in
    const status = () => page.evaluate(() => {
      const p = document.querySelector('hk-side-pane[mode="dash"]'), sec = p && p.hasAttribute('on') && p.shadowRoot.querySelector('.secs>[data-k="status"]');
      if (!sec) return null;
      const g = sec.querySelector('hk-icon'), r = sec.getBoundingClientRect(), pr = p.getBoundingClientRect();
      return { size: sec.dataset.size, text: sec.textContent.replace(/\s+/g, ' ').trim(), icon: g && g.getAttribute('icon'),
               color: g && getComputedStyle(g).color, inside: r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1 && r.height > 20 };
    });
    for (const scr of ['pane-status', 'pane-status-alone']) {
      await setState('sensor.mailbox_status', 'No Mail');
      await open(scr);
      let l = await look(page);
      const alone = scr === 'pane-status-alone';
      want(scr + ': no mail, no status' + (alone ? ' -- and no pane' : ', the weather still there'), [l, await status()],
           phone || alone ? !l.on && !l.attr : l.on && !(await status()) && l.kinds.some((k) => k.startsWith('weather')));
      await shot(page, tag + '-' + scr + '-hidden');
      await setState('sensor.mailbox_status', 'Mail Likely Delivered');
      if (!phone) await page.waitForFunction(() => { const p = document.querySelector('hk-side-pane[mode="dash"]'); return p && p.hasAttribute('on') &&
        p.shadowRoot.querySelector('.secs>[data-k="status"]'); }, null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(700);
      const st = await status();
      l = await look(page);
      if (phone) want(scr + ': the mail come, still no pane on a phone', l, !l.on);
      else want(scr + ': the mail come, the status shown at once -- the chip\'s glyph in its blue, its name and label', st,
                !!st && st.inside && st.icon === 'hk:mailbox-up' && /^rgba?\(86, 189, 228/.test(st.color) && /Mail/.test(st.text) && /Likely Delivered/.test(st.text) &&
                (upright || st.size === (alone ? 'more' : 'less')));
      await shot(page, tag + '-' + scr + '-shown');
      await setState('sensor.mailbox_status', 'No Mail');
      if (!phone) await page.waitForFunction(() => { const p = document.querySelector('hk-side-pane[mode="dash"]');
        return !(p && p.hasAttribute('on') && p.shadowRoot.querySelector('.secs>[data-k="status"]')); }, null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(700);
      l = await look(page);
      want(scr + ': the mail taken in, the status gone again' + (alone ? ', the pane with it' : ''), [l, await status()],
           !(await status()) && (phone || alone ? !l.on : l.on));
    }
    // ...and at its three sizes side by side (a pane of its own), the mail come
    if (!phone && !upright && input.shots) {
      await setState('sensor.mailbox_status', 'Mail Likely Delivered');
      await open('pane-none');
      await page.evaluate((mail) => {
        ['tiny', 'less', 'more'].forEach((size, i) => {
          const el = window.hkSidePane.create('dash'); el.className = 'solo3'; document.body.appendChild(el);
          Object.assign(el.style, { left: (i * 365) + 'px', top: '0px', bottom: '0px', width: '360px' });
          el.show({ list: [Object.assign({}, mail, { size })], place: { kind: 'side', w: 360 }, side: 'left' });
        });
      }, { kind: 'status', entity: 'sensor.mailbox_status', icon: 'hk:mailbox-up', color: 'blue', name: 'Mail', label: 'Likely Delivered' });
      await page.waitForTimeout(800);
      await shot(page, tag + '-alone-status');
      await page.evaluate(() => document.querySelectorAll('.solo3').forEach((e) => e.remove()));
      await setState('sensor.mailbox_status', 'No Mail');
    }
    // EVERY SECTION ALONE AT EACH SIZE (a pane of its own, beside nothing), at the tablet's size only
    if (!phone && !upright) {
      await open('pane-none');
      for (const kind of KINDS) {
        for (const size of SIZES) {
          const got = await page.evaluate(([kind, size]) => {
            let el = document.getElementById('solo');
            if (!el) { el = window.hkSidePane.create('dash'); el.id = 'solo'; document.body.appendChild(el); }
            Object.assign(el.style, { left: '0px', top: '0px', bottom: '0px', width: '400px' });
            el.show({ list: [{ kind, size }], place: { kind: 'side', w: 400 }, side: 'left' });
            const secs = el.shadowRoot.querySelector('.secs'), k = secs.firstElementChild;
            // (a button cut off by its section: the owner, 2026-11-01, Now Playing's play at Tiny, the pane's last section)
            const kr = k && k.getBoundingClientRect();
            const cut = k ? [...k.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.height && (r.top < kr.top - 0.5 || r.bottom > kr.bottom + 0.5); }).length :
              0;
            return { k: k && (k.dataset.k + ':' + k.dataset.size), h: k ? Math.round(kr.height) : 0, scrolls: secs.scrollHeight > secs.clientHeight + 1, cut };
          }, [kind, size]);
          want('alone ' + kind + ' ' + size, got, got.k === kind + ':' + size && got.h > 0 && !got.scrolls && !got.cut);
        }
        await page.waitForTimeout(300);
        if (input.shots) {
          // the four sizes of one kind side by side
          await page.evaluate((kind) => {
            document.querySelectorAll('.solo4').forEach((e) => e.remove());
            const S = ['tiny', 'less', 'more', 'full'];
            document.getElementById('solo').style.display = 'none';
            S.forEach((size, i) => {
              const el = window.hkSidePane.create('dash'); el.className = 'solo4'; document.body.appendChild(el);
              Object.assign(el.style, { left: (i * 295) + 'px', top: '0px', bottom: '0px', width: '290px' });
              el.show({ list: [{ kind, size }], place: { kind: 'side', w: 290 }, side: 'left' });
            });
          }, kind);
          await page.waitForTimeout(600);
          await shot(page, tag + '-alone-' + kind);
          await page.evaluate(() => { document.querySelectorAll('.solo4').forEach((e) => e.remove()); document.getElementById('solo').style.display = ''; });
        }
      }
      // A SHORT PANE, LISTS IN IT (2026-10-30, the owner: the calendar, the to-do list and the like "should contract
      // vertically when there isn't enough room"): the lists give way first -- shorter, their rows scrolling inside,
      // each at least its heading and a row -- before any size steps down or a section is left out
      for (const H of [900, 640, 480]) {
        const cr = await page.evaluate((H) => {
          const el = document.getElementById('solo'), CAL = window.hkSidePane._.CAL, t0 = Date.now();
          // (eight events over the coming day, so the calendar has more than a short pane holds)
          CAL.evs = [...Array(8)].map((_, i) => ({ cal: 'calendar.family', title: 'Event ' + (i + 1), allDay: false,
                                                    start: new Date(t0 + (i + 1) * 3600000), end: new Date(t0 + (i + 1.5) * 3600000) }));
          CAL.at = t0; CAL.days = 7;
          Object.assign(el.style, { left: '0px', top: '0px', bottom: 'auto', height: H + 'px', width: '400px' });
          const list = [{ kind: 'weather', size: 'less' }, { kind: 'calendar', size: 'more' }, { kind: 'climate', size: 'more' },
                        { kind: 'people', size: 'full' }, { kind: 'timers', size: 'more' }];
          el.show({ list, place: { kind: 'side', w: 400 }, side: 'left' });
          const secs = el.shadowRoot.querySelector('.secs');
          const k = [...secs.querySelectorAll('.secs>[data-k]')];
          return { H, drawn: k.map((x) => x.dataset.k + ':' + x.dataset.size), more: !!secs.querySelector('.more2'),
                   scrolls: secs.scrollHeight > secs.clientHeight + 1,
                   lists: k.filter((x) => x.classList.contains('shrink')).map((x) => {
                     const l = x.querySelector('.lst');
                     return { k: x.dataset.k, h: x.offsetHeight, floor: parseFloat(x.style.minHeight) || 0, rows: l ? l.scrollHeight : 0, shown: l ? l.clientHeight : 0 };
                   }) };
        }, H);
        notes.push(tag + ' short pane ' + H + ': ' + cr.drawn.join(', ') + ' ' + JSON.stringify(cr.lists));
        want('a short pane (' + H + ' px) never scrolls, its lists at least their floor', cr,
             !cr.scrolls && cr.lists.every((l) => l.h + 1 >= l.floor));
        if (H === 640) {
          want('...at 640 px the lists give way before any size steps down: every section at its Size, one list scrolling', cr,
               !cr.more && cr.drawn.join() === 'weather:less,calendar:more,climate:more,people:full,timers:more' &&
               cr.lists.some((l) => l.k === 'calendar' && l.rows > l.shown + 20));
          await shot(page, tag + '-short-pane-640');
        }
      }
      // A TALL PANE, THE CALENDAR LONG (2026-10-31, the owner: "a gap/space above Who's Home that could be filled
      // with the calendar extending down"): its events run down to the sections at the foot, no space between
      const tall = await page.evaluate(() => {
        const el = document.getElementById('solo'), CAL = window.hkSidePane._.CAL, t0 = Date.now();
        CAL.evs = [...Array(20)].map((_, i) => ({ cal: 'calendar.family', title: 'Event ' + (i + 1), allDay: false,
                                                   start: new Date(t0 + (i + 1) * 3600000), end: new Date(t0 + (i + 1.5) * 3600000) }));
        CAL.at = t0; CAL.days = 7;
        Object.assign(el.style, { left: '0px', top: '0px', bottom: 'auto', height: '1000px', width: '400px' });
        el.show({ list: [{ kind: 'weather', size: 'less' }, { kind: 'calendar', size: 'more' },
                         { kind: 'people', size: 'less', place: 'bottom' }, { kind: 'security', size: 'less', place: 'bottom' }],
                  place: { kind: 'side', w: 400 }, side: 'left' });
        const secs = el.shadowRoot.querySelector('.secs'), gap = secs.querySelector('.gap'), l = secs.querySelector('[data-k="calendar"] .lst');
        return { gap: gap ? gap.offsetHeight : -1, rows: l.scrollHeight, shown: l.clientHeight, scrolls: secs.scrollHeight > secs.clientHeight + 1 };
      });
      notes.push(tag + ' tall pane, long calendar: ' + JSON.stringify(tall));
      want('a tall pane: the calendar runs down to the foot\'s sections, no space above them', tall,
           !tall.scrolls && tall.gap >= 0 && tall.gap <= 2 && tall.shown > 400 && tall.rows > tall.shown);
      await shot(page, tag + '-tall-pane-calendar');
      await page.evaluate(() => Object.assign(document.getElementById('solo').style, { bottom: '0px', height: '' }));
    }
    // ALL SCREENS' SIDE PANE PAGE IN SETTINGS HAS ITS PREVIEW (2026-10-31, the owner: "there still isn't a
    // preview in the Side Pane global page") -- a screen that follows All Screens, and where every screen has a
    // pane of its own, the first screen drawing All Screens' pane (hkSidePane.previewHouse)
    if (W === 1180) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      cur = 'settings/house/sidepane';
      await page.goto(input.origin + '/settings#/house/sidepane');
      await page.waitForTimeout(6000);
      const frameOf = () => page.evaluate(() => {
        const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
        const fr = deep(document).find((e) => e.tagName === 'IFRAME' && e.closest && e.closest('.pvbox'));
        if (!fr) return null;
        const P = fr.contentWindow && fr.contentWindow.hkSidePane, pane = P && P.pane();
        return { src: fr.getAttribute('src') || '', own: pane ? pane.own : null };
      });
      const follower = await frameOf();
      want('Settings, All Screens\' Side Pane page: a preview, of a screen that follows All Screens', follower, !!follower);
      // ...every screen its own: the panel's own data says so, the page drawn again
      await page.evaluate(() => {
        const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
        const panel = deep(document).find((e) => e.tagName === 'HK-SETTINGS-PANEL');
        Object.values(panel.data.boards || {}).forEach((b) => { b.side_pane_read = Object.assign({}, b.side_pane_read || {}, { own: ['dashboard'] }); });
        location.hash = '#/house';
        setTimeout(() => { location.hash = '#/house/sidepane'; }, 300);
      });
      await page.waitForTimeout(6000);
      const house = await frameOf();
      want('...and with every screen its own, the first screen drawing All Screens\' pane', house, !!house && Array.isArray(house.own) && house.own.length === 0);
      await shot(page, tag + '-settings-sidepane');
      // A STATUS'S SETTINGS (2026-11-06): what it says, its rule in words (the Screensaver's Shows When), its sizes
      cur = 'settings/screens/pane-status/sidepane/section/dashboard/1';
      await page.goto(input.origin + '/settings#/screens/pane-status/sidepane/section/dashboard/1');
      await page.waitForTimeout(5000);
      const sset = await page.evaluate(() => {
        const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
        const all = deep(document), panel = all.find((e) => e.tagName === 'HK-SETTINGS-PANEL');
        // (the words on the page: its text, never its style sheet's)
        const words = (r) => [...r.childNodes].map((n) => n.nodeType === 3 ? n.data : n.nodeType === 1 && !/^(STYLE|SCRIPT)$/.test(n.tagName)
          ? words(n) + (n.shadowRoot ? ' ' + words(n.shadowRoot) : '') : '').join(' ');
        const body = panel && panel.shadowRoot ? words(panel.shadowRoot).replace(/\s+/g, ' ') : '';
        const sizes = all.filter((e) => e.getAttribute && e.getAttribute('data-sk') === 'pane:sec:size').map((e) => e.textContent.replace(/\s+/g, ' '))[0] || '';
        return { body, sizes };
      });
      want('Settings, a Status section: its entity, name, label, glyph and color, its rule in words, Tiny / Less / More', [sset.sizes, sset.body.slice(-1500)],
           ['Entity', 'Name', 'Label', 'Glyph', 'Glyph Color', 'Show When', 'Shows when Mailbox Status is Mail Likely Delivered', 'When Tapped']
             .every((w) => sset.body.indexOf(w) >= 0) && /Tiny/.test(sset.sizes) && /More/.test(sset.sizes) && !/Full/.test(sset.sizes));
      await shot(page, tag + '-settings-status');
    }
    if (errors.length) fails.push(tag + ' page errors: ' + errors.join(' | '));
    await context.close();
  }
  await browser.close();
  console.log(notes.join('\n'));
  if (fails.length) { console.log('\nFAILED:\n' + fails.join('\n')); process.exit(1); }
  console.log('\nside pane: all checks passed');
})().catch((e) => { console.error(e); process.exit(2); });
