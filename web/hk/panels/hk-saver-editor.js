// hk-saver-editor.js -- THE SCREENSAVER EDITOR (2026-11-01, the owner: "Lets do the editor!";
// docs/phase12/SCREENSAVER-EDITOR.md, phase D): the Home Grid editor's frame for the screensaver -- the starters and
// the widgets on the left, the screen itself in the middle, what is chosen on the right. A screensaver is one
// background, one big element, and widgets in zones (hk-saverlayout.js); the background stays in the options it always
// was (show, clock_bg and the rest), the big element and the zones are the options' `layout`.
//
// THE SCREEN IS THE SCREENSAVER ITSELF: the screen's page in a frame, the screensaver shown with the draft
// (hkSaver.preview's `over`), and the zones drawn over it from the plan the screensaver drew by (hkSaver.layoutInfo) --
// what the editor shows is what the tablet draws, never a second guess at it.
//
// TOUCH FIRST (the owner's iPad): tap a widget, then tap a green place on the screen (or tap a place first, and pick
// from what fits there). Nothing is dragged.
//
//   <hk-saver-editor>.configure({ panel, path, house, previewPath, title, onCancel, onSaved })
//     path: the screen whose screensaver this is (house: true -- All Screens'); previewPath: a screen to show it on
(function () {
  'use strict';
  if (window.customElements && customElements.get('hk-saver-editor')) return;
  var LM = null, WG = null;

  var DEVICES = [['tablet', 'Wall Tablet', 1280, 800], ['ipad', 'iPad Upright', 820, 1180], ['phone', 'Phone', 390, 844]];
  var KINDS = [['circular', 'Circular', 'Under the big element, four to a row'], ['rectangular', 'Rectangular', 'Under the big element, two places wide'],
               ['inline', 'Inline', 'A line of words, above the big element or in a top corner'], ['card', 'Cards', 'In the corners'],
               ['band', 'Along the Bottom', 'Across the foot of the screen']];
  // WHAT IS BEHIND: [id, name, what it is, the options that make it]
  var BGS = [
    ['photos', 'Photos', 'Your albums, one after another', { show: 'photos' }],
    ['landscape', 'Landscape', 'The live sky over the season’s land', { show: 'forecast' }],
    ['sky', 'Sky Only', 'The live sky, no land', { show: 'clock', clock_bg: 'skyonly' }],
    ['color', 'Moving Color', 'Aurora, gradients, ink and patterns', { show: 'clock', clock_bg: 'aurora' }],
    ['wallpaper', 'Wallpaper', 'HK’s wallpapers', { show: 'clock', clock_bg: 'wallpaper' }],
    ['landscapes', 'HK Landscapes', 'Photographs of mountains and lakes', { show: 'clock', clock_bg: 'landscapes' }],
    ['soft', 'Soft Photos', 'Your photos, blurred and dimmed', { show: 'clock', clock_bg: 'photos' }],
    ['dayart', 'The Day’s Art', 'Occasions and the seasons', { show: 'day' }],
    ['calm', 'Calm Color', 'Glance’s quiet ground', { show: 'glance' }],
    ['paper', 'Paper', 'Month’s page', { show: 'month' }],
    ['black', 'Black', 'Nothing behind, for a bedroom', { show: 'clock', clock_bg: 'black' }]
  ];
  var COLOR_BGS = [['aurora', 'Aurora'], ['gradient', 'Drifting Gradient'], ['grain', 'Grain Wash'], ['ink', 'Ink Swirl'],
                   ['sky', 'Follow the Sky'], ['lowpoly', 'Low Poly'], ['topo', 'Topography'], ['constellation', 'Constellation']];
  function bgOf(o) {
    if (o.show === 'photos' || o.show === 'both') return 'photos';
    if (o.show === 'forecast') return 'landscape';
    if (o.show === 'day') return 'dayart';
    if (o.show === 'glance') return 'calm';
    if (o.show === 'month') return 'paper';
    var b = o.clock_bg;
    return b === 'skyonly' ? 'sky' : b === 'forecast' ? 'landscape' : b === 'wallpaper' ? 'wallpaper' : b === 'photos' ? 'soft'
      : b === 'landscapes' ? 'landscapes' : b === 'black' ? 'black' : 'color';
  }
  // saverThumb's names for a background's small picture
  // (a clock background's own picture -- bg:<clock_bg> -- so Sky Only, Moving Color, Wallpaper and Black look like themselves)
  function thumbOf(id, o) { return { photos: 'photos', landscape: 'forecast', dayart: 'day', calm: 'glance', paper: 'month' }[id] || (o && o.clock_bg ? 'bg:' + o.clock_bg : 'clock'); }
  // TODAY'S SHOWS, AS STARTERS: [name, what it is, its options, its layout (else today's, layoutFrom)]
  function W(id) { return { id: id, back: 'none', color: 'auto' }; }
  function zonesOf(o) { var z = { line: [], row: [], tl: [], tr: [], bl: [], br: [], bottom: [] }; Object.keys(o).forEach(function (k) { z[k] = o[k].map(W); }); return z; }
  var STARTERS = [
    ['Photo Frame', 'Your photos, the time behind them', { show: 'photos' },
     { v: 1, big: { kind: 'time', size: 30, pos: 'top', align: 'center', depth: 'behind' }, zones: zonesOf({ tl: ['weather_card'], tr: ['status_card'], bl: ['music_card'], br: ['timers_card'] }), upright: null }],
    ['Forecast', 'The sky, the land and the forecast', { show: 'forecast', forecast_layout: 'classic' }, null],
    ['Big Weather', 'The time standing in the meadow', { show: 'forecast', forecast_layout: 'big', forecast_big: 'clock', forecast_planted: true }, null],
    ['Lock Screen', 'Widgets under the time, as on iPhone', { show: 'forecast' },
     { v: 1, big: { kind: 'time', size: 26, pos: 'upper', align: 'center', depth: 'front' }, zones: zonesOf({ line: ['date'], row: ['temp', 'aqi', 'timer', 'locks'], bl: ['music_card'], tr: ['status_card'] }), upright: null }],
    ['Clock', 'A big clock on moving color', { show: 'clock', clock_bg: 'aurora' }, null],
    ['Glance', 'The date, a clock, music and the weather', { show: 'glance' }, null],
    ['Month', 'This month, today circled', { show: 'month' }, null],
    ['Day', 'The day, with HK’s art for it', { show: 'day' }, null],
    ['Nightstand', 'Quiet, on black', { show: 'clock', clock_bg: 'black' },
     { v: 1, big: { kind: 'time', size: 28, pos: 'center', align: 'center', depth: 'front' }, zones: zonesOf({ line: ['weather_line'], br: ['timers_card'] }), upright: null }]
  ];
  var BIG_KINDS = [['time', 'Time'], ['temp', 'Temperature'], ['date', 'Date'], ['month', 'Month'], ['none', 'None']];
  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  var CSS = [
    ':host{position:fixed;inset:0;z-index:1000;overflow:hidden}',
    '.editor{height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--hk-bg)}',
    '.tools{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--hk-sep);background:var(--hk-cell);flex:none;z-index:4}',
    '.tools h1{font-size:20px;margin:0;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tools button{border:0;border-radius:8px;min-height:44px;padding:0 16px;background:var(--hk-fill);color:var(--hk-label);font:inherit;cursor:pointer}',
    '.tools .save{background:var(--hk-tint);color:white}.tools button:disabled{opacity:.4;cursor:default}',
    '.message{flex:none;color:var(--hk-red);min-height:24px;padding:6px 20px 0}.message.ok{color:var(--hk-label2)}',
    '.work{flex:1;min-height:0;overflow:hidden;box-sizing:border-box;display:grid;grid-template-columns:280px minmax(0,1fr) 340px;gap:16px;padding:16px 16px 0}',
    '@media(max-width:1380px){.work{grid-template-columns:240px minmax(0,1fr) 300px}}',
    '.stage{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}',
    '.palette,aside.sidebar{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-bottom:24px}',
    '.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin:0 0 10px}',
    '.pills{display:flex;background:var(--hk-fill);border-radius:9px;padding:2px;gap:2px}',
    '.pills button{border:0;background:none;border-radius:7px;min-height:32px;padding:0 12px;color:var(--hk-label);font:inherit;font-size:14px;cursor:pointer}',
    '.pills button[aria-pressed=true]{background:var(--hk-cell);box-shadow:0 1px 3px rgba(0,0,0,.18);font-weight:600}',
    '.bar .extras{border:0;border-radius:9px;min-height:36px;padding:0 14px;background:var(--hk-fill);color:var(--hk-label);font:inherit;font-size:14px;cursor:pointer}',
    '.bar .extras[aria-pressed=true]{background:var(--hk-accent,#0a84ff);color:#fff;font-weight:600}',
    '.note{font-size:13px;color:var(--hk-label2);line-height:1.5;margin:0 0 10px}',
    '.framebox{position:relative;overflow:hidden;margin:0 auto;border-radius:14px;background:#000;outline:1px solid var(--hk-sep);flex:none}',
    '.framebox[data-loading]::after{content:"Loading the screensaver…";position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;font-size:15px;color:#ccc;background:#111}',
    '.frame{position:absolute;left:0;top:0;transform-origin:top left;overflow:hidden}',
    'iframe{position:absolute;inset:0;border:0;width:100%;height:100%;pointer-events:none}',
    // THE PLACES over the screen: the zones as the screen drew them, what is in them, and where a picked widget can go
    '.ov{position:absolute;inset:0;z-index:2}',
    '.ov .z,.ov .w,.ov .big{position:absolute;box-sizing:border-box;border-radius:14px;background:transparent;border:0;padding:0;cursor:pointer;font:inherit;color:#fff}',
    ':host(:not([previewing])) .ov .z{outline:2px dashed rgba(255,255,255,.7);outline-offset:3px;background:rgba(0,0,0,.12)}',
    ':host(:not([previewing])) .ov .z span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--zf,22px);font-weight:600;text-align:center;line-height:1.1;text-shadow:0 1px 4px rgba(0,0,0,.7);pointer-events:none}',
    ':host(:not([previewing])) .ov .w:hover,:host(:not([previewing])) .ov .big:hover{outline:2px solid rgba(255,255,255,.55);outline-offset:4px}',
    '.ov [aria-pressed=true]{outline:4px solid var(--hk-tint)!important;outline-offset:5px!important}',
    '.ov .z.want{outline:3px dashed #30d158!important;background:rgba(48,209,88,.18)!important}',
    // (dragged: what it is, at the pointer; the green place under it, brighter)
    '.ov .z.want.hover{background:rgba(48,209,88,.45)!important;outline-style:solid!important}',
    '.dragchip{position:fixed;z-index:20;pointer-events:none;transform:translate(-50%,-130%);padding:8px 14px;border-radius:12px;background:var(--hk-accent,#0a84ff);color:#fff;font-weight:600;font-size:14px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.3)}',
    '.witem,.ov .w{-webkit-user-select:none;user-select:none}',
    // (the + after what a zone has: round, its sign large)
    ':host(:not([previewing])) .ov .z.plus{border-radius:50%}',
    ':host(:not([previewing])) .ov .z.plus span{font-size:calc(var(--zf,22px) * 2);font-weight:300}',
    ':host([previewing]) .ov .z{display:none}',
    // (a card with nothing to show now -- no music, no timer -- still has its place: drawn as one, with its name and
    // when it shows; the owner, 2026-11-01: "I had no idea they were there until I hovered over them")
    ':host(:not([previewing])) .ov .w.empty{outline:2px dashed rgba(255,255,255,.7);outline-offset:3px;background:rgba(0,0,0,.18)}',
    ':host(:not([previewing])) .ov .w.empty span{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:calc(var(--zf,22px) * .8);font-weight:600;text-align:center;line-height:1.15;text-shadow:0 1px 4px rgba(0,0,0,.7);pointer-events:none}',
    ':host(:not([previewing])) .ov .w.empty small{font-size:.78em;font-weight:500;opacity:.85}',
    '.ov .moved{position:absolute;pointer-events:none;font-size:calc(var(--zf,22px) * .8);font-weight:600;color:#000;background:#ffd60a;border-radius:8px;padding:4px 10px;white-space:nowrap}',
    ':host([previewing]) .ov{pointer-events:none}:host([previewing]) .ov .moved{display:none}',
    // THE LIBRARY
    '.lib-head{position:sticky;top:0;z-index:2;background:var(--hk-bg);padding:0 0 8px}',
    '.lib-head p{font-size:13px;color:var(--hk-label2);margin:0 4px;line-height:1.4}',
    '.pick-banner{display:flex;align-items:center;gap:8px;margin:8px 0 0;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--hk-tint) 16%,var(--hk-cell));font-size:14px}',
    '.pick-banner span{flex:1}.pick-banner button{border:0;background:none;color:var(--hk-tint);font:inherit;cursor:pointer;min-height:32px}',
    '.wgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:10px}',
    '.witem{border:1.5px solid transparent;background:var(--hk-fill);border-radius:12px;padding:10px 6px 8px;display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center;min-width:0;color:var(--hk-label);font:inherit;cursor:pointer}',
    '.witem.wide{grid-column:span 2}.witem[aria-pressed=true]{border-color:var(--hk-tint);background:color-mix(in srgb,var(--hk-tint) 14%,var(--hk-fill))}',
    '.witem b{font-size:13px}.witem small{font-size:11px;color:var(--hk-label2);line-height:1.25}',
    '.witem .pv{display:flex;align-items:center;justify-content:center;min-height:52px;max-width:100%;overflow:hidden;border-radius:8px;padding:4px 8px;background:#3a5f8f;color:#fff;--tint:#fff}',
    '.starter-row{display:flex;align-items:center;gap:12px;padding:10px 12px;text-align:left;cursor:pointer;width:100%;border:0;background:none;color:var(--hk-label);font:inherit;border-top:1px solid var(--hk-sep)}',
    '.starter-row:first-child{border-top:0}.starter-row .st{display:grid;gap:2px;min-width:0}.starter-row b{font-weight:600;font-size:15px}.starter-row small{font-size:12px;color:var(--hk-label2)}',
    '.starter-row .thumb{flex:none;width:72px;height:45px;border-radius:7px;overflow:hidden;background:#222}',
    // THE INSPECTOR
    '.insp-head{display:flex;align-items:center;gap:12px;padding:4px 4px 16px}',
    '.insp-head hk-icon{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:48px;height:48px;flex:none;border-radius:12px;background:var(--hk-cell);color:var(--hk-tint);--mdc-icon-size:26px}',
    '.insp-head h2{margin:0;font-size:20px;font-weight:700}.insp-head p{margin:2px 0 0;font-size:13px;color:var(--hk-label2)}',
    '.insp-head .done{margin-left:auto;border:0;background:none;color:var(--hk-tint);font:inherit;font-size:15px;cursor:pointer;min-height:44px}',
    '.desktop-note{display:none;padding:32px;max-width:520px}.desktop-note p{margin:0 0 16px;line-height:1.5}',
    '.desktop-note button{border:0;border-radius:10px;min-height:44px;padding:0 18px;background:var(--hk-tint);color:white;font:inherit;cursor:pointer}',
    '@media(max-width:899px){:host(:not([wide-anyway])) .work,:host(:not([wide-anyway])) .tools .save,:host(:not([wide-anyway])) .tools .undo{display:none}:host(:not([wide-anyway])) .desktop-note{display:block}}',
    ':host([wide-anyway]) .work{overflow-x:auto;grid-template-columns:240px minmax(560px,1fr) 300px}'
  ].join('\n');

  class SaverEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this.undoStack = []; this.sel = null; this.pick = null; this.device = 0; this.busy = false; }
    configure(o) {
      this.o = o; this.panel = o.panel; this.K = window.hkSettingsKit; this.h = this.K.h; this.M = window.hkSettingsModel;
      this.opts = this.M.saverOptions(o.options || {});
      this.ready = Promise.all([
        window.hkSaverLayout ? null : import('/hk/modules/hk-saverlayout.js'),
        window.hkSaverWidgets ? null : import('/hk/modules/hk-saverwidgets.js')
      ]).then(() => {
        LM = window.hkSaverLayout; WG = window.hkSaverWidgets;
        // a screen with no layout yet opens on what it shows today
        if (!this.opts.layout) this.opts.layout = LM.layoutFrom(this.opts);
        this.initial = JSON.stringify(this.opts);
      });
    }
    connectedCallback() {
      this.toggleAttribute('dark', this.panel.hasAttribute('dark'));
      if (this.ui) { this.fit(); return; }
      this.ready.then(() => {
        if (!this.isConnected || this.ui) return;
        this.draw();
        this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(this.stage);
        this.unload = (e) => { if (this.dirty()) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', this.unload);
      });
    }
    disconnectedCallback() {
      if (this.ro) this.ro.disconnect();
      clearTimeout(this.ovT); clearInterval(this.waitT);
      window.removeEventListener('beforeunload', this.unload);
      try { var S = this.saver(); if (S) S.preview(false); } catch (e) { /* gone */ }
      this.ui = null;
    }
    dirty() { return JSON.stringify(this.opts) !== this.initial; }
    say(text, ok) { this.message.textContent = text || ''; this.message.classList.toggle('ok', !!ok); }
    saver() { try { return this.iframe && this.iframe.contentWindow && this.iframe.contentWindow.hkSaver; } catch (e) { return null; } }
    L() { return this.opts.layout; }
    // THE LAYOUT BEING EDITED: the sideways one, or -- with upright screens laid out on their own, and an upright shape
    // shown -- the upright one (hk-saverlayout.js oriented)
    upright() { var d = DEVICES[this.device]; return d[3] > d[2]; }
    T(o) {
      var L = (o || this.opts).layout;
      return this.upright() && L.upright && L.upright.big && L.upright.zones ? L.upright : L;
    }

    // ------------------------------------------------------------ the frame
    draw() {
      var h = this.h, K = this.K;
      this.shadowRoot.replaceChildren(h('style', { text: K.CSS + '\n' + CSS + '\n' + (WG && WG.CSS || '') }));
      this.ui = h('div', { class: 'editor' }); this.shadowRoot.appendChild(this.ui);
      this.saveButton = h('button', { class: 'save', text: 'Save', onclick: () => this.save() });
      this.undoButton = h('button', { class: 'undo', text: 'Undo', title: 'Undo (⌘Z)', onclick: () => this.undo(), disabled: true });
      this.modeButton = h('button', { class: 'mode', text: 'Preview', onclick: () => this.togglePreview() });
      this.ui.appendChild(h('header', { class: 'tools' }, [h('button', { text: 'Cancel', onclick: () => this.cancel() }),
        h('h1', { text: this.o.title + ' · Screensaver' }), this.undoButton, this.modeButton, this.saveButton]));
      this.message = h('div', { class: 'message', role: 'status', 'aria-live': 'polite' }); this.ui.appendChild(this.message);
      this.ui.appendChild(h('div', { class: 'desktop-note' }, [
        h('p', { text: 'This window is narrow for the editor: it shows the widgets, the screen and the settings side by side. Turn the device sideways or widen the window, or open it anyway and scroll sideways.' }),
        h('button', { type: 'button', text: 'Open Anyway', onclick: () => { this.setAttribute('wide-anyway', ''); this.fit(); } })]));
      this.palette = h('aside', { class: 'palette', 'aria-label': 'Widgets' });
      this.stage = h('section', { class: 'stage', 'aria-label': 'The screensaver' });
      this.sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Settings for what is chosen', tabindex: '0' });
      this.ui.appendChild(h('div', { class: 'work' }, [this.palette, this.stage, this.sidebar]));
      this.devBar = h('div', { class: 'pills', role: 'group', 'aria-label': 'Screen shape' });
      // SLIDES & NOTIFICATIONS (2026-11-01, the owner: "Just offer a toggle to turn these things off (have them off by
      // default)"): the music, weather and energy slides and the house's banners, in this preview only
      this.extras = false;
      this.extrasButton = h('button', { type: 'button', class: 'extras', 'aria-pressed': 'false', text: 'Slides & Notifications: Off',
        title: 'Show the slides (music, the forecast, weather, Home Energy) and the house’s notifications in this preview',
        onclick: () => { this.extras = !this.extras; this.extrasButton.setAttribute('aria-pressed', String(this.extras));
                         this.extrasButton.textContent = 'Slides & Notifications: ' + (this.extras ? 'On' : 'Off'); this.preview(); } });
      this.stage.appendChild(h('div', { class: 'bar' }, [this.devBar, this.extrasButton]));
      this.stage.appendChild(h('p', { class: 'note', text: 'The screensaver itself, as this screen will show it. Tap something on it to change it; tap a widget on the left, then a green place, to add one. Nothing here acts on the house.' }));
      this.box = h('div', { class: 'framebox', 'data-loading': 'yes' }); this.stage.appendChild(this.box);
      this.frame = h('div', { class: 'frame' }); this.box.appendChild(this.frame);
      this.iframe = h('iframe', { title: 'Screensaver preview', tabindex: '-1', 'aria-hidden': 'true' });
      this.iframe.inert = true;
      var x = this.panel.host && this.panel.host();
      this.iframe.src = this.panel.hostScreenBase() + '/' + (this.o.previewPath || this.o.path) + '/0?hk_kiosk=on&kiosk&wp_enabled=false' + (x && x.saverPage === true ? '&hk_preview=saver' : '');
      this.iframe.addEventListener('load', () => this.preview());
      this.frame.appendChild(this.iframe);
      this.ov = h('div', { class: 'ov', 'aria-label': 'Places on the screen' }); this.frame.appendChild(this.ov);
      this.ov.addEventListener('click', (e) => { if (e.target === this.ov) { this.sel = null; this.pick = null; this.redraw(); } });
      this.shadowRoot.addEventListener('keydown', (e) => this.keys(e));
      this.devices(); this.library(); this.side(); this.fit();
    }
    devices() {
      var h = this.h;
      this.devBar.replaceChildren.apply(this.devBar, DEVICES.map((d, i) => h('button', { type: 'button', text: d[1], 'aria-pressed': i === this.device ? 'true' : 'false',
        onclick: () => { this.device = i; this.devices(); this.fit(); this.redraw(); this.overlaySoon(); } })));
    }
    fit() {
      if (!this.box) return;
      var d = DEVICES[this.device], W = d[2], H = d[3];
      var top = this.box.offsetTop - this.stage.offsetTop;
      var s = Math.min(1, (this.stage.clientWidth || 800) / W, Math.max(200, this.stage.clientHeight - top - 12) / H);
      this.frame.style.width = W + 'px'; this.frame.style.height = H + 'px'; this.frame.style.transform = 'scale(' + s + ')';
      this.box.style.width = W * s + 'px'; this.box.style.height = H * s + 'px';
      this.scale = s;
    }
    // THE SCREENSAVER, WITH THE DRAFT: shown in the frame once its page is there, again after each change
    preview() {
      clearInterval(this.waitT);
      var n = 0, go = () => {
        var S = this.saver();
        if (!S || typeof S.preview !== 'function') return false;
        S.preview(true, null, !!this.o.house, this.still());
        // (the house's notifications too: hushed in the frame unless asked for)
        try { var N = this.iframe.contentWindow.hkNotify; if (N && N.hush) N.hush(!this.extras); } catch (e) { /* not yet */ }
        this.box.removeAttribute('data-loading');
        this.overlaySoon();
        return true;
      };
      if (!go()) this.waitT = setInterval(() => { if (go() || ++n > 120) clearInterval(this.waitT); }, 250);
    }
    // WHAT THE FRAME IS GIVEN: the options being edited, the slides held back -- the layout is what is being laid
    // out, and music playing in the house put Music Full Screen over it (2026-11-01, on the house) -- unless Slides &
    // Notifications is on (this.extras: the preview's alone, never saved; off each time the editor opens)
    still() {
      var o = copy(this.opts);
      if (this.extras) return o;
      ['music_first', 'music_slide', 'energy_slide', 'weather_slide', 'extra_music', 'extra_forecast'].forEach(function (k) { o[k] = false; });
      if (o.show === 'both') o.show = 'photos';
      return o;
    }
    // the places, once the screensaver has drawn them (it plans again as the big element and the cards draw)
    overlaySoon() {
      clearTimeout(this.ovT);
      var tries = 0, step = () => { this.overlay(); if (++tries < 6) this.ovT = setTimeout(step, tries < 3 ? 350 : 900); };
      this.ovT = setTimeout(step, 250);
    }
    overlay() {
      var S = this.saver(), info = S && S.layoutInfo && S.layoutInfo(), h = this.h;
      this.ov.replaceChildren();
      if (!info) return;
      var P = info.plan, zs = info.zones, self = this;
      this.ov.style.setProperty('--zf', Math.max(11, Math.min(info.W, info.H) * 0.026).toFixed(1) + 'px');
      var place = function (el, b) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; el.style.width = b.w + 'px'; el.style.height = b.h + 'px'; return el; };
      // (plus: the place after what a zone has, while it has room -- a + to tap, or Add Here with a widget picked)
      var zone = function (z, b, plus) {
        var want = self.pick && LM.fits(zs, z, self.pick);
        var e = place(h('button', { type: 'button', class: 'z' + (want ? ' want' : '') + (plus ? ' plus' : ''), 'data-zone': z, 'aria-pressed': self.sel === z ? 'true' : 'false',
                                    'aria-label': plus ? 'Add to ' + self.zoneName(z) : self.zoneName(z), onclick: (ev) => { ev.stopPropagation(); self.tapZone(z); } },
          [h('span', { text: want ? (plus ? '+' : 'Add Here') : plus ? '+' : self.zoneName(z) })]), b);
        self.ov.appendChild(e);
      };
      // ...room for one more of any kind the zone takes
      var room = function (z) { return Object.keys(LM.CATALOG).some(function (id) { return LM.fits(zs, z, id); }); };
      var item = function (z, i, b) {
        var w = zs[z][i];
        if (!w) return;
        var none = !!(info.empty && info.empty[w.id]);
        self.ov.appendChild(place(h('button', { type: 'button', class: 'w' + (none ? ' empty' : ''), 'aria-pressed': self.sel === z + ':' + i ? 'true' : 'false',
          'aria-label': LM.CATALOG[w.id][1] + ', ' + self.zoneName(z), onclick: (ev) => { ev.stopPropagation(); self.select(z + ':' + i); },
          onpointerdown: (ev) => self.dragStart(ev, { id: w.id, from: { z: z, i: i } }) },
          none ? [h('span', {}, [document.createTextNode(LM.CATALOG[w.id][1]), h('small', { text: LM.CATALOG[w.id][2] })])] : []), b));
      };
      // the big element, and every place a widget can go: a place with nothing in it is drawn as an outline
      if (P.big) this.ov.appendChild(place(h('button', { type: 'button', class: 'big', 'aria-pressed': this.sel === 'big' ? 'true' : 'false',
        'aria-label': 'The big element', onclick: (ev) => { ev.stopPropagation(); this.select('big'); } }), P.big));
      if (zs.line.length) item('line', 0, P.line); else if (this.T().big.kind !== 'none') zone('line', P.line);
      if (zs.row.length) {
        P.row.items.forEach(function (it) { item('row', it.i, it); });
        // ONE MORE, ALWAYS SHOWN while there is room (2026-11-01, the owner: "As soon as I add one, there is no + or
        // anything to add another"): a + as big as a widget after the last, on its line -- or under the row, a line full
        var last = P.row.items[P.row.items.length - 1];
        if (last && (this.pick ? LM.fits(zs, 'row', this.pick) : room('row'))) {
          var units = zs.row.reduce(function (n, w) { return n + (LM.UNITS[LM.CATALOG[w.id][0]] || 1); }, 0);
          var full = units % LM.ROW_LINE === 0, d = last.h;
          zone('row', full ? { x: P.row.box.x + P.row.box.w / 2 - d / 2, y: P.row.box.y + P.row.box.h + 14, w: d, h: d }
                           : { x: last.x + last.w + 14, y: last.y, w: d, h: d }, true);
        }
      } else if (this.T().big.kind !== 'none') zone('row', P.row.box);
      ['tl', 'tr', 'bl', 'br'].forEach(function (z) {
        (P.corners[z] || []).forEach(function (b) { item(z, b.i, b); });
        if (P.ghosts[z]) zone(z, P.ghosts[z]);
        else if ((self.pick ? LM.fits(zs, z, self.pick) : room(z)) && P.corners[z] && P.corners[z].length) {
          // (after the stack: under a top corner's, over a bottom one's; a + at its side's edge)
          // (by where the stack is: a top corner's moved out of the big element's way stands at the bottom)
          var last = P.corners[z][P.corners[z].length - 1], up = last.y > info.H / 2, d = Math.max(40, Math.min(64, info.H * 0.07)), left = z[1] === 'l';
          zone(z, { x: self.pick ? last.x : left ? last.x : last.x + last.w - d, y: up ? last.y - (self.pick ? 70 : d + 12) : last.y + last.h + 12,
                    w: self.pick ? Math.max(200, last.w) : d, h: self.pick ? 60 : d }, !self.pick);
        }
      });
      // (the band's empty place only while a band is being added: drawn always, it lay over the bottom corners)
      if (zs.bottom.length) item('bottom', 0, P.bottom); else if (this.pick && LM.fits(zs, 'bottom', this.pick)) zone('bottom', P.bottom);
      P.moved.forEach(function (mv) {
        var b = (P.corners[mv.zone] || []).find(function (c) { return c.i === mv.i; });
        var t = h('div', { class: 'moved', text: mv.to ? 'Moved out of the big element’s way' : 'Left out: no room beside the big element' });
        if (b) { t.style.left = b.x + 'px'; t.style.top = (b.y > info.H / 2 ? b.y - 40 : b.y + b.h + 8) + 'px'; }
        else { t.style.left = '24px'; t.style.top = (mv.zone[0] === 't' ? 24 : info.H - 64) + 'px'; }
        self.ov.appendChild(t);
      });
    }

    // ------------------------------------------------------------ changes
    change(fn) {
      var before = copy(this.opts);
      fn(this.opts);
      if (JSON.stringify(before) === JSON.stringify(this.opts)) return;
      this.undoStack.push({ opts: before, sel: this.sel });
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.undoButton.disabled = false; this.say('');
      this.redraw(); this.preview();
    }
    undo() {
      var last = this.undoStack.pop();
      if (!last || this.busy) return;
      this.opts = last.opts; this.sel = last.sel; this.pick = null;
      this.undoButton.disabled = !this.undoStack.length;
      this.redraw(); this.preview(); this.say('Undone.', true);
    }
    redraw() { this.library(); this.side(); this.overlay(); }
    select(s) { this.sel = s; this.pick = null; this.redraw(); }
    tapZone(z) {
      if (this.pick) {
        var id = this.pick;
        if (!LM.fits(this.T().zones, z, id)) { this.say('That doesn’t fit there: ' + LM.ZONE_NAMES[z] + ' takes ' + this.takes(z) + '.'); return; }
        this.pick = null;
        this.change((o) => { this.T(o).zones[z].push(W(id)); this.sel = z + ':' + (this.T(o).zones[z].length - 1); });
        return;
      }
      this.select(z);
    }
    // a zone's name: the row says where it is
    zoneName(z) { return z === 'row' && (this.T().row_at === 'bottom') ? 'The Row, Along the Bottom' : LM.ZONE_NAMES[z]; }
    takes(z) { return LM.ZONES[z][0].map(function (k) { return { circular: 'circular', rectangular: 'rectangular', inline: 'inline', card: 'card', band: 'band' }[k]; }).join(' or ') + ' widgets'; }
    pickWidget(id) {
      var z = this.sel && LM.ZONES[this.sel] ? this.sel : null;
      if (z && LM.fits(this.T().zones, z, id)) { this.change((o) => { this.T(o).zones[z].push(W(id)); this.sel = z + ':' + (this.T(o).zones[z].length - 1); }); return; }
      if (this.pick === id) { this.pick = null; this.redraw(); return; }
      if (!Object.keys(LM.ZONES).some((zz) => LM.fits(this.T().zones, zz, id))) { this.say('No room for ' + LM.CATALOG[id][1] + ': remove something from a place that takes ' + LM.CATALOG[id][0] + ' widgets first.'); return; }
      this.pick = id; this.sel = null; this.say('Tap a green place on the screen to put ' + LM.CATALOG[id][1] + ' there.', true);
      if (this.hasAttribute('previewing')) this.togglePreview();
      this.redraw();
    }
    // DRAGGED ONTO THE SCREEN (2026-11-01, the owner: "are we not able to drag items from the picker/editor on the left
    // side into the areas we want them like HomeGrid?"): a widget from the left, or one on the screen to another place,
    // with a mouse -- the green places it fits light up, the one under the pointer brighter, and it is put where it is
    // let go; let go anywhere else and nothing changes. A finger keeps tap, then a green place (a touch on the list
    // scrolls it). `src`: { id } from the left, { id, from: { z, i } } from the screen
    dragStart(e, src) {
      if (e.button !== 0 || e.pointerType === 'touch' || this.busy) return;
      var self = this, x0 = e.clientX, y0 = e.clientY, chip = null, over = null, armed = false;
      e.preventDefault();
      var move = function (ev) {
        if (!armed) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
          armed = true;
          if (self.hasAttribute('previewing')) self.togglePreview();
          self.pick = src.id; self.sel = null; self.redraw();
          chip = self.h('div', { class: 'dragchip', text: LM.CATALOG[src.id][1] });
          self.shadowRoot.appendChild(chip);
        }
        chip.style.left = ev.clientX + 'px'; chip.style.top = ev.clientY + 'px';
        var el = self.shadowRoot.elementFromPoint(ev.clientX, ev.clientY), z = el && el.closest ? el.closest('.z.want') : null;
        if (over && over !== z) over.classList.remove('hover');
        over = z;
        if (z) z.classList.add('hover');
      };
      var up = function (ev) {
        window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
        if (!armed) return;                                   // (a click: tap, as before)
        if (chip) chip.remove();
        // (the click that follows a drag is the drag's, not a tap)
        var eat = function (c) { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener('click', eat, true);
        setTimeout(function () { window.removeEventListener('click', eat, true); }, 0);
        var zone = ev.type === 'pointerup' && over ? over.getAttribute('data-zone') : null;
        if (!zone) { self.pick = null; self.redraw(); self.say('Let go on a green place to put ' + LM.CATALOG[src.id][1] + ' there.', true); return; }
        if (src.from) self.moveTo(src.from, zone); else self.tapZone(zone);
      };
      window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    }
    // a widget on the screen to another place, last in it
    moveTo(from, z) {
      this.pick = null;
      if (from.z === z) { this.redraw(); return; }
      this.change((o) => {
        var L = this.T(o).zones, it = L[from.z].splice(from.i, 1)[0];
        if (!it) return;
        L[z].push(it); this.sel = z + ':' + (L[z].length - 1);
      });
      this.say(LM.CATALOG[this.T().zones[z][this.T().zones[z].length - 1].id][1] + ' moved to ' + this.zoneName(z) + '. Undo (⌘Z) puts it back.', true);
    }
    remove(z, i) {
      var w = this.T().zones[z][i];
      this.change((o) => { this.T(o).zones[z].splice(i, 1); this.sel = null; });
      if (w) this.say(LM.CATALOG[w.id][1] + ' removed. Undo (⌘Z) puts it back.', true);
    }
    keys(e) {
      var path = e.composedPath ? e.composedPath() : [e.target];
      if (path.find((el) => el.matches && el.matches('input,select,textarea'))) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if (e.key === 'Escape' && (this.pick || this.sel)) { e.preventDefault(); this.pick = null; this.sel = null; this.say(''); this.redraw(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && this.sel.indexOf(':') > 0) {
        e.preventDefault(); var p = this.sel.split(':'); this.remove(p[0], +p[1]);
      }
    }
    togglePreview() {
      var on = !this.hasAttribute('previewing');
      this.toggleAttribute('previewing', on);
      this.modeButton.textContent = on ? 'Edit' : 'Preview';
      if (on) { this.sel = null; this.pick = null; this.redraw(); }
    }
    async cancel() {
      if (this.busy) return;
      if (this.dirty() && !await this.K.confirm(this.shadowRoot, { title: 'Discard Changes?', message: 'The screensaver stays as it was.', ok: 'Discard', destructive: true })) return;
      this.o.onCancel();
    }
    async save() {
      if (this.busy) return;
      var code = LM.check(this.opts.layout);
      if (code) { this.say('This layout can’t be saved: something is in a place that doesn’t take it. Undo the last change and try again.'); return; }
      this.busy = true; this.saveButton.disabled = true; this.say('Saving…', true);
      try {
        var put = this.o.house ? this.panel.saverPutH() : this.panel.saverPutB(this.o.path);
        await put(copy(this.opts));
        this.initial = JSON.stringify(this.opts);
        this.o.onSaved();
      } catch (e) {
        this.say('Couldn’t save. ' + (e && e.message || e));
      } finally { this.busy = false; this.saveButton.disabled = false; }
    }

    // ------------------------------------------------------------ the library
    library() {
      var h = this.h, K = this.K, self = this, kids = [];
      kids.push(h('div', { class: 'lib-head' }, [h('p', { text: 'Start from a look, or add widgets: tap one, then tap a green place on the screen.' }),
        this.pick ? h('div', { class: 'pick-banner' }, [h('span', { text: 'Adding ' + LM.CATALOG[this.pick][1] }),
          h('button', { type: 'button', text: 'Cancel', onclick: () => { this.pick = null; this.say(''); this.redraw(); } })]) : null]));
      kids.push(K.group({ header: 'Starters', footer: 'Each of today’s screensavers as a layout you can change. Your albums, timing and other settings stay.' },
        STARTERS.map(function (st) {
          var thumb = h('span', { class: 'thumb' }), o = Object.assign({}, self.opts, st[2]);
          try { var t = self.panel.saverThumb(72, 45, thumbOf(bgOf(o), o), o); if (t) thumb.appendChild(t); } catch (e) { /* a plain one */ }
          return h('button', { type: 'button', class: 'starter-row', onclick: () => self.starter(st) }, [thumb, h('span', { class: 'st' }, [h('b', { text: st[0] }), h('small', { text: st[1] })])]);
        })));
      var client = null;
      try { client = this.iframe && this.iframe.contentWindow && this.iframe.contentWindow.hkCards && this.iframe.contentWindow.hkCards.client(); } catch (e) { /* not yet */ }
      KINDS.forEach(function (k) {
        var ids = Object.keys(LM.CATALOG).filter(function (id) { return LM.CATALOG[id][0] === k[0]; });
        var grid = h('div', { class: 'wgrid' }, ids.map(function (id) {
          var c = LM.CATALOG[id], pv = h('span', { class: 'pv' });
          if (WG && WG.has(id)) {
            try { var ctl = WG.create(id, { u: 4, back: 'none', color: 'auto' }); ctl.update(client || { states: {} }, new Date(), { title: 'Lake Weekend · 2024' }); pv.appendChild(ctl.el); } catch (e) { /* its name alone */ }
          } else pv.appendChild(h('hk-icon', { icon: { clock_card: 'mdi:clock', music_card: 'mdi:music', timers_card: 'mdi:timer-outline', weather_card: 'mdi:weather-partly-cloudy', status_card: 'mdi:shield-home', forecast_band: 'mdi:weather-cloudy' }[id] || 'mdi:view-grid' }));
          return h('button', { type: 'button', class: 'witem' + (k[0] === 'circular' ? '' : ' wide'), 'aria-pressed': self.pick === id ? 'true' : 'false',
                               onclick: () => self.pickWidget(id), onpointerdown: (ev) => self.dragStart(ev, { id: id }) },
                   [pv, h('b', { text: c[1] }), h('small', { text: c[2] })]);
        }));
        kids.push(K.group({ header: k[1], footer: k[2] }, [grid]));
      });
      var keep = this.palette.scrollTop;
      this.palette.replaceChildren.apply(this.palette, kids);
      this.palette.scrollTop = keep;
    }
    starter(st) {
      this.change((o) => {
        Object.assign(o, st[2]);
        o.layout = st[3] ? copy(st[3]) : LM.layoutFrom(o);
        this.sel = null; this.pick = null;
      });
      this.say(st[0] + ' laid out. Undo (⌘Z) puts back what you had.', true);
    }

    // ------------------------------------------------------------ the inspector
    head(icon, title, sub) {
      var h = this.h;
      var L = this.opts.layout, upr = this.upright() && L.upright && L.upright.big && L.upright.zones;
      if (upr && this.sel) sub = sub + ' \u00b7 Upright Layout';
      return h('div', { class: 'insp-head' }, [h('hk-icon', { icon: icon }), h('div', {}, [h('h2', { text: title }), h('p', { text: sub })]),
        this.sel ? h('button', { class: 'done', type: 'button', text: 'Done', onclick: () => this.select(null) }) : null]);
    }
    side() {
      var keep = this._for === this.sel ? this.sidebar.scrollTop : 0;
      this._for = this.sel;
      this.sidebar.replaceChildren();
      if (this.sel === 'big') this.bigPage();
      else if (this.sel && this.sel.indexOf(':') > 0) this.widgetPage(this.sel.split(':')[0], +this.sel.split(':')[1]);
      else if (this.sel && LM.ZONES[this.sel]) this.zonePage(this.sel);
      else this.screenPage();
      this.sidebar.scrollTop = keep;
    }
    screenPage() {
      var h = this.h, K = this.K, M = this.M, o = this.opts, self = this, add = (n) => this.sidebar.appendChild(n), bg = bgOf(o);
      add(this.head('mdi:image-multiple', 'Screensaver', this.o.house ? 'All Screens' : this.o.title));
      add(K.group({ header: 'Background', footer: 'What is behind everything. Photos, the Forecast and the Clock are the same screensaver with a different background.' },
        BGS.map(function (b) {
          var thumb = null;
          try { var ob = Object.assign({}, o, b[3]); if (b[0] === 'color' && bgOf(o) === 'color') ob.clock_bg = o.clock_bg; thumb = self.panel.saverThumb(64, 40, thumbOf(b[0], ob), ob); } catch (e) { /* none */ }
          return K.check({ label: b[1], sub: b[2], on: bg === b[0], thumb: thumb || undefined, onClick: function () {
            self.change(function (x) {
              var keepBoth = b[0] === 'photos' && x.show === 'both';
              Object.assign(x, b[3]);
              if (keepBoth) x.show = 'both';
              // what the big element can't do over this background, it stops doing (sideways and upright)
              [x.layout.big].concat(x.layout.upright && x.layout.upright.big ? [x.layout.upright.big] : []).forEach(function (B) {
                if (B.depth === 'planted' && b[0] !== 'landscape') B.depth = 'front';
                if (B.depth === 'behind' && b[0] !== 'photos' && b[0] !== 'landscape') B.depth = 'front';
                if (B.pos === 'ground' && b[0] !== 'landscape') B.pos = 'lower';
              });
            });
          } });
        })));
      if (bg === 'color') add(K.group({}, [
        K.select({ label: 'Pattern', value: COLOR_BGS.some(function (c) { return c[0] === o.clock_bg; }) ? o.clock_bg : 'aurora', options: COLOR_BGS,
                   onChange: function (v) { self.change(function (x) { x.clock_bg = v; }); } }),
        K.slider({ label: 'Speed', value: o.clock_speed, min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { self.change(function (x) { x.clock_speed = v; }); } }),
        K.slider({ label: 'Depth', value: o.clock_depth, min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { self.change(function (x) { x.clock_depth = v; }); } })]));
      if (bg === 'dayart') add(K.group({}, [K.seg({ label: 'Look', value: o.day_look || 'auto', options: M.DAY_LOOKS, onChange: function (v) { self.change(function (x) { x.day_look = v; }); } })]));
      if (bg === 'soft') add(K.group({}, [K.slider({ label: 'Darken', value: o.clock_photo_dim, min: 0, max: 80, step: 5, unit: '%', onChange: function (v) { self.change(function (x) { x.clock_photo_dim = v; }); } })]));
      if (bg === 'photos') add(K.group({}, [K.slider({ label: 'Darken', value: o.tb_dim || 0, min: 0, max: 80, step: 5, unit: '%', onChange: function (v) { self.change(function (x) { x.tb_dim = v; }); } })]));
      var more = this.o.house ? '#/house/screensaver' : '#/screens/' + encodeURIComponent(this.o.path) + '/screensaver';
      add(K.group({ footer: 'Your albums, the order and timing of the photos, the mosaic, each kind of photo’s fit and focus' + (bg === 'wallpaper' ? ', which wallpaper' : '') +
          ', the slides’ options, Night Mode and when it starts: on the Screensaver page. Everything you see is set here.' },
        [K.nav({ label: bg === 'wallpaper' ? 'Choose the Wallpaper, Photos and More' : 'Photos, Slides and Timing', href: more })]));
      add(K.group({ header: 'Slides', footer: 'What comes between, every so often. The screen here leaves them out, so the layout stays in view.' }, [
        bg === 'photos' ? K.toggle({ label: 'The Forecast Between Photos', sub: 'Every ' + (o.forecast_every || 10) + ' photos', on: o.show === 'both',
          onChange: function (on) { self.change(function (x) { x.show = on ? 'both' : 'photos'; }); } }) : null,
        K.toggle({ label: 'Music Full Screen', sub: 'While something plays', on: !!o.music_first, onChange: function (on) { self.change(function (x) { x.music_first = on; }); } }),
        K.toggle({ label: 'Home Energy', on: !!o.energy_slide, onChange: function (on) { self.change(function (x) { x.energy_slide = on; }); } }),
        K.toggle({ label: 'Weather', on: !!o.weather_slide, onChange: function (on) { self.change(function (x) { x.weather_slide = on; }); } })]));
      var L0 = o.layout, own = !!(L0.upright && L0.upright.big && L0.upright.zones);
      add(K.group({ header: 'Upright Screens', footer: own ? 'An iPad held upright and a phone have a layout of their own: show iPad Upright or Phone above to change it.'
          : 'An iPad held upright and a phone show this same layout, fitted to their shape.' }, [
        K.seg({ label: 'Layout', value: own ? 'own' : 'same', options: [['same', 'Same as Sideways'], ['own', 'Its Own']], stack: true, onChange: function (v) {
          self.change(function (x) { x.layout.upright = v === 'own' ? { big: copy(x.layout.big), zones: copy(x.layout.zones) } : null; });
          if (v === 'own' && !self.upright()) { self.device = 1; self.devices(); self.fit(); self.redraw(); self.overlaySoon(); }
        } })]));
      add(K.group({ header: 'Layout', footer: 'Today’s Look puts back how this screensaver was laid out before the editor. Without a layout it is drawn exactly as before.' }, [
        K.button({ label: 'Back to Today’s Look', onClick: function () { self.change(function (x) { x.layout = LM.layoutFrom(Object.assign({}, x, { layout: null })); }); } })]));
    }
    bigPage() {
      var K = this.K, M = this.M, self = this, o = this.opts, B = this.T(o).big, bg = bgOf(o), add = (n) => this.sidebar.appendChild(n);
      var set = function (k) { return function (v) { self.change(function (x) { self.T(x).big[k] = v; }); }; };
      add(this.head('mdi:clock', 'The Big Element', 'What the screen is about'));
      add(K.group({ footer: 'The time, the temperature, the date or the month, very large.' },
        [K.seg({ label: 'Shows', value: B.kind, options: BIG_KINDS, stack: true, onChange: set('kind') })]));
      if (B.kind === 'none') return;
      if (B.kind === 'time') {
        var colors = (M.CLOCK_COLORS || {})[o.clock_style] || [];
        add(K.group({ header: 'The Time', footer: 'Every face of the Clock’s, each keeping its own colors.' }, [
          K.select({ label: 'Face', value: o.clock_style, options: M.CLOCK_STYLES.map(function (s) { return [s[0], s[1]]; }),
                     onChange: function (v) { self.change(function (x) { x.clock_style = v; }); } }),
          colors.length ? K.select({ label: 'Color', value: (o.clock_colors || {})[o.clock_style] || colors[0][0], options: colors,
                     onChange: function (v) { self.change(function (x) { x.clock_colors = Object.assign({}, x.clock_colors || {}); x.clock_colors[x.clock_style] = v; }); } }) : null,
          K.toggle({ label: '24-Hour Time', on: !!o.clock_24, onChange: function (on) { self.change(function (x) { x.clock_24 = on; }); } })]));
      }
      var pos = [['top', 'Top'], ['upper', 'Upper'], ['center', 'Center'], ['lower', 'Lower']].concat(bg === 'landscape' ? [['ground', 'On the Ground']] : []);
      var depth = [['front', 'In Front']].concat(bg === 'photos' && B.kind === 'time' ? [['behind', 'Behind the Subject']] : [])
        .concat(bg === 'landscape' ? [['behind', 'Behind the Land']] : [])
        .concat(bg === 'landscape' && B.kind === 'time' ? [['planted', 'Planted']] : []);
      add(K.group({ header: 'Size and Place', footer: 'Everything else moves out of its way: nothing is ever drawn over it.' }, [
        K.slider({ label: 'Size', value: B.size, min: LM.BIG.size[0], max: LM.BIG.size[1], unit: '%', onChange: set('size') }),
        K.seg({ label: 'Position', value: B.pos, options: pos, stack: true, onChange: set('pos') }),
        B.depth === 'behind' && bg === 'photos' ? null : K.seg({ label: 'Align', value: B.align, options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], onChange: set('align') })]));
      // (over photos -- yours, soft, or HK's own -- a soft shadow and an outline keep it readable: Clock's Text Shadow and Outline)
      if (bg === 'photos' || bg === 'soft' || bg === 'landscapes') add(K.group({ header: 'Legibility', footer: 'Over a busy photo: a soft shadow under it, and an outline around it.' }, [
        K.slider({ label: 'Shadow', value: o.clock_text_shadow, min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { self.change(function (x) { x.clock_text_shadow = v; }); } }),
        K.slider({ label: 'Outline', value: o.clock_text_outline, min: 0, max: 100, step: 5, unit: '%', onChange: function (v) { self.change(function (x) { x.clock_text_outline = v; }); } })]));
      if (depth.length > 1) add(K.group({ header: 'Depth', footer: B.depth === 'behind' && bg === 'landscape' ? 'The hills and the trees stand in front of its foot: Upper shows the most of it, Center the least.' : B.depth === 'behind' ? 'The photo’s subject stands in front of the time, where a photo has a usable cut-out; otherwise the time is in front. It stays centered.'
          : B.depth === 'planted' ? 'Solid figures standing in the meadow, their shadows cast by the sky’s sun.' : 'Behind: the photo’s subject in front of it, as on the iPhone’s lock screen.' },
        [K.seg({ label: 'Stands', value: B.depth, options: depth, stack: true, onChange: function (v) {
          self.change(function (x) {
            self.T(x).big.depth = v;
            if (v === 'planted') { self.T(x).big.pos = 'ground'; x.forecast_planted = true; }
            // (behind the land, only what stands in the sky shows: low, it would be gone)
            if (v === 'behind' && bg === 'landscape' && ['lower', 'ground', 'center'].indexOf(self.T(x).big.pos) >= 0) self.T(x).big.pos = 'upper';
          });
        } })]));
    }
    widgetPage(z, i) {
      var K = this.K, self = this, w = this.T().zones[z][i], add = (n) => this.sidebar.appendChild(n);
      if (!w) { this.sel = null; return this.screenPage(); }
      var c = LM.CATALOG[w.id], isBand = w.id === 'forecast_band';
      var set = function (k) { return function (v) { self.change(function (x) { self.T(x).zones[z][i][k] = v; }); }; };
      add(this.head('mdi:view-grid', c[1], c[2] + ' · ' + this.zoneName(z)));
      // THE SAME LOOK FOR EVERYTHING (2026-11-01, the owner: "Its strange that some things get design elements and
      // others don't"): a widget's or a card's size, its backdrop and its color
      if (!isBand) add(K.group({ header: 'Look', footer: 'Auto takes its color from what is behind it, as the lock screen does. Size is against its usual size; the others move to make room.' }, [
        K.slider({ label: 'Size', value: w.size || 100, min: LM.ITEM_SIZE[0], max: LM.ITEM_SIZE[1], step: 5, unit: '%',
                   onChange: function (v) { self.change(function (x) { var it = self.T(x).zones[z][i]; if (v === 100) delete it.size; else it.size = v; }); } }),
        K.seg({ label: 'Backdrop', value: w.back, options: [['none', 'None'], ['glass', 'Glass'], ['tint', 'Tinted']], onChange: set('back') }),
        K.seg({ label: 'Color', value: w.color, options: [['auto', 'Auto'], ['white', 'White'], ['accent', 'Accent']], onChange: set('color') })]));
      if (z === 'row') add(this.rowAt());
      if (w.id === 'music_card') add(K.group({ header: 'While Music Plays' }, [K.toggle({ label: 'Music Full Screen', sub: 'Off: here, in its place', on: !!this.opts.music_first,
        onChange: function (on) { self.change(function (x) { x.music_first = on; }); } })]));
      // its place: any other that takes it
      var zs = this.T().zones, places = Object.keys(LM.ZONES).filter(function (zz) { return zz === z || LM.fits(zs, zz, w.id); });
      var list = zs[z];
      add(K.group({ header: 'Place' }, [
        places.length > 1 ? K.select({ label: 'Where', value: z, options: places.map(function (zz) { return [zz, self.zoneName(zz)]; }), onChange: function (to) {
          self.change(function (x) { var it = self.T(x).zones[z].splice(i, 1)[0]; self.T(x).zones[to].push(it); self.sel = to + ':' + (self.T(x).zones[to].length - 1); });
        } }) : null,
        list.length > 1 && i > 0 ? K.button({ label: z === 'row' || z === 'line' ? 'Move Left' : 'Move Toward the Edge', onClick: function () {
          self.change(function (x) { var l = self.T(x).zones[z], t = l[i - 1]; l[i - 1] = l[i]; l[i] = t; self.sel = z + ':' + (i - 1); }); } }) : null,
        list.length > 1 && i < list.length - 1 ? K.button({ label: z === 'row' || z === 'line' ? 'Move Right' : 'Move Away from the Edge', onClick: function () {
          self.change(function (x) { var l = self.T(x).zones[z], t = l[i + 1]; l[i + 1] = l[i]; l[i] = t; self.sel = z + ':' + (i + 1); }); } }) : null]));
      add(K.group({}, [K.button({ label: 'Remove ' + c[1], destructive: true, onClick: function () { self.remove(z, i); } })]));
    }
    // WHERE THE ROW GOES (2026-11-01, the owner: "I may want it all the way at the bottom and not below the clock...
    // as that tends to be where faces are in pictures")
    rowAt() {
      var K = this.K, self = this;
      return K.group({ header: 'The Row', footer: 'Along the Bottom keeps the middle of a photo clear; the bottom corners stand beside the row, or above it where they would meet.' }, [
        K.seg({ label: 'Where', value: this.T().row_at || 'under', options: [['under', 'Under the Big Element'], ['bottom', 'Along the Bottom']],
                onChange: function (v) { self.change(function (x) { self.T(x).row_at = v; }); } })]);
    }
    zonePage(z) {
      var K = this.K, self = this, h = this.h, add = (n) => this.sidebar.appendChild(n), zs = this.T().zones;
      add(this.head('mdi:plus', this.zoneName(z), 'Takes ' + this.takes(z)));
      if (z === 'row') add(this.rowAt());
      var fit = Object.keys(LM.CATALOG).filter(function (id) { return LM.fits(zs, z, id); });
      if (!fit.length) { add(h('p', { class: 'note', text: 'This place is full. Remove something from it first.' })); return; }
      add(K.group({ header: 'Add', footer: z === 'row' ? 'Two lines of four: a circular widget is one, a rectangular two, as on the iPhone. A fifth starts the second line.' : null },
        fit.map(function (id) { return K.button({ label: LM.CATALOG[id][1], onClick: function () {
          self.change(function (x) { self.T(x).zones[z].push(W(id)); self.sel = z + ':' + (self.T(x).zones[z].length - 1); });
        } }); })));
    }
  }
  window.hkSaverEditor = { BGS: BGS, STARTERS: STARTERS, bgOf: bgOf };
  customElements.define('hk-saver-editor', SaverEditor);
})();
