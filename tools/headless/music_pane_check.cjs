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
            const buttons=[...r.querySelectorAll('.hks .mctl .mbtn')].map(e=>{const b=e.getBoundingClientRect();return {l:b.left,r:b.right};});
            const q=r.querySelector('.npqueue');return {rows:Math.round(q?q.getBoundingClientRect().height:0),scroll:s.scrollHeight-s.clientHeight,buttons,
              fit:getComputedStyle(r.querySelector('.artbg b.on')).backgroundSize};
          });
          const a=await pane();
          // EVERY PLAYER'S LOOK (player_look.js): no wells, the pause glyph's ink halfway between the bars
          await page.evaluate(fs.readFileSync(__dirname+'/player_look.js','utf8'));
          // (the Side Pane's player is the controls strip since 2026-11-09: hk-np-strip.js -- its keys, its slots for the
          // pane's own progress line and slider)
          const pl=await page.evaluate(()=>playerLook(document.querySelector('hk-side-pane[mode="dash"]').shadowRoot,{bar:'.npp',pp:'.mpp svg',vol:'.mvs input',buttons:'.hks .mbtn'}));
          assert(!pl.wells.length&&pl.above!==undefined&&Math.abs(pl.above-pl.below)<=3,'Side Pane player: '+JSON.stringify(pl));
          // THE TOUCH RULES, MEASURED (2026-11-09, the owner: a tap meant for play landed on the volume): every target 44 px,
          // play / pause the biggest, none overlapping, 12 px clear between the keys and the volume and the progress and the keys
          // (and the speaker line over the song, 44 px tall, 12 px clear -- the owner's mockup 12h, 2026-11-09)
          const ps=await page.evaluate(()=>{const r=document.querySelector('hk-side-pane[mode="dash"]').shadowRoot;
            return hkNpStrip.check(r.querySelector('.hks'),{min:44,line:r.querySelector('.np .hksl')});});
          assert(!ps.breaks.length&&ps.gapTV>=12&&ps.gapL>=12&&ps.targets.line[1]>=43.5,'Side Pane player strip: '+JSON.stringify(ps));
          console.log(`  Side Pane player (${side}): targets ${JSON.stringify(ps.targets)}, keys to volume ${ps.gapTV} px, progress to keys ${ps.gapPT} px`);
          const mixed = await page.evaluate(()=>{
            const p=document.querySelector('hk-side-pane[mode="dash"]'),original=p._o.list;
            const before=Math.round(p.shadowRoot.querySelector('.npqueue').getBoundingClientRect().height);
            p._o.list=[{kind:'clock',size:'less'},...original.map(s=>({...s,place:'bottom'}))];p.redraw();
            const r=p.shadowRoot,s=r.querySelector('.secs'),m=r.querySelector('[data-k="now_playing"]');
            const result={before,after:Math.round(r.querySelector('.npqueue')?.getBoundingClientRect().height||0),size:m.dataset.size,clock:!!r.querySelector('[data-k="clock"]'),scroll:s.scrollHeight-
              s.clientHeight};
            p._o.list=original;p.redraw();return result;
          });
          assert(mixed.clock&&mixed.size==='more'&&mixed.after<mixed.before&&mixed.scroll<=1,JSON.stringify(mixed));
          assert.equal(a.fit,'cover');assert(a.scroll<=1,JSON.stringify(a));
          assert(a.buttons.every((b,i)=>!i||b.l-a.buttons[i-1].r>=8),JSON.stringify(a));
          await page.setViewportSize({width:W,height:H+240});await page.waitForTimeout(500);
          const b=await pane();assert(b.rows>a.rows,JSON.stringify([a,b]));assert(b.scroll<=1);
          await page.setViewportSize({width:W,height:H});await page.waitForTimeout(500);
          if(input.shots)await page.screenshot({path:`${input.shots}/${W}x${H}-${side}-player.png`});
          // UP NEXT SCROLLS (2026-11-09, the owner: "the up next should scroll ... in all of the music players that show up next"):
          // every song (the 39 after the one playing) is in the box, which keeps the room it had (the pane does not scroll), the heading stays above, the
          // fade is on while more are below and off at the end, no scrollbar is drawn, and a wheel moves the rows
          const sc0=await page.evaluate(()=>{const r=document.querySelector('hk-side-pane[mode="dash"]').shadowRoot,qs=r.querySelector('.npqueue .qs'),cs=getComputedStyle(qs);
            const rows=[...qs.querySelectorAll('.qr')].map(e=>e.offsetHeight);
            return {n:rows.length,minH:Math.min(...rows),open:qs.scrollHeight>qs.clientHeight+10,more:qs.hasAttribute('more'),mask:cs.webkitMaskImage||cs.maskImage,bar:cs.scrollbarWidth,
              top:qs.scrollTop,
              head:r.querySelector('.npqueue .qh').getBoundingClientRect().top};});
          assert(sc0.n===39&&sc0.minH>=56&&sc0.open&&sc0.more&&/gradient/.test(sc0.mask)&&sc0.bar==='none'&&sc0.top===0,'Up Next list: '+JSON.stringify(sc0));
          const qbox=await page.locator('hk-side-pane[mode="dash"]').locator('.npqueue .qs').boundingBox();
          await page.mouse.move(qbox.x+qbox.width/2,qbox.y+qbox.height/2);await page.mouse.wheel(0,200);await page.waitForTimeout(400);
          const sc1=await page.evaluate(()=>{const r=document.querySelector('hk-side-pane[mode="dash"]').shadowRoot,qs=r.querySelector('.npqueue .qs');
            return {top:qs.scrollTop,head:r.querySelector('.npqueue .qh').getBoundingClientRect().top,page:r.querySelector('.secs').scrollTop};});
          assert(sc1.top>50&&sc1.head===sc0.head&&sc1.page===0,'Up Next scrolled: '+JSON.stringify(sc1));
          await page.screenshot({path:`${input.shots||'/tmp'}/${W}x${H}-${side}-player-scrolled.png`});
          await page.mouse.wheel(0,20000);
          // (at rest first: Chromium's wheel scrolls smoothly, still on its way down after 500 ms -- 2026-11-09, it failed on main one run in two)
          await page.waitForFunction(()=>{const q=document.querySelector('hk-side-pane[mode="dash"]').shadowRoot.querySelector('.npqueue .qs');
            return q.scrollTop>=q.scrollHeight-q.clientHeight-2;},null,{timeout:5000});
          await page.waitForTimeout(200);
          assert(await page.evaluate(()=>!document.querySelector('hk-side-pane[mode="dash"]').shadowRoot.querySelector('.npqueue .qs').hasAttribute('more')),'Up Next fade stays at the end');
          await page.evaluate(()=>{document.querySelector('hk-side-pane[mode="dash"]').shadowRoot.querySelector('.npqueue .qs').scrollTop=0;});
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
          const transportBottom=Math.max(...[...mu.querySelectorAll('.mctl .mbtn,.mvol svg')].filter(e=>getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().height>0).map(
            e=>e.getBoundingClientRect().bottom));
          return {transportBottom,next:box('.mu .mnext'),row,up:host.hasAttribute('muup'),pane:host.hasAttribute('pane'),area:box('.mu .mbody'),art:box('.mu .mart'),
            col:box(row?'.mu .mstage':'.mu .mcol'),meta:box('.mu .mmeta'),album:box('.mu .malbum'),
            buttons:[...mu.querySelectorAll('.mbtn:not(.mqr), .mq .mql')].filter(e=>e.getBoundingClientRect().width>0).map(
              e=>{const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom};})};
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
                const end=Math.max(...[...mu.querySelectorAll('.mctl .mbtn,.mvol svg')].filter(e=>getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().height>0).map(
                  e=>e.getBoundingClientRect().bottom));
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
          // UP NEXT SCROLLS ON THE SCREENSAVER (2026-11-09, the owner: "the up next should scroll ... in all of the music
          // players that show up next"): its views take no pointer events, so a drag over the rows is followed by place
          // (hk-saver.js): it moves the list, not the cover or the text, is not a tap on a row (the Queue stays shut), a
          // plain tap on a row still opens the Queue, and the fade is on while more are below
          const qa=await page.evaluate(()=>{
            const r=document.querySelector('hk-screensaver').shadowRoot,ql=r.querySelector('.mu .mq .mql');
            if(!ql||getComputedStyle(r.querySelector('.mu .mq')).display==='none')return null;
            const b=ql.getBoundingClientRect(),cs=getComputedStyle(ql),mu=r.querySelector('.mu'),meta=r.querySelector('.mu .mmeta').getBoundingClientRect(),
              art=r.querySelector('.mu .mart').getBoundingClientRect();
            return {x:b.left+b.width/2,y:b.top+Math.min(b.height-4,30),box:b.height,n:ql.children.length,open:ql.scrollHeight>ql.clientHeight+4,more:ql.hasAttribute('more'),mask:cs.webkitMaskImage||
              cs.maskImage,bar:cs.scrollbarWidth,
              minH:Math.min(...[...ql.children].map(e=>e.offsetHeight)),metaB:meta.bottom,artB:art.bottom,artH:art.height,over:cs.overscrollBehaviorY};
          });
          if(qa){
            assert(qa.n===40&&qa.open&&qa.more&&/gradient/.test(qa.mask)&&qa.bar==='none'&&qa.minH>=44&&qa.over==='contain'&&qa.metaB<=qa.artB+1,'saver Up Next: '+JSON.stringify(qa));
            if(input.shots)await page.screenshot({path:`${input.shots}/${W}x${H}-${side}-slide-queue.png`});
            // (once more where the first drag found no row: under a loaded machine's CI the slide can be laid out again
            // between the measure and the drag -- 2026-11-09, a full run read scrollTop 0 that passes alone)
            let qb;
            for(let tries=0;tries<2;tries++){
              await page.mouse.move(qa.x,qa.y);await page.mouse.down();
              for(let k=1;k<=8;k++){await page.mouse.move(qa.x,qa.y-k*12);await page.waitForTimeout(20);}
              await page.mouse.up();await page.waitForTimeout(300);
              qb=await page.evaluate(()=>{const r=document.querySelector('hk-screensaver').shadowRoot,ql=r.querySelector('.mu .mq .mql');
                return {top:ql.scrollTop,panel:!!r.querySelector('.mpanel'),art:r.querySelector('.mu .mart').getBoundingClientRect().height,
                  metaB:r.querySelector('.mu .mmeta').getBoundingClientRect().bottom};});
              if(qb.top>=60||qb.panel)break;
              await page.waitForTimeout(500);
            }
            assert(qb.top>=60&&!qb.panel&&Math.abs(qb.art-qa.artH)<1&&Math.abs(qb.metaB-qa.metaB)<1,'saver Up Next dragged: '+JSON.stringify([qa,qb]));
            if(input.shots)await page.screenshot({path:`${input.shots}/${W}x${H}-${side}-slide-queue-scrolled.png`});
            await page.mouse.move(qa.x,qa.y);await page.mouse.down();await page.mouse.move(qa.x,qa.y+3);await page.mouse.up();await page.waitForTimeout(500);
            assert(await page.evaluate(()=>!!document.querySelector('hk-screensaver').shadowRoot.querySelector('.mpanel [data-p="queue"]:not([hidden])')),'a tap on a row opens the Queue');
            await page.mouse.click(5,H-5);await page.waitForTimeout(2500);   // (a tap outside shuts the panel)
            assert(await page.evaluate(()=>!document.querySelector('hk-screensaver').shadowRoot.querySelector('.mpanel')),'the panel shut');
          }
        }
        const ink = await require('./corner_look.cjs')(page, 'hk-screensaver .scn .tl', input.python);
        const xs = ink.map(r=>r.left);
        // (a pixel either way, two where the fonts are small or the slide is drawn larger than its layout -- 1.26x at 1920 x
        // 1080, where text and the weather's icon round their antialiased edges to opposite screen pixels: under two of
        // the layout's pixels, 2026-11-07)
        const zoomed = W >= 1600;   // (the slide's scale past a 1280 x 800 layout: 1.26 at 1920 x 1080)
        assert(xs.length === 3 && xs.every(x=>x!==null) && Math.max(...xs)-Math.min(...xs)<=(ink.some(r=>parseFloat(r.font)<14)||zoomed?2:1), 'slide corner ink aligned: '+JSON.stringify(ink));
        if(input.shots)await page.screenshot({path:`${input.shots}/${W}x${H}-${side}-slide.png`});
        await page.evaluate(fs.readFileSync(__dirname+'/player_look.js','utf8'));
        const sl=await page.evaluate(()=>playerLook(document.querySelector('hk-screensaver').shadowRoot.querySelector('.mu'),{bar:'.mbar',pp:'.mpp svg',vol:'.mvt',buttons:'.mctl .mbtn'}));
        assert(!sl.wells.length&&(sl.above===undefined||Math.abs(sl.above-sl.below)<=3),'music slide: '+JSON.stringify(sl));
        assert(!sl.volumeEdges || sl.volumeEdges.every(x=>Math.abs(x)<=1),'slide volume row ends aligned: '+JSON.stringify(sl));
        // (the touch rules, measured -- hk-np-strip.js check: 44 px targets, nothing overlapping, 12 px clear round the keys)
        const ss=await page.evaluate(()=>{const r=document.querySelector('hk-screensaver').shadowRoot;return hkNpStrip.check(r.querySelector('.mu .hks'),{min:44,line:r.querySelector('.mu .hksl')});});
        assert(!ss.breaks.length&&(ss.gapTV===null||ss.gapTV>=12)&&ss.gapL>=12&&ss.targets.line[1]>=43.5,'music slide strip: '+JSON.stringify(ss));
        // (one margin: the column's to the left edge, the art's to the right, the gap between -- 2026-11-09, the owner)
        const mg=await page.evaluate(()=>((r) => { const q = s => r.querySelector(s), R = e => e.getBoundingClientRect(), body = R(q('.mu .mbody')), art = R(q('.mu .mart')), bar = R(q('.mu .mbar'));
      const st = q('.mu .mstage'), row = !!(st && getComputedStyle(st).display === 'grid'), k = (n) => Math.round(n * 10) / 10;
      if (row) return { row: true, left: k(art.left - body.left), right: k(body.right - bar.right), gap: k(R(q('.mu .mmeta')).left - art.right) };
      const col = R(q('.mu .mcol')); return { left: k(col.left - body.left), right: k(body.right - art.right), gap: k(art.left - col.right) }; })(document.querySelector('hk-screensaver').shadowRoot));
        if(!slide.up)assert(Math.abs(mg.left-mg.right)<=1&&Math.abs(mg.gap-mg.left)<=1,'music slide margins: '+JSON.stringify(mg));
        if(slide.row){
          const panel=await page.evaluate(()=>{
            window.hkSaver._.music.panel('slide','queue');
            const r=document.querySelector('hk-screensaver').shadowRoot.querySelector('.mpanel.up').getBoundingClientRect();
            const box={l:r.left,r:r.right,t:r.top,b:r.bottom};window.hkSaver._.music.panel(null);return box;
          });
          assert(panel.l>=slide.area.l&&panel.r<=slide.area.r&&panel.t>=slide.area.t&&panel.b<=slide.area.b,JSON.stringify(panel));
        }
        assert.deepEqual(errors,[]);
        console.log(`PASS ${input.engine} ${W}x${H} ${side}: artwork and music slide${side!=='full'&&W>H&&W>=1000 ? ", controls and adaptive queue" : ""}` +
                    ` (slide: targets ${JSON.stringify(ss.targets)}, keys to volume ${ss.gapTV} px, progress to keys ${ss.gapPT} px; margins ${JSON.stringify(mg)})`);
      }
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
