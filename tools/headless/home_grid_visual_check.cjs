const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async()=>{
  const input=JSON.parse(fs.readFileSync(0,'utf8'));
  const browser=await pw[input.engine].launch({headless:true,timeout:15000,...(input.browser?{executablePath:input.browser}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addCookies([{name:'mantel_session',value:input.cookie,url:input.origin}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===input.origin?route.continue():route.abort());
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
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
          const dots=p.shadowRoot.querySelector('.pc').getBoundingClientRect();
          if(Math.abs((dots.left+dots.right-b.left-b.right)/2)>1)issues.push('page dots are not centred '+cell.dataset.id);
          for(const slot of p._slots){let r=slot.getBoundingClientRect();if(r.right<b.left+5||r.left>b.right-5)continue;
            for(const button of all(slot,'.segment,.tb')){let br=button.getBoundingClientRect();for(const dot of p._dots){let d=dot.getBoundingClientRect();if(br.left<d.right&&br.right>d.left&&br.top<d.bottom&&br.bottom>d.top)issues.push('dots cover control '+cell.dataset.id);}}
          }
        }
        const rooms=card.localName==='hk-grid-room-card'?[card]:all(card,'hk-grid-room-card');
        for(const room of rooms){
          const tiles=room.shadowRoot.querySelector('.tiles'),cs=getComputedStyle(tiles);
          const rows=cs.gridTemplateRows.split(' ').filter(Boolean);
          const expected=room._size()==='W'?1:2;
          if(rows.length!==expected)issues.push('room lost its reserved rows '+cell.dataset.id);
          const slot=tiles.querySelector('.slot');
          if(slot&&Math.abs(slot.getBoundingClientRect().height/ view._gridScale-parseFloat(rows[0]))>1)issues.push('room accessory stretches into an empty row');
          for(const tile of room._kids||[]){
            const well=tile.shadowRoot?.querySelector('.well'),icon=tile.shadowRoot?.querySelector('.icon');
            if(well&&Math.abs(parseFloat(getComputedStyle(well).width)-42)>0.1)issues.push('room accessory lost its standard icon well');
            if(well&&icon){const a=well.getBoundingClientRect(),b=icon.getBoundingClientRect();if(b.width>a.width+1||b.height>a.height+1)issues.push('room glyph exceeds its circle');}
          }
        }
        const thermostats=card.localName==='hk-control-card'?[card]:all(card,'hk-control-card');
        for(const thermostat of thermostats.filter(t=>t._domain()==='climate')) {
          const surface=thermostat.shadowRoot.querySelector('.surface');
          if(surface.localName!=='hk-plate')issues.push('thermostat is missing the shared plate');
          const room=all(view.shadowRoot,'hk-grid-room-card')[0];
          if(room){const a=getComputedStyle(surface),r=getComputedStyle(room.shadowRoot.querySelector('.room'));if(a.backgroundColor!==r.backgroundColor||a.backgroundImage!==r.backgroundImage)issues.push('thermostat appearance differs from the room plate');}
        }
        const groups=card.localName==='hk-scenes-card'?[card]:all(card,'hk-scenes-card');
        for(const group of groups) for(const tile of group._tiles||[]) {
          const plate=tile.shadowRoot.querySelector('hk-plate.card');
          if(plate && Math.abs(plate.getBoundingClientRect().height-tile.getBoundingClientRect().height)>1)issues.push('scene pill does not fill its group row');
        }
        const players=card.localName==='hk-now-playing-card'?[card]:all(card,'hk-now-playing-card');
        for(const player of players.filter(p=>p.getAttribute('size')==='L')) {
          const art=player.shadowRoot.querySelector('.art').getBoundingClientRect();
          const title=player.shadowRoot.querySelector('.title').getBoundingClientRect();
          const byline=player.shadowRoot.querySelector('.player').getBoundingClientRect();
          if(Math.abs((art.top+art.bottom)/2-(title.top+byline.bottom)/2)>1)issues.push('album art and track metadata are not centred together');
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
    // Different displays may change only the whole-canvas scale, never tile proportions.
    for(const [width,height] of [[1920,1080],[1024,768],[800,1280],[390,844]]) {
      await page.setViewportSize({width,height});
      await page.waitForTimeout(100);
      const issue=await page.evaluate(()=>{
        const all=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?all(e.shadowRoot):[])]);
        const v=all(document).find(e=>e.localName==='hk-home-grid-view'),s=v._gridScale;
        const bounds=v.getBoundingClientRect(),root=v._root.getBoundingClientRect();
        if(root.left<bounds.left-1||root.right>bounds.right+1||root.top<bounds.top-1||root.bottom>bounds.bottom+1)return 'canvas exceeds viewport';
        for(const cell of v.shadowRoot.querySelectorAll('.cell')) {
          const dims=window.hkCards.HOME_GRID.sizes[cell.getAttribute('size')],r=cell.getBoundingClientRect();
          if(Math.abs(r.width/s-(196*dims[0]+10*(dims[0]-1)))>1||Math.abs(r.height/s-(150*dims[1]+10*(dims[1]-1)))>1)return 'tile proportions changed';
        }
        return null;
      });
      if(issue)throw new Error(screen+' '+width+'x'+height+': '+issue);
    }
    await page.setViewportSize({width:1280,height:800});
    await page.waitForTimeout(100);
    // The narrow mode affordance opens the shared sheet, without issuing a command.
    const mode=page.locator('hk-control-card[size=T] [data-tstat-details]').first();
    if(!await mode.count())throw new Error('missing T thermostat mode button');
    {
      await mode.click();
      await page.waitForFunction(()=>!!document.querySelector('.hkd [role=dialog]'));
    }
    if(screen===input.screens[0]) {
      const fallback=await page.evaluate(async()=>{
        const C=window.hkCards,port=Object.assign({},C.client(),{states:{'person.fictional':{entity_id:'person.fictional',state:'home',attributes:{friendly_name:'Avery Fixture',entity_picture:'/missing-fictional-portrait.png'}}}});
        const card=C.createCard({type:'custom:hk-people-card'},C.previewClient(port));
        Object.assign(card.style,{position:'fixed',width:'402px',height:'150px'});document.body.appendChild(card);
        await new Promise(resolve=>setTimeout(resolve,150));
        const ok=card.shadowRoot.querySelector('.av')?.textContent==='AF';card.remove();return ok;
      });
      if(!fallback)throw new Error('broken portrait did not fall back to initials');
      const wide=await page.evaluate(async()=>{
        const C=window.hkCards,card=C.createCard({type:'custom:hk-grid-room-card',area:'dining_room'},C.client());
        card.setAttribute('size','XXL');
        Object.assign(card.style,{position:'fixed',width:'1226px',height:'310px'});
        document.body.appendChild(card);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const tiles=card.shadowRoot.querySelector('.tiles'),cs=getComputedStyle(tiles);
        const ok=cs.gridTemplateColumns.split(' ').length===6&&cs.gridTemplateRows.split(' ').length===2;
        card.remove();return ok;
      });
      if(!wide)throw new Error('full-width room did not reserve six columns and two rows');
    }
    if(report.issues.length)process.exitCode=1;
  }
  if(commandCalls){console.log(JSON.stringify({unexpectedCommands:commandCalls}));process.exitCode=1;}
  if(errors.length){console.log(JSON.stringify({errors}));process.exitCode=1;}
  await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
