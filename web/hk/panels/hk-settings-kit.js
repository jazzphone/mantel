// hk-settings-kit.js -- THE HK SETTINGS PAGE'S CONTROLS.
//
// The parts an Apple settings screen is made of, and nothing else: inset
// grouped lists with a header and a footer, rows that push a page (›), a
// switch, a segmented control, a pop-up menu (the system's own <select>, so a
// Mac and an iPhone draw their own menu), a slider, a text row, a checkmark
// row, a destructive button, an alert, a YAML editor (the page's own, since
// Phase 2 P2.4: no host's form element draws any of it). And the one list every "which, in
// what order" setting uses: Control Center's Include / More editor -- an
// Automatic switch, the Shown rows (remove, drag or arrow keys to move) and
// the More rows (add).
//
// Every control is a real button/input with an accessible name; the page
// (hk-settings.js) owns the data and saving. `fk` on a control is its focus
// key: the page puts focus back on it after a redraw.
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  if (root.hkSettingsKit) return;

  var uid = 0;
  function id(p) { return (p || 'hk') + '-' + (++uid); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // h('div', {class: 'x', onclick: f}, [children | text])
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k in { value: 1, checked: 1, disabled: 1, hidden: 1, placeholder: 1, type: 1, href: 1, src: 1, title: 1 } && k !== 'href') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    (Array.isArray(kids) ? kids : kids == null ? [] : [kids]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  function icon(name, cls) { return h('hk-icon', { icon: name, class: cls || 'ic', 'aria-hidden': 'true' }); }

  // ------------------------------------------------------------ the look
  // Apple's system colors and materials, light and dark (:host([dark])).
  var CSS = [
    // (the light secondary label, blue and red are Apple's a shade deeper,
    // so small text meets WCAG AA: 4.8:1 and better on the grouped gray)
    ':host{--hk-bg:#f2f2f7;--hk-cell:#fff;--hk-hover:rgba(0,0,0,.035);--hk-press:rgba(0,0,0,.08);',
    '  --hk-label:#000;--hk-label2:rgba(60,60,67,.75);--hk-label3:rgba(60,60,67,.3);--hk-sep:rgba(60,60,67,.2);',
    '  --hk-tint:#0066dd;--hk-sel:#0066dd;--hk-green:#34c759;--hk-red:#d70015;--hk-orange:#c93400;--hk-gray:#8e8e93;',
    '  --hk-fill:rgba(120,120,128,.12);--hk-seg:rgba(118,118,128,.12);--hk-seg-on:#fff;--hk-off:#e9e9eb;',
    '  --hk-bar:rgba(242,242,247,.82);--hk-shadow:0 3px 8px rgba(0,0,0,.12),0 3px 1px rgba(0,0,0,.04);',
    '  --hk-font:-apple-system,BlinkMacSystemFont,"SF Pro",system-ui,"Helvetica Neue",sans-serif;',
    '  --hk-display:-apple-system,BlinkMacSystemFont,"SF Pro",system-ui,"Helvetica Neue",sans-serif;',
    '  --hk-body:16px;--hk-row:44px;',
    '  display:block;height:100%;background:var(--hk-bg);color:var(--hk-label);font-family:var(--hk-font);',
    '  font-size:var(--hk-body);line-height:1.3;-webkit-font-smoothing:antialiased;letter-spacing:-.01em;',
    '  -webkit-tap-highlight-color:transparent}',
    ':host([dark]){--hk-bg:#000;--hk-cell:#1c1c1e;--hk-hover:rgba(255,255,255,.04);--hk-press:rgba(255,255,255,.1);',
    '  --hk-label:#fff;--hk-label2:rgba(235,235,245,.6);--hk-label3:rgba(235,235,245,.3);--hk-sep:rgba(84,84,88,.55);',
    '  --hk-tint:#0a84ff;--hk-sel:#0a66d6;--hk-green:#30d158;--hk-red:#ff453a;--hk-orange:#ff9f0a;',
    '  --hk-fill:rgba(118,118,128,.24);--hk-seg:rgba(118,118,128,.24);--hk-seg-on:#636366;--hk-off:#39393d;',
    '  --hk-bar:rgba(0,0,0,.72);--hk-shadow:0 3px 8px rgba(0,0,0,.5)}',
    '@media (pointer:coarse){:host{--hk-body:17px}}',
    '*{box-sizing:border-box}',
    'a{color:var(--hk-tint);text-decoration:none}',
    'button{font:inherit;color:inherit}',
    ':focus-visible{outline:3px solid color-mix(in srgb,var(--hk-tint) 55%,transparent);outline-offset:2px;border-radius:8px}',
    // GROUPS
    '.grp{margin:0 0 30px}',
    // A NOTE ALONE (a group of no rows and no header, after another group)
    // reads as that group's footer: no empty card, and up under it
    '.cells:empty{display:none}',
    '.grp + .grp:not(:has(> .gh)):has(> .cells:empty){margin-top:-23px}',
    '.gh{margin:0;padding:0 16px 7px;font-size:13px;font-weight:400;line-height:18px;text-transform:uppercase;',
    '  letter-spacing:0;color:var(--hk-label2)}',
    '.cells{background:var(--hk-cell);border-radius:10px;overflow:hidden}',
    '.gf{margin:0;padding:7px 16px 0;font-size:13px;line-height:18px;color:var(--hk-label2)}',
    '.gf a{font-weight:400}',
    // CELLS
    '.cell{position:relative;display:flex;align-items:center;gap:12px;min-height:var(--hk-row);padding:6px 16px;',
    '  width:100%;border:0;background:none;text-align:left;color:inherit}',
    // THE LINE IS A BORDER, not a box filled with it: a browser lays a box
    // on whole CSS pixels, which on a Mac's display (WebKit, at 1.7x or 1.5x
    // over Screen Sharing; at 2x the half-pixel line) fall between device
    // pixels -- the line was split over two rows at half strength and read
    // as missing (the row under Blur Mode's first, 2026-10-10). A border
    // is snapped to whole device pixels: measured in WebKit and Chrome at
    // 1x, 1.5x, 1.7x and 2x, every line at full strength.
    '.cell + .cell::before,.cell + .cellwrap::before,.cellwrap + .cell::before,.cellwrap + .cellwrap::before{content:"";position:absolute;top:0;right:0;left:16px;height:0;',
    '  border-top:1px solid var(--hk-sep)}',
    // HALF A PIXEL ONLY WHERE A PIXEL HALVES: at 2x and more, one device
    // pixel, as iOS draws it
    '@media (min-resolution:2dppx){.cell + .cell::before,.cell + .cellwrap::before,.cellwrap + .cell::before,.cellwrap + .cellwrap::before{',
    '  border-top-width:.5px}}',
    '.cellwrap{position:relative}',
    // A SEPARATOR STARTS WHERE ITS ROW'S TEXT DOES (the row below it): after
    // a 22 px glyph, a 30 px tile, a list's remove button, or both
    '.cell + .cell.hasic::before{left:50px}',
    '.cell + .cell.hasic:has(> .tile)::before{left:58px}',
    '.cell + .cell.li:not(.bare)::before{left:54px}',
    '.cell + .cell.li.hasic:not(.bare)::before{left:88px}',
    '.cell + .cell.li.hasic:not(.bare):has(> .tile)::before{left:96px}',
    'a.cell,button.cell{cursor:pointer}',
    '@media (hover:hover){a.cell:hover,button.cell:hover{background:var(--hk-hover)}}',
    'a.cell:active,button.cell:active{background:var(--hk-press)}',
    '.lbl{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
    // A LABEL AND A VALUE THAT DON'T BOTH FIT (a phone): a long value gives
    // way and the label keeps its one line (up to 62%) -- never "Feels /
    // Like" beside a half-shown value; a short value ("Photos & Forecast")
    // keeps its words and the label wraps instead (2026-09-30). Not in a
    // list's rows, whose short names and placements share the row as they are.
    // (fitRow decides which: `lkeep` -- the label keeps its line, the value
    // gives way; `vkeep` -- a short value keeps its word, the label wraps)
    '.cell.lkeep > .lbl{flex:0 0 auto;max-width:62%}',
    '.cell.lkeep > .val,.cell.lkeep > .pop{flex:1 1 0;min-width:0;justify-content:flex-end}',
    '.cell.vkeep > .val,.cell.vkeep > .pop{flex:0 0 auto;max-width:60%}',
    // the title and the whole value fit side by side: the value keeps every
    // word and a long subtitle wraps under the title instead (2026-10-09: a
    // subtitle squeezed "6" and "10 · Adjusted" to "…" on a phone)
    '.cell.vfull > .val,.cell.vfull > .pop{flex:0 0 auto}',
    '.cell.fitm > .lbl,.cell.fitm > .val,.cell.fitm > .pop{flex:none !important;max-width:none !important}',
    '.cell.fitm > .lbl .t{white-space:nowrap}',
    // never narrower than its longest word ("Camer / a" beside a long value,
    // 2026-09-30); a word longer than the whole row still breaks
    // WHOLE-PIXEL LINES: at the font's own line height a row with a second
    // line was 50.69 px tall, every row under it sat on a fraction of a
    // pixel, and their half-pixel separators came and went
    '.lbl .t{overflow-wrap:break-word;line-height:21px}',
    '.cell > .lbl{min-width:min-content;max-width:100%}',
    // an entity id under a name breaks where it must, never past the row
    '.lbl small{font-size:13px;line-height:17px;color:var(--hk-label2);overflow-wrap:anywhere}',
    '.val{flex:0 1 auto;min-width:0;color:var(--hk-label2);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.chev{flex:none;width:8px;height:13px;margin-left:-2px;color:var(--hk-label3)}',
    '.tile{flex:none;width:30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;',
    '  color:#fff;--mdc-icon-size:19px}',
    '.ic{--mdc-icon-size:22px;color:var(--hk-label2);flex:none}',
    '.cell.tintc{color:var(--hk-tint)}',
    '.cell.redc{color:var(--hk-red)}',
    '.cell.center{justify-content:center}',
    // its label is a stretching flex item: centered, it has to stop stretching
    '.cell.center .lbl{flex:0 1 auto;text-align:center}',
    '.cell[aria-disabled="true"]{opacity:.45;pointer-events:none}',
    '.cell .err{color:var(--hk-red)}',
    '.errline{padding:0 16px 10px;font-size:13px;color:var(--hk-red)}',
    '.badge{font-size:12px;line-height:16px;padding:1px 7px;border-radius:9px;background:var(--hk-fill);color:var(--hk-label2);white-space:nowrap}',
    '.flash{animation:hkflash 1.4s ease}',
    '@keyframes hkflash{0%,40%{background:color-mix(in srgb,var(--hk-tint) 22%,transparent)}100%{background:transparent}}',
    // SWITCH
    '.sw{flex:none;position:relative;width:51px;height:31px;border-radius:16px;border:0;padding:0;cursor:pointer;',
    '  background:var(--hk-off);transition:background .22s}',
    '.sw::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;',
    '  box-shadow:var(--hk-shadow);transition:transform .22s cubic-bezier(.32,.72,0,1)}',
    '.sw[aria-checked="true"]{background:var(--hk-green)}',
    '.sw[aria-checked="true"]::after{transform:translateX(20px)}',
    '.sw:disabled{opacity:.4;cursor:default}',
    // SEGMENTED
    // equal segments, each as wide as the widest (Apple's own rule)
    '.seg{flex:none;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;position:relative;padding:2px;',
    '  border-radius:9px;background:var(--hk-seg);max-width:100%}',
    '.seg button{min-width:56px;height:28px;border:0;border-radius:7px;background:none;padding:0 12px;',
    '  font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap;color:var(--hk-label)}',
    '.seg button + button{box-shadow:-1px 0 0 -0.5px var(--hk-sep)}',
    '.seg button[aria-checked="true"]{background:var(--hk-seg-on);box-shadow:0 3px 8px rgba(0,0,0,.12),0 3px 1px rgba(0,0,0,.04);font-weight:600}',
    '.seg button[aria-checked="true"] + button{box-shadow:none}',
    '.cell.stack{flex-wrap:wrap}',
    // STACKED: the whole width, each choice as wide as its words need (a
    // "Photos & Forecast" beside a "Photos"), and a choice that still can't
    // fit wraps inside its segment rather than spilling into the next
    '.cell.stack .seg{width:100%}',
    '.cell.stack .seg button{padding:0 6px;min-width:0}',
    '.cell.stack.fitc .seg{grid-auto-columns:auto}',
    '.cell.stack.fitc .seg button{padding:4px 6px;height:auto;min-height:28px;white-space:normal;line-height:17px}',
    // POP-UP MENU (a system <select> over the value)
    '.pop{position:relative;flex:0 1 auto;min-width:0;display:inline-flex;align-items:center;gap:6px;color:var(--hk-label2)}',
    '.pop .pv{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pop svg{flex:none;width:9px;height:14px}',
    // invisible, but the system's own menu opens from it (no native
    // drawing at all: a phone's WebView can paint the box through opacity 0)
    '.pop select{position:absolute;inset:-8px -6px;width:calc(100% + 12px);opacity:0;cursor:pointer;font:inherit;font-size:16px;',
    '  -webkit-appearance:none;appearance:none;background:transparent;color:transparent;border:0}',
    '.pop select option{color:initial;background:initial}',
    '.pop:focus-within{outline:3px solid color-mix(in srgb,var(--hk-tint) 55%,transparent);outline-offset:3px;border-radius:6px}',
    // SLIDER
    '.cell.slider{flex-direction:column;align-items:stretch;gap:8px;padding:10px 16px 12px}',
    '.cell.slider .top{display:flex;align-items:center;gap:10px}',
    '.cell.slider .top .lbl{flex:1}',
    'input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:28px;margin:0;background:transparent;cursor:pointer}',
    'input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;',
    '  background:linear-gradient(to right,var(--hk-tint) var(--p,50%),var(--hk-fill) var(--p,50%))}',
    'input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:var(--hk-fill)}',
    'input[type=range]::-moz-range-progress{height:4px;border-radius:2px;background:var(--hk-tint)}',
    'input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;margin-top:-12px;border-radius:50%;',
    '  background:#fff;box-shadow:0 0.5px 4px rgba(0,0,0,.12),0 6px 13px rgba(0,0,0,.12);border:0}',
    'input[type=range]::-moz-range-thumb{width:28px;height:28px;border-radius:50%;background:#fff;border:0;',
    '  box-shadow:0 0.5px 4px rgba(0,0,0,.12),0 6px 13px rgba(0,0,0,.12)}',
    'input[type=range]:focus-visible{outline:none}',
    'input[type=range]:focus-visible::-webkit-slider-thumb{outline:3px solid color-mix(in srgb,var(--hk-tint) 55%,transparent)}',
    // TEXT
    '.cell input.tx{flex:1 1 40%;min-width:0;border:0;background:none;color:var(--hk-label);font:inherit;text-align:right;',
    '  padding:6px 0;outline:none;text-overflow:ellipsis}',
    // a date or a time sizes to what it shows and sits at the right, as every value does (its own text ignores
    // text-align in WebKit and Chrome)
    '.cell input.tx[type=datetime-local],.cell input.tx[type=date],.cell input.tx[type=time]{flex:0 1 auto;margin-left:auto}',
    '.cell input.tx::-webkit-date-and-time-value{text-align:right}',
    '.cell input.tx::placeholder{color:var(--hk-label3)}',
    '.cell.textrow:focus-within{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--hk-tint) 55%,transparent);border-radius:10px}',
    '.cell .unit{color:var(--hk-label2)}',
    // YAML: the code in a cell of its own, its mistake said under it in red
    '.codebox{display:block;background:var(--hk-cell);border-radius:10px}',
    '.codebox textarea{display:block;width:100%;min-height:220px;margin:0;border:0;padding:12px 16px;background:none;',
    '  color:var(--hk-label);font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2;white-space:pre;',
    '  overflow:auto;outline:none;resize:vertical;border-radius:10px}',
    '.codebox:focus-within{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--hk-tint) 55%,transparent)}',
    '.codebox.bad{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--hk-red) 60%,transparent)}',
    '.codebox .codeerr{padding:0 16px 10px;font-size:13px;line-height:18px;color:var(--hk-red)}',
    '.codebox .codeerr:empty{display:none}',
    // CHECK
    '.check{flex:none;width:17px;height:17px;color:var(--hk-tint)}',
    // LIST EDITOR
    '.li{padding-left:12px}',
    // a row with no remove button (nor its place kept) lines up with any row
    '.li.bare{padding-left:16px}',
    '.lx{flex:none;width:30px;height:30px;margin:-2px 0;border:0;padding:0;border-radius:50%;background:none;cursor:pointer;',
    '  display:inline-flex;align-items:center;justify-content:center}',
    '.lx svg{width:22px;height:22px}',
    '.lx .chev{width:8px;height:13px;margin:0}',
    '.lx.grip{width:44px;height:40px;margin:-6px -12px -6px 0;cursor:grab;color:var(--hk-label3);touch-action:none;border-radius:8px}',
    '.lx.grip svg{width:20px;height:14px}',
    '.li.dragging{z-index:3;background:var(--hk-cell);box-shadow:0 10px 30px rgba(0,0,0,.22);border-radius:10px;',
    '  transition:box-shadow .2s;cursor:grabbing}',
    '.li.moving{transition:transform .18s ease}',
    '.li.dragging::before,.li.dragging + .cell::before{display:none}',
    '.li .lbl a,.li a.lbl{color:inherit}',
    '.li a.lnk{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:12px;color:inherit;align-self:stretch;',
    '  margin:-6px 0;padding:6px 0;cursor:pointer}',
    '@media (hover:hover){.li a.lnk:hover .t{text-decoration:none}}',
    '.li:has(a.lnk:active){background:var(--hk-press)}',
    '.li .fixed{font-size:13px;line-height:17px;color:var(--hk-label2)}',
    // DIALOG
    '.dlgbd{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.36);display:flex;align-items:center;justify-content:center;',
    '  padding:24px;animation:hkfade .18s ease}',
    '.dlg{width:min(300px,100%);border-radius:14px;overflow:hidden;background:color-mix(in srgb,var(--hk-cell) 92%,transparent);',
    '  -webkit-backdrop-filter:blur(30px) saturate(1.6);backdrop-filter:blur(30px) saturate(1.6);text-align:center;',
    '  box-shadow:0 20px 60px rgba(0,0,0,.3);animation:hkpop .22s cubic-bezier(.34,1.24,.42,1)}',
    '.dlg h2{margin:0;padding:19px 16px 2px;font-size:17px;font-weight:600;line-height:22px}',
    '.dlg p{margin:0;padding:0 16px 18px;font-size:13px;line-height:18px;color:var(--hk-label)}',
    '.dlg .db{display:flex;border-top:.5px solid var(--hk-sep)}',
    '.dlg .db button{flex:1;min-width:0;height:44px;border:0;background:none;color:var(--hk-tint);font-size:17px;cursor:pointer;',
    '  white-space:nowrap;padding:0 8px}',
    '.dlg .db button + button{border-left:.5px solid var(--hk-sep)}',
    // A LABEL THAT DOESN'T FIT SIDE BY SIDE ("Follow All Screens"): the
    // buttons stack, the action above Cancel, as iOS does -- never a label
    // wrapped out of its button
    '.dlg .db.stack{flex-direction:column}',
    '.dlg .db.stack button{flex:none;width:100%}',
    '.dlg .db.stack button + button{border-left:0;border-top:.5px solid var(--hk-sep)}',
    '.dlg .db.stack button.cx{order:2}',
    '.dlg .db button.bold{font-weight:600}',
    '.dlg .db button.red{color:var(--hk-red)}',
    '@media (hover:hover){.dlg .db button:hover{background:var(--hk-hover)}}',
    '@keyframes hkfade{from{opacity:0}}',
    '@keyframes hkpop{from{opacity:0;transform:scale(1.12)}}',
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}'
  ].join('\n');

  var CHEV = '<svg class="chev" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5 6.5 6.5 1.5 11.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var UPDOWN = '<svg viewBox="0 0 9 14" aria-hidden="true"><path d="M1.5 5 4.5 2 7.5 5M1.5 9 4.5 12 7.5 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHECK = '<svg class="check" viewBox="0 0 17 17" aria-hidden="true"><path d="M2.5 9 6.5 13 14.5 3.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var MINUS = '<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="var(--hk-red)"/><path d="M6.5 11h9" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>';
  var PLUS = '<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="10" fill="var(--hk-green)"/><path d="M6.5 11h9M11 6.5v9" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>';
  var GRIP = '<svg viewBox="0 0 20 14" aria-hidden="true"><path d="M2 2h16M2 7h16M2 12h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function svg(markup) { var s = document.createElement('span'); s.innerHTML = markup; return s.firstChild; }

  // ------------------------------------------------------------ groups
  // o: { header, footer (text or node), sk, id }; rows: cells
  function group(o, rows) {
    o = o || {};
    var hid = o.header ? id('gh') : null;
    var sec = h('section', { class: 'grp' + (o.cls ? ' ' + o.cls : ''), 'aria-labelledby': hid, 'data-sk': o.sk });
    if (o.header) sec.appendChild(h('h2', { class: 'gh', id: hid }, o.header));
    var cells = h('div', { class: 'cells', role: o.role || null });
    (rows || []).forEach(function (r) { if (r) cells.appendChild(r); });
    sec.appendChild(cells);
    if (o.footer) sec.appendChild(typeof o.footer === 'string' ? h('p', { class: 'gf', text: o.footer }) : h('div', { class: 'gf' }, o.footer));
    return sec;
  }
  function label(text, sub, lid) {
    return h('span', { class: 'lbl', id: lid }, [h('span', { class: 't', text: text }), sub ? h('small', { text: sub }) : null]);
  }
  function lead(o) {
    // (a small picture of its own: the screensaver's faces, 2026-10-30)
    if (o.thumb) return o.thumb;
    if (o.tile) return h('span', { class: 'tile', style: 'background:' + o.tile[1], 'aria-hidden': 'true' }, icon(o.tile[0], ''));
    if (o.icon) return icon(o.icon);
    return null;
  }

  // A ROW THAT OPENS A PAGE: o.href, o.label, o.value, o.sub, o.icon/o.tile
  function nav(o) {
    var a = h('a', { class: 'cell' + (o.icon || o.tile ? ' hasic' : '') + (o.cls ? ' ' + o.cls : ''), href: o.href,
                     'data-sk': o.sk, 'data-fk': o.fk || o.sk || o.href, 'aria-current': o.current ? 'page' : null });
    a.setAttribute('href', o.href);
    var l = lead(o);
    if (l) a.appendChild(l);
    a.appendChild(label(o.label, o.sub));
    if (o.badge) a.appendChild(h('span', { class: 'badge', text: o.badge }));
    if (o.value !== undefined && o.value !== null && o.value !== '') a.appendChild(h('span', { class: 'val', text: o.value }));
    a.appendChild(svg(CHEV));
    return o.value !== undefined && o.value !== null && o.value !== '' ? watchRow(a) : a;
  }
  // A SWITCH ROW: the whole row toggles; o.on, o.onChange(bool), o.disabled
  function toggle(o) {
    var lid = id('l');
    var sw = h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': o.on ? 'true' : 'false',
                           'aria-labelledby': lid, disabled: !!o.disabled, 'data-fk': o.fk || o.sk,
                           'aria-describedby': o.describedby });
    var flip = function () {
      if (sw.disabled) return;
      var on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      o.onChange(on);
    };
    sw.addEventListener('click', function (e) { e.stopPropagation(); flip(); });
    var row = h('div', { class: 'cell' + (o.icon ? ' hasic' : ''), 'data-sk': o.sk }, [lead(o), label(o.label, o.sub, lid), sw]);
    row.addEventListener('click', function (e) { if (e.target === row || row.contains(e.target) && e.target.closest('.lbl')) flip(); });
    return row;
  }
  // A SEGMENTED CONTROL: o.options [[value, text]], o.value, o.onChange(v).
  // o.stack: the control under the label, full width (long choices, phones).
  // Without it, the control goes under its label BY ITSELF whenever the row
  // is too narrow for both (fitSeg): a phone, a narrow column. Before
  // 2026-09-30 each page had to ask, and one that didn't (Tab Size) squeezed
  // its label to a letter a line on an iPhone.
  var SEG_RO = null;
  function broken(t) {
    if (!t || !document.createRange) return false;
    var r = document.createRange(), tops = {};
    r.selectNodeContents(t);
    [].forEach.call(r.getClientRects(), function (x) { tops[Math.round(x.top)] = 1; });
    return Object.keys(tops).length > String(t.textContent || '').trim().split(/\s+/).length;
  }
  function spills(box) { return [].some.call(box.children, function (b) { return b.scrollWidth > b.clientWidth + 1; }); }
  function fitSeg(cell) {
    if (!cell.isConnected) { SEG_RO.unobserve(cell); return; }
    var w = cell.clientWidth;
    if (!w || w === cell._fitW) return;            // its own height changing is no reason
    cell._fitW = w;
    var box = cell.querySelector('.seg'), lbl = cell.querySelector('.lbl');
    cell.classList.remove('fitc');
    if (!cell._stackAlways) {
      cell.classList.remove('stack');
      var cr = cell.getBoundingClientRect(), br = box.getBoundingClientRect();
      if (br.right > cr.right - 8 || spills(box) || broken(lbl && lbl.querySelector('.t'))) cell.classList.add('stack');
    }
    // stacked: equal segments, as Apple draws them -- unless a choice is
    // then too wide for its share ("Photos & Forecast"): each as its words
    if (cell.classList.contains('stack') && spills(box)) cell.classList.add('fitc');
  }
  // ROWS WITH A VALUE (fitRow): measured at their natural widths, then left
  // alone if both fit, else `vkeep` or `lkeep` (the CSS above)
  var ROW_RO = null;
  function fitRow(cell) {
    if (!cell.isConnected) { ROW_RO.unobserve(cell); return; }
    var w = cell.clientWidth;
    if (!w || w === cell._fitW) return;
    cell._fitW = w;
    var lbl = cell.querySelector(':scope > .lbl'), val = cell.querySelector(':scope > .val, :scope > .pop');
    cell.classList.remove('vkeep', 'lkeep', 'vfull');
    if (!lbl || !val) return;
    cell.classList.add('fitm');
    var t = lbl.querySelector('.t'), r = document.createRange();
    r.selectNodeContents(t || lbl);
    var lw = r.getBoundingClientRect().width, vw = val.getBoundingClientRect().width;
    cell.classList.remove('fitm');
    var cs = getComputedStyle(cell), gap = parseFloat(cs.columnGap) || 0, other = 0, n = 0;
    [].forEach.call(cell.children, function (c) {
      if (getComputedStyle(c).display === 'none' || getComputedStyle(c).position === 'absolute') return;
      n++;
      if (c !== lbl && c !== val) other += c.getBoundingClientRect().width;
    });
    var avail = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - other - gap * Math.max(0, n - 1);
    if (lw + vw <= avail + 0.5) { cell.classList.add('vfull'); return; }
    // a value that fits in 60% of the row keeps its words; a longer one gives way
    cell.classList.add(vw <= avail * 0.6 ? 'vkeep' : 'lkeep');
  }
  function watchRow(cell) {
    if (typeof ResizeObserver !== 'function' || cell.classList.contains('li')) return cell;
    if (!ROW_RO) ROW_RO = new ResizeObserver(function (es) { es.forEach(function (e) { fitRow(e.target); }); });
    ROW_RO.observe(cell);
    return cell;
  }
  function watchSeg(cell) {
    if (typeof ResizeObserver !== 'function') return;
    if (!SEG_RO) SEG_RO = new ResizeObserver(function (es) { es.forEach(function (e) { fitSeg(e.target); }); });
    SEG_RO.observe(cell);
  }
  function seg(o) {
    var lid = id('l');
    var box = h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': lid });
    var buttons = o.options.map(function (op, i) {
      var on = op[0] === o.value;
      var b = h('button', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1',
                            'data-fk': (o.fk || o.sk) + ':' + op[0], text: op[1] });
      b.addEventListener('click', function () { if (op[0] !== o.value) o.onChange(op[0]); });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var j = (i + d + o.options.length) % o.options.length;
        buttons[j].focus();
        o.onChange(o.options[j][0]);
      });
      box.appendChild(b);
      return b;
    });
    if (!o.options.some(function (op) { return op[0] === o.value; }) && buttons[0]) buttons[0].setAttribute('tabindex', '0');
    var cell = h('div', { class: 'cell' + (o.stack ? ' stack' : ''), 'data-sk': o.sk }, [label(o.label, o.sub, lid), box]);
    cell._stackAlways = !!o.stack;
    watchSeg(cell);
    return cell;
  }
  // A POP-UP MENU: o.options [[value, text]], o.value, o.onChange(v)
  function select(o) {
    var lid = id('l');
    var pop = popup({ options: o.options, value: o.value, onChange: o.onChange, fk: o.fk || o.sk,
                      labelledby: lid, disabled: o.disabled, placeholder: o.placeholder });
    return watchRow(h('div', { class: 'cell', 'data-sk': o.sk }, [lead(o), label(o.label, o.sub, lid), pop]));
  }
  // THE POP-UP MENU ITSELF: the value and ⌃⌄, the system's own menu over it.
  // o.label (its accessible name) or o.labelledby; o.options [[value, text,
  // shown]] -- `shown`, when given, is what the row says once it is picked:
  // the menu's "Same as All Screens (Classic)" is "Classic" on a phone's
  // narrow row, the row's own subtitle saying whose it is
  function popup(o) {
    var s = h('select', { 'aria-label': o.labelledby ? null : o.label, 'aria-labelledby': o.labelledby,
                          'data-fk': o.fk, disabled: !!o.disabled });
    var shown = '';
    o.options.forEach(function (op) {
      var opt = h('option', { value: op[0], text: op[1] });
      if (op[2]) opt.setAttribute('data-shown', op[2]);
      if (String(op[0]) === String(o.value)) { opt.selected = true; shown = op[2] || op[1]; }
      s.appendChild(opt);
    });
    var pv = h('span', { class: 'pv', text: shown || o.placeholder || '' });
    // THE CHOICE SHOWS AT ONCE, not only when the page next redraws: a
    // redraw can be held (see the panel's render), and the label read the
    // old choice until it was
    s.addEventListener('change', function () {
      var op = s.options[s.selectedIndex];
      pv.textContent = (op && (op.getAttribute('data-shown') || op.text)) || o.placeholder || '';
      o.onChange(s.value);
    });
    return h('span', { class: 'pop' }, [pv, svg(UPDOWN), s]);
  }
  // A SLIDER: o.value, o.min, o.max, o.step, o.unit, o.badge, o.onChange(v)
  // (on release; the number follows the thumb while it moves)
  function slider(o) {
    var lid = id('l');
    var min = o.min || 0, max = o.max === undefined ? 100 : o.max;
    // o.labels: a word for each step (Off, Few, Normal...) in place of the number
    var say = function (v) { return o.labels ? o.labels[Number(v) - min] : v + (o.unit || ''); };
    var out = h('span', { class: 'val', text: say(o.value) });
    var r = h('input', { type: 'range', min: min, max: max, step: o.step || 1, 'aria-labelledby': lid,
                         'data-fk': o.fk || o.sk, 'aria-valuetext': say(o.value) });
    r.value = o.value;
    var paint = function () {
      r.style.setProperty('--p', ((r.value - min) / (max - min) * 100) + '%');
      out.textContent = say(r.value);
      r.setAttribute('aria-valuetext', say(r.value));
    };
    paint();
    r.addEventListener('input', paint);
    r.addEventListener('change', function () { o.onChange(Number(r.value)); });
    return h('div', { class: 'cell slider', 'data-sk': o.sk }, [
      h('div', { class: 'top' }, [label(o.label, o.sub, lid), o.badge ? h('span', { class: 'badge', text: o.badge }) : null, out]), r]);
  }
  // A TEXT ROW: saved on Return or when it loses focus; Escape puts it back.
  // o.value, o.placeholder, o.onCommit(text), o.error, o.unit, o.inputmode
  function text(o) {
    var lid = id('l'), eid = o.error ? id('e') : null;
    var inp = h('input', { class: 'tx', type: o.type || 'text', 'aria-labelledby': lid, 'data-fk': o.fk || o.sk,
                           placeholder: o.placeholder || '', maxlength: o.maxlength || 300, inputmode: o.inputmode,
                           autocomplete: o.autocomplete || 'off', spellcheck: 'false', 'aria-invalid': o.error ? 'true' : null,
                           'aria-describedby': eid });
    inp.value = o.value == null ? '' : String(o.value);
    var start = inp.value;
    var commit = function () { if (inp.value !== start) { start = inp.value; o.onCommit(inp.value); } };
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { inp.value = start; inp.blur(); }
    });
    inp.addEventListener('blur', commit);
    var row = h('div', { class: 'cell textrow', 'data-sk': o.sk }, [label(o.label, o.sub, lid), inp,
      o.unit ? h('span', { class: 'unit', text: o.unit }) : null]);
    row.addEventListener('click', function (e) { if (e.target !== inp) inp.focus(); });
    if (!o.error) return row;
    return h('div', { class: 'cellwrap' }, [row, h('div', { class: 'errline', id: eid, role: 'alert', text: o.error })]);
  }
  // A ROW THAT ONLY SAYS SOMETHING
  function info(o) {
    return watchRow(h('div', { class: 'cell' + (o.icon || o.tile ? ' hasic' : ''), 'data-sk': o.sk }, [lead(o), label(o.label, o.sub),
      o.value !== undefined ? h('span', { class: 'val' + (o.valueCls ? ' ' + o.valueCls : ''), text: o.value }) : null]));
  }
  // A CHECKMARK ROW (one of several, or several of several)
  function check(o) {
    var b = h('button', { class: 'cell' + (o.icon || o.tile ? ' hasic' : ''), type: 'button', role: o.multi ? 'checkbox' : 'radio',
                          'aria-checked': o.on ? 'true' : 'false', 'data-sk': o.sk, 'data-fk': o.fk || o.sk });
    var l = lead(o);
    if (l) b.appendChild(l);
    b.appendChild(label(o.label, o.sub));
    if (o.value) b.appendChild(h('span', { class: 'val', text: o.value }));
    var c = svg(CHECK);
    c.style.visibility = o.on ? 'visible' : 'hidden';
    b.appendChild(c);
    b.addEventListener('click', function () { o.onClick(!o.on); });
    return b;
  }
  // A BUTTON ROW: o.label, o.onClick, o.destructive, o.center
  function button(o) {
    return h('button', { class: 'cell ' + (o.destructive ? 'redc' : 'tintc') + (o.center ? ' center' : ''), type: 'button',
                         'data-sk': o.sk, 'data-fk': o.fk || o.sk || ('btn:' + o.label), disabled: !!o.disabled,
                         'aria-disabled': o.disabled ? 'true' : null, onclick: o.onClick },
      [o.icon ? icon(o.icon, 'ic') : null, h('span', { class: 'lbl' }, h('span', { class: 't', text: o.label }))]);
  }
  // A RECOMMENDATION (2026-10-29): a group of its own -- o.title, o.says (why,
  // in a sentence or two: the footer) and o.actions, each a button that
  // applies the suggestion ({label, onClick, sk}) or a row that opens where
  // it is ({label, href, sub, value, sk}). Nothing changes until one is
  // tapped; the caller draws it only while the setting differs.
  function recommend(o) {
    return group({ header: o.title || 'Recommended', footer: o.says, sk: o.sk, cls: 'rec' }, (o.actions || []).map(function (a) {
      return a.href ? nav({ label: a.label, href: a.href, sub: a.sub, value: a.value, sk: a.sk, fk: a.fk })
        : button({ label: a.label, onClick: a.onClick, sk: a.sk, fk: a.fk, disabled: a.disabled });
    }));
  }

  // ------------------------------------------------------ the list editor
  // o = {
  //   auto: true|false|undefined  (undefined: no Automatic switch)
  //   autoFooter, onAuto(on)       the switch and what it means
  //   rows:  [{value, label, sub, icon, href, fixed, removable, value2, control}]
  //          shown, in order (value2: a note at the end; control: a node there)
  //   more:  [{value, label, sub, icon}]                           can be added
  //   onChange(values)             Shown reordered/removed/added (custom mode)
  //   onRemove(value), onAdd(value)  override (e.g. while automatic)
  //   addLabel, onAddOther()       a row that opens a picker for more
  //   minRows                      the fewest Shown rows (an empty list would
  //                                be Automatic again): their minus is hidden
  //   reorder: false               a set, not an order (no handles)
  //   shownHeader, moreHeader, shownFooter, emptyText, fk
  //   announce(text)               the page's live region
  // }
  // While automatic the Shown rows are read-only (their detail still opens)
  // unless a row says removable.
  function listEditor(o) {
    var frag = document.createDocumentFragment();
    var fk = o.fk || 'list';
    if (o.auto !== undefined) {
      frag.appendChild(group({ footer: o.autoFooter }, [toggle({ label: 'Automatic', on: o.auto, sk: fk + ':auto',
                                                                 onChange: function (on) { o.onAuto(on); } })]));
    }
    var custom = !o.auto;
    var values = o.rows.map(function (r) { return r.value; });
    var cells = [];
    var canRm = function (r) { return r.fixed ? false : (custom ? values.length > (o.minRows || 0) : r.removable); };
    // one row with a remove button and every row keeps its place, so the
    // names line up (a house's custom chips among the automatic ones)
    var anyRm = o.rows.some(canRm);
    o.rows.forEach(function (r, i) {
      var canRemove = canRm(r);
      var row = h('div', { class: 'cell li' + (r.icon ? ' hasic' : ''), 'data-v': r.value, 'data-sk': r.sk });
      if (canRemove) {
        var rm = h('button', { class: 'lx rm', type: 'button', 'aria-label': 'Remove ' + r.label, 'data-fk': fk + ':rm:' + r.value });
        rm.appendChild(svg(MINUS));
        rm.addEventListener('click', function () {
          if (o.onRemove && (!custom || r.removable)) { o.onRemove(r.value); return; }
          var v = values.filter(function (x) { return x !== r.value; });
          o.onChange(v);
          if (o.announce) o.announce(r.label + ' removed');
        });
        row.appendChild(rm);
      } else if (anyRm || (custom && o.rows.some(function (x) { return !x.fixed; }))) {
        row.appendChild(h('span', { class: 'lx', 'aria-hidden': 'true' }));
      }
      else row.classList.add('bare');
      if (r.icon) row.appendChild(icon(r.icon));
      var lbl = label(r.label, r.sub);
      if (r.fixed) lbl.appendChild(h('span', { class: 'fixed', text: r.fixedText || 'Always included' }));
      // A ROW THAT OPENS A PAGE opens from anywhere between its minus and its
      // handle, not only from the ›: its name, its note and the › are one
      // link. With a control of its own, just the name.
      var main = lbl;
      if (r.href) {
        main = h('a', { class: 'lnk', 'data-fk': fk + ':go:' + r.value });
        main.setAttribute('href', r.href);
        main.appendChild(lbl);
      }
      row.appendChild(main);
      if (r.value2) (r.href && !r.control ? main : row).appendChild(h('span', { class: 'val', text: r.value2 }));
      // a control of the row's own (a generated screen's menu place)
      if (r.control) row.appendChild(r.control);
      else if (r.href) main.appendChild(svg(CHEV));
      if (custom && values.length > 1 && o.reorder !== false) {
        var g = h('button', { class: 'lx grip', type: 'button', 'aria-label': 'Move ' + r.label,
                              'aria-description': 'Use the up and down arrow keys to move it', 'data-fk': fk + ':grip:' + r.value });
        g.appendChild(svg(GRIP));
        g.addEventListener('keydown', function (e) {
          var d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
          if (!d) return;
          e.preventDefault();
          var j = i + d;
          if (j < 0 || j >= values.length) return;
          if (o.announce) o.announce(r.label + ', ' + (j + 1) + ' of ' + values.length);
          o.onChange(moveVal(values, i, j));
        });
        dragger(g, row, function () { return cells; }, i, function (to) {
          if (to !== i) {
            if (o.announce) o.announce(r.label + ', ' + (to + 1) + ' of ' + values.length);
            o.onChange(moveVal(values, i, to));
          }
        });
        row.appendChild(g);
      }
      cells.push(row);
    });
    if (!cells.length) cells.push(h('div', { class: 'cell' }, h('span', { class: 'lbl' }, h('small', { text: o.emptyText || 'None' }))));
    frag.appendChild(group({ header: o.shownHeader || 'Shown', footer: o.shownFooter, sk: fk + ':shown' }, cells));
    var more = (o.more || []).map(function (r) {
      var b = h('button', { class: 'cell li' + (r.icon ? ' hasic' : ''), type: 'button', 'data-fk': fk + ':add:' + r.value,
                            'aria-label': 'Add ' + r.label });
      var p = svg(PLUS); var s = h('span', { class: 'lx', 'aria-hidden': 'true' }); s.appendChild(p);
      b.appendChild(s);
      if (r.icon) b.appendChild(icon(r.icon));
      b.appendChild(label(r.label, r.sub));
      b.addEventListener('click', function () {
        if (o.onAdd) { o.onAdd(r.value); return; }
        o.onChange(values.concat(r.value));
        if (o.announce) o.announce(r.label + ' added');
      });
      return b;
    });
    if (o.addLabel) more.push(button({ label: o.addLabel, onClick: o.onAddOther, fk: fk + ':other' }));
    if (more.length) frag.appendChild(group({ header: o.moreHeader || 'More', footer: o.moreFooter }, more));
    return frag;
  }
  function moveVal(values, from, to) {
    var v = values.slice(); var m = v.splice(from, 1)[0]; v.splice(to, 0, m); return v;
  }
  // DRAG A ROW BY ITS HANDLE (mouse, pen or finger): the row lifts and
  // follows, the others slide aside; dropped, the new order is saved.
  function dragger(handle, row, all, index, done) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      var rows = all(), start = e.clientY, h0 = row.getBoundingClientRect().height, to = index;
      var mids = rows.map(function (r) { var b = r.getBoundingClientRect(); return b.top + b.height / 2; });
      try { handle.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ }
      row.classList.add('dragging');
      rows.forEach(function (r) { if (r !== row) r.classList.add('moving'); });
      var moveH = function (ev) {
        var dy = ev.clientY - start;
        row.style.transform = 'translateY(' + dy + 'px)';
        var y = mids[index] + dy;
        to = index;
        for (var k = 0; k < rows.length; k++) {
          if (k < index && y < mids[k]) { to = k; break; }
        }
        for (var j = rows.length - 1; j > index; j--) {
          if (y > mids[j]) { to = j; break; }
        }
        rows.forEach(function (r, k) {
          if (r === row) return;
          var shift = (index < k && k <= to) ? -h0 : (to <= k && k < index) ? h0 : 0;
          r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
        });
      };
      var up = function () {
        handle.removeEventListener('pointermove', moveH);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        rows.forEach(function (r) { r.style.transform = ''; r.classList.remove('moving'); });
        row.classList.remove('dragging');
        done(to);
      };
      handle.addEventListener('pointermove', moveH);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // ------------------------------------------------------------ the alert
  // confirm(shadowRoot, {title, message, ok, cancel, destructive, dismiss}) -> Promise<bool>.
  // dismiss: what Escape or a tap outside answers (false unless given), for a
  // dialog whose Cancel button is a choice of its own (the grid editor's Reload)
  // Cancel is where focus starts; Escape cancels; focus stays in the alert.
  // an iOS alert: Cancel and OK, or (cancel: false) OK alone, to say something
  function confirm(rootEl, o) {
    return new Promise(function (resolve) {
      var tid = id('dt'), mid = id('dm');
      var prev = rootEl.activeElement || document.activeElement;
      var ok = h('button', { type: 'button', class: o.destructive ? 'red' : 'bold', text: o.ok || 'OK' });
      var cancel = o.cancel === false ? ok
        : h('button', { type: 'button', class: 'cx' + (o.destructive ? ' bold' : ''), text: o.cancel || 'Cancel' });
      var dlg = h('div', { class: 'dlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': tid, 'aria-describedby': mid }, [
        h('h2', { id: tid, text: o.title }), h('p', { id: mid, text: o.message || '' }),
        h('div', { class: 'db' }, cancel === ok ? [ok] : [cancel, ok])]);
      var bd = h('div', { class: 'dlgbd' }, dlg);
      var close = function (v) {
        bd.remove();
        if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* gone */ } }
        resolve(v);
      };
      if (cancel !== ok) cancel.addEventListener('click', function () { close(false); });
      ok.addEventListener('click', function () { close(true); });
      var dismissed = 'dismiss' in o ? o.dismiss : false;
      bd.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(dismissed); }
        if (e.key === 'Tab') { e.preventDefault(); (rootEl.activeElement === ok ? cancel : ok).focus(); }
      });
      bd.addEventListener('click', function (e) { if (e.target === bd) close(dismissed); });
      rootEl.appendChild(bd);
      // side by side unless a label would be cut: then stacked
      var row = dlg.querySelector('.db');
      if ([cancel, ok].some(function (b) { return b.scrollWidth > b.clientWidth + 1; })) row.classList.add('stack');
      cancel.focus();
    });
  }

  // ------------------------------------------------------------ YAML
  // THE PAGE'S OWN YAML (Phase 2 P2.4): what Home Assistant's YAML editor
  // read and wrote, without it, so the page draws on any host. It reads what
  // that editor's js-yaml (DEFAULT_SCHEMA) reads in a card's options: block
  // mappings and sequences (a sequence under its key at the key's indent, a
  // mapping started on a "- " line), flow [..] and {..} (so JSON too), plain,
  // 'single' and "double" quoted scalars over several lines, | and >
  // blocks with their chomping and indentation indicators, comments, anchors,
  // aliases and << merges, the core schema's null/bool/int/float, and a
  // timestamp as the ISO string it is sent as. A duplicated key, a tab
  // indent, an unknown tag (!secret, !include: js-yaml refuses them too) or a
  // line out of place is an error, with its line number.
  function YamlError(message, line) {
    this.name = 'YAMLException';
    this.line = line;
    this.message = message + (line ? ' (line ' + line + ')' : '');
  }
  var Y_NULL = /^(?:~|null|Null|NULL)?$/;
  var Y_BOOL = /^(?:true|True|TRUE|false|False|FALSE)$/;
  var Y_INT = /^[-+]?(?:0b[01_]+|0x[0-9a-fA-F_]+|0o[0-7_]+|[0-9][0-9_]*)$/;
  var Y_FLOAT = /^(?:[-+]?(?:\.[0-9]+|[0-9][0-9_]*)(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
  var Y_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
  var Y_STAMP = /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:[Tt]|[ \t]+)([0-9]{1,2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]*))?(?:[ \t]*(Z|([-+])([0-9]{1,2})(?::([0-9]{2}))?))?$/;
  function yInt(s) {
    var t = s.replace(/_/g, ''), sign = 1;
    if (t[0] === '-' || t[0] === '+') { if (t[0] === '-') sign = -1; t = t.slice(1); }
    if (/^0b/.test(t)) return sign * parseInt(t.slice(2), 2);
    if (/^0x/.test(t)) return sign * parseInt(t.slice(2), 16);
    if (/^0o/.test(t)) return sign * parseInt(t.slice(2), 8);
    return sign * parseInt(t, 10);
  }
  function yFloat(s) {
    var t = s.replace(/_/g, '').toLowerCase();
    if (t === '.nan') return NaN;
    if (/^[-+]?\.inf$/.test(t)) return t[0] === '-' ? -Infinity : Infinity;
    return parseFloat(t);
  }
  function yStamp(s) {
    var m = Y_DATE.exec(s);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString();
    m = Y_STAMP.exec(s);
    if (!m) return null;
    var ms = m[7] ? +(m[7] + '00').slice(0, 3) : 0;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
    if (m[9]) t -= (m[9] === '-' ? -1 : 1) * ((+m[10]) * 60 + (+(m[11] || 0))) * 60000;
    return new Date(t).toISOString();
  }
  // a plain scalar's value, as the core schema resolves it
  function yPlain(s) {
    if (Y_NULL.test(s)) return null;
    if (Y_BOOL.test(s)) return s[0] === 't' || s[0] === 'T';
    if (Y_INT.test(s)) return yInt(s);
    if (Y_FLOAT.test(s) && /[0-9]|inf|nan/i.test(s)) return yFloat(s);
    var d = yStamp(s);
    return d === null ? s : d;
  }
  var ESC = { '0': '\0', 'a': '\x07', 'b': '\b', 't': '\t', '\t': '\t', 'n': '\n', 'v': '\x0B', 'f': '\f', 'r': '\r',
              'e': '\x1B', ' ': ' ', '"': '"', '/': '/', '\\': '\\', 'N': '\x85', '_': '\xA0', 'L': '\u2028', 'P': '\u2029' };

  function yamlParse(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    // the last line's break ends that line; it starts no line of its own
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    var P = { lines: lines, i: 0, anchors: {}, seqOk: false };
    function fail(msg, at) { throw new YamlError(msg, (at === undefined ? P.i : at) + 1); }
    // a line's content: its indent, and its text without a trailing comment
    // (a # at the start or after a space, outside quotes)
    function strip(t) {
      var q = null, prev = ' ';
      for (var k = 0; k < t.length; k++) {
        var c = t[k];
        if (q) {
          if (q === '"' && c === '\\') { k++; prev = 'x'; continue; }
          if (c === q) { if (q === "'" && t[k + 1] === "'") { k++; continue; } q = null; }
        } else if (c === '#' && /\s/.test(prev)) { return t.slice(0, k).replace(/\s+$/, ''); }
        else if ((c === '"' || c === "'") && /[\s[{,]/.test(prev)) { q = c; }
        prev = c;
      }
      return t.replace(/\s+$/, '');
    }
    function at(k) {
      var raw = lines[k], n = 0;
      while (raw[n] === ' ') n++;
      var text = strip(raw.slice(n));
      if (text && raw[n] === '\t') fail('a tab cannot indent', k);
      return { indent: n, text: text };
    }
    function blank(k) { return !at(k).text; }
    function next() {           // the next line with something on it
      while (P.i < lines.length && blank(P.i)) P.i++;
      return P.i < lines.length ? at(P.i) : null;
    }
    var SEQ = /^-(?:\s|$)/;
    // a document's end ("...") or the next one's start ("---")
    function docEnd(c) { return c.indent === 0 && (c.text === '...' || /^---(?:\s|$)/.test(c.text)); }
    // where a mapping's key ends: the ':' followed by a space or the line's end
    function keyEnd(t) {
      var k = 0;
      if (t[0] === '"' || t[0] === "'") {
        var q = t[0];
        for (k = 1; k < t.length; k++) {
          if (q === '"' && t[k] === '\\') { k++; continue; }
          if (t[k] === q) { if (q === "'" && t[k + 1] === "'") { k++; continue; } break; }
        }
        if (k >= t.length) return -1;
        k++;
        while (t[k] === ' ') k++;
        return t[k] === ':' && (k + 1 === t.length || /\s/.test(t[k + 1])) ? k : -1;
      }
      if (/^[[{]/.test(t)) return -1;
      for (k = 0; k < t.length; k++) {
        if (t[k] === ':' && (k + 1 === t.length || /\s/.test(t[k + 1]))) return k;
      }
      return -1;
    }
    function keyOf(raw) {
      raw = raw.replace(/\s+$/, '');
      if (raw[0] === '"' || raw[0] === "'") return String(quoted(raw, 0, P.i).v);
      if (raw === '?' || raw.slice(0, 2) === '? ') fail('a complex key (?) is not supported');
      if (raw[0] === '*') return String(alias(raw));
      var v = yPlain(raw);
      return v === null ? 'null' : String(v);
    }
    function alias(t) {
      var name = t.slice(1).replace(/\s+$/, '');
      if (!Object.prototype.hasOwnProperty.call(P.anchors, name)) fail('unidentified alias "' + name + '"');
      return P.anchors[name];
    }
    // a quoted scalar starting at t[k]: { v, end } (the index after it)
    function quoted(t, k, line) {
      var q = t[k], out = '', j = k + 1;
      for (; j < t.length; j++) {
        var c = t[j];
        if (q === "'" && c === "'") { if (t[j + 1] === "'") { out += "'"; j++; continue; } return { v: out, end: j + 1 }; }
        if (q === '"' && c === '"') return { v: out, end: j + 1 };
        if (q === '"' && c === '\\') {
          var e = t[++j];
          if (e === undefined) break;
          if (e === 'x' || e === 'u' || e === 'U') {
            var len = e === 'x' ? 2 : e === 'u' ? 4 : 8, hex = t.substr(j + 1, len);
            if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len) fail('a bad escape in a double-quoted string', line);
            out += String.fromCodePoint(parseInt(hex, 16)); j += len; continue;
          }
          if (e === '\n') { while (t[j + 1] === ' ' || t[j + 1] === '\t') j++; continue; }
          if (!Object.prototype.hasOwnProperty.call(ESC, e)) fail('an unknown escape \\' + e, line);
          out += ESC[e]; continue;
        }
        out += c;
      }
      fail('a quoted string is not closed', line);
    }
    // folding a quoted scalar's lines: a break is a space, an empty line a newline
    function fold(parts) {
      var out = '', blanks = 0;
      parts.forEach(function (p, n) {
        var s = n === 0 ? p.replace(/[ \t]+$/, '') : n === parts.length - 1 ? p.replace(/^[ \t]+/, '') : p.trim();
        if (n > 0 && n < parts.length - 1 && !s) { blanks++; return; }
        if (n > 0) out += blanks ? new Array(blanks + 1).join('\n') : ' ';
        blanks = 0;
        out += s;
      });
      return out;
    }
    // a quoted scalar that may run over several lines; `rest` begins with it
    function quotedBlock(rest) {
      var start = P.i, text = rest, k;
      for (;;) {
        try { var r = quoted(text, 0, start); k = r.end; break; }
        catch (e) {
          // only a string still open runs on to the next line
          if (P.i + 1 >= lines.length || !/not closed/.test(e.message)) throw e;
          P.i++;
          text += '\n' + lines[P.i];
        }
      }
      var after = strip(text.slice(k));
      if (after) fail('unexpected text after a quoted string');
      P.i++;
      if (text.indexOf('\n') < 0) return quoted(text, 0, start).v;
      // a double-quoted scalar's escaped breaks were handled by quoted(); fold the rest
      var q = text[0], body = text.slice(1, k - 1);
      if (q === "'") return fold(body.split('\n')).replace(/''/g, "'");
      // (a line ending in an escape -- an odd run of backslashes -- runs on unfolded)
      var segs = [];
      body.split('\n').forEach(function (l) {
        var prev = segs.length ? segs[segs.length - 1] : null;
        if (prev !== null && /(^|[^\\])(\\\\)*\\$/.test(prev)) segs[segs.length - 1] = prev + '\n' + l;
        else segs.push(l);
      });
      return quoted(q + fold(segs) + q, 0, start).v;
    }
    // [..] or {..} that may run over several lines: gathered, then parsed
    function flowBlock(rest) {
      var text = rest, depth = 0, q = null, start = P.i;
      for (;;) {
        depth = 0; q = null;
        for (var k = 0; k < text.length; k++) {
          var c = text[k];
          if (q) {
            if (q === '"' && c === '\\') { k++; continue; }
            if (c === q) { if (q === "'" && text[k + 1] === "'") { k++; continue; } q = null; }
          } else if (c === '"' || c === "'") q = c;
          else if (c === '[' || c === '{') depth++;
          else if (c === ']' || c === '}') depth--;
        }
        if (depth <= 0) break;
        if (P.i + 1 >= lines.length) fail('a flow collection is not closed', start);
        P.i++;
        text += ' ' + strip(lines[P.i].trim());
      }
      P.i++;
      var f = { s: text, k: 0 };
      var v = flowValue(f, start).v;
      skipWs(f);
      if (f.k < f.s.length) fail('unexpected text after a flow collection', start);
      return v;
    }
    function skipWs(f) { while (f.k < f.s.length && /\s/.test(f.s[f.k])) f.k++; }
    function flowValue(f, line) {
      skipWs(f);
      var c = f.s[f.k], props = null;
      if (c === '&' || c === '!') {
        var m = /^(?:&[^\s,[\]{}]+|![^\s,[\]{}]*)/.exec(f.s.slice(f.k));
        props = [];
        while (m) { props.push(m[0]); f.k += m[0].length; skipWs(f); m = /^(?:&[^\s,[\]{}]+|![^\s,[\]{}]*)/.exec(f.s.slice(f.k)); }
        c = f.s[f.k];
      }
      var v, plain = false;
      if (c === '[') {
        f.k++; v = [];
        for (;;) {
          skipWs(f);
          if (f.s[f.k] === ']') { f.k++; break; }
          var item = flowValue(f, line);
          skipWs(f);
          if (f.s[f.k] === ':') {            // [a: 1]: a mapping of one pair
            f.k++;
            var pair = {};
            setKey(pair, item.v === null && !item.quoted ? 'null' : String(item.v), flowValue(f, line).v, null, line);
            item = { v: pair };
            skipWs(f);
          }
          v.push(item.v);
          if (f.s[f.k] === ',') { f.k++; continue; }
          if (f.s[f.k] === ']') { f.k++; break; }
          fail('expected , or ] in a flow sequence', line);
        }
      } else if (c === '{') {
        f.k++; v = {};
        for (;;) {
          skipWs(f);
          if (f.s[f.k] === '}') { f.k++; break; }
          var key = flowValue(f, line, true);
          skipWs(f);
          var val = null;
          if (f.s[f.k] === ':') { f.k++; val = flowValue(f, line).v; skipWs(f); }
          setKey(v, key.v === null && !key.quoted ? 'null' : String(key.v), val, null, line);
          if (f.s[f.k] === ',') { f.k++; continue; }
          if (f.s[f.k] === '}') { f.k++; break; }
          fail('expected , or } in a flow mapping', line);
        }
      } else if (c === '"' || c === "'") {
        var r = quoted(f.s, f.k, line); f.k = r.end; v = r.v;
        return tagged(props, v, true, line);
      } else if (c === '*') {
        var am = /^\*[^\s,[\]{}]+/.exec(f.s.slice(f.k));
        if (!am) fail('an alias needs a name', line);
        f.k += am[0].length;
        return { v: alias(am[0]) };
      } else {
        var start = f.k;
        while (f.k < f.s.length && !/[,[\]{}]/.test(f.s[f.k]) &&
               !(f.s[f.k] === ':' && (f.k + 1 === f.s.length || /[\s,[\]{}]/.test(f.s[f.k + 1])))) f.k++;
        v = f.s.slice(start, f.k).trim();
        plain = true;
      }
      return tagged(props, v, !plain && typeof v === 'string', line, plain);
    }
    // anchors and tags on a node: { v, quoted }
    function tagged(props, v, isQuoted, line, isPlain) {
      var tag = null, anchor = null;
      (props || []).forEach(function (p) { if (p[0] === '&') anchor = p.slice(1); else tag = p; });
      if (isPlain) v = tag ? v : yPlain(v);
      if (tag) v = applyTag(tag, v, line);
      if (anchor) P.anchors[anchor] = v;
      return { v: v, quoted: isQuoted };
    }
    function applyTag(tag, v, line) {
      switch (tag) {
        case '!!str': return v === null ? '' : String(v);
        case '!!int': if (typeof v === 'string' && Y_INT.test(v)) return yInt(v); break;
        case '!!float': if (typeof v === 'string' && (Y_FLOAT.test(v) || Y_INT.test(v))) return yFloat(v); break;
        case '!!bool': if (typeof v === 'string' && Y_BOOL.test(v)) return yPlain(v); break;
        case '!!null': if (v === null || v === '' || (typeof v === 'string' && Y_NULL.test(v))) return null; break;
        case '!!map': if (v && typeof v === 'object' && !Array.isArray(v)) return v; break;
        case '!!seq': if (Array.isArray(v)) return v; break;
        case '!': return v;
        default: fail('unknown tag ' + tag, line);
      }
      fail('cannot resolve a node with the tag ' + tag, line);
    }
    function setKey(obj, key, val, merged, line) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && !(merged && merged[key])) fail('duplicated mapping key "' + key + '"', line);
      if (merged) delete merged[key];
      if (key === '__proto__') Object.defineProperty(obj, key, { value: val, enumerable: true, writable: true, configurable: true });
      else obj[key] = val;
    }
    function merge(obj, src, merged, line) {
      var list = Array.isArray(src) ? src : [src];
      list.forEach(function (m) {
        if (!m || typeof m !== 'object' || Array.isArray(m)) fail('a merge (<<) takes a mapping or a list of mappings', line);
        Object.keys(m).forEach(function (k) {
          if (!Object.prototype.hasOwnProperty.call(obj, k)) { obj[k] = m[k]; merged[k] = true; }
        });
      });
    }
    // | and > blocks; `head` is the indicator and its options, n the parent's indent
    function blockScalar(head, n) {
      var m = /^([|>])([+-]?)([1-9]?)([+-]?)$/.exec(head);
      if (!m || (m[2] && m[4])) fail('a bad block scalar header "' + head + '"');
      var folded = m[1] === '>', chomp = m[2] || m[4], explicit = m[3] ? Math.max(n, 0) + Number(m[3]) : null;
      P.i++;
      var body = [], ind = explicit, k = P.i;
      for (; k < lines.length; k++) {
        var raw = lines[k];
        if (!raw.trim()) { body.push(raw); continue; }
        var sp = 0; while (raw[sp] === ' ') sp++;
        if (ind === null) { if (sp <= n) break; ind = sp; }
        if (sp < ind) break;
        body.push(raw);
      }
      P.i = k;
      var trail = 0;
      while (body.length && !body[body.length - 1].trim()) { body.pop(); trail++; }
      var rows = body.map(function (r) { return r.length > ind ? r.slice(ind) : r.trim() ? r : ''; });
      var out;
      if (!folded) out = rows.join('\n');
      else {
        out = ''; var prev = null, gap = 0;
        rows.forEach(function (r) {
          if (r === '') { gap++; return; }
          var type = /^[ \t]/.test(r) ? 'more' : 'normal';
          if (prev === null) out += new Array(gap + 1).join('\n');
          else if (prev === 'normal' && type === 'normal') out += gap ? new Array(gap + 1).join('\n') : ' ';
          else out += new Array(gap + 2).join('\n');
          out += r; prev = type; gap = 0;
        });
      }
      if (!rows.length) return chomp === '+' ? new Array(trail + 1).join('\n') : '';
      if (chomp === '-') return out;
      if (chomp === '+') return out + '\n' + new Array(trail + 1).join('\n');
      return out + '\n';
    }
    // a value written after "key:" or "- " (rest, maybe empty), its parent at indent n
    function value(rest, n) {
      var props = [], line0 = P.i;
      var m = /^(&[^\s,[\]{}]+|![^\s]*)(?:\s+|$)/.exec(rest);
      while (m) { props.push(m[1]); rest = rest.slice(m[0].length); m = /^(&[^\s,[\]{}]+|![^\s]*)(?:\s+|$)/.exec(rest); }
      // "- &a key: v": js-yaml anchors the mapping; not read here (rather than misread as text)
      if (props.length && rest && !/^[[{"'|>*]/.test(rest) && keyEnd(rest) >= 0) fail('an anchor or a tag before a mapping on its line is not supported');
      var v, isQuoted = false, plain = false;
      if (!rest) {
        P.i++;
        var nx = next();
        if (nx && (nx.indent > n || (nx.indent === n && SEQ.test(nx.text) && P.seqOk))) v = node(n, nx.indent === n);
        else v = null;
      } else if (rest[0] === '|' || rest[0] === '>') v = blockScalar(rest, n);
      else if (rest[0] === '[' || rest[0] === '{') v = flowBlock(rest);
      else if (rest[0] === '"' || rest[0] === "'") { v = quotedBlock(rest); isQuoted = true; }
      else if (rest[0] === '*') { v = alias(rest); P.i++; return v; }
      else {
        // a plain scalar, and its continuation lines (more indented)
        var parts = [rest];
        P.i++;
        while (P.i < lines.length) {
          if (blank(P.i)) {
            var j = P.i; while (j < lines.length && blank(j)) j++;
            if (j < lines.length && at(j).indent > n) { parts.push(''); P.i = j; continue; }
            break;
          }
          var c = at(P.i);
          if (c.indent <= n) break;
          if (keyEnd(c.text) >= 0 || SEQ.test(c.text)) fail('bad indentation of a mapping entry or a sequence item');
          parts.push(c.text); P.i++;
        }
        v = parts.length > 1 ? fold(parts) : rest;
        plain = true;
      }
      return tagged(props, v, isQuoted, line0, plain).v;
    }
    // the block node starting on the next line with something on it, indented more than n
    // (or, sameSeq, a sequence at n under its key)
    function node(n, sameSeq) {
      var c = next();
      if (!c) return null;
      if (c.indent <= n && !(sameSeq && c.indent === n)) return null;
      if (/^\?(?:\s|$)/.test(c.text)) fail('a complex key (?) is not supported');
      if (SEQ.test(c.text)) return seq(c.indent);
      if (keyEnd(c.text) >= 0) return map(c.indent);
      // a scalar or flow node alone on its lines
      return value(c.text, n);
    }
    function seq(n) {
      var out = [];
      for (;;) {
        var c = next();
        if (!c || c.indent !== n || !SEQ.test(c.text) || docEnd(c)) break;
        var raw = lines[P.i], rest = raw.slice(n + 1), pad = 1;
        while (rest[0] === ' ') { rest = rest.slice(1); pad++; }
        var restStripped = strip(rest);
        if (!restStripped) { P.seqOk = false; out.push(value('', n)); continue; }
        if (SEQ.test(restStripped) || (keyEnd(restStripped) >= 0 && !/^[&!*]/.test(restStripped))) {
          // "- - x" or "- key: v": the rest of the line is a node at its own column
          lines[P.i] = new Array(n + pad + 1).join(' ') + rest;
          out.push(node(n));
          continue;
        }
        P.seqOk = false;
        out.push(value(restStripped, n));
      }
      var after = next();
      if (after && after.indent > n) fail('bad indentation of a sequence item');
      return out;
    }
    function map(n) {
      var out = {}, merged = {};
      for (;;) {
        var c = next();
        if (!c || c.indent < n || docEnd(c)) break;
        if (c.indent > n) fail('bad indentation of a mapping entry');
        if (SEQ.test(c.text)) break;
        var k = keyEnd(c.text);
        if (k < 0) fail('a mapping entry needs "key: value"');
        var line = P.i, key = keyOf(c.text.slice(0, k)), rest = c.text.slice(k + 1).replace(/^\s+/, '');
        P.seqOk = true;
        var v = value(rest, n);
        if (key === '<<' && c.text.slice(0, k).trim() === '<<') merge(out, v, merged, line);
        else setKey(out, key, v, merged, line);
      }
      return out;
    }

    var c0 = next(), started = false;
    // a document start ("---") and directives ("%YAML") before it
    while (c0 && c0.indent === 0 && /^(?:%|---(?:\s|$))/.test(c0.text)) {
      if (/^---/.test(c0.text)) {
        started = true;
        var restDoc = c0.text.slice(3).trim();
        if (restDoc) { lines[P.i] = restDoc; break; }
      }
      P.i++;
      c0 = next();
    }
    // nothing: js-yaml's undefined; a document marked but empty: null
    if (!c0) return started ? null : undefined;
    var doc = node(-1, false);
    var end = next();
    if (end && end.text === '...') { P.i++; end = next(); }
    if (end) fail(/^---/.test(end.text) ? 'only one document is read here' : 'unexpected text');
    return doc;
  }

  // WRITING IT: what the editor shows to begin with -- block style, two
  // spaces, keys in their order, a string quoted ("...") only where it would
  // read back as something else, a multi-line string as a | block. Whatever
  // it writes reads back as the same value (the kit's tests check).
  var Y_RESERVED = /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|<<|=)$/;
  function yQuote(s) {
    return '"' + s.replace(/[\\"\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/g, function (c) {
      var map = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r', '\b': '\\b', '\f': '\\f', '\0': '\\0' };
      if (map[c]) return map[c];
      var hx = c.charCodeAt(0).toString(16).toUpperCase();
      return c.charCodeAt(0) < 256 ? '\\x' + ('0' + hx).slice(-2) : '\\u' + ('000' + hx).slice(-4);
    }) + '"';
  }
  function yPlainSafe(s) {
    if (!s || Y_RESERVED.test(s) || s !== s.trim()) return false;
    if (yPlain(s) !== s) return false;                       // reads back as a number, a bool, a date...
    if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) && !/^-[^\s-]/.test(s)) return false;
    if (/^---|^\.\.\./.test(s)) return false;
    if (/:\s|\s#|:$|[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.test(s)) return false;
    if (/^-/.test(s) && Y_FLOAT.test(s)) return false;
    return true;
  }
  function yScalar(v, asKey) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') {
      if (isNaN(v)) return '.nan';
      if (v === Infinity) return '.inf';
      if (v === -Infinity) return '-.inf';
      if (Object.is(v, -0)) return '-0.0';
      return String(v);
    }
    var s = v instanceof Date ? v.toISOString() : String(v);
    // a | block, unless its first line's indent or a line of only spaces would not read back
    if (!asKey && s.indexOf('\n') >= 0 && !/^\n*[ \t]/.test(s) && !/(^|\n)[ \t]+(\n|$)/.test(s) &&
        !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\ufeff\r]/.test(s)) return null;
    return yPlainSafe(s) ? s : yQuote(s);
  }
  // a node: { inline } (a scalar, {} or []), { inline: '|', after: [lines] }, or { block: [lines] }
  function yNode(v) {
    if (Array.isArray(v)) {
      if (!v.length) return { inline: '[]' };
      var rows = [];
      v.forEach(function (item) {
        var c = yNode(item === undefined ? null : item);
        if (c.inline !== undefined) {
          rows.push('- ' + c.inline);
          (c.after || []).forEach(function (l) { rows.push(l ? '  ' + l : l); });
        } else {
          rows.push('- ' + c.block[0]);
          c.block.slice(1).forEach(function (l) { rows.push(l ? '  ' + l : l); });
        }
      });
      return { block: rows };
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      var keys = Object.keys(v).filter(function (k) { return v[k] !== undefined && typeof v[k] !== 'function'; });
      if (!keys.length) return { inline: '{}' };
      var out = [];
      keys.forEach(function (k) {
        var kk = yScalar(k, true), c = yNode(v[k]);
        if (c.inline !== undefined) {
          out.push(kk + ': ' + c.inline);
          (c.after || []).forEach(function (l) { out.push(l ? '  ' + l : l); });
        } else {
          out.push(kk + ':');
          c.block.forEach(function (l) { out.push(l ? '  ' + l : l); });
        }
      });
      return { block: out };
    }
    var s = yScalar(v);
    if (s !== null) return { inline: s };
    // a multi-line string: a literal block, its chomping as its trailing newlines say
    var str = String(v), m = /\n*$/.exec(str)[0].length;
    var head = m === 0 ? '|-' : m === 1 ? '|' : '|+';
    var body = (m === 0 ? str : m === 1 ? str.slice(0, -1) : str.slice(0, -m)).split('\n');
    if (m > 1) for (var x = 1; x < m; x++) body.push('');
    return { inline: head, after: body };
  }
  function yamlDump(v) {
    var c = yNode(v === undefined ? null : v);
    if (c.inline !== undefined) return [c.inline].concat(c.after || []).join('\n') + '\n';
    return c.block.join('\n') + '\n';
  }
  function yEmpty(v) {
    if (typeof v !== 'object' || v === null) return false;
    for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) return false; }
    return true;
  }

  // A YAML EDITOR: what Home Assistant's YAML editor did on these pages --
  // the value written out to begin with (nothing for an empty one), read
  // back at every keystroke, o.onChange(value, valid) each time: empty text is
  // {} and a mistake is (undefined, false). The mistake is said under it, by
  // line. Tab indents two spaces (Escape, then Tab, leaves the field);
  // Return keeps the line's indent, two more after a "key:".
  // o: { value, label, onChange(value, valid), fk, sk }
  function yaml(o) {
    var eid = id('ye');
    var ta = h('textarea', { class: 'code', 'aria-label': o.label || 'YAML', spellcheck: 'false', autocomplete: 'off',
                             autocapitalize: 'off', autocorrect: 'off', wrap: 'off', 'data-fk': o.fk || o.sk,
                             'aria-describedby': eid });
    ta.value = o.value === undefined || yEmpty(o.value) ? '' : yamlDump(o.value);
    var msg = h('div', { class: 'codeerr', id: eid, 'aria-live': 'polite' });
    var box = h('div', { class: 'codebox', 'data-sk': o.sk }, [ta, msg]);
    var read = function () {
      var text = ta.value, v, valid = true, err = '';
      if (text) {
        try { v = yamlParse(text); } catch (e) { valid = false; err = e && e.message || String(e); }
      } else v = {};
      ta.setAttribute('aria-invalid', valid ? 'false' : 'true');
      msg.textContent = err;
      box.className = 'codebox' + (valid ? '' : ' bad');
      box.valid = valid;
      o.onChange(v, valid);
    };
    var escaped = false;
    var put = function (text, from, to) {
      if (typeof ta.setRangeText === 'function') ta.setRangeText(text, from, to, 'end');
      else { ta.value = ta.value.slice(0, from) + text + ta.value.slice(to); }
      read();
    };
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { escaped = true; return; }
      var was = escaped; escaped = false;
      var s = ta.selectionStart, end = ta.selectionEnd, v = ta.value;
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      if (e.key === 'Tab' && !was && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) {
          var lead = /^ {1,2}/.exec(v.slice(ls));
          if (lead) { put('', ls, ls + lead[0].length); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - lead[0].length); }
        } else put('  ', s, end);
      } else if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        var line = v.slice(ls, s), ind = /^ */.exec(line)[0];
        if (/:\s*$/.test(line.replace(/\s+#.*$/, ''))) ind += '  ';
        e.preventDefault();
        put('\n' + ind, s, end);
      }
    });
    ta.addEventListener('input', read);
    box.textarea = ta;
    box.valid = true;
    return box;
  }

  root.hkSettingsKit = {
    version: '2.2.0', CSS: CSS, h: h, esc: esc, icon: icon, svg: svg, id: id,
    CHEV: CHEV, CHECK: CHECK, group: group, nav: nav, toggle: toggle, seg: seg, select: select, slider: slider,
    text: text, info: info, check: check, button: button, recommend: recommend, listEditor: listEditor, confirm: confirm, label: label, popup: popup,
    moveVal: moveVal, yaml: yaml, yamlParse: yamlParse, yamlDump: yamlDump, YamlError: YamlError
  };
})();
