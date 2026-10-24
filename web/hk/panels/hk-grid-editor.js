// Home Grid's desktop editor (docs/phase11/HOME-GRID.md, G5; rebuilt 2026-10-23
// around a palette): the cards on the left -- drag one onto the grid, or
// click it for its live preview and Add --, the screen in the middle, and on
// the right the selected block's settings (nothing selected: the screen's).
// The draft belongs to this element; only Save writes.
// Placement functions are pure so mouse, keyboard and the palette share refusals.
(function () {
  'use strict';
  if (window.hkGridEditor) return;
  var G = window.hkGridCatalog, SIZES = G.SIZES;
  var NAMES = { accessory: 'Accessory', accessories: 'Accessory Group', scene: 'Scene', scenes: 'Scenes', now_playing: 'Now Playing',
    thermostat: 'Thermostat', camera: 'Camera', security: 'Security', timers: 'Timers', weather: 'Weather',
    calendar: 'Calendar', battery: 'House Battery', people: 'People', vacuum: 'Vacuum', clock: 'Clock',
    room: 'Room', scene_suggested: 'Suggested Scene', action: 'Action', everything: 'Everything' };
  var SIZE_NAMES = { S: 'Small', W: 'Wide', T: 'Tall', L: 'Large', XL: 'Extra Large', XXL: 'Full Width' };
  // a size on a chip or a segment, short enough for four in a row
  var SIZE_SHORT = { S: 'Small', W: 'Wide', T: 'Tall', L: 'Large', XL: 'X-Large', XXL: 'Full' };
  var GROUPS = [
    ['Rooms & Lights', ['room', 'accessory', 'accessories', 'action']], ['Scenes', ['scene', 'scenes', 'scene_suggested']],
    ['Climate', ['thermostat', 'weather']], ['Music', ['now_playing']],
    ['Security & Cameras', ['security', 'camera']], ['Info', ['clock', 'timers', 'calendar', 'battery', 'people', 'vacuum', 'everything']]
  ];
  var DESCRIPTIONS = { room: 'Your room’s lights, fans and speaker', accessory: 'One light, switch or other accessory', accessories: 'Accessories you choose, in swipe pages',
    action: 'One tap for a household job', scene: 'Set a favourite scene', scenes: 'Your scenes together',
    scene_suggested: 'The right scene for the time of day', thermostat: 'Temperature and climate controls',
    weather: 'Current conditions and the forecast', now_playing: 'Music and playback controls', security: 'Alarm, locks and doors',
    camera: 'One camera, or swipe between cameras', clock: 'Time and date at a glance', timers: 'Timers and quick starts',
    calendar: 'Your upcoming events', battery: 'Your home’s stored energy', people: 'Who is home', vacuum: 'Cleaning status and controls',
    everything: 'Open the screen’s full menu' };
  var GLYPHS = { room: 'mdi:sofa', accessory: 'mdi:lightbulb', accessories: 'mdi:view-grid', action: 'mdi:gesture-tap', scene: 'mdi:palette',
    scenes: 'mdi:palette', scene_suggested: 'mdi:weather-sunset', thermostat: 'mdi:thermostat', weather: 'mdi:weather-partly-cloudy',
    now_playing: 'mdi:music', security: 'mdi:shield-home', camera: 'mdi:camera', clock: 'mdi:clock', timers: 'mdi:timer-outline',
    calendar: 'mdi:calendar', battery: 'mdi:home-battery', people: 'mdi:account', vacuum: 'mdi:robot-vacuum', everything: 'mdi:dots-horizontal' };
  // AN OPTION'S NAME in the panel: by its kind (hk-grid-catalog.js opts), else by its own name
  var KIND_LABELS = { entity: 'Accessory', climate: 'Thermostat', camera: 'Camera', weather: 'Weather', vacuum: 'Vacuum',
    speaker: 'Speaker', scene: 'Scene', scenes: 'Scenes', calendars: 'Calendars', area: 'Room', action: 'Does', windows: 'Time Windows' };
  var NAME_LABELS = { sky: 'Sky Background', title: 'Group Name' };
  // ONE THING OR PAGES THAT SWIPE, in each card's words: [one, its automatic source]
  var SHOW = { room: ['One Room', 'Swipe Between Rooms'], camera: ['One Camera', 'Swipe All Cameras'],
    thermostat: ['One Thermostat', 'Swipe All Thermostats'], now_playing: ['One Speaker', 'Swipe All Speakers'],
    scenes: ['Chosen Scenes', 'Swipe All Scenes'], accessories: [null, 'Automatic Pages'] };
  // what an automatic source shows in place of the block's own choice of one
  var SOURCE_HIDES = { rooms: 'area', cameras: 'entity', thermostats: 'entity', speakers: 'speaker', scenes: 'scenes' };
  var EMPTY = { v: 1, cols: 6, rows: 4, frame: [1280, 800], band: true, items: [] };
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function overlap(a, b) {
    var x = SIZES[a.size], y = SIZES[b.size];
    return a.at[0] < b.at[0] + y[0] && b.at[0] < a.at[0] + x[0] &&
      a.at[1] < b.at[1] + y[1] && b.at[1] < a.at[1] + x[1];
  }
  function fits(grid, item) {
    var z = SIZES[item.size];
    return !!z && item.at.every(Number.isInteger) && item.at[0] >= 0 && item.at[1] >= 0 &&
      item.at[0] + z[0] <= grid.cols && item.at[1] + z[1] <= grid.rows;
  }
  function valid(grid) {
    return [6, 3, 2].indexOf(grid.cols) >= 0 && Number.isInteger(grid.rows) && grid.rows >= 2 && grid.rows <= 6 &&
      grid.frame.length === 2 && Number.isInteger(grid.frame[0]) && Number.isInteger(grid.frame[1]) &&
      grid.frame[0] >= 320 && grid.frame[0] <= 3840 && grid.frame[1] >= 320 && grid.frame[1] <= 2160 &&
      grid.items.length <= 24 && grid.items.every(function (it, i) {
        var cat = G.table()[it.card];
        return cat && cat.sizes.indexOf(it.size) >= 0 && (!it.when || it.fallback && G.table()[it.fallback.card] && G.table()[it.fallback.card].sizes.includes(it.size)) && fits(grid, it) &&
          !grid.items.slice(i + 1).some(function (other) { return it.id === other.id || overlap(it, other); });
      });
  }
  // A move may swap exactly one block of the same class. A resize never swaps.
  function place(grid, id, at, size) {
    var out = copy(grid), item = out.items.find(function (it) { return it.id === id; });
    if (!item || !SIZES[size || item.size]) return null;
    var old = copy(item), resizing = size && size !== item.size;
    item.at = at.slice(); item.size = size || item.size;
    if (!fits(out, item)) return null;
    var hit = out.items.filter(function (it) { return it.id !== id && overlap(item, it); });
    if (hit.length) {
      if (resizing || hit.length !== 1 || hit[0].size !== item.size) return null;
      hit[0].at = old.at;
    }
    return valid(out) ? out : null;
  }
  function firstSpace(grid, size) {
    for (var row = 0; row < grid.rows; row++) for (var col = 0; col < grid.cols; col++) {
      var it = { size: size, at: [col, row] };
      if (fits(grid, it) && !grid.items.some(function (x) { return overlap(it, x); })) return it.at;
    }
    return null;
  }
  function snap(x, y, rect, cols, rows) {
    return [Math.floor((x - rect.left) / (rect.width / cols)), Math.floor((y - rect.top) / (rect.height / rows))];
  }
  // where a block of `size` dragged by its middle lands: the pointer in its
  // centre cell, kept inside the grid
  function landing(x, y, rect, cols, rows, gap, size) {
    var z = SIZES[size], cw = (rect.width - (cols - 1) * gap) / cols, ch = (rect.height - (rows - 1) * gap) / rows;
    var c = Math.round((x - rect.left) / (cw + gap) - z[0] / 2), r = Math.round((y - rect.top) / (ch + gap) - z[1] / 2);
    return [Math.max(0, Math.min(cols - z[0], c)), Math.max(0, Math.min(rows - z[1], r))];
  }
  function add(grid, card, size, at) {
    if (grid.items.length >= 24) return null;
    var out = copy(grid), n = 1;
    while (out.items.some(function (it) { return it.id === 'b' + n; })) n++;
    var item = { id: 'b' + n, card: card, size: size, at: at || firstSpace(grid, size) };
    if (!item.at) return null;
    out.items.push(item);
    return valid(out) ? out : null;
  }
  var CSS = [
    ':host{position:fixed;inset:0;z-index:1000;overflow:hidden}',
    '.editor{height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--hk-bg)}',
    '.tools{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--hk-sep);background:var(--hk-cell);flex:none;z-index:4}',
    '.tools h1{font-size:20px;margin:0;flex:1}.tools button{border:0;border-radius:8px;min-height:44px;padding:0 16px;background:var(--hk-fill);color:var(--hk-label);font:inherit;cursor:pointer}',
    '.tools .save{background:var(--hk-tint);color:white}.tools button:disabled{opacity:.4;cursor:default}',
    '.work{flex:1;min-height:0;overflow:hidden;box-sizing:border-box;display:grid;grid-template-columns:280px minmax(0,1fr) 340px;gap:16px;padding:16px 16px 0}',
    '@media(max-width:1380px){.work{grid-template-columns:240px minmax(0,1fr) 300px}}',
    '.stage{min-width:0;min-height:0;overflow:hidden}',
    '.palette,aside.sidebar{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-bottom:24px}',
    '.framebox{position:relative;overflow:hidden;margin:auto;border-radius:10px;background:var(--hk-cell);outline:1px solid var(--hk-sep)}',
    '.frame{position:absolute;left:0;top:0;transform-origin:top left;background:var(--hk-cell);overflow:hidden}',
    'iframe{position:absolute;inset:0;border:0;width:100%;height:100%;pointer-events:none}',
    '.grid{position:absolute;display:grid;gap:10px;z-index:2}',
    '.slot{border:1px dashed var(--hk-label3);border-radius:var(--grid-radius,var(--hk-glass-radius,23.5px));pointer-events:none}',
    '.block{position:absolute;z-index:3;cursor:grab;border:2px solid transparent;background:transparent;border-radius:var(--grid-radius,var(--hk-glass-radius,23.5px));color:var(--hk-label);touch-action:none}',
    '.block:hover{border-color:color-mix(in srgb,var(--hk-tint) 45%,transparent)}',
    '.block[aria-pressed=true]{border-color:var(--hk-tint)}.block:focus-visible{outline:3px solid var(--hk-tint)}',
    // the block's name: just above the one pointed at or chosen, never over a card's own title
    '.block .tag{position:absolute;bottom:calc(100% + 4px);left:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 8px;border-radius:7px;background:var(--hk-cell);font-size:13px;opacity:0;transition:opacity .12s}',
    '.block:hover .tag,.block[aria-pressed=true] .tag,.block:focus-visible .tag{opacity:1}',
    '.ghost{position:absolute;pointer-events:none;border:3px solid var(--hk-tint);background:color-mix(in srgb,var(--hk-tint) 18%,transparent);border-radius:var(--grid-radius,var(--hk-glass-radius,23.5px));z-index:4}.ghost.bad{border-color:var(--hk-red);background:color-mix(in srgb,var(--hk-red) 14%,transparent)}',
    '.float{position:fixed;left:0;top:0;z-index:20;pointer-events:none;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:var(--hk-cell);color:var(--hk-label);box-shadow:var(--hk-shadow);font-size:13px;font-weight:600;white-space:nowrap}',
    '.float hk-icon{width:20px;height:20px;color:var(--hk-tint)}',
    '.note{font-size:13px;color:var(--hk-label2);line-height:1.5;margin:0 0 10px}.message{flex:none;color:var(--hk-red);min-height:24px;padding:6px 20px 0}',
    // THE PALETTE
    '.pal-head{position:sticky;top:0;z-index:2;background:var(--hk-bg);padding:0 0 12px}',
    '.pal-head p{font-size:13px;color:var(--hk-label2);margin:8px 4px 0;line-height:1.4}',
    '.catalog-search{box-sizing:border-box;width:100%;min-height:40px;border:1px solid var(--hk-sep);border-radius:10px;padding:8px 12px;background:var(--hk-cell);color:var(--hk-label);font:inherit;font-size:15px}',
    '.pick-banner{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--hk-tint) 16%,var(--hk-cell));font-size:14px}',
    '.pick-banner span{flex:1}.pick-banner button{border:0;background:none;color:var(--hk-tint);font:inherit;cursor:pointer;min-height:32px}',
    '.pal-row{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 12px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}',
    '.pal-row:active{cursor:grabbing}.pal-row[aria-expanded=true]{background:var(--hk-hover)}',
    '.pal-row > hk-icon{width:24px;height:24px;flex:none;color:var(--hk-tint)}',
    '.pal-row .pt{display:grid;gap:2px;flex:1;min-width:0}.pal-row .pt b{font-weight:600;font-size:15px}',
    '.pal-row .pt small{font-size:12px;color:var(--hk-label2);line-height:1.3}',
    '.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}',
    '.chip{min-width:0;height:24px;padding:0 7px;border-radius:6px;border:0;background:var(--hk-fill);color:var(--hk-label2);font:inherit;font-size:11px;font-weight:600;cursor:pointer}',
    '.chip[aria-pressed=true]{background:var(--hk-tint);color:#fff}.chip[data-full=true]{opacity:.45}',
    '.pal-detail{display:block;padding:4px 12px 12px}',
    '.catalog-preview{position:relative;width:100%;overflow:hidden;border-radius:10px;background:var(--hk-fill);margin:4px 0 8px;cursor:grab}.catalog-preview > *{pointer-events:none}',
    '.catalog-add{width:100%;min-height:40px;border:0;border-radius:10px;background:var(--hk-tint);color:white;font:inherit;cursor:pointer}.catalog-add:disabled{opacity:.4;cursor:default}',
    // THE INSPECTOR
    '.insp-head{display:flex;align-items:center;gap:12px;padding:4px 4px 16px}',
    '.insp-head hk-icon{width:30px;height:30px;flex:none;padding:9px;border-radius:12px;background:var(--hk-cell);color:var(--hk-tint)}',
    '.insp-head h2{margin:0;font-size:20px;font-weight:700}.insp-head p{margin:2px 0 0;font-size:13px;color:var(--hk-label2)}',
    '.insp-head .done{margin-left:auto;border:0;background:none;color:var(--hk-tint);font:inherit;font-size:15px;cursor:pointer;min-height:44px}',
    '.screen-settings{margin:4px 0 16px}.screen-settings summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;font-weight:600;padding:0 4px}.screen-settings summary::before{content:"›";display:inline-block;transition:transform .15s}.screen-settings[open] summary::before{transform:rotate(90deg)}',
    '.desktop-note{display:none;padding:32px}',
    '@media(max-width:899px),(pointer:coarse){.work,.tools .save,.tools .undo{display:none}.desktop-note{display:block}}'
  ].join('\n');

  class GridEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this.selected = null; this.busy = false; this.undoStack = []; this.paletteSizes = {}; }
    configure(options) {
      this.o = options; this.panel = options.panel; this.K = window.hkSettingsKit; this.h = this.K.h;
      this.grid = options.board.home_grid ? copy(options.board.home_grid) : null;
      this.initial = JSON.stringify(this.grid);
    }
    connectedCallback() {
      this.toggleAttribute('dark', this.panel.hasAttribute('dark'));
      if (this.ui) { this.fit(); return; }
      this.draw();
      this.ro = new ResizeObserver(this.fit.bind(this)); this.ro.observe(this.stage); this.ro.observe(this.stage.querySelector('.note'));
      this.unload = (e) => { if (this.dirty()) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', this.unload);
    }
    disconnectedCallback() {
      if (this.ro) this.ro.disconnect();
      if (this.previewRO) this.previewRO.disconnect();
      if (this.previewOff) this.previewOff();
      this.previewView = null;
      if (this.catalogOff) this.catalogOff();
      clearTimeout(this.previewTimer);
      window.removeEventListener('beforeunload', this.unload);
      this.ui = null;
    }
    dirty() { return JSON.stringify(this.grid) !== this.initial; }
    say(message) { this.message.textContent = message || ''; }
    async cancel() {
      if (this.busy) return;
      if (this.dirty() && !await this.K.confirm(this.shadowRoot, { title: 'Discard Changes?', message: 'Your saved layout stays as it was.', ok: 'Discard', destructive: true })) return;
      this.o.onCancel();
    }
    draw() {
      var h = this.h, K = this.K;
      this.shadowRoot.replaceChildren(h('style', { text: K.CSS + '\n' + CSS }));
      this.ui = h('div', { class: 'editor' }); this.shadowRoot.appendChild(this.ui);
      this.saveButton = h('button', { class: 'save', text: 'Save', onclick: () => this.save(), disabled: !this.grid });
      this.undoButton = h('button', { class: 'undo', text: 'Undo', title: 'Undo (⌘Z)', onclick: () => this.undo(), disabled: true });
      this.ui.appendChild(h('header', { class: 'tools' }, [h('button', { text: 'Cancel', onclick: () => this.cancel() }),
        h('h1', { text: this.o.title + ' · Home Grid' }), this.undoButton, this.saveButton]));
      this.message = h('div', { class: 'message', role: 'status', 'aria-live': 'polite' }); this.ui.appendChild(this.message);
      this.ui.appendChild(h('div', { class: 'desktop-note', text: 'Arrange Home Grid on a desktop with a mouse or trackpad. This screen only displays the saved layout.' }));
      this.palette = h('aside', { class: 'palette', 'aria-label': 'Cards' });
      this.stage = h('section', { class: 'stage', 'aria-label': 'Screen layout' });
      this.sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Block and screen settings', tabindex: '0' });
      this.ui.appendChild(h('div', { class: 'work' }, [this.palette, this.stage, this.sidebar]));
      this.stage.appendChild(h('p', { class: 'note', text: 'Drag a card from the left onto the grid. Drag blocks to move them; equal sizes swap. Cards are a preview: their controls don’t act on the house.' }));
      this.box = h('div', { class: 'framebox' }); this.stage.appendChild(this.box);
      this.frame = h('div', { class: 'frame' }); this.box.appendChild(this.frame);
      this.iframe = h('iframe', { title: 'Home Grid preview', tabindex: '-1', 'aria-hidden': 'true' });
      this.iframe.inert = true;
      this.iframe.src = this.panel.hostScreenBase() + '/' + this.o.path + '/home?hk_kiosk=on&kiosk&wp_enabled=false';
      this.iframe.addEventListener('load', () => this.preview());
      this.frame.appendChild(this.iframe);
      this.overlay = h('div', { class: 'grid', 'aria-label': 'Grid blocks' }); this.frame.appendChild(this.overlay);
      // a click on the grid's empty space lets the block go: the screen's settings again
      this.stage.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.block')) { if (this.selected) this.select(null); } });
      this.shadowRoot.addEventListener('keydown', (e) => this.keys(e));
      this.blocks(); this.side(); this.fit();
    }
    // ⌘Z / Ctrl+Z undoes; Escape lets a block (or a card choice) go; Delete removes the chosen block
    keys(e) {
      var path = e.composedPath ? e.composedPath() : [e.target], field = path.find((el) => el.matches && el.matches('input,select,textarea'));
      if (field) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if (e.key === 'Escape' && (this.pickerTarget || this.selected)) { e.preventDefault(); if (this.pickerTarget) this.pickFor(null); else this.select(null); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && path.some((el) => el.classList && el.classList.contains('block'))) {
        e.preventDefault(); this.remove(this.selected);
      }
    }
    change(grid, fromUndo) {
      if (!fromUndo && this.grid && JSON.stringify(grid) !== JSON.stringify(this.grid)) {
        this.undoStack.push({ grid: copy(this.grid), selected: this.selected });
        if (this.undoStack.length > 50) this.undoStack.shift();
      }
      this.grid = grid; this.saveButton.disabled = false; this.undoButton.disabled = !this.undoStack.length;
      if (this.selected && !grid.items.some((it) => it.id === this.selected)) this.selected = null;
      this.say(''); this.blocks(); this.side(); this.fit(); this.preview();
    }
    undo() {
      var last = this.undoStack.pop();
      if (!last || this.busy) return;
      this.selected = last.selected; this.change(last.grid, true);
      this.say('Undone.');
    }
    remove(id) {
      var next = copy(this.grid), it = next.items.find((x) => x.id === id);
      next.items = next.items.filter((x) => x.id !== id); this.selected = null; this.change(next);
      if (it) this.say(NAMES[it.card] + ' removed. Undo (⌘Z) puts it back.');
    }
    blocks() {
      this.overlay.replaceChildren();
      if (!this.grid) return;
      var h = this.h, self = this;
      this.overlay.style.gridTemplateColumns = 'repeat(' + this.grid.cols + ',1fr)';
      this.overlay.style.gridTemplateRows = 'repeat(' + this.grid.rows + ',1fr)';
      for (var i = 0; i < this.grid.cols * this.grid.rows; i++) this.overlay.appendChild(h('div', { class: 'slot' }));
      this.grid.items.forEach(function (it) {
        var b = h('button', { class: 'block', type: 'button', 'data-id': it.id, 'aria-label': NAMES[it.card] + ', ' + SIZE_NAMES[it.size] + ', column ' + (it.at[0] + 1) + ', row ' + (it.at[1] + 1),
          'aria-pressed': self.selected === it.id ? 'true' : 'false' }, h('span', { class: 'tag', text: NAMES[it.card] + ' · ' + SIZE_NAMES[it.size] }));
        self.position(b, it);
        b.addEventListener('click', () => { self.select(it.id); });
        b.addEventListener('pointerdown', (e) => self.drag(e, it, b));
        b.addEventListener('keydown', function (e) {
          var delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          if (!delta) return;
          e.preventDefault(); self.selected = it.id;
          var next = place(self.grid, it.id, [it.at[0] + delta[0], it.at[1] + delta[1]]);
          if (next) { self.change(next); self.overlay.querySelector('[data-id="' + it.id + '"]').focus(); }
          else self.say('That move does not fit.');
        });
        self.overlay.appendChild(b);
      });
    }
    select(id) {
      this.selected = id; this.conditionPreview = null; this.pickerTarget = null;
      this.overlay.querySelectorAll('.block').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false'));
      this.side();
      if (id === null) this.preview();
    }
    position(el, it) {
      var gap = this.cellGap || 10, z = SIZES[it.size], w = (this.overlay.clientWidth - (this.grid.cols - 1) * gap) / this.grid.cols;
      var h = (this.overlay.clientHeight - (this.grid.rows - 1) * gap) / this.grid.rows;
      Object.assign(el.style, { left: it.at[0] * (w + gap) + 'px', top: it.at[1] * (h + gap) + 'px', width: (w + gap) * z[0] - gap + 'px', height: (h + gap) * z[1] - gap + 'px' });
    }
    drag(e, it, button) {
      if (e.button !== 0 || this.busy) return;
      this.select(it.id);
      var start = [e.clientX, e.clientY], at = it.at.slice(), moved = false, self = this;
      var ghost = this.h('div', { class: 'ghost' }); this.position(ghost, it);
      var origin = snap(e.clientX, e.clientY, this.overlay.getBoundingClientRect(), this.grid.cols, this.grid.rows);
      button.setPointerCapture(e.pointerId);
      var move = function (ev) {
        if (Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 4 && !moved) return;
        moved = true; if (!ghost.parentNode) self.overlay.appendChild(ghost);
        var pos = snap(ev.clientX, ev.clientY, self.overlay.getBoundingClientRect(), self.grid.cols, self.grid.rows);
        at = [it.at[0] + pos[0] - origin[0], it.at[1] + pos[1] - origin[1]];
        self.position(ghost, Object.assign({}, it, { at: at }));
        ghost.classList.toggle('bad', !place(self.grid, it.id, at));
      };
      var finish = function (ev) {
        button.removeEventListener('pointermove', move); button.removeEventListener('pointerup', finish); button.removeEventListener('pointercancel', finish);
        ghost.remove();
        if (moved && ev.type !== 'pointercancel') {
          var next = place(self.grid, it.id, at);
          if (next) self.change(next); else self.say('That move does not fit. The block stays where it was.');
        }
      };
      button.addEventListener('pointermove', move); button.addEventListener('pointerup', finish); button.addEventListener('pointercancel', finish);
    }
    // A CARD DRAGGED OUT OF THE PALETTE: a label follows the pointer, and over
    // the grid the block's real footprint shows where it lands (red: no room)
    paletteDrag(e, card, row) {
      if (!this.grid || this.busy || this.pickerTarget) return false;
      var self = this, size = this.sizeFor(card), ghost = this.h('div', { class: 'ghost' }), at = null;
      var label = this.h('div', { class: 'float' }, [this.h('hk-icon', { icon: GLYPHS[card] }), this.h('span', { text: NAMES[card] + ' · ' + SIZE_NAMES[size] })]);
      this.shadowRoot.appendChild(label);
      var over = function (ev) {
        var r = self.overlay.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom ? r : null;
      };
      var move = function (ev) {
        label.style.transform = 'translate(' + (ev.clientX + 14) + 'px,' + (ev.clientY + 14) + 'px)';
        var r = over(ev);
        if (!r) { at = null; ghost.remove(); return; }
        at = landing(ev.clientX, ev.clientY, r, self.grid.cols, self.grid.rows, self.cellGap || 10, size);
        if (!ghost.parentNode) self.overlay.appendChild(ghost);
        self.position(ghost, { size: size, at: at });
        ghost.classList.toggle('bad', !add(self.grid, card, size, at));
      };
      var finish = function (ev) {
        row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', finish); row.removeEventListener('pointercancel', finish);
        ghost.remove(); label.remove();
        if (ev.type === 'pointercancel' || !at) return;
        if (add(self.grid, card, size, at)) self.addCard(card, size, at);
        else self.say('No room there for a ' + SIZE_NAMES[size] + ' ' + NAMES[card] + '. Move or remove a block, or pick a smaller size.');
      };
      move(e);
      row.addEventListener('pointermove', move); row.addEventListener('pointerup', finish); row.addEventListener('pointercancel', finish);
      return true;
    }
    fit() {
      if (!this.grid || !this.box) return;
      var note = this.stage.querySelector('.note'), noteStyle = note && getComputedStyle(note);
      var noteHeight = note ? note.getBoundingClientRect().height + (parseFloat(noteStyle.marginTop) || 0) + (parseFloat(noteStyle.marginBottom) || 0) : 0;
      var frame = this.grid.frame, availableHeight = Math.max(1, this.stage.clientHeight - noteHeight - 8);
      var scale = Math.min(1, (this.stage.clientWidth || 800) / frame[0], availableHeight / frame[1]);
      this.frame.style.width = frame[0] + 'px'; this.frame.style.height = frame[1] + 'px'; this.frame.style.transform = 'scale(' + scale + ')';
      this.box.style.width = frame[0] * scale + 'px'; this.box.style.height = frame[1] * scale + 'px';
      // Follow the real frame's layout (including top/bottom tab bar or side rail).
      var w = this.iframe.contentWindow, view;
      try { view = w && w.hkShell && w.hkShell.view(); } catch (e) { /* loading */ }
      view = this.previewView && this.previewView.isConnected ? this.previewView : view;
      if (view && view._gridScale && w.hkCards) {
        var radius = parseFloat(w.getComputedStyle(view).getPropertyValue('--hk-glass-radius')) || parseFloat(w.hkCards.T['glass-radius']);
        this.overlay.style.setProperty('--grid-radius', radius * view._gridScale + 'px');
      }
      var cell = view && view._config && view._config.grid && view.shadowRoot && view.shadowRoot.querySelector('.cell');
      if (cell) {
        var r = cell.getBoundingClientRect(), it = view._config.cards.find((x) => x.hk_cell && x.hk_cell.id === cell.dataset.id).hk_cell;
        var gap = 10 * (view._gridScale || 1); this.cellGap = gap; this.overlay.style.gap = gap + 'px';
        var z = SIZES[it.size], cw = (r.width - (z[0] - 1) * gap) / z[0], ch = (r.height - (z[1] - 1) * gap) / z[1];
        Object.assign(this.overlay.style, { left: r.left - it.at[0] * (cw + gap) + 'px', top: r.top - it.at[1] * (ch + gap) + 'px',
          width: (cw + gap) * this.grid.cols - gap + 'px', height: (ch + gap) * this.grid.rows - gap + 'px' });
      } else if (view && view._root && view._gridScale) {
        var bounds = view._root.getBoundingClientRect(), factor = view._gridScale;
        var pad = parseFloat(w.getComputedStyle(view._root).paddingTop) * factor, band = this.grid.band ? 70 * factor : 0;
        this.cellGap = 10 * factor; this.overlay.style.gap = this.cellGap + 'px';
        Object.assign(this.overlay.style, { left: bounds.left + pad + 'px', top: bounds.top + pad + band + 'px',
          width: bounds.width - 2 * pad + 'px', height: bounds.height - 2 * pad - band + 'px' });
      } else {
        var pad0 = frame[0] * 0.015 + 8, top = pad0 + (this.grid.band ? 70 : 0);
        Object.assign(this.overlay.style, { left: pad0 + 'px', top: top + 'px', width: frame[0] - 2 * pad0 + 'px', height: frame[1] - top - pad0 + 'px' });
      }
      this.overlay.querySelectorAll('.block').forEach((b) => { var it = this.grid.items.find((i) => i.id === b.dataset.id); if (it) this.position(b, it); });
    }
    addCard(card, size, at) {
      if (!this.grid) { this.say('Choose a starter layout, or Start Empty, first.'); return; }
      var next = add(this.grid, card, size, at);
      if (!next) { this.say('No space for that size. Remove or move a block first.'); return; }
      var added = next.items[next.items.length - 1];
      Object.assign(added, this.variantFor(card));
      this.selected = added.id; this.pickerCard = null; this.change(next);
    }
    async starter(concept) {
      if (this.busy) return;
      if (this.grid && !await this.K.confirm(this.shadowRoot, { title: 'Use a Starter Layout?', message: 'This replaces your draft. Nothing is saved yet.', ok: 'Use Starter' })) return;
      if (concept === 'empty') { this.selected = null; this.change(copy(EMPTY)); return; }
      var client = this.panel.client, states = client.states || {}, board = this.o.board;
      var ids = (domain) => Object.keys(states).filter((id) => id.indexOf(domain + '.') === 0).slice(0, 512);
      var rooms = (board.room_order || []).filter((id) => (client.areas || {})[id]);
      if (!rooms.length) rooms = Object.keys(client.areas || {});
      rooms = rooms.slice(0, 512);
      var tablet = Object.values(this.panel.data.tablets || {}).find((t) => t.screen === this.o.path && t.room);
      var menu = board.menu_custom ? board.menu : (this.panel.data.settings.menu || {}).menu;
      var result;
      try {
        this.busy = true;
        result = await client.callWS({ type: 'hk_frontend/grid/starter', options: {
          concept: concept, scenes: board.scenes && board.scenes.length ? board.scenes.filter((id) => id.indexOf('scene.') === 0) : ids('scene'), rooms: rooms,
          cameras: board.cameras && board.cameras.length ? board.cameras : ids('camera'), climate: ids('climate'),
          tablet_room: tablet ? tablet.room : null, tab_bar: menu === 'tabbar' || menu === 'auto' || !menu
        } });
      } catch (e) { this.say('Couldn’t load the starter. ' + (e.message || e)); return; }
      finally { this.busy = false; }
      this.selected = null; this.change(copy(result.grid));
    }
    // BOTH SIDES, drawn again: the palette and the settings (each keeps its scroll)
    side() {
      this.drawPalette();
      var key = this.selected + '|' + !!this.pickerTarget, keep = this._inspFor === key ? this.sidebar.scrollTop : 0;
      this._inspFor = key;
      this.sidebar.replaceChildren();
      var item = this.grid && this.grid.items.find((it) => it.id === this.selected);
      if (item) this.inspect(item); else this.screen();
      this.sidebar.scrollTop = keep;
    }

    // ------------------------------------------------------------ the palette
    sizeFor(card) {
      var sizes = this.sizesOf(card), want = this.paletteSizes[card];
      if (sizes.includes(want)) return want;
      return (this.grid && sizes.find((s) => firstSpace(this.grid, s))) || sizes[0];
    }
    // a card's sizes this grid can hold (choosing a card for a block: that block's size only)
    sizesOf(card) {
      var target = this.pickerTarget && this.grid && this.grid.items.find((it) => it.id === this.selected);
      if (target) return G.table()[card].sizes.filter((s) => s === target.size);
      return G.table()[card].sizes.filter((s) => !this.grid || (SIZES[s][0] <= this.grid.cols && SIZES[s][1] <= this.grid.rows));
    }
    drawPalette() {
      var h = this.h, K = this.K, self = this, P = this.palette, keep = P.scrollTop;
      if (this.catalogOff) { this.catalogOff(); this.catalogOff = null; }
      P.replaceChildren();
      var target = this.pickerTarget && this.grid && this.grid.items.find((it) => it.id === this.selected);
      var head = h('div', { class: 'pal-head' });
      if (target) head.appendChild(h('div', { class: 'pick-banner' }, [h('span', { text: this.pickerTarget === 'fallback' ? 'Choose the fallback card for this ' + SIZE_NAMES[target.size] + ' block.' : 'Choose a new card for this ' + SIZE_NAMES[target.size] + ' block.' }),
        h('button', { type: 'button', text: 'Cancel', onclick: () => this.pickFor(null) })]));
      var search = h('input', { class: 'catalog-search', type: 'search', placeholder: 'Search cards', 'aria-label': 'Search cards', value: this.pickerSearch || '' });
      head.appendChild(search);
      if (!target) head.appendChild(h('p', { text: this.grid ? 'Drag a card onto the grid, or click it to preview and add.' : 'Choose a starter layout or Start Empty on the right, then drag cards onto the grid.' }));
      P.appendChild(head);
      var list = h('div', { class: 'catalog-list' }); P.appendChild(list);
      var rows = function () {
        list.replaceChildren();
        var query = (search.value || '').trim().toLowerCase(), count = 0;
        GROUPS.forEach(function (g) {
          var keys = g[1].filter((k) => self.sizesOf(k).length && (NAMES[k] + ' ' + DESCRIPTIONS[k] + ' ' + g[0]).toLowerCase().includes(query));
          if (!keys.length) return;
          count += keys.length;
          var cells = [];
          keys.forEach((k) => { cells.push(self.paletteRow(k)); if (self.pickerCard === k) cells.push(self.paletteDetail(k)); });
          list.appendChild(K.group({ header: g[0] }, cells));
        });
        if (!count) list.appendChild(h('p', { class: 'note', text: 'No cards match your search.' }));
      };
      search.addEventListener('input', () => { self.pickerSearch = search.value; rows(); if (self.pickerCard) self.catalogPreviews(); });
      rows();
      P.scrollTop = keep;
      if (this.pickerCard) this.catalogPreviews();
    }
    paletteRow(k) {
      var h = this.h, self = this, size = this.sizeFor(k), open = this.pickerCard === k;
      var chips = h('div', { class: 'chips', role: 'group', 'aria-label': NAMES[k] + ' size' }, this.sizesOf(k).map((s) => {
        var full = !this.pickerTarget && this.grid && !firstSpace(this.grid, s);
        return h('button', { class: 'chip', type: 'button', 'data-size': s, 'data-full': String(!!full), 'aria-pressed': String(s === size),
          title: SIZE_NAMES[s] + ' · ' + SIZES[s][0] + ' × ' + SIZES[s][1] + (full ? ' · no free space' : ''), text: SIZE_SHORT[s] });
      }));
      var row = h('div', { class: 'cell pal-row', role: 'button', tabindex: '0', 'data-card': k, 'aria-expanded': String(open),
        'aria-label': NAMES[k] + ', ' + DESCRIPTIONS[k] + (this.pickerTarget ? '' : '. Drag onto the grid, or press Enter to preview.') },
        [h('hk-icon', { icon: GLYPHS[k] }), h('span', { class: 'pt' }, [h('b', { text: NAMES[k] }), h('small', { text: DESCRIPTIONS[k] }), chips])]);
      row.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        var x0 = e.clientX, y0 = e.clientY, dragging = false;
        try { row.setPointerCapture(e.pointerId); } catch (x) { /* a test page */ }
        var move = function (ev) {
          if (dragging || Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
          dragging = self.paletteDrag(ev, k, row);
          if (dragging) stop();
        };
        var stop = function () { row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', up); };
        var up = function (ev) {
          stop();
          if (dragging) return;
          var chip = ev.target.closest && ev.target.closest('.chip');
          if (chip) { self.paletteSizes[k] = chip.dataset.size; self.pickerCard = k; }
          else self.pickerCard = self.pickerCard === k ? null : k;
          self.drawPalette();
        };
        row.addEventListener('pointermove', move); row.addEventListener('pointerup', up);
      });
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); this.pickerCard = this.pickerCard === k ? null : k; this.drawPalette();
        var again = this.palette.querySelector('[data-card="' + k + '"]'); if (again) again.focus();
      });
      return row;
    }
    // THE CHOSEN CARD: its live preview at its size, and Add (or Use, for a block's card)
    paletteDetail(k) {
      var h = this.h, sz = this.sizeFor(k), space = this.pickerTarget || (this.grid && firstSpace(this.grid, sz));
      this.pickerSize = sz;
      var preview = h('div', { class: 'catalog-preview', 'data-preview-card': k, 'data-preview-size': sz, role: 'img',
        'aria-label': NAMES[k] + ' preview, ' + SIZE_NAMES[sz] });
      return h('div', { class: 'cell pal-detail' }, [preview,
        h('p', { class: 'note', text: 'Sample readings. On your screen it shows your home.' }),
        h('button', { class: 'catalog-add', type: 'button', disabled: !space,
          text: this.pickerTarget ? 'Use ' + NAMES[k] : space ? 'Add ' + SIZE_NAMES[sz] + ' ' + NAMES[k] : 'No room for this size',
          onclick: () => this.usePicked(k, sz) })]);
    }
    pickFor(target) {
      this.pickerTarget = target; this.pickerCard = null; this.pickerSearch = '';
      this.side();
      if (target) { var s = this.palette.querySelector('.catalog-search'); if (s) s.focus(); }
    }
    usePicked(key, size) {
      if (!this.pickerTarget) { this.addCard(key, size); return; }
      var item = this.grid.items.find((it) => it.id === this.selected), target = this.pickerTarget;
      this.pickerTarget = null; this.pickerCard = null;
      var variant = this.variantFor(key);
      this.update(item.id, target === 'fallback' ? { fallback: variant } : { card: key, opts: variant.opts, pages: variant.pages || null });
    }
    // A card as a block or a fallback starts with: sample options, and an
    // Accessory Group's automatic pages (its samples may not fit one page).
    variantFor(key) {
      var out = { card: key, opts: this.previewOptions(key) };
      if (key === 'accessories') out.pages = { source: 'accessories' };
      return out;
    }

    // ------------------------------------------------------------ the screen's settings
    screen() {
      var h = this.h, K = this.K, add = (n) => this.sidebar.appendChild(n);
      var starters = () => K.group({ header: this.grid ? null : 'Start With', footer: this.grid ? 'Replaces this draft. Nothing is saved until you Save.' : 'Fills the grid from your home’s scenes, rooms, cameras and thermostats. Nothing is saved until you Save.' },
        [['A', 'Tap Weight'], ['C', 'Glance Up, Touch Down'], ['empty', 'Start Empty']].map((c) => K.button({ label: c[1], onClick: () => this.starter(c[0]) })));
      add(h('div', { class: 'insp-head' }, [h('hk-icon', { icon: 'mdi:tablet' }), h('div', {}, [h('h2', { text: 'Screen' }),
        h('p', { text: this.grid ? this.grid.items.length + (this.grid.items.length === 1 ? ' block' : ' blocks') + ' · select one to change it' : 'No layout yet' })])]));
      if (!this.grid) { add(starters()); return; }
      var config = (key, value) => { var next = copy(this.grid); next[key] = value; if (valid(next)) this.change(next); else { this.say('Move or remove the blocks that would be outside the new grid first.'); this.side(); } };
      add(K.group({ header: 'Grid', footer: 'The grid scales to fit each screen. Its blocks keep their shape.' }, [
        K.seg({ label: 'Columns', value: this.grid.cols, options: [6, 3, 2].map((n) => [n, String(n)]), onChange: (n) => config('cols', Number(n)) }),
        K.select({ label: 'Rows', value: this.grid.rows, options: [2, 3, 4, 5, 6].map((n) => [n, String(n)]), onChange: (n) => config('rows', Number(n)) }),
        K.select({ label: 'Grid Scale', value: this.grid.scale || 100, options: [100, 90, 80, 70, 60, 50].map((n) => [n, n === 100 ? 'Automatic Fit' : n + '% of Fit']), onChange: (n) => config('scale', Number(n)) })]));
      add(K.group({ header: 'Header' }, [
        K.toggle({ label: 'Top Band', sub: 'The clock, weather and status chips', on: this.grid.band, onChange: (v) => config('band', v) }),
        K.toggle({ label: 'Clock', on: this.grid.header_clock !== false, disabled: !this.grid.band, onChange: (v) => config('header_clock', v) }),
        K.toggle({ label: 'Weather', on: this.grid.header_weather !== false, disabled: !this.grid.band, onChange: (v) => config('header_weather', v) })]));
      var more = h('details', { class: 'screen-settings' }, [h('summary', { text: 'Preview Size and Starters' })]);
      more.open = !!this.screenSettingsOpen;
      more.addEventListener('toggle', () => { this.screenSettingsOpen = more.open; });
      more.appendChild(K.group({ header: 'Preview Size', footer: 'The size this editor previews the screen at. The tablet itself always fits the grid to its own screen.' }, [
        K.text({ label: 'Width', value: this.grid.frame[0], type: 'number', unit: 'px', onCommit: (v) => config('frame', [Number(v), this.grid.frame[1]]) }),
        K.text({ label: 'Height', value: this.grid.frame[1], type: 'number', unit: 'px', onCommit: (v) => config('frame', [this.grid.frame[0], Number(v)]) })]));
      more.appendChild(starters());
      add(more);
      if (this.panel.host() && this.panel.host().gridHistory) {
        add(K.group({ header: 'Layout History' }, [K.button({ label: this.histories ? 'Refresh History' : 'Show Earlier Layouts', onClick: () => this.history() })]));
        if (this.histories) {
          var historyRows = this.histories.map((row) => K.button({ label: 'Version ' + row.version + ' · ' + new Date(row.created * 1000).toLocaleString() + ' · ' + (row.actor_name || row.actor || row.source || 'Unknown'), onClick: () => this.restore(row) }));
          add(K.group({ header: 'Earlier Layouts', footer: historyRows.length ? 'A version becomes your draft. Save to restore its layout only.' : 'No earlier layouts.' }, historyRows));
        }
        var targets = this.panel.data.dashboards.filter((d) => d.item && d.generated && d.path !== this.o.path && this.panel.data.boards[d.path]);
        if (targets.length) add(K.group({ header: 'Copy Layout To…' }, [K.select({ label: 'Screen', value: '', options: [['', 'Choose Screen']].concat(targets.map((d) => [d.path, d.title])), onChange: (path) => this.copyTo(path) })]));
      }
    }

    // ------------------------------------------------------------ a block's settings
    inspect(item) {
      var h = this.h, K = this.K, add = (n) => this.sidebar.appendChild(n);
      add(h('div', { class: 'insp-head' }, [h('hk-icon', { icon: GLYPHS[item.card] }), h('div', {}, [h('h2', { text: NAMES[item.card] }),
        h('p', { text: SIZE_NAMES[item.size] + ' · column ' + (item.at[0] + 1) + ', row ' + (item.at[1] + 1) })]),
        h('button', { class: 'done', type: 'button', text: 'Done', onclick: () => this.select(null) })]));
      var sizes = G.table()[item.card].sizes.filter((sz) => SIZES[sz][0] <= this.grid.cols && SIZES[sz][1] <= this.grid.rows);
      var rows = [];
      if (sizes.length > 1) rows.push(K.seg({ label: 'Size', value: item.size, options: sizes.map((sz) => [sz, SIZE_SHORT[sz]]), onChange: (sz) => this.resize(item, sz) }));
      rows.push(K.button({ label: 'Change Card…', onClick: () => this.pickFor('primary') }));
      add(K.group({}, rows));
      this.content(item);
      this.conditions(item);
      add(K.group({}, [K.button({ label: 'Remove Block', destructive: true, onClick: () => this.remove(item.id) })]));
    }
    resize(item, sz) {
      if (item.card === 'accessories' && item.pages && item.pages.source === 'list' && item.pages.list.some((pg) => ((pg.opts || {}).accessories || []).length > G.PER_PAGE[sz])) {
        this.say('A ' + SIZE_NAMES[sz] + ' page holds ' + G.PER_PAGE[sz] + ' accessories. Move some to another page, or choose Automatic Pages, first.'); this.side(); return;
      }
      if (item.fallback && !G.table()[item.fallback.card].sizes.includes(sz)) {
        this.say('Its fallback card, ' + NAMES[item.fallback.card] + ', doesn’t come in ' + SIZE_NAMES[sz] + '. Choose another fallback first.'); this.side(); return;
      }
      var next = place(this.grid, item.id, item.at, sz);
      if (next) this.change(next); else { this.say('A ' + SIZE_NAMES[sz] + ' block doesn’t fit here. Make room around it first.'); this.side(); }
    }
    // WHAT THE BLOCK SHOWS: one thing or pages that swipe, then the options that apply
    content(item) {
      var K = this.K, cat = G.table()[item.card], add = (n) => this.sidebar.appendChild(n);
      var src = item.pages && item.pages.source || '', words = SHOW[item.card] || [], rows = [], footer = null;
      var show = item.card === 'accessories' ? [['accessories', words[1]], ['list', 'Choose Each Page']]
        : [['', words[0] || 'One Page']].concat(cat.sources.map((s) => [s, words[1] || 'Swipe All']), [['list', 'Choose Each Page']]);
      rows.push(K.select({ label: 'Show', value: src, options: show, onChange: (s) => this.setShow(item, s) }));
      var hide = {};
      if (SOURCE_HIDES[src]) hide[SOURCE_HIDES[src]] = 1;
      if (item.card === 'room' && src === 'rooms') rows.push(this.startingRoom(item));
      if (src === 'thermostats') rows.push(K.toggle({ label: 'Start on Tablet’s Room', on: item.pages.start === 'tablet_room', onChange: (on) => {
        var p = copy(item.pages); if (on) p.start = 'tablet_room'; else delete p.start; this.update(item.id, { pages: p });
      } }));
      rows = rows.concat(this.fields(item.card, item.opts || {}, (opts) => this.update(item.id, { opts: opts }), { hide: hide, size: item.size, list: src === 'list' }));
      if (item.card === 'room') footer = this.roomNote(item, src);
      else if (src === 'list') footer = 'Each page repeats this card with its own choices. A choice left on Same as the Block uses the block’s.';
      else if (item.card === 'accessories') footer = 'Each page holds ' + G.PER_PAGE[item.size] + ' at this size; more make more pages.';
      else if (src) footer = 'Swipe sideways on the block to change pages. It goes back to its first page when the screen goes idle.';
      add(K.group({ header: 'Content', footer: footer }, rows));
      if (src === 'list') this.pages(item);
      if (cat.opts && cat.opts.surface) {
        var look = []; this.surfaceFields((item.opts || {}).surface, (value) => { var o = copy(item.opts || {}); if (value) o.surface = value; else delete o.surface; this.update(item.id, { opts: o }); }, look);
        add(K.group({ header: 'Appearance', footer: 'Only the group’s own background changes. Its tiles keep the screen’s look.' }, look));
      }
    }
    setShow(item, s) {
      if (item.card === 'accessories') {
        var opts = copy(item.opts || {}), per = G.PER_PAGE[item.size], entries = opts.accessories || [];
        if (s === 'list') {
          var list = [];
          for (var i = 0; i < entries.length; i += per) list.push({ opts: { accessories: entries.slice(i, i + per) } });
          delete opts.accessories;
          this.update(item.id, { opts: opts, pages: { source: 'list', list: list.length ? list : [{ opts: {} }] } });
        } else {
          if (item.pages && item.pages.source === 'list') entries = item.pages.list.flatMap((pg) => (pg.opts || {}).accessories || []);
          var seen = new Set(); entries = entries.filter((e) => !seen.has(e.entity) && seen.add(e.entity));
          if (entries.length > 24) { this.say('Automatic pages hold up to 24 accessories. Remove some first.'); this.side(); return; }
          if (entries.length) opts.accessories = entries;
          this.update(item.id, { opts: opts, pages: { source: 'accessories' } });
        }
        return;
      }
      this.update(item.id, { pages: s ? s === 'list' ? { source: 'list', list: [{ opts: {} }, { opts: {} }] } : { source: s } : null });
    }
    startingRoom(item) {
      var area = (item.opts || {}).area || (item.pages.start === 'tablet_room' ? 'tablet_room' : '');
      var roomIds = this.previewView && this.previewView._config.grid_ctx && this.previewView._config.grid_ctx.rooms;
      var choices = [['', 'First Room']].concat(this.choices('area').filter((op) => op[0] === 'tablet_room' || !roomIds || roomIds.includes(op[0])));
      if (area && !choices.some((op) => op[0] === area)) choices.push([area, area + ' (Not on this screen)']);
      return this.K.select({ label: 'Starting Room', value: area, options: choices, onChange: (value) => {
        var opts = copy(item.opts || {}), pages = copy(item.pages);
        if (value) opts.area = value; else delete opts.area;
        if (value === 'tablet_room') pages.start = 'tablet_room'; else delete pages.start;
        this.update(item.id, { opts: opts, pages: pages });
      } });
    }
    roomNote(item, src) {
      var area = (item.opts || {}).area || (item.pages && item.pages.start === 'tablet_room' ? 'tablet_room' : '');
      var roomIds = this.previewView && this.previewView._config.grid_ctx && this.previewView._config.grid_ctx.rooms;
      var name = area && area !== 'tablet_room' ? ((this.panel.client.areas || {})[area] || {}).name || area : '';
      if (src === 'rooms') {
        if (area && area !== 'tablet_room' && roomIds && !roomIds.includes(area)) return 'That room isn’t on this screen, so it opens on the first room.';
        return (area === 'tablet_room' ? 'Opens on the wall tablet’s room (a desktop shows the first).' : name ? 'Opens on ' + name + '.' : 'Opens on the screen’s first room.') +
          ' Swipe for the others; it comes back when the screen goes idle.';
      }
      if (src !== 'list' && (area === 'tablet_room' || !area)) return 'The wall tablet’s own room. A desktop shows the first room.';
      return null;
    }
    // CHOOSE EACH PAGE: each page's own choices, then move or remove it, and Add Page
    pages(item) {
      var K = this.K, add = (n) => this.sidebar.appendChild(n), n = item.pages.list.length;
      item.pages.list.forEach((pg, i) => {
        var rows = this.fields(item.card, pg.opts || {}, (opts) => { var p = copy(item.pages); p.list[i].opts = opts; this.update(item.id, { pages: p }); },
          { page: true, size: item.size, base: item.opts || {}, hide: { surface: 1 } });
        rows.push(K.button({ label: 'Move Up', disabled: i === 0, onClick: () => { var p = copy(item.pages); p.list.splice(i - 1, 0, p.list.splice(i, 1)[0]); this.update(item.id, { pages: p }); } }));
        rows.push(K.button({ label: 'Remove Page', destructive: true, disabled: n === 1, onClick: () => { var p = copy(item.pages); p.list.splice(i, 1); this.update(item.id, { pages: p }); } }));
        add(K.group({ header: 'Page ' + (i + 1) + ' of ' + n }, rows));
      });
      add(K.group({}, [K.button({ label: 'Add Page', disabled: n >= G.PAGES_MAX, onClick: () => { var p = copy(item.pages); p.list.push({ opts: {} }); this.update(item.id, { pages: p }); } })]));
    }
    conditions(item) {
      var K = this.K, kind = item.when && item.when.kind || '', add = (n) => this.sidebar.appendChild(n);
      var names = { music_playing: 'Music Is Playing', timer_running: 'A Timer Is Running', alarm_armed: 'The Alarm Is Armed',
        doorbell: 'Someone Is at the Door', after_sunset: 'After Sunset', entity_state: 'An Accessory’s State' };
      var rows = [K.select({ label: 'Show When', value: kind, options: [['', 'Always']].concat(G.CONDITIONS.map((k) => [k, names[k]])), onChange: (value) => {
        this.conditionPreview = null;
        if (!value) { this.update(item.id, { when: null, fallback: null }); return; }
        var when = { kind: value };
        if (value === 'entity_state') {
          var choice = this.choices('entity')[0];
          if (!choice) { this.say('Add an entity before using an entity condition.'); this.side(); return; }
          when.entity = choice[0]; when.state = 'on';
        }
        var fallback = item.fallback || this.variantFor(Object.keys(G.table()).find((k) => k !== item.card && G.table()[k].sizes.includes(item.size)) || item.card);
        this.update(item.id, { when: when, fallback: fallback });
      } })];
      if (kind) {
        var when = item.when;
        var put = (key, value) => { var out = copy(when); if (value) out[key] = value; else delete out[key]; this.update(item.id, { when: out }); };
        if (kind !== 'after_sunset') rows.push(K.select({ label: 'Watch', value: when.entity || '',
          options: (kind === 'entity_state' ? [] : [['', 'Automatic']]).concat(this.choices({ music_playing: 'speaker', timer_running: 'timer', alarm_armed: 'alarm', doorbell: 'doorbell' }[kind] || 'entity').filter((op) => op[0] !== 'tablet_room')),
          onChange: (value) => put('entity', value) }));
        if (kind === 'entity_state') rows.push(K.text({ label: 'Is', value: when.state, maxlength: 80, onCommit: (value) => put('state', value) }));
        rows.push(K.button({ label: 'Otherwise Show: ' + NAMES[item.fallback.card] + '…', onClick: () => this.pickFor('fallback') }));
        rows.push(K.seg({ label: 'Preview', value: this.conditionPreview == null ? 'live' : this.conditionPreview ? 'on' : 'off',
          options: [['live', 'Live'], ['on', NAMES[item.card]], ['off', NAMES[item.fallback.card]]], onChange: (v) => { this.conditionPreview = v === 'live' ? null : v === 'on'; this.preview(); this.side(); } }));
      }
      add(K.group({ header: 'Show When', footer: kind ? 'Otherwise its fallback fills exactly this space, so nothing moves.' : null }, rows));
      if (kind) {
        var fb = item.fallback, fcat = G.table()[fb.card];
        var frows = this.fields(fb.card, fb.opts || {}, (opts) => this.update(item.id, { fallback: Object.assign({}, fb, { opts: opts }) }), { size: item.size, hide: { surface: 1 } });
        if (fcat.sources.length) frows.unshift(K.select({ label: 'Show', value: fb.pages && fb.pages.source || '',
          options: [['', (SHOW[fb.card] || [])[0] || 'One Page']].concat(fcat.sources.map((s) => [s, (SHOW[fb.card] || [])[1] || 'Swipe All'])),
          onChange: (s) => { var next = copy(fb); if (s) next.pages = { source: s }; else delete next.pages; this.update(item.id, { fallback: next }); } }));
        if (frows.length) add(K.group({ header: NAMES[fb.card] + ' (Fallback)' }, frows));
      }
    }
    previewOptions(key) {
      var fields = G.table()[key].opts || {}, opts = {}, self = this;
      Object.keys(fields).forEach(function (name) {
        var kind = fields[name];
        if (['secondary', 'title', 'room_display'].includes(kind)) return;
        if (kind === 'accessories') { opts[name] = self.choices('entity').filter((op) => /^(light|switch|fan|sensor)\./.test(op[0])).slice(0, 4).map((op) => ({ entity: op[0] })); if (!opts[name].length) delete opts[name]; return; }
        var choices = self.choices(kind).filter((op) => op[0] !== 'tablet_room');
        if (kind === 'scene' && key === 'scene') choices = choices.filter((op) => op[0].indexOf('scene.') === 0);
        if (kind === 'entity') choices = choices.filter((op) => /^(light|switch|fan)\./.test(op[0]));
        if (kind === 'speaker') choices.sort((a, b) => (self.panel.client.states[b[0]]?.state === 'playing') - (self.panel.client.states[a[0]]?.state === 'playing'));
        if (kind === 'scenes' || kind === 'calendars') { if (choices.length) opts[name] = choices.slice(0, kind === 'scenes' ? 6 : 2).map((op) => op[0]); return; }
        if (choices.length && !['windows', 'surface', 'boolean'].includes(kind)) opts[name] = choices[0][0];
      });
      return opts;
    }
    catalogClient(client) {
      // This copy belongs only to the inert gallery iframe. It is never saved
      // or published through the host, and it has no command action port.
      var states = {}, now = Date.now(), stamp = new Date(now).toISOString();
      Object.keys(client.states).forEach(function (id) {
        var st = client.states[id], a = Object.assign({}, st.attributes), state = st.state;
        if (id.startsWith('climate.')) { state = 'heat_cool'; Object.assign(a, { current_temperature: 71, target_temp_low: 68, target_temp_high: 74, hvac_action: 'idle' }); }
        if (id.startsWith('media_player.')) { state = 'playing'; Object.assign(a, { media_title: 'A Favourite Song', media_artist: 'Sample Artist', media_album_name: 'Sample Album', media_duration: 240, media_position: 82, media_position_updated_at: stamp, volume_level: .4 }); }
        if (id.startsWith('weather.')) { state = 'partlycloudy'; Object.assign(a, { temperature: 72, apparent_temperature: 74, humidity: 52, wind_speed: 8, wind_speed_unit: 'mph' }); }
        if (id.startsWith('light.')) { state = 'on'; a.brightness = 180; }
        if (id.startsWith('person.')) state = 'home';
        if (id.startsWith('vacuum.')) { state = 'cleaning'; a.battery_level = 78; }
        if (id.startsWith('alarm_control_panel.')) state = 'armed_home';
        states[id] = Object.assign({}, st, { state: state, attributes: a, last_updated: stamp });
      });
      var forecast = (kind) => Array.from({ length: kind === 'daily' ? 5 : 12 }, (_, i) => ({
        datetime: new Date(now + i * (kind === 'daily' ? 86400e3 : 3600e3)).toISOString(),
        temperature: 72 + i % 4, templow: 55 + i, condition: i % 3 === 2 ? 'rainy' : 'partlycloudy', precipitation_probability: i % 3 === 2 ? 60 : 10
      }));
      Object.keys(states).forEach((id) => { if (states[id].attributes.forecast) states[id].attributes.forecast = forecast(/daily/.test(id) ? 'daily' : 'hourly'); });
      var finish = new Date(now + 240e3).toISOString();
      states['timer.grid_preview'] = { state: 'active', last_updated: stamp, attributes: { friendly_name: 'Tea', duration: '00:05:00', finishes_at: finish } };
      states['sensor.running_quick_timers'] = { state: '1', last_updated: stamp, attributes: { running: [{ entity_id: 'timer.grid_preview', name: 'Tea', finishes_at: finish }] } };
      var subs = Object.assign({}, client.subscriptions, { subscribeMessage: (callback, msg) => {
        if (msg.type === 'weather/subscribe_forecast') { var timer = setTimeout(() => callback({ forecast: forecast(msg.forecast_type) }), 0); return Promise.resolve(() => clearTimeout(timer)); }
        return client.subscriptions.subscribeMessage(callback, msg);
      } });
      var read = (method, path) => method.toUpperCase() === 'GET' && path.startsWith('calendars/')
        ? Promise.resolve([{ summary: 'Family Dinner', start: { dateTime: new Date(now + 3600e3).toISOString() }, end: { dateTime: new Date(now + 7200e3).toISOString() } },
          { summary: 'Weekend Plans', start: { dateTime: new Date(now + 86400e3).toISOString() }, end: { dateTime: new Date(now + 90000e3).toISOString() } }])
        : client.callApi(method, path);
      return Object.assign({}, client, { states: states, subscriptions: subs, callApi: read });
    }
    catalogPreviews() {
      var w = this.iframe.contentWindow;
      if (!w || !w.hkCards || !this.previewView) return;
      if (this.catalogOff) this.catalogOff();
      var box = this.palette.querySelector('[data-preview-card]'); if (!box) return;
      var sz = box.dataset.previewSize, z = SIZES[sz], ctx = this.previewView._config.grid_ctx || {};
      var unit = w.hkCards.TILE, gap = w.hkCards.HOME_GRID.gap;
      var width = unit.w * z[0] + gap * (z[0] - 1), height = unit.tall * z[1] + gap * (z[1] - 1);
      var scale = Math.min(1, (box.clientWidth || 220) / width);
      box.style.height = height * scale + 'px';
      // Keep every descendant in the screen's custom-element registry. Adopting
      // a card into Settings leaves its hk-plate and glyph elements undefined.
      var frame = this.h('iframe', { title: NAMES[box.dataset.previewCard] + ' preview', tabindex: '-1', 'aria-hidden': 'true' });
      Object.assign(frame.style, { width: width + 'px', height: height + 'px', left: '50%', marginLeft: -(width * scale / 2) + 'px', transformOrigin: 'top left', transform: 'scale(' + scale + ')' });
      frame.inert = true; frame.src = this.iframe.src; box.replaceChildren(frame);
      var active = true, timer, retries = 0;
      this.catalogOff = () => { active = false; clearTimeout(timer); };
      var load = () => {
        if (!active) return;
        var fw = frame.contentWindow;
        if (!fw || !fw.hkShell || !fw.hkShell.view() || !fw.hkCards || !fw.hkCards.client()) {
          if (retries++ < 100) timer = setTimeout(load, 100);
          return;
        }
        var doc = fw.document, cell = doc.createElement('div'); cell.className = 'cell'; cell.setAttribute('size', sz);
        Object.assign(cell.style, { width: width + 'px', height: height + 'px', position: 'fixed', inset: '0', containerType: 'size', containerName: 'hk-cell' });
        cell.style.setProperty('--hk-cell-w', (width + 10) / z[0] - 10 + 'px'); cell.style.setProperty('--hk-cell-h', (height + 10) / z[1] - 10 + 'px');
        var view = doc.createElement('hk-home-grid-view');
        Object.assign(view.style, { display: 'block', width: width + 'px', height: height + 'px', position: 'fixed', inset: '0' });
        var it = { id: 'preview', card: box.dataset.previewCard, size: sz, at: [0, 0], opts: this.previewOptions(box.dataset.previewCard) };
        var sample = fw.hkCards.previewClient(this.catalogClient(fw.hkCards.client()));
        var card = fw.hkCards.createCard(fw.hkGridCatalog.config(it, ctx), sample);
        card.setAttribute('size', sz); card.inert = true;
        Object.assign(card.style, { display: 'block', width: '100%', height: '100%' });
        cell.appendChild(card); view.appendChild(cell); doc.body.replaceChildren(view);
        fw.galleryCard = card;
        // Sample readings are fixed for this illustration. Subscribing the
        // sample back to the frame's live client hub would feed it into itself.
      };
      frame.addEventListener('load', load, { once: true });
    }
    async history() {
      if (this.busy) return;
      try {
        var data = await this.panel.host().gridHistory(this.o.path, this.panel);
        this.histories = data.history.filter((row) => row.body && row.body.home_grid);
        this.side();
      } catch (e) { this.say('Couldn’t read history. ' + (e.message || e)); }
    }
    async restore(row) {
      if (this.busy) return;
      if (!await this.K.confirm(this.shadowRoot, { title: 'Restore This Layout?', message: 'Version ' + row.version + ' becomes your draft. Review it, then Save to apply it. Other screen settings stay as they are.', ok: 'Restore Draft' })) return;
      this.selected = null; this.change(copy(row.body.home_grid));
      this.say('Version ' + row.version + ' restored to the draft. Save to apply it.');
    }
    async copyTo(path) {
      if (this.busy || !path || !valid(this.grid)) return;
      if (!await this.K.confirm(this.shadowRoot, { title: 'Copy Layout To This Screen?', message: 'This saves your draft layout to ' + path + '. Its other settings stay as they are. Tablet’s Room still means the tablet showing that screen.', ok: 'Copy Layout' })) return;
      this.busy = true;
      try {
        var grid = copy(this.grid);
        var result = await this.panel.actions().callWS({ type: 'hk_frontend/board/set', dashboard: path,
          changes: { home_style: 'grid', home_grid: grid } });
        this.panel.data.boards[path] = result && result.board || Object.assign({}, this.panel.data.boards[path], { home_style: 'grid', home_grid: grid });
        this.say('Layout copied.');
      } catch (e) { this.say('Couldn’t copy the layout. ' + (e.message || e)); }
      finally { this.busy = false; }
    }
    update(id, patch) {
      var next = copy(this.grid), it = next.items.find((x) => x.id === id);
      Object.keys(patch).forEach((key) => { if (patch[key] === null) delete it[key]; else it[key] = patch[key]; }); this.change(next);
    }
    // A CARD'S OPTIONS AS ROWS. o: { page (a Choose Each Page page: an
    // option left empty uses the block's), base (the block's own options,
    // for a page), hide {name: 1}, size, list (the block has custom pages) }
    fields(card, opts, save, o) {
      var K = this.K, self = this, kinds = G.table()[card].opts || {}, rows = [], hide = o.hide || {};
      var set = (key, value) => { var out = copy(opts); if (value === '' || value == null) delete out[key]; else out[key] = value; save(out); };
      Object.keys(kinds).forEach(function (key) {
        if (hide[key]) return;
        var kind = kinds[key], label = KIND_LABELS[kind] || NAME_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
        if (kind === 'surface') return;                                         // Appearance, its own group
        if (card === 'room' && key === 'area' && o.list && !o.page) label = 'Default Room';
        if (kind === 'room_display') {
          if (o.page) return;
          rows.push(K.seg({ label: 'Accessories', value: opts[key] || 'summary', options: [['summary', 'Summary'], ['scroll', 'Scroll All']], onChange: (v) => set(key, v === 'summary' ? null : v) }));
          return;
        }
        if (kind === 'title') { rows.push(K.text({ label: o.page ? 'Page Name' : 'Group Name', value: opts[key] || '', maxlength: 60, placeholder: o.page ? '' : 'Accessories', onCommit: (v) => set(key, v.trim() || null) })); return; }
        if (kind === 'secondary') { self.secondaryFields(opts[key], opts.entity || (o.base || {}).entity, (v) => set(key, v), rows); return; }
        if (kind === 'accessories') {
          if (o.list && !o.page) return;
          self.accessoryFields(opts[key] || [], (v) => set(key, v), rows, o.page ? G.PER_PAGE[o.size] : 24); return;
        }
        if (kind === 'boolean') { rows.push(K.toggle({ label: label, on: opts[key] === true, onChange: (on) => set(key, on || null) })); return; }
        if (kind === 'windows') { self.windows(opts, set, rows); return; }
        var choices = self.choices(kind);
        if (card === 'scene' && kind === 'scene') choices = choices.filter((op) => op[0].indexOf('scene.') === 0);
        if (kind === 'scenes' || kind === 'calendars') {
          choices.forEach((op) => rows.push(K.check({ label: op[1], multi: true, on: (opts[key] || []).indexOf(op[0]) >= 0, onClick: (on) => {
            var list = (opts[key] || []).filter((v) => v !== op[0]); if (on) list.push(op[0]);
            if (list.length > 24) { self.say('At most 24 in a list.'); return; } set(key, list.length ? list : null);
          } })));
          return;
        }
        var auto = o.page ? 'Same as the Block' : card === 'camera' ? 'First Camera' : card === 'room' ? 'Tablet’s Room' : 'Automatic';
        var all = card === 'room' && key === 'area' && !o.page ? choices : [['', auto]].concat(choices);
        if (opts[key] && !all.some((op) => op[0] === opts[key])) all.push([opts[key], opts[key] + ' (Unavailable)']);
        rows.push(K.select({ label: label, value: opts[key] || (card === 'room' && key === 'area' && !o.page ? 'tablet_room' : ''), options: all, onChange: (v) => set(key, v) }));
      });
      return rows;
    }
    secondaryFields(value, entity, save, rows) {
      var K = this.K, mode = value && value.mode || 'auto';
      var a = (this.panel.client.states[entity] || {}).attributes || {};
      var keys = Object.keys(a).filter((k) => a[k] == null || ['string', 'number', 'boolean'].includes(typeof a[k])).sort();
      var options = keys.map((k) => [k, k.replace(/_/g, ' ')]);
      rows.push(K.select({ label: 'Line Under Name', value: mode, options: [['auto', 'Automatic'], ['state', 'State'], ['brightness', 'Brightness'], ['attribute', 'An Attribute'], ['none', 'Hidden']],
        onChange: (m) => save(m === 'auto' ? null : m === 'attribute' ? { mode: m, attribute: keys.includes('battery_level') ? 'battery_level' : keys[0] || 'friendly_name' } : { mode: m }) }));
      if (mode !== 'attribute') return;
      var key = value.attribute;
      if (!keys.includes(key)) options.push([key, key + ' (Not Reported)']);
      rows.push(K.select({ label: 'Attribute', value: key, options: options, onChange: (v) => save(Object.assign({}, value, { attribute: v })) }));
      rows.push(K.text({ label: 'Unit', value: value.unit || '', placeholder: 'Optional', maxlength: 20, onCommit: (v) => save(Object.assign({}, value, { unit: v })) }));
    }
    accessoryFields(entries, save, rows, max) {
      var K = this.K, self = this, choices = this.choices('entity');
      var put = (i, patch) => { var next = copy(entries); next[i] = Object.assign({}, next[i], patch); if (patch.secondary === null) delete next[i].secondary; save(next); };
      entries.forEach(function (entry, i) {
        var options = choices.filter((op) => op[0] === entry.entity || !entries.some((e) => e.entity === op[0]));
        if (!options.some((op) => op[0] === entry.entity)) options.push([entry.entity, entry.entity + ' (Unavailable)']);
        rows.push(K.select({ label: 'Accessory ' + (i + 1), value: entry.entity, options: options, onChange: (id) => put(i, { entity: id, secondary: null }) }));
        self.secondaryFields(entry.secondary, entry.entity, (v) => put(i, { secondary: v }), rows);
        rows.push(K.button({ label: 'Move Accessory ' + (i + 1) + ' Up', disabled: i === 0, onClick: () => { var next = copy(entries); next.splice(i - 1, 0, next.splice(i, 1)[0]); save(next); } }));
        rows.push(K.button({ label: 'Remove Accessory ' + (i + 1), destructive: true, onClick: () => { var next = copy(entries); next.splice(i, 1); save(next.length ? next : null); } }));
      });
      if (entries.length >= max) { rows.push(K.info({ label: max + ' accessories: this page is full. Add another page for more.' })); return; }
      rows.push(K.select({ label: 'Add Accessory', value: '', options: [['', 'Choose…']].concat(choices.filter((op) => !entries.some((e) => e.entity === op[0]))),
        onChange: (id) => { if (id) save(entries.concat([{ entity: id }])); } }));
    }
    surfaceFields(surface, save, rows) {
      var K = this.K;
      rows.push(K.toggle({ label: 'Custom Group Background', on: !!surface, onChange: (on) => save(on ? { color: '#808080', opacity: 30, blur: 'screen' } : null) }));
      if (!surface) return;
      var put = (key, value) => save(Object.assign({}, surface, { [key]: value }));
      rows.push(K.text({ label: 'Background Color', type: 'color', value: surface.color, onCommit: (v) => put('color', v) }));
      rows.push(K.slider({ label: 'Background Opacity', value: surface.opacity, min: 0, max: 100, unit: '%', onChange: (v) => put('opacity', Number(v)) }));
      rows.push(K.select({ label: 'Background Blur', value: surface.blur, options: [['screen', 'Follow Screen'], ['none', 'None'], ['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']], onChange: (v) => put('blur', v) }));
    }
    choices(kind) {
      var client = this.panel.client, states = client.states || {};
      if (kind === 'area') return [['tablet_room', 'Tablet’s Room']].concat(Object.keys(client.areas || {}).map((id) => [id, client.areas[id].name || id]));
      var domains = { scene: ['scene', 'script'], scenes: ['scene'], speaker: ['media_player'], climate: ['climate'], camera: ['camera'],
        timer: ['timer'], alarm: ['alarm_control_panel'], doorbell: ['binary_sensor', 'camera'], weather: ['weather'], vacuum: ['vacuum'], calendars: ['calendar'], action: ['scene', 'script'] }[kind];
      var list = Object.keys(states).filter((id) => !domains || domains.indexOf(id.split('.')[0]) >= 0).map((id) => [id, (states[id].attributes || {}).friendly_name || id]);
      list.sort((a, b) => a[1].localeCompare(b[1]));
      if (kind === 'speaker' || kind === 'climate') list.unshift(['tablet_room', 'Tablet’s Room']);
      if (kind === 'action') list = [['lock_up', 'Lock Up'], ['lights_off', 'All Lights Off'], ['garage', 'Garage']].concat(list);
      return list;
    }
    windows(opts, set, rows) {
      var K = this.K, windows = opts.windows || [], self = this;
      windows.forEach(function (w, i) {
        var put = (key, value) => { var next = copy(windows); if (value) next[i][key] = value; else delete next[i][key]; set('windows', next); };
        rows.push(K.text({ label: 'Window ' + (i + 1), value: w.label || '', placeholder: 'Name', maxlength: 24, onCommit: (v) => put('label', v) }));
        ['start', 'end'].forEach((key) => rows.push(K.text({ label: key === 'start' ? 'From' : 'Until', type: 'time', value: w[key], onCommit: (v) => put(key, v) })));
        rows.push(K.select({ label: 'Scene or Script', value: w.scene, options: self.choices('scene'), onChange: (v) => put('scene', v) }));
        rows.push(K.button({ label: 'Remove Window ' + (i + 1), destructive: true, onClick: () => { var next = copy(windows); next.splice(i, 1); set('windows', next.length ? next : null); } }));
      });
      if (!windows.length) rows.push(K.info({ label: 'Morning, Day, Evening and Night', sub: 'Each finds its scene by name. Add a window to choose your own.' }));
      rows.push(K.button({ label: 'Add Time Window', disabled: windows.length >= 8 || !this.choices('scene').length, onClick: () => {
        set('windows', windows.concat([{ start: '05:00', end: '10:00', scene: this.choices('scene')[0][0] }]));
      } }));
    }
    async preview() {
      clearTimeout(this.previewTimer);
      if (!this.grid || !this.isConnected) return;
      var w = this.iframe.contentWindow;
      try {
        if (!w.hkStrategy || !w.hkCards || !w.hkShell || !w.hkShell.view()) throw new Error('loading');
        var serial = this.previewSerial = (this.previewSerial || 0) + 1;
        var client = w.hkCards.client(), draft = copy(this.grid);
        var selected = draft.items.find((it) => it.id === this.selected);
        if (selected && selected.when && typeof this.conditionPreview === 'boolean') selected._conditionPreview = this.conditionPreview;
        var config = await w.hkStrategy.generate({ home_grid_preview: draft }, client);
        if (serial !== this.previewSerial || !this.isConnected) return;
        var old = this.previewView && this.previewView.isConnected ? this.previewView : w.hkShell.view(), cfg = config.views.find((v) => v.path === 'home');
        if (!cfg || cfg.type !== 'custom:hk-home-grid-view') throw new Error('loading');
        var el = w.document.createElement('hk-home-grid-view'); el.setConfig(cfg);
        el.cards = cfg.cards.map((c) => w.hkCards.createCard(c, client));
        // The overlay blocks pointer events; inert also blocks keyboard access to card actions.
        el.inert = true;
        if (old === this.previewView) old.replaceWith(el);
        else {
          // Keep the host's outer view: it owns tab-bar room and navigation.
          (old.shadowRoot || old).replaceChildren(el);
        }
        // The host's view lookup may still point at its cached view. Keep the preview local.
        this.previewView = el; this.previewRetries = 0; this.previewError = null;
        w.hkShell.announce({ detail: { replace: true } });
        if (this.previewOff) this.previewOff();
        this.previewOff = w.hkCards.onClient((next) => { el.cards.forEach((card) => w.hkHostClient.bridge(card, next)); });
        if (this.previewRO) this.previewRO.disconnect();
        this.previewRO = new w.ResizeObserver(() => this.fit()); this.previewRO.observe(el);
        this.fit();
        if (this.pickerCard) this.catalogPreviews();
      } catch (e) {
        this.previewError = String(e && e.message || e);
        this.previewRetries = (this.previewRetries || 0) + 1;
        if (this.previewRetries < 40) this.previewTimer = setTimeout(() => this.preview(), 500);
        else this.say('The live preview couldn’t load. Reload this page to try again.');
      }
    }
    async save() {
      if (this.busy || !this.grid || !valid(this.grid)) return;
      this.busy = true; this.saveButton.disabled = true; this.say('Saving…');
      try {
        var grid = copy(this.grid);
        var result = await this.panel.actions().callWS({ type: 'hk_frontend/board/set', dashboard: this.o.path,
          changes: { home_style: 'grid', home_grid: grid } });
        this.panel.data.boards[this.o.path] = result && result.board || Object.assign({}, this.o.board, { home_style: 'grid', home_grid: grid });
        this.initial = JSON.stringify(grid); this.o.onSaved();
      } catch (e) {
        var fields = window.hkSettingsModel.refusals(e);
        this.say('Couldn’t save. ' + (fields && fields.home_grid ? window.hkSettingsModel.errorText(fields.home_grid) : e.message || e));
      } finally { this.busy = false; this.saveButton.disabled = false; }
    }
  }
  window.hkGridEditor = { place: place, valid: valid, firstSpace: firstSpace, add: add, snap: snap, landing: landing };
  customElements.define('hk-grid-editor', GridEditor);
})();
