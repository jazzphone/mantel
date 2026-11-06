// @ts-check
// Saved designs use the ordinary screensaver options. The flat options remain
// the active design, so older screens and all existing widgets keep working.
(function () {
  'use strict';
  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  function snapshot(o) { var v = clone(o); delete v.designs; delete v.active_design; return v; }
  function sync(o) {
    (o.designs || []).forEach(function (d) { if (d.id === o.active_design) d.options = snapshot(o); });
    return o;
  }
  function activate(o, id) {
    sync(o);
    var designs = clone(o.designs || []), d = designs.find(function (x) { return x.id === id; });
    if (!d) return o;
    return Object.assign(window.hkSettingsModel.saverOptions(d.options), { designs: designs, active_design: id });
  }
  function add(o, name, options) {
    sync(o);
    if ((o.designs || []).length >= 12) return null;
    var id = 'face-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    o.designs = (o.designs || []).concat([{ id: id, name: name.trim().slice(0, 60), options: snapshot(options || o) }]);
    return activate(o, id);
  }
  function preset(o, id) {
    var E = window.hkSaverEditor, M = window.hkSettingsModel, LM = window.hkSaverLayout, v = M.saverOptions(snapshot(o));
    if (id.indexOf('look:') === 0) { v.layout = clone(v.layout || LM.layoutFrom(v)); E.applyLook(v, E.LOOKS.find(function (l) { return l.id === id.slice(5); }), false); v.layout = E.lookLayout(E.LOOKS.find(function (l) { return l.id === id.slice(5); })); return v; }
    var parts = id.split(':'), style = parts[0];
    if (style === 'planted') { var planted = E.LOOKS.find(function (l) { return l.id === 'planted'; }); v.layout = E.lookLayout(planted); E.applyLook(v, planted, false); return v; }
    v.show = 'clock'; v.clock_style = style; v.clock_bg = 'black';
    v.clock_options = { cities: [{ name: 'New York', zone: 'America/New_York' }, { name: 'London', zone: 'Europe/London' }, { name: 'Tokyo', zone: 'Asia/Tokyo' }] };
    if (parts[1]) { if (style === 'world') v.clock_options.world_view = parts[1]; else v.clock_options.watch_shape = parts[1]; }
    // Each design can be composed with every widget, including its upright layout.
    v.layout = LM.layoutFrom(v); v.layout.big = { kind: 'time', size: ['world', 'hotel', 'terminal', 'markets', 'brief', 'modular'].indexOf(style) >= 0 ? 30 : 36, pos: 'center', align: 'center', depth: 'front' };
    Object.keys(v.layout.zones).forEach(function (z) { v.layout.zones[z] = []; });
    return v;
  }
  function gallery(ed) {
    if (ed.galleryEl && ed.galleryEl.isConnected) return;
    ed.galleryOpen = true;
    var h = ed.h, M = ed.M, oldFocus = ed.shadowRoot.activeElement;
    var root = h('section', { class: 'design-gallery', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Screensaver Designs' });
    ed.galleryEl = root;
    var css = h('style', { text: '.design-gallery{position:absolute;inset:0;z-index:10;background:var(--hk-bg);overflow:auto;padding:20px;box-sizing:border-box}.design-gallery header{position:sticky;top:-20px;z-index:2;background:var(--hk-bg);display:flex;align-items:center;gap:12px;flex-wrap:wrap}.design-gallery h2{flex:1;margin:4px 0}@media(max-width:600px){.design-gallery h2{flex-basis:100%}}.design-gallery button,.design-gallery input{font:inherit;min-height:44px;border:0;border-radius:12px;padding:8px 16px;color:var(--hk-label);background:var(--hk-fill)}.design-gallery .primary{background:var(--hk-tint);color:white}.design-gallery .scope{color:var(--hk-label2);max-width:800px;line-height:1.5}.design-rail{display:flex;gap:20px;overflow-x:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;scroll-padding:20px;padding:16px max(20px,calc((100% - min(72vw,360px))/2)) 24px;margin:0 -20px;touch-action:pan-x pan-y pinch-zoom}.design-card{flex:0 0 min(72vw,360px);scroll-snap-align:center;position:relative;text-align:left;border:2px solid transparent!important;padding:12px!important;display:flex;flex-direction:column;gap:12px}.design-card[aria-pressed=true]{border-color:var(--hk-tint)!important}.design-card .sthumb{width:100%!important;height:auto!important;aspect-ratio:1180/820;margin:0!important}.design-gallery .design-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.design-gallery .catalog{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px}.design-gallery .catalog .design-card{width:100%;min-width:0}.design-gallery :focus-visible{outline:3px solid var(--hk-tint);outline-offset:3px}@media(prefers-reduced-motion:reduce){.design-rail{scroll-behavior:auto}}' });
    var save = h('button', { text: 'Save', class: 'primary gallery-save', onclick: async function () {
      save.disabled = true; status.textContent = 'Saving…';
      await ed.save();
      if (root.isConnected) { save.disabled = false; status.textContent = ed.message.textContent; }
    } });
    var head = h('header', {}, [h('h2', { text: 'Screensaver Designs' }), h('button', { text: 'Cancel', onclick: function () { ed.cancel(); } }), h('button', { text: 'Customize', class: 'customize', onclick: close }), save]);
    var scope = h('p', { class: 'scope', text: ed.o.house ? 'All Screens · These are the designs and saved default for screens using Same as All Screens. Each device can remember another design, and each screen keeps its own Side Pane.' : ed.o.title + ' · Saving gives this screen its own designs and settings. All Screens and other screens stay as they are.' });
    var rail = h('div', { class: 'design-rail', role: 'group', 'aria-label': 'Saved designs. Swipe to browse.' });
    var actions = h('div', { class: 'design-actions' }), status = h('p', { role: 'status' });
    var catalog = h('div', { class: 'catalog' });
    root.append(css, head, scope, h('h3', { text: 'Your Designs' }), rail, actions, status, h('h3', { text: 'Add a Design' }), h('p', { class: 'scope', text: 'Choose a starting point, then customize its face, background, widgets, slides and timing. Press Save to apply your designs, or Customize to arrange widgets and change their options.' }), catalog);
    ed.ui.appendChild(root);
    function close() { root.remove(); ed.galleryEl = null; ed.galleryOpen = false; ed.redraw(); ed.preview(); if (oldFocus && oldFocus.focus) oldFocus.focus(); }
    function mutate(fn) { if (ed.busy) return; ed.change(function (o) { fn(o); }); draw(); }
    function choose(id) { userScrolling = false; finger = false; mouseDrag = false; mutate(function (o) { Object.assign(o, activate(o, id)); }); }
    function card(name, opts, id, click) {
      var kind = opts.show === 'clock' ? 'clock:' + opts.clock_style : opts.show === 'both' ? 'photos' : opts.show;
      var b = h('button', { class: 'design-card', 'aria-pressed': id && id === ed.opts.active_design ? 'true' : 'false', onclick: click },
        [ed.panel.saverThumb(320, 208, kind, opts), h('b', { text: name })]);
      return b;
    }
    function draw() {
      var left = rail.scrollLeft;
      rail.replaceChildren(); actions.replaceChildren();
      var list = ed.opts.designs || [], active = list.find(function (d) { return d.id === ed.opts.active_design; });
      if (!list.length) rail.appendChild(card('Current Screensaver', ed.opts, '', function () {}));
      list.forEach(function (d) { rail.appendChild(card(d.name, d.id === ed.opts.active_design ? ed.opts : d.options, d.id, function () { choose(d.id); })); });
      var name = h('input', { 'aria-label': 'Design Name', maxlength: '60', placeholder: 'Design name' }); name.value = active ? active.name : 'My Screensaver';
      name.addEventListener('change', function () {
        if (!name.value.trim()) return;
        if (ed.busy || !active) return;
        var label = name.value.trim();
        ed.change(function (o) { o.designs.find(function (d) { return d.id === active.id; }).name = label; });
        var at = (ed.opts.designs || []).findIndex(function (d) { return d.id === active.id; });
        var title = rail.children[at] && rail.children[at].querySelector('b'); if (title) title.textContent = label;
      });
      actions.append(name, h('button', { text: active ? 'Duplicate' : 'Save as a Design', onclick: function () {
        var next = add(clone(ed.opts), (name.value.trim() || 'My Screensaver') + (active ? ' Copy' : ''));
        if (!next) { status.textContent = 'You can keep up to 12 designs. Remove one to add another.'; return; }
        mutate(function (o) { Object.assign(o, next); });
      } }));
      if (active) actions.appendChild(h('button', { text: 'Remove Design', onclick: async function () {
        if (!await ed.K.confirm(ed.shadowRoot, { title: 'Remove “' + active.name + '”?', message: 'The current screensaver stays on screen. Only this saved design is removed.', ok: 'Remove', destructive: true })) return;
        mutate(function (o) { o.designs = o.designs.filter(function (d) { return d.id !== active.id; }); o.active_design = ''; });
      } }));
      rail.scrollLeft = left;
      if (!root.contains(ed.shadowRoot.activeElement)) head.querySelector('button').focus({ preventScroll: true });
      status.textContent = list.length + ' of 12 designs · Swipe the cards or tap one to select it. Customize opens all 44 widgets and the full editor.';
    }
    var scrollTimer = null, userScrolling = false, finger = false, mouseDrag = false;
    function settled() {
      if (!userScrolling || finger || mouseDrag || !root.isConnected || !(ed.opts.designs || []).length) return;
      var box = rail.getBoundingClientRect(), middle = (box.left + box.right) / 2;
      var cards = Array.from(rail.children), nearest = cards.reduce(function (best, card) {
        var r = card.getBoundingClientRect(), distance = Math.abs((r.left + r.right) / 2 - middle);
        return !best || distance < best.distance ? { card: card, distance: distance } : best;
      }, null);
      var at = nearest && cards.indexOf(nearest.card), d = ed.opts.designs[at];
      userScrolling = false;
      if (d && d.id !== ed.opts.active_design) choose(d.id);
    }
    function afterScroll() { clearTimeout(scrollTimer); scrollTimer = setTimeout(settled, 180); }
    rail.addEventListener('touchstart', function () { userScrolling = true; finger = true; }, { passive: true });
    rail.addEventListener('touchend', function () { finger = false; afterScroll(); }, { passive: true });
    rail.addEventListener('touchcancel', function () { finger = false; afterScroll(); }, { passive: true });
    rail.addEventListener('pointerdown', function (e) { userScrolling = true; if (e.pointerType === 'mouse') mouseDrag = true; });
    rail.addEventListener('pointerup', function () { mouseDrag = false; afterScroll(); });
    rail.addEventListener('pointercancel', function () { mouseDrag = false; afterScroll(); });
    rail.addEventListener('wheel', function () { userScrolling = true; }, { passive: true });
    rail.addEventListener('keydown', function (e) { if (/^Arrow/.test(e.key)) userScrolling = true; });
    rail.addEventListener('scroll', afterScroll, { passive: true });
    rail.addEventListener('scrollend', settled);
    var starts = M.CLOCK_STYLES.map(function (f) { return [f[0], f[1]]; }).concat(window.hkSaverEditor.LOOKS.map(function (l) { return ['look:' + l.id, l.n]; }), [['world:horizon', 'World · Horizon'], ['world:close', 'World · Close'], ['atelier:rectangle', 'Atelier · Rectangle'], ['meridian:cushion', 'Meridian · Cushion']]);
    starts.forEach(function (f) {
      var opts = preset(ed.opts, f[0]);
      catalog.appendChild(card(f[1], opts, '', function () {
        var next = add(clone(ed.opts), f[1], opts);
        if (!next) { status.textContent = 'You can keep up to 12 designs. Remove one to add another.'; return; }
        mutate(function (o) { Object.assign(o, next); }); rail.scrollTo({ left: rail.scrollWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      }));
    });
    root.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
      if (ev.key === 'Tab') {
        var all = Array.from(root.querySelectorAll('button,input')).filter(function (n) { return !n.disabled; }), at = all.indexOf(ed.shadowRoot.activeElement);
        if (ev.shiftKey && at <= 0) { ev.preventDefault(); all[all.length - 1].focus(); }
        else if (!ev.shiftKey && at === all.length - 1) { ev.preventDefault(); all[0].focus(); }
      }
    });
    draw(); head.querySelector('button').focus();
  }
  window.hkSaverDesigns = { snapshot: snapshot, sync: sync, activate: activate, add: add, preset: preset, gallery: gallery };
})();
