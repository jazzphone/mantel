// hk-detail-accessory-pane.js - the accessory pane: a room's or a device's accessories, their names, glyphs and order.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-detail-accessory-pane'] = function (K) {
    var accOf = K.accOf, arrangeMove = K.arrangeMove, arrangeOf = K.arrangeOf, asClient = K.asClient, at = K.at,
        CHEV = K.CHEV, dashNow = K.dashNow, domainOf = K.domainOf, energyPlan = K.energyPlan, energyRec = K.energyRec,
        esc = K.esc, generatedHere = K.generatedHere, glyphSearch = K.glyphSearch, glyphsFor = K.glyphsFor,
        HA_RENAME_NOTE = K.HA_RENAME_NOTE, homeRenamer = K.homeRenamer, mdiList = K.mdiList,
        SEARCH_MAX = K.SEARCH_MAX, stOf = K.stOf, wherePane = K.wherePane;

    function accessoryPane(h, id, onName, opts) {
      opts = opts || {};
      // A client; the settings page (slice 11) still hands its host input,
      // which the host adapter turns into one. Its saves go through the
      // client's action port, its reads through the client.
      h = asClient(h);
      var el = document.createElement('div');
      el.className = 'acc';
      // ITS OWN COPY: the pane writes what was just chosen into `cur` as it
      // saves (cur.icon = ...), and accOf() hands back the live settings'
      // own object -- written there, the settings feed's answer looked like
      // no change, so no screen redrew until a reload (2026-10-01)
      var cur = JSON.parse(JSON.stringify(accOf(id))), dash = dashNow();
      var d = domainOf(id);
      var s = stOf(h, id);
      var HS = window.hkSettings;
      var boards = (HS && HS.get('boards', null)) || {};
      // opts.generated: said by the caller (tests); else read off the page
      var gen = opts.generated !== undefined ? !!opts.generated : generatedHere();
      var board = opts.panel || !gen ? null : boards[dash];
      // WHAT IS RELEVANT: "As a favorite" for something that is a favorite
      // somewhere, "As a chip" for a chip -- or for anything that already has
      // those set, so nothing set hides. Its Color is for everything.
      var anyBoard = function (key) {
        return Object.keys(boards).some(function (p) { return ((boards[p] || {})[key] || []).indexOf(id) >= 0; });
      };
      var isChip = anyBoard('chips_extra');
      var favShown = anyBoard('favorites') || !!(cur.fav_name || cur.fav_icon || cur.fav_room || (cur.fav_with && cur.fav_with.length));
      var chipRows = isChip || !!(cur.when || cur.attribute || cur.label);
      var e = (h.entities || {})[id] || {};
      var devArea = e.device_id && h.devices && h.devices[e.device_id] ? h.devices[e.device_id].area_id : null;
      var area = e.area_id || devArea || '';
      var here = !!(cur.names && cur.names[dash]);
      var errBox = null;
      var homeRename = homeRenamer(h);

      function fail(err) {
        if (!errBox) return;
        errBox.textContent = 'Not saved: ' + ((err && err.message) || err || 'unknown error');
        errBox.hidden = false;
      }
      function save(changes) {
        if (errBox) errBox.hidden = true;
        // changed on a dashboard's own sheet: that screen shows it as soon as
        // the sheet closes (hk-strategy.js ownChange)
        if (!opts.panel && window.hkStrategy && window.hkStrategy.ownChange) window.hkStrategy.ownChange();
        return h.actions.callWS(Object.assign({ type: 'hk_frontend/accessory/set', entity_id: id }, changes)).then(function (r) {
          if (opts.onSave) opts.onSave(true);
          return r;
        }, function (e) { fail(e); if (opts.onSave) opts.onSave(false); });
      }

      var html = '';
      html += '<div><div class="cap">Name and room</div><div class="grp">' +
        '<div class="row"><span class="k">Name</span><input class="nm" type="text" maxlength="60" aria-label="Name" ' +
        'autocomplete="off" spellcheck="false"></div>' +
        (homeRename ? '<div class="row"><span class="k">Also rename in Home Assistant</span><input class="tg haname" type="checkbox" role="switch" ' +
          'aria-label="Also rename in Home Assistant"></div>' : '') +
        (opts.panel ? '' : '<div class="row"><span class="k">Only on this dashboard</span><input class="tg here" type="checkbox" role="switch" aria-label="Only on this dashboard"></div>') +
        '<div class="row"><span class="k">Room</span><select class="room" aria-label="Room"></select></div></div>' +
        (homeRename ? '<div class="note hanote">' + esc(HA_RENAME_NOTE) + '</div>' : '') + '</div>';
      var showable = d === 'switch' || d === 'light' || d === 'input_boolean';
      if (showable) {
        html += '<div><div class="cap">Show as</div><div class="grp"><div class="seg show"></div></div></div>';
      }
      // WHAT ITS STATES ARE CALLED: a switch or a helper's
      // "Blocked" / "Allowed" in place of On / Off, on its tiles and favorite
      var named2 = d === 'switch' || d === 'input_boolean';
      if (named2) {
        html += '<div><div class="cap">What it says</div><div class="grp">' +
          '<div class="row"><span class="k">When on</span><input class="nm ontx" type="text" maxlength="30" aria-label="When on, it says" ' +
          'placeholder="On" autocomplete="off" spellcheck="false"></div>' +
          '<div class="row"><span class="k">When off</span><input class="nm offtx" type="text" maxlength="30" aria-label="When off, it says" ' +
          'placeholder="Off" autocomplete="off" spellcheck="false"></div></div></div>';
      }
      // ITS TILE'S HEIGHT on a generated dashboard: a light as a tall tile, a
      // lock as a pill (Automatic: what its kind is drawn as)
      html += '<div><div class="cap">Tile size</div><div class="grp"><div class="seg size"></div></div></div>';
      var arr = opts.tile ? arrangeOf(h, id, opts.tile) : null;
      if (arr) {
        html += '<div class="sec arr"><div class="cap">Arrange</div><div class="grp">' +
          '<div class="arrb"><button class="mvl" aria-label="Move Left"><hk-icon icon="mdi:chevron-left"></hk-icon>Move Left</button>' +
          '<button class="mvr" aria-label="Move Right">Move Right<hk-icon icon="mdi:chevron-right"></hk-icon></button></div>' +
          '<div class="mini" aria-hidden="true"></div><span class="sr" aria-live="polite"></span></div>' +
          '<div class="note">' + esc(arr.note) + '</div></div>';
      }
      // EDIT THIS PAGE (hk-edit.js, Edit mode): the page's pills dragged and
      // sized in place -- the way in on a screen whose menu is off, since a
      // sheet always opens. An Owner or Admin, not at a wall tablet, on a
      // page with something to arrange.
      var editHere = false;
      try { editHere = !opts.panel && !!(window.hkEdit && window.hkEdit.offer && window.hkEdit.offer(h)); } catch (e) { editHere = false; }
      if (editHere) {
        html += '<div class="sec editpg"><div class="cap">This Page</div><div class="grp"><button class="edpg" type="button">' +
          '<hk-icon icon="mdi:pencil"></hk-icon>Edit This Page</button></div>' +
          '<div class="note">' + esc(window.hkEdit.hint ? window.hkEdit.hint() : 'Drag the tiles on this page into place, and make them Tall or Regular.') + '</div></div>';
      }
      html += '<div><div class="cap">Icon</div><div class="grp"><label class="gsearch"><input type="search" class="gq" ' +
        'placeholder="Search all icons" aria-label="Search all icons" autocomplete="off" spellcheck="false"></label>' +
        '<div class="glyphs"></div></div></div>';
      // SPIN: for a fan (or what is drawn as one) -- its tile's glyph turns
      // while it is on, and a chosen icon is not always one that reads as
      // spinning. Still: never. Automatic: its kind (a fan spins). Built for
      // anything Show As can make a fan, and shown while it is one.
      // It spins only while Animations are on (Sky / Background: hk-base.js
      // hk-still), so the note says so -- and, on a screen where they are
      // off, that it is standing still for that reason.
      if (d === 'fan' || showable) {
        var animOff = false;
        if (!(opts && opts.panel)) {
          try { animOff = !!(window.hkSettings && window.hkSettings.skyLook && window.hkSettings.skyLook().animations === false); } catch (e) { animOff = false; }
        }
        html += '<div class="spinrow"' + (d === 'fan' || cur.show_as === 'fan' ? '' : ' hidden') + '>' +
          '<div class="cap">Spinning</div><div class="grp"><div class="seg spin" role="group" aria-label="Spinning"></div></div>' +
          // under its group, as every other note in the pane (Arrange, Energy)
          '<div class="note">Whether its tile’s glyph turns while it is on. It turns only while Animations are on ' +
          '(' + window.hkShell.settingsPlace('Sky / Background') + ', for All Screens or each screen).' +
          (animOff ? ' They’re off on this screen, so it stays still.' : '') + '</div></div>';
      }
      // WHERE IT SHOWS (Hidden Accessories, hiding.py): Show in HK Frontend,
      // then a switch for each place it can be hidden from -- asked of the
      // server, which knows its kinds -- and, on a dashboard, Favorite
      html += '<div class="sec where"><div class="cap">Where it shows</div><div class="grp">' +
        '<div class="row wall"><span class="k">Show in ' + window.hkShell.productName() + '<small class="wwhy" hidden></small></span>' +
        '<input class="tg shown" type="checkbox" role="switch" aria-label="Show in ' + window.hkShell.productName() + '" disabled></div>' +
        (board ? '<div class="row"><span class="k">Favorite on this dashboard</span><input class="tg fav" type="checkbox" role="switch" aria-label="Favorite on this dashboard"></div>' : '') +
        '</div><div class="note">' + (opts.panel
          ? 'Anything off here is listed in <a href="#/accessories/hidden">Hidden Accessories</a>, with where.'
          : 'Anything off here is listed in ' + window.hkShell.settingsPlace('Accessories → Hidden Accessories') + '.') + '</div></div>' +
        // ALSO COUNT AS (Status & Chips' Also count, moved here 2026-10-12):
        // the kinds it isn't found in by itself but could be counted in
        '<div class="sec also" hidden><div class="cap">Also count as</div><div class="grp"></div>' +
        '<div class="note">Counted there too, though it isn’t found there by itself — an outlet you think of as a light, ' +
        'a camera that hears the smoke alarm.</div></div>';
      // ON THE ENERGY PAGE (the Energy feature): a device's own settings
      // there -- its name, its section, shown or not -- and the way to the
      // rest (its power sensor, its switch) on HK Settings
      var enRec = energyRec(id), enPlan = enRec ? energyPlan() : null;
      if (enRec) {
        var enSecs = (enPlan.sections || []);
        var enIn = enSecs.filter(function (x) { return (x.items || []).some(function (i) { return i.key === enRec.key; }); })[0];
        html += '<div class="sec energy"><div class="cap">On the Energy page</div><div class="grp">' +
          '<div class="row"><span class="k">Name there</span><input class="nm enn" type="text" maxlength="40" aria-label="Name on the Energy page" ' +
          'autocomplete="off" spellcheck="false"></div>' +
          '<div class="row"><span class="k">Section</span><select class="ens" aria-label="Section on the Energy page">' +
          (enIn ? '' : '<option value="" selected>Hidden</option>') +
          enSecs.map(function (x) { return '<option value="' + esc(x.id) + '"' + (enIn && enIn.id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="row"><span class="k">Show there</span><input class="tg enh" type="checkbox" role="switch" aria-label="Show on the Energy page"' +
          (enIn ? ' checked' : '') + '></div>' +
          '<a class="row enl" href="/hk-settings#/features/energy/devices/' + encodeURIComponent(enRec.key) + '"><span class="k">More energy settings</span>' + CHEV + '</a>' +
          '</div><div class="note">Its power sensor and its switch are on ' + window.hkShell.settingsPlace('Pages → Energy') + '.</div></div>';
      }
      // AS A FAVORITE: its name and glyph on the favorites row,
      // on every dashboard where it is a favorite, and the lights it controls
      // together with there ("Main + Table Lights")
      var joinable = d === 'light' || d === 'switch' || d === 'input_boolean';
      html += '<div class="sec fav"' + (favShown ? '' : ' hidden') + '><div class="cap">As a favorite</div><div class="grp">' +
        '<div class="row"><span class="k">Name</span><input class="nm fvn" type="text" maxlength="60" aria-label="Name as a favorite" ' +
        'autocomplete="off" spellcheck="false"></div>' +
        // the room line above its name there (a helper with no area)
        '<div class="row"><span class="k">Room</span><input class="nm fvr" type="text" maxlength="40" aria-label="Room line as a favorite" ' +
        'autocomplete="off" spellcheck="false"></div>' +
        '<label class="gsearch fvs"><input type="search" class="fvq" placeholder="Search all icons" ' +
        'aria-label="Search all icons as a favorite" autocomplete="off" spellcheck="false"></label>' +
        '<div class="glyphs fvg"></div>' +
        (joinable ? '<div class="row"><span class="k">Together with</span><select class="fvw" aria-label="Together with"></select></div>' +
                    '<div class="with"></div>' : '') +
        '</div></div>';
      // ITS COLOR: one choice, worn everywhere it is drawn -- its tiles on
      // every page, its favorite, its chip, its pill in the Scenes row
      // (hk-strategy tileOf, hk-chip, hk-tile HkSceneCard). Every accessory
      // has it. Then, as a chip only, what the chip reads and when it shows.
      html += '<div class="sec chip"><div class="cap">Color</div><div class="grp"><div class="swatches"></div></div></div>' +
        '<div class="sec chiprows"' + (chipRows ? '' : ' hidden') + '><div class="cap">As a chip</div><div class="grp">' +
        '<div class="row"><span class="k">Show only when it is</span><input class="nm when" type="text" maxlength="60" aria-label="Show only when it is" ' +
        'placeholder="any state" autocomplete="off" spellcheck="false"></div>' +
        // what the chip reads: its state, or one of its attributes, so a
        // chip of your own can pick what it shows
        '<div class="row"><span class="k">Shows</span><select class="attr" aria-label="Shows"></select></div>' +
        '<div class="row"><span class="k">Label</span><input class="nm lbl" type="text" maxlength="40" aria-label="Label" ' +
        'placeholder="what it shows" autocomplete="off" spellcheck="false"></div></div></div>';
      html += '<button class="reset">Reset to Automatic</button>' +
        '<div class="sure" hidden role="group" aria-label="Reset to Automatic"><div class="q">Every setting of this accessory goes back ' +
        'to automatic, on every screen. Its room stays.</div><div class="b"><button class="no">Cancel</button>' +
        '<button class="go">Reset</button></div></div>' +
        '<div class="note err" hidden></div>' +
        '<div class="note">Saved as you change it, on every screen. The room is Home Assistant\'s own; ' +
        'the name and icon are these dashboards\' only' + (homeRename ? ', unless Also rename in Home Assistant is on.' : '.') + '</div>';
      el.innerHTML = html;
      errBox = el.querySelector('.err');

      // ON THE ENERGY PAGE: through the Energy feature's own commands
      if (enRec) {
        var enSave = function (changes) {
          return h.actions.callWS({ type: 'hk_energy/device/set', key: enRec.key, changes: changes }).catch(fail);
        };
        var enn = el.querySelector('.enn'), ens = el.querySelector('.ens'), enh = el.querySelector('.enh');
        var enName = (enPlan.names || {})[enRec.key] || enRec.name || '';
        enn.placeholder = enName;
        enn.addEventListener('change', function () { enSave({ name: enn.value.trim() || null }); });
        enn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') enn.blur(); });
        enh.addEventListener('change', function () { enSave({ hidden: !enh.checked }); });
        ens.addEventListener('change', function () {
          if (!ens.value) return;
          // moved by the server, in the sections as STORED: the plan here
          // leaves out hidden devices and empty sections, and rebuilding the
          // list from it lost both. The device is shown there too.
          enh.checked = true;
          h.actions.callWS({ type: 'hk_energy/device/section', key: enRec.key, section: ens.value }).catch(fail);
        });
      }

      // NAME
      var nm = el.querySelector('.nm'), hereBox = el.querySelector('.here') || { checked: false, addEventListener: function () {} };
      var fallback = at(s, 'friendly_name') || id;
      nm.placeholder = fallback;
      hereBox.checked = here;
      nm.value = (here ? cur.names[dash] : cur.name) || '';
      var nt = null;
      var saveName = function () {
        clearTimeout(nt);
        var v = nm.value.trim();
        var ch = { name: v || null };
        if (hereBox.checked) ch.screen = dash;
        else cur.name = v || null;
        save(ch).then(function () {
          if (onName) onName(v || null);
          if (haBox && cur.ha_name && !hereBox.checked) toHome(v);
        });
      };
      nm.addEventListener('input', function () { clearTimeout(nt); nt = setTimeout(saveName, 700); });
      nm.addEventListener('change', saveName);
      nm.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') nm.blur(); });
      // ALSO RENAME IN HOME ASSISTANT: while on, the home-wide name is written to Home Assistant's registry as it is
      // saved (an emptied name clears Home Assistant's own, which then shows its default); a name for this dashboard
      // alone is never sent. Switched on, the name there is written at once; with no name yet, nothing is, so a name
      // someone gave it in Home Assistant is not wiped.
      var haBox = homeRename ? el.querySelector('.haname') : null;
      var toHome = function (name) {
        return homeRename(id, name || null).then(function () { return true; }, function (err) {
          if (errBox) {
            errBox.textContent = 'Not renamed in Home Assistant: ' + ((err && err.message) || err || 'unknown error');
            errBox.hidden = false;
          }
          return false;
        });
      };
      if (haBox) {
        haBox.checked = !!cur.ha_name;
        haBox.addEventListener('change', function () {
          if (errBox) errBox.hidden = true;
          if (!haBox.checked) { cur.ha_name = null; save({ ha_name: false }); return; }
          var v = String(cur.name || '').trim();
          (v ? toHome(v) : Promise.resolve(true)).then(function (done) {
            if (!done) { haBox.checked = false; return; }
            cur.ha_name = true;
            save({ ha_name: true });
          });
        });
      }
      hereBox.addEventListener('change', function () {
        // moving the name between "the home's" and "this dashboard's"
        // (turning it off must not save the typed per-screen name as the
        // HOME's, overwriting it: the home's name comes back.)
        var v = nm.value.trim();
        if (hereBox.checked) {
          save({ name: v || null, screen: dash });
        } else {
          save({ name: null, screen: dash }).then(function () {
            nm.value = cur.name || '';
            if (onName) onName(cur.name || null);
          });
        }
      });

      // ROOM (Home Assistant's area). Choosing the device's own area goes
      // back to following the device.
      var room = el.querySelector('.room');
      var areas = Object.keys(h.areas || {}).map(function (k) { return h.areas[k]; })
        .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      room.innerHTML = '<option value="">No room</option>' + areas.map(function (a) {
        return '<option value="' + a.area_id + '">' + String(a.name).replace(/</g, '&lt;') + '</option>';
      }).join('');
      room.value = area;
      room.addEventListener('change', function () {
        var v = room.value || null;
        if (errBox) errBox.hidden = true;
        h.actions.callWS({ type: 'config/entity_registry/update', entity_id: id,
                   area_id: v && v === devArea ? null : v }).catch(fail);
      });

      // SHOW AS
      var seg = el.querySelector('.seg.show');
      if (seg) {
        var showAs = [['', 'Automatic'], ['light', 'Light'], ['switch', 'Switch'], ['outlet', 'Outlet'], ['fan', 'Fan']];
        seg.innerHTML = showAs.map(function (o) {
          return '<button data-v="' + o[0] + '"' + ((cur.show_as || '') === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>';
        }).join('');
        seg.addEventListener('click', function (ev) {
          var b = ev.target.closest('button');
          if (!b) return;
          seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
          cur.show_as = b.dataset.v || null;
          save({ show_as: cur.show_as });
          paintGlyphs(cur.show_as);
          showSpin();
        });
      }

      // SIZE
      var sizeSeg = el.querySelector('.seg.size');
      var paintSize = function () {
        sizeSeg.innerHTML = [['', 'Automatic'], ['regular', 'Regular'], ['tall', 'Tall']].map(function (o) {
          return '<button data-v="' + o[0] + '"' + ((cur.size || '') === o[0] ? ' class="on"' : '') +
                 ' aria-pressed="' + ((cur.size || '') === o[0]) + '">' + o[1] + '</button>';
        }).join('');
      };
      paintSize();
      sizeSeg.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        cur.size = b.dataset.v || null;
        paintSize();
        save({ size: cur.size });
      });

      // SPIN (a fan)
      var spinSeg = el.querySelector('.seg.spin'), spinRow = el.querySelector('.spinrow');
      function showSpin() { if (spinRow) spinRow.hidden = !(d === 'fan' || cur.show_as === 'fan'); }
      var paintSpin = function () {
        if (!spinSeg) return;
        var v = cur.anim || '';
        spinSeg.innerHTML = [['', 'Automatic'], ['spin', 'Spin'], ['none', 'Still']].map(function (o) {
          return '<button data-v="' + o[0] + '"' + (v === o[0] ? ' class="on"' : '') +
                 ' aria-pressed="' + (v === o[0]) + '">' + o[1] + '</button>';
        }).join('');
      };
      paintSpin();
      if (spinSeg) {
        spinSeg.addEventListener('click', function (ev) {
          var b = ev.target.closest('button');
          if (!b) return;
          cur.anim = b.dataset.v || null;
          paintSpin();
          save({ anim: cur.anim });
        });
      }

      // ARRANGE
      if (arr) {
        var mini = el.querySelector('.mini'), mvl = el.querySelector('.mvl'), mvr = el.querySelector('.mvr');
        var sr = el.querySelector('.arr .sr'), queue = Promise.resolve();
        var paintArr = function () {
          mini.style.gridTemplateColumns = 'repeat(' + arr.cols + ',minmax(0,1fr))';
          mini.innerHTML = arr.visible.map(function (x) {
            var t = arr.look[x] || {};
            return '<div class="mt' + (t.tall ? ' tall' : '') + (x === id ? ' on' : '') + '">' +
              (t.icon ? '<hk-icon icon="' + esc(t.icon) + '"></hk-icon>' : '') + '<span>' + esc(t.name || x) + '</span></div>';
          }).join('');
          var i = arr.visible.indexOf(id);
          mvl.disabled = i <= 0;
          mvr.disabled = i >= arr.visible.length - 1;
        };
        var move = function (dir) {
          var next = arrangeMove(arr.visible, arr.full, id, dir);
          if (!next) return;
          arr.visible = next.visible; arr.full = next.full;
          paintArr();
          var i = arr.visible.indexOf(id);
          if (sr) sr.textContent = 'Now ' + (i + 1) + ' of ' + arr.visible.length;
          if (window.hkStrategy && window.hkStrategy.ownChange) window.hkStrategy.ownChange();
          if (errBox) errBox.hidden = true;
          var msg = arr.fav ? { type: 'hk_frontend/board/set', dashboard: arr.dash, changes: { favorites: next.full } }
                            : { type: 'hk_frontend/accessory/order', area_id: arr.area, entities: next.full };
          // one at a time, in the order tapped
          queue = queue.then(function () { return h.actions.callWS(msg); }).catch(fail);
        };
        mvl.addEventListener('click', function () { move(-1); });
        mvr.addEventListener('click', function () { move(1); });
        paintArr();
      }

      // EDIT THIS PAGE: the sheet goes, the page goes into Edit mode
      var edpg = editHere ? el.querySelector('.edpg') : null;
      if (edpg) {
        edpg.addEventListener('click', function () {
          if (opts.close) opts.close();
          if (window.hkEdit && window.hkEdit.enter) window.hkEdit.enter(h);
        });
      }

      // ICON
      var grid = el.querySelector('.glyphs');
      // A GLYPH GRID: its kind's list (Auto first), or what a search finds --
      // the hk: glyphs, then the Material ones under their own heading.
      function glyphGrid(box, q, chosen, list, auto) {
        var btn = function (it) {
          var on = chosen === it.v || chosen.replace(/^(hk|mdi):/, '') === it.v.replace(/^(hk|mdi):/, '');
          return '<button data-v="' + esc(it.v) + '" aria-label="' + esc(it.v.replace(/^(hk|mdi):/, '').replace(/-/g, ' ')) +
                 (it.mdi ? ' (Material)' : '') + '"' + (on ? ' class="on"' : '') + '><hk-icon icon="' + esc(it.icon) + '"></hk-icon></button>';
        };
        var query = String(q || '').trim();
        box._q = query;
        if (!query) {
          if (chosen && list.indexOf(chosen.replace(/^(hk|mdi):/, '')) < 0) list = [chosen.replace(/^(hk|mdi):/, '')].concat(list);
          box.innerHTML = '<button data-v="" class="' + (chosen ? '' : 'on') + '" aria-label="' + auto[1] + '">' + auto[0] + '</button>' +
            list.map(function (g) { return btn({ v: 'hk:' + g, icon: 'hk:' + g }); }).join('');
          return;
        }
        var paint = function (mdiAll) {
          if (box._q !== query) return;           // a later search won
          var got = glyphSearch(query, mdiAll);
          var mdi = got.mdi.slice(0, SEARCH_MAX);
          box.innerHTML = got.hk.map(btn).join('') +
            (mdi.length ? '<div class="gh">Material Design</div>' + mdi.map(btn).join('') : '') +
            (got.mdi.length > SEARCH_MAX ? '<div class="gn">' + SEARCH_MAX + ' of ' + got.mdi.length + ' Material icons. Keep typing to narrow it down.</div>' : '') +
            (!got.hk.length && !got.mdi.length ? '<div class="gn">' + (mdiAll ? 'No icon matches.' : 'Searching…') + '</div>' : '');
        };
        paint(null);
        mdiList().then(paint);
      }
      var gq = el.querySelector('.gq');
      function paintGlyphs(show) {
        if (show !== undefined) gq.value = '';
        glyphGrid(grid, gq.value, String(cur.icon || ''), glyphsFor(id, show === undefined ? cur.show_as : show), ['Auto', 'Automatic']);
      }
      gq.addEventListener('input', function () { paintGlyphs(); });
      paintGlyphs();
      grid.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        grid.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        cur.icon = b.dataset.v || null;
        save({ icon: b.dataset.v || null });
      });

      // WHERE IT SHOWS: what hides it, from the server (hiding.py); a
      // change sets every place at once, as Hidden Accessories does
      var fav = el.querySelector('.fav');
      wherePane(h, el, id, area, opts, fail);
      if (fav && board) {
        fav.checked = (board.favorites || []).indexOf(id) >= 0;
        fav.addEventListener('change', function () {
          if (errBox) errBox.hidden = true;
          if (fav.checked) { var fs = el.querySelector('.sec.fav'); if (fs) fs.hidden = false; }
          h.actions.callWS({ type: 'hk_frontend/board/favorite', dashboard: dash, entity_id: id,
                     favorite: fav.checked }).catch(fail);
        });
      }

      // AS A FAVORITE
      var fvn = el.querySelector('.fvn'), fvg = el.querySelector('.fvg'), fvw = el.querySelector('.fvw');
      var withBox = el.querySelector('.with');
      fvn.value = cur.fav_name || '';
      var favFallback = function () { return nm.value.trim() || fallback; };
      fvn.placeholder = favFallback();
      var fvr = el.querySelector('.fvr');
      if (fvr) fvr.placeholder = (area && h.areas && h.areas[area] && h.areas[area].name) || 'None';
      ['input', 'change'].forEach(function (t) { nm.addEventListener(t, function () { fvn.placeholder = favFallback(); }); });
      var ft = null;
      var saveFav = function () { clearTimeout(ft); save({ fav_name: fvn.value.trim() || null }); };
      fvn.addEventListener('input', function () { clearTimeout(ft); ft = setTimeout(saveFav, 700); });
      fvn.addEventListener('change', saveFav);
      fvn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') fvn.blur(); });
      var fvq = el.querySelector('.fvq');
      function paintFavGlyphs() {
        glyphGrid(fvg, fvq.value, String(cur.fav_icon || ''), glyphsFor(id, cur.show_as), ['Same', 'Same as its icon']);
      }
      fvq.addEventListener('input', function () { paintFavGlyphs(); });
      paintFavGlyphs();
      fvg.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        fvg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        cur.fav_icon = b.dataset.v || null;
        save({ fav_icon: b.dataset.v || null });
      });
      var nameOfId = function (x) { return at(stOf(h, x), 'friendly_name') || x; };
      function paintWith() {
        if (!fvw) return;
        var chosen = Array.isArray(cur.fav_with) ? cur.fav_with : [];
        withBox.innerHTML = chosen.map(function (x) {
          return '<button data-v="' + x + '" aria-label="Remove ' + esc(nameOfId(x)) + '">' + esc(nameOfId(x)) +
                 ' <span aria-hidden="true">\u2715</span></button>';
        }).join('');
        withBox.hidden = !chosen.length;
        // the others it could be joined with: this room's first, then the rest
        var areaOfId = function (x) {
          var ex = (h.entities || {})[x] || {};
          return ex.area_id || (ex.device_id && h.devices && h.devices[ex.device_id] ? h.devices[ex.device_id].area_id : '');
        };
        var pool = Object.keys(h.states).filter(function (x) {
          var dx = domainOf(x), ex = (h.entities || {})[x] || {};
          return x !== id && chosen.indexOf(x) < 0 && !ex.hidden && !ex.entity_category &&
                 (d === 'light' ? dx === 'light' : (dx === 'switch' || dx === 'light' || dx === 'input_boolean'));
        }).sort(function (x, y) {
          return ((areaOfId(y) === area) - (areaOfId(x) === area)) || nameOfId(x).localeCompare(nameOfId(y));
        });
        fvw.innerHTML = '<option value="">' + (chosen.length ? 'Add another' : 'Nothing else') + '</option>' +
          pool.map(function (x) { return '<option value="' + x + '">' + esc(nameOfId(x)) + '</option>'; }).join('');
        fvw.value = '';
      }
      if (fvw) {
        paintWith();
        fvw.addEventListener('change', function () {
          if (!fvw.value) return;
          cur.fav_with = (Array.isArray(cur.fav_with) ? cur.fav_with : []).concat([fvw.value]);
          save({ fav_with: cur.fav_with });
          paintWith();
        });
        withBox.addEventListener('click', function (ev) {
          var b = ev.target.closest('button');
          if (!b) return;
          cur.fav_with = (cur.fav_with || []).filter(function (x) { return x !== b.dataset.v; });
          save({ fav_with: cur.fav_with.length ? cur.fav_with : null });
          paintWith();
        });
      }

      // COLOR, SHOW ONLY WHEN, LABEL
      var SW = { white: '#f2f2f7', yellow: '#ffd60a', orange: '#ff9f0a', red: '#ff453a', pink: '#ff375f',
                 purple: '#bf5af2', blue: '#0a84ff', teal: '#64d2ff', mint: '#63e6e2', green: '#30d158' };
      var sw = el.querySelector('.swatches');
      if (sw) {
        sw.innerHTML = '<button data-v="" class="' + (cur.color ? '' : 'on') + '">Auto</button>' + Object.keys(SW).map(function (c) {
          return '<button data-v="' + c + '" aria-label="' + c + '" class="' + (cur.color === c ? 'on' : '') +
                 '" style="background:' + SW[c] + '"></button>';
        }).join('');
        sw.addEventListener('click', function (ev) {
          var b = ev.target.closest('button');
          if (!b) return;
          sw.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
          save({ color: b.dataset.v || null });
        });
      }
      var attrSel = el.querySelector('.attr');
      if (attrSel) {
        var sa = (h.states[id] && h.states[id].attributes) || {};
        var SKIP = { friendly_name: 1, icon: 1, entity_picture: 1, supported_features: 1, device_class: 1,
                     unit_of_measurement: 1, state_class: 1, attribution: 1, restored: 1, editable: 1, id: 1 };
        var keys = Object.keys(sa).filter(function (k) {
          var v = sa[k];
          return !SKIP[k] && v !== null && (typeof v !== 'object');
        }).sort();
        if (cur.attribute && keys.indexOf(cur.attribute) < 0) keys.unshift(cur.attribute);
        attrSel.innerHTML = '<option value="">Its state</option>' + keys.map(function (k) {
          return '<option value="' + esc(k) + '"' + (cur.attribute === k ? ' selected' : '') + '>' +
            esc(k.replace(/_/g, ' ')) + '</option>';
        }).join('');
        attrSel.addEventListener('change', function () { save({ attribute: attrSel.value || null }); });
      }
      [['.when', 'when'], ['.lbl', 'label'], ['.ontx', 'on_text'], ['.offtx', 'off_text'], ['.fvr', 'fav_room']].forEach(function (p) {
        var inp = el.querySelector(p[0]);
        if (!inp) return;
        inp.value = cur[p[1]] || '';
        var t = null;
        var go = function () { clearTimeout(t); var ch = {}; ch[p[1]] = inp.value.trim() || null; save(ch); };
        inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(go, 700); });
        inp.addEventListener('change', go);
      });

      var resetBtn = el.querySelector('.reset'), sure = el.querySelector('.sure');
      var noBtn = el.querySelector('.sure .no'), goBtn = el.querySelector('.sure .go');
      var focus = function (b) { if (b && b.focus) b.focus(); };
      resetBtn.addEventListener('click', function () {
        resetBtn.hidden = true; sure.hidden = false;
        focus(noBtn);
      });
      noBtn.addEventListener('click', function () {
        sure.hidden = true; resetBtn.hidden = false; focus(resetBtn);
      });
      goBtn.addEventListener('click', function () {
        sure.hidden = true; resetBtn.hidden = false;
        var all = { name: null, icon: null, show_as: null, size: null, anim: null, status: null, home: null, color: null, when: null, label: null,
                    attribute: null, fav_name: null, fav_icon: null, fav_with: null, fav_room: null,
                    on_text: null, off_text: null, ha_name: false };
        save(all).then(function () { return save({ name: null, screen: dash }); }).then(function () {
          cur = {};
          nm.value = ''; hereBox.checked = false;
          if (haBox) haBox.checked = false;
          if (seg) seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', !x.dataset.v); });
          paintSize();
          paintSpin();
          showSpin();
          paintGlyphs(null);
          fvn.value = ''; paintFavGlyphs(); paintWith();
          // everything the reset cleared shows cleared (the colour, what a
          // chip shows, its gate and label), not their old values
          if (sw) sw.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', !x.dataset.v); });
          if (attrSel) attrSel.value = '';
          ['.when', '.lbl', '.ontx', '.offtx', '.fvr'].forEach(function (q) { var i = el.querySelector(q); if (i) i.value = ''; });
          if (onName) onName(null);
        });
      });
      return el;
    }

    // what the shell and the later parts use of this one
    K.accessoryPane = accessoryPane;
  };
})();
