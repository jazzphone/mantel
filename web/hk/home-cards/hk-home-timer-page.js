// hk-home-timer-page.js - the timers page and the timer strip.
//
// PART OF THE HOME CARDS (hk-home.js). Not a card and not run on its own: it registers one
// function, which hk-home.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkHomeParts = window.hkHomeParts || {})['hk-home-timer-page'] = function (K) {
    var button = K.button, create = K.create, feed = K.feed, HkBase = K.HkBase, M = K.M, NO_HELPERS = K.NO_HELPERS,
        setting = K.setting;

    // =========================================================== timers page
    // THE TIMERS PAGE ON ONE PAGE: what is running and the creator side by
    // side, the creator on the right. Two columns:
    //
    //   left   Quick start (six one-tap presets), Running (hk-timers-card in
    //          its `fit` shape: two full cards, then compact ones, then pages
    //          of six swiped sideways), and the House timers that are idle
    //   right  the New Timer panel (hk-timer-new-card, `layout: panel`)
    //
    // THE BOTTOMS LINE UP. The row stretches both columns to the taller one;
    // the House timers are pinned to the bottom of the left column and Start
    // to the bottom of the panel, so the last pill and the Start button end on
    // the same line whatever is running.
    //
    // A HOST. The running grid and the creator are cards of their own
    // (their countdowns, their slot allocation and their status messages);
    // this lays them out and hands them the client. The one thing it
    // does itself is the Quick start row, which answers the way the
    // keypad does -- a bare script call would say nothing when all four
    // slots are busy.
    //
    // PHONE: one column -- Running, Quick start, the creator, House timers.
    // iPAD UPRIGHT: one column in the tablet's order, the creator last and wide.
    class HkTimersPageCard extends HkBase {
      static get CSS() {
        return [
          ':host{display:block}',
          '.pg{display:grid;grid-template-columns:minmax(0,1fr) 420px;column-gap:28px;align-items:stretch}',
          '.main{display:flex;flex-direction:column;min-width:0}',
          '.side{display:flex;flex-direction:column;min-width:0}',
          '.side > *{flex:1 1 auto;display:block}',
          '.s-run{margin-top:16px}',
          // pinned to the bottom of the column: see the class comment
          '.s-house{margin-top:auto;padding-top:16px}',
          '.s-house[hidden]{display:none}',
          // a heading, with the Quick start row's status line beside it
          '.hrow{display:flex;align-items:baseline;gap:12px}',
          '.hrow .head{flex:0 0 auto}',
          '.hrow .hk-status{flex:1;min-width:0;text-align:right;margin:0 4px 10px 4px}',
          '.qs{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}',
          '.qk{height:56px;border-radius:18px;' + M.glass + ';border:' + M.border + ';box-shadow:' + M.shSm + ';',
          '  display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:650;',
          '  letter-spacing:-0.3px;color:' + window.hkCards.v('ink') + ';cursor:pointer;user-select:none;',
          '  -webkit-tap-highlight-color:transparent;transition:transform .12s ease}',
          '.qk:active{transform:scale(0.96)}',
          '.qk[aria-disabled="true"]{opacity:0.45;pointer-events:none}',
          // the house's own pill and gap (hk-base.js TILE), as on every room page
          '.hgrid{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));gap:' + window.hkCards.TILE.gridGap + 'px}',
          // STACKED (`data-stack`, below STACK_W of the card's OWN width, not
          // the window's -- an iPad held upright, and a wall tablet with the
          // menu docked, whose page is an iPad's): ONE COLUMN, the tablet's
          // order -- Quick start, Running, House timers -- then the New Timer
          // panel across the width under them (it lays itself out in two
          // columns, `data-wide`). Beside a 420 px panel the left column would
          // be ~258 px at 744, and six running timers 75 px wide with
          // "2:29:58" spilling out of them. Full width, three across at ~227.
          ':host([data-stack]) .pg{grid-template-columns:minmax(0,1fr)}',
          ':host([data-stack]) .s-house{margin-top:0}',
          ':host([data-stack]) .side{margin-top:22px}',
          '@media (max-width:' + window.hkCards.BP.phone + 'px){  .pg{display:flex;flex-direction:column;gap:18px}  .main{display:contents}',
          '  .s-run{order:1;margin:0}.s-qs{order:2}.side{order:3}.s-house{order:4;margin:0;padding:0}',
          '  .qs{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
          '  .hgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
          '}',
          '@media (prefers-reduced-motion: reduce){.qk,.qk:active{transition:none;transform:none}}'
        ].join('');
      }
      _onConfig() { this._built = false; this._tiles = {}; }
      // (Flat Light's lit color, Apple's light orange, as every lit well's:
      // hk-base flatColor; unchanged in the other looks)
      _tint() { return window.hkCards.flatColor(this._config.tint || 'rgba(255, 159, 10, 0.95)', 'well'); }
      _presets() { return this._config.presets || [5, 10, 15, 20, 30, 60]; }
      // THE HOUSE TIMERS: the card's own `house:` list, else Configure -> Your
      // home -> House timers -- each named as its accessory is, else its friendly name less
      // "- Timer", and pictured as its accessory, else as the timer is.
      _house() {
        if (Array.isArray(this._config.house)) return this._config.house;
        var h = this.client, ids = setting('features.house_timers') || [];
        var A = setting('accessories') || {}, E = A.entities || {};
        var dash = ''; try { dash = String(location.pathname).split('/')[1] || ''; } catch (e) { /* a test */ }
        return ids.filter(function (id) { return !h || (h.states && h.states[id]); }).map(function (id) {
          var st = h && h.states[id], a = E[id] || {}, at = (st && st.attributes) || {};
          var ent = (h && h.entities && h.entities[id]) || {};
          var nm = (a.names && a.names[dash]) || a.name ||
                   String(at.friendly_name || id).replace(/\s*[-\u2013]?\s*timer\s*$/i, '') || id;
          var ic = a.icon || ent.icon || at.icon || 'mdi:timer-outline';
          return { entity: id, name: nm, icon: /^mdi:/.test(ic) && a.icon ? 'hk:' + ic.slice(4) : ic };
        });
      }
      // Only the House timers' states: the running grid and the creator gate
      // their own renders.
      _sigOf() {
        var h = this.client;
        if (!h) return null;
        return this._house().map(function (t) {
          var st = h.states[t.entity];
          return t.entity + '=' + (st ? st.state : 'x');
        }).join(';');
      }
      // EACH NEW CLIENT (either entry of HkBase), then the cards this one hosts.
      _receiveClient() {
        super._receiveClient();
        var self = this, client = this.client;
        [this._run, this._new].forEach(function (c) { if (c) feed(c, client); });
        Object.keys(this._tiles || {}).forEach(function (k) { feed(self._tiles[k], client); });
      }
      static label(mins) {
        return mins < 60 ? mins + ' min' : (mins % 60 ? Math.floor(mins / 60) + ' hr ' + (mins % 60) + ' min' : (mins / 60) + ' hr');
      }
      static hms(mins) {
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return p(Math.floor(mins / 60)) + ':' + p(mins % 60) + ':00';
      }
      // ONE TAP, ONE TIMER -- and an answer. The allocator returns {started,
      // slot} or {started: false, reason}; see helpers/quick_timers.yaml.
      _quick(mins) {
        var label = HkTimersPageCard.label(mins), self = this;
        if (!this.client) return;
        var ent = this._config.quick_script || 'script.quick_timer_start';
        var parts = ent.indexOf('.') === -1 ? ['script', ent] : ent.split('.');
        if (!this.client.states[parts.join('.')]) {   // the helpers are not installed
          this._setStatus('failed', NO_HELPERS());
          this._render();
          return;
        }
        if (!this._begin('Starting ' + label + '…')) return;
        this._callResp(parts[0], parts[1], { duration: HkTimersPageCard.hms(mins) }).then(function (r) {
          self._end();
          if (!r.ok) self._setStatus('failed', 'Could not reach Home Assistant.');
          else if (r.response && r.response.started === false) self._setStatus('warn', 'Too many timers are running.');
          else self._setStatus('sent', 'Started a ' + label + ' timer.', 4000);
          self._render();
        });
      }
      _build() {
        var self = this, c = this._config;
        this._root.innerHTML = '';
        var pg = document.createElement('div'); pg.className = 'pg';
        var main = document.createElement('div'); main.className = 'main';

        var sqs = document.createElement('div'); sqs.className = 's-qs';
        var hr = document.createElement('div'); hr.className = 'hrow';
        var h1 = document.createElement('div'); h1.className = 'head'; h1.textContent = 'Quick start';
        hr.appendChild(h1); hr.appendChild(this._statusNode());
        sqs.appendChild(hr);
        var qs = document.createElement('div'); qs.className = 'qs';
        this._presets().slice(0, 6).forEach(function (m) {
          var k = document.createElement('div');
          k.className = 'qk';
          k.textContent = HkTimersPageCard.label(m);
          k.setAttribute('aria-label', 'Start a ' + HkTimersPageCard.label(m) + ' timer');
          button(k, function () { self._quick(m); });
          qs.appendChild(k);
        });
        sqs.appendChild(qs);
        main.appendChild(sqs);

        // The heading is the running card's own, so its page dots can sit in it.
        var srun = document.createElement('div'); srun.className = 's-run';
        this._run = create({ type: 'custom:hk-timers-card', fit: true, heading: 'Running', tint: this._tint(),
                             empty_text: c.empty_text || 'Nothing is running.', timers: c.timers || [] });
        srun.appendChild(this._run);
        main.appendChild(srun);

        var sh = document.createElement('div'); sh.className = 's-house';
        var h3 = document.createElement('div'); h3.className = 'head'; h3.textContent = 'House timers';
        sh.appendChild(h3);
        this._hgrid = document.createElement('div'); this._hgrid.className = 'hgrid';
        sh.appendChild(this._hgrid);
        main.appendChild(sh);
        this._shouse = sh;

        var side = document.createElement('div'); side.className = 'side';
        this._new = create({ type: 'custom:hk-timer-new-card', layout: 'panel', tint: this._tint(),
                             create_script: c.create_script || 'script.quick_timer_create',
                             name_chips: c.name_chips || [] });
        side.appendChild(this._new);

        pg.appendChild(main); pg.appendChild(side);
        this._root.appendChild(pg);
        this._built = true;
        if (this.client) { feed(this._run, this.client); feed(this._new, this.client); }
      }
      // The House timers that are IDLE, in order -- a running one is a card
      // in Running instead, never both (the conditions are complements).
      // `timer.start` with no duration runs its configured one.
      _paintHouse() {
        var self = this, h = this.client;
        var idle = this._house().filter(function (t) { var st = h && h.states[t.entity]; return st && st.state === 'idle'; });
        var want = idle.map(function (t) { return t.entity; }).join('|');
        if (want === this._houseKey) return;
        this._houseKey = want;
        this._hgrid.innerHTML = '';
        idle.forEach(function (t) {
          var el = self._tiles[t.entity];
          if (!el) {
            el = self._tiles[t.entity] = create({
              type: 'custom:hk-tile-card', entity: t.entity, name: t.name, icon: t.icon,
              icon_color: 'orange', label_mode: 'duration',
              tap_action: { action: 'perform-action', perform_action: 'timer.start', target: { entity_id: t.entity } }
            });
            feed(el, h);
          }
          self._hgrid.appendChild(el);
        });
        this._shouse.hidden = !idle.length;
      }
      _render() {
        if (!this._config) return;
        if (!this._built) this._build();
        var busy = !!this._busy;
        Array.prototype.forEach.call(this._root.querySelectorAll('.qk'), function (k) {
          k.setAttribute('aria-disabled', busy ? 'true' : 'false');
        });
        this._paintHouse();
        this._shape();
      }
      // STACK BY THE CARD'S OWN WIDTH (see `data-stack` in the CSS), measured
      // rather than asked of a media query, which only knows the window: a
      // 1,280 px tablet with the menu docked has a 980 px page and stacks as
      // an iPad does. The phone keeps its own layout (the 640 px media query).
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        if (!this._ro && typeof ResizeObserver === 'function') {
          this._ro = new ResizeObserver(function () { self._shape(); });
        }
        if (this._ro) this._ro.observe(this);
        this._shape();
      }
      disconnectedCallback() {
        if (this._ro) this._ro.disconnect();
        if (super.disconnectedCallback) super.disconnectedCallback();
      }
      _shape() {
        var w = this.getBoundingClientRect ? this.getBoundingClientRect().width : 0;
        if (!w) return;
        var stack = w < HkTimersPageCard.STACK_W && (window.innerWidth || 1280) > 640;
        var flip = function (el, name, on) {
          if (!el || on === el.hasAttribute(name)) return;
          if (on) el.setAttribute(name, ''); else el.removeAttribute(name);
        };
        flip(this, 'data-stack', stack);
        // the New Timer panel goes wide (keypad beside its name and chips) only
        // where that fits: a section of someone else's dashboard can stack the
        // page at 352 px, where the wide panel crushed its readout -- there it
        // keeps its own one-column shape, as beside the running timers
        flip(this._new, 'data-wide', stack && w >= 640);
      }
      getCardSize() { return 12; }
    }

    // ------------------------------------------------------ hk-timer-strip
    // A HOST, not a card: hk-timers.js owns the markup and the countdown, and
    // this hands it the running list and three presentation flags.
    //
    // THE COUNTDOWN CANNOT BE A RENDERED VALUE. A running timer changes state
    // exactly twice -- at start and at finish -- and everything between is the
    // wall clock moving, which the client never reports. So the number is a
    // <hk-countdown> element that owns its own repaint; this only supplies a
    // deadline. See hk-timers.js.
    //
    // No script injection and no forced update: the module is in hk-loader's
    // list, and HkBase re-renders on signature change.
    class HkTimerStripCard extends HkBase {
      // The one-shot hk-timers-ready listener, held only while attached: a
      // strip detached before the module arrives would otherwise keep the
      // listener -- and itself -- until hk-timers.js loads, then redraw a card
      // nobody can see. Re-attaching before the module lands wires it again.
      _wire() {
        if (window.hkTimers || this._onTimersReady) return;
        var self = this;
        this._onTimersReady = function () {
          self._unwire();
          self.redraw();
        };
        window.addEventListener('hk-timers-ready', this._onTimersReady);
      }
      _unwire() {
        if (!this._onTimersReady) return;
        window.removeEventListener('hk-timers-ready', this._onTimersReady);
        this._onTimersReady = null;
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this._built) this._wire();
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        this._unwire();
      }
      static get CSS() {
        // (Large's rules and Extra Large's, 2026-11-07: a selector list over both)
        var lx = (sel, body) => ':host([size=L]) ' + sel + ',:host([size=XL]) ' + sel + '{' + body + '}';
        return [
          'hk-plate.strip{background:none;box-shadow:none;border:none;  padding:0;margin:0;display:block}',
          // The screensaver's row is wrapped in a position:fixed div by strip()
          // itself, so its host must take no space and must not clip.
          'hk-plate.strip.fixed{height:0;overflow:visible}',
          '.strip > div{min-width:0;overflow:hidden}',
          // EACH RUNNING TIMER IS ONE PIECE (mockup 5, approved 2026-11-09, "Proposed -- three running"): its name over its ring -- time left in
          // orange round its track, the time INSIDE it in light, tabular numbers -- and right under the ring two round keys, Pause (Resume)
          // and the red Stop, side by side. The ring is no longer the pause key: it is drawn, not a button. The keys are 56 px targets
          // (44 on screen) 8 px apart, the disc drawn smaller inside. Extra Large three timers across, Large two, Tall one ("+N more"
          // under it), Wide two with the keys BESIDE each ring (stacked), Small the ring alone: the block's tap opens the Timers page.
          // None running, quick starts as keys and an orange + (below). Tile cells first, a square cell's sizes after.
          ':host([size]) hk-plate.strip{position:relative;display:flex;flex-direction:column;justify-content:center;gap:8px;box-sizing:border-box;',
          '  height:100%;padding:' + window.hkCards.blockPad('14px') + ';' + window.hkCards.plate('card') + ';overflow:hidden;--ring:96px}',
          '.strip > div.tg{overflow:visible}.tg{display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));grid-auto-rows:minmax(0,1fr);align-content:center;' +
            'gap:var(--rg,8px) var(--hk-pad-l,18px);flex:1 1 auto;min-height:0}',
          '.gt{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;min-height:0}',
          // THE TIMER'S TITLE (2026-11-09, the owner: "We don't need the word Timer as a title, it should go. Title of the timer itself, yes, it needs to [match] the rest of the title/headings."): a
          // named timer's name in the block heading (hkCards.headCss: gray, 13 / 600) on the heading row; a timer with no name of its own has no title -- its row stays, so the rings line up (mockup
          // 5) -- and the block's own name ("Timers") is never printed
          window.hkCards.headRowCss('.gt .hd') + '.gt .hd{height:22px;margin-bottom:8px;justify-content:center;align-self:stretch}' + window.hkCards.headCss('.gt .nm') +
          // (READABLE FROM ACROSS THE ROOM, 2026-11-09, the owner: "The text above the active timers should probably be bigger right? And so should the
          // time inside the circle. It needs to be readable"): the name 17 / 600 in the first ink, not the 13 px gray heading; the time 25 % of the ring
          // in a medium weight (it was 21 % light), an hour or more (h:mm:ss, seven figures) 19 % so it stays inside the ring
          '.gt .nm{font-size:17px;line-height:22px;font-weight:600;color:' + window.hkCards.v('ink') + '}',
          '.gt .rg{display:flex;flex-direction:column;align-items:center;gap:8px;flex:none}',
          '.gt .rw{position:relative;flex:none;width:var(--ring);height:var(--ring);display:grid;place-items:center}',
          // (the countdown is the ring's child: it writes the fraction left, --hk-left, on the ring, and the circle reads it)
          '.gt .rw svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}',
          '.gt .rw circle{fill:none;stroke-width:8px;stroke:' + window.hkCards.v('line-strong') + '}',
          '.gt .rw .left{stroke:' + window.hkCards.ACCENTS.orange + ';stroke-linecap:round;stroke-dasharray:calc(var(--hk-left,1)*100) 100}',
          '.gt.hr .rw hk-countdown{font-size:calc(var(--ring) * 0.19)}.gt .rw hk-countdown{position:relative;display:block;font-size:calc(var(--ring) * 0.25);font-weight:500;letter-spacing:-0.02em;' +
            'line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;color:' + window.hkCards.v('ink') + '}',
          '.gt.held .rw hk-countdown{color:' + window.hkCards.v('ink-2') + '}',
          // KEYS A FINGER CAN HIT (2026-11-09, mockup 14b, the owner: "should the touch services for the timers be easier for a finger to hit? The same small and close together"): 52 px discs in 56
          // px targets, 14 px between the discs -- the targets 10 px clear of each other
          '.gt .kk{display:flex;gap:10px;flex:none}',
          '.gt .pr,.gt .stop{all:unset;box-sizing:border-box;position:relative;flex:none;width:56px;height:56px;display:grid;place-items:center;cursor:pointer;' +
            '-webkit-tap-highlight-color:transparent}',
          '.gt .pr::before,.gt .stop::before{content:"";position:absolute;inset:2px;border-radius:50%;background:' + window.hkCards.v('line-strong') + '}',
          '.gt .stop::before{background:' + window.hkCards.ACCENTS.red + '}',
          '.gt .pr hk-icon,.gt .stop hk-icon{position:relative;width:22px;height:22px;--mdc-icon-size:22px;color:' + window.hkCards.v('ink') + '}.gt .stop hk-icon{color:#fff}',
          '.gt .pr:active::before,.gt .stop:active::before{transform:scale(0.95)}.gt .pr:focus-visible,.gt .stop:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') +
            ';outline-offset:-2px;border-radius:50%}',
          // WIDE: each timer's keys BESIDE its ring, stacked (mockup 5)
          // (a tile cell's Wide is 117 px inside its inset, the two keys stacked 120: the name sits over the ring alone, the keys span the unit's height and may use the inset's last pixels)
          ':host([size=W]) .gt:not(.idle){display:grid;grid-template-columns:var(--ring) 56px;grid-template-rows:auto auto;column-gap:6px;justify-content:center;align-content:center;' +
            'align-items:center}',
          ':host([size=W]) .gt:not(.idle) .rg{display:contents}:host([size=W]) .gt .hd{grid-column:1;grid-row:1}:host([size=W]) .gt .rw{grid-column:1;grid-row:2}',
          // (Wide's keys, 2026-11-09, the owner: "the Pause and stop buttons seem weirdly aligned. They could probably align with the bottom of the
          // ring and the top of the text"): the column spans the name and the ring -- Pause's top on the name's top, Stop's foot on the ring's foot
          ':host([size=W]) .gt:not(.idle) .kk{grid-column:2;grid-row:1 / 3;flex-direction:column;align-self:stretch;justify-content:space-between}',
                  ':host([size=W]) hk-plate.strip{--ring:96px}:host([size=S]) hk-plate.strip{--ring:96px}',
          ':host([size=T]) hk-plate.strip{--ring:128px}:host([size=L]) hk-plate.strip{--ring:136px}:host([size=XL]) hk-plate.strip{--ring:136px}',
          // (a tile cell's block is the smaller: the ring gives way before the keys do)
          '@container hk-cell (max-height:180px) and (not style(--hk-cell-shape: square)){:host([size=S]) hk-plate.strip,:host([size=W]) hk-plate.strip{--ring:84px}}',
          ':host([size=T]) .tg,:host([size=L]) .tg{--rg:10px}',
          // ALWAYS A WAY TO ADD A TIMER (2026-11-09, mockup 14b, the owner: "There needs to be a way to add a timer at all times with these cards."): a plain orange + at the plate's top right on
          // every running size -- a 52 px disc in a 56 px target, 6 px from the edges (the disc is then concentric with the plate's corner), a white plus; it opens the New Timer sheet. Where Extra
          // Large has the maker beside its timers, the maker is the way and there is no +
          '.pl{all:unset;box-sizing:border-box;position:absolute;top:6px;right:6px;z-index:2;width:56px;height:56px;display:grid;place-items:center;cursor:pointer;' +
            '-webkit-tap-highlight-color:transparent}',
          '.pl::before{content:"";position:absolute;inset:2px;border-radius:50%;background:' + window.hkCards.ACCENTS.orange +
            '}.pl hk-icon{position:relative;width:28px;height:28px;--mdc-icon-size:28px;color:#fff}.pl:active::before{transform:scale(0.95)}',
          '.pl:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:-2px;border-radius:50%}',
          // (Small's ring from the left inset to the +'s disc, 60 px in, under the name, never under 84 -- the owner, 2026-11-09: "treat the right edge of the timer where the left edge of the +
          // button is")
          // (...only while a timer runs: with none, "Start a Timer" and its + sit in the middle of the block -- the owner, 2026-11-10)
          ':host([size=S]) hk-plate.strip{--ring:max(84px,min(calc(100cqw - var(--hk-pad-l,14px) - 60px),calc(100cqh - var(--hk-pad-t,14px) - var(--hk-pad-b,14px) - 30px)))}' +
            ':host([size=S]) .gt:not(.idle){justify-content:flex-end;justify-self:start;width:var(--ring)}:host([size=W]) .mf{position:absolute;right:var(--hk-pad-r,14px);' +
            'bottom:var(--hk-pad-b,14px)}',
          '.mf{flex:none;' + window.hkCards.typeCss('caption') + ';color:' + window.hkCards.v('ink-2') + ';text-shadow:' + window.hkCards.v('glow') + '}',
          // NONE RUNNING (2026-11-08, the owner: "the card when no timer is displayed is not good looking at all"): the running timer's own
          // column -- the orange name, a line in the time's light type in place of the time ("Start a timer"), and in place of the ring and
          // Stop the quick starts as rings: each draws its length as the share of an hour its orange arc covers, the length inside, and an
          // orange + for any other. A grid (Tall, Large, Extra Large) fills the block, the rings --k to what it leaves them
          '.qs{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:auto;padding-top:8px}.qs.g{display:grid;grid-template-columns:repeat(var(--qc),var(--k));' +
            'justify-content:center;align-content:center;flex:1 1 auto;margin-top:0}',
          // THE DIRECTION over the preset rings (mockup 5): one line, the headline's size, centered with them as one group
          '.gt.dg{flex:1 1 auto;align-items:center;justify-content:center}.gt.dg .qs.g{flex:none;padding:0;gap:12px}',
          '.gt .dir{display:block;' + window.hkCards.typeCss('headline') + ';line-height:22px;color:' + window.hkCards.v('ink') + ';text-shadow:' + window.hkCards.v('glow') +
            ';text-align:center;white-space:nowrap;margin:0 0 14px}',
          // EXTRA LARGE'S MAKER (mockup 5c): the presets' column on the left, the New Timer card's block layout filling the right
          '.gt.mkr{display:grid;align-items:stretch;grid-template-columns:196px minmax(0,1fr);column-gap:13px;flex:1 1 auto;min-height:0}',
          '.gt.mkr .ql{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0}.gt.mkr .qs.g{flex:none;padding:0;gap:14px}',
          '.gt.mkr .mk{min-width:0;min-height:0;height:100%}',
          // EXTRA LARGE WITH ONE OR TWO RUNNING (mockup 14b): the timers, and the maker beside them -- the New Timer card's block layout, 288-340 px
          '.xm{display:grid;grid-template-columns:minmax(0,1fr) var(--mw,320px);column-gap:13px;align-items:stretch;flex:1 1 auto;min-height:0}.xm .tg{flex:none;min-height:0}.xm .mk{min-width:0;' +
            'min-height:0;height:100%}',
          // LARGE, NOTHING RUNNING (mockup 14b, the owner: "the roller to create a new timer isn't implemented here. I'd like that to be added to the Large and X-Large card as well."): the headline
          // in the UPPER LEFT (DESIGN.md "The headline is the upper left, across the board"; the mockup centered it, the rule wins), four preset rings across in 56 px targets, then the maker -- the
          // wheels, a name where the room allows, Start
          '.gt.idle.lg{align-items:stretch;justify-content:flex-start;gap:8px;flex:1 1 auto}.gt.lg .dir{text-align:left;margin:0}.gt.lg .qs{display:flex;justify-content:space-between;' +
            'align-items:center;gap:0;margin:0;padding:0;flex:none}.gt.lg .mk{flex:1 1 0;min-height:0;min-width:0}',
          '.rk{all:unset;box-sizing:border-box;position:relative;flex:none;width:var(--k);height:var(--k);border-radius:50%;display:grid;place-items:center;cursor:pointer;' +
            '-webkit-tap-highlight-color:transparent}',
          '.rk svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}.rk circle{fill:none;stroke-width:10px;stroke:' + window.hkCards.v('line-strong') + '}',
          '.rk .left{stroke:' + window.hkCards.ACCENTS.orange + ';stroke-linecap:round;stroke-dasharray:var(--a) 100}',
          '.rk b{position:relative;font-size:max(13px,calc(var(--k) * 0.3));font-weight:600;letter-spacing:-0.02em;color:' + window.hkCards.v('ink') + ';font-variant-numeric:tabular-nums}',
          '.rk.add{background:' + window.hkCards.ACCENTS.orange +
            ';color:#fff}.rk.add hk-icon{width:calc(var(--k) * 0.46);height:calc(var(--k) * 0.46);--mdc-icon-size:calc(var(--k) * 0.46)}.rk:active{transform:scale(0.95)}',
          '.rk:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}'
        ].join('');
      }
      getCardSize() { return 1; }
      // (a block's tap, hk-base.js openTarget) the Timers page
      _tapTarget() { return [{ page: 'timers' }]; }
      _gridTap() {
        if (this._tapWired) return;
        this._tapWired = true;
        this._e.addEventListener('click', (e) => {
          var button = e.target.closest('button'); if (!button) return;
          e.stopPropagation();
          if (button.dataset.new !== undefined) { this._newGridTimer(); return; }
          if (button.dataset.preset) {
            var mins = Number(button.dataset.preset);
            this._callResp('script', 'quick_timer_start', { duration: HkTimersPageCard.hms(mins) }).then((r) => {
              if (!r.ok || r.response && r.response.started === false) this._newGridTimer();
            }); return;
          }
          if (button.dataset.timer) this._call('timer', button.dataset.service, { entity_id: button.dataset.timer });
          else { var M = window.hkCards.menu, path = M && M.pagePath('timers'); if (path) window.hkCards.navigate(path, this); }
        });
      }
      // THE EXTRA LARGE MAKER'S CARD: one New Timer card (layout: block), made once and kept, put into the block's place for it
      // whenever that place is drawn; the client handed on each time
      _mountMaker() {
        var mk = this._e && this._e.querySelector('.mk');
        if (!mk) return;
        if (!this._maker) {
          this._maker = window.hkCards.create({ type: 'custom:hk-timer-new-card', layout: 'block',
            name_chips: (window.hkSettings && window.hkSettings.get('headers.timers.names', null)) || undefined });
        }
        if (!this._maker) return;
        if (this._maker.parentNode !== mk) mk.appendChild(this._maker);
        if (mk.hasAttribute('data-noname')) this._maker.setAttribute('data-noname', ''); else this._maker.removeAttribute('data-noname');
        if (this.client && this._maker.hkSetClient) this._maker.hkSetClient(this.client);
      }
      _newGridTimer() {
        var D = window.hkDetail;
        // (the Timers page's own New Timer sheet, 2026-11-09: the sheet is the plate -- no second plate inside it -- and it goes
        // once the timer starts)
        if (D) D.open(null, { name: 'New Timer', icon: 'mdi:timer-plus-outline', icon_color: window.hkCards.ACCENTS.orange }, {
          cards: { cards: [{ type: 'custom:hk-timer-new-card', layout: 'sheet', glass: false, close_on_start: true,
            name_chips: (window.hkSettings && window.hkSettings.get('headers.timers.names', null)) || undefined }] }
        });
      }
      _grid(list, sized) {
        this._watchBlock();
        var states = this.client && this.client.states || {}, T = window.hkTimers, esc = window.hkCards.esc;
        var rows = (list || []).filter((r) => r && r.entity_id).map((r) => ({ id: r.entity_id, name: r.name, attrs: Object.assign({}, r, states[r.entity_id] && states[r.entity_id].attributes),
          state: states[r.entity_id] && states[r.entity_id].state || 'active' }));
        Object.keys(states).filter((id) => /^timer\.(quick|hk_timer)_/.test(id) && states[id].state === 'paused').forEach((id) => {
          if (!rows.some((r) => r.id === id)) rows.push({ id: id, name: states[id].attributes.friendly_name, attrs: states[id].attributes, state: 'paused' });
        });
        rows = rows.filter((r) => r.state === 'paused' || r.attrs.finishes_at && !isNaN(Date.parse(r.attrs.finishes_at)))
          .sort((a, b) => (Date.parse(a.attrs.finishes_at) || Infinity) - (Date.parse(b.attrs.finishes_at) || Infinity));
        var presets = (window.hkSettings && window.hkSettings.get('headers.timers.presets', null)) || [5, 10, 15, 20, 30, 60];
        var short = (m) => m < 60 ? m + 'm' : m % 60 ? Math.floor(m / 60) + 'h' + (m % 60) : m / 60 + 'h';
        var b = this._block(), cs = typeof getComputedStyle === 'function' ? getComputedStyle(this) : null, pd = (k) => cs && parseFloat(cs.getPropertyValue('--hk-pad-' + k)) || 14;
        var iw = b ? b.w - pd('l') - pd('r') : 168, ih = b ? b.h - pd('t') - pd('b') : 286, big = sized === 'T' || sized === 'L' || sized === 'XL';
        // NONE RUNNING: the quick starts (Settings' presets) as rings, + for the rest; nothing stretches (the owner, 2026-11-08) -- each size has its one ring size, as many as it shows, the group
        // centered
        var ring = (m) => '<button class="rk" data-preset="' + Number(m) + '" style="--a:' + Math.min(100, Number(m) * 100 / 60) + '" aria-label="Start a ' + esc(HkTimersPageCard.label(Number(m))) +
          ' timer"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45"></circle><circle class="left" cx="50" cy="50" r="45" pathLength="100"></circle></svg><b>' +
          esc(short(Number(m))) + '</b></button>';
        var plus = '<button class="rk add" data-new aria-label="Create a Timer"><hk-icon icon="mdi:plus"></hk-icon></button>';
        // (the rings as big as the room gives: cols x rows of them under the direction's line, 12 px apart -- 14 on Extra Large's)
        var fitK = (cols, rows, max, w, gap) => Math.max(40, Math.min(max, Math.floor(((w || iw) - (cols - 1) * gap) / cols), Math.floor((ih - 36 - (rows - 1) * gap) / rows)));
        // THE MAKER'S ROWS (the New Timer card's block layout in a place H high): the wheels' row height from what the card's chrome leaves -- its tile's padding (30 px; the tight Large's 18),
        // Start's 56 and the name's 56 with the gaps between -- and the name only where the rows stay readable
        var mkOf = (H, tight) => {
          var padv = tight ? 18 : 30, gap = tight ? 8 : 10, lo = tight ? 18 : 26, rowN = Math.floor((H - padv - 112 - 2 * gap) / 5), named = rowN >= (tight ? 26 : 30),
            row = Math.max(lo, Math.min(40, named ? rowN : Math.floor((H - padv - 56 - gap) / 5)));
          return { named: named, attrs: ' data-keep data-notap' + (named ? '' : ' data-noname') + ' style="--hk-mk-row:' + row + 'px;--hk-mk-fs:' + Math.max(17, Math.round(row * 0.6)) + 'px' +
            (tight ? ';--hk-mk-pad:8px 12px 10px;--hk-mk-gap:8px' : '') + '"' };
        };
        var idle = () => {
          var S = sized;
          // SMALL (2026-11-09, the owner: "The button is getting clipped. Also the font here, doesn't seem to match anything else"): the direction over its one key,
          // the orange + that opens the New Timer sheet; not a "Start a timer" pill wider than the block under "None running" in the countdown's light type
          if (S === 'S') return '<div class="gt idle dg"><span class="dir">Start a Timer</span><div class="qs g" style="--k:' + fitK(1, 1, 72, 0, 12) + 'px;--qc:1">' + plus + '</div></div>';
          // NONE RUNNING (the owner's mockup 5, approved 2026-11-09: "It's not really a heading though, but more of a direction"): "Start a
          // Timer" one line at the body's headline size, right over the preset rings, the two one group centered in the block -- Wide
          // three and +, a row; Tall five and +, two across; Large five and +, three across
          if (S === 'L') {
              var pk = [5, 10, 15, 30].filter((m) => presets.indexOf(m) >= 0), lk = mkOf(ih - 22 - 56 - 16, true);   // (the heading, the 56 px rings, two gaps)
            presets.forEach((m) => { if (pk.length < 4 && pk.indexOf(m) < 0) pk.push(m); });
            return '<div class="gt idle lg"><span class="dir">Start a Timer</span><div class="qs g" style="--k:56px;--qc:4">' + pk.slice(0, 4).map(ring).join('') +
              '</div><div class="mk"' + lk.attrs + '></div></div>';
          }
          if (S !== 'XL') {
            // (Wide and Tall hold three controls at most -- the owner's round three, 2026-11-08: two presets and +)
            var L = { W: [3, 1, 64, 2], T: [1, 3, 72, 2], L: [3, 2, 92, 5] }[S] || [3, 2, 92, 5], k = fitK(L[0], L[1], L[2], 0, 12);
            return '<div class="gt idle dg"><span class="dir">Start a Timer</span><div class="qs g" style="--k:' + k + 'px;--qc:' + L[0] + '">' +
              presets.slice(0, L[3]).map(ring).join('') + plus + '</div></div>';
          }
          // EXTRA LARGE MAKES ONE (mockup 5c, 2026-11-09, "Yes, build it"): the six presets under the direction on the left, and on
          // the right the New Timer card in its block layout -- the wheels, a name and Start. Its place keeps what is mounted in it
          // (data-keep: the block's morph leaves the card and its wheels alone); the wheels' rows are what the block's height gives
          // (the tile's 30 px of padding, Start's 56 and the name's 56, 10 px between: the rest is the wheels' five rows)
          var xk = mkOf(ih, false);
          var kx = fitK(2, 3, 84, 196, 14);
          return '<div class="gt idle mkr"><div class="ql"><span class="dir">Start a Timer</span><div class="qs g" style="--k:' + kx + 'px;--qc:2">' +
            presets.slice(0, 6).map(ring).join('') + '</div></div><div class="mk"' + xk.attrs + '></div></div>';
        };
        if (!rows.length) return '<div class="tg">' + idle() + '</div>';
        // (2026-11-09, mockup 5: Extra Large three across, Large two, Tall one with "+N more" under it, Wide two, Small one)
        // (Wide shows one: a second timer's keys have no room beside the + at the top right -- 2026-11-09, mockup 14b; "+N more" at its foot)
        var nn = rows.length, max = { S: 1, T: 1, W: 1, L: 2, XL: 3 }[sized] || 1, shown = rows.slice(0, max), left = nn - shown.length;
        var cols = sized === 'XL' ? 3 : sized === 'L' ? 2 : 1;
        // EXTRA LARGE WITH ONE OR TWO RUNNING keeps the maker beside them (14b): the maker 288-340 px, each timer at least its two keys wide (122 px) -- as many timers as fit beside a 288 px maker;
        // where none fit (or three or more run) the timers take the block, with the +
        var maker = '', mw = 0, ringX = 0;
        var fit = sized === 'XL' && nn <= 2 ? Math.min(nn, Math.floor((iw - 13 - 288 + 18) / 140)) : 0;
        if (fit >= 1) {
          mw = Math.min(340, iw - 13 - (fit * 122 + (fit - 1) * 18)); ringX = Math.min(136, Math.floor((iw - 13 - mw - (fit - 1) * 18) / fit));
          shown = rows.slice(0, fit); left = nn - fit; cols = fit; maker = mkOf(ih - (left ? 28 : 0), false);
        }
        var units = shown.map(function (r) {
          // (the hub's own "Timer" for one without a name is no name)
          var paused = r.state === 'paused', total = T ? T.secs(r.attrs.duration) : 0, nm = esc(r.name || 'Timer'), ttl = r.name && !/^(quick |hk )?timer( \d+)?$/i.test(r.name.trim()) ?
            '<b class="nm">' + nm + '</b>' : '';
          var clock = paused ? 'hold="' + (T ? T.secs(r.attrs.remaining) : 0) + '"' : 'deadline="' + Date.parse(r.attrs.finishes_at) + '"';
          // (the countdown is the ring's child: it writes the fraction left, --hk-left, on the ring, and the circle reads it; the heading row is always there, empty for an unnamed timer, so the rings
          // line up)
          var keys = sized === 'S' ? '' : '<div class="kk"><button class="pr" data-timer="' + esc(r.id) + '" data-service="' + (paused ? 'start' : 'pause') + '" aria-label="' +
            (paused ? 'Resume' : 'Pause') + ' ' + nm + '"><hk-icon icon="mdi:' + (paused ? 'play' : 'pause') + '"></hk-icon></button>' +
            '<button class="stop" data-timer="' + esc(r.id) + '" data-service="cancel" aria-label="Stop ' + nm + '"><hk-icon icon="mdi:stop"></hk-icon></button></div>';
          var secsLeft = paused ? (T ? T.secs(r.attrs.remaining) : 0) : (Date.parse(r.attrs.finishes_at) - Date.now()) / 1000;
          return '<div class="gt' + (paused ? ' held' : '') + (secsLeft >= 3600 ? ' hr' : '') + '"><div class="hd">' + ttl + '</div><div class="rg"><div class="rw">' +
            '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"></circle><circle class="left" cx="50" cy="50" r="46" pathLength="100"></circle></svg>' +
            '<hk-countdown ' + clock + ' total="' + total + '"></hk-countdown></div>' + keys + '</div></div>';
        });
        var add = '<button class="pl" data-new aria-label="Add a timer"><hk-icon icon="mdi:plus"></hk-icon></button>', more = left && sized !== 'S' ? '<div class="mf">+' + left + ' more</div>' : '';
        if (maker) return '<div class="xm" style="--mw:' + mw + 'px"><div class="tg" style="--cols:' + cols + ';--ring:' + ringX + 'px">' + units.join('') + '</div><div class="mk"' + maker.attrs +
          '></div></div>' + more;
        return add + '<div class="tg" style="--cols:' + cols + '">' + units.join('') + '</div>' + more;
      }
      _sigOf() {
        var h = this.client;
        if (!h) return null;
        var s = h.states[this._config.entity || 'sensor.running_quick_timers'];
        // The module may arrive after the first render; until it does there is
        // nothing to draw, so fold its presence into the signature.
        if (!this._cellSize()) return (s ? s.last_updated : 'x') + '|' + (window.hkTimers ? '1' : '0');
        return JSON.stringify([s, Object.keys(h.states).filter((id) => /^timer\.(quick|hk_timer)_/.test(id)).map((id) => h.states[id]), !!window.hkTimers]);
      }
      _render() {
        var cfg = this._config;
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="strip' +
            (cfg.fixed ? ' fixed' : '') + '" data-hk-role="card"></hk-plate>';
          this._e = this._root.querySelector('.strip');
          // The module loads in parallel with this card. One listener, once,
          // and only while the card is attached (see _wire).
          this._wire();
          this._built = true;
        }
        var T = window.hkTimers, sized = this._cellSize();
        if (sized) {
          var on = this._st(cfg.entity || 'sensor.running_quick_timers');
          var html0 = this._grid(on && on.attributes && on.attributes.running, sized);
          this._gridTap();
          window.hkCards.morph(this._e, html0);
          this._mountMaker();
          // THE COUNTDOWNS PAINT AGAIN NOW: the morph took their text and their
          // column's --hk-left (neither is in the markup), and each skips a write
          // it thinks it has made -- the ring sat full, the time blank, until the
          // next second or hundredth moved (hk-timers.js paint)
          this._e.querySelectorAll('hk-countdown').forEach(function (cd) {
            cd._hkLast = null;
            if (cd.parentElement) cd.parentElement._hkFrac = null;
            cd.setAttribute('total', cd.getAttribute('total') || '0');
          });
          return;
        }
        // '' is a CORRECT rendering, not a failure: with no timers running the
        // card draws nothing, and drawing nothing is what keeps it from leaving
        // a gap above the player in the pop-up.
        var html = '';
        if (T) {
          var st = this._st(cfg.entity || 'sensor.running_quick_timers');
          var list = st && st.attributes && st.attributes.running;
          // DOCKED (the docked now-playing bar's timers): each with its whole
          // length, for the ring of time left -- the timer's own `duration`,
          // which is what it was last started with
          if (cfg.docked && Array.isArray(list)) {
            var states = (this.client && this.client.states) || {};
            list = list.map(function (r) {
              var t = r && r.entity_id && states[r.entity_id];
              var d = t && t.attributes && T.secs(t.attributes.duration);
              return d > 0 ? Object.assign({}, r, { total: d }) : r;
            });
          }
          html = T.strip(list, {
            docked: !!cfg.docked,
            scale: Number(cfg.scale) || 1,
            fixed: !!cfg.fixed,
            plated: !!cfg.plated,
            // `glass` needs `plated`: it swaps the plate's material, it does not
            // add one. See hk-timers.js.
            glass: !!cfg.glass
          });
        }
        window.hkCards.morph(this._e, html);
      }
    }

    // what the shell and the later parts use of this one
    K.HkTimersPageCard = HkTimersPageCard; K.HkTimerStripCard = HkTimerStripCard;
  };
})();
