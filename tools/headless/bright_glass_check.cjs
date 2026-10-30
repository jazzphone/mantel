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
function standIn() {
  const sky = window.hkSky && window.hkSky.element && window.hkSky.element();
  const mid = sky && sky.style.getPropertyValue('--sk1'), low = sky && sky.style.getPropertyValue('--sk2');
  const css = new CSSStyleSheet();
  css.replaceSync('.hkd .sheet{background:linear-gradient(rgba(255,255,255,.22),rgba(255,255,255,.22)),linear-gradient(' + mid + ',' + low + ')!important}');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
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
      await shot('room');
      await page.evaluate(standIn);
      await page.evaluate(() => window.hkDetail.open('light.living_room_lamps'));
      await page.waitForTimeout(1400);
      await shot('sheet');
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
        say(picker === 12, size + ' the Wallpaper picker shows the twelve', picker);
        await shot('picker');
      }
      say(!errors.length, size + ' no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await browser.close(); }
  process.exitCode = fails ? 1 : 0;
})();
