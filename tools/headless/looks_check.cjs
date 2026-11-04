// looks_check.py's browser half: each Look from its page, Home at three sizes, Undo; then Layout + Look in the editor.
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const deepJs = 'const deep=(r,s)=>[...r.querySelectorAll("*")].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);';
(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
  const say = (ok, what, got) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + what + (ok ? '' : '  got ' + JSON.stringify(got))); };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    await ctx.addCookies([{ name: 'mantel_session', value: input.cookie, url: input.origin }]);
    await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message); });
    const settings = async (hash) => {
      await page.goto(input.origin + '/settings#' + hash);
      await page.waitForFunction(new Function(deepJs + 'return deep(document,"hk-settings-panel").some(p=>p.data&&p.data.boards);'), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
    };
    const click = (fk) => page.evaluate(new Function('fk', deepJs + 'const b=deep(document,"[data-fk=\\""+fk+"\\"]")[0]; if(!b) return false; b.click(); return true;'), fk);
    const confirmOk = () => page.evaluate(new Function(deepJs + 'const d=deep(document,".dlg .db button.bold, .dlg .db button.red")[0]; if(!d) return false; d.click(); return true;'));
    const board = () => page.evaluate(new Function('s', deepJs + 'const p=deep(document,"hk-settings-panel")[0]; return p.data.boards[s];'), input.screen);
    await settings('/screens/' + input.screen + '/looks');
    const rows = await page.evaluate(new Function(deepJs + 'return deep(document,"a.cell.look").length;'));
    say(rows === input.looks.length, 'the Looks page lists every Look', rows);
    if (input.shots) await page.screenshot({ path: input.shots + '/looks-page.png' });
    for (const id of input.looks) {
      await settings('/screens/' + input.screen + '/looks/' + id);
      const said = await page.evaluate(new Function(deepJs + 'return deep(document,".cell").map(c=>c.textContent).filter(t=>t.indexOf("→")>=0).length;'));
      say(said > 0, id + ': its page says what changes', said);
      if (input.shots && id === 'homeview') await page.screenshot({ path: input.shots + '/look-' + id + '-page.png' });
      say(await click('look:apply'), id + ': Use', null);
      await page.waitForTimeout(1500);
      const b = await board();
      say(b && b.look_undo && b.look_undo.look === id, id + ': applied, its Undo kept', b && b.look_undo);
      for (const [w, hh] of [[1180, 820], [820, 1180], [390, 844]]) {
        await page.setViewportSize({ width: w, height: hh });
        await page.goto(input.origin + '/' + input.screen + '/home');
        await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
        await require('./grid_ready.cjs')(page);
        await page.waitForTimeout(2200);
        const wears = await page.evaluate(() => document.documentElement.getAttribute('data-hk-glass'));
        if (w === 1180) say(wears === input.glass[id], id + ': Home wears its look (' + input.glass[id] + ')', wears);
        if (input.shots) await page.screenshot({ path: input.shots + '/look-' + id + '-' + w + 'x' + hh + '.png' });
      }
      await page.setViewportSize({ width: 1180, height: 820 });
      await settings('/screens/' + input.screen + '/looks');
      say(await click('looks:undo'), id + ': Undo offered', null);
      await page.waitForTimeout(300);
      await confirmOk();
      await page.waitForTimeout(1500);
      const after = await board();
      say(after && !after.look_undo, id + ': undone', after && after.look_undo);
    }
    // LAYOUT + LOOK in the editor: the layout and the settings in one Save
    await settings('/screens/' + input.screen + '/home-grid');
    await page.waitForTimeout(1500);
    const opened = await page.evaluate(new Function(deepJs + 'const e=deep(document,"hk-grid-editor")[0]; if(!e) return false; e.screenSettingsOpen=true; e.side(); const b=e.shadowRoot.querySelector("[data-look=\\"homeview\\"]"); if(!b) return false; b.click(); return true;'));
    say(opened, 'the editor offers Layout + Look', opened);
    await page.waitForTimeout(400);
    await confirmOk();
    await page.waitForTimeout(2500);
    const draft = await page.evaluate(new Function(deepJs + 'const e=deep(document,"hk-grid-editor")[0]; return {cell: e.grid && e.grid.cell, items: e.grid && e.grid.items.length, look: !!e.lookChange};'));
    say(draft.cell === 'square' && draft.items > 0 && draft.look, 'HomeView\'s layout in the draft, its settings waiting for Save', draft);
    await page.evaluate(new Function(deepJs + 'return deep(document,"hk-grid-editor")[0].save();'));
    await page.waitForTimeout(2000);
    const saved = await board();
    say(saved && saved.home_grid && saved.home_grid.cell === 'square' && saved.glass === 'bright' && saved.look_undo && saved.look_undo.look === 'homeview' &&
        'home_grid' in saved.look_undo.was, 'Save writes the layout, the settings and an Undo that keeps the layout before', saved && { cell: saved.home_grid && saved.home_grid.cell, glass: saved.glass, undo: saved.look_undo && Object.keys(saved.look_undo.was) });
    await page.goto(input.origin + '/' + input.screen + '/home');
    await page.waitForFunction(() => window.__mantelReady === true, null, { timeout: 30000 });
    await require('./grid_ready.cjs')(page);
    await page.waitForTimeout(2500);
    if (input.shots) await page.screenshot({ path: input.shots + '/layout-look-homeview.png' });
    say(!errors.length, 'no page errors', errors.slice(0, 3));
  } finally { await browser.close(); }
  console.log(fails ? 'FAIL: ' + fails : 'looks: all checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
