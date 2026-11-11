// saver_shows_check.py's browser half: each screen's screensaver, started as the house starts it, and its face.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
let lastMinuteDone = false;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok ? '' : '  got ' + JSON.stringify(got))); };
  // WAITING AS LONG AS THE PAGE NEEDS (2026-11-02): each run waited fixed seconds (2 s, 4 s, 2.6 s a slide ...), most of
  // the ~2100 s the check took. settle(ceiling) returns once the screensaver is still -- nothing in flight on the network
  // or the socket, no transition or finite animation running, every picture loaded, the fonts in, and what is drawn the
  // same (its elements, the host's attributes, its layers' opacity and display) for QUIET ms (a call's `quiet`), not
  // before its `floor` -- and never later than the old fixed wait, its ceiling. SAVER_SETTLE=probe waits each ceiling
  // out and says when it would have been still, what still moved, and any change after it was (for setting QUIET and
  // the floors); SAVER_SETTLE=fixed waits the ceilings, as before. (Most of the time left is the screensaver's own
  // fades -- 4 s in, 3 s between slides -- which a check of what they end on has to wait out.)
  const MODE = process.env.SAVER_SETTLE || 'quiet', QUIET = Number(process.env.SAVER_QUIET || 1000), POLL = 120;
  const still = () => {
    const deep = (r, out) => { for (const e of r.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) { out.roots.push(e.shadowRoot); deep(e.shadowRoot, out); } } return out; };
    const all = deep(document, Object.assign([], { roots: [] }));
    const host = all.find((e) => e.tagName === 'HK-SCREENSAVER'), sr = host && host.shadowRoot;
    const anims = new Set([...document.getAnimations(), ...all.roots.flatMap((r) => (r.getAnimations ? r.getAnimations() : []))]);
    const busy = [...anims].filter((a) => a.playState === 'running' && (a.effect && a.effect.getComputedTiming().endTime !== Infinity)).length;
    const imgs = all.filter((e) => e.tagName === 'IMG' && e.getAttribute('src') && !e.complete).length;
    const layers = sr ? [...sr.querySelectorAll('.lay,.info,.info > *,.mu,.ph,.scn,.ck,.fc,.lycut,.lybig,.hksw')].map((e) => {
      const cs = getComputedStyle(e); return e.className + ':' + cs.display + ':' + cs.visibility + ':' + Number(cs.opacity).toFixed(2); }).join('|') : '';
    const what = [...anims].filter((a) => a.playState === 'running' && (a.effect && a.effect.getComputedTiming().endTime !== Infinity)).map((a) => {
      const t = a.effect.target, tm = a.effect.getComputedTiming();
      return (a.animationName || a.transitionProperty || a.id || 'js') + '@' + (t ? t.tagName.toLowerCase() + '.' + String(t.className).split(' ')[0] : '?') + ' ' + Math.round(tm.endTime) + 'ms at ' +
        Math.round(a.currentTime); });
    return { busy, imgs, fonts: document.fonts.status, what,
             key: [location.href, all.length, host ? [...host.attributes].map((a) => a.name + '=' + a.value).join(' ') : '-', layers].join('#') };
  };
  const quiet = (page) => {
    let inflight = 0, net = Date.now();
    page.on('request', () => { inflight++; net = Date.now(); });
    const done = () => { inflight = Math.max(0, inflight - 1); net = Date.now(); };
    page.on('requestfinished', done); page.on('requestfailed', done);
    page.on('websocket', (ws) => ws.on('framereceived', () => { net = Date.now(); }));
    return async (ceiling, { quiet: Q = QUIET, floor = 0 } = {}) => {
      const where = ((new Error().stack.split('\n')[2] || '').match(/:(\d+):\d+\)?$/) || [])[1];
      if (MODE === 'fixed') return page.waitForTimeout(ceiling);
      const t0 = Date.now();
      let last = null, since = t0, quietAt = null, changed = 0, why = '', lastWhat = [];
      for (;;) {
        const now = Date.now(), f = await page.evaluate(still).catch(() => null);
        if (!f || f.key !== last) {
          if (MODE === 'probe' && quietAt !== null && last && f) {
            const a = last.split('#'), b = f.key.split('#');
            console.log('SETTLE-CHANGE line ' + where + ' at ' + (now - t0) + ': ' +
              a.map((x, i) => x === b[i] ? '' : i === 3 ? x.split('|').filter((y) => !b[3].split('|').includes(y)).join('|') + ' -> ' +
              b[3].split('|').filter((y) => !x.split('|').includes(y)).join('|') : x + ' -> ' + b[i]).filter(Boolean).join(' ; ').slice(0, 600));
          }
          last = f && f.key; since = now; changed = now - t0;
        }
        lastWhat = (f && f.what) || [];
        why = !f ? 'no page' : f.busy ? f.busy + ' animating' : f.imgs ? f.imgs + ' pictures loading' : f.fonts !== 'loaded' ? 'fonts'
          : inflight ? inflight + ' requests' : now - net < Q ? 'network' : now - since < Q ? 'changing' : now - t0 < floor ? 'floor' : '';
        if (!why && quietAt === null) quietAt = now - t0;
        if ((!why && MODE !== 'probe') || now - t0 >= ceiling) break;
        await page.waitForTimeout(POLL);
      }
      if (MODE === 'probe') console.log('SETTLE line ' + where + ' ceiling ' + ceiling + ' still at ' + quietAt + ' last change ' + changed + (quietAt === null ? ' (' + why + ')' : '') +
        (lastWhat.length ? ' ANIM ' + lastWhat.join(', ') : ''));
    };
  };
  try {
    const runs = Object.entries(input.shows).filter(([screen]) => screen.includes(input.only || '')).flatMap(([screen, want]) => want === 'tb' ? [[screen, want, 1180, 820], [screen, want, 390, 844]]
      : want === 'day-ink' ? [[screen, want, 1180, 820], [screen, want, 820, 1180], [screen, want, 390, 844]]
      // (a layout also on a phone on its side, 844 x 390: the least height of all -- the owner, 2026-11-02, "What about landscape phone")
      : /^lay-/.test(want) || want === 'look-slides' ? [[screen, want, 1180, 820], [screen, want, 820, 1180], [screen, want, 390, 844], [screen, want, 844, 390]]
      : want === 'look-fb' ? [[screen, want, 1180, 820], [screen, want, 820, 1180], [screen, want, 390, 844]]
      : want === 'tb-fade' ? [[screen, want, 1180, 820]]
      : want === 'lay-align' ? [[screen, want, 1180, 820], [screen, want, 390, 844]]
      : want === 'lay-date' ? [[screen, want, 1180, 820], [screen, want, 820, 1180], [screen, want, 390, 844]]
      : want === 'big-corners' || want === 'planted' ? [[screen, want, 1180, 820], [screen, want, 820, 1180], [screen, want, 390, 844]] : [[screen, want, 1180, 820]])
      // (--one-size: each Show at its first size, the release run's; --shard K/N: every N-th run from the K-th, side by side)
      .filter(([screen, want], i, all) => !input.one_size || all.findIndex((r) => r[0] === screen) === i)
      .filter((_, i) => !input.shard || i % input.shard[1] === input.shard[0] - 1);
    console.log('saver shows: ' + runs.length + ' runs' + (input.shard && input.shard[1] > 1 ? ' (part ' + input.shard.join(' of ') + ')' : ''));
    say(runs.length > 0, 'this part has runs to make', runs.length);
    for (const [screen, want, W, H] of runs) {
      // (a finger, as the wall tablet has: a tap is touch events, then the mouse's)
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      const settle = quiet(page);
      await page.goto(input.origin + '/' + screen + '/home');
      await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
      await require('./grid_ready.cjs')(page);
      await settle(2000, { quiet: 600 });          // (still at ~0.9 s; never a change after, 150 of 150 runs)
      await require('./grid_ready.cjs').saver(page);      // (the saver's parts arrive after its file: hkSaver is set once they have run)
      const started = await page.evaluate(() => !!(window.hkSaver && window.hkSaver.preview && (window.hkSaver.preview(true), true)));
      // (a fixed wait: the screensaver fades in over 4 s, and ~3.3 s in it takes 5 elements away after a second of
      // stillness -- probed 2026-11-02, 42 of 150 runs; nothing quieter tells when that is done)
      await page.waitForTimeout(4000);
      const got = await page.evaluate(() => {
        const deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
        const host = document.querySelector('hk-screensaver') || deep(document, '[ckface],[fcbig]')[0] ||
          [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
        return host ? { face: host.getAttribute('ckface'), big: host.hasAttribute('fcbig'), lay: host.hasAttribute('lay') } : null;
      });
      if (want === 'lay-date') {
        // THE DATE'S OPTIONS (2026-11-04): one line as before; two lines lined up on one edge by their ink -- Auto by
        // the corner's side, Center when asked -- inside the screen; bold capitals where asked
        const tag = screen + ' ' + W + 'x' + H;
        await page.waitForTimeout(3000);
        const d = await page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          const sr = host.shadowRoot, ink = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
          return [...sr.querySelectorAll('.lay .hksw.p-date')].map((w) => { const b = w.getBoundingClientRect(), il = w.querySelector('.il');
            return { two: !!w.querySelector('.dl'), box: [b.left, b.top, b.right, b.bottom], lines: [...il.children].map((s) => { const r = ink(s); return [r.left, r.right, r.top, r.bottom]; }),
                     text: il.textContent, up: getComputedStyle(il).textTransform, wt: getComputedStyle(il).fontWeight, al: w.className.match(/al-(\w+)/) }; }); });
        const at = (fn) => d.find(fn), one = at((x) => !x.two), right = at((x) => x.two && x.box[0] > W / 2 && x.box[1] < H / 2),
              caps = at((x) => x.up === 'uppercase'), mid = at((x) => x.two && x.box[0] > W / 2 && x.box[1] > H / 2);
        say(d.length === 4 && !!one && one.lines.length === 1 && /, /.test(one.text), tag + ': the Date as before, one line', one);
        // (1.5 px, as the edges: a Tuesday's lines overlap by 1.01 px at 1180x820, 2026-11-10 -- the date's own text, not a layout change)
        say(!!right && right.lines.length === 2 && Math.abs(right.lines[0][1] - right.lines[1][1]) <= 1.5 && right.lines[0][3] <= right.lines[1][2] + 1.5, tag +
          ': two lines on the right corner end on one edge, the weekday over the date', right);
        say(!!caps && caps.lines.length === 2 && Math.abs(caps.lines[0][0] - caps.lines[1][0]) <= 1.5 && +caps.wt >= 700, tag + ': short, bold capitals on the left start on one edge', caps);
        say(!!mid && Math.abs((mid.lines[0][0] + mid.lines[0][1]) - (mid.lines[1][0] + mid.lines[1][1])) <= 3 && /\/\d{4}/.test(mid.text), tag +
          ': centered when asked, the date as numbers with its year', mid);
        say(d.every((x) => x.box[0] >= 0 && x.box[2] <= W + 0.5 && x.box[1] >= 0 && x.box[3] <= H + 0.5 && x.lines.every((l) => l[3] <= x.box[3] + 1)), tag +
          ': every Date inside the screen and its own box', d.map((x) => x.box));
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '.png' });
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        await ctx.close();
        continue;
      }
      if (want === 'lay-align') {
        const tag = screen + ' ' + W + 'x' + H;
        await page.waitForTimeout(3000);
        const al = await page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          const sr = host.shadowRoot, lines = (el) => [...el.querySelectorAll('.cd > div, .cd .mt > div')].filter((d) => d.textContent.trim() && d.getBoundingClientRect().height > 0).map((d) => {
            const q = []; (function walk(n) { if (n.nodeType === 3) { if (n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
              if (r.width) q.push(r); } } else if (n.nodeType === 1) n.childNodes.forEach(walk); })(d);
            return q.length ? { l: Math.min(...q.map((r) => r.left)), r: Math.max(...q.map((r) => r.right)), t: d.textContent.trim().slice(0, 16) } : null; }).filter(Boolean);
          const st = sr.querySelector('.lay .hksw.p-status'), mu = sr.querySelector('.lay .hksw.p-music'), wx = sr.querySelector('.lay .hksw.p-weather');
          const art = mu && mu.querySelector('.art'), mt = mu && mu.querySelector('.mt');
          return { box: st && [st.getBoundingClientRect().right, st.querySelector('.cd').getBoundingClientRect().right, getComputedStyle(st).paddingRight, st.className], wxbox: wx &&
            [wx.getBoundingClientRect().left, getComputedStyle(wx).paddingLeft], st: st ? lines(st) : null, wx: wx ? lines(wx) : null, art: art && art.getBoundingClientRect().right, text: mt &&
            mt.getBoundingClientRect().right, W: innerWidth };
        });
        const rightEdge = al.st && Math.max(...al.st.map((x) => x.r)), leftEdge = al.wx && Math.min(...al.wx.map((x) => x.l));
        say(!!al.st && al.st.length >= 2 && al.st.every((x) => Math.abs(x.r - rightEdge) <= 1.5), tag + ': Home Status on the right: every line ends on one edge', al.st);
        // (by the margin itself: the weather's big number hangs a little past it on purpose)
        say(!!al.st && !!al.wxbox && Math.abs((al.W - rightEdge) - al.wxbox[0]) <= 1.5, tag + ': ...on the screen\u2019s margin, the one the weather\u2019s card starts on at the left',
          [al.W - rightEdge, al.wxbox, al.box]);
        say(!!al.art && al.art > al.text, tag + ': ...and the music\u2019s art at its right edge, its words beside it', [al.art, al.text]);
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '.png' });
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        await ctx.close();
        continue;
      }
      if (want === 'tb-fade') {
        const tag = screen + ' ' + W + 'x' + H;
        await page.waitForTimeout(3000);
        // the cut-outs as they show now: each one's opacity times its picture's, and which photo it is
        const cuts = () => page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          return [...host.shadowRoot.querySelectorAll('.lay .lycut')].filter((t) => getComputedStyle(t).display !== 'none').map((t) => {
            const im = t.querySelector('img'); return { src: (im && im.getAttribute('src') || '').slice(-24), a: Number(getComputedStyle(t).opacity) * Number(getComputedStyle(im).opacity),
              dbg: [t.className, getComputedStyle(t).opacity, getComputedStyle(im).opacity, t.style.transition, im.style.opacity, t.style.display] }; }); });
        // the photo on show: a portrait's drawn middle against the screen's
        const shown = () => page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          const L = host.shadowRoot.querySelector('.ph.top'), im = L && L.querySelector('img.fg'); if (!im || !im.naturalWidth) return null;
          const r = im.getBoundingClientRect(); return { portrait: im.naturalHeight > im.naturalWidth, cx: (r.left + r.right) / 2, W: innerWidth, fit: getComputedStyle(im).objectFit,
            zm: L.style.getPropertyValue('--zm') }; });
        let sawFade = 0, sawPortrait = 0;
        for (let turn = 0; turn < 4; turn++) {
          const s0 = await shown();
          if (s0 && s0.portrait) { sawPortrait++; say(Math.abs(s0.cx - s0.W / 2) <= 2, tag + ': a zoomed whole portrait (Zoom ' + s0.zm + ') in the middle of the screen', s0); }
          const before = (await cuts()).filter((c) => c.a > 0.95);
          await page.evaluate(() => window.hkSaver.next());
          await page.waitForTimeout(60);
          await page.waitForTimeout(1140);
          const mid = await cuts();
          // (the outgoing people fade as their photo is covered: no longer solid, not yet gone)
          before.forEach((b) => { const m = mid.find((c) => c.src === b.src); sawFade++; say(!!m && m.a < 0.9 && m.a > 0.08, tag + ': the outgoing photo\u2019s cut-out fades with it', [b, m]); });
          // (an incoming one never pops in whole)
          mid.filter((c) => !before.some((b) => b.src === c.src)).forEach((c) => say(c.a < 0.9 && (c.a > 0.08 || Number(c.dbg[2]) < 0.05), tag +
            ': ...and the incoming one comes in with its photo, not at once', c));
          await page.waitForTimeout(4000);
          if (input.shots && turn < 2) await page.screenshot({ path: input.shots + '/' + screen + '-' + turn + '.png' });
        }
        say(sawFade > 0 && sawPortrait > 0, tag + ': ...seen: a cut-out fading, and the portrait', [sawFade, sawPortrait]);
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        await ctx.close();
        continue;
      }
      if (want === 'tb') {
        // THE WEATHER WITH TIME BEHIND (2026-10-31, the owner: back in the corner, as on Clock): there, with its
        // temperature, upper left -- and never over the time's figures
        const tb = await page.evaluate(() => {
          const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          // (phase 13: the layout's own face behind the subject, the weather a piece of the layout's)
          const sr = host && host.shadowRoot, t = sr && sr.querySelector('.lay .lybig'), w = sr && sr.querySelector('.lay .hksw.p-weather');
          const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
          const ink = (e) => { const g = []; const walk = (n) => { if (!n) return;
            if (n.nodeType === 3) { const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect(); if (r.width > 0 && n.textContent.trim()) g.push(r); } (
            n.shadowRoot ? [...n.shadowRoot.childNodes] : []).concat([...n.childNodes]).forEach(walk); }; walk(e);
            return g.length ? { l: Math.min(...g.map((r) => r.left)), r: Math.max(...g.map((r) => r.right)), t: Math.min(...g.map((r) => r.top)), b: Math.max(...g.map((r) => r.bottom)),
              text: (e.shadowRoot || e).textContent.replace(/\s+/g, ' ').trim().slice(0, 60) } : null; };
          const info = window.hkSaver.layoutInfo && window.hkSaver.layoutInfo(), pb = info && info.plan && info.plan.big;
          const g = pb ? [pb.x, pb.y, pb.w, pb.h] : null;
          return host ? { tb: host.hasAttribute('lay') && !!(t && t.querySelector('.face')) && !sr.querySelector('.ph .tb .tbt'), cut: !!sr.querySelector('.lay .lycut'), time: t ? box(t) : null,
            figures: g,
                          weather: w ? Object.assign(box(w), { ink: ink(w) }) : null, W: innerWidth } : null;
        });
        say(started && !!tb && tb.tb && !!tb.time && tb.cut, screen + ' ' + W + 'x' + H + ': Photos with the time on them: the layout\'s face, the subject\'s twin over it', tb);
        const wx = tb && tb.weather, ink = wx && wx.ink, g = tb && tb.figures;
        if (!/today/.test(screen)) say(!!wx && wx.h > 0 && !!ink && /\d°/.test(ink.text), screen + ' ' + W + 'x' + H + ': the weather is there, with its temperature', wx);
        // (in a corner: the upper left beside a time that leaves it room, else the plan's other end of its side -- phase 13)
        if (!/today/.test(screen)) say(!!ink && ink.l <= 0.15 * W && (ink.t <= 70 || ink.b >= H - 0.2 * H), screen + ' ' + W + 'x' + H + ': ...in a corner at the left', ink);
        if (!/today/.test(screen)) say(!!ink && !!g && (ink.b <= g[1] + 1 || ink.r <= g[0] + 1 || ink.t >= g[1] + g[3] - 1), screen + ' ' + W + 'x' + H + ': ...clear of the time\'s figures',
          [ink, g]);
        // (2026-11-02, the owner: "sometimes the clock is off center when set to behind faces" -- 0.1.113 drew the time in
        // the photo's layer, which zooms toward the photo's faces; the layout's face holds still where it is set, and
        // only the subject's twin zooms)
        const figs = await page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          const t = host && host.shadowRoot.querySelector('.lay .lybig .tm'); if (!t) return null; const q = [];
            const walk = (n) => { if (n.nodeType === 3) { if (n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
            if (r.width > 0) q.push(r); } return; } if (n.nodeType === 1) n.childNodes.forEach(walk); }; walk(t);
          return q.length ? { l: Math.min(...q.map((r) => r.left)), r: Math.max(...q.map((r) => r.right)), text: t.textContent.trim(), W: innerWidth } : null; });
        // (by the figures' letters: a face's box holds its other lines too)
        const tPlan = figs && g ? Math.abs((figs.l + figs.r) / 2 - (g[0] + g[2] / 2)) : null;
        say(tPlan !== null && tPlan <= 2, screen + ' ' + W + 'x' + H + ': the time centered where it is set', [figs, g]);
        if (/today/.test(screen)) {
          // (what the face shows changes after it was measured: wider figures, a much longer song -- put back on its Align)
          await page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
            const f = host.shadowRoot.querySelector('.lay .lybig .face'), t = f && f.querySelector('.tm'), s = f && f.querySelector('.np .t');
            if (t) t.textContent = '12:58'; if (s) s.textContent = 'You Shook Me All Night Long (Live at the Fictional Hall, the Long Version)';
            window.hkSaver._.layoutNow(); return true; });
          await page.waitForTimeout(800);
          const f2 = await page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
            const r = host.shadowRoot.querySelector('.lay .lybig .tm').getBoundingClientRect(); return { l: r.left, r: r.right }; });
          say(!!g && Math.abs((f2.l + f2.r) / 2 - (g[0] + g[2] / 2)) <= 2, screen + ' ' + W + 'x' + H + ': ...still centered once the face shows other figures and a longer song', [f2, g]);
        }
        await page.waitForTimeout(4000);
        const t2 = await page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          const t = host && host.shadowRoot.querySelector('.lay .lybig'), r = t && t.getBoundingClientRect(); return r ? { l: r.left, t: r.top, w: r.width } : null; });
        say(!!t2 && !!tb.time && Math.abs(t2.l - tb.time.l) <= 1 && Math.abs(t2.t - tb.time.t) <= 1 && Math.abs(t2.w - tb.time.w) <= 1,
            screen + ' ' + W + 'x' + H + ': ...and it holds still while the photo zooms', [tb.time, t2]);
        // THE TURN OF A MINUTE (2026-11-03, the owner: "when the time changes... it pops out in front of the face and then
        // the faces fades back over it"): wider figures, drawn again -- the person over them never drops out meanwhile
        const cutA = () => page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          return [...host.shadowRoot.querySelectorAll('.lay .lycut')].filter((t) => getComputedStyle(t).display !== 'none').map((t) => Number(getComputedStyle(t).opacity) *
            Number(getComputedStyle(t.querySelector('img')).opacity)); });
        const a0 = Math.max(0, ...(await cutA()));
        if (a0 > 0.95) {
          await page.evaluate(() => { const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
            const t = host.shadowRoot.querySelector('.lay .lybig .tm'); if (t) {
              const n = [...t.querySelectorAll('*')].concat([t]).find((e) => e.childNodes.length === 1 && e.firstChild.nodeType === 3 && /\d/.test(e.textContent)) || t; n.textContent = '12:58'; }
            window.hkSaver._.layoutNow(); return true; });
          let low = 1;
          for (let k = 0; k < 8; k++) { await page.waitForTimeout(100); low = Math.min(low, Math.max(0, ...(await cutA()))); }
          say(low > 0.9, screen + ' ' + W + 'x' + H + ': ...at the turn of a minute the person stays over the time', low);
        }
        say(!errors.length, screen + ' ' + W + 'x' + H + ': no page errors', errors.slice(0, 3));
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '.png' });
        // ...and in its Settings preview (the screen's Screensaver page)
        if (W > 600) {
          await page.evaluate(() => window.hkSaver && window.hkSaver.preview && window.hkSaver.preview(false));
          // (its preview column shows beside the page on a wide window)
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.goto(input.origin + '/settings#/screens/' + screen + '/screensaver');
          await settle(9000);
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
        await settle(800);
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
          return fr ? { src: fr.getAttribute('src'), same: fr.__mark === 1, doc: !!(w && w.__mark), on: !!(st && st.on && st.preview), bg: S && S.config() ? S.config().clock_bg : null, night: S &&
            S.config() ? S.config().clock_night : null,
                        views: w && w.document ? w.document.querySelectorAll('hk-grid-view,hk-home-grid-view').length : -1 } : null;
        });
        const until = async (f, ms) => { let v; for (let t = 0; t < ms; t += 25) { v = await frame(); if (v && f(v)) return v; await page.waitForTimeout(25); } return v; };
        await page.goto(input.origin + '/settings#/screens/' + screen + '/screensaver');
        const up = await until((v) => v.on, 20000);
        say(!!up && /[?&]hk_preview=saver\b/.test(up.src) && up.views === 0, screen + ': its Screensaver page previews the screensaver alone (no dashboard)', up);
        await page.evaluate(() => { const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          const fr = deep(document).find((e) => e.tagName === 'IFRAME'); fr.__mark = 1; fr.contentWindow.__mark = 1; });
        // (the page keeps what can't be laid out -- Night Mode here; the look is Edit Screensaver's since 2026-11-01)
        const btn = page.locator('[data-fk="saver:clock_night:always"]').first();
        await btn.scrollIntoViewIfNeeded(); await btn.click();
        const t0 = Date.now(), got = await until((v) => v.night === 'always', 3000), ms = Date.now() - t0;
        say(!!got && got.night === 'always' && ms < 1000, screen + ': ...a change shows there at once (' + ms + ' ms)', got);
        await page.waitForTimeout(2500);                // (the save comes back ~1.8 s in, after a still second)
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
            const p = n.parentElement, cs = getComputedStyle(p); let op = 1; for (let e = p; e && e.nodeType === 1; e = e.parentElement || (e.getRootNode && e.getRootNode().host)) op *= Number(
              getComputedStyle(e).opacity);
            if (r.width > 0 && op > 0.05) out.push({ t: n.textContent.trim().slice(0, 30), c: cs.color, l: r.left, r: r.right, top: r.top, b: r.bottom }); }
            (n.shadowRoot ? [...n.shadowRoot.childNodes] : []).concat([...(n.childNodes || [])]).forEach(walk); };
          walk(sr && (sr.querySelector('.lay') || sr.querySelector('.info')));
          const box = (sel) => { const e = sr && sr.querySelector(sel), r = e && e.getBoundingClientRect(); return r ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
          const now = sr && sr.querySelector('.info hk-screensaver-now-card'), nc = now && now.shadowRoot && now.shadowRoot.querySelector('.sscorner img,.sscorner .ph');
          const nr = nc && nc.getBoundingClientRect();
          const inks = [...(sr ? sr.querySelectorAll('.hkf.weather .rd > div > *') : [])].map(
            (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const r = e.tagName === 'svg' ? e.getBoundingClientRect() : rg.getBoundingClientRect(); return r.right; });
          // the Day face: its day's name and date (their figures), the corner's words, the art moving, the glyph's ink
          const tbx = (sel) => { const e = sr && sr.querySelector(sel); if (!e) return null; const rg = document.createRange(); rg.selectNodeContents(e); const r = rg.getBoundingClientRect();
            return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
          const wdb = tbx('.hkf.day .wd'), dnb = tbx('.hkf.day .dn');
          if (dnb) { const h = dnb.b - dnb.t; dnb.t += h * 0.2; dnb.b = dnb.t + h * 0.65; }
          const cw = []; const walk2 = (n) => { if (!n) return; if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n);
            const r = rg.getBoundingClientRect(); if (r.width > 0) cw.push(r); }
            (n.shadowRoot ? [...n.shadowRoot.childNodes] : []).concat([...(n.childNodes || [])]).forEach(walk2); };
          (sr ? [...sr.querySelectorAll('.lay .hksw.p-time, .lay .hksw.p-weather' + (innerWidth < 600 ? ', .lay .hksw.p-status' : ''))] : []).forEach(walk2);
          const corner = cw.length ? { l: Math.min(...cw.map((r) => r.left)), r: Math.max(...cw.map((r) => r.right)), t: Math.min(...cw.map((r) => r.top)), b: Math.max(...cw.map((r) => r.bottom)) } :
            null;
          const moving = sr ? [...sr.querySelectorAll('.hkf.day .art > *')].flatMap((e) => e.getAnimations()).filter((a) => a.playState === 'running').map((a) => a.animationName) : [];
          // bats only on an occasion that has them (Halloween); the season's leaves (or petals, snow) every day
          const flies = sr ? sr.querySelectorAll('.hkf.day .art .fly, .hkf.day .art .flutter').length : 0;
          const wxCard = sr && sr.querySelector('.lay .hksw.p-weather'), glyph = wxCard && wxCard.querySelector('svg');
          const facefoot = sr && sr.querySelector('.ck .hkf.day') ? sr.querySelector('.ck .hkf.day').getBoundingClientRect().bottom : null;
          return { wd: wdb, dn: dnb, corner, moving, flies, glyphInk: glyph ? getComputedStyle(glyph).fill || getComputedStyle(glyph).color : null, facefoot,
                   texts: out, tm: box('.hkf.weather .tm'), rd: box('.hkf.weather .rd'), np: nr ? { l: nr.left, t: nr.top, r: nr.right, b: nr.bottom } : null, rdRight: inks.length ?
                     Math.max(...inks) : null, W: innerWidth, light: host && host.hasAttribute('cklight') };
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
      if (want === 'look-slides' || want === 'look-fb') {
        const tag = screen + ' ' + W + 'x' + H;
        await settle(3000, { floor: 2400 });          // (2 of 70 runs took one more element ~2.1-2.3 s in)
        // what is on the screen now: the layout's pieces (shown, held, boxes), the big element's box, the slide corner's parts
        const look = () => page.evaluate(() => {
          const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          const host = deep(document).find((e) => e.tagName === 'HK-SCREENSAVER'), sr = host && host.shadowRoot;
          if (!sr) return null;
          const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
          const ink = (e) => { const q = []; const walk = (n) => { if (n.nodeType === 3) {
            if (n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect(); if (r.width > 0) q.push(r); } return; }
            if (n.nodeType !== 1 || n.tagName === 'STYLE') return; if (/^(svg|img)$/i.test(n.tagName)) { const r = n.getBoundingClientRect(); if (r.width > 0) q.push(r); return;
              } n.childNodes.forEach(walk); }; walk(e);
            return q.length ? { l: Math.min(...q.map((r) => r.left)), t: Math.min(...q.map((r) => r.top)), r: Math.max(...q.map((r) => r.right)), b: Math.max(...q.map((r) => r.bottom)) } : null; };
          const lay = sr.querySelector('.lay'), lo = lay ? Number(getComputedStyle(lay).opacity) : 0;
          const pieces = lay ? [...lay.querySelectorAll('.hksw')].filter((e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden').map(
            (e) => ({ id: (e.className.match(/\bp-(\S+)/) || [])[1] + '.' + (e.className.match(/\bk-(\S+)/) || [])[1], ink: ink(e) })).filter((p) => p.ink) : [];
          const info = window.hkSaver.layoutInfo && window.hkSaver.layoutInfo(), pb = info && info.plan && info.plan.big;
          const corner = {}; ['time', 'date', 'weather', 'status'].forEach((k) => { const e = sr.querySelector('.scn .hksw.p-' + k); corner[k] = e && getComputedStyle(e).display !== 'none' &&
            host.hasAttribute('scorner') ? ink(e) : null; });
          // (the slide's own words and small pictures: the forecast's, the Weather slide's, Home Energy's)
          const own = (sel) => [...sr.querySelectorAll(sel)].find((e) => !e.closest('.lay, .ck, .face, .hkf, .scn'));
          const layer = host.hasAttribute('enslide') ? own('.en') : host.hasAttribute('wxslide') ? own('.wx') : host.hasAttribute('hlslide') ? own('.hkhol') : host.hasAttribute('fcslide') ?
            own('.fc') : null;
          const marks = [];
          if (layer) (function walk(n) {
            if (n.nodeType === 3) { if (n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) marks.push(box(r)); } return; }
            if (n.nodeType !== 1 || n.tagName === 'STYLE') return;
            const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || (n !== layer && Number(cs.opacity) === 0)) return;
            if (/^(svg|img|canvas)$/i.test(n.tagName)) { const q = n.getBoundingClientRect(); if (q.width > 0 && q.width < innerWidth / 3 && q.height < innerHeight / 3) marks.push(box(q)); return; }
            if (n.shadowRoot) walk(n.shadowRoot); n.childNodes.forEach(walk);
          })(layer);
          const words = [...sr.querySelectorAll('.mu.top .mcol > *, .mu .mcol > *')].filter((n) => n.textContent.trim() && n.getBoundingClientRect().height > 0 &&
            Number(getComputedStyle(sr.querySelector('.mu')).opacity) > 0.5).map((n) => box(n.getBoundingClientRect()));
          const oldClock = [...sr.querySelectorAll('.info > hk-clock-card')].some((e) => getComputedStyle(e).display !== 'none' && Number(getComputedStyle(e).opacity) > 0.05);
          const fcb = sr.querySelector('.fc .hkf'), bigWx = !!(host.hasAttribute('fcbig') && fcb && fcb.getBoundingClientRect().width > 0);
          const fcWords = fcb ? [...fcb.querySelectorAll('*')].filter((e) => !e.children.length && e.textContent.trim() && e.getBoundingClientRect().width > 0).map(
            (e) => box(e.getBoundingClientRect())) : [];
          return { oldClock, bigWx, fcWords, marks, layerFound: !!layer, lay: host.hasAttribute('lay'), layShown: lo > 0.5 && !host.hasAttribute('lyoff'), off: host.hasAttribute('lyoff'),
            scorner: host.hasAttribute('scorner'), pieces, big: pb ? { l: pb.x, t: pb.y, r: pb.x + pb.w, b: pb.y + pb.h } : null, corner, words, W: innerWidth, H: innerHeight };
        });
        const inScr = (b) => !!b && b.l >= -1 && b.t >= -1 && b.r <= W + 1 && b.b <= H + 1;
        const meet = (a, b) => !!(a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1);
        const SHOWS_OF = { music: ['music'], forecast: ['weather'], forecast_big: ['weather', 'time'], weather: ['weather', 'readings'], energy: ['energy'], holiday: ['holiday'], timer: ['timer'] };
        const slides = want === 'look-fb' ? ['forecast'] : [null, 'music', 'forecast', 'weather', 'energy', 'holiday', 'timer'];
        for (const sl of slides) {
          // (the Holiday slide, phase 20: a pinned day, so a holiday is near whatever the real date -- November 8, 2026,
          // Thanksgiving 18 days away in its painted dining room; the clock's timers keep running)
          if (sl === 'holiday') await page.clock.setFixedTime(new Date(2026, 10, 8, 12, 0, 0));
          const shown = await page.evaluate((sl) => window.hkSaver.previewSlide ? window.hkSaver.previewSlide(sl) : false, sl);
          await settle(sl ? 2600 : 600);
          const m = await look();
          const t2 = tag + (sl ? ' under ' + (want === 'look-fb' ? 'forecast, big' : sl) : '');
          if (!m) { say(false, t2 + ': the screensaver is up', m); continue; }
          if (!sl) {
            // THE LOOK ITSELF: every piece on the screen, none on the big element, none on another (the owner: "Things need to
            // line up correctly and look well placed")
            say(m.lay && m.layShown, t2 + ': the Look draws through its layout', [m.lay, m.layShown]);
            say(m.pieces.every((p) => inScr(p.ink)), t2 + ': ...every piece inside the screen', m.pieces.filter((p) => !inScr(p.ink)));
            say(!m.big || m.pieces.every((p) => !meet(p.ink, m.big)), t2 + ': ...none on the big element', [m.pieces.filter((p) => meet(p.ink, m.big)).map((p) => [p.id, p.ink]), m.big]);
            let clash = null;
            for (let i = 0; i < m.pieces.length; i++) for (let j = i + 1; j < m.pieces.length; j++) if (meet(m.pieces[i].ink, m.pieces[j].ink)) clash = [m.pieces[i].id, m.pieces[i].ink,
              m.pieces[j].id, m.pieces[j].ink];
            say(!clash, t2 + ': ...none on another', clash);
            if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '.png' });
            continue;
          }
          // A SLIDE: the layout steps aside; the slide corner adds what the slide lacks, nothing it has
          if (!shown) {
            const background = sl === 'forecast' && await page.evaluate(() => hkSaver.forecast());
            say(true, t2 + (background ? ': forecast is already the background' : ': (not shown here: ' + sl + ' has nothing to show in this house)'), shown);
            if (background) say((await page.evaluate(() => hkSaver.previewStatus())).message.includes('already the background'), t2 + ': the preview explains its existing forecast background');
            continue;
          }
          const key = want === 'look-fb' ? 'forecast_big' : sl;
          const own = /-own$/.test(screen), want4 = ['time', 'date', 'weather', 'status'].filter((k) => SHOWS_OF[key].indexOf(k) < 0 && !(own && k === 'weather'));
          say(m.scorner && !m.layShown, t2 + ': the layout steps aside, the slide corner is up', [m.scorner, m.layShown]);
          say(['time', 'date', 'weather', 'status'].every((k) => !!m.corner[k] === (want4.indexOf(k) >= 0)), t2 + ': ...its corner adds ' + want4.join(', ') + ' and nothing else',
              Object.keys(m.corner).filter((k) => m.corner[k]));
          say(want4.every((k) => !m.corner[k] || inScr(m.corner[k])), t2 + ': ...inside the screen', m.corner);
          // (2026-11-02: the old corner clock came back over the forecast's corner on a clock; Big drew the Classic forecast)
          say(!m.oldClock, t2 + ': ...and no old corner clock beside it', m.oldClock);
          // (2026-11-03, the owner: "Sometimes the Widgets... overlap or collide with the Slides")
          if (sl !== 'music') say(m.layerFound && !want4.some((k) => m.marks.some((w) => meet(m.corner[k], w))), t2 + ': ...none of the corner on the slide\u2019s own words',
              [m.layerFound, want4.filter((k) => m.marks.some((w) => meet(m.corner[k], w))).map((k) => [k, m.corner[k], m.marks.filter((w) => meet(m.corner[k], w)).slice(0, 2)])]);
          if (want === 'look-fb') say(m.bigWx, t2 + ': ...Big Weather is drawn', m.bigWx);
          if (want === 'look-fb') say(!want4.some((k) => m.fcWords.some((w) => meet(m.corner[k], w))), t2 + ': ...none of the corner on its words',
            [m.corner, m.fcWords.filter((w) => want4.some((k) => meet(m.corner[k], w)))]);
          if (own && m.corner.time) {
            // (the corner's time at 200 %: its letters twice the date's height and more)
            const th = m.corner.time.b - m.corner.time.t, dh = m.corner.date ? m.corner.date.b - m.corner.date.t : 0;
            say(dh > 0 && th > 3.5 * dh, t2 + ': ...its time at its own size, 200 %', [th, dh]);
          }
          if (own && sl === 'music') {
            const mp = await page.evaluate(() => { const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
              const sr = deep(document).find((e) => e.tagName === 'HK-SCREENSAVER').shadowRoot,
                shown = (s) => { const e = sr.querySelector('.mu ' + s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
              return { album: shown('.malbum'), vol: shown('.mvol'), next: shown('.mnext'), title: shown('.mtitle'), prog: shown('.mprog'), btn: shown('.mpp') }; });
            say(!mp.album && !mp.vol && !mp.next && mp.title && mp.prog && mp.btn, t2 + ': ...Music Full Screen without its album, volume and Up Next', mp);
          }
          if (sl === 'music') say(!want4.some((k) => m.words.some((w) => meet(m.corner[k], w))), t2 + ': ...none of it on the song\u2019s words', [m.corner, m.words]);
          if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '-' + (want === 'look-fb' ? 'forecast-big' : sl) + '.png' });
        }
        await page.evaluate(() => window.hkSaver.previewSlide && window.hkSaver.previewSlide(null));
        // THE LAST MINUTE, FOR REAL (phase 21): out of the preview, a timer running in the house's states holds the Timer slide
        // up, a House Timer doesn't, and it lets go once the timer has ended. Once per run: the rules are test_timerlist's.
        if (!lastMinuteDone && want !== 'look-fb') {
          lastMinuteDone = true;
          const stateOf = async () => page.evaluate(() => { const s = window.hkSaver.stats(); return { slide: s.timerSlide, held: s.timerHeld, extra: s.extra }; });
          const setTimer = (id, left) => page.evaluate(([id, left]) => { const st = window.hkCards.client().states;
            if (left === null) st[id] = { entity_id: id, state: 'idle', attributes: { duration: '0:15:00' } };
            else st[id] = { entity_id: id, state: 'active', attributes: { finishes_at: new Date(Date.now() + left * 1000).toISOString(), duration: '0:15:00', friendly_name: 'Pasta' } };
              window.hkSaver._.timer.watch(); }, [id, left]);
          await page.evaluate(() => { window.hkSaver.preview(false); window.hkSaver.force(true); window.hkSaver.start(); });
          await settle(1500);
          await setTimer('timer.nap_timer', 40);
          await settle(1500);
          say(!(await stateOf()).slide, tag + ': another of the house\'s timers in its last minute: nothing', await stateOf());
          await setTimer('timer.quick_1', 45);
          await settle(1500); await page.evaluate(() => window.hkSaver._.timer.watch()); await settle(2600);
          const up = await stateOf();
          say(up.slide && up.held && up.extra === 'timer', tag + ': a timer in its last minute holds the Timer slide up', up);
          await setTimer('timer.quick_1', null);
          await settle(1500); await page.evaluate(() => window.hkSaver._.timer.watch()); await settle(800);
          const down = await stateOf();
          say(!down.slide && !down.held, tag + ': ...and lets go once it has ended', down);
          await page.evaluate(() => { delete window.hkCards.client().states['timer.nap_timer']; window.hkSaver.stop && window.hkSaver.stop('test'); window.hkSaver.force(false);
            window.hkSaver.preview(true); });
          await settle(800);
        }
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        await ctx.close();
        continue;
      }
      if (/^lay-/.test(want)) {
        const tag = screen + ' ' + W + 'x' + H;
        // (Planted needs the sky it stands under: pinned, the screensaver started again under it)
        if (want === 'lay-planted') {
          await page.evaluate(() => { window.hkSaver.preview(false); window.hkSky._pin(
            { season: '', land: 'fall', wet: { kind: 'none', rate: 0 }, fog: false, wind: 4, moon: 0.4, elev: 30, azim: 182, cond: 'sunny', cover: 0.1 }); });
          await settle(800);
          await page.evaluate(() => window.hkSaver.preview(true));
          await settle(7000);
        } else await settle(3000, { quiet: 600 });    // (still at ~0.6 s; never a change after, 56 of 56)
        if (want === 'lay-slides') {
          // UNDER THE MUSIC: the layout steps aside -- the time, the date and the weather at the top left, Home Status at the top
          // right, none on the slide's words -- and once the slide has gone the layout's places again
          const corners = () => page.evaluate(() => {
            const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
            const host = deep(document).find((e) => e.tagName === 'HK-SCREENSAVER'), sr = host && host.shadowRoot;
            if (!sr) return null;
            const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
            const card = (sel) => {
              const c = sr.querySelector('.info > ' + sel);
              if (!c || c.hasAttribute('lyhide') || getComputedStyle(c).display === 'none' || Number(getComputedStyle(c).opacity) < 0.99) return null;
              // (what it draws: its words and pictures, never its boxes -- the clock's is as wide as the old corner, 600 px)
              const q = [], walk = (n) => {
                if (n.nodeType === 3) { if (n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); q.push(rg.getBoundingClientRect()); } return; }
                if ((n.nodeType !== 1 && n.nodeType !== 11) || n.tagName === 'STYLE') return;
                if (/^(svg|canvas|img)$/i.test(n.tagName || '')) { q.push(n.getBoundingClientRect()); return; }
                // (its own tree and what it slots: the clock draws in an hk-plate, its words slotted in)
                if (n.shadowRoot) n.shadowRoot.childNodes.forEach(walk);
                n.childNodes.forEach(walk);
              };
              walk(c);
              const k = q.filter((r) => r.width > 0 && r.height > 0);
              return k.length ? { l: Math.min(...k.map((r) => r.left)), t: Math.min(...k.map((r) => r.top)), r: Math.max(...k.map((r) => r.right)), b: Math.max(...k.map((r) => r.bottom)) } : null;
            };
            const words = [...sr.querySelectorAll('.mu .mcol > *')].filter((n) => n.textContent.trim() && n.getBoundingClientRect().height > 0).map((n) => box(n.getBoundingClientRect()));
            // (the layout's own pieces: the corner cards are pieces now, phase 13)
            const piece = (p) => { const e = [...sr.querySelectorAll('.lay .hksw.k-card.p-' + p)].find((x) => getComputedStyle(x).display !== 'none'); return e &&
              Number(getComputedStyle(sr.querySelector('.lay')).opacity) > 0.99 ? box(e.getBoundingClientRect()) : null; };
            // THE SLIDE CORNER (phase 13, phase 2): the pieces over the slide, each only where the slide lacks it
            const sc = (p) => { const e = sr.querySelector('.scn .hksw.p-' + p); if (!e || getComputedStyle(e).display === 'none' || !host.hasAttribute('scorner')) return null;
              const q = [...e.querySelectorAll('*')].filter((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())).map(
                (n) => { const rg = document.createRange(); rg.selectNodeContents(n); return rg.getBoundingClientRect(); }).filter((r) => r.width > 0);
              return q.length ? { l: Math.min(...q.map((r) => r.left)), t: Math.min(...q.map((r) => r.top)), r: Math.max(...q.map((r) => r.right)), b: Math.max(...q.map((r) => r.bottom)) } : null; };
            const oldShown = [...sr.querySelectorAll('.info > *')].filter((c) => !c.hasAttribute('muonly') && Number(getComputedStyle(c).opacity) > 0.01 && getComputedStyle(c).display !== 'none').map(
              (c) => c.tagName.toLowerCase());
            return { off: host.hasAttribute('lyoff'), mu: host.hasAttribute('muslide'), W: innerWidth, H: innerHeight, words, pw: piece('weather'), ps: piece('status'),
                     st: sc('time'), sd: sc('date'), sw: sc('weather'), ss: sc('status'), oldShown,
                     // BEHIND WITH ANY FACE (phase 3): the layout's own face, the subject's twin over it, never Time Behind's figures
                     face: !!sr.querySelector('.lay .lybig .face'), tbt: [...sr.querySelectorAll('.ph .tb .tbt')].filter((e) => e.getBoundingClientRect().width > 0).length,
                     cuts: [...sr.querySelectorAll('.lay .lycut')].map((e) => ({ shown: getComputedStyle(e).display !== 'none', src: !!(e.firstChild && e.firstChild.getAttribute('src')),
                       mask: /url/.test((e.firstChild && (e.firstChild.style.maskImage || e.firstChild.style.webkitMaskImage)) || ''),
                         after: !!(e.previousElementSibling && e.previousElementSibling.classList.contains('lybig')) })),
                     clock: card('hk-clock-card'), weather: card('hk-weather-strip-card'), status: card('hk-screensaver-status-card') };
          });
          const meet = (a, b) => !!(a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1);
          await page.evaluate(() => window.hkSaver._.music.show(true));
          await settle(3600);
          const u = await corners();
          if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '-music.png' });
          say(started && !!u && u.mu && u.off, tag + ': the music slide over a layout: the layout steps aside', u && [u.mu, u.off]);
          if (u) {
            say(!!u.st && u.st.l < u.W * 0.25 && u.st.b < u.H / 2, tag + ': ...the slide corner tells the time, at the top left', u.st);
            say(!!u.sd && !!u.st && u.sd.t >= u.st.b - 1, tag + ': ...the date under it', [u.sd, u.st]);
            const ink = await require('./corner_look.cjs')(page, 'hk-screensaver .scn .tl', input.python), xs=ink.map(r=>r.left);
            say(xs.length === 3 && xs.every(x=>x!==null) && Math.max(...xs)-Math.min(...xs)<=(ink.some(r=>parseFloat(r.font)<14)?2:1), tag + ': ...time, date and weather ink share one left edge',
              ink);
            say(!!u.sw && !!u.sd && u.sw.t >= u.sd.b - 1, tag + ': ...the weather under that (the music slide has none of its own)', [u.sw, u.sd]);
            say(!!u.ss && u.ss.r > u.W * 0.75 && u.ss.b < u.H / 2, tag + ': ...House Status at the top right', u.ss);
            say(!!u.st && !!u.ss && Math.abs(u.st.t - u.ss.t) < (u.st.b - u.st.t), tag + ': ...the two corners\' first words level with each other', [u.st, u.ss]);
            say(u.oldShown.length === 0, tag + ': ...and none of the old corner cards', u.oldShown);
            // (at a tablet: on a phone the slide and the corners were never drawn for each other, with a layout or without)
            // (every size now, phones too: the slide is laid out under the corner -- phase 13)
            const hit = [u.st, u.sd, u.sw, u.ss].find((c) => u.words.some((w) => meet(c, w)));
            say(u.words.length > 0 && !hit, tag + ': ...none on the slide\u2019s words', [hit, u.words]);
          }
          // THE MUSIC'S BUTTONS ACT AND LEAVE IT UP (2026-11-02, the owner: "when touching the buttons on the Music Slide... skip,
          // browse, speaker... it kills the screensaver and goes back to the dashboard"): a finger on Next, Speakers (the speaker
          // line over the title since the owner's mockup 12h, 2026-11-09), Browse and Up Next
          for (const act of ['next', 'spk', 'brw', 'queue']) {
            const at = await page.evaluate((act) => {
              const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
              const b = deep(document).find((e) => e.classList && (e.classList.contains('mbtn') || e.classList.contains('hksl')) && e.getAttribute('data-act') === act && e.closest('.mu .mcol') &&
                e.getBoundingClientRect().width > 0);
              if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }, act);
            if (!at) { say(false, tag + ': ...the music slide has its ' + act + ' button', null); continue; }
            await page.touchscreen.tap(at.x, at.y);
            await settle(900);
            const still = await page.evaluate(() => window.hkSaver.running() && document.querySelector('hk-screensaver') !== null);
            say(still, tag + ': ...a finger on the music\u2019s ' + act + ' button leaves the screensaver up', still);
            // (a panel it opened: closed by a tap beside it, which is never a wake)
            await page.evaluate(() => { try { window.hkSaver._.music.panel(null); } catch (e) { /* none */ } });
            await settle(300);
          }
          await page.evaluate(() => window.hkSaver._.music.hide());
          await settle(3600);
          const a = await corners();
          say(!!a && !a.mu && !a.off && !a.clock, tag + ': after it the layout again: no corner clock (Time Behind tells it)', a && [a.mu, a.off, a.clock]);
          say(!!a && a.face && a.tbt === 0, tag + ': ...behind the photo\'s subject, the layout\'s own face (never Time Behind\'s figures)', a && [a.face, a.tbt]);
          say(!!a && !!a.pw && !!a.ps && a.pw.t > a.H / 2 && a.pw.l < a.W * 0.2 && a.ps.t > a.H / 2 && a.ps.r > a.W * 0.8 && !a.weather && !a.status,
              tag + ': ...the weather at the bottom left, Home Status at the bottom right, where it put them (pieces, the old cards hidden)', a && [a.pw, a.ps, a.weather, a.status]);
          say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
          if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '.png' });
          await ctx.close();
          continue;
        }
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
            const walk = (n) => { if (n.nodeType === 3) { if (n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); q.push(rg.getBoundingClientRect());
              words.push(n.textContent.trim()); } return; }
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
          const cards = sr ? [...sr.querySelectorAll('.info > *')].map((c) => ({ tag: c.tagName.toLowerCase().replace(/^hk-|-card$/g, ''), hide: c.hasAttribute('lyhide'),
            box: c.hasAttribute('lyhide') ? null : inner(c) })) : [];
          const lybig = lay && lay.querySelector('.lybig'), tbt = sr.querySelector('.ph .tb .tbt');
          // (the screen's one ink: what each piece's words are drawn in, and the layer's own opacity)
          const inkOfPiece = (e) => { const t = [...e.querySelectorAll('*')].find((n) => n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())); const cs = t ?
            getComputedStyle(t) : null; return cs ? [cs.color, cs.opacity, getComputedStyle(e).opacity] : null; };
          const cuts = lay ? [...lay.querySelectorAll('.lycut')].map((e) => ({ shown: getComputedStyle(e).display !== 'none', src: !!(e.firstChild && e.firstChild.getAttribute('src')),
            after: !!(e.previousElementSibling && e.previousElementSibling.classList.contains('lybig')) })) : [];
          const phs = [...sr.querySelectorAll('.ph')].map((l) => !!l.__ph);
          const tbt2 = [...sr.querySelectorAll('.ph .tb .tbt')].filter((e) => e.getBoundingClientRect().width > 0).length;
          const ws = lay ? [...lay.querySelectorAll('.hksw')].map((e) => ({ ink: inkOfPiece(e), layInk: lay.getAttribute('data-ink'), id: (e.className.match(/\bw-(\S+)/) || [])[1],
            piece: (e.className.match(/\bp-(\S+)/) || [])[1], shape: (e.className.match(/\bk-(\S+)/) || [])[1], cls: e.className, box: rect(e), shown: getComputedStyle(e).display !== 'none',
            held: getComputedStyle(e).visibility === 'hidden' })) : [];
          // (the box the plan gave the big element: what the widgets and cards are placed around, in this page's px)
          const info = window.hkSaver.layoutInfo && window.hkSaver.layoutInfo(), pb = info && info.plan && info.plan.big;
          const land = lay && lay.querySelector('.lyland'), lst = land && getComputedStyle(land);
          return { lay: host.hasAttribute('lay'), plan: pb ? { l: pb.x, t: pb.y, r: pb.x + pb.w, b: pb.y + pb.h } : null, prow: info && info.plan ? info.plan.row : null, pm: info && info.plan ?
            info.plan.m : null, tb: host.hasAttribute('tb'), W: innerWidth, H: innerHeight, hasLay: !!lay,
                   big: lybig ? Object.assign({ box: rect(lybig), spans: lybig.querySelectorAll('span').length,
                     days: [...lybig.querySelectorAll('span')].filter((e) => /^\d{1,2}$/.test(e.textContent.trim())).length,
                                  figures: lybig.querySelectorAll('.pl .pd .b').length, faces: lybig.querySelectorAll('.face').length },
                                  lybig.classList.contains('planted') ? { ink: union([...lybig.querySelectorAll('.pd .b')].map((e) => e.getBoundingClientRect())), text: lybig.querySelector('.pd .b') ?
                                    'planted' : '' } : drawn(lybig)) : null,
                   tbt: tbt ? rect(tbt) : null,
                   land: land ? { box: rect(land), img: lst.backgroundImage, after: !!(lybig && lybig.compareDocumentPosition(land) & 4) } : null,
                   ck: { n: sr.querySelectorAll('.ck').length, own: [...sr.querySelectorAll('.ck .face')].filter((f) => !f.closest('.lay') && f.getBoundingClientRect().width > 0 &&
                     getComputedStyle(f).visibility !== 'hidden' && getComputedStyle(f).display !== 'none').length },
                   ws, cards, cuts, phs, tbt2, face: !!(lay && lay.querySelector('.lybig .face')) };
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
          // (the timer's piece collapses while no timer runs, on the tablet: rule 4 of docs/phase13/SCREENSAVER-UNIFIED.md)
          const row = m.ws.filter((w) => w.shown && /^(circular|rectangular)$/.test(w.shape));
          say(row.length >= 3 && ['weather', 'readings', 'status'].every((p) => row.some((w) => w.piece === p)) && row.every((w) => inScreen(w.box)),
              tag + ': ...the row\'s pieces (the weather, a reading, the locks), all inside the screen', row.map((w) => [w.piece, w.box]));
          const lines = [...new Set(row.map((w) => Math.round((w.box.t + w.box.b) / 2)))];
          say(lines.length === 1, tag + ': ...on one center line', row.map((w) => [w.piece, w.box.t, w.box.b]));
          const gaps = row.slice().sort((a, b) => a.box.l - b.box.l).slice(1).map((w, i, a) => Math.round(w.box.l - (i ? a[i - 1] : row.slice().sort((x, y) => x.box.l - y.box.l)[0]).box.r));
          say(gaps.every((g) => Math.abs(g - gaps[0]) <= 1), tag + ': ...with equal gaps between them', gaps);
          const date = m.ws.find((w) => w.piece === 'date');
          say(!!date && !!big && date.box.b <= big.t + 1, tag + ': ...the date above the big time', date && [date.box, big]);
          say(row.length > 0 && !!big && row.every((w) => w.box.t >= big.b - 1), tag + ': ...the row below it', [row.map((w) => w.box.t), big]);
        } else if (want === 'lay-wall') {
          say(bigOk, tag + ': ...the big time is drawn, with a box', m.big);
          // (a new screen has no photos: Photos falls back to the forecast, and Behind has nothing to be behind -- the time stands in front)
          say(!m.tb && !m.tbt && !!m.big && m.big.faces > 0, tag + ': ...with no photos the time stands in front, as a face of its own', [m.tb, m.tbt, m.big && m.big.faces]);
          // (the corner cards are the pieces' Card shape now; Now Playing and Timers collapse while nothing plays or runs)
          const shown = m.ws.filter((w) => w.shown && w.shape === 'card').map((w) => ({ tag: w.piece, box: w.box }));
          const inks = m.ws.filter((w) => w.shown && w.ink).map((w) => [w.piece, w.shape, w.ink, w.layInk]);
          say(inks.every((x) => x[3] === 'white' && /^rgb\(255, 255, 255\)$/.test(x[2][0])), tag + ': ...every piece\'s words in the screen\'s one ink (white here)', inks);
          say(shown.some((c) => c.tag === 'weather') && shown.some((c) => c.tag === 'status') && m.cards.every((c) => c.hide),
              tag + ': ...the corner cards are pieces (the weather and Home Status drawn; the old cards hidden)', [shown, m.cards.map((c) => [c.tag, c.hide])]);
          const pad = 2 * Math.min(W, H) / 100;
          const left = shown.filter((c) => c.box.l < W / 2), right = shown.filter((c) => c.box.l >= W / 2);
          say(left.every((c) => Math.abs(c.box.l - left[0].box.l) <= 1) && right.every((c) => Math.abs(c.box.r - right[0].box.r) <= 1),
              tag + ': ...each side\'s cards on one edge', shown);
          say(left.concat(right).every((c) => c.box.l >= pad && W - c.box.r >= pad), tag + ': ...the margin kept at each side', [shown, pad]);
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
          // (...where the land leaves enough of the time to read: past 35 % of its box it stands in front -- phase 3)
          const share = await page.evaluate(() => (window.hkSaver.layoutInfo() || {}).landShare);
          if (typeof share === 'number' && share > 0.35) say(!m.land, tag + ': ...the land would hide the time (' + Math.round(share * 100) + '%): the time stands in front', m.land);
          else say(!!m.land && /land-[a-z0-9-]+\.webp/.test(m.land.img) && m.land.after, tag + ': ...the land drawn again over the time', [m.land, share]);
          if (m.land) say(!!m.land && !!big && m.land.box.r - m.land.box.l <= big.r - big.l + 12 && m.land.box.b - m.land.box.t <= big.b - big.t + 12,
              tag + ': ...in a box the time\'s size', m.land && [m.land.box, big]);
        } else if (want === 'lay-tb') {
          say(m.phs.some(Boolean), tag + ': ...a photo is up', m.phs);
          say(m.face && m.tbt2 === 0, tag + ': ...the layout\'s own face (Neon), never Time Behind\'s figures', [m.face, m.tbt2]);
          say(m.cuts.length > 0 && m.cuts.every((c) => c.after) && m.cuts.some((c) => c.src), tag + ': ...the subject\'s twin right over the face, with the photo', m.cuts);
        } else if (want === 'lay-pieces') {
          // EVERY PIECE DRAWN WELL PLACED (the plan's rule 7; the owner: "Things need to line up correctly and look well placed"):
          // each piece that shows is on the screen, off the big time and off every other piece
          // (a "shows when..." piece with nothing to show holds its place, unseen, in the editor's preview: not counted)
          const shown = m.ws.filter((w) => w.shown && !w.held && w.box && w.box.r - w.box.l > 0 && !/\bk-band\b/.test(w.cls));
          say(shown.length >= 4, tag + ': ...the glance pieces are drawn', shown.map((w) => w.piece + '.' + w.shape));
          say(shown.every((w) => inScreen(w.box)), tag + ': ...every one inside the screen', shown.filter((w) => !inScreen(w.box)).map((w) => [w.piece, w.box]));
          say(shown.every((w) => !meet(w.box, big)), tag + ': ...none on the big time', shown.filter((w) => meet(w.box, big)).map((w) => [w.piece, w.box, big]));
          let clash = null;
          for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) if (meet(shown[i].box, shown[j].box)) clash = [shown[i].piece, shown[i].box, shown[j].piece, shown[j].box];
          say(!clash, tag + ': ...none on another', clash);
          const empty = shown.filter((w) => w.ink === null && w.shape !== 'circular');
          say(empty.length === 0, tag + ': ...each with words in it', empty.map((w) => w.piece + '.' + w.shape));
        } else if (want === 'lay-month') {
          const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          const days = m.big ? m.big.text : '';
          say(!!m.big && names.some((n) => days.includes(n)), tag + ': ...the big element has the month\'s name', m.big && m.big.text.slice(0, 40));
          say(!!m.big && m.big.days >= 28 && m.big.days <= 31, tag + ': ...and its 28-31 days', m.big && m.big.days);
          const cw = m.ws.find((w) => w.shown && w.piece === 'time' && w.shape === 'card'), clock = cw ? { tag: 'time', box: cw.box } : null;
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
          await page.evaluate((sky) => { window.hkSaver.preview(false); window.hkSky._pin(
            Object.assign({ season: '', land: 'fall', wet: { kind: 'none', rate: 0 }, fog: false, wind: 4, moon: 0.4 }, sky)); }, sky);
          await settle(800);
          await page.evaluate(() => window.hkSaver.preview(true));
          await settle(7000);
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
            const seen = (e) => { for (let n = e; n && n !== face; n = n.parentElement) { const c = getComputedStyle(n);
              if (c.visibility !== 'visible' || c.display === 'none' || +c.opacity < 0.9) return false; } return true; };
            return { planted: face.classList.contains('planted'), faceSeen: !!t && seen(t) && /gradient/.test(getComputedStyle(t).backgroundImage),
              old: getComputedStyle(face.querySelector('.tp')).display, text: t && t.textContent,
                     boxes: Math.max(...[...face.querySelectorAll('.pl .b')].map((e) => e.offsetHeight)) / g.fs, base: base, ground: g.yG, cast: face.querySelectorAll('.pl .ps .b').length,
                       contact: face.querySelectorAll('.pl .pc .b').length,
                     grass: box(face.querySelector('.pl canvas.pg')), figures: box(t), rd: box(face.querySelector('.rd')), np: box(np) };
          });
        };
        const day = await under({ elev: 30, azim: 182, cond: 'sunny', cover: 0.1 });
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-' + W + 'x' + H + '-day.png' });
        say(started && !!day && day.planted && day.old === 'none' && /^\d{1,2}:\d\d$/.test(day.text || ''), tag + ': Big Weather\'s time planted in the meadow, the old one gone', day &&
          [day.planted, day.old, day.text]);
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
        say(!!night && night.planted && night.cast === 2 && night.contact === 3, tag + ': at night, no sun\'s shadow (the sky\'s faint one and the feet\'s only)', night &&
          [night.cast, night.contact]);
        await page.evaluate(() => window.hkSky._pin(null));
        say(!errors.length, tag + ': no page errors', errors.slice(0, 3));
        await ctx.close();
        continue;
      }
      if (want === 'clock-tb' || want === 'clock-soft') {
        const sharp = want === 'clock-tb';
        const tb = await page.evaluate(() => {
          const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.ph,.info'));
          // (phase 13: the layout's face; the subject's twin over it on sharp photos, none on soft ones)
          return host ? { ckmode: host.hasAttribute('ckmode'), face: !!host.shadowRoot.querySelector('.lay .lybig .face'), cut: [...host.shadowRoot.querySelectorAll('.lay .lycut')].length > 0 } :
            null;
        });
        say(started && !!tb && tb.ckmode && tb.face && tb.cut === sharp,
            screen + (sharp ? ': Clock on sharp photos with Time Behind saved on draws it' : ': Clock on Soft photos with Time Behind saved on: the clock, no time on the photos'), tb);
        if (sharp) {
          // ...as bright as on Photos (2026-10-31, the owner: "the clock is dim"): the layout's face over the photos' dark wash
          const lift = await page.evaluate(() => {
            const host = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.querySelector('.lay'));
            const lay = host && host.shadowRoot.querySelector('.lay'), ph = host && host.shadowRoot.querySelector('.ph');
            return lay ? { lay: Number(getComputedStyle(lay).zIndex) || 0, wash: ph ? Number(getComputedStyle(ph, '::after').zIndex) || 0 : 0, op: getComputedStyle(lay).opacity } : null;
          });
          say(!!lift && lift.lay > lift.wash && lift.op === '1', screen + ': the time over the photos\' dark wash, at full strength', lift);
          if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '.png' });
        }
        await page.evaluate(() => window.hkSaver && window.hkSaver.preview && window.hkSaver.preview(false));
        await page.goto(input.origin + '/settings#/screens/' + screen + '/screensaver');
        await settle(5000);
        const rows = await page.evaluate(() => {
          const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          return deep(document).filter((e) => !e.children.length && /^(Time Behind|Titles)$/.test((e.textContent || '').trim())).map((e) => e.textContent.trim());
        });
        // (Time Behind and Titles are Edit Screensaver's since 2026-11-01 -- the big time Behind the Subject, the Photo
        // Title widget: the page keeps what can't be laid out)
        say(!rows.includes('Time Behind') && !rows.includes('Titles'), screen + ': its Screensaver page offers neither Time Behind nor Titles (the editor does)', rows);
        say(!errors.length, screen + ': no page errors', errors.slice(0, 3));
        if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '-settings.png', fullPage: true });
        await ctx.close();
        continue;
      }
      const ok = !!got && (want === 'big' ? got.big : want ? got.face === want : !got.face && !got.big);
      say(started && ok, screen + ': the screensaver draws ' + (want || 'the classic forecast'), got);
      // ONE RENDERER (phase 13, phase 4): a screen with no layout saved draws through the layout its options make -- but Big
      // Weather (the owner's favorite) and Month (its own time where the corner's Home Status would stand) keep their own face
      if (want === 'big' || want === 'month') say(!!got && !got.lay, screen + ': ...' + (want === 'big' ? 'Big Weather' : 'Month') + ' keeps its own face, no layout drawn', got);
      else say(!!got && got.lay, screen + ': ...with no layout saved, drawn through the layout its options make (one renderer)', got);
      say(!errors.length, screen + ': no page errors', errors.slice(0, 3));
      if (input.shots) await page.screenshot({ path: input.shots + '/' + screen + '.png' });
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails ? 'FAIL: ' + fails : 'saver shows: all checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
