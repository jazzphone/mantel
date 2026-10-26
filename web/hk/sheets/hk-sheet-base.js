// hk-sheet-base.js - The sheets' shared base: the panel CSS (and Flat's recessed controls), the Panel class every sheet extends,
// the slider and the common pieces. Loaded first; every other sheet file builds on it.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every sheet file has loaded (the
// order is its SHEETS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-base'] = function (K) {
    var C = K.C, clamp = K.clamp, HkBase = K.HkBase, SHORT_MQ = K.SHORT_MQ, stOf = K.stOf;

    // ------------------------------------------------------------ panels
    // Recessed controls on Flat's elevated sheet. Keep the glass CSS below
    // intact: translucent white is its material, but disappears on Light.
    // Scope by role and state so artwork, color swatches and live colors stay
    // their own, and an inactive control never inherits a selected fill.
    var FLAT_PANEL_CSS = [
      ':host([hk-flat]) .tg:not(.on){background:' + C.v('key') + '}',
      ':host([hk-flat]) .tg .kn{box-shadow:none;border:1px solid ' + C.v('line') + ';box-sizing:border-box}',
      ':host([hk-flat]) .tg:not(.on) .kn{color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .vs::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 1px ' + C.v('line') + '}',
      ':host(hk-detail-fan[hk-flat="light"]) .vs .fill,:host(hk-detail-number[hk-flat="light"]) .vs .fill{background:' + C.v('track-fill') + '}',
      ':host(hk-detail-fan[hk-flat="light"]) .vs .gl.dark{color:var(--hk-seg-on,' + C.SELECTED_BG + ')}',
      ':host([hk-flat="light"]) .vs.neutral-fill .gl.dark{color:var(--hk-seg-on,' + C.SELECTED_BG + ')}',
      ':host([hk-flat]) .vs .tick{background:' + C.v('mark') + '}',
      ':host([hk-flat]) .vs .tick.in{background:' + C.v('line') + '}',
      ':host([hk-flat]) .btn.sel,:host([hk-flat]) .acts .pw.lit{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + ';box-shadow:inset 0 0 0 1px ' + C.v('line') + '}',
      ':host([hk-flat]) .bot:not(.live):not(.bad),:host([hk-flat]) .state:not(.open){background:' + C.v('key') + ';color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .cmds button{color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .cmds .ci{background:' + C.v('key') + '}',
      ':host([hk-flat]) .cmds button.sel .ci{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + ';box-shadow:inset 0 0 0 1px ' + C.v('line') + '}',
      ':host([hk-flat]) .chips span:not(.err),:host([hk-flat]) .guard button{background:' + C.v('key') + '}',
      ':host([hk-flat]) .chart,:host([hk-flat]) .stats,:host([hk-flat]) .trend,:host([hk-flat]) .tl,:host([hk-flat]) .en .rows{background:' + C.v('key') + '}',
      ':host([hk-flat]) .now{background:' + C.v('key') + '}',
      // The wide thermostat splits its readings and run time into two cards.
      ':host([hk-flat][wide]) .now{background:transparent}',
      ':host([hk-flat][wide]) .now .rd,:host([hk-flat][wide]) .now .run{background:' + C.v('key') + '}',
      // Water heaters keep their single reading card at either width.
      ':host(hk-detail-water-heater[hk-flat][wide]) .now{background:' + C.v('key') + '}',
      ':host([hk-flat]) .now .run,:host([hk-flat]) .en .row + .row{border-color:' + C.v('line') + '}',
      ':host([hk-flat]) .ap .gr{background:' + C.v('line') + '}',
      ':host([hk-flat]) .ap .gr.b{background:' + C.v('line-strong') + '}',
      ':host([hk-flat]) .hks .hkl{border-color:' + C.v('mark') + '}',
      ':host([hk-flat]) .hks .hkp{background:' + C.v('overlay-solid') + '}',
      ':host([hk-flat]) .hks .hkp .v{color:' + C.v('ink') + '}',
      ':host([hk-flat]) .list,:host([hk-flat]) .search{background:' + C.v('key') + '}',
      ':host([hk-flat]) .list button{border-color:' + C.v('line') + '}',
      ':host([hk-flat]) .search > svg{stroke:' + C.v('ink-2') + '}',
      ':host([hk-flat]) .list button:active,:host([hk-flat]) .vp button:not(.on):active{background:' + C.v('key-strong') + '}',
      ':host([hk-flat]) .chd .nv button,:host([hk-flat]) .vst button{background:' + C.v('key') + ';color:' + C.v('ink') + '}',
      ':host([hk-flat]) .tp button{color:' + C.v('ink') + '}',
      ':host([hk-flat]) .pg,:host([hk-flat]) .vol .t{background:' + C.v('line-strong') + '}',
      ':host([hk-flat]) .pg i{background:' + C.v('track-fill') + '}',
      ':host([hk-flat]) .gw:not(.on){background:' + C.v('key') + '}',
      ':host([hk-flat]) .gw:not(.on) .gc{background:' + C.v('key-strong') + ';color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .tl .bar{background:' + C.v('line-strong') + '}',
      ':host([hk-flat]) .tl .bar .q{background:' + C.v('line') + '}',
      ':host([hk-flat]) .lk .trk{stroke:' + C.v('line-strong') + '}',
      ':host([hk-flat="light"]) .lk .trk,:host([hk-flat="light"]) .dl .trk{stroke:' + C.v('key') + '}',
      ':host([hk-flat]) .lk.water.shut{background:' + C.v('key') + '}',
      ':host([hk-flat]) .lk.water.shut .core{background:' + C.v('key-strong') + ';color:' + C.v('glyph') + '}',
      ':host([hk-flat]) .dl .cur{fill:' + C.v('ink') + '}',
      ':host(hk-detail-water-heater[hk-flat]) .acts:not(.mseg) button,:host([hk-flat]) .pwr button{background:' + C.v('key') + ';color:' + C.v('ink') + '}',
      ':host(hk-detail-water-heater[hk-flat]) .acts:not(.mseg) button.sel,:host([hk-flat]) .pwr button.sel{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + '}',
      ':host(hk-detail-water-heater[hk-flat]) .sw:not(.on){background:' + C.v('key-strong') + '}',
      ':host([hk-flat]) .vs.off .fill{background:' + C.v('key-strong') + '}',
      ':host([hk-flat]) .mk span{color:' + C.v('ink-2') + '}',
      ':host([hk-flat]) .vp button.on{background:var(--hk-seg-on,' + C.SELECTED_BG + ');color:' + C.SELECTED_TEXT + '}',
      ':host([hk-flat]) .vp button:not(:first-child)::before{background:' + C.v('line') + '}'
    ].join('');
    // a panel whose control goes on the left on a short screen (PANEL_CSS SHORT)
    var TWO = ':host .pn:has(> :is(.vs,.tg,.wrap,.ctl,.lk,.bot,.gw,.dial,.pl,.sl))';
    var PANEL_CSS = FLAT_PANEL_CSS + [
      ':host{display:block;color:' + window.hkCards.v('ink') + ';font-family:inherit}',
      // a display rule beats the hidden attribute; this puts it back
      '[hidden]{display:none!important}',
      // 3 px above and below, the same: a centred panel is centred to the pixel
      '.pn{display:flex;flex-direction:column;align-items:center;gap:20px;padding:3px 0}',
      '.big{font-size:44px;font-weight:600;letter-spacing:-1.5px;line-height:1;',
      '  font-variant-numeric:tabular-nums;min-height:44px;text-align:center}',
      '.lab{align-self:stretch;font-size:13px;font-weight:600;letter-spacing:0.3px;',
      '  color:' + window.hkCards.v('ink-2') + ';text-transform:uppercase;margin-bottom:-10px}',
      // the vertical slider (brightness, speed, shade)
      // ONE SLIDER SIZE on every sheet (150 x 440; a phone 128 x 360)
      '.vs{position:relative;width:150px;height:440px;border-radius:44px;flex-shrink:0;',
      '  background:rgba(255,255,255,0.14);overflow:hidden;touch-action:none;cursor:pointer;',
      '  outline:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}',
      '.vs:focus-visible{box-shadow:0 0 0 3px rgba(100,181,255,0.8)}',
      // shorter when a row of buttons sits under it (a colour light, a humidifier)
      '.vs.short{height:320px}',
      '.vs .fill{position:absolute;left:0;right:0;bottom:0;height:0;background:rgba(255,255,255,0.95);',
      '  transition:height .18s ease}',
      '.vs.drag .fill{transition:none}',
      '.vs .gl{position:absolute;left:0;right:0;bottom:22px;display:flex;justify-content:center;',
      '  pointer-events:none;color:rgba(255,255,255,0.72);transition:color .15s}',
      '.vs .gl.dark{color:rgba(0,0,0,0.55)}',
      '.vs .tick{position:absolute;left:20px;right:20px;height:2px;border-radius:1px;',
      '  background:rgba(255,255,255,0.16);pointer-events:none}',
      '.vs .tick.in{background:rgba(0,0,0,0.13)}',
      // buttons -- NOT ".pill": hk-base's BASE_CSS owns that name (the
      // dashboard's glass pill, with the blur layer's marker), and reusing it
      // draws a dark box behind every sheet button
      '.btn{height:52px;border:0;border-radius:26px;padding:0 20px;display:inline-flex;',
      '  align-items:center;justify-content:center;gap:8px;font:inherit;font-size:16px;',
      '  font-weight:600;color:#fff;background:rgba(255,255,255,0.13);cursor:pointer;',
      '  -webkit-tap-highlight-color:transparent}',
      '.btn:active{background:rgba(255,255,255,0.24)}',
      '.btn.sel{background:rgba(255,255,255,0.95);color:rgba(0,0,0,0.88)}',
      '.btn[disabled]{opacity:.4;cursor:default}',
      // UNAVAILABLE (Panel._na): every control greys out and takes no input
      ':host([na]) .vs,:host([na]) .btn,:host([na]) .sw,:host([na]) .tp,:host([na]) .vol,',
      ':host([na]) .vst,:host([na]) .list,:host([na]) .cmds{opacity:.4;pointer-events:none}',
      '.menu{align-self:stretch;justify-content:space-between;padding:0 16px 0 20px}',
      '.menu .cur{display:inline-flex;align-items:center;gap:4px;color:rgba(235,235,245,0.62);',
      '  font-weight:500;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.menu .cur svg{flex-shrink:0}',
      '.muted{font-size:15px;color:' + window.hkCards.v('ink-2') + ';text-align:center}',
      // A STATE AND ITS LINE ARE ONE PIECE ("Closed" / "Hold to open",
      // "Closed" / "Since 8:20 AM"): SP.line under it, whatever the gap
      // between the sheet's pieces (20, a phone 16)
      '.pn > .big + .muted,.pn > .big + .since{margin-top:-14px}',
      // the axes (axesChart): values up the left, each centred on its rule
      // ONE GRID: the values' column, as wide as its WIDEST label (a hidden
      // copy of it sizes the column), then the plot; the times sit under the
      // plot in the same grid. A fixed 38 px column leaves short labels ("0",
      // "2") far in from the card's edge while the plot runs to the other --
      // the chart looks off-centre in its card.
      '.axc{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:10px;align-items:start}',
      '.ay{position:relative}',
      '.ay .sz{visibility:hidden;display:block;height:0;overflow:hidden;font-size:12px;line-height:14px;',
      '  font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.ay span{position:absolute;right:0;transform:translateY(-50%);font-size:12px;line-height:14px;',
      '  color:' + window.hkCards.v('ink-3') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.ap{position:relative;min-width:0}',
      '.axc > .axx{grid-column:2;margin:8px 0 0}',
      '.ap .gr{position:absolute;left:0;right:0;height:1px;margin-top:-0.5px;background:rgba(255,255,255,0.07);pointer-events:none}',
      '.ap .gr.b{background:rgba(255,255,255,0.16)}',
      '.axc.fl{align-items:stretch;grid-template-rows:minmax(0,1fr) auto}',
      '.axc.fl .ap > svg{height:100% !important;overflow:visible}',
      '.axx{position:relative;height:14px;margin:8px 0 0 48px;font-size:12px;line-height:14px;color:' + window.hkCards.v('ink-3') + '}',
      '.axx span{position:absolute;top:0;white-space:nowrap;transform:translateX(-50%)}',
      '.axx span:first-child{transform:none}',
      '.axx span:last-child{transform:translateX(-100%)}',
      // a calendar period's labels sit centered under their days, the ends too
      '.axx.cal span,.axx.cal span:first-child,.axx.cal span:last-child{transform:translateX(-50%)}',
      '.axx.cal span.today{color:#f4b562;font-weight:700}',
      '.axx.cal span.fut{opacity:.65}',
      // the readout (scrub): a vertical swipe on the plot still scrolls the
      // sheet; a held finger selects nothing and opens no callout
      '.ap[data-hks]{touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;',
      '  -webkit-tap-highlight-color:transparent}',
      '.hks{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .12s ease;z-index:2}',
      '.hks.on{opacity:1}',
      // the line runs from the label down to the plot's floor
      '.hks .hkl{position:absolute;left:0;top:-3px;bottom:0;width:0;border-left:1px solid rgba(255,255,255,0.55)}',
      '.hks .hkd{position:absolute;left:-6px;top:-6px;width:12px;height:12px;box-sizing:border-box;border-radius:50%;',
      '  background:#fff;border:3px solid #ff9f0a;box-shadow:0 1px 4px rgba(0,0,0,0.45)}',
      '.hks .hkp{position:absolute;left:0;bottom:calc(100% + 3px);display:flex;align-items:baseline;gap:7px;',
      '  padding:4px 10px;border-radius:13px;white-space:nowrap;background:rgba(24,24,28,0.93);',
      '  box-shadow:0 0 0 0.5px rgba(255,255,255,0.14),0 4px 14px rgba(0,0,0,0.35)}',
      '.hks .hkp .v{font-size:15px;line-height:18px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums}',
      '.hks .hkp .t{font-size:13px;line-height:18px;color:' + window.hkCards.v('ink-2') + ';font-variant-numeric:tabular-nums}',
      // a bar chart lights the bar under the line: the others step back
      '.hksg > div{transition:opacity .12s ease}',
      '.hksg.on > div:not(.hkon){opacity:.4}',
      '@media (max-width:' + C.BP.phone + 'px),' + SHORT_MQ + '{',
      '  .pn{gap:16px}',
      '  .pn > .big + .muted,.pn > .big + .since{margin-top:-10px}',
      '  .big{font-size:38px;min-height:38px}',
      '  .vs{width:128px;height:360px;border-radius:38px}',
      '  .vs.short{height:280px}',
      '  .vs .gl{bottom:18px}',
      '  .lab{margin-bottom:-8px}',
      '  .btn{height:48px;border-radius:24px;font-size:15px}',
      '}',
      // A SHORT SCREEN (SHEET_CSS above): two columns -- the control (the
      // slider, the switch, the lock, the disc, the glyph) on the left, as
      // tall as the body, and what it reads and its buttons beside it,
      // centred on it. --hk-short-h: the body's height (the screen less the
      // sheet's margins, padding, header and gap). :host first, so these win
      // over each panel's own rules.
      // THE RIGHT COLUMN CENTRED ON THE CONTROL: no wrapper to centre, so
      // the grid has a flexible row above its pieces and one below them
      // (::before and ::after), and the control spans every row. Selectors
      // with .pn: specific enough to win over a panel's own sizes.
      '@media ' + SHORT_MQ + '{',
      // (the control's corners as variables: a capsule, half its width; the slider's 0.29 of it, as the tablet's 44 of 150)
      '  :host{--hk-short-h:calc(var(--hk-vh, 100dvh) - 112px);--hk-short-w:min(120px, calc(var(--hk-short-h) * 0.43));',
      '    --hk-short-cap:calc(var(--hk-short-w) / 2);--hk-short-vr:calc(var(--hk-short-w) * 0.29);--hk-short-kn:calc((var(--hk-short-w) - 24px) / 2)}',
      // (no row gap: an empty row would still take one; the right column's
      // pieces are 12 apart by their own margins, 6 a side)
      // (only a panel with such a control: a reading and its chart, a list, keep their own column)
      '  ' + TWO + '{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:minmax(0,1fr) repeat(5,auto) minmax(0,1fr);',
      '    column-gap:28px;row-gap:0;align-items:center;justify-items:center;padding:0;height:var(--hk-short-h);box-sizing:border-box}',
      '  ' + TWO + '::before,' + TWO + '::after{content:"";grid-column:2;align-self:stretch}',
      // THE CONTROL AND WHAT IS BESIDE IT AS ONE GROUP, in the sheet's middle,
      // where the right column holds only things of their own size -- a
      // reading and its line, a row of buttons, the colours, a vacuum's
      // commands: the columns as wide as what they hold and the pair
      // centred, not the control against the left edge and the rest
      // floating in a wide column (2026-10-25; first a slider and its
      // reading alone, the pendant). A column of cards that fill their width
      // -- the thermostat's readings and modes, a day's strip, the
      // humidifier's readings -- keeps the wide column. (What is hidden, a
      // day's strip with no day to show, counts for nothing.)
      '  ' + TWO + ':not(:has(> :is(.side,.tl:not([hidden]),.rds,.acts,.now,.trend))){grid-template-columns:auto auto;justify-content:center;column-gap:40px}',
      '  ' + TWO + '::before{grid-row:1}',
      '  ' + TWO + '::after{grid-row:7}',
      '  ' + TWO + ' > *{grid-column:2;max-width:100%;margin-block:6px}',
      '  :host .pn > :is(.vs,.tg,.wrap,.ctl,.lk,.bot,.gw,.dial,.sl){grid-column:1;grid-row:1 / 8;margin-block:0}',
      // (a card in the wide column -- a day's strip -- to its edges, as the X above it)
      '  :host .pn > .tl{justify-self:stretch}',
      // (the thermostat's dial: the body's height, its ring 0.87 as tall as
      // wide and as big as the mode row under it leaves -- 44 and 12 apart --
      // and the fan's row too when it has one, :host([hk-fan]); the readings
      // beside it fill the column)
      '  :host .pn > .dial.dial{height:var(--hk-short-h);align-self:center;justify-content:center;width:calc(var(--hk-short-h) / 0.87);--hk-tstat-rows:none}',
      // (ClimatePanel._fitShort then sets the exact width, measured; the
      // modes and the fan are the side column's own rows, .sctl)
      '  :host .pn > .side{display:flex;flex-direction:column;gap:12px}',
      '  :host .side .sctl{display:flex;flex-direction:column;gap:12px}',
      '  :host .pn > .side{justify-self:stretch;align-self:center}',
      '  :host .side .trend,:host .side .now .run{display:none}',
      // (the thermostat's own wide row -- :host([wide]) .pn, its 28 px gap -- gives way here)
      '  :host([wide]) .pn.pn{row-gap:0;column-gap:28px;align-items:center}',
      // (a state and its line are one piece: 6 apart, not 12)
      '  :host .pn > .big + .muted,:host .pn > .big + .since{margin-top:0}',
      '  :host .pn .vs,:host .pn .vs.short,:host .pn .vs.shade{height:var(--hk-short-h);width:var(--hk-short-w);border-radius:var(--hk-short-vr)}',
      '  :host .pn :is(.wrap,.ctl){height:auto}',
      // the power switch: the slider's size, its knob the width less 12 a side
      '  :host .pn > .tg{height:var(--hk-short-h);width:var(--hk-short-w);border-radius:var(--hk-short-cap)}',
      '  :host .pn > .tg .kn{height:calc(var(--hk-short-w) - 24px);border-radius:var(--hk-short-kn);top:calc(100% - var(--hk-short-w) + 12px)}',
      '  :host .pn > .tg.on .kn{top:12px}',
      '  :host .pn .vs .gl{bottom:16px}',
      // (the vacuum's four commands: their circles a step smaller, to sit four abreast in the column)
      '  :host .pn .cmds{gap:8px}:host .pn .cmds .ci{width:60px;height:60px;border-radius:30px}',
      // (a colour light's swatches: 40 across, 10 apart, so seven sit inside the column)
      '  :host .pn .sw{gap:10px}:host .pn .sw button{width:40px;height:40px;border-radius:20px}',
      '  :host .pn .grp{min-width:0}',
      '  :host .lab{margin-bottom:-6px}',
      '  :host .btn{height:44px;border-radius:22px;font-size:15px}',
      '}'
    ].join('');

    var CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
               'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
               '<path d="m9 6 6 6-6 6"/></svg>';
    // the current row's tick (effects, inputs, every pick list) and the search glyph
    var TICK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF9F0A" stroke-width="2.6" ' +
               'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    var SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(235,235,245,.6)" stroke-width="2.2" ' +
                 'stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>';

    class Panel extends HkBase {
      static get CSS() { return PANEL_CSS; }
      // _stateObj, not _st: HkBase has a METHOD _st(id), and a getter of the
      // same name would replace it for every panel.
      get _stateObj() { return stOf(this.client, this._config && this._config.entity); }
      get _id() { return this._config && this._config.entity; }
      get _src() { return (this._config && this._config.src) || {}; }
      _svc(domain, service, data) {
        return this._call(domain, service, Object.assign({ entity_id: this._id }, data || {}));
      }
      // UNAVAILABLE, ONE WAY FOR EVERY SHEET: the controls grey out and take
      // no input (PANEL_CSS :host([na])), and the caller's readout says
      // "Unavailable" -- never a stale "Off" or a shade drawn "Open". Only
      // `unavailable`: an `unknown` device still takes commands, as in HA.
      _na(s) {
        var na = !!s && s.state === 'unavailable';
        if (na) this.setAttribute('na', ''); else this.removeAttribute('na');
        return na;
      }
      // The vertical slider. o: { steps, glyph, onInput(v), onChange(v), label }
      // Drag moves from where it is (as the Home app does); a tap jumps to the tap.
      _vslider(o) {
        var self = this;
        var el = document.createElement('div');
        el.className = 'vs';
        el.setAttribute('role', 'slider');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', o.label || 'Level');
        el.setAttribute('aria-valuemin', '0');
        el.setAttribute('aria-valuemax', '100');
        var ticks = '';
        if (o.steps && o.steps > 1 && o.steps <= 10) {
          for (var i = 1; i < o.steps; i++) {
            ticks += '<div class="tick" data-f="' + (i / o.steps) + '" style="bottom:calc(' + (i / o.steps * 100) + '% - 1px)"></div>';
          }
        }
        el.innerHTML = '<div class="fill"></div>' + ticks + '<div class="gl">' + (o.glyph || '') + '</div>';
        var fill = el.querySelector('.fill'), gl = el.querySelector('.gl');
        var cur = 0, drag = null;
        function snap(v) {
          v = clamp(v, 0, 1);
          if (o.steps && o.steps > 1) return Math.round(v * o.steps) / o.steps;
          return Math.round(v * 100) / 100;
        }
        function show(v) {
          cur = v;
          fill.style.height = (v * 100) + '%';
          el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
          var h = el.clientHeight || 380;
          gl.classList.toggle('dark', v * h > 58);
          el.querySelectorAll('.tick').forEach(function (t) {
            t.classList.toggle('in', Number(t.getAttribute('data-f')) < v - 1e-6);
          });
        }
        el.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          try { el.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
          drag = { y0: e.clientY, v0: cur, moved: false, rect: el.getBoundingClientRect() };
        });
        el.addEventListener('pointermove', function (e) {
          if (!drag) return;
          var dy = e.clientY - drag.y0;
          if (!drag.moved && Math.abs(dy) < 5) return;
          if (!drag.moved) { drag.moved = true; el.classList.add('drag'); }
          var v = snap(drag.v0 - dy / drag.rect.height);
          if (v !== cur) { show(v); if (o.onInput) o.onInput(v); }
        });
        function end(e, cancel) {
          if (!drag) return;
          var d = drag; drag = null;
          el.classList.remove('drag');
          if (cancel) return;
          var v = d.moved ? cur : snap(1 - (e.clientY - d.rect.top) / d.rect.height);
          show(v);
          if (o.onChange) o.onChange(v);
        }
        el.addEventListener('pointerup', function (e) { end(e, false); });
        el.addEventListener('pointercancel', function (e) { end(e, true); });
        el.addEventListener('keydown', function (e) {
          var step = o.steps && o.steps > 1 ? 1 / o.steps : 0.05;
          var v = null;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = snap(cur + step);
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = snap(cur - step);
          if (v == null) return;
          e.preventDefault();
          show(v);
          if (o.onChange) o.onChange(v);
        });
        return {
          el: el,
          set: function (v) { if (!drag) show(clamp(v, 0, 1)); },
          fill: function (bg) { fill.style.background = bg; },
          dragging: function () { return !!drag; }
        };
      }
      // TWO COLUMNS WHEN THERE IS ROOM, decided here and not by a CSS
      // container query: Safari does not match container-query rules in a shadow
      // tree against :host, so the thermostat and the graph would stay stacked
      // (and overflow the 680 sheet) there while Chrome is fine. A panel that
      // has a wide layout returns its width from _wideAt(); its CSS keys off
      // :host([wide]) and _onWide() repaints whatever it drew for the other
      // width.
      _wideAt() { return 0; }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var at = this._wideAt(), self = this;
        if (!at || this._ro || typeof ResizeObserver === 'undefined') return;
        this._ro = new ResizeObserver(function () {
          var w = self.clientWidth >= self._wideAt();      // (asked again: a phone turned may change it)
          if (w === self.hasAttribute('wide')) return;
          if (w) self.setAttribute('wide', ''); else self.removeAttribute('wide');
          if (self._onWide) self._onWide();
        });
        this._ro.observe(this);
      }
      // A SHORT SCREEN's listener (the climate dial, the alarm's keypad side by side): on this._shortMq, undone with
      // the rest when the sheet closes. Each open added one and none went (the panels, and their re-fits on every
      // turn of the screen, outlived their sheets).
      _listenShort(fn) {
        var mq = this._shortMq;
        if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
        this._undo(function () { if (mq.removeEventListener) mq.removeEventListener('change', fn); else if (mq.removeListener) mq.removeListener(fn); });
      }
      _undo(fn) { (this._undos || (this._undos = [])).push(fn); }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._tickT) { clearInterval(this._tickT); this._tickT = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._shortRO) { this._shortRO.disconnect(); this._shortRO = null; }
        (this._undos || []).forEach(function (fn) { try { fn(); } catch (e) { /* gone already */ } });
        this._undos = null;
        this._shortMq = null;             // shown again: listened to again
      }
    }

    // what the shell and the later sheet files use of this one
    K.CHEV = CHEV; K.Panel = Panel; K.PANEL_CSS = PANEL_CSS; K.SEARCH = SEARCH; K.TICK = TICK;
  };
})();
