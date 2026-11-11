// hk-grid-editor-show-when.js - Show When: a block's rules and each condition.
//
// PART OF THE HOME GRID EDITOR (hk-grid-editor.js). Not a card and not run on its own: it registers one
// function, which hk-grid-editor.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkGridEditorParts = window.hkGridEditorParts || {})['hk-grid-editor-show-when'] = function (KIT) {
    var cellOf = KIT.cellOf, CONDITION_NAMES = KIT.CONDITION_NAMES, copy = KIT.copy, G = KIT.G,
        keepVersion = KIT.keepVersion, NAMES = KIT.NAMES, sampleEntities = KIT.sampleEntities, SIZES = KIT.SIZES,
        valid = KIT.valid, versionOf = KIT.versionOf;

    // THE METHODS this part adds to GridEditor.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // SHOW WHEN (2026-10-24, the owner): the block's own card by default, and up to G.RULES_MAX rules (ten since
      // 2026-11-10) -- each its card while all its conditions hold, the first that holds winning. Every card fills this
      // space. Past four rules Preview is a menu (twelve segments don't fit), each rule named with its card.
      conditions(item) {
        var K = this.K, add = (n) => this.sidebar.appendChild(n), rules = item.rules || [], n = rules.length, head = [], full = n >= G.RULES_MAX;
        var put = (next) => { this.conditionPreview = null; this.update(item.id, { rules: next.length ? next : null }); };
        var swap = (i, j) => { var next = copy(rules); next.splice(j, 0, next.splice(i, 1)[0]); if (this.editing === i) this.editing = j; else if (this.editing === j) this.editing = i; put(next); };
        var showing = (v) => { this.conditionPreview = v === 'live' ? null : Number(v); if (v !== 'live') this.editing = Number(v); this.preview(); this.side(); }, shown = this.conditionPreview ==
          null ? 'live' : String(this.conditionPreview);
        if (n) head.push(K[n <= 4 ? 'seg' : 'select']({ label: 'Preview', value: shown, onChange: showing, options: [['live', 'Live'], ['-1', n <= 4 ? 'Default' : 'Default: ' + NAMES[item.card]]]
          .concat(rules.map((r, i) => n <= 4 ? [String(i), 'Rule ' + (i + 1)] : [String(i), 'Rule ' + (i + 1) + ': ' + NAMES[r.card], 'Rule ' + (i + 1)])) }));
        add(K.group({ header: 'Show When', footer: n
          ? 'Shows ' + NAMES[item.card] + ' unless a rule holds. Rules are checked in order, Rule 1 first, and the first that holds wins. Each card fills exactly this space, so nothing moves.'
          : 'Add a rule to show another card here while something is true: music playing, a time of day, the alarm still armed.' }, head));
        rules.forEach((r, i) => {
          var conds = (r.when && r.when.all) || [], rows = [];
          var putRule = (fn) => { var next = copy(rules); fn(next[i]); put(next); };
          conds.forEach((c, j) => this.conditionRows(c, j, rows, (nc) => {
            var next = copy(rules);
            if (nc) next[i].when.all[j] = nc; else next[i].when.all.splice(j, 1);
            if (!next[i].when.all.length) next.splice(i, 1);
            put(next);
          }));
          if (conds.length < G.CONDITIONS_MAX) rows.push(K.select({ label: conds.length ? 'And Also' : 'When', value: '',
            options: [['', 'Add a Condition…']].concat(G.CONDITIONS.map((k) => [k, CONDITION_NAMES[k]])),
            onChange: (k) => { if (k) putRule((x) => x.when.all.push(this.newCondition(k))); } }));
          rows.push(K.button({ label: 'Then Show: ' + NAMES[r.card] + '…', onClick: () => this.pickFor('rule:' + i) }));
          rows.push(K.button({ label: 'Edit ' + NAMES[r.card] + ' Settings', disabled: this.editing === i, onClick: () => this.editCard(i) }));
          // (the card being set stays the same card when its rule moves or another goes)
          rows.push(K.button({ label: 'Move Rule Up', disabled: i === 0, onClick: () => swap(i, i - 1) }),
            ...(n > 1 ? [K.button({ label: 'Move Rule Down', disabled: i === n - 1, onClick: () => swap(i, i + 1) })] : []));
          rows.push(K.button({ label: 'Remove Rule', destructive: true, onClick: () => { var next = copy(rules); next.splice(i, 1); if (this.editing === i) this.editing = -1;
            else if (this.editing > i) this.editing--; put(next); } }));
          add(K.group({ header: 'Rule ' + (i + 1) + (n > 1 ? ' of ' + n : '') + ' · ' + NAMES[r.card] }, rows));
        });
        add(K.group({ footer: full ? 'A block holds up to ' + G.RULES_MAX + ' rules. Remove one to add another.' : '' }, [K.button({ label: 'Add Rule', disabled: full, onClick: () => {
          if (full) return; var other = Object.keys(G.table()).find((k) => k !== item.card && G.table()[k].sizes.includes(item.size)) || item.card;
          put(rules.concat([Object.assign({ when: { all: [this.newCondition('music_playing')] } }, this.variantFor(other))]));
        } })]));
      }
      newCondition(kind) {
        var c = { kind: kind };
        if (kind === 'time') { c.from = '06:00'; c.to = '09:00'; } else if (kind === 'solar_window') Object.assign(c, G.solar.fresh());
        if (kind === 'entity_state') { var ch = this.choices('entity')[0]; if (ch) { c.entity = ch[0]; c.state = 'on'; } }
        return c;
      }
      // ONE CONDITION'S ROWS: what it is (or Remove), and what it watches
      conditionRows(c, j, rows, put) {
        var K = this.K, set = (key, value) => { var out = copy(c); if (value) out[key] = value; else delete out[key]; put(out); };
        rows.push(K.select({ label: j ? 'And' : 'When', value: c.kind,
          options: G.CONDITIONS.map((k) => [k, CONDITION_NAMES[k]]).concat([['', 'Remove This Condition']]),
          onChange: (k) => put(k ? this.newCondition(k) : null) }));
        if (c.kind === 'time') {
          rows.push(K.text({ label: 'From', type: 'time', value: c.from, onCommit: (v) => { if (/^\d{2}:\d{2}$/.test(v)) set('from', v); } }));
          rows.push(K.text({ label: 'Until', type: 'time', value: c.to, onCommit: (v) => { if (/^\d{2}:\d{2}$/.test(v)) set('to', v); } }));
          return;
        } else if (c.kind === 'solar_window') return void G.solar.rows(K, c, rows, put, (this.panel.client || {}).states, () => this.side());
        if (c.kind !== 'after_sunset') rows.push(K.select({ label: 'Watch', value: c.entity || '',
          // (Music Is Playing's Automatic is any of the house's speakers -- not a TV -- 2026-11-01: say so; A TV Is On's, any TV)
          options: (c.kind === 'entity_state' ? [] : [['', c.kind === 'music_playing' ? 'Any Speaker' : c.kind === 'tv_on' ? 'Any TV' : 'Automatic']]).concat(
            this.choices({ music_playing: 'speaker', timer_running: 'timer', alarm_armed: 'alarm',
            alarm_disarmed: 'alarm', doorbell: 'doorbell', tv_on: 'tv_target' }[c.kind] || 'entity').filter((op) => op[0] !== 'tablet_room' || c.kind === 'music_playing' || c.kind ===
              'tv_on')).concat(c.entity && c.kind === 'music_playing' && !this.choices('speaker').some((op) => op[0] === c.entity) ? [[c.entity, c.entity + ' (Not a Music Speaker)']] : []),
          onChange: (v) => set('entity', v) }));
        if (c.kind === 'entity_state') rows.push(K.text({ label: 'Is', value: c.state, maxlength: 80, onCommit: (v) => set('state', v) }));
      }
      previewOptions(key) {
        var fields = G.table()[key].opts || {}, opts = {}, self = this;
        if (key === 'swipe') return G.swipe.sample(); if (key === 'alert') return G.alert.sample((k) => self.choices(k), (this.panel.client || {}).states);
        Object.keys(fields).forEach(function (name) {
          var kind = fields[name];
          if (['secondary', 'title', 'room_display', 'thermostat_style', 'tile_height', 'period', 'name_tag', 'tap_target', 'music_tap', 'tv_channel', 'music_show', 'music_playlist', 'music_speaker',
            'tv_target', 'tv_show', 'swipe_pages', 'timeline_show', 'np_background', 'on_now_open', 'everything_more', 'security_presentation', 'security_members', 'security_lit'].includes(
            kind)) return;
          if (kind === 'accessories') { opts[name] = sampleEntities(self.choices('entity'), ['light', 'switch', 'fan', 'sensor']).slice(0, 4).map((op) => ({ entity: op[0] }));
            if (!opts[name].length) delete opts[name]; return; }
          var choices = self.choices(kind).filter((op) => op[0] !== 'tablet_room');
          if (kind === 'scene' && key === 'scene') choices = choices.filter((op) => self.sceneIds().indexOf(op[0]) >= 0);
          if (kind === 'entity') choices = sampleEntities(choices, ['light', 'switch', 'fan']);
          if (kind === 'speaker') choices.sort((a, b) => (self.panel.client.states[b[0]]?.state === 'playing') - (self.panel.client.states[a[0]]?.state === 'playing'));
          if (kind === 'scenes' || kind === 'calendars') { if (choices.length) opts[name] = choices.slice(0, kind === 'scenes' ? 6 : 2).map((op) => op[0]); return; }
          if (kind === 'cameras' || kind === 'refresh') return;                  // (the face: every camera, its own refresh)
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
          if (id.startsWith('media_player.')) { state = 'playing'; Object.assign(a,
            { media_title: 'A Favorite Song', media_artist: 'Sample Artist', media_album_name: 'Sample Album', media_duration: 240, media_position: 82, media_position_updated_at: stamp,
            volume_level: .4 }); }
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
          if (msg.type === 'timeline/subscribe') return Promise.resolve(() => {});          // (no live feed in a sample)
          if (msg.type === 'weather/subscribe_forecast') { var timer = setTimeout(() => callback({ forecast: forecast(msg.forecast_type) }), 0); return Promise.resolve(() => clearTimeout(timer)); }
          return client.subscriptions.subscribeMessage(callback, msg);
        } });
        // Recent's sample rows, invented: the inert preview reads no real house
        var ago = (m) => Math.floor((now - m * 60e3) / 1000);
        var sample = { names: true, limited: false, search: true, families: ['door', 'lock', 'garage', 'doorbell', 'detection'], next_before: null, events: [
          { id: 5, at: ago(4), family: 'lock', kind: 'locked', level: 'info', title: 'Back Door locked', area_name: 'Kitchen', who: { name: 'Sample', device: 'Kitchen tablet', how: 'tablet' },
            pics: [] },
          { id: 4, at: ago(19), family: 'detection', kind: 'package', level: 'info', title: 'Package at Front Door', area_name: 'Porch', pics: [] },
          { id: 3, at: ago(26), family: 'doorbell', kind: 'ring', level: 'info', title: 'Someone rang Front Door', area_name: 'Porch', pics: [] },
          { id: 2, at: ago(61), family: 'garage', kind: 'closed', level: 'info', title: 'Garage closed', area_name: 'Garage', pics: [] },
          { id: 1, at: ago(64), family: 'garage', kind: 'opened', level: 'info', title: 'Garage opened', area_name: 'Garage', pics: [] }] };
        var summary = { window: 'overnight', label: 'Overnight', title: 'Overnight at the house (9 PM to 7 AM)', quiet: false, counts: { lock: 2, garage: 2 },
          lines: ['Front door and back door locked all night.', 'Garage opened 6:12 AM, closed 6:20 AM.', 'Right now: all locks locked, garage closed.'], events: [] };
        var read = (method, path) => method.toUpperCase() === 'GET' && /^timeline\/summary/.test(path) ? Promise.resolve(summary)
          : method.toUpperCase() === 'GET' && /^timeline(\?|$)/.test(path) ? Promise.resolve(sample)
          : method.toUpperCase() === 'GET' && path.startsWith('calendars/')
          ? Promise.resolve([{ summary: 'Family Dinner', start: { dateTime: new Date(now + 3600e3).toISOString() }, end: { dateTime: new Date(now + 7200e3).toISOString() } },
            { summary: 'Weekend Plans', start: { dateTime: new Date(now + 86400e3).toISOString() }, end: { dateTime: new Date(now + 90000e3).toISOString() } }])
          : client.callApi(method, path);
        return Object.assign({}, client, { states: states, subscriptions: subs, callApi: read });
      }
      catalogPreviews() {
        var w = this.iframe.contentWindow;
        if (!w || !w.hkCards || !this.previewView) return;
        var box = this.palette.querySelector('[data-preview-card]'); if (!box) return;
        // (its frame is the whole screen again: made once for this card, never again for a change elsewhere in the draft)
        if (box.querySelector('iframe')) return;
        if (this.catalogOff) this.catalogOff();
        var sz = box.dataset.previewSize, z = SIZES[sz], ctx = this.previewView._config.grid_ctx || {};
        var unit = cellOf(this.grid), gap = unit.gap;
        var width = unit.w * z[0] + gap * (z[0] - 1), height = sz === 'XS' ? (unit.h - gap) / 2 : unit.h * z[1] + gap * (z[1] - 1);
        var scale = Math.min(1, (box.clientWidth || 220) / width);
        box.style.height = height * scale + 'px';
        // Keep every descendant in the screen's custom-element registry. Adopting
        // a card into Settings leaves its hk-plate and glyph elements undefined.
        var frame = this.h('iframe', { title: NAMES[box.dataset.previewCard] + ' preview', tabindex: '-1', 'aria-hidden': 'true' });
        Object.assign(frame.style, { width: width + 'px', height: height + 'px', left: '50%', marginLeft: -(width * scale / 2) + 'px', transformOrigin: 'top left', transform: 'scale(' + scale +
          ')' });
        frame.inert = true; frame.src = this.iframe.src; box.replaceChildren(frame); box.setAttribute('data-loading', '');
        var active = true, timer, retries = 0;
        this.catalogOff = () => { active = false; clearTimeout(timer); };
        var load = () => {
          if (!active) return;
          var fw = frame.contentWindow;
          if (!fw || !fw.hkShell || !fw.hkShell.view() || !fw.hkCards || !fw.hkCards.client()) {
            if (retries++ < 600) timer = setTimeout(load, 300);            // up to 3 minutes
            return;
          }
          var doc = fw.document, cell = doc.createElement('div'); cell.className = 'cell'; cell.setAttribute('size', sz);
          Object.assign(cell.style, { width: width + 'px', height: height + 'px', position: 'fixed', inset: '0', containerType: 'size', containerName: 'hk-cell' });
          cell.style.setProperty('--hk-cell-w', (width + gap) / z[0] - gap + 'px'); cell.style.setProperty('--hk-cell-h', (height + gap) / z[1] - gap + 'px');
          // (a square grid's cell as the grid gives it, hk-layout.js: its insets, inner corners and shape -- else a block looks unlike its place)
          var sq = this.grid && this.grid.cell === 'square';
          cell.style.setProperty('--hk-block-pad', sq ? '18px' : '14px');
          // (and the SHAPES' inset, the grid cell's 13 on a square cell -- without it a square Wide Accessory Group's tiles had 375 px for 376 and stacked, 2026-11-09)
          cell.style.setProperty('--hk-shape-pad', sq ? '13px' : 'var(--hk-block-pad)'); cell.style.setProperty('--hk-text-in', 'calc(var(--hk-block-pad) - var(--hk-shape-pad))');
          ['t', 'r', 'b', 'l'].forEach(function (s) { cell.style.setProperty('--hk-pad-' + s, 'var(--hk-block-pad)'); cell.style.setProperty('--hk-spad-' + s, 'var(--hk-shape-pad)'); });
          if (sq) {
            cell.style.setProperty('--hk-cell-shape', 'square');
            cell.style.setProperty('--hk-inner-radius', 'max(12px, calc(var(--hk-block-radius, 34px) - var(--hk-block-pad)))');
          }
          var view = doc.createElement('hk-home-grid-view');
          Object.assign(view.style, { display: 'block', width: width + 'px', height: height + 'px', position: 'fixed', inset: '0' });
          var it = { id: 'preview', card: box.dataset.previewCard, size: sz, at: [0, 0], opts: this.previewOptions(box.dataset.previewCard) };
          var sample = fw.hkCards.previewClient(this.catalogClient(fw.hkCards.client()));
          var card = fw.hkCards.createCard(fw.hkGridCatalog.config(it, ctx), sample);
          card.setAttribute('size', sz); card.inert = true;
          // THE SCREEN'S TILE STYLE (2026-11-08, the owner: "the card previews followed the appearance default for tiles (centered vs home)"):
          // set on the card as the screen's grid sets it on a block (hk-layout.js, hk-strategy.js homeGridView)
          if (this.screenTile(box.dataset.previewCard, sz, it.opts)) card.setAttribute('tile', 'centred');
          Object.assign(card.style, { display: 'block', width: '100%', height: '100%' });
          cell.appendChild(card); view.appendChild(cell); doc.body.replaceChildren(view);
          fw.galleryCard = card; box.removeAttribute('data-loading');
          // (sample readings, fixed: subscribed back to the frame's live hub they would feed into themselves)
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
        if (!await this.K.confirm(this.shadowRoot, { title: 'Restore This Layout?', message: 'Version ' + row.version +
          ' becomes your draft. Review it, then Save to apply it. Other screen settings stay as they are.', ok: 'Restore Draft' })) return;
        this.selected = null; this.change(copy(row.body.home_grid));
        this.say('Version ' + row.version + ' restored to the draft. Save to apply it.');
      }
      async copyTo(path, anyway) {
        if (this.busy || !path || !valid(this.grid)) return;
        if (!anyway && !await this.K.confirm(this.shadowRoot, { title: 'Copy Layout To This Screen?', message: 'This saves your draft layout to ' + path +
          '. Its other settings stay as they are. Tablet’s Room still means the tablet showing that screen.', ok: 'Copy Layout' })) return;
        this.busy = true;
        var changed = null;
        try {
          var grid = copy(this.grid), version = versionOf(this.panel, path);
          var msg = { type: 'hk_frontend/board/set', dashboard: path, changes: { home_style: 'grid', home_grid: grid } };
          if (!anyway && version != null) msg.expect_version = version;    // the target screen's, as last read
          var result = await this.panel.actions().callWS(msg);
          this.panel.data.boards[path] = result && result.board || Object.assign({}, this.panel.data.boards[path], { home_style: 'grid', home_grid: grid });
          keepVersion(this.panel, path, result);
          this.say('Layout copied.');
        } catch (e) {
          if (e && e.code === 'conflict') changed = true;
          else this.say('Couldn’t copy the layout. ' + (e.message || e));
        } finally { this.busy = false; }
        if (!changed) return;
        // THAT SCREEN CHANGED since this page read it: Reload reads the
        // settings again (this screen's draft stays) to copy onto what it is
        // now; Save Anyway replaces its layout with this one
        var choice = await this.changed(
          'That screen changed since you opened it, in another window or on another device. Reload to read it again (your draft here stays), or Save Anyway to replace its layout with this one.');
        if (choice === 'anyway') return this.copyTo(path, true);
        if (choice === 'reload') {
          try { await this.panel.reload(); this.say('Reloaded. Copy the layout again to replace that screen’s.'); }
          catch (e) { this.say('Couldn’t reload. ' + (e.message || e)); }
        } else this.say('Not copied: that screen changed since you opened it.');
      }
      // "This screen changed": Reload (Cancel's place, where focus starts) or
      // Save Anyway; Escape or a tap outside is neither ('reload' | 'anyway' | null)
      async changed(message) {
        var got = await this.K.confirm(this.shadowRoot, { title: 'This Screen Changed', message: message,
          cancel: 'Reload', ok: 'Save Anyway', dismiss: null });
        return got === true ? 'anyway' : got === false ? 'reload' : null;
      }
      // Reload: the screen as it is now (read again), the draft and its undo
      // discarded
      async reloadBoard() {
        try {
          await this.panel.reload();
          this.selected = null; this.undoStack = [];
          this.load(this.panel.data.boards[this.o.path] || {});
          this.saveButton.disabled = !this.grid; this.undoButton.disabled = true;
          this.blocks(); this.side(); this.fit(); this.preview();
          this.say('Reloaded. This is the screen’s layout as it is now.');
        } catch (e) { this.say('Couldn’t reload. ' + (e.message || e)); }
      }
    };
    KIT.install(Methods);
  };
})();
