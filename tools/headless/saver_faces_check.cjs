// saver_faces_check.py's browser half: each HomeView-style face on a page of its own, in WebKit, at each size.
const assert = require('assert/strict');
const path = require('path');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));

const SIZES = [[1180, 820], [820, 1180], [390, 844]];
// what a face is handed: a fictional house's weather, its music, the sun, an air-quality sensor
const STATES = {
  'weather.home': { entity_id: 'weather.home', state: 'partlycloudy', attributes: { temperature: 54, temperature_unit: '°F', humidity: 76, wind_speed: 7, wind_speed_unit: 'mph' } },
  'media_player.kitchen': { entity_id: 'media_player.kitchen', state: 'playing', last_changed: '2026-10-30T09:00:00Z', attributes: { media_title: 'Late Light', media_artist: 'The Harbor Quartet' } },
  'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { next_setting: '2026-10-30T17:52:00' } },
  'sensor.air_quality': { entity_id: 'sensor.air_quality', state: '21', attributes: { device_class: 'aqi' } }
};
// [name, how it is drawn]
const FACES = [['glance', 'show'], ['month', 'show'], ['day', 'show'], ['day-dark', 'show'], ['weather', 'show'],
               ['liquid', 'clock'], ['giant', 'clock'], ['scattered', 'clock'], ['giant-blue', 'clock'],
               ['tb-left', 'photo'], ['tb-centre', 'photo'], ['tb-right', 'photo'], ['tb-big', 'photo'], ['tb-plain', 'photo']];

async function draw(page, name, how, made) {
  return page.evaluate(({ name, how, made, STATES }) => {
    const client = { states: STATES, config: { location_name: 'Home' } };
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0';
    document.body.appendChild(box);
    if (how === 'show') {
      const kind = name.replace(/-dark$/, '');
      if (kind === 'weather') box.style.background = 'linear-gradient(#2f74ba,#4f93cf 60%,#a7d2ef)';   // the forecast's sky, stood in
      window.hkSaverFaces.mount(box, { kind, client, look: /dark/.test(name) ? 'dark' : 'light' });
    } else if (how === 'clock') {
      const [style, color] = name.split('-');
      window.hkSaverClock.mount(box, { style, color: color || '', bg: 'black', drift: false, client });
    } else {
      // the screensaver's own layers and CSS around a photo (hk-saver.js photoFaces)
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0';
      host.setAttribute('on', '');                // (the screensaver showing: its :host is see-through until then)
      box.appendChild(host);
      const root = host.attachShadow({ mode: 'open' }), st = document.createElement('style');
      st.textContent = window.hkSaver._.CSS;
      root.appendChild(st);
      const ph = document.createElement('div'), fg = document.createElement('img'), scrim = document.createElement('div');
      ph.className = 'ph top'; fg.className = 'fg'; scrim.className = 'phscrim';
      ph.append(fg, scrim);
      root.appendChild(ph);
      const which = name.slice(3), url = which === 'plain' ? '/fx/plain.jpg' : '/fx/photo-' + which + '.jpg';
      ph.style.setProperty('--fit', 'cover'); ph.style.setProperty('--pos', '50% 50%'); ph.style.setProperty('--zm', '1');
      fg.src = url;
      const item = { id: 'host/p', album: 'Lake Weekend', year: 2025 };
      if (which !== 'plain') item.depth = { mask: '/fx/mask-' + which + '.png' };
      window.hkSaver._.photoFaces(ph, { url, w: 1500, h: 1000, item }, { fit: { fit: 'cover' } }, window.hkSaver._.readCfg({ photo_titles: true, time_behind: true }));
    }
    return true;
  }, { name, how, made, STATES });
}

function measure() {
  const all = [...document.body.querySelectorAll('*')];
  const deep = (r) => [...r.querySelectorAll('*')].flatMap((e) => [e, ...(e.shadowRoot ? deep(e.shadowRoot) : [])]);
  const els = deep(document.body);
  const shown = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
  const tb = els.find((e) => e.classList && e.classList.contains('tb'));
  const tbt = els.find((e) => e.classList && e.classList.contains('tbt'));
  const t = tbt && tbt.getBoundingClientRect();
  return { n: all.length, shown: shown.length, sw: document.documentElement.scrollWidth, W: innerWidth, H: innerHeight,
           tb: tb ? tb.className : null, tbt: t ? { l: t.left, t: t.top, r: t.right, b: t.bottom, text: tbt.textContent } : null,
           text: document.body.innerText.slice(0, 200) };
}

(async () => {
  const browser = await pw.webkit.launch({ headless: true });
  let fails = 0;
  try {
    for (const [w, h] of SIZES) {
      for (const [name, how] of FACES) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(input.origin + '/');
        // (the card hub and host client hk-saver.js reads at load, stood in: no house here)
        await page.evaluate(() => { window.hkCards = { onClient: () => () => {}, client: () => null };
          window.hkHostClient = window.hkHostClient || { entry() {}, bridge() {} }; });
        for (const s of ['/hk/modules/hk-saverclock.js', '/hk/modules/hk-saverfaces.js', '/hk/cards/hk-weather.js'].concat(how === 'photo' ?
          ['/client/hk-client.js', '/client/hk-host-shell.js', '/hk/modules/hk-np-strip.js', '/hk/modules/hk-saver.js'] : [])) {
          await page.addScriptTag({ url: input.origin + s });
        }
        if (how === 'photo') await require('./grid_ready.cjs').saver(page);      // (hk-saver.js sets hkSaver once its parts have run)
        try {
          await draw(page, name, how, input.made);
          await page.waitForTimeout(how === 'photo' ? 1200 : 500);
          const m = await page.evaluate(measure);
          assert(m.shown > 2, name + ' draws something ' + JSON.stringify(m));
          assert(m.sw <= m.W + 1, name + ' never wider than the screen ' + JSON.stringify(m));
          if (how === 'photo') {
            // THE TIME'S ONE PLACE (2026-10-30): upper centre, the same on every photo -- in view, centred, its top
            // 6 % down -- and the subject over it only where it covers some of it: the person at the middle on a
            // tablet held either way, at the left and the right on one held sideways; one filling the top of the
            // frame, never (in front); a photo with no cut-out, in front
            assert(m.tbt.l >= -1 && m.tbt.r <= m.W + 1 && m.tbt.t >= -1, 'the time in view ' + JSON.stringify(m.tbt));
            assert(Math.abs((m.tbt.l + m.tbt.r) / 2 - m.W / 2) < 2, 'the time centred ' + JSON.stringify(m.tbt));
            assert(Math.abs(m.tbt.t - m.H * 0.06) < 2, 'the time 6 % down ' + JSON.stringify(m.tbt));
            const want = { centre: w >= 600 ? 'tb behind' : null, left: w > h ? 'tb behind' : null, right: w > h ? 'tb behind' : null,
                           big: 'tb front', plain: 'tb front' }[name.slice(3)];
            if (want) assert.equal(m.tb, want, name + ': ' + want);
            else assert(/^tb (behind|front)$/.test(m.tb), name + ' decided ' + m.tb);
          }
          assert.deepEqual(errors, [], name + ' page errors');
          if (input.shots) await page.screenshot({ path: path.join(input.shots, name + '-' + w + 'x' + h + '.png') });
          console.log('PASS ' + name + ' ' + w + 'x' + h + (m.tb ? ' (' + m.tb + ')' : ''));
        } catch (e) { fails++; console.log('FAIL ' + name + ' ' + w + 'x' + h + ': ' + e.message); }
        await ctx.close();
      }
    }
    // THE CLOCK BLOCK: each new face in every size it offers (196 x 150 cells, 10 apart), on its plate
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 });
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === input.origin ? r.continue() : r.abort());
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(input.origin + '/');
      await page.addScriptTag({ url: input.origin + '/hk/modules/hk-saverclock.js' });
      const got = await page.evaluate(() => {
        document.body.style.cssText = 'margin:0;background:linear-gradient(135deg,#6d4f7a,#c4687a);overflow:visible;position:relative;height:1100px';
        const SZ = { S: [196, 150], W: [402, 150], T: [196, 310], L: [402, 310], XL: [608, 310], XXL: [1226, 310] };
        let y = 10; const out = [];
        ['liquid', 'giant', 'scattered'].forEach((face) => {
          let x = 10, rowH = 0;
          ['S', 'W', 'T', 'L', 'XL'].forEach((k) => {
            const [w, h] = SZ[k], b = document.createElement('div');
            b.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:24px;overflow:hidden;background:rgba(255,255,255,.12)`;
            document.body.appendChild(b);
            window.hkSaverClock.mount(b, { style: face, bg: 'none', scrim: false, drift: false });
            const drawn = [...b.querySelectorAll('svg *, canvas')].some((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
            out.push([face, k, drawn]);
            x += w + 10; rowH = Math.max(rowH, h);
          });
          y += rowH + 10;
        });
        return out;
      });
      await page.waitForTimeout(500);
      const bad = got.filter((g) => !g[2]);
      if (bad.length || errors.length) { fails++; console.log('FAIL the Clock block: ' + JSON.stringify(bad) + ' ' + errors.join('; ')); }
      else console.log('PASS the Clock block: ' + got.length + ' faces drawn in their blocks');
      if (input.shots) await page.screenshot({ path: path.join(input.shots, 'clock-blocks.png') });
      await ctx.close();
    }
    // THE MOCK-UP's faces section, to compare by eye (the brief's page, when it is given)
    if (input.mock && input.shots) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto('file://' + input.mock);
      await page.waitForTimeout(1500);
      const el = await page.$('#m-faces');
      if (el) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(800); await el.screenshot({ path: path.join(input.shots, 'mock-faces.png') }); }
      await ctx.close();
    }
  } finally { await browser.close(); }
  if (fails) { console.log(fails + ' failed'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
