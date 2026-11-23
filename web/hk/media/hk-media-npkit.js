// hk-media-npkit.js - the Now Playing block drawn from the kit (round 12): the screensaver's music slide in the kit's parts.
//
// PART OF THE MUSIC AND MEDIA CARDS (hk-media.js). Not a card and not run on its own: it registers one
// function, which hk-media.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkMediaParts = window.hkMediaParts || {})['hk-media-npkit'] = function (K) {
    var HkNowPlayingCard = /** @type {any} */ (K.HkNowPlayingCard);

    // THE BLOCK (the owner's round 12, 2026-11-23; docs/phase34/PLAN.md; hk-kit.js): the plate is the cover's own dark surface -- a deep
    // tint of the cover's color under white words -- as the screensaver's music slide is, in the kit's measures: words on the 18
    // inset, shapes on the 13 edge with the concentric corner, keys 64 tall 8 apart, the four type styles.
    //   S   the cover (80) centered, the song and the artist centered under it; no volume
    //   W   the cover (128) at the edge with the room it plays in centered UNDER it; the song and artist beside it, the volume's row
    //       (50 tall, its whole row the touch), and the keys: Play / Pause and Next ("remove the back/rewind button and just have
    //       the next/skip")
    //   T   the cover (150) on the block's axis, the song and artist, the progress, the volume, Play / Pause and Next
    //   L   the cover (156), the room as a capsule on its top edge and the song, artist and album on its bottom edge -- the capsule's
    //       left edge exactly on the words' ("The pill is closer to the album art, and it should align with the text") -- then the
    //       progress 24 under the cover ("The Album art is pretty close to the time/progress bar"), the volume and Previous / Play / Next
    //   XL  Large's layout in the left 405 and Up Next (the next four covers, each plays) and a Queue key on the right
    // The volume is on every size but Small, bare: its track exactly as wide as the progress bar's (the 18 inset), a white knob, its
    // whole row the touch ("The volume slider doesn't match the width of the progress bar!"). A tile cell (150 high) drops what does
    // not fit as a full target -- the volume first, then the cover shrinks -- and the Speakers tab has every room's volume.
    // The cover opens the sheet (hk-media-npsheet.js): Browse, Queue, Speakers. A tap elsewhere on the plate does what it always did.
    var VOL_EVERY = 200;          // a volume drag sends at most this often (ms), as the music panel's
    var VOL_HOLD = 4000;          // ...and its level stands this long after, until the speaker says it
    var UP_R = 14;                // Up Next's smaller covers' corner (the mockup's)
    var COVER_ASK = 160;          // Up Next's covers asked for at what they show (Apple's 1000 px ones, a thumbnail's size)
    var TONES = /** @type {any} */ ({}), TONE_KEYS = /** @type {string[]} */ ([]);    // a cover's tone by its address, once read (false: it cannot be)

    /** @param {any} s */
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c; }); }
    /** @param {number} t */
    function clock(t) {
      var n = Math.max(0, Math.round(t)), h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
      return (h ? h + ':' : '') + (h && m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    /** @param {string} u */
    function small(u) { return String(u).replace(/\/(\d+)x(\d+)(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/, '/' + COVER_ASK + 'x' + COVER_ASK + '$3.$4'); }
    function KT() { return /** @type {any} */ (window.hkKit); }
    // the transport's glyphs are the strip's (hk-np-strip.js): one set in every player
    /** @param {string} name @param {number} px */
    function tg(name, px) {
      var S = /** @type {any} */ (window.hkNpStrip), d = S && S.ICON ? S.ICON[name] : '';
      return '<span class="g" style="width:' + px + 'px;height:' + px + 'px"><svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="currentColor" aria-hidden="true"><path d="' + d +
        '"/></svg></span>';
    }
    /** @param {number} px */
    function note(px) { return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="currentColor" aria-hidden="true"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>'; }
    // a cover's corner: the block's less the inset; a smaller picture a proportional one
    /** @param {any} k @param {number} s */
    function corner(k, s) { return Math.min(k.r, Math.round(s * 0.27)); }
    // whether a bar may move by itself: Motion (Appearance), the Background's Animations, and the system's reduced motion
    function motionOk() {
      var S = /** @type {any} */ (window.hkSettings), r = null, sk = null;
      try { r = S && S.rendering ? S.rendering() : null; sk = S && S.skyLook ? S.skyLook() : null; } catch (e) { r = null; sk = null; }
      var reduce = false;
      try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { reduce = false; }
      return !(r && r.motion === false) && !(sk && sk.animations === false) && !reduce;
    }

    // ------------------------------------------------------------ the cover's tone
    // THE PLATE'S COLOR, a deep tint of the cover's (the owner's mockup: the teal of a blue cover): the cover's mean color, kept
    // dark enough for white words -- its hue, its saturation held between a little and a good deal, three lightnesses top to foot
    /** @param {number} r @param {number} g @param {number} b */
    function toneOf(r, g, b) {
      var mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, dl = mx - mn;
      var s = dl === 0 ? 0 : dl / (1 - Math.abs(2 * l - 1)), h = 0, R = r / 255, G = g / 255, B = b / 255;
      if (dl > 0) {
        if (mx === R) h = ((G - B) / dl) % 6; else if (mx === G) h = (B - R) / dl + 2; else h = (R - G) / dl + 4;
        h *= 60; if (h < 0) h += 360;
      }
      // (a gray cover: a graphite, not the red a gray's hue would say)
      if (s < 0.08) { h = 220; s = 0.06; } else s = Math.max(0.16, Math.min(0.55, s * 0.85));
      var H = Math.round(h), S = Math.round(s * 100);
      return { a: 'hsl(' + H + ',' + S + '%,38%)', b: 'hsl(' + H + ',' + S + '%,22%)', c: 'hsl(' + H + ',' + Math.round(S * 0.9) + '%,11%)' };
    }
    /** @param {any} plate @param {any} t */
    function applyTone(plate, t) {
      if (!plate || !plate.style) return;
      if (t) { plate.style.setProperty('--np-a', t.a); plate.style.setProperty('--np-b', t.b); plate.style.setProperty('--np-c', t.c); }
    }
    // the cover read once, from the picture already on the plate (a picture from another origin cannot be read: its plate stays graphite)
    /** @param {string} url @param {any} img @param {(t: any) => void} then */
    function readTone(url, img, then) {
      if (url in TONES) { if (TONES[url]) then(TONES[url]); return; }
      var go = function () {
        if (url in TONES) { if (TONES[url]) then(TONES[url]); return; }
        var t = null;
        try {
          var c = document.createElement('canvas'); c.width = 10; c.height = 10;
          var x = c.getContext && c.getContext('2d'), nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height, side = Math.min(nw, nh);
          if (x && side > 0) {
            x.drawImage(img, (nw - side) / 2, (nh - side) / 2, side, side, 0, 0, 10, 10);
            var d = x.getImageData(0, 0, 10, 10).data, sum = [0, 0, 0];
            for (var i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
            t = toneOf(sum[0] / 100, sum[1] / 100, sum[2] / 100);
          }
        } catch (e) { t = null; }
        TONES[url] = t || false;
        TONE_KEYS.push(url);
        if (TONE_KEYS.length > 60) delete TONES[/** @type {string} */ (TONE_KEYS.shift())];
        if (t) then(t);
      };
      if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go, { once: true });
    }

    // ------------------------------------------------------------ the styles (the kit's, and this plate's)
    var CSS = [
      // the cover's own dark surface: a graphite until the cover's tone is read (--np-a/-b/-c on the plate), no blur of its own, white words
      '.kit.mu{background:linear-gradient(165deg,var(--np-a,#3a3d44) 0%,var(--np-b,#25282d) 48%,var(--np-c,#15171a) 100%) !important;',
      '  backdrop-filter:none !important;-webkit-backdrop-filter:none !important;color:#fff;text-shadow:none;--hk-glow:none;',
      '  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 10px 28px rgba(0,0,0,.18) !important;',
      '  --hk-ink:#fff;--hk-ink-2:rgba(255,255,255,.72);--hk-ink-3:rgba(255,255,255,.46);--hk-key:rgba(255,255,255,.14);--hk-key-strong:rgba(255,255,255,.24);',
      '  --hk-line:rgba(255,255,255,.14);--hk-line-strong:rgba(255,255,255,.24)}',
      // BLURRED ALBUM (the block's Background, the default -- the owner: "Can you fix it so it works? Blurred Album or Card?"): the cover full-
      // bleed behind everything, blurred and dimmed, as the older drawing had it, on a layer of its own so nothing over it blurs it again (that
      // drawing's 2026-11-05 finding); the cover's tone stays the ground under it while it loads. Card: the look's own plate (no .mu).
      '.kit .npbg{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit}',
      '.kit .npbg img{position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);object-fit:cover;filter:blur(34px);transform:scale(1.06);',
      '  opacity:.62;will-change:transform}',
      '.kit .npbg i{position:absolute;inset:0;background:linear-gradient(160deg,rgba(8,9,12,.62) 0%,rgba(8,9,12,.42) 50%,rgba(8,9,12,.7) 100%)}',
      // FLAT DRAWS NO BLUR (flatCss takes every filter): the cover sharp and very dim on near black, as the older drawing had it (2026-11-10,
      // the owner: "a very dim album art... since we don't blur anything in flat"; again 2026-11-23: "Flat is just suppose to really dim the art")
      ':host([hk-flat]) .kit .npbg{background:#0b0c0f}',
      ':host([hk-flat]) .kit .npbg img{inset:0;width:100%;height:100%;transform:none;will-change:auto;opacity:var(--hk-flat-art,.3)}',
      // the cover, a button: its own corner and shadow, the picture to its edge
      '.kit .npc{all:unset;position:absolute;box-sizing:border-box;display:block;overflow:hidden;cursor:pointer;background:var(--hk-key);touch-action:manipulation;',
      '  box-shadow:0 8px 22px rgba(0,0,0,.32),0 0 0 .5px rgba(0,0,0,.14)}',
      '.kit .npc img{width:100%;height:100%;object-fit:cover;display:block}',
      '.kit .npc:active{filter:brightness(.88)}',
      '.kit .npc:focus-visible,.kit .npr:focus-visible,.kit .npv:focus-visible{outline:2px solid var(--hk-ink-2);outline-offset:2px}',
      // the room it plays in: a row under the cover, or the capsule beside it; its whole box is the tap
      '.kit .npr{all:unset;position:absolute;box-sizing:border-box;display:flex;align-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}',
      '.kit .npr .kl{flex:0 1 auto;min-width:0}',
      '.kit .npr.pill{display:inline-flex;gap:6px;padding:0 12px;border-radius:calc(38px / 2);background:var(--hk-key)}',
      '.kit .npr.pill::after{content:"";position:absolute;inset:-4px}',
      '.kit .npr.pill:active{background:var(--hk-key-strong)}',
      '.kit .npr:not(.pill):active{opacity:.7}',
      // the progress: the kit's track, the fill by the countdown the times are (hk-timers.js sets --hk-left, the fraction remaining)
      '.kit .npp{position:absolute}',
      '.kit .npp .trk{left:0;top:0;width:100%}',
      '.kit .npp .trk>i{width:calc((1 - var(--hk-left,1)) * 100%);color:var(--hk-ink,rgba(255,255,255,0.94))}',
      '.kit .npp .kl{position:absolute;top:12px;margin:0}',
      '.kit .npp .r.nm::before{content:none}',
      '.kit .npp .e{left:0}.kit .npp .r{right:0;text-align:right}.kit .npp .r::before{content:"\\2212"}',
      // the volume: bare -- a track the width it is given, a white knob; its whole row is the touch
      '.kit .npv{position:absolute;cursor:pointer;touch-action:pan-y;-webkit-tap-highlight-color:transparent;outline:none}',
      '.kit .npv .t{position:absolute;left:0;right:0;height:6px;border-radius:calc(6px / 2);background:var(--hk-line-strong);overflow:hidden}',
      '.kit .npv .t>i{display:block;height:100%;border-radius:calc(6px / 2);background:var(--hk-ink,rgba(255,255,255,0.94))}',
      '.kit .npv .k{position:absolute;width:26px;height:26px;border-radius:13px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3)}',
      '.kit .npv.off{opacity:.5}',
      // Up Next's covers and an idle block's playlists: pictures that play
      '.kit .nps{display:flex;align-items:flex-end;justify-content:center;padding:8px 6px;text-align:center;white-space:normal;color:#fff;overflow-wrap:anywhere;line-height:18px;text-shadow:none}',
      '.kit .nps span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}'
    ].join('');

    // ------------------------------------------------------------ the pieces (absolute, in the block's px)
    /** @param {any} k @param {number} x @param {number} y @param {number} s @param {any} d @param {string} [what] */
    function cover(k, x, y, s, d, what) {
      var AI = window.hkCards && window.hkCards.artImg, kt = KT();
      var inner = d.cover && AI ? AI(d.cover, { ph: 'note', attrs: 'decoding="sync" draggable="false"' }) :
        '<span class="fc" style="width:100%;height:100%;color:var(--hk-ink-3)">' + note(Math.round(s * 0.4)) + '</span>';
      return '<button type="button" class="npc" data-notap data-np="cover" aria-label="' + esc((what || d.title || 'Now Playing') + '. Opens Browse, Queue and Speakers') + '" style="' +
        kt.st(x, y, s, s) + 'border-radius:' + corner(k, s) + 'px">' + inner + '</button>';
    }
    // where it plays: the room's glyph, its name (the first, and how many more) and a chevron
    /** @param {any} d */
    function roomInner(d) {
      var kt = KT(), names = (d.rooms || []).filter(Boolean), one = names[0] || 'Speakers', rest = names.length > 2 ? ' + ' + (names.length - 1) : names.length > 1 ? ' + ' + names[1] : '';
      var ic = window.hkIcons && window.hkIcons.speaker ? window.hkIcons.speaker(d.roomKey) : 'hk:homepod';
      return kt.glyph(ic || 'hk:homepod', 16, 'var(--hk-ink-2)') + '<span class="kl" style="color:var(--hk-ink)">' + esc(one + rest) + '</span>' + kt.svg('down', 14, 'var(--hk-ink-2)');
    }
    /** @param {any} d */
    function roomLabel(d) { var names = (d.rooms || []).filter(Boolean); return 'Speakers: ' + (names.join(' + ') || 'none'); }
    // under the cover, centered (Wide)
    /** @param {number} x @param {number} y @param {number} w @param {number} room @param {any} d */
    function roomUnder(x, y, w, room, d) {
      // (centered on the cover, as wide as the song's column lets a long name be: a short cover's would clip it)
      var rw = Math.max(w, Math.min(room, 150)), rx = Math.max(2, x + w / 2 - rw / 2);
      return '<button type="button" class="npr" data-notap data-np="room" aria-label="' + esc(roomLabel(d)) + '" style="' + KT().st(rx, y, rw, 40) + 'justify-content:center;gap:5px">' + roomInner(d) +
        '</button>';
    }
    // the capsule on the cover's top edge (Large, Extra Large): its left edge on the words' own
    /** @param {number} x @param {number} y @param {number} maxW @param {any} d */
    function roomPill(x, y, maxW, d) {
      return '<button type="button" class="npr pill" data-notap data-np="room" aria-label="' + esc(roomLabel(d)) + '" style="left:' + x + 'px;top:' + y + 'px;height:38px;max-width:' + maxW + 'px">' +
        roomInner(d) + '</button>';
    }
    // the progress with its times: a track 6 tall, the elapsed under its left end and what is left under its right
    /** @param {number} x @param {number} y @param {number} w @param {any} d */
    function prog(x, y, w, d) {
      var kt = KT(), has = d.song && d.dur > 0, total = Math.round(d.dur), el, rm;
      if (!has) { el = '<span class="kl num e">--:--</span>'; rm = '<span class="kl num r nm">--:--</span>'; }
      else if (d.live) {
        // (counting by itself, from where the track began: the shared countdown's own clock, hk-timers.js, which writes the text the moment
        // it connects -- so what is drawn here is the same for the same track, and a speaker's push that moves only the position draws
        // nothing: the cover is not built again under the eye, as the older drawing's was never)
        el = '<hk-countdown class="kl num e" since="' + d.since + '" total="' + total + '">' + clock(0) + '</hk-countdown>';
        rm = '<hk-countdown class="kl num r" deadline="' + (d.since + total * 1000) + '" total="' + total + '">' + clock(total) + '</hk-countdown>';
      } else {
        // (held: paused, or Motion and Animations off -- it moves when the speaker says so)
        el = '<span class="kl num e">' + clock(d.pos) + '</span>';
        rm = '<hk-countdown class="kl num r" hold="' + Math.max(0, total - Math.round(d.pos)) + '" total="' + total + '">' + clock(total - d.pos) + '</hk-countdown>';
      }
      return '<div class="a npp" data-np="prog" role="progressbar" aria-label="Progress" style="' + kt.st(x, y, w, 32) + '"><div class="trk"><i></i></div>' + el + rm + '</div>';
    }
    // the volume: its whole row (hh tall) the touch, the track in its middle
    /** @param {number} x @param {number} y @param {number} w @param {number} hh @param {any} d */
    function vol(x, y, w, hh, d) {
      var f = d.vol == null ? 0 : Math.max(0, Math.min(1, d.vol)), cy = hh / 2, pct = Math.round(f * 1000) / 10;
      return '<div class="a npv' + (d.vol == null ? ' off' : '') +
        '" role="slider" tabindex="0" data-notap data-hk-control data-np="vol" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
        Math.round(f * 100) + '" style="' + KT().st(x, y, w, hh) + '"><span class="t" style="top:' + (cy - 3) + 'px"><i style="width:' + pct + '%"></i></span><span class="k" style="top:' +
        (cy - 13) + 'px;left:calc(' + pct + '% - 13px)"></span></div>';
    }
    /** @param {any} d */
    function keyPP(d) { return { g: tg(d.playing ? 'pause' : 'play', 30), label: d.playing ? 'Pause' : 'Play', data: { np: 'pp' } }; }
    var KEY_NEXT = { g: '', label: 'Next', data: { np: 'next' } }, KEY_PREV = { g: '', label: 'Previous', data: { np: 'prev' } };
    /** @param {any} d @param {boolean} three */
    function keys(d, three) {
      var out = [Object.assign({}, KEY_NEXT, { g: tg('next', 28) })];
      out.unshift(keyPP(d));
      if (three) out.unshift(Object.assign({}, KEY_PREV, { g: tg('prev', 28) }));
      return out;
    }
    // a picture that plays (Up Next's cover; an idle block's playlist: its name on a gradient of its own)
    /** @param {any} k @param {number} x @param {number} y @param {number} s @param {any} it @param {string} what */
    function pick(k, x, y, s, it, what) {
      var kt = KT(), AI = window.hkCards && window.hkCards.artImg, img = it.image && /^https?:|^\//.test(it.image) ? small(it.image) : '', css = '', inner = '';
      if (img && AI) inner = AI(img, { ph: 'note' });
      else { var t = it.tint || ['rgba(255,255,255,.2)', 'rgba(255,255,255,.08)']; css = 'background:linear-gradient(160deg,' + t[0] + ',' + t[1] + ');';
        inner = '<span class="nps" style="position:absolute;inset:0"><span>' + esc(it.title || it.name || '') + '</span></span>'; }
      return '<button type="button" class="npc" data-notap data-np="' + what + '" data-qid="' + esc(it.id || '') + '" data-pi="' + esc(it.pi == null ? '' : it.pi) + '" aria-label="' +
        esc('Play ' + (it.title || it.name || 'this')) + '" style="' +
        kt.st(x, y, s, s) + css + 'border-radius:' + UP_R + 'px">' + inner + '</button>';
    }

    // ------------------------------------------------------------ the layout: pure in (d, k) -- the tests read it
    // d: { size, song, playing, live, title, artist, album, cover, rooms, roomKey, pos, dur, since, vol, queue, lists }; k: hkKit.ctx
    /** @param {any} d @param {any} k */
    function layout(d, k) {
      var kt = KT(), E = k.E, X = k.X, w = k.w, h = k.h, FY = h - E - kt.KH, o = '', size = d.size, tx = kt.tx, title = esc(d.title), artist = esc(d.artist), album = esc(d.album);
      var centered = 'text-align:center';
      if (size === 'S') {
        var tallS = h >= 180, a = tallS ? 80 : 52, gap = tallS ? 14 : 8, total = a + gap + 46, y0 = Math.round((h - total) / 2) - 2;
        o += cover(k, (w - a) / 2, y0, a, d) + tx(8, y0 + a + gap, w - 16, 'kt', title, centered) + tx(8, y0 + a + gap + 24, w - 16, 'kb', artist, centered);
      } else if (size === 'W') {
        var tallW = h >= 180, a2 = tallW ? 128 : Math.max(72, Math.min(128, h - 2 * E - 33)), x1 = E + a2 + 16, cw = w - x1 - E, ry = E + a2 + 13;
        o += cover(k, E, E, a2, d) + roomUnder(E, ry - 10, a2, x1 - 8, d) + tx(x1 + 4, 18, cw - 4, 'kt', title) + tx(x1 + 4, 42, cw - 4, 'kb', artist);
        if (FY - 66 >= 50) o += vol(x1 + 4, 66, cw - 8, 50, d);
        o += kt.keyRow(x1, FY, cw, keys(d, false));
      } else if (size === 'T') {
        // the volume where the block is tall enough for it as a full row, the cover as large as what is left lets it be
        var withVol = FY - 152 - E >= 100, a3 = Math.min(150, withVol ? FY - 152 - E : FY - 104 - E), cb = E + a3;
        o += cover(k, (w - a3) / 2, E, a3, d) + tx(X, cb + 10, w - 2 * X, 'kt', title, centered) + tx(X, cb + 34, w - 2 * X, 'kb', artist, centered) + prog(X, cb + 64, w - 2 * X, d);
        if (withVol) o += vol(X, cb + 98, w - 2 * X, 46, d);
        o += kt.foot(k, keys(d, false));
      } else {
        // Large, and Extra Large's left 405: from the keys up -- the volume, the progress 24 under the cover
        var lw = size === 'XL' && w >= 520 ? 405 : w, vh = h >= 380 ? 64 : 46, vy = FY - (vh === 64 ? 18 : 6) - vh, py = vy - (vh === 64 ? 21 : 6) - 32, ab = py - 24;
        var a4 = Math.max(72, Math.min(156, ab - E)), x2 = E + a4 + 18, cw2 = lw - x2 - X; ab = E + a4;
        var roomy = ab - 74 >= E + 44;   // (the album line goes where the song would reach the capsule)
        o += cover(k, E, E, a4, d) + roomPill(x2, E, cw2, d) + tx(x2, ab - (roomy ? 74 : 50), cw2, 'kd', title) + tx(x2, ab - (roomy ? 46 : 24), cw2, 'kb', artist);
        if (roomy) o += tx(x2, ab - 24, cw2, 'kb', album, 'color:var(--hk-ink-3)');
        o += prog(X, py, lw - 2 * X, d) + vol(X, vy, lw - 2 * X, vh, d) + kt.keyRow(E, FY, lw - 2 * E, keys(d, true));
        if (size === 'XL' && lw < w) {
          var rx = lw + 5, rw = w - E - rx, aw = Math.min((rw - kt.G) / 2, (FY - kt.G - 46 - kt.G) / 2), list = d.song ? d.queue || [] : d.lists || [];
          o += tx(rx, 18, rw, 'kl', d.song ? 'Up Next' : 'Playlists');
          list.slice(0, 4).forEach(function (/** @type {any} */ it, /** @type {number} */ i) {
            o += pick(k, rx + (i % 2) * (aw + kt.G), 46 + Math.floor(i / 2) * (aw + kt.G), aw, it, d.song ? 'upnext' : 'plist'); });
          if (!list.length) o += tx(rx, 46, rw, 'kb', d.song ? 'Nothing queued.' : 'No playlists yet.');
          o += kt.key(rx, FY, rw, kt.KH, { g: tg('queue', 24), t: d.song ? 'Queue' : 'Browse', label: d.song ? 'Open the queue' : 'Browse music', data: { np: d.song ? 'queue' : 'browse' } });
        }
      }
      var card = d.bg === 'card', back = !card && d.cover ? '<div class="a npbg"><img alt="" draggable="false" src="' + esc(d.cover) + '"><i></i></div>' : '';
      return '<style>' + CSS + '</style>' + kt.plate(k, back + o, { cls: card ? 'npcard' : 'mu', label: d.title || 'Now Playing' });
    }

    // ------------------------------------------------------------ the card's methods
    // what the block shows, read from the player (and its rooms' volumes) when it is told
    /** @param {string} size */
    HkNowPlayingCard.prototype._npData = function (size) {
      var p = this._player(), a = (p && p.attributes) || {}, res = this._res(), ctx = res.context, song = !!p && (p.state === 'playing' || p.state === 'paused') && !!a.media_title;
      var playing = !!p && p.state === 'playing', dur = song ? Number(a.media_duration) || 0 : 0, pos = song ? Number(a.media_position) || 0 : 0, posAt = Date.parse(a.media_position_updated_at) || 0;
      var live = song && playing && dur > 0 && motionOk();
      // (where the track began, from what the speaker said: the same for the same state, so a quiet update draws nothing again)
      var since = posAt ? posAt - Math.round(pos * 1000) : Date.now() - Math.round(pos * 1000);
      // (the same moment while the speaker's account of it moves by under a second: the rounding of a push's position and its time
      // would otherwise draw the whole block again every time)
      if (live) { var was = this._npSince; if (was && Math.abs(was - since) < 1000) since = was; else this._npSince = since; }
      if (dur > 0 && !live && playing && posAt) pos += Math.max(0, (Date.now() - posAt) / 1000);
      if (dur > 0) pos = Math.min(dur, Math.max(0, pos));
      // (a group's volume is its rooms': the slider shows their average and sets every one)
      var members = ctx && ctx.members && ctx.members.length > 1 ? ctx.members : res.player ? [res.player] : [], self = this, lv = [], vol = null;
      members.forEach(function (/** @type {string} */ m) { var s = self._st(m), x = s && s.attributes ? s.attributes.volume_level : null; if (typeof x === 'number') lv.push(x); });
      if (lv.length) vol = lv.reduce(function (/** @type {number} */ n, /** @type {number} */ x) { return n + x; }, 0) / lv.length;
      var hold = this._npHold;
      if (hold && Date.now() < hold.until) vol = hold.v; else this._npHold = null;
      var d = { size: size, song: song, playing: playing, live: live, title: song ? this._title(p) : 'Nothing Playing', artist: song ? a.media_artist || '' : '',
        album: song ? a.media_album_name || a.media_album || '' : '', cover: song ? this._art(p) : '', bg: (this._config || {}).background === 'card' ? 'card' : 'album', rooms: this._rooms(p),
          roomKey: p ? p.entity_id : res.player,
        pos: pos, dur: dur, since: since, vol: vol, queue: /** @type {any[]} */ ([]), lists: /** @type {any[]} */ ([]) };
      if (size === 'XL') {
        if (song) { this._npAsk(p); d.queue = (this._q || []).slice(0, 4); }
        else {
          var Mu = window.hkMusic, pt = window.hkMedia && window.hkMedia._ ? window.hkMedia._.playlistTiles : null, tiles = pt && Mu && Mu.playlists ? pt(Mu.playlists(), null) : [];
          this._npLists = tiles;
          d.lists = tiles.slice(0, 4).map(function (/** @type {any} */ t, /** @type {number} */ i) {
            return { name: t.name, pi: i, tint: window.hkMedia._.tintOf ? window.hkMedia._.tintOf(t.key || t.name) : null }; });
        }
      }
      this._npSong = song;
      return d;
    };
    // Music Assistant's queue, asked once a song (as the screensaver's rows are): the block draws again when it lands
    HkNowPlayingCard.prototype._npAsk = function (/** @type {any} */ p) {
      var key = this._res().player, sig = key ? key + '|' + this._title(p) + '|' + this._artist(p) : '', self = this;
      if (sig === this._qFor) return;
      this._qFor = sig; this._q = null;
      if (!sig || !this.client || !this.client.callWS) return;
      this.client.callWS({ type: 'hk_music/queue', entity_id: key, limit: 40 }).then(function (/** @type {any} */ r) {
        if (self._qFor !== sig) return;
        self._q = r && r.ok && Array.isArray(r.items) ? r.items.slice(1) : [];
        self.redraw();
      }, function () { if (self._qFor === sig) { self._q = []; self.redraw(); } });
    };
    // THE KIT'S BLOCK: false where it draws none (not a Home Grid block, or the kit not in), so the older drawing runs
    HkNowPlayingCard.prototype._renderKit = function () {
      var kt = KT(), size = this.getAttribute && this.getAttribute('size'), self = this;
      if (!kt || !window.hkNpStrip || !/^(S|W|T|L|XL)$/.test(size || '') || (this._config && this._config.bar)) return false;
      this._watchBlock();
      // (a finger on the volume: it is drawn again once it lifts)
      if (this._npDrag) { this._npLate = true; return true; }
      var k = kt.ctx(this), d = this._npData(size);
      // (the picture is told to whoever paints the page's background, as the player's drawing below does)
      if (window.hkNowArt !== (d.cover || null)) {
        window.hkNowArt = d.cover || null;
        window.dispatchEvent(new CustomEvent('hk-now-art', { detail: { url: d.cover || null } }));
      }
      this._built = false; this._e = null; this._metaCard = null; this._subCard = null;
      return kt.draw(this, layout(d, k), function (/** @type {any} */ root) { self._npBind(root, d); });
    };
    /** @param {any} root @param {any} d */
    HkNowPlayingCard.prototype._npBind = function (root, d) {
      var self = this;
      root.querySelectorAll('[data-np]').forEach(function (/** @type {any} */ el) {
        var n = el.getAttribute('data-np');
        if (n !== 'vol' && n !== 'prog') el.addEventListener('click', function () { self._npAct(n, el); });
      });
      var wrap = root.querySelector('.npp');
      // (the fraction left, where no countdown has said it yet -- hk-timers.js sets it as the block connects, and not again while it holds)
      if (wrap && d.song && d.dur > 0 && wrap.style && !wrap.style.getPropertyValue('--hk-left')) wrap.style.setProperty('--hk-left', Math.max(0, Math.min(1, 1 - d.pos / d.dur)).toFixed(2));
      var v = root.querySelector('[data-np=vol]');
      if (v) this._npVol(v);
      var plate = root.querySelector('hk-plate'), img = root.querySelector('.npc img');
      if (plate && d.cover) {
        if (TONES[d.cover]) applyTone(plate, TONES[d.cover]);
        else if (img && !(d.cover in TONES)) readTone(d.cover, img, function (t) { var pl = self._root && self._root.querySelector ? self._root.querySelector('hk-plate') : null; applyTone(pl, t); });
      }
    };
    // what a tap on the block's parts does (the tests call it; a key and a picture are found by data-np)
    /** @param {string} what @param {any} [el] */
    HkNowPlayingCard.prototype._npAct = function (what, el) {
      if (what === 'cover') this._npSheet(this._npSong ? 'queue' : 'browse');
      else if (what === 'room') this._npSheet('speakers');
      else if (what === 'queue') this._npSheet('queue');
      else if (what === 'browse') this._npSheet('browse');
      else if (what === 'pp') this._svc('play_pause');
      else if (what === 'next') this._svc('next');
      else if (what === 'prev') this._svc('previous');
      else if (what === 'upnext') this._playQueued(el && el.getAttribute ? el.getAttribute('data-qid') : '');
      else if (what === 'plist') {
        var eng = this._idleEngine(), it = (this._npLists || [])[Number(el && el.getAttribute ? el.getAttribute('data-pi') : -1)];
        // (the engine rides in the card's root, which the kit draws afresh: put back where it was)
        if (eng && this._root && !eng.isConnected) this._root.appendChild(eng);
        if (eng && it) eng._play(it, el);
      }
    };
    // THE SHEET THE COVER OPENS (hk-media-npsheet.js): Browse, Queue, Speakers, on the tab asked for -- the older turn-over where there
    // is no detail sheet to open it in
    /** @param {string} tab */
    HkNowPlayingCard.prototype._npSheet = function (tab) {
      var D = /** @type {any} */ (window.hkDetail), at = this._config && this._config.music_at;
      if (D && D.open && customElements.get('hk-music-sheet') &&
          D.open(null, { name: 'Now Playing', icon: 'mdi:music' }, { panel: { tag: 'hk-music-sheet', config: { at: at || '', tab: tab } } })) return true;
      this._turn(tab);
      return false;
    };
    // THE VOLUME: a drag across its row moves the level by how far the finger went (never to where it landed), sent as it goes; a tap
    // sets nothing (the row is also where the page's swipe is let go of)
    /** @param {any} el */
    HkNowPlayingCard.prototype._npVol = function (el) {
      var self = this, D = /** @type {any} */ (window.hkDrag), g = /** @type {any} */ (null);
      var paint = function (/** @type {number} */ f) {
        var pct = Math.round(f * 1000) / 10, t = el.querySelector('.t i'), k = el.querySelector('.k');
        if (t) t.style.width = pct + '%';
        if (k) k.style.left = 'calc(' + pct + '% - 13px)';
        el.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      };
      var send = function (/** @type {number} */ f) { self._npSetVol(f); };
      if (D && D.slider) {
        D.slider(el, {
          target: function () { return el; },
          start: function (/** @type {any} */ t, /** @type {number} */ x) {
            var r = el.getBoundingClientRect(), now = self._npHold && Date.now() < self._npHold.until ? self._npHold.v : Number(el.getAttribute('aria-valuenow')) / 100;
            g = { x0: x, w: r.width || 1, base: isFinite(now) ? now : 0, v: null, at: 0, t: null };
            self._npDrag = true;
          },
          move: function (/** @type {any} */ t, /** @type {number} */ x) {
            if (!g) return;
            g.v = Math.max(0, Math.min(1, g.base + (x - g.x0) / g.w));
            paint(g.v);
            var now = Date.now();
            if (now - g.at >= VOL_EVERY) { g.at = now; send(g.v); } else if (!g.t) g.t = setTimeout(function () { if (g) { g.t = null; g.at = Date.now(); send(g.v); } }, VOL_EVERY);
          },
          end: function (/** @type {any} */ t, /** @type {boolean} */ canceled) {
            var was = g; g = null; self._npDrag = false;
            if (was && was.t) clearTimeout(was.t);
            if (was && was.v !== null && !canceled) send(was.v);
            if (self._npLate) { self._npLate = false; self.redraw(); }
          }
        });
      }
      // the arrows, for a keyboard: five percent a press
      el.addEventListener('keydown', function (/** @type {any} */ e) {
        var step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[/** @type {string} */ (e.key)];
        if (!step) return;
        e.preventDefault();
        var f = Math.max(0, Math.min(1, Number(el.getAttribute('aria-valuenow')) / 100 + step));
        paint(f); send(f);
      });
    };
    // the level to the speaker's rooms (a group: every one in one call, the music panel's rule), and held on screen until it says so
    /** @param {number} f */
    HkNowPlayingCard.prototype._npSetVol = function (f) {
      var ctx = this._musicCtx(), key = this._res().player, P = /** @type {any} */ (window.hkSaverPanel);
      this._npHold = { v: f, until: Date.now() + VOL_HOLD };
      var calls = P && P.volumeCalls && ctx ? P.volumeCalls(ctx, null, f) : key ? [{ entity_id: key, volume_level: f }] : [];
      for (var i = 0; i < calls.length; i++) this._call('media_player', 'volume_set', calls[i]);
    };
    // A HOME GRID BLOCK IS THE KIT'S: the card draws it where it can (a Home Grid block with the music feature), and the drawing in
    // hk-media-now.js runs everywhere else -- the docked bar, the pages' players, a block while Music is not added
    var plain = HkNowPlayingCard.prototype._render;
    HkNowPlayingCard.prototype._render = function () {
      if (this._config && this.hasAttribute('size') && !K.musicMissing() && this._renderKit()) return;
      return plain.call(this);
    };

    // (the pure pieces, for the tests: the layout in the block's px, and the tone a cover's mean color makes)
    /** @type {any} */ (window).hkNpKit = { layout: layout, toneOf: toneOf, CSS: CSS };
  };
})();
