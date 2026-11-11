const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async()=>{
  const input=JSON.parse(fs.readFileSync(0,'utf8'));
  if(input.homeview) return homeview(input);
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
    await require('./grid_ready.cjs')(page);
    await page.waitForTimeout(1500);
    const report=await page.evaluate(()=>{
      const all=(root,sel)=>[...root.querySelectorAll('*')].flatMap(e=>[...(e.matches(sel)?[e]:[]),...(e.shadowRoot?all(e.shadowRoot,sel):[])]);
      const view=all(document,'hk-home-grid-view')[0],issues=[];
      const band=view.shadowRoot.querySelector('.band');
      if(band){let b=band.getBoundingClientRect();for(const n of all(band,'[data-hk-clock=time],[data-hk-clock=date]')){let r=n.getBoundingClientRect();
        if(r.top<b.top-1||r.bottom>b.bottom+1)issues.push('band clip');}}
      if(band){
        const date=all(band,'[data-hk-clock=date]')[0],detail=all(band,'[data-hk-wx=detail]')[0];
        if(date&&detail&&detail.getBoundingClientRect().height){
          const ink=e=>{const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect();};
          if(Math.abs(ink(date).bottom-ink(detail).bottom)>1)issues.push('clock and weather captions are not aligned');
        }
      }
      for(const cell of view.shadowRoot.querySelectorAll('.cell')){
        const b=cell.getBoundingClientRect(),card=cell.firstElementChild;
        for(const p of (card.localName==='hk-pager-card'?[card]:all(card,'hk-pager-card'))) for(const slot of p._slots){
          if(Math.abs(slot.getBoundingClientRect().height-b.height)>1)issues.push('short page '+cell.dataset.id);}
        for(const p of (card.localName==='hk-pager-card'?[card]:[])){
          // (a Room block hides the pager's dots: its own foot line has them, 2026-10-31)
          const dots=p.shadowRoot.querySelector('.pc').getBoundingClientRect();
          if(dots.width&&Math.abs((dots.left+dots.right-b.left-b.right)/2)>1)issues.push('page dots are not centred '+cell.dataset.id);
          for(const slot of p._slots){let r=slot.getBoundingClientRect();if(r.right<b.left+5||r.left>b.right-5)continue;
            for(const button of all(slot,'.segment,.tb')){let br=button.getBoundingClientRect();
              for(const dot of p._dots){let d=dot.getBoundingClientRect();if(br.left<d.right-1&&br.right>d.left+1&&br.top<d.bottom-1&&br.bottom>d.top+1)issues.push('dots cover control '+
              cell.dataset.id);}}
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
          if(room){const a=getComputedStyle(surface),r=getComputedStyle(room.shadowRoot.querySelector('.room'));
            if(a.backgroundColor!==r.backgroundColor||a.backgroundImage!==r.backgroundImage)issues.push('thermostat appearance differs from the room plate');}
        }
        const groups=card.localName==='hk-scenes-card'?[card]:all(card,'hk-scenes-card');
        for(const group of groups) for(const tile of group._tiles||[]) {
          const plate=tile.shadowRoot.querySelector('hk-plate.card');
          if(plate && Math.abs(plate.getBoundingClientRect().height-tile.getBoundingClientRect().height)>1)issues.push('scene pill does not fill its group row');
        }
        const players=card.localName==='hk-now-playing-card'?[card]:all(card,'hk-now-playing-card');
        for(const player of players.filter(p=>p.getAttribute('size')==='L')) {
          const art=player.shadowRoot.querySelector('.art').getBoundingClientRect();
          // the words from the label (Large has one over the song since 2026-10-31) to the artist's line
          const lab=player.shadowRoot.querySelector('.lab'),top=(lab&&lab.getBoundingClientRect().height?lab:player.shadowRoot.querySelector('.title')).getBoundingClientRect();
          const byline=player.shadowRoot.querySelector('.artist').getBoundingClientRect();
          if(Math.abs((art.top+art.bottom)/2-(top.top+byline.bottom)/2)>2)issues.push('album art and track metadata are not centred together '+
            JSON.stringify([art.top,art.bottom,top.top,byline.bottom].map(Math.round)));
        }
        for(const r of all(card,'[data-ring]')){
          const face=r.parentElement.querySelector('[data-face]'),range=document.createRange();range.selectNodeContents(face);
          if(range.getBoundingClientRect().width>r.getBoundingClientRect().width*.62)issues.push('dial face crosses track '+cell.dataset.id);
        }
      }
      const scroll=document.scrollingElement;if(scroll.scrollHeight>innerHeight+1||scroll.scrollWidth>innerWidth+1)issues.push('page scroll');
      if(window.hkGlass?.stats().active){
        const t=all(document,'hk-control-card').find(e=>e._domain()==='climate');
        if(!window.__hkGlassCards.has(t))issues.push('thermostat missing shared-layer registration');
        let n=t;
        while(n&&n!==view){
          if(n.nodeType===1&&getComputedStyle(n).clipPath!=='none')issues.push('shared backdrop blocked by ancestor clip-path');
          n=n.parentNode||n.host;
        }
      }
      return {issues,cells:view.shadowRoot.querySelectorAll('.cell').length};
    });
    console.log(JSON.stringify({screen,...report}));
    if(screen==='polish-a-blur-day'&&input.probe){
      const sample=await page.evaluate(()=>{
        const all=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?all(e.shadowRoot):[])]);
        const sky=all(document).find(e=>e.id==='hk-sky');
        const pattern=document.createElement('div');
        pattern.style.cssText='position:absolute;inset:0;z-index:999999;pointer-events:none;background:conic-gradient(#fff 25%,#000 0 50%,#fff 0 75%,#000 0) 0 0/16px 16px';
        sky.appendChild(pattern);
        const baseline=document.createElement('div');
        baseline.style.cssText='position:fixed;left:0;top:90px;width:50px;height:50px;z-index:999999;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)';
        document.body.appendChild(baseline);window.__blurProbe=[pattern,baseline];window.hkGlass.refresh();
        const t=all(document).find(e=>e.localName==='hk-control-card'&&e._domain()==='climate'),r=t.shadowRoot.querySelector('.surface').getBoundingClientRect();
        return [Math.round(r.right-36),Math.round(r.top+60),Math.round(r.right-12),Math.round(r.top+76)];
      });
      await page.waitForTimeout(200);
      await page.screenshot({path:input.probe+'/shared-pattern.png'});
      fs.writeFileSync(input.probe+'/shared-pattern.json',JSON.stringify({sample,baseline:[15,105,35,125]}));
      await page.evaluate(()=>window.__blurProbe.forEach(e=>e.remove()));
      // The narrowest card must enclose all dots even at the maximum page count.
      const target=page.locator('hk-pager-card').filter({has:page.locator('hk-control-card')}).first();
      const original=await target.evaluate(p=>p._config);
      for(const count of [2,6,12]){
        await target.evaluate((p,count)=>{const cfg=JSON.parse(JSON.stringify(p._config));cfg.item.pages={source:'list',list:Array.from({length:count},()=>({opts:{}}))};p.setConfig(cfg);},count);
        await page.waitForTimeout(100);
        const fits=await target.evaluate(p=>{
          const pc=p.shadowRoot.querySelector('.pc'),a=pc.getBoundingClientRect(),b=p.getBoundingClientRect();
          if(a.left<b.left||a.right>b.right||Math.abs((a.left+a.right-b.left-b.right)/2)>1)return false;
          if(Math.abs(parseFloat(getComputedStyle(pc,'::before').width)-pc.clientWidth)>1)return false;
          return p._dots.every(d=>{const r=d.querySelector('i').getBoundingClientRect();return r.left>=a.left+4&&r.right<=a.right-4;});
        });
        if(!fits)throw new Error('page-control pill does not enclose '+count+' dots');
        await target.locator('.dot').last().click();
        await page.waitForFunction(count=>{const all=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?all(e.shadowRoot):[])]);
          return all(document).some(p=>p.localName==='hk-pager-card'&&p._config.item.card==='thermostat'&&p._index===count-1);},count);
      }
      await target.evaluate((p,cfg)=>p.setConfig(cfg),original);
      console.log(JSON.stringify({pagePill:'2, 6 and 12 dots fit; final dot remains clickable'}));
    }
    if(input.shots){
      // Documentation images must not contain Apple's licensed fonts or glyphs.
      await page.evaluate(()=>{function visit(root){const style=document.createElement('style');style.textContent='*{font-family:Arial,sans-serif!important}';(root.head||root).appendChild(style);
        for(const e of root.querySelectorAll('*'))if(e.shadowRoot)visit(e.shadowRoot);}visit(document);});
      await page.screenshot({path:input.shots+'/'+screen+'-'+input.engine+'.png'});
    }
    const pager=page.locator('hk-pager-card').filter({has:page.locator('hk-grid-room-card')}).first();
    if(await pager.count()){
      const start=await pager.evaluate(p=>p._startIndex());
      // (the Room block's own foot line: a tap right of the current dot is the next room, 2026-10-31)
      const fd=pager.locator('hk-grid-room-card').first().locator('.fd'),fb=await fd.boundingBox();
      await fd.click({position:{x:fb.width-2,y:fb.height/2}});
      await page.waitForFunction(()=>{const all=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?all(e.shadowRoot):[])]);
        return all(document).some(e=>e.localName==='hk-pager-card'&&e._index===1&&e._els.some(c=>c?.localName==='hk-grid-room-card'));});
      // Real mouse drag, then a client state push: retain the chosen page.
      await pager.evaluate(p=>p.goTo(0,false));
      await page.waitForTimeout(150);
      const box=await pager.boundingBox();
      await page.mouse.move(box.x+box.width*.85,box.y+box.height*.35);
      await page.mouse.down();
      await page.mouse.move(box.x+box.width*.15,box.y+box.height*.35,{steps:16});
      await page.mouse.up();
      await page.waitForTimeout(500);
      if(await pager.evaluate(p=>p._index)!==1)throw new Error('mouse drag did not turn room page');
      await pager.evaluate(p=>p._receiveClient());
      if(await pager.evaluate(p=>p._index)!==1)throw new Error('state update reset mouse page');
      await pager.evaluate(p=>{p._moved=false;p.goTo(0,false);});
      await page.waitForTimeout(150);
      await page.mouse.move(box.x+box.width*.6,box.y+box.height*.35);
      await page.mouse.wheel(box.width,0);
      await page.waitForTimeout(600);
      const wheelIndex=await pager.evaluate(p=>p._index);
      if(wheelIndex<1)throw new Error('horizontal wheel did not turn room page');
      await pager.evaluate(p=>p._receiveClient());
      if(await pager.evaluate(p=>p._index)!==wheelIndex)throw new Error('state update reset trackpad page');
      console.log('mouse drag and horizontal wheel persist through state updates');
      await page.evaluate(()=>window.dispatchEvent(new Event('hk-idle-return')));
      await page.waitForTimeout(400);
      if(await pager.evaluate(p=>p._index)!==start)throw new Error('room pager did not return on idle');
    }
    if(screen==='polish-a-flat-dark'){
      const header=page.locator('hk-header-card[data-grid-band]').first();
      const old=await header.evaluate(h=>h._config);
      for(const chips of [['lights'],Array(20).fill('lights')]){
        await header.evaluate((h,chips)=>h.setConfig({...h._config,clock:false,weather:false,chips:{type:'custom:hk-chips-card',chips}}),chips);
        await page.waitForTimeout(300);
        const geo=await header.evaluate(h=>{
          const row=h._bandChips?._row;
          const walk=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?walk(e.shadowRoot):[])]);
          const scroller=walk(h.shadowRoot).find(e=>e.classList.contains('row'));
          if(!scroller)return null;
          const hidden=document.createElement('div');hidden.style.display='none';scroller.prepend(hidden);
          const kids=[...scroller.children].filter(e=>!e.hasAttribute('data-hk-glass-layer')&&e.getBoundingClientRect().width);
          return {right:kids.at(-1)?.getBoundingClientRect().right,edge:h.getBoundingClientRect().right,overflow:scroller.scrollWidth>scroller.clientWidth+1};
        });
        if(!geo)throw new Error('header chip row missing');
        // Automatic chip selection may deduplicate configured IDs; the
        // separate row overflow assertion below uses actual card instances.
        if(!geo.overflow&&Math.abs(geo.right-geo.edge)>1)throw new Error('chips do not align with right grid edge '+JSON.stringify(geo));
      }
      // Overflow remains scrollable from the first chip to the last.
      await header.evaluate(h=>{
        const row=h._bandChips._row,cfg=row._config;
        row.setConfig({...cfg,cards:Array.from({length:20},()=>cfg.cards[0])});
      });
      await page.waitForTimeout(250);
      if(!await header.evaluate(h=>{
        const row=h._bandChips._row.shadowRoot.querySelector('.row');
        const kids=[...row.children].filter(e=>!e.hasAttribute('data-hk-glass-layer'));
        if(row.scrollWidth<=row.clientWidth)return false;
        const start=kids[0].getBoundingClientRect().left>=row.getBoundingClientRect().left-1;
        row.scrollLeft=row.scrollWidth;
        return start&&row.scrollLeft>0;
      }))throw new Error('overflow chips are not all reachable');
      await header.evaluate((h,cfg)=>h.setConfig(cfg),old);
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
        const C=window.hkCards,port=Object.assign({},C.client(),{states:{'person.fictional':{entity_id:'person.fictional',state:'home',
          attributes:{friendly_name:'Avery Fixture',entity_picture:'/missing-fictional-portrait.png'}}}});
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
        // six across; a room of fewer pills than a row holds takes one row of taller ones, not a second of nothing (2026-10-30)
        const n=card.shadowRoot.querySelectorAll('.tiles > *').length;
        const ok=cs.gridTemplateColumns.split(' ').length===6&&cs.gridTemplateRows.split(' ').length===(n<=6?1:2);
        card.remove();return ok;
      });
      if(!wide)throw new Error('full-width room did not reserve six columns and the rows its pills need');
    }
    if(report.issues.length)process.exitCode=1;
  }
  // The desktop editor must show the same room its starting-room control names.
  await page.goto(input.origin+'/settings#/screens/'+input.screens[0]+'/home-grid');
  await page.waitForFunction(()=>document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor')?.previewView?.isConnected);
  await page.evaluate(()=>{
    window.ed=document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor');
    const room=ed.grid.items.find(i=>i.card==='room');ed.select(room.id);
    const field=[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.textContent.startsWith('Starting Room')).querySelector('select');
    field.value='kitchen';field.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(()=>{
    const room=ed.grid.items.find(i=>i.card==='room'),p=ed.previewView?.shadowRoot.querySelector('[data-id='+room.id+']')?.firstElementChild;
    return p?._pages?.[p._index]?.area==='kitchen';
  });
  if(!await page.evaluate(()=>[...ed.sidebar.querySelectorAll('button')].filter(e=>e.textContent==='Tap Weight'||e.textContent==='Glance Up, Touch Down').every(e=>e.closest('.screen-settings')&&
    !e.closest('.screen-settings').open&&!e.checkVisibility())))throw new Error('starters remain visible in card controls');
  if(!await page.evaluate(()=>{
    const w=ed.iframe.contentWindow,v=ed.previewView,it=ed.grid.items.find(i=>i.card==='room'),p=v.shadowRoot.querySelector('[data-id='+it.id+']').firstElementChild;
    const room=p._els[p._index],radius=parseFloat(w.getComputedStyle(room.shadowRoot.querySelector('.room')).borderTopLeftRadius)*v._gridScale;
    return [...ed.overlay.querySelectorAll('.block,.slot')].every(e=>Math.abs(parseFloat(getComputedStyle(e).borderTopLeftRadius)-radius)<0.1);
  }))throw new Error('editor outline radius differs from cards');
  console.log(JSON.stringify({editor:'Kitchen matches Starting Room; starter layouts collapsed'}));
  if(commandCalls){console.log(JSON.stringify({unexpectedCommands:commandCalls}));process.exitCode=1;}
  if(errors.length){console.log(JSON.stringify({errors}));process.exitCode=1;}
  await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});

// THE HOMEVIEW-STYLE STARTERS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase A; --homeview): each at each size,
// square cells kept square, the Centred tiles centred, the thermostat in Big Number, the Analog Numbers clock, the
// corners (34; a Square screen's corner blocks 72 on the outside), nothing past the screen, no page error.
async function homeview(input){
  const browser=await pw[input.engine].launch({headless:true,timeout:15000,...(input.browser?{executablePath:input.browser}:{})});
  let bad=0;
  try{
    for(const {screen,sizes,homeTiles} of input.screens){
      for(const size of sizes){
        const [W,H]=size.split('x').map(Number);
        const context=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:1});
        await context.addCookies([{name:'mantel_session',value:input.cookie,url:input.origin}]);
        await context.route('**/*',route=>new URL(route.request().url()).origin===input.origin?route.continue():route.abort());
        const page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        page.setDefaultTimeout(20000);
        await page.goto(input.origin+'/'+screen+'/home');
        await page.waitForFunction(()=>window.__mantelReady===true);
        await require('./grid_ready.cjs')(page);
        await page.waitForTimeout(2500);
        const report=await page.evaluate((homeTiles)=>{
          const all=(root,sel)=>[...root.querySelectorAll('*')].flatMap(e=>[...(e.matches(sel)?[e]:[]),...(e.shadowRoot?all(e.shadowRoot,sel):[])]);
          const view=all(document,'hk-home-grid-view')[0],issues=[],seen={},inside=(c,sel)=>all(c.shadowRoot||c,sel);
          if(!view)return {issues:['no grid']};
          const s=view._gridScale,sq=window.hkCards.HOME_GRID.square,g=view._grid(),bounds=view.getBoundingClientRect(),root=view._root.getBoundingClientRect();
          if(g.cell!=='square')issues.push('cells are not square');
          if(root.left<bounds.left-1||root.right>bounds.right+1||root.top<bounds.top-1||root.bottom>bounds.bottom+1)issues.push('canvas past the screen');
          const se=document.scrollingElement;if(se.scrollHeight>innerHeight+1||se.scrollWidth>innerWidth+1){
            const deep=(r)=>[...r.querySelectorAll('*')].flatMap((e)=>[e,...(e.shadowRoot?deep(e.shadowRoot):[])]);
            const mb=deep(document).filter((e)=>e.style&&e.style.marginBottom).map((e)=>e.localName+' '+e.style.marginBottom);
            issues.push('page scroll '+(se.scrollWidth-innerWidth)+' x '+(se.scrollHeight-innerHeight)+(document.documentElement.scrollTop?' (scrolled '+document.documentElement.scrollTop+')':'')+
            ' band '+document.documentElement.style.getPropertyValue('--hk-pane-b')+' view '+Math.round(bounds.height)+' margins '+mb.join(','));}
          for(const cell of view.shadowRoot.querySelectorAll('.cell')){
            const id=cell.dataset.id,dims=window.hkCards.HOME_GRID.sizes[cell.getAttribute('size')],r=cell.getBoundingClientRect(),card=cell.firstElementChild;
            if(Math.abs(r.width/s-(sq.w*dims[0]+sq.gap*(dims[0]-1)))>1||Math.abs(r.height/s-(sq.h*dims[1]+sq.gap*(dims[1]-1)))>1)issues.push(id+': not square cells '+Math.round(r.width/s)+'x'+
              Math.round(r.height/s));
            // the corners the plates are drawn with
            const plate=inside(card,'hk-plate,.ck,.plate').map(p=>({p,b:p.getBoundingClientRect()})).filter(x=>x.b.width>r.width*.9&&x.b.height>r.height*.9)[0];
            const want=cell.style.getPropertyValue('--hk-block-radius').trim();
            if(plate&&!cell.hasAttribute('data-bare')){const cs=getComputedStyle(plate.p),
              got=[cs.borderTopLeftRadius,cs.borderTopRightRadius,cs.borderBottomRightRadius,cs.borderBottomLeftRadius].join(' ');
              const w=want.split(' ');const exp=(w.length===1?[w[0],w[0],w[0],w[0]]:w).join(' ');if(got!==exp)issues.push(id+': corners '+got+', not '+exp);}
            // THE SHARED LAYER'S CUT IS THE PLATE'S SHAPE (the owner's Good Morning, 2026-10-30): its arcs at the radius
            // the plate is drawn with, scaled with the canvas
            if(plate&&!cell.hasAttribute('data-bare')&&getComputedStyle(plate.p).getPropertyValue('--hk-glass-surface').trim()==='1'){
              const cs=getComputedStyle(plate.p),k=plate.b.width/plate.p.offsetWidth||1,want=Math.round(parseFloat(cs.borderBottomRightRadius)*k*10)/10;
              const paths=all(document,'[data-hk-glass-layer]').map(L=>L.getAttribute('data-path')||'').join(' ');
              if(paths&&want>0&&!new RegExp('A'+want+','+want+' ').test(paths)&&!new RegExp('A'+(want-0.1).toFixed(1)+',|A'+(want+0.1).toFixed(1)+',').test(paths))issues.push(id+
                ': the shared layer is not cut at the plate\'s '+want+' px corner');}
            // NO WORD CUT BY A CORNER (the owner's "ff" for "Off", 2026-10-30): each line of text inside its
            // block's rounded plate -- the line box's ends, less its descender room, inside the corner's circle
            if(plate&&!cell.hasAttribute('data-bare')){const cs=getComputedStyle(plate.p),b=plate.b,k=b.width/plate.p.offsetWidth||1;
              const rad=[cs.borderTopLeftRadius,cs.borderTopRightRadius,cs.borderBottomRightRadius,cs.borderBottomLeftRadius].map(x=>parseFloat(x)*k);
              const out=(x,y)=>{const c=[[b.left+rad[0],b.top+rad[0],rad[0],x<b.left+rad[0]&&y<b.top+rad[0]],[b.right-rad[1],b.top+rad[1],rad[1],x>b.right-rad[1]&&y<b.top+rad[1]],
                [b.right-rad[2],b.bottom-rad[2],rad[2],x>b.right-rad[2]&&y>b.bottom-rad[2]],[b.left+rad[3],b.bottom-rad[3],rad[3],x<b.left+rad[3]&&y>b.bottom-rad[3]]].find(q=>q[3]);
                return c?Math.hypot(x-c[0],y-c[1])>c[2]+1:false;};
              const texts=[];const walk=n=>{for(const ch of n.childNodes){if(ch.nodeType===3&&ch.textContent.trim())texts.push(ch);
                else if(ch.nodeType===1){if(ch.shadowRoot)walk(ch.shadowRoot);if(ch.localName!=='style'&&ch.localName!=='svg')walk(ch);}}};
              walk(card.shadowRoot||card);
              for(const t of texts){const rg=document.createRange();rg.selectNodeContents(t);for(const q of rg.getClientRects()){if(!q.width||q.width<2)continue;
                const el=t.parentNode.nodeType===1?t.parentNode:t.parentNode.host;if(el&&getComputedStyle(el).visibility==='hidden')continue;
                // (words not in the plate's box at all -- a pager's other page, a label kept for screen readers -- are not
                // a corner's to cut)
                if(q.left<b.left-1||q.right>b.right+1||q.top<b.top-1||q.bottom>b.bottom+1)continue;
                if(el&&el.getBoundingClientRect().width<=1)continue;
                const top=q.top+q.height*.18,bot=q.bottom-q.height*.22;
                if([[q.left+1,top],[q.right-1,top],[q.left+1,bot],[q.right-1,bot]].some(p=>out(p[0],p[1]))){issues.push(id+': "'+t.textContent.trim().slice(0,20)+'" cut by the corner');break;}}}}
            const tile=card.localName==='hk-grid-entity-card'?card._child:null;
            if(tile&&!homeTiles){
              if(tile.getAttribute('tile')!=='centred')issues.push(id+': its tile is not centred');
              const icon=tile.shadowRoot.querySelector('.icon').getBoundingClientRect(),name=tile.shadowRoot.querySelector('.name'),nr=document.createRange();nr.selectNodeContents(name);
                const n=nr.getBoundingClientRect();
              const cx=(r.left+r.right)/2;
              if(Math.abs((icon.left+icon.right)/2-cx)>1.5)issues.push(id+': glyph off centre');
              if(Math.abs((n.left+n.right)/2-cx)>1.5)issues.push(id+': name off centre');
              if(Math.abs(((icon.top+icon.bottom)/2-r.top)/r.height-.33)>.02)issues.push(id+': glyph not at 33 %');
              if(n.bottom>r.bottom+1)issues.push(id+': name below the tile');
              seen.centred=(seen.centred||0)+1;
            }
            if(card.localName==='hk-control-card'||inside(card,'hk-control-card').length){const c=card.localName==='hk-control-card'?card:inside(card,'hk-control-card')[0];
              const big=c.shadowRoot.querySelector('.surface.big');if(!big)issues.push(id+': thermostat is not Big Number');else{
                const bn=big.querySelector('[data-big-num]').getBoundingClientRect(),ft=big.querySelector('[data-tstat-details]').parentElement.getBoundingClientRect();
                if(bn.bottom>ft.top+2)issues.push(id+': the number runs into the foot');
                if(ft.left<r.left||ft.right>r.right)issues.push(id+': the foot is past the block');
                seen.big=(seen.big||0)+1;}}
            if(card.localName==='hk-grid-clock-card'){const f=inside(card,'.f-numbers')[0];if(!f)issues.push(id+': no Analog Numbers face');else{
              const d=f.querySelector('svg').getBoundingClientRect();if(d.width<r.width*.9||d.width>r.width*1.06)issues.push(id+': the face does not fill its block ('+Math.round(d.width)+' of '+
                Math.round(r.width)+')');seen.clock=1;}}
          }
          return {issues,scale:+s.toFixed(3),cell:Math.round(sq.w*s),seen};
        },!!homeTiles);
        report.errors=errors;
        if(input.shots){
          await page.evaluate(()=>{function visit(root){const style=document.createElement('style');style.textContent='*{font-family:Arial,sans-serif!important}';(root.head||root).appendChild(style);
            for(const e of root.querySelectorAll('*'))if(e.shadowRoot)visit(e.shadowRoot);}visit(document);});
          await page.waitForTimeout(300);
          await page.screenshot({path:input.shots+'/'+screen+'-'+size+'-'+input.engine+'.png'});
        }
        const fail=report.issues.length||errors.length;bad+=fail?1:0;
        console.log((fail?'FAIL ':'ok   ')+input.engine+' '+screen+' '+size+' '+JSON.stringify(report));
        await context.close();
      }
    }
  }finally{await browser.close();}
  process.exitCode=bad?1:0;
}
