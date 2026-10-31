// bright_glass_check.py's browser half: Home with the tab bar, a room page, a sheet and the side menu, in Bright
// Glass over one wallpaper, in WebKit at each size. Prints PASS / FAIL lines; writes <wall>-<night>-<size>-<view>.png.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const KEY = input.wall + '-' + input.night;

// what the page says it wears
function wears() {
  const deep = (r, sel) => { const out = [...r.querySelectorAll(sel)]; r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) out.push(...deep(e.shadowRoot, sel)); }); return out; };
  const sky = window.hkSky && window.hkSky.element && window.hkSky.element();
  const on = sky ? [...sky.querySelectorAll('.wall')].filter((w) => w.classList.contains('on')) : [];
  const bar = deep(document, '#hk-tabbar')[0], root = bar && bar.shadowRoot && bar.shadowRoot.querySelector('.root');
  return { glass: document.documentElement.getAttribute('data-hk-glass'), wall: sky ? sky.style.getPropertyValue('--wall') : null,
           layer: on.length === 1 && /^url\("data:image\/svg\+xml/.test(on[0].style.backgroundImage),
           sk3: sky && sky.style.getPropertyValue('--sk3'), plate: getComputedStyle(document.documentElement).getPropertyValue('--hk-glass-plate'),
           bar: root ? root.className : null };
}
// the look's sheet plate (--hk-sheet-plate: layers ending in a colour) over the wallpaper's middle stops, held down
// as its blur's brightness(0.86) does
function sheetStandIn() {
  const sky = window.hkSky && window.hkSky.element && window.hkSky.element();
  const mid = sky && sky.style.getPropertyValue('--sk1'), low = sky && sky.style.getPropertyValue('--sk2');
  const plate = getComputedStyle(document.documentElement).getPropertyValue('--hk-sheet-plate').trim()
    .replace(/,\s*(rgba?\([^()]*\))\s*$/, ', linear-gradient($1, $1)');
  return plate + ', linear-gradient(rgba(0,0,0,.14),rgba(0,0,0,.14)), linear-gradient(' + mid + ',' + low + ')';
}
function standIn(plate) {
  const css = new CSSStyleSheet();
  css.replaceSync('.hkd .sheet{background:' + plate + '!important}');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
}
// WHITE NAMES OVER A SHEET at the wallpaper's LIGHTEST stop (the owner's Rooms sheet, 2026-10-30): the stop held down
// by the blur's brightness, under the plate's tint and the top of its sheen; WCAG contrast of white .94 on that
function sheetContrast() {
  const sky = window.hkSky && window.hkSky.element && window.hkSky.element();
  const rgb = (s) => (/rgba?\(([^)]+)\)/.exec(s) || /#(..)(..)(..)/.exec(s) || [])[1] ? (s.startsWith('#') ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : /rgba?\(([^)]+)\)/.exec(s)[1].split(',').slice(0, 3).map(Number)) : null;
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const stops = [0, 1, 2, 3].map((i) => rgb(sky.style.getPropertyValue('--sk' + i).trim())).filter(Boolean);
  const light = stops.sort((a, b) => lum(b) - lum(a))[0].map((v) => v * 0.86);
  const plate = getComputedStyle(document.documentElement).getPropertyValue('--hk-sheet-plate');
  const tint = /rgba?\(([^)]+)\)\s*$/.exec(plate.trim())[1].split(',').map(Number), sheen = +(/rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(plate) || [0, 0])[1];
  const over = (top, a, under) => under.map((v, i) => top[i] * a + v * (1 - a));
  const bg = over([255, 255, 255], sheen, over(tint.slice(0, 3), tint[3], light)), fg = over([255, 255, 255], 0.94, bg);
  return (lum(fg) + 0.05) / (lum(bg) + 0.05);
}

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + KEY + ' ' + what + (ok ? '' : '  got ' + JSON.stringify(got))); };
  try {
    for (const size of input.sizes) {
      const [width, height] = size.split('x').map(Number);
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, deviceScaleFactor: 1 });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage();
      // (WebKit's ResizeObserver loop notice is the browser's, not the page's: left out)
      const errors = []; page.on('pageerror', (e) => { if (!/^ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      const go = async (path) => {
        await page.goto(input.origin + path);
        await page.waitForFunction(() => window.__mantelReady === true && !!window.hkDetail && !!window.hkWallpapers, null, { timeout: 30000 });
        await page.waitForTimeout(2500);
      };
      const shot = (view) => page.screenshot({ path: input.shots + '/' + KEY + '-' + size + '-' + view + '.png' });
      await go('/' + input.screen + '/home');
      const w = await page.evaluate(wears);
      say(w.glass === 'bright', size + ' the page wears Bright Glass', w.glass);
      say(w.wall === '"' + input.wall + ':' + input.night + '"' && w.layer, size + ' the sky shows the wallpaper, ' + input.night, w);
      say(/rgba\(\d+, \d+, \d+, 0\.07\)/.test(w.plate) && !/rgba\(255, 255, 255, 0\)/.test(w.plate.split('),')[0]), size + ' the plate mixes the light stop in', w.plate);
      say(/\bbright\b/.test(w.bar || ''), size + ' the tab bar wears its Bright Glass', w.bar);
      await shot('home');
      await go('/' + input.screen + '/room-living-room');
      // BRIGHT GLASS ON HOME ONLY (the default, 2026-10-30): another page in its Blur
      const roomLook = await page.evaluate(() => document.documentElement.getAttribute('data-hk-glass'));
      say(roomLook === 'blur', size + ' a room page wears Blur (Bright Glass on Home only)', roomLook);
      await shot('room');
      await page.evaluate(standIn, await page.evaluate(sheetStandIn));
      await page.evaluate(() => window.hkDetail.open('light.living_room_lamps'));
      await page.waitForTimeout(1400);
      await shot('sheet');
      // THE WALLPAPER'S MOTION (2026-10-30), once per wallpaper: the picture moves (a transform, nothing else),
      // the page keeps its frame rate, and Reduce Motion holds it still
      if (size === input.sizes[0]) {
        const motion = async () => page.evaluate(async () => {
          const sky = window.hkSky && window.hkSky.element && window.hkSky.element(), wall = sky && sky.querySelector('.wall.on');
          if (!wall) return null;
          const t0 = getComputedStyle(wall).transform;
          let frames = 0; const start = performance.now();
          await new Promise((res) => { const tick = () => { frames++; if (performance.now() - start < 3000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
          return { wm: sky.getAttribute('data-wm'), moved: getComputedStyle(wall).transform !== t0, fps: Math.round(frames / 3), filter: getComputedStyle(wall).filter };
        });
        const m = await motion();
        say(m && m.wm === input.motion && m.moved && m.filter === 'none', size + ' the wallpaper moves (' + input.motion + '), by transform alone', m);
        say(m && m.fps >= 50, size + ' ...and the page keeps its frame rate', m && m.fps);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const r = await motion();
        say(r && !r.moved, size + ' ...still under Reduce Motion', r);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      // THE ROOMS SHEET (the button beside the tab bar), stood in as the sheets are, and its names' contrast
      await go('/' + input.screen + '/home');
      const cr = await page.evaluate(sheetContrast);
      say(cr >= 4.5, size + ' white names over a sheet keep 4.5:1 at the lightest stop', +cr.toFixed(2));
      const opened = await page.evaluate((plate) => {
        const bar = document.getElementById('hk-tabbar'), sr = bar && bar.shadowRoot, btn = sr && sr.querySelector('.roomsbtn');
        if (!btn) return false;
        btn.click();
        const st = document.createElement('style');
        st.textContent = '.bright .sheet.g{background:' + plate + '!important}';
        sr.appendChild(st);
        return true;
      }, await page.evaluate(sheetStandIn));
      say(opened, size + ' the Rooms button opens its sheet', opened);
      await page.waitForTimeout(1500);
      const lines = await page.evaluate(() => {
        const sr = document.getElementById('hk-tabbar').shadowRoot;
        return [...sr.querySelectorAll('[data-sheet="rooms"] .roomgrid .it span')].filter((s) => s.scrollHeight > s.clientHeight + 1).map((s) => s.textContent);
      });
      const count = await page.evaluate(() => document.getElementById('hk-tabbar').shadowRoot.querySelectorAll('[data-sheet="rooms"] .roomgrid .it').length);
      say(count >= 4, size + ' the Rooms sheet lists the rooms', count);
      say(!lines.length, size + ' no room name cut short', lines);
      // ...each room an app icon in its own colour, and on a tablet a big sheet with the page all round it
      // (2026-10-31, the owner: "a lot bigger on the tablet, as long as there is enough room around it to tap out")
      const geo = await page.evaluate(() => {
        const sr = document.getElementById('hk-tabbar').shadowRoot, sh = sr.querySelector('[data-sheet="rooms"]').getBoundingClientRect();
        const ai = [...sr.querySelectorAll('[data-sheet="rooms"] .roomgrid .it .ai')];
        return { left: Math.round(sh.left), right: Math.round(innerWidth - sh.right), top: Math.round(sh.top), width: Math.round(sh.width), icons: ai.length,
                 colours: new Set(ai.map((a) => a.style.background)).size, side: ai[0] ? Math.round(ai[0].getBoundingClientRect().width) : 0 };
      });
      say(geo.icons === count && geo.colours >= Math.min(count, 4), size + ' each room an app icon in its own colour', geo);
      if (Math.min(width, height) >= 600) {
        say(geo.left >= 72 && geo.right >= 72 && geo.top >= 90 && geo.side === 76 && geo.width >= Math.min(1040, width - 144) - 1,
            size + ' ...a tablet\'s sheet as big as leaves 72 px of page each side, its icons 76 px', geo);
      }
      await shot('rooms');
      // MORE WITH THE ROOMS IN IT (the screen's Rooms in More): the pages in their colours, the rooms in theirs
      await go('/' + input.more + '/home');
      const more = await page.evaluate(() => {
        const sr = document.getElementById('hk-tabbar').shadowRoot, btn = sr.querySelector('.tab[data-t="more"]');
        if (!btn) return null;
        btn.click();
        return true;
      });
      await page.waitForTimeout(1200);
      const mi = await page.evaluate(() => {
        const sr = document.getElementById('hk-tabbar').shadowRoot, sh = sr.querySelector('[data-sheet="more"]');
        const rooms = [...sh.querySelectorAll('.roomgrid .it .ai')], pages = [...sh.querySelectorAll('.pages .it .ai')];
        return { open: sh.classList.contains('open'), rooms: rooms.length, pages: pages.length, plain: [...sh.querySelectorAll('.grid .it')].filter((it) => !it.querySelector('.ai')).length };
      });
      say(more && mi.open && mi.rooms >= 4 && mi.plain === 0, size + ' More with the rooms in it: every page and room an app icon', mi);
      await shot('more');
      await go('/' + input.menu + '/home');
      await page.evaluate(() => {
        if (window.hkMenu && !(window.hkMenu.docked && window.hkMenu.docked())) window.hkMenu.open();
        // (open over the page it blurs as a sheet: stood in as the sheets are)
        const sky = window.hkSky && window.hkSky.element && window.hkSky.element();
        const mid = sky && sky.style.getPropertyValue('--sk1'), low = sky && sky.style.getPropertyValue('--sk2');
        const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
        deep(document).filter((e) => e.shadowRoot && e.shadowRoot.querySelector('.mat')).forEach((h) => {
          const st = document.createElement('style');
          st.textContent = '.root.bright:not(.docked) .mat{background:linear-gradient(150deg,rgba(255,255,255,.30),rgba(255,255,255,.14)),linear-gradient(' + mid + ',' + low + ')!important}';
          h.shadowRoot.appendChild(st);
        });
      });
      await page.waitForTimeout(900);
      await shot('menu');
      // the Wallpaper picker (HK Settings -> Sky / Background), in its own iOS look, once
      if (size === input.sizes[0] && input.night === 'day') {
        await page.goto(input.origin + '/settings#/house/appearance/sky');
        await page.waitForTimeout(3500);
        const picker = await page.evaluate(() => {
          const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          return deep(document).filter((e) => e.matches && e.matches('.wallgrid button')).length;
        });
        say(picker === 18, size + ' the Wallpaper picker shows the twelve and the six motion themes', picker);
        await shot('picker');
      }
      say(!errors.length, size + ' no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await browser.close(); }
  process.exitCode = fails ? 1 : 0;
})();
