// hk-energy-page.js - the Energy page's plate and tabs, the summary and hero (rings and lines), highlights and where it went.
//
// PART OF THE ENERGY CARDS (hk-energy.js). Not a card and not run on its own: it registers one
// function, which hk-energy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkEnergyParts = window.hkEnergyParts || {})['hk-energy-page'] = function (K) {
    var calcFor = K.calcFor, CHEV_L = K.CHEV_L, CHEV_R = K.CHEV_R, costAt = K.costAt, EP = K.EP, esc = K.esc,
        fx = K.fx, highlights = K.highlights, HkBase = K.HkBase, homeAt = K.homeAt, HOUR = K.HOUR,
        hourName = K.hourName, kwh = K.kwh, live = K.live, MAX_BACK = K.MAX_BACK, model = K.model,
        monthOf = K.monthOf, period = K.period, PERIODS = K.PERIODS, plan = K.plan, rangeText = K.rangeText,
        REST = K.REST, restartAnim = K.restartAnim, rgba = K.rgba, RING = K.RING, runtimes = K.runtimes,
        series = K.series, setBack = K.setBack, setPeriod = K.setPeriod, setPick = K.setPick, sum = K.sum,
        TAB_NAMES = K.TAB_NAMES, titleOf = K.titleOf, unitOf = K.unitOf, watts = K.watts, wattsNow = K.wattsNow,
        whenOf = K.whenOf;

    // ====================================================== THE CARDS' PLATE
    var EP_CSS = [
      // THE PAGE CARD (hk-base.js pageCardCss): the plate and padding, the one
      // title row, the figure, the label -- shared with the page headers
      // (hk-headers.js), so the two pages' cards cannot drift apart
      window.hkCards.pageCardCss('ep'),
      '.tlab{display:flex;justify-content:space-between;margin-top:6px;font-size:12px;font-weight:600;line-height:1;',
      '  color:' + window.hkCards.v('ink-3') + ';font-variant-numeric:tabular-nums}',
      '.dim{opacity:0.28}',
      // A DAY STILL TO COME: its label quieter (its bar is last period's, in gray)
      '.bl span.fut,.bl span.fut b{color:' + window.hkCards.v('ink-3') + '}',
      // A TAP ON ANYTHING ABOUT ONE THING opens its sheet (data-more)
      '[data-more]{cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '[data-more]:active{opacity:0.7}',
      'svg{display:block}',
      // THE GRAPHS BUILD when a tab is first drawn (the card's `anim` class, a
      // second long): transform, opacity and clip only, so the compositor does
      // the work and nothing is laid out again. Never on a live update.
      '@keyframes hkGrow{from{transform:scale(0.001)}}',
      '@keyframes hkRise{from{transform:scaleY(0.001)}}',
      '@keyframes hkPop{from{transform:scale(0.6);opacity:0}}',
      '@keyframes hkWipe{from{clip-path:inset(0 100% 0 0)}}',
      // the bar GROWS from the left: its leading edge rounded like its end,
      // over a second, steadily rather than all at once
      '@keyframes hkGrowBar{from{clip-path:inset(0 100% 0 0 round 8px)}to{clip-path:inset(0 0 0 0 round 8px)}}',
      '.anim .bar.gwipe{animation:hkGrowBar 1.1s cubic-bezier(.22,.8,.25,1) backwards}',
      '.anim .gw{animation:hkGrow .55s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 14ms);',
      '  transform-box:view-box;transform-origin:150px 150px}',
      '.anim .gr2{animation:hkRise .6s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 45ms);',
      '  transform-box:fill-box;transform-origin:50% 100%}',
      '.anim .gp{animation:hkPop .4s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 16ms)}',
      '.anim .gwipe{animation:hkWipe .7s cubic-bezier(.22,.8,.25,1) backwards}',
      '.anim .dots i{animation:hkRise .5s cubic-bezier(.22,.8,.25,1) backwards;animation-delay:calc(var(--i,0) * 18ms);transform-origin:50% 100%}',
      '@media (prefers-reduced-motion: reduce){.anim *{animation:none !important}}',
      // HOVER, TOUCH OR KEYS ON A GRAPH (hkCards.scrub, 2026-10-16): the bar
      // under the pointer or finger lit, the rest back, its figure said in the
      // card's title row; the chart takes focus and the arrow keys step it
      '.bc,.clock,.trace{touch-action:pan-y;-webkit-user-select:none;user-select:none}',
      '.bc [data-i],.clock [data-i]{transition:opacity ' + window.hkCards.DUR.press + ' ease}',
      '.on [data-i]:not(.hit){opacity:.35}',
      '.bc:focus-visible,.clock:focus-visible,.trace:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:4px;border-radius:' + window.hkCards.R.small + 'px}',
      '.trace .cur{stroke:' + window.hkCards.v('ink') + ';stroke-width:1.5;opacity:0}',
      '.trace.on .cur{opacity:.8}',
      '@media (prefers-reduced-motion: reduce){.bc [data-i],.clock [data-i]{transition:none}}'
    ].join('');

    // WHAT A SLOT IS, for a graph's readout: "9 AM" on the day's hours,
    // "Tue, Oct 14" on a week's or month's days (bar k of the tab)
    function slotName(p, R, k, tz) {
      if (p === 'now' || p === 'day') {
        var t0 = R.hToday.length ? +R.ax.h[R.hToday[0]].t : 0;
        return hourName(t0 + k * 36e5, tz);
      }
      return R.dates[k] != null ? new Date(R.dates[k]).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })) : '';
    }

    // A TAP ON ANYTHING MARKED data-more="<entity>" opens that entity's sheet
    // (hkShell.moreInfo, which HK's detail sheets answer): one listener per card
    function bindMore(card, el) {
      if (!el || el._hkMore) return;
      el._hkMore = true;
      el.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-more]') : null;
        var id = t && t.getAttribute('data-more');
        if (!id) return;
        e.stopPropagation();
        window.hkShell.moreInfo(id, card);
      });
    }
    function moreAttr(id) { return id ? ' data-more="' + esc(id) + '"' : ''; }
    // THE SHARED SHELL: joins the page, gates renders on what it draws from,
    // and hands each card the model, the statistics and the sums
    class HkEnergyBase extends HkBase {
      // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)
      static get FLAT_MOTION() { return true; }
      static get CSS() { return EP_CSS + (this.PART_CSS || ''); }
      getCardSize() { return 6; }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        EP.cards.add(this);
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        EP.cards.delete(this);
      }
      // the tab, the lit section, HA's settings arriving, and -- on Now --
      // every power sensor the card reads
      _sigOf() {
        var h = this.client;
        if (!h) return null;
        var sig = period() + '|' + (EP.back || 0) + '|' + EP.pick + '|' + EP.ver + '|' + (plan() ? 'p' : '-');
        // NOW MOVES WITH THE HOUSE, BUT NOT 12 TIMES A SECOND: a Now card
        // follows its sensors at most every five seconds (a circuit's watts
        // change on nearly every push; nobody reads them that fast)
        if (period() === 'now') sig += '|' + Math.floor(Date.now() / 5e3);
        return sig;
      }
      _money(v, d) {
        var C = window.hkCards;
        return C && C.money ? C.money(this.client, v, d) : '$' + fx(v, d);
      }
      _shell(cls) {
        if (this._built) return;
        this._root.innerHTML = '<hk-plate class="ep ' + cls + '" data-hk-role="card"></hk-plate>';
        this._card = this._root.querySelector('hk-plate');
        var hgt = this._config && this._config.height;
        if (hgt) this._card.style.setProperty('--hk-ep-h', String(hgt));
        bindMore(this, this._card);
        this._built = true;
      }
      // model + statistics + sums, or a reason to wait
      _data() {
        var M = model(this.client, this);
        if (!M) return { wait: true };
        var D = series(this.client, this, M);
        if (!D) return { M: M, wait: true };
        var R = calcFor(M, D, period(), runtimes(this.client, this, M));
        return R ? { M: M, D: D, R: R } : { M: M, wait: true };
      }
      // A GRAPH THAT READS OUT (hkCards.scrub): `tips[i]` is what bar i says;
      // the line it says it in is the title row's right-hand text unless
      // `o.readout` names another, and that text comes back after
      _scrubs(box, tips, o) {
        if (!box) return;
        o = o || {};
        var self = this, rd = o.readout || function () { return self._card && self._card.querySelector('.ttl span'); };
        var rest = o.rest != null ? o.rest : (rd() ? rd().innerHTML : '');
        window.hkCards.scrub(this, box, { count: tips.length, nowI: o.nowI, rest: rest, name: o.name || 'Graph', readout: rd, index: o.index,
          onPick: o.onPick, say: function (i) { return tips[i] || ''; } });
      }
      // draw again once the card has a width (the bars are sized to it)
      _later() {
        var self = this;
        if (this._laterAsked) return;
        this._laterAsked = true;
        requestAnimationFrame(function () { self._laterAsked = false; if (self._card && self._card.clientWidth) self.redraw(); });
      }
      _paint(html) {
        window.hkCards.morph(this._card, html);
        // a tab drawn for the first time builds; every redraw after it does not
        var p = period() + '|' + (EP.back || 0);
        if (this._animTab !== p && !/class="wait"/.test(html)) {
          this._animTab = p;
          var card = this._card;
          restartAnim(card, 'anim');
          clearTimeout(this._animT);
          this._animT = setTimeout(function () { card.classList.remove('anim'); }, 1500);
        }
      }
    }

    // ------------------------------------------------------------ the tabs
    class HkEnergyPeriodCard extends HkEnergyBase {
      static get PART_CSS() {
        return [
          // THE TABS FLOAT: they stay at the top while the page scrolls under
          // them, and once they do, a frosted strip keeps them readable over
          // the cards (no strip while they sit in their place)
          // ...clear of an iPhone's status bar and Dynamic Island (2026-10-13:
          // floating, they sat under the clock and could not be tapped), as the
          // tab bar at the top does (hk-tabbar.js TOP_CSS)
          ':host{position:sticky;top:max(var(--hk-energy-sticky-top,10px), calc(env(safe-area-inset-top, 0px) + 4px));z-index:4;display:block}',
          // ON THE PAGE'S EDGES, as the cards under it (they are in a grid that
          // gives each 4 px a side; this sits in the page's column, where a grid
          // would end its sticking): DESIGN.md "Page edges"
          'hk-plate.ep{margin-left:4px;margin-right:4px;width:auto}',
          'hk-plate.ep.period{height:auto;background:none;border:1px solid transparent;box-shadow:none;padding:0 4px;',
          '  flex-direction:row;align-items:center;gap:12px;min-height:36px;overflow:visible;flex-wrap:wrap;',
          '  border-radius:24px;transition:background-color .25s ease,padding .25s ease,box-shadow .25s ease,border-color .25s ease}',
          // the look's floating plate where it has one (Tinted: no blur, the
          // menu's and tab bar's near-opaque plate), else a frosted strip
          ':host([data-stuck]) hk-plate.ep.period{padding:6px 6px 6px 16px;background:' + window.hkCards.v('float-plate') + ';',
          '  -webkit-backdrop-filter:var(--hk-float-backdrop,blur(24px) saturate(1.6));backdrop-filter:var(--hk-float-backdrop,blur(24px) saturate(1.6));',
          '  border-color:rgba(255,255,255,0.12);box-shadow:0 8px 24px rgba(0,0,0,0.28)}',
          ':host([data-stuck]) .pt{text-shadow:none}',
          '.pt{font-size:22px;font-weight:700;letter-spacing:-0.35px;line-height:1.1;white-space:nowrap;',
          '  text-shadow:' + window.hkCards.v('glow') + '}',
          '.ps{font-size:15px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
          // ‹ › THROUGH THE WEEKS OR MONTHS: the calendar's own round glass
          // buttons (hk-calendar.js .rb); the tab itself brings you back
          '.nav{display:flex;gap:8px}',
          '.nav[hidden]{display:none}',
          '.nav button{appearance:none;width:44px;height:44px;border-radius:22px;border:' + window.hkCards.M.border + ';' + window.hkCards.M.glass + ';',
          '  display:flex;align-items:center;justify-content:center;padding:0;margin:0;color:' + window.hkCards.v('ink') + ';cursor:pointer;',
          '  -webkit-tap-highlight-color:transparent;transition:opacity .2s ease}',
          '.nav button:disabled{opacity:0.35;cursor:default}',
          // HK's segmented control: the calendar's own (hk-base.js segCss)
          window.hkCards.segCss('.seg', { raised: true }),
          '.seg .live{width:7px;height:7px;border-radius:50%;background:#30d158;box-shadow:0 0 0 3px rgba(48,209,88,0.25)}',
          '@media (max-width:' + window.hkCards.BP.phone + 'px){.seg{width:100%}.seg button{flex:1;min-width:0;padding:0 6px}.seg .pfx{display:none}.ps{flex:1 1 auto}',
          // floating on a phone: just the tabs, so the strip takes one row
          '  :host([data-stuck]) .pt,:host([data-stuck]) .ps,:host([data-stuck]) .nav{display:none}:host([data-stuck]) hk-plate.ep.period{padding:5px}}'
        ].join('');
      }
      getCardSize() { return 1; }
      // NO PLATE, so nothing for the shared blur to frost behind it
      setConfig(config) { super.setConfig(Object.assign({ glass: false }, config || {})); }
      // FLOATING OR IN ITS PLACE: watched on scroll (any scroller: the window
      // on a phone, the view elsewhere), at most once a frame
      connectedCallback() {
        super.connectedCallback();
        var self = this;
        if (!this._onScroll) {
          this._onScroll = function () {
            if (self._scrollQ) return;
            self._scrollQ = requestAnimationFrame(function () {
              self._scrollQ = 0;
              var top = parseFloat(getComputedStyle(self).top) || 0, r = self.getBoundingClientRect();
              var stuck = r.top <= top + 0.5 && (window.scrollY > 0 || r.top < self._homeTop - 1);
              if (self._homeTop == null || (!stuck && r.top > top + 0.5)) self._homeTop = r.top;
              self.toggleAttribute('data-stuck', !!stuck);
            });
          };
        }
        window.addEventListener('scroll', this._onScroll, { passive: true, capture: true });
        this._onScroll();
      }
      disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('scroll', this._onScroll, { capture: true });
      }
      _sigOf() { return period() + '|' + (EP.back || 0) + '|' + EP.ver + '|' + Math.floor(Date.now() / 60e3); }
      _render() {
        var self = this, S = window.hkStats;
        if (S && this.client) EP.ws = S.weekStart(this.client);
        // this card's own Opens On, before anything has chosen a tab
        if (!EP.period && this._config && PERIODS.indexOf(this._config.opens_on) >= 0) EP.period = this._config.opens_on;
        if (!this._built) {
          this._shell('period');
          this._card.innerHTML = '<div class="pt"></div><div class="ps"></div>' +
            '<div class="nav" hidden><button data-n="1">' + CHEV_L + '</button><button data-n="-1">' + CHEV_R + '</button></div>' +
            '<div class="seg" role="tablist" aria-label="Period">' +
            PERIODS.map(function (p) {
              return '<button role="tab" data-p="' + p + '">' + (p === 'now' ? '<i class="live"></i>' : '') +
                (p === 'week' || p === 'month' ? '<span class="pfx">This </span>' + (p === 'week' ? 'Week' : 'Month') : TAB_NAMES[p]) + '</button>';
            }).join('') + '</div>';
          this._card.querySelectorAll('.nav button').forEach(function (b) {
            b.addEventListener('click', function (e) {
              e.stopPropagation();
              if (b.disabled) return;
              setBack((EP.back || 0) + Number(b.getAttribute('data-n')));
            });
          });
          this._card.querySelectorAll('.seg button').forEach(function (b) {
            b.addEventListener('click', function (e) {
              e.stopPropagation();
              var was = self._card.querySelector('.seg button[aria-selected="true"]'), from = window.hkCards.segBox(was);
              setPeriod(b.getAttribute('data-p'));
              self.redraw();
              if (was !== b) window.hkCards.slideSeg(b, from);
            });
          });
        }
        var p = period(), tz = S && S.tz(), now = new Date(), cal = (p === 'week' || p === 'month') && S, back = cal ? (EP.back || 0) : 0;
        var P = cal ? S.period(p, back, +now, EP.ws || 0) : null;
        var sub = p === 'now' ? 'Live · ' + now.toLocaleTimeString(window.hkLocale.tag(), window.hkLocale.clock({ hour: 'numeric', minute: '2-digit', timeZone: tz }))
          : p === 'day' ? now.toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }))
          : P ? rangeText(P.start, P.len, tz) : '';
        this._card.querySelector('.pt').textContent = P ? titleOf(p, back, P.start, tz) : TAB_NAMES[p];
        this._card.querySelector('.ps').textContent = sub;
        // the arrows: back as far as the statistics go (and half a year of
        // weeks, a year of months), forward as far as this week or month
        var nav = this._card.querySelector('.nav'), x = cal ? this._data() : null, R = x && x.R;
        nav.hidden = !cal;
        if (cal) {
          var pv = nav.children[0], nx = nav.children[1], word = p === 'week' ? 'week' : 'month';
          pv.disabled = back >= MAX_BACK[p] || !!(R && R.prev && !R.prev.has);
          nx.disabled = back === 0;
          pv.setAttribute('aria-label', 'Previous ' + word);
          nx.setAttribute('aria-label', 'Next ' + word);
        }
        this._card.querySelectorAll('button').forEach(function (b) {
          b.setAttribute('aria-selected', b.getAttribute('data-p') === p ? 'true' : 'false');
        });
      }
    }

    // ------------------------------------------------- the hero: now, or rings
    // `tick`: a week or month still going marks on each ring where a usual
    // one would be by now (the days gone of its length) -- past it is above usual
    // `o` (the Energy Rings block, 2026-10-31): the rings' width, the step from
    // one to the next and the outer radius, in the 220 viewBox's units -- a
    // block draws them at 132 px, where the page's 18 would be hairlines
    function ringSvg(list, more, tick, o) {
      o = o || {};
      var w = o.w || (list.length > 3 ? 18 : 22), step = o.step || w + 4, r0 = o.r0 || 96, out = '', ticks = '';
      list.forEach(function (x, i) {
        var r = r0 - i * step, c = 2 * Math.PI * r, f = Math.max(0, Math.min(x.f, 1)), over = Math.max(0, Math.min(x.f - 1, 1));
        out += '<circle cx="110" cy="110" r="' + r + '" fill="none" stroke="' + x.c + '" stroke-opacity=".18" stroke-width="' + w + '"/>';
        // every arc is always drawn (an empty one is a zero-length dash), so
        // the same element is there to animate from one value to the next
        out += '<circle class="arc" data-k="' + x.key + '" data-c="' + c.toFixed(1) + '" data-len="' + (c * f).toFixed(1) +
          '" cx="110" cy="110" r="' + r + '" fill="none" stroke="' + x.c + '" stroke-width="' + w +
          '" stroke-linecap="round" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 110 110)"' +
          (f > 0.001 ? '' : ' stroke-opacity="0"') + '/>';
        // PAST A FULL RING, a second lap over the first, its end cap shadowed
        // so the overlap reads (the Activity rings' own)
        out += '<circle class="arc lap" data-k="' + x.key + '-lap" data-c="' + c.toFixed(1) + '" data-len="' + (c * over).toFixed(1) +
          '" cx="110" cy="110" r="' + r + '" fill="none" stroke="' + x.c + '" stroke-width="' + w +
          '" stroke-linecap="round" stroke-dasharray="' + (c * over).toFixed(1) + ' ' + c.toFixed(1) +
          '" transform="rotate(-90 110 110)" style="filter:drop-shadow(0 0 4px rgba(0,0,0,.6))"' + (over > 0.001 ? '' : ' stroke-opacity="0"') + '/>';
        // a white dot on the ring itself (a line across all of them reads as a
        // clock's hand); each ring its own (x.tick) where its usual day differs
        var tk = x.tick != null ? x.tick : tick;
        if (tk > 0 && tk < 1) {
          var a = (tk * 360 - 90) * Math.PI / 180;
          ticks += '<circle class="tick" cx="' + (110 + r * Math.cos(a)).toFixed(1) + '" cy="' + (110 + r * Math.sin(a)).toFixed(1) + '" r="' + (w * 0.2).toFixed(1) + '"/>';
        }
      });
      return '<svg class="rings" viewBox="0 0 220 220" role="img" aria-label="Rings against a usual ' + (tick > 0 ? 'period, marked where it would be by now' : 'day') + '"' +
        moreAttr(more) + '>' + out + ticks + '</svg>';
    }
    // A LINE THROUGH VALUES as an area, `w` x `h`; nulls (an open bucket, a
    // gap) are skipped rather than drawn as zero
    function lineSvg(vals, w, h, color, o) {
      o = o || {};
      var pts = [], mx = o.min || 0.01;
      vals.forEach(function (x) { if (typeof x === 'number' && isFinite(x) && x > mx) mx = x; });
      var n = Math.max(1, vals.length - 1);
      vals.forEach(function (x, i) {
        if (typeof x !== 'number' || !isFinite(x)) return;
        pts.push([i * w / n, h - 2 - (h - 4) * Math.max(0, x) / mx]);
      });
      if (pts.length < 2) return '<path d="M0 ' + (h - 2) + 'H' + w + '" stroke="' + window.hkCards.v('line-strong') + '" stroke-width="2" vector-effect="non-scaling-stroke"/>';
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var last = pts[pts.length - 1];
      return '<path d="' + d + ' L' + last[0].toFixed(1) + ' ' + h + ' L' + pts[0][0].toFixed(1) + ' ' + h + ' Z" fill="' + rgba(color, o.fill || 0.2) + '"/>' +
        '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (o.sw || 2) + '" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
        (o.dot === false ? '' : '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3" fill="' + color + '"/>');
    }
    function timeLabels(now, hours, tz) {
      var out = [];
      for (var i = 0; i <= 3; i++) {
        out.push(i === 3 ? 'Now' : new Date(now - (3 - i) * hours / 3 * HOUR).toLocaleTimeString(window.hkLocale.tag(), window.hkLocale.clock({ hour: 'numeric', minute: '2-digit', timeZone: tz })));
      }
      return '<div class="tlab">' + out.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>';
    }
    function readingOf(card, M, R, t) {
      var h = card.client;
      if (t.kind === 'cost') return { k: 'Today’s Cost', v: R ? card._money(R.cost, 2) : '—' };
      var s = t.entity && h.states[t.entity];
      if (!s) return null;
      if (t.kind === 'climate') {
        var ct = (s.attributes || {}).current_temperature;
        return { k: t.name, v: ct != null && isFinite(Number(ct)) ? Math.round(Number(ct)) + '°' : '—' };
      }
      var n = Number(s.state), u = (s.attributes || {}).unit_of_measurement || '';
      if (t.kind === 'temp') return { k: t.name, v: isFinite(n) ? Math.round(n) + '°' : '—' };
      return { k: t.name, v: isFinite(n) ? fx(n, Math.abs(n) >= 100 ? 0 : 1) + (u ? '<u>' + esc(u) + '</u>' : '') : esc(s.state) };
    }
    function ringsOf(M, R) {
      var all = { energy: true, cost: M.hasCost, solar: M.src.solar.length > 0, water: M.src.water.ids.length > 0, gas: M.src.gas.ids.length > 0 };
      var want = Array.isArray(M.rings) && M.rings.length ? M.rings : ['energy', 'cost', 'solar', 'water', 'gas'];
      return want.filter(function (k) { return all[k]; }).slice(0, 4).map(function (k) {
        var val = k === 'energy' ? R.home : k === 'cost' ? R.cost : R[k], typ = (k === 'energy' ? R.typ.home : R.typ[k]) * R.n;
        return { key: k, c: RING[k], v: val, typ: typ, f: typ > 0 ? val / typ : 0 };
      });
    }
    class HkEnergyHeroCard extends HkEnergyBase {
      static get PART_CSS() {
        return [
          'hk-plate.ep.hero{--hk-ep-h:320px}',
          '.rh{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:center;height:100%}',
          '.rings{width:200px;height:200px}',
          '.rings .tick{fill:#fff;filter:drop-shadow(0 0 2px rgba(0,0,0,.55))}',
          '.lede{font-size:21px;font-weight:600;line-height:1.3;letter-spacing:-0.3px}',
          '.lede em{font-style:normal;color:' + RING.energy + '}',
          '.stats{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:16px;margin-top:18px}',
          // EACH FIGURE FITS ITS THIRD (2026-10-16, the user: "1,112$161.49068"
          // at 1100 px): the column is its own container and the figure at most
          // 22 % of it -- 30 px from a 136 px column, smaller below; and a
          // card under 700 px draws the rings at 150, giving the figures the room
          '.stat{min-width:0;container-type:inline-size}',
          '.stat .big{margin-top:7px;font-size:min(30px,22cqw);white-space:nowrap}',
          // (its unit half the figure: 15 px at 30, as everywhere, and with it as it shrinks)
          '.stat .big u{font-size:0.5em}',
          '@container (max-width:' + window.hkCards.BP.cardList + 'px){.rh{grid-template-columns:150px minmax(0,1fr);gap:20px}.rings{width:150px;height:150px}.stats{gap:12px}}',
          '.of{font-size:14px;line-height:18px;margin-top:3px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.nowv{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:10px;flex:none}',
          '.nowv .big{font-size:44px;font-weight:600;letter-spacing:-1.5px;line-height:1}',  // hkCards.TYPE hero
          '.nowv .big u{font-size:20px;margin-left:4px}',
          '.nowv .cap{text-align:right;padding-bottom:2px}',
          '.trace{width:100%;flex:1;min-height:60px;margin-top:14px}',
          '.reads{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-top:16px;padding-top:16px;',
          '  border-top:1px solid ' + window.hkCards.v('line') + ';flex:none}',
          '.reads .big{font-size:24px;margin-top:7px}',
          // THE WHOLE ROW WIDE (no highlights beside it): a third of it more --
          // what is drawing most on Now, the period before on the others
          '.hw{display:flex;gap:26px;height:100%;min-height:0}',
          '.hw>.hm{flex:1;display:flex;flex-direction:column;min-width:0}',
          '.wide{display:none;width:300px;flex:none;flex-direction:column;justify-content:center;gap:12px;',
          '  border-left:1px solid ' + window.hkCards.v('line') + ';padding-left:24px}',
          '@container (min-width:' + window.hkCards.BP.cardHero + 'px){.wide{display:flex}}',
          '.wide .mh{font-size:13px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;color:' + window.hkCards.v('ink-2') + '}',
          '.mr{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;row-gap:5px;align-items:baseline}',
          '.mr b{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.mr span{font-size:13px;color:' + window.hkCards.v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
          '.mr i{grid-column:1/-1;display:block;height:6px;border-radius:3px;background:' + window.hkCards.v('key') + ';overflow:hidden}',
          '.mr i em{display:block;height:100%;border-radius:3px}',
          '.cmp .big{font-size:22px;margin-top:5px}',
          '@media (max-width:' + window.hkCards.BP.phone + 'px){hk-plate.ep.hero{--hk-ep-h:450px}.rh{grid-template-columns:1fr;justify-items:center;gap:20px}',
          '  .rh>div{width:100%}.rings{width:180px;height:180px}.stats{gap:10px}.stat .big{font-size:24px}.of{white-space:normal}',
          '  .reads{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:14px}.nowv .big{font-size:40px}}'
        ].join('');
      }
      _render() {
        this._shell('hero');
        var x = this._data(), p = period();
        if (x.wait) return this._paint('<div class="wait">Loading…</div>');
        var M = x.M, R = x.R, h = this.client, tz = window.hkStats && window.hkStats.tz();
        if (p === 'now') {
          this._ringTab = 'now';               // the rings sweep in again on the way back
          var T = M.total, w = wattsNow(h, T.power), five = live(h, this, M), html;
          var reads = (M.P.top || []).map(function (t, i) {
            var r = readingOf(this, M, R, t);
            if (r) r.i = i;
            return r;
          }, this).filter(Boolean).slice(0, 4);
          var readsHtml = reads.length ? '<div class="reads">' + reads.map(function (r) {
            return '<div class="stat" data-r="' + r.i + '"><div class="k">' + esc(r.k) + '</div><div class="big num">' + r.v + '</div></div>';
          }).join('') + '</div>' : '';
          if (w != null) {
            var tr = five && five[T.power] ? five[T.power].map(function (p2) { return p2.v; }) : [];
            var trT = five && five[T.power] ? five[T.power].map(function (p2) { return +p2.t; }) : [];
            var got = tr.filter(function (z) { return typeof z === 'number'; }), avg = got.length ? sum(got) / got.length : null;
            var wv = watts(w);
            html = '<div class="ttl"><b>Using Now</b><span>' + esc(T.name || 'Whole Home') + ' · the last 3 hours</span></div>' +
              '<div class="nowv"' + moreAttr(T.power) + '><div class="big num">' + wv[0] + '<u>' + wv[1] + '</u></div><div class="cap">' +
              (avg != null ? (w > avg * 1.3 ? 'Above' : w < avg * 0.7 ? 'Below' : 'About') + ' its last-3-hour average of ' + watts(avg).join(' ') + '<br>' : '') +
              kwh(R.home) + ' kWh so far today</div></div>' +
              '<svg class="trace gwipe"' + moreAttr(T.power) + ' viewBox="0 0 1000 150" preserveAspectRatio="none">' + lineSvg(tr, 1000, 150, RING.energy, { fill: 0.22, sw: 2.5 }) +
              '<line class="cur" x1="0" x2="0" y1="0" y2="150" vector-effect="non-scaling-stroke"/></svg>' +
              timeLabels(Date.now(), 3, tz) + readsHtml;
          } else {
            // NO WHOLE-HOME POWER SENSOR: today so far, by hour
            var hrs = R.hToday.map(function (i) { return homeAt(M, x.D.h, i); });
            html = '<div class="ttl"><b>Today So Far</b><span>by hour</span></div>' +
              '<div class="nowv"' + moreAttr(T.stat) + '><div class="big num">' + kwh(R.home) + '<u>kWh</u></div><div class="cap">No live reading for the whole home</div></div>' +
              '<svg class="trace" viewBox="0 0 1000 150" preserveAspectRatio="none">' + lineSvg(hrs, 1000, 150, RING.energy, { fill: 0.22, sw: 2.5 }) + '</svg>' + readsHtml;
          }
          // drawing most, live, in their sections' colors
          var drawing = M.devs.filter(function (d) { return d.counted && d.power; })
            .map(function (d) { return { d: d, w: Math.max(0, wattsNow(h, d.power) || 0) }; })
            .filter(function (r) { return r.w >= 5; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 5);
          var dmax = drawing.length ? drawing[0].w : 1;
          var wide = drawing.length ? '<div class="wide"><div class="mh">Drawing Most</div>' + drawing.map(function (r) {
            return '<div class="mr"' + moreAttr(r.d.power || r.d.stat) + '><b>' + esc(r.d.name) + '</b><span>' + watts(r.w).join(' ') + '</span><i><em style="width:' +
              (100 * r.w / dmax).toFixed(1) + '%;background:' + r.d.sec.color + '"></em></i></div>';
          }).join('') + '</div>' : '';
          this._paint('<div class="hw"><div class="hm">' + html + '</div>' + wide + '</div>');
          this._bindReads(M);
          // THE LAST THREE HOURS READ OUT: each five minutes' watts, a line at it
          var trace = this._card.querySelector('svg.trace');
          if (trace && w != null && tr.length) {
            var cur = trace.querySelector('.cur'), n5 = tr.length;
            this._scrubs(trace, tr.map(function (z, i) {
              return new Date(trT[i] || Date.now()).toLocaleTimeString(window.hkLocale.tag(), window.hkLocale.clock({ hour: 'numeric', minute: '2-digit', timeZone: tz })) + ' \u00b7 ' +
                (typeof z === 'number' && isFinite(z) ? watts(z).join(' ') : 'no reading yet');
            }), { nowI: n5 - 1, name: 'The last three hours',
              index: function (x, y, box) { var r = box.getBoundingClientRect(); return r.width ? Math.max(0, Math.min(n5 - 1, Math.round((x - r.left) / r.width * (n5 - 1)))) : -1; },
              onPick: function (i) { if (cur && i != null) { var X = (1000 * i / Math.max(1, n5 - 1)).toFixed(1); cur.setAttribute('x1', X); cur.setAttribute('x2', X); } } });
          }
          return;
        }
        var rings = ringsOf(M, R), when = whenOf(p, R), wk = p === 'week' ? 'week' : 'month';
        // AGAINST USUAL: today's projection against a usual day; a week or a
        // month so far against a usual one's pace to now (a whole one, once past)
        var base = R.typ.home * (p === 'day' ? 1 : R.days), got = p === 'day' ? R.proj : R.home;
        var vsT = base > 0 ? Math.round(100 * (got - base) / base) : 0;
        var near = Math.abs(vsT) < 6, cmp = near ? (p === 'day' ? 'about a typical day' : 'about usual')
          : Math.abs(vsT) + '% ' + (vsT < 0 ? 'below' : 'above') + (p === 'day' ? ' a typical day' : ' usual');
        var lede;
        if (p === 'day' || R.cur) {
          lede = (p === 'day' ? 'On pace for ' : 'Heading for ') + '<em>' + fx(R.proj, 0) + ' kWh</em> ' + when + ', ' + cmp +
            (M.hasCost ? ', about ' + this._money(R.projCost, p === 'day' ? 2 : 0) : '') + '.';
          // THE FIRST MORNING OF A WEEK OR MONTH has nothing to say about it
          // yet: what there is so far, and the last one
          if (p !== 'day' && R.whole === 0 && R.share < 0.5 && R.prev && R.prev.allHome > 0) {
            lede = 'The ' + wk + ' has just started: <em>' + kwh(R.home) + ' kWh</em> so far. ' +
              (p === 'week' ? 'Last week' : monthOf(R.prev.start)) + ' came to ' + fx(R.prev.allHome, 0) + ' kWh' +
              (M.hasCost ? ', about ' + this._money(R.prev.allCost, 0) : '') + '.';
          }
        } else if (!R.has) {
          lede = 'No history for ' + when.replace(/^in /, '') + '.';
        } else {
          lede = 'Used <em>' + fx(R.home, 0) + ' kWh</em> ' + when + ', ' + cmp + (M.hasCost ? ', ' + this._money(R.cost, 0) : '') + '.';
        }
        if (R.typ.home <= 0) lede = 'Learning your usual: there isn’t a day of history yet.';
        var self = this;
        var stats = rings.map(function (r) {
          var unit = r.key === 'cost' ? '' : r.key === 'water' || r.key === 'gas' ? esc(unitOf(h, M.src[r.key].ids[0])) : 'kWh';
          var val = r.key === 'cost' ? self._money(r.v, 2) : (r.key === 'water' || r.key === 'gas' ? fx(r.v, 0) : kwh(r.v));
          // a week's or a month's usual cost in whole dollars: "$344.89" does not fit a third of the card
          var typ = r.key === 'cost' ? self._money(r.typ, p === 'day' ? 2 : 0) : fx(r.typ, 0);
          var mid = r.key === 'energy' ? (M.total.stat || M.src.imp[0]) : r.key === 'cost' ? (M.src.cost[0] || M.total.cost) : r.key === 'solar' ? M.src.solar[0] : M.src[r.key].ids[0];
          return '<div class="stat"' + moreAttr(mid) + '><div class="k"><i style="background:' + r.c + '"></i>' +
            ({ energy: 'Energy', cost: 'Cost', solar: 'Solar', water: 'Water', gas: 'Gas' })[r.key] +
            '</div><div class="big num">' + val + (unit ? '<u>' + unit + '</u>' : '') + '</div><div class="of">of a typical ' + typ + '</div></div>';
        }).join('');
        // THE PERIOD BEFORE: yesterday by this time, last week, the 30 days before
        var D2 = x.D, ax = R.ax, nd = ax.d.length, prev = null;
        if (p === 'day') {
          var yH = R.hYday.map(function (i) { return homeAt(M, D2.h, i); }), yC = R.hYday.map(function (i) { return costAt(M, D2.h, i); });
          var yT = sum(yH), byNow = R.share;
          prev = { name: 'Yesterday by Now', home: yT * byNow, cost: sum(yC) * byNow, all: 'All of yesterday: ' + fx(yT, 1) + ' kWh' };
        } else if (R.prev && R.prev.has) {
          // the week or month before: as far into it as this one has gone, or whole
          var pname = R.cur ? (p === 'week' ? 'Last Week by Now' : 'Last Month by Now') : (p === 'week' ? 'The Week Before' : monthOf(R.prev.start));
          prev = { name: pname, word: R.cur ? 'last ' + wk + ' by now' : p === 'week' ? 'the week before' : monthOf(R.prev.start),
                   home: R.prev.home, cost: R.prev.cost,
                   all: R.prev.byNow ? 'All of ' + (p === 'week' ? 'last week' : monthOf(R.prev.start)) + ': ' + fx(R.prev.allHome, 0) + ' kWh' : '' };
        }
        var cmpHtml = '';
        if (prev) {
          var dpct = prev.home > 0 ? Math.round(100 * (R.home - prev.home) / prev.home) : 0;
          cmpHtml = '<div class="wide cmp"><div class="mh">Compared With</div>' +
            '<div><div class="k">' + esc(prev.name) + '</div><div class="big num">' + kwh(prev.home) + '<u>kWh</u></div>' +
            '<div class="of">' + (M.hasCost ? this._money(prev.cost, p === 'day' ? 2 : 0) + (prev.all ? ' \u00b7 ' : '') : '') + esc(prev.all) + '</div></div>' +
            '<div><div class="k">' + (p === 'day' ? 'Today So Far' : esc(titleOf(p, R.back, R.start, tz))) + '</div><div class="big num">' + (dpct > 0 ? '+' : '') + dpct + '<u>%</u></div>' +
            '<div class="of">' + (Math.abs(dpct) < 5 ? 'About the same' : (dpct > 0 ? 'More than ' : 'Less than ') + esc(prev.word || prev.name.toLowerCase())) + '</div></div></div>';
        }
        var tick = p !== 'day' && R.cur ? R.days / R.n : 0;
        this._paint('<div class="hw"><div class="hm"><div class="rh">' + ringSvg(rings, M.total.stat || M.src.imp[0], tick) + '<div><div class="lede">' + lede + '</div>' +
          '<div class="stats" style="--n:' + rings.length + '">' + stats + '</div></div></div></div>' + cmpHtml + '</div>');
        this._animateRings(p);
      }
      // A READING OPENS WHAT IT IS: Today's Cost the whole home's power, a
      // thermostat the screen's Climate page (`climate_path`) or its sheet,
      // anything else its sheet -- what the readings row's tiles did
      _bindReads(M) {
        var self = this, top = (M.P.top || []);
        this._card.querySelectorAll('.reads .stat').forEach(function (el) {
          if (el._hkBound) return;
          el._hkBound = true;
          el.style.cursor = 'pointer';
          el.addEventListener('click', function (e) {
            e.stopPropagation();
            var t = top[Number(el.getAttribute('data-r'))] || {}, cfg = self._config || {};
            if (t.kind === 'climate' && cfg.climate_path) {
              self._act({ action: 'navigate', navigation_path: cfg.climate_path }, false);
              return;
            }
            var id = t.kind === 'cost' ? (M.total.power || M.total.stat) : t.entity;
            if (id) window.hkShell.moreInfo(id, self);
          });
        });
      }
      // THE RINGS SWEEP IN, as the Activity rings do: from the top, clockwise,
      // all together, easing out over ~0.8 s, and a ring past full laps itself
      // after its first turn. On a new tab (or the first time) from nothing; on
      // an update while the tab is open, from where each was. Reduce Motion:
      // the finished rings.
      _animateRings(p) {
        this._ringWas = sweepRings(this._card, this._ringWas, this._ringTab !== p);
        this._ringTab = p;
      }
    }
    // (the hero's rings and the screensaver's: `was` each arc's length last
    // time, `fresh` from nothing; returns the lengths for next time)
    function sweepRings(root, was, fresh) {
      var arcs = root.querySelectorAll('circle.arc');
      was = was || {};
      var still = !arcs.length || !arcs[0].animate ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      var D = window.hkCards && window.hkCards.DUR, E = window.hkCards && window.hkCards.EASE;
      var next = {}, SWEEP = (D && parseFloat(D.ring) * 1000) || 850, EASE = (E && E.build) || 'cubic-bezier(.22,.8,.25,1)';
      for (var i = 0; i < arcs.length; i++) {
        var a = arcs[i], k = a.getAttribute('data-k'), c = Number(a.getAttribute('data-c')), to = Number(a.getAttribute('data-len'));
        var lap = a.classList.contains('lap'), from = fresh ? 0 : (was[k] != null ? was[k] : to);
        next[k] = to;
        if (still || Math.abs(to - from) < 0.5) continue;
        // a lap starts when its ring has come round once; on an update, at once
        var delay = lap && fresh ? SWEEP * 0.85 : 0, dur = lap && fresh ? Math.max(250, SWEEP * 0.6 * to / c + 200) : (fresh ? SWEEP : 500);
        a.animate([{ strokeDasharray: from + ' ' + c, strokeOpacity: 1 }, { strokeDasharray: to + ' ' + c, strokeOpacity: 1 }],
                  { duration: dur, delay: delay, easing: EASE, fill: 'backwards' });
      }
      return next;
    }

    // ------------------------------------------------------------ highlights
    class HkEnergyHighlightsCard extends HkEnergyBase {
      static get PART_CSS() {
        return [
          'hk-plate.ep.hl{--hk-ep-h:320px;padding:6px 22px;display:grid;grid-template-rows:repeat(4,minmax(0,1fr))}',
          // THE TEXT CENTERED ON ITS ICON, however many lines (2026-10-13, the
          // user's call: centered on the first line, two lines read as pushed down)
          '.hli{display:grid;grid-template-columns:32px minmax(0,1fr);gap:12px;align-content:center;align-items:center;',
          '  border-top:1px solid ' + window.hkCards.v('line') + '}',
          '.hli:first-child{border-top:0}',
          '.hli .ic{width:32px;height:32px;border-radius:50%;display:grid;place-items:center}',
          '.hli .ic svg{width:18px;height:18px}',
          '.hli .tx{font-size:15px;font-weight:500;line-height:20px;color:' + window.hkCards.v('ink-2') + ';',
          '  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}',
          '.hli .tx b{color:' + window.hkCards.v('ink') + ';font-weight:600}',
          '@media (max-width:' + window.hkCards.BP.phone + 'px){hk-plate.ep.hl{--hk-ep-h:380px}}'
        ].join('');
      }
      _render() {
        this._shell('hl');
        var x = this._data();
        if (x.wait) return this._paint('<div class="wait">Loading…</div>');
        var self = this, list = x.M.highlights ? highlights(x.M, x.R, this.client, function (a, d) { return self._money(a, d); }) : [];
        this._paint(list.map(function (it) {
          return '<div class="hli"' + moreAttr(it.more) + (it.sec ? ' data-sec="' + esc(it.sec) + '"' : '') + '><div class="ic" style="background:' + rgba(it.c, 0.14) + ';color:' + it.c +
            '"><svg viewBox="0 0 24 24">' +
            it.ic + '</svg></div><div class="tx">' + it.t + '</div></div>';
        }).join(''));
        var self = this;
        this._card.querySelectorAll('[data-sec]').forEach(function (el) {
          if (el._hkSec) return;
          el._hkSec = true;
          el.style.cursor = 'pointer';
          el.addEventListener('click', function (e) { e.stopPropagation(); setPick(el.getAttribute('data-sec')); self.redraw(); });
        });
      }
    }

    // ------------------------------------------------------- where it went
    class HkEnergyWhereCard extends HkEnergyBase {
      static get PART_CSS() {
        return [
          // ITS HEIGHT FOLLOWS ITS KEY, which is the same on every tab (the
          // sections never change with it), so it still never shifts
          'hk-plate.ep.where{height:auto;min-height:' + window.hkCards.TILE.tall + 'px}',
          '.bar{display:flex;height:24px;border-radius:8px;overflow:hidden;margin:14px 0 16px;gap:2px;background:' + window.hkCards.v('key') + ';flex:none}',
          '.bar i{display:block;height:100%;min-width:2px;cursor:pointer;transition:opacity .2s}',
          '.chips{display:flex;justify-content:space-between;gap:10px 18px;flex-wrap:wrap}',
          '.chip{display:grid;grid-template-columns:10px minmax(0,1fr);column-gap:8px;align-items:center;font-size:14px;font-weight:600;',
          '  line-height:18px;cursor:pointer;min-width:0;border:0;background:none;color:inherit;font-family:inherit;padding:0;text-align:left;',
          '  -webkit-tap-highlight-color:transparent;transition:opacity .2s}',
          '.chip i{width:10px;height:10px;border-radius:3px}',
          '.chip em{font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.chip span{grid-column:2;font-size:13px;font-weight:500;color:' + window.hkCards.v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
          '@container (max-width:1060px){.chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}}',
          '@container (max-width:520px){.chips{grid-template-columns:repeat(2,minmax(0,1fr))}.ttl span{display:none}}'
        ].join('');
      }
      _render() {
        this._shell('where');
        var x = this._data(), p = period(), self = this;
        if (x.wait) return this._paint('<div class="wait">Loading…</div>');
        var M = x.M, R = x.R, h = this.client, rows, rest, total, fmt;
        if (p === 'now') {
          rows = M.devs.filter(function (d) { return d.counted && d.power; })
            .map(function (d) { return { d: d, v: Math.max(0, wattsNow(h, d.power) || 0) }; });
          var tw = wattsNow(h, M.total.power), on = sum(rows.map(function (r) { return r.v; }));
          rest = tw != null ? Math.max(0, tw - on) : 0;
          total = tw != null ? tw : on;
          fmt = function (z) { return watts(z).join(' '); };
        } else {
          rows = R.counted.map(function (r) { return { d: r.d, v: r.v }; });
          rest = R.untracked; total = R.home;
          fmt = function (z) { return kwh(z) + ' kWh'; };
        }
        var parts = [];
        M.sections.forEach(function (s) {
          rows.filter(function (r) { return r.d.sec === s && r.v > 0; }).sort(function (a, b) { return b.v - a.v; })
            .forEach(function (r, i) { parts.push({ s: s, v: r.v, n: r.d.name, a: i % 2 ? 0.72 : 1 }); });
        });
        var all = sum(parts.map(function (q) { return q.v; })) + rest || 1;
        var secs = M.sections.map(function (s) {
          return { s: s, v: sum(parts.filter(function (q) { return q.s === s; }).map(function (q) { return q.v; })) };
        }).filter(function (q) { return q.s.items.some(function (it) { return it.counted; }); });
        // A SECTION LOOKED AT (2026-10-16, the user: a tap re-drew the whole
        // page and, with a listener added on every paint, toggled itself back
        // off -- "not at all on month"): hover, focus or a tap lights it in
        // THIS card and says it in the title row; a second tap, or a tap
        // elsewhere on the card, lets it go. Nothing else on the page redraws.
        // (A section a highlight lit for the page, EP.pick, still shows.)
        var look = this._look && secs.some(function (q) { return q.s.id === self._look; }) ? this._look : null;
        var lit = function (s) { return look ? look === s.id : !EP.pick || EP.pick === s.id; };
        var head = p === 'now' ? 'Where it’s going now' : 'Where it went';
        var sumText = fmt(total) + (p === 'now' ? '' : ' ' + whenOf(p));
        // what a looked-at section says: its share, and what in it used the most
        this._say = function (id) {
          var q = secs.filter(function (z) { return z.s.id === id; })[0];
          if (!q) return sumText;
          var top = parts.filter(function (z) { return z.s === q.s; })[0];
          return q.s.name + ' · ' + fmt(q.v) + ' · ' + fx(100 * q.v / all, 0) + '%' + (top && top.n ? ' · most: ' + top.n : '');
        };
        this._paint('<div class="ttl"><b>' + head + '</b><span class="num rdw" aria-live="polite">' + esc(look ? this._say(look) : sumText) + '</span></div>' +
          '<div class="bar gwipe">' + parts.map(function (q) {
            return '<i data-sec="' + esc(q.s.id) + '" data-a="' + q.a + '" title="' + esc(q.n) + ': ' + fmt(q.v) + '" style="flex:' + q.v + ' 1 0;background:' + q.s.color +
              ';opacity:' + (lit(q.s) ? q.a : 0.28) + '"></i>';
          }).join('') + (rest > 0 ? '<i data-a="1" title="Not on a device" style="flex:' + rest + ' 1 0;background:' + REST + ';opacity:' + (look ? 0.28 : 1) + '"></i>' : '') + '</div>' +
          '<div class="chips">' + secs.map(function (q) {
            return '<button class="chip' + (lit(q.s) ? '' : ' dim') + '" data-sec="' + esc(q.s.id) + '" aria-pressed="' + (look === q.s.id) + '"><i style="background:' + q.s.color + '"></i><em>' +
              esc(q.s.name) + '</em><span>' + fmt(q.v) + ' · ' + fx(100 * q.v / all, 0) + '%</span></button>';
          }).join('') + (rest > 0 || p !== 'now' ? '<span class="chip' + (look ? ' dim' : '') + '"><i style="background:' + REST + '"></i><em>Not on a device</em><span>' +
            fmt(rest) + ' · ' + fx(100 * rest / all, 0) + '%</span></span>' : '') + '</div>');
        this._sumText = sumText;
        if (this._wired) return;
        // ONE SET OF LISTENERS, on the card, for every paint to come
        this._wired = true;
        var card = this._card, hov = null;
        var secOf = function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-sec]') : null; return t ? t.getAttribute('data-sec') : null; };
        // light one section in place: the bar's parts and the chips, and the line
        var show = function (id) {
          card.querySelectorAll('.bar i').forEach(function (el) {
            el.style.opacity = !id || el.getAttribute('data-sec') === id ? el.getAttribute('data-a') : '0.28';
          });
          card.querySelectorAll('.chip').forEach(function (el) { el.classList.toggle('dim', !!id && el.getAttribute('data-sec') !== id); });
          var sp = card.querySelector('.rdw');
          if (sp) sp.textContent = id ? self._say(id) : self._sumText || '';
        };
        var settle = function () { show(hov || self._look); if (!hov && !self._look) self.redraw(); };
        card.addEventListener('pointerover', function (e) {
          if (e.pointerType !== 'mouse') return;
          var id = secOf(e);
          if (id && id !== hov) { hov = id; show(id); }
        });
        card.addEventListener('pointerout', function (e) {
          if (e.pointerType !== 'mouse' || !hov) return;
          var to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-sec]') : null;
          if (!to) { hov = null; settle(); }
        });
        card.addEventListener('focusin', function (e) { var id = secOf(e); if (id) show(id); });
        card.addEventListener('focusout', function () { settle(); });
        card.addEventListener('click', function (e) {
          var id = secOf(e);
          e.stopPropagation();
          // a section lit for the page by a highlight: a tap here lets it go
          if (EP.pick) { setPick(EP.pick); return; }
          self._look = id && self._look !== id ? id : null;
          hov = null;
          self.redraw();
        });
      }
    }

    // what the shell and the later parts use of this one
    K.bindMore = bindMore; K.EP_CSS = EP_CSS; K.HkEnergyBase = HkEnergyBase; K.HkEnergyHeroCard = HkEnergyHeroCard;
    K.HkEnergyHighlightsCard = HkEnergyHighlightsCard; K.HkEnergyPeriodCard = HkEnergyPeriodCard;
    K.HkEnergyWhereCard = HkEnergyWhereCard; K.lineSvg = lineSvg; K.moreAttr = moreAttr; K.ringSvg = ringSvg;
    K.slotName = slotName; K.sweepRings = sweepRings; K.timeLabels = timeLabels;
  };
})();
