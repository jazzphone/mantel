var root = HK_ROOT;
let pass=0, fail=0;
function check(name, condition) { print((condition?'PASS ':'FAIL ')+name); condition?pass++:fail++; }
load(root+'/tests/dom.js');
['hk-base','hk-tile','hk-layout'].forEach(n=>load(root+'/frontend/cards/'+n+'.js'));
function card(tag,cfg={}) { let c=Object.create(customElements.get(tag).prototype);c._config=cfg;c._hass={states:{}}; return c; }
function state(s,attributes={}) {return {state:s,attributes};}
for (const [tag,cfg] of [['hk-light-card',{}],['hk-tile-card',{label_mode:'brightness'}]]) {
 let c=card(tag,cfg);
 check(tag+' unknown',c._label(state('unknown'))==='Unknown');
 check(tag+' unavailable',c._label(state('unavailable',{brightness:255}))==='Unavailable');
 check(tag+' missing',c._label(null)==='Unknown');
 check(tag+' normal brightness',c._label(state('on',{brightness:128}))==='50%');
}
for (const [tag,cfg] of [['hk-cover-card',{}],['hk-tile-card',{label_mode:'position'}]]) {
 let c=card(tag,cfg);
 check(tag+' stale closed position',c._label(state('unavailable',{current_position:0}))==='Unavailable');
 check(tag+' stale open position',c._label(state('unknown',{current_position:100}))==='Unknown');
 check(tag+' normal position',c._label(state('open',{current_position:45}))==='45%');
}
check('explicit light label preserved',card('hk-light-card',{label:'Desk'})._label(state('unknown'))==='Desk');
let f=card('hk-frame-card',{card:{type:'entities'}}),updates=[],renders=0;
f._render=()=>renders++;
f._child={set hass(h){updates.push(h);}};
let h1={states:{}},h2={states:{}};
f.hass=h1;f.hass=h2;
check('frame forwards latest hass after static gate',updates.includes(h2));
check('frame remains static wrapper',renders===1);
let pending=[]; window.loadCardHelpers=()=>new Promise(resolve=>pending.push(resolve));
f=card('hk-frame-card',{card:{type:'entities'}}); let old=f._config, appended=[];
f._e={appendChild:e=>appended.push(e)};f._build();
f._config={card:{type:'sensor'}};f._build();
const helpers={createCardElement:c=>({type:c.type,style:{setProperty(){}}})};
pending[1](helpers);pending[0](helpers);
Promise.resolve().then(()=>{
 check('obsolete asynchronous frame child discarded',appended.length===1 && appended[0].type==='sensor');
 window.hkHeader={status:()=>({alarmRaw:'disarmed',unlocked:0,alert:false,unusable:1})};
 let info=card('hk-info-card',{garage:'cover.garage'});info._hass.states['cover.garage']=state('unknown');
 check('info card garage unknown label',info._security().lines[1]==='Garage Unknown');
 info._hass.states['cover.garage']=state('closed');
 check('info card garage closed label',info._security().lines[1]==='Garage Closed');
 print(fail ? 'FAIL '+fail+' AUDIT TESTS' : 'ALL '+pass+' AUDIT TESTS PASS');
});
