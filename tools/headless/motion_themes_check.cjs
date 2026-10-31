// motion_themes_check.py's browser half: each theme screen's Home in WebKit at each size -- its layers there and
// moving, by transform and opacity alone, at the page's frame rate -- the still frame (Animations Off, Reduce Motion),
// HK Settings' picker and Color, and the Clock screensaver over a wallpaper. Prints PASS / FAIL lines.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));

// the sky's wallpaper layer on show, its theme's layers and how they move (over 1.5 s)
async function sky(page, wait) {
  return page.evaluate(async (ms) => {
    const S = window.hkSky && window.hkSky.element && window.hkSky.element(), wall = S && S.querySelector('.wall.on');
    if (!wall) return null;
    // (a meteor stands unseen most of its cycle: its animation's own time moving counts too)
    const kids = [...wall.children], t0 = kids.map((k) => getComputedStyle(k).transform + '|' + getComputedStyle(k).opacity);
    const c0 = kids.flatMap((k) => k.getAnimations()).map((a) => [a, a.playState === 'running' ? a.currentTime : null]);
    let frames = 0; const start = performance.now();
    await new Promise((res) => { const tick = () => { frames++; if (performance.now() - start < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    const t1 = kids.map((k) => getComputedStyle(k).transform + '|' + getComputedStyle(k).opacity);
    const anims = kids.flatMap((k) => k.getAnimations()).filter((a) => a.playState === 'running');
    return { th: wall.classList.contains('th'), wm: S.getAttribute('data-wm'), wall: S.style.getPropertyValue('--wall'), layers: kids.length,
             moved: t1.some((t, i) => t !== t0[i]) || (kids.some((k) => k.className === 'meteor') && c0.some((x) => x[1] != null && x[0].currentTime > x[1])), running: anims.length, fps: Math.round(frames / (ms / 1000)),
             props: [...new Set(anims.flatMap((a) => a.effect.getKeyframes().flatMap((f) => Object.keys(f).filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)))))],
             filters: kids.filter((k) => getComputedStyle(k).filter !== 'none').length, sk3: S.style.getPropertyValue('--sk3') };
  }, wait || 1500);
}

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok ? '' : '  got ' + JSON.stringify(got))); };
  try {
    for (const size of input.sizes) {
      const [width, height] = size.split('x').map(Number);
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, deviceScaleFactor: 1 });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => { if (!/^ResizeObserver loop/.test(e.message)) errors.push(e.message); });
      const go = async (path) => {
        await page.goto(input.origin + path);
        await page.waitForFunction(() => window.__mantelReady === true && !!window.hkWallpapers, null, { timeout: 30000 });
        await page.waitForTimeout(2500);
      };
      for (const s of input.screens) {
        await go('/' + s.path + '/home');
        const m = await sky(page);
        const tag = size + ' ' + s.theme + ' ' + s.color;
        say(m && m.th && m.layers >= 2 && m.wm === 'medium' && /^"[a-z]+@#[0-9a-f]{6}:(day|night)"$/.test(m.wall) && m.wall.indexOf(s.theme + '@') === 1,
            tag + ': the sky shows the theme, its layers inside it, Motion Medium', m);
        say(m && m.moved && m.running >= 1 && m.filters === 0 && m.props.every((p) => p === 'transform' || p === 'opacity'),
            tag + ': ...they move, by transform and opacity alone', m && { moved: m.moved, running: m.running, props: m.props, filters: m.filters });
        say(m && m.fps >= 50, tag + ': ...and the page keeps its frame rate', m && m.fps);
        await page.screenshot({ path: input.shots + '/' + s.path + '-' + size + '.png' });
        if (s === input.screens[0]) {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          const r = await sky(page);
          say(r && r.th && !r.moved && r.running === 0, size + ' Reduce Motion: the still frame', r);
          await page.emulateMedia({ reducedMotion: 'no-preference' });
        }
      }
      await go('/' + input.still + '/home');
      const st = await sky(page);
      say(st && st.th && st.layers === 3 && !st.wm && !st.moved && st.running === 0, size + ' Animations Off: the still frame, its layers where they start', st);
      await page.screenshot({ path: input.shots + '/still-' + size + '.png' });
      // HK SETTINGS: Sky / Background with All Screens' Aurora in Teal -- the twelve, the six, the Color
      await page.goto(input.origin + '/settings#/house/appearance/sky');
      await page.waitForTimeout(3500);
      const pick = await page.evaluate(() => {
        const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
        const all = deep(document), grids = all.filter((e) => e.matches && e.matches('.wallgrid'));
        const on = all.filter((e) => e.matches && e.matches('.wallgrid button[aria-pressed="true"]')).map((b) => b.getAttribute('data-fk'));
        const color = all.filter((e) => e.getAttribute && /^hwall:color:/.test(e.getAttribute('data-fk') || ''));
        const t = all.find((e) => e.getAttribute && e.getAttribute('data-fk') === 'hwall:aurora');
        if (t) t.scrollIntoView({ block: 'start' });
        return { grids: grids.map((g) => g.querySelectorAll('button').length), on, color: color.length };
      });
      say(pick.grids.join() === '12,6' && pick.on.join() === 'hwall:aurora' && pick.color >= 9, size + ' Settings: the twelve, the six motion themes, a theme\'s Color', pick);
      await page.waitForTimeout(600);
      await page.screenshot({ path: input.shots + '/settings-themes-' + size + '.png' });
      await page.evaluate(() => {
        const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
        const t = deep(document).find((e) => e.getAttribute && e.getAttribute('data-fk') === 'hwall:color:rose');
        if (t) t.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(600);
      await page.screenshot({ path: input.shots + '/settings-color-' + size + '.png' });
      // THE CLOCK SCREENSAVER over a theme, and over a drawn one
      for (const sv of input.saver) {
        await go('/' + sv + '/home');
        const started = await page.evaluate(() => !!(window.hkSaver && window.hkSaver.preview && (window.hkSaver.preview(true), true)));
        await page.waitForTimeout(3000);
        const ck = await page.evaluate(() => {
          const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
          const w = deep(document).find((e) => e.classList && e.classList.contains('ckwall'));
          return w ? { layers: w.children.length, mv: w.classList.contains('mv'), bg: /^url\("data:image\/svg/.test(w.style.backgroundImage),
                       running: [...w.children].flatMap((k) => k.getAnimations()).filter((a) => a.playState === 'running').length } : null;
        });
        const theme = sv === 'mt-saver-theme';
        say(started && ck && ck.bg && (theme ? ck.layers === 5 && ck.mv && ck.running >= 1 : ck.layers === 0), size + ' ' + sv + ': the clock over its wallpaper' + (theme ? ', its meteors flying' : ''), ck);
        await page.screenshot({ path: input.shots + '/' + sv + '-' + size + '.png' });
        if (theme) {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.evaluate(() => { window.hkSaver.preview(false); window.hkSaver.preview(true); });
          await page.waitForTimeout(2500);
          const rm = await page.evaluate(() => {
            const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
            const w = deep(document).find((e) => e.classList && e.classList.contains('ckwall'));
            return w ? { mv: w.classList.contains('mv'), running: [...w.children].flatMap((k) => k.getAnimations()).filter((a) => a.playState === 'running').length } : null;
          });
          say(rm && !rm.mv && rm.running === 0, size + ' ...Reduce Motion holds it still', rm);
          await page.emulateMedia({ reducedMotion: 'no-preference' });
        }
        await page.evaluate(() => window.hkSaver && window.hkSaver.preview && window.hkSaver.preview(false));
      }
      await page.goto(input.origin + '/settings#/screens/' + input.saver[0] + '/screensaver');
      await page.waitForTimeout(3500);
      const sp = await page.evaluate(() => {
        const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
        const all = deep(document), t = all.find((e) => e.getAttribute && e.getAttribute('data-sk') === 'saver:clock_bg');
        if (t) t.scrollIntoView({ block: 'start' });
        return { pick: !!t, grids: all.filter((e) => e.matches && e.matches('.wallgrid')).map((g) => g.querySelectorAll('button').length),
                 on: all.filter((e) => e.matches && e.matches('.wallgrid button[aria-pressed="true"]')).map((b) => b.getAttribute('data-fk')),
                 night: all.some((e) => e.getAttribute && /wallpaper_night/.test(e.getAttribute('data-sk') || '')) };
      });
      say(sp.pick && sp.grids.join() === '12,6' && sp.on.join() === 'swall:meteors' && !sp.night, size + ' Settings, the clock\'s Background: the same picker, no Night Version or Motion of its own', sp);
      await page.waitForTimeout(600);
      await page.screenshot({ path: input.shots + '/settings-saver-' + size + '.png' });
      await page.evaluate(() => {
        const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
        const t = deep(document).find((e) => e.getAttribute && e.getAttribute('data-fk') === 'swall:meteors');
        if (t) t.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(600);
      await page.screenshot({ path: input.shots + '/settings-saver-picker-' + size + '.png' });
      say(!errors.length, size + ' no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await browser.close(); }
  process.exitCode = fails ? 1 : 0;
})();
