const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async()=>{
  const input=JSON.parse(fs.readFileSync(0,'utf8'));
  const browser=await pw[input.engine].launch({headless:true,timeout:15000,...(input.browser?{executablePath:input.browser}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addCookies([{name:'mantel_session',value:input.cookie,url:input.origin}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===input.origin?route.continue():route.abort());
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let commandCalls=0;
  page.on('websocket',ws=>ws.on('framesent',frame=>{try{const msg=JSON.parse(String(frame.payload));if(msg.type==='command')commandCalls++;}catch(e){}}));
  for (const screen of input.screens){
    await page.goto(input.origin+'/'+screen+'/home');
    await page.waitForFunction(()=>window.__mantelReady===true);
    await page.waitForTimeout(1500);
    const report=await page.evaluate(()=>{
      const all=(root,sel)=>[...root.querySelectorAll('*')].flatMap(e=>[...(e.matches(sel)?[e]:[]),...(e.shadowRoot?all(e.shadowRoot,sel):[])]);
      const view=all(document,'hk-home-grid-view')[0],issues=[];
      const band=view.shadowRoot.querySelector('.band');
      if(band){let b=band.getBoundingClientRect();for(const n of all(band,'[data-hk-clock=time],[data-hk-clock=date]')){let r=n.getBoundingClientRect();if(r.top<b.top-1||r.bottom>b.bottom+1)issues.push('band clip');}}
      if(band){
        const date=all(band,'[data-hk-clock=date]')[0],detail=all(band,'[data-hk-wx=detail]')[0];
        if(date&&detail&&detail.getBoundingClientRect().height){
          const ink=e=>{const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect();};
          if(Math.abs(ink(date).bottom-ink(detail).bottom)>1)issues.push('clock and weather captions are not aligned');
        }
      }
      for(const cell of view.shadowRoot.querySelectorAll('.cell')){
        const b=cell.getBoundingClientRect(),card=cell.firstElementChild;
        for(const p of (card.localName==='hk-pager-card'?[card]:all(card,'hk-pager-card'))) for(const slot of p._slots){if(Math.abs(slot.getBoundingClientRect().height-b.height)>1)issues.push('short page '+cell.dataset.id);}
        for(const p of (card.localName==='hk-pager-card'?[card]:[])){
          for(const slot of p._slots){let r=slot.getBoundingClientRect();if(r.right<b.left+5||r.left>b.right-5)continue;
            for(const button of all(slot,'.segment,.tb')){let br=button.getBoundingClientRect();for(const dot of p._dots){let d=dot.getBoundingClientRect();if(br.left<d.right&&br.right>d.left&&br.top<d.bottom&&br.bottom>d.top)issues.push('dots cover control '+cell.dataset.id);}}
          }
        }
        for(const r of all(card,'[data-ring]')){
          const face=r.parentElement.querySelector('[data-face]'),range=document.createRange();range.selectNodeContents(face);
          if(range.getBoundingClientRect().width>r.getBoundingClientRect().width*.62)issues.push('dial face crosses track '+cell.dataset.id);
        }
      }
      const scroll=document.scrollingElement;if(scroll.scrollHeight>innerHeight+1||scroll.scrollWidth>innerWidth+1)issues.push('page scroll');
      return {issues,cells:view.shadowRoot.querySelectorAll('.cell').length};
    });
    console.log(JSON.stringify({screen,...report}));
    if(input.shots){
      // Documentation images must not contain Apple's licensed fonts or glyphs.
      await page.evaluate(()=>{function visit(root){const style=document.createElement('style');style.textContent='*{font-family:Arial,sans-serif!important}';(root.head||root).appendChild(style);for(const e of root.querySelectorAll('*'))if(e.shadowRoot)visit(e.shadowRoot);}visit(document);});
      await page.screenshot({path:input.shots+'/'+screen+'-'+input.engine+'.png'});
    }
    const pager=page.locator('hk-pager-card').filter({has:page.locator('hk-grid-room-card')}).first();
    if(await pager.count()){
      const start=await pager.evaluate(p=>p._startIndex());
      await pager.locator('.dot').nth(1).click();
      await page.waitForFunction(()=>{const all=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?all(e.shadowRoot):[])]);return all(document).some(e=>e.localName==='hk-pager-card'&&e._index===1&&e._els.some(c=>c?.localName==='hk-grid-room-card'));});
      await page.evaluate(()=>window.dispatchEvent(new Event('hk-idle-return')));
      await page.waitForTimeout(400);
      if(await pager.evaluate(p=>p._index)!==start)throw new Error('room pager did not return on idle');
    }
    // The narrow mode affordance opens the shared sheet, without issuing a command.
    const mode=page.locator('hk-control-card[size=T] [data-tstat-details]').first();
    if(!await mode.count())throw new Error('missing T thermostat mode button');
    {
      await mode.click();
      await page.waitForFunction(()=>!!document.querySelector('.hkd [role=dialog]'));
    }
    if(report.issues.length)process.exitCode=1;
  }
  if(commandCalls){console.log(JSON.stringify({unexpectedCommands:commandCalls}));process.exitCode=1;}
  if(errors.length){console.log(JSON.stringify({errors}));process.exitCode=1;}
  await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
