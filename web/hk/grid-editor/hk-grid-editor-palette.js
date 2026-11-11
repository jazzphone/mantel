// hk-grid-editor-palette.js - the palette and the chosen card.
//
// PART OF THE HOME GRID EDITOR (hk-grid-editor.js). Not a card and not run on its own: it registers one
// function, which hk-grid-editor.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridEditorParts = window.hkGridEditorParts || {})['hk-grid-editor-palette'] = function (KIT) {
    var copy = KIT.copy, DESCRIPTIONS = KIT.DESCRIPTIONS, firstSpace = KIT.firstSpace, G = KIT.G, GLYPHS = KIT.GLYPHS,
        GROUPS = KIT.GROUPS, NAMES = KIT.NAMES, offered = KIT.offered, SIZE_NAMES = KIT.SIZE_NAMES,
        SIZE_SHORT = KIT.SIZE_SHORT, SIZES = KIT.SIZES;

    // THE METHODS this part adds to GridEditor.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
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
        if (target) head.appendChild(h('div', { class: 'pick-banner' }, [h('span',
          { text: /^rule:/.test(this.pickerTarget) ? 'Choose the card rule ' + (+this.pickerTarget.slice(5) + 1) + ' shows in this ' + SIZE_NAMES[target.size] + ' block.' :
          'Choose a new card for this ' + SIZE_NAMES[target.size] + ' block.' }),
          h('button', { type: 'button', text: 'Cancel', onclick: () => this.pickFor(null) })]));
        var search = h('input', { class: 'catalog-search', type: 'search', placeholder: 'Search cards', 'aria-label': 'Search cards', value: this.pickerSearch || '' });
        head.appendChild(search);
        if (!target) head.appendChild(h('p', { text: this.grid ? 'Drag a card onto the grid, or click it to preview and add.' :
          'Choose a starter layout or Start Empty on the right, then drag cards onto the grid.' }));
        P.appendChild(head);
        var list = h('div', { class: 'catalog-list' }); P.appendChild(list);
        var rows = function () {
          list.replaceChildren();
          var query = (search.value || '').trim().toLowerCase(), count = 0;
          GROUPS.forEach(function (g) {
            var keys = g[1].filter((k) => offered(k) && self.sizesOf(k).length && (NAMES[k] + ' ' + DESCRIPTIONS[k] + ' ' + g[0]).toLowerCase().includes(query));
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
            title: SIZE_NAMES[s] + ' · ' + (s === 'XS' ? 'half a cell' : SIZES[s][0] + ' × ' + SIZES[s][1]) + (full ? ' · no free space' : ''), text: SIZE_SHORT[s] });
        }));
        var row = h('div', { class: 'cell pal-row', role: 'button', tabindex: '0', 'data-card': k, 'aria-expanded': String(open),
          'aria-label': NAMES[k] + ', ' + DESCRIPTIONS[k] + (this.pickerTarget ? '' : '. Drag onto the grid, or press Enter to preview.') },
          [h('hk-icon', { icon: GLYPHS[k] }), h('span', { class: 'pt' }, [h('b', { text: NAMES[k] }), h('small', { text: DESCRIPTIONS[k] }), chips])]);
        // A FINGER SCROLLS THE LIST (2026-10-24, the owner on an iPad: "it keeps
        // thinking I want to move a card"): up or down is the list's to scroll
        // (touch-action pan-y); a card is picked up by a drag sideways, towards
        // the grid, or by a hold (hkDrag.HOLD_MS, iOS's home screen) and then any way.
        // A mouse picks it up on any 5 px drag, as before. While a card is
        // carried the list doesn't scroll under it (touchmove, not passive).
        // The press is told apart by modules/hk-drag.js, Edit mode's too.
        var D = window.hkDrag;
        D.holdStill(row, 'lifted');
        row.addEventListener('pointerdown', function (e) {
          // THE SIZE CHIP PRESSED is read here, not at the tap: the press captures the pointer to the row, so the
          // pointerup's target is the row whatever was under the finger (2026-10-31, the owner: choosing Wide left the
          // preview on Small -- the tap always fell through to opening and closing the row)
          var chip = e.target.closest && e.target.closest('.chip');
          D.press(row, e, {
            axis: 'x',
            lift: function (ev) { return self.paletteDrag(ev, k, row); },
            tap: function () {
              if (chip) { self.paletteSizes[k] = chip.dataset.size; self.pickerCard = k; }
              else self.pickerCard = self.pickerCard === k ? null : k;
              self.drawPalette();
            }
          });
        });
        row.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          // (Enter on a size chip chooses that size, as a tap does; on the row, opens or closes it)
          var chip = e.target.closest && e.target.closest('.chip');
          if (chip) { this.paletteSizes[k] = chip.dataset.size; this.pickerCard = k; } else this.pickerCard = this.pickerCard === k ? null : k;
          this.drawPalette();
          var again = this.palette.querySelector(chip ? '[data-card="' + k + '"] .chip[data-size="' + chip.dataset.size + '"]' : '[data-card="' + k + '"]'); if (again) again.focus();
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
          h('p', { class: 'note', text: 'Sample readings. On your screen it shows your home.' +
            (space ? '' : ' There’s no free space for this size: drag the card onto the grid to replace the blocks it covers.') }),
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
        if (key === 'security' && item.size === 'C') variant.opts = Object.assign({}, variant.opts, { presentation: 'homeview' });
        if (/^rule:/.test(target)) {
          var rules = copy(item.rules || []), at = +target.slice(5);
          if (rules[at]) { rules[at] = Object.assign({ when: rules[at].when }, variant); this.update(item.id, { rules: rules }); }
          return;
        }
        this.update(item.id, { card: key, opts: variant.opts, pages: variant.pages || null });
      }
      // A card as a block or a fallback starts with: sample options, an
      // Accessory Group's automatic pages (its samples may not fit one page),
      // and a room that scrolls through all its accessories (the owner's
      // choice, 2026-10-24; a saved room without the option stays Summary)
      variantFor(key) {
        var out = { card: key, opts: this.previewOptions(key) };
        if (key === 'accessories') out.pages = { source: 'accessories' };
        if (key === 'room') out.opts.accessory_display = 'scroll';
        return out;
      }
    };
    KIT.install(Methods);
  };
})();
