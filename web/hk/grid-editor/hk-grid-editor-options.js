// hk-grid-editor-options.js - a card's options as rows, the house's scenes, the preview and saving.
//
// PART OF THE HOME GRID EDITOR (hk-grid-editor.js). Not a card and not run on its own: it registers one
// function, which hk-grid-editor.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkGridEditorParts = window.hkGridEditorParts || {})['hk-grid-editor-options'] = function (KIT) {
    var copy = KIT.copy, G = KIT.G, keepVersion = KIT.keepVersion, KIND_LABELS = KIT.KIND_LABELS, listOf = KIT.listOf,
        MAP_SUB = KIT.MAP_SUB, NAME_LABELS = KIT.NAME_LABELS, valid = KIT.valid;

    // THE METHODS this part adds to GridEditor.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // A CARD'S OPTIONS AS ROWS. o: { page (a Choose Each Page page: an
      // option left empty uses the block's), base (the block's own options,
      // for a page), hide {name: 1}, size, list (the block has custom pages) }
      fields(card, opts, save, o) {
        var K = this.K, self = this, kinds = G.table()[card].opts || {}, rows = [], hide = o.hide || {};
        var set = (key, value) => { var out = copy(opts); if (value === '' || value == null) delete out[key]; else out[key] = value; save(out); };
        // (an Alert's, a TV's, a Swipe's rows: hk-grid-catalog.js)
        if (['alert', 'tv', 'swipe'].indexOf(card) >= 0) return rows.concat(G[card].rows(K, opts, set, (k) => self.choices(k), self.panel.client,
          { size: o.size, fields: (c, v, sv) => self.fields(c, v, sv, { size: o.size, hide: { tap: 1 } }) }));
        Object.keys(kinds).forEach(function (key) {
          if (hide[key]) return;
          var kind = kinds[key], label = KIND_LABELS[kind] || NAME_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
          if (kind === 'surface') return;                                         // Appearance, its own group
          if (card === 'clock' && key === 'bare') return;                         // Appearance's Hide Box
          if (card === 'room' && key === 'area' && o.list && !o.page) label = 'Default Room';
          if (kind === 'room_display') {
            if (o.page) return;
            rows.push(K.seg({ label: 'Accessories', value: opts[key] || 'summary', options: [['summary', 'Summary'], ['scroll', 'Scroll All']],
              onChange: (v) => set(key, v === 'summary' ? null : v) }));
            return;
          }
          if (kind === 'title') { rows.push(K.text({ label: o.page ? 'Page Name' : 'Group Name', value: opts[key] || '', maxlength: 60, placeholder: o.page ? '' : 'Accessories',
            onCommit: (v) => set(key, v.trim() || null) })); return; }
          if (kind === 'secondary') { self.secondaryFields(opts[key], opts.entity || (o.base || {}).entity, (v) => set(key, v), rows); return; }
          if (kind === 'accessories') { if (!(o.list && !o.page)) self.accessoryFields(opts[key] || [], (v) => set(key, v), rows, o.page ? G.PER_PAGE[o.size] : 24); return; }
          if (kind === 'boolean') { rows.push(K.toggle({ label: label, sub: card === 'people' && key === 'map' ? MAP_SUB : undefined, on: opts[key] === true,
            onChange: (on) => set(key, on || null) })); return; }
          if (kind === 'windows') { self.windows(opts, set, rows); return; }
          if (kind === 'clock_style') {
            rows.push(K.select({ label: 'Style', value: opts[key] || '', options: G.CLOCK_FACES, onChange: (v) => set(key, v || null) }));
            return;
          }
          // THE CAMERAS FACE: how often its stills refresh (s), and which cameras -- none ticked: all of them
          if (kind === 'refresh') {
            rows.push(K.select({ label: 'Refresh', value: String(opts[key] || 10), options: [5, 10, 15, 20, 30, 60].map((n) => [String(n), 'Every ' + n + ' Seconds']),
              onChange: (v) => set(key, +v === 10 ? null : +v) }));
            return;
          }
          // a thermostat's Style: the dial or Big Number, Tall and Large (Extra Large is its sheet)
          if (kind === 'thermostat_style') {
            if (o.page || o.size === 'XL') return;
            rows.push(K.seg({ label: 'Style', value: opts[key] || 'dial', options: G.THERMOSTAT_STYLES, onChange: (v) => set(key, v === 'dial' ? null : v) }));
            return;
          }
          // SCENES AND ACCESSORIES (2026-10-31): Full or Half height, glass or Color; an Energy Rings block's period
          if (kind === 'tile_height') {
            // (none for Security: its locks are a list of rows since 2026-11-08's redraw)
            var dflt = 'full';
            if (card === 'security') return;
            rows.push(K.seg({ label: 'Height', value: opts[key] || dflt, options: [['full', 'Full'], ['half', 'Half']], onChange: (v) => set(key, v === dflt ? null : v) }));
            return;
          }
          // A CAMERA'S NAME at its foot (2026-10-31): Automatic (on a tile cell, not HomeView's square ones), Show, Hide
          if (kind === 'name_tag') {
            rows.push(K.seg({ label: 'Name', value: opts[key] || 'auto', options: [['auto', 'Automatic'], ['show', 'Show'], ['hide', 'Hide']], onChange: (v) => set(key, v === 'auto' ? null : v) }));
            return;
          }
          if (kind === 'period') {
            rows.push(K.seg({ label: 'Period', value: opts[key] || 'day', options: [['day', 'Today'], ['week', 'Week'], ['month', 'Month']], onChange: (v) => set(key, v === 'day' ? null : v) }));
            return;
          }
          // WHEN TAPPED (2026-10-31, the owner on 0.1.94), as the Side Pane's: a tap on the block's plate opens its page or
          // its detail sheet, whichever the screen has, or neither; the controls in the block keep their own taps
          if (kind === 'tap_target') {
            rows.push(K.seg({ label: 'When Tapped', value: opts[key] || 'auto', options: G.TAP_TARGETS, onChange: (v) => set(key, v === 'auto' ? null : v) }));
            return;
          }
          // ...a Music block's, with Choose a Playlist (2026-11-01, the owner): five, so a list rather than a segment
          if (kind === 'music_tap') {
            rows.push(K.select({ label: 'When Tapped', value: opts[key] || 'auto', options: G.MUSIC_TAPS, onChange: (v) => set(key, v === 'auto' ? null : v) }));
            return;
          }
          // ON NOW'S CATEGORIES (2026-11-08, the owner: "either show a pop up or go to those pages... users decisions")
          if (kind === 'on_now_open') {
            if (o.size === 'S') return;
            rows.push(K.seg({ label: 'Categories', value: opts[key] || 'sheet', options: [['sheet', 'Show a Sheet'], ['page', 'Go to Its Page']],
              onChange: (v) => set(key, v === 'sheet' ? null : v) }));
            return;
          }
          // EVERYTHING'S REST (2026-11-08, the owner: "scroll within the card or go to the page with the + button")
          if (kind === 'everything_more') {
            if (o.size === 'S') return;
            rows.push(K.seg({ label: 'More Places', value: opts[key] || 'page', options: [['page', '+ Opens the Page'], ['scroll', 'Scroll in the Block']],
              onChange: (v) => set(key, v === 'page' ? null : v) }));
            return;
          }
          // NOW PLAYING'S BACKGROUND (2026-11-05, the owner): the blurred album, or the plate every other block has
          if (kind === 'np_background') {
            rows.push(K.seg({ label: 'Background', value: opts[key] || 'album', options: [['album', 'Blurred Album'], ['card', 'Card']], onChange: (v) => set(key, v === 'album' ? null : v) }));
            return;
          }
          // A MUSIC BLOCK'S SHOW (2026-10-31, the owner): Recently Played, the Music page's playlists, or one of them, chosen from
          // the house's (as the Music page reads them); the Content footnote says what the block shows
          if (kind === 'music_show') {
            rows.push(K.select({ label: 'Shows', value: opts[key] || 'recent', options: [['recent', 'Recently Played'], ['presets', 'Playlists'], ['playlist', 'One Playlist']],
              onChange: (v) => set(key, v === 'recent' ? null : v) }));
            return;
          }
          // RECENT'S SHOW (2026-11-03): Automatic is the morning summary from 5 to 11 AM and the latest events after
          if (kind === 'timeline_show') {
            rows.push(K.select({ label: 'Shows', value: opts[key] || 'auto', options: [['auto', 'Automatic'], ['latest', 'Latest Events'], ['digest', 'Morning Summary']],
              onChange: (v) => set(key, v === 'auto' ? null : v) }));
            rows.push(K.info({ label: 'Automatic shows how the night went from 5 to 11 AM, then the latest events.' }));
            return;
          }
          if (kind === 'music_playlist') {
            if (opts.show !== 'playlist') return;
            var pls = self.musicPlaylists().map((p) => [p.name, p.name]);
            if (opts[key] && !pls.some((op) => op[0] === opts[key])) pls.push([opts[key], opts[key] + ' (Unavailable)']);
            rows.push(K.select({ label: 'Playlist', value: opts[key] || (pls[0] || [''])[0], options: pls.length ? pls : [['', 'None Set Up']], onChange: (v) => set(key, v) }));
            return;
          }
          // WHERE IT PLAYS (2026-10-31, the owner: "what HomePod or HomePod Group we want it to play on ... like a quick
          // action"): Automatic -- this screen's music, as the Music page has it -- or one speaker, or a speaker group
          if (kind === 'music_speaker') {
            // (the house's speakers as the preview has them -- this page has no music of its own: musicPlaylists)
            var sps = self.musicSpeakers(), gp = sps.filter((s) => !!s.members), rm = sps.filter((s) => !s.members);
            var sp = [['', 'Automatic']].concat(gp.map((g) => [g.entity, g.name + ' (Group)']), rm.map((r) => [r.entity, r.name]));
            if (opts[key] && !sp.some((op) => op[0] === opts[key])) sp.push([opts[key], opts[key] + ' (Unavailable)']);
            rows.push(K.select({ label: 'Plays On', value: opts[key] || '', options: sp, onChange: (v) => set(key, v || null) }));
            return;
          }
          // A LIVE TV BLOCK'S CHANNEL (2026-10-31, the owner): Automatic (the guide's first, as many as the size holds) or one
          // of the guide's, asked of the house (hk_tv/channels) the first time a block shows this row
          if (kind === 'tv_channel') {
            var guide = self.tvChannels();
            var tv = [['', 'Automatic']].concat(guide.map((c) => [c.number, c.number + ' ' + (c.name || '')]));
            if (opts[key] && !tv.some((op) => op[0] === opts[key])) tv.push([opts[key], opts[key] + ' (Unavailable)']);
            rows.push(K.select({ label: 'Channel', value: opts[key] || '', options: tv, onChange: (v) => set(key, v) }));
            return;
          }
          // SECURITY'S PRESENTATION (2026-11-07): Classic, the block as it always was (its keypads), or HomeView's five
          // compositions -- Compact is HomeView's alone, so a Compact block keeps it
          if (kind === 'security_presentation') {
            rows.push(K.seg({ label: 'Presentation', value: opts[key] || '', options: [['', 'Classic'], ['homeview', 'HomeView']],
              onChange: (v) => { if (!v && o.size === 'C') { self.say('Compact is HomeView’s. Choose another size first.'); self.side(); return; } set(key, v || null); } }));
            return;
          }
          // LIGHT UP WHEN ARMED (2026-11-09, the owner): on unless the option is false -- so Off is what is stored
          if (kind === 'security_lit') {
            if (opts.presentation !== 'homeview') return;
            rows.push(K.toggle({ label: 'Light Up When Armed', sub: 'The alarm turns white while it is armed, red if it goes off. The locks beside it stay on the glass.',
              on: opts[key] !== false, onChange: (on) => set(key, on ? null : false) }));
            return;
          }
          // ...and HomeView's entries: Automatic (the house's locks, then its garage doors) or the ones chosen, in order
          if (kind === 'security_members') {
            if (opts.presentation !== 'homeview') return;
            // (its locks and garage doors, as Automatic's -- not every blind and a car's charge port; and Choose starts from what
            // Automatic shows, the house's lists, not the first six by name -- 2026-11-08, the owner's Kitchen block)
            var st = (self.panel.client && self.panel.client.states) || {}, HS = window.hkSettings;
            var garageish = (id) => /^cover\./.test(id) && st[id] && ['garage', 'gate'].includes((st[id].attributes || {}).device_class);
            var mem = opts[key] || [], doors = self.choices('entity').filter((op) => /^lock\./.test(op[0]) || garageish(op[0]) || mem.includes(op[0]));
            var house = () => {
              var l = HS && HS.get ? HS.get('kinds.locks', null) : null, g = HS && HS.get ? HS.get('kinds.garage', null) : null;
              var auto = (Array.isArray(l) && l.length ? l : doors.map((op) => op[0]).filter((id) => /^lock\./.test(id)))
                .concat(Array.isArray(g) && g.length ? g : doors.map((op) => op[0]).filter(garageish));
              return auto.filter((id) => st[id]).slice(0, G.SHEET.max);
            };
            rows.push(K.seg({ label: 'Entries', value: mem.length ? 'chosen' : '', options: [['', 'Automatic'], ['chosen', 'Choose']],
              onChange: (v) => set(key, v ? house() : null) }));
            if (!mem.length) { rows.push(K.info({ label: 'The house’s locks, then its garage doors' })); return; }
            mem.forEach((id, i) => {
              var nm = (doors.find((op) => op[0] === id) || [id, id + ' (Unavailable)'])[1];
              rows.push(K.info({ label: (i + 1) + '. ' + nm }));
              rows.push(K.button({ label: 'Move ' + nm + ' Up', disabled: i === 0, onClick: () => { var n2 = mem.slice(); n2.splice(i - 1, 0, n2.splice(i, 1)[0]); set(key, n2); } }));
              rows.push(K.button({ label: 'Remove ' + nm, destructive: true, onClick: () => { var n2 = mem.filter((x, j) => j !== i); set(key, n2.length ? n2 : null); } }));
            });
            var left = doors.filter((op) => mem.indexOf(op[0]) < 0);
            if (mem.length < G.SHEET.max && left.length) rows.push(K.select({ label: 'Add Entry', value: '', options: [['', 'Choose…']].concat(left),
              onChange: (v) => { if (v) set(key, mem.concat([v])); } }));
            return;
          }
          if (kind === 'days') {
            rows.push(K.select({ label: 'Days', value: String(opts[key] || 2), options: [1, 2, 3, 4, 5, 6, 7].map(
              (n) => [String(n), n === 1 ? 'Today Only' : n === 2 ? 'Today and Tomorrow' : n + ' Days']),
              onChange: (v) => set(key, +v === 2 ? null : +v) }));
            return;
          }
          var choices = self.choices(kind).filter((op) => kind !== 'speaker' || op[0] !== 'tablet_room');
          if (card === 'scene' && kind === 'scene') { var sids = self.sceneIds(); choices = choices.filter((op) => sids.indexOf(op[0]) >= 0); }
          if (kind === 'cameras' && !(opts[key] || []).length) rows.push(K.info({ label: 'All Cameras, in the Cameras page’s order. Tick some to choose.' }));
          if (kind === 'scenes' || kind === 'calendars' || kind === 'cameras') {
            choices.forEach((op) => rows.push(K.check({ label: op[1], multi: true, on: (opts[key] || []).indexOf(op[0]) >= 0, onClick: (on) => {
              var list = (opts[key] || []).filter((v) => v !== op[0]); if (on) list.push(op[0]);
              if (list.length > 24) { self.say('At most 24 in a list.'); return; } set(key, list.length ? list : null);
            } })));
            return;
          }
          var auto = o.page ? 'Same as the Block' : card === 'camera' ? 'First Camera' : card === 'room' ? 'Tablet’s Room' : 'Automatic';
          var all = card === 'room' && key === 'area' && !o.page ? choices : [['', auto]].concat(choices);
          if (opts[key] && opts[key] !== 'tablet_room' && !all.some((op) => op[0] === opts[key])) all.push([opts[key], opts[key] + (kind === 'speaker' ? ' (Not a Music Speaker)' : ' (Unavailable)')]);
          rows.push(K.select({ label: label, value: (kind === 'speaker' && opts[key] === 'tablet_room' ? '' : opts[key]) || (card === 'room' && key === 'area' && !o.page ? 'tablet_room' : ''),
            options: all, onChange: (v) => set(key, v) }));
        });
        // HOUSE STATUS has no options of its own: it is the screen's status chips (hk-house-status.js)
        if (card === 'house_status' && !o.page) {
          rows.push(K.info({ label: 'Shows this screen’s status chips, in their order', sub: 'Choose them, and Always or When Active, in the screen’s Status Chips.' }));
        }
        return rows;
      }
      secondaryFields(value, entity, save, rows) {
        var K = this.K, mode = value && value.mode || 'auto';
        var a = (this.panel.client.states[entity] || {}).attributes || {};
        var keys = Object.keys(a).filter((k) => a[k] == null || ['string', 'number', 'boolean'].includes(typeof a[k])).sort();
        var options = keys.map((k) => [k, k.replace(/_/g, ' ')]);
        rows.push(K.select({ label: 'Line Under Name', value: mode, options: [['auto', 'Automatic'], ['state', 'State'], ['brightness', 'Brightness'], ['attribute', 'An Attribute'],
          ['none', 'Hidden']],
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
        rows.push(K.select({ label: 'Background Blur', value: surface.blur, options: [['screen', 'Follow Screen'], ['none', 'None'], ['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']],
          onChange: (v) => put('blur', v) }));
      }
      // the house's playlists, as the Music page reads them (hkMusic.playlists(), the screen's copy in the preview): the
      // list fills in once the house has answered
      musicPlaylists() {
        var w = (this.iframe && this.iframe.contentWindow) || window, Mu = w.hkMusic, self = this;
        if (Mu && Mu.onChange && !this._muOff) this._muOff = Mu.onChange(function () { if (self.isConnected && self.selected) self.side(); });
        return Mu && Mu.playlists ? Mu.playlists() : [];
      }
      // the house's speakers and speaker groups ({entity, name, members?}), from the same place
      musicSpeakers() {
        this.musicPlaylists();
        var w = (this.iframe && this.iframe.contentWindow) || window, Mu = w.hkMusic;
        return Mu && Mu.speakers ? Mu.speakers() : [];
      }
      // the guide's channels, [{number, name}], read once (the row fills in when they arrive)
      tvChannels() {
        var self = this;
        if (!this._tv) {
          this._tv = [];
          var c = this.panel.client;
          if (c && c.callWS) Promise.resolve(c.callWS({ type: 'hk_tv/channels' })).then(function (r) {
            self._tv = (r && r.channels) || [];
            if (self.isConnected && self.selected) self.side();
          }, function () { /* not set up: Automatic only */ });
        }
        return this._tv;
      }
      // THE HOUSE'S SCENES (Accessories -> Scenes): HA's and the buttons and scripts added as one; before the counts load, HA's
      sceneIds() { var st = this.panel.client.states || {}, ck = ((this.panel.data || {}).counts || {}).scenes; return ck && Array.isArray(ck.found) ? ck.found.filter((id) => !!st[id]) :
        Object.keys(st).filter((id) => id.indexOf('scene.') === 0); }
      choices(kind) {
        var client = this.panel.client, states = client.states || {};
        if (kind === 'scene' || kind === 'scenes' || kind === 'action') {   // a scene block, a Scenes block: the house's scenes; a window, an Action: and every script
          var ids = this.sceneIds(), sl = ids.concat(kind === 'scenes' ? [] : Object.keys(states).filter((id) => id.indexOf('script.') === 0 && ids.indexOf(id) < 0))
            .map((id) => [id, (states[id].attributes || {}).friendly_name || id]).sort((a, b) => a[1].localeCompare(b[1]));
          return kind === 'action' ? [['lock_up', 'Lock Up'], ['lights_off', 'All Lights Off'], ['garage', 'Garage']].concat(sl) : sl;
        }
        if (kind === 'tv_target') return G.tv.choices(client); if (kind === 'area') return [['tablet_room', 'Tablet’s Room']].concat(
          Object.keys(client.areas || {}).map((id) => [id, client.areas[id].name || id]));
        if (kind === 'speaker') return G.speakerChoices(this.musicSpeakers());   // (2026-11-10: music rooms and groups, never a TV)
        var domains = { speaker: ['media_player'], climate: ['climate'], camera: ['camera'],
          timer: ['timer'], alarm: ['alarm_control_panel'], select: ['input_select', 'select'], doorbell: ['binary_sensor', 'camera'], weather: ['weather'], vacuum: ['vacuum'],
            calendars: ['calendar'],
          cameras: ['camera'], todo: ['todo'] }[kind];
        var list = Object.keys(states).filter((id) => !domains || domains.indexOf(id.split('.')[0]) >= 0).map((id) => [id, (states[id].attributes || {}).friendly_name || id]);
        list.sort((a, b) => a[1].localeCompare(b[1]));
        if (kind === 'climate') list.unshift(['tablet_room', 'Tablet’s Room']);
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
          // WHAT IT IS WAITING FOR, said once it is slow (data-why), so a screen
          // that never gets there says where it stopped
          var wait = function (why) { var err = new Error('loading'); err.why = why; throw err; };
          if (!w || !w.document || w.document.readyState === 'loading') wait('the screen to load');
          if (!w.hkStrategy || !w.hkCards) wait('the screen’s code');
          if (!w.hkShell || !w.hkShell.view()) wait('the screen’s page');
          var serial = this.previewSerial = (this.previewSerial || 0) + 1;
          var client = w.hkCards.client(), draft = copy(this.grid);
          var selected = draft.items.find((it) => it.id === this.selected);
          if (selected && (selected.rules || selected.when) && typeof this.conditionPreview === 'number') selected._conditionPreview = this.conditionPreview;
          if (!client || !client.states) wait('the home’s accessories');
          var config = await w.hkStrategy.generate({ home_grid_preview: draft }, client);
          if (serial !== this.previewSerial || !this.isConnected) return;
          var old = this.previewView && this.previewView.isConnected ? this.previewView : w.hkShell.view(), cfg = config.views.find((v) => v.path === 'home');
          if (!cfg) wait('a Home page (this screen has ' + config.views.map((v) => v.path).join(', ') + ')');
          if (cfg.type !== 'custom:hk-home-grid-view') wait('Home Grid (Home was drawn as ' + cfg.type + ')');
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
          this.box.removeAttribute('data-loading'); this.box.removeAttribute('data-why');
          w.hkShell.announce({ detail: { replace: true } });
          if (this.previewOff) this.previewOff();
          this.previewOff = w.hkCards.onClient((next) => { el.cards.forEach((card) => w.hkHostClient.bridge(card, next)); });
          if (this.previewRO) this.previewRO.disconnect();
          this.previewRO = new w.ResizeObserver(() => this.fit()); this.previewRO.observe(el);
          this.fit();
          if (this.pickerCard) this.catalogPreviews();
        } catch (e) {
          // STILL LOADING: the preview is the whole screen in a frame, and on a
          // slow connection that takes a while (2026-10-24, the owner: it gave
          // up after 20 s and stayed blank). Keep asking, less often as it
          // goes -- its frame's load asks at once too -- and only say so.
          // A real error, or still waiting long after the frame came: say which
          // (data-why), and after ~30 s step aside to a strip at the foot, so the
          // blocks can be arranged without the live picture (fit() places them
          // on the frame's own grid then)
          var failed = !(e && e.message === 'loading');
          if (failed) console.error('[hk-grid-editor] the preview failed', e);
          this.previewError = String(e && e.message || e);
          this.previewRetries = (this.previewRetries || 0) + 1;
          this.box.setAttribute('data-why', failed ? 'It hit a problem: ' + this.previewError : 'Waiting for ' + (e.why || 'the screen'));
          this.box.setAttribute('data-loading', failed || this.previewRetries > 25 ? 'slow' : 'yes');
          this.fit();
          if (this.previewRetries < 400) this.previewTimer = setTimeout(() => this.preview(), Math.min(2000, 300 + this.previewRetries * 50));
          else this.say('The live preview couldn’t load. Reload this page to try again.');
        }
      }
      // WHICH BLOCK a refused option or page is in (2026-11-01, the owner: "This error isn't very useful ... I had to find
      // out where the error was"): the house says only what kind of thing it refused, and what was saved before was
      // accepted -- so the blocks whose options or pages changed since are the ones to look at; the first is selected
      suspects(code) {
        if (code !== 'grid_option' && code !== 'grid_pages' && code !== 'grid_condition' && code !== 'grid_fallback') return '';
        var was = {};
        try { (JSON.parse(this.initial || 'null') || { items: [] }).items.forEach(function (it) { was[it.id] = it; }); } catch (e) { /* none saved */ }
        var part = (it) => JSON.stringify([it.card, it.opts || null, it.pages || null, it.when || null, it.fallback || null, it.rules || null]);
        var changed = (this.grid.items || []).filter((it) => !was[it.id] || part(was[it.id]) !== part(it));
        if (!changed.length) return '';
        if (this.selected !== changed[0].id) this.select(changed[0].id);
        return ' Check ' + (changed.length > 3 ? 'the ' + changed.length + ' blocks you changed' : 'the ' + listOf(changed) + ' block' + (changed.length > 1 ? 's' : '')) + '.';
      }
      // anyway: Save Anyway, sent without the version (replaces what was saved meanwhile)
      async save(anyway) {
        if (this.busy || !this.grid || !valid(this.grid)) return;
        this.busy = true; this.saveButton.disabled = true; this.say('Saving…');
        var changed = false;
        try {
          var grid = copy(this.grid);
          var msg = { type: 'hk_frontend/board/set', dashboard: this.o.path, changes: { home_style: 'grid', home_grid: grid } };
          // (a starter that asked for the Side Pane: the screen's, in the same write)
          if (this.paneChange) msg.changes.side_pane = this.paneChange;
          // (a Look: its settings and its Undo -- the layout's own before it
          // too -- in the same write)
          if (this.lookChange) {
            var b0 = this.o.board || {};
            Object.assign(msg.changes, copy(this.lookChange));
            msg.changes.look_undo.was.home_style = b0.home_style || 'generated';
            msg.changes.look_undo.was.home_grid = b0.home_grid || null;
          }
          if (!anyway && this.version != null) msg.expect_version = this.version;
          var result = await this.panel.actions().callWS(msg);
          this.panel.data.boards[this.o.path] = result && result.board || Object.assign({}, this.o.board, { home_style: 'grid', home_grid: grid },
            this.paneChange ? { side_pane: this.paneChange } : {}, this.lookChange || {});
          this.paneChange = null; this.lookChange = null;
          keepVersion(this.panel, this.o.path, result);
          if (result && result.version != null) this.version = result.version;
          this.initial = JSON.stringify(grid); this.o.onSaved();
        } catch (e) {
          if (e && e.code === 'conflict') { changed = true; this.say(''); }
          else {
            var fields = window.hkSettingsModel.refusals(e), code = fields && fields.home_grid;
            this.say('Couldn’t save. ' + (code ? window.hkSettingsModel.errorText(code) + this.suspects(code) : e.message || e));
          }
        } finally { this.busy = false; this.saveButton.disabled = false; }
        if (!changed) return;
        // THIS SCREEN CHANGED since the editor opened it (another window,
        // another device): nothing was saved. Reload shows it as it is now;
        // Save Anyway replaces it with this draft
        var choice = await this.changed(
          'This screen changed since you opened it, in another window or on another device. Reload to see it as it is now (your changes here are discarded), or Save Anyway to replace it with your ' +
          'layout.');
        if (choice === 'anyway') return this.save(true);
        if (choice === 'reload') return this.reloadBoard();
        this.say('Not saved: this screen changed since you opened it.');
      }
    };
    KIT.install(Methods);
  };
})();
