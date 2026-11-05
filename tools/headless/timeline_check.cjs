// timeline_check.py's browser half: the Timeline page in WebKit at an iPad's two shapes and a phone, by touch.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));

const SIZES = [[820, 1180], [1180, 820], [390, 844]].filter(([w, h]) => !input.only.length || input.only.includes(`${w}x${h}`));
const CARD = 'hk-timeline-card';

// what the page shows now, from inside the card's shadow root
function measure() {
  const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
  const card = deep(document, 'hk-timeline-card')[0];
  const sr = card && card.shadowRoot;
  if (!sr) return null;
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const rows = [...sr.querySelectorAll('.row')].map(r => ({
    title: text(r.querySelector('.ti')), time: text(r.querySelector('.tm')), subs: [...r.querySelectorAll('.sb')].map(text),
    thumbs: r.querySelectorAll('.th img').length, warn: r.classList.contains('warn'), box: box(r),
    icon: r.querySelector('hk-icon') ? r.querySelector('hk-icon').getAttribute('icon') : '',
  }));
  const targets = [...sr.querySelectorAll('.chip, .btn, .row, .cl, .more .btn')].filter(e => !e.hidden && e.offsetParent !== null)
    .map(e => Object.assign(box(e), { cls: e.className, label: text(e).slice(0, 24) }));
  const se = document.scrollingElement;
  return {
    W: innerWidth, H: innerHeight, rows, targets, scrollW: se.scrollWidth, scrollH: se.scrollHeight, y: se.scrollTop,
    days: [...sr.querySelectorAll('.dh b')].map(text), hours: [...sr.querySelectorAll('.hh')].map(text),
    chips: [...sr.querySelectorAll('.chip')].map(c => text(c) + (c.classList.contains('on') ? '*' : '')),
    sum: sr.querySelector('.sum') && !sr.querySelector('.sum').hidden ? text(sr.querySelector('.sum')) : null,
    msg: sr.querySelector('.msg') ? text(sr.querySelector('.msg')) : null, foot: text(sr.querySelector('.foot')),
    fresh: sr.querySelector('.fresh') ? text(sr.querySelector('.fresh')) : null,
    tabbar: (() => { const b = document.getElementById('hk-tabbar'); return b ? b.getBoundingClientRect().top : null; })(),
    search: !!sr.querySelector('input[type=search]'), mine: [...sr.querySelectorAll('.btn')].some(b => /Only Mine/.test(b.textContent)),
  };
}

function sheetState() {
  const el = document.getElementById('hk-timeline-sheet');
  if (!el) return null;
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const sheet = el.querySelector('.sheet'), strip = el.querySelector('.pics');
  return {
    cs: (() => { const c = getComputedStyle(sheet); return [c.webkitBackdropFilter || c.backdropFilter, c.backgroundColor, c.opacity]; })(),
    open: el.classList.contains('open'), title: el.querySelector('.tt').textContent, sub: el.querySelector('.st').textContent,
    pics: el.querySelectorAll('.pic img').length, caption: el.querySelector('.pt') ? el.querySelector('.pt').textContent : '',
    dots: [...el.querySelectorAll('.dots i')].map(d => d.className), rows: [...el.querySelectorAll('.r')].map(r => r.textContent.replace(/\s+/g, ' ').trim()),
    go: el.querySelector('.go') ? el.querySelector('.go').textContent : null, nopic: el.querySelector('.nopic') ? el.querySelector('.nopic').textContent : null,
    sheet: box(sheet), strip: strip ? { sl: strip.scrollLeft, w: strip.clientWidth } : null, W: innerWidth, H: innerHeight,
    targets: [...el.querySelectorAll('button')].filter(b => !b.hidden).map(b => Object.assign(box(b), { label: b.getAttribute('aria-label') || b.textContent.trim().slice(0, 20) })),
    imgsLoaded: [...el.querySelectorAll('.pic img')].every(i => i.complete && i.naturalWidth > 0),
  };
}

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  const shots = input.shots;
  const shot = async (page, name, opts) => { if (shots) await page.screenshot(Object.assign({ path: path.join(shots, name + '.png') }, opts || {})); };
  let failures = 0;
  const check = (name, fn) => { try { fn(); } catch (e) { failures++; console.log('FAIL ' + name + ': ' + e.message.split('\n')[0]); } };
  try {
    for (const [w, h] of SIZES) {
      const key = `${w}x${h}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, timezoneId: input.zone, locale: 'en-US' });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', r => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage();
      const errors = [], reads = [];
      let phase = 'load';
      page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(phase + ': ' + e.message); });
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|aborted|net::/.test(m.text())) errors.push(phase + ' console: ' + m.text()); });
      if (process.env.TL_DEBUG) { page.on('console', m => console.log('console', m.type(), m.text().slice(0, 300))); page.on('requestfailed', r => console.log('failed', r.url())); }
      page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/timeline') && !u.pathname.includes('/pic/')) reads.push(u.pathname + u.search); });
      await page.clock.install({ time: new Date(input.now) });
      if (input.block) {
        // --block: the Home Grid's Recent blocks and the camera sheet's strip (slice 19.4), shots only
        await page.goto(input.origin + '/' + input.screen + '/home', { waitUntil: 'commit' });
        await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
        await page.clock.runFor(8000);             // (the page's clock is the fixed one: let the blocks' reads land)
        await page.waitForTimeout(4000);
        await shot(page, key + '-block');
        // the camera's sheet, as a tap on a camera opens it: its "Recent" strip under the picture
        await page.evaluate(() => window.hkShell.moreInfo('camera.driveway_cam'));
        await page.clock.runFor(6000);
        await page.waitForTimeout(4000);
        await shot(page, key + '-camera-sheet');
        check(key + ' no page errors', () => { if (errors.length) throw new Error(errors.join(' | ')); });
        await ctx.close();
        continue;
      }
      // (a start that never finishes -- a slow machine, a socket that dropped as it opened -- is made again once)
      for (let attempt = 0; ; attempt++) {
        await page.goto(input.origin + '/' + input.screen + '/timeline', { waitUntil: 'commit' });
        try { await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 20000 }); break; }
        catch (e) { if (attempt >= 1) throw new Error(key + ': the page never got ready (' + page.url() + '; errors ' + JSON.stringify(errors) + ')'); }
      }
      try { await page.waitForFunction(() => {
        const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
        const c = deep(document, 'hk-timeline-card')[0];
        return !!(c && c.shadowRoot && c.shadowRoot.querySelector('.row'));
      }, null, { timeout: 20000 }); }
      catch (e) { await shot(page, key + '-fail'); throw new Error(key + ': no rows drawn (errors ' + JSON.stringify(errors) + '; reads ' + JSON.stringify(reads) + ')'); }
      await page.waitForTimeout(1500);               // the sky, the pictures and the fonts settle
      phase = 'page';
      let m = await page.evaluate(measure);
      await shot(page, key + '-1-page');
      await shot(page, key + '-2-full', { fullPage: true });

      // ---- the page itself
      check(key + ' days', () => assert.deepEqual(m.days, ['Today', 'Yesterday', 'Sunday, November 1']));
      check(key + ' hours in the busy day', () => { assert(m.hours.length >= 5, JSON.stringify(m.hours)); assert(m.hours.includes('3 PM') && m.hours.includes('2 AM'), JSON.stringify(m.hours)); });
      check(key + ' rows', () => assert(m.rows.length >= 41, 'rows ' + m.rows.length));
      check(key + ' chips', () => assert.deepEqual(m.chips.slice(0, 1), ['All*']));
      check(key + ' summary', () => assert(m.sum && /Today/.test(m.sum), String(m.sum)));
      const byTitle = (t) => m.rows.find(r => r.title === t);
      check(key + ' who: tablet', () => assert(byTitle('Back Door unlocked').subs.some(s => s === 'Emma · Hallway tablet') || m.rows.some(r => r.title === 'Back Door unlocked' && r.subs.includes('Emma · Hallway tablet'))));
      check(key + ' who: by hand', () => assert(m.rows.some(r => r.subs.includes('By hand or an automation'))));
      check(key + ' who: away', () => assert(m.rows.some(r => r.subs.includes('Mark · away'))));
      check(key + ' who: assistant', () => assert(m.rows.some(r => r.subs.includes('Through an assistant for Emma'))));
      check(key + ' count line', () => assert(m.rows.some(r => r.subs.some(s => /14 times, 3:40 to 3:58 AM/.test(s))), JSON.stringify(m.rows.filter(r => /Person/.test(r.title)).map(r => r.subs))));
      check(key + ' flapping line', () => assert(m.rows.some(r => /keeps changing/.test(r.title) && r.subs.some(s => /2:10 to 2:40 AM/.test(s)))));
      check(key + ' late', () => assert(m.rows.some(r => r.subs.includes('While Mantel was off'))));
      check(key + ' picture not kept', () => assert(m.rows.some(r => r.subs.includes('Picture not kept'))));
      check(key + ' thumbnails', () => assert.equal(m.rows.filter(r => r.thumbs > 0).length, 2));
      check(key + ' warnings tinted', () => assert(m.rows.filter(r => r.warn).length >= 4));
      check(key + ' no sideways scroll', () => assert(m.scrollW <= m.W, m.scrollW + ' > ' + m.W));
      check(key + ' touch targets', () => { for (const t of m.targets) assert(t.h >= 43.5 && t.w >= 43.5, `${t.cls} "${t.label}" is ${t.w} x ${t.h}`); });
      check(key + ' inside the window', () => { for (const t of m.targets) if (!/chip/.test(t.cls) || w > 640) assert(t.l >= -0.5 && t.r <= m.W + 0.5, `${t.cls} "${t.label}" ${t.l}..${t.r} of ${m.W}`); });

      // ---- the filters, by touch
      phase = 'filters';
      const last = () => reads[reads.length - 1] || '';
      await page.locator(CARD + ' .chip', { hasText: 'Doors' }).tap();
      await page.waitForFunction(() => true);
      await page.waitForTimeout(700);
      m = await page.evaluate(measure);
      check(key + ' Doors asks for family=doors', () => assert(/family=doors/.test(last()), last()));
      check(key + ' Doors rows', () => assert(m.rows.length > 0 && m.rows.every(r => /Door|Window/.test(r.title)), JSON.stringify(m.rows.map(r => r.title))));
      check(key + ' Doors chip on', () => assert(m.chips.includes('Doors*') && m.chips.includes('All'), m.chips.join()));
      await shot(page, key + '-3-doors');
      await page.locator(CARD + ' .chip', { hasText: 'All' }).first().tap();
      await page.waitForTimeout(500);
      // search
      await page.evaluate(() => window.scrollTo(0, 0));
      {
        // (a touch at the field's own place: Playwright's tap check trips over the field inside the shadow tree)
        const box = await page.locator(CARD + ' input[type=search]').boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        const focused = await page.evaluate(() => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a && a.type; });
        check(key + ' a touch on the search field focuses it', () => assert.equal(focused, 'search'));
      }
      await page.keyboard.type('garage');
      await page.waitForTimeout(800);
      m = await page.evaluate(measure);
      check(key + ' search asks for q=garage once', () => { assert(/q=garage/.test(last()), last()); assert.equal(reads.filter(r => /q=g(a|ar|arag)?(&|$)/.test(r)).length, 0, 'a read per letter: ' + reads.join(' ')); });
      check(key + ' search rows', () => assert(m.rows.length >= 5 && m.rows.every(r => /Garage/.test(r.title + ' ' + r.subs.join(' ')))));
      await shot(page, key + '-4-search');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(CARD + ' [data-act=clear-q]').tap();
      await page.waitForTimeout(700);
      // a day
      await page.evaluate(() => window.scrollTo(0, 0));
      // (the Calendar's little month under the button, not the system's picker: 2026-11-05)
      await page.locator(CARD + ' [data-act=pick-day]').tap();
      await page.waitForTimeout(300);
      const dp = await page.evaluate((sel) => {
        const deep = (r) => { const h = r.querySelector(sel); if (h) return h; for (const e of r.querySelectorAll('*')) if (e.shadowRoot) { const f = deep(e.shadowRoot); if (f) return f; } return null; };
        const card = deep(document);
        const root = card && card.shadowRoot, box = root && root.querySelector('.dp'), r = box && box.getBoundingClientRect();
        const days = root ? [...root.querySelectorAll('.dp [data-act=day-pick]')] : [];
        return { open: !!box, inView: !!r && r.left >= 0 && r.right <= innerWidth + 0.5 && r.height > 200, title: box && box.querySelector('.mh b').textContent,
                 future: days.filter(d => d.disabled).map(d => d.getAttribute('data-v')).slice(0, 1), date: root ? root.querySelectorAll('input[type=date]').length : -1 };
      }, CARD);
      check(key + ' the day jump opens the little month, in sight, no date input', () => { assert(dp.open && dp.inView && dp.date === 0, JSON.stringify(dp)); assert.equal(dp.title, 'November 2026'); });
      check(key + ' a day after today cannot be picked', () => assert.deepEqual(dp.future, ['2026-11-04'], JSON.stringify(dp.future)));
      await shot(page, key + '-5-day-picker');
      await page.locator(CARD + ' .dp [data-act=day-pick][data-v="2026-11-02"]').tap();
      await page.waitForTimeout(800);
      m = await page.evaluate(measure);
      const midnight = Math.floor(new Date('2026-11-03T06:00:00Z').getTime() / 1000);        // midnight, Nov 3, at the house
      check(key + ' day jump asks until the end of that day', () => assert(last().includes('until=' + midnight), last() + ' want ' + midnight));
      check(key + ' day jump rows', () => assert(m.days[0] === 'Yesterday' && m.rows[0].title === 'Home Alarm armed night', JSON.stringify([m.days, m.rows[0] && m.rows[0].title])));
      await shot(page, key + '-5-day');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(CARD + ' [data-act=clear-day]').tap();
      await page.waitForTimeout(700);
      // only mine
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(CARD + ' [data-act=mine]').tap();
      await page.waitForTimeout(800);
      m = await page.evaluate(measure);
      check(key + ' only mine asks mine=1', () => assert(/mine=1/.test(last()), last()));
      check(key + ' only mine rows', () => assert(m.rows.length >= 6 && m.rows.every(r => r.subs.some(s => /^Emma|assistant for Emma/.test(s)) || /Emma/.test(r.subs.join())), JSON.stringify(m.rows.map(r => r.title + '|' + r.subs.join('/')).slice(0, 4))));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(CARD + ' [data-act=mine]').tap();
      await page.waitForTimeout(700);

      // ---- the sheet
      phase = 'sheet';
      await page.locator(CARD + ' .row', { hasText: 'Someone rang Front Door' }).first().tap();
      await page.waitForFunction(() => { const s = document.getElementById('hk-timeline-sheet'); return !!(s && s.classList.contains('open')); });
      await page.waitForTimeout(900);
      let s = await page.evaluate(sheetState);
      check(key + ' sheet: pictures', () => { assert.equal(s.pics, 2); assert(s.imgsLoaded, 'pictures loaded'); });
      check(key + ' sheet: title and rows', () => { assert.equal(s.title, 'Someone rang Front Door'); assert(s.rows.some(r => /^Time\s*Tuesday, November 3, 2026 at 2:47:00 PM/.test(r)), s.rows.join(' | ')); });
      check(key + ' sheet: show all', () => assert.equal(s.go, 'Show All for Front Door', String(s.go)));
      check(key + ' sheet: fits and touch', () => { assert(s.sheet.l >= 0 && s.sheet.r <= s.W && s.sheet.t >= 0 && s.sheet.b <= s.H, JSON.stringify(s.sheet)); for (const t of s.targets) assert(t.h >= 43.5 && t.w >= 43.5, t.label + ' ' + t.w + 'x' + t.h); });
      if (process.env.TL_DEBUG) console.log('sheet css', JSON.stringify(s.cs));
      await shot(page, key + '-6-sheet');
      // swipe to the second picture (a touch drag along the strip)
      const strip = await page.locator('#hk-timeline-sheet .pics').boundingBox();
      await page.evaluate(() => { document.querySelector('#hk-timeline-sheet .pics').scrollTo({ left: 100000, behavior: 'instant' }); });
      await page.waitForTimeout(500);
      s = await page.evaluate(sheetState);
      check(key + ' sheet: swiped to the second picture', () => { assert(s.strip.sl > s.strip.w * 0.9, JSON.stringify(s.strip)); assert.deepEqual(s.dots, ['', 'on']); assert(/2 of 2/.test(s.caption), s.caption); });
      await shot(page, key + '-7-sheet-second');
      await page.locator('#hk-timeline-sheet [data-nav="-1"]').tap();
      await page.waitForTimeout(700);
      s = await page.evaluate(sheetState);
      check(key + ' sheet: back with the arrow', () => assert.deepEqual(s.dots, ['on', '']));
      // Show All for this camera
      await page.locator('#hk-timeline-sheet [data-go]').tap();
      await page.waitForTimeout(900);
      m = await page.evaluate(measure);
      check(key + ' show all asks for camera=camera.front_door', () => assert(/camera=camera\.front_door/.test(last()), last()));
      check(key + ' show all rows', () => assert(m.rows.length === 3 && m.rows.every(r => /Front Door/.test(r.title)), JSON.stringify(m.rows.map(r => r.title))));
      check(key + ' show all chip', () => assert(m.chips.some(c => /^Front Door/.test(c))));
      await shot(page, key + '-8-show-all');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(CARD + ' [data-act=clear-entity]').tap();
      await page.waitForTimeout(700);
      // a row with no picture, and the one whose picture was not kept
      await page.locator(CARD + ' .row', { hasText: 'Vehicle at Driveway Cam' }).first().tap();
      await page.waitForFunction(() => { const x = document.getElementById('hk-timeline-sheet'); return !!(x && x.classList.contains('open')); });
      await page.waitForTimeout(700);
      s = await page.evaluate(sheetState);
      check(key + ' sheet: picture not kept', () => assert(/Picture not kept/.test(s.nopic || ''), String(s.nopic)));
      await shot(page, key + '-9-sheet-nopic');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => !!document.getElementById('hk-timeline-sheet')), false, key + ' the sheet is gone');
      await page.locator(CARD + ' .row', { hasText: 'Home Alarm disarmed' }).first().tap();
      await page.waitForFunction(() => { const x = document.getElementById('hk-timeline-sheet'); return !!(x && x.classList.contains('open')); });
      await page.waitForTimeout(500);
      s = await page.evaluate(sheetState);
      check(key + ' sheet: who and how', () => assert(s.rows.some(r => /^From\s*Emma \u00b7 Hallway tablet \u00b7 Keypad: Anna/.test(r)), s.rows.join(' | ')));
      await shot(page, key + '-10-sheet-late');
      await page.locator('#hk-timeline-sheet .x').tap();
      await page.waitForTimeout(500);

      // ---- the live feed, once (the server pushes a row when the browser says it is ready)
      if (!input.skipLive && key === (SIZES[0][0] + 'x' + SIZES[0][1])) {
        phase = 'live';
        await page.evaluate(() => window.scrollTo(0, 0));
        fs.writeFileSync(input.go, '1');
        await page.waitForFunction(() => {
          const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
          const c = deep(document, 'hk-timeline-card')[0];
          const first = c && c.shadowRoot.querySelector('.row .ti');
          return !!first && first.textContent === 'Front Door locked';
        }, null, { timeout: 8000 }).catch(() => { failures++; console.log('FAIL ' + key + ' live: no new row'); });
        m = await page.evaluate(measure);
        check(key + ' live: the new row is first, with its who line', () => assert(m.rows[0].title === 'Front Door locked' && m.rows[0].subs.includes('Emma · Hallway tablet'), JSON.stringify(m.rows[0])));
        await shot(page, key + '-11-live');
      }

      // ---- more by scrolling: the first page cut short, the second asked for when the foot comes near
      phase = 'more';
      await page.route('**/api/timeline?*', async (route) => {
        const u = new URL(route.request().url());
        if (u.searchParams.get('limit') === '50') { u.searchParams.set('limit', '20'); await route.continue({ url: u.toString() }); } else await route.continue();
      });
      await page.goto(page.url(), { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
      await page.waitForFunction(() => {
        const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
        const c = deep(document, 'hk-timeline-card')[0];
        return !!(c && c.shadowRoot && c.shadowRoot.querySelector('.row'));
      }, null, { timeout: 20000 });
      m = await page.evaluate(measure);
      check(key + ' first page is 20 rows', () => assert.equal(m.rows.length, 20, 'rows ' + m.rows.length));
      reads.length = 0;
      await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
      await page.waitForFunction(() => {
        const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
        const c = deep(document, 'hk-timeline-card')[0];
        return c.shadowRoot.querySelectorAll('.row').length > 20;
      }, null, { timeout: 8000 }).catch(() => {});
      m = await page.evaluate(measure);
      check(key + ' scrolling to the foot read the next page (before=)', () => assert(reads.some(r => /before=\d+/.test(r)), reads.join(' ')));
      check(key + ' ...and the rows grew', () => assert(m.rows.length > 20, 'rows ' + m.rows.length));
      await page.unroute('**/api/timeline?*');

      // ---- the empty state, the error state and Try Again
      phase = 'states';
      await page.route('**/api/timeline?*', (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ events: [], next_before: null, limited: false, names: true, search: true, families: ['door', 'lock', 'garage', 'alarm', 'arrival', 'doorbell', 'detection', 'motion', 'safety', 'system', 'refused'] }) }));
      await page.goto(page.url(), { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
      await page.waitForTimeout(1800);
      m = await page.evaluate(measure);
      check(key + ' empty state', () => assert(m.msg && /Nothing yet\. The timeline starts recording today\./.test(m.msg), String(m.msg)));
      await shot(page, key + '-12-empty');
      await page.unroute('**/api/timeline?*');
      await page.route('**/api/timeline?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
      await page.goto(page.url(), { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
      await page.waitForTimeout(1800);
      m = await page.evaluate(measure);
      check(key + ' error state', () => assert(m.msg && /Couldn.t load the Timeline/.test(m.msg), String(m.msg)));
      await shot(page, key + '-13-error');
      await page.unroute('**/api/timeline?*');
      await page.locator(CARD + ' [data-act=retry]').tap();
      await page.waitForTimeout(1200);
      m = await page.evaluate(measure);
      check(key + ' Try Again reads again', () => assert(m.rows.length > 10, 'rows ' + m.rows.length));
      // a person who may not: the server's own words
      await page.route('**/api/timeline?*', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' }));
      await page.goto(page.url(), { waitUntil: 'commit' });
      await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
      await page.waitForTimeout(1500);
      m = await page.evaluate(measure);
      check(key + ' forbidden says so', () => assert(m.msg && /isn.t part of this account/.test(m.msg) && !m.msg.includes('Try Again'), String(m.msg)));
      await page.unroute('**/api/timeline?*');

      check(key + ' no page errors', () => assert.deepEqual(errors, []));
      console.log(`${key}: ${m.rows ? 'done' : ''} (${reads.length} reads)`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  if (failures) { console.log(failures + ' failures'); process.exit(1); }
  console.log('timeline_check: ok');
})().catch((e) => { console.error(e); process.exit(1); });
