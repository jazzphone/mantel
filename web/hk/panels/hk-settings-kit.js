// hk-settings-kit.js -- THE HK SETTINGS PAGE'S CONTROLS.
//
// The parts an Apple settings screen is made of, and nothing else: inset
// grouped lists with a header and a footer, rows that push a page (›), a
// switch, a segmented control, a pop-up menu (the system's own <select>, so a
// Mac and an iPhone draw their own menu), a slider, a text row, a checkmark
// row, a destructive button, an alert. And the one list every "which, in
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
  function icon(name, cls) { return h('ha-icon', { icon: name, class: cls || 'ic', 'aria-hidden': 'true' }); }

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
    '.cell input.tx::placeholder{color:var(--hk-label3)}',
    '.cell.textrow:focus-within{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--hk-tint) 55%,transparent);border-radius:10px}',
    '.cell .unit{color:var(--hk-label2)}',
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
  // confirm(shadowRoot, {title, message, ok, cancel, destructive}) -> Promise<bool>.
  // Cancel is where focus starts; Escape cancels; focus stays in the alert.
  function confirm(rootEl, o) {
    return new Promise(function (resolve) {
      var tid = id('dt'), mid = id('dm');
      var prev = rootEl.activeElement || document.activeElement;
      var cancel = h('button', { type: 'button', class: 'cx' + (o.destructive ? ' bold' : ''), text: o.cancel || 'Cancel' });
      var ok = h('button', { type: 'button', class: o.destructive ? 'red' : 'bold', text: o.ok || 'OK' });
      var dlg = h('div', { class: 'dlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': tid, 'aria-describedby': mid }, [
        h('h2', { id: tid, text: o.title }), h('p', { id: mid, text: o.message || '' }), h('div', { class: 'db' }, [cancel, ok])]);
      var bd = h('div', { class: 'dlgbd' }, dlg);
      var close = function (v) {
        bd.remove();
        if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* gone */ } }
        resolve(v);
      };
      cancel.addEventListener('click', function () { close(false); });
      ok.addEventListener('click', function () { close(true); });
      bd.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        if (e.key === 'Tab') { e.preventDefault(); (rootEl.activeElement === ok ? cancel : ok).focus(); }
      });
      bd.addEventListener('click', function (e) { if (e.target === bd) close(false); });
      rootEl.appendChild(bd);
      // side by side unless a label would be cut: then stacked
      var row = dlg.querySelector('.db');
      if ([cancel, ok].some(function (b) { return b.scrollWidth > b.clientWidth + 1; })) row.classList.add('stack');
      cancel.focus();
    });
  }

  root.hkSettingsKit = {
    version: '2.0.0', CSS: CSS, h: h, esc: esc, icon: icon, svg: svg, id: id,
    CHEV: CHEV, CHECK: CHECK, group: group, nav: nav, toggle: toggle, seg: seg, select: select, slider: slider,
    text: text, info: info, check: check, button: button, listEditor: listEditor, confirm: confirm, label: label, popup: popup,
    moveVal: moveVal
  };
})();
