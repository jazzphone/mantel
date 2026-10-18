// Sky Liveliness (hk-sky.js lvOf; plan hk_house/docs/PLAN-SKY-LIVELINESS-2026-10-08.md):
// how many of the little moving things there are and how often the crossers
// come, per occasion and per screen. Classic must be the old scene exactly;
// one effect's count must never move another's; a cycle changes how often,
// never how fast.
var pass=0,fail=0;
function check(label,condition,got){print((condition?'PASS ':'FAIL ')+label+(condition||got===undefined?'':'   got '+JSON.stringify(got)));condition?pass++:fail++;}
globalThis.window=globalThis;globalThis.location={pathname:'/test'};
globalThis.addEventListener=function(){};globalThis.setInterval=function(){return 1;};globalThis.clearInterval=function(){};
globalThis.setTimeout=function(){return 1;};
globalThis.ResizeObserver=function(){this.observe=function(){};this.disconnect=function(){};};
globalThis.getComputedStyle=function(){return {left:'300px'};};
function node(){
 var n={children:[],className:'',values:{},classes:{},clientWidth:1280,clientHeight:800};
 n.style={setProperty:function(k,v){n.values[k]=v;},getPropertyValue:function(k){return n.values[k]||'';}};
 n.classList={contains:function(k){return !!n.classes[k]||n.className.split(' ').indexOf(k)>=0;},toggle:function(k,on){n.classes[k]=on===undefined?!n.classes[k]:!!on;},add:function(k){n.classes[k]=true;},remove:function(k){delete n.classes[k];}};
 n.appendChild=function(c){c.parent=n;n.children.push(c);return c;};
 n.insertBefore=function(c,b){if(c.parent)c.remove();c.parent=n;var i=n.children.indexOf(b);n.children.splice(i<0?n.children.length:i,0,c);return c;};
 n.querySelectorAll=function(sel){var out=[];function walk(a){a.children.forEach(function(c){if(sel.split(',').some(function(t){return c.className.split(' ').indexOf(t.trim().slice(1))>=0;}))out.push(c);walk(c);});}walk(n);return out;};
 n.querySelector=function(sel){return n.querySelectorAll(sel)[0]||null;};
 n.remove=function(){if(n.parent)n.parent.children=n.parent.children.filter(function(c){return c!==n;});};
 n.getRootNode=function(){return null;};
 n.getBoundingClientRect=function(){return {left:0,top:0,width:n.clientWidth,height:n.clientHeight};};
 Object.defineProperty(n,'textContent',{set:function(){n.children=[];}});return n;
}
globalThis.document={createElement:node,readyState:'complete',head:node(),body:node(),addEventListener:function(){},querySelector:function(){return null;},querySelectorAll:function(){return [];},getElementById:function(){return null;}};
load(HK_ROOT+'/frontend/modules/hk-sky.js');
var LV=hkSky._lv;

// ---- the keyframes copy: percentages scaled, 0% and 100% kept, values untouched
check('a crossing\'s keyframes scale by base/new cycle, its values untouched',
  LV.kfScale('0%{opacity:0}1%{opacity:.85}5%{transform:translate3d(10%,0,0)}11%,100%{opacity:0}',0.5)===
  '0%{opacity:0}0.5%{opacity:.85}2.5%{transform:translate3d(10%,0,0)}5.5%,100%{opacity:0}',
  LV.kfScale('0%{opacity:0}1%{opacity:.85}5%{transform:translate3d(10%,0,0)}11%,100%{opacity:0}',0.5));
check('...and never past 99.9%',LV.kfScale('50%{a:1}',3)==='99.9%{a:1}');

// ---- lvOf: one preset for every occasion, or Custom -- each its own
var L=LV.lvOf({lively:{}});
check('nothing set is Classic (Normal) for every knob',L.knob('halloween','bats')===2&&L.many('halloween','bats')===1&&L.cycle('x','geese')===1);
L=LV.lvOf({lively:{all:'festive'}});
check('one preset for every occasion: Festive is Lots everywhere',L.knob('halloween','bats')===3&&L.many('fall','leaves')===1.6&&L.many('christmas','snow')===1.6);
L=LV.lvOf({lively:{all:'subtle',occ:{halloween:'party'}}});
check('...and each occasion\'s own choice counts only under Custom',L.knob('halloween','bats')===1);
L=LV.lvOf({lively:{all:'custom',occ:{halloween:'festive',fall:'subtle'}}});
check('Custom: Festive is Lots, Subtle is Few, each occasion its own, the rest Classic',L.knob('halloween','bats')===3&&L.many('halloween','leaves')===1.6&&L.many('fall','leaves')===.5&&L.many('christmas','snow')===1);
L=LV.lvOf({lively:{all:'custom',occ:{halloween:'custom'},custom:{halloween:{bats:0,witch:4}}}});
check('an occasion\'s Custom reads each knob, Normal where it has none',L.many('halloween','bats')===0&&L.cycle('halloween','witch')===.4&&L.many('halloween','leaves')===1);
check('...and Off turns a crosser off',!L.on('halloween','bats')&&L.on('halloween','witch'));
L=LV.lvOf({lively:{all:'calm'}});
check('an unknown preset is Classic',L.knob('halloween','bats')===2);
check('the signature changes with any setting, and not with being quiet',
  LV.lvOf({lively:{}}).sig!==LV.lvOf({lively:{all:'party'}}).sig&&
  LV.lvOf({lively:{all:'custom',occ:{halloween:'party'}}}).sig!==LV.lvOf({lively:{all:'custom'}}).sig&&
  LV.lvOf({lively:{quiet:true}}).sig===LV.lvOf({lively:{}}).sig);
check('...and an occasion\'s own changes only with what reaches it',
  LV.lvOf({lively:{all:'custom',occ:{spring:'party'}}}).sigFor('halloween')===LV.lvOf({lively:{}}).sigFor('halloween')&&
  LV.lvOf({lively:{all:'party'}}).sigFor('halloween')!==LV.lvOf({lively:{}}).sigFor('halloween'));

// ---- lvRange: the shared stream never moves
var a=[],b=[];
function stream(seed){var x=seed;return function(){x=(x*16807)%2147483647;return x/2147483647;};}
var r1=stream(7),r2=stream(7);
LV.lvRange(5,2,r1,99,function(i,r){a.push(r());return i;});var after1=r1();
LV.lvRange(5,9,r2,99,function(i,r){b.push(r());return i;});var after2=r2();
check('fewer or more, the scene\'s own stream is drawn exactly as before',after1===after2&&a.join()===b.slice(0,5).join());

// ---- the Halloween woodland at night
var sky=node(),parts={};sky.querySelector=function(sel){return parts[sel]||(parts[sel]=node());};
sky.querySelector('.moon').getBoundingClientRect=function(){return {left:1100,top:40,width:76,height:76};};
var s={decorationStyle:'new',elev:-18,azim:180,cover:.1,wind:4,fog:false,wet:{kind:'none',rate:0},moon:.5,season:'halloween',seasonalOn:true,decorations:true};
hkSky._force({show:true,spooky:false});
function scene(lively){s.lively=lively;hkSky._paint(sky,s);return sky._hkNear.root;}
function bats(root,f){var dark=root.querySelectorAll('.dark')[0];return dark?dark.querySelectorAll('.flock')[f].children:[];}
function sig(root){return bats(root,0).concat(bats(root,1)).map(function(x){return x.values['--fl']+'/'+x.values['--bdel'];}).join(' ')+'|'+root.querySelectorAll('.lf').length;}
var r0=scene(undefined),before=sig(r0);
check('the old scene: 3 bats and 2 across the moon, a swarm of 7, the owl and the mist',
  bats(r0,0).length===3&&bats(r0,1).length===2&&r0.querySelectorAll('.night')[0].querySelectorAll('.bat').length===7&&r0.querySelectorAll('.owl').length===1);
var rf=scene({all:'festive'});
var rc=scene({all:'custom',occ:{halloween:'classic'}});
check('Classic is that scene exactly (rebuilt, every bat\'s draws the same)',rc!==rf&&sig(rc)===before,[sig(rc),before]);
check('Festive: more bats in each flock (5 and 3)',bats(rf,0).length===5&&bats(rf,1).length===3);
check('...the first three the very same bats',bats(rf,0).slice(0,3).map(function(x){return x.values['--fl'];}).join()===bats(rc,0).map(function(x){return x.values['--fl'];}).join());
var rx=scene({all:'custom',occ:{halloween:'custom'},custom:{halloween:{bats:0,owl:0,mist:0}}});
check('Custom, Bat Flocks Off: no bats, and nothing else moved (the leaves the same)',bats(rx,0).length===0&&bats(rx,1).length===0&&
  rx.querySelectorAll('.lf').length===r0.querySelectorAll('.lf').length);
check('...Owl and Mist Off',rx.querySelectorAll('.owl')[0].style.display==='none'&&rx.querySelectorAll('.moon-mist')[0].style.display==='none');
var ro=scene({all:'custom',occ:{halloween:'custom'},custom:{halloween:{bats_often:4}}});
var bb=bats(ro,0)[0];
check('Bat Flocks how often at Max: a cycle of 0.4x (28.4 s), on keyframes scaled to keep the crossing\'s speed',
  bb.values['--bd']==='28.4s'&&bb.style.animationName==='near-flock-x2500',[bb.values['--bd'],bb.style.animationName]);
var rq=scene({all:'subtle'});
check('Subtle for every occasion: flocks of 2 and 1',bats(rq,0).length===2&&bats(rq,1).length===1);
var rl=scene({all:'custom',occ:{halloween:'party'},quiet:true});
check('Calm When Nobody\'s Around, with nobody there: the scene is thinned, not rebuilt (lv-quiet; every second bat marked)',
  rl.classes['lv-quiet']===true&&bats(rl,0)[1].classes['lv-t']===true&&!bats(rl,0)[0].classes['lv-t']);
s.lively={all:'custom',occ:{halloween:'party'},quiet:false};hkSky._paint(sky,s);
check('...and someone back: the same scene, whole again',sky._hkNear.root===rl&&!rl.classes['lv-quiet']);

var rkeep=scene({all:'custom',occ:{halloween:'party',spring:'festive'},quiet:false});
check('another occasion\'s setting changes nothing on show (no rebuild of Halloween)',rkeep===rl);
// ---- Christmas glints, the sleigh; winter's aurora; spring's petals
s.season='christmas';hkSky._force({show:true,spooky:false});
var x0=scene(undefined),g0=x0.querySelectorAll('.glint').length;
var x1=scene({all:'custom',occ:{christmas:'party'}});
check('Christmas snow sparkles: 22, and 55 at Party',g0===22&&x1.querySelectorAll('.glint').length===55);
var x2=scene({all:'custom',occ:{christmas:'custom'},custom:{christmas:{sleigh:0,lights:0}}});
check('Sleigh Off: no sleigh; Lights Off: steady (lv-still)',!x2.querySelector('.sleigh')&&x2.classes['lv-still']===true);

// ---- the table is the same everywhere
var model=read(HK_ROOT+'/frontend/panels/hk-settings-model.js'),py=read(HK_ROOT+'/settings.py');
var knobs=Object.keys(LV.KNOBS);
check('every knob has its kind and type in settings.py LIVELY_KNOBS',knobs.every(function(k){
  var m=new RegExp('"'+k+'": *\\("'+LV.KNOBS[k][0]+'", *"'+LV.KNOBS[k][1]+'"\\)').exec(py);return !!m;}),
  knobs.filter(function(k){return !new RegExp('"'+k+'": *\\("'+LV.KNOBS[k][0]+'", *"'+LV.KNOBS[k][1]+'"\\)').test(py);}));
var pyKnobs=(/\nLIVELY_KNOBS[^=]*= \{([\s\S]*?)\n\}/.exec(py)||[,''])[1].match(/"([a-z_]+)": *\(/g)||[];
check('...and settings.py has no knob the sky does not draw',pyKnobs.length===knobs.length,pyKnobs.length);
load(HK_ROOT+'/frontend/panels/hk-settings-model.js');
var ML=window.hkSettingsModel.LIVELY;
check('every knob is labelled in HK Settings (hk-settings-model.js LIVELY), and nothing else is',
  knobs.every(function(k){return !!ML[k];})&&Object.keys(ML).length===knobs.length,knobs.filter(function(k){return !ML[k];}));

print(fail?'FAIL '+fail+' LIVELINESS TESTS':'ALL '+pass+' LIVELINESS TESTS PASS');
