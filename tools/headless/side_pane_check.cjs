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
  for (const [W, H] of input.sizes) {
    const context = await browser.newContext({ viewport: { width: W, height: H } });
    await context.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
    await context.route('**/*', (route) => new URL(route.request().url()).origin === input.origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    let cur = '';
    // (the browser's benign "ResizeObserver loop" note is no error, as the other checks have it)
    page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(cur + ': ' + e.message); });
    page.setDefaultTimeout(20000);
    const open = async (scr, view) => {
      cur = scr + '/' + (view || 'home');
      await page.goto(input.origin + '/' + scr + '/' + (view || 'home'));
      await page.waitForFunction(() => window.__mantelReady === true);
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
    }
    // WHILE A SONG PLAYS THE WHOLE PANE IS ITS ART (2026-10-30): the pane's own ground the art blurred, the music card
    // with no backdrop or box of its own, white words over its lightest part at 4.5:1; a flat tint where the look has
    // no blur; stopped, the screen's glass again
    if (!phone && !upright) {
      for (const [g, tinted, side] of [['blur', false, 'right'], ['tinted', true, 'right'], ['blur', false, 'left']]) {
        cur = 'pane-home-' + side + '?hkglass=' + g;
        await page.goto(input.origin + '/pane-home-' + side + '/home?hkglass=' + g);
        await page.waitForFunction(() => window.__mantelReady === true);
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
        want('playing in ' + g + ' on the ' + side + ': the whole pane takes the album art', a, a && a.arted && a.nobg && a.own === 0 &&
             (tinted ? a.tint && /^rgb\(/.test(a.tintColor) : !a.tint && a.worst >= 4.5));
        await shot(page, tag + '-playing-' + g + '-' + side);
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
                 foot: mp ? Math.round(pr.bottom - mp.getBoundingClientRect().bottom) : null, mx: !!card && !view,
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
      want('screensaver ' + side + ': its own sections on its side', s, s.on && (side === 'left' ? s.side !== null && s.rect[0] === 0 : s.side === null && s.rect[0] + s.rect[1] === W));
      const sd = await drawn('hk-side-pane[mode="saver"]');
      want('screensaver ' + side + ': its dividers and second ink as the Dashboard\'s, its weather there', sd,
           sd && sd.lines > 0 && sd.ruled && sd.sub !== 'rgb(255, 255, 255)' && (!sd.weather || (/\d°/.test(sd.weather) && sd.weather.indexOf('No weather') < 0)));
      await shot(page, tag + '-saver-' + side);
      await page.evaluate(() => window.hkSaver.preview(false));
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
            return { k: k && (k.dataset.k + ':' + k.dataset.size), h: k ? Math.round(k.getBoundingClientRect().height) : 0, scrolls: secs.scrollHeight > secs.clientHeight + 1 };
          }, [kind, size]);
          want('alone ' + kind + ' ' + size, got, got.k === kind + ':' + size && got.h > 0 && !got.scrolls);
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
    }
    if (errors.length) fails.push(tag + ' page errors: ' + errors.join(' | '));
    await context.close();
  }
  await browser.close();
  console.log(notes.join('\n'));
  if (fails.length) { console.log('\nFAILED:\n' + fails.join('\n')); process.exit(1); }
  console.log('\nside pane: all checks passed');
})().catch((e) => { console.error(e); process.exit(2); });
