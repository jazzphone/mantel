const assert = require('assert/strict');
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => {
  const browser = await pw[input.engine].launch({headless:true});
  try {
    for (const [W,H] of input.sizes || [[1180,820],[1366,1024],[1920,1080],[820,1180],[390,844],[844,390]]) {
      const context = await browser.newContext({viewport:{width:W,height:H}});
      await context.addCookies([{name:'mantel_session',value:input.cookie,url:input.origin}]);
      await context.route('**/*', route => new URL(route.request().url()).origin === input.origin ? route.continue() : route.abort());
      const page = await context.newPage(), errors = [];
      page.on('pageerror',e=>{if(!/ResizeObserver loop|due to access control checks/.test(e.message))errors.push(e.message);});
      for (const side of ['left','right',...(W>H?['full']:[])]) {
        const width = W === 1366 ? 'wide' : W === 1180 ? 'narrow' : 'standard';
        const screen=side==='full'?'music-full':`music-${side}-${width}`;
        await page.goto(`${input.origin}/${screen}/home?hkglass=blur`);
        await page.waitForFunction(()=>window.__mantelReady && window.hkSaver && window.hkSidePane);
        await page.waitForTimeout(1300);
        if (side!=='full'&&W>H&&W>=1000) {
          await page.waitForFunction(()=>document.querySelector('hk-side-pane[mode="dash"]')?.shadowRoot.querySelectorAll('.qr').length > 0);
          const pane = () => page.evaluate(()=>{
            const p=document.querySelector('hk-side-pane[mode="dash"]'),r=p.shadowRoot,s=r.querySelector('.secs');
            const buttons=[...r.querySelectorAll('.trow button')].map(e=>{const b=e.getBoundingClientRect();return {l:b.left,r:b.right};});
            return {rows:r.querySelectorAll('.qr').length,scroll:s.scrollHeight-s.clientHeight,buttons,
              fit:getComputedStyle(r.querySelector('.artbg b.on')).backgroundSize};
          });
          const a=await pane();
          // EVERY PLAYER'S LOOK (player_look.js): no wells, the pause glyph's ink halfway between the bars
          await page.evaluate(fs.readFileSync(__dirname+'/player_look.js','utf8'));
          const pl=await page.evaluate(()=>playerLook(document.querySelector('hk-side-pane[mode="dash"]').shadowRoot,{bar:'.npp',pp:'.pp.big hk-icon',vol:'.vol input',buttons:'.trow button'}));
          assert(!pl.wells.length&&pl.above!==undefined&&Math.abs(pl.above-pl.below)<=3,'Side Pane player: '+JSON.stringify(pl));
          const mixed = await page.evaluate(()=>{
            const p=document.querySelector('hk-side-pane[mode="dash"]'),original=p._o.list;
            const before=p.shadowRoot.querySelectorAll('.qr').length;
            p._o.list=[{kind:'clock',size:'less'},...original.map(s=>({...s,place:'bottom'}))];p.redraw();
            const r=p.shadowRoot,s=r.querySelector('.secs'),m=r.querySelector('[data-k="now_playing"]');
            const result={before,after:r.querySelectorAll('.qr').length,size:m.dataset.size,clock:!!r.querySelector('[data-k="clock"]'),scroll:s.scrollHeight-s.clientHeight};
            p._o.list=original;p.redraw();return result;
          });
          assert(mixed.clock&&mixed.size==='more'&&mixed.after<mixed.before&&mixed.scroll<=1,JSON.stringify(mixed));
          assert.equal(a.fit,'cover');assert(a.scroll<=1,JSON.stringify(a));
          assert(a.buttons.every((b,i)=>!i||b.l-a.buttons[i-1].r>=8),JSON.stringify(a));
          await page.setViewportSize({width:W,height:H+240});await page.waitForTimeout(500);
          const b=await pane();assert(b.rows>a.rows,JSON.stringify([a,b]));assert(b.scroll<=1);
          await page.setViewportSize({width:W,height:H});await page.waitForTimeout(500);
          if(input.shots)await page.screenshot({path:`${input.shots}/${W}x${H}-${side}-player.png`});
          await page.locator('hk-side-pane[mode="dash"]').locator('.qh').click();
          await page.waitForTimeout(300);
          assert(await page.evaluate(()=>[...document.querySelectorAll('*')].some(e=>e.shadowRoot?.querySelector('.mpanel.dr [data-p="queue"]:not([hidden])'))));
          await page.evaluate(()=>{for(const e of document.querySelectorAll('*')){const s=e.shadowRoot?.querySelector('.mpanel.dr');if(s)s.parentNode.querySelector('.scrim').click();}});
          await page.waitForTimeout(800);
        }
        await require('./grid_ready.cjs').saver(page);
        await page.evaluate(()=>{window.hkSaver.preview(true);window.hkSaver._.music.show(true);});
        await page.waitForTimeout(4200);
        const slide=await page.evaluate(()=>{
          const host=document.querySelector('hk-screensaver'),r=host.shadowRoot,mu=r.querySelector('.mu'),box=s=>{
            const b=r.querySelector(s).getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,w:b.width,h:b.height};};
          const row=host.hasAttribute('murow');
          const transportBottom=Math.max(...[...mu.querySelectorAll('.mctl .mbtn,.mvol svg')].filter(e=>getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().height>0).map(e=>e.getBoundingClientRect().bottom));
          return {transportBottom,next:box('.mu .mnext'),row,up:host.hasAttribute('muup'),pane:host.hasAttribute('pane'),area:box('.mu .mbody'),art:box('.mu .mart'),col:box(row?'.mu .mstage':'.mu .mcol'),meta:box('.mu .mmeta'),album:box('.mu .malbum'),
            buttons:[...mu.querySelectorAll('.mbtn')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom};})};
        });
        if(slide.pane&&W<1900&&W>H)assert(slide.row||slide.up,JSON.stringify(slide));
        assert(Math.abs(slide.art.w-slide.art.h)<1,JSON.stringify(slide));
        for(const b of [slide.art,slide.col,...slide.buttons])assert(b.l>=slide.area.l-1&&b.r<=slide.area.r+1&&b.t>=slide.area.t-1&&b.b<=slide.area.b+1,JSON.stringify(slide));
        if(slide.up)assert(slide.art.b<=slide.col.t,JSON.stringify(slide));
        if(!slide.row&&!slide.up){
          assert(Math.abs(slide.transportBottom-slide.art.b)<1,JSON.stringify(slide));
          if(slide.next.h)assert(slide.next.t>slide.art.b+10,JSON.stringify(slide));
          if(W>=1000){
            const nextStates=await page.evaluate(()=>{
              const r=document.querySelector('hk-screensaver').shadowRoot,mu=r.querySelector('.mu'),hidden=mu.classList.contains('h-next'),out=[];
              for(const hide of [true,false]){
                mu.classList.toggle('h-next',hide);window.hkSaver._.music.layout();
                const art=mu.querySelector('.mart').getBoundingClientRect(),meta=mu.querySelector('.mmeta').getBoundingClientRect();
                const end=Math.max(...[...mu.querySelectorAll('.mctl .mbtn,.mvol svg')].filter(e=>getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().height>0).map(e=>e.getBoundingClientRect().bottom));
                out.push({delta:Math.abs(end-art.bottom),top:meta.top});
              }
              mu.classList.toggle('h-next',hidden);window.hkSaver._.music.layout();return out;
            });
            assert(nextStates.every(s=>s.delta<1)&&Math.abs(nextStates[0].top-nextStates[1].top)<1,JSON.stringify(nextStates));
          }
        }
        if(slide.row){
          assert(slide.art.r<slide.meta.l&&Math.abs(slide.art.t+slide.art.b-slide.meta.t-slide.meta.b)<2,JSON.stringify(slide));
          assert(slide.album.h>0,JSON.stringify(slide));
          const variants=await page.evaluate(()=>{
            const r=document.querySelector('hk-screensaver').shadowRoot,mu=r.querySelector('.mu'),title=mu.querySelector('.mtitle'),original=title.textContent;
            const roomHidden=mu.classList.contains('h-room'),albumHidden=mu.classList.contains('h-album');
            const out=[];
            for(const hide of [false,true]){
              title.textContent='A much longer song title that wraps onto a second line';mu.classList.toggle('h-room',hide);mu.classList.toggle('h-album',hide);
              window.hkSaver._.music.layout();
              const a=mu.querySelector('.mart').getBoundingClientRect(),m=mu.querySelector('.mmeta').getBoundingClientRect();
              out.push({delta:Math.abs(a.top+a.bottom-m.top-m.bottom),text:m.height,art:a.height});
            }
            title.textContent=original;mu.classList.toggle('h-room',roomHidden);mu.classList.toggle('h-album',albumHidden);window.hkSaver._.music.layout();return out;
          });
          assert(variants.every(v=>v.delta<2&&v.text<=v.art),JSON.stringify(variants));
        }
        const ink = await require('./corner_look.cjs')(page, 'hk-screensaver .scn .tl', input.python);
        const xs = ink.map(r=>r.left);
        assert(xs.length === 3 && xs.every(x=>x!==null) && Math.max(...xs)-Math.min(...xs)<=(ink.some(r=>parseFloat(r.font)<14)?2:1), 'slide corner ink aligned: '+JSON.stringify(ink));
        if(input.shots)await page.screenshot({path:`${input.shots}/${W}x${H}-${side}-slide.png`});
        await page.evaluate(fs.readFileSync(__dirname+'/player_look.js','utf8'));
        const sl=await page.evaluate(()=>playerLook(document.querySelector('hk-screensaver').shadowRoot.querySelector('.mu'),{bar:'.mbar',pp:'.mpp svg',vol:'.mvt',buttons:'.mctl .mbtn'}));
        assert(!sl.wells.length&&(sl.above===undefined||Math.abs(sl.above-sl.below)<=3),'music slide: '+JSON.stringify(sl));
        assert(!sl.volumeEdges || sl.volumeEdges.every(x=>Math.abs(x)<=1),'slide volume row ends aligned: '+JSON.stringify(sl));
        if(slide.row){
          const panel=await page.evaluate(()=>{
            window.hkSaver._.music.panel('slide','queue');
            const r=document.querySelector('hk-screensaver').shadowRoot.querySelector('.mpanel.up').getBoundingClientRect();
            const box={l:r.left,r:r.right,t:r.top,b:r.bottom};window.hkSaver._.music.panel(null);return box;
          });
          assert(panel.l>=slide.area.l&&panel.r<=slide.area.r&&panel.t>=slide.area.t&&panel.b<=slide.area.b,JSON.stringify(panel));
        }
        assert.deepEqual(errors,[]);
        console.log(`PASS ${input.engine} ${W}x${H} ${side}: artwork and music slide${side!=='full'&&W>H&&W>=1000 ? ", controls and adaptive queue" : ""}`);
      }
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
