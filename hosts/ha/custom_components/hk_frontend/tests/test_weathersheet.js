// Both entry points share a single selected-day layout. Forecast fixtures
// make it impossible to accidentally chart today's hours under tomorrow.
if(typeof HK_ROOT==='undefined')throw Error('run through tests/run');
load(HK_ROOT+'/tests/dom.js');
load(HK_ROOT+'/tests/card_harness.js');
load(HK_ROOT+'/tests/sample_settings.js');
load(HK_ROOT+'/frontend/modules/hk-header.js');
load(HK_ROOT+'/frontend/cards/hk-base.js');
load(HK_ROOT+'/frontend/cards/hk-detail.js');
load(HK_ROOT+'/frontend/cards/hk-weather.js');
var matchMedia=function(){return {matches:false}};
var pass=0,fail=0;
function ok(n,c){if(c){pass++;print('PASS '+n)}else{fail++;print('FAIL '+n)}}
var today=new Date();today.setHours(0,0,0,0);
var day=function(n){var d=new Date(today);d.setDate(d.getDate()+n);return {datetime:d.toISOString(),temperature:70+n,templow:50+n,condition:'sunny',humidity:40+n,wind_speed:5,precipitation_probability:10}};
var days=[day(-1),day(0),day(1),day(2)];
var hours=[{datetime:new Date(Date.now()+3600e3).toISOString(),temperature:63},{datetime:new Date(Date.now()+7200e3).toISOString(),temperature:65}];
var h=H.house({'weather.test':['sunny',{temperature:64,temperature_unit:'°F',humidity:45,wind_speed:4}], 'sun.sun':['above_horizon',{}]});
function make(src){var p=H.make('hk-detail-weather');p._fc=function(kind){return kind==='daily'?days:hours};p.setConfig({entity:'weather.test',src:src||{},glass:false});p.hass=h.hass();return p;}
function html(p){return p._root.innerHTML||p._root.__html||'';}
var overview=make({}),forecast=make({focus:'day',day:0});
ok('overview and Today forecast use the identical template',html(overview)===html(forecast)&&html(overview).indexOf('wx-summary')>=0);
ok('one summary, hourly chart, conditions and clickable upcoming days',
 (html(overview).match(/wx-section wx-summary/g)||[]).length===1 &&
 (html(overview).match(/data-day=/g)||[]).length===3 && /aria-pressed="true"/.test(html(overview)));
var tomorrow=make({focus:'day',day:1});
ok('tomorrow replaces today instead of prepending a second overview',
 (html(tomorrow).match(/wx-section wx-summary/g)||[]).length===1 && /71°/.test(html(tomorrow)) && /Daytime Conditions/.test(html(tomorrow)) && !/Feels like/.test(html(tomorrow)));
ok('a day without hourly coverage says so and does not show today’s chart',
 /not available for this day/.test(html(tomorrow))&&!/class="ch"/.test(html(tomorrow)));
var empty=make({});empty._fc=function(){return []};empty._render();
ok('missing forecasts keep current weather and honest empty states',/not available yet/.test(html(empty))&&!/NaN|Infinity|undefined/.test(html(empty)));
if(fail)throw Error(fail+' failed');print('ALL '+pass+' WEATHER SHEET TESTS PASS');
