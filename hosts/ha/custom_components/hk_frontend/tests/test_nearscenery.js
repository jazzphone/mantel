// New woodland survives updates and switches back to original decorations.
var pass=0,fail=0;
function check(label,condition){print((condition?'PASS ':'FAIL ')+label);condition?pass++:fail++;}
globalThis.window=globalThis;globalThis.location={pathname:'/test'};
var LISTEN={};globalThis.addEventListener=function(t,f){(LISTEN[t]=LISTEN[t]||[]).push(f);};
function fire(t){(LISTEN[t]||[]).forEach(function(f){f({type:t});});}globalThis.setInterval=function(){return 1;};globalThis.clearInterval=function(){};
var activeObservers=0;
globalThis.ResizeObserver=function(){activeObservers++;this.observe=function(){};this.disconnect=function(){activeObservers--;};};
globalThis.getComputedStyle=function(){return {left:'300px'};};
function node(){
 var n={children:[],className:'',values:{},classes:{},clientWidth:1280,clientHeight:800};
 n.style={setProperty:function(k,v){n.values[k]=v;},getPropertyValue:function(k){return n.values[k]||'';}};
 n.classList={contains:function(k){return !!n.classes[k];},toggle:function(k,on){n.classes[k]=on;},add:function(k){n.classes[k]=true;},remove:function(k){delete n.classes[k];}};
 n.appendChild=function(c){c.parent=n;n.children.push(c);return c;};
 n.insertBefore=function(c,b){if(c.parent)c.remove();c.parent=n;var i=n.children.indexOf(b);n.children.splice(i<0?n.children.length:i,0,c);return c;};
 n.querySelectorAll=function(sel){var out=[];function walk(a){a.children.forEach(function(c){if(sel.split(',').some(function(t){return c.className.split(' ').indexOf(t.slice(1))>=0;}))out.push(c);walk(c);});}walk(n);return out;};
 n.querySelector=function(sel){return n.querySelectorAll(sel)[0]||null;};
 n.remove=function(){if(n.parent)n.parent.children=n.parent.children.filter(function(c){return c!==n;});};
 n.getRootNode=function(){return null;};
 n.getBoundingClientRect=function(){return {left:0,top:0,width:n.clientWidth,height:n.clientHeight};};
 Object.defineProperty(n,'textContent',{set:function(){n.children=[];}});return n;
}
globalThis.document={createElement:node,readyState:'complete',head:node(),body:node(),addEventListener:function(){},querySelector:function(){return null;},querySelectorAll:function(){return [];},getElementById:function(){return null;}};
load(HK_ROOT+'/frontend/modules/hk-sky.js');
var sky=node(),parts={};sky.querySelector=function(sel){return parts[sel]||(parts[sel]=node());};
// DAYTIME SKY: a fair midday is the bright blue; an overcast or a wet one keeps the deep sky
(function(){
 var b=node(),q={};b.querySelector=function(sel){return q[sel]||(q[sel]=node());};
 function hz(o){var t={elev:40,azim:180,cover:.1,wind:6,fog:false,wet:{kind:'none',rate:0},moon:.5,season:'',decorations:false,cloudStyle:'classic'};
  for(var k in o)t[k]=o[k];hkSky._paint(b,t);return b.values['--sk3'];}
 var deep=hz({brightness:0}),fair=hz({}),grey=hz({cover:.9}),rain=hz({cover:.6,wet:{kind:'rain',rate:.5}}),half=hz({cover:.7});
 check('Natural is the default: a fair midday is brighter than Deep',fair!==deep&&hz({brightness:1})===fair);
 check('an overcast sky (90% cover) keeps the deep horizon',grey===deep);
 check('rain keeps the deep horizon whatever the cover',rain===deep);
 check('70% cover is between the two',half!==deep&&half!==fair);
 check('golden hour (8 deg of sun) is untouched',hz({elev:8})===hz({elev:8,brightness:0}));
})();
var s={decorationStyle:'new',elev:25,azim:180,cover:.1,wind:6,fog:false,wet:{kind:'none',rate:0},moon:.5,season:'christmas',seasonalOn:true,decorations:true};
hkSky._force({show:true,spooky:false});hkSky._paint(sky,s);
var root=sky._hkNear.root, first=root.querySelectorAll('.scenery-art')[0],bulbs=root.querySelectorAll('.patch'),light=Number(root.values['--scene-light']);
check('Christmas mounts stationary transparent art and its own twelve bulbs, lit (patches, not dots)',bulbs.length===12&&
  !root.querySelectorAll('.scenery-bulb').length&&root.values['--scene-image']==='url(/hk/sky/near/christmas-v1.webp)'&&
  bulbs[0].style.backgroundImage==='url(/hk/sky/near/christmas-bulb-lit-1-v1.webp)');
check('scenery is the sky\'s own layer, not inside the menu-inset season box',root.parent===sky&&parts['.season'].children.indexOf(root)<0);
check('tablet foreground fits its height without vertical cover cropping',Number(root.values['--art-h'].replace('px',''))===800);
check('the bulbs twinkle one by one along their strands',root.querySelectorAll('.bulb').length===12&&
  bulbs[0].values['--phase']==='-0.43s'&&bulbs[1].values['--phase']==='-0.86s');
check('...placed on their tree as it is laid out: the first at its painted place',bulbs[0].style.left==='98.4px'&&bulbs[0].style.width==='35.5px');
check('Christmas has its snow glints and the northern lights behind the trees, and no blown-snow puffs',
  root.querySelectorAll('.glint').length===22&&root.querySelectorAll('.puff').length===0&&root.children[0].className==='aurora');
check('the original Christmas renderer is not built underneath',!parts['.season'].children.length&&sky._hkSeasonKey===null);
s.elev=-18;s.wind=23;s.cover=.9;s.wet={kind:'snow',rate:.8};hkSky._paint(sky,s);
check('a real wind blows the snow off the branches',root.classes.windy===true);
check('every screen its own scale: a 1280 x 800 tablet is 1',root.values['--near-u']==='1.00');
check('daylight and weather keep actual artwork and light nodes',sky._hkNear.root===root&&root.querySelectorAll('.scenery-art')[0]===first&&root.querySelectorAll('.patch')[0]===bulbs[0]);
check('illumination responds without rebuilding',Number(root.values['--scene-light'])>light);
check('new night moon is placed above the camera mosaic',sky.values['--moonS']==='76px'&&Math.abs(parseFloat(sky.values['--moonY'])*800/100-76)<.001&&Number(sky.values['--moonO'])>0);
root.clientWidth=390;root.clientHeight=844;hkSky._paint(sky,s);
check('phone switches composition without replacing nodes',root.classes.narrow&&root.querySelectorAll('.scenery-art')[0]===first);
check('...and the touches scale down for it, not below a phone\'s 0.6',root.values['--near-u']==='0.60');
check('phone bulbs follow the selected right tree only',bulbs.slice(0,6).every(function(b){return b.style.display==='none';})&&bulbs.slice(6).every(function(b){return b.style.display!== 'none';}));
check('phone artwork keeps its natural aspect ratio',Math.abs(parseFloat(root.values['--art-w'])/844-1585/992)<.001);
root.clientWidth=1024;root.clientHeight=600;hkSky._paint(sky,s);
check('short tablet keeps roots at the ground plane and presents inside the viewport',parseFloat(root.values['--art-h'])===600&&parseFloat(root.values['--art-w'])===600*1585/992);
var placed=root.values['--art-h'];s.wind=4;s.wet={kind:'none',rate:0};hkSky._paint(sky,s);
check('weather updates do not move rooted decorations',root.values['--art-h']===placed&&sky._hkNear.root===root&&!root.classes['heavy-weather']);
// Dusk: a 3s tick that moves the sun a little must not rewrite the full-viewport
// filter inputs (each write restarts their 3s transition).
s.elev=-3;hkSky._paint(sky,s);
var sceneWrites=0,setP=root.style.setProperty;root.style.setProperty=function(k,v){if(/^--scene-[bs]$|^--scene-light$/.test(k))sceneWrites++;setP(k,v);};
s.elev=-2.98;hkSky._paint(sky,s);s.elev=-2.96;hkSky._paint(sky,s);root.style.setProperty=setP;
check('dusk ticks that change nothing visible leave the scene light alone',sceneWrites===0&&/^\d\.\d\d$/.test(root.values['--scene-b'])&&Math.abs(Number(root.values['--scene-b'])/.02-Math.round(Number(root.values['--scene-b'])/.02))<1e-9);
// a moon the touches can measure
parts['.moon'].getBoundingClientRect=function(){return {left:1100,top:40,width:76,height:76};};
s.elev=-18;hkSky._paint(sky,s);
check('no sleigh on an ordinary night',!root.classes.eve);
sky._hkNear.update({now:new Date(2026,11,24,21,0)});
var sleigh=root.querySelector('.sleigh');
check('Christmas Eve: Santa across the moon',root.classes.eve===true&&sleigh.style.top==='59px'&&sleigh.style.width==='78px');
sky._hkNear.update({now:new Date(2026,11,26,21,0)});check('...and only Christmas Eve',!root.classes.eve);
s.elev=-18;s.animations=false;hkSky._paint(sky,s);check('animation switch retains art and uses lifecycle guard',sky.classes.noanim&&sky._hkNear.root===root);
s.season='';hkSky._force(null);hkSky._surpriseForce('winter-wonderland');hkSky._paint(sky,s);
check('plain winter replaces Christmas and disconnects old observer',sky._hkNear.root!==root&&activeObservers===1&&!sky._hkNear.root.querySelectorAll('.scenery-bulb').length&&sky._hkNear.root.values['--scene-image']==='url(/hk/sky/near/winter-v1.webp)');
s.season='halloween';hkSky._surpriseForce(null);hkSky._force({show:true,spooky:true});hkSky._paint(sky,s);
var spookyRoot=sky._hkNear.root;
check('a spooky Halloween night stands the leaves down (and their animations with them)',spookyRoot.classes.spooky===true&&spookyRoot.querySelectorAll('.leaves').length===1);
hkSky._force({show:true,spooky:false});hkSky._paint(sky,s);
check('...an ordinary Halloween night keeps them',sky._hkNear.root===spookyRoot&&spookyRoot.classes.spooky===false);
var hr=sky._hkNear.root;
check('bats every Halloween night, not only a spooky one: two flocks in the night field, a swarm in the spooky one',
  hr.querySelectorAll('.dark')[0].querySelectorAll('.flock').length===2&&hr.querySelectorAll('.night')[0].querySelectorAll('.bat').length===7&&
  hr.values['--near-dark']==='1');
check('...the owl in its tree and the mist over the moon',hr.querySelectorAll('.owl').length===1&&hr.querySelectorAll('.wisp').length===2);
var flockTops=function(){return hr.querySelectorAll('.flock').map(function(f){return f.children.map(function(b){return b.style.top;}).join(',');}).join('|');};
var tops=flockTops();hkSky._paint(sky,s);hkSky._paint(sky,s);
check('the flocks keep the places across() gives them, paint after paint (no fixed-row override)',flockTops()===tops&&tops.indexOf('px')>0);
check('...inside the clear band above the camera mosaic',hr.querySelectorAll('.flock')[0].children.every(function(b){var t=parseFloat(b.style.top)+parseFloat(b.style.height)/2;return t>=40&&t<=180;}));
check('an ordinary Halloween night shows the dark field (flocks, owl) but not the spooky swarm\'s night field',!hr.classes['is-night']&&!hr.classes['is-day']&&!hr.classes['out-dark']);
var realNow=Date.now,clock=realNow.call(Date);Date.now=function(){return clock;};
s.elev=25;hkSky._paint(sky,s);
check('by day the dark field fades to 0 first (still there for its 20 s fade)',hr.values['--near-dark']==='0'&&!hr.classes['out-dark']&&!hr.classes['is-night']&&hr.classes['is-day']===true);
clock+=22000;hkSky._paint(sky,s);
check('...then it is taken out, so its bats, owl and mist stop running',hr.classes['out-dark']===true);
check('...and by day the lit candles and bulbs leave too (their layer is at opacity 0 all day)',hr.classes['lit-out']===true);
s.elev=-18;hkSky._paint(sky,s);
check('after dark it comes back at 0 first...',!hr.classes['out-dark']&&hr.values['--near-dark']==='0');
check('...and the lit patches are back the moment they light',!hr.classes['lit-out']);
clock+=3000;hkSky._paint(sky,s);
check('...and fades in on the next paint',hr.values['--near-dark']==='1');
Date.now=realNow;
check('Halloween moon is visible without a rare spooky event',sky.values['--moonI'].indexOf('moon-hallow.webp')>=0&&sky.values['--moonS']==='168px'&&Number(sky.values['--moonO'])>0);
hkSky._force({show:true,spooky:true});s.elev=25;hkSky._paint(sky,s);
check('...and by day, even on a spooky date',spookyRoot.classes.spooky===false);
check('decorative moon fades out in daylight',Number(sky.values['--moonO'])===0&&sky.values['--moonI'].indexOf('moon-hallow.webp')<0);
hkSky._force({show:true,spooky:false});s.elev=-18;hkSky._paint(sky,s);
var candles=sky._hkNear.root.querySelectorAll('.candle-art');
check('Halloween: the lanterns hang in the trees, lit after dark, and the ground pumpkins light up -- the art, not drawn faces',
  candles.length===2&&sky._hkNear.root.querySelectorAll('.prop').length===4&&sky._hkNear.root.querySelectorAll('.patches-lit')[0].children.length===6&&
  !sky._hkNear.root.querySelectorAll('.candle-eye,.candle-mouth,.scenery-bulb').length);
var maskRoot=sky._hkNear.root;maskRoot.clientWidth=1024;maskRoot.clientHeight=600;hkSky._paint(sky,s);
check('tablet resize keeps masks and artwork together',sky._hkNear.root===maskRoot&&maskRoot.querySelectorAll('.candle-art')[0]===candles[0]&&parseFloat(maskRoot.values['--art-h'])===600);
// autumn (Thanksgiving's woodland) is handed spooky:true like every non-Halloween theme
hkSky._force({show:true,spooky:true});s.season='thanksgiving';hkSky._paint(sky,s);
check('autumn keeps its leaves at night',sky._hkNearTheme==='fall'&&sky._hkNear.root.classes.spooky===false);
check('deep in the night the full moon is white again',parts['.moon'].classes.harvest===false);
s.elev=-8;hkSky._paint(sky,s);check('a harvest moon when it is full, early in the night',parts['.moon'].classes.harvest===true);
s.moon=.25;hkSky._paint(sky,s);check('...not at a quarter',parts['.moon'].classes.harvest===false);
var fallRoot=sky._hkNear.root;check('...and geese, each bird an HTML element its flap moves on the compositor (no SVG animated)',
  fallRoot.querySelectorAll('.goose').length===7&&fallRoot.querySelectorAll('path').length===0);s.moon=.5;s.elev=-18;
s.wind=4;hkSky._paint(sky,s);var calm=sky._hkNear.root.querySelectorAll('.lf')[0];s.wind=20;hkSky._paint(sky,s);
check('the leaves fall with the real wind: rebuilt when it blows',sky._hkNear.root.querySelectorAll('.lf')[0]!==calm&&sky._hkNear.root.classes.windy===true);
var gusty=sky._hkNear.root.querySelectorAll('.lf')[0];s.wind=21;hkSky._paint(sky,s);
check('...not at every change in it',sky._hkNear.root.querySelectorAll('.lf')[0]===gusty);s.wind=4;
s.season='';hkSky._force(null);hkSky._surpriseForce('spring-garden');s.elev=20;s.cover=.3;s.wet={kind:'rain',rate:.4};hkSky._paint(sky,s);
var sp=sky._hkNear.root;
check('spring: petals from the blossoms, no rainbow while it rains',sp.querySelectorAll('.petal').length===10&&!sp.classes['rainbow-on']);
s.wet={kind:'none',rate:0};hkSky._paint(sky,s);check('...a rainbow when the sun comes out after it',sp.classes['rainbow-on']===true);
s.cover=.95;hkSky._paint(sky,s);check('...but not under a heavy sky',!sp.classes['rainbow-on']);s.cover=.1;
hkSky._surpriseForce('fourth-of-july');s.elev=-2;hkSky._paint(sky,s);var j4=sky._hkNear.root;
check('the Fourth: fireflies coming out at dusk, the cafe lights breathing',j4.querySelectorAll('.firefly').length===14&&
  Number(j4.values['--near-dusk'])>0.8&&j4.querySelectorAll('.scenery-bulb').filter(function(b){return b.className.split(' ').indexOf('wave')>=0;}).length===6);
check('never shown, nothing to fade: a field built at dusk has the night\'s bats and owl out at once, not after 21 s',
  j4.classes['out-dark']===true&&j4.classes['out-dusk']!==true);
window.hkSettings={get:function(p,f){return p==='sky.birthdays'?[{name:'Emma',month:6,day:12}]:f;},themeOn:function(){return true;}};
hkSky._surpriseForce('birthday');hkSky._paint(sky,s);var bd=sky._hkNear.root;bd.clientWidth=1280;bd.clientHeight=800;
bd.querySelector('.bday-banner').innerHTML='';sky._hkNear.update({now:new Date(2026,5,12,14,0)});
var bannerHTML=bd.querySelector('.bday-banner').innerHTML;
check('a birthday: HAPPY BIRTHDAY EMMA on pennants, a letter each',(bannerHTML.match(/<text/g)||[]).length===17&&/>E<\/text>/.test(bannerHTML));
check('...and confetti on the hour, not at ten past',bd.classes.burst===true&&(sky._hkNear.update({now:new Date(2026,5,12,14,10)}),bd.classes.burst===false));
check('...on one string across a tablet, each pennant an HTML element round its own still drawing',(bannerHTML.match(/fill="none"/g)||[]).length===1&&
  (bannerHTML.match(/<i class="pen"/g)||[]).length===17&&!/<g /.test(bannerHTML));
var rb=bd.querySelectorAll('.balloons')[1].style;
check('...the balloons rising from behind the presents, a balloon the top present\'s size, swaying from the ground',
  Math.abs(parseFloat(rb.left)-1111.2)<0.2&&Math.abs(parseFloat(rb.top)-104.8)<0.2&&Math.abs(parseFloat(rb.height)-564.5)<0.2&&
  rb.transformOrigin==='70% 100%');
var kids=Array.prototype.slice.call(bd.children),fronts=bd.querySelectorAll('.patch');
check('...the rock and the presents drawn over them',fronts.length===2&&/birthday-front-2-v1/.test(fronts[1].style.backgroundImage)&&
  kids.indexOf(bd.querySelectorAll('.balloons')[1])<kids.indexOf(bd.querySelector('.patches'))&&
  Math.abs(parseFloat(fronts[1].style.left)-(1280-262*800/992))<0.2);
var gcs=globalThis.getComputedStyle;globalThis.getComputedStyle=function(){return {left:'0px'};};
bd.clientWidth=390;bd.clientHeight=844;sky._hkNear.update({now:new Date(2026,5,12,14,10)});bannerHTML=bd.querySelector('.bday-banner').innerHTML;
check('...and across a phone, EMMA alone, big enough to read',(bannerHTML.match(/fill="none"/g)||[]).length===1&&
  (bannerHTML.match(/<text/g)||[]).length===4&&parseFloat(bannerHTML.match(/font-size="([\d.]+)"/)[1])>=11);
globalThis.getComputedStyle=gcs;
delete window.hkSettings;
// WOODLAND BETWEEN OCCASIONS (sky.woodland) is its own: the Fourth of July
// switched off leaves summer's woodland up; the setting takes it down.
// ON A DAY BETWEEN OCCASIONS: the sky reads the calendar (routeOf(s, new
// Date())), and from 11 October Halloween is in season -- these failed on
// the real date from then on. A summer day and an early-autumn one, outside
// every occasion's window.
var RealDate=Date,fixedAt=null;
function FixedDate(){if(!arguments.length&&fixedAt!==null)return new RealDate(fixedAt);return new (Function.prototype.bind.apply(RealDate,[null].concat([].slice.call(arguments))))();}
FixedDate.prototype=RealDate.prototype;FixedDate.UTC=RealDate.UTC;FixedDate.parse=RealDate.parse;
FixedDate.now=function(){return fixedAt!==null?fixedAt:RealDate.now();};
globalThis.Date=FixedDate;fixedAt=new RealDate(2026,7,10,12,0).getTime();
var woods=null;window.hkSettings={get:function(p,f){return p==='sky.woodland'?woods:f;},themeOn:function(id){return id!=='fourth-of-july'&&id!=='thanksgiving';}};
s.season='';hkSky._force(null);hkSky._surpriseForce(null);s.land='summer';s.elev=20;hkSky._paint(sky,s);
check('summer woodland stays with the Fourth of July switched off',sky._hkNearTheme==='summer');
woods=['spring','fall','winter'];hkSky._paint(sky,s);check('...and goes when Woodland Between Occasions leaves summer out',!sky._hkNear);
fixedAt=new RealDate(2026,8,15,12,0).getTime();s.land='fall';woods=['fall'];hkSky._paint(sky,s);check('autumn woodland with Thanksgiving switched off',sky._hkNearTheme==='fall');
woods=[];hkSky._paint(sky,s);check('...none chosen: no woodland between occasions',!sky._hkNear);
globalThis.Date=RealDate;
delete s.land;delete window.hkSettings;
// An unmapped surprise keeps the original renderer AND the ordinary moon.
s.season='';hkSky._force(null);hkSky._surpriseForce('valentines-day');hkSky._paint(sky,s);
check('an unmapped surprise with style New keeps its original scene',!sky._hkNear&&parts['.season'].querySelectorAll('.sp-frame').length===1);
check('...and no woodland moon over it',sky.values['--moonS']==='58px'&&!parts['.moon'].classes.woodland&&!parts['.moon'].classes.hallow);
hkSky._surpriseForce('winter-wonderland');hkSky._paint(sky,s);
s.decorationStyle='old';hkSky._paint(sky,s);check('old style removes new artwork and releases observers',!sky._hkNear&&activeObservers===0&&parts['.season'].querySelectorAll('.sp-frame').length===1);
s.decorationStyle='new';hkSky._paint(sky,s);s.decorations=false;hkSky._surpriseForce(null);hkSky._paint(sky,s);check('decorations off removes new scenery',!sky._hkNear&&activeObservers===0);
s.decorations=true;s.season='christmas';hkSky._force({show:true});sky.classes.own=true;hkSky._paint(sky,s);check('forecast always keeps original distant renderer',!sky._hkNear&&activeObservers===0);
// CLOUDS: REALISTIC -- which clouds a sky has, and in what light
function rcCount(p,set){return p.sets.filter(function(x){return x===set;}).length;}
// ASLEEP: the screen's own photo switch counts only while the photos show
(function(){
 var running=false, saverEntity='switch.loft_photo_screensaver';
 window.hkSaver={running:function(){return running;},config:function(){return {entity:saverEntity};}};
 hkSky._sleepAs('switch.loft_photo_screensaver','on');
 check('the photo switch on, the photos not showing (under the kiosk\'s black): the sky stays awake',hkSky.asleep()===false);
 running=true;
 check('...the photos showing: asleep',hkSky.asleep()===true);
 running=false; saverEntity='switch.other_photo_screensaver';
 check('a sleep entity hk-saver does not own: followed as before (on = asleep)',hkSky.asleep()===true);
 hkSky._sleepAs('switch.loft_photo_screensaver','off');
 check('...off = awake',hkSky.asleep()===false);
 saverEntity='switch.loft_photo_screensaver'; hkSky._sleepAs('switch.loft_photo_screensaver','on');
 fire('kiosksatellite:screensaverstart');
 check('under the kiosk\'s black (photos not showing): asleep for the idle work, and the cards pause',hkSky.asleep()===true&&window.__hkAsleep===true);
 fire('kiosksatellite:screensaverstop');
 check('...the black ends: awake, the cards move again',hkSky.asleep()===false&&window.__hkAsleep===false);
 fire('kiosksatellite:screenoff');
 check('the panel off: the same',hkSky.asleep()===true);
 fire('kiosksatellite:screenon');
 (LISTEN['hk-black']||[]).forEach(function(f){f({type:'hk-black',detail:{on:true}});});
 check('HK\'s own black screen (hk-black): held the same',hkSky.asleep()===true&&window.__hkAsleep===true);
 (LISTEN['hk-black']||[]).forEach(function(f){f({type:'hk-black',detail:{on:false}});});
 check('...and awake when it ends',hkSky.asleep()===false);
 delete window.hkSaver; hkSky._sleepAs(null,'off');
})();
var fair=hkSky._rcPlan({cover:.15,cond:'sunny'}),partly=hkSky._rcPlan({cover:.45,cond:'partlycloudy'}),mostly=hkSky._rcPlan({cover:.75,cond:'cloudy'});
check('realistic clouds: a fair day has a handful of cumulus, a partly cloudy sky more, a mostly cloudy one most',
  !fair.deck&&rcCount(fair,'cu')>=3&&rcCount(fair,'cu')<rcCount(partly,'cu')&&rcCount(partly,'cu')<rcCount(mostly,'cu'));
check('...the haze on the horizon once it clouds up',rcCount(partly,'horizon-haze')===1&&rcCount(fair,'horizon-haze')===0);
check('...never more than 28 clouds',[0,.1,.3,.5,.7,.84].every(function(c){return hkSky._rcPlan({cover:c,cond:'lightning'},7).sets.length<=28&&hkSky._rcPlan({cover:c,cond:'partlycloudy'},7).sets.length<=28;}));
var lid=hkSky._rcPlan({cover:.95,cond:'cloudy'}),wetLid=hkSky._rcPlan({cover:.65,cond:'rainy'});
check('...overcast, or rain under a heavy sky, is the deck as a ceiling, scud under it (more in rain) and haze on the horizon',
  lid.deck&&wetLid.deck&&rcCount(lid,'scud')===3&&rcCount(wetLid,'scud')===5&&rcCount(lid,'horizon-haze')===1);
check('...a thunderstorm is the grey lid, whatever cover it is reported with',hkSky._rcPlan({cover:.5,cond:'lightning'}).deck===true&&
  hkSky._rcPlan({cover:.2,cond:'lightning-rainy'}).deck===true&&hkSky._rcLight({elev:40,cover:.5,cond:'lightning'})==='grey'&&
  hkSky._rcLight({elev:5,cover:.3,cond:'lightning-rainy'})==='grey');
check('...the light: day (a shower from a broken sky too), grey under a lid, golden low, dusk below the horizon, night',
  hkSky._rcLight({elev:40,cover:.3})==='day'&&hkSky._rcLight({elev:40,cover:.9})==='grey'&&hkSky._rcLight({elev:40,cover:.3,cond:'rainy'})==='day'&&
  hkSky._rcLight({elev:5,cover:.3})==='golden'&&hkSky._rcLight({elev:-3,cover:.3})==='dusk'&&hkSky._rcLight({elev:-12,cover:.3})==='night');
// THE STILL ART AS ONE CANVAS (nearFlat): the four layers' own geometry,
// drawn in their order, once per size; the phone the right tree alone.
(function(){
 var ops=[],ctxs=0,dc=document.createElement,ImgWas=globalThis.Image,dpr0=globalThis.devicePixelRatio;
 function ctx(name){ctxs++;var c={setTransform:function(){},createLinearGradient:function(){var g={stops:[],addColorStop:function(o,col){g.stops.push(o+' '+col);}};return g;},
  fillRect:function(x,y,w,h){ops.push(name+' fill '+[x,y,w,h].join(',')+' '+(c.fillStyle&&c.fillStyle.stops?c.fillStyle.stops.join('|'):''));},
  drawImage:function(im,x,y,w,h){ops.push(name+' '+((c.globalCompositeOperation||'source-over')==='source-over'?'over':c.globalCompositeOperation)+' '+(im.src||'scratch').split('/').pop().slice(0,12)+' '+[x,y,w,h].filter(function(v){return v!==undefined;}).map(function(v){return Math.round(v);}).join(','));}};return c;}
 document.createElement=function(t){var n=dc(t);if(t==='canvas'){var name=ctxs?'piece':'main';n.getContext=function(){return n._c||(n._c=ctx(name));};}return n;};
 globalThis.Image=function(){var im=this;Object.defineProperty(im,'src',{set:function(v){im._s=v;im.onload&&im.onload();},get:function(){return im._s;}});};
 globalThis.devicePixelRatio=1.5;
 var r=node(),f=hkSky._nearFlat(r,'/art/halloween-v1.webp',{left:'mask-left.svg',right:'mask-right.svg'},'#302919');
 check('the still art is ONE canvas in the scenery, relit like the layers were',!!f&&r.children.length===1&&/scenery-art/.test(f.canvas.className)&&/scenery-flat/.test(f.canvas.className));
 f.draw(1280,800,false,1279,800);
 check('...the screen at its density',f.canvas.width===1920&&f.canvas.height===1200);
 var main=ops.filter(function(o){return o.indexOf('main')===0;}),piece=ops.filter(function(o){return o.indexOf('piece')===0;});
 check('...the wash first: transparent to 60%, the ground color by 90%',/^main fill 0,0,1280,800 0.6 rgba\(48,41,25,0\)\|0.9 rgba\(48,41,25,1\)$/.test(main[0]),main[0]);
 check('...then the valley at twice the width, centred, cut from 35% to 40% down',piece[0]==='piece over halloween-v1 -640,0,2560,800'&&/^piece fill 0,0,1280,800 0.35 rgba\(0,0,0,0\)\|0.4 rgba\(0,0,0,1\)$/.test(piece[1]),piece.slice(0,2));
  check('...then each tree at the art\'s size on its own edge, cut by its mask',piece[2]==='piece over halloween-v1 0,0,1279,800'&&piece[3]==='piece destination-in mask-left.sv 0,0,1279,800'&&
  piece[4]==='piece over halloween-v1 1,0,1279,800'&&piece[5]==='piece destination-in mask-right.s 1,0,1279,800',piece.slice(2));
 check('...each laid on the canvas in that order',main.slice(1).join()==='main over scratch 0,0,main over scratch 0,0,main over scratch 0,0');
 var n=ops.length;f.draw(1280,800,false,1279,800);
 check('...drawn again only when the size changes',ops.length===n);
 ops.length=0;f.draw(390,844,true,1349.4,844);
 check('a phone: the right tree alone, filling the width, unmasked',ops.length===1&&ops[0]==='main over halloween-v1 -959,0,1349,844',ops);
 document.createElement=function(t){var n=dc(t);if(t==='canvas')n.getContext=function(){return null;};return n;};
 check('no canvas to draw on: none (the four layers instead)',hkSky._nearFlat(node(),'a',{left:'l',right:'r'},'#000')===null);
 document.createElement=dc;globalThis.Image=ImgWas;globalThis.devicePixelRatio=dpr0;
})();
// THE NORTHERN LIGHTS AS SMALL CANVASES (auroraDraw): a quarter of the
// curtain's size, the glow under the stripes, the stripes' 18% repeat.
(function(){
 var dc=document.createElement,calls=[];
 function ctx(){return {setTransform:function(a,b,c,d){calls.push('scale '+a.toFixed(2)+','+d.toFixed(2));},
  createLinearGradient:function(x0,y0,x1,y1){var g={line:[x0,y0,x1,y1],stops:[],addColorStop:function(o,c){g.stops.push([o,c]);}};return g;},
  fillRect:function(){calls.push(this.fillStyle);}};}
 var band=node();band.clientWidth=1792;band.clientHeight=480;
 var cv=dc('canvas');cv.getContext=function(){return cv._c||(cv._c=ctx());};band._hkCv=cv;
 hkSky._auroraDraw(band);
 check('a curtain drawn at a quarter of its size, scaled to it',cv.width===448&&cv.height===120&&calls[0]==='scale 0.25,0.25');
 var glow=calls[1],stripes=calls[2];
 check('...the glow first: clear to 8%, green by 42%, blue by 72%, gone at the foot',
  JSON.stringify(glow.stops)===JSON.stringify([[0.08,'rgba(80,255,170,0)'],[0.42,'rgba(80,255,170,.5)'],[0.72,'rgba(60,180,255,.14)'],[1,'rgba(60,180,255,0)']])&&glow.line.join()==='0,0,0,480');
 var per=stripes.stops.filter(function(s){return s[1]==='rgba(90,255,170,.42)';}).map(function(s){return s[0];});
 check('...then the stripes at 100deg, six repeats each 1/6 of the line, the green at 9% of each',
  per.length===6&&Math.abs(per[1]-per[0]-1/6)<1e-9&&Math.abs(per[0]-0.09/(6*0.18))<1e-9&&stripes.line[2]>stripes.line[0]&&stripes.line[3]>stripes.line[1]);
 var n=calls.length;hkSky._auroraDraw(band);
 check('...drawn again only at a new size',calls.length===n);
})();
print(fail?'FAIL '+fail+' NEAR SCENERY TESTS':'ALL '+pass+' NEAR SCENERY TESTS PASS');
