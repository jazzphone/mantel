// saver_shows_check.py's browser half: each screen's screensaver, started as the house starts it, and its face.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok ? '' : '  got ' + JSON.stringify(got))); };
  try {
    const runs = Object.entries(input.shows).filter(([screen]) => screen.includes(input.only || '')).flatMap(([screen, want]) => want === 'tb' ? [[screen, want, 1180, 820], [screen, want, 390, 844]]
      : want === 'day-ink' ? [[screen, want, 1180, 820], [screen, want, 820, 1180], [screen, want, 390, 844]]
      : want === 'big-corners' || want === 'planted' || /^lay-/.test(want) ? [[screen, want, 1180, 820], [screen, want, 820, 1180], [screen, want, 390, 844]] : [[screen, want, 1180, 820]])
      // (--shard K/N: every N-th run from the K-th; tools/ci.py runs the N parts side by side)
      .filter((_, i) => !input.shard || i % input.shard[1] === input.shard[0] - 1);
    console.log('saver shows: ' + runs.length + ' runs' + (input.shard && input.shard[1] > 1 ? ' (part ' + input.shard.join(' of ') + ')' : ''));
    say(runs.length > 0, 'this part has runs to make', runs.length);
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
        return host ? { face: host.getAttribute('ckface'), big: host.hasAttribute('fcbig'), lay: host.hasAttribute('lay') } : null;
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
        say(!!ink && ink.l <= 60 && ink.t <= 70, screen + ' ' + W + 'x' + H + ': ...in the upper-left corner', ink);
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
      if (want === 'look') {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const frame = () => page.evaluate((screen) => {
          const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          const fr = deep(document).find((e) => e.tagName === 'IFRAME'); let w = null; try { w = fr && fr.contentWindow; } catch (e) { /* not ours */ }
          const all = w && w.document ? deep(w.document) : [];
          const b = w && w.hkSettings ? (w.hkSettings.get('boards', {}) || {})[screen] || {} : {};
          // (its room headings and scenes' heading: on the look alone, the scenes and one room)
          return fr ? { src: fr.getAttribute('src'), same: fr.__mark === 1, doc: !!(w && w.__mark), heads: all.filter((e) => e.tagName === 'HK-HEADING-CARD').length,
                        chips: all.some((e) => e.tagName === 'HK-CHIPS-CARD'), scenes: all.some((e) => e.tagName === 'HK-SCENES-CARD'), accent: b.accent || null } : null;
        }, screen);
        const until = async (f, ms) => { let v; for (let t = 0; t < ms; t += 25) { v = await frame(); if (v && f(v)) return v; await page.waitForTimeout(25); } return v; };
        await page.goto(input.origin + '/settings#/screens/' + screen + '/appearance');
        const up = await until((v) => /hk_preview=look/.test(v.src) && v.heads > 0, 25000);
        say(!!up && up.heads > 0 && up.heads <= 2 && up.chips && up.scenes, screen + ': its Appearance page previews the look alone: the chips, the scenes and one room', up);
        await page.evaluate(() => { const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          const fr = deep(document).find((e) => e.tagName === 'IFRAME'); fr.__mark = 1; fr.contentWindow.__mark = 1; });
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-appearance.png' });
        await page.goto(input.origin + '/settings#/screens/' + screen + '/accent');
        await page.waitForTimeout(800);
        const was = (await frame()).accent, pick = was === 'green' ? 'blue' : 'green';
        await page.locator('[data-fk*="' + pick + '"]').first().click();
        const t0 = Date.now(), got = await until((v) => v.accent === pick, 5000), ms = Date.now() - t0;
        say(!!got && got.accent === pick && ms < 2000 && got.same && got.doc, screen + ': ...an Accent Color there in moments (' + ms + ' ms), in the same page', got);
        await page.goto(input.origin + '/settings#/screens/' + screen + '/chips');
        const back = await until((v) => !/hk_preview/.test(v.src) && v.heads > 2, 25000);
        say(!!back && back.same, screen + ': its other pages preview the whole screen, in the same frame', back);
        say(!errors.length, screen + ': no page errors', errors.slice(0, 3));
        await ctx.close();
        continue;
      }
      if (want === 'preview') {
        await page.evaluate(() => window.hkSaver && window.hkSaver.preview && window.hkSaver.preview(false));
        await page.setViewportSize({ width: 1440, height: 1000 });
        const frame = () => page.evaluate(() => {
          const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          const fr = deep(document).find((e) => e.tagName === 'IFRAME'); let w = null; try { w = fr && fr.contentWindow; } catch (e) { /* not ours */ }
          const S = w && w.hkSaver, st = S && S.stats ? S.stats() : null;
          return fr ? { src: fr.getAttribute('src'), same: fr.__mark === 1, doc: !!(w && w.__mark), on: !!(st && st.on && st.preview), bg: S && S.config() ? S.config().clock_bg : null,
                        views: w && w.document ? w.document.querySelectorAll('hk-grid-view,hk-home-grid-view').length : -1 } : null;
        });
        const until = async (f, ms) => { let v; for (let t = 0; t < ms; t += 25) { v = await frame(); if (v && f(v)) return v; await page.waitForTimeout(25); } return v; };
        await page.goto(input.origin + '/settings#/screens/' + screen + '/screensaver');
        const up = await until((v) => v.on, 20000);
        say(!!up && /[?&]hk_preview=saver\b/.test(up.src) && up.views === 0, screen + ': its Screensaver page previews the screensaver alone (no dashboard)', up);
        await page.evaluate(() => { const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          const fr = deep(document).find((e) => e.tagName === 'IFRAME'); fr.__mark = 1; fr.contentWindow.__mark = 1; });
        const row = page.locator('[data-sk="saver:clock_bg"].pvrow').first();
        await row.scrollIntoViewIfNeeded(); await row.click();
        await page.locator('[data-fk="saver:clock_bg:aurora"]').first().click();
        const t0 = Date.now(), got = await until((v) => v.bg === 'aurora', 3000), ms = Date.now() - t0;
        say(!!got && got.bg === 'aurora' && ms < 1000, screen + ': ...a change shows there at once (' + ms + ' ms)', got);
        await page.waitForTimeout(2500);
        const after = await frame();
        say(!!after && after.same && after.doc && after.on, screen + ': ...in place: the same frame and page after the save comes back, still showing', after);
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-settings.png' });
        await page.goto(input.origin + '/settings#/screens/' + screen);
        const back = await until((v) => !/hk_preview/.test(v.src) && v.views > 0, 20000);
        say(!!back && back.same, screen + ': its other pages preview the screen again, in the same frame', back);
        say(!errors.length, screen + ': no page errors', errors.slice(0, 3));
        await ctx.close();
        continue;
      }
      if (want === 'day-ink' || want === 'big-corners') {
        const m = await page.evaluate(() => {
          const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          const sr = host && host.shadowRoot, out = [];
          const walk = (n) => { if (!n) return; if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
            const p = n.parentElement, cs = getComputedStyle(p); let op = 1; for (let e = p; e && e.nodeType === 1; e = e.parentElement || (e.getRootNode && e.getRootNode().host)) op *= Number(getComputedStyle(e).opacity);
            if (r.width > 0 && op > 0.05) out.push({ t: n.textContent.trim().slice(0, 30), c: cs.color, l: r.left, r: r.right, top: r.top, b: r.bottom }); }
            (n.shadowRoot ? [...n.shadowRoot.childNodes] : []).concat([...(n.childNodes || [])]).forEach(walk); };
          walk(sr && sr.querySelector('.info'));
          const box = (sel) => { const e = sr && sr.querySelector(sel), r = e && e.getBoundingClientRect(); return r ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
          const now = sr && sr.querySelector('.info hk-screensaver-now-card'), nc = now && now.shadowRoot && now.shadowRoot.querySelector('.sscorner img,.sscorner .ph');
          const nr = nc && nc.getBoundingClientRect();
          const inks = [...(sr ? sr.querySelectorAll('.hkf.weather .rd > div > *') : [])].map((e) => { const rg = document.createRange(); rg.selectNodeContents(e); const r = e.tagName === 'svg' ? e.getBoundingClientRect() : rg.getBoundingClientRect(); return r.right; });
          // the Day face: its day's name and date (their figures), the corner's words, the art moving, the glyph's ink
          const tbx = (sel) => { const e = sr && sr.querySelector(sel); if (!e) return null; const rg = document.createRange(); rg.selectNodeContents(e); const r = rg.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
          const wdb = tbx('.hkf.day .wd'), dnb = tbx('.hkf.day .dn');
          if (dnb) { const h = dnb.b - dnb.t; dnb.t += h * 0.2; dnb.b = dnb.t + h * 0.65; }
          const cw = []; const walk2 = (n) => { if (!n) return; if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect(); if (r.width > 0) cw.push(r); }
            (n.shadowRoot ? [...n.shadowRoot.childNodes] : []).concat([...(n.childNodes || [])]).forEach(walk2); };
          (sr ? [...sr.querySelectorAll('.info > hk-clock-card, .info > hk-weather-strip-card' + (innerWidth < 600 ? ', .info > hk-screensaver-status-card' : ''))] : []).forEach(walk2);
          const corner = cw.length ? { l: Math.min(...cw.map((r) => r.left)), r: Math.max(...cw.map((r) => r.right)), t: Math.min(...cw.map((r) => r.top)), b: Math.max(...cw.map((r) => r.bottom)) } : null;
          const moving = sr ? [...sr.querySelectorAll('.hkf.day .art > *')].flatMap((e) => e.getAnimations()).filter((a) => a.playState === 'running').map((a) => a.animationName) : [];
          // bats only on an occasion that has them (Halloween); the season's leaves (or petals, snow) every day
          const flies = sr ? sr.querySelectorAll('.hkf.day .art .fly, .hkf.day .art .flutter').length : 0;
          const wxCard = sr && sr.querySelector('.info > hk-weather-strip-card'), glyph = wxCard && wxCard.shadowRoot && wxCard.shadowRoot.querySelector('svg.hk-wx path, hk-icon.hk-wx');
          const facefoot = sr && sr.querySelector('.ck .hkf.day') ? sr.querySelector('.ck .hkf.day').getBoundingClientRect().bottom : null;
          return { wd: wdb, dn: dnb, corner, moving, flies, glyphInk: glyph ? getComputedStyle(glyph).fill || getComputedStyle(glyph).color : null, facefoot,
                   texts: out, tm: box('.hkf.weather .tm'), rd: box('.hkf.weather .rd'), np: nr ? { l: nr.left, t: nr.top, r: nr.right, b: nr.bottom } : null, rdRight: inks.length ? Math.max(...inks) : null, W: innerWidth, light: host && host.hasAttribute('cklight') };
        });
        const lum = (c) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number); return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255; };
        const tag = screen + ' ' + W + 'x' + H;
        if (want === 'day-ink') {
          const light = m.texts.filter((x) => lum(x.c) > 0.5);
          say(started && m.light && m.texts.length >= 3, tag + ': the light Day face, its corners there', m.texts.map((x) => x.t));
          say(!light.length, tag + ': ...every word in them dark on its light page', light);
          // (2026-10-31, the owner: the clock "colliding into the name of the Day"; "bats flying, leaves falling")
          const meet = (a, b) => !!(a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b);
          say(!!m.corner && !!m.wd && !meet(m.corner, m.wd) && !meet(m.corner, m.dn), tag + ': ...the corner’s words clear of the day’s name and its date', [m.corner, m.wd, m.dn]);
          say(!!m.dn && m.dn.b <= m.facefoot + 1, tag + ': ...the date whole on the face', [m.dn, m.facefoot]);
          say(m.moving.includes('hkf-fall') && (!m.flies || m.moving.includes('hkf-fly') && m.moving.includes('hkf-flap')),
              tag + ': ...its leaves falling' + (m.flies ? ', its bats flying' : ' (no bats today: not an occasion with them)'), m.moving);
          say(!!m.glyphInk && lum(m.glyphInk) < 0.5, tag + ': ...the weather’s glyph in the dark ink too', m.glyphInk);
        } else {
          const st = m.texts.filter((x) => /Disarmed|Unlocked/.test(x.t)), over = (a, b) => a && b && a.l < b.r && b.l < a.r && a.top < b.b && b.top < a.b;
          say(started && st.length > 0 && !!m.tm, tag + ': Big Weather with Home Status', st.map((x) => x.t));
          say(st.every((x) => !over(x, { l: m.tm.l, r: m.tm.r, top: m.tm.t, b: m.tm.b }) && x.top >= m.tm.b - 1), tag + ': ...Home Status under the time, never on it', [st, m.tm]);
          say(st.every((x) => x.r <= m.W + 1 && !/…|\.\.\./.test(x.t)), tag + ': ...whole, on the screen', st);
          if (W > H) {
            say(!!m.np && !!m.rd && Math.abs(m.np.t - m.rd.t) <= 2 && Math.abs(m.np.b - m.rd.b) <= 2, tag + ': what plays and the readings share the bottom row', [m.np, m.rd]);
            say(!!m.np && m.rdRight != null && Math.abs(m.np.l - (m.W - m.rdRight)) <= 2, tag + ': ...the same margin each side', [m.np && m.np.l, m.W - m.rdRight]);
          } else say(!!m.np && !!m.rd && m.np.b <= m.rd.t - 4, tag + ': what plays above the readings, clear of them', [m.np, m.rd]);
        }
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '.png' });
        await ctx.close();
        continue;
      }
      if (/^lay-/.test(want)) {
        const tag = screen + ' ' + W + 'x' + H;
        // (Planted needs the sky it stands under: pinned, the screensaver started again under it)
        if (want === 'lay-planted') {
          await page.evaluate(() => { window.hkSaver.preview(false); window.hkSky._pin({ season: '', land: 'fall', wet: { kind: 'none', rate: 0 }, fog: false, wind: 4, moon: 0.4, elev: 30, azim: 182, cond: 'sunny', cover: 0.1 }); });
          await page.waitForTimeout(800);
          await page.evaluate(() => window.hkSaver.preview(true));
          await page.waitForTimeout(7000);
        } else await page.waitForTimeout(3000);
        if (want === 'lay-energy') {
          // (a page held by a loop of reads answers nothing: asked with a time limit, never waited on forever)
          const alive = await Promise.race([page.evaluate(() => new Promise((r) => setTimeout(() => r(true), 50))), new Promise((r) => setTimeout(() => r(false), 8000))]);
          say(alive, tag + ': the Battery, Inside, Energy Today and Solar widgets: the page answers', alive);
          if (!alive) { await ctx.close().catch(() => {}); continue; }
        }
        const m = await page.evaluate(() => {
          const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          const host = deep(document).find((e) => e.tagName === 'HK-SCREENSAVER'), sr = host && host.shadowRoot, lay = sr && sr.querySelector('.lay');
          if (!sr) return null;
          const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
          const rect = (e) => e ? box(e.getBoundingClientRect()) : null;
          // the union of the boxes of what is drawn: the words and the pictures under a node (never its container, which a face makes
          // bigger than its figures; never a <style>'s text)
          const union = (nodes) => { const q = nodes.filter((r) => r.width > 0 && r.height > 0);
            return q.length ? { l: Math.min(...q.map((r) => r.left)), t: Math.min(...q.map((r) => r.top)), r: Math.max(...q.map((r) => r.right)), b: Math.max(...q.map((r) => r.bottom)) } : null; };
          const drawn = (root) => { const q = [], words = [];
            const walk = (n) => { if (n.nodeType === 3) { if (n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); q.push(rg.getBoundingClientRect()); words.push(n.textContent.trim()); } return; }
              if (n.nodeType !== 1 || n.tagName === 'STYLE') return;
              if (/^(svg|canvas|img)$/i.test(n.tagName)) { q.push(n.getBoundingClientRect()); return; }
              n.childNodes.forEach(walk); };
            walk(root); return { ink: union(q), text: words.join(' ') }; };
          // a card's visible inner box: the status, now-playing and timers cards draw in a position:fixed box of their own
          // (the card element itself is empty of size); the clock and the weather as everything their shadow tree draws
          const inner = (c) => {
            const k = c.shadowRoot ? [...c.shadowRoot.querySelectorAll('*')].filter((n) => n.tagName !== 'STYLE') : [];
            const fixed = /STATUS|NOW|TIMER/.test(c.tagName) ? k.find((n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().height > 0) : null;
            return fixed ? rect(fixed) : union(k.map((n) => n.getBoundingClientRect()));
          };
          const cards = sr ? [...sr.querySelectorAll('.info > *')].map((c) => ({ tag: c.tagName.toLowerCase().replace(/^hk-|-card$/g, ''), hide: c.hasAttribute('lyhide'), box: c.hasAttribute('lyhide') ? null : inner(c) })) : [];
          const lybig = lay && lay.querySelector('.lybig'), tbt = sr.querySelector('.ph .tb .tbt');
          const ws = lay ? [...lay.querySelectorAll('.hksw')].map((e) => ({ id: (e.className.match(/\bw-(\S+)/) || [])[1], cls: e.className, box: rect(e), shown: getComputedStyle(e).display !== 'none' })) : [];
          // (the box the plan gave the big element: what the widgets and cards are placed around, in this page's px)
          const info = window.hkSaver.layoutInfo && window.hkSaver.layoutInfo(), pb = info && info.plan && info.plan.big;
          const land = lay && lay.querySelector('.lyland'), lst = land && getComputedStyle(land);
          return { lay: host.hasAttribute('lay'), plan: pb ? { l: pb.x, t: pb.y, r: pb.x + pb.w, b: pb.y + pb.h } : null, prow: info && info.plan ? info.plan.row : null, pm: info && info.plan ? info.plan.m : null, tb: host.hasAttribute('tb'), W: innerWidth, H: innerHeight, hasLay: !!lay,
                   big: lybig ? Object.assign({ box: rect(lybig), spans: lybig.querySelectorAll('span').length, days: [...lybig.querySelectorAll('span')].filter((e) => /^\d{1,2}$/.test(e.textContent.trim())).length,
                                  figures: lybig.querySelectorAll('.pl .pd .b').length, faces: lybig.querySelectorAll('.face').length },
                                  lybig.classList.contains('planted') ? { ink: union([...lybig.querySelectorAll('.pd .b')].map((e) => e.getBoundingClientRect())), text: lybig.querySelector('.pd .b') ? 'planted' : '' } : drawn(lybig)) : null,
                   tbt: tbt ? rect(tbt) : null,
                   land: land ? { box: rect(land), img: lst.backgroundImage, after: !!(lybig && lybig.compareDocumentPosition(land) & 4) } : null,
                   ck: { n: sr.querySelectorAll('.ck').length, own: [...sr.querySelectorAll('.ck .face')].filter((f) => !f.closest('.lay') && f.getBoundingClientRect().width > 0 && getComputedStyle(f).visibility !== 'hidden' && getComputedStyle(f).display !== 'none').length },
                   ws, cards };
        });
        const inScreen = (b) => !!b && b.l >= -1 && b.t >= -1 && b.r <= m.W + 1 && b.b <= m.H + 1;
        const meet = (a, b) => !!(a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1);
        say(started && !!m && m.lay && m.hasLay, tag + ': the screensaver draws a layout (the host has lay, with its layer)', m && [m.lay, m.hasLay]);
        if (!m) { await ctx.close(); continue; }
        const ink = m.big && m.big.ink, bigOk = !!ink && ink.r - ink.l > 20 && ink.b - ink.t > 10;
        // (what the others are placed around is the plan's box for the big element, not its figures' text lines, which are taller than the glyphs)
        const big = m.plan;
        // (Clock's neon face too: its plan's box was once as wide as its colon -- layoutBig measured only the face's innermost
        // things, and neon's figures are words with glow inside them -- fixed 2026-11-01, and checked here since)
        const neon = false;
        say(!!big && big.b - big.t > 10 && (neon || big.r - big.l > 20), tag + ': ...the plan gives the big element a box', m.plan);
        // (a little room for the digits: the plan's box was measured on the time as it was, and "12:19" is wider than "11:11")
        const slack = big ? 3 + 0.05 * (big.r - big.l) : 3;
        if (want !== 'lay-planted' && !neon) say(bigOk && !!big && ink.l >= big.l - slack && ink.r <= big.r + slack, tag + ': ...drawn in its box (sideways)', [ink, big]);
        if (want === 'lay-lock') {
          say(bigOk, tag + ': ...the big time is drawn, with a box', m.big);
          const row = m.ws.filter((w) => w.shown && /^(temp|aqi|timer|locks)$/.test(w.id));
          say(row.length === 4 && row.every((w) => inScreen(w.box)), tag + ': ...four widgets in the row, all inside the screen', row.map((w) => [w.id, w.box]));
          const date = m.ws.find((w) => w.id === 'date');
          say(!!date && !!big && date.box.b <= big.t + 1, tag + ': ...the date above the big time', date && [date.box, big]);
          say(row.length > 0 && !!big && row.every((w) => w.box.t >= big.b - 1), tag + ': ...the row below it', [row.map((w) => w.box.t), big]);
        } else if (want === 'lay-wall') {
          say(bigOk, tag + ': ...the big time is drawn, with a box', m.big);
          // (a new screen has no photos: Photos falls back to the forecast, and Behind has nothing to be behind -- the time stands in front)
          say(!m.tb && !m.tbt && !!m.big && m.big.faces > 0, tag + ': ...with no photos the time stands in front, as a face of its own', [m.tb, m.tbt, m.big && m.big.faces]);
          const shown = m.cards.filter((c) => !c.hide && c.box);
          say(m.cards.filter((c) => !c.hide).length === 4 && shown.some((c) => c.tag === 'weather-strip') && shown.some((c) => c.tag === 'screensaver-status'),
              tag + ': ...the four corner cards the plan names, none left out (the weather and Home Status drawn)', m.cards.map((c) => [c.tag, c.hide, c.box]));
          say(shown.every((c) => inScreen(c.box)), tag + ': ...every card inside the screen', shown.map((c) => [c.tag, c.box]));
          say(shown.every((c) => !meet(c.box, big)), tag + ': ...no card on the big time', [shown.map((c) => [c.tag, c.box]), big]);
          let clash = null;
          for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) if (meet(shown[i].box, shown[j].box)) clash = [shown[i].tag, shown[i].box, shown[j].tag, shown[j].box];
          say(!clash, tag + ': ...no card on another card', clash);
        } else if (want === 'lay-planted') {
          say(!!m.big && m.big.figures > 0, tag + ': ...the planted figures (.pd .b) are drawn', m.big && m.big.figures);
          const band = m.ws.find((w) => /\bk-band\b/.test(w.cls));
          if (W > H) say(!!band && !!big && band.box.t >= big.b - 1, tag + ': ...the readings band below the figures', band && [band.box, big]);
          else say(!!band && inScreen(band.box), tag + ': ...the readings band inside the screen', band && band.box);
        } else if (want === 'lay-clock') {
          say(m.ck.n > 0, tag + ': ...the Clock\'s background (.ck) is there', m.ck);
          say(m.ck.own === 0, tag + ': ...with no face of its own', m.ck);
          say(!!m.big && m.big.faces > 0 && bigOk && /\d/.test(m.big.text), tag + ': ...the layout\'s own face is the time', m.big);
        } else if (want === 'lay-energy') {
          const R = m.prow, lines = R ? [...new Set(R.items.map((it) => Math.round(it.y)))] : [];
          say(!!R && R.items.length === 5 && lines.length === 2, tag + ': ...five widgets on two lines', R && R.items);
          say(!!R && R.at === 'bottom' && Math.abs(Math.max(...R.items.map((it) => it.y + it.h)) - (H - m.pm)) <= 1, tag + ': ...along the bottom, on its margin', [R, m.pm]);
        } else if (want === 'lay-behind') {
          // BEHIND THE LAND: the land again, over the time and no bigger than it (never a second full-screen layer)
          say(!!m.land && /land-[a-z0-9-]+\.webp/.test(m.land.img) && m.land.after, tag + ': ...the land drawn again over the time', m.land);
          say(!!m.land && !!big && m.land.box.r - m.land.box.l <= big.r - big.l + 12 && m.land.box.b - m.land.box.t <= big.b - big.t + 12,
              tag + ': ...in a box the time\'s size', m.land && [m.land.box, big]);
        } else if (want === 'lay-month') {
          const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          const days = m.big ? m.big.text : '';
          say(!!m.big && names.some((n) => days.includes(n)), tag + ': ...the big element has the month\'s name', m.big && m.big.text.slice(0, 40));
          say(!!m.big && m.big.days >= 28 && m.big.days <= 31, tag + ': ...and its 28-31 days', m.big && m.big.days);
          const clock = m.cards.find((c) => !c.hide && /clock/.test(c.tag));
          say(!!clock && !!clock.box && inScreen(clock.box) && !meet(clock.box, big), tag + ': ...the clock card inside the screen, off the month', [clock, big]);
        }
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '.png' });
        await ctx.close();
        continue;
      }
      if (want === 'planted') {
        const tag = screen + ' ' + W + 'x' + H;
        // the sky pinned, the screensaver started again under it
        const under = async (sky) => {
          await page.evaluate((sky) => { window.hkSaver.preview(false); window.hkSky._pin(Object.assign({ season: '', land: 'fall', wet: { kind: 'none', rate: 0 }, fog: false, wind: 4, moon: 0.4 }, sky)); }, sky);
          await page.waitForTimeout(800);
          await page.evaluate(() => window.hkSaver.preview(true));
          await page.waitForTimeout(7000);
          return page.evaluate(() => {
            const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
            const all = deep(document), face = all.find((e) => e.classList && e.classList.contains('hkf') && e.classList.contains('weather'));
            if (!face) return null;
            const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
            const fr = face.getBoundingClientRect(), g = window.hkSaverFaces._.plGeometry(face.clientWidth, face.clientHeight);
            const t = face.querySelector('.pl .pd .pf .t'), probe = document.createElement('i');
            let base = null;
            if (t) { probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; t.appendChild(probe); base = probe.getBoundingClientRect().top - fr.top; probe.remove(); }
            const np = all.find((e) => e.tagName === 'HK-SCREENSAVER-NOW-CARD' && e.getBoundingClientRect().height > 0);
            const seen = (e) => { for (let n = e; n && n !== face; n = n.parentElement) { const c = getComputedStyle(n); if (c.visibility !== 'visible' || c.display === 'none' || +c.opacity < 0.9) return false; } return true; };
            return { planted: face.classList.contains('planted'), faceSeen: !!t && seen(t) && /gradient/.test(getComputedStyle(t).backgroundImage), old: getComputedStyle(face.querySelector('.tp')).display, text: t && t.textContent,
                     boxes: Math.max(...[...face.querySelectorAll('.pl .b')].map((e) => e.offsetHeight)) / g.fs, base: base, ground: g.yG, cast: face.querySelectorAll('.pl .ps .b').length, contact: face.querySelectorAll('.pl .pc .b').length,
                     grass: box(face.querySelector('.pl canvas.pg')), figures: box(t), rd: box(face.querySelector('.rd')), np: box(np) };
          });
        };
        const day = await under({ elev: 30, azim: 182, cond: 'sunny', cover: 0.1 });
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '-day.png' });
        say(started && !!day && day.planted && day.old === 'none' && /^\d{1,2}:\d\d$/.test(day.text || ''), tag + ': Big Weather\'s time planted in the meadow, the old one gone', day && [day.planted, day.old, day.text]);
        say(!!day && day.faceSeen, tag + ': ...its ivory front face drawn (never hidden by a rule of the screensaver\'s)', day && day.faceSeen);
        say(!!day && day.boxes > 0.8 && day.boxes < 1.4, tag + ': ...every layer the time\'s own size, never the screen\'s (each projected one is a composited layer)', day && day.boxes);
        say(!!day && day.base != null && Math.abs(day.base - day.ground) <= 1, tag + ': ...its baseline on the land\'s ground line', day && [day.base, day.ground]);
        say(!!day && day.cast === 4 && day.contact === 3, tag + ': ...the sun\'s and the sky\'s shadows, and the feet on the grass', day && [day.cast, day.contact]);
        say(!!day && !!day.grass && day.grass.t < day.ground && day.grass.b > day.ground, tag + ': ...the grass across its feet', day && [day.grass, day.ground]);
        const clear = (a, b) => !a || !b || a.b <= b.t + 1 || b.b <= a.t + 1 || a.r <= b.l + 1 || b.r <= a.l + 1;
        say(!!day && clear(day.grass, day.rd) && clear(day.figures, day.rd) && clear(day.grass, day.np) && clear(day.figures, day.np),
            tag + ': ...clear of the readings and what plays', day && [day.figures, day.grass, day.rd, day.np]);
        const night = await under({ elev: -25, azim: 300, cond: 'clear-night', cover: 0.05 });
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '-night.png' });
        say(!!night && night.planted && night.cast === 2 && night.contact === 3, tag + ': at night, no sun\'s shadow (the sky\'s faint one and the feet\'s only)', night && [night.cast, night.contact]);
        await page.evaluate(() => window.hkSky._pin(null));
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
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
      // (2026-11-01: no layout saved, no layout drawn -- the screensaver's own cards and faces, as every Show always had)
      say(!!got && !got.lay, screen + ': ...with no layout saved, no layout is drawn (the host never gets lay)', got);
      say(!errors.length, screen + ': no page errors', errors.slice(0, 3));
      if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '.png' });
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? 'FAIL: ' + fails : 'saver shows: all checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
