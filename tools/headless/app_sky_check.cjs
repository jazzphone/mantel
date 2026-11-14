// app_sky_check.py's browser half: the sky handed to a stand-in for Mantel for Android's bridge, in Chromium (the app's
// page is Android's WebView). Prints PASS / FAIL lines.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// THE APP'S BRIDGE, stood in: every step answered yes and kept (window.__skyOps)
function bridge() {
  window.__skyOps = [];
  window.mantelNative = Object.freeze({
    platform: 'android', notifications: false, drawn() {},
    status: () => Promise.resolve('{}'), command: () => Promise.resolve('{"ok":true}'),
    sky: (op, data) => { window.__skyOps.push([op, data == null ? null : JSON.parse(JSON.stringify(data))]); return Promise.resolve(true); },
  });
}

// what the page shows of it now
function state() {
  const deep = (r, sel) => { const out = [...r.querySelectorAll(sel)]; r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) out.push(...deep(e.shadowRoot, sel)); }); return out; };
  const H = window.hkSkyHandover, G = window.hkGlass, pre = G && G._pre && G._pre.state();
  const sky = document.getElementById('hk-sky'), de = document.documentElement;
  const layers = deep(document, '[data-hk-glass-layer]').map((L) => {
    const kids = [...L.children].filter((c) => c.hasAttribute('data-hk-frost'));
    const cs = getComputedStyle(L), k = kids[kids.length - 1], ks = k ? getComputedStyle(k) : null;
    const host = L.getRootNode && L.getRootNode().host;
    return { live: (cs.backdropFilter || cs.webkitBackdropFilter || 'none') !== 'none', frost: kids.length,
             where: (host ? host.tagName.toLowerCase() : 'document') + (L._hkOverlay ? ' (over the page)' : '') + (L._hkNoPic ? ' (out of line)' : ''),
             aside: !!(host && host.__hkAlong && host.__hkAlong.path && host.__hkAlong.path !== location.pathname),
             att: ks ? ks.backgroundAttachment : null, pos: ks ? ks.position : null, tf: k ? k.style.transform : null,
             pic: !!(k && pre && pre.url && ks.backgroundImage.indexOf(pre.url) >= 0) };
  });
  const bar = deep(document, '#hk-tabbar')[0], pill = bar && bar.shadowRoot && bar.shadowRoot.querySelector('.pill');
  const sheet = deep(document, '.hkd.open .sheet')[0];
  const ss = sheet ? getComputedStyle(sheet) : null;
  return {
    status: H ? H.status() : null, ops: (window.__skyOps || []).map((o) => o[0]),
    clipped: !!(sky && sky.classList.contains('hk-sky-app') && getComputedStyle(sky).clipPath !== 'none'),
    see: de.classList.contains('hk-sky-app'), styled: !!document.querySelector('style[data-hk-sky-handover]'),
    frostVar: getComputedStyle(de).getPropertyValue('--hk-frost').trim(), glass: G ? G.stats() : null, url: pre ? pre.url : null,
    layers, bar: pill ? { pic: !!(pre && pre.url && (pill.style.background || '').indexOf(pre.url) >= 0),
                          live: (getComputedStyle(pill).backdropFilter || 'none') !== 'none' } : null,
    sheet: ss ? { live: (ss.backdropFilter || ss.webkitBackdropFilter || 'none') !== 'none',
                  pic: !!(pre && pre.url && ss.backgroundImage.indexOf(pre.url) >= 0), att: ss.backgroundAttachment, tf: ss.transform } : null,
  };
}
const until = async (page, fn, arg, ms) => { try { await page.waitForFunction(fn, arg, { timeout: ms || 30000 }); return true; } catch (e) { return false; } };
const RAIN = { season: '', cond: 'pouring', wet: { kind: 'rain', rate: 1 }, fog: false, wind: 8, moon: 0.4, elev: 25, azim: 180, cover: 0.9,
               animations: true, decorations: false };
const CLEAR = { season: '', cond: 'sunny', wet: { kind: 'none', rate: 0 }, fog: false, wind: 0, moon: 0.4, elev: 40, azim: 180, cover: 0,
                animations: true, decorations: false };

(async () => {
  const browser = await pw.chromium.launch({ headless: true });
  let fails = 0;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (got === undefined ? '' : '  ' + JSON.stringify(got))); };
  try {
    for (const size of input.sizes) {
      const [width, height] = size.split('x').map(Number);
      const open = async (tablet, withBridge, screen) => {
        const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, deviceScaleFactor: 1 });
        await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
        await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
        if (withBridge) await ctx.addInitScript(bridge);
        const page = await ctx.newPage();
        const errors = []; page.on('pageerror', (e) => { if (!/^ResizeObserver loop/.test(e.message)) errors.push(e.message); });
        await page.goto(input.origin + '/' + (screen || input.screen) + '/home?hk_tablet=' + tablet);
        await page.waitForFunction(() => window.__mantelReady === true && !!window.hkSky && !!window.hkGlass, null, { timeout: 30000 });
        await require('./grid_ready.cjs')(page);
        return { ctx, page, errors };
      };
      const shot = async (page, name) => { if (input.shots) await page.screenshot({ path: input.shots + '/' + name + '-' + size + '.png' }); };

      // ---- the Loft: Sky Drawn by the App on
      {
        const { ctx, page, errors } = await open('loft', true);
        const tag = size + ' loft';
        say(await page.evaluate(() => !!(window.hkSettings.tablet() || {}).app_sky), tag + ': the page knows its tablet\'s setting');
        await page.evaluate((s) => { window.hkSky._pin(s); }, RAIN);
        await sleep(1500);
        await page.evaluate(() => window.hkSkyHandover.again(true));
        const played = await until(page, () => window.hkSkyHandover.status().state === 'playing', null, 40000);
        await sleep(800);
        let s = await page.evaluate(state);
        say(played && s.status.busy, tag + ': pouring rain is handed over (busy: ' + (s.status && s.status.busy) + ')', s.status);
        const ops = s.ops.join(' ');
        say(/^switch .*begin( sheet)+ play shown$/.test(ops), tag + ': the app is told the setting, then begin, the sheets, play, shown', ops);
        const sw = await page.evaluate(() => window.__skyOps[0]);
        say(sw && sw[0] === 'switch' && sw[1] && sw[1].on === true, tag + ': ...the setting as on', sw);
        const play = await page.evaluate(() => (window.__skyOps.find((o) => o[0] === 'play') || [])[1]);
        say(!!(play && play.scene && play.scene.nodes.length > 1 && play.scene.nodes.some((n) => n.anims.length)), tag + ': the scene has its parts and keyframes',
            play && { nodes: play.scene.nodes.length, rects: Object.keys(play.rects).length });
        say(s.clipped && s.see, tag + ': the page\'s own sky is clipped away, the page see-through');
        // (a page waiting beside this one for a swipe is moved by a transform: its picture fixed and moved back, in line)
        const rests = (L) => (L.aside ? L.pos === 'fixed' && L.att === 'scroll' : L.pos === 'absolute' && L.att === 'fixed');
        say(s.glass.frost && s.layers.length > 0 && s.layers.every((L) => !L.live && L.frost >= 1 && L.pic && rests(L)),
            tag + ': every glass layer wears the frost picture fixed to the screen, no live blur',
            { stats: s.glass, odd: s.layers.filter((L) => L.live || !L.frost || !L.pic || !rests(L)) });
        say(s.bar && s.bar.pic && !s.bar.live, tag + ': the tab bar wears its slice of it', s.bar);
        say(s.frostVar === '1', tag + ': the root says so, for the sheets');
        await shot(page, 'app-sky-rain');
        // A SHEET over it: the picture under its plate, no blur, no opening transform
        await page.evaluate(() => window.hkShell.moreInfo('light.living_room_lamps'));
        await until(page, () => { const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
                                  return deep(document).some((e) => e.matches && e.matches('.hkd.open .sheet')); }, null, 10000);
        await sleep(600);
        s = await page.evaluate(state);
        say(s.sheet && !s.sheet.live && s.sheet.pic && s.sheet.att === 'fixed' && s.sheet.tf === 'none', tag + ': a sheet wears the picture under its plate, no blur',
            { sheet: s.sheet, state: s.status.state, why: s.status.why, ops: s.ops.slice(-3) });
        await shot(page, 'app-sky-sheet');
        await page.keyboard.press('Escape');
        await sleep(600);
        // A SWIPE: the page moved by a transform keeps the picture in line -- each layer's child fixed, moved back as much
        const swipe = await page.evaluate(() => {
          const deep = (r, sel) => { const out = [...r.querySelectorAll(sel)]; r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) out.push(...deep(e.shadowRoot, sel)); }); return out; };
          const L = deep(document, '[data-hk-glass-layer]')[0], tags = window.hkShell.viewTags.map((t) => t.toUpperCase());
          let v = L; while (v && tags.indexOf(v.tagName) < 0) v = v.parentNode && v.parentNode.host ? v.parentNode.host : v.parentNode;
          if (!v) return null;
          window.hkGlass.along(v, { x: -300, left: 0, top: 0, tr: 'none', path: location.pathname });
          const k = [...L.children].filter((c) => c.hasAttribute('data-hk-frost')).pop();
          const moving = k && { pos: getComputedStyle(k).position, tf: k.style.transform, att: getComputedStyle(k).backgroundAttachment };
          window.hkGlass.along(v, null);
          const k2 = [...L.children].filter((c) => c.hasAttribute('data-hk-frost')).pop();
          return { moving, rest: k2 && { pos: getComputedStyle(k2).position, tf: k2.style.transform, att: getComputedStyle(k2).backgroundAttachment } };
        });
        say(swipe && swipe.moving && swipe.moving.pos === 'fixed' && /translate\(300(\.0)?px/.test(swipe.moving.tf) && swipe.moving.att === 'scroll' &&
            swipe.rest && swipe.rest.pos === 'absolute' && !swipe.rest.tf && swipe.rest.att === 'fixed',
            tag + ': through a swipe the picture stays in line, and is fixed to the screen again after', swipe);
        // SOMETHING ELSE ON THE PAGE MOVES (a washer spinning on the Laundry block): the page makes every frame anyway,
        // and has its sky back; still again, the app has it again
        let before = (await page.evaluate(state)).ops.length;
        await page.evaluate(() => {
          const d = document.createElement('div'); d.id = 'spin';
          d.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;background:#fff;opacity:.01';
          document.body.appendChild(d);
          d.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 1000, iterations: Infinity });
          window.hkSkyHandover.again();
        });
        const moved = await until(page, () => window.hkSkyHandover.status().state === 'page moves', null, 30000);
        s = await page.evaluate(state);
        // (ONE GLASS: the frost picture stays on while the page has the sky back -- all in, 2026-11-13)
        say(moved && s.ops.slice(before).indexOf('stop') >= 0 && !s.clipped && s.glass.frost && s.frostVar === '1',
            tag + ': something else moving on the page: the sky is the page\'s again, the glass still the frost picture',
            { state: s.status.state, moves: s.status.moves, ops: s.ops.slice(before), frost: s.glass.frost });
        await page.evaluate(() => { document.getElementById('spin').remove(); window.hkSkyHandover.again(); });
        const back = await until(page, () => window.hkSkyHandover.status().state === 'playing', null, 40000);
        say(back, tag + ': ...and still again, the app\'s');
        await sleep(800);
        // EVERY SKY: a clear day stays the app's, and a sky with nothing moving in it too
        await page.evaluate((c) => { window.hkSky._pin(c); }, CLEAR);
        await sleep(1500);
        await page.evaluate(() => window.hkSkyHandover.again(true));
        await sleep(6000);
        await until(page, () => window.hkSkyHandover.status().state === 'playing', null, 30000);
        s = await page.evaluate(state);
        say(s.status.state === 'playing' && s.clipped && s.glass.frost, tag + ': a clear day is the app\'s too', { state: s.status.state, busy: s.status.busy });
        await shot(page, 'app-sky-clear');
        await page.evaluate((c) => { window.hkSky._pin(Object.assign({}, c, { animations: false, cover: 0, wind: 0 })); }, CLEAR);
        await sleep(1500);
        await page.evaluate(() => window.hkSkyHandover.again(true));
        await until(page, () => { const t = window.hkSkyHandover.status(); return t.state === 'playing' && t.still === true && !t.baking; }, null, 30000);
        s = await page.evaluate(state);
        say(s.status.state === 'playing' && s.status.still === true && s.clipped, tag + ': ...and a sky with nothing moving in it', { state: s.status.state, still: s.status.still });
        // THE GUARD: an animation the app can't play (here `translate`) keeps the sky the page's; gone again, the app's
        before = s.ops.length;
        await page.evaluate((c) => {
          window.hkSky._pin(c);
          const st = document.createElement('style'); st.id = 'mz-slide';
          st.textContent = '@keyframes mz-slide{from{translate:0 0}to{translate:60px 0}}' +
            '#mz-slide-el{position:absolute;left:10px;top:10px;width:8px;height:8px;background:#fff;animation:mz-slide 3s linear infinite}';
          document.head.appendChild(st);
          const d = document.createElement('div'); d.id = 'mz-slide-el'; window.hkSky.element().appendChild(d);
          window.hkSkyHandover.again(true);
        }, CLEAR);
        const kept = await until(page, () => window.hkSkyHandover.status().state === 'page keeps', null, 30000);
        s = await page.evaluate(state);
        say(kept && /translate/.test(s.status.cannot || '') && s.ops.slice(before).indexOf('stop') >= 0 && !s.clipped && s.glass.frost,
            tag + ': an animation the app can\'t play keeps the sky the page\'s (the glass still the frost picture)',
            { state: s.status.state, cannot: s.status.cannot, ops: s.ops.slice(before) });
        await page.evaluate(() => { document.getElementById('mz-slide-el').remove(); document.getElementById('mz-slide').remove(); window.hkSkyHandover.again(true); });
        say(await until(page, () => window.hkSkyHandover.status().state === 'playing', null, 40000), tag + ': ...and without it, the app\'s again');
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        await ctx.close();
      }
      // ---- a drawn wallpaper (Pinwheel, Motion Fast) on the Loft: the app's too, moving by its transform (no number)
      {
        const { ctx, page, errors } = await open('loft', true, input.wall);
        const tag = size + ' wallpaper';
        await sleep(1500);
        await page.evaluate(() => window.hkSkyHandover.again(true));
        const got = await until(page, () => window.hkSkyHandover.status().state === 'playing', null, 40000);
        const w = await page.evaluate(() => {
          const el = window.hkSky.element(), play = (window.__skyOps.filter((o) => o[0] === 'play').pop() || [])[1];
          const turns = !!(play && play.scene.nodes.some((n) => n.anims.some((a) => (a.t || []).some((k) => k.v.some((op) => op[0] === 'r')))));
          return { wm: el.getAttribute('data-wm'), wpv: el.hasAttribute('data-wpv'), turns, st: window.hkSkyHandover.status() };
        });
        say(got && w.wm === 'fast' && !w.wpv && w.turns, tag + ': a moving wallpaper is the app\'s, turning by its transform', w);
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        await ctx.close();
      }
      // ---- the Den: Sky Drawn by the App off -- nothing handed over, the app told so
      {
        const { ctx, page, errors } = await open('den', true);
        const tag = size + ' den';
        await page.evaluate((s) => { window.hkSky._pin(s); }, RAIN);
        await sleep(1500);
        await page.evaluate(() => window.hkSkyHandover.again(true));
        await sleep(4000);
        const s = await page.evaluate(state);
        say(s.status.state === 'off' && s.ops.join(' ') === 'switch' && !s.clipped && !s.glass.frost, tag + ': setting off: nothing handed over, the app told so',
            { state: s.status.state, ops: s.ops });
        const sw = await page.evaluate(() => window.__skyOps[0]);
        say(sw && sw[1] && sw[1].on === false, tag + ': ...as off', sw);
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        await ctx.close();
      }
      // ---- a browser: no bridge, nothing of it runs
      {
        const { ctx, page, errors } = await open('loft', false);
        const tag = size + ' browser';
        await page.evaluate((s) => { window.hkSky._pin(s); }, RAIN);
        await sleep(2500);
        const s = await page.evaluate(state);
        say(s.status.state === 'off' && !s.styled && !s.clipped && !s.glass.frost, tag + ': no bridge: nothing of it runs', s.status);
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        await ctx.close();
      }
    }
  } catch (e) {
    fails++;
    console.log('FAIL ' + (e && e.stack || e));
  } finally {
    await browser.close();
  }
  process.exitCode = fails ? 1 : 0;
})();
