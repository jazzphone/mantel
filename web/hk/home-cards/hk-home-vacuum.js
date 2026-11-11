// hk-home-vacuum.js - the vacuum card and the area select card.
//
// PART OF THE HOME CARDS (hk-home.js). Not a card and not run on its own: it registers one
// function, which hk-home.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkHomeParts = window.hkHomeParts || {})['hk-home-vacuum'] = function (K) {
    var areaPicking = K.areaPicking, button = K.button, C = K.C, HkBase = K.HkBase, picked = K.picked,
        SELECTED_BG = K.SELECTED_BG, SELECTED_TEXT = K.SELECTED_TEXT;

    // --------------------------------------------------------- hk-vacuum
    //
    // One vacuum: a live glyph, its name, a row of small chips, and four
    // commands. Not custom:mushroom-vacuum-card, which is a fine card and
    // completely wrong here -- dark slab, its own type scale, its own icon
    // set, and four equal-width grey bars for the commands. Beside the rest of
    // this dashboard it reads as a different application.
    //
    // THE CHIP ROW IS THE REASON THIS CARD EXISTS: without it a stuck vacuum
    // looks exactly like a docked one. Each chip is a fact you would otherwise have to
    // open the more-info dialog to learn.
    class HkVacuumCard extends areaPicking(HkBase) {
      static get CSS() {
        return [
          // 188px, not 200, and row-gap 10 rather than 14. A page that stacks
          // three vacuums one per room section at 200/14 puts the
          // third card ~40px below the fold of an 800px tablet -- a page
          // with exactly three things on it that you still have to scroll. The
          // content needs 52 (glyph) + 26 (chips) + 52 (buttons) + two gaps + 32
          // of padding = 182, so this keeps 6px of slack. DO NOT go below 182.
          //
          // A MINIMUM, NOT A HEIGHT: an error chip ("unable to
          // complete operation") wraps the chips to a second line on a phone,
          // and at a fixed 188 the four buttons would be pushed out of the card
          // and cut off. Every ordinary card is exactly 188; one
          // with more to say grows.
          'hk-plate.vac{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;min-height:188px;  border-radius:' + window.hkCards.M.radius +
            ';padding:16px 18px;overflow:hidden;cursor:pointer;  ' + window.hkCards.M.glass + ';',
          '  border:' + window.hkCards.M.border + ';  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-tall') + ');  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
          // THE VACUUM DRAWN (2026-11-09, the owner: "should we use these new card setup on the Vacuums page as well? ... room selection on the
          // card itself isn't needed", the mockup approved): the drawing at the left (hk-vacuum-art.js, 112 wide: 78 + 14 + 56 + 32 of padding
          // keeps the 188), the name, what it is doing (red when it needs someone) and one line -- where, how far, the battery; under them one row
          // of 56 px keys: Clean (Pause while it runs, Resume when paused) white and wide, Locate and Dock round. The rooms stay in Clean Areas
          (window.hkVacuumArt ? window.hkVacuumArt.CSS : '') + '.vac .vt{display:flex;align-items:center;gap:16px;min-width:0}',
          '.vac .art{width:112px;flex:none}.vac .vtx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
          '.vac .label{min-width:0;overflow:hidden;font-size:18px;font-weight:600;line-height:24px;color:' + window.hkCards.v('ink') + ';white-space:nowrap;text-overflow:ellipsis}',
          '.vac .vst{font-size:15px;font-weight:600;line-height:20px;color:' + window.hkCards.ACCENTS.mint + '}.vac .vst.idle{color:' + window.hkCards.v('ink-2') + '}.vac .vst.err{color:' +
            window.hkCards.ACCENTS.red + '}',
          '.vac .meta{font-size:13px;line-height:17px;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
          '.vac .vk{display:flex;gap:10px}.vac .cmd{all:unset;box-sizing:border-box;height:56px;min-width:56px;border-radius:28px;display:flex;align-items:center;justify-content:center;gap:8px;' +
            'cursor:pointer;',
          '  background:' + window.hkCards.v('key') + ';color:' + window.hkCards.v('ink') + ';font-family:inherit;font-size:17px;font-weight:600;transition:transform .12s ease}',
          '.vac .cmd.go{flex:1 1 auto;min-width:0;padding:0 14px;background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}.vac .cmd:active{transform:scale(0.97)}',
          '.vac .cmd.clr{flex:none;padding:0 20px;font-size:17px}.vac .cmd[hidden]{display:none}.vac .cmd:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') +
            ';outline-offset:2px}.vac .cmd hk-icon{width:22px;height:22px;--mdc-icon-size:22px;flex:none;display:flex;align-items:center;justify-content:center}',
          // (a flex box, as a tile's well glyph is -- hk-base.js: under Home Assistant the glyph is an inline child on a line box,
          // its half-leading pushing it low in the key; the owner, 2026-11-10: Clean, Locate and Dock off center in HK Frontend)
          '@media (prefers-reduced-motion:reduce){  .vac .cmd,.vac .cmd:active{transition:none;transform:none}}',
          // ON A HOME GRID (the `vacuum` block; redrawn as a widget, 2026-10-31,
          // the owner: "big Clean / Dock keys", the mock-up's Vacuum): built
          // round what a vacuum is for -- what it is doing and its battery, one
          // big Clean (Pause while it runs, Resume when paused) where a thumb is
          // and Dock beside it. Large and Extra Large add the rooms to clean as
          // tiles to tick, the Clean key saying how many (areaPicking, Clean
          // Areas); Extra Large draws the battery as a ring beside them. Its
          // own markup (_renderBlock), not the page card's: a page keeps that.
          // Tile cells (196 x 150) first, a square cell's sizes after.
          ':host([size]){display:block;height:100%}',
          'hk-plate.vb{box-sizing:border-box;height:100%;display:flex;flex-direction:column;padding:' + C.blockPad(C.CARD.pad) + ';' + C.plate('card') + ';',
          '  overflow:hidden;cursor:pointer;color:' + C.v('ink') + ';-webkit-tap-highlight-color:transparent;--vb-key:44px}',
          // THE HEADING (2026-11-08, the owner: titles "all need to match"; "if the card's name is printed on the card..." it stays here, as it names the vacuum): the vacuum's name on the one heading
          // row, no glyph; the battery at its right on Small
          C.headRowCss('.vb .hd') + C.headCss('.vb .nm'),
                  '.vb .rt{display:flex;flex-direction:column;min-width:0}',
          '.vb .sub{display:block;min-width:0;font-size:15px;font-weight:400;line-height:1.3;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.vb[data-s=S] .sub{' + C.typeCss('caption') + '}',
          '.vb .sub.two{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
          '.vb .warn{color:' + C.ACCENTS.orange + '}.vb .bad,.vb .err{color:' + C.ACCENTS.red + '}.vb .good{color:' + C.ACCENTS.green + '}',
          '.vb .big{font-size:34px;font-weight:300;letter-spacing:-0.02em;line-height:1.05;font-variant-numeric:tabular-nums;margin-top:2px}',
          C.headCss('.vb .lab') + '.vb .lab{display:block;flex:none;height:16px;padding:1.5px 0;margin:10px 0 8px}',
          '.vb .note{' + C.typeCss('caption') + ';line-height:1.3;color:' + C.v('ink-2') + ';margin-top:6px}',
          // the status of a clean just sent, in place of the line it is about
          '.vb .hk-status:empty{display:none}.vb .hk-status{' + C.typeCss('caption') + ';line-height:1.3;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.vb .hk-status[data-kind=failed]{color:' + C.v('fail') + '}.vb .hk-status[data-kind=warn]{color:' + C.v('warn') + '}',
          '.vb .rt:has(.hk-status:not(:empty)) .sub{display:none}',
          // THE KEYS at the foot: Clean (white, as a selected key is) taking the room, Dock round beside it
          '.vb .keys{display:flex;gap:10px;margin-top:auto;padding-top:10px;flex:none}',
          '.vb .key{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;flex:none;height:var(--vb-key);min-width:var(--vb-key);',
          '  --vb-r:calc(var(--vb-key) / 2);border-radius:var(--vb-r);background:' + C.v('key-strong') + ';color:' + C.v('ink') + ';font-family:inherit;' + C.typeCss('headline') +
            ';white-space:nowrap;cursor:pointer}',
          '.vb .key>span{min-width:0;overflow:hidden;text-overflow:ellipsis}',
          '.vb .key.go{flex:1 1 auto;min-width:0;padding:0 10px;background:' + SELECTED_BG + ';color:' + SELECTED_TEXT + '}',
          // (TALL'S KEYS, 2026-11-08, the owner: nothing stretches -- Clean is as wide as its word, Dock round beside it, the pair centered)
          // (TALL'S KEYS, 2026-11-09: Clean takes the row's width less the round Dock and 8 px; 48 tall since 2026-11-10, as the other blocks' keys --
          // the owner: at 56 "the pills/controls seem a lot bigger than the other cards, causing almost no room for the animated glyph")
          '.vb[data-s=T]{--vb-key:48px}.vb[data-s=T] .keys{gap:8px}.vb[data-s=T] .key.go{padding:0 8px}.vb[data-s=T] .key.go hk-icon{display:none}',
          // (the state in words where there is no ring to hold it: no battery and not cleaning, 2026-11-09)
          '.vb .none{text-align:center}.vb .none b{display:block;font-size:22px;font-weight:500;line-height:1.2}',
          '.vb .key hk-icon{flex:none;width:22px;height:22px;--mdc-icon-size:22px;display:flex;align-items:center;justify-content:center}',
          '.vb .key[aria-disabled=true]{opacity:.45;pointer-events:none}',
          '.vb .key:active,.vb .vr:active{transform:scale(0.97)}.vb .key:focus-visible,.vb .vr:focus-visible{outline:2px solid ' + C.v('ink-2') + ';outline-offset:2px}',
          // WIDE: the vacuum and its battery large on the left, the two keys stacked on the right
          '.vb[data-s=W]{flex-direction:row;gap:16px}',
          // (2026-11-09, the owner: "the clean, rooms, and home button area should be wider ... its too squished": the vacuum drawn in two fifths
          // at the left -- its name, the drawing in what is left, what it is doing -- and the keys the rest)
          '.vb[data-s=W] .col{display:flex;flex-direction:column;min-width:0;flex:0 0 40%}.vb[data-s=W] .art{flex:1 1 0;min-height:0;width:100%;margin:16px 0 0;display:flex;justify-content:center}',
          '.vb[data-s=W] .art .hkva{height:100%;width:auto;max-width:100%}.vb[data-s=W] .side{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;gap:8px}',
          '.vb[data-s=W] .side .key{flex:none;width:100%;--vb-key:48px}',
          // THE ROOMS, two across, each a row of its own size (48 px; nothing stretches, 2026-11-08, the owner: "do the rooms scroll in the card if there
          // are more than what the card allows? If not, it should"): as many as the block holds, the rest scrolling (a cut row says so); few
          // rooms stay under their label (data-fit: _fitRooms)
          '.vb .rooms{display:grid;grid-template-columns:repeat(2,var(--vb-cw));justify-content:center;grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap +
            'px;align-content:start;flex:1 1 auto;min-height:0;margin-top:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;touch-action:pan-x pan-y;scrollbar-width:none}',
          '.vb .rooms::-webkit-scrollbar{display:none}.vb .rooms[data-fit]{align-content:start}',
          // (more rooms than it shows, 2026-11-10: the last row fades until the list is scrolled to its end)
          '.vb .rooms:not([data-fit]):not([data-end]){-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 28px),transparent);' +
            'mask-image:linear-gradient(to bottom,#000 calc(100% - 28px),transparent)}',
          // ...and no stretching across the width (2026-11-08): a room is --vb-cw wide (176 on Large, 170 on Extra Large -- two across and the gap
          // nearly fill the column), the label, grid and keys one column of that width, centered in what the block's column leaves
          '.vb[data-s=L]{--vb-cw:176px}.vb[data-s=XL]{--vb-cw:170px}.vb[data-r] :is(.lab,.rooms,.keys){width:calc(var(--vb-cw) * 2 + ' + window.hkCards.TILE.gridGap +
            'px);align-self:center;box-sizing:border-box}',
          // TALL AND WIDE with rooms on offer: the Rooms key opens the sheet that picks them, and says what is picked ("Kitchen, Office", "3 rooms")
          // (as tall as the block's keys: 48 px since 2026-11-10)
          '.vb .rrow{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:none;height:48px;padding:0 8px 0 14px;margin-top:10px;border-radius:24px;background:' + C.v('key') +
            ';color:' + C.v('ink-2') + ';font-family:inherit;' + C.typeCss('caption') + ';cursor:pointer}',
          '.vb .rrow>span{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vb .rrow.on{color:' + C.v('ink') +
            ';font-weight:600}.vb .rrow hk-icon{flex:none;width:20px;height:20px;--mdc-icon-size:20px}.vb .rrow:active{transform:scale(0.98)}.vb .rrow:focus-visible{outline:2px solid ' +
            C.v('ink-2') + ';outline-offset:2px}',
          '.vb .pair{display:flex;gap:8px}.vb .pair .key.rm{flex:1 1 0;min-width:0;padding:0 8px;font-size:15px}.vb .pair .key.rm.on{font-weight:700}.vb .side .pair .key.dk{width:auto}' +
            '.vb .pair .key.rm hk-icon{display:none}.vb .rm-note{display:block;' + C.typeCss('caption') + ';font-weight:600;color:' + C.v('ink') +
            ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          // THE ROOMS ARE THE SHEET'S PILLS (the owner, 2026-11-10: "not using the pills they should be using for the vacuum areas"): hk-base.js's
          // 40 px selectable pill, the name centered, white when picked -- the Vacuum sheet's and the Vacuums page's rooms, no glass layer of their own
          '.vb .vr{font:inherit;-webkit-appearance:none;appearance:none;min-width:0;box-sizing:border-box;--hk-glass-surface:0;position:relative}.vb .vr::after{content:"";position:absolute;' +
            'inset:-2px 0}',
          // EXTRA LARGE: the vacuum, its battery as a ring and its last run on the left; the rooms on the right
          '.vb[data-s=XL]{flex-direction:row;gap:22px}',
          // (the ring in the middle of what its column has left, the last run at the foot, level with the keys)
          '.vb[data-s=XL] .lcol{flex:0 0 200px;display:flex;flex-direction:column;min-width:0}',
          '.vb[data-s=XL] .lcol :is(.art,.none){margin:18px 0 0}',
          // THE ROBOT CENTERED both ways in what its column leaves under the words, Large and Extra Large (the owner, 2026-11-10: "isn't centered")
          '.vb:is([data-s=L],[data-s=XL]) :is(.lcol,.mid) .art{flex:1 1 0;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;container-type:size}' +
          '.vb:is([data-s=L],[data-s=XL]) :is(.lcol,.mid) .art .hkva{width:min(100%,calc(100cqh * 200 / 140));height:auto;max-height:none}',
          // (no rooms to offer: the left column is the block, the drawing at its own size under the words -- it was squeezed into 200 px, "Cl...")
          '.vb[data-s=XL]:not([data-r]) .lcol{flex:1 1 auto}.vb[data-s=XL]:not([data-r]) .lcol .art .hkva{max-width:240px}',
          '.vb[data-s=XL] .rcol{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}' + '.vb[data-s=XL] .rcol .lab{margin-top:0}',
          '.vb[data-s=XL] .key.dk{padding:0 18px}',
          // LARGE WITH ROOMS (2026-11-10): Extra Large's two columns -- the vacuum in two fifths at the left, its words at the foot level
          // with the keys; the rooms one to a row down the right, as wide as the column, scrolling past what the block holds
          '.vb[data-s=L][data-r]{flex-direction:row;gap:16px}',
          '.vb[data-s=L][data-r] .lcol{flex:0 0 40%;display:flex;flex-direction:column;min-width:0}',
          '.vb[data-s=L][data-r] .lcol .art{margin:18px 0 0}',
          '.vb[data-s=T] .mid{margin-top:16px}.vb[data-s=L]:not([data-r]) .mid{margin:18px 0 8px}',
          '.vb[data-s=L][data-r] .rcol{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}',
          '.vb[data-s=L][data-r] .rcol .lab{margin-top:0}.vb[data-s=L][data-r] :is(.lab,.rooms,.keys){width:100%}.vb[data-s=L] .rooms{grid-template-columns:minmax(0,1fr)}',
          '.vb[data-s=L]:not([data-r]) .mid .art{margin:0}',  // (no rooms: the robot was 0 px wide here until 2026-11-10)
          // THE VACUUM DRAWN IN PLACE OF THE BATTERY RING (2026-11-09, hk-vacuum-art.js; the battery is in the line under what it is doing):
          // Extra Large's in the middle of its column, Tall's as big as --vb-r (what the block leaves) lets it, centered
          (window.hkVacuumArt ? window.hkVacuumArt.CSS : '') + '.vb .art{flex:none;width:100%;margin:6px auto}.vb .state{font-size:22px;font-weight:600;line-height:1.2}',
          '.vb[data-s=T] .art{width:min(100%,calc(var(--vb-r,96px) * 1.43))}.vb[data-s=W] .state{font-size:17px}',
          // (a Large or Extra Large block with no rooms to offer: the battery large in the middle)
          '.vb .mid{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;min-height:0}',
          // ON A SQUARE CELL (196 x 196): the mock-up's sizes
          '@container hk-cell (min-height:180px) or style(--hk-cell-shape: square){  hk-plate.vb{--vb-key:48px}  .vb .big{font-size:36px}  .vb .keys{padding-top:12px}',
          '  .vb .lab{margin-top:12px}  .vb[data-s=W] .side{gap:10px}  .vb[data-s=W] .side .key{--vb-key:56px;font-size:17px}',
          '}'
        ].join('');
      }

      setConfig(config) {
        if (!config || !config.entity) throw new Error('hk-vacuum: `entity` is required');
        super.setConfig(config);
      }
      // (the rooms ticked on a Large or Extra Large block: this element's alone, areaPicking)
      _onConfig() { this._sel = picked(this._config.entity); }
      getCardSize() { return 3; }
      // (a block's tap, hk-base.js openTarget; When Tapped chooses) the Vacuums page, else this vacuum's sheet
      _tapTarget() { var id = (this._config || {}).entity; return [{ page: 'vacuums' }, id && { sheet: id }]; }

      // The card reads four sensors its `entity` does not name -- and the
      // vacuum's own attributes (battery_level), so last_updated, not state:
      // a battery that charges while the vacuum stays `docked` must redraw.
      // A block also draws by its size, the rooms offered and how long ago it
      // last ran (to ten minutes).
      _sigOf() {
        var h = this.client, c = this._config;
        if (!h || !c) return null;
        var art = window.hkVacuumArt ? window.hkVacuumArt.ids(h, c.entity, c) : {};   // (the drawing's error and charge state)
        var ids = [c.entity, this._sib('battery'), c.error, c.dock_error, c.room, this._sib('progress'), art.error, art.charge, art.latch]
                    .filter(Boolean);
        var out = '';
        for (var i = 0; i < ids.length; i++) {
          var s = h.states[ids[i]];
          out += ids[i] + '=' + (s ? s.last_updated : 'x') + ';';
        }
        if (this._cellSize()) {
          out += '|' + this._cellSize() + '|' + (this._blockKey || '') + '|' + this._picker() + '|' + !!this._offer + '|' +
            this._areaSig() + '|' + Math.floor(Date.now() / 600000);
        }
        return out;
      }
      // Rooms to offer: Clean Areas added, or the house's own cleaning script
      // named (as the Vacuums page decides, hk-strategy.js)
      _picker() {
        var HS = window.hkSettings, added = (HS && HS.get && HS.get('added', [])) || [];
        return added.indexOf('clean_areas') >= 0 || !!(HS && HS.get && HS.get('features.vacuum_script', null));
      }

      // THE READINGS ON THE SAME DEVICE (2026-11-09): a Home Grid block is made with the vacuum's id alone, where the Vacuums page's
      // card is handed its battery and progress sensors (hk-strategy.js sibling/siblingLike). A block finds them the same way:
      // a sensor on the vacuum's device with device_class battery, or an id with cleaning_progress. The vacuum's own
      // `battery_level` attribute comes first, in _chips.
      _sib(kind) {
        var c = this._config, h = this.client, ents = h && h.entities;
        if (c[kind]) return c[kind];
        if (!ents || !c.entity) return null;
        var memo = this._sibs && this._sibs.id === c.entity ? this._sibs : (this._sibs = { id: c.entity });
        if (kind in memo) return memo[kind];
        var dev = ents[c.entity] && ents[c.entity].device_id, hit = null;
        if (dev) {
          hit = Object.keys(ents).filter(function (k) {
            var st = h.states[k];
            return k !== c.entity && ents[k].device_id === dev && k.indexOf('sensor.') === 0 && st &&
              (kind === 'battery' ? st.attributes && st.attributes.device_class === 'battery' : /cleaning_progress/.test(k));
          }).sort()[0] || null;
        }
        return (memo[kind] = hit);
      }

      _v(id) {
        var s = id && this._st(id);
        return s ? s.state : undefined;
      }

      // The three different ways these integrations spell "fine".
      static get OK_ERRORS() { return ['no_error', 'none', 'ok', 'unknown', 'unavailable', '']; }

      _chips(st) {
        var cfg = this._config, out = [];
        var state = (st && st.state) || 'unknown';
        var a = (st && st.attributes) || {};

        out.push({ t: C.sentenceCase(String(state).replace(/_/g, ' ')) });

        var b = a.battery_level;
        if (b == null && this._sib('battery')) b = this._v(this._sib('battery'));
        var bn = Number(b);
        if (b != null && b !== 'unknown' && b !== 'unavailable' && isFinite(bn)) {
          // Colour the battery the way the Home app does: only shout when it is low.
          out.push({ t: Math.round(bn) + '%', k: 'battery', n: bn,
                     c: bn <= 20 ? 'bad' : (bn <= 40 ? 'warn' : '') });
        }

        // Only while it is actually working: a room and a percentage next to a
        // docked vacuum are last run's numbers and read as if it were running.
        if (state === 'cleaning' || state === 'returning') {
          var room = this._v(cfg.room);
          if (room && room !== 'unknown' && room !== 'unavailable') out.push({ t: room });
          var pr = Number(this._v(this._sib('progress')));
          if (isFinite(pr) && pr > 0) out.push({ t: Math.round(pr) + '% done', c: 'good' });
        }

        // Errors LAST, so they read as the exception.
        var OK = HkVacuumCard.OK_ERRORS;
        [cfg.error, cfg.dock_error].forEach(function (id) {
          var e = this._v(id);
          if (e && OK.indexOf(e) === -1) {
            out.push({ t: '⚠ ' + String(e).replace(/_/g, ' '), c: 'err' });
          }
        }, this);
        return out;
      }

      _render() {
        var cfg = this._config;
        var sized = this._cellSize();
        if (sized) { this._renderBlock(sized); return; }
        if (!this._built) {
          var cmds = HkVacuumCard.COMMANDS, self = this;
          this._root.innerHTML = '<hk-plate class="vac" data-hk-role="card"><div class="vt"><div class="art"></div><div class="vtx"><b class="label" data-hk-role="label"></b>' +
            '<span class="vst"></span><span class="meta" data-hk-role="meta"></span></div></div><div class="vk">' + cmds.map(function (c) {
              return '<button type="button" class="cmd' + (c[0] === 'go' ? ' go' : '') + '" data-hk-role="' + c[0] + '" data-svc="' + c[2] + '" aria-label="' + c[3] + '">' +
                '<hk-icon icon="' + c[1] + '"></hk-icon>' + (c[0] === 'go' ? '<span></span>' : '') + '</button>';
            }).join('').replace('</button>', '</button><button type="button" class="cmd clr" data-clear hidden>Clear</button>') + '</div></hk-plate>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { card: q('.vac'), art: q('.art'), label: q('.label'), vst: q('.vst'), meta: q('.meta'), go: q('.cmd.go'), clr: q('.cmd.clr') };
          this._root.querySelectorAll('.cmd').forEach(function (b) {
            b.addEventListener('click', function (ev) {
              ev.stopPropagation();                      // (the card's tap opens the vacuum; a key only does its own)
              if (b.hasAttribute('data-clear')) self._clearWater();
              else if (self.client) self._call('vacuum', b.getAttribute('data-svc'), { entity_id: self._config.entity });
            });
          });
          this._bind(this._e.card, 'tap_action', null);
          this._built = true;
        }
        var e = this._e, st = this._st(cfg.entity), state = (st && st.state) || 'unknown';
        var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
        if (e.label.textContent !== nm) e.label.textContent = nm;
        var lk = window.hkVacuumArt ? window.hkVacuumArt.look(this.client, cfg.entity, cfg) : { state: 'idle', words: C.sentenceCase(state.replace(/_/g, ' ')) };
        if (e.art.__s !== lk.state + lk.words) { e.art.__s = lk.state + lk.words; e.art.innerHTML = window.hkVacuumArt ? window.hkVacuumArt.html(lk.state, nm + ', ' + lk.words) : ''; }
        // (Mantel is holding a water tank report: Clear beside Clean, in the row of keys -- it is the same 56 px capsule as the others)
        e.clr.hidden = !lk.latched; e.clr.setAttribute('aria-label', 'Clear the water tank report for ' + nm);
        e.vst.textContent = lk.words; e.vst.className = 'vst' + (/^(water|error)$/.test(lk.state) ? ' err' : /^(docked|idle)$/.test(lk.state) ? ' idle' : '');
        // (the line: where it is and how far, the battery -- the state is said above it, an error in its color there)
        var chips = this._chips(st).slice(1).filter(function (c) { return c.c !== 'err'; });
        e.meta.textContent = chips.map(function (c) { return c.t; }).join(' \u00B7 ');
        var go = state === 'cleaning' ? ['pause', 'mdi:pause', 'Pause'] : state === 'paused' ? ['start', 'mdi:play', 'Resume'] : ['start', 'mdi:play', 'Clean'];
        e.go.setAttribute('data-svc', go[0]); e.go.setAttribute('aria-label', go[2] + ' ' + nm);
        e.go.querySelector('hk-icon').setAttribute('icon', go[1]); e.go.querySelector('span').textContent = go[2];
      }

      // ---- THE BLOCK (see the CSS): drawn whole each time and morphed in, so
      // a tap's focus and the rooms' scroll survive a state push
      _renderBlock(sz) {
        var cfg = this._config, esc = C.esc, self = this;
        this._built = false;                       // (the page's markup, if the block ever leaves the grid)
        this._watchBlock();
        var st = this._st(cfg.entity), state = (st && st.state) || 'unknown', a = (st && st.attributes) || {};
        var nm = cfg.name || a.friendly_name || cfg.entity;
        var chips = this._chips(st), bat = chips.filter(function (c) { return c.k === 'battery'; })[0];
        // THE WATER TANK HELD (hk-vacuum-art.js latch): Small and Large say so in their line; the larger blocks draw it and offer Clear
        var lk = window.hkVacuumArt ? window.hkVacuumArt.look(this.client, cfg.entity, cfg) : { state: 'idle', words: C.sentenceCase(state.replace(/_/g, ' ')) };
        var wline = lk.latched && lk.state === 'water' && !chips.some(function (c) { return c.c === 'err'; }) ? lk.words : '';
        if (sz === 'L' && wline) chips.push({ t: wline, c: 'err' });
        var clr = lk.latched && /^(XL|T|W)$/.test(sz) ? window.hkVacuumArt.clearPill(nm) : '';
        var words = function (list) {
          return list.map(function (c) { return c.c ? '<span class="' + c.c + '">' + esc(c.t) + '</span>' : esc(c.t); }).join(' \u00B7 ');
        };
        var rest = chips.filter(function (c) { return c.k !== 'battery'; });
        var faulty = rest.some(function (c) { return c.c === 'err'; }) || state === 'error';
        // HOW LONG SINCE IT LAST RAN: since it docked (the state's last change).
        // A restart of the house also sets that, so it is a floor, not a log.
        var since = '';
        if ((state === 'docked' || state === 'idle') && st && st.last_changed) {
          var m = Math.round((Date.now() - Date.parse(st.last_changed)) / 60000);
          since = !(m >= 1) ? '' : m < 60 ? m + ' min' : m < 48 * 60 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' days';
        }
        // (the state line's "Ran 31 min ago", Wide and Large and Tall; Extra Large says "Last run" in its own words)
        var ran = since ? ' \u00B7 Ran ' + esc(since) + ' ago' : '';
        // (...after what the line already says, else on its own: no " · Ran" opening an empty line -- a vacuum with no battery, 2026-11-10)
        var after = function (said) { return said ? said + ran : ran.replace(/^ \u00B7 /, ''); };
        // (FLIPPED, 2026-11-10, the owner: no heading -- the state upper left, the vacuum's name in the line under it, "Downstairs · 92%":
        // a house with two vacuums still tells their blocks apart)
        var short = String(nm).replace(/\s*(robot\s*)?vacuum$/i, '').trim() || nm, named = function (said) { return esc(short) + (said ? ' \u00B7 ' + said : ''); };
        // THE ROOMS (Large up, with Clean Areas or the house's script)
        var big = sz === 'L' || sz === 'XL', roomsOn = sz !== 'S' && this._picker();
        this._auto = roomsOn;
        if (roomsOn) this._subAreas();
        var floors = roomsOn ? this._floors() : null;
        this._keepOffered(floors);
        var n = roomsOn ? this._sel.size : 0;
        // THE KEYS: Clean (Pause while it runs, Resume when paused; with rooms
        // ticked, "Clean 2 rooms") and Dock
        var go = state === 'cleaning' ? ['pause', 'mdi:pause', 'Pause'] : state === 'paused' ? ['start', 'mdi:play', 'Resume']
          : n ? ['rooms', 'mdi:play', big ? 'Clean ' + n + (n === 1 ? ' room' : ' rooms') : 'Clean'] : ['start', 'mdi:play', 'Clean'];
        if (this._busy) go = ['', 'mdi:play', 'Sending…'];
        var key = function (k, cls, words) {
          return '<button type="button" class="key ' + cls + '" data-svc="' + k[0] + '" aria-label="' + esc(k[2] + ' ' + nm) + '"' +
            (k[0] ? '' : ' aria-disabled="true"') + '><hk-icon icon="' + k[1] + '"></hk-icon>' + (words ? '<span>' + esc(k[2]) + '</span>' : '') + '</button>';
        };
        var dock = ['return_to_base', 'mdi:home', 'Dock'];
        var status = this._hkStatus, stNode = '<div class="hk-status" role="status" aria-live="polite"' +
          (status ? ' data-kind="' + esc(status.kind) + '">' + esc(status.text) : '>') + '</div>';
        var rooms = '', list = floors ? floors.reduce(function (o, f) { return o.concat(f.areas || []); }, []) : null, chosen = list ?
          list.filter(function (r) { return self._sel.has(r.id); }).map(function (r) { return r.name; }) : [];
        if (roomsOn && big) {
          rooms = '<b class="lab">Rooms</b>' + (list === null ? '<div class="note">Reading the rooms…</div>'
            : !list.length ? '<div class="note">No room can be cleaned by area yet.</div>'
            : '<div class="rooms" role="group" aria-label="Rooms to clean">' + list.map(function (r) {
                var on = self._sel.has(r.id);
                return '<button type="button" class="pill vr" data-area="' + esc(r.id) + '" aria-pressed="' + on + '"><span>' + esc(r.name) + '</span></button>';
              }).join('') + '</div>');
        }
        // (Tall and Wide: the rooms picked in a sheet, named where they are picked -- one or two by name, more by count -- only while it can start a clean, and not beside a Clear pill: three targets
        // at most)
        var pickable = (sz === 'T' || sz === 'W') && roomsOn && list && list.length && !/^(cleaning|returning|paused)$/.test(state) && !clr, said = chosen.length > 2 ? chosen.length + ' rooms' :
          chosen.join(', ');
        var rkey = pickable ? (sz === 'T' ? '<button type="button" class="rrow' + (said ? ' on' : '') + '" data-rooms aria-label="' +
          (said ? 'Rooms to clean: ' + esc(chosen.join(', ')) + '. Change' : 'Rooms to clean: the whole house. Choose') +
            '"><span>' + (said ? esc(said) : 'All rooms') + '</span><hk-icon icon="mdi:chevron-right"></hk-icon></button>'
          : '<button type="button" class="key rm' + (said ? ' on' : '') + '" data-rooms aria-label="Choose rooms to clean' + (said ? ': ' + esc(chosen.join(', ')) : '') +
            '"><hk-icon icon="mdi:floor-plan"></hk-icon><span>' + (chosen.length ? chosen.length + (chosen.length === 1 ? ' room' : ' rooms') : 'Rooms') + '</span></button>') : '';
        // THE VACUUM DRAWN (Extra Large, Tall, Wide; hk-vacuum-art.js) and what it is doing in words under it, the battery in the line after
        var art = window.hkVacuumArt ? '<div class="art">' + window.hkVacuumArt.html(lk.state, nm + ', ' + lk.words) + '</div>' : '';
        var subw = (bat ? [bat] : []).concat(rest.slice(1)), what = '<b class="state">' + esc(lk.words) + '</b>' + clr;
        var html;
        if (sz === 'S') {
          html = '<div class="hd"><b class="nm">' + esc(nm) + '</b></div>' +
            '<span class="sub' + (wline ? ' two' : '') + '">' + (wline ? '<span class="err">' + esc(wline) + '</span><br>' : '') +
            (bat ? '<span class="' + bat.c + '">' + esc(bat.t) + '</span> \u00B7 ' : '') + words(rest) + '</span>' +
            '<div class="keys">' + key(go, 'go', true) + '</div>';
        } else if (sz === 'W') {
          // (Wide's Clear beside Dock, where the rooms key was -- under the words it squeezed the drawing to a speck, 2026-11-09)
          var wclr = clr ? '<button type="button" class="key rm" data-clear aria-label="Clear the water tank report for ' + esc(nm) + '"><span>Clear</span></button>' : '';
          html = '<div class="col">' + what.replace(clr, '') +
            '<span class="sub">' + (said ? named(words(subw)) + '</span><span class="rm-note">' + esc(chosen.join(', ')) : named(after(words(subw)))) + '</span>' + art + '</div>' +
            '<div class="side">' + key(go, 'go', true) + (pickable || wclr ? '<div class="pair">' + (wclr || rkey) + key(dock, 'dk', false) + '</div>' : key(dock, 'dk', true)) + '</div>';
        } else if (sz === 'T') {
          var bk = this._block(), more = rest.slice(1);
          html = '<div class="rt">' + stNode + what + '<span class="sub two">' + named(after(words((bat ? [bat] : []).concat(more)))) + '</span></div>' +
            '<div class="mid" style="--vb-r:' + (bk ? Math.max(72, Math.min(120, bk.h - (pickable ? 270 : 226))) : 96) + 'px">' + art + '</div>' + rkey +
            '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', false) + '</div>';
        } else if (sz === 'XL') {
          var run = [since ? 'Last run ' + since + ' ago' : ''];
          // (how much it cleaned and how long, where the vacuum says: older Xiaomi and Roborock integrations do)
          if (isFinite(Number(a.cleaned_area)) && isFinite(Number(a.cleaning_time)) && a.cleaned_area != null && a.cleaning_time != null) {
            run.push(Math.round(Number(a.cleaned_area)) + ' m\u00B2 in ' + Math.round(Number(a.cleaning_time)) + ' min');
          }
          var left = '<div class="rt">' + stNode + what + '<span class="sub two">' + named(words(subw)) + '<br>' +
            esc(run.filter(Boolean).join('\n')).replace(/\n/g, '<br>') + '</span></div>' + art;
          html = '<div class="lcol">' + left + (roomsOn ? '' : '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', true) + '</div>') + '</div>' +
            (roomsOn ? '<div class="rcol">' + rooms + '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', true) + '</div></div>' : '');
        } else {
          // LARGE (2026-11-10, the owner: "show the new animated vacuum, but still have some room selection ... a vertical scroll
          // list"): Extra Large's shape in less room -- the vacuum drawn, what it is doing and its battery on the left; the rooms a
          // list down the right that scrolls, Clean and Dock under it. No rooms on offer: the drawing in the middle over the keys
          var say = '<div class="rt">' + stNode + what + '<span class="sub two">' + named(after(words(subw))) + '</span></div>';
          html = roomsOn
            ? '<div class="lcol">' + say + art + '</div>' +
              '<div class="rcol">' + rooms + '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', false) + '</div></div>'
            : say + '<div class="mid">' + art + '</div>' +
              '<div class="keys">' + key(go, 'go', true) + key(dock, 'dk', false) + '</div>';
        }
        C.morph(this._root, '<hk-plate class="vb" data-s="' + sz + '"' + (roomsOn && big ? ' data-r' : '') + ' data-hk-role="card">' + html + '</hk-plate>');
        this._fitRooms();
        if (!this._blockTaps) {
          // ONE LISTENER for the block: a room ticks, a key acts, anywhere else opens the vacuum's sheet
          this._blockTaps = true;
          this._root.addEventListener('click', function (e) {
            if (!self._cellSize()) return;            // (the page card's own taps)
            var t = e.target.closest && e.target.closest('[data-svc],[data-area],[data-rooms],[data-clear]');
            e.stopPropagation();
            // (the plate and the battery ring: the block's tap, _tapTarget -- the ring counts as a control to openTarget, so it is asked here)
            if (!t) { if (!e._hkBlockTap) window.hkCards.openTarget(self, self._tapTarget()); return; }
            if (t.hasAttribute('data-clear')) { self._clearWater(); return; }
            if (t.hasAttribute('data-area')) { self._toggle(t.getAttribute('data-area')); return; }
            if (t.hasAttribute('data-rooms')) { self._pickRooms(); return; }
            var svc = t.getAttribute('data-svc');
            if (svc === 'rooms') self._start();
            else if (svc && self.client) self._call('vacuum', svc, { entity_id: self._config.entity });
          });
        }
      }
    }

    // ============================================================ area select
    // Pick rooms, then clean just those.
    //
    // The selection lives in THIS ELEMENT, in a Set -- not in input_boolean
    // helpers. It is not an entity, it is not broadcast, it is not recorded,
    // and two tablets never share one selection. The only thing that reaches
    // Home Assistant is the finished
    // list, once, when Clean is pressed.
    class HkAreaSelectCard extends areaPicking(HkBase) {
      static get CSS() {
        return [
          // THE SAME TRACK AS THE ROOM PILLS on the Play Music page: the same
          // markup, the same `pill` class, and the track every other pill grid
          // uses (hk-base.js TILE).
          //
          // A fixed width would also opt this card out of the responsive track:
          // --hk-track is what css/hk-responsive.css redefines below 640px to
          // reflow a grid to two columns, and a literal width cannot hear it.
          // On a phone this would be the one pill grid that does not reflow.
          '.grid{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));  grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap +
            'px;margin:0 0 14px 0}',
          // 40px PILLS, not 70px tiles: the action row matches the area pills
          // above it. Icon-well tiles here would stack two materials on one
          // grid. Play Music's equivalent row -- Clear, Transfer, Browse Music
          // -- is plain pills on the same track as the rooms above it, and this
          // is the same row with the same geometry.
          //
          // The rule below separates them, which is what carries the
          // "these act on the house" meaning that the shape does not.
          '.actions{display:grid;grid-template-columns:repeat(auto-fill,var(--hk-track,' + window.hkCards.TILE.w + 'px));  grid-auto-rows:40px;gap:' + window.hkCards.TILE.gridGap +
            'px;margin:0 0 14px 0}',
          '.floor{font-size:15px;font-weight:600;letter-spacing:-0.2px;  color:' + window.hkCards.v('ink-2') + ';padding:6px 4px 8px 4px}',
          // THE RULE separates two DIFFERENT kinds of thing: the pills above
          // only change a selection, the pills below act on the house. Without
          // it the action row reads as more pills that happen to look odd.
          '.rule{height:1px;margin:6px 4px 16px 4px;padding:0;border:none;  border-radius:0;box-shadow:none;background:' + window.hkCards.v('line') + '}',
          '.empty{font-size:15px;line-height:1.35;color:' + window.hkCards.v('ink-2') + ';padding:4px 4px 16px 4px}',
          // ------------------------------------------------------ THE PANEL
          // `layout: panel` (the Vacuums page, 2026-10-16): the floors on a page
          // card's plate, and what acts on them at its top -- how many are
          // chosen, Clear, Start Cleaning -- so the buttons never scroll away
          // from the count. Start waits for a room.
          '.plate{' + window.hkCards.plate('card') + ';padding:' + window.hkCards.CARD.pad + ';box-sizing:border-box;container-type:inline-size}',
          '.bar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid ' + window.hkCards.v('line') +
            '}',
          '.bar .n{min-width:0;font-size:13px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.bar .pill{min-width:96px}',
          '.bar .go[aria-pressed="true"] > span{color:' + SELECTED_TEXT + '}',
          '.bar .go[aria-disabled="true"]{opacity:0.45;pointer-events:none}',
          '.plate .floor{padding:0 0 10px 0;font-size:15px}',
          '.plate .grid{margin:0 0 16px 0}',
          '.plate .grid:last-child{margin-bottom:0}',
          '.plate .hk-status{margin:-6px 0 12px 0}',
          '.plate .hk-status:empty{display:none}',
          // narrow (an upright iPad's rail, a phone): the count on a line of
          // its own over the two buttons, and the rooms two across, sharing the width
          '@container (max-width:' + window.hkCards.BP.cardSide +
            'px){.bar{grid-template-columns:repeat(2,minmax(0,1fr))}.bar .n{grid-column:1 / -1}  .plate .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
          // a phone: stacked under the vacuum cards, which sit one grid deeper,
          // the plate steps in 4 px a side to share their edges
          '@media (max-width:' + window.hkCards.BP.phone + 'px){.plate{padding:16px;margin:0 4px}}',
          // in a Home Grid block (data-fill): the plate is the block's lower part, and its rooms scroll inside it
          ':host([data-fill]){display:block;height:100%}',
          ':host([data-fill]) .plate{height:100%;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y pinch-zoom;scrollbar-width:none}',
          ':host([data-fill]) .plate::-webkit-scrollbar{display:none}',
          '.pill:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:2px}'
        ].join('');
      }
      // AUTOMATIC ROOMS: a card whose YAML names
      // no `floors` shows the areas Clean Areas offers -- the ones a vacuum
      // reaches, or those chosen on HK Settings -> Clean by Area -- live
      // (hk_clean_areas/subscribe), grouped by Home Assistant's floors and named
      // by its areas. `floors:` written out still wins.
      _onConfig() {
        this._sel = this._config.pick ? picked(this._config.pick) : new Set();
        this._auto = !Array.isArray(this._config.floors) || !this._config.floors.length;
      }
      // Reads NO entity: everything it draws is the card-local selection, and
      // every change to that calls _render itself. HkBase's default signature has
      // no entity to key on and returns null ("always render"), which would wipe
      // and rebuild every area button on every state push -- measured
      // 120 DOM mutations for 12 updates that changed nothing, on a page with a
      // live camera and vacuums reporting constantly.
      // Automatic, it draws Home Assistant's areas and floors too: their names
      // and floors are the signature (the list itself arrives by subscription).
      _sigOf() {
        if (!this._auto) return 'static';
        this._subAreas();
        return 'auto|' + this._areaSig();
      }

      _render() {
        if (!this._config) return;
        var floors = this._floors();
        var self = this;
        this._keepOffered(floors);
        var n = this._sel ? this._sel.size : 0;
        if (this._config.layout === 'panel') return this._renderPanel(floors, n);
        this._root.innerHTML = '';

        var wrap = document.createElement('div');
        wrap.className = 'floors';
        this._root.appendChild(wrap);
        if (floors && !floors.length) {
          var o = this._offer || {};
          var e = document.createElement('div'); e.className = 'empty';
          e.textContent = (o.missing || o.configured === false) && !this._script()
            ? 'Add HK Clean Areas to clean by area.'
            : 'No room can be cleaned by area yet. Map each vacuum’s rooms in its settings in Home Assistant.';
          wrap.appendChild(e);
        }
        floors = floors || [];

        floors.forEach(function (f) {
          var h = document.createElement('div');
          h.className = 'floor'; h.textContent = f.name;
          wrap.appendChild(h);
          var g = document.createElement('div'); g.className = 'grid';
          (f.areas || []).forEach(function (a) {
            var b = document.createElement('div');
            b.className = 'pill';
            button(b, function () { self._toggle(a.id); });
            b.setAttribute('aria-pressed', self._sel.has(a.id) ? 'true' : 'false');
            var s = document.createElement('span'); s.textContent = a.name;
            b.appendChild(s);
            g.appendChild(b);
          });
          wrap.appendChild(g);
        });

        var rule = document.createElement('div'); rule.className = 'rule';
        this._root.appendChild(rule);

        var acts = document.createElement('div'); acts.className = 'actions';
        // The Start pill counts the selection itself -- a button that says how
        // many rooms it is about to send needs no separate count beside it, and
        // no other confirmation.
        var startPill = this._pill(
          this._busy ? 'Sending…'
                     : (n === 0 ? 'Start Cleaning'
                                : (n === 1 ? 'Clean 1 Area' : 'Clean ' + n + ' Areas')),
          function () { self._start(); });
        // Inert while a submission is in flight. _begin already drops the second
        // tap; this is so the pill does not look tappable while it is.
        if (this._busy) {
          startPill.setAttribute('aria-disabled', 'true');
          startPill.style.opacity = '0.35';
          startPill.style.pointerEvents = 'none';
          startPill.setAttribute('tabindex', '-1');
        }
        acts.appendChild(startPill);
        acts.appendChild(this._pill('Clear', function () { self._clear(); }));
        this._root.appendChild(acts);
        this._root.appendChild(this._statusNode());
      }


      // THE PANEL: the action bar, then each floor's rooms. Focus stays on
      // the room just pressed across the redraw (the selection is the only
      // thing that changes, so the pills are rebuilt in place).
      _renderPanel(floors, n) {
        var self = this;
        var had = this._root.activeElement && this._root.activeElement.getAttribute('data-area');
        var hadGo = this._root.activeElement && this._root.activeElement.classList.contains('go');
        this._root.innerHTML = '';
        var plate = document.createElement('div'); plate.className = 'plate';
        var bar = document.createElement('div'); bar.className = 'bar';
        var cnt = document.createElement('div'); cnt.className = 'n';
        var pk = !!this._config.pick;          // (the vacuum block's Rooms sheet: what is picked is the block's to clean, Done shuts the sheet)
        cnt.textContent = n === 0 ? (pk ? 'None chosen: the whole house' : 'Choose rooms, then start') : n === 1 ? '1 room selected' : n + ' rooms selected';
        cnt.setAttribute('aria-live', 'polite');
        bar.appendChild(cnt);
        var clr = this._pill('Clear', function () { self._clear(); });
        if (!n) { clr.setAttribute('aria-disabled', 'true'); clr.style.opacity = '0.45'; clr.style.pointerEvents = 'none'; clr.setAttribute('tabindex', '-1'); }
        bar.appendChild(clr);
        var go = this._pill(pk ? 'Done' : this._busy ? 'Sending…' : 'Start Cleaning', function () { if (pk) window.hkDetail.close(); else self._start(); });
        go.classList.add('go');
        // THE ONE THAT ACTS, in the selected material once there is something to send
        go.setAttribute('aria-pressed', pk || n && !this._busy ? 'true' : 'false');
        if (!pk && (!n || this._busy)) { go.setAttribute('aria-disabled', 'true'); go.setAttribute('tabindex', '-1'); }
        go.setAttribute('aria-label', pk ? 'Done' : n ? 'Start cleaning ' + n + (n === 1 ? ' room' : ' rooms') : 'Start Cleaning: choose rooms first');
        bar.appendChild(go);
        plate.appendChild(bar);
        plate.appendChild(this._statusNode());
        if (floors && !floors.length) {
          var o = this._offer || {};
          var e = document.createElement('div'); e.className = 'empty';
          e.textContent = (o.missing || o.configured === false) && !this._script()
            ? 'Add HK Clean Areas to clean by area.'
            : 'No room can be cleaned by area yet. Map each vacuum’s rooms in its settings in Home Assistant.';
          plate.appendChild(e);
        }
        var rows = this._config.list ? plate.appendChild(Object.assign(document.createElement('div'), { className: 'rl' })) : plate;   // (`list`: the rows scroll on their own, hk-sheet-vacuum.js)
        (floors || []).forEach(function (f) {
          var hd = document.createElement('div');
          hd.className = 'floor'; hd.textContent = f.name;
          rows.appendChild(hd);
          var g = document.createElement('div'); g.className = 'grid';
          g.setAttribute('role', 'group'); g.setAttribute('aria-label', f.name);
          (f.areas || []).forEach(function (a) {
            var b = document.createElement('div');
            b.className = 'pill';
            button(b, function () { self._toggle(a.id); });
            b.setAttribute('aria-pressed', self._sel.has(a.id) ? 'true' : 'false');
            b.setAttribute('data-area', a.id);
            var sp = document.createElement('span'); sp.textContent = a.name;
            b.appendChild(sp);
            g.appendChild(b);
          });
          rows.appendChild(g);
        });
        this._root.appendChild(plate);
        var back = had ? this._root.querySelector('[data-area="' + had.replace(/"/g, '') + '"]') : hadGo && n ? go : null;
        if (back && back.focus) back.focus();
      }

      // The same markup as hk-speaker-picker-card's `_pill`, down to the
      // aria-pressed="false" -- these never light, they act. Same markup means
      // the two pages' action rows cannot drift apart.
      _pill(text, onclick) {
        var b = document.createElement('div');
        b.className = 'pill';
        button(b, onclick);
        b.setAttribute('aria-pressed', 'false');
        var s = document.createElement('span'); s.textContent = text;
        b.appendChild(s);
        return b;
      }
      getCardSize() { return 6; }
    }

    // what the shell and the later parts use of this one
    K.HkAreaSelectCard = HkAreaSelectCard; K.HkVacuumCard = HkVacuumCard;
  };
})();
