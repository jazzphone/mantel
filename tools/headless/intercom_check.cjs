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
    // (a row that scrolls sideways -- the groups on a short screen -- holds what is past its edge until it is scrolled)
    const row = e.closest('.chips');
    if (row && getComputedStyle(row).overflowX === 'auto') return;
    const q = e.getBoundingClientRect(), b = sh.getBoundingClientRect();
    if (q.width && (q.left < b.left + 4 || q.right > b.right - 4)) over.push(e.className);
  });
  const q = (sel) => [...root.querySelectorAll(sel)].filter((e) => !e.closest('[hidden]'));
  const cut = [];
  const frame = hkd && hkd.querySelector('.body');
  if (frame) root.querySelectorAll('.talk .mb, .talk .wd, .talk .mt, .talk .line, .talk .rv button, .talk .seg').forEach((e) => {
    const q = e.getBoundingClientRect(), b = frame.getBoundingClientRect();
    if (q.height && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && q.bottom > b.bottom + 1) cut.push(e.className || e.tagName);
  });
  return {
    cut: [...new Set(cut)],
    sheet: r ? [r.left | 0, r.top | 0, r.width | 0, r.height | 0] : null,
    inside: !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    small: [...new Set(small)], over: [...new Set(over)],
    line: text('.line'), mic: root.querySelector('.mic') && root.querySelector('.mic').getAttribute('data-kind'), micHidden: root.querySelector('.mic').hidden,
    micLabel: root.querySelector('.mb').getAttribute('aria-label'), time: text('.mt'), word: text('.wd'), count: text('.cnt'),
    clear: root.querySelector('.clr') && root.querySelector('.clr').getAttribute('aria-disabled'),
    buttons: q('.rv button').map((b) => b.textContent), seg: q('.seg button').map((b) => b.textContent + (b.classList.contains('sel') ? '*' : '')),
    chips: q('.chips .pill').map((p) => p.querySelector('.l b').textContent.trim() + (p.getAttribute('aria-pressed') === 'true' ? '*' : '') + (p.classList.contains('preset') ? '~' : '')),
    // name, * picked, + a glyph, [the muted second line]
    pills: q('.rooms .pill').map((p) => p.querySelector('.l b').textContent.trim() + (p.getAttribute('aria-pressed') === 'true' ? '*' : '') + (p.querySelector('.pi') ? '+' : '') + (p.querySelector('.l i') ? '[' + p.querySelector('.l i').textContent + ']' : '')),
    // a row of pills that stops short of the section's edge is an orphan gap; so is a big empty area under the foot
    // every room one width and one height (one grid: the last row simply ends short); the groups one height
    sizes: [...new Set(q('.rooms .pill').map((p) => { const r = p.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }))],
    chipHeights: [...new Set(q('.chips .pill').map((p) => Math.round(p.getBoundingClientRect().height)))],
    cols: new Set(q('.rooms .pill').map((p) => Math.round(p.getBoundingClientRect().left))).size,
    // a big empty area under the content (the lower of the talk side and the rooms)
    slack: sh ? Math.round(sh.getBoundingClientRect().bottom - Math.max(root.querySelector('.talk').getBoundingClientRect().bottom, root.querySelector('.pick').getBoundingClientRect().bottom)) : null,
    // the talk side and the rooms: beside each other, or one over the other
    // a room's name too long for its pill ends in "…", never cut off (2026-11-07)
    clipped: q('.rooms .pill .l b').filter((b) => b.scrollWidth > b.clientWidth + 1 && getComputedStyle(b).textOverflow !== 'ellipsis').map((b) => b.textContent),
    ellipsed: q('.rooms .pill .l b').filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent),
    side: (() => { const a = root.querySelector('.talk').getBoundingClientRect(), b = root.querySelector('.pick').getBoundingClientRect(); return b.left >= a.right - 1 ? 'beside' : 'below'; })(),
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
      const shot = (what) => page.screenshot({ path: `${input.shots}/${input.tag || ''}${name}-${what}.png` });
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
        // ---- a page without the block costs the Intercom nothing: no file, no module, no feed -- until `#intercom` is on the address
        {
          const asked = [], frames = [];
          const onReq = (r) => asked.push(new URL(r.url()).pathname);
          const onSocket = (ws) => ws.on('framesent', (f) => { if (typeof f.payload === 'string' && /intercom/.test(f.payload)) frames.push(f.payload); });
          page.on('request', onReq); page.on('websocket', onSocket);
          await page.goto(`${input.origin}/${input.plain}/home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForFunction(() => window.__mantelReady === true && !!window.hkDetail, null, { timeout: 40000 });
          await page.waitForTimeout(1500);
          const quiet = await page.evaluate(() => ({ card: !!window.hkIntercom, mic: !!window.hkMic }));
          const early = asked.filter((u) => /hk-intercom\.js|hk-mic\.js/.test(u));
          if (quiet.card || quiet.mic || early.length) fail(name, 'a page without the block loads no Intercom code', { quiet, early });
          if (frames.length) fail(name, 'a page without the block never asks the Intercom feed', frames);
          // ...and the address brings it in, on this page, the way the app's menu button does
          await page.evaluate(() => { location.hash = '#intercom'; });
          await page.waitForFunction(() => !!window.hkIntercom, null, { timeout: 15000 }).catch(() => {});
          await page.evaluate(DEEP);
          await page.waitForFunction(() => deep(document, 'hk-intercom-sheet-card').length > 0 && !!window.hkMic, null, { timeout: 15000 })
            .catch(async () => fail(name, '#intercom opens the sheet on any page, with its microphone module', await page.evaluate(() => ({ card: !!window.hkIntercom, mic: !!window.hkMic, hash: location.hash }))));
          const late = asked.filter((u) => /hk-intercom\.js|hk-mic\.js/.test(u)).map((u) => u.split('/').pop());
          if (late.join() !== 'hk-intercom.js,hk-mic.js') fail(name, 'the address loads the card file, then the microphone module', late);
          page.off('request', onReq); page.off('websocket', onSocket);
          out(`ok ${name} costs nothing where it is not used`);
        }
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
                   name: s.querySelector('.name').textContent, box: [r.width | 0, r.height | 0], aria: s.querySelector('.k').getAttribute('aria-label') };
        }));
        const S = blocks.find((b) => b.size === 'S'), W = blocks.find((b) => b.size === 'W');
        if (!S || !W) fail(name, 'both blocks drawn', blocks);
        else {
          if (!/^Living Room(, Kitchen| \+1)$/.test(S.state)) fail(name, 'the Small block names the rooms last picked: whole names, then +N', S);
          if (!/^Living Room(, Kitchen| \+1)$/.test(W.state)) fail(name, 'the Wide block names them on its second line too, as the Small one does (no chips: one Wide tile)', W);
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
        if (m.cut.length) fail(name, 'the talk side fits the sheet: nothing cut off at the bottom', m.cut);
        if (m.clipped.length) fail(name, 'a long room name ends in an ellipsis, never cut off', m.clipped);
        if (m.scrollX > 1) fail(name, 'no sideways scroll', m.scrollX);
        if (m.seg.length) fail(name, 'Live is hidden unless the feed allows it', m.seg);
        if (m.chips.join('|') !== 'Whole House|Main Floor|Upstairs|Dinner~|Quiet Rooms~') fail(name, 'the chips: Whole House, floors, presets (one equal to the whole house, one to a floor, left out)', m.chips);
        if (m.sizes.length !== 1) fail(name, 'every room is the same width and height', m.sizes);
        if (m.chipHeights.length !== 1) fail(name, 'every group is the same height', m.chipHeights);
        if (m.count !== '2 of 8' || m.clear !== 'false') fail(name, 'the count and Clear All', [m.count, m.clear]);
        if (m.word !== 'Tap to Talk') fail(name, 'the talk button says Tap to Talk', m.word);
        out(`ok ${name} the rooms are ${m.side} the talk button` + (m.ellipsed.length ? ` (with "…": ${m.ellipsed.join(', ')})` : ''));
        if (m.slack > 80) fail(name, 'the sheet is as tall as its content: no big empty area', m.slack);
        if (m.dashed.some((d) => d !== 'dashed')) fail(name, 'presets have a dashed border', m.dashed);
        if (m.pills.join('|') !== 'Living Room*|Kitchen*|Dining Room[Plays with Office]|Office[Plays with Dining Room]|Bedroom+[Quiet hours]|Guest Room|Nursery|Craft Room|Primary Suite HomePods|Laundry Room') fail(name, 'the room pills, picked ones marked; a group leader says who it plays with; no bare slash', m.pills);
        if (m.touchAction !== 'none') fail(name, 'touch-action:none on the microphone', m.touchAction);
        if (m.line !== 'Living Room, Kitchen') fail(name, 'the status line names the rooms', m.line);
        await shot('picker');
        out(`ok ${name} sheet opened and picker (${m.sheet.join('x')})`);

        // ---- the picker with a finger
        await sheetTap('.chips .pill', 0);                                  // Whole House
        m = await page.evaluate(MEASURE);
        if (m.pills.filter((p) => p.includes('*')).length !== 8) fail(name, 'Whole House picks the eight rooms that can be', m.pills);
        await sheetTap('.chips .pill', 0);
        m = await page.evaluate(MEASURE);
        if (m.pills.some((p) => p.includes('*'))) fail(name, 'Whole House again puts them back', m.pills);
        await sheetTap('.chips .pill', 3);                                  // Dinner
        m = await page.evaluate(MEASURE);
        if (m.pills.filter((p) => p.includes('*')).map((p) => p.replace(/[*+]|\[.*\]/g, '')).join() !== 'Kitchen,Dining Room') fail(name, 'a preset picks its rooms', m.pills);
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

        // ---- Message: record, stop (it sends: rooms are picked), back to Tap to Talk, play, send again
        const micIs = (kind) => page.waitForFunction((k) => deep(document, 'hk-intercom-sheet-card')[0].shadowRoot.querySelector('.mic').getAttribute('data-kind') === k, kind, { timeout: 8000 });
        await page.evaluate(() => { window.__log = []; });
        await sheetTap('.mb');
        await micIs('rec');
        await page.waitForTimeout(900);
        m = await page.evaluate(MEASURE);
        if (!/^Tap to send · 0:\d\d left$/.test(m.time || '')) fail(name, 'the time left is counted', m.time);
        if (!/^0:\d\d$/.test(m.word || '')) fail(name, 'the big word is the time recorded', m.word);
        await shot('sheet-message');
        await page.evaluate(() => __intercomFake.mic().speak(7));
        await sheetTap('.mb');
        await lineIs(/^Sent to 2 rooms$/);
        m = await page.evaluate(MEASURE);
        if (m.micHidden || m.word !== 'Tap to Talk') fail(name, 'after a send: straight back to Tap to Talk', [m.micHidden, m.word]);
        if (m.buttons.join() !== 'Play,Send Again') fail(name, 'after a send: Play and Send Again under it', m.buttons);
        if (m.cut.length) fail(name, 'after a send: nothing on the talk side cut off', m.cut);
        if (m.small.length) fail(name, 'every button at least 44', m.small);
        await shot('sheet-sent');
        await sheetTap('.rv button', 0);                                    // Play
        m = await page.evaluate(MEASURE);
        if (m.buttons[0] !== 'Stop') fail(name, 'Play becomes Stop', m.buttons);
        await sheetTap('.rv button', 0);
        await sheetTap('.rv button', 1);                                    // Send Again
        await lineIs(/^Sent to 2 rooms$/);
        out(`ok ${name} message: record, send, back to Tap to Talk, play, send again`);

        // ---- Clear All, then a recording with no room: the review (Send waits for a room), re-record, cancel
        await sheetTap('.clr');
        m = await page.evaluate(MEASURE);
        if (m.count !== '0 of 8' || m.clear !== 'true' || m.pills.some((x) => x.includes('*'))) fail(name, 'Clear All picks nothing', [m.count, m.clear, m.pills]);
        await sheetTap('.mb');
        await micIs('rec');
        await page.evaluate(() => __intercomFake.mic().speak(5));
        await sheetTap('.mb');
        await page.waitForFunction(() => deep(document, 'hk-intercom-sheet-card')[0].shadowRoot.querySelectorAll('.rv button').length > 0, null, { timeout: 5000 });
        m = await page.evaluate(MEASURE);
        if (m.buttons.join() !== 'Send,Play,Re-record,Cancel' || !m.micHidden) fail(name, 'with no room picked: the review', [m.buttons, m.micHidden]);
        await shot('sheet-review');
        await sheetTap('.rv button', 2);                                    // Re-record
        await micIs('rec');
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
        out(`ok ${name} Clear All, the review, re-record, cancel, pointercancel`);
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
        if (m.cut.length) fail(name, 'Live: nothing on the talk side cut off', m.cut);
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
          hkIntercom.listen();                       // (what the shim does at a wall tablet whose feed says `listener`)
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

        // ---- Edit mode: both blocks drawn with their editor's covers on, the dashed splits filled (a shot of it)
        await page.goto(`${input.origin}/${input.screen}/home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForFunction(() => window.__mantelReady === true && window.hkEdit && window.hkEditGrid && window.hkTabBar && !!window.hkIntercom, null, { timeout: 40000 });
        await require('./grid_ready.cjs')(page);
        await page.evaluate(DEEP);
        await page.evaluate(() => __intercomFake.install({ mem: { mode: 'message', rooms: ['media_player.living_room', 'media_player.kitchen'] }, firstUse: false }));
        await page.waitForFunction(() => !!window.hkGridEditor, null, { timeout: 20000 });
        await page.waitForTimeout(1500);
        const at = (js) => page.evaluate(js);
        const mid = (sel) => at(`(() => { const sr = document.getElementById('hk-tabbar').shadowRoot, e = sr.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        let p = await mid('.tab[data-t="more"]');
        if (!p) fail(name, 'a More tab to start Edit from');
        else {
          await page.mouse.click(p.x, p.y); await page.waitForTimeout(500);
          p = await mid('.sheet.open .it[data-k="e"]');
          if (!p) fail(name, 'Edit offered in More');
          else {
            await page.mouse.click(p.x, p.y);
            await page.waitForFunction(() => !!hkEdit.active() && !!hkEditGrid.active() && hkEditGrid.active().ready, null, { timeout: 10000 });
            await page.waitForTimeout(1200);
            const ed = await page.evaluate(() => deep(document, 'hk-intercom-card').map((c) => { const r = c.getBoundingClientRect(), k = c.shadowRoot.querySelector('.k').getBoundingClientRect(); return { w: c.getAttribute('size'), box: [r.width | 0, r.height | 0], k: [k.width | 0, k.height | 0] }; }));
            if (ed.length !== 2 || ed.some((b) => b.k[0] < 40)) fail(name, 'both blocks drawn in Edit mode', ed);
            await shot('edit');
            out(`ok ${name} edit mode`);
          }
        }
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
