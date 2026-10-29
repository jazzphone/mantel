// HK's picture-entity (web/hk/shell/hk-view-host.js, hk-picture-entity): Lovelace's picture-entity
// card for a host without Lovelace (Mantel, HK's own panel), as HK's camera cards make it
// (hk-cameras.js: the Cameras page's tiles, the camera strip's live tile). The still and its
// refresh (double-buffered, only while on screen, a failed address not asked for again), the card's
// height from aspect_ratio (HA's forms), fit_mode, tap_action, and the live view's WebRTC signalling
// through the client (the same frames HA's player sends) against a fake client.
//
// A small DOM of its own, with connectedCallback / disconnectedCallback as a browser runs them.
if (typeof HK_ROOT === 'undefined') throw new Error('HK_ROOT is not set -- run this through tests/run');

var pass = 0, fail = 0;
function ok(name, c, d) {
  if (c) { pass++; print('  ok   ' + name); }
  else { fail++; print('  FAIL ' + name + (d !== undefined ? '   got ' + (function () { try { return JSON.stringify(d); } catch (e) { return String(d); } })() : '')); }
}
function settle() { var p = Promise.resolve(); for (var i = 0; i < 20; i++) p = p.then(function () {}); return p; }

// ------------------------------------------------------------------ the DOM
var made = [];
var registry = {}, byCtor = new Map();
function Style() {}
Style.prototype.setProperty = function (k, v) { this[k] = v; };
Style.prototype.getPropertyValue = function (k) { return this[k] || ''; };
Style.prototype.removeProperty = function (k) { delete this[k]; };
function ClassList(el) { this.el = el; }
ClassList.prototype.add = function () { var s = this._s(); for (var i = 0; i < arguments.length; i++) if (s.indexOf(arguments[i]) < 0) s.push(arguments[i]); this.el.className = s.join(' '); };
ClassList.prototype.remove = function () { var a = [].slice.call(arguments); this.el.className = this._s().filter(function (x) { return a.indexOf(x) < 0; }).join(' '); };
ClassList.prototype.contains = function (c) { return this._s().indexOf(c) >= 0; };
ClassList.prototype._s = function () { return String(this.el.className || '').split(/\s+/).filter(Boolean); };

class Node {
  constructor(tag) {
    this.localName = tag || byCtor.get(new.target) || 'div';
    this.tagName = this.localName.toUpperCase();
    this.childNodes = []; this.parentNode = null; this.attrs = {}; this.style = new Style();
    this._l = {}; this._text = ''; this.className = ''; this.classList = new ClassList(this);
  }
  get children() { return this.childNodes; }
  get firstChild() { return this.childNodes[0] || null; }
  get isConnected() { var n = this; while (n) { if (n === document.root) return true; n = n.parentNode || n.host || null; } return false; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  appendChild(c) {
    var was = c.isConnected;
    if (c.parentNode) c.parentNode.removeChild(c);
    this.childNodes.push(c); c.parentNode = this;
    if (!was && c.isConnected) connect(c, true);
    return c;
  }
  removeChild(c) {
    var i = this.childNodes.indexOf(c);
    if (i < 0) return c;
    var was = c.isConnected;
    this.childNodes.splice(i, 1); c.parentNode = null;
    if (was) connect(c, false);
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  attachShadow() { this.shadowRoot = new Node('#shadow'); this.shadowRoot.host = this; return this.shadowRoot; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter(function (x) { return x !== f; }); }
  dispatchEvent(e) { e.target = e.target || this; (this._l[e.type] || []).slice().forEach(function (f) { f(e); }); if (e.bubbles && this.parentNode) this.parentNode.dispatchEvent(e); return true; }
  getBoundingClientRect() { return { width: 400, height: 225 }; }
}
function connect(n, on) {
  var cb = on ? 'connectedCallback' : 'disconnectedCallback';
  if (typeof n[cb] === 'function') n[cb]();
  n.childNodes.slice().forEach(function (c) { connect(c, on); });
}
globalThis.HTMLElement = class HTMLElement extends Node {};
globalThis.customElements = {
  define: function (name, Ctor) { registry[name] = Ctor; byCtor.set(Ctor, name); },
  get: function (name) { return registry[name]; },
  whenDefined: function (name) { return Promise.resolve(registry[name]); }
};
var docL = {};
globalThis.document = {
  root: new Node('#document'),
  hidden: false,
  createElement: function (tag) {
    tag = String(tag).toLowerCase();
    made.push(tag);
    var C = registry[tag];
    if (C) return new C();
    var el = new HTMLElement(tag);
    if (tag === 'img') { el.src = ''; el.naturalWidth = 0; el.naturalHeight = 0; imgs.push(el); }
    if (tag === 'video') {
      el.readyState = 0; el.videoWidth = 0; el.paused = true; el.srcObject = null;
      el.play = function () { this.paused = false; plays++; return Promise.resolve(); };
      el.pause = function () { this.paused = true; };
    }
    return el;
  },
  addEventListener: function (t, f) { (docL[t] = docL[t] || []).push(f); },
  removeEventListener: function (t, f) { docL[t] = (docL[t] || []).filter(function (x) { return x !== f; }); }
};
document.body = document.root.appendChild(new Node('body'));
globalThis.CustomEvent = function (type, init) { this.type = type; init = init || {}; this.detail = init.detail; this.bubbles = !!init.bubbles; };
var winL = {};
globalThis.addEventListener = function (t, f) { (winL[t] = winL[t] || []).push(f); };
globalThis.removeEventListener = function (t, f) { winL[t] = (winL[t] || []).filter(function (x) { return x !== f; }); };
globalThis.dispatchEvent = function (e) { (winL[e.type] || []).slice().forEach(function (f) { f(e); }); return true; };
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.devicePixelRatio = 2;
var stack = ['/dashboard-test/cameras'];
globalThis.location = { get pathname() { return stack[stack.length - 1]; }, get href() { return 'http://hk.test' + stack[stack.length - 1]; } };
globalThis.history = { pushState: function (s, t, p) { stack.push(p); }, replaceState: function (s, t, p) { stack[stack.length - 1] = p; } };

// timers on demand
var timers = [], tid = 0;
globalThis.setTimeout = function (fn, ms) { timers.push({ id: ++tid, fn: fn, ms: ms, once: true }); return tid; };
globalThis.setInterval = function (fn, ms) { timers.push({ id: ++tid, fn: fn, ms: ms, once: false }); return tid; };
globalThis.clearTimeout = globalThis.clearInterval = function (id) { timers = timers.filter(function (t) { return t.id !== id; }); };
function intervals() { return timers.filter(function (t) { return !t.once; }); }
function runIntervals() { intervals().forEach(function (t) { t.fn(); }); }
function runTimeouts() { var due = timers.filter(function (t) { return t.once; }); timers = timers.filter(function (t) { return !t.once; }); due.forEach(function (t) { t.fn(); }); }

// an IntersectionObserver the test drives
var ios = [];
globalThis.IntersectionObserver = function (cb) { this.cb = cb; this.els = []; ios.push(this); };
IntersectionObserver.prototype.observe = function (el) { this.els.push(el); };
IntersectionObserver.prototype.disconnect = function () { this.els = []; };
function intersect(el, on) { ios.forEach(function (o) { if (o.els.indexOf(el) >= 0) o.cb([{ isIntersecting: on, target: el }]); }); }

var imgs = [], plays = 0;
function loaded(im, w, h) { im.naturalWidth = w || 640; im.naturalHeight = h || 360; im.onload && im.onload(); }
function failed(im) { im.onerror && im.onerror(); }

// No Lovelace here: a host shell with no card wrapper; more-info and navigate heard.
window.hkShell.use({ kind: 'test' });
load(HK_ROOT + '/frontend/shell/hk-view-host.js');
var V = window.hkViewHost;

// a house whose camera picture is Mantel's still route; a fake client: reads and the offer
// subscription recorded, answered by the test
var sent = [], subs = [];
function house(pic, state) {
  return {
    states: { 'camera.front': { entity_id: 'camera.front', state: state || 'idle',
                                attributes: { friendly_name: 'Front', entity_picture: pic } } },
    callWS: function (msg) {
      sent.push(msg);
      if (msg.type === 'camera/webrtc/get_client_config') return cfgAnswer();
      return Promise.resolve(null);
    },
    connection: { subscribeMessage: function (cb, msg) {
      var s = { cb: cb, msg: msg, ended: false };
      subs.push(s);
      return Promise.resolve(function () { s.ended = true; return Promise.resolve(); });
    } }
  };
}
var cfgAnswer = function () { return Promise.resolve({ configuration: { iceServers: [{ urls: 'stun:stun.test' }] } }); };
var PIC = '/mantel/api/camera/camera.front/still?v=aaaa';
var c1 = window.hkHostClient.from(house(PIC));

// ------------------------------------------------------------------ aspect ratio
var R = V.pictureRatio;
ok('aspect_ratio forms (HA\'s): 16x9, 16:9, a width ratio, a percentage, nonsense',
   JSON.stringify([R('16x9'), R('16:9'), R('1.5'), R('50%'), R('wide'), R('')]) ===
   JSON.stringify([{ w: 16, h: 9 }, { w: 16, h: 9 }, { w: 1.5, h: 1 }, { w: 100, h: 50 }, null, null]),
   [R('16x9'), R('16:9'), R('1.5'), R('50%'), R('wide'), R('')]);

// ------------------------------------------------------------------ auto: the still
var cfg = { type: 'picture-entity', entity: 'camera.front', camera_image: 'camera.front', camera_view: 'auto',
            show_name: false, show_state: false, fit_mode: 'contain', aspect_ratio: '4x3', tap_action: { action: 'more-info' } };
var el = V.createCardElement(cfg, c1);
ok('the factory makes HK\'s hk-picture-entity for picture-entity, configured and fed', el.localName === 'hk-picture-entity' &&
   el.client === c1);
var box = el.shadowRoot.childNodes.filter(function (n) { return n.id === 'box'; })[0];
var stills = box.childNodes.filter(function (n) { return n.localName === 'img'; });
ok('two stills (double-buffered), no video for camera_view auto, no footer when show_name/show_state are false',
   stills.length === 2 && !box.childNodes.some(function (n) { return n.localName === 'video'; }) &&
   !el.shadowRoot.childNodes.some(function (n) { return n.className === 'foot'; }));
ok('the height from aspect_ratio (4x3: 75%)', box.className === 'ratio' && box.style.paddingBottom === '75%', box.style.paddingBottom);
ok('fit_mode: contain', el.style['--hk-pic-fit'] === 'contain', el.style['--hk-pic-fit']);
ok('nothing is fetched before it is on the page', stills.every(function (i) { return !i.src; }));

document.body.appendChild(el);
var first = stills[0].src;
ok('on the page: the still from entity_picture (Mantel\'s route, its prefix kept), the tile\'s size at the screen\'s scale',
   first.indexOf(PIC + '&_hk=') === 0 && /&width=800&height=450$/.test(first), first);
ok('...refreshed every 10 s, as HA does', intervals().length === 1 && intervals()[0].ms === 10000, intervals().map(function (t) { return t.ms; }));
runIntervals();
ok('a refresh while one is loading asks for nothing more', !stills[1].src);
loaded(stills[0]);
ok('loaded: shown', stills[0].className === 'on' && stills[1].className === '');
runIntervals();
var second = stills[1].src;
ok('the next refresh loads into the OTHER still, a new address (never the browser\'s cache)', !!second && second !== first &&
   second.indexOf(PIC + '&_hk=') === 0, second);
ok('...and the shown one stays on until it has loaded: no black between frames', stills[0].className === 'on' && stills[1].className === '');
loaded(stills[1]);
ok('...then the two swap at once', stills[1].className === 'on' && stills[0].className === '');

// a size even before the tile is measured (2026-10-29): never the camera's full frame
(function () {
  var un = V.createCardElement(cfg, c1);
  un.getBoundingClientRect = function () { return { width: 0, height: 0 }; };
  var unBox = un.shadowRoot.childNodes.filter(function (n) { return n.id === 'box'; })[0];
  document.body.appendChild(un);
  var s0 = unBox.childNodes.filter(function (n) { return n.localName === 'img'; })[0].src;
  ok('...a tile not laid out yet asks for 480x270, not the full frame', /&width=480&height=270$/.test(s0), s0);
  document.body.removeChild(un);
})();

intersect(el, false);
var before = stills[0].src;
runIntervals();
ok('off screen: no refresh', stills[0].src === before);
intersect(el, true);
ok('back on screen: refreshed at once', stills[0].src !== before);
loaded(stills[0]);
document.hidden = true;
before = stills[1].src;
runIntervals();
ok('the page hidden: no refresh', stills[1].src === before);
document.hidden = false;
(docL.visibilitychange || []).forEach(function (f) { f(); });
ok('shown again: refreshed', stills[1].src !== before);
failed(stills[1]);
before = stills[0].src;
runIntervals();
ok('a still that failed: its address is not asked for again', stills[0].src === before && stills[1].className === '' && stills[0].className === 'on');
var c2 = window.hkHostClient.from(house('/mantel/api/camera/camera.front/still?v=bbbb'));
window.hkHostClient.bridge(el, c2);
ok('a new address (HA rotated the token): asked for at once', stills[1].src.indexOf('v=bbbb&_hk=') > 0, stills[1].src);
loaded(stills[1]);
var gone = window.hkHostClient.from(house('/mantel/api/camera/camera.front/still?v=cccc', 'unavailable'));
window.hkHostClient.bridge(el, gone);
before = stills[0].src;
runIntervals();
ok('an unavailable camera: nothing asked for', stills[0].src === before);

// tap actions
var heard = [];
document.root.addEventListener('hk-more-info', function (e) { heard.push(e.detail.entityId); });
el.dispatchEvent({ type: 'click' });
ok('tap_action more-info: HK\'s more-info for the entity (hkShell.moreInfo)', heard.join() === 'camera.front' && el.hasAttribute('data-tap'), heard);
document.body.removeChild(el);
ok('off the page: no timer left', intervals().length === 0 && timers.length === 0, timers.length);

var none = V.createCardElement(Object.assign({}, cfg, { tap_action: { action: 'none' } }), c1);
document.body.appendChild(none);
heard = [];
none.dispatchEvent({ type: 'click' });
ok('tap_action none: nothing, and no pointer', heard.length === 0 && !none.hasAttribute('data-tap'));
document.body.removeChild(none);
var nav = V.createCardElement(Object.assign({}, cfg, { tap_action: { action: 'navigate', navigation_path: '/dashboard-test/home' } }), c1);
nav.dispatchEvent({ type: 'click' });
ok('tap_action navigate: HK\'s navigation', location.pathname === '/dashboard-test/home', location.pathname);
var dflt = V.createCardElement({ type: 'picture-entity', entity: 'camera.front' }, c1);
heard = [];
dflt.addEventListener('hk-more-info', function (e) { heard.push(e.detail.entityId); });
dflt.dispatchEvent({ type: 'click' });
var foot = dflt.shadowRoot.childNodes.filter(function (n) { return n.className === 'foot'; })[0];
ok('no tap_action: more-info (HA\'s default)', heard.join() === 'camera.front');
ok('show_name / show_state not false: a footer with the name and the state', !!foot && foot.childNodes[0].textContent === 'Front' &&
   foot.childNodes[1].textContent === 'idle');
var dbox = dflt.shadowRoot.childNodes.filter(function (n) { return n.id === 'box'; })[0];
ok('no aspect_ratio: 16:9 until the picture is known, fit cover', dbox.style.paddingBottom === '56.25%' && dflt.style['--hk-pic-fit'] === 'cover', dbox.style.paddingBottom);
document.body.appendChild(dflt);
var dImgs = dbox.childNodes.filter(function (n) { return n.localName === 'img'; });
loaded(dImgs[0], 640, 480);
ok('...then the picture\'s own shape (640x480: 75%)', dbox.style.paddingBottom === '75%', dbox.style.paddingBottom);
document.body.removeChild(dflt);
ok('a config without an entity: the factory\'s placeholder', V.createCardElement({ type: 'picture-entity' }, c1).localName === 'hk-card-placeholder');

// ------------------------------------------------------------------ live: WebRTC through the client
var pcs = [];
function FakePC(conf) {
  this.conf = conf; this.trans = []; this.local = null; this.remote = null; this.cands = []; this.closed = false;
  this.connectionState = 'new'; this.iceGatheringState = 'new'; this.channels = [];
  pcs.push(this);
}
FakePC.prototype.addTransceiver = function (k, o) { this.trans.push(k + ':' + o.direction); };
FakePC.prototype.createDataChannel = function (n) { this.channels.push(n); };
FakePC.prototype.createOffer = function () { return Promise.resolve({ type: 'offer', sdp: 'v=0 offer' }); };
FakePC.prototype.setLocalDescription = function (d) { this.local = d; this.localDescription = { sdp: d.sdp + (this.extra || '') }; return Promise.resolve(); };
FakePC.prototype.setRemoteDescription = function (d) { this.remote = d; return Promise.resolve(); };
FakePC.prototype.addIceCandidate = function (c) { this.cands.push(c); return Promise.resolve(); };
FakePC.prototype.close = function () { this.closed = true; };
globalThis.RTCPeerConnection = FakePC;
globalThis.MediaStream = function () { this.tracks = []; };
MediaStream.prototype.addTrack = function (t) { this.tracks.push(t); };

sent = []; subs = []; timers = [];
var live = V.createCardElement({ type: 'picture-entity', entity: 'camera.front', camera_image: 'camera.front', camera_view: 'live',
                                 show_name: false, show_state: false, fit_mode: 'cover', aspect_ratio: '405x304', tap_action: { action: 'none' } }, c2);
var lbox = live.shadowRoot.childNodes.filter(function (n) { return n.id === 'box'; })[0];
var video = lbox.childNodes.filter(function (n) { return n.localName === 'video'; })[0];
ok('camera_view live: a muted, inline, autoplaying <video> in the shadow root (where hk-cameras.js looks), over the stills',
   !!video && video.muted === true && video.playsInline === true && video.autoplay === true && video.hasAttribute('playsinline') &&
   lbox.childNodes.indexOf(video) === 2);
ok('...a pixel-sized aspect ratio (the strip\'s live tile: 405x304)', lbox.style.paddingBottom === '75.06%', lbox.style.paddingBottom);
document.body.appendChild(live);
var lStills = lbox.childNodes.filter(function (n) { return n.localName === 'img'; });

settle().then(function () {
  ok('on the page: the still under it at once, and the client config asked for (a read: client.callWS)',
     !!lStills[0].src && sent.length === 1 && sent[0].type === 'camera/webrtc/get_client_config' && sent[0].entity_id === 'camera.front', sent);
  var pc = pcs[0];
  ok('a peer connection with the camera\'s ICE servers, receiving audio and video (as HA\'s player)',
     pcs.length === 1 && pc.conf.iceServers[0].urls === 'stun:stun.test' && pc.trans.join() === 'audio:recvonly,video:recvonly', pc && pc.trans);
  ok('the offer is a read subscription: camera/webrtc/offer with the SDP (client.subscriptions)',
     subs.length === 1 && subs[0].msg.type === 'camera/webrtc/offer' && subs[0].msg.entity_id === 'camera.front' && subs[0].msg.offer === 'v=0 offer', subs.map(function (s) { return s.msg; }));
  pc.onicecandidate({ candidate: { toJSON: function () { return { candidate: 'cand-early', sdpMid: '0', sdpMLineIndex: 0 }; } } });
  ok('a candidate before the session is held back', sent.length === 1);
  var s = subs[0];
  s.cb({ type: 'session', session_id: 'S1' });
  ok('the session: the held candidate goes, with the session id (camera/webrtc/candidate, a read)', sent.length === 2 &&
     sent[1].type === 'camera/webrtc/candidate' && sent[1].session_id === 'S1' && sent[1].entity_id === 'camera.front' &&
     sent[1].candidate.candidate === 'cand-early', sent[1]);
  pc.onicecandidate({ candidate: { toJSON: function () { return { candidate: 'cand-late', sdpMLineIndex: 0 }; } } });
  ok('...later candidates at once', sent.length === 3 && sent[2].candidate.candidate === 'cand-late');
  s.cb({ type: 'answer', answer: 'v=0 answer' });
  s.cb({ type: 'candidate', candidate: { candidate: 'remote-1', sdpMLineIndex: 0 } });
  s.cb({ type: 'candidate', candidate: 'remote-2' });
  ok('the answer and the camera\'s candidates (either form) reach the connection', pc.remote && pc.remote.type === 'answer' &&
     pc.remote.sdp === 'v=0 answer' && pc.cands.length === 2 && pc.cands[1].candidate === 'remote-2' && pc.cands[1].sdpMLineIndex === 0, pc.cands);
  var track = { kind: 'video' };
  pc.ontrack({ track: track, streams: [] });
  ok('a track: the video plays the stream', video.srcObject && video.srcObject.tracks[0] === track && video.paused === false);
  loaded(lStills[0]);
  var shown = lStills[1].src;
  runIntervals();
  ok('no picture yet: the still under it keeps refreshing', lStills[1].src !== shown);
  loaded(lStills[1]);
  video.readyState = 4; video.videoWidth = 1280;
  shown = lStills[0].src;
  runIntervals();
  ok('the video has a picture: the still under it is not refreshed (nothing fetched for nobody)', lStills[0].src === shown);
  pc.connectionState = 'connected'; pc.onconnectionstatechange();
  // taken off the page: hk-cameras.js releases the video, the element closes the connection
  document.body.removeChild(live);
  return settle().then(function () { return pc; });
}).then(function (pc) {
  ok('off the page: the subscription ended, the connection closed, the video let go, no timer left',
     subs[0].ended === true && pc.closed === true && video.srcObject === null && timers.length === 0, { ended: subs[0].ended, closed: pc.closed, timers: timers.length });
  // a camera that refuses: the still meanwhile, another try later, a few times
  sent = []; subs = []; pcs = []; timers = [];
  document.body.appendChild(live);
  return settle();
}).then(function () {
  ok('back on the page: a new connection', pcs.length === 1 && subs.length === 1);
  subs[0].cb({ type: 'error', code: 'webrtc_offer_failed', message: 'no WebRTC' });
  return settle();
}).then(function () {
  ok('an error event: the connection closed, the subscription ended, one try later (the still stays)',
     pcs[0].closed && subs[0].ended && timers.filter(function (t) { return t.once; }).length === 1);
  runTimeouts();
  return settle();
}).then(function () {
  ok('...the retry asks again', pcs.length === 2 && subs.length === 2);
  cfgAnswer = function () { return Promise.reject(Object.assign(new Error('webrtc_get_client_config_failed'), { code: 'home_assistant_error' })); };
  pcs[1].connectionState = 'failed'; pcs[1].onconnectionstatechange();
  var n = 0;
  function more() {
    runTimeouts();
    return settle().then(function () { if (++n < 10) return more(); });
  }
  return more();
}).then(function () {
  var asks = sent.filter(function (m) { return m.type === 'camera/webrtc/get_client_config'; }).length;
  ok('a camera with no WebRTC (HA\'s demo camera): a few tries, then it stays on its still', asks === 6 &&
     timers.filter(function (t) { return t.once; }).length === 0, asks);
  window.hkHostClient.bridge(live, window.hkHostClient.from(house(PIC)));
  return settle();
}).then(function () {
  ok('...and a new client does not start it again', sent.filter(function (m) { return m.type === 'camera/webrtc/get_client_config'; }).length === 6);
  document.body.removeChild(live);
  // refused (Mantel's camera rules: this viewer may not watch it live here): no retry at all
  cfgAnswer = function () { return Promise.reject(Object.assign(new Error('may not view camera.front'), { code: 'forbidden' })); };
  sent = []; subs = []; pcs = []; timers = [];
  document.body.appendChild(live);
  return settle();
}).then(function () {
  ok('refused (forbidden): the still only, no retry', sent.length === 1 && timers.filter(function (t) { return t.once; }).length === 0 &&
     intervals().length === 1, sent.length);
  document.body.removeChild(live);
  // getCandidatesUpfront: the offer waits for every candidate and carries them; nothing trickles
  cfgAnswer = function () { return Promise.resolve({ configuration: {}, getCandidatesUpfront: true, dataChannel: 'dc' }); };
  sent = []; subs = []; pcs = []; timers = [];
  FakePC.prototype.extra = ' +cands';
  document.body.appendChild(live);
  return settle();
}).then(function () {
  var pc = pcs[0];
  ok('getCandidatesUpfront: no offer until ICE gathering is complete', !!pc && subs.length === 0 && pc.channels.join() === 'dc');
  pc.onicecandidate({ candidate: { candidate: 'gathered' } });
  pc.iceGatheringState = 'complete'; pc.onicegatheringstatechange();
  return settle().then(function () { return pc; });
}).then(function (pc) {
  ok('...then the offer with the gathered candidates in its SDP, and none sent apart', subs.length === 1 &&
     subs[0].msg.offer === 'v=0 offer +cands' && sent.filter(function (m) { return m.type === 'camera/webrtc/candidate'; }).length === 0, subs[0] && subs[0].msg);
  document.body.removeChild(live);
  delete FakePC.prototype.extra;
  // no WebRTC in this browser (or no subscription port): the still only, nothing asked
  sent = []; timers = [];
  var RTC = globalThis.RTCPeerConnection;
  delete globalThis.RTCPeerConnection;
  var bare = V.createCardElement({ type: 'picture-entity', entity: 'camera.front', camera_view: 'live', aspect_ratio: '16x9' }, c1);
  document.body.appendChild(bare);
  var bImgs = bare.shadowRoot.childNodes.filter(function (n) { return n.id === 'box'; })[0].childNodes.filter(function (n) { return n.localName === 'img'; });
  ok('no WebRTC here: the still, refreshed, and no signalling', !!bImgs[0].src && sent.length === 0 && intervals().length === 1);
  document.body.removeChild(bare);
  globalThis.RTCPeerConnection = RTC;
  var host = made.filter(function (t) { return /^(hui-|ha-)/.test(t); });
  ok('not one host element made (no hui-*, no ha-*)', host.length === 0, host);
  print('');
  if (fail) { print('  FAIL ' + fail + ' PICTURE ENTITY TESTS'); throw new Error('picture entity tests failed'); }
  print('  ALL ' + pass + ' PICTURE ENTITY TESTS PASS');
}).catch(function (e) {
  print('  FAIL the suite threw: ' + e + '\n' + (e && e.stack));
  throw e;
});
