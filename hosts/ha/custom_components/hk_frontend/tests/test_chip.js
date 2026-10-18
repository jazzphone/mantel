// Resolved relative to this file so the suite runs from anywhere.
var DIR = (function(){ var p = HK_ROOT + '/tests/'; return p; })();
load(DIR + 'dom.js');
// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
load(HK_ROOT + '/frontend/cards/hk-chip.js');
var C = customElements.get('hk-status-chip-card');
var labelFor = window.hkCards.labelFor;
var pass=0, fail=0;
function ok(n,c,x){ if(c){pass++;print('  PASS  '+n);} else {fail++;print('  FAIL  '+n+(x?'   '+x:''));} }
function S(state, u){ return {state:state, last_updated:u||'t', attributes:{}}; }
function card(cfg, states){
  // A STUB, not the element: the shim has no querySelector and building one
  // would test the shim, not the card. labelFor is pure by design.
  var st = states || {};
  return { cfg: cfg, states: st, _st: function (id) { return st[id] || null; } };
}
function label(c){ return labelFor(c, c.cfg, c._st(c.cfg.entity)); }

print('=== map: on/off to two words (Storm, EPS) ===');
ok('on -> Armed', label(card({entity:'binary_sensor.storm', label_map:{on:'Armed', off:'Off'}},
   {'binary_sensor.storm':S('on')}))==='Armed');
ok('off -> Off', label(card({entity:'binary_sensor.storm', label_map:{on:'Armed', off:'Off'}},
   {'binary_sensor.storm':S('off')}))==='Off');
ok('unknown falls back', label(card({entity:'x.y', label_map:{on:'Armed'}, fallback:'--'},
   {'x.y':S('unknown')}))==='--');

print('\n=== title-case a state (Source) ===');
ok('grid_power -> Grid Power', label(card({entity:'s.src', label_case:'title'},
   {'s.src':S('grid_power')}))==='Grid Power');
ok('GRID-POWER -> Grid Power', label(card({entity:'s.src', label_case:'title'},
   {'s.src':S('GRID-POWER')}))==='Grid Power');

print('\n=== sensor + format (Lights, Energy, Timers) ===');
ok('"{v} On"', label(card({entity:'s.l', format:'{v} On'}, {'s.l':S('3')}))==='3 On');
ok('decimals', label(card({entity:'s.p', format:'{v} kW', decimals:1}, {'s.p':S('2.63')}))==='2.6 kW');
ok('zero override (Timers "None")',
   label(card({entity:'s.t', format:'{v} On', zero:'None'}, {'s.t':S('0')}))==='None');
ok('non-zero keeps the format',
   label(card({entity:'s.t', format:'{v} On', zero:'None'}, {'s.t':S('2')}))==='2 On');

print('\n=== count entities in a state (Security, Vacuums) ===');
var locks={'lock.a':S('locked'),'lock.b':S('unlocked'),'lock.c':S('unlocked')};
ok('counts matches', label(card({entity:'x.y', count:{entities:['lock.a','lock.b','lock.c'], match:'unlocked'},
   format:'{v} Unlocked'}, locks))==='2 Unlocked');
ok('match accepts a LIST of states',
   label(card({entity:'x.y', count:{entities:['v.a','v.b'], match:['cleaning','returning']}, format:'{v}'},
   {'v.a':S('cleaning'),'v.b':S('docked')}))==='1');
ok('zero applies to counts too',
   label(card({entity:'x.y', count:{entities:['v.a'], match:'cleaning'}, zero:'Idle'},
   {'v.a':S('docked')}))==='Idle');

print('\n=== an explicit label still wins ===');
ok('label beats everything', label(card({entity:'s.x', label:'literal', format:'{v} On'},
   {'s.x':S('9')}))==='literal');
ok('no keys -> the entity state',
   label(card({entity:'s.x'}, {'s.x':S('hello')}))==='hello');

print('\n=== THE SIGNATURE DECLARES WHAT THE LABEL READS ===');
function sig(cfg, states){
  return C.prototype._sigOf.call({ _hass: { states: states }, _config: cfg });
}
var base={'lock.a':S('locked','t1'),'lock.b':S('locked','t1'),'s.src':S('grid','t1')};
var moved={'lock.a':S('locked','t1'),'lock.b':S('unlocked','t2'),'s.src':S('grid','t1')};
ok('a counted entity changing changes the signature',
   sig({entity:'x.y', count:{entities:['lock.a','lock.b'], match:'unlocked'}}, base) !==
   sig({entity:'x.y', count:{entities:['lock.a','lock.b'], match:'unlocked'}}, moved));
ok('a `source` entity is watched',
   sig({entity:'x.y', source:'s.src'}, base) !==
   sig({entity:'x.y', source:'s.src'}, {'s.src':S('battery','t9')}));
ok('an unrelated entity does NOT change it (the gate still holds)',
   sig({entity:'x.y', count:{entities:['lock.a']}}, base) ===
   sig({entity:'x.y', count:{entities:['lock.a']}},
       {'lock.a':S('locked','t1'), 'light.other':S('on','t9')}));


print('\n=== icon_color_states: a color per state ===');
var colour = window.hkCards.colourForChip;
function CS(state){ return {state:state, entity_id:'binary_sensor.x', attributes:{}}; }
var m = {icon_color_states:{on:'yellow', 'default':'gray'}};
ok('on and off resolve to DIFFERENT colours', colour(m,CS('on'))!==colour(m,CS('off')),
   colour(m,CS('on'))+' vs '+colour(m,CS('off')));
ok('off resolves to the default entry',
   colour(m, CS('off'))===colour({icon_color:'gray'}, CS('off')));
ok('an unlisted state falls to default',
   colour(m, CS('weird'))===colour({icon_color:'gray'}, CS('weird')));
ok('a static icon_color is unaffected by state',
   colour({icon_color:'blue'}, CS('on'))===colour({icon_color:'blue'}, CS('off')));
ok('no colour config still returns something', !!colour({}, CS('on')));
ok('icon_color_states does not mutate the caller config', (function(){
   var c={icon_color_states:{on:'yellow'}}; colour(c, CS('on'));
   return c.icon_color===undefined; })());


// A chip's label, icon and color are all keyed off the same number.
// zero/nonzero keeps the three in agreement by construction rather than by
// three copies of the same condition.
print('\n=== zero / nonzero keys on the maps ===');
var vac={'v.a':S('docked'),'v.b':S('docked')};
var busy={'v.a':S('cleaning'),'v.b':S('docked')};
var cfgV={entity:'x.y', count:{entities:['v.a','v.b'], match:['cleaning','returning']},
          zero:'Idle', format:'{v} Cleaning',
          icon_states:{zero:'hk:robot-vacuum', nonzero:'hk:robot-vacuum-alert'},
          icon_color_states:{zero:'gray', nonzero:'blue'}};
ok('label: 0 -> Idle',      label(card(cfgV, vac))==='Idle');
ok('label: 1 -> 1 Cleaning', label(card(cfgV, busy))==='1 Cleaning');
var pick = window.hkCards.pickChip;
ok('icon map: zero branch',    pick(cfgV.icon_states, 0)==='hk:robot-vacuum');
ok('icon map: nonzero branch', pick(cfgV.icon_states, 2)==='hk:robot-vacuum-alert');
ok('colour map: zero branch',    pick(cfgV.icon_color_states, 0)==='gray');
ok('colour map: nonzero branch', pick(cfgV.icon_color_states, 5)==='blue');
ok('an exact state key still beats zero/nonzero',
   pick({'0':'exact', zero:'zeroKey'}, 0)==='exact');
ok('a non-numeric value uses default',
   pick({zero:'z', nonzero:'n', 'default':'d'}, 'grid_power')==='d');
ok('a missing key returns null rather than undefined',
   pick({on:'x'}, 'off')===null);


// A summary chip stands for a SET, so it has no single entity. Requiring one
// makes Lights/Timers/Vacuums/Speakers throw at setConfig and Home Assistant
// draws error cards in their place -- invisible to a probe that looks for
// the card element and finds none.
print('\n=== setConfig: what a chip must name ===');
function accepts(cfg){
  try { var c=new C(); C.prototype.setConfig.call({ _config:null,
        _render:function(){}, constructor:C }, cfg); return true; }
  catch(e) { return false; }
}
ok('entity alone is accepted',            accepts({entity:'light.x'}));
ok('source alone is accepted (Lights)',   accepts({source:'sensor.count'}));
ok('count alone is accepted (Vacuums)',   accepts({count:{entities:['v.a']}}));
ok('none of them is REJECTED',            !accepts({name:'Nothing'}));
ok('an empty config is rejected',         !accepts({}));
// Climate has NO top-level source -- its sources live inside parts. A guard
// that misses them throws, and HA draws an error card mid-row.
ok('parts alone is accepted (Climate)',   accepts({parts:[{source:'s.t'}]}));
ok('label_rules alone is accepted',       accepts({label_rules:[{label:'x'}]}));


// ---------------------------------------------------------------------------
// The four chips that need more than the flat vocabulary. These tests encode
// exactly what each one must say, so a difference shows up as a failure rather
// than as a chip that quietly says something else.
print('\n=== label_rules: first match wins (Security) ===');
var SEC = {
  count: {entities:['lock.a','lock.b','lock.c','lock.d'], match:'unlocked'},
  label_rules: [
    { when:{entity:'alarm_control_panel.p', state:'triggered'},
      source:'alarm_control_panel.p', label_case:'title' },
    { when:{above:0}, format:'{v} Unlocked' },
    { source:'alarm_control_panel.p', label_case:'title' }
  ]};
function sec(alarm, unlocked){
  var st={'alarm_control_panel.p':S(alarm)};
  ['lock.a','lock.b','lock.c','lock.d'].forEach(function(e,i){
    st[e]=S(i<unlocked?'unlocked':'locked'); });
  return label(card(SEC, st));
}
ok('triggered wins over unlocked locks', sec('triggered',2)==='Triggered', sec('triggered',2));
ok('unlocked locks beat a quiet alarm',  sec('armed_away',2)==='2 Unlocked', sec('armed_away',2));
ok('all locked -> the alarm state',      sec('armed_away',0)==='Armed Away', sec('armed_away',0));
ok('disarmed and all locked',            sec('disarmed',0)==='Disarmed', sec('disarmed',0));
ok('one unlocked',                       sec('disarmed',1)==='1 Unlocked', sec('disarmed',1));

print('\n=== parts: join, with conditional segments (Climate) ===');
var CLIM = { join:' | ', parts:[
  { source:'sensor.temp', decimals:0, format:'{v}°' },
  { source:'sensor.fans', when:{above:0}, format:'{v} Fans' } ]};
function clim(t,f){ return label(card(CLIM,{'sensor.temp':S(t),'sensor.fans':S(f)})); }
ok('no fans -> temperature only', clim('79.4','0')==='79°', clim('79.4','0'));
ok('fans on -> both segments',    clim('79.4','2')==='79° | 2 Fans', clim('79.4','2'));
ok('rounding is applied',         clim('78.6','0')==='79°', clim('78.6','0'));

print('\n=== parts: three readings (House Battery) ===');
var BAT = { parts:[
  { source:'sensor.pct',  decimals:0, format:'{v}%' },
  { source:'sensor.kwh',  decimals:0, format:'{v} kWh' },
  { source:'sensor.hrs',  decimals:1, format:'{v}h' } ]};
ok('all three join with the default separator',
   label(card(BAT,{'sensor.pct':S('88'),'sensor.kwh':S('22.4'),'sensor.hrs':S('21.06')}))
   === '88% · 22 kWh · 21.1h',
   label(card(BAT,{'sensor.pct':S('88'),'sensor.kwh':S('22.4'),'sensor.hrs':S('21.06')})));
ok('a missing reading drops its segment rather than printing --',
   label(card(BAT,{'sensor.pct':S('88'),'sensor.kwh':S('unknown'),'sensor.hrs':S('21.06')}))
   === '88% · 21.1h',
   label(card(BAT,{'sensor.pct':S('88'),'sensor.kwh':S('unknown'),'sensor.hrs':S('21.06')})));
ok('everything missing -> the fallback',
   label(card({fallback:'--', parts:BAT.parts},
     {'sensor.pct':S('unknown'),'sensor.kwh':S('unknown'),'sensor.hrs':S('unknown')}))==='--');

print('\n=== the when predicate on its own ===');
var W={source:'s.n'};
function w(cond, val){ return label(card({source:'s.n', label_rules:[
  {when:cond, label:'HIT'}, {label:'MISS'}]}, {'s.n':S(val)})); }
ok('above',            w({above:0},'1')==='HIT' && w({above:0},'0')==='MISS');
ok('below',            w({below:5},'3')==='HIT' && w({below:5},'9')==='MISS');
ok('state equality',   w({state:'on'},'on')==='HIT' && w({state:'on'},'off')==='MISS');
ok('state accepts a list',
   w({state:['a','b']},'b')==='HIT' && w({state:['a','b']},'c')==='MISS');
ok('a number test against a non-number does not match',
   w({above:0},'hello')==='MISS');
ok('no rule matches -> fallback, not a crash',
   label(card({source:'s.n', fallback:'--', label_rules:[{when:{above:99}, label:'X'}]},
     {'s.n':S('1')}))==='--');


print('\n=== icon_rules: the icon branches too (Security) ===');
var rv = window.hkCards.ruleValue;
var SECICON = [
  { when:{entity:'alarm_control_panel.p', state:'triggered'}, icon:'hk:shield-alert' },
  { when:{above:0},                                          icon:'hk:lock-open-variant' },
  { when:{entity:'alarm_control_panel.p', state:['armed_away','armed_home']},
                                                             icon:'hk:shield-lock' },
  { icon:'hk:shield-off' }
];
function secIcon(alarm, unlocked){
  var st={'alarm_control_panel.p':S(alarm)};
  ['lock.a','lock.b'].forEach(function(e,i){ st[e]=S(i<unlocked?'unlocked':'locked'); });
  var c=card({count:{entities:['lock.a','lock.b'], match:'unlocked'}}, st);
  return rv(c, c.cfg, null, SECICON, 'icon');
}
ok('triggered -> shield-alert',       secIcon('triggered',0)==='hk:shield-alert');
ok('triggered beats unlocked locks',  secIcon('triggered',2)==='hk:shield-alert');
ok('unlocked -> lock-open',           secIcon('armed_away',1)==='hk:lock-open-variant');
ok('armed + locked -> shield-lock',   secIcon('armed_away',0)==='hk:shield-lock');
ok('disarmed + locked -> shield-off', secIcon('disarmed',0)==='hk:shield-off');

print('\n=== any_of + attribute (Climate icon reads hvac_action) ===');
function SA(attr){ return {state:'heat', last_updated:'t', attributes:{hvac_action:attr}}; }
var CLIMICON = [
  { when:{any_of:['climate.a','climate.b'], attribute:'hvac_action', state:'cooling'},
    icon:'hk:snowflake' },
  { when:{any_of:['climate.a','climate.b'], attribute:'hvac_action', state:'heating'},
    icon:'hk:fire' },
  { icon:'hk:thermostat' }
];
function climIcon(a,b){
  var c=card({}, {'climate.a':SA(a), 'climate.b':SA(b)});
  return rv(c, c.cfg, null, CLIMICON, 'icon');
}
ok('either cooling -> snowflake', climIcon('cooling','idle')==='hk:snowflake');
ok('second one cooling too',      climIcon('idle','cooling')==='hk:snowflake');
ok('heating -> fire',             climIcon('heating','idle')==='hk:fire');
ok('cooling wins over heating (rule order)', climIcon('cooling','heating')==='hk:snowflake');
ok('neither -> thermostat',       climIcon('idle','idle')==='hk:thermostat');
ok('a missing attribute does not match', climIcon(undefined,undefined)==='hk:thermostat');


print('\n=== singular forms (Water: No Leaks / 1 Leak / 3 Leaks) ===');
var LEAK={count:{entities:['b.a','b.b','b.c'], match:'on'},
          zero:'No Leaks', one:'1 Leak', format:'{v} Leaks'};
function leaks(n){
  var st={}; ['b.a','b.b','b.c'].forEach(function(e,i){ st[e]=S(i<n?'on':'off'); });
  return label(card(LEAK, st));
}
ok('0 -> No Leaks', leaks(0)==='No Leaks', leaks(0));
ok('1 -> 1 Leak',   leaks(1)==='1 Leak',   leaks(1));
ok('2 -> 2 Leaks',  leaks(2)==='2 Leaks',  leaks(2));
ok('zero still wins at 0 even with `one` set', leaks(0)!=='0 Leaks');

print('\n=== Doors & Windows: two counts, joined, each pluralised ===');
var DW={ join:' • ', fallback:'All Closed', parts:[
  {count:{entities:['d.a','d.b'], match:'on'}, when:{above:0}, one:'1 Door',   format:'{v} Doors'},
  {count:{entities:['w.a','w.b'], match:'on'}, when:{above:0}, one:'1 Window', format:'{v} Windows'}]};
function dw(nd,nw){
  var st={};
  ['d.a','d.b'].forEach(function(e,i){ st[e]=S(i<nd?'on':'off'); });
  ['w.a','w.b'].forEach(function(e,i){ st[e]=S(i<nw?'on':'off'); });
  return label(card(DW, st));
}
ok('none open -> All Closed',      dw(0,0)==='All Closed', dw(0,0));
ok('one door only',                dw(1,0)==='1 Door', dw(1,0));
ok('two windows only',             dw(0,2)==='2 Windows', dw(0,2));
ok('both, joined with a bullet',   dw(1,2)==='1 Door • 2 Windows', dw(1,2));
ok('plurals on both sides',        dw(2,2)==='2 Doors • 2 Windows', dw(2,2));


// The NWS alert sensor: state is the COUNT, the alerts live in an Alerts list
// attribute. The chip shows the first alert's title plus "+N" for the rest,
// and colors on its Severity.
print('\n=== attribute paths, length, offset (Weather Alerts) ===');
function A(list){ return {state:String(list.length), last_updated:'t', attributes:{Alerts:list}}; }
var ALERT = { entity:'sensor.nws', join:' ', fallback:'--', parts:[
  { attribute:['Alerts.0.Event','Alerts.0.Headline'] },
  { attribute:'Alerts', length:true, offset:-1,
    when:{attribute:'Alerts', length:true, above:1}, format:'+{v}' } ]};
function alerts(list){ return label(card(ALERT, {'sensor.nws':A(list)})); }
ok('one alert -> just its Event',
   alerts([{Event:'Tornado Warning', Severity:'Extreme'}])==='Tornado Warning',
   alerts([{Event:'Tornado Warning', Severity:'Extreme'}]));
ok('three alerts -> title +2',
   alerts([{Event:'Tornado Warning'},{Event:'Flood'},{Event:'Wind'}])==='Tornado Warning +2',
   alerts([{Event:'Tornado Warning'},{Event:'Flood'},{Event:'Wind'}]));
ok('falls back to Headline when Event is absent',
   alerts([{Headline:'Severe storms expected'}])==='Severe storms expected');
ok('Event wins when both are present',
   alerts([{Event:'Hail', Headline:'ignored'}])==='Hail');
ok('no alerts -> the fallback', alerts([])==='--', alerts([]));

print('\n=== severity colours, case-insensitively ===');
var rv2 = window.hkCards.ruleValue;
var SEVRULES=[
  { when:{attribute:'Alerts.0.Severity', state:['extreme','severe'], ignore_case:true},
    color:'red' },
  { color:'orange' }];
function sev(s){
  var c=card({entity:'sensor.nws'}, {'sensor.nws':A([{Event:'X', Severity:s}])});
  return rv2(c, c.cfg, c._st('sensor.nws'), SEVRULES, 'color');
}
ok('Extreme -> red',  sev('Extreme')==='red');
ok('Severe -> red',   sev('Severe')==='red');
ok('SEVERE -> red (case-insensitive)', sev('SEVERE')==='red');
ok('Moderate -> orange', sev('Moderate')==='orange');
ok('missing severity -> orange', sev(undefined)==='orange');

print('\n=== a chip built from parts still watches its sources ===');
var sigA = C.prototype._sigOf.call({_hass:{states:{'s.t':S('70','t1'),'s.f':S('0','t1')}},
  _config:{parts:[{source:'s.t'},{source:'s.f'}]}});
var sigB = C.prototype._sigOf.call({_hass:{states:{'s.t':S('71','t2'),'s.f':S('0','t1')}},
  _config:{parts:[{source:'s.t'},{source:'s.f'}]}});
ok('a part source moving changes the signature', sigA!==sigB);
ok('  (and it is not null -- the chip would render once and freeze)', sigA!==null);

// ---------------------------------------------------------------- reduce
// A two-pack battery chip (EcoFlow, say) has to say something the aggregate
// hero above it cannot -- that the packs have DIVERGED, and that one of them
// is hot. Both are reductions over a list of sources, which is a named
// operation rather than an expression; `spread` (max - min) is the divergence.
print('\n=== source: [a, b] + reduce ===');
var A = 'sensor.pack_a_level', B = 'sensor.pack_b_level';
var TA = 'sensor.pack_a_temp',  TB = 'sensor.pack_b_temp';
function packs(a, b, ta, tb) {
  var st = {};
  st[A] = S(String(a)); st[B] = S(String(b));
  if (ta != null) st[TA] = S(String(ta));
  if (tb != null) st[TB] = S(String(tb));
  return st;
}
function red(mode, sources, states) {
  var c = card({ entity: sources[0], source: sources, reduce: mode, decimals: 0 }, states);
  return label(c);
}
ok('max',    red('max',    [A,B], packs(43, 47))==='47');
ok('min',    red('min',    [A,B], packs(43, 47))==='43');
ok('sum',    red('sum',    [A,B], packs(43, 47))==='90');
ok('spread', red('spread', [A,B], packs(43, 47))==='4');
ok('spread of equal packs is 0', red('spread', [A,B], packs(50, 50))==='0');
ok('spread ignores order',       red('spread', [A,B], packs(47, 43))==='4');
ok('default reduce is max',      label(card({entity:A, source:[A,B], decimals:0}, packs(43,47)))==='47');
// A missing or non-numeric member is skipped, not counted as zero -- a pack
// that has not reported must not make the spread look enormous.
ok('a missing source is skipped', red('max', [A,B,'sensor.nope'], packs(43,47))==='47');
ok('unavailable is skipped', (function(){
  var st = packs(43, 47); st['sensor.gone'] = S('unavailable');
  return red('spread', [A,B,'sensor.gone'], st); })()==='4');
ok('every source missing -> fallback',
   label(card({entity:'x.y', source:['sensor.nope1','sensor.nope2'], reduce:'max',
               fallback:'--'}, {}))==='--');

print('\n=== when: at_least / at_most (INCLUSIVE) ===');
function hot(t) {
  return label(card({ entity: TA, source: [TA, TB], reduce: 'max', decimals: 0,
    label_rules: [ { when: { at_least: 122 }, label: 'HOT' }, { label: 'ok' } ] },
    packs(50, 50, t, 100)));
}
// `above` is strict; the pack's own threshold is "122 or above", and writing
// that as above: 121.999 would be a lie in the config.
ok('at_least is inclusive at the boundary', hot(122)==='HOT');
ok('at_least is true above it',             hot(130)==='HOT');
ok('at_least is false below it',            hot(121)==='ok');
ok('at_most is inclusive', label(card({entity:'x.y',
     label_rules:[{when:{at_most:5}, label:'low'},{label:'high'}]},
     {'x.y':S('5')}))==='low');
ok('at_most is false above it', label(card({entity:'x.y',
     label_rules:[{when:{at_most:5}, label:'low'},{label:'high'}]},
     {'x.y':S('6')}))==='high');
ok('at_least and at_most together bracket a range', label(card({entity:'x.y',
     label_rules:[{when:{at_least:10, at_most:20}, label:'in'},{label:'out'}]},
     {'x.y':S('15')}))==='in');
ok('...and exclude outside it', label(card({entity:'x.y',
     label_rules:[{when:{at_least:10, at_most:20}, label:'in'},{label:'out'}]},
     {'x.y':S('21')}))==='out');

print('\n=== the Packs chip, whole ===');
var PACKS = {
  entity: A,
  parts: [
    { label_rules: [
        { when: { source: [A, B], reduce: 'spread', at_least: 3 },
          parts: [ { source: A, decimals: 0 },
                   { source: B, decimals: 0, format: '{v}%' } ],
          join: '/' },
        { source: A, decimals: 0, format: '{v}%' } ] },
    { source: [TA, TB], reduce: 'max', decimals: 0, format: '{v}\u00b0' }
  ]
};
ok('packs agree -> one figure',
   label(card(PACKS, packs(86, 86, 100, 99)))==='86% \u00b7 100\u00b0',
   label(card(PACKS, packs(86, 86, 100, 99))));
ok('packs diverge by 3 -> both figures',
   label(card(PACKS, packs(86, 83, 100, 99)))==='86/83% \u00b7 100\u00b0',
   label(card(PACKS, packs(86, 83, 100, 99))));
ok('a 2-point gap is NOT a divergence',
   label(card(PACKS, packs(86, 84, 100, 99)))==='86% \u00b7 100\u00b0',
   label(card(PACKS, packs(86, 84, 100, 99))));
ok('the hotter pack wins the temperature',
   label(card(PACKS, packs(86, 86, 99, 118)))==='86% \u00b7 118\u00b0',
   label(card(PACKS, packs(86, 86, 99, 118))));
// `reduce` must NOT leak from the outer spec onto a part that names its own
// single source -- it describes how to combine THAT list.
ok('reduce does not leak into a nested part',
   label(card(PACKS, packs(86, 83, 100, 99))).indexOf('86/83%')===0);

print('\n=== signature watches EVERY entity the config reads ===');
function sig(cfg, states){ return C.prototype._sigOf.call({ _hass:{states:states}, _config:cfg }); }
var CLIM = { name:'Climate', parts:[{source:'sensor.house_temperature'}],
  icon_rules:[{ when:{any_of:['climate.down','climate.up'], attribute:'hvac_action', state:'cooling'}, icon:'hk:snow' }],
  icon_color_rules:[{ when:{any_of:['climate.down','climate.up'], attribute:'hvac_action', state:'heating'}, color:'orange' }],
  tap_action:{ action:'perform-action', perform_action:'script.never_watched' } };
var t0 = {'sensor.house_temperature':S('72','a'),'climate.down':S('cool','a'),'climate.up':S('cool','a')};
var t1 = {'sensor.house_temperature':S('72','a'),'climate.down':S('cool','b'),'climate.up':S('cool','a')};
ok('a thermostat named only in when.any_of changes the signature', sig(CLIM,t0)!==sig(CLIM,t1));
ok('tap_action targets are not watched', sig(CLIM,t0).indexOf('script.never_watched')===-1);
var ARR = { name:'Battery', source:['sensor.pack_a','sensor.pack_b'], reduce:'spread' };
ok('each entry of a list-valued source is watched',
   sig(ARR,{'sensor.pack_a':S('80','a'),'sensor.pack_b':S('80','a')}) !==
   sig(ARR,{'sensor.pack_a':S('80','a'),'sensor.pack_b':S('79','b')}));
var saved = window.hkTile;
var withTile = sig(ARR,{'sensor.pack_a':S('80','a'),'sensor.pack_b':S('80','a')});
window.hkTile = {};
var noTile = sig(ARR,{'sensor.pack_a':S('80','a'),'sensor.pack_b':S('80','a')});
window.hkTile = saved;
ok('hk-tile loading late changes the signature, so the chip redraws', withTile!==noTile);
var Toggle = customElements.get('hk-toggle-card');
var tg = function(){ return Toggle.prototype._sigOf.call({ _hass:{states:{'input_boolean.x':S('on','a')}}, _config:{entity:'input_boolean.x'} }); };
var tgWith = tg(); window.hkTile = {}; var tgNo = tg(); window.hkTile = saved;
ok('toggle chips carry the same hk-tile token', tgWith!==tgNo && tgWith.indexOf('input_boolean.x')>=0);

// ONE THRESHOLD VOCABULARY. `above` is strict in a chip's `when` and in
// hk-rank-card's icon_color_steps alike, and `at_least` is the inclusive word
// in both places.
print('\n=== above / at_least mean the same in a chip and a rank tile ===');
load(HK_ROOT + '/frontend/cards/hk-stat.js');
var Rank = customElements.get('hk-rank-card');
var PAL = window.hkCards.PALETTE.icon;
function step(steps, v){
  return Rank.prototype._colour.call({ _config:{ icon_color_steps:steps } },
                                     { entity_id:'sensor.b', state:String(v) });
}
var STEPS = [{above:60, color:'green'}, {above:25, color:'yellow'}, {color:'red'}];
ok('chip: above 60 is strict',   w({above:60},'60')==='MISS' && w({above:60},'61')==='HIT');
ok('rank: above 60 is strict',   step(STEPS, 60)===PAL.yellow && step(STEPS, 61)===PAL.green);
ok('rank: the lower step too',   step(STEPS, 25)===PAL.red && step(STEPS, 26)===PAL.yellow);
ok('chip: at_least 60 includes it', w({at_least:60},'60')==='HIT' && w({at_least:60},'59')==='MISS');
ok('rank: at_least 60 includes it',
   step([{at_least:60, color:'green'}, {color:'red'}], 60)===PAL.green &&
   step([{at_least:60, color:'green'}, {color:'red'}], 59)===PAL.red);
ok('rank: a step with no threshold is the fallback', step(STEPS, 'unavailable')===PAL.red);

print('\n' + (fail? 'FAILURES: '+fail : 'ALL '+pass+' CHIP TESTS PASS'));
