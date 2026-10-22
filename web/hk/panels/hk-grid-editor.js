// Home Grid's desktop editor. The draft belongs to this element; only Save writes.
// Placement functions are pure so mouse, keyboard and the catalog share refusals.
(function () {
  'use strict';
  if (window.hkGridEditor) return;
  var G = window.hkGridCatalog, SIZES = G.SIZES;
  var NAMES = { accessory: 'Accessory', scene: 'Scene', scenes: 'Scenes', now_playing: 'Now Playing',
    thermostat: 'Thermostat', camera: 'Camera', security: 'Security', timers: 'Timers', weather: 'Weather',
    calendar: 'Calendar', battery: 'House Battery', people: 'People', vacuum: 'Vacuum', clock: 'Clock',
    room: 'Room', scene_suggested: 'Suggested Scene', action: 'Action', everything: 'Everything' };
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
        return cat && cat.sizes.indexOf(it.size) >= 0 && fits(grid, it) &&
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
    ':host{position:fixed;inset:0;z-index:1000;overflow:auto}',
    '.editor{min-height:100%;background:var(--hk-bg)}',
    '.tools{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--hk-sep);background:var(--hk-cell);position:sticky;top:0;z-index:4}',
    '.tools h1{font-size:20px;margin:0;flex:1}.tools button{border:0;border-radius:8px;min-height:44px;padding:0 16px;background:var(--hk-fill);cursor:pointer}',
    '.tools .save{background:var(--hk-tint);color:white}.tools button:disabled{opacity:.4}',
    '.work{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;padding:20px}',
    '.stage{min-width:0}.framebox{position:relative;overflow:hidden;margin:auto;border-radius:10px;background:var(--hk-cell);outline:1px solid var(--hk-sep)}',
    '.frame{position:absolute;left:0;top:0;transform-origin:top left;background:var(--hk-cell);overflow:hidden}',
    'iframe{position:absolute;inset:0;border:0;width:100%;height:100%;pointer-events:none}',
    '.grid{position:absolute;display:grid;gap:10px;z-index:2}',
    '.slot{border:1px dashed var(--hk-label3);border-radius:10px;pointer-events:none}',
    '.block{position:absolute;z-index:3;cursor:grab;border:2px solid transparent;background:transparent;border-radius:10px;color:var(--hk-label);touch-action:none}',
    '.block[aria-pressed=true]{border-color:var(--hk-tint)}.block:focus-visible{outline:3px solid var(--hk-tint)}',
    '.block .tag{position:absolute;top:6px;left:6px;max-width:calc(100% - 12px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 8px;border-radius:7px;background:var(--hk-cell);font-size:13px}',
    '.ghost{position:absolute;pointer-events:none;border:3px solid var(--hk-tint);background:var(--hk-fill);border-radius:10px;z-index:4}.ghost.bad{border-color:var(--hk-red)}',
    '.note{font-size:13px;color:var(--hk-label2);line-height:1.5}.message{color:var(--hk-red);min-height:24px;padding:8px 20px}',
    '.catalog-card{padding:8px;border-bottom:1px solid var(--hk-sep)}.catalog-card button{min-height:44px;margin:4px;padding:6px 12px;border:0;border-radius:7px;background:var(--hk-fill);cursor:pointer}',
    '.mini{width:100%;height:100px;pointer-events:none;overflow:hidden;background:var(--hk-fill);border-radius:8px;margin:8px 0}',
    '.desktop-note{display:none;padding:32px}',
    '@media(max-width:899px),(pointer:coarse){.work,.tools .save,.tools .add{display:none}.desktop-note{display:block}}'
  ].join('\n');

  class GridEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this.selected = null; this.busy = false; }
    configure(options) {
      this.o = options; this.panel = options.panel; this.K = window.hkSettingsKit; this.h = this.K.h;
      this.grid = options.board.home_grid ? copy(options.board.home_grid) : null;
      this.initial = JSON.stringify(this.grid); this.catalog = !this.grid;
    }
    connectedCallback() {
      this.toggleAttribute('dark', this.panel.hasAttribute('dark'));
      if (this.ui) { this.fit(); return; }
      this.draw();
      this.ro = new ResizeObserver(this.fit.bind(this)); this.ro.observe(this.stage);
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
      var h = this.h, K = this.K, self = this;
      this.shadowRoot.replaceChildren(h('style', { text: K.CSS + '\n' + CSS }));
      this.ui = h('div', { class: 'editor' }); this.shadowRoot.appendChild(this.ui);
      this.saveButton = h('button', { class: 'save', text: 'Save', onclick: () => this.save(), disabled: !this.grid });
      this.ui.appendChild(h('header', { class: 'tools' }, [h('button', { text: 'Cancel', onclick: () => this.cancel() }),
        h('h1', { text: this.o.title + ' · Home Grid' }),
        h('button', { class: 'add', text: '+ Add', onclick: () => { this.catalog = true; this.side(); } }), this.saveButton]));
      this.message = h('div', { class: 'message', role: 'status', 'aria-live': 'polite' }); this.ui.appendChild(this.message);
      this.ui.appendChild(h('div', { class: 'desktop-note', text: 'Arrange Home Grid on a desktop with a mouse or trackpad. This screen only displays the saved layout.' }));
      this.stage = h('section', { class: 'stage', 'aria-label': 'Screen layout' });
      this.sidebar = h('aside', { 'aria-label': 'Block and grid options' });
      this.ui.appendChild(h('div', { class: 'work' }, [this.stage, this.sidebar]));
      this.stage.appendChild(h('p', { class: 'note', text: 'Drag blocks to move them. Equal sizes swap. Select a block and use the arrow keys to move it. Cards are a preview; controls do not act on the house.' }));
      this.box = h('div', { class: 'framebox' }); this.stage.appendChild(this.box);
      this.frame = h('div', { class: 'frame' }); this.box.appendChild(this.frame);
      this.iframe = h('iframe', { title: 'Home Grid preview', tabindex: '-1', 'aria-hidden': 'true' });
      this.iframe.inert = true;
      this.iframe.src = this.panel.hostScreenBase() + '/' + this.o.path + '/home?hk_kiosk=on&kiosk&wp_enabled=false';
      this.iframe.addEventListener('load', () => this.preview());
      this.frame.appendChild(this.iframe);
      this.overlay = h('div', { class: 'grid', 'aria-label': 'Grid blocks' }); this.frame.appendChild(this.overlay);
      this.overlay.addEventListener('dragover', (e) => { e.preventDefault(); });
      this.overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        try { var data = JSON.parse(e.dataTransfer.getData('application/x-hk-grid')); self.addCard(data.card, data.size, snap(e.clientX, e.clientY, self.overlay.getBoundingClientRect(), self.grid.cols, self.grid.rows)); } catch (x) { self.say('That block could not be placed.'); }
      });
      this.blocks(); this.side(); this.fit();
    }
    change(grid) {
      this.grid = grid; this.saveButton.disabled = false; this.say(''); this.blocks(); this.side(); this.fit(); this.preview();
    }
    blocks() {
      this.overlay.replaceChildren();
      if (!this.grid) return;
      var h = this.h, self = this;
      this.overlay.style.gridTemplateColumns = 'repeat(' + this.grid.cols + ',1fr)';
      this.overlay.style.gridTemplateRows = 'repeat(' + this.grid.rows + ',1fr)';
      for (var i = 0; i < this.grid.cols * this.grid.rows; i++) this.overlay.appendChild(h('div', { class: 'slot' }));
      this.grid.items.forEach(function (it) {
        var b = h('button', { class: 'block', type: 'button', 'data-id': it.id, 'aria-label': NAMES[it.card] + ', ' + it.size + ', column ' + (it.at[0] + 1) + ', row ' + (it.at[1] + 1),
          'aria-pressed': self.selected === it.id ? 'true' : 'false' }, h('span', { class: 'tag', text: NAMES[it.card] + ' · ' + it.size }));
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
      this.selected = id; this.catalog = false;
      this.overlay.querySelectorAll('.block').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false'));
      this.side();
    }
    position(el, it) {
      var z = SIZES[it.size], w = (this.overlay.clientWidth - (this.grid.cols - 1) * 10) / this.grid.cols;
      var h = (this.overlay.clientHeight - (this.grid.rows - 1) * 10) / this.grid.rows;
      Object.assign(el.style, { left: it.at[0] * (w + 10) + 'px', top: it.at[1] * (h + 10) + 'px', width: (w + 10) * z[0] - 10 + 'px', height: (h + 10) * z[1] - 10 + 'px' });
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
    fit() {
      if (!this.grid || !this.box) return;
      var frame = this.grid.frame, scale = Math.min(1, (this.stage.clientWidth || 800) / frame[0], Math.max(240, window.innerHeight - 220) / frame[1]);
      this.frame.style.width = frame[0] + 'px'; this.frame.style.height = frame[1] + 'px'; this.frame.style.transform = 'scale(' + scale + ')';
      this.box.style.width = frame[0] * scale + 'px'; this.box.style.height = frame[1] * scale + 'px';
      // Follow the real frame's layout (including top/bottom tab bar or side rail).
      var w = this.iframe.contentWindow, view;
      try { view = w && w.hkShell && w.hkShell.view(); } catch (e) { /* loading */ }
      view = this.previewView && this.previewView.isConnected ? this.previewView : view;
      var cell = view && view._config && view._config.grid && view.shadowRoot && view.shadowRoot.querySelector('.cell');
      if (cell) {
        var r = cell.getBoundingClientRect(), it = view._config.cards.find((x) => x.hk_cell && x.hk_cell.id === cell.dataset.id).hk_cell;
        var z = SIZES[it.size], cw = (r.width - (z[0] - 1) * 10) / z[0], ch = (r.height - (z[1] - 1) * 10) / z[1];
        Object.assign(this.overlay.style, { left: r.left - it.at[0] * (cw + 10) + 'px', top: r.top - it.at[1] * (ch + 10) + 'px',
          width: (cw + 10) * this.grid.cols - 10 + 'px', height: (ch + 10) * this.grid.rows - 10 + 'px' });
      } else if (view && view._config && view._config.grid && view.shadowRoot && view.shadowRoot.querySelector('#root')) {
        var root = view.shadowRoot.querySelector('#root'), bounds = root.getBoundingClientRect(), cs = w.getComputedStyle(root);
        var pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom), pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
        var band = view._config.grid.band ? 70 : 0;
        Object.assign(this.overlay.style, { left: bounds.left + pl + 'px', top: bounds.top + pt + band + 'px',
          width: bounds.width - pl - pr + 'px', height: bounds.height - pt - pb - band + 'px' });
      } else {
        var pad = frame[0] * 0.015 + 8, top = pad + (this.grid.band ? 70 : 0);
        Object.assign(this.overlay.style, { left: pad + 'px', top: top + 'px', width: frame[0] - 2 * pad + 'px', height: frame[1] - top - pad + 'px' });
      }
      this.overlay.querySelectorAll('.block').forEach((b) => { var it = this.grid.items.find((i) => i.id === b.dataset.id); if (it) this.position(b, it); });
    }
    addCard(card, size, at) {
      if (!this.grid) { this.say('Choose a starter layout first.'); return; }
      var next = add(this.grid, card, size, at);
      if (!next) { this.say('No space for that size. Remove or move a block first.'); return; }
      this.selected = next.items[next.items.length - 1].id; this.catalog = false; this.change(next);
    }
    async starter(concept) {
      if (this.busy) return;
      if (this.grid && !await this.K.confirm(this.shadowRoot, { title: 'Use a Starter Layout?', message: 'This replaces your draft. Nothing is saved yet.', ok: 'Use Starter' })) return;
      var client = this.panel.client, states = client.states || {}, board = this.o.board;
      var ids = (domain) => Object.keys(states).filter((id) => id.indexOf(domain + '.') === 0).slice(0, 512);
      var rooms = (board.room_order || []).filter((id) => (client.areas || {})[id]);
      if (!rooms.length) rooms = Object.keys(client.areas || {});
      rooms = rooms.slice(0, 512);
      var tablet = Object.values(this.panel.data.tablets || {}).find((t) => t.screen === this.o.path && t.room);
      var menu = board.menu_custom ? board.menu : (this.panel.data.settings.menu || {}).menu;
      try {
        this.busy = true;
        var result = await client.callWS({ type: 'hk_frontend/grid/starter', options: {
          concept: concept, scenes: board.scenes && board.scenes.length ? board.scenes.filter((id) => id.indexOf('scene.') === 0) : ids('scene'), rooms: rooms,
          cameras: board.cameras && board.cameras.length ? board.cameras : ids('camera'), climate: ids('climate'),
          tablet_room: tablet ? tablet.room : null, tab_bar: menu === 'tabbar' || menu === 'auto' || !menu
        } });
        this.selected = null; this.catalog = false; this.change(copy(result.grid));
      } catch (e) { this.say('Couldn’t load the starter. ' + (e.message || e)); }
      finally { this.busy = false; }
    }
    side() {
      var h = this.h, K = this.K, self = this, cat = G.table();
      if (this.catalogOff) { this.catalogOff(); this.catalogOff = null; }
      this.sidebar.replaceChildren();
      var group = (title, rows, footer) => this.sidebar.appendChild(K.group({ header: title, footer: footer }, rows));
      if (this.catalog && this.grid) {
        var cards = h('div');
        Object.keys(cat).forEach(function (key) {
          var sizes = cat[key].sizes.filter((sz) => SIZES[sz][0] <= self.grid.cols && SIZES[sz][1] <= self.grid.rows);
          if (!sizes.length) return;
          var row = h('div', { class: 'catalog-card' }, h('strong', { text: NAMES[key] }));
          sizes.forEach(function (sz) {
            var button = h('button', { text: sz, 'data-card': key, 'data-size': sz, draggable: 'true', 'aria-label': 'Add ' + NAMES[key] + ' ' + sz,
              onclick: () => self.addCard(key, sz) });
            button.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-hk-grid', JSON.stringify({ card: key, size: sz })); e.dataTransfer.effectAllowed = 'copy'; });
            row.appendChild(button);
            row.appendChild(h('div', { class: 'mini', 'data-preview-card': key, 'data-preview-size': sz }));
          });
          cards.appendChild(row);
        });
        group('Add a Block', [cards], 'Click a size for the first space that fits, or drag it onto the grid.');
      }
      var item = this.grid && this.grid.items.find((it) => it.id === this.selected);
      if (item && !this.catalog) {
        group(NAMES[item.card], [K.select({ label: 'Size', value: item.size,
          options: cat[item.card].sizes.filter((sz) => SIZES[sz][0] <= self.grid.cols).map((sz) => [sz, sz]),
          onChange: (sz) => { var next = place(self.grid, item.id, item.at, sz); if (next) self.change(next); else { self.say('That size does not fit here.'); self.side(); } } }),
          K.button({ label: 'Remove Block', destructive: true, onClick: () => { var next = copy(self.grid); next.items = next.items.filter((it) => it.id !== item.id); self.selected = null; self.change(next); } })]);
        this.optionFields(item, item.opts || {}, (opts) => this.update(item.id, { opts: opts }), 'Options', false);
        var sources = [['', 'Single Card'], ['list', 'Custom Pages']].concat(cat[item.card].sources.map((s) => [s, NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)]));
        var src = item.pages && item.pages.source || '';
        var rows = [K.select({ label: 'Pages', value: src, options: sources, onChange: (s) => {
          this.update(item.id, { pages: s ? s === 'list' ? { source: 'list', list: [{ opts: {} }] } : { source: s } : null });
        } })];
        if (src === 'rooms' || src === 'thermostats') rows.push(K.toggle({ label: 'Start on Tablet’s Room', on: item.pages.start === 'tablet_room', onChange: (on) => {
          var p = copy(item.pages); if (on) p.start = 'tablet_room'; else delete p.start; this.update(item.id, { pages: p });
        } }));
        group('Pages', rows);
        if (src === 'list') {
          item.pages.list.forEach((pg, i) => {
            this.optionFields(item, pg.opts || {}, (opts) => { var p = copy(item.pages); p.list[i].opts = opts; this.update(item.id, { pages: p }); }, 'Page ' + (i + 1), true);
            group('', [K.button({ label: 'Move Page ' + (i + 1) + ' Up', disabled: i === 0, onClick: () => { var p = copy(item.pages); p.list.splice(i - 1, 0, p.list.splice(i, 1)[0]); this.update(item.id, { pages: p }); } }),
              K.button({ label: 'Remove Page ' + (i + 1), destructive: true, disabled: item.pages.list.length === 1, onClick: () => { var p = copy(item.pages); p.list.splice(i, 1); this.update(item.id, { pages: p }); } })]);
          });
          group('', [K.button({ label: 'Add Page', disabled: item.pages.list.length >= 12, onClick: () => { var p = copy(item.pages); p.list.push({ opts: {} }); this.update(item.id, { pages: p }); } })]);
        }
      }
      group('Starter Layouts', ['A', 'C'].map((c) => K.button({ label: c === 'A' ? 'Tap Weight' : 'Glance Up, Touch Down', onClick: () => this.starter(c) })), 'Starts with your home’s scenes, rooms, cameras and thermostats.');
      if (this.catalog) this.catalogPreviews();
      if (!this.grid) return;
      var config = (key, value) => { var next = copy(this.grid); next[key] = value; if (valid(next)) this.change(next); else { this.say('Move or remove blocks that would be outside the new grid first.'); this.side(); } };
      group('Grid', [K.select({ label: 'Columns', value: this.grid.cols, options: [6, 3, 2].map((n) => [n, String(n)]), onChange: (n) => config('cols', Number(n)) }),
        K.select({ label: 'Rows', value: this.grid.rows, options: [2, 3, 4, 5, 6].map((n) => [n, String(n)]), onChange: (n) => config('rows', Number(n)) }),
        K.toggle({ label: 'Top Band', on: this.grid.band, onChange: (v) => config('band', v) }),
        K.text({ label: 'Frame Width', value: this.grid.frame[0], type: 'number', onCommit: (v) => config('frame', [Number(v), this.grid.frame[1]]) }),
        K.text({ label: 'Frame Height', value: this.grid.frame[1], type: 'number', onCommit: (v) => config('frame', [this.grid.frame[0], Number(v)]) })]);
      if (this.panel.host() && this.panel.host().gridHistory) {
        group('Layout History', [K.button({ label: 'History', onClick: () => this.history() })]);
        if (this.histories) {
          var historyRows = this.histories.map((row) => K.button({ label: 'Version ' + row.version + ' · ' + new Date(row.created * 1000).toLocaleString() + ' · ' + (row.actor_name || row.actor || row.source || 'Unknown'), onClick: () => this.restore(row) }));
          group('Earlier Layouts', historyRows, historyRows.length ? 'Choose a version to preview it as your draft. Save to restore only its layout.' : 'No earlier layouts.');
        }
        var targets = this.panel.data.dashboards.filter((d) => d.item && d.generated && d.path !== this.o.path && this.panel.data.boards[d.path]);
        if (targets.length) group('Copy Layout To…', [K.select({ label: 'Screen', value: '', options: [['', 'Choose Screen']].concat(targets.map((d) => [d.path, d.title])), onChange: (path) => this.copyTo(path) })]);
      }
    }
    catalogPreviews() {
      var w = this.iframe.contentWindow;
      if (!w || !w.hkCards || !this.previewView) return;
      var ctx = {}, pg = this.previewView._config.cards.find((c) => c.ctx);
      if (pg) ctx = pg.ctx;
      if (this.catalogOff) this.catalogOff();
      var cards = [], self = this;
      this.sidebar.querySelectorAll('[data-preview-card]').forEach(function (box) {
        box.replaceChildren();
        var sz = box.dataset.previewSize, z = SIZES[sz], width = 196 * z[0] + 10 * (z[0] - 1), height = 137 * z[1] + 10 * (z[1] - 1);
        var it = { id: 'preview', card: box.dataset.previewCard, size: sz, at: [0, 0] };
        var card = w.hkCards.createCard(w.hkGridCatalog.config(it, ctx), w.hkCards.client());
        card.setAttribute('size', sz); card.inert = true; cards.push(card);
        var cell = self.h('div'); cell.setAttribute('size', sz);
        Object.assign(cell.style, { width: width + 'px', height: height + 'px', containerType: 'size', containerName: 'hk-cell',
          transformOrigin: 'top left', transform: 'scale(' + Math.min(1, 280 / width, 100 / height) + ')',
          color: w.getComputedStyle(w.document.documentElement).color });
        cell.style.setProperty('--hk-cell-w', '196px'); cell.style.setProperty('--hk-cell-h', '137px');
        Object.assign(card.style, { width: '100%', height: '100%', display: 'block' });
        cell.appendChild(card); box.appendChild(cell);
      });
      this.catalogOff = w.hkCards.onClient((client) => cards.forEach((card) => w.hkHostClient.bridge(card, client)));
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
    optionFields(item, opts, save, title, page) {
      var K = this.K, self = this, fields = G.table()[item.card].opts || {}, rows = [];
      var set = (key, value) => { var out = copy(opts); if (value === '' || value == null) delete out[key]; else out[key] = value; save(out); };
      Object.keys(fields).forEach(function (key) {
        var kind = fields[key], label = key.charAt(0).toUpperCase() + key.slice(1);
        if (kind === 'windows') { self.windows(opts, set, rows); return; }
        var choices = self.choices(kind);
        if (kind === 'scenes' || kind === 'calendars') {
          choices.forEach((op) => rows.push(K.check({ label: op[1], multi: true, on: (opts[key] || []).indexOf(op[0]) >= 0, onClick: (on) => {
            var list = (opts[key] || []).filter((v) => v !== op[0]); if (on) list.push(op[0]);
            if (list.length > 24) { self.say('At most 24 items per list.'); return; } set(key, list.length ? list : null);
          } })));
          return;
        }
        var all = [['', page ? 'Use Block’s Option' : 'Automatic']].concat(choices);
        if (opts[key] && !all.some((op) => op[0] === opts[key])) all.push([opts[key], opts[key] + ' (Unavailable)']);
        rows.push(K.select({ label: label, value: opts[key] || '', options: all, onChange: (v) => set(key, v) }));
      });
      if (!rows.length) rows.push(K.info({ label: 'Uses this screen’s settings' }));
      this.sidebar.appendChild(K.group({ header: title }, rows));
    }
    choices(kind) {
      var client = this.panel.client, states = client.states || {};
      if (kind === 'area') return [['tablet_room', 'Tablet’s Room']].concat(Object.keys(client.areas || {}).map((id) => [id, client.areas[id].name || id]));
      var domains = { scene: ['scene', 'script'], scenes: ['scene'], speaker: ['media_player'], climate: ['climate'], camera: ['camera'],
        weather: ['weather'], vacuum: ['vacuum'], calendars: ['calendar'], action: ['scene', 'script'] }[kind];
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
        rows.push(K.text({ label: 'Window ' + (i + 1), value: w.label || '', maxlength: 24, onCommit: (v) => put('label', v) }));
        ['start', 'end'].forEach((key) => rows.push(K.text({ label: key === 'start' ? 'From' : 'Until', type: 'time', value: w[key], onCommit: (v) => put(key, v) })));
        rows.push(K.select({ label: 'Scene or Script', value: w.scene, options: self.choices('scene'), onChange: (v) => put('scene', v) }));
        rows.push(K.button({ label: 'Remove Window ' + (i + 1), destructive: true, onClick: () => { var next = copy(windows); next.splice(i, 1); set('windows', next.length ? next : null); } }));
      });
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
        var client = w.hkCards.client(), config = await w.hkStrategy.generate({ home_grid_preview: copy(this.grid) }, client);
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
        if (this.catalog) this.catalogPreviews();
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
  window.hkGridEditor = { place: place, valid: valid, firstSpace: firstSpace, add: add, snap: snap };
  customElements.define('hk-grid-editor', GridEditor);
})();
