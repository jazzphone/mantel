// hk-sheet-security.js - The alarm keypad sheet and the camera sheet.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-security'] = function (K) {
    var at = K.at, bridge = K.bridge, C = K.C, esc = K.esc, glyph = K.glyph, Panel = K.Panel,
        PANEL_CSS = K.PANEL_CSS, pretty = K.pretty, SHORT_MQ = K.SHORT_MQ, stOf = K.stOf,
        unavailable = K.unavailable;

    // ------------------------------------------------------------ alarm
    // JUST THE KEYPAD, in the sheet: the state as the word every sheet leads
    // with, and the home's own keypad card under it -- the same card the
    // Security page shows, so the code path cannot drift. Locks and a
    // status block belong on the Security page, not in the alarm's sheet.
    var ALARM_WORDS = { disarmed: 'Disarmed', armed_home: 'Armed Home', armed_away: 'Armed Away', armed_night: 'Armed Night',
                        armed_vacation: 'Armed Vacation', armed_custom_bypass: 'Armed', arming: 'Arming…',
                        disarming: 'Disarming…', pending: 'Pending…', triggered: 'Triggered' };
    class AlarmPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          '.pn{align-items:stretch;gap:20px}',
          '.big.al{font-size:40px;align-self:center;display:flex;align-items:center;gap:12px}',
          '.big.al.trg{color:#ff453a}',
          // the shield the Security page's keypad shows at rest, in its colour
          '.big.al hk-icon{--mdc-icon-size:36px;width:36px;height:36px;display:flex;flex:none}',
          // the Security page's keypad, unboxed, its keys a size up for the sheet
          'hk-alarm-keypad-card{display:block;--hk-kp-key:56px}',
          // AN ALARM WITH NO CODE, AS A SHADE'S SHEET: the state's word, and
          // under it the slider's own capsule (.vs: its size, its glass) with
          // the modes spread down it -- the one it is in filled as the
          // slider's fill is, a hairline between the others
          '.pn.tapn{align-items:center}',
          '.pn.tapn .big.trg{color:#ff453a}',
          // where a shade's Open / Stop / Close row sits: kept empty, so the
          // word and the capsule land where a shade's do (the sheet centres)
          '.vpsp{height:52px}',
          '.vs.vp{height:400px;display:flex;flex-direction:column;padding:6px;box-sizing:border-box;cursor:default;touch-action:manipulation}',
          '.vp button{position:relative;flex:1 1 0;min-height:0;border:0;border-radius:38px;background:transparent;color:' + window.hkCards.v('ink') + ';',
          '  font:inherit;font-size:19px;font-weight:600;letter-spacing:-.2px;cursor:pointer;',
          '  -webkit-tap-highlight-color:transparent;transition:background .2s ease,color .2s ease}',
          '.vp button.on{background:rgba(255,255,255,0.95);color:rgba(0,0,0,0.88)}',
          // (the slider's own tick: 20 px in from each side, 2 px)
          '.vp button:not(:first-child)::before{content:"";position:absolute;left:14px;right:14px;top:-1px;',
          '  height:2px;border-radius:1px;background:rgba(255,255,255,0.16);transition:opacity .2s}',
          '.vp button.on::before,.vp button.on + button::before{opacity:0}',
          '.vp button:not(.on):active{background:rgba(255,255,255,0.10)}',
          '.vp button:focus-visible{outline:2px solid rgba(100,181,255,0.8);outline-offset:-2px}',
          ':host([na]) .vp button{opacity:.4;pointer-events:none}',
          '@media (max-width:' + C.BP.phone + 'px){.big.al{font-size:34px}.pn{gap:16px}.vs.vp{height:330px}.vp button{font-size:17px}.vpsp{height:48px}}',
          // A SHORT SCREEN: the word over the keypad side by side (its
          // `layout: 'side'`), the keys on the left, the field and the ways
          // to arm beside them -- four rows of keys, 10 apart, the body's
          // height less the word's 34 and the 12 under it
          '@media ' + SHORT_MQ + '{',
          '  .pn{height:var(--hk-short-h);gap:12px;padding:0}',
          '  .big.al{font-size:30px;min-height:34px}.big.al hk-icon{--mdc-icon-size:28px;width:28px;height:28px}',
          '  hk-alarm-keypad-card{flex:1 1 0;min-height:0;--hk-kp-key:calc((var(--hk-short-h) - 46px - 30px) / 4)}',
          '}'
        ].join('');
      }
      hkWidthKind() { return 'alarm'; }
      // the modes, in the picker's order, and the state each one sets
      static picks(K, s) {
        var W = { home: ['Home', 'armed_home'], away: ['Away', 'armed_away'], night: ['Night', 'armed_night'],
                  vacation: ['Vacation', 'armed_vacation'], custom_bypass: ['Custom', 'armed_custom_bypass'] };
        return K.modes(s).map(function (m) { return { key: m, label: W[m][0], state: W[m][1], service: 'alarm_arm_' + m }; })
          .concat([{ key: 'off', label: 'Off', state: 'disarmed', service: 'alarm_disarm' }]);
      }
      _render() {
        var s = this._stateObj;
        if (!s) return;
        var K = customElements.get('hk-alarm-keypad-card');
        var codeless = !!(K && K.codeless && K.codeless(s));
        var shape = codeless ? 'tap:' + K.modes(s).join(',') : 'pad';
        if (this._built && this._shape !== shape) { this._built = false; this._card = null; this._vp = null; }
        this._shape = shape;
        if (!this._built && codeless) {
          this._built = true;
          this._root.innerHTML = '<div class="pn tapn"><div class="big"><span></span></div>' +
            '<div class="vs vp" role="radiogroup" aria-label="Mode"></div><div class="vpsp" aria-hidden="true"></div></div>';
          this._big = this._root.querySelector('.big');
          this._bigIcon = null;             // the word alone, as a shade's
          this._bigWord = this._big.querySelector('span');
          var self = this;
          this._vp = this._root.querySelector('.vp');
          AlarmPanel.picks(K, s).forEach(function (p) {
            var b = document.createElement('button');
            b.type = 'button'; b.textContent = p.label; b.setAttribute('role', 'radio');
            b.dataset.state = p.state;
            b.addEventListener('click', function () {
              // the pill moves at once; the panel's answer settles it -- a
              // refusal puts it straight back, and it never outlives its 10 s
              var want = self._want = { state: p.state, until: Date.now() + 10000 };
              self._paintPicks();
              clearTimeout(self._wantT);
              self._wantT = setTimeout(function () { if (self._want === want && self._vp) self._paintPicks(); }, 10050);
              self._svc('alarm_control_panel', p.service, {}).then(function (ok) {
                if (!ok && self._want === want) { self._want = null; if (self._vp) self._paintPicks(); }
              });
            });
            self._vp.appendChild(b);
          });
        }
        // (the keypad side by side on a short screen: built again as the screen turns)
        var short = !!(window.matchMedia && matchMedia(SHORT_MQ).matches);
        if (this._built && !codeless && this._short !== short) this._built = false;
        this._short = short;
        if (!this._shortMq && window.matchMedia) {
          var self0 = this;
          this._shortMq = matchMedia(SHORT_MQ);
          this._listenShort(function () { self0._render(); });
        }
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '<div class="pn"><div class="big al"><hk-icon></hk-icon><span></span></div></div>';
          this._big = this._root.querySelector('.big');
          this._bigIcon = this._big.querySelector('hk-icon');
          this._bigWord = this._big.querySelector('span');
          var card = document.createElement('hk-alarm-keypad-card');
          // glass: false -- the sheet is its own blur (as every panel).
          // status: false -- the sheet leads with the state word already, so
          // its readout stays the code line rather than saying it twice.
          try { card.setConfig(Object.assign({ entity: this._id, glass: false, status: false }, short ? { layout: 'side' } : {})); } catch (e) { /* not ready */ }
          this._root.querySelector('.pn').appendChild(card);
          this._card = card;
        }
        if (this._card) bridge(this._card, this.client);
        var st = s.state;
        (this._bigWord || this._big).textContent = unavailable(s) ? 'Unavailable' : ALARM_WORDS[st] || pretty(st);
        this._big.classList.toggle('trg', st === 'triggered');
        if (this._vp) this._paintPicks();
        if (this._bigIcon && K && K.status) {
          var look = K.status(s);
          if (this._bigIcon.getAttribute('icon') !== look.icon) this._bigIcon.setAttribute('icon', look.icon);
          this._bigIcon.style.color = look.color;
        }
      }
    }

    // the pill on the mode it is in -- or on the one just tapped while the
    // panel gets there (arming, pending), until it answers or 10 s pass
    AlarmPanel.prototype._paintPicks = function () {
      var s = this._stateObj, st = s ? s.state : '';
      var w = this._want;
      if (w && (st === w.state || Date.now() > w.until)) w = this._want = null;
      var on = w ? w.state : st;
      [].forEach.call(this._vp.children, function (b) {
        var yes = b.dataset.state === on;
        b.classList.toggle('on', yes);
        b.setAttribute('aria-checked', yes ? 'true' : 'false');
      });
    };

    // ------------------------------------------------------------ a camera
    // THE CAMERA SHEET: what every camera tap opens -- a tile on the Cameras
    // page, a room page's camera, the strip's stills and live tile -- in
    // place of HA's dialog, which on these dashboards is either a plain
    // dialog or, under a finger, nothing at all. It is a camera pop-up as a
    // sheet: hk-doorbell-card, which runs its own stream WITH sound, at the
    // camera's own shape, with hold-to-talk where the camera has a speaker.
    // A stream channel is chosen up: a strip shows the LOW resolution
    // channel, the sheet the HIGH one of the same device when there is one.
    function cameraStream(h, id) {
      var ents = (h && h.entities) || {}, e = ents[id], dev = e && e.device_id;
      if (!dev) return id;
      var hi = Object.keys(ents).filter(function (k) {
        return k.indexOf('camera.') === 0 && ents[k].device_id === dev && /high/.test(k) &&
               h.states[k] && h.states[k].state !== 'unavailable';
      }).sort()[0];
      return hi || id;
    }
    function cameraSpeaker(h, id) {
      var ents = (h && h.entities) || {}, e = ents[id], dev = e && e.device_id;
      if (!dev) return null;
      return Object.keys(ents).filter(function (k) {
        return k.indexOf('media_player.') === 0 && ents[k].device_id === dev && /speaker/.test(k);
      }).sort()[0] || null;
    }
    function cameraName(h, id) {
      var ents = (h && h.entities) || {}, devs = (h && h.devices) || {}, e = ents[id] || {};
      var dv = e.device_id && devs[e.device_id];
      var n = (dv && (dv.name_by_user || dv.name)) || at(stOf(h, id), 'friendly_name') || id;
      return String(n).replace(/\s+(low|medium|high)\s+resolution\s+channel$/i, '')
                      .replace(/\s+camera$/i, '') || n;
    }
    class CameraPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // the pop-ups' corners, reaching the picture through the card
          ':host{display:block;border-radius:30px}',
          // never taller than the screen less 16 a side: the sheet is the
          // picture and nothing else
          ':host{--hk-db-max:calc(var(--hk-vh, 100dvh) - 32px)}',
          '.cam{border-radius:inherit}',
          '.na{aspect-ratio:16/9;border-radius:inherit;background:rgba(255,255,255,0.06);display:flex;flex-direction:column;',
          '  align-items:center;justify-content:center;gap:14px;color:rgba(235,235,245,0.62);font-size:17px;font-weight:600}'
        ].join('');
      }
      hkWidthKind() { return 'camera'; }
      hkAutoHeight() { return true; }
      hkBare() { return true; }
      hkTitle(h) { return cameraName(h, this._id); }
      // AN UNAVAILABLE CAMERA IS SAID, NOT BLACK: the stream card over a camera
      // that is gone would draw an empty black sheet. The signature follows
      // only that, so the card is built the moment the camera comes back.
      _streamOf(h) {
        var pc = (this._config && this._config.src && this._config.src.popup) || {};
        return pc.stream || cameraStream(h, this._id);
      }
      _gone(h) { var st = h && h.states[this._streamOf(h)]; return !st || st.state === 'unavailable'; }
      _sigOf() { var c = this.client; return c ? 'camera|' + this._gone(c) : null; }
      // ...while the stream card inside hears every new client (its poster's
      // signed picture, its own state), not only the ones that rebuild this
      _receiveClient() {
        if (this._card && this._card.hkSetClient) this._card.hkSetClient(this.client);
        super._receiveClient();
      }
      // THE SHEET TAKES THE CAMERA'S SHAPE: the pop-ups' sizes, a picture
      // about 750 tall at most 1200 wide -- the doorbell (4:3) 1000 x 750, a
      // 16:9 camera 1200 x 675. A camera with a speaker is the doorbell, so
      // it starts at 4:3; the still, once loaded, has the last word.
      _shape(ar) {
        var sh = this.hkSheet && this.hkSheet.sheet;
        if (!sh || !(ar > 0)) return;
        sh.style.setProperty('--hkd-ar', String(ar));
        sh.style.setProperty('--hkd-w', Math.min(1200, Math.round(750 * ar)) + 'px');
      }
      _render() {
        var h = this.client;
        if (!h) return;
        // _naEl, not _na: Panel._na(s) is the shared unavailable helper, and a
        // property of that name would replace it (see HkBase method shadowing)
        if (this._gone(h)) {
          // THE CAMERA WENT AWAY WHILE ITS SHEET WAS OPEN: its stream card goes
          // too (its detach stops the stream and its retries), or the dead video
          // and the message stacked, and the sheet grew by a picture. It is
          // built again when the camera comes back.
          if (this._card) {
            if (this._card.parentNode) this._card.parentNode.removeChild(this._card);
            this._card = null;
          }
          if (!this._naEl) {
            this._shape(16 / 9);
            this._naEl = document.createElement('div');
            this._naEl.className = 'na';
            this._naEl.innerHTML = glyph('hk:camera', 56) + '<div>' + esc(cameraName(h, this._id)) + ' is unavailable</div>';
            this._root.appendChild(this._naEl);
          }
          return;
        }
        if (this._naEl) { if (this._naEl.parentNode) this._naEl.parentNode.removeChild(this._naEl); this._naEl = null; }
        if (!this._card) {
          // a pop-up's own (Pop-ups: talk-back speaker, full-resolution
          // picture), else what the camera's device has
          var pc = (this._config && this._config.src && this._config.src.popup) || {};
          var stream = pc.stream || cameraStream(h, this._id);
          var sp = pc.speaker || cameraSpeaker(h, this._id);
          var cfg = { type: 'custom:hk-doorbell-card', entity: stream, volume: true,
                      aspect_ratio: 'auto', glass: false };
          // as the camera pop-ups: a camera is captioned with its name, the
          // doorbell (the camera that talks) is not
          if (sp) cfg.speaker = sp; else cfg.name = cameraName(h, this._id);
          this._shape(sp ? 4 / 3 : 16 / 9);
          var self = this, st = h.states[stream];
          var pic = st && st.attributes && !C.stale(st) && st.attributes.entity_picture;
          if (pic) {
            var probe = new Image();
            probe.onload = function () {
              if (probe.naturalWidth && probe.naturalHeight) self._shape(probe.naturalWidth / probe.naturalHeight);
            };
            // ONLY THE SHAPE IS WANTED: a small still keeps the camera's
            // aspect (HA scales to cover, both dimensions or none -- see
            // hk-cameras.js), where the bare URL would fetch the high channel's
            // full 3840x2160 frame, ~1.8 MB, on every camera sheet.
            probe.src = pic + (pic.indexOf('?') < 0 ? '?' : '&') + 'width=320&height=180';
          }
          this._card = C.create(cfg);
          if (this._card) {
            this._card.classList.add('cam');
            this._card.style.borderRadius = 'inherit';
            this._card.style.display = 'block';
            this._root.appendChild(this._card);
          }
        }
        // the stream card gets what goes with this client (the host adapter decides)
        if (this._card && this._card.hkSetClient) this._card.hkSetClient(h);
      }
    }

    // what the shell and the later sheet files use of this one
    K.AlarmPanel = AlarmPanel; K.CameraPanel = CameraPanel;
  };
})();
