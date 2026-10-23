const assert = require('assert/strict');
const pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async()=>{
 for(const engine of ['chromium','webkit']){
  const browser=await pw[engine].launch({headless:true,...(engine==='chromium'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
  try{
   const ctx=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true});
   await ctx.addCookies([{name:'mantel_session',value:input.cookie,url:input.origin}]);
   await ctx.route('**/*',r=>new URL(r.request().url()).origin===input.origin?r.continue():r.abort());
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(input.origin+'/room-scroll/home');
   await page.waitForFunction(()=>window.__mantelReady);
   await page.evaluate(()=>{
    window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);
    window.p=deep(document,'hk-pager-card')[0];
   });
   await page.waitForFunction(()=>p?._pages?.some(c=>c.area==='kitchen'));
   await page.evaluate(()=>p.goTo(p._pages.findIndex(c=>c.area==='kitchen'),false));
   await page.waitForFunction(()=>deep(document,'hk-grid-room-card').some(r=>r._config?.area==='kitchen'&&r._kids?.length>4));
   const geometry=await page.evaluate(()=>{
    window.room=deep(document,'hk-grid-room-card').find(r=>r._config?.area==='kitchen');window.tiles=room.shadowRoot.querySelector('.tiles');
    const r=tiles.getBoundingClientRect(),slot=tiles.firstElementChild.getBoundingClientRect();
    return {count:room._kids.length,height:r.height,tileHeight:slot.height,scroll:tiles.scrollHeight,lock:room._kids.some(k=>k._config.entity==='lock.back_door'),more:!!tiles.querySelector('.more'),x:r.x+r.width/2,y:r.y+r.height/2};
   });
   assert(geometry.count>8 && geometry.lock && !geometry.more,JSON.stringify(geometry));
   assert(geometry.scroll>geometry.height && Math.abs(geometry.tileHeight-(geometry.height-10)/2)<2,JSON.stringify(geometry));
   const index=await page.evaluate(()=>p._index);
   await page.mouse.move(geometry.x,geometry.y);await page.mouse.wheel(0,600);await page.waitForTimeout(300);
   assert(await page.evaluate(()=>tiles.scrollTop>100));assert.equal(await page.evaluate(()=>p._index),index);
   await page.evaluate(()=>tiles.scrollTop=tiles.scrollHeight);
   assert(await page.evaluate(()=>Math.abs(tiles.lastElementChild.getBoundingClientRect().bottom-tiles.getBoundingClientRect().bottom)<2));
   await page.waitForFunction(()=>['switch.coffee','input_button.good_morning','switch.unsupported_icon'].every(id=>deep(document,'hk-tile-card,hk-scene-card').filter(c=>c._config?.entity===id).some(c=>deep(c.shadowRoot,'hk-state-icon').some(i=>i.shadowRoot.querySelector('path.p')?.getAttribute('d')))));
   assert(await page.evaluate(()=>{
    const standalone=id=>deep(document,'hk-grid-entity-card').find(c=>c._config.entity===id)._child;
    const coffee=standalone('switch.coffee'), morning=standalone('input_button.good_morning'), scene=standalone('scene.good_morning');
    const roomCoffee=room._kids.find(c=>c._config.entity==='switch.coffee');
    const sharedScene=window.hkChip.scenes.pill(window.hkCards.client(),'scene.good_morning');
    return coffee._config.icon===roomCoffee._config.icon && coffee._config.icon==='hk:coffee-maker-outline' &&
     coffee._config.secondary.mode==='none' && deep(coffee.shadowRoot,'.label')[0]?.textContent==='' &&
     Math.abs(coffee.getBoundingClientRect().height-coffee.getRootNode().host.getBoundingClientRect().height)<1 &&
     coffee._config.icon_color===roomCoffee._config.icon_color && morning._config.icon==='hk:white-balance-sunny' &&
     scene._config.icon===sharedScene.icon && scene._config.icon_color===sharedScene.icon_color &&
     [coffee,morning,scene].every(c=>deep(c.shadowRoot,'hk-state-icon').some(i=>i.shadowRoot.querySelector('path.p')?.getAttribute('d')));
   }), 'standalone and room accessory/scene glyphs match');
   if(engine==='chromium'){
    const cdp=await ctx.newCDPSession(page);
    const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
    await page.evaluate(()=>tiles.scrollTop=0);
    await touch('touchStart',geometry.x,geometry.y+50);
    for(let i=1;i<=6;i++){await touch('touchMove',geometry.x,geometry.y+50-i*20);await page.waitForTimeout(30);}
    await touch('touchEnd');await page.waitForTimeout(1500); // settle native momentum before a separate long press
    assert(await page.evaluate(()=>tiles.scrollTop>20),'touch scroll');
    await page.evaluate(()=>{tiles.scrollTop=0;window.calls=[];room._call=(...v)=>calls.push(v);});
    const spot=await page.evaluate(()=>{const r=tiles.firstElementChild.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
    await touch('touchStart',spot.x,spot.y);await page.waitForTimeout(550);
    assert(await page.evaluate(()=>!!tiles.querySelector('.dim')),'hold shows dimmer');
    for(let i=1;i<=4;i++){await touch('touchMove',spot.x,spot.y-i*12);await page.waitForTimeout(30);}
    await touch('touchEnd');await page.waitForTimeout(400);
    const held=await page.evaluate(()=>({calls,scroll:tiles.scrollTop,dim:!!tiles.querySelector('.dim')}));assert(held.calls.length===1 && held.scroll===0,JSON.stringify(held));
    await touch('touchStart',geometry.x+100,geometry.y);await page.waitForTimeout(50);
    for(let i=1;i<=8;i++){await touch('touchMove',geometry.x+100-i*35,geometry.y);await page.waitForTimeout(20);}
    await touch('touchEnd');await page.waitForTimeout(600);
    try{await page.waitForFunction(i=>p._index!==i,index,{timeout:3000});}catch(e){console.log(await page.evaluate(()=>({index:p._index,left:p._track.scrollLeft,width:p._track.clientWidth,held:p._track.className,roomBox:room.getBoundingClientRect().toJSON(),tiles:tiles.getBoundingClientRect().toJSON()})));throw e;}
   }
   await page.goto(input.origin+'/settings#/screens/room-scroll/home-grid');
   await page.waitForFunction(()=>!!document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor')?.previewView?.isConnected);
   await page.evaluate(()=>{window.ed=document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor');ed.select('room');window.select=[...ed.sidebar.querySelectorAll('.cell')].find(c=>c.querySelector('.t')?.textContent==='Accessory Display').querySelector('select');select.value='summary';select.dispatchEvent(new Event('change'));ed.save();});
   await page.waitForFunction(()=>!ed.busy&&!ed.dirty());
   assert(await page.evaluate(()=>ed.grid.items[0].opts.accessory_display==='summary'));
   await page.evaluate(()=>{select=[...ed.sidebar.querySelectorAll('.cell')].find(c=>c.querySelector('.t')?.textContent==='Accessory Display').querySelector('select');select.value='scroll';select.dispatchEvent(new Event('change'));ed.save();});
   await page.waitForFunction(()=>!ed.busy&&!ed.dirty());
   assert.deepEqual(errors,[]);
   console.log('PASS '+engine+': fixed-size room scroll, complete controls, paging index, entity icons/fallback, editor save'+(engine==='chromium'?', native touch scroll and hold dimming':''));
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exit(1);});
