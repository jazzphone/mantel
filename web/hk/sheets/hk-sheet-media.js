// hk-sheet-media.js - The media player sheet.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-media'] = function (K) {
    var at = K.at, BACK = K.BACK, C = K.C, CHEV = K.CHEV, clamp = K.clamp, esc = K.esc, glyph = K.glyph,
        hasView = K.hasView, navigateFrom = K.navigateFrom, num = K.num, Panel = K.Panel,
        PANEL_CSS = K.PANEL_CSS, roomOf = K.roomOf, SHORT_MQ = K.SHORT_MQ, throttle = K.throttle,
        TICK = K.TICK, unavailable = K.unavailable;

    // ------------------------------------------------------------ media
    // THE PLAY MUSIC PAGE'S PLAYER: framed artwork, title, artist and album,
    // the "playing on" line, the progress bar, plain transport icons, and the
    // thin volume slider in the playlist accent. A speaker adds Browse Music;
    // a TV adds an Input list (same pattern as a light's effects) and a power
    // button.
    var ACCENT = '#b25bd9';
    var MF = { PAUSE: 1, VOLUME_SET: 4, PREV: 16, NEXT: 32, VOLUME_STEP: 1024, PLAY: 16384 };
    function isTv(s) {
      var a = s.attributes || {}, oid = String(s.entity_id).split('.')[1] || '';
      if (a.device_class === 'tv') return true;
      if (a.device_class === 'speaker' || a.mass_player_type) return false;
      return /(^|_)(tv|apple_tv|roku|webos)(_|$)/.test(oid) || (Array.isArray(a.source_list) && a.source_list.length > 0 && /tv/.test(oid));
    }
    function clock(sec) {
      sec = Math.max(0, Math.floor(sec || 0));
      var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
      return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
    }
    // The view to Browse Music on: the setting, if this dashboard has it.
    function browseView() {
      var v = C.setting ? C.setting('look.browse_view', 'music-browse') : 'music-browse';
      if (!v) return null;
      // cannot tell (null): offer it
      return hasView(v) === false ? null : v;
    }
    class MediaPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // INSET AND TIGHT: the player's text and controls sit 20 px
          // in from the sheet's padding, 12 apart; the TV's picture comes in
          // with them, the speaker's cover is centred anyway
          '.pl{align-self:stretch;display:flex;flex-direction:column;gap:12px;margin:0 20px}',
          '.art{align-self:center;box-sizing:border-box;border-radius:16px;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.24);',
          '  background:linear-gradient(135deg,#3a3a40,#6e6e76);display:flex;align-items:center;justify-content:center;',
          // 260, not 280: with the title, times and Browse Music the player
          // measures 581 px against the 568 a 680 sheet has
          '  color:rgba(255,255,255,0.7);width:260px;height:260px;flex-shrink:0}',
          // .ab: one box per picture (see _paint), so a stale one's fallback
          // can only ever reach its own box
          '.art .ab{width:100%;height:100%;display:flex;align-items:center;justify-content:center}',
          '.art img{width:100%;height:100%;object-fit:cover;display:block}',
          '.art.tv{width:100%;height:auto;aspect-ratio:16/9}',
          '.ti{font-size:22px;font-weight:700;letter-spacing:-0.35px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.ar{font-size:15px;color:' + window.hkCards.v('ink-2') + ';margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.on{font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:' + window.hkCards.v('ink-3') + '}',
          '.pg{height:4px;border-radius:2px;background:rgba(255,255,255,0.22);overflow:hidden}',
          '.pg i{display:block;height:100%;width:0;background:#fff;border-radius:2px}',
          '.tm{display:flex;justify-content:space-between;font-size:12px;color:' + window.hkCards.v('ink-2') + ';',
          '  margin-top:6px;font-variant-numeric:tabular-nums}',
          '.tp{display:flex;justify-content:center;align-items:center;gap:44px}',
          '.tp button{width:52px;height:52px;border:0;border-radius:26px;background:transparent;color:#fff;',
          '  display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}',
          '.tp button:active{background:rgba(255,255,255,0.12)}',
          '.tp button[disabled]{opacity:.3;cursor:default}',
          '.tp .pp{width:60px;height:60px;border-radius:30px}',
          '.vol{position:relative;height:28px;touch-action:none;cursor:pointer;margin:0 2px}',
          '.vol .t{position:absolute;left:0;right:0;top:11px;height:6px;border-radius:3px;background:rgba(255,255,255,0.28)}',
          '.vol .f{position:absolute;left:0;top:11px;height:6px;border-radius:3px;background:' + ACCENT + '}',
          '.vol .k{position:absolute;top:0;width:28px;height:28px;margin-left:-14px;border-radius:14px;background:#fff;',
          '  box-shadow:0 1px 6px rgba(0,0,0,0.3)}',
          // a player that steps its volume but never reports a level (an Apple TV
          // driving the receiver): a slider could only guess, so down and up
          '.vst{display:flex;align-items:center;justify-content:center;gap:28px;height:44px}',
          // THE VOLUME ROW SITS HALFWAY between the transport and the row under
          // it, with equal space above and below. What is seen above it is the
          // pause glyph's ink, which ends 15 px of empty button plus the glyph's
          // own padding above the row's edge, so plain 12 px gaps read as 31
          // above and 12 below. Up 8, 11 more below: 23 and 23, measured, for the
          // slider and the +/- buttons; the play button's hit area still clears
          // it by 4 px, and the tablet speaker sheet (Browse Music) keeps its
          // 566 px body.
          '.vst{margin:-8px 0 11px}',
          '.vol{margin:-8px 2px 11px}',
          '.vst button{width:44px;height:44px;border-radius:22px;border:0;padding:0;display:flex;align-items:center;',
          '  justify-content:center;background:rgba(255,255,255,0.13);color:#fff;cursor:pointer}',
          '.vst button:active{background:rgba(255,255,255,0.24)}',
          '.vst span{font-size:15px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';min-width:64px;text-align:center}',
          '.acts{display:flex;gap:12px}',
          '.acts .btn{flex:1}',
          '.acts .pw{flex:0 0 52px;padding:0}',
          '.acts .pw.lit{background:rgba(255,255,255,0.95);color:rgba(0,0,0,0.85)}',
          '.sub{align-self:stretch;display:flex;flex-direction:column;gap:16px}',
          '.bk{display:flex;align-items:center;gap:10px}',
          '.bk button{width:40px;height:40px;border-radius:20px;border:0;padding:0;display:flex;',
          '  align-items:center;justify-content:center;background:rgba(255,255,255,0.13);color:#fff;cursor:pointer}',
          '.bk .t{font-size:20px;font-weight:700;letter-spacing:-.3px}',
          '.lf{flex:0 0 auto}',
          '.list{border-radius:18px;background:rgba(255,255,255,0.06);max-height:420px;overflow-y:auto;',
          '  overscroll-behavior:contain;scrollbar-width:none}',
          '.list::-webkit-scrollbar{display:none}',
          '.list button{display:flex;align-items:center;justify-content:space-between;width:100%;',
          '  min-height:52px;padding:0 18px;border:0;border-bottom:1px solid rgba(255,255,255,0.07);',
          '  background:transparent;color:' + window.hkCards.v('ink') + ';font:inherit;font-size:17px;text-align:left;cursor:pointer}',
          '.list button:last-child{border-bottom:0}',
          '@media (max-width:' + C.BP.phone + 'px){',
          '  .pl{margin:0 8px}',
          '  .art{width:250px;height:250px}.art.tv{width:100%;height:auto}',
          '  .tp{gap:30px}.list{max-height:340px}',
          '}',
          // (a small phone: the cover a step down, so the track, the transport and the volume fit under it)
          '@media (max-width:' + C.BP.phone + 'px) and (max-height:700px){.art{width:210px;height:210px}}',
          '@media (max-width:' + C.BP.phone + 'px),' + SHORT_MQ + '{.ti{font-size:20px}}',
          // A SHORT SCREEN: the cover on the left, as tall as the body, the
          // track and everything that plays it in a column beside it, left
          // aligned on the title as a Now Playing screen is; the transport a
          // little tighter, so the column is the cover's height
          '@media ' + SHORT_MQ + '{',
          // (the player is the panel's one piece: across both of PANEL_CSS's columns)
          '  :host .pn > .pl{grid-column:1 / -1;grid-row:1 / 8;justify-self:stretch;margin-block:0}',
          // (centred on the cover as the other sheets' columns are on their
          // controls: a flexible row above the track and one below it)
          '  :host .pl{display:grid;grid-template-columns:var(--hk-short-h) minmax(0,1fr);grid-template-rows:minmax(0,1fr) repeat(7,auto) minmax(0,1fr);',
          '    column-gap:24px;row-gap:6px;margin:0;height:var(--hk-short-h)}',
          '  :host .pl::before,:host .pl::after{content:"";grid-column:2}',
          '  :host .pl::before{grid-row:1}:host .pl::after{grid-row:9}',
          '  :host .pl > *{grid-column:2;min-width:0}',
          '  :host .pl > .art{grid-column:1;grid-row:1 / 10;width:var(--hk-short-h);height:var(--hk-short-h);align-self:center}',
          '  :host .pl > .art.tv{height:auto;aspect-ratio:16/9}',
          '  :host .pl .tp{gap:28px}.tp button{width:48px;height:48px}.tp .pp{width:56px;height:56px}',
          '  :host .pl .vol,:host .pl .vst{margin:-6px 2px 0}',
          '}'
        ].join('');
      }
      hkWidthKind(h, s) { return isTv(s) ? 'media_tv' : 'media'; }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        if (!this._built) this._build(s);
        if (this._view === 'inputs') return this._paintInputs(s);
        this._paint(s);
      }
      _build(s) {
        this._built = true;
        this._view = this._view || 'main';
        var self = this;
        this._tv = isTv(s);
        if (this._view === 'inputs') {
          this._root.innerHTML = '<div class="pn"><div class="sub"><div class="bk"><button aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + BACK + '"/></svg></button><div class="t">Input</div></div><div class="hk-edge lf"><div class="list"></div></div></div></div>';
          this._root.querySelector('.bk button').addEventListener('click', function () { self._go('main'); });
          this._list = this._root.querySelector('.list');
          C.edges(this._root);
          this._inSig = null;
          return;
        }
        this._root.innerHTML = '<div class="pn"><div class="pl">' +
          '<div class="art' + (this._tv ? ' tv' : '') + '"></div>' +
          '<div><div class="ti"></div><div class="ar"></div></div>' +
          '<div class="on"></div>' +
          '<div><div class="pg"><i></i></div><div class="tm"><span class="el"></span><span class="du"></span></div></div>' +
          '<div class="tp"><button class="pv" aria-label="Previous">' + glyph('mdi:skip-previous', 30) + '</button>' +
          '<button class="pp" aria-label="Play or pause"></button>' +
          '<button class="nx" aria-label="Next">' + glyph('mdi:skip-next', 30) + '</button></div>' +
          '<div class="vol" role="slider" aria-label="Volume" tabindex="0"><div class="t"></div><div class="f"></div><div class="k"></div></div>' +
          '<div class="vst" hidden><button class="vd" aria-label="Volume down">' + glyph('mdi:volume-minus', 22) + '</button>' +
          '<span>Volume</span><button class="vu" aria-label="Volume up">' + glyph('mdi:volume-plus', 22) + '</button></div>' +
          '<div class="acts"></div></div></div>';
        var q = function (c) { return self._root.querySelector(c); };
        this._e = { art: q('.art'), ti: q('.ti'), ar: q('.ar'), on: q('.on'), pg: q('.pg i'), el: q('.el'), du: q('.du'),
                    pv: q('.pv'), pp: q('.pp'), nx: q('.nx'), vol: q('.vol'), vst: q('.vst'), acts: q('.acts') };
        q('.vd').addEventListener('click', function () { self._svc('media_player', 'volume_down'); });
        q('.vu').addEventListener('click', function () { self._svc('media_player', 'volume_up'); });
        this._e.pv.addEventListener('click', function () { self._svc('media_player', 'media_previous_track'); });
        this._e.nx.addEventListener('click', function () { self._svc('media_player', 'media_next_track'); });
        this._e.pp.addEventListener('click', function () { self._svc('media_player', 'media_play_pause'); });
        // volume: drag or tap along the track
        var vol = this._e.vol, sendV = throttle(function (v) { self._svc('media_player', 'volume_set', { volume_level: v }); }, 250);
        var pick = function (e) {
          var r = vol.getBoundingClientRect();
          var v = clamp((e.clientX - r.left) / r.width, 0, 1);
          v = Math.round(v * 100) / 100;
          self._showVol(v);
          sendV(v);
        };
        var down = false;
        vol.addEventListener('pointerdown', function (e) { e.preventDefault(); down = true; self._volDrag = true; try { vol.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } pick(e); });
        vol.addEventListener('pointermove', function (e) { if (down) pick(e); });
        var up = function (e) { if (down) { down = false; pick(e); setTimeout(function () { self._volDrag = false; }, 800); } };
        vol.addEventListener('pointerup', up);
        vol.addEventListener('pointercancel', function () { down = false; self._volDrag = false; });
        vol.addEventListener('keydown', function (e) {
          var cur = num(at(self._stateObj, 'volume_level')) || 0, v = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = clamp(cur + 0.05, 0, 1);
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = clamp(cur - 0.05, 0, 1);
          if (v == null) return;
          e.preventDefault(); self._showVol(v); sendV(v);
        });
        // actions: Browse Music (a speaker) or Input + power (a TV)
        var acts = this._e.acts;
        if (this._tv) {
          if (Array.isArray(at(s, 'source_list')) && at(s, 'source_list').length) {
            var inp = document.createElement('button');
            inp.className = 'btn menu';
            inp.innerHTML = '<span>Input</span><span class="cur"></span>';
            inp.addEventListener('click', function () { self._go('inputs'); });
            acts.appendChild(inp);
            this._e.inp = inp;
          }
          var pw = document.createElement('button');
          pw.className = 'btn pw';
          pw.setAttribute('aria-label', 'Power');
          pw.innerHTML = glyph('mdi:power', 22);
          pw.addEventListener('click', function () {
            var st = self._stateObj;
            self._svc('media_player', st && st.state !== 'off' && st.state !== 'standby' ? 'turn_off' : 'turn_on');
          });
          acts.appendChild(pw);
          this._e.pw = pw;
        } else {
          // BROWSE ONLY FOR A SPEAKER THE MUSIC FEATURE PLAYS TO. Browse plays to
          // the focused speaker, and focus refuses one it does not know (a speaker
          // outside Music Assistant): the button would then browse for another room.
          var bv = browseView(), M2 = window.hkMusic;
          if (bv && M2 && M2.known && M2.known(this._id)) {
            var br = document.createElement('button');
            br.className = 'btn';
            br.textContent = 'Browse Music';
            br.addEventListener('click', function () {
              // Browse plays to the focused speaker: make it this one first.
              if (window.hkMusic && window.hkMusic.setFocus) window.hkMusic.setFocus(self._id);
              var seg = String(location.pathname).split('/')[1];
              navigateFrom('/' + seg + '/' + bv);
            });
            acts.appendChild(br);
          }
        }
        if (!acts.children.length) acts.hidden = true;
      }
      _go(view) { this._view = view; this._built = false; this._render(); }
      _showVol(v) {
        this._e.vol.querySelector('.f').style.width = (v * 100) + '%';
        this._e.vol.querySelector('.k').style.left = 'calc(14px + ' + (v * 100) + '% - ' + (v * 28) + 'px)';
        this._e.vol.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      }
      _paint(s) {
        var a = s.attributes || {}, e = this._e, self = this;
        var f = num(a.supported_features) || 0;
        var na = this._na(s);
        var off = s.state === 'off' || s.state === 'standby' || unavailable(s);
        var title = na ? 'Unavailable' :
          a.media_title || (off ? 'Off' : s.state === 'idle' ? 'Not playing' : (a.app_name || a.source || ''));
        var line = [a.media_artist || a.media_series_title, a.media_album_name].filter(Boolean).join(' · ') ||
                   (this._tv ? (a.app_name || a.source || '') : '');
        e.ti.textContent = title;
        e.ar.textContent = line;
        // WHERE it plays: the speaker's room (the pill's own name can be a
        // shortcut like "Apple Music"), else its own name.
        var where = roomOf(this.client, this._id) || a.friendly_name || '';
        e.on.textContent = (s.state === 'playing' ? 'Playing on · ' : s.state === 'paused' ? 'Paused on · ' : off ? '' : 'Ready on · ') + (off ? '' : where);
        // artwork: entity_picture_local FIRST, as the now-playing bar and Play
        // Music do (hk-media). Music Assistant's entity_picture is
        // http://<music-assistant-host>:8095/imageproxy/..., which an https page
        // must not load and which reaches the art proxy only for an https reverse
        // proxy to refuse (no cover in Safari, or on a tablet over https, while
        // Chrome over http is fine). _local is HA's own media_player_proxy on
        // this origin. Any other host still goes through the art proxy.
        // '' not undefined: an idle speaker has no picture on the FIRST paint too
        var pic = a.entity_picture_local || a.entity_picture || '';
        // A NEW BOX PER PICTURE, swapped in. _artImage appends to the box it
        // is handed and its placeholder fallback rewrites that whole box, so
        // one shared box would stack a second cover beside the first on a track
        // change -- and the old cover's 6 s timeout, firing later, would wipe
        // the new one. The old image's request is stopped as it goes.
        if (pic !== this._pic) {
          this._pic = pic;
          var icon = glyph(this._tv ? 'hk:television' : 'hk:homepod', this._tv ? 56 : 72);
          var box = document.createElement('div');
          box.className = 'ab';
          if (this._artImg) { try { this._artImg.src = ''; } catch (x) { /* going anyway */ } }
          this._artImg = pic && this._artImage ? this._artImage(pic, box, icon, 600) : null;
          if (!this._artImg) box.innerHTML = icon;
          e.art.innerHTML = '';
          e.art.appendChild(box);
        }
        e.pp.innerHTML = glyph(s.state === 'playing' ? 'mdi:pause' : 'mdi:play', 38);
        e.pp.disabled = off || !(f & (MF.PAUSE | MF.PLAY));
        e.pv.disabled = off || !(f & MF.PREV);
        e.nx.disabled = off || !(f & MF.NEXT);
        var level = a.volume_level != null, step = !level && !!(f & MF.VOLUME_STEP);
        // OFF: no volume row at all. Hidden (visibility) it would keep its 28-44
        // px, and Prev / Play / Next would sit 27 px under the progress bar but
        // 83 over Input. Removed, the transport is centred.
        e.vol.hidden = step || off;
        e.vst.hidden = !step || off;
        e.vst.style.visibility = '';
        e.vol.style.visibility = (f & MF.VOLUME_SET) && level ? '' : 'hidden';
        if (!this._volDrag) this._showVol(num(a.volume_level) || 0);
        // an Apple TV's "input" is the app it is in
        if (e.inp) e.inp.querySelector('.cur').innerHTML = esc(a.source || a.app_name || '') + CHEV;
        if (e.pw) e.pw.classList.toggle('lit', !off);
        this._tick();
        clearInterval(this._tickT);
        this._tickT = s.state === 'playing' ? setInterval(function () { self._tick(); }, 1000) : null;
      }
      _tick() {
        var s = this._stateObj, e = this._e;
        if (!s || !e) return;
        var a = s.attributes || {};
        var dur = num(a.media_duration), pos = num(a.media_position);
        if (!dur || pos == null) { e.pg.style.width = '0'; e.el.textContent = ''; e.du.textContent = ''; return; }
        if (s.state === 'playing' && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
        pos = clamp(pos, 0, dur);
        e.pg.style.width = (pos / dur * 100) + '%';
        e.el.textContent = clock(pos);
        e.du.textContent = clock(dur);
      }
      _paintInputs(s) {
        var self = this, cur = at(s, 'source'), list = at(s, 'source_list') || [];
        cur = cur || at(s, 'app_name');
        var sig = cur + '|' + list.length;
        if (sig === this._inSig) return;
        this._inSig = sig;
        var tick = TICK;
        this._list.innerHTML = list.map(function (x) {
          return '<button data-s="' + esc(x) + '"><span>' + esc(x) + '</span>' + (x === cur ? tick : '') + '</button>';
        }).join('');
        this._list.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () {
            self._svc('media_player', 'select_source', { source: b.getAttribute('data-s') });
            self._go('main');
          });
        });
      }
    }

    // what the shell and the later sheet files use of this one
    K.MediaPanel = MediaPanel;
  };
})();
