// hk-grid-editor-screen.js - the screen's type, its views, cell shape and starters.
//
// PART OF THE HOME GRID EDITOR (hk-grid-editor.js). Not a card and not run on its own: it registers one
// function, which hk-grid-editor.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridEditorParts = window.hkGridEditorParts || {})['hk-grid-editor-screen'] = function (KIT) {
    var copy = KIT.copy, EMPTY = KIT.EMPTY, GLYPHS = KIT.GLYPHS, GROUP_TINT = KIT.GROUP_TINT, groupOf = KIT.groupOf,
        NAMES = KIT.NAMES, NIGHTSTAND = KIT.NIGHTSTAND, paneForStarter = KIT.paneForStarter, reflow = KIT.reflow,
        SCREEN_TYPES = KIT.SCREEN_TYPES, screenTypeOf = KIT.screenTypeOf, SIZE_NAMES = KIT.SIZE_NAMES,
        SIZES = KIT.SIZES, SQUARE_STARTERS = KIT.SQUARE_STARTERS, squareStarter = KIT.squareStarter, ST = KIT.ST,
        STARTERS = KIT.STARTERS, valid = KIT.valid;

    // THE METHODS this part adds to GridEditor.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // A SCREEN TYPE: its columns, rows, band and preview size together, the
      // blocks re-packed in reading order; any that can't fit are named first
      // A VIEW GOES, its blocks with it (asked first when it has any); the views after it close up
      async removeView(v) {
        var n = this.grid.items.filter((it) => (it.view || 0) === v).length;
        if (n && !await this.K.confirm(this.shadowRoot, { title: 'Remove View ' + (v + 1) + '?', message: (n === 1 ? 'Its block goes' : 'Its ' + n + ' blocks go') + ' with it. Nothing is saved yet.',
          ok: 'Remove View', destructive: true })) return;
        var next = copy(this.grid);
        next.items = next.items.filter((it) => (it.view || 0) !== v).map((it) => {
          if ((it.view || 0) > v) { it.view -= 1; if (!it.view) delete it.view; }
          return it;
        });
        next.views = (next.views || 1) - 1;
        if (next.views <= 1) delete next.views;
        ST.VIEW = Math.max(0, v - 1); this.selected = null;
        this.change(next);
      }
      async screenType(key) {
        var t = SCREEN_TYPES.find((x) => x[0] === key);
        if (!t || !this.grid) return;
        var r = reflow(this.grid, t[2], t[3]);
        if (r.left.length) {
          var names = r.left.map((it) => (NAMES[it.card] || it.card) + ' (' + SIZE_NAMES[it.size] + ')');
          var ok = await this.K.confirm(this.shadowRoot, { title: 'Use ' + t[1] + '?',
            message: (names.length === 1 ? 'This block doesn’t fit and leaves the draft: ' : 'These blocks don’t fit and leave the draft: ') + names.join(', ') + '. Nothing is saved yet.',
            ok: 'Use ' + t[1] });
          if (!ok) { this.side(); return; }
        }
        r.grid.band = t[4]; r.grid.frame = t[5].slice();
        // (a phone fills itself: its grid is smaller than its screen on its side)
        if (/^phone/.test(t[0])) r.grid.grow = true;
        // ...the type's cells; Square: a square screen's, filled to its edge (its blocks keep their places)
        if (t[6] === 'square') r.grid.cell = 'square'; else delete r.grid.cell;
        if (t[0] === 'square') { r.grid.screen = 'square'; r.grid.grow = true; } else delete r.grid.screen;
        if (r.grid.items.every((it) => it.id !== this.selected)) this.selected = null;
        this.change(r.grid);
      }
      // COLUMNS: on square cells the rows follow (rowsFor) and the blocks flow
      // onto the new grid in reading order; on tiles, as before, only when every
      // block still fits
      columns(n) {
        if (this.grid.cell !== 'square') {
          var next = copy(this.grid); next.cols = n;
          if (valid(next)) this.change(next); else { this.say('Move or remove the blocks that would be outside the new grid first.'); this.side(); }
          return;
        }
        // (the rows stay: they come from the height, fullColumns)
        var r = reflow(this.grid, n, this.grid.rows);
        if (r.left.length) this.say(r.left.length + (r.left.length === 1 ? ' block didn’t fit and was left out.' : ' blocks didn’t fit and were left out.'));
        this.change(r.grid);
      }
      // CELL SHAPE (2026-10-30): Tile or Square, every block where it was
      cellShape(v) {
        var next = copy(this.grid);
        if (v === 'square') next.cell = 'square'; else delete next.cell;
        this.change(next);
      }
      // a starter (or Start Empty) on this screen's grid, when the screen has
      // one other than the starters' own 6 x 4
      asScreen(grid) {
        var g = this.grid;
        if (!g || !grid || (g.cols === grid.cols && g.rows === grid.rows)) return grid;
        var out = reflow(grid, g.cols, g.rows).grid;
        out.band = g.band; out.frame = g.frame.slice();
        // (the screen's cells, and a Square screen stays one)
        if (g.cell) out.cell = g.cell; else delete out.cell;
        if (g.screen) out.screen = g.screen; else delete out.screen;
        return out;
      }
      async starter(concept) {
        if (this.busy) return;
        if (this.grid && !await this.K.confirm(this.shadowRoot, { title: 'Use a Starter Layout?', message: 'This replaces your draft. Nothing is saved yet.', ok: 'Use Starter' })) return;
        this.paneChange = null; this.lookChange = null;
        if (concept === 'empty') { this.selected = null; this.change(this.asScreen(copy(EMPTY))); return; }
        var sq = this.squareStarters().find((c) => c[0] === concept);
        if (sq) {
          ST.VIEW = 0; this.selected = null; this.paneChange = paneForStarter(sq, this.o.board);
          this.change(squareStarter(sq, this.grid, this.squareHouse()));
          if (this.paneChange) this.say('Saving also turns on this screen’s Side Pane, beside Home.');
          return;
        }
        var own = NIGHTSTAND.find((c) => c[0] === concept);
        if (own && this.grid) {
          var g2 = Object.assign(copy(this.grid), { items: copy(own[3]) });
          if (own[4]) g2.views = own[4]; else delete g2.views;
          ST.VIEW = 0; this.selected = null; this.change(g2); return;
        }
        var result;
        try {
          this.busy = true;
          result = this.starterGrids && this.starterGrids[concept] ? { grid: this.starterGrids[concept] }
            : await this.panel.client.callWS({ type: 'hk_frontend/grid/starter', options: this.starterOptions(concept) });
        } catch (e) { this.say('Couldn’t load the starter. ' + (e.message || e)); return; }
        finally { this.busy = false; }
        this.selected = null; this.change(this.asScreen(copy(result.grid)));
      }
      // what a starter is filled from: this screen's scenes, rooms, cameras,
      // thermostats, its tablet's room and whether it shows the tab bar
      starterOptions(concept) {
        var client = this.panel.client, states = client.states || {}, board = this.o.board;
        var ids = (domain) => Object.keys(states).filter((id) => id.indexOf(domain + '.') === 0).slice(0, 512);
        var rooms = (board.room_order || []).filter((id) => (client.areas || {})[id]);
        if (!rooms.length) rooms = Object.keys(client.areas || {});
        rooms = rooms.slice(0, 512);
        var tablet = Object.values(this.panel.data.tablets || {}).find((t) => t.screen === this.o.path && t.room);
        var menu = board.menu;            // as read: a button's style All Screens' unless the screen owns it (settings.py resolved())
        return { concept: concept, scenes: board.scenes && board.scenes.length ? board.scenes.filter((id) => id.indexOf('scene.') === 0) : this.sceneIds().slice(0, 512), rooms: rooms,
          cameras: board.cameras && board.cameras.length ? board.cameras : ids('camera'), climate: ids('climate'),
          tablet_room: tablet ? tablet.room : null, tab_bar: menu === 'tabbar' || menu === 'auto' || !menu };
      }
      // this screen type's HomeView-style starters (SQUARE_STARTERS)
      squareStarters() { return SQUARE_STARTERS[screenTypeOf(this.grid)] || []; }
      // WHAT A SQUARE STARTER IS FILLED FROM: this screen's (starterOptions:
      // its scenes, rooms, cameras, thermostats and its tablet's room), and of
      // the house's accessories those in the tablet's room first -- its
      // thermostat, the front door's lock (else the first), its lights and
      // fan, then the house's others (lights, fans, covers, switches)
      squareHouse() {
        var client = this.panel.client, states = client.states || {}, ents = client.entities || {}, devs = client.devices || {};
        var o = this.starterOptions('A'), room = o.tablet_room || o.rooms[0] || null;
        var areaOf = (id) => { var e = ents[id] || {}; return e.area_id || (devs[e.device_id] || {}).area_id || null; };
        var shown = (id) => !(ents[id] && (ents[id].hidden || ents[id].entity_category));
        var name = (id) => String(((states[id] || {}).attributes || {}).friendly_name || id);
        var ids = (d) => Object.keys(states).filter((id) => id.indexOf(d + '.') === 0 && shown(id)).sort((a, b) => name(a).localeCompare(name(b)));
        var near = (list) => list.filter((id) => areaOf(id) === room).concat(list.filter((id) => areaOf(id) !== room));
        var locks = ids('lock'), lights = near(ids('light')), fans = near(ids('fan'));
        return { climate: near(o.climate)[0] || null, scenes: o.scenes.slice(0, 24), lock: locks.find((id) => /front/i.test(id + ' ' + name(id))) || locks[0] || null,
          light: lights.slice(0, 1), fan: fans.slice(0, 1), more: lights.slice(1).concat(fans.slice(1), near(ids('cover')), near(ids('switch'))),
          weather: ids('weather').length > 0, camera: o.cameras.length > 0 };
      }
      // EVERY STARTER, as it would be for this screen (read-only requests, once):
      // the maps beside their names
      loadStarters() {
        if (this.starterGrids || this._startersLoading) return;
        this._startersLoading = true;
        var client = this.panel.client, got = {};
        Promise.all(STARTERS.filter((c) => c[0] !== 'empty').map((c) => client.callWS({ type: 'hk_frontend/grid/starter', options: this.starterOptions(c[0]) })
          .then((r) => { got[c[0]] = r.grid; }, () => {}))).then(() => {
          this._startersLoading = false; this.starterGrids = got;
          if (this.ui && !this.selected) this.side();
        });
      }
      // A LAYOUT'S MAP: its band and its blocks, each in its palette group's color with its glyph
      miniMap(grid, waiting) {
        var h = this.h, g = grid || EMPTY, kids = [];
        var box = h('div', { class: 'mini', 'aria-hidden': 'true' });
        box.style.gridTemplateColumns = 'repeat(' + g.cols + ',minmax(0,1fr))';
        box.style.gridTemplateRows = (g.band ? 'minmax(0,.35fr) ' : '') + 'repeat(' + g.rows + ',minmax(0,1fr))';
        if (g.band) kids.push(h('span', { class: 'band' }));
        if (waiting) {
          for (var k = 0; k < g.cols * g.rows; k++) kids.push(h('i', { class: 'wait' }));
        }
        (waiting ? [] : g.items.filter((it) => !it.view)).forEach((it) => {
          var z = SIZES[it.size], tile = h('i', {}, h('hk-icon', { icon: GLYPHS[it.card] }));
          tile.style.gridColumn = (it.at[0] + 1) + ' / span ' + z[0];
          tile.style.gridRow = (it.at[1] + 1 + (g.band ? 1 : 0)) + ' / span ' + z[1];
          tile.style.background = 'color-mix(in srgb,' + GROUP_TINT[groupOf(it.card)] + ' 38%,transparent)';
          kids.push(tile);
        });
        kids.forEach((n) => box.appendChild(n));
        return box;
      }
      // LAYOUT + LOOK (2026-10-30, hk_core looks.py): a whole setup -- the
      // layout and the screen's settings -- in one step; each Look's picture
      lookArt(l) {
        var h = this.h, W = window.hkWallpapers, wall = l.settings.sky_background === 'wallpaper' && W && W.url(l.settings.sky_wallpaper, false, l.settings.sky_wallpaper_color);
        var el = h('span', { class: 'lookart', 'aria-hidden': 'true' }, [h('i', {})]);
        el.style.backgroundImage = wall ? 'url("' + wall + '")' : 'linear-gradient(160deg,' + l.art[0] + ',' + l.art[1] + ' 55%,' + l.art[2] + ')';
        el.firstChild.style.background = l.art[3];
        return el;
      }
      lookGallery() {
        var h = this.h, K = this.K, M = window.hkSettingsModel;
        if (!M || !M.LOOKS) return null;
        return K.group({ header: 'Layout + Look', footer: 'A Look sets the layout and the screen’s look in one step: its style and colors, ' +
          'background, tiles, Side Pane, swiping and screensaver. Nothing is saved until you Save, and the screen’s Looks page can undo it.' },
          M.LOOKS.map((l) => h('button', { class: 'cell starter', type: 'button', 'data-look': l.id, 'aria-label': l.name + ', ' + l.about,
            onclick: () => this.useLook(l.id) }, [this.lookArt(l), h('span', { class: 'st' }, [h('b', { text: l.name }), h('small', { text: l.about })])])));
      }
      // the Look's layout on this screen: its first starter this screen type
      // has (HomeView-style, nightstand, or one of the house's, read from the
      // server), its cells the Look's
      async lookGrid(l) {
        // (a screen with no grid yet is the empty one's type; Tap Weight last of all)
        var grid = null, sq = SQUARE_STARTERS[screenTypeOf(this.grid || EMPTY)] || [];
        for (var key of l.layout.starters.concat(['A'])) {
          var a = sq.find((c) => c[0] === key);
          if (a) { grid = squareStarter(a, this.grid, this.squareHouse()); break; }
          var n = NIGHTSTAND.find((c) => c[0] === key);
          if (n && this.grid) { grid = Object.assign(copy(this.grid), { items: copy(n[3]) }); if (n[4]) grid.views = n[4]; else delete grid.views; break; }
          if (STARTERS.some((c) => c[0] === key)) {
            var got = this.starterGrids && this.starterGrids[key];
            if (!got) { try { got = (await this.panel.client.callWS({ type: 'hk_frontend/grid/starter', options: this.starterOptions(key) })).grid; } catch (e) { got = null; } }
            if (got) { grid = this.asScreen(copy(got)); break; }
          }
        }
        if (!grid) grid = copy(this.grid || EMPTY);
        if (l.layout.cell === 'square') grid.cell = 'square';
        else if (grid.screen !== 'square') delete grid.cell;
        return grid;
      }
      async useLook(id) {
        var M = window.hkSettingsModel, l = M.lookOf(id);
        if (!l || this.busy) return;
        if (!await this.K.confirm(this.shadowRoot, { title: 'Use the ' + l.name + ' Look?', message: 'Its layout replaces your draft, and Save also sets the ' +
          'screen’s look: ' + l.about + ' The screen’s Looks page can undo it.', ok: 'Use ' + l.name })) return;
        this.busy = true;
        try {
          var grid = await this.lookGrid(l), b = this.o.board || {};
          var saver = M.saverOptions(b.screensaver_options || ((this.panel.data.settings || {}).look || {}).saver);
          var r = M.lookChanges(l, b, saver, grid);
          delete r.changes.home_grid; delete r.changes.home_style;
          this.lookChange = r.changes; this.paneChange = null;
          ST.VIEW = 0; this.selected = null; this.change(grid);
          this.say('Save also sets ' + r.rows.length + (r.rows.length === 1 ? ' thing' : ' things') + ' on this screen: ' +
            r.rows.map((x) => x[0]).join(', ') + '.');
        } finally { this.busy = false; }
      }
      starterGallery() {
        var looks = this.lookGallery(), starters = this.starterGallery1();
        if (!looks) return starters;
        var box = this.h('div', {}, [looks, starters]);
        return box;
      }
      starterGallery1() {
        var h = this.h, K = this.K, waiting = !this.starterGrids;
        this.loadStarters();
        var kind = screenTypeOf(this.grid), night = kind === 'phone_landscape', square = this.squareStarters(), house = square.length ? this.squareHouse() : null;
        // (a Square screen: its own and Start Empty, as a nightstand; the others' HomeView-style ones first)
        var list = night ? NIGHTSTAND.concat([STARTERS[STARTERS.length - 1]]) : kind === 'square' ? square.concat([STARTERS[STARTERS.length - 1]]) : square.concat(STARTERS);
        var rows = list.map((c) => {
          var own = square.indexOf(c) >= 0;
          var grid = own ? squareStarter(c, this.grid, house)
            : this.asScreen(c[0] === 'empty' ? EMPTY : c[3] ? Object.assign(copy(this.grid), { items: copy(c[3]) }) : this.starterGrids && this.starterGrids[c[0]]);
          if (!waiting && !grid) return null;               // a starter that couldn't be read
          return h('button', { class: 'cell starter', type: 'button', 'data-starter': c[0], 'aria-label': c[1] + ', ' + c[2],
            onclick: () => this.starter(c[0]) }, [this.miniMap(grid, waiting && c[0] !== 'empty' && !own), h('span', { class: 'st' }, [h('b', { text: c[1] }), h('small', { text: c[2] })])]);
        });
        return K.group({ header: this.grid ? 'Start Over With' : 'Start With',
          footer: this.grid ? 'Replaces this draft. Nothing is saved until you Save.' :
            'Each fills the grid from your home’s scenes, rooms, cameras and thermostats. Nothing is saved until you Save.' }, rows);
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
    };
    KIT.install(Methods);
  };
})();
