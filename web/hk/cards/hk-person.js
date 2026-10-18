// hk-person.js -- THE PERSON SHEET (hk-detail.js kind `person`): where
// someone is, opened from their tile or their notification.
//
// Two columns on a tablet (the WIDE sheet), one on a phone:
//   them    their picture or initials, big (ringed green at home); Home,
//           Away or the zone they're in, and since when; the last 24 hours
//           as a home / away bar (the door's strip); their phone and its
//           battery (the device tracker's own device)
//   where   a map of where they are, the zone drawn, the where over its
//           foot ("Work · 12 mi from home · since 8:31 AM"); and Other
//           Members -- everyone else, a tap opening theirs in its place,
//           with ‹ back
//
// THE MAP is OpenStreetMap's own tiles, darkened to the sheet's look, laid
// out here: no map library, nothing to load -- a sheet that opens has its
// map at once. Home Assistant's own map (CARTO's tiles) now asks for an API
// key. © OpenStreetMap contributors, said on the map.
//
// The sheet keeps HK's sizes and spacing (hk-detail.js SP): 20 between the
// columns, 12 between blocks, 6 from a title to its line, HK's cards.
(function () {
  'use strict';

  function whenDetail(fn) {
    if (window.hkDetail && window.hkDetail._) return fn(window.hkDetail);
    window.addEventListener('hk-detail-ready', function () { if (window.hkDetail) fn(window.hkDetail); }, { once: true });
  }

  whenDetail(function (X) {
    if (customElements.get('hk-detail-person')) return;
    var U = X._, C = window.hkCards, esc = C.esc, SP = U.SP;
    var DAY = U.DAY, HOME_ON = 'rgba(52,199,89,0.85)', RING_OFF = 'rgba(255,255,255,0.22)';
    var TILE = 256;

    function stOf(h, id) { return h && h.states ? h.states[id] : null; }
    function nameOf(s) { return (s && s.attributes && s.attributes.friendly_name) || ''; }
    function initials(name) {
      var p = String(name || '').split(/\s+/).filter(function (w) { return /^[A-Za-z0-9]/.test(w); });
      return (p.slice(0, 2).map(function (w) { return w[0]; }).join('') || '?').toUpperCase();
    }
    function clock(t) {
      try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
    }
    function dayClock(iso) {
      var t = Date.parse(iso);
      if (!isFinite(t)) return '';
      var d = new Date(t);
      return d.toDateString() === new Date().toDateString() ? clock(t)
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + clock(t);
    }
    function dur(ms) {
      var m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60);
      return h ? h + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';
    }
    // Home, Away, or the zone's name
    function where(h, s) {
      if (!s) return '';
      if (s.state === 'home') return 'Home';
      if (s.state === 'not_home') return 'Away';
      if (s.state === 'unknown' || s.state === 'unavailable') return 'Unknown';
      return s.state;
    }
    function since(s) {
      if (!s) return '';
      var t = dayClock(s.last_changed);
      return t ? (s.state === 'home' ? 'Arrived ' : s.state === 'not_home' ? 'Left ' : 'Since ') + t : '';
    }
    function zoneOf(h, s) {
      if (!s) return null;
      if (s.state === 'home') return stOf(h, 'zone.home');
      var hit = null;
      Object.keys((h && h.states) || {}).some(function (k) {
        if (k.indexOf('zone.') !== 0) return false;
        if (nameOf(h.states[k]) === s.state) hit = h.states[k];
        return !!hit;
      });
      return hit;
    }
    function ll(s) {
      var a = s && s.attributes;
      return a && isFinite(a.latitude) && isFinite(a.longitude) ? [Number(a.latitude), Number(a.longitude)] : null;
    }
    function miles(h) { return !!(h && h.config && h.config.unit_system && h.config.unit_system.length === 'mi'); }
    function distance(a, b) {               // km
      var R = 6371, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r;
      var x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
      return 2 * R * Math.asin(Math.sqrt(x));
    }
    function farText(h, km) {
      var v = miles(h) ? km * 0.621371 : km, u = miles(h) ? 'mi' : 'km';
      return (v < 10 ? Math.round(v * 10) / 10 : Math.round(v)) + ' ' + u + ' from home';
    }
    // their phone: the device tracker's device, and a battery on it
    function phoneOf(h, s) {
      var trk = (s && s.attributes && s.attributes.device_trackers) || [], E = (h && h.entities) || {};
      for (var i = 0; i < trk.length; i++) {
        var e = E[trk[i]], dev = e && e.device_id;
        if (!dev) continue;
        var d = h.devices && h.devices[dev];
        var bat = Object.keys(E).filter(function (k) {
          var st = h.states[k];
          return E[k].device_id === dev && k.indexOf('sensor.') === 0 && st && st.attributes.device_class === 'battery' &&
                 st.attributes.unit_of_measurement === '%';
        })[0];
        return { name: (d && (d.name_by_user || d.name)) || nameOf(stOf(h, trk[i])) || 'Phone',
                 battery: bat && isFinite(Number(h.states[bat].state)) ? Math.round(Number(h.states[bat].state)) + '%' : '' };
      }
      return null;
    }
    function avatar(h, s, cls, style) {
      var pic = s && s.attributes && s.attributes.entity_picture;
      return '<div class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + '>' +
        (pic ? '<img alt="" src="' + esc(pic) + '">' : esc(initials(nameOf(s)))) + '</div>';
    }

    // ---------------------------------------------------------------- map
    function tiles(lat, lon, z) {
      var n = Math.pow(2, z), x = (lon + 180) / 360 * n;
      var la = lat * Math.PI / 180, y = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n;
      var tx = Math.floor(x), ty = Math.floor(y), fx = (x - tx) * TILE, fy = (y - ty) * TILE, out = '';
      for (var i = -2; i <= 2; i++) for (var j = -2; j <= 2; j++) {
        var yy = ty + j, xx = ((tx + i) % n + n) % n;
        if (yy < 0 || yy >= n) continue;
        out += '<img alt="" loading="lazy" src="https://tile.openstreetmap.org/' + z + '/' + xx + '/' + yy + '.png" style="left:' +
          (i * TILE - fx).toFixed(1) + 'px;top:' + (j * TILE - fy).toFixed(1) + 'px">';
      }
      return out;
    }
    // metres -> px at this zoom and latitude
    function px(m, lat, z) { return m / (156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z)); }
    // the closest zoom that keeps a zone of `r` metres inside `box` px
    function zoomFor(r, lat, box) {
      for (var z = 17; z > 10; z--) if (px(r, lat, z) * 2 <= box * 0.6) return z;
      return 11;
    }

    var CSS = [
      ':host{display:block;color:' + window.hkCards.v('ink') + '}',
      '.pp{display:flex;gap:' + SP.region + 'px;min-height:100%;box-sizing:border-box}',
      '.col{display:flex;flex-direction:column;gap:' + SP.block + 'px;min-width:0}',
      '.c1{width:340px;flex:none}.c2{flex:1}',
      '.pp.one{flex-direction:column;gap:' + SP.block + 'px}.pp.one .c1,.pp.one .c2{width:auto;display:contents}',
      '.pp .hkn-card{margin-bottom:' + (SP.region - SP.block) + 'px}',
      '.card{border-radius:' + SP.cardR + 'px;background:rgba(255,255,255,0.08);padding:' + SP.cardPad + ';flex:none}',
      '.card.rows{padding:' + SP.rowsPad + '}',
      '.lab{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:13px;line-height:16px;font-weight:600;',
      '  letter-spacing:0.3px;color:' + window.hkCards.v('ink-2') + ';text-transform:uppercase}',
      // the day in words beside the label, or under it where it can't fit
      '.lab{flex-wrap:wrap;row-gap:4px}',
      '.lab > span:first-child{white-space:nowrap}',
      '.lab .n{text-transform:none;font-size:15px;font-weight:400;letter-spacing:0;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;margin-left:auto}',
      '.row{display:flex;align-items:center;gap:12px;font-size:16px;line-height:20px}',
      '.row ha-icon{--mdc-icon-size:20px;opacity:.7;flex:none;display:flex}',
      '.row .v{margin-left:auto;color:' + window.hkCards.v('ink-2') + '}',
      '.av{border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:650;overflow:hidden;flex:none;',
      '  background:linear-gradient(180deg,#a3a9b5,#7b8190);color:#fff}',
      '.av img{width:100%;height:100%;object-fit:cover}',
      '.me{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;min-height:0;text-align:center}',
      '.me .av{width:116px;height:116px;font-size:42px;box-shadow:0 0 0 5px var(--ring)}',
      '.big{font-size:36px;font-weight:700;letter-spacing:-1px;line-height:40px}',  // hkCards.TYPE figure-l
      '.me .big{margin-top:' + SP.region + 'px}',
      '.sub{font-size:15px;line-height:20px;color:' + window.hkCards.v('ink-2') + ';margin-top:' + SP.line + 'px}',
      '.meh{display:flex;align-items:center;gap:18px;padding:4px ' + SP.inset + 'px 4px ' + (SP.inset + 4) + 'px;flex:none}',
      '.meh .av{width:64px;height:64px;font-size:24px;box-shadow:0 0 0 4px var(--ring)}',
      '.meh .big{font-size:32px;line-height:36px}',
      '.bar{position:relative;height:28px;border-radius:9px;background:rgba(255,255,255,0.10);margin-top:' + SP.block + 'px;overflow:hidden}',
      '.bar i{position:absolute;top:0;bottom:0;min-width:2px}',
      '.bar .q{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.08)}',
      '.axx{position:relative;height:14px;margin-top:8px;font-size:12px;line-height:14px;color:' + window.hkCards.v('ink-3') + '}',
      '.axx span{position:absolute;top:0;white-space:nowrap;transform:translateX(-50%)}',
      '.axx span:first-child{transform:none}.axx span:last-child{transform:translateX(-100%)}',
      '.map{position:relative;flex:1;min-height:0;border-radius:' + SP.cardR + 'px;overflow:hidden;background:#1b1d22}',
      '.pp.one .map{flex:none;height:240px}',
      '.map .t{position:absolute;left:50%;top:50%}',
      '.map .t img{position:absolute;width:' + TILE + 'px;height:' + TILE + 'px;',
      '  filter:invert(.92) hue-rotate(180deg) saturate(.35) brightness(1.05) contrast(.95)}',
      '.map .zone{position:absolute;border-radius:50%;transform:translate(-50%,-50%);background:rgba(10,132,255,0.18);',
      '  border:1.5px solid rgba(10,132,255,0.7)}',
      '.map .pin{position:absolute;transform:translate(-50%,-50%);width:46px;height:46px;font-size:16px;',
      '  box-shadow:0 0 0 3px var(--ring),0 6px 16px rgba(0,0,0,.5)}',
      '.map .where{position:absolute;left:10px;right:10px;bottom:10px;border-radius:12px;padding:10px 12px;',
      '  background:rgba(30,30,34,0.62);-webkit-backdrop-filter:blur(20px) saturate(1.5);backdrop-filter:blur(20px) saturate(1.5)}',
      '.map .where b{display:block;font-size:17px;line-height:22px}',
      '.map .where span{display:block;font-size:13px;line-height:18px;color:' + window.hkCards.v('ink-2') + '}',
      '.map .cr{position:absolute;right:10px;top:8px;font-size:10px;color:' + window.hkCards.v('ink-3') + '}',
      '.map .none{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;color:' + window.hkCards.v('ink-2') + '}',
      '.who{display:flex;gap:' + SP.block + 'px;margin-top:' + SP.block + 'px;flex-wrap:wrap}',
      '.who button{flex:1 1 140px;min-width:0;display:flex;align-items:center;gap:10px;height:52px;padding:0 12px 0 9px;',
      '  border-radius:26px;border:0;background:rgba(255,255,255,0.09);color:' + window.hkCards.v('ink') + ';font:inherit;font-size:14px;line-height:18px;',
      '  font-weight:600;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.who button:active{background:rgba(255,255,255,0.18)}',
      '.who .av{width:34px;height:34px;font-size:12px;box-shadow:0 0 0 2px var(--c)}',
      '.who .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.who small{display:block;font-size:12px;line-height:16px;font-weight:500;color:' + window.hkCards.v('ink-2') + '}',
      '.who .chev{margin-left:auto;opacity:.45;font-size:18px;flex:none}'
    ].join('');

    class PersonPanel extends U.Panel {
      // (the notification's card lives in here: its CSS too)
      static get CSS() { return U.PANEL_CSS + U.NOTE_CSS + CSS; }
      hkWidthKind() { return 'person'; }
      hkNoGear() { return true; }
      hkFill() { return !matchMedia('(max-width:' + C.BP.phone + 'px)').matches; }
      // the notification's card, at the top of the left column
      hkNote(card) { this._note = card; if (this._c1) this._c1.insertBefore(card, this._c1.firstChild); }
      // the header's well is their picture, its name theirs
      hkHead(h, d) {
        var s = stOf(h, d.id);
        d.well.style.background = 'transparent';
        var sig = (s && s.attributes.entity_picture) + '|' + nameOf(s);
        if (d.wellSig !== sig) {
          d.wellSig = sig;
          d.well.innerHTML = avatar(h, s, 'av', 'width:44px;height:44px;font-size:15px;border-radius:50%;display:flex;align-items:center;' +
            'justify-content:center;overflow:hidden;background:linear-gradient(180deg,#a3a9b5,#7b8190);font-weight:650').replace('<img ', '<img style="width:100%;height:100%;object-fit:cover" ');
        }
        d.tt.textContent = (d.src && d.src.name) || nameOf(s) || d.id;
        return true;
      }
      // WHAT IT DEPENDS ON IS LOOKED UP ONCE PER REGISTRY, not on every
      // update while the sheet is open: the people in the house and this
      // person's phone battery sensor -- each was a walk over every state and
      // every registry entry, 30-odd times a second on a wall tablet
      _deps(h, s) {
        var trk = ((s && s.attributes && s.attributes.device_trackers) || []).join(',');
        var D = this._depsMemo;
        if (D && D.ents === h.entities && D.trk === trk) return D;
        var people = Object.keys(h.states).filter(function (k) { return k.indexOf('person.') === 0; });
        var bat = null, E = h.entities || {};
        ((s && s.attributes && s.attributes.device_trackers) || []).some(function (t) {
          var dev = E[t] && E[t].device_id;
          if (!dev) return false;
          bat = Object.keys(E).filter(function (k) { return E[k].device_id === dev && k.indexOf('sensor.') === 0; })
            .filter(function (k) { var st = h.states[k]; return st && st.attributes.device_class === 'battery' && st.attributes.unit_of_measurement === '%'; })[0] || null;
          return true;
        });
        return (this._depsMemo = { ents: h.entities, trk: trk, people: people, bat: bat });
      }
      _sigOf() {
        var h = this._hass, s = stOf(h, this._id);
        if (!s) return 'x';
        var D = this._deps(h, s);
        var others = D.people.map(function (k) { return h.states[k] ? h.states[k].state : ''; }).join(',');
        return [s.last_updated, others, D.bat && h.states[D.bat] ? h.states[D.bat].state : ''].join('|');
      }
      _render() {
        var h = this._hass, s = this._stateObj;
        if (!h || !s) return;
        var one = matchMedia('(max-width:' + C.BP.phone + 'px)').matches;
        var home = s.state === 'home';
        if (!this._built || this._one !== one) {
          this._built = true; this._one = one;
          this._root.innerHTML = '<div class="pp' + (one ? ' one' : '') + '"><div class="col c1"></div><div class="col c2"></div></div>';
          this._c1 = this._root.querySelector('.c1'); this._c2 = this._root.querySelector('.c2');
          this._root.querySelector('.pp').addEventListener('click', this._click.bind(this));
          this._fetch();
        }
        this.style.setProperty('--ring', home ? HOME_ON : RING_OFF);
        var me = one
          ? '<div class="meh">' + avatar(h, s, 'av') + '<div><div class="big">' + esc(where(h, s)) + '</div><div class="sub">' + esc(since(s)) + '</div></div></div>'
          : '<div class="me">' + avatar(h, s, 'av') + '<div class="big">' + esc(where(h, s)) + '</div><div class="sub">' + esc(since(s)) + '</div></div>';
        var day = '<div class="card hist"><div class="lab"><span>Last 24 Hours</span><span class="n"></span></div><div class="bar"></div>' +
          U.timeRow(DAY, 5) + '</div>';
        var ph = phoneOf(h, s);
        var dev = ph ? '<div class="card rows"><div class="row"><ha-icon icon="mdi:cellphone"></ha-icon><span>' + esc(ph.name) + '</span>' +
          (ph.battery ? '<span class="v">' + esc(ph.battery) + '</span>' : '') + '</div></div>' : '';
        var others = Object.keys(h.states).filter(function (k) { return k.indexOf('person.') === 0 && k !== this._id; }, this)
          .sort(function (a, b) { return nameOf(h.states[a]).localeCompare(nameOf(h.states[b])); });
        var who = others.length ? '<div class="card"><div class="lab"><span>Other Members</span></div><div class="who">' +
          others.map(function (k) {
            var o = h.states[k];
            return '<button data-p="' + esc(k) + '">' + avatar(h, o, 'av', '--c:' + (o.state === 'home' ? '#34c759' : 'rgba(255,255,255,0.25)')) +
              '<span class="nm">' + esc(nameOf(o).split(/\s+/)[0] || k) + '<small>' + esc(where(h, o)) + '</small></span><span class="chev">›</span></button>';
          }).join('') + '</div></div>' : '';
        // the left column: (the notification) them, their day, their phone;
        // the right: the map, the others. A phone: all in one, the map under them.
        var note = this._note && this._note.parentNode ? this._note : this._note;
        this._c1.innerHTML = one ? me + this._map(h, s) + day + dev + who : me + day + dev;
        this._c2.innerHTML = one ? '' : this._map(h, s) + who;
        if (note) this._c1.insertBefore(note, this._c1.firstChild);
        this._paintDay();
      }
      _map(h, s) {
        var pos = ll(s), z0 = zoneOf(h, s), zpos = ll(z0), homeS = stOf(h, 'zone.home'), hpos = ll(homeS);
        var at_ = pos || zpos || hpos;
        if (!at_) return '<div class="map"><div class="none">No location</div></div>';
        var r = z0 && z0.attributes && Number(z0.attributes.radius) || 0;
        var z = r ? zoomFor(r, at_[0], 300) : 15;
        var line;
        if (s.state === 'home') line = since(s).replace('Arrived', 'Since');
        else {
          var far = pos && hpos ? farText(h, distance(pos, hpos)) : '';
          line = [far, (dayClock(s.last_changed) ? 'since ' + dayClock(s.last_changed) : '')].filter(Boolean).join(' · ');
        }
        var zone = '';
        if (r && zpos) {
          // the zone where it really is (the map is centred on them)
          var n = Math.pow(2, z), k = TILE * n;
          var X = function (p) { return (p[1] + 180) / 360 * k; };
          var Y = function (p) { var la = p[0] * Math.PI / 180; return (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * k; };
          zone = '<div class="zone" style="left:calc(50% + ' + (X(zpos) - X(at_)).toFixed(1) + 'px);top:calc(50% + ' + (Y(zpos) - Y(at_)).toFixed(1) +
            'px);width:' + (px(r, at_[0], z) * 2).toFixed(0) + 'px;height:' + (px(r, at_[0], z) * 2).toFixed(0) + 'px"></div>';
        }
        return '<div class="map"><div class="t">' + tiles(at_[0], at_[1], z) + '</div>' + zone +
          avatar(h, s, 'av pin', 'left:50%;top:50%') + '<div class="cr">© OpenStreetMap</div>' +
          '<div class="where"><b>' + esc(where(h, s)) + '</b>' + (line ? '<span>' + esc(line) + '</span>' : '') + '</div></div>';
      }
      _fetch() {
        var self = this;
        U.dayRows(this._hass, this._id).then(function (r) { self._rows = r.rows; self._t0 = r.t0; self._paintDay(); })
          .catch(function () { /* no history */ });
      }
      // the home / away bar: home green, a zone blue; and the day in words
      _paintDay() {
        var card = this._root.querySelector('.hist');
        if (!card || !this._rows) return;
        var t0 = this._t0, now = Date.now(), span = now - t0, segs = U.spansOf(this._rows, t0, now);
        card.querySelector('.bar').innerHTML = [25, 50, 75].map(function (q) { return '<b class="q" style="left:' + q + '%"></b>'; }).join('') +
          segs.filter(function (g) { return g.state !== 'not_home' && g.state !== 'unknown' && g.state !== 'unavailable'; }).map(function (g) {
            return '<i style="left:' + ((g.a - t0) / span * 100).toFixed(2) + '%;width:' + Math.max(0.3, (g.b - g.a) / span * 100).toFixed(2) +
              '%;background:' + (g.state === 'home' ? HOME_ON : 'rgba(10,132,255,0.8)') + '"></i>';
          }).join('');
        var s = this._stateObj, words = '';
        if (s && s.state === 'home') {
          // the last time out: five minutes or more away (a restart's
          // unknown, a tracker's blip, is no leaving)
          var out = segs.filter(function (g) {
            return g.state !== 'home' && g.state !== 'unknown' && g.state !== 'unavailable' && g.b - g.a >= 300000;
          }).pop();
          words = out ? 'Left ' + clock(out.a) + ' · Back ' + clock(out.b) : 'Home all day';
        } else if (s) {
          words = (s.state === 'not_home' ? 'Away ' : 'There ') + dur(now - Date.parse(s.last_changed));
        }
        card.querySelector('.n').textContent = words;
      }
      _click(e) {
        var b = e.target.closest ? e.target.closest('[data-p]') : null;
        if (!b) return;
        var st = X._.state();
        X.open(b.getAttribute('data-p'), null, { back: st && st.back0 ? st.back0 : null });
      }
    }
    customElements.define('hk-detail-person', PersonPanel);
  });
})();
