// intercom_check.py's browser: WebKit, a finger, each size in turn. One line a step on stdout: "ok ..." or "FAIL ...".
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = (s) => process.stdout.write(s + '\n');

const DEEP = `window.deep = (r, s) => [...r.querySelectorAll('*')].flatMap((e) => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);`;
// what the open sheet's card draws, read from inside its shadow root
const SHEET = `deep(document, 'hk-intercom-sheet-card')[0]`;
const MEASURE = () => {
  const card = deep(document, 'hk-intercom-sheet-card')[0];
  if (!card || !card.shadowRoot) return null;
  const root = card.shadowRoot, sheet = card.closest ? null : null;
  // the detail sheet around it
  let host = card, hkd = null;
  while (host && !hkd) { const n = host.getRootNode(); host = n.host || null; if (host && host.classList && host.classList.contains('hkd')) hkd = host; if (!host) break; }
  hkd = hkd || deep(document, '.hkd.open')[0];
  const sh = hkd && hkd.querySelector('.sheet'), r = sh && sh.getBoundingClientRect();
  const small = [];
  root.querySelectorAll('.pill, .mb, .rv button, .seg button').forEach((e) => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || e.closest('[hidden]')) return;
    const q = e.getBoundingClientRect();
    if (q.width < 1) return;
    if (Math.min(q.width, q.height) < 43.5) small.push(e.className + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
  });
  const text = (sel) => { const e = root.querySelector(sel); return e ? e.textContent : null; };
  const over = [];
  if (sh) root.querySelectorAll('.pill, .mb, .rv button, .line, .seg').forEach((e) => {
    const q = e.getBoundingClientRect(), b = sh.getBoundingClientRect();
    if (q.width && (q.left < b.left + 4 || q.right > b.right - 4)) over.push(e.className);
  });
  const q = (sel) => [...root.querySelectorAll(sel)].filter((e) => !e.closest('[hidden]'));
  return {
    sheet: r ? [r.left | 0, r.top | 0, r.width | 0, r.height | 0] : null,
    inside: !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    small: [...new Set(small)], over: [...new Set(over)],
    line: text('.line'), mic: root.querySelector('.mic') && root.querySelector('.mic').getAttribute('data-kind'), micHidden: root.querySelector('.mic').hidden,
    micLabel: root.querySelector('.mb').getAttribute('aria-label'), time: text('.mt'),
    buttons: q('.rv button').map((b) => b.textContent), seg: q('.seg button').map((b) => b.textContent + (b.classList.contains('sel') ? '*' : '')),
    chips: q('.chips .pill').map((p) => p.textContent.trim() + (p.getAttribute('aria-pressed') === 'true' ? '*' : '') + (p.classList.contains('preset') ? '~' : '')),
    pills: q('.rooms .pill').map((p) => p.textContent.trim() + (p.getAttribute('aria-pressed') === 'true' ? '*' : '') + (p.querySelector('.pi') ? '+' : '')),
    dashed: q('.chips .pill.preset').map((p) => getComputedStyle(p).borderStyle),
    touchAction: getComputedStyle(root.querySelector('.mb')).touchAction,
    scrollX: hkd ? hkd.querySelector('.body').scrollWidth - hkd.querySelector('.body').clientWidth : 0,
  };
};

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let bad = 0;
  const fail = (size, what, detail) => { bad++; out('FAIL ' + size + ' ' + what + (detail === undefined ? '' : ': ' + JSON.stringify(detail))); };
  try {
    for (const [name, spec] of Object.entries(input.sizes)) {
      const dev = spec.device ? pw.devices[spec.device] : { viewport: { width: spec.viewport[0], height: spec.viewport[1] }, hasTouch: true, deviceScaleFactor: 1 };
      if (spec.device && !dev) { fail(name, 'no such device', spec.device); continue; }
      const ctx = await browser.newContext({ ...dev, hasTouch: true });
      await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      await ctx.addInitScript({ content: input.fakes });                // (the page's CSP allows no script tag of ours)
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('page error: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/glyphs\.js|hk-glyphs|SF-Pro|Failed to load resource|intercom/i.test(m.text() + ((m.location() || {}).url || ''))) errors.push('console: ' + m.text()); });
      const shot = (what) => page.screenshot({ path: `${input.shots}/${name}-${what}.png` });
      const tapAt = async (selector, nth = 0) => {
        const box = await page.evaluate(([sel, n]) => {
          const el = deep(document, sel)[n];
          if (!el) return null;
          el.scrollIntoView({ block: 'nearest' });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, [selector, nth]);
        if (!box) throw new Error('nothing to tap: ' + selector);
        await page.touchscreen.tap(box.x, box.y);
      };
      // inside the sheet's shadow root
      const sheetTap = async (selector, nth = 0) => {
        const box = await page.evaluate(([sel, n]) => {
          const root = deep(document, 'hk-intercom-sheet-card')[0].shadowRoot;
          const el = [...root.querySelectorAll(sel)].filter((e) => !e.closest('[hidden]'))[n];
          if (!el) return null;
          el.scrollIntoView({ block: 'nearest' });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, [selector, nth]);
        if (!box) throw new Error('nothing to tap in the sheet: ' + selector);
        await page.touchscreen.tap(box.x, box.y);
      };
      const lineIs = (re) => page.waitForFunction((src) => { const c = deep(document, 'hk-intercom-sheet-card')[0]; return !!c && new RegExp(src).test(c.shadowRoot.querySelector('.line').textContent); }, re.source, { timeout: 8000 });
      const openSheet = async () => {
        await page.evaluate(() => hkIntercom.open());
        await page.waitForFunction(() => { const c = deep(document, 'hk-intercom-sheet-card')[0]; return !!c && c.shadowRoot.querySelectorAll('.rooms .pill').length > 0; }, null, { timeout: 15000 });
        await page.waitForTimeout(900);                       // the sheet slides in
      };
      const closeSheet = async () => {
        await page.evaluate(() => window.hkDetail && window.hkDetail.close && window.hkDetail.close());
        await page.waitForFunction(() => !deep(document, 'hk-intercom-sheet-card')[0], null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(500);
      };
      try {
        await page.goto(`${input.origin}/${input.screen}/home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => window.__mantelReady === true && !!window.hkIntercom && !!window.hkDetail, null, { timeout: 40000 });
        await page.evaluate(DEEP);
        // headless WebKit draws no backdrop blur: the frost Safari gives the sheet stood in for (sheet_review.cjs's)
        await page.evaluate(() => { const css = new CSSStyleSheet(); css.replaceSync('.hkd .sheet{background:rgba(44,44,50,.96)!important}'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, css]; });
        await page.evaluate(() => __intercomFake.install({ mem: { mode: 'message', rooms: ['media_player.living_room', 'media_player.kitchen'] }, firstUse: false }));
        await page.waitForFunction(() => deep(document, 'hk-intercom-card').length >= 2, null, { timeout: 20000 });
        await page.waitForTimeout(1200);

        // ---- the block
        const blocks = await page.evaluate(() => deep(document, 'hk-intercom-card').map((c) => {
          const s = c.shadowRoot, r = c.getBoundingClientRect();
          return { size: s.querySelector('.k').getAttribute('size'), state: s.querySelector('.state').textContent, state_shown: s.querySelector('.state').style.display !== 'none',
                   chips: [...s.querySelectorAll('.chip')].map((x) => x.textContent), name: s.querySelector('.name').textContent, box: [r.width | 0, r.height | 0], aria: s.querySelector('.k').getAttribute('aria-label') };
        }));
        const S = blocks.find((b) => b.size === 'S'), W = blocks.find((b) => b.size === 'W');
        if (!S || !W) fail(name, 'both blocks drawn', blocks);
        else {
          if (S.state !== 'Living Room, Kitchen') fail(name, 'the Small block names the rooms last picked', S);
          if (W.chips.join() !== 'Living Room,Kitchen') fail(name, 'the Wide block shows them as chips', W);
        }
        await shot('block');
        out(`ok ${name} block`);

        // ---- the sheet, opened by a touch on the block
        await tapAt('hk-intercom-card');
        await page.waitForFunction(() => { const c = deep(document, 'hk-intercom-sheet-card')[0]; return !!c && c.shadowRoot.querySelectorAll('.rooms .pill').length > 0; }, null, { timeout: 15000 });
        await page.waitForTimeout(900);
        let m = await page.evaluate(MEASURE);
        if (!m) { fail(name, 'the sheet opened'); await ctx.close(); continue; }
        if (!m.inside) fail(name, 'the sheet is on the screen', m.sheet);
        if (m.small.length) fail(name, 'every target is at least 44', m.small);
        if (m.over.length) fail(name, 'nothing runs past the sheet\'s edge', m.over);
        if (m.scrollX > 1) fail(name, 'no sideways scroll', m.scrollX);
        if (m.seg.length) fail(name, 'Live is hidden unless the feed allows it', m.seg);
        if (m.chips.join('|') !== 'Whole House|Main Floor|Upstairs|Dinner~|Bedtime~') fail(name, 'the chips: Whole House, floors, presets', m.chips);
        if (m.dashed.some((d) => d !== 'dashed')) fail(name, 'presets have a dashed border', m.dashed);
        if (m.pills.join('|') !== 'Living Room*|Kitchen*|Dining Room+|Office+|Bedroom+|Guest Room') fail(name, 'the room pills, picked ones marked, skipped ones and a group leader with a glyph', m.pills);
        if (m.touchAction !== 'none') fail(name, 'touch-action:none on the microphone', m.touchAction);
        if (m.line !== 'Living Room, Kitchen') fail(name, 'the status line names the rooms', m.line);
        await shot('picker');
        out(`ok ${name} sheet opened and picker (${m.sheet.join('x')})`);

        // ---- the picker with a finger
        await sheetTap('.chips .pill', 0);                                  // Whole House
        m = await page.evaluate(MEASURE);
        if (m.pills.filter((p) => p.includes('*')).length !== 4) fail(name, 'Whole House picks the four rooms that can be', m.pills);
        await sheetTap('.chips .pill', 0);
        m = await page.evaluate(MEASURE);
        if (m.pills.some((p) => p.includes('*'))) fail(name, 'Whole House again puts them back', m.pills);
        await sheetTap('.chips .pill', 3);                                  // Dinner
        m = await page.evaluate(MEASURE);
        if (m.pills.filter((p) => p.includes('*')).map((p) => p.replace(/[*+]/g, '')).join() !== 'Kitchen,Dining Room') fail(name, 'a preset picks its rooms', m.pills);
        await sheetTap('.rooms .pill', 3);                                  // Office: leads
        m = await page.evaluate(MEASURE);
        if (m.line !== 'Dining Room leads Office' || m.pills[3].includes('*')) fail(name, 'a skipped pill says why and is not picked', [m.line, m.pills[3]]);
        await sheetTap('.rooms .pill', 4);                                  // Bedroom: quiet
        m = await page.evaluate(MEASURE);
        if (m.line !== 'Bedroom: Quiet hours') fail(name, 'quiet hours, said', m.line);
        await sheetTap('.chips .pill', 3);                                  // back to none
        await sheetTap('.rooms .pill', 0);
        await sheetTap('.rooms .pill', 1);                                  // Living Room, Kitchen
        out(`ok ${name} picker with a finger`);

        // ---- Message: record, stop, review, play, re-record, cancel, send
        await page.evaluate(() => { window.__log = []; });
        await sheetTap('.mb');
        await lineIs(/Connecting|Recording/);
        await lineIs(/^Recording$/);
        await page.waitForTimeout(900);
        m = await page.evaluate(MEASURE);
        if (m.mic !== 'rec') fail(name, 'the microphone shows it is recording', m.mic);
        if (!/left$/.test(m.time || '')) fail(name, 'the time left is counted', m.time);
        await shot('sheet-message');
        await page.evaluate(() => __intercomFake.mic().speak(7));
        await sheetTap('.mb');
        await page.waitForFunction(() => { const c = deep(document, 'hk-intercom-sheet-card')[0]; return !!c && c.shadowRoot.querySelectorAll('.rv button').length > 0; }, null, { timeout: 5000 });
        await page.waitForTimeout(300);
        m = await page.evaluate(MEASURE);
        if (m.buttons.join() !== 'Send,Play,Re-record,Cancel') fail(name, 'Send, Play, Re-record, Cancel', m.buttons);
        if (m.line !== 'Ready to send to Living Room, Kitchen') fail(name, 'ready to send, to whom', m.line);
        if (m.small.length) fail(name, 'every review button is at least 44', m.small);
        await shot('sheet-review');
        await sheetTap('.rv button', 1);                                    // Play
        m = await page.evaluate(MEASURE);
        if (m.buttons[1] !== 'Stop') fail(name, 'Play becomes Stop', m.buttons);
        await sheetTap('.rv button', 1);
        await sheetTap('.rv button', 2);                                    // Re-record
        await lineIs(/^Recording$/);
        await page.evaluate(() => __intercomFake.mic().speak(5));
        await sheetTap('.mb');
        await page.waitForFunction(() => deep(document, 'hk-intercom-sheet-card')[0].shadowRoot.querySelectorAll('.rv button').length > 0, null, { timeout: 5000 });
        await sheetTap('.rv button', 3);                                    // Cancel
        await page.waitForFunction(() => !deep(document, 'hk-intercom-sheet-card')[0].shadowRoot.querySelector('.mic').hidden, null, { timeout: 5000 });
        m = await page.evaluate(MEASURE);
        if (m.buttons.length) fail(name, 'Cancel puts the microphone back', m.buttons);
        // a pointercancel on the microphone starts nothing
        await page.evaluate(() => {
          const mb = deep(document, 'hk-intercom-sheet-card')[0].shadowRoot.querySelector('.mb');
          const ev = (t) => new PointerEvent(t, { bubbles: true, composed: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0 });
          mb.dispatchEvent(ev('pointerdown')); mb.dispatchEvent(ev('pointercancel')); mb.dispatchEvent(ev('pointerup'));
        });
        await page.waitForTimeout(500);
        m = await page.evaluate(MEASURE);
        if (m.mic !== 'idle') fail(name, 'a pointercancel starts nothing', m.mic);
        await sheetTap('.mb');
        await lineIs(/^Recording$/);
        await page.evaluate(() => __intercomFake.mic().speak(7));
        await sheetTap('.mb');
        await page.waitForFunction(() => deep(document, 'hk-intercom-sheet-card')[0].shadowRoot.querySelectorAll('.rv button').length > 0, null, { timeout: 5000 });
        await sheetTap('.rv button', 0);                                    // Send
        await lineIs(/^Sending/);
        await shot('sheet-sending');
        await lineIs(/^Sent to 2 rooms$/);
        m = await page.evaluate(MEASURE);
        if (m.buttons.join() !== 'Send Again,Play,Done') fail(name, 'after Sent: Send Again, Play, Done', m.buttons);
        await shot('sheet-sent');
        out(`ok ${name} message: record, review, play, re-record, cancel, pointercancel, send`);
        await closeSheet();

        // ---- Needs HTTPS (a plain page has no microphone)
        await page.evaluate(() => __intercomFake.install({ secure: false, firstUse: false }));
        await openSheet();
        m = await page.evaluate(MEASURE);
        if (m.line !== 'Needs HTTPS: open this page by its https:// address') fail(name, 'the HTTPS note', m.line);
        if (m.mic !== 'off') fail(name, 'the microphone is drawn off', m.mic);
        await shot('sheet-https');
        await closeSheet();
        out(`ok ${name} Needs HTTPS`);

        // ---- Live, drawn only when the feed allows it
        await page.evaluate(() => __intercomFake.install({ live: true, canOverride: true, mem: { mode: 'live', rooms: ['media_player.living_room', 'media_player.guest_room'] }, firstUse: false }));
        await openSheet();
        m = await page.evaluate(MEASURE);
        if (m.seg.join() !== 'Message,Live*') fail(name, 'the Live / Message switch when the feed allows Live', m.seg);
        if (m.micLabel !== 'Hold to talk') fail(name, 'Live says hold to talk', m.micLabel);
        if (!m.pills.some((p) => p.startsWith('Kitchen') && p.includes('+'))) fail(name, 'you are here: the Kitchen carries a glyph in Live', m.pills);
        if (m.line !== 'Guest Room: after you finish') fail(name, 'rooms that hear it after you finish', m.line);
        await shot('sheet-live');
        await page.evaluate(() => {
          const mb = deep(document, 'hk-intercom-sheet-card')[0].shadowRoot.querySelector('.mb');
          window.__down = (t) => mb.dispatchEvent(new PointerEvent(t, { bubbles: true, composed: true, cancelable: true, pointerId: 11, pointerType: 'touch', isPrimary: true, button: 0 }));
          window.__down('pointerdown');
        });
        await lineIs(/^Live/);
        await page.waitForTimeout(800);
        await page.evaluate(() => window.__down('pointerup'));
        await page.waitForTimeout(300);
        const calls = await page.evaluate(() => __intercomFake.mic().calls.join());
        if (!/start/.test(calls) || !/end/.test(calls)) fail(name, 'a hold starts Live and the release ends it', calls);
        await closeSheet();
        out(`ok ${name} Live (a hold)`);
        await page.evaluate(() => __intercomFake.install({ mem: { mode: 'message', rooms: [] }, firstUse: true }));
        await openSheet();
        m = await page.evaluate(MEASURE);
        if (m.line !== 'One-way: the rooms can’t answer') fail(name, 'the one-way note on first use', m.line);
        await closeSheet();

        // ---- a tablet that listens: one pill if the browser will not start audio unasked, a touch plays the clip
        await page.evaluate(() => {
          window.__fetched = [];
          const real = window.fetch.bind(window);
          const n = 800, wav = new ArrayBuffer(44 + n * 2), v = new DataView(wav);
          const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
          w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
          v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
          w(36, 'data'); v.setUint32(40, n * 2, true);
          window.fetch = (u, o) => /\/api\/intercom\/clip\//.test(String(u)) ? (__fetched.push([String(u), o && o.credentials]), Promise.resolve(new Response(wav.slice(0)))) : real(u, o);
          // a browser that will not start audio until a touch (headless WebKit would, so the context says so itself)
          const AC = window.AudioContext || window.webkitAudioContext;
          class Gated extends AC {
            constructor() { super(); this.open = false; }
            get state() { return this.open ? super.state : 'suspended'; }
            resume() { if (window.__touched) { this.open = true; return super.resume(); } return new Promise(() => {}); }
          }
          hkIntercom._.listener().d.AudioContext = Gated;
          ['pointerdown', 'touchend', 'click'].forEach((ev) => document.addEventListener(ev, () => { window.__touched = true; }, true));
          __intercomFake.install({ listener: true, firstUse: false });
        });
        await page.waitForTimeout(700);
        const L0 = await page.evaluate(() => { const L = hkIntercom._.listener(); return { started: !!L, state: L && L.ctx ? L.ctx.state : null, pill: !!document.getElementById('hk-intercom-pill') }; });
        if (!L0.started || !L0.state) fail(name, 'the page-wide listener started and made its audio', L0);
        if (L0.state !== 'running' && !L0.pill) fail(name, 'a context that will not start asks for a touch with one pill', L0);
        if (L0.state === 'running' && L0.pill) fail(name, 'no pill when audio runs', L0);
        await page.evaluate(() => __intercomFake.install({ listener: true, firstUse: false, play: { id: 'b1', url: '/api/intercom/clip/b1.wav', volume: 0.5 } }));
        await page.waitForFunction(() => window.__fetched.length === 1, null, { timeout: 8000 });
        const got = await page.evaluate(() => window.__fetched[0]);
        if (got[0] !== '/api/intercom/clip/b1.wav' || got[1] !== 'include') fail(name, 'the clip is fetched with the page\'s credentials', got);
        if (L0.pill) {
          await page.waitForTimeout(500);
          const box = await page.evaluate(() => { const r = document.getElementById('hk-intercom-pill').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; });
          if (box.h < 44) fail(name, 'the pill is a 44 pt target', box.h);
          await shot('listener-pill');
          await page.touchscreen.tap(box.x, box.y);
          await page.waitForFunction(() => !document.getElementById('hk-intercom-pill'), null, { timeout: 5000 }).catch(() => fail(name, 'a touch takes the pill away'));
        }
        await page.waitForFunction(() => hkIntercom._.listener().played === 1, null, { timeout: 8000 }).catch(async () => fail(name, 'the clip played', await page.evaluate(() => { const L = hkIntercom._.listener(); return { state: L.ctx.state, played: L.played }; })));
        await page.evaluate(() => __intercomFake.install({ listener: true, firstUse: false, play: { id: 'b1', url: '/api/intercom/clip/b1.wav', volume: 0.5 } }));
        await page.waitForTimeout(400);
        if ((await page.evaluate(() => window.__fetched.length)) !== 1) fail(name, 'the same broadcast is not played twice');
        out(`ok ${name} listener (audio ${L0.state})`);
      } catch (e) {
        fail(name, 'stopped', String(e && e.message || e).split('\n')[0]);
        await page.screenshot({ path: `${input.shots}/${name}-stopped.png` }).catch(() => {});
      }
      if (errors.length) fail(name, 'page and console errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await browser.close(); }
  process.exit(bad ? 1 : 0);
})().catch((e) => { out('FAIL ' + String(e && e.stack || e)); process.exit(1); });
