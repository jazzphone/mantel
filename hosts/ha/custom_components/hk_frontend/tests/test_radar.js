// Representative provider response fixtures, not live requests. Timestamps and
// the test location are fixed examples; nothing here sends a home's location.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
// JavaScriptCore's shell has no URLSearchParams; encode the public object API.
globalThis.URLSearchParams = function (o) { this.toString = function () {
  return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
}; };
load(HK_ROOT + '/frontend/modules/hk-radar.js');
var noaa = JSON.parse(readFile(HK_ROOT + '/tests/fixtures/radar/noaa-query.json'));
var rain = JSON.parse(readFile(HK_ROOT + '/tests/fixtures/radar/rainviewer-maps.json'));
var A = hkRadar.ADAPTERS, point = {lat: 40, lon: -100}, latest = 1792188000000;
var requests = [], reply, signal = {aborted:false};
globalThis.fetch = function (url, opts) {
  requests.push({url:String(url), opts:opts});
  return reply(String(url), opts);
};
function json(data) { return Promise.resolve({ok:true,json:function(){return Promise.resolve(data);}}); }
function params(url) { var o = {}; url.split('?')[1].split('&').forEach(function(s){var p=s.split('=');o[decodeURIComponent(p[0])]=decodeURIComponent(p[1]);});return o; }
H.run('RADAR PROVIDERS', [
 function () {
  H.section('NOAA: provider times, sorted, deduplicated and clipped to history');
  reply = function(){return json(noaa);};
  return A.noaa.frames(point,60,signal).then(function(g){
   H.eq('one hour of actual valid times',g.frames.map(function(f){return f.time;}),[latest-3600000,latest-1800000,latest]);
   H.eq('the region is named',g.coverage,'NOAA’s radar for the contiguous United States');
   var p=params(requests[0].url);
   H.eq('a point query in geographic coordinates',[p.geometry,p.inSR,p.geometryType],['-100.000,40.000','4326','esriGeometryPoint']);
   H.eq('anonymous and abortable',[requests[0].opts.credentials,requests[0].opts.signal===signal],['omit',true]);
   var image=A.noaa.image(g.frames[2],{x0:-100.2,y0:200.1,x1:300.4,y1:600.2},512,256),q=params(image);
   H.eq('Mercator bounds, transparent PNG, exact provider time',[q.bbox,q.bboxSR,q.imageSR,q.transparent,q.format,q.time,q.size],['-100,200,300,600','3857','3857','true','png',String(latest),'512,256']);
  });
 },
 function () {
  reply=function(){return json({features:[]});};
  return A.noaa.frames(point,60,signal).then(function(g){H.eq('no coverage is an empty list, never fabricated frames',g.frames,[]);});
 },
 function () {
  reply=function(){return json({error:{message:'Service unavailable'}});};
  return A.noaa.frames(point,60,signal).then(function(){H.ok('provider errors reject',false);},function(e){H.eq('provider errors reject',e.message,'Service unavailable');});
 },
 function () {
  H.section('RainViewer: past only; provider host, path and zoom limit');
  reply=function(){return json(rain);};
  return A.rainviewer.frames(point,60,signal).then(function(g){
   H.eq('one hour of observed frames, no nowcast',g.frames.map(function(f){return f.time;}),[latest-3600000,latest-1800000,latest]);
   H.eq('maximum imagery zoom',A.rainviewer.maxZoom,7);
   H.eq('tile URL uses metadata host and path',A.rainviewer.tile(g.frames[2],7,28,48),'https://tilecache.rainviewer.com/v2/radar/1792188000/256/7/28/48/2/1_1.png');
  });
 },
 function () {
  H.section('Check Radar Connection fetches one image and handles failures');
  requests=[];
  reply=function(url){return url.indexOf('/query?')>=0?json(noaa):Promise.resolve({ok:true,headers:{get:function(){return 'image/png';}}});};
  return hkRadar.check({provider:'noaa',lat:40,lon:-100},{history_minutes:60,zoom:6},signal).then(function(g){
   H.eq('successful image check',g.ok,true);
   H.eq('one metadata request plus one small image',requests.length,2);
   H.eq('a bounded check',params(requests[1].url).size,'256,256');
   reply=function(){return Promise.resolve({ok:false,status:503});};
   return hkRadar.check({provider:'rainviewer',lat:40,lon:-100},{history_minutes:60,zoom:10},signal);
  }).then(function(g){H.ok('offline explains the provider failure',!g.ok && /RainViewer.*HTTP 503/.test(g.error),g);});
 },
 function () {
  requests=[];
  reply=function(url){return url.indexOf('weather-maps.json')>=0?json(rain):Promise.resolve({ok:true,headers:{get:function(){return 'text/html';}}});};
  return hkRadar.check({provider:'rainviewer',lat:40,lon:-100},{history_minutes:60,zoom:10},signal).then(function(g){
   H.ok('HTML masquerading as imagery is refused',!g.ok && /wasn’t an image/.test(g.error));
   H.ok('check caps imagery zoom at seven',/\/256\/7\//.test(requests[1].url),requests[1].url);
   reply=function(){return Promise.reject({name:'AbortError'});};
   return hkRadar.check({provider:'noaa',lat:40,lon:-100},{history_minutes:60,zoom:6},signal).then(function(){H.ok('abort rejects',false);},function(e){H.eq('abort stays abortable',e.name,'AbortError');});
  });
 },
 function () {
  requests=[];
  return hkRadar.check({provider:null,lat:40,lon:-100},{},signal).then(function(g){H.eq('no provider makes no requests',[g.ok,requests.length],[false,0]);});
 },
 function () {
  H.section('map projection alignment');
  var P=hkRadar._,z=6;
  H.eq('prime meridian maps to Mercator zero',Math.round(P.mx(P.wx(0,z),z)),0);
  H.eq('equator maps to Mercator zero',Math.round(P.my(P.wy(0,z),z)),0);
  H.ok('north is above south in pixels and above it in Mercator',P.wy(40,z)<P.wy(30,z) && P.my(P.wy(40,z),z)>P.my(P.wy(30,z),z));
 }
]);
