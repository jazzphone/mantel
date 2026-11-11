// hk-grid-editor-sheet.js - Duplicate Block and a block's Custom Detail Sheet.
//
// PART OF THE HOME GRID EDITOR (hk-grid-editor.js). Not a card and not run on its own: it registers one
// function, which hk-grid-editor.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridEditorParts = window.hkGridEditorParts || {})['hk-grid-editor-sheet'] = function (KIT) {
    var copy = KIT.copy, firstSpace = KIT.firstSpace, G = KIT.G, NAMES = KIT.NAMES, RULE_MARK = KIT.RULE_MARK,
        SIZE_NAMES = KIT.SIZE_NAMES;

    // THE METHODS this part adds to GridEditor.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // DUPLICATE BLOCK (2026-11-07): the same block -- its card, options, rules, look and its custom sheet, the sheet's
      // entries each a new id -- in the first free place of its size in this view; none free, nothing moves and it says so
      duplicate(id) {
        var src = this.grid.items.find((x) => x.id === id);
        if (!src) return;
        if (this.grid.items.length >= 24) { this.say('A Home Grid holds at most 24 blocks.'); return; }
        var at = firstSpace(this.grid, src.size, src.view || 0);
        if (!at) { this.say('No free space for another ' + SIZE_NAMES[src.size] + ' block. Make room first; nothing was moved.'); return; }
        var next = copy(this.grid), n = 1;
        while (next.items.some((x) => x.id === 'b' + n)) n++;
        var dup = copy(src);
        dup.id = 'b' + n; dup.at = at;
        if (dup.interaction && dup.interaction.custom_sheet) dup.interaction.custom_sheet = G.copySheet(dup.interaction.custom_sheet);
        next.items.push(dup);
        this.selected = dup.id;
        this.change(next);
        this.say(NAMES[src.card] + ' duplicated.');
      }
      // ------------------------------------------------------------ a block's Custom Detail Sheet
      // WHEN TAPPED -> CUSTOM DETAIL SHEET (2026-11-07, docs/phase11/HOME-GRID.md "Custom Detail Sheet"): any block may
      // open a sheet of accessories of its own instead of what its card opens. The sheet is the BLOCK'S: it stays with
      // the block whichever card its rules or pages show. Back to the block's own tap keeps the sheet as a draft; only
      // Remove Sheet takes it away. Each entry's look is this sheet's alone -- the accessory is named, colored and drawn
      // as before everywhere else.
      sheetGroup(item) {
        var K = this.K, h = this.h, self = this, add = (n) => this.sidebar.appendChild(n), S = G.SHEET;
        var act = item.interaction || null, sheet = act && act.custom_sheet || null, on = !!act && act.tap === 'custom_sheet';
        var put = (a) => this.update(item.id, { interaction: a });
        // a change to the sheet: `fn` is handed a copy, changes it; the rest kept
        var edit = (fn) => { var a = copy(act || { tap: 'default' }); a.custom_sheet = a.custom_sheet || { v: 1, entries: [] }; fn(a.custom_sheet); put(a); };
        var own = item.card === 'security' && (item.opts || {}).presentation === 'homeview' ? 'Security Overview' : 'The Block’s Own';
        var rows = [K.select({ label: 'When Tapped', value: on ? 'custom_sheet' : 'default', options: [['default', own], ['custom_sheet', 'Custom Detail Sheet']],
          onChange: (v) => {
            if (v === 'custom_sheet') { var a = copy(act || {}); a.tap = 'custom_sheet'; a.custom_sheet = a.custom_sheet || { v: 1, entries: [] }; put(a); }
            else put(sheet ? { tap: 'default', custom_sheet: copy(sheet) } : null);
          } })];
        var footer = on ? 'This sheet opens from the whole block, whichever card it shows. Controls inside the block keep their own taps.'
          : sheet ? 'A sheet is set up but not used: the block does what its card does. Choose Custom Detail Sheet to use it again.'
          : 'Open a sheet of accessories you choose when the block is tapped, in place of what its card opens.';
        if (on && !(sheet.entries || []).length) rows.push(K.info({ label: 'Add an accessory', sub: 'A sheet with nothing in it can’t be saved.' }));
        add(K.group({ header: 'Detail Sheet', footer: footer }, rows));
        if (!sheet) return;
        var entries = sheet.entries || [];
        // THE SHEET: its title, its header's icon, its tiles' style
        var head = [
          K.text({ label: 'Title', value: sheet.title || '', placeholder: NAMES[item.card], maxlength: S.titleMax,
            onCommit: (v) => edit((x) => { v = v.trim(); if (v) x.title = v; else delete x.title; }) }),
          K.text({ label: 'Header Icon', value: sheet.icon || '', placeholder: 'Automatic', maxlength: 78,
            onCommit: (v) => { v = v.trim(); if (v && !S.icon.test(v)) { self.say('An icon is a set and a name, such as mdi:shield-home.'); self.side(); return; } edit(
              (x) => { if (v) x.icon = v; else delete x.icon; }); } }),
          K.seg({ label: 'Tile Style', value: sheet.tile_style || '', options: [['', 'Same as Screen'], ['home', 'Home'], ['centred', 'Tall (HomeView)']],
            onChange: (v) => edit((x) => { if (v) x.tile_style = v; else delete x.tile_style; }) }),
          K.button({ label: 'Preview Sheet', disabled: !entries.length, onClick: () => this.previewSheet(item) })];
        if (entries.some((e) => this.styled(e))) head.push(K.button({ label: 'Reset Every Entry’s Look',
          onClick: () => edit((x) => { x.entries = x.entries.map((e) => ({ id: e.id, entity: e.entity })); }) }));
        add(K.group({ header: 'Sheet', footer: 'Same as Screen uses this screen’s tile style. Each entry may have its own below.' }, head));
        // ITS ENTRIES, in order: each its accessory, how it looks here, and Move, Duplicate and Remove
        var choices = this.choices('entity'), nameOf = (id) => (choices.find((op) => op[0] === id) || [id, id + ' (Unavailable)'])[1];
        entries.forEach((e, i) => {
          var rowsE = [], set = (patch) => edit((x) => { var t = x.entries[i]; Object.keys(patch).forEach((k) => { if (patch[k] == null || patch[k] === '') delete t[k]; else t[k] = patch[k]; }); });
          var opts = choices.slice();
          if (!opts.some((op) => op[0] === e.entity)) opts.push([e.entity, e.entity + ' (Unavailable)']);
          rowsE.push(K.select({ label: 'Accessory', value: e.entity, options: opts,
            onChange: (v) => set({ entity: v, secondary: e.secondary && e.secondary.mode === 'attribute' ? null : e.secondary }) }));
          var open = this.sheetEntry === e.id;
          rowsE.push(K.button({ label: open ? 'Done Editing Look' : 'Edit Look' + (this.styled(e) ? ' (Custom)' : ''), onClick: () => { this.sheetEntry = open ? null : e.id; this.side(); } }));
          if (open) this.entryLook(e, set, rowsE);
          rowsE.push(K.button({ label: 'Move Up', disabled: i === 0, onClick: () => edit((x) => { x.entries.splice(i - 1, 0, x.entries.splice(i, 1)[0]); }) }));
          rowsE.push(K.button({ label: 'Move Down', disabled: i === entries.length - 1, onClick: () => edit((x) => { x.entries.splice(i + 1, 0, x.entries.splice(i, 1)[0]); }) }));
          rowsE.push(K.button({ label: 'Duplicate', disabled: entries.length >= S.max, onClick: () => edit((x) => {
            var d = copy(x.entries[i]); d.id = G.entryId(x.entries); x.entries.splice(i + 1, 0, d); this.sheetEntry = d.id;
          }) }));
          rowsE.push(K.button({ label: 'Remove', destructive: true, onClick: () => edit((x) => { x.entries.splice(i, 1); }) }));
          add(K.group({ header: (i + 1) + ' · ' + (e.name || nameOf(e.entity)) }, rowsE));
        });
        // ADD SEVERAL AT ONCE: the ones ticked, in the list's order
        var addRows = [];
        if (entries.length >= S.max) addRows.push(K.info({ label: 'This sheet is full', sub: 'A sheet holds at most ' + S.max + ' entries. Remove one to add another.' }));
        else if (this.sheetAdding !== item.id) addRows.push(K.button({ label: 'Add Accessories…',
          onClick: () => { this.sheetAdding = item.id; this.sheetPick = []; this.sheetFind = ''; this.side(); } }));
        else {
          var q = (this.sheetFind || '').toLowerCase(), pick = this.sheetPick || [], room = S.max - entries.length;
          addRows.push(K.text({ label: 'Search', value: this.sheetFind || '', placeholder: 'Name or ID', onCommit: (v) => { this.sheetFind = v; this.side(); } }));
          choices.filter((op) => !q || op[1].toLowerCase().indexOf(q) >= 0 || op[0].indexOf(q) >= 0).slice(0, 80).forEach((op) => {
            addRows.push(K.check({ label: op[1], multi: true, on: pick.indexOf(op[0]) >= 0, onClick: (on2) => {
              var p2 = (this.sheetPick || []).filter((x) => x !== op[0]);
              if (on2) { if (p2.length >= room) { this.say('There’s room for ' + room + ' more.'); this.side(); return; } p2.push(op[0]); }
              this.sheetPick = p2; this.side();
            } }));
          });
          addRows.push(K.button({ label: pick.length ? 'Add ' + pick.length + (pick.length === 1 ? ' Accessory' : ' Accessories') : 'Add', disabled: !pick.length, onClick: () => {
            var now = this.sheetPick || [], order = choices.map((op) => op[0]).filter((id) => now.indexOf(id) >= 0);
            edit((x) => { order.forEach((id) => { x.entries.push({ id: G.entryId(x.entries), entity: id }); }); });
            this.sheetAdding = null; this.sheetPick = [];
          } }));
          addRows.push(K.button({ label: 'Cancel', onClick: () => { this.sheetAdding = null; this.sheetPick = []; this.side(); } }));
        }
        // COPY FROM ANOTHER BLOCK: a copy, never a link -- changing either later leaves the other as it is
        var others = this.sheetSources(item.id);
        if (others.length) addRows.push(K.select({ label: 'Copy Sheet From', value: '', options: [['', 'Choose a Block…']].concat(others.map((o, k) => [String(k), o.label])),
          onChange: async (v) => {
            if (v === '') return;
            var src = others[+v];
            if (entries.length && !await this.K.confirm(this.shadowRoot, { title: 'Replace This Sheet?', message: 'Its title, style and entries become a copy of ' + src.label + '.',
              ok: 'Replace' })) { this.side(); return; }
            edit((x) => { var c = G.copySheet(src.sheet); Object.keys(x).forEach((k) => delete x[k]); Object.assign(x, c); });
          } }));
        add(K.group({ header: 'Entries', footer: entries.length + ' of ' + S.max + '. The same accessory may be here twice, each with its own look.' }, addRows));
        add(K.group({}, [K.button({ label: 'Remove Sheet', destructive: true, onClick: () => put(null) })]));
      }
      // an entry has a look of its own here
      styled(e) { return ['name', 'icon', 'color', 'tile_style', 'secondary'].some((k) => e[k] != null); }
      // ONE ENTRY'S LOOK IN THIS SHEET: its name, icon, color, tile style and the line under its name; Reset takes them away
      entryLook(e, set, rows) {
        var K = this.K, S = G.SHEET, self = this;
        rows.push(K.text({ label: 'Name', value: e.name || '', placeholder: 'Automatic', maxlength: S.nameMax, onCommit: (v) => set({ name: v.trim() || null }) }));
        rows.push(K.text({ label: 'Icon', value: e.icon || '', placeholder: 'Automatic', maxlength: 78,
          onCommit: (v) => { v = v.trim(); if (v && !S.icon.test(v)) { self.say('An icon is a set and a name, such as mdi:lock.'); self.side(); return; } set({ icon: v || null }); } }));
        var custom = e.color && S.hex.test(e.color);
        rows.push(K.select({ label: 'Color', value: custom ? 'custom' : e.color || '',
          options: [['', 'Automatic']].concat(S.colors.map((c) => [c, c.charAt(0).toUpperCase() + c.slice(1)]), [['custom', 'Custom…']]),
          onChange: (v) => set({ color: v === 'custom' ? '#40c8e0' : v || null }) }));
        if (custom) rows.push(K.text({ label: 'Custom Color', type: 'color', value: e.color, onCommit: (v) => { if (S.hex.test(v)) set({ color: v.toLowerCase() }); } }));
        rows.push(K.seg({ label: 'Tile Style', value: e.tile_style || '', options: [['', 'Same as Sheet'], ['home', 'Home'], ['centred', 'Tall']], onChange: (v) => set({ tile_style: v || null }) }));
        var sec = e.secondary || null;
        if (sec && sec.mode === 'room') {
          rows.push(K.select({ label: 'Line Under Name', value: 'room', options: [['auto', 'Automatic'], ['state', 'State'], ['room', 'Room'], ['brightness', 'Brightness'],
            ['attribute', 'An Attribute'], ['none', 'Hidden']],
            onChange: (m) => set({ secondary: m === 'auto' ? null : m === 'attribute' ? { mode: m, attribute: 'friendly_name' } : { mode: m } }) }));
        } else {
          var tmp = [];
          this.secondaryFields(sec, e.entity, (v) => set({ secondary: v }), tmp);
          // (the accessories' choices, and Room: an entry's own line may say where it is)
          if (tmp[0]) tmp[0] = K.select({ label: 'Line Under Name', value: sec ? sec.mode : 'auto',
            options: [['auto', 'Automatic'], ['state', 'State'], ['room', 'Room'], ['brightness', 'Brightness'], ['attribute', 'An Attribute'], ['none', 'Hidden']],
            onChange: (m) => {
              var a = (this.panel.client.states[e.entity] || {}).attributes || {}, keys = Object.keys(a).sort();
              set({ secondary: m === 'auto' ? null : m === 'attribute' ? { mode: m, attribute: keys.includes('battery_level') ? 'battery_level' : keys[0] || 'friendly_name' } : { mode: m } });
            } });
          tmp.forEach((r) => rows.push(r));
        }
        rows.push(K.button({ label: 'Reset Look', disabled: !this.styled(e), onClick: () => set({ name: null, icon: null, color: null, tile_style: null, secondary: null }) }));
      }
      // THE SHEETS THAT COULD BE COPIED: this screen's other blocks', and other screens' Home Grids' -- each named by its
      // screen, its card and its title
      sheetSources(selfId) {
        var out = [], data = this.panel.data || {}, here = this.o && this.o.path;
        var titled = (path) => { var d = (data.dashboards || []).find((x) => x.path === path); return (d && (d.title || d.name)) || path; };
        var from = (grid, path) => ((grid && grid.items) || []).forEach((it) => {
          var sh = it.interaction && it.interaction.custom_sheet;
          if (!sh || !(sh.entries || []).length || (path === here && it.id === selfId)) return;
          out.push({ sheet: sh, label: (path === here ? 'This Screen' : titled(path)) + ' · ' + (NAMES[it.card] || it.card) + ' · ' + (sh.title || NAMES[it.card]) + ' (' + sh.entries.length + ')' });
        });
        from(this.grid, here);
        Object.keys(data.boards || {}).forEach((path) => { if (path !== here) from((data.boards[path] || {}).home_grid, path); });
        return out;
      }
      // THE SCREEN'S TILE STYLE, as the screen resolves it (hk-strategy.js homeGridView): this screen's own, else All Screens', Automatic
      // being Centered on square cells; true where a block of this card and size draws Centered (Security past Small does not, as on the screen)
      screenTile(card, size, opts) {
        var own = this.o && this.o.board && this.o.board.tile_style, all = (((this.panel.data || {}).settings || {}).look || {}).tile_style;
        var ts = ['auto', 'home', 'centred'].indexOf(own) >= 0 ? own : ['auto', 'home', 'centred'].indexOf(all) >= 0 ? all : 'auto';
        var keeps = card === 'security' && size !== 'S' && (opts || {}).presentation !== 'homeview';
        return !keeps && (ts === 'centred' || (ts === 'auto' && !!this.grid && this.grid.cell === 'square'));
      }
      // PREVIEW SHEET: the real sheet, in the preview's page, over the house as the preview has it; nothing in it answers a tap
      previewSheet(item) {
        var w = (this.iframe && this.iframe.contentWindow) || window, D = w.hkDetail, sheet = item.interaction && item.interaction.custom_sheet;
        if (!D || !D.openSheet || !sheet) { this.say('The preview isn’t ready yet.'); return; }
        var style = this.screenTile('', 'S') ? 'centred' : 'home';
        D.openSheet(sheet, { title: NAMES[item.card], style: style, preview: true });
      }
      update(id, patch) {
        var next = copy(this.grid), at = String(id).split(RULE_MARK), it = next.items.find((x) => x.id === at[0]);
        if (at.length > 1) {                     // a rule's card (variantOf): its opts and pages, in the rule (none left, no key)
          it = it.rules[+at[1]];
          if (patch.opts && !Object.keys(patch.opts).length) patch = Object.assign({}, patch, { opts: null });
        }
        Object.keys(patch).forEach((key) => { if (patch[key] === null) delete it[key]; else it[key] = patch[key]; }); this.change(next);
      }
    };
    KIT.install(Methods);
  };
})();
