// saver_shows_check.py's browser half: each screen's screensaver, started as the house starts it, and its face.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok ? '' : '  got ' + JSON.stringify(got))); };
  try {
    const runs = Object.entries(input.shows).flatMap(([screen, want]) => want === 'tb' ? [[screen, want, 1180, 820], [screen, want, 390, 844]] : [[screen, want, 1180, 820]]);
    for (const [screen, want, W, H] of runs) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H } });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      await page.goto(input.origin + '/' + screen + '/home');
      await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
      await page.waitForTimeout(2000);
      const started = await page.evaluate(() => !!(window.hkSaver && window.hkSaver.preview && (window.hkSaver.preview(true), true)));
      await page.waitForTimeout(4000);
      const got = await page.evaluate(() => {
        const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
        const host = document.querySelector('hk-screensaver') || deep(document, '[ckface],[fcbig]')[0] ||
          [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
        return host ? { face: host.getAttribute('ckface'), big: host.hasAttribute('fcbig') } : null;
      });
      if (want === 'tb') {
        // THE WEATHER WITH TIME BEHIND (2026-10-31, the owner: back in the corner, as on Clock): there, with its
        // temperature, upper left -- and never over the time's figures
        const tb = await page.evaluate(() => {
          const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          const sr = host && host.shadowRoot, t = sr && sr.querySelector('.ph .tb .tbt'), w = sr && sr.querySelector('.info hk-weather-strip-card');
          const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
          const ink = (e) => { const g = []; const walk = (n) => { if (!n) return; if (n.nodeType === 3) { const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect(); if (r.width > 0 && n.textContent.trim()) g.push(r); } (n.shadowRoot ? [...n.shadowRoot.childNodes] : []).concat([...n.childNodes]).forEach(walk); }; walk(e);
            return g.length ? { l: Math.min(...g.map((r) => r.left)), r: Math.max(...g.map((r) => r.right)), t: Math.min(...g.map((r) => r.top)), b: Math.max(...g.map((r) => r.bottom)), text: (e.shadowRoot || e).textContent.replace(/\s+/g, ' ').trim().slice(0, 60) } : null; };
          const U = window.hkSaver && window.hkSaver._, g = U && t ? U.glyphBox(innerWidth, innerHeight, t.textContent) : null;
          return host ? { tb: host.hasAttribute('tb'), time: t ? box(t) : null, figures: g, weather: w ? Object.assign(box(w), { ink: ink(w) }) : null, W: innerWidth } : null;
        });
        say(started && !!tb && tb.tb && !!tb.time, screen + ' ' + W + 'x' + H + ': Photos with the time on them', tb);
        const wx = tb && tb.weather, ink = wx && wx.ink, g = tb && tb.figures;
        say(!!wx && wx.h > 0 && !!ink && /\d°/.test(ink.text), screen + ' ' + W + 'x' + H + ': the weather is there, with its temperature', wx);
        say(!!ink && ink.l <= 40 && ink.t <= 70, screen + ' ' + W + 'x' + H + ': ...in the upper-left corner', ink);
        say(!!ink && !!g && (ink.b <= g[1] + 1 || ink.r <= g[0] + 1), screen + ' ' + W + 'x' + H + ': ...clear of the time\'s figures', [ink, g]);
        say(!errors.length, screen + ' ' + W + 'x' + H + ': no page errors', errors.slice(0, 3));
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '.png' });
        // ...and in its Settings preview (the screen's Screensaver page)
        if (W > 600) {
          await page.evaluate(() => window.hkSaver && window.hkSaver.preview && window.hkSaver.preview(false));
          // (its preview column shows beside the page on a wide window)
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.goto(input.origin + '/settings#/screens/' + screen + '/screensaver');
          await page.waitForTimeout(9000);
          if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-settings-preview.png' });
        }
        await ctx.close();
        continue;
      }
      if (want === 'clock-tb' || want === 'clock-soft') {
        const sharp = want === 'clock-tb';
        const tb = await page.evaluate(() => {
          const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          return host ? { tb: host.hasAttribute('tb'), ckmode: host.hasAttribute('ckmode'), time: !!host.shadowRoot.querySelector('.ph .tb .tbt') } : null;
        });
        say(started && !!tb && tb.ckmode && tb.tb === sharp && tb.time === sharp,
            screen + (sharp ? ': Clock on sharp photos with Time Behind saved on draws it' : ': Clock on Soft photos with Time Behind saved on: the clock, no time on the photos'), tb);
        if (sharp) {
          // ...as bright as on Photos (2026-10-31, the owner: "the clock is dim"): over the photos' dark wash, not under it
          const lift = await page.evaluate(() => {
            const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph .tb'));
            const tbx = host && host.shadowRoot.querySelector('.ph .tb'), ph = tbx && tbx.closest('.ph');
            return tbx ? { tb: Number(getComputedStyle(tbx).zIndex) || 0, wash: Number(getComputedStyle(ph, '::after').zIndex) || 0, op: getComputedStyle(tbx).opacity } : null;
          });
          say(!!lift && lift.tb > lift.wash && lift.op === '1', screen + ': the time over the photos\' dark wash, at full strength', lift);
          if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '.png' });
        }
        await page.evaluate(() => window.hkSaver && window.hkSaver.preview && window.hkSaver.preview(false));
        await page.goto(input.origin + '/settings#/screens/' + screen + '/screensaver');
        await page.waitForTimeout(5000);
        const rows = await page.evaluate(() => {
          const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          return deep(document).filter((e) => !e.children.length && /^(Time Behind|Titles)$/.test((e.textContent || '').trim())).map((e) => e.textContent.trim());
        });
        say(sharp ? rows.includes('Time Behind') && rows.includes('Titles') : !rows.includes('Time Behind') && !rows.includes('Titles'),
            screen + (sharp ? ': its Screensaver page offers Time Behind and Titles' : ': its Screensaver page offers neither'), rows);
        say(!errors.length, screen + ': no page errors', errors.slice(0, 3));
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-settings.png', fullPage: true });
        await ctx.close();
        continue;
      }
      const ok = !!got && (want === 'big' ? got.big : want ? got.face === want : !got.face && !got.big);
      say(started && ok, screen + ': the screensaver draws ' + (want || 'the classic forecast'), got);
      say(!errors.length, screen + ': no page errors', errors.slice(0, 3));
      if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '.png' });
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? 'FAIL: ' + fails : 'saver shows: all checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
