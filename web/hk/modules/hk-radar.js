// hk-radar.js -- the Weather page's precipitation radar, HK's own (2026-10-16;
// hk_house/docs/PLAN-2026-10-16-weather-page.md §3, §5, §7).
//
// LOADED ONLY WHEN THE RADAR IS ON AND ON SCREEN: hk-weather.js's
// hk-radar-card imports this file the first time it is attached with
// weather.radar_native.enabled, and nothing here runs, polls or loads before
// that -- a house with the radar off never fetches it.
//
// THREE STREAMS, kept apart:
//   the street map    OpenStreetMap's standard tiles, drawn here (no map
//                     library: a slippy map is a few hundred lines, and a
//                     wall tablet is spared another 150 KB and its CSS)
//   the radar         time-stamped precipitation from the effective provider
//                     (ADAPTERS below), over the map; its frames are the
//                     provider's own, never made up
//   the forecast      not here at all (the page's other cards)
//
// WHAT IT ASKS FOR, AND WHEN: the provider's frame list when the card opens,
// then every five minutes while it is on screen and the page visible --
// never in the background, never to catch up. The radar images for the map's
// area: the frame shown and the next one only (a bounded working set), the
// rest as playback reaches them. Map tiles: the ones in view, the browser's
// HTTP cache doing the rest -- nothing prefetched, nothing bulk-downloaded.
// A new location or provider aborts what is in flight (request generations)
// and lets go of every image it held.
//
// ATTRIBUTION is always visible, in its own strip at the foot of the card,
// clear of the controls and the scrims, expanded or not.
(function () {
  'use strict';
  if (window.hkRadar) return;

  var R = 6378137, TILE = 256;
  // ---------------------------------------------------------- web mercator
  function wx(lon, z) { return (lon + 180) / 360 * TILE * Math.pow(2, z); }
  function wy(lat, z) {
    var s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z);
  }
  // world pixels at zoom z -> EPSG:3857 metres
  function mx(x, z) { return x / (TILE * Math.pow(2, z)) * 2 * Math.PI * R - Math.PI * R; }
  function my(y, z) { return Math.PI * R - y / (TILE * Math.pow(2, z)) * 2 * Math.PI * R; }

  function getJSON(url, signal) {
    return fetch(url, { signal: signal, credentials: 'omit', cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ============================================================ ADAPTERS
  // Each provider: who it is, its attribution and legend, how close its
  // radar goes, its frames (metadata) and how one frame's imagery is asked
  // for. kind 'image': one picture of the map's area per frame (NOAA's
  // ArcGIS ImageServer export); kind 'tiles': a frame's map tiles
  // (RainViewer). frames() resolves to [{ id, time (ms), ... }], oldest first.
  var NOAA_URL = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
  var NOAA_REGIONS = { CONUS: 'the contiguous United States', ALASKA: 'Alaska', HAWAII: 'Hawaii', CARIB: 'the Caribbean', GUAM: 'Guam' };
  var ADAPTERS = {
    noaa: {
      id: 'noaa', name: 'NOAA', kind: 'image', maxZoom: 22,
      attribution: [['NOAA/NWS MRMS', 'https://www.weather.gov/disclaimer']],
      // the service's own colors, light to heavy (read off its imagery)
      legend: 'linear-gradient(90deg,#5068a3,#4f8fbf,#3fb67e,#1e9c3a,#e3df3b,#f09a2b,#e0372b,#c43ad0)',
      // the rasters that cover this point -- their own valid times are the
      // frames (MRMS mosaics land every few minutes, unevenly)
      frames: function (pt, minutes, signal) {
        var q = { where: '1=1', outFields: 'name,idp_validtime,idp_validendtime', returnGeometry: 'false',
                  orderByFields: 'idp_validtime', f: 'json', geometry: pt.lon.toFixed(3) + ',' + pt.lat.toFixed(3),
                  geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
        return getJSON(NOAA_URL + '/query?' + new URLSearchParams(q), signal).then(function (d) {
          if (d && d.error) throw new Error(d.error.message || 'NOAA refused the request');
          var seen = {}, out = [], region = null;
          ((d && d.features) || []).forEach(function (f) {
            var a = f.attributes || {}, t = Number(a.idp_validtime);
            if (!isFinite(t) || seen[t]) return;
            seen[t] = true;
            region = String(a.name || '').split('_')[0] || region;
            out.push({ id: String(t), time: t });
          });
          out.sort(function (a, b) { return a.time - b.time; });
          if (!out.length) return { frames: [], coverage: null };
          var latest = out[out.length - 1].time;
          return { frames: out.filter(function (f) { return f.time >= latest - minutes * 60e3; }),
                   coverage: region ? 'NOAA’s radar for ' + (NOAA_REGIONS[region] || region) : 'NOAA radar' };
        });
      },
      image: function (frame, b, w, h) {
        return NOAA_URL + '/exportImage?' + new URLSearchParams({
          bbox: [b.x0, b.y0, b.x1, b.y1].map(function (v) { return v.toFixed(0); }).join(','),
          bboxSR: '3857', imageSR: '3857', size: w + ',' + h, format: 'png', transparent: 'true',
          time: frame.id, f: 'image' });
      }
    },
    rainviewer: {
      id: 'rainviewer', name: 'RainViewer', kind: 'tiles', maxZoom: 7,
      attribution: [['RainViewer', 'https://www.rainviewer.com/api.html']],
      // the one palette RainViewer serves today (its "universal blue")
      legend: 'linear-gradient(90deg,#9ee7f6,#00a3e0,#0067b2,#ffe600,#ff9a00,#ff2a00,#b0002e)',
      frames: function (pt, minutes, signal) {
        return getJSON('https://api.rainviewer.com/public/weather-maps.json', signal).then(function (d) {
          var host = d && d.host, past = (d && d.radar && d.radar.past) || [];
          if (!host || !past.length) return { frames: [], coverage: null };
          var out = past.map(function (p) { return { id: p.path, time: p.time * 1000, host: host, path: p.path }; })
            .sort(function (a, b) { return a.time - b.time; });
          var latest = out[out.length - 1].time;
          return { frames: out.filter(function (f) { return f.time >= latest - minutes * 60e3; }),
                   coverage: 'RainViewer’s worldwide radar (coverage varies by country)' };
        });
      },
      tile: function (frame, z, x, y) { return frame.host + frame.path + '/256/' + z + '/' + x + '/' + y + '/2/1_1.png'; }
    }
  };
  var OSM = { url: function (z, x, y) { return 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png'; },
              attribution: [['© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright']], maxZoom: 18 };
  var SPEED = { slow: 1500, normal: 1000, fast: 700 };
  var REFRESH = 5 * 60e3, MIN_Z = 3, MAX_Z = 12;

  function fmtTime(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function ago(t) {
    var m = Math.round((Date.now() - t) / 60e3);
    return m <= 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min ago';
  }

  // ============================================================ THE CHECK
  // HK Settings' Check Radar Connection: on a tap, the provider's frames and
  // one small image of the map's middle; never repeated by itself.
  function check(plan, r, signal) {
    var A = ADAPTERS[plan.provider];
    if (!A) return Promise.resolve({ ok: false, error: 'Choose a radar provider first.' });
    if (plan.lat == null) return Promise.resolve({ ok: false, error: 'There is no location for the map.' });
    var pt = { lat: plan.lat, lon: plan.lon };
    return A.frames(pt, r.history_minutes, signal).then(function (got) {
      var fr = got.frames;
      if (!fr.length) {
        return { ok: false, error: A.id === 'noaa' ? 'NOAA has no radar for this place: it covers the United States, Alaska, Hawaii and the Caribbean.'
                                                   : 'RainViewer sent no radar frames. Try again later.' };
      }
      var last = fr[fr.length - 1], url;
      if (A.kind === 'image') {
        var z = r.zoom, cx = wx(pt.lon, z), cy = wy(pt.lat, z);
        url = A.image(last, { x0: mx(cx - 128, z), y0: my(cy + 128, z), x1: mx(cx + 128, z), y1: my(cy - 128, z) }, 256, 256);
      } else {
        var zr = Math.min(r.zoom, A.maxZoom);
        url = A.tile(last, zr, Math.floor(wx(pt.lon, zr) / TILE), Math.floor(wy(pt.lat, zr) / TILE));
      }
      return fetch(url, { signal: signal, credentials: 'omit' }).then(function (res) {
        if (!res.ok) throw new Error('the radar image was refused (HTTP ' + res.status + ')');
        var type = res.headers.get('content-type') || '';
        if (type.indexOf('image') !== 0) throw new Error('the radar image wasn’t an image');
        return {
          ok: true, provider: A.id,
          latestText: fmtTime(last.time) + ' (' + ago(last.time) + ')',
          framesText: fr.length + ' frames over ' + Math.max(1, Math.round((last.time - fr[0].time) / 60e3)) + ' min',
          coverageText: got.coverage || 'Imagery received'
        };
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') throw e;
      return { ok: false, error: 'Couldn’t reach ' + A.name + ': ' + ((e && e.message) || e) + '.' };
    });
  }

  // ================================================================ STYLE
  // One CSS for the card, put into its shadow root once. The map is the
  // card: clipped at the plate's corner, the heading and the expand button
  // floating 20 / 22 in, the zoom keys under the heading, the legend above
  // the playback bar, the playback bar 20 / 22 off the bottom, the credits in
  // their own strip at the very foot. Scrims at top and bottom keep the text
  // readable over any map; they never cover the credits.
  function css(C) {
    var v = C.v;
    return [
      ':host{display:block}',
      '.rc{position:relative;height:var(--hk-wx-radar-h,455px);border-radius:' + C.R.plate + 'px;overflow:hidden;isolation:isolate;',
      '  ' + C.plate('card') + ';background:var(--rm-bg);color:var(--rm-ink);font-family:inherit;',
      '  --rm-bg:#1b2b33;--rm-ink:#fff;--rm-ink2:rgba(255,255,255,.74);--rm-ink3:rgba(255,255,255,.56);',
      '  --rm-scrim:16,39,51;--rm-glass:rgba(20,48,62,.80);--rm-edge:rgba(255,255,255,.16);',
      '  --rm-filter:grayscale(.85) invert(.9) hue-rotate(185deg) brightness(.86) contrast(.9)}',
      '.rc[data-theme=light]{--rm-bg:#e9e7e1;--rm-ink:#252528;--rm-ink2:#4b4b50;--rm-ink3:#626267;--rm-scrim:245,243,238;',
      '  --rm-glass:rgba(250,249,246,.9);--rm-edge:rgba(0,0,0,.12);--rm-filter:grayscale(.55) brightness(1.02) contrast(.92)}',
      '@media (max-width:' + C.BP.phone + 'px){.rc{height:var(--hk-wx-radar-h-phone,430px)}}',
      ':host([data-hk-cell]) .rc{height:100%}',
      '.map{position:absolute;inset:0;overflow:hidden;outline:none;touch-action:none;cursor:grab;z-index:0}',
      '.map.still{cursor:default;touch-action:pan-y}',
      '.map.drag{cursor:grabbing}',
      '.map:focus-visible{box-shadow:inset 0 0 0 2px var(--rm-ink2)}',
      '.stage,.lyr{position:absolute;left:0;top:0;width:0;height:0}',
      '.stage{transform-origin:0 0}',
      '.lyr img{position:absolute;display:block;max-width:none;user-select:none;-webkit-user-drag:none;pointer-events:none}',
      '.base img{filter:var(--rm-filter);width:256px;height:256px}',
      // This filter is the map's palette, not decorative card motion.
      // Flat's blanket filter reset must not turn Dark's map back to white.
      ':host([hk-flat]) .base img{filter:var(--rm-filter)!important}',
      '.wx{opacity:var(--rm-op,.75)}',
      '.wx .fr{position:absolute;left:0;top:0;visibility:hidden}',
      '.wx .fr.on{visibility:visible}',
      '.pin{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#52adf2;border:2px solid #fff;',
      '  box-sizing:border-box;box-shadow:0 0 0 5px rgba(82,173,242,.25),0 2px 8px rgba(0,0,0,.35);z-index:3;pointer-events:none}',
      '.scrim{position:absolute;inset:0;z-index:2;pointer-events:none;background:linear-gradient(180deg,',
      '  rgba(var(--rm-scrim),.38) 0,rgba(var(--rm-scrim),.12) 14%,rgba(var(--rm-scrim),0) 26%,',
      '  rgba(var(--rm-scrim),0) 84%,rgba(var(--rm-scrim),.10) 92%,rgba(var(--rm-scrim),.30) 100%)}',
      '.hd{position:absolute;top:' + C.CARD.y + 'px;left:' + C.CARD.x + 'px;right:' + C.CARD.x + 'px;z-index:5;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;pointer-events:none}',
      '.hd>*{pointer-events:auto}',
      '.caption{' + C.plate('tile') + ';background:' + v('overlay-solid') + ';border-radius:' + C.R.inner + 'px;padding:10px 12px;min-width:0;max-width:calc(100% - 56px)}',
      '.tt{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--rm-ink);text-shadow:0 1px 6px rgba(var(--rm-scrim),.6)}',
      '.caption .tt{color:' + v('ink') + ';text-shadow:none}',
      '.tt ha-icon{--mdc-icon-size:17px;width:17px;height:17px;flex:none;display:flex;align-items:center;justify-content:center;line-height:0}',
      '.st{font-size:11px;font-weight:500;margin-top:5px;color:var(--rm-ink2);text-shadow:0 1px 6px rgba(var(--rm-scrim),.6)}',
      '.caption .st{color:' + v('ink-2') + ';text-shadow:none;line-height:1.4}',
      '.btn{' + C.plate('tile') + ';appearance:none;color:' + C.v('ink') + ';font:inherit;cursor:pointer;',
      '  display:grid;place-items:center;padding:0;margin:0;-webkit-tap-highlight-color:transparent}',
      '.btn:focus-visible{outline:2px solid ' + C.v('ink') + ';outline-offset:3px}',
      '.btn:active{transform:scale(.96)}',
      '.btn ha-icon{--mdc-icon-size:21px;width:21px;height:21px;line-height:0}',
      '.xp{width:44px;height:44px;border-radius:50%;flex:none}',
      '.tools{position:absolute;top:' + (C.CARD.y + 58) + 'px;right:' + C.CARD.x + 'px;z-index:5;display:grid;gap:6px}',
      '.tools .btn{width:44px;height:44px;border-radius:22px;font-size:20px;font-weight:500;line-height:1}',
      '.lg{position:absolute;left:' + C.CARD.x + 'px;bottom:' + (C.CARD.y + 76) + 'px;z-index:5;display:flex;align-items:center;gap:7px;',
      '  padding:5px 9px;border-radius:8px;background:var(--rm-glass);border:1px solid var(--rm-edge);font-size:10px;font-weight:600;color:var(--rm-ink2);pointer-events:none}',
      '.lg i{width:70px;height:4px;border-radius:2px;background:var(--rm-legend)}',
      '.pb{position:absolute;left:' + C.CARD.x + 'px;right:' + C.CARD.x + 'px;bottom:' + C.CARD.y + 'px;z-index:5;display:flex;align-items:center;gap:12px;',
      '  padding:12px 16px;' + C.plate('card') + '}',
      '.pb .btn.pl{width:44px;height:44px;border-radius:50%;flex:none}',
      '.tl{flex:1;min-width:0}',
      // The same track and thumb as hk-control's sliders. Clear the native
      // widget so Chrome and Android WebView do not draw a second track.
      '.tl input{appearance:none;-webkit-appearance:none;display:block;width:100%;margin:0;padding:0;height:28px;border:0;background:transparent;cursor:pointer;touch-action:pan-y}',
      '.tl input::-webkit-slider-runnable-track{height:8px;border-radius:5px;border:0;background:linear-gradient(90deg,' + C.v('ink') + ' var(--played,0%),' + C.v('line-strong') + ' var(--played,0%))}',
      '.tl input::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:26px;height:26px;margin-top:-9px;border-radius:50%;border:0;background:#fff;box-shadow:0 3px 10px rgba(0,0,0,.25)}',
      '.tl input::-moz-range-track{height:8px;border-radius:5px;border:0;background:' + C.v('line-strong') + '}',
      '.tl input::-moz-range-progress{height:8px;border-radius:5px;background:' + C.v('ink') + '}',
      '.tl input::-moz-range-thumb{width:26px;height:26px;border-radius:50%;border:0;background:#fff;box-shadow:0 3px 10px rgba(0,0,0,.25)}',
      '.tl input:disabled{cursor:default;opacity:.5}',
      '.tl .lb{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:10px;font-weight:600;color:var(--rm-ink3);margin-top:1px}',
      '.tl .lb output{color:var(--rm-ink);font-weight:600;white-space:nowrap}',
      '.cr{position:absolute;right:' + C.CARD.x + 'px;left:' + C.CARD.x + 'px;bottom:3px;height:14px;z-index:6;text-align:right;font-size:9px;line-height:14px;',
      '  color:var(--rm-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cr a{color:var(--rm-ink);text-decoration:none}',
      '.msg{position:absolute;inset:0;z-index:4;display:grid;place-content:center;gap:12px;padding:70px 30px;text-align:center;',
      '  font-size:14px;line-height:1.5;color:var(--rm-ink2);pointer-events:none}',
      '.msg[hidden]{display:none}',
      '.msg .btn{pointer-events:auto;justify-self:center;min-height:44px;border-radius:22px;padding:0 18px;font-size:15px;font-weight:600}',
      '.rc.calm .pb{display:none}',
      '.rc.calm .lg{bottom:' + C.CARD.y + 'px}',
      // The page is an ambient regional view. Interaction belongs to the
      // expanded map, so the page has only one action: expand.
      '.rc.preview .pb,.rc.preview .tools{display:none!important}',
      '.history{display:none;position:absolute;left:' + C.CARD.x + 'px;right:' + C.CARD.x + 'px;bottom:' + C.CARD.y + 'px;z-index:5;',
      '  ' + C.plate('tile') + ';background:' + v('overlay-solid') + ';border-radius:' + C.R.inner + 'px;padding:10px 12px;pointer-events:none;color:' + v('ink') + '}',
      '.rc.preview .history:not([hidden]){display:block}',
      '.history .times{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:11px;font-weight:500;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.history output{font-weight:600;color:' + v('ink') + '}',
      '.history .track{position:relative;height:4px;margin-top:9px;border-radius:2px;background:' + v('line-strong') + '}',
      '.history .track i{display:block;height:100%;width:var(--history-position,0%);border-radius:inherit;background:' + v('ink') + '}',
      '.history .track b{position:absolute;top:50%;left:var(--history-position,0%);width:6px;height:6px;border-radius:50%;background:' + v('ink') + ';transform:translate(-50%,-50%)}',
      '.rc.preview .lg{bottom:' + (C.CARD.y + 68) + 'px}',
      // THE MAP FULL SCREEN: the same card in a dialog (the top layer), a safe
      // inset from the window's edge
      'dialog.rx{position:fixed;inset:24px;width:calc(100vw - 48px);height:calc(100dvh - 48px);max-width:none;max-height:none;margin:0;padding:0;border:0;',
      '  border-radius:' + C.R.plate + 'px;background:transparent;overflow:visible;color:inherit}',
      'dialog.rx::backdrop{background:rgba(6,14,24,.62);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}',
      'dialog.rx .rc{height:100%}',
      '@media (max-width:' + C.BP.phone + 'px){dialog.rx{inset:10px;width:calc(100vw - 20px);height:calc(100dvh - 20px)}}',
      '@media (prefers-reduced-motion:reduce){.btn:active{transform:none}}'
    ].join('');
  }

  var ICONS = {
    radar: 'mdi:radar', expand: 'mdi:arrow-expand', collapse: 'mdi:arrow-collapse', play: 'hk:play', pause: 'hk:pause',
    locate: 'mdi:crosshairs-gps'
  };

  // ============================================================ THE RADAR
  // attach(card, host) -> { update(hass), detach() }. `host` is the card's
  // own element in its shadow root; the radar draws inside it.
  function attach(card, host) {
    var C = window.hkCards, HS = window.hkSettings;
    var root = host.getRootNode();
    if (!root.querySelector('style[data-hk-radar]')) {
      var st = document.createElement('style');
      st.setAttribute('data-hk-radar', '');
      st.textContent = css(C);
      root.appendChild(st);
    }
    host.innerHTML =
      '<div class="rc"><div class="map" role="application" aria-roledescription="map" tabindex="0">' +
        '<div class="stage"><div class="lyr base"></div><div class="lyr wx"></div><div class="lyr mk"></div></div></div>' +
        '<div class="scrim"></div>' +
        '<div class="hd"><div class="caption"><div class="tt"><ha-icon icon="' + ICONS.radar + '"></ha-icon><span>Precipitation Radar</span></div>' +
          '<div class="st" aria-live="polite"></div></div>' +
          '<button class="btn xp" type="button" aria-label="Expand radar" aria-expanded="false"><ha-icon icon="' + ICONS.expand + '"></ha-icon></button></div>' +
        '<div class="tools"><button class="btn rcn" type="button" aria-label="Center the map"><ha-icon icon="' + ICONS.locate + '"></ha-icon></button>' +
          '<button class="btn zin" type="button" aria-label="Zoom in">+</button><button class="btn zout" type="button" aria-label="Zoom out">−</button></div>' +
        '<div class="lg" aria-hidden="true"><span>Light</span><i></i><span>Heavy</span></div>' +
        '<div class="msg" hidden><div class="mt"></div><button class="btn rt" type="button">Try Again</button></div>' +
        '<div class="pb"><button class="btn pl" type="button" aria-label="Play radar history"><ha-icon icon="' + ICONS.play + '"></ha-icon></button>' +
          '<div class="tl"><input type="range" min="0" max="0" value="0" step="1" aria-label="Radar frame" disabled>' +
          '<div class="lb"><span class="t0"></span><output></output><span>Latest</span></div></div></div>' +
        '<div class="history" role="img" aria-label="Radar history" hidden><div class="times"><span class="start"></span><output></output><span class="end"></span></div>' +
          '<div class="track" aria-hidden="true"><i></i><b></b></div></div>' +
        '<div class="cr"></div></div>';
    var q = function (s) { return host.querySelector(s); };
    var E = { rc: q('.rc'), map: q('.map'), stage: q('.stage'), base: q('.base'), wx: q('.wx'), mk: q('.mk'), st: q('.st'),
              xp: q('.xp'), tools: q('.tools'), zin: q('.zin'), zout: q('.zout'), rcn: q('.rcn'), lg: q('.lg'), msg: q('.msg'),
              mt: q('.msg .mt'), rt: q('.msg .rt'), pb: q('.pb'), pl: q('.pl'), rng: q('.tl input'), out: q('.tl output'),
              t0: q('.tl .t0'), cr: q('.cr'), history: q('.history'), start: q('.history .start'), end: q('.history .end'), current: q('.history output') };

    // ------------------------------------------------------------ state
    var S = {
      hass: null, plan: null, r: null, key: '', A: null,
      z: 6, cx: 0, cy: 0, home: null, w: 0, h: 0,
      frames: [], i: -1, playing: false, playT: null, refreshT: null, gen: 0, request: 0, selection: 0, ctl: null,
      base: {}, baseZ: null, oldBase: null, fr: {}, failed: {}, meta: null,
      visible: !document.hidden, onScreen: true, err: null, played: false, alive: true, interactive: true
    };

    function awake() { return S.alive && S.visible && S.onScreen && !window.__hkAsleep; }

    function settings() { return HS && HS.radarNative ? HS.radarNative() : null; }
    function motion() {
      var m = !HS || !HS.rendering || HS.rendering().motion;
      try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) m = false; } catch (e) { /* old */ }
      return m;
    }
    function autoplayOk() {
      // Radar history is content (like the charts), including in Flat.
      // Reduce Motion still makes playback a manual choice.
      return !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // ------------------------------------------------------ the street map
    function size() {
      var w = E.map.clientWidth, h = E.map.clientHeight;
      if (w === S.w && h === S.h) return false;
      S.w = w; S.h = h;
      return true;
    }
    function topLeft() { return { x: S.cx - S.w / 2, y: S.cy - S.h / 2 }; }
    function placeStage() {
      var tl = topLeft();
      E.stage.style.transform = 'translate(' + (-Math.round(tl.x)) + 'px,' + (-Math.round(tl.y)) + 'px)';
    }
    // the tiles in view (one tile of margin), each placed in world pixels;
    // the rest let go
    function drawBase() {
      if (!S.w || !S.h) return;
      var z = S.z, n = Math.pow(2, z), tl = topLeft(), want = {};
      var x0 = Math.floor(tl.x / TILE) - 1, x1 = Math.floor((tl.x + S.w) / TILE) + 1;
      var y0 = Math.max(0, Math.floor(tl.y / TILE) - 1), y1 = Math.min(n - 1, Math.floor((tl.y + S.h) / TILE) + 1);
      if (S.baseZ !== z) {
        // A NEW ZOOM: the old tiles stay, scaled, until the new ones are in
        // (no blank map between zooms)
        if (S.oldBase) dropOldBase();
        var old = E.base;
        Object.keys(S.base).forEach(function (key) { clearTimeout(S.base[key]._retryT); });
        old.classList.add('was');
        var k = Math.pow(2, z - S.baseZ);
        old.style.transform = 'scale(' + k + ')';
        old.style.transformOrigin = '0 0';
        S.oldBase = isFinite(k) ? old : null;
        if (!S.oldBase) old.remove();
        var fresh = document.createElement('div');
        fresh.className = 'lyr base';
        E.stage.insertBefore(fresh, E.wx);
        E.base = fresh;
        S.base = {};
        S.baseZ = z;
      }
      var pending = 0;
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          var key = x + '/' + y;
          want[key] = true;
          if (S.base[key]) {
            if (!S.base[key].complete) pending++;
            else if (S.base[key]._mapFailed && !S.base[key]._retried) baseFailed.call(S.base[key]);
            continue;
          }
          var img = document.createElement('img');
          img.alt = '';
          img.decoding = 'async';
          img.referrerPolicy = 'strict-origin-when-cross-origin';
          img.style.left = (x * TILE) + 'px';
          img.style.top = (y * TILE) + 'px';
          img._mapKey = key;
          img._mapURL = OSM.url(z, ((x % n) + n) % n, y);
          img.onload = baseLoaded;
          img.onerror = baseFailed;
          img.src = img._mapURL;
          E.base.appendChild(img);
          S.base[key] = img;
          pending++;
        }
      }
      Object.keys(S.base).forEach(function (k) {
        if (!want[k]) { clearTimeout(S.base[k]._retryT); S.base[k].onload = S.base[k].onerror = null; S.base[k].removeAttribute('src'); S.base[k].remove(); delete S.base[k]; }
      });
      if (!pending) baseLoaded();
    }
    function baseLoaded() {
      if (this && this.tagName === 'IMG' && this.naturalWidth) {
        clearTimeout(this._retryT);
        this._mapFailed = false;
        this.style.visibility = '';
      }
      var left = Object.keys(S.base).some(function (k) { return !S.base[k].complete || S.base[k]._mapFailed; });
      if (!left) dropOldBase();
    }
    function baseFailed() {
      var img = this;
      img._mapFailed = true;
      img.style.visibility = 'hidden';
      // A dropped tile otherwise leaves a rectangular hole indefinitely.
      // Retry once, only while visible, retaining old zoom tiles underneath.
      if (img._retried || !awake()) return;
      img._retried = true;
      img._retryT = setTimeout(function () {
        img._retryT = null;
        if (awake() && S.base[img._mapKey] === img) img.src = img._mapURL;
      }, 1000);
    }
    function dropOldBase() {
      if (S.oldBase) {
        S.oldBase.querySelectorAll('img').forEach(function (i) { clearTimeout(i._retryT); i.onload = i.onerror = null; i.removeAttribute('src'); });
        S.oldBase.remove();
        S.oldBase = null;
      }
    }
    function drawPin() {
      var r = S.r;
      E.mk.innerHTML = '';
      if (!r || !r.marker || !S.home) return;
      var p = document.createElement('div');
      p.className = 'pin';
      p.style.left = wx(S.home.lon, S.z) + 'px';
      p.style.top = wy(S.home.lat, S.z) + 'px';
      E.mk.appendChild(p);
    }

    // ---------------------------------------------------------- the radar
    // A FRAME'S LAYER: a div of images in world pixels. 'image' providers:
    // one picture of the view and half again around it, fetched for the zoom
    // it was asked at and scaled when the zoom moves until a new one comes.
    // 'tiles': the provider's tiles at its own closest zoom, drawn larger.
    function viewKey() { return S.z + ':' + Math.round(S.cx / 64) + ':' + Math.round(S.cy / 64) + ':' + S.w + 'x' + S.h; }
    function frameLayer(f) {
      var L = S.fr[f.id];
      if (!L) {
        var el = document.createElement('div');
        el.className = 'fr';
        E.wx.appendChild(el);
        L = S.fr[f.id] = { el: el, f: f, imgs: {}, ready: false, view: null, z: null };
      }
      return L;
    }
    function fillFrame(L, done) {
      var A = S.A, z = S.z, tl = topLeft();
      if (!A || !S.w) return;
      L.done = done || L.done;
      if (A.kind === 'image') {
        var cur = L.imgs.one;
        var covers = function (bz, bb) { return bb && bz === z && tl.x >= bb.x0 && tl.y >= bb.y0 && tl.x + S.w <= bb.x1 && tl.y + S.h <= bb.y1; };
        if (cur && covers(L.z, L.b)) return;
        // one request at a time per frame: one already asked for this view is waited for
        if (L.pending && covers(L.pending.z, L.pending.b)) return;
        if (L.pending) { L.pending.img.onload = L.pending.img.onerror = null; L.pending.img.removeAttribute('src'); L.pending.img.remove(); L.pending = null; }
        if (cur && L.z !== z) {
          // the old picture scaled to the new zoom, while the new one comes
          var k = Math.pow(2, z - L.z);
          cur.style.left = (L.b.x0 * k) + 'px'; cur.style.top = (L.b.y0 * k) + 'px';
          cur.style.width = ((L.b.x1 - L.b.x0) * k) + 'px'; cur.style.height = ((L.b.y1 - L.b.y0) * k) + 'px';
        }
        var mw = Math.round(S.w * 0.25), mh = Math.round(S.h * 0.25);
        var b = { x0: Math.round(tl.x) - mw, y0: Math.round(tl.y) - mh, x1: Math.round(tl.x + S.w) + mw, y1: Math.round(tl.y + S.h) + mh };
        var w = Math.min(2048, b.x1 - b.x0), h = Math.min(2048, b.y1 - b.y0);
        var img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.crossOrigin = 'anonymous';
        img.style.left = b.x0 + 'px'; img.style.top = b.y0 + 'px';
        img.style.width = (b.x1 - b.x0) + 'px'; img.style.height = (b.y1 - b.y0) + 'px';
        var gen = S.gen;
        img.onload = function () {
          if (gen !== S.gen || !S.alive) return;
          L.pending = null;
          if (L.imgs.one && L.imgs.one !== img) { L.imgs.one.removeAttribute('src'); L.imgs.one.remove(); }
          L.imgs.one = img; L.z = z; L.b = b; L.ready = true;
          img.style.visibility = '';
          delete S.failed[L.f.id];
          if (L.done) { var d = L.done; L.done = null; d(true); }
        };
        img.onerror = function () {
          if (gen !== S.gen || !S.alive) return;
          L.pending = null;
          img.remove();
          S.failed[L.f.id] = true;
          if (L.done) { var d = L.done; L.done = null; d(false); }
          paintStatus();
        };
        img.style.visibility = 'hidden';
        img.src = A.image(L.f, { x0: mx(b.x0, z), y0: my(b.y1, z), x1: mx(b.x1, z), y1: my(b.y0, z) }, w, h);
        L.pending = { img: img, z: z, b: b };
        L.el.appendChild(img);
        return;
      }
      // tiles
      var zr = Math.min(z, A.maxZoom), k2 = Math.pow(2, z - zr), ts = TILE * k2, n = Math.pow(2, zr);
      if (L.z !== z) {
        Object.keys(L.imgs).forEach(function (key) { L.imgs[key].removeAttribute('src'); L.imgs[key].remove(); });
        L.imgs = {}; L.z = z; L.ready = false;
      }
      var x0 = Math.floor(tl.x / ts), x1 = Math.floor((tl.x + S.w) / ts), y0 = Math.max(0, Math.floor(tl.y / ts)), y1 = Math.min(n - 1, Math.floor((tl.y + S.h) / ts));
      var want = {}, pending = 0, gen2 = S.gen;
      var settle = function () {
        if (gen2 !== S.gen || !S.alive) return;
        var left = Object.keys(L.imgs).some(function (key) { return !L.imgs[key].complete; });
        if (!left) {
          var keys = Object.keys(L.imgs), missing = keys.some(function (key) { return L.imgs[key]._radarFailed; });
          L.ready = keys.some(function (key) { return !L.imgs[key]._radarFailed; });
          if (missing) S.failed[L.f.id] = true; else delete S.failed[L.f.id];
          if (L.done) { var d = L.done; L.done = null; d(L.ready); }
          paintStatus();
        }
      };
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          var key = x + '/' + y;
          want[key] = true;
          if (L.imgs[key]) continue;
          var im = document.createElement('img');
          im.alt = '';
          im.decoding = 'async';
          im.style.left = (x * ts) + 'px'; im.style.top = (y * ts) + 'px';
          im.style.width = ts + 'px'; im.style.height = ts + 'px';
          im.onload = settle;
          im.onerror = function () { this._radarFailed = true; this.style.display = 'none'; settle(); };
          im.src = A.tile(L.f, zr, ((x % n) + n) % n, y);
          L.el.appendChild(im);
          L.imgs[key] = im;
          pending++;
        }
      }
      Object.keys(L.imgs).forEach(function (key) {
        if (!want[key]) { L.imgs[key].removeAttribute('src'); L.imgs[key].remove(); delete L.imgs[key]; }
      });
      if (!pending) settle();
    }
    // the frame shown and the one after it; every other layer let go
    function keepOnly(ids) {
      Object.keys(S.fr).forEach(function (id) {
        if (ids.indexOf(id) >= 0) return;
        var L = S.fr[id];
        Object.keys(L.imgs).forEach(function (k) { L.imgs[k].onload = L.imgs[k].onerror = null; L.imgs[k].removeAttribute('src'); });
        if (L.pending) { L.pending.img.onload = L.pending.img.onerror = null; L.pending.img.removeAttribute('src'); }
        L.el.remove();
        delete S.fr[id];
      });
    }
    function show(i, cb) {
      var f = S.frames[i];
      if (!f || !awake()) return;
      var selection = ++S.selection;
      var L = frameLayer(f);
      var swap = function () {
        if (selection !== S.selection || !awake()) return;
        Object.keys(S.fr).forEach(function (id) { S.fr[id].el.classList.toggle('on', id === f.id); });
        var first = S.i < 0;
        S.i = i;
        if (first && motion() && typeof E.wx.animate === 'function') {
          try { E.wx.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }); } catch (e) { /* ok */ }
        }
        paintTimeline();
        var next = S.frames[(i + 1) % S.frames.length];
        keepOnly([f.id].concat(next && S.playing ? [next.id] : []));
        if (next && S.playing && next.id !== f.id) fillFrame(frameLayer(next));
        if (cb) cb();
      };
      if (L.ready && L.z === S.z) { fillFrame(L); swap(); return; }
      fillFrame(L, function (ok) {
        if (selection !== S.selection || !awake()) return;
        if (ok) swap();
        else {
          message('This radar image couldn’t load. Try again to reload the radar.', true);
          paintTimeline();
          if (cb) cb();
        }
      });
    }

    // ------------------------------------------------------------ frames
    function loadFrames(first) {
      if (!S.A || !S.home || !awake()) return;
      if (S.ctl) S.ctl.abort();
      var ctl = S.ctl = new AbortController(), gen = S.gen, request = ++S.request;
      if (first) say('Loading radar…');
      S.A.frames(S.home, S.r.history_minutes, ctl.signal).then(function (got) {
        if (gen !== S.gen || request !== S.request || !awake()) return;
        S.err = null;
        S.meta = got;
        var latestBefore = S.frames.length ? S.frames[S.frames.length - 1].id : null;
        var atLatest = S.i < 0 || S.i === S.frames.length - 1;
        var selected = S.frames[S.i] && S.frames[S.i].id;
        S.frames = got.frames;
        if (!S.frames.length) {
          play(false);
          keepOnly([]);
          S.i = -1;
          message(S.A.id === 'noaa' ? 'NOAA has no radar for this place. It covers the United States, Alaska, Hawaii and the Caribbean — RainViewer covers more.'
                                    : 'No radar frames from RainViewer right now.', true);
          paintTimeline(); paintStatus();
          return;
        }
        message(null);
        var retained = S.frames.findIndex(function (f) { return f.id === selected; });
        S.i = retained >= 0 ? retained : Math.min(Math.max(0, S.i), S.frames.length - 1);
        var latest = S.frames[S.frames.length - 1].id;
        if (first || (atLatest && !S.playing && latest !== latestBefore)) show(S.frames.length - 1, function () {
          if (first && S.r.autoplay && !S.played && autoplayOk()) { S.played = true; play(true); }
        });
        else if (!S.playing) show(S.i);
        else paintTimeline();
        paintStatus();
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        if (gen !== S.gen || request !== S.request || !awake()) return;
        S.err = String((e && e.message) || e);
        // older frames stay as they were, their times with them
        if (!S.frames.length) message('Couldn’t reach ' + S.A.name + '. The forecast is unaffected.', true);
        paintStatus();
      }).then(schedule);
    }
    function schedule() {
      clearTimeout(S.refreshT);
      S.refreshT = null;
      if (!awake() || !S.A) return;
      S.refreshT = setTimeout(function () { loadFrames(false); }, REFRESH);
    }

    // ---------------------------------------------------------- playback
    function play(on) {
      if (on && (S.frames.length < 2 || !awake())) return;
      S.playing = !!on;
      clearTimeout(S.playT);
      S.playT = null;
      E.pl.setAttribute('aria-label', on ? 'Pause radar history' : 'Play radar history');
      E.pl.querySelector('ha-icon').setAttribute('icon', on ? ICONS.pause : ICONS.play);
      if (on) step(true);
      else keepOnly(S.i >= 0 && S.frames[S.i] ? [S.frames[S.i].id] : []);
    }
    // ONE STEP AT A TIME: the next frame shows when it is in, then waits its
    // time -- never two requests racing to catch up. The latest frame is held
    // twice as long before the loop starts again.
    function step(start) {
      if (!S.playing || !awake() || S.frames.length < 2) { play(false); return; }
      var dur = SPEED[S.r.playback_speed] || 1000;
      var n = S.frames.length, next = start && S.i === n - 1 ? 0 : (S.i + 1) % n, tries = 0;
      while (S.failed[S.frames[next].id] && tries++ < n) next = (next + 1) % n;
      if (tries >= n) { play(false); return; }
      show(next, function () {
        if (!S.playing) return;
        S.playT = setTimeout(function () { step(false); }, next === n - 1 ? dur * 2 : dur);
      });
    }

    // -------------------------------------------------------- the labels
    function paintTimeline() {
      var n = S.frames.length, f = S.frames[S.i];
      E.rng.max = String(Math.max(0, n - 1));
      E.rng.value = String(Math.max(0, S.i));
      E.rng.style.setProperty('--played', (n > 1 ? Math.max(0, S.i) / (n - 1) * 100 : 0) + '%');
      E.rng.disabled = n < 2;
      E.pl.disabled = n < 2;
      var txt = f ? fmtTime(f.time) + (S.i === n - 1 ? '' : ' · −' + Math.round((S.frames[n - 1].time - f.time) / 60e3) + ' min') : '';
      if (f && S.failed[f.id]) txt += ' · missing';
      E.out.textContent = txt;
      E.rng.setAttribute('aria-valuetext', f ? 'Radar at ' + fmtTime(f.time) : 'No radar');
      E.t0.textContent = n ? '−' + Math.round((S.frames[n - 1].time - S.frames[0].time) / 60e3) + ' min' : '';
      E.history.hidden = !n;
      if (n) {
        var first = S.frames[0].time, last = S.frames[n - 1].time;
        var at = f ? f.time : last;
        var position = last > first ? (at - first) / (last - first) * 100 : 100;
        E.history.style.setProperty('--history-position', Math.max(0, Math.min(100, position)) + '%');
        E.start.textContent = fmtTime(first);
        E.end.textContent = fmtTime(last);
        E.current.textContent = f ? fmtTime(at) : 'Loading…';
        E.history.setAttribute('aria-label', 'Radar history from ' + fmtTime(first) + ' to ' + fmtTime(last) + (f ? ', showing ' + fmtTime(at) : ', loading'));
      }
    }
    function paintStatus() {
      var bits = [];
      if (S.A) bits.push(S.A.name + ' · ' + S.plan.place);
      if (S.frames.length) {
        var last = S.frames[S.frames.length - 1];
        bits.push(S.err ? 'Last radar ' + ago(last.time) + ' (offline)' : 'Updated ' + fmtTime(last.time));
      }
      say(bits.join(' · '));
    }
    function say(t) { if (E.st.textContent !== t) E.st.textContent = t; }
    function message(t, retry) {
      E.msg.hidden = !t;
      E.mt.textContent = t || '';
      E.rt.hidden = !retry || !S.A;
    }
    function credits() {
      var list = OSM.attribution.concat(S.A ? S.A.attribution : []);
      E.cr.innerHTML = list.map(function (a) {
        return '<a href="' + a[1] + '" target="_blank" rel="noopener">' + a[0].replace(/[<>&"]/g, '') + '</a>';
      }).join(' · ');
      E.rc.style.setProperty('--rm-legend', S.A ? S.A.legend : 'transparent');
      E.lg.style.display = S.A ? '' : 'none';
    }

    // --------------------------------------------------------- the view
    function render() {
      if (!awake()) return;
      placeStage();
      drawBase();
      if (S.i >= 0 && S.frames[S.i]) {
        var L = S.fr[S.frames[S.i].id];
        if (L) fillFrame(L);
      }
    }
    var moveT = null;
    function moved() {
      placeStage();
      clearTimeout(moveT);
      // the map follows at once; the radar asks for the new area once the
      // map has settled (a drag never queues a request per frame)
      moveT = setTimeout(render, 140);
    }
    function setZoom(z, ax, ay) {
      z = Math.max(MIN_Z, Math.min(MAX_Z, z));
      if (z === S.z) return;
      // keep the point under (ax, ay) -- the middle by default -- where it is
      ax = ax == null ? S.w / 2 : ax; ay = ay == null ? S.h / 2 : ay;
      var tl = topLeft(), px = tl.x + ax, py = tl.y + ay, k = Math.pow(2, z - S.z);
      S.cx = px * k - ax + S.w / 2; S.cy = py * k - ay + S.h / 2;
      S.z = z;
      drawPin();
      render();
      paintZoom();
    }
    function paintZoom() {
      E.zin.disabled = S.z >= MAX_Z;
      E.zout.disabled = S.z <= MIN_Z;
    }
    function recenter() {
      if (!S.home) return;
      S.z = S.r.zoom;
      S.cx = wx(S.home.lon, S.z); S.cy = wy(S.home.lat, S.z);
      drawPin();
      render();
      paintZoom();
    }

    // ------------------------------------------------------ touch, mouse
    var ptrs = {}, drag = null, pinch = null;
    E.map.addEventListener('pointerdown', function (e) {
      if (!S.interactive) return;
      try { E.map.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 1) { drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy }; E.map.classList.add('drag'); }
      else if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]], r = E.map.getBoundingClientRect();
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, s: 1 };
        drag = null;
      }
    });
    E.map.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch) {
        var ids = Object.keys(ptrs);
        if (ids.length < 2) return;
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        pinch.s = Math.max(0.25, Math.min(4, Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        var tl = topLeft();
        E.stage.style.transform = 'translate(' + pinch.mx + 'px,' + pinch.my + 'px) scale(' + pinch.s + ') translate(' +
          (-pinch.mx - Math.round(tl.x)) + 'px,' + (-pinch.my - Math.round(tl.y)) + 'px)';
        return;
      }
      if (!drag) return;
      S.cx = drag.cx - (e.clientX - drag.x);
      S.cy = drag.cy - (e.clientY - drag.y);
      moved();
    });
    function up(e) {
      if (!ptrs[e.pointerId]) return;
      delete ptrs[e.pointerId];
      E.map.classList.remove('drag');
      if (pinch && Object.keys(ptrs).length < 2) {
        var p = pinch, dz = Math.round(Math.log(p.s) / Math.LN2);
        pinch = null;
        placeStage();
        if (dz) setZoom(S.z + dz, p.mx, p.my); else render();
        drag = null;
        ptrs = {};
        return;
      }
      if (drag) { drag = null; render(); }
    }
    E.map.addEventListener('pointerup', up);
    E.map.addEventListener('pointercancel', up);
    var wheelAcc = 0, wheelT = null;
    E.map.addEventListener('wheel', function (e) {
      if (!S.interactive) return;
      e.preventDefault();
      wheelAcc += e.deltaY;
      clearTimeout(wheelT);
      var r = E.map.getBoundingClientRect(), ax = e.clientX - r.left, ay = e.clientY - r.top;
      if (Math.abs(wheelAcc) >= 60) { setZoom(S.z + (wheelAcc < 0 ? 1 : -1), ax, ay); wheelAcc = 0; }
      wheelT = setTimeout(function () { wheelAcc = 0; }, 250);
    }, { passive: false });
    E.map.addEventListener('keydown', function (e) {
      if (!S.interactive) return;
      var d = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] }[e.key];
      if (d) { e.preventDefault(); S.cx += d[0]; S.cy += d[1]; moved(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(S.z + 1); }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(S.z - 1); }
    });
    E.zin.addEventListener('click', function () { setZoom(S.z + 1); });
    E.zout.addEventListener('click', function () { setZoom(S.z - 1); });
    E.rcn.addEventListener('click', recenter);
    E.pl.addEventListener('click', function () { play(!S.playing); });
    E.rng.addEventListener('input', function () { play(false); show(Number(E.rng.value)); });
    E.rt.addEventListener('click', function () { message(null); loadFrames(true); });

    // ------------------------------------------------------ full screen
    var dlg = null;
    function expand(on) {
      if (on === !!dlg) return;
      if (on) {
        dlg = document.createElement('dialog');
        dlg.className = 'rx';
        dlg.setAttribute('aria-label', 'Precipitation radar');
        host.getRootNode().appendChild(dlg);
        host.style.height = E.rc.offsetHeight + 'px';      // its place on the page held
        dlg.appendChild(E.rc);
        dlg.addEventListener('cancel', function (e) { e.preventDefault(); expand(false); });
        dlg.addEventListener('click', function (e) { if (e.target === dlg) expand(false); });
        try { dlg.showModal(); } catch (x) { dlg.setAttribute('open', ''); }
        E.xp.setAttribute('aria-label', 'Close full-screen radar');
        E.xp.setAttribute('aria-expanded', 'true');
        E.xp.querySelector('ha-icon').setAttribute('icon', 'mdi:close');
        E.rc.classList.remove('calm');
        E.rc.classList.remove('preview');
        S.interactive = !!S.r.interactive;
        E.map.classList.toggle('still', !S.interactive);
        E.tools.style.display = S.interactive ? '' : 'none';
        E.xp.focus();
      } else {
        host.appendChild(E.rc);
        host.style.height = '';
        try { dlg.close(); } catch (x) { /* gone */ }
        dlg.remove();
        dlg = null;
        E.xp.setAttribute('aria-label', 'Expand radar');
        E.xp.setAttribute('aria-expanded', 'false');
        E.xp.querySelector('ha-icon').setAttribute('icon', ICONS.expand);
        E.rc.classList.toggle('calm', !!S.r && !S.r.playback_controls);
        E.rc.classList.add('preview');
        S.interactive = false;
        E.map.classList.add('still');
        recenter();
        E.xp.focus();
      }
      requestAnimationFrame(function () { if (S.alive && size()) render(); });
    }
    E.xp.addEventListener('click', function () { expand(!dlg); });

    // ------------------------------------------------ the page around it
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function () { if (size()) render(); }) : null;
    if (ro) ro.observe(E.map);
    var io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (en) {
      var on = en.some(function (x) { return x.isIntersecting; });
      if (on === S.onScreen) return;
      S.onScreen = on;
      if (!on) suspend();
      else if (S.A && Date.now() - ((S.frames[S.frames.length - 1] || {}).time || 0) > REFRESH) { size(); render(); loadFrames(S.i < 0); }
      else schedule();
    }) : null;
    if (io) io.observe(E.rc);
    // hidden (another tab, the tablet's screen asleep): nothing runs, and
    // playback does not start again by itself
    function vis() {
      S.visible = !document.hidden;
      if (!awake()) suspend();
      else if (S.A) { size(); render(); loadFrames(S.i < 0); }
    }
    function suspend() {
      play(false);
      S.request++;
      S.selection++;
      if (S.ctl) S.ctl.abort();
      clearTimeout(S.refreshT); S.refreshT = null;
      clearTimeout(moveT); clearTimeout(wheelT);
      Object.keys(S.base).forEach(function (k) {
        var img = S.base[k];
        if (img._retryT) { clearTimeout(img._retryT); img._retryT = null; img._retried = false; }
      });
      Object.keys(S.fr).forEach(function (id) {
        var L = S.fr[id];
        if (L.pending) {
          L.pending.img.onload = L.pending.img.onerror = null;
          L.pending.img.removeAttribute('src'); L.pending.img.remove(); L.pending = null;
        }
      });
    }
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('hk-asleep', vis);

    // ------------------------------------------- settings and the house
    function update(hass) {
      S.hass = hass;
      var r = settings();
      if (!r || !HS.radarPlan) return;
      var plan = HS.radarPlan(hass);
      var light = !!(HS.rendering && HS.rendering().flat && HS.rendering().theme === 'light');
      E.rc.setAttribute('data-theme', light ? 'light' : 'dark');
      E.rc.style.setProperty('--rm-op', String(r.opacity / 100));
      S.interactive = !!dlg && !!r.interactive;
      E.map.classList.toggle('still', !S.interactive);
      E.tools.style.display = S.interactive ? '' : 'none';
      E.map.setAttribute('aria-label', 'Precipitation radar map around ' + plan.place + (S.interactive ? '. Arrow keys move it; plus and minus zoom.' : '.'));
      if (!dlg) E.rc.classList.toggle('calm', !r.playback_controls);
      E.rc.classList.toggle('preview', !dlg);
      var key = JSON.stringify([plan.provider, plan.lat, plan.lon, r.history_minutes]);
      var viewKey2 = JSON.stringify([r.zoom, r.marker]);
      S.plan = plan;
      var oldR = S.r;
      S.r = r;
      if (key !== S.key) {
        // A NEW PROVIDER OR PLACE: everything in flight stops, every image
        // held goes, and the map starts again there
        S.key = key;
        S.gen++;
        if (S.ctl) S.ctl.abort();
        play(false);
        keepOnly([]);
        S.frames = []; S.i = -1; S.failed = {}; S.err = null; S.meta = null;
        S.A = plan.provider ? ADAPTERS[plan.provider] : null;
        S.home = plan.lat != null ? { lat: plan.lat, lon: plan.lon } : null;
        credits();
        paintTimeline();
        if (!S.home || !S.A) {
          message(plan.reason === 'zone' ? 'Choose a zone for the map in HK Settings.' :
                  plan.reason === 'location' ? 'Home Assistant has no location for this home.' :
                  'Choose a radar provider in HK Settings → Weather → Radar Map: Automatic can’t tell which country this place is in.', false);
          say('');
          return;
        }
        size();
        S.z = r.zoom;
        S.cx = wx(S.home.lon, S.z); S.cy = wy(S.home.lat, S.z);
        drawPin();
        render();
        paintZoom();
        loadFrames(true);
        return;
      }
      if (oldR && JSON.stringify([oldR.zoom, oldR.marker]) !== viewKey2) {
        if (oldR.zoom !== r.zoom) recenter(); else drawPin();
      }
      if (oldR && oldR.playback_speed !== r.playback_speed && S.playing) { clearTimeout(S.playT); step(false); }
    }
    function detach() {
      S.alive = false;
      S.gen++;
      if (S.ctl) S.ctl.abort();
      clearTimeout(S.playT); clearTimeout(S.refreshT); clearTimeout(moveT); clearTimeout(wheelT);
      if (dlg) expand(false);
      keepOnly([]);
      Object.keys(S.base).forEach(function (k) { clearTimeout(S.base[k]._retryT); S.base[k].onload = S.base[k].onerror = null; S.base[k].removeAttribute('src'); });
      S.base = {};
      dropOldBase();
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('hk-asleep', vis);
      host.innerHTML = '';
    }
    // for tests and the live checks: what it is doing
    function state() {
      return { provider: S.A && S.A.id, frames: S.frames.map(function (f) { return f.time; }), i: S.i, playing: S.playing,
               z: S.z, layers: Object.keys(S.fr).length, baseTiles: Object.keys(S.base).length, err: S.err,
               expanded: !!dlg, interactive: S.interactive, refresh: !!S.refreshT, message: E.msg.hidden ? null : E.mt.textContent };
    }
    return { update: update, detach: detach, state: state, play: play, expand: expand, setZoom: setZoom, show: show };
  }

  window.hkRadar = { version: '1.0.0', attach: attach, check: check, ADAPTERS: ADAPTERS, OSM: OSM,
                     _: { wx: wx, wy: wy, mx: mx, my: my, css: css } };
  window.dispatchEvent(new CustomEvent('hk-radar-ready'));
})();
