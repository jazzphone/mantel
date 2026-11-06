const assert = require('assert/strict'), fs = require('fs'), pw = require(process.env.PLAYWRIGHT_PATH);
const input = JSON.parse(fs.readFileSync(0, 'utf8')), [W,H] = input.size.split('x').map(Number);
(async()=>{
 const browser=await pw[input.engine].launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:W,height:H},hasTouch:true});
  await ctx.addCookies([{name:'mantel_session',value:input.cookie,url:input.origin}]);
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===input.origin?r.continue():r.abort());
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>{if(!/ResizeObserver loop/.test(e.message))errors.push(e.message);});
  const E=(fn,arg)=>page.evaluate(`(()=>{const deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);const ed=deep(document,'hk-saver-editor')[0];return ed&&ed.ui?(${fn})(ed,ed.shadowRoot,${JSON.stringify(arg??null)}):null;})()`);
  const until=async(fn,arg,ms=25000)=>{for(let n=0;n<ms;n+=150){let v;try{v=await E(fn,arg);}catch(e){if(!/Execution context was destroyed/.test(e.message))throw e;}if(v)return v;await page.waitForTimeout(150);}throw new Error('Timed out: '+fn+' '+JSON.stringify({errors,context:await E(ed=>({style:ed.opts.clock_style,config:ed.saver()?.config(),status:ed.saver()?.previewStatus()}))}));};
  const shot=async name=>{if(input.shots)await page.screenshot({path:input.shots+'/'+input.engine+'-'+W+'-'+name+'.png'});};
  await page.goto(input.origin+'/settings#/screens/'+input.screen+'/screensaver/editor');
  await until((ed,sr)=>ed.galleryEl&&sr.querySelectorAll('.catalog .design-card').length===44);
  assert.equal(await E(ed=>ed.opts.designs.length),1);await shot('gallery');
  await E((ed,sr)=>{window.__houseBefore=JSON.stringify(ed.panel.hs('look.saver'));sr.querySelector('.catalog .design-card:nth-child(21)').click();});
  const houseBefore=await page.evaluate(()=>window.__houseBefore);
  assert.equal(await E(ed=>ed.opts.clock_style),'solar');
  await page.locator('hk-saver-editor .design-actions input').fill('Solar Lounge');
  await page.locator('hk-saver-editor .design-actions').getByRole('button',{name:'Duplicate',exact:true}).click();
  await until(ed=>ed.opts.designs.length===3&&ed.opts.designs.at(-1).name==='Solar Lounge Copy');
  await page.locator('hk-saver-editor .design-actions').getByRole('button',{name:'Remove Design',exact:true}).click();
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await until(ed=>ed.opts.designs.length===2);
  // A globe thumbnail must yield to native gallery scrolling, while the full face stays interactive.
  await E((ed,sr)=>sr.querySelector('.catalog .design-card:nth-child(23)').click());
  await until(ed=>ed.opts.clock_style==='world'&&ed.opts.designs.length===3);
  const globe=page.locator('hk-saver-editor .design-rail .design-card').nth(2);
  await globe.scrollIntoViewIfNeeded();await page.waitForTimeout(800);
  await until((ed,sr)=>sr.querySelector('.design-rail canvas[data-hk-saver-control=globe]'));
  const hit=await E((ed,sr)=>{const cv=sr.querySelector('.design-rail canvas[data-hk-saver-control=globe]'),r=cv.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,card:sr.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.design-card')===cv.closest('.design-card')};});
  assert(hit.card,'the card owns thumbnail input');
  if(input.engine==='chromium'){
    const cdp=await ctx.newCDPSession(page),before=await E((ed,sr)=>sr.querySelector('.design-rail').scrollLeft);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hit.x,y:hit.y}]});
    for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:hit.x+i*20,y:hit.y}]});await page.waitForTimeout(16);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(800);
    const after=await E((ed,sr)=>sr.querySelector('.design-rail').scrollLeft);assert(after<before-30,'native swipe moves cards across the globe '+JSON.stringify({before,after,hit}));
    await cdp.detach();
  }
  await globe.click();
  await page.locator('hk-saver-editor .design-actions').getByRole('button',{name:'Remove Design',exact:true}).click();
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await until(ed=>ed.opts.designs.length===2);
  await page.locator('hk-saver-editor .design-rail .design-card').nth(1).click();

  await E((ed,sr)=>sr.querySelector('.design-gallery header .customize').click());
  await until(ed=>ed.saver()?.layoutInfo());
  assert(await E(ed=>Object.keys(hkSaverLayout.PIECES).length===44));
  // The screen inherits its saver, but previews its own pane, not the global pane.
  await until(ed=>ed.saver()?.previewStatus().pane);
  await E(ed=>{ed.hidePane=true;ed.applyExtras();});await until(ed=>!ed.saver().previewStatus().pane);
  await E(ed=>{ed.hidePane=false;ed.applyExtras();});await until(ed=>ed.saver().previewStatus().pane);
  // Every added face mounts in the actual preview with editable per-face options.
  for(const style of ['solar','prism','world','hotel','terminal','atelier','meridian','markets','brief','modular']){
    await E((ed,sr,style)=>{ed.change(o=>{const library=o.designs,active=o.active_design;Object.assign(o,hkSaverDesigns.preset(o,style));o.designs=library;o.active_design=active;o.clock_options={...o.clock_options,market_entities:['sensor.test_market'],news_entity:'sensor.test_news'};});ed.select('look');},style);
    await until((ed,sr,style)=>{const deep=r=>[...r.querySelectorAll('*')].some(e=>e.matches('.df.'+style)||(e.shadowRoot&&deep(e.shadowRoot)));return deep(ed.iframe.contentDocument);},style);
    await page.waitForTimeout(1600);
    const visible=await E(ed=>{const out=[];const deep=r=>[...r.querySelectorAll('*')].forEach(e=>{if(e.matches('.df')&&e.getBoundingClientRect().width>0)out.push(e.className);if(e.shadowRoot)deep(e.shadowRoot);});deep(ed.iframe.contentDocument);return out;});
    assert.equal(visible.length,1,style+': one actual face on screen '+JSON.stringify(visible));
    if(style==='world') assert(await E(ed=>{let cv;const deep=r=>[...r.querySelectorAll('*')].forEach(e=>{if(e.matches('canvas[data-hk-saver-control=globe]'))cv=e;if(e.shadowRoot)deep(e.shadowRoot);});deep(ed.iframe.contentDocument);if(!cv)return false;const before=cv.toDataURL();cv.dispatchEvent(new ed.iframe.contentWindow.KeyboardEvent('keydown',{key:'ArrowRight'}));return before!==cv.toDataURL();}),'the globe rotates in longitude');
    await shot(style);
  }
  // A chosen slide survives a configuration rebuild. No automatic takeover in previews.
  await E(ed=>{ed.setSlide('weather');});
  await until(ed=>ed.saver().previewStatus().ready, null,40000);
  await E(ed=>ed.change(o=>{o.clock_24=!o.clock_24;}));
  await until(ed=>ed.saver().previewStatus().selected==='weather'&&ed.saver().previewStatus().ready);
  await page.waitForTimeout(1800);assert.equal(await E(ed=>ed.saver().previewStatus().selected),'weather');
  await E(ed=>{ed.setSlide('forecast');});await until(ed=>ed.saver().previewStatus().ready);
  await E(ed=>ed.setSlide('music'));await page.waitForTimeout(800);
  const music=await E(ed=>ed.saver().previewStatus());assert(music.ready||music.message.includes('Play music'));
  await E(ed=>{ed.setSlide('energy');});await page.waitForTimeout(800);
  const energy=await E(ed=>ed.saver().previewStatus());assert(energy.ready||energy.message.includes('energy data'));
  await E(ed=>ed.setSlide(''));await page.waitForTimeout(500);await shot('editor');
  const mobile=await E((ed,sr)=>({save:getComputedStyle(ed.saveButton).display,work:getComputedStyle(sr.querySelector('.work')).display,overflow:sr.querySelector('.editor').scrollWidth-innerWidth}));
  assert(mobile.save!=='none'&&mobile.work!=='none'&&mobile.overflow<=1,JSON.stringify(mobile));
  // Save through the existing audited board route; the global library stays byte-for-byte unchanged.
  await E(async ed=>{ed.change(o=>{o.clock_options.metal='gold';});window.__panel=ed.panel;window.__savedId=ed.opts.active_design;hkSaverDesigns.gallery(ed);ed.shadowRoot.querySelector('.gallery-save').click();});
  await page.waitForFunction(screen=>window.__panel?.data.boards[screen].screensaver_options?.clock_options.metal==='gold',input.screen);
  const persisted=await page.evaluate(screen=>{const p=window.__panel,b=p.data.boards[screen],o=b.screensaver_options;return {own:!!o,id:o?.active_design,metal:o?.clock_options.metal,snapshot:o?.designs.find(d=>d.id===o.active_design)?.options.clock_options.metal,global:JSON.stringify(p.hs('look.saver'))===window.__houseBefore};},input.screen);
  assert(persisted.own&&persisted.id&&persisted.metal==='gold'&&persisted.snapshot==='gold'&&persisted.global,JSON.stringify(persisted));
  // The ordinary settings preview also holds the chosen slide and pane.
  await page.goto(input.origin+'/settings#/screens/'+input.screen+'/screensaver');
  await page.waitForFunction(()=>{const walk=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?walk(e.shadowRoot):[])]);window.__settingsPanel=walk(document).find(e=>e.localName==='hk-settings-panel');return __settingsPanel?.pageEl&&__settingsPanel.data;});
  await page.evaluate(()=>{const b=__settingsPanel.bar.querySelector('.pvtoggle');if(b&&b.getAttribute('aria-pressed')!=='true')b.click();});
  await page.waitForFunction(()=>__settingsPanel._saverWas&&__settingsPanel.pageEl.querySelector('.pvsaver select'));
  await page.evaluate(()=>{const p=__settingsPanel;p._saverSlide='forecast';p.saverPreview(true);});
  await page.waitForFunction(()=>{const fr=__settingsPanel.pageEl.querySelector('.pvbox iframe');return fr?.contentWindow.hkSaver?.previewStatus().selected==='forecast';});
  await page.evaluate(()=>{__settingsPanel._saverPaneHidden=true;__settingsPanel.saverPreview(true);});
  await page.waitForFunction(()=>!__settingsPanel.pageEl.querySelector('.pvbox iframe').contentWindow.hkSaver.previewStatus().pane);
  await page.evaluate(()=>{__settingsPanel._saverPaneHidden=false;__settingsPanel.saverPreview(true);});
  await page.waitForFunction(()=>__settingsPanel.pageEl.querySelector('.pvbox iframe').contentWindow.hkSaver.previewStatus().pane);
  // Options saved on the ordinary page stay with the active design too.
  await page.evaluate(async screen=>{await __settingsPanel.saverPutB(screen)('each_photo',73);},input.screen);
  assert(await page.evaluate(([screen,before])=>{const o=__settingsPanel.data.boards[screen].screensaver_options;return o.each_photo===73&&o.designs.find(d=>d.id===o.active_design).options.each_photo===73&&JSON.stringify(__settingsPanel.hs('look.saver'))===before;},[input.screen,houseBefore]));
  // A hold opens the actual saver chooser. A local selection never rewrites the screen/global library.
  await page.goto(input.origin+'/'+input.screen+'/home');
  await page.waitForFunction(()=>window.hkSaver&&window.__mantelReady);
  await page.mouse.move(W*.4,H*.45);await page.evaluate(()=>{hkSaver.force(true);return hkSaver.start();});await page.waitForTimeout(1800);
  await page.mouse.down();await page.waitForTimeout(800);await page.mouse.up();
  await page.waitForFunction(()=>{const walk=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?walk(e.shadowRoot):[])]);window.__chooser=walk(document).find(e=>e.localName==='hk-saver-chooser');return !!__chooser;});
  assert(await page.evaluate(()=>__chooser.shadowRoot.querySelectorAll('.card').length===2));
  assert(await page.evaluate(()=>{const s=__chooser.shadowRoot.querySelector('section');return s.scrollWidth<=s.clientWidth+1&&[...s.querySelectorAll('header button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;});}),'chooser actions fit the screen');
  await shot('chooser');
  await page.evaluate(()=>__chooser.shadowRoot.querySelector('.card').click());
  await page.waitForFunction(()=>hkSaver.config().clock_style==='classic');assert(await page.evaluate(()=>hkSaver.running()));
  await page.reload();await page.waitForFunction(()=>window.hkSaver&&window.__mantelReady);
  assert.equal(await page.evaluate(()=>hkSaver.config().clock_style),'classic');
  assert.equal(await page.evaluate(screen=>hkSettings.get('boards',{})[screen].screensaver_options.clock_style,input.screen),'modular');
  await page.evaluate(()=>{hkSaver.force(true);hkSaver.start();hkSaver.chooseDesign();});
  await page.waitForFunction(()=>{const walk=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?walk(e.shadowRoot):[])]);window.__chooser=walk(document).find(e=>e.localName==='hk-saver-chooser');return !!__chooser;});
  await page.evaluate(()=>[...__chooser.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='Customize').click());
  await until(ed=>ed.galleryEl&&ed.opts.active_design==='original');assert.equal(await E(ed=>ed.opts.clock_style),'classic');
  await E(ed=>ed.cancel());
  await page.goto(input.origin+'/'+input.screen+'/home');await page.waitForFunction(()=>window.hkSaver&&window.__mantelReady);

  await page.evaluate(()=>{hkSaver.force(true);hkSaver.start();hkSaver.chooseDesign();});
  await page.waitForFunction(()=>{const walk=r=>[...r.querySelectorAll('*')].flatMap(e=>[e,...(e.shadowRoot?walk(e.shadowRoot):[])]);window.__chooser=walk(document).find(e=>e.localName==='hk-saver-chooser');return !!__chooser;});
  assert(await page.evaluate(()=>[...__chooser.shadowRoot.querySelectorAll('header button')].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})),'all local-selection actions fit');
  await page.evaluate(()=>[...__chooser.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='Use Saved Default').click());
  await page.waitForFunction(()=>hkSaver.config().clock_style==='modular');

  // Saving All Screens updates the shared design; this screen's independent copy stays intact.
  await page.goto(input.origin+'/settings#/house/screensaver/editor');
  await until(ed=>ed.galleryEl&&ed.o.house&&ed.opts.active_design==='original');
  await E((ed,sr)=>{ed.change(o=>{o.each_photo=89;});window.__globalPanel=ed.panel;sr.querySelector('.gallery-save').click();});
  await page.waitForFunction(()=>window.__globalPanel?.hs('look.saver').each_photo===89);
  assert(await page.evaluate(screen=>{const p=window.__globalPanel,o=p.hs('look.saver'),local=p.data.boards[screen].screensaver_options;return o.designs.find(d=>d.id==='original').options.each_photo===89&&local.each_photo===73&&local.clock_options.metal==='gold';},input.screen));

  assert.deepEqual(errors,[]);console.log('PASS '+input.engine+' '+W+' saved designs, 10 faces, all widgets, scope, preview slides/pane, touch layout, persistence and hold-to-choose');
  await ctx.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
