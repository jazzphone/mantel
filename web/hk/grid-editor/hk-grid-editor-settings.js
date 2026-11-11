// hk-grid-editor-settings.js - the screen's settings and a block's settings.
//
// PART OF THE HOME GRID EDITOR (hk-grid-editor.js). Not a card and not run on its own: it registers one
// function, which hk-grid-editor.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridEditorParts = window.hkGridEditorParts || {})['hk-grid-editor-settings'] = function (KIT) {
    var cannotResize = KIT.cannotResize, COLS = KIT.COLS, copy = KIT.copy, fullColumns = KIT.fullColumns, G = KIT.G,
        GLYPHS = KIT.GLYPHS, NAMES = KIT.NAMES, offersSize = KIT.offersSize, place = KIT.place,
        RULE_MARK = KIT.RULE_MARK, scaleAt = KIT.scaleAt, SCREEN_TYPES = KIT.SCREEN_TYPES,
        screenTypeOf = KIT.screenTypeOf, SHOW = KIT.SHOW, SIZE_NAMES = KIT.SIZE_NAMES, SIZE_SHORT = KIT.SIZE_SHORT,
        SIZES = KIT.SIZES, SOURCE_HIDES = KIT.SOURCE_HIDES, ST = KIT.ST, TILE_CARDS = KIT.TILE_CARDS,
        valid = KIT.valid;

    // THE METHODS this part adds to GridEditor.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // ------------------------------------------------------------ the screen's settings
      screen() {
        var h = this.h, K = this.K, add = (n) => this.sidebar.appendChild(n);
        var starters = () => this.starterGallery();
        add(h('div', { class: 'insp-head' }, [h('hk-icon', { icon: 'mdi:tablet' }), h('div', {}, [h('h2', { text: 'Screen' }),
          h('p', { text: this.grid ? this.grid.items.length + (this.grid.items.length === 1 ? ' block' : ' blocks') + ' · select one to change it' : 'No layout yet' })])]));
        if (!this.grid) { add(starters()); return; }
        var config = (key, value) => { var next = copy(this.grid); next[key] = value; if (valid(next)) this.change(next);
          else { this.say('Move or remove the blocks that would be outside the new grid first.'); this.side(); } };
        var kind = screenTypeOf(this.grid), live = this.previewView && this.previewView.isConnected && this.previewView._gridScale;
        var pct = Math.round(100 * (live || scaleAt(this.grid, this.grid.frame)));
        var tip = kind === 'phone_landscape' ? ' On a phone on its side, set the screen’s Tab Bar Position to Left or Right, so the clock gets the height.'
          : kind === 'phone_portrait' ? ' Phones start without the top band: turn it on under Header if you want it.' : '';
        // VIEWS: whole layouts a swipe apart on this screen (StandBy's); the
        // grid and the preview show the one chosen here
        var views = this.grid.views || 1;
        if (ST.VIEW >= views) ST.VIEW = 0;
        var viewOpts = [];
        for (var vi = 0; vi < views; vi++) viewOpts.push([String(vi), String(vi + 1)]);
        if (views < 4) viewOpts.push(['add', '+']);
        var viewRows = [K.seg({ label: 'View', value: String(ST.VIEW), options: viewOpts, onChange: (v) => {
          if (v === 'add') { ST.VIEW = views; config('views', views + 1); return; }
          // (the outlines and the preview turn to the view; the frame itself is not reloaded)
          ST.VIEW = +v; this.selected = null; this.blocks(); this.side(); this.fit();
          // (and again once the preview's view has slid in: its cells place the outlines)
          setTimeout(() => this.fit(), 520);
        } })];
        if (views > 1) viewRows.push(K.button({ label: 'Remove View ' + (ST.VIEW + 1), destructive: true, onClick: () => this.removeView(ST.VIEW) }));
        add(K.group({ header: 'Views', footer: views > 1 ? 'Swipe sideways on the screen between its views. Each is a whole layout of its own on this grid.'
          : 'Add a view for a second layout a swipe away, as StandBy has.' }, viewRows));
        add(K.group({ header: 'Grid', footer: 'The grid scales to fit each screen; its blocks keep their shape. In this preview they show at ' + pct + '% of full size.' +
          ' Square cells are as tall as they are wide, as on a HomeView.' +
          (this.grid.cell === 'square' ? ' Up to ' + fullColumns(this.grid, this.o.board) + ' columns at full size here; more, and the cells get smaller.' : '') + tip }, [
          K.select({ label: 'Screen Type', value: kind, options: [['custom', 'Custom']].concat(SCREEN_TYPES.map((t) => [t[0], t[1] + ' · ' + t[2] + ' × ' + t[3]])),
            onChange: (k) => this.screenType(k) }),
          // CELL SHAPE (2026-10-30): every block stays where it is; only the cells change shape
          K.seg({ label: 'Cell Shape', value: this.grid.cell === 'square' ? 'square' : 'tile', options: [['tile', 'Tile'], ['square', 'Square']],
            onChange: (v) => this.cellShape(v) }),
          K.seg({ label: 'Columns', value: this.grid.cols, options: COLS.slice().reverse().map((n) => [n, String(n)]), onChange: (n) => this.columns(Number(n)) }),
          K.select({ label: 'Rows', value: this.grid.rows, options: [2, 3, 4, 5, 6].map((n) => [n, String(n)]), onChange: (n) => config('rows', Number(n)) }),
          K.toggle({ label: 'Show Boxes', sub: 'Off: every block straight on the background, as on a nightstand.', on: this.grid.boxes !== false, onChange: (on) => config('boxes', on) }),
          K.toggle({ label: 'Fill the Screen', sub: 'Lets the grid grow past its own size on a screen bigger than it.', on: this.grid.grow === true, onChange: (on) => config('grow', on) }),
          K.select({ label: 'Grid Scale', value: this.grid.scale || 100, options: [100, 90, 80, 70, 60, 50].map((n) => [n, n === 100 ? 'Automatic Fit' : n + '% of Fit']),
            onChange: (n) => config('scale', Number(n)) })]));
        // NIGHT MODE (2026-10-24): the screen one dim red at night, as StandBy and the screensaver's clock have it
        var night = this.grid.night || { mode: 'off', from: '22:00', to: '07:00' }, putNight = (patch) => config('night', Object.assign({ from: '22:00', to: '07:00' }, night, patch));
        var nightRows = [K.seg({ label: 'Night Mode', value: night.mode, options: [['off', 'Off'], ['night', 'At Night'], ['always', 'Always']], onChange: (m) => putNight({ mode: m }) })];
        if (night.mode === 'night') {
          nightRows.push(K.text({ label: 'From', type: 'time', value: night.from, onCommit: (v) => { if (/^\d\d:\d\d$/.test(v) && v !== night.to) putNight({ from: v }); else this.side(); } }));
          nightRows.push(K.text({ label: 'Until', type: 'time', value: night.to, onCommit: (v) => { if (/^\d\d:\d\d$/.test(v) && v !== night.from) putNight({ to: v }); else this.side(); } }));
        }
        add(K.group({ header: 'Night', footer: 'Everything on the screen one dim red, on black, while Home shows: for a bedroom or a nightstand.' }, nightRows));
        // THE SIDE PANE (2026-10-30): the screen's own page; the grid lays itself beside it
        if (this.panel.paneLink) add(K.group({ header: 'Side Pane', footer: 'A pane of sections beside Home (or every page): the grid lays itself in what it leaves. Save this layout first.' },
          [this.panel.paneLink(this.o.path, 'dash', 'grid:side_pane')]));
        add(K.group({ header: 'Header' }, [
          K.toggle({ label: 'Top Band', sub: 'The clock, weather and status chips', on: this.grid.band, onChange: (v) => config('band', v) })]));
        // ITS PARTS AND WHERE EACH SITS (2026-11-01, the owner: "the time on the Left, Chips in the Middle, and Weather on
        // the Right"): Shown in their order, left to right within a place; each row's own Left / Center / Right. A part
        // taken off the list is not shown. (The layout's `header`; before it, header_clock / header_weather.)
        if (this.grid.band) {
          var PARTS = { clock: ['Clock', 'mdi:clock'], weather: ['Weather', 'mdi:weather-partly-cloudy'], chips: ['Status Chips', 'mdi:label-multiple'] };
          var parts = Array.isArray(this.grid.header) ? this.grid.header.slice()
            : [{ k: 'clock', at: 'left' }, { k: 'weather', at: 'left' }, { k: 'chips', at: 'right' }].filter((p) =>
              !(p.k === 'clock' && this.grid.header_clock === false) && !(p.k === 'weather' && this.grid.header_weather === false));
          var putParts = (list) => {
            var next = copy(this.grid);
            next.header = list;
            delete next.header_clock; delete next.header_weather;
            this.change(next);
          };
          var atOf = (k) => (parts.filter((p) => p.k === k)[0] || {}).at || (k === 'chips' ? 'right' : 'left');
          var placeCtl = (k) => K.popup({ label: PARTS[k][0] + ' place', value: atOf(k), fk: 'band:' + k,
            options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
            onChange: (v) => putParts(parts.map((p) => p.k === k ? { k: k, at: v } : p)) });
          add(K.listEditor({ fk: 'band-parts', announce: this.say ? this.say.bind(this) : null,
            shownHeader: 'In the Band', moreHeader: 'Not Shown',
            shownFooter: 'Each part on the left, in the center or on the right; this order is their order left to right where they share a place.',
            rows: parts.map((p) => ({ value: p.k, label: PARTS[p.k][0], icon: PARTS[p.k][1], control: placeCtl(p.k) })),
            more: Object.keys(PARTS).filter((k) => !parts.some((p) => p.k === k)).map((k) => ({ value: k, label: PARTS[k][0], icon: PARTS[k][1] })),
            onChange: (values) => putParts(values.map((k) => ({ k: k, at: atOf(k) }))) }));
        }
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
            var historyRows = this.histories.map((row) => K.button({ label: 'Version ' + row.version + ' · ' + new Date(row.created * 1000).toLocaleString() + ' · ' +
              (row.actor_name || row.actor || row.source || 'Unknown'), onClick: () => this.restore(row) }));
            add(K.group({ header: 'Earlier Layouts', footer: historyRows.length ? 'A version becomes your draft. Save to restore its layout only.' : 'No earlier layouts.' }, historyRows));
          }
          var targets = this.panel.data.dashboards.filter((d) => d.item && d.generated && d.path !== this.o.path && this.panel.data.boards[d.path]);
          if (targets.length) add(K.group({ header: 'Copy Layout To…' }, [K.select(
            { label: 'Screen', value: '', options: [['', 'Choose Screen']].concat(targets.map((d) => [d.path, d.title])), onChange: (path) => this.copyTo(path) })]));
        }
      }

      // ------------------------------------------------------------ a block's settings
      inspect(item) {
        var h = this.h, K = this.K, add = (n) => this.sidebar.appendChild(n), rules = item.rules || [], at = this.editingOf(item), card = this.variantOf(item, at);
        add(h('div', { class: 'insp-head' }, [h('hk-icon', { icon: GLYPHS[card.card] }), h('div', {}, [h('h2', { text: NAMES[card.card] }),
          h('p', { text: SIZE_NAMES[item.size] + ' · column ' + (item.at[0] + 1) + ', row ' + (item.at[1] + 1) })]),
          h('button', { class: 'done', type: 'button', text: 'Done', onclick: () => this.select(null) })]));
        var sizes = G.table()[item.card].sizes.filter((sz) => SIZES[sz][0] <= this.grid.cols && SIZES[sz][1] <= this.grid.rows && offersSize(item.card, sz, item.opts));
        var rows = [];
        if (sizes.length > 1) rows.push(K.seg({ label: 'Size', value: item.size, options: sizes.map((sz) => [sz, SIZE_SHORT[sz]]), onChange: (sz) => this.resize(item, sz) }));
        if (rules.length) rows.push(K.select({ label: 'Settings For', value: String(at),
          options: [['-1', NAMES[item.card] + ' (Default)']].concat(rules.map((r, i) => [String(i), NAMES[r.card] + ' (Rule ' + (i + 1) + ')'])),
          onChange: (v) => this.editCard(Number(v)) }));
        rows.push(K.button({ label: 'Change Card…', onClick: () => this.pickFor(at < 0 ? 'primary' : 'rule:' + at) }));
        add(K.group({ footer: rules.length ? 'Each of this block’s cards has its own settings. The one you choose shows in the preview.' : '' }, rows));
        this.content(card);
        this.appearance(item, card);
        this.conditions(item);
        this.sheetGroup(item);
        add(K.group({}, [K.button({ label: 'Duplicate Block', onClick: () => this.duplicate(item.id) }),
                         K.button({ label: 'Remove Block', destructive: true, onClick: () => this.remove(item.id) })]));
      }
      // A BLOCK WITH RULES IS SEVERAL CARDS IN ONE PLACE (2026-11-05, the owner, of Music with Now Playing while it plays:
      // the panel opened on Music, whatever was on screen, with the other card's options down inside its rule, and the
      // Appearance of none). So the panel sets ONE of them at a time, with every option a block's own card has: the card on
      // screen when the block is chosen, then whichever Settings For says. -1 the block's own card, else a rule.
      editingOf(item) {
        var n = (item.rules || []).length;
        if (!n) return -1;
        if (this.editing == null) this.editing = this.onScreen(item);
        if (this.editing >= n) this.editing = -1;
        return this.editing;
      }
      // what the preview shows in the block now (hk-layout.js hk-grid-conditional-card)
      onScreen(item) {
        if (typeof this.conditionPreview === 'number') return this.conditionPreview;
        var card = this.previewView && (this.previewView.cards || []).find((c) => c.localName === 'hk-grid-conditional-card' && c._config && c._config.item && c._config.item.id === item.id);
        try { return card ? card._shown() : -1; } catch (e) { return -1; }
      }
      editCard(at) { this.editing = at; this.conditionPreview = at; this.preview(); this.side(); }
      // the card being set, as a block: what `content` reads. A rule's id says where update() writes.
      variantOf(item, at) {
        if (at < 0) return item;
        var r = item.rules[at];
        return { id: item.id + RULE_MARK + at, card: r.card, size: item.size, at: item.at, opts: r.opts, pages: r.pages };
      }
      resize(item, sz) {
        var no = cannotResize(item, sz);
        if (no) { this.say(no); this.side(); return; }
        var next = place(this.grid, item.id, item.at, sz);
        if (next && sz === 'C' && item.card === 'security') {
          var moved = next.items.find((x) => x.id === item.id);
          moved.opts = Object.assign({}, moved.opts, { presentation: 'homeview' });
        }
        if (next) this.change(next); else { this.say('A ' + SIZE_NAMES[sz] + ' block doesn’t fit here. Make room around it first.'); this.side(); }
      }
      // WHAT THE BLOCK SHOWS: one thing or pages that swipe, then the options that apply
      content(item) {
        var K = this.K, cat = G.table()[item.card], add = (n) => this.sidebar.appendChild(n);
        var src = item.pages && item.pages.source || '', words = SHOW[item.card] || [], rows = [], footer = null;
        var show = item.card === 'accessories' ? [['accessories', words[1]], ['list', 'Choose Each Page']]
          : [['', words[0] || 'One Page']].concat(cat.sources.map((s) => [s, words[1] || 'Swipe All']), [['list', 'Choose Each Page']]);
        // a camera block may follow: swipe all cameras, turning to the one motion or a selector picks
        var follows = item.card === 'camera' && src === 'cameras' && !!(item.opts || {}).follow;
        if (item.card === 'camera') show.splice(2, 0, ['follow', 'Follow Motion or a Selector']);
        if (item.card !== 'swipe') rows.push(K.select({ label: 'Show', value: follows ? 'follow' : src, options: show, onChange: (s) => this.setShow(item, s) }));   // (a Swipe's pages are its own)
        var hide = { follow: 1, follow_select: 1 };
        if (follows) this.followRows(item, rows);
        if (SOURCE_HIDES[src]) hide[SOURCE_HIDES[src]] = 1;
        if (item.card === 'room' && src === 'rooms') rows.push(this.startingRoom(item));
        if (src === 'thermostats') rows.push(K.toggle({ label: 'Start on Tablet’s Room', on: item.pages.start === 'tablet_room', onChange: (on) => {
          var p = copy(item.pages); if (on) p.start = 'tablet_room'; else delete p.start; this.update(item.id, { pages: p });
        } }));
        rows = rows.concat(this.fields(item.card, item.opts || {}, (opts) => this.update(item.id, { opts: opts }), { hide: hide, size: item.size, list: src === 'list' }));
        if (item.card === 'room') footer = this.roomNote(item, src);
        else if (item.card === 'music' && !src) footer = this.musicNote(item);
        else if (src === 'list') footer = 'Each page repeats this card with its own choices. A choice left on Same as the Block uses the block’s.';
        else if (item.card === 'accessories') footer = 'Each page holds ' + G.PER_PAGE[item.size] + ' at this size; more make more pages.';
        else if (item.card === 'camera' && src === 'cameras' && (item.opts || {}).follow) footer = (item.opts.follow === 'motion'
          ? 'Shows the camera in the room where motion was seen last (each camera with the motion sensors in its own room).'
          : 'Shows the camera the selector picks: an option names a camera by its name.') + ' Swipe for the others; it follows again a minute after you stop.';
        else if (src) footer = 'Swipe sideways on the block to change pages. It goes back to its first page when the screen goes idle.';
        add(K.group({ header: 'Content', footer: footer }, rows));
        if (src === 'list') this.pages(item);
      }
      // APPEARANCE: the block's box and its tile style are the place's, whichever card shows there; a group's own
      // background is the card's. `card` is the card being set (a block's own, or a rule's: variantOf).
      appearance(item, card) {
        var K = this.K, cat = G.table()[card.card], add = (n) => this.sidebar.appendChild(n);
        // HIDE BOX (2026-10-24): any block's card without its box; the screen's Show Boxes off hides every one
        // (a clock saved with its own Hide Box option moves to the block's)
        var noBoxes = this.grid.boxes === false, ownBare = item.card === 'clock' && (item.opts || {}).bare;
        var look = [K.toggle({ label: 'Hide Box', on: noBoxes || !!item.bare || !!ownBare, disabled: noBoxes,
          sub: noBoxes ? 'The screen hides every block’s box (Screen → Show Boxes).' : 'The card straight on the background, without its box.',
          onChange: (on) => { var patch = { bare: on || null }; if (ownBare) { var o = copy(item.opts); delete o.bare; patch.opts = o; } this.update(item.id, patch); } })];
        if (cat.opts && cat.opts.surface) this.surfaceFields((card.opts || {}).surface,
          (value) => { var o = copy(card.opts || {}); if (value) o.surface = value; else delete o.surface; this.update(card.id, { opts: o }); }, look);
        // TILE STYLE (2026-10-30): a tile block's own, else the screen's (HK Settings → the screen → Appearance)
        if (TILE_CARDS.indexOf(card.card) >= 0) look.push(K.seg({ label: 'Tile Style', value: item.tile || '', options: [['', 'Same as Screen'], ['home', 'Home'], ['centred', 'Centered']],
          onChange: (v) => this.update(item.id, { tile: v || null }) }));
        add(K.group({ header: 'Appearance', footer: cat.opts && cat.opts.surface ? 'A custom background changes only the group’s own; its tiles keep the screen’s look.'
          : TILE_CARDS.indexOf(card.card) >= 0 ? 'Centered puts the icon above the name and room, as on a HomeView.' : '' }, look));
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
        var o = copy(item.opts || {});
        if (s === 'follow') { o.follow = o.follow || 'motion'; this.update(item.id, { opts: o, pages: { source: 'cameras' } }); return; }
        delete o.follow; delete o.follow_select;
        this.update(item.id, { opts: o, pages: s ? s === 'list' ? { source: 'list', list: [{ opts: {} }, { opts: {} }] } : { source: s } : null });
      }
      // WHAT A FOLLOWING CAMERA BLOCK FOLLOWS: motion in each camera's room, or a
      // selector (its own, else the screen's Live Camera Follows)
      followRows(item, rows) {
        var K = this.K, o = item.opts || {}, put = (patch) => { var n = Object.assign(copy(o), patch); Object.keys(patch).forEach((k) => { if (patch[k] == null) delete n[k]; });
          this.update(item.id, { opts: n }); };
        rows.push(K.seg({ label: 'Follow', value: o.follow, options: [['motion', 'Motion'], ['selector', 'A Selector']],
          onChange: (v) => put({ follow: v, follow_select: v === 'motion' ? null : o.follow_select }) }));
        if (o.follow === 'selector') {
          var board = this.o.board || {}, here = board.camera_live;
          rows.push(K.select({ label: 'Selector', value: o.follow_select || '', onChange: (v) => put({ follow_select: v || null }),
            options: [['', here ? 'The Screen’s Live Camera Follows' : 'The Screen’s (None Set)']].concat(this.choices('select')) }));
        }
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
      // WHAT A MUSIC BLOCK SHOWS, plainly (its Shows option's footnote)
      musicNote(item) {
        var o = item.opts || {}, sp = o.speaker && this.musicSpeakers().filter((s) => s.entity === o.speaker)[0];
        var tap = o.speaker ? ' A tap on one plays it on ' + (sp ? sp.name : o.speaker) + '.' : ' A tap on one plays it on this screen’s speakers.';
        if (o.show === 'presets') return 'Shows the Music page’s playlists as tiles; a playlist with choices (Decades) shows each choice.' + tap;
        if (o.show === 'playlist') return 'Shows one playlist: ' + (o.playlist || (this.musicPlaylists()[0] || {}).name || 'the first one you set up') + '. If it has choices, each is a tile.' + tap;
        return 'Shows what played last, and covers to play again.' + tap;
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
          rows.push(K.button({ label: 'Move Up', disabled: i === 0, onClick: () => { var p = copy(item.pages); p.list.splice(i - 1, 0, p.list.splice(i, 1)[0]); this.update(item.id, { pages: p });
            } }));
          rows.push(K.button({ label: 'Remove Page', destructive: true, disabled: n === 1, onClick: () => { var p = copy(item.pages); p.list.splice(i, 1); this.update(item.id, { pages: p }); } }));
          add(K.group({ header: 'Page ' + (i + 1) + ' of ' + n }, rows));
        });
        add(K.group({}, [K.button({ label: 'Add Page', disabled: n >= G.PAGES_MAX, onClick: () => { var p = copy(item.pages); p.list.push({ opts: {} }); this.update(item.id, { pages: p }); } })]));
      }
    };
    KIT.install(Methods);
  };
})();
